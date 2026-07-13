import type Texture from '../../texture/Texture';
import type { EventListener } from '../../core/EventDispatcher';
import {
    ALWAYS,
    CLAMP_TO_EDGE,
    DEPTH_COMPONENT,
    DEPTH_COMPONENT16,
    EQUAL,
    FLOAT,
    GEQUAL,
    GREATER,
    LEQUAL,
    LESS,
    LINEAR,
    LINEAR_MIPMAP_LINEAR,
    LINEAR_MIPMAP_NEAREST,
    MIRRORED_REPEAT,
    NEAREST,
    NEAREST_MIPMAP_LINEAR,
    NEAREST_MIPMAP_NEAREST,
    NEVER,
    NOTEQUAL,
    REPEAT,
    RGB,
    RGBA,
    TEXTURE_2D,
    TEXTURE_CUBE_MAP,
    UNSIGNED_BYTE
} from '../../constants/webgl';
import {
    DEPTH24_STENCIL8,
    DEPTH32F_STENCIL8,
    DEPTH_COMPONENT24,
    DEPTH_COMPONENT32F,
    HALF_FLOAT,
    RGB16F,
    RGB32F,
    RGB8,
    RGBA16F,
    RGBA32F,
    RGBA8,
    SRGB8,
    SRGB8_ALPHA8
} from '../../constants/webgl2';
import type { TextureSubImage, TypedArray } from '../types';

// WebGPU usage flags are fixed by the specification. Keeping them local makes
// fake-device tests independent from the presence of browser WebGPU globals.
const COPY_SRC = 0x01;
const COPY_DST = 0x02;
const TEXTURE_BINDING = 0x04;
const RENDER_ATTACHMENT = 0x10;
const FRAGMENT_STAGE = 0x02;
const HALF_FLOAT_ONE = 0x3c00;

export type TextureComponentStorage = 'u8' | 'f16' | 'f32' | 'depth';

export interface WebGPUTextureFormatInfo {
    readonly format: GPUTextureFormat;
    readonly bytesPerPixel: number;
    readonly storage: TextureComponentStorage;
    readonly sampleType: GPUTextureSampleType;
    readonly isDepth: boolean;
}

export interface WebGPUTextureRequestOptions {
    /** Optional WebGL comparison constant or native WebGPU comparison function. */
    readonly compare?: GLenum | GPUCompareFunction;
}

export interface WebGPUExternalTextureOptions extends WebGPUTextureRequestOptions {
    /** The manager owns and destroys the registered texture. */
    readonly takeOwnership?: boolean;
    /** Sampling view used by material bindings (for example a depth-only stencil view). */
    readonly viewDescriptor?: GPUTextureViewDescriptor;
}

export interface WebGPUTextureResource {
    readonly textureId: string;
    readonly gpuTexture: GPUTexture;
    readonly view: GPUTextureView;
    readonly sampler: GPUSampler;
    readonly format: GPUTextureFormat;
    readonly width: number;
    readonly height: number;
    readonly depthOrArrayLayers: number;
    readonly mipLevelCount: number;
    readonly dimension: '2d' | 'cube';
}

interface InternalTextureResource {
    readonly sourceTexture: Texture<unknown>;
    readonly destroyListener: EventListener;
    readonly textureId: string;
    readonly gpuTexture: GPUTexture;
    readonly view: GPUTextureView;
    readonly format: GPUTextureFormat;
    readonly width: number;
    readonly height: number;
    readonly depthOrArrayLayers: number;
    readonly mipLevelCount: number;
    readonly dimension: '2d' | 'cube';
    readonly descriptor: ResolvedTextureDescriptor;
    readonly snapshots: Map<string, WebGPUTextureResource>;
    readonly owned: boolean;
    uploadedRevision: number;
}

interface NativeTextureRecord {
    readonly resources: Set<InternalTextureResource>;
    /** Ownership is sticky once transferred so aliases can never observe premature destruction. */
    owned: boolean;
}

interface ResolvedTextureDescriptor {
    readonly key: string;
    readonly formatInfo: WebGPUTextureFormatInfo;
    readonly width: number;
    readonly height: number;
    readonly layers: number;
    readonly mipLevelCount: number;
    readonly isCube: boolean;
    readonly hasExplicitMipmaps: boolean;
}

interface MipmapPipeline {
    readonly bindGroupLayout: GPUBindGroupLayout;
    readonly pipeline: GPURenderPipeline;
}

function isTypedArray(value: unknown): value is TypedArray {
    return ArrayBuffer.isView(value) && !(value instanceof DataView);
}

function isInstanceOf(value: unknown, constructorName: string): boolean {
    const constructor = (globalThis as unknown as Record<string, unknown>)[constructorName];
    return typeof constructor === 'function' && value instanceof constructor;
}

function isExternalImageSource(value: unknown): value is GPUCopyExternalImageSource {
    return (
        isInstanceOf(value, 'HTMLImageElement') ||
        isInstanceOf(value, 'HTMLCanvasElement') ||
        isInstanceOf(value, 'ImageBitmap') ||
        isInstanceOf(value, 'ImageData') ||
        isInstanceOf(value, 'OffscreenCanvas') ||
        isInstanceOf(value, 'HTMLVideoElement') ||
        isInstanceOf(value, 'VideoFrame')
    );
}

function positiveDimension(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? Math.floor(value)
        : null;
}

