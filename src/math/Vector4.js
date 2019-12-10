import { vec4 } from 'gl-matrix';
import Class from '../core/Class';

/**
 * 四维向量
 * @class
 */
const Vector4 = Class.create(/** @lends Vector4.prototype */ {
    /**
     * 类名
     * @type {String}
     * @default Vector4
     */
    className: 'Vector4',
    /**
     * @type {Boolean}
     * @default true
     */
    isVector4: true,
    /**
     * Creates a new empty vec4
     * @param {Number} [x=0] X component
     * @param {Number} [y=0] Y component
     * @param {Number} [z=0] Z component
     * @param {Number} [w=0] W component
     * @constructs
     */
    constructor(x = 0, y = 0, z = 0, w = 0) {
        /**
         * 数据
         * @type {Float32Array}
         */
        this.elements = vec4.fromValues(x, y, z, w);
    },
    /**
     * Copy the values from one vec4 to this
     * @param  {Vector4} m the source vector
     * @return {Vector4} this
     */
    copy(v) {
        vec4.copy(this.elements, v.elements);
        return this;
    },
    /**
     * Creates a new vec4 initialized with values from this vector
     * @return {Vector4} a new Vector4
     */
    clone() {
        const elements = this.elements;
        return new this.constructor(elements[0], elements[1], elements[2], elements[3]);
    },
    /**
     * 转换到数组
     * @param  {Array}  [array=[]] 数组
     * @param  {Number} [offset=0] 数组偏移值
     * @return {Array}
     */
    toArray(array = [], offset = 0) {
        const elements = this.elements;
        array[0 + offset] = elements[0];
        array[1 + offset] = elements[1];
        array[2 + offset] = elements[2];
        array[3 + offset] = elements[3];
        return array;
    },
    /**
     * 从数组赋值
     * @param  {Array} array  数组
     * @param  {Number} [offset=0] 数组偏移值
     * @return {Vector4} this
     */
    fromArray(array, offset = 0) {
        const elements = this.elements;
        elements[0] = array[offset + 0];
        elements[1] = array[offset + 1];
        elements[2] = array[offset + 2];
        elements[3] = array[offset + 3];
        return this;
    },
    /**
     * Set the components of a vec4 to the given values
     * @param {Number} x X component
     * @param {Number} y Y component
     * @param {Number} z Z component
     * @param {Number} w W component
     * @returns {Vector4} this
     */
    set(x, y, z, w) {
        vec4.set(this.elements, x, y, z, w);
        return this;
    },
    /**
     * Adds two vec4's
     * @param {Vector4} a
     * @param {Vector4} [b] 如果不传，计算 this 和 a 的和
     * @returns {Vector4} this
     */
    add(a, b) {
        if (!b) {
            b = a;
            a = this;
        }
        vec4.add(this.elements, a.elements, b.elements);
        return this;
    },
    /**
     * Subtracts vector b from vector a
     * @param {Vector4} a
     * @param {Vector4} [b] 如果不传，计算 this 和 a 的差
     * @returns {Vector4} this
     */
    subtract(a, b) {
        if (!b) {
            b = a;
            a = this;
        }
        vec4.subtract(this.elements, a.elements, b.elements);
        return this;
    },
    /**
     * Multiplies two vec4's
     * @param {Vector4} a
     * @param {Vector4} [b] 如果不传，计算 this 和 a 的积
     * @returns {Vector4} this
     */
    multiply(a, b) {
        if (!b) {
            b = a;
            a = this;
        }
        vec4.multiply(this.elements, a.elements, b.elements);
        return this;
    },
    /**
     * Divides two vec4's
     * @param {Vector4} a
     * @param {Vector4} [b] 如果不传，计算 this 和 a 的商
     * @returns {Vector4} this
     */
    divide(a, b) {
        if (!b) {
            b = a;
            a = this;
        }
        vec4.divide(this.elements, a.elements, b.elements);
        return this;
    },
    /**
     * Math.ceil the components of this
     * @returns {Vector4} this
     */
    ceil() {
        vec4.ceil(this.elements, this.elements);
        return this;
    },
    /**
     * Math.floor the components of this
     * @returns {Vector4} this
     */
    floor() {
        vec4.floor(this.elements, this.elements);
        return this;
    },
    /**
     * Returns the minimum of two vec4's
     * @param  {Vector4} a
     * @param  {Vector4} [b] 如果不传，计算 this 和 a 的结果
     * @returns {Vector4} this
     */
    min(a, b) {
        if (!b) {
            b = a;
            a = this;
        }
        vec4.min(this.elements, a.elements, b.elements);
        return this;
    },
    /**
     * Returns the maximum of two vec4's
     * @param  {Vector4} a
     * @param  {Vector4} [b]  如果不传，计算 this 和 a 的结果
     * @returns {Vector4} this
     */
    max(a, b) {
        if (!b) {
            b = a;
            a = this;
        }
        vec4.max(this.elements, a.elements, b.elements);
        return this;
    },
    /**
     * Math.round the components of this
     * @returns {Vector4} this
     */
    round() {
        vec4.round(this.elements, this.elements);
        return this;
    },
    /**
     * Scales this by a scalar number
     * @param  {Number} scale amount to scale the vector by
     * @returns {Vector4} this
     */
    scale(scale) {
        vec4.scale(this.elements, this.elements, scale);
        return this;
    },
    /**
     * Adds two vec4's after scaling the second vector by a scalar value
     * @param  {Number} scale the amount to scale the second vector by before adding
     * @param  {Vector4} a
     * @param  {Vector4} [b] 如果不传，计算 this 和 a 的结果
     * @returns {Vector4} this
     */
    scaleAndAdd(scale, a, b) {
        if (!b) {
            b = a;
            a = this;
        }
        vec4.scaleAndAdd(this.elements, a.elements, b.elements, scale);
        return this;
    },
    /**
     * Calculates the euclidian distance between two vec4's
     * @param  {Vector4} a
     * @param  {Vector4} [b] 如果不传，计算 this 和 a 的结果
     * @return {Number} distance between a and b
     */
    distance(a, b) {
        if (!b) {
            b = a;
            a = this;
        }
        return vec4.distance(a.elements, b.elements);
    },
    /**
     * Calculates the squared euclidian distance between two vec4's
     * @param  {Vector4} a
     * @param  {Vector4} [b] 如果不传，计算 this 和 a 的结果
     * @return {Number} squared distance between a and b
     */
    squaredDistance(a, b) {
        if (!b) {
            b = a;
            a = this;
        }
        return vec4.squaredDistance(a.elements, b.elements);
    },
    /**
     * Calculates the length of this
     * @return {Number} length of this
     */
    length() {
        return vec4.length(this.elements);
    },
    /**
     * Calculates the squared length of this
     * @return {Number} squared length of this
     */
    squaredLength() {
        return vec4.squaredLength(this.elements);
    },
    /**
     * Negates the components of this
     * @returns {Vector4} this
     */
    negate() {
        vec4.negate(this.elements, this.elements);
        return this;
    },
    /**
     * Returns the inverse of the components of a vec4
     * @param  {Vector4} [a=this]
     * @returns {Vector4} this
     */
    inverse(a) {
        if (!a) {
            a = this;
        }
        vec4.inverse(this.elements, a.elements);
        return this;
    },
    /**
     * Normalize this
     * @returns {Vector4} this
     */
    normalize() {
        vec4.normalize(this.elements, this.elements);
        return this;
    },
    /**
     * Calculates the dot product of two vec4's
     * @param  {Vector4} a
     * @param  {Vector4} [b] 如果不传，计算 this 和 a 的结果
     * @return {Number}  product of a and b
     */
    dot(a, b) {
        if (!b) {
            b = a;
            a = this;
        }
        return vec4.dot(a.elements, b.elements);
    },
    /**
     * Performs a linear interpolation between two vec4's
     * @param  {Vector4} v
     * @param  {Number} t interpolation amount between the two vectors
     * @returns {Vector4} this
     */
    lerp(v, t) {
        vec4.lerp(this.elements, this.elements, v.elements, t);
        return this;
    },
    /**
     * Generates a random vector with the given scale
     * @param  {Number} [scale=1] Length of the resulting vector. If ommitted, a unit vector will be returned
     * @returns {Vector4} this
     */
    random(scale) {
        scale = scale || 1;
        this.elements[0] = Math.random();
        this.elements[1] = Math.random();
        this.elements[2] = Math.random();
        this.elements[3] = Math.random();
        this.normalize();
        this.scale(scale);
        return this;
    },
    /**
     * Transforms the vec4 with a mat4
     * @param  {Matrix4} m matrix to transform with
     * @returns {Vector4} this
     */
    transformMat4(m) {
        vec4.transformMat4(this.elements, this.elements, m.elements);
        return this;
    },
    /**
     * Transforms the vec4 with a quat
     * @param  {Quaternion} q quaternion to transform with
     * @returns {Vector4} this
     */
    transformQuat(q) {
        vec4.transformQuat(this.elements, this.elements, q.elements);
        return this;
    },
    /**
     * Returns whether or not the vectors have exactly the same elements in the same position (when compared with ===)
     * @param  {Vector4} a
     * @param  {Vector4} [b] 如果不传，计算 this 和 a 的结果
     * @return {Boolean} True if the vectors are equal, false otherwise.
     */
    exactEquals(a, b) {
        if (!b) {
            b = a;
            a = this;
        }
        return vec4.exactEquals(a.elements, b.elements);
    },
    /**
     * Returns whether or not the vectors have approximately the same elements in the same position.
     * @param  {Vector4} a
     * @param  {Vector4} [b] 如果不传，计算 this 和 a 的结果
     * @return {Boolean} True if the vectors are equal, false otherwise.
     */
    equals(a, b) {
        if (!b) {
            b = a;
            a = this;
        }
        return vec4.equals(a.elements, b.elements);
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
 * Alias for {@link Vector4#subtract}
 * @function
 */
Vector4.prototype.sub = Vector4.prototype.subtract;

/**
 * Alias for {@link Vector4#multiply}
 * @function
 */
Vector4.prototype.mul = Vector4.prototype.multiply;

/**
 * Alias for {@link Vector4#divide}
 * @function
 */
Vector4.prototype.div = Vector4.prototype.divide;

/**
 * Alias for {@link Vector4#distance}
 * @function
 */
Vector4.prototype.dist = Vector4.prototype.distance;

/**
 * Alias for {@link Vector4#squaredDistance}
 * @function
 */
Vector4.prototype.sqrDist = Vector4.prototype.squaredDistance;

/**
 * Alias for {@link Vector4#length}
 * @function
 */
Vector4.prototype.len = Vector4.prototype.length;

/**
 * Alias for {@link Vector4#squaredLength}
 * @function
 */
Vector4.prototype.sqrLen = Vector4.prototype.squaredLength;

export default Vector4;
