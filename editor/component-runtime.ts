import type { Node, Renderer } from '../src/Hilo3d';
import {
    HiloNodeTransform3D,
    PhysicsWorld,
    Rapier3DBackend,
    type PhysicsShape3D,
    type PhysicsRigidBody,
    type PhysicsWorldDiagnostics
} from '@hilo/addon-physics/rapier3d';
import {
    ParticleSystem,
    ParticleSystemDefinition,
    type ParticleShapeDefinition
} from '@hilo/addon-particle';
import {
    AudioEngine,
    HiloAudioTransform,
    type AudioClipLease,
    type AudioDiagnostics,
    type AudioVoice
} from '@hilo/addon-audio';
import { assetURL } from './assets';
import {
    validateSceneComponents,
    type AudioComponent,
    type ParticleComponent,
    type PhysicsComponent
} from './components';
import type { ScriptComponentCommand } from './script-types';
import type { ProjectDocument } from './project';
import type { SceneDocument, SceneNode } from './scene';

const FIXED_STEP = 1 / 60;

type Transforms = Record<string, SceneNode['transform']>;

/** A user-gesture audio owner, created synchronously before asynchronous Play preparation. */
export class ComponentAudioSession {
    readonly engine: AudioEngine;
    private readonly clips = new Map<string, AudioClipLease>();
    private readonly voices = new Map<string, AudioVoice>();
    private readonly urls = new Set<string>();
    private stopped = false;
    private paused = false;

    constructor(context?: BaseAudioContext) {
        this.engine = new AudioEngine({
            ...(context ? { context } : {}),
            maxRealVoices: 32,
            maxVoices: 32,
            maxStreams: 0,
            cache: { maxBytes: 64 * 1024 * 1024, maxEntries: 32, maxEncodedBytes: 16 * 1024 * 1024 }
        });
    }

    /** Scenes without audio never create a native audio context. */
    static create(scene: SceneDocument): ComponentAudioSession | null {
        return Object.values(scene.nodes).some(node => node.components?.audio)
            ? new ComponentAudioSession()
            : null;
    }

    /** Invoke directly in a pointer/keyboard handler, before awaiting scene or WASM preparation. */
    unlock(): Promise<void> {
        return this.engine.resume();
    }

    async prepare(
        scene: SceneDocument,
        project: ProjectDocument,
        signal: AbortSignal
    ): Promise<void> {
        const ids = new Set(
            Object.values(scene.nodes).flatMap(node =>
                node.components?.audio ? [node.components.audio.asset] : []
            )
        );
        for (const id of ids) {
            this.assertActive(signal);
            const asset = project.assets[id];
            if (asset?.kind !== 'audio') throw new Error(`Missing WAV audio asset: ${id}`);
            const url = assetURL(asset);
            this.urls.add(url);
            try {
                const lease = await this.engine.clips.load(url, { signal });
                try {
                    this.assertActive(signal);
                } catch (error) {
                    lease.release();
                    throw error;
                }
                this.clips.set(id, lease);
            } finally {
                URL.revokeObjectURL(url);
                this.urls.delete(url);
            }
        }
    }

    private assertActive(signal: AbortSignal): void {
        signal.throwIfAborted();
        if (this.stopped) throw new DOMException('Audio session stopped.', 'AbortError');
    }

    play(id: string, component: AudioComponent, node: Node): void {
        if (this.stopped) throw new Error('Audio session stopped.');
        const clip = this.clips.get(component.asset)?.clip;
        if (!clip) throw new Error(`Audio asset was not prepared: ${component.asset}`);
        this.voices.get(id)?.stop();
        const voice = this.engine.play(clip, {
            volume: component.volume,
            loop: component.loop,
            ...(component.spatial
                ? {
                      spatial: {
                          transform: new HiloAudioTransform(node),
                          refDistance: component.refDistance,
                          maxDistance: component.maxDistance
                      }
                  }
                : {})
        });
        if (!voice) throw new Error(`Audio voice budget exhausted for node: ${id}`);
        this.voices.set(id, voice);
        if (this.paused) voice.pause();
    }

    stopVoice(id: string): void {
        this.voices.get(id)?.stop();
        this.voices.delete(id);
    }

    pause(): void {
        if (this.stopped || this.paused) return;
        this.paused = true;
        this.engine.mixer.master.setMuted(true, 0);
        for (const [id, voice] of this.voices) {
            if (voice.state === 'ended') this.voices.delete(id);
            else voice.pause();
        }
        this.engine.update();
    }

    resume(): void {
        if (this.stopped || !this.paused) return;
        this.paused = false;
        this.engine.mixer.master.setMuted(false, 0);
        for (const [id, voice] of this.voices) {
            if (voice.state === 'ended') this.voices.delete(id);
            else voice.resume();
        }
        this.engine.update();
    }

