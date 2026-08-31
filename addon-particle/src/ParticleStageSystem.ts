import {
    STAGE_SYSTEM_API_VERSION,
    createStageSystemService,
    type Node,
    type Stage,
    type StageSystem
} from 'hilo3d';
import {
    ParticleBudgetManager,
    type ParticleBudgetDecision,
    type ParticleBudgetProfile
} from './ParticleBudget.js';
import ParticleSystem, { type ParticleSystemParameters } from './ParticleSystem.js';

/** Stage service that owns optional particle systems and their frame-wide quality budget. */
export const PARTICLE_STAGE_SERVICE = createStageSystemService<ParticleStageRuntime>(
    '@hilo3d/addon-particle/runtime'
);

/** Configuration for the standard optional particle Stage System. */
export interface ParticleStageSystemOptions {
    /** Frame-wide quality budget. Pass `false` to disable automatic allocation. */
    readonly budget?: Readonly<ParticleBudgetProfile> | false;
    /** Create initial systems while System setup is still transactional. */
    readonly setup?: (runtime: ParticleStageRuntime, stage: Stage) => void | Promise<void>;
}

const ownerBySystem = new WeakMap<ParticleSystem, ParticleStageRuntime>();

/** Per-Stage owner for particle-system creation, budgeting, and deterministic teardown. */
export class ParticleStageRuntime {
    readonly stage: Stage;
    readonly budget: ParticleBudgetManager | null;
    readonly #systems = new Set<ParticleSystem>();
    #destroyed = false;

    constructor(stage: Stage, budget: Readonly<ParticleBudgetProfile> | false = {}) {
        this.stage = stage;
        this.budget = budget === false ? null : new ParticleBudgetManager(budget);
    }

    /** Snapshot the systems currently owned by this Stage runtime. */
    get systems(): readonly ParticleSystem[] {
        return Object.freeze([...this.#systems]);
    }

    /** Create, register, and attach one particle system compiled for the owning Stage backend. */
    createSystem(
        parameters: Readonly<ParticleSystemParameters>,
        parent: Node = this.stage
    ): ParticleSystem {
        this.requireActive();
        if (parameters.parent !== undefined && parameters.parent !== null) {
            throw new TypeError(
                'ParticleStageRuntime.createSystem owns attachment; pass the parent argument instead.'
            );
        }
        const backend = this.stage.renderer.backend;
        const requestedBackend = parameters.compilationEnvironment?.backend;
        if (requestedBackend !== undefined && requestedBackend !== backend) {
            throw new TypeError(
                `Particle compilation backend ${requestedBackend} conflicts with owning Stage backend ${backend}.`
            );
        }
        const system = new ParticleSystem({
            ...parameters,
            compilationEnvironment: {
                ...parameters.compilationEnvironment,
                backend
            }
        });
        try {
            this.manage(system, parent);
        } catch (cause) {
            system.destroy(this.stage.renderer);
            throw cause;
        }
        return system;
    }

    /** Register an existing compatible system and attach it to an application-owned scene parent. */
    manage(system: ParticleSystem, parent: Node = this.stage): ParticleSystem {
        this.requireActive();
        const compiledBackend = system.compilationBackend;
        if (compiledBackend !== undefined && compiledBackend !== this.stage.renderer.backend) {
            throw new TypeError(
                `ParticleSystem compiled for ${compiledBackend} cannot be managed by a ${this.stage.renderer.backend} Stage.`
            );
        }
        let ancestor: Node | null = parent;
        while (ancestor.parent !== null) ancestor = ancestor.parent;
        if (ancestor !== this.stage) {
            throw new Error('Particle systems must be attached below their owning Stage.');
        }
        const owner = ownerBySystem.get(system);
        if (owner !== undefined && owner !== this) {
            throw new Error('ParticleSystem is already managed by another Stage runtime.');
        }
        if (this.#systems.has(system)) return system;
        system.addTo(parent);
        this.#systems.add(system);
        ownerBySystem.set(system, this);
        return system;
    }

    /** Destroy and unregister one managed system. */
    release(system: ParticleSystem, destroyTextures = false): void {
        this.requireActive();
        if (!this.#systems.delete(system)) {
            throw new RangeError('ParticleStageRuntime cannot release an unmanaged system.');
        }
        ownerBySystem.delete(system);
        system.destroy(this.stage.renderer, destroyTextures);
    }

    /** Apply this runtime's complete budget before Stage updates. */
    updateBudget(): readonly Readonly<ParticleBudgetDecision>[] {
        if (this.#destroyed || this.budget === null || this.#systems.size === 0) {
            return Object.freeze([]);
        }
        return this.budget.apply([...this.#systems], this.stage.camera ?? undefined);
    }

    /** Destroy every managed system before the Stage renderer is released. */
    destroy(): void {
        if (this.#destroyed) return;
        this.#destroyed = true;
        const errors: unknown[] = [];
        for (const system of [...this.#systems].reverse()) {
            ownerBySystem.delete(system);
            try {
                system.destroy(this.stage.renderer);
            } catch (cause) {
                errors.push(cause);
            }
        }
        this.#systems.clear();
        if (errors.length > 0) {
            throw new AggregateError(errors, 'One or more particle systems failed to destroy.');
        }
    }

    private requireActive(): void {
        if (this.#destroyed) throw new Error('ParticleStageRuntime is destroyed.');
    }
}

/** Create the standard particle System without adding particle code to the Hilo3D entry. */
export function createParticleStageSystem(
    options: Readonly<ParticleStageSystemOptions> = {}
): StageSystem {
    return {
        descriptor: {
            id: '@hilo3d/addon-particle',
            version: '0.1.0',
            apiVersion: STAGE_SYSTEM_API_VERSION,
            provides: [PARTICLE_STAGE_SERVICE]
        },
        async setup(context) {
            const runtime = new ParticleStageRuntime(context.stage, options.budget ?? {});
            try {
                context.provide(PARTICLE_STAGE_SERVICE, runtime);
                await options.setup?.(runtime, context.stage);
            } catch (cause) {
                try {
                    runtime.destroy();
                } catch (destroyCause) {
                    throw new AggregateError(
                        [cause, destroyCause],
                        'Particle System setup and rollback both failed.',
                        { cause: destroyCause }
                    );
                }
                throw cause;
            }
            return {
                beforeUpdate: () => {
                    runtime.updateBudget();
                },
                destroy: () => {
                    runtime.destroy();
                }
            };
        }
    };
}
