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
} from '../../constants/webgl';
import {
    COMPRESSED_R11_EAC,
    COMPRESSED_RG11_EAC,
    COMPRESSED_RGB8_ETC2,
    COMPRESSED_RGB8_PUNCHTHROUGH_ALPHA1_ETC2,
    COMPRESSED_RGBA8_ETC2_EAC,
    COMPRESSED_SIGNED_R11_EAC,
    COMPRESSED_SIGNED_RG11_EAC,
    COMPRESSED_SRGB8_ALPHA8_ETC2_EAC,
    COMPRESSED_SRGB8_ETC2,
    COMPRESSED_SRGB8_PUNCHTHROUGH_ALPHA1_ETC2,
    DEPTH24_STENCIL8,
    DEPTH32F_STENCIL8,
    DEPTH_COMPONENT24,
    DEPTH_COMPONENT32F,
    FLOAT_32_UNSIGNED_INT_24_8_REV,
    HALF_FLOAT,
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
    RG8I,
    RG8UI,
    RG8_SNORM,
    RG16F,
    RG16I,
    RG16UI,
    RG32F,
    RG32I,
    RG32UI,
    RG_INTEGER,
    RGB10_A2,
    RGB10_A2UI,
    RGB8I,
    RGB8UI,
    RGB8_SNORM,
    RGB8,
    RGB16F,
    RGB16I,
    RGB16UI,
    RGB32F,
    RGB32I,
    RGB32UI,
    RGB9_E5,
    RGB_INTEGER,
    R11F_G11F_B10F,
    R8_SNORM,
    RGBA8I,
    RGBA8UI,
    RGBA8_SNORM,
    RGBA8,
    RGBA16F,
    RGBA16I,
    RGBA16UI,
    RGBA32F,
    RGBA32I,
    RGBA32UI,
    RGBA_INTEGER,
    SRGB8,
    SRGB8_ALPHA8,
    TEXTURE_2D_ARRAY,
    TEXTURE_3D,
    UNSIGNED_INT_10F_11F_11F_REV,
    UNSIGNED_INT_24_8,
    UNSIGNED_INT_2_10_10_10_REV,
    UNSIGNED_INT_5_9_9_9_REV
} from '../../constants/webgl2';
import {
    COMPRESSED_RGB_ATC_WEBGL,
    COMPRESSED_RGB_ETC1_WEBGL,
    COMPRESSED_RGB_PVRTC_2BPPV1_IMG,
    COMPRESSED_RGB_PVRTC_4BPPV1_IMG,
    COMPRESSED_RGB_S3TC_DXT1_EXT,
    COMPRESSED_RGBA_ASTC_4X4_KHR,
    COMPRESSED_RGBA_ATC_EXPLICIT_ALPHA_WEBGL,
    COMPRESSED_RGBA_ATC_INTERPOLATED_ALPHA_WEBGL,
    COMPRESSED_RGBA_PVRTC_2BPPV1_IMG,
    COMPRESSED_RGBA_PVRTC_4BPPV1_IMG,
    COMPRESSED_RGBA_S3TC_DXT1_EXT,
    COMPRESSED_RGBA_S3TC_DXT3_EXT,
    COMPRESSED_RGBA_S3TC_DXT5_EXT,
    COMPRESSED_SRGB8_ALPHA8_ASTC_4X4_KHR,
    COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT,
    COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT,
    COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT,
    COMPRESSED_SRGB_S3TC_DXT1_EXT
} from '../../constants/webglExtensions';
import type { TexturePixelData, TypedArray } from '../types';
import Texture, {
    getTextureRecoveryBacking,
    prepareTextureUpload,
    type TextureMipmap
} from '../../texture/Texture';
import {
    flipTexturePixelRows,
    isTexturePixelData,
    texturePixelDataToTypedArray
} from '../../texture/texturePixelData';
import type { RHIUploadBatch, RHIUploadBatchParticipant } from '../frame/RHIUploadBatch';
import {
    RHITextureUsage,
    getRHIExternalImageSourceDimensions,
    isRHIExternalImageSource,
    normalizeRHISamplerDescriptor,
    normalizeRHITextureDescriptor,
    type RHIAddressMode,
    type RHICompareFunction,
    type RHIDataSource,
    type RHIExternalImageSource,
    type RHIDevice,
    type RHIFilterMode,
    type RHIMipmapFilterMode,
    type RHISampler,
    type RHISamplerDescriptor,
    type RHISubmission,
    type RHITexture,
    type RHITextureAspect,
    type RHITextureDescriptor,
    type RHITextureFormat,
    type RHITextureView
} from '../rhi/core';
import type { ResourceRegistry, ResourceRegistryHandle } from './ResourceRegistry';

type CacheState = 'idle' | 'active' | 'destroyed';
type TextureStorage =
    | 'i8'
    | 'u8'
    | 'i16'
    | 'u16'
    | 'i32'
    | 'u32'
    | 'f16'
    | 'f32'
    | 'opaque-depth-stencil'
    | 'compressed';

interface TextureFormatInfo {
    readonly format: RHITextureFormat;
    readonly storage: TextureStorage;
    readonly sourceElementsPerPixel: 0 | 1 | 2 | 3 | 4;
    readonly physicalElementsPerPixel: 0 | 1 | 2 | 4;
    readonly opaqueAlpha?: number;
    readonly aspect?: RHITextureAspect;
    readonly blockWidth: 1 | 4;
    readonly blockHeight: 1 | 4;
    readonly bytesPerBlock: 1 | 2 | 4 | 8 | 16;
}

interface TextureByteUploadEntry {
    readonly kind: 'bytes';
    readonly data: RHIDataSource;
    readonly mipLevel: number;
    readonly layer: number;
    readonly width: number;
    readonly height: number;
    readonly depth: number;
    readonly bytesPerRow: number;
    readonly rowsPerImage: number;
    readonly aspect?: RHITextureAspect;
}

interface TextureExternalUploadEntry {
    readonly kind: 'external';
    readonly source: RHIExternalImageSource;
    readonly mipLevel: number;
    readonly layer: number;
    readonly width: number;
    readonly height: number;
    readonly flipY: boolean;
    readonly premultipliedAlpha: boolean;
}

type TextureUploadEntry = TextureByteUploadEntry | TextureExternalUploadEntry;

export interface TextureResourcePrepareOptions {
    /** Comparison samplers accept either the portable RHI name or the matching WebGL constant. */
    readonly compare?: RHICompareFunction | number;
}

export interface TextureResourceHandles {
    readonly texture: ResourceRegistryHandle<RHITexture>;
    readonly view: ResourceRegistryHandle<RHITextureView>;
    readonly sampler: ResourceRegistryHandle<RHISampler>;
}

export interface TextureResourceCacheDiagnostics {
    readonly handles: Readonly<TextureResourceHandles>;
    /** `-1` means the current allocation still needs a successful frame upload. */
    readonly committedRevision: number;
    readonly sourceRevision: number;
    readonly width: number;
    readonly height: number;
    readonly registryGeneration: number;
}

interface TextureShapeSnapshot {
    readonly width: number;
    readonly height: number;
    readonly layers: number;
    readonly mipLevelCount: number;
    readonly viewDimension: '2d' | '2d-array' | 'cube' | '3d';
    readonly rhiFormat: RHITextureFormat;
}

interface TextureSourceSnapshot extends TextureShapeSnapshot {
    readonly image: unknown;
    readonly revision: number;
    readonly target: number;
    readonly depth: number;
    readonly internalFormat: number;
    readonly format: number;
    readonly type: number;
    readonly compressed: boolean;
    readonly flipY: boolean;
    readonly premultiplyAlpha: boolean;
    readonly mipmaps: readonly TextureMipmap[] | null;
    readonly wrapS: number;
    readonly wrapT: number;
    readonly wrapR: number;
    readonly magFilter: number;
    readonly minFilter: number;
    readonly anisotropic: number;
    readonly autoUpdate: boolean;
    readonly compare: RHICompareFunction | undefined;
    readonly samplerKey: string;
    readonly uploads: readonly TextureUploadEntry[];
    readonly autoGenerateMipmaps: boolean;
    readonly textureDescriptor: Readonly<RHITextureDescriptor>;
    readonly samplerDescriptor: Readonly<RHISamplerDescriptor>;
}

interface SamplerEntry {
    readonly key: string;
    readonly descriptor: Readonly<RHISamplerDescriptor>;
    readonly handle: ResourceRegistryHandle<RHISampler>;
    references: number;
    submitted: boolean;
}

interface TextureResourceRecord {
    readonly source: Texture<unknown>;
    handles: Readonly<TextureResourceHandles>;
    shape: Readonly<TextureShapeSnapshot>;
    sampler: SamplerEntry;
    snapshot: TextureSourceSnapshot;
    committedRevision: number;
    registryGeneration: number;
}

