import type { RendererViewport } from '../../RendererCore';
import type StorageGraphicsShader from '../../compute/StorageGraphicsShader';
import type Mesh from '../../../core/Mesh';
import type { RendererListHandle } from '../RendererList';
import type {
    RenderGraphBufferHandle,
    RenderGraphTextureAccessHandle,
    RenderPipelineColorAttachment,
    RenderPipelineDepthStencilAttachment,
    ScriptableRenderPass,
    ScriptableRenderPassBuilder,
    ScriptableRenderPassContext
} from '../ScriptableRenderGraph';

function requireRuntimeArray(value: unknown, path: string): void {
    if (!Array.isArray(value)) throw new TypeError(`${path} must be an array`);
}

/** Fixed pass-global bind group reserved by storage-aware scene variants. */
export const SCENE_STORAGE_BIND_GROUP = 3;

/** One graph-buffer range bound to a readonly scene storage declaration. */
export interface SceneStorageBufferBinding {
    /** Setup-scoped graph buffer read by the raster shader. */
    readonly buffer: RenderGraphBufferHandle;
    /** Byte offset within the graph resource, defaulting to zero. */
    readonly byteOffset?: number;
    /** Bound byte length, defaulting to the remaining resource range. */
    readonly byteLength?: number;
}

/**
 * WebGPU-only shader override for an ordinary renderer list.
 *
 * The shader remains GLSL ES 3.10 compiled through the engine/Naga path and must place every
 * readonly storage binding in {@link SCENE_STORAGE_BIND_GROUP}. Groups zero through two remain
 * available to the existing pass/material/mesh uniform and sampled-resource ABI. This contract is
 * explicit: it does not automatically rewrite built-in Basic/PBR shader source.
 */
export interface SceneStorageShaderVariant {
    /** Default storage-aware shader and the canonical pass-global storage ABI. */
    readonly shader: StorageGraphicsShader;
    /**
     * Optional exact per-mesh variants applied without splitting the renderer list. This preserves
     * global transparent sorting while allowing geometry/material topology to select its compiled
     * shader. Every mapped shader must expose the same group-three readonly-storage ABI as
     * the default shader.
     */
    readonly shaderByMesh?: ReadonlyMap<Mesh, StorageGraphicsShader>;
    /** Positional ranges matching the shader's sorted readonly-storage binding order. */
    readonly buffers: readonly Readonly<SceneStorageBufferBinding>[];
}

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
    /**
     * Opaque scene color sampled by transmission/volume materials in this pass. The graph keeps
     * this input distinct from the active color attachment, preventing raster feedback.
     */
    readonly opaqueTexture?: RenderGraphTextureAccessHandle;
    /**
     * Screen-space ambient visibility sampled by built-in opaque PBR materials in this pass.
     * This pass-global input is mutually exclusive with `opaqueTexture`; opaque shading
     * consumes GTAO while later transmission shading consumes the captured opaque color.
     */
    readonly ambientOcclusionTexture?: RenderGraphTextureAccessHandle;
    /** Optional WebGPU-only storage-aware shader variant for the ordinary renderer-list path. */
    readonly storageShaderVariant?: Readonly<SceneStorageShaderVariant>;
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
        if (parameters.opaqueTexture !== undefined) {
            builder.readTexture(parameters.opaqueTexture);
        }
        if (parameters.ambientOcclusionTexture !== undefined) {
            if (parameters.opaqueTexture !== undefined) {
                throw new Error(
                    'SceneRenderPass cannot bind opaque color and ambient occlusion simultaneously'
                );
            }
            builder.readTexture(parameters.ambientOcclusionTexture);
        }
        const storageVariant = parameters.storageShaderVariant;
        if (storageVariant !== undefined) {
            requireRuntimeArray(storageVariant.buffers, 'Scene storage shader variant buffers');
            for (const resource of storageVariant.buffers) {
                builder.readBuffer(resource.buffer, 'storage');
            }
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
