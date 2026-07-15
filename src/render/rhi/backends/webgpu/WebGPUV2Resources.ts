import type {
    RHIBuffer,
    RHIBufferMapMode,
    RHIBufferMapState,
    RHINormalizedBufferDescriptor,
    RHINormalizedSamplerDescriptor,
    RHINormalizedShaderDescriptor,
    RHINormalizedTextureDescriptor,
    RHINormalizedTextureViewDescriptor,
    RHISampler,
    RHIShader,
    RHITexture,
    RHITextureView,
    RHITextureViewDescriptor
} from '../../core/RHIResources';
import { RHIBufferUsage } from '../../core/RHITypes';
import {
    RHIValidationError,
    assertRHIBufferMapRange,
    assertRHIGetMappedRange,
    normalizeRHITextureViewDescriptor
} from '../../core/RHIValidation';
import { WebGPUV2DestroyableObject, WebGPUV2Resource } from './WebGPUV2Base';
import { nativeWebGPUTextureViewDescriptor } from './WebGPUV2Descriptors';
import type { WebGPUV2Device } from './WebGPUV2Device';

export class WebGPUV2Buffer
    extends WebGPUV2Resource<RHINormalizedBufferDescriptor>
    implements RHIBuffer
{
    readonly descriptor: Readonly<RHINormalizedBufferDescriptor>;
    readonly size: number;
    readonly usage: number;
    readonly #nativeHandle: GPUBuffer;
    #mappedOffset = 0;
    #mappedSize = 0;

    constructor(
        owner: WebGPUV2Device,
        nativeHandle: GPUBuffer,
        descriptor: Readonly<RHINormalizedBufferDescriptor>
    ) {
        super(owner, descriptor.label, descriptor.lifetime, 'buffer', 'complete');
        this.#nativeHandle = nativeHandle;
        this.descriptor = descriptor;
        this.size = descriptor.size;
        this.usage = descriptor.usage;
        if (descriptor.mappedAtCreation) this.#mappedSize = descriptor.size;
    }

    /** @internal */
    get nativeHandle(): GPUBuffer {
        return this.#nativeHandle;
    }

    get mapState(): RHIBufferMapState {
        return this.#nativeHandle.mapState;
    }

    mapAsync(mode: RHIBufferMapMode, offset = 0, size = this.size - offset): Promise<void> {
        this.owner.assertUsable(this, 'buffer');
        const usage = mode === 'read' ? RHIBufferUsage.MAP_READ : RHIBufferUsage.MAP_WRITE;
        if ((this.usage & usage) === 0) {
            throw new RHIValidationError(
                'invalid-descriptor',
                `buffer lacks MAP_${mode.toUpperCase()} usage`,
                'buffer.usage'
            );
        }
        assertRHIBufferMapRange(this.size, offset, size, 'buffer.map');
        const operation = this.#nativeHandle.mapAsync(mode === 'read' ? 0x1 : 0x2, offset, size);
        return operation.then(
            () => {
                this.#mappedOffset = offset;
                this.#mappedSize = size;
            },
            (error: unknown) => {
                this.#mappedOffset = 0;
                this.#mappedSize = 0;
                throw error;
            }
        );
    }

    getMappedRange(offset = 0, size = this.size - offset): ArrayBuffer {
        this.owner.assertUsable(this, 'buffer');
        if (this.mapState !== 'mapped') {
            throw new RHIValidationError('invalid-state', 'buffer is not mapped', 'buffer');
        }
        assertRHIGetMappedRange(
            this.#mappedOffset,
            this.#mappedSize,
            offset,
            size,
            'buffer.mappedRange'
        );
        return this.#nativeHandle.getMappedRange(offset, size);
    }

    unmap(): void {
        this.owner.assertUsable(this, 'buffer');
        this.#nativeHandle.unmap();
        this.#mappedOffset = 0;
        this.#mappedSize = 0;
    }

    protected override releaseNative(): void {
        this.#mappedOffset = 0;
        this.#mappedSize = 0;
        this.#nativeHandle.destroy();
    }
}

