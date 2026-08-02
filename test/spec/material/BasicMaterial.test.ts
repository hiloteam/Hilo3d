import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

describe('BasicMaterial', () => {
    it('creates a definition-backed instance', () => {
        const material = new Hilo3d.BasicMaterial();
        expect(material.isBasicMaterial).toBe(true);
        expect(material.className).toBe('BasicMaterial');
        expect(material.definition.family).toBe('basic');
    });

    it('makes light model and resource topology immutable definition features', () => {
        const lit = new Hilo3d.BasicMaterial({
            lightType: 'BLINN-PHONG',
            specular: new Hilo3d.Texture()
        });
        const unlit = new Hilo3d.BasicMaterial({ lightType: 'NONE' });

        expect(lit.definition).not.toBe(unlit.definition);
        expect(lit.getRenderOption()).toMatchObject({
            LIGHT_TYPE_BLINN_PHONG: 1,
            HAS_SPECULAR: 1,
            HAS_TEXCOORD0: 1
        });
        expect(unlit.getRenderOption()['HAS_LIGHT']).toBeUndefined();
    });

    it('tracks scalar data mutations without changing the definition', () => {
        const material = new Hilo3d.BasicMaterial({ shininess: 16 });
        const definition = material.definition;
        const revision = material.revision;

        material.shininess = 24;

        expect(material.definition).toBe(definition);
        expect(material.revision).toBe(revision + 1);
        expect(() => {
            material.reflectivity = -1;
        }).toThrow(/non-negative/u);
    });

    it('keeps environment texture dimension in shader and binding topology', () => {
        const material = new Hilo3d.BasicMaterial({
            specularEnvMap: new Hilo3d.CubeTexture()
        });

        expect(material.getRenderOption()).toMatchObject({
            SPECULAR_ENV_MAP: Hilo3d.MaterialTextureSlot.SPECULAR_ENVIRONMENT,
            SPECULAR_ENV_MAP_CUBE: 1
        });
        expect(material.definition.getTextureSlot('specularEnvironment')?.viewDimension).toBe(
            'cube'
        );
    });
});
