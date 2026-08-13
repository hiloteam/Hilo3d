import { describe, expect, it } from 'vitest';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import Mesh from '../../../src/core/Mesh';
import Node from '../../../src/core/Node';
import BoxGeometry from '../../../src/geometry/BoxGeometry';
import Geometry from '../../../src/geometry/Geometry';
import GeometryData from '../../../src/geometry/GeometryData';
import MorphGeometry from '../../../src/geometry/MorphGeometry';
import AreaLight from '../../../src/light/AreaLight';
import DirectionalLight from '../../../src/light/DirectionalLight';
import PointLight from '../../../src/light/PointLight';
import BasicMaterial from '../../../src/material/BasicMaterial';
import PBRMaterial from '../../../src/material/PBRMaterial';
import Color from '../../../src/math/Color';
import Matrix3 from '../../../src/math/Matrix3';
import Vector3 from '../../../src/math/Vector3';
import Renderer from '../../../src/render/Renderer';
import {
    registerRendererDiagnostics,
    unregisterRendererDiagnostics
} from '../../../src/render/diagnostics/RendererDiagnosticsRegistry';
import { ClusteredForwardPlusPipelineFactory } from '../../../src/render/pipeline/ClusteredForwardPlus';
import type { RHIDevice } from '../../../src/render/rhi/core';
import Texture from '../../../src/texture/Texture';
import { RGBA, TEXTURE_2D, UNSIGNED_BYTE } from '../../../src/constants/webgl';
import { RGBA8 } from '../../../src/constants/webgl2';

declare const __HILO3D_GITHUB_ACTIONS_COVERAGE__: boolean;

function rgbaTexture(
    pixel: readonly [number, number, number, number],
    uv: 0 | 1
): Texture<Uint8Array> {
    return new Texture({
        image: new Uint8Array(pixel),
        target: TEXTURE_2D,
        internalFormat: RGBA8,
        format: RGBA,
        type: UNSIGNED_BYTE,
        width: 1,
        height: 1,
        uv
    });
}

