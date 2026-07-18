import Material from '../../../material/Material';
import type UniformBuffer from '../../UniformBuffer';
import type { UniformBufferRange } from '../../UniformBuffer';
import ComputeSampler from '../../compute/ComputeSampler';
import StorageGraphicsShader from '../../compute/StorageGraphicsShader';
import type { RendererViewport } from '../../RendererCore';
import type { ComputeBufferBinding, ComputeTextureBinding } from './ComputeRenderPass';
import type {
    RenderGraphBufferHandle,
    RenderPipelineColorAttachment,
    RenderPipelineDepthStencilAttachment,
    ScriptableRenderPass,
    ScriptableRenderPassBuilder,
    ScriptableRenderPassContext
} from '../ScriptableRenderGraph';

const EMPTY_READONLY_ARRAY: readonly never[] = Object.freeze([]);

/** Public vertex formats accepted by the portable RHI without exposing its namespace. */
export type GPUDrivenVertexFormat =
    | 'uint8x2'
    | 'uint8x4'
    | 'sint8x2'
    | 'sint8x4'
    | 'unorm8x2'
    | 'unorm8x4'
    | 'snorm8x2'
    | 'snorm8x4'
    | 'uint16x2'
    | 'uint16x4'
    | 'sint16x2'
    | 'sint16x4'
    | 'unorm16x2'
    | 'unorm16x4'
    | 'snorm16x2'
    | 'snorm16x4'
    | 'float16x2'
    | 'float16x4'
    | 'float32'
    | 'float32x2'
    | 'float32x3'
    | 'float32x4'
    | 'uint32'
    | 'uint32x2'
    | 'uint32x3'
    | 'uint32x4'
    | 'sint32'
    | 'sint32x2'
    | 'sint32x3'
    | 'sint32x4';

/** One attribute sourced from a graph vertex buffer. */
export interface GPUDrivenVertexAttribute {
    /** Vertex-shader input location. */
    readonly shaderLocation: number;
    /** Portable scalar or vector representation in the source buffer. */
    readonly format: GPUDrivenVertexFormat;
    /** Byte offset from the start of one vertex or instance element. */
    readonly byteOffset: number;
}

/** Immutable layout for one graph vertex-buffer slot. */
export interface GPUDrivenVertexBufferLayout {
    /** Bytes between consecutive vertex or instance elements. */
    readonly arrayStride: number;
    /** Whether the buffer advances per vertex or per instance. */
    readonly stepMode?: 'vertex' | 'instance';
    /** Attributes sourced from this buffer slot. */
    readonly attributes: readonly GPUDrivenVertexAttribute[];
}

/** Direct procedural draw or GPU-authored indirect argument source. */
export type GPUDrivenDraw =
    | Readonly<{
          kind: 'draw';
          vertexCount: number;
          instanceCount?: number;
          firstVertex?: number;
          firstInstance?: number;
      }>
    | Readonly<{
          kind: 'draw-indirect';
          buffer: RenderGraphBufferHandle;
          byteOffset?: number;
      }>
    | Readonly<{
          kind: 'draw-indexed-indirect';
          buffer: RenderGraphBufferHandle;
          byteOffset?: number;
      }>;

/** Fixed shader, raster state, and vertex-input ABI for one GPU-driven pass. */
export interface GPUDrivenRenderPassOptions {
    /** Optional diagnostic pass name. */
    readonly name?: string;
    /** WebGPU storage-aware GLSL ES 3.10 graphics shader. */
    readonly shader: StorageGraphicsShader;
    /** Raster/depth/blend state only; resource bindings come from pass parameters. */
    readonly material: Material;
    /** Immutable positional vertex-buffer ABI; omit for vertex pulling. */
    readonly vertexLayouts?: readonly GPUDrivenVertexBufferLayout[];
    /** Index format required by indexed indirect draws. */
    readonly indexFormat?: 'uint16' | 'uint32';
}

