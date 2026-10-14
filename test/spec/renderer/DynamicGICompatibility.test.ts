import { describe, expect, it, vi } from 'vitest';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import Mesh from '../../../src/core/Mesh';
import Node from '../../../src/core/Node';
import BoxGeometry from '../../../src/geometry/BoxGeometry';
import AmbientLight from '../../../src/light/AmbientLight';
import PBRMaterial from '../../../src/material/PBRMaterial';
import Color from '../../../src/math/Color';
import Vector3 from '../../../src/math/Vector3';
import Renderer from '../../../src/render/Renderer';
import { RayTracingScene } from '../../../src/render/gi/RayTracingScene';
import type StorageGraphicsShader from '../../../src/render/compute/StorageGraphicsShader';
import {
    ClusteredForwardPlusPipelineFactory,
    type ClusteredForwardPlusPipelineOptions
} from '../../../src/render/pipeline/ClusteredForwardPlus';
import type { RenderPipelineCreateContext } from '../../../src/render/pipeline/RenderPipeline';
import type { RHIDevice } from '../../../src/render/rhi/core';

function smallOptions(): ClusteredForwardPlusPipelineOptions {
    return {
        buckets: [{ geometry: new BoxGeometry(), material: new PBRMaterial({ metallic: 0 }) }],
        maxObjects: 4,
        maxLights: 4,
        maxLightIndices: 64,
        maxLightsPerCluster: 4,
        maxViewportWidth: 16,
        maxViewportHeight: 16,
        hiZ: false,
        bloomStrength: 0,
        dynamicGlobalIllumination: {
            origin: new Vector3(100, 100, 100),
            probeCounts: [2, 2, 2],
            maxProbesPerFrame: 8,
            raysPerProbe: 64,
            maxTriangles: 64,
            maxLights: 4,
            environment: new Color(0, 0, 0)
        }
    };
}

async function createRenderer(
    factory: ClusteredForwardPlusPipelineFactory,
    useInstanced = false
): Promise<Renderer> {
    const renderer = await Renderer.create({
        backend: 'webgpu',
        domElement: document.createElement('canvas'),
        width: 16,
        height: 16,
        antialias: false,
        renderPipeline: factory,
        useInstanced
    });
    renderer.clearColor = new Color(0, 0, 0);
    return renderer;
}

function rhiDevice(renderer: Renderer): RHIDevice {
    const extension = renderer.getExtension('rhi') as { readonly device: RHIDevice } | null;
    if (extension === null) throw new Error('Expected public RHI extension');
    return extension.device;
}

function target(renderer: Renderer): ReturnType<Renderer['createRenderTarget']> {
    return renderer.createRenderTarget({
        width: 16,
        height: 16,
        colorAttachments: [{ format: 'rgba8unorm' }],
        depthStencilAttachment: { format: 'depth32float' }
    });
}

