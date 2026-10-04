import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioClip, AudioCue, AudioEngine } from '@hilo/addon-audio';
import { fixture, rms } from './helpers';

const engines: AudioEngine[] = [];
afterEach(() => {
    for (const audio of engines) audio.destroy();
    engines.length = 0;
});

describe('audio output and transport', () => {
    it('renders exact scheduled starts, loop regions and playback rates through the real Web Audio graph', async () => {
        const { context, audio, clip } = fixture();
        engines.push(audio);
        const voice = audio.play(clip, { when: 0.1, offset: 0.9, playbackRate: 2 });
        expect(voice?.state).toBe('scheduled');
        const output = await context.startRendering();
        expect(rms(output, 0, 0, 0.099)).toBe(0);
        expect(rms(output, 0, 0.101, 0.149)).toBeCloseTo(0.25, 4);
        expect(rms(output, 0, 0.151, 0.3)).toBeLessThan(1e-6);
        expect(voice?.endReason).toBe('completed');
    });

    it('pauses, seeks and changes pitch without losing a virtual looping timeline', async () => {
        const { context, audio, clip } = fixture(0.6, { maxRealVoices: 1, maxVoices: 4 });
        engines.push(audio);
        const voice = audio.play(clip, {
            loop: true,
            loopStart: 0.2,
            loopEnd: 0.4,
            offset: 0.3,
            priority: 200
        });
        const foreground = audio.play(clip, { loop: true, priority: 0 });
        const at = context.suspend(0.1);
        const rendering = context.startRendering();
        await at;
        audio.update();
        expect(voice?.state).toBe('virtual');
        expect(voice?.position).toBeCloseTo(0.2, 2);
        voice?.setPlaybackRate(2);
        voice?.pause();
        const saved = voice?.position;
        const at2 = context.suspend(0.2);
        await context.resume();
        await at2;
        expect(voice?.position).toBe(saved);
        voice?.seek(0.25);
        foreground?.stop(0);
        voice?.resume();
        expect(voice?.state).toBe('playing');
        const at3 = context.suspend(0.25);
        await context.resume();
        await at3;
        expect(voice?.position).toBeCloseTo(0.35, 2);
        voice?.stop(0.05);
        await context.resume();
        const output = await rendering;
        expect(rms(output, 0, 0.31, 0.5)).toBeLessThan(1e-6);
        expect(voice?.endReason).toBe('stopped');
    });

    it('preserves the remaining delay when pausing a future voice', async () => {
        const { context, audio, clip } = fixture(0.5);
        engines.push(audio);
        const voice = audio.play(clip, { when: 0.2 });
        voice?.pause();
        const at = context.suspend(0.1);
        const rendering = context.startRendering();
        await at;
        voice?.resume();
        expect(voice?.state).toBe('scheduled');
        const at2 = context.suspend(0.25);
        await context.resume();
        await at2;
        audio.update();
        await context.resume();
        const output = await rendering;
        expect(rms(output, 0, 0, 0.295)).toBe(0);
        expect(rms(output, 0, 0.31, 0.4)).toBeCloseTo(0.25, 4);
    });

    it('interrupted fades begin at the current value and scheduled fade-ins remain sample timed', async () => {
        const { context, audio, clip } = fixture(0.4);
        engines.push(audio);
        const voice = audio.play(clip, { when: 0.05, fadeIn: 0.1 });
        const at = context.suspend(0.1);
        const rendering = context.startRendering();
        await at;
        voice?.setVolume(0, 0.1);
        await context.resume();
        const output = await rendering;
        expect(rms(output, 0, 0, 0.049)).toBe(0);
        expect(output.getChannelData(0)[2400]).toBeCloseTo(0, 5);
        expect(output.getChannelData(0)[3600]).toBeCloseTo(0.0625, 5);
        expect(rms(output, 0, 0.09, 0.099)).toBeGreaterThan(0.09);
        expect(rms(output, 0, 0.21, 0.3)).toBeLessThan(1e-6);
    });
});

