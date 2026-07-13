import { mat3 } from 'gl-matrix';
import type Matrix4 from './Matrix4';
import type Quaternion from './Quaternion';
import type Vector2 from './Vector2';
import { requireNumber, type MutableNumberArray } from './numberArray';
import { resolveOperands } from './operands';
/**
 * 3x3 矩阵
 */
class Matrix3 {
    elements: mat3;
    /**
     * 类名
     */
    className = 'Matrix3';
    isMatrix3 = true;
    /**
     * Creates a new identity mat3
     */
    constructor() {
        /**
         * 数据
         */
        this.elements = mat3.create();
    }
    /**
     * Copy the values from one mat3 to this
     * @param m - the source matrix
     * @returns this
     */
    copy(m: Matrix3): this {
        mat3.copy(this.elements, m.elements);
        return this;
    }
    /**
     * Creates a new mat3 initialized with values from this matrix
     * @returns a new Matrix3
     */
    clone(): Matrix3 {
        const m = new Matrix3();
        mat3.copy(m.elements, this.elements);
        return m;
    }
    /**
     * 转换到数组
     * @param array - 数组
     * @param offset - 数组偏移值
     */
    toArray(array: MutableNumberArray = [], offset = 0): MutableNumberArray {
        const elements = this.elements;
        for (let i = 0; i < 9; i++) {
            array[offset + i] = requireNumber(elements, i);
        }
        return array;
    }
    /**
     * 从数组赋值
     * @param array - 数组
     * @param offset - 数组偏移值
     * @returns this
     */
    fromArray(array: ArrayLike<number>, offset = 0): this {
        const elements = this.elements;
        for (let i = 0; i < 9; i++) {
            elements[i] = requireNumber(array, offset + i);
        }
        return this;
    }
    /**
     * Set the components of a mat3 to the given values
     * @param m00 -
     * @param m01 -
     * @param m02 -
     * @param m10 -
     * @param m11 -
     * @param m12 -
     * @param m20 -
     * @param m21 -
     * @param m22 -
     * @returns this
     */
    set(
        m00: number,
        m01: number,
        m02: number,
        m10: number,
        m11: number,
        m12: number,
        m20: number,
        m21: number,
        m22: number
    ): this {
        mat3.set(this.elements, m00, m01, m02, m10, m11, m12, m20, m21, m22);
        return this;
    }
    /**
     * Set this to the identity matrix
     * @returns this
     */
    identity(): this {
        mat3.identity(this.elements);
        return this;
    }
    /**
     * Transpose the values of this
     * @returns this
     */
    transpose(): this {
        mat3.transpose(this.elements, this.elements);
        return this;
    }
    /**
     * invert a matrix
     * @param m - Matrix to transpose; defaults to this matrix.
     * @returns this
     */
    invert(m: Matrix3 = this): this {
        mat3.invert(this.elements, m.elements);
        return this;
    }
    /**
     * Calculates the adjugate of a mat3
     * @param m -
     * @returns this
     */
    adjoint(m: Matrix3 = this): this {
        mat3.adjoint(this.elements, m.elements);
        return this;
    }
    /**
     * Calculates the determinant of this
     */
    determinant(): number {
        return mat3.determinant(this.elements);
    }
    /**
     * Multiplies two matrix3's
     * @param a -
     * @param b - 如果不传，计算 this 和 a 的乘积
     * @returns this
     */
    multiply(a: Matrix3, b?: Matrix3): this {
        const [left, right] = resolveOperands(this, a, b);
        mat3.multiply(this.elements, left.elements, right.elements);
        return this;
    }
    /**
     * 左乘
     * @param m -
     * @returns this
     */
    premultiply(m: Matrix3): this {
        this.multiply(m, this);
        return this;
    }
    /**
     * Translate this by the given vector
     * @param v - vector to translate by
     * @returns this
     */
    translate(v: Vector2): this {
        mat3.translate(this.elements, this.elements, v.elements);
        return this;
    }
    /**
     * Rotates this by the given angle
     * @param rad - the angle to rotate the matrix by
     * @returns this
     */
    rotate(rad: number): this {
        mat3.rotate(this.elements, this.elements, rad);
        return this;
    }
    /**
     * Scales the mat3 by the dimensions in the given vec2
     * @param v - the vec2 to scale the matrix by
     * @returns this
     */
    scale(v: Vector2): this {
        mat3.scale(this.elements, this.elements, v.elements);
        return this;
    }
    /**
     * Creates a matrix from a vector translation
     * @param v - Translation vector
     * @returns this
     */
    fromTranslation(v: Vector2): this {
        mat3.fromTranslation(this.elements, v.elements);
        return this;
    }
    /**
     * Creates a matrix from a given angle
     * @param rad - the angle to rotate the matrix by
     * @returns this
     */
    fromRotation(rad: number): this {
        mat3.fromRotation(this.elements, rad);
        return this;
    }
    /**
     * Creates a matrix from a vector scaling
     * @param v - Scaling vector
     * @returns this
     */
    fromScaling(v: Vector2): this {
        mat3.fromScaling(this.elements, v.elements);
        return this;
    }
    /**
     * Calculates a 3x3 matrix from the given quaternion
     * @param q - Quaternion to create matrix from
     * @returns this
     */
    fromQuat(q: Quaternion): this {
        mat3.fromQuat(this.elements, q.elements);
        return this;
    }
    /**
     * Calculates a 3x3 normal matrix (transpose inverse) from the 4x4 matrix
     * @param m - Mat4 to derive the normal matrix from
     * @returns this
     */
    normalFromMat4(m: Matrix4): this {
        mat3.normalFromMat4(this.elements, m.elements);
        return this;
    }
    /**
     * Copies the upper-left 3x3 values into the given mat3.
     * @param m - the source 4x4 matrix
     * @returns this
     */
    fromMat4(m: Matrix4): this {
        mat3.fromMat4(this.elements, m.elements);
        return this;
    }
    /**
     * Returns Frobenius norm of this
     * @returns Frobenius norm
     */
    frob(): number {
        return mat3.frob(this.elements);
    }
    /**
     * Adds two mat3's
     * @param a -
     * @param b - 如果不传，计算 this 和 a 的和
     * @returns this
     */
    add(a: Matrix3, b?: Matrix3): this {
        const [left, right] = resolveOperands(this, a, b);
        mat3.add(this.elements, left.elements, right.elements);
        return this;
    }
    /**
     * Subtracts matrix b from matrix a
     * @param a -
     * @param b - 如果不传，计算 this 和 a 的差
     * @returns this
     */
    subtract(a: Matrix3, b?: Matrix3): this {
        const [left, right] = resolveOperands(this, a, b);
        mat3.subtract(this.elements, left.elements, right.elements);
        return this;
    }
    /**
     * Returns whether or not the matrices have exactly the same elements in the same position (when compared with ===)
     * @param a -
     * @param b - 如果不传，比较 this 和 a 是否相等
     */
    exactEquals(a: Matrix3, b?: Matrix3): boolean {
        const [left, right] = resolveOperands(this, a, b);
        return mat3.exactEquals(left.elements, right.elements);
    }
    /**
     * Returns whether or not the matrices have approximately the same elements in the same position.
     * @param a -
     * @param b - 如果不传，比较 this 和 a 是否近似相等
     */
    equals(a: Matrix3, b?: Matrix3): boolean {
        const [left, right] = resolveOperands(this, a, b);
        return mat3.equals(left.elements, right.elements);
    }
    /**
     * fromRotationTranslationScale
     * @param rotation - rad angle
     * @param x -
     * @param y -
     * @param scaleX -
     * @param scaleY -
     */
    fromRotationTranslationScale(
        rotation: number,
        x: number,
        y: number,
        scaleX: number,
        scaleY: number
    ): this {
        const cos = Math.cos(rotation);
        const sin = Math.sin(rotation);
        this.set(scaleX * cos, -scaleY * sin, 0, scaleX * sin, scaleY * cos, 0, x, y, 1);
        return this;
    }
    sub(a: Matrix3, b?: Matrix3): this {
        return this.subtract(a, b);
    }
    mul(a: Matrix3, b?: Matrix3): this {
        return this.multiply(a, b);
    }
}
export default Matrix3;