/** Frame-scoped graph resources consumed by one GPU-driven draw. */
export interface GPUDrivenRenderPassParameters {
    /** std140 resources in sorted uniform-buffer ABI order. */
    readonly uniformBuffers?: readonly (UniformBuffer | UniformBufferRange)[];
    /** Readonly storage resources in sorted storage-buffer ABI order. */
    readonly buffers: readonly ComputeBufferBinding[];
    /** Sampled graph textures in sorted sampled-texture ABI order. */
    readonly textures?: readonly ComputeTextureBinding[];
    /** Immutable samplers in sorted sampler ABI order. */
    readonly samplers?: readonly ComputeSampler[];
    /** Graph vertex buffers in the same order as `vertexLayouts`. */
    readonly vertexBuffers?: readonly ComputeBufferBinding[];
    /** Required only by `draw-indexed-indirect`. */
    readonly indexBuffer?: ComputeBufferBinding;
    /** Direct or GPU-authored indirect draw command. */
    readonly draw: GPUDrivenDraw;
    /** One or more color attachments matching continuous fragment output locations. */
    readonly colorAttachments: readonly Readonly<RenderPipelineColorAttachment>[];
    /** Optional depth/stencil attachment and load/store policy. */
    readonly depthStencilAttachment?: Readonly<RenderPipelineDepthStencilAttachment>;
    /** Optional dynamic viewport in physical attachment pixels. */
    readonly viewport?: RendererViewport;
    /** Optional dynamic scissor in physical attachment pixels. */
    readonly scissor?: RendererViewport;
    /** Optional unsigned dynamic stencil reference. */
    readonly stencilReference?: number;
}

const VERTEX_FORMAT_BYTE_LENGTH: Readonly<Record<GPUDrivenVertexFormat, number>> = Object.freeze({
    uint8x2: 2,
    uint8x4: 4,
    sint8x2: 2,
    sint8x4: 4,
    unorm8x2: 2,
    unorm8x4: 4,
    snorm8x2: 2,
    snorm8x4: 4,
    uint16x2: 4,
    uint16x4: 8,
    sint16x2: 4,
    sint16x4: 8,
    unorm16x2: 4,
    unorm16x4: 8,
    snorm16x2: 4,
    snorm16x4: 8,
    float16x2: 4,
    float16x4: 8,
    float32: 4,
    float32x2: 8,
    float32x3: 12,
    float32x4: 16,
    uint32: 4,
    uint32x2: 8,
    uint32x3: 12,
    uint32x4: 16,
    sint32: 4,
    sint32x2: 8,
    sint32x3: 12,
    sint32x4: 16
});

function requireRecord(value: unknown, path: string): Readonly<Record<string, unknown>> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new TypeError(`${path} must be an object`);
    }
    return value as Readonly<Record<string, unknown>>;
}

function requireArray(value: unknown, path: string): readonly unknown[] {
    if (!Array.isArray(value)) throw new TypeError(`${path} must be an array`);
    return value;
}

function requireNonNegativeSafeInteger(value: unknown, path: string): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(`${path} must be a non-negative safe integer`);
    }
    return value;
}

function validateBufferBinding(value: unknown, path: string): ComputeBufferBinding {
    const record = requireRecord(value, path);
    if (typeof record['buffer'] !== 'number') {
        throw new TypeError(`${path}.buffer must be a graph buffer handle`);
    }
    const byteOffset = requireNonNegativeSafeInteger(
        record['byteOffset'] ?? 0,
        `${path}.byteOffset`
    );
    if (byteOffset % 4 !== 0) {
        throw new RangeError(`${path}.byteOffset must be 4-byte aligned`);
    }
    if (record['byteLength'] !== undefined) {
        const byteLength = requireNonNegativeSafeInteger(
            record['byteLength'],
            `${path}.byteLength`
        );
        if (byteLength === 0 || byteLength % 4 !== 0) {
            throw new RangeError(`${path}.byteLength must be positive and 4-byte aligned`);
        }
    }
    return value as ComputeBufferBinding;
}

function validateTextureBinding(value: unknown, path: string): ComputeTextureBinding {
    const record = requireRecord(value, path);
    if (typeof record['texture'] !== 'number') {
        throw new TypeError(`${path}.texture must be a graph texture handle`);
    }
    return value as ComputeTextureBinding;
}

function validateColorAttachment(
    value: unknown,
    path: string
): Readonly<RenderPipelineColorAttachment> {
    requireRecord(value, path);
    return value as Readonly<RenderPipelineColorAttachment>;
}

