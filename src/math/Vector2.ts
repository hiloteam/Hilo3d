import { vec2 } from 'gl-matrix';

/**
 * 二维向量
 * @class
 */
class Vector2 {
    /**
     * 类名
     * @type {String}
     * @default Vector2
     */
    className: string = 'Vector2';

    /**
     * @type {Boolean}
     * @default true
     */
    isVector2: boolean = true;

    /**
     * 数据
     * @type {Float32Array}
     */
    elements: Float32Array;

    /**
     * Creates a new empty vec2
     * @param {Number} [x=0] X component
     * @param {Number} [y=0] Y component
     * @constructs
     */
    constructor(x: number = 0, y: number = 0) {
        this.elements = vec2.fromValues(x, y);
    }

    /**
     * Copy the values from one vec2 to this
     * @param  {Vector2} m the source vector
     * @return {Vector2} this
     */
    copy(v: Vector2): Vector2 {
        vec2.copy(this.elements, v.elements);
        return this;
    }

    /**
     * Creates a new vec2 initialized with values from this vector
     * @return {Vector2} a new Vector2
     */
    clone(): Vector2 {
        const elements = this.elements;
        return new Vector2(elements[0], elements[1]);
    }

    /**
     * 转换到数组
     * @param  {number[]|TypedArray}  [array=[]] 数组
     * @param  {Number} [offset=0] 数组偏移值
     * @return {Array}
     */
    toArray(array: number[] | Float32Array = [], offset: number = 0): number[] | Float32Array {
        const elements = this.elements;
        array[0 + offset] = elements[0];
        array[1 + offset] = elements[1];
        return array;
    }

    /**
     * 从数组赋值
     * @param  {number[]|TypedArray} array  数组
     * @param  {Number} [offset=0] 数组偏移值
     * @return {Vector2} this
     */
    fromArray(array: number[] | Float32Array, offset: number = 0): Vector2 {
        const elements = this.elements;
        elements[0] = array[offset + 0];
        elements[1] = array[offset + 1];
        return this;
    }

    /**
     * Set the components of a vec4 to the given values
     * @param {Number} x X component
     * @param {Number} y Y component
     * @returns {Vector2} this
     */
    set(x: number, y: number): Vector2 {
        vec2.set(this.elements, x, y);
        return this;
    }

    /**
     * Adds two vec2's
     * @param {Vector2} a
     * @param {Vector2} [b] 如果不传，计算 this 和 a 的和
     * @returns {Vector2} this
     */
    add(a: Vector2, b?: Vector2): Vector2 {
        if (!b) {
            b = a;
            a = this;
        }
        vec2.add(this.elements, a.elements, b.elements);
        return this;
    }

    /**
     * Subtracts vector b from vector a
     * @param {Vector2} a
     * @param {Vector2} [b] 如果不传，计算 this 和 a 的差
     * @returns {Vector2} this
     */
    subtract(a: Vector2, b?: Vector2): Vector2 {
        if (!b) {
            b = a;
            a = this;
        }
        vec2.subtract(this.elements, a.elements, b.elements);
        return this;
    }

    /**
     * Multiplies two vec2's
     * @param {Vector2} a
     * @param {Vector2} [b] 如果不传，计算 this 和 a 的积
     * @returns {Vector2} this
     */
    multiply(a: Vector2, b?: Vector2): Vector2 {
        if (!b) {
            b = a;
            a = this;
        }
        vec2.multiply(this.elements, a.elements, b.elements);
        return this;
    }

    /**
     * Divides two vec2's
     * @param {Vector2} a
     * @param {Vector2} [b] 如果不传，计算 this 和 a 的商
     * @returns {Vector2} this
     */
    divide(a: Vector2, b?: Vector2): Vector2 {
        if (!b) {
            b = a;
            a = this;
        }
        vec2.divide(this.elements, a.elements, b.elements);
        return this;
    }

