import { describe, expect, it } from 'vitest';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import Mesh from '../../../src/core/Mesh';
import Node from '../../../src/core/Node';
import BoxGeometry from '../../../src/geometry/BoxGeometry';
import Geometry from '../../../src/geometry/Geometry';
import GeometryData from '../../../src/geometry/GeometryData';
import MorphGeometry from '../../../src/geometry/MorphGeometry';
import PointLight from '../../../src/light/PointLight';
import BasicMaterial from '../../../src/material/BasicMaterial';
import PBRMaterial from '../../../src/material/PBRMaterial';
import Color from '../../../src/math/Color';
import Matrix3 from '../../../src/math/Matrix3';
import Vector3 from '../../../src/math/Vector3';
import Renderer from '../../../src/render/Renderer';
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
            maxBindingsPerBindGroup: 14,
            maxStorageBuffersPerShaderStage: 7,
            maxStorageTexturesPerShaderStage: 1,
            maxSampledTexturesPerShaderStage: 7,
            maxSamplersPerShaderStage: 7,
            maxComputeInvocationsPerWorkgroup: 256
        });
        expect(
            factory.requirements.requiredLimits?.['maxComputeWorkgroupsPerDimension']
        ).toBeGreaterThan(0);
        expect(factory.requirements.requiredTextureFormats).toContainEqual({
            format: 'r32float',
            use: 'storage'
        });
    });

    it('validates bucket identities, opaque materials, and unique LOD thresholds', () => {
        const geometry = new BoxGeometry();
        const material = new PBRMaterial();
        const transparent = new PBRMaterial({ transparent: true });

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
                    buckets: [{ geometry, material: new PBRMaterial({ alphaCutoff: 0.5 }) }]
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
        'renders GPU Scene culling, indirect buckets and clustered lighting on real WebGPU',
        async () => {
            const geometry = new BoxGeometry({ widthSegments: 2 });
            const uv0 = geometry.uvs;
            if (uv0 === null) throw new Error('Expected box UV data');
            geometry.uvs1 = new GeometryData(uv0.data.slice(), 2);
            const surfaceTexture = rgbaTexture([190, 140, 90, 255], 0);
            const normalTexture = rgbaTexture([128, 128, 255, 255], 1);
            const material = new PBRMaterial({
                metallic: 0.35,
                roughness: 0.28,
                baseColorMap: surfaceTexture,
                metallicMap: surfaceTexture,
                roughnessMap: surfaceTexture,
                metallicRoughnessMap: surfaceTexture,
                occlusionMap: surfaceTexture,
                emission: surfaceTexture,
                emissionFactor: new Color(0.02, 0.01, 0.005),
                normalMap: normalTexture,
                normalMapScale: 0.75,
                uvMatrix: new Matrix3().fromRotationTranslationScale(0, 0.1, 0.05, 0.8, 0.8),
                uvMatrix1: new Matrix3().fromRotationTranslationScale(0, 0, 0, 1, 1),
                isOcclusionInMetallicRoughnessMap: true
            });
            const factory = new ClusteredForwardPlusPipelineFactory({
                buckets: [{ geometry, material }],
                maxObjects: 8,
                maxLights: 8,
                maxLightIndices: 4_096,
                maxLightsPerCluster: 8,
                maxViewportWidth: 128,
                maxViewportHeight: 128
            });
            const renderer = await Renderer.create({
                backend: 'webgpu',
                domElement: document.createElement('canvas'),
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
                expect(renderer.renderInfo.drawCount).toBeGreaterThan(0);

                material.baseColorMap = rgbaTexture([80, 160, 220, 255], 0);
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

                material.alphaCutoff = 0.5;
                renderer.render(scene, camera);
                await renderer.waitForIdle();
                expect(await factory.readDiagnostics()).toMatchObject({
                    objectCount: 0,
                    fallbackObjectCount: 12
                });
                material.alphaCutoff = 0;
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
            }
        }
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
