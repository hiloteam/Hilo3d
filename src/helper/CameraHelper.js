import Class from '../core/Class';
import Mesh from '../core/Mesh';
import Geometry from '../geometry/Geometry';
import GeometryData from '../geometry/GeometryData';
import BasicMaterial from '../material/BasicMaterial';
import Vector3 from '../math/Vector3';
import Color from '../math/Color';

import constants from '../constants';
import Matrix4 from '../math/Matrix4';

const {
    LINES
} = constants;

const tempVector3 = new Vector3();
const tempMatrix4 = new Matrix4();
/**
 * 摄像机帮助类
 * @class
 * @extends Mesh
 * @example
 * stage.addChild(new Hilo3d.CameraHelper());
 */
const CameraHelper = Class.create(/** @lends CameraHelper.prototype */ {
    Extends: Mesh,
    /**
     * @default true
     * @type {boolean}
     */
    isCameraHelper: true,
    /**
     * @default CameraHelper
     * @type {string}
     */
    className: 'CameraHelper',
    camera: null,
    /**
     * 颜色
     * @default new Color(0.3, 0.9, 0.6)
     * @type {Color}
     */
    color: null,
    /**
     * @constructs
     * @param {object} [params] 初始化参数
     */
    constructor(params) {
        CameraHelper.superclass.constructor.call(this, params);

        if (!this.color) {
            this.color = new Color(0.3, 0.9, 0.6);
        }

        this.material = new BasicMaterial({
            lightType: 'NONE',
            diffuse: this.color || new Color(0.5, 0.5, 0.5, 1),
            castShadows: false
        });

        this.geometry = new Geometry({
            mode: LINES,
            isStatic: false,
            vertices: new GeometryData(new Float32Array(9 * 3), 3),
            indices: new GeometryData(new Uint16Array([
                0, 1, 1, 2, 2, 3, 3, 0,
                4, 5, 5, 6, 6, 7, 7, 4,
                0, 4, 1, 5, 2, 6, 3, 7,
                8, 4, 8, 5, 8, 6, 8, 7,
            ]), 1)
        });
    },
    onUpdate() {
        if (this.camera) {
            this.camera.updateViewProjectionMatrix();
            this._buildGeometry();
        }
    },
    _buildGeometry() {
        const camera = this.camera;
        const geometry = this.geometry;
        const width = 1;
        const height = 1;
        const depth = 1;

        tempMatrix4.multiply(camera.viewProjectionMatrix, this.worldMatrix);
        tempMatrix4.invert();
        geometry.vertices.set(0, tempVector3.set(-width, -height, depth).transformMat4(tempMatrix4));
        geometry.vertices.set(1, tempVector3.set(-width, height, depth).transformMat4(tempMatrix4));
        geometry.vertices.set(2, tempVector3.set(width, height, depth).transformMat4(tempMatrix4));
        geometry.vertices.set(3, tempVector3.set(width, -height, depth).transformMat4(tempMatrix4));
        geometry.vertices.set(4, tempVector3.set(-width, -height, -depth).transformMat4(tempMatrix4));
        geometry.vertices.set(5, tempVector3.set(-width, height, -depth).transformMat4(tempMatrix4));
        geometry.vertices.set(6, tempVector3.set(width, height, -depth).transformMat4(tempMatrix4));
        geometry.vertices.set(7, tempVector3.set(width, -height, -depth).transformMat4(tempMatrix4));
        geometry.vertices.set(8, tempVector3.set(0, 0, -depth).transformMat4(tempMatrix4));
    }
});

export default CameraHelper;
