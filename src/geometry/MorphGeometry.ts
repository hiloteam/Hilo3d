import Class from '../core/Class';
import Geometry from './Geometry';
import {
    each
} from '../utils/util';

/**
 * Morph几何体
 * @class
 * @extends Geometry
 */
const MorphGeometry = Class.create(/** @lends MorphGeometry.prototype */ {
    Extends: Geometry,
    /**
     * @default true
     * @type {boolean}
     */
    isMorphGeometry: true,
    /**
     * @default MorphGeometry
     * @type {string}
     */
    className: 'MorphGeometry',
    isStatic: false,

    /**
     * morph animation weights
     * @type {Array.<number>}
     */
    weights: [],
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
    targets: null,
    /**
     * @constructs
     * @param {object} [params] 创建对象的属性参数。可包含此类的所有属性。
     */
    constructor(params) {
        MorphGeometry.superclass.constructor.call(this, params);
        this.weights = this.weights || [];
    },
    update(weights, originalWeightIndices) {
        this.weights = weights;
        this._originalMorphIndices = originalWeightIndices;
    },
    clone() {
        return Geometry.prototype.clone.call(this, {
            targets: this.targets,
            weights: this.weights
        });
    },
    getRenderOption(opt = {}) {
        MorphGeometry.superclass.getRenderOption.call(this, opt);

        if (this.targets) {
            if (!this._maxMorphTargetCount) {
                this._maxMorphTargetCount = Math.floor(8 / Object.keys(this.targets).length);
            }
            each(this.targets, (list, name) => {
                opt.MORPH_TARGET_COUNT = Math.min(list.length, this._maxMorphTargetCount);
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
});

export default MorphGeometry;
