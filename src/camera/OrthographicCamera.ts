import Camera, { type CameraParameters } from './Camera';
import Geometry from '../geometry/Geometry';

export interface OrthographicCameraParameters extends CameraParameters {
    left?: number;
    right?: number;
    top?: number;
    bottom?: number;
    near?: number;
    far?: number;
}
/**
 * 正交投影摄像机
 */
class OrthographicCamera extends Camera {
    static override readonly typeName: string = 'OrthographicCamera';
    override isOrthographicCamera = true;
    override className = 'OrthographicCamera';
    private _left = -1;
    get left(): number {
        return this._left;
    }
    set left(value: number) {
        this._needUpdateProjectionMatrix = true;
        this._isGeometryDirty = true;
        this._left = value;
    }
    private _right = 1;
    get right(): number {
        return this._right;
    }
    set right(value: number) {
        this._needUpdateProjectionMatrix = true;
        this._isGeometryDirty = true;
        this._right = value;
    }
    private _bottom = -1;
    get bottom(): number {
        return this._bottom;
    }
    set bottom(value: number) {
        this._needUpdateProjectionMatrix = true;
        this._isGeometryDirty = true;
        this._bottom = value;
    }
    private _top = 1;
    get top(): number {
        return this._top;
    }
    set top(value: number) {
        this._needUpdateProjectionMatrix = true;
        this._isGeometryDirty = true;
        this._top = value;
    }
    private _near = 0.1;
    get near(): number {
        return this._near;
    }
    set near(value: number) {
        this._needUpdateProjectionMatrix = true;
        this._isGeometryDirty = true;
        this._near = value;
    }
    private _far = 1;
    get far(): number {
        return this._far;
    }
    set far(value: number) {
        this._needUpdateProjectionMatrix = true;
        this._isGeometryDirty = true;
        this._far = value;
    }
    /**
     * @param params - 创建对象的属性参数。可包含此类的所有属性。
     * - `params.left`:
     * - `params.right`:
     * - `params.top`:
     * - `params.bottom`:
     * - `params.near`:
     * - `params.far`:
     */
    constructor(params: OrthographicCameraParameters = {}) {
        super();
        Object.assign(this, params);
        this.updateProjectionMatrix();
    }
    /**
     * 更新投影矩阵
     */
    override updateProjectionMatrix(): void {
        const { left, right, bottom, top, near, far } = this;
        if (![left, right, bottom, top, near, far].every(Number.isFinite)) {
            throw new RangeError('OrthographicCamera projection bounds must be finite.');
        }
        if (left === right || bottom === top || far <= near) {
            throw new RangeError(
                'OrthographicCamera bounds must be non-degenerate and far must be greater than near.'
            );
        }
        this.projectionMatrix.ortho(
            left,
            right,
            bottom,
            top,
            this.depthMode === 'reversed' ? far : near,
            this.depthMode === 'reversed' ? near : far
        );
    }
    override getGeometry(forceUpdate = false): Geometry {
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
