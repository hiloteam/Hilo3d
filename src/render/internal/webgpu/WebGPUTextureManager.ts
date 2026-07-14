import {
    getTextureRecoveryBacking,
    observeTextureDestroy,
    unobserveTextureDestroy,
    type default as Texture,
    type TextureDestroyObserver,
    type TextureMipmap
} from '../../../texture/Texture';
import {
    ALWAYS,
    BYTE,
    CLAMP_TO_EDGE,
    DEPTH_COMPONENT,
    DEPTH_COMPONENT16,
    DEPTH_STENCIL,
    EQUAL,
    FLOAT,
    GEQUAL,
    GREATER,
    INT,
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
    SHORT,
    TEXTURE_2D,
    TEXTURE_CUBE_MAP,
    UNSIGNED_BYTE,
    UNSIGNED_INT,
    UNSIGNED_SHORT
} from '../../../constants/webgl';
import { WebGPUDevice } from '../../rhi/webgpu/WebGPUDevice';
import {
    getWebGPUNativeDeviceCache,
    type WebGPUNativeDeviceCache
} from '../../rhi/webgpu/WebGPUNativeCache';
import { touchBoundedLruEntry } from '../../BoundedLruCache';
import {
    COMPRESSED_RGBA_ASTC_4X4_KHR,
    COMPRESSED_RGBA_S3TC_DXT1_EXT,
    COMPRESSED_RGBA_S3TC_DXT3_EXT,
    COMPRESSED_RGBA_S3TC_DXT5_EXT,
    COMPRESSED_RGB_ETC1_WEBGL,
    COMPRESSED_RGB_PVRTC_2BPPV1_IMG,
    COMPRESSED_RGB_PVRTC_4BPPV1_IMG,
    COMPRESSED_RGB_S3TC_DXT1_EXT,
    COMPRESSED_RGBA_PVRTC_2BPPV1_IMG,
    COMPRESSED_RGBA_PVRTC_4BPPV1_IMG,
    COMPRESSED_SRGB8_ALPHA8_ASTC_4X4_KHR,
    COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT,
    COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT,
    COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT,
    COMPRESSED_SRGB_S3TC_DXT1_EXT
} from '../../../constants/webglExtensions';
import {
    COMPRESSED_R11_EAC,
    COMPRESSED_RG11_EAC,
    COMPRESSED_RGB8_ETC2,
    COMPRESSED_RGB8_PUNCHTHROUGH_ALPHA1_ETC2,
    COMPRESSED_RGBA8_ETC2_EAC,
    COMPRESSED_SIGNED_R11_EAC,
    COMPRESSED_SIGNED_RG11_EAC,
    COMPRESSED_SRGB8_ETC2,
    COMPRESSED_SRGB8_ALPHA8_ETC2_EAC,
    COMPRESSED_SRGB8_PUNCHTHROUGH_ALPHA1_ETC2,
    DEPTH24_STENCIL8,
    DEPTH32F_STENCIL8,
    DEPTH_COMPONENT24,
    DEPTH_COMPONENT32F,
    HALF_FLOAT,
    FLOAT_32_UNSIGNED_INT_24_8_REV,
    R8,
    R8I,
    R8UI,
    R16F,
    R16I,
    R16UI,
    R32F,
    R32I,
    R32UI,
    RED,
    RED_INTEGER,
    RG,
    RG8,
    RG8_SNORM,
    RG8I,
    RG8UI,
    RG16F,
    RG16I,
    RG16UI,
    RG32F,
    RG32I,
    RG32UI,
    RG_INTEGER,
    RGB16F,
    RGB16I,
    RGB16UI,
    RGB32F,
    RGB32I,
    RGB32UI,
    RGB8,
    RGB8_SNORM,
    RGB8I,
    RGB8UI,
    RGB_INTEGER,
    RGBA16F,
    RGBA16I,
    RGBA16UI,
    RGBA32F,
    RGBA32I,
    RGBA32UI,
    RGBA8,
    RGBA8_SNORM,
    RGBA8I,
    RGBA8UI,
    RGBA_INTEGER,
    RGB10_A2,
    RGB10_A2UI,
    RGB9_E5,
    R11F_G11F_B10F,
    R8_SNORM,
    SRGB8,
    SRGB8_ALPHA8,
    TEXTURE_2D_ARRAY,
    TEXTURE_3D,
    UNSIGNED_INT_10F_11F_11F_REV,
    UNSIGNED_INT_24_8,
    UNSIGNED_INT_2_10_10_10_REV,
    UNSIGNED_INT_5_9_9_9_REV
} from '../../../constants/webgl2';
import type { TexturePixelData, TextureSubImage, TypedArray } from '../../types';
import {
    flipTexturePixelRows,
    isTexturePixelData,
    textureElementsPerPixel,
    texturePixelDataToTypedArray
} from '../../../texture/texturePixelData';
import type { NagaShaderTranslator, TranslatedShaderPair } from '../../shader/GlslToWgsl';
import mipmapFragmentSource from '../../../shader/webgpu/mipmap.frag';
import mipmapVertexSource from '../../../shader/webgpu/mipmap.vert';
import {
    createWebGPUFullscreenPassBindGroup,
    createWebGPUFullscreenPassResources,
    type WebGPUFullscreenPassResources
} from './WebGPUFullscreenPass';

// WebGPU usage flags are fixed by the specification. Keeping them local makes
// fake-device tests independent from the presence of browser WebGPU globals.
const COPY_SRC = 0x01;
const COPY_DST = 0x02;
const TEXTURE_BINDING = 0x04;
const RENDER_ATTACHMENT = 0x10;
const HALF_FLOAT_ONE = 0x3c00;
const NON_RENDERABLE_MIPMAP_FORMATS = new Set<GPUTextureFormat>([
    'r8snorm',
    'rg8snorm',
    'rgba8snorm',
    'rgb9e5ufloat'
]);

function canUseRenderAttachment(formatInfo: WebGPUTextureFormatInfo, device: GPUDevice): boolean {
    if (formatInfo.isCompressed || NON_RENDERABLE_MIPMAP_FORMATS.has(formatInfo.format)) {
        return false;
    }
    return formatInfo.format !== 'rg11b10ufloat' || device.features.has('rg11b10ufloat-renderable');
}

export type TextureComponentStorage =
    'i8' | 'u8' | 'i16' | 'u16' | 'i32' | 'u32' | 'f16' | 'f32' | 'depth' | 'compressed';

export type WebGPUTextureDimension = '2d' | 'cube' | '2d-array' | '3d';

