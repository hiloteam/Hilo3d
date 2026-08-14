import { hashParticleDefinition, snapshotParticleDefinitionValue } from './ParticleDefinitionHash';
import type {
    ParticleBoundsDefinition,
    ParticleCullingReaction,
    ParticleEmissionDefinition,
    ParticleEmitterDefinitionInput,
    ParticleExecutionMode,
    ParticleInitializeDefinition,
    ParticleModule,
    ParticleOverflowPolicy,
    ParticleRendererDefinition,
    ParticleShapeDefinition,
    ParticleSimulationSpace
} from './ParticleTypes';

function positiveFinite(value: number | undefined, fallback: number, label: string): number {
    const result = value ?? fallback;
    if (!Number.isFinite(result) || result <= 0) throw new RangeError(`${label} must be positive`);
    return Math.fround(result);
}

/** Immutable, independently hashable emitter definition. */
class ParticleEmitterDefinition {
    readonly name: string;
    readonly capacity: number;
    readonly execution: ParticleExecutionMode;
    readonly duration: number;
    readonly looping: boolean;
    readonly startDelay: number;
    readonly prewarm: boolean;
    readonly fixedStep: number;
    readonly maxCatchUpSteps: number;
    readonly simulationSpace: ParticleSimulationSpace;
    readonly overflow: ParticleOverflowPolicy;
    readonly culling: ParticleCullingReaction;
    readonly bounds: ParticleBoundsDefinition;
    readonly emission: ParticleEmissionDefinition;
    readonly shape: ParticleShapeDefinition;
    readonly initialize: ParticleInitializeDefinition;
    readonly modules: readonly ParticleModule[];
    readonly renderers: readonly ParticleRendererDefinition[];
    readonly hash: string;

    constructor(input: Readonly<ParticleEmitterDefinitionInput>) {
        if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/u.test(input.name)) {
            throw new TypeError('Particle emitter name is invalid');
        }
        if (
            !Number.isSafeInteger(input.capacity) ||
            input.capacity < 1 ||
            input.capacity > 16_777_216
        ) {
            throw new RangeError('Particle emitter capacity must be between 1 and 16777216');
        }
        if (input.renderers.length === 0) {
            throw new RangeError(`Particle emitter ${input.name} requires at least one renderer`);
        }
        this.name = input.name;
        this.capacity = input.capacity;
        this.execution = input.execution ?? 'auto';
        this.duration = positiveFinite(input.duration, 5, `${input.name}.duration`);
        this.looping = input.looping ?? true;
        const startDelay = input.startDelay ?? 0;
        if (!Number.isFinite(startDelay) || startDelay < 0) {
            throw new RangeError(`${input.name}.startDelay must be non-negative`);
        }
        this.startDelay = Math.fround(startDelay);
        this.prewarm = input.prewarm ?? false;
        this.fixedStep = positiveFinite(input.fixedStep, 1 / 60, `${input.name}.fixedStep`);
        const maxCatchUpSteps = input.maxCatchUpSteps ?? 8;
        if (
            !Number.isSafeInteger(maxCatchUpSteps) ||
            maxCatchUpSteps < 1 ||
            maxCatchUpSteps > 1024
        ) {
            throw new RangeError(`${input.name}.maxCatchUpSteps must be between 1 and 1024`);
        }
        this.maxCatchUpSteps = maxCatchUpSteps;
        this.simulationSpace = input.simulationSpace ?? 'local';
        this.overflow = input.overflow ?? 'drop-new';
        this.culling = input.culling ?? 'render-only';
        this.bounds = snapshotParticleDefinitionValue(
            input.bounds ?? ({ mode: 'automatic' } as const)
        );
        this.emission = snapshotParticleDefinitionValue(input.emission ?? {});
        this.shape = snapshotParticleDefinitionValue(input.shape ?? ({ type: 'point' } as const));
        this.initialize = snapshotParticleDefinitionValue(input.initialize ?? {});
        this.modules = snapshotParticleDefinitionValue(input.modules ?? []);
        this.renderers = snapshotParticleDefinitionValue(input.renderers);
        this.hash = hashParticleDefinition({
            name: this.name,
            capacity: this.capacity,
            execution: this.execution,
            duration: this.duration,
            looping: this.looping,
            startDelay: this.startDelay,
            prewarm: this.prewarm,
            fixedStep: this.fixedStep,
            maxCatchUpSteps: this.maxCatchUpSteps,
            simulationSpace: this.simulationSpace,
            overflow: this.overflow,
            culling: this.culling,
            bounds: this.bounds,
            emission: this.emission,
            shape: this.shape,
            initialize: this.initialize,
            modules: this.modules,
            renderers: this.renderers
        });
        Object.freeze(this);
    }
}

export default ParticleEmitterDefinition;
