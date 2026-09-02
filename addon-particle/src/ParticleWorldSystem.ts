import {
    LocalTransform,
    RenderExtensionComponent,
    WORLD_SYSTEM_API_VERSION,
    defineComponent,
    defineWorldResource,
    getTransformStore,
    type World,
    type WorldSystem
} from 'hilo3d';
import {
    ParticleBudgetManager,
    type ParticleBudgetDecision,
    type ParticleBudgetProfile
} from './ParticleBudget.js';
import ParticleSystem, { type ParticleSystemParameters } from './ParticleSystem.js';

/** Particle resource reference attached to an Entity. */
export interface ParticleEmitterValue {
    readonly system: ParticleSystem;
}

export const ParticleEmitter = defineComponent<ParticleEmitterValue>(
    '@hilo3d/addon-particle/emitter'
);

/** World resource owning optional particle resources and frame-wide quality policy. */
export const PARTICLE_RUNTIME = defineWorldResource<ParticleRuntime>(
    '@hilo3d/addon-particle/runtime'
);

export interface ParticleWorldSystemOptions {
    readonly backend?: 'webgl2' | 'webgpu';
    readonly budget?: Readonly<ParticleBudgetProfile> | false;
    readonly setup?: (runtime: ParticleRuntime, world: World) => void | Promise<void>;
}

/** World-scoped owner for explicitly component-attached particle resources. */
export class ParticleRuntime {
    readonly budget: ParticleBudgetManager | null;
    private readonly owned = new Set<ParticleSystem>();
    private destroyed = false;

    constructor(
        readonly world: World,
        budget: Readonly<ParticleBudgetProfile> | false,
        private readonly backend: 'webgl2' | 'webgpu' | undefined
    ) {
        this.budget = budget === false ? null : new ParticleBudgetManager(budget);
    }

    get systems(): readonly ParticleSystem[] {
        return Object.freeze([...this.owned]);
    }

    /** Create a resource and attach it to a newly allocated Entity with LocalTransform. */
    create(parameters: Readonly<ParticleSystemParameters>): ParticleSystem {
        this.requireActive();
        const requestedBackend = parameters.compilationEnvironment?.backend;
        if (
            this.backend !== undefined &&
            requestedBackend !== undefined &&
            requestedBackend !== this.backend
        ) {
            throw new TypeError('Particle compilation backend conflicts with its World System.');
        }
        const system = new ParticleSystem({
            ...parameters,
            compilationEnvironment: {
                ...parameters.compilationEnvironment,
                ...(this.backend === undefined ? {} : { backend: this.backend })
            }
        });
        const entity = this.world.createEntity();
        this.world.add(entity, LocalTransform, {});
        this.world.add(entity, ParticleEmitter, { system });
        this.owned.add(system);
        return system;
    }

    /** Mark an externally created resource as owned by this World lifecycle. */
    own(system: ParticleSystem): void {
        this.requireActive();
        this.owned.add(system);
    }

    updateBudget(systems: readonly ParticleSystem[]): readonly Readonly<ParticleBudgetDecision>[] {
        if (this.destroyed || this.budget === null || systems.length === 0) {
            return Object.freeze([]);
        }
        return this.budget.apply(systems);
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        const errors: unknown[] = [];
        for (const system of this.owned) {
            try {
                system.destroy();
            } catch (cause) {
                errors.push(cause);
            }
        }
        this.owned.clear();
        if (errors.length > 0) {
            throw new AggregateError(errors, 'One or more particle resources failed to destroy.');
        }
    }

    private requireActive(): void {
        if (this.destroyed) throw new Error('ParticleRuntime is destroyed.');
    }
}

