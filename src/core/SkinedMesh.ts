import Mesh from './Mesh';
import Matrix4 from '../math/Matrix4';
import Vector4 from '../math/Vector4';
import DataTexture from '../texture/DataTexture';
import capabilities from '../renderer/capabilities';
import log from '../utils/log';

const tempMatrix1 = new Matrix4();
const tempMatrix2 = new Matrix4();

/**
 * 蒙皮Mesh
 * @class
 * @extends Mesh
 */
class SkinedMesh extends Mesh {
    /**
     * @default true
     * @type {boolean}
     */
    isSkinedMesh: boolean = true;

    /**
     * @default SkinedMesh
     * @type {string}
     */
    className: string = 'SkinedMesh';

    /**
     * 是否支持 Instanced
     * @default false
     * @type {boolean}
     */
    useInstanced: boolean = false;

    /**
     * 骨骼矩阵DataTexture
     * @default null
     * @type {DataTexture}
     */
    jointMatTexture: DataTexture | null = null;

    /**
     * 是否开启视锥体裁剪
     * @default false
     * @type {Boolean}
     */
    frustumTest: boolean = false;

    /**
     * 骨架
     * @default null
     * @type {Skeleton}
     */
    skeleton: any = null;

    jointMat?: Float32Array;

    clonedFrom?: SkinedMesh;

    // Note: Constructor with only super(params) is needed to maintain
    // compatibility with the old Class.create pattern where SkinedMesh had a constructor

    /**
     * 获取每个骨骼对应的矩阵数组
     * @return {Float32Array} 返回矩阵数组
     */
    getJointMat(): Float32Array | undefined {
        if (!this.skeleton || this.skeleton.jointCount <= 0) {
            return undefined;
        }
        const jointNodeList = this.skeleton.jointNodeList;
        const inverseBindMatrices = this.skeleton.inverseBindMatrices;
        const jointMatLength = this.skeleton.jointCount * 16;
        if (!this.jointMat || this.jointMat.length !== jointMatLength) {
            this.jointMat = new Float32Array(jointMatLength);
        }

        if (!this.clonedFrom) {
            tempMatrix2.invert(this.worldMatrix);
        } else {
            tempMatrix2.invert(this.clonedFrom.worldMatrix);
        }

        jointNodeList.forEach((node: any, i: number) => {
            tempMatrix1.copy(tempMatrix2);
            tempMatrix1.multiply(node.worldMatrix);
            tempMatrix1.multiply(inverseBindMatrices[i]);
            tempMatrix1.toArray(this.jointMat!, i * 16);
        });
        return this.jointMat;
    }

    /**
     * 用新骨骼的 node name 重设 jointNames
     * @param  {Skeleton} skeleton 新骨架
     */
    resetJointNamesByNodeName(skeleton: any): void {
        this.skeleton.resetJointNamesByNodeName(skeleton);
    }

    /**
     * 用新骨骼重置skinIndices
     * @param  {Skeleton} skeleton
     */
    resetSkinIndices(skeleton: any): void {
        const currentSkeleton = this.skeleton;
        if (currentSkeleton) {
            const geometry = this.geometry;
            const skinIndices = geometry.skinIndices;
            if (skinIndices) {
                this.material.isDirty = true;
                geometry.isDirty = true;
                skinIndices.isDirty = true;
                const tempIndices = new Vector4();

                skinIndices.traverse((attribute: any, index: number, offset: number) => {
                    attribute.elements.forEach((value: number, elementIndex: number) => {
                        const jointName = currentSkeleton.jointNames[value];
                        const jointIndex = skeleton.jointNames.indexOf(jointName);
                        if (jointIndex >= 0) {
                            tempIndices.elements[elementIndex] = jointIndex;
                        } else {
                            log.warnOnce('SkinedMesh.resetSkinIndices', 'SkinedMesh.resetSkinIndices: no jointName found!', jointName);
                        }
                    });
                    skinIndices.setByOffset(offset, tempIndices);
                });
            }
        }
    }

    /**
     * 根据当前骨骼数来生成骨骼矩阵的 jointMatTexture
     * @return {DataTexture}
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
            this.jointMatTexture.data.set(jointMat!, 0);
            this.jointMatTexture.needUpdate = true;
        }
    }

    clone(isChild?: boolean): SkinedMesh {
        const mesh = super.clone(isChild) as SkinedMesh;
        Object.assign(mesh, {
            useInstanced: this.useInstanced,
            skeleton: this.skeleton.clone()
        });
        mesh.clonedFrom = this;
        return mesh;
    }

    getRenderOption(opt: any = {}): any {
        super.getRenderOption(opt);
        const jointCount = this.skeleton.jointCount;
        if (jointCount) {
            opt.JOINT_COUNT = jointCount;
            if (capabilities.VERTEX_TEXTURE_FLOAT) {
                let maxJointCount = (capabilities.MAX_VERTEX_UNIFORM_VECTORS - 22) / 4;
                if (jointCount > maxJointCount) {
                    opt.JOINT_MAT_MAP = 1;
                }
            }
        }
        return opt;
    }
}

export default SkinedMesh;
