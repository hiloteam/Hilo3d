const UINT32_MAX_PLUS_ONE = 0x1_0000_0000;

function mix32(value: number): number {
    let mixed = value >>> 0;
    mixed = Math.imul(mixed ^ (mixed >>> 16), 0x7feb352d);
    mixed = Math.imul(mixed ^ (mixed >>> 15), 0x846ca68b);
    return (mixed ^ (mixed >>> 16)) >>> 0;
}

function randomUintComponents(
    systemSeed: number,
    emitterId: number,
    particleId: number,
    generation: number,
    lane: number
): number {
    let value = mix32(systemSeed);
    value = mix32(value ^ Math.imul(emitterId, 0x9e3779b1));
    value = mix32(value ^ Math.imul(particleId, 0x85ebca77));
    value = mix32(value ^ Math.imul(generation, 0xc2b2ae3d));
    return mix32(value ^ Math.imul(lane, 0x27d4eb2f));
}

/** Stable counter key used by CPU code and generated particle compute kernels. */
export interface ParticleRandomKey {
    readonly systemSeed: number;
    readonly emitterId: number;
    readonly particleId: number;
    readonly generation: number;
    readonly lane: number;
}

/** Return one deterministic unsigned integer without consuming mutable global state. */
export function particleRandomUint(key: Readonly<ParticleRandomKey>): number {
    return randomUintComponents(
        key.systemSeed,
        key.emitterId,
        key.particleId,
        key.generation,
        key.lane
    );
}

/** Return a deterministic float in the half-open range [0, 1). */
export function particleRandomFloat(key: Readonly<ParticleRandomKey>): number {
    return Math.fround(particleRandomUint(key) / UINT32_MAX_PLUS_ONE);
}

/** Sample another property lane without allocating a derived key object. */
export function particleRandomFloatLane(key: Readonly<ParticleRandomKey>, lane: number): number {
    return Math.fround(
        randomUintComponents(key.systemSeed, key.emitterId, key.particleId, key.generation, lane) /
            UINT32_MAX_PLUS_ONE
    );
}

/** Produce a decorrelated key for another property lane. */
export function particleRandomLane(
    key: Readonly<ParticleRandomKey>,
    lane: number
): ParticleRandomKey {
    return {
        systemSeed: key.systemSeed,
        emitterId: key.emitterId,
        particleId: key.particleId,
        generation: key.generation,
        lane
    };
}