function externalImageSize(source: GPUCopyExternalImageSource): {
    width: number;
    height: number;
} {
    const object = source as unknown as Record<string, unknown>;
    const width =
        positiveDimension(object['videoWidth']) ??
        positiveDimension(object['naturalWidth']) ??
        positiveDimension(object['displayWidth']) ??
        positiveDimension(object['width']);
    const height =
        positiveDimension(object['videoHeight']) ??
        positiveDimension(object['naturalHeight']) ??
        positiveDimension(object['displayHeight']) ??
        positiveDimension(object['height']);
    if (width === null || height === null) {
        throw new RangeError('External texture images must have positive dimensions');
    }
    return { width, height };
}

function isDepthInternalFormat(internalFormat: GLenum): boolean {
    return (
        internalFormat === DEPTH_COMPONENT16 ||
        internalFormat === DEPTH_COMPONENT24 ||
        internalFormat === DEPTH_COMPONENT32F ||
        internalFormat === DEPTH24_STENCIL8 ||
        internalFormat === DEPTH32F_STENCIL8
    );
}

/** Resolve the supported WebGL texture declarations to an explicit WebGPU format. */
export function resolveWebGPUTextureFormat(texture: Texture<unknown>): WebGPUTextureFormatInfo {
    if (texture.compressed) {
        throw new TypeError(
            `Compressed texture format ${String(texture.internalFormat)} is not supported by the WebGPU backend`
        );
    }

    const { internalFormat, type, format } = texture;
    if (internalFormat === DEPTH_COMPONENT16) {
        return Object.freeze({
            format: 'depth16unorm',
            bytesPerPixel: 0,
            storage: 'depth',
            sampleType: 'depth',
            isDepth: true
        });
    }
    if (internalFormat === DEPTH_COMPONENT24 || internalFormat === DEPTH24_STENCIL8) {
        return Object.freeze({
            format: internalFormat === DEPTH24_STENCIL8 ? 'depth24plus-stencil8' : 'depth24plus',
            bytesPerPixel: 0,
            storage: 'depth',
            sampleType: 'depth',
            isDepth: true
        });
    }
    if (internalFormat === DEPTH_COMPONENT32F || internalFormat === DEPTH32F_STENCIL8) {
        return Object.freeze({
            format: internalFormat === DEPTH32F_STENCIL8 ? 'depth32float-stencil8' : 'depth32float',
            bytesPerPixel: 0,
            storage: 'depth',
            sampleType: 'depth',
            isDepth: true
        });
    }
    if (format === DEPTH_COMPONENT || isDepthInternalFormat(internalFormat)) {
        throw new TypeError(
            `Depth texture internal format ${String(internalFormat)} has no supported WebGPU mapping`
        );
    }
    if (format !== RGB && format !== RGBA) {
        throw new TypeError(
            `Texture source format ${String(format)} has no supported WebGPU color mapping`
        );
    }

    if (
        internalFormat === RGBA32F ||
        internalFormat === RGB32F ||
        (type === FLOAT &&
            (internalFormat === RGBA ||
                internalFormat === RGB ||
                internalFormat === RGBA8 ||
                internalFormat === RGB8))
    ) {
        return Object.freeze({
            format: 'rgba32float',
            bytesPerPixel: 16,
            storage: 'f32',
            sampleType: 'unfilterable-float',
            isDepth: false
        });
    }
    if (internalFormat === RGBA16F || internalFormat === RGB16F || type === HALF_FLOAT) {
        return Object.freeze({
            format: 'rgba16float',
            bytesPerPixel: 8,
            storage: 'f16',
            sampleType: 'float',
            isDepth: false
        });
    }
    if (internalFormat === SRGB8 || internalFormat === SRGB8_ALPHA8) {
        return Object.freeze({
            format: 'rgba8unorm-srgb',
            bytesPerPixel: 4,
            storage: 'u8',
            sampleType: 'float',
            isDepth: false
        });
    }
    if (
        type === UNSIGNED_BYTE &&
        (internalFormat === RGBA ||
            internalFormat === RGB ||
            internalFormat === RGBA8 ||
            internalFormat === RGB8)
    ) {
        return Object.freeze({
            format: 'rgba8unorm',
            bytesPerPixel: 4,
            storage: 'u8',
            sampleType: 'float',
            isDepth: false
        });
    }
    throw new TypeError(
        `Texture format/type ${String(internalFormat)}/${String(type)} has no supported WebGPU mapping`
    );
}

function mapAddressMode(value: GLenum): GPUAddressMode {
    switch (value) {
        case CLAMP_TO_EDGE:
            return 'clamp-to-edge';
        case REPEAT:
            return 'repeat';
        case MIRRORED_REPEAT:
            return 'mirror-repeat';
        default:
            throw new TypeError(`Unsupported texture wrap mode: ${String(value)}`);
    }
}

function mapMagFilter(value: GLenum): GPUFilterMode {
    switch (value) {
        case NEAREST:
            return 'nearest';
        case LINEAR:
            return 'linear';
        default:
            throw new TypeError(`Unsupported texture magnification filter: ${String(value)}`);
    }
}

function mapMinFilters(value: GLenum): {
    minFilter: GPUFilterMode;
    mipmapFilter: GPUMipmapFilterMode;
} {
    switch (value) {
        case NEAREST:
        case NEAREST_MIPMAP_NEAREST:
            return { minFilter: 'nearest', mipmapFilter: 'nearest' };
        case LINEAR:
        case LINEAR_MIPMAP_NEAREST:
            return { minFilter: 'linear', mipmapFilter: 'nearest' };
        case NEAREST_MIPMAP_LINEAR:
            return { minFilter: 'nearest', mipmapFilter: 'linear' };
        case LINEAR_MIPMAP_LINEAR:
            return { minFilter: 'linear', mipmapFilter: 'linear' };
        default:
            throw new TypeError(`Unsupported texture minification filter: ${String(value)}`);
    }
}

