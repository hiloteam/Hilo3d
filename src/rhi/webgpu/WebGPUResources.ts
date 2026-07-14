import type {
    RHIBuffer,
    RHIBufferDescriptor,
    RHISampler,
    RHISamplerDescriptor,
    RHINormalizedSamplerDescriptor,
    RHIShaderModule,
    RHIShaderModuleDescriptor,
    RHITexture,
    RHITextureDescriptor,
    RHITextureDimension,
    RHITextureFormat,
    RHITextureView,
    RHITextureViewDescriptor,
    RHITextureViewDimension
} from '../RHI';
import type { WebGPUDevice } from './WebGPUDevice';
import {
    DEFAULT_TEXTURE_USAGE,
    WEBGPU_MAP_READ,
    WEBGPU_MAP_WRITE,
    WebGPUDestroyableObject,
    WebGPUObject,
    labelOf,
    owners
} from './WebGPUBase';
import { textureViewDescriptor } from './WebGPUDescriptors';

function nativeNumber(object: object, property: string, fallback: number): number {
    const value: unknown = Reflect.get(object, property);
    return typeof value === 'number' ? value : fallback;
}

export class WebGPUBuffer extends WebGPUDestroyableObject implements RHIBuffer {
    readonly size: number;
    readonly usage: number;
    readonly #nativeHandle: GPUBuffer;

    constructor(device: WebGPUDevice, nativeHandle: GPUBuffer, descriptor?: RHIBufferDescriptor) {
        super(labelOf(nativeHandle, descriptor?.label));
        this.#nativeHandle = nativeHandle;
        this.size = nativeNumber(nativeHandle, 'size', descriptor?.size ?? 0);
        this.usage = nativeNumber(nativeHandle, 'usage', descriptor?.usage ?? 0);
        owners.set(this, device);
    }

    /** @internal */
    get nativeHandle(): GPUBuffer {
        return this.#nativeHandle;
    }

    get mapState(): 'unmapped' | 'pending' | 'mapped' {
        return this.#nativeHandle.mapState;
    }

    mapAsync(mode: 'read' | 'write', offset?: number, size?: number): Promise<void> {
        this.assertAlive('WebGPU buffer');
        return this.#nativeHandle.mapAsync(
            mode === 'read' ? WEBGPU_MAP_READ : WEBGPU_MAP_WRITE,
            offset,
            size
        );
    }

    getMappedRange(offset?: number, size?: number): ArrayBuffer {
        this.assertAlive('WebGPU buffer');
        return this.#nativeHandle.getMappedRange(offset, size);
    }

    unmap(): void {
        this.assertAlive('WebGPU buffer');
        this.#nativeHandle.unmap();
    }

    destroy(): void {
        if (!this.markDestroyed()) return;
        this.#nativeHandle.destroy();
    }
}

function defaultViewDimension(texture: WebGPUTexture): RHITextureViewDimension {
    if (texture.dimension === '1d') return '1d';
    if (texture.dimension === '3d') return '3d';
    return texture.depthOrArrayLayers === 1 ? '2d' : '2d-array';
}

function defaultArrayLayerCount(
    texture: WebGPUTexture,
    dimension: RHITextureViewDimension,
    baseArrayLayer: number
): number {
    if (dimension === 'cube') return 6;
    if (dimension === '2d-array' || dimension === 'cube-array') {
        return texture.depthOrArrayLayers - baseArrayLayer;
    }
    return 1;
}

export class WebGPUTexture extends WebGPUDestroyableObject implements RHITexture {
    readonly width: number;
    readonly height: number;
    readonly depthOrArrayLayers: number;
    readonly mipLevelCount: number;
    readonly sampleCount: number;
    readonly dimension: RHITextureDimension;
    readonly format: RHITextureFormat;
    readonly usage: number;
    readonly #nativeHandle: GPUTexture;
    readonly #device: WebGPUDevice;

    constructor(device: WebGPUDevice, nativeHandle: GPUTexture, descriptor?: RHITextureDescriptor) {
        super(labelOf(nativeHandle, descriptor?.label));
        this.#device = device;
        this.#nativeHandle = nativeHandle;
        this.width = nativeNumber(nativeHandle, 'width', descriptor?.size.width ?? 0);
        this.height = nativeNumber(nativeHandle, 'height', descriptor?.size.height ?? 1);
        this.depthOrArrayLayers = nativeNumber(
            nativeHandle,
            'depthOrArrayLayers',
            descriptor?.size.depthOrArrayLayers ?? 1
        );
        this.mipLevelCount = nativeNumber(
            nativeHandle,
            'mipLevelCount',
            descriptor?.mipLevelCount ?? 1
        );
        this.sampleCount = nativeNumber(nativeHandle, 'sampleCount', descriptor?.sampleCount ?? 1);
        const nativeDimension: unknown = Reflect.get(nativeHandle, 'dimension');
        this.dimension =
            nativeDimension === '1d' || nativeDimension === '2d' || nativeDimension === '3d'
                ? nativeDimension
                : (descriptor?.dimension ?? '2d');
        const nativeFormat: unknown = Reflect.get(nativeHandle, 'format');
        this.format =
            typeof nativeFormat === 'string'
                ? (nativeFormat as RHITextureFormat)
                : (descriptor?.format ?? 'rgba8unorm');
        this.usage = nativeNumber(
            nativeHandle,
            'usage',
            descriptor?.usage ?? DEFAULT_TEXTURE_USAGE
        );
        owners.set(this, device);
    }

    /** @internal */
    get nativeHandle(): GPUTexture {
        return this.#nativeHandle;
    }

