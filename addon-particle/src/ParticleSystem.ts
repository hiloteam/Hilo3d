import {
    Matrix4,
    Node,
    RENDER_NODE_EXTENSION,
    Sphere,
    Vector3,
    type Camera,
    type NodeParameters,
    type Renderer,
    type RendererContract,
    type RenderNodeExtension,
    type RenderNodeGPUExtension,
    type RenderGraphTextureHandle,
    type RenderPipelineContext,
    type RenderTargetColorAttachmentReadback
} from 'hilo3d';
import {
    compileParticleSystemDefinition,
    type ParticleCompilationEnvironment
} from './ParticleCompiler.js';
import type { ParticleCompiledEmitterPlan, ParticleCompiledPlan } from './ParticleCompiledPlan.js';
import type { ParticleBudgetDecision, ParticleBudgetRequest } from './ParticleBudget.js';
import {
    createParticleBakeTimeline,
    createParticleFlipbook,
    createParticleMeshCache,
    ParticleMeshCacheBuilder,
    type ParticleFlipbook,
    type ParticleFlipbookOptions,
    type ParticleMeshCache,
    type ParticleMeshCacheOptions
} from './ParticleBaking.js';
import type ParticleSystemDefinition from './ParticleSystemDefinition.js';
import { ParticleParameterSet, resolveParticleParameter } from './ParticleParameter.js';
import {
    createParticleSimulationCache,
    readParticleSimulationCache,
    type ParticleEmitterSimulationSnapshot,
    type ParticleSimulationCache,
    type ParticleSystemSimulationSnapshot
} from './ParticleSimulationCache.js';
import type { ParticleScalarSource, ParticleVector3 } from './ParticleTypes.js';
import { createParticleCPUWriters, type ParticleCPUWriter } from './cpu/ParticleCPUWriter.js';
import {
    ParticleCPUSimulator,
    type ParticleEmitterFrameContext,
    type ParticleManualEmitCommand
} from './cpu/ParticleCPUSimulator.js';
import type { ParticleEventAggregate, ParticleEventRecord } from './cpu/ParticleCPUEventBuffer.js';
import { ParticleGPUEmitterRuntime } from './gpu/ParticleGPURuntime.js';
import { ParticleGPUSpawnController } from './gpu/ParticleGPUSpawnController.js';
import { ParticleStatelessRuntime } from './stateless/ParticleStatelessRuntime.js';
import { particleStatelessGPUBlockingDiagnostics } from './stateless/ParticleStatelessGPUPlan.js';
import { ParticleStatelessGPUEmitterRuntime } from './stateless/ParticleStatelessGPURuntime.js';

interface ParticleStage extends Node {
    readonly isStage: true;
    readonly cameras: readonly Camera[];
}

interface ParticleEmitterRuntime {
    readonly plan: Readonly<ParticleCompiledEmitterPlan>;
    simulator: ParticleCPUSimulator | ParticleStatelessRuntime | null;
    readonly gpuController: ParticleGPUSpawnController | null;
    gpuRuntime: ParticleGPUEmitterRuntime | null;
    statelessGPURuntime: ParticleStatelessGPUEmitterRuntime | null;
    readonly statelessGPUCapable: boolean;
    statelessGPUActive: boolean;
    statelessAge: number;
    writers: readonly ParticleCPUWriter[];
    readonly localBounds: Sphere;
    readonly worldBounds: Sphere;
    budgetEnabled: boolean;
    budgetParticleLimit: number;
    budgetSpawnRateScale: number;
    budgetSorting: boolean;
    budgetSoftParticles: boolean;
    budgetCollision: boolean;
    budgetRibbons: boolean;
    culledSeconds: number;
    stoppedByCulling: boolean;
}

let nextParticleBudgetSystemId = 1;

/** Construction parameters for a runtime particle scene node. */
export interface ParticleSystemParameters extends NodeParameters {
    readonly definition: ParticleSystemDefinition;
    readonly seed?: number;
    readonly autoPlay?: boolean;
    readonly timeScale?: number;
    /** Live typed values used by bindable emission and initialization fields. */
    readonly parameters?: ParticleParameterSet;
    /** Stable identifier used by deterministic frame-wide particle budgeting. */
    readonly budgetId?: string;
    /** Higher values win budget allocation before distance and identifier tie-breaks. */
    readonly budgetPriority?: number;
    /** Optional compile target. Omit for a portable CPU-first plan. */
    readonly compilationEnvironment?: Readonly<ParticleCompilationEnvironment>;
    /** Maximum materialized CPU events retained for bounded asynchronous application reads. */
    readonly eventReadbackCapacity?: number;
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

function maximumScalar(
    value: ParticleScalarSource | undefined,
    fallback: number,
    parameters: ParticleParameterSet
): number {
    if (value === undefined) return fallback;
    const source = resolveParticleParameter(value, parameters);
    return typeof source === 'number' ? source : source.max;
}

function particleNodeParameters(
    parameters: Readonly<ParticleSystemParameters>
): Readonly<NodeParameters> {
    const nodeParameters = { ...parameters } as Record<string, unknown>;
    delete nodeParameters['definition'];
    delete nodeParameters['seed'];
    delete nodeParameters['autoPlay'];
    delete nodeParameters['timeScale'];
    delete nodeParameters['parameters'];
    delete nodeParameters['budgetId'];
    delete nodeParameters['budgetPriority'];
    delete nodeParameters['compilationEnvironment'];
    delete nodeParameters['eventReadbackCapacity'];
    return nodeParameters;
}

function snapshotParticleEvent(
    event: Readonly<ParticleEventRecord>
): Readonly<ParticleEventRecord> {
    return Object.freeze({
        name: event.name,
        emitter: event.emitter,
        stableId: event.stableId,
        position: Object.freeze([...event.position] as ParticleVector3),
        velocity: Object.freeze([...event.velocity] as ParticleVector3)
    });
}

/** Runtime scene node for immutable compiled particle-system definitions. */
class ParticleSystem extends Node implements RenderNodeExtension, RenderNodeGPUExtension {
    static override readonly typeName = 'ParticleSystem';
    override className = 'ParticleSystem';
    readonly definition: ParticleSystemDefinition;
    readonly compiledPlan: Readonly<ParticleCompiledPlan>;
    /** Backend targeted by compilation, or undefined for a portable CPU-first plan. */
    readonly compilationBackend: 'webgl2' | 'webgpu' | undefined;
    readonly seed: number;
    readonly parameters: ParticleParameterSet;
    readonly budgetId: string;
    readonly budgetPriority: number;
    readonly #runtimes: readonly ParticleEmitterRuntime[];
    readonly #compilationEnvironment: Readonly<ParticleCompilationEnvironment>;
    readonly #contextPosition: [number, number, number] = [0, 0, 0];
    readonly #context: ParticleEmitterFrameContext = { position: this.#contextPosition };
    readonly #cameraPosition: [number, number, number] = [0, 0, 0];
    readonly #inverseWorld = new Matrix4();
    readonly #cameraVector = new Vector3();
    readonly #eventQueue: Readonly<ParticleEventRecord>[] = [];
    readonly #eventReadbackCapacity: number;
    #playing: boolean;
    #timeScale = 1;
    #elapsedSeconds = 0;
    #completed = false;
    #gpuRenderer: RendererContract | null = null;
    #eventDroppedCount = 0;
    #baking = false;

