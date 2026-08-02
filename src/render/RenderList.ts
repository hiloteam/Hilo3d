import Vector3 from '../math/Vector3';
import type Mesh from '../core/Mesh';
import type Camera from '../camera/Camera';
import type Material from '../material/MaterialInstance';
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
    // Object order is scene policy, not material structure.
    const materialA = materialOf(meshA);
    const materialB = materialOf(meshB);
    const renderOrderA = meshA.renderOrder;
    const renderOrderB = meshB.renderOrder;
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
    const renderOrderA = meshA.renderOrder;
    const renderOrderB = meshB.renderOrder;
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
    /**
     * Camera-visible meshes in stable scene traversal order.
     *
     * The shared prepared-draw planner consumes this list so transparent instance batching can
     * preserve 2D display order instead of inheriting the state-grouped legacy traversal.
     */
    readonly orderedList: Mesh[] = [];
    private readonly instancedDict = new Map<string, Mesh[]>();
    /**
     * Skip legacy queue classification when the shared draw planner only needs `orderedList`.
     */
    orderedOnly = false;
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
        this.orderedList.length = 0;
        this.instancedDict.clear();
    }
    /**
     * 遍历列表执行回调
     * @param callback - callback(mesh)
     * @param instancedCallback - instancedCallback(instancedMeshes)
     */
    traverse(callback: (mesh: Mesh) => void, instancedCallback?: (meshes: Mesh[]) => void): void {
        if (instancedCallback === undefined) {
            for (const mesh of this.orderedList) callback(mesh);
            return;
        }
        this.opaqueList.forEach(mesh => {
            callback(mesh);
        });
        const instancedDict = this.instancedDict;
        for (const instancedList of instancedDict.values()) {
            instancedCallback(instancedList);
        }
        this.transparentList.forEach(mesh => {
            callback(mesh);
        });
    }
    sort(): void {
        if (this.orderedOnly) return;
        this.transparentList.sort(transparentSort);
        this.opaqueList.sort(opaqueSort);
    }
    /**
     * 增加 mesh
     * @param mesh -
     * @param camera -
     */
    addMesh(mesh: Mesh, camera: Camera, frustumCulling = true): void {
        const material = mesh.material;
        const geometry = mesh.geometry;
        if (material && geometry) {
            if (frustumCulling && mesh.frustumTest && !camera.isMeshVisible(mesh)) {
                return;
            }
            this.orderedList.push(mesh);
            if (this.orderedOnly) return;
            // `Mesh.useInstanced` is an explicit opt-in to the instance shader contract. The shared
            // planner may state-cluster opaque groups, but transparent groups only merge adjacent
            // entries from `orderedList`.
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
                if (material.isTransparent) {
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
