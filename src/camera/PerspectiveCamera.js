import Class from '../core/Class';
import math from '../math/math';
import Camera from './Camera';
import Geometry from '../geometry/Geometry';

/**
 * 透视投影摄像机
 * @class
 * @extends Camera
 */
const PerspectiveCamera = Class.create(/** @lends PerspectiveCamera.prototype */ {
    Extends: Camera,

    /**
     * @default true
     * @type {boolean}
     */
    isPerspectiveCamera: true,

    /**
     * @default PerspectiveCamera
     * @type {string}
     */
    className: 'PerspectiveCamera',

    _near: 0.1,
    /**
     * 相机视锥体近平面z
     * @default 0.1
     * @type {number}
     */
    near: {
        get() {
            return this._near;
        },
        set(value) {
            this._needUpdateProjectionMatrix = true;
            this._isGeometryDirty = true;
            this._near = value;
        }
    },

    _far: null,
    /**
     * 相机视锥体远平面z，null 时为无限远
     * @default null
     * @type {number}
     */
    far: {
        get() {
            return this._far;
        },
        set(value) {
            this._needUpdateProjectionMatrix = true;
            this._isGeometryDirty = true;
            this._far = value;
        }
    },

    _fov: 50,
    /**
     * 相机视野大小，角度
     * @default 50
     * @type {number}
     */
    fov: {
        get() {
            return this._fov;
        },
        set(value) {
            this._needUpdateProjectionMatrix = true;
            this._isGeometryDirty = true;
            this._fov = value;
        }
    },

    _aspect: 1,
    /**
     * 宽高比
     * @default 1
     * @type {number}
     */
    aspect: {
        get() {
            return this._aspect;
        },
        set(value) {
            this._needUpdateProjectionMatrix = true;
            this._isGeometryDirty = true;
            this._aspect = value;
        }
    },

    /**
     * @constructs
     * @param {object} params 创建对象的属性参数。可包含此类的所有属性。
     */
    constructor(params) {
        PerspectiveCamera.superclass.constructor.call(this, params);
        this.updateProjectionMatrix();
    },

    /**
     * 更新投影矩阵
     */
    updateProjectionMatrix() {
        // this.projectionMatrix.perspective(math.degToRad(this.fov), this.aspect, this.near, this.far);

        const elements = this.projectionMatrix.elements;
        const {
            near,
            far,
            aspect,
            fov
        } = this;
        const f = 1 / Math.tan(0.5 * math.degToRad(fov));

        elements[0] = f / aspect;
        elements[5] = f;
        elements[11] = -1;
        elements[15] = 0;

        if (far) {
            const nf = 1 / (near - far);
            elements[10] = (near + far) * nf;
            elements[14] = 2 * far * near * nf;
        } else {
            elements[10] = -1;
            elements[14] = -2 * near;
        }
    },

    getGeometry(forceUpdate) {
        if (forceUpdate || !this._geometry || this._isGeometryDirty) {
            this._isGeometryDirty = false;

            const geometry = new Geometry();
            const tan = Math.tan(this.fov / 2 * Math.PI / 180);
            const near = this.near;
            const far = this.far;
            const vNear = near * tan;
            const vFar = far * tan;
            const hNear = this.aspect * vNear;
            const hFar = this.aspect * vFar;

            const p1 = [-hNear, -vNear, -near];
            const p2 = [hNear, -vNear, -near];
            const p3 = [hNear, vNear, -near];
            const p4 = [-hNear, vNear, -near];

            const p5 = [-hFar, -vFar, -far];
            const p6 = [hFar, -vFar, -far];
            const p7 = [hFar, vFar, -far];
            const p8 = [-hFar, vFar, -far];

            geometry.addRect(p5, p6, p7, p8); // front
            geometry.addRect(p6, p2, p3, p7); // right
            geometry.addRect(p2, p1, p4, p3); // back
            geometry.addRect(p1, p5, p8, p4); // left
            geometry.addRect(p8, p7, p3, p4); // top
            geometry.addRect(p1, p2, p6, p5); // bottom

            this._geometry = geometry;
        }

        return this._geometry;
    }
});

export default PerspectiveCamera;