/** Map a WebGL comparison constant or validate an already native value. */
export function resolveWebGPUCompareFunction(
    compare: GLenum | GPUCompareFunction
): GPUCompareFunction {
    if (typeof compare === 'string') {
        switch (compare) {
            case 'never':
            case 'less':
            case 'equal':
            case 'less-equal':
            case 'greater':
            case 'not-equal':
            case 'greater-equal':
            case 'always':
                return compare;
            default:
                throw new TypeError(`Unsupported WebGPU comparison function: ${String(compare)}`);
        }
    }
    switch (compare) {
        case NEVER:
            return 'never';
        case LESS:
            return 'less';
        case EQUAL:
            return 'equal';
        case LEQUAL:
            return 'less-equal';
        case GREATER:
            return 'greater';
        case NOTEQUAL:
            return 'not-equal';
        case GEQUAL:
            return 'greater-equal';
        case ALWAYS:
            return 'always';
        default:
            throw new TypeError(`Unsupported texture comparison function: ${String(compare)}`);
    }
}

/** Build a native immutable sampler descriptor from the backend-neutral Texture state. */
export function createWebGPUSamplerDescriptor(
    texture: Texture<unknown>,
    mipLevelCount: number,
    compare?: GLenum | GPUCompareFunction
): GPUSamplerDescriptor {
    if (!Number.isSafeInteger(mipLevelCount) || mipLevelCount <= 0) {
        throw new RangeError('WebGPU sampler mipLevelCount must be a positive integer');
    }
    const magFilter = mapMagFilter(texture.magFilter);
    const minFilters = mapMinFilters(texture.minFilter);
    let { mipmapFilter } = minFilters;
    const anisotropy = texture.anisotropic;
    if (!Number.isFinite(anisotropy) || anisotropy < 1 || !Number.isInteger(anisotropy)) {
        throw new RangeError('Texture anisotropy must be a positive integer');
    }
    if (anisotropy > 16) {
        throw new RangeError('WebGPU texture anisotropy cannot exceed 16');
    }
    if (anisotropy > 1) {
        if (magFilter !== 'linear' || minFilters.minFilter !== 'linear') {
            throw new TypeError('Anisotropic WebGPU samplers require linear min/mag filters');
        }
        mipmapFilter = 'linear';
    }

    return {
        addressModeU: mapAddressMode(texture.wrapS),
        addressModeV: mapAddressMode(texture.wrapT),
        addressModeW: mapAddressMode(texture.wrapT),
        magFilter,
        minFilter: minFilters.minFilter,
        mipmapFilter,
        lodMinClamp: 0,
        lodMaxClamp: Math.max(0, mipLevelCount - 1),
        ...(compare === undefined ? {} : { compare: resolveWebGPUCompareFunction(compare) }),
        ...(anisotropy === 1 ? {} : { maxAnisotropy: anisotropy })
    };
}

function requiredTypedArray(
    source: TypedArray,
    storage: TextureComponentStorage
): Uint8Array | Uint8ClampedArray | Uint16Array | Float32Array {
    if (storage === 'u8' && (source instanceof Uint8Array || source instanceof Uint8ClampedArray)) {
        return source;
    }
    if (storage === 'f16' && source instanceof Uint16Array) return source;
    if (storage === 'f32' && source instanceof Float32Array) return source;
    throw new TypeError(`Typed texture data does not match WebGPU ${storage} component storage`);
}

/** Expand tightly packed RGB input to the RGBA storage formats exposed by WebGPU. */
export function expandRGBToRGBA(
    source: TypedArray,
    storage: Exclude<TextureComponentStorage, 'depth'>,
    pixelCount: number
): Uint8Array | Uint16Array | Float32Array {
    const data = requiredTypedArray(source, storage);
    const expectedLength = pixelCount * 3;
    if (data.length < expectedLength) {
        throw new RangeError(
            `RGB texture data contains ${String(data.length)} values; ${String(expectedLength)} are required`
        );
    }
    if (storage === 'u8') {
        const output = new Uint8Array(pixelCount * 4);
        for (let pixel = 0; pixel < pixelCount; pixel++) {
            const sourceOffset = pixel * 3;
            const targetOffset = pixel * 4;
            output[targetOffset] = data[sourceOffset] ?? 0;
            output[targetOffset + 1] = data[sourceOffset + 1] ?? 0;
            output[targetOffset + 2] = data[sourceOffset + 2] ?? 0;
            output[targetOffset + 3] = 255;
        }
        return output;
    }
    if (storage === 'f16') {
        const output = new Uint16Array(pixelCount * 4);
        for (let pixel = 0; pixel < pixelCount; pixel++) {
            const sourceOffset = pixel * 3;
            const targetOffset = pixel * 4;
            output[targetOffset] = data[sourceOffset] ?? 0;
            output[targetOffset + 1] = data[sourceOffset + 1] ?? 0;
            output[targetOffset + 2] = data[sourceOffset + 2] ?? 0;
            output[targetOffset + 3] = HALF_FLOAT_ONE;
        }
        return output;
    }
    const output = new Float32Array(pixelCount * 4);
    for (let pixel = 0; pixel < pixelCount; pixel++) {
        const sourceOffset = pixel * 3;
        const targetOffset = pixel * 4;
        output[targetOffset] = data[sourceOffset] ?? 0;
        output[targetOffset + 1] = data[sourceOffset + 1] ?? 0;
        output[targetOffset + 2] = data[sourceOffset + 2] ?? 0;
        output[targetOffset + 3] = 1;
    }
    return output;
}

