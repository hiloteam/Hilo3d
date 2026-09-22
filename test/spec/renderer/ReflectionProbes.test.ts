import { describe, expect, it, vi } from 'vitest';
import {
    ReflectionProbe,
    reflectionProbeState
} from '../../../src/render/reflections/ReflectionProbe';
import { ReflectionProbePipelineFactory } from '../../../src/render/reflections/ReflectionProbePipeline';
import { ReflectionProbeMaterialBinding } from '../../../src/render/reflections/ReflectionProbeMaterialBinding';
import { ForwardRenderPipelineFactory } from '../../../src/render/pipeline/ForwardRenderPipeline';
import { ClusteredForwardPlusPipelineFactory } from '../../../src/render/pipeline/ClusteredForwardPlus';
import type { RenderPipelineFactory } from '../../../src/render/pipeline/RenderPipeline';
import Renderer from '../../../src/render/Renderer';
import Node from '../../../src/core/Node';
import Mesh from '../../../src/core/Mesh';
import PlaneGeometry from '../../../src/geometry/PlaneGeometry';
import BoxGeometry from '../../../src/geometry/BoxGeometry';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import PBRMaterial from '../../../src/material/PBRMaterial';
import DirectionalLight from '../../../src/light/DirectionalLight';
import BasicMaterial from '../../../src/material/BasicMaterial';
import Color from '../../../src/math/Color';
import Vector3 from '../../../src/math/Vector3';
import CubeTexture from '../../../src/texture/CubeTexture';
import { RGBA, UNSIGNED_BYTE, LINEAR_MIPMAP_LINEAR, LINEAR } from '../../../src/constants/webgl';
import { RGBA8 } from '../../../src/constants/webgl2';

function volume(texture?: CubeTexture): ReflectionProbe {
    return new ReflectionProbe({
        position: new Vector3(0, 0, 1),
        boxMin: new Vector3(-5, -5, -5),
        boxMax: new Vector3(5, 5, 5),
        ...(texture === undefined ? {} : { texture })
    });
}

function cube(color: readonly [number, number, number]): CubeTexture {
    return new CubeTexture({
        image: Array.from({ length: 6 }, () => new Uint8Array([...color, 255])),
        width: 1,
        height: 1,
        internalFormat: RGBA8,
        format: RGBA,
        type: UNSIGNED_BYTE
    });
}

function scene(probe: ReflectionProbe): { root: Node; camera: PerspectiveCamera; receiver: Mesh } {
    const root = new Node();
    const camera = new PerspectiveCamera({ z: 3, near: 0.1, far: 50, aspect: 1 });
    const receiver = new Mesh({
        geometry: new PlaneGeometry({ width: 2, height: 2 }),
        material: new PBRMaterial({
            reflectionProbes: [probe],
            baseColor: new Color(1, 1, 1),
            metallic: 1,
            roughness: 0.1
        })
    });
    root.addChild(receiver);
    return { root, camera, receiver };
}

