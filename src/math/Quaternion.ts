import { quat } from 'gl-matrix';
import Matrix3 from './Matrix3';
import type Euler from './Euler';
import type Matrix4 from './Matrix4';
import type Vector3 from './Vector3';
import { requireNumber, type MutableNumberArray } from './numberArray';
const tempMat3 = new Matrix3();
class Quaternion {
    elements: quat;
    /**
     * 类名
     */
    className = 'Quaternion';
    isQuaternion = true;
    /**
     * Creates a new identity quat
     * @param x - X component
     * @param y - Y component
     * @param z - Z component
     * @param w - W component
     */
    constructor(x = 0, y = 0, z = 0, w = 1) {
        /**
         * 数据
         */
        this.elements = quat.fromValues(x, y, z, w);
    }
    /**
     * Copy the values from one quat to this
     * @param q -
     * @returns this
     */
    copy(q: Quaternion): this {
        quat.copy(this.elements, q.elements);
        return this;
    }
    /**
     * Creates a new quat initialized with values from an existing quaternion
     * @returns a new quaternion
     */
    clone(): Quaternion {
        const el = this.elements;
        return new Quaternion(el[0], el[1], el[2], el[3]);
    }
    /**
     * 转换到数组
     * @param array - 数组
     * @param offset - 数组偏移值
     */
    toArray(array: MutableNumberArray = [], offset = 0): MutableNumberArray {
        const el = this.elements;
        array[offset] = el[0];
        array[offset + 1] = el[1];
        array[offset + 2] = el[2];
        array[offset + 3] = el[3];
        return array;
    }
    /**
     * 从数组赋值
     * @param array - 数组
     * @param offset - 数组偏移值
     * @returns this
     */
    fromArray(array: ArrayLike<number>, offset = 0): this {
        const el = this.elements;
        el[0] = requireNumber(array, offset);
        el[1] = requireNumber(array, offset + 1);
        el[2] = requireNumber(array, offset + 2);
        el[3] = requireNumber(array, offset + 3);
        return this;
    }
    /**
     * Set the components of a quat to the given values
     * @param x - X component
     * @param y - Y component
     * @param z - Z component
     * @param w - W component
     * @returns this
     */
    set(x: number, y: number, z: number, w: number): this {
        quat.set(this.elements, x, y, z, w);
        return this;
    }
    /**
     * Set this to the identity quaternion
     * @returns this
     */
    identity(): this {
        quat.identity(this.elements);
        return this;
    }
    /**
     * Sets a quaternion to represent the shortest rotation from one
     * vector to another.
     * @param a - the initial vector
     * @param b - the destination vector
     * @returns this
     */
    rotationTo(a: Vector3, b: Vector3): this {
        quat.rotationTo(this.elements, a.elements, b.elements);
        return this;
    }
    /**
     * Sets the specified quaternion with values corresponding to the given
     * axes. Each axis is a vec3 and is expected to be unit length and
     * perpendicular to all other specified axes.
     *
     * @param view - the vector representing the viewing direction
     * @param right - the vector representing the local "right" direction
     * @param up - the vector representing the local "up" direction
     * @returns this
     */
    setAxes(view: Vector3, right: Vector3, up: Vector3): this {
        quat.setAxes(this.elements, view.elements, right.elements, up.elements);
        return this;
    }
    /**
     * Sets a quat from the given angle and rotation axis,
     * then returns it.
     * @param axis - the axis around which to rotate
     * @param rad - the angle in radians
     * @returns this
     */
    setAxisAngle(axis: Vector3, rad: number): this {
        quat.setAxisAngle(this.elements, axis.elements, rad);
        return this;
    }
    /**
     * Gets the rotation axis and angle for a given
     *  quaternion. If a quaternion is created with
     *  setAxisAngle, this method will return the same
     *  values as providied in the original parameter list
     *  OR functionally equivalent values.
     * Example: The quaternion formed by axis [0, 0, 1] and
     *  angle -90 is the same as the quaternion formed by
     *  [0, 0, 1] and 270. This method favors the latter.
     * @param axis - Vector receiving the axis of rotation
     * @returns Angle, in radians, of the rotation
     */
    getAxisAngle(axis: Vector3): number {
        return quat.getAxisAngle(axis.elements, this.elements);
    }
    /**
     * Adds two quat's
     * @param q -
     * @returns this
     */
    add(q: Quaternion): this {
        quat.add(this.elements, this.elements, q.elements);
        return this;
    }
    /**
     * Multiplies two quat's
     * @param q -
     * @returns this
     */
    multiply(q: Quaternion): this {
        quat.multiply(this.elements, this.elements, q.elements);
        return this;
    }
    /**
     * premultiply the quat
     * @param q -
     * @returns this
     */
    premultiply(q: Quaternion): this {
        quat.multiply(this.elements, q.elements, this.elements);
        return this;
    }
    /**
     * Scales a quat by a scalar number
     * @param scale - the vector to scale
     * @returns this
     */
    scale(scale: number): this {
        quat.scale(this.elements, this.elements, scale);
        return this;
    }
    /**
     * Rotates a quaternion by the given angle about the X axis
     * @param rad - angle (in radians) to rotate
     * @returns this
     */
    rotateX(rad: number): this {
        quat.rotateX(this.elements, this.elements, rad);
        return this;
    }
    /**
     * Rotates a quaternion by the given angle about the Y axis
     * @param rad - angle (in radians) to rotate
     * @returns this
     */
    rotateY(rad: number): this {
        quat.rotateY(this.elements, this.elements, rad);
        return this;
    }
    /**
     * Rotates a quaternion by the given angle about the Z axis
     * @param rad - angle (in radians) to rotate
     * @returns this
     */
    rotateZ(rad: number): this {
        quat.rotateZ(this.elements, this.elements, rad);
        return this;
    }
    /**
     * Calculates the W component of a quat from the X, Y, and Z components.
     * Assumes that quaternion is 1 unit in length.
     * Any existing W component will be ignored.
     * @returns this
     */
    calculateW(): this {
        quat.calculateW(this.elements, this.elements);
        return this;
    }
    /**
     * Calculates the dot product of two quat's
     * @param q -
     * @returns dot product of two quat's
     */
    dot(q: Quaternion): number {
        return quat.dot(this.elements, q.elements);
    }
    /**
     * Performs a linear interpolation between two quat's
     * @param q -
     * @param t - interpolation amount between the two inputs
     * @returns this
     */
    lerp(q: Quaternion, t: number): this {
        quat.lerp(this.elements, this.elements, q.elements, t);
        return this;
    }
    /**
     * Performs a spherical linear interpolation between two quat
     * @param q -
     * @param t - interpolation amount between the two inputs
     * @returns this
     */
    slerp(q: Quaternion, t: number): this {
        quat.slerp(this.elements, this.elements, q.elements, t);
        return this;
    }
    /**
     * Performs a spherical linear interpolation with two control points
     * @param qa -
     * @param qb -
     * @param qc -
     * @param qd -
     * @param t - interpolation amount
     * @returns this
     */
    sqlerp(qa: Quaternion, qb: Quaternion, qc: Quaternion, qd: Quaternion, t: number): this {
        quat.sqlerp(this.elements, qa.elements, qb.elements, qc.elements, qd.elements, t);
        return this;
    }
    /**
     * Calculates the inverse of a quat
     * @returns this
     */
    invert(): this {
        quat.invert(this.elements, this.elements);
        return this;
    }
    /**
     * Calculates the conjugate of a quat
     * If the quaternion is normalized, this function is faster than quat.inverse and produces the same result.
     * @returns this
     */
    conjugate(): this {
        quat.conjugate(this.elements, this.elements);
        return this;
    }
    /**
     * Calculates the length of a quat
     * @returns length of this
     */
    length(): number {
        return quat.length(this.elements);
    }
    /**
     * Calculates the squared length of a quat
     * @returns squared length of this
     */
    squaredLength(): number {
        return quat.squaredLength(this.elements);
    }
    /**
     * Normalize this
     * @returns this
     */
    normalize(): this {
        quat.normalize(this.elements, this.elements);
        return this;
    }
    /**
     * Creates a quaternion from the given 3x3 rotation matrix.
     *
     * NOTE: The resultant quaternion is not normalized, so you should be sure
     * to renormalize the quaternion yourself where necessary.
     *
     * @param mat - rotation matrix
     * @returns this
     */
    fromMat3(mat: Matrix3): this {
        quat.fromMat3(this.elements, mat.elements);
        return this;
    }
    /**
     * Creates a quaternion from the given 3x3 rotation matrix.
     *
     * NOTE: The resultant quaternion is not normalized, so you should be sure
     * to renormalize the quaternion yourself where necessary.
     *
     * @param mat - rotation matrix
     * @returns this
     */
    fromMat4(mat: Matrix4): this {
        tempMat3.fromMat4(mat);
        this.fromMat3(tempMat3);
        return this;
    }
    /**
     * Returns whether or not the quaternions have exactly the same elements in the same position (when compared with ===)
     * @param q -
     */
    exactEquals(q: Quaternion): boolean {
        return quat.exactEquals(this.elements, q.elements);
    }
    /**
     * Returns whether or not the quaternions have approximately the same elements in the same position.
     * @param q -
     */
    equals(q: Quaternion): boolean {
        return quat.equals(this.elements, q.elements);
    }
    /**
     * Creates a quaternion from the given euler.
     * @param euler -
     * @returns this
     */
    fromEuler(euler: Euler): this {
        // Based on https://github.com/mrdoob/three.js/blob/dev/src/math/Quaternion.js#L200
        // quat.fromEuler(this.elements, euler.x, euler.y, euler.z);
        const x = euler.x * 0.5;
        const y = euler.y * 0.5;
        const z = euler.z * 0.5;
        const order = euler.order;
        const sx = Math.sin(x);
        const cx = Math.cos(x);
        const sy = Math.sin(y);
        const cy = Math.cos(y);
        const sz = Math.sin(z);
        const cz = Math.cos(z);
        const out = this.elements;
        if (order === 'XYZ') {
            out[0] = sx * cy * cz + cx * sy * sz;
            out[1] = cx * sy * cz - sx * cy * sz;
            out[2] = cx * cy * sz + sx * sy * cz;
            out[3] = cx * cy * cz - sx * sy * sz;
        } else if (order === 'YXZ') {
            out[0] = sx * cy * cz + cx * sy * sz;
            out[1] = cx * sy * cz - sx * cy * sz;
            out[2] = cx * cy * sz - sx * sy * cz;
            out[3] = cx * cy * cz + sx * sy * sz;
        } else if (order === 'ZXY') {
            out[0] = sx * cy * cz - cx * sy * sz;
            out[1] = cx * sy * cz + sx * cy * sz;
            out[2] = cx * cy * sz + sx * sy * cz;
            out[3] = cx * cy * cz - sx * sy * sz;
        } else if (order === 'ZYX') {
            out[0] = sx * cy * cz - cx * sy * sz;
            out[1] = cx * sy * cz + sx * cy * sz;
            out[2] = cx * cy * sz - sx * sy * cz;
            out[3] = cx * cy * cz + sx * sy * sz;
        } else if (order === 'YZX') {
            out[0] = sx * cy * cz + cx * sy * sz;
            out[1] = cx * sy * cz + sx * cy * sz;
            out[2] = cx * cy * sz - sx * sy * cz;
            out[3] = cx * cy * cz - sx * sy * sz;
        } else {
            out[0] = sx * cy * cz - cx * sy * sz;
            out[1] = cx * sy * cz - sx * cy * sz;
            out[2] = cx * cy * sz + sx * sy * cz;
            out[3] = cx * cy * cz + sx * sy * sz;
        }
        return this;
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
    mul(q: Quaternion): this {
        return this.multiply(q);
    }
    len(): number {
        return this.length();
    }
    sqrLen(): number {
        return this.squaredLength();
    }
}
export default Quaternion;
