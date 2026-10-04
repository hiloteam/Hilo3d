import type { AudioPose, AudioVector3 } from './types.js';

export function finite(value: number, name: string, min = -Infinity, max = Infinity): number {
    if (!Number.isFinite(value) || value < min || value > max) {
        throw new RangeError(`${name} must be finite and in [${String(min)}, ${String(max)}].`);
    }
    return value;
}

export function integer(value: number, name: string, min = 1, max = 65536): number {
    finite(value, name, min, max);
    if (!Number.isInteger(value)) throw new RangeError(`${name} must be an integer.`);
    return value;
}

export function vector(value: AudioVector3, name: string): void {
    finite(value.x, `${name}.x`);
    finite(value.y, `${name}.y`);
    finite(value.z, `${name}.z`);
}

export function pose(): AudioPose {
    return { x: 0, y: 0, z: 0, forwardX: 0, forwardY: 0, forwardZ: -1, upX: 0, upY: 1, upZ: 0 };
}

export function validatePose(value: AudioPose): void {
    if (
        !Number.isFinite(value.x) ||
        !Number.isFinite(value.y) ||
        !Number.isFinite(value.z) ||
        !Number.isFinite(value.forwardX) ||
        !Number.isFinite(value.forwardY) ||
        !Number.isFinite(value.forwardZ) ||
        !Number.isFinite(value.upX) ||
        !Number.isFinite(value.upY) ||
        !Number.isFinite(value.upZ)
    ) {
        throw new RangeError('Audio poses must contain finite values.');
    }
    const forwardLength = Math.hypot(value.forwardX, value.forwardY, value.forwardZ);
    const upLength = Math.hypot(value.upX, value.upY, value.upZ);
    if (forwardLength < 1e-8 || upLength < 1e-8)
        throw new RangeError('Audio axes must be nonzero.');
    value.forwardX /= forwardLength;
    value.forwardY /= forwardLength;
    value.forwardZ /= forwardLength;
    value.upX /= upLength;
    value.upY /= upLength;
    value.upZ /= upLength;
    const dot =
        value.forwardX * value.upX + value.forwardY * value.upY + value.forwardZ * value.upZ;
    if (Math.abs(dot) > 0.9999) throw new RangeError('Audio forward and up must not be parallel.');
}

/** Scalar automation with an explicit clock, including correct interruption of a running fade. */
export class Ramp {
    private from: number;
    target: number;
    private start = 0;
    private end = 0;

    constructor(value: number) {
        this.from = value;
        this.target = value;
    }

    value(now: number): number {
        if (now >= this.end) return this.target;
        if (now <= this.start) return this.from;
        return (
            this.from + ((this.target - this.from) * (now - this.start)) / (this.end - this.start)
        );
    }

    set(target: number, seconds: number, now: number, param?: AudioParam): void {
        const current = this.value(now);
        this.from = current;
        this.target = target;
        this.start = now;
        this.end = now + seconds;
        if (param) {
            param.cancelScheduledValues(now);
            param.setValueAtTime(seconds === 0 ? target : current, now);
            if (seconds > 0) param.linearRampToValueAtTime(target, this.end);
        }
    }

    apply(param: AudioParam, now: number): void {
        param.cancelScheduledValues(now);
        param.setValueAtTime(this.value(now), now);
        if (this.start > now) param.setValueAtTime(this.from, this.start);
        if (this.end > now) param.linearRampToValueAtTime(this.target, this.end);
    }
}
