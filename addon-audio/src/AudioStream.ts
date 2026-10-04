import type { AudioEngine } from './AudioEngine.js';
import { busInput, type AudioBus } from './AudioMixer.js';
import { finite, Ramp } from './internal.js';

/** Streaming music/dialogue, independent of decoded buffer/voice budgets. */
export interface AudioStreamOptions {
    readonly bus?: AudioBus;
    readonly volume?: number;
    readonly loop?: boolean;
    readonly crossOrigin?: 'anonymous' | 'use-credentials';
}

/** Owns one HTML media element and its graph. Codec support and buffering are browser-defined. */
export class AudioStream {
    readonly bus: AudioBus;
    private readonly media: HTMLAudioElement;
    private readonly source: MediaElementAudioSourceNode;
    private readonly gain: GainNode;
    private readonly volumeRamp: Ramp;
    private destroyed = false;
    private generation = 0;
    private error: unknown;

    /** @internal Use AudioEngine.createStream(), which enforces admission and ownership. */
    constructor(
        private readonly engine: AudioEngine,
        context: AudioContext,
        url: string,
        options: AudioStreamOptions = {}
    ) {
        if (!url.trim()) throw new TypeError('Audio stream URL must not be empty.');
        const volume = finite(options.volume ?? 1, 'stream volume', 0, 16);
        this.bus = options.bus ?? engine.mixer.master;
        engine.mixer.assertBus(this.bus);
        this.media = document.createElement('audio');
        this.media.crossOrigin = options.crossOrigin ?? 'anonymous';
        this.media.preload = 'metadata';
        this.media.loop = options.loop ?? false;
        this.gain = context.createGain();
        this.gain.gain.value = volume;
        this.volumeRamp = new Ramp(volume);
        this.source = context.createMediaElementSource(this.media);
        this.source.connect(this.gain).connect(busInput(this.bus));
        this.media.onerror = (): void => {
            this.error = this.media.error ?? new Error('Audio stream failed.');
        };
        this.media.src = url;
    }

    get playing(): boolean {
        return !this.destroyed && !this.media.paused && !this.media.ended && !this.media.error;
    }
    get position(): number {
        return this.media.currentTime;
    }
    /** NaN until metadata arrives; Infinity is possible for live streams. */
    get duration(): number {
        return this.media.duration;
    }
    get lastError(): unknown {
        return this.error;
    }
    get volume(): number {
        return this.volumeRamp.target;
    }

    /** Autoplay rejection is returned to the caller. Call from a user gesture after engine.resume(). */
    async play(): Promise<void> {
        this.assertAlive();
        const generation = ++this.generation;
        try {
            await this.media.play();
            if (this.destroyed || generation !== this.generation)
                throw new DOMException('Stream play superseded', 'AbortError');
        } catch (error) {
            this.error = error;
            throw error;
        }
    }

    pause(): void {
        this.assertAlive();
        this.generation++;
        this.media.pause();
    }
    seek(seconds: number): void {
        this.assertAlive();
        finite(seconds, 'stream position', 0);
        this.media.currentTime = seconds;
    }
    setVolume(value: number, seconds = 0.02): void {
        this.assertAlive();
        finite(value, 'stream volume', 0, 16);
        finite(seconds, 'fade seconds', 0);
        this.volumeRamp.set(value, seconds, this.engine.context.currentTime, this.gain.gain);
    }
    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.generation++;
        this.media.pause();
        this.media.onerror = null;
        this.media.removeAttribute('src');
        this.media.load();
        this.source.disconnect();
        this.gain.disconnect();
        this.engine.releaseStream(this);
    }
    private assertAlive(): void {
        if (this.destroyed) throw new Error('Audio stream is destroyed.');
    }
}
