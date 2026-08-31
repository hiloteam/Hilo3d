import { getRenderNodeExtension, type RenderNodeGPUExtension } from './RenderNodeExtension';
import type {
    ForwardRenderFeatureContext,
    ForwardRenderPipelineFeature,
    ForwardRenderPipelineFeatureRuntime
} from './ForwardRenderPipeline';
import type { RenderPipelineContext, RenderPipelineCreateContext } from './RenderPipeline';

class AddonGPUSceneFeatureRuntime implements ForwardRenderPipelineFeatureRuntime {
    readonly #supported: boolean;
    readonly #recorded = new Set<RenderNodeGPUExtension>();

    constructor(
        context: RenderPipelineCreateContext,
        readonly phase: 'opaque' | 'transparent'
    ) {
        this.#supported =
            context.capabilities.supportsCapability('storage-buffer') &&
            context.capabilities.supportsCapability('compute-pass') &&
            context.capabilities.supportsCapability('indirect-draw');
    }

    requiresSampledDepth(context: RenderPipelineContext): boolean {
        let required = false;
        context.scene.traverse(node => {
            const gpu = getRenderNodeExtension(node)?.gpu;
            if (
                gpu?.requiresSampledDepth === true &&
                (gpu.hasPendingWork || gpu.isVisible(context.camera))
            ) {
                required = true;
            }
        });
        return required;
    }

    requiresSplitScene(context: RenderPipelineContext): boolean {
        if (!this.#supported || this.phase !== 'opaque') return false;
        let required = false;
        context.scene.traverse(node => {
            const gpu = getRenderNodeExtension(node)?.gpu;
            if (gpu?.hasOpaqueRenderers === true && gpu.isVisible(context.camera)) required = true;
        });
        return required;
    }

    record(context: ForwardRenderFeatureContext): void {
        if (!this.#supported || context.resources.color === null) return;
        context.pipeline.scene.traverse(node => {
            const gpu = getRenderNodeExtension(node)?.gpu;
            if (gpu === null || gpu === undefined) return;
            if (this.phase === 'opaque' && !gpu.hasOpaqueRenderers) return;
            gpu.record(
                context.pipeline,
                context.resources.color as NonNullable<typeof context.resources.color>,
                context.resources.depth,
                gpu.isVisible(context.pipeline.camera),
                this.phase
            );
            this.#recorded.add(gpu);
        });
    }

    frameSubmitted(frameIndex: number): void {
        for (const gpu of this.#recorded) gpu.frameSubmitted(frameIndex);
        this.#recorded.clear();
    }

    frameDiscarded(frameIndex: number): void {
        for (const gpu of this.#recorded) gpu.frameDiscarded(frameIndex);
        this.#recorded.clear();
    }

    destroy(): void {
        this.#recorded.clear();
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
        return new AddonGPUSceneFeatureRuntime(context, 'transparent');
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
        return new AddonGPUSceneFeatureRuntime(context, 'opaque');
    }
});
