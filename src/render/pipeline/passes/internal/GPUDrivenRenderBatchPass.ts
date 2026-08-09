import type { RendererViewport } from '../../../RendererCore';
import type {
    RenderGraphBufferHandle,
    RenderGraphBufferReadUse,
    RenderGraphBufferWriteUse,
    RenderGraphPassHandle,
    RenderGraphTextureAccessHandle,
    RenderPipelineColorAttachment,
    RenderPipelineDepthStencilAttachment,
    ScriptableRenderPass,
    ScriptableRenderPassBuilder,
    ScriptableRenderPassContext
} from '../../ScriptableRenderGraph';
import type { RendererListHandle } from '../../RendererList';
import { GPUDrivenRenderPass, type GPUDrivenRenderPassParameters } from '../GPUDrivenRenderPass';

/** @internal Parallel pass/parameter arrays rendered inside one native render pass. */
export interface GPUDrivenRenderBatchPassParameters {
    readonly passes: readonly GPUDrivenRenderPass[];
    readonly parameters: readonly GPUDrivenRenderPassParameters[];
    readonly colorAttachments: readonly Readonly<RenderPipelineColorAttachment>[];
    readonly depthStencilAttachment?: Readonly<RenderPipelineDepthStencilAttachment>;
    readonly viewport?: RendererViewport;
    readonly scissor?: RendererViewport;
    readonly stencilReference?: number;
}

/**
 * Replays a GPUDrivenRenderPass setup while suppressing its per-draw attachment declarations.
 * The enclosing batch declares the shared attachments exactly once.
 */
class ResourceOnlyPassBuilder implements ScriptableRenderPassBuilder {
    #delegate: ScriptableRenderPassBuilder | null = null;

    bind(delegate: ScriptableRenderPassBuilder): void {
        if (this.#delegate !== null) throw new Error('GPU-driven batch builder is already active');
        this.#delegate = delegate;
    }

    release(): void {
        this.#delegate = null;
    }

    readTexture(texture: RenderGraphTextureAccessHandle): void {
        this.requireDelegate().readTexture(texture);
    }

    writeStorageTexture(texture: RenderGraphTextureAccessHandle): void {
        this.requireDelegate().writeStorageTexture(texture);
    }

    copyTexture(
        source: RenderGraphTextureAccessHandle,
        destination: RenderGraphTextureAccessHandle
    ): void {
        this.requireDelegate().copyTexture(source, destination);
    }

    readBuffer(buffer: RenderGraphBufferHandle, use: RenderGraphBufferReadUse): void {
        this.requireDelegate().readBuffer(buffer, use);
    }

    writeBuffer(buffer: RenderGraphBufferHandle, use: RenderGraphBufferWriteUse): void {
        this.requireDelegate().writeBuffer(buffer, use);
    }

    readWriteBuffer(buffer: RenderGraphBufferHandle): void {
        this.requireDelegate().readWriteBuffer(buffer);
    }

    copyBuffer(source: RenderGraphBufferHandle, destination: RenderGraphBufferHandle): void {
        this.requireDelegate().copyBuffer(source, destination);
    }

    clearBuffer(buffer: RenderGraphBufferHandle, byteOffset?: number, byteLength?: number): void {
        this.requireDelegate().clearBuffer(buffer, byteOffset, byteLength);
    }

    useColorAttachment(options: Readonly<RenderPipelineColorAttachment>): void {
        void options;
    }

    useDepthStencilAttachment(options: Readonly<RenderPipelineDepthStencilAttachment>): void {
        void options;
    }

    useRendererList(_list: RendererListHandle): void {
        throw new Error('GPU-driven batch entries cannot declare renderer lists');
    }

    dependsOn(pass: RenderGraphPassHandle): void {
        this.requireDelegate().dependsOn(pass);
    }

    markSideEffect(): void {
        this.requireDelegate().markSideEffect();
    }

    private requireDelegate(): ScriptableRenderPassBuilder {
        const delegate = this.#delegate;
        if (delegate === null) throw new Error('GPU-driven batch builder is inactive');
        return delegate;
    }
}

/** @internal Batches compatible GPU-driven draws behind one graph/native render pass. */
export class GPUDrivenRenderBatchPass implements ScriptableRenderPass<GPUDrivenRenderBatchPassParameters> {
    readonly name: string;
    readonly #resourceBuilder = new ResourceOnlyPassBuilder();

