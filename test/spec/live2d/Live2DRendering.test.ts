import { describe, expect, it, vi } from 'vitest';
import {
    Color,
    ForwardRenderPipelineFactory,
    Node,
    OrthographicCamera,
    Renderer,
    SceneRenderPass,
    type RenderPipelineFactory,
    type RenderPipeline,
    type RenderPipelineContext,
    Texture
} from '../../../src/Hilo3d';
import { NEAREST } from '../../../src/constants/webgl';
import {
    Live2DNode,
    live2DFeature,
    type Live2DDrawable,
    type Live2DSource
} from '@hilo/addon-live2d';

function drawable(id: string, textureIndex: number): Live2DDrawable {
    return {
        id,
        textureIndex,
        positions: new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]),
        uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
        indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
        opacity: 1,
        renderOrder: textureIndex,
        visible: true,
        doubleSided: true,
        blendMode: 'normal',
        masks: [],
        invertedMask: false,
        multiplyColor: new Float32Array([1, 1, 1, 1]),
        screenColor: new Float32Array(4)
    };
}

function texture(data: number[]): Texture {
    return new Texture({
        image: new Uint8Array(data),
        width: 2,
        height: 2,
        magFilter: NEAREST,
        minFilter: NEAREST,
        premultiplyAlpha: false
    });
}

const noRasterPipeline: RenderPipelineFactory = {
    name: 'no-addon-raster',
    create(): RenderPipeline {
        const pass = new SceneRenderPass();
        return {
            name: 'no-addon-raster',
            record(context: RenderPipelineContext): void {
                const cullingResults = context.cull();
                context.graph.addPass(pass, {
                    rendererList: context.createRendererList({
                        cullingResults,
                        queue: 'transparent',
                        sorting: 'back-to-front'
                    }),
                    colorAttachments: [
                        {
                            texture: context.graph.importOutput().color(0),
                            loadOp: 'clear',
                            storeOp: 'store',
                            clearValue: { r: 0, g: 0, b: 0, a: 0 }
                        }
                    ]
                });
            },
            destroy(): void {
                /* The fixture owns no persistent pipeline resources. */
            }
        };
    }
};

