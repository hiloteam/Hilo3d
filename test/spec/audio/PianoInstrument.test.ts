import { AudioEngine } from '@hilo/addon-audio';
import { userEvent } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { PianoAudio } from '../../../examples/shared/pianoAudio';

function energy(pcm: Float32Array, from: number, to: number): number {
    let sum = 0;
    for (let index = from; index < to; index++) sum += (pcm[index] ?? 0) ** 2;
    return Math.sqrt(sum / (to - from));
}

describe('piano sample instrument', () => {
    it('creates audible decaying samples, spatial output, bounded voices and closes its context', async () => {
        const piano = new PianoAudio();
        const button = document.createElement('button');
        button.textContent = 'Enable piano test';
        document.body.append(button);
        let resumed: Promise<void> | undefined;
        button.addEventListener('click', () => {
            resumed = piano.resume();
        });
        let offline: AudioEngine | undefined;
        try {
            expect(piano.state).toBe('idle');
            expect(piano.diagnostics).toBeNull();
            await userEvent.click(button);
            await resumed;
            expect(piano.state).toBe('running');
            const voice = piano.noteOn(60, 0.8);
            if (!voice) throw new Error('Piano voice admission failed.');
            const pcm = voice.clip.buffer.getChannelData(0);
            const rate = voice.clip.buffer.sampleRate;
            expect(pcm.every(Number.isFinite)).toBe(true);
            expect(Math.abs(pcm[0] ?? 0)).toBe(0);
            expect(Math.abs(pcm[pcm.length - 1] ?? 0)).toBe(0);
            const attackEnergy = energy(pcm, Math.floor(rate * 0.02), Math.floor(rate * 0.3));
            const lateEnergy = energy(pcm, Math.floor(rate * 3), Math.floor(rate * 3.5));
            expect(attackEnergy).toBeGreaterThan(0.1);
            expect(lateEnergy).toBeLessThan(attackEnergy * 0.4);

            const context = new OfflineAudioContext(2, Math.ceil(rate * 0.2), rate);
            offline = new AudioEngine({ context, compressor: false });
            offline.play(voice.clip, {
                spatial: {
                    position: { x: 3, y: 0, z: -1 },
                    panningModel: 'equalpower',
                    refDistance: 5
                }
            });
            const output = await context.startRendering();
            const left = energy(output.getChannelData(0), 0, output.length);
            const right = energy(output.getChannelData(1), 0, output.length);
            expect(right).toBeGreaterThan(0.05);
            expect(right).toBeGreaterThan(left * 2);

            const ending = piano.noteOn(83, 0.7);
            if (!ending) throw new Error('Final tied B5 could not be admitted.');
            expect(
                ending.clip.duration / ending.playbackRate,
                'The final 8.5-beat tie has complete PCM backing'
            ).toBeGreaterThanOrEqual((8.5 * 60) / 84);
            piano.noteOff(ending);

            piano.setSustain(true);
            piano.noteOff(voice);
            expect(voice.state).not.toBe('stopping');
            piano.setSustain(false);
            expect(voice.state).toBe('stopping');
            for (let index = 0; index < 40; index++) piano.noteOn(48 + (index % 37));
            piano.update();
            expect(piano.diagnostics?.activeVoices).toBeLessThanOrEqual(28);
            expect(piano.diagnostics?.allocatedVoiceSlots).toBeLessThanOrEqual(32);
            expect(piano.diagnostics?.stolenVoices).toBeGreaterThan(0);
            await piano.suspend();
            expect(piano.state).toBe('suspended');
        } finally {
            offline?.destroy();
            piano.destroy();
            button.remove();
            await piano.whenClosed();
        }
        expect(piano.state).toBe('destroyed');
        expect(piano.diagnostics?.contextState).toBe('closed');
        expect(piano.diagnostics?.activeVoices).toBe(0);
        expect(piano.diagnostics?.allocatedVoiceSlots).toBe(0);
    });
});
