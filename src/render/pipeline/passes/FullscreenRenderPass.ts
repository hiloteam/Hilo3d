import Material from '../../../material/Material';
import Shader from '../../../shader/Shader';
import type UniformBuffer from '../../UniformBuffer';
import type { RendererViewport } from '../../RendererCore';
import type {
    RenderGraphTextureAccessHandle,
    RenderPipelineColorAttachment,
    RenderPipelineDepthStencilAttachment,
    ScriptableRenderPass,
    ScriptableRenderPassBuilder,
    ScriptableRenderPassContext
} from '../ScriptableRenderGraph';
import { PORTABLE_FULLSCREEN_VERTEX_SOURCE } from './internal/PortableFullscreenShader';

/** Immutable shader and binding configuration for a fullscreen pass instance. */
export interface FullscreenRenderPassOptions {
    /** Optional diagnostic pass name. */
    readonly name?: string;
    /** GLSL ES 3.00 shader with no vertex attributes. */
    readonly shader: Shader;
    /** Fixed raster, depth, blend, and culling state. */
    readonly material: Material;
    /** std140 buffers in reflected uniform-block order. */
    readonly uniformBuffers?: readonly UniformBuffer[];
}

/** Frame-scoped graph resources and dynamic state for one fullscreen draw. */
export interface FullscreenRenderPassParameters {
    /** Linear-filterable sampled textures in reflected sampler order. */
    readonly inputTextures: readonly RenderGraphTextureAccessHandle[];
    /** Color attachments in fragment-output location order. */
    readonly colorAttachments: readonly Readonly<RenderPipelineColorAttachment>[];
    /** Optional depth/stencil attachment. */
    readonly depthStencilAttachment?: Readonly<RenderPipelineDepthStencilAttachment>;
    /** Optional execution viewport in physical attachment pixels. */
    readonly viewport?: RendererViewport;
    /** Optional execution scissor in physical attachment pixels. */
    readonly scissor?: RendererViewport;
    /** Optional unsigned stencil reference. */
    readonly stencilReference?: number;
}

/**
 * Draws a `gl_VertexID` fullscreen triangle with graph textures resolved during prepare.
 *
 * The vertex shader must declare no vertex attributes. GLSL samplers and registered std140
 * blocks are matched to the fixed arrays captured by this pass instance. Input formats must
 * support filterable sampling because the shared fullscreen path uses one fixed linear sampler.
 */
export class FullscreenRenderPass implements ScriptableRenderPass<FullscreenRenderPassParameters> {
    /** Stable diagnostic pass name. */
    readonly name: string;
    /** Shader compiled through the shared GLSL-to-backend pipeline. */
    readonly shader: Shader;
    /** Fixed material state for the fullscreen triangle. */
    readonly material: Material;
    /** Uniform buffers in reflected block order. */
    readonly uniformBuffers: readonly UniformBuffer[];

    constructor(options: Readonly<FullscreenRenderPassOptions>) {
        const candidate: unknown = options;
        if (
            (typeof candidate !== 'object' && typeof candidate !== 'function') ||
            candidate === null
        ) {
            throw new TypeError('Fullscreen render pass options must be an object');
        }
        if (!(options.shader instanceof Shader)) {
            throw new TypeError('Fullscreen render pass requires a Shader');
        }
        if (!(options.material instanceof Material)) {
            throw new TypeError('Fullscreen render pass requires a Material');
        }
        const name = options.name ?? 'FullscreenRenderPass';
        if (typeof name !== 'string' || name.length === 0) {
            throw new TypeError('Fullscreen render pass name must be non-empty');
        }
        this.name = name;
        this.shader = options.shader;
        this.material = options.material;
        this.uniformBuffers = Object.freeze([...(options.uniformBuffers ?? [])]);
    }

    /** Declare sampled inputs and raster attachments. */
    setup(builder: ScriptableRenderPassBuilder, parameters: FullscreenRenderPassParameters): void {
        if (parameters.colorAttachments.length === 0) {
            throw new Error('FullscreenRenderPass requires at least one color attachment');
        }
        for (const input of parameters.inputTextures) builder.readTexture(input);
        for (const attachment of parameters.colorAttachments) {
            builder.useColorAttachment(attachment);
        }
        if (parameters.depthStencilAttachment !== undefined) {
            builder.useDepthStencilAttachment(parameters.depthStencilAttachment);
        }
    }

    /** Apply optional dynamic state; the framework emits the prepared triangle afterward. */
    execute(
        context: ScriptableRenderPassContext,
        parameters: FullscreenRenderPassParameters
    ): void {
        if (parameters.viewport !== undefined) {
            context.commands.setViewport(parameters.viewport);
        }
        if (parameters.scissor !== undefined) context.commands.setScissor(parameters.scissor);
        if (parameters.stencilReference !== undefined) {
            context.commands.setStencilReference(parameters.stencilReference);
        }
    }
}

const PRESENT_FRAGMENT_SOURCE = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;
layout(location = 0) out vec4 color;
void main() {
    color = texture(u_source, v_uv);
}`;

/** Fullscreen graph-texture present pass with one fixed linear sampler. */
export class PresentRenderPass extends FullscreenRenderPass {
    constructor(name = 'PresentRenderPass') {
        super({
            name,
            shader: new Shader({
                vs: PORTABLE_FULLSCREEN_VERTEX_SOURCE,
                fs: PRESENT_FRAGMENT_SOURCE
            }),
            material: new Material({ depthTest: false, depthMask: false, cullFace: false })
        });
    }
}
