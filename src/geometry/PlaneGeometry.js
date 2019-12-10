import Class from '../core/Class';
import Geometry from './Geometry';
import GeometryData from './GeometryData';

import constants from '../constants';

const {
    FRONT,
    BACK
} = constants;

const normalData = [0, 0, 1];
/**
 * 平面几何体
 * @class
 * @extends Geometry
 */
const PlaneGeometry = Class.create(/** @lends PlaneGeometry.prototype */ {
    Extends: Geometry,
    /**
     * @default true
     * @type {boolean}
     */
    isPlaneGeometry: true,
    /**
     * @default PlaneGeometry
     * @type {string}
     */
    className: 'PlaneGeometry',
    /**
     * 宽度
     * @default 1
     * @type {number}
     */
    width: 1,
    /**
     * 高度
     * @default 1
     * @type {number}
     */
    height: 1,
    /**
     * 水平分割面的数量
     * @default 1
     * @type {number}
     */
    widthSegments: 1,
    /**
     * 垂直分割面的数量
     * @default 1
     * @type {number}
     */
    heightSegments: 1,
    /**
     * @constructs
     * @param {object} [params] 创建对象的属性参数。可包含此类的所有属性。
     */
    constructor(params) {
        PlaneGeometry.superclass.constructor.call(this, params);
        this.build();
    },
    build() {
        const {
            widthSegments,
            heightSegments
        } = this;
        const count = (widthSegments + 1) * (heightSegments + 1);
        const diffW = this.width / widthSegments;
        const diffH = this.height / heightSegments;

        const vertices = new Float32Array(count * 3);
        const normals = new Float32Array(count * 3);
        const uvs = new Float32Array(count * 2);
        const indices = new Uint16Array(widthSegments * heightSegments * 6);

        let indicesIdx = 0;

        for (let h = 0; h <= heightSegments; h++) {
            for (let w = 0; w <= widthSegments; w++) {
                let idx = h * (widthSegments + 1) + w;
                vertices[idx * 3] = w * diffW - this.width / 2;
                vertices[idx * 3 + 1] = this.height / 2 - h * diffH;
                normals[idx * 3] = 0;
                normals[idx * 3 + 1] = 0;
                normals[idx * 3 + 2] = 1;
                uvs[idx * 2] = w / widthSegments;
                uvs[idx * 2 + 1] = 1 - h / heightSegments;

                if (h < heightSegments && w < widthSegments) {
                    let lb = (h + 1) * (widthSegments + 1) + w;
                    indices[indicesIdx++] = idx;
                    indices[indicesIdx++] = lb;
                    indices[indicesIdx++] = lb + 1;
                    indices[indicesIdx++] = idx;
                    indices[indicesIdx++] = lb + 1;
                    indices[indicesIdx++] = idx + 1;
                }
            }
        }

        this.vertices = new GeometryData(vertices, 3);
        this.indices = new GeometryData(indices, 1);
        this.normals = new GeometryData(normals, 3);
        this.uvs = new GeometryData(uvs, 2);
    },
    _raycast(ray, side) {
        const originZ = ray.origin.z;
        const directionZ = ray.direction.z;

        if (side === FRONT && (directionZ > 0 || originZ < 0)) {
            return null;
        }

        if (side === BACK && (directionZ < 0 || originZ > 0)) {
            return null;
        }

        const point = ray.intersectsPlane(normalData, 0);
        if (point) {
            const x = point.x;
            const y = point.y;
            const halfWidth = this.width * .5;
            const halfHeight = this.height * .5;
            if (x >= -halfWidth && x <= halfWidth && y >= -halfHeight && y <= halfHeight) {
                return [point];
            }
        }
        return null;
    }
});

export default PlaneGeometry;
