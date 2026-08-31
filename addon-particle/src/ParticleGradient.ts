import type { ParticleColor } from './ParticleTypes.js';

/** One linear-RGBA gradient key in normalized authoring time. */
export interface ParticleGradientKey {
    readonly time: number;
    readonly color: ParticleColor;
}

function requireColor(color: ParticleColor, label: string): ParticleColor {
    if (color.some(component => !Number.isFinite(component))) {
        throw new TypeError(`${label} must contain four finite components`);
    }
    return Object.freeze([
        Math.fround(color[0]),
        Math.fround(color[1]),
        Math.fround(color[2]),
        Math.fround(color[3])
    ]);
}

/** Immutable linear-RGBA gradient with a fixed CPU/GPU LUT representation. */
class ParticleGradient {
    readonly keys: readonly Readonly<ParticleGradientKey>[];

    constructor(keys: readonly ParticleGradientKey[]) {
        if (keys.length === 0) throw new RangeError('ParticleGradient requires at least one key');
        const sorted = keys
            .map((key, index) => {
                if (!Number.isFinite(key.time)) {
                    throw new TypeError(
                        `ParticleGradient key ${String(index)} time must be finite`
                    );
                }
                return {
                    time: Math.fround(key.time),
                    color: requireColor(key.color, `ParticleGradient key ${String(index)} color`)
                };
            })
            .sort((left, right) => left.time - right.time);
        for (let index = 1; index < sorted.length; index += 1) {
            if (sorted[index]?.time === sorted[index - 1]?.time) {
                throw new RangeError('ParticleGradient key times must be unique');
            }
        }
        this.keys = Object.freeze(
            sorted.map(key => Object.freeze({ time: key.time, color: key.color }))
        );
        Object.freeze(this);
    }

    /** Sample into a caller-provided array to avoid hot-path allocation. */
    sample(time: number, target: Float32Array, offset = 0): void {
        if (!Number.isFinite(time))
            throw new TypeError('ParticleGradient sample time must be finite');
        if (offset < 0 || offset + 4 > target.length) {
            throw new RangeError('ParticleGradient sample target range is invalid');
        }
        const normalized = Math.min(1, Math.max(0, time));
        let left = this.keys[0];
        let right = this.keys[this.keys.length - 1];
        if (!left || !right) throw new Error('ParticleGradient lost its keys');
        for (let index = 1; index < this.keys.length; index += 1) {
            const candidate = this.keys[index];
            if (!candidate || normalized > candidate.time) {
                left = candidate ?? left;
                continue;
            }
            right = candidate;
            break;
        }
        const span = right.time - left.time;
        const amount = span <= 0 ? 0 : (normalized - left.time) / span;
        for (let component = 0; component < 4; component += 1) {
            const a = left.color[component] ?? 0;
            const b = right.color[component] ?? a;
            target[offset + component] = Math.fround(a + (b - a) * amount);
        }
    }

    /** Bake tightly packed linear RGBA float32 texels. */
    bake(sampleCount = 256): Float32Array {
        if (!Number.isSafeInteger(sampleCount) || sampleCount < 2 || sampleCount > 65_536) {
            throw new RangeError('ParticleGradient LUT sampleCount must be between 2 and 65536');
        }
        const values = new Float32Array(sampleCount * 4);
        const divisor = sampleCount - 1;
        for (let index = 0; index < sampleCount; index += 1) {
            this.sample(index / divisor, values, index * 4);
        }
        return values;
    }
}

export default ParticleGradient;
