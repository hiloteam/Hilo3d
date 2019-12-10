import Class from '../core/Class';
import Mesh from '../core/Mesh';
import Geometry from '../geometry/Geometry';
import GeometryData from '../geometry/GeometryData';
import BasicMaterial from '../material/BasicMaterial';
import Vector3 from '../math/Vector3';
import Color from '../math/Color';

import constants from '../constants';

const {
    LINES
} = constants;

const tempVector3 = new Vector3();
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
            diffuse: this.color || new Color(0.5, 0.5, 0.5, 1)
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

        geometry.vertices.set(0, camera.unprojectVector(tempVector3.set(-width, -height, depth)));
        geometry.vertices.set(1, camera.unprojectVector(tempVector3.set(-width, height, depth)));
        geometry.vertices.set(2, camera.unprojectVector(tempVector3.set(width, height, depth)));
        geometry.vertices.set(3, camera.unprojectVector(tempVector3.set(width, -height, depth)));
        geometry.vertices.set(4, camera.unprojectVector(tempVector3.set(-width, -height, -depth)));
        geometry.vertices.set(5, camera.unprojectVector(tempVector3.set(-width, height, -depth)));
        geometry.vertices.set(6, camera.unprojectVector(tempVector3.set(width, height, -depth)));
        geometry.vertices.set(7, camera.unprojectVector(tempVector3.set(width, -height, -depth)));

        geometry.vertices.set(8, camera.worldMatrix.getTranslation(tempVector3));
    }
});

export default CameraHelper;
