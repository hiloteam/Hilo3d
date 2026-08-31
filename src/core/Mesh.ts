import { BACK, FRONT, FRONT_AND_BACK } from '../constants/webgl';
import type Geometry from '../geometry/Geometry';
import type Material from '../material/MaterialInstance';
import Matrix4 from '../math/Matrix4';
import Ray from '../math/Ray';
import type Vector3 from '../math/Vector3';
import Sphere from '../math/Sphere';
import type { ShaderOptions } from '../render/types';
import RenderTransformView, {
    type RenderTransformViewParameters
} from '../render/world/RenderTransformView';

const TEMP_RAY = new Ray();
const TEMP_MATRIX = new Matrix4();

/** Parameters used to prepare one renderer-owned mesh view for extension integration. */
export interface MeshParameters extends RenderTransformViewParameters {
    readonly geometry?: Geometry | null;
    readonly material?: Material | null;
    readonly useInstanced?: boolean;
    readonly frustumTest?: boolean;
    readonly renderOrder?: number;
    readonly castShadows?: boolean;
    readonly receiveShadows?: boolean;
    readonly instanceCount?: number;
}

/**
 * Renderer-owned mesh view populated by RenderExtractionSystem.
 *
 * It is intentionally not public scene state and has no hierarchy, event dispatcher, update
 * callback, component map, or resource-ownership behavior.
 */
class Mesh extends RenderTransformView {
    static readonly typeName: string = 'RenderMesh';
    readonly isMesh = true;
    isSprite = false;
    isSkinnedMesh = false;
    className = 'RenderMesh';
    geometry: Geometry | null = null;
    material: Material | null = null;
    useInstanced = false;
    frustumTest = true;
    renderOrder = 0;
    castShadows = true;
    receiveShadows = true;
    readonly isDestroyed = false;
    spriteUVRect: Float32Array | null = null;
    spriteSizeAnchor: Float32Array | null = null;
    spriteTint: ArrayLike<number> | null = null;
    /** Extracted skin palette. Null for non-skinned render records. @internal */
    jointMatrices: Float32Array | null = null;
    /** Extracted morph weights. Null for non-morph render records. @internal */
    morphWeights: Float32Array | null = null;
    /** World-space culling sphere populated by RenderWorld extraction. @internal */
    readonly worldBounds = new Sphere();
    private instanceCountValue = 1;

    constructor(parameters: MeshParameters = {}) {
        super('RenderMesh');
        Object.assign(this, parameters);
    }

    clone(_isChild?: boolean): Mesh {
        void _isChild;
        const Constructor = this.constructor as new (parameters?: MeshParameters) => Mesh;
        const mesh = new Constructor({
            name: this.name,
            geometry: this.geometry,
            material: this.material,
            useInstanced: this.useInstanced,
            frustumTest: this.frustumTest,
            renderOrder: this.renderOrder,
            castShadows: this.castShadows,
            receiveShadows: this.receiveShadows,
            instanceCount: this.instanceCount
        });
        mesh.worldMatrix.copy(this.worldMatrix);
        mesh.worldMatrixVersion = this.worldMatrixVersion;
        mesh.worldBounds.copy(this.worldBounds);
        mesh.isSkinnedMesh = this.isSkinnedMesh;
        mesh.jointMatrices = this.jointMatrices?.slice() ?? null;
        mesh.morphWeights = this.morphWeights?.slice() ?? null;
        return mesh;
    }

    get instanceCount(): number {
        return this.instanceCountValue;
    }

    set instanceCount(value: number) {
        if (!Number.isSafeInteger(value) || value < 1) {
            throw new RangeError('Render mesh instanceCount must be a positive safe integer.');
        }
        this.instanceCountValue = value;
    }

    raycast(ray: Ray, sort = true): Vector3[] | null {
        if (!this.visible || !this.geometry || !this.material) return null;
        TEMP_MATRIX.invert(this.worldMatrix);
        TEMP_RAY.copy(ray).transformMat4(TEMP_MATRIX);
        const cullMode = this.material.definition.getPass('forward')?.state.cullMode ?? 'back';
        const side = cullMode === 'back' ? FRONT : cullMode === 'front' ? BACK : FRONT_AND_BACK;
        const intersections = this.geometry.raycast(TEMP_RAY, side, sort);
        if (!intersections) return null;
        for (const point of intersections) point.transformMat4(this.worldMatrix);
        return intersections;
    }

    getRenderOption(options: ShaderOptions = {}): ShaderOptions {
        this.geometry?.getRenderOption(options);
        const jointCount = this.skinJointCount;
        if (jointCount > 0) options['JOINT_COUNT'] = jointCount;
        return options;
    }

    /** Number of 4x4 matrices in the extracted skin palette. */
    get skinJointCount(): number {
        return this.jointMatrices === null ? 0 : this.jointMatrices.length / 16;
    }

    /** Return the already-extracted palette without scene traversal. */
    getJointMat(): Float32Array {
        if (!this.jointMatrices || this.jointMatrices.length === 0) {
            throw new Error('Render mesh has no extracted skin palette.');
        }
        return this.jointMatrices;
    }
}

export default Mesh;
