import Class from '../core/Class';
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

/**
 * 数据纹理
 * @class
 * @extends Texture
 */
const DataTexture = Class.create(/** @lends DataTexture.prototype */ {
    Extends: Texture,
    /**
     * @default true
     * @type {boolean}
     */
    isDataTexture: true,
    /**
     * @default DataTexture
     * @type {string}
     */
    className: 'DataTexture',

    /**
     * @default TEXTURE_2D
     * @type {number}
     */
    target: TEXTURE_2D,
    /**
     * @default RGBA
     * @type {number}
     */
    internalFormat: RGBA,
    /**
     * @default RGBA
     * @type {number}
     */
    format: RGBA,
    /**
     * @default FLOAT
     * @type {number}
     */
    type: FLOAT,

    /**
     * @default NEAREST
     * @type {number}
     */
    magFilter: NEAREST,
    /**
     * @default NEAREST
     * @type {number}
     */
    minFilter: NEAREST,
    /**
     * @default CLAMP_TO_EDGE
     * @type {number}
     */
    wrapS: CLAMP_TO_EDGE,
    /**
     * @default CLAMP_TO_EDGE
     * @type {number}
     */
    wrapT: CLAMP_TO_EDGE,
    dataLength: 0,

    resetSize(dataLen) {
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
    },

    /**
     * 数据，改变数据的时候会自动更新Texture
     * @type {Float32Array}
     */
    data: {
        get() {
            return this.image;
        },
        set(_data) {
            if (this.image !== _data) {
                this.resetSize(_data.length);
                const len = this.width * this.height * 4;
                if (len === _data.length && _data instanceof this.DataClass) {
                    this.image = _data;
                } else {
                    if (!this.image || this.image.length !== len) {
                        this.image = new this.DataClass(len);
                    }
                    this.image.set(_data, 0);
                }
                this.needUpdate = true;
            }
        }
    },

    /**
     * @constructs
     * @param {object} [params] 初始化参数，所有params都会复制到实例上
     * @param {Array|Float32Array} [params.data] 数据
     */
    constructor(params) {
        DataTexture.superclass.constructor.call(this, params);
    }
});

export default DataTexture;
