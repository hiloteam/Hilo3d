import math from '../math/math';
import type Matrix4 from '../math/Matrix4';
import type Node from './Node';

export interface SkeletonParameters {
    userData?: unknown;
    jointNodeList?: Node[];
    jointNames?: string[];
    inverseBindMatrices?: Matrix4[];
    rootNode?: Node | null;
}
/**
 * 骨架
 */
class Skeleton {
    readonly id: string;
    jointNodeList: Node[];
    jointNames: string[];
    inverseBindMatrices: Matrix4[];
    isSkeleton = true;
    className = 'Skeleton';
    /**
     * 用户数据
     */
    userData: unknown = null;
    /**
     * @param params - 创建对象的属性参数。可包含此类的所有属性。
     */
    constructor(params: SkeletonParameters = {}) {
        /**
         * id
         */
        this.id = math.generateUUID(this.className);
        this.jointNodeList = [];
        this.jointNames = [];
        this.inverseBindMatrices = [];
        Object.assign(this, params);
    }
    /**
     * 关节数量
     */
    get jointCount(): number {
        return this.jointNodeList.length;
    }
    private _rootNode: Node | null = null;
    /**
     * 设置根节点
     */
    get rootNode(): Node | null {
        return this._rootNode;
    }
    /**
     * 设置根节点
     */
    set rootNode(rootNode: Node | null) {
        this._rootNode = rootNode;
        if (rootNode) {
            this._initJointNodeList();
        }
    }
    private _initJointNodeList(): void {
        const rootNode = this.rootNode;
        if (!rootNode) return;

        const map: Record<string, Node> = {};
        rootNode.traverse(node => {
            map[node.jointName] = node;
        });
        this.jointNodeList = this.jointNames.map(name => {
            const joint = map[name];
            if (!joint) throw new Error(`Unable to find skeleton joint "${name}".`);
            return joint;
        });
    }
    /**
     * 用新骨骼的 node name 重设 jointNames
     * @param skeleton - 新骨架
     */
    resetJointNamesByNodeName(skeleton: Skeleton): void {
        const jointNames = this.jointNames;
        this.jointNodeList.forEach((jointNode, index) => {
            const mainJointNode = skeleton.rootNode?.getChildByName(jointNode.name);
            if (mainJointNode) {
                jointNames[index] = mainJointNode.jointName;
            }
        });
    }
    /**
     * clone
     * @param rootNode -
     */
    clone(rootNode?: Node): Skeleton {
        const skeleton = new Skeleton();
        skeleton.copy(this, rootNode);
        return skeleton;
    }
    /**
     * copy
     * @param skeleton -
     * @param rootNode -
     * @returns this
     */
    copy(skeleton: Skeleton, rootNode?: Node): this {
        this.inverseBindMatrices = skeleton.inverseBindMatrices;
        this.jointNames = skeleton.jointNames.slice();
        const selectedRoot = rootNode ?? skeleton.rootNode;
        this.rootNode = selectedRoot;
        return this;
    }
}
export default Skeleton;
