import math from './math';
import Matrix4 from './Matrix4';
import type Quaternion from './Quaternion';
import { requireNumber, type MutableNumberArray } from './numberArray';
const tempMatrix = new Matrix4();
const DEG2RAD = math.DEG2RAD;
const RAD2DEG = math.RAD2DEG;

export type EulerOrder = 'XYZ' | 'YXZ' | 'ZXY' | 'ZYX' | 'YZX' | 'XZY';
class Euler {
    elements: Float32Array;
    protected _degX = 0;
    protected _degY = 0;
    protected _degZ = 0;
    /**
     * 类名
     */
    className = 'Euler';
    isEuler = true;
    /**
     * 旋转顺序，默认为 ZYX
     */
    order: EulerOrder = 'ZYX';
    /**
     * @param x - 角度 X, 弧度制
     * @param y - 角度 Y, 弧度制
     * @param z - 角度 Z, 弧度制
     */
    constructor(x = 0, y = 0, z = 0) {
        /**
         * 数据
         */
        this.elements = new Float32Array([x, y, z]);
        this.updateDegrees();
    }
    /**
     * 克隆
     */
    clone(): Euler {
        const euler = new Euler();
        euler.copy(this);
        return euler;
    }
    /**
     * 复制
     * @param euler -
     * @returns this
     */
    copy(euler: Euler): this {
        this.elements[0] = euler.x;
        this.elements[1] = euler.y;
        this.elements[2] = euler.z;
        this.order = euler.order;
        this.updateDegrees();
        return this;
    }
    /**
     * Set the components of a euler to the given values
     * @param x - x 轴旋转角度, 弧度制
     * @param y - y 轴旋转角度, 弧度制
     * @param z - z 轴旋转角度, 弧度制
     * @returns this
     */
    set(x: number, y: number, z: number): this {
        this.elements[0] = x;
        this.elements[1] = y;
        this.elements[2] = z;
        this.updateDegrees();
        return this;
    }
    /**
     * 设置角度
     * @param degX - x 轴旋转角度, 角度制
     * @param degY - y 轴旋转角度, 角度制
     * @param degZ - z 轴旋转角度, 角度制
     * @returns this
     */
    setDegree(degX: number, degY: number, degZ: number): this {
        this._degX = degX;
        this._degY = degY;
        this._degZ = degZ;
        this.updateRadians();
        return this;
    }
    /**
     * 从数组赋值
     * @param array - 数组
     * @param offset - 数组偏移值
     * @returns this
     */
    fromArray(array: ArrayLike<number>, offset = 0): this {
        this.elements[0] = requireNumber(array, offset);
        this.elements[1] = requireNumber(array, offset + 1);
        this.elements[2] = requireNumber(array, offset + 2);
        this.updateDegrees();
        return this;
    }
    /**
     * 转换到数组
     * @param array - 数组
     * @param offset - 数组偏移值
     */
    toArray(array: MutableNumberArray = [], offset = 0): MutableNumberArray {
        array[offset] = requireNumber(this.elements, 0);
        array[offset + 1] = requireNumber(this.elements, 1);
        array[offset + 2] = requireNumber(this.elements, 2);
        return array;
    }
    /**
     * Creates a euler from the given 4x4 rotation matrix.
     * @param mat - rotation matrix
     * @param order - 旋转顺序，默认为当前Euler实例的order
     * @returns this
     */
    fromMat4(mat: Matrix4, order: EulerOrder = this.order): this {
        // Based on https://github.com/mrdoob/three.js/blob/dev/src/math/Euler.js#L133
        const elements = mat.elements;
        const m11 = elements[0];
        const m21 = elements[1];
        const m31 = elements[2];
        const m12 = elements[4];
        const m22 = elements[5];
        const m32 = elements[6];
        const m13 = elements[8];
        const m23 = elements[9];
        const m33 = elements[10];
        this.order = order;
        if (order === 'XYZ') {
            this.elements[1] = Math.asin(math.clamp(m13, -1, 1));
            if (Math.abs(m13) < 0.99999) {
                this.elements[0] = Math.atan2(-m23, m33);
                this.elements[2] = Math.atan2(-m12, m11);
            } else {
                this.elements[0] = Math.atan2(m32, m22);
                this.elements[2] = 0;
            }
        } else if (order === 'YXZ') {
            this.elements[0] = Math.asin(-math.clamp(m23, -1, 1));
            if (Math.abs(m23) < 0.99999) {
                this.elements[1] = Math.atan2(m13, m33);
                this.elements[2] = Math.atan2(m21, m22);
            } else {
                this.elements[1] = Math.atan2(-m31, m11);
                this.elements[2] = 0;
            }
        } else if (order === 'ZXY') {
            this.elements[0] = Math.asin(math.clamp(m32, -1, 1));
            if (Math.abs(m32) < 0.99999) {
                this.elements[1] = Math.atan2(-m31, m33);
                this.elements[2] = Math.atan2(-m12, m22);
            } else {
                this.elements[1] = 0;
                this.elements[2] = Math.atan2(m21, m11);
            }
        } else if (order === 'ZYX') {
            this.elements[1] = Math.asin(-math.clamp(m31, -1, 1));
            if (Math.abs(m31) < 0.99999) {
                this.elements[0] = Math.atan2(m32, m33);
                this.elements[2] = Math.atan2(m21, m11);
            } else {
                this.elements[0] = 0;
                this.elements[2] = Math.atan2(-m12, m22);
            }
        } else if (order === 'YZX') {
            this.elements[2] = Math.asin(math.clamp(m21, -1, 1));
            if (Math.abs(m21) < 0.99999) {
                this.elements[0] = Math.atan2(-m23, m22);
                this.elements[1] = Math.atan2(-m31, m11);
            } else {
                this.elements[0] = 0;
                this.elements[1] = Math.atan2(m13, m33);
            }
        } else {
            this.elements[2] = Math.asin(-math.clamp(m12, -1, 1));
            if (Math.abs(m12) < 0.99999) {
                this.elements[0] = Math.atan2(m32, m22);
                this.elements[1] = Math.atan2(m13, m11);
            } else {
                this.elements[0] = Math.atan2(-m23, m33);
                this.elements[1] = 0;
            }
        }
        this.updateDegrees();
        return this;
    }
    /**
     * Creates a euler from the given quat.
     * @param quat -
     * @param order - 旋转顺序，默认为当前Euler实例的order
     * @returns this
     */
    fromQuat(quat: Quaternion, order: EulerOrder = this.order): this {
        tempMatrix.fromQuat(quat);
        return this.fromMat4(tempMatrix, order);
    }
    updateDegrees(): this {
        this._degX = requireNumber(this.elements, 0) * RAD2DEG;
        this._degY = requireNumber(this.elements, 1) * RAD2DEG;
        this._degZ = requireNumber(this.elements, 2) * RAD2DEG;
        return this;
    }
    updateRadians(): this {
        this.elements[0] = this._degX * DEG2RAD;
        this.elements[1] = this._degY * DEG2RAD;
        this.elements[2] = this._degZ * DEG2RAD;
        return this;
    }
    /**
     * 角度 X, 角度制
     */
    get degX(): number {
        return this._degX;
    }
    /**
     * 角度 X, 角度制
     */
    set degX(value: number) {
        this._degX = value;
        this.elements[0] = value * DEG2RAD;
    }
    /**
     * 角度 Y, 角度制
     */
    get degY(): number {
        return this._degY;
    }
    /**
     * 角度 Y, 角度制
     */
    set degY(value: number) {
        this._degY = value;
        this.elements[1] = value * DEG2RAD;
    }
    /**
     * 角度 Z, 角度制
     */
    get degZ(): number {
        return this._degZ;
    }
    /**
     * 角度 Z, 角度制
     */
    set degZ(value: number) {
        this._degZ = value;
        this.elements[2] = value * DEG2RAD;
    }
    /**
     * 角度 X, 弧度制
     */
    get x(): number {
        return requireNumber(this.elements, 0);
    }
    /**
     * 角度 X, 弧度制
     */
    set x(value: number) {
        this.elements[0] = value;
        this._degX = value * RAD2DEG;
    }
    /**
     * 角度 Y, 弧度制
     */
    get y(): number {
        return requireNumber(this.elements, 1);
    }
    /**
     * 角度 Y, 弧度制
     */
    set y(value: number) {
        this.elements[1] = value;
        this._degY = value * RAD2DEG;
    }
    /**
     * 角度 Z, 弧度制
     */
    get z(): number {
        return requireNumber(this.elements, 2);
    }
    /**
     * 角度 Z, 弧度制
     */
    set z(value: number) {
        this.elements[2] = value;
        this._degZ = value * RAD2DEG;
    }
}
export default Euler;
