import Camera from './Camera';
import Geometry from '../geometry/Geometry';

/**
 * 正交投影摄像机
 * @class
 * @extends Camera
 */
class OrthographicCamera extends Camera {
    /**
     * @default true
     * @type {boolean}
     */
    isOrthographicCamera: boolean = true;

    /**
     * @default OrthographicCamera
     * @type {string}
     */
    className: string = 'OrthographicCamera';

    private _left: number = -1;

    private _right: number = 1;

    private _bottom: number = -1;

    private _top: number = 1;

    private _near: number = 0.1;

    private _far: number = 1;

    /**
     * @default -1
     * @type {number}
     */
    get left(): number {
        return this._left;
    }

    set left(value: number) {
        this._needUpdateProjectionMatrix = true;
        this._isGeometryDirty = true;
        this._left = value;
    }

    /**
     * @default 1
     * @type {number}
     */
    get right(): number {
        return this._right;
    }

    set right(value: number) {
        this._needUpdateProjectionMatrix = true;
        this._isGeometryDirty = true;
        this._right = value;
    }

    /**
     * @default -1
     * @type {number}
     */
    get bottom(): number {
        return this._bottom;
    }

    set bottom(value: number) {
        this._needUpdateProjectionMatrix = true;
        this._isGeometryDirty = true;
        this._bottom = value;
    }

    /**
     * @default 1
     * @type {number}
     */
    get top(): number {
        return this._top;
    }

    set top(value: number) {
        this._needUpdateProjectionMatrix = true;
        this._isGeometryDirty = true;
        this._top = value;
    }

    /**
     * @default 0.1
     * @type {number}
     */
    get near(): number {
        return this._near;
    }

    set near(value: number) {
        this._needUpdateProjectionMatrix = true;
        this._isGeometryDirty = true;
        this._near = value;
    }

    /**
     * @default 1
     * @type {number}
     */
    get far(): number {
        return this._far;
    }

    set far(value: number) {
        this._needUpdateProjectionMatrix = true;
        this._isGeometryDirty = true;
        this._far = value;
    }

    /**
     * @constructs
     * @param {object} [params] 创建对象的属性参数。可包含此类的所有属性。
     * @param {number} [params.left=1]
     * @param {number} [params.right=1]
     * @param {number} [params.top=1]
     * @param {number} [params.bottom=1]
     * @param {number} [params.near=0.1]
     * @param {number} [params.far=1]
     * @param {any} [params.[value:string]] 其它属性
     */
    constructor(params?: any) {
        super(params);
        this.updateProjectionMatrix();
    }

    /**
     * 更新投影矩阵
     */
    updateProjectionMatrix(): void {
        this.projectionMatrix.ortho(this.left, this.right, this.bottom, this.top, this.near, this.far);
    }

    getGeometry(forceUpdate?: boolean): Geometry {
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
}

export default OrthographicCamera;
