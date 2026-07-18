import { vec2 } from 'gl-matrix';
import type Matrix3 from './Matrix3';
import type Matrix4 from './Matrix4';
import { requireNumber, type MutableNumberArray } from './numberArray';
import { resolveOperands, resolveSource } from './operands';
/**
 * 二维向量
 */
class Vector2 {
    elements: vec2;
    /**
     * 类名
     */
    className = 'Vector2';
    isVector2 = true;
    /**
     * Creates a new empty vec2
     * @param x - X component
     * @param y - Y component
     */
    constructor(x = 0, y = 0) {
        /**
         * 数据
         */
        this.elements = vec2.fromValues(x, y);
    }
    /**
     * Copy the values from one vec2 to this
     * @param v - the source vector
     * @returns this
     */
    copy(v: Vector2): this {
        vec2.copy(this.elements, v.elements);
        return this;
    }
    /**
     * Creates a new vec2 initialized with values from this vector
     * @returns a new Vector2
     */
    clone(): Vector2 {
        const elements = this.elements;
        return new Vector2(elements[0], elements[1]);
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
        elements[0] = requireNumber(array, offset);
        elements[1] = requireNumber(array, offset + 1);
        return this;
    }
    /**
     * Set the components of a vec4 to the given values
     * @param x - X component
     * @param y - Y component
     * @returns this
     */
    set(x: number, y: number): this {
        vec2.set(this.elements, x, y);
        return this;
    }
    /**
     * Adds two vec2's
     * @param a -
     * @param b - 如果不传，计算 this 和 a 的和
     * @returns this
     */
    add(a: Vector2, b?: Vector2): this {
        const [left, right] = resolveOperands(this, a, b);
        vec2.add(this.elements, left.elements, right.elements);
        return this;
    }
    /**
     * Subtracts vector b from vector a
     * @param a -
     * @param b - 如果不传，计算 this 和 a 的差
     * @returns this
     */
    subtract(a: Vector2, b?: Vector2): this {
        const [left, right] = resolveOperands(this, a, b);
        vec2.subtract(this.elements, left.elements, right.elements);
        return this;
    }
    /**
     * Multiplies two vec2's
     * @param a -
     * @param b - 如果不传，计算 this 和 a 的积
     * @returns this
     */
    multiply(a: Vector2, b?: Vector2): this {
        const [left, right] = resolveOperands(this, a, b);
        vec2.multiply(this.elements, left.elements, right.elements);
        return this;
    }
    /**
     * Divides two vec2's
     * @param a -
     * @param b - 如果不传，计算 this 和 a 的商
     * @returns this
     */
    divide(a: Vector2, b?: Vector2): this {
        const [left, right] = resolveOperands(this, a, b);
        vec2.divide(this.elements, left.elements, right.elements);
        return this;
    }
    /**
     * Math.ceil the components of this
     * @returns this
     */
    ceil(): this {
        vec2.ceil(this.elements, this.elements);
        return this;
    }
    /**
     * Math.floor the components of this
     * @returns this
     */
    floor(): this {
        vec2.floor(this.elements, this.elements);
        return this;
    }
    /**
     * Returns the minimum of two vec2's
     * @param a -
     * @param b - 如果不传，计算 this 和 a 的结果
     * @returns this
     */
    min(a: Vector2, b?: Vector2): this {
        const [left, right] = resolveOperands(this, a, b);
        vec2.min(this.elements, left.elements, right.elements);
        return this;
    }
    /**
     * Returns the maximum of two vec2's
     * @param a -
     * @param b - 如果不传，计算 this 和 a 的结果
     * @returns this
     */
    max(a: Vector2, b?: Vector2): this {
        const [left, right] = resolveOperands(this, a, b);
        vec2.max(this.elements, left.elements, right.elements);
        return this;
    }
    /**
     * Math.round the components of this
     * @returns this
     */
    round(): this {
        vec2.round(this.elements, this.elements);
        return this;
    }
    /**
     * Scales this by a scalar number
     * @param scale - amount to scale the vector by
     * @returns this
     */
    scale(scale: number): this {
        vec2.scale(this.elements, this.elements, scale);
        return this;
    }
    /**
     * Adds two vec2's after scaling the second vector by a scalar value
     * @param scale - the amount to scale the second vector by before adding
     * @param a -
     * @param b - 如果不传，计算 this 和 a 的结果
     * @returns this
     */
    scaleAndAdd(scale: number, a: Vector2, b?: Vector2): this {
        const [left, right] = resolveOperands(this, a, b);
        vec2.scaleAndAdd(this.elements, left.elements, right.elements, scale);
        return this;
    }
    /**
     * Calculates the euclidian distance between two vec2's
     * @param a -
     * @param b - 如果不传，计算 this 和 a 的结果
     * @returns distance between a and b
     */
    distance(a: Vector2, b?: Vector2): number {
        const [left, right] = resolveOperands(this, a, b);
        return vec2.distance(left.elements, right.elements);
    }
    /**
     * Calculates the squared euclidian distance between two vec2's
     * @param a -
     * @param b - 如果不传，计算 this 和 a 的结果
     * @returns squared distance between a and b
     */
    squaredDistance(a: Vector2, b?: Vector2): number {
        const [left, right] = resolveOperands(this, a, b);
        return vec2.squaredDistance(left.elements, right.elements);
    }
    /**
     * Calculates the length of this
     * @returns length of this
     */
    length(): number {
        return vec2.length(this.elements);
    }
    /**
     * Calculates the squared length of this
     * @returns squared length of this
     */
    squaredLength(): number {
        return vec2.squaredLength(this.elements);
    }
    /**
     * Negates the components of this
     * @returns this
     */
    negate(): this {
        vec2.negate(this.elements, this.elements);
        return this;
    }
    /**
     * Returns the inverse of the components of a vec2
     * @param a -
     * @returns this
     */
    inverse(a?: Vector2): this {
        vec2.inverse(this.elements, resolveSource(this, a).elements);
        return this;
    }
    /**
     * Normalize this
     * @returns this
     */
    normalize(): this {
        vec2.normalize(this.elements, this.elements);
        return this;
    }
    /**
     * Calculates the dot product of two vec2's
     * @param a -
     * @param b - 如果不传，计算 this 和 a 的结果
     * @returns product of a and b
     */
    dot(a: Vector2, b?: Vector2): number {
        const [left, right] = resolveOperands(this, a, b);
        return vec2.dot(left.elements, right.elements);
    }
    /**
     * Computes the cross product of two vec2's
     * @param a -
     * @param b - 如果不传，计算 this 和 a 的结果
     * @returns cross product of a and b
     */
    cross(a: Vector2, b?: Vector2): this {
        const [left, right] = resolveOperands(this, a, b);
        vec2.cross(this.elements, left.elements, right.elements);
        return this;
    }
    /**
     * Performs a linear interpolation between two vec2's
     * @param v -
     * @param t - interpolation amount between the two vectors
     * @returns this
     */
    lerp(v: Vector2, t: number): this {
        vec2.lerp(this.elements, this.elements, v.elements, t);
        return this;
    }
    /**
     * Generates a random vector with the given scale
     * @param scale - Length of the resulting vector. If ommitted, a unit vector will be returned
     * @returns this
     */
    random(scale?: number): this {
        vec2.random(this.elements, scale);
        return this;
    }
    /**
     * Transforms the vec2 with a mat3
     * @param m - matrix to transform with
     * @returns this
     */
    transformMat3(m: Matrix3): this {
        vec2.transformMat3(this.elements, this.elements, m.elements);
        return this;
    }
    /**
     * Transforms the vec2 with a mat4
     * @param m - matrix to transform with
     * @returns this
     */
    transformMat4(m: Matrix4): this {
        vec2.transformMat4(this.elements, this.elements, m.elements);
        return this;
    }
    /**
     * Returns whether or not the vectors have exactly the same elements in the same position (when compared with ===)
     * @param a -
     * @param b - 如果不传，计算 this 和 a 的结果
     * @returns True if the vectors are equal, false otherwise.
     */
    exactEquals(a: Vector2, b?: Vector2): boolean {
        const [left, right] = resolveOperands(this, a, b);
        return vec2.exactEquals(left.elements, right.elements);
    }
    /**
     * Returns whether or not the vectors have approximately the same elements in the same position.
     * @param a -
     * @param b - 如果不传，计算 this 和 a 的结果
     * @returns True if the vectors are equal, false otherwise.
     */
    equals(a: Vector2, b?: Vector2): boolean {
        const [left, right] = resolveOperands(this, a, b);
        return vec2.equals(left.elements, right.elements);
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
    sub(a: Vector2, b?: Vector2): this {
        return this.subtract(a, b);
    }
    mul(a: Vector2, b?: Vector2): this {
        return this.multiply(a, b);
    }
    div(a: Vector2, b?: Vector2): this {
        return this.divide(a, b);
    }
    dist(a: Vector2, b?: Vector2): number {
        return this.distance(a, b);
    }
    sqrDist(a: Vector2, b?: Vector2): number {
        return this.squaredDistance(a, b);
    }
    len(): number {
        return this.length();
    }
    sqrLen(): number {
        return this.squaredLength();
    }
}
export default Vector2;
