import math from '../math/math';
import { EventDispatcher } from '../core/EventMixin';
import extensions from '../renderer/extensions';
import capabilities from '../renderer/capabilities';
import Cache from '../utils/Cache';
import {
    BROWSER_DEFAULT_WEBGL,
    FLOAT,
    LINEAR,
    NEAREST,
    NONE,
    REPEAT,
    RGB,
    RGBA,
    TEXTURE_2D,
    UNPACK_COLORSPACE_CONVERSION_WEBGL,
    UNPACK_FLIP_Y_WEBGL,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL,
    UNSIGNED_BYTE
} from '../constants/webgl';
import { RGB8, RGB32F, RGBA8, RGBA32F } from '../constants/webgl2';
import requireGLResource from '../renderer/requireGLResource';
import type { GLContext, Size, TextureSubImage, TypedArray } from '../renderer/types';
const cache = new Cache<WebGLTexture>();

export type TextureImageSource =
    | HTMLImageElement
    | HTMLCanvasElement
    | ImageBitmap
    | ImageData
    | OffscreenCanvas
    | HTMLVideoElement
    | TypedArray;

export type TextureUVChannel = 0 | 1;

export interface TextureMipmap {
    data: TypedArray;
    width: number;
    height: number;
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
    magFilter?: GLenum;
    minFilter?: GLenum;
    wrapS?: GLenum;
    wrapT?: GLenum;
    name?: string;
    premultiplyAlpha?: boolean;
    flipY?: boolean;
    colorSpaceConversion?: boolean;
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

export interface TextureWebGLState {
    readonly gl: GLContext;
    activeTexture(texture: GLenum): void;
    bindTexture(target: GLenum, texture: WebGLTexture | null): void;
    pixelStorei(pname: GLenum, param: number | boolean): void;
}

/** GPU texture contract used by renderer bindings and render targets. */
export interface TextureBinding {
    readonly target: GLenum;
    getGLTexture(state: TextureWebGLState): WebGLTexture;
}

function isTypedArray(value: unknown): value is TypedArray {
    return (
        value instanceof Int8Array ||
        value instanceof Uint8Array ||
        value instanceof Uint8ClampedArray ||
        value instanceof Int16Array ||
        value instanceof Uint16Array ||
        value instanceof Int32Array ||
        value instanceof Uint32Array ||
        value instanceof Float32Array ||
        value instanceof Float64Array
    );
}

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
        isTypedArray(value) ||
        isResizableImage(value) ||
        (typeof ImageData !== 'undefined' && value instanceof ImageData)
    );
}

