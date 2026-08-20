import type Camera from '../camera/Camera';
import ParticleSystem from './ParticleSystem';

/** Renderer-local particle quality and capacity budget. */
export interface ParticleBudgetProfile {
    readonly maxSystems?: number;
    readonly maxEmitters?: number;
    readonly maxParticles?: number;
    readonly maxDistance?: number;
    readonly capacityScale?: number;
    readonly spawnRateScale?: number;
    readonly sorting?: boolean;
    readonly softParticles?: boolean;
    readonly collision?: boolean;
    readonly ribbons?: boolean;
}

/** One stable emitter request submitted to a particle budget manager. */
export interface ParticleBudgetRequest {
    readonly systemId: string;
    readonly emitterId: number;
    readonly capacity: number;
    readonly estimatedAlive: number;
    readonly priority?: number;
    readonly distance?: number;
    readonly visible?: boolean;
}

/** Deterministic quality decision and its explainable degradation reasons. */
export interface ParticleBudgetDecision {
    readonly systemId: string;
    readonly emitterId: number;
    readonly enabled: boolean;
    readonly particleLimit: number;
    readonly spawnRateScale: number;
    readonly sorting: boolean;
    readonly softParticles: boolean;
    readonly collision: boolean;
    readonly ribbons: boolean;
    readonly reasons: readonly string[];
}

const DEFAULT_PROFILE: Required<ParticleBudgetProfile> = Object.freeze({
    maxSystems: Number.MAX_SAFE_INTEGER,
    maxEmitters: Number.MAX_SAFE_INTEGER,
    maxParticles: Number.MAX_SAFE_INTEGER,
    maxDistance: Number.POSITIVE_INFINITY,
    capacityScale: 1,
    spawnRateScale: 1,
    sorting: true,
    softParticles: true,
    collision: true,
    ribbons: true
});

function nonNegativeInteger(value: number | undefined, fallback: number, label: string): number {
    if (value === undefined) return fallback;
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(`${label} must be a non-negative safe integer`);
    }
    return value;
}

function nonNegative(value: number | undefined, fallback: number, label: string): number {
    if (value === undefined) return fallback;
    if (!Number.isFinite(value) || value < 0) {
        throw new RangeError(`${label} must be finite and non-negative`);
    }
    return value;
}

/** Shared deterministic allocator used by renderer-local particle managers. */
export class ParticleBudgetManager {
    readonly profile: Readonly<Required<ParticleBudgetProfile>>;

    constructor(profile: Readonly<ParticleBudgetProfile> = {}) {
        this.profile = Object.freeze({
            maxSystems: nonNegativeInteger(
                profile.maxSystems,
                DEFAULT_PROFILE.maxSystems,
                'ParticleBudgetProfile.maxSystems'
            ),
            maxEmitters: nonNegativeInteger(
                profile.maxEmitters,
                DEFAULT_PROFILE.maxEmitters,
                'ParticleBudgetProfile.maxEmitters'
            ),
            maxParticles: nonNegativeInteger(
                profile.maxParticles,
                DEFAULT_PROFILE.maxParticles,
                'ParticleBudgetProfile.maxParticles'
            ),
            maxDistance: nonNegative(
                profile.maxDistance,
                DEFAULT_PROFILE.maxDistance,
                'ParticleBudgetProfile.maxDistance'
            ),
            capacityScale: nonNegative(
                profile.capacityScale,
                DEFAULT_PROFILE.capacityScale,
                'ParticleBudgetProfile.capacityScale'
            ),
            spawnRateScale: nonNegative(
                profile.spawnRateScale,
                DEFAULT_PROFILE.spawnRateScale,
                'ParticleBudgetProfile.spawnRateScale'
            ),
            sorting: profile.sorting ?? DEFAULT_PROFILE.sorting,
            softParticles: profile.softParticles ?? DEFAULT_PROFILE.softParticles,
            collision: profile.collision ?? DEFAULT_PROFILE.collision,
            ribbons: profile.ribbons ?? DEFAULT_PROFILE.ribbons
        });
    }