    async stop(): Promise<void> {
        if (!this.stopped) {
            this.stopped = true;
            this.engine.destroy();
            this.voices.clear();
            for (const lease of this.clips.values()) lease.release();
            this.clips.clear();
            for (const url of this.urls) URL.revokeObjectURL(url);
            this.urls.clear();
        }
        await this.engine.whenClosed();
    }
}

export interface ComponentRuntimeOptions {
    readonly scene: SceneDocument;
    readonly project: ProjectDocument;
    readonly renderer: Renderer;
    readonly resolveNode: (id: string) => Node | undefined;
    readonly listener: () => Node;
    /** Cancels asynchronous preparation; a successfully created runtime is explicitly owned by stop(). */
    readonly signal?: AbortSignal;
    /** Prepare autoplay voices silently until the timeline explicitly resumes. */
    readonly startPaused?: boolean;
    /** Ownership transfers on create, including failed or canceled preparation. */
    readonly audio?: ComponentAudioSession | null;
}

export interface ComponentRuntimeDiagnostics {
    readonly stopped: boolean;
    readonly physics: PhysicsWorldDiagnostics | null;
    readonly particles: readonly {
        readonly nodeId: string;
        readonly alive: number;
        readonly elapsed: number;
        readonly hash: string;
    }[];
    readonly audio: AudioDiagnostics | null;
}

interface DynamicBinding {
    readonly id: string;
    readonly node: Node;
    expected: SceneNode['transform'];
}

function copyTransform(node: Node): SceneNode['transform'] {
    return {
        position: { x: node.x, y: node.y, z: node.z },
        rotation: { x: node.rotationX, y: node.rotationY, z: node.rotationZ },
        scale: { x: node.scaleX, y: node.scaleY, z: node.scaleZ }
    };
}

function equalTransform(left: SceneNode['transform'], right: SceneNode['transform']): boolean {
    return (['position', 'rotation', 'scale'] as const).every(property =>
        (['x', 'y', 'z'] as const).every(
            axis => Math.abs(left[property][axis] - right[property][axis]) < 1e-6
        )
    );
}

function colliderShape(component: PhysicsComponent, node: Node): PhysicsShape3D {
    if (node.scaleX <= 0 || node.scaleY <= 0 || node.scaleZ <= 0)
        throw new Error(`Physics node ${node.name} requires positive scale.`);
    if (component.shape === 'box')
        return {
            type: 'cuboid',
            halfExtents: {
                x: (component.size.x * node.scaleX) / 2,
                y: (component.size.y * node.scaleY) / 2,
                z: (component.size.z * node.scaleZ) / 2
            }
        };
    if (Math.abs(node.scaleX - node.scaleY) > 1e-6 || Math.abs(node.scaleX - node.scaleZ) > 1e-6)
        throw new Error(`Physics ${component.shape} requires uniform scale.`);
    const radius = component.radius * node.scaleX;
    return component.shape === 'sphere'
        ? { type: 'ball', radius }
        : { type: 'capsule', radius, halfHeight: component.halfHeight * node.scaleY };
}

function particleShape(component: ParticleComponent): ParticleShapeDefinition {
    if (component.shape === 'point') return { type: 'point' };
    if (component.shape === 'sphere') return { type: 'sphere', radius: component.extent.x };
    return {
        type: 'box',
        size: [component.extent.x * 2, component.extent.y * 2, component.extent.z * 2]
    };
}

function createParticles(component: ParticleComponent): ParticleSystem {
    const rgb = Number.parseInt(component.color.slice(1), 16);
    const linear = (channel: number): number => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    return new ParticleSystem({
        autoPlay: false,
        seed: component.seed,
        definition: ParticleSystemDefinition.create({
            emitters: [
                {
                    name: 'studio',
                    execution: 'cpu',
                    capacity: component.maxParticles,
                    fixedStep: FIXED_STEP,
                    maxCatchUpSteps: 4,
                    duration: component.duration,
                    looping: component.loop,
                    simulationSpace: 'local',
                    culling: 'render-only',
                    emission: { rateOverTime: component.rate },
                    shape: particleShape(component),
                    initialize: {
                        lifetime: component.lifetime,
                        speed: component.speed,
                        size: component.size,
                        color: [
                            linear((rgb >>> 16) & 255),
                            linear((rgb >>> 8) & 255),
                            linear(rgb & 255),
                            1
                        ]
                    },
                    modules: [
                        {
                            type: 'gravity',
                            force: [component.gravity.x, component.gravity.y, component.gravity.z]
                        }
                    ],
                    renderers: [{ type: 'sprite', blend: 'additive', depthWrite: false }]
                }
            ]
        })
    });
}

