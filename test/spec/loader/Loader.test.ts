import { describe, expect, it, vi } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';
import type { LoaderRequest } from '../../../src/loader/BasicLoader';

const { Loader } = Hilo3d;

interface MockLoadResult {
    src: string | undefined;
    type: string | undefined;
}

class MockLoader {
    load(data: LoaderRequest): Promise<MockLoadResult> {
        return Promise.resolve({ src: data.src, type: data.type });
    }
}

describe('Loader', () => {
    it('create', () => {
        const loader = new Loader();
        expect(loader.isLoader).toBe(true);
        expect(loader.className).toBe('Loader');
    });

    it('transforms URLs before dispatching a request', async () => {
        Loader.addLoader('mock-url', MockLoader);
        const registeredLoader = Loader.getLoader('mock-url');
        const load = vi.spyOn(registeredLoader, 'load');
        const loader = new Loader();
        loader.preHandlerUrl = url => `${url}?revision=current`;

        await expect(loader.load({ src: 'asset.bin', type: 'mock-url' })).resolves.toEqual({
            src: 'asset.bin?revision=current',
            type: 'mock-url'
        });
        expect(load).toHaveBeenCalledWith({
            src: 'asset.bin?revision=current',
            type: 'mock-url'
        });

        loader.preHandlerUrl = null;
        await expect(loader.load({ src: 'asset.bin', type: 'mock-url' })).resolves.toEqual({
            src: 'asset.bin',
            type: 'mock-url'
        });
    });

    it('caches registered loaders and dispatches request lists asynchronously', async () => {
        Loader.addLoader('mock-dispatch', MockLoader);
        const registeredLoader = Loader.getLoader('mock-dispatch');
        const load = vi.spyOn(registeredLoader, 'load');
        const loader = new Loader();
        const requests = [
            { src: 'first.bin', type: 'mock-dispatch' },
            { src: 'second.bin', type: 'mock-dispatch' }
        ] as const;

        await expect(loader.load(requests)).resolves.toEqual([
            { src: 'first.bin', type: 'mock-dispatch' },
            { src: 'second.bin', type: 'mock-dispatch' }
        ]);
        expect(load).toHaveBeenCalledTimes(2);
        expect(load).toHaveBeenNthCalledWith(1, requests[0]);
        expect(load).toHaveBeenNthCalledWith(2, requests[1]);
        expect(Loader.getLoader('MOCK-DISPATCH')).toBe(registeredLoader);
    });
});