    /** Resolve and immediately apply one complete frame-wide budget to live systems. */
    apply(
        systems: readonly ParticleSystem[],
        camera?: Camera
    ): readonly Readonly<ParticleBudgetDecision>[] {
        const identifiers = new Set<string>();
        for (const system of systems) {
            if (!(system instanceof ParticleSystem)) {
                throw new TypeError('ParticleBudgetManager.apply accepts ParticleSystem instances');
            }
            if (identifiers.has(system.budgetId)) {
                throw new TypeError(`Particle budgetId ${system.budgetId} is duplicated`);
            }
            identifiers.add(system.budgetId);
        }
        const decisions = this.resolve(
            systems.flatMap(system => system.createBudgetRequests(camera))
        );
        for (const system of systems) {
            system.applyBudgetDecisions(
                decisions.filter(decision => decision.systemId === system.budgetId)
            );
        }
        return decisions;
    }

    /** Resolve a complete frame at once so request order cannot alter the result. */
    resolve(
        requests: readonly Readonly<ParticleBudgetRequest>[]
    ): readonly Readonly<ParticleBudgetDecision>[] {
        const ordered = requests.map((request, index) => ({ request, index }));
        ordered.sort((left, right) => {
            const priority = (right.request.priority ?? 0) - (left.request.priority ?? 0);
            if (priority !== 0) return priority;
            const distance = (left.request.distance ?? 0) - (right.request.distance ?? 0);
            if (distance !== 0) return distance;
            const system = left.request.systemId.localeCompare(right.request.systemId);
            if (system !== 0) return system;
            return left.request.emitterId - right.request.emitterId;
        });
        const activeSystems = new Set<string>();
        let emitterCount = 0;
        let particleCount = 0;
        const decisions = new Array<Readonly<ParticleBudgetDecision>>(requests.length);
        for (const { request, index } of ordered) {
            if (!Number.isSafeInteger(request.capacity) || request.capacity < 0) {
                throw new RangeError('Particle budget request capacity is invalid');
            }
            if (!Number.isSafeInteger(request.estimatedAlive) || request.estimatedAlive < 0) {
                throw new RangeError('Particle budget request estimatedAlive is invalid');
            }
            const reasons: string[] = [];
            const newSystem = !activeSystems.has(request.systemId);
            let enabled = request.visible ?? true;
            if (!enabled) reasons.push('visibility');
            if ((request.distance ?? 0) > this.profile.maxDistance) {
                enabled = false;
                reasons.push('distance');
            }
            if (newSystem && activeSystems.size >= this.profile.maxSystems) {
                enabled = false;
                reasons.push('system-budget');
            }
            if (emitterCount >= this.profile.maxEmitters) {
                enabled = false;
                reasons.push('emitter-budget');
            }
            const scaledCapacity = Math.min(
                request.capacity,
                Math.floor(request.capacity * this.profile.capacityScale)
            );
            const remainingParticles = Math.max(0, this.profile.maxParticles - particleCount);
            const particleLimit = enabled ? Math.min(scaledCapacity, remainingParticles) : 0;
            if (particleLimit < request.capacity) {
                reasons.push('particle-budget');
            }
            if (particleLimit === 0 && request.capacity > 0) enabled = false;
            if (enabled) {
                activeSystems.add(request.systemId);
                emitterCount++;
                particleCount += particleLimit;
            }
            decisions[index] = Object.freeze({
                systemId: request.systemId,
                emitterId: request.emitterId,
                enabled,
                particleLimit,
                spawnRateScale: enabled ? this.profile.spawnRateScale : 0,
                sorting: enabled && this.profile.sorting,
                softParticles: enabled && this.profile.softParticles,
                collision: enabled && this.profile.collision,
                ribbons: enabled && this.profile.ribbons,
                reasons: Object.freeze(reasons)
            });
        }
        return Object.freeze(decisions);
    }
}
