import math from '../math/math';
import { EventDispatcher } from '../core/EventDispatcher';
import {
    DEPTH_COMPONENT,
    DEPTH_COMPONENT16,
    DEPTH_STENCIL,
    FLOAT,
    LINEAR,
    NEAREST,
    NEAREST_MIPMAP_NEAREST,
    REPEAT,
    RGB,
    RGBA,
    TEXTURE_2D,
    TEXTURE_CUBE_MAP,
    UNSIGNED_BYTE,
    UNSIGNED_INT,
    UNSIGNED_SHORT
} from '../constants/webgl';
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
    RGBA8,
    RED_INTEGER,
    RG_INTEGER,
    RGB_INTEGER,
    RGBA_INTEGER,
    TEXTURE_2D_ARRAY,
    TEXTURE_3D,
    UNSIGNED_INT_24_8
} from '../constants/webgl2';
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
} from '../constants/webglExtensions';
import type {
    Size,
    TextureCubeFace,
    TexturePixelData,
    TextureSubImage,
    TypedArray
} from '../render/types';
import {
    isTexturePixelData,
    textureElementsPerPixel,
    texturePixelDataToTypedArray
} from './texturePixelData';

const MAX_SUB_TEXTURE_HISTORY = 64;

export type TextureImageSource =
    | HTMLImageElement
    | HTMLCanvasElement
    | ImageBitmap
    | ImageData
    | OffscreenCanvas
    | HTMLVideoElement
    | TexturePixelData;

export type TextureUVChannel = 0 | 1;

/**
 * One raw entry in an explicit mipmap chain, including level zero.
 * Cube chains contain six entries for every level.
 */
export interface TextureMipmap {
    data: TexturePixelData;
    width: number;
    height: number;
    /** Required for 3D and 2D-array levels. Array layers remain constant across levels. */
    depth?: number;
    /**
     * Required only for cube maps. Cube chains contain six consecutive entries per level in
     * canonical face order (+X, -X, +Y, -Y, +Z, -Z).
     */
    face?: TextureCubeFace;
}

/** Immutable content changes that a rendering backend can acknowledge independently. */
export interface TextureUpdateSnapshot {
    /** Latest texture content revision represented by this snapshot. */
    readonly revision: number;
    /** Whether the requesting backend must replay the exact full-content checkpoint first. */
    readonly requiresFullUpload: boolean;
    /** Incremental writes newer than the applicable full-upload baseline. */
    readonly subTextures: readonly TextureSubImage[];
}

/** @internal CPU content prepared for a backend-local texture allocation. */
export interface TextureUploadSource {
    readonly image: unknown;
    readonly mipmaps: readonly TextureMipmap[] | null;
}

interface VersionedTextureSubImage {
    readonly revision: number;
    readonly update: TextureSubImage;
}

interface TextureRecoveryBacking<Image> {
    readonly image: Image | null;
    readonly mipmaps: readonly TextureMipmap[] | null;
}

const recoveryBackings = new WeakMap<Texture<unknown>, TextureRecoveryBacking<unknown>>();
const destroyObservers = new WeakMap<Texture<unknown>, Set<TextureDestroyObserver>>();

/** Backend-private lifecycle observer that cannot be cancelled through public events. @internal */
export type TextureDestroyObserver = () => void;

/** Observe native-resource invalidation independently from the public event channel. @internal */
export function observeTextureDestroy(
    texture: Texture<unknown>,
    observer: TextureDestroyObserver
): void {
    let observers = destroyObservers.get(texture);
    if (!observers) {
        observers = new Set<TextureDestroyObserver>();
        destroyObservers.set(texture, observers);
    }
    observers.add(observer);
}

/** Stop observing native-resource invalidation. @internal */
export function unobserveTextureDestroy(
    texture: Texture<unknown>,
    observer: TextureDestroyObserver
): void {
    const observers = destroyObservers.get(texture);
    if (!observers) return;
    observers.delete(observer);
    if (observers.size === 0) destroyObservers.delete(texture);
}

/** @internal Read immutable CPU content retained after the public image has been released. */
export function getTextureRecoveryBacking(
    texture: Texture<unknown>
): Readonly<TextureRecoveryBacking<unknown>> | undefined {
    return recoveryBackings.get(texture);
}

function cloneRecoverySource(source: unknown): unknown {
    if (isTexturePixelData(source)) {
        if (source instanceof DataView) {
            const bytes = new Uint8Array(source.byteLength);
            bytes.set(new Uint8Array(source.buffer, source.byteOffset, source.byteLength));
            return new DataView(bytes.buffer);
        }
        return source.slice();
    }
    if (Array.isArray(source)) return source.map(cloneRecoverySource);
    if (typeof ImageData !== 'undefined' && source instanceof ImageData) {
        return new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
    }
    return source;
}

function cloneRecoveryMipmaps(
    mipmaps: readonly TextureMipmap[] | null
): readonly TextureMipmap[] | null {
    return (
        mipmaps?.map(mipmap => ({
            data: cloneRecoverySource(mipmap.data) as TexturePixelData,
            width: mipmap.width,
            height: mipmap.height,
            ...(mipmap.depth === undefined ? {} : { depth: mipmap.depth }),
            ...(mipmap.face === undefined ? {} : { face: mipmap.face })
        })) ?? null
    );
}

export interface TextureParameters<Image = TextureImageSource> {
    image?: Image | null;
    mipmaps?: TextureMipmap[] | null;
    isImageCanRelease?: boolean;
    target?: GLenum;
    internalFormat?: GLenum;
    format?: GLenum;
    type?: GLenum;
    width?: number;
    height?: number;
    /** 3D depth or 2D-array layer count. It must be 1 for 2D and cube textures. */
    depth?: number;
    magFilter?: GLenum;
    minFilter?: GLenum;
    wrapS?: GLenum;
    wrapT?: GLenum;
    /** R-axis addressing mode for 3D and 2D-array textures. */
    wrapR?: GLenum;
    name?: string;
    premultiplyAlpha?: boolean;
    flipY?: boolean;
    compressed?: boolean;
    needUpdate?: boolean;
    needDestroy?: boolean;
    autoUpdate?: boolean;
    uv?: TextureUVChannel;
    anisotropic?: number;
}

export type ResizableTextureImage =
    HTMLImageElement | HTMLCanvasElement | ImageBitmap | OffscreenCanvas | HTMLVideoElement;

type TextureConstructor<Image> = new (params?: TextureParameters<Image>) => Texture<Image>;

/** Backend-neutral engine texture accepted by material and render-target bindings. */
export type TextureBinding = Texture<unknown>;

