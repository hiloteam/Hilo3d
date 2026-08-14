import ParticleSystem from '../ParticleSystem';
import type {
    ForwardRenderFeatureContext,
    ForwardRenderPipelineFeature,
    ForwardRenderPipelineFeatureRuntime
} from '../../render/pipeline/ForwardRenderPipeline';
import type {
    RenderPipelineContext,
    RenderPipelineCreateContext
} from '../../render/pipeline/RenderPipeline';

class ParticleGPUForwardFeatureRuntime implements ForwardRenderPipelineFeatureRuntime {
    readonly #supported: boolean;
    readonly #recordedSystems = new Set<ParticleSystem>();

    constructor(context: RenderPipelineCreateContext) {
        this.#supported =
            context.capabilities.supportsCapability('storage-buffer') &&
            context.capabilities.supportsCapability('compute-pass') &&
            context.capabilities.supportsCapability('indirect-draw');
    }

    requiresSampledDepth(context: RenderPipelineContext): boolean {
        let required = false;
        context.scene.traverse(node => {
            if (node instanceof ParticleSystem && node.requiresGPUSampledDepth) required = true;
        });
        return required;
    }

    record(context: ForwardRenderFeatureContext): void {
        if (!this.#supported || context.resources.color === null) return;
        context.pipeline.scene.traverse(node => {
            if (!(node instanceof ParticleSystem) || !node.hasGPUEmitters) return;
            const drawVisible = node.visible && context.pipeline.camera.isLayerVisible(node);
            node.recordGPU(
                context.pipeline,
                context.resources.color as NonNullable<typeof context.resources.color>,
                context.resources.depth,
                drawVisible
            );
            this.#recordedSystems.add(node);
        });
    }

    frameSubmitted(frameIndex: number): void {
        for (const system of this.#recordedSystems) system.gpuFrameSubmitted(frameIndex);
        this.#recordedSystems.clear();
    }

    frameDiscarded(frameIndex: number): void {
        for (const system of this.#recordedSystems) system.gpuFrameDiscarded(frameIndex);
        this.#recordedSystems.clear();
    }

    destroy(): void {
        this.#recordedSystems.clear();
    }
}

/** Built-in optional GPU particle graph stage; it is inert on portable WebGL 2 renderers. */
export const particleGPUForwardFeature: ForwardRenderPipelineFeature = Object.freeze({
    name: '__hilo3d-gpu-particles',
    injectionPoint: 'after-transparent',
    requirements: Object.freeze({
        sampledSceneColor: false,
        sampledDepth: false,
        splitScene: false
    }),
    create(context: RenderPipelineCreateContext): ForwardRenderPipelineFeatureRuntime {
        return new ParticleGPUForwardFeatureRuntime(context);
    }
});
