import { type AudioClip, releaseClip, retainClip } from './AudioClip.js';
import { finite, integer, Ramp } from './internal.js';

/** Immutable bus topology with independently automated volume, mute and ducking gains. */
export interface AudioBusOptions {
    /** Defaults to the master bus; immutable after creation. */
    readonly parent?: AudioBus;
    /** Linear amplitude in [0,16], default 1. */
    readonly volume?: number;
    /** Low-pass cutoff in Hz, default Nyquist. */
    readonly lowpassHz?: number;
}

/** A complete or partial mixer snapshot; omitted buses retain their current settings. */
export interface AudioMixSnapshot {
    readonly buses: readonly {
        readonly bus: AudioBus;
        readonly volume: number;
        readonly lowpassHz?: number;
    }[];
}

/** Activity-based sidechain ducking. Multiple rules use the strongest attenuation. */
export interface AudioDuckingOptions {
    readonly source: AudioBus;
    readonly target: AudioBus;
    readonly gain?: number;
    readonly attackSeconds?: number;
    readonly releaseSeconds?: number;
}

interface BusState {
    readonly context: BaseAudioContext;
    readonly input: GainNode;
    readonly filter: BiquadFilterNode;
    readonly volume: GainNode;
    readonly mute: GainNode;
    readonly output: GainNode;
    readonly volumeRamp: Ramp;
    readonly filterRamp: Ramp;
    readonly muteRamp: Ramp;
    readonly duckRamp: Ramp;
    readonly sends: Map<AudioBus, GainNode>;
    reverb?: ConvolverNode;
    impulse?: AudioClip;
    active: boolean;
    destroyed: boolean;
    duckTarget: number;
    duckSeconds: number;
    duckRelease: number;
    selectionGain: number;
    selectionEpoch: number;
}
const states = new WeakMap<AudioBus, BusState>();

function state(bus: AudioBus): BusState {
    const value = states.get(bus);
    if (!value || value.destroyed) throw new Error('Audio bus is destroyed.');
    return value;
}

export function busInput(bus: AudioBus): AudioNode {
    return state(bus).input;
}

/** Mixer channel. Create through AudioMixer.createBus; parent topology cannot form cycles. */
export class AudioBus {
    /** Unique name within its mixer. */
    readonly name: string;
    /** Immutable parent route; null only for master. */
    readonly parent: AudioBus | null;

    constructor(context: BaseAudioContext, name: string, parent: AudioBus | null = null) {
        if (!name.trim()) throw new TypeError('Audio bus name must not be empty.');
        if (parent && state(parent).context !== context)
            throw new Error('Audio bus context mismatch.');
        this.name = name;
        this.parent = parent;
        const input = context.createGain();
        const filter = context.createBiquadFilter();
        const volume = context.createGain();
        const mute = context.createGain();
        const output = context.createGain();
        filter.type = 'lowpass';
        filter.frequency.value = context.sampleRate / 2;
        filter.Q.value = 0;
        input.connect(filter).connect(volume).connect(mute).connect(output);
        if (parent) output.connect(busInput(parent));
        states.set(this, {
            context,
            input,
            filter,
            volume,
            mute,
            output,
            volumeRamp: new Ramp(1),
            filterRamp: new Ramp(context.sampleRate / 2),
            muteRamp: new Ramp(1),
            duckRamp: new Ramp(1),
            sends: new Map(),
            active: false,
            destroyed: false,
            duckTarget: 1,
            duckSeconds: 0,
            duckRelease: 0.3,
            selectionGain: 1,
            selectionEpoch: 0
        });
    }

    /** Target amplitude of the current fade. */
    get volume(): number {
        return state(this).volumeRamp.target;
    }
    /** Target mute state, independent of volume/snapshots. */
    get muted(): boolean {
        return state(this).muteRamp.target === 0;
    }
    /** Target low-pass cutoff in Hz. */
    get lowpassHz(): number {
        return state(this).filterRamp.target;
    }