    /**
     * Math.ceil the components of this
     * @returns {Vector2} this
     */
    ceil(): Vector2 {
        vec2.ceil(this.elements, this.elements);
        return this;
    }

    /**
     * Math.floor the components of this
     * @returns {Vector2} this
     */
    floor(): Vector2 {
        vec2.floor(this.elements, this.elements);
        return this;
    }

    /**
     * Returns the minimum of two vec2's
     * @param  {Vector2} a
     * @param  {Vector2} [b] 如果不传，计算 this 和 a 的结果
     * @returns {Vector2} this
     */
    min(a: Vector2, b?: Vector2): Vector2 {
        if (!b) {
            b = a;
            a = this;
        }
        vec2.min(this.elements, a.elements, b.elements);
        return this;
    }

    /**
     * Returns the maximum of two vec2's
     * @param  {Vector2} a
     * @param  {Vector2} [b]  如果不传，计算 this 和 a 的结果
     * @returns {Vector2} this
     */
    max(a: Vector2, b?: Vector2): Vector2 {
        if (!b) {
            b = a;
            a = this;
        }
        vec2.max(this.elements, a.elements, b.elements);
        return this;
    }

    /**
     * Math.round the components of this
     * @returns {Vector2} this
     */
    round(): Vector2 {
        vec2.round(this.elements, this.elements);
        return this;
    }

    /**
     * Scales this by a scalar number
     * @param  {Number} scale amount to scale the vector by
     * @returns {Vector2} this
     */
    scale(scale: number): Vector2 {
        vec2.scale(this.elements, this.elements, scale);
        return this;
    }

    /**
     * Adds two vec2's after scaling the second vector by a scalar value
     * @param  {Number} scale the amount to scale the second vector by before adding
     * @param  {Vector2} a
     * @param  {Vector2} [b] 如果不传，计算 this 和 a 的结果
     * @returns {Vector2} this
     */
    scaleAndAdd(scale: number, a: Vector2, b?: Vector2): Vector2 {
        if (!b) {
            b = a;
            a = this;
        }
        vec2.scaleAndAdd(this.elements, a.elements, b.elements, scale);
        return this;
    }

    /**
     * Calculates the euclidian distance between two vec2's
     * @param  {Vector2} a
     * @param  {Vector2} [b] 如果不传，计算 this 和 a 的结果
     * @return {Number} distance between a and b
     */
    distance(a: Vector2, b?: Vector2): number {
        if (!b) {
            b = a;
            a = this;
        }
        return vec2.distance(a.elements, b.elements);
    }

    /**
     * Calculates the squared euclidian distance between two vec2's
     * @param  {Vector2} a
     * @param  {Vector2} [b] 如果不传，计算 this 和 a 的结果
     * @return {Number} squared distance between a and b
     */
    squaredDistance(a: Vector2, b?: Vector2): number {
        if (!b) {
            b = a;
            a = this;
        }
        return vec2.squaredDistance(a.elements, b.elements);
    }

    /**
     * Calculates the length of this
     * @return {Number} length of this
     */
    length(): number {
        return vec2.length(this.elements);
    }

    /**
     * Calculates the squared length of this
     * @return {Number} squared length of this
     */
    squaredLength(): number {
        return vec2.squaredLength(this.elements);
    }

    /**
     * Negates the components of this
     * @returns {Vector2} this
     */
    negate(): Vector2 {
        vec2.negate(this.elements, this.elements);
        return this;
    }

    /**
     * Returns the inverse of the components of a vec2
     * @param  {Vector2} [a=this]
     * @returns {Vector2} this
     */
    inverse(a?: Vector2): Vector2 {
        if (!a) {
            a = this;
        }
        vec2.inverse(this.elements, a.elements);
        return this;
    }

    /**
     * Normalize this
     * @returns {Vector2} this
     */
    normalize(): Vector2 {
        vec2.normalize(this.elements, this.elements);
        return this;
    }