export interface WebGPUTextureFormatInfo {
    readonly format: GPUTextureFormat;
    readonly bytesPerPixel: number;
    readonly storage: TextureComponentStorage;
    readonly sampleType: GPUTextureSampleType;
    readonly isDepth: boolean;
    readonly isCompressed: boolean;
    readonly blockWidth: number;
    readonly blockHeight: number;
    readonly bytesPerBlock: number;
    readonly requiredFeature?: GPUFeatureName;
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

/** @internal One entry in an atomic renderer-owned external-texture replacement. */
export interface WebGPUExternalTextureRegistration {
    readonly texture: Texture<unknown>;
    readonly gpuTexture: GPUTexture;
    readonly options?: WebGPUExternalTextureOptions;
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
    readonly dimension: WebGPUTextureDimension;
}

interface InternalTextureResource {
    readonly sourceTexture: Texture<unknown>;
    readonly destroyObserver: TextureDestroyObserver;
    /** Distinguishes an observer snapshot for an old allocation from its replacement. */
    readonly destroyToken: object;
    readonly textureId: string;
    readonly gpuTexture: GPUTexture;
    readonly view: GPUTextureView;
    readonly format: GPUTextureFormat;
    readonly width: number;
    readonly height: number;
    readonly depthOrArrayLayers: number;
    readonly mipLevelCount: number;
    readonly dimension: WebGPUTextureDimension;
    readonly descriptor: ResolvedTextureDescriptor;
    /** Comparison function selected by a renderer-owned sampled depth attachment. */
    readonly defaultCompare: GLenum | GPUCompareFunction | undefined;
    readonly videoUpload: VideoUploadState | null;
    readonly snapshots: Map<string, WebGPUTextureResource>;
    readonly owned: boolean;
    uploadedRevision: number;
}

interface ExternalTextureOwner {
    readonly invalidate: (recoverImmediately: boolean) => void;
    readonly ensure: () => void;
    readonly observer: TextureDestroyObserver;
    handling: boolean;
}

interface VideoUploadState {
    readonly source: HTMLVideoElement;
    readonly canvas: HTMLCanvasElement;
    readonly context: CanvasRenderingContext2D;
    callbackHandle: number | null;
    presentedFrame: number;
    uploadedFrame: number;
    copyInFlight: boolean;
    pendingPresentation: boolean;
    stagingError: Error | null;
    queueError: Error | null;
    active: boolean;
}

interface NativeTextureRecord {
    readonly resources: Set<InternalTextureResource>;
    /** Ownership is sticky once transferred so aliases can never observe premature destruction. */
    owned: boolean;
}

/** Global immutable sampler descriptors retained per WebGPU device. */
export const MAX_CACHED_WEBGPU_SAMPLERS = 256;
/** Immutable sampler views retained for one live native texture allocation. */
export const MAX_CACHED_WEBGPU_TEXTURE_SNAPSHOTS = 16;

interface ResolvedTextureDescriptor {
    readonly key: string;
    readonly formatInfo: WebGPUTextureFormatInfo;
    readonly width: number;
    readonly height: number;
    readonly layers: number;
    readonly mipLevelCount: number;
    readonly dimension: WebGPUTextureDimension;
    readonly isCube: boolean;
    readonly isArray: boolean;
    readonly is3D: boolean;
    readonly hasExplicitMipmaps: boolean;
}

interface MipmapPipeline extends WebGPUFullscreenPassResources {
    readonly pipeline: GPURenderPipeline;
}

interface RecoverableTextureBacking {
    readonly descriptor: ResolvedTextureDescriptor;
    readonly image: unknown;
    readonly mipmaps: readonly TextureMipmap[] | null;
    readonly subTextures: readonly TextureSubImage[];
    readonly revision: number;
}

interface RecoverableTextureListenerOwner {
    /** Keep listener ownership enumerable without preventing an otherwise unreachable Texture from collecting. */
    readonly texture: WeakRef<Texture<unknown>>;
    readonly observer: TextureDestroyObserver;
}

function clonePixelData(source: TexturePixelData): TexturePixelData {
    if (source instanceof DataView) {
        const bytes = new Uint8Array(source.byteLength);
        bytes.set(new Uint8Array(source.buffer, source.byteOffset, source.byteLength));
        return new DataView(bytes.buffer);
    }
    return source.slice();
}

/**
 * Keep an immutable byte snapshot for raw sources. DOM-backed sources cannot be cloned
 * synchronously and portably (and videos are intentionally dynamic), so retain their source
 * object privately until the Texture identity becomes unreachable or is explicitly destroyed.
 */
function cloneRecoverableImage(source: unknown): unknown {
    if (isTexturePixelData(source)) return clonePixelData(source);
    if (Array.isArray(source)) return source.map(cloneRecoverableImage);
    if (typeof ImageData !== 'undefined' && source instanceof ImageData) {
        return new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
    }
    return source;
}

function cloneMipmaps(mipmaps: readonly TextureMipmap[] | null): readonly TextureMipmap[] | null {
    return (
        mipmaps?.map(mipmap => ({
            data: clonePixelData(mipmap.data),
            width: mipmap.width,
            height: mipmap.height,
            ...(mipmap.depth === undefined ? {} : { depth: mipmap.depth }),
            ...(mipmap.face === undefined ? {} : { face: mipmap.face })
        })) ?? null
    );
}

function cloneSubTextures(updates: readonly TextureSubImage[]): readonly TextureSubImage[] {
    return updates.map(update => ({
        mipLevel: update.mipLevel,
        ...(update.face === undefined ? {} : { face: update.face }),
        ...(update.layer === undefined ? {} : { layer: update.layer }),
        ...(update.z === undefined ? {} : { z: update.z }),
        x: update.x,
        y: update.y,
        width: update.width,
        height: update.height,
        ...(update.depth === undefined ? {} : { depth: update.depth }),
        image: cloneRecoverableImage(update.image) as TextureSubImage['image']
    }));
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

function isVideoElement(value: unknown): value is HTMLVideoElement {
    return isInstanceOf(value, 'HTMLVideoElement');
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

function colorFormatInfo(
    format: GPUTextureFormat,
    bytesPerPixel: number,
    storage: Exclude<TextureComponentStorage, 'depth' | 'compressed'>,
    sampleType: GPUTextureSampleType
): WebGPUTextureFormatInfo {
    return Object.freeze({
        format,
        bytesPerPixel,
        storage,
        sampleType,
        isDepth: false,
        isCompressed: false,
        blockWidth: 1,
        blockHeight: 1,
        bytesPerBlock: bytesPerPixel
    });
}

function requireTextureDeclaration(
    texture: Texture<unknown>,
    expectedType: GLenum,
    expectedFormats: readonly GLenum[]
): void {
    if (texture.type !== expectedType || !expectedFormats.includes(texture.format)) {
        throw new TypeError(
            `Texture internal format ${String(texture.internalFormat)} requires component type ${String(expectedType)} and source format ${expectedFormats.map(String).join(' or ')}`
        );
    }
}

function integerTextureFormat(
    texture: Texture<unknown>,
    format: GPUTextureFormat,
    bytesPerPixel: number,
    storage: 'i8' | 'u8' | 'i16' | 'u16' | 'i32' | 'u32',
    sourceFormat: GLenum
): WebGPUTextureFormatInfo {
    const signed = storage === 'i8' || storage === 'i16' || storage === 'i32';
    const expectedType =
        storage === 'i8'
            ? BYTE
            : storage === 'u8'
              ? UNSIGNED_BYTE
              : storage === 'i16'
                ? SHORT
                : storage === 'u16'
                  ? UNSIGNED_SHORT
                  : signed
                    ? INT
                    : UNSIGNED_INT;
    requireTextureDeclaration(texture, expectedType, [sourceFormat]);
    return colorFormatInfo(format, bytesPerPixel, storage, signed ? 'sint' : 'uint');
}

function compressedFormatInfo(
    format: GPUTextureFormat,
    requiredFeature: GPUFeatureName,
    bytesPerBlock: number
): WebGPUTextureFormatInfo {
    return Object.freeze({
        format,
        bytesPerPixel: 0,
        storage: 'compressed',
        sampleType: 'float',
        isDepth: false,
        isCompressed: true,
        blockWidth: 4,
        blockHeight: 4,
        bytesPerBlock,
        requiredFeature
    });
}

function resolveCompressedTextureFormat(internalFormat: GLenum): WebGPUTextureFormatInfo {
    switch (internalFormat) {
        case COMPRESSED_RGB_S3TC_DXT1_EXT:
        case COMPRESSED_RGBA_S3TC_DXT1_EXT:
            return compressedFormatInfo('bc1-rgba-unorm', 'texture-compression-bc', 8);
        case COMPRESSED_SRGB_S3TC_DXT1_EXT:
        case COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT:
            return compressedFormatInfo('bc1-rgba-unorm-srgb', 'texture-compression-bc', 8);
        case COMPRESSED_RGBA_S3TC_DXT3_EXT:
            return compressedFormatInfo('bc2-rgba-unorm', 'texture-compression-bc', 16);
        case COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT:
            return compressedFormatInfo('bc2-rgba-unorm-srgb', 'texture-compression-bc', 16);
        case COMPRESSED_RGBA_S3TC_DXT5_EXT:
            return compressedFormatInfo('bc3-rgba-unorm', 'texture-compression-bc', 16);
        case COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT:
            return compressedFormatInfo('bc3-rgba-unorm-srgb', 'texture-compression-bc', 16);
        case COMPRESSED_RGB_ETC1_WEBGL:
        case COMPRESSED_RGB8_ETC2:
            return compressedFormatInfo('etc2-rgb8unorm', 'texture-compression-etc2', 8);
        case COMPRESSED_SRGB8_ETC2:
            return compressedFormatInfo('etc2-rgb8unorm-srgb', 'texture-compression-etc2', 8);
        case COMPRESSED_RGB8_PUNCHTHROUGH_ALPHA1_ETC2:
            return compressedFormatInfo('etc2-rgb8a1unorm', 'texture-compression-etc2', 8);
        case COMPRESSED_SRGB8_PUNCHTHROUGH_ALPHA1_ETC2:
            return compressedFormatInfo('etc2-rgb8a1unorm-srgb', 'texture-compression-etc2', 8);
        case COMPRESSED_RGBA8_ETC2_EAC:
            return compressedFormatInfo('etc2-rgba8unorm', 'texture-compression-etc2', 16);
        case COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:
            return compressedFormatInfo('etc2-rgba8unorm-srgb', 'texture-compression-etc2', 16);
        case COMPRESSED_R11_EAC:
            return compressedFormatInfo('eac-r11unorm', 'texture-compression-etc2', 8);
        case COMPRESSED_SIGNED_R11_EAC:
            return compressedFormatInfo('eac-r11snorm', 'texture-compression-etc2', 8);
        case COMPRESSED_RG11_EAC:
            return compressedFormatInfo('eac-rg11unorm', 'texture-compression-etc2', 16);
        case COMPRESSED_SIGNED_RG11_EAC:
            return compressedFormatInfo('eac-rg11snorm', 'texture-compression-etc2', 16);
        case COMPRESSED_RGBA_ASTC_4X4_KHR:
            return compressedFormatInfo('astc-4x4-unorm', 'texture-compression-astc', 16);
        case COMPRESSED_SRGB8_ALPHA8_ASTC_4X4_KHR:
            return compressedFormatInfo('astc-4x4-unorm-srgb', 'texture-compression-astc', 16);
        case COMPRESSED_RGB_PVRTC_2BPPV1_IMG:
        case COMPRESSED_RGB_PVRTC_4BPPV1_IMG:
        case COMPRESSED_RGBA_PVRTC_2BPPV1_IMG:
        case COMPRESSED_RGBA_PVRTC_4BPPV1_IMG:
            throw new TypeError('PVRTC compressed textures are not supported by WebGPU');
        default:
            throw new TypeError(
                `Compressed texture format ${String(internalFormat)} has no WebGPU mapping`
            );
    }
}

/** Resolve the supported WebGL texture declarations to an explicit WebGPU format. */
export function resolveWebGPUTextureFormat(texture: Texture<unknown>): WebGPUTextureFormatInfo {
    if (texture.compressed) {
        return resolveCompressedTextureFormat(texture.internalFormat);
    }

    const { internalFormat, type, format } = texture;
    if (internalFormat === DEPTH_COMPONENT16) {
        requireTextureDeclaration(texture, UNSIGNED_SHORT, [DEPTH_COMPONENT]);
        return Object.freeze({
            format: 'depth16unorm',
            bytesPerPixel: 2,
            storage: 'depth',
            sampleType: 'depth',
            isDepth: true,
            isCompressed: false,
            blockWidth: 1,
            blockHeight: 1,
            bytesPerBlock: 0
        });
    }
    if (internalFormat === DEPTH_COMPONENT24) {
        requireTextureDeclaration(texture, UNSIGNED_INT, [DEPTH_COMPONENT]);
        return Object.freeze({
            format: 'depth24plus',
            bytesPerPixel: 0,
            storage: 'depth',
            sampleType: 'depth',
            isDepth: true,
            isCompressed: false,
            blockWidth: 1,
            blockHeight: 1,
            bytesPerBlock: 0
        });
    }
    if (internalFormat === DEPTH24_STENCIL8) {
        requireTextureDeclaration(texture, UNSIGNED_INT_24_8, [DEPTH_STENCIL]);
        return Object.freeze({
            format: 'depth24plus-stencil8',
            bytesPerPixel: 0,
            storage: 'depth',
            sampleType: 'depth',
            isDepth: true,
            isCompressed: false,
            blockWidth: 1,
            blockHeight: 1,
            bytesPerBlock: 0
        });
    }
    if (internalFormat === DEPTH_COMPONENT32F) {
        requireTextureDeclaration(texture, FLOAT, [DEPTH_COMPONENT]);
        return Object.freeze({
            format: 'depth32float',
            bytesPerPixel: 4,
            storage: 'depth',
            sampleType: 'depth',
            isDepth: true,
            isCompressed: false,
            blockWidth: 1,
            blockHeight: 1,
            bytesPerBlock: 0
        });
    }
    if (internalFormat === DEPTH32F_STENCIL8) {
        requireTextureDeclaration(texture, FLOAT_32_UNSIGNED_INT_24_8_REV, [DEPTH_STENCIL]);
        return Object.freeze({
            format: 'depth32float-stencil8',
            bytesPerPixel: 8,
            storage: 'depth',
            sampleType: 'depth',
            isDepth: true,
            isCompressed: false,
            blockWidth: 1,
            blockHeight: 1,
            bytesPerBlock: 0,
            requiredFeature: 'depth32float-stencil8'
        });
    }
    if (format === DEPTH_COMPONENT || isDepthInternalFormat(internalFormat)) {
        throw new TypeError(
            `Depth texture internal format ${String(internalFormat)} has no supported WebGPU mapping`
        );
    }

    switch (internalFormat) {
        case R8I:
            return integerTextureFormat(texture, 'r8sint', 1, 'i8', RED_INTEGER);
        case R8UI:
            return integerTextureFormat(texture, 'r8uint', 1, 'u8', RED_INTEGER);
        case RG8I:
            return integerTextureFormat(texture, 'rg8sint', 2, 'i8', RG_INTEGER);
        case RG8UI:
            return integerTextureFormat(texture, 'rg8uint', 2, 'u8', RG_INTEGER);
        case RGB8I:
            return integerTextureFormat(texture, 'rgba8sint', 4, 'i8', RGB_INTEGER);
        case RGB8UI:
            return integerTextureFormat(texture, 'rgba8uint', 4, 'u8', RGB_INTEGER);
        case RGBA8I:
            return integerTextureFormat(texture, 'rgba8sint', 4, 'i8', RGBA_INTEGER);
        case RGBA8UI:
            return integerTextureFormat(texture, 'rgba8uint', 4, 'u8', RGBA_INTEGER);
        case R16I:
            return integerTextureFormat(texture, 'r16sint', 2, 'i16', RED_INTEGER);
        case R16UI:
            return integerTextureFormat(texture, 'r16uint', 2, 'u16', RED_INTEGER);
        case RG16I:
            return integerTextureFormat(texture, 'rg16sint', 4, 'i16', RG_INTEGER);
        case RG16UI:
            return integerTextureFormat(texture, 'rg16uint', 4, 'u16', RG_INTEGER);
        case RGB16I:
            return integerTextureFormat(texture, 'rgba16sint', 8, 'i16', RGB_INTEGER);
        case RGB16UI:
            return integerTextureFormat(texture, 'rgba16uint', 8, 'u16', RGB_INTEGER);
        case RGBA16I:
            return integerTextureFormat(texture, 'rgba16sint', 8, 'i16', RGBA_INTEGER);
        case RGBA16UI:
            return integerTextureFormat(texture, 'rgba16uint', 8, 'u16', RGBA_INTEGER);
        case R32I:
            return integerTextureFormat(texture, 'r32sint', 4, 'i32', RED_INTEGER);
        case R32UI:
            return integerTextureFormat(texture, 'r32uint', 4, 'u32', RED_INTEGER);
        case RG32I:
            return integerTextureFormat(texture, 'rg32sint', 8, 'i32', RG_INTEGER);
        case RG32UI:
            return integerTextureFormat(texture, 'rg32uint', 8, 'u32', RG_INTEGER);
        case RGB32I:
            return integerTextureFormat(texture, 'rgba32sint', 16, 'i32', RGB_INTEGER);
        case RGB32UI:
            return integerTextureFormat(texture, 'rgba32uint', 16, 'u32', RGB_INTEGER);
        case RGBA32I:
            return integerTextureFormat(texture, 'rgba32sint', 16, 'i32', RGBA_INTEGER);
        case RGBA32UI:
            return integerTextureFormat(texture, 'rgba32uint', 16, 'u32', RGBA_INTEGER);
        case R32F:
            requireTextureDeclaration(texture, FLOAT, [RED]);
            return colorFormatInfo('r32float', 4, 'f32', 'unfilterable-float');
        case RG32F:
            requireTextureDeclaration(texture, FLOAT, [RG]);
            return colorFormatInfo('rg32float', 8, 'f32', 'unfilterable-float');
        case RGB32F:
            requireTextureDeclaration(texture, FLOAT, [RGB]);
            return colorFormatInfo('rgba32float', 16, 'f32', 'unfilterable-float');
        case RGBA32F:
            requireTextureDeclaration(texture, FLOAT, [RGBA]);
            return colorFormatInfo('rgba32float', 16, 'f32', 'unfilterable-float');
        case R16F:
            requireTextureDeclaration(texture, HALF_FLOAT, [RED]);
            return colorFormatInfo('r16float', 2, 'f16', 'float');
        case RG16F:
            requireTextureDeclaration(texture, HALF_FLOAT, [RG]);
            return colorFormatInfo('rg16float', 4, 'f16', 'float');
        case RGB16F:
            requireTextureDeclaration(texture, HALF_FLOAT, [RGB]);
            return colorFormatInfo('rgba16float', 8, 'f16', 'float');
        case RGBA16F:
            requireTextureDeclaration(texture, HALF_FLOAT, [RGBA]);
            return colorFormatInfo('rgba16float', 8, 'f16', 'float');
        case R8:
            requireTextureDeclaration(texture, UNSIGNED_BYTE, [RED]);
            return colorFormatInfo('r8unorm', 1, 'u8', 'float');
        case R8_SNORM:
            requireTextureDeclaration(texture, BYTE, [RED]);
            return colorFormatInfo('r8snorm', 1, 'i8', 'float');
        case RG8:
            requireTextureDeclaration(texture, UNSIGNED_BYTE, [RG]);
            return colorFormatInfo('rg8unorm', 2, 'u8', 'float');
        case RG8_SNORM:
            requireTextureDeclaration(texture, BYTE, [RG]);
            return colorFormatInfo('rg8snorm', 2, 'i8', 'float');
        case RGB8:
            requireTextureDeclaration(texture, UNSIGNED_BYTE, [RGB]);
            return colorFormatInfo('rgba8unorm', 4, 'u8', 'float');
        case RGB8_SNORM:
            requireTextureDeclaration(texture, BYTE, [RGB]);
            return colorFormatInfo('rgba8snorm', 4, 'i8', 'float');
        case RGBA8:
            requireTextureDeclaration(texture, UNSIGNED_BYTE, [RGBA]);
            return colorFormatInfo('rgba8unorm', 4, 'u8', 'float');
        case RGBA8_SNORM:
            requireTextureDeclaration(texture, BYTE, [RGBA]);
            return colorFormatInfo('rgba8snorm', 4, 'i8', 'float');
        case RGB10_A2:
            requireTextureDeclaration(texture, UNSIGNED_INT_2_10_10_10_REV, [RGBA]);
            return colorFormatInfo('rgb10a2unorm', 4, 'u32', 'float');
        case RGB10_A2UI:
            requireTextureDeclaration(texture, UNSIGNED_INT_2_10_10_10_REV, [RGBA_INTEGER]);
            return colorFormatInfo('rgb10a2uint', 4, 'u32', 'uint');
        case R11F_G11F_B10F:
            requireTextureDeclaration(texture, UNSIGNED_INT_10F_11F_11F_REV, [RGB]);
            return colorFormatInfo('rg11b10ufloat', 4, 'u32', 'float');
        case RGB9_E5:
            requireTextureDeclaration(texture, UNSIGNED_INT_5_9_9_9_REV, [RGB]);
            return colorFormatInfo('rgb9e5ufloat', 4, 'u32', 'float');
        case SRGB8:
            requireTextureDeclaration(texture, UNSIGNED_BYTE, [RGB]);
            return colorFormatInfo('rgba8unorm-srgb', 4, 'u8', 'float');
        case SRGB8_ALPHA8:
            requireTextureDeclaration(texture, UNSIGNED_BYTE, [RGBA]);
            return colorFormatInfo('rgba8unorm-srgb', 4, 'u8', 'float');
    }

    if (type === FLOAT && (internalFormat === RGB || internalFormat === RGBA)) {
        requireTextureDeclaration(texture, FLOAT, [internalFormat]);
        return colorFormatInfo('rgba32float', 16, 'f32', 'unfilterable-float');
    }
    if (type === HALF_FLOAT && (internalFormat === RGB || internalFormat === RGBA)) {
        requireTextureDeclaration(texture, HALF_FLOAT, [internalFormat]);
        return colorFormatInfo('rgba16float', 8, 'f16', 'float');
    }
    if (type === UNSIGNED_BYTE && (internalFormat === RGB || internalFormat === RGBA)) {
        requireTextureDeclaration(texture, UNSIGNED_BYTE, [internalFormat]);
        return colorFormatInfo('rgba8unorm', 4, 'u8', 'float');
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
        addressModeW: mapAddressMode(texture.wrapR),
        magFilter,
        minFilter: minFilters.minFilter,
        mipmapFilter,
        lodMinClamp: 0,
        lodMaxClamp: Math.max(0, mipLevelCount - 1),
        ...(compare === undefined ? {} : { compare: resolveWebGPUCompareFunction(compare) }),
        ...(anisotropy === 1 ? {} : { maxAnisotropy: anisotropy })
    };
}

/** Canonical immutable sampler key without object reflection or JSON allocation. */
export function getWebGPUSamplerDescriptorKey(descriptor: GPUSamplerDescriptor): string {
    return `${descriptor.addressModeU ?? 'clamp-to-edge'}|${descriptor.addressModeV ?? 'clamp-to-edge'}|${descriptor.addressModeW ?? 'clamp-to-edge'}|${descriptor.magFilter ?? 'nearest'}|${descriptor.minFilter ?? 'nearest'}|${descriptor.mipmapFilter ?? 'nearest'}|${String(descriptor.lodMinClamp ?? 0)}|${String(descriptor.lodMaxClamp ?? 32)}|${descriptor.compare ?? '-'}|${String(descriptor.maxAnisotropy ?? 1)}`;
}

type TextureUploadArray =
    | Int8Array
    | Uint8Array
    | Uint8ClampedArray
    | Int16Array
    | Uint16Array
    | Int32Array
    | Uint32Array
    | Float32Array;

function requiredTypedArray(
    source: TypedArray,
    storage: Exclude<TextureComponentStorage, 'depth' | 'compressed'>
): TextureUploadArray {
    if (storage === 'i8' && source instanceof Int8Array) return source;
    if (storage === 'u8' && (source instanceof Uint8Array || source instanceof Uint8ClampedArray)) {
        return source;
    }
    if (storage === 'i16' && source instanceof Int16Array) return source;
    if (storage === 'u16' && source instanceof Uint16Array) return source;
    if (storage === 'i32' && source instanceof Int32Array) return source;
    if (storage === 'u32' && source instanceof Uint32Array) return source;
    if (storage === 'f16' && source instanceof Uint16Array) return source;
    if (storage === 'f32' && source instanceof Float32Array) return source;
    throw new TypeError(`Typed texture data does not match WebGPU ${storage} component storage`);
}

function createStorageArray(
    storage: Exclude<TextureComponentStorage, 'depth' | 'compressed'>,
    length: number
): TextureUploadArray {
    switch (storage) {
        case 'i8':
            return new Int8Array(length);
        case 'u8':
            return new Uint8Array(length);
        case 'i16':
            return new Int16Array(length);
        case 'u16':
        case 'f16':
            return new Uint16Array(length);
        case 'i32':
            return new Int32Array(length);
        case 'u32':
            return new Uint32Array(length);
        case 'f32':
            return new Float32Array(length);
    }
}

function opaqueAlpha(
    storage: Exclude<TextureComponentStorage, 'depth' | 'compressed'>,
    sampleType: GPUTextureSampleType
): number {
    if (storage === 'f16') return HALF_FLOAT_ONE;
    if (storage === 'u8' && sampleType === 'float') return 255;
    if (storage === 'i8' && sampleType === 'float') return 127;
    return 1;
}

/** Expand tightly packed RGB input to the RGBA storage formats exposed by WebGPU. */
export function expandRGBToRGBA(
    source: TypedArray,
    storage: Exclude<TextureComponentStorage, 'depth' | 'compressed'>,
    pixelCount: number,
    sampleType: GPUTextureSampleType = 'float'
): TextureUploadArray {
    const data = requiredTypedArray(source, storage);
    const expectedLength = pixelCount * 3;
    if (data.length !== expectedLength) {
        throw new RangeError(
            `RGB texture data contains ${String(data.length)} values; ${String(expectedLength)} are required`
        );
    }
    const output = createStorageArray(storage, pixelCount * 4);
    const alpha = opaqueAlpha(storage, sampleType);
    for (let pixel = 0; pixel < pixelCount; pixel++) {
        const sourceOffset = pixel * 3;
        const targetOffset = pixel * 4;
        output[targetOffset] = data[sourceOffset] ?? 0;
        output[targetOffset + 1] = data[sourceOffset + 1] ?? 0;
        output[targetOffset + 2] = data[sourceOffset + 2] ?? 0;
        output[targetOffset + 3] = alpha;
    }
    return output;
}

function textureTypedData(
    texture: Texture<unknown>,
    source: TexturePixelData,
    formatInfo: WebGPUTextureFormatInfo,
    width: number,
    height: number,
    depthOrArrayLayers: number
): TextureUploadArray {
    if (formatInfo.storage === 'depth' || formatInfo.storage === 'compressed') {
        throw new TypeError(
            `Typed color conversion is unavailable for WebGPU ${formatInfo.storage} textures`
        );
    }
    const pixels = width * height * depthOrArrayLayers;
    const typedSource = texturePixelDataToTypedArray(source, texture.type);
    const sourceComponents = textureElementsPerPixel(texture.format, texture.type);
    const data = requiredTypedArray(typedSource, formatInfo.storage);
    const targetComponents = formatInfo.bytesPerPixel / data.BYTES_PER_ELEMENT;
    if (sourceComponents === 3 && targetComponents === 4) {
        return expandRGBToRGBA(typedSource, formatInfo.storage, pixels, formatInfo.sampleType);
    }
    if (!Number.isInteger(targetComponents) || sourceComponents !== targetComponents) {
        throw new TypeError(
            `Texture format ${String(texture.format)} stores ${String(sourceComponents)} component(s), but ${formatInfo.format} requires ${String(targetComponents)}`
        );
    }
    const expectedLength = pixels * sourceComponents;
    if (data.length !== expectedLength) {
        throw new RangeError(
            `Texture data contains ${String(data.length)} values; ${String(expectedLength)} are required`
        );
    }
    return data;
}

function flipTextureImageRows(
    source: TextureUploadArray,
    elementsPerRow: number,
    height: number,
    depthOrArrayLayers: number
): TextureUploadArray {
    if (depthOrArrayLayers === 1) return flipTexturePixelRows(source, elementsPerRow, height);
    const output = source.slice() as TextureUploadArray;
    const rowByteLength = elementsPerRow * source.BYTES_PER_ELEMENT;
    const imageByteLength = rowByteLength * height;
    const sourceBytes = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
    const outputBytes = new Uint8Array(output.buffer, output.byteOffset, output.byteLength);
    for (let image = 0; image < depthOrArrayLayers; image++) {
        const imageOffset = image * imageByteLength;
        for (let targetRow = 0; targetRow < height; targetRow++) {
            const sourceRow = height - targetRow - 1;
            const sourceOffset = imageOffset + sourceRow * rowByteLength;
            outputBytes.set(
                sourceBytes.subarray(sourceOffset, sourceOffset + rowByteLength),
                imageOffset + targetRow * rowByteLength
            );
        }
    }
    return output;
}

function descriptorDimensions(
    texture: Texture<unknown>,
    dimension: WebGPUTextureDimension
): {
    width: number;
    height: number;
    depthOrArrayLayers: number;
} {
    const declaredWidth = positiveDimension(texture.width);
    const declaredHeight = positiveDimension(texture.height);
    const declaredDepth = positiveDimension(texture.depth);
    const isCube = dimension === 'cube';
    const isVolume = dimension === '3d' || dimension === '2d-array';
    if (isVolume) {
        if (declaredWidth === null || declaredHeight === null || declaredDepth === null) {
            throw new RangeError(
                `WebGPU ${dimension} textures require explicit positive width, height and depth`
            );
        }
        if (!texture.isImageReleased) {
            const image = texture.image;
            if (image !== null && !isTexturePixelData(image)) {
                throw new TypeError(`WebGPU ${dimension} textures require tightly packed raw data`);
            }
        }
        return {
            width: declaredWidth,
            height: declaredHeight,
            depthOrArrayLayers: declaredDepth
        };
    }
    if (texture.isImageReleased) {
        if (declaredWidth === null || declaredHeight === null) {
            throw new RangeError('Released WebGPU textures require cached positive dimensions');
        }
        return {
            width: declaredWidth,
            height: declaredHeight,
            depthOrArrayLayers: isCube ? 6 : 1
        };
    }
    const image = texture.image;
    const sources = isCube ? image : [image];
    if (isCube && (!Array.isArray(sources) || sources.length !== 6)) {
        throw new TypeError('WebGPU cube textures require exactly six faces');
    }
    if (!Array.isArray(sources)) {
        throw new TypeError('WebGPU cube texture image data must be an array');
    }
    let externalWidth: number | null = null;
    let externalHeight: number | null = null;
    for (const source of sources) {
        if (source === null || source === undefined || isTexturePixelData(source)) continue;
        if (!isExternalImageSource(source)) {
            throw new TypeError('Texture image is not a supported WebGPU image source');
        }
        let size: { width: number; height: number };
        try {
            size = externalImageSize(source);
        } catch (error: unknown) {
            // A video can be bound before metadata has exposed its intrinsic extent. Explicit
            // Texture dimensions are enough to allocate a legal zero-initialized resource while
            // requestVideoFrameCallback waits for the first decoded frame.
            if (
                error instanceof RangeError &&
                !isCube &&
                isVideoElement(source) &&
                declaredWidth !== null &&
                declaredHeight !== null
            ) {
                continue;
            }
            throw error;
        }
        if (externalWidth !== null && externalWidth !== size.width) {
            throw new RangeError('All WebGPU texture image sources must have the same width');
        }
        if (externalHeight !== null && externalHeight !== size.height) {
            throw new RangeError('All WebGPU texture image sources must have the same height');
        }
        externalWidth = size.width;
        externalHeight = size.height;
    }
    // External-image uploads use the source's intrinsic extent. This also replaces dimensions
    // cached from a LazyTexture placeholder; typed/null sources still require explicit metadata.
    const width = externalWidth ?? declaredWidth;
    const height = externalHeight ?? declaredHeight;
    if (width === null || height === null) {
        throw new RangeError('WebGPU textures require positive width and height');
    }
    texture.width = width;
    texture.height = height;
    return { width, height, depthOrArrayLayers: isCube ? 6 : 1 };
}

function calculateMipLevelCount(width: number, height: number, depth = 1): number {
    return Math.floor(Math.log2(Math.max(width, height, depth))) + 1;
}

/** Owns all WebGPU texture, view, sampler and mipmap-pipeline state for one device. */
export default class WebGPUTextureManager {
    private _device: GPUDevice;
    private _rhiDevice: WebGPUDevice | null;
    private _nativeCache: WebGPUNativeDeviceCache;
    private readonly translator: NagaShaderTranslator;
    private readonly onResourceDestroyed: (() => void) | undefined;
    private resourcesByTexture = new WeakMap<Texture<unknown>, InternalTextureResource>();
    private recoverableBackings = new WeakMap<Texture<unknown>, RecoverableTextureBacking>();
    private recoveryDestroyListeners = new WeakMap<
        Texture<unknown>,
        RecoverableTextureListenerOwner
    >();
    private readonly recoveryListenerOwners = new Set<RecoverableTextureListenerOwner>();
    /**
     * Renderer-owned attachments deliberately keep their logical Texture alive until their
     * owner unregisters it. This prevents a missing target allocation from falling through to
     * the ordinary image-upload path and creating a detached sampled texture.
     */
    private readonly externalTextureOwners = new Map<Texture<unknown>, ExternalTextureOwner>();
    private nativeTextures = new WeakMap<GPUTexture, NativeTextureRecord>();
    private readonly liveResources = new Set<InternalTextureResource>();
    private readonly mipmapPipelines = new Map<GPUTextureFormat, MipmapPipeline>();
    private mipmapShader: TranslatedShaderPair | null = null;
    private submissionActive = false;
    private submissionUsedTextures = new WeakSet<GPUTexture>();
    private readonly deferredTextureDestructions = new Set<GPUTexture>();

    /**
     * @param device - Native device that owns every allocation created by this manager.
     * @param translator - Explicit translator whose asynchronous initialization has completed.
     * @param onResourceDestroyed - Invalidates renderer-owned bindings after resource release.
     */
    constructor(
        device: GPUDevice,
        translator: NagaShaderTranslator,
        onResourceDestroyed?: () => void
    );
    constructor(
        deviceOrOwner: GPUDevice | WebGPUDevice,
        translator: NagaShaderTranslator,
        onResourceDestroyed?: () => void,
        rhiDevice?: WebGPUDevice
    ) {
        const owner = deviceOrOwner instanceof WebGPUDevice ? deviceOrOwner : (rhiDevice ?? null);
        const device =
            deviceOrOwner instanceof WebGPUDevice ? deviceOrOwner.nativeDevice : deviceOrOwner;
        if (rhiDevice && rhiDevice.nativeDevice !== device) {
            throw new TypeError('WebGPU texture manager and RHI device must share a GPUDevice');
        }
        this._device = device;
        this._rhiDevice = owner;
        this._nativeCache = owner?.nativeCache ?? getWebGPUNativeDeviceCache(device);
        this.translator = translator;
        this.onResourceDestroyed = onResourceDestroyed;
    }

    get device(): GPUDevice {
        return this._device;
    }

    get resourceCount(): number {
        return this.liveResources.size;
    }

    private createNativeTexture(descriptor: GPUTextureDescriptor): GPUTexture {
        return (
            this._rhiDevice?.createNativeTexture(descriptor) ??
            this.device.createTexture(descriptor)
        );
    }

    private createNativeShaderModule(descriptor: GPUShaderModuleDescriptor): GPUShaderModule {
        return (
            this._rhiDevice?.createNativeShaderModule(descriptor) ??
            this.device.createShaderModule(descriptor)
        );
    }

    private createNativeCommandEncoder(descriptor: GPUCommandEncoderDescriptor): GPUCommandEncoder {
        return (
            this._rhiDevice?.createNativeCommandEncoder(descriptor) ??
            this.device.createCommandEncoder(descriptor)
        );
    }

    private submitNative(commandBuffers: readonly GPUCommandBuffer[]): void {
        if (this._rhiDevice) this._rhiDevice.submitNative(commandBuffers);
        else this.device.queue.submit(commandBuffers);
    }

    private writeNativeTexture(
        destination: GPUTexelCopyTextureInfo,
        data: AllowSharedBufferSource,
        dataLayout: GPUTexelCopyBufferLayout,
        size: GPUExtent3D
    ): void {
        if (this._rhiDevice) {
            this._rhiDevice.writeNativeTexture(destination, data, dataLayout, size);
        } else {
            this.device.queue.writeTexture(destination, data, dataLayout, size);
        }
    }

    private copyExternalImageToNativeTexture(
        source: GPUCopyExternalImageSourceInfo,
        destination: GPUCopyExternalImageDestInfo,
        size: GPUExtent3D
    ): void {
        if (this._rhiDevice) {
            this._rhiDevice.copyExternalImageToNativeTexture(source, destination, size);
        } else {
            this.device.queue.copyExternalImageToTexture(source, destination, size);
        }
    }

    /** Resolve the comparison default registered by a renderer-owned depth attachment. */
    private defaultCompareFor(texture: Texture<unknown>): GLenum | GPUCompareFunction | undefined {
        return this.resourcesByTexture.get(texture)?.defaultCompare;
    }

    /** Preserve native textures referenced by one pending command-buffer submission. */
    private beginSubmission(): void {
        if (this.submissionActive) {
            throw new Error('A WebGPU texture submission is already active');
        }
        this.submissionActive = true;
        this.submissionUsedTextures = new WeakSet();
    }

    /** Retire deferred textures after their command buffer has been queued or abandoned. */
    private endSubmission(): void {
        if (!this.submissionActive) return;
        this.submissionActive = false;
        for (const texture of this.deferredTextureDestructions) texture.destroy();
        this.deferredTextureDestructions.clear();
        this.submissionUsedTextures = new WeakSet();
    }

    private destroyNativeTexture(texture: GPUTexture): void {
        if (this.submissionActive && this.submissionUsedTextures.has(texture)) {
            this.deferredTextureDestructions.add(texture);
            return;
        }
        texture.destroy();
    }

    private createVideoUploadState(
        source: HTMLVideoElement,
        width: number,
        height: number,
        stagePresentedFrame: boolean
    ): VideoUploadState {
        if (typeof source.requestVideoFrameCallback !== 'function') {
            throw new TypeError(
                'WebGPU video textures require HTMLVideoElement.requestVideoFrameCallback'
            );
        }
        if (typeof document === 'undefined') {
            throw new TypeError('WebGPU HTMLVideoElement textures require a document canvas');
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) {
            throw new Error('Unable to create the WebGPU video staging canvas');
        }
        const state: VideoUploadState = {
            source,
            canvas,
            context,
            callbackHandle: null,
            presentedFrame: 0,
            uploadedFrame: 0,
            copyInFlight: false,
            pendingPresentation: false,
            stagingError: null,
            queueError: null,
            active: true
        };
        const schedule = (): void => {
            if (!state.active) return;
            state.callbackHandle = source.requestVideoFrameCallback((_now, metadata) => {
                state.callbackHandle = null;
                if (!state.active) return;
                try {
                    if (
                        positiveDimension(metadata.width) === null ||
                        positiveDimension(metadata.height) === null
                    ) {
                        throw new RangeError(
                            'Presented video frames must have positive dimensions'
                        );
                    }
                    if (state.copyInFlight) {
                        state.pendingPresentation = true;
                    } else {
                        this.stageCurrentVideoFrame(state);
                    }
                } catch (error: unknown) {
                    state.stagingError =
                        error instanceof Error
                            ? error
                            : new Error('Unable to stage the current video frame', {
                                  cause: error
                              });
                } finally {
                    schedule();
                }
            });
        };
        if (stagePresentedFrame) this.stageCurrentVideoFrame(state);
        schedule();
        return state;
    }

    private stageCurrentVideoFrame(state: VideoUploadState): void {
        try {
            state.context.drawImage(state.source, 0, 0, state.canvas.width, state.canvas.height);
            state.presentedFrame++;
            state.stagingError = null;
        } catch (error: unknown) {
            state.stagingError =
                error instanceof Error
                    ? error
                    : new Error('Unable to stage the current video frame', { cause: error });
        }
    }

    private markVideoCopyInFlight(state: VideoUploadState): void {
        state.copyInFlight = true;
        void this.device.queue.onSubmittedWorkDone().then(
            () => {
                state.copyInFlight = false;
                if (state.active && state.pendingPresentation) {
                    state.pendingPresentation = false;
                    this.stageCurrentVideoFrame(state);
                }
            },
            (error: unknown) => {
                state.copyInFlight = false;
                if (!state.active) return;
                state.queueError = new Error('WebGPU video frame upload did not complete', {
                    cause: error
                });
            }
        );
    }

    private disposeVideoUploadState(state: VideoUploadState | null): void {
        if (!state) return;
        state.active = false;
        state.pendingPresentation = false;
        if (state.callbackHandle !== null) {
            state.source.cancelVideoFrameCallback(state.callbackHandle);
            state.callbackHandle = null;
        }
    }

    /** Enumerable snapshot for diagnostics and deterministic lifecycle tests. */
    getResources(): readonly WebGPUTextureResource[] {
        return [...this.liveResources].map(resource => {
            const snapshot = resource.snapshots.values().next().value;
            if (!snapshot) throw new Error(`Texture ${resource.textureId} has no sampler snapshot`);
            return snapshot;
        });
    }

    private createDestroyObserver(
        texture: Texture<unknown>,
        destroyToken: object
    ): TextureDestroyObserver {
        return () => {
            if (this.resourcesByTexture.get(texture)?.destroyToken !== destroyToken) return;
            this.releaseTextureResource(texture);
        };
    }

    private registerExternalOwner(
        texture: Texture<unknown>,
        invalidate: (recoverImmediately: boolean) => void,
        ensure: () => void
    ): void {
        const existing = this.externalTextureOwners.get(texture);
        if (existing) {
            if (existing.invalidate === invalidate && existing.ensure === ensure) return;
            throw new TypeError(
                `Texture ${texture.id} already belongs to another WebGPU external resource owner`
            );
        }
        const observer: TextureDestroyObserver = () => {
            this.invalidateExternalOwner(texture, true, owner);
        };
        const owner: ExternalTextureOwner = { invalidate, ensure, observer, handling: false };
        this.externalTextureOwners.set(texture, owner);
        observeTextureDestroy(texture, observer);
    }

    private unregisterExternalOwner(texture: Texture<unknown>): void {
        const owner = this.externalTextureOwners.get(texture);
        if (!owner) return;
        unobserveTextureDestroy(texture, owner.observer);
        this.externalTextureOwners.delete(texture);
    }

    private ensureExternalOwnerResource(texture: Texture<unknown>): void {
        const owner = this.externalTextureOwners.get(texture);
        if (!owner) return;
        if (owner.handling) {
            throw new Error(
                `Texture ${texture.id} WebGPU external owner is already handling an allocation change`
            );
        }
        owner.handling = true;
        try {
            owner.ensure();
        } finally {
            owner.handling = false;
        }
    }

    private invalidateExternalOwner(
        texture: Texture<unknown>,
        recoverImmediately: boolean,
        expectedOwner?: ExternalTextureOwner
    ): boolean {
        const owner = this.externalTextureOwners.get(texture);
        if (!owner || owner.handling || (expectedOwner && owner !== expectedOwner)) return false;
        owner.handling = true;
        try {
            // Release the current manager mapping before asking the owner to rebuild. A resource
            // observer that remains in Texture.destroy()'s snapshot is protected by its allocation
            // token and therefore cannot release the replacement.
            this.releaseTextureResource(texture);
            owner.invalidate(recoverImmediately);
            return true;
        } finally {
            owner.handling = false;
        }
    }

    private invalidateAllExternalOwners(recoverImmediately: boolean): void {
        const errors: unknown[] = [];
        for (const [texture, owner] of [...this.externalTextureOwners]) {
            if (this.externalTextureOwners.get(texture) !== owner || owner.handling) continue;
            owner.handling = true;
            try {
                owner.invalidate(recoverImmediately);
            } catch (error: unknown) {
                errors.push(error);
            } finally {
                owner.handling = false;
            }
        }
        if (errors.length === 1) throw errors[0];
        if (errors.length > 1) {
            throw new AggregateError(errors, 'WebGPU external texture invalidation failed');
        }
    }

    private observeRecoverableTexture(texture: Texture<unknown>): void {
        if (this.recoveryDestroyListeners.has(texture)) return;
        const backings = this.recoverableBackings;
        const listenersByTexture = this.recoveryDestroyListeners;
        const listenerOwners = this.recoveryListenerOwners;
        for (const owner of listenerOwners) {
            if (owner.texture.deref() === undefined) listenerOwners.delete(owner);
        }
        const textureReference = new WeakRef(texture);
        const observer: TextureDestroyObserver = () => {
            const observedTexture = textureReference.deref();
            if (!observedTexture) return;
            backings.delete(observedTexture);
            const owner = listenersByTexture.get(observedTexture);
            listenersByTexture.delete(observedTexture);
            if (owner) listenerOwners.delete(owner);
            unobserveTextureDestroy(observedTexture, observer);
        };
        const owner = { texture: textureReference, observer };
        this.recoveryDestroyListeners.set(texture, owner);
        this.recoveryListenerOwners.add(owner);
        observeTextureDestroy(texture, observer);
    }

    private track(texture: Texture<unknown>, resource: InternalTextureResource): void {
        this.deferredTextureDestructions.delete(resource.gpuTexture);
        observeTextureDestroy(texture, resource.destroyObserver);
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
        unobserveTextureDestroy(resource.sourceTexture, resource.destroyObserver);
        this.disposeVideoUploadState(resource.videoUpload);
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
                if (nativeRecord.owned) this.destroyNativeTexture(resource.gpuTexture);
            }
        } else if (resource.owned) {
            this.destroyNativeTexture(resource.gpuTexture);
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
        if (
            (descriptor.formatInfo.sampleType === 'sint' ||
                descriptor.formatInfo.sampleType === 'uint') &&
            (samplerDescriptor.magFilter !== 'nearest' ||
                samplerDescriptor.minFilter !== 'nearest' ||
                samplerDescriptor.mipmapFilter !== 'nearest')
        ) {
            throw new TypeError('Integer WebGPU textures require nearest-only sampling');
        }
        const key = getWebGPUSamplerDescriptorKey(samplerDescriptor);
        const sampler =
            this._rhiDevice?.createNativeSampler(samplerDescriptor) ??
            this._nativeCache.createSampler(samplerDescriptor);
        return { key, sampler };
    }

    private snapshotResource(
        resource: InternalTextureResource,
        samplerKey: string,
        sampler: GPUSampler
    ): WebGPUTextureResource {
        if (this.submissionActive) this.submissionUsedTextures.add(resource.gpuTexture);
        const cached = resource.snapshots.get(samplerKey);
        if (cached?.sampler === sampler) {
            touchBoundedLruEntry(
                resource.snapshots,
                samplerKey,
                cached,
                MAX_CACHED_WEBGPU_TEXTURE_SNAPSHOTS
            );
            return cached;
        }
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
        touchBoundedLruEntry(
            resource.snapshots,
            samplerKey,
            snapshot,
            MAX_CACHED_WEBGPU_TEXTURE_SNAPSHOTS
        );
        return snapshot;
    }

    private resolveDescriptor(
        texture: Texture<unknown>,
        recoveryMipmaps: readonly TextureMipmap[] | null = texture.mipmaps
    ): ResolvedTextureDescriptor {
        const formatInfo = resolveWebGPUTextureFormat(texture);
        let dimension: WebGPUTextureDimension;
        switch (texture.target) {
            case TEXTURE_2D:
                dimension = '2d';
                break;
            case TEXTURE_CUBE_MAP:
                dimension = 'cube';
                break;
            case TEXTURE_2D_ARRAY:
                dimension = '2d-array';
                break;
            case TEXTURE_3D:
                dimension = '3d';
                break;
            default:
                throw new TypeError(
                    `WebGPU texture target ${String(texture.target)} is not a WebGL2 texture dimension`
                );
        }
        const isCube = dimension === 'cube';
        const isArray = dimension === '2d-array';
        const is3D = dimension === '3d';
        const dimensions = descriptorDimensions(texture, dimension);
        if (isCube && dimensions.width !== dimensions.height) {
            throw new RangeError('WebGPU cube textures must have square faces');
        }
        if (is3D && formatInfo.isCompressed) {
            throw new TypeError('WebGPU compressed formats cannot use a 3D texture dimension');
        }
        const fullMipLevelCount = texture.useMipmap
            ? calculateMipLevelCount(
                  dimensions.width,
                  dimensions.height,
                  is3D ? dimensions.depthOrArrayLayers : 1
              )
            : 1;
        const hasExplicitMipmaps = texture.useMipmap && (recoveryMipmaps?.length ?? 0) > 0;
        if (formatInfo.isDepth && texture.useMipmap) {
            throw new TypeError(
                'Automatic mipmap generation for WebGPU depth textures is unsupported'
            );
        }
        if (formatInfo.isCompressed && texture.useMipmap && !hasExplicitMipmaps) {
            throw new TypeError(
                'Compressed WebGPU textures using a mipmap filter require an explicit complete mip chain'
            );
        }
        if (
            texture.useMipmap &&
            !hasExplicitMipmaps &&
            (NON_RENDERABLE_MIPMAP_FORMATS.has(formatInfo.format) ||
                (formatInfo.format === 'rg11b10ufloat' &&
                    !this.device.features.has('rg11b10ufloat-renderable')))
        ) {
            throw new TypeError(
                `WebGPU format ${formatInfo.format} requires an explicit complete mip chain because the device cannot render mip levels in that format`
            );
        }
        if (is3D && texture.useMipmap && !hasExplicitMipmaps) {
            throw new TypeError(
                'WebGPU 3D textures using a mipmap filter require an explicit complete mip chain'
            );
        }
        if (
            (formatInfo.sampleType === 'sint' || formatInfo.sampleType === 'uint') &&
            texture.useMipmap &&
            !hasExplicitMipmaps
        ) {
            throw new TypeError(
                'Integer WebGPU textures using a mipmap filter require an explicit complete mip chain'
            );
        }
        const explicitEntryCount = isCube ? fullMipLevelCount * 6 : fullMipLevelCount;
        if (hasExplicitMipmaps && recoveryMipmaps?.length !== explicitEntryCount) {
            throw new RangeError(
                isCube
                    ? `Explicit cube mipmap chain has ${String(recoveryMipmaps?.length ?? 0)} face entries; ${String(explicitEntryCount)} are required`
                    : `Explicit mipmap chain has ${String(recoveryMipmaps?.length ?? 0)} levels; ${String(fullMipLevelCount)} are required`
            );
        }
        const layers = dimensions.depthOrArrayLayers;
        return {
            key: [
                formatInfo.format,
                dimensions.width,
                dimensions.height,
                layers,
                fullMipLevelCount,
                dimension
            ].join(':'),
            formatInfo,
            width: dimensions.width,
            height: dimensions.height,
            layers,
            mipLevelCount: fullMipLevelCount,
            dimension,
            isCube,
            isArray,
            is3D,
            hasExplicitMipmaps
        };
    }

    private validateDeviceSupport(descriptor: ResolvedTextureDescriptor): void {
        const requiredFeature = descriptor.formatInfo.requiredFeature;
        if (requiredFeature !== undefined && !this.device.features.has(requiredFeature)) {
            throw new TypeError(
                `WebGPU format ${descriptor.formatInfo.format} requires device feature ${requiredFeature}`
            );
        }
        if (
            descriptor.formatInfo.format === 'depth32float-stencil8' &&
            !this.device.features.has('depth32float-stencil8')
        ) {
            throw new TypeError(
                'WebGPU format depth32float-stencil8 requires the depth32float-stencil8 device feature'
            );
        }
        const maxDimension = descriptor.is3D
            ? this.device.limits.maxTextureDimension3D
            : this.device.limits.maxTextureDimension2D;
        if (
            descriptor.width > maxDimension ||
            descriptor.height > maxDimension ||
            (descriptor.is3D && descriptor.layers > maxDimension)
        ) {
            throw new RangeError(
                `WebGPU ${descriptor.dimension} texture size ${String(descriptor.width)}x${String(descriptor.height)}x${String(descriptor.layers)} exceeds its ${String(maxDimension)} dimension limit`
            );
        }
        if (!descriptor.is3D && descriptor.layers > this.device.limits.maxTextureArrayLayers) {
            throw new RangeError(
                `WebGPU texture requires ${String(descriptor.layers)} layers; device supports ${String(this.device.limits.maxTextureArrayLayers)}`
            );
        }
    }

    private createResource(
        texture: Texture<unknown>,
        descriptor: ResolvedTextureDescriptor,
        options: WebGPUTextureRequestOptions,
        sourceImage: unknown,
        stagePresentedVideoFrame = false
    ): InternalTextureResource {
        this.validateDeviceSupport(descriptor);
        const samplerRequest = this.resolveSampler(texture, descriptor, options);
        const gpuTexture = this.createNativeTexture({
            label: texture.name || texture.id,
            size: {
                width: descriptor.width,
                height: descriptor.height,
                depthOrArrayLayers: descriptor.layers
            },
            mipLevelCount: descriptor.mipLevelCount,
            sampleCount: 1,
            dimension: descriptor.is3D ? '3d' : '2d',
            format: descriptor.formatInfo.format,
            usage:
                COPY_SRC |
                COPY_DST |
                TEXTURE_BINDING |
                (canUseRenderAttachment(descriptor.formatInfo, this.device) ? RENDER_ATTACHMENT : 0)
        });
        let videoUpload: VideoUploadState | null = null;
        try {
            videoUpload =
                !descriptor.isCube && isVideoElement(sourceImage)
                    ? this.createVideoUploadState(
                          sourceImage,
                          descriptor.width,
                          descriptor.height,
                          stagePresentedVideoFrame
                      )
                    : null;
            const destroyToken = {};
            const resource: InternalTextureResource = {
                sourceTexture: texture,
                destroyObserver: this.createDestroyObserver(texture, destroyToken),
                destroyToken,
                textureId: texture.id,
                gpuTexture,
                view: gpuTexture.createView(
                    descriptor.isCube
                        ? { dimension: 'cube', baseArrayLayer: 0, arrayLayerCount: 6 }
                        : descriptor.isArray
                          ? {
                                dimension: '2d-array',
                                baseArrayLayer: 0,
                                arrayLayerCount: descriptor.layers
                            }
                          : { dimension: descriptor.is3D ? '3d' : '2d' }
                ),
                format: descriptor.formatInfo.format,
                width: descriptor.width,
                height: descriptor.height,
                depthOrArrayLayers: descriptor.layers,
                mipLevelCount: descriptor.mipLevelCount,
                dimension: descriptor.dimension,
                descriptor,
                defaultCompare: undefined,
                videoUpload,
                snapshots: new Map(),
                owned: true,
                uploadedRevision: 0
            };
            this.snapshotResource(resource, samplerRequest.key, samplerRequest.sampler);
            this.track(texture, resource);
            return resource;
        } catch (error) {
            this.disposeVideoUploadState(videoUpload);
            gpuTexture.destroy();
            throw error;
        }
    }

    private uploadTypedArray(
        texture: Texture<unknown>,
        resource: InternalTextureResource,
        formatInfo: WebGPUTextureFormatInfo,
        source: TexturePixelData,
        width: number,
        height: number,
        mipLevel: number,
        layer: number,
        depthOrArrayLayers = 1,
        x = 0,
        y = 0
    ): void {
        if (formatInfo.isDepth) {
            this.uploadDepthTypedArray(
                texture,
                resource,
                source,
                width,
                height,
                mipLevel,
                layer,
                depthOrArrayLayers,
                x,
                y
            );
            return;
        }
        if (formatInfo.isCompressed) {
            const data = texturePixelDataToTypedArray(source, texture.type);
            if (!(data instanceof Uint8Array)) {
                throw new TypeError('Compressed WebGPU texture data must use Uint8Array storage');
            }
            if (x % formatInfo.blockWidth !== 0 || y % formatInfo.blockHeight !== 0) {
                throw new RangeError(
                    `Compressed WebGPU texture origins must align to ${String(formatInfo.blockWidth)}x${String(formatInfo.blockHeight)} texel blocks`
                );
            }
            const logicalMipWidth = Math.max(1, resource.width >> mipLevel);
            const logicalMipHeight = Math.max(1, resource.height >> mipLevel);
            if (x + width > logicalMipWidth || y + height > logicalMipHeight) {
                throw new RangeError('Compressed WebGPU update exceeds the logical mip extent');
            }
            if (
                (width % formatInfo.blockWidth !== 0 && x + width !== logicalMipWidth) ||
                (height % formatInfo.blockHeight !== 0 && y + height !== logicalMipHeight)
            ) {
                throw new RangeError(
                    'Compressed WebGPU update dimensions must be block-aligned unless they reach the logical mip edge'
                );
            }
            const blocksPerRow = Math.ceil(width / formatInfo.blockWidth);
            const blockRows = Math.ceil(height / formatInfo.blockHeight);
            const physicalWidth = blocksPerRow * formatInfo.blockWidth;
            const physicalHeight = blockRows * formatInfo.blockHeight;
            const expectedByteLength =
                blocksPerRow * blockRows * depthOrArrayLayers * formatInfo.bytesPerBlock;
            if (data.byteLength !== expectedByteLength) {
                throw new RangeError(
                    `Compressed mip ${String(mipLevel)} contains ${String(data.byteLength)} bytes; ${String(expectedByteLength)} are required for ${String(width)}x${String(height)} ${formatInfo.format}`
                );
            }
            this.writeNativeTexture(
                {
                    texture: resource.gpuTexture,
                    mipLevel,
                    origin: { x, y, z: layer }
                },
                data,
                {
                    offset: 0,
                    bytesPerRow: blocksPerRow * formatInfo.bytesPerBlock,
                    rowsPerImage: blockRows
                },
                { width: physicalWidth, height: physicalHeight, depthOrArrayLayers }
            );
            return;
        }
        const pixels = textureTypedData(
            texture,
            source,
            formatInfo,
            width,
            height,
            depthOrArrayLayers
        );
        const elementsPerRow = width * (formatInfo.bytesPerPixel / pixels.BYTES_PER_ELEMENT);
        const data = texture.flipY
            ? flipTextureImageRows(pixels, elementsPerRow, height, depthOrArrayLayers)
            : pixels;
        this.writeNativeTexture(
            {
                texture: resource.gpuTexture,
                mipLevel,
                origin: { x, y, z: layer }
            },
            data,
            { offset: 0, bytesPerRow: width * formatInfo.bytesPerPixel, rowsPerImage: height },
            { width, height, depthOrArrayLayers }
        );
    }

    private uploadDepthTypedArray(
        texture: Texture<unknown>,
        resource: InternalTextureResource,
        source: TexturePixelData,
        width: number,
        height: number,
        mipLevel: number,
        layer: number,
        depthOrArrayLayers: number,
        x: number,
        y: number
    ): void {
        const pixelCount = width * height * depthOrArrayLayers;
        const converted = texturePixelDataToTypedArray(source, texture.type);
        if (texture.internalFormat === DEPTH_COMPONENT16) {
            if (!(converted instanceof Uint16Array) || converted.length !== pixelCount) {
                throw new RangeError(
                    `DEPTH_COMPONENT16 data requires exactly ${String(pixelCount)} Uint16 values`
                );
            }
            const data = texture.flipY
                ? flipTextureImageRows(converted, width, height, depthOrArrayLayers)
                : converted;
            this.writeNativeTexture(
                {
                    texture: resource.gpuTexture,
                    mipLevel,
                    origin: { x, y, z: layer },
                    aspect: 'depth-only'
                },
                data,
                { offset: 0, bytesPerRow: width * 2, rowsPerImage: height },
                { width, height, depthOrArrayLayers }
            );
            return;
        }
        if (texture.internalFormat === DEPTH_COMPONENT32F) {
            if (!(converted instanceof Float32Array) || converted.length !== pixelCount) {
                throw new RangeError(
                    `DEPTH_COMPONENT32F data requires exactly ${String(pixelCount)} Float32 values`
                );
            }
            const data = texture.flipY
                ? flipTextureImageRows(converted, width, height, depthOrArrayLayers)
                : converted;
            this.writeNativeTexture(
                {
                    texture: resource.gpuTexture,
                    mipLevel,
                    origin: { x, y, z: layer },
                    aspect: 'depth-only'
                },
                data,
                { offset: 0, bytesPerRow: width * 4, rowsPerImage: height },
                { width, height, depthOrArrayLayers }
            );
            return;
        }
        if (texture.internalFormat === DEPTH32F_STENCIL8) {
            if (!(converted instanceof Uint32Array) || converted.length !== pixelCount * 2) {
                throw new RangeError(
                    `DEPTH32F_STENCIL8 data requires exactly ${String(pixelCount * 2)} packed Uint32 values`
                );
            }
            const packed = texture.flipY
                ? flipTextureImageRows(converted, width * 2, height, depthOrArrayLayers)
                : converted;
            const depthWords = new Uint32Array(pixelCount);
            const stencil = new Uint8Array(pixelCount);
            for (let pixel = 0; pixel < pixelCount; pixel++) {
                depthWords[pixel] = packed[pixel * 2] ?? 0;
                stencil[pixel] = (packed[pixel * 2 + 1] ?? 0) & 0xff;
            }
            this.writeNativeTexture(
                {
                    texture: resource.gpuTexture,
                    mipLevel,
                    origin: { x, y, z: layer },
                    aspect: 'depth-only'
                },
                depthWords,
                { offset: 0, bytesPerRow: width * 4, rowsPerImage: height },
                { width, height, depthOrArrayLayers }
            );
            this.writeNativeTexture(
                {
                    texture: resource.gpuTexture,
                    mipLevel,
                    origin: { x, y, z: layer },
                    aspect: 'stencil-only'
                },
                stencil,
                { offset: 0, bytesPerRow: width, rowsPerImage: height },
                { width, height, depthOrArrayLayers }
            );
            return;
        }
        throw new TypeError(
            `Raw WebGPU upload is unavailable for depth format ${String(texture.internalFormat)}`
        );
    }

    private uploadExternalImage(
        texture: Texture<unknown>,
        resource: InternalTextureResource,
        source: GPUCopyExternalImageSource,
        width: number,
        height: number,
        mipLevel: number,
        layer: number,
        x = 0,
        y = 0
    ): void {
        this.copyExternalImageToNativeTexture(
            { source, flipY: texture.flipY },
            {
                texture: resource.gpuTexture,
                mipLevel,
                origin: { x, y, z: layer },
                premultipliedAlpha: texture.premultiplyAlpha,
                colorSpace: 'srgb'
            },
            { width, height, depthOrArrayLayers: 1 }
        );
    }

    private uploadSource(
        texture: Texture<unknown>,
        resource: InternalTextureResource,
        formatInfo: WebGPUTextureFormatInfo,
        source: TexturePixelData | GPUCopyExternalImageSource,
        width: number,
        height: number,
        mipLevel: number,
        layer: number,
        depthOrArrayLayers = 1
    ): void {
        if (isTexturePixelData(source)) {
            this.uploadTypedArray(
                texture,
                resource,
                formatInfo,
                source,
                width,
                height,
                mipLevel,
                layer,
                depthOrArrayLayers
            );
            return;
        }
        if (depthOrArrayLayers !== 1) {
            throw new TypeError('External image uploads cannot populate 3D or array textures');
        }
        if (!isExternalImageSource(source)) {
            throw new TypeError('Texture image is not a supported WebGPU image source');
        }
        if (formatInfo.sampleType === 'sint' || formatInfo.sampleType === 'uint') {
            throw new TypeError('WebGPU integer textures require tightly packed raw data');
        }
        this.uploadExternalImage(texture, resource, source, width, height, mipLevel, layer);
    }

    private uploadBaseTexture(
        texture: Texture<unknown>,
        resource: InternalTextureResource,
        descriptor: ResolvedTextureDescriptor,
        backing: RecoverableTextureBacking | undefined,
        allowPreviouslyUploadedVideoFrame: boolean
    ): boolean {
        if (descriptor.hasExplicitMipmaps) {
            const mipmaps = backing?.mipmaps ?? texture.mipmaps;
            if (descriptor.isCube) {
                mipmaps?.forEach((mipmap, entry) => {
                    const level = Math.floor(entry / 6);
                    const face = entry % 6;
                    const expectedWidth = Math.max(1, descriptor.width >> level);
                    const expectedHeight = Math.max(1, descriptor.height >> level);
                    if (
                        mipmap.face !== face ||
                        mipmap.width !== expectedWidth ||
                        mipmap.height !== expectedHeight ||
                        (mipmap.depth !== undefined && mipmap.depth !== 1)
                    ) {
                        throw new RangeError(
                            `Cube mip entry ${String(entry)} must be level ${String(level)} face ${String(face)} at ${String(expectedWidth)}x${String(expectedHeight)}`
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
                        face
                    );
                });
                return true;
            }
            mipmaps?.forEach((mipmap, level) => {
                const expectedWidth = Math.max(1, descriptor.width >> level);
                const expectedHeight = Math.max(1, descriptor.height >> level);
                const expectedDepth = descriptor.is3D
                    ? Math.max(1, descriptor.layers >> level)
                    : descriptor.isArray
                      ? descriptor.layers
                      : 1;
                const mipmapDepth = mipmap.depth ?? 1;
                if (
                    mipmap.width !== expectedWidth ||
                    mipmap.height !== expectedHeight ||
                    mipmapDepth !== expectedDepth
                ) {
                    throw new RangeError(
                        `Mipmap ${String(level)} is ${String(mipmap.width)}x${String(mipmap.height)}x${String(mipmapDepth)}; expected ${String(expectedWidth)}x${String(expectedHeight)}x${String(expectedDepth)}`
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
                    0,
                    expectedDepth
                );
            });
            return true;
        }

        const image = backing ? backing.image : texture.image;
        if (descriptor.isCube) {
            if (!Array.isArray(image) || image.length !== 6) {
                throw new TypeError('WebGPU cube textures require exactly six faces');
            }
            image.forEach((face, layer) => {
                if (face === null) return;
                if (!isTexturePixelData(face) && !isExternalImageSource(face)) {
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
            return true;
        }
        if (image === null) return true;
        if (!isTexturePixelData(image) && !isExternalImageSource(image)) {
            throw new TypeError('Texture image is not a supported WebGPU image source');
        }
        if (isVideoElement(image)) {
            const videoUpload = resource.videoUpload;
            if (videoUpload?.source !== image) {
                throw new Error(`Texture ${texture.id} has no live WebGPU video upload state`);
            }
            const videoError = videoUpload.queueError ?? videoUpload.stagingError;
            if (videoError) {
                throw new Error(`Texture ${texture.id} could not capture its current video frame`, {
                    cause: videoError
                });
            }
            if (
                videoUpload.copyInFlight ||
                videoUpload.presentedFrame === 0 ||
                (!allowPreviouslyUploadedVideoFrame &&
                    videoUpload.presentedFrame <= videoUpload.uploadedFrame)
            ) {
                return false;
            }
            this.uploadSource(
                texture,
                resource,
                descriptor.formatInfo,
                videoUpload.canvas,
                descriptor.width,
                descriptor.height,
                0,
                0
            );
            this.markVideoCopyInFlight(videoUpload);
            videoUpload.uploadedFrame = videoUpload.presentedFrame;
            return true;
        }
        this.uploadSource(
            texture,
            resource,
            descriptor.formatInfo,
            image,
            descriptor.width,
            descriptor.height,
            0,
            0,
            descriptor.isArray || descriptor.is3D ? descriptor.layers : 1
        );
        return true;
    }

    private updateRecoverableBacking(
        texture: Texture<unknown>,
        descriptor: ResolvedTextureDescriptor
    ): void {
        const sharedBacking = getTextureRecoveryBacking(texture);
        if (sharedBacking) {
            this.observeRecoverableTexture(texture);
            this.recoverableBackings.set(texture, {
                descriptor,
                image: sharedBacking.image,
                mipmaps: sharedBacking.mipmaps,
                subTextures: [],
                revision: texture.updateRevision
            });
            return;
        }
        if (!texture.isImageCanRelease && !texture.isImageReleased) return;
        const allUpdates = texture.getTextureUpdatesSince(0);
        if (!texture.isImageReleased) {
            this.observeRecoverableTexture(texture);
            this.recoverableBackings.set(texture, {
                descriptor,
                image: cloneRecoverableImage(texture.image),
                mipmaps: cloneMipmaps(texture.mipmaps),
                subTextures: cloneSubTextures(allUpdates.subTextures),
                revision: allUpdates.revision
            });
            return;
        }

        const existing = this.recoverableBackings.get(texture);
        if (!existing) {
            throw new Error(
                `Texture ${texture.id} released its CPU image without a recoverable WebGPU backing`
            );
        }
        const updates = texture.getTextureUpdatesSince(existing.revision);
        const subTextures = updates.requiresFullUpload
            ? cloneSubTextures(updates.subTextures)
            : [...existing.subTextures, ...cloneSubTextures(updates.subTextures)];
        this.recoverableBackings.set(texture, {
            ...existing,
            descriptor,
            subTextures,
            revision: updates.revision
        });
    }

    private uploadSubTextures(
        texture: Texture<unknown>,
        resource: InternalTextureResource,
        descriptor: ResolvedTextureDescriptor,
        updates: readonly TextureSubImage[]
    ): void {
        if (updates.length === 0) return;
        for (const update of updates) {
            const { mipLevel, x, y, width, height, image } = update;
            const layer = update.face ?? update.layer ?? update.z ?? 0;
            const depth = update.depth ?? 1;
            if (isTexturePixelData(image)) {
                this.uploadTypedArray(
                    texture,
                    resource,
                    descriptor.formatInfo,
                    image,
                    width,
                    height,
                    mipLevel,
                    layer,
                    depth,
                    x,
                    y
                );
                continue;
            }
            if (!isExternalImageSource(image)) {
                throw new TypeError('Sub-texture image is not a supported WebGPU image source');
            }
            this.uploadExternalImage(
                texture,
                resource,
                image,
                width,
                height,
                mipLevel,
                layer,
                x,
                y
            );
        }
    }

    private getMipmapPipeline(formatInfo: WebGPUTextureFormatInfo): MipmapPipeline {
        const existing = this.mipmapPipelines.get(formatInfo.format);
        if (existing) return existing;
        if (formatInfo.isDepth || formatInfo.isCompressed) {
            throw new TypeError(
                `${formatInfo.isDepth ? 'Depth' : 'Compressed'} mipmap generation is unsupported`
            );
        }
        const shader =
            this.mipmapShader ??
            (this.mipmapShader = this.translator.translate(
                mipmapVertexSource,
                mipmapFragmentSource
            ));
        const resources = createWebGPUFullscreenPassResources(
            this._rhiDevice ?? this.device,
            shader,
            formatInfo.sampleType,
            `Hilo3d mipmap ${formatInfo.format}`
        );
        const pipelineDescriptor: GPURenderPipelineDescriptor = {
            label: `Hilo3d mipmap ${formatInfo.format} pipeline`,
            layout: resources.pipelineLayout,
            vertex: {
                module: this.createNativeShaderModule({
                    label: 'Hilo3d mipmap vertex shader',
                    code: shader.vertex.wgsl
                }),
                entryPoint: 'main'
            },
            fragment: {
                module: this.createNativeShaderModule({
                    label: 'Hilo3d mipmap fragment shader',
                    code: shader.fragment.wgsl
                }),
                entryPoint: 'main',
                targets: [{ format: formatInfo.format }]
            },
            primitive: { topology: 'triangle-list' },
            multisample: { count: 1 }
        };
        const pipeline =
            this._rhiDevice?.createNativeRenderPipeline(pipelineDescriptor) ??
            this._nativeCache.createRenderPipeline(pipelineDescriptor);
        const result = { ...resources, pipeline };
        this.mipmapPipelines.set(formatInfo.format, result);
        return result;
    }

    private generateMipmaps(
        resource: InternalTextureResource,
        descriptor: ResolvedTextureDescriptor
    ): void {
        if (descriptor.mipLevelCount <= 1) return;
        const mipmap = this.getMipmapPipeline(descriptor.formatInfo);
        const encoder = this.createNativeCommandEncoder({
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
                const bindGroup = createWebGPUFullscreenPassBindGroup(
                    this._rhiDevice ?? this.device,
                    mipmap,
                    sourceView,
                    `Hilo3d mipmap ${resource.textureId} level ${String(level)}`
                );
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
                pass.setBindGroup(mipmap.bindGroupIndex, bindGroup);
                pass.draw(3);
                pass.end();
            }
        }
        this.submitNative([encoder.finish()]);
    }

    /** Resolve, create and synchronise a texture resource for this device. */
    get(
        texture: Texture<unknown>,
        options: WebGPUTextureRequestOptions = {}
    ): WebGPUTextureResource {
        if (texture.needDestroy) {
            if (texture.isImageReleased) {
                throw new Error(
                    `Texture ${texture.id} cannot recreate changed GPU allocations after its image was released`
                );
            }
            texture.destroy();
            texture.needDestroy = false;
        }
        let resource = this.resourcesByTexture.get(texture);
        if (!resource && this.externalTextureOwners.has(texture)) {
            this.ensureExternalOwnerResource(texture);
            resource = this.resourcesByTexture.get(texture);
            if (!resource) {
                throw new Error(
                    `Texture ${texture.id} is owned by an unavailable WebGPU external resource`
                );
            }
        }
        let backing = this.recoverableBackings.get(texture);
        const sharedBacking = getTextureRecoveryBacking(texture);
        if (!texture.isImageReleased && !sharedBacking && backing) {
            this.recoverableBackings.delete(texture);
            backing = undefined;
        }
        if (sharedBacking && (!backing || backing.revision < texture.updateRevision)) {
            backing = {
                descriptor: this.resolveDescriptor(texture, sharedBacking.mipmaps),
                image: sharedBacking.image,
                mipmaps: sharedBacking.mipmaps,
                subTextures: [],
                revision: texture.updateRevision
            };
            this.observeRecoverableTexture(texture);
            this.recoverableBackings.set(texture, backing);
        }
        if (texture.isImageReleased && !backing) {
            if (!sharedBacking) {
                throw new Error(
                    `Texture ${texture.id} cannot be uploaded because its CPU image was released without a recovery backing`
                );
            }
            const updates = texture.getTextureUpdatesSince(0);
            backing = {
                descriptor: this.resolveDescriptor(texture, sharedBacking.mipmaps),
                image: sharedBacking.image,
                mipmaps: sharedBacking.mipmaps,
                subTextures: cloneSubTextures(updates.subTextures),
                revision: updates.revision
            };
            this.observeRecoverableTexture(texture);
            this.recoverableBackings.set(texture, backing);
        }
        const sourceImage = backing ? backing.image : texture.image;
        const resolvedDescriptor = backing?.descriptor ?? this.resolveDescriptor(texture);
        const descriptor =
            texture.isImageReleased && resource?.descriptor.key === resolvedDescriptor.key
                ? resource.descriptor
                : resolvedDescriptor;
        const resourceSourceChanged =
            resource !== undefined &&
            (isVideoElement(sourceImage)
                ? resource.videoUpload?.source !== sourceImage
                : resource.videoUpload !== null);
        const canRestagePresentedVideoFrame =
            isVideoElement(sourceImage) &&
            resource?.videoUpload?.source === sourceImage &&
            (resource.videoUpload.presentedFrame > 0 || resource.videoUpload.pendingPresentation);
        if (resourceSourceChanged || (resource && resource.descriptor.key !== descriptor.key)) {
            if (this.externalTextureOwners.has(texture)) {
                throw new TypeError(
                    `Texture ${texture.id} cannot change the allocation descriptor owned by its WebGPU external resource`
                );
            }
            if (texture.isImageReleased) {
                throw new Error(
                    `Texture ${texture.id} cannot recreate a changed WebGPU allocation after its image was released`
                );
            }
            this.destroy(texture);
            resource = undefined;
        }
        let created = false;
        if (!resource) {
            resource = this.createResource(
                texture,
                descriptor,
                options,
                sourceImage,
                canRestagePresentedVideoFrame
            );
            created = true;
        }

        try {
            const samplerRequest = this.resolveSampler(texture, descriptor, options);
            const pending = texture.getTextureUpdatesSince(resource.uploadedRevision);
            const videoUpload = resource.videoUpload;
            const videoError = videoUpload
                ? (videoUpload.queueError ?? videoUpload.stagingError)
                : null;
            if (videoError) {
                throw new Error(`Texture ${texture.id} could not stage its current video frame`, {
                    cause: videoError
                });
            }
            const hasPendingVideoFrame =
                videoUpload !== null && videoUpload.presentedFrame > videoUpload.uploadedFrame;
            const needsFullUpload =
                created ||
                pending.requiresFullUpload ||
                (texture.autoUpdate && (videoUpload === null || hasPendingVideoFrame));
            const updates = needsFullUpload ? texture.getTextureUpdatesSince(0) : pending;
            if (needsFullUpload) {
                const didUpload = this.uploadBaseTexture(
                    texture,
                    resource,
                    descriptor,
                    backing,
                    pending.requiresFullUpload
                );
                if (!didUpload) {
                    return this.snapshotResource(
                        resource,
                        samplerRequest.key,
                        samplerRequest.sampler
                    );
                }
            }
            let subTextures = updates.subTextures;
            if (needsFullUpload && backing) {
                const updatesAfterBacking = texture.getTextureUpdatesSince(backing.revision);
                subTextures = updatesAfterBacking.requiresFullUpload
                    ? updatesAfterBacking.subTextures
                    : [...backing.subTextures, ...updatesAfterBacking.subTextures];
            }
            this.uploadSubTextures(texture, resource, descriptor, subTextures);
            if (
                descriptor.mipLevelCount > 1 &&
                ((!descriptor.hasExplicitMipmaps && needsFullUpload) || subTextures.length > 0)
            ) {
                this.generateMipmaps(resource, descriptor);
            }
            resource.uploadedRevision = updates.revision;
            if (needsFullUpload && updates.revision === texture.updateRevision) {
                texture.needUpdate = false;
            }
            if (resource.uploadedRevision === texture.updateRevision) {
                this.updateRecoverableBacking(texture, descriptor);
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
        if (this.externalTextureOwners.has(texture)) {
            throw new TypeError(
                `Texture ${texture.id} is owned by a WebGPU render target and cannot be replaced through registerExternal()`
            );
        }
        return this.registerExternalResource(texture, gpuTexture, options);
    }

    private registerExternalResource(
        texture: Texture<unknown>,
        gpuTexture: GPUTexture,
        options: WebGPUExternalTextureOptions
    ): WebGPUTextureResource {
        if (texture.needDestroy) {
            if (texture.isImageReleased) {
                throw new Error(
                    `Texture ${texture.id} cannot recreate changed GPU allocations after its image was released`
                );
            }
            texture.destroy();
            texture.needDestroy = false;
        }
        const owned = options.takeOwnership ?? true;
        try {
            const { resource, snapshot } = this.prepareExternalRegistration(
                texture,
                gpuTexture,
                options
            );
            const existing = this.resourcesByTexture.get(texture);

            // Add the replacement before releasing the old alias. The native reference record
            // therefore never reaches zero when both registrations use the same GPUTexture.
            this.track(texture, resource);
            if (existing) this.releaseResource(existing);
            texture.needUpdate = false;
            return snapshot;
        } catch (error) {
            // `takeOwnership` transfers cleanup responsibility at call entry. Never destroy a
            // native texture already registered by this manager because the old alias is live.
            if (owned && !this.nativeTextures.has(gpuTexture)) gpuTexture.destroy();
            throw error;
        }
    }

    private prepareExternalRegistration(
        texture: Texture<unknown>,
        gpuTexture: GPUTexture,
        options: WebGPUExternalTextureOptions
    ): { readonly resource: InternalTextureResource; readonly snapshot: WebGPUTextureResource } {
        const descriptor = this.resolveDescriptor(texture);
        this.validateDeviceSupport(descriptor);
        const samplerRequest = this.resolveSampler(texture, descriptor, options);
        const expectedDimension = descriptor.dimension;
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
            : descriptor.isArray
              ? {
                    dimension: '2d-array',
                    baseArrayLayer: 0,
                    arrayLayerCount: descriptor.layers
                }
              : { dimension: descriptor.is3D ? '3d' : '2d' };
        const destroyToken = {};
        const resource: InternalTextureResource = {
            sourceTexture: texture,
            destroyObserver: this.createDestroyObserver(texture, destroyToken),
            destroyToken,
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
            defaultCompare: options.compare,
            videoUpload: null,
            snapshots: new Map(),
            owned: options.takeOwnership ?? true,
            uploadedRevision: texture.updateRevision
        };
        return {
            resource,
            snapshot: this.snapshotResource(resource, samplerRequest.key, samplerRequest.sampler)
        };
    }

    /**
     * @internal Prepare every external texture before changing any stable Texture mapping.
     * This is the commit primitive used by render-target resize: a failed view, sampler or
     * validation step leaves every previous registration live and destroys only newly supplied
     * owned GPU textures.
     */
    private replaceExternalBatch(
        registrations: readonly WebGPUExternalTextureRegistration[]
    ): readonly WebGPUTextureResource[] {
        if (registrations.length === 0) return [];
        const initiallyTracked = new Set<GPUTexture>();
        const ownedTextures = new Set<GPUTexture>();
        for (const registration of registrations) {
            if (this.nativeTextures.has(registration.gpuTexture)) {
                initiallyTracked.add(registration.gpuTexture);
            }
            if (registration.options?.takeOwnership ?? true) {
                ownedTextures.add(registration.gpuTexture);
            }
        }
        const destroyUncommittedOwnedTextures = (): void => {
            for (const gpuTexture of ownedTextures) {
                if (!initiallyTracked.has(gpuTexture)) gpuTexture.destroy();
            }
        };

        const prepared: {
            readonly resource: InternalTextureResource;
            readonly snapshot: WebGPUTextureResource;
            readonly existing: InternalTextureResource | undefined;
        }[] = [];
        try {
            const textures = new Set<Texture<unknown>>();
            for (const registration of registrations) {
                if (textures.has(registration.texture)) {
                    throw new TypeError(
                        `External texture replacement contains Texture ${registration.texture.id} more than once`
                    );
                }
                textures.add(registration.texture);
                prepared.push({
                    ...this.prepareExternalRegistration(
                        registration.texture,
                        registration.gpuTexture,
                        registration.options ?? {}
                    ),
                    existing: this.resourcesByTexture.get(registration.texture)
                });
            }
        } catch (error) {
            destroyUncommittedOwnedTextures();
            throw error;
        }

        for (const { resource } of prepared) this.track(resource.sourceTexture, resource);
        let releasedExisting = false;
        for (const { resource, existing } of prepared) {
            if (existing) {
                this.releaseResource(existing, false);
                releasedExisting = true;
            }
            resource.sourceTexture.needUpdate = false;
            resource.sourceTexture.needDestroy = false;
        }
        if (releasedExisting) this.onResourceDestroyed?.();
        return prepared.map(({ snapshot }) => snapshot);
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
        if (this.invalidateExternalOwner(texture, true)) return;
        this.releaseTextureResource(texture);
    }

    private releaseTextureResource(texture: Texture<unknown>): void {
        const resource = this.resourcesByTexture.get(texture);
        if (!resource) return;
        this.releaseResource(resource);
    }

    private releaseDeviceAllocations(): void {
        const hadResources = this.liveResources.size > 0;
        for (const resource of [...this.liveResources]) this.releaseResource(resource, false);
        this.liveResources.clear();
        this.resourcesByTexture = new WeakMap<Texture<unknown>, InternalTextureResource>();
        this.nativeTextures = new WeakMap<GPUTexture, NativeTextureRecord>();
        this.mipmapPipelines.clear();
        if (hadResources) this.onResourceDestroyed?.();
    }

    /** @internal Drop device allocations while retaining CPU recovery backings. */
    private suspendAll(): void {
        this.releaseDeviceAllocations();
        this.invalidateAllExternalOwners(false);
    }

    /** @internal Rebind an empty manager to a replacement device after loss. */
    private restoreDevice(deviceOrOwner: GPUDevice | WebGPUDevice, rhiDevice?: WebGPUDevice): void {
        if (this.liveResources.size > 0) {
            throw new Error('WebGPUTextureManager must be suspended before replacing its device');
        }
        const owner = deviceOrOwner instanceof WebGPUDevice ? deviceOrOwner : (rhiDevice ?? null);
        const device =
            deviceOrOwner instanceof WebGPUDevice ? deviceOrOwner.nativeDevice : deviceOrOwner;
        if (rhiDevice && rhiDevice.nativeDevice !== device) {
            throw new TypeError('WebGPU texture manager and RHI device must share a GPUDevice');
        }
        this._device = device;
        this._rhiDevice = owner;
        this._nativeCache = owner?.nativeCache ?? getWebGPUNativeDeviceCache(device);
        this.resourcesByTexture = new WeakMap<Texture<unknown>, InternalTextureResource>();
        this.nativeTextures = new WeakMap<GPUTexture, NativeTextureRecord>();
        this.mipmapPipelines.clear();
    }

    /**
     * Destroy every GPU allocation and release private CPU recovery backings. Renderer-owned
     * attachment identities remain registered and recover lazily on their next target/material use.
     */
    destroyAll(): void {
        if (this.submissionActive) {
            throw new Error(
                'WebGPU texture allocations cannot be destroyed while a submission is active'
            );
        }
        this.releaseDeviceAllocations();
        let ownerInvalidationError: unknown;
        let ownerInvalidationFailed = false;
        try {
            this.invalidateAllExternalOwners(false);
        } catch (error: unknown) {
            ownerInvalidationError = error;
            ownerInvalidationFailed = true;
        }
        const backings = this.recoverableBackings;
        const listenersByTexture = this.recoveryDestroyListeners;
        for (const owner of this.recoveryListenerOwners) {
            const texture = owner.texture.deref();
            if (!texture) continue;
            unobserveTextureDestroy(texture, owner.observer);
            backings.delete(texture);
            listenersByTexture.delete(texture);
        }
        this.recoveryListenerOwners.clear();
        this.recoverableBackings = new WeakMap<Texture<unknown>, RecoverableTextureBacking>();
        this.recoveryDestroyListeners = new WeakMap<
            Texture<unknown>,
            RecoverableTextureListenerOwner
        >();
        this.submissionActive = false;
        this.submissionUsedTextures = new WeakSet();
        for (const texture of this.deferredTextureDestructions) texture.destroy();
        this.deferredTextureDestructions.clear();
        if (ownerInvalidationFailed) {
            if (ownerInvalidationError instanceof Error) throw ownerInvalidationError;
            throw new Error('WebGPU external texture invalidation failed', {
                cause: ownerInvalidationError
            });
        }
    }
}

type WebGPUTextureManagerRHIConstructor = new (
    deviceOrOwner: GPUDevice | WebGPUDevice,
    translator: NagaShaderTranslator,
    onResourceDestroyed?: () => void,
    rhiDevice?: WebGPUDevice
) => WebGPUTextureManager;

/** Create the production manager with a concrete one-hop RHI device owner. @internal */
export function createWebGPUTextureManagerForRHI(
    device: WebGPUDevice,
    translator: NagaShaderTranslator,
    onResourceDestroyed?: () => void
): WebGPUTextureManager {
    const InternalConstructor =
        WebGPUTextureManager as unknown as WebGPUTextureManagerRHIConstructor;
    return new InternalConstructor(device, translator, onResourceDestroyed);
}

interface WebGPUTextureInternalAccess {
    beginSubmission(): void;
    endSubmission(): void;
    suspendAll(): void;
    restoreDevice(device: GPUDevice | WebGPUDevice, rhiDevice?: WebGPUDevice): void;
    defaultCompareFor(texture: Texture<unknown>): GLenum | GPUCompareFunction | undefined;
    registerExternalResource(
        texture: Texture<unknown>,
        gpuTexture: GPUTexture,
        options: WebGPUExternalTextureOptions
    ): WebGPUTextureResource;
    replaceExternalBatch(
        registrations: readonly WebGPUExternalTextureRegistration[]
    ): readonly WebGPUTextureResource[];
    releaseTextureResource(texture: Texture<unknown>): void;
    registerExternalOwner(
        texture: Texture<unknown>,
        invalidate: (recoverImmediately: boolean) => void,
        ensure: () => void
    ): void;
    unregisterExternalOwner(texture: Texture<unknown>): void;
}

function internalAccess(manager: WebGPUTextureManager): WebGPUTextureInternalAccess {
    return manager as unknown as WebGPUTextureInternalAccess;
}

/** Begin renderer-owned texture submission tracking. @internal */
export function beginWebGPUTextureSubmission(manager: WebGPUTextureManager): void {
    internalAccess(manager).beginSubmission();
}

/** End renderer-owned texture submission tracking. @internal */
export function endWebGPUTextureSubmission(manager: WebGPUTextureManager): void {
    internalAccess(manager).endSubmission();
}

/** Drop device allocations while retaining CPU recovery state and target ownership. @internal */
export function suspendWebGPUTextures(manager: WebGPUTextureManager): void {
    internalAccess(manager).suspendAll();
}

/** Rebind a suspended manager to a replacement device. @internal */
export function restoreWebGPUTextureDevice(
    manager: WebGPUTextureManager,
    device: GPUDevice | WebGPUDevice,
    rhiDevice?: WebGPUDevice
): void {
    internalAccess(manager).restoreDevice(device, rhiDevice);
}

/** Resolve a renderer-owned depth attachment's comparison default. @internal */
export function getWebGPUTextureDefaultCompare(
    manager: WebGPUTextureManager,
    texture: Texture<unknown>
): GLenum | GPUCompareFunction | undefined {
    return internalAccess(manager).defaultCompareFor(texture);
}

/** Register the sole renderer owner of an external texture identity. @internal */
export function registerWebGPUExternalTextureOwner(
    manager: WebGPUTextureManager,
    texture: Texture<unknown>,
    invalidate: (recoverImmediately: boolean) => void,
    ensure: () => void
): void {
    internalAccess(manager).registerExternalOwner(texture, invalidate, ensure);
}

/** Release renderer ownership without destroying the current allocation. @internal */
export function unregisterWebGPUExternalTextureOwner(
    manager: WebGPUTextureManager,
    texture: Texture<unknown>
): void {
    internalAccess(manager).unregisterExternalOwner(texture);
}

/** Register a renderer-owned native texture without crossing the public owner guard. @internal */
export function registerWebGPUExternalTexture(
    manager: WebGPUTextureManager,
    texture: Texture<unknown>,
    gpuTexture: GPUTexture,
    options: WebGPUExternalTextureOptions
): WebGPUTextureResource {
    return internalAccess(manager).registerExternalResource(texture, gpuTexture, options);
}

/** Atomically replace renderer-owned native texture registrations. @internal */
export function replaceWebGPUExternalTextureBatch(
    manager: WebGPUTextureManager,
    registrations: readonly WebGPUExternalTextureRegistration[]
): readonly WebGPUTextureResource[] {
    return internalAccess(manager).replaceExternalBatch(registrations);
}

/** Release one native mapping without invalidating its renderer owner. @internal */
export function releaseWebGPUTextureResource(
    manager: WebGPUTextureManager,
    texture: Texture<unknown>
): void {
    internalAccess(manager).releaseTextureResource(texture);
}