function dimensions(value: unknown): Size | null {
    if (typeof value !== 'object' || value === null || !('width' in value) || !('height' in value))
        return null;
    return typeof value.width === 'number' && typeof value.height === 'number'
        ? { width: value.width, height: value.height }
        : null;
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
    /**
     * 缓存
     */
    static get cache(): Cache<WebGLTexture> {
        return cache;
    }
    /**
     * 重置
     * @param gl -
     */
    static reset(gl: GLContext): void {
        cache.each((glTexture, id) => {
            gl.deleteTexture(glTexture);
            cache.remove(id);
        });
    }
    readonly isTexture = true;
    readonly className: string = 'Texture';
    /**
     * 图片资源是否可以释放，可以的话，上传到GPU后将释放图片引用
     */
    isImageCanRelease = false;
    private _isImageReleased = false;
    private _image: Image | null = null;
    private _canvasImage: HTMLCanvasElement | null = null;
    private _canvasCtx: CanvasRenderingContext2D | null = null;
    private _originImage: ResizableTextureImage | null = null;
    private _needUpdateSubTexture = false;
    private readonly _subTextureList: TextureSubImage[] = [];
    private gl: GLContext | null = null;
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
        this._isImageReleased = false;
    }
    protected _releaseImage(): void {
        this._canvasImage = null;
        this._canvasCtx = null;
        this._originImage = null;
        this._image = null;
        this.mipmaps = null;
        this._isImageReleased = true;
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
    name = '';
    premultiplyAlpha = false;
    /**
     * 是否翻转Texture的Y轴
     */
    flipY = false;
    /**
     * 是否转换到图片默认的颜色空间
     */
    colorSpaceConversion = true;
    /**
     * 是否压缩
     */
    compressed = false;
    /**
     * 是否需要更新Texture
     */
    needUpdate = true;
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
        return Math.max(1, Math.floor(Math.log2(Math.max(this.width, this.height)) + 1));
    }
    /**
     * @param params - 初始化参数，所有params都会复制到实例上
     */
    constructor(params: TextureParameters<Image> = {}) {
        super();
        this.id = math.generateUUID(this.className);
        Object.assign(this, params);
    }
    /**
     * 获取支持的尺寸
     * @param img -
     * @returns `{ width, height }`
     */
    getSupportSize(img: ResizableTextureImage): Size {
        const imageSize = dimensions(img);
        if (!imageSize) throw new TypeError('Texture image has no dimensions');
        let { width, height } = imageSize;
        const maxTextureSize = capabilities.MAX_TEXTURE_SIZE;
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
    /**
     * GL上传贴图
     * @param state -
     * @param target -
     * @param image -
     * @param level -
     * @param width -
     * @param height -
     * @returns this
     */
    protected _glUploadTexture(
        state: TextureWebGLState,
        target: GLenum,
        image: TextureImageSource | null,
        level = 0,
        width = this.width,
        height = this.height
    ): this {
        const gl = state.gl;
        const type = this.type;
        const format = this.format;
        let internalFormat = this.internalFormat;
        if (this.compressed) {
            if (!isTypedArray(image)) {
                throw new TypeError('Compressed textures require typed-array image data');
            }
            gl.compressedTexImage2D(
                target,
                level,
                internalFormat,
                width,
                height,
                this.border,
                image
            );
        } else {
            internalFormat = this._fixInternalFormat(type, format, internalFormat);
            if (isTypedArray(image) || image === null) {
                gl.texImage2D(
                    target,
                    level,
                    internalFormat,
                    width,
                    height,
                    this.border,
                    format,
                    this.type,
                    image
                );
            } else {
                gl.texImage2D(target, level, internalFormat, format, this.type, image);
            }
        }
        return this;
    }
    /**
     * Resolves sized floating-point formats required by WebGL 2.
     * @param type - Texture data type.
     * @param format - Texture source format.
     * @param internalFormat - Requested internal format.
     * @returns internalFormat
     */
    protected _fixInternalFormat(type: GLenum, format: GLenum, internalFormat: GLenum): GLenum {
        if (type === FLOAT) {
            if (format === RGBA && (internalFormat === RGBA || internalFormat === RGBA8)) {
                internalFormat = RGBA32F;
            } else if (format === RGB && (internalFormat === RGB || internalFormat === RGB8)) {
                internalFormat = RGB32F;
            }
        }
        return internalFormat;
    }
    /**
     * 上传贴图，子类可重写
     * @param state -
     * @returns this
     */
    protected _uploadTexture(state: TextureWebGLState): this {
        if (this.useMipmap && this.mipmaps) {
            this.mipmaps.forEach((mipmap, index) => {
                this._glUploadTexture(
                    state,
                    this.target,
                    mipmap.data,
                    index,
                    mipmap.width,
                    mipmap.height
                );
            });
        } else {
            const image: unknown = this.image;
            if (image !== null && !isTextureImageSource(image)) {
                throw new TypeError('Texture image is not a supported WebGL texture source');
            }
            this._glUploadTexture(state, this.target, image, 0);
        }
        return this;
    }
    private updatePixelStore(state: TextureWebGLState): void {
        state.pixelStorei(UNPACK_PREMULTIPLY_ALPHA_WEBGL, this.premultiplyAlpha);
        state.pixelStorei(UNPACK_FLIP_Y_WEBGL, this.flipY);
        state.pixelStorei(
            UNPACK_COLORSPACE_CONVERSION_WEBGL,
            this.colorSpaceConversion ? BROWSER_DEFAULT_WEBGL : NONE
        );
    }
    /**
     * 更新 Texture
     * @param state -
     * @param glTexture -
     * @returns this
     */
    updateTexture(state: TextureWebGLState, glTexture: WebGLTexture): this {
        const gl = state.gl;
        if (this.needUpdate || this.autoUpdate) {
            if (this._originImage && this.image === this._canvasImage) {
                this.image = this._originImage as Image;
            }
            const useMipmap = this.useMipmap;
            const currentImage: unknown = this.image;
            if (isResizableImage(currentImage)) {
                const sizeResult = this.getSupportSize(currentImage);
                if (
                    sizeResult.width !== currentImage.width ||
                    sizeResult.height !== currentImage.height
                ) {
                    const resized = this.resizeImg(
                        currentImage,
                        sizeResult.width,
                        sizeResult.height
                    );
                    if (isTextureImageSource(resized)) this.image = resized as Image;
                }
                const size = dimensions(this.image);
                if (size) {
                    this.width = size.width;
                    this.height = size.height;
                }
            }
            state.activeTexture(gl.TEXTURE0 + capabilities.MAX_TEXTURE_INDEX);
            state.bindTexture(this.target, glTexture);
            this.updatePixelStore(state);
            if (this.compressed && useMipmap && (!this.mipmaps || this.mipmaps.length === 0)) {
                throw new Error(
                    'Compressed textures using a mipmap filter require explicit mipmap data'
                );
            }
            this._uploadTexture(state);
            if (useMipmap) {
                if (!this.compressed) {
                    gl.generateMipmap(this.target);
                }
            }
            gl.texParameterf(this.target, gl.TEXTURE_MAG_FILTER, this.magFilter);
            gl.texParameterf(this.target, gl.TEXTURE_MIN_FILTER, this.minFilter);
            gl.texParameterf(this.target, gl.TEXTURE_WRAP_S, this.wrapS);
            gl.texParameterf(this.target, gl.TEXTURE_WRAP_T, this.wrapT);
            const textureFilterAnisotropic = extensions.textureFilterAnisotropic;
            if (textureFilterAnisotropic && this.anisotropic > 1) {
                gl.texParameterf(
                    this.target,
                    textureFilterAnisotropic.TEXTURE_MAX_ANISOTROPY_EXT,
                    Math.min(this.anisotropic, capabilities.MAX_TEXTURE_MAX_ANISOTROPY)
                );
            }
            this.needUpdate = false;
        }
        if (this._needUpdateSubTexture) {
            this.uploadSubTextures(state, glTexture);
            this._needUpdateSubTexture = false;
        }
        return this;
    }
    /**
     * 跟新所有的局部贴图
     * @param state -
     * @param glTexture -
     */
    private uploadSubTextures(state: TextureWebGLState, glTexture: WebGLTexture): void {
        if (this._subTextureList.length > 0) {
            const gl = state.gl;
            state.activeTexture(gl.TEXTURE0 + capabilities.MAX_TEXTURE_INDEX);
            state.bindTexture(this.target, glTexture);
            this.updatePixelStore(state);
            this._subTextureList.forEach(subInfo => {
                const { xOffset, yOffset, image } = subInfo;
                if (isTypedArray(image)) {
                    gl.texSubImage2D(
                        this.target,
                        0,
                        xOffset,
                        yOffset,
                        this.width,
                        this.height,
                        this.format,
                        this.type,
                        image
                    );
                } else {
                    gl.texSubImage2D(
                        this.target,
                        0,
                        xOffset,
                        yOffset,
                        this.format,
                        this.type,
                        image
                    );
                }
            });
            this._subTextureList.length = 0;
        }
    }
    /**
     * 跟新局部贴图
     * @param xOffset -
     * @param yOffset -
     * @param image -
     */
    updateSubTexture(xOffset: number, yOffset: number, image: TextureSubImage['image']): void {
        this._subTextureList.push({ xOffset, yOffset, image });
        this._needUpdateSubTexture = true;
    }
    /**
     * 获取 GLTexture
     * @param state -
     */
    getGLTexture(state: TextureWebGLState): WebGLTexture {
        const gl = (this.gl = state.gl);
        const id = this.id;
        if (this.needDestroy) {
            this.destroy();
            this.needDestroy = false;
        }
        let glTexture = cache.get(id);
        if (glTexture) {
            this.updateTexture(state, glTexture);
        } else {
            glTexture = requireGLResource(gl.createTexture(), 'a texture');
            cache.add(id, glTexture);
            this.needUpdate = true;
            this.updateTexture(state, glTexture);
        }
        if (this.isImageCanRelease) {
            this._releaseImage();
        }
        return glTexture;
    }
    /**
     * 设置 GLTexture
     * @param texture -
     * @param needDestroy - 是否销毁之前的 GLTexture
     * @returns this
     */
    setGLTexture(texture: WebGLTexture, needDestroy = false): this {
        if (needDestroy) {
            this.destroy();
        }
        cache.add(this.id, texture);
        return this;
    }
    /**
     * 销毁当前Texture
     * @returns this
     */
    destroy(): this {
        const id = this.id;
        const glTexture = cache.get(id);
        if (glTexture && this.gl) {
            this.gl.deleteTexture(glTexture);
            cache.remove(id);
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
            mipmaps: this.mipmaps ? [...this.mipmaps] : null,
            isImageCanRelease: this.isImageCanRelease,
            target: this.target,
            internalFormat: this.internalFormat,
            format: this.format,
            type: this.type,
            width: this.width,
            height: this.height,
            magFilter: this.magFilter,
            minFilter: this.minFilter,
            wrapS: this.wrapS,
            wrapT: this.wrapT,
            name: this.name,
            premultiplyAlpha: this.premultiplyAlpha,
            flipY: this.flipY,
            colorSpaceConversion: this.colorSpaceConversion,
            compressed: this.compressed,
            autoUpdate: this.autoUpdate,
            uv: this.uv,
            anisotropic: this.anisotropic
        });
    }
}
export default Texture;
