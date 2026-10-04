import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AudioEngine, AudioClipCache } from '@hilo/addon-audio';
import { deferred, fixture, wave } from './helpers';

const engines: AudioEngine[] = [];
const caches: AudioClipCache[] = [];
afterEach(() => {
    for (const audio of engines) audio.destroy();
    for (const cache of caches) cache.destroy();
    engines.length = 0;
    caches.length = 0;
});

describe('bounded audio clip cache', () => {
    it('decodes real PCM once, shares the buffer and gives each caller an independent pin', async () => {
        const fetcher = vi.fn<typeof fetch>(() => Promise.resolve(new Response(wave())));
        const { audio } = fixture(1, { cache: { fetch: fetcher } });
        engines.push(audio);
        const [a, b] = await Promise.all([
            audio.clips.load('tone.wav'),
            audio.clips.load('tone.wav')
        ]);
        expect(fetcher).toHaveBeenCalledOnce();
        expect(a.clip).toBe(b.clip);
        expect(a.clip.duration).toBeCloseTo(0.1, 5);
        expect(audio.clips.getDiagnostics()).toMatchObject({
            bytes: 19200,
            entries: 1,
            pinnedEntries: 1,
            activeLoads: 0
        });
        a.release();
        a.release();
        audio.clips.clearUnused();
        expect(audio.clips.getDiagnostics().entries).toBe(1);
        b.release();
        audio.clips.clearUnused();
        expect(audio.clips.getDiagnostics()).toMatchObject({ bytes: 0, entries: 0 });
    });

    it('keeps playing/reverb clips pinned after lease release and evicts only unused LRU entries', async () => {
        const fetcher: typeof fetch = () => Promise.resolve(new Response(wave()));
        const { audio } = fixture(1, { cache: { fetch: fetcher, maxBytes: 19200, maxEntries: 1 } });
        engines.push(audio);
        const a = await audio.clips.load('a.wav');
        const voice = audio.play(a.clip);
        a.release();
        await expect(audio.clips.load('b.wav')).rejects.toThrow('pinned');
        voice?.stop(0);
        const b = await audio.clips.load('b.wav');
        const wet = audio.mixer.createBus('wet');
        wet.setReverb(b.clip);
        b.release();
        audio.clips.clearUnused();
        expect(audio.clips.getDiagnostics().pinnedEntries).toBe(1);
        wet.setReverb(null);
        audio.clips.clearUnused();
        expect(audio.clips.getDiagnostics()).toMatchObject({ entries: 0, bytes: 0 });
    });

    it('cancels one waiter without aborting the shared request, and cancels transport after the last leaves', async () => {
        const response = deferred<Response>();
        let transport: AbortSignal | null | undefined;
        const fetcher: typeof fetch = (_input, init) => {
            transport = init?.signal;
            return response.promise;
        };
        const { audio } = fixture(1, { cache: { fetch: fetcher } });
        engines.push(audio);
        const first = new AbortController();
        const second = new AbortController();
        const a = audio.clips.load('a.wav', { signal: first.signal });
        const rejected = expect(a).rejects.toThrow('cancel first');
        const b = audio.clips.load('a.wav', { signal: second.signal });
        first.abort(new Error('cancel first'));
        await rejected;
        expect(transport?.aborted).toBe(false);
        response.resolve(new Response(wave()));
        const lease = await b;
        lease.release();
        const c = audio.clips.load('b.wav', { signal: second.signal });
        const cancelled = expect(c).rejects.toThrow();
        second.abort();
        await cancelled;
        expect(transport?.aborted).toBe(true);
    });

    it('bounds concurrent work and queued requests, then drains the queue without starvation', async () => {
        const responses = [deferred<Response>(), deferred<Response>()];
        let calls = 0;
        const fetcher = vi.fn<typeof fetch>(() => {
            const response = responses[calls++];
            if (!response) throw new Error('Unexpected fetch');
            return response.promise;
        });
        const { audio } = fixture(1, {
            cache: { fetch: fetcher, maxConcurrentLoads: 1, maxPendingLoads: 2 }
        });
        engines.push(audio);
        const a = audio.clips.load('a.wav');
        const b = audio.clips.load('b.wav');
        await expect(audio.clips.load('c.wav')).rejects.toThrow('queue');
        expect(fetcher).toHaveBeenCalledOnce();
        responses[0]?.resolve(new Response(wave()));
        (await a).release();
        expect(fetcher).toHaveBeenCalledTimes(2);
        responses[1]?.resolve(new Response(wave()));
        (await b).release();
        expect(audio.clips.getDiagnostics()).toMatchObject({ activeLoads: 0, pendingLoads: 0 });
    });

    it('rejects oversized streaming responses and bad HTTP/codec data, and retries failed URLs', async () => {
        let mode = 0;
        const fetcher: typeof fetch = () =>
            Promise.resolve(
                mode === 0
                    ? new Response('no', { status: 404 })
                    : mode === 1
                      ? new Response(new Uint8Array(2048))
                      : mode === 2
                        ? new Response('invalid codec')
                        : new Response(wave(100))
            );
        const { audio } = fixture(1, { cache: { fetch: fetcher, maxEncodedBytes: 1024 } });
        engines.push(audio);
        await expect(audio.clips.load('a')).rejects.toThrow('404');
        mode = 1;
        await expect(audio.clips.load('a')).rejects.toThrow('maxEncodedBytes');
        mode = 2;
        await expect(audio.clips.load('a')).rejects.toThrow();
        mode = 3;
        const lease = await audio.clips.load('a');
        expect(lease.clip.byteLength).toBe(400);
        lease.release();
    });

    it('rejects an over-budget decoded clip even when the encoded response fits', async () => {
        const { audio } = fixture(1, {
            cache: { fetch: () => Promise.resolve(new Response(wave())), maxBytes: 1000 }
        });
        engines.push(audio);
        await expect(audio.clips.load('too-large')).rejects.toThrow('Decoded audio clip');
        expect(audio.clips.getDiagnostics().bytes).toBe(0);
    });

    it('destroy rejects waiters immediately and an uncancelable decode cannot publish stale resources', async () => {
        const { context, audio } = fixture(1, {
            cache: { fetch: () => Promise.resolve(new Response(wave())) }
        });
        engines.push(audio);
        const decoded = deferred<AudioBuffer>();
        const started = deferred<undefined>();
        vi.spyOn(context, 'decodeAudioData').mockImplementation(() => {
            started.resolve(undefined);
            return decoded.promise;
        });
        const pending = audio.clips.load('slow');
        const rejection = expect(pending).rejects.toThrow('destroyed');
        await started.promise;
        audio.destroy();
        await rejection;
        decoded.resolve(context.createBuffer(1, 4800, 48000));
        await decoded.promise;
        await Promise.resolve();
        expect(audio.clips.getDiagnostics()).toMatchObject({
            bytes: 0,
            entries: 0,
            pendingLoads: 0,
            activeLoads: 0
        });
        await expect(audio.clips.load('another')).rejects.toThrow('destroyed');
    });
});
