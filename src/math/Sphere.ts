import Vector3 from './Vector3';
import Matrix4 from './Matrix4';
import GeometryData from '../geometry/GeometryData';

const tempVector3 = new Vector3();

interface SphereParams {
    center?: Vector3;
    radius?: number;
}

/**
 * @class
 */
class Sphere {
    /**
     * 类名
     * @type {String}
     * @default Sphere
     */
    className: string = 'Sphere';

    /**
     * @type {Boolean}
     * @default true
     */
    isSphere: boolean = true;

    /**
     * 中心点
     * @type {Vector3}
     */
    center: Vector3;

    /**
     * 半径
     * @type {Number}
     * @default 0
     */
    radius: number = 0;

    /**
     * @constructs
     * @param {object} [params] 初始化参数，所有params都会复制到实例上
     */
    constructor(params?: SphereParams) {
        if (params) {
            Object.assign(this, params);
        }
        if (!this.center) {
            this.center = new Vector3(0, 0, 0);
        }
    }

    /**
     * 克隆
     * @return {Sphere}
     */
    clone(): Sphere {
        const sphere = new Sphere();
        sphere.copy(this);
        return sphere;
    }

    /**
     * 复制
     * @param  {Sphere} sphere
     * @return {Sphere} this
     */
    copy(sphere: Sphere): Sphere {
        this.center.copy(sphere.center);
        this.radius = sphere.radius;
        return this;
    }

    /**
     * 从点生成
     * @param  {Array} points
     * @return {Sphere} this
     */
    fromPoints(points: number[] | Float32Array): Sphere {
        const center = this.center;
        let maxSquaredRadius = 0;
        for (let i = 0; i < points.length; i += 3) {
            const x = points[i] - center.x;
            const y = points[i + 1] - center.y;
            const z = points[i + 2] - center.z;
            maxSquaredRadius = Math.max(x * x + y * y + z * z, maxSquaredRadius);
        }

        this.radius = Math.sqrt(maxSquaredRadius);
        return this;
    }

    /**
     * 从点生成
     * @param  {GeometryData} geometryData
     * @return {Sphere} this
     */
    fromGeometryData(geometryData: GeometryData): Sphere {
        const center = this.center;
        let maxSquaredRadius = 0;
        geometryData.traverse((vertexData: { x: number; y: number; z: number }) => {
            const x = vertexData.x - center.x;
            const y = vertexData.y - center.y;
            const z = vertexData.z - center.z;
            maxSquaredRadius = Math.max(x * x + y * y + z * z, maxSquaredRadius);
        });

        this.radius = Math.sqrt(maxSquaredRadius);
        return this;
    }

    /**
     * transformMat4
     * @param  {Matrix4} mat4
     * @return {Sphere} this
     */
    transformMat4(mat4: Matrix4): Sphere {
        this.center.transformMat4(mat4);
        const scale = mat4.getScaling(tempVector3);
        this.radius *= Math.max(scale.x, scale.y, scale.z);
        return this;
    }
}

export default Sphere;
