import { describe, expect, it, vi } from 'vitest';
import type Node from '../../../src/core/Node';
import {
    addonGPUOpaqueSceneFeature,
    addonGPUSceneFeature
} from '../../../src/render/pipeline/AddonGPUSceneFeature';
import {
    RENDER_NODE_EXTENSION,
    type RenderNodeGPUExtension
} from '../../../src/render/pipeline/RenderNodeExtension';
import type { ForwardRenderFeatureContext } from '../../../src/render/pipeline/ForwardRenderPipeline';
import type { RenderPipelineCreateContext } from '../../../src/render/pipeline/RenderPipeline';

function createRuntimePair(): readonly [
    ReturnType<typeof addonGPUOpaqueSceneFeature.create>,
    ReturnType<typeof addonGPUSceneFeature.create>
] {
    const context = {
        capabilities: {
            supportsCapability: () => true
        }
    } as unknown as RenderPipelineCreateContext;
    return [addonGPUOpaqueSceneFeature.create(context), addonGPUSceneFeature.create(context)];
}

function createRecordContext(gpu: RenderNodeGPUExtension): ForwardRenderFeatureContext {
    const node = { [RENDER_NODE_EXTENSION]: { gpu } } as unknown as Node;
    return {
        pipeline: {
            scene: {
                traverse(callback: (candidate: Node) => void): void {
                    callback(node);
                }
            },
            camera: {}
        },
        resources: { color: 1, depth: null }
    } as unknown as ForwardRenderFeatureContext;
}

function createGPU(): {
    readonly gpu: RenderNodeGPUExtension;
    readonly record: ReturnType<typeof vi.fn<RenderNodeGPUExtension['record']>>;
    readonly frameSubmitted: ReturnType<typeof vi.fn<RenderNodeGPUExtension['frameSubmitted']>>;
    readonly frameDiscarded: ReturnType<typeof vi.fn<RenderNodeGPUExtension['frameDiscarded']>>;
} {
    const record = vi.fn<RenderNodeGPUExtension['record']>();
    const frameSubmitted = vi.fn<RenderNodeGPUExtension['frameSubmitted']>();
    const frameDiscarded = vi.fn<RenderNodeGPUExtension['frameDiscarded']>();
    const gpu: RenderNodeGPUExtension = {
        hasOpaqueRenderers: true,
        requiresSampledDepth: false,
        hasPendingWork: true,
        isVisible: () => true,
        record,
        frameSubmitted,
        frameDiscarded
    };
    return { gpu, record, frameSubmitted, frameDiscarded };
}

describe('addon GPU scene transaction', () => {
    it('rolls back a participant whose record call throws', () => {
        const { gpu, record, frameDiscarded } = createGPU();
        record.mockImplementationOnce(() => {
            throw new Error('record failed');
        });
        const [opaque, transparent] = createRuntimePair();

        expect(() => opaque.record(createRecordContext(gpu))).toThrow('record failed');
        opaque.frameDiscarded?.(7);
        transparent.frameDiscarded?.(7);

        expect(frameDiscarded).toHaveBeenCalledOnce();
        expect(frameDiscarded).toHaveBeenCalledWith(7);
    });

    it('deduplicates commit callbacks across opaque and transparent phases', () => {
        const { gpu, record, frameSubmitted } = createGPU();
        const context = createRecordContext(gpu);
        const [opaque, transparent] = createRuntimePair();

        opaque.record(context);
        transparent.record(context);
        opaque.frameSubmitted?.(11);
        transparent.frameSubmitted?.(11);

        expect(record).toHaveBeenCalledTimes(2);
        expect(frameSubmitted).toHaveBeenCalledOnce();
        expect(frameSubmitted).toHaveBeenCalledWith(11);
    });
});