describe('Live2D portable raster rendering', () => {
    it('rejects masked rendering in a custom pipeline without the raster hook and disposes after observer failures', async () => {
        const mask = drawable('mask', 0);
        mask.visible = false;
        const art = drawable('art', 0);
        art.masks = [0];
        const source: Live2DSource = {
            drawables: [mask, art],
            sync(): void {
                /* Synthetic source is mutated directly by the test. */
            }
        };
        const image = texture([
            255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255
        ]);
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 8,
            height: 8,
            antialias: false,
            renderPipeline: noRasterPipeline
        });
        const node = new Live2DNode({ source, textures: [image], ownsTextures: true, maskSize: 8 });
        const scene = new Node().addChild(node);
        const camera = new OrthographicCamera({ near: 0.1, far: 10, z: 2 });
        try {
            expect(() => {
                renderer.render(scene, camera, true);
            }).toThrow(/raster hook/);
            image.on('destroy', () => {
                throw new Error('observer failed');
            });
            expect(() => node.destroy(renderer)).toThrow(/cleanup failed/);
            expect(node.parent).toBeNull();
            expect(node.children).toHaveLength(0);
            expect(node.drawableCount).toBe(0);
            node.destroy(renderer);
        } finally {
            image.off();
            node.destroy(renderer);
            renderer.destroy();
        }
    });
    for (const backend of ['webgl2', 'webgpu'] as const) {
        it(`retains empty drawable indices without submitting them as color or mask draws on ${backend}`, async () => {
            const emptyMask = drawable('empty mask', 0);
            emptyMask.positions = new Float32Array();
            emptyMask.uvs = new Float32Array();
            emptyMask.indices = new Uint16Array();
            const emptyArt = drawable('empty art', 0);
            emptyArt.indices = new Uint16Array();
            const art = drawable('art', 0);
            art.masks = [0];
            const source: Live2DSource = {
                drawables: [emptyMask, emptyArt, art],
                sync(): void {
                    /* Official models may retain placeholders with no rendered triangles. */
                }
            };
            const image = texture([255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255]);
            const renderer = await Renderer.create({
                backend,
                domElement: document.createElement('canvas'),
                width: 8,
                height: 8,
                antialias: false,
                clearColor: new Color(0, 0, 0, 0)
            });
            const node = new Live2DNode({
                source,
                textures: [image],
                ownsTextures: true,
                maskSize: 8
            });
            const scene = new Node().addChild(node);
            const camera = new OrthographicCamera({ near: 0.1, far: 10, z: 2 });
            const target = renderer.createRenderTarget({ width: 8, height: 8 });
            try {
                expect(node.drawableCount).toBe(3);
                expect(node.maskCount).toBe(1);
                renderer.renderToTarget(target, scene, camera, true);
                await renderer.waitForIdle();
                expect(
                    Array.from((await target.readColorAttachment()).data).every(
                        value => value === 0
                    )
                ).toBe(true);
                // An empty ordinary mask hides everything; its inverse must reveal the artwork.
                art.invertedMask = true;
                node.sync();
                renderer.renderToTarget(target, scene, camera, true);
                await renderer.waitForIdle();
                const data = (await target.readColorAttachment()).data;
                expect(Array.from(data.subarray((4 * 8 + 4) * 4, (4 * 8 + 4) * 4 + 4))).toEqual([
                    255, 0, 0, 255
                ]);
            } finally {
                node.destroy(renderer);
                target.destroy();
                renderer.destroy();
            }
        });
        it(`renders asymmetric image/mask rows, inversion, animation and cleanup on ${backend}`, async () => {
            const maskPassSetup = vi.spyOn(SceneRenderPass.prototype, 'setup');
            const mask = drawable('mask', 1);
            mask.visible = false;
            const art = drawable('art', 0);
            art.masks = [0];
            const source: Live2DSource = {
                drawables: [mask, art],
                sync(): void {
                    /* Synthetic source is mutated directly by the test. */
                }
            };
            const textures = [
                texture([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]),
                texture([255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 0, 0, 0, 0, 0])
            ];
            const renderer = await Renderer.create({
                backend,
                domElement: document.createElement('canvas'),
                width: 32,
                height: 32,
                antialias: false,
                clearColor: new Color(0, 0, 0, 0),
                renderPipeline: new ForwardRenderPipelineFactory({ features: [live2DFeature] })
            });
            const node = new Live2DNode({ source, textures, maskSize: 32, ownsTextures: true });
            const scene = new Node().addChild(node);
            const camera = new OrthographicCamera({ near: 0.1, far: 10 });
            camera.setPosition(0, 0, 2);
            const target = renderer.createRenderTarget({ width: 32, height: 32 });
            const sample = (data: Uint8Array, x: number, y: number): number[] =>
                Array.from(data.subarray((y * 32 + x) * 4, (y * 32 + x) * 4 + 4));
            try {
                node.prepare(renderer);
                renderer.renderFrame(frame => {
                    frame.renderToTarget(target, scene, camera, true);
                });
                await renderer.waitForIdle();
                let pixels = (await target.readColorAttachment()).data;
                expect(sample(pixels, 8, 8)).toEqual([255, 0, 0, 255]);
                expect(sample(pixels, 24, 8)).toEqual([0, 255, 0, 255]);
                expect(sample(pixels, 8, 24)).toEqual([0, 0, 0, 0]);
                expect(node.maskCount).toBe(1);
                expect(
                    maskPassSetup.mock.contexts.filter(
                        value =>
                            value instanceof SceneRenderPass && value.name.startsWith('Live2D mask')
                    )
                ).toHaveLength(1);

                const secondTarget = renderer.createRenderTarget({ width: 32, height: 32 });
                const secondCamera = new OrthographicCamera({
                    near: 0.1,
                    far: 10,
                    top: 0,
                    bottom: -2,
                    z: 2
                });
                try {
                    renderer.renderFrame(frame => {
                        frame.renderToTarget(target, scene, camera, true);
                        frame.renderToTarget(secondTarget, scene, secondCamera, true);
                    });
                    await renderer.waitForIdle();
                    expect(sample((await target.readColorAttachment()).data, 8, 8)).toEqual([
                        255, 0, 0, 255
                    ]);
                    expect(sample((await secondTarget.readColorAttachment()).data, 8, 8)).toEqual([
                        0, 0, 0, 0
                    ]);
                } finally {
                    secondTarget.destroy();
                }

                art.invertedMask = true;
                node.sync();
                renderer.renderToTarget(target, scene, camera, true);
                await renderer.waitForIdle();
                pixels = (await target.readColorAttachment()).data;
                expect(sample(pixels, 8, 8)).toEqual([0, 0, 0, 0]);
                expect(sample(pixels, 8, 24)).toEqual([0, 0, 255, 255]);
                expect(sample(pixels, 24, 24)).toEqual([255, 255, 255, 255]);

                node.opacity = 0.5;
                node.sync();
                renderer.renderToTarget(target, scene, camera, true);
                await renderer.waitForIdle();
                pixels = (await target.readColorAttachment()).data;
                expect(sample(pixels, 24, 24)[3]).toBeCloseTo(128, 0);

                for (let index = 0; index < art.positions.length; index += 2) {
                    art.positions[index] = (art.positions[index] ?? 0) - 1;
                }
                node.sync();
                renderer.renderToTarget(target, scene, camera, true);
                await renderer.waitForIdle();
                pixels = (await target.readColorAttachment()).data;
                expect(sample(pixels, 24, 24)).toEqual([0, 0, 0, 0]);
                expect(sample(pixels, 8, 24)[3]).toBeCloseTo(128, 0);

                node.visible = false;
                renderer.renderToTarget(target, scene, camera, true);
                await renderer.waitForIdle();
                pixels = (await target.readColorAttachment()).data;
                expect(sample(pixels, 24, 24)).toEqual([0, 0, 0, 0]);
                node.destroy(renderer);
                node.destroy(renderer);
                expect(node.isDestroyed).toBe(true);
                expect(() => {
                    node.sync();
                }).toThrow(/destroyed/);
                renderer.renderToTarget(target, scene, camera, true);
                await renderer.waitForIdle();
            } finally {
                node.destroy(renderer);
                target.destroy();
                renderer.destroy();
            }
        });
    }
});
