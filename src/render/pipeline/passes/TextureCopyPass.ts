import type {
    RenderGraphTextureAccessHandle,
    ScriptableRenderPass,
    ScriptableRenderPassBuilder,
    ScriptableRenderPassContext
} from '../ScriptableRenderGraph';

/** Full selected-subresource copy parameters. Views may have different parent descriptors. */
export interface TextureCopyPassParameters {
    /** Initialized single-sample copy source. */
    readonly source: RenderGraphTextureAccessHandle;
    /** Same-format, same-extent single-sample copy destination. */
    readonly destination: RenderGraphTextureAccessHandle;
}

/** Portable full selected-subresource copy pass emitted through the selected RHI backend. */
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
