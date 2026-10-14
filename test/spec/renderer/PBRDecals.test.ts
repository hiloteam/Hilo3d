import { describe, expect, it } from 'vitest';
import Renderer from '../../../src/render/Renderer';
import Node from '../../../src/core/Node';
import Mesh from '../../../src/core/Mesh';
import PlaneGeometry from '../../../src/geometry/PlaneGeometry';
import BoxGeometry from '../../../src/geometry/BoxGeometry';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import PBRMaterial from '../../../src/material/PBRMaterial';
import AmbientLight from '../../../src/light/AmbientLight';
import Color from '../../../src/math/Color';
import Matrix4 from '../../../src/math/Matrix4';
import DataTexture from '../../../src/texture/DataTexture';
import { NEAREST, RGBA, UNSIGNED_BYTE } from '../../../src/constants/webgl';
import { RGBA8 } from '../../../src/constants/webgl2';
import { DecalProjector, decalProjectorState } from '../../../src/render/decals/DecalProjector';
import {
    DecalMaterialBinding,
    DECAL_BLOCK_LAYOUT
} from '../../../src/render/decals/DecalMaterialBinding';
import { ClusteredForwardPlusPipelineFactory } from '../../../src/render/pipeline/ClusteredForwardPlus';
import { SceneRenderPass } from '../../../src/render/pipeline/passes/SceneRenderPass';
import { PresentRenderPass } from '../../../src/render/pipeline/passes/FullscreenRenderPass';
import { depthClearValue } from '../../../src/render/renderer/DepthConvention';
import { ForwardRenderPipelineFactory } from '../../../src/render/pipeline/ForwardRenderPipeline';
import { TemporalAA } from '../../../src/render/postprocessing/TemporalAA';
import type {
    RenderPipeline,
    RenderPipelineContext,
    RenderPipelineFactory
} from '../../../src/render/pipeline/RenderPipeline';

function texture(values: readonly number[], width = 1, height = 1): DataTexture {
    return new DataTexture({
        image: new Uint8Array(values),
        width,
        height,
        internalFormat: RGBA8,
        format: RGBA,
        type: UNSIGNED_BYTE,
        minFilter: NEAREST,
        magFilter: NEAREST
    });
}

function plane(material: PBRMaterial): { root: Node; mesh: Mesh; camera: PerspectiveCamera } {
    const root = new Node();
    const mesh = new Mesh({ material, geometry: new PlaneGeometry({ width: 2, height: 2 }) }).addTo(
        root
    );
    // Ambient PBR returns (1 - dielectric F0) / pi for a white nonmetal.
    new AmbientLight({ amount: 1, color: new Color(1, 1, 1) }).addTo(root);
    const camera = new PerspectiveCamera({ z: 2, near: 0.1, far: 20, aspect: 1 });
    return { root, mesh, camera };
}

class Attributes implements RenderPipeline {
    readonly name = 'decal-attributes';
    readonly pass = new SceneRenderPass('decal attributes');
    readonly depth = new SceneRenderPass('decal attribute depth');
    record(context: RenderPipelineContext): void {
        const output = context.graph.importOutput();
        if (output.depthStencil === null) throw new Error('Decal attribute fixture requires depth');
        const culling = context.cull();
        context.graph.addPass(this.depth, {
            rendererList: context.createRendererList({
                cullingResults: culling,
                queue: 'opaque',
                sorting: 'none',
                materialPass: 'depth-only'
            }),
            colorAttachments: [],
            depthStencilAttachment: {
                texture: output.depthStencil,
                depthLoadOp: 'clear',
                depthStoreOp: 'store',
                depthClearValue: depthClearValue(context.camera.depthMode)
            }
        });
        context.graph.addPass(this.pass, {
            rendererList: context.createRendererList({
                cullingResults: culling,
                queue: 'opaque',
                sorting: 'none',
                materialPass: 'material-attributes'
            }),
            colorAttachments: [
                {
                    texture: output.color(0),
                    loadOp: 'clear',
                    storeOp: 'store',
                    clearValue: { r: 0, g: 0, b: 0, a: 0 }
                }
            ],
            depthStencilAttachment: {
                texture: output.depthStencil,
                depthLoadOp: 'load',
                depthStoreOp: 'store',
                depthClearValue: depthClearValue(context.camera.depthMode)
            }
        });
    }
    destroy(): void {
        /* No owned GPU resources. */
    }
}

