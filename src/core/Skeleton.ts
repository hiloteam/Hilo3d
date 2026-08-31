import type Matrix4 from '../math/Matrix4';

export interface SkeletonParameters {
    readonly jointNames?: readonly string[];
    readonly inverseBindMatrices?: readonly Matrix4[];
}

/** Loader-only skin asset resolved to SkeletonPose Entities during prefab instantiation. */
class Skeleton {
    readonly isSkeleton = true;
    readonly className = 'SkeletonAsset';
    jointNames: string[];
    inverseBindMatrices: Matrix4[];

    constructor(parameters: SkeletonParameters = {}) {
        this.jointNames = Array.from(parameters.jointNames ?? []);
        this.inverseBindMatrices = Array.from(parameters.inverseBindMatrices ?? []);
    }
    /**
     * 关节数量
     */
    get jointCount(): number {
        return this.jointNames.length;
    }
    /** Clone this loader-only skin asset. */
    clone(): Skeleton {
        return new Skeleton({
            jointNames: this.jointNames,
            inverseBindMatrices: this.inverseBindMatrices
        });
    }
}
export default Skeleton;