/** Shared Studio/Player owner. It advances only from PlayController's isolated timeline. */
export class ComponentRuntime {
    private world: PhysicsWorld<'3d'> | null = null;
    private readonly dynamics: DynamicBinding[] = [];
    private readonly bodies = new Map<string, PhysicsRigidBody<'3d'>>();
    private readonly colliderScales = new Map<string, SceneNode['transform']['scale']>();
    private readonly particles: { id: string; system: ParticleSystem; elapsed: number }[] = [];
    private readonly controller = new AbortController();
    private readonly audio: ComponentAudioSession | null;
    private stopped = false;
    private stopping: Promise<void> | null = null;
    private listenerNode: Node | null = null;

    private constructor(private readonly options: ComponentRuntimeOptions) {
        this.audio = options.audio ?? ComponentAudioSession.create(options.scene);
        if (options.startPaused) this.audio?.pause();
        options.signal?.addEventListener('abort', this.abort, { once: true });
        if (options.signal?.aborted) this.controller.abort();
    }

    static async create(options: ComponentRuntimeOptions): Promise<ComponentRuntime> {
        const runtime = new ComponentRuntime(options);
        try {
            await runtime.prepare();
            runtime.controller.signal.throwIfAborted();
            options.signal?.removeEventListener('abort', runtime.abort);
            return runtime;
        } catch (error) {
            await runtime.stop();
            throw error;
        }
    }

    private readonly abort = (): void => {
        this.controller.abort();
        // Destroy resources immediately; create awaits the same cleanup on its failure path.
        void this.stop().catch(() => {
            /* create/stop callers retain the cleanup promise. */
        });
    };

    private requireNode(id: string): Node {
        const node = this.options.resolveNode(id);
        if (!node) throw new Error(`Runtime component node is missing: ${id}`);
        return node;
    }

    private async prepare(): Promise<void> {
        const { scene, project } = this.options;
        const signal = this.controller.signal;
        signal.throwIfAborted();
        validateSceneComponents(
            scene,
            Object.values(project.clips).filter(clip => clip.sceneId === project.activeSceneId)
        );
        if (Object.values(scene.nodes).some(node => node.components?.physics)) {
            const world = await PhysicsWorld.create({
                backend: new Rapier3DBackend(),
                gravity: { x: 0, y: -9.81, z: 0 },
                fixedTimeStep: FIXED_STEP,
                maxSubSteps: 4,
                maxDeltaSeconds: 0.05
            });
            if (signal.aborted) {
                world.destroy();
                signal.throwIfAborted();
            }
            this.world = world;
        }
        const ordered = Object.entries(scene.nodes);
        const depth = (source: SceneNode): number => {
            let result = 0;
            let parent = source.parent;
            while (parent) {
                result++;
                parent = scene.nodes[parent]?.parent ?? null;
            }
            return result;
        };
        ordered.sort((left, right) => depth(left[1]) - depth(right[1]));
        for (const [id, source] of ordered) {
            const components = source.components;
            if (!components) continue;
            const node = this.requireNode(id);
            if (components.physics && this.world) {
                const component = components.physics;
                const bridge = new HiloNodeTransform3D(node);
                const pose = bridge.readPose();
                const body = this.world.createRigidBody({
                    ...pose,
                    type:
                        component.body === 'static'
                            ? 'fixed'
                            : component.body === 'kinematic'
                              ? 'kinematic-position'
                              : 'dynamic',
                    continuousCollisionDetection: component.body === 'dynamic'
                });
                this.world.createCollider(
                    {
                        shape: colliderShape(component, node),
                        mass: component.mass,
                        friction: component.friction,
                        restitution: component.restitution,
                        sensor: component.sensor
                    },
                    body
                );
                this.world.bindTransform(body, bridge, { interpolate: false });
                this.bodies.set(id, body);
                this.colliderScales.set(id, { x: node.scaleX, y: node.scaleY, z: node.scaleZ });
                if (component.body === 'dynamic')
                    this.dynamics.push({
                        id,
                        node,
                        expected: structuredClone(source.transform)
                    });
            }
            if (components.particles) {
                const system = createParticles(components.particles);
                this.particles.push({ id, system, elapsed: 0 });
                node.addChild(system);
            }
        }
        if (this.audio) {
            await this.audio.prepare(scene, project, signal);
            signal.throwIfAborted();
            this.updateListener();
            for (const [id, source] of Object.entries(scene.nodes)) {
                const component = source.components?.audio;
                if (component?.autoplay) this.audio.play(id, component, this.requireNode(id));
            }
            this.audio.engine.update();
        }
    }

