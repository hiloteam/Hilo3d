import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const PBRMaterial = Hilo3d.PBRMaterial;

describe('PBRMaterial', () => {
    it('create', () => {
        const material = new PBRMaterial();
        expect(material.isPBRMaterial).toBe(true);
        expect(material.className).toBe('PBRMaterial');
    });

    it('getRenderOption', () => {
        const material = new PBRMaterial({
            metallicRoughnessMap: new Hilo3d.Texture({
                uv: 0
            }),
            baseColorMap: new Hilo3d.Texture({
                uv: 1
            }),
            specularEnvMap: new Hilo3d.Texture(),
            isSpecularGlossiness: true
        });

        const option = material.getRenderOption();
        expect(option['HAS_TEXCOORD0']).toBe(1);
        expect(option['METALLIC_ROUGHNESS_MAP']).toBe(0);

        expect(option['HAS_TEXCOORD1']).toBe(1);
        expect(option['BASE_COLOR_MAP']).toBe(1);

        expect(option['PBR_SPECULAR_GLOSSINESS']).toBe(1);
        expect(option['SPECULAR_ENV_MAP']).toBeUndefined();

        material.brdfLUT = new Hilo3d.Texture();
        expect(material.getRenderOption()['SPECULAR_ENV_MAP']).toBe(0);
        expect(material.getRenderOption()['SPECULAR_ENV_MAP_CUBE']).toBeUndefined();

        material.specularEnvMap = new Hilo3d.CubeTexture();
        expect(material.getRenderOption()['SPECULAR_ENV_MAP_CUBE']).toBe(1);
    });

    it('gammaCorrection', () => {
        const material = new PBRMaterial();

        expect(material.gammaCorrection).toBe(true);
        expect(material.getRenderOption()['GAMMA_CORRECTION']).toBe(1);

        material.gammaCorrection = false;
        expect(material.gammaCorrection).toBe(false);
        expect(material.getRenderOption()['GAMMA_CORRECTION']).toBeUndefined();

        material.gammaCorrection = true;
        expect(material.getRenderOption()['GAMMA_CORRECTION']).toBe(1);
    });
});
