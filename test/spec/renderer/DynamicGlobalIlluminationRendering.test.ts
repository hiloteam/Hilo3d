import { describe, expect, it } from 'vitest';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import Mesh from '../../../src/core/Mesh';
import Node from '../../../src/core/Node';
import BoxGeometry from '../../../src/geometry/BoxGeometry';
import PBRMaterial from '../../../src/material/PBRMaterial';
import Color from '../../../src/math/Color';
import Vector3 from '../../../src/math/Vector3';
import Renderer from '../../../src/render/Renderer';
import type { RHIDevice } from '../../../src/render/rhi/core';
import { ClusteredForwardPlusPipelineFactory } from '../../../src/render/pipeline/ClusteredForwardPlus';

function channelTotals(bytes: Uint8Array): readonly [number, number, number] {
    const totals: [number, number, number] = [0, 0, 0];
    for (let index = 0; index < bytes.length; index += 4) {
        totals[0] += bytes[index] ?? 0;
        totals[1] += bytes[index + 1] ?? 0;
        totals[2] += bytes[index + 2] ?? 0;
    }
    return totals;
}

describe('Dynamic global illumination production rendering', () => {
    it('requires WebGPU and validates contribution controls before work is recorded', async () => {
        const factory = new ClusteredForwardPlusPipelineFactory({
            buckets: [{ geometry: new BoxGeometry(), material: new PBRMaterial() }],
            hiZ: false,
            dynamicGlobalIllumination: { probeCounts: [3, 3, 3], maxTriangles: 128 }
        });
        expect(factory.requirements.requiredCapabilities).toContain('compute-pass');
        expect(factory.requirements.requiredCapabilities).toContain('storage-texture');
        expect(() => {
            factory.setDynamicGlobalIlluminationIntensity(Number.NaN);
        }).toThrow();
        expect(() => {
            factory.setDynamicGlobalIlluminationIntensity(-1);
        }).toThrow();
        await expect(
            Renderer.create({ backend: 'webgl2', renderPipeline: factory })
        ).rejects.toThrow();
    });

    it.each(['indirect', 'direct', 'hybrid-indirect', 'hybrid-direct'] as const)(
        'transports off-screen emission through the %s lane and responds to material changes',
        async lane => {
            const scene = new Node();
            const floorGeometry = new BoxGeometry({ width: 5, height: 0.2, depth: 5 });
            const floorMaterial = new PBRMaterial({
                baseColor: new Color(0.8, 0.8, 0.8),
                roughness: 1,
                metallic: 0
            });
            new Mesh({ geometry: floorGeometry, material: floorMaterial, y: -0.1 }).addTo(scene);
            const emitterGeometry = new BoxGeometry({ width: 0.1, height: 2.5, depth: 3 });
            const emitterMaterial = new PBRMaterial({
                baseColor: new Color(0, 0, 0),
                emissionFactor: new Color(3, 0.01, 0.01),
                metallic: 0,
                roughness: 1
            });
            new Mesh({
                geometry: emitterGeometry,
                material: emitterMaterial,
                x: -2.2,
                y: 1.3
            }).addTo(scene);
            const factory = new ClusteredForwardPlusPipelineFactory({
                buckets: [
                    ...(lane.endsWith('indirect')
                        ? [{ geometry: floorGeometry, material: floorMaterial }]
                        : []),
                    { geometry: emitterGeometry, material: emitterMaterial }
                ],
                maxObjects: 8,
                maxLights: 4,
                maxLightIndices: 64,
                maxLightsPerCluster: 4,
                maxViewportWidth: 48,
                maxViewportHeight: 48,
                hiZ: false,
                bloomStrength: 0,
                ...(lane.startsWith('hybrid')
                    ? {
                          temporalAA: {},
                          screenSpaceGlobalIllumination: {
                              rayCount: 4 as const,
                              stepCount: 6 as const,
                              denoisePasses: 1 as const
                          }
                      }
                    : {}),
                dynamicGlobalIllumination: {
                    origin: new Vector3(-1.5, 0.25, -1.5),
                    spacing: new Vector3(1, 0.75, 1),
                    probeCounts: [4, 3, 4],
                    maxProbesPerFrame: 48,
                    raysPerProbe: 128,
                    maxTriangles: 128,
                    maxRayDistance: 12,
                    hysteresis: 0.5,
                    environment: new Color(0, 0, 0),
                    bounceStrength: 0.5
                }
            });
            factory.setDynamicGlobalIlluminationIntensity(0);
            const renderer = await Renderer.create({
                domElement: document.createElement('canvas'),
                backend: 'webgpu',
                width: 48,
                height: 48,
                antialias: false,
                renderPipeline: factory
            });
            renderer.clearColor = new Color(0, 0, 0);
            const target = renderer.createRenderTarget({
                width: 48,
                height: 48,
                colorAttachments: [{ format: 'rgba8unorm' }],
                depthStencilAttachment: { format: 'depth32float' }
            });
            const camera = new PerspectiveCamera({ aspect: 1, near: 0.1, far: 12, fov: 24 });
            camera.setPosition(0, 2.5, 2.5).lookAt(new Vector3(0, 0, 0));
            const render = async (frames: number): Promise<readonly [number, number, number]> => {
                for (let frame = 0; frame < frames; frame++) {
                    renderer.renderToTarget(target, scene, camera);
                    await renderer.waitForIdle();
                }
                return channelTotals((await target.readColorAttachment()).data);
            };
            try {
                const disabled = await render(2);
                expect(disabled[0] + disabled[1] + disabled[2]).toBeLessThan(50);
                factory.setDynamicGlobalIlluminationIntensity(1);
                const red = await render(12);
                expect(red[0]).toBeGreaterThan(disabled[0] + 500);
                expect(red[0]).toBeGreaterThan(red[2] * 1.4);
                emitterMaterial.emissionFactor.set(0.01, 0.01, 3, 1);
                const blue = await render(16);
                expect(blue[2]).toBeGreaterThan(blue[0] * 1.4);
                const diagnostics = (await factory.readDiagnostics()).dynamicGlobalIllumination;
                expect(diagnostics).not.toBeNull();
                factory.setDynamicGlobalIlluminationIntensity(0);
                const offAgain = await render(1);
                expect(offAgain[2]).toBeLessThan(blue[2] * 0.1);
                if (lane === 'indirect') {
                    const extension = renderer.getExtension('rhi') as {
                        readonly device: RHIDevice;
                    } | null;
                    if (extension === null) throw new Error('RHI recovery fixture unavailable');
                    const lost = new Promise<void>(resolve => {
                        renderer.on(
                            'webgpuDeviceLost',
                            () => {
                                resolve();
                            },
                            true
                        );
                    });
                    const restored = new Promise<void>(resolve => {
                        renderer.on(
                            'webgpuDeviceRestored',
                            () => {
                                resolve();
                            },
                            true
                        );
                    });
                    extension.device.destroy();
                    await lost;
                    await Promise.all([renderer.waitForIdle(), restored]);
                    factory.setDynamicGlobalIlluminationIntensity(1);
                    const recovered = await render(12);
                    expect(recovered[2]).toBeGreaterThan(recovered[0] * 1.4);
                    expect(recovered[2]).toBeGreaterThan(blue[2] * 0.65);
                }
            } finally {
                target.destroy();
                renderer.destroy();
            }
        },
        120_000
    );
});
