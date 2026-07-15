import type {
    RHICommandContext,
    RHIImageCopyBuffer,
    RHIImageCopyExternalImage,
    RHIImageCopyExternalImageToTexture,
    RHIImageCopyTexture,
    RHIImageDataLayout
} from './RHICommands';
import type { RHIBuffer, RHIDevice, RHITexture } from './RHIResources';
import {
    RHIBufferUsage,
    RHITextureUsage,
    type RHIDataSource,
    type RHIExtent3D,
    type RHITextureAspect,
    type RHITextureFormat
} from './RHITypes';
import {
    RHIValidationError,
    assertRHICommandContextOpen,
    assertRHIObjectOwnedBy,
    assertRHIObjectOwnedByContext,
    rhiTextureFormatHasDepth,
    rhiTextureFormatHasStencil,
    snapshotRHIDataSource,
    type RHIValidationErrorCode
} from './RHIValidation';

/** Backend-neutral texel-block layout used by portable copy validation. */
export interface RHITextureFormatBlockInfo {
    readonly blockWidth: number;
    readonly blockHeight: number;
    /** Undefined means this aspect has no portable buffer-copy footprint. */
    readonly bytesPerBlock?: number;
}

interface NormalizedCopyExtent {
    readonly width: number;
    readonly height: number;
    readonly depthOrArrayLayers: number;
}

interface NormalizedCopyOrigin {
    readonly x: number;
    readonly y: number;
    readonly z: number;
}

interface ValidatedTextureCopy {
    readonly texture: RHITexture;
    readonly mipLevel: number;
    readonly origin: NormalizedCopyOrigin;
    readonly aspect: RHITextureAspect;
    readonly mipExtent: NormalizedCopyExtent;
    readonly blockInfo: RHITextureFormatBlockInfo;
}

export interface RHIExternalImageDimensions {
    readonly width: number;
    readonly height: number;
}

/** Caller-owned scalar result used by allocation-free external-image command validation. */
export interface RHIExternalImageDimensionsStorage {
    width: number;
    height: number;
}

const BLOCK_1X1_1 = Object.freeze({ blockWidth: 1, blockHeight: 1, bytesPerBlock: 1 });
const BLOCK_1X1_2 = Object.freeze({ blockWidth: 1, blockHeight: 1, bytesPerBlock: 2 });
const BLOCK_1X1_4 = Object.freeze({ blockWidth: 1, blockHeight: 1, bytesPerBlock: 4 });
const BLOCK_1X1_8 = Object.freeze({ blockWidth: 1, blockHeight: 1, bytesPerBlock: 8 });
const BLOCK_1X1_16 = Object.freeze({ blockWidth: 1, blockHeight: 1, bytesPerBlock: 16 });
const BLOCK_1X1_OPAQUE = Object.freeze({ blockWidth: 1, blockHeight: 1 });
const BLOCK_4X4_8 = Object.freeze({ blockWidth: 4, blockHeight: 4, bytesPerBlock: 8 });
const BLOCK_4X4_16 = Object.freeze({ blockWidth: 4, blockHeight: 4, bytesPerBlock: 16 });

function fail(code: RHIValidationErrorCode, message: string, path: string): never {
    throw new RHIValidationError(code, message, path);
}

function positiveInteger(value: number, path: string): void {
    if (!Number.isSafeInteger(value) || value <= 0) {
        fail('invalid-descriptor', 'must be a positive safe integer', path);
    }
}

function nonNegativeInteger(value: number, path: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
        fail('invalid-descriptor', 'must be a non-negative safe integer', path);
    }
}

function checkedMultiply(first: number, second: number, path: string): number {
    const result = first * second;
    if (!Number.isSafeInteger(result)) {
        fail('out-of-bounds', 'copy layout exceeds the safe integer range', path);
    }
    return result;
}

function checkedAdd(first: number, second: number, path: string): number {
    const result = first + second;
    if (!Number.isSafeInteger(result)) {
        fail('out-of-bounds', 'copy layout exceeds the safe integer range', path);
    }
    return result;
}

function validateAspect(format: RHITextureFormat, aspect: RHITextureAspect, path: string): void {
    const hasDepth = rhiTextureFormatHasDepth(format);
    const hasStencil = rhiTextureFormatHasStencil(format);
    if (!hasDepth && !hasStencil) {
        if (aspect !== 'all') {
            fail('invalid-descriptor', 'color formats only support the all aspect', path);
        }
        return;
    }
    if (aspect === 'depth-only' && !hasDepth) {
        fail('invalid-descriptor', 'format has no depth aspect', path);
    }
    if (aspect === 'stencil-only' && !hasStencil) {
        fail('invalid-descriptor', 'format has no stencil aspect', path);
    }
}