function rgbaTypedData(
    texture: Texture<unknown>,
    source: TypedArray,
    formatInfo: WebGPUTextureFormatInfo,
    width: number,
    height: number
): Uint8Array | Uint8ClampedArray | Uint16Array | Float32Array {
    if (formatInfo.storage === 'depth') {
        throw new TypeError('Typed-array uploads to WebGPU depth textures are not supported');
    }
    const pixels = width * height;
    if (texture.format === RGB) {
        return expandRGBToRGBA(source, formatInfo.storage, pixels);
    }
    if (texture.format !== RGBA) {
        throw new TypeError(`Unsupported typed texture source format: ${String(texture.format)}`);
    }
    const data = requiredTypedArray(source, formatInfo.storage);
    const expectedLength = pixels * 4;
    if (data.length < expectedLength) {
        throw new RangeError(
            `RGBA texture data contains ${String(data.length)} values; ${String(expectedLength)} are required`
        );
    }
    return data;
}

function descriptorDimensions(
    texture: Texture<unknown>,
    isCube: boolean
): {
    width: number;
    height: number;
} {
    let width = positiveDimension(texture.width);
    let height = positiveDimension(texture.height);
    if (texture.isImageReleased) {
        if (width === null || height === null) {
            throw new RangeError('Released WebGPU textures require cached positive dimensions');
        }
        return { width, height };
    }
    const image = texture.image;
    const sources = isCube ? image : [image];
    if (isCube && (!Array.isArray(sources) || sources.length !== 6)) {
        throw new TypeError('WebGPU cube textures require exactly six faces');
    }
    if (!Array.isArray(sources)) {
        throw new TypeError('WebGPU cube texture image data must be an array');
    }
    for (const source of sources) {
        if (source === null || source === undefined || isTypedArray(source)) continue;
        if (!isExternalImageSource(source)) {
            throw new TypeError('Texture image is not a supported WebGPU image source');
        }
        const size = externalImageSize(source);
        if (width !== null && width !== size.width) {
            throw new RangeError('All WebGPU texture image sources must have the same width');
        }
        if (height !== null && height !== size.height) {
            throw new RangeError('All WebGPU texture image sources must have the same height');
        }
        width = size.width;
        height = size.height;
    }
    if (width === null || height === null) {
        throw new RangeError('WebGPU textures require positive width and height');
    }
    texture.width = width;
    texture.height = height;
    return { width, height };
}

function calculateMipLevelCount(width: number, height: number): number {
    return Math.floor(Math.log2(Math.max(width, height))) + 1;
}

const MIPMAP_SHADER = /* wgsl */ `
struct VertexOutput {
    @builtin(position) position: vec4<f32>,
}

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    var positions = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(3.0, -1.0),
        vec2<f32>(-1.0, 3.0)
    );
    var output: VertexOutput;
    output.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
    return output;
}

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;

@fragment
fn fragmentMain(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
    let dimensions = vec2<i32>(textureDimensions(sourceTexture));
    let maximum = dimensions - vec2<i32>(1);
    let origin = vec2<i32>(position.xy) * 2;
    let a = textureLoad(sourceTexture, min(origin, maximum), 0);
    let b = textureLoad(sourceTexture, min(origin + vec2<i32>(1, 0), maximum), 0);
    let c = textureLoad(sourceTexture, min(origin + vec2<i32>(0, 1), maximum), 0);
    let d = textureLoad(sourceTexture, min(origin + vec2<i32>(1, 1), maximum), 0);
    return (a + b + c + d) * 0.25;
}
`;

/** Owns all WebGPU texture, view, sampler and mipmap-pipeline state for one device. */
export default class WebGPUTextureManager {
    readonly device: GPUDevice;
    private readonly onResourceDestroyed: (() => void) | undefined;
    private resourcesByTexture = new WeakMap<Texture<unknown>, InternalTextureResource>();
    private nativeTextures = new WeakMap<GPUTexture, NativeTextureRecord>();
    private readonly liveResources = new Set<InternalTextureResource>();
    private readonly mipmapPipelines = new Map<GPUTextureFormat, MipmapPipeline>();
    private readonly samplers = new Map<string, GPUSampler>();

    constructor(device: GPUDevice, onResourceDestroyed?: () => void) {
        this.device = device;
        this.onResourceDestroyed = onResourceDestroyed;
    }

    get resourceCount(): number {
        return this.liveResources.size;
    }

    /** Enumerable snapshot for diagnostics and deterministic lifecycle tests. */
    getResources(): readonly WebGPUTextureResource[] {
        return [...this.liveResources].map(resource => {
            const snapshot = resource.snapshots.values().next().value;
            if (!snapshot) throw new Error(`Texture ${resource.textureId} has no sampler snapshot`);
            return snapshot;
        });
    }

    private createDestroyListener(texture: Texture<unknown>): EventListener {
        return () => {
            this.destroy(texture);
        };
    }

    private track(texture: Texture<unknown>, resource: InternalTextureResource): void {
        texture.on('destroy', resource.destroyListener);
        this.resourcesByTexture.set(texture, resource);
        this.liveResources.add(resource);
        let nativeRecord = this.nativeTextures.get(resource.gpuTexture);
        if (!nativeRecord) {
            nativeRecord = { resources: new Set(), owned: resource.owned };
            this.nativeTextures.set(resource.gpuTexture, nativeRecord);
        } else if (resource.owned) {
            nativeRecord.owned = true;
        }
        nativeRecord.resources.add(resource);
    }

