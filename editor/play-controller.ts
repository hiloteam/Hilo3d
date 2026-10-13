import { evaluateClip, type AnimationClip } from './animation';
import { cloneScene, type SceneDocument, type SceneNode } from './scene';
import type { ProjectDocument } from './project';
import { ScriptRuntime, type ScriptInput } from './script-runtime';
import type { ScriptComponentCommand } from './script-types';

type Transforms = Record<string, SceneNode['transform']>;
export type PlayState = 'stopped' | 'starting' | 'playing' | 'paused';

/** Components share the script/animation clock; no component owns a second animation loop. */
export interface PlayComponents {
    step(dt: number, time: number, scene: SceneDocument): Transforms | Promise<Transforms>;
    executeCommands?(commands: readonly ScriptComponentCommand[]): void;
    pause?(): void;
    resume?(): void;
    stop(): void | Promise<void>;
}

export interface PlayControllerOptions {
    getProject: () => ProjectDocument;
    getClipId: () => string | null;
    /** Asset readiness and runtime camera selection must finish before any script starts. */
    beforeStart?: (signal: AbortSignal) => Promise<void>;
    createComponents?: (
        scene: SceneDocument,
        project: ProjectDocument,
        signal: AbortSignal
    ) => Promise<PlayComponents>;
    onTransforms: (transforms: Transforms) => void;
    onRestore: () => void;
    onState: (state: PlayState, time: number) => void;
    onLog: (message: string) => void;
    onError: (message: string) => void;
}

interface PlaySession {
    readonly abort: AbortController;
    readonly authored: SceneDocument;
    readonly scene: SceneDocument;
    readonly clip: AnimationClip | null;
    readonly script: ScriptRuntime;
    components: PlayComponents | null;
    starting: Promise<void> | null;
    advancing: Promise<void> | null;
    time: number;
    pauseRequested: boolean;
}

const FIXED_STEP = 1 / 60;

/** Isolated fixed-step playback shared by the editor and standalone Player. */
export class PlayController {
    private session: PlaySession | null = null;
    private stateValue: PlayState = 'stopped';
    private time = 0;
    private frame = 0;
    private lastFrame = 0;
    private accumulator = 0;
    private clockGeneration = 0;
    private stopping: Promise<void> = Promise.resolve();

    constructor(private readonly options: PlayControllerOptions) {}

    get state(): PlayState {
        return this.stateValue;
    }
    get active(): boolean {
        return this.stateValue !== 'stopped';
    }
    get elapsedTime(): number {
        return this.time;
    }

    async play(): Promise<void> {
        if (this.stateValue === 'starting' && this.session) {
            this.session.pauseRequested = false;
            await this.session.starting;
            return;
        }
        if (this.stateValue === 'paused') {
            try {
                this.session?.components?.resume?.();
                this.changeState('playing');
                this.schedule();
            } catch (error) {
                this.fail(error);
            }
            return;
        }
        if (this.active) return;
        const project = this.options.getProject();
        const source = project.scenes[project.activeSceneId];
        if (!source) throw new Error('Active scene is missing.');
        const clipId = this.options.getClipId();
        const clip = clipId ? project.clips[clipId] : undefined;
        const session: PlaySession = {
            abort: new AbortController(),
            authored: cloneScene(source),
            scene: cloneScene(source),
            clip: clip?.sceneId === project.activeSceneId ? structuredClone(clip) : null,
            script: new ScriptRuntime(this.options.onLog),
            components: null,
            starting: null,
            advancing: null,
            time: 0,
            pauseRequested: false
        };
        this.session = session;
        this.time = 0;
        this.accumulator = 0;
        this.changeState('starting');
        session.starting = this.startSession(session, project, this.stopping);
        await session.starting;
    }

    private async startSession(
        session: PlaySession,
        project: ProjectDocument,
        previousStop: Promise<void>
    ): Promise<void> {
        try {
            await previousStop;
            if (!this.isCurrent(session)) return;
            await this.options.beforeStart?.(session.abort.signal);
            if (!this.isCurrent(session)) return;
            this.accept(session, this.sampleAnimation(session));
            const transforms = await session.script.start(session.scene, project.scripts);
            if (!this.isCurrent(session)) return;
            this.accept(session, transforms);
            // Keep the resolved instance even after cancellation so teardown can release late work.
            session.components =
                (await this.options.createComponents?.(
                    session.scene,
                    project,
                    session.abort.signal
                )) ?? null;
            if (!this.isCurrent(session)) return;
            this.executeCommands(session);
            if (session.pauseRequested) {
                session.components?.pause?.();
                this.changeState('paused');
            } else {
                session.components?.resume?.();
                this.changeState('playing');
                this.schedule();
            }
        } catch (error) {
            if (this.isCurrent(session)) this.fail(error);
        }
    }

    pause(): void {
        if (this.stateValue === 'starting' && this.session) {
            this.session.pauseRequested = true;
            return;
        }
        if (this.stateValue !== 'playing') return;
        ++this.clockGeneration;
        cancelAnimationFrame(this.frame);
        try {
            this.session?.components?.pause?.();
            this.changeState('paused');
        } catch (error) {
            this.fail(error);
        }
    }

    async step(): Promise<void> {
        if (this.stateValue === 'stopped') {
            await this.play();
            this.pause();
        }
        if (this.stateValue === 'playing') this.pause();
        const session = this.session;
        if (this.stateValue !== 'paused' || !session) return;
        await session.advancing;
        if (!this.isCurrent(session) || this.state !== 'paused') return;
        await this.advance(session, FIXED_STEP);
    }

