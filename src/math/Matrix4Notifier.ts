import { mat4 } from 'gl-matrix';
import Vector3 from './Vector3';
import Matrix4, { type XYZObject } from './Matrix4';
import Quaternion from './Quaternion';
import { requireNumber } from './numberArray';
import { resolveOperands } from './operands';
let tempMatrix4: Matrix4 | undefined;
const tempVector3 = new Vector3();
/**
 * 4x4 矩阵，具有 onUpdate 回调
 */
class Matrix4Notifier extends Matrix4 {
    /**
     * 类名
     */
    override className = 'Matrix4Notifier';
    isMatrix4Notifier = true;
    /**
     * Creates a new identity mat4
     */
    constructor() {
        super();
        /**
         * 数据
         */
        this.elements = mat4.create();
    }
    /**
     * 更新的回调
     */
    onUpdate(): void {
        // Extension hook for owner objects.
    }
    /**
     * Copy the values from one mat4 to this
     * @param m - the source matrix
     * @returns this
     */
    override copy(m: Matrix4): this {
        mat4.copy(this.elements, m.elements);
        this.onUpdate();
        return this;
    }
    /**
     * 从数组赋值
     * @param array - 数组
     * @param offset - 数组偏移值
     * @returns this
     */
    override fromArray(array: ArrayLike<number>, offset = 0): this {
        const elements = this.elements;
        for (let i = 0; i < 16; i++) {
            elements[i] = requireNumber(array, offset + i);
        }
        this.onUpdate();
        return this;
    }
    /**
     * Set the components of a mat3 to the given values
     * @param m00 -
     * @param m01 -
     * @param m02 -
     * @param m03 -
     * @param m10 -
     * @param m11 -
     * @param m12 -
     * @param m13 -
     * @param m20 -
     * @param m21 -
     * @param m22 -
     * @param m23 -
     * @param m30 -
     * @param m31 -
     * @param m32 -
     * @param m33 -
     * @returns this
     */
    override set(
        m00: number,
        m01: number,
        m02: number,
        m03: number,
        m10: number,
        m11: number,
        m12: number,
        m13: number,
        m20: number,
        m21: number,
        m22: number,
        m23: number,
        m30: number,
        m31: number,
        m32: number,
        m33: number
    ): this {
        mat4.set(
            this.elements,
            m00,
            m01,
            m02,
            m03,
            m10,
            m11,
            m12,
            m13,
            m20,
            m21,
            m22,
            m23,
            m30,
            m31,
            m32,
            m33
        );
        this.onUpdate();
        return this;
    }
    /**
     * Set this to the identity matrix
     * @returns this
     */
    override identity(): this {
        mat4.identity(this.elements);
        this.onUpdate();
        return this;
    }
    /**
     * Transpose the values of this
     * @returns this
     */
    override transpose(): this {
        mat4.transpose(this.elements, this.elements);
        this.onUpdate();
        return this;
    }
    /**
     * invert a matrix
     * @param m -
     * @returns this
     */
    override invert(m: Matrix4 = this): this {
        mat4.invert(this.elements, m.elements);
        this.onUpdate();
        return this;
    }
    /**
     * Calculates the adjugate of a mat4
     * @param m -
     * @returns this
     */
    override adjoint(m: Matrix4 = this): this {
        mat4.adjoint(this.elements, m.elements);
        this.onUpdate();
        return this;
    }
    /**
     * Calculates the determinant of this
     * @returns this
     */
    override determinant(): number {
        return mat4.determinant(this.elements);
    }
    /**
     * Multiplies two matrix4's
     * @param a -
     * @param b - 如果不传，计算 this 和 a 的乘积
     * @returns this
     */
    override multiply(a: Matrix4, b?: Matrix4): this {
        const [left, right] = resolveOperands(this, a, b);
        mat4.multiply(this.elements, left.elements, right.elements);
        this.onUpdate();
        return this;
    }
    /**
     * 左乘
     * @param m -
     * @returns this
     */
    override premultiply(m: Matrix4): this {
        this.multiply(m, this);
        this.onUpdate();
        return this;
    }
    /**
     * Translate this by the given vector
     * @param v - vector to translate by
     * @returns this
     */
    override translate(v: Vector3): this {
        mat4.translate(this.elements, this.elements, v.elements);
        this.onUpdate();
        return this;
    }
    /**
     * Scales the mat3 by the dimensions in the given vec2
     * @param v - the vec3 to scale the matrix by
     * @returns this
     */
    override scale(v: Vector3): this {
        mat4.scale(this.elements, this.elements, v.elements);
        this.onUpdate();
        return this;
    }
    /**
     * Rotates this by the given angle
     * @param rad - the angle to rotate the matrix by
     * @param axis - the axis to rotate around
     * @returns this
     */
    override rotate(rad: number, axis: Vector3): this {
        mat4.rotate(this.elements, this.elements, rad, axis.elements);
        this.onUpdate();
        return this;
    }
    /**
     * Rotates this by the given angle around the X axis
     * @param rad - the angle to rotate the matrix by
     * @returns this
     */
    override rotateX(rad: number): this {
        mat4.rotateX(this.elements, this.elements, rad);
        this.onUpdate();
        return this;
    }
    /**
     * Rotates this by the given angle around the Y axis
     * @param rad - the angle to rotate the matrix by
     * @returns this
     */
    override rotateY(rad: number): this {
        mat4.rotateY(this.elements, this.elements, rad);
        this.onUpdate();
        return this;
    }
    /**
     * Rotates this by the given angle around the Z axis
     * @param rad - the angle to rotate the matrix by
     * @returns this
     */
    override rotateZ(rad: number): this {
        mat4.rotateZ(this.elements, this.elements, rad);
        this.onUpdate();
        return this;
    }
    /**
     * Creates a matrix from a vector translation
     * @param v - Translation vector
     * @returns this
     */
    override fromTranslation(v: Vector3): this {
        mat4.fromTranslation(this.elements, v.elements);
        this.onUpdate();
        return this;
    }
    /**
     * Creates a matrix from a vector scaling
     * @param v - Scaling vector
     * @returns this
     */
    override fromScaling(v: Vector3): this {
        mat4.fromScaling(this.elements, v.elements);
        this.onUpdate();
        return this;
    }
    /**
     * Creates a matrix from a given angle around a given axis
     * @param rad - the angle to rotate the matrix by
     * @param axis - the axis to rotate around
     * @returns this
     */
    override fromRotation(rad: number, axis: Vector3): this {
        mat4.fromRotation(this.elements, rad, axis.elements);
        this.onUpdate();
        return this;
    }
    /**
     * Creates a matrix from the given angle around the X axis
     * @param rad - the angle to rotate the matrix by
     * @returns this
     */
    override fromXRotation(rad: number): this {
        mat4.fromXRotation(this.elements, rad);
        this.onUpdate();
        return this;
    }
    /**
     * Creates a matrix from the given angle around the Y axis
     * @param rad - the angle to rotate the matrix by
     * @returns this
     */
    override fromYRotation(rad: number): this {
        mat4.fromYRotation(this.elements, rad);
        this.onUpdate();
        return this;
    }
    /**
     * Creates a matrix from the given angle around the Z axis
     * @param rad - the angle to rotate the matrix by
     * @returns this
     */
    override fromZRotation(rad: number): this {
        mat4.fromZRotation(this.elements, rad);
        this.onUpdate();
        return this;
    }
    /**
     * Creates a matrix from a quaternion rotation and vector translation
     * @param q - Rotation quaternion
     * @param v - Translation vector
     * @returns this
     */
    override fromRotationTranslation(q: Quaternion, v: Vector3): this {
        mat4.fromRotationTranslation(this.elements, q.elements, v.elements);
        this.onUpdate();
        return this;
    }
    /**
     * Returns the translation vector component of a transformation
     *  matrix. If a matrix is built with fromRotationTranslation,
     *  the returned vector will be the same as the translation vector
     *  originally supplied.
     * @param out - Vector to receive translation component
     * @returns out
     */
    override getTranslation(out: Vector3 = new Vector3()): Vector3 {
        mat4.getTranslation(out.elements, this.elements);
        return out;
    }
    /**
     * Returns the scaling factor component of a transformation
     *  matrix. If a matrix is built with fromRotationTranslationScale
     *  with a normalized Quaternion paramter, the returned vector will be
     *  the same as the scaling vector
     *  originally supplied.
     * @param out - Vector to receive scaling factor component
     * @returns out
     */
    override getScaling(out: Vector3 = new Vector3()): Vector3 {
        mat4.getScaling(out.elements, this.elements);
        return out;
    }
    /**
     * Returns a quaternion representing the rotational component
     *  of a transformation matrix. If a matrix is built with
     *  fromRotationTranslation, the returned quaternion will be the
     *  same as the quaternion originally supplied.
     * @param out - Quaternion to receive the rotation component
     * @returns out
     */
    override getRotation(out: Quaternion = new Quaternion()): Quaternion {
        mat4.getRotation(out.elements, this.elements);
        return out;
    }
    /**
     * Creates a matrix from a quaternion rotation, vector translation and vector scale
     * @param q - Rotation quaternion
     * @param v - Translation vector
     * @param s - Scaling vector
     * @returns this
     */
    override fromRotationTranslationScale(q: Quaternion, v: Vector3, s: Vector3): this {
        mat4.fromRotationTranslationScale(this.elements, q.elements, v.elements, s.elements);
        this.onUpdate();
        return this;
    }
    /**
     * Creates a matrix from a quaternion rotation, vector translation and vector scale, rotating and scaling around the given origin
     * @param q - Rotation quaternion
     * @param v - Translation vector
     * @param s - Scaling vector
     * @param o - The origin vector around which to scale and rotate
     * @param notCallUpdate - notCallUpdate
     * @returns this
     */
    override fromRotationTranslationScaleOrigin(
        q: Quaternion,
        v: Vector3,
        s: Vector3,
        o: Vector3,
        notCallUpdate?: boolean
    ): this {
        mat4.fromRotationTranslationScaleOrigin(
            this.elements,
            q.elements,
            v.elements,
            s.elements,
            o.elements
        );
        if (!notCallUpdate) {
            this.onUpdate();
        }
        return this;
    }
    /**
     * Calculates a 4x4 matrix from the given quaternion
     * @param q - Quaternion to create matrix from
     * @returns this
     */
    override fromQuat(q: Quaternion): this {
        mat4.fromQuat(this.elements, q.elements);
        this.onUpdate();
        return this;
    }
    /**
     * Generates a frustum matrix with the given bounds
     * @param left - Left bound of the frustum
     * @param right - Right bound of the frustum
     * @param bottom - Bottom bound of the frustum
     * @param top - Top bound of the frustum
     * @param near - Near bound of the frustum
     * @param far - Far bound of the frustum
     * @returns this
     */
    override frustum(
        left: number,
        right: number,
        bottom: number,
        top: number,
        near: number,
        far: number
    ): this {
        mat4.frustum(this.elements, left, right, bottom, top, near, far);
        this.onUpdate();
        return this;
    }
    /**
     * Generates a perspective projection matrix with the given bounds
     * @param fovy - Vertical field of view in radians
     * @param aspect - Aspect ratio. typically viewport width/height
     * @param near - Near bound of the frustum
     * @param far - Far bound of the frustum
     * @returns this
     */
    override perspective(fovy: number, aspect: number, near: number, far: number): this {
        mat4.perspective(this.elements, fovy, aspect, near, far);
        this.onUpdate();
        return this;
    }
    /**
     * Generates a perspective projection matrix with the given field of view.
     * @param fov - Object containing the following values: upDegrees, downDegrees, leftDegrees, rightDegrees
     * @param near - Near bound of the frustum
     * @param far - Far bound of the frustum
     * @returns this
     */
    override perspectiveFromFieldOfView(fov: unknown, near: number, far: number): this {
        mat4.perspectiveFromFieldOfView(this.elements, fov, near, far);
        this.onUpdate();
        return this;
    }
    /**
     * Generates a orthogonal projection matrix with the given bounds
     * @param left - Left bound of the frustum
     * @param right - Right bound of the frustum
     * @param bottom - Bottom bound of the frustum
     * @param top - Top bound of the frustum
     * @param near - Near bound of the frustum
     * @param far - Far bound of the frustum
     * @returns this
     */
    override ortho(
        left: number,
        right: number,
        bottom: number,
        top: number,
        near: number,
        far: number
    ): this {
        mat4.ortho(this.elements, left, right, bottom, top, near, far);
        this.onUpdate();
        return this;
    }
    /**
     * Generates a look-at matrix with the given eye position, focal point, and up axis
     * @param eye - Position of the viewer
     * @param center - Point the viewer is looking at
     * @param up - pointing up
     * @returns this
     */
    override lookAt(eye: XYZObject, center: XYZObject, up: Vector3): this {
        super.lookAt(eye, center, up);
        this.onUpdate();
        return this;
    }
    /**
     * Generates a matrix that makes something look at something else.
     * @param eye - Position of the viewer
     * @param target - Point the viewer is looking at
     * @param up - pointing up
     * @returns this
     */
    override targetTo(eye: XYZObject, target: XYZObject, up: Vector3): this {
        super.targetTo(eye, target, up);
        this.onUpdate();
        return this;
    }
    /**
     * Returns Frobenius norm of a mat4
     * @returns Frobenius norm
     */
    override frob(): number {
        return mat4.frob(this.elements);
    }
    /**
     * Adds two mat4's
     * @param a -
     * @param b - 如果不传，计算 this 和 a 的和
     * @returns this
     */
    override add(a: Matrix4, b?: Matrix4): this {
        const [left, right] = resolveOperands(this, a, b);
        mat4.add(this.elements, left.elements, right.elements);
        this.onUpdate();
        return this;
    }
    /**
     * Subtracts matrix b from matrix a
     * @param a -
     * @param b - 如果不传，计算 this 和 a 的差
     * @returns this
     */
    override subtract(a: Matrix4, b?: Matrix4): this {
        const [left, right] = resolveOperands(this, a, b);
        mat4.subtract(this.elements, left.elements, right.elements);
        this.onUpdate();
        return this;
    }
    /**
     * Returns whether or not the matrices have exactly the same elements in the same position (when compared with ===)
     * @param a -
     * @param b - 如果不传，比较 this 和 a 是否相等
     */
    override exactEquals(a: Matrix4, b?: Matrix4): boolean {
        const [left, right] = resolveOperands(this, a, b);
        return mat4.exactEquals(left.elements, right.elements);
    }
    /**
     * Returns whether or not the matrices have approximately the same elements in the same position.
     * @param a -
     * @param b - 如果不传，比较 this 和 a 是否近似相等
     */
    override equals(a: Matrix4, b?: Matrix4): boolean {
        const [left, right] = resolveOperands(this, a, b);
        return mat4.equals(left.elements, right.elements);
    }
    /**
     * compose
     * @param q - quaternion
     * @param v - position
     * @param s - scale
     * @param p - [pivot]
     * @returns this
     */
    override compose(q: Quaternion, v: Vector3, s: Vector3, p?: Vector3): this {
        if (p) {
            this.fromRotationTranslationScaleOrigin(q, v, s, p);
        } else {
            this.fromRotationTranslationScale(q, v, s);
        }
        return this;
    }
    /**
     * decompose
     * @param q - quaternion
     * @param v - position
     * @param s - scale
     * @param p - [pivot]
     * @returns this
     */
    override decompose(q: Quaternion, v: Vector3, s: Vector3, p?: Vector3): this {
        this.getScaling(s);
        this.getTranslation(v);
        tempMatrix4 ??= new Matrix4();
        const det = this.determinant();
        if (det < 0) s.x *= -1;
        tempMatrix4.copy(this);
        tempVector3.inverse(s);
        tempMatrix4.scale(tempVector3);
        q.fromMat4(tempMatrix4);
        if (p) {
            p.set(0, 0, 0);
        }
        return this;
    }
}
export default Matrix4Notifier;
