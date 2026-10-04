import { evaluateClip, type AnimationClip } from './animation';
import { cloneScene, type SceneDocument, type SceneNode } from './scene';
import type { ProjectDocument } from './project';
import { ScriptRuntime, type ScriptInput } from './script-runtime';

export type PlayState = 'stopped' | 'starting' | 'playing' | 'paused';
export interface PlayControllerOptions {
    getProject: () => ProjectDocument;
    getClipId: () => string | null;
    onTransforms: (transforms: Record<string, SceneNode['transform']>) => void;
    onRestore: () => void;
    onState: (state: PlayState, time: number) => void;
    onLog: (message: string) => void;
    onError: (message: string) => void;
}

/** Isolated runtime state, driven one bounded script step at a time; Stop always restores authoring. */
export class PlayController {
    private runtime: ScriptRuntime | null = null;
    private authored: SceneDocument | null = null;
    private scene: SceneDocument | null = null;
    private clip: AnimationClip | null = null;
    private animationChanges: Record<string, SceneNode['transform']> = {};
    private stateValue: PlayState = 'stopped';
    private time = 0;
    private generation = 0;
    private frame = 0;
    private lastFrame = 0;
    private stepping = false;
    constructor(private readonly options: PlayControllerOptions) {}
    get state(): PlayState {
        return this.stateValue;
    }
    get active(): boolean {
        return this.stateValue !== 'stopped';
    }
    async play(): Promise<void> {
        if (this.stateValue === 'paused') {
            this.changeState('playing');
            this.schedule();
            return;
        }
        if (this.active) return;
        const generation = ++this.generation;
        const project = this.options.getProject();
        const source = project.scenes[project.activeSceneId];
        if (!source) throw new Error('Active scene is missing.');
        this.authored = cloneScene(source);
        this.scene = cloneScene(source);
        const clipId = this.options.getClipId();
        const clip = clipId ? project.clips[clipId] : undefined;
        this.clip = clip?.sceneId === project.activeSceneId ? structuredClone(clip) : null;
        this.time = 0;
        this.changeState('starting');
        this.runtime = new ScriptRuntime(this.options.onLog);
        try {
            this.applyAnimation();
            const transforms = await this.runtime.start(this.scene, project.scripts);
            if (generation !== this.generation) return;
            this.accept(transforms);
            this.changeState('playing');
            this.schedule();
        } catch (error) {
            if (generation === this.generation) this.fail(error);
        }
    }
    pause(): void {
        if (this.stateValue !== 'playing') return;
        cancelAnimationFrame(this.frame);
        this.changeState('paused');
    }
    async step(): Promise<void> {
        if (this.stateValue === 'stopped') {
            await this.play();
            this.pause();
        }
        if (this.stateValue === 'playing') this.pause();
        if (this.stateValue !== 'paused' || this.stepping) return;
        await this.advance(1 / 60);
    }
    stop(): void {
        ++this.generation;
        cancelAnimationFrame(this.frame);
        const runtime = this.runtime;
        const scene = this.scene;
        if (runtime && scene)
            void runtime.stop(scene).catch((error: unknown) => {
                this.options.onLog(
                    `Stop hook: ${error instanceof Error ? error.message : String(error)}`
                );
            });
        else runtime?.dispose();
        this.runtime = null;
        this.scene = null;
        this.authored = null;
        this.clip = null;
        this.stepping = false;
        this.time = 0;
        this.changeState('stopped');
        this.options.onRestore();
    }
    setInput(input: ScriptInput): void {
        this.runtime?.setInput(input);
    }
    private schedule(): void {
        this.lastFrame = performance.now();
        this.frame = requestAnimationFrame(this.tick);
    }
    private readonly tick = (time: number): void => {
        if (this.stateValue !== 'playing') return;
        const dt = Math.max(0, Math.min(0.05, (time - this.lastFrame) / 1000));
        this.lastFrame = time;
        void this.advance(dt).then(() => {
            if (this.stateValue === 'playing') this.frame = requestAnimationFrame(this.tick);
        });
    };
    private async advance(dt: number): Promise<void> {
        const generation = this.generation;
        const runtime = this.runtime;
        const scene = this.scene;
        if (!runtime || !scene || this.stepping) return;
        this.stepping = true;
        try {
            this.time += dt;
            this.applyAnimation();
            const changes = await runtime.step(scene, dt, this.time);
            if (generation !== this.generation) return;
            this.accept(changes);
            this.options.onState(this.stateValue, this.time);
        } catch (error) {
            if (generation === this.generation) this.fail(error);
        } finally {
            if (generation === this.generation) this.stepping = false;
        }
    }
    private applyAnimation(): void {
        this.animationChanges = {};
        if (!this.clip || !this.authored || !this.scene) return;
        const sample = evaluateClip(this.clip, this.authored, this.time);
        for (const track of this.clip.tracks) {
            const [property, axis] = track.property.split('.');
            const target = this.scene.nodes[track.nodeId];
            const source = sample[track.nodeId];
            if (!target || !source) continue;
            if (
                (property === 'position' || property === 'rotation' || property === 'scale') &&
                (axis === 'x' || axis === 'y' || axis === 'z')
            )
                target.transform[property][axis] = source[property][axis];
            this.animationChanges[track.nodeId] = target.transform;
        }
    }
    private accept(transforms: Record<string, SceneNode['transform']>): void {
        if (!this.scene) return;
        for (const [id, value] of Object.entries(transforms)) {
            const node = this.scene.nodes[id];
            if (node) node.transform = structuredClone(value);
        }
        this.options.onTransforms({ ...this.animationChanges, ...transforms });
    }
    private changeState(state: PlayState): void {
        this.stateValue = state;
        this.options.onState(state, this.time);
    }
    private fail(error: unknown): void {
        this.stop();
        this.options.onError(error instanceof Error ? error.message : String(error));
    }
}
