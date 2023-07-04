import Class from '../core/Class';
import EventMixin from '../core/EventMixin';

/**
 * WebGLResourceManager 资源管理器
 * @mixes EventMixin
 * @fires destroyResource 销毁资源
 * @class
 */
const WebGLResourceManager = Class.create(/** @lends WebGLResourceManager.prototype */{
    Mixes: EventMixin,
    /**
     * 类名
     * @type {String}
     * @default WebGLResourceManager
     */
    className: 'WebGLResourceManager',

    /**
     * @type {Boolean}
     * @default true
     */
    isWebGLResourceManager: true,

    /**
     * 是否有需要销毁的资源
     * @type {Boolean}
     * @default false
     */
    hasNeedDestroyResource: false,


    /**
     * @constructs
     * @param {object} [params] 初始化参数，所有params都会复制到实例上
     */
    constructor(params) {
        this._needDestroyResources = [];
        this._meshDict = {};
        Object.assign(this, params);
    },

    destroyMesh(mesh) {
        const resources = this.getMeshResources(mesh);
        resources.forEach((resource) => {
            this.destroyIfNoRef(resource);
        });
        delete this._meshDict[mesh.id];
    },

    getMeshResources(mesh, resources = []) {
        const meshResources = this._meshDict[mesh.id];
        if (meshResources) {
            meshResources.forEach((meshResource) => {
                resources.push(meshResource);
                if (meshResource.getResources) {
                    meshResource.getResources(resources);
                }
            });
        }
        return resources;
    },

    addMeshResources(mesh, resources) {
        const meshId = mesh.id;
        const meshDict = this._meshDict;
        if (!meshDict[meshId]) {
            meshDict[meshId] = [];
        }
        const meshResources = meshDict[meshId];
        resources.forEach((resource) => {
            if (meshResources.indexOf(resource) === -1) {
                meshResources.push(resource);
            }
        });
    },

    /**
     * 没有引用时销毁资源
     * @param  {Object} res
     * @return {WebGLResourceManager} this
     */
    destroyIfNoRef(res) {
        const _needDestroyResources = this._needDestroyResources;
        if (res && _needDestroyResources.indexOf(res) < 0) {
            _needDestroyResources.push(res);
        }
        return this;
    },

    /**
     * 获取 rootNode 用到的资源
     * @param  {Node} [rootNode] 根节点，不传返回空数组
     * @return {Object[]}
     */
    getUsedResources(rootNode) {
        const resources = [];
        if (rootNode) {
            rootNode.traverse((node) => {
                if (node.isMesh && !node.isDestroyed) {
                    this.getMeshResources(node, resources);
                }
            });
        }

        return resources;
    },

    /**
     * 销毁没被 rootNode 使用的资源，通常传 stage。
     * @param {Node} [rootNode] 根节点，不传代表所有资源都没被使用过。
     * @return {WebGLResourceManager} this
     */
    destroyUnusedResource(rootNode) {
        const needDestroyResources = this._needDestroyResources;
        if (needDestroyResources.length === 0) {
            return this;
        }

        const usedResources = this.getUsedResources(rootNode);

        needDestroyResources.forEach((resource) => {
            if (usedResources.indexOf(resource) < 0) {
                if (resource && resource.destroy && !resource.alwaysUse) {
                    this.fire('destroyResource', resource.id);
                    resource.destroy();
                }
            }
        });

        this.reset();
        return this;
    },

    /**
     * 重置
     * @return {WebGLResourceManager} this
     */
    reset() {
        this._needDestroyResources.length = 0;
        return this;
    }
});

export default WebGLResourceManager;
