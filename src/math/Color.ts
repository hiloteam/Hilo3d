import Vector4 from './Vector4';
import { padLeft } from '../utils/util';
import { requireNumber } from './numberArray';
/**
 * 颜色类
 */
class Color extends Vector4 {
    /**
     * 类名
     */
    override className = 'Color';
    isColor = true;
    /**
     * r
     */
    get r(): number {
        return this.x;
    }

    set r(value: number) {
        this.x = value;
    }
    /**
     * g
     */
    get g(): number {
        return this.y;
    }

    set g(value: number) {
        this.y = value;
    }
    /**
     * b
     */
    get b(): number {
        return this.z;
    }

    set b(value: number) {
        this.z = value;
    }
    /**
     * a
     */
    get a(): number {
        return this.w;
    }

    set a(value: number) {
        this.w = value;
    }
    /**
     * @param r -
     * @param g -
     * @param b -
     * @param a -
     */
    constructor(r = 1, g = 1, b = 1, a = 1) {
        super(r, g, b, a);
    }
    /**
     * 转换到数组
     * @param array - 转换到的数组
     * @param offset - 数组偏移值
     */
    toRGBArray(array: number[] = [], offset = 0): number[] {
        const el = this.elements;
        array[offset] = el[0];
        array[offset + 1] = el[1];
        array[offset + 2] = el[2];
        return array;
    }
    /**
     * 从数组赋值
     * @param array - 数组
     * @param offset - 数组偏移值
     */
    fromUintArray(array: ArrayLike<number>, offset = 0): this {
        this.elements[0] = requireNumber(array, offset) / 255;
        this.elements[1] = requireNumber(array, offset + 1) / 255;
        this.elements[2] = requireNumber(array, offset + 2) / 255;
        this.elements[3] = requireNumber(array, offset + 3) / 255;
        return this;
    }
    /**
     * 从十六进制值赋值
     * @param hex - 颜色的十六进制值，可以以下形式："#ff9966", "ff9966", "#f96", "f96", 0xff9966
     */
    fromHEX(hex: string | number): this {
        if (typeof hex === 'number') {
            hex = padLeft(hex.toString(16), 6);
        } else {
            if (hex.startsWith('#')) {
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
    }
    /**
     * 转16进制
     */
    toHEX(): string {
        let hex = '';
        for (let i = 0; i < 3; i++) {
            hex += padLeft(Math.floor(requireNumber(this.elements, i) * 255).toString(16), 2);
        }
        return hex;
    }
}
export default Color;
