import Vector3 from '../../math/Vector3';
import type Mesh from '../../core/Mesh';
import type Camera from '../../camera/Camera';
import type Material from '../../material/Material';
const tempVector3 = new Vector3();
const renderDepths = new WeakMap<Mesh, number>();

function materialOf(mesh: Mesh): Material {
    if (!mesh.material) throw new Error('RenderList contains a mesh without material');
    return mesh.material;
}

function shaderNumericId(material: Material): number {
    const value: unknown = Reflect.get(material, '_shaderNumId');
    return typeof value === 'number' ? value : 0;
}

const opaqueSort = function (meshA: Mesh, meshB: Mesh): number {
    // sort by material renderOrder
    const materialA = materialOf(meshA);
    const materialB = materialOf(meshB);
    const renderOrderA = materialA.renderOrder;
    const renderOrderB = materialB.renderOrder;
    if (renderOrderA !== renderOrderB) {
        return renderOrderA - renderOrderB;
    }
    // sort by shader id
    const shaderNumIdA = shaderNumericId(materialA);
    const shaderNumIdB = shaderNumericId(materialB);
    if (shaderNumIdA !== shaderNumIdB) {
        return shaderNumIdA - shaderNumIdB;
    }
    // sort by render z
    return (renderDepths.get(meshA) ?? 0) - (renderDepths.get(meshB) ?? 0);
};
const transparentSort = function (meshA: Mesh, meshB: Mesh): number {
    // sort by material renderOrder
    const renderOrderA = materialOf(meshA).renderOrder;
    const renderOrderB = materialOf(meshB).renderOrder;
    if (renderOrderA !== renderOrderB) {
        return renderOrderA - renderOrderB;
    }
    // sort by inverse render z
    return (renderDepths.get(meshB) ?? 0) - (renderDepths.get(meshA) ?? 0);
};
/**
 * 渲染列表
 */
class RenderList {
    readonly className = 'RenderList';
    readonly isRenderList = true;
    readonly opaqueList: Mesh[] = [];
    readonly transparentList: Mesh[] = [];
    private readonly instancedDict = new Map<string, Mesh[]>();
    /**
     * 使用 instanced
     */
    useInstanced = false;
    /**
     * 重置列表
     */
    reset(): void {
        this.opaqueList.length = 0;
        this.transparentList.length = 0;
        this.instancedDict.clear();
    }
    /**
     * 遍历列表执行回调
     * @param callback - callback(mesh)
     * @param instancedCallback - instancedCallback(instancedMeshes)
     */
    traverse(callback: (mesh: Mesh) => void, instancedCallback?: (meshes: Mesh[]) => void): void {
        this.opaqueList.forEach(mesh => {
            callback(mesh);
        });
        const instancedDict = this.instancedDict;
        for (const instancedList of instancedDict.values()) {
            if (instancedCallback) {
                instancedCallback(instancedList);
            } else {
                instancedList.forEach(mesh => {
                    callback(mesh);
                });
            }
        }
        this.transparentList.forEach(mesh => {
            callback(mesh);
        });
    }
    sort(): void {
        this.transparentList.sort(transparentSort);
        this.opaqueList.sort(opaqueSort);
    }
    /**
     * 增加 mesh
     * @param mesh -
     * @param camera -
     */
    addMesh(mesh: Mesh, camera: Camera): void {
        const material = mesh.material;
        const geometry = mesh.geometry;
        if (material && geometry) {
            if (mesh.frustumTest && !camera.isMeshVisible(mesh)) {
                return;
            }
            // `Mesh.useInstanced` is an explicit opt-in to batching, including the ordering
            // trade-off for transparent geometry. Keeping every opted-in mesh on the instanced
            // path is also required for custom shaders whose per-mesh values are vertex inputs.
            if (this.useInstanced && mesh.useInstanced) {
                const instancedDict = this.instancedDict;
                const instancedId = `${material.id}_${geometry.id}`;
                let instancedList = instancedDict.get(instancedId);
                if (!instancedList) {
                    instancedList = [];
                    instancedDict.set(instancedId, instancedList);
                }
                instancedList.push(mesh);
            } else {
                mesh.worldMatrix.getTranslation(tempVector3);
                tempVector3.transformMat4(camera.viewProjectionMatrix);
                renderDepths.set(mesh, tempVector3.z);
                if (material.transparent) {
                    this.transparentList.push(mesh);
                } else {
                    this.opaqueList.push(mesh);
                }
            }
        } else {
            throw new Error(
                `Mesh ${mesh.id} must have material and geometry before entering the render list`
            );
        }
    }
}
export default RenderList;
