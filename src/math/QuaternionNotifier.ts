import { quat } from 'gl-matrix';
import Matrix3 from './Matrix3';
import Quaternion from './Quaternion';
import type Euler from './Euler';
import type Matrix4 from './Matrix4';
import type Vector3 from './Vector3';
import { requireNumber, type MutableNumberArray } from './numberArray';
const tempMat3 = new Matrix3();
/**
 * 四元数，具有 onUpdate 回调
 */
class QuaternionNotifier extends Quaternion {
    /**
     * 类名
     */
    override className = 'QuaternionNotifier';
    isQuaternionNotifier = true;
    override isQuaternion = true;
    /**
     * Creates a new identity quat
     * @param x - X component
     * @param y - Y component
     * @param z - Z component
     * @param w - W component
     */
    constructor(x = 0, y = 0, z = 0, w = 1) {
        super(x, y, z, w);
        /**
         * 数据
         */
        this.elements = quat.fromValues(x, y, z, w);
    }
    /**
     * 更新的回调
     */
    onUpdate(): void {
        // Extension hook for owner objects.
    }
    /**
     * Copy the values from one quat to this
     * @param q -
     * @returns this
     */
    override copy(
        q: Quaternion /**
         * Copy the values from one quat to this
         * @param q -
         * @returns this
         */
    ): this {
        quat.copy(this.elements, q.elements);
        this.onUpdate();
        return this;
    }
    /**
     * Creates a new quat initialized with values from an existing quaternion
     * @returns a new quaternion
     */
    override clone(): Quaternion {
        const el = this.elements;
        return new QuaternionNotifier(el[0], el[1], el[2], el[3]);
    }
    /**
     * 转换到数组
     * @param array - 数组
     * @param offset - 数组偏移值
     */
    override toArray(array: MutableNumberArray = [], offset = 0): MutableNumberArray {
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
    override fromArray(array: ArrayLike<number>, offset = 0): this {
        const el = this.elements;
        el[0] = requireNumber(array, offset);
        el[1] = requireNumber(array, offset + 1);
        el[2] = requireNumber(array, offset + 2);
        el[3] = requireNumber(array, offset + 3);
        this.onUpdate();
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
    override set(x: number, y: number, z: number, w: number): this {
        quat.set(this.elements, x, y, z, w);
        this.onUpdate();
        return this;
    }
    /**
     * Set this to the identity quaternion
     * @returns this
     */
    override identity(): this {
        quat.identity(this.elements);
        this.onUpdate();
        return this;
    }
    /**
     * Sets a quaternion to represent the shortest rotation from one
     * vector to another.
     * @param a - the initial vector
     * @param b - the destination vector
     * @returns this
     */
    override rotationTo(a: Vector3, b: Vector3): this {
        quat.rotationTo(this.elements, a.elements, b.elements);
        this.onUpdate();
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
    override setAxes(view: Vector3, right: Vector3, up: Vector3): this {
        quat.setAxes(this.elements, view.elements, right.elements, up.elements);
        this.onUpdate();
        return this;
    }
    /**
     * Sets a quat from the given angle and rotation axis,
     * then returns it.
     * @param axis - the axis around which to rotate
     * @param rad - the angle in radians
     * @returns this
     */
    override setAxisAngle(axis: Vector3, rad: number): this {
        quat.setAxisAngle(this.elements, axis.elements, rad);
        this.onUpdate();
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
    override getAxisAngle(axis: Vector3): number {
        return quat.getAxisAngle(axis.elements, this.elements);
    }
    /**
     * Adds two quat's
     * @param q -
     * @returns this
     */
    override add(q: Quaternion): this {
        quat.add(this.elements, this.elements, q.elements);
        this.onUpdate();
        return this;
    }
    /**
     * Multiplies two quat's
     * @param q -
     * @returns this
     */
    override multiply(q: Quaternion): this {
        quat.multiply(this.elements, this.elements, q.elements);
        this.onUpdate();
        return this;
    }
    /**
     * premultiply the quat
     * @param q -
     * @returns this
     */
    override premultiply(q: Quaternion): this {
        quat.multiply(this.elements, q.elements, this.elements);
        this.onUpdate();
        return this;
    }
    /**
     * Scales a quat by a scalar number
     * @param scale - the vector to scale
     * @returns this
     */
    override scale(scale: number): this {
        quat.scale(this.elements, this.elements, scale);
        this.onUpdate();
        return this;
    }
    /**
     * Rotates a quaternion by the given angle about the X axis
     * @param rad - angle (in radians) to rotate
     * @returns this
     */
    override rotateX(rad: number): this {
        quat.rotateX(this.elements, this.elements, rad);
        this.onUpdate();
        return this;
    }
    /**
     * Rotates a quaternion by the given angle about the Y axis
     * @param rad - angle (in radians) to rotate
     * @returns this
     */
    override rotateY(rad: number): this {
        quat.rotateY(this.elements, this.elements, rad);
        this.onUpdate();
        return this;
    }
    /**
     * Rotates a quaternion by the given angle about the Z axis
     * @param rad - angle (in radians) to rotate
     * @returns this
     */
    override rotateZ(rad: number): this {
        quat.rotateZ(this.elements, this.elements, rad);
        this.onUpdate();
        return this;
    }
    /**
     * Calculates the W component of a quat from the X, Y, and Z components.
     * Assumes that quaternion is 1 unit in length.
     * Any existing W component will be ignored.
     * @returns this
     */
    override calculateW(): this {
        quat.calculateW(this.elements, this.elements);
        this.onUpdate();
        return this;
    }
    /**
     * Calculates the dot product of two quat's
     * @param q -
     * @returns dot product of two quat's
     */
    override dot(q: Quaternion): number {
        return quat.dot(this.elements, q.elements);
    }
    /**
     * Performs a linear interpolation between two quat's
     * @param q -
     * @param t - interpolation amount between the two inputs
     * @returns this
     */
    override lerp(q: Quaternion, t: number): this {
        quat.lerp(this.elements, this.elements, q.elements, t);
        this.onUpdate();
        return this;
    }
    /**
     * Performs a spherical linear interpolation between two quat
     * @param q -
     * @param t - interpolation amount between the two inputs
     * @returns this
     */
    override slerp(q: Quaternion, t: number): this {
        quat.slerp(this.elements, this.elements, q.elements, t);
        this.onUpdate();
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
    override sqlerp(
        qa: Quaternion,
        qb: Quaternion,
        qc: Quaternion,
        qd: Quaternion,
        t: number
    ): this {
        quat.sqlerp(this.elements, qa.elements, qb.elements, qc.elements, qd.elements, t);
        this.onUpdate();
        return this;
    }
    /**
     * Calculates the inverse of a quat
     * @returns this
     */
    override invert(): this {
        quat.invert(this.elements, this.elements);
        this.onUpdate();
        return this;
    }
    /**
     * Calculates the conjugate of a quat
     * If the quaternion is normalized, this function is faster than quat.inverse and produces the same result.
     * @returns this
     */
    override conjugate(): this {
        quat.conjugate(this.elements, this.elements);
        this.onUpdate();
        return this;
    }
    /**
     * Calculates the length of a quat
     * @returns length of this
     */
    override length(): number {
        return quat.length(this.elements);
    }
    /**
     * Calculates the squared length of a quat
     * @returns squared length of this
     */
    override squaredLength(): number {
        return quat.squaredLength(this.elements);
    }
    /**
     * Normalize this
     * @returns this
     */
    override normalize(): this {
        quat.normalize(this.elements, this.elements);
        this.onUpdate();
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
    override fromMat3(mat: Matrix3): this {
        quat.fromMat3(this.elements, mat.elements);
        this.onUpdate();
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
    override fromMat4(mat: Matrix4): this {
        tempMat3.fromMat4(mat);
        this.fromMat3(tempMat3);
        return this;
    }
    /**
     * Returns whether or not the quaternions have exactly the same elements in the same position (when compared with ===)
     * @param q -
     */
    override exactEquals(q: Quaternion): boolean {
        return quat.exactEquals(this.elements, q.elements);
    }
    /**
     * Returns whether or not the quaternions have approximately the same elements in the same position.
     * @param q -
     */
    override equals(q: Quaternion): boolean {
        return quat.equals(this.elements, q.elements);
    }
    /**
     * Creates a quaternion from the given euler.
     * @param euler -
     * @param notCallUpdate - 是否需要调用onUpdate
     * @returns this
     */
    override fromEuler(euler: Euler, notCallUpdate?: boolean): this {
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
        if (!notCallUpdate) {
            this.onUpdate();
        }
        return this;
    }
    /**
     * X component
     */
    override get x(): number {
        return this.elements[0];
    }
    /**
     * X component
     */
    override set x(value: number) {
        this.elements[0] = value;
        this.onUpdate();
    }
    /**
     * Y component
     */
    override get y(): number {
        return this.elements[1];
    }
    /**
     * Y component
     */
    override set y(value: number) {
        this.elements[1] = value;
        this.onUpdate();
    }
    /**
     * Z component
     */
    override get z(): number {
        return this.elements[2];
    }
    /**
     * Z component
     */
    override set z(value: number) {
        this.elements[2] = value;
        this.onUpdate();
    }
    /**
     * W component
     */
    override get w(): number {
        return this.elements[3];
    }
    /**
     * W component
     */
    override set w(value: number) {
        this.elements[3] = value;
        this.onUpdate();
    }
}
export default QuaternionNotifier;
