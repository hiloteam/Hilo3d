import type { RenderPipelineContext } from '../RenderPipeline';
import type { CullingResultsHandle } from '../RendererList';

/** Parameters consumed by {@link ShadowRenderPass}. */
export interface ShadowRenderPassParameters {
    /** Shared culling results whose lights and visible shadow casters populate the atlas. */
    readonly cullingResults: CullingResultsHandle;
}

/**
 * Records the renderer's shared shadow-atlas pass set.
 *
 * A shadow atlas can expand to several graph passes, so this primitive records directly through
 * {@link RenderPipelineContext} instead of masquerading as one `ScriptableRenderPass` node.
 */
export class ShadowRenderPass {
    /** Stable diagnostic name for shadow recording failures. */
    readonly name: string;

    constructor(name = 'ShadowRenderPass') {
        if (typeof name !== 'string' || name.length === 0) {
            throw new TypeError('Shadow render pass name must be non-empty');
        }
        this.name = name;
    }

    /** Record all required atlas slices synchronously. */
    record(context: RenderPipelineContext, parameters: Readonly<ShadowRenderPassParameters>): void {
        context.recordShadows(parameters.cullingResults);
    }
}
