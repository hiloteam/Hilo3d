import { AudioClip, AudioEngine, type AudioStream } from '@hilo/addon-audio';
import { wave } from './helpers';

function assertPlaying(stream: AudioStream, expected: boolean): void {
    if (stream.playing !== expected) throw new Error('Stream playing state mismatch.');
}

/** Invoked by a genuine Playwright click against the installed package, with normal autoplay policy. */
export async function verifyPackedAudio(): Promise<void> {
    const audio = new AudioEngine({ maxStreams: 1, compressor: false });
    const url = URL.createObjectURL(new Blob([wave()], { type: 'audio/wav' }));
    try {
        await audio.resume();
        const lease = await audio.clips.load(url);
        if (Math.abs(lease.clip.duration - 0.1) > 0.01)
            throw new Error('Packed decoder duration mismatch.');
        lease.release();
        const stream = audio.createStream(url, { loop: true });
        await stream.play();
        const deadline = performance.now() + 5000;
        while (stream.position < 0.02 && performance.now() < deadline)
            await new Promise(resolve => setTimeout(resolve, 10));
        assertPlaying(stream, true);
        if (stream.position < 0.02) throw new Error('Packed media stream did not advance.');
        stream.pause();
        assertPlaying(stream, false);
        stream.seek(0.01);
        await stream.play();
        stream.destroy();
        stream.destroy();
        if (audio.getDiagnostics().streams !== 0)
            throw new Error('Stream teardown leaked its admission slot.');
        audio.destroy();
        await audio.whenClosed();
        if (audio.context.state !== 'closed')
            throw new Error('Owned realtime context was not closed.');

        const offline = new OfflineAudioContext(2, 4800, 48000);
        const renderer = new AudioEngine({ context: offline, compressor: false });
        try {
            const buffer = offline.createBuffer(1, 4800, 48000);
            buffer.getChannelData(0).fill(0.25);
            renderer.play(new AudioClip(buffer), { when: 0.01 });
            const output = await offline.startRendering();
            const samples = output.getChannelData(0);
            if (Math.abs((samples[2400] ?? 0) - 0.25) > 1e-4 || samples[0] !== 0)
                throw new Error('Packed output PCM/scheduling mismatch.');
        } finally {
            renderer.destroy();
        }
    } finally {
        audio.destroy();
        await audio.whenClosed();
        URL.revokeObjectURL(url);
    }
}
