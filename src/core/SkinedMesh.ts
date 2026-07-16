import Mesh, { type MeshParameters } from './Mesh';
import Matrix4 from '../math/Matrix4';
import Vector4 from '../math/Vector4';
import DataTexture from '../texture/DataTexture';
import capabilities from '../renderer/capabilities';
import type Skeleton from './Skeleton';
import type { ShaderOptions } from '../renderer/types';
import { requireNumber } from '../math/numberArray';
const tempMatrix1 = new Matrix4();
const tempMatrix2 = new Matrix4();

export interface SkinedMeshParameters extends MeshParameters {
    skeleton?: Skeleton | null;
}
/**
 * 蒙皮Mesh
 */
class SkinedMesh extends Mesh {
    static override readonly typeName: string = 'SkinedMesh';
    private jointMat: Float32Array | null = null;
    private clonedFrom: SkinedMesh | null = null;
    override isSkinedMesh = true;
    override className = 'SkinedMesh';
    /**
     * 是否支持 Instanced
     */
    override useInstanced = false;
    /**
     * 骨骼矩阵DataTexture
     */
    jointMatTexture: DataTexture | null = null;
    /**
     * 是否开启视锥体裁剪
     */
    override frustumTest = false;
    /**
     * 骨架
     */
    skeleton: Skeleton | null = null;
    /**
     * @param params - 初始化参数，所有params都会复制到实例上
     * - `params.geometry`: 几何体
     * - `params.material`: 材质
     * - `params.skeleton`: 骨骼
     */
    constructor(params: SkinedMeshParameters = {}) {
        super();
        Object.assign(this, params);
    }
    /**
     * 获取每个骨骼对应的矩阵数组
     * @returns 返回矩阵数组
     */
    getJointMat(): Float32Array {
        if (!this.skeleton || this.skeleton.jointCount <= 0) {
            throw new Error('SkinedMesh requires a skeleton with at least one joint.');
        }
        const jointNodeList = this.skeleton.jointNodeList;
        const inverseBindMatrices = this.skeleton.inverseBindMatrices;
        const jointMatLength = this.skeleton.jointCount * 16;
        if (this.jointMat?.length !== jointMatLength) {
            this.jointMat = new Float32Array(jointMatLength);
        }
        const jointMat = this.jointMat;
        if (!this.clonedFrom) {
            tempMatrix2.invert(this.worldMatrix);
        } else {
            tempMatrix2.invert(this.clonedFrom.worldMatrix);
        }
        jointNodeList.forEach((node, i) => {
            tempMatrix1.copy(tempMatrix2);
            tempMatrix1.multiply(node.worldMatrix);
            const inverseBindMatrix = inverseBindMatrices[i];
            if (!inverseBindMatrix) {
                throw new RangeError(`Missing inverse bind matrix for joint ${String(i)}.`);
            }
            tempMatrix1.multiply(inverseBindMatrix);
            tempMatrix1.toArray(jointMat, i * 16);
        });
        return jointMat;
    }
    /**
     * 用新骨骼的 node name 重设 jointNames
     * @param skeleton - 新骨架
     */
    resetJointNamesByNodeName(skeleton: Skeleton): void {
        this.skeleton?.resetJointNamesByNodeName(skeleton);
    }
    /**
     * 用新骨骼重置skinIndices
     * @param skeleton -
     */
    resetSkinIndices(skeleton: Skeleton): void {
        const currentSkeleton = this.skeleton;
        const geometry = this.geometry;
        const material = this.material;
        if (currentSkeleton && geometry && material) {
            const skinIndices = geometry.skinIndices;
            if (skinIndices) {
                material.isDirty = true;
                geometry.isDirty = true;
                skinIndices.isDirty = true;
                const tempIndices = new Vector4();
                skinIndices.traverse((attribute, index, offset) => {
                    if (!(attribute instanceof Vector4)) return false;
                    for (let elementIndex = 0; elementIndex < 4; elementIndex++) {
                        const value = requireNumber(attribute.elements, elementIndex);
                        const jointName = currentSkeleton.jointNames[value];
                        const jointIndex =
                            jointName === undefined ? -1 : skeleton.jointNames.indexOf(jointName);
                        if (jointIndex >= 0) {
                            tempIndices.elements[elementIndex] = jointIndex;
                        } else {
                            throw new RangeError(
                                `SkinedMesh.resetSkinIndices cannot map joint ${String(jointName)}.`
                            );
                        }
                    }
                    skinIndices.setByOffset(offset, tempIndices);
                    return false;
                });
            }
        }
    }
    /**
     * 根据当前骨骼数来生成骨骼矩阵的 jointMatTexture
     */
    initJointMatTexture(): DataTexture {
        if (!this.jointMatTexture) {
            const jointMat = this.getJointMat();
            this.jointMatTexture = new DataTexture({
                data: jointMat
            });
        }
        return this.jointMatTexture;
    }
    /**
     * 将 getJointMat 获取的骨骼矩阵数组更新到 jointMatTexture 中
     */
    updateJointMatTexture(): void {
        if (!this.jointMatTexture) {
            this.initJointMatTexture();
        } else {
            const jointMat = this.getJointMat();
            const texture = this.jointMatTexture;
            if (!texture.data) throw new Error('Joint matrix texture has no data buffer.');
            texture.data.set(jointMat, 0);
            texture.needUpdate = true;
        }
    }
    override clone(isChild?: boolean): SkinedMesh {
        const mesh = super.clone(isChild);
        if (!(mesh instanceof SkinedMesh)) {
            throw new TypeError(
                'SkinedMesh subclasses must construct SkinedMesh-compatible instances.'
            );
        }
        Object.assign(mesh, {
            useInstanced: this.useInstanced,
            skeleton: this.skeleton?.clone() ?? null
        });
        mesh.clonedFrom = this;
        return mesh;
    }
    override getRenderOption(opt: ShaderOptions = {}): ShaderOptions {
        super.getRenderOption(opt);
        const jointCount = this.skeleton?.jointCount ?? 0;
        if (jointCount) {
            opt['JOINT_COUNT'] = jointCount;
            if (capabilities.VERTEX_TEXTURE_FLOAT) {
                const maxJointCount = (capabilities.MAX_VERTEX_UNIFORM_VECTORS - 22) / 4;
                if (jointCount > maxJointCount) {
                    opt['JOINT_MAT_MAP'] = 1;
                }
            }
        }
        return opt;
    }
}
export default SkinedMesh;
