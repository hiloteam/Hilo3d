import RenderTransformView, {
    type RenderTransformViewParameters
} from '../render/world/RenderTransformView';
import Matrix4 from '../math/Matrix4';
import Frustum from '../math/Frustum';
import Sphere from '../math/Sphere';
import type Vector3 from '../math/Vector3';
import Geometry from '../geometry/Geometry';
import type Mesh from '../core/Mesh';
const tempMatrix4 = new Matrix4();
const tempSphere = new Sphere();

/** Depth convention used by projection, depth testing, shadows, and picking. */
export type CameraDepthMode = 'standard' | 'reversed';

function assertCameraDepthMode(value: unknown): asserts value is CameraDepthMode {
    if (value !== 'standard' && value !== 'reversed') {
        throw new TypeError('Camera.depthMode must be "standard" or "reversed".');
    }
}

export interface CameraParameters extends RenderTransformViewParameters {
    /**
     * Depth convention. `reversed` maps the near plane to 1 and far/infinity to 0, improving
     * floating-point depth precision. Defaults to `standard` for compatibility.
     */
    depthMode?: CameraDepthMode;
    /**
     * Camera visibility bit mask. A render record is collected when
     * `(camera.visibility & record.layer) !== 0`.
     */
    visibility?: number;
    /**
     * Clear the current color attachment when this camera follows another camera in the same
     * application frame. The first camera always clears.
     */
    clearColor?: boolean;
    /** Clear depth before this camera when composing multiple cameras. */
    clearDepth?: boolean;
    /** Clear stencil before this camera when composing multiple cameras. */
    clearStencil?: boolean;
    /** Camera composition priority. Lower values render first. */
    priority?: number;
}
/**
 * 摄像机
 */
class Camera extends RenderTransformView {
    static readonly typeName: string = 'RenderCamera';
    readonly viewMatrix = new Matrix4();
    /** Stable non-jittered projection used by CPU culling, picking, and project/unproject. */
    readonly projectionMatrix = new Matrix4();
    /** Raster projection with the current sub-pixel clip-space jitter applied. */
    readonly jitteredProjectionMatrix = new Matrix4();
    /** Stable non-jittered view-projection used by CPU visibility and interaction queries. */
    readonly viewProjectionMatrix = new Matrix4();
    /** Raster view-projection with the current sub-pixel clip-space jitter applied. */
    readonly jitteredViewProjectionMatrix = new Matrix4();
    protected readonly _frustum = new Frustum();
    protected _geometry: Geometry | null = null;
    readonly isCamera = true;
    isPerspectiveCamera = false;
    isOrthographicCamera = false;
    className = 'RenderCamera';
    /**
     * Visibility mask used by shared scene collection and ECS pointer picking.
     *
     * The default exposes every 32-bit layer. Use `0` to disable scene collection for a camera.
     */
    visibility = 0xffffffff;
    /**
     * Whether this camera clears the color attachment. The base Camera defaults to clearing;
     * Camera2D defaults to preserving prior camera color for overlays.
     */
    clearColor = true;
    /** Whether this camera clears depth before drawing. */
    clearDepth = true;
    /** Whether this camera clears stencil before drawing. */
    clearStencil = true;
    private depthModeValue: CameraDepthMode = 'standard';
    /** Active projection/depth-buffer convention. */
    get depthMode(): CameraDepthMode {
        return this.depthModeValue;
    }
    set depthMode(value: CameraDepthMode) {
        assertCameraDepthMode(value);
        if (value === this.depthModeValue) return;
        this.depthModeValue = value;
        this._needUpdateProjectionMatrix = true;
        this._isGeometryDirty = true;
        this.invalidateTransformHistory();
    }
    private priorityValue = 0;
    /** Camera composition priority. Lower values render first and receive pointer input last. */
    get priority(): number {
        return this.priorityValue;
    }
    set priority(value: number) {
        if (!Number.isFinite(value)) {
            throw new RangeError('Camera.priority must be finite.');
        }
        this.priorityValue = value;
    }
    /**
     * 是否需要更新投影矩阵
     */
    protected _needUpdateProjectionMatrix = true;
    protected _isGeometryDirty = false;
    private projectionJitterXValue = 0;
    private projectionJitterYValue = 0;
    private extractedWorldMatrix = false;
    /**
     * @param params - 创建对象的属性参数。可包含此类的所有属性。
     */
    constructor(params: CameraParameters = {}) {
        super('RenderCamera');
        Object.assign(this, params);
    }
    /**
     * Return whether this camera can see a render record's layer mask.
     * @param node - Renderer-local record to test.
     */
    isLayerVisible(node: { readonly layer: number }): boolean {
        return ((this.visibility >>> 0) & (node.layer >>> 0)) !== 0;
    }
    /**
     * 更新viewMatrix
     * @returns this
     */
    updateViewMatrix(): this {
        if (!this.extractedWorldMatrix) this.updateMatrixWorld(true);
        this.viewMatrix.invert(this.worldMatrix);
        return this;
    }

