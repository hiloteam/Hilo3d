import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const { BasicLoader } = Hilo3d;

interface ProgressDetail {
    url: string;
    loaded: number;
    total: number;
}

function isProgressDetail(value: unknown): value is ProgressDetail {
    return (
        typeof value === 'object' &&
        value !== null &&
        typeof Reflect.get(value, 'url') === 'string' &&
        typeof Reflect.get(value, 'loaded') === 'number' &&
        typeof Reflect.get(value, 'total') === 'number'
    );
}

describe('BasicLoader', () => {
    let fetchMock: Mock<typeof fetch>;

    beforeEach(() => {
        BasicLoader.clearCache();
        fetchMock = vi.fn<typeof fetch>();
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('create', () => {
        const loader = new BasicLoader();
        expect(loader.isBasicLoader).toBe(true);
        expect(loader.className).toBe('BasicLoader');
    });

    it('loads text, JSON, and binary responses through fetch', async () => {
        fetchMock
            .mockResolvedValueOnce(new Response('hello modern loader'))
            .mockResolvedValueOnce(new Response('{"ready":true,"count":2}'))
            .mockResolvedValueOnce(new Response(Uint8Array.from([1, 2, 3, 255]).buffer));
        const loader = new BasicLoader();

        await expect(
            loader.request({ url: '/resource.txt', type: BasicLoader.TYPE_TEXT })
        ).resolves.toBe('hello modern loader');
        await expect(
            loader.request({ url: '/resource.json', type: BasicLoader.TYPE_JSON })
        ).resolves.toEqual({ ready: true, count: 2 });

        const binary = await loader.request({
            url: '/resource.bin',
            type: BasicLoader.TYPE_BUFFER
        });
        if (!(binary instanceof ArrayBuffer)) {
            throw new TypeError('Expected a binary request to resolve with an ArrayBuffer');
        }
        expect(Array.from(new Uint8Array(binary))).toEqual([1, 2, 3, 255]);
        expect(fetchMock).toHaveBeenNthCalledWith(1, '/resource.txt', {
            credentials: 'same-origin',
            method: 'GET'
        });
    });

    it('reports ReadableStream progress using the content length', async () => {
        const encoder = new TextEncoder();
        const firstChunk = encoder.encode('hello ');
        const secondChunk = encoder.encode('world');
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(firstChunk);
                controller.enqueue(secondChunk);
                controller.close();
            }
        });
        fetchMock.mockResolvedValue(
            new Response(body, {
                headers: { 'content-length': '11' }
            })
        );
        const loader = new BasicLoader();
        const progress: ProgressDetail[] = [];
        loader.on('progress', event => {
            if (!isProgressDetail(event.detail)) {
                throw new TypeError('Expected a typed loader progress event detail');
            }
            progress.push(event.detail);
        });

        await expect(
            loader.request({ url: '/stream.txt', type: BasicLoader.TYPE_TEXT })
        ).resolves.toBe('hello world');
        expect(progress).toEqual([
            { url: '/stream.txt', loaded: 6, total: 11 },
            { url: '/stream.txt', loaded: 11, total: 11 }
        ]);
    });

    it('rejects non-successful HTTP responses', async () => {
        fetchMock.mockResolvedValue(new Response('unavailable', { status: 503 }));
        const loader = new BasicLoader();

        await expect(
            loader.request({ url: '/unavailable.txt', type: BasicLoader.TYPE_TEXT })
        ).rejects.toThrow('Network request failed with status 503.');
    });

    it('rejects invalid JSON responses with a typed parse error', async () => {
        fetchMock.mockResolvedValue(new Response('{not-json}'));
        const loader = new BasicLoader();

        await expect(
            loader.request({ url: '/invalid.json', type: BasicLoader.TYPE_JSON })
        ).rejects.toThrow('Failed to parse JSON response.');
    });

    it('forwards AbortSignal cancellation to fetch', async () => {
        const controller = new AbortController();
        const abortError = new DOMException('Request aborted', 'AbortError');
        controller.abort(abortError);
        fetchMock.mockRejectedValue(abortError);
        const loader = new BasicLoader();

        await expect(
            loader.request({
                url: '/cancelled.txt',
                type: BasicLoader.TYPE_TEXT,
                signal: controller.signal
            })
        ).rejects.toMatchObject({ name: 'AbortError' });
        expect(fetchMock).toHaveBeenCalledWith('/cancelled.txt', {
            credentials: 'same-origin',
            method: 'GET',
            signal: controller.signal
        });
    });
});