    /** Current dry-path gain including parents, snapshot fades, mute and ducking. */
    get effectiveGain(): number {
        const data = state(this);
        const now = data.context.currentTime;
        const own =
            data.volumeRamp.value(now) * data.muteRamp.value(now) * data.duckRamp.value(now);
        return own * (this.parent?.effectiveGain ?? 1);
    }

    /** Fade to a linear amplitude in [0,16] on the audio clock. */
    setVolume(value: number, seconds = 0.02): void {
        finite(value, 'volume', 0, 16);
        finite(seconds, 'fade seconds', 0);
        const data = state(this);
        data.volumeRamp.set(value, seconds, data.context.currentTime, data.volume.gain);
    }

    /** Smoothly mute/unmute without replacing authored volume. */
    setMuted(value: boolean, seconds = 0.02): void {
        finite(seconds, 'fade seconds', 0);
        const data = state(this);
        data.muteRamp.set(value ? 0 : 1, seconds, data.context.currentTime, data.mute.gain);
    }

    /** Fade the low-pass cutoff between 10 Hz and context Nyquist. */
    setLowpass(value: number, seconds = 0.02): void {
        const data = state(this);
        finite(value, 'lowpassHz', 10, data.context.sampleRate / 2);
        finite(seconds, 'fade seconds', 0);
        data.filterRamp.set(value, seconds, data.context.currentTime, data.filter.frequency);
    }

    /** Install a 100% wet convolution effect. Use a send into a dedicated bus for wet/dry mixing. */
    setReverb(impulse: AudioClip | null): void {
        const data = state(this);
        if (
            impulse &&
            (impulse.buffer.sampleRate !== data.context.sampleRate ||
                ![1, 2, 4].includes(impulse.buffer.numberOfChannels))
        ) {
            throw new RangeError('Reverb requires 1, 2 or 4 channels at the context sample rate.');
        }
        if (data.impulse === impulse || (!data.impulse && !impulse)) return;
        let reverb: ConvolverNode | undefined;
        if (impulse) {
            reverb = data.context.createConvolver();
            reverb.normalize = false;
            reverb.buffer = impulse.buffer;
        }
        data.filter.disconnect();
        data.reverb?.disconnect();
        if (data.impulse) releaseClip(data.impulse);
        delete data.reverb;
        delete data.impulse;
        if (reverb && impulse) {
            data.filter.connect(reverb).connect(data.volume);
            data.reverb = reverb;
            data.impulse = impulse;
            retainClip(impulse);
        } else data.filter.connect(data.volume);
    }
}

interface DuckRule {
    readonly source: AudioBus;
    readonly target: AudioBus;
    readonly gain: number;
    readonly attack: number;
    readonly release: number;
}

/** Hierarchical mixer with validated sends, atomic snapshots and bounded sidechain rules. */
export class AudioMixer {
    readonly master: AudioBus;
    private readonly buses = new Map<string, AudioBus>();
    private readonly ducks = new Set<DuckRule>();
    private readonly compressor: DynamicsCompressorNode | undefined;
    private readonly maxBuses: number;
    private readonly maxSends: number;
    private sendCount = 0;
    private destroyed = false;
    private selectionEpoch = 0;

    constructor(
        private readonly context: BaseAudioContext,
        options: {
            readonly maxBuses?: number;
            readonly maxSends?: number;
            readonly masterVolume?: number;
            readonly compressor?: boolean;
        } = {}
    ) {
        this.maxBuses = integer(options.maxBuses ?? 32, 'maxBuses', 1, 1024);
        this.maxSends = integer(options.maxSends ?? 64, 'maxSends', 0, 4096);
        finite(options.masterVolume ?? 1, 'masterVolume', 0, 16);
        this.master = new AudioBus(context, 'master');
        this.buses.set('master', this.master);
        this.master.setVolume(options.masterVolume ?? 1, 0);
        if (options.compressor ?? true) {
            this.compressor = context.createDynamicsCompressor();
            this.compressor.threshold.value = -3;
            this.compressor.knee.value = 3;
            this.compressor.ratio.value = 12;
            this.compressor.attack.value = 0.003;
            this.compressor.release.value = 0.15;
            state(this.master).output.connect(this.compressor).connect(context.destination);
        } else state(this.master).output.connect(context.destination);
    }