function snapshotVertexLayouts(
    layouts: readonly unknown[]
): readonly Readonly<GPUDrivenVertexBufferLayout>[] {
    const locations = new Set<number>();
    return Object.freeze(
        layouts.map((layout, layoutIndex) => {
            const layoutRecord = requireRecord(
                layout,
                `GPUDrivenRenderPass.vertexLayouts[${String(layoutIndex)}]`
            );
            const arrayStride = requireNonNegativeSafeInteger(
                layoutRecord['arrayStride'],
                `GPUDrivenRenderPass.vertexLayouts[${String(layoutIndex)}].arrayStride`
            );
            if (arrayStride === 0 || arrayStride % 4 !== 0) {
                throw new RangeError(
                    'GPU-driven vertex arrayStride must be positive and 4-byte aligned'
                );
            }
            const stepMode = layoutRecord['stepMode'];
            if (stepMode !== undefined && stepMode !== 'vertex' && stepMode !== 'instance') {
                throw new TypeError('GPU-driven vertex stepMode is unsupported');
            }
            const attributes = requireArray(
                layoutRecord['attributes'],
                `GPUDrivenRenderPass.vertexLayouts[${String(layoutIndex)}].attributes`
            ).map((candidate, attributeIndex) => {
                const path = `GPUDrivenRenderPass.vertexLayouts[${String(layoutIndex)}].attributes[${String(attributeIndex)}]`;
                const attribute = requireRecord(candidate, path);
                const shaderLocation = requireNonNegativeSafeInteger(
                    attribute['shaderLocation'],
                    `${path}.shaderLocation`
                );
                if (locations.has(shaderLocation)) {
                    throw new TypeError(
                        `GPU-driven vertex location ${String(shaderLocation)} is declared more than once`
                    );
                }
                locations.add(shaderLocation);
                const format = attribute['format'];
                if (typeof format !== 'string' || !(format in VERTEX_FORMAT_BYTE_LENGTH)) {
                    throw new TypeError(`${path}.format ${String(format)} is unsupported`);
                }
                const byteOffset = requireNonNegativeSafeInteger(
                    attribute['byteOffset'],
                    `${path}.byteOffset`
                );
                const byteLength = VERTEX_FORMAT_BYTE_LENGTH[format as GPUDrivenVertexFormat];
                if (byteOffset + byteLength > arrayStride) {
                    throw new RangeError(`${path} exceeds its vertex arrayStride`);
                }
                return Object.freeze({
                    shaderLocation,
                    format: format as GPUDrivenVertexFormat,
                    byteOffset
                });
            });
            if (attributes.length === 0) {
                throw new RangeError(
                    'GPU-driven vertex layouts cannot contain an empty attribute list'
                );
            }
            return Object.freeze({
                arrayStride,
                ...(stepMode === undefined ? {} : { stepMode }),
                attributes: Object.freeze(attributes)
            });
        })
    );
}

function validateIndirectOffset(value: unknown, path: string): number {
    const offset = requireNonNegativeSafeInteger(value ?? 0, path);
    if (offset % 4 !== 0) throw new RangeError(`${path} must be 4-byte aligned`);
    return offset;
}

function validateDraw(draw: unknown): asserts draw is GPUDrivenDraw {
    const record = requireRecord(draw, 'GPUDrivenRenderPass.draw');
    switch (record['kind']) {
        case 'draw': {
            const vertexCount = requireNonNegativeSafeInteger(
                record['vertexCount'],
                'GPU-driven vertexCount'
            );
            const instanceCount = requireNonNegativeSafeInteger(
                record['instanceCount'] ?? 1,
                'GPU-driven instanceCount'
            );
            requireNonNegativeSafeInteger(record['firstVertex'] ?? 0, 'GPU-driven firstVertex');
            requireNonNegativeSafeInteger(record['firstInstance'] ?? 0, 'GPU-driven firstInstance');
            if (vertexCount === 0 || instanceCount === 0) {
                throw new RangeError('GPU-driven direct draw counts must be positive');
            }
            return;
        }
        case 'draw-indirect':
        case 'draw-indexed-indirect':
            if (typeof record['buffer'] !== 'number') {
                throw new TypeError('GPU-driven indirect draw requires a graph buffer handle');
            }
            validateIndirectOffset(record['byteOffset'], 'GPU-driven indirect byteOffset');
            return;
        default:
            throw new TypeError(`Unsupported GPU-driven draw kind ${String(record['kind'])}`);
    }
}

/**
 * WebGPU-only storage-aware raster pass for vertex pulling and direct/indirect procedural draws.
 *
 * The pass derives graph access from the immutable shader ABI. It never reads indirect arguments
 * on the CPU and never exposes native WebGPU objects.
 */
