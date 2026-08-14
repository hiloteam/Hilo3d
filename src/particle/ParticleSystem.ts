import type Camera from '../camera/Camera';
import Node, { type NodeParameters } from '../core/Node';
import Matrix4 from '../math/Matrix4';
import Vector3 from '../math/Vector3';
import type { Renderer } from '../render/Renderer';
import type { RendererContract } from '../render/RendererCore';
import type { RenderPipelineContext } from '../render/pipeline/RenderPipeline';
import type { RenderGraphTextureHandle } from '../render/pipeline/ScriptableRenderGraph';
import {
    compileParticleSystemDefinition,
    type ParticleCompilationEnvironment
} from './ParticleCompiler';
import type { ParticleCompiledEmitterPlan, ParticleCompiledPlan } from './ParticleCompiledPlan';
import type ParticleSystemDefinition from './ParticleSystemDefinition';
import type { ParticleScalarValue, ParticleVector3 } from './ParticleTypes';
import { ParticleCPUInstanceWriter } from './cpu/ParticleCPUInstanceWriter';
import {
    ParticleCPUSimulator,
    type ParticleEmitterFrameContext,
    type ParticleManualEmitCommand
} from './cpu/ParticleCPUSimulator';
import { ParticleGPUEmitterRuntime } from './gpu/ParticleGPURuntime';
import { ParticleGPUSpawnController } from './gpu/ParticleGPUSpawnController';
import { ParticleStatelessRuntime } from './stateless/ParticleStatelessRuntime';

interface ParticleStage extends Node {
    readonly isStage: true;
    readonly cameras: readonly Camera[];
}

interface ParticleEmitterRuntime {
    readonly plan: Readonly<ParticleCompiledEmitterPlan>;
    readonly simulator: ParticleCPUSimulator | ParticleStatelessRuntime | null;
    readonly gpuController: ParticleGPUSpawnController | null;
    gpuRuntime: ParticleGPUEmitterRuntime | null;
    readonly writers: readonly ParticleCPUInstanceWriter[];
    culledSeconds: number;
    stoppedByCulling: boolean;
}

/** Construction parameters for a runtime particle scene node. */
export interface ParticleSystemParameters extends NodeParameters {
    readonly definition: ParticleSystemDefinition;
    readonly seed?: number;
    readonly autoPlay?: boolean;
    readonly timeScale?: number;
    /** Optional compile target. Omit for a portable CPU-first plan. */
    readonly compilationEnvironment?: Readonly<ParticleCompilationEnvironment>;
}

/** Options for an explicit particle simulation advance. */
export interface ParticleSystemSimulateOptions {
    readonly fixedStep?: number;
}

/** Deterministic manual emission targeting the first or a named emitter. */
export interface ParticleSystemEmitCommand {
    readonly emitter?: string;
    readonly count: number;
    readonly position?: ParticleVector3;
    readonly velocity?: ParticleVector3;
}

function requireSeed(value: number | undefined): number {
    const seed = value ?? 0;
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
        throw new RangeError('ParticleSystem seed must be an unsigned 32-bit integer');
    }
    return seed >>> 0;
}

function isParticleStage(node: Node): node is ParticleStage {
    return Reflect.get(node, 'isStage') === true && Array.isArray(Reflect.get(node, 'cameras'));
}

function maximumScalar(value: ParticleScalarValue | undefined, fallback: number): number {
    if (value === undefined) return fallback;
    return typeof value === 'number' ? value : value.max;
}

/** Runtime scene node for immutable compiled particle-system definitions. */
class ParticleSystem extends Node {
    static override readonly typeName = 'ParticleSystem';
    override className = 'ParticleSystem';
    readonly definition: ParticleSystemDefinition;
    readonly compiledPlan: Readonly<ParticleCompiledPlan>;
    readonly seed: number;
    readonly #runtimes: readonly ParticleEmitterRuntime[];
    readonly #compilationEnvironment: Readonly<ParticleCompilationEnvironment>;
    readonly #contextPosition: [number, number, number] = [0, 0, 0];
    readonly #context: ParticleEmitterFrameContext = { position: this.#contextPosition };
    readonly #cameraPosition: [number, number, number] = [0, 0, 0];
    readonly #inverseWorld = new Matrix4();
    readonly #cameraVector = new Vector3();
    #playing: boolean;
    #timeScale = 1;
    #elapsedSeconds = 0;
    #completed = false;
    #gpuRenderer: RendererContract | null = null;

