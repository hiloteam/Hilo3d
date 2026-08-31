/** Addressing behavior outside the normalized curve domain. */
export type ParticleCurveWrapMode = 'clamp' | 'loop' | 'ping-pong';
/** Interpolation applied between authored curve keyframes. */
export type ParticleCurveInterpolation = 'linear' | 'smooth';

/** One scalar key in normalized authoring time. */
export interface ParticleCurveKeyframe {
    readonly time: number;
    readonly value: number;
}

/** Immutable curve construction options. */
export interface ParticleCurveOptions {
    readonly wrap?: ParticleCurveWrapMode;
    readonly interpolation?: ParticleCurveInterpolation;
}

function requireFinite(value: number, label: string): number {
    if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
    return Math.fround(value);
}

function wrapTime(time: number, mode: ParticleCurveWrapMode): number {
    if (mode === 'clamp') return Math.min(1, Math.max(0, time));
    const cycle = time - Math.floor(time);
    if (mode === 'loop') return cycle;
    const doubled = time - Math.floor(time / 2) * 2;
    return doubled <= 1 ? doubled : 2 - doubled;
}

/** Immutable scalar curve baked to identical float32 LUT bytes for CPU and GPU plans. */
class ParticleCurve {
    readonly keys: readonly Readonly<ParticleCurveKeyframe>[];
    readonly wrap: ParticleCurveWrapMode;
    readonly interpolation: ParticleCurveInterpolation;

    constructor(keys: readonly ParticleCurveKeyframe[], options: ParticleCurveOptions = {}) {
        if (keys.length === 0) throw new RangeError('ParticleCurve requires at least one keyframe');
        const sorted = keys
            .map((key, index) => ({
                time: requireFinite(key.time, `ParticleCurve key ${String(index)} time`),
                value: requireFinite(key.value, `ParticleCurve key ${String(index)} value`)
            }))
            .sort((left, right) => left.time - right.time);
        for (let index = 1; index < sorted.length; index += 1) {
            if (sorted[index]?.time === sorted[index - 1]?.time) {
                throw new RangeError('ParticleCurve keyframe times must be unique');
            }
        }
        this.keys = Object.freeze(sorted.map(key => Object.freeze(key)));
        this.wrap = options.wrap ?? 'clamp';
        this.interpolation = options.interpolation ?? 'linear';
        Object.freeze(this);
    }

    /** Sample the authoring curve with explicitly defined wrap and interpolation semantics. */
    sample(time: number): number {
        if (!Number.isFinite(time)) throw new TypeError('ParticleCurve sample time must be finite');
        const wrapped = wrapTime(time, this.wrap);
        const first = this.keys[0];
        const last = this.keys[this.keys.length - 1];
        if (!first || !last) throw new Error('ParticleCurve lost its keyframes');
        if (wrapped <= first.time) return first.value;
        if (wrapped >= last.time) return last.value;
        for (let index = 1; index < this.keys.length; index += 1) {
            const right = this.keys[index];
            const left = this.keys[index - 1];
            if (!left || !right || wrapped > right.time) continue;
            let amount = (wrapped - left.time) / (right.time - left.time);
            if (this.interpolation === 'smooth') amount = amount * amount * (3 - 2 * amount);
            return Math.fround(left.value + (right.value - left.value) * amount);
        }
        return last.value;
    }

    /** Bake a fixed-size float32 lookup table. */
    bake(sampleCount = 256): Float32Array {
        if (!Number.isSafeInteger(sampleCount) || sampleCount < 2 || sampleCount > 65_536) {
            throw new RangeError('ParticleCurve LUT sampleCount must be between 2 and 65536');
        }
        const values = new Float32Array(sampleCount);
        const divisor = sampleCount - 1;
        for (let index = 0; index < sampleCount; index += 1) {
            values[index] = this.sample(index / divisor);
        }
        return values;
    }
}

export default ParticleCurve;
