import Mesh, { type MeshParameters } from './Mesh';
import Matrix4 from '../math/Matrix4';
import Vector4 from '../math/Vector4';
import type Skeleton from './Skeleton';
import type { ShaderOptions } from '../renderer/common/types';
import { requireNumber } from '../math/numberArray';
const tempMatrix1 = new Matrix4();
const tempMatrix2 = new Matrix4();

export interface SkinnedMeshParameters extends MeshParameters {
    skeleton?: Skeleton | null;
}
/**
 * 蒙皮Mesh
 */
class SkinnedMesh extends Mesh {
    static override readonly typeName: string = 'SkinnedMesh';
    private jointMat: Float32Array | null = null;
    private clonedFrom: SkinnedMesh | null = null;
    override isSkinnedMesh = true;
    override className = 'SkinnedMesh';
    /**
     * 是否支持 Instanced
     */
    override useInstanced = false;
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
    constructor(params: SkinnedMeshParameters = {}) {
        super();
        Object.assign(this, params);
    }
    /**
     * 获取每个骨骼对应的矩阵数组
     * @returns 返回矩阵数组
     */
    getJointMat(): Float32Array {
        if (!this.skeleton || this.skeleton.jointCount <= 0) {
            throw new Error('SkinnedMesh requires a skeleton with at least one joint.');
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
                                `SkinnedMesh.resetSkinIndices cannot map joint ${String(jointName)}.`
                            );
                        }
                    }
                    skinIndices.setByOffset(offset, tempIndices);
                    return false;
                });
            }
        }
    }
    override clone(isChild?: boolean): SkinnedMesh {
        const mesh = super.clone(isChild);
        if (!(mesh instanceof SkinnedMesh)) {
            throw new TypeError(
                'SkinnedMesh subclasses must construct SkinnedMesh-compatible instances.'
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
            if (jointCount > 128) {
                throw new RangeError('SkinningBlock supports at most 128 joints per mesh');
            }
            opt['JOINT_COUNT'] = jointCount;
        }
        return opt;
    }
}
export default SkinnedMesh;