function isResizableImage(value: unknown): value is ResizableTextureImage {
    return (
        (typeof HTMLImageElement !== 'undefined' && value instanceof HTMLImageElement) ||
        (typeof HTMLCanvasElement !== 'undefined' && value instanceof HTMLCanvasElement) ||
        (typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap) ||
        (typeof OffscreenCanvas !== 'undefined' && value instanceof OffscreenCanvas) ||
        (typeof HTMLVideoElement !== 'undefined' && value instanceof HTMLVideoElement)
    );
}

export function isTextureImageSource(value: unknown): value is TextureImageSource {
    return (
        isTexturePixelData(value) ||
        isResizableImage(value) ||
        (typeof ImageData !== 'undefined' && value instanceof ImageData)
    );
}

/** Resolve intrinsic dimensions shared by WebGL and WebGPU external-image paths. @internal */
export function textureSourceDimensions(value: unknown): Size | null {
    if (typeof value !== 'object' || value === null) return null;
    const source = value as Record<string, unknown>;
    const positiveDimension = (candidate: unknown): number | null =>
        typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0
            ? Math.floor(candidate)
            : null;
    const width =
        positiveDimension(source['videoWidth']) ??
        positiveDimension(source['naturalWidth']) ??
        positiveDimension(source['displayWidth']) ??
        positiveDimension(source['width']);
    const height =
        positiveDimension(source['videoHeight']) ??
        positiveDimension(source['naturalHeight']) ??
        positiveDimension(source['displayHeight']) ??
        positiveDimension(source['height']);
    return width === null || height === null ? null : { width, height };
}

const dimensions = textureSourceDimensions;

/** @internal */
export function isLayeredTextureTarget(target: GLenum): boolean {
    return target === TEXTURE_3D || target === TEXTURE_2D_ARRAY;
}

function isIntegerTextureSourceFormat(format: GLenum): boolean {
    return (
        format === RED_INTEGER ||
        format === RG_INTEGER ||
        format === RGB_INTEGER ||
        format === RGBA_INTEGER
    );
}

/** @internal */
export function validateTextureTarget(target: GLenum): void {
    if (
        target !== TEXTURE_2D &&
        target !== TEXTURE_CUBE_MAP &&
        target !== TEXTURE_3D &&
        target !== TEXTURE_2D_ARRAY
    ) {
        throw new TypeError(
            `Texture target ${String(target)} is unsupported; expected TEXTURE_2D, TEXTURE_CUBE_MAP, TEXTURE_3D, or TEXTURE_2D_ARRAY`
        );
    }
}

function requirePositiveInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${label} must be a positive safe integer`);
    }
}

function blockCompressedByteLength(
    width: number,
    height: number,
    depth: number,
    bytesPerBlock: 8 | 16
): number {
    return Math.ceil(width / 4) * Math.ceil(height / 4) * depth * bytesPerBlock;
}

/** @internal */
export function compressedTextureByteLength(
    internalFormat: GLenum,
    width: number,
    height: number,
    depth: number
): number {
    switch (internalFormat) {
        case COMPRESSED_RGB_S3TC_DXT1_EXT:
        case COMPRESSED_RGBA_S3TC_DXT1_EXT:
        case COMPRESSED_SRGB_S3TC_DXT1_EXT:
        case COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT:
        case COMPRESSED_RGB_ETC1_WEBGL:
        case COMPRESSED_R11_EAC:
        case COMPRESSED_SIGNED_R11_EAC:
        case COMPRESSED_RGB8_ETC2:
        case COMPRESSED_SRGB8_ETC2:
        case COMPRESSED_RGB8_PUNCHTHROUGH_ALPHA1_ETC2:
        case COMPRESSED_SRGB8_PUNCHTHROUGH_ALPHA1_ETC2:
        case COMPRESSED_RGB_ATC_WEBGL:
            return blockCompressedByteLength(width, height, depth, 8);
        case COMPRESSED_RGBA_S3TC_DXT3_EXT:
        case COMPRESSED_RGBA_S3TC_DXT5_EXT:
        case COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT:
        case COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT:
        case COMPRESSED_RG11_EAC:
        case COMPRESSED_SIGNED_RG11_EAC:
        case COMPRESSED_RGBA8_ETC2_EAC:
        case COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:
        case COMPRESSED_RGBA_ASTC_4X4_KHR:
        case COMPRESSED_SRGB8_ALPHA8_ASTC_4X4_KHR:
        case COMPRESSED_RGBA_ATC_EXPLICIT_ALPHA_WEBGL:
        case COMPRESSED_RGBA_ATC_INTERPOLATED_ALPHA_WEBGL:
            return blockCompressedByteLength(width, height, depth, 16);
        case COMPRESSED_RGB_PVRTC_4BPPV1_IMG:
        case COMPRESSED_RGBA_PVRTC_4BPPV1_IMG:
            return (Math.max(width, 8) * Math.max(height, 8) * depth * 4) / 8;
        case COMPRESSED_RGB_PVRTC_2BPPV1_IMG:
        case COMPRESSED_RGBA_PVRTC_2BPPV1_IMG:
            return (Math.max(width, 16) * Math.max(height, 8) * depth * 2) / 8;
        default:
            throw new TypeError(
                `Compressed layered texture format ${String(internalFormat)} has no known byte layout`
            );
    }
}

function compressedSubTextureBlockInfo(internalFormat: GLenum): {
    readonly width: 4;
    readonly height: 4;
    readonly bytes: 8 | 16;
} {
    const byteLength = compressedTextureByteLength(internalFormat, 4, 4, 1);
    if (byteLength !== 8 && byteLength !== 16) {
        throw new TypeError(
            `Compressed texture format ${String(internalFormat)} does not expose a WebGL2/WebGPU-compatible block layout for sub-texture updates`
        );
    }
    if (
        internalFormat === COMPRESSED_RGB_PVRTC_2BPPV1_IMG ||
        internalFormat === COMPRESSED_RGB_PVRTC_4BPPV1_IMG ||
        internalFormat === COMPRESSED_RGBA_PVRTC_2BPPV1_IMG ||
        internalFormat === COMPRESSED_RGBA_PVRTC_4BPPV1_IMG ||
        internalFormat === COMPRESSED_RGB_ATC_WEBGL ||
        internalFormat === COMPRESSED_RGBA_ATC_EXPLICIT_ALPHA_WEBGL ||
        internalFormat === COMPRESSED_RGBA_ATC_INTERPOLATED_ALPHA_WEBGL
    ) {
        throw new TypeError(
            `Compressed texture format ${String(internalFormat)} has no common WebGL2/WebGPU sub-update contract`
        );
    }
    return { width: 4, height: 4, bytes: byteLength };
}

function requireNonNegativeInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(`${label} must be a non-negative safe integer`);
    }
}

function createCheckpointCanvas(
    width: number,
    height: number
): HTMLCanvasElement | OffscreenCanvas {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
    if (typeof document !== 'undefined') {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        return canvas;
    }
    throw new TypeError(
        'External-image sub-texture checkpoints require OffscreenCanvas or a browser document'
    );
}

function checkpoint2DContext(
    canvas: HTMLCanvasElement | OffscreenCanvas
): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
    const context =
        typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas
            ? canvas.getContext('2d')
            : (canvas as HTMLCanvasElement).getContext('2d');
    if (!context) throw new Error('Unable to create a texture checkpoint 2D context');
    return context;
}
/**
 * 纹理
 * @example
 * ```ts
 * const loader = new Hilo3d.BasicLoader();
 * loader.load({
 *     src: './textures/base-color.jpg',
 *     crossOrigin: true
 * }).then(img => {
 *     return new Hilo3d.Texture({
 *         image: img
 *     });
 * });
 * ```
 */
class Texture<Image = TextureImageSource> extends EventDispatcher {
    readonly isTexture = true;
    readonly className: string = 'Texture';
    /**
     * 图片资源是否可以释放，可以的话，上传到GPU后将释放图片引用
     *
     * The engine keeps a private recovery backing after releasing the public `image`: raw pixels
     * and ImageData are copied, while DOM/video sources are retained because they cannot be cloned
     * synchronously and portably. Any later WebGL2 context allocation or WebGPU device can rebuild
     * the texture without making the released public image readable again.
     */
    isImageCanRelease = false;
    private _isImageReleased = false;
    private _updateRevision = 1;
    private _fullUpdateRevision = 1;
    private _needUpdate = true;
    private _image: Image | null = null;
    private _canvasImage: HTMLCanvasElement | null = null;
    private _canvasCtx: CanvasRenderingContext2D | null = null;
    private _originImage: ResizableTextureImage | null = null;
    private readonly _subTextureUpdates: VersionedTextureSubImage[] = [];
    readonly id: string;
    /**
     * 图片对象
     */
    get image(): Image | null {
        if (this._isImageReleased) {
            throw new Error(`Texture ${this.id} image has been released`);
        }
        return this._image;
    }
    /**
     * 图片对象
     */
    set image(_img: Image | null) {
        this._image = _img;
        recoveryBackings.delete(this);
        this._isImageReleased = false;
        this.synchronizeSourceDimensions(_img);
        this.markFullUpdate();
    }
    protected _releaseImage(): void {
        this._canvasImage = null;
        this._canvasCtx = null;
        this._originImage = null;
        this._image = null;
        this.mipmaps = null;
        this._isImageReleased = true;
    }
    /** Whether the CPU image source has already been discarded after a successful upload. */
    get isImageReleased(): boolean {
        return this._isImageReleased;
    }
    /** Monotonic content version used by each rendering backend for independent synchronisation. */
    get updateRevision(): number {
        return this._updateRevision;
    }
    /**
     * Discard the CPU image only when `isImageCanRelease` opted into that lifecycle.
     * @returns whether an image source was released
     */
    releaseImageIfAllowed(): boolean {
        if (!this.isImageCanRelease || this._isImageReleased) return false;
        if (!recoveryBackings.has(this)) {
            recoveryBackings.set(this, {
                image: cloneRecoverySource(this._image),
                mipmaps: cloneRecoveryMipmaps(this.mipmaps)
            });
        }
        this._releaseImage();
        return true;
    }

    /**
     * Snapshot content changes newer than a backend-local revision without consuming them.
     * Backends advance their own revision only after every upload in the snapshot succeeds.
     * If the requested revision predates the bounded incremental journal,
     * `requiresFullUpload` is true and the retained checkpoint is the authoritative baseline.
     */
    getTextureUpdatesSince(revision: number): TextureUpdateSnapshot {
        if (!Number.isSafeInteger(revision) || revision < 0 || revision > this._updateRevision) {
            throw new RangeError(
                `Texture update revision must be an integer in [0, ${String(this._updateRevision)}]`
            );
        }
        const requiresFullUpload = revision < this._fullUpdateRevision;
        const baseline = requiresFullUpload ? this._fullUpdateRevision : revision;
        const subTextures = this._subTextureUpdates
            .filter(update => update.revision > baseline)
            .map(update => update.update);
        return Object.freeze({
            revision: this._updateRevision,
            requiresFullUpload,
            subTextures: Object.freeze(subTextures)
        });
    }
    private markFullUpdate(): void {
        this._updateRevision++;
        this._fullUpdateRevision = this._updateRevision;
        this._subTextureUpdates.length = 0;
    }
    private getUploadImage(): Image | null {
        const backing = recoveryBackings.get(this) as TextureRecoveryBacking<Image> | undefined;
        if (backing) return backing.image;
        if (!this._isImageReleased) return this._image;
        throw new Error(
            `Texture ${this.id} cannot create a backend allocation after its CPU image was released`
        );
    }

    private getTextureUploadMipmaps(): readonly TextureMipmap[] | null {
        return recoveryBackings.get(this)?.mipmaps ?? this.mipmaps;
    }

    private prepareTextureUpload(): TextureUploadSource {
        const image: unknown = this.getUploadImage();
        const mipmaps = this.getTextureUploadMipmaps();
        this.validateBackendNeutralContract(mipmaps);
        if (this.useMipmap && mipmaps && mipmaps.length > 0) {
            this.validateExplicitMipmaps(mipmaps);
        }
        this.synchronizeSourceDimensions(image);
        return Object.freeze({ image, mipmaps });
    }

    private synchronizeSourceDimensions(image: unknown): void {
        if (this.target === TEXTURE_CUBE_MAP) {
            if (!Array.isArray(image) || image.length !== 6) return;
            let sourceSize: Size | null = null;
            for (const face of image) {
                if (face === null || isTexturePixelData(face)) continue;
                const size = dimensions(face);
                if (!size) continue;
                if (sourceSize && sourceSize.width !== size.width) {
                    throw new RangeError('All cube texture image sources must have the same width');
                }
                if (sourceSize && sourceSize.height !== size.height) {
                    throw new RangeError(
                        'All cube texture image sources must have the same height'
                    );
                }
                sourceSize = size;
            }
            if (sourceSize) {
                this.width = sourceSize.width;
                this.height = sourceSize.height;
            }
            return;
        }
        if (isLayeredTextureTarget(this.target) || image === null || isTexturePixelData(image)) {
            return;
        }
        const size = dimensions(image);
        if (size) {
            this.width = size.width;
            this.height = size.height;
        }
    }

    private validateBackendNeutralContract(mipmaps: readonly TextureMipmap[] | null): void {
        const depthDeclaration =
            this.format === DEPTH_COMPONENT ||
            this.format === DEPTH_STENCIL ||
            this.internalFormat === DEPTH_COMPONENT16 ||
            this.internalFormat === DEPTH_COMPONENT24 ||
            this.internalFormat === DEPTH_COMPONENT32F ||
            this.internalFormat === DEPTH24_STENCIL8 ||
            this.internalFormat === DEPTH32F_STENCIL8;
        if (depthDeclaration) {
            const valid =
                (this.internalFormat === DEPTH_COMPONENT16 &&
                    this.format === DEPTH_COMPONENT &&
                    this.type === UNSIGNED_SHORT) ||
                (this.internalFormat === DEPTH_COMPONENT24 &&
                    this.format === DEPTH_COMPONENT &&
                    this.type === UNSIGNED_INT) ||
                (this.internalFormat === DEPTH_COMPONENT32F &&
                    this.format === DEPTH_COMPONENT &&
                    this.type === FLOAT) ||
                (this.internalFormat === DEPTH24_STENCIL8 &&
                    this.format === DEPTH_STENCIL &&
                    this.type === UNSIGNED_INT_24_8) ||
                (this.internalFormat === DEPTH32F_STENCIL8 &&
                    this.format === DEPTH_STENCIL &&
                    this.type === FLOAT_32_UNSIGNED_INT_24_8_REV);
            if (!valid) {
                throw new TypeError(
                    'Depth textures require one exact WebGL2 declaration: DEPTH_COMPONENT16/DEPTH_COMPONENT/UNSIGNED_SHORT, DEPTH_COMPONENT24/DEPTH_COMPONENT/UNSIGNED_INT, DEPTH_COMPONENT32F/DEPTH_COMPONENT/FLOAT, DEPTH24_STENCIL8/DEPTH_STENCIL/UNSIGNED_INT_24_8, or DEPTH32F_STENCIL8/DEPTH_STENCIL/FLOAT_32_UNSIGNED_INT_24_8_REV'
                );
            }
            const image: unknown = this._isImageReleased
                ? recoveryBackings.get(this)?.image
                : this._image;
            if (image !== null && !isTexturePixelData(image)) {
                throw new TypeError('Depth textures accept only tightly packed raw data or null');
            }
            if (
                image !== null &&
                (this.internalFormat === DEPTH_COMPONENT24 ||
                    this.internalFormat === DEPTH24_STENCIL8)
            ) {
                throw new TypeError(
                    'Raw DEPTH_COMPONENT24 and DEPTH24_STENCIL8 uploads have no portable WebGPU byte representation; use DEPTH_COMPONENT32F or DEPTH32F_STENCIL8'
                );
            }
        }
        if ((this.format === DEPTH_COMPONENT || this.format === DEPTH_STENCIL) && this.useMipmap) {
            throw new TypeError(
                'Depth textures cannot use mipmap filters in the backend-neutral texture contract'
            );
        }
        if (this.target === TEXTURE_3D) {
            if (this.compressed) {
                throw new TypeError(
                    'Compressed 3D textures are unsupported by the backend-neutral texture contract'
                );
            }
            if (this.useMipmap && (!mipmaps || mipmaps.length === 0)) {
                throw new TypeError(
                    '3D textures using a mipmap filter require a complete explicit mipmap chain'
                );
            }
        }
        if (!isIntegerTextureSourceFormat(this.format)) return;
        if (
            this.magFilter !== NEAREST ||
            (this.minFilter !== NEAREST && this.minFilter !== NEAREST_MIPMAP_NEAREST)
        ) {
            throw new TypeError(
                'Integer textures require NEAREST magnification and NEAREST or NEAREST_MIPMAP_NEAREST minification'
            );
        }
        if (this.anisotropic !== 1) {
            throw new TypeError('Integer textures do not support anisotropic filtering');
        }
        if (this.useMipmap && (!mipmaps || mipmaps.length === 0)) {
            throw new TypeError(
                'Integer textures using a mipmap filter require a complete explicit mipmap chain'
            );
        }
    }

    private validateExplicitMipmaps(mipmaps: readonly TextureMipmap[]): void {
        const expectedCount = this.mipmapCount;
        const expectedEntries =
            this.target === TEXTURE_CUBE_MAP ? expectedCount * 6 : expectedCount;
        if (mipmaps.length !== expectedEntries) {
            throw new RangeError(
                this.target === TEXTURE_CUBE_MAP
                    ? `Explicit cube mipmap chain has ${String(mipmaps.length)} face entries; ${String(expectedEntries)} are required`
                    : `Explicit mipmap chain has ${String(mipmaps.length)} levels; ${String(expectedEntries)} are required`
            );
        }
        mipmaps.forEach((mipmap, entry) => {
            const level = this.target === TEXTURE_CUBE_MAP ? Math.floor(entry / 6) : entry;
            const expectedWidth = Math.max(1, Math.floor(this.width / 2 ** level));
            const expectedHeight = Math.max(1, Math.floor(this.height / 2 ** level));
            if (mipmap.width !== expectedWidth || mipmap.height !== expectedHeight) {
                throw new RangeError(
                    `Mipmap ${String(level)} is ${String(mipmap.width)}x${String(mipmap.height)}; expected ${String(expectedWidth)}x${String(expectedHeight)}`
                );
            }
            if (this.target === TEXTURE_CUBE_MAP) {
                const expectedFace = (entry % 6) as TextureCubeFace;
                if (mipmap.face !== expectedFace) {
                    throw new RangeError(
                        `Cube mipmap entry ${String(entry)} declares face ${String(mipmap.face)}; expected canonical face ${String(expectedFace)}`
                    );
                }
                if (mipmap.depth !== undefined && mipmap.depth !== 1) {
                    throw new RangeError(
                        `Cube mipmap level ${String(level)} face ${String(expectedFace)} depth must be 1`
                    );
                }
            } else if (isLayeredTextureTarget(this.target)) {
                const expectedDepth =
                    this.target === TEXTURE_3D
                        ? Math.max(1, Math.floor(this.depth / 2 ** level))
                        : this.depth;
                if (mipmap.depth !== expectedDepth) {
                    throw new RangeError(
                        `Mipmap ${String(level)} depth is ${String(mipmap.depth)}; expected ${String(expectedDepth)}`
                    );
                }
            } else if (mipmap.depth !== undefined && mipmap.depth !== 1) {
                throw new RangeError(
                    `Mipmap ${String(level)} depth must be 1 for a non-layered texture`
                );
            } else if (mipmap.face !== undefined) {
                throw new TypeError('Only cube mipmap entries may declare face');
            }
        });
    }

    /**
     * mipmaps
     */
    mipmaps: TextureMipmap[] | null = null;
    /**
     * Texture Target
     */
    target = TEXTURE_2D;
    /**
     * Texture Internal Format
     */
    internalFormat = RGBA8;
    /**
     * 图片 Format
     */
    format = RGBA;
    /**
     * 类型
     */
    type = UNSIGNED_BYTE;
    width = 0;
    height = 0;
    /** Depth for 3D textures, or the fixed layer count for 2D-array textures. */
    depth = 1;
    readonly border = 0;
    /**
     * magFilter
     */
    magFilter = LINEAR;
    /**
     * minFilter
     */
    minFilter = LINEAR;
    /**
     * wrapS
     */
    wrapS = REPEAT;
    /**
     * wrapT
     */
    wrapT = REPEAT;
    /** R-axis wrap mode used by 3D and 2D-array textures. */
    wrapR = REPEAT;
    name = '';
    premultiplyAlpha = false;
    /**
     * 是否翻转Texture的Y轴
     */
    flipY = false;
    /**
     * 是否压缩
     */
    compressed = false;
    /**
     * 是否需要更新Texture
     */
    get needUpdate(): boolean {
        return this._needUpdate;
    }
    set needUpdate(value: boolean) {
        this._needUpdate = value;
        if (value) {
            recoveryBackings.delete(this);
            this.markFullUpdate();
        }
    }
    /**
     * 是否需要销毁之前的Texture，Texture参数变更之后需要销毁
     */
    needDestroy = false;
    /**
     * 是否每次都更新Texture
     */
    autoUpdate = false;
    /**
     * uv
     */
    uv: TextureUVChannel = 0;
    /**
     * anisotropic
     */
    anisotropic = 1;
    /**
     * 获取原始图像宽度。
     */
    get origWidth(): number {
        return dimensions(this._originImage)?.width ?? dimensions(this.image)?.width ?? this.width;
    }
    /**
     * 获取原始图像高度。
     */
    get origHeight(): number {
        return (
            dimensions(this._originImage)?.height ?? dimensions(this.image)?.height ?? this.height
        );
    }
    /**
     * 是否使用 mipmap
     */
    get useMipmap(): boolean {
        return this.minFilter !== LINEAR && this.minFilter !== NEAREST;
    }
    /**
     * mipmapCount
     */
    get mipmapCount(): number {
        const largestDimension =
            this.target === TEXTURE_3D
                ? Math.max(this.width, this.height, this.depth)
                : Math.max(this.width, this.height);
        return Math.max(1, Math.floor(Math.log2(largestDimension) + 1));
    }
    /**
     * @param params - 初始化参数，所有params都会复制到实例上
     */
    constructor(params: TextureParameters<Image> = {}) {
        super();
        this.id = math.generateUUID(this.className);
        Object.assign(this, params);
        this.synchronizeSourceDimensions(this._image);
        validateTextureTarget(this.target);
        if (!isLayeredTextureTarget(this.target) && this.depth !== 1) {
            throw new RangeError('Texture depth must be 1 for TEXTURE_2D and TEXTURE_CUBE_MAP');
        }
        this.validateBackendNeutralContract(this.mipmaps);
        // Image setters record a full content revision, while the explicit flag remains an
        // independent compatibility hint whose final value must not depend on object key order.
        if (params.needUpdate !== undefined) this._needUpdate = params.needUpdate;
    }
    /**
     * 获取支持的尺寸
     * @param img -
     * @returns `{ width, height }`
     */
    getSupportSize(img: ResizableTextureImage, maxTextureSize = 0): Size {
        return this.getSupportSizeForLimit(img, maxTextureSize);
    }

    private getSupportSizeForLimit(img: ResizableTextureImage, maxTextureSize: number): Size {
        const imageSize = dimensions(img);
        if (!imageSize) throw new TypeError('Texture image has no dimensions');
        let { width, height } = imageSize;
        if (maxTextureSize) {
            if (width > maxTextureSize) {
                width = maxTextureSize;
            }
            if (height > maxTextureSize) {
                height = maxTextureSize;
            }
        }
        return {
            width,
            height
        };
    }
    /**
     * 更新图片大小
     * @param img -
     * @param width -
     * @param height -
     */
    resizeImg(
        img: ResizableTextureImage,
        width: number,
        height: number
    ): ResizableTextureImage | HTMLCanvasElement {
        if (img.width === width && img.height === height) {
            return img;
        }
        let canvas = this._canvasImage;
        if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            this._canvasImage = canvas;
            this._canvasCtx = canvas.getContext('2d');
        } else {
            canvas.width = width;
            canvas.height = height;
            this._canvasCtx = canvas.getContext('2d');
        }
        const context = this._canvasCtx;
        if (!context) throw new Error('Unable to create a 2D canvas context for texture resizing');
        context.drawImage(img, 0, 0, img.width, img.height, 0, 0, width, height);
        this._originImage = img;
        return canvas;
    }
    private subTextureMipExtent(mipLevel: number): {
        readonly width: number;
        readonly height: number;
        readonly depth: number;
    } {
        return {
            width: Math.max(1, Math.floor(this.width / 2 ** mipLevel)),
            height: Math.max(1, Math.floor(this.height / 2 ** mipLevel)),
            depth:
                this.target === TEXTURE_3D
                    ? Math.max(1, Math.floor(this.depth / 2 ** mipLevel))
                    : this.depth
        };
    }

    private validateSubTextureDescriptor(descriptor: TextureSubImage): TextureSubImage {
        const { mipLevel, x, y, width, height, image } = descriptor;
        requireNonNegativeInteger(mipLevel, 'Sub-texture mipLevel');
        requireNonNegativeInteger(x, 'Sub-texture x');
        requireNonNegativeInteger(y, 'Sub-texture y');
        requirePositiveInteger(width, 'Sub-texture width');
        requirePositiveInteger(height, 'Sub-texture height');
        const allocatedMipLevels = this.useMipmap ? this.mipmapCount : 1;
        if (mipLevel >= allocatedMipLevels) {
            throw new RangeError(
                `Sub-texture mipLevel ${String(mipLevel)} exceeds the ${String(allocatedMipLevels)} allocated level(s)`
            );
        }
        const availableMipmaps = recoveryBackings.get(this)?.mipmaps ?? this.mipmaps;
        if (mipLevel > 0 && (!availableMipmaps || availableMipmaps.length === 0)) {
            throw new TypeError(
                'Manual non-base mip updates require an explicit mipmap chain; automatically generated levels are derived from level 0'
            );
        }
        const extent = this.subTextureMipExtent(mipLevel);
        if (x + width > extent.width || y + height > extent.height) {
            throw new RangeError('Sub-texture update exceeds the destination mip extent');
        }

        let depth = 1;
        if (this.target === TEXTURE_CUBE_MAP) {
            if (
                descriptor.face === undefined ||
                !Number.isSafeInteger(descriptor.face) ||
                descriptor.face < 0 ||
                descriptor.face > 5
            ) {
                throw new RangeError('Cube sub-texture updates require face 0 through 5');
            }
            if (
                descriptor.layer !== undefined ||
                descriptor.z !== undefined ||
                descriptor.depth !== undefined
            ) {
                throw new TypeError('Cube sub-texture updates use face, not layer, z, or depth');
            }
        } else if (this.target === TEXTURE_2D_ARRAY) {
            if (descriptor.layer === undefined) {
                throw new TypeError('2D-array sub-texture updates require layer');
            }
            requireNonNegativeInteger(descriptor.layer, 'Sub-texture layer');
            if (descriptor.z !== undefined || descriptor.face !== undefined) {
                throw new TypeError('2D-array sub-texture updates use layer, not face or z');
            }
            if (descriptor.depth === undefined) {
                throw new TypeError('2D-array sub-texture updates require depth');
            }
            requirePositiveInteger(descriptor.depth, 'Sub-texture depth');
            depth = descriptor.depth;
            if (descriptor.layer + depth > extent.depth) {
                throw new RangeError('Sub-texture update exceeds the destination array layers');
            }
        } else if (this.target === TEXTURE_3D) {
            if (descriptor.z === undefined) {
                throw new TypeError('3D sub-texture updates require z');
            }
            requireNonNegativeInteger(descriptor.z, 'Sub-texture z');
            if (descriptor.layer !== undefined || descriptor.face !== undefined) {
                throw new TypeError('3D sub-texture updates use z, not face or layer');
            }
            if (descriptor.depth === undefined) {
                throw new TypeError('3D sub-texture updates require depth');
            }
            requirePositiveInteger(descriptor.depth, 'Sub-texture depth');
            depth = descriptor.depth;
            if (descriptor.z + depth > extent.depth) {
                throw new RangeError('Sub-texture update exceeds the destination 3D depth');
            }
        } else if (
            descriptor.face !== undefined ||
            descriptor.layer !== undefined ||
            descriptor.z !== undefined ||
            descriptor.depth !== undefined
        ) {
            throw new TypeError('2D sub-texture updates do not accept face, layer, z, or depth');
        }

        if (!isTexturePixelData(image)) {
            const size = dimensions(image);
            if (!size) throw new TypeError('Sub-texture image has no readable dimensions');
            if (size.width !== width || size.height !== height) {
                throw new RangeError(
                    `External sub-texture source is ${String(size.width)}x${String(size.height)}; descriptor requires ${String(width)}x${String(height)}`
                );
            }
            if (depth !== 1) {
                throw new TypeError('One external image can update exactly one layer or 3D slice');
            }
            if (this.compressed) {
                throw new TypeError('Compressed sub-texture updates require raw pixel data');
            }
        } else if (this.compressed) {
            const block = compressedSubTextureBlockInfo(this.internalFormat);
            if (x % block.width !== 0 || y % block.height !== 0) {
                throw new RangeError(
                    `Compressed sub-texture origins must align to ${String(block.width)}x${String(block.height)} texel blocks`
                );
            }
            if (
                (width % block.width !== 0 && x + width !== extent.width) ||
                (height % block.height !== 0 && y + height !== extent.height)
            ) {
                throw new RangeError(
                    'Compressed sub-texture dimensions must be block-aligned unless they reach the mip edge'
                );
            }
            const data = texturePixelDataToTypedArray(image, this.type);
            const required =
                Math.ceil(width / block.width) *
                Math.ceil(height / block.height) *
                depth *
                block.bytes;
            if (!(data instanceof Uint8Array) || data.byteLength !== required) {
                throw new RangeError(
                    `Compressed sub-texture data must contain exactly ${String(required)} bytes`
                );
            }
        } else {
            const data = texturePixelDataToTypedArray(image, this.type);
            const requiredElements =
                width * height * depth * textureElementsPerPixel(this.format, this.type);
            if (!Number.isSafeInteger(requiredElements)) {
                throw new RangeError('Texture pixel count exceeds the safe integer range');
            }
            if (data.length !== requiredElements) {
                throw new RangeError(
                    `Texture data contains ${String(data.length)} elements; ${String(requiredElements)} are required for ${String(width)}x${String(height)}x${String(depth)}`
                );
            }
        }

        if (
            isTexturePixelData(image) &&
            (this.internalFormat === DEPTH_COMPONENT24 || this.internalFormat === DEPTH24_STENCIL8)
        ) {
            throw new TypeError(
                'Raw DEPTH_COMPONENT24 and DEPTH24_STENCIL8 sub-updates have no portable WebGPU byte representation'
            );
        }

        const immutableImage =
            isLayeredTextureTarget(this.target) && !isTexturePixelData(image)
                ? this.externalUpdateToRaw(image, width, height)
                : (cloneRecoverySource(image) as TextureSubImage['image']);
        return Object.freeze({
            mipLevel,
            ...(descriptor.face === undefined ? {} : { face: descriptor.face }),
            ...(descriptor.layer === undefined ? {} : { layer: descriptor.layer }),
            ...(descriptor.z === undefined ? {} : { z: descriptor.z }),
            x,
            y,
            width,
            height,
            ...(descriptor.depth === undefined ? {} : { depth: descriptor.depth }),
            image: immutableImage
        });
    }

    private externalUpdateToRaw(
        image: Exclude<TextureSubImage['image'], TexturePixelData>,
        width: number,
        height: number
    ): Uint8Array {
        if (this.type !== UNSIGNED_BYTE || (this.format !== RGB && this.format !== RGBA)) {
            throw new TypeError(
                'External-image sub-updates require RGB or RGBA UNSIGNED_BYTE storage when a CPU checkpoint is needed'
            );
        }
        let rgba: Uint8ClampedArray;
        if (typeof ImageData !== 'undefined' && image instanceof ImageData) {
            rgba = image.data;
        } else {
            const canvas = createCheckpointCanvas(width, height);
            const context = checkpoint2DContext(canvas);
            if (!isResizableImage(image)) {
                throw new TypeError('Unsupported external image checkpoint source');
            }
            context.drawImage(image, 0, 0, width, height);
            rgba = context.getImageData(0, 0, width, height).data;
        }
        if (this.format === RGBA) return new Uint8Array(rgba);
        const rgb = new Uint8Array(width * height * 3);
        for (let pixel = 0; pixel < width * height; pixel++) {
            rgb[pixel * 3] = rgba[pixel * 4] ?? 0;
            rgb[pixel * 3 + 1] = rgba[pixel * 4 + 1] ?? 0;
            rgb[pixel * 3 + 2] = rgba[pixel * 4 + 2] ?? 0;
        }
        return rgb;
    }

    private rawUpdateToImageData(
        image: TexturePixelData,
        width: number,
        height: number
    ): ImageData {
        if (
            typeof ImageData === 'undefined' ||
            this.type !== UNSIGNED_BYTE ||
            (this.format !== RGB && this.format !== RGBA)
        ) {
            throw new TypeError(
                'Raw updates to an external-image checkpoint require browser ImageData and RGB or RGBA UNSIGNED_BYTE storage'
            );
        }
        const source = texturePixelDataToTypedArray(image, this.type);
        if (!(source instanceof Uint8Array) && !(source instanceof Uint8ClampedArray)) {
            throw new TypeError('External-image checkpoints require unsigned-byte raw updates');
        }
        if (this.format === RGBA) {
            return new ImageData(new Uint8ClampedArray(source), width, height);
        }
        const rgba = new Uint8ClampedArray(width * height * 4);
        for (let pixel = 0; pixel < width * height; pixel++) {
            rgba[pixel * 4] = source[pixel * 3] ?? 0;
            rgba[pixel * 4 + 1] = source[pixel * 3 + 1] ?? 0;
            rgba[pixel * 4 + 2] = source[pixel * 3 + 2] ?? 0;
            rgba[pixel * 4 + 3] = 255;
        }
        return new ImageData(rgba, width, height);
    }

    private applyCanvasCheckpointUpdate(
        source: unknown,
        update: TextureSubImage,
        fullWidth: number,
        fullHeight: number,
        checkpointY: number
    ): HTMLCanvasElement | OffscreenCanvas {
        const canvas = createCheckpointCanvas(fullWidth, fullHeight);
        const context = checkpoint2DContext(canvas);
        if (source !== null) {
            if (typeof ImageData !== 'undefined' && source instanceof ImageData) {
                context.putImageData(source, 0, 0);
            } else if (isTexturePixelData(source)) {
                context.putImageData(
                    this.rawUpdateToImageData(source, fullWidth, fullHeight),
                    0,
                    0
                );
            } else {
                if (!isResizableImage(source)) {
                    throw new TypeError('Unsupported external image checkpoint backing');
                }
                context.drawImage(source, 0, 0, fullWidth, fullHeight);
            }
        }
        if (isTexturePixelData(update.image)) {
            context.putImageData(
                this.rawUpdateToImageData(update.image, update.width, update.height),
                update.x,
                checkpointY
            );
        } else if (typeof ImageData !== 'undefined' && update.image instanceof ImageData) {
            context.putImageData(update.image, update.x, checkpointY);
        } else {
            if (!isResizableImage(update.image)) {
                throw new TypeError('Unsupported external sub-texture checkpoint source');
            }
            context.drawImage(update.image, update.x, checkpointY, update.width, update.height);
        }
        return canvas;
    }

    private applyRawCheckpointUpdate(
        source: unknown,
        update: TextureSubImage,
        fullWidth: number,
        fullHeight: number,
        fullDepth: number,
        checkpointY: number
    ): TexturePixelData {
        let patch = isTexturePixelData(update.image)
            ? texturePixelDataToTypedArray(update.image, this.type)
            : this.externalUpdateToRaw(update.image, update.width, update.height);
        if (this.compressed) {
            const block = compressedSubTextureBlockInfo(this.internalFormat);
            if (!(patch instanceof Uint8Array)) {
                throw new TypeError('Compressed texture checkpoints require Uint8Array storage');
            }
            const fullByteLength = compressedTextureByteLength(
                this.internalFormat,
                fullWidth,
                fullHeight,
                fullDepth
            );
            let destination: Uint8Array;
            if (source === null) {
                destination = new Uint8Array(fullByteLength);
            } else if (isTexturePixelData(source)) {
                const existing = texturePixelDataToTypedArray(source, this.type);
                if (!(existing instanceof Uint8Array) || existing.byteLength !== fullByteLength) {
                    throw new RangeError('Compressed texture checkpoint backing has invalid size');
                }
                destination = existing;
            } else {
                throw new TypeError('Compressed texture checkpoints require raw base data or null');
            }
            const fullBlocksPerRow = Math.ceil(fullWidth / block.width);
            const fullBlockRows = Math.ceil(fullHeight / block.height);
            const patchBlocksPerRow = Math.ceil(update.width / block.width);
            const patchBlockRows = Math.ceil(update.height / block.height);
            const originBlockX = update.x / block.width;
            const originBlockY = update.y / block.height;
            const firstSlice = update.layer ?? update.z ?? 0;
            const updateDepth = update.depth ?? 1;
            for (let slice = 0; slice < updateDepth; slice++) {
                for (let row = 0; row < patchBlockRows; row++) {
                    const sourceOffset =
                        (slice * patchBlockRows * patchBlocksPerRow + row * patchBlocksPerRow) *
                        block.bytes;
                    const targetOffset =
                        ((firstSlice + slice) * fullBlockRows * fullBlocksPerRow +
                            (originBlockY + row) * fullBlocksPerRow +
                            originBlockX) *
                        block.bytes;
                    destination.set(
                        patch.subarray(
                            sourceOffset,
                            sourceOffset + patchBlocksPerRow * block.bytes
                        ),
                        targetOffset
                    );
                }
            }
            return destination;
        }

        const elementsPerPixel = textureElementsPerPixel(this.format, this.type);
        const requiredElements = fullWidth * fullHeight * fullDepth * elementsPerPixel;
        let destination: TypedArray;
        if (source === null) {
            const Constructor = patch.constructor as new (length: number) => TypedArray;
            destination = new Constructor(requiredElements);
        } else if (isTexturePixelData(source)) {
            const existing = texturePixelDataToTypedArray(source, this.type);
            if (existing.length !== requiredElements) {
                throw new RangeError('Texture checkpoint backing has invalid dimensions');
            }
            if (existing.constructor !== patch.constructor) {
                throw new TypeError('Sub-texture data type does not match its checkpoint backing');
            }
            destination = existing;
        } else if (typeof ImageData !== 'undefined' && source instanceof ImageData) {
            if (fullDepth !== 1 || this.format !== RGBA || this.type !== UNSIGNED_BYTE) {
                throw new TypeError('ImageData checkpoints require 2D RGBA UNSIGNED_BYTE storage');
            }
            destination = source.data;
            if (destination.constructor !== patch.constructor) {
                patch = new Uint8ClampedArray(patch);
            }
        } else {
            throw new TypeError('External image checkpoint requires the canvas update path');
        }
        const rowElements = update.width * elementsPerPixel;
        const fullRowElements = fullWidth * elementsPerPixel;
        const fullSliceElements = fullRowElements * fullHeight;
        const patchSliceElements = rowElements * update.height;
        const firstSlice = update.layer ?? update.z ?? 0;
        const updateDepth = update.depth ?? 1;
        for (let slice = 0; slice < updateDepth; slice++) {
            for (let row = 0; row < update.height; row++) {
                const sourceOffset = slice * patchSliceElements + row * rowElements;
                const targetOffset =
                    (firstSlice + slice) * fullSliceElements +
                    (checkpointY + row) * fullRowElements +
                    update.x * elementsPerPixel;
                destination.set(
                    patch.subarray(sourceOffset, sourceOffset + rowElements),
                    targetOffset
                );
            }
        }
        return destination;
    }

    private checkpointSubTexture(update: TextureSubImage): void {
        const existing = recoveryBackings.get(this) as TextureRecoveryBacking<Image> | undefined;
        const backing: TextureRecoveryBacking<Image> = existing ?? {
            image: cloneRecoverySource(this._image) as Image | null,
            mipmaps: cloneRecoveryMipmaps(this.mipmaps)
        };
        const extent = this.subTextureMipExtent(update.mipLevel);
        const checkpointY =
            this.compressed || !this.flipY ? update.y : extent.height - update.y - update.height;
        const explicitMipmaps = this.useMipmap && (backing.mipmaps?.length ?? 0) > 0;
        if (explicitMipmaps) {
            const mipmaps = [...(backing.mipmaps ?? [])];
            const entry =
                this.target === TEXTURE_CUBE_MAP
                    ? update.mipLevel * 6 + (update.face ?? 0)
                    : update.mipLevel;
            const mipmap = mipmaps[entry];
            if (!mipmap) throw new RangeError('Texture checkpoint has no requested mip level');
            const data = this.applyRawCheckpointUpdate(
                mipmap.data,
                update,
                extent.width,
                extent.height,
                extent.depth,
                checkpointY
            );
            mipmaps[entry] = { ...mipmap, data };
            recoveryBackings.set(this, { ...backing, mipmaps });
            return;
        }

        if (this.target === TEXTURE_CUBE_MAP) {
            const images = Array.isArray(backing.image) ? [...backing.image] : [];
            const face = update.face ?? 0;
            const source = images[face] ?? null;
            images[face] =
                isTexturePixelData(source) || source === null
                    ? this.applyRawCheckpointUpdate(
                          source,
                          update,
                          extent.width,
                          extent.height,
                          1,
                          checkpointY
                      )
                    : this.applyCanvasCheckpointUpdate(
                          source,
                          update,
                          extent.width,
                          extent.height,
                          checkpointY
                      );
            recoveryBackings.set(this, { ...backing, image: images });
            return;
        }

        const source: unknown = backing.image;
        const canUseRawCheckpoint =
            source === null ||
            isTexturePixelData(source) ||
            (typeof ImageData !== 'undefined' && source instanceof ImageData) ||
            isLayeredTextureTarget(this.target);
        const image = canUseRawCheckpoint
            ? this.applyRawCheckpointUpdate(
                  source,
                  update,
                  extent.width,
                  extent.height,
                  extent.depth,
                  checkpointY
              )
            : this.applyCanvasCheckpointUpdate(
                  source,
                  update,
                  extent.width,
                  extent.height,
                  checkpointY
              );
        recoveryBackings.set(this, { ...backing, image });
    }

    /**
     * Update one texture region. The descriptor is immutable after the call returns.
     * Cube, 2D-array, and 3D destinations select their subresource with `face`, `layer`, or `z`.
     * Non-base levels require an explicit mipmap chain. Compressed writes use exact raw block data.
     * @param descriptor - Complete mip/subresource/destination/source description.
     * @example
     * ```ts
     * texture.updateSubTexture({
     *     mipLevel: 0,
     *     x: 16,
     *     y: 8,
     *     width: 4,
     *     height: 4,
     *     image: pixels
     * });
     * ```
     */
    updateSubTexture(descriptor: TextureSubImage): void {
        const update = this.validateSubTextureDescriptor(descriptor);
        this.checkpointSubTexture(update);
        this._updateRevision++;
        this._subTextureUpdates.push({ revision: this._updateRevision, update });
        if (this._subTextureUpdates.length > MAX_SUB_TEXTURE_HISTORY) {
            // The private full-content checkpoint already contains every update. Older backends
            // therefore restart from this exact revision instead of retaining an unbounded log.
            this._fullUpdateRevision = this._updateRevision;
            this._subTextureUpdates.length = 0;
        }
    }
    /**
     * 销毁当前Texture
     * @returns this
     */
    destroy(): this {
        const errors: unknown[] = [];
        const observers = destroyObservers.get(this);
        for (const observer of [...(observers ?? [])]) {
            try {
                observer();
            } catch (error: unknown) {
                errors.push(error);
            }
        }
        try {
            this.fire('destroy', this);
        } catch (error: unknown) {
            errors.push(error);
        }
        if (errors.length === 1) throw errors[0];
        if (errors.length > 1) {
            throw new AggregateError(errors, `Texture ${this.id} destruction failed`);
        }
        return this;
    }
    /**
     * clone
     */
    clone(): Texture<Image> {
        const Constructor = this.constructor as TextureConstructor<Image>;
        return new Constructor({
            image: this.image,
            mipmaps: this.mipmaps ? this.mipmaps.map(mipmap => ({ ...mipmap })) : null,
            isImageCanRelease: this.isImageCanRelease,
            target: this.target,
            internalFormat: this.internalFormat,
            format: this.format,
            type: this.type,
            width: this.width,
            height: this.height,
            depth: this.depth,
            magFilter: this.magFilter,
            minFilter: this.minFilter,
            wrapS: this.wrapS,
            wrapT: this.wrapT,
            wrapR: this.wrapR,
            name: this.name,
            premultiplyAlpha: this.premultiplyAlpha,
            flipY: this.flipY,
            compressed: this.compressed,
            autoUpdate: this.autoUpdate,
            uv: this.uv,
            anisotropic: this.anisotropic
        });
    }
}
export default Texture;

interface TextureBackendAccess {
    getTextureUploadMipmaps(): readonly TextureMipmap[] | null;
    prepareTextureUpload(): TextureUploadSource;
}

function backendAccess(texture: Texture<unknown>): TextureBackendAccess {
    return texture as unknown as TextureBackendAccess;
}

/** Read retained mipmap CPU data for a backend-local allocation. @internal */
export function getTextureUploadMipmaps(
    texture: Texture<unknown>
): readonly TextureMipmap[] | null {
    return backendAccess(texture).getTextureUploadMipmaps();
}

/** Prepare CPU data for a backend-local allocation. @internal */
export function prepareTextureUpload(texture: Texture<unknown>): TextureUploadSource {
    return backendAccess(texture).prepareTextureUpload();
}
