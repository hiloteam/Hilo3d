import math from '../math/math';
import Texture from './Texture';
import {
    getTypedArrayClass
} from '../utils/util';

import constants from '../constants';

const {
    TEXTURE_2D,
    RGBA,
    NEAREST,
    CLAMP_TO_EDGE,
    FLOAT
} = constants;

type TypedArrayConstructor =
    | Int8ArrayConstructor
    | Uint8ArrayConstructor
    | Int16ArrayConstructor
    | Uint16ArrayConstructor
    | Int32ArrayConstructor
    | Uint32ArrayConstructor
    | Float32ArrayConstructor
    | Float64ArrayConstructor;

type TypedArray =
    | Int8Array
    | Uint8Array
    | Int16Array
    | Uint16Array
    | Int32Array
    | Uint32Array
    | Float32Array
    | Float64Array;

/**
 * 数据纹理
 * @class
 * @extends Texture
 */
class DataTexture extends Texture {
    /**
     * @default true
     * @type {boolean}
     */
    isDataTexture: boolean = true;

    /**
     * @default DataTexture
     * @type {string}
     */
    className: string = 'DataTexture';

    /**
     * @default TEXTURE_2D
     * @type {number}
     */
    target: number = TEXTURE_2D;

    /**
     * @default RGBA
     * @type {number}
     */
    internalFormat: number = RGBA;

    /**
     * @default RGBA
     * @type {number}
     */
    format: number = RGBA;

    /**
     * @default FLOAT
     * @type {number}
     */
    type: number = FLOAT;

    /**
     * @default NEAREST
     * @type {number}
     */
    magFilter: number = NEAREST;

    /**
     * @default NEAREST
     * @type {number}
     */
    minFilter: number = NEAREST;

    /**
     * @default CLAMP_TO_EDGE
     * @type {number}
     */
    wrapS: number = CLAMP_TO_EDGE;

    /**
     * @default CLAMP_TO_EDGE
     * @type {number}
     */
    wrapT: number = CLAMP_TO_EDGE;

    dataLength: number = 0;

    DataClass: TypedArrayConstructor | undefined;

    resetSize(dataLen: number): void {
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
     * @type {Float32Array}
     */
    get data(): TypedArray {
        return this.image;
    }

    set data(_data: TypedArray) {
        if (this.image !== _data) {
            this.resetSize(_data.length);
            const len = this.width * this.height * 4;
            if (len === _data.length && this.DataClass && _data instanceof this.DataClass) {
                this.image = _data;
            } else {
                if (!this.image || this.image.length !== len) {
                    if (this.DataClass) {
                        this.image = new this.DataClass(len);
                    }
                }
                this.image.set(_data, 0);
            }
            this.needUpdate = true;
        }
    }
}

export default DataTexture;