    /** Renderer extension consumed through Hilo3D's optional node protocol. @internal */
    get [RENDER_NODE_EXTENSION](): RenderNodeExtension {
        return this;
    }

    /** Active GPU graph contribution, or `null` for portable CPU-only systems. @internal */
    get gpu(): RenderNodeGPUExtension | null {
        return this.hasGPUEmitters ? this : null;
    }

    constructor(parameters: Readonly<ParticleSystemParameters>) {
        const input: unknown = parameters;
        if (
            typeof input !== 'object' ||
            input === null ||
            Reflect.get(input, 'definition') === undefined
        ) {
            throw new TypeError('ParticleSystem requires an immutable definition');
        }
        super(particleNodeParameters(parameters));
        this.definition = parameters.definition;
        this.seed = requireSeed(parameters.seed);
        this.parameters = parameters.parameters ?? new ParticleParameterSet();
        this.budgetId =
            parameters.budgetId ??
            `${this.definition.hash}:${String(nextParticleBudgetSystemId++)}`;
        if (!/^[A-Za-z0-9_.:-]+$/u.test(this.budgetId)) {
            throw new TypeError('ParticleSystem budgetId is invalid');
        }
        this.budgetPriority = parameters.budgetPriority ?? 0;
        if (!Number.isFinite(this.budgetPriority)) {
            throw new TypeError('ParticleSystem budgetPriority must be finite');
        }
        this.timeScale = parameters.timeScale ?? 1;
        this.#compilationEnvironment = Object.freeze({
            ...(parameters.compilationEnvironment ?? {})
        });
        this.compilationBackend = this.#compilationEnvironment.backend;
        const eventReadbackCapacity = parameters.eventReadbackCapacity ?? 1024;
        if (
            !Number.isSafeInteger(eventReadbackCapacity) ||
            eventReadbackCapacity < 0 ||
            eventReadbackCapacity > 65_536
        ) {
            throw new RangeError(
                'ParticleSystem eventReadbackCapacity must be between 0 and 65536'
            );
        }
        this.#eventReadbackCapacity = eventReadbackCapacity;
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
        for (const runtime of this.#runtimes) {
            if (!runtime.statelessGPUActive) count += runtime.simulator?.state.aliveCount ?? 0;
        }
        return count;
    }

    /** Whether the compiled system contains renderer-owned stateful WebGPU emitters. @internal */
    get hasGPUEmitters(): boolean {
        return this.#runtimes.some(
            runtime => runtime.gpuController !== null || runtime.statelessGPUActive
        );
    }

    /** Whether a GPU emitter contributes opaque or alpha-masked advanced draws. @internal */
    get hasGPUOpaqueRenderers(): boolean {
        return this.#runtimes.some(
            runtime =>
                runtime.gpuController !== null &&
                runtime.plan.definition.renderers.some(
                    renderer =>
                        renderer.type !== 'sprite' &&
                        (renderer.coverage ?? 'transparent') !== 'transparent'
                )
        );
    }

    /** Whether this system needs a sampled Forward depth texture for GPU simulation/raster. @internal */
    get requiresGPUSampledDepth(): boolean {
        return this.#runtimes.some(
            runtime =>
                runtime.gpuController !== null &&
                (runtime.plan.definition.modules.some(
                    module => module.type === 'scene-depth-collision'
                ) ||
                    runtime.plan.definition.renderers.some(
                        renderer =>
                            (renderer.type === 'sprite' ||
                                renderer.type === 'ribbon' ||
                                renderer.type === 'trail') &&
                            renderer.softParticle !== undefined
                    ))
        );
    }

    /** Whether any GPU emitter has simulation or spawn work waiting for graph recording. @internal */
    get hasPendingGPUWork(): boolean {
        return this.#runtimes.some(
            runtime => runtime.budgetEnabled && runtime.gpuController?.hasPendingWork === true
        );
    }

    /** Whether this node contributes a visible GPU draw for one camera. @internal */
    isGPUVisible(camera: Camera): boolean {
        if (!this.hierarchyVisible() || !camera.isLayerVisible(this)) return false;
        camera.updateViewProjectionMatrix();
        return this.#runtimes.some(
            runtime =>
                runtime.budgetEnabled &&
                (runtime.gpuController !== null || runtime.statelessGPUActive) &&
                this.runtimeBoundsVisible(runtime, camera)
        );
    }

    /** True after all non-looping emitters finished and their dense alive ranges became empty. */
    get completed(): boolean {
        return this.#completed;
    }

    /** Bounded aggregate event diagnostics; no GPU or per-particle synchronous readback occurs. */
    get eventDiagnostics(): Readonly<{ pendingCount: number; droppedCount: number }> {
        return Object.freeze({
            pendingCount: this.#eventQueue.length,
            droppedCount: this.#eventDroppedCount
        });
    }

    /** Build current per-emitter requests for a frame-wide budget allocation. @internal */
    createBudgetRequests(camera?: Camera): readonly Readonly<ParticleBudgetRequest>[] {
        this.updateWorldContext();
        if (camera !== undefined) {
            let cameraRoot: Node = camera;
            while (cameraRoot.parent !== null) cameraRoot = cameraRoot.parent;
            cameraRoot.updateMatrixWorld(true);
            camera.updateViewProjectionMatrix();
        }
        const world = this.worldMatrix.elements;
        const cameraWorld = camera?.worldMatrix.elements;
        const distance =
            cameraWorld === undefined
                ? 0
                : Math.hypot(
                      world[12] - cameraWorld[12],
                      world[13] - cameraWorld[13],
                      world[14] - cameraWorld[14]
                  );
        return Object.freeze(
            this.#runtimes.map(runtime => {
                const definition = runtime.plan.definition;
                const maximumLifetime = maximumScalar(
                    definition.initialize.lifetime,
                    1,
                    this.parameters
                );
                const rate = maximumScalar(definition.emission.rateOverTime, 0, this.parameters);
                const burstCount = (definition.emission.bursts ?? []).reduce(
                    (sum, burst) => sum + burst.count * (burst.cycles ?? 1),
                    0
                );
                const estimatedAlive = runtime.simulator
                    ? runtime.statelessGPUActive
                        ? Math.min(
                              definition.capacity,
                              Math.ceil(Math.max(0, rate) * maximumLifetime) + burstCount
                          )
                        : runtime.simulator.state.aliveCount
                    : Math.min(
                          definition.capacity,
                          Math.ceil(Math.max(0, rate) * maximumLifetime) + burstCount
                      );
                const visible =
                    camera === undefined ||
                    (this.hierarchyVisible() &&
                        camera.isLayerVisible(this) &&
                        this.runtimeBoundsVisible(runtime, camera));
                return Object.freeze({
                    systemId: this.budgetId,
                    emitterId: runtime.plan.emitterId,
                    capacity: definition.capacity,
                    estimatedAlive,
                    priority: this.budgetPriority,
                    distance,
                    visible
                });
            })
        );
    }

    /** Apply one complete set of frame-wide budget decisions. @internal */
    applyBudgetDecisions(decisions: readonly Readonly<ParticleBudgetDecision>[]): this {
        const byEmitter = new Map(decisions.map(decision => [decision.emitterId, decision]));
        for (const decision of decisions) {
            if (decision.systemId !== this.budgetId) {
                throw new TypeError('Particle budget decision belongs to another system');
            }
        }
        for (const runtime of this.#runtimes) {
            const decision = byEmitter.get(runtime.plan.emitterId);
            if (decision === undefined) {
                throw new RangeError(
                    `Particle budget decision for emitter ${String(runtime.plan.emitterId)} is missing`
                );
            }
            runtime.budgetEnabled = decision.enabled;
            runtime.budgetParticleLimit = decision.particleLimit;
            runtime.budgetSpawnRateScale = decision.spawnRateScale;
            runtime.budgetSorting = decision.sorting;
            runtime.budgetSoftParticles = decision.softParticles;
            runtime.budgetCollision = decision.collision;
            runtime.budgetRibbons = decision.ribbons;
            if (runtime.simulator instanceof ParticleStatelessRuntime) {
                runtime.simulator.setBudget(
                    decision.particleLimit,
                    decision.spawnRateScale,
                    decision.collision,
                    !runtime.statelessGPUActive
                );
            } else {
                runtime.simulator?.setBudget(
                    decision.particleLimit,
                    decision.spawnRateScale,
                    decision.collision
                );
            }
            runtime.gpuController?.setBudget(decision.particleLimit, decision.spawnRateScale);
            runtime.gpuRuntime?.setBudget(decision);
            runtime.statelessGPURuntime?.setBudget(decision);
        }
        this.syncWriters();
        return this;
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
        this.#eventQueue.length = 0;
        this.#eventDroppedCount = 0;
        for (const runtime of this.#runtimes) {
            runtime.simulator?.restart();
            if (runtime.gpuRuntime) runtime.gpuRuntime.restart();
            else runtime.gpuController?.restart();
            runtime.stoppedByCulling = false;
            runtime.culledSeconds = 0;
            runtime.statelessGPUActive = runtime.statelessGPUCapable;
            runtime.statelessAge = 0;
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

    /** Reset simulation and authored node state before a pool lease. @internal */
    resetForPool(parameters: Readonly<ParticleSystemParameters>): this {
        const template = new Node(particleNodeParameters(parameters));
        this.stop();
        this.name = template.name;
        this.anim = template.anim;
        this.animationId = template.animationId;
        this.jointName = template.jointName;
        this.autoUpdateWorldMatrix = template.autoUpdateWorldMatrix;
        this.autoUpdateChildWorldMatrix = template.autoUpdateChildWorldMatrix;
        this.needCallChildUpdate = template.needCallChildUpdate;
        this.visible = template.visible;
        this.layer = template.layer;
        this.sortingLayer = template.sortingLayer;
        this.zIndex = template.zIndex;
        this.pointerEnabled = template.pointerEnabled;
        this.pointerChildren = template.pointerChildren;
        this.useHandCursor = template.useHandCursor;
        this.userData = template.userData;
        this.onUpdate = template.onUpdate;
        this.onlySyncQuaternion = template.onlySyncQuaternion;
        this.up.copy(template.up);
        this.setPosition(template.x, template.y, template.z);
        this.setScale(template.scaleX, template.scaleY, template.scaleZ);
        this.setPivot(template.pivotX, template.pivotY, template.pivotZ);
        this.setRotation(template.rotationX, template.rotationY, template.rotationZ);
        this.timeScale = parameters.timeScale ?? 1;
        this.applyBudgetDecisions(
            this.#runtimes.map(runtime => ({
                systemId: this.budgetId,
                emitterId: runtime.plan.emitterId,
                enabled: true,
                particleLimit: runtime.plan.definition.capacity,
                spawnRateScale: 1,
                sorting: true,
                softParticles: true,
                collision: true,
                ribbons: true,
                reasons: Object.freeze([])
            }))
        );
        this.#playing = parameters.autoPlay ?? true;
        if (this.#playing) this.prewarmEmitters();
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
        if (runtime.statelessGPUActive) {
            runtime.statelessGPUActive = false;
            this.materializeStatelessCPU(runtime);
        }
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

    /** Materialize at most `maxEvents` from compact CPU event buffers on an async boundary. */
    async readEvents(maxEvents = this.#eventReadbackCapacity): Promise<ParticleEventAggregate> {
        if (!Number.isSafeInteger(maxEvents) || maxEvents < 0) {
            throw new RangeError('ParticleSystem event read limit must be non-negative');
        }
        const events = this.#eventQueue.splice(0, Math.min(maxEvents, this.#eventQueue.length));
        const counts: Record<string, number> = {};
        for (const event of events) counts[event.name] = (counts[event.name] ?? 0) + 1;
        const droppedCount = this.#eventDroppedCount;
        this.#eventDroppedCount = 0;
        await Promise.resolve();
        return Object.freeze({
            events: Object.freeze(events),
            counts: Object.freeze(counts),
            droppedCount,
            remainingCount: this.#eventQueue.length
        });
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
        return runtimes
            .map(runtime =>
                runtime.statelessGPUActive
                    ? 'gpu-stateless'
                    : (runtime.simulator?.state.hash() ?? 'gpu')
            )
            .join(':');
    }

    /**
     * Bake stable-ID-sorted frame-major instance streams for authored mesh emitters.
     *
     * The system is restored to its exact simulation checkpoint after the synchronous bake.
     */
    bakeMeshCache(options: Readonly<ParticleMeshCacheOptions>): ParticleMeshCache {
        if (this.#baking) throw new Error('ParticleSystem already has an active bake');
        const timeline = createParticleBakeTimeline(options);
        const maxSampledParticles = options.maxSampledParticles ?? 1_048_576;
        if (
            !Number.isSafeInteger(maxSampledParticles) ||
            maxSampledParticles <= 0 ||
            maxSampledParticles > 0xffff_ffff
        ) {
            throw new RangeError(
                'Particle mesh cache maximum sampled particle count must fit uint32 offsets'
            );
        }
        const checkpoint = this.captureSimulation();
        this.#baking = true;
        try {
            this.restart().pause();
            const selected =
                options.emitter === undefined
                    ? this.#runtimes.filter(runtime =>
                          runtime.plan.definition.renderers.some(
                              renderer => renderer.type === 'mesh'
                          )
                      )
                    : this.#runtimes.filter(
                          runtime => runtime.plan.definition.name === options.emitter
                      );
            if (selected.length === 0) {
                throw new RangeError(
                    options.emitter === undefined
                        ? 'Particle system has no mesh emitter to bake'
                        : `Particle emitter ${options.emitter} is unavailable`
                );
            }
            const builders = selected.map(runtime => {
                if (runtime.statelessGPUActive) {
                    runtime.statelessGPUActive = false;
                    this.materializeStatelessCPU(runtime);
                }
                if (runtime.simulator === null) {
                    throw new TypeError(
                        `Particle mesh cache requires CPU-readable emitter ${runtime.plan.definition.name}`
                    );
                }
                return Object.freeze({
                    runtime,
                    builder: new ParticleMeshCacheBuilder(runtime.plan)
                });
            });
            let currentTime = 0;
            let sampledParticles = 0;
            for (const time of timeline.times) {
                this.simulate(Math.max(0, time - currentTime));
                currentTime = time;
                for (const entry of builders) {
                    const simulator = entry.runtime.simulator;
                    if (simulator === null) {
                        throw new Error('Validated particle bake runtime is unavailable');
                    }
                    sampledParticles += simulator.state.aliveCount;
                    if (sampledParticles > maxSampledParticles) {
                        throw new RangeError(
                            `Particle mesh cache sampled particle count exceeds ${String(maxSampledParticles)}`
                        );
                    }
                    entry.builder.append(simulator.state);
                }
            }
            return createParticleMeshCache(
                this.definition.hash,
                this.seed,
                timeline,
                builders.map(entry => entry.builder.finish())
            );
        } finally {
            try {
                this.restoreSimulation(checkpoint);
            } finally {
                this.#baking = false;
            }
        }
    }

    /**
     * Bake real render-target readbacks into a tightly packed flipbook atlas.
     *
     * The callback owns rendering and asynchronous readback; the system owns deterministic timeline
     * advancement and restores its exact checkpoint after completion or failure.
     */
    async bakeFlipbook(options: Readonly<ParticleFlipbookOptions>): Promise<ParticleFlipbook> {
        if (this.#baking) throw new Error('ParticleSystem already has an active bake');
        const timeline = createParticleBakeTimeline(options);
        const checkpoint = this.captureSimulation();
        this.#baking = true;
        try {
            this.restart().pause();
            const frames: RenderTargetColorAttachmentReadback[] = [];
            let currentTime = 0;
            for (let frameIndex = 0; frameIndex < timeline.times.length; frameIndex += 1) {
                const time = timeline.times[frameIndex];
                if (time === undefined) throw new Error('Particle flipbook time is unavailable');
                this.simulate(Math.max(0, time - currentTime));
                currentTime = time;
                const captured = await options.captureFrame(
                    Object.freeze({ system: this, frameIndex, timeSeconds: time })
                );
                frames.push(
                    Object.freeze({
                        data: captured.data.slice(),
                        format: captured.format,
                        width: captured.width,
                        height: captured.height,
                        bytesPerPixel: captured.bytesPerPixel,
                        bytesPerRow: captured.bytesPerRow
                    })
                );
            }
            return createParticleFlipbook(
                this.definition.hash,
                this.seed,
                timeline,
                frames,
                options
            );
        } finally {
            try {
                this.restoreSimulation(checkpoint);
            } finally {
                this.#baking = false;
            }
        }
    }

    /**
     * Capture one reusable deterministic replay checkpoint without GPU readback.
     *
     * Stateful GPU emitters are rejected because their authoritative state is device-resident.
     * Stateless GPU emitters capture only absolute reconstruction time.
     */
    captureSimulation(): ParticleSimulationCache {
        const gpuStateful = this.#runtimes.find(runtime => runtime.gpuController !== null);
        if (gpuStateful !== undefined) {
            throw new Error(
                `Particle simulation capture does not support stateful GPU emitter ${gpuStateful.plan.definition.name}`
            );
        }
        let storageByteLength = 0;
        const emitters: Readonly<ParticleEmitterSimulationSnapshot>[] = this.#runtimes.map(
            runtime => {
                const common = {
                    emitterId: runtime.plan.emitterId,
                    definitionHash: runtime.plan.definition.hash,
                    layoutHash: runtime.plan.layoutHash,
                    statelessAge: runtime.statelessAge,
                    budgetEnabled: runtime.budgetEnabled,
                    budgetParticleLimit: runtime.budgetParticleLimit,
                    budgetSpawnRateScale: runtime.budgetSpawnRateScale,
                    budgetSorting: runtime.budgetSorting,
                    budgetSoftParticles: runtime.budgetSoftParticles,
                    budgetCollision: runtime.budgetCollision,
                    budgetRibbons: runtime.budgetRibbons,
                    culledSeconds: runtime.culledSeconds,
                    stoppedByCulling: runtime.stoppedByCulling
                } as const;
                if (runtime.statelessGPUActive) {
                    return Object.freeze({
                        ...common,
                        runtimeKind: 'stateless-gpu',
                        simulation: null,
                        storageByteLength: 0
                    });
                }
                const simulator = runtime.simulator;
                if (simulator instanceof ParticleCPUSimulator) {
                    const simulation = simulator.capture();
                    storageByteLength += simulation.byteLength;
                    return Object.freeze({
                        ...common,
                        runtimeKind: 'cpu-stateful',
                        simulation,
                        storageByteLength: simulation.byteLength
                    });
                }
                if (simulator instanceof ParticleStatelessRuntime) {
                    const simulation = simulator.capture();
                    storageByteLength += simulation.byteLength;
                    return Object.freeze({
                        ...common,
                        runtimeKind: 'stateless-cpu',
                        simulation,
                        storageByteLength: simulation.byteLength
                    });
                }
                throw new Error(
                    `Particle emitter ${runtime.plan.definition.name} has no capturable runtime`
                );
            }
        );
        const snapshot: Readonly<ParticleSystemSimulationSnapshot> = Object.freeze({
            definition: this.definition,
            parameters: this.parameters,
            definitionHash: this.definition.hash,
            compiledPlanHash: this.compiledPlan.hash,
            seed: this.seed,
            parameterRevision: this.parameters.revision,
            eventReadbackCapacity: this.#eventReadbackCapacity,
            playing: this.#playing,
            timeScale: this.#timeScale,
            elapsedSeconds: this.#elapsedSeconds,
            completed: this.#completed,
            eventQueue: Object.freeze(this.#eventQueue.map(event => snapshotParticleEvent(event))),
            eventDroppedCount: this.#eventDroppedCount,
            emitters: Object.freeze(emitters),
            storageByteLength
        });
        return createParticleSimulationCache(snapshot);
    }

    /** Restore a compatible checkpoint and make its simulation state current. */
    restoreSimulation(cache: ParticleSimulationCache): this {
        const snapshot = readParticleSimulationCache(cache);
        if (snapshot === undefined) {
            throw new TypeError('ParticleSystem restore requires a captured simulation cache');
        }
        if (snapshot.definition !== this.definition) {
            throw new TypeError(
                'Particle simulation cache requires the same immutable definition identity'
            );
        }
        if (
            snapshot.definitionHash !== this.definition.hash ||
            snapshot.compiledPlanHash !== this.compiledPlan.hash
        ) {
            throw new TypeError('Particle simulation cache compiled plan is incompatible');
        }
        if (snapshot.seed !== this.seed) {
            throw new TypeError('Particle simulation cache seed is incompatible');
        }
        if (snapshot.parameters !== this.parameters) {
            throw new TypeError(
                'Particle simulation cache requires the same parameter-set identity'
            );
        }
        if (snapshot.parameterRevision !== this.parameters.revision) {
            throw new TypeError('Particle simulation cache parameter revision is stale');
        }
        if (snapshot.eventReadbackCapacity !== this.#eventReadbackCapacity) {
            throw new TypeError('Particle simulation cache event capacity is incompatible');
        }
        if (snapshot.emitters.length !== this.#runtimes.length) {
            throw new TypeError('Particle simulation cache emitter count is incompatible');
        }
        for (let index = 0; index < this.#runtimes.length; index += 1) {
            const runtime = this.#runtimes[index];
            if (runtime === undefined) {
                throw new Error('Particle runtime is unavailable');
            }
            const emitter = snapshot.emitters[index];
            if (
                emitter?.emitterId !== runtime.plan.emitterId ||
                emitter.definitionHash !== runtime.plan.definition.hash ||
                emitter.layoutHash !== runtime.plan.layoutHash
            ) {
                throw new TypeError('Particle simulation cache emitter layout is incompatible');
            }
            if (
                (emitter.runtimeKind === 'cpu-stateful' &&
                    !(runtime.simulator instanceof ParticleCPUSimulator)) ||
                (emitter.runtimeKind !== 'cpu-stateful' && runtime.plan.kind !== 'stateless') ||
                (emitter.runtimeKind === 'stateless-gpu' && !runtime.statelessGPUCapable)
            ) {
                throw new TypeError('Particle simulation cache execution mode is incompatible');
            }
        }
        for (let index = 0; index < this.#runtimes.length; index += 1) {
            const runtime = this.#runtimes[index];
            const emitter = snapshot.emitters[index];
            if (runtime === undefined || emitter === undefined) {
                throw new Error('Validated particle simulation cache emitter is unavailable');
            }
            runtime.statelessAge = emitter.statelessAge;
            runtime.budgetEnabled = emitter.budgetEnabled;
            runtime.budgetParticleLimit = emitter.budgetParticleLimit;
            runtime.budgetSpawnRateScale = emitter.budgetSpawnRateScale;
            runtime.budgetSorting = emitter.budgetSorting;
            runtime.budgetSoftParticles = emitter.budgetSoftParticles;
            runtime.budgetCollision = emitter.budgetCollision;
            runtime.budgetRibbons = emitter.budgetRibbons;
            runtime.culledSeconds = emitter.culledSeconds;
            runtime.stoppedByCulling = emitter.stoppedByCulling;
            switch (emitter.runtimeKind) {
                case 'cpu-stateful': {
                    const simulator = runtime.simulator;
                    if (!(simulator instanceof ParticleCPUSimulator)) {
                        throw new Error('Validated particle CPU runtime is unavailable');
                    }
                    runtime.statelessGPUActive = false;
                    simulator.restore(emitter.simulation);
                    break;
                }
                case 'stateless-cpu': {
                    runtime.statelessGPUActive = false;
                    this.materializeStatelessCPU(runtime);
                    const simulator = runtime.simulator;
                    if (!(simulator instanceof ParticleStatelessRuntime)) {
                        throw new Error('Validated particle stateless runtime is unavailable');
                    }
                    simulator.restore(emitter.simulation);
                    break;
                }
                case 'stateless-gpu':
                    runtime.statelessGPUActive = true;
                    runtime.statelessGPURuntime?.invalidate();
                    break;
            }
            runtime.statelessGPURuntime?.setBudget({
                systemId: this.budgetId,
                emitterId: runtime.plan.emitterId,
                enabled: runtime.budgetEnabled,
                particleLimit: runtime.budgetParticleLimit,
                spawnRateScale: runtime.budgetSpawnRateScale,
                sorting: runtime.budgetSorting,
                softParticles: runtime.budgetSoftParticles,
                collision: runtime.budgetCollision,
                ribbons: runtime.budgetRibbons,
                reasons: Object.freeze([])
            });
        }
        this.#playing = snapshot.playing;
        this.#timeScale = snapshot.timeScale;
        this.#elapsedSeconds = snapshot.elapsedSeconds;
        this.#completed = snapshot.completed;
        this.#eventQueue.length = 0;
        this.#eventQueue.push(...snapshot.eventQueue.map(event => snapshotParticleEvent(event)));
        this.#eventDroppedCount = snapshot.eventDroppedCount;
        this.syncWriters();
        return this;
    }

    override update(deltaTimeMilliseconds: number): void {
        if (this.#baking) {
            this.syncWriters();
            return;
        }
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
            parameters: this.parameters,
            budgetPriority: this.budgetPriority,
            compilationEnvironment: this.#compilationEnvironment,
            eventReadbackCapacity: this.#eventReadbackCapacity
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
            runtime.statelessGPURuntime?.destroy();
            runtime.statelessGPURuntime = null;
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
            if (runtime.statelessGPUActive && runtime.statelessGPURuntime === null) {
                runtime.statelessGPURuntime = new ParticleStatelessGPUEmitterRuntime(
                    runtime.plan,
                    this.seed,
                    renderer
                );
                runtime.statelessGPURuntime.setBudget({
                    systemId: this.budgetId,
                    emitterId: runtime.plan.emitterId,
                    enabled: runtime.budgetEnabled,
                    particleLimit: runtime.budgetParticleLimit,
                    spawnRateScale: runtime.budgetSpawnRateScale,
                    sorting: runtime.budgetSorting,
                    softParticles: runtime.budgetSoftParticles,
                    collision: runtime.budgetCollision,
                    ribbons: runtime.budgetRibbons,
                    reasons: Object.freeze([])
                });
            }
            const controller = runtime.gpuController;
            if (controller === null || runtime.gpuRuntime !== null) continue;
            runtime.gpuRuntime = new ParticleGPUEmitterRuntime(
                runtime.plan,
                this.seed,
                this.definition.hash,
                renderer,
                controller
            );
            runtime.gpuRuntime.setBudget({
                systemId: this.budgetId,
                emitterId: runtime.plan.emitterId,
                enabled: runtime.budgetEnabled,
                particleLimit: runtime.budgetParticleLimit,
                spawnRateScale: runtime.budgetSpawnRateScale,
                sorting: runtime.budgetSorting,
                softParticles: runtime.budgetSoftParticles,
                collision: runtime.budgetCollision,
                ribbons: runtime.budgetRibbons,
                reasons: Object.freeze([])
            });
        }
    }

    /** Generic addon renderer preparation entry. @internal */
    prepareRenderer(renderer: RendererContract): void {
        this.prepareGPU(renderer);
    }

    /** Refresh per-camera CPU sort and topology streams before scene collection. @internal */
    prepareView(camera: Camera): void {
        this.syncWriters(camera);
    }

    /** Record GPU simulation and storage-raster passes through the active Forward graph. @internal */
    recordGPU(
        context: RenderPipelineContext,
        color: RenderGraphTextureHandle,
        depth: RenderGraphTextureHandle | null,
        drawVisible: boolean,
        phase: 'opaque' | 'transparent'
    ): void {
        for (const runtime of this.#runtimes) {
            if (runtime.statelessGPUActive) {
                const statelessGPU = runtime.statelessGPURuntime;
                if (statelessGPU === null) {
                    throw new Error(
                        'Stateless GPU ParticleSystem resources were not prepared before recording'
                    );
                }
                statelessGPU.record(
                    context,
                    color,
                    depth,
                    this,
                    runtime.statelessAge,
                    drawVisible && runtime.budgetEnabled,
                    phase
                );
            }
            if (runtime.gpuController === null) continue;
            const gpuRuntime = runtime.gpuRuntime;
            if (gpuRuntime === null) {
                throw new Error(
                    'GPU ParticleSystem resources were not prepared before Render Graph recording'
                );
            }
            gpuRuntime.record(
                context,
                color,
                depth,
                this,
                drawVisible && runtime.budgetEnabled,
                phase
            );
        }
        for (const runtime of this.#runtimes) {
            if (!runtime.budgetEnabled) continue;
            const source = runtime.gpuRuntime;
            if (source === null) continue;
            for (const module of runtime.plan.definition.modules) {
                if (module.type !== 'sub-emitter') continue;
                const targetRuntime = this.#runtimes.find(
                    candidate => candidate.plan.definition.name === module.emitter
                );
                const target = targetRuntime?.gpuRuntime;
                if (!target) {
                    throw new Error(`GPU particle sub-emitter ${module.emitter} is unavailable`);
                }
                if (!targetRuntime.budgetEnabled) continue;
                source.recordEventRoute(context, target, module);
            }
        }
    }

    /** Generic addon GPU recording entry. @internal */
    record(
        context: RenderPipelineContext,
        color: RenderGraphTextureHandle,
        depth: RenderGraphTextureHandle | null,
        drawVisible: boolean,
        phase: 'opaque' | 'transparent'
    ): void {
        this.recordGPU(context, color, depth, drawVisible, phase);
    }

    /** Commit staged GPU clocks only after the enclosing graph submission succeeds. @internal */
    gpuFrameSubmitted(frameIndex: number): void {
        for (const runtime of this.#runtimes) runtime.gpuRuntime?.frameSubmitted(frameIndex);
    }

    /** Generic addon submission callback. @internal */
    frameSubmitted(frameIndex: number): void {
        this.gpuFrameSubmitted(frameIndex);
    }

    /** Preserve queued GPU commands and roll the double-buffer index back on failure. @internal */
    gpuFrameDiscarded(frameIndex: number): void {
        for (const runtime of this.#runtimes) {
            runtime.gpuRuntime?.frameDiscarded(frameIndex);
            runtime.statelessGPURuntime?.frameDiscarded(frameIndex);
        }
    }

    /** Generic addon rollback callback. @internal */
    frameDiscarded(frameIndex: number): void {
        this.gpuFrameDiscarded(frameIndex);
    }

    /** Generic addon sampled-depth requirement. @internal */
    get requiresSampledDepth(): boolean {
        return this.requiresGPUSampledDepth;
    }

    /** Generic addon pending-work flag. @internal */
    get hasPendingWork(): boolean {
        return this.hasPendingGPUWork;
    }

    /** Generic addon opaque-phase flag. @internal */
    get hasOpaqueRenderers(): boolean {
        return this.hasGPUOpaqueRenderers;
    }

    /** Generic addon camera-visibility query. @internal */
    isVisible(camera: Camera): boolean {
        return this.isGPUVisible(camera);
    }

    private createRuntime(plan: Readonly<ParticleCompiledEmitterPlan>): ParticleEmitterRuntime {
        const localBounds = new Sphere({
            center: new Vector3(plan.bounds.x, plan.bounds.y, plan.bounds.z),
            radius: Math.hypot(plan.bounds.width, plan.bounds.height, plan.bounds.depth) * 0.5
        });
        const worldBounds = localBounds.clone();
        if (plan.kind === 'gpu-stateful') {
            return {
                plan,
                simulator: null,
                gpuController: new ParticleGPUSpawnController(
                    plan.definition,
                    this.seed,
                    plan.emitterId,
                    this.parameters
                ),
                gpuRuntime: null,
                statelessGPURuntime: null,
                statelessGPUCapable: false,
                statelessGPUActive: false,
                statelessAge: 0,
                writers: Object.freeze([]),
                localBounds,
                worldBounds,
                budgetEnabled: true,
                budgetParticleLimit: plan.definition.capacity,
                budgetSpawnRateScale: 1,
                budgetSorting: true,
                budgetSoftParticles: true,
                budgetCollision: true,
                budgetRibbons: true,
                culledSeconds: 0,
                stoppedByCulling: false
            };
        }
        const statelessGPUActive =
            plan.kind === 'stateless' &&
            this.#compilationEnvironment.backend === 'webgpu' &&
            particleStatelessGPUBlockingDiagnostics(plan).length === 0;
        const simulator = statelessGPUActive
            ? null
            : plan.kind === 'stateless'
              ? new ParticleStatelessRuntime(plan, this.seed, this.parameters)
              : new ParticleCPUSimulator(plan, this.seed, this.parameters);
        const writers =
            simulator === null
                ? []
                : plan.definition.renderers.flatMap((renderer, index) =>
                      createParticleCPUWriters(plan, simulator.state, renderer, index)
                  );
        return {
            plan,
            simulator,
            gpuController: null,
            gpuRuntime: null,
            statelessGPURuntime: null,
            statelessGPUCapable: statelessGPUActive,
            statelessGPUActive,
            statelessAge: 0,
            writers: Object.freeze(writers),
            localBounds,
            worldBounds,
            budgetEnabled: true,
            budgetParticleLimit: plan.definition.capacity,
            budgetSpawnRateScale: 1,
            budgetSorting: true,
            budgetSoftParticles: true,
            budgetCollision: true,
            budgetRibbons: true,
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
            if (!runtime.budgetEnabled) continue;
            this.advanceRuntime(runtime, seconds, fixedStep);
        }
        this.collectCPUEvents();
    }

    private advanceWithCulling(seconds: number): void {
        const stage = this.findStage();
        for (const runtime of this.#runtimes) {
            if (
                (!runtime.statelessGPUActive &&
                    runtime.simulator === null &&
                    runtime.gpuController === null) ||
                runtime.stoppedByCulling ||
                !runtime.budgetEnabled
            )
                continue;
            const visible = this.runtimeVisible(runtime, stage);
            switch (runtime.plan.definition.culling) {
                case 'render-only':
                    this.advanceRuntime(runtime, seconds);
                    break;
                case 'pause':
                    if (visible) this.advanceRuntime(runtime, seconds);
                    break;
                case 'pause-and-catch-up':
                    if (visible) {
                        this.advanceRuntime(runtime, seconds + runtime.culledSeconds);
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
                        this.advanceRuntime(runtime, seconds);
                    } else {
                        runtime.simulator?.clear();
                        runtime.statelessAge = 0;
                        if (runtime.gpuRuntime) runtime.gpuRuntime.restart();
                        else runtime.gpuController?.restart();
                        runtime.stoppedByCulling = true;
                    }
                    break;
            }
        }
        this.collectCPUEvents();
    }

    private runtimeVisible(runtime: ParticleEmitterRuntime, stage: ParticleStage | null): boolean {
        if (stage === null) return true;
        if (!this.hierarchyVisible()) return false;
        if (runtime.statelessGPUActive || runtime.writers.length === 0) {
            return stage.cameras.some(camera => {
                if (!camera.isLayerVisible(this)) return false;
                camera.updateViewProjectionMatrix();
                return this.runtimeBoundsVisible(runtime, camera);
            });
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

    private hierarchyVisible(): boolean {
        if (!this.visible) return false;
        let ancestor = this.parent;
        while (ancestor !== null) {
            if (!ancestor.visible) return false;
            ancestor = ancestor.parent;
        }
        return true;
    }

    private runtimeBoundsVisible(runtime: ParticleEmitterRuntime, camera: Camera): boolean {
        if (runtime.plan.definition.simulationSpace === 'world') return true;
        runtime.worldBounds.copy(runtime.localBounds).transformMat4(this.worldMatrix);
        return camera.isSphereVisible(runtime.worldBounds);
    }

    private syncWriters(cameraOverride?: Camera): void {
        const stage = this.findStage();
        const camera = cameraOverride ?? stage?.cameras[0];
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
                writer.sync(this.#cameraPosition, {
                    enabled: runtime.budgetEnabled && !runtime.statelessGPUActive,
                    sorting: runtime.budgetSorting,
                    ribbons: runtime.budgetRibbons
                });
            }
        }
    }

    private prewarmEmitters(): void {
        this.updateWorldContext();
        for (const runtime of this.#runtimes) {
            if (
                (!runtime.statelessGPUActive &&
                    runtime.simulator === null &&
                    runtime.gpuController === null) ||
                !runtime.plan.definition.prewarm ||
                !runtime.budgetEnabled
            )
                continue;
            const fixedStep = runtime.plan.definition.fixedStep;
            const steps = Math.ceil(runtime.plan.definition.duration / fixedStep);
            for (let index = 0; index < steps; index += 1) {
                this.advanceRuntime(runtime, fixedStep, fixedStep);
            }
        }
        this.collectCPUEvents();
    }

    private collectCPUEvents(): void {
        for (const runtime of this.#runtimes) {
            const simulator = runtime.simulator;
            if (!(simulator instanceof ParticleCPUSimulator)) continue;
            const aggregate = simulator.events.read(simulator.events.size);
            this.#eventDroppedCount += aggregate.droppedCount;
            for (const event of aggregate.events) {
                for (const module of runtime.plan.definition.modules) {
                    if (module.type !== 'sub-emitter' || module.event !== event.name) continue;
                    const target = this.#runtimes.find(
                        candidate => candidate.plan.definition.name === module.emitter
                    );
                    if (!target) {
                        throw new Error(`Particle sub-emitter ${module.emitter} is unavailable`);
                    }
                    const command: ParticleManualEmitCommand = {
                        count: module.count ?? 1,
                        position: event.position,
                        ...(module.inheritVelocity ? { velocity: event.velocity } : {})
                    };
                    if (target.statelessGPUActive) {
                        target.statelessGPUActive = false;
                        this.materializeStatelessCPU(target);
                    }
                    if (target.simulator) target.simulator.emit(command);
                    else target.gpuController?.emit(command);
                }
                if (this.#eventQueue.length >= this.#eventReadbackCapacity) {
                    this.#eventDroppedCount++;
                    continue;
                }
                this.#eventQueue.push(event);
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
                    1,
                    this.parameters
                );
                const completionLifetime = Math.max(
                    maximumLifetime,
                    gpuController?.maximumObservedLifetime ?? 0
                );
                return (
                    runtime.plan.definition.looping ||
                    (simulator !== null && !runtime.statelessGPUActive
                        ? simulator.emitterAge >=
                              runtime.plan.definition.startDelay +
                                  runtime.plan.definition.duration &&
                          simulator.state.aliveCount === 0
                        : (gpuController?.emitterAge ??
                              (runtime.statelessGPUActive
                                  ? runtime.statelessAge
                                  : (simulator?.emitterAge ?? 0))) >=
                          runtime.plan.definition.startDelay +
                              runtime.plan.definition.duration +
                              completionLifetime)
                );
            }) &&
            this.#runtimes.every(runtime => !runtime.plan.definition.looping)
        ) {
            const wasCompleted = this.#completed;
            this.#completed = true;
            this.#playing = false;
            if (!wasCompleted && !this.#baking) this.fire('complete');
        }
    }

    private advanceRuntime(
        runtime: ParticleEmitterRuntime,
        seconds: number,
        fixedStep?: number
    ): void {
        if (runtime.statelessGPUActive) {
            runtime.statelessAge = Math.fround(runtime.statelessAge + seconds);
            return;
        }
        const simulator = runtime.simulator;
        if (simulator === null) {
            runtime.gpuController?.advance(seconds, this.#context, fixedStep);
            return;
        }
        if (simulator instanceof ParticleStatelessRuntime) {
            simulator.simulate(
                seconds,
                this.#context,
                fixedStep ?? runtime.plan.definition.fixedStep
            );
            return;
        }
        simulator.simulate(seconds, this.#context, fixedStep);
    }

    private materializeStatelessCPU(runtime: ParticleEmitterRuntime): void {
        if (runtime.plan.kind !== 'stateless') {
            throw new TypeError('Only stateless GPU emitters can materialize a CPU fallback');
        }
        this.updateWorldContext();
        let simulator = runtime.simulator;
        if (!(simulator instanceof ParticleStatelessRuntime)) {
            const materialized = new ParticleStatelessRuntime(
                runtime.plan,
                this.seed,
                this.parameters
            );
            materialized.setBudget(
                runtime.budgetParticleLimit,
                runtime.budgetSpawnRateScale,
                runtime.budgetCollision,
                false
            );
            simulator = materialized;
            runtime.simulator = materialized;
            runtime.writers = Object.freeze(
                runtime.plan.definition.renderers.flatMap((renderer, index) =>
                    createParticleCPUWriters(runtime.plan, materialized.state, renderer, index)
                )
            );
            for (const writer of runtime.writers) this.addChild(writer.mesh);
        }
        const remainingAge = Math.max(0, runtime.statelessAge - simulator.emitterAge);
        simulator.simulate(remainingAge, this.#context, runtime.plan.definition.fixedStep);
        this.syncWriters();
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
