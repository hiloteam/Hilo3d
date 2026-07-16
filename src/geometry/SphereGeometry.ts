import Geometry, { type GeometryParameters } from './Geometry';
import GeometryData from './GeometryData';
import type Ray from '../math/Ray';
import type Vector3 from '../math/Vector3';

export interface SphereGeometryParameters extends GeometryParameters {
    radius?: number;
    heightSegments?: number;
    widthSegments?: number;
}
/**
 * 球形几何体
 */
class SphereGeometry extends Geometry {
    isSphereGeometry = true;
    override readonly className: string = 'SphereGeometry';
    /**
     * 半径
     */
    radius = 1;
    /**
     * 垂直分割面的数量
     */
    heightSegments = 16;
    /**
     * 水平分割面的数量
     */
    widthSegments = 32;
    /**
     * @param params - 创建对象的属性参数。可包含此类的所有属性。
     * - `params.radius`: 半径
     * - `params.heightSegments`: 垂直分割面的数量
     * - `params.widthSegments`: 水平分割面的数量
     */
    constructor(params: SphereGeometryParameters = {}) {
        super();
        Object.assign(this, params);
        this.build();
    }
    private build(): void {
        const radius = this.radius;
        const heightSegments = this.heightSegments;
        const widthSegments = this.widthSegments;
        const count = (widthSegments + 1) * (heightSegments + 1);
        const gridCount = widthSegments * heightSegments;
        const vertices = new Float32Array(count * 3);
        const tangents = new Float32Array(count * 4);
        const uvs = new Float32Array(count * 2);
        const indices = new Uint16Array(gridCount * 6);
        let indexId = 0;
        let vertexId = 0;
        let tangentId = 0;
        let uvId = 0;
        let pointId = 0;
        const ANGLE_360 = Math.PI * 2;
        const ANGLE_180 = Math.PI;
        for (let h = 0; h <= heightSegments; h++) {
            const v = h / heightSegments;
            const pitchAngle = ANGLE_180 * v;
            const y = Math.cos(pitchAngle) * radius;
            const yawRadius = Math.sin(pitchAngle) * radius;
            for (let w = 0; w <= widthSegments; w++) {
                const u = w / widthSegments;
                const yawAngle = ANGLE_360 * u;
                const yawCos = Math.cos(yawAngle);
                const yawSin = Math.sin(yawAngle);
                const x = yawCos * yawRadius;
                const z = yawSin * yawRadius;
                const tangentX = yawSin;
                const tangentY = 0;
                const tangentZ = -yawCos;
                tangents[tangentId++] = tangentX;
                tangents[tangentId++] = tangentY;
                tangents[tangentId++] = tangentZ;
                tangents[tangentId++] = 1;
                vertices[vertexId++] = x;
                vertices[vertexId++] = y;
                vertices[vertexId++] = z;
                uvs[uvId++] = u;
                uvs[uvId++] = v;
                if (h > 0 && w > 0) {
                    const a = pointId;
                    const b = a - 1;
                    const c = b - widthSegments - 1;
                    const d = a - widthSegments - 1;
                    indices[indexId++] = c;
                    indices[indexId++] = d;
                    indices[indexId++] = a;
                    indices[indexId++] = c;
                    indices[indexId++] = a;
                    indices[indexId++] = b;
                }
                pointId++;
            }
        }
        this.vertices = new GeometryData(vertices, 3);
        this.indices = new GeometryData(indices, 1);
        this.uvs = new GeometryData(uvs, 2);
        this.tangents = new GeometryData(tangents, 4);
        this.normals = new GeometryData(new Float32Array(vertices), 3);
    }
    override _raycast(ray: Ray, side: GLenum): Vector3[] | null {
        // TODO:optimize
        return super._raycast(ray, side);
    }
}
export default SphereGeometry;
