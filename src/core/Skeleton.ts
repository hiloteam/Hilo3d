import math from '../math/math';
import type Node from './Node';
import type Matrix4 from '../math/Matrix4';

/**
 * 骨架
 * @class
 */
class Skeleton {
    /**
     * @default true
     * @type {Boolean}
     */
    isSkeleton: boolean = true;

    /**
     * @default Skeleton
     * @type {String}
     */
    className: string = 'Skeleton';

    /**
     * 用户数据
     * @default null
     * @type {any}
     */
    userData: any = null;

    /**
     * id
     * @type {String}
     */
    id!: string;

    /**
     * @type {Node[]}
     */
    jointNodeList: Node[];

    /**
     * @type {string[]}
     */
    jointNames: string[];

    /**
     * @type {Matrix4[]}
     */
    inverseBindMatrices!: Matrix4[];

    /**
     * @private
     * @type {Node}
     */
    private _rootNode: Node | null = null;

    /**
     * @constructs
     * @param {Object} [params] 创建对象的属性参数。可包含此类的所有属性。
     */
    constructor(params?: any) {
        this.id = math.generateUUID(this.className);
        this.jointNodeList = [];
        this.jointNames = [];
        this.inverseBindMatrices = [];
        Object.assign(this, params);
    }

    /**
     * 关节数量
     * @readOnly
     * @type {Number}
     */
    get jointCount(): number {
        return this.jointNodeList.length;
    }

    /**
     * 设置根节点
     * @type {Node}
     */
    get rootNode(): Node | null {
        return this._rootNode;
    }

    set rootNode(rootNode: Node | null) {
        this._rootNode = rootNode;
        if (rootNode) {
            this._initJointNodeList();
        }
    }

    /**
     * @private
     */
    private _initJointNodeList(): void {
        const map: Record<string, Node> = {};
        this.rootNode!.traverse((node: Node) => {
            map[node.jointName] = node;
        });

        this.jointNodeList = this.jointNames.map((name) => {
            return map[name];
        });
    }

    /**
     * 用新骨骼的 node name 重设 jointNames
     * @param  {Skeleton} skeleton 新骨架
     */
    resetJointNamesByNodeName(skeleton: Skeleton): void {
        const jointNames = this.jointNames;
        this.jointNodeList.forEach((jointNode, index) => {
            const mainJointNode = skeleton.rootNode!.getChildByName(jointNode.name);
            if (mainJointNode) {
                jointNames[index] = mainJointNode.jointName;
            }
        });
    }

    /**
     * clone
     * @param {Node} [rootNode]
     * @return {Skeleton}
     */
    clone(rootNode?: Node): Skeleton {
        const skeleton = new Skeleton();
        skeleton.copy(this, rootNode);
        return skeleton;
    }

    /**
     * copy
     * @param  {Skeleton} skeleton
     * @param {Node} [rootNode]
     * @return {Skeleton} this
     */
    copy(skeleton: Skeleton, rootNode?: Node): Skeleton {
        this.inverseBindMatrices = skeleton.inverseBindMatrices;
        this.jointNames = skeleton.jointNames.slice();
        if (rootNode === undefined) {
            rootNode = skeleton.rootNode!;
        }
        this.rootNode = rootNode;
        return this;
    }
}

export default Skeleton;
