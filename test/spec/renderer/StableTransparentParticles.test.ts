import { WebGPUDevice } from '../../../src/render/rhi/backends/webgpu/WebGPUDevice';
import type { RHIDevice } from '../../../src/render/rhi/core';
import { describe, expect, it, vi } from 'vitest';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import Node from '../../../src/core/Node';
import Mesh from '../../../src/core/Mesh';
import BoxGeometry from '../../../src/geometry/BoxGeometry';
import PlaneGeometry from '../../../src/geometry/PlaneGeometry';
import PBRMaterial from '../../../src/material/PBRMaterial';
import Color from '../../../src/math/Color';
import Texture from '../../../src/texture/Texture';
import Renderer from '../../../src/render/Renderer';
import { NEAREST } from '../../../src/constants/webgl';
import { ForwardRenderPipelineFactory } from '../../../src/render/pipeline/ForwardRenderPipeline';
import { ClusteredForwardPlusPipelineFactory } from '../../../src/render/pipeline/ClusteredForwardPlus';
import {
    TemporalAA,
    TemporalResolveController
} from '../../../src/render/postprocessing/TemporalAA';
import { ScriptableRenderPipelineContextImpl } from '../../../src/render/internal/ScriptableRenderPipelineContext';
import {
    registerRendererDiagnostics,
    unregisterRendererDiagnostics
} from '../../../src/render/diagnostics/RendererDiagnosticsRegistry';
import ParticleSystem from '../../../addon-particle/src/ParticleSystem';
import ParticleSystemDefinition from '../../../addon-particle/src/ParticleSystemDefinition';
import { readParticleSimulationCache } from '../../../addon-particle/src/ParticleSimulationCache';

const bounds = { mode: 'manual' as const, min: [-4, -4, -4] as const, max: [4, 4, 4] as const };

function redCount(pixels: Uint8Array): number {
    let count = 0;
    for (let index = 0; index < pixels.length; index += 4) if ((pixels[index] ?? 0) > 16) count++;
    return count;
}

function difference(a: Uint8Array, b: Uint8Array): number {
    expect(a.length).toBe(b.length);
    let maximum = 0;
    for (let index = 0; index < a.length; index++)
        if (index % 4 !== 3)
            maximum = Math.max(maximum, Math.abs((a[index] ?? 0) - (b[index] ?? 0)));
    return maximum;
}

