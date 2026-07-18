import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const BasicMaterial = Hilo3d.BasicMaterial;

describe('BasicMaterial', () => {
    it('create', () => {
        const material = new BasicMaterial();
        expect(material.isBasicMaterial).toBe(true);
        expect(material.className).toBe('BasicMaterial');
    });

    it('getRenderOption', () => {
        const material = new BasicMaterial({
            lightType: 'BLINN-PHONG',
            specular: new Hilo3d.Texture()
        });

        let option = material.getRenderOption();
        expect(option['LIGHT_TYPE_BLINN_PHONG']).toBe(1);
        expect(Object.keys(option).some(name => name.includes('-'))).toBe(false);
        expect(option['HAS_SPECULAR']).toBe(1);
        expect(option['HAS_TEXCOORD0']).toBe(1);

        material.lightType = 'NONE';
        option = material.getRenderOption();
        expect(option['HAS_LIGHT']).toBeUndefined();
        expect(option['HAS_NORMAL']).toBeUndefined();
        expect(option['HAS_TEXCOORD0']).toBeUndefined();
    });
});
