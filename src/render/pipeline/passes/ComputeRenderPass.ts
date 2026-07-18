import type UniformBuffer from '../../UniformBuffer';
import type { UniformBufferRange } from '../../UniformBuffer';
import ComputeKernel from '../../compute/ComputeKernel';
import type ComputeSampler from '../../compute/ComputeSampler';
import type {
    RenderGraphBufferHandle,
    RenderGraphTextureHandle,
    ScriptableRenderPass,
    ScriptableRenderPassBuilder,
    ScriptableRenderPassContext
} from '../ScriptableRenderGraph';

const EMPTY_COMPUTE_RESOURCES: readonly never[] = Object.freeze([]);

/** One graph-buffer range consumed by a storage binding. */
export interface ComputeBufferBinding {
    /** Frame-scoped graph buffer handle. */
    readonly buffer: RenderGraphBufferHandle;
    /** Four-byte-aligned offset into the buffer, defaulting to zero. */
    readonly byteOffset?: number;
    /** Four-byte-aligned bound range, defaulting to the remaining buffer. */
    readonly byteLength?: number;
}

/** One graph texture consumed by a sampled- or storage-texture binding. */
export interface ComputeTextureBinding {
    /** Complete single-sample two-dimensional graph texture subresource. */
    readonly texture: RenderGraphTextureHandle;
}

/** A whole std140 uniform buffer or one explicitly selected range. */
export type ComputeUniformBufferBinding = UniformBuffer | UniformBufferRange;

/** Direct or GPU-authored indirect dispatch dimensions. */
export type ComputeDispatch =
    | Readonly<{ x: number; y?: number; z?: number }>
    | Readonly<{
          indirectBuffer: RenderGraphBufferHandle;
          indirectOffset?: number;
      }>;

/** Frame-scoped binding resources and dispatch parameters for one compute pass. */
export interface ComputeRenderPassParameters {
    /** std140 uniform resources in sorted uniform-binding order. */
    readonly uniformBuffers?: readonly ComputeUniformBufferBinding[];
    /** Storage resources in sorted storage-buffer-binding order. */
    readonly buffers: readonly ComputeBufferBinding[];
    /** Texture resources in sorted sampled/storage-texture-binding order. */
    readonly textures: readonly ComputeTextureBinding[];
    /** Immutable samplers in sorted sampler-binding order. */
    readonly samplers?: readonly ComputeSampler[];
    /** Direct dimensions or an indirect argument buffer. */
    readonly dispatch: ComputeDispatch;
}

function requireArray(value: unknown, path: string): readonly unknown[] {
    if (!Array.isArray(value)) throw new TypeError(`${path} must be an array`);
    return value;
}

function requireResourceRecord(value: unknown, path: string): Readonly<Record<string, unknown>> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new TypeError(`${path} must be an object`);
    }
    return value as Readonly<Record<string, unknown>>;
}

function requirePositiveDispatch(value: unknown, path: string): number {
    if (!Number.isSafeInteger(value) || (value as number) < 1) {
        throw new RangeError(`${path} must be a positive safe integer`);
    }
    return value as number;
}

function validateDispatch(dispatch: unknown): asserts dispatch is ComputeDispatch {
    const record = requireResourceRecord(dispatch, 'Compute dispatch');
    if ('indirectBuffer' in record) {
        if ('x' in record || 'y' in record || 'z' in record) {
            throw new TypeError('Compute dispatch cannot mix direct and indirect parameters');
        }
        if (typeof record['indirectBuffer'] !== 'number') {
            throw new TypeError('Compute indirectBuffer must be a graph buffer handle');
        }
        const offset = record['indirectOffset'] ?? 0;
        if (
            !Number.isSafeInteger(offset) ||
            (offset as number) < 0 ||
            (offset as number) % 4 !== 0
        ) {
            throw new RangeError(
                'Compute indirectOffset must be a non-negative 4-byte-aligned integer'
            );
        }
        return;
    }
    requirePositiveDispatch(record['x'], 'Compute dispatch x');
    if (record['y'] !== undefined) requirePositiveDispatch(record['y'], 'Compute dispatch y');
    if (record['z'] !== undefined) requirePositiveDispatch(record['z'], 'Compute dispatch z');
}

function validateBufferBinding(value: unknown, index: number): ComputeBufferBinding {
    const path = `Compute buffers[${String(index)}]`;
    const record = requireResourceRecord(value, path);
    if (typeof record['buffer'] !== 'number') {
        throw new TypeError(`${path}.buffer must be a graph buffer handle`);
    }
    const offset = record['byteOffset'] ?? 0;
    if (!Number.isSafeInteger(offset) || (offset as number) < 0 || (offset as number) % 4 !== 0) {
        throw new RangeError(`${path}.byteOffset must be a non-negative 4-byte-aligned integer`);
    }
    const byteLength = record['byteLength'];
    if (
        byteLength !== undefined &&
        (!Number.isSafeInteger(byteLength) ||
            (byteLength as number) < 4 ||
            (byteLength as number) % 4 !== 0)
    ) {
        throw new RangeError(`${path}.byteLength must be a positive 4-byte-aligned integer`);
    }
    return value as ComputeBufferBinding;
}

function validateTextureBinding(value: unknown, index: number): ComputeTextureBinding {
    const path = `Compute textures[${String(index)}]`;
    const record = requireResourceRecord(value, path);
    if (typeof record['texture'] !== 'number') {
        throw new TypeError(`${path}.texture must be a graph texture handle`);
    }
    return value as ComputeTextureBinding;
}

