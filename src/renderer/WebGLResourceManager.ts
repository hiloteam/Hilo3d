import EventMixin from '../core/EventMixin';

interface Resource {
    id?: string;
    destroy?: () => void;
    alwaysUse?: boolean;
    getResources?: (resources: any[]) => void;
}

interface Mesh {
    id: string;
    isMesh?: boolean;
    isDestroyed?: boolean;
}

interface Node {
    isMesh?: boolean;
    isDestroyed?: boolean;
    traverse?: (callback: (node: any) => void) => void;
}

/**
 * WebGLResourceManager 资源管理器
 * @fires destroyResource 销毁资源
 * @class
 */
class WebGLResourceManager extends EventMixin {
    /**
     * 类名
     * @type {String}
     * @default WebGLResourceManager
     */
    className: string = 'WebGLResourceManager';

    /**
     * @type {Boolean}
     * @default true
     */
    isWebGLResourceManager: boolean = true;

    /**
     * 是否有需要销毁的资源
     * @type {Boolean}
     * @default false
     */
    hasNeedDestroyResource: boolean = false;

    private _needDestroyResources: Resource[] = [];

    private _meshDict: Record<string, Resource[]> = {};

    /**
     * @constructs
     * @param {object} [params] 初始化参数，所有params都会复制到实例上
     */
    constructor(params?: any) {
        super();
        this._needDestroyResources = [];
        this._meshDict = {};
        Object.assign(this, params);
    }

    destroyMesh(mesh: Mesh): void {
        const resources = this.getMeshResources(mesh);
        resources.forEach((resource) => {
            this.destroyIfNoRef(resource);
        });
        delete this._meshDict[mesh.id];
    }

    getMeshResources(mesh: Mesh, resources: Resource[] = []): Resource[] {
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
    }

    addMeshResources(mesh: Mesh, resources: Resource[]): void {
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
    }

    /**
     * 没有引用时销毁资源
     * @param  {Object} res
     * @return {WebGLResourceManager} this
     */
    destroyIfNoRef(res: Resource): WebGLResourceManager {
        const _needDestroyResources = this._needDestroyResources;
        if (res && _needDestroyResources.indexOf(res) < 0) {
            _needDestroyResources.push(res);
        }
        return this;
    }

    /**
     * 获取 rootNode 用到的资源
     * @param  {Node} [rootNode] 根节点，不传返回空数组
     * @return {Object[]}
     */
    getUsedResources(rootNode?: Node): Resource[] {
        const resources: Resource[] = [];
        if (rootNode && rootNode.traverse) {
            rootNode.traverse((node) => {
                if (node.isMesh && !node.isDestroyed) {
                    this.getMeshResources(node, resources);
                }
            });
        }

        return resources;
    }

    /**
     * 销毁没被 rootNode 使用的资源，通常传 stage。
     * @param {Node} [rootNode] 根节点，不传代表所有资源都没被使用过。
     * @return {WebGLResourceManager} this
     */
    destroyUnusedResource(rootNode?: Node): WebGLResourceManager {
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
    }

    /**
     * 重置
     * @return {WebGLResourceManager} this
     */
    reset(): WebGLResourceManager {
        this._needDestroyResources.length = 0;
        return this;
    }
}

export default WebGLResourceManager;