/** Return the portable texel-block footprint for one format aspect. */
export function getRHITextureFormatBlockInfo(
    format: RHITextureFormat,
    aspect: RHITextureAspect = 'all'
): Readonly<RHITextureFormatBlockInfo> {
    validateAspect(format, aspect, 'texture.aspect');

    switch (format) {
        case 'stencil8':
            return BLOCK_1X1_1;
        case 'depth16unorm':
            return BLOCK_1X1_2;
        case 'depth24plus':
            return BLOCK_1X1_OPAQUE;
        case 'depth24plus-stencil8':
            return aspect === 'stencil-only' ? BLOCK_1X1_1 : BLOCK_1X1_OPAQUE;
        case 'depth32float':
            return BLOCK_1X1_4;
        case 'depth32float-stencil8':
            if (aspect === 'stencil-only') return BLOCK_1X1_1;
            if (aspect === 'depth-only') return BLOCK_1X1_4;
            return BLOCK_1X1_OPAQUE;

        case 'r8unorm':
        case 'r8snorm':
        case 'r8uint':
        case 'r8sint':
            return BLOCK_1X1_1;

        case 'r16uint':
        case 'r16sint':
        case 'r16float':
        case 'rg8unorm':
        case 'rg8snorm':
        case 'rg8uint':
        case 'rg8sint':
            return BLOCK_1X1_2;

        case 'r32uint':
        case 'r32sint':
        case 'r32float':
        case 'rg16uint':
        case 'rg16sint':
        case 'rg16float':
        case 'rgba8unorm':
        case 'rgba8unorm-srgb':
        case 'rgba8snorm':
        case 'rgba8uint':
        case 'rgba8sint':
        case 'bgra8unorm':
        case 'bgra8unorm-srgb':
        case 'rgb10a2unorm':
        case 'rgb10a2uint':
        case 'rg11b10ufloat':
        case 'rgb9e5ufloat':
            return BLOCK_1X1_4;

        case 'rg32uint':
        case 'rg32sint':
        case 'rg32float':
        case 'rgba16uint':
        case 'rgba16sint':
        case 'rgba16float':
            return BLOCK_1X1_8;

        case 'rgba32uint':
        case 'rgba32sint':
        case 'rgba32float':
            return BLOCK_1X1_16;

        case 'bc1-rgba-unorm':
        case 'bc1-rgba-unorm-srgb':
        case 'etc2-rgb8unorm':
        case 'etc2-rgb8unorm-srgb':
        case 'etc2-rgb8a1unorm':
        case 'etc2-rgb8a1unorm-srgb':
        case 'eac-r11unorm':
        case 'eac-r11snorm':
            return BLOCK_4X4_8;

        case 'bc2-rgba-unorm':
        case 'bc2-rgba-unorm-srgb':
        case 'bc3-rgba-unorm':
        case 'bc3-rgba-unorm-srgb':
        case 'etc2-rgba8unorm':
        case 'etc2-rgba8unorm-srgb':
        case 'eac-rg11unorm':
        case 'eac-rg11snorm':
        case 'astc-4x4-unorm':
        case 'astc-4x4-unorm-srgb':
            return BLOCK_4X4_16;
    }
}

function normalizeCopyExtent(copySize: RHIExtent3D, path = 'copySize'): NormalizedCopyExtent {
    const height = copySize.height ?? 1;
    const depthOrArrayLayers = copySize.depthOrArrayLayers ?? 1;
    positiveInteger(copySize.width, `${path}.width`);
    positiveInteger(height, `${path}.height`);
    positiveInteger(depthOrArrayLayers, `${path}.depthOrArrayLayers`);
    return { width: copySize.width, height, depthOrArrayLayers };
}

function externalBrand(value: unknown, brand: string): boolean {
    return Object.prototype.toString.call(value) === brand;
}

/** Narrow to the external sources implemented by both portable browser backends. */
export function isRHIExternalImageSource(
    value: unknown
): value is RHIImageCopyExternalImage['source'] {
    if (typeof value !== 'object' || value === null) return false;
    return (
        (typeof HTMLImageElement !== 'undefined' && value instanceof HTMLImageElement) ||
        (typeof HTMLCanvasElement !== 'undefined' && value instanceof HTMLCanvasElement) ||
        (typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap) ||
        (typeof OffscreenCanvas !== 'undefined' && value instanceof OffscreenCanvas) ||
        (typeof HTMLVideoElement !== 'undefined' && value instanceof HTMLVideoElement) ||
        externalBrand(value, '[object HTMLImageElement]') ||
        externalBrand(value, '[object HTMLCanvasElement]') ||
        externalBrand(value, '[object ImageBitmap]') ||
        externalBrand(value, '[object OffscreenCanvas]') ||
        externalBrand(value, '[object HTMLVideoElement]')
    );
}

function positiveSourceDimension(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? Math.floor(value)
        : null;
}

/** Resolve intrinsic pixels into caller-owned storage without allocating a result record. */
export function resolveRHIExternalImageSourceDimensionsInto(
    value: unknown,
    result: RHIExternalImageDimensionsStorage,
    path = 'source.source'
): void {
    if (!isRHIExternalImageSource(value)) {
        fail(
            'invalid-descriptor',
            'must be an HTMLImageElement, HTMLCanvasElement, ImageBitmap, OffscreenCanvas, or HTMLVideoElement',
            path
        );
    }
    const source = value as unknown as Record<string, unknown>;
    const image =
        (typeof HTMLImageElement !== 'undefined' && value instanceof HTMLImageElement) ||
        externalBrand(value, '[object HTMLImageElement]');
    const video =
        (typeof HTMLVideoElement !== 'undefined' && value instanceof HTMLVideoElement) ||
        externalBrand(value, '[object HTMLVideoElement]');
    const width = positiveSourceDimension(
        video ? source['videoWidth'] : image ? source['naturalWidth'] : source['width']
    );
    const height = positiveSourceDimension(
        video ? source['videoHeight'] : image ? source['naturalHeight'] : source['height']
    );
    if (width === null || height === null) {
        fail('invalid-state', 'does not expose stable positive intrinsic pixel dimensions', path);
    }
    result.width = width;
    result.height = height;
}

/** Resolve the intrinsic pixel size used by both native external-image APIs. */
export function getRHIExternalImageSourceDimensions(
    value: unknown,
    path = 'source.source'
): Readonly<RHIExternalImageDimensions> {
    const result: RHIExternalImageDimensionsStorage = { width: 0, height: 0 };
    resolveRHIExternalImageSourceDimensionsInto(value, result, path);
    return Object.freeze(result);
}

