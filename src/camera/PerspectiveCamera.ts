import math from '../math/math';
import Camera from './Camera';
import Geometry from '../geometry/Geometry';

/**
 * 透视投影摄像机
 * @class
 * @extends Camera
 */
class PerspectiveCamera extends Camera {
    /**
     * @default true
     * @type {boolean}
     */
    isPerspectiveCamera: boolean = true;

    /**
     * @default PerspectiveCamera
     * @type {string}
     */
    className: string = 'PerspectiveCamera';

    private _near: number = 0.1;

    private _far: number | null = null;

    private _fov: number = 50;

    private _aspect: number = 1;

    /**
     * 相机视锥体近平面z
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
     * 相机视锥体远平面z，null 时为无限远
     * @default null
     * @type {number}
     */
    get far(): number | null {
        return this._far;
    }

    set far(value: number | null) {
        this._needUpdateProjectionMatrix = true;
        this._isGeometryDirty = true;
        this._far = value;
    }

    /**
     * 相机视野大小，角度制
     * @default 50
     * @type {number}
     */
    get fov(): number {
        return this._fov;
    }

    set fov(value: number) {
        this._needUpdateProjectionMatrix = true;
        this._isGeometryDirty = true;
        this._fov = value;
    }

    /**
     * 宽高比
     * @default 1
     * @type {number}
     */
    get aspect(): number {
        return this._aspect;
    }

    set aspect(value: number) {
        this._needUpdateProjectionMatrix = true;
        this._isGeometryDirty = true;
        this._aspect = value;
    }

    /**
     * @constructs
     * @param {Object} [params] 创建对象的属性参数。可包含此类的所有属性。
     * @param {number} [params.fov=50] 相机视野大小，角度制
     * @param {number} [params.near=0.1] 相机视锥体近平面z
     * @param {number} [params.far=null] 相机视锥体远平面z，null 时为无限远
     * @param {number} [params.aspect=1] 宽高比
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
    }

    /**
     * 获取几何体
     * @param {Boolean} forceUpdate 是否强制更新
     * @return {Geometry} 摄像机视锥体几何体，如果far为null则返回undefined
     */
    getGeometry(forceUpdate?: boolean): Geometry | undefined {
        if (forceUpdate || !this._geometry || this._isGeometryDirty) {
            this._isGeometryDirty = false;

            const geometry = new Geometry();
            const tan = Math.tan(this.fov / 2 * Math.PI / 180);
            const near = this.near;
            const far = this.far;

            if (!far) {
                return undefined;
            }

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
}

export default PerspectiveCamera;