    /** Stop scheduling immediately; waitForStop/dispose wait for script hooks and late async cleanup. */
    stop(): void {
        const session = this.session;
        if (!session) return;
        const wasStarting = this.stateValue === 'starting';
        this.session = null;
        // Active components stay alive for the bounded script stop hook; preparation cancels now.
        if (wasStarting) session.abort.abort();
        ++this.clockGeneration;
        cancelAnimationFrame(this.frame);
        this.accumulator = 0;
        this.time = 0;
        this.changeState('stopped');
        try {
            session.components?.pause?.();
        } catch (error) {
            this.logStopError(error);
        }
        // stop() cancels a pending worker command, or executes a bounded stop hook when idle.
        const scriptStop = session.script.stop(session.scene).catch((error: unknown) => {
            this.logStopError(error);
        });
        this.stopping = this.finishStop(session, scriptStop);
    }

    private async finishStop(session: PlaySession, scriptStop: Promise<void>): Promise<void> {
        try {
            await Promise.all([scriptStop, session.starting, session.advancing]);
            session.abort.abort();
            await session.components?.stop();
        } catch (error) {
            this.logStopError(error);
        } finally {
            session.script.dispose();
            // A following play waits on this cleanup before applying its own initial state.
            this.options.onRestore();
        }
    }

    waitForStop(): Promise<void> {
        return this.stopping;
    }

    async dispose(): Promise<void> {
        this.stop();
        await this.waitForStop();
    }

    async reset(): Promise<void> {
        const paused = this.stateValue === 'paused';
        this.stop();
        await this.waitForStop();
        await this.play();
        if (paused) this.pause();
    }

    setInput(input: ScriptInput): void {
        this.session?.script.setInput(input);
    }

    private isCurrent(session: PlaySession): boolean {
        return this.session === session && !session.abort.signal.aborted;
    }

    private schedule(): void {
        const generation = ++this.clockGeneration;
        this.lastFrame = performance.now();
        this.frame = requestAnimationFrame(time => {
            this.tick(time, generation);
        });
    }

    private tick(time: number, generation: number): void {
        const session = this.session;
        if (generation !== this.clockGeneration || this.stateValue !== 'playing' || !session)
            return;
        this.accumulator = Math.min(
            0.05,
            this.accumulator + Math.max(0, (time - this.lastFrame) / 1000)
        );
        this.lastFrame = time;
        void this.advanceFrame(session, generation).then(() => {
            if (
                generation === this.clockGeneration &&
                this.isCurrent(session) &&
                this.stateValue === 'playing'
            )
                this.frame = requestAnimationFrame(nextTime => {
                    this.tick(nextTime, generation);
                });
        });
    }

    private async advanceFrame(session: PlaySession, generation: number): Promise<void> {
        await session.advancing;
        while (
            this.accumulator + Number.EPSILON >= FIXED_STEP &&
            generation === this.clockGeneration &&
            this.isCurrent(session) &&
            this.stateValue === 'playing'
        ) {
            this.accumulator -= FIXED_STEP;
            await this.advance(session, FIXED_STEP);
        }
    }

    private async advance(session: PlaySession, dt: number): Promise<void> {
        if (session.advancing || !this.isCurrent(session)) return;
        const advance = this.advanceSession(session, dt);
        session.advancing = advance;
        try {
            await advance;
        } finally {
            if (session.advancing === advance) session.advancing = null;
        }
    }

    private async advanceSession(session: PlaySession, dt: number): Promise<void> {
        try {
            session.time += dt;
            this.time = session.time;
            const animated = this.sampleAnimation(session);
            const changes = await session.script.step(session.scene, dt, session.time);
            if (!this.isCurrent(session)) return;
            this.accept(session, { ...animated, ...changes });
            this.executeCommands(session);
            const componentChanges = await session.components?.step(
                dt,
                session.time,
                session.scene
            );
            if (!this.isCurrent(session)) return;
            if (componentChanges) this.accept(session, componentChanges);
            this.options.onState(this.stateValue, this.time);
        } catch (error) {
            if (this.isCurrent(session)) this.fail(error);
        }
    }

    private executeCommands(session: PlaySession): void {
        const commands = session.script.takeCommands();
        if (!commands.length) return;
        if (!session.components?.executeCommands)
            throw new Error('This player has no component command runtime.');
        session.components.executeCommands(commands);
    }

    private sampleAnimation(session: PlaySession): Transforms {
        const changes: Transforms = {};
        if (!session.clip) return changes;
        const sample = evaluateClip(session.clip, session.authored, session.time);
        for (const track of session.clip.tracks) {
            const [property, axis] = track.property.split('.');
            const target = session.scene.nodes[track.nodeId];
            const source = sample[track.nodeId];
            if (!target || !source) continue;
            if (
                (property === 'position' || property === 'rotation' || property === 'scale') &&
                (axis === 'x' || axis === 'y' || axis === 'z')
            )
                target.transform[property][axis] = source[property][axis];
            changes[track.nodeId] = target.transform;
        }
        return changes;
    }

    private accept(session: PlaySession, transforms: Transforms): void {
        for (const [id, value] of Object.entries(transforms)) {
            const node = session.scene.nodes[id];
            if (node) node.transform = structuredClone(value);
        }
        this.options.onTransforms(transforms);
    }

    private changeState(state: PlayState): void {
        this.stateValue = state;
        this.options.onState(state, this.time);
    }

    private logStopError(error: unknown): void {
        this.options.onLog(`Stop hook: ${error instanceof Error ? error.message : String(error)}`);
    }

    private fail(error: unknown): void {
        this.stop();
        this.options.onError(error instanceof Error ? error.message : String(error));
    }
}
