import Ray3d from 'ray-3d';
import Vector3 from './Vector3';
import Matrix4 from './Matrix4';

interface Camera {
    isPerspectiveCamera?: boolean;
    isOrthographicCamera?: boolean;
    worldMatrix: Matrix4;
    near: number;
    far: number;
    unprojectVector(v: Vector3, width: number, height: number): Vector3;
}

interface RayParams {
    origin?: Vector3;
    direction?: Vector3;
}

interface RaycastInfo {
    [key: string]: Vector3;
}

/**
 * 射线
 * @class
 * @example
 * var ray = new Hilo3d.Ray();
 * ray.fromCamera(camera, 10, 10, stage.width, stage.height);
 */
class Ray {
    /**
     * 类名
     * @type {String}
     * @default Ray
     */
    className: string = 'Ray';

    /**
     * 是否是射线
     * @type {Boolean}
     * @default true
     */
    isRay: boolean = true;

    private _origin: Vector3;

    private _direction: Vector3;

    private _ray: Ray3d;

    /**
     * 原点
     * @type {Vector3}
     */
    get origin(): Vector3 {
        return this._origin;
    }

    set origin(value: Vector3) {
        this._origin = value;
        this._ray.origin = value.elements;
    }

    /**
     * 方向
     * @type {Vector3}
     */
    get direction(): Vector3 {
        return this._direction;
    }

    set direction(value: Vector3) {
        this._direction = value;
        this._ray.direction = value.elements;
    }

    /**
     * @constructs
     * @param {Object} [params]
     * @param {Vector3} [params.origin=new Vector3(0, 0, 0)] 原点
     * @param {Vector3} [params.direction=new Vector3(0, 0, -1)] 方向
     */
    constructor(params: RayParams = {}) {
        this._ray = new Ray3d();
        this._origin = new Vector3();
        this._direction = new Vector3();
        this.origin = params.origin || new Vector3(0, 0, 0);
        this.direction = params.direction || new Vector3(0, 0, -1);
    }

    /**
     * set
     * @param {Vector3} origin
     * @param {Vector3} direction
     * @return {Ray} this
     */
    set(origin: Vector3, direction: Vector3): Ray {
        this.origin = origin;
        this.direction = direction;
        return this;
    }

    /**
     * copy
     * @param  {Ray} other
     * @return {Ray}
     */
    copy(other: Ray): Ray {
        this.origin.copy(other.origin);
        this.direction.copy(other.direction);
        return this;
    }

    /**
     * clone
     * @return {Ray}
     */
    clone(): Ray {
        return new Ray({
            origin: this.origin.clone(),
            direction: this.direction.clone()
        });
    }

    /**
     * 从摄像机设置
     * @param  {Camera} camera
     * @param  {Number} x 屏幕x
     * @param  {Number} y 屏幕y
     * @param  {Number} width   屏幕宽
     * @param  {Number} height  屏幕高
     */
    fromCamera(camera: Camera, x: number, y: number, width: number, height: number): void {
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
    }

    /**
     * Transforms the ray with a mat4
     * @param  {Matrix4} mat4
     */
    transformMat4(mat4: Matrix4): void {
        this.origin.transformMat4(mat4);
        this.direction.transformDirection(mat4).normalize();
    }

    /**
     * 排序碰撞点
     * @param  {Vector3[]|raycastInfo[]} points
     * @param  {String} [pointName='']
     */
    sortPoints(points: Vector3[] | RaycastInfo[], pointName?: string): void {
        if (pointName) {
            points.sort((a, b) => {
                return this.squaredDistance((a as RaycastInfo)[pointName]) - this.squaredDistance((b as RaycastInfo)[pointName]);
            });
        } else {
            points.sort((a, b) => {
                return this.squaredDistance(a as Vector3) - this.squaredDistance(b as Vector3);
            });
        }
    }

    /**
     * squaredDistance
     * @param  {Vector3} point
     * @return {Number}
     */
    squaredDistance(point: Vector3): number {
        return this.origin.squaredDistance(point);
    }

    /**
     * distance
     * @param  {Vector3} point
     * @return {Number}
     */
    distance(point: Vector3): number {
        return this.origin.distance(point);
    }

    /**
     * intersectsSphere
     * @param  {Number[]} center [x, y, z]
     * @param  {Number} radius
     * @return {Vector3}  碰撞点，如果没有碰撞返回 null
     */
    intersectsSphere(center: number[], radius: number): Vector3 | null {
        const res = this._ray.intersectsSphere(center, radius);
        return this._getRes(res);
    }

    /**
     * intersectsPlane
     * @param  {Number[]} normal [x, y, z]
     * @param  {Number} distance
     * @return {Vector3}  碰撞点，如果没有碰撞返回 null
     */
    intersectsPlane(normal: number[], distance: number): Vector3 | null {
        const res = this._ray.intersectsPlane(normal, distance);
        return this._getRes(res);
    }

    /**
     * intersectsTriangle
     * @param  {Array} triangle [[a.x, a.y, a.z], [b.x, b.y, b.z],[c.x, c.y, c.z]]
     * @return {Vector3}  碰撞点，如果没有碰撞返回 null
     */
    intersectsTriangle(triangle: number[][]): Vector3 | null {
        const res = this._ray.intersectsTriangle(triangle);
        return this._getRes(res);
    }

    /**
     * intersectsBox
     * @param  {Array} aabb [[min.x, min.y, min.z], [max.x, max.y, max.z]]
     * @return {Vector3}  碰撞点，如果没有碰撞返回 null
     */
    intersectsBox(aabb: number[][]): Vector3 | null {
        const res = this._ray.intersectsBox(aabb);
        return this._getRes(res);
    }

    /**
     * intersectsTriangleCell
     * @param  {Array} cell
     * @param  {Array} positions
     * @return {Vector3}  碰撞点，如果没有碰撞返回 null
     */
    intersectsTriangleCell(cell: number[], positions: number[]): Vector3 | null {
        const res = this._ray.intersectsTriangleCell(cell, positions);
        return this._getRes(res);
    }

    /**
     * _getRes
     * @private
     */
    private _getRes(res: number[] | null): Vector3 | null {
        if (res) {
            return new Vector3(res[0], res[1], res[2]);
        }
        return null;
    }
}

export default Ray;
