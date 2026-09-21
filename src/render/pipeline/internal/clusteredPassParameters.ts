import type Mesh from '../../../core/Mesh';
import type ComputeSampler from '../../compute/ComputeSampler';
import type StorageGraphicsShader from '../../compute/StorageGraphicsShader';
import type { GPUDrivenRenderBatchPassParameters } from '../passes/internal/GPUDrivenRenderBatchPass';
import type {
    CullingResultsHandle,
    RendererListDescriptor,
    RendererListHandle
} from '../RendererList';
import type {
    GPUDrivenRenderPass,
    ComputeRenderPassParameters,
    FullscreenRenderPassParameters,
    GPUDrivenRenderPassParameters,
    SceneRenderPassParameters,
    SceneStorageBufferBinding,
    SceneStorageShaderVariant,
    TextureCopyPassParameters
} from '../passes';
import type {
    RenderGraphBufferHandle,
    RenderGraphTextureAccessHandle,
    RenderGraphTextureHandle,
    RenderPipelineColorAttachment,
    RenderPipelineDepthStencilAttachment,
    ScriptableRenderPass,
    ScriptableRenderPassBuilder,
    ScriptableRenderPassContext
} from '../ScriptableRenderGraph';

/** Reusable mutable graph parameters. Their lifetime remains owned by the pipeline parameter pools. */

export const INVALID_BUFFER = 0 as RenderGraphBufferHandle;

const INVALID_TEXTURE = 0 as RenderGraphTextureHandle;

export const INVALID_CULLING_RESULTS = 0 as CullingResultsHandle;

const INVALID_RENDERER_LIST = 0 as RendererListHandle;

interface ClearRange {
    buffer: RenderGraphBufferHandle;
    byteOffset: number;
    byteLength: number;
}

export class ClearBuffersParameters {
    readonly ranges: ClearRange[] = [];
    count = 0;

    reset(): void {
        this.count = 0;
    }

    add(buffer: RenderGraphBufferHandle, byteOffset: number, byteLength: number): void {
        let range = this.ranges[this.count];
        if (range === undefined) {
            range = { buffer, byteOffset, byteLength };
            this.ranges.push(range);
        }
        range.buffer = buffer;
        range.byteOffset = byteOffset;
        range.byteLength = byteLength;
        this.count++;
    }
}

export class ClearBuffersPass implements ScriptableRenderPass<ClearBuffersParameters> {
    readonly name = 'GPU Scene and cluster counter clear';

    setup(builder: ScriptableRenderPassBuilder, parameters: ClearBuffersParameters): void {
        for (let index = 0; index < parameters.count; index += 1) {
            const range = parameters.ranges[index];
            if (range !== undefined) {
                builder.clearBuffer(range.buffer, range.byteOffset, range.byteLength);
            }
        }
    }

    execute(context: ScriptableRenderPassContext, parameters: ClearBuffersParameters): void {
        for (let index = 0; index < parameters.count; index += 1) {
            const range = parameters.ranges[index];
            if (range !== undefined) {
                context.commands.clearBuffer(range.buffer, range.byteOffset, range.byteLength);
            }
        }
    }
}

interface MutableBufferBinding {
    buffer: RenderGraphBufferHandle;
    byteOffset?: number;
    byteLength?: number;
}

interface MutableTextureBinding {
    texture: RenderGraphTextureAccessHandle;
}

export class MutableComputeParameters implements ComputeRenderPassParameters {
    readonly buffers: MutableBufferBinding[];
    readonly textures: MutableTextureBinding[];
    dispatch: { x: number; y: number; z: number } = { x: 1, y: 1, z: 1 };

    constructor(bufferCount: number, textureCount: number) {
        this.buffers = Array.from({ length: bufferCount }, () => ({ buffer: INVALID_BUFFER }));
        this.textures = Array.from({ length: textureCount }, () => ({ texture: INVALID_TEXTURE }));
    }

    setBuffer(index: number, buffer: RenderGraphBufferHandle): void {
        const binding = this.buffers[index];
        if (binding === undefined) throw new RangeError('Compute buffer slot is unavailable');
        binding.buffer = buffer;
        delete binding.byteOffset;
        delete binding.byteLength;
    }

