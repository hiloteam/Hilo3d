import Vector3 from './Vector3';

/**
 * 平面
 * @class
 */
class Plane {
    /**
     * 类名
     * @type {String}
     * @default Plane
     */
    className: string = 'Plane';

    /**
     * @type {Boolean}
     * @default true
     */
    isPlane: boolean = true;

    /**
     * 法线向量
     * @type Vector3
     */
    normal: Vector3;

    /**
     * 距离
     * @type number
     */
    distance: number;

    /**
     * @constructs
     * @param  {Vector3} [normal=new Vector3]   法线
     * @param  {Number}  [distance=0] 距离
     */
    constructor(normal: Vector3 = new Vector3(), distance: number = 0) {
        this.normal = normal;
        this.distance = distance;
    }

    /**
     * Copy the values from one plane to this
     * @param  {Plane} plane the source plane
     * @return {Plane} this
     */
    copy(plane: Plane): Plane {
        this.normal.copy(plane.normal);
        this.distance = plane.distance;
        return this;
    }

    /**
     * Creates a new plane initialized with values from this plane
     * @return {Plane} a new Plane
     */
    clone(): Plane {
        return new Plane(this.normal.clone(), this.distance);
    }

    /**
     * Set the components of a plane
     * @param {Number} x 法线 x
     * @param {Number} y 法线 y
     * @param {Number} z 法线 z
     * @param {Number} w 距离
     * @return {Plane} this
     */
    set(x: number, y: number, z: number, w: number): Plane {
        this.normal.set(x, y, z);
        this.distance = w;

        return this;
    }

    /**
     * 归一化
     * @return {Plane} this
     */
    normalize(): Plane {
        const inverseNormalLength = 1.0 / this.normal.length();
        this.normal.scale(inverseNormalLength);
        this.distance *= inverseNormalLength;

        return this;
    }

    /**
     * 与点的距离
     * @param  {Vector3} point
     * @return {Number}
     */
    distanceToPoint(point: Vector3): number {
        return this.normal.dot(point) + this.distance;
    }

    /**
     * 投影点
     * @param  {Vector3} point
     * @return {Vector3}
     */
    projectPoint(point: Vector3): Vector3 {
        return new Vector3().copy(this.normal).scale(-this.distanceToPoint(point)).add(point);
    }
}

export default Plane;
