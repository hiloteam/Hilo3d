import {
    AudioClip,
    AudioEngine,
    type AudioBus,
    type AudioDiagnostics,
    type AudioVoice
} from '@hilo/addon-audio';
import type { PianoScore } from './pianoMidi';

interface PianoSample {
    readonly midi: number;
    readonly soft: AudioClip;
    readonly bright: AudioClip;
}

interface DemoNote {
    readonly midi: number;
    readonly velocity: number;
    readonly duration: number;
    readonly when: number;
    readonly voice: AudioVoice;
    announced: boolean;
    released: boolean;
}

/** Visual note events follow the audio clock; duration is measured in seconds. */
export type PianoNoteCallback = (midi: number, velocity: number, duration: number) => void;

const SAMPLE_ROOTS = [48, 54, 60, 66, 72, 78, 84] as const;
const EIGHTH_SECONDS = 60 / 84 / 2;
const LOOKAHEAD_SECONDS = 0.55;
const DEMO_CHORDS: readonly (readonly number[])[] = [
    [48, 55, 60, 64, 67, 72, 76, 74],
    [48, 55, 60, 64, 69, 72, 79, 76],
    [57, 64, 69, 72, 76, 81, 79, 76],
    [57, 64, 67, 72, 76, 79, 74, 72],
    [53, 60, 65, 69, 72, 77, 76, 72],
    [53, 60, 65, 69, 74, 77, 81, 79],
    [55, 62, 67, 71, 74, 79, 77, 74],
    [55, 62, 67, 71, 74, 76, 74, 72]
];

