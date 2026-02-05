import EventMixin from './EventMixin';
import Matrix4 from '../math/Matrix4';
import Matrix4Notifier from '../math/Matrix4Notifier';
import Vector3 from '../math/Vector3';
import Vector3Notifier from '../math/Vector3Notifier';
import EulerNotifier from '../math/EulerNotifier';
import QuaternionNotifier from '../math/QuaternionNotifier';
import math from '../math/math';
import log from '../utils/log';

const defaultUp = new Vector3(0, 1, 0);
const tempMatrix4 = new Matrix4();

/**
 * 节点，3D场景中的元素，是大部分类的基类
 * @class
 * @mixes EventMixin
 * @example
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
 */
class Node {
    /**
     * traverse callback 返回值，执行后不暂停 traverse
     * @memberOf Node
     * @type {number}
     */
    static readonly TRAVERSE_STOP_NONE: number = 0;

    /**
     * traverse callback 返回值，执行后暂停子元素 traverse
     * @memberOf Node
     * @type {number}
     */
    static readonly TRAVERSE_STOP_CHILDREN: number = 1;

    /**
     * traverse callback 返回值，执行后暂停所有 traverse
     * @memberOf Node
     * @type {number}
     */
    static readonly TRAVERSE_STOP_ALL: number = 2;

    /**
     * @default true
     * @type {boolean}
     */
    isNode: boolean = true;

    /**
     * @default Node
     * @type {string}
     */
    className: string = 'Node';

    /**
     * @type {string}
     */
    id!: string;

    /**
     * Node 的名字，可以通过 getChildByName 查找
     * @type {string}
     */
    name: string = '';

    /**
     * 动画
     * @type {Animation}
     * @default null
     */
    anim: any = null;

    /**
     * animation 查找 id
     * @type {String}
     * @default ''
     */
    animationId: string = '';

    /**
     * 骨骼名称
     * @type {String}
     * @default ''
     */
    jointName: string = '';

    /**
     * 是否自动更新世界矩阵
     * @default true
     * @type {boolean}
     */
    autoUpdateWorldMatrix: boolean = true;

    /**
     * 是否自动更新子元素世界矩阵
     * @default true
     * @type {boolean}
     */
    autoUpdateChildWorldMatrix: boolean = true;

    /**
     * 父节点
     * @default null
     * @type {Node}
     */
    parent: Node | null = null;

    /**
     * 元素的up向量
     * @type {Vector3}
     */
    up: Vector3;

    /**
     * 元素直接点数组
     * @type {Node[]}
     */
    children: Node[];

    /**
     * 元素的世界矩阵
     * @type {Matrix4}
     */
    worldMatrix: Matrix4;

    private _matrix: Matrix4Notifier;

    private _position: Vector3Notifier;

    private _scale: Vector3Notifier;

    private _pivot: Vector3Notifier;

    private _rotation: EulerNotifier;

    private _quaternion: QuaternionNotifier;

    private _quatDirty: boolean = false;

    private _matrixDirty: boolean = false;

    private __mouseOver?: boolean;

    /**
     * 每次更新的时候是否调用子节点的 onUpdate 方法
     * @default true
     * @type {boolean}
     */
    needCallChildUpdate: boolean = true;

    /**
     * 节点是否显示
     * @default true
     * @type {boolean}
     */
    visible: boolean = true;

    /**
     * 可视对象是否接受交互事件。默认为接受交互事件，即true。
     * @default true
     * @type {Boolean}
     */
    pointerEnabled: boolean = true;

    /**
     * 子元素是否接受交互事件。
     * @default true
     * @type {Boolean}
     */
    pointerChildren: boolean = true;

    /**
     * 是否用鼠标指针
     * @default false
     * @type {Boolean}
     */
    useHandCursor: boolean = false;

    /**
     * 用户数据
     * @default null
     * @type {any}
     */
    userData: any = null;

