import Class from './Class';
import Node from './Node';
import Ray from '../math/Ray';
import Matrix4 from '../math/Matrix4';

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
const Mesh = Class.create(/** @lends Mesh.prototype */ {
    Extends: Node,
    /**
     * @default true
     * @type {boolean}
     */
    isMesh: true,
    /**
     * @default Mesh
     * @type {string}
     */
    className: 'Mesh',
    /**
     * @type {Geometry}
     */
    geometry: null,
    /**
     * @type {Material}
     */
    material: null,
    /**
     * 是否使用 Instanced
     * @default false
     * @type {boolean}
     */
    useInstanced: false,
    /**
     * 是否开启视锥体裁剪
     * @default true
     * @type {Boolean}
     */
    frustumTest: true,
    /**
     * @constructs
     * @param {object} params 初始化参数，所有params都会复制到实例上
     */
    constructor(params) {
        Mesh.superclass.constructor.call(this, params);

        // store webgl resource
        this._usedResourceDict = {};
    },
    /**
     * clone 当前mesh
     * @param {boolean} isChild 是否子元素
     * @return {Mesh} 返回clone的实例
     */
    clone(isChild) {
        const node = Node.prototype.clone.call(this, isChild);
        Object.assign(node, {
            geometry: this.geometry,
            material: this.material
        });
        return node;
    },
    /**
     * raycast
     * @param  {Ray} ray
     * @param {Boolean} [sort=true] 是否按距离排序
     * @return {Vector3[]|null}
     */
    raycast(ray, sort = true) {
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
                res.forEach((point) => {
                    point.transformMat4(worldMatrix);
                });

                return res;
            }
        }
        return null;
    },
    getRenderOption(opt = {}) {
        this.geometry.getRenderOption(opt);
        return opt;
    },
    useResource(res) {
        if (res) {
            this._usedResourceDict[res.className + ':' + res.id] = res;
        }
    },

    /**
     * 销毁 Mesh 资源
     * @param {WebGLRenderer} renderer
     * @param {Boolean} [destroyTextures=false] 是否销毁材质的贴图，默认不销毁
     * @return {Mesh} this
     */
    destroy(renderer, needDestroyTextures = false) {
        if (this._isDestroyed) {
            return this;
        }

        this.removeFromParent();

        const resourceManager = renderer.resourceManager;
        const _usedResourceDict = this._usedResourceDict;

        for (let id in _usedResourceDict) {
            resourceManager.destroyIfNoRef(_usedResourceDict[id]);
        }

        if (this.material && needDestroyTextures) {
            this.material.destroyTextures();
        }

        this.off();
        this._usedResourceDict = null;
        this.geometry = null;
        this.material = null;
        this._isDestroyed = true;

        return this;
    }
});

export default Mesh;