/**
 * Stable WebGPU compute pass backed by one immutable {@link ComputeKernel}.
 *
 * Binding arrays are positional within their resource category and follow the shader ABI after
 * sorting by `(group, binding)`. Setup derives graph access directly from that ABI; callers cannot
 * downgrade a writable storage binding to a read dependency.
 */
export class ComputeRenderPass implements ScriptableRenderPass<ComputeRenderPassParameters> {
    /** Stable diagnostic pass name. */
    readonly name: string;
    /** Immutable compute pipeline and shader identity. */
    readonly kernel: ComputeKernel;

    constructor(kernel: ComputeKernel, name?: string) {
        if (!(kernel instanceof ComputeKernel)) {
            throw new TypeError('ComputeRenderPass requires a ComputeKernel');
        }
        const resolvedName = name ?? kernel.label;
        if (typeof resolvedName !== 'string' || resolvedName.length === 0) {
            throw new TypeError('ComputeRenderPass name must be non-empty');
        }
        this.kernel = kernel;
        this.name = resolvedName;
        Object.freeze(this);
    }

    /** Declare storage, texture, and indirect dependencies from the immutable shader ABI. */
    setup(builder: ScriptableRenderPassBuilder, parameters: ComputeRenderPassParameters): void {
        requireResourceRecord(parameters, 'ComputeRenderPass parameters');
        const buffers = requireArray(parameters.buffers, 'ComputeRenderPass.buffers');
        const textures = requireArray(parameters.textures, 'ComputeRenderPass.textures');
        const uniforms = requireArray(
            parameters.uniformBuffers ?? EMPTY_COMPUTE_RESOURCES,
            'ComputeRenderPass.uniformBuffers'
        );
        const samplers = requireArray(
            parameters.samplers ?? EMPTY_COMPUTE_RESOURCES,
            'ComputeRenderPass.samplers'
        );
        let bufferIndex = 0;
        let textureIndex = 0;
        let uniformIndex = 0;
        let samplerIndex = 0;

        for (const binding of this.kernel.shader.bindings) {
            switch (binding.kind) {
                case 'uniform-buffer':
                    if (uniforms[uniformIndex] === undefined) {
                        throw new TypeError(
                            `ComputeRenderPass is missing uniform buffer ${binding.name}`
                        );
                    }
                    uniformIndex += 1;
                    break;
                case 'read-only-storage-buffer': {
                    if (buffers[bufferIndex] === undefined) {
                        throw new TypeError(
                            `ComputeRenderPass is missing storage buffer ${binding.name}`
                        );
                    }
                    const resource = validateBufferBinding(buffers[bufferIndex], bufferIndex);
                    builder.readBuffer(resource.buffer, 'storage');
                    bufferIndex += 1;
                    break;
                }
                case 'storage-buffer': {
                    if (buffers[bufferIndex] === undefined) {
                        throw new TypeError(
                            `ComputeRenderPass is missing storage buffer ${binding.name}`
                        );
                    }
                    const resource = validateBufferBinding(buffers[bufferIndex], bufferIndex);
                    if (binding.access === 'write-discard') {
                        builder.writeBuffer(resource.buffer, 'storage');
                    } else {
                        builder.readWriteBuffer(resource.buffer);
                    }
                    bufferIndex += 1;
                    break;
                }
                case 'sampled-texture': {
                    if (textures[textureIndex] === undefined) {
                        throw new TypeError(`ComputeRenderPass is missing texture ${binding.name}`);
                    }
                    const resource = validateTextureBinding(textures[textureIndex], textureIndex);
                    builder.readTexture(resource.texture);
                    textureIndex += 1;
                    break;
                }
                case 'storage-texture': {
                    if (textures[textureIndex] === undefined) {
                        throw new TypeError(`ComputeRenderPass is missing texture ${binding.name}`);
                    }
                    const resource = validateTextureBinding(textures[textureIndex], textureIndex);
                    builder.writeStorageTexture(resource.texture);
                    textureIndex += 1;
                    break;
                }
                case 'sampler':
                case 'non-filtering-sampler':
                case 'comparison-sampler':
                    if (samplers[samplerIndex] === undefined) {
                        throw new TypeError(`ComputeRenderPass is missing sampler ${binding.name}`);
                    }
                    samplerIndex += 1;
                    break;
            }
        }

        if (bufferIndex !== buffers.length) {
            throw new RangeError(
                `ComputeRenderPass expected ${String(bufferIndex)} storage buffers, received ${String(buffers.length)}`
            );
        }
        if (textureIndex !== textures.length) {
            throw new RangeError(
                `ComputeRenderPass expected ${String(textureIndex)} textures, received ${String(textures.length)}`
            );
        }
        if (uniformIndex !== uniforms.length) {
            throw new RangeError(
                `ComputeRenderPass expected ${String(uniformIndex)} uniform buffers, received ${String(uniforms.length)}`
            );
        }
        if (samplerIndex !== samplers.length) {
            throw new RangeError(
                `ComputeRenderPass expected ${String(samplerIndex)} samplers, received ${String(samplers.length)}`
            );
        }

        validateDispatch(parameters.dispatch);
        if ('indirectBuffer' in parameters.dispatch) {
            builder.readBuffer(parameters.dispatch.indirectBuffer, 'indirect');
        }
    }

    /** Command emission is supplied by the framework after the pass callback returns. */
    execute(_context: ScriptableRenderPassContext, _parameters: ComputeRenderPassParameters): void {
        void _context;
        void _parameters;
    }
}

export default ComputeRenderPass;
