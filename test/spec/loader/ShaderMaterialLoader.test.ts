import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const ShaderMaterialLoader = Hilo3d.ShaderMaterialLoader;

describe('ShaderMaterialLoader', () => {
    it('create', () => {
        const loader = new ShaderMaterialLoader();
        expect(loader.isShaderMaterialLoader).toBe(true);
        expect(loader.className).toBe('ShaderMaterialLoader');
    });
});
