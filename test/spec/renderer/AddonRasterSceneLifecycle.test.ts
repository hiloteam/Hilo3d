import { describe, expect, it, vi } from 'vitest';
import OrthographicCamera from '../../../src/camera/OrthographicCamera';
import Node from '../../../src/core/Node';
import { addonRasterSceneFeature } from '../../../src/render/pipeline/AddonRasterSceneFeature';
import type { ForwardRenderFeatureContext } from '../../../src/render/pipeline/ForwardRenderPipeline';
import type {
    RenderPipelineContext,
    RenderPipelineCreateContext
} from '../../../src/render/pipeline/RenderPipeline';
import {
    RENDER_NODE_EXTENSION,
    type RenderNodeRasterExtension
} from '../../../src/render/pipeline/RenderNodeExtension';

function rasterNode(raster: RenderNodeRasterExtension): Node {
    const node = new Node();
    Reflect.set(node, RENDER_NODE_EXTENSION, { gpu: null, raster });
    return node;
}

function featureContext(scene: Node): ForwardRenderFeatureContext {
    const pipeline = {
        scene,
        camera: new OrthographicCamera()
    } as unknown as RenderPipelineContext;
    return { pipeline } as ForwardRenderFeatureContext;
}

describe('portable addon callback lifecycle', () => {
    for (const callback of ['frameSubmitted', 'frameDiscarded'] as const) {
        it(`rejects asynchronous ${callback}, notifies all participants and clears the frame`, async () => {
            const first = vi.fn(() => Promise.reject(new Error('late callback failure')));
            const second = vi.fn();
            const scene = new Node()
                .addChild(rasterNode({ isVisible: () => true, record: vi.fn(), [callback]: first }))
                .addChild(
                    rasterNode({ isVisible: () => true, record: vi.fn(), [callback]: second })
                );
            const runtime = addonRasterSceneFeature.create({} as RenderPipelineCreateContext);
            runtime.record(featureContext(scene));
            expect(() => runtime[callback]?.(4)).toThrow(AggregateError);
            expect(first).toHaveBeenCalledExactlyOnceWith(4);
            expect(second).toHaveBeenCalledExactlyOnceWith(4);
            runtime[callback]?.(5);
            expect(first).toHaveBeenCalledOnce();
            expect(second).toHaveBeenCalledOnce();
            await Promise.resolve();
            runtime.destroy();
        });
    }

    it('observes an asynchronous record rejection and retains the participant for rollback', async () => {
        const discarded = vi.fn();
        const scene = new Node().addChild(
            rasterNode({
                isVisible: () => true,
                record: () => Promise.reject(new Error('late record failure')),
                frameDiscarded: discarded
            })
        );
        const runtime = addonRasterSceneFeature.create({} as RenderPipelineCreateContext);
        expect(() => runtime.record(featureContext(scene))).toThrow(/must be synchronous/u);
        runtime.frameDiscarded?.(6);
        expect(discarded).toHaveBeenCalledExactlyOnceWith(6);
        await Promise.resolve();
        runtime.destroy();
    });

    it('stops requirement discovery at the first visible contribution and prunes hidden subtrees', () => {
        const hiddenRead = vi.fn(() => ({ gpu: null }));
        const hiddenChild = new Node();
        Object.defineProperty(hiddenChild, RENDER_NODE_EXTENSION, { get: hiddenRead });
        const laterVisible = vi.fn(() => true);
        const scene = new Node()
            .addChild(new Node({ visible: false }).addChild(hiddenChild))
            .addChild(rasterNode({ isVisible: () => true, record: vi.fn() }))
            .addChild(rasterNode({ isVisible: laterVisible, record: vi.fn() }));
        const context = featureContext(scene);
        const runtime = addonRasterSceneFeature.create({} as RenderPipelineCreateContext);
        expect(runtime.requiresSplitScene?.(context.pipeline)).toBe(true);
        expect(hiddenRead).not.toHaveBeenCalled();
        expect(laterVisible).not.toHaveBeenCalled();
        runtime.record(context);
        expect(hiddenRead).not.toHaveBeenCalled();
        expect(laterVisible).toHaveBeenCalledOnce();
        runtime.destroy();
    });
});
