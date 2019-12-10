import Ray3d from 'ray-3d';
import Class from '../core/Class';
import Vector3 from './Vector3';

/**
 * 射线
 * @class
 * @example
 * var ray = new Hilo3d.Ray();
 * ray.fromCamera(camera, 10, 10, stage.width, stage.height);
 */
const Ray = Class.create(/** @lends Ray.prototype */ {
    /**
     * 类名
     * @type {String}
     * @default Ray
     */
    className: 'Ray',

    /**
     * 是否是射线
     * @type {Boolean}
     * @default true
     */
    isRay: true,

    /**
     * 原点
     * @type {Vector3}
     */
    origin: {
        get() {
            return this._origin;
        },
        set(value) {
            this._origin = value;
            this._ray.origin = value.elements;
        }
    },

    /**
     * 方向
     * @type {Vector3}
     */
    direction: {
        get() {
            return this._direction;
        },
        set(value) {
            this._direction = value;
            this._ray.direction = value.elements;
        }
    },

    /**
     * @constructs
     * @param {Object} [params]
     * @param {Vector3} [params.origin=new Vector3(0, 0, 0)] 原点
     * @param {Vector3} [params.direction=new Vector3(0, 0, -1)] 方向
     */
    constructor(params = {}) {
        this._ray = new Ray3d();
        this.origin = params.origin || new Vector3(0, 0, 0);
        this.direction = params.direction || new Vector3(0, 0, -1);
    },

    /**
     * set
     * @param {Vector3} origin
     * @param {Vector3} direction
     * @return {Ray} this
     */
    set(origin, direction) {
        this.origin = origin;
        this.direction = direction;
        return this;
    },

    /**
     * copy
     * @param  {Vector3} other
     * @return {Ray}
     */
    copy(other) {
        this.origin.copy(other.origin);
        this.direction.copy(other.direction);
    },

    /**
     * clone
     * @return {Ray}
     */
    clone() {
        return new this.constructor({
            origin: this.origin.clone(),
            direction: this.direction.clone()
        });
    },

    /**
     * 从摄像机设置
     * @param  {Camera} camera
     * @param  {Number} x 屏幕x
     * @param  {Number} y 屏幕y
     * @param  {Number} width   屏幕宽
     * @param  {Number} height  屏幕高
     */
    fromCamera(camera, x, y, width, height) {
        if (camera.isPerspectiveCamera) {
            camera.worldMatrix.getTranslation(this.origin);
            this.direction.set(x, y, 0);
            this.direction.copy(camera.unprojectVector(this.direction, width, height));
            this.direction.sub(this.origin).normalize();
        } else if (camera.isOrthographicCamera) {
            this.origin.set(x, y, (camera.near + camera.far) / (camera.near - camera.far));
            this.origin.copy(camera.unprojectVector(this.origin, width, height));
            this.direction.set(0, 0, -1).transformDirection(camera.worldMatrix).normalize();
        }
    },

    /**
     * Transforms the ray with a mat4
     * @param  {Matrix4} mat4
     */
    transformMat4(mat4) {
        this.origin.transformMat4(mat4);
        this.direction.transformDirection(mat4).normalize();
    },

    /**
     * 排序碰撞点
     * @param  {Vector3[]|raycastInfo[]} points
     * @param  {String} [pointName='']
     */
    sortPoints(points, pointName) {
        if (pointName) {
            points.sort((a, b) => {
                return this.squaredDistance(a[pointName]) - this.squaredDistance(b[pointName]);
            });
        } else {
            points.sort((a, b) => {
                return this.squaredDistance(a) - this.squaredDistance(b);
            });
        }
    },

    /**
     * squaredDistance
     * @param  {Vector3} point
     * @return {Number}
     */
    squaredDistance(point) {
        return this.origin.squaredDistance(point);
    },

    /**
     * distance
     * @param  {Vector3} point
     * @return {Number}
     */
    distance(point) {
        return this.origin.distance(point);
    },

    /**
     * intersectsSphere
     * @param  {Number[]} center [x, y, z]
     * @param  {Number} radius
     * @return {Vector3}  碰撞点，如果没有碰撞返回 null
     */
    intersectsSphere(center, radius) {
        const res = this._ray.intersectsSphere(center, radius);
        return this._getRes(res);
    },
    /**
     * intersectsPlane
     * @param  {Numer[]} normal [x, y, z]
     * @param  {Number} distance
     * @return {Vector3}  碰撞点，如果没有碰撞返回 null
     */
    intersectsPlane(normal, distance) {
        const res = this._ray.intersectsPlane(normal, distance);
        return this._getRes(res);
    },
    /**
     * intersectsTriangle
     * @param  {Array} triangle [[a.x, a.y, a.z], [b.x, b.y, b.z],[c.x, c.y, c.z]]
     * @return {Vector3}  碰撞点，如果没有碰撞返回 null
     */
    intersectsTriangle(triangle) {
        const res = this._ray.intersectsTriangle(triangle);
        return this._getRes(res);
    },
    /**
     * intersectsBox
     * @param  {Array} aabb [[min.x, min.y, min.z], [max.x, max.y, max.z]]
     * @return {Vector3}  碰撞点，如果没有碰撞返回 null
     */
    intersectsBox(aabb) {
        const res = this._ray.intersectsBox(aabb);
        return this._getRes(res);
    },
    /**
     * intersectsTriangleCell
     * @param  {Array} cell
     * @param  {Array} positions
     * @return {Vector3}  碰撞点，如果没有碰撞返回 null
     */
    intersectsTriangleCell(cell, positions) {
        const res = this._ray.intersectsTriangleCell(cell, positions);
        return this._getRes(res);
    },
    /**
     * _getRes
     * @private
     */
    _getRes(res) {
        if (res) {
            return new Vector3(res[0], res[1], res[2]);
        }
        return null;
    }
});

export default Ray;
