import Node, { type NodeParameters } from './Node';
import Ray from '../math/Ray';
import Matrix4 from '../math/Matrix4';
import type Vector3 from '../math/Vector3';
import type Geometry from '../geometry/Geometry';
import type Material from '../material/Material';
import type { Renderer } from '../renderer/Renderer';
import type { ShaderOptions } from '../renderer/types';
const tempRay = new Ray();
const tempMatrix4 = new Matrix4();

export interface MeshParameters extends NodeParameters {
    geometry?: Geometry | null;
    material?: Material | null;
    useInstanced?: boolean;
    frustumTest?: boolean;
}
/**
 * Mesh
 * @example
 * ```ts
 * const mesh = new Hilo3d.Mesh({
 *     geometry: new Hilo3d.BoxGeometry(),
 *     material: new Hilo3d.BasicMaterial({
 *         diffuse: new Hilo3d.Color(0.8, 0, 0)
 *     }),
 *     x:100,
 *     rotationX:30
 * });
 * stage.addChild(mesh);
 * ```
 */
class Mesh extends Node {
    static override readonly typeName: string = 'Mesh';
    protected _isDestroyed = false;
    override isMesh = true;
    override className = 'Mesh';
    geometry: Geometry | null = null;
    material: Material | null = null;
    /**
     * 是否使用 Instanced
     */
    useInstanced = false;
    /**
     * 是否开启视锥体裁剪
     */
    frustumTest = true;
    /**
     * @param params - 初始化参数，所有params都会复制到实例上
     * - `params.geometry`: 几何体
     * - `params.material`: 材质
     */
    constructor(params: MeshParameters = {}) {
        super();
        Object.assign(this, params);
    }
    /**
     * clone 当前mesh
     * @param isChild - 是否子元素
     * @returns 返回clone的实例
     */
    override clone(isChild?: boolean): Mesh {
        const node = super.clone(isChild);
        if (!(node instanceof Mesh)) {
            throw new TypeError('Mesh subclasses must construct Mesh-compatible instances.');
        }
        Object.assign(node, {
            geometry: this.geometry,
            material: this.material
        });
        return node;
    }
    /**
     * raycast
     * @param ray -
     * @param sort - 是否按距离排序
     */
    override raycast(ray: Ray, sort = true): Vector3[] | null {
        if (!this.visible) {
            return null;
        }
        const geometry = this.geometry;
        const material = this.material;
        const worldMatrix = this.worldMatrix;
        if (geometry && material) {
            tempMatrix4.invert(worldMatrix);
            tempRay.copy(ray);
            tempRay.transformMat4(tempMatrix4);
            const res = geometry.raycast(tempRay, material.side, sort);
            if (res) {
                res.forEach(point => {
                    point.transformMat4(worldMatrix);
                });
                return res;
            }
        }
        return null;
    }
    /**
     * 获取渲染选项值
     * @param opt - 渲染选项值
     * @returns 渲染选项值
     */
    getRenderOption(opt: ShaderOptions = {}): ShaderOptions {
        this.geometry?.getRenderOption(opt);
        return opt;
    }
    /**
     * 是否被销毁
     */
    get isDestroyed(): boolean {
        return this._isDestroyed;
    }
    /**
     * 销毁 Mesh 资源
     * @param renderer -
     * @param needDestroyTextures - 是否销毁材质的贴图，默认不销毁
     * @returns this
     */
    override destroy(renderer?: Renderer, needDestroyTextures = false): this {
        if (this._isDestroyed) {
            return this;
        }
        if (!renderer) {
            throw new Error('A renderer is required to destroy a Mesh.');
        }
        this.removeFromParent();
        const resourceManager = renderer.resourceManager;
        resourceManager.destroyMesh(this);
        if (this.material && needDestroyTextures) {
            this.material.destroyTextures();
        }
        this.off();
        this.geometry = null;
        this.material = null;
        this._isDestroyed = true;
        return this;
    }
}
export default Mesh;