    /** Synchronize this renderer-local view from ECS WorldTransform storage. @internal */
    override setExtractedWorldMatrix(
        source: ArrayLike<number>,
        offset: number,
        revision: number
    ): void {
        super.setExtractedWorldMatrix(source, offset, revision);
        this.extractedWorldMatrix = true;
    }
    /**
     * 更新投影矩阵，子类必须重载这个方法
     */
    updateProjectionMatrix(): void {
        this.projectionMatrix.identity();
        this.updateJitteredProjectionMatrix();
    }
    /** Horizontal raster jitter in normalized-device coordinates. */
    get projectionJitterX(): number {
        return this.projectionJitterXValue;
    }
    /** Vertical raster jitter in normalized-device coordinates. */
    get projectionJitterY(): number {
        return this.projectionJitterYValue;
    }
    /**
     * Apply a sub-pixel raster offset without changing the stable CPU projection.
     *
     * Temporal render features use normalized-device coordinates, where one physical pixel is
     * `2 / attachmentSize`. Culling, picking, project/unproject, and camera helpers continue to
     * consume `projectionMatrix` and `viewProjectionMatrix`.
     * @param x - Horizontal normalized-device offset.
     * @param y - Vertical normalized-device offset.
     * @returns this
     */
    setProjectionJitter(x: number, y: number): this {
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            throw new RangeError('Camera projection jitter must contain finite values.');
        }
        if (x === this.projectionJitterXValue && y === this.projectionJitterYValue) return this;
        this.projectionJitterXValue = x;
        this.projectionJitterYValue = y;
        this.updateJitteredProjectionMatrix();
        this.jitteredViewProjectionMatrix.multiply(this.jitteredProjectionMatrix, this.viewMatrix);
        return this;
    }
    /** Clear the raster jitter while preserving transform history. */
    clearProjectionJitter(): this {
        return this.setProjectionJitter(0, 0);
    }
    /**
     * 获取几何体，子类必须重写
     * @param forceUpdate - 是否强制更新
     */
    getGeometry(forceUpdate = false): Geometry {
        if (forceUpdate || !this._geometry) this._geometry = new Geometry();
        return this._geometry;
    }
    /**
     * 更新viewProjectionMatrix
     * @returns this
     */
    updateViewProjectionMatrix(): this {
        if (this._needUpdateProjectionMatrix) {
            this.updateProjectionMatrix();
            this._needUpdateProjectionMatrix = false;
        }
        this.updateViewMatrix();
        this.viewProjectionMatrix.multiply(this.projectionMatrix, this.viewMatrix);
        this.jitteredViewProjectionMatrix.multiply(this.jitteredProjectionMatrix, this.viewMatrix);
        this.updateFrustum(this.viewProjectionMatrix);
        return this;
    }
    /** Rebuild the raster projection by translating clip coordinates before perspective divide. */
    protected updateJitteredProjectionMatrix(): void {
        const source = this.projectionMatrix.elements;
        this.jitteredProjectionMatrix.copy(this.projectionMatrix);
        const destination = this.jitteredProjectionMatrix.elements;
        const x = this.projectionJitterXValue;
        const y = this.projectionJitterYValue;
        destination[0] = source[0] + x * source[3];
        destination[4] = source[4] + x * source[7];
        destination[8] = source[8] + x * source[11];
        destination[12] = source[12] + x * source[15];
        destination[1] = source[1] + y * source[3];
        destination[5] = source[5] + y * source[7];
        destination[9] = source[9] + y * source[11];
        destination[13] = source[13] + y * source[15];
    }
    /**
     * 获取元素相对于当前Camera的矩阵
     * @param node - 目标元素
     * @param out - 传递将在这个矩阵上做计算，不传将创建一个新的 Matrix4
     * @returns 返回获取的矩阵
     */
    getModelViewMatrix(node: { readonly worldMatrix: Matrix4 }, out?: Matrix4): Matrix4 {
        out ??= new Matrix4();
        out.multiply(this.viewMatrix, node.worldMatrix);
        return out;
    }
    /**
     * 获取元素的投影矩阵
     * @param node - 目标元素
     * @param out - 传递将在这个矩阵上做计算，不传将创建一个新的 Matrix4
     * @returns 返回获取的矩阵
     */
    getModelProjectionMatrix(node: { readonly worldMatrix: Matrix4 }, out?: Matrix4): Matrix4 {
        out ??= new Matrix4();
        out.multiply(this.viewProjectionMatrix, node.worldMatrix);
        return out;
    }
    /**
     * 获取世界坐标系(三维)中一个点在画布(二维)上的位置
     * @param vector - 点坐标
     * @param width - 画布宽，不传的话返回-1~1
     * @param height - 画布高，不传的话返回-1~1
     * @returns 返回获取的坐标位置，如 `{ x: 0, y: 0 }`
     */
    projectVector(vector: Vector3, width?: number, height?: number): Vector3 {
        const result = vector.clone();
        result.transformMat4(this.viewProjectionMatrix);
        if (width && height) {
            result.x = ((result.x + 1) / 2) * width;
            result.y = height - ((result.y + 1) / 2) * height;
        }
        return result;
    }
    /**
     * 屏幕坐标转换世界坐标系
     * @param vector - 点坐标
     * @param width - 画布宽，传的话vector会认为是屏幕坐标
     * @param height - 画布高，传的话vector会认为是屏幕坐标
     * @returns 返回世界坐标系(三维)中一个点
     */
    unprojectVector(vector: Vector3, width?: number, height?: number): Vector3 {
        const result = vector.clone();
        if (width && height) {
            result.x = (result.x / width) * 2 - 1;
            result.y = 1 - (result.y / height) * 2;
        }
        tempMatrix4.invert(this.viewProjectionMatrix);
        result.transformMat4(tempMatrix4);
        return result;
    }
    /**
     * point是否摄像机可见
     * @param point -
     */
    isPointVisible(point: Vector3): boolean {
        tempSphere.center.copy(point);
        tempSphere.radius = 0;
        return this._frustum.intersectsSphere(tempSphere);
    }
    /** Return whether a world-space bounding sphere intersects the stable camera frustum. */
    isSphereVisible(sphere: Sphere): boolean {
        return this._frustum.intersectsSphere(sphere);
    }
    /**
     * mesh 是否摄像机可见
     * @param mesh -
     */
    isMeshVisible(mesh: Mesh): boolean {
        return mesh.geometry !== null && this._frustum.intersectsSphere(mesh.worldBounds);
    }
    /**
     * 更新 frustum
     * @param matrix -
     * @returns this
     */
    updateFrustum(matrix: Matrix4): this {
        this._frustum.fromMatrix(matrix);
        return this;
    }
}
export default Camera;
