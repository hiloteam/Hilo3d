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

function createRuntimePair(
    supported = true
): readonly [
    ReturnType<typeof addonGPUOpaqueSceneFeature.create>,
    ReturnType<typeof addonGPUSceneFeature.create>
] {
    const context = {
        capabilities: {
            supportsCapability: () => supported
        }
    } as unknown as RenderPipelineCreateContext;
    return [addonGPUOpaqueSceneFeature.create(context), addonGPUSceneFeature.create(context)];
}

function createRecordContext(
    ...contributions: readonly RenderNodeGPUExtension[]
): ForwardRenderFeatureContext {
    const nodes = contributions.map(
        gpu => ({ [RENDER_NODE_EXTENSION]: { gpu } }) as unknown as Node
    );
    return {
        pipeline: {
            scene: {
                traverse(callback: (candidate: Node) => unknown): void {
                    for (const node of nodes) {
                        if (callback(node) === 2) break;
                    }
                }
            },
            camera: {}
        },
        resources: { color: 1, depth: null, sceneScale: 1 }
    } as unknown as ForwardRenderFeatureContext;
}

function createGPU(): {
    readonly gpu: RenderNodeGPUExtension;
    readonly record: ReturnType<
        typeof vi.fn<(...args: Parameters<RenderNodeGPUExtension['record']>) => unknown>
    >;
    readonly frameSubmitted: ReturnType<typeof vi.fn<(frameIndex: number) => unknown>>;
    readonly frameDiscarded: ReturnType<typeof vi.fn<(frameIndex: number) => unknown>>;
} {
    const record = vi.fn<(...args: Parameters<RenderNodeGPUExtension['record']>) => unknown>();
    const frameSubmitted = vi.fn<(frameIndex: number) => unknown>();
    const frameDiscarded = vi.fn<(frameIndex: number) => unknown>();
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
    for (const callback of ['frameSubmitted', 'frameDiscarded'] as const) {
        it(`finishes every ${callback} participant and clears the shared transaction on failure`, () => {
            const first = createGPU();
            const second = createGPU();
            const failure = new Error(`${callback} failed`);
            first[callback].mockImplementationOnce(() => {
                throw failure;
            });
            const [opaque, transparent] = createRuntimePair();
            const context = createRecordContext(first.gpu, second.gpu);
            opaque.record(context);
            transparent.record(context);

            expect(() => opaque[callback]?.(12)).toThrow(AggregateError);
            expect(first[callback]).toHaveBeenCalledExactlyOnceWith(12);
            expect(second[callback]).toHaveBeenCalledExactlyOnceWith(12);
            transparent[callback]?.(12);
            expect(first[callback]).toHaveBeenCalledOnce();
            expect(second[callback]).toHaveBeenCalledOnce();

            opaque.record(context);
            opaque[callback]?.(13);
            expect(first[callback]).toHaveBeenCalledTimes(2);
            expect(second[callback]).toHaveBeenCalledTimes(2);
        });

        it(`rejects asynchronous ${callback} without skipping remaining participants`, async () => {
            const first = createGPU();
            const second = createGPU();
            first[callback].mockImplementationOnce(() =>
                Promise.reject(new Error('late rejection'))
            );
            const [opaque, transparent] = createRuntimePair();
            opaque.record(createRecordContext(first.gpu, second.gpu));
            expect(() => opaque[callback]?.(14)).toThrow(AggregateError);
            transparent[callback]?.(14);
            expect(second[callback]).toHaveBeenCalledExactlyOnceWith(14);
            await Promise.resolve();
        });
    }

    it('rejects asynchronous record and still rolls back the participant', async () => {
        const { gpu, record, frameDiscarded } = createGPU();
        record.mockImplementationOnce(() => Promise.reject(new Error('late record rejection')));
        const [opaque] = createRuntimePair();
        expect(() => opaque.record(createRecordContext(gpu))).toThrow(/must be synchronous/u);
        opaque.frameDiscarded?.(15);
        expect(frameDiscarded).toHaveBeenCalledExactlyOnceWith(15);
        await Promise.resolve();
    });

    it('does not traverse unsupported GPU contributions for depth or split requirements', () => {
        const context = createRecordContext(createGPU().gpu);
        const traverse = vi.spyOn(context.pipeline.scene, 'traverse');
        const runtimes = createRuntimePair(false);
        for (const runtime of runtimes) {
            expect(runtime.requiresSampledDepth?.(context.pipeline)).toBe(false);
            expect(runtime.requiresSplitScene?.(context.pipeline)).toBe(false);
        }
        expect(traverse).not.toHaveBeenCalled();
    });

    it('queries shared depth only once and stops after the first qualifying contribution', () => {
        const first = { ...createGPU().gpu, requiresSampledDepth: true };
        const laterVisibility = vi.fn(() => true);
        const later = { ...first, hasPendingWork: false, isVisible: laterVisibility };
        const context = createRecordContext(first, later);
        const traverse = vi.spyOn(context.pipeline.scene, 'traverse');
        const [opaque, transparent] = createRuntimePair();
        expect(opaque.requiresSampledDepth?.(context.pipeline)).toBe(true);
        expect(transparent.requiresSampledDepth?.(context.pipeline)).toBe(false);
        expect(traverse).toHaveBeenCalledOnce();
        expect(laterVisibility).not.toHaveBeenCalled();
    });

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
