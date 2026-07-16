import type {
    RenderGraphTextureHandle,
    ScriptableRenderPass,
    ScriptableRenderPassBuilder,
    ScriptableRenderPassContext
} from '../ScriptableRenderGraph';

/** Full-subresource texture copy parameters. Both textures must have matching descriptors. */
export interface TextureCopyPassParameters {
    /** Initialized single-sample copy source. */
    readonly source: RenderGraphTextureHandle;
    /** Same-format, same-extent single-sample copy destination. */
    readonly destination: RenderGraphTextureHandle;
}

/** Portable full-texture copy pass emitted through the selected RHI backend. */
export class TextureCopyPass implements ScriptableRenderPass<TextureCopyPassParameters> {
    /** Stable diagnostic pass name. */
    readonly name: string;

    constructor(name = 'TextureCopyPass') {
        if (typeof name !== 'string' || name.length === 0) {
            throw new TypeError('Texture copy pass name must be non-empty');
        }
        this.name = name;
    }

    /** Declare the copy source and destination. */
    setup(builder: ScriptableRenderPassBuilder, parameters: TextureCopyPassParameters): void {
        builder.copyTexture(parameters.source, parameters.destination);
    }

    /** Emit one portable full-texture copy. */
    execute(context: ScriptableRenderPassContext, parameters: TextureCopyPassParameters): void {
        context.commands.copyTexture(parameters.source, parameters.destination);
    }
}