function normalizeCopyOrigin(copy: RHIImageCopyTexture, path: string): NormalizedCopyOrigin {
    const x = copy.origin?.x ?? 0;
    const y = copy.origin?.y ?? 0;
    const z = copy.origin?.z ?? 0;
    nonNegativeInteger(x, `${path}.origin.x`);
    nonNegativeInteger(y, `${path}.origin.y`);
    nonNegativeInteger(z, `${path}.origin.z`);
    return { x, y, z };
}

function mipDimension(size: number, mipLevel: number): number {
    return Math.max(1, Math.floor(size / 2 ** mipLevel));
}

function textureMipExtent(texture: RHITexture, mipLevel: number): NormalizedCopyExtent {
    return {
        width: mipDimension(texture.width, mipLevel),
        height: texture.dimension === '1d' ? 1 : mipDimension(texture.height, mipLevel),
        depthOrArrayLayers:
            texture.dimension === '3d'
                ? mipDimension(texture.depthOrArrayLayers, mipLevel)
                : texture.depthOrArrayLayers
    };
}

function validateAxisBounds(origin: number, size: number, limit: number, path: string): void {
    if (origin > limit || size > limit - origin) {
        fail('out-of-bounds', 'copy region exceeds the texture mip extent', path);
    }
}

function validateBlockAxis(
    origin: number,
    size: number,
    limit: number,
    blockSize: number,
    originPath: string,
    sizePath: string
): void {
    if (origin % blockSize !== 0) {
        fail(
            'invalid-descriptor',
            `must be aligned to a ${String(blockSize)}-texel block`,
            originPath
        );
    }
    if (size % blockSize !== 0 && size !== limit - origin) {
        fail(
            'invalid-descriptor',
            'must be block-aligned unless the copy reaches the mip edge',
            sizePath
        );
    }
}

function validateFullDepthStencilSubresource(
    validated: ValidatedTextureCopy,
    extent: NormalizedCopyExtent,
    path: string
): void {
    const { texture, origin, mipExtent } = validated;
    if (
        !rhiTextureFormatHasDepth(texture.format) &&
        !rhiTextureFormatHasStencil(texture.format) &&
        texture.sampleCount === 1
    ) {
        return;
    }
    if (
        origin.x !== 0 ||
        origin.y !== 0 ||
        extent.width !== mipExtent.width ||
        extent.height !== mipExtent.height ||
        (texture.dimension === '3d' &&
            (origin.z !== 0 || extent.depthOrArrayLayers !== mipExtent.depthOrArrayLayers))
    ) {
        fail(
            'invalid-descriptor',
            'depth/stencil and multisampled copies require complete physical subresources',
            path
        );
    }
}

function validateTextureCopy(
    copy: RHIImageCopyTexture,
    extent: NormalizedCopyExtent,
    path: string,
    bufferCopy: boolean,
    extentPath = 'copySize'
): ValidatedTextureCopy {
    const mipLevel = copy.mipLevel ?? 0;
    nonNegativeInteger(mipLevel, `${path}.mipLevel`);
    if (mipLevel >= copy.texture.mipLevelCount) {
        fail('out-of-bounds', 'mip level exceeds the texture mip chain', `${path}.mipLevel`);
    }

    const origin = normalizeCopyOrigin(copy, path);
    const aspect = copy.aspect ?? 'all';
    validateAspect(copy.texture.format, aspect, `${path}.aspect`);
    if (
        bufferCopy &&
        rhiTextureFormatHasDepth(copy.texture.format) &&
        rhiTextureFormatHasStencil(copy.texture.format) &&
        aspect === 'all'
    ) {
        fail(
            'invalid-descriptor',
            'depth-stencil buffer copies require one explicit aspect',
            `${path}.aspect`
        );
    }

    const blockInfo = getRHITextureFormatBlockInfo(copy.texture.format, aspect);
    if (bufferCopy && blockInfo.bytesPerBlock === undefined) {
        fail(
            'unsupported-format',
            'texture aspect has no portable buffer-copy footprint',
            `${path}.aspect`
        );
    }
    if (bufferCopy && copy.texture.sampleCount !== 1) {
        fail(
            'invalid-descriptor',
            'buffer-texture copies require a single-sampled texture',
            `${path}.texture.sampleCount`
        );
    }

    const mipExtent = textureMipExtent(copy.texture, mipLevel);
    validateAxisBounds(origin.x, extent.width, mipExtent.width, `${path}.origin.x`);
    validateAxisBounds(origin.y, extent.height, mipExtent.height, `${path}.origin.y`);
    validateAxisBounds(
        origin.z,
        extent.depthOrArrayLayers,
        mipExtent.depthOrArrayLayers,
        `${path}.origin.z`
    );
    validateBlockAxis(
        origin.x,
        extent.width,
        mipExtent.width,
        blockInfo.blockWidth,
        `${path}.origin.x`,
        `${extentPath}.width`
    );
    validateBlockAxis(
        origin.y,
        extent.height,
        mipExtent.height,
        blockInfo.blockHeight,
        `${path}.origin.y`,
        `${extentPath}.height`
    );

    const validated = { texture: copy.texture, mipLevel, origin, aspect, mipExtent, blockInfo };
    validateFullDepthStencilSubresource(validated, extent, path);
    return validated;
}

function validateBufferState(buffer: RHIBuffer, path: string): void {
    if (buffer.mapState !== 'unmapped') {
        fail('invalid-state', 'buffer must be unmapped for a copy command', path);
    }
}

function validateBufferRange(
    buffer: RHIBuffer,
    offset: number,
    size: number,
    path: string,
    offsetPath: string,
    sizePath: string
): void {
    nonNegativeInteger(offset, offsetPath);
    positiveInteger(size, sizePath);
    if (offset > buffer.size || size > buffer.size - offset) {
        fail('out-of-bounds', 'copy range exceeds the buffer size', path);
    }
}