    get size(): number {
        return this.buses.size;
    }

    createBus(name: string, options: AudioBusOptions = {}): AudioBus {
        this.assertAlive();
        if (!name.trim() || this.buses.has(name))
            throw new Error(`Invalid or duplicate audio bus: ${name}`);
        if (this.buses.size >= this.maxBuses) throw new Error('Audio mixer bus budget exhausted.');
        const parent = options.parent ?? this.master;
        this.assertBus(parent);
        finite(options.volume ?? 1, 'volume', 0, 16);
        finite(
            options.lowpassHz ?? this.context.sampleRate / 2,
            'lowpassHz',
            10,
            this.context.sampleRate / 2
        );
        const bus = new AudioBus(this.context, name, parent);
        bus.setVolume(options.volume ?? 1, 0);
        bus.setLowpass(options.lowpassHz ?? this.context.sampleRate / 2, 0);
        this.buses.set(name, bus);
        return bus;
    }

    getBus(name: string): AudioBus | undefined {
        return this.buses.get(name);
    }

    /** Validate that a bus belongs to this live mixer. */
    assertBus(bus: AudioBus): void {
        this.assertAlive();
        if (this.buses.get(bus.name) !== bus)
            throw new Error('Audio bus belongs to another mixer.');
    }

    /** Post-fader send. Gain 0 removes a send; parent and send edges are checked for feedback. */
    setSend(from: AudioBus, to: AudioBus, gain: number): void {
        this.assertBus(from);
        this.assertBus(to);
        finite(gain, 'send gain', 0, 1);
        const data = state(from);
        const existing = data.sends.get(to);
        if (gain === 0) {
            if (existing) {
                data.output.disconnect(existing);
                existing.disconnect();
                data.sends.delete(to);
                this.sendCount--;
            }
            return;
        }
        if (existing) {
            existing.gain.setValueAtTime(gain, this.context.currentTime);
            return;
        }
        if (this.sendCount >= this.maxSends) throw new Error('Audio mixer send budget exhausted.');
        const seen = new Set<AudioBus>();
        const reaches = (bus: AudioBus): boolean => {
            if (bus === from) return true;
            if (seen.has(bus)) return false;
            seen.add(bus);
            if (bus.parent && reaches(bus.parent)) return true;
            for (const target of state(bus).sends.keys()) if (reaches(target)) return true;
            return false;
        };
        if (reaches(to)) throw new Error('Audio send would create a feedback cycle.');
        const node = this.context.createGain();
        node.gain.value = gain;
        data.output.connect(node).connect(busInput(to));
        data.sends.set(to, node);
        this.sendCount++;
    }

    /** Capture target faders/cutoffs; mute and sidechain state remain independent. */
    captureSnapshot(): AudioMixSnapshot {
        this.assertAlive();
        return {
            buses: Array.from(this.buses.values(), bus => ({
                bus,
                volume: bus.volume,
                lowpassHz: bus.lowpassHz
            }))
        };
    }

    /** Validate the entire snapshot before scheduling any automation. */
    applySnapshot(snapshot: AudioMixSnapshot, seconds = 0.1): void {
        this.assertAlive();
        finite(seconds, 'snapshot seconds', 0);
        const seen = new Set<AudioBus>();
        for (const entry of snapshot.buses) {
            this.assertBus(entry.bus);
            if (seen.has(entry.bus)) throw new Error('Duplicate bus in audio snapshot.');
            seen.add(entry.bus);
            finite(entry.volume, 'snapshot volume', 0, 16);
            if (entry.lowpassHz !== undefined)
                finite(entry.lowpassHz, 'snapshot lowpassHz', 10, this.context.sampleRate / 2);
        }
        for (const entry of snapshot.buses) {
            entry.bus.setVolume(entry.volume, seconds);
            if (entry.lowpassHz !== undefined) entry.bus.setLowpass(entry.lowpassHz, seconds);
        }
    }

