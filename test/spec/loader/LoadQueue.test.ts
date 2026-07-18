import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const LoadQueue = Hilo3d.LoadQueue;

describe('LoadQueue', () => {
    it('create', () => {
        const queue = new LoadQueue();
        expect(queue.isLoadQueue).toBe(true);
        expect(queue.className).toBe('LoadQueue');
    });
});
