import { mat4 } from 'gl-matrix';
import Vector3 from './Vector3';
import Quaternion from './Quaternion';
import { requireNumber, type MutableNumberArray } from './numberArray';
import { resolveOperands } from './operands';
let tempMatrix4: Matrix4 | undefined;
const tempVector3 = new Vector3();
const tempVector32 = new Vector3();
export interface XYZObject {
    x: number;
    y: number;
    z: number;
}
/**
 * 4x4 矩阵
 */
class Matrix4 {
    elements: mat4;
    /**
     * 类名
     */
    className = 'Matrix4';
    isMatrix4 = true;
    /**
     * Creates a new identity mat4
     */
    constructor() {
        /**
         * 数据
         */
        this.elements = mat4.create();
    }
    /**
     * Copy the values from one mat4 to this
     * @param m - the source matrix
     * @returns this
     */
    copy(m: Matrix4): this {
        mat4.copy(this.elements, m.elements);
        return this;
    }
    /**
     * Creates a new mat4 initialized with values from this matrix
     * @returns a new Matrix4
     */
    clone(): Matrix4 {
        const m = new Matrix4();
        mat4.copy(m.elements, this.elements);
        return m;
    }
    /**
     * 转换到数组
     * @param array - 数组
     * @param offset - 数组偏移值
     */
    toArray(array: MutableNumberArray = [], offset = 0): MutableNumberArray {
        const elements = this.elements;
        for (let i = 0; i < 16; i++) {
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
        for (let i = 0; i < 16; i++) {
            elements[i] = requireNumber(array, offset + i);
        }
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
    set(
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
        return this;
    }
    /**
     * Set this to the identity matrix
     * @returns this
     */
    identity(): this {
        mat4.identity(this.elements);
        return this;
    }
    /**
     * Transpose the values of this
     * @returns this
     */
    transpose(): this {
        mat4.transpose(this.elements, this.elements);
        return this;
    }
    /**
     * invert a matrix
     * @param m -
     * @returns this
     */
    invert(m: Matrix4 = this): this {
        mat4.invert(this.elements, m.elements);
        return this;
    }
    /**
     * Calculates the adjugate of a mat4
     * @param m -
     * @returns this
     */
    adjoint(m: Matrix4 = this): this {
        mat4.adjoint(this.elements, m.elements);
        return this;
    }
    /**
     * Calculates the determinant of this
     * @returns this
     */
    determinant(): number {
        return mat4.determinant(this.elements);
    }
    /**
     * Multiplies two matrix4's
     * @param a -
     * @param b - 如果不传，计算 this 和 a 的乘积
     * @returns this
     */
    multiply(a: Matrix4, b?: Matrix4): this {
        const [left, right] = resolveOperands(this, a, b);
        mat4.multiply(this.elements, left.elements, right.elements);
        return this;
    }
    /**
     * 左乘
     * @param m -
     * @returns this
     */
    premultiply(m: Matrix4): this {
        this.multiply(m, this);
        return this;
    }
    /**
     * Translate this by the given vector
     * @param v - vector to translate by
     * @returns this
     */
    translate(v: Vector3): this {
        mat4.translate(this.elements, this.elements, v.elements);
        return this;
    }
    /**
     * Scales the mat3 by the dimensions in the given vec2
     * @param v - the vec3 to scale the matrix by
     * @returns this
     */
    scale(v: Vector3): this {
        mat4.scale(this.elements, this.elements, v.elements);
        return this;
    }
    /**
     * Rotates this by the given angle
     * @param rad - the angle to rotate the matrix by
     * @param axis - the axis to rotate around
     * @returns this
     */
    rotate(rad: number, axis: Vector3): this {
        mat4.rotate(this.elements, this.elements, rad, axis.elements);
        return this;
    }
    /**
     * Rotates this by the given angle around the X axis
     * @param rad - the angle to rotate the matrix by
     * @returns this
     */
    rotateX(rad: number): this {
        mat4.rotateX(this.elements, this.elements, rad);
        return this;
    }
    /**
     * Rotates this by the given angle around the Y axis
     * @param rad - the angle to rotate the matrix by
     * @returns this
     */
    rotateY(rad: number): this {
        mat4.rotateY(this.elements, this.elements, rad);
        return this;
    }
    /**
     * Rotates this by the given angle around the Z axis
     * @param rad - the angle to rotate the matrix by
     * @returns this
     */
    rotateZ(rad: number): this {
        mat4.rotateZ(this.elements, this.elements, rad);
        return this;
    }
    /**
     * Creates a matrix from a vector translation
     * @param v - Translation vector
     * @returns this
     */
    fromTranslation(v: Vector3): this {
        mat4.fromTranslation(this.elements, v.elements);
        return this;
    }
    /**
     * Creates a matrix from a vector scaling
     * @param v - Scaling vector
     * @returns this
     */
    fromScaling(v: Vector3): this {
        mat4.fromScaling(this.elements, v.elements);
        return this;
    }
    /**
     * Creates a matrix from a given angle around a given axis
     * @param rad - the angle to rotate the matrix by
     * @param axis - the axis to rotate around
     * @returns this
     */
    fromRotation(rad: number, axis: Vector3): this {
        mat4.fromRotation(this.elements, rad, axis.elements);
        return this;
    }
    /**
     * Creates a matrix from the given angle around the X axis
     * @param rad - the angle to rotate the matrix by
     * @returns this
     */
    fromXRotation(rad: number): this {
        mat4.fromXRotation(this.elements, rad);
        return this;
    }
    /**
     * Creates a matrix from the given angle around the Y axis
     * @param rad - the angle to rotate the matrix by
     * @returns this
     */
    fromYRotation(rad: number): this {
        mat4.fromYRotation(this.elements, rad);
        return this;
    }
    /**
     * Creates a matrix from the given angle around the Z axis
     * @param rad - the angle to rotate the matrix by
     * @returns this
     */
    fromZRotation(rad: number): this {
        mat4.fromZRotation(this.elements, rad);
        return this;
    }
    /**
     * Creates a matrix from a quaternion rotation and vector translation
     * @param q - Rotation quaternion
     * @param v - Translation vector
     * @returns this
     */
    fromRotationTranslation(q: Quaternion, v: Vector3): this {
        mat4.fromRotationTranslation(this.elements, q.elements, v.elements);
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
    getTranslation(out: Vector3 = new Vector3()): Vector3 {
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
    getScaling(out: Vector3 = new Vector3()): Vector3 {
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
    getRotation(out: Quaternion = new Quaternion()): Quaternion {
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
    fromRotationTranslationScale(q: Quaternion, v: Vector3, s: Vector3): this {
        mat4.fromRotationTranslationScale(this.elements, q.elements, v.elements, s.elements);
        return this;
    }
    /**
     * Creates a matrix from a quaternion rotation, vector translation and vector scale, rotating and scaling around the given origin
     * @param q - Rotation quaternion
     * @param v - Translation vector
     * @param s - Scaling vector
     * @param o - The origin vector around which to scale and rotate
     * @returns this
     */
    fromRotationTranslationScaleOrigin(q: Quaternion, v: Vector3, s: Vector3, o: Vector3): this {
        mat4.fromRotationTranslationScaleOrigin(
            this.elements,
            q.elements,
            v.elements,
            s.elements,
            o.elements
        );
        return this;
    }
    /**
     * Calculates a 4x4 matrix from the given quaternion
     * @param q - Quaternion to create matrix from
     * @returns this
     */
    fromQuat(q: Quaternion): this {
        mat4.fromQuat(this.elements, q.elements);
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
    frustum(
        left: number,
        right: number,
        bottom: number,
        top: number,
        near: number,
        far: number
    ): this {
        mat4.frustum(this.elements, left, right, bottom, top, near, far);
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
    perspective(fovy: number, aspect: number, near: number, far: number): this {
        mat4.perspective(this.elements, fovy, aspect, near, far);
        return this;
    }
    /**
     * Generates a perspective projection matrix with the given field of view.
     * @param fov - Object containing the following values: upDegrees, downDegrees, leftDegrees, rightDegrees
     * @param near - Near bound of the frustum
     * @param far - Far bound of the frustum
     * @returns this
     */
    perspectiveFromFieldOfView(fov: unknown, near: number, far: number): this {
        mat4.perspectiveFromFieldOfView(this.elements, fov, near, far);
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
    ortho(
        left: number,
        right: number,
        bottom: number,
        top: number,
        near: number,
        far: number
    ): this {
        mat4.ortho(this.elements, left, right, bottom, top, near, far);
        return this;
    }
    /**
     * Generates a look-at matrix with the given eye position, focal point, and up axis
     * @param eye - Position of the viewer
     * @param center - Point the viewer is looking at
     * @param up - pointing up
     * @returns this
     */
    lookAt(eye: XYZObject, center: XYZObject, up: Vector3): this {
        const eyeElements = tempVector3.set(eye.x, eye.y, eye.z).elements;
        const centerElements = tempVector32.set(center.x, center.y, center.z).elements;
        mat4.lookAt(this.elements, eyeElements, centerElements, up.elements);
        return this;
    }
    /**
     * Generates a matrix that makes something look at something else.
     * @param eye - Position of the viewer
     * @param target - Point the viewer is looking at
     * @param up - pointing up
     * @returns this
     */
    targetTo(eye: XYZObject, target: XYZObject, up: Vector3): this {
        // mat4.targetTo(this.elements, eye.elements, target.elements, up.elements);
        const eyeElements = tempVector3.set(eye.x, eye.y, eye.z).elements;
        const targetElements = tempVector32.set(target.x, target.y, target.z).elements;
        const upElements = up.elements;
        const out = this.elements;
        const eyex = eyeElements[0];
        const eyey = eyeElements[1];
        const eyez = eyeElements[2];
        let upx = upElements[0];
        const upy = upElements[1];
        const upz = upElements[2];
        let z0 = eyex - targetElements[0];
        let z1 = eyey - targetElements[1];
        let z2 = eyez - targetElements[2];
        let len = z0 * z0 + z1 * z1 + z2 * z2;
        if (len > 0) {
            len = 1 / Math.sqrt(len);
            z0 *= len;
            z1 *= len;
            z2 *= len;
        } else {
            z2 = 1;
        }
        let x0 = upy * z2 - upz * z1;
        let x1 = upz * z0 - upx * z2;
        let x2 = upx * z1 - upy * z0;
        len = x0 * x0 + x1 * x1 + x2 * x2;
        if (len > 0) {
            len = 1 / Math.sqrt(len);
            x0 *= len;
            x1 *= len;
            x2 *= len;
        } else {
            upx += 0.0000001;
            x0 = upy * z2 - upz * z1;
            x1 = upz * z0 - upx * z2;
            x2 = upx * z1 - upy * z0;
            len = x0 * x0 + x1 * x1 + x2 * x2;
            len = 1 / Math.sqrt(len);
            x0 *= len;
            x1 *= len;
            x2 *= len;
        }
        out[0] = x0;
        out[1] = x1;
        out[2] = x2;
        out[3] = 0;
        out[4] = z1 * x2 - z2 * x1;
        out[5] = z2 * x0 - z0 * x2;
        out[6] = z0 * x1 - z1 * x0;
        out[7] = 0;
        out[8] = z0;
        out[9] = z1;
        out[10] = z2;
        out[11] = 0;
        out[12] = eyex;
        out[13] = eyey;
        out[14] = eyez;
        out[15] = 1;
        return this;
    }
    /**
     * Returns Frobenius norm of a mat4
     * @returns Frobenius norm
     */
    frob(): number {
        return mat4.frob(this.elements);
    }
    /**
     * Adds two mat4's
     * @param a -
     * @param b - 如果不传，计算 this 和 a 的和
     * @returns this
     */
    add(a: Matrix4, b?: Matrix4): this {
        const [left, right] = resolveOperands(this, a, b);
        mat4.add(this.elements, left.elements, right.elements);
        return this;
    }
    /**
     * Subtracts matrix b from matrix a
     * @param a -
     * @param b - 如果不传，计算 this 和 a 的差
     * @returns this
     */
    subtract(a: Matrix4, b?: Matrix4): this {
        const [left, right] = resolveOperands(this, a, b);
        mat4.subtract(this.elements, left.elements, right.elements);
        return this;
    }
    /**
     * Returns whether or not the matrices have exactly the same elements in the same position (when compared with ===)
     * @param a -
     * @param b - 如果不传，比较 this 和 a 是否相等
     */
    exactEquals(a: Matrix4, b?: Matrix4): boolean {
        const [left, right] = resolveOperands(this, a, b);
        return mat4.exactEquals(left.elements, right.elements);
    }
    /**
     * Returns whether or not the matrices have approximately the same elements in the same position.
     * @param a -
     * @param b - 如果不传，比较 this 和 a 是否近似相等
     */
    equals(a: Matrix4, b?: Matrix4): boolean {
        const [left, right] = resolveOperands(this, a, b);
        return mat4.equals(left.elements, right.elements);
    }
    /**
     * compose
     * @param q - quaternion
     * @param v - position
     * @param s - scale
     * @param p - pivot
     * @returns this
     */
    compose(q: Quaternion, v: Vector3, s: Vector3, p?: Vector3): this {
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
    decompose(q: Quaternion, v: Vector3, s: Vector3, p?: Vector3): this {
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
    sub(a: Matrix4, b?: Matrix4): this {
        return this.subtract(a, b);
    }
    mul(a: Matrix4, b?: Matrix4): this {
        return this.multiply(a, b);
    }
}
export default Matrix4;
