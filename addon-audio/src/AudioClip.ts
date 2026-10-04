/** Immutable metadata around a shared decoded buffer. Treat the buffer's PCM as read-only. */
export class AudioClip {
    /** The browser-owned decoded PCM. It can be shared by arbitrarily many voices. */
    readonly buffer: AudioBuffer;
    readonly name: string;

    constructor(buffer: AudioBuffer, name = '') {
        if (buffer.length < 1 || !Number.isFinite(buffer.duration) || buffer.duration <= 0) {
            throw new RangeError('Audio clips require nonempty finite PCM.');
        }
        this.buffer = buffer;
        this.name = name;
    }

    /** Playback duration in seconds at rate 1. */
    get duration(): number {
        return this.buffer.duration;
    }
    /** Decoded float32 PCM bytes, excluding browser implementation overhead. */
    get byteLength(): number {
        return this.buffer.length * this.buffer.numberOfChannels * 4;
    }
}

const pins = new WeakMap<AudioClip, number>();
export function retainClip(clip: AudioClip): void {
    pins.set(clip, clipPins(clip) + 1);
}
export function releaseClip(clip: AudioClip): void {
    pins.set(clip, Math.max(0, clipPins(clip) - 1));
}
export function clipPins(clip: AudioClip): number {
    return pins.get(clip) ?? 0;
}