    private releaseResource(resource: InternalTextureResource, notify = true): void {
        resource.sourceTexture.off('destroy', resource.destroyListener);
        this.liveResources.delete(resource);
        resource.snapshots.clear();
        if (this.resourcesByTexture.get(resource.sourceTexture) === resource) {
            this.resourcesByTexture.delete(resource.sourceTexture);
        }
        const nativeRecord = this.nativeTextures.get(resource.gpuTexture);
        if (nativeRecord) {
            nativeRecord.resources.delete(resource);
            if (nativeRecord.resources.size === 0) {
                this.nativeTextures.delete(resource.gpuTexture);
                if (nativeRecord.owned) resource.gpuTexture.destroy();
            }
        } else if (resource.owned) {
            resource.gpuTexture.destroy();
        }
        if (notify) this.onResourceDestroyed?.();
    }

    private validateSamplerRequest(
        descriptor: ResolvedTextureDescriptor,
        options: WebGPUTextureRequestOptions
    ): void {
        if (options.compare !== undefined && !descriptor.formatInfo.isDepth) {
            throw new TypeError('Comparison samplers require a WebGPU depth texture');
        }
    }

    private resolveSampler(
        texture: Texture<unknown>,
        descriptor: ResolvedTextureDescriptor,
        options: WebGPUTextureRequestOptions
    ): { readonly key: string; readonly sampler: GPUSampler } {
        this.validateSamplerRequest(descriptor, options);
        const samplerDescriptor = createWebGPUSamplerDescriptor(
            texture,
            descriptor.mipLevelCount,
            options.compare
        );
        const key = JSON.stringify(samplerDescriptor);
        let sampler = this.samplers.get(key);
        if (!sampler) {
            sampler = this.device.createSampler(samplerDescriptor);
            this.samplers.set(key, sampler);
        }
        return { key, sampler };
    }

    private snapshotResource(
        resource: InternalTextureResource,
        samplerKey: string,
        sampler: GPUSampler
    ): WebGPUTextureResource {
        const cached = resource.snapshots.get(samplerKey);
        if (cached) return cached;
        const snapshot: WebGPUTextureResource = Object.freeze({
            textureId: resource.textureId,
            gpuTexture: resource.gpuTexture,
            view: resource.view,
            sampler,
            format: resource.format,
            width: resource.width,
            height: resource.height,
            depthOrArrayLayers: resource.depthOrArrayLayers,
            mipLevelCount: resource.mipLevelCount,
            dimension: resource.dimension
        });
        resource.snapshots.set(samplerKey, snapshot);
        return snapshot;
    }

    private resolveDescriptor(texture: Texture<unknown>): ResolvedTextureDescriptor {
        const formatInfo = resolveWebGPUTextureFormat(texture);
        if (texture.target !== TEXTURE_2D && texture.target !== TEXTURE_CUBE_MAP) {
            throw new TypeError(
                `WebGPUTextureManager supports only 2D and cube textures; target ${String(texture.target)} is unsupported`
            );
        }
        const isCube = texture.target === TEXTURE_CUBE_MAP;
        const dimensions = descriptorDimensions(texture, isCube);
        if (isCube && dimensions.width !== dimensions.height) {
            throw new RangeError('WebGPU cube textures must have square faces');
        }
        const fullMipLevelCount = texture.useMipmap
            ? calculateMipLevelCount(dimensions.width, dimensions.height)
            : 1;
        const hasExplicitMipmaps = texture.useMipmap && (texture.mipmaps?.length ?? 0) > 0;
        if (formatInfo.isDepth && texture.useMipmap) {
            throw new TypeError(
                'Automatic mipmap generation for WebGPU depth textures is unsupported'
            );
        }
        if (isCube && hasExplicitMipmaps) {
            throw new TypeError('Explicit cube mipmaps require per-face data and are unsupported');
        }
        if (hasExplicitMipmaps && texture.mipmaps?.length !== fullMipLevelCount) {
            throw new RangeError(
                `Explicit mipmap chain has ${String(texture.mipmaps?.length ?? 0)} levels; ${String(fullMipLevelCount)} are required`
            );
        }
        const layers = isCube ? 6 : 1;
        return {
            key: [
                formatInfo.format,
                dimensions.width,
                dimensions.height,
                layers,
                fullMipLevelCount,
                isCube ? 'cube' : '2d'
            ].join(':'),
            formatInfo,
            width: dimensions.width,
            height: dimensions.height,
            layers,
            mipLevelCount: fullMipLevelCount,
            isCube,
            hasExplicitMipmaps
        };
    }

    private validateDeviceSupport(descriptor: ResolvedTextureDescriptor): void {
        if (
            descriptor.formatInfo.format === 'depth32float-stencil8' &&
            !this.device.features.has('depth32float-stencil8')
        ) {
            throw new TypeError(
                'WebGPU format depth32float-stencil8 requires the depth32float-stencil8 device feature'
            );
        }
        const maxDimension = this.device.limits.maxTextureDimension2D;
        if (descriptor.width > maxDimension || descriptor.height > maxDimension) {
            throw new RangeError(
                `WebGPU texture size ${String(descriptor.width)}x${String(descriptor.height)} exceeds maxTextureDimension2D ${String(maxDimension)}`
            );
        }
        if (descriptor.layers > this.device.limits.maxTextureArrayLayers) {
            throw new RangeError(
                `WebGPU texture requires ${String(descriptor.layers)} layers; device supports ${String(this.device.limits.maxTextureArrayLayers)}`
            );
        }
    }