function unit(value: number, name: string): number {
    if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite.`);
    return Math.max(0, Math.min(1, value));
}

/** Seeded local noise makes the authored samples repeatable without changing global randomness. */
function noiseGenerator(seed: number): () => number {
    let state = seed >>> 0;
    return (): number => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 2147483648 - 1;
    };
}

/**
 * A small multisample bank: two struck strings, stretched upper partials, velocity-dependent
 * brightness, a short felt-hammer transient, and faster damping of upper harmonics. These are
 * original synthesized PCM samples, not recordings of an acoustic instrument.
 */
function createPianoSample(context: BaseAudioContext, midi: number, bright: boolean): AudioClip {
    const sampleRate = context.sampleRate;
    // Keep the supplied score's final 8.5-beat B5 tie alive through its release at 84 BPM.
    const duration = 8 - (midi - 48) * 0.03;
    const buffer = context.createBuffer(1, Math.ceil(duration * sampleRate), sampleRate);
    const pcm = buffer.getChannelData(0);
    const frequency = 440 * 2 ** ((midi - 69) / 12);
    const fundamentalDecay = 2.5 - (midi - 48) * 0.029;
    const stretch = 0.000035 + (midi - 48) * 0.000002;
    const partialCount = bright ? 14 : 10;

    for (let harmonic = 1; harmonic <= partialCount; harmonic++) {
        const partialFrequency = frequency * harmonic * Math.sqrt(1 + stretch * harmonic ** 2);
        if (partialFrequency > sampleRate * 0.43) break;
        const amplitude =
            (harmonic === 1 ? 1 : (bright ? 0.72 : 0.47) / harmonic ** (bright ? 1.25 : 1.7)) *
            (harmonic === 4 || harmonic === 7 ? 0.72 : 1);
        const decaySeconds = fundamentalDecay / (1 + (harmonic - 1) * 0.3);
        const damping = Math.exp(-1 / (sampleRate * decaySeconds));
        const dampingSquared = damping * damping;
        for (const detune of [-0.0007, 0.0007]) {
            const angular = (Math.PI * 2 * partialFrequency * (1 + detune)) / sampleRate;
            const recurrence = 2 * damping * Math.cos(angular);
            let previous = -Math.sin(angular) * damping;
            let current = 0;
            for (let index = 0; index < pcm.length; index++) {
                pcm[index] = (pcm[index] ?? 0) + current * amplitude * 0.5;
                const next = recurrence * current - dampingSquared * previous;
                previous = current;
                current = next;
            }
        }
    }

    const random = noiseGenerator(midi * 941 + (bright ? 137 : 19));
    let felt = 0;
    let peak = 0;
    for (let index = 0; index < pcm.length; index++) {
        const time = index / sampleRate;
        felt += (random() - felt) * 0.32;
        const attack = 1 - Math.exp(-time / 0.0025);
        const hammer = felt * (bright ? 0.14 : 0.065) * Math.exp(-time * 95);
        const tail = Math.min(1, (pcm.length - index - 1) / (sampleRate * 0.08));
        const sample = ((pcm[index] ?? 0) + hammer) * attack * tail;
        pcm[index] = sample;
        peak = Math.max(peak, Math.abs(sample));
    }
    const scale = peak > 0 ? 0.8 / peak : 1;
    for (let index = 0; index < pcm.length; index++) pcm[index] = (pcm[index] ?? 0) * scale;
    return new AudioClip(buffer, `Felt piano ${String(midi)} ${bright ? 'forte' : 'piano'}`);
}

/** A bounded stereo chamber impulse with distinct early reflections and a diffused late tail. */
function createRoomImpulse(context: BaseAudioContext): AudioClip {
    const sampleRate = context.sampleRate;
    const buffer = context.createBuffer(2, Math.ceil(sampleRate * 2.8), sampleRate);
    for (let channel = 0; channel < 2; channel++) {
        const pcm = buffer.getChannelData(channel);
        const random = noiseGenerator(9001 + channel * 971);
        const energyScale = 0.029 * Math.sqrt(48000 / sampleRate);
        let diffusion = 0;
        for (let index = 0; index < pcm.length; index++) {
            const time = index / sampleRate;
            diffusion += (random() - diffusion) * 0.24;
            const onset = Math.min(1, Math.max(0, (time - 0.015) / 0.04));
            const tail = Math.min(1, (pcm.length - index - 1) / (sampleRate * 0.1));
            pcm[index] = diffusion * energyScale * onset * Math.exp(-time * 2.45) * tail;
        }
        for (const [reflection, time] of [0.023, 0.041, 0.067, 0.101, 0.149].entries()) {
            const index = Math.floor((time + channel * 0.0037) * sampleRate);
            pcm[index] = (pcm[index] ?? 0) + 0.18 * 0.65 ** reflection;
        }
    }
    return new AudioClip(buffer, 'Nocturne stereo chamber');
}

/**
 * Example-owned piano instrument. All playback, spatialization, mixing, voice budgets and room
 * convolution use the public audio addon. Construction creates no AudioContext or timers.
 */
export class PianoAudio {
    private engine: AudioEngine | undefined;
    private pianoBus: AudioBus | undefined;
    private roomBus: AudioBus | undefined;
    private readonly samples: PianoSample[] = [];
    private readonly sustained = new Set<AudioVoice>();
    private readonly demoNotes: DemoNote[] = [];
    private demoCallback: PianoNoteCallback | undefined;
    private timer: ReturnType<typeof setInterval> | undefined;
    private nextDemoTime = 0;
    private demoStep = 0;
    private volume = 0.72;
    private reverb = 0.48;
    private sustain = false;
    private destroyed = false;
    private playingDemo = false;
    private score: PianoScore | undefined;
    private scoreStart = 0;
    private scoreIndex = 0;

    get currentTime(): number {
        return this.engine?.context.currentTime ?? 0;
    }

    get state(): AudioContextState | 'idle' | 'destroyed' {
        return this.destroyed ? 'destroyed' : (this.engine?.context.state ?? 'idle');
    }

    get diagnostics(): AudioDiagnostics | null {
        return this.engine?.getDiagnostics() ?? null;
    }

    get demoPlaying(): boolean {
        return this.playingDemo;
    }

    /** Call directly in a user gesture. Resume is requested before constructing sample PCM. */
    async resume(): Promise<void> {
        if (this.destroyed) throw new Error('Piano audio has been destroyed.');
        const engine = (this.engine ??= new AudioEngine({
            maxRealVoices: 32,
            maxVoices: 48,
            maxStreams: 0,
            maxBuses: 3,
            maxSends: 1,
            masterVolume: this.volume,
            scheduleAheadSeconds: LOOKAHEAD_SECONDS + 0.05,
            parameterRampSeconds: 0.012
        }));
        const resumed = engine.resume();
        try {
            if (this.samples.length === 0) this.prepare(engine);
            await resumed;
            if (this.playingDemo) this.startScheduler();
        } catch (error) {
            // Observe resume rejection even if sample construction failed synchronously.
            await resumed.catch(() => undefined);
            throw error;
        }
    }

    /** Positions progress from bass-left to treble-right in the listener's stereo field. */
    noteOn(midi: number, velocity = 0.72, when = this.currentTime): AudioVoice | null {
        if (!Number.isInteger(midi) || midi < 21 || midi > 108)
            throw new RangeError('The piano instrument spans MIDI 21 through 108.');
        const strength = unit(velocity, 'Velocity');
        const engine = this.engine;
        if (this.destroyed || !engine || !this.pianoBus || this.samples.length === 0) return null;
        let selected = this.samples[0];
        if (!selected) return null;
        for (const sample of this.samples)
            if (Math.abs(sample.midi - midi) < Math.abs(selected.midi - midi)) selected = sample;
        return engine.play(strength > 0.68 ? selected.bright : selected.soft, {
            bus: this.pianoBus,
            concurrency: 'piano-keys',
            playbackRate: 2 ** ((midi - selected.midi) / 12),
            volume: 0.42 * strength ** 1.45,
            when,
            fadeIn: 0.002,
            spatial: {
                position: { x: ((midi - 66) / 18) * 1.6, y: 0, z: -2.8 },
                panningModel: 'equalpower',
                refDistance: 4,
                maxDistance: 30,
                rolloffFactor: 0
            }
        });
    }

    noteOff(voice: AudioVoice | null): void {
        if (!voice || voice.state === 'ended' || this.destroyed) return;
        if (this.sustain) this.sustained.add(voice);
        else voice.stop(0.3);
    }

    setSustain(enabled: boolean): void {
        this.sustain = enabled;
        if (enabled) return;
        for (const voice of this.sustained) voice.stop(0.42);
        this.sustained.clear();
    }

    setVolume(value: number): void {
        this.volume = unit(value, 'Volume');
        if (!this.destroyed) this.engine?.mixer.master.setVolume(this.volume, 0.06);
    }

    setReverb(value: number): void {
        this.reverb = unit(value, 'Reverb');
        if (!this.destroyed) this.roomBus?.setVolume(this.reverb * 1.15, 0.12);
    }

    /** Select a caller-owned local arrangement. No MIDI bytes or musical content are uploaded. */
    loadScore(score: PianoScore): void {
        if (
            score.notes.length === 0 ||
            score.notes.length > 4096 ||
            !Number.isFinite(score.duration) ||
            score.duration <= 0 ||
            score.duration > 1800 ||
            score.notes.some(
                note =>
                    !Number.isInteger(note.midi) ||
                    note.midi < 21 ||
                    note.midi > 108 ||
                    !Number.isFinite(note.when) ||
                    note.when < 0 ||
                    !Number.isFinite(note.duration) ||
                    note.duration <= 0 ||
                    note.when + note.duration > score.duration + 0.001 ||
                    !Number.isFinite(note.velocity) ||
                    note.velocity < 0 ||
                    note.velocity > 1
            )
        )
            throw new RangeError('The piano score is invalid or exceeds the arrangement budget.');
        this.stopDemo();
        this.score = {
            duration: score.duration,
            notes: score.notes
                .map(note => ({ ...note }))
                .sort((left, right) => left.when - right.when)
        };
    }

    clearScore(): void {
        this.stopDemo();
        this.score = undefined;
    }

    /** Play a local score once, or loop the original "Midnight, in bloom" on the audio clock. */
    startDemo(onNote?: PianoNoteCallback): void {
        if (!this.engine || this.destroyed || this.engine.context.state !== 'running') return;
        this.stopDemo();
        this.demoCallback = onNote;
        this.demoStep = 0;
        this.nextDemoTime = this.currentTime + 0.06;
        this.scoreStart = this.nextDemoTime;
        this.scoreIndex = 0;
        this.playingDemo = true;
        this.scheduleDemo();
        this.startScheduler();
    }

    stopDemo(): void {
        this.playingDemo = false;
        this.stopScheduler();
        for (const note of this.demoNotes) {
            note.voice.stop(0.15);
            this.sustained.delete(note.voice);
        }
        this.demoNotes.length = 0;
        this.demoCallback = undefined;
    }

    /** Called by the scene ticker. Visual notes are emitted only once their sound is due. */
    update(): void {
        const engine = this.engine;
        if (!engine || this.destroyed) return;
        engine.update();
        const now = engine.context.currentTime;
        for (let index = this.demoNotes.length - 1; index >= 0; index--) {
            const note = this.demoNotes[index];
            if (!note) continue;
            if (!note.announced && now >= note.when) {
                note.announced = true;
                if (now < note.when + note.duration)
                    this.demoCallback?.(note.midi, note.velocity, note.duration);
            }
            if (!note.released && now >= note.when + note.duration) {
                note.released = true;
                this.noteOff(note.voice);
            }
            if (note.voice.state === 'ended') this.demoNotes.splice(index, 1);
        }
        for (const voice of this.sustained)
            if (voice.state === 'ended') this.sustained.delete(voice);
    }

    async suspend(): Promise<void> {
        this.stopScheduler();
        if (!this.destroyed) await this.engine?.suspend();
    }

    destroy(): void {
        if (this.destroyed) return;
        this.stopDemo();
        this.sustained.clear();
        this.samples.length = 0;
        this.score = undefined;
        this.engine?.destroy();
        this.destroyed = true;
    }

    whenClosed(): Promise<void> {
        return this.engine?.whenClosed() ?? Promise.resolve();
    }

    private prepare(engine: AudioEngine): void {
        engine.defineConcurrency('piano-keys', { maxCount: 28, resolution: 'oldest' });
        this.pianoBus = engine.mixer.createBus('piano');
        this.roomBus = engine.mixer.createBus('chamber', {
            volume: this.reverb * 1.15,
            lowpassHz: Math.min(6200, engine.context.sampleRate / 2)
        });
        this.roomBus.setReverb(createRoomImpulse(engine.context));
        engine.mixer.setSend(this.pianoBus, this.roomBus, 0.7);
        engine.setListener({ position: { x: 0, y: 0, z: 0 } });
        for (const midi of SAMPLE_ROOTS) {
            this.samples.push({
                midi,
                soft: createPianoSample(engine.context, midi, false),
                bright: createPianoSample(engine.context, midi, true)
            });
        }
    }

    private scheduleDemo(): void {
        const engine = this.engine;
        if (!engine || this.destroyed || !this.playingDemo || engine.context.state !== 'running')
            return;
        const now = engine.context.currentTime;
        // Audio release/completion remains bounded even when visual frames are throttled.
        for (let index = this.demoNotes.length - 1; index >= 0; index--) {
            const note = this.demoNotes[index];
            if (!note) continue;
            if (!note.released && now >= note.when + note.duration) {
                note.released = true;
                this.noteOff(note.voice);
            }
            if (note.voice.state === 'ended') this.demoNotes.splice(index, 1);
        }
        for (const voice of this.sustained)
            if (voice.state === 'ended') this.sustained.delete(voice);
        if (this.score) {
            while (this.scoreIndex < this.score.notes.length) {
                const note = this.score.notes[this.scoreIndex];
                if (!note || this.scoreStart + note.when >= now + LOOKAHEAD_SECONDS) break;
                this.scoreIndex++;
                const when = this.scoreStart + note.when;
                if (when + note.duration < now) continue;
                const voice = this.noteOn(note.midi, note.velocity, when);
                if (voice)
                    this.demoNotes.push({
                        ...note,
                        when,
                        voice,
                        announced: false,
                        released: false
                    });
            }
            engine.update();
            if (now >= this.scoreStart + this.score.duration + 0.5) this.stopDemo();
            return;
        }
        // After a throttled tab, continue the score without bursting overdue notes.
        if (this.nextDemoTime < now - EIGHTH_SECONDS) {
            const skipped = Math.ceil((now - this.nextDemoTime) / EIGHTH_SECONDS);
            this.demoStep += skipped;
            this.nextDemoTime += skipped * EIGHTH_SECONDS;
        }
        while (this.nextDemoTime < now + LOOKAHEAD_SECONDS) {
            const chord = DEMO_CHORDS[Math.floor(this.demoStep / 8) % DEMO_CHORDS.length];
            const beat = this.demoStep % 8;
            const midi = chord?.[beat];
            if (midi !== undefined) {
                const velocity = beat === 0 ? 0.74 : beat >= 4 ? 0.63 : 0.49;
                const duration = EIGHTH_SECONDS * (beat === 0 ? 3.2 : 2.1);
                const voice = this.noteOn(midi, velocity, this.nextDemoTime);
                if (voice) {
                    this.demoNotes.push({
                        midi,
                        velocity,
                        duration,
                        when: this.nextDemoTime,
                        voice,
                        announced: false,
                        released: false
                    });
                }
            }
            this.nextDemoTime += EIGHTH_SECONDS;
            this.demoStep++;
        }
        engine.update();
    }

    private startScheduler(): void {
        if (this.timer !== undefined) return;
        this.timer = setInterval(() => {
            this.scheduleDemo();
        }, 40);
    }

    private stopScheduler(): void {
        if (this.timer === undefined) return;
        clearInterval(this.timer);
        this.timer = undefined;
    }
}
