import { EventDispatcher, type DispatchEvent } from './EventMixin';
import Matrix4 from '../math/Matrix4';
import Matrix4Notifier from '../math/Matrix4Notifier';
import Vector3 from '../math/Vector3';
import Vector3Notifier from '../math/Vector3Notifier';
import EulerNotifier from '../math/EulerNotifier';
import QuaternionNotifier from '../math/QuaternionNotifier';
import type Quaternion from '../math/Quaternion';
import type Ray from '../math/Ray';
import type Animation from '../animation/Animation';
import Geometry, { type Bounds } from '../geometry/Geometry';
import Skeleton from './Skeleton';
import type WebGLRenderer from '../renderer/WebGLRenderer';
import math from '../math/math';
const defaultUp = new Vector3(0, 1, 0);
const tempMatrix4 = new Matrix4();
const TRAVERSE_STOP_NONE = 0 as const;
const TRAVERSE_STOP_CHILDREN = 1 as const;
const TRAVERSE_STOP_ALL = 2 as const;
export type NodeTraverseResult = 0 | 1 | 2;
export type NodeTraverseCallback = (node: Node) => NodeTraverseResult | undefined;
export type NodeGetChildByCallback = (node: Node) => boolean;
export interface NodeRaycastInfo {
    mesh: Node;
    point: Vector3;
}
export interface NodePointerEvent extends DispatchEvent {
    eventTarget?: Node;
    eventCurrentTarget?: Node;
    hitPoint?: Vector3;
    stageX?: number;
    stageY?: number;
    pointerId?: number;
    pointerType?: string;
    isPrimary?: boolean;
    button?: number;
    buttons?: number;
    pressure?: number;
    width?: number;
    height?: number;
    clientX?: number;
    clientY?: number;
    pageX?: number;
    pageY?: number;
    altKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
    _stopPropagationed?: boolean;
}

const MOVE_TO_OVER_EVENT: Readonly<Record<string, string>> = {
    pointermove: 'pointerover',
    mousemove: 'mouseover'
};
const POINTER_EXIT_EVENTS = new Set([
    'pointerout',
    'pointerleave',
    'pointercancel',
    'mouseout',
    'mouseleave',
    'touchout',
    'touchcancel'
]);

function getPointerId(event: NodePointerEvent): number {
    return event.pointerId ?? 0;
}
interface GeometryNode extends Node {
    geometry: Geometry;
}
interface SkinnedNode extends Node {
    skeleton: Skeleton | null;
}
function hasGeometry(node: Node): node is GeometryNode {
    const geometry: unknown = Reflect.get(node, 'geometry');
    return node.isMesh && geometry instanceof Geometry;
}
function isSkinnedNode(node: Node): node is SkinnedNode {
    const skeleton: unknown = Reflect.get(node, 'skeleton');
    return node.isSkinnedMesh && (skeleton === null || skeleton instanceof Skeleton);
}
export interface NodeParameters {
    name?: string;
    anim?: Animation | null;
    animationId?: string;
    jointName?: string;
    autoUpdateWorldMatrix?: boolean;
    autoUpdateChildWorldMatrix?: boolean;
    parent?: Node | null;
    needCallChildUpdate?: boolean;
    visible?: boolean;
    pointerEnabled?: boolean;
    pointerChildren?: boolean;
    useHandCursor?: boolean;
    userData?: unknown;
    onUpdate?: ((deltaTime: number) => void) | null;
    onlySyncQuaternion?: boolean;
    up?: Vector3;
    x?: number;
    y?: number;
    z?: number;
    scaleX?: number;
    scaleY?: number;
    scaleZ?: number;
    pivotX?: number;
    pivotY?: number;
    pivotZ?: number;
    rotationX?: number;
    rotationY?: number;
    rotationZ?: number;
}
/**
 * 节点，3D场景中的元素，是大部分类的基类
 * @example
 * ```ts
 * const node = new Hilo3d.Node({
 *     name:'test',
 *     x:100,
 *     rotationX:30,
 *     onUpdate(){
 *         this.rotationY ++;
 *     }
 * });
 * node.scaleX = 0.3;
 * stage.addChild(node);
 * ```
 */