/** Create the particle ECS System and explicit RenderExtension component bridge. */
export function createParticleWorldSystem(
    options: Readonly<ParticleWorldSystemOptions> = {}
): WorldSystem {
    return {
        descriptor: {
            id: '@hilo3d/addon-particle',
            version: '1.0.0',
            apiVersion: WORLD_SYSTEM_API_VERSION,
            phase: 'update',
            provides: [PARTICLE_RUNTIME],
            access: {
                reads: [LocalTransform, ParticleEmitter],
                writes: [RenderExtensionComponent]
            }
        },
        async setup(context) {
            const world = context.world;
            const emitters = world.getStore(ParticleEmitter);
            const extensions = world.getStore(RenderExtensionComponent);
            const query = world.query(LocalTransform, ParticleEmitter);
            const runtime = new ParticleRuntime(world, options.budget ?? {}, options.backend);
            context.provide(PARTICLE_RUNTIME, runtime);
            await options.setup?.(runtime, world);
            let dirty = new Uint8Array(world.getDiagnostics().entityCapacity);
            let dirtyEntities = new Uint32Array(world.getDiagnostics().entityCapacity);
            let dirtyCount = 0;
            const activeSystems: ParticleSystem[] = [];
            let observedDataRevision = emitters.dataRevision;
            const ensureCapacity = (capacity: number): void => {
                if (capacity <= dirty.length) return;
                const next = Math.max(capacity, dirty.length * 2, 16);
                const nextDirty = new Uint8Array(next);
                nextDirty.set(dirty);
                dirty = nextDirty;
                const nextEntities = new Uint32Array(next);
                nextEntities.set(dirtyEntities);
                dirtyEntities = nextEntities;
            };
            const queue = (entityIndex: number): void => {
                ensureCapacity(entityIndex + 1);
                if (dirty[entityIndex] === 1) return;
                dirty[entityIndex] = 1;
                dirtyEntities[dirtyCount] = entityIndex;
                dirtyCount++;
            };
            for (let index = 0; index < query.length; index++) {
                queue(query.entityIndices[index] ?? 0);
            }
            const unsubscribe = world.subscribeStructureChanges((entityIndex, component) => {
                if (
                    component === null ||
                    component === LocalTransform ||
                    component === ParticleEmitter
                ) {
                    queue(entityIndex);
                }
            });
            try {
                return {
                    execute(execution): void {
                        if (observedDataRevision !== emitters.dataRevision) {
                            observedDataRevision = emitters.dataRevision;
                            for (let index = 0; index < emitters.length; index++) {
                                queue(emitters.entityIndices[index] ?? 0);
                            }
                        }
                        for (let index = 0; index < dirtyCount; index++) {
                            const entityIndex = dirtyEntities[index] ?? 0;
                            dirty[entityIndex] = 0;
                            const entity = world.entityAt(entityIndex);
                            if (query.has(entityIndex)) {
                                const extension = emitters.get(entityIndex).system;
                                const value = { extension };
                                if (extensions.has(entityIndex)) {
                                    execution.commands.set(entity, RenderExtensionComponent, value);
                                } else {
                                    execution.commands.add(entity, RenderExtensionComponent, value);
                                }
                            } else if (extensions.has(entityIndex)) {
                                execution.commands.remove(entity, RenderExtensionComponent);
                            }
                        }
                        dirtyCount = 0;
                        activeSystems.length = 0;
                        const transforms = getTransformStore(world);
                        for (let index = 0; index < query.length; index++) {
                            const entityIndex = query.entityIndices[index] ?? 0;
                            const system = emitters.get(entityIndex).system;
                            const transformIndex = transforms.denseIndexOf(entityIndex);
                            system.setWorldMatrix(transforms.worldMatrixData, transformIndex * 16);
                            system.update(execution.deltaTimeMilliseconds);
                            activeSystems.push(system);
                        }
                        runtime.updateBudget(activeSystems);
                    },
                    destroy(): void {
                        unsubscribe();
                        runtime.destroy();
                    }
                };
            } catch (cause) {
                unsubscribe();
                runtime.destroy();
                throw cause;
            }
        }
    };
}