    constructor(parameters: Readonly<ParticleSystemParameters>) {
        const input: unknown = parameters;
        if (
            typeof input !== 'object' ||
            input === null ||
            Reflect.get(input, 'definition') === undefined
        ) {
            throw new TypeError('ParticleSystem requires an immutable definition');
        }
        super(parameters);
        this.definition = parameters.definition;
        this.seed = requireSeed(parameters.seed);
        this.timeScale = parameters.timeScale ?? 1;
        this.#compilationEnvironment = Object.freeze({
            ...(parameters.compilationEnvironment ?? {})
        });
        this.compiledPlan = compileParticleSystemDefinition(
            this.definition,
            this.#compilationEnvironment
        );
        const runtimes = this.compiledPlan.emitters.map(plan => this.createRuntime(plan));
        this.#runtimes = Object.freeze(runtimes);
        for (const runtime of runtimes) {
            for (const writer of runtime.writers) this.addChild(writer.mesh);
        }
        this.#playing = parameters.autoPlay ?? true;
        this.enableUpdateHook();
        if (this.#playing) this.prewarmEmitters();
        this.syncWriters();
    }

    /** Whether Stage updates currently advance this particle system. */
    get playing(): boolean {
        return this.#playing;
    }

    /** Scaled runtime age in seconds, excluding prewarm. */
    get elapsedSeconds(): number {
        return this.#elapsedSeconds;
    }

    /** Total dense alive count across CPU/stateless emitters; GPU plans avoid count readback. */
    get aliveCount(): number {
        let count = 0;
        for (const runtime of this.#runtimes) count += runtime.simulator?.state.aliveCount ?? 0;
        return count;
    }

    /** Whether the compiled system contains renderer-owned stateful WebGPU emitters. @internal */
    get hasGPUEmitters(): boolean {
        return this.#runtimes.some(runtime => runtime.gpuController !== null);
    }

    /** True after all non-looping emitters finished and their dense alive ranges became empty. */
    get completed(): boolean {
        return this.#completed;
    }

    get timeScale(): number {
        return this.#timeScale;
    }

    set timeScale(value: number) {
        if (!Number.isFinite(value) || value < 0) {
            throw new RangeError('ParticleSystem timeScale must be finite and non-negative');
        }
        this.#timeScale = value;
    }

    play(): this {
        if (!this.#completed) this.#playing = true;
        return this;
    }

    pause(): this {
        this.#playing = false;
        return this;
    }

    stop(): this {
        this.#playing = false;
        this.#elapsedSeconds = 0;
        this.#completed = false;
        for (const runtime of this.#runtimes) {
            runtime.simulator?.restart();
            if (runtime.gpuRuntime) runtime.gpuRuntime.restart();
            else runtime.gpuController?.restart();
            runtime.stoppedByCulling = false;
            runtime.culledSeconds = 0;
        }
        this.syncWriters();
        return this;
    }

    restart(): this {
        this.stop();
        this.#playing = true;
        this.prewarmEmitters();
        this.syncWriters();
        return this;
    }

    /** Advance explicitly in seconds even when playback is paused. */
    simulate(seconds: number, options: Readonly<ParticleSystemSimulateOptions> = {}): this {
        if (!Number.isFinite(seconds) || seconds < 0) {
            throw new RangeError('ParticleSystem simulate seconds must be finite and non-negative');
        }
        this.updateWorldContext();
        this.advance(seconds, options.fixedStep);
        this.syncWriters();
        this.updateCompletion();
        return this;
    }

    /** Queue deterministic manual emission on the first or named emitter. */
    emit(count: number, emitter?: string): this;
    emit(command: Readonly<ParticleSystemEmitCommand>): this;
    emit(commandOrCount: number | Readonly<ParticleSystemEmitCommand>, emitterName?: string): this {
        const command =
            typeof commandOrCount === 'number'
                ? ({ count: commandOrCount } as const)
                : commandOrCount;
        const targetName = emitterName ?? command.emitter;
        const runtime =
            targetName === undefined
                ? this.#runtimes[0]
                : this.#runtimes.find(candidate => candidate.plan.definition.name === targetName);
        if (!runtime)
            throw new RangeError(`Particle emitter ${targetName ?? '<first>'} is unavailable`);
        const manual: ParticleManualEmitCommand = {
            count: command.count,
            ...(command.position === undefined ? {} : { position: command.position }),
            ...(command.velocity === undefined ? {} : { velocity: command.velocity })
        };
        if (runtime.simulator) runtime.simulator.emit(manual);
        else if (runtime.gpuController) runtime.gpuController.emit(manual);
        else throw new Error(`Particle emitter ${runtime.plan.definition.name} has no runtime`);
        return this;
    }

    /** Dispatch a named gameplay event without admitting arbitrary simulation callbacks. */
    sendEvent(name: string, payload?: unknown): this {
        if (!/^[A-Za-z_][A-Za-z0-9_.:-]*$/u.test(name)) {
            throw new TypeError('Particle event name is invalid');
        }
        this.fire('particle-event', Object.freeze({ name, payload }));
        return this;
    }

    /** Deterministic dense-state hash for replay and regression tests. */
    stateHash(emitter?: string): string {
        const runtimes =
            emitter === undefined
                ? this.#runtimes
                : this.#runtimes.filter(runtime => runtime.plan.definition.name === emitter);
        if (runtimes.length === 0) {
            throw new RangeError(`Particle emitter ${emitter ?? '<all>'} is unavailable`);
        }
        return runtimes.map(runtime => runtime.simulator?.state.hash() ?? 'gpu').join(':');
    }

    override update(deltaTimeMilliseconds: number): void {
        if (!this.#playing || this.#completed || this.#timeScale === 0) {
            this.syncWriters();
            return;
        }
        const seconds = (deltaTimeMilliseconds * this.#timeScale) / 1000;
        if (!Number.isFinite(seconds) || seconds < 0) {
            throw new RangeError('ParticleSystem Stage delta time must be finite and non-negative');
        }
        this.updateWorldContext();
        this.advanceWithCulling(seconds);
        this.#elapsedSeconds = Math.fround(this.#elapsedSeconds + seconds);
        this.syncWriters();
        this.updateCompletion();
    }

    override clone(isChild?: boolean): ParticleSystem {
        const clone = new ParticleSystem({
            definition: this.definition,
            seed: this.seed,
            autoPlay: this.#playing,
            timeScale: this.#timeScale,
            compilationEnvironment: this.#compilationEnvironment
        });
        clone.name = this.name;
        clone.layer = this.layer;
        clone.setPosition(this.x, this.y, this.z);
        clone.setScale(this.scaleX, this.scaleY, this.scaleZ);
        clone.setRotation(this.rotationX, this.rotationY, this.rotationZ);
        if (isChild) {
            for (const child of this.children) {
                if (!child.isMesh) clone.addChild(child.clone(true));
            }
        }
        return clone;
    }

    override destroy(renderer?: Renderer, destroyTextures = false): this {
        if (!renderer && this.#runtimes.some(runtime => runtime.writers.length > 0)) {
            throw new Error('A renderer is required to destroy a ParticleSystem render bridge');
        }
        for (const runtime of this.#runtimes) {
            runtime.gpuRuntime?.destroy();
            runtime.gpuRuntime = null;
        }
        this.#gpuRenderer = null;
        return super.destroy(renderer, destroyTextures);
    }

    /** Allocate renderer-owned GPU state before the renderer enters its frame transaction. @internal */
    prepareGPU(renderer: RendererContract): void {
        if (!this.hasGPUEmitters) return;
        if (this.#gpuRenderer !== null && this.#gpuRenderer !== renderer) {
            throw new Error('One GPU ParticleSystem cannot be attached to multiple Renderers');
        }
        if (renderer.backend !== 'webgpu') {
            throw new TypeError('GPU ParticleSystem execution requires a WebGPU Renderer');
        }
        this.#gpuRenderer = renderer;
        for (const runtime of this.#runtimes) {
            const controller = runtime.gpuController;
            if (controller === null || runtime.gpuRuntime !== null) continue;
            runtime.gpuRuntime = new ParticleGPUEmitterRuntime(
                runtime.plan,
                this.seed,
                this.definition.hash,
                renderer,
                controller
            );
        }
    }

    /** Record GPU simulation and storage-raster passes through the active Forward graph. @internal */
    recordGPU(
        context: RenderPipelineContext,
        color: RenderGraphTextureHandle,
        depth: RenderGraphTextureHandle | null,
        drawVisible: boolean
    ): void {
        for (const runtime of this.#runtimes) {
            if (runtime.gpuController === null) continue;
            const gpuRuntime = runtime.gpuRuntime;
            if (gpuRuntime === null) {
                throw new Error(
                    'GPU ParticleSystem resources were not prepared before Render Graph recording'
                );
            }
            gpuRuntime.record(context, color, depth, this, drawVisible);
        }
    }

    /** Commit staged GPU clocks only after the enclosing graph submission succeeds. @internal */
    gpuFrameSubmitted(frameIndex: number): void {
        for (const runtime of this.#runtimes) runtime.gpuRuntime?.frameSubmitted(frameIndex);
    }

    /** Preserve queued GPU commands and roll the double-buffer index back on failure. @internal */
    gpuFrameDiscarded(frameIndex: number): void {
        for (const runtime of this.#runtimes) runtime.gpuRuntime?.frameDiscarded(frameIndex);
    }

    private createRuntime(plan: Readonly<ParticleCompiledEmitterPlan>): ParticleEmitterRuntime {
        if (plan.kind === 'gpu-stateful') {
            return {
                plan,
                simulator: null,
                gpuController: new ParticleGPUSpawnController(
                    plan.definition,
                    this.seed,
                    plan.emitterId
                ),
                gpuRuntime: null,
                writers: Object.freeze([]),
                culledSeconds: 0,
                stoppedByCulling: false
            };
        }
        const simulator =
            plan.kind === 'stateless'
                ? new ParticleStatelessRuntime(plan, this.seed)
                : new ParticleCPUSimulator(plan, this.seed);
        const writers = plan.definition.renderers.map(
            (renderer, index) =>
                new ParticleCPUInstanceWriter(plan, simulator.state, renderer, index)
        );
        return {
            plan,
            simulator,
            gpuController: null,
            gpuRuntime: null,
            writers: Object.freeze(writers),
            culledSeconds: 0,
            stoppedByCulling: false
        };
    }

    private updateWorldContext(): void {
        if (this.parent) {
            let root = this.parent;
            while (root.parent) root = root.parent;
            root.updateMatrixWorld(true);
        } else {
            this.updateMatrixWorld(true);
        }
        const elements = this.worldMatrix.elements;
        this.#contextPosition[0] = elements[12];
        this.#contextPosition[1] = elements[13];
        this.#contextPosition[2] = elements[14];
    }

    private advance(seconds: number, fixedStep?: number): void {
        for (const runtime of this.#runtimes) {
            if (runtime.simulator) {
                runtime.simulator.simulate(seconds, this.#context, fixedStep);
            } else if (runtime.gpuController) {
                runtime.gpuController.advance(seconds, this.#context, fixedStep);
            }
        }
    }

    private advanceWithCulling(seconds: number): void {
        const stage = this.findStage();
        for (const runtime of this.#runtimes) {
            const simulator = runtime.simulator;
            const gpuController = runtime.gpuController;
            if ((!simulator && !gpuController) || runtime.stoppedByCulling) continue;
            const visible = this.runtimeVisible(runtime, stage);
            switch (runtime.plan.definition.culling) {
                case 'render-only':
                    if (simulator) simulator.simulate(seconds, this.#context);
                    else gpuController?.advance(seconds, this.#context);
                    break;
                case 'pause':
                    if (visible) {
                        if (simulator) simulator.simulate(seconds, this.#context);
                        else gpuController?.advance(seconds, this.#context);
                    }
                    break;
                case 'pause-and-catch-up':
                    if (visible) {
                        if (simulator) {
                            simulator.simulate(seconds + runtime.culledSeconds, this.#context);
                        } else {
                            gpuController?.advance(seconds + runtime.culledSeconds, this.#context);
                        }
                        runtime.culledSeconds = 0;
                    } else {
                        runtime.culledSeconds = Math.min(
                            runtime.culledSeconds + seconds,
                            runtime.plan.definition.fixedStep *
                                runtime.plan.definition.maxCatchUpSteps
                        );
                    }
                    break;
                case 'stop':
                    if (visible) {
                        if (simulator) simulator.simulate(seconds, this.#context);
                        else gpuController?.advance(seconds, this.#context);
                    } else {
                        simulator?.clear();
                        if (runtime.gpuRuntime) runtime.gpuRuntime.restart();
                        else gpuController?.restart();
                        runtime.stoppedByCulling = true;
                    }
                    break;
            }
        }
    }

    private runtimeVisible(runtime: ParticleEmitterRuntime, stage: ParticleStage | null): boolean {
        if (stage === null) return true;
        if (runtime.writers.length === 0) {
            return this.visible && stage.cameras.some(camera => camera.isLayerVisible(this));
        }
        if ((runtime.simulator?.state.aliveCount ?? 0) === 0) return true;
        for (const camera of stage.cameras) {
            camera.updateViewProjectionMatrix();
            for (const writer of runtime.writers) {
                writer.mesh.layer = this.layer;
                if (camera.isLayerVisible(writer.mesh) && camera.isMeshVisible(writer.mesh))
                    return true;
            }
        }
        return false;
    }

    private syncWriters(): void {
        const stage = this.findStage();
        const camera = stage?.cameras[0];
        const cameraElements = camera?.worldMatrix.elements;
        const cameraX = cameraElements?.[12] ?? camera?.x ?? 0;
        const cameraY = cameraElements?.[13] ?? camera?.y ?? 0;
        const cameraZ = cameraElements?.[14] ?? camera?.z ?? 0;
        for (const runtime of this.#runtimes) {
            this.#cameraVector.set(cameraX, cameraY, cameraZ);
            if (runtime.plan.definition.simulationSpace === 'local') {
                this.#inverseWorld.invert(this.worldMatrix);
                this.#cameraVector.transformMat4(this.#inverseWorld);
            }
            this.#cameraPosition[0] = this.#cameraVector.x;
            this.#cameraPosition[1] = this.#cameraVector.y;
            this.#cameraPosition[2] = this.#cameraVector.z;
            for (const writer of runtime.writers) {
                writer.mesh.layer = this.layer;
                if (runtime.plan.definition.simulationSpace === 'world') {
                    writer.mesh.worldMatrix.identity();
                }
                writer.sync(this.#cameraPosition);
            }
        }
    }

    private prewarmEmitters(): void {
        this.updateWorldContext();
        for (const runtime of this.#runtimes) {
            const simulator = runtime.simulator;
            const gpuController = runtime.gpuController;
            if ((!simulator && !gpuController) || !runtime.plan.definition.prewarm) continue;
            const fixedStep = runtime.plan.definition.fixedStep;
            const steps = Math.ceil(runtime.plan.definition.duration / fixedStep);
            for (let index = 0; index < steps; index += 1) {
                if (simulator) simulator.simulate(fixedStep, this.#context, fixedStep);
                else gpuController?.advance(fixedStep, this.#context, fixedStep);
            }
        }
    }

    private updateCompletion(): void {
        if (
            this.#runtimes.every(runtime => {
                const simulator = runtime.simulator;
                const gpuController = runtime.gpuController;
                const maximumLifetime = maximumScalar(
                    runtime.plan.definition.initialize.lifetime,
                    1
                );
                return (
                    runtime.plan.definition.looping ||
                    (simulator !== null
                        ? simulator.emitterAge >=
                              runtime.plan.definition.startDelay +
                                  runtime.plan.definition.duration &&
                          simulator.state.aliveCount === 0
                        : gpuController !== null &&
                          gpuController.emitterAge >=
                              runtime.plan.definition.startDelay +
                                  runtime.plan.definition.duration +
                                  maximumLifetime)
                );
            }) &&
            this.#runtimes.every(runtime => !runtime.plan.definition.looping)
        ) {
            this.#completed = true;
            this.#playing = false;
            this.fire('complete');
        }
    }

    private findStage(): ParticleStage | null {
        let current: Node | null = this.parent;
        while (current) {
            if (isParticleStage(current)) return current;
            current = current.parent;
        }
        return null;
    }
}

export default ParticleSystem;
