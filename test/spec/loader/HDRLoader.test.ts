import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const HDRLoader = Hilo3d.HDRLoader;

describe('HDRLoader', () => {
    it('create', () => {
        const loader = new HDRLoader();
        expect(loader.isHDRLoader).toBe(true);
        expect(loader.className).toBe('HDRLoader');
    });
});
