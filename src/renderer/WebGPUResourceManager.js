import Class from '../core/Class';
import EventMixin from '../core/EventMixin';

/**
 * WebGPUResourceManager 资源管理器
 * @mixes EventMixin
 * @fires destroyResource 销毁资源
 * @class
 */
const WebGPUResourceManager = Class.create(/** @lends WebGPUResourceManager.prototype */{
    Mixes: EventMixin,
    /**
     * 类名
     * @type {String}
     * @default WebGPUResourceManager
     */
    className: 'WebGPUResourceManager',

    /**
     * @type {Boolean}
     * @default true
     */
    isWebGPUResourceManager: true,

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
        this._buffers = new Map();
        this._textures = new Map();
        this._pipelines = new Map();
        this._bindGroups = new Map();
        Object.assign(this, params);
    },

    /**
     * 销毁mesh相关资源
     * @param {Mesh} mesh
     */
    destroyMesh(mesh) {
        const resources = this.getMeshResources(mesh);
        resources.forEach((resource) => {
            this.destroyIfNoRef(resource);
        });
        delete this._meshDict[mesh.id];
    },

    /**
     * 获取mesh资源
     * @param {Mesh} mesh
     * @return {Array}
     */
    getMeshResources(mesh) {
        if (!this._meshDict[mesh.id]) {
            this._meshDict[mesh.id] = [];
        }
        return this._meshDict[mesh.id];
    },

    /**
     * 添加资源到mesh
     * @param {Mesh} mesh
     * @param {Object} resource
     */
    addMeshResource(mesh, resource) {
        const resources = this.getMeshResources(mesh);
        if (resources.indexOf(resource) === -1) {
            resources.push(resource);
        }
    },

    /**
     * 添加需要销毁的资源
     * @param {Object} resource
     */
    addNeedDestroyResource(resource) {
        if (this._needDestroyResources.indexOf(resource) === -1) {
            this._needDestroyResources.push(resource);
            this.hasNeedDestroyResource = true;
        }
    },

    /**
     * 如果没有引用就销毁资源
     * @param {Object} resource
     */
    destroyIfNoRef(resource) {
        if (resource && resource._gpuResource) {
            if (resource._gpuResource.destroy) {
                resource._gpuResource.destroy();
            }
            resource._gpuResource = null;
        }
        this.addNeedDestroyResource(resource);
    },

    /**
     * 销毁资源
     */
    destroyResource() {
        this._needDestroyResources.forEach((resource) => {
            if (resource) {
                this.fire('destroyResource', resource);
            }
        });
        this._needDestroyResources.length = 0;
        this.hasNeedDestroyResource = false;
    },

    /**
     * 缓存GPU缓冲区
     * @param {Object} key
     * @param {GPUBuffer} buffer
     */
    setBuffer(key, buffer) {
        this._buffers.set(key, buffer);
    },

    /**
     * 获取GPU缓冲区
     * @param {Object} key
     * @return {GPUBuffer}
     */
    getBuffer(key) {
        return this._buffers.get(key);
    },

    /**
     * 缓存GPU纹理
     * @param {Object} key
     * @param {GPUTexture} texture
     */
    setTexture(key, texture) {
        this._textures.set(key, texture);
    },

    /**
     * 获取GPU纹理
     * @param {Object} key
     * @return {GPUTexture}
     */
    getTexture(key) {
        return this._textures.get(key);
    },

    /**
     * 缓存GPU管线
     * @param {Object} key
     * @param {GPURenderPipeline} pipeline
     */
    setPipeline(key, pipeline) {
        this._pipelines.set(key, pipeline);
    },

    /**
     * 获取GPU管线
     * @param {Object} key
     * @return {GPURenderPipeline}
     */
    getPipeline(key) {
        return this._pipelines.get(key);
    },

    /**
     * 缓存GPU绑定组
     * @param {Object} key
     * @param {GPUBindGroup} bindGroup
     */
    setBindGroup(key, bindGroup) {
        this._bindGroups.set(key, bindGroup);
    },

    /**
     * 获取GPU绑定组
     * @param {Object} key
     * @return {GPUBindGroup}
     */
    getBindGroup(key) {
        return this._bindGroups.get(key);
    }
});

export default WebGPUResourceManager;
