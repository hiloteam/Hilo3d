import Class from '../core/Class';
import Vector4 from './Vector4';
import {
    padLeft
} from '../utils/util';

/**
 * 颜色类
 * @class
 * @extends Vector4
 */
const Color = Class.create(/** @lends Color.prototype */ {
    Extends: Vector4,
    /**
     * 类名
     * @type {String}
     * @default Color
     */
    className: 'Color',
    /**
     * @type {Boolean}
     * @default true
     */
    isColor: true,
    /**
     * r
     * @type {Number}
     */
    r: {
        get() {
            return this.x;
        },
        set(v) {
            this.x = v;
        }
    },
    /**
     * g
     * @type {Number}
     */
    g: {
        get() {
            return this.y;
        },
        set(v) {
            this.y = v;
        }
    },
    /**
     * b
     * @type {Number}
     */
    b: {
        get() {
            return this.z;
        },
        set(v) {
            this.z = v;
        }
    },
    /**
     * a
     * @type {Number}
     */
    a: {
        get() {
            return this.w;
        },
        set(v) {
            this.w = v;
        }
    },
    /**
     * @constructs
     * @param  {Number} r
     * @param  {Number} g
     * @param  {Number} b
     * @param  {Number} a
     */
    constructor(r = 1, g = 1, b = 1, a = 1) {
        Color.superclass.constructor.call(this, r, g, b, a);
    },
    /**
     * 转换到数组
     * @param  {Array}  [array=[]] 转换到的数组
     * @param  {Number} [offset=0] 数组偏移值
     * @return {Array}
     */
    toRGBArray(array = [], offset = 0) {
        const el = this.elements;
        array[offset] = el[0];
        array[offset + 1] = el[1];
        array[offset + 2] = el[2];
        return array;
    },
    /**
     * 从数组赋值
     * @param  {Array} array 数组
     * @param  {Number} [offset=0] 数组偏移值
     * @return {Color}
     */
    fromUintArray(array, offset = 0) {
        this.elements[0] = array[offset] / 255;
        this.elements[1] = array[offset + 1] / 255;
        this.elements[2] = array[offset + 2] / 255;
        this.elements[3] = array[offset + 3] / 255;
        return this;
    },
    /**
     * 从十六进制值赋值
     * @param  {String|Number} hex 颜色的十六进制值，可以以下形式："#ff9966", "ff9966", "#f96", "f96", 0xff9966
     * @return {Color}
     */
    fromHEX(hex) {
        if (typeof hex === 'number') {
            hex = padLeft(hex.toString(16), 6);
        } else {
            if (hex[0] === '#') {
                hex = hex.slice(1);
            }
            if (hex.length === 3) {
                hex = hex.replace(/(\w)/g, '$1$1');
            }
        }
        this.elements[0] = parseInt(hex.slice(0, 2), 16) / 255;
        this.elements[1] = parseInt(hex.slice(2, 4), 16) / 255;
        this.elements[2] = parseInt(hex.slice(4, 6), 16) / 255;
        return this;
    },
    /**
     * 转16进制
     * @return {String}
     */
    toHEX() {
        let hex = '';
        for (let i = 0; i < 3; i++) {
            hex += padLeft(Math.floor(this.elements[i] * 255).toString(16), 2);
        }
        return hex;
    }
});

export default Color;
