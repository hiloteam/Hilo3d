import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const CubeTextureLoader = Hilo3d.CubeTextureLoader;

describe('CubeTextureLoader', () => {
    it('create', () => {
        const loader = new CubeTextureLoader();
        expect(loader.isCubeTextureLoader).toBe(true);
        expect(loader.className).toBe('CubeTextureLoader');
    });
});