describe('Local reflection probes', () => {
    it('validates finite volumes, bounded membership and explicit capture budgets', () => {
        expect(
            () =>
                new ReflectionProbe({
                    position: new Vector3(5, 0, 0),
                    boxMin: new Vector3(-5, -5, -5),
                    boxMax: new Vector3(5, 5, 5)
                })
        ).toThrow(/strictly inside/);
        const probe = volume();
        expect(() => new PBRMaterial({ reflectionProbes: [probe, probe] })).toThrow(/distinct/);
        expect(() => new PBRMaterial({ reflectionProbes: [] })).toThrow(/one or two/);
        expect(
            () => new ReflectionProbePipelineFactory({ probes: [probe], resolution: 17 })
        ).toThrow(/power of two/);
        expect(
            () => new ReflectionProbePipelineFactory({ probes: [probe], maxResidentBytes: 1 })
        ).toThrow(/exceeding/);
        expect(() => {
            probe.intensity = NaN;
        }).toThrow(/finite/);
        expect(() => {
            volume(cube([255, 0, 0])).requestUpdate();
        }).toThrow(/dynamic/);
    });

    it('copies authored bounds and updates only changed material block bytes', () => {
        const position = new Vector3(0, 0, 0);
        const probe = new ReflectionProbe({
            position,
            boxMin: new Vector3(-1, -1, -1),
            boxMax: new Vector3(1, 1, 1),
            texture: cube([255, 0, 0])
        });
        position.x = 100;
        expect(probe.position[0]).toBe(0);
        const binding = new ReflectionProbeMaterialBinding([probe]);
        const buffer = binding.buffer;
        const revision = buffer.revision;
        expect(binding.buffer.revision).toBe(revision);
        probe.intensity = 0.5;
        expect(binding.buffer).toBe(buffer);
        expect(buffer.revision).toBeGreaterThan(revision);
    });

    for (const backend of ['webgl2', 'webgpu'] as const) {
        it(`keeps asymmetric offscreen capture rows and roughness bands oriented on ${backend}`, async () => {
            const probe = new ReflectionProbe({
                position: new Vector3(),
                boxMin: new Vector3(-4, -4, -4),
                boxMax: new Vector3(4, 4, 4)
            });
            const { root, camera, receiver } = scene(probe);
            new DirectionalLight({
                direction: new Vector3(0, -1, 0),
                amount: 0.1,
                shadow: { width: 32, height: 32, cascadeCount: 2 }
            }).addTo(root);
            for (const [y, color] of [
                [2, new Color(0.8, 0, 0)],
                [-2, new Color(0, 0, 0.8)]
            ] as const) {
                new Mesh({
                    y,
                    z: 4,
                    geometry: new PlaneGeometry({ width: 8, height: 4 }),
                    material: new BasicMaterial({
                        lightType: 'NONE',
                        diffuse: color,
                        cullMode: 'none'
                    })
                }).addTo(root);
            }
            const factory = new ReflectionProbePipelineFactory({
                probes: [probe],
                resolution: 16,
                roughnessLevels: 3,
                filterSamples: 64,
                facesPerFrame: 6,
                filterLevelsPerFrame: 3
            });
            const renderer = await Renderer.create({
                backend,
                domElement: document.createElement('canvas'),
                width: 16,
                height: 16,
                antialias: false,
                renderPipeline: factory
            });
            const output = renderer.createRenderTarget({ width: 16, height: 16 });
            const material = receiver.material;
            if (!(material instanceof PBRMaterial)) throw new Error('Expected PBR receiver');
            const sample = async (y: number): Promise<Uint8Array> => {
                camera.y = receiver.y = y;
                renderer.renderToTarget(output, root, camera);
                return (await output.readColorAttachment({ x: 8, y: 8, width: 1, height: 1 })).data;
            };
            try {
                renderer.renderToTarget(output, root, camera);
                expect(probe.getDiagnostics().ready).toBe(true);
                const upper = await sample(1.5);
                const lower = await sample(-1.5);
                expect(upper[0]).toBeGreaterThan(150);
                expect(upper[2]).toBeLessThan(10);
                expect(lower[2]).toBeGreaterThan(150);
                expect(lower[0]).toBeLessThan(10);
                material.roughness = 1;
                const blurred = await sample(1.5);
                expect(blurred[2]).toBeGreaterThan(10);
                expect(blurred[0]).toBeLessThan(upper[0] ?? 0);
            } finally {
                output.destroy();
                renderer.destroy();
            }
        }, 60_000);
        it(`blends overlapping volumes, selects roughness mips and corrects parallax on ${backend}`, async () => {
            const red = cube([230, 0, 0]);
            const blue = cube([0, 0, 230]);
            const left = new ReflectionProbe({
                position: new Vector3(-1, 0, 0),
                boxMin: new Vector3(-3, -3, -3),
                boxMax: new Vector3(1, 3, 3),
                blendDistance: 1,
                texture: red
            });
            const right = new ReflectionProbe({
                position: new Vector3(1, 0, 0),
                boxMin: new Vector3(-1, -3, -3),
                boxMax: new Vector3(3, 3, 3),
                blendDistance: 1,
                texture: blue
            });
            const { root, camera, receiver } = scene(left);
            receiver.material = new PBRMaterial({
                reflectionProbes: [left, right],
                metallic: 1,
                roughness: 0.01
            });
            const renderer = await Renderer.create({
                backend,
                domElement: document.createElement('canvas'),
                width: 32,
                height: 32,
                antialias: false
            });
            const output = renderer.createRenderTarget({ width: 32, height: 32 });
            const sample = async (): Promise<Uint8Array> => {
                renderer.renderToTarget(output, root, camera);
                return (await output.readColorAttachment({ x: 16, y: 16, width: 1, height: 1 }))
                    .data;
            };
            try {
                const overlap = await sample();
                expect(overlap[0]).toBeGreaterThan(80);
                expect(overlap[0]).toBeLessThan(140);
                expect(Math.abs((overlap[0] ?? 0) - (overlap[2] ?? 0))).toBeLessThan(5);
                camera.x = receiver.x = 1.75;
                const outside = await sample();
                expect(outside[0]).toBeLessThan(3);
                expect(outside[2]).toBeGreaterThan(200);

                const mipColors = [
                    [230, 0, 0, 255],
                    [0, 230, 0, 255],
                    [0, 0, 230, 255]
                ] as const;
                const mipmap = new CubeTexture({
                    width: 4,
                    height: 4,
                    format: RGBA,
                    internalFormat: RGBA8,
                    type: UNSIGNED_BYTE,
                    minFilter: LINEAR_MIPMAP_LINEAR,
                    mipmaps: mipColors.flatMap((value, level) =>
                        Array.from({ length: 6 }, (_, face) => {
                            const width = 4 >> level;
                            return {
                                width,
                                height: width,
                                face: face as 0 | 1 | 2 | 3 | 4 | 5,
                                data: new Uint8Array(
                                    Array.from({ length: width * width }, () => [...value]).flat()
                                )
                            };
                        })
                    )
                });
                const material = new PBRMaterial({
                    reflectionProbes: [volume(mipmap)],
                    metallic: 1,
                    roughness: 0
                });
                receiver.material = material;
                mipmap.minFilter = LINEAR;
                material.roughness = 1;
                const baseLevelOnly = await sample();
                expect(baseLevelOnly[0]).toBeGreaterThan(100);
                expect(baseLevelOnly[2]).toBeLessThan(5);
                mipmap.minFilter = LINEAR_MIPMAP_LINEAR;
                for (const [roughness, channel] of [
                    [0, 0],
                    [0.5, 1],
                    [1, 2]
                ] as const) {
                    material.roughness = roughness;
                    const pixel = await sample();
                    expect(pixel[channel]).toBeGreaterThan(100);
                    if (roughness === 0) {
                        // The shared PBR surface clamps perceptual roughness to 0.045; trilinear
                        // sampling consequently blends 9% of mip one into this two-level range.
                        expect((pixel[1] ?? 0) / ((pixel[0] ?? 0) + (pixel[1] ?? 0))).toBeCloseTo(
                            0.09,
                            2
                        );
                    } else expect(pixel[(channel + 1) % 3]).toBeLessThan(5);
                }

                const directional = new CubeTexture({
                    width: 16,
                    height: 16,
                    format: RGBA,
                    internalFormat: RGBA8,
                    type: UNSIGNED_BYTE,
                    image: Array.from(
                        { length: 6 },
                        () =>
                            new Uint8Array(
                                Array.from({ length: 256 }, () => [0, 200, 0, 255]).flat()
                            )
                    )
                });
                const faces = directional.image;
                if (faces === null) throw new Error('Missing cubemap faces');
                faces[0] = new Uint8Array(
                    Array.from({ length: 256 }, () => [230, 0, 0, 255]).flat()
                );
                directional.needUpdate = true;
                const displaced = new ReflectionProbe({
                    position: new Vector3(-2, 0, 0),
                    boxMin: new Vector3(-4, -4, -4),
                    boxMax: new Vector3(4, 4, 4),
                    texture: directional
                });
                receiver.material = new PBRMaterial({
                    reflectionProbes: [displaced],
                    metallic: 1,
                    roughness: 0
                });
                camera.x = receiver.x = 3;
                const corrected = await sample();
                expect(corrected[0]).toBeGreaterThan(150);
                expect(corrected[1]).toBeLessThan(5);
            } finally {
                output.destroy();
                renderer.destroy();
            }
        }, 60_000);
        it(`renders static probe radiance and disables it without residual energy on ${backend}`, async () => {
            const probe = volume(cube([220, 20, 5]));
            const { root, camera } = scene(probe);
            const renderer = await Renderer.create({
                backend,
                domElement: document.createElement('canvas'),
                width: 16,
                height: 16,
                antialias: false
            });
            const output = renderer.createRenderTarget({ width: 16, height: 16 });
            try {
                renderer.renderToTarget(output, root, camera);
                const lit = (await output.readColorAttachment({ x: 8, y: 8, width: 1, height: 1 }))
                    .data;
                expect(lit[0]).toBeGreaterThan(80);
                expect(lit[0]).toBeGreaterThan((lit[1] ?? 0) * 3);
                probe.intensity = 0;
                renderer.renderToTarget(output, root, camera);
                const dark = (await output.readColorAttachment({ x: 8, y: 8, width: 1, height: 1 }))
                    .data;
                expect(dark[0]).toBeLessThan(3);
            } finally {
                output.destroy();
                renderer.destroy();
            }
        }, 60_000);

        it(`publishes complete captures atomically, retries discarded work and rebuilds released resources on ${backend}`, async () => {
            const gpuErrors: string[] = [];
            let nativeDevice: GPUDevice | null = null;
            if (backend === 'webgpu') {
                const original = Reflect.get(GPUAdapter.prototype, 'requestDevice');
                vi.spyOn(GPUAdapter.prototype, 'requestDevice').mockImplementation(async function (
                    this: GPUAdapter,
                    descriptor?: GPUDeviceDescriptor
                ) {
                    const device = await original.call(this, descriptor);
                    nativeDevice = device;
                    device.addEventListener('uncapturederror', event =>
                        gpuErrors.push(event.error.message)
                    );
                    return device;
                });
            }
            const probe = volume();
            const { root, camera } = scene(probe);
            const roomColor = new Color(0.8, 0.02, 0.01);
            root.addChild(
                new Mesh({
                    geometry: new BoxGeometry({ width: 8, height: 8, depth: 8 }),
                    material: new BasicMaterial({
                        lightType: 'NONE',
                        diffuse: roomColor,
                        cullMode: 'front'
                    })
                })
            );
            let fail = false;
            const forward = new ForwardRenderPipelineFactory();
            const wrapped: RenderPipelineFactory = {
                name: 'capture rollback test',
                create(context) {
                    const runtime = forward.create(context);
                    return {
                        name: 'capture rollback test',
                        record(frame) {
                            runtime.record(frame);
                            if (fail) throw new Error('injected capture discard');
                        },
                        frameSubmitted(index) {
                            runtime.frameSubmitted?.(index);
                        },
                        frameDiscarded(index) {
                            runtime.frameDiscarded?.(index);
                        },
                        destroy() {
                            runtime.destroy();
                        }
                    };
                }
            };
            const factory = new ReflectionProbePipelineFactory({
                probes: [probe],
                pipeline: wrapped,
                resolution: 16,
                roughnessLevels: 2,
                filterSamples: 32,
                facesPerFrame: 2
            });
            const renderer = await Renderer.create({
                backend,
                domElement: document.createElement('canvas'),
                width: 16,
                height: 16,
                antialias: false,
                renderPipeline: factory
            });
            let output = renderer.createRenderTarget({ width: 16, height: 16 });
            const draw = (): void => {
                renderer.renderToTarget(output, root, camera);
            };
            const pixel = async (): Promise<Uint8Array> =>
                (await output.readColorAttachment({ x: 8, y: 8, width: 1, height: 1 })).data;
            try {
                draw();
                draw();
                draw();
                expect(probe.getDiagnostics().ready).toBe(false);
                fail = true;
                expect(draw).toThrow(/injected capture discard/);
                expect(probe.getDiagnostics().ready).toBe(false);
                fail = false;
                draw();
                expect(probe.getDiagnostics().captures).toBe(1);
                draw();
                const red = await pixel();

                expect(red[0]).toBeGreaterThan(80);
                expect(red[0]).toBeGreaterThan((red[1] ?? 0) * 3);
                const published = reflectionProbeState(probe).texture;
                roomColor.r = 0.01;
                roomColor.g = 0.8;
                probe.requestUpdate();
                draw();
                draw();
                draw();
                expect(reflectionProbeState(probe).texture).toBe(published);
                expect((await pixel())[0]).toBeGreaterThan(80);
                draw();
                draw();
                expect(probe.getDiagnostics().captures).toBe(2);
                const green = await pixel();
                expect(green[1]).toBeGreaterThan(80);
                expect(green[1]).toBeGreaterThan((green[0] ?? 0) * 3);
                await renderer.waitForIdle();
                renderer.releaseGPUResources();
                output = renderer.createRenderTarget({ width: 16, height: 16 });
                draw();
                expect(probe.getDiagnostics().ready).toBe(false);
                draw();
                draw();
                draw();
                draw();
                expect(probe.getDiagnostics().ready).toBe(true);
                expect((await pixel())[1]).toBeGreaterThan(80);
                if (backend === 'webgpu') {
                    const restored = new Promise<void>(resolve => {
                        renderer.on(
                            'webgpuDeviceRestored',
                            () => {
                                resolve();
                            },
                            true
                        );
                    });
                    const device = nativeDevice as GPUDevice | null;
                    if (device === null) throw new Error('Missing test device');
                    device.destroy();
                    await restored;
                    draw();
                    expect(probe.getDiagnostics().ready).toBe(false);
                    draw();
                    draw();
                    draw();
                    draw();
                    expect((await pixel())[1]).toBeGreaterThan(80);
                }
                expect(gpuErrors).toEqual([]);
            } finally {
                output.destroy();
                renderer.destroy();
            }
            expect(probe.getDiagnostics().ready).toBe(false);
        }, 60_000);
    }

    it('preserves local specular energy when SSR has no screen-space hit in Clustered rendering', async () => {
        const values: number[] = [];
        for (const [dynamic, reflections] of [
            [false, false],
            [false, true],
            [true, false],
            [true, true]
        ] as const) {
            const probe = volume(dynamic ? undefined : cube([180, 30, 10]));
            const { root, camera } = scene(probe);
            if (dynamic)
                new Mesh({
                    geometry: new BoxGeometry({ width: 8, height: 8, depth: 8 }),
                    material: new BasicMaterial({
                        lightType: 'NONE',
                        diffuse: new Color(180 / 255, 30 / 255, 10 / 255),
                        cullMode: 'front'
                    })
                }).addTo(root);
            const factory = new ClusteredForwardPlusPipelineFactory({
                buckets: [{ geometry: new BoxGeometry(), material: new PBRMaterial() }],
                maxObjects: 4,
                maxLights: 1,
                maxLightIndices: 128,
                maxLightsPerCluster: 1,
                maxViewportWidth: 32,
                maxViewportHeight: 32,
                bloomStrength: 0,
                hiZ: true,
                temporalAA: {},
                screenSpaceReflections: reflections ? { maxSteps: 8 } : false
            });
            const renderer = await Renderer.create({
                backend: 'webgpu',
                domElement: document.createElement('canvas'),
                width: 32,
                height: 32,
                antialias: false,
                renderingProfile: 'high-end',
                renderPipeline: dynamic
                    ? new ReflectionProbePipelineFactory({
                          probes: [probe],
                          pipeline: factory,
                          resolution: 16,
                          roughnessLevels: 2,
                          facesPerFrame: 6,
                          filterLevelsPerFrame: 2
                      })
                    : factory
            });
            const output = renderer.createRenderTarget({ width: 32, height: 32 });
            try {
                for (let frame = 0; frame < 4; frame++)
                    renderer.renderToTarget(output, root, camera);
                values.push(
                    (await output.readColorAttachment({ x: 16, y: 16, width: 1, height: 1 }))
                        .data[0] ?? 0
                );
            } finally {
                output.destroy();
                renderer.destroy();
            }
        }
        for (const offset of [0, 2]) {
            expect(values[offset]).toBeGreaterThan(80);
            expect(Math.abs((values[offset] ?? 0) - (values[offset + 1] ?? 0))).toBeLessThan(5);
        }
    }, 60_000);
});