export class GPUDrivenRenderPass implements ScriptableRenderPass<GPUDrivenRenderPassParameters> {
    /** Stable diagnostic pass name. */
    readonly name: string;
    /** Immutable storage-aware graphics shader. */
    readonly shader: StorageGraphicsShader;
    /** Material supplying raster, depth, stencil, and blend state. */
    readonly material: Material;
    /** Snapshotted positional vertex-buffer ABI. */
    readonly vertexLayouts: readonly Readonly<GPUDrivenVertexBufferLayout>[];
    /** Index format for indexed indirect draws, when configured. */
    readonly indexFormat: 'uint16' | 'uint32' | undefined;

    constructor(options: Readonly<GPUDrivenRenderPassOptions>) {
        const optionRecord = requireRecord(options, 'GPUDrivenRenderPass options');
        if (!(options.shader instanceof StorageGraphicsShader)) {
            throw new TypeError('GPUDrivenRenderPass requires a StorageGraphicsShader');
        }
        if (!(options.material instanceof Material)) {
            throw new TypeError('GPUDrivenRenderPass requires a Material for raster state');
        }
        const name = options.name ?? (options.shader.label || 'GPUDrivenRenderPass');
        if (typeof name !== 'string' || name.length === 0) {
            throw new TypeError('GPUDrivenRenderPass name must be non-empty');
        }
        const indexFormat = optionRecord['indexFormat'];
        if (indexFormat !== undefined && indexFormat !== 'uint16' && indexFormat !== 'uint32') {
            throw new TypeError('GPUDrivenRenderPass indexFormat is unsupported');
        }
        for (const binding of options.shader.bindings) {
            if (binding.kind !== 'sampled-texture') continue;
            if ((binding.viewDimension ?? '2d') !== '2d') {
                throw new TypeError(
                    `GPUDrivenRenderPass graph texture ${binding.name} must use a complete 2d view; non-2d storage graphics textures are available through Scene material bindings`
                );
            }
            if (binding.sampleType === 'sint' || binding.sampleType === 'uint') {
                throw new TypeError(
                    `GPUDrivenRenderPass graph texture ${binding.name} cannot use ${binding.sampleType}; integer storage graphics textures are available through Scene material bindings`
                );
            }
        }
        this.name = name;
        this.shader = options.shader;
        this.material = options.material;
        this.vertexLayouts = snapshotVertexLayouts(
            requireArray(
                optionRecord['vertexLayouts'] ?? EMPTY_READONLY_ARRAY,
                'GPUDrivenRenderPass.vertexLayouts'
            )
        );
        this.indexFormat = indexFormat;
        Object.freeze(this);
    }

