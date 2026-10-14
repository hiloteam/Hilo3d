import { requiresStableDepthComposition } from '../../internal/StableRasterCamera';
import Mesh from '../../../core/Mesh';
import Node from '../../../core/Node';
import { getRenderNodeExtension } from '../RenderNodeExtension';
import { TransparentTemporalController } from '../../postprocessing/TransparentTemporal';
import type { RenderPipelineContext } from '../RenderPipeline';
import { RenderPassParameterPool } from '../RenderPassParameterPool';
import { SceneRenderPass, type SceneRenderPassParameters } from '../passes/SceneRenderPass';
import type { CullingResultsHandle } from '../RendererList';
import type { RenderGraphTextureHandle } from '../ScriptableRenderGraph';
import { depthClearValue } from '../../renderer/DepthConvention';
import {
    renderTargetFormatHasStencil,
    type RenderTargetDepthStencilFormat
} from '../../RenderTarget';

/** @internal Re-rasterize opaque coverage on the final output grid for post-TAA depth tests. */
export class StableTransparentDepth {
    readonly #compositionKey = {};
    readonly #scratch = new TransparentTemporalController();
    readonly #pass = new SceneRenderPass('Stable transparent opaque depth');
    readonly #parameters = new RenderPassParameterPool<SceneRenderPassParameters>(() => ({
        rendererList: 0 as SceneRenderPassParameters['rendererList'],
        colorAttachments: []
    }));

    recordGPUOpaque(context: RenderPipelineContext, depth: RenderGraphTextureHandle): void {
        let color: RenderGraphTextureHandle | null = null;
        context.scene.traverse(node => {
            const gpu = getRenderNodeExtension(node)?.gpu;
            if (gpu?.hasOpaqueRenderers !== true || !gpu.isVisible(context.camera)) return;
            color ??= this.#scratch.createParticleOverlay(context);
            // The normal opaque phase already enlisted the addon transaction. Replaying draws
            // in the same application frame does not repeat its simulation.
            gpu.record(context, color, depth, true, 'opaque');
        });
    }

    destroy(): void {
        this.#scratch.destroy();
    }

    record(
        context: RenderPipelineContext,
        cullingResults: CullingResultsHandle,
        format: RenderTargetDepthStencilFormat = 'depth32float'
    ): RenderGraphTextureHandle {
        const composed = requiresStableDepthComposition(context);
        const depth = composed
            ? context.graph.acquirePersistentTarget(this.#compositionKey, {
                  label: 'Stable transparent composed opaque depth',
                  colorFormats: [],
                  depthStencilFormat: format,
                  depthStencilSampled: true,
                  extent: { relativeTo: 'output', scale: 1 },
                  sampleCount: 1
              }).depthStencil
            : context.graph.createTexture('Stable transparent opaque depth', {
                  format,
                  extent: { relativeTo: 'output', scale: 1 },
                  sampleCount: 1
              });
        if (depth === null) throw new Error('Stable composed depth is unavailable');
        const policy = composed ? context.output.depthStencilAttachment : null;
        const parameters = context.acquirePassParameters(this.#parameters);
        // Parameters are owned by this frame's pool slot and remain immutable after recording.
        Object.assign(parameters, {
            rendererList: context.createRendererList({
                cullingResults,
                queue: 'opaque',
                sorting: 'material-front-to-back',
                materialPass: 'depth-only'
            }),
            depthStencilAttachment: {
                texture: depth,
                depthLoadOp: policy?.depthLoadOp ?? 'clear',
                depthStoreOp: 'store',
                depthClearValue: depthClearValue(context.camera.depthMode),
                ...(renderTargetFormatHasStencil(format)
                    ? {
                          stencilLoadOp: policy?.stencilLoadOp ?? 'clear',
                          stencilStoreOp: 'store',
                          stencilClearValue: policy?.stencilClearValue ?? 0
                      }
                    : {})
            }
        });
        context.graph.addPass(this.#pass, parameters);
        return depth;
    }
}

/** @internal Avoid stable-grid allocations for a view without any visible post-resolve surface. */
export function hasVisiblePostResolveDraws(context: RenderPipelineContext): boolean {
    let found = false;
    context.scene.traverse(node => {
        if (found || !node.visible) return Node.TRAVERSE_STOP_CHILDREN;
        const gpu = getRenderNodeExtension(node)?.gpu;
        if (gpu?.isVisible(context.camera) === true) found = true;
        if (
            node instanceof Mesh &&
            !node.isDestroyed &&
            node.geometry !== null &&
            node.material?.forwardQueue === 'transparent' &&
            context.camera.isLayerVisible(node) &&
            (!node.frustumTest || context.camera.isMeshVisible(node))
        )
            found = true;
        return undefined;
    });
    return found;
}