interface LinearTextureLayoutPaths {
    readonly root: string;
    readonly offset: string;
    readonly bytesPerRow: string;
    readonly rowsPerImage: string;
}

const SOURCE_LAYOUT_PATHS: LinearTextureLayoutPaths = {
    root: 'source',
    offset: 'source.offset',
    bytesPerRow: 'source.bytesPerRow',
    rowsPerImage: 'source.rowsPerImage'
};
const DESTINATION_LAYOUT_PATHS: LinearTextureLayoutPaths = {
    root: 'destination',
    offset: 'destination.offset',
    bytesPerRow: 'destination.bytesPerRow',
    rowsPerImage: 'destination.rowsPerImage'
};
const WRITE_TEXTURE_LAYOUT_PATHS: LinearTextureLayoutPaths = {
    root: 'dataLayout',
    offset: 'dataLayout.offset',
    bytesPerRow: 'dataLayout.bytesPerRow',
    rowsPerImage: 'dataLayout.rowsPerImage'
};

function validateLinearTextureLayout(
    layout: RHIImageDataLayout,
    dataByteLength: number,
    extentWidth: number,
    extentHeight: number,
    extentDepthOrArrayLayers: number,
    blockInfo: RHITextureFormatBlockInfo,
    paths: LinearTextureLayoutPaths,
    require256ByteRows: boolean
): void {
    const bytesPerBlock = blockInfo.bytesPerBlock;
    if (bytesPerBlock === undefined) {
        fail('unsupported-format', 'texture aspect has no buffer-copy footprint', paths.root);
    }

    const offset = layout.offset ?? 0;
    nonNegativeInteger(offset, paths.offset);
    if (offset % 4 !== 0 || offset % bytesPerBlock !== 0) {
        fail(
            'invalid-descriptor',
            'must be aligned to both 4 bytes and the texel block size',
            paths.offset
        );
    }

    const blockColumns = Math.ceil(extentWidth / blockInfo.blockWidth);
    const blockRows = Math.ceil(extentHeight / blockInfo.blockHeight);
    const tightRowBytes = checkedMultiply(blockColumns, bytesPerBlock, paths.bytesPerRow);
    const bytesPerRowRequired = blockRows > 1 || extentDepthOrArrayLayers > 1;
    if (bytesPerRowRequired && layout.bytesPerRow === undefined) {
        fail(
            'invalid-descriptor',
            'is required for copies with multiple block rows or images',
            paths.bytesPerRow
        );
    }
    if (extentDepthOrArrayLayers > 1 && layout.rowsPerImage === undefined) {
        fail(
            'invalid-descriptor',
            'is required for copies with multiple images',
            paths.rowsPerImage
        );
    }

    const bytesPerRow = layout.bytesPerRow ?? tightRowBytes;
    positiveInteger(bytesPerRow, paths.bytesPerRow);
    if (bytesPerRow < tightRowBytes) {
        fail(
            'invalid-descriptor',
            'is smaller than one complete texel-block row',
            paths.bytesPerRow
        );
    }
    if (bytesPerRow % bytesPerBlock !== 0) {
        fail('invalid-descriptor', 'must be a multiple of the texel block size', paths.bytesPerRow);
    }
    if (require256ByteRows && layout.bytesPerRow !== undefined && bytesPerRow % 256 !== 0) {
        fail('invalid-descriptor', 'must be 256-byte aligned', paths.bytesPerRow);
    }

    const rowsPerImage = layout.rowsPerImage ?? blockRows;
    positiveInteger(rowsPerImage, paths.rowsPerImage);
    if (rowsPerImage < blockRows) {
        fail(
            'invalid-descriptor',
            'is smaller than the copied block-row count',
            paths.rowsPerImage
        );
    }

    const imageStride = checkedMultiply(rowsPerImage, bytesPerRow, paths.root);
    const precedingImages = checkedMultiply(extentDepthOrArrayLayers - 1, imageStride, paths.root);
    const precedingRows = checkedMultiply(blockRows - 1, bytesPerRow, paths.root);
    const requiredEnd = checkedAdd(
        checkedAdd(checkedAdd(offset, precedingImages, paths.root), precedingRows, paths.root),
        tightRowBytes,
        paths.root
    );
    if (requiredEnd > dataByteLength) {
        fail('out-of-bounds', 'copy layout exceeds the data capacity', paths.root);
    }
}

function requireBufferUsage(buffer: RHIBuffer, usage: number, path: string): void {
    if ((buffer.usage & usage) === 0) {
        fail(
            'invalid-descriptor',
            usage === RHIBufferUsage.COPY_SRC
                ? 'buffer lacks COPY_SRC usage'
                : 'buffer lacks COPY_DST usage',
            path
        );
    }
}

function requireTextureUsage(texture: RHITexture, usage: number, path: string): void {
    if ((texture.usage & usage) === 0) {
        const label =
            usage === RHITextureUsage.COPY_SRC
                ? 'COPY_SRC'
                : usage === RHITextureUsage.COPY_DST
                  ? 'COPY_DST'
                  : usage === RHITextureUsage.TEXTURE_BINDING
                    ? 'TEXTURE_BINDING'
                    : usage === RHITextureUsage.RENDER_ATTACHMENT
                      ? 'RENDER_ATTACHMENT'
                      : 'required';
        fail('invalid-descriptor', `texture lacks ${label} usage`, path);
    }
}