    /** Declare shader resources, vertex/index/indirect inputs, and raster attachments. */
    setup(builder: ScriptableRenderPassBuilder, parameters: GPUDrivenRenderPassParameters): void {
        requireRecord(parameters, 'GPUDrivenRenderPass parameters');
        const buffers = requireArray(parameters.buffers, 'GPUDrivenRenderPass.buffers');
        const uniforms = requireArray(
            parameters.uniformBuffers ?? EMPTY_READONLY_ARRAY,
            'GPUDrivenRenderPass.uniformBuffers'
        );
        const textures = requireArray(
            parameters.textures ?? EMPTY_READONLY_ARRAY,
            'GPUDrivenRenderPass.textures'
        );
        const samplers = requireArray(
            parameters.samplers ?? EMPTY_READONLY_ARRAY,
            'GPUDrivenRenderPass.samplers'
        );
        let bufferIndex = 0;
        let uniformIndex = 0;
        let textureIndex = 0;
        let samplerIndex = 0;
        for (const binding of this.shader.bindings) {
            switch (binding.kind) {
                case 'uniform-buffer':
                    if (uniforms[uniformIndex] === undefined) {
                        throw new TypeError(
                            `GPUDrivenRenderPass is missing uniform buffer ${binding.name}`
                        );
                    }
                    uniformIndex++;
                    break;
                case 'read-only-storage-buffer': {
                    const resource = validateBufferBinding(
                        buffers[bufferIndex],
                        `GPUDrivenRenderPass.buffers[${String(bufferIndex)}]`
                    );
                    builder.readBuffer(resource.buffer, 'storage');
                    bufferIndex++;
                    break;
                }
                case 'sampled-texture': {
                    const texture = validateTextureBinding(
                        textures[textureIndex],
                        `GPUDrivenRenderPass.textures[${String(textureIndex)}]`
                    );
                    builder.readTexture(texture.texture);
                    textureIndex++;
                    break;
                }
                case 'sampler':
                case 'comparison-sampler': {
                    const sampler = samplers[samplerIndex];
                    if (!(sampler instanceof ComputeSampler)) {
                        throw new TypeError(
                            `GPUDrivenRenderPass sampler ${binding.name} is missing or invalid`
                        );
                    }
                    if (
                        (binding.kind === 'comparison-sampler') !==
                        (sampler.compare !== undefined)
                    ) {
                        throw new TypeError(
                            `GPUDrivenRenderPass sampler ${binding.name} has an incompatible comparison mode`
                        );
                    }
                    const pairedTexture = this.shader.bindings.find(
                        candidate =>
                            candidate.kind === 'sampled-texture' && candidate.name === binding.name
                    );
                    if (
                        binding.kind === 'sampler' &&
                        pairedTexture?.kind === 'sampled-texture' &&
                        pairedTexture.sampleType !== 'float' &&
                        (sampler.magFilter !== 'nearest' ||
                            sampler.minFilter !== 'nearest' ||
                            sampler.mipmapFilter !== 'nearest' ||
                            sampler.maxAnisotropy !== 1)
                    ) {
                        throw new TypeError(
                            `GPUDrivenRenderPass sampler ${binding.name} requires nearest filters and maxAnisotropy 1`
                        );
                    }
                    samplerIndex++;
                    break;
                }
            }
        }
        if (
            bufferIndex !== buffers.length ||
            uniformIndex !== uniforms.length ||
            textureIndex !== textures.length ||
            samplerIndex !== samplers.length
        ) {
            throw new RangeError(
                `GPUDrivenRenderPass binding counts do not match its shader ABI (uniform ${String(uniformIndex)}, storage ${String(bufferIndex)}, texture ${String(textureIndex)}, sampler ${String(samplerIndex)})`
            );
        }

        const vertexBuffers = requireArray(
            parameters.vertexBuffers ?? EMPTY_READONLY_ARRAY,
            'GPUDrivenRenderPass.vertexBuffers'
        );
        if (vertexBuffers.length !== this.vertexLayouts.length) {
            throw new RangeError(
                `GPUDrivenRenderPass expected ${String(this.vertexLayouts.length)} vertex buffers, received ${String(vertexBuffers.length)}`
            );
        }
        for (let index = 0; index < vertexBuffers.length; index += 1) {
            const resource = validateBufferBinding(
                vertexBuffers[index],
                `GPUDrivenRenderPass.vertexBuffers[${String(index)}]`
            );
            builder.readBuffer(resource.buffer, 'vertex');
        }

        validateDraw(parameters.draw);
        if (parameters.draw.kind === 'draw-indexed-indirect') {
            if (this.indexFormat === undefined || parameters.indexBuffer === undefined) {
                throw new TypeError('Indexed indirect draw requires indexFormat and indexBuffer');
            }
            const index = validateBufferBinding(
                parameters.indexBuffer,
                'GPUDrivenRenderPass.indexBuffer'
            );
            builder.readBuffer(index.buffer, 'index');
        } else if (parameters.indexBuffer !== undefined) {
            throw new TypeError('indexBuffer is valid only for draw-indexed-indirect');
        }
        if (parameters.draw.kind !== 'draw') {
            builder.readBuffer(parameters.draw.buffer, 'indirect');
        }
        const colorAttachments = requireArray(
            parameters.colorAttachments,
            'GPUDrivenRenderPass.colorAttachments'
        );
        if (colorAttachments.length === 0) {
            throw new RangeError('GPUDrivenRenderPass requires at least one color attachment');
        }
        for (let index = 0; index < colorAttachments.length; index += 1) {
            builder.useColorAttachment(
                validateColorAttachment(
                    colorAttachments[index],
                    `GPUDrivenRenderPass.colorAttachments[${String(index)}]`
                )
            );
        }
        if (parameters.depthStencilAttachment !== undefined) {
            builder.useDepthStencilAttachment(parameters.depthStencilAttachment);
        }
    }

    /** Apply optional dynamic state; the framework emits the prepared draw afterward. */
    execute(context: ScriptableRenderPassContext, parameters: GPUDrivenRenderPassParameters): void {
        if (parameters.viewport !== undefined) context.commands.setViewport(parameters.viewport);
        if (parameters.scissor !== undefined) context.commands.setScissor(parameters.scissor);
        if (parameters.stencilReference !== undefined) {
            context.commands.setStencilReference(parameters.stencilReference);
        }
    }
}

export default GPUDrivenRenderPass;
