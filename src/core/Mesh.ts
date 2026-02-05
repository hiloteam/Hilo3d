import Node from './Node';
import Ray from '../math/Ray';
import Matrix4 from '../math/Matrix4';
import type Vector3 from '../math/Vector3';
import type { Geometry } from '../geometry/Geometry';
import type { Material } from '../material/Material';
import type WebGLRenderer from '../renderer/WebGLRenderer';

const tempRay = new Ray();
const tempMatrix4 = new Matrix4();

/**
 * Mesh
 * @class
 * @extends Node
 * @example
 * const mesh = new Hilo3d.Mesh({
 *     geometry: new Hilo3d.BoxGeometry(),
 *     material: new Hilo3d.BasicMaterial({
 *         diffuse: new Hilo3d.Color(0.8, 0, 0)
 *     }),
 *     x:100,
 *     rotationX:30
 * });
 * stage.addChild(mesh);
 */
class Mesh extends Node {
    /**
     * @default true
     * @type {boolean}
     */
    isMesh: boolean = true;

    /**
     * @default Mesh
     * @type {string}
     */
    className: string = 'Mesh';

    /**
     * @type {Geometry}
     */
    geometry: any = null;

    /**
     * @type {Material}
     */
    material: any = null;

    /**
     * 是否使用 Instanced
     * @default false
     * @type {boolean}
     */
    useInstanced: boolean = false;

    /**
     * 是否开启视锥体裁剪
     * @default true
     * @type {Boolean}
     */
    frustumTest: boolean = true;

    private _isDestroyed: boolean = false;

    /**
     * @constructs
     * @param {Object} [params] 初始化参数，所有params都会复制到实例上
     * @param {Geometry} [params.geometry] 几何体
     * @param {Material} [params.material] 材质
     * @param {any} [params.[value:string]] 其它属性
     */
    constructor(params?: any) {
        super(params);
    }

    /**
     * clone 当前mesh
     * @param {boolean} isChild 是否子元素
     * @return {Mesh} 返回clone的实例
     */
    clone(isChild?: boolean): Mesh {
        const node = super.clone(isChild) as Mesh;
        Object.assign(node, {
            geometry: this.geometry,
            material: this.material
        });
        return node;
    }

    /**
     * raycast
     * @param  {Ray} ray
     * @param {Boolean} [sort=true] 是否按距离排序
     * @return {Vector3[]|null}
     */
    raycast(ray: Ray, sort: boolean = true): Vector3[] | null {
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
                res.forEach((point: Vector3) => {
                    point.transformMat4(worldMatrix);
                });

                return res;
            }
        }
        return null;
    }

    /**
     * 获取渲染选项值
     * @param  {Object} [option={}] 渲染选项值
     * @return {Object} 渲染选项值
     */
    getRenderOption(opt: any = {}): any {
        this.geometry.getRenderOption(opt);
        return opt;
    }

    /**
     * 是否被销毁
     * @readOnly
     * @type {Boolean}
     */
    get isDestroyed(): boolean {
        return this._isDestroyed;
    }

    /**
     * 销毁 Mesh 资源
     * @param {WebGLRenderer} renderer
     * @param {Boolean} [destroyTextures=false] 是否销毁材质的贴图，默认不销毁
     * @return {Mesh} this
     */
    destroy(renderer: any, needDestroyTextures: boolean = false): Mesh {
        if (this._isDestroyed) {
            return this;
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
