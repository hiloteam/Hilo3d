import Class from '../core/Class';
import Geometry from './Geometry';
import GeometryData from './GeometryData';

const centerData = [0, 0, 0]; // eslint-disable-line no-unused-vars
/**
 * 球形几何体
 * @class
 * @extends Geometry
 */
const SphereGeometry = Class.create(/** @lends SphereGeometry.prototype */ {
    Extends: Geometry,
    /**
     * @default true
     * @type {boolean}
     */
    isSphereGeometry: true,
    /**
     * @default SphereGeometry
     * @type {string}
     */
    className: 'SphereGeometry',
    /**
     * 半径
     * @default 1
     * @type {number}
     */
    radius: 1,
    /**
     * 垂直分割面的数量
     * @default 16
     * @type {number}
     */
    heightSegments: 16,
    /**
     * 水平分割面的数量
     * @default 32
     * @type {number}
     */
    widthSegments: 32,
    /**
     * @constructs
     * @param {object} params 创建对象的属性参数。可包含此类的所有属性。
     */
    constructor(params) {
        SphereGeometry.superclass.constructor.call(this, params);
        this.build();
    },
    build() {
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

                let tangentX = yawSin;
                let tangentY = 0;
                let tangentZ = -yawCos;

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
    },
    _raycast(ray, side) {
        // TODO:optimize
        return SphereGeometry.superclass._raycast.call(this, ray, side);
    }
});

export default SphereGeometry;