    /** Return an idempotent remover. Activity is supplied by AudioEngine.update(). */
    addDucking(options: AudioDuckingOptions): () => void {
        this.assertBus(options.source);
        this.assertBus(options.target);
        if (this.ducks.size >= 64) throw new Error('Audio ducking rule budget exhausted.');
        const rule: DuckRule = {
            source: options.source,
            target: options.target,
            gain: finite(options.gain ?? 0.25, 'duck gain', 0, 1),
            attack: finite(options.attackSeconds ?? 0.02, 'duck attack', 0),
            release: finite(options.releaseSeconds ?? 0.3, 'duck release', 0)
        };
        this.ducks.add(rule);
        return (): void => {
            this.ducks.delete(rule);
        };
    }

    /** Disconnect all buses/effects and release pinned impulse responses; idempotent. */
    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        for (const bus of this.buses.values()) {
            const data = state(bus);
            for (const send of data.sends.values()) send.disconnect();
            data.input.disconnect();
            data.filter.disconnect();
            data.reverb?.disconnect();
            data.volume.disconnect();
            data.mute.disconnect();
            data.output.disconnect();
            if (data.impulse) releaseClip(data.impulse);
            delete data.impulse;
            if (data.reverb) data.reverb.buffer = null;
            data.sends.clear();
            data.destroyed = true;
        }
        this.compressor?.disconnect();
        this.ducks.clear();
        this.buses.clear();
    }

    private assertAlive(): void {
        if (this.destroyed) throw new Error('Audio mixer is destroyed.');
    }

    /** @internal Cache the complete dry/send routing gain once per scheduling pass. Excludes ducking to prevent sidechain feedback. */
    refreshSelectionGains(): void {
        this.selectionEpoch++;
        for (const bus of this.buses.values()) this.calculateSelectionGain(bus);
    }

    /** @internal */
    getSelectionGain(bus: AudioBus): number {
        return state(bus).selectionGain;
    }

    private calculateSelectionGain(bus: AudioBus): number {
        const data = state(bus);
        if (data.selectionEpoch === this.selectionEpoch) return data.selectionGain;
        const now = this.context.currentTime;
        let route = bus.parent ? this.calculateSelectionGain(bus.parent) : 1;
        for (const [target, send] of data.sends)
            route += send.gain.value * this.calculateSelectionGain(target);
        data.selectionGain = Math.min(
            1e6,
            route * data.volumeRamp.value(now) * data.muteRamp.value(now)
        );
        data.selectionEpoch = this.selectionEpoch;
        return data.selectionGain;
    }

    /** @internal Called by the engine before marking actually audible voices. */
    resetActivity(): void {
        for (const bus of this.buses.values()) state(bus).active = false;
    }

    /** @internal */
    markActive(bus: AudioBus): void {
        let current: AudioBus | null = bus;
        while (current) {
            state(current).active = true;
            current = current.parent;
        }
    }

    /** @internal */
    updateDucking(): void {
        for (const bus of this.buses.values()) {
            const data = state(bus);
            data.duckTarget = 1;
            data.duckSeconds = data.duckRelease;
        }
        for (const rule of this.ducks) {
            const data = state(rule.target);
            if (state(rule.source).active && rule.gain < data.duckTarget) {
                data.duckTarget = rule.gain;
                data.duckSeconds = rule.attack;
                data.duckRelease = rule.release;
            }
        }
        for (const bus of this.buses.values()) {
            const data = state(bus);
            if (data.duckRamp.target !== data.duckTarget)
                data.duckRamp.set(
                    data.duckTarget,
                    data.duckSeconds,
                    this.context.currentTime,
                    data.output.gain
                );
        }
    }
}