class Node extends EventDispatcher {
    static readonly typeName: string = 'Node';
    id: string;
    up: Vector3;
    children: Node[];
    worldMatrix: Matrix4;
    protected _matrix: Matrix4Notifier;
    protected _position: Vector3Notifier;
    protected _scale: Vector3Notifier;
    protected _pivot: Vector3Notifier;
    protected _rotation: EulerNotifier;
    protected _quaternion: QuaternionNotifier;
    _originName?: string;
    private readonly __pointersOver = new Set<number>();
    /**
     * traverse callback 返回值，执行后不暂停 traverse
     */
    static readonly TRAVERSE_STOP_NONE: 0 = TRAVERSE_STOP_NONE;
    /**
     * traverse callback 返回值，执行后暂停子元素 traverse
     */
    static readonly TRAVERSE_STOP_CHILDREN: 1 = TRAVERSE_STOP_CHILDREN;
    /**
     * traverse callback 返回值，执行后暂停所有 traverse
     */
    static readonly TRAVERSE_STOP_ALL: 2 = TRAVERSE_STOP_ALL;
    isNode = true;
    isCamera = false;
    isMesh = false;
    isSkinnedMesh = false;
    className = 'Node';
    /**
     * Node 的名字，可以通过 getChildByName 查找
     */
    name = '';
    /**
     * 动画
     */
    anim: Animation | null = null;
    /**
     * animation 查找 id
     */
    animationId = '';
    /**
     * 骨骼名称
     */
    jointName = '';
    /**
     * 是否自动更新世界矩阵
     */
    autoUpdateWorldMatrix = true;
    /**
     * 是否自动更新子元素世界矩阵
     */
    autoUpdateChildWorldMatrix = true;
    /**
     * 父节点
     */
    parent: Node | null = null;
    _quatDirty = false;
    _matrixDirty = false;
    /**
     * 每次更新的时候是否调用子节点的 onUpdate 方法
     */
    needCallChildUpdate = true;
    /**
     * 节点是否显示
     */
    visible = true;
    /**
     * 可视对象是否接受交互事件。默认为接受交互事件，即true。
     */
    pointerEnabled = true;
    /**
     * 子元素是否接受交互事件。
     */
    pointerChildren = true;
    /**
     * 是否用鼠标指针
     */
    useHandCursor = false;
    /**
     * 用户数据
     */
    userData: unknown = null;
    /**
     * update 回调
     */
    onUpdate: ((deltaTime: number) => void) | null = null;
    /**
     * 是否强制使用父元素 worldMatrix，供高级开发者使用
     */
    __forceUseParentWorldMatrix = false;
    /**
     * 只同步四元数，不同步欧拉角
     */
    onlySyncQuaternion = false;
    /**
     * @param params - 初始化参数，所有params都会复制到实例上
     */
    constructor(params: NodeParameters = {}) {
        super();
        this.id = math.generateUUID(new.target.typeName);
        /**
         * 元素的up向量
         */
        this.up = defaultUp.clone();
        /**
         * 元素直接点数组
         */
        this.children = [];
        /**
         * 元素的世界矩阵
         */
        this.worldMatrix = new Matrix4();
        this._matrix = new Matrix4Notifier();
        this._position = new Vector3Notifier(0, 0, 0);
        this._scale = new Vector3Notifier(1, 1, 1);
        this._pivot = new Vector3Notifier(0, 0, 0);
        this._rotation = new EulerNotifier();
        this._quaternion = new QuaternionNotifier();
        this._matrix.onUpdate = this._onMatrixUpdate.bind(this);
        this._position.onUpdate = this._onPositionUpdate.bind(this);
        this._scale.onUpdate = this._onScaleUpdate.bind(this);
        this._pivot.onUpdate = this._onPivotUpdate.bind(this);
        this._rotation.onUpdate = this._onRotationUpdate.bind(this);
        this._quaternion.onUpdate = this._onQuaternionUpdate.bind(this);
        Object.assign(this, params);
    }
    /**
     * @param isChild - 是否子节点，子节点不会处理动画及骨骼Mesh，即如果有动画将共享
     * @returns 返回clone的Node
     */
    clone(isChild?: boolean): Node {
        const NodeConstructor = this.constructor as new () => Node;
        const candidate: unknown = new NodeConstructor();
        if (!(candidate instanceof Node)) {
            throw new TypeError('Node subclasses must construct Node-compatible instances.');
        }
        const node = candidate;
        node.name = this.name;
        node.jointName = this.jointName;
        node.animationId = this.animationId;
        node.setPosition(this.x, this.y, this.z);
        node.setScale(this.scaleX, this.scaleY, this.scaleZ);
        node.setRotation(this.rotationX, this.rotationY, this.rotationZ);
        this.children.forEach(child => {
            node.addChild(child.clone(true));
        });
        if (!isChild) {
            if (this.anim) {
                node.anim = this.anim.clone(node);
            }
            node.resetSkinnedMeshRootNode();
        }
        return node;
    }
    /**
     * 设置节点的动画，这个需要是模型的根节点
     * @param anim - 动画实例
     * @returns this
     */
    setAnim(anim: Animation): this {
        this.anim = anim;
        anim.rootNode = this;
        return this;
    }
    /**
     * 重置子孙元素中 SkinnedMesh 的根节点为当前元素
     */
    resetSkinnedMeshRootNode(): void {
        this.traverse(mesh => {
            if (isSkinnedNode(mesh) && mesh.skeleton) {
                mesh.skeleton.rootNode = this;
            }
        }, true);
    }
    /**
     * 将所以子孙元素放到一个对象中，对象key为元素的name，value为该元素
     * @returns 返回获取的对象
     */
    getChildrenNameMap(): Record<string, Node> {
        const map: Record<string, Node> = {};
        this.traverse(child => {
            map[child.name] = child;
            // fix smd animation bug
            const originName = child._originName;
            if (originName !== undefined && !map[originName]) {
                map[originName] = child;
            }
        }, true);
        return map;
    }
    /**
     * 添加一个子元素
     * @param child - 需要添加的子元素
     * @returns this
     */
    addChild(child: Node): this {
        if (child.parent) {
            child.removeFromParent();
        }
        child.parent = this;
        this.children.push(child);
        return this;
    }
    /**
     * 移除指定的子元素
     * @param child - 需要移除的元素
     * @returns this
     */
    removeChild(child: Node): this {
        const index = this.children.indexOf(child);
        if (index > -1) {
            this.children.splice(index, 1);
            child.parent = null;
        }
        return this;
    }
    /**
     * 将当前元素添加到某个父元素的子元素中
     * @param parent - 需要添加到的父元素
     * @returns this
     */
    addTo(parent: Node): this {
        parent.addChild(this);
        return this;
    }
    /**
     * 将当前元素从其父元素中移除
     * @returns this
     */
    removeFromParent(): this {
        if (this.parent) {
            this.parent.removeChild(this);
        }
        return this;
    }
    /**
     * 更新本地矩阵
     * @returns this
     */
    updateMatrix(): this {
        if (this._matrixDirty) {
            this._matrixDirty = false;
            this.matrixVersion++;
            this._matrix.fromRotationTranslationScaleOrigin(
                this.quaternion,
                this._position,
                this._scale,
                this._pivot,
                true
            );
        }
        return this;
    }
    /**
     * 更新四元数
     * @returns this
     */
    updateQuaternion(): this {
        if (this._quatDirty) {
            this._quatDirty = false;
            this._quaternion.fromEuler(this._rotation, true);
        }
        return this;
    }
    /**
     * 更新transform属性
     * @returns this
     */
    updateTransform(): this {
        this._matrix.decompose(this._quaternion, this._position, this._scale, this._pivot);
        this._onQuaternionUpdate();
        this._matrixDirty = false;
        return this;
    }
    /**
     * 更新世界矩阵
     * @param force - 是否强制更新
     * @returns this
     */
    updateMatrixWorld(force?: boolean): this {
        this.traverse(node => {
            if (node.autoUpdateWorldMatrix || force) {
                if (node.parent) {
                    if (!node.__forceUseParentWorldMatrix) {
                        node.worldMatrix.multiply(node.parent.worldMatrix, node.matrix);
                    } else {
                        node.worldMatrix.copy(node.parent.worldMatrix);
                    }
                } else {
                    node.worldMatrix.copy(node.matrix);
                }
                node.worldMatrixVersion++;
            }
            if (!node.autoUpdateChildWorldMatrix && !force) {
                return TRAVERSE_STOP_CHILDREN;
            }
            return TRAVERSE_STOP_NONE;
        });
        return this;
    }
    /**
     * 获取当前元素相对于指定元素的矩阵
     * @param ancestor - 相对于的元素，需要是当前元素的祖先元素，不传表示获取世界矩阵
     * @returns 返回获取的矩阵
     */
    getConcatenatedMatrix(ancestor?: Node): Matrix4 {
        const mtx = new Matrix4();
        if (this === ancestor) return mtx;
        mtx.multiply(this.matrix, mtx);
        for (let node = this.parent; node && node !== ancestor; node = node.parent) {
            mtx.multiply(node.matrix, mtx);
        }
        return mtx;
    }
    /**
     * _traverse
     * @param callback -
     * @param onlyChild -
     * @returns TRAVERSE_STOP_ALL, TRAVERSE_STOP_CHILDREN, TRAVERSE_STOP_NONE
     */
    private _traverse(callback: NodeTraverseCallback, onlyChild: boolean): NodeTraverseResult {
        if (!onlyChild) {
            const res = callback(this);
            if (res === TRAVERSE_STOP_ALL || res === TRAVERSE_STOP_CHILDREN) {
                return res;
            }
        }
        const children = this.children;
        for (let i = 0, l = children.length; i < l; i++) {
            const child = children[i];
            if (!child) continue;
            const res = child._traverse(callback, false);
            if (res === TRAVERSE_STOP_ALL) {
                return res;
            }
        }
        return TRAVERSE_STOP_NONE;
    }
    /**
     * 遍历当前元素的子孙元素
     * @param callback - 每个元素都会调用这个函数处理
     * @param onlyChild - 是否只遍历子元素
     * @returns this
     */
    traverse(callback: NodeTraverseCallback, onlyChild = false): this {
        this._traverse(callback, onlyChild);
        return this;
    }
    /**
     * 遍历当前元素的子孙元素(广度优先)
     * @param callback - 每个元素都会调用这个函数处理
     * @param onlyChild - 是否只遍历子元素
     * @returns this
     */
    traverseBFS(callback: NodeTraverseCallback, onlyChild = false): this {
        let currentQueue: Node[];
        let nextQueue: Node[];
        if (!onlyChild) {
            nextQueue = [this];
        } else {
            nextQueue = this.children;
        }
        while (nextQueue.length) {
            currentQueue = nextQueue;
            nextQueue = [];
            for (let i = 0, l = currentQueue.length; i < l; i++) {
                const child = currentQueue[i];
                if (!child) continue;
                const res = callback(child);
                if (res === TRAVERSE_STOP_ALL) {
                    return this;
                }
                if (res !== TRAVERSE_STOP_CHILDREN) {
                    nextQueue = nextQueue.concat(child.children);
                }
            }
        }
        return this;
    }
    /**
     * 根据函数来获取一个子孙元素(广度优先)
     * @param fn - 判读函数
     * @returns 返回获取到的子孙元素
     */
    getChildByFnBFS(fn: NodeGetChildByCallback): Node | null {
        let result: Node | null = null;
        this.traverseBFS(child => {
            if (fn(child)) {
                result = child;
                return TRAVERSE_STOP_ALL;
            }
            return TRAVERSE_STOP_NONE;
        }, true);
        return result;
    }
    /**
     * 根据 name path 来获取子孙元素
     * @param path - 名字数组, e.g., getChildByNamePath(['a', 'b', 'c'])
     * @returns 返回获取到的子孙元素
     */
    getChildByNamePath(path: string[]): Node | null {
        const firstName = path[0];
        if (firstName === undefined) return this;
        let currentNode = this.getChildByFnBFS(child => child.name === firstName);
        for (let i = 1, l = path.length; i < l; i++) {
            const name = path[i];
            if (name === undefined || !currentNode) return null;
            const node = currentNode.getChildByFnBFS(child => child.name === name);
            if (node) {
                currentNode = node;
            } else {
                return null;
            }
        }
        return currentNode;
    }
    /**
     * 遍历调用子孙元素onUpdate方法
     * @param dt -
     * @returns this
     */
    traverseUpdate(dt: number): this {
        this.traverse(node => {
            if (node.onUpdate) {
                node.onUpdate(dt);
            }
            if (!node.needCallChildUpdate) {
                return TRAVERSE_STOP_CHILDREN;
            }
            return TRAVERSE_STOP_NONE;
        });
        return this;
    }
    /**
     * 根据函数来获取一个子孙元素
     * @param fn - 判读函数
     * @returns 返回获取到的子孙元素
     */
    getChildByFn(fn: NodeGetChildByCallback): Node | null {
        let result: Node | null = null;
        this.traverse(child => {
            if (fn(child)) {
                result = child;
                return TRAVERSE_STOP_ALL;
            }
            return TRAVERSE_STOP_NONE;
        }, true);
        return result;
    }
    /**
     * 根据函数来获取匹配的所有子孙元素
     * @param fn - 判读函数
     * @returns 返回获取到的子孙元素
     */
    getChildrenByFn(fn: NodeGetChildByCallback): Node[] {
        const result: Node[] = [];
        this.traverse(child => {
            if (fn(child)) {
                result.push(child);
            }
        }, true);
        return result;
    }
    /**
     * 获取指定name的首个子孙元素
     * @param name - 元素name
     * @returns 获取的元素
     */
    getChildByName(name: string): Node | null {
        return this.getChildByFn(child => child.name === name);
    }
    /**
     * 获取指定name的所有子孙元素
     * @param name - 元素name
     * @returns 获取的元素数组
     */
    getChildrenByName(name: string): Node[] {
        return this.getChildrenByFn(child => child.name === name);
    }
    /**
     * 获取指定id的子孙元素
     * @param id - 元素id
     * @returns 获取的元素
     */
    getChildById(id: string): Node | null {
        return this.getChildByFn(child => child.id === id);
    }
    /**
     * 获取指定类名的所有子孙元素
     * @param className - 类名
     * @returns 获取的元素数组
     */
    getChildrenByClassName(className: string): Node[] {
        return this.getChildrenByFn(child => child.className === className);
    }
    /**
     * 获取指定基类名的所有子孙元素
     * @param className - 类名
     * @returns 获取的元素数组
     */
    getChildrenByBaseClassName(className: string): Node[] {
        return this.getChildrenByFn(child => Reflect.get(child, `is${className}`) === true);
    }
    /**
     * 设置元素的缩放比例，如果只有一个参数三个轴等比缩放
     * @param x - X缩放比例
     * @param y - Y缩放比例
     * @param z - Z缩放比例
     * @returns this
     */
    setScale(x: number, y: number = x, z: number = y): this {
        this._scale.set(x, y, z);
        return this;
    }
    /**
     * 设置元素的位置
     * @param x - X方向位置
     * @param y - Y方向位置
     * @param z - Z方向位置
     * @returns this
     */
    setPosition(x: number, y: number, z: number): this {
        this._position.set(x, y, z);
        return this;
    }
    /**
     * 设置元素的旋转
     * @param x - X轴旋转角度, 角度制
     * @param y - Y轴旋转角度, 角度制
     * @param z - Z轴旋转角度, 角度制
     * @returns this
     */
    setRotation(x: number, y: number, z: number): this {
        this._rotation.setDegree(x, y, z);
        return this;
    }
    /**
     * 设置中心点
     * @param x - 中心点x
     * @param y - 中心点y
     * @param z - 中心点z
     * @returns this
     */
    setPivot(x: number, y: number, z: number): this {
        this._pivot.set(x, y, z);
        return this;
    }
    /**
     * 改变元素的朝向
     * @param node - 需要朝向的元素，或者坐标
     * @returns this
     */
    lookAt(node: { x: number; y: number; z: number }): this {
        if (this.isCamera) {
            tempMatrix4.targetTo(this, node, this.up);
        } else {
            tempMatrix4.targetTo(node, this, this.up);
        }
        this._quaternion.fromMat4(tempMatrix4);
        return this;
    }
    /**
     * raycast
     * @param ray -
     * @param sort - 是否按距离排序
     * @param eventMode - 是否事件模式
     */
    raycast(ray: Ray, sort = false, eventMode = false): NodeRaycastInfo[] | Vector3[] | null {
        if (!this.visible) {
            return null;
        }
        let resArray: NodeRaycastInfo[] = [];
        this.traverse(child => {
            if (eventMode && !child.pointerEnabled) {
                return TRAVERSE_STOP_CHILDREN;
            }
            if (child.isMesh) {
                const res = child.raycast(ray, false);
                if (res) {
                    resArray = resArray.concat(
                        res.map(result => {
                            const point = result instanceof Vector3 ? result : result.point;
                            return {
                                mesh: child,
                                point
                            };
                        })
                    );
                }
            }
            if (eventMode && !child.pointerChildren) {
                return TRAVERSE_STOP_CHILDREN;
            }
            return TRAVERSE_STOP_NONE;
        });
        if (resArray.length) {
            if (sort) {
                ray.sortPoints(resArray, 'point');
            }
            return resArray;
        }
        return null;
    }
    /**
     * 元素的矩阵
     */
    get matrix(): Matrix4Notifier {
        this.updateMatrix();
        return this._matrix;
    }
    /**
     * 位置
     */
    get position(): Vector3Notifier {
        return this._position;
    }
    /**
     * x轴坐标
     */
    get x(): number {
        return this._position.elements[0];
    }
    /**
     * x轴坐标
     */
    set x(value: number) {
        this._position.elements[0] = value;
        this._matrixDirty = true;
    }
    /**
     * y轴坐标
     */
    get y(): number {
        return this._position.elements[1];
    }
    /**
     * y轴坐标
     */
    set y(value: number) {
        this._position.elements[1] = value;
        this._matrixDirty = true;
    }
    /**
     * z轴坐标
     */
    get z(): number {
        return this._position.elements[2];
    }
    /**
     * z轴坐标
     */
    set z(value: number) {
        this._position.elements[2] = value;
        this._matrixDirty = true;
    }
    /**
     * 缩放
     */
    get scale(): Vector3Notifier {
        return this._scale;
    }
    /**
     * 缩放比例x
     */
    get scaleX(): number {
        return this._scale.elements[0];
    }
    /**
     * 缩放比例x
     */
    set scaleX(value: number) {
        this._scale.elements[0] = value;
        this._matrixDirty = true;
    }
    /**
     * 缩放比例y
     */
    get scaleY(): number {
        return this._scale.elements[1];
    }
    /**
     * 缩放比例y
     */
    set scaleY(value: number) {
        this._scale.elements[1] = value;
        this._matrixDirty = true;
    }
    /**
     * 缩放比例z
     */
    get scaleZ(): number {
        return this._scale.elements[2];
    }
    /**
     * 缩放比例z
     */
    set scaleZ(value: number) {
        this._scale.elements[2] = value;
        this._matrixDirty = true;
    }
    /**
     * 中心点
     */
    get pivot(): Vector3Notifier {
        return this._pivot;
    }
    /**
     * 中心点x
     */
    get pivotX(): number {
        return this._pivot.elements[0];
    }
    /**
     * 中心点x
     */
    set pivotX(value: number) {
        this._pivot.elements[0] = value;
        this._matrixDirty = true;
    }
    /**
     * 中心点y
     */
    get pivotY(): number {
        return this._pivot.elements[1];
    }
    /**
     * 中心点y
     */
    set pivotY(value: number) {
        this._pivot.elements[1] = value;
        this._matrixDirty = true;
    }
    /**
     * 中心点z
     */
    get pivotZ(): number {
        return this._pivot.elements[2];
    }
    /**
     * 中心点z
     */
    set pivotZ(value: number) {
        this._pivot.elements[2] = value;
        this._matrixDirty = true;
    }
    /**
     * 欧拉角
     */
    get rotation(): EulerNotifier {
        return this._rotation;
    }
    /**
     * 旋转角度 x, 角度制
     */
    get rotationX(): number {
        return this._rotation.degX;
    }
    /**
     * 旋转角度 x, 角度制
     */
    set rotationX(value: number) {
        this._rotation.degX = value;
    }
    /**
     * 旋转角度 y, 角度制
     */
    get rotationY(): number {
        return this._rotation.degY;
    }
    /**
     * 旋转角度 y, 角度制
     */
    set rotationY(value: number) {
        this._rotation.degY = value;
    }
    /**
     * 旋转角度 z, 角度制
     */
    get rotationZ(): number {
        return this._rotation.degZ;
    }
    /**
     * 旋转角度 z, 角度制
     */
    set rotationZ(value: number) {
        this._rotation.degZ = value;
    }
    /**
     * 四元数角度
     */
    get quaternion(): Quaternion {
        this.updateQuaternion();
        return this._quaternion;
    }
    /**
     * 矩阵 version，每次改变会加一
     */
    matrixVersion = 0;
    /**
     * 世界矩阵 version，每次改变会加一
     */
    worldMatrixVersion = 0;
    /**
     * 获取元素的包围盒信息
     *
     * @param parent - 元素相对于哪个祖先元素的包围盒，不传表示世界
     * @param currentMatrix - 当前计算的矩阵
     * @param bounds - 当前计算的包围盒信息
     * @returns 返回计算的包围盒信息
     */
    getBounds(parent?: Node, currentMatrix?: Matrix4, bounds?: Bounds): Bounds | undefined {
        if (!currentMatrix) {
            currentMatrix = this.getConcatenatedMatrix(parent);
        } else {
            currentMatrix.multiply(this.matrix);
        }
        this.children.forEach(child => {
            bounds = child.getBounds(undefined, currentMatrix.clone(), bounds);
        });
        if (hasGeometry(this)) {
            bounds = this.geometry.getBounds(currentMatrix, bounds);
        }
        return bounds;
    }
    /** 冒泡指针事件，并维护各 pointerId 的进入/离开状态。 */
    _firePointerEvent(event: NodePointerEvent): void {
        event.eventCurrentTarget = this;
        this.fire(event);
        const pointerId = getPointerId(event);
        const overType = MOVE_TO_OVER_EVENT[event.type];
        if (overType) {
            if (!this.__pointersOver.has(pointerId)) {
                this.__pointersOver.add(pointerId);
                const overEvent: NodePointerEvent = { ...event, type: overType };
                this.fire(overEvent);
            }
        } else if (
            POINTER_EXIT_EVENTS.has(event.type) ||
            (event.type === 'pointerup' && event.pointerType === 'touch') ||
            event.type === 'touchend'
        ) {
            this.__pointersOver.delete(pointerId);
        }
        const parent = this.parent;
        if (!event._stopped && !event._stopPropagationed && parent) {
            parent._firePointerEvent(event);
        }
    }
    /**
     * 销毁 Node 资源
     * @param renderer - stage时可以不传
     * @param destroyTextures - 是否销毁材质的贴图，默认不销毁
     * @returns this
     */
    destroy(renderer?: WebGLRenderer, destroyTextures = false): this {
        const nodes = this.getChildrenByBaseClassName('Node');
        this.off();
        nodes.forEach(node => {
            if (node.isMesh) {
                node.destroy(renderer, destroyTextures);
            } else {
                node.off();
                node.removeFromParent();
            }
        });
        this.removeFromParent();
        return this;
    }
    _onMatrixUpdate(): void {
        this.matrixVersion++;
        this.updateTransform();
    }
    _onPositionUpdate(): void {
        this._matrixDirty = true;
    }
    _onScaleUpdate(): void {
        this._matrixDirty = true;
    }
    _onPivotUpdate(): void {
        this._matrixDirty = true;
    }
    _onRotationUpdate(): void {
        this._quatDirty = true;
        this._matrixDirty = true;
    }
    _onQuaternionUpdate(): void {
        if (!this.onlySyncQuaternion) {
            this._rotation.fromQuat(this._quaternion);
        }
        this._quatDirty = false;
        this._matrixDirty = true;
    }
}
export default Node;