describe('ClusteredForwardPlusPipelineFactory', () => {
    it('declares the complete WebGPU storage, compute, indirect, and texture contract', () => {
        const geometry = new BoxGeometry();
        const material = new PBRMaterial();
        const factory = new ClusteredForwardPlusPipelineFactory({
            buckets: [{ geometry, material }],
            maxObjects: 1_024,
            maxLightIndices: 65_536
        });

        expect(factory.name).toBe('GPU Scene + Clustered Forward+');
        expect(factory.requirements.requiredCapabilities).toEqual([
            'storage-buffer',
            'storage-texture',
            'compute-pass',
            'indirect-draw'
        ]);
        expect(factory.requirements.requiredLimits).toMatchObject({
            maxBindingsPerBindGroup: 18,
            maxStorageBuffersPerShaderStage: 8,
            maxStorageTexturesPerShaderStage: 1,
            maxSampledTexturesPerShaderStage: 12,
            maxSamplersPerShaderStage: 7,
            maxComputeInvocationsPerWorkgroup: 256
        });
        expect(
            factory.requirements.requiredLimits?.['maxComputeWorkgroupsPerDimension']
        ).toBeGreaterThan(0);
        expect(factory.requirements.requiredTextureFormats).toContainEqual({
            format: 'rg32float',
            use: 'storage'
        });

        const withTemporalAA = new ClusteredForwardPlusPipelineFactory({
            buckets: [{ geometry, material }],
            temporalAA: {}
        });
        expect(withTemporalAA.requirements.requiredLimits).toMatchObject({
            maxColorAttachments: 3
        });
        expect(withTemporalAA.requirements.requiredTextureFormats).toContainEqual({
            format: 'r32float',
            use: 'color-attachment'
        });

        const withoutHiZ = new ClusteredForwardPlusPipelineFactory({
            buckets: [{ geometry, material }],
            hiZ: false,
            tileSize: 128,
            zSlices: 1,
            maxViewportWidth: 9_000,
            maxViewportHeight: 1
        });
        expect(withoutHiZ.requirements.requiredCapabilities).not.toContain('storage-texture');
        expect(withoutHiZ.requirements.requiredTextureFormats).not.toContainEqual({
            format: 'rg32float',
            use: 'storage'
        });
        expect(withoutHiZ.requirements.requiredLimits).toMatchObject({
            maxBindingsPerBindGroup: 14,
            maxSampledTexturesPerShaderStage: 7
        });

        const maximumHiZ = new ClusteredForwardPlusPipelineFactory({
            buckets: [{ geometry, material }],
            maxViewportWidth: 8_192,
            maxViewportHeight: 8_192
        });
        expect(maximumHiZ.requirements.requiredLimits).toMatchObject({
            maxBindingsPerBindGroup: 19,
            maxSampledTexturesPerShaderStage: 13
        });

        const withReflections = new ClusteredForwardPlusPipelineFactory({
            buckets: [{ geometry, material }],
            temporalAA: {},
            screenSpaceReflections: {}
        });
        expect(withReflections.requirements.requiredLimits).toMatchObject({
            maxStorageTexturesPerShaderStage: 2,
            maxSampledTexturesPerShaderStage: 14,
            maxColorAttachments: 3
        });
        expect(withReflections.requirements.requiredTextureFormats).toEqual(
            expect.arrayContaining([
                { format: 'rgba16float', use: 'storage' },
                { format: 'r32float', use: 'storage' },
                { format: 'rg32float', use: 'storage' }
            ])
        );

        const withGTAO = new ClusteredForwardPlusPipelineFactory({
            buckets: [{ geometry, material }],
            temporalAA: {},
            groundTruthAmbientOcclusion: {}
        });
        expect(withGTAO.requirements.requiredLimits).toMatchObject({
            maxSampledTexturesPerShaderStage: 12,
            maxSamplersPerShaderStage: 8
        });

        const withSSGI = new ClusteredForwardPlusPipelineFactory({
            buckets: [{ geometry, material }],
            temporalAA: {},
            screenSpaceGlobalIllumination: {}
        });
        expect(withSSGI.requirements.requiredLimits).toMatchObject({
            maxSampledTexturesPerShaderStage: 12,
            maxColorAttachments: 3
        });
        expect(withSSGI.requirements.requiredTextureFormats).toEqual(
            expect.arrayContaining([
                { format: 'rgba16float', use: 'color-attachment' },
                { format: 'rgba16float', use: 'filterable-sampled' }
            ])
        );

        const withVolumetrics = new ClusteredForwardPlusPipelineFactory({
            buckets: [{ geometry, material }],
            hiZ: false,
            volumetricLighting: { quality: 'ultra' }
        });
        expect(withVolumetrics.requirements.requiredCapabilities).toContain('storage-texture');
        expect(withVolumetrics.requirements.requiredLimits).toMatchObject({
            maxBindingsPerBindGroup: 14,
            maxStorageTexturesPerShaderStage: 2
        });
        expect(withVolumetrics.requirements.requiredTextureFormats).toEqual(
            expect.arrayContaining([
                { format: 'rgba16float', use: 'storage' },
                { format: 'r32float', use: 'storage' },
                { format: 'r32float', use: 'sampled' }
            ])
        );

        const withWeather = new ClusteredForwardPlusPipelineFactory({
            buckets: [{ geometry, material }],
            hiZ: false,
            autoExposure: {},
            atmosphere: { quality: 'ultra' },
            volumetricLighting: {}
        });
        expect(withWeather.requirements.requiredCapabilities).toContain('storage-texture');
        expect(withWeather.requirements.requiredLimits).toMatchObject({
            maxBindingsPerBindGroup: 16,
            maxStorageTexturesPerShaderStage: 2,
            maxSamplersPerShaderStage: 8
        });
        expect(withWeather.requirements.requiredTextureFormats).toEqual(
            expect.arrayContaining([
                { format: 'rgba16float', use: 'storage' },
                { format: 'rgba16float', use: 'filterable-sampled' },
                { format: 'r32float', use: 'storage' }
            ])
        );
    });

    it('validates bucket identities, opaque materials, and unique LOD thresholds', () => {
        const geometry = new BoxGeometry();
        const material = new PBRMaterial();
        const transparent = new PBRMaterial({
            compositing: { mode: 'alpha-blend', premultiplied: true }
        });

        expect(() => new ClusteredForwardPlusPipelineFactory({ buckets: [] })).toThrow(
            /at least one GPU Scene bucket/u
        );
        expect(
            () =>
                new ClusteredForwardPlusPipelineFactory({
                    buckets: [{ geometry, material: transparent }]
                })
        ).toThrow(/opaque and unblended/u);
        expect(
            () =>
                new ClusteredForwardPlusPipelineFactory({
                    buckets: [
                        {
                            geometry,
                            material,
                            lods: [
                                { geometry: new BoxGeometry(), maximumProjectedRadius: 24 },
                                { geometry: new BoxGeometry(), maximumProjectedRadius: 24 }
                            ]
                        }
                    ]
                })
        ).toThrow(/LOD thresholds must be unique/u);
        expect(
            () =>
                new ClusteredForwardPlusPipelineFactory({
                    buckets: [{ geometry, material }],
                    tileSize: 4
                })
        ).toThrow(/tileSize must be between 8 and 128/u);
        expect(
            () =>
                new ClusteredForwardPlusPipelineFactory({
                    buckets: [
                        {
                            geometry,
                            material: new PBRMaterial({
                                coverage: { mode: 'mask', cutoff: 0.5 }
                            })
                        }
                    ]
                })
        ).toThrow(/unsupported raster or alpha mode/u);
        expect(
            () =>
                new ClusteredForwardPlusPipelineFactory({
                    buckets: [{ geometry, material: new PBRMaterial({ clearcoatFactor: 0.5 }) }]
                })
        ).toThrow(/unsupported layered PBR feature/u);
        expect(
            () =>
                new ClusteredForwardPlusPipelineFactory({
                    buckets: [{ geometry: new MorphGeometry(), material }]
                })
        ).toThrow(/must not use morph geometry/u);
        expect(
            () =>
                new ClusteredForwardPlusPipelineFactory({
                    buckets: [{ geometry, material }],
                    hiZ: 'true'
                } as unknown as ConstructorParameters<
                    typeof ClusteredForwardPlusPipelineFactory
                >[0])
        ).toThrow(/hiZ must be a boolean/u);
        expect(
            () =>
                new ClusteredForwardPlusPipelineFactory({
                    buckets: [{ geometry, material }],
                    temporalAA: { varianceGamma: 8 }
                })
        ).toThrow(/varianceGamma/u);
        expect(
            () =>
                new ClusteredForwardPlusPipelineFactory({
                    buckets: [{ geometry, material }],
                    screenSpaceReflections: {}
                })
        ).toThrow(/require temporalAA/u);
        expect(
            () =>
                new ClusteredForwardPlusPipelineFactory({
                    buckets: [{ geometry, material }],
                    groundTruthAmbientOcclusion: {}
                })
        ).toThrow(/requires temporalAA/u);
        expect(
            () =>
                new ClusteredForwardPlusPipelineFactory({
                    buckets: [{ geometry, material }],
                    screenSpaceGlobalIllumination: {}
                })
        ).toThrow(/requires temporalAA/u);
        expect(
            () =>
                new ClusteredForwardPlusPipelineFactory({
                    buckets: [{ geometry, material }],
                    temporalAA: {},
                    screenSpaceGlobalIllumination: { stepCount: 7 as 6 }
                })
        ).toThrow(/stepCount/u);
        expect(
            () =>
                new ClusteredForwardPlusPipelineFactory({
                    buckets: [{ geometry, material }],
                    hiZ: false,
                    temporalAA: {},
                    screenSpaceReflections: {}
                })
        ).toThrow(/require hiZ/u);
        expect(
            () =>
                new ClusteredForwardPlusPipelineFactory({
                    buckets: [{ geometry, material }],
                    temporalAA: {},
                    screenSpaceReflections: { maxSteps: 7 }
                })
        ).toThrow(/maxSteps/u);
        expect(
            () =>
                new ClusteredForwardPlusPipelineFactory({
                    buckets: [{ geometry, material }],
                    volumetricLighting: { quality: 'cinematic' }
                } as unknown as ConstructorParameters<
                    typeof ClusteredForwardPlusPipelineFactory
                >[0])
        ).toThrow(/quality/u);
        expect(
            () =>
                new ClusteredForwardPlusPipelineFactory({
                    buckets: [{ geometry, material }],
                    volumetricLighting: { resolutionScale: 2 }
                })
        ).toThrow(/resolutionScale/u);
        expect(
            () =>
                new ClusteredForwardPlusPipelineFactory({
                    buckets: [{ geometry, material }],
                    volumetricLighting: {
                        localVolumes: [
                            {
                                shape: 'sphere',
                                center: new Vector3(),
                                radius: 0,
                                density: 1
                            }
                        ]
                    }
                })
        ).toThrow(/radius/u);
        expect(
            () =>
                new ClusteredForwardPlusPipelineFactory({
                    buckets: [{ geometry, material }],
                    toneMapping: 'linear'
                } as unknown as ConstructorParameters<
                    typeof ClusteredForwardPlusPipelineFactory
                >[0])
        ).toThrow(/toneMapping/u);
        expect(
            () =>
                new ClusteredForwardPlusPipelineFactory({
                    buckets: [{ geometry, material }],
                    atmosphere: { quality: 'cinematic' }
                } as unknown as ConstructorParameters<
                    typeof ClusteredForwardPlusPipelineFactory
                >[0])
        ).toThrow(/quality/u);
    });

    it('requests limits for every configured cluster, geometry, and dispatch allocation', () => {
        const geometry = new BoxGeometry();
        const factory = new ClusteredForwardPlusPipelineFactory({
            buckets: [{ geometry, material: new PBRMaterial() }],
            maxObjects: 1,
            maxLights: 1,
            maxLightIndices: 1,
            maxLightsPerCluster: 1,
            tileSize: 8,
            zSlices: 64,
            maxViewportWidth: 4_096,
            maxViewportHeight: 2_160
        });
        const maxClusters = Math.ceil(4_096 / 8) * Math.ceil(2_160 / 8) * 64;
        const clusterGridBytes = maxClusters * 8;
        const clusterBlockCount = Math.ceil(maxClusters / 256);

        expect(factory.requirements.requiredLimits).toMatchObject({
            maxStorageBufferBindingSize: clusterGridBytes,
            maxBufferSize: clusterGridBytes,
            maxComputeWorkgroupsPerDimension: clusterBlockCount
        });

        const vertexValues = new Float32Array(4_096 * 3);
        const geometryBufferBytes = vertexValues.byteLength;
        const largeGeometry = new Geometry({
            vertices: new GeometryData(vertexValues, 3),
            normals: new GeometryData(vertexValues.slice(), 3),
            indices: new GeometryData(new Uint16Array([0, 0, 0]), 1)
        });
        const geometryFactory = new ClusteredForwardPlusPipelineFactory({
            buckets: [{ geometry: largeGeometry, material: new PBRMaterial() }],
            maxObjects: 1,
            maxLights: 1,
            maxLightIndices: 1,
            maxLightsPerCluster: 1,
            tileSize: 8,
            zSlices: 1,
            maxViewportWidth: 8,
            maxViewportHeight: 8
        });

        expect(geometryFactory.requirements.requiredLimits).toMatchObject({
            maxStorageBufferBindingSize: geometryBufferBytes,
            maxBufferSize: geometryBufferBytes
        });
    });

    it.skipIf(__HILO3D_GITHUB_ACTIONS_COVERAGE__)(
        'renders every compacted material bucket without indirect-first-instance',
        async () => {
            const geometry = new BoxGeometry();
            const materials = [
                new PBRMaterial({
                    baseColor: new Color(0, 0, 0),
                    emissionFactor: new Color(3, 0, 0)
                }),
                new PBRMaterial({
                    baseColor: new Color(0, 0, 0),
                    emissionFactor: new Color(0, 3, 0)
                }),
                new PBRMaterial({
                    baseColor: new Color(0, 0, 0),
                    emissionFactor: new Color(0, 0, 3)
                })
            ] as const;
            const factory = new ClusteredForwardPlusPipelineFactory({
                buckets: materials.map(material => ({ geometry, material })),
                maxObjects: materials.length,
                maxLights: 1,
                maxLightIndices: 1,
                maxLightsPerCluster: 1,
                maxViewportWidth: 96,
                maxViewportHeight: 48,
                hiZ: false,
                bloomStrength: 0
            });
            const renderer = await Renderer.create({
                backend: 'webgpu',
                domElement: document.createElement('canvas'),
                width: 96,
                height: 48,
                antialias: false,
                renderingProfile: 'high-end',
                renderPipeline: factory
            });
            const target = renderer.createRenderTarget({
                width: 96,
                height: 48,
                colorAttachments: [{ format: 'rgba8unorm' }],
                depthStencilAttachment: { format: 'depth32float', depthMode: 'reversed' }
            });
            try {
                const scene = new Node();
                for (let index = 0; index < materials.length; index += 1) {
                    const material = materials[index];
                    if (material === undefined) throw new Error('Expected a bucket material');
                    new Mesh({
                        geometry,
                        material,
                        x: (index - 1) * 2,
                        frustumTest: false
                    }).addTo(scene);
                }
                const camera = new PerspectiveCamera({
                    aspect: 2,
                    fov: 45,
                    near: 0.1,
                    far: 20,
                    depthMode: 'reversed'
                });
                camera.setPosition(0, 0, 6).lookAt(new Vector3(0, 0, 0));

                renderer.renderToTarget(target, scene, camera);
                renderer.renderToTarget(target, scene, camera);
                await renderer.waitForIdle();
                const readback = await target.readColorAttachment();
                const dominant: [number, number, number] = [0, 0, 0];
                for (let offset = 0; offset < readback.data.length; offset += 4) {
                    const red = readback.data[offset] ?? 0;
                    const green = readback.data[offset + 1] ?? 0;
                    const blue = readback.data[offset + 2] ?? 0;
                    const maximum = Math.max(red, green, blue);
                    if (maximum < 32) continue;
                    if (red > green * 1.5 && red > blue * 1.5) dominant[0]++;
                    if (green > red * 1.5 && green > blue * 1.5) dominant[1]++;
                    if (blue > red * 1.5 && blue > green * 1.5) dominant[2]++;
                }

                expect(dominant[0]).toBeGreaterThan(20);
                expect(dominant[1]).toBeGreaterThan(20);
                expect(dominant[2]).toBeGreaterThan(20);
                expect(await factory.readDiagnostics()).toMatchObject({
                    objectCount: 3,
                    fallbackObjectCount: 0,
                    visibleObjectCount: 3
                });
            } finally {
                target.destroy();
                renderer.destroy();
            }
        },
        20_000
    );

    it.skipIf(__HILO3D_GITHUB_ACTIONS_COVERAGE__)(
        'integrates GTAO before indirect clustered PBR shading',
        async () => {
            const geometry = new BoxGeometry();
            const material = new PBRMaterial({
                baseColor: new Color(0.65, 0.55, 0.42),
                metallic: 0,
                roughness: 0.7
            });
            const factory = new ClusteredForwardPlusPipelineFactory({
                buckets: [{ geometry, material }],
                maxObjects: 2,
                maxLights: 1,
                maxLightIndices: 128,
                maxLightsPerCluster: 1,
                maxViewportWidth: 64,
                maxViewportHeight: 64,
                hiZ: false,
                bloomStrength: 0,
                temporalAA: {},
                groundTruthAmbientOcclusion: {
                    directionCount: 4,
                    stepCount: 3,
                    resolutionScale: 0.5
                }
            });
            const canvas = document.createElement('canvas');
            const rendererDiagnostics = registerRendererDiagnostics(canvas);
            const renderer = await Renderer.create({
                backend: 'webgpu',
                domElement: canvas,
                width: 64,
                height: 64,
                antialias: false,
                renderingProfile: 'high-end',
                renderPipeline: factory
            });
            try {
                const scene = new Node();
                new Mesh({ geometry, material, frustumTest: false }).addTo(scene);
                new PointLight({ amount: 4, range: 8, z: 3 }).addTo(scene);
                const camera = new PerspectiveCamera({
                    aspect: 1,
                    near: 0.1,
                    far: 20,
                    depthMode: 'reversed'
                });
                camera.setPosition(0, 0, 4).lookAt(new Vector3(0, 0, 0));

                renderer.render(scene, camera);
                await renderer.waitForIdle();
                renderer.render(scene, camera);
                await renderer.waitForIdle();

                expect(await factory.readDiagnostics()).toMatchObject({
                    objectCount: 1,
                    fallbackObjectCount: 0
                });
                expect(renderer.renderInfo.drawCount).toBeGreaterThan(0);
                const passNames = rendererDiagnostics
                    .snapshot()
                    .renderGraph?.passes.map(pass => pass.name);
                expect(passNames).toEqual(
                    expect.arrayContaining([
                        'GPU Scene GTAO material attributes',
                        'GTAO rotated horizon search',
                        'GTAO production temporal resolve',
                        'Clustered PBR buckets'
                    ])
                );
            } finally {
                unregisterRendererDiagnostics(canvas);
                renderer.destroy();
            }
        },
        20_000
    );

    it.skipIf(__HILO3D_GITHUB_ACTIONS_COVERAGE__)(
        'renders GPU Scene culling, indirect buckets and clustered lighting on real WebGPU',
        async () => {
            const geometry = new BoxGeometry({ widthSegments: 2 });
            const uv0 = geometry.uvs;
            if (uv0 === null) throw new Error('Expected box UV data');
            geometry.uvs1 = new GeometryData(uv0.data.slice(), 2);
            const surfaceTexture = rgbaTexture([190, 140, 90, 255], 0);
            const normalTexture = rgbaTexture([128, 128, 255, 255], 1);
            const uv0Transform = new Matrix3().fromRotationTranslationScale(0, 0.1, 0.05, 0.8, 0.8);
            const uv1Transform = new Matrix3().fromRotationTranslationScale(0, 0, 0, 1, 1);
            const material = new PBRMaterial({
                metallic: 0.35,
                roughness: 0.28,
                baseColorMap: { texture: surfaceTexture, transform: uv0Transform },
                metallicMap: surfaceTexture,
                roughnessMap: surfaceTexture,
                metallicRoughnessMap: surfaceTexture,
                occlusionMap: surfaceTexture,
                emission: surfaceTexture,
                emissionFactor: new Color(0.02, 0.01, 0.005),
                normalMap: { texture: normalTexture, transform: uv1Transform },
                normalScale: 0.75,
                isOcclusionInMetallicRoughnessMap: true
            });
            const factory = new ClusteredForwardPlusPipelineFactory({
                buckets: [{ geometry, material }],
                maxObjects: 8,
                maxLights: 8,
                maxLightIndices: 4_096,
                maxLightsPerCluster: 8,
                maxViewportWidth: 128,
                maxViewportHeight: 128,
                temporalAA: { renderScale: 0.75 },
                screenSpaceReflections: { resolutionScale: 0.5, maxSteps: 8 },
                volumetricLighting: {
                    quality: 'low',
                    density: 0.018,
                    maxDistance: 20,
                    shadowSteps: 2,
                    localVolumes: [
                        {
                            shape: 'sphere',
                            center: new Vector3(0, 0, 1),
                            radius: 3,
                            density: 0.01,
                            albedo: new Color(0.7, 0.82, 1)
                        }
                    ]
                }
            });
            const canvas = document.createElement('canvas');
            const rendererDiagnostics = registerRendererDiagnostics(canvas);
            const renderer = await Renderer.create({
                backend: 'webgpu',
                domElement: canvas,
                width: 128,
                height: 96,
                antialias: false,
                renderingProfile: 'high-end',
                renderPipeline: factory
            });
            try {
                const scene = new Node();
                const meshes: Mesh[] = [];
                for (let index = 0; index < 12; index += 1) {
                    const mesh = new Mesh({
                        geometry,
                        material,
                        x: ((index % 4) - 1.5) * 0.85,
                        y: (Math.floor(index / 4) - 1) * 0.85,
                        z: 0,
                        scaleX: index === 0 ? 1.75 : 1
                    });
                    meshes.push(mesh);
                    mesh.addTo(scene);
                }
                for (let index = 0; index < 4; index += 1) {
                    const angle = (index / 4) * Math.PI * 2;
                    new PointLight({
                        amount: 3,
                        range: 6,
                        x: Math.cos(angle) * 2.5,
                        y: Math.sin(angle) * 1.5,
                        z: 3
                    }).addTo(scene);
                }
                const camera = new PerspectiveCamera({
                    aspect: 4 / 3,
                    near: 0.1,
                    far: 30,
                    depthMode: 'reversed'
                });
                camera.setPosition(0, 0, 8).lookAt(new Vector3(0, 0, 0));

                renderer.render(scene, camera);
                renderer.render(scene, camera);
                renderer.render(scene, camera);
                await renderer.waitForIdle();
                const diagnostics = await factory.readDiagnostics();

                expect(diagnostics.objectCount).toBe(8);
                expect(diagnostics.fallbackObjectCount).toBe(4);
                expect(diagnostics.lightCount).toBe(4);
                expect(diagnostics.visibleObjectCount).toBeGreaterThan(0);
                expect(diagnostics.clusterLightIndexCount).toBeGreaterThan(0);
                expect(diagnostics.clusterOverflowCount).toBe(0);
                expect(diagnostics.hiZValid).toBe(true);
                expect(diagnostics.volumetricFroxelCount).toBeGreaterThan(0);
                expect(diagnostics.volumetricHistoryUsed).toBe(true);
                expect(renderer.renderInfo.drawCount).toBeGreaterThan(0);
                const passNames = rendererDiagnostics
                    .snapshot()
                    .renderGraph?.passes.map(pass => pass.name);
                expect(passNames).toBeDefined();
                const fallbackDepthIndex =
                    passNames?.indexOf('Clustered Forward+ fallback depth prepass') ?? -1;
                const currentHiZIndex =
                    passNames?.indexOf('GPU Scene current depth Hi-Z min/max mip zero') ?? -1;
                expect(fallbackDepthIndex).toBeGreaterThan(-1);
                expect(currentHiZIndex).toBeGreaterThan(fallbackDepthIndex);
                expect(passNames).toContain('Screen-space reflections confidence filter step 8');
                expect(passNames).toEqual(
                    expect.arrayContaining([
                        'Froxel volumetric light and density injection',
                        'Froxel cumulative line integration',
                        'Froxel constant-time view reconstruction',
                        'Volumetric lighting depth-aware temporal resolve',
                        'Volumetric lighting linear HDR composite'
                    ])
                );

                camera.setPosition(0.25, 0, 8).lookAt(new Vector3(0, 0, 0));
                renderer.render(scene, camera);
                await renderer.waitForIdle();
                expect((await factory.readDiagnostics()).hiZValid).toBe(false);
                renderer.render(scene, camera);
                await renderer.waitForIdle();
                expect((await factory.readDiagnostics()).hiZValid).toBe(true);

                material.setTextureSlot('baseColor', {
                    texture: rgbaTexture([80, 160, 220, 255], 0),
                    transform: uv0Transform
                });
                renderer.render(scene, camera);
                await renderer.waitForIdle();
                expect(await factory.readDiagnostics()).toMatchObject({
                    objectCount: 8,
                    fallbackObjectCount: 4
                });

                camera.invalidateTransformHistory();
                renderer.render(scene, camera);
                await renderer.waitForIdle();
                expect((await factory.readDiagnostics()).hiZValid).toBe(false);
                renderer.render(scene, camera);
                await renderer.waitForIdle();
                expect((await factory.readDiagnostics()).hiZValid).toBe(true);

                renderer.resize(80, 96, true);
                camera.aspect = 80 / 96;
                renderer.render(scene, camera);
                await renderer.waitForIdle();
                expect((await factory.readDiagnostics()).hiZValid).toBe(false);
                renderer.render(scene, camera);
                await renderer.waitForIdle();
                expect((await factory.readDiagnostics()).hiZValid).toBe(true);

                const extension = renderer.getExtension('rhi') as {
                    readonly device: RHIDevice;
                } | null;
                if (extension === null) throw new Error('Expected the public RHI extension');
                const deviceLost = new Promise<void>(resolve => {
                    renderer.on(
                        'webgpuDeviceLost',
                        () => {
                            resolve();
                        },
                        true
                    );
                });
                const deviceRestored = new Promise<void>(resolve => {
                    renderer.on(
                        'webgpuDeviceRestored',
                        () => {
                            resolve();
                        },
                        true
                    );
                });
                extension.device.destroy();
                await deviceLost;
                await Promise.all([renderer.waitForIdle(), deviceRestored]);
                renderer.render(scene, camera);
                renderer.render(scene, camera);
                await renderer.waitForIdle();
                expect(await factory.readDiagnostics()).toMatchObject({
                    objectCount: 8,
                    fallbackObjectCount: 4,
                    hiZValid: true
                });

                camera.depthMode = 'standard';
                renderer.render(scene, camera);
                await renderer.waitForIdle();
                expect((await factory.readDiagnostics()).hiZValid).toBe(false);
                renderer.render(scene, camera);
                await renderer.waitForIdle();
                expect((await factory.readDiagnostics()).hiZValid).toBe(true);

                const maskedMaterial = new PBRMaterial({
                    coverage: { mode: 'mask', cutoff: 0.5 }
                });
                for (const mesh of meshes) mesh.material = maskedMaterial;
                renderer.render(scene, camera);
                await renderer.waitForIdle();
                expect(await factory.readDiagnostics()).toMatchObject({
                    objectCount: 0,
                    fallbackObjectCount: 12
                });
                for (const mesh of meshes) mesh.material = material;
                renderer.render(scene, camera);
                await renderer.waitForIdle();
                expect(await factory.readDiagnostics()).toMatchObject({
                    objectCount: 8,
                    fallbackObjectCount: 4
                });

                const removedMesh = meshes[0];
                if (removedMesh === undefined) throw new Error('Expected a removable GPU mesh');
                removedMesh.removeFromParent();
                renderer.render(scene, camera);
                await renderer.waitForIdle();
                expect(await factory.readDiagnostics()).toMatchObject({
                    objectCount: 7,
                    fallbackObjectCount: 4
                });
                renderer.render(scene, camera);
                await renderer.waitForIdle();
                expect(await factory.readDiagnostics()).toMatchObject({
                    objectCount: 8,
                    fallbackObjectCount: 3
                });
                removedMesh.addTo(scene);

                const originalVertices = geometry.vertices;
                if (originalVertices === null) throw new Error('Expected box vertex data');
                geometry.vertices = new GeometryData(
                    originalVertices.data.slice(),
                    originalVertices.size,
                    {
                        normalized: originalVertices.normalized,
                        stride: originalVertices.stride,
                        offset: originalVertices.offset
                    }
                );
                renderer.render(scene, camera);
                await renderer.waitForIdle();
                expect(await factory.readDiagnostics()).toMatchObject({
                    objectCount: 0,
                    fallbackObjectCount: 12
                });
                geometry.vertices = originalVertices;
                renderer.render(scene, camera);
                await renderer.waitForIdle();
                expect(await factory.readDiagnostics()).toMatchObject({
                    objectCount: 8,
                    fallbackObjectCount: 4
                });

                new Mesh({
                    geometry: new BoxGeometry(),
                    material: new BasicMaterial({ lightType: 'NONE' }),
                    x: 2.5
                }).addTo(scene);
                new Mesh({
                    geometry: new BoxGeometry(),
                    material: new PBRMaterial({ transmissionFactor: 0.35 }),
                    x: -2.5
                }).addTo(scene);
                renderer.render(scene, camera);
                await renderer.waitForIdle();
                expect(await factory.readDiagnostics()).toMatchObject({
                    objectCount: 8,
                    fallbackObjectCount: 6
                });
            } finally {
                renderer.destroy();
                unregisterRendererDiagnostics(canvas, rendererDiagnostics);
            }
        },
        30_000
    );

    it.skipIf(__HILO3D_GITHUB_ACTIONS_COVERAGE__)(
        'keeps directional lights global and routes AreaLight through exact Forward fallback',
        async () => {
            const geometry = new BoxGeometry();
            const material = new PBRMaterial();
            const factory = new ClusteredForwardPlusPipelineFactory({
                buckets: [{ geometry, material }],
                maxObjects: 1,
                maxLights: 8,
                maxLightIndices: 1,
                maxLightsPerCluster: 1,
                maxViewportWidth: 32,
                maxViewportHeight: 32,
                hiZ: false,
                bloomStrength: 0
            });
            const renderer = await Renderer.create({
                backend: 'webgpu',
                domElement: document.createElement('canvas'),
                width: 32,
                height: 32,
                antialias: false,
                renderingProfile: 'high-end',
                renderPipeline: factory
            });
            try {
                const scene = new Node();
                new Mesh({ geometry, material }).addTo(scene);
                let firstDirectional: DirectionalLight | null = null;
                for (let index = 0; index < 8; index += 1) {
                    const light = new DirectionalLight({ amount: 0.25 }).addTo(scene);
                    firstDirectional ??= light;
                }
                const camera = new PerspectiveCamera({ aspect: 1, near: 0.1, far: 20 });
                camera.setPosition(0, 0, 6).lookAt(new Vector3(0, 0, 0));

                renderer.render(scene, camera);
                await renderer.waitForIdle();
                expect(await factory.readDiagnostics()).toMatchObject({
                    objectCount: 1,
                    fallbackObjectCount: 0,
                    lightCount: 8,
                    clusterLightIndexCount: 0,
                    clusterOverflowCount: 0
                });

                if (firstDirectional === null) throw new Error('Expected a directional light');
                firstDirectional.shadow = {};
                renderer.render(scene, camera);
                await renderer.waitForIdle();
                expect(await factory.readDiagnostics()).toMatchObject({
                    objectCount: 0,
                    fallbackObjectCount: 1,
                    clusterLightIndexCount: 0
                });
                firstDirectional.shadow = null;

                new AreaLight({ amount: 1, z: 2 }).addTo(scene);
                renderer.render(scene, camera);
                await renderer.waitForIdle();
                expect(await factory.readDiagnostics()).toMatchObject({
                    objectCount: 0,
                    fallbackObjectCount: 1,
                    lightCount: 8,
                    clusterLightIndexCount: 0,
                    clusterOverflowCount: 0
                });
                expect(renderer.renderInfo.drawCount).toBeGreaterThan(0);
            } finally {
                renderer.destroy();
            }
        },
        20_000
    );

    it.skipIf(__HILO3D_GITHUB_ACTIONS_COVERAGE__)(
        'bounds cluster allocation overflow deterministically on real WebGPU',
        async () => {
            const geometry = new BoxGeometry();
            const material = new PBRMaterial();
            const factory = new ClusteredForwardPlusPipelineFactory({
                buckets: [{ geometry, material }],
                maxObjects: 1,
                maxLights: 8,
                maxLightIndices: 1,
                maxLightsPerCluster: 1,
                tileSize: 16,
                zSlices: 8,
                maxViewportWidth: 32,
                maxViewportHeight: 32,
                hiZ: false
            });
            const renderer = await Renderer.create({
                backend: 'webgpu',
                domElement: document.createElement('canvas'),
                width: 32,
                height: 32,
                antialias: false,
                renderingProfile: 'high-end',
                renderPipeline: factory
            });
            try {
                const scene = new Node();
                new Mesh({ geometry, material }).addTo(scene);
                for (let index = 0; index < 8; index += 1) {
                    new PointLight({ amount: 1, range: 20, z: 2 }).addTo(scene);
                }
                const camera = new PerspectiveCamera({ aspect: 1, near: 0.1, far: 20 });
                camera.setPosition(0, 0, 6).lookAt(new Vector3(0, 0, 0));

                renderer.render(scene, camera);
                await renderer.waitForIdle();
                const diagnostics = await factory.readDiagnostics();

                expect(diagnostics.clusterLightIndexCount).toBeLessThanOrEqual(1);
                expect(diagnostics.clusterOverflowCount).toBeGreaterThan(0);
            } finally {
                renderer.destroy();
            }
        }
    );
});