    /**
     * update 回调
     * @type {Function}
     * @default null
     */
    onUpdate: ((dt: number) => void) | null = null;

    /**
     * 是否强制使用父元素 worldMatrix，供高级开发者使用
     * @private
     * @type {Boolean}
     */
    __forceUseParentWorldMatrix: boolean = false;

    /**
     * 只同步四元数，不同步欧拉角
     * @type {Boolean}
     * @default false
     */
    onlySyncQuaternion: boolean = false;

    /**
     * 矩阵 version，每次改变会加一
     * @readonly
     * @type {Number}
     * @default 0
     */
    matrixVersion: number = 0;

    /**
     * 世界矩阵 version，每次改变会加一
     * @type {Number}
     * @default 0
     */
    worldMatrixVersion: number = 0;

    // Camera specific properties (used in isCamera check)
    isCamera?: boolean;

    // Mesh specific properties (used in isMesh check)
    isMesh?: boolean;

    geometry?: any;

    // SkinedMesh specific properties
    isSkinedMesh?: boolean;

    skeleton?: any;

    // Origin name for animation bug fix
    _originName?: string;

    // EventMixin properties
    private _listeners: Record<string, any[]> | null = null;

    /**
     * @constructs
     * @param {object} [params] 初始化参数，所有params都会复制到实例上
     */
    constructor(params?: any) {
        this.id = math.generateUUID(this.className);
        this.up = defaultUp.clone();
        this.children = [];
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
     * @param {boolean} [isChild=false] 是否子节点，子节点不会处理动画及骨骼Mesh，即如果有动画将共享
     * @return {Node} 返回clone的Node
     */
    clone(isChild?: boolean): Node {
        const node = new (this.constructor as any)();
        node.name = this.name;
        node.jointName = this.jointName;
        node.animationId = this.animationId;
        node.setPosition(this.x, this.y, this.z);
        node.setScale(this.scaleX, this.scaleY, this.scaleZ);
        node.setRotation(this.rotationX, this.rotationY, this.rotationZ);
        this.children.forEach((child) => {
            node.addChild(child.clone(true));
        });

        if (!isChild) {
            if (this.anim) {
                node.anim = this.anim.clone(node);
            }
            node.resetSkinedMeshRootNode();
        }
        return node;
    }

    /**
     * 设置节点的动画，这个需要是模型的根节点
     * @param {Animation} anim 动画实例
     * @return {Node} this
     */
    setAnim(anim: any): Node {
        this.anim = anim;
        anim.rootNode = this;
        return this;
    }

    /**
     * 重置子孙元素中 SkinedMesh 的根节点为当前元素
     */
    resetSkinedMeshRootNode(): void {
        this.traverse((mesh) => {
            if (mesh.isSkinedMesh && mesh.skeleton) {
                mesh.skeleton.rootNode = this;
            }
        }, true);
    }

    /**
     * 将所以子孙元素放到一个对象中，对象key为元素的name，value为该元素
     * @return {Object} 返回获取的对象
     */
    getChildrenNameMap(): Record<string, Node> {
        const map: Record<string, Node> = {};
        this.traverse((child) => {
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
     * @param {Node} child 需要添加的子元素
     * @return {Node} this
     */
    addChild(child: Node): Node {
        if (child.parent) {
            child.removeFromParent();
        }
        child.parent = this;
        this.children.push(child);

        return this;
    }

    /**
     * 移除指定的子元素
     * @param {Node} child 需要移除的元素
     * @return {Node} this
     */
    removeChild(child: Node): Node {
        const index = this.children.indexOf(child);
        if (index > -1) {
            this.children.splice(index, 1);
            child.parent = null;
        }
        return this;
    }

    /**
     * 将当前元素添加到某个父元素的子元素中
     * @param {Node} parent 需要添加到的父元素
     * @return {Node} this
     */
    addTo(parent: Node): Node {
        parent.addChild(this);
        return this;
    }

    /**
     * 将当前元素从其父元素中移除
     * @return {Node} this
     */
    removeFromParent(): Node {
        if (this.parent) {
            this.parent.removeChild(this);
        }
        return this;
    }

    /**
     * 更新本地矩阵
     * @return {Node} this
     */
    updateMatrix(): Node {
        if (this._matrixDirty) {
            this._matrixDirty = false;
            this.matrixVersion++;
            this._matrix.fromRotationTranslationScaleOrigin(this.quaternion, this._position, this._scale, this._pivot, true);
        }

        return this;
    }

    /**
     * 更新四元数
     * @return {Node} this
     */
    updateQuaternion(): Node {
        if (this._quatDirty) {
            this._quatDirty = false;
            this._quaternion.fromEuler(this._rotation, true);
        }

        return this;
    }

    /**
     * 更新transform属性
     * @return {Node} this
     */
    updateTransform(): Node {
        this._matrix.decompose(this._quaternion, this._position, this._scale, this._pivot);
        this._onQuaternionUpdate();

        this._matrixDirty = false;
        return this;
    }

    /**
     * 更新世界矩阵
     * @param  {Boolean} [force=true] 是否强制更新
     * @return {Node} this
     */
    updateMatrixWorld(force?: boolean): Node {
        this.traverse((node) => {
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
                return Node.TRAVERSE_STOP_CHILDREN;
            }

            return Node.TRAVERSE_STOP_NONE;
        });
        return this;
    }

    /**
     * 获取当前元素相对于指定元素的矩阵
     * @param {Node} [ancestor] 相对于的元素，需要是当前元素的祖先元素，不传表示获取世界矩阵
     * @return {Matrix4} 返回获取的矩阵
     */
    getConcatenatedMatrix(ancestor?: Node): Matrix4 {
        const mtx = new Matrix4();

        for (let o: Node | null = this; o && o !== ancestor; o = o.parent) {
            mtx.multiply(o.matrix, mtx);
        }
        return mtx;
    }

    /**
     * _traverse
     * @private
     * @param  {NodeTraverseCallback} callback
     * @param  {Boolean}  onlyChild
     * @return {Enum}  TRAVERSE_STOP_ALL, TRAVERSE_STOP_CHILDREN, TRAVERSE_STOP_NONE
     */
    private _traverse(callback: NodeTraverseCallback, onlyChild: boolean): number {
        if (!onlyChild) {
            const res = callback(this);
            if (res === Node.TRAVERSE_STOP_ALL || res === Node.TRAVERSE_STOP_CHILDREN) {
                return res;
            }
        }

        const children = this.children;
        for (let i = 0, l = children.length; i < l; i++) {
            const res = children[i]._traverse(callback, false);
            if (res === Node.TRAVERSE_STOP_ALL) {
                return res;
            }
        }

        return Node.TRAVERSE_STOP_NONE;
    }

    /**
     * 遍历当前元素的子孙元素
     * @param {NodeTraverseCallback} callback 每个元素都会调用这个函数处理
     * @param {Boolean} [onlyChild=false] 是否只遍历子元素
     * @return {Node} this
     */
    traverse(callback: NodeTraverseCallback, onlyChild: boolean = false): Node {
        this._traverse(callback, onlyChild);
        return this;
    }

    /**
     * 遍历当前元素的子孙元素(广度优先)
     * @param {NodeTraverseCallback} callback 每个元素都会调用这个函数处理
     * @param {Boolean} [onlyChild=false] 是否只遍历子元素
     * @return {Node} this
     */
    traverseBFS(callback: NodeTraverseCallback, onlyChild: boolean = false): Node {
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
                const res = callback(child);
                if (res === Node.TRAVERSE_STOP_ALL) {
                    return this;
                }

                if (res !== Node.TRAVERSE_STOP_CHILDREN) {
                    nextQueue = nextQueue.concat(child.children);
                }
            }
        }
        return this;
    }

    /**
     * 根据函数来获取一个子孙元素(广度优先)
     * @param {NodeGetChildByCallback} fn 判读函数
     * @return {Node|null} 返回获取到的子孙元素
     */
    getChildByFnBFS(fn: NodeGetChildByCallback): Node | null {
        let result: Node | null = null;
        this.traverseBFS((child) => {
            if (fn(child)) {
                result = child;
                return Node.TRAVERSE_STOP_ALL;
            }
            return Node.TRAVERSE_STOP_NONE;
        }, true);

        return result;
    }

    /**
     * 根据 name path 来获取子孙元素
     * @param  {String[]} path 名字数组, e.g., getChildByNamePath(['a', 'b', 'c'])
     * @return {Node|null} 返回获取到的子孙元素
     */
    getChildByNamePath(path: string[]): Node | null {
        let currentNode: Node | null = this;
        for (let i = 0, l = path.length; i < l; i++) {
            const name = path[i];
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
     * @param  {Number} dt
     * @return {Node} this
     */
    traverseUpdate(dt: number): Node {
        this.traverse((node) => {
            if (node.onUpdate) {
                node.onUpdate(dt);
            }
            if (!node.needCallChildUpdate) {
                return Node.TRAVERSE_STOP_CHILDREN;
            }
            return Node.TRAVERSE_STOP_NONE;
        });
        return this;
    }

    /**
     * 根据函数来获取一个子孙元素
     * @param {NodeGetChildByCallback} fn 判读函数
     * @return {Node|null} 返回获取到的子孙元素
     */
    getChildByFn(fn: NodeGetChildByCallback): Node | null {
        let result: Node | null = null;
        this.traverse((child) => {
            if (fn(child)) {
                result = child;
                return Node.TRAVERSE_STOP_ALL;
            }
            return Node.TRAVERSE_STOP_NONE;
        }, true);

        return result;
    }

    /**
     * 根据函数来获取匹配的所有子孙元素
     * @param {NodeGetChildByCallback} fn 判读函数
     * @return {Node[]} 返回获取到的子孙元素
     */
    getChildrenByFn(fn: NodeGetChildByCallback): Node[] {
        const result: Node[] = [];
        this.traverse((child) => {
            if (fn(child)) {
                result.push(child);
            }
        }, true);
        return result;
    }

    /**
     * 获取指定name的首个子孙元素
     * @param {string} name 元素name
     * @return {Node|null} 获取的元素
     */
    getChildByName(name: string): Node | null {
        return this.getChildByFn(child => child.name === name);
    }

    /**
     * 获取指定name的所有子孙元素
     * @param {string} name 元素name
     * @return {Node[]} 获取的元素数组
     */
    getChildrenByName(name: string): Node[] {
        return this.getChildrenByFn(child => child.name === name);
    }

    /**
     * 获取指定id的子孙元素
     * @param {string} id 元素id
     * @return {Node|null} 获取的元素
     */
    getChildById(id: string): Node | null {
        return this.getChildByFn(child => child.id === id);
    }

    /**
     * 获取指定类名的所有子孙元素
     * @param {string} className 类名
     * @return {Node[]} 获取的元素数组
     */
    getChildrenByClassName(className: string): Node[] {
        return this.getChildrenByFn(child => child.className === className);
    }

    /**
     * 获取指定基类名的所有子孙元素
     * @param {string} className 类名
     * @return {Node[]} 获取的元素数组
     */
    getChildrenByBaseClassName(className: string): Node[] {
        return this.getChildrenByFn(child => (child as any)['is' + className]);
    }

    /**
     * 设置元素的缩放比例，如果只有一个参数三个轴等比缩放
     * @param {number} x X缩放比例
     * @param {number} [y] Y缩放比例
     * @param {number} [z] Z缩放比例
     * @return {Node} this
     */
    setScale(x: number, y: number = x, z: number = y): Node {
        this._scale.set(x, y, z);
        return this;
    }

    /**
     * 设置元素的位置
     * @param {number} x X方向位置
     * @param {number} y Y方向位置
     * @param {number} z Z方向位置
     * @return {Node} this
     */
    setPosition(x: number, y: number, z: number): Node {
        this._position.set(x, y, z);
        return this;
    }

    /**
     * 设置元素的旋转
     * @param {number} x X轴旋转角度, 角度制
     * @param {number} y Y轴旋转角度, 角度制
     * @param {number} z Z轴旋转角度, 角度制
     * @return {Node} this
     */
    setRotation(x: number, y: number, z: number): Node {
        this._rotation.setDegree(x, y, z);
        return this;
    }

    /**
     * 设置中心点
     * @param {Number} x 中心点x
     * @param {Number} y 中心点y
     * @param {Number} z 中心点z
     * @return {Node} this
     */
    setPivot(x: number, y: number, z: number): Node {
        this._pivot.set(x, y, z);
        return this;
    }

    /**
     * 改变元素的朝向
     * @param {Node|Object|Vector3} node 需要朝向的元素，或者坐标
     * @return {Node} this
     */
    lookAt(node: any): Node {
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
     * @param  {Ray} ray
     * @param {Boolean} [sort=false] 是否按距离排序
     * @param {Boolean} [eventMode=false] 是否事件模式
     * @return {raycastInfo[]|null}
     */
    raycast(ray: any, sort: boolean = false, eventMode: boolean = false): any[] | null {
        if (!this.visible) {
            return null;
        }
        let resArray: any[] = [];
        this.traverse((child) => {
            if (eventMode && !child.pointerEnabled) {
                return Node.TRAVERSE_STOP_CHILDREN;
            }

            if (child.isMesh) {
                const res = child.raycast(ray, false);
                if (res) {
                    resArray = resArray.concat(res.map((point: any) => {
                        return {
                            mesh: child,
                            point
                        };
                    }));
                }
            }

            if (eventMode && !child.pointerChildren) {
                return Node.TRAVERSE_STOP_CHILDREN;
            }

            return Node.TRAVERSE_STOP_NONE;
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
     * @type {Matrix4Notifier}
     * @readOnly
     */
    get matrix(): Matrix4Notifier {
        this.updateMatrix();
        return this._matrix;
    }

    set matrix(value: Matrix4Notifier) {
        log.warnOnce('Node.matrix.set', 'node.matrix is readOnly.Use node.matrix.copy instead.');
        this._matrix.copy(value);
    }

    /**
     * 位置
     * @type {Vector3Notifier}
     * @readOnly
     */
    get position(): Vector3Notifier {
        return this._position;
    }

    set position(value: Vector3Notifier) {
        log.warnOnce('Node.position.set', 'node.position is readOnly.Use node.position.copy instead.');
        this._position.copy(value);
    }

    /**
     * x轴坐标
     * @type {number}
     */
    get x(): number {
        return this._position.elements[0];
    }

    set x(value: number) {
        this._position.elements[0] = value;
        this._matrixDirty = true;
    }

    /**
     * y轴坐标
     * @type {number}
     */
    get y(): number {
        return this._position.elements[1];
    }

    set y(value: number) {
        this._position.elements[1] = value;
        this._matrixDirty = true;
    }

    /**
     * z轴坐标
     * @type {number}
     */
    get z(): number {
        return this._position.elements[2];
    }

    set z(value: number) {
        this._position.elements[2] = value;
        this._matrixDirty = true;
    }

    /**
     * 缩放
     * @type {Vector3Notifier}
     * @readOnly
     */
    get scale(): Vector3Notifier {
        return this._scale;
    }

    set scale(value: Vector3Notifier) {
        log.warnOnce('Node.scale.set', 'node.scale is readOnly.Use node.scale.copy instead.');
        this._scale.copy(value);
    }

    /**
     * 缩放比例x
     * @type {number}
     */
    get scaleX(): number {
        return this._scale.elements[0];
    }

    set scaleX(value: number) {
        this._scale.elements[0] = value;
        this._matrixDirty = true;
    }

    /**
     * 缩放比例y
     * @type {number}
     */
    get scaleY(): number {
        return this._scale.elements[1];
    }

    set scaleY(value: number) {
        this._scale.elements[1] = value;
        this._matrixDirty = true;
    }

    /**
     * 缩放比例z
     * @type {number}
     */
    get scaleZ(): number {
        return this._scale.elements[2];
    }

    set scaleZ(value: number) {
        this._scale.elements[2] = value;
        this._matrixDirty = true;
    }

    /**
     * 中心点
     * @type {Vector3Notifier}
     * @readOnly
     */
    get pivot(): Vector3Notifier {
        return this._pivot;
    }

    set pivot(value: Vector3Notifier) {
        log.warnOnce('Node.pivot.set', 'node.pivot is readOnly.Use node.pivot.copy instead.');
        this._pivot.copy(value);
    }

    /**
     * 中心点x
     * @type {Number}
     */
    get pivotX(): number {
        return this._pivot.elements[0];
    }

    set pivotX(value: number) {
        this._pivot.elements[0] = value;
        this._matrixDirty = true;
    }

    /**
     * 中心点y
     * @type {Number}
     */
    get pivotY(): number {
        return this._pivot.elements[1];
    }

    set pivotY(value: number) {
        this._pivot.elements[1] = value;
        this._matrixDirty = true;
    }

    /**
     * 中心点z
     * @type {Number}
     */
    get pivotZ(): number {
        return this._pivot.elements[2];
    }

    set pivotZ(value: number) {
        this._pivot.elements[2] = value;
        this._matrixDirty = true;
    }

    /**
     * 欧拉角
     * @type {EulerNotifier}
     * @readOnly
     */
    get rotation(): EulerNotifier {
        return this._rotation;
    }

    set rotation(value: EulerNotifier) {
        log.warnOnce('Node.rotation.set', 'node.rotation is readOnly.Use node.rotation.copy instead.');
        this._rotation.copy(value);
    }

    /**
     * 旋转角度 x, 角度制
     * @type {number}
     */
    get rotationX(): number {
        return this._rotation.degX;
    }

    set rotationX(value: number) {
        this._rotation.degX = value;
    }

    /**
     * 旋转角度 y, 角度制
     * @type {number}
     */
    get rotationY(): number {
        return this._rotation.degY;
    }

    set rotationY(value: number) {
        this._rotation.degY = value;
    }

    /**
     * 旋转角度 z, 角度制
     * @type {number}
     */
    get rotationZ(): number {
        return this._rotation.degZ;
    }

    set rotationZ(value: number) {
        this._rotation.degZ = value;
    }

    /**
     * 四元数角度
     * @type {Quaternion}
     */
    get quaternion(): QuaternionNotifier {
        this.updateQuaternion();
        return this._quaternion;
    }

    set quaternion(value: QuaternionNotifier) {
        log.warnOnce('Node.quaternion.set', 'node.quaternion is readOnly.Use node.quaternion.copy instead.');
        this._quaternion.copy(value);
    }

    /**
     * 获取元素的包围盒信息
     *
     * @param {Node} [parent] 元素相对于哪个祖先元素的包围盒，不传表示世界
     * @param {Matrix4} [currentMatrix] 当前计算的矩阵
     * @param {Bounds} [bounds] 当前计算的包围盒信息
     * @return {Bounds} 返回计算的包围盒信息
     */
    getBounds(parent?: Node, currentMatrix?: Matrix4, bounds?: any): any {
        if (!currentMatrix) {
            currentMatrix = this.getConcatenatedMatrix(parent);
        } else {
            currentMatrix.multiply(this.matrix);
        }

        this.children.forEach((child) => {
            bounds = child.getBounds(null, currentMatrix.clone(), bounds);
        });

        if (this.isMesh) {
            bounds = this.geometry.getBounds(currentMatrix, bounds);
        }
        return bounds;
    }

    /**
     * 冒泡鼠标事件
     * @param {Object} event
     * @private
     */
    private _fireMouseEvent(event: any): void {
        event.eventCurrentTarget = this;
        this.fire(event);

        // 处理mouseover事件 mouseover不需要阻止冒泡
        // handle mouseover event, mouseover needn't stop propagation.
        if (event.type === 'mousemove') {
            if (!this.__mouseOver) {
                this.__mouseOver = true;
                const overEvent = Object.assign({}, event);
                overEvent.type = 'mouseover';
                this.fire(overEvent);
            }
        } else if (event.type === 'mouseout') {
            this.__mouseOver = false;
        }

        // 向上冒泡
        // handle event propagation
        const parent = this.parent;
        if (!event._stopped && !event._stopPropagationed && parent) {
            parent._fireMouseEvent(event);
        }
    }

    /**
     * 销毁 Node 资源
     * @param {WebGLRenderer} [renderer] stage时可以不传
     * @param {Boolean} [destroyTextures=false] 是否销毁材质的贴图，默认不销毁
     * @return {Node} this
     */
    destroy(renderer?: any, destroyTextures: boolean = false): Node {
        const nodes = this.getChildrenByBaseClassName('Node');
        this.off();
        nodes.forEach((node) => {
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

    private _onMatrixUpdate(): void {
        this.matrixVersion++;
        this.updateTransform();
    }

    private _onPositionUpdate(): void {
        this._matrixDirty = true;
    }

    private _onScaleUpdate(): void {
        this._matrixDirty = true;
    }

    private _onPivotUpdate(): void {
        this._matrixDirty = true;
    }

    private _onRotationUpdate(): void {
        this._quatDirty = true;
        this._matrixDirty = true;
    }

    private _onQuaternionUpdate(): void {
        if (!this.onlySyncQuaternion) {
            this._rotation.fromQuat(this._quaternion);
        }
        this._quatDirty = false;
        this._matrixDirty = true;
    }

    // EventMixin methods
    on(type: string, listener: (e: any) => void, once?: boolean): this {
        return EventMixin.on.call(this, type, listener, once);
    }

    off(type?: string, listener?: (e: any) => void): this {
        return EventMixin.off.call(this, type, listener);
    }

    fire(type: string | any, detail?: any): boolean {
        return EventMixin.fire.call(this, type, detail);
    }
}

export default Node;

/**
 * 包围盒信息
 * @typedef {object} Bounds
 * @property {number} x 包围盒中心的X坐标
 * @property {number} y 包围盒中心的Y坐标
 * @property {number} z 包围盒中心的Z坐标
 * @property {number} width 包围盒的宽度
 * @property {number} height 包围盒的高度
 * @property {number} depth 包围盒的深度
 * @property {number} xMin X轴的最小值
 * @property {number} xMax X轴的最大值
 * @property {number} yMin Y轴的最小值
 * @property {number} yMax Y轴的最大值
 * @property {number} zMin Z轴的最小值
 * @property {number} zMax Z轴的最大值
 */


/**
 * 碰撞信息
 * @typedef {object} raycastInfo
 * @property {Mesh} mesh 碰撞的 mesh
 * @property {Vector3} point 碰撞得点
 */


/**
 * Node traverse 回调
 * @callback NodeTraverseCallback
 * @param {Node} node
 * @return {any} Node.TRAVERSE_STOP_NONE | Node.TRAVERSE_STOP_CHILDREN | Node.TRAVERSE_STOP_ALL
 */
type NodeTraverseCallback = (node: Node) => any;

/**
 * Node getChildByCallback 回调
 * @callback NodeGetChildByCallback
 * @param {Node} node
 * @return {boolean}
 */
type NodeGetChildByCallback = (node: Node) => boolean;