    private createResource(
        texture: Texture<unknown>,
        descriptor: ResolvedTextureDescriptor,
        options: WebGPUTextureRequestOptions
    ): InternalTextureResource {
        this.validateDeviceSupport(descriptor);
        const samplerRequest = this.resolveSampler(texture, descriptor, options);
        const gpuTexture = this.device.createTexture({
            label: texture.name || texture.id,
            size: {
                width: descriptor.width,
                height: descriptor.height,
                depthOrArrayLayers: descriptor.layers
            },
            mipLevelCount: descriptor.mipLevelCount,
            sampleCount: 1,
            dimension: '2d',
            format: descriptor.formatInfo.format,
            usage: COPY_SRC | COPY_DST | TEXTURE_BINDING | RENDER_ATTACHMENT
        });
        try {
            const resource: InternalTextureResource = {
                sourceTexture: texture,
                destroyListener: this.createDestroyListener(texture),
                textureId: texture.id,
                gpuTexture,
                view: gpuTexture.createView(
                    descriptor.isCube
                        ? { dimension: 'cube', baseArrayLayer: 0, arrayLayerCount: 6 }
                        : { dimension: '2d' }
                ),
                format: descriptor.formatInfo.format,
                width: descriptor.width,
                height: descriptor.height,
                depthOrArrayLayers: descriptor.layers,
                mipLevelCount: descriptor.mipLevelCount,
                dimension: descriptor.isCube ? 'cube' : '2d',
                descriptor,
                snapshots: new Map(),
                owned: true,
                uploadedRevision: 0
            };
            this.snapshotResource(resource, samplerRequest.key, samplerRequest.sampler);
            this.track(texture, resource);
            return resource;
        } catch (error) {
            gpuTexture.destroy();
            throw error;
        }
    }

    private uploadTypedArray(
        texture: Texture<unknown>,
        resource: InternalTextureResource,
        formatInfo: WebGPUTextureFormatInfo,
        source: TypedArray,
        width: number,
        height: number,
        mipLevel: number,
        layer: number,
        x = 0,
        y = 0
    ): void {
        const data = rgbaTypedData(texture, source, formatInfo, width, height);
        this.device.queue.writeTexture(
            {
                texture: resource.gpuTexture,
                mipLevel,
                origin: { x, y, z: layer }
            },
            data,
            { offset: 0, bytesPerRow: width * formatInfo.bytesPerPixel, rowsPerImage: height },
            { width, height, depthOrArrayLayers: 1 }
        );
    }

    private uploadExternalImage(
        texture: Texture<unknown>,
        resource: InternalTextureResource,
        source: GPUCopyExternalImageSource,
        mipLevel: number,
        layer: number,
        x = 0,
        y = 0
    ): void {
        if (!texture.colorSpaceConversion) {
            throw new TypeError(
                'WebGPU external-image copies do not provide WebGL NONE color-space conversion semantics'
            );
        }
        const size = externalImageSize(source);
        this.device.queue.copyExternalImageToTexture(
            { source, flipY: texture.flipY },
            {
                texture: resource.gpuTexture,
                mipLevel,
                origin: { x, y, z: layer },
                premultipliedAlpha: texture.premultiplyAlpha,
                colorSpace: 'srgb'
            },
            { width: size.width, height: size.height, depthOrArrayLayers: 1 }
        );
    }

    private uploadSource(
        texture: Texture<unknown>,
        resource: InternalTextureResource,
        formatInfo: WebGPUTextureFormatInfo,
        source: TypedArray | GPUCopyExternalImageSource,
        width: number,
        height: number,
        mipLevel: number,
        layer: number
    ): void {
        if (isTypedArray(source)) {
            this.uploadTypedArray(
                texture,
                resource,
                formatInfo,
                source,
                width,
                height,
                mipLevel,
                layer
            );
            return;
        }
        if (!isExternalImageSource(source)) {
            throw new TypeError('Texture image is not a supported WebGPU image source');
        }
        this.uploadExternalImage(texture, resource, source, mipLevel, layer);
    }

    private uploadBaseTexture(
        texture: Texture<unknown>,
        resource: InternalTextureResource,
        descriptor: ResolvedTextureDescriptor
    ): void {
        if (descriptor.hasExplicitMipmaps) {
            texture.mipmaps?.forEach((mipmap, level) => {
                const expectedWidth = Math.max(1, descriptor.width >> level);
                const expectedHeight = Math.max(1, descriptor.height >> level);
                if (mipmap.width !== expectedWidth || mipmap.height !== expectedHeight) {
                    throw new RangeError(
                        `Mipmap ${String(level)} is ${String(mipmap.width)}x${String(mipmap.height)}; expected ${String(expectedWidth)}x${String(expectedHeight)}`
                    );
                }
                this.uploadTypedArray(
                    texture,
                    resource,
                    descriptor.formatInfo,
                    mipmap.data,
                    mipmap.width,
                    mipmap.height,
                    level,
                    0
                );
            });
            return;
        }

        const image = texture.image;
        if (descriptor.isCube) {
            if (!Array.isArray(image) || image.length !== 6) {
                throw new TypeError('WebGPU cube textures require exactly six faces');
            }
            image.forEach((face, layer) => {
                if (face === null) return;
                if (!isTypedArray(face) && !isExternalImageSource(face)) {
                    throw new TypeError(
                        `WebGPU cube face ${String(layer)} has an unsupported source`
                    );
                }
                this.uploadSource(
                    texture,
                    resource,
                    descriptor.formatInfo,
                    face,
                    descriptor.width,
                    descriptor.height,
                    0,
                    layer
                );
            });
            return;
        }
        if (image === null) return;
        if (!isTypedArray(image) && !isExternalImageSource(image)) {
            throw new TypeError('Texture image is not a supported WebGPU image source');
        }
        this.uploadSource(
            texture,
            resource,
            descriptor.formatInfo,
            image,
            descriptor.width,
            descriptor.height,
            0,
            0
        );
    }

