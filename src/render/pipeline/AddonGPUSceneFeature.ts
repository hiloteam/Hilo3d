import { withRasterViewport } from '../internal/RasterViewportScope';
import Node from '../../core/Node';
import { assertSynchronousResult } from '../internal/ScriptableRenderPipelineValidation';
import { getRenderNodeExtension, type RenderNodeGPUExtension } from './RenderNodeExtension';
import type {
    ForwardRenderFeatureContext,
    ForwardRenderPipelineFeature,
    ForwardRenderPipelineFeatureRuntime
} from './ForwardRenderPipeline';
import type { RenderPipelineContext, RenderPipelineCreateContext } from './RenderPipeline';

type ObservableGPUCallbacks = {
    [Key in 'record' | 'frameSubmitted' | 'frameDiscarded']: (
        ...args: Parameters<RenderNodeGPUExtension[Key]>
    ) => unknown;
};

class AddonGPUFrameTransaction {
    readonly #recorded = new Set<RenderNodeGPUExtension>();

    record(gpu: RenderNodeGPUExtension): void {
        this.#recorded.add(gpu);
    }

    submitted(frameIndex: number): void {
        this.finishFrame(frameIndex, 'frameSubmitted');
    }

    discarded(frameIndex: number): void {
        this.finishFrame(frameIndex, 'frameDiscarded');
    }

    clear(): void {
        this.#recorded.clear();
    }

    private finishFrame(frameIndex: number, callback: 'frameSubmitted' | 'frameDiscarded'): void {
        let errors: unknown[] | undefined;
        try {
            for (const gpu of this.#recorded) {
                try {
                    const callbacks: ObservableGPUCallbacks = gpu;
                    const result = callbacks[callback](frameIndex);
                    assertSynchronousResult(`Render node GPU ${callback}`, result);
                } catch (error) {
                    (errors ??= []).push(error);
                }
            }
        } finally {
            this.#recorded.clear();
        }
        if (errors !== undefined) {
            throw new AggregateError(errors, `Render node GPU ${callback} failed.`);
        }
    }
}

const pendingTransactions = new WeakMap<RenderPipelineCreateContext, AddonGPUFrameTransaction>();

class AddonGPUSceneFeatureRuntime implements ForwardRenderPipelineFeatureRuntime {
    readonly #supported: boolean;

    constructor(
        context: RenderPipelineCreateContext,
        readonly phase: 'opaque' | 'transparent',
        readonly transaction: AddonGPUFrameTransaction
    ) {
        this.#supported =
            context.capabilities.supportsCapability('storage-buffer') &&
            context.capabilities.supportsCapability('compute-pass') &&
            context.capabilities.supportsCapability('indirect-draw');
    }

    requiresSampledDepth(context: RenderPipelineContext): boolean {
        // Both phases share the same graph depth. Query it once before either records work.
        if (!this.#supported || this.phase !== 'opaque') return false;
        let required = false;
        context.scene.traverse(node => {
            const gpu = getRenderNodeExtension(node)?.gpu;
            if (
                gpu?.requiresSampledDepth === true &&
                (gpu.hasPendingWork || gpu.isVisible(context.camera))
            ) {
                required = true;
                return Node.TRAVERSE_STOP_ALL;
            }
            return Node.TRAVERSE_STOP_NONE;
        });
        return required;
    }

    requiresSplitScene(context: RenderPipelineContext): boolean {
        if (!this.#supported || this.phase !== 'opaque') return false;
        let required = false;
        context.scene.traverse(node => {
            const gpu = getRenderNodeExtension(node)?.gpu;
            if (gpu?.hasOpaqueRenderers === true && gpu.isVisible(context.camera)) {
                required = true;
                return Node.TRAVERSE_STOP_ALL;
            }
            return Node.TRAVERSE_STOP_NONE;
        });
        return required;
    }

    record(context: ForwardRenderFeatureContext): void {
        if (!this.#supported || context.resources.color === null) return;
        withRasterViewport(
            context.pipeline,
            this.phase === 'opaque' ? context.resources.sceneScale : 1,
            () => {
                context.pipeline.scene.traverse(node => {
                    const gpu = getRenderNodeExtension(node)?.gpu;
                    if (gpu === null || gpu === undefined) return;
                    if (this.phase === 'opaque' && !gpu.hasOpaqueRenderers) return;
                    this.transaction.record(gpu);
                    const callbacks: ObservableGPUCallbacks = gpu;
                    const result = callbacks.record(
                        context.pipeline,
                        context.resources.color as NonNullable<typeof context.resources.color>,
                        context.resources.depth,
                        gpu.isVisible(context.pipeline.camera),
                        this.phase
                    );
                    assertSynchronousResult('Render node GPU record', result);
                });
            }
        );
    }

    frameSubmitted(frameIndex: number): void {
        this.transaction.submitted(frameIndex);
    }

    frameDiscarded(frameIndex: number): void {
        this.transaction.discarded(frameIndex);
    }

    destroy(): void {
        this.transaction.clear();
    }
}

/** Built-in bridge for transparent GPU work supplied by optional scene-node addons. */
export const addonGPUSceneFeature: ForwardRenderPipelineFeature = Object.freeze({
    name: '__hilo3d-addon-gpu-scene',
    injectionPoint: 'after-transparent',
    requirements: Object.freeze({
        sampledSceneColor: false,
        sampledDepth: false,
        splitScene: false
    }),
    create(context: RenderPipelineCreateContext): ForwardRenderPipelineFeatureRuntime {
        const transaction = pendingTransactions.get(context);
        pendingTransactions.delete(context);
        if (transaction === undefined) {
            throw new Error('Addon GPU transparent feature was created without its opaque phase.');
        }
        return new AddonGPUSceneFeatureRuntime(context, 'transparent', transaction);
    }
});

/** Built-in bridge for opaque GPU work supplied by optional scene-node addons. */
export const addonGPUOpaqueSceneFeature: ForwardRenderPipelineFeature = Object.freeze({
    name: '__hilo3d-addon-gpu-scene-opaque',
    injectionPoint: 'after-opaque',
    requirements: Object.freeze({
        sampledSceneColor: false,
        sampledDepth: false,
        splitScene: false
    }),
    create(context: RenderPipelineCreateContext): ForwardRenderPipelineFeatureRuntime {
        const transaction = new AddonGPUFrameTransaction();
        pendingTransactions.set(context, transaction);
        return new AddonGPUSceneFeatureRuntime(context, 'opaque', transaction);
    }
});
