import Class from '../core/Class';
import Vector3 from '../math/Vector3';
import log from '../utils/log';

const tempVector3 = new Vector3();

const opaqueSort = function(meshA, meshB) {
    // sort by material renderOrder
    const renderOrderA = meshA.material.renderOrder;
    const renderOrderB = meshB.material.renderOrder;
    if (renderOrderA !== renderOrderB) {
        return renderOrderA - renderOrderB;
    }

    // sort by shader id
    const shaderNumIdA = meshA.material._shaderNumId || 0;
    const shaderNumIdB = meshB.material._shaderNumId || 0;
    if (shaderNumIdA !== shaderNumIdB) {
        return shaderNumIdA - shaderNumIdB;
    }

    // sort by render z
    return meshA._sortRenderZ - meshB._sortRenderZ;
};

const transparentSort = function(meshA, meshB) {
    // sort by material renderOrder
    const renderOrderA = meshA.material.renderOrder;
    const renderOrderB = meshB.material.renderOrder;
    if (renderOrderA !== renderOrderB) {
        return renderOrderA - renderOrderB;
    }

    // sort by inverse render z
    return meshB._sortRenderZ - meshA._sortRenderZ;
};

/**
 * 渲染列表
 * @class
 */
const RenderList = Class.create(/** @lends RenderList.prototype */ {
    /**
     * @default RenderList
     * @type {String}
     */
    className: 'RenderList',

    /**
     * @default true
     * @type {Boolean}
     */
    isRenderList: true,

    /**
     * 使用 instanced
     * @type {Boolean}
     * @default false
     */
    useInstanced: false,

    /**
     * @constructs
     */
    constructor() {
        /**
         * 不透明物体列表
         * @type {Array}
         */
        this.opaqueList = [];

        /**
         * 透明物体列表
         * @type {Array}
         */
        this.transparentList = [];

        /**
         * instanced物体字典
         * @type {Object}
         */
        this.instancedDict = {};
    },
    /**
     * 重置列表
     */
    reset() {
        this.opaqueList.length = 0;
        this.transparentList.length = 0;
        this.instancedDict = {};
    },
    /**
     * 遍历列表执行回调
     * @param  {RenderList~traverseCallback} callback callback(mesh)
     * @param  {RenderList~instancedTraverseCallback} [instancedCallback=null] instancedCallback(instancedMeshes)
     */
    traverse(callback, instancedCallback) {
        this.opaqueList.forEach((mesh) => {
            callback(mesh);
        });

        const instancedDict = this.instancedDict;
        for (let instancedId in instancedDict) {
            const instancedList = instancedDict[instancedId];
            if (instancedList.length > 2 && instancedCallback) {
                instancedCallback(instancedList);
            } else {
                instancedList.forEach((mesh) => {
                    callback(mesh);
                });
            }
        }

        this.transparentList.forEach((mesh) => {
            callback(mesh);
        });
    },
    sort() {
        this.transparentList.sort(transparentSort);
        this.opaqueList.sort(opaqueSort);
    },
    /**
     * 增加 mesh
     * @param {Mesh} mesh
     * @param {Camera} camera
     */
    addMesh(mesh, camera) {
        const material = mesh.material;
        const geometry = mesh.geometry;

        if (material && geometry) {
            if (mesh.frustumTest && !camera.isMeshVisible(mesh)) {
                return;
            }

            if (this.useInstanced && mesh.useInstanced) {
                const instancedDict = this.instancedDict;
                const instancedId = material.id + '_' + geometry.id;
                let instancedList = instancedDict[instancedId];
                if (!instancedDict[instancedId]) {
                    instancedList = instancedDict[instancedId] = [];
                }
                instancedList.push(mesh);
            } else {
                mesh.worldMatrix.getTranslation(tempVector3);
                tempVector3.transformMat4(camera.viewProjectionMatrix);
                mesh._sortRenderZ = tempVector3.z;

                if (material.transparent) {
                    this.transparentList.push(mesh);
                } else {
                    this.opaqueList.push(mesh);
                }
            }
        } else {
            log.warnOnce(`RenderList.addMesh(${mesh.id})`, 'Mesh must have material and geometry', mesh);
        }
    }
});

export default RenderList;

/**
 * @callback RenderList~traverseCallback
 * @param {Mesh} mesh
 */

/**
 * @callback RenderList~instancedTraverseCallback
 * @param {Mesh[]} meshes
 */
