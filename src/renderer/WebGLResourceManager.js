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
        Object.assign(this, params);
    },

    destroyMesh(mesh) {
        const resources = this.getMeshResources(mesh);
        resources.forEach((resource) => {
            this.destroyIfNoRef(resource);
        });
        mesh._vao = mesh._program = mesh._shader = null;
    },

    getMeshResources(mesh, resources = []) {
        if (mesh._shader) {
            resources.push(mesh._shader);
        }

        if (mesh._vao) {
            resources.push(mesh._vao);
            mesh._vao.getResources(resources);
        }

        if (mesh._program) {
            resources.push(mesh._program);
        }

        return resources;
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
     * 获取用到的资源
     * @param  {Stage} stage
     * @return {Object[]}
     */
    getUsedResources(stage) {
        const resources = [];
        stage.traverse((node) => {
            if (node.isMesh && !node.isDestroyed) {
                this.getMeshResources(node, resources);
            }
        });

        return resources;
    },

    /**
     * 销毁没被使用的资源
     * @return {WebGLResourceManager} this
     */
    destroyUnsuedResource(stage) {
        const needDestroyResources = this._needDestroyResources;
        if (needDestroyResources.length === 0) {
            return this;
        }

        const usedResources = this.getUsedResources(stage);

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
