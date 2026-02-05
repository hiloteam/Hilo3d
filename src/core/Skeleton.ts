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
     * 用户数据
     * @default null
     * @type {any}
     */
    userData: null,

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

        /**
         * @default []
         * @type {Node[]}
         */
        this.jointNodeList = [];
        /**
         * @default []
         * @type {string[]}
         */
        this.jointNames = [];
        /**
         * @default []
         * @type {Matrix4[]}
         */
        this.inverseBindMatrices = [];
        Object.assign(this, params);
    },

    /**
     * 关节数量
     * @readOnly
     * @type {Number}
     */
    jointCount: {
        get() {
            return this.jointNodeList.length;
        }
    },

    /**
     * @private
     * @type {Node}
     */
    _rootNode: null,
    /**
     * 设置根节点
     * @type {Node}
     */
    rootNode: {
        get() {
            return this._rootNode;
        },
        set(rootNode) {
            this._rootNode = rootNode;
            if (rootNode) {
                this._initJointNodeList();
            }
        }
    },

    /**
     * @private
     */
    _initJointNodeList() {
        const map = {};
        this.rootNode.traverse((node) => {
            map[node.jointName] = node;
        });

        this.jointNodeList = this.jointNames.map((name) => {
            return map[name];
        });
    },

    /**
     * 用新骨骼的 node name 重设 jointNames
     * @param  {Skeleton} skeleton 新骨架
     */
    resetJointNamesByNodeName(skeleton) {
        const jointNames = this.jointNames;
        this.jointNodeList.forEach((jointNode, index) => {
            const mainJointNode = skeleton.rootNode.getChildByName(jointNode.name);
            if (mainJointNode) {
                jointNames[index] = mainJointNode.jointName;
            }
        });
    },

    /**
     * clone
     * @param {Node} [rootNode]
     * @return {Skeleton}
     */
    clone(rootNode) {
        const skeleton = new Skeleton();
        skeleton.copy(this, rootNode);
        return skeleton;
    },

    /**
     * copy
     * @param  {Skeleton} skeleton
     * @param {Node} [rootNode]
     * @return {Skeleton} this
     */
    copy(skeleton, rootNode) {
        this.inverseBindMatrices = skeleton.inverseBindMatrices;
        this.jointNames = skeleton.jointNames.slice();
        if (rootNode === undefined) {
            rootNode = skeleton.rootNode;
        }
        this.rootNode = rootNode;
        return this;
    }
});

export default Skeleton;