    setBufferRange(
        index: number,
        buffer: RenderGraphBufferHandle,
        byteOffset: number,
        byteLength: number
    ): void {
        const binding = this.buffers[index];
        if (binding === undefined) throw new RangeError('Compute buffer slot is unavailable');
        binding.buffer = buffer;
        binding.byteOffset = byteOffset;
        binding.byteLength = byteLength;
    }

    setTexture(index: number, texture: RenderGraphTextureAccessHandle): void {
        const binding = this.textures[index];
        if (binding === undefined) throw new RangeError('Compute texture slot is unavailable');
        binding.texture = texture;
    }

    setDispatch(x: number, y = 1, z = 1): void {
        this.dispatch.x = x;
        this.dispatch.y = y;
        this.dispatch.z = z;
    }
}

export class MutableGPUDrivenParameters implements GPUDrivenRenderPassParameters {
    readonly buffers: MutableBufferBinding[];
    readonly vertexBuffers: MutableBufferBinding[];
    readonly textures: MutableTextureBinding[] = [];
    readonly samplers: ComputeSampler[] = [];
    indexBuffer: MutableBufferBinding = { buffer: INVALID_BUFFER };
    draw: {
        kind: 'draw-indexed-indirect';
        buffer: RenderGraphBufferHandle;
        byteOffset: number;
    } = { kind: 'draw-indexed-indirect', buffer: INVALID_BUFFER, byteOffset: 0 };
    readonly colorAttachments: RenderPipelineColorAttachment[] = [];
    depthStencilAttachment?: RenderPipelineDepthStencilAttachment;

    constructor(bufferCount: number, vertexBufferCount: number) {
        this.buffers = Array.from({ length: bufferCount }, () => ({ buffer: INVALID_BUFFER }));
        this.vertexBuffers = Array.from({ length: vertexBufferCount }, () => ({
            buffer: INVALID_BUFFER
        }));
    }

    configure(vertexBufferCount: number, textureCount: number): void {
        while (this.vertexBuffers.length < vertexBufferCount) {
            this.vertexBuffers.push({ buffer: INVALID_BUFFER });
        }
        this.vertexBuffers.length = vertexBufferCount;
        while (this.textures.length < textureCount) {
            this.textures.push({ texture: INVALID_TEXTURE });
        }
        this.textures.length = textureCount;
        this.samplers.length = textureCount;
    }

    configureStorageBufferCount(bufferCount: number): void {
        while (this.buffers.length < bufferCount) {
            this.buffers.push({ buffer: INVALID_BUFFER });
        }
        this.buffers.length = bufferCount;
    }

    setBuffer(index: number, buffer: RenderGraphBufferHandle): void {
        const binding = this.buffers[index];
        if (binding === undefined) throw new RangeError('GPU-driven buffer slot is unavailable');
        binding.buffer = buffer;
        delete binding.byteOffset;
        delete binding.byteLength;
    }

    setBufferRange(
        index: number,
        buffer: RenderGraphBufferHandle,
        byteOffset: number,
        byteLength: number
    ): void {
        const binding = this.buffers[index];
        if (binding === undefined) throw new RangeError('GPU-driven buffer slot is unavailable');
        binding.buffer = buffer;
        binding.byteOffset = byteOffset;
        binding.byteLength = byteLength;
    }

    setVertexBuffer(index: number, buffer: RenderGraphBufferHandle): void {
        const binding = this.vertexBuffers[index];
        if (binding === undefined) {
            throw new RangeError('GPU-driven vertex-buffer slot is unavailable');
        }
        binding.buffer = buffer;
    }

    setTexture(index: number, texture: RenderGraphTextureAccessHandle): void {
        const binding = this.textures[index];
        if (binding === undefined) throw new RangeError('GPU-driven texture slot is unavailable');
        binding.texture = texture;
    }
}

export class MutableVirtualShadowClearParameters implements GPUDrivenRenderPassParameters {
    readonly buffers: MutableBufferBinding[] = [
        { buffer: INVALID_BUFFER },
        { buffer: INVALID_BUFFER }
    ];
    readonly colorAttachments: RenderPipelineColorAttachment[] = [];
    draw: {
        kind: 'draw-indirect';
        buffer: RenderGraphBufferHandle;
        byteOffset: number;
    } = { kind: 'draw-indirect', buffer: INVALID_BUFFER, byteOffset: 0 };
    depthStencilAttachment?: RenderPipelineDepthStencilAttachment;