describe.each(['standard', 'reversed'] as const)('GPU particle depth %s', depthMode => {
    describe('GPU particles on the fixed post-temporal raster grid', () => {
        it.each(['forward', 'clustered'] as const)(
            '%s stabilizes frozen stateless sprites and replays opaque GPU depth without repeating simulation',
            async lane => {
                const backgroundGeometry = new PlaneGeometry({ width: 6, height: 6 });
                const black = new PBRMaterial({
                    baseColor: new Color(0, 0, 0),
                    metallic: 0,
                    roughness: 1
                });
                const scene = new Node();
                new Mesh({
                    geometry: backgroundGeometry,
                    material: black,
                    z: -2,
                    frustumTest: false
                }).addTo(scene);
                const temporal = { renderScale: 0.5, sharpness: 0 };
                const pipeline =
                    lane === 'clustered'
                        ? new ClusteredForwardPlusPipelineFactory({
                              buckets: [{ geometry: backgroundGeometry, material: black }],
                              maxObjects: 2,
                              maxLights: 1,
                              maxLightIndices: 32,
                              maxLightsPerCluster: 1,
                              maxViewportWidth: 64,
                              maxViewportHeight: 64,
                              hiZ: false,
                              bloomStrength: 0,
                              temporalAA: temporal
                          })
                        : new ForwardRenderPipelineFactory({
                              sceneColorFormat: 'rgba16float',
                              features: [new TemporalAA(temporal)]
                          });
                const canvas = document.createElement('canvas');
                const diagnostics = registerRendererDiagnostics(canvas);
                const renderer = await Renderer.create({
                    backend: 'webgpu',
                    width: 64,
                    height: 64,
                    domElement: canvas,
                    antialias: false,
                    renderPipeline: pipeline
                });
                renderer.clearColor = new Color(0, 0, 0);
                const target = renderer.createRenderTarget({
                    width: 64,
                    height: 64,
                    colorAttachments: [{ format: 'rgba8unorm' }],
                    depthStencilAttachment:
                        lane === 'clustered' ? { format: 'depth32float', depthMode } : false
                });
                const camera = new PerspectiveCamera({
                    z: 4,
                    aspect: 1,
                    near: 0.1,
                    far: 10,
                    fov: 50,
                    depthMode
                });
                const texture = new Texture({
                    width: 1,
                    height: 1,
                    image: new Uint8Array([255, 255, 255, 255]),
                    minFilter: NEAREST,
                    magFilter: NEAREST
                });
                const sprites = new ParticleSystem({
                    definition: ParticleSystemDefinition.create({
                        emitters: [
                            {
                                name: 'stable-stateless-sprites',
                                capacity: 4,
                                execution: 'stateless',
                                duration: 4,
                                bounds,
                                emission: { rateOverTime: 4 },
                                initialize: {
                                    lifetime: 2,
                                    direction: [0, 1, 0],
                                    speed: 0,
                                    size: 2.3,
                                    color: [1, 0, 0, 0.6]
                                },
                                renderers: [
                                    { type: 'sprite', blend: 'alpha', texture, depthTest: true }
                                ]
                            }
                        ]
                    }),
                    seed: 31,
                    autoPlay: false,
                    compilationEnvironment: { backend: 'webgpu' },
                    x: 0.18,
                    y: 0.07
                });
                const opaque = new ParticleSystem({
                    definition: ParticleSystemDefinition.create({
                        emitters: [
                            {
                                name: 'stable-opaque-particle',
                                capacity: 1,
                                execution: 'gpu',
                                duration: 4,
                                bounds,
                                initialize: {
                                    lifetime: 10,
                                    direction: [0, 1, 0],
                                    speed: 0,
                                    size: 1,
                                    color: [0, 0, 0, 1]
                                },
                                renderers: [
                                    {
                                        type: 'mesh',
                                        meshes: [
                                            {
                                                geometry: new BoxGeometry({
                                                    width: 0.7,
                                                    height: 2.2,
                                                    depth: 0.1
                                                })
                                            }
                                        ],
                                        coverage: 'opaque',
                                        lighting: 'unlit'
                                    }
                                ]
                            }
                        ]
                    }),
                    seed: 8,
                    autoPlay: false,
                    compilationEnvironment: { backend: 'webgpu' },
                    x: -0.35,
                    z: 0.7,
                    rotationZ: -13
                });
                // simulate() advances emitter age without changing the system playback clock. Advance
                // that clock once through update(), then pause so rendering cannot advance either age.
                sprites.addTo(scene).play();
                sprites.update(500);
                sprites.pause();
                opaque.addTo(scene).emit(1).play();
                opaque.update(500);
                opaque.pause();
                expect(sprites.hasGPUEmitters).toBe(true);
                expect(opaque.hasGPUOpaqueRenderers).toBe(true);
                const phases: number[] = [];
                const originalResolve = Reflect.get(TemporalResolveController.prototype, 'resolve');
                const phaseSpy = vi
                    .spyOn(TemporalResolveController.prototype, 'resolve')
                    .mockImplementation(function (
                        this: TemporalResolveController,
                        context,
                        frame,
                        ...inputs
                    ) {
                        phases.push(frame.state.pendingJitterIndex);
                        return originalResolve.call(this, context, frame, ...inputs);
                    });
                const cullSpy = vi.spyOn(ScriptableRenderPipelineContextImpl.prototype, 'cull');
                const passNames = (): readonly string[] =>
                    diagnostics.snapshot().renderGraph?.passes.map(pass => pass.name) ?? [];
                const device = (renderer.getExtension('rhi') as { device: RHIDevice }).device;
                const capture = async (): Promise<Uint8Array> => {
                    if (device instanceof WebGPUDevice)
                        device.nativeHandle.pushErrorScope('validation');
                    renderer.renderToTarget(target, scene, camera);
                    await renderer.waitForIdle();
                    if (device instanceof WebGPUDevice)
                        expect(
                            (await device.nativeHandle.popErrorScope())?.message
                        ).toBeUndefined();
                    expect(sprites.elapsedSeconds).toBe(0.5);
                    expect(opaque.elapsedSeconds).toBe(0.5);
                    const emitter = readParticleSimulationCache(sprites.captureSimulation())
                        ?.emitters[0];
                    expect(emitter?.runtimeKind).toBe('stateless-gpu');
                    expect(emitter?.statelessAge).toBe(0.5);
                    return (await target.readColorAttachment()).data.slice();
                };
                try {
                    const reference = await capture();
                    expect(redCount(reference)).toBeGreaterThan(64);
                    expect(
                        passNames().filter(name => name === 'stable-opaque-particle:simulate')
                    ).toHaveLength(1);
                    expect(
                        passNames().filter(name => name.startsWith('stable-opaque-particle:mesh-'))
                            .length
                    ).toBeGreaterThanOrEqual(2);
                    for (let frame = 1; frame < 8; frame++) {
                        expect(difference(await capture(), reference)).toBeLessThanOrEqual(1);
                        expect(passNames()).not.toContain('stable-opaque-particle:simulate');
                        expect(opaque.hasPendingGPUWork).toBe(false);
                    }
                    expect(phases).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
                    if (lane === 'clustered') expect(cullSpy).not.toHaveBeenCalled();
                    opaque.visible = false;
                    const unobstructed = await capture();
                    expect(redCount(unobstructed) - redCount(reference)).toBeGreaterThan(48);
                    opaque.visible = true;
                    expect(difference(await capture(), reference)).toBeLessThanOrEqual(1);
                    sprites.visible = false;
                    const removed = await capture();
                    for (let index = 0; index < removed.length; index++)
                        if (index % 4 !== 3) expect(removed[index]).toBeLessThanOrEqual(1);
                } finally {
                    cullSpy.mockRestore();
                    phaseSpy.mockRestore();
                    sprites.destroy(renderer);
                    opaque.destroy(renderer);
                    texture.destroy();
                    target.destroy();
                    renderer.destroy();
                    unregisterRendererDiagnostics(canvas, diagnostics);
                }
            },
            60_000
        );
    });
});
