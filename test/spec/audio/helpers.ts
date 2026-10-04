import { AudioClip, AudioEngine, type AudioEngineOptions } from '@hilo/addon-audio';

export function fixture(
    seconds = 0.5,
    options: AudioEngineOptions = {}
): { context: OfflineAudioContext; audio: AudioEngine; clip: AudioClip } {
    const context = new OfflineAudioContext(2, Math.ceil(seconds * 48000), 48000);
    const audio = new AudioEngine({
        context,
        compressor: false,
        parameterRampSeconds: 0,
        ...options
    });
    const buffer = context.createBuffer(1, 48000, 48000);
    buffer.getChannelData(0).fill(0.25);
    return { context, audio, clip: new AudioClip(buffer) };
}

export function rms(buffer: AudioBuffer, channel = 0, from = 0, to = buffer.duration): number {
    const samples = buffer.getChannelData(channel);
    const start = Math.floor(from * buffer.sampleRate);
    const end = Math.min(samples.length, Math.floor(to * buffer.sampleRate));
    let sum = 0;
    for (let i = start; i < end; i++) sum += (samples[i] ?? 0) ** 2;
    return Math.sqrt(sum / Math.max(1, end - start));
}

export function wave(frames = 4800): ArrayBuffer {
    const result = new ArrayBuffer(44 + frames * 2);
    const view = new DataView(result);
    const text = (offset: number, value: string): void => {
        for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
    };
    text(0, 'RIFF');
    view.setUint32(4, 36 + frames * 2, true);
    text(8, 'WAVE');
    text(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 48000, true);
    view.setUint32(28, 96000, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    text(36, 'data');
    view.setUint32(40, frames * 2, true);
    for (let i = 0; i < frames; i++)
        view.setInt16(
            44 + i * 2,
            Math.round(Math.sin((i * 2 * Math.PI * 440) / 48000) * 8192),
            true
        );
    return result;
}

export function deferred<T>(): {
    promise: Promise<T>;
    resolve(value: T): void;
    reject(reason: unknown): void;
} {
    let resolveValue: (value: T) => void = () => {
        throw new Error('Uninitialized deferred.');
    };
    let rejectValue: (reason: unknown) => void = () => {
        throw new Error('Uninitialized deferred.');
    };
    const promise = new Promise<T>((resolve, reject) => {
        resolveValue = resolve;
        rejectValue = reject;
    });
    return { promise, resolve: resolveValue, reject: rejectValue };
}