    constructor(name: string) {
        if (name.length === 0) throw new TypeError('GPU-driven batch pass name must be non-empty');
        this.name = name;
    }

    setup(
        builder: ScriptableRenderPassBuilder,
        parameters: GPUDrivenRenderBatchPassParameters
    ): void {
        if (parameters.passes.length === 0) {
            throw new RangeError('GPU-driven batch pass requires at least one draw');
        }
        if (parameters.passes.length !== parameters.parameters.length) {
            throw new RangeError('GPU-driven batch pass/parameter counts must match');
        }
        if (
            parameters.colorAttachments.length === 0 &&
            parameters.depthStencilAttachment === undefined
        ) {
            throw new RangeError('GPU-driven batch pass requires raster attachments');
        }

        this.#resourceBuilder.bind(builder);
        try {
            for (let index = 0; index < parameters.passes.length; index += 1) {
                const pass = parameters.passes[index];
                const drawParameters = parameters.parameters[index];
                if (!(pass instanceof GPUDrivenRenderPass) || drawParameters === undefined) {
                    throw new TypeError('GPU-driven batch entry is incomplete');
                }
                if (
                    drawParameters.viewport !== undefined ||
                    drawParameters.scissor !== undefined ||
                    drawParameters.stencilReference !== undefined
                ) {
                    throw new TypeError(
                        'GPU-driven batch entries must use the batch dynamic raster state'
                    );
                }
                this.validateAttachments(parameters, drawParameters, index);
                pass.setup(this.#resourceBuilder, drawParameters);
            }
        } finally {
            this.#resourceBuilder.release();
        }

        for (const attachment of parameters.colorAttachments) {
            builder.useColorAttachment(attachment);
        }
        if (parameters.depthStencilAttachment !== undefined) {
            builder.useDepthStencilAttachment(parameters.depthStencilAttachment);
        }
    }

    execute(
        context: ScriptableRenderPassContext,
        parameters: GPUDrivenRenderBatchPassParameters
    ): void {
        if (parameters.viewport !== undefined) context.commands.setViewport(parameters.viewport);
        if (parameters.scissor !== undefined) context.commands.setScissor(parameters.scissor);
        if (parameters.stencilReference !== undefined) {
            context.commands.setStencilReference(parameters.stencilReference);
        }
    }

    private validateAttachments(
        batch: GPUDrivenRenderBatchPassParameters,
        draw: GPUDrivenRenderPassParameters,
        drawIndex: number
    ): void {
        if (draw.colorAttachments.length !== batch.colorAttachments.length) {
            throw new RangeError(
                `GPU-driven batch draw ${String(drawIndex)} color attachment count differs from its batch`
            );
        }
        for (let index = 0; index < batch.colorAttachments.length; index += 1) {
            if (draw.colorAttachments[index]?.texture !== batch.colorAttachments[index]?.texture) {
                throw new TypeError(
                    `GPU-driven batch draw ${String(drawIndex)} color attachment identity differs from its batch`
                );
            }
        }
        if (
            draw.depthStencilAttachment?.texture !== batch.depthStencilAttachment?.texture ||
            (draw.depthStencilAttachment === undefined) !==
                (batch.depthStencilAttachment === undefined)
        ) {
            throw new TypeError(
                `GPU-driven batch draw ${String(drawIndex)} depth attachment differs from its batch`
            );
        }
    }
}
