import { vec3 } from 'gl-matrix';
import type Matrix3 from './Matrix3';
import type Matrix4 from './Matrix4';
import type Quaternion from './Quaternion';
import { requireNumber, type MutableNumberArray } from './numberArray';
import { resolveOperands, resolveSource } from './operands';
/**
 * 三维向量
 */
class Vector3 {
    elements: vec3;
    /**
     * 类名
     */
    className = 'Vector3';
    isVector3 = true;
    /**
     * Creates a new empty vec3
     * @param x - X component
     * @param y - Y component
     * @param z - Z component
     */
    constructor(x = 0, y = 0, z = 0) {
        /**
         * 数据
         */
        this.elements = vec3.fromValues(x, y, z);
    }
    /**
     * Copy the values from one vec3 to this
     * @param v - the source vector
     * @returns this
     */
    copy(v: Vector3): this {
        vec3.copy(this.elements, v.elements);
        return this;
    }
    /**
     * Creates a new vec3 initialized with values from this vec3
     * @returns a new Vector3
     */
    clone(): Vector3 {
        const elements = this.elements;
        return new Vector3(elements[0], elements[1], elements[2]);
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
        elements[2] = requireNumber(array, offset + 2);
        return this;
    }
    /**
     * Set the components of a vec3 to the given values
     * @param x - X component
     * @param y - Y component
     * @param z - Z component
     * @returns this
     */
    set(x: number, y: number, z: number): this {
        vec3.set(this.elements, x, y, z);
        return this;
    }
    /**
     * Adds two vec3's
     * @param a -
     * @param b - 如果不传，计算 this 和 a 的和
     * @returns this
     */
    add(a: Vector3, b?: Vector3): this {
        const [left, right] = resolveOperands(this, a, b);
        vec3.add(this.elements, left.elements, right.elements);
        return this;
    }
    /**
     * Subtracts vector b from vector a
     * @param a -
     * @param b - 如果不传，计算 this 和 a 的差
     * @returns this
     */
    subtract(a: Vector3, b?: Vector3): this {
        const [left, right] = resolveOperands(this, a, b);
        vec3.subtract(this.elements, left.elements, right.elements);
        return this;
    }
    /**
     * Multiplies two vec3's
     * @param a -
     * @param b - 如果不传，计算 this 和 a 的积
     * @returns this
     */
    multiply(a: Vector3, b?: Vector3): this {
        const [left, right] = resolveOperands(this, a, b);
        vec3.multiply(this.elements, left.elements, right.elements);
        return this;
    }
    /**
     * Divides two vec3's
     * @param a -
     * @param b - 如果不传，计算 this 和 a 的商
     * @returns this
     */
    divide(a: Vector3, b?: Vector3): this {
        const [left, right] = resolveOperands(this, a, b);
        vec3.divide(this.elements, left.elements, right.elements);
        return this;
    }
    /**
     * Math.ceil the components of this
     * @returns this
     */
    ceil(): this {
        vec3.ceil(this.elements, this.elements);
        return this;
    }
    /**
     * Math.floor the components of this
     * @returns this
     */
    floor(): this {
        vec3.floor(this.elements, this.elements);
        return this;
    }
    /**
     * Returns the minimum of two vec3's
     * @param a -
     * @param b - 如果不传，计算 this 和 a 的结果
     * @returns this
     */
    min(a: Vector3, b?: Vector3): this {
        const [left, right] = resolveOperands(this, a, b);
        vec3.min(this.elements, left.elements, right.elements);
        return this;
    }
    /**
     * Returns the maximum of two vec3's
     * @param a -
     * @param b - 如果不传，计算 this 和 a 的结果
     * @returns this
     */
    max(a: Vector3, b?: Vector3): this {
        const [left, right] = resolveOperands(this, a, b);
        vec3.max(this.elements, left.elements, right.elements);
        return this;
    }
    /**
     * Math.round the components of this
     * @returns this
     */
    round(): this {
        vec3.round(this.elements, this.elements);
        return this;
    }
    /**
     * Scales this by a scalar number
     * @param scale - amount to scale the vector by
     * @returns this
     */
    scale(scale: number): this {
        vec3.scale(this.elements, this.elements, scale);
        return this;
    }
    /**
     * Adds two vec3's after scaling the second vector by a scalar value
     * @param scale - the amount to scale the second vector by before adding
     * @param a -
     * @param b - 如果不传，计算 this 和 a 的结果
     * @returns this
     */
    scaleAndAdd(scale: number, a: Vector3, b?: Vector3): this {
        const [left, right] = resolveOperands(this, a, b);
        vec3.scaleAndAdd(this.elements, left.elements, right.elements, scale);
        return this;
    }
    /**
     * Calculates the euclidian distance between two vec3's
     * @param a -
     * @param b - 如果不传，计算 this 和 a 的结果
     * @returns distance between a and b
     */
    distance(a: Vector3, b?: Vector3): number {
        const [left, right] = resolveOperands(this, a, b);
        return vec3.distance(left.elements, right.elements);
    }
    /**
     * Calculates the squared euclidian distance between two vec3's
     * @param a -
     * @param b - 如果不传，计算 this 和 a 的结果
     * @returns squared distance between a and b
     */
    squaredDistance(a: Vector3, b?: Vector3): number {
        const [left, right] = resolveOperands(this, a, b);
        return vec3.squaredDistance(left.elements, right.elements);
    }
    /**
     * Calculates the length of this
     * @returns length of this
     */
    length(): number {
        return vec3.length(this.elements);
    }
    /**
     * Calculates the squared length of this
     * @returns squared length of this
     */
    squaredLength(): number {
        return vec3.squaredLength(this.elements);
    }
    /**
     * Negates the components of this
     * @returns this
     */
    negate(): this {
        vec3.negate(this.elements, this.elements);
        return this;
    }
    /**
     * Returns the inverse of the components of a vec3
     * @param a -
     * @returns this
     */
    inverse(a?: Vector3): this {
        vec3.inverse(this.elements, resolveSource(this, a).elements);
        return this;
    }
    /**
     * Normalize this
     * @returns this
     */
    normalize(): this {
        vec3.normalize(this.elements, this.elements);
        return this;
    }
    /**
     * Calculates the dot product of two vec3's
     * @param a -
     * @param b - 如果不传，计算 this 和 a 的结果
     * @returns product of a and b
     */
    dot(a: Vector3, b?: Vector3): number {
        const [left, right] = resolveOperands(this, a, b);
        return vec3.dot(left.elements, right.elements);
    }
    /**
     * Computes the cross product of two vec3's
     * @param a -
     * @param b - 如果不传，计算 this 和 a 的结果
     * @returns cross product of a and b
     */
    cross(a: Vector3, b?: Vector3): this {
        const [left, right] = resolveOperands(this, a, b);
        vec3.cross(this.elements, left.elements, right.elements);
        return this;
    }
    /**
     * Performs a linear interpolation between two vec3's
     * @param v -
     * @param t - interpolation amount between the two vectors
     * @returns this
     */
    lerp(v: Vector3, t: number): this {
        vec3.lerp(this.elements, this.elements, v.elements, t);
        return this;
    }
    /**
     * Performs a hermite interpolation with two control points
     * @param a -
     * @param b -
     * @param c -
     * @param d -
     * @param t - interpolation amount between the two inputs
     * @returns this
     */
    hermite(a: Vector3, b: Vector3, c: Vector3, d: Vector3, t: number): this {
        vec3.hermite(this.elements, a.elements, b.elements, c.elements, d.elements, t);
        return this;
    }
    /**
     * Performs a bezier interpolation with two control points
     * @param a -
     * @param b -
     * @param c -
     * @param d -
     * @param t - interpolation amount between the two inputs
     * @returns this
     */
    bezier(a: Vector3, b: Vector3, c: Vector3, d: Vector3, t: number): this {
        vec3.bezier(this.elements, a.elements, b.elements, c.elements, d.elements, t);
        return this;
    }
    /**
     * Generates a random vector with the given scale
     * @param scale - Length of the resulting vector. If ommitted, a unit vector will be returned
     * @returns this
     */
    random(scale?: number): this {
        vec3.random(this.elements, scale);
        return this;
    }
    /**
     * Transforms the vec3 with a mat3
     * @param m - matrix to transform with
     * @returns this
     */
    transformMat3(m: Matrix3): this {
        vec3.transformMat3(this.elements, this.elements, m.elements);
        return this;
    }
    /**
     * Transforms the vec3 with a mat4
     * @param m - matrix to transform with
     * @returns this
     */
    transformMat4(m: Matrix4): this {
        vec3.transformMat4(this.elements, this.elements, m.elements);
        return this;
    }
    /**
     * Transforms the vec3 direction with a mat4
     * @param m - matrix to transform with
     * @returns this
     */
    transformDirection(m: Matrix4): this {
        const elements = this.elements;
        const mElements = m.elements;
        const x = elements[0];
        const y = elements[1];
        const z = elements[2];
        elements[0] = x * mElements[0] + y * mElements[4] + z * mElements[8];
        elements[1] = x * mElements[1] + y * mElements[5] + z * mElements[9];
        elements[2] = x * mElements[2] + y * mElements[6] + z * mElements[10];
        return this;
    }
    /**
     * Transforms the vec3 with a quat
     * @param q - quaternion to transform with
     * @returns this
     */
    transformQuat(q: Quaternion): this {
        vec3.transformQuat(this.elements, this.elements, q.elements);
        return this;
    }
    /**
     * Rotate this 3D vector around the x-axis
     * @param origin - The origin of the rotation
     * @param rotation - The angle of rotation
     * @returns this
     */
    rotateX(origin: Vector3, rotation: number): this {
        vec3.rotateX(this.elements, this.elements, origin.elements, rotation);
        return this;
    }
    /**
     * Rotate this 3D vector around the y-axis
     * @param origin - The origin of the rotation
     * @param rotation - The angle of rotation
     * @returns this
     */
    rotateY(origin: Vector3, rotation: number): this {
        vec3.rotateY(this.elements, this.elements, origin.elements, rotation);
        return this;
    }
    /**
     * Rotate this 3D vector around the z-axis
     * @param origin - The origin of the rotation
     * @param rotation - The angle of rotation
     * @returns this
     */
    rotateZ(origin: Vector3, rotation: number): this {
        vec3.rotateZ(this.elements, this.elements, origin.elements, rotation);
        return this;
    }
    /**
     * Returns whether or not the vectors have exactly the same elements in the same position (when compared with ===)
     * @param a -
     * @param b - 如果不传，计算 this 和 a 的结果
     * @returns True if the vectors are equal, false otherwise.
     */
    exactEquals(a: Vector3, b?: Vector3): boolean {
        const [left, right] = resolveOperands(this, a, b);
        return vec3.exactEquals(left.elements, right.elements);
    }
    /**
     * Returns whether or not the vectors have approximately the same elements in the same position.
     * @param a -
     * @param b - 如果不传，计算 this 和 a 的结果
     * @returns True if the vectors are equal, false otherwise.
     */
    equals(a: Vector3, b?: Vector3): boolean {
        const [left, right] = resolveOperands(this, a, b);
        return vec3.equals(left.elements, right.elements);
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
    sub(a: Vector3, b?: Vector3): this {
        return this.subtract(a, b);
    }
    mul(a: Vector3, b?: Vector3): this {
        return this.multiply(a, b);
    }
    div(a: Vector3, b?: Vector3): this {
        return this.divide(a, b);
    }
    dist(a: Vector3, b?: Vector3): number {
        return this.distance(a, b);
    }
    sqrDist(a: Vector3, b?: Vector3): number {
        return this.squaredDistance(a, b);
    }
    len(): number {
        return this.length();
    }
    sqrLen(): number {
        return this.squaredLength();
    }
}
export default Vector3;
