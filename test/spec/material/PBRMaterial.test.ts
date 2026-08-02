import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

describe('PBRMaterial', () => {
    it('creates a definition-backed standard-surface instance', () => {
        const material = new Hilo3d.PBRMaterial();
        expect(material.isPBRMaterial).toBe(true);
        expect(material.className).toBe('PBRMaterial');
        expect(material.definition.family).toBe('pbr');
    });

    it('compiles texture layout and environment topology once', () => {
        const material = new Hilo3d.PBRMaterial({
            metallicRoughnessMap: new Hilo3d.Texture({ uv: 0 }),
            baseColorMap: new Hilo3d.Texture({ uv: 1 }),
            brdfLUT: new Hilo3d.Texture(),
            diffuseEnvMap: new Hilo3d.CubeTexture(),
            specularEnvMap: new Hilo3d.CubeTexture(),
            isSpecularGlossiness: true
        });

        expect(material.getRenderOption()).toMatchObject({
            HAS_TEXCOORD0: 1,
            METALLIC_ROUGHNESS_MAP: material.definition.getTextureSlot('metallicRoughness')?.index,
            HAS_TEXCOORD1: 1,
            BASE_COLOR_MAP: material.definition.getTextureSlot('baseColor')?.index,
            PBR_SPECULAR_GLOSSINESS: 1,
            DIFFUSE_ENV_MAP: material.definition.getTextureSlot('diffuseEnvironment')?.index,
            DIFFUSE_ENV_MAP_CUBE: 1,
            SPECULAR_ENV_MAP: material.definition.getTextureSlot('specularEnvironment')?.index,
            SPECULAR_ENV_MAP_CUBE: 1
        });
        expect(material.getTextureSlot('baseColor')?.encoding).toBe('srgb');
        expect(material.getTextureSlot('metallicRoughness')?.encoding).toBe('data');
        expect(material.definition.getTextureSlot('specularEnvironment')?.viewDimension).toBe(
            'cube'
        );
        expect(material.definition.getTextureSlot('diffuseEnvironment')?.viewDimension).toBe(
            'cube'
        );
    });

    it('keeps transmission separate from alpha compositing', () => {
        const material = new Hilo3d.PBRMaterial({
            transmissionFactor: 0.9,
            thicknessFactor: 0.4
        });

        expect(material.requiresOpaqueSceneTexture).toBe(true);
        expect(material.isTransparent).toBe(false);
        expect(material.getRenderOption()).toMatchObject({
            HAS_TRANSMISSION: 1,
            HAS_VOLUME: 1
        });
    });

    it('enables layered anisotropy, clearcoat, volume and iridescence variants', () => {
        const material = new Hilo3d.PBRMaterial({
            clearcoatFactor: 0.8,
            clearcoatMap: new Hilo3d.Texture({ uv: 0 }),
            clearcoatNormalMap: new Hilo3d.Texture({ uv: 1 }),
            anisotropyStrength: 0.7,
            anisotropyMap: new Hilo3d.Texture({ uv: 1 }),
            transmissionFactor: 0.9,
            transmissionMap: new Hilo3d.Texture({ uv: 0 }),
            thicknessFactor: 0.4,
            thicknessMap: new Hilo3d.Texture({ uv: 1 }),
            iridescenceFactor: 0.85,
            iridescenceMap: new Hilo3d.Texture({ uv: 0 }),
            iridescenceThicknessMap: new Hilo3d.Texture({ uv: 1 })
        });

        expect(material.getRenderOption()).toMatchObject({
            HAS_CLEARCOAT: 1,
            HAS_ANISOTROPY: 1,
            NEED_TANGENT_BASIS: 1,
            HAS_TRANSMISSION: 1,
            HAS_VOLUME: 1,
            HAS_IRIDESCENCE: 1
        });
    });

    it('tracks scalar data and rejects runtime topology activation', () => {
        const plain = new Hilo3d.PBRMaterial();
        const plainDefinition = plain.definition;
        const plainRevision = plain.revision;

        plain.metallic = 0.25;
        expect(plain.definition).toBe(plainDefinition);
        expect(plain.revision).toBe(plainRevision + 1);
        expect(() => {
            plain.clearcoatFactor = 0.5;
        }).toThrow(/construct a new PBRMaterial/u);

        const layered = new Hilo3d.PBRMaterial({ clearcoatFactor: 1 });
        const layeredRevision = layered.revision;
        layered.clearcoatFactor = 0.25;
        expect(layered.revision).toBe(layeredRevision + 1);
    });
});
