import { afterEach, describe, expect, it } from 'vitest';
import { AudioClip, type AudioEngine } from '@hilo/addon-audio';
import { fixture, rms } from './helpers';

const engines: AudioEngine[] = [];
afterEach(() => {
    for (const audio of engines) audio.destroy();
    engines.length = 0;
});

describe('audio mixer', () => {
    it('keeps send-only voices audible when their dry parent is muted', async () => {
        const { context, audio, clip } = fixture(0.1);
        engines.push(audio);
        const dry = audio.mixer.createBus('dry');
        dry.setMuted(true, 0);
        const source = audio.mixer.createBus('source', { parent: dry });
        const auxiliary = audio.mixer.createBus('auxiliary');
        audio.mixer.setSend(source, auxiliary, 0.5);
        const voice = audio.play(clip, { bus: source });
        expect(voice?.state).toBe('playing');
        const output = await context.startRendering();
        expect(rms(output, 0, 0.01, 0.09)).toBeCloseTo(0.125, 4);
    });

    it('combines hierarchical faders and keeps mute independent of snapshots', async () => {
        const { context, audio, clip } = fixture(0.3);
        engines.push(audio);
        const effects = audio.mixer.createBus('effects', { volume: 0.5 });
        const child = audio.mixer.createBus('steps', { parent: effects, volume: 0.5 });
        audio.play(clip, { bus: child });
        const at = context.suspend(0.1);
        const rendering = context.startRendering();
        await at;
        child.setMuted(true, 0);
        audio.mixer.applySnapshot({ buses: [{ bus: child, volume: 1 }] }, 0);
        expect(child.muted).toBe(true);
        const at2 = context.suspend(0.2);
        await context.resume();
        await at2;
        child.setMuted(false, 0);
        await context.resume();
        const output = await rendering;
        expect(rms(output, 0, 0.01, 0.09)).toBeCloseTo(0.0625, 4);
        expect(rms(output, 0, 0.12, 0.19)).toBe(0);
        expect(rms(output, 0, 0.22, 0.28)).toBeCloseTo(0.125, 4);
    });

    it('validates snapshots atomically, enforces budgets and rejects cross-engine/feedback routing', () => {
        const { audio } = fixture(1, { maxBuses: 3, maxSends: 1 });
        engines.push(audio);
        const a = audio.mixer.createBus('a');
        const b = audio.mixer.createBus('b');
        expect(() => audio.mixer.createBus('c')).toThrow('budget');
        expect(() => {
            audio.mixer.applySnapshot({
                buses: [
                    { bus: a, volume: 0.3 },
                    { bus: b, volume: NaN }
                ]
            });
        }).toThrow();
        expect(a.volume).toBe(1);
        expect(() => {
            audio.mixer.setSend(audio.mixer.master, a, 0.5);
        }).toThrow('feedback');
        audio.mixer.setSend(a, b, 0.5);
        expect(() => {
            audio.mixer.setSend(b, a, 0.5);
        }).toThrow();
        audio.mixer.setSend(a, b, 0);
        audio.mixer.setSend(b, a, 0.5);
        const other = fixture().audio;
        engines.push(other);
        expect(() => {
            audio.mixer.applySnapshot({ buses: [{ bus: other.mixer.master, volume: 1 }] });
        }).toThrow('another mixer');
    });

    it('renders convolution sends and releases impulse pins on replacement', async () => {
        const { context, audio, clip } = fixture(0.1);
        engines.push(audio);
        const effects = audio.mixer.createBus('effects');
        const wet = audio.mixer.createBus('reverb');
        const impulse = context.createBuffer(1, 128, context.sampleRate);
        impulse.getChannelData(0)[0] = 0.5;
        wet.setReverb(new AudioClip(impulse));
        audio.mixer.setSend(effects, wet, 0.5);
        audio.play(clip, { bus: effects });
        const output = await context.startRendering();
        expect(rms(output, 0, 0.02, 0.09)).toBeCloseTo(0.3125, 4);
        wet.setReverb(null);
    });

    it('ducks music for audible dialogue and recovers after the voice completes', async () => {
        const { context, audio, clip } = fixture(0.4);
        engines.push(audio);
        const music = audio.mixer.createBus('music');
        const dialogue = audio.mixer.createBus('dialogue');
        audio.mixer.addDucking({
            source: dialogue,
            target: music,
            gain: 0.2,
            attackSeconds: 0,
            releaseSeconds: 0.05
        });
        audio.play(clip, { bus: music, loop: true });
        const silent = context.createBuffer(1, 4800, 48000);
        audio.play(new AudioClip(silent), { bus: dialogue });
        const at = context.suspend(0.15);
        const rendering = context.startRendering();
        await at;
        audio.update();
        await context.resume();
        const output = await rendering;
        expect(rms(output, 0, 0.01, 0.09)).toBeCloseTo(0.05, 4);
        expect(rms(output, 0, 0.22, 0.28)).toBeCloseTo(0.25, 4);
    });
});