/** Validate a portable buffer-to-buffer copy before backend execution. */
export function validateRHICopyBufferToBuffer(
    context: RHICommandContext,
    source: RHIBuffer,
    sourceOffset: number,
    destination: RHIBuffer,
    destinationOffset: number,
    size: number
): void {
    assertRHICommandContextOpen(context);
    assertRHIObjectOwnedByContext(context, source, 'source');
    assertRHIObjectOwnedByContext(context, destination, 'destination');
    requireBufferUsage(source, RHIBufferUsage.COPY_SRC, 'source');
    requireBufferUsage(destination, RHIBufferUsage.COPY_DST, 'destination');
    validateBufferState(source, 'source');
    validateBufferState(destination, 'destination');
    validateBufferRange(source, sourceOffset, size, 'source', 'source.offset', 'source.size');
    validateBufferRange(
        destination,
        destinationOffset,
        size,
        'destination',
        'destination.offset',
        'destination.size'
    );
    if (sourceOffset % 4 !== 0) {
        fail('invalid-descriptor', 'must be 4-byte aligned', 'source.offset');
    }
    if (destinationOffset % 4 !== 0) {
        fail('invalid-descriptor', 'must be 4-byte aligned', 'destination.offset');
    }
    if (size % 4 !== 0) {
        fail('invalid-descriptor', 'must be 4-byte aligned', 'copySize');
    }
    if (
        source.id === destination.id &&
        source.deviceId === destination.deviceId &&
        sourceOffset < destinationOffset + size &&
        destinationOffset < sourceOffset + size
    ) {
        fail('invalid-descriptor', 'source and destination ranges overlap', 'copy');
    }
}

/** Validate a portable buffer-to-texture copy before backend execution. */
export function validateRHICopyBufferToTexture(
    context: RHICommandContext,
    source: RHIImageCopyBuffer,
    destination: RHIImageCopyTexture,
    copySize: RHIExtent3D
): void {
    assertRHICommandContextOpen(context);
    assertRHIObjectOwnedByContext(context, source.buffer, 'source.buffer');
    assertRHIObjectOwnedByContext(context, destination.texture, 'destination.texture');
    requireBufferUsage(source.buffer, RHIBufferUsage.COPY_SRC, 'source.buffer');
    requireTextureUsage(destination.texture, RHITextureUsage.COPY_DST, 'destination.texture');
    validateBufferState(source.buffer, 'source.buffer');
    const extent = normalizeCopyExtent(copySize);
    const validated = validateTextureCopy(destination, extent, 'destination', true);
    validateLinearTextureLayout(
        source,
        source.buffer.size,
        extent.width,
        extent.height,
        extent.depthOrArrayLayers,
        validated.blockInfo,
        SOURCE_LAYOUT_PATHS,
        true
    );
}

/** Validate a portable texture-to-buffer copy before backend execution. */
export function validateRHICopyTextureToBuffer(
    context: RHICommandContext,
    source: RHIImageCopyTexture,
    destination: RHIImageCopyBuffer,
    copySize: RHIExtent3D
): void {
    assertRHICommandContextOpen(context);
    assertRHIObjectOwnedByContext(context, source.texture, 'source.texture');
    assertRHIObjectOwnedByContext(context, destination.buffer, 'destination.buffer');
    requireTextureUsage(source.texture, RHITextureUsage.COPY_SRC, 'source.texture');
    requireBufferUsage(destination.buffer, RHIBufferUsage.COPY_DST, 'destination.buffer');
    validateBufferState(destination.buffer, 'destination.buffer');
    const extent = normalizeCopyExtent(copySize);
    const validated = validateTextureCopy(source, extent, 'source', true);
    validateLinearTextureLayout(
        destination,
        destination.buffer.size,
        extent.width,
        extent.height,
        extent.depthOrArrayLayers,
        validated.blockInfo,
        DESTINATION_LAYOUT_PATHS,
        true
    );
}

function validateRHIWriteBufferParameters(
    destination: RHIBuffer,
    destinationOffset: number,
    dataByteLength: number,
    dataOffset = 0,
    size?: number
): number {
    requireBufferUsage(destination, RHIBufferUsage.COPY_DST, 'destination');
    validateBufferState(destination, 'destination');
    nonNegativeInteger(dataOffset, 'dataOffset');
    if (dataOffset > dataByteLength) {
        fail('out-of-bounds', 'offset exceeds the data source', 'dataOffset');
    }
    const writeSize = size ?? dataByteLength - dataOffset;
    positiveInteger(writeSize, 'size');
    validateBufferRange(
        destination,
        destinationOffset,
        writeSize,
        'destination',
        'destination.offset',
        'destination.size'
    );
    if (writeSize > dataByteLength - dataOffset) {
        fail('out-of-bounds', 'write range exceeds the data source', 'data');
    }
    if (destinationOffset % 4 !== 0) {
        fail('invalid-descriptor', 'must be 4-byte aligned', 'destination.offset');
    }
    if (dataOffset % 4 !== 0) {
        fail('invalid-descriptor', 'must be 4-byte aligned', 'dataOffset');
    }
    if (writeSize % 4 !== 0) {
        fail('invalid-descriptor', 'must be 4-byte aligned', 'size');
    }
    return writeSize;
}

/** Validate a queued CPU-to-buffer write without opening a frame command context. */
export function validateRHIWriteBuffer(
    device: RHIDevice,
    destination: RHIBuffer,
    destinationOffset: number,
    data: RHIDataSource,
    dataOffset = 0,
    size?: number
): void {
    assertRHIObjectOwnedBy(device, destination, 'destination');
    validateRHIWriteBufferParameters(
        destination,
        destinationOffset,
        data.byteLength,
        dataOffset,
        size
    );
}

/** Validate and snapshot one portable frame-scoped CPU-to-buffer write. */
export function validateAndSnapshotRHIWriteBuffer(
    context: RHICommandContext,
    destination: RHIBuffer,
    destinationOffset: number,
    data: RHIDataSource,
    dataOffset = 0,
    size?: number
): Uint8Array {
    assertRHICommandContextOpen(context);
    assertRHIObjectOwnedByContext(context, destination, 'destination');
    const writeSize = validateRHIWriteBufferParameters(
        destination,
        destinationOffset,
        data.byteLength,
        dataOffset,
        size
    );
    return snapshotRHIDataSource(data).slice(dataOffset, dataOffset + writeSize);
}