    /** Animation/scripts have already applied their transforms; dynamic bodies own their poses. */
    step(dt: number, _time: number, scene: SceneDocument): Transforms {
        if (this.stopped) throw new Error('Component runtime has stopped.');
        if (!Number.isFinite(dt) || dt < 0 || dt > 0.05)
            throw new RangeError(
                'Component steps require a finite delta between 0 and 0.05 seconds.'
            );
        for (const binding of this.dynamics) {
            const source = scene.nodes[binding.id];
            if (!source || !equalTransform(source.transform, binding.expected))
                throw new Error(
                    `Dynamic body ${binding.id} owns its transform; scripts and animation must use a kinematic body.`
                );
        }
        for (const [id, scale] of this.colliderScales) {
            const node = this.requireNode(id);
            if (node.scaleX !== scale.x || node.scaleY !== scale.y || node.scaleZ !== scale.z)
                throw new Error(
                    `Physics collider ${id} owns its scale; restart Play after editing collider dimensions.`
                );
        }
        this.world?.advance(dt * 1000);
        const transforms: Transforms = {};
        for (const binding of this.dynamics) {
            const transform = copyTransform(binding.node);
            binding.expected = structuredClone(transform);
            transforms[binding.id] = transform;
        }
        for (const particle of this.particles) {
            particle.system.simulate(dt, { fixedStep: FIXED_STEP });
            particle.elapsed += dt;
        }
        if (this.audio) {
            this.updateListener();
            this.audio.engine.update();
        }
        return transforms;
    }

    /** Commands were authorized against the isolated scene by the script host. Recheck budgets here. */
    executeCommands(commands: readonly ScriptComponentCommand[]): void {
        if (this.stopped) throw new Error('Component runtime has stopped.');
        if (commands.length > 128) throw new Error('Too many component commands in one step.');
        for (const command of commands) {
            const component = this.options.scene.nodes[command.nodeId]?.components;
            if (command.type === 'applyImpulse') {
                const body = this.bodies.get(command.nodeId);
                if (!body || component?.physics?.body !== 'dynamic')
                    throw new Error('Impulse commands require a dynamic rigid body.');
                if (
                    ![command.x, command.y, command.z].every(
                        value => Number.isFinite(value) && Math.abs(value) <= 1e6
                    )
                )
                    throw new Error('Impulse components must be finite and at most 1,000,000.');
                body.applyImpulse({ x: command.x, y: command.y, z: command.z });
            } else if (command.type === 'emitParticles') {
                const particle = this.particles.find(entry => entry.id === command.nodeId);
                if (!particle) throw new Error('Emission commands require a particle component.');
                if (
                    !Number.isSafeInteger(command.count) ||
                    command.count < 1 ||
                    command.count > 4096
                )
                    throw new Error('Particle emission must contain 1 to 4096 particles.');
                particle.system.emit(command.count);
            } else if (command.type === 'playAudio') {
                if (!component?.audio || !this.audio)
                    throw new Error('Audio commands require an audio component.');
                this.audio.play(command.nodeId, component.audio, this.requireNode(command.nodeId));
            } else {
                if (!component?.audio || !this.audio)
                    throw new Error('Audio commands require an audio component.');
                this.audio.stopVoice(command.nodeId);
            }
        }
    }

    private updateListener(): void {
        if (!this.audio) return;
        const node = this.options.listener();
        if (node !== this.listenerNode) {
            this.listenerNode = node;
            this.audio.engine.setListener({ transform: new HiloAudioTransform(node) });
        }
    }

    pause(): void {
        this.audio?.pause();
    }
    resume(): void {
        this.audio?.resume();
    }
    unlockAudio(): Promise<void> {
        return this.audio?.unlock() ?? Promise.resolve();
    }

    getDiagnostics(): ComponentRuntimeDiagnostics {
        return {
            stopped: this.stopped,
            physics: this.world?.getDiagnostics() ?? null,
            particles: this.particles.map(({ id, system, elapsed }) => ({
                nodeId: id,
                alive: system.aliveCount,
                elapsed,
                hash: system.stateHash()
            })),
            audio: this.stopped ? null : (this.audio?.engine.getDiagnostics() ?? null)
        };
    }

    /** Remove renderer bridges before the viewport destroys its renderer; cancellation is idempotent. */
    stop(): Promise<void> {
        if (this.stopping) return this.stopping;
        this.stopped = true;
        this.controller.abort();
        this.options.signal?.removeEventListener('abort', this.abort);
        const failures: unknown[] = [];
        for (const { system } of this.particles) {
            try {
                system.removeFromParent();
                system.destroy(this.options.renderer);
            } catch (error) {
                failures.push(error);
            }
        }
        this.particles.length = 0;
        try {
            this.world?.destroy();
        } catch (error) {
            failures.push(error);
        }
        this.world = null;
        this.dynamics.length = 0;
        this.bodies.clear();
        this.colliderScales.clear();
        this.stopping = (async (): Promise<void> => {
            try {
                await this.audio?.stop();
            } catch (error) {
                failures.push(error);
            }
            if (failures.length) throw new AggregateError(failures, 'Component cleanup failed.');
        })();
        return this.stopping;
    }
}
