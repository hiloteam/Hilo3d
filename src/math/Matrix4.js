import {
    mat4
} from 'gl-matrix';
import Class from '../core/Class';
import Vector3 from './Vector3';
import Quaternion from './Quaternion';

let tempMatrix4;
const tempVector3 = new Vector3();
const tempVector32 = new Vector3();

/**
 * 4x4 矩阵
 * @class
 */
const Matrix4 = Class.create(/** @lends Matrix4.prototype */ {
    /**
     * 类名
     * @type {String}
     * @default Matrix4
     */
    className: 'Matrix4',
    /**
     * @type {Boolean}
     * @default true
     */
    isMatrix4: true,
    /**
     * Creates a new identity mat4
     * @constructs
     */
    constructor() {
        /**
         * 数据
         * @type {Float32Array}
         */
        this.elements = mat4.create();
    },
    /**
     * Copy the values from one mat4 to this
     * @param  {Matrix4} m the source matrix
     * @return {Matrix4} this
     */
    copy(m) {
        mat4.copy(this.elements, m.elements);
        return this;
    },
    /**
     * Creates a new mat4 initialized with values from this matrix
     * @return {Matrix4} a new Matrix4
     */
    clone() {
        const m = new this.constructor();
        mat4.copy(m.elements, this.elements);
        return m;
    },
    /**
     * 转换到数组
     * @param  {Array}  [array=[]] 数组
     * @param  {Number} [offset=0] 数组偏移值
     * @return {Array}
     */
    toArray(array = [], offset = 0) {
        const elements = this.elements;
        for (let i = 0; i < 16; i++) {
            array[offset + i] = elements[i];
        }
        return array;
    },
    /**
     * 从数组赋值
     * @param  {Array} array  数组
     * @param  {Number} [offset=0] 数组偏移值
     * @return {Matrix4} this
     */
    fromArray(array, offset = 0) {
        const elements = this.elements;
        for (let i = 0; i < 16; i++) {
            elements[i] = array[offset + i];
        }
        return this;
    },
    /**
     * Set the components of a mat3 to the given values
     * @param {Number} m00
     * @param {Number} m01
     * @param {Number} m02
     * @param {Number} m03
     * @param {Number} m10
     * @param {Number} m11
     * @param {Number} m12
     * @param {Number} m13
     * @param {Number} m20
     * @param {Number} m21
     * @param {Number} m22
     * @param {Number} m23
     * @param {Number} m30
     * @param {Number} m31
     * @param {Number} m32
     * @param {Number} m33
     * @return {Matrix4} this
     */
    set(m00, m01, m02, m03, m10, m11, m12, m13, m20, m21, m22, m23, m30, m31, m32, m33) {
        mat4.set(this.elements, m00, m01, m02, m03, m10, m11, m12, m13, m20, m21, m22, m23, m30, m31, m32, m33);
        return this;
    },
    /**
     * Set this to the identity matrix
     * @return {Matrix4} this
     */
    identity() {
        mat4.identity(this.elements);
        return this;
    },
    /**
     * Transpose the values of this
     * @return {Matrix4} this
     */
    transpose() {
        mat4.transpose(this.elements, this.elements);
        return this;
    },
    /**
     * invert a matrix
     * @param {Matrix4} [m=this]
     * @return {Matrix4} this
     */
    invert(m = this) {
        mat4.invert(this.elements, m.elements);
        return this;
    },
    /**
     * Calculates the adjugate of a mat4
     * @param {Matrix4} [m=this]
     * @return {Matrix4} this
     */
    adjoint(m = this) {
        mat4.adjoint(this.elements, m.elements);
        return this;
    },
    /**
     * Calculates the determinant of this
     * @return {Matrix4} this
     */
    determinant() {
        return mat4.determinant(this.elements);
    },
    /**
     * Multiplies two matrix4's
     * @param {Matrix4} a
     * @param {Matrix4} [b] 如果不传，计算 this 和 a 的乘积
     * @return {Matrix4} this
     */
    multiply(a, b) {
        if (!b) {
            b = a;
            a = this;
        }
        mat4.multiply(this.elements, a.elements, b.elements);
        return this;
    },
    /**
     * 左乘
     * @param {Matrix4} m
     * @return {Matrix4} this
     */
    premultiply(m) {
        this.multiply(m, this);
        return this;
    },
    /**
     * Translate this by the given vector
     * @param {Vector3} v vector to translate by
     * @return {Matrix4} this
     */
    translate(v) {
        mat4.translate(this.elements, this.elements, v.elements);
        return this;
    },
    /**
     * Scales the mat3 by the dimensions in the given vec2
     * @param {Vector3} v the vec3 to scale the matrix by
     * @return {Matrix4} this
     */
    scale(v) {
        mat4.scale(this.elements, this.elements, v.elements);
        return this;
    },
    /**
     * Rotates this by the given angle
     * @param {Number} rad the angle to rotate the matrix by
     * @param {Vector3} axis the axis to rotate around
     * @return {Matrix4} this
     */
    rotate(rad, axis) {
        mat4.rotate(this.elements, this.elements, rad, axis.elements);
        return this;
    },
    /**
     * Rotates this by the given angle around the X axis
     * @param {Number} rad the angle to rotate the matrix by
     * @return {Matrix4} this
     */
    rotateX(rad) {
        mat4.rotateX(this.elements, this.elements, rad);
        return this;
    },
    /**
     * Rotates this by the given angle around the Y axis
     * @param {Number} rad the angle to rotate the matrix by
     * @return {Matrix4} this
     */
    rotateY(rad) {
        mat4.rotateY(this.elements, this.elements, rad);
        return this;
    },
    /**
     * Rotates this by the given angle around the Z axis
     * @param {Number} rad the angle to rotate the matrix by
     * @return {Matrix4} this
     */
    rotateZ(rad) {
        mat4.rotateZ(this.elements, this.elements, rad);
        return this;
    },
    /**
     * Creates a matrix from a vector translation
     * @param {Vector3} transition Translation vector
     * @return {Matrix4} this
     */
    fromTranslation(v) {
        mat4.fromTranslation(this.elements, v.elements);
        return this;
    },
    /**
     * Creates a matrix from a vector scaling
     * @param  {Vector3} v Scaling vector
     * @return {Matrix4} this
     */
    fromScaling(v) {
        mat4.fromScaling(this.elements, v.elements);
        return this;
    },
    /**
     * Creates a matrix from a given angle around a given axis
     * @param {Number} rad the angle to rotate the matrix by
     * @param {Vector3} axis the axis to rotate around
     * @return {Matrix4} this
     */
    fromRotation(rad, axis) {
        mat4.fromRotation(this.elements, rad, axis.elements);
        return this;
    },
    /**
     * Creates a matrix from the given angle around the X axis
     * @param {Number} rad the angle to rotate the matrix by
     * @return {Matrix4} this
     */
    fromXRotation(rad) {
        mat4.fromXRotation(this.elements, rad);
        return this;
    },
    /**
     * Creates a matrix from the given angle around the Y axis
     * @param {Number} rad the angle to rotate the matrix by
     * @return {Matrix4} this
     */
    fromYRotation(rad) {
        mat4.fromYRotation(this.elements, rad);
        return this;
    },
    /**
     * Creates a matrix from the given angle around the Z axis
     * @param {Number} rad the angle to rotate the matrix by
     * @return {Matrix4} this
     */
    fromZRotation(rad) {
        mat4.fromZRotation(this.elements, rad);
        return this;
    },
    /**
     * Creates a matrix from a quaternion rotation and vector translation
     * @param  {Quaternion} q Rotation quaternion
     * @param  {Vector3} v Translation vector
     * @return {Matrix4} this
     */
    fromRotationTranslation(q, v) {
        mat4.fromRotationTranslation(this.elements, q.elements, v.elements);
        return this;
    },
    /**
     * Returns the translation vector component of a transformation
     *  matrix. If a matrix is built with fromRotationTranslation,
     *  the returned vector will be the same as the translation vector
     *  originally supplied.
     * @param  {Vector3} [out=new Vector3] Vector to receive translation component
     * @return {Vector3} out
     */
    getTranslation(out = new Vector3()) {
        mat4.getTranslation(out.elements, this.elements);
        return out;
    },
    /**
     * Returns the scaling factor component of a transformation
     *  matrix. If a matrix is built with fromRotationTranslationScale
     *  with a normalized Quaternion paramter, the returned vector will be
     *  the same as the scaling vector
     *  originally supplied.
     * @param  {Vector3} [out=new Vector3] Vector to receive scaling factor component
     * @return {Vector3} out
     */
    getScaling(out = new Vector3()) {
        mat4.getScaling(out.elements, this.elements);
        return out;
    },
    /**
     * Returns a quaternion representing the rotational component
     *  of a transformation matrix. If a matrix is built with
     *  fromRotationTranslation, the returned quaternion will be the
     *  same as the quaternion originally supplied.
     * @param {Quaternion} out Quaternion to receive the rotation component
     * @return {Quaternion} out
     */
    getRotation(out = new Quaternion()) {
        mat4.getRotation(out.elements, this.elements);
        return out;
    },
    /**
     * Creates a matrix from a quaternion rotation, vector translation and vector scale
     * @param  {Quaternion} q Rotation quaternion
     * @param  {Vector3} v Translation vector
     * @param  {Vector3} s Scaling vector
     * @return {Matrix4} this
     */
    fromRotationTranslationScale(q, v, s) {
        mat4.fromRotationTranslationScale(this.elements, q.elements, v.elements, s.elements);
        return this;
    },
    /**
     * Creates a matrix from a quaternion rotation, vector translation and vector scale, rotating and scaling around the given origin
     * @param  {Quaternion} q Rotation quaternion
     * @param  {Vector3} v Translation vector
     * @param  {Vector3} s Scaling vector
     * @param  {Vector3} o The origin vector around which to scale and rotate
     * @return {Matrix4} this
     */
    fromRotationTranslationScaleOrigin(q, v, s, o) {
        mat4.fromRotationTranslationScaleOrigin(this.elements, q.elements, v.elements, s.elements, o.elements);
        return this;
    },
    /**
     * Calculates a 4x4 matrix from the given quaternion
     * @param {Quaternion} q Quaternion to create matrix from
     * @return {Matrix4} this
     */
    fromQuat(q) {
        mat4.fromQuat(this.elements, q.elements);
        return this;
    },
    /**
     * Generates a frustum matrix with the given bounds
     * @param  {Number} left  Left bound of the frustum
     * @param  {Number} right Right bound of the frustum
     * @param  {Number} bottom Bottom bound of the frustum
     * @param  {Number} top Top bound of the frustum
     * @param  {Number} near Near bound of the frustum
     * @param  {Number} far Far bound of the frustum
     * @return {Matrix4} this
     */
    frustum(left, right, bottom, top, near, far) {
        mat4.frustum(this.elements, left, right, bottom, top, near, far);
        return this;
    },
    /**
     * Generates a perspective projection matrix with the given bounds
     * @param {Number} fovy Vertical field of view in radians
     * @param {Number} aspect Aspect ratio. typically viewport width/height
     * @param {Number} near Near bound of the frustum
     * @param {Number} far Far bound of the frustum
     * @return {Matrix4} this
     */
    perspective(fovy, aspect, near, far) {
        mat4.perspective(this.elements, fovy, aspect, near, far);
        return this;
    },
    /**
     * Generates a perspective projection matrix with the given field of view.
     * @param  {Object} fov Object containing the following values: upDegrees, downDegrees, leftDegrees, rightDegrees
     * @param  {Number} Near bound of the frustum
     * @param  {Number} far Far bound of the frustum
     * @return {Matrix4} this
     */
    perspectiveFromFieldOfView(fov, near, far) {
        mat4.perspectiveFromFieldOfView(this.elements, fov, near, far);
        return this;
    },
    /**
     * Generates a orthogonal projection matrix with the given bounds
     * @param  {Number} left  Left bound of the frustum
     * @param  {Number} right Right bound of the frustum
     * @param  {Number} bottom Bottom bound of the frustum
     * @param  {Number} top Top bound of the frustum
     * @param  {Number} near Near bound of the frustum
     * @param  {Number} far Far bound of the frustum
     * @return {Matrix4} this
     */
    ortho(left, right, bottom, top, near, far) {
        mat4.ortho(this.elements, left, right, bottom, top, near, far);
        return this;
    },
    /**
     * Generates a look-at matrix with the given eye position, focal point, and up axis
     * @param  {XYZObject} eye Position of the viewer
     * @param  {XYZObject} center Point the viewer is looking at
     * @param  {Vector3} up pointing up
     * @return {Matrix4} this
     */
    lookAt(eye, center, up) {
        if (!eye.isVector3) {
            eye = tempVector3.set(eye.x, eye.y, eye.z);
        }
        if (!center.isVector3) {
            center = tempVector32.set(center.x, center.y, center.z);
        }

        mat4.lookAt(this.elements, eye.elements, center.elements, up.elements);

        return this;
    },
    /**
     * Generates a matrix that makes something look at something else.
     * @param  {XYZObject} eye Position of the viewer
     * @param  {XYZObject} Point the viewer is looking at
     * @param  {Vector3} up pointing up
     * @return {Matrix4} this
     */
    targetTo(eye, target, up) {
        if (!eye.isVector3) {
            eye = tempVector3.set(eye.x, eye.y, eye.z);
        }
        if (!target.isVector3) {
            target = tempVector32.set(target.x, target.y, target.z);
        }

        // mat4.targetTo(this.elements, eye.elements, target.elements, up.elements);
        eye = eye.elements;
        target = target.elements;
        up = up.elements;
        const out = this.elements;

        let eyex = eye[0];
        let eyey = eye[1];
        let eyez = eye[2];
        let upx = up[0];
        let upy = up[1];
        let upz = up[2];

        let z0 = eyex - target[0];
        let z1 = eyey - target[1];
        let z2 = eyez - target[2];

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
    },
    /**
     * Returns Frobenius norm of a mat4
     * @return {Number} Frobenius norm
     */
    frob() {
        return mat4.frob(this.elements);
    },
    /**
     * Adds two mat4's
     * @param {Matrix4} a
     * @param {Matrix4} [b] 如果不传，计算 this 和 a 的和
     * @return {Marix4} this
     */
    add(a, b) {
        if (!b) {
            b = a;
            a = this;
        }
        mat4.add(this.elements, a.elements, b.elements);
        return this;
    },
    /**
     * Subtracts matrix b from matrix a
     * @param {Matrix4} a
     * @param {Matrix4} [b]  如果不传，计算 this 和 a 的差
     * @return {Marix4} this
     */
    subtract(a, b) {
        if (!b) {
            b = a;
            a = this;
        }
        mat4.subtract(this.elements, a.elements, b.elements);
        return this;
    },
    /**
     * Returns whether or not the matrices have exactly the same elements in the same position (when compared with ===)
     * @param {Matrix4} a
     * @param {Matrix4} [b] 如果不传，比较 this 和 a 是否相等
     * @return {Boolean}
     */
    exactEquals(a, b) {
        if (!b) {
            b = a;
            a = this;
        }
        return mat4.exactEquals(a.elements, b.elements);
    },
    /**
     * Returns whether or not the matrices have approximately the same elements in the same position.
     * @param {Matrix4} a
     * @param {Matrix4} [b] 如果不传，比较 this 和 a 是否近似相等
     * @return {Boolean}
     */
    equals(a, b) {
        if (!b) {
            b = a;
            a = this;
        }
        return mat4.equals(a.elements, b.elements);
    },
    /**
     * compose
     * @param  {Quaternion} q quaternion
     * @param  {Vector3} v position
     * @param  {Vector3} s scale
     * @param  {Vector3} p [pivot]
     * @return {Matrix4}  this
     */
    compose(q, v, s, p) {
        if (p) {
            this.fromRotationTranslationScaleOrigin(q, v, s, p);
        } else {
            this.fromRotationTranslationScale(q, v, s);
        }
        return this;
    },
    /**
     * decompose
     * @param  {Quaternion} q quaternion
     * @param  {Vector3} v position
     * @param  {Vector3} s scale
     * @param  {Vector3} p [pivot]
     * @return {Matrix4}  this
     */
    decompose(q, v, s, p) {
        this.getScaling(s);
        this.getTranslation(v);

        if (!tempMatrix4) {
            tempMatrix4 = new Matrix4();
        }

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
});

/**
 * Alias for {@link Matrix4#subtract}
 * @function
 */
Matrix4.prototype.sub = Matrix4.prototype.subtract;

/**
 * Alias for {@link Matrix4#multiply}
 * @function
 */
Matrix4.prototype.mul = Matrix4.prototype.multiply;

export default Matrix4;

/**
 * 含x, y, z属性的对象
 * @typedef {object} XYZObject
 * @property {Number} x
 * @property {Number} y
 * @property {Number} z
 */
