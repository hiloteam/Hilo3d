import math from '../math/math';
import Texture, { type TextureParameters } from './Texture';
import { getTypedArrayClass } from '../utils/util';
import { CLAMP_TO_EDGE, FLOAT, NEAREST, RGBA, TEXTURE_2D } from '../constants/webgl';
import { RGBA32F } from '../constants/webgl2';
import type { TypedArray, TypedArrayConstructor } from '../render/types';

export interface DataTextureParameters extends Omit<
    TextureParameters<TypedArray>,
    'image' | 'target'
> {
    image?: TypedArray | null;
    data?: ArrayLike<number> | TypedArray | null;
}
/**
 * 数据纹理
 */
class DataTexture extends Texture<TypedArray> {
    isDataTexture = true;
    override readonly className: string = 'DataTexture';
    dataLength = 0;
    private DataClass: TypedArrayConstructor = Float32Array;

    private resetSize(dataLen: number): void {
        if (dataLen === this.dataLength) {
            return;
        }
        this.dataLength = dataLen;
        const pixelCount = math.nextPowerOfTwo(dataLen / 4);
        const n = Math.max(Math.log2(pixelCount), 4);
        const w = Math.floor(n / 2);
        const h = n - w;
        this.width = 2 ** w;
        this.height = 2 ** h;
        this.DataClass = getTypedArrayClass(this.type);
    }
    /**
     * 数据，改变数据的时候会自动更新Texture
     */
    get data(): TypedArray | null {
        return this.image;
    }
    /**
     * 数据，改变数据的时候会自动更新Texture
     */
    set data(_data: ArrayLike<number> | TypedArray | null) {
        if (_data === null) {
            this.image = null;
            this.dataLength = 0;
            this.width = 0;
            this.height = 0;
            this.needUpdate = true;
            return;
        }
        if (this.image !== _data) {
            this.resetSize(_data.length);
            const len = this.width * this.height * 4;
            if (len === _data.length && _data instanceof this.DataClass) {
                this.image = _data;
            } else {
                if (this.image?.length !== len) {
                    this.image = new this.DataClass(len);
                }
                this.image.set(_data, 0);
            }
            this.needUpdate = true;
        }
    }
    /**
     * @param params - 初始化参数，所有params都会复制到实例上
     * - `params.data`: 数据
     */
    constructor(params: DataTextureParameters = {}) {
        const { data, ...textureParameters } = params;
        super({
            internalFormat: RGBA32F,
            format: RGBA,
            type: FLOAT,
            magFilter: NEAREST,
            minFilter: NEAREST,
            wrapS: CLAMP_TO_EDGE,
            wrapT: CLAMP_TO_EDGE,
            ...textureParameters,
            target: TEXTURE_2D
        });
        if (data !== undefined) this.data = data;
    }
}
export default DataTexture;
