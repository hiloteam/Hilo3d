import Texture, {
    isTextureImageSource,
    type TextureImageSource,
    type TextureParameters,
    type TextureWebGLState
} from './Texture';
import {
    CLAMP_TO_EDGE,
    LINEAR,
    RGB,
    TEXTURE_CUBE_MAP,
    TEXTURE_CUBE_MAP_POSITIVE_X
} from '../constants/webgl';
import { RGB8 } from '../constants/webgl2';

export type CubeTextureImage = (TextureImageSource | null)[];

export interface CubeTextureParameters extends TextureParameters<CubeTextureImage> {
    image?: CubeTextureImage | null;
}
/**
 * 立方体纹理
 * @example
 * ```ts
 * const loadQueue = new Hilo3d.LoadQueue([{
 *     src: './textures/cube/right.jpg'
 * }, {
 *     src: './textures/cube/left.jpg'
 * }, {
 *     src: './textures/cube/top.jpg'
 * }, {
 *     src: './textures/cube/bottom.jpg'
 * }, {
 *     src: './textures/cube/front.jpg'
 * }, {
 *     src: './textures/cube/back.jpg'
 * }]).on('complete', function () {
 *     const result = loadQueue.getAllContent();
 *     const skyboxMap = new Hilo3d.CubeTexture({
 *         image: result
 *     });
 *     const skybox = new Hilo3d.Mesh({
 *         geometry: new Hilo3d.BoxGeometry(),
 *         material: new Hilo3d.BasicMaterial({
 *             lightType: 'NONE',
 *             diffuse: skyboxMap
 *         })
 *     });
 *     stage.addChild(skybox);
 * });
 * ```
 */
class CubeTexture extends Texture<CubeTextureImage> {
    isCubeTexture = true;
    override readonly className: string = 'CubeTexture';
    override target = TEXTURE_CUBE_MAP;
    override internalFormat = RGB8;
    override format = RGB;
    override magFilter = LINEAR;
    override minFilter = LINEAR;
    override wrapS = CLAMP_TO_EDGE;
    override wrapT = CLAMP_TO_EDGE;
    /**
     * @param params - 初始化参数，所有params都会复制到实例上
     * - `params.image`: 图片列表，共6张
     */
    constructor(params: CubeTextureParameters = {}) {
        super();
        Object.assign(this, params);
        this.image ??= [];
    }
    protected override _uploadTexture(state: TextureWebGLState): this {
        const images = this.image;
        if (!Array.isArray(images) || images.length !== 6) {
            throw new TypeError('CubeTexture requires exactly six image faces');
        }
        const firstImage = images[0];
        if (firstImage instanceof HTMLImageElement) {
            this.width = firstImage.width;
            this.height = firstImage.height;
        }
        images.forEach((img, i) => {
            if (img !== null && !isTextureImageSource(img)) {
                throw new TypeError(
                    `CubeTexture face ${String(i)} is not a supported WebGL texture source`
                );
            }
            this._glUploadTexture(state, TEXTURE_CUBE_MAP_POSITIVE_X + i, img, 0);
        });
        return this;
    }

    private getImage(index: number): HTMLImageElement | undefined {
        const image = this.image?.[index];
        return image instanceof HTMLImageElement ? image : undefined;
    }

    private setImage(index: number, image: HTMLImageElement | undefined): void {
        const images = this.image ?? [];
        images[index] = image ?? null;
        this.image = images;
        this.needUpdate = true;
    }
    /**
     * 右侧的图片
     */
    get right(): HTMLImageElement | undefined {
        return this.getImage(0);
    }
    /**
     * 右侧的图片
     */
    set right(img: HTMLImageElement | undefined) {
        this.setImage(0, img);
    }
    /**
     * 左侧的图片
     */
    get left(): HTMLImageElement | undefined {
        return this.getImage(1);
    }
    /**
     * 左侧的图片
     */
    set left(img: HTMLImageElement | undefined) {
        this.setImage(1, img);
    }
    /**
     * 顶部的图片
     */
    get top(): HTMLImageElement | undefined {
        return this.getImage(2);
    }
    /**
     * 顶部的图片
     */
    set top(img: HTMLImageElement | undefined) {
        this.setImage(2, img);
    }
    /**
     * 底部的图片
     */
    get bottom(): HTMLImageElement | undefined {
        return this.getImage(3);
    }
    /**
     * 底部的图片
     */
    set bottom(img: HTMLImageElement | undefined) {
        this.setImage(3, img);
    }
    /**
     * 朝前的图片
     */
    get front(): HTMLImageElement | undefined {
        return this.getImage(4);
    }
    /**
     * 朝前的图片
     */
    set front(img: HTMLImageElement | undefined) {
        this.setImage(4, img);
    }
    /**
     * 朝后的图片
     */
    get back(): HTMLImageElement | undefined {
        return this.getImage(5);
    }
    /**
     * 朝后的图片
     */
    set back(img: HTMLImageElement | undefined) {
        this.setImage(5, img);
    }
}
export default CubeTexture;
