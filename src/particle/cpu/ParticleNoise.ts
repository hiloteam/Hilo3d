function mix32(value: number): number {
    let mixed = value >>> 0;
    mixed = Math.imul(mixed ^ (mixed >>> 16), 0x7feb352d);
    mixed = Math.imul(mixed ^ (mixed >>> 15), 0x846ca68b);
    return (mixed ^ (mixed >>> 16)) >>> 0;
}

function lattice(x: number, y: number, z: number, seed: number): number {
    const hash = mix32(
        Math.imul(x | 0, 0x1f123bb5) ^
            Math.imul(y | 0, 0x5f356495) ^
            Math.imul(z | 0, 0x6c8e9cf5) ^
            seed
    );
    return Math.fround((hash / 0xffff_ffff) * 2 - 1);
}

function smooth(value: number): number {
    return value * value * (3 - 2 * value);
}

/** Deterministic scalar lattice value-noise reference. */
export function particleValueNoise(x: number, y: number, z: number, seed: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const z0 = Math.floor(z);
    const tx = smooth(x - x0);
    const ty = smooth(y - y0);
    const tz = smooth(z - z0);
    const lerp = (left: number, right: number, amount: number): number =>
        Math.fround(left + (right - left) * amount);
    const x00 = lerp(lattice(x0, y0, z0, seed), lattice(x0 + 1, y0, z0, seed), tx);
    const x10 = lerp(lattice(x0, y0 + 1, z0, seed), lattice(x0 + 1, y0 + 1, z0, seed), tx);
    const x01 = lerp(lattice(x0, y0, z0 + 1, seed), lattice(x0 + 1, y0, z0 + 1, seed), tx);
    const x11 = lerp(lattice(x0, y0 + 1, z0 + 1, seed), lattice(x0 + 1, y0 + 1, z0 + 1, seed), tx);
    return lerp(lerp(x00, x10, ty), lerp(x01, x11, ty), tz);
}

/** Three decorrelated scalar fields accumulated in a fixed octave order. */
export function particleVectorNoise(
    x: number,
    y: number,
    z: number,
    seed: number,
    octaves: number,
    lacunarity: number,
    persistence: number,
    target: Float32Array
): void {
    let frequency = 1;
    let amplitude = 1;
    let normalizer = 0;
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (let octave = 0; octave < octaves; octave += 1) {
        nx = Math.fround(
            nx +
                particleValueNoise(
                    x * frequency,
                    y * frequency,
                    z * frequency,
                    seed + octave * 17
                ) *
                    amplitude
        );
        ny = Math.fround(
            ny +
                particleValueNoise(
                    x * frequency,
                    y * frequency,
                    z * frequency,
                    seed + 101 + octave * 17
                ) *
                    amplitude
        );
        nz = Math.fround(
            nz +
                particleValueNoise(
                    x * frequency,
                    y * frequency,
                    z * frequency,
                    seed + 211 + octave * 17
                ) *
                    amplitude
        );
        normalizer += amplitude;
        frequency *= lacunarity;
        amplitude *= persistence;
    }
    target[0] = Math.fround(nx / normalizer);
    target[1] = Math.fround(ny / normalizer);
    target[2] = Math.fround(nz / normalizer);
}

/** Curl of the shared vector field using a fixed float32 central-difference reference. */
export function particleCurlNoise(
    x: number,
    y: number,
    z: number,
    seed: number,
    octaves: number,
    lacunarity: number,
    persistence: number,
    target: Float32Array
): void {
    const epsilon = 1 / 128;
    particleVectorNoise(x, y + epsilon, z, seed, octaves, lacunarity, persistence, target);
    const positiveYFz = target[2] ?? 0;
    const positiveYFx = target[0] ?? 0;
    particleVectorNoise(x, y - epsilon, z, seed, octaves, lacunarity, persistence, target);
    const dFzDy = (positiveYFz - (target[2] ?? 0)) / (2 * epsilon);
    const dFxDy = (positiveYFx - (target[0] ?? 0)) / (2 * epsilon);
    particleVectorNoise(x, y, z + epsilon, seed, octaves, lacunarity, persistence, target);
    const positiveZFy = target[1] ?? 0;
    const positiveZFx = target[0] ?? 0;
    particleVectorNoise(x, y, z - epsilon, seed, octaves, lacunarity, persistence, target);
    const dFyDz = (positiveZFy - (target[1] ?? 0)) / (2 * epsilon);
    const dFxDz = (positiveZFx - (target[0] ?? 0)) / (2 * epsilon);
    particleVectorNoise(x + epsilon, y, z, seed, octaves, lacunarity, persistence, target);
    const positiveXFz = target[2] ?? 0;
    const positiveXFy = target[1] ?? 0;
    particleVectorNoise(x - epsilon, y, z, seed, octaves, lacunarity, persistence, target);
    const dFzDx = (positiveXFz - (target[2] ?? 0)) / (2 * epsilon);
    const dFyDx = (positiveXFy - (target[1] ?? 0)) / (2 * epsilon);
    target[0] = Math.fround(dFzDy - dFyDz);
    target[1] = Math.fround(dFxDz - dFzDx);
    target[2] = Math.fround(dFyDx - dFxDy);
}
