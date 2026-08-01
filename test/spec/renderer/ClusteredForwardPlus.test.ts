import { describe, expect, it } from 'vitest';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import Mesh from '../../../src/core/Mesh';
import Node from '../../../src/core/Node';
import BoxGeometry from '../../../src/geometry/BoxGeometry';
import PointLight from '../../../src/light/PointLight';
import PBRMaterial from '../../../src/material/PBRMaterial';
import Vector3 from '../../../src/math/Vector3';
import Renderer from '../../../src/render/Renderer';
import { ClusteredForwardPlusPipelineFactory } from '../../../src/render/pipeline/ClusteredForwardPlus';

declare const __HILO3D_GITHUB_ACTIONS_COVERAGE__: boolean;

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
            maxStorageBuffersPerShaderStage: 7,
            maxStorageTexturesPerShaderStage: 1,
            maxComputeInvocationsPerWorkgroup: 256
        });
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
        ).toThrow(/opaque PBR buckets/u);
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
    });

    it.skipIf(__HILO3D_GITHUB_ACTIONS_COVERAGE__)(
        'renders GPU Scene culling, indirect buckets and clustered lighting on real WebGPU',
        async () => {
            const geometry = new BoxGeometry();
            const material = new PBRMaterial({ metallic: 0.35, roughness: 0.28 });
            const factory = new ClusteredForwardPlusPipelineFactory({
                buckets: [{ geometry, material }],
                maxObjects: 32,
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
                for (let index = 0; index < 12; index += 1) {
                    new Mesh({
                        geometry,
                        material,
                        x: ((index % 4) - 1.5) * 0.85,
                        y: (Math.floor(index / 4) - 1) * 0.85,
                        z: 0
                    }).addTo(scene);
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

                expect(diagnostics.objectCount).toBe(12);
                expect(diagnostics.lightCount).toBe(4);
                expect(diagnostics.visibleObjectCount).toBeGreaterThan(0);
                expect(diagnostics.clusterLightIndexCount).toBeGreaterThan(0);
                expect(diagnostics.clusterOverflowCount).toBe(0);
                expect(diagnostics.hiZValid).toBe(true);
                expect(renderer.renderInfo.drawCount).toBeGreaterThan(0);
            } finally {
                renderer.destroy();
            }
        }
    );
});
