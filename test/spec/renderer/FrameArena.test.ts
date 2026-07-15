import { describe, expect, it, vi } from 'vitest';
import { FrameArena, FrameObjectPool } from '../../../src/render/frame/FrameArena';

describe('FrameArena', () => {
    it('aligns numeric allocations and retains capacity between frames', () => {
        const arena = new FrameArena(8);
        expect(arena.allocate(3)).toBe(0);
        expect(arena.allocate(4, 4)).toBe(4);
        expect(arena.byteLength).toBe(8);
        expect(arena.growthCount).toBe(0);

        expect(arena.allocate(1)).toBe(8);
        expect(arena.capacity).toBe(16);
        expect(arena.growthCount).toBe(1);
        expect(arena.highWaterByteLength).toBe(9);

        arena.reset();
        expect(arena.byteLength).toBe(0);
        expect(arena.allocate(9)).toBe(0);
        expect(arena.capacity).toBe(16);
        expect(arena.growthCount).toBe(1);
    });

    it('owns copied bytes and rejects stale tracked allocations', () => {
        const arena = new FrameArena(4);
        const source = new Uint8Array([1, 2, 3, 4]);
        const offset = arena.copy(source, 4);
        source.fill(9);
        expect([...arena.view(offset, 4)]).toEqual([1, 2, 3, 4]);

        const tracked = arena.allocateTracked(2, 2);
        arena.write(tracked.offset, new Uint8Array([5, 6]));
        expect([...arena.viewTracked(tracked)]).toEqual([5, 6]);
        arena.reset();
        expect(() => arena.viewTracked(tracked)).toThrow(/stale frame generation/u);
    });

    it('validates ranges, sizes, and alignments before mutating the cursor', () => {
        const arena = new FrameArena(4);
        expect(() => arena.allocate(-1)).toThrow(RangeError);
        expect(() => arena.allocate(1, 3)).toThrow(/power of two/u);
        expect(arena.byteLength).toBe(0);
        expect(() => arena.view(0, 1)).toThrow(/exceeds allocated storage/u);
    });

    it('reuses stable byte views and refreshes them only after storage growth', () => {
        const arena = new FrameArena(4);
        arena.allocate(4);
        const first = arena.reuseView(null, 0, 4);
        expect(arena.reuseView(first, 0, 4)).toBe(first);

        arena.allocate(1);
        const grown = arena.reuseView(first, 0, 4);
        expect(grown).not.toBe(first);
        expect(arena.reuseView(grown, 0, 4)).toBe(grown);
    });
});

describe('FrameObjectPool', () => {
    it('creates objects only above the historical frame high-water count', () => {
        const create = vi.fn(() => ({ value: -1 }));
        const reset = vi.fn((value: { value: number }) => {
            value.value = 0;
        });
        const pool = new FrameObjectPool(create, reset);

        const first = pool.allocate();
        const second = pool.allocate();
        first.value = 10;
        second.value = 20;
        expect(create).toHaveBeenCalledTimes(2);

        pool.reset();
        expect(pool.allocate()).toBe(first);
        expect(pool.allocate()).toBe(second);
        expect(create).toHaveBeenCalledTimes(2);
        expect(reset).toHaveBeenCalledTimes(4);
        expect(first.value).toBe(0);
        expect(second.value).toBe(0);
    });
});
