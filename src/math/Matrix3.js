import {
    mat3
} from 'gl-matrix';
import Class from '../core/Class';

/**
 * 3x3 矩阵
 * @class
 */
const Matrix3 = Class.create(/** @lends Matrix3.prototype */ {
    /**
     * 类名
     * @type {String}
     * @default Matrix3
     */
    className: 'Matrix3',
    /**
     * @type {Boolean}
     * @default true
     */
    isMatrix3: true,
    /**
     * Creates a new identity mat3
     * @constructs
     */
    constructor() {
        /**
         * 数据
         * @type {Float32Array}
         */
        this.elements = mat3.create();
    },
    /**
     * Copy the values from one mat3 to this
     * @param  {Matrix3} m the source matrix
     * @return {Matrix3} this
     */
    copy(m) {
        mat3.copy(this.elements, m.elements);
        return this;
    },
    /**
     * Creates a new mat3 initialized with values from this matrix
     * @return {Matrix3} a new Matrix3
     */
    clone() {
        const m = new this.constructor();
        mat3.copy(m.elements, this.elements);
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
        for (let i = 0; i < 9; i++) {
            array[offset + i] = elements[i];
        }
        return array;
    },
    /**
     * 从数组赋值
     * @param  {Array} array  数组
     * @param  {Number} [offset=0] 数组偏移值
     * @return {Matrix3} this
     */
    fromArray(array, offset = 0) {
        const elements = this.elements;
        for (let i = 0; i < 9; i++) {
            elements[i] = array[offset + i];
        }
        return this;
    },
    /**
     * Set the components of a mat3 to the given values
     * @param {Number} m00
     * @param {Number} m01
     * @param {Number} m02
     * @param {Number} m10
     * @param {Number} m11
     * @param {Number} m12
     * @param {Number} m20
     * @param {Number} m21
     * @param {Number} m22
     * @return {Matrix3} this
     */
    set(m00, m01, m02, m10, m11, m12, m20, m21, m22) {
        mat3.set(this.elements, m00, m01, m02, m10, m11, m12, m20, m21, m22);
        return this;
    },
    /**
     * Set this to the identity matrix
     * @return {Matrix3} this
     */
    identity() {
        mat3.identity(this.elements);
        return this;
    },
    /**
     * Transpose the values of this
     * @return {Matrix3} this
     */
    transpose() {
        mat3.transpose(this.elements, this.elements);
        return this;
    },
    /**
     * invert a matrix
     * @param  {Matrix3} [m = this]
     * @return {Matrix3} this
     */
    invert(m = this) {
        mat3.invert(this.elements, m.elements);
        return this;
    },
    /**
     * Calculates the adjugate of a mat3
     * @param  {Matrix3} [m=this]
     * @return {Matrix3} this
     */
    adjoint(m = this) {
        mat3.adjoint(this.elements, m.elements);
        return this;
    },
    /**
     * Calculates the determinant of this
     * @return {Number}
     */
    determinant() {
        return mat3.determinant(this.elements);
    },
    /**
     * Multiplies two matrix3's
     * @param  {Matrix3} a
     * @param  {Matrix3} [b] 如果不传，计算 this 和 a 的乘积
     * @return {Matrix3} this
     */
    multiply(a, b) {
        if (!b) {
            b = a;
            a = this;
        }
        mat3.multiply(this.elements, a.elements, b.elements);
        return this;
    },
    /**
     * 左乘
     * @param  {Matrix3} m
     * @return {Matrix3}  this
     */
    premultiply(m) {
        this.multiply(m, this);
        return this;
    },
    /**
     * Translate this by the given vector
     * @param  {Vector2} v vector to translate by
     * @return {Matrix3} this
     */
    translate(v) {
        mat3.translate(this.elements, this.elements, v.elements);
        return this;
    },
    /**
     * Rotates this by the given angle
     * @param  {Number} rad the angle to rotate the matrix by
     * @return {Matrix3} this
     */
    rotate(rad) {
        mat3.rotate(this.elements, this.elements, rad);
        return this;
    },
    /**
     * Scales the mat3 by the dimensions in the given vec2
     * @param  {Vector2} v the vec2 to scale the matrix by
     * @return {Matrix3} this
     */
    scale(v) {
        mat3.scale(this.elements, this.elements, v.elements);
        return this;
    },
    /**
     * Creates a matrix from a vector translation
     * @param  {Vector2} v Translation vector
     * @return {Matrix3} this
     */
    fromTranslation(v) {
        mat3.fromTranslation(this.elements, v.elements);
        return this;
    },
    /**
     * Creates a matrix from a given angle
     * @param  {Number} rad the angle to rotate the matrix by
     * @return {Matrix3} this
     */
    fromRotation(rad) {
        mat3.fromRotation(this.elements, rad);
        return this;
    },
    /**
     * Creates a matrix from a vector scaling
     * @param  {Vector2} v Scaling vector
     * @return {Matrix3} this
     */
    fromScaling(v) {
        mat3.fromScaling(this.elements, v.elements);
        return this;
    },
    /**
     * Calculates a 3x3 matrix from the given quaternion
     * @param  {Quaternion} q Quaternion to create matrix from
     * @return {Matrix3} this
     */
    fromQuat(q) {
        mat3.fromQuat(this.elements, q.elements);
        return this;
    },
    /**
     * Calculates a 3x3 normal matrix (transpose inverse) from the 4x4 matrix
     * @param  {Matrix4} m Mat4 to derive the normal matrix from
     * @return {Matrix3} this
     */
    normalFromMat4(m) {
        mat3.normalFromMat4(this.elements, m.elements);
        return this;
    },
    /**
     * Copies the upper-left 3x3 values into the given mat3.
     * @param  {Matrix4} m the source 4x4 matrix
     * @return {Matrix3} this
     */
    fromMat4(m) {
        mat3.fromMat4(this.elements, m.elements);
        return this;
    },
    /**
     * Returns Frobenius norm of this
     * @return {Number} Frobenius norm
     */
    frob() {
        return mat3.frob(this.elements);
    },
    /**
     * Adds two mat3's
     * @param {Matrix3} a
     * @param {Matrix3} [b] 如果不传，计算 this 和 a 的和
     * @return {Marix4} this
     */
    add(a, b) {
        if (!b) {
            b = a;
            a = this;
        }
        mat3.add(this.elements, a.elements, b.elements);
        return this;
    },
    /**
     * Subtracts matrix b from matrix a
     * @param {Matrix3} a
     * @param {Matrix3} [b] 如果不传，计算 this 和 a 的差
     * @return {Marix4} this
     */
    subtract(a, b) {
        if (!b) {
            b = a;
            a = this;
        }
        mat3.subtract(this.elements, a.elements, b.elements);
        return this;
    },
    /**
     * Returns whether or not the matrices have exactly the same elements in the same position (when compared with ===)
     * @param {Matrix3} a
     * @param {Matrix3} [b] 如果不传，比较 this 和 a 是否相等
     * @return {Boolean}
     */
    exactEquals(a, b) {
        if (!b) {
            b = a;
            a = this;
        }
        return mat3.exactEquals(a.elements, b.elements);
    },
    /**
     * Returns whether or not the matrices have approximately the same elements in the same position.
     * @param {Matrix3} a
     * @param {Matrix3} [b] 如果不传，比较 this 和 a 是否近似相等
     * @return {Boolean}
     */
    equals(a, b) {
        if (!b) {
            b = a;
            a = this;
        }
        return mat3.equals(a.elements, b.elements);
    },

    /**
     * fromRotationTranslationScale
     * @param  {Number} r rad angle
     * @param  {Number} x
     * @param  {Number} y
     * @param  {Number} scaleX
     * @param  {Number} scaleY
     * @return {Matrix3}
     */
    fromRotationTranslationScale(rotation, x, y, scaleX, scaleY) {
        const cos = Math.cos(rotation);
        const sin = Math.sin(rotation);

        this.set(scaleX * cos, -scaleY * sin, 0, scaleX * sin, scaleY * cos, 0, x, y, 1);
        return this;
    }
});

/**
 * Alias for {@link Matrix3#subtract}
 * @function
 */
Matrix3.prototype.sub = Matrix3.prototype.subtract;

/**
 * Alias for {@link Matrix3#multiply}
 * @function
 */
Matrix3.prototype.mul = Matrix3.prototype.multiply;

export default Matrix3;