function validateRHIWriteTextureParameters(
    destination: RHIImageCopyTexture,
    dataByteLength: number,
    dataLayout: RHIImageDataLayout,
    writeSize: RHIExtent3D
): void {
    const texture = destination.texture;
    requireTextureUsage(texture, RHITextureUsage.COPY_DST, 'destination.texture');

    // Queue writes are a frame hot path. Keep their successful validation scalar-only: all
    // detailed path composition lives in fixed literals, and every format block is a shared
    // immutable record. The general copy validators retain their richer aggregate results.
    const width = writeSize.width;
    const height = writeSize.height ?? 1;
    const depthOrArrayLayers = writeSize.depthOrArrayLayers ?? 1;
    positiveInteger(width, 'writeSize.width');
    positiveInteger(height, 'writeSize.height');
    positiveInteger(depthOrArrayLayers, 'writeSize.depthOrArrayLayers');

    const mipLevel = destination.mipLevel ?? 0;
    nonNegativeInteger(mipLevel, 'destination.mipLevel');
    if (mipLevel >= texture.mipLevelCount) {
        fail('out-of-bounds', 'mip level exceeds the texture mip chain', 'destination.mipLevel');
    }

    const originX = destination.origin?.x ?? 0;
    const originY = destination.origin?.y ?? 0;
    const originZ = destination.origin?.z ?? 0;
    nonNegativeInteger(originX, 'destination.origin.x');
    nonNegativeInteger(originY, 'destination.origin.y');
    nonNegativeInteger(originZ, 'destination.origin.z');

    const aspect = destination.aspect ?? 'all';
    validateAspect(texture.format, aspect, 'destination.aspect');
    if (
        rhiTextureFormatHasDepth(texture.format) &&
        rhiTextureFormatHasStencil(texture.format) &&
        aspect === 'all'
    ) {
        fail(
            'invalid-descriptor',
            'depth-stencil buffer copies require one explicit aspect',
            'destination.aspect'
        );
    }

    const blockInfo = getRHITextureFormatBlockInfo(texture.format, aspect);
    if (blockInfo.bytesPerBlock === undefined) {
        fail(
            'unsupported-format',
            'texture aspect has no portable buffer-copy footprint',
            'destination.aspect'
        );
    }
    if (texture.sampleCount !== 1) {
        fail(
            'invalid-descriptor',
            'buffer-texture copies require a single-sampled texture',
            'destination.texture.sampleCount'
        );
    }

    const mipWidth = mipDimension(texture.width, mipLevel);
    const mipHeight = texture.dimension === '1d' ? 1 : mipDimension(texture.height, mipLevel);
    const mipDepthOrArrayLayers =
        texture.dimension === '3d'
            ? mipDimension(texture.depthOrArrayLayers, mipLevel)
            : texture.depthOrArrayLayers;
    validateAxisBounds(originX, width, mipWidth, 'destination.origin.x');
    validateAxisBounds(originY, height, mipHeight, 'destination.origin.y');
    validateAxisBounds(originZ, depthOrArrayLayers, mipDepthOrArrayLayers, 'destination.origin.z');
    validateBlockAxis(
        originX,
        width,
        mipWidth,
        blockInfo.blockWidth,
        'destination.origin.x',
        'writeSize.width'
    );
    validateBlockAxis(
        originY,
        height,
        mipHeight,
        blockInfo.blockHeight,
        'destination.origin.y',
        'writeSize.height'
    );
    if (
        (rhiTextureFormatHasDepth(texture.format) || rhiTextureFormatHasStencil(texture.format)) &&
        (originX !== 0 ||
            originY !== 0 ||
            width !== mipWidth ||
            height !== mipHeight ||
            (texture.dimension === '3d' &&
                (originZ !== 0 || depthOrArrayLayers !== mipDepthOrArrayLayers)))
    ) {
        fail(
            'invalid-descriptor',
            'depth/stencil copies require complete physical subresources',
            'destination'
        );
    }

    validateLinearTextureLayout(
        dataLayout,
        dataByteLength,
        width,
        height,
        depthOrArrayLayers,
        blockInfo,
        WRITE_TEXTURE_LAYOUT_PATHS,
        false
    );
}

/** Validate a queued CPU-to-texture write without opening a frame command context. */
export function validateRHIWriteTexture(
    device: RHIDevice,
    destination: RHIImageCopyTexture,
    data: RHIDataSource,
    dataLayout: RHIImageDataLayout,
    writeSize: RHIExtent3D
): void {
    assertRHIObjectOwnedBy(device, destination.texture, 'destination.texture');
    validateRHIWriteTextureParameters(destination, data.byteLength, dataLayout, writeSize);
}

/** Validate and snapshot one portable frame-scoped CPU-to-texture write. */
export function validateAndSnapshotRHIWriteTexture(
    context: RHICommandContext,
    destination: RHIImageCopyTexture,
    data: RHIDataSource,
    dataLayout: RHIImageDataLayout,
    writeSize: RHIExtent3D
): Uint8Array {
    assertRHICommandContextOpen(context);
    assertRHIObjectOwnedByContext(context, destination.texture, 'destination.texture');
    const snapshot = snapshotRHIDataSource(data);
    validateRHIWriteTextureParameters(destination, snapshot.byteLength, dataLayout, writeSize);
    return snapshot;
}

