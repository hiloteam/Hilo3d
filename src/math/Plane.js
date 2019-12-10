import Class from '../core/Class';
import Vector3 from './Vector3';

/**
 * 平面
 * @class
 */
const Plane = Class.create(/** @lends Plane.prototype */ {
    /**
     * 类名
     * @type {String}
     * @default Plane
     */
    className: 'Plane',
    /**
     * @type {Boolean}
     * @default true
     */
    isPlane: true,
    /**
     * @constructs
     * @param  {Vector3} [normal=new Vector3]   法线
     * @param  {Number}  [distance=0] 距离
     */
    constructor(normal = new Vector3(), distance = 0) {
        this.normal = normal;
        this.distance = distance;
    },
    /**
     * Copy the values from one plane to this
     * @param  {Plane} m the source plane
     * @return {Plane} this
     */
    copy(plane) {
        this.normal.copy(plane.normal);
        this.distance = plane.distance;
        return this;
    },
    /**
     * Creates a new plane initialized with values from this plane
     * @return {Plane} a new Plane
     */
    clone() {
        return new this.constructor(this.normal.clone(), this.distance);
    },
    /**
     * [set description]
     * @param {Number} x 法线 x
     * @param {Number} y 法线 y
     * @param {Number} z 法线 z
     * @param {Number} w 距离
     * @return {Plane} this
     */
    set(x, y, z, w) {
        this.normal.set(x, y, z);
        this.distance = w;

        return this;
    },
    /**
     * 归一化
     * @return {Plane} this
     */
    normalize() {
        const inverseNormalLength = 1.0 / this.normal.length();
        this.normal.scale(inverseNormalLength);
        this.distance *= inverseNormalLength;

        return this;
    },
    /**
     * 与点的距离
     * @param  {Vector3} point
     * @return {Number}
     */
    distanceToPoint(point) {
        return this.normal.dot(point) + this.distance;
    },
    /**
     * 投影点
     * @param  {Vector3} point
     * @return {Vector3}
     */
    projectPoint(point) {
        return new Vector3().copy(this.normal).scale(-this.distanceToPoint(point)).add(point);
    }
});

export default Plane;