interface PendingTextureUse {
    readonly record: TextureResourceRecord;
    readonly snapshot: TextureSourceSnapshot;
    readonly handles: Readonly<TextureResourceHandles>;
    readonly newRecord: boolean;
    readonly shapeReplacement: boolean;
    readonly samplerReplacement: boolean;
    readonly sampler: SamplerEntry;
    readonly registryGeneration: number;
}

function mapAddressMode(value: number): RHIAddressMode {
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

function mapMagFilter(value: number): RHIFilterMode {
    switch (value) {
        case NEAREST:
            return 'nearest';
        case LINEAR:
            return 'linear';
        default:
            throw new TypeError(`Unsupported texture magnification filter: ${String(value)}`);
    }
}

function mapMinFilters(value: number): {
    readonly minFilter: RHIFilterMode;
    readonly mipmapFilter: RHIMipmapFilterMode;
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

function colorFormatInfo(
    format: RHITextureFormat,
    storage: Exclude<TextureStorage, 'compressed' | 'opaque-depth-stencil'>,
    sourceElementsPerPixel: 1 | 2 | 3 | 4,
    bytesPerBlock: 1 | 2 | 4 | 8 | 16,
    opaqueAlpha?: number,
    aspect?: RHITextureAspect
): TextureFormatInfo {
    const physicalElementsPerPixel = sourceElementsPerPixel === 3 ? 4 : sourceElementsPerPixel;
    return Object.freeze({
        format,
        storage,
        sourceElementsPerPixel,
        physicalElementsPerPixel,
        ...(opaqueAlpha === undefined ? {} : { opaqueAlpha }),
        ...(aspect === undefined ? {} : { aspect }),
        blockWidth: 1,
        blockHeight: 1,
        bytesPerBlock
    });
}

function packedFormatInfo(
    format: RHITextureFormat,
    storage: 'u32',
    bytesPerBlock: 4
): TextureFormatInfo {
    return Object.freeze({
        format,
        storage,
        sourceElementsPerPixel: 1,
        physicalElementsPerPixel: 1,
        blockWidth: 1,
        blockHeight: 1,
        bytesPerBlock
    });
}

function opaqueDepthStencilFormatInfo(
    format: RHITextureFormat,
    sourceElementsPerPixel: 1 | 2,
    bytesPerBlock: 4 | 8
): TextureFormatInfo {
    return Object.freeze({
        format,
        storage: 'opaque-depth-stencil',
        sourceElementsPerPixel,
        physicalElementsPerPixel: sourceElementsPerPixel,
        blockWidth: 1,
        blockHeight: 1,
        bytesPerBlock
    });
}

function compressedFormatInfo(format: RHITextureFormat, bytesPerBlock: 8 | 16): TextureFormatInfo {
    return Object.freeze({
        format,
        storage: 'compressed',
        sourceElementsPerPixel: 0,
        physicalElementsPerPixel: 0,
        blockWidth: 4,
        blockHeight: 4,
        bytesPerBlock
    });
}

function resolveCompressedFormat(internalFormat: number): TextureFormatInfo {
    switch (internalFormat) {
        case COMPRESSED_RGB_S3TC_DXT1_EXT:
        case COMPRESSED_RGBA_S3TC_DXT1_EXT:
            return compressedFormatInfo('bc1-rgba-unorm', 8);
        case COMPRESSED_SRGB_S3TC_DXT1_EXT:
        case COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT:
            return compressedFormatInfo('bc1-rgba-unorm-srgb', 8);
        case COMPRESSED_RGBA_S3TC_DXT3_EXT:
            return compressedFormatInfo('bc2-rgba-unorm', 16);
        case COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT:
            return compressedFormatInfo('bc2-rgba-unorm-srgb', 16);
        case COMPRESSED_RGBA_S3TC_DXT5_EXT:
            return compressedFormatInfo('bc3-rgba-unorm', 16);
        case COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT:
            return compressedFormatInfo('bc3-rgba-unorm-srgb', 16);
        case COMPRESSED_RGB_ETC1_WEBGL:
        case COMPRESSED_RGB8_ETC2:
            return compressedFormatInfo('etc2-rgb8unorm', 8);
        case COMPRESSED_SRGB8_ETC2:
            return compressedFormatInfo('etc2-rgb8unorm-srgb', 8);
        case COMPRESSED_RGB8_PUNCHTHROUGH_ALPHA1_ETC2:
            return compressedFormatInfo('etc2-rgb8a1unorm', 8);
        case COMPRESSED_SRGB8_PUNCHTHROUGH_ALPHA1_ETC2:
            return compressedFormatInfo('etc2-rgb8a1unorm-srgb', 8);
        case COMPRESSED_RGBA8_ETC2_EAC:
            return compressedFormatInfo('etc2-rgba8unorm', 16);
        case COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:
            return compressedFormatInfo('etc2-rgba8unorm-srgb', 16);
        case COMPRESSED_R11_EAC:
            return compressedFormatInfo('eac-r11unorm', 8);
        case COMPRESSED_SIGNED_R11_EAC:
            return compressedFormatInfo('eac-r11snorm', 8);
        case COMPRESSED_RG11_EAC:
            return compressedFormatInfo('eac-rg11unorm', 16);
        case COMPRESSED_SIGNED_RG11_EAC:
            return compressedFormatInfo('eac-rg11snorm', 16);
        case COMPRESSED_RGBA_ASTC_4X4_KHR:
            return compressedFormatInfo('astc-4x4-unorm', 16);
        case COMPRESSED_SRGB8_ALPHA8_ASTC_4X4_KHR:
            return compressedFormatInfo('astc-4x4-unorm-srgb', 16);
        case COMPRESSED_RGB_PVRTC_2BPPV1_IMG:
        case COMPRESSED_RGB_PVRTC_4BPPV1_IMG:
        case COMPRESSED_RGBA_PVRTC_2BPPV1_IMG:
        case COMPRESSED_RGBA_PVRTC_4BPPV1_IMG:
            throw new TypeError('PVRTC compressed textures have no portable RHI v2 format');
        case COMPRESSED_RGB_ATC_WEBGL:
        case COMPRESSED_RGBA_ATC_EXPLICIT_ALPHA_WEBGL:
        case COMPRESSED_RGBA_ATC_INTERPOLATED_ALPHA_WEBGL:
            throw new TypeError('ATC compressed textures have no portable RHI v2 format');
        default:
            throw new TypeError(
                `Compressed texture format ${String(internalFormat)} has no portable RHI v2 mapping`
            );
    }
}

function requireDeclaration(
    source: Texture<unknown>,
    expectedType: number,
    expectedFormat: number,
    label: string
): void {
    if (source.type !== expectedType || source.format !== expectedFormat) {
        throw new TypeError(
            `${label} requires source format/type ${String(expectedFormat)}/${String(expectedType)}`
        );
    }
}

function resolveTextureFormat(source: Texture<unknown>): TextureFormatInfo {
    if (source.compressed) return resolveCompressedFormat(source.internalFormat);
    const internalFormat = source.internalFormat;
    switch (internalFormat) {
        case DEPTH_COMPONENT16:
            requireDeclaration(
                source,
                UNSIGNED_SHORT,
                DEPTH_COMPONENT,
                'DEPTH_COMPONENT16 storage'
            );
            return colorFormatInfo('depth16unorm', 'u16', 1, 2, undefined, 'depth-only');
        case DEPTH_COMPONENT24:
            requireDeclaration(source, UNSIGNED_INT, DEPTH_COMPONENT, 'DEPTH_COMPONENT24 storage');
            return opaqueDepthStencilFormatInfo('depth24plus', 1, 4);
        case DEPTH_COMPONENT32F:
            requireDeclaration(source, FLOAT, DEPTH_COMPONENT, 'DEPTH_COMPONENT32F storage');
            return colorFormatInfo('depth32float', 'f32', 1, 4, undefined, 'depth-only');
        case DEPTH24_STENCIL8:
            requireDeclaration(
                source,
                UNSIGNED_INT_24_8,
                DEPTH_STENCIL,
                'DEPTH24_STENCIL8 storage'
            );
            return opaqueDepthStencilFormatInfo('depth24plus-stencil8', 1, 4);
        case DEPTH32F_STENCIL8:
            requireDeclaration(
                source,
                FLOAT_32_UNSIGNED_INT_24_8_REV,
                DEPTH_STENCIL,
                'DEPTH32F_STENCIL8 storage'
            );
            return opaqueDepthStencilFormatInfo('depth32float-stencil8', 2, 8);
        case R8:
            requireDeclaration(source, UNSIGNED_BYTE, RED, 'R8 storage');
            return colorFormatInfo('r8unorm', 'u8', 1, 1);
        case R8_SNORM:
            requireDeclaration(source, BYTE, RED, 'R8_SNORM storage');
            return colorFormatInfo('r8snorm', 'i8', 1, 1);
        case RG8:
            requireDeclaration(source, UNSIGNED_BYTE, RG, 'RG8 storage');
            return colorFormatInfo('rg8unorm', 'u8', 2, 2);
        case RG8_SNORM:
            requireDeclaration(source, BYTE, RG, 'RG8_SNORM storage');
            return colorFormatInfo('rg8snorm', 'i8', 2, 2);
        case RGB8:
            requireDeclaration(source, UNSIGNED_BYTE, RGB, 'RGB8 storage');
            return colorFormatInfo('rgba8unorm', 'u8', 3, 4, 0xff);
        case RGB8_SNORM:
            requireDeclaration(source, BYTE, RGB, 'RGB8_SNORM storage');
            return colorFormatInfo('rgba8snorm', 'i8', 3, 4, 0x7f);
        case RGBA8:
            requireDeclaration(source, UNSIGNED_BYTE, RGBA, 'RGBA8 storage');
            return colorFormatInfo('rgba8unorm', 'u8', 4, 4);
        case RGBA8_SNORM:
            requireDeclaration(source, BYTE, RGBA, 'RGBA8_SNORM storage');
            return colorFormatInfo('rgba8snorm', 'i8', 4, 4);
        case SRGB8:
            requireDeclaration(source, UNSIGNED_BYTE, RGB, 'SRGB8 storage');
            return colorFormatInfo('rgba8unorm-srgb', 'u8', 3, 4, 0xff);
        case SRGB8_ALPHA8:
            requireDeclaration(source, UNSIGNED_BYTE, RGBA, 'SRGB8_ALPHA8 storage');
            return colorFormatInfo('rgba8unorm-srgb', 'u8', 4, 4);
        case R16F:
            requireDeclaration(source, HALF_FLOAT, RED, 'R16F storage');
            return colorFormatInfo('r16float', 'f16', 1, 2);
        case RG16F:
            requireDeclaration(source, HALF_FLOAT, RG, 'RG16F storage');
            return colorFormatInfo('rg16float', 'f16', 2, 4);
        case RGB16F:
            requireDeclaration(source, HALF_FLOAT, RGB, 'RGB16F storage');
            return colorFormatInfo('rgba16float', 'f16', 3, 8, 0x3c00);
        case RGBA16F:
            requireDeclaration(source, HALF_FLOAT, RGBA, 'RGBA16F storage');
            return colorFormatInfo('rgba16float', 'f16', 4, 8);
        case R32F:
            requireDeclaration(source, FLOAT, RED, 'R32F storage');
            return colorFormatInfo('r32float', 'f32', 1, 4);
        case RG32F:
            requireDeclaration(source, FLOAT, RG, 'RG32F storage');
            return colorFormatInfo('rg32float', 'f32', 2, 8);
        case RGB32F:
            requireDeclaration(source, FLOAT, RGB, 'RGB32F storage');
            return colorFormatInfo('rgba32float', 'f32', 3, 16, 1);
        case RGBA32F:
            requireDeclaration(source, FLOAT, RGBA, 'RGBA32F storage');
            return colorFormatInfo('rgba32float', 'f32', 4, 16);
        case R8I:
            requireDeclaration(source, BYTE, RED_INTEGER, 'R8I storage');
            return colorFormatInfo('r8sint', 'i8', 1, 1);
        case R8UI:
            requireDeclaration(source, UNSIGNED_BYTE, RED_INTEGER, 'R8UI storage');
            return colorFormatInfo('r8uint', 'u8', 1, 1);
        case RG8I:
            requireDeclaration(source, BYTE, RG_INTEGER, 'RG8I storage');
            return colorFormatInfo('rg8sint', 'i8', 2, 2);
        case RG8UI:
            requireDeclaration(source, UNSIGNED_BYTE, RG_INTEGER, 'RG8UI storage');
            return colorFormatInfo('rg8uint', 'u8', 2, 2);
        case RGB8I:
            requireDeclaration(source, BYTE, RGB_INTEGER, 'RGB8I storage');
            return colorFormatInfo('rgba8sint', 'i8', 3, 4, 1);
        case RGB8UI:
            requireDeclaration(source, UNSIGNED_BYTE, RGB_INTEGER, 'RGB8UI storage');
            return colorFormatInfo('rgba8uint', 'u8', 3, 4, 1);
        case RGBA8I:
            requireDeclaration(source, BYTE, RGBA_INTEGER, 'RGBA8I storage');
            return colorFormatInfo('rgba8sint', 'i8', 4, 4);
        case RGBA8UI:
            requireDeclaration(source, UNSIGNED_BYTE, RGBA_INTEGER, 'RGBA8UI storage');
            return colorFormatInfo('rgba8uint', 'u8', 4, 4);
        case R16I:
            requireDeclaration(source, SHORT, RED_INTEGER, 'R16I storage');
            return colorFormatInfo('r16sint', 'i16', 1, 2);
        case R16UI:
            requireDeclaration(source, UNSIGNED_SHORT, RED_INTEGER, 'R16UI storage');
            return colorFormatInfo('r16uint', 'u16', 1, 2);
        case RG16I:
            requireDeclaration(source, SHORT, RG_INTEGER, 'RG16I storage');
            return colorFormatInfo('rg16sint', 'i16', 2, 4);
        case RG16UI:
            requireDeclaration(source, UNSIGNED_SHORT, RG_INTEGER, 'RG16UI storage');
            return colorFormatInfo('rg16uint', 'u16', 2, 4);
        case RGB16I:
            requireDeclaration(source, SHORT, RGB_INTEGER, 'RGB16I storage');
            return colorFormatInfo('rgba16sint', 'i16', 3, 8, 1);
        case RGB16UI:
            requireDeclaration(source, UNSIGNED_SHORT, RGB_INTEGER, 'RGB16UI storage');
            return colorFormatInfo('rgba16uint', 'u16', 3, 8, 1);
        case RGBA16I:
            requireDeclaration(source, SHORT, RGBA_INTEGER, 'RGBA16I storage');
            return colorFormatInfo('rgba16sint', 'i16', 4, 8);
        case RGBA16UI:
            requireDeclaration(source, UNSIGNED_SHORT, RGBA_INTEGER, 'RGBA16UI storage');
            return colorFormatInfo('rgba16uint', 'u16', 4, 8);
        case R32I:
            requireDeclaration(source, INT, RED_INTEGER, 'R32I storage');
            return colorFormatInfo('r32sint', 'i32', 1, 4);
        case R32UI:
            requireDeclaration(source, UNSIGNED_INT, RED_INTEGER, 'R32UI storage');
            return colorFormatInfo('r32uint', 'u32', 1, 4);
        case RG32I:
            requireDeclaration(source, INT, RG_INTEGER, 'RG32I storage');
            return colorFormatInfo('rg32sint', 'i32', 2, 8);
        case RG32UI:
            requireDeclaration(source, UNSIGNED_INT, RG_INTEGER, 'RG32UI storage');
            return colorFormatInfo('rg32uint', 'u32', 2, 8);
        case RGB32I:
            requireDeclaration(source, INT, RGB_INTEGER, 'RGB32I storage');
            return colorFormatInfo('rgba32sint', 'i32', 3, 16, 1);
        case RGB32UI:
            requireDeclaration(source, UNSIGNED_INT, RGB_INTEGER, 'RGB32UI storage');
            return colorFormatInfo('rgba32uint', 'u32', 3, 16, 1);
        case RGBA32I:
            requireDeclaration(source, INT, RGBA_INTEGER, 'RGBA32I storage');
            return colorFormatInfo('rgba32sint', 'i32', 4, 16);
        case RGBA32UI:
            requireDeclaration(source, UNSIGNED_INT, RGBA_INTEGER, 'RGBA32UI storage');
            return colorFormatInfo('rgba32uint', 'u32', 4, 16);
        case RGB10_A2:
            requireDeclaration(source, UNSIGNED_INT_2_10_10_10_REV, RGBA, 'RGB10_A2 storage');
            return packedFormatInfo('rgb10a2unorm', 'u32', 4);
        case RGB10_A2UI:
            requireDeclaration(
                source,
                UNSIGNED_INT_2_10_10_10_REV,
                RGBA_INTEGER,
                'RGB10_A2UI storage'
            );
            return packedFormatInfo('rgb10a2uint', 'u32', 4);
        case R11F_G11F_B10F:
            requireDeclaration(source, UNSIGNED_INT_10F_11F_11F_REV, RGB, 'R11F_G11F_B10F storage');
            return packedFormatInfo('rg11b10ufloat', 'u32', 4);
        case RGB9_E5:
            requireDeclaration(source, UNSIGNED_INT_5_9_9_9_REV, RGB, 'RGB9_E5 storage');
            return packedFormatInfo('rgb9e5ufloat', 'u32', 4);
    }
    if (internalFormat === RGBA || internalFormat === RGB) {
        requireDeclaration(source, source.type, internalFormat, 'Unsized color texture storage');
        const components = internalFormat === RGB ? 3 : 4;
        if (source.type === UNSIGNED_BYTE) {
            return colorFormatInfo(
                'rgba8unorm',
                'u8',
                components,
                4,
                components === 3 ? 0xff : undefined
            );
        }
        if (source.type === HALF_FLOAT) {
            return colorFormatInfo(
                'rgba16float',
                'f16',
                components,
                8,
                components === 3 ? 0x3c00 : undefined
            );
        }
        if (source.type === FLOAT) {
            return colorFormatInfo(
                'rgba32float',
                'f32',
                components,
                16,
                components === 3 ? 1 : undefined
            );
        }
    }
    throw new TypeError(
        `Texture storage ${String(source.internalFormat)}/${String(source.format)}/${String(source.type)} has no supported RHI v2 sampled format`
    );
}

function mapCompareFunction(
    value: RHICompareFunction | number | undefined
): RHICompareFunction | undefined {
    if (value === undefined) return undefined;
    if (typeof value === 'string') {
        switch (value) {
            case 'never':
            case 'less':
            case 'equal':
            case 'less-equal':
            case 'greater':
            case 'not-equal':
            case 'greater-equal':
            case 'always':
                return value;
            default:
                throw new TypeError(`Unsupported texture comparison function: ${String(value)}`);
        }
    }
    switch (value) {
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
            throw new TypeError(`Unsupported texture comparison function: ${String(value)}`);
    }
}

function currentUploadIdentity(source: Texture<unknown>): {
    readonly image: unknown;
    readonly mipmaps: readonly TextureMipmap[] | null;
} {
    const backing = getTextureRecoveryBacking(source);
    if (backing) return backing;
    return { image: source.image, mipmaps: source.mipmaps };
}

function imageDataPixels(
    source: unknown,
    width: number,
    height: number,
    formatInfo: TextureFormatInfo
): Uint8ClampedArray | null {
    if (typeof ImageData === 'undefined' || !(source instanceof ImageData)) return null;
    if (
        formatInfo.storage !== 'u8' ||
        formatInfo.sourceElementsPerPixel !== 4 ||
        (formatInfo.format !== 'rgba8unorm' && formatInfo.format !== 'rgba8unorm-srgb')
    ) {
        throw new TypeError(
            'ImageData uploads require byte-backed rgba8unorm or rgba8unorm-srgb texture storage'
        );
    }
    if (source.width !== width || source.height !== height) {
        throw new RangeError(
            `ImageData source is ${String(source.width)}x${String(source.height)}; ${String(width)}x${String(height)} are required`
        );
    }
    return source.data;
}

function requireUploadPixelData(
    source: unknown,
    width: number,
    height: number,
    formatInfo: TextureFormatInfo
): TexturePixelData {
    if (isTexturePixelData(source)) return source;
    const pixels = imageDataPixels(source, width, height, formatInfo);
    if (pixels) return pixels;
    throw new TypeError(
        'DOM/external image uploads require an RHI external-image copy contract; only ImageData is synchronously supported'
    );
}

function allocateTypedArrayLike(source: TypedArray, length: number): TypedArray {
    if (source instanceof Int8Array) return new Int8Array(length);
    if (source instanceof Uint8ClampedArray) return new Uint8ClampedArray(length);
    if (source instanceof Uint8Array) return new Uint8Array(length);
    if (source instanceof Int16Array) return new Int16Array(length);
    if (source instanceof Uint16Array) return new Uint16Array(length);
    if (source instanceof Int32Array) return new Int32Array(length);
    if (source instanceof Uint32Array) return new Uint32Array(length);
    if (source instanceof Float32Array) return new Float32Array(length);
    return new Float64Array(length);
}

function storageMatches(source: TypedArray, storage: TextureStorage): boolean {
    switch (storage) {
        case 'i8':
            return source instanceof Int8Array;
        case 'u8':
            return source instanceof Uint8Array || source instanceof Uint8ClampedArray;
        case 'i16':
            return source instanceof Int16Array;
        case 'u16':
        case 'f16':
            return source instanceof Uint16Array;
        case 'i32':
            return source instanceof Int32Array;
        case 'u32':
            return source instanceof Uint32Array;
        case 'f32':
            return source instanceof Float32Array;
        case 'compressed':
            return source instanceof Uint8Array;
        case 'opaque-depth-stencil':
            return false;
    }
}

function expandRGB(source: TypedArray, pixelCount: number, opaqueAlpha: number): TypedArray {
    const output = allocateTypedArrayLike(source, pixelCount * 4);
    for (let pixel = 0; pixel < pixelCount; pixel++) {
        const sourceOffset = pixel * 3;
        const outputOffset = pixel * 4;
        output[outputOffset] = source[sourceOffset] ?? 0;
        output[outputOffset + 1] = source[sourceOffset + 1] ?? 0;
        output[outputOffset + 2] = source[sourceOffset + 2] ?? 0;
        output[outputOffset + 3] = opaqueAlpha;
    }
    return output;
}

function flipTexturePixelLayers(
    source: TypedArray,
    elementsPerRow: number,
    height: number,
    depth: number
): TypedArray {
    if (depth === 1) return flipTexturePixelRows(source, elementsPerRow, height);
    const output = allocateTypedArrayLike(source, source.length);
    const sourceBytes = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
    const outputBytes = new Uint8Array(output.buffer, output.byteOffset, output.byteLength);
    const rowByteLength = elementsPerRow * source.BYTES_PER_ELEMENT;
    const sliceByteLength = rowByteLength * height;
    for (let slice = 0; slice < depth; slice++) {
        for (let targetRow = 0; targetRow < height; targetRow++) {
            const sourceRow = height - targetRow - 1;
            const sourceOffset = slice * sliceByteLength + sourceRow * rowByteLength;
            outputBytes.set(
                sourceBytes.subarray(sourceOffset, sourceOffset + rowByteLength),
                slice * sliceByteLength + targetRow * rowByteLength
            );
        }
    }
    return output;
}

function normalizedColorData(
    source: Texture<unknown>,
    pixelData: TexturePixelData,
    formatInfo: TextureFormatInfo,
    width: number,
    height: number,
    depth: number
): TypedArray {
    if (formatInfo.storage === 'compressed' || formatInfo.storage === 'opaque-depth-stencil') {
        throw new TypeError('Non-color payload cannot use color conversion');
    }
    const converted = texturePixelDataToTypedArray(pixelData, source.type);
    if (!storageMatches(converted, formatInfo.storage)) {
        throw new TypeError(
            `${formatInfo.format} uploads require ${formatInfo.storage} typed pixel storage`
        );
    }

    const pixelCount = width * height * depth;
    const requiredElements = pixelCount * formatInfo.sourceElementsPerPixel;
    if (!Number.isSafeInteger(pixelCount) || !Number.isSafeInteger(requiredElements)) {
        throw new RangeError('Texture pixel count exceeds the safe integer range');
    }
    if (converted.length !== requiredElements) {
        throw new RangeError(
            `Texture data contains ${String(converted.length)} values; ${String(requiredElements)} are required for ${String(width)}x${String(height)}x${String(depth)}`
        );
    }
    return formatInfo.sourceElementsPerPixel === 3
        ? expandRGB(converted, pixelCount, formatInfo.opaqueAlpha ?? 1)
        : converted;
}

function createUploadEntry(
    source: Texture<unknown>,
    payload: unknown,
    formatInfo: TextureFormatInfo,
    mipLevel: number,
    layer: number,
    width: number,
    height: number,
    depth: number
): TextureUploadEntry | null {
    if (payload === null) return null;
    if (isRHIExternalImageSource(payload)) {
        if (depth !== 1) {
            throw new TypeError(
                'External image uploads cannot populate multiple array or 3D slices'
            );
        }
        if (
            formatInfo.storage !== 'u8' ||
            (formatInfo.format !== 'rgba8unorm' && formatInfo.format !== 'rgba8unorm-srgb')
        ) {
            throw new TypeError(
                'External-image uploads require byte-backed rgba8unorm or rgba8unorm-srgb texture storage'
            );
        }
        const dimensions = getRHIExternalImageSourceDimensions(payload);
        if (dimensions.width !== width || dimensions.height !== height) {
            throw new RangeError(
                `External image source is ${String(dimensions.width)}x${String(dimensions.height)}; ${String(width)}x${String(height)} are required`
            );
        }
        return Object.freeze({
            kind: 'external',
            source: payload,
            mipLevel,
            layer,
            width,
            height,
            flipY: source.flipY,
            premultipliedAlpha: source.premultiplyAlpha
        });
    }
    if (source.premultiplyAlpha) {
        throw new TypeError(
            'premultiplyAlpha is supported only for browser external-image uploads'
        );
    }
    const pixelData = requireUploadPixelData(payload, width, height, formatInfo);
    if (formatInfo.storage === 'opaque-depth-stencil') {
        throw new TypeError(
            `${formatInfo.format} raw uploads have no shared WebGL2/WebGPU RHI v2 byte representation; create empty storage instead`
        );
    }
    if (formatInfo.storage === 'compressed') {
        const converted = texturePixelDataToTypedArray(pixelData, source.type);
        if (!(converted instanceof Uint8Array)) {
            throw new TypeError('Compressed texture payloads require Uint8Array storage');
        }
        const blockColumns = Math.ceil(width / formatInfo.blockWidth);
        const blockRows = Math.ceil(height / formatInfo.blockHeight);
        const requiredBytes = blockColumns * blockRows * depth * formatInfo.bytesPerBlock;
        if (!Number.isSafeInteger(requiredBytes)) {
            throw new RangeError('Compressed texture byte length exceeds the safe integer range');
        }
        if (converted.byteLength !== requiredBytes) {
            throw new RangeError(
                `Compressed mip ${String(mipLevel)} layer ${String(layer)} contains ${String(converted.byteLength)} bytes; ${String(requiredBytes)} are required for ${String(width)}x${String(height)}x${String(depth)} ${formatInfo.format}`
            );
        }
        return Object.freeze({
            kind: 'bytes',
            data: converted,
            mipLevel,
            layer,
            width,
            height,
            depth,
            bytesPerRow: blockColumns * formatInfo.bytesPerBlock,
            rowsPerImage: blockRows
        });
    }

    const normalized = normalizedColorData(source, pixelData, formatInfo, width, height, depth);
    const data = source.flipY
        ? flipTexturePixelLayers(
              normalized,
              width * formatInfo.physicalElementsPerPixel,
              height,
              depth
          )
        : normalized;
    return Object.freeze({
        kind: 'bytes',
        data,
        mipLevel,
        layer,
        width,
        height,
        depth,
        bytesPerRow: width * formatInfo.bytesPerBlock,
        rowsPerImage: height,
        ...(formatInfo.aspect === undefined ? {} : { aspect: formatInfo.aspect })
    });
}

function buildUploadEntries(
    source: Texture<unknown>,
    image: unknown,
    mipmaps: readonly TextureMipmap[] | null,
    formatInfo: TextureFormatInfo,
    mipLevelCount: number
): readonly TextureUploadEntry[] {
    const entries: TextureUploadEntry[] = [];
    if (mipmaps && mipmaps.length > 0) {
        for (let entry = 0; entry < mipmaps.length; entry++) {
            const mipmap = mipmaps[entry];
            if (!mipmap) throw new Error('Explicit texture mipmap entry is missing');
            const mipLevel = source.target === TEXTURE_CUBE_MAP ? Math.floor(entry / 6) : entry;
            const layer = source.target === TEXTURE_CUBE_MAP ? entry % 6 : 0;
            const depth = source.target === TEXTURE_CUBE_MAP ? 1 : (mipmap.depth ?? 1);
            const upload = createUploadEntry(
                source,
                mipmap.data,
                formatInfo,
                mipLevel,
                layer,
                mipmap.width,
                mipmap.height,
                depth
            );
            if (upload) entries.push(upload);
        }
        return Object.freeze(entries);
    }
    if (!source.useMipmap && mipLevelCount !== 1) {
        throw new Error('Single-level texture snapshot has invalid mip count');
    }
    if (source.target === TEXTURE_CUBE_MAP) {
        if (!Array.isArray(image) || image.length !== 6) {
            throw new TypeError('RHI v2 cube textures require exactly six image faces');
        }
        for (let layer = 0; layer < 6; layer++) {
            const upload = createUploadEntry(
                source,
                image[layer],
                formatInfo,
                0,
                layer,
                source.width,
                source.height,
                1
            );
            if (upload) entries.push(upload);
        }
        return Object.freeze(entries);
    }
    const depth =
        source.target === TEXTURE_3D || source.target === TEXTURE_2D_ARRAY ? source.depth : 1;
    const upload = createUploadEntry(
        source,
        image,
        formatInfo,
        0,
        0,
        source.width,
        source.height,
        depth
    );
    if (upload) entries.push(upload);
    return Object.freeze(entries);
}

function samplerKey(descriptor: RHISamplerDescriptor): string {
    return `${String(descriptor.addressModeU)}|${String(descriptor.addressModeV)}|${String(descriptor.addressModeW)}|${String(descriptor.magFilter)}|${String(descriptor.minFilter)}|${String(descriptor.mipmapFilter)}|${String(descriptor.lodMinClamp)}|${String(descriptor.lodMaxClamp)}|${descriptor.compare ?? '-'}|${String(descriptor.maxAnisotropy)}`;
}

function sameShape(left: TextureShapeSnapshot, right: TextureShapeSnapshot): boolean {
    return (
        left.width === right.width &&
        left.height === right.height &&
        left.layers === right.layers &&
        left.mipLevelCount === right.mipLevelCount &&
        left.viewDimension === right.viewDimension &&
        left.rhiFormat === right.rhiFormat
    );
}

function sameSnapshot(left: TextureSourceSnapshot, right: TextureSourceSnapshot): boolean {
    return (
        left.image === right.image &&
        left.revision === right.revision &&
        left.width === right.width &&
        left.height === right.height &&
        left.layers === right.layers &&
        left.mipLevelCount === right.mipLevelCount &&
        left.viewDimension === right.viewDimension &&
        left.rhiFormat === right.rhiFormat &&
        left.target === right.target &&
        left.depth === right.depth &&
        left.internalFormat === right.internalFormat &&
        left.format === right.format &&
        left.type === right.type &&
        left.compressed === right.compressed &&
        left.flipY === right.flipY &&
        left.premultiplyAlpha === right.premultiplyAlpha &&
        left.mipmaps === right.mipmaps &&
        left.wrapS === right.wrapS &&
        left.wrapT === right.wrapT &&
        left.wrapR === right.wrapR &&
        left.magFilter === right.magFilter &&
        left.minFilter === right.minFilter &&
        left.anisotropic === right.anisotropic &&
        left.autoUpdate === right.autoUpdate &&
        left.autoGenerateMipmaps === right.autoGenerateMipmaps &&
        left.compare === right.compare
    );
}

function sameUploadDefinition(left: TextureSourceSnapshot, right: TextureSourceSnapshot): boolean {
    return (
        left.image === right.image &&
        left.revision === right.revision &&
        sameShape(left, right) &&
        left.target === right.target &&
        left.depth === right.depth &&
        left.internalFormat === right.internalFormat &&
        left.format === right.format &&
        left.type === right.type &&
        left.compressed === right.compressed &&
        left.flipY === right.flipY &&
        left.premultiplyAlpha === right.premultiplyAlpha &&
        left.mipmaps === right.mipmaps &&
        left.autoGenerateMipmaps === right.autoGenerateMipmaps
    );
}

function sourceMatchesSnapshot(
    source: Texture<unknown>,
    snapshot: TextureSourceSnapshot,
    compare: RHICompareFunction | undefined
): boolean {
    const identity = currentUploadIdentity(source);
    return (
        identity.image === snapshot.image &&
        source.updateRevision === snapshot.revision &&
        source.width === snapshot.width &&
        source.height === snapshot.height &&
        source.target === snapshot.target &&
        source.depth === snapshot.depth &&
        source.internalFormat === snapshot.internalFormat &&
        source.format === snapshot.format &&
        source.type === snapshot.type &&
        source.compressed === snapshot.compressed &&
        source.flipY === snapshot.flipY &&
        source.premultiplyAlpha === snapshot.premultiplyAlpha &&
        identity.mipmaps === snapshot.mipmaps &&
        source.wrapS === snapshot.wrapS &&
        source.wrapT === snapshot.wrapT &&
        source.wrapR === snapshot.wrapR &&
        source.magFilter === snapshot.magFilter &&
        source.minFilter === snapshot.minFilter &&
        source.anisotropic === snapshot.anisotropic &&
        source.autoUpdate === snapshot.autoUpdate &&
        compare === snapshot.compare
    );
}

function freezeHandles(
    texture: ResourceRegistryHandle<RHITexture>,
    view: ResourceRegistryHandle<RHITextureView>,
    sampler: ResourceRegistryHandle<RHISampler>
): Readonly<TextureResourceHandles> {
    return Object.freeze({ texture, view, sampler });
}

/**
 * Backend-neutral sampled texture/view/sampler cache.
 *
 * Every source subresource and device capability is validated before registry allocation. Logical
 * handle replacement and content acknowledgement then participate in the enclosing upload batch's
 * two-phase transaction, including device recovery and submission-safe retirement.
 */
export class TextureResourceCache implements RHIUploadBatchParticipant {
    private records = new WeakMap<Texture<unknown>, TextureResourceRecord>();
    readonly #recordSet = new Set<TextureResourceRecord>();
    readonly #samplers = new Map<string, SamplerEntry>();
    readonly #pending = new Map<TextureResourceRecord, PendingTextureUse>();
    readonly #deferredDetach = new Set<TextureResourceRecord>();
    #state: CacheState = 'idle';
    #frameIndex = 0;
    #uploads: RHIUploadBatch | null = null;

    constructor(readonly registry: ResourceRegistry) {}

    get active(): boolean {
        return this.#state === 'active';
    }

    /** Enlist this stable cache in one RenderFrame/RHIUploadBatch transaction. */
    beginFrame(frameIndex: number, uploads: RHIUploadBatch): void {
        if (this.#state === 'destroyed') throw new Error('Texture resource cache is destroyed');
        if (this.#state === 'active') {
            throw new Error('Texture resource cache frame is already active');
        }
        if (!Number.isSafeInteger(frameIndex) || frameIndex < 0) {
            throw new RangeError('Texture resource cache frame index must be non-negative');
        }
        uploads.enlist(this);
        this.#frameIndex = frameIndex;
        this.#uploads = uploads;
        this.#state = 'active';
    }

    /** Validate, stage upload/replacements, and return logical handles for bind-group recipes. */
    prepare(
        source: Texture<unknown>,
        options?: TextureResourcePrepareOptions
    ): Readonly<TextureResourceHandles> {
        this.assertActive();
        const compare = mapCompareFunction(options?.compare);
        let record = this.records.get(source);
        let newRecord = false;
        if (record === undefined) {
            const snapshot = this.snapshotSource(source, compare);
            record = this.createRecord(source, snapshot);
            newRecord = true;
        } else {
            this.#deferredDetach.delete(record);
            this.synchronizeRecord(record);
        }

        const existing = this.#pending.get(record);
        const reusableSnapshot = existing?.snapshot ?? record.snapshot;
        const matchesReusable = sourceMatchesSnapshot(source, reusableSnapshot, compare);
        const snapshot =
            matchesReusable && (existing !== undefined || !reusableSnapshot.autoUpdate)
                ? reusableSnapshot
                : this.snapshotSource(source, compare);
        if (existing) {
            if (!sameSnapshot(existing.snapshot, snapshot)) {
                throw new Error('Texture source changed after its first use in one frame');
            }
            return existing.handles;
        }

        const shapeReplacement = !sameShape(record.shape, snapshot);
        const samplerReplacement = record.sampler.key !== snapshot.samplerKey;
        const pair = shapeReplacement ? this.createTexturePair(source, snapshot) : record.handles;
        let sampler = record.sampler;
        try {
            if (samplerReplacement) sampler = this.acquireSampler(snapshot);
        } catch (error) {
            if (shapeReplacement) this.discardTexturePair(pair);
            throw error;
        }
        const handles =
            shapeReplacement || samplerReplacement
                ? freezeHandles(pair.texture, pair.view, sampler.handle)
                : record.handles;

        try {
            if (
                shapeReplacement ||
                record.committedRevision !== snapshot.revision ||
                !sameUploadDefinition(record.snapshot, snapshot) ||
                snapshot.autoUpdate
            ) {
                this.enqueueUploads(handles.texture, snapshot);
            }
        } catch (error) {
            if (newRecord) this.discardUnsubmittedRecord(record);
            else {
                if (samplerReplacement) this.releaseSampler(sampler);
                if (shapeReplacement) this.discardTexturePair(pair);
            }
            throw error;
        }

        this.#pending.set(record, {
            record,
            snapshot,
            handles,
            newRecord,
            shapeReplacement,
            samplerReplacement,
            sampler,
            registryGeneration: this.registry.generation
        });
        return handles;
    }

    getHandles(source: Texture<unknown>): Readonly<TextureResourceHandles> {
        const record = this.requireRecord(source);
        this.synchronizeRecord(record);
        return this.#pending.get(record)?.handles ?? record.handles;
    }

    getTextureHandle(source: Texture<unknown>): ResourceRegistryHandle<RHITexture> {
        return this.getHandles(source).texture;
    }

    getTextureViewHandle(source: Texture<unknown>): ResourceRegistryHandle<RHITextureView> {
        return this.getHandles(source).view;
    }

    getSamplerHandle(source: Texture<unknown>): ResourceRegistryHandle<RHISampler> {
        return this.getHandles(source).sampler;
    }

    resolveTexture(source: Texture<unknown>): RHITexture {
        return this.registry.resolve(this.getTextureHandle(source));
    }

    resolveView(source: Texture<unknown>): RHITextureView {
        return this.registry.resolve(this.getTextureViewHandle(source));
    }

    resolveSampler(source: Texture<unknown>): RHISampler {
        return this.registry.resolve(this.getSamplerHandle(source));
    }

    diagnostics(source: Texture<unknown>): Readonly<TextureResourceCacheDiagnostics> | null {
        const record = this.records.get(source);
        if (!record) return null;
        this.synchronizeRecord(record);
        const pending = this.#pending.get(record);
        const snapshot = pending?.snapshot;
        return Object.freeze({
            handles: pending?.handles ?? record.handles,
            committedRevision: record.committedRevision,
            sourceRevision: source.updateRevision,
            width: snapshot?.width ?? record.shape.width,
            height: snapshot?.height ?? record.shape.height,
            registryGeneration: record.registryGeneration
        });
    }

    /** Validation half of the upload batch's two-phase commit. */
    prepareCommit(submission: RHISubmission): void {
        if (this.#state !== 'active') return;
        if (submission.status === 'failed') {
            const error = submission.error;
            throw error instanceof Error
                ? error
                : new Error('Cannot commit a failed RHI submission');
        }
        for (const pending of this.#pending.values()) {
            if (pending.registryGeneration !== this.registry.generation) {
                throw new Error('Resource registry changed during a texture cache frame');
            }
            if (
                !sourceMatchesSnapshot(
                    pending.record.source,
                    pending.snapshot,
                    pending.snapshot.compare
                )
            ) {
                const current = this.snapshotSource(
                    pending.record.source,
                    pending.snapshot.compare
                );
                if (!sameSnapshot(current, pending.snapshot)) {
                    throw new Error('Texture source changed after its first use in one frame');
                }
            }
            const texture = this.registry.resolve(pending.handles.texture);
            const view = this.registry.resolve(pending.handles.view);
            const sampler = this.registry.resolve(pending.handles.sampler);
            if (
                texture.deviceId !== submission.deviceId ||
                view.deviceId !== submission.deviceId ||
                sampler.deviceId !== submission.deviceId
            ) {
                throw new Error('Texture cache submission belongs to another RHI device');
            }
        }
    }

    /** Commit staged handles and revisions only after graph execution returned a submission. */
    commit(submission: RHISubmission): void {
        if (this.#state !== 'active') return;
        this.prepareCommit(submission);
        const committedRecords: TextureResourceRecord[] = [];
        for (const pending of this.#pending.values()) {
            const record = pending.record;
            this.markHandlesUsed(pending.handles, this.#frameIndex);
            if (pending.shapeReplacement) this.releaseTexturePair(record.handles);
            if (pending.samplerReplacement) this.releaseSampler(record.sampler);
            record.handles = pending.handles;
            record.shape = Object.freeze({
                width: pending.snapshot.width,
                height: pending.snapshot.height,
                layers: pending.snapshot.layers,
                mipLevelCount: pending.snapshot.mipLevelCount,
                viewDimension: pending.snapshot.viewDimension,
                rhiFormat: pending.snapshot.rhiFormat
            });
            record.sampler = pending.sampler;
            record.sampler.submitted = true;
            record.snapshot = pending.snapshot;
            record.committedRevision = pending.snapshot.revision;
            record.registryGeneration = pending.registryGeneration;
            committedRecords.push(record);
        }
        for (const record of committedRecords) {
            if (!record.source.releaseImageIfAllowed()) continue;
            record.snapshot = this.snapshotSource(record.source, record.snapshot.compare);
        }
        this.finishTransaction();
    }

    /** Keep committed handles/revisions unchanged so failed uploads are retried next frame. */
    rollback(): void {
        if (this.#state !== 'active') return;
        let rollbackError: unknown;
        try {
            for (const pending of this.#pending.values()) {
                try {
                    if (pending.newRecord) this.discardUnsubmittedRecord(pending.record);
                    else {
                        if (pending.samplerReplacement) this.releaseSampler(pending.sampler);
                        if (pending.shapeReplacement) this.discardTexturePair(pending.handles);
                    }
                } catch (error) {
                    rollbackError ??= error;
                }
            }
        } finally {
            try {
                this.finishTransaction();
            } catch (error) {
                rollbackError ??= error;
            }
        }
        if (rollbackError !== undefined) {
            throw rollbackError instanceof Error
                ? rollbackError
                : new Error('Texture resource cache rollback failed');
        }
    }

    markUsed(source: Texture<unknown>, frameIndex: number): void {
        const record = this.requireRecord(source);
        this.synchronizeRecord(record);
        this.markHandlesUsed(this.#pending.get(record)?.handles ?? record.handles, frameIndex);
    }

    detach(source: Texture<unknown>): boolean {
        if (this.#state === 'destroyed') throw new Error('Texture resource cache is destroyed');
        const record = this.records.get(source);
        if (!record || !this.#recordSet.has(record)) return false;
        if (this.#state === 'active' && this.#pending.has(record)) {
            if (this.#deferredDetach.has(record)) return false;
            this.#deferredDetach.add(record);
            return true;
        }
        this.detachRecord(record);
        return true;
    }

    collect(completedFrame: number): number {
        return this.registry.collect(completedFrame);
    }

    /** Recover the shared registry on a replacement device of the same backend. */
    recover(device: RHIDevice): void {
        this.assertIdle();
        if (device.backend !== this.registry.deviceBackend) {
            throw new TypeError('Texture resources can recover only on the same RHI backend');
        }
        this.registry.recover(device);
        this.synchronizeAfterRecovery();
    }

    /** Synchronize records after another owner recovered the shared ResourceRegistry. */
    synchronizeAfterRecovery(): void {
        this.assertIdle();
        for (const record of this.#recordSet) this.synchronizeRecord(record);
    }

    destroy(): void {
        if (this.#state === 'destroyed') return;
        if (this.#state === 'active') this.rollback();
        for (const record of this.#recordSet) {
            this.releaseTexturePair(record.handles);
            this.releaseSampler(record.sampler);
        }
        this.#recordSet.clear();
        this.#samplers.clear();
        this.#deferredDetach.clear();
        this.records = new WeakMap();
        this.#state = 'destroyed';
    }

    private snapshotSource(
        source: Texture<unknown>,
        compareSource: RHICompareFunction | number | undefined
    ): TextureSourceSnapshot {
        if (!(source instanceof Texture)) {
            throw new TypeError('Texture resource cache requires an engine Texture source');
        }
        if (
            source.target !== TEXTURE_2D &&
            source.target !== TEXTURE_CUBE_MAP &&
            source.target !== TEXTURE_2D_ARRAY &&
            source.target !== TEXTURE_3D
        ) {
            throw new TypeError(
                'Texture resource cache requires TEXTURE_2D, TEXTURE_CUBE_MAP, TEXTURE_2D_ARRAY, or TEXTURE_3D'
            );
        }
        const layered = source.target === TEXTURE_2D_ARRAY || source.target === TEXTURE_3D;
        if (!layered && source.depth !== 1) {
            throw new RangeError('2D and cube texture depth must be exactly one');
        }
        if (layered && (!Number.isSafeInteger(source.depth) || source.depth <= 0)) {
            throw new RangeError('Layered texture depth must be a positive safe integer');
        }
        if (source.compressed && source.flipY) {
            throw new TypeError(
                'Compressed texture flipY cannot be represented by portable block-byte uploads'
            );
        }
        const upload = prepareTextureUpload(source);
        if (!Number.isSafeInteger(source.width) || source.width <= 0) {
            throw new RangeError('Texture width must be a positive safe integer');
        }
        if (!Number.isSafeInteger(source.height) || source.height <= 0) {
            throw new RangeError('Texture height must be a positive safe integer');
        }
        const limits = this.registry.deviceCapabilities.limits;
        if (source.target === TEXTURE_3D) {
            if (
                source.width > limits.maxTextureDimension3D ||
                source.height > limits.maxTextureDimension3D ||
                source.depth > limits.maxTextureDimension3D
            ) {
                throw new RangeError('3D texture dimensions exceed maxTextureDimension3D');
            }
        } else {
            if (
                source.width > limits.maxTextureDimension2D ||
                source.height > limits.maxTextureDimension2D
            ) {
                throw new RangeError('Texture dimensions exceed maxTextureDimension2D');
            }
            if (source.target === TEXTURE_2D_ARRAY && source.depth > limits.maxTextureArrayLayers) {
                throw new RangeError('2D-array texture depth exceeds maxTextureArrayLayers');
            }
        }
        if (source.target === TEXTURE_CUBE_MAP && source.width !== source.height) {
            throw new RangeError('Cube textures require square faces');
        }

        const formatInfo = resolveTextureFormat(source);
        const layers = source.target === TEXTURE_CUBE_MAP ? 6 : layered ? source.depth : 1;
        const dimension: '2d' | '3d' = source.target === TEXTURE_3D ? '3d' : '2d';
        const viewDimension: '2d' | '2d-array' | 'cube' | '3d' =
            source.target === TEXTURE_CUBE_MAP
                ? 'cube'
                : source.target === TEXTURE_2D_ARRAY
                  ? '2d-array'
                  : source.target === TEXTURE_3D
                    ? '3d'
                    : '2d';
        const explicitMipLevelCount =
            upload.mipmaps === null || upload.mipmaps.length === 0
                ? 0
                : source.target === TEXTURE_CUBE_MAP
                  ? upload.mipmaps.length / 6
                  : upload.mipmaps.length;
        const mipLevelCount =
            explicitMipLevelCount > 0
                ? explicitMipLevelCount
                : source.useMipmap
                  ? source.mipmapCount
                  : 1;
        const autoGenerateMipmaps =
            source.useMipmap && explicitMipLevelCount === 0 && mipLevelCount > 1;
        if (autoGenerateMipmaps && (viewDimension === '2d-array' || viewDimension === '3d')) {
            throw new TypeError(
                '2D-array and 3D textures using a mipmap filter require a complete explicit mipmap chain'
            );
        }
        const compare = mapCompareFunction(compareSource);
        const magFilter = mapMagFilter(source.magFilter);
        const minFilters = mapMinFilters(source.minFilter);
        let mipmapFilter = minFilters.mipmapFilter;
        const anisotropic = source.anisotropic;
        if (!Number.isSafeInteger(anisotropic) || anisotropic < 1) {
            throw new RangeError('Texture anisotropy must be a positive safe integer');
        }
        if (anisotropic > 16) {
            throw new RangeError('Portable RHI texture anisotropy cannot exceed 16');
        }
        if (anisotropic > 1) {
            if (magFilter !== 'linear' || minFilters.minFilter !== 'linear') {
                throw new TypeError('Anisotropic texture samplers require linear min/mag filters');
            }
            mipmapFilter = 'linear';
        }

        const formatCapabilities = this.registry.deviceCapabilities.getTextureFormatCapabilities(
            formatInfo.format
        );
        if (!formatCapabilities.sampled) {
            throw new TypeError(
                source.compressed
                    ? `Compressed RHI format ${formatInfo.format} is unsupported by the active backend/device`
                    : `The active RHI cannot sample ${formatInfo.format} textures`
            );
        }
        if (autoGenerateMipmaps && formatInfo.storage === 'compressed') {
            throw new TypeError(
                'Compressed textures using a mipmap filter require a complete explicit mipmap chain'
            );
        }
        if (autoGenerateMipmaps && !formatCapabilities.renderable) {
            throw new TypeError(
                `The active RHI cannot automatically generate mipmaps for non-renderable ${formatInfo.format} textures`
            );
        }
        if (
            (magFilter === 'linear' ||
                minFilters.minFilter === 'linear' ||
                mipmapFilter === 'linear') &&
            !formatCapabilities.filterable
        ) {
            throw new TypeError(
                `The active RHI cannot linearly filter ${formatInfo.format} textures`
            );
        }
        const uploads = buildUploadEntries(
            source,
            upload.image,
            upload.mipmaps,
            formatInfo,
            mipLevelCount
        );
        const hasExternalUpload = uploads.some(entry => entry.kind === 'external');
        if (hasExternalUpload && !formatCapabilities.renderable) {
            throw new TypeError(
                `The active RHI cannot use ${formatInfo.format} with the portable external-image path`
            );
        }
        const samplerDescriptor = Object.freeze({
            label: 'Texture sampler',
            lifetime: 'persistent',
            addressModeU: mapAddressMode(source.wrapS),
            addressModeV: mapAddressMode(source.wrapT),
            addressModeW: mapAddressMode(source.wrapR),
            magFilter,
            minFilter: minFilters.minFilter,
            mipmapFilter,
            lodMinClamp: 0,
            lodMaxClamp: source.useMipmap ? Math.max(0, mipLevelCount - 1) : 0,
            ...(compare === undefined ? {} : { compare }),
            maxAnisotropy: anisotropic
        } satisfies RHISamplerDescriptor);
        const textureDescriptor = Object.freeze({
            label: source.name || `Texture ${source.id}`,
            lifetime: 'persistent',
            size: Object.freeze({
                width: source.width,
                height: source.height,
                depthOrArrayLayers: layers
            }),
            mipLevelCount,
            sampleCount: 1,
            dimension,
            viewDimension,
            format: formatInfo.format,
            usage:
                RHITextureUsage.TEXTURE_BINDING |
                RHITextureUsage.COPY_DST |
                (hasExternalUpload || autoGenerateMipmaps ? RHITextureUsage.RENDER_ATTACHMENT : 0)
        } satisfies RHITextureDescriptor);
        // Run the complete portable descriptor validation before any registry recipe allocates.
        normalizeRHITextureDescriptor(textureDescriptor, this.registry.deviceCapabilities);
        normalizeRHISamplerDescriptor(samplerDescriptor, this.registry.deviceCapabilities);
        return {
            image: upload.image,
            revision: source.updateRevision,
            width: source.width,
            height: source.height,
            layers,
            mipLevelCount,
            viewDimension,
            rhiFormat: formatInfo.format,
            target: source.target,
            depth: source.depth,
            internalFormat: source.internalFormat,
            format: source.format,
            type: source.type,
            compressed: source.compressed,
            flipY: source.flipY,
            premultiplyAlpha: source.premultiplyAlpha,
            mipmaps: upload.mipmaps,
            wrapS: source.wrapS,
            wrapT: source.wrapT,
            wrapR: source.wrapR,
            magFilter: source.magFilter,
            minFilter: source.minFilter,
            anisotropic: source.anisotropic,
            autoUpdate: source.autoUpdate,
            compare,
            samplerKey: samplerKey(samplerDescriptor),
            uploads,
            autoGenerateMipmaps,
            textureDescriptor,
            samplerDescriptor
        };
    }

    private createRecord(
        source: Texture<unknown>,
        snapshot: TextureSourceSnapshot
    ): TextureResourceRecord {
        const pair = this.createTexturePair(source, snapshot);
        let sampler: SamplerEntry;
        try {
            sampler = this.acquireSampler(snapshot);
        } catch (error) {
            this.discardTexturePair(pair);
            throw error;
        }
        const record: TextureResourceRecord = {
            source,
            handles: freezeHandles(pair.texture, pair.view, sampler.handle),
            shape: Object.freeze({
                width: snapshot.width,
                height: snapshot.height,
                layers: snapshot.layers,
                mipLevelCount: snapshot.mipLevelCount,
                viewDimension: snapshot.viewDimension,
                rhiFormat: snapshot.rhiFormat
            }),
            sampler,
            snapshot,
            committedRevision: -1,
            registryGeneration: this.registry.generation
        };
        this.records.set(source, record);
        this.#recordSet.add(record);
        return record;
    }

    private createTexturePair(
        source: Texture<unknown>,
        snapshot: TextureSourceSnapshot
    ): Pick<TextureResourceHandles, 'texture' | 'view'> {
        const texture = this.registry.registerTexture(snapshot.textureDescriptor);
        const viewLabel = `${source.name || source.id} sampled view`;
        try {
            const view = this.registry.register<RHITextureView>({
                label: viewLabel,
                dependencies: [texture],
                create: (_device, resolve) =>
                    resolve(texture).createView({
                        label: viewLabel,
                        dimension: snapshot.viewDimension,
                        baseMipLevel: 0,
                        mipLevelCount: snapshot.mipLevelCount,
                        baseArrayLayer: 0,
                        arrayLayerCount: snapshot.viewDimension === '3d' ? 1 : snapshot.layers
                    })
            });
            return { texture, view };
        } catch (error) {
            this.registry.discardUnsubmitted(texture);
            throw error;
        }
    }

    private acquireSampler(snapshot: TextureSourceSnapshot): SamplerEntry {
        const existing = this.#samplers.get(snapshot.samplerKey);
        if (existing) {
            if (existing.references === Number.MAX_SAFE_INTEGER) {
                throw new RangeError('Texture sampler reference count is exhausted');
            }
            existing.references++;
            return existing;
        }
        const handle = this.registry.registerSampler(snapshot.samplerDescriptor);
        const entry: SamplerEntry = {
            key: snapshot.samplerKey,
            descriptor: snapshot.samplerDescriptor,
            handle,
            references: 1,
            submitted: false
        };
        this.#samplers.set(entry.key, entry);
        return entry;
    }

    private releaseSampler(entry: SamplerEntry): void {
        if (entry.references <= 0) throw new Error('Texture sampler is already released');
        entry.references--;
        if (entry.references !== 0) return;
        if (this.#samplers.get(entry.key) === entry) this.#samplers.delete(entry.key);
        if (entry.submitted) this.registry.release(entry.handle);
        else this.registry.discardUnsubmitted(entry.handle);
    }

    private enqueueUploads(
        textureHandle: ResourceRegistryHandle<RHITexture>,
        snapshot: TextureSourceSnapshot
    ): void {
        const uploads = this.#uploads;
        if (!uploads) throw new Error('Texture resource cache has no active upload batch');
        const texture = this.registry.resolve(textureHandle);
        for (const entry of snapshot.uploads) {
            if (entry.kind === 'external') {
                uploads.copyExternalImageToTexture(
                    { source: entry.source, flipY: entry.flipY },
                    {
                        texture,
                        mipLevel: entry.mipLevel,
                        origin: { x: 0, y: 0, z: entry.layer },
                        premultipliedAlpha: entry.premultipliedAlpha
                    },
                    { width: entry.width, height: entry.height, depthOrArrayLayers: 1 }
                );
            } else {
                uploads.writeTexture(
                    {
                        texture,
                        mipLevel: entry.mipLevel,
                        origin: { x: 0, y: 0, z: entry.layer },
                        ...(entry.aspect === undefined ? {} : { aspect: entry.aspect })
                    },
                    entry.data,
                    { bytesPerRow: entry.bytesPerRow, rowsPerImage: entry.rowsPerImage },
                    {
                        width: entry.width,
                        height: entry.height,
                        depthOrArrayLayers: entry.depth
                    }
                );
            }
        }
        if (snapshot.autoGenerateMipmaps) uploads.generateMipmaps(texture);
    }

    private synchronizeRecord(record: TextureResourceRecord): void {
        if (record.registryGeneration === this.registry.generation) return;
        this.registry.resolve(record.handles.texture);
        this.registry.resolve(record.handles.view);
        this.registry.resolve(record.handles.sampler);
        record.registryGeneration = this.registry.generation;
        record.committedRevision = -1;
    }

    private requireRecord(source: Texture<unknown>): TextureResourceRecord {
        const record = this.records.get(source);
        if (!record) throw new Error('Logical texture source is not cached');
        return record;
    }

    private markHandlesUsed(handles: Readonly<TextureResourceHandles>, frameIndex: number): void {
        this.registry.markUsed(handles.texture, frameIndex);
        this.registry.markUsed(handles.view, frameIndex);
        this.registry.markUsed(handles.sampler, frameIndex);
    }

    private releaseTexturePair(handles: Pick<TextureResourceHandles, 'texture' | 'view'>): void {
        let cleanupError: unknown;
        try {
            this.registry.release(handles.view);
        } catch (error) {
            cleanupError ??= error;
        }
        try {
            this.registry.release(handles.texture);
        } catch (error) {
            cleanupError ??= error;
        }
        if (cleanupError !== undefined) {
            throw cleanupError instanceof Error
                ? cleanupError
                : new Error('Texture pair release failed');
        }
    }

    private discardTexturePair(handles: Pick<TextureResourceHandles, 'texture' | 'view'>): void {
        let cleanupError: unknown;
        try {
            this.registry.discardUnsubmitted(handles.view);
        } catch (error) {
            cleanupError ??= error;
        }
        try {
            this.registry.discardUnsubmitted(handles.texture);
        } catch (error) {
            cleanupError ??= error;
        }
        if (cleanupError !== undefined) {
            throw cleanupError instanceof Error
                ? cleanupError
                : new Error('Unsubmitted texture pair discard failed');
        }
    }

    private discardUnsubmittedRecord(record: TextureResourceRecord): void {
        if (this.records.get(record.source) === record) this.records.delete(record.source);
        if (!this.#recordSet.delete(record)) return;
        this.#deferredDetach.delete(record);
        let cleanupError: unknown;
        try {
            this.discardTexturePair(record.handles);
        } catch (error) {
            cleanupError ??= error;
        }
        try {
            this.releaseSampler(record.sampler);
        } catch (error) {
            cleanupError ??= error;
        }
        if (cleanupError !== undefined) {
            throw cleanupError instanceof Error
                ? cleanupError
                : new Error('Unsubmitted texture record discard failed');
        }
    }

    private detachRecord(record: TextureResourceRecord): void {
        if (this.records.get(record.source) === record) this.records.delete(record.source);
        if (!this.#recordSet.delete(record)) return;
        this.#deferredDetach.delete(record);
        let cleanupError: unknown;
        try {
            this.releaseTexturePair(record.handles);
        } catch (error) {
            cleanupError ??= error;
        }
        try {
            this.releaseSampler(record.sampler);
        } catch (error) {
            cleanupError ??= error;
        }
        if (cleanupError !== undefined) {
            throw cleanupError instanceof Error
                ? cleanupError
                : new Error('Texture record detach failed');
        }
    }

    private finishTransaction(): void {
        this.#pending.clear();
        let detachError: unknown;
        try {
            for (const record of this.#deferredDetach) {
                try {
                    this.detachRecord(record);
                } catch (error) {
                    detachError ??= error;
                }
            }
        } finally {
            this.#deferredDetach.clear();
            this.#uploads = null;
            this.#state = 'idle';
        }
        if (detachError !== undefined) {
            throw detachError instanceof Error
                ? detachError
                : new Error('Texture resource cache deferred detach failed');
        }
    }

    private assertActive(): void {
        if (this.#state !== 'active') {
            if (this.#state === 'destroyed') throw new Error('Texture resource cache is destroyed');
            throw new Error('Texture resource cache requires beginFrame before preparation');
        }
    }

    private assertIdle(): void {
        if (this.#state === 'active') {
            throw new Error('Texture resource cache operation is not allowed during a frame');
        }
        if (this.#state === 'destroyed') throw new Error('Texture resource cache is destroyed');
    }
}
