import Vector3 from './Vector3';
/**
 * 平面
 */
class Plane {
    normal: Vector3;
    distance: number;
    /**
     * 类名
     */
    className = 'Plane';
    isPlane = true;
    /**
     * @param normal - 法线
     * @param distance - 距离
     */
    constructor(normal: Vector3 = new Vector3(), distance = 0) {
        /**
         * 法线向量
         */
        this.normal = normal;
        /**
         * 距离
         */
        this.distance = distance;
    }
    /**
     * Copy the values from one plane to this
     * @param plane - the source plane
     * @returns this
     */
    copy(plane: Plane): this {
        this.normal.copy(plane.normal);
        this.distance = plane.distance;
        return this;
    }
    /**
     * Creates a new plane initialized with values from this plane
     * @returns a new Plane
     */
    clone(): Plane {
        return new Plane(this.normal.clone(), this.distance);
    }
    /**
     * [set description]
     * @param x - 法线 x
     * @param y - 法线 y
     * @param z - 法线 z
     * @param w - 距离
     * @returns this
     */
    set(x: number, y: number, z: number, w: number): this {
        this.normal.set(x, y, z);
        this.distance = w;
        return this;
    }
    /**
     * 归一化
     * @returns this
     */
    normalize(): this {
        const normalLength = this.normal.length();
        if (normalLength === 0) {
            // Infinite perspective projections contain one disabled far plane. Represent it as a
            // plane that accepts every finite point instead of producing NaNs during culling.
            this.normal.set(0, 0, 0);
            this.distance = Infinity;
            return this;
        }
        const inverseNormalLength = 1.0 / normalLength;
        this.normal.scale(inverseNormalLength);
        this.distance *= inverseNormalLength;
        return this;
    }
    /**
     * 与点的距离
     * @param point -
     */
    distanceToPoint(point: Vector3): number {
        return this.normal.dot(point) + this.distance;
    }
    /**
     * 投影点
     * @param point -
     */
    projectPoint(point: Vector3): Vector3 {
        return new Vector3().copy(this.normal).scale(-this.distanceToPoint(point)).add(point);
    }
}
export default Plane;
