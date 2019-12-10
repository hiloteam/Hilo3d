import {
    vec3
} from 'gl-matrix';
import Class from '../core/Class';


/**
 * 三维向量
 * @class
 */
const Vector3 = Class.create(/** @lends Vector3.prototype */ {
    /**
     * 类名
     * @type {String}
     * @default Vector3
     */
    className: 'Vector3',
    /**
     * @type {Boolean}
     * @default true
     */
    isVector3: true,
    /**
     * Creates a new empty vec3
     * @param {Number} [x=0] X component
     * @param {Number} [y=0] Y component
     * @param {Number} [z=0] Z component
     * @constructs
     */
    constructor(x = 0, y = 0, z = 0) {
        /**
         * 数据
         * @type {Float32Array}
         */
        this.elements = vec3.fromValues(x, y, z);
    },
    /**
     * Copy the values from one vec3 to this
     * @param  {Vector3} m the source vector
     * @return {Vector3} this
     */
    copy(v) {
        vec3.copy(this.elements, v.elements);
        return this;
    },
    /**
     * Creates a new vec3 initialized with values from this vec3
     * @return {Vector3} a new Vector3
     */
    clone() {
        const elements = this.elements;
        return new this.constructor(elements[0], elements[1], elements[2]);
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
        return array;
    },
    /**
     * 从数组赋值
     * @param  {Array} array  数组
     * @param  {Number} [offset=0] 数组偏移值
     * @return {Vector3} this
     */
    fromArray(array, offset = 0) {
        const elements = this.elements;
        elements[0] = array[offset + 0];
        elements[1] = array[offset + 1];
        elements[2] = array[offset + 2];
        return this;
    },
    /**
     * Set the components of a vec3 to the given values
     * @param {Number} x X component
     * @param {Number} y Y component
     * @param {Number} z Z component
     * @returns {Vector3} this
     */
    set(x, y, z) {
        vec3.set(this.elements, x, y, z);
        return this;
    },
    /**
     * Adds two vec3's
     * @param {Vector3} a
     * @param {Vector3} [b] 如果不传，计算 this 和 a 的和
     * @returns {Vector3} this
     */
    add(a, b) {
        if (!b) {
            b = a;
            a = this;
        }
        vec3.add(this.elements, a.elements, b.elements);
        return this;
    },
    /**
     * Subtracts vector b from vector a
     * @param {Vector3} a
     * @param {Vector3} [b] 如果不传，计算 this 和 a 的差
     * @returns {Vector3} this
     */
    subtract(a, b) {
        if (!b) {
            b = a;
            a = this;
        }
        vec3.subtract(this.elements, a.elements, b.elements);
        return this;
    },
    /**
     * Multiplies two vec3's
     * @param {Vector3} a
     * @param {Vector3} [b] 如果不传，计算 this 和 a 的积
     * @returns {Vector3} this
     */
    multiply(a, b) {
        if (!b) {
            b = a;
            a = this;
        }
        vec3.multiply(this.elements, a.elements, b.elements);
        return this;
    },
    /**
     * Divides two vec3's
     * @param {Vector3} a
     * @param {Vector3} [b] 如果不传，计算 this 和 a 的商
     * @returns {Vector3} this
     */
    divide(a, b) {
        if (!b) {
            b = a;
            a = this;
        }
        vec3.divide(this.elements, a.elements, b.elements);
        return this;
    },
    /**
     * Math.ceil the components of this
     * @returns {Vector3} this
     */
    ceil() {
        vec3.ceil(this.elements, this.elements);
        return this;
    },
    /**
     * Math.floor the components of this
     * @returns {Vector3} this
     */
    floor() {
        vec3.floor(this.elements, this.elements);
        return this;
    },
    /**
     * Returns the minimum of two vec3's
     * @param  {Vector3} a
     * @param  {Vector3} [b] 如果不传，计算 this 和 a 的结果
     * @returns {Vector3} this
     */
    min(a, b) {
        if (!b) {
            b = a;
            a = this;
        }
        vec3.min(this.elements, a.elements, b.elements);
        return this;
    },
    /**
     * Returns the maximum of two vec3's
     * @param  {Vector3} a
     * @param  {Vector3} [b]  如果不传，计算 this 和 a 的结果
     * @returns {Vector3} this
     */
    max(a, b) {
        if (!b) {
            b = a;
            a = this;
        }
        vec3.max(this.elements, a.elements, b.elements);
        return this;
    },
    /**
     * Math.round the components of this
     * @returns {Vector3} this
     */
    round() {
        vec3.round(this.elements, this.elements);
        return this;
    },
    /**
     * Scales this by a scalar number
     * @param  {Number} scale amount to scale the vector by
     * @returns {Vector3} this
     */
    scale(scale) {
        vec3.scale(this.elements, this.elements, scale);
        return this;
    },
    /**
     * Adds two vec3's after scaling the second vector by a scalar value
     * @param  {Number} scale the amount to scale the second vector by before adding
     * @param  {Vector3} a
     * @param  {Vector3} [b] 如果不传，计算 this 和 a 的结果
     * @returns {Vector3} this
     */
    scaleAndAdd(scale, a, b) {
        if (!b) {
            b = a;
            a = this;
        }
        vec3.scaleAndAdd(this.elements, a.elements, b.elements, scale);
        return this;
    },
    /**
     * Calculates the euclidian distance between two vec3's
     * @param  {Vector3} a
     * @param  {Vector3} [b] 如果不传，计算 this 和 a 的结果
     * @return {Number} distance between a and b
     */
    distance(a, b) {
        if (!b) {
            b = a;
            a = this;
        }
        return vec3.distance(a.elements, b.elements);
    },
    /**
     * Calculates the squared euclidian distance between two vec3's
     * @param  {Vector3} a
     * @param  {Vector3} [b] 如果不传，计算 this 和 a 的结果
     * @return {Number} squared distance between a and b
     */
    squaredDistance(a, b) {
        if (!b) {
            b = a;
            a = this;
        }
        return vec3.squaredDistance(a.elements, b.elements);
    },
    /**
     * Calculates the length of this
     * @return {Number} length of this
     */
    length() {
        return vec3.length(this.elements);
    },
    /**
     * Calculates the squared length of this
     * @return {Number} squared length of this
     */
    squaredLength() {
        return vec3.squaredLength(this.elements);
    },
    /**
     * Negates the components of this
     * @returns {Vector3} this
     */
    negate() {
        vec3.negate(this.elements, this.elements);
        return this;
    },
    /**
     * Returns the inverse of the components of a vec3
     * @param  {Vector3} [a=this]
     * @returns {Vector3} this
     */
    inverse(a) {
        if (!a) {
            a = this;
        }
        vec3.inverse(this.elements, a.elements);
        return this;
    },
    /**
     * Normalize this
     * @returns {Vector3} this
     */
    normalize() {
        vec3.normalize(this.elements, this.elements);
        return this;
    },
    /**
     * Calculates the dot product of two vec3's
     * @param  {Vector3} a
     * @param  {Vector3} [b] 如果不传，计算 this 和 a 的结果
     * @return {Number}  product of a and b
     */
    dot(a, b) {
        if (!b) {
            b = a;
            a = this;
        }
        return vec3.dot(a.elements, b.elements);
    },
    /**
     * Computes the cross product of two vec3's
     * @param  {Vector2} a
     * @param  {Vector2} [b] 如果不传，计算 this 和 a 的结果
     * @return {Number}  cross product of a and b
     */
    cross(a, b) {
        if (!b) {
            b = a;
            a = this;
        }
        vec3.cross(this.elements, a.elements, b.elements);
        return this;
    },
    /**
     * Performs a linear interpolation between two vec3's
     * @param  {Vector3} v
     * @param  {Number} t interpolation amount between the two vectors
     * @returns {Vector3} this
     */
    lerp(v, t) {
        vec3.lerp(this.elements, this.elements, v.elements, t);
        return this;
    },
    /**
     * Performs a hermite interpolation with two control points
     * @param  {Vector3} a
     * @param  {Vector3} b
     * @param  {Vector3} c
     * @param  {Vector3} d
     * @param  {Number} t interpolation amount between the two inputs
     * @return {Vector3} this
     */
    hermite(a, b, c, d, t) {
        vec3.hermite(this.elements, a.elements, b.elements, c.elements, d.elements, t);
        return this;
    },
    /**
     * Performs a bezier interpolation with two control points
     * @param  {Vector3} a
     * @param  {Vector3} b
     * @param  {Vector3} c
     * @param  {Vector3} d
     * @param  {Number} t interpolation amount between the two inputs
     * @return {Vector3} this
     */
    bezier(a, b, c, d, t) {
        vec3.bezier(this.elements, a.elements, b.elements, c.elements, d.elements, t);
        return this;
    },
    /**
     * Generates a random vector with the given scale
     * @param  {Number} [scale=1] Length of the resulting vector. If ommitted, a unit vector will be returned
     * @returns {Vector3} this
     */
    random(scale) {
        vec3.random(this.elements, scale);
        return this;
    },
    /**
     * Transforms the vec3 with a mat3
     * @param  {Matrix3} m matrix to transform with
     * @returns {Vector3} this
     */
    transformMat3(m) {
        vec3.transformMat3(this.elements, this.elements, m.elements);
        return this;
    },
    /**
     * Transforms the vec3 with a mat4
     * @param  {Matrix4} m matrix to transform with
     * @returns {Vector3} this
     */
    transformMat4(m) {
        vec3.transformMat4(this.elements, this.elements, m.elements);
        return this;
    },
    /**
     * Transforms the vec3 direction with a mat4
     * @param  {Matrix4} m matrix to transform with
     * @returns {Vector3} this
     */
    transformDirection(m) {
        const elements = this.elements;
        const mElements = m.elements;
        const x = elements[0];
        const y = elements[1];
        const z = elements[2];

        elements[0] = x * mElements[0] + y * mElements[4] + z * mElements[8];
        elements[1] = x * mElements[1] + y * mElements[5] + z * mElements[9];
        elements[2] = x * mElements[2] + y * mElements[6] + z * mElements[10];

        return this;
    },
    /**
     * Transforms the vec3 with a quat
     * @param  {Quaternion} q quaternion to transform with
     * @returns {Vector3} this
     */
    transformQuat(q) {
        vec3.transformQuat(this.elements, this.elements, q.elements);
        return this;
    },
    /**
     * Rotate this 3D vector around the x-axis
     * @param  {Vector3} origin The origin of the rotation
     * @param  {Number} rotation The angle of rotation
     * @return {Vector3} this
     */
    rotateX(origin, rotation) {
        vec3.rotateX(this.elements, this.elements, origin.elements, rotation);
        return this;
    },
    /**
     * Rotate this 3D vector around the y-axis
     * @param  {Vector3} origin The origin of the rotation
     * @param  {Number} rotation The angle of rotation
     * @return {Vector3} this
     */
    rotateY(origin, rotation) {
        vec3.rotateY(this.elements, this.elements, origin.elements, rotation);
        return this;
    },
    /**
     * Rotate this 3D vector around the z-axis
     * @param  {Vector3} origin The origin of the rotation
     * @param  {Number} rotation The angle of rotation
     * @return {Vector3} this
     */
    rotateZ(origin, rotation) {
        vec3.rotateZ(this.elements, this.elements, origin.elements, rotation);
        return this;
    },
    /**
     * Returns whether or not the vectors have exactly the same elements in the same position (when compared with ===)
     * @param  {Vector3} a
     * @param  {Vector3} [b] 如果不传，计算 this 和 a 的结果
     * @return {Boolean} True if the vectors are equal, false otherwise.
     */
    exactEquals(a, b) {
        if (!b) {
            b = a;
            a = this;
        }
        return vec3.exactEquals(a.elements, b.elements);
    },
    /**
     * Returns whether or not the vectors have approximately the same elements in the same position.
     * @param  {Vector3} a
     * @param  {Vector3} [b] 如果不传，计算 this 和 a 的结果
     * @return {Boolean} True if the vectors are equal, false otherwise.
     */
    equals(a, b) {
        if (!b) {
            b = a;
            a = this;
        }
        return vec3.equals(a.elements, b.elements);
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
    }
});

/**
 * Alias for {@link Vector3#subtract}
 * @function
 */
Vector3.prototype.sub = Vector3.prototype.subtract;

/**
 * Alias for {@link Vector3#multiply}
 * @function
 */
Vector3.prototype.mul = Vector3.prototype.multiply;

/**
 * Alias for {@link Vector3#divide}
 * @function
 */
Vector3.prototype.div = Vector3.prototype.divide;

/**
 * Alias for {@link Vector3#distance}
 * @function
 */
Vector3.prototype.dist = Vector3.prototype.distance;

/**
 * Alias for {@link Vector3#squaredDistance}
 * @function
 */
Vector3.prototype.sqrDist = Vector3.prototype.squaredDistance;

/**
 * Alias for {@link Vector3#length}
 * @function
 */
Vector3.prototype.len = Vector3.prototype.length;

/**
 * Alias for {@link Vector3#squaredLength}
 * @function
 */
Vector3.prototype.sqrLen = Vector3.prototype.squaredLength;

export default Vector3;