export class WebGPUV2Texture
    extends WebGPUV2Resource<RHINormalizedTextureDescriptor>
    implements RHITexture
{
    readonly descriptor: Readonly<RHINormalizedTextureDescriptor>;
    readonly width: number;
    readonly height: number;
    readonly depthOrArrayLayers: number;
    readonly mipLevelCount: number;
    readonly sampleCount: number;
    readonly dimension;
    readonly format;
    readonly usage: number;
    readonly #nativeHandle: GPUTexture;
    readonly #ownsNativeAllocation: boolean;

    constructor(
        owner: WebGPUV2Device,
        nativeHandle: GPUTexture,
        descriptor: Readonly<RHINormalizedTextureDescriptor>,
        ownsNativeAllocation = true
    ) {
        super(
            owner,
            descriptor.label,
            descriptor.lifetime,
            ownsNativeAllocation ? 'texture' : null,
            ownsNativeAllocation ? 'complete' : null
        );
        this.#nativeHandle = nativeHandle;
        this.#ownsNativeAllocation = ownsNativeAllocation;
        this.descriptor = descriptor;
        this.width = descriptor.size.width;
        this.height = descriptor.size.height;
        this.depthOrArrayLayers = descriptor.size.depthOrArrayLayers;
        this.mipLevelCount = descriptor.mipLevelCount;
        this.sampleCount = descriptor.sampleCount;
        this.dimension = descriptor.dimension;
        this.format = descriptor.format;
        this.usage = descriptor.usage;
    }

    /** @internal */
    get nativeHandle(): GPUTexture {
        return this.#nativeHandle;
    }

    createView(descriptor: RHITextureViewDescriptor = {}): WebGPUV2TextureView {
        this.owner.assertUsable(this, 'texture');
        const normalized = normalizeRHITextureViewDescriptor(this, descriptor);
        const nativeView = this.#nativeHandle.createView(
            nativeWebGPUTextureViewDescriptor(normalized)
        );
        return new WebGPUV2TextureView(this.owner, nativeView, this, normalized);
    }

    protected override releaseNative(): void {
        if (this.#ownsNativeAllocation) this.#nativeHandle.destroy();
    }
}

export class WebGPUV2TextureView extends WebGPUV2DestroyableObject implements RHITextureView {
    readonly texture: WebGPUV2Texture;
    readonly descriptor: Readonly<RHINormalizedTextureViewDescriptor>;
    readonly format;
    readonly dimension;
    readonly aspect;
    readonly #nativeHandle: GPUTextureView;

    constructor(
        owner: WebGPUV2Device,
        nativeHandle: GPUTextureView,
        texture: WebGPUV2Texture,
        descriptor: Readonly<RHINormalizedTextureViewDescriptor>
    ) {
        super(owner, descriptor.label, 'textureView', 'creation-only');
        this.#nativeHandle = nativeHandle;
        this.texture = texture;
        this.descriptor = descriptor;
        this.format = descriptor.format;
        this.dimension = descriptor.dimension;
        this.aspect = descriptor.aspect;
    }

    /** @internal */
    get nativeHandle(): GPUTextureView {
        return this.#nativeHandle;
    }

    protected override releaseNative(): void {
        this.owner.framebufferCache.releaseView(this.id);
    }
}

export class WebGPUV2Sampler
    extends WebGPUV2Resource<RHINormalizedSamplerDescriptor>
    implements RHISampler
{
    readonly descriptor: Readonly<RHINormalizedSamplerDescriptor>;
    readonly #nativeHandle: GPUSampler;

    constructor(
        owner: WebGPUV2Device,
        nativeHandle: GPUSampler,
        descriptor: Readonly<RHINormalizedSamplerDescriptor>
    ) {
        super(owner, descriptor.label, descriptor.lifetime, 'sampler', 'creation-only');
        this.#nativeHandle = nativeHandle;
        this.descriptor = descriptor;
    }

    /** @internal */
    get nativeHandle(): GPUSampler {
        return this.#nativeHandle;
    }
}

export class WebGPUV2Shader
    extends WebGPUV2Resource<RHINormalizedShaderDescriptor>
    implements RHIShader
{
    readonly descriptor: Readonly<RHINormalizedShaderDescriptor>;
    readonly artifact;
    readonly stage;
    readonly #nativeHandle: GPUShaderModule;

    constructor(
        owner: WebGPUV2Device,
        nativeHandle: GPUShaderModule,
        descriptor: Readonly<RHINormalizedShaderDescriptor>
    ) {
        super(owner, descriptor.label, descriptor.lifetime, 'shaderModule', 'creation-only');
        this.#nativeHandle = nativeHandle;
        this.descriptor = descriptor;
        this.artifact = descriptor.artifact;
        this.stage = descriptor.artifact.stage;
    }

    /** @internal */
    get nativeHandle(): GPUShaderModule {
        return this.#nativeHandle;
    }
}
