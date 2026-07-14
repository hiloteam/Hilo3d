import {
    BROWSER_DEFAULT_WEBGL,
    FLOAT,
    RGB,
    RGBA,
    TEXTURE_CUBE_MAP,
    TEXTURE_CUBE_MAP_POSITIVE_X,
    UNPACK_ALIGNMENT,
    UNPACK_COLORSPACE_CONVERSION_WEBGL,
    UNPACK_FLIP_Y_WEBGL,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL
} from '../../../constants/webgl';
import { RGB8, RGB32F, RGBA8, RGBA32F, TEXTURE_3D } from '../../../constants/webgl2';
import {
    compressedTextureByteLength,
    getTextureUploadMipmaps,
    isLayeredTextureTarget,
    isTextureImageSource,
    prepareTextureUpload,
    textureSourceDimensions,
    type default as Texture,
    type TextureImageSource,
    type TextureUploadSource,
    validateTextureTarget
} from '../../../texture/Texture';
import {
    flipTexturePixelRows,
    isTexturePixelData,
    textureElementsPerPixel,
    texturePixelDataToTypedArray
} from '../../../texture/texturePixelData';
import type { TexturePixelData, TextureSubImage, TypedArray } from '../../types';

/** Backend-private texture upload surface implemented by WebGLState. */
export interface WebGLTextureState {
    readonly gl: WebGL2RenderingContext;
    readonly capabilities: {
        readonly MAX_TEXTURE_SIZE: number;
        readonly MAX_3D_TEXTURE_SIZE: number;
        readonly MAX_ARRAY_TEXTURE_LAYERS: number;
        readonly MAX_TEXTURE_INDEX: number;
    };
    activeTexture(texture: GLenum): void;
    bindTexture(target: GLenum, texture: WebGLTexture | null): void;
    pixelStorei(pname: GLenum, param: number | boolean): void;
}

interface WebGLResizeState {
    readonly canvas: HTMLCanvasElement | OffscreenCanvas;
    readonly context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
}

function createResizeState(width: number, height: number): WebGLResizeState {
    if (typeof OffscreenCanvas !== 'undefined') {
        const canvas = new OffscreenCanvas(width, height);
        const context = canvas.getContext('2d');
        if (!context) {
            throw new Error('Unable to create a 2D canvas for WebGL texture resizing');
        }
        return { canvas, context };
    }
    if (typeof document === 'undefined') {
        throw new Error('WebGL texture resizing requires OffscreenCanvas or a document canvas');
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
        throw new Error('Unable to create a 2D canvas for WebGL texture resizing');
    }
    return { canvas, context };
}

/** Context-local scratch images used when a source exceeds this WebGL device's limit. */
export interface WebGLTextureUploadCache {
    readonly resizeStates: Map<number, WebGLResizeState>;
    downscaled: boolean;
    effectiveWidth: number;
    effectiveHeight: number;
}

interface WebGLPreparedTextureSource extends TextureUploadSource {
    readonly width: number;
    readonly height: number;
}

/** Create backend-local upload scratch state. @internal */
export function createWebGLTextureUploadCache(): WebGLTextureUploadCache {
    return {
        resizeStates: new Map<number, WebGLResizeState>(),
        downscaled: false,
        effectiveWidth: 0,
        effectiveHeight: 0
    };
}

function isResizableExternalImage(value: unknown): value is CanvasImageSource {
    return (
        (typeof HTMLImageElement !== 'undefined' && value instanceof HTMLImageElement) ||
        (typeof HTMLCanvasElement !== 'undefined' && value instanceof HTMLCanvasElement) ||
        (typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap) ||
        (typeof OffscreenCanvas !== 'undefined' && value instanceof OffscreenCanvas) ||
        (typeof HTMLVideoElement !== 'undefined' && value instanceof HTMLVideoElement)
    );
}

function requirePositiveInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${label} must be a positive safe integer`);
    }
}

function requireWithinTextureLimit(value: number, limit: number, label: string): void {
    if (Number.isFinite(limit) && limit > 0 && value > limit) {
        throw new RangeError(
            `${label} ${String(value)} exceeds the WebGL 2 limit ${String(limit)}`
        );
    }
}

class WebGLTextureUploader {
    constructor(
        private readonly state: WebGLTextureState,
        private readonly texture: Texture<unknown>,
        private readonly uploadCache: WebGLTextureUploadCache
    ) {}

    synchronize(
        glTexture: WebGLTexture,
        uploadedRevision: number,
        forceFullUpload: boolean
    ): number {
        const { state, texture } = this;
        const gl = state.gl;
        validateTextureTarget(texture.target);
        if (!isLayeredTextureTarget(texture.target) && texture.depth !== 1) {
            throw new RangeError('Texture depth must be 1 for TEXTURE_2D and TEXTURE_CUBE_MAP');
        }
        const pending = texture.getTextureUpdatesSince(uploadedRevision);
        const needsFullUpload =
            forceFullUpload ||
            uploadedRevision === 0 ||
            texture.autoUpdate ||
            pending.requiresFullUpload ||
            (this.uploadCache.downscaled && pending.subTextures.length > 0);
        if (needsFullUpload) {
            const source = this.prepareSource();
            this.validateLayeredTexture(source.image);
            state.activeTexture(gl.TEXTURE0 + state.capabilities.MAX_TEXTURE_INDEX);
            state.bindTexture(texture.target, glTexture);
            this.updatePixelStore();
            if (
                texture.compressed &&
                texture.useMipmap &&
                (!source.mipmaps || source.mipmaps.length === 0)
            ) {
                throw new Error(
                    'Compressed textures using a mipmap filter require explicit mipmap data'
                );
            }
            this.uploadTexture(source);
            texture.needUpdate = false;
        }

        const snapshot = texture.getTextureUpdatesSince(needsFullUpload ? 0 : uploadedRevision);
        const subTextures = needsFullUpload ? [] : snapshot.subTextures;
        if (subTextures.length > 0) {
            this.uploadSubTextures(glTexture, subTextures);
        }
        const explicitMipmaps = getTextureUploadMipmaps(texture);
        const hasExplicitMipmaps = texture.useMipmap && (explicitMipmaps?.length ?? 0) > 0;
        if (
            !hasExplicitMipmaps &&
            (needsFullUpload || subTextures.length > 0) &&
            texture.useMipmap &&
            !texture.compressed &&
            texture.target !== TEXTURE_3D
        ) {
            gl.generateMipmap(texture.target);
        }
        return snapshot.revision;
    }

    private prepareSource(): WebGLPreparedTextureSource {
        const { state, texture, uploadCache } = this;
        const source = prepareTextureUpload(texture);
        const maxTextureSize = state.capabilities.MAX_TEXTURE_SIZE;
        let width = texture.width;
        let height = texture.height;
        const complete = (
            prepared: Omit<WebGLPreparedTextureSource, 'width' | 'height'>
        ): WebGLPreparedTextureSource => {
            uploadCache.effectiveWidth = width;
            uploadCache.effectiveHeight = height;
            uploadCache.downscaled = width !== texture.width || height !== texture.height;
            return { ...prepared, width, height };
        };
        if (texture.useMipmap && (source.mipmaps?.length ?? 0) > 0) {
            requireWithinTextureLimit(width, maxTextureSize, 'Texture width');
            requireWithinTextureLimit(height, maxTextureSize, 'Texture height');
            return complete(source);
        }

        const resize = (image: CanvasImageSource, index: number): CanvasImageSource => {
            const size = textureSourceDimensions(image);
            if (!size) return image;
            width = Math.min(size.width, maxTextureSize || size.width);
            height = Math.min(size.height, maxTextureSize || size.height);
            if (width === size.width && height === size.height) return image;
            let resizeState = uploadCache.resizeStates.get(index);
            if (!resizeState) {
                resizeState = createResizeState(width, height);
                uploadCache.resizeStates.set(index, resizeState);
            }
            resizeState.canvas.width = width;
            resizeState.canvas.height = height;
            resizeState.context.drawImage(
                image,
                0,
                0,
                size.width,
                size.height,
                0,
                0,
                width,
                height
            );
            return resizeState.canvas;
        };

        if (texture.target === TEXTURE_CUBE_MAP && Array.isArray(source.image)) {
            const images = source.image.map((image: unknown, face) =>
                isResizableExternalImage(image) ? resize(image, face) : image
            );
            if (!images.some(isResizableExternalImage)) {
                requireWithinTextureLimit(width, maxTextureSize, 'Texture width');
                requireWithinTextureLimit(height, maxTextureSize, 'Texture height');
            }
            return complete({ ...source, image: images });
        }
        if (isResizableExternalImage(source.image)) {
            const image = resize(source.image, 0);
            return complete({ ...source, image });
        }
        requireWithinTextureLimit(width, maxTextureSize, 'Texture width');
        requireWithinTextureLimit(height, maxTextureSize, 'Texture height');
        return complete(source);
    }

    private validateLayeredTexture(image: unknown): void {
        const { state, texture } = this;
        if (!isLayeredTextureTarget(texture.target)) return;
        if (image !== null && !isTexturePixelData(image)) {
            throw new TypeError('3D and 2D-array textures require raw pixel data or null');
        }
        requirePositiveInteger(texture.width, 'Texture width');
        requirePositiveInteger(texture.height, 'Texture height');
        requirePositiveInteger(texture.depth, 'Texture depth');
        if (texture.target === TEXTURE_3D) {
            const limit = state.capabilities.MAX_3D_TEXTURE_SIZE;
            requireWithinTextureLimit(texture.width, limit, 'Texture width');
            requireWithinTextureLimit(texture.height, limit, 'Texture height');
            requireWithinTextureLimit(texture.depth, limit, 'Texture depth');
            return;
        }
        requireWithinTextureLimit(
            texture.width,
            state.capabilities.MAX_TEXTURE_SIZE,
            'Texture width'
        );
        requireWithinTextureLimit(
            texture.height,
            state.capabilities.MAX_TEXTURE_SIZE,
            'Texture height'
        );
        requireWithinTextureLimit(
            texture.depth,
            state.capabilities.MAX_ARRAY_TEXTURE_LAYERS,
            'Texture layer count'
        );
    }

    private uploadTexture(source: WebGLPreparedTextureSource): void {
        const { texture } = this;
        const mipmaps = source.mipmaps;
        if (texture.target === TEXTURE_CUBE_MAP) {
            if (texture.useMipmap && mipmaps && mipmaps.length > 0) {
                mipmaps.forEach((mipmap, entry) => {
                    const level = Math.floor(entry / 6);
                    const face = entry % 6;
                    this.uploadImage(
                        TEXTURE_CUBE_MAP_POSITIVE_X + face,
                        mipmap.data,
                        level,
                        mipmap.width,
                        mipmap.height,
                        1
                    );
                });
                return;
            }
            const images = source.image;
            if (!Array.isArray(images) || images.length !== 6) {
                throw new TypeError('CubeTexture requires exactly six image faces');
            }
            images.forEach((image: unknown, face) => {
                if (image !== null && !isTextureImageSource(image)) {
                    throw new TypeError(
                        `CubeTexture face ${String(face)} is not a supported WebGL texture source`
                    );
                }
                this.uploadImage(
                    TEXTURE_CUBE_MAP_POSITIVE_X + face,
                    image,
                    0,
                    source.width,
                    source.height,
                    1
                );
            });
            return;
        }
        if (texture.useMipmap && mipmaps && mipmaps.length > 0) {
            mipmaps.forEach((mipmap, level) => {
                this.uploadImage(
                    texture.target,
                    mipmap.data,
                    level,
                    mipmap.width,
                    mipmap.height,
                    mipmap.depth ?? 1
                );
            });
            return;
        }
        if (source.image !== null && !isTextureImageSource(source.image)) {
            throw new TypeError('Texture image is not a supported WebGL texture source');
        }
        this.uploadImage(
            texture.target,
            source.image,
            0,
            source.width,
            source.height,
            texture.depth
        );
    }

    private uploadImage(
        target: GLenum,
        image: TextureImageSource | null,
        level = 0,
        width = this.texture.width,
        height = this.texture.height,
        depth = this.texture.depth
    ): void {
        const { state, texture } = this;
        const gl = state.gl;
        const type = texture.type;
        const format = texture.format;
        let internalFormat = texture.internalFormat;
        const layered = isLayeredTextureTarget(texture.target);
        if (texture.target === TEXTURE_3D && texture.compressed) {
            throw new TypeError(
                'Compressed 3D textures are unsupported by the backend-neutral texture contract'
            );
        }
        const uploadDepth = layered ? depth : 1;
        const hasPixelData = image !== null && isTexturePixelData(image);
        if (layered && image !== null && !hasPixelData) {
            throw new TypeError('3D and 2D-array textures require raw pixel data or null');
        }
        const uploadImage = hasPixelData
            ? this.preparePixelData(image, width, height, uploadDepth)
            : image;
        state.pixelStorei(UNPACK_FLIP_Y_WEBGL, hasPixelData ? false : texture.flipY);
        if (texture.compressed) {
            if (!hasPixelData) throw new TypeError('Compressed textures require raw pixel data');
            if (layered) {
                const requiredBytes = compressedTextureByteLength(
                    internalFormat,
                    width,
                    height,
                    uploadDepth
                );
                if ((uploadImage as ArrayBufferView).byteLength !== requiredBytes) {
                    throw new RangeError(
                        `Compressed texture data contains ${String((uploadImage as ArrayBufferView).byteLength)} bytes; ${String(requiredBytes)} are required for ${String(width)}x${String(height)}x${String(uploadDepth)}`
                    );
                }
                gl.compressedTexImage3D(
                    target,
                    level,
                    internalFormat,
                    width,
                    height,
                    uploadDepth,
                    texture.border,
                    uploadImage as ArrayBufferView
                );
                return;
            }
            gl.compressedTexImage2D(
                target,
                level,
                internalFormat,
                width,
                height,
                texture.border,
                uploadImage as ArrayBufferView
            );
            return;
        }
        internalFormat = this.fixInternalFormat(type, format, internalFormat);
        if (layered) {
            gl.texImage3D(
                target,
                level,
                internalFormat,
                width,
                height,
                uploadDepth,
                texture.border,
                format,
                type,
                uploadImage as ArrayBufferView | null
            );
            return;
        }
        if (hasPixelData || image === null) {
            gl.texImage2D(
                target,
                level,
                internalFormat,
                width,
                height,
                texture.border,
                format,
                type,
                uploadImage as ArrayBufferView | null
            );
            return;
        }
        gl.texImage2D(target, level, internalFormat, format, type, uploadImage as TexImageSource);
    }

    private preparePixelData(
        source: TexturePixelData,
        width: number,
        height: number,
        depth = 1
    ): TypedArray {
        const { texture } = this;
        const data = texturePixelDataToTypedArray(source, texture.type);
        if (texture.compressed) return data;
        const elementsPerRow = width * textureElementsPerPixel(texture.format, texture.type);
        const requiredElements = elementsPerRow * height * depth;
        if (!Number.isSafeInteger(requiredElements)) {
            throw new RangeError('Texture pixel count exceeds the safe integer range');
        }
        if (data.length !== requiredElements) {
            throw new RangeError(
                `Texture data contains ${String(data.length)} elements; ${String(requiredElements)} are required for ${String(width)}x${String(height)}x${String(depth)}`
            );
        }
        if (!texture.flipY) return data;
        if (depth === 1) return flipTexturePixelRows(data, elementsPerRow, height);

        const output = data.slice() as TypedArray;
        const sourceBytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        const outputBytes = new Uint8Array(output.buffer, output.byteOffset, output.byteLength);
        const rowByteLength = elementsPerRow * data.BYTES_PER_ELEMENT;
        const sliceByteLength = rowByteLength * height;
        for (let slice = 0; slice < depth; slice++) {
            const sliceOffset = slice * sliceByteLength;
            for (let targetRow = 0; targetRow < height; targetRow++) {
                const sourceOffset = sliceOffset + (height - targetRow - 1) * rowByteLength;
                outputBytes.set(
                    sourceBytes.subarray(sourceOffset, sourceOffset + rowByteLength),
                    sliceOffset + targetRow * rowByteLength
                );
            }
        }
        return output;
    }

    private fixInternalFormat(type: GLenum, format: GLenum, internalFormat: GLenum): GLenum {
        if (type === FLOAT) {
            if (format === RGBA && (internalFormat === RGBA || internalFormat === RGBA8)) {
                return RGBA32F;
            }
            if (format === RGB && (internalFormat === RGB || internalFormat === RGB8)) {
                return RGB32F;
            }
        }
        return internalFormat;
    }

    private updatePixelStore(): void {
        const { state, texture } = this;
        state.pixelStorei(UNPACK_PREMULTIPLY_ALPHA_WEBGL, texture.premultiplyAlpha);
        state.pixelStorei(UNPACK_COLORSPACE_CONVERSION_WEBGL, BROWSER_DEFAULT_WEBGL);
        state.pixelStorei(UNPACK_ALIGNMENT, 1);
    }

    private uploadSubTextures(glTexture: WebGLTexture, updates: readonly TextureSubImage[]): void {
        if (updates.length === 0) return;
        const { state, texture } = this;
        const gl = state.gl;
        state.activeTexture(gl.TEXTURE0 + state.capabilities.MAX_TEXTURE_INDEX);
        state.bindTexture(texture.target, glTexture);
        this.updatePixelStore();
        for (const update of updates) {
            const { mipLevel, x, y, width, height, image } = update;
            const depth = update.depth ?? 1;
            const z = update.layer ?? update.z ?? 0;
            const uploadTarget =
                texture.target === TEXTURE_CUBE_MAP
                    ? TEXTURE_CUBE_MAP_POSITIVE_X + (update.face ?? 0)
                    : texture.target;
            const pixelData = isTexturePixelData(image)
                ? this.preparePixelData(image, width, height, depth)
                : null;
            state.pixelStorei(UNPACK_FLIP_Y_WEBGL, pixelData === null ? texture.flipY : false);
            if (texture.compressed) {
                if (pixelData === null) {
                    throw new TypeError('Compressed sub-texture updates require raw pixel data');
                }
                if (isLayeredTextureTarget(texture.target)) {
                    gl.compressedTexSubImage3D(
                        uploadTarget,
                        mipLevel,
                        x,
                        y,
                        z,
                        width,
                        height,
                        depth,
                        texture.internalFormat,
                        pixelData
                    );
                } else {
                    gl.compressedTexSubImage2D(
                        uploadTarget,
                        mipLevel,
                        x,
                        y,
                        width,
                        height,
                        texture.internalFormat,
                        pixelData
                    );
                }
                continue;
            }
            if (isLayeredTextureTarget(texture.target)) {
                if (pixelData !== null) {
                    gl.texSubImage3D(
                        uploadTarget,
                        mipLevel,
                        x,
                        y,
                        z,
                        width,
                        height,
                        depth,
                        texture.format,
                        texture.type,
                        pixelData
                    );
                } else {
                    gl.texSubImage3D(
                        uploadTarget,
                        mipLevel,
                        x,
                        y,
                        z,
                        width,
                        height,
                        depth,
                        texture.format,
                        texture.type,
                        image as TexImageSource
                    );
                }
            } else if (pixelData !== null) {
                gl.texSubImage2D(
                    uploadTarget,
                    mipLevel,
                    x,
                    y,
                    width,
                    height,
                    texture.format,
                    texture.type,
                    pixelData
                );
            } else {
                gl.texSubImage2D(
                    uploadTarget,
                    mipLevel,
                    x,
                    y,
                    texture.format,
                    texture.type,
                    image as TexImageSource
                );
            }
        }
    }
}

/** Synchronise one manager-owned WebGL texture allocation. @internal */
export function synchronizeWebGLTexture(
    state: WebGLTextureState,
    texture: Texture<unknown>,
    glTexture: WebGLTexture,
    uploadedRevision: number,
    uploadCache: WebGLTextureUploadCache,
    forceFullUpload = false
): number {
    return new WebGLTextureUploader(state, texture, uploadCache).synchronize(
        glTexture,
        uploadedRevision,
        forceFullUpload
    );
}

const directUploadRevisions = new WeakMap<Texture<unknown>, WeakMap<WebGLTexture, number>>();
const directUploadCaches = new WeakMap<
    Texture<unknown>,
    WeakMap<WebGLTexture, WebGLTextureUploadCache>
>();

/** Direct conformance-test hook; production code uses WebGLTextureManager. @internal */
export function updateWebGLTexture(
    state: WebGLTextureState,
    texture: Texture<unknown>,
    glTexture: WebGLTexture
): Texture<unknown> {
    let revisions = directUploadRevisions.get(texture);
    if (!revisions) {
        revisions = new WeakMap<WebGLTexture, number>();
        directUploadRevisions.set(texture, revisions);
    }
    let caches = directUploadCaches.get(texture);
    if (!caches) {
        caches = new WeakMap<WebGLTexture, WebGLTextureUploadCache>();
        directUploadCaches.set(texture, caches);
    }
    let uploadCache = caches.get(glTexture);
    if (!uploadCache) {
        uploadCache = createWebGLTextureUploadCache();
        caches.set(glTexture, uploadCache);
    }
    const revision = synchronizeWebGLTexture(
        state,
        texture,
        glTexture,
        revisions.get(glTexture) ?? 0,
        uploadCache
    );
    revisions.set(glTexture, revision);
    return texture;
}
