import type { RenderGPUExtension } from './RenderExtension';
import type {
    ForwardRenderFeatureContext,
    ForwardRenderPipelineFeature,
    ForwardRenderPipelineFeatureRuntime
} from './ForwardRenderPipeline';
import type { RenderPipelineContext, RenderPipelineCreateContext } from './RenderPipeline';

class AddonGPUFrameTransaction {
    readonly #recorded = new Set<RenderGPUExtension>();

    record(gpu: RenderGPUExtension): void {
        this.#recorded.add(gpu);
    }

    submitted(frameIndex: number): void {
        for (const gpu of this.#recorded) gpu.frameSubmitted(frameIndex);
        this.#recorded.clear();
    }

    discarded(frameIndex: number): void {
        for (const gpu of this.#recorded) gpu.frameDiscarded(frameIndex);
        this.#recorded.clear();
    }

    clear(): void {
        this.#recorded.clear();
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
        let required = false;
        for (const extension of context.scene.extensions) {
            const gpu = extension.gpu;
            if (
                gpu?.requiresSampledDepth === true &&
                (gpu.hasPendingWork || gpu.isVisible(context.camera))
            ) {
                required = true;
            }
        }
        return required;
    }

    requiresSplitScene(context: RenderPipelineContext): boolean {
        if (!this.#supported || this.phase !== 'opaque') return false;
        let required = false;
        for (const extension of context.scene.extensions) {
            const gpu = extension.gpu;
            if (gpu?.hasOpaqueRenderers === true && gpu.isVisible(context.camera)) required = true;
        }
        return required;
    }

    record(context: ForwardRenderFeatureContext): void {
        if (!this.#supported || context.resources.color === null) return;
        for (const extension of context.pipeline.scene.extensions) {
            const gpu = extension.gpu;
            if (gpu === null) continue;
            if (this.phase === 'opaque' && !gpu.hasOpaqueRenderers) continue;
            this.transaction.record(gpu);
            gpu.record(
                context.pipeline,
                context.resources.color,
                context.resources.depth,
                gpu.isVisible(context.pipeline.camera),
                this.phase
            );
        }
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

/** Built-in bridge for transparent GPU work supplied by optional render extensions. */
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

/** Built-in bridge for opaque GPU work supplied by optional render extensions. */
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