    private uploadSubTextures(
        texture: Texture<unknown>,
        resource: InternalTextureResource,
        descriptor: ResolvedTextureDescriptor,
        updates: readonly TextureSubImage[]
    ): void {
        if (updates.length === 0) return;
        if (descriptor.isCube) {
            throw new TypeError('Cube sub-texture updates require an explicit face index');
        }
        for (const update of updates) {
            const { xOffset: x, yOffset: y, image } = update;
            if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || x < 0 || y < 0) {
                throw new RangeError('Sub-texture offsets must be non-negative integers');
            }
            if (isTypedArray(image)) {
                if (x !== 0 || y !== 0) {
                    throw new RangeError(
                        'Typed sub-texture updates require explicit dimensions; the current API only supports full-level typed updates'
                    );
                }
                this.uploadTypedArray(
                    texture,
                    resource,
                    descriptor.formatInfo,
                    image,
                    descriptor.width,
                    descriptor.height,
                    0,
                    0
                );
                continue;
            }
            if (!isExternalImageSource(image)) {
                throw new TypeError('Sub-texture image is not a supported WebGPU image source');
            }
            const size = externalImageSize(image);
            if (x + size.width > descriptor.width || y + size.height > descriptor.height) {
                throw new RangeError('Sub-texture update exceeds the destination texture');
            }
            this.uploadExternalImage(texture, resource, image, 0, 0, x, y);
        }
    }

    private getMipmapPipeline(formatInfo: WebGPUTextureFormatInfo): MipmapPipeline {
        const existing = this.mipmapPipelines.get(formatInfo.format);
        if (existing) return existing;
        if (formatInfo.isDepth) {
            throw new TypeError('Depth mipmap generation is unsupported');
        }
        const bindGroupLayout = this.device.createBindGroupLayout({
            label: `Hilo3d mipmap ${formatInfo.format} bind group`,
            entries: [
                {
                    binding: 0,
                    visibility: FRAGMENT_STAGE,
                    texture: {
                        sampleType: formatInfo.sampleType,
                        viewDimension: '2d',
                        multisampled: false
                    }
                }
            ]
        });
        const pipeline = this.device.createRenderPipeline({
            label: `Hilo3d mipmap ${formatInfo.format} pipeline`,
            layout: this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
            vertex: {
                module: this.device.createShaderModule({
                    label: 'Hilo3d mipmap shader',
                    code: MIPMAP_SHADER
                }),
                entryPoint: 'vertexMain'
            },
            fragment: {
                module: this.device.createShaderModule({
                    label: 'Hilo3d mipmap shader',
                    code: MIPMAP_SHADER
                }),
                entryPoint: 'fragmentMain',
                targets: [{ format: formatInfo.format }]
            },
            primitive: { topology: 'triangle-list' },
            multisample: { count: 1 }
        });
        const result = { bindGroupLayout, pipeline };
        this.mipmapPipelines.set(formatInfo.format, result);
        return result;
    }

    private generateMipmaps(
        resource: InternalTextureResource,
        descriptor: ResolvedTextureDescriptor
    ): void {
        if (descriptor.mipLevelCount <= 1) return;
        const mipmap = this.getMipmapPipeline(descriptor.formatInfo);
        const encoder = this.device.createCommandEncoder({
            label: `Hilo3d mipmap ${resource.textureId}`
        });
        for (let layer = 0; layer < descriptor.layers; layer++) {
            for (let level = 1; level < descriptor.mipLevelCount; level++) {
                const sourceView = resource.gpuTexture.createView({
                    dimension: '2d',
                    baseMipLevel: level - 1,
                    mipLevelCount: 1,
                    baseArrayLayer: layer,
                    arrayLayerCount: 1
                });
                const destinationView = resource.gpuTexture.createView({
                    dimension: '2d',
                    baseMipLevel: level,
                    mipLevelCount: 1,
                    baseArrayLayer: layer,
                    arrayLayerCount: 1
                });
                const bindGroup = this.device.createBindGroup({
                    layout: mipmap.bindGroupLayout,
                    entries: [{ binding: 0, resource: sourceView }]
                });
                const pass = encoder.beginRenderPass({
                    colorAttachments: [
                        {
                            view: destinationView,
                            clearValue: { r: 0, g: 0, b: 0, a: 0 },
                            loadOp: 'clear',
                            storeOp: 'store'
                        }
                    ]
                });
                pass.setPipeline(mipmap.pipeline);
                pass.setBindGroup(0, bindGroup);
                pass.draw(3);
                pass.end();
            }
        }
        this.device.queue.submit([encoder.finish()]);
    }

    /** Resolve, create and synchronise a texture resource for this device. */
    get(
        texture: Texture<unknown>,
        options: WebGPUTextureRequestOptions = {}
    ): WebGPUTextureResource {
        let resource = this.resourcesByTexture.get(texture);
        const resolvedDescriptor = this.resolveDescriptor(texture);
        const descriptor =
            texture.isImageReleased && resource?.descriptor.key === resolvedDescriptor.key
                ? resource.descriptor
                : resolvedDescriptor;
        if (texture.needDestroy || (resource && resource.descriptor.key !== descriptor.key)) {
            if (texture.isImageReleased) {
                throw new Error(
                    `Texture ${texture.id} cannot recreate a changed WebGPU allocation after its image was released`
                );
            }
            this.destroy(texture);
            texture.needDestroy = false;
            resource = undefined;
        }
        let created = false;
        if (!resource) {
            resource = this.createResource(texture, descriptor, options);
            created = true;
        }

        try {
            const samplerRequest = this.resolveSampler(texture, descriptor, options);
            const pending = texture.getTextureUpdatesSince(resource.uploadedRevision);
            const needsFullUpload = created || texture.autoUpdate || pending.requiresFullUpload;
            const updates = needsFullUpload ? texture.getTextureUpdatesSince(0) : pending;
            if (needsFullUpload) {
                this.uploadBaseTexture(texture, resource, descriptor);
            }
            this.uploadSubTextures(texture, resource, descriptor, updates.subTextures);
            if (
                descriptor.mipLevelCount > 1 &&
                ((!descriptor.hasExplicitMipmaps && needsFullUpload) ||
                    updates.subTextures.length > 0)
            ) {
                this.generateMipmaps(resource, descriptor);
            }
            resource.uploadedRevision = updates.revision;
            if (needsFullUpload && updates.revision === texture.updateRevision) {
                texture.needUpdate = false;
            }
            if (resource.uploadedRevision === texture.updateRevision) {
                texture.releaseImageIfAllowed();
            }
            return this.snapshotResource(resource, samplerRequest.key, samplerRequest.sampler);
        } catch (error) {
            if (created) this.destroy(texture);
            throw error;
        }
    }

    /**
     * Register a renderer-created texture (render target, shadow atlas, etc.) under the same
     * backend-neutral Texture identity used by material bindings.
     */
    registerExternal(
        texture: Texture<unknown>,
        gpuTexture: GPUTexture,
        options: WebGPUExternalTextureOptions = {}
    ): WebGPUTextureResource {
        const existing = this.resourcesByTexture.get(texture);
        const owned = options.takeOwnership ?? true;
        try {
            const descriptor = this.resolveDescriptor(texture);
            this.validateDeviceSupport(descriptor);
            const samplerRequest = this.resolveSampler(texture, descriptor, options);
            const expectedDimension = descriptor.isCube ? 'cube' : '2d';
            if (
                options.viewDescriptor?.dimension !== undefined &&
                options.viewDescriptor.dimension !== expectedDimension
            ) {
                throw new TypeError(
                    `External WebGPU texture view dimension ${options.viewDescriptor.dimension} does not match ${expectedDimension}`
                );
            }
            const defaultViewDescriptor: GPUTextureViewDescriptor = descriptor.isCube
                ? { dimension: 'cube', baseArrayLayer: 0, arrayLayerCount: 6 }
                : { dimension: '2d' };
            const resource: InternalTextureResource = {
                sourceTexture: texture,
                destroyListener: this.createDestroyListener(texture),
                textureId: texture.id,
                gpuTexture,
                view: gpuTexture.createView({
                    ...defaultViewDescriptor,
                    ...options.viewDescriptor
                }),
                format: descriptor.formatInfo.format,
                width: descriptor.width,
                height: descriptor.height,
                depthOrArrayLayers: descriptor.layers,
                mipLevelCount: descriptor.mipLevelCount,
                dimension: expectedDimension,
                descriptor,
                snapshots: new Map(),
                owned,
                uploadedRevision: texture.updateRevision
            };
            const snapshot = this.snapshotResource(
                resource,
                samplerRequest.key,
                samplerRequest.sampler
            );

            // Add the replacement before releasing the old alias. The native reference record
            // therefore never reaches zero when both registrations use the same GPUTexture.
            this.track(texture, resource);
            if (existing) this.releaseResource(existing);
            texture.needUpdate = false;
            texture.needDestroy = false;
            return snapshot;
        } catch (error) {
            // `takeOwnership` transfers cleanup responsibility at call entry. Never destroy a
            // native texture already registered by this manager because the old alias is live.
            if (owned && !this.nativeTextures.has(gpuTexture)) gpuTexture.destroy();
            throw error;
        }
    }

    getGPUTexture(
        texture: Texture<unknown>,
        options: WebGPUTextureRequestOptions = {}
    ): GPUTexture {
        return this.get(texture, options).gpuTexture;
    }

    getSampler(texture: Texture<unknown>, options: WebGPUTextureRequestOptions = {}): GPUSampler {
        return this.get(texture, options).sampler;
    }

    destroy(texture: Texture<unknown>): void {
        const resource = this.resourcesByTexture.get(texture);
        if (!resource) return;
        this.releaseResource(resource);
    }

    /** Destroy every enumerable GPU allocation owned by this manager. */
    destroyAll(): void {
        const hadResources = this.liveResources.size > 0;
        for (const resource of [...this.liveResources]) this.releaseResource(resource, false);
        this.liveResources.clear();
        this.resourcesByTexture = new WeakMap<Texture<unknown>, InternalTextureResource>();
        this.nativeTextures = new WeakMap<GPUTexture, NativeTextureRecord>();
        this.mipmapPipelines.clear();
        this.samplers.clear();
        if (hadResources) this.onResourceDestroyed?.();
    }
}