    /**
     * Calculates the dot product of two vec2's
     * @param  {Vector2} a
     * @param  {Vector2} [b] 如果不传，计算 this 和 a 的结果
     * @return {Number}  product of a and b
     */
    dot(a: Vector2, b?: Vector2): number {
        if (!b) {
            b = a;
            a = this;
        }
        return vec2.dot(a.elements, b.elements);
    }

    /**
     * Computes the cross product of two vec2's
     * @param  {Vector2} a
     * @param  {Vector2} [b] 如果不传，计算 this 和 a 的结果
     * @return {Number}  cross product of a and b
     */
    cross(a: Vector2, b?: Vector2): Vector2 {
        if (!b) {
            b = a;
            a = this;
        }
        vec2.cross(this.elements, a.elements, b.elements);
        return this;
    }

    /**
     * Performs a linear interpolation between two vec2's
     * @param  {Vector2} v
     * @param  {Number} t interpolation amount between the two vectors
     * @returns {Vector2} this
     */
    lerp(v: Vector2, t: number): Vector2 {
        vec2.lerp(this.elements, this.elements, v.elements, t);
        return this;
    }

    /**
     * Generates a random vector with the given scale
     * @param  {Number} [scale=1] Length of the resulting vector. If ommitted, a unit vector will be returned
     * @returns {Vector2} this
     */
    random(scale?: number): Vector2 {
        vec2.random(this.elements, scale);
        return this;
    }

    /**
     * Transforms the vec2 with a mat3
     * @param  {Matrix3} m matrix to transform with
     * @returns {Vector2} this
     */
    transformMat3(m: any): Vector2 {
        vec2.transformMat3(this.elements, this.elements, m.elements);
        return this;
    }

    /**
     * Transforms the vec2 with a mat4
     * @param  {Matrix4} m matrix to transform with
     * @returns {Vector2} this
     */
    transformMat4(m: any): Vector2 {
        vec2.transformMat4(this.elements, this.elements, m.elements);
        return this;
    }

    /**
     * Returns whether or not the vectors have exactly the same elements in the same position (when compared with ===)
     * @param  {Vector2} a
     * @param  {Vector2} [b] 如果不传，计算 this 和 a 的结果
     * @return {Boolean} True if the vectors are equal, false otherwise.
     */
    exactEquals(a: Vector2, b?: Vector2): boolean {
        if (!b) {
            b = a;
            a = this;
        }
        return vec2.exactEquals(a.elements, b.elements);
    }

    /**
     * Returns whether or not the vectors have approximately the same elements in the same position.
     * @param  {Vector2} a
     * @param  {Vector2} [b] 如果不传，计算 this 和 a 的结果
     * @return {Boolean} True if the vectors are equal, false otherwise.
     */
    equals(a: Vector2, b?: Vector2): boolean {
        if (!b) {
            b = a;
            a = this;
        }
        return vec2.equals(a.elements, b.elements);
    }

    /**
     * X component
     * @type {Number}
     */
    get x(): number {
        return this.elements[0];
    }

    set x(value: number) {
        this.elements[0] = value;
    }

    /**
     * Y component
     * @type {Number}
     */
    get y(): number {
        return this.elements[1];
    }

    set y(value: number) {
        this.elements[1] = value;
    }

    /**
     * Alias for {@link Vector2#subtract}
     * @function
     */
    sub = this.subtract;

    /**
     * Alias for {@link Vector2#multiply}
     * @function
     */
    mul = this.multiply;

    /**
     * Alias for {@link Vector2#divide}
     * @function
     */
    div = this.divide;

    /**
     * Alias for {@link Vector2#distance}
     * @function
     */
    dist = this.distance;

    /**
     * Alias for {@link Vector2#squaredDistance}
     * @function
     */
    sqrDist = this.squaredDistance;

    /**
     * Alias for {@link Vector2#length}
     * @function
     */
    len = this.length;

    /**
     * Alias for {@link Vector2#squaredLength}
     * @function
     */
    sqrLen = this.squaredLength;
}

export default Vector2;
