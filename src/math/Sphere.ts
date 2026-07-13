import Vector3 from './Vector3';
import type Matrix4 from './Matrix4';
import type GeometryData from '../geometry/GeometryData';
import { requireNumber } from './numberArray';
const tempVector3 = new Vector3();
class Sphere {
    center: Vector3;
    /**
     * 类名
     */
    className = 'Sphere';
    isSphere = true;
    /**
     * 半径
     */
    radius = 0;
    /**
     * @param params - 初始化参数，所有params都会复制到实例上
     */
    constructor(params: { center?: Vector3; radius?: number } = {}) {
        this.center = new Vector3();
        Object.assign(this, params);
    }
    /**
     * 克隆
     */
    clone(): Sphere {
        const sphere = new Sphere();
        sphere.copy(this);
        return sphere;
    }
    /**
     * 复制
     * @param sphere -
     * @returns this
     */
    copy(sphere: Sphere): this {
        this.center.copy(sphere.center);
        this.radius = sphere.radius;
        return this;
    }
    /**
     * 从点生成
     * @param points -
     * @returns this
     */
    fromPoints(points: ArrayLike<number>): this {
        const center = this.center;
        let maxSquaredRadius = 0;
        for (let i = 0; i < points.length; i += 3) {
            const x = requireNumber(points, i) - center.x;
            const y = requireNumber(points, i + 1) - center.y;
            const z = requireNumber(points, i + 2) - center.z;
            maxSquaredRadius = Math.max(x * x + y * y + z * z, maxSquaredRadius);
        }
        this.radius = Math.sqrt(maxSquaredRadius);
        return this;
    }
    /**
     * 从点生成
     * @param geometryData -
     * @returns this
     */
    fromGeometryData(geometryData: GeometryData): this {
        const center = this.center;
        let maxSquaredRadius = 0;
        geometryData.traverse(vertexData => {
            if (!(vertexData instanceof Vector3)) return false;
            const x = vertexData.x - center.x;
            const y = vertexData.y - center.y;
            const z = vertexData.z - center.z;
            maxSquaredRadius = Math.max(x * x + y * y + z * z, maxSquaredRadius);
            return false;
        });
        this.radius = Math.sqrt(maxSquaredRadius);
        return this;
    }
    /**
     * transformMat4
     * @param mat4 -
     * @returns this
     */
    transformMat4(mat4: Matrix4): this {
        this.center.transformMat4(mat4);
        const scale = mat4.getScaling(tempVector3);
        this.radius *= Math.max(scale.x, scale.y, scale.z);
        return this;
    }
}
export default Sphere;
