import { animationItem } from './animationArray';
import { quat } from 'gl-matrix';

/** Properties supported by the numeric pose mixer. Custom channels use an explicit binding. */
export type AnimationProperty =
    'translation' | 'rotation' | 'scale' | 'weights' | `custom:${string}`;
/** glTF interpolation modes. Cubic data is laid out as in-tangent/value/out-tangent per key. */
export type AnimationInterpolation = 'LINEAR' | 'STEP' | 'CUBICSPLINE';
/** Flat, numeric animation channel authoring data. Times are in seconds. */
export interface AnimationTrackParameters {
    target: string;
    property: AnimationProperty;
    times: ArrayLike<number>;
    values: ArrayLike<number>;
    components?: number;
    interpolation?: AnimationInterpolation;
}

/** Validated immutable channel data, shared by every character playing the clip. */
export class AnimationTrack {
    readonly target: string;
    readonly property: AnimationProperty;
    readonly components: number;
    readonly interpolation: AnimationInterpolation;
    readonly startTime: number;
    readonly endTime: number;
    private readonly times: Float64Array;
    private readonly values: Float32Array;

    constructor(params: AnimationTrackParameters) {
        this.target = params.target;
        this.property = params.property;
        this.components = params.components ?? (params.property === 'rotation' ? 4 : 3);
        this.interpolation = params.interpolation ?? 'LINEAR';
        if (
            !Number.isSafeInteger(this.components) ||
            this.components < 1 ||
            ((this.property === 'translation' || this.property === 'scale') &&
                this.components !== 3) ||
            (this.property === 'rotation' && this.components !== 4)
        ) {
            throw new RangeError('Invalid animation track component count.');
        }
        if (!['LINEAR', 'STEP', 'CUBICSPLINE'].includes(this.interpolation)) {
            throw new RangeError('Unsupported animation interpolation.');
        }
        this.times = Float64Array.from(params.times);
        this.values = Float32Array.from(params.values);
        const stride = this.components * (this.interpolation === 'CUBICSPLINE' ? 3 : 1);
        if (!this.times.length || this.values.length !== this.times.length * stride) {
            throw new RangeError('Animation key/value counts do not match.');
        }
        for (let i = 0; i < this.times.length; i++) {
            const time = animationItem(this.times, i);
            if (
                !Number.isFinite(time) ||
                time < 0 ||
                (i > 0 && time <= animationItem(this.times, i - 1))
            ) {
                throw new RangeError(
                    'Animation times must be finite, nonnegative and strictly increasing.'
                );
            }
        }
        for (const value of this.values) {
            if (!Number.isFinite(value)) throw new RangeError('Animation values must be finite.');
        }
        if (this.property === 'rotation') {
            for (let i = 0; i < this.times.length; i++) {
                const offset = i * stride + (stride === 12 ? 4 : 0);
                const length = Math.hypot(
                    animationItem(this.values, offset),
                    animationItem(this.values, offset + 1),
                    animationItem(this.values, offset + 2),
                    animationItem(this.values, offset + 3)
                );
                if (length < 1e-8)
                    throw new RangeError('Animation rotation key must have nonzero length.');
                // Cubic tangents retain their authored magnitude; only linear/step keys normalize here.
                if (stride === 4)
                    for (let j = 0; j < 4; j++)
                        this.values[offset + j] = animationItem(this.values, offset + j) / length;
            }
        }
        this.startTime = animationItem(this.times, 0);
        this.endTime = animationItem(this.times, this.times.length - 1);
        Object.freeze(this);
    }

    /** Samples into caller-owned storage without mutating keys or allocating scratch arrays. */
    sample(time: number, output: Float32Array): void {
        if (!Number.isFinite(time) || output.length !== this.components)
            throw new RangeError('Invalid animation sample arguments.');
        let low = 0;
        let high = this.times.length - 1;
        while (low < high) {
            const middle = (low + high + 1) >>> 1;
            if (animationItem(this.times, middle) <= time) low = middle;
            else high = middle - 1;
        }
        const next = Math.min(low + 1, this.times.length - 1);
        const interval = animationItem(this.times, next) - animationItem(this.times, low);
        const t =
            interval === 0
                ? 0
                : Math.max(0, Math.min(1, (time - animationItem(this.times, low)) / interval));
        const n = this.components;
        const cubic = this.interpolation === 'CUBICSPLINE';
        const stride = cubic ? n * 3 : n;
        const a = low * stride + (cubic ? n : 0);
        const b = next * stride + (cubic ? n : 0);
        if (this.property === 'rotation' && this.interpolation === 'LINEAR') {
            // Scalar shortest-arc slerp avoids per-sample subarray views.
            let dot = 0;
            for (let i = 0; i < 4; i++)
                dot += animationItem(this.values, a + i) * animationItem(this.values, b + i);
            const sign = dot < 0 ? -1 : 1;
            dot = Math.min(1, Math.abs(dot));
            let wa = 1 - t;
            let wb = t;
            if (dot < 0.9995) {
                const angle = Math.acos(dot);
                const inverseSin = 1 / Math.sin(angle);
                wa = Math.sin((1 - t) * angle) * inverseSin;
                wb = Math.sin(t * angle) * inverseSin;
            }
            for (let i = 0; i < n; i++)
                output[i] =
                    animationItem(this.values, a + i) * wa +
                    animationItem(this.values, b + i) * wb * sign;
        } else {
            const t2 = t * t;
            const t3 = t2 * t;
            for (let i = 0; i < n; i++) {
                const v0 = animationItem(this.values, a + i);
                const v1 = animationItem(this.values, b + i);
                output[i] =
                    this.interpolation === 'STEP'
                        ? v0
                        : cubic
                          ? (2 * t3 - 3 * t2 + 1) * v0 +
                            (t3 - 2 * t2 + t) * interval * animationItem(this.values, a + n + i) +
                            (-2 * t3 + 3 * t2) * v1 +
                            (t3 - t2) * interval * animationItem(this.values, b - n + i)
                          : v0 + (v1 - v0) * t;
            }
        }
        if (this.property === 'rotation') {
            if (
                Math.hypot(
                    animationItem(output, 0),
                    animationItem(output, 1),
                    animationItem(output, 2),
                    animationItem(output, 3)
                ) < 1e-8
            ) {
                for (let i = 0; i < 4; i++) output[i] = animationItem(this.values, a + i);
            }
            quat.normalize(output, output);
        }
    }
}
