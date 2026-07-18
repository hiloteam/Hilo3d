import { vec4 } from 'gl-matrix';
import type Matrix4 from './Matrix4';
import type Quaternion from './Quaternion';
import { requireNumber, type MutableNumberArray } from './numberArray';
import { resolveOperands, resolveSource } from './operands';
/**
 * 四维向量
 */
class Vector4 {
    elements: vec4;
    /**
     * 类名
     */
    className = 'Vector4';
    isVector4 = true;
    /**
     * Creates a new empty vec4
     * @param x - X component
     * @param y - Y component
     * @param z - Z component
     * @param w - W component
     */
    constructor(x = 0, y = 0, z = 0, w = 0) {
        /**
         * 数据
         */
        this.elements = vec4.fromValues(x, y, z, w);
    }
    /**
     * Copy the values from one vec4 to this
     * @param v - the source vector
     * @returns this
     */
    copy(v: Vector4): this {
        vec4.copy(this.elements, v.elements);
        return this;
    }
    /**
     * Creates a new vec4 initialized with values from this vector
     * @returns a new Vector4
     */
    clone(): Vector4 {
        const elements = this.elements;
        return new Vector4(elements[0], elements[1], elements[2], elements[3]);
    }
    /**
     * 转换到数组
     * @param array - 数组
     * @param offset - 数组偏移值
     */
    toArray(array: MutableNumberArray = [], offset = 0): MutableNumberArray {
        const elements = this.elements;
        array[0 + offset] = elements[0];
        array[1 + offset] = elements[1];
        array[2 + offset] = elements[2];
        array[3 + offset] = elements[3];
        return array;
    }
    /**
     * 从数组赋值
     * @param array - 数组
     * @param offset - 数组偏移值
     */
    fromArray(array: ArrayLike<number>, offset = 0): this {
        const elements = this.elements;
        elements[0] = requireNumber(array, offset);
        elements[1] = requireNumber(array, offset + 1);
        elements[2] = requireNumber(array, offset + 2);
        elements[3] = requireNumber(array, offset + 3);
        return this;
    }
    /**
     * Set the components of a vec4 to the given values
     * @param x - X component
     * @param y - Y component
     * @param z - Z component
     * @param w - W component
     * @returns this
     */
    set(x: number, y: number, z: number, w: number): this {
        vec4.set(this.elements, x, y, z, w);
        return this;
    }
    /**
     * Adds two vec4's
     * @param a -
     * @param b - 如果不传，计算 this 和 a 的和
     * @returns this
     */
    add(a: Vector4, b?: Vector4): this {
        const [left, right] = resolveOperands(this, a, b);
        vec4.add(this.elements, left.elements, right.elements);
        return this;
    }
    /**
     * Subtracts vector b from vector a
     * @param a -
     * @param b - 如果不传，计算 this 和 a 的差
     * @returns this
     */
    subtract(a: Vector4, b?: Vector4): this {
        const [left, right] = resolveOperands(this, a, b);
        vec4.subtract(this.elements, left.elements, right.elements);
        return this;
    }
    /**
     * Multiplies two vec4's
     * @param a -
     * @param b - 如果不传，计算 this 和 a 的积
     * @returns this
     */
    multiply(a: Vector4, b?: Vector4): this {
        const [left, right] = resolveOperands(this, a, b);
        vec4.multiply(this.elements, left.elements, right.elements);
        return this;
    }
    /**
     * Divides two vec4's
     * @param a -
     * @param b - 如果不传，计算 this 和 a 的商
     * @returns this
     */
    divide(a: Vector4, b?: Vector4): this {
        const [left, right] = resolveOperands(this, a, b);
        vec4.divide(this.elements, left.elements, right.elements);
        return this;
    }
    /**
     * Math.ceil the components of this
     * @returns this
     */
    ceil(): this {
        vec4.ceil(this.elements, this.elements);
        return this;
    }
    /**
     * Math.floor the components of this
     * @returns this
     */
    floor(): this {
        vec4.floor(this.elements, this.elements);
        return this;
    }
    /**
     * Returns the minimum of two vec4's
     * @param a -
     * @param b - 如果不传，计算 this 和 a 的结果
     * @returns this
     */
    min(a: Vector4, b?: Vector4): this {
        const [left, right] = resolveOperands(this, a, b);
        vec4.min(this.elements, left.elements, right.elements);
        return this;
    }
    /**
     * Returns the maximum of two vec4's
     * @param a -
     * @param b - 如果不传，计算 this 和 a 的结果
     * @returns this
     */
    max(a: Vector4, b?: Vector4): this {
        const [left, right] = resolveOperands(this, a, b);
        vec4.max(this.elements, left.elements, right.elements);
        return this;
    }
    /**
     * Math.round the components of this
     * @returns this
     */
    round(): this {
        vec4.round(this.elements, this.elements);
        return this;
    }
    /**
     * Scales this by a scalar number
     * @param scale - amount to scale the vector by
     * @returns this
     */
    scale(scale: number): this {
        vec4.scale(this.elements, this.elements, scale);
        return this;
    }
    /**
     * Adds two vec4's after scaling the second vector by a scalar value
     * @param scale - the amount to scale the second vector by before adding
     * @param a -
     * @param b - 如果不传，计算 this 和 a 的结果
     * @returns this
     */
    scaleAndAdd(scale: number, a: Vector4, b?: Vector4): this {
        const [left, right] = resolveOperands(this, a, b);
        vec4.scaleAndAdd(this.elements, left.elements, right.elements, scale);
        return this;
    }
    /**
     * Calculates the euclidian distance between two vec4's
     * @param a -
     * @param b - 如果不传，计算 this 和 a 的结果
     * @returns distance between a and b
     */
    distance(a: Vector4, b?: Vector4): number {
        const [left, right] = resolveOperands(this, a, b);
        return vec4.distance(left.elements, right.elements);
    }
    /**
     * Calculates the squared euclidian distance between two vec4's
     * @param a -
     * @param b - 如果不传，计算 this 和 a 的结果
     * @returns squared distance between a and b
     */
    squaredDistance(a: Vector4, b?: Vector4): number {
        const [left, right] = resolveOperands(this, a, b);
        return vec4.squaredDistance(left.elements, right.elements);
    }
    /**
     * Calculates the length of this
     * @returns length of this
     */
    length(): number {
        return vec4.length(this.elements);
    }
    /**
     * Calculates the squared length of this
     * @returns squared length of this
     */
    squaredLength(): number {
        return vec4.squaredLength(this.elements);
    }
    /**
     * Negates the components of this
     * @returns this
     */
    negate(): this {
        vec4.negate(this.elements, this.elements);
        return this;
    }
    /**
     * Returns the inverse of the components of a vec4
     * @param a -
     * @returns this
     */
    inverse(a?: Vector4): this {
        vec4.inverse(this.elements, resolveSource(this, a).elements);
        return this;
    }
    /**
     * Normalize this
     * @returns this
     */
    normalize(): this {
        vec4.normalize(this.elements, this.elements);
        return this;
    }
    /**
     * Calculates the dot product of two vec4's
     * @param a -
     * @param b - 如果不传，计算 this 和 a 的结果
     * @returns product of a and b
     */
    dot(a: Vector4, b?: Vector4): number {
        const [left, right] = resolveOperands(this, a, b);
        return vec4.dot(left.elements, right.elements);
    }
    /**
     * Performs a linear interpolation between two vec4's
     * @param v -
     * @param t - interpolation amount between the two vectors
     * @returns this
     */
    lerp(v: Vector4, t: number): this {
        vec4.lerp(this.elements, this.elements, v.elements, t);
        return this;
    }
    /**
     * Generates a random vector with the given scale
     * @param scale - Length of the resulting vector. If ommitted, a unit vector will be returned
     * @returns this
     */
    random(scale?: number): this {
        scale ??= 1;
        this.elements[0] = Math.random();
        this.elements[1] = Math.random();
        this.elements[2] = Math.random();
        this.elements[3] = Math.random();
        this.normalize();
        this.scale(scale);
        return this;
    }
    /**
     * Transforms the vec4 with a mat4
     * @param m - matrix to transform with
     * @returns this
     */
    transformMat4(m: Matrix4): this {
        vec4.transformMat4(this.elements, this.elements, m.elements);
        return this;
    }
    /**
     * Transforms the vec4 with a quat
     * @param q - quaternion to transform with
     * @returns this
     */
    transformQuat(q: Quaternion): this {
        vec4.transformQuat(this.elements, this.elements, q.elements);
        return this;
    }
    /**
     * Returns whether or not the vectors have exactly the same elements in the same position (when compared with ===)
     * @param a -
     * @param b - 如果不传，计算 this 和 a 的结果
     * @returns True if the vectors are equal, false otherwise.
     */
    exactEquals(a: Vector4, b?: Vector4): boolean {
        const [left, right] = resolveOperands(this, a, b);
        return vec4.exactEquals(left.elements, right.elements);
    }
    /**
     * Returns whether or not the vectors have approximately the same elements in the same position.
     * @param a -
     * @param b - 如果不传，计算 this 和 a 的结果
     * @returns True if the vectors are equal, false otherwise.
     */
    equals(a: Vector4, b?: Vector4): boolean {
        const [left, right] = resolveOperands(this, a, b);
        return vec4.equals(left.elements, right.elements);
    }
    /**
     * X component
     */
    get x(): number {
        return this.elements[0];
    }
    /**
     * X component
     */
    set x(value: number) {
        this.elements[0] = value;
    }
    /**
     * Y component
     */
    get y(): number {
        return this.elements[1];
    }
    /**
     * Y component
     */
    set y(value: number) {
        this.elements[1] = value;
    }
    /**
     * Z component
     */
    get z(): number {
        return this.elements[2];
    }
    /**
     * Z component
     */
    set z(value: number) {
        this.elements[2] = value;
    }
    /**
     * W component
     */
    get w(): number {
        return this.elements[3];
    }
    /**
     * W component
     */
    set w(value: number) {
        this.elements[3] = value;
    }
    sub(a: Vector4, b?: Vector4): this {
        return this.subtract(a, b);
    }
    mul(a: Vector4, b?: Vector4): this {
        return this.multiply(a, b);
    }
    div(a: Vector4, b?: Vector4): this {
        return this.divide(a, b);
    }
    dist(a: Vector4, b?: Vector4): number {
        return this.distance(a, b);
    }
    sqrDist(a: Vector4, b?: Vector4): number {
        return this.squaredDistance(a, b);
    }
    len(): number {
        return this.length();
    }
    sqrLen(): number {
        return this.squaredLength();
    }
}
export default Vector4;