describe('voice budgets and concurrency', () => {
    it('rolls back failed native starts and ignores callbacks belonging to a previous slot occupant', () => {
        const { context, audio, clip } = fixture(1, { maxRealVoices: 1 });
        engines.push(audio);
        const create = context.createBufferSource.bind(context);
        const broken = create();
        vi.spyOn(broken, 'start').mockImplementation(() => {
            throw new Error('native start failed');
        });
        vi.spyOn(context, 'createBufferSource').mockReturnValueOnce(broken);
        expect(() => audio.play(clip)).toThrow('native start failed');
        expect(audio.getDiagnostics()).toMatchObject({ activeVoices: 0, realVoices: 0 });
        const firstSource = create();
        vi.spyOn(context, 'createBufferSource').mockReturnValueOnce(firstSource);
        const first = audio.play(clip);
        const late = firstSource.onended;
        first?.stop(0);
        const second = audio.play(clip);
        late?.call(firstSource, new Event('ended'));
        expect(second?.state).toBe('playing');
        expect(audio.getDiagnostics().activeVoices).toBe(1);
    });

    it('bounds DSP chains, keeps stable handles and emits no new nodes during steady updates', () => {
        const { context, audio, clip } = fixture(1, { maxRealVoices: 4, maxVoices: 128 });
        engines.push(audio);
        const gains = vi.spyOn(context, 'createGain');
        const sources = vi.spyOn(context, 'createBufferSource');
        for (let i = 0; i < 128; i++)
            audio.play(clip, {
                loop: true,
                priority: i,
                spatial: { position: { x: i, y: 0, z: -1 }, maxDistance: 1000 }
            });
        expect(audio.play(clip)).toBeNull();
        const allocated = gains.mock.calls.length;
        const starts = sources.mock.calls.length;
        for (let frame = 0; frame < 1000; frame++) audio.update();
        expect(gains).toHaveBeenCalledTimes(allocated);
        expect(sources).toHaveBeenCalledTimes(starts);
        expect(audio.getDiagnostics()).toMatchObject({
            activeVoices: 128,
            realVoices: 4,
            virtualVoices: 124,
            allocatedVoiceSlots: 4,
            rejectedPlays: 1
        });
        audio.stopAll(0);
        expect(audio.getDiagnostics().activeVoices).toBe(0);
        audio.play(clip);
        expect(gains).toHaveBeenCalledTimes(allocated);
    });

    it('steals deterministically, counts paused/virtual voices and validates before mutating victims', () => {
        const { audio, clip } = fixture(1, { maxRealVoices: 1, maxVoices: 4 });
        engines.push(audio);
        audio.defineConcurrency('steps', { maxCount: 2, resolution: 'oldest' });
        const first = audio.play(clip, { concurrency: 'steps' });
        first?.pause();
        const second = audio.play(clip, { concurrency: 'steps' });
        expect(() => audio.play(clip, { concurrency: 'steps', playbackRate: NaN })).toThrow();
        expect(first?.state).toBe('paused');
        expect(second?.state).not.toBe('ended');
        const third = audio.play(clip, { concurrency: 'steps' });
        expect(first?.endReason).toBe('stolen');
        expect(third).not.toBeNull();
        expect(audio.getDiagnostics().activeVoices).toBe(2);
        expect(() => {
            audio.defineConcurrency('steps', { maxCount: 1 });
        }).toThrow('active');
    });

    it('enforces retrigger and owner scopes and protects higher priority voices', () => {
        const { audio, clip } = fixture();
        engines.push(audio);
        audio.defineConcurrency('dialogue', {
            maxCount: 1,
            perOwner: true,
            resolution: 'lowest-priority'
        });
        audio.defineConcurrency('shots', { maxCount: 4, retriggerSeconds: 0.1 });
        const alice = {};
        const bob = {};
        const first = audio.play(clip, { concurrency: 'dialogue', owner: alice, priority: 0 });
        expect(
            audio.play(clip, { concurrency: 'dialogue', owner: alice, priority: 200 })
        ).toBeNull();
        expect(audio.play(clip, { concurrency: 'dialogue', owner: bob })).not.toBeNull();
        expect(first?.state).toBe('playing');
        expect(() => audio.play(clip, { concurrency: 'dialogue' })).toThrow('owner identity');
        expect(audio.play(clip, { concurrency: 'shots' })).not.toBeNull();
        expect(audio.play(clip, { concurrency: 'shots' })).toBeNull();
    });

    it('reclaims expired virtual one-shots and restores audible voices at their current cursor', async () => {
        const { context, audio, clip } = fixture(0.4, { maxRealVoices: 1, maxVoices: 4 });
        engines.push(audio);
        const near = audio.play(clip, {
            priority: 0,
            spatial: { position: { x: 0, y: 0, z: -1 }, maxDistance: 5 }
        });
        const virtual = audio.play(clip, { offset: 0.95, priority: 255 });
        const ambient = audio.play(clip, { priority: 128, loop: true });
        const at = context.suspend(0.1);
        const rendering = context.startRendering();
        await at;
        audio.update();
        expect(virtual?.endReason).toBe('completed');
        near?.setPosition({ x: 100, y: 0, z: 0 });
        audio.update();
        const at2 = context.suspend(0.15);
        await context.resume();
        await at2;
        audio.update();
        expect(ambient?.state).toBe('playing');
        expect(ambient?.position).toBeCloseTo(0.15, 2);
        expect(audio.getDiagnostics().allocatedVoiceSlots).toBe(1);
        await context.resume();
        await rendering;
    });

    it('shares decoded buffers and makes weighted cues reproducible without immediate repeats', () => {
        const { context, audio, clip } = fixture();
        engines.push(audio);
        const second = new AudioClip(context.createBuffer(1, 480, 48000));
        const cue = new AudioCue({
            variations: [{ clip }, { clip: second, weight: 2 }],
            volume: [0.5, 1],
            playbackRate: [0.9, 1.1]
        });
        const a = cue.select(() => 0);
        const b = cue.select(() => 0);
        const c = cue.select(() => 0);
        expect(a.clip).toBe(clip);
        expect(b.clip).toBe(second);
        expect(c.clip).toBe(clip);
        expect(a.volume).toBe(0.5);
        expect(a.playbackRate).toBe(0.9);
        expect(audio.playCue(cue)?.clip.buffer).toBe(second.buffer);
        expect(() => cue.select(() => 1)).toThrow();
    });

    it('honors context ownership and idempotent destruction, including stale handles', async () => {
        const { context, audio, clip } = fixture();
        engines.push(audio);
        expect(() => new AudioEngine({ context })).toThrow('Only one');
        const voice = audio.play(clip);
        audio.destroy();
        audio.destroy();
        await audio.whenClosed();
        expect(context.state).toBe('suspended');
        expect(voice?.endReason).toBe('destroyed');
        expect(() => voice?.resume()).toThrow('ended');
        expect(() => audio.play(clip)).toThrow('destroyed');
        const replacement = new AudioEngine({ context });
        engines.push(replacement);
        expect(replacement.getDiagnostics().activeVoices).toBe(0);
    });
});
