import Class from './Class';
import math from '../math/math';


/**
 * 骨架
 * @class
 */
const Skeleton = Class.create(/** @lends Skeleton.prototype */ {
    /**
     * @default true
     * @type {Boolean}
     */
    isSkeleton: true,

    /**
     * @default Skeleton
     * @type {String}
     */
    className: 'Skeleton',
    /**
     * @default []
     * @type {Node[]}
     */
    jointNodeList: [],
    /**
     * @default []
     * @type {Matrix4[]}
     */
    inverseBindMatrices: [],
    /**
     * @constructs
     * @param {Object} [params] 创建对象的属性参数。可包含此类的所有属性。
     */
    constructor(params) {
        /**
         * id
         * @default math.generateUUID('Skeleton')
         * @type {String}
         */
        this.id = math.generateUUID(this.className);
        Object.assign(this, params);
    },

    /**
     * 关节数量
     * @type {Number}
     */
    jointCount: {
        get() {
            return this.jointNodeList.length;
        }
    },

    clone() {
        const skeleton = new Skeleton();
        skeleton.inverseBindMatrices = this.inverseBindMatrices;
        skeleton.jointNodeList = this.jointNodeList;
        return skeleton;
    }
});

export default Skeleton;
