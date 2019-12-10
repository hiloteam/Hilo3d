import Class from '../core/Class';
import Camera from './Camera';
import Geometry from '../geometry/Geometry';

/**
 * 正交投影摄像机
 * @class
 * @extends Camera
 */
const OrthographicCamera = Class.create(/** @lends OrthographicCamera.prototype */ {
    Extends: Camera,

    /**
     * @default true
     * @type {boolean}
     */
    isOrthographicCamera: true,

    /**
     * @default OrthographicCamera
     * @type {string}
     */
    className: 'OrthographicCamera',

    _left: -1,
    /**
     * @default -1
     * @type {number}
     */
    left: {
        get() {
            return this._left;
        },
        set(value) {
            this._needUpdateProjectionMatrix = true;
            this._isGeometryDirty = true;
            this._left = value;
        }
    },

    _right: 1,
    /**
     * @default 1
     * @type {number}
     */
    right: {
        get() {
            return this._right;
        },
        set(value) {
            this._needUpdateProjectionMatrix = true;
            this._isGeometryDirty = true;
            this._right = value;
        }
    },

    _bottom: -1,
    /**
     * @default -1
     * @type {number}
     */
    bottom: {
        get() {
            return this._bottom;
        },
        set(value) {
            this._needUpdateProjectionMatrix = true;
            this._isGeometryDirty = true;
            this._bottom = value;
        }
    },

    _top: 1,
    /**
     * @default 1
     * @type {number}
     */
    top: {
        get() {
            return this._top;
        },
        set(value) {
            this._needUpdateProjectionMatrix = true;
            this._isGeometryDirty = true;
            this._top = value;
        }
    },

    _near: 0.1,
    /**
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

    _far: 1,
    /**
     * @default 1
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

    /**
     * @constructs
     * @param {object} params 创建对象的属性参数。可包含此类的所有属性。
     */
    constructor(params) {
        OrthographicCamera.superclass.constructor.call(this, params);
        this.updateProjectionMatrix();
    },

    /**
     * 更新投影矩阵
     */
    updateProjectionMatrix() {
        this.projectionMatrix.ortho(this.left, this.right, this.bottom, this.top, this.near, this.far);
    },

    getGeometry(forceUpdate) {
        if (forceUpdate || !this._geometry || this._isGeometryDirty) {
            this._isGeometryDirty = false;

            const geometry = new Geometry();

            const p1 = [this.left, this.bottom, -this.near];
            const p2 = [this.right, this.bottom, -this.near];
            const p3 = [this.right, this.top, -this.near];
            const p4 = [this.left, this.top, -this.near];
            const p5 = [this.left, this.bottom, -this.far];
            const p6 = [this.right, this.bottom, -this.far];
            const p7 = [this.right, this.top, -this.far];
            const p8 = [this.left, this.top, -this.far];

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

export default OrthographicCamera;
