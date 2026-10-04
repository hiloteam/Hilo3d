import type { AudioClip } from './AudioClip.js';
import { finite } from './internal.js';

/** Weighted one-shot variations with optional immediate-repeat suppression. */
export interface AudioCueOptions {
    readonly variations: readonly { readonly clip: AudioClip; readonly weight?: number }[];
    readonly volume?: readonly [number, number];
    readonly playbackRate?: readonly [number, number];
    readonly avoidRepeat?: boolean;
    readonly concurrency?: string;
}

/** Reusable cue. Selection state belongs to the cue; randomization happens only on triggers. */
export class AudioCue {
    readonly concurrency: string | undefined;
    private readonly variations: readonly { readonly clip: AudioClip; readonly weight: number }[];
    private readonly minVolume: number;
    private readonly maxVolume: number;
    private readonly minRate: number;
    private readonly maxRate: number;
    private readonly avoidRepeat: boolean;
    private previous = -1;

    constructor(options: AudioCueOptions) {
        if (options.variations.length === 0 || options.variations.length > 1024)
            throw new RangeError('Audio cues require 1–1024 variations.');
        this.variations = options.variations.map(entry => ({
            clip: entry.clip,
            weight: finite(entry.weight ?? 1, 'cue weight', 1e-6, 1e6)
        }));
        this.minVolume = finite(options.volume?.[0] ?? 1, 'cue min volume', 0, 16);
        this.maxVolume = finite(options.volume?.[1] ?? 1, 'cue max volume', this.minVolume, 16);
        this.minRate = finite(options.playbackRate?.[0] ?? 1, 'cue min rate', 0.01, 16);
        this.maxRate = finite(options.playbackRate?.[1] ?? 1, 'cue max rate', this.minRate, 16);
        this.avoidRepeat = options.avoidRepeat ?? true;
        this.concurrency = options.concurrency;
    }

    /** Select a clip and modulation values. Caller supplies deterministic randomness when needed. */
    select(random: () => number = Math.random): {
        clip: AudioClip;
        volume: number;
        playbackRate: number;
    } {
        const draw = (): number => {
            const result = finite(random(), 'random value', 0, 1);
            if (result === 1) throw new RangeError('Random value must be less than 1.');
            return result;
        };
        const skip = this.avoidRepeat && this.variations.length > 1 ? this.previous : -1;
        let total = 0;
        for (let i = 0; i < this.variations.length; i++)
            if (i !== skip) total += this.variations[i]?.weight ?? 0;
        let choice = draw() * total;
        let selected = 0;
        for (let i = 0; i < this.variations.length; i++) {
            const entry = this.variations[i];
            if (!entry || i === skip) continue;
            selected = i;
            choice -= entry.weight;
            if (choice < 0) break;
        }
        const entry = this.variations[selected];
        if (!entry) throw new Error('Audio cue has no selectable variation.');
        const volume = this.minVolume + draw() * (this.maxVolume - this.minVolume);
        const playbackRate = this.minRate + draw() * (this.maxRate - this.minRate);
        this.previous = selected;
        return { clip: entry.clip, volume, playbackRate };
    }
}