function validateExternalImageCopyParameters(
    source: RHIImageCopyExternalImage,
    destination: RHIImageCopyExternalImageToTexture,
    copySize: RHIExtent3D,
    dimensions: RHIExternalImageDimensionsStorage
): void {
    resolveRHIExternalImageSourceDimensionsInto(source.source, dimensions);
    const sourceX = source.origin?.x ?? 0;
    const sourceY = source.origin?.y ?? 0;
    nonNegativeInteger(sourceX, 'source.origin.x');
    nonNegativeInteger(sourceY, 'source.origin.y');
    if (source.flipY !== undefined && typeof source.flipY !== 'boolean') {
        fail('invalid-descriptor', 'must be a boolean', 'source.flipY');
    }
    if (
        destination.premultipliedAlpha !== undefined &&
        typeof destination.premultipliedAlpha !== 'boolean'
    ) {
        fail('invalid-descriptor', 'must be a boolean', 'destination.premultipliedAlpha');
    }

    const width = copySize.width;
    const height = copySize.height ?? 1;
    const depthOrArrayLayers = copySize.depthOrArrayLayers ?? 1;
    positiveInteger(width, 'copySize.width');
    positiveInteger(height, 'copySize.height');
    positiveInteger(depthOrArrayLayers, 'copySize.depthOrArrayLayers');
    if (depthOrArrayLayers !== 1) {
        fail(
            'invalid-descriptor',
            'external-image copies write exactly one texture layer',
            'copySize.depthOrArrayLayers'
        );
    }
    validateAxisBounds(sourceX, width, dimensions.width, 'source.origin.x');
    validateAxisBounds(sourceY, height, dimensions.height, 'source.origin.y');

    const texture = destination.texture;
    requireTextureUsage(texture, RHITextureUsage.COPY_DST, 'destination.texture');
    if ((texture.usage & RHITextureUsage.RENDER_ATTACHMENT) === 0) {
        fail(
            'invalid-descriptor',
            'texture lacks RENDER_ATTACHMENT usage required by the portable external-image path',
            'destination.texture'
        );
    }

    const mipLevel = destination.mipLevel ?? 0;
    nonNegativeInteger(mipLevel, 'destination.mipLevel');
    if (mipLevel >= texture.mipLevelCount) {
        fail('out-of-bounds', 'mip level exceeds the texture mip chain', 'destination.mipLevel');
    }
    const destinationX = destination.origin?.x ?? 0;
    const destinationY = destination.origin?.y ?? 0;
    const destinationZ = destination.origin?.z ?? 0;
    nonNegativeInteger(destinationX, 'destination.origin.x');
    nonNegativeInteger(destinationY, 'destination.origin.y');
    nonNegativeInteger(destinationZ, 'destination.origin.z');
    const aspect = destination.aspect ?? 'all';
    validateAspect(texture.format, aspect, 'destination.aspect');
    const blockInfo = getRHITextureFormatBlockInfo(texture.format, aspect);
    const mipWidth = mipDimension(texture.width, mipLevel);
    const mipHeight = texture.dimension === '1d' ? 1 : mipDimension(texture.height, mipLevel);
    const mipDepthOrArrayLayers =
        texture.dimension === '3d'
            ? mipDimension(texture.depthOrArrayLayers, mipLevel)
            : texture.depthOrArrayLayers;
    validateAxisBounds(destinationX, width, mipWidth, 'destination.origin.x');
    validateAxisBounds(destinationY, height, mipHeight, 'destination.origin.y');
    validateAxisBounds(
        destinationZ,
        depthOrArrayLayers,
        mipDepthOrArrayLayers,
        'destination.origin.z'
    );
    validateBlockAxis(
        destinationX,
        width,
        mipWidth,
        blockInfo.blockWidth,
        'destination.origin.x',
        'copySize.width'
    );
    validateBlockAxis(
        destinationY,
        height,
        mipHeight,
        blockInfo.blockHeight,
        'destination.origin.y',
        'copySize.height'
    );
    if (
        (rhiTextureFormatHasDepth(texture.format) ||
            rhiTextureFormatHasStencil(texture.format) ||
            texture.sampleCount !== 1) &&
        (destinationX !== 0 ||
            destinationY !== 0 ||
            width !== mipWidth ||
            height !== mipHeight ||
            (texture.dimension === '3d' &&
                (destinationZ !== 0 || depthOrArrayLayers !== mipDepthOrArrayLayers)))
    ) {
        fail(
            'invalid-descriptor',
            'depth/stencil and multisampled copies require complete physical subresources',
            'destination'
        );
    }

    if (aspect !== 'all') {
        fail(
            'invalid-descriptor',
            'external-image copies require the all aspect',
            'destination.aspect'
        );
    }
    if (texture.dimension !== '2d') {
        fail(
            'invalid-descriptor',
            'external-image copies require a 2D texture allocation',
            'destination.texture.dimension'
        );
    }
    if (texture.sampleCount !== 1) {
        fail(
            'invalid-descriptor',
            'external-image copies require a single-sampled texture',
            'destination.texture.sampleCount'
        );
    }
    if (texture.format !== 'rgba8unorm' && texture.format !== 'rgba8unorm-srgb') {
        fail(
            'unsupported-format',
            'the portable external-image path supports only rgba8unorm and rgba8unorm-srgb',
            'destination.texture.format'
        );
    }
}

/** Validate a queued external-image upload before opening a frame command context. */
export function validateRHICopyExternalImageToTexture(
    device: RHIDevice,
    source: RHIImageCopyExternalImage,
    destination: RHIImageCopyExternalImageToTexture,
    copySize: RHIExtent3D
): void {
    assertRHIObjectOwnedBy(device, destination.texture, 'destination.texture');
    const dimensions: RHIExternalImageDimensionsStorage = { width: 0, height: 0 };
    validateExternalImageCopyParameters(source, destination, copySize, dimensions);
}

