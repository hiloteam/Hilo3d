import { describe, expect, it, vi } from 'vitest';
import OrthographicCamera from '../../../src/camera/OrthographicCamera';
import Mesh from '../../../src/core/Mesh';
import Node from '../../../src/core/Node';
import PlaneGeometry from '../../../src/geometry/PlaneGeometry';
import BasicMaterial from '../../../src/material/BasicMaterial';
import Color from '../../../src/math/Color';
import Renderer from '../../../src/render/Renderer';
import { addonRasterSceneFeature } from '../../../src/render/pipeline/AddonRasterSceneFeature';
import {
    RENDER_NODE_EXTENSION,
    getRenderNodeExtension,
    type RenderNodeExtension,
    type RenderNodeRasterExtension
} from '../../../src/render/pipeline/RenderNodeExtension';
import type { ForwardRenderFeatureContext } from '../../../src/render/pipeline/ForwardRenderPipeline';
import type {
    RenderPipelineContext,
    RenderPipelineCreateContext
} from '../../../src/render/pipeline/RenderPipeline';
import { SceneRenderPass } from '../../../src/render/pipeline/passes/SceneRenderPass';

class RasterNode extends Node {
    readonly [RENDER_NODE_EXTENSION]: RenderNodeExtension;
    constructor(raster: RenderNodeRasterExtension | null) {
        super();
        this[RENDER_NODE_EXTENSION] = { gpu: null, raster };
    }
}

describe('Automatic portable render-node bridge', () => {
    for (const backend of ['webgl2', 'webgpu'] as const) {
        it(`records a default Forward prepass with each camera's shared culling on ${backend}`, async () => {
            const submitted = vi.fn();
            const cameras: RenderPipelineContext['camera'][] = [];
            const pass = new SceneRenderPass('Automatic addon draw');
            const mesh = new Mesh({
                geometry: new PlaneGeometry(),
                material: new BasicMaterial({
                    lightType: 'NONE',
                    diffuse: new Color(0, 1, 0),
                    state: { depthTest: false, depthWrite: false, cullMode: 'none' }
                }),
                visible: false
            });
            const node = new RasterNode({
                isVisible: () => true,
                frameSubmitted: submitted,
                record(context): void {
                    cameras.push(context.pipeline.camera);
                    const color = context.resources.color;
                    if (color === null) throw new Error('Forward color is unavailable');
                    context.pipeline.graph.addPass(pass, {
                        rendererList: context.pipeline.createOrderedRendererList({
                            cullingResults: context.cullingResults,
                            meshes: [mesh]
                        }),
                        colorAttachments: [{ texture: color, loadOp: 'load', storeOp: 'store' }]
                    });
                }
            }).addChild(mesh);
            const scene = new Node().addChild(node);
            const renderer = await Renderer.create({
                backend,
                domElement: document.createElement('canvas'),
                width: 8,
                height: 8,
                antialias: false
            });
            const first = renderer.createRenderTarget({ width: 8, height: 8 });
            const second = renderer.createRenderTarget({ width: 8, height: 8 });
            const camera = new OrthographicCamera({ near: 0.1, far: 10, z: 2 });
            const other = new OrthographicCamera({ near: 0.1, far: 10, x: 5, z: 2 });
            try {
                renderer.renderFrame(frame => {
                    frame.renderToTarget(first, scene, camera);
                    frame.renderToTarget(second, scene, other);
                });
                await renderer.waitForIdle();
                expect(cameras).toEqual([camera, other]);
                expect(submitted).toHaveBeenCalledOnce();
                const firstPixels = (await first.readColorAttachment()).data;
                const secondPixels = (await second.readColorAttachment()).data;
                const center = (4 * 8 + 4) * 4;
                expect(firstPixels[center + 1]).toBeGreaterThan(240);
                expect(secondPixels[center + 1]).toBeLessThan(8);
            } finally {
                scene.destroy(renderer);
                first.destroy();
                second.destroy();
                renderer.destroy();
            }
        });
    }

    it('does not request split passes for absent, inactive, hidden or layer-excluded contributions', () => {
        const record = vi.fn();
        let active = true;
        const node = new RasterNode({ isVisible: () => active, record });
        const parent = new Node().addChild(node);
        const scene = new Node().addChild(parent).addChild(new RasterNode(null));
        const camera = new OrthographicCamera({ visibility: 1 });
        const context = { scene, camera } as unknown as RenderPipelineContext;
        const featureContext = { pipeline: context } as ForwardRenderFeatureContext;
        const runtime = addonRasterSceneFeature.create({} as RenderPipelineCreateContext);
        expect(runtime.requiresSplitScene?.(context)).toBe(true);
        parent.visible = false;
        expect(runtime.requiresSplitScene?.(context)).toBe(false);
        runtime.record(featureContext);
        parent.visible = true;
        node.layer = 2;
        expect(runtime.requiresSplitScene?.(context)).toBe(false);
        runtime.record(featureContext);
        node.layer = 1;
        active = false;
        expect(runtime.requiresSplitScene?.(context)).toBe(false);
        runtime.record(featureContext);
        node.removeFromParent();
        expect(runtime.requiresSplitScene?.(context)).toBe(false);
        expect(record).not.toHaveBeenCalled();
        runtime.destroy();
    });

    it('rejects asynchronous nested record hooks before submission and rolls back once', async () => {
        const discarded = vi.fn();
        const node = new RasterNode({
            isVisible: () => true,
            record: () => Promise.resolve(),
            frameDiscarded: discarded
        });
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 8,
            height: 8,
            antialias: false
        });
        try {
            let failure: unknown;
            try {
                renderer.render(new Node().addChild(node), new OrthographicCamera());
            } catch (error: unknown) {
                failure = error;
            }
            if (!(failure instanceof Error) || !(failure.cause instanceof TypeError)) {
                throw new Error(
                    'Expected the Forward feature to reject an asynchronous raster hook.',
                    { cause: failure }
                );
            }
            expect(failure.cause.message).toBe('Render node raster record must be synchronous.');
            expect(discarded).toHaveBeenCalledOnce();
        } finally {
            renderer.destroy();
        }
    });

    it('validates raster contracts and continues frame notifications when one listener fails', () => {
        const node = new RasterNode(null);
        Reflect.set(node[RENDER_NODE_EXTENSION], 'raster', { isVisible: () => true });
        expect(() => getRenderNodeExtension(node)).toThrow(/raster hook record/u);
        const committed = vi.fn();
        const broken = new RasterNode({
            isVisible: () => true,
            record: vi.fn(),
            frameSubmitted(): void {
                throw new Error('commit listener failed');
            }
        });
        const good = new RasterNode({
            isVisible: () => true,
            record: vi.fn(),
            frameSubmitted: committed
        });
        const scene = new Node().addChild(broken).addChild(good);
        const pipeline = {
            scene,
            camera: new OrthographicCamera()
        } as unknown as RenderPipelineContext;
        const runtime = addonRasterSceneFeature.create({} as RenderPipelineCreateContext);
        runtime.record({ pipeline } as ForwardRenderFeatureContext);
        runtime.record({ pipeline } as ForwardRenderFeatureContext);
        expect(() => runtime.frameSubmitted?.(3)).toThrow(/frameSubmitted failed/u);
        expect(committed).toHaveBeenCalledExactlyOnceWith(3);
        runtime.frameSubmitted?.(4);
        expect(committed).toHaveBeenCalledOnce();
        runtime.destroy();
    });
});