const attributesFactory: RenderPipelineFactory = {
    name: 'decal-attributes',
    create: () => new Attributes()
};

describe('PBR projected decals', () => {
    it('validates atomic projector edits and bounded material membership', () => {
        const projector = new DecalProjector();
        const state = decalProjectorState(projector);
        expect(() => {
            projector.update({ opacity: NaN });
        }).toThrow(/opacity/);
        expect(decalProjectorState(projector)).toBe(state);
        expect(() => {
            projector.update({ transform: new Matrix4().fromArray(new Float32Array(16)) });
        }).toThrow(/invertible/);
        expect(() => {
            projector.update({ atlasRect: [0.8, 0, 0.3, 1] });
        }).toThrow(/inside/);
        expect(() => {
            projector.update({ layer: -1 });
        }).toThrow(/unsigned/);
        const atlas = texture([255, 255, 255, 255]);
        expect(
            () => new PBRMaterial({ decals: { baseColorAtlas: atlas, projectors: [] } })
        ).toThrow(/one to eight/);
        expect(
            () =>
                new PBRMaterial({
                    decals: { baseColorAtlas: atlas, projectors: [projector, projector] }
                })
        ).toThrow(/distinct/);
        expect(
            () =>
                new PBRMaterial({
                    decals: {
                        baseColorAtlas: atlas,
                        projectors: Array.from({ length: 9 }, () => new DecalProjector())
                    }
                })
        ).toThrow(/one to eight/);
        expect(
            () =>
                new PBRMaterial({
                    compositing: { mode: 'alpha-blend', premultiplied: false },
                    decals: { baseColorAtlas: atlas, projectors: [projector] }
                })
        ).toThrow(/opaque/);
        expect(
            () =>
                new PBRMaterial({
                    transmissionFactor: 0.5,
                    decals: { baseColorAtlas: atlas, projectors: [projector] }
                })
        ).toThrow(/opaque/);
        expect(
            () =>
                new PBRMaterial({
                    unlit: true,
                    decals: { baseColorAtlas: atlas, projectors: [projector] }
                })
        ).toThrow(/lit/);
        atlas.destroy();
    });

    it('owns copied transforms and a stable, revisioned 1280-byte std140 recipe', () => {
        const transform = new Matrix4();
        const projector = new DecalProjector({ transform });
        transform.elements[12] = 100;
        expect(projector.getTransform(new Matrix4()).elements[12]).toBe(0);
        const atlas = texture([255, 255, 255, 255]);
        const binding = new DecalMaterialBinding({
            projectors: [projector],
            baseColorAtlas: atlas
        });
        expect(DECAL_BLOCK_LAYOUT.byteLength).toBe(1280);
        expect(Object.values(DECAL_BLOCK_LAYOUT.fields).map(field => field.offset)).toEqual([
            0, 512, 640, 768, 896, 1024, 1152
        ]);
        expect(DECAL_BLOCK_LAYOUT.fields.u_decalWorldToLocal.arrayStride).toBe(64);
        expect(DECAL_BLOCK_LAYOUT.fields.u_decalColor.arrayStride).toBe(16);
        const buffer = binding.buffer;
        const revision = buffer.revision;
        expect(binding.buffer.revision).toBe(revision);
        projector.update({ opacity: 0.25 });
        expect(binding.buffer).toBe(buffer);
        expect(buffer.revision).toBeGreaterThan(revision);
        atlas.destroy();
    });

    for (const backend of ['webgl2', 'webgpu'] as const) {
        it(`writes authored reactive masks for static decal receivers on ${backend}`, async () => {
            const atlas = texture([255, 255, 255, 255]);
            const material = new PBRMaterial({
                decals: { projectors: [new DecalProjector()], baseColorAtlas: atlas }
            });
            const { root, camera } = plane(material);
            const depthPass = new SceneRenderPass('decal motion depth');
            const motionPass = new SceneRenderPass('decal authored reactive mask');
            const readbackPass = new PresentRenderPass('decal reactive mask readback');
            const renderer = await Renderer.create({
                backend,
                width: 16,
                height: 16,
                domElement: document.createElement('canvas'),
                antialias: false,
                renderPipeline: {
                    name: 'decal reactive mask readback',
                    create: () => ({
                        name: 'decal reactive mask readback',
                        record(frame): void {
                            const output = frame.graph.importOutput();
                            if (output.depthStencil === null)
                                throw new Error('Missing motion test depth');
                            const motion = frame.graph.createTexture('decal motion', {
                                format: 'rgba16float',
                                extent: { width: 16, height: 16 }
                            });
                            const reactive = frame.graph.createTexture('decal reactive', {
                                format: 'r8unorm',
                                extent: { width: 16, height: 16 }
                            });
                            const culling = frame.cull();
                            frame.graph.addPass(depthPass, {
                                rendererList: frame.createRendererList({
                                    cullingResults: culling,
                                    queue: 'opaque',
                                    sorting: 'none',
                                    materialPass: 'depth-only'
                                }),
                                colorAttachments: [],
                                depthStencilAttachment: {
                                    texture: output.depthStencil,
                                    depthLoadOp: 'clear',
                                    depthStoreOp: 'store',
                                    depthClearValue: depthClearValue(frame.camera.depthMode)
                                }
                            });
                            frame.graph.addPass(motionPass, {
                                rendererList: frame.createRendererList({
                                    cullingResults: culling,
                                    queue: 'opaque',
                                    sorting: 'none',
                                    materialPass: 'motion-vector'
                                }),
                                colorAttachments: [
                                    {
                                        texture: motion,
                                        loadOp: 'clear',
                                        storeOp: 'store',
                                        clearValue: { r: 0, g: 0, b: 0, a: 0 }
                                    },
                                    {
                                        texture: reactive,
                                        loadOp: 'clear',
                                        storeOp: 'store',
                                        clearValue: { r: 1, g: 0, b: 0, a: 0 }
                                    }
                                ],
                                depthStencilAttachment: {
                                    texture: output.depthStencil,
                                    depthReadOnly: true
                                }
                            });
                            frame.graph.addPass(readbackPass, {
                                inputTextures: [reactive],
                                colorAttachments: [
                                    {
                                        texture: output.color(0),
                                        loadOp: 'clear',
                                        storeOp: 'store',
                                        clearValue: { r: 0, g: 0, b: 0, a: 0 }
                                    }
                                ]
                            });
                        },
                        destroy(): void {
                            readbackPass.shader.destroy();
                        }
                    })
                }
            });
            const output = renderer.createRenderTarget({
                width: 16,
                height: 16,
                colorAttachments: [{ format: 'rgba8unorm' }],
                depthStencilAttachment: { format: 'depth32float' }
            });
            try {
                for (const factor of [0, 0.4, 1, 0]) {
                    material.temporalReactiveFactor = factor;
                    renderer.renderToTarget(output, root, camera);
                    const pixel = await output.readColorAttachment({
                        attachmentIndex: 0,
                        x: 8,
                        y: 8,
                        width: 1,
                        height: 1
                    });
                    expect(pixel.data[0]).toBeCloseTo(factor * 255, 0);
                }
            } finally {
                output.destroy();
                renderer.destroy();
                atlas.destroy();
            }
        }, 30_000);

        it(`keeps cutout holes, temporal history, discarded updates and recovery correct on ${backend}`, async () => {
            const atlas = texture([255, 255, 255, 255]);
            const coverage = texture([255, 255, 255, 0, 255, 255, 255, 255], 2, 1);
            const projector = new DecalProjector({ color: new Color(1, 0, 0) });
            const material = new PBRMaterial({
                metallic: 0,
                roughness: 1,
                baseColor: new Color(0, 1, 0),
                baseColorMap: coverage,
                coverage: { mode: 'mask', cutoff: 0.5 },
                decals: { projectors: [projector], baseColorAtlas: atlas }
            });
            const { root, camera, mesh } = plane(material);
            let fail = false;
            const forward = new ForwardRenderPipelineFactory({
                sceneColorFormat: 'rgba16float',
                features: [new TemporalAA({ sharpness: 0 })]
            });
            const factory: RenderPipelineFactory = {
                name: 'decal temporal rollback',
                requirements: forward.requirements,
                create(context) {
                    const runtime = forward.create(context);
                    return {
                        name: 'decal temporal rollback',
                        record(frame): void {
                            runtime.record(frame);
                            if (fail) throw new Error('discard decal candidate');
                        },
                        frameSubmitted(frame): void {
                            runtime.frameSubmitted?.(frame);
                        },
                        frameDiscarded(frame): void {
                            runtime.frameDiscarded?.(frame);
                        },
                        destroy(): void {
                            runtime.destroy();
                        }
                    };
                }
            };
            const renderer = await Renderer.create({
                backend,
                width: 32,
                height: 32,
                domElement: document.createElement('canvas'),
                antialias: false,
                renderPipeline: factory
            });
            let target = renderer.createRenderTarget({
                width: 32,
                height: 32,
                depthStencilAttachment: false
            });
            const draw = (): void => {
                renderer.renderToTarget(target, root, camera);
            };
            const read = async (x = 20): Promise<Uint8Array> =>
                (await target.readColorAttachment({ x, y: 16, width: 1, height: 1 })).data;
            try {
                for (let frame = 0; frame < 4; frame++) draw();
                const red = await read();
                expect(red[0]).toBeGreaterThan(50);
                expect(red[1]).toBeLessThan(2);
                const hole = await read(12);
                expect(hole[0]).toBeLessThan(2);
                expect(hole[1]).toBeLessThan(2);
                projector.update({ color: new Color(0, 0, 1) });
                fail = true;
                expect(draw).toThrow(/discard decal candidate/);
                fail = false;
                draw();
                const blue = await read();
                expect(blue[2]).toBeGreaterThan(50);
                expect(blue[0]).toBeLessThan(2);
                projector.update({ enabled: false });
                draw();
                const green = await read();
                expect(green[1]).toBeGreaterThan(50);
                expect(green[2]).toBeLessThan(2);
                projector.update({ enabled: true });
                atlas.image = new Uint8Array([255, 255, 255, 0]);
                draw();
                expect((await read())[1]).toBeGreaterThan(50);
                atlas.image = new Uint8Array([255, 255, 255, 255]);
                await renderer.waitForIdle();
                renderer.releaseGPUResources();
                target = renderer.createRenderTarget({
                    width: 32,
                    height: 32,
                    depthStencilAttachment: false
                });
                draw();
                expect((await read())[2]).toBeGreaterThan(50);
                expect(material.decals?.projectors[0]).toBe(projector);
                mesh.material = new PBRMaterial({
                    metallic: 0,
                    roughness: 1,
                    baseColor: new Color(0, 1, 0),
                    baseColorMap: coverage,
                    coverage: { mode: 'mask', cutoff: 0.5 }
                });
                draw();
                const removed = await read();
                expect(removed[1]).toBeGreaterThan(50);
                expect(removed[2]).toBeLessThan(2);
            } finally {
                target.destroy();
                renderer.destroy();
                atlas.destroy();
                coverage.destroy();
            }
        }, 30_000);

        it(`preserves projected normal handedness under mirrored X and Y on ${backend}`, async () => {
            const atlas = texture([255, 255, 255, 255]);
            const normal = texture([128, 218, 218, 255]);
            const projector = new DecalProjector();
            const material = new PBRMaterial({
                metallic: 0,
                decals: { projectors: [projector], baseColorAtlas: atlas, normalAtlas: normal }
            });
            const { root, camera } = plane(material);
            const renderer = await Renderer.create({
                backend,
                domElement: document.createElement('canvas'),
                width: 16,
                height: 16,
                antialias: false,
                renderPipeline: attributesFactory
            });
            const output = renderer.createRenderTarget({ width: 16, height: 16 });
            const read = async (): Promise<number> => {
                renderer.renderToTarget(output, root, camera);
                return (
                    (await output.readColorAttachment({ x: 8, y: 8, width: 1, height: 1 }))
                        .data[1] ?? 0
                );
            };
            try {
                const originalY = await read();
                expect(originalY).toBeGreaterThan(175);
                const mirrorX = new Matrix4();
                mirrorX.elements[0] = -1;
                projector.update({ transform: mirrorX });
                expect(Math.abs((await read()) - originalY)).toBeLessThanOrEqual(1);
                const mirrorY = new Matrix4();
                mirrorY.elements[5] = -1;
                projector.update({ transform: mirrorY });
                expect(await read()).toBeLessThan(80);
            } finally {
                output.destroy();
                renderer.destroy();
                atlas.destroy();
                normal.destroy();
            }
        }, 30_000);

        it(`preserves atlas rows, masks, stable overlap and moving projector rejection on ${backend}`, async () => {
            const atlas = texture([255, 0, 0, 255, 0, 0, 255, 255], 1, 2);
            const projector = new DecalProjector({ edgeFade: 0 });
            const material = new PBRMaterial({
                metallic: 0,
                roughness: 1,
                baseColor: new Color(0, 1, 0),
                decals: {
                    projectors: [projector],
                    baseColorAtlas: atlas,
                    baseColorEncoding: 'linear'
                }
            });
            const { root, camera } = plane(material);
            const renderer = await Renderer.create({
                backend,
                domElement: document.createElement('canvas'),
                width: 32,
                height: 32,
                antialias: false
            });
            const output = renderer.createRenderTarget({ width: 32, height: 32 });
            const read = async (y: number): Promise<Uint8Array> => {
                renderer.renderToTarget(output, root, camera);
                return (await output.readColorAttachment({ x: 16, y, width: 1, height: 1 })).data;
            };
            try {
                const upper = await read(12);
                const lower = await read(20);
                expect(upper[0]).toBeCloseTo((255 * 0.96) / Math.PI, 0);
                expect(upper[2]).toBeLessThan(5);
                expect(lower[2]).toBeCloseTo((255 * 0.96) / Math.PI, 0);
                expect(lower[0]).toBeLessThan(5);
                projector.update({ layer: 0 });
                const masked = await read(12);
                expect(masked[1]).toBeCloseTo((255 * 0.96) / Math.PI, 0);
                expect(masked[0]).toBeLessThan(5);
                projector.update({ layer: 1, maxDistance: 1, distanceFade: 0 });
                expect((await read(12))[1]).toBeCloseTo((255 * 0.96) / Math.PI, 0);
                projector.update({ maxDistance: 10 });
                expect((await read(12))[0]).toBeCloseTo((255 * 0.96) / Math.PI, 0);
                const moved = new Matrix4();
                moved.elements[12] = 5;
                projector.update({ transform: moved });
                expect((await read(12))[1]).toBeCloseTo((255 * 0.96) / Math.PI, 0);
                // Content revisions reject changed receiver history; static frames retain authored reactivity.
                expect(material.temporalReactiveFactor).toBe(0);
            } finally {
                output.destroy();
                renderer.destroy();
                atlas.destroy();
            }
        }, 30_000);

        it.each([false, true])(
            `orders projectors and preserves surface attributes on ${backend} (specular-glossiness: %s)`,
            async isSpecularGlossiness => {
                const atlas = texture([255, 255, 255, 255]);
                const normal = texture([218, 128, 218, 255]);
                const red = new DecalProjector({
                    color: new Color(1, 0, 0),
                    order: 1,
                    roughness: 0.25,
                    affectsRoughness: true
                });
                const blue = new DecalProjector({
                    color: new Color(0, 0, 1),
                    order: 2,
                    roughness: 0.75,
                    affectsRoughness: true
                });
                const material = new PBRMaterial({
                    metallic: 0,
                    roughness: 1,
                    isSpecularGlossiness,
                    specular: new Color(0.04, 0.04, 0.04),
                    decals: { projectors: [red, blue], baseColorAtlas: atlas, normalAtlas: normal }
                });
                const { root, camera } = plane(material);
                const renderers: Renderer[] = [];
                try {
                    for (const attributes of [false, true]) {
                        const renderer = await Renderer.create({
                            backend,
                            domElement: document.createElement('canvas'),
                            width: 16,
                            height: 16,
                            antialias: false,
                            ...(attributes ? { renderPipeline: attributesFactory } : {})
                        });
                        renderers.push(renderer);
                        const output = renderer.createRenderTarget({ width: 16, height: 16 });
                        const read = async (): Promise<Uint8Array> => {
                            renderer.renderToTarget(output, root, camera);
                            return (
                                await output.readColorAttachment({
                                    x: 8,
                                    y: 8,
                                    width: 1,
                                    height: 1
                                })
                            ).data;
                        };
                        try {
                            red.update({ order: 1 });
                            const first = await read();
                            red.update({ order: 3 });
                            const second = await read();
                            if (attributes) {
                                expect(first[2]).toBeCloseTo(191, -1);
                                expect(second[2]).toBeCloseTo(64, -1);
                                expect(first[0]).toBeGreaterThan(145);
                            } else {
                                expect(first[2]).toBeCloseTo((255 * 0.96) / Math.PI, 0);
                                expect(first[0]).toBeLessThan(5);
                                expect(second[0]).toBeCloseTo((255 * 0.96) / Math.PI, 0);
                                expect(second[2]).toBeLessThan(5);
                            }
                        } finally {
                            output.destroy();
                        }
                    }
                } finally {
                    for (const renderer of renderers) renderer.destroy();
                    atlas.destroy();
                    normal.destroy();
                }
            },
            30_000
        );
    }

    it('uses the native clustered direct material path and rejects an incompatible explicit GPU bucket', async () => {
        const atlas = texture([255, 0, 0, 255]);
        const material = new PBRMaterial({
            metallic: 0,
            decals: { projectors: [new DecalProjector()], baseColorAtlas: atlas }
        });
        const { root, camera, mesh } = plane(material);
        if (mesh.geometry === null) throw new Error('Missing receiver geometry');
        const geometry = mesh.geometry;
        expect(
            () =>
                new ClusteredForwardPlusPipelineFactory({
                    buckets: [{ geometry, material }]
                })
        ).toThrow(/decals/);
        const factory = new ClusteredForwardPlusPipelineFactory({
            buckets: [{ geometry: new BoxGeometry(), material: new PBRMaterial() }],
            maxObjects: 4,
            maxLights: 1,
            maxLightIndices: 64,
            maxLightsPerCluster: 1,
            maxViewportWidth: 16,
            maxViewportHeight: 16,
            hiZ: false,
            bloomStrength: 0
        });
        const renderer = await Renderer.create({
            backend: 'webgpu',
            domElement: document.createElement('canvas'),
            width: 16,
            height: 16,
            antialias: false,
            renderPipeline: factory
        });
        const output = renderer.createRenderTarget({ width: 16, height: 16 });
        try {
            renderer.renderToTarget(output, root, camera);
            const pixel = (await output.readColorAttachment({ x: 8, y: 8, width: 1, height: 1 }))
                .data;
            expect(pixel[0]).toBeGreaterThan(80);
            expect(pixel[1]).toBeLessThan(5);
            expect((await factory.readDiagnostics()).clusteredDeformedObjectCount).toBe(1);
        } finally {
            output.destroy();
            renderer.destroy();
            atlas.destroy();
        }
    }, 30_000);
});
