import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';
import type { DispatchEvent } from '../../../src/core/EventDispatcher';

const LoadCache = Hilo3d.LoadCache;

describe('LoadCache', () => {
    let cache: Hilo3d.LoadCache<number>;
    beforeEach(() => {
        cache = new LoadCache<number>();
    });
    it('create', () => {
        expect(cache.isLoadCache).toBe(true);
        expect(cache.className).toBe('LoadCache');
    });

    it('update', () => {
        const allDetails: unknown[] = [];
        const aDetails: unknown[] = [];
        const bDetails: unknown[] = [];
        const callbackAll = vi.fn((event: DispatchEvent) => {
            allDetails.push(event.detail);
        });
        const callbackA = vi.fn((event: DispatchEvent) => {
            aDetails.push(event.detail);
        });
        const callbackB = vi.fn((event: DispatchEvent) => {
            bDetails.push(event.detail);
        });
        cache.on('update', callbackAll);
        cache.on('update:a', callbackA);
        cache.on('update:b', callbackB);

        cache.update('a', LoadCache.LOADED, 1);

        expect(callbackAll).toHaveBeenCalledTimes(1);
        expect(allDetails.at(-1)).toEqual({
            key: 'a',
            state: LoadCache.LOADED,
            data: 1
        });

        expect(callbackA).toHaveBeenCalledTimes(1);
        expect(aDetails.at(-1)).toEqual({
            key: 'a',
            state: LoadCache.LOADED,
            data: 1
        });

        expect(callbackB).toHaveBeenCalledTimes(0);

        cache.update('b', LoadCache.PENDING, 2);

        expect(callbackAll).toHaveBeenCalledTimes(2);
        expect(allDetails.at(-1)).toEqual({
            key: 'b',
            state: LoadCache.PENDING,
            data: 2
        });
        expect(callbackA).toHaveBeenCalledTimes(1);
        expect(callbackB).toHaveBeenCalledTimes(1);
        expect(bDetails.at(-1)).toEqual({
            key: 'b',
            state: LoadCache.PENDING,
            data: 2
        });
    });

    it('get', () => {
        cache.update('a', LoadCache.LOADED, 1);
        cache.update('b', LoadCache.PENDING, 2);

        expect(cache.get('a')).toEqual({
            key: 'a',
            state: LoadCache.LOADED,
            data: 1
        });

        expect(cache.get('b')).toEqual({
            key: 'b',
            state: LoadCache.PENDING,
            data: 2
        });

        expect(cache.get('c')).toBeNull();
    });

    it('enabled', () => {
        cache.enabled = false;

        const callbackAll = vi.fn<(event: DispatchEvent) => void>();
        const callbackA = vi.fn<(event: DispatchEvent) => void>();
        cache.on('update', callbackAll);
        cache.on('update:a', callbackA);

        cache.update('a', LoadCache.LOADED, 1);
        expect(callbackAll).toHaveBeenCalledTimes(0);
        expect(callbackA).toHaveBeenCalledTimes(0);

        expect(cache.get('a')).toBeNull();
    });

    it('getLoaded', () => {
        cache.update('a', LoadCache.LOADED, 1);
        cache.update('b', LoadCache.LOADED, 2);
        cache.update('c', LoadCache.PENDING, 3);
        cache.update('d', LoadCache.FAILED, 4);

        expect(cache.getLoaded('a')).toBe(1);
        expect(cache.getLoaded('b')).toBe(2);
        expect(cache.getLoaded('c')).toBeNull();
        expect(cache.getLoaded('d')).toBeNull();
        expect(cache.getLoaded('e')).toBeNull();
    });

    it('remove', () => {
        cache.update('a', LoadCache.LOADED, 1);
        expect(cache.get('a')).not.toBeNull();
        cache.remove('a');
        expect(cache.get('a')).toBeNull();
    });

    it('clear', () => {
        cache.update('a', LoadCache.LOADED, 1);
        cache.update('b', LoadCache.LOADED, 1);
        expect(cache.get('a')).not.toBeNull();
        expect(cache.get('b')).not.toBeNull();
        cache.clear();
        expect(cache.get('a')).toBeNull();
        expect(cache.get('b')).toBeNull();
    });

    it('wait', async () => {
        const resolveA0 = vi.fn<(value: number) => void>();
        const rejectA0 = vi.fn<(reason: unknown) => void>();
        const resolveA1 = vi.fn<(value: number) => void>();
        const rejectA1 = vi.fn<(reason: unknown) => void>();

        const resolveB0 = vi.fn<(value: number) => void>();
        const rejectB0 = vi.fn<(reason: unknown) => void>();
        const resolveB1 = vi.fn<(value: number) => void>();
        const rejectB1 = vi.fn<(reason: unknown) => void>();

        const resolveC = vi.fn<(value: number) => void>();
        const rejectC = vi.fn<(reason: unknown) => void>();

        cache.update('a', LoadCache.PENDING);
        cache.wait(cache.get('a')).then(resolveA0, rejectA0);
        cache.update('a', LoadCache.LOADED, 1);
        cache.wait(cache.get('a')).then(resolveA1, rejectA1);

        cache.update('b', LoadCache.PENDING, 2);
        cache.wait(cache.get('b')).then(resolveB0, rejectB0);
        cache.update('b', LoadCache.FAILED);
        cache.wait(cache.get('b')).then(resolveB1, rejectB1);

        cache.wait(cache.get('c')).then(resolveC, rejectC);

        await Promise.resolve();
        expect(resolveA0).toHaveBeenCalledTimes(1);
        expect(resolveA0).toHaveBeenLastCalledWith(1);
        expect(rejectA0).toHaveBeenCalledTimes(0);

        expect(resolveA1).toHaveBeenCalledTimes(1);
        expect(resolveA1).toHaveBeenLastCalledWith(1);
        expect(rejectA1).toHaveBeenCalledTimes(0);

        expect(resolveB0).toHaveBeenCalledTimes(0);
        expect(rejectB0).toHaveBeenCalledTimes(1);

        expect(resolveB1).toHaveBeenCalledTimes(0);
        expect(rejectB1).toHaveBeenCalledTimes(1);

        expect(resolveC).toHaveBeenCalledTimes(0);
        expect(rejectC).toHaveBeenCalledTimes(1);
    });
});
