import {
    quat
} from 'gl-matrix';
import Matrix3 from './Matrix3';
import Class from '../core/Class';

const tempMat3 = new Matrix3();

/**
 * @class
 */
const Quaternion = Class.create(/** @lends Quaternion.prototype */ {
    /**
     * 类名
     * @type {String}
     * @default Quaternion
     */
    className: 'Quaternion',
    /**
     * @type {Boolean}
     * @default true
     */
    isQuaternion: true,
    /**
     * Creates a new identity quat
     * @constructs
     * @param  {Number} [x=0] X component
     * @param  {Number} [y=0] Y component
     * @param  {Number} [z=0] Z component
     * @param  {Number} [w=1] W component
     */
    constructor(x = 0, y = 0, z = 0, w = 1) {
        /**
         * 数据
         * @type {Float32Array}
         */
        this.elements = quat.fromValues(x, y, z, w);
    },

    /**
     * Copy the values from one quat to this
     * @param  {Quaternion} q
     * @return {Quaternion} this
     */
    copy(q) {
        quat.copy(this.elements, q.elements);
        return this;
    },
    /**
     * Creates a new quat initialized with values from an existing quaternion
     * @return {Quaternion} a new quaternion
     */
    clone() {
        const el = this.elements;
        return new this.constructor(el[0], el[1], el[2], el[3]);
    },

    /**
     * 转换到数组
     * @param  {number[]|TypedArray}  [array=[]] 数组
     * @param  {Number} [offset=0] 数组偏移值
     * @return {Array}
     */
    toArray(array = [], offset = 0) {
        const el = this.elements;

        array[offset] = el[0];
        array[offset + 1] = el[1];
        array[offset + 2] = el[2];
        array[offset + 3] = el[3];

        return array;
    },
    /**
     * 从数组赋值
     * @param  {number[]|TypedArray} array  数组
     * @param  {Number} [offset=0] 数组偏移值
     * @return {Quaternion} this
     */
    fromArray(array, offset = 0) {
        const el = this.elements;

        el[0] = array[offset];
        el[1] = array[offset + 1];
        el[2] = array[offset + 2];
        el[3] = array[offset + 3];

        return this;
    },

    /**
     * Set the components of a quat to the given values
     * @param {Number} x  X component
     * @param {Number} y  Y component
     * @param {Number} z  Z component
     * @param {Number} w  W component
     * @return {Quaternion} this
     */
    set(x, y, z, w) {
        quat.set(this.elements, x, y, z, w);
        return this;
    },

    /**
     * Set this to the identity quaternion
     * @return {Quaternion} this
     */
    identity() {
        quat.identity(this.elements);
        return this;
    },
    /**
     * Sets a quaternion to represent the shortest rotation from one
     * vector to another.
     * @param  {Vector3} a the initial vector
     * @param  {Vector3} b the destination vector
     * @return {Quaternion} this
     */
    rotationTo(a, b) {
        quat.rotationTo(this.elements, a.elements, b.elements);
        return this;
    },
    /**
     * Sets the specified quaternion with values corresponding to the given
     * axes. Each axis is a vec3 and is expected to be unit length and
     * perpendicular to all other specified axes.
     *
     * @param {Vector3} view  the vector representing the viewing direction
     * @param {Vector3} right the vector representing the local "right" direction
     * @param {Vector3} up    the vector representing the local "up" direction
     * @return {Quaternion} this
     */
    setAxes(view, right, up) {
        quat.setAxes(this.elements, view.elements, right.elements, up.elements);
        return this;
    },
    /**
     * Sets a quat from the given angle and rotation axis,
     * then returns it.
     * @param {Vector3} axis the axis around which to rotate
     * @param {Number} rad the angle in radians
     * @return {Quaternion} this
     */
    setAxisAngle(axis, rad) {
        quat.setAxisAngle(this.elements, axis.elements, rad);
        return this;
    },
    /**
     * Gets the rotation axis and angle for a given
     *  quaternion. If a quaternion is created with
     *  setAxisAngle, this method will return the same
     *  values as providied in the original parameter list
     *  OR functionally equivalent values.
     * Example: The quaternion formed by axis [0, 0, 1] and
     *  angle -90 is the same as the quaternion formed by
     *  [0, 0, 1] and 270. This method favors the latter.
     * @param  {Vector3} out_axis  Vector receiving the axis of rotation
     * @return {Number} Angle, in radians, of the rotation
     */
    getAxisAngle(axis) {
        return quat.getAxisAngle(axis.elements, this.elements);
    },
    /**
     * Adds two quat's
     * @param {Quaternion} q
     * @return {Quaternion} this
     */
    add(q) {
        quat.add(this.elements, this.elements, q.elements);
        return this;
    },
    /**
     * Multiplies two quat's
     * @param  {Quaternion} q
     * @return {Quaternion} this
     */
    multiply(q) {
        quat.multiply(this.elements, this.elements, q.elements);
        return this;
    },
    /**
     * premultiply the quat
     * @param  {Quaternion} q
     * @return {Quaternion} this
     */
    premultiply(q) {
        quat.multiply(this.elements, q.elements, this.elements);
        return this;
    },
    /**
     * Scales a quat by a scalar number
     * @param  {Vector3} scale the vector to scale
     * @return {Quaternion} this
     */
    scale(scale) {
        quat.scale(this.elements, this.elements, scale);
        return this;
    },
    /**
     * Rotates a quaternion by the given angle about the X axis
     * @param  {Number} rad angle (in radians) to rotate
     * @return {Quaternion} this
     */
    rotateX(rad) {
        quat.rotateX(this.elements, this.elements, rad);
        return this;
    },
    /**
     * Rotates a quaternion by the given angle about the Y axis
     * @param  {Number} rad angle (in radians) to rotate
     * @return {Quaternion} this
     */
    rotateY(rad) {
        quat.rotateY(this.elements, this.elements, rad);
        return this;
    },
    /**
     * Rotates a quaternion by the given angle about the Z axis
     * @param  {Number} rad angle (in radians) to rotate
     * @return {Quaternion} this
     */
    rotateZ(rad) {
        quat.rotateZ(this.elements, this.elements, rad);
        return this;
    },
    /**
     * Calculates the W component of a quat from the X, Y, and Z components.
     * Assumes that quaternion is 1 unit in length.
     * Any existing W component will be ignored.
     * @returns {Quaternion} this
     */
    calculateW() {
        quat.calculateW(this.elements, this.elements);
        return this;
    },
    /**
     * Calculates the dot product of two quat's
     * @param  {Quaternion} q
     * @return {Number} dot product of two quat's
     */
    dot(q) {
        return quat.dot(this.elements, q.elements);
    },
    /**
     * Performs a linear interpolation between two quat's
     * @param  {Quaternion} q
     * @param  {Number} t interpolation amount between the two inputs
     * @return {Quaternion} this
     */
    lerp(q, t) {
        quat.lerp(this.elements, this.elements, q.elements, t);
        return this;
    },
    /**
     * Performs a spherical linear interpolation between two quat
     * @param  {Quaternion} q
     * @param  {Number} t interpolation amount between the two inputs
     * @return {Quaternion} this
     */
    slerp(q, t) {
        quat.slerp(this.elements, this.elements, q.elements, t);
        return this;
    },
    /**
     * Performs a spherical linear interpolation with two control points
     * @param  {Quaternion} qa
     * @param  {Quaternion} qb
     * @param  {Quaternion} qc
     * @param  {Quaternion} qd
     * @param  {Number} t interpolation amount
     * @return {Quaternion} this
     */
    sqlerp(qa, qb, qc, qd, t) {
        quat.sqlerp(this.elements, qa.elements, qb.elements, qc.elements, qd.elements, t);
        return this;
    },
    /**
     * Calculates the inverse of a quat
     * @return {Quaternion} this
     */
    invert() {
        quat.invert(this.elements, this.elements);
        return this;
    },
    /**
     * Calculates the conjugate of a quat
     * If the quaternion is normalized, this function is faster than quat.inverse and produces the same result.
     * @return {Quaternion} this
     */
    conjugate() {
        quat.conjugate(this.elements, this.elements);
        return this;
    },
    /**
     * Calculates the length of a quat
     * @return {Number} length of this
     */
    length() {
        return quat.length(this.elements);
    },
    /**
     * Calculates the squared length of a quat
     * @return {Number} squared length of this
     */
    squaredLength() {
        return quat.squaredLength(this.elements);
    },
    /**
     * Normalize this
     * @return {Quaternion} this
     */
    normalize() {
        quat.normalize(this.elements, this.elements);
        return this;
    },
    /**
     * Creates a quaternion from the given 3x3 rotation matrix.
     *
     * NOTE: The resultant quaternion is not normalized, so you should be sure
     * to renormalize the quaternion yourself where necessary.
     *
     * @param {Matrix3} m rotation matrix
     * @return {Quaternion} this
     */
    fromMat3(mat) {
        quat.fromMat3(this.elements, mat.elements);
        return this;
    },
    /**
     * Creates a quaternion from the given 3x3 rotation matrix.
     *
     * NOTE: The resultant quaternion is not normalized, so you should be sure
     * to renormalize the quaternion yourself where necessary.
     *
     * @param {Matrix4} m rotation matrix
     * @return {Quaternion} this
     */
    fromMat4(mat) {
        tempMat3.fromMat4(mat);
        this.fromMat3(tempMat3);
        return this;
    },
    /**
     * Returns whether or not the quaternions have exactly the same elements in the same position (when compared with ===)
     * @param  {Quaternion} q
     * @return {Boolean}
     */
    exactEquals(q) {
        return quat.exactEquals(this.elements, q.elements);
    },
    /**
     * Returns whether or not the quaternions have approximately the same elements in the same position.
     * @param  {Quaternion} q
     * @return {Boolean}
     */
    equals(q) {
        return quat.equals(this.elements, q.elements);
    },
    /**
     * Creates a quaternion from the given euler.
     * @param  {Euler} euler
     * @return {Quaternion} this
     */
    fromEuler(euler) {
        // Based on https://github.com/mrdoob/three.js/blob/dev/src/math/Quaternion.js#L200

        // quat.fromEuler(this.elements, euler.x, euler.y, euler.z);
        const x = euler.x * .5;
        const y = euler.y * .5;
        const z = euler.z * .5;
        const order = euler.order || 'ZYX';

        let sx = Math.sin(x);
        let cx = Math.cos(x);
        let sy = Math.sin(y);
        let cy = Math.cos(y);
        let sz = Math.sin(z);
        let cz = Math.cos(z);

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
        } else if (order === 'XZY') {
            out[0] = sx * cy * cz - cx * sy * sz;
            out[1] = cx * sy * cz - sx * cy * sz;
            out[2] = cx * cy * sz + sx * sy * cz;
            out[3] = cx * cy * cz + sx * sy * sz;
        }

        return this;
    },
    /**
     * X component
     * @type {Number}
     */
    x: {
        get() {
            return this.elements[0];
        },
        set(value) {
            this.elements[0] = value;
        }
    },
    /**
     * Y component
     * @type {Number}
     */
    y: {
        get() {
            return this.elements[1];
        },
        set(value) {
            this.elements[1] = value;
        }
    },
    /**
     * Z component
     * @type {Number}
     */
    z: {
        get() {
            return this.elements[2];
        },
        set(value) {
            this.elements[2] = value;
        }
    },
    /**
     * W component
     * @type {Number}
     */
    w: {
        get() {
            return this.elements[3];
        },
        set(value) {
            this.elements[3] = value;
        }
    }
});

/**
 * Alias for {@link Quaternion#multiply}
 * @function
 * @param  {Quaternion} q
 */
Quaternion.prototype.mul = Quaternion.prototype.multiply;

/**
 * Alias for {@link Quaternion#length}
 * @function
 */
Quaternion.prototype.len = Quaternion.prototype.length;

/**
 * Alias for {@link Quaternion#squaredLength}
 * @function
 */
Quaternion.prototype.sqrLen = Quaternion.prototype.squaredLength;

export default Quaternion;