/** Validate a frame-scoped external-image upload immediately before native execution. */
export function validateRHICommandCopyExternalImageToTexture(
    context: RHICommandContext,
    source: RHIImageCopyExternalImage,
    destination: RHIImageCopyExternalImageToTexture,
    copySize: RHIExtent3D,
    dimensions?: RHIExternalImageDimensionsStorage
): void {
    assertRHICommandContextOpen(context);
    assertRHIObjectOwnedByContext(context, destination.texture, 'destination.texture');
    const result = dimensions ?? { width: 0, height: 0 };
    validateExternalImageCopyParameters(source, destination, copySize, result);
}

function validateGenerateMipmapsParameters(texture: RHITexture): void {
    requireTextureUsage(texture, RHITextureUsage.TEXTURE_BINDING, 'texture');
    requireTextureUsage(texture, RHITextureUsage.RENDER_ATTACHMENT, 'texture');
    if (texture.sampleCount !== 1) {
        fail(
            'invalid-descriptor',
            'mipmap generation requires a single-sampled texture',
            'texture'
        );
    }
    if (texture.mipLevelCount < 2) {
        fail(
            'invalid-descriptor',
            'mipmap generation requires at least two allocated mip levels',
            'texture.mipLevelCount'
        );
    }
    if (texture.dimension !== '2d') {
        fail(
            'unsupported-feature',
            'mipmap generation supports only 2D texture storage',
            'texture'
        );
    }
    if (texture.descriptor.viewDimension !== '2d' && texture.descriptor.viewDimension !== 'cube') {
        fail(
            'unsupported-feature',
            'mipmap generation supports only 2D and cube textures',
            'texture.viewDimension'
        );
    }
    if (rhiTextureFormatHasDepth(texture.format) || rhiTextureFormatHasStencil(texture.format)) {
        fail(
            'unsupported-format',
            'depth and stencil formats cannot generate portable mipmaps',
            'texture.format'
        );
    }
    if (texture.format.endsWith('uint') || texture.format.endsWith('sint')) {
        fail(
            'unsupported-format',
            'integer formats cannot generate portable mipmaps',
            'texture.format'
        );
    }
    const block = getRHITextureFormatBlockInfo(texture.format);
    if (block.blockWidth !== 1 || block.blockHeight !== 1) {
        fail(
            'unsupported-format',
            'compressed formats cannot generate portable mipmaps',
            'texture.format'
        );
    }
}

/** Validate a queued mipmap generation before opening a frame command context. */
export function validateRHIGenerateMipmaps(device: RHIDevice, texture: RHITexture): void {
    assertRHIObjectOwnedBy(device, texture, 'texture');
    validateGenerateMipmapsParameters(texture);
}

/** Validate one frame-scoped mipmap generation immediately before native execution. */
export function validateRHICommandGenerateMipmaps(
    context: RHICommandContext,
    texture: RHITexture
): void {
    assertRHICommandContextOpen(context);
    assertRHIObjectOwnedByContext(context, texture, 'texture');
    validateGenerateMipmapsParameters(texture);
}

function formatsCopyCompatible(source: RHITextureFormat, destination: RHITextureFormat): boolean {
    if (source === destination) return true;
    return source.replace(/-srgb$/, '') === destination.replace(/-srgb$/, '');
}

function regionsOverlap(
    source: NormalizedCopyOrigin,
    destination: NormalizedCopyOrigin,
    extent: NormalizedCopyExtent
): boolean {
    return (
        source.x < destination.x + extent.width &&
        destination.x < source.x + extent.width &&
        source.y < destination.y + extent.height &&
        destination.y < source.y + extent.height &&
        source.z < destination.z + extent.depthOrArrayLayers &&
        destination.z < source.z + extent.depthOrArrayLayers
    );
}

/** Validate a portable texture-to-texture copy before backend execution. */
export function validateRHICopyTextureToTexture(
    context: RHICommandContext,
    source: RHIImageCopyTexture,
    destination: RHIImageCopyTexture,
    copySize: RHIExtent3D
): void {
    assertRHICommandContextOpen(context);
    assertRHIObjectOwnedByContext(context, source.texture, 'source.texture');
    assertRHIObjectOwnedByContext(context, destination.texture, 'destination.texture');
    requireTextureUsage(source.texture, RHITextureUsage.COPY_SRC, 'source.texture');
    requireTextureUsage(destination.texture, RHITextureUsage.COPY_DST, 'destination.texture');
    const extent = normalizeCopyExtent(copySize);
    const validatedSource = validateTextureCopy(source, extent, 'source', false);
    const validatedDestination = validateTextureCopy(destination, extent, 'destination', false);

    if (validatedSource.aspect !== validatedDestination.aspect) {
        fail('incompatible-layout', 'source and destination aspects must match', 'copy');
    }
    if (!formatsCopyCompatible(source.texture.format, destination.texture.format)) {
        fail('incompatible-layout', 'texture formats are not copy-compatible', 'copy');
    }
    if (
        validatedSource.blockInfo.blockWidth !== validatedDestination.blockInfo.blockWidth ||
        validatedSource.blockInfo.blockHeight !== validatedDestination.blockInfo.blockHeight ||
        validatedSource.blockInfo.bytesPerBlock !== validatedDestination.blockInfo.bytesPerBlock
    ) {
        fail('incompatible-layout', 'texture texel-block layouts do not match', 'copy');
    }
    if (source.texture.sampleCount !== destination.texture.sampleCount) {
        fail('incompatible-layout', 'texture sample counts do not match', 'copy');
    }
    if (
        source.texture.id === destination.texture.id &&
        validatedSource.mipLevel === validatedDestination.mipLevel &&
        validatedSource.aspect === validatedDestination.aspect &&
        regionsOverlap(validatedSource.origin, validatedDestination.origin, extent)
    ) {
        fail('invalid-descriptor', 'source and destination texture regions overlap', 'copy');
    }
}
