import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';
import { SubsurfaceScatteringProfile } from '../../../src/material/SubsurfaceScatteringProfile';

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
        expect(material.forwardQueue).toBe('transparent');
        expect(material.getRenderOption()).toMatchObject({
            HAS_TRANSMISSION: 1,
            HAS_VOLUME: 1
        });
    });

    it('keeps ordinary opaque surfaces in the opaque forward queue', () => {
        const material = new Hilo3d.PBRMaterial();

        expect(material.requiresOpaqueSceneTexture).toBe(false);
        expect(material.isTransparent).toBe(false);
        expect(material.forwardQueue).toBe('opaque');
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

    it('keeps MAT1 opt-in and appends stable texture slots with independent metadata', () => {
        const plain = new Hilo3d.PBRMaterial();
        expect(plain.getRenderOption()).not.toHaveProperty('HAS_SHEEN');
        expect(plain.getRenderOption()).not.toHaveProperty('HAS_DIFFUSE_TRANSMISSION');
        expect(plain.getRenderOption()).not.toHaveProperty('HAS_SUBSURFACE');
        const transform = new Hilo3d.Matrix3().fromRotationTranslationScale(
            0.3,
            0.2,
            0.1,
            0.5,
            0.7
        );
        const texture = new Hilo3d.Texture();
        const material = new Hilo3d.PBRMaterial({
            sheenColor: new Hilo3d.Color(0.4, 0.1, 0.05),
            sheenColorMap: { texture, uvSet: 1, transform },
            sheenRoughnessMap: texture,
            diffuseTransmissionFactor: 0.65,
            diffuseTransmissionMap: { texture, channels: ['b', 'g', 'r', 'r'] },
            diffuseTransmissionColorMap: { texture, encoding: 'linear' }
        });
        expect(material.getRenderOption()).toMatchObject({
            HAS_SHEEN: 1,
            HAS_DIFFUSE_TRANSMISSION: 1,
            SHEEN_COLOR_MAP: 24,
            SHEEN_ROUGHNESS_MAP: 25,
            DIFFUSE_TRANSMISSION_MAP: 26,
            DIFFUSE_TRANSMISSION_COLOR_MAP: 27,
            HAS_TEXCOORD0: 1,
            HAS_TEXCOORD1: 1
        });
        expect(Hilo3d.MaterialTextureSlot.SPECULAR_ENVIRONMENT).toBe(23);
        expect(material.getTextureSlot('sheenColor')).toMatchObject({ uvSet: 1, encoding: 'srgb' });
        expect(material.getTextureSlot('sheenColor')?.transform?.elements).toEqual(
            transform.elements
        );
        expect(material.getTextureSlot('sheenRoughness')?.encoding).toBe('data');
        expect(material.getTextureSlot('diffuseTransmission')).toMatchObject({
            encoding: 'data',
            channels: ['b', 'g', 'r', 'r']
        });
        expect(material.getTextureSlot('diffuseTransmissionColor')?.encoding).toBe('linear');
        expect(material.forwardQueue).toBe('opaque');
        expect(material.requiresOpaqueSceneTexture).toBe(false);
        expect(material.isTransparent).toBe(false);
    });

    it('updates MAT1 instance data without changing topology and rejects implicit activation', () => {
        const material = new Hilo3d.PBRMaterial({
            sheenColor: new Hilo3d.Color(0, 0, 0),
            diffuseTransmissionFactor: 0
        });
        const definition = material.definition;
        const revision = material.revision;
        material.sheenRoughness = 0.7;
        material.diffuseTransmissionFactor = 0.6;
        material.sheenColor.set(0.3, 0.2, 0.1, 1);
        material.invalidateData();
        expect(material.revision).toBe(revision + 3);
        expect(material.definition).toBe(definition);
        material.sheenRoughness = 0.7;
        material.diffuseTransmissionFactor = 0.6;
        expect(material.revision).toBe(revision + 3);
        const plain = new Hilo3d.PBRMaterial();
        expect(() => {
            plain.diffuseTransmissionFactor = 0.4;
        }).toThrow(/topology/u);
        plain.sheenColor.r = 0.5;
        expect(() => {
            plain.invalidateData();
        }).toThrow(/topology/u);
    });

    it('validates finite MAT1 factors and linear RGB before publishing changes', () => {
        for (const value of [-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY]) {
            expect(() => new Hilo3d.PBRMaterial({ sheenRoughness: value })).toThrow(
                /sheenRoughness/u
            );
            expect(() => new Hilo3d.PBRMaterial({ diffuseTransmissionFactor: value })).toThrow(
                /diffuseTransmissionFactor/u
            );
            expect(
                () => new Hilo3d.PBRMaterial({ sheenColor: new Hilo3d.Color(value, 0, 0) })
            ).toThrow(/sheenColor.r/u);
            expect(
                () =>
                    new Hilo3d.PBRMaterial({
                        diffuseTransmissionColor: new Hilo3d.Color(0, value, 0)
                    })
            ).toThrow(/diffuseTransmissionColor.g/u);
        }
        const material = new Hilo3d.PBRMaterial({
            sheenColor: new Hilo3d.Color(0.2, 0.3, 0.4),
            diffuseTransmissionFactor: 0.4
        });
        const revision = material.revision;
        expect(() => {
            material.sheenRoughness = 2;
        }).toThrow();
        expect(() => {
            material.diffuseTransmissionFactor = Number.NaN;
        }).toThrow();
        expect(material.sheenRoughness).toBe(0);
        expect(material.diffuseTransmissionFactor).toBe(0.4);
        material.sheenColor.r = 2;
        expect(() => {
            material.invalidateData();
        }).toThrow(/sheenColor.r/u);
        expect(material.revision).toBe(revision);
    });

    it('snapshots loader default colors independently for each material', () => {
        const defaults = {
            sheenColor: new Hilo3d.Color(0.2, 0.4, 0.6),
            diffuseTransmissionColor: new Hilo3d.Color(0.7, 0.8, 0.9)
        };
        const first = new Hilo3d.PBRMaterialBuilder(defaults).build();
        const second = new Hilo3d.PBRMaterialBuilder(defaults).build();
        first.sheenColor.r = 0.8;
        first.diffuseTransmissionColor.g = 0.1;
        first.invalidateData();
        expect(second.sheenColor.r).toBeCloseTo(0.2);
        expect(second.diffuseTransmissionColor.g).toBeCloseTo(0.8);
        expect(defaults.sheenColor.r).toBeCloseTo(0.2);
    });

    it('rejects unsupported unlit and specular-glossiness MAT1 combinations', () => {
        for (const surface of [{ unlit: true }, { isSpecularGlossiness: true }]) {
            expect(
                () => new Hilo3d.PBRMaterial({ ...surface, sheenColor: new Hilo3d.Color(0, 0, 0) })
            ).toThrow(/metallic-roughness/u);
            expect(
                () => new Hilo3d.PBRMaterial({ ...surface, diffuseTransmissionFactor: 0 })
            ).toThrow(/metallic-roughness/u);
        }
    });

    it('allows thin specular/diffuse transmission layering but rejects volumetric diffuse transport', () => {
        const thin = new Hilo3d.PBRMaterial({
            transmissionFactor: 0.3,
            diffuseTransmissionFactor: 0.6
        });
        expect(thin.getRenderOption()).toMatchObject({
            HAS_TRANSMISSION: 1,
            HAS_DIFFUSE_TRANSMISSION: 1
        });
        expect(thin.getRenderOption()).not.toHaveProperty('HAS_VOLUME');
        expect(thin.requiresOpaqueSceneTexture).toBe(true);
        expect(
            () => new Hilo3d.PBRMaterial({ diffuseTransmissionFactor: 0.5, thicknessFactor: 0.01 })
        ).toThrow(/volume thickness/u);
        expect(
            () =>
                new Hilo3d.PBRMaterial({
                    diffuseTransmissionFactor: 0.5,
                    thicknessMap: new Hilo3d.Texture()
                })
        ).toThrow(/volume thickness/u);
        expect(
            () =>
                new Hilo3d.PBRMaterial({
                    transmissionFactor: 0.4,
                    diffuseTransmissionFactor: 0.5,
                    thicknessFactor: 0.01
                })
        ).toThrow(/volume thickness/u);
    });

    it('constructs immutable subsurface topology with bounded mutable scattering data', () => {
        const profile = new SubsurfaceScatteringProfile({ radius: [0.01, 0.004, 0.002] });
        const material = new Hilo3d.PBRMaterial({
            subsurfaceProfile: profile,
            sheenColor: new Hilo3d.Color(0.1, 0.1, 0.1),
            coverage: { mode: 'mask', cutoff: 0.5 }
        });
        expect(material.subsurfaceProfile).toBe(profile);
        expect(material.subsurfaceFactor).toBe(1);
        expect(material.subsurfaceThickness).toBeCloseTo(0.03);
        expect(material.getRenderOption()).toMatchObject({ HAS_SUBSURFACE: 1, HAS_SHEEN: 1 });
        expect(material.forwardQueue).toBe('opaque');
        const definition = material.definition;
        const revision = material.revision;
        material.subsurfaceFactor = 0.5;
        material.subsurfaceThickness = 0.02;
        expect(material.definition).toBe(definition);
        expect(material.revision).toBe(revision + 2);
        material.subsurfaceFactor = 0.5;
        material.subsurfaceThickness = 0.02;
        expect(material.revision).toBe(revision + 2);
        expect(
            new Hilo3d.PBRMaterial({
                subsurfaceProfile: new SubsurfaceScatteringProfile({
                    radius: [10000, 10000, 10000]
                })
            }).subsurfaceThickness
        ).toBe(10000);
    });

    it('rejects missing subsurface profiles and unsupported surface combinations', () => {
        const profile = new SubsurfaceScatteringProfile();
        const incompatible: readonly Hilo3d.PBRMaterialParameters[] = [
            { unlit: true },
            { isSpecularGlossiness: true },
            { transmissionFactor: 0.4 },
            { transmissionMap: new Hilo3d.Texture() },
            { diffuseTransmissionFactor: 0 },
            { compositing: { mode: 'alpha-blend', premultiplied: false } },
            { compositing: { mode: 'weighted-blended' } },
            { coverage: { mode: 'alpha-to-coverage', cutoff: 0.5 } },
            { state: { depthTest: false } },
            { state: { depthWrite: false } },
            { state: { depthCompare: 'always' } },
            { state: { depthRange: [0.2, 1] } },
            { state: { wireframe: true } },
            { state: { alphaToCoverage: true } },
            {
                state: {
                    blend: {
                        color: { operation: 'add', srcFactor: 'one', dstFactor: 'one' },
                        alpha: { operation: 'add', srcFactor: 'one', dstFactor: 'one' }
                    }
                }
            },
            {
                state: {
                    stencil: {
                        front: {
                            compare: 'always',
                            failOp: 'keep',
                            depthFailOp: 'keep',
                            passOp: 'replace'
                        },
                        back: {
                            compare: 'always',
                            failOp: 'keep',
                            depthFailOp: 'keep',
                            passOp: 'keep'
                        },
                        readMask: 255,
                        writeMask: 255,
                        reference: 1
                    }
                }
            }
        ];
        for (const parameters of incompatible) {
            expect(
                () => new Hilo3d.PBRMaterial({ ...parameters, subsurfaceProfile: profile })
            ).toThrow(/Subsurface scattering/u);
        }
        expect(() => new Hilo3d.PBRMaterial({ subsurfaceFactor: 0.1 })).toThrow(
            /subsurfaceProfile/u
        );
        expect(() => new Hilo3d.PBRMaterial({ subsurfaceThickness: 1 })).toThrow(
            /subsurfaceProfile/u
        );
        const plain = new Hilo3d.PBRMaterial();
        expect(() => {
            plain.subsurfaceFactor = 1;
        }).toThrow(/topology/u);
        expect(() => {
            plain.subsurfaceThickness = 1;
        }).toThrow(/topology/u);
    });

    it('rejects invalid subsurface scalars without consuming a material revision', () => {
        const profile = new SubsurfaceScatteringProfile();
        const material = new Hilo3d.PBRMaterial({ subsurfaceProfile: profile });
        const revision = material.revision;
        for (const value of [-1, 1.1, Number.NaN, Number.POSITIVE_INFINITY]) {
            expect(
                () =>
                    new Hilo3d.PBRMaterial({ subsurfaceProfile: profile, subsurfaceFactor: value })
            ).toThrow(/subsurfaceFactor/u);
            expect(() => {
                material.subsurfaceFactor = value;
            }).toThrow(/subsurfaceFactor/u);
        }
        for (const value of [
            -1,
            0,
            0.000001,
            Number.MIN_VALUE,
            10001,
            Number.NaN,
            Number.POSITIVE_INFINITY
        ]) {
            expect(
                () =>
                    new Hilo3d.PBRMaterial({
                        subsurfaceProfile: profile,
                        subsurfaceThickness: value
                    })
            ).toThrow(/subsurfaceThickness/u);
            expect(() => {
                material.subsurfaceThickness = value;
            }).toThrow(/subsurfaceThickness/u);
        }
        expect(material.revision).toBe(revision);
    });
});