    setBuffer(index: number, buffer: RenderGraphBufferHandle): void {
        const binding = this.buffers[index];
        if (binding === undefined) throw new RangeError('Virtual shadow clear buffer is missing');
        binding.buffer = buffer;
        delete binding.byteOffset;
        delete binding.byteLength;
    }

    setBufferRange(
        index: number,
        buffer: RenderGraphBufferHandle,
        byteOffset: number,
        byteLength: number
    ): void {
        const binding = this.buffers[index];
        if (binding === undefined) throw new RangeError('Virtual shadow clear buffer is missing');
        binding.buffer = buffer;
        binding.byteOffset = byteOffset;
        binding.byteLength = byteLength;
    }
}

export class MutableGPUDrivenBatchParameters implements GPUDrivenRenderBatchPassParameters {
    readonly passes: GPUDrivenRenderPass[] = [];
    readonly parameters: GPUDrivenRenderPassParameters[] = [];
    readonly colorAttachments: RenderPipelineColorAttachment[] = [];
    depthStencilAttachment?: RenderPipelineDepthStencilAttachment;
    viewport?: readonly [number, number, number, number];
    scissor?: readonly [number, number, number, number];

    add(pass: GPUDrivenRenderPass, parameters: GPUDrivenRenderPassParameters): void {
        this.passes.push(pass);
        this.parameters.push(parameters);
    }

    reset(): void {
        this.passes.length = 0;
        this.parameters.length = 0;
        this.colorAttachments.length = 0;
        delete this.depthStencilAttachment;
        delete this.viewport;
        delete this.scissor;
    }
}

export class MutableFullscreenParameters implements FullscreenRenderPassParameters {
    readonly inputTextures: RenderGraphTextureAccessHandle[] = [];
    readonly colorAttachments: RenderPipelineColorAttachment[] = [
        { texture: INVALID_TEXTURE, loadOp: 'clear', storeOp: 'store' }
    ];
}

interface MutableFallbackColorAttachment {
    texture: RenderGraphTextureHandle;
    loadOp: 'load';
    storeOp: 'store';
}

export class MutableFallbackSceneParameters implements SceneRenderPassParameters {
    rendererList = INVALID_RENDERER_LIST;
    readonly colorAttachments: MutableFallbackColorAttachment[] = [
        { texture: INVALID_TEXTURE, loadOp: 'load', storeOp: 'store' }
    ];
    depthStencilAttachment?: RenderPipelineDepthStencilAttachment;
    opaqueTexture?: RenderGraphTextureHandle;
    ambientOcclusionTexture?: RenderGraphTextureHandle;
    storageShaderVariant?: Readonly<SceneStorageShaderVariant>;

    reset(): void {
        this.rendererList = INVALID_RENDERER_LIST;
        this.colorAttachments.length = 1;
        delete this.depthStencilAttachment;
        delete this.opaqueTexture;
        delete this.ambientOcclusionTexture;
        delete this.storageShaderVariant;
    }
}

export class MutableFallbackDepthParameters implements SceneRenderPassParameters {
    rendererList = INVALID_RENDERER_LIST;
    readonly colorAttachments = Object.freeze([]);
    depthStencilAttachment?: RenderPipelineDepthStencilAttachment;

    reset(): void {
        this.rendererList = INVALID_RENDERER_LIST;
        delete this.depthStencilAttachment;
    }
}

export class MutableFallbackTextureCopyParameters implements TextureCopyPassParameters {
    source = INVALID_TEXTURE;
    destination = INVALID_TEXTURE;

    reset(): void {
        this.source = INVALID_TEXTURE;
        this.destination = INVALID_TEXTURE;
    }
}

export interface MutableFallbackRendererListDescriptor extends RendererListDescriptor {
    cullingResults: CullingResultsHandle;
    excludeMeshes: readonly Mesh[];
}

export interface MutableSceneStorageBufferBinding extends SceneStorageBufferBinding {
    buffer: RenderGraphBufferHandle;
}

export interface MutableClusteredSceneShaderVariant extends SceneStorageShaderVariant {
    shader: StorageGraphicsShader;
    readonly shaderByMesh: Map<Mesh, StorageGraphicsShader>;
    readonly buffers: readonly MutableSceneStorageBufferBinding[];
}
