import type ParticleSystemDefinition from './ParticleSystemDefinition.js';
import type { ParticleParameterSet } from './ParticleParameter.js';
import type { ParticleEventRecord } from './cpu/ParticleCPUEventBuffer.js';
import type { ParticleCPUSimulatorSnapshot } from './cpu/ParticleCPUSimulator.js';
import type { ParticleStatelessRuntimeSnapshot } from './stateless/ParticleStatelessRuntime.js';

/** Current in-memory deterministic particle simulation cache format. */
export const PARTICLE_SIMULATION_CACHE_VERSION = 1 as const;

interface ParticleEmitterSimulationSnapshotBase {
    readonly emitterId: number;
    readonly definitionHash: string;
    readonly layoutHash: string;
    readonly statelessAge: number;
    readonly budgetEnabled: boolean;
    readonly budgetParticleLimit: number;
    readonly budgetSpawnRateScale: number;
    readonly budgetSorting: boolean;
    readonly budgetSoftParticles: boolean;
    readonly budgetCollision: boolean;
    readonly budgetRibbons: boolean;
    readonly culledSeconds: number;
    readonly stoppedByCulling: boolean;
    readonly storageByteLength: number;
}

/** @internal */
export type ParticleEmitterSimulationSnapshot =
    | (ParticleEmitterSimulationSnapshotBase & {
          readonly runtimeKind: 'cpu-stateful';
          readonly simulation: Readonly<ParticleCPUSimulatorSnapshot>;
      })
    | (ParticleEmitterSimulationSnapshotBase & {
          readonly runtimeKind: 'stateless-cpu';
          readonly simulation: Readonly<ParticleStatelessRuntimeSnapshot>;
      })
    | (ParticleEmitterSimulationSnapshotBase & {
          readonly runtimeKind: 'stateless-gpu';
          readonly simulation: null;
      });

/** @internal */
export interface ParticleSystemSimulationSnapshot {
    readonly definition: ParticleSystemDefinition;
    readonly parameters: ParticleParameterSet;
    readonly definitionHash: string;
    readonly compiledPlanHash: string;
    readonly seed: number;
    readonly parameterRevision: number;
    readonly eventReadbackCapacity: number;
    readonly playing: boolean;
    readonly timeScale: number;
    readonly elapsedSeconds: number;
    readonly completed: boolean;
    readonly eventQueue: readonly Readonly<ParticleEventRecord>[];
    readonly eventDroppedCount: number;
    readonly emitters: readonly Readonly<ParticleEmitterSimulationSnapshot>[];
    readonly storageByteLength: number;
}

/**
 * Opaque reusable in-memory checkpoint for deterministic particle replay.
 *
 * A cache is intentionally bound to the immutable definition, compiled plan, seed, parameter-set
 * identity/revision, and event-readback capacity from which it was captured. It is not a serialized
 * asset; use definition serialization for persistence and particle baking for portable output.
 */
export interface ParticleSimulationCache {
    readonly version: typeof PARTICLE_SIMULATION_CACHE_VERSION;
    readonly definitionHash: string;
    readonly compiledPlanHash: string;
    readonly seed: number;
    readonly parameterRevision: number;
    readonly elapsedSeconds: number;
    readonly emitterCount: number;
    /** Copied typed-array storage retained by this cache, excluding JavaScript metadata. */
    readonly storageByteLength: number;
}

const simulationSnapshots = new WeakMap<
    ParticleSimulationCache,
    Readonly<ParticleSystemSimulationSnapshot>
>();

/** @internal */
export function createParticleSimulationCache(
    snapshot: Readonly<ParticleSystemSimulationSnapshot>
): ParticleSimulationCache {
    const cache: ParticleSimulationCache = Object.freeze({
        version: PARTICLE_SIMULATION_CACHE_VERSION,
        definitionHash: snapshot.definitionHash,
        compiledPlanHash: snapshot.compiledPlanHash,
        seed: snapshot.seed,
        parameterRevision: snapshot.parameterRevision,
        elapsedSeconds: snapshot.elapsedSeconds,
        emitterCount: snapshot.emitters.length,
        storageByteLength: snapshot.storageByteLength
    });
    simulationSnapshots.set(cache, snapshot);
    return cache;
}

/** @internal */
export function readParticleSimulationCache(
    cache: ParticleSimulationCache
): Readonly<ParticleSystemSimulationSnapshot> | undefined {
    return simulationSnapshots.get(cache);
}
