import Class from '../core/Class';
import Vector3 from './Vector3';

const tempVector3 = new Vector3();

const Sphere = Class.create(/** @lends Sphere.prototype */{
    /**
     * 类名
     * @type {String}
     * @default Sphere
     */
    className: 'Sphere',
    /**
     * @type {Boolean}
     * @default true
     */
    isSphere: true,
    /**
     * 半径
     * @type {Number}
     * @default 0
     */
    radius: 0,
    /**
     * @constructs
     * @param {object} [params] 初始化参数，所有params都会复制到实例上
     */
    constructor(params) {
        Object.assign(this, params);
        if (!this.center) {
            this.center = new Vector3(0, 0, 0);
        }
    },
    /**
     * 克隆
     * @return {Sphere}
     */
    clone() {
        const sphere = new this.constructor();
        sphere.copy(this);
        return sphere;
    },
    /**
     * 复制
     * @param  {Sphere} sphere
     * @return {Sphere} this
     */
    copy(sphere) {
        this.center.copy(sphere.center);
        this.radius = sphere.radius;
        return this;
    },
    /**
     * 从点生成
     * @param  {Array} points
     * @return {Sphere} this
     */
    fromPoints(points) {
        let center = this.center;
        let maxSquaredRadius = 0;
        for (let i = 0; i < points.length; i += 3) {
            let x = points[i] - center.x;
            let y = points[i + 1] - center.y;
            let z = points[i + 2] - center.z;
            maxSquaredRadius = Math.max(x * x + y * y + z * z, maxSquaredRadius);
        }

        this.radius = Math.sqrt(maxSquaredRadius);
        return this;
    },
    /**
     * 从点生成
     * @param  {GeometryData} geometryData
     * @return {Sphere} this
     */
    fromGeometryData(geometryData) {
        let center = this.center;
        let maxSquaredRadius = 0;
        geometryData.traverse((vertexData) => {
            let x = vertexData.x - center.x;
            let y = vertexData.y - center.y;
            let z = vertexData.z - center.z;
            maxSquaredRadius = Math.max(x * x + y * y + z * z, maxSquaredRadius);
        });

        this.radius = Math.sqrt(maxSquaredRadius);
        return this;
    },
    /**
     * transformMat4
     * @param  {Matrix4} mat4
     * @return {Sphere} this
     */
    transformMat4(mat4) {
        this.center.transformMat4(mat4);
        const scale = mat4.getScaling(tempVector3);
        this.radius *= Math.max(scale.x, scale.y, scale.z);
        return this;
    }
});

export default Sphere;
