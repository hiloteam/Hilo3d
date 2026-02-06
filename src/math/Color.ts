import Vector4 from './Vector4';
import {
    padLeft
} from '../utils/util';

/**
 * 颜色类
 * @class
 * @extends Vector4
 */
class Color extends Vector4 {
    /**
     * 类名
     * @type {String}
     * @default Color
     */
    className: string = 'Color';

    /**
     * @type {Boolean}
     * @default true
     */
    isColor: boolean = true;

    /**
     * r
     * @type {Number}
     */
    get r(): number {
        return this.x;
    }

    set r(v: number) {
        this.x = v;
    }

    /**
     * g
     * @type {Number}
     */
    get g(): number {
        return this.y;
    }

    set g(v: number) {
        this.y = v;
    }

    /**
     * b
     * @type {Number}
     */
    get b(): number {
        return this.z;
    }

    set b(v: number) {
        this.z = v;
    }

    /**
     * a
     * @type {Number}
     */
    get a(): number {
        return this.w;
    }

    set a(v: number) {
        this.w = v;
    }

    /**
     * @constructs
     * @param  {Number} [r=1]
     * @param  {Number} [g=1]
     * @param  {Number} [b=1]
     * @param  {Number} [a=1]
     */
    constructor(r: number = 1, g: number = 1, b: number = 1, a: number = 1) {
        super(r, g, b, a);
    }

    /**
     * 转换到数组
     * @param  {Array}  [array=[]] 转换到的数组
     * @param  {Number} [offset=0] 数组偏移值
     * @return {Array}
     */
    toRGBArray(array: number[] = [], offset: number = 0): number[] {
        const el = this.elements;
        array[offset] = el[0];
        array[offset + 1] = el[1];
        array[offset + 2] = el[2];
        return array;
    }

    /**
     * 从数组赋值
     * @param  {Array} array 数组
     * @param  {Number} [offset=0] 数组偏移值
     * @return {Color}
     */
    fromUintArray(array: number[] | Uint8Array, offset: number = 0): Color {
        this.elements[0] = array[offset] / 255;
        this.elements[1] = array[offset + 1] / 255;
        this.elements[2] = array[offset + 2] / 255;
        this.elements[3] = array[offset + 3] / 255;
        return this;
    }

    /**
     * 从十六进制值赋值
     * @param  {String|Number} hex 颜色的十六进制值，可以以下形式："#ff9966", "ff9966", "#f96", "f96", 0xff9966
     * @return {Color}
     */
    fromHEX(hex: string | number): Color {
        let hexStr: string;
        if (typeof hex === 'number') {
            hexStr = padLeft(hex.toString(16), 6);
        } else {
            hexStr = hex;
            if (hexStr[0] === '#') {
                hexStr = hexStr.slice(1);
            }
            if (hexStr.length === 3) {
                hexStr = hexStr.replace(/(\w)/g, '$1$1');
            }
        }
        this.elements[0] = parseInt(hexStr.slice(0, 2), 16) / 255;
        this.elements[1] = parseInt(hexStr.slice(2, 4), 16) / 255;
        this.elements[2] = parseInt(hexStr.slice(4, 6), 16) / 255;
        return this;
    }

    /**
     * 转16进制
     * @return {String}
     */
    toHEX(): string {
        let hex = '';
        for (let i = 0; i < 3; i++) {
            hex += padLeft(Math.floor(this.elements[i] * 255).toString(16), 2);
        }
        return hex;
    }
}

export default Color;