    createView(descriptor: RHITextureViewDescriptor = {}): WebGPUTextureView {
        this.assertAlive('WebGPU texture');
        const nativeView = this.#nativeHandle.createView(textureViewDescriptor(descriptor));
        return this.#device.wrapTextureView(nativeView, this, descriptor);
    }

    destroy(): void {
        if (!this.markDestroyed()) return;
        this.#nativeHandle.destroy();
    }
}

export class WebGPUTextureView extends WebGPUObject implements RHITextureView {
    readonly texture: WebGPUTexture;
    readonly format: RHITextureFormat;
    readonly dimension: RHITextureViewDimension;
    readonly aspect: 'all' | 'stencil-only' | 'depth-only';
    readonly baseMipLevel: number;
    readonly mipLevelCount: number;
    readonly baseArrayLayer: number;
    readonly arrayLayerCount: number;
    readonly #nativeHandle: GPUTextureView;

    constructor(
        device: WebGPUDevice,
        nativeHandle: GPUTextureView,
        texture: WebGPUTexture,
        descriptor: RHITextureViewDescriptor = {}
    ) {
        super(labelOf(nativeHandle, descriptor.label));
        this.#nativeHandle = nativeHandle;
        this.texture = texture;
        this.format = descriptor.format ?? texture.format;
        this.dimension = descriptor.dimension ?? defaultViewDimension(texture);
        this.aspect = descriptor.aspect ?? 'all';
        this.baseMipLevel = descriptor.baseMipLevel ?? 0;
        this.mipLevelCount = descriptor.mipLevelCount ?? texture.mipLevelCount - this.baseMipLevel;
        this.baseArrayLayer = descriptor.baseArrayLayer ?? 0;
        this.arrayLayerCount =
            descriptor.arrayLayerCount ??
            defaultArrayLayerCount(texture, this.dimension, this.baseArrayLayer);
        owners.set(this, device);
    }

    /** @internal */
    get nativeHandle(): GPUTextureView {
        return this.#nativeHandle;
    }
}

function normalizeSamplerDescriptor(
    descriptor: RHISamplerDescriptor
): Readonly<RHINormalizedSamplerDescriptor> {
    return Object.freeze({
        addressModeU: descriptor.addressModeU ?? 'clamp-to-edge',
        addressModeV: descriptor.addressModeV ?? 'clamp-to-edge',
        addressModeW: descriptor.addressModeW ?? 'clamp-to-edge',
        magFilter: descriptor.magFilter ?? 'nearest',
        minFilter: descriptor.minFilter ?? 'nearest',
        mipmapFilter: descriptor.mipmapFilter ?? 'nearest',
        lodMinClamp: descriptor.lodMinClamp ?? 0,
        lodMaxClamp: descriptor.lodMaxClamp ?? 32,
        ...(descriptor.compare === undefined ? {} : { compare: descriptor.compare }),
        maxAnisotropy: descriptor.maxAnisotropy ?? 1
    });
}

export function nativeSamplerDescriptor(descriptor: RHISamplerDescriptor): GPUSamplerDescriptor {
    return {
        ...(descriptor.label === undefined ? {} : { label: descriptor.label }),
        ...(descriptor.addressModeU === undefined ? {} : { addressModeU: descriptor.addressModeU }),
        ...(descriptor.addressModeV === undefined ? {} : { addressModeV: descriptor.addressModeV }),
        ...(descriptor.addressModeW === undefined ? {} : { addressModeW: descriptor.addressModeW }),
        ...(descriptor.magFilter === undefined ? {} : { magFilter: descriptor.magFilter }),
        ...(descriptor.minFilter === undefined ? {} : { minFilter: descriptor.minFilter }),
        ...(descriptor.mipmapFilter === undefined ? {} : { mipmapFilter: descriptor.mipmapFilter }),
        ...(descriptor.lodMinClamp === undefined ? {} : { lodMinClamp: descriptor.lodMinClamp }),
        ...(descriptor.lodMaxClamp === undefined ? {} : { lodMaxClamp: descriptor.lodMaxClamp }),
        ...(descriptor.compare === undefined ? {} : { compare: descriptor.compare }),
        ...(descriptor.maxAnisotropy === undefined
            ? {}
            : { maxAnisotropy: descriptor.maxAnisotropy })
    };
}

export class WebGPUSampler extends WebGPUObject implements RHISampler {
    readonly descriptor: Readonly<RHINormalizedSamplerDescriptor>;
    readonly #nativeHandle: GPUSampler;

    constructor(
        device: WebGPUDevice,
        nativeHandle: GPUSampler,
        descriptor: RHISamplerDescriptor = {}
    ) {
        super(labelOf(nativeHandle, descriptor.label));
        this.#nativeHandle = nativeHandle;
        this.descriptor = normalizeSamplerDescriptor(descriptor);
        owners.set(this, device);
    }

    /** @internal */
    get nativeHandle(): GPUSampler {
        return this.#nativeHandle;
    }
}

export class WebGPUShaderModule extends WebGPUObject implements RHIShaderModule {
    readonly language: 'wgsl';
    readonly stage: 'vertex' | 'fragment';
    readonly #nativeHandle: GPUShaderModule;

    constructor(
        device: WebGPUDevice,
        nativeHandle: GPUShaderModule,
        descriptor: RHIShaderModuleDescriptor
    ) {
        super(labelOf(nativeHandle, descriptor.label));
        if (descriptor.language !== 'wgsl') {
            throw new TypeError('WebGPU shader modules require precompiled WGSL source');
        }
        this.#nativeHandle = nativeHandle;
        this.language = descriptor.language;
        this.stage = descriptor.stage;
        owners.set(this, device);
    }

    /** @internal */
    get nativeHandle(): GPUShaderModule {
        return this.#nativeHandle;
    }
}
