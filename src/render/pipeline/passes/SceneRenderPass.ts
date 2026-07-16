import type { RendererViewport } from '../../RendererCore';
import type { RendererListHandle } from '../RendererList';
import type {
    RenderPipelineColorAttachment,
    RenderPipelineDepthStencilAttachment,
    ScriptableRenderPass,
    ScriptableRenderPassBuilder,
    ScriptableRenderPassContext
} from '../ScriptableRenderGraph';

/** Retained parameters consumed by {@link SceneRenderPass}. */
export interface SceneRenderPassParameters {
    /** One setup-declared renderer list prepared through the shared mesh draw processor. */
    readonly rendererList: RendererListHandle;
    /** Continuous color attachments in fragment-output location order. */
    readonly colorAttachments: readonly Readonly<RenderPipelineColorAttachment>[];
    /** Optional depth/stencil attachment shared by every draw in the list. */
    readonly depthStencilAttachment?: Readonly<RenderPipelineDepthStencilAttachment>;
    /** Optional execution viewport in physical attachment pixels. */
    readonly viewport?: RendererViewport;
    /** Optional execution scissor in physical attachment pixels. */
    readonly scissor?: RendererViewport;
    /** Optional unsigned stencil reference set before drawing the list. */
    readonly stencilReference?: number;
}

/**
 * Stable scene pass backed by `SharedDrawPassParameters` and `MeshDrawProcessor`.
 *
 * The instance is reusable. Parameters remain caller-owned and must come from a
 * {@link RenderPassParameterPool} when the pass is recorded every frame.
 */
export class SceneRenderPass implements ScriptableRenderPass<SceneRenderPassParameters> {
    /** Stable diagnostic pass name. */
    readonly name: string;

    constructor(name = 'SceneRenderPass') {
        if (typeof name !== 'string' || name.length === 0) {
            throw new TypeError('Scene render pass name must be non-empty');
        }
        this.name = name;
    }

    /** Declare attachments and the renderer list without issuing commands. */
    setup(builder: ScriptableRenderPassBuilder, parameters: SceneRenderPassParameters): void {
        if (
            parameters.colorAttachments.length === 0 &&
            parameters.depthStencilAttachment === undefined
        ) {
            throw new Error('SceneRenderPass requires at least one attachment');
        }
        for (const attachment of parameters.colorAttachments) {
            builder.useColorAttachment(attachment);
        }
        if (parameters.depthStencilAttachment !== undefined) {
            builder.useDepthStencilAttachment(parameters.depthStencilAttachment);
        }
        builder.useRendererList(parameters.rendererList);
    }

    /** Apply optional dynamic state and draw the setup-declared renderer list. */
    execute(context: ScriptableRenderPassContext, parameters: SceneRenderPassParameters): void {
        if (parameters.viewport !== undefined) {
            context.commands.setViewport(parameters.viewport);
        }
        if (parameters.scissor !== undefined) context.commands.setScissor(parameters.scissor);
        if (parameters.stencilReference !== undefined) {
            context.commands.setStencilReference(parameters.stencilReference);
        }
        context.commands.drawRendererList(parameters.rendererList);
    }
}
