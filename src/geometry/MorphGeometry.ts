import Geometry from './Geometry';
import {
    each
} from '../utils/util';

interface MorphTargets {
    vertices?: any[];
    normals?: any[];
    tangents?: any[];
    [key: string]: any[] | undefined;
}

/**
 * Morph几何体
 * @class
 * @extends Geometry
 */
class MorphGeometry extends Geometry {
    /**
     * @default true
     * @type {boolean}
     */
    readonly isMorphGeometry: boolean = true;

    /**
     * @default MorphGeometry
     * @type {string}
     */
    readonly className: string = 'MorphGeometry';

    isStatic: boolean = false;

    /**
     * morph animation weights
     * @type {Array.<number>}
     */
    weights: number[] = [];

    /**
     * like:
     * {
     *     vertices: [[], []],
     *     normals: [[], []],
     *     tangents: [[], []]
     * }
     * @default null
     * @type {Object}
     */
    targets: MorphTargets | null = null;

    private _maxMorphTargetCount?: number;

    private _originalMorphIndices?: any;

    /**
     * @constructs
     * @param {object} [params] 创建对象的属性参数。可包含此类的所有属性。
     */
    constructor(params?: any) {
        super(params);
        this.weights = this.weights || [];
    }

    update(weights: number[], originalWeightIndices?: any): void {
        this.weights = weights;
        this._originalMorphIndices = originalWeightIndices;
    }

    clone(): MorphGeometry {
        const geometry = super.clone() as MorphGeometry;
        geometry.targets = this.targets;
        geometry.weights = this.weights;
        return geometry;
    }

    getRenderOption(opt: any = {}): any {
        super.getRenderOption(opt);

        if (this.targets) {
            if (!this._maxMorphTargetCount) {
                this._maxMorphTargetCount = Math.floor(8 / Object.keys(this.targets).length);
            }
            each(this.targets, (list: any[], name: string) => {
                opt.MORPH_TARGET_COUNT = Math.min(list.length, this._maxMorphTargetCount!);
                if (name === 'vertices') {
                    opt.MORPH_HAS_POSITION = 1;
                } else if (name === 'normals') {
                    opt.MORPH_HAS_NORMAL = 1;
                } else if (name === 'tangents') {
                    opt.MORPH_HAS_TANGENT = 1;
                }
            });
        }
        return opt;
    }
}

export default MorphGeometry;
