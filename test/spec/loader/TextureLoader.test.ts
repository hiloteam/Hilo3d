import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const TextureLoader = Hilo3d.TextureLoader;

describe('TextureLoader', () => {
    it('create', () => {
        const loader = new TextureLoader();
        expect(loader.isTextureLoader).toBe(true);
        expect(loader.className).toBe('TextureLoader');
    });
});
