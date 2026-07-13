import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const GLTFLoader = Hilo3d.GLTFLoader;

describe('GLTFLoader', () => {
    it('create', () => {
        const loader = new GLTFLoader();
        expect(loader.isGLTFLoader).toBe(true);
        expect(loader.className).toBe('GLTFLoader');
    });
});