describe('Dynamic GI compatibility boundaries', () => {
    it('reports unlit PBR as unsupported transport geometry', () => {
        const mesh = new Mesh({
            geometry: new BoxGeometry(),
            material: new PBRMaterial({ unlit: true })
        });
        expect(new RayTracingScene().update(mesh).diagnostics).toMatchObject({
            triangleCount: 0,
            excludedMeshCount: 1,
            exclusions: { material: 1 }
        });
        expect(() => new RayTracingScene({ unsupported: 'error' }).update(mesh)).toThrow(
            /unsupported: material/
        );
    });
    it('requires temporal inputs for GTAO before creating the renderer', () => {
        expect(
            () =>
                new ClusteredForwardPlusPipelineFactory({
                    ...smallOptions(),
                    groundTruthAmbientOcclusion: {}
                })
        ).toThrow(/requires temporalAA/);
    });

    it.each([false, true])(
        'submits unregistered DDGI and GTAO receivers exactly once, then migrates them into GPU buckets (instanced=%s)',
        async useInstanced => {
            const options = smallOptions();
            const factory = new ClusteredForwardPlusPipelineFactory({
                ...options,
                temporalAA: { historyWeight: 0 },
                groundTruthAmbientOcclusion: {
                    resolutionScale: 0.5,
                    directionCount: 4,
                    stepCount: 3
                },
                dynamicGlobalIllumination: {
                    ...options.dynamicGlobalIllumination,
                    maxMeshes: 4,
                    maxTextureTexels: 1,
                    origin: new Vector3(-1, -1, -1),
                    spacing: new Vector3(2, 2, 2),
                    environment: new Color(1, 0.05, 0.01),
                    hysteresis: 0,
                    bounceStrength: 0,
                    relocation: false
                }
            });
            const renderer = await createRenderer(factory, useInstanced);
            const output = target(renderer);
            const scene = new Node();
            const receiver = new Mesh({
                geometry: new BoxGeometry(),
                material: new PBRMaterial({ metallic: 0 }),
                frustumTest: false,
                useInstanced
            }).addTo(scene);
            const camera = new PerspectiveCamera({ aspect: 1, z: 3 });
            const queue = rhiDevice(renderer).graphicsQueue;
            const originalBeginFrame = queue.beginFrame.bind(queue);
            const recordedDraws: Map<string, { calls: number; instances: number }>[] = [];
            const beginFrame = vi.spyOn(queue, 'beginFrame').mockImplementation(descriptor => {
                const commands = originalBeginFrame(descriptor);
                const counts = new Map<string, { calls: number; instances: number }>();
                recordedDraws.push(counts);
                const originalBeginPass = commands.beginRenderPass.bind(commands);
                vi.spyOn(commands, 'beginRenderPass').mockImplementation(passDescriptor => {
                    const pass = originalBeginPass(passDescriptor);
                    const originalDraw = pass.drawIndexedRecord.bind(pass);
                    vi.spyOn(pass, 'drawIndexedRecord').mockImplementation(draw => {
                        const label = passDescriptor.label ?? '';
                        const count = counts.get(label) ?? { calls: 0, instances: 0 };
                        count.calls++;
                        count.instances += draw.instanceCount;
                        counts.set(label, count);
                        originalDraw(draw);
                    });
                    return pass;
                });
                return commands;
            });
            try {
                renderer.renderToTarget(output, scene, camera);
                const directDraws = recordedDraws.at(-1);
                expect(beginFrame).toHaveBeenCalledOnce();
                expect(directDraws?.get('GPU Scene deformed and layered clustered PBR')).toEqual({
                    calls: 1,
                    instances: 1
                });
                expect(
                    directDraws?.get('Clustered Forward+ compatibility fallback')
                ).toBeUndefined();
                await renderer.waitForIdle();
                const direct = await factory.readDiagnostics();
                expect(direct).toMatchObject({
                    objectCount: 0,
                    fallbackObjectCount: 0,
                    clusteredDeformedObjectCount: 1
                });
                expect(direct.dynamicGlobalIllumination).toMatchObject({
                    submittedFrameCount: 1,
                    updatedProbeCount: 8,
                    tracedRayCount: 512,
                    sceneTriangleCount: 12,
                    excludedMeshCount: 0
                });
                const directPixels = (await output.readColorAttachment()).data;
                const totals = [0, 0, 0];
                for (let index = 0; index < directPixels.length; index++) {
                    const channel = index % 4;
                    if (channel < 3)
                        totals[channel] = (totals[channel] ?? 0) + (directPixels[index] ?? 0);
                }
                // With no direct or ambient lights, the colored probe environment is the source.
                expect(totals[0]).toBeGreaterThan(100);
                expect(totals[0]).toBeGreaterThan((totals[1] ?? 0) * 2);
                factory.setDynamicGlobalIlluminationIntensity(0);
                renderer.renderToTarget(output, scene, camera);
                await renderer.waitForIdle();
                const disabled = (await output.readColorAttachment()).data;
                expect(disabled.every((value, index) => index % 4 === 3 || value <= 1)).toBe(true);
                factory.setDynamicGlobalIlluminationIntensity(1);
                const bucket = options.buckets[0];
                if (!bucket) throw new Error('Expected fixture bucket');
                receiver.geometry = bucket.geometry;
                receiver.material = bucket.material;
                renderer.renderToTarget(output, scene, camera);
                const bucketDraws = recordedDraws.at(-1);
                expect(
                    bucketDraws?.get('GPU Scene deformed and layered clustered PBR')
                ).toBeUndefined();
                expect(
                    bucketDraws?.get('Clustered Forward+ compatibility fallback')
                ).toBeUndefined();
                await renderer.waitForIdle();
                const registered = await factory.readDiagnostics();
                expect(registered).toMatchObject({
                    objectCount: 1,
                    visibleObjectCount: 1,
                    fallbackObjectCount: 0,
                    clusteredDeformedObjectCount: 0
                });
                expect(registered.dynamicGlobalIllumination).toMatchObject({
                    submittedFrameCount: 3,
                    sceneTriangleCount: 12,
                    excludedMeshCount: 0
                });
                expect(
                    (await output.readColorAttachment()).data.some(
                        (value, index) => index % 4 !== 3 && value > 32
                    )
                ).toBe(true);
            } finally {
                beginFrame.mockRestore();
                output.destroy();
                renderer.destroy();
            }
        },
        30_000
    );

    it('fails closed on a direct receiver variant budget and retries without a silent Forward fallback', async () => {
        const factory = new ClusteredForwardPlusPipelineFactory({
            ...smallOptions(),
            variantManifest: { entries: [], maxVariants: 1 }
        });
        const renderer = await createRenderer(factory);
        const output = target(renderer);
        const scene = new Node();
        const first = new Mesh({
            geometry: new BoxGeometry(),
            material: new PBRMaterial({ metallic: 0 }),
            x: -0.5,
            frustumTest: false
        });
        const second = new Mesh({
            geometry: first.geometry,
            material: new PBRMaterial({ metallic: 0, clearcoatFactor: 0.5 }),
            x: 0.5,
            frustumTest: false
        });
        scene.addChild(first).addChild(second).addChild(new AmbientLight());
        const camera = new PerspectiveCamera({ aspect: 1, z: 3 });
        const beginFrame = vi.spyOn(rhiDevice(renderer).graphicsQueue, 'beginFrame');
        try {
            expect(() => {
                renderer.renderToTarget(output, scene, camera);
            }).toThrow(/Dynamic GI receiver material variant budget exhausted/);
            expect(beginFrame).not.toHaveBeenCalled();
            second.removeFromParent();
            renderer.renderToTarget(output, scene, camera);
            await renderer.waitForIdle();
            expect(beginFrame).toHaveBeenCalled();
            expect(
                (await output.readColorAttachment()).data.some(
                    (value, index) => index % 4 !== 3 && value > 32
                )
            ).toBe(true);
            const diagnostics = await factory.readDiagnostics();
            expect(diagnostics.activeMaterialVariantCount).toBe(1);
            expect(diagnostics.clusteredDeformedObjectCount).toBe(1);
        } finally {
            beginFrame.mockRestore();
            output.destroy();
            renderer.destroy();
        }
    }, 30_000);

    it.each([false, true])(
        'counts hybrid diffuse-surface variants in manifest preflight (shadowed=%s)',
        async shadowed => {
            const mesh = new Mesh({
                geometry: new BoxGeometry(),
                material: new PBRMaterial({ metallic: 0 })
            });
            const expectedCount = shadowed ? 4 : 2;
            const options: ClusteredForwardPlusPipelineOptions = {
                ...smallOptions(),
                temporalAA: {},
                screenSpaceGlobalIllumination: {},
                variantManifest: { entries: [{ mesh, shadowed }], maxVariants: expectedCount - 1 }
            };
            const warmup =
                vi.fn<
                    (shaders: readonly StorageGraphicsShader[], batchSize?: number) => Promise<void>
                >();
            const allocate = vi.fn<RenderPipelineCreateContext['createStorageBuffer']>();
            const context = {
                warmupStorageGraphicsShaders: warmup,
                createStorageBuffer: allocate
            } as unknown as RenderPipelineCreateContext;
            await expect(
                new ClusteredForwardPlusPipelineFactory(options).create(context)
            ).rejects.toThrow(/unique shaders exceed maxVariants/);
            expect(warmup).not.toHaveBeenCalled();
            expect(allocate).not.toHaveBeenCalled();

            const stopBeforeRuntime = new Error('stop after inspecting the full warmup set');
            warmup.mockRejectedValueOnce(stopBeforeRuntime);
            const exactBudget = new ClusteredForwardPlusPipelineFactory({
                ...options,
                variantManifest: {
                    entries: [{ mesh, shadowed }],
                    maxVariants: expectedCount,
                    warmupBatchSize: 1
                }
            });
            await expect(exactBudget.create(context)).rejects.toBe(stopBeforeRuntime);
            expect(warmup).toHaveBeenCalledTimes(1);
            const shaders = warmup.mock.calls[0]?.[0];
            expect(shaders).toHaveLength(expectedCount);
            expect(
                shaders?.filter(shader =>
                    shader.fragmentSource.includes('out vec4 ddgiDiffuseAlbedo')
                )
            ).toHaveLength(shadowed ? 2 : 1);
            expect(warmup.mock.calls[0]?.[1]).toBe(1);
            expect(allocate).not.toHaveBeenCalled();
        }
    );

    it.each(['registered', 'direct'] as const)(
        'preserves existing ambient illumination outside the probe volume on %s receivers',
        async lane => {
            const geometry = new BoxGeometry();
            const material = new PBRMaterial({
                metallic: 0,
                roughness: 1,
                baseColor: new Color(0.7, 0.35, 0.1)
            });
            const scene = new Node();
            scene.addChild(new Mesh({ geometry, material, frustumTest: false }));
            scene.addChild(new AmbientLight({ amount: 1, color: new Color(1, 1, 1) }));
            const camera = new PerspectiveCamera({ aspect: 1, z: 3 });
            const captured: Uint8Array[] = [];
            for (const enabled of [false, true]) {
                const options = smallOptions();
                const factory = new ClusteredForwardPlusPipelineFactory({
                    ...options,
                    buckets: lane === 'registered' ? [{ geometry, material }] : options.buckets,
                    ...(enabled ? {} : { dynamicGlobalIllumination: false })
                });
                const renderer = await createRenderer(factory);
                const output = target(renderer);
                try {
                    renderer.renderToTarget(output, scene, camera);
                    await renderer.waitForIdle();
                    captured.push((await output.readColorAttachment()).data.slice());
                } finally {
                    output.destroy();
                    renderer.destroy();
                }
            }
            const baseline = captured[0],
                withGI = captured[1];
            if (!baseline || !withGI) throw new Error('Expected both ambient readbacks');
            expect(baseline.some((value, index) => index % 4 !== 3 && value > 32)).toBe(true);
            let largestDifference = 0;
            for (let index = 0; index < baseline.length; index++)
                largestDifference = Math.max(
                    largestDifference,
                    Math.abs((baseline[index] ?? 0) - (withGI[index] ?? 0))
                );
            expect(largestDifference).toBeLessThanOrEqual(1);
        },
        30_000
    );
});
