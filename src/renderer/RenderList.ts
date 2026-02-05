import Vector3 from '../math/Vector3';
import log from '../utils/log';

const tempVector3 = new Vector3();

interface Mesh {
    material: any;
    geometry: any;
    frustumTest: boolean;
    useInstanced: boolean;
    worldMatrix: any;
    _sortRenderZ: number;
    id: string;
}

interface Camera {
    viewProjectionMatrix: any;
    isMeshVisible(mesh: Mesh): boolean;
}

const opaqueSort = function(meshA: Mesh, meshB: Mesh): number {
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

const transparentSort = function(meshA: Mesh, meshB: Mesh): number {
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
 * @callback RenderListTraverseCallback
 * @param mesh
 */
type RenderListTraverseCallback = (mesh: Mesh) => void;

/**
 * @callback RenderListInstancedTraverseCallback
 * @param meshes
 */
type RenderListInstancedTraverseCallback = (meshes: Mesh[]) => void;

/**
 * 渲染列表
 * @class
 */
class RenderList {
    /**
     * @default RenderList
     * @type {String}
     */
    className: string = 'RenderList';

    /**
     * @default true
     * @type {Boolean}
     */
    isRenderList: boolean = true;

    /**
     * 使用 instanced
     * @type {Boolean}
     * @default false
     */
    useInstanced: boolean = false;

    /**
     * 不透明物体列表
     * @type {Array}
     */
    opaqueList: Mesh[] = [];

    /**
     * 透明物体列表
     * @type {Array}
     */
    transparentList: Mesh[] = [];

    /**
     * instanced物体字典
     * @type {Object}
     */
    instancedDict: Record<string, Mesh[]> = {};

    /**
     * @constructs
     */
    constructor() {
        this.opaqueList = [];
        this.transparentList = [];
        this.instancedDict = {};
    }

    /**
     * 重置列表
     */
    reset(): void {
        this.opaqueList.length = 0;
        this.transparentList.length = 0;
        this.instancedDict = {};
    }

    /**
     * 遍历列表执行回调
     * @param callback callback(mesh)
     * @param instancedCallback instancedCallback(instancedMeshes)
     */
    traverse(callback: RenderListTraverseCallback, instancedCallback?: RenderListInstancedTraverseCallback | null): void {
        this.opaqueList.forEach((mesh) => {
            callback(mesh);
        });

        const instancedDict = this.instancedDict;
        for (const instancedId in instancedDict) {
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
    }

    sort(): void {
        this.transparentList.sort(transparentSort);
        this.opaqueList.sort(opaqueSort);
    }

    /**
     * 增加 mesh
     * @param mesh
     * @param camera
     */
    addMesh(mesh: Mesh, camera: Camera): void {
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
}

export default RenderList;
