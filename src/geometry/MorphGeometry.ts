import Geometry, { type GeometryParameters } from './Geometry';
import type GeometryData from './GeometryData';
import type { ShaderOptions } from '../renderer/types';

export type MorphTargets = Record<string, GeometryData[]>;

export interface MorphGeometryParameters extends GeometryParameters {
    weights?: number[] | Float32Array;
    targets?: MorphTargets | null;
}
/**
 * Morph几何体
 */
class MorphGeometry extends Geometry {
    override readonly isMorphGeometry = true;
    override readonly className: string = 'MorphGeometry';
    override isStatic = false;
    /**
     * morph animation weights
     */
    weights: number[] | Float32Array = [];
    /**
     * like:
     * ```ts
     * {
     *     vertices: [[], []],
     *     normals: [[], []],
     *     tangents: [[], []]
     * }
     * ```
     */
    targets: MorphTargets | null = null;
    private _originalMorphIndices: number[] = [];
    private readonly morphTargetIndices = new Map<string, number>();
    /**
     * @param params - 创建对象的属性参数。可包含此类的所有属性。
     */
    constructor(params: MorphGeometryParameters = {}) {
        super();
        Object.assign(this, params);
    }
    update(weights: number[] | Float32Array, originalWeightIndices: number[]): void {
        this.weights = weights;
        this._originalMorphIndices = originalWeightIndices;
    }

    getMorphTarget(name: string, slot: number): GeometryData | undefined {
        const targets = this.targets?.[name];
        if (!targets) return undefined;
        const targetIndex = this._originalMorphIndices[slot] ?? slot;
        const data = targets[targetIndex];
        const cacheKey = `${name}:${String(slot)}`;
        if (data && this.morphTargetIndices.get(cacheKey) !== targetIndex) {
            data.isDirty = true;
            this.morphTargetIndices.set(cacheKey, targetIndex);
        }
        return data;
    }
    override clone(): MorphGeometry {
        const geometry = super.clone();
        if (!(geometry instanceof MorphGeometry)) {
            throw new TypeError('MorphGeometry clone did not preserve its runtime type');
        }
        geometry.targets = this.targets;
        geometry.weights =
            this.weights instanceof Float32Array ? this.weights.slice() : [...this.weights];
        geometry._originalMorphIndices = [...this._originalMorphIndices];
        return geometry;
    }
    override getRenderOption(opt: ShaderOptions = {}): ShaderOptions {
        super.getRenderOption(opt);
        if (this.targets) {
            const targetKinds = Object.keys(this.targets).length;
            const maxMorphTargetCount = targetKinds === 0 ? 0 : Math.floor(8 / targetKinds);
            for (const [name, list] of Object.entries(this.targets)) {
                opt['MORPH_TARGET_COUNT'] = Math.min(list.length, maxMorphTargetCount);
                if (name === 'vertices') {
                    opt['MORPH_HAS_POSITION'] = 1;
                } else if (name === 'normals') {
                    opt['MORPH_HAS_NORMAL'] = 1;
                } else if (name === 'tangents') {
                    opt['MORPH_HAS_TANGENT'] = 1;
                }
            }
        }
        return opt;
    }
}
export default MorphGeometry;
