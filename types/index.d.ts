/**
 * @File   : index.d.tsx
 * @Author : 瞬光 (shunguang.dty@antfin.com)
 * @Date   : 2018-7-23 15:21:36
 * @Description:
 */

export = hilo3d;
export as namespace hilo3d;

declare namespace hilo3d {
  class Image extends HTMLImageElement {}

  class IAnimation {
    /**
     * 动画是否暂停
     */
    paused?: boolean;

    /**
     * 动画当前播放次数
     */
    currentLoopCount?: number;

    /**
     * 动画需要播放的次数，默认值为 Infinity 表示永远循环
     */
    loop?: number;

    /**
     * 动画当前时间
     */
    currentTime?: number;

    /**
     * 动画播放速度
     */
    timeScale?: number;

    /**
     * 动画开始时间
     */
    startTime?: number;

    /**
     * 动画结束时间，初始化后会根据 AnimationStates 来自动获取，也可以通过 play 来改变
     */
    endTime?: number;

    /**
     * 动画整体的最小时间，初始化后会根据 AnimationStates 来自动获取
     */
    baseTime?: number;

    /**
     * 动画总时间，初始化后会根据 AnimationStates 来自动获取
     */
    totalTime?: number;

    /**
     * 动画剪辑列表，{ name: { start: 0, end: 1} }，play的时候可以通过name来播放某段剪辑
     */
    clips?: {[name: string]: {start: number, end: number}};
  }

  class Animation extends IAnimation {
    /**
     * 动画类
     */
    constructor();

    /**
     * 
     * @param parmas 创建对象的属性参数。可包含此类的所有属性。
     */
    constructor(parmas: IAnimation);

    /**
     * tick
     * @param dt 一帧时间
     */
    static tick(dt: number): void;

    isAnimation: boolean;

    className: string;

    /**
     * 动画根节点，不指定根节点将无法正常播放动画
     */
    rootNode: Node;

    id: string;

    /**
     * 动画状态列表
     */
    animStatesList: AnimationStates[];

    tick(delta: number): void;
    validAnimationIds: {[key: number]: boolean};

    /**
     * 添加动画剪辑
     * @param name 剪辑名字
     * @param start 动画开始时间
     * @param end 动画结束时间
     * @param animStatesList 动画帧列表
     */
    addClip(name: string, start: number, end: number, animStatesList: AnimationStates[]): void;

    /**
     * 移除动画剪辑
     * @param name 需要移除的剪辑名字
     */
    removeClip(name: string): void;

    /**
     * 播放动画(剪辑)
     * @param startOrClipName 动画开始时间，或者动画剪辑名字
     * @param end 动画结束时间，如果是剪辑的话不需要传
     */
    play(startOrClipName?: number | string, end?: number): void;

    /**
     * 停止动画，这个会将动画从Ticker中移除，需要重新调用play才能再次播放
     */
    stop(): void;

    /**
     * 暂停动画，这个不会将动画从Ticker中移除
     */
    pause(): void;

    /**
     * 恢复动画播放，只能针对 pause 暂停后恢复
     */
    resume(): void;

    /**
     * clone动画
     * @param rootNode 目标动画根节点
     */
    clone(rootNode: Node): Animation;
      
    /**
     * 增加一个事件监听。
     * @param type 事件类型，目前仅有`end`
     * @param listener 回调
     * @param once 是否只触发一次
     */
    on(type: string, listener: Function, once: Boolean): void;

    /**
     * 删除一个事件监听。如果不传入任何参数，则删除所有的事件监听；如果不传入第二个参数，则删除指定类型的所有事件监听。
     * @param type 事件类型，目前仅有`end`
     * @param listener 回调
     */
    off(type: string, listener: Function): void;
  }

  enum AnimationStatesTypes {
    TRANSLATE = 'Translation',
    POSITION = 'Translation',
    TRANSLATION = 'Translation',
    SCALE = 'Scale',
    ROTATE = 'Rotation',
    ROTATION = 'Rotation',
    QUATERNION = 'Quaternion',
    WEIGHTS = 'Weights'
  }
  class AnimationStates {
    /**
     * 元素动画状态序列处理
     */
    constructor();

    /**
     * 
     * @param parmas 创建对象的属性参数。可包含此类的所有属性。
     */
    constructor(parmas: Object);

    /**
     * 状态类型
     * @memberOf AnimationStates
     * @static
     */
    static StateType: AnimationStatesTypes;
    /**
     * 根据名字获取状态类型
     * @param name 名字，忽略大小写，如 translate => StateType.TRANSLATE
     */
    static getType(name: string): AnimationStatesTypes;

    isAnimationStates: boolean;

    className: string;

    /**
     * 对应的node名字(动画是根据名字关联的)
     */
    nodeName: string;

    /**
     * 状态类型
     */
    type: AnimationStatesTypes;

    /**
     * 插值算法
     */
    interpolationType: string;

    id: string;

    /**
     * 时间序列
     */
    keyTime: number[];

    /**
     * 对应时间上的状态，数组长度应该跟keyTime一致，即每一帧上的状态信息
     */
    states: Array<AnimationStatesTypes>[];

    /**
     * 查找指定时间在 keyTime 数组中的位置
     * @param time 指定的时间
     */
    findIndexByTime(time: number): number[];

    /**
     * 获取指定时间上对应的状态，这里会进行插值计算
     * @param time 指定的时间
     */
    getState(time: number): number[];

    /**
     * 更新指定元素的位置
     * @param node 需要更新的元素
     * @param value 位置信息，[x, y, z]
     */
    updateNodeTranslation(node: Node, value: number[]): void;

    /**
     * 更新指定元素的缩放
     * @param node 需要更新的元素
     * @param value 缩放信息，[scaleX, scaleY, scaleZ]
     */
    updateNodeScale(node: Node, value: number[]): void;

    /**
     * 更新指定元素的旋转(四元数)
     * @param node 需要更新的元素
     * @param value 四元数的旋转信息，[x, y, z, w]
     */
    updateNodeQuaternion(node: Node, value: number[]): void;

    /**
     * 更新指定元素的状态
     * @param time 时间，从keyTime中查找到状态然后更新
     * @param node 需要更新的元素
     */
    updateNodeState(time: number, node: Node): void;

    /**
     * clone
     */
    clone(): AnimationStates;

  }

  class Camera extends ITransformAttributes {
    /**
     * 摄像机
     */
    constructor();

    /**
     * 
     * @param params 创建对象的属性参数。可包含此类的所有属性。
     */
    constructor(params: Object);

    isCamera: boolean;

    className: string;

    /**
     * 相对于摄像头的矩阵
     */
    viewMatrix: Matrix4;

    /**
     * 投影矩阵
     */
    projectionMatrix: Matrix4;

    /**
     * View 联结投影矩阵
     */
    viewProjectionMatrix: Matrix4;

    /**
     * 更新viewMatrix
     */
    updateViewMatrix(): Camera;

    /**
     * 更新投影矩阵，子类必须重载这个方法
     */
    updateProjectionMatrix(): void;

    /**
     * 获取几何体，子类必须重写
     * @param forceUpdate 是否强制更新
     */
    getGeometry(forceUpdate: boolean): Geometry;

    /**
     * 更新viewProjectionMatrix
     */
    updateViewProjectionMatrix(): Camera;

    /**
     * 获取元素相对于当前Camera的矩阵
     * @param node 目标元素
     * @param out 传递将在这个矩阵上做计算，不传将创建一个新的 Matrix4
     */
    getModelViewMatrix(node: Node, out?: Matrix4): Matrix4;

    /**
     * 获取元素的投影矩阵
     * @param node 目标元素
     * @param out 传递将在这个矩阵上做计算，不传将创建一个新的 Matrix4
     */
    getModelProjectionMatrix(node: Node, out?: Matrix4): Matrix4;

    /**
     * 获取世界坐标系(三维)中一个点在画布(二维)上的位置
     * @param vector 点坐标
     * @param width 画布宽，不传的话返回0~1
     * @param height 画布高，不传的话返回0~1
     */
    projectVector(vector: Vector3, width?: number, height?: number): Vector3;

    /**
     * 屏幕坐标转换世界坐标系
     * @param vector 点坐标
     * @param width 画布宽，传的话vector会认为是屏幕坐标
     * @param height 画布高，传的话vector会认为是屏幕坐标
     */
    unprojectVector(vector: Vector3, width?: number, height?: number): Vector3;

    /**
     * point是否摄像机可见
     * @param point
     */
    isPointVisible(point: Vector3): boolean;

    /**
     * mesh 是否摄像机可见
     * @param mesh
     */
    isMeshVisible(mesh: Mesh): boolean;

    /**
     * 更新 frustum
     * @param matrix
     */
    updateFrustum(matrix: Matrix4): Camera;

    isNode: boolean;

    /**
     * Node 的名字，可以通过 getChildByName 查找
     */
    name: string;

    /**
     * animation 查找 id
     */
    animationId: number;

    /**
     * 是否自动更新世界矩阵
     */
    autoUpdateWorldMatrix: boolean;

    /**
     * 父节点
     */
    parent: Node;

    /**
     * 每次更新的时候是否调用子节点的 onUpdate 方法
     */
    needCallChildUpdate: boolean;

    /**
     * 节点是否显示
     */
    visible: boolean;

    /**
     * 可视对象是否接受交互事件。默认为接受交互事件，即true。
     */
    pointerEnabled: boolean;

    /**
     * 子元素是否接受交互事件。
     */
    pointerChildren: boolean;

    /**
     * 是否用鼠标指针
     */
    useHandCursor: boolean;

    id: string;

    /**
     * 元素的up向量
     */
    up: Vector3;

    /**
     * 元素直接点数组
     */
    children: Node[];

    /**
     * 元素的世界矩阵
     */
    worldMatrix: Matrix4;

    /**
     * 
     * @param isChild 是否子节点，子节点不会处理动画及骨骼Mesh，即如果有动画将共享
     */
    clone(isChild?: boolean): Node;

    /**
     * 设置节点的动画，这个需要是模型的根节点
     * @param anim 动画实例
     */
    setAnim(anim: Animation): Node;

    /**
     * 重置子孙元素中 SkinedMesh 的根节点为当前元素
     */
    resetSkinedMeshRootNode(): void;

    /**
     * 将所以子孙元素放到一个对象中，对象key为元素的name，value为该元素
     */
    getChildrenNameMap(): Object;

    /**
     * 添加一个子元素
     * @param child 需要添加的子元素
     */
    addChild(child: Node): Node;

    /**
     * 移除指定的子元素
     * @param child 需要移除的元素
     */
    removeChild(child: Node): Node;

    /**
     * 将当前元素添加到某个父元素的子元素中
     * @param parent 需要添加到的父元素
     */
    addTo(parent: Node | Stage): Node;

    /**
     * 将当前元素从其父元素中移除
     */
    removeFromParent(): Node;

    /**
     * 更新本地矩阵
     */
    updateMatrix(): Node;

    /**
     * 更新transform属性
     */
    updateTransform(): Node;

    /**
     * 更新世界矩阵
     * @param force 是否强制更新
     */
    updateMatrixWorld(force?: boolean): Node;

    /**
     * 获取当前元素相对于指定元素的矩阵
     * @param ancestor 相对于的元素，需要是当前元素的祖先元素，不传表示获取世界矩阵
     */
    getConcatenatedMatrix(ancestor?: Node): Matrix4;

    /**
     * 遍历当前元素的子孙元素
     * @param callback 每个元素都会调用这个函数处理
     * @param onlyChild 是否只遍历子元素
     */
    traverse(callback: Function, onlyChild?: boolean): Node;

    /**
     * 遍历调用子孙元素onUpdate方法
     * @param dt
     */
    traverseUpdate(dt: number): Node;

    /**
     * 根据函数来获取一个子孙元素
     * @param fn 判读函数
     */
    getChildByFn(fn: Function): Node | null;

    /**
     * 根据函数来获取匹配的所有子孙元素
     * @param fn 判读函数
     */
    getChildrenByFn(fn: Function): Node[];

    /**
     * 获取指定name的首个子孙元素
     * @param name 元素name
     */
    getChildByName(name: string): Node | null;

    /**
     * 获取指定name的所有子孙元素
     * @param name 元素name
     */
    getChildrenByName(name: string): Node[];

    /**
     * 获取指定id的子孙元素
     * @param id 元素id
     */
    getChildById(id: string): Node | null;

    /**
     * 获取指定类名的所有子孙元素
     * @param className 类名
     */
    getChildrenByClassName(className: string): Node[];

    /**
     * 设置元素的缩放比例
     * @param x X缩放比例
     * @param y Y缩放比例
     * @param z Z缩放比例
     */
    setScale(x: number, y: number, z: number): Node;

    /**
     * 设置元素的位置
     * @param x X方向位置
     * @param y Y方向位置
     * @param z Z方向位置
     */
    setPosition(x: number, y: number, z: number): Node;

    /**
     * 设置元素的旋转
     * @param x X轴旋转角度
     * @param y Y轴旋转角度
     * @param z Z轴旋转角度
     */
    setRotation(x: number, y: number, z: number): Node;

    /**
     * 设置中心点
     * @param x 中心点x
     * @param y 中心点y
     * @param z 中心点z
     */
    setPivot(x: number, y: number, z: number): Node;

    /**
     * 改变元素的朝向
     * @param node 需要朝向的元素，或者坐标
     */
    lookAt(node: Node | Object | Vector3): Node;
    onUpdate(escapeTime: number): any;

    /**
     * raycast
     * @param ray
     * @param sort 是否按距离排序
     * @param eventMode 是否事件模式
     */
    raycast(ray: Ray, sort?: boolean, eventMode?: boolean): raycastInfo[] | null;

    /**
     * 元素的矩阵
     */
    matrix: Matrix4;

    /**
     * x轴坐标
     */
    x: number;

    /**
     * y轴坐标
     */
    y: number;

    /**
     * z轴坐标
     */
    z: number;

    /**
     * 缩放比例x
     */
    scaleX: number;

    /**
     * 缩放比例y
     */
    scaleY: number;

    /**
     * 缩放比例z
     */
    scaleZ: number;

    /**
     * 旋转角度x
     */
    rotationX: number;

    /**
     * 旋转角度y
     */
    rotationY: number;

    /**
     * 旋转角度z
     */
    rotationZ: number;

    /**
     * 中心点x
     */
    pivotX: number;

    /**
     * 中心点y
     */
    pivotY: number;

    /**
     * 中心点z
     */
    pivotZ: number;

    /**
     * 四元数角度
     */
    quaternion: Quaternion;

    /**
     * 获取元素的包围盒信息
     * @param parent 元素相对于哪个祖先元素的包围盒，不传表示世界
     * @param currentMatrix 当前计算的矩阵
     * @param bounds 当前计算的包围盒信息
     */
    getBounds(parent?: Node, currentMatrix?: Matrix4, bounds?: Bounds): Bounds;

  }

  class ITransformAttributes {
    /**
     * 元素的矩阵
     */
    matrix?: Matrix4;

    /**
     * x轴坐标
     */
    x?: number;

    /**
     * y轴坐标
     */
    y?: number;

    /**
     * z轴坐标
     */
    z?: number;

    /**
     * 位置
     */
    position?: Vector3;

    /**
     * 缩放比例x
     */
    scaleX?: number;

    /**
     * 缩放比例y
     */
    scaleY?: number;

    /**
     * 缩放比例z
     */
    scaleZ?: number;

    /**
     * 缩放比例
     */
    scale?: Vector3;

    /**
     * 旋转角度x
     */
    rotationX?: number;

    /**
     * 旋转角度y
     */
    rotationY?: number;

    /**
     * 旋转角度z
     */
    rotationZ?: number;

    /**
     * 旋转角度
     */
    rotation?: Vector3;

    /**
     * 中心点x
     */
    pivotX?: number;

    /**
     * 中心点y
     */
    pivotY?: number;

    /**
     * 中心点z
     */
    pivotZ?: number;

    /**
     * 中心点
     */
    pivot?: Vector3;

    /**
     * 四元数
     */
    quaternion?: Quaternion;
  }

  interface IOrthographicCameraParams extends ITransformAttributes {
    left?: number;
    right?: number;
    bottom?: number;
    top?: number;
    near?: number;
    far?: number;
  }
  class OrthographicCamera extends IOrthographicCameraParams {
    /**
     * 正交投影摄像机
     */

    /**
     * 
     * @param params 创建对象的属性参数。可包含此类的所有属性。
     */
    constructor(params: IOrthographicCameraParams);

    isOrthographicCamera: boolean;

    className: string;

    left: number;

    right: number;

    bottom: number;

    top: number;

    near: number;

    far: number;

    /**
     * 更新投影矩阵
     */
    updateProjectionMatrix(): void;

    isCamera: boolean;

    /**
     * 相对于摄像头的矩阵
     */
    viewMatrix: Matrix4;

    /**
     * 投影矩阵
     */
    projectionMatrix: Matrix4;

    /**
     * View 联结投影矩阵
     */
    viewProjectionMatrix: Matrix4;

    /**
     * 更新viewMatrix
     */
    updateViewMatrix(): Camera;

    /**
     * 获取几何体，子类必须重写
     * @param forceUpdate 是否强制更新
     */
    getGeometry(forceUpdate: boolean): Geometry;

    /**
     * 更新viewProjectionMatrix
     */
    updateViewProjectionMatrix(): Camera;

    /**
     * 获取元素相对于当前Camera的矩阵
     * @param node 目标元素
     * @param out 传递将在这个矩阵上做计算，不传将创建一个新的 Matrix4
     */
    getModelViewMatrix(node: Node, out?: Matrix4): Matrix4;

    /**
     * 获取元素的投影矩阵
     * @param node 目标元素
     * @param out 传递将在这个矩阵上做计算，不传将创建一个新的 Matrix4
     */
    getModelProjectionMatrix(node: Node, out?: Matrix4): Matrix4;

    /**
     * 获取世界坐标系(三维)中一个点在画布(二维)上的位置
     * @param vector 点坐标
     * @param width 画布宽，不传的话返回0~1
     * @param height 画布高，不传的话返回0~1
     */
    projectVector(vector: Vector3, width?: number, height?: number): Vector3;

    /**
     * 屏幕坐标转换世界坐标系
     * @param vector 点坐标
     * @param width 画布宽，传的话vector会认为是屏幕坐标
     * @param height 画布高，传的话vector会认为是屏幕坐标
     */
    unprojectVector(vector: Vector3, width?: number, height?: number): Vector3;

    /**
     * point是否摄像机可见
     * @param point
     */
    isPointVisible(point: Vector3): boolean;

    /**
     * mesh 是否摄像机可见
     * @param mesh
     */
    isMeshVisible(mesh: Mesh): boolean;

    /**
     * 更新 frustum
     * @param matrix
     */
    updateFrustum(matrix: Matrix4): Camera;

    isNode: boolean;

    /**
     * Node 的名字，可以通过 getChildByName 查找
     */
    name: string;

    /**
     * animation 查找 id
     */
    animationId: number;

    /**
     * 是否自动更新世界矩阵
     */
    autoUpdateWorldMatrix: boolean;

    /**
     * 父节点
     */
    parent: Node;

    /**
     * 每次更新的时候是否调用子节点的 onUpdate 方法
     */
    needCallChildUpdate: boolean;

    /**
     * 节点是否显示
     */
    visible: boolean;

    /**
     * 可视对象是否接受交互事件。默认为接受交互事件，即true。
     */
    pointerEnabled: boolean;

    /**
     * 子元素是否接受交互事件。
     */
    pointerChildren: boolean;

    /**
     * 是否用鼠标指针
     */
    useHandCursor: boolean;

    id: string;

    /**
     * 元素的up向量
     */
    up: Vector3;

    /**
     * 元素直接点数组
     */
    children: Node[];

    /**
     * 元素的世界矩阵
     */
    worldMatrix: Matrix4;

    /**
     * 
     * @param isChild 是否子节点，子节点不会处理动画及骨骼Mesh，即如果有动画将共享
     */
    clone(isChild?: boolean): Node;

    /**
     * 设置节点的动画，这个需要是模型的根节点
     * @param anim 动画实例
     */
    setAnim(anim: Animation): Node;

    /**
     * 重置子孙元素中 SkinedMesh 的根节点为当前元素
     */
    resetSkinedMeshRootNode(): void;

    /**
     * 将所以子孙元素放到一个对象中，对象key为元素的name，value为该元素
     */
    getChildrenNameMap(): Object;

    /**
     * 添加一个子元素
     * @param child 需要添加的子元素
     */
    addChild(child: Node): Node;

    /**
     * 移除指定的子元素
     * @param child 需要移除的元素
     */
    removeChild(child: Node): Node;

    /**
     * 将当前元素添加到某个父元素的子元素中
     * @param parent 需要添加到的父元素
     */
    addTo(parent: Node | Stage): Node;

    /**
     * 将当前元素从其父元素中移除
     */
    removeFromParent(): Node;

    /**
     * 更新本地矩阵
     */
    updateMatrix(): Node;

    /**
     * 更新transform属性
     */
    updateTransform(): Node;

    /**
     * 更新世界矩阵
     * @param force 是否强制更新
     */
    updateMatrixWorld(force?: boolean): Node;

    /**
     * 获取当前元素相对于指定元素的矩阵
     * @param ancestor 相对于的元素，需要是当前元素的祖先元素，不传表示获取世界矩阵
     */
    getConcatenatedMatrix(ancestor?: Node): Matrix4;

    /**
     * 遍历当前元素的子孙元素
     * @param callback 每个元素都会调用这个函数处理
     * @param onlyChild 是否只遍历子元素
     */
    traverse(callback: Function, onlyChild?: boolean): Node;

    /**
     * 遍历调用子孙元素onUpdate方法
     * @param dt
     */
    traverseUpdate(dt: number): Node;

    /**
     * 根据函数来获取一个子孙元素
     * @param fn 判读函数
     */
    getChildByFn(fn: Function): Node | null;

    /**
     * 根据函数来获取匹配的所有子孙元素
     * @param fn 判读函数
     */
    getChildrenByFn(fn: Function): Node[];

    /**
     * 获取指定name的首个子孙元素
     * @param name 元素name
     */
    getChildByName(name: string): Node | null;

    /**
     * 获取指定name的所有子孙元素
     * @param name 元素name
     */
    getChildrenByName(name: string): Node[];

    /**
     * 获取指定id的子孙元素
     * @param id 元素id
     */
    getChildById(id: string): Node | null;

    /**
     * 获取指定类名的所有子孙元素
     * @param className 类名
     */
    getChildrenByClassName(className: string): Node[];

    /**
     * 设置元素的缩放比例
     * @param x X缩放比例
     * @param y Y缩放比例
     * @param z Z缩放比例
     */
    setScale(x: number, y: number, z: number): Node;

    /**
     * 设置元素的位置
     * @param x X方向位置
     * @param y Y方向位置
     * @param z Z方向位置
     */
    setPosition(x: number, y: number, z: number): Node;

    /**
     * 设置元素的旋转
     * @param x X轴旋转角度
     * @param y Y轴旋转角度
     * @param z Z轴旋转角度
     */
    setRotation(x: number, y: number, z: number): Node;

    /**
     * 设置中心点
     * @param x 中心点x
     * @param y 中心点y
     * @param z 中心点z
     */
    setPivot(x: number, y: number, z: number): Node;

    /**
     * 改变元素的朝向
     * @param node 需要朝向的元素，或者坐标
     */
    lookAt(node: Node | Object | Vector3): Node;
    onUpdate(escapeTime: number): any;

    /**
     * raycast
     * @param ray
     * @param sort 是否按距离排序
     * @param eventMode 是否事件模式
     */
    raycast(ray: Ray, sort?: boolean, eventMode?: boolean): raycastInfo[] | null;

    /**
     * 元素的矩阵
     */
    matrix: Matrix4;

    /**
     * x轴坐标
     */
    x: number;

    /**
     * y轴坐标
     */
    y: number;

    /**
     * z轴坐标
     */
    z: number;

    /**
     * 缩放比例x
     */
    scaleX: number;

    /**
     * 缩放比例y
     */
    scaleY: number;

    /**
     * 缩放比例z
     */
    scaleZ: number;

    /**
     * 旋转角度x
     */
    rotationX: number;

    /**
     * 旋转角度y
     */
    rotationY: number;

    /**
     * 旋转角度z
     */
    rotationZ: number;

    /**
     * 中心点x
     */
    pivotX: number;

    /**
     * 中心点y
     */
    pivotY: number;

    /**
     * 中心点z
     */
    pivotZ: number;

    /**
     * 四元数角度
     */
    quaternion: Quaternion;

    /**
     * 获取元素的包围盒信息
     * @param parent 元素相对于哪个祖先元素的包围盒，不传表示世界
     * @param currentMatrix 当前计算的矩阵
     * @param bounds 当前计算的包围盒信息
     */
    getBounds(parent?: Node, currentMatrix?: Matrix4, bounds?: Bounds): Bounds;

  }

  interface IPerspectiveCameraParams extends ITransformAttributes {
    /**
     * 相机视锥体近平面z
     */
    near?: number;

    /**
     * 相机视锥体远平面z，null 时为无限远
     */
    far?: number;

    /**
     * 相机视野大小，角度
     */
    fov?: number;

    /**
     * 宽高比
     */
    aspect?: number;
  }
  class PerspectiveCamera extends IPerspectiveCameraParams {
    /**
     * 透视投影摄像机
     */
    constructor();

    /**
     * 
     * @param params 创建对象的属性参数。可包含此类的所有属性。
     */
    constructor(params: IPerspectiveCameraParams);

    isPerspectiveCamera: boolean;

    className: string;

    /**
     * 相机视锥体近平面z
     */
    near: number;

    /**
     * 相机视锥体远平面z，null 时为无限远
     */
    far: number;

    /**
     * 相机视野大小，角度
     */
    fov: number;

    /**
     * 宽高比
     */
    aspect: number;

    /**
     * 更新投影矩阵
     */
    updateProjectionMatrix(): void;

    isCamera: boolean;

    /**
     * 相对于摄像头的矩阵
     */
    viewMatrix: Matrix4;

    /**
     * 投影矩阵
     */
    projectionMatrix: Matrix4;

    /**
     * View 联结投影矩阵
     */
    viewProjectionMatrix: Matrix4;

    /**
     * 更新viewMatrix
     */
    updateViewMatrix(): Camera;

    /**
     * 获取几何体，子类必须重写
     * @param forceUpdate 是否强制更新
     */
    getGeometry(forceUpdate: boolean): Geometry;

    /**
     * 更新viewProjectionMatrix
     */
    updateViewProjectionMatrix(): Camera;

    /**
     * 获取元素相对于当前Camera的矩阵
     * @param node 目标元素
     * @param out 传递将在这个矩阵上做计算，不传将创建一个新的 Matrix4
     */
    getModelViewMatrix(node: Node, out?: Matrix4): Matrix4;

    /**
     * 获取元素的投影矩阵
     * @param node 目标元素
     * @param out 传递将在这个矩阵上做计算，不传将创建一个新的 Matrix4
     */
    getModelProjectionMatrix(node: Node, out?: Matrix4): Matrix4;

    /**
     * 获取世界坐标系(三维)中一个点在画布(二维)上的位置
     * @param vector 点坐标
     * @param width 画布宽，不传的话返回0~1
     * @param height 画布高，不传的话返回0~1
     */
    projectVector(vector: Vector3, width?: number, height?: number): Vector3;

    /**
     * 屏幕坐标转换世界坐标系
     * @param vector 点坐标
     * @param width 画布宽，传的话vector会认为是屏幕坐标
     * @param height 画布高，传的话vector会认为是屏幕坐标
     */
    unprojectVector(vector: Vector3, width?: number, height?: number): Vector3;

    /**
     * point是否摄像机可见
     * @param point
     */
    isPointVisible(point: Vector3): boolean;

    /**
     * mesh 是否摄像机可见
     * @param mesh
     */
    isMeshVisible(mesh: Mesh): boolean;

    /**
     * 更新 frustum
     * @param matrix
     */
    updateFrustum(matrix: Matrix4): Camera;

    isNode: boolean;

    /**
     * Node 的名字，可以通过 getChildByName 查找
     */
    name: string;

    /**
     * animation 查找 id
     */
    animationId: number;

    /**
     * 是否自动更新世界矩阵
     */
    autoUpdateWorldMatrix: boolean;

    /**
     * 父节点
     */
    parent: Node;

    /**
     * 每次更新的时候是否调用子节点的 onUpdate 方法
     */
    needCallChildUpdate: boolean;

    /**
     * 节点是否显示
     */
    visible: boolean;

    /**
     * 可视对象是否接受交互事件。默认为接受交互事件，即true。
     */
    pointerEnabled: boolean;

    /**
     * 子元素是否接受交互事件。
     */
    pointerChildren: boolean;

    /**
     * 是否用鼠标指针
     */
    useHandCursor: boolean;

    id: string;

    /**
     * 元素的up向量
     */
    up: Vector3;

    /**
     * 元素直接点数组
     */
    children: Node[];

    /**
     * 元素的世界矩阵
     */
    worldMatrix: Matrix4;

    /**
     * 
     * @param isChild 是否子节点，子节点不会处理动画及骨骼Mesh，即如果有动画将共享
     */
    clone(isChild?: boolean): Node;

    /**
     * 设置节点的动画，这个需要是模型的根节点
     * @param anim 动画实例
     */
    setAnim(anim: Animation): Node;

    /**
     * 重置子孙元素中 SkinedMesh 的根节点为当前元素
     */
    resetSkinedMeshRootNode(): void;

    /**
     * 将所以子孙元素放到一个对象中，对象key为元素的name，value为该元素
     */
    getChildrenNameMap(): Object;

    /**
     * 添加一个子元素
     * @param child 需要添加的子元素
     */
    addChild(child: Node): Node;

    /**
     * 移除指定的子元素
     * @param child 需要移除的元素
     */
    removeChild(child: Node): Node;

    /**
     * 将当前元素添加到某个父元素的子元素中
     * @param parent 需要添加到的父元素
     */
    addTo(parent: Node | Stage): Node;

    /**
     * 将当前元素从其父元素中移除
     */
    removeFromParent(): Node;

    /**
     * 更新本地矩阵
     */
    updateMatrix(): Node;

    /**
     * 更新transform属性
     */
    updateTransform(): Node;

    /**
     * 更新世界矩阵
     * @param force 是否强制更新
     */
    updateMatrixWorld(force?: boolean): Node;

    /**
     * 获取当前元素相对于指定元素的矩阵
     * @param ancestor 相对于的元素，需要是当前元素的祖先元素，不传表示获取世界矩阵
     */
    getConcatenatedMatrix(ancestor?: Node): Matrix4;

    /**
     * 遍历当前元素的子孙元素
     * @param callback 每个元素都会调用这个函数处理
     * @param onlyChild 是否只遍历子元素
     */
    traverse(callback: Function, onlyChild?: boolean): Node;

    /**
     * 遍历调用子孙元素onUpdate方法
     * @param dt
     */
    traverseUpdate(dt: number): Node;

    /**
     * 根据函数来获取一个子孙元素
     * @param fn 判读函数
     */
    getChildByFn(fn: Function): Node | null;

    /**
     * 根据函数来获取匹配的所有子孙元素
     * @param fn 判读函数
     */
    getChildrenByFn(fn: Function): Node[];

    /**
     * 获取指定name的首个子孙元素
     * @param name 元素name
     */
    getChildByName(name: string): Node | null;

    /**
     * 获取指定name的所有子孙元素
     * @param name 元素name
     */
    getChildrenByName(name: string): Node[];

    /**
     * 获取指定id的子孙元素
     * @param id 元素id
     */
    getChildById(id: string): Node | null;

    /**
     * 获取指定类名的所有子孙元素
     * @param className 类名
     */
    getChildrenByClassName(className: string): Node[];

    /**
     * 设置元素的缩放比例
     * @param x X缩放比例
     * @param y Y缩放比例
     * @param z Z缩放比例
     */
    setScale(x: number, y: number, z: number): Node;

    /**
     * 设置元素的位置
     * @param x X方向位置
     * @param y Y方向位置
     * @param z Z方向位置
     */
    setPosition(x: number, y: number, z: number): Node;

    /**
     * 设置元素的旋转
     * @param x X轴旋转角度
     * @param y Y轴旋转角度
     * @param z Z轴旋转角度
     */
    setRotation(x: number, y: number, z: number): Node;

    /**
     * 设置中心点
     * @param x 中心点x
     * @param y 中心点y
     * @param z 中心点z
     */
    setPivot(x: number, y: number, z: number): Node;

    /**
     * 改变元素的朝向
     * @param node 需要朝向的元素，或者坐标
     */
    lookAt(node: Node | Object | Vector3): Node;
    onUpdate(escapeTime: number): any;

    /**
     * raycast
     * @param ray
     * @param sort 是否按距离排序
     * @param eventMode 是否事件模式
     */
    raycast(ray: Ray, sort?: boolean, eventMode?: boolean): raycastInfo[] | null;

    /**
     * 元素的矩阵
     */
    matrix: Matrix4;

    /**
     * x轴坐标
     */
    x: number;

    /**
     * y轴坐标
     */
    y: number;

    /**
     * z轴坐标
     */
    z: number;

    /**
     * 缩放比例x
     */
    scaleX: number;

    /**
     * 缩放比例y
     */
    scaleY: number;

    /**
     * 缩放比例z
     */
    scaleZ: number;

    /**
     * 旋转角度x
     */
    rotationX: number;

    /**
     * 旋转角度y
     */
    rotationY: number;

    /**
     * 旋转角度z
     */
    rotationZ: number;

    /**
     * 中心点x
     */
    pivotX: number;

    /**
     * 中心点y
     */
    pivotY: number;

    /**
     * 中心点z
     */
    pivotZ: number;

    /**
     * 四元数角度
     */
    quaternion: Quaternion;

    /**
     * 获取元素的包围盒信息
     * @param parent 元素相对于哪个祖先元素的包围盒，不传表示世界
     * @param currentMatrix 当前计算的矩阵
     * @param bounds 当前计算的包围盒信息
     */
    getBounds(parent?: Node, currentMatrix?: Matrix4, bounds?: Bounds): Bounds;

  }

  type GLenum = number;

  /**
   * Hilo3d 枚举值，可通过 import { xxx } from 'constants/index' 或者 Hilo3d.xxx 获取
   */
  interface Constants {
    POSITION: 'POSITION';
    NORMAL: 'NORMAL';
    DEPTH: 'DEPTH';
    DISTANCE: 'DISTANCE';

    ACTIVE_ATTRIBUTES: 35721,
    ACTIVE_ATTRIBUTE_MAX_LENGTH: 35722,
    ACTIVE_TEXTURE: 34016,
    ACTIVE_UNIFORMS: 35718,
    ACTIVE_UNIFORM_MAX_LENGTH: 35719,
    ALIASED_LINE_WIDTH_RANGE: 33902,
    ALIASED_POINT_SIZE_RANGE: 33901,
    ALPHA: 6406,
    ALPHA_BITS: 3413,
    ALWAYS: 519,
    ARRAY_BUFFER: 34962,
    ARRAY_BUFFER_BINDING: 34964,
    ATTACHED_SHADERS: 35717,
    BACK: 1029,
    BLEND: 3042,
    BLEND_COLOR: 32773,
    BLEND_DST_ALPHA: 32970,
    BLEND_DST_RGB: 32968,
    BLEND_EQUATION: 32777,
    BLEND_EQUATION_ALPHA: 34877,
    BLEND_EQUATION_RGB: 32777,
    BLEND_SRC_ALPHA: 32971,
    BLEND_SRC_RGB: 32969,
    BLUE_BITS: 3412,
    BOOL: 35670,
    BOOL_VEC2: 35671,
    BOOL_VEC3: 35672,
    BOOL_VEC4: 35673,
    BROWSER_DEFAULT_WEBGL: 37444,
    BUFFER_SIZE: 34660,
    BUFFER_USAGE: 34661,
    BYTE: 5120,
    CCW: 2305,
    CLAMP_TO_EDGE: 33071,
    COLOR_ATTACHMENT0: 36064,
    COLOR_BUFFER_BIT: 16384,
    COLOR_CLEAR_VALUE: 3106,
    COLOR_WRITEMASK: 3107,
    COMPILE_STATUS: 35713,
    COMPRESSED_TEXTURE_FORMATS: 34467,
    CONSTANT_ALPHA: 32771,
    CONSTANT_COLOR: 32769,
    CONTEXT_LOST_WEBGL: 37442,
    CULL_FACE: 2884,
    CULL_FACE_MODE: 2885,
    CURRENT_PROGRAM: 35725,
    CURRENT_VERTEX_ATTRIB: 34342,
    CW: 2304,
    DECR: 7683,
    DECR_WRAP: 34056,
    DELETE_STATUS: 35712,
    DEPTH_ATTACHMENT: 36096,
    DEPTH_BITS: 3414,
    DEPTH_BUFFER_BIT: 256,
    DEPTH_CLEAR_VALUE: 2931,
    DEPTH_COMPONENT: 6402,
    DEPTH_COMPONENT16: 33189,
    DEPTH_FUNC: 2932,
    DEPTH_RANGE: 2928,
    DEPTH_STENCIL: 34041,
    DEPTH_STENCIL_ATTACHMENT: 33306,
    DEPTH_TEST: 2929,
    DEPTH_WRITEMASK: 2930,
    DITHER: 3024,
    DONT_CARE: 4352,
    DST_ALPHA: 772,
    DST_COLOR: 774,
    DYNAMIC_DRAW: 35048,
    ELEMENT_ARRAY_BUFFER: 34963,
    ELEMENT_ARRAY_BUFFER_BINDING: 34965,
    EQUAL: 514,
    FASTEST: 4353,
    FLOAT: 5126,
    FLOAT_MAT2: 35674,
    FLOAT_MAT3: 35675,
    FLOAT_MAT4: 35676,
    FLOAT_VEC2: 35664,
    FLOAT_VEC3: 35665,
    FLOAT_VEC4: 35666,
    FRAGMENT_SHADER: 35632,
    FRAMEBUFFER: 36160,
    FRAMEBUFFER_ATTACHMENT_OBJECT_NAME: 36049,
    FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE: 36048,
    FRAMEBUFFER_ATTACHMENT_TEXTURE_CUBE_MAP_FACE: 36051,
    FRAMEBUFFER_ATTACHMENT_TEXTURE_LEVEL: 36050,
    FRAMEBUFFER_BINDING: 36006,
    FRAMEBUFFER_COMPLETE: 36053,
    FRAMEBUFFER_INCOMPLETE_ATTACHMENT: 36054,
    FRAMEBUFFER_INCOMPLETE_DIMENSIONS: 36057,
    FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT: 36055,
    FRAMEBUFFER_UNSUPPORTED: 36061,
    FRONT: 1028,
    FRONT_AND_BACK: 1032,
    FRONT_FACE: 2886,
    FUNC_ADD: 32774,
    FUNC_REVERSE_SUBTRACT: 32779,
    FUNC_SUBTRACT: 32778,
    GENERATE_MIPMAP_HINT: 33170,
    GEQUAL: 518,
    GREATER: 516,
    GREEN_BITS: 3411,
    HIGH_FLOAT: 36338,
    HIGH_INT: 36341,
    INCR: 7682,
    INCR_WRAP: 34055,
    INFO_LOG_LENGTH: 35716,
    INT: 5124,
    INT_VEC2: 35667,
    INT_VEC3: 35668,
    INT_VEC4: 35669,
    INVALID_ENUM: 1280,
    INVALID_FRAMEBUFFER_OPERATION: 1286,
    INVALID_OPERATION: 1282,
    INVALID_VALUE: 1281,
    INVERT: 5386,
    KEEP: 7680,
    LEQUAL: 515,
    LESS: 513,
    LINEAR: 9729,
    LINEAR_MIPMAP_LINEAR: 9987,
    LINEAR_MIPMAP_NEAREST: 9985,
    LINES: 1,
    LINE_LOOP: 2,
    LINE_STRIP: 3,
    LINE_WIDTH: 2849,
    LINK_STATUS: 35714,
    LOW_FLOAT: 36336,
    LOW_INT: 36339,
    LUMINANCE: 6409,
    LUMINANCE_ALPHA: 6410,
    MAX_COMBINED_TEXTURE_IMAGE_UNITS: 35661,
    MAX_CUBE_MAP_TEXTURE_SIZE: 34076,
    MAX_FRAGMENT_UNIFORM_VECTORS: 36349,
    MAX_RENDERBUFFER_SIZE: 34024,
    MAX_TEXTURE_IMAGE_UNITS: 34930,
    MAX_TEXTURE_SIZE: 3379,
    MAX_VARYING_VECTORS: 36348,
    MAX_VERTEX_ATTRIBS: 34921,
    MAX_VERTEX_TEXTURE_IMAGE_UNITS: 35660,
    MAX_VERTEX_UNIFORM_VECTORS: 36347,
    MAX_VIEWPORT_DIMS: 3386,
    MEDIUM_FLOAT: 36337,
    MEDIUM_INT: 36340,
    MIRRORED_REPEAT: 33648,
    NEAREST: 9728,
    NEAREST_MIPMAP_LINEAR: 9986,
    NEAREST_MIPMAP_NEAREST: 9984,
    NEVER: 512,
    NICEST: 4354,
    NONE: 0,
    NOTEQUAL: 517,
    NO_ERROR: 0,
    NUM_COMPRESSED_TEXTURE_FORMATS: 34466,
    ONE: 1,
    ONE_MINUS_CONSTANT_ALPHA: 32772,
    ONE_MINUS_CONSTANT_COLOR: 32770,
    ONE_MINUS_DST_ALPHA: 773,
    ONE_MINUS_DST_COLOR: 775,
    ONE_MINUS_SRC_ALPHA: 771,
    ONE_MINUS_SRC_COLOR: 769,
    OUT_OF_MEMORY: 1285,
    PACK_ALIGNMENT: 3333,
    POINTS: 0,
    POLYGON_OFFSET_FACTOR: 32824,
    POLYGON_OFFSET_FILL: 32823,
    POLYGON_OFFSET_UNITS: 10752,
    RED_BITS: 3410,
    RENDERBUFFER: 36161,
    RENDERBUFFER_ALPHA_SIZE: 36179,
    RENDERBUFFER_BINDING: 36007,
    RENDERBUFFER_BLUE_SIZE: 36178,
    RENDERBUFFER_DEPTH_SIZE: 36180,
    RENDERBUFFER_GREEN_SIZE: 36177,
    RENDERBUFFER_HEIGHT: 36163,
    RENDERBUFFER_INTERNAL_FORMAT: 36164,
    RENDERBUFFER_RED_SIZE: 36176,
    RENDERBUFFER_STENCIL_SIZE: 36181,
    RENDERBUFFER_WIDTH: 36162,
    RENDERER: 7937,
    REPEAT: 10497,
    REPLACE: 7681,
    RGB: 6407,
    RGB5_A1: 32855,
    RGB565: 36194,
    RGBA: 6408,
    RGBA4: 32854,
    SAMPLER_2D: 35678,
    SAMPLER_CUBE: 35680,
    SAMPLES: 32937,
    SAMPLE_ALPHA_TO_COVERAGE: 32926,
    SAMPLE_BUFFERS: 32936,
    SAMPLE_COVERAGE: 32928,
    SAMPLE_COVERAGE_INVERT: 32939,
    SAMPLE_COVERAGE_VALUE: 32938,
    SCISSOR_BOX: 3088,
    SCISSOR_TEST: 3089,
    SHADER_COMPILER: 36346,
    SHADER_SOURCE_LENGTH: 35720,
    SHADER_TYPE: 35663,
    SHADING_LANGUAGE_VERSION: 35724,
    SHORT: 5122,
    SRC_ALPHA: 770,
    SRC_ALPHA_SATURATE: 776,
    SRC_COLOR: 768,
    STATIC_DRAW: 35044,
    STENCIL_ATTACHMENT: 36128,
    STENCIL_BACK_FAIL: 34817,
    STENCIL_BACK_FUNC: 34816,
    STENCIL_BACK_PASS_DEPTH_FAIL: 34818,
    STENCIL_BACK_PASS_DEPTH_PASS: 34819,
    STENCIL_BACK_REF: 36003,
    STENCIL_BACK_VALUE_MASK: 36004,
    STENCIL_BACK_WRITEMASK: 36005,
    STENCIL_BITS: 3415,
    STENCIL_BUFFER_BIT: 1024,
    STENCIL_CLEAR_VALUE: 2961,
    STENCIL_FAIL: 2964,
    STENCIL_FUNC: 2962,
    STENCIL_INDEX: 6401,
    STENCIL_INDEX8: 36168,
    STENCIL_PASS_DEPTH_FAIL: 2965,
    STENCIL_PASS_DEPTH_PASS: 2966,
    STENCIL_REF: 2967,
    STENCIL_TEST: 2960,
    STENCIL_VALUE_MASK: 2963,
    STENCIL_WRITEMASK: 2968,
    STREAM_DRAW: 35040,
    SUBPIXEL_BITS: 3408,
    TEXTURE: 5890,
    TEXTURE0: 33984,
    TEXTURE1: 33985,
    TEXTURE2: 33986,
    TEXTURE3: 33987,
    TEXTURE4: 33988,
    TEXTURE5: 33989,
    TEXTURE6: 33990,
    TEXTURE7: 33991,
    TEXTURE8: 33992,
    TEXTURE9: 33993,
    TEXTURE10: 33994,
    TEXTURE11: 33995,
    TEXTURE12: 33996,
    TEXTURE13: 33997,
    TEXTURE14: 33998,
    TEXTURE15: 33999,
    TEXTURE16: 34000,
    TEXTURE17: 34001,
    TEXTURE18: 34002,
    TEXTURE19: 34003,
    TEXTURE20: 34004,
    TEXTURE21: 34005,
    TEXTURE22: 34006,
    TEXTURE23: 34007,
    TEXTURE24: 34008,
    TEXTURE25: 34009,
    TEXTURE26: 34010,
    TEXTURE27: 34011,
    TEXTURE28: 34012,
    TEXTURE29: 34013,
    TEXTURE30: 34014,
    TEXTURE31: 34015,
    TEXTURE_2D: 3553,
    TEXTURE_BINDING_2D: 32873,
    TEXTURE_BINDING_CUBE_MAP: 34068,
    TEXTURE_CUBE_MAP: 34067,
    TEXTURE_CUBE_MAP_NEGATIVE_X: 34070,
    TEXTURE_CUBE_MAP_NEGATIVE_Y: 34072,
    TEXTURE_CUBE_MAP_NEGATIVE_Z: 34074,
    TEXTURE_CUBE_MAP_POSITIVE_X: 34069,
    TEXTURE_CUBE_MAP_POSITIVE_Y: 34071,
    TEXTURE_CUBE_MAP_POSITIVE_Z: 34073,
    TEXTURE_MAG_FILTER: 10240,
    TEXTURE_MIN_FILTER: 10241,
    TEXTURE_WRAP_S: 10242,
    TEXTURE_WRAP_T: 10243,
    TRIANGLES: 4,
    TRIANGLE_FAN: 6,
    TRIANGLE_STRIP: 5,
    UNPACK_ALIGNMENT: 3317,
    UNPACK_COLORSPACE_CONVERSION_WEBGL: 37443,
    UNPACK_FLIP_Y_WEBGL: 37440,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 37441,
    UNSIGNED_BYTE: 5121,
    UNSIGNED_INT: 5125,
    UNSIGNED_SHORT: 5123,
    UNSIGNED_SHORT_4_4_4_4: 32819,
    UNSIGNED_SHORT_5_5_5_1: 32820,
    UNSIGNED_SHORT_5_6_5: 33635,
    VALIDATE_STATUS: 35715,
    VENDOR: 7936,
    VERSION: 7938,
    VERTEX_ATTRIB_ARRAY_BUFFER_BINDING: 34975,
    VERTEX_ATTRIB_ARRAY_ENABLED: 34338,
    VERTEX_ATTRIB_ARRAY_NORMALIZED: 34922,
    VERTEX_ATTRIB_ARRAY_POINTER: 34373,
    VERTEX_ATTRIB_ARRAY_SIZE: 34339,
    VERTEX_ATTRIB_ARRAY_STRIDE: 34340,
    VERTEX_ATTRIB_ARRAY_TYPE: 34341,
    VERTEX_SHADER: 35633,
    VIEWPORT: 2978,
    ZERO: 0,
    VERTEX_ATTRIB_ARRAY_DIVISOR_ANGLE: 0x88FE, //  Describes the frequency divisor used for instanced rendering.
    UNMASKED_VENDOR_WEBGL: 0x9245, //  Passed to getParameter to get the vendor string of the graphics driver.
    UNMASKED_RENDERER_WEBGL: 0x9246, //  Passed to getParameter to get the renderer string of the graphics driver.
    MAX_TEXTURE_MAX_ANISOTROPY_EXT: 0x84FF, //  Returns the maximum available anisotropy.
    TEXTURE_MAX_ANISOTROPY_EXT: 0x84FE, //  Passed to texParameter to set the desired maximum anisotropy for a texture.
    COMPRESSED_RGB_S3TC_DXT1_EXT: 0x83F0, //  A DXT1-compressed image in an RGB image format.
    COMPRESSED_RGBA_S3TC_DXT1_EXT: 0x83F1, //  A DXT1-compressed image in an RGB image format with a simple on/off alpha value.
    COMPRESSED_RGBA_S3TC_DXT3_EXT: 0x83F2, //  A DXT3-compressed image in an RGBA image format. Compared to a 32-bit RGBA texture, it offers 4:1 compression.
    COMPRESSED_RGBA_S3TC_DXT5_EXT: 0x83F3, //  A DXT5-compressed image in an RGBA image format. It also provides a 4:1 compression, but differs to the DXT3 compression in how the alpha compression is done.
    COMPRESSED_R11_EAC: 0x9270, //  One-channel (red) unsigned format compression.
    COMPRESSED_SIGNED_R11_EAC: 0x9271, //  One-channel (red) signed format compression.
    COMPRESSED_RG11_EAC: 0x9272, //  Two-channel (red and green) unsigned format compression.
    COMPRESSED_SIGNED_RG11_EAC: 0x9273, //  Two-channel (red and green) signed format compression.
    COMPRESSED_RGB8_ETC2: 0x9274, //  Compresses RBG8 data with no alpha channel.
    COMPRESSED_RGBA8_ETC2_EAC: 0x9275, //  Compresses RGBA8 data. The RGB part is encoded the same as RGB_ETC2, but the alpha part is encoded separately.
    COMPRESSED_SRGB8_ETC2: 0x9276, //  Compresses sRBG8 data with no alpha channel.
    COMPRESSED_SRGB8_ALPHA8_ETC2_EAC: 0x9277, //  Compresses sRGBA8 data. The sRGB part is encoded the same as SRGB_ETC2, but the alpha part is encoded separately.
    COMPRESSED_RGB8_PUNCHTHROUGH_ALPHA1_ETC2: 0x9278, //  Similar to RGB8_ETC, but with ability to punch through the alpha channel, which means to make it completely opaque or transparent.
    COMPRESSED_SRGB8_PUNCHTHROUGH_ALPHA1_ETC2: 0x9279, //  Similar to SRGB8_ETC, but with ability to punch through the alpha channel, which means to make it completely opaque or transparent.
    COMPRESSED_RGB_PVRTC_4BPPV1_IMG: 0x8C00, //  RGB compression in 4-bit mode. One block for each 4×4 pixels.
    COMPRESSED_RGBA_PVRTC_4BPPV1_IMG: 0x8C02, //  RGBA compression in 4-bit mode. One block for each 4×4 pixels.
    COMPRESSED_RGB_PVRTC_2BPPV1_IMG: 0x8C01, //  RGB compression in 2-bit mode. One block for each 8×4 pixels.
    COMPRESSED_RGBA_PVRTC_2BPPV1_IMG: 0x8C03, //  RGBA compression in 2-bit mode. One block for each 8×4 pixe
    COMPRESSED_RGB_ETC1_WEBGL: 0x8D64, //  Compresses 24-bit RGB data with no alpha channel.
    COMPRESSED_RGB_ATC_WEBGL: 0x8C92, //  Compresses RGB textures with no alpha channel.
    COMPRESSED_RGBA_ATC_EXPLICIT_ALPHA_WEBGL: 0x8C92, //  Compresses RGBA textures using explicit alpha encoding (useful when alpha transitions are sharp).
    COMPRESSED_RGBA_ATC_INTERPOLATED_ALPHA_WEBGL: 0x87EE, //  Compresses RGBA textures using interpolated alpha encoding (useful when alpha transitions are gradient).
    UNSIGNED_INT_24_8_WEBGL: 0x84FA, //  Unsigned integer type for 24-bit depth texture data.
    HALF_FLOAT_OES: 0x8D61, //  Half floating-point type (16-bit).
    RGBA32F_EXT: 0x8814, //  RGBA 32-bit floating-point color-renderable format.
    RGB32F_EXT: 0x8815, //  RGB 32-bit floating-point color-renderable format.
    FRAMEBUFFER_ATTACHMENT_COMPONENT_TYPE_EXT: 0x8211, //   
    UNSIGNED_NORMALIZED_EXT: 0x8C17, //   
    MIN_EXT: 0x8007, //  Produces the minimum color components of the source and destination colors.
    MAX_EXT: 0x8008, //  Produces the maximum color components of the source and destination colors.
    SRGB_EXT: 0x8C40, //  Unsized sRGB format that leaves the precision up to the driver.
    SRGB_ALPHA_EXT: 0x8C42, //  Unsized sRGB format with unsized alpha component.
    SRGB8_ALPHA8_EXT: 0x8C43, //  Sized (8-bit) sRGB and alpha formats.
    FRAMEBUFFER_ATTACHMENT_COLOR_ENCODING_EXT: 0x8210, //  Returns the framebuffer color encoding.
    FRAGMENT_SHADER_DERIVATIVE_HINT_OES: 0x8B8B, //  Indicates the accuracy of the derivative calculation for the GLSL built-in functions: dFdx, dFdy, and fwidth.
    COLOR_ATTACHMENT0_WEBGL: 0x8CE0, //  Framebuffer color attachment point
    COLOR_ATTACHMENT1_WEBGL: 0x8CE1, //  Framebuffer color attachment point
    COLOR_ATTACHMENT2_WEBGL: 0x8CE2, //  Framebuffer color attachment point
    COLOR_ATTACHMENT3_WEBGL: 0x8CE3, //  Framebuffer color attachment point
    COLOR_ATTACHMENT4_WEBGL: 0x8CE4, //  Framebuffer color attachment point
    COLOR_ATTACHMENT5_WEBGL: 0x8CE5, //  Framebuffer color attachment point
    COLOR_ATTACHMENT6_WEBGL: 0x8CE6, //  Framebuffer color attachment point
    COLOR_ATTACHMENT7_WEBGL: 0x8CE7, //  Framebuffer color attachment point
    COLOR_ATTACHMENT8_WEBGL: 0x8CE8, //  Framebuffer color attachment point
    COLOR_ATTACHMENT9_WEBGL: 0x8CE9, //  Framebuffer color attachment point
    COLOR_ATTACHMENT10_WEBGL: 0x8CEA, //  Framebuffer color attachment point
    COLOR_ATTACHMENT11_WEBGL: 0x8CEB, //  Framebuffer color attachment point
    COLOR_ATTACHMENT12_WEBGL: 0x8CEC, //  Framebuffer color attachment point
    COLOR_ATTACHMENT13_WEBGL: 0x8CED, //  Framebuffer color attachment point
    COLOR_ATTACHMENT14_WEBGL: 0x8CEE, //  Framebuffer color attachment point
    COLOR_ATTACHMENT15_WEBGL: 0x8CEF, //  Framebuffer color attachment point
    DRAW_BUFFER0_WEBGL: 0x8825, //  Draw buffer
    DRAW_BUFFER1_WEBGL: 0x8826, //  Draw buffer
    DRAW_BUFFER2_WEBGL: 0x8827, //  Draw buffer
    DRAW_BUFFER3_WEBGL: 0x8828, //  Draw buffer
    DRAW_BUFFER4_WEBGL: 0x8829, //  Draw buffer
    DRAW_BUFFER5_WEBGL: 0x882A, //  Draw buffer
    DRAW_BUFFER6_WEBGL: 0x882B, //  Draw buffer
    DRAW_BUFFER7_WEBGL: 0x882C, //  Draw buffer
    DRAW_BUFFER8_WEBGL: 0x882D, //  Draw buffer
    DRAW_BUFFER9_WEBGL: 0x882E, //  Draw buffer
    DRAW_BUFFER10_WEBGL: 0x882F, //  Draw buffer
    DRAW_BUFFER11_WEBGL: 0x8830, //  Draw buffer
    DRAW_BUFFER12_WEBGL: 0x8831, //  Draw buffer
    DRAW_BUFFER13_WEBGL: 0x8832, //  Draw buffer
    DRAW_BUFFER14_WEBGL: 0x8833, //  Draw buffer
    DRAW_BUFFER15_WEBGL: 0x8834, //  Draw buffer
    MAX_COLOR_ATTACHMENTS_WEBGL: 0x8CDF, //  Maximum number of framebuffer color attachment points
    MAX_DRAW_BUFFERS_WEBGL: 0x8824, //  Maximum number of draw buffers
    VERTEX_ARRAY_BINDING_OES: 0x85B5, //  The bound vertex array object (VAO).
    QUERY_COUNTER_BITS_EXT: 0x8864, //  The number of bits used to hold the query result for the given target.
    CURRENT_QUERY_EXT: 0x8865, //  The currently active query.
    QUERY_RESULT_EXT: 0x8866, //  The query result.
    QUERY_RESULT_AVAILABLE_EXT: 0x8867, //  A Boolean indicating whether or not a query result is available.
    TIME_ELAPSED_EXT: 0x88BF, //  Elapsed time (in nanoseconds).
    TIMESTAMP_EXT: 0x8E28, //  The current time.
    GPU_DISJOINT_EXT: 0x8FBB; //  A Boolean indicating whether or not the GPU performed any disjoint operation.
  }

  const constants: Constants;

  /**
   * Class是提供类的创建的辅助工具。
   * @see
   */
  namespace Class {
  }

  class IFog {
    /**
     * 雾模式, 可选 LINEAR, EXP, EXP2
     */
    mode?: string;

    /**
     * 雾影响起始值, 只在 mode 为 LINEAR 时生效
     */
    start?: number;

    /**
     * 雾影响终点值, 只在 mode 为 LINEAR 时生效
     */
    end?: number;

    /**
     * 雾密度, 只在 mode 为 EXP, EXP2 时生效
     */
    density?: number;

    /**
     * id
     */
    id?: string;

    /**
     * 雾颜色
     */
    color?: Color;
  }

  class Fog extends IFog {
    /**
     * 雾
     */
    constructor();

    /**
     * 
     * @param params 创建对象的属性参数。可包含此类的所有属性。
     */
    constructor(params: IFog);

    isFog: boolean;

    className: string;

    /**
     * 获取雾信息
     */
    getInfo(): any;

  }

  interface IMeshParams extends ITransformAttributes {
    name?: string;
    geometry: Geometry;
    material: Material;
    /**
     * 是否支持 Instanced
     */
    useInstanced?: boolean;

    /**
     * 是否开启视锥体裁剪
     */
    frustumTest?: boolean;

    visible?: boolean;
  }
  class Mesh extends ITransformAttributes {
    /**
     * Mesh
     */
    constructor();

    /**
     * 
     * @param params 初始化参数，所有params都会复制到实例上
     */
    constructor(params: IMeshParams);

    isMesh: boolean;

    className: string;

    geometry: Geometry;

    material: Material;

    /**
     * 是否支持 Instanced
     */
    useInstanced: boolean;

    /**
     * 是否开启视锥体裁剪
     */
    frustumTest: boolean;

    /**
     * clone 当前mesh
     * @param isChild 是否子元素
     */
    clone(isChild: boolean): Mesh;

    /**
     * raycast
     * @param ray
     * @param sort 是否按距离排序
     */
    raycast(ray: Ray, sort?: boolean): Vector3[] | null;

    isNode: boolean;

    /**
     * Node 的名字，可以通过 getChildByName 查找
     */
    name: string;

    /**
     * animation 查找 id
     */
    animationId: number;

    /**
     * 是否自动更新世界矩阵
     */
    autoUpdateWorldMatrix: boolean;

    /**
     * 父节点
     */
    parent: Node;

    /**
     * 每次更新的时候是否调用子节点的 onUpdate 方法
     */
    needCallChildUpdate: boolean;

    /**
     * 节点是否显示
     */
    visible: boolean;

    /**
     * 可视对象是否接受交互事件。默认为接受交互事件，即true。
     */
    pointerEnabled: boolean;

    /**
     * 子元素是否接受交互事件。
     */
    pointerChildren: boolean;

    /**
     * 是否用鼠标指针
     */
    useHandCursor: boolean;

    id: string;

    /**
     * 元素的up向量
     */
    up: Vector3;

    /**
     * 元素直接点数组
     */
    children: Node[];

    /**
     * 元素的世界矩阵
     */
    worldMatrix: Matrix4;

    /**
     * 设置节点的动画，这个需要是模型的根节点
     * @param anim 动画实例
     */
    setAnim(anim: Animation): Node;

    /**
     * 重置子孙元素中 SkinedMesh 的根节点为当前元素
     */
    resetSkinedMeshRootNode(): void;

    /**
     * 将所以子孙元素放到一个对象中，对象key为元素的name，value为该元素
     */
    getChildrenNameMap(): Object;

    /**
     * 添加一个子元素
     * @param child 需要添加的子元素
     */
    addChild(child: Node): Node;

    /**
     * 移除指定的子元素
     * @param child 需要移除的元素
     */
    removeChild(child: Node): Node;

    /**
     * 将当前元素添加到某个父元素的子元素中
     * @param parent 需要添加到的父元素
     */
    addTo(parent: Node | Stage): Node;

    /**
     * 将当前元素从其父元素中移除
     */
    removeFromParent(): Node;

    /**
     * 更新本地矩阵
     */
    updateMatrix(): Node;

    /**
     * 更新transform属性
     */
    updateTransform(): Node;

    /**
     * 更新世界矩阵
     * @param force 是否强制更新
     */
    updateMatrixWorld(force?: boolean): Node;

    /**
     * 获取当前元素相对于指定元素的矩阵
     * @param ancestor 相对于的元素，需要是当前元素的祖先元素，不传表示获取世界矩阵
     */
    getConcatenatedMatrix(ancestor?: Node): Matrix4;

    /**
     * 遍历当前元素的子孙元素
     * @param callback 每个元素都会调用这个函数处理
     * @param onlyChild 是否只遍历子元素
     */
    traverse(callback: Function, onlyChild?: boolean): Node;

    /**
     * 遍历调用子孙元素onUpdate方法
     * @param dt
     */
    traverseUpdate(dt: number): Node;

    /**
     * 根据函数来获取一个子孙元素
     * @param fn 判读函数
     */
    getChildByFn(fn: Function): Node | null;

    /**
     * 根据函数来获取匹配的所有子孙元素
     * @param fn 判读函数
     */
    getChildrenByFn(fn: Function): Node[];

    /**
     * 获取指定name的首个子孙元素
     * @param name 元素name
     */
    getChildByName(name: string): Node | null;

    /**
     * 获取指定name的所有子孙元素
     * @param name 元素name
     */
    getChildrenByName(name: string): Node[];

    /**
     * 获取指定id的子孙元素
     * @param id 元素id
     */
    getChildById(id: string): Node | null;

    /**
     * 获取指定类名的所有子孙元素
     * @param className 类名
     */
    getChildrenByClassName(className: string): Node[];

    /**
     * 销毁 Mesh 资源
     * @param renderer WebGLRenderer
     */
    destroy(renderer: WebGLRenderer): Mesh;
    
    /**
     * 设置元素的缩放比例
     * @param x X缩放比例
     * @param y Y缩放比例
     * @param z Z缩放比例
     */
    setScale(x: number, y: number, z: number): Node;

    /**
     * 设置元素的位置
     * @param x X方向位置
     * @param y Y方向位置
     * @param z Z方向位置
     */
    setPosition(x: number, y: number, z: number): Node;

    /**
     * 设置元素的旋转
     * @param x X轴旋转角度
     * @param y Y轴旋转角度
     * @param z Z轴旋转角度
     */
    setRotation(x: number, y: number, z: number): Node;

    /**
     * 设置中心点
     * @param x 中心点x
     * @param y 中心点y
     * @param z 中心点z
     */
    setPivot(x: number, y: number, z: number): Node;

    /**
     * 改变元素的朝向
     * @param node 需要朝向的元素，或者坐标
     */
    lookAt(node: Node | Object | Vector3): Node;
    onUpdate(escapeTime: number): any;

    /**
     * 元素的矩阵
     */
    matrix: Matrix4;

    /**
     * x轴坐标
     */
    x: number;

    /**
     * y轴坐标
     */
    y: number;

    /**
     * z轴坐标
     */
    z: number;

    /**
     * 缩放比例x
     */
    scaleX: number;

    /**
     * 缩放比例y
     */
    scaleY: number;

    /**
     * 缩放比例z
     */
    scaleZ: number;

    /**
     * 旋转角度x
     */
    rotationX: number;

    /**
     * 旋转角度y
     */
    rotationY: number;

    /**
     * 旋转角度z
     */
    rotationZ: number;

    /**
     * 中心点x
     */
    pivotX: number;

    /**
     * 中心点y
     */
    pivotY: number;

    /**
     * 中心点z
     */
    pivotZ: number;

    /**
     * 四元数角度
     */
    quaternion: Quaternion;

    /**
     * 获取元素的包围盒信息
     * @param parent 元素相对于哪个祖先元素的包围盒，不传表示世界
     * @param currentMatrix 当前计算的矩阵
     * @param bounds 当前计算的包围盒信息
     */
    getBounds(parent?: Node, currentMatrix?: Matrix4, bounds?: Bounds): Bounds;

  }

  /**
   * 包围盒信息
   */
  interface Bounds {
    /**
     * 包围盒中心的X坐标
     */
    x: number;
    /**
     * 包围盒中心的Y坐标
     */
    y: number;
    /**
     * 包围盒中心的Z坐标
     */
    z: number;
    /**
     * 包围盒的宽度
     */
    width: number;
    /**
     * 包围盒的高度
     */
    height: number;
    /**
     * 包围盒的深度
     */
    depth: number;
    /**
     * X轴的最小值
     */
    xMin: number;
    /**
     * X轴的最大值
     */
    xMax: number;
    /**
     * Y轴的最小值
     */
    yMin: number;
    /**
     * Y轴的最大值
     */
    yMax: number;
    /**
     * Z轴的最小值
     */
    zMin: number;
    /**
     * Z轴的最大值
     */
    zMax: number;
  }

  /**
   * 碰撞信息
   */
  interface raycastInfo {
    /**
     * 碰撞的 mesh
     */
    mesh: Mesh;
    /**
     * 碰撞得点
     */
    point: Vector3;
  }

  class INode extends ITransformAttributes {
    /**
     * Node 的名字，可以通过 getChildByName 查找
     */
    name?: string;

    /**
     * animation 查找 id
     */
    animationId: number;

    jointName: string;

    /**
     * 是否自动更新世界矩阵
     */
    autoUpdateWorldMatrix?: boolean;

    /**
     * 每次更新的时候是否调用子节点的 onUpdate 方法
     */
    needCallChildUpdate?: boolean;

    /**
     * 节点是否显示
     */
    visible?: boolean;

    /**
     * 可视对象是否接受交互事件。默认为接受交互事件，即true。
     */
    pointerEnabled?: boolean;

    /**
     * 子元素是否接受交互事件。
     */
    pointerChildren?: boolean;

    /**
     * 是否用鼠标指针
     */
    useHandCursor?: boolean;
  }

  class Node extends INode {
    /**
     * 节点，3D场景中的元素，是大部分类的基类
     */
    constructor();

    /**
     * 
     * @param params 初始化参数，所有params都会复制到实例上
     */
    constructor(params: INode);

    isNode: boolean;

    className: string;

    /**
     * 父节点
     */
    parent: Node;

    id: string;

    /**
     * 元素的up向量
     */
    up: Vector3;

    anim?: Animation;

    /**
     * 元素直接点数组
     */
    children: (Node | Mesh | Camera | Light)[];

    /**
     * 元素的世界矩阵
     */
    worldMatrix: Matrix4;

    /**
     * 
     * @param isChild 是否子节点，子节点不会处理动画及骨骼Mesh，即如果有动画将共享
     */
    clone(isChild?: boolean): Node;

    /**
     * 设置节点的动画，这个需要是模型的根节点
     * @param anim 动画实例
     */
    setAnim(anim: Animation): Node;

    /**
     * 重置子孙元素中 SkinedMesh 的根节点为当前元素
     */
    resetSkinedMeshRootNode(): void;

    /**
     * 将所以子孙元素放到一个对象中，对象key为元素的name，value为该元素
     */
    getChildrenNameMap(): Object;

    /**
     * 添加一个子元素
     * @param child 需要添加的子元素
     */
    addChild(child: Node | Mesh | Camera | Light): Node;

    /**
     * 移除指定的子元素
     * @param child 需要移除的元素
     */
    removeChild(child: Node | Mesh | Camera | Light): Node;

    /**
     * 将当前元素添加到某个父元素的子元素中
     * @param parent 需要添加到的父元素
     */
    addTo(parent: Node | Stage): Node;

    /**
     * 将当前元素从其父元素中移除
     */
    removeFromParent(): Node;

    /**
     * 更新本地矩阵
     */
    updateMatrix(): Node;

    /**
     * 更新transform属性
     */
    updateTransform(): Node;

    /**
     * 更新世界矩阵
     * @param force 是否强制更新
     */
    updateMatrixWorld(force?: boolean): Node;

    /**
     * 获取当前元素相对于指定元素的矩阵
     * @param ancestor 相对于的元素，需要是当前元素的祖先元素，不传表示获取世界矩阵
     */
    getConcatenatedMatrix(ancestor?: Node): Matrix4;

    /**
     * 遍历当前元素的子孙元素
     * @param callback 每个元素都会调用这个函数处理
     * @param onlyChild 是否只遍历子元素
     */
    traverse(callback: Function, onlyChild?: boolean): Node;

    /**
     * 遍历调用子孙元素onUpdate方法
     * @param dt
     */
    traverseUpdate(dt: number): Node;

    /**
     * 根据函数来获取一个子孙元素
     * @param fn 判读函数
     */
    getChildByFn(fn: Function): Node | null;

    /**
     * 根据函数来获取匹配的所有子孙元素
     * @param fn 判读函数
     */
    getChildrenByFn(fn: Function): Node[];

    /**
     * 获取指定name的首个子孙元素
     * @param name 元素name
     */
    getChildByName(name: string): Node | null;

    /**
     * 获取指定name的所有子孙元素
     * @param name 元素name
     */
    getChildrenByName(name: string): Node[];

    /**
     * 获取指定id的子孙元素
     * @param id 元素id
     */
    getChildById(id: string): Node | null;

    /**
     * 获取指定类名的所有子孙元素
     * @param className 类名
     */
    getChildrenByClassName(className: string): Node[];

    /**
     * 获取指定名字路径的子孙元素
     * @param className 名字路径
     */
    getChildByNamePath(path: string[]): Node;

    /**
     * 获取指定名字路径的所有子孙元素
     * @param path 名字路径
     */
    getChildrenByNamePath(path: string[]): Node[];

    /**
     * 设置元素的缩放比例
     * @param x X缩放比例
     * @param y Y缩放比例
     * @param z Z缩放比例
     */
    setScale(x: number, y: number, z: number): Node;

    /**
     * 设置元素的位置
     * @param x X方向位置
     * @param y Y方向位置
     * @param z Z方向位置
     */
    setPosition(x: number, y: number, z: number): Node;

    /**
     * 设置元素的旋转
     * @param x X轴旋转角度
     * @param y Y轴旋转角度
     * @param z Z轴旋转角度
     */
    setRotation(x: number, y: number, z: number): Node;

    /**
     * 设置中心点
     * @param x 中心点x
     * @param y 中心点y
     * @param z 中心点z
     */
    setPivot(x: number, y: number, z: number): Node;

    /**
     * 改变元素的朝向
     * @param node 需要朝向的元素，或者坐标
     */
    lookAt(node: Node | Object | Vector3): Node;
    onUpdate(escapeTime: number): any;

    /**
     * raycast
     * @param ray
     * @param sort 是否按距离排序
     * @param eventMode 是否事件模式
     */
    raycast(ray: Ray, sort?: boolean, eventMode?: boolean): raycastInfo[] | null;

    /**
     * 元素的矩阵
     */
    matrix: Matrix4;

    /**
     * 获取元素的包围盒信息
     * @param parent 元素相对于哪个祖先元素的包围盒，不传表示世界
     * @param currentMatrix 当前计算的矩阵
     * @param bounds 当前计算的包围盒信息
     */
    getBounds(parent?: Node, currentMatrix?: Matrix4, bounds?: Bounds): Bounds;

    /**
     * 销毁 Node 资源
     * @param {WebGLRenderer} renderer
     * @param {Boolean} [destroyTextures=false] 是否销毁材质的贴图，默认不销毁
     * @return {Node} this
     */
    destroy(renderer: WebGLRenderer, destroyTextures: boolean): void;
  }

  class SkinedMesh extends Mesh {
    /**
     * 蒙皮Mesh
     */
    constructor();

    /**
     * 
     * @param params 初始化参数，所有params都会复制到实例上
     */
    constructor(params: Object);

    isSkinedMesh: boolean;

    className: string;

    /**
     * 这个骨骼Mesh的根节点，改变后会自动根据 jointNames 来更新 jointNodeList
     */
    rootNode: Node;

    /**
     * 骨骼节点数组
     */
    jointNodeList: Node[];

    /**
     * 是否支持 Instanced
     */
    useInstanced: boolean;

    /**
     * 骨骼矩阵DataTexture
     */
    jointMatTexture: DataTexture;

    /**
     * 当前骨骼Mesh关联的骨骼名字列表
     */
    jointNames: string[];

    /**
     * 当前骨骼Mesh的 inverseBindMatrices
     */
    inverseBindMatrices: any;

    /**
     * 获取每个骨骼对应的矩阵数组
     */
    getJointMat(): any;

    /**
     * 根据当前骨骼数来生成骨骼矩阵的 jointMatTexture
     */
    initJointMatTexture(): DataTexture;

    /**
     * 将 getJointMat 获取的骨骼矩阵数组更新到 jointMatTexture 中
     */
    updateJointMatTexture(): void;

    isMesh: boolean;

    geometry: Geometry;

    material: Material;

    /**
     * 是否开启视锥体裁剪
     */
    frustumTest: boolean;

    /**
     * clone 当前mesh
     * @param isChild 是否子元素
     */
    clone(isChild: boolean): Mesh;

    /**
     * raycast
     * @param ray
     * @param sort 是否按距离排序
     */
    raycast(ray: Ray, sort?: boolean): Vector3[] | null;

    isNode: boolean;

    /**
     * Node 的名字，可以通过 getChildByName 查找
     */
    name: string;

    /**
     * animation 查找 id
     */
    animationId: number;

    /**
     * 是否自动更新世界矩阵
     */
    autoUpdateWorldMatrix: boolean;

    /**
     * 父节点
     */
    parent: Node;

    /**
     * 每次更新的时候是否调用子节点的 onUpdate 方法
     */
    needCallChildUpdate: boolean;

    /**
     * 节点是否显示
     */
    visible: boolean;

    /**
     * 可视对象是否接受交互事件。默认为接受交互事件，即true。
     */
    pointerEnabled: boolean;

    /**
     * 子元素是否接受交互事件。
     */
    pointerChildren: boolean;

    /**
     * 是否用鼠标指针
     */
    useHandCursor: boolean;

    id: string;

    /**
     * 元素的up向量
     */
    up: Vector3;

    /**
     * 元素直接点数组
     */
    children: Node[];

    /**
     * 元素的世界矩阵
     */
    worldMatrix: Matrix4;

    /**
     * 设置节点的动画，这个需要是模型的根节点
     * @param anim 动画实例
     */
    setAnim(anim: Animation): Node;

    /**
     * 重置子孙元素中 SkinedMesh 的根节点为当前元素
     */
    resetSkinedMeshRootNode(): void;

    /**
     * 将所以子孙元素放到一个对象中，对象key为元素的name，value为该元素
     */
    getChildrenNameMap(): Object;

    /**
     * 添加一个子元素
     * @param child 需要添加的子元素
     */
    addChild(child: Node): Node;

    /**
     * 移除指定的子元素
     * @param child 需要移除的元素
     */
    removeChild(child: Node): Node;

    /**
     * 将当前元素添加到某个父元素的子元素中
     * @param parent 需要添加到的父元素
     */
    addTo(parent: Node | Stage): Node;

    /**
     * 将当前元素从其父元素中移除
     */
    removeFromParent(): Node;

    /**
     * 更新本地矩阵
     */
    updateMatrix(): Node;

    /**
     * 更新transform属性
     */
    updateTransform(): Node;

    /**
     * 更新世界矩阵
     * @param force 是否强制更新
     */
    updateMatrixWorld(force?: boolean): Node;

    /**
     * 获取当前元素相对于指定元素的矩阵
     * @param ancestor 相对于的元素，需要是当前元素的祖先元素，不传表示获取世界矩阵
     */
    getConcatenatedMatrix(ancestor?: Node): Matrix4;

    /**
     * 遍历当前元素的子孙元素
     * @param callback 每个元素都会调用这个函数处理
     * @param onlyChild 是否只遍历子元素
     */
    traverse(callback: Function, onlyChild?: boolean): Node;

    /**
     * 遍历调用子孙元素onUpdate方法
     * @param dt
     */
    traverseUpdate(dt: number): Node;

    /**
     * 根据函数来获取一个子孙元素
     * @param fn 判读函数
     */
    getChildByFn(fn: Function): Node | null;

    /**
     * 根据函数来获取匹配的所有子孙元素
     * @param fn 判读函数
     */
    getChildrenByFn(fn: Function): Node[];

    /**
     * 获取指定name的首个子孙元素
     * @param name 元素name
     */
    getChildByName(name: string): Node | null;

    /**
     * 获取指定name的所有子孙元素
     * @param name 元素name
     */
    getChildrenByName(name: string): Node[];

    /**
     * 获取指定id的子孙元素
     * @param id 元素id
     */
    getChildById(id: string): Node | null;

    /**
     * 获取指定类名的所有子孙元素
     * @param className 类名
     */
    getChildrenByClassName(className: string): Node[];

    /**
     * 设置元素的缩放比例
     * @param x X缩放比例
     * @param y Y缩放比例
     * @param z Z缩放比例
     */
    setScale(x: number, y: number, z: number): Node;

    /**
     * 设置元素的位置
     * @param x X方向位置
     * @param y Y方向位置
     * @param z Z方向位置
     */
    setPosition(x: number, y: number, z: number): Node;

    /**
     * 设置元素的旋转
     * @param x X轴旋转角度
     * @param y Y轴旋转角度
     * @param z Z轴旋转角度
     */
    setRotation(x: number, y: number, z: number): Node;

    /**
     * 设置中心点
     * @param x 中心点x
     * @param y 中心点y
     * @param z 中心点z
     */
    setPivot(x: number, y: number, z: number): Node;

    /**
     * 改变元素的朝向
     * @param node 需要朝向的元素，或者坐标
     */
    lookAt(node: Node | Object | Vector3): Node;
    onUpdate(escapeTime: number): any;

    /**
     * 元素的矩阵
     */
    matrix: Matrix4;

    /**
     * x轴坐标
     */
    x: number;

    /**
     * y轴坐标
     */
    y: number;

    /**
     * z轴坐标
     */
    z: number;

    /**
     * 缩放比例x
     */
    scaleX: number;

    /**
     * 缩放比例y
     */
    scaleY: number;

    /**
     * 缩放比例z
     */
    scaleZ: number;

    /**
     * 旋转角度x
     */
    rotationX: number;

    /**
     * 旋转角度y
     */
    rotationY: number;

    /**
     * 旋转角度z
     */
    rotationZ: number;

    /**
     * 中心点x
     */
    pivotX: number;

    /**
     * 中心点y
     */
    pivotY: number;

    /**
     * 中心点z
     */
    pivotZ: number;

    /**
     * 四元数角度
     */
    quaternion: Quaternion;

    /**
     * 获取元素的包围盒信息
     * @param parent 元素相对于哪个祖先元素的包围盒，不传表示世界
     * @param currentMatrix 当前计算的矩阵
     * @param bounds 当前计算的包围盒信息
     */
    getBounds(parent?: Node, currentMatrix?: Matrix4, bounds?: Bounds): Bounds;

  }

  class Stage {
    /**
     * 舞台类
     */
    constructor();

    /**
     * 
     * @param params 创建对象的属性参数。可包含此类的所有属性，所有属性会透传给 Renderer。
     * @param params.container stage的容器
     * @param params.canvas 指定canvas。
     * @param params.pixelRatio 像素密度。
     * @param params.clearColor 背景色。
     * @param params.useLogDepth 是否使用对数深度，处理深度冲突。
     * @param params.useFramebuffer 是否使用Framebuffer，有后处理需求时需要。
     * @param params.framebufferOption framebufferOption Framebuffer的配置，useFramebuffer为true时生效。
     * @param params.alpha 是否背景透明。
     * @param params.depth 是否需要深度缓冲区。
     * @param params.stencil 是否需要模版缓冲区。
     * @param params.antialias 是否抗锯齿。
     * @param params.premultipliedAlpha 是否需要 premultipliedAlpha。
     * @param params.preserveDrawingBuffer 是否需要 preserveDrawingBuffer。
     * @param params.failIfMajorPerformanceCaveat 是否需要 failIfMajorPerformanceCaveat。
     */
    constructor(
      params?: {
        camera?: Camera;
        container?: HTMLDivElement;
        canvas?: HTMLCanvasElement;
        width?: number;
        height?: number;
        /**
         * 像素密度。
         */
        pixelRatio?: number;
        /**
         * 背景色。
         */
        clearColor?: Color;
        /**
         * 是否使用Framebuffer，有后处理需求时需要。
         */
        useFramebuffer?: boolean;
        /**
         * framebufferOption Framebuffer的配置，useFramebuffer为true时生效。
         */
        framebufferOption?: Object;
        /**
         * 是否使用对数深度，处理深度冲突
         */
        useLogDepth?: boolean;
        /**
         * 是否背景透明。
         */
        alpha?: boolean;
        /**
         * 是否需要深度缓冲区。
         */
        depth?: boolean;
        /**
         * 是否需要模版缓冲区。
         */
        stencil?: boolean;
        /**
         * 是否抗锯齿。
         */
        antialias?: boolean;
        /**
         * 是否需要 premultipliedAlpha。
         */
        premultipliedAlpha?: boolean;
        /**
         * 是否需要 preserveDrawingBuffer。
         */
        preserveDrawingBuffer?: boolean;
        /**
         * 是否需要 failIfMajorPerformanceCaveat。
         */
        failIfMajorPerformanceCaveat?: boolean;
        fragmentPrecision?: 'highp' | 'mediump' | 'lowp';
      },
      container?: HTMLDivElement
    );

    /**
     * 渲染器
     */
    renderer: WebGLRenderer;

    /**
     * 摄像机
     */
    camera: Camera;

    /**
     * 容器
     */
    container: HTMLElement;

    /**
     * Canvas
     */
    canvas: HTMLCanvasElement;

    /**
     * 像素密度
     */
    pixelRatio: number;

    /**
     * 偏移值
     */
    offsetX: number;

    /**
     * 偏移值
     */
    offsetY: number;

    /**
     * 缩放舞台
     * @param width 舞台宽
     * @param height 舞台高
     * @param pixelRatio 像素密度
     * @param force 是否强制刷新
     */
    resize(width: number, height: number, pixelRatio?: number, force?: boolean): Stage;

    /**
     * 设置舞台偏移值
     * @param x x
     * @param y y
     */
    setOffset(x: number, y: number): Stage;

    /**
     * 改viewport
     * @param x x
     * @param y y
     * @param width width
     * @param height height
     */
    viewport(x: number, y: number, width: number, height: number): Stage;

    /**
     * 渲染一帧
     * @param dt 间隔时间
     */
    tick(dt: number): Stage;

    /**
     * 
     * @param type 要开启/关闭的事件名称或数组。
     * @param enabled 指定开启还是关闭。如果不传此参数，则默认为开启。
     */
    enableDOMEvent(type: string | any, enabled: boolean): Stage;

    /**
     * 更新 DOM viewport
     */
    updateDomViewport(): Object;

    /**
     * 获取指定点的 mesh
     * @param x
     * @param y
     * @param eventMode
     */
    getMeshResultAtPoint(x: number, y: number, eventMode?: boolean): Mesh | null;

    /**
     * 释放 WebGL 资源
     */
    releaseGLResource(): Stage;

    isNode: boolean;

    className: string;

    /**
     * Node 的名字，可以通过 getChildByName 查找
     */
    name: string;

    /**
     * animation 查找 id
     */
    animationId: number;

    /**
     * 是否自动更新世界矩阵
     */
    autoUpdateWorldMatrix: boolean;

    /**
     * 父节点
     */
    parent: Node;

    /**
     * 每次更新的时候是否调用子节点的 onUpdate 方法
     */
    needCallChildUpdate: boolean;

    /**
     * 节点是否显示
     */
    visible: boolean;

    /**
     * 可视对象是否接受交互事件。默认为接受交互事件，即true。
     */
    pointerEnabled: boolean;

    /**
     * 子元素是否接受交互事件。
     */
    pointerChildren: boolean;

    /**
     * 是否用鼠标指针
     */
    useHandCursor: boolean;

    id: string;

    /**
     * 元素的up向量
     */
    up: Vector3;

    /**
     * 元素直接点数组
     */
    children: Node[];

    /**
     * 元素的世界矩阵
     */
    worldMatrix: Matrix4;

    /**
     * 
     * @param isChild 是否子节点，子节点不会处理动画及骨骼Mesh，即如果有动画将共享
     */
    clone(isChild?: boolean): Node;

    /**
     * 设置节点的动画，这个需要是模型的根节点
     * @param anim 动画实例
     */
    setAnim(anim: Animation): Node;

    /**
     * 重置子孙元素中 SkinedMesh 的根节点为当前元素
     */
    resetSkinedMeshRootNode(): void;

    /**
     * 将所以子孙元素放到一个对象中，对象key为元素的name，value为该元素
     */
    getChildrenNameMap(): Object;

    /**
     * 添加一个子元素
     * @param child 需要添加的子元素
     */
    addChild(child: Node | Mesh | Light | Camera): Node;

    /**
     * 移除指定的子元素
     * @param child 需要移除的元素
     */
    removeChild(child: Node | Mesh | Light | Camera): Node;

    /**
     * 将当前元素添加到某个父元素的子元素中
     * @param parent 需要添加到的父元素
     */
    addTo(parent: Node | Stage): Node;

    /**
     * 将当前元素从其父元素中移除
     */
    removeFromParent(): Node;

    /**
     * 更新本地矩阵
     */
    updateMatrix(): Node;

    /**
     * 更新transform属性
     */
    updateTransform(): Node;

    /**
     * 更新世界矩阵
     * @param force 是否强制更新
     */
    updateMatrixWorld(force?: boolean): Node;

    /**
     * 获取当前元素相对于指定元素的矩阵
     * @param ancestor 相对于的元素，需要是当前元素的祖先元素，不传表示获取世界矩阵
     */
    getConcatenatedMatrix(ancestor?: Node): Matrix4;

    /**
     * 遍历当前元素的子孙元素
     * @param callback 每个元素都会调用这个函数处理
     * @param onlyChild 是否只遍历子元素
     */
    traverse(callback: Function, onlyChild?: boolean): Node;

    /**
     * 遍历调用子孙元素onUpdate方法
     * @param dt
     */
    traverseUpdate(dt: number): Node;

    /**
     * 根据函数来获取一个子孙元素
     * @param fn 判读函数
     */
    getChildByFn(fn: Function): Node | null;

    /**
     * 根据函数来获取匹配的所有子孙元素
     * @param fn 判读函数
     */
    getChildrenByFn(fn: Function): Node[];

    /**
     * 获取指定name的首个子孙元素
     * @param name 元素name
     */
    getChildByName(name: string): Node | null;

    /**
     * 获取指定name的所有子孙元素
     * @param name 元素name
     */
    getChildrenByName(name: string): Node[];

    /**
     * 获取指定id的子孙元素
     * @param id 元素id
     */
    getChildById(id: string): Node | null;

    /**
     * 获取指定类名的所有子孙元素
     * @param className 类名
     */
    getChildrenByClassName(className: string): Node[];

    /**
     * 设置元素的缩放比例
     * @param x X缩放比例
     * @param y Y缩放比例
     * @param z Z缩放比例
     */
    setScale(x: number, y: number, z: number): Node;

    /**
     * 设置元素的位置
     * @param x X方向位置
     * @param y Y方向位置
     * @param z Z方向位置
     */
    setPosition(x: number, y: number, z: number): Node;

    /**
     * 设置元素的旋转
     * @param x X轴旋转角度
     * @param y Y轴旋转角度
     * @param z Z轴旋转角度
     */
    setRotation(x: number, y: number, z: number): Node;

    /**
     * 设置中心点
     * @param x 中心点x
     * @param y 中心点y
     * @param z 中心点z
     */
    setPivot(x: number, y: number, z: number): Node;

    /**
     * 改变元素的朝向
     * @param node 需要朝向的元素，或者坐标
     */
    lookAt(node: Node | Object | Vector3): Node;
    onUpdate(escapeTime: number): any;

    /**
     * raycast
     * @param ray
     * @param sort 是否按距离排序
     * @param eventMode 是否事件模式
     */
    raycast(ray: Ray, sort?: boolean, eventMode?: boolean): raycastInfo[] | null;

    /**
     * 元素的矩阵
     */
    matrix: Matrix4;

    /**
     * x轴坐标
     */
    x: number;

    /**
     * y轴坐标
     */
    y: number;

    /**
     * z轴坐标
     */
    z: number;

    /**
     * 缩放比例x
     */
    scaleX: number;

    /**
     * 缩放比例y
     */
    scaleY: number;

    /**
     * 缩放比例z
     */
    scaleZ: number;

    /**
     * 旋转角度x
     */
    rotationX: number;

    /**
     * 旋转角度y
     */
    rotationY: number;

    /**
     * 旋转角度z
     */
    rotationZ: number;

    /**
     * 中心点x
     */
    pivotX: number;

    /**
     * 中心点y
     */
    pivotY: number;

    /**
     * 中心点z
     */
    pivotZ: number;

    /**
     * 四元数角度
     */
    quaternion: Quaternion;

    /**
     * 获取元素的包围盒信息
     * @param parent 元素相对于哪个祖先元素的包围盒，不传表示世界
     * @param currentMatrix 当前计算的矩阵
     * @param bounds 当前计算的包围盒信息
     */
    getBounds(parent?: Node, currentMatrix?: Matrix4, bounds?: Bounds): Bounds;

    /**
     * 销毁场景
     */
    destroy(): void;
  }

  interface EaseTimeFunctions {
    EaseIn: (time: number) => number;
    EaseOut: (time: number) => number;
    EaseInOut: (time: number) => number;
  }
  /**
   * Ease类包含为Tween类提供各种缓动功能的函数。
   */
  interface Ease {

    /**
     * 向后缓动函数。包含EaseIn、EaseOut、EaseInOut三个函数。
     */
    Back: EaseTimeFunctions & {
      o: number;
      s: number;
      config(overshoot: number): void;
    };

    /**
     * 弹跳缓动函数。包含EaseIn、EaseOut、EaseInOut三个函数。
     */
    Bounce: EaseTimeFunctions;

    /**
     * 圆形缓动函数。包含EaseIn、EaseOut、EaseInOut三个函数。
     */
    Circ: EaseTimeFunctions;

    /**
     * 三次缓动函数。包含EaseIn、EaseOut、EaseInOut三个函数。
     */
    Cubic: EaseTimeFunctions;

    /**
     * 弹性缓动函数。包含EaseIn、EaseOut、EaseInOut三个函数。
     */
    Elastic: EaseTimeFunctions & {
      a: number;
      p: number;
      s: number;
      config(amplitude: number, period: number): void;
    };

    /**
     * 指数缓动函数。包含EaseIn、EaseOut、EaseInOut三个函数。
     */
    Expo: EaseTimeFunctions;

    /**
     * 线性匀速缓动函数。包含EaseNone函数。
     */
    Linear: {
      EaseNone(time: number): number
    };

    /**
     * 二次缓动函数。包含EaseIn、EaseOut、EaseInOut三个函数。
     */
    Quad: EaseTimeFunctions;

    /**
     * 四次缓动函数。包含EaseIn、EaseOut、EaseInOut三个函数。
     */
    Quart: EaseTimeFunctions;

    /**
     * 五次缓动函数。包含EaseIn、EaseOut、EaseInOut三个函数。
     */
    Quint: EaseTimeFunctions;

    /**
     * 正弦缓动函数。包含EaseIn、EaseOut、EaseInOut三个函数。
     */
    Sine: EaseTimeFunctions;

  }

  interface TweenParams {
/**
     * 缓动延迟时间。单位毫秒。
     */
    delay?: number;

    /**
     * 缓动总时长。单位毫秒。
     */
    duration?: number;

    /**
     * 缓动变化函数。默认为null。
     */
    ease?: (time: number) => number;

    /**
     * 缓动是否循环。默认为false。
     */
    loop?: boolean;

    /**
     * 缓动结束回调函数。它接受1个参数：tween。默认值为null。
     */
    onComplete?: Function;

    /**
     * 缓动开始回调函数。它接受1个参数：tween。默认值为null。
     */
    onStart?: Function;

    /**
     * 缓动更新回调函数。它接受2个参数：ratio和tween。默认值为null。
     */
    onUpdate?: Function;

    /**
     * 缓动重复的次数。默认为0。
     */
    repeat?: number;

    /**
     * 缓动重复的延迟时长。单位为毫秒。
     */
    repeatDelay?: number;

    /**
     * 缓动是否反转播放。默认为false。
     */
    reverse?: boolean;
  }

  class ITween {
    /**
     * 缓动延迟时间。单位毫秒。
     */
    delay?: number;

    /**
     * 缓动总时长。单位毫秒。
     */
    duration?: number;

    /**
     * 缓动变化函数。默认为null。
     */
    ease?: (time: number) => number;

    /**
     * 缓动是否循环。默认为false。
     */
    loop?: boolean;

    /**
     * 缓动结束回调函数。它接受1个参数：tween。默认值为null。
     */
    onComplete?: Function;

    /**
     * 缓动开始回调函数。它接受1个参数：tween。默认值为null。
     */
    onStart?: Function;

    /**
     * 缓动更新回调函数。它接受2个参数：ratio和tween。默认值为null。
     */
    onUpdate?: Function;

    /**
     * 缓动是否暂停。默认为false。
     */
    paused?: boolean;

    /**
     * 缓动重复的次数。默认为0。
     */
    repeat?: number;

    /**
     * 缓动重复的延迟时长。单位为毫秒。
     */
    repeatDelay?: number;

    /**
     * 缓动是否反转播放。默认为false。
     */
    reverse?: boolean;

    /**
     * 缓动目标。只读属性。
     */
    target?: object;

    /**
     * 缓动已进行的时长。单位毫秒。只读属性。
     */
    time?: number;
  }

  class Tween extends ITween {
    /**
     * @param target 缓动对象。
     * @param fromProps 对象缓动的起始属性集合。
     * @param toProps 对象缓动的目标属性集合。
     * @param params 缓动参数。可包含Tween类所有可写属性。
     */
    constructor(target: Object, fromProps: Object, toProps: Object, params: Object);

    /**
     * 连接下一个Tween变换。其开始时间根据delay值不同而不同。当delay值为字符串且以'+'或'-'开始时，Tween的开始时间从当前变换结束点计算，否则以当前变换起始点计算。
     * @param tween 要连接的Tween变换。
     */
    link(tween: Tween): Tween;

    /**
     * 暂停缓动动画的播放。
     */
    pause(): Tween;

    /**
     * 恢复缓动动画的播放。
     */
    resume(): Tween;

    /**
     * 跳转Tween到指定的时间。
     * @param time 指定要跳转的时间。取值范围为：0 - duraion。
     * @param pause 是否暂停。
     */
    seek(time: number, pause: boolean): Tween;

    /**
     * 设置缓动对象的初始和目标属性。
     * @param fromProps 缓动对象的初始属性。
     * @param toProps 缓动对象的目标属性。
     */
    setProps(fromProps: object, toProps: object): Tween;

    /**
     * 启动缓动动画的播放。
     */
    start(): Tween;

    /**
     * 停止缓动动画的播放。
     */
    stop(): Tween;

    /**
     * 更新所有Tween实例。
     */
    static tick(): object;

    /**
     * 添加Tween实例。
     * @param tween 要添加的Tween对象。
     * @returns Tween
     */
    static add(tween: Tween): object;

    /**
     * 删除Tween实例。
     * @param tweenOrTarget 
     */
    static remove(tweenOrTarget: Tween | object | any[]): object;

    /**
     * 删除所有Tween实例。
     */
    static removeAll(): object;

    /**
     * 创建一个缓动动画，让目标对象从开始属性变换到目标属性。
     * @param target 缓动目标对象或缓动目标数组。
     * @param fromProps 缓动目标对象的开始属性。
     * @param toProps 缓动目标对象的目标属性。
     * @param params 缓动动画的参数。
     */
    static fromTo(target: any, fromProps: any, toProps, params: TweenParams): Tween | any;

    /**
     * 创建一个缓动动画，让目标对象从当前属性变换到目标属性。
     * @param target 缓动目标对象或缓动目标数组。
     * @param toProps 缓动目标对象的目标属性。
     * @param params 缓动动画的参数。
     */
    static to(target: any, toProps: any, params: TweenParams): Tween | any;

    /**
     * 创建一个缓动动画，让目标对象从指定的起始属性变换到当前属性。
     * @param target 缓动目标对象或缓动目标数组。
     * @param toProps 缓动目标对象的目标属性。
     * @param params 缓动动画的参数。
     */
    static from(target: any, fromProps: any, params: TweenParams): Tween | any;

    /**
     * Ease类包含为Tween类提供各种缓动功能的函数。
     * @see
     */
    static Ease: Ease;

  }

  class BoxGeometry extends Geometry {
    /**
     * 长方体几何体
     */
    constructor();

    /**
     * 
     * @param params 创建对象的属性参数。可包含此类的所有属性。
     */
    constructor(params: {
      /**
       * box的宽度
       */
      width?: number;

      /**
       * box的高度
       */
      height?: number;

      /**
       * box的深度
       */
      depth?: number;

      /**
       * 水平分割面的数量
       */
      widthSegments?: number;

      /**
       * 垂直分割面的数量
       */
      heightSegments?: number;

      /**
       * 深度分割面的数量
       */
      depthSegments?: number;
    });

    isBoxGeometry: boolean;

    className: string;

    /**
     * box的宽度
     */
    width: number;

    /**
     * box的高度
     */
    height: number;

    /**
     * box的深度
     */
    depth: number;

    /**
     * 水平分割面的数量
     */
    widthSegments: number;

    /**
     * 垂直分割面的数量
     */
    heightSegments: number;

    /**
     * 深度分割面的数量
     */
    depthSegments: number;

    /**
     * 设置朝前面的uv，不支持设置带有 widthSegments heightSegments depthSegments 的实例
     * @param uv uv数据，如 [[0, 1], [1, 1], [1, 0], [0, 0]]
     */
    setFrontUV(uv: number[][]): void;

    /**
     * 设置右侧面的uv，不支持设置带有 widthSegments heightSegments depthSegments 的实例
     * @param uv uv数据，如 [[0, 1], [1, 1], [1, 0], [0, 0]]
     */
    setRightUV(uv: number[][]): void;

    /**
     * 设置朝后面的uv，不支持设置带有 widthSegments heightSegments depthSegments 的实例
     * @param uv uv数据，如 [[0, 1], [1, 1], [1, 0], [0, 0]]
     */
    setBackUV(uv: number[][]): void;

    /**
     * 设置左侧面的uv，不支持设置带有 widthSegments heightSegments depthSegments 的实例
     * @param uv uv数据，如 [[0, 1], [1, 1], [1, 0], [0, 0]]
     */
    setLeftUV(uv: number[][]): void;

    /**
     * 设置顶部面的uv，不支持设置带有 widthSegments heightSegments depthSegments 的实例
     * @param uv uv数据，如 [[0, 1], [1, 1], [1, 0], [0, 0]]
     */
    setTopUV(uv: number[][]): void;

    /**
     * 设置底部面的uv，不支持设置带有 widthSegments heightSegments depthSegments 的实例
     * @param uv uv数据，如 [[0, 1], [1, 1], [1, 0], [0, 0]]
     */
    setBottomUV(uv: number[][]): void;

    /**
     * 设置所有面的uv，不支持设置带有 widthSegments heightSegments depthSegments 的实例
     * @param uv uv数据，如
     *        [<br>
     *        [[0, 1], [1, 1], [1, 0], [0, 0]],<br>
     *        [[0, 1], [1, 1], [1, 0], [0, 0]],<br>
     *        [[0, 1], [1, 1], [1, 0], [0, 0]],<br>
     *        [[0, 1], [1, 1], [1, 0], [0, 0]],<br>
     *        [[0, 1], [1, 1], [1, 0], [0, 0]],<br>
     *        [[0, 1], [1, 1], [1, 0], [0, 0]]<br>
     *        ]
     */
    setAllRectUV(uv: number[][][]): void;

    isGeometry: boolean;

    /**
     * 将三角形模式转换为线框模式，即 Material 中的 wireframe
     */
    convertToLinesMode(): void;

    /**
     * 平移
     * @param x
     * @param y
     * @param z
     */
    translate(x?: number, y?: number, z?: number): Geometry;

    /**
     * 缩放
     * @param x
     * @param y
     * @param z
     */
    scale(x?: number, y?: number, z?: number): Geometry;

    /**
     * 旋转
     * @param x 旋转角度x
     * @param y 旋转角度y
     * @param z 旋转角度z
     */
    rotate(x?: number, y?: number, z?: number): Geometry;

    /**
     * Transforms the geometry with a mat4.
     * @param mat4
     */
    transformMat4(mat4: Matrix4): Geometry;

    /**
     * 合并两个 geometry
     * @param geometry
     * @param matrix 合并的矩阵
     */
    merge(geometry: Geometry, matrix?: Matrix4): Geometry;

    /**
     * 添加顶点
     * @param points 顶点坐标，如 addPoints([x, y, z], [x, y, z])
     */
    addPoints(...points: number[]): void;

    /**
     * 添加顶点索引
     * @param indices 顶点索引，如 addIndices(0, 1, 2)
     */
    addIndices(...indices: number[]): void;

    /**
     * 添加一条线
     * @param p1 起点坐标，如 [x, y, z]
     * @param p2 终点坐标
     */
    addLine(p1: number[], p2: number[]): void;

    /**
     * 添加一个三角形 ABC
     * @param p1 点A，如 [x, y, z]
     * @param p2 点B
     * @param p3 点C
     */
    addFace(p1: number[], p2: number[], p3: number[]): void;

    /**
     * 添加一个矩形 ABCD
     * @param p1 点A，如 [x, y, z]
     * @param p2 点B
     * @param p3 点C
     * @param p4 点D
     */
    addRect(p1: number[], p2: number[], p3: number[], p4: number[]): void;

    /**
     * 设置顶点对应的uv坐标
     * @param start 开始的顶点索引
     * @param uvs uv坐标数据，如 [[0, 0], [1, 0]]
     */
    setVertexUV(start: number, uvs: number[][]): void;

    /**
     * 设置三角形ABC的uv
     * @param start 开始的顶点索引
     * @param p1 点A的uv，如 [0, 0]
     * @param p2 点B的uv
     * @param p3 点C的uv
     */
    setFaceUV(start: number, p1: number[], p2: number[], p3: number[]): void;

    /**
     * 设置矩形ABCD的uv
     * @param start 开始的顶点索引
     * @param p1 点A的uv，如 [0, 0]
     * @param p2 点B的uv
     * @param p3 点C的uv
     * @param p4 点D的uv
     */
    setRectUV(start: number, p1: number[], p2: number[], p3: number[], p4: number[]): void;

    /**
     * 获取指定matrix变化后的包围盒数据
     * @param matrix matrix 需要变换的矩阵
     * @param bounds 包围盒数据，传入的话会改变他
     */
    getBounds(matrix?: Matrix4, bounds?: Bounds): Bounds;

    /**
     * 获取本地包围盒
     * @param force 是否强制刷新
     */
    getLocalBounds(force?: boolean): Bounds;

    /**
     * 获取球面包围盒
     * @param matrix
     */
    getSphereBounds(matrix: Matrix4): Sphere;

    /**
     * 获取本地球面包围盒
     * @param force 是否强制刷新
     */
    getLocalSphereBounds(force?: boolean): Sphere;

    /**
     * 将 Geometry 转换成无 indices
     * @param verticesItemLen 转换结果的顶点数据的位数(3 or 4)，如果为4会补1
     */
    convertToNoIndices(verticesItemLen?: number): void;

    /**
     * clone当前Geometry
     */
    clone(): Geometry;

    /**
     * _raycast，子类可覆盖实现
     * @param ray
     * @param side
     */
    _raycast(ray: Ray, side: GLenum): Vector3[] | null;

    /**
     * raycast
     * @param ray
     * @param side
     * @param sort 是否按距离排序
     */
    raycast(ray: Ray, side: GLenum, sort?: boolean): Vector3[] | null;

  }

  class Geometry {
    /**
     * 几何体
     */
    constructor();

    /**
     * 
     * @param params 初始化参数，所有params都会复制到实例上
     */
    constructor(params?: Object);

    isGeometry: boolean;

    className: string;

    /**
     * 顶点数据
     */
    vertices: GeometryData;

    /**
     * uv 数据
     */
    uvs: GeometryData;

    /**
     * uv1 数据
     */
    uvs1: GeometryData;

    /**
     * color 数据
     */
    colors: GeometryData;

    /**
     * 顶点索引数据
     */
    indices: GeometryData;

    /**
     * 骨骼索引
     */
    skinIndices: GeometryData;

    /**
     * 骨骼权重数据
     */
    skinWeights: GeometryData;

    /**
     * 绘制模式
     */
    mode: number;

    /**
     * 是否是静态
     */
    isStatic: boolean;

    /**
     * 是否需要更新
     */
    isDirty: boolean;

    /**
     * id
     */
    id: string;

    /**
     * 法向量数据，如果没有的话会自动生成
     */
    normals: any;

    /**
     * 切线向量数据，如果没有的话会自动生成
     */
    tangents: any;

    /**
     * 切线向量数据，如果没有的话会自动生成
     */
    tangents1: any;

    /**
     * 将三角形模式转换为线框模式，即 Material 中的 wireframe
     */
    convertToLinesMode(): void;

    /**
     * 平移
     * @param x
     * @param y
     * @param z
     */
    translate(x?: number, y?: number, z?: number): Geometry;

    /**
     * 缩放
     * @param x
     * @param y
     * @param z
     */
    scale(x?: number, y?: number, z?: number): Geometry;

    /**
     * 旋转
     * @param x 旋转角度x
     * @param y 旋转角度y
     * @param z 旋转角度z
     */
    rotate(x?: number, y?: number, z?: number): Geometry;

    /**
     * Transforms the geometry with a mat4.
     * @param mat4
     */
    transformMat4(mat4: Matrix4): Geometry;

    /**
     * 合并两个 geometry
     * @param geometry
     * @param matrix 合并的矩阵
     */
    merge(geometry: Geometry, matrix?: Matrix4): Geometry;

    /**
     * 添加顶点
     * @param points 顶点坐标，如 addPoints([x, y, z], [x, y, z])
     */
    addPoints(...points: number[]): void;

    /**
     * 添加顶点索引
     * @param indices 顶点索引，如 addIndices(0, 1, 2)
     */
    addIndices(...indices: number[]): void;

    /**
     * 添加一条线
     * @param p1 起点坐标，如 [x, y, z]
     * @param p2 终点坐标
     */
    addLine(p1: number[], p2: number[]): void;

    /**
     * 添加一个三角形 ABC
     * @param p1 点A，如 [x, y, z]
     * @param p2 点B
     * @param p3 点C
     */
    addFace(p1: number[], p2: number[], p3: number[]): void;

    /**
     * 添加一个矩形 ABCD
     * @param p1 点A，如 [x, y, z]
     * @param p2 点B
     * @param p3 点C
     * @param p4 点D
     */
    addRect(p1: number[], p2: number[], p3: number[], p4: number[]): void;

    /**
     * 设置顶点对应的uv坐标
     * @param start 开始的顶点索引
     * @param uvs uv坐标数据，如 [[0, 0], [1, 0]]
     */
    setVertexUV(start: number, uvs: number[][]): void;

    /**
     * 设置三角形ABC的uv
     * @param start 开始的顶点索引
     * @param p1 点A的uv，如 [0, 0]
     * @param p2 点B的uv
     * @param p3 点C的uv
     */
    setFaceUV(start: number, p1: number[], p2: number[], p3: number[]): void;

    /**
     * 设置矩形ABCD的uv
     * @param start 开始的顶点索引
     * @param p1 点A的uv，如 [0, 0]
     * @param p2 点B的uv
     * @param p3 点C的uv
     * @param p4 点D的uv
     */
    setRectUV(start: number, p1: number[], p2: number[], p3: number[], p4: number[]): void;

    /**
     * 获取指定matrix变化后的包围盒数据
     * @param matrix matrix 需要变换的矩阵
     * @param bounds 包围盒数据，传入的话会改变他
     */
    getBounds(matrix?: Matrix4, bounds?: Bounds): Bounds;

    /**
     * 获取本地包围盒
     * @param force 是否强制刷新
     */
    getLocalBounds(force?: boolean): Bounds;

    /**
     * 获取球面包围盒
     * @param matrix
     */
    getSphereBounds(matrix: Matrix4): Sphere;

    /**
     * 获取本地球面包围盒
     * @param force 是否强制刷新
     */
    getLocalSphereBounds(force?: boolean): Sphere;

    /**
     * 将 Geometry 转换成无 indices
     * @param verticesItemLen 转换结果的顶点数据的位数(3 or 4)，如果为4会补1
     */
    convertToNoIndices(verticesItemLen?: number): void;

    /**
     * clone当前Geometry
     */
    clone(): Geometry;

    /**
     * _raycast，子类可覆盖实现
     * @param ray
     * @param side
     */
    _raycast(ray: Ray, side: GLenum): Vector3[] | null;

    /**
     * raycast
     * @param ray
     * @param side
     * @param sort 是否按距离排序
     */
    raycast(ray: Ray, side: GLenum, sort?: boolean): Vector3[] | null;

  }

  class GeometryData {
    /**
     * geometry vertex data
     */
    constructor();

    /**
     * 
     * @param data 数据
     * @param size The number of components per vertex attribute.Must be 1, 2, 3, or 4.
     * @param params 初始化参数，所有params都会复制到实例上
     */
    constructor(data: any, size: number, params: Object);

    /**
     * The number of components per vertex attribute.Must be 1, 2, 3, or 4.
     */
    size: number;

    /**
     * Whether integer data values should be normalized when being casted to a float.
     */
    normalized: boolean;

    /**
     * The data type of each component in the array.
     */
    type: GLenum;

    isDirty: boolean;

    bufferViewId: string;

    /**
     * id
     */
    id: string;

    data: any;

    /**
     * The offset in bytes between the beginning of consecutive vertex attributes.
     */
    stride: number;

    /**
     * An offset in bytes of the first component in the vertex attribute array. Must be a multiple of type.
     */
    offset: number;

    readonly length: number;

    readonly realLength: number;

    readonly count: number;

    /**
     * clone
     */
    clone(): GeometryData;

    /**
     * copy
     * @param geometryData
     */
    copy(geometryData: GeometryData): void;

    /**
     * 获取偏移值
     * @param index
     */
    getOffset(index: number): number;

    /**
     * 获取值
     * @param index
     */
    get(index: number): number | Vector2 | Vector3 | Vector4;

    /**
     * 设置值
     * @param index
     * @param value
     */
    set(index: number, value: number | Vector2 | Vector3 | Vector4): void;

    /**
     * 根据 offset 获取值
     * @param offset
     */
    getByOffset(offset: number): number | Vector2 | Vector3 | Vector4;

    /**
     * 根据 offset 设置值
     * @param offset
     * @param value
     */
    setByOffset(offset: number, value: number | Vector2 | Vector3 | Vector4): void;

    /**
     * 按 index 遍历
     * @param callback(attribute, index, offset)
     */
    traverse(callback: (attribute, index, offset) => any): boolean;

    /**
     * 按 Component 遍历 Component
     * @param callback(data, offset)
     */
    traverseByComponent(callback: (data, offset) => any): boolean;

  }

  class MorphGeometry extends Geometry {
    /**
     * Morph几何体
     */
    constructor();

    /**
     * 
     * @param params 创建对象的属性参数。可包含此类的所有属性。
     */
    constructor(params: {
      /**
       * morph animation weights
       */
      weights?: number[];

      /**
       * like:
       * {
       * vertices: [Target1GeometryData, Target2GeometryData, ...],
       * normals: [Target1GeometryData, Target2GeometryData, ...],
       * tangents: [Target1GeometryData, Target2GeometryData, ...]
       * }
       */
      targets?: {[attributes: string]: GeometryData[]};
    });

    isMorphGeometry: boolean;

    className: string;

    /**
     * morph animation weights
     */
    weights: number[];

    /**
     * like:
     * {
     * vertices: [[], []],
     * normals: [[], []],
     * tangents: [[], []]
     * }
     */
    targets: {[attributes: string]: number[][]};

    isGeometry: boolean;

    /**
     * 顶点数据
     */
    vertices: GeometryData;

    /**
     * uv 数据
     */
    uvs: GeometryData;

    /**
     * uv1 数据
     */
    uvs1: GeometryData;

    /**
     * color 数据
     */
    colors: GeometryData;

    /**
     * 顶点索引数据
     */
    indices: GeometryData;

    /**
     * 骨骼索引
     */
    skinIndices: GeometryData;

    /**
     * 骨骼权重数据
     */
    skinWeights: GeometryData;

    /**
     * 绘制模式
     */
    mode: number;

    /**
     * 是否是静态
     */
    isStatic: boolean;

    /**
     * 是否需要更新
     */
    isDirty: boolean;

    /**
     * id
     */
    id: string;

    /**
     * 法向量数据，如果没有的话会自动生成
     */
    normals: any;

    /**
     * 切线向量数据，如果没有的话会自动生成
     */
    tangents: any;

    /**
     * 切线向量数据，如果没有的话会自动生成
     */
    tangents1: any;

    /**
     * 将三角形模式转换为线框模式，即 Material 中的 wireframe
     */
    convertToLinesMode(): void;

    /**
     * 平移
     * @param x
     * @param y
     * @param z
     */
    translate(x?: number, y?: number, z?: number): Geometry;

    /**
     * 缩放
     * @param x
     * @param y
     * @param z
     */
    scale(x?: number, y?: number, z?: number): Geometry;

    /**
     * 旋转
     * @param x 旋转角度x
     * @param y 旋转角度y
     * @param z 旋转角度z
     */
    rotate(x?: number, y?: number, z?: number): Geometry;

    /**
     * Transforms the geometry with a mat4.
     * @param mat4
     */
    transformMat4(mat4: Matrix4): Geometry;

    /**
     * 合并两个 geometry
     * @param geometry
     * @param matrix 合并的矩阵
     */
    merge(geometry: Geometry, matrix?: Matrix4): Geometry;

    /**
     * 添加顶点
     * @param points 顶点坐标，如 addPoints([x, y, z], [x, y, z])
     */
    addPoints(...points: number[]): void;

    /**
     * 添加顶点索引
     * @param indices 顶点索引，如 addIndices(0, 1, 2)
     */
    addIndices(...indices: number[]): void;

    /**
     * 添加一条线
     * @param p1 起点坐标，如 [x, y, z]
     * @param p2 终点坐标
     */
    addLine(p1: number[], p2: number[]): void;

    /**
     * 添加一个三角形 ABC
     * @param p1 点A，如 [x, y, z]
     * @param p2 点B
     * @param p3 点C
     */
    addFace(p1: number[], p2: number[], p3: number[]): void;

    /**
     * 添加一个矩形 ABCD
     * @param p1 点A，如 [x, y, z]
     * @param p2 点B
     * @param p3 点C
     * @param p4 点D
     */
    addRect(p1: number[], p2: number[], p3: number[], p4: number[]): void;

    /**
     * 设置顶点对应的uv坐标
     * @param start 开始的顶点索引
     * @param uvs uv坐标数据，如 [[0, 0], [1, 0]]
     */
    setVertexUV(start: number, uvs: number[][]): void;

    /**
     * 设置三角形ABC的uv
     * @param start 开始的顶点索引
     * @param p1 点A的uv，如 [0, 0]
     * @param p2 点B的uv
     * @param p3 点C的uv
     */
    setFaceUV(start: number, p1: number[], p2: number[], p3: number[]): void;

    /**
     * 设置矩形ABCD的uv
     * @param start 开始的顶点索引
     * @param p1 点A的uv，如 [0, 0]
     * @param p2 点B的uv
     * @param p3 点C的uv
     * @param p4 点D的uv
     */
    setRectUV(start: number, p1: number[], p2: number[], p3: number[], p4: number[]): void;

    /**
     * 获取指定matrix变化后的包围盒数据
     * @param matrix matrix 需要变换的矩阵
     * @param bounds 包围盒数据，传入的话会改变他
     */
    getBounds(matrix?: Matrix4, bounds?: Bounds): Bounds;

    /**
     * 获取本地包围盒
     * @param force 是否强制刷新
     */
    getLocalBounds(force?: boolean): Bounds;

    /**
     * 获取球面包围盒
     * @param matrix
     */
    getSphereBounds(matrix: Matrix4): Sphere;

    /**
     * 获取本地球面包围盒
     * @param force 是否强制刷新
     */
    getLocalSphereBounds(force?: boolean): Sphere;

    /**
     * 将 Geometry 转换成无 indices
     * @param verticesItemLen 转换结果的顶点数据的位数(3 or 4)，如果为4会补1
     */
    convertToNoIndices(verticesItemLen?: number): void;

    /**
     * clone当前Geometry
     */
    clone(): Geometry;

    /**
     * _raycast，子类可覆盖实现
     * @param ray
     * @param side
     */
    _raycast(ray: Ray, side: GLenum): Vector3[] | null;

    /**
     * raycast
     * @param ray
     * @param side
     * @param sort 是否按距离排序
     */
    raycast(ray: Ray, side: GLenum, sort?: boolean): Vector3[] | null;

  }

  class PlaneGeometry extends Geometry {
    /**
     * 平面几何体
     */
    constructor();

    /**
     * 
     * @param params 创建对象的属性参数。可包含此类的所有属性。
     */
    constructor(params: {
      /**
       * 宽度
       */
      width?: number;

      /**
       * 高度
       */
      height?: number;

      /**
       * 水平分割面的数量
       */
      widthSegments?: number;

      /**
       * 垂直分割面的数量
       */
      heightSegments?: number;
    });

    isPlaneGeometry: boolean;

    className: string;

    /**
     * 宽度
     */
    width: number;

    /**
     * 高度
     */
    height: number;

    /**
     * 水平分割面的数量
     */
    widthSegments: number;

    /**
     * 垂直分割面的数量
     */
    heightSegments: number;

    isGeometry: boolean;

    /**
     * 顶点数据
     */
    vertices: GeometryData;

    /**
     * uv 数据
     */
    uvs: GeometryData;

    /**
     * uv1 数据
     */
    uvs1: GeometryData;

    /**
     * color 数据
     */
    colors: GeometryData;

    /**
     * 顶点索引数据
     */
    indices: GeometryData;

    /**
     * 骨骼索引
     */
    skinIndices: GeometryData;

    /**
     * 骨骼权重数据
     */
    skinWeights: GeometryData;

    /**
     * 绘制模式
     */
    mode: number;

    /**
     * 是否是静态
     */
    isStatic: boolean;

    /**
     * 是否需要更新
     */
    isDirty: boolean;

    /**
     * id
     */
    id: string;

    /**
     * 法向量数据，如果没有的话会自动生成
     */
    normals: any;

    /**
     * 切线向量数据，如果没有的话会自动生成
     */
    tangents: any;

    /**
     * 切线向量数据，如果没有的话会自动生成
     */
    tangents1: any;

    /**
     * 将三角形模式转换为线框模式，即 Material 中的 wireframe
     */
    convertToLinesMode(): void;

    /**
     * 平移
     * @param x
     * @param y
     * @param z
     */
    translate(x?: number, y?: number, z?: number): Geometry;

    /**
     * 缩放
     * @param x
     * @param y
     * @param z
     */
    scale(x?: number, y?: number, z?: number): Geometry;

    /**
     * 旋转
     * @param x 旋转角度x
     * @param y 旋转角度y
     * @param z 旋转角度z
     */
    rotate(x?: number, y?: number, z?: number): Geometry;

    /**
     * Transforms the geometry with a mat4.
     * @param mat4
     */
    transformMat4(mat4: Matrix4): Geometry;

    /**
     * 合并两个 geometry
     * @param geometry
     * @param matrix 合并的矩阵
     */
    merge(geometry: Geometry, matrix?: Matrix4): Geometry;

    /**
     * 添加顶点
     * @param points 顶点坐标，如 addPoints([x, y, z], [x, y, z])
     */
    addPoints(...points: number[]): void;

    /**
     * 添加顶点索引
     * @param indices 顶点索引，如 addIndices(0, 1, 2)
     */
    addIndices(...indices: number[]): void;

    /**
     * 添加一条线
     * @param p1 起点坐标，如 [x, y, z]
     * @param p2 终点坐标
     */
    addLine(p1: number[], p2: number[]): void;

    /**
     * 添加一个三角形 ABC
     * @param p1 点A，如 [x, y, z]
     * @param p2 点B
     * @param p3 点C
     */
    addFace(p1: number[], p2: number[], p3: number[]): void;

    /**
     * 添加一个矩形 ABCD
     * @param p1 点A，如 [x, y, z]
     * @param p2 点B
     * @param p3 点C
     * @param p4 点D
     */
    addRect(p1: number[], p2: number[], p3: number[], p4: number[]): void;

    /**
     * 设置顶点对应的uv坐标
     * @param start 开始的顶点索引
     * @param uvs uv坐标数据，如 [[0, 0], [1, 0]]
     */
    setVertexUV(start: number, uvs: number[][]): void;

    /**
     * 设置三角形ABC的uv
     * @param start 开始的顶点索引
     * @param p1 点A的uv，如 [0, 0]
     * @param p2 点B的uv
     * @param p3 点C的uv
     */
    setFaceUV(start: number, p1: number[], p2: number[], p3: number[]): void;

    /**
     * 设置矩形ABCD的uv
     * @param start 开始的顶点索引
     * @param p1 点A的uv，如 [0, 0]
     * @param p2 点B的uv
     * @param p3 点C的uv
     * @param p4 点D的uv
     */
    setRectUV(start: number, p1: number[], p2: number[], p3: number[], p4: number[]): void;

    /**
     * 获取指定matrix变化后的包围盒数据
     * @param matrix matrix 需要变换的矩阵
     * @param bounds 包围盒数据，传入的话会改变他
     */
    getBounds(matrix?: Matrix4, bounds?: Bounds): Bounds;

    /**
     * 获取本地包围盒
     * @param force 是否强制刷新
     */
    getLocalBounds(force?: boolean): Bounds;

    /**
     * 获取球面包围盒
     * @param matrix
     */
    getSphereBounds(matrix: Matrix4): Sphere;

    /**
     * 获取本地球面包围盒
     * @param force 是否强制刷新
     */
    getLocalSphereBounds(force?: boolean): Sphere;

    /**
     * 将 Geometry 转换成无 indices
     * @param verticesItemLen 转换结果的顶点数据的位数(3 or 4)，如果为4会补1
     */
    convertToNoIndices(verticesItemLen?: number): void;

    /**
     * clone当前Geometry
     */
    clone(): Geometry;

    /**
     * _raycast，子类可覆盖实现
     * @param ray
     * @param side
     */
    _raycast(ray: Ray, side: GLenum): Vector3[] | null;

    /**
     * raycast
     * @param ray
     * @param side
     * @param sort 是否按距离排序
     */
    raycast(ray: Ray, side: GLenum, sort?: boolean): Vector3[] | null;

  }

  class SphereGeometry extends Geometry {
    /**
     * 球形几何体
     */
    constructor();

    /**
     * 
     * @param params 创建对象的属性参数。可包含此类的所有属性。
     */
    constructor(params: {
      /**
       * 半径
       */
      radius?: number;

      /**
       * 垂直分割面的数量
       */
      heightSegments?: number;

      /**
       * 水平分割面的数量
       */
      widthSegments?: number;
    });

    isSphereGeometry: boolean;

    className: string;

    /**
     * 半径
     */
    radius: number;

    /**
     * 垂直分割面的数量
     */
    heightSegments: number;

    /**
     * 水平分割面的数量
     */
    widthSegments: number;

    isGeometry: boolean;

    /**
     * 顶点数据
     */
    vertices: GeometryData;

    /**
     * uv 数据
     */
    uvs: GeometryData;

    /**
     * uv1 数据
     */
    uvs1: GeometryData;

    /**
     * color 数据
     */
    colors: GeometryData;

    /**
     * 顶点索引数据
     */
    indices: GeometryData;

    /**
     * 骨骼索引
     */
    skinIndices: GeometryData;

    /**
     * 骨骼权重数据
     */
    skinWeights: GeometryData;

    /**
     * 绘制模式
     */
    mode: number;

    /**
     * 是否是静态
     */
    isStatic: boolean;

    /**
     * 是否需要更新
     */
    isDirty: boolean;

    /**
     * id
     */
    id: string;

    /**
     * 法向量数据，如果没有的话会自动生成
     */
    normals: any;

    /**
     * 切线向量数据，如果没有的话会自动生成
     */
    tangents: any;

    /**
     * 切线向量数据，如果没有的话会自动生成
     */
    tangents1: any;

    /**
     * 将三角形模式转换为线框模式，即 Material 中的 wireframe
     */
    convertToLinesMode(): void;

    /**
     * 平移
     * @param x
     * @param y
     * @param z
     */
    translate(x?: number, y?: number, z?: number): Geometry;

    /**
     * 缩放
     * @param x
     * @param y
     * @param z
     */
    scale(x?: number, y?: number, z?: number): Geometry;

    /**
     * 旋转
     * @param x 旋转角度x
     * @param y 旋转角度y
     * @param z 旋转角度z
     */
    rotate(x?: number, y?: number, z?: number): Geometry;

    /**
     * Transforms the geometry with a mat4.
     * @param mat4
     */
    transformMat4(mat4: Matrix4): Geometry;

    /**
     * 合并两个 geometry
     * @param geometry
     * @param matrix 合并的矩阵
     */
    merge(geometry: Geometry, matrix?: Matrix4): Geometry;

    /**
     * 添加顶点
     * @param points 顶点坐标，如 addPoints([x, y, z], [x, y, z])
     */
    addPoints(...points: number[]): void;

    /**
     * 添加顶点索引
     * @param indices 顶点索引，如 addIndices(0, 1, 2)
     */
    addIndices(...indices: number[]): void;

    /**
     * 添加一条线
     * @param p1 起点坐标，如 [x, y, z]
     * @param p2 终点坐标
     */
    addLine(p1: number[], p2: number[]): void;

    /**
     * 添加一个三角形 ABC
     * @param p1 点A，如 [x, y, z]
     * @param p2 点B
     * @param p3 点C
     */
    addFace(p1: number[], p2: number[], p3: number[]): void;

    /**
     * 添加一个矩形 ABCD
     * @param p1 点A，如 [x, y, z]
     * @param p2 点B
     * @param p3 点C
     * @param p4 点D
     */
    addRect(p1: number[], p2: number[], p3: number[], p4: number[]): void;

    /**
     * 设置顶点对应的uv坐标
     * @param start 开始的顶点索引
     * @param uvs uv坐标数据，如 [[0, 0], [1, 0]]
     */
    setVertexUV(start: number, uvs: number[][]): void;

    /**
     * 设置三角形ABC的uv
     * @param start 开始的顶点索引
     * @param p1 点A的uv，如 [0, 0]
     * @param p2 点B的uv
     * @param p3 点C的uv
     */
    setFaceUV(start: number, p1: number[], p2: number[], p3: number[]): void;

    /**
     * 设置矩形ABCD的uv
     * @param start 开始的顶点索引
     * @param p1 点A的uv，如 [0, 0]
     * @param p2 点B的uv
     * @param p3 点C的uv
     * @param p4 点D的uv
     */
    setRectUV(start: number, p1: number[], p2: number[], p3: number[], p4: number[]): void;

    /**
     * 获取指定matrix变化后的包围盒数据
     * @param matrix matrix 需要变换的矩阵
     * @param bounds 包围盒数据，传入的话会改变他
     */
    getBounds(matrix?: Matrix4, bounds?: Bounds): Bounds;

    /**
     * 获取本地包围盒
     * @param force 是否强制刷新
     */
    getLocalBounds(force?: boolean): Bounds;

    /**
     * 获取球面包围盒
     * @param matrix
     */
    getSphereBounds(matrix: Matrix4): Sphere;

    /**
     * 获取本地球面包围盒
     * @param force 是否强制刷新
     */
    getLocalSphereBounds(force?: boolean): Sphere;

    /**
     * 将 Geometry 转换成无 indices
     * @param verticesItemLen 转换结果的顶点数据的位数(3 or 4)，如果为4会补1
     */
    convertToNoIndices(verticesItemLen?: number): void;

    /**
     * clone当前Geometry
     */
    clone(): Geometry;

    /**
     * _raycast，子类可覆盖实现
     * @param ray
     * @param side
     */
    _raycast(ray: Ray, side: GLenum): Vector3[] | null;

    /**
     * raycast
     * @param ray
     * @param side
     * @param sort 是否按距离排序
     */
    raycast(ray: Ray, side: GLenum, sort?: boolean): Vector3[] | null;

  }

  class AxisHelper {
    /**
     * 坐标轴帮助类
     */
    constructor();

    /**
     * 
     * @param params 初始化参数
     */
    constructor(params?: Object);

    isAxisHelper: boolean;

    className: string;

    /**
     * 坐标轴的长度，不可变更，需要变可以通过设置 scale
     */
    size: number;

    isNode: boolean;

    /**
     * Node 的名字，可以通过 getChildByName 查找
     */
    name: string;

    /**
     * animation 查找 id
     */
    animationId: number;

    /**
     * 是否自动更新世界矩阵
     */
    autoUpdateWorldMatrix: boolean;

    /**
     * 父节点
     */
    parent: Node;

    /**
     * 每次更新的时候是否调用子节点的 onUpdate 方法
     */
    needCallChildUpdate: boolean;

    /**
     * 节点是否显示
     */
    visible: boolean;

    /**
     * 可视对象是否接受交互事件。默认为接受交互事件，即true。
     */
    pointerEnabled: boolean;

    /**
     * 子元素是否接受交互事件。
     */
    pointerChildren: boolean;

    /**
     * 是否用鼠标指针
     */
    useHandCursor: boolean;

    id: string;

    /**
     * 元素的up向量
     */
    up: Vector3;

    /**
     * 元素直接点数组
     */
    children: Node[];

    /**
     * 元素的世界矩阵
     */
    worldMatrix: Matrix4;

    /**
     * 
     * @param isChild 是否子节点，子节点不会处理动画及骨骼Mesh，即如果有动画将共享
     */
    clone(isChild?: boolean): Node;

    /**
     * 设置节点的动画，这个需要是模型的根节点
     * @param anim 动画实例
     */
    setAnim(anim: Animation): Node;

    /**
     * 重置子孙元素中 SkinedMesh 的根节点为当前元素
     */
    resetSkinedMeshRootNode(): void;

    /**
     * 将所以子孙元素放到一个对象中，对象key为元素的name，value为该元素
     */
    getChildrenNameMap(): Object;

    /**
     * 添加一个子元素
     * @param child 需要添加的子元素
     */
    addChild(child: Node): Node;

    /**
     * 移除指定的子元素
     * @param child 需要移除的元素
     */
    removeChild(child: Node): Node;

    /**
     * 将当前元素添加到某个父元素的子元素中
     * @param parent 需要添加到的父元素
     */
    addTo(parent: Node | Stage): Node;

    /**
     * 将当前元素从其父元素中移除
     */
    removeFromParent(): Node;

    /**
     * 更新本地矩阵
     */
    updateMatrix(): Node;

    /**
     * 更新transform属性
     */
    updateTransform(): Node;

    /**
     * 更新世界矩阵
     * @param force 是否强制更新
     */
    updateMatrixWorld(force?: boolean): Node;

    /**
     * 获取当前元素相对于指定元素的矩阵
     * @param ancestor 相对于的元素，需要是当前元素的祖先元素，不传表示获取世界矩阵
     */
    getConcatenatedMatrix(ancestor?: Node): Matrix4;

    /**
     * 遍历当前元素的子孙元素
     * @param callback 每个元素都会调用这个函数处理
     * @param onlyChild 是否只遍历子元素
     */
    traverse(callback: Function, onlyChild?: boolean): Node;

    /**
     * 遍历调用子孙元素onUpdate方法
     * @param dt
     */
    traverseUpdate(dt: number): Node;

    /**
     * 根据函数来获取一个子孙元素
     * @param fn 判读函数
     */
    getChildByFn(fn: Function): Node | null;

    /**
     * 根据函数来获取匹配的所有子孙元素
     * @param fn 判读函数
     */
    getChildrenByFn(fn: Function): Node[];

    /**
     * 获取指定name的首个子孙元素
     * @param name 元素name
     */
    getChildByName(name: string): Node | null;

    /**
     * 获取指定name的所有子孙元素
     * @param name 元素name
     */
    getChildrenByName(name: string): Node[];

    /**
     * 获取指定id的子孙元素
     * @param id 元素id
     */
    getChildById(id: string): Node | null;

    /**
     * 获取指定类名的所有子孙元素
     * @param className 类名
     */
    getChildrenByClassName(className: string): Node[];

    /**
     * 设置元素的缩放比例
     * @param x X缩放比例
     * @param y Y缩放比例
     * @param z Z缩放比例
     */
    setScale(x: number, y: number, z: number): Node;

    /**
     * 设置元素的位置
     * @param x X方向位置
     * @param y Y方向位置
     * @param z Z方向位置
     */
    setPosition(x: number, y: number, z: number): Node;

    /**
     * 设置元素的旋转
     * @param x X轴旋转角度
     * @param y Y轴旋转角度
     * @param z Z轴旋转角度
     */
    setRotation(x: number, y: number, z: number): Node;

    /**
     * 设置中心点
     * @param x 中心点x
     * @param y 中心点y
     * @param z 中心点z
     */
    setPivot(x: number, y: number, z: number): Node;

    /**
     * 改变元素的朝向
     * @param node 需要朝向的元素，或者坐标
     */
    lookAt(node: Node | Object | Vector3): Node;
    onUpdate(escapeTime: number): any;

    /**
     * raycast
     * @param ray
     * @param sort 是否按距离排序
     * @param eventMode 是否事件模式
     */
    raycast(ray: Ray, sort?: boolean, eventMode?: boolean): raycastInfo[] | null;

    /**
     * 元素的矩阵
     */
    matrix: Matrix4;

    /**
     * x轴坐标
     */
    x: number;

    /**
     * y轴坐标
     */
    y: number;

    /**
     * z轴坐标
     */
    z: number;

    /**
     * 缩放比例x
     */
    scaleX: number;

    /**
     * 缩放比例y
     */
    scaleY: number;

    /**
     * 缩放比例z
     */
    scaleZ: number;

    /**
     * 旋转角度x
     */
    rotationX: number;

    /**
     * 旋转角度y
     */
    rotationY: number;

    /**
     * 旋转角度z
     */
    rotationZ: number;

    /**
     * 中心点x
     */
    pivotX: number;

    /**
     * 中心点y
     */
    pivotY: number;

    /**
     * 中心点z
     */
    pivotZ: number;

    /**
     * 四元数角度
     */
    quaternion: Quaternion;

    /**
     * 获取元素的包围盒信息
     * @param parent 元素相对于哪个祖先元素的包围盒，不传表示世界
     * @param currentMatrix 当前计算的矩阵
     * @param bounds 当前计算的包围盒信息
     */
    getBounds(parent?: Node, currentMatrix?: Matrix4, bounds?: Bounds): Bounds;

  }

  class AxisNetHelper {
    /**
     * 网格帮助类
     */
    constructor();

    /**
     * 
     * @param params 初始化参数
     */
    constructor(params?: Object);

    isAxisNetHelper: boolean;

    className: string;

    /**
     * 网格线数量的一半(类似圆的半径)
     */
    size: number;

    /**
     * 颜色
     */
    color: Color;

    isMesh: boolean;

    geometry: Geometry;

    material: Material;

    /**
     * 是否支持 Instanced
     */
    useInstanced: boolean;

    /**
     * 是否开启视锥体裁剪
     */
    frustumTest: boolean;

    /**
     * clone 当前mesh
     * @param isChild 是否子元素
     */
    clone(isChild: boolean): Mesh;

    /**
     * raycast
     * @param ray
     * @param sort 是否按距离排序
     */
    raycast(ray: Ray, sort?: boolean): Vector3[] | null;

    isNode: boolean;

    /**
     * Node 的名字，可以通过 getChildByName 查找
     */
    name: string;

    /**
     * animation 查找 id
     */
    animationId: number;

    /**
     * 是否自动更新世界矩阵
     */
    autoUpdateWorldMatrix: boolean;

    /**
     * 父节点
     */
    parent: Node;

    /**
     * 每次更新的时候是否调用子节点的 onUpdate 方法
     */
    needCallChildUpdate: boolean;

    /**
     * 节点是否显示
     */
    visible: boolean;

    /**
     * 可视对象是否接受交互事件。默认为接受交互事件，即true。
     */
    pointerEnabled: boolean;

    /**
     * 子元素是否接受交互事件。
     */
    pointerChildren: boolean;

    /**
     * 是否用鼠标指针
     */
    useHandCursor: boolean;

    id: string;

    /**
     * 元素的up向量
     */
    up: Vector3;

    /**
     * 元素直接点数组
     */
    children: Node[];

    /**
     * 元素的世界矩阵
     */
    worldMatrix: Matrix4;

    /**
     * 设置节点的动画，这个需要是模型的根节点
     * @param anim 动画实例
     */
    setAnim(anim: Animation): Node;

    /**
     * 重置子孙元素中 SkinedMesh 的根节点为当前元素
     */
    resetSkinedMeshRootNode(): void;

    /**
     * 将所以子孙元素放到一个对象中，对象key为元素的name，value为该元素
     */
    getChildrenNameMap(): Object;

    /**
     * 添加一个子元素
     * @param child 需要添加的子元素
     */
    addChild(child: Node): Node;

    /**
     * 移除指定的子元素
     * @param child 需要移除的元素
     */
    removeChild(child: Node): Node;

    /**
     * 将当前元素添加到某个父元素的子元素中
     * @param parent 需要添加到的父元素
     */
    addTo(parent: Node | Stage): Node;

    /**
     * 将当前元素从其父元素中移除
     */
    removeFromParent(): Node;

    /**
     * 更新本地矩阵
     */
    updateMatrix(): Node;

    /**
     * 更新transform属性
     */
    updateTransform(): Node;

    /**
     * 更新世界矩阵
     * @param force 是否强制更新
     */
    updateMatrixWorld(force?: boolean): Node;

    /**
     * 获取当前元素相对于指定元素的矩阵
     * @param ancestor 相对于的元素，需要是当前元素的祖先元素，不传表示获取世界矩阵
     */
    getConcatenatedMatrix(ancestor?: Node): Matrix4;

    /**
     * 遍历当前元素的子孙元素
     * @param callback 每个元素都会调用这个函数处理
     * @param onlyChild 是否只遍历子元素
     */
    traverse(callback: Function, onlyChild?: boolean): Node;

    /**
     * 遍历调用子孙元素onUpdate方法
     * @param dt
     */
    traverseUpdate(dt: number): Node;

    /**
     * 根据函数来获取一个子孙元素
     * @param fn 判读函数
     */
    getChildByFn(fn: Function): Node | null;

    /**
     * 根据函数来获取匹配的所有子孙元素
     * @param fn 判读函数
     */
    getChildrenByFn(fn: Function): Node[];

    /**
     * 获取指定name的首个子孙元素
     * @param name 元素name
     */
    getChildByName(name: string): Node | null;

    /**
     * 获取指定name的所有子孙元素
     * @param name 元素name
     */
    getChildrenByName(name: string): Node[];

    /**
     * 获取指定id的子孙元素
     * @param id 元素id
     */
    getChildById(id: string): Node | null;

    /**
     * 获取指定类名的所有子孙元素
     * @param className 类名
     */
    getChildrenByClassName(className: string): Node[];

    /**
     * 设置元素的缩放比例
     * @param x X缩放比例
     * @param y Y缩放比例
     * @param z Z缩放比例
     */
    setScale(x: number, y: number, z: number): Node;

    /**
     * 设置元素的位置
     * @param x X方向位置
     * @param y Y方向位置
     * @param z Z方向位置
     */
    setPosition(x: number, y: number, z: number): Node;

    /**
     * 设置元素的旋转
     * @param x X轴旋转角度
     * @param y Y轴旋转角度
     * @param z Z轴旋转角度
     */
    setRotation(x: number, y: number, z: number): Node;

    /**
     * 设置中心点
     * @param x 中心点x
     * @param y 中心点y
     * @param z 中心点z
     */
    setPivot(x: number, y: number, z: number): Node;

    /**
     * 改变元素的朝向
     * @param node 需要朝向的元素，或者坐标
     */
    lookAt(node: Node | Object | Vector3): Node;
    onUpdate(escapeTime: number): any;

    /**
     * 元素的矩阵
     */
    matrix: Matrix4;

    /**
     * x轴坐标
     */
    x: number;

    /**
     * y轴坐标
     */
    y: number;

    /**
     * z轴坐标
     */
    z: number;

    /**
     * 缩放比例x
     */
    scaleX: number;

    /**
     * 缩放比例y
     */
    scaleY: number;

    /**
     * 缩放比例z
     */
    scaleZ: number;

    /**
     * 旋转角度x
     */
    rotationX: number;

    /**
     * 旋转角度y
     */
    rotationY: number;

    /**
     * 旋转角度z
     */
    rotationZ: number;

    /**
     * 中心点x
     */
    pivotX: number;

    /**
     * 中心点y
     */
    pivotY: number;

    /**
     * 中心点z
     */
    pivotZ: number;

    /**
     * 四元数角度
     */
    quaternion: Quaternion;

    /**
     * 获取元素的包围盒信息
     * @param parent 元素相对于哪个祖先元素的包围盒，不传表示世界
     * @param currentMatrix 当前计算的矩阵
     * @param bounds 当前计算的包围盒信息
     */
    getBounds(parent?: Node, currentMatrix?: Matrix4, bounds?: Bounds): Bounds;

  }

  interface ICameraHelperParams extends ITransformAttributes {
    /**
     * 颜色
     */
    color?: Color;

    geometry?: Geometry;

    material?: Material;

    /**
     * 是否支持 Instanced
     */
    useInstanced?: boolean;

    /**
     * 是否开启视锥体裁剪
     */
    frustumTest?: boolean;
  }
  class CameraHelper {
    /**
     * 摄像机帮助类
     */
    constructor();

    /**
     * 
     * @param params 初始化参数
     */
    constructor(params: ICameraHelperParams);

    isCameraHelper: boolean;

    className: string;

    /**
     * 颜色
     */
    color: Color;

    isMesh: boolean;

    geometry: Geometry;

    material: Material;

    /**
     * 是否支持 Instanced
     */
    useInstanced: boolean;

    /**
     * 是否开启视锥体裁剪
     */
    frustumTest: boolean;

    /**
     * clone 当前mesh
     * @param isChild 是否子元素
     */
    clone(isChild: boolean): Mesh;

    /**
     * raycast
     * @param ray
     * @param sort 是否按距离排序
     */
    raycast(ray: Ray, sort?: boolean): Vector3[] | null;

    isNode: boolean;

    /**
     * Node 的名字，可以通过 getChildByName 查找
     */
    name: string;

    /**
     * animation 查找 id
     */
    animationId: number;

    /**
     * 是否自动更新世界矩阵
     */
    autoUpdateWorldMatrix: boolean;

    /**
     * 父节点
     */
    parent: Node;

    /**
     * 每次更新的时候是否调用子节点的 onUpdate 方法
     */
    needCallChildUpdate: boolean;

    /**
     * 节点是否显示
     */
    visible: boolean;

    /**
     * 可视对象是否接受交互事件。默认为接受交互事件，即true。
     */
    pointerEnabled: boolean;

    /**
     * 子元素是否接受交互事件。
     */
    pointerChildren: boolean;

    /**
     * 是否用鼠标指针
     */
    useHandCursor: boolean;

    id: string;

    /**
     * 元素的up向量
     */
    up: Vector3;

    /**
     * 元素直接点数组
     */
    children: Node[];

    /**
     * 元素的世界矩阵
     */
    worldMatrix: Matrix4;

    /**
     * 设置节点的动画，这个需要是模型的根节点
     * @param anim 动画实例
     */
    setAnim(anim: Animation): Node;

    /**
     * 重置子孙元素中 SkinedMesh 的根节点为当前元素
     */
    resetSkinedMeshRootNode(): void;

    /**
     * 将所以子孙元素放到一个对象中，对象key为元素的name，value为该元素
     */
    getChildrenNameMap(): Object;

    /**
     * 添加一个子元素
     * @param child 需要添加的子元素
     */
    addChild(child: Node): Node;

    /**
     * 移除指定的子元素
     * @param child 需要移除的元素
     */
    removeChild(child: Node): Node;

    /**
     * 将当前元素添加到某个父元素的子元素中
     * @param parent 需要添加到的父元素
     */
    addTo(parent: Node | Stage): Node;

    /**
     * 将当前元素从其父元素中移除
     */
    removeFromParent(): Node;

    /**
     * 更新本地矩阵
     */
    updateMatrix(): Node;

    /**
     * 更新transform属性
     */
    updateTransform(): Node;

    /**
     * 更新世界矩阵
     * @param force 是否强制更新
     */
    updateMatrixWorld(force?: boolean): Node;

    /**
     * 获取当前元素相对于指定元素的矩阵
     * @param ancestor 相对于的元素，需要是当前元素的祖先元素，不传表示获取世界矩阵
     */
    getConcatenatedMatrix(ancestor?: Node): Matrix4;

    /**
     * 遍历当前元素的子孙元素
     * @param callback 每个元素都会调用这个函数处理
     * @param onlyChild 是否只遍历子元素
     */
    traverse(callback: Function, onlyChild?: boolean): Node;

    /**
     * 遍历调用子孙元素onUpdate方法
     * @param dt
     */
    traverseUpdate(dt: number): Node;

    /**
     * 根据函数来获取一个子孙元素
     * @param fn 判读函数
     */
    getChildByFn(fn: Function): Node | null;

    /**
     * 根据函数来获取匹配的所有子孙元素
     * @param fn 判读函数
     */
    getChildrenByFn(fn: Function): Node[];

    /**
     * 获取指定name的首个子孙元素
     * @param name 元素name
     */
    getChildByName(name: string): Node | null;

    /**
     * 获取指定name的所有子孙元素
     * @param name 元素name
     */
    getChildrenByName(name: string): Node[];

    /**
     * 获取指定id的子孙元素
     * @param id 元素id
     */
    getChildById(id: string): Node | null;

    /**
     * 获取指定类名的所有子孙元素
     * @param className 类名
     */
    getChildrenByClassName(className: string): Node[];

    /**
     * 设置元素的缩放比例
     * @param x X缩放比例
     * @param y Y缩放比例
     * @param z Z缩放比例
     */
    setScale(x: number, y: number, z: number): Node;

    /**
     * 设置元素的位置
     * @param x X方向位置
     * @param y Y方向位置
     * @param z Z方向位置
     */
    setPosition(x: number, y: number, z: number): Node;

    /**
     * 设置元素的旋转
     * @param x X轴旋转角度
     * @param y Y轴旋转角度
     * @param z Z轴旋转角度
     */
    setRotation(x: number, y: number, z: number): Node;

    /**
     * 设置中心点
     * @param x 中心点x
     * @param y 中心点y
     * @param z 中心点z
     */
    setPivot(x: number, y: number, z: number): Node;

    /**
     * 改变元素的朝向
     * @param node 需要朝向的元素，或者坐标
     */
    lookAt(node: Node | Object | Vector3): Node;
    onUpdate(escapeTime: number): any;

    /**
     * 元素的矩阵
     */
    matrix: Matrix4;

    /**
     * x轴坐标
     */
    x: number;

    /**
     * y轴坐标
     */
    y: number;

    /**
     * z轴坐标
     */
    z: number;

    /**
     * 缩放比例x
     */
    scaleX: number;

    /**
     * 缩放比例y
     */
    scaleY: number;

    /**
     * 缩放比例z
     */
    scaleZ: number;

    /**
     * 旋转角度x
     */
    rotationX: number;

    /**
     * 旋转角度y
     */
    rotationY: number;

    /**
     * 旋转角度z
     */
    rotationZ: number;

    /**
     * 中心点x
     */
    pivotX: number;

    /**
     * 中心点y
     */
    pivotY: number;

    /**
     * 中心点z
     */
    pivotZ: number;

    /**
     * 四元数角度
     */
    quaternion: Quaternion;

    /**
     * 获取元素的包围盒信息
     * @param parent 元素相对于哪个祖先元素的包围盒，不传表示世界
     * @param currentMatrix 当前计算的矩阵
     * @param bounds 当前计算的包围盒信息
     */
    getBounds(parent?: Node, currentMatrix?: Matrix4, bounds?: Bounds): Bounds;

  }

  interface IAmbientLightParams extends ITransformAttributes {
    /**
     * 阴影生成参数，默认不生成阴影
     */
    shadow?: Object;

    name?: string;

    /**
     * 光强度
     */
    amount?: number;

    /**
     * 灯光颜色
     */
    color?: Color;
  }
  class AmbientLight extends Light {
    /**
     * 环境光
     */
    constructor();

    /**
     * 
     * @param params 创建对象的属性参数。可包含此类的所有属性。
     */
    constructor(params: IAmbientLightParams);

    isAmbientLight: boolean;

    /**
     * 光强度
     */
    amount: number;

    /**
     * 灯光颜色
     */
    color: Color;
  }

  interface IDirectionalLightParams extends ITransformAttributes {
    name?: string;

    /**
     * 阴影生成参数，默认不生成阴影
     */
    shadow?: Object;

    /**
     * 光方向
     */
    direction?: Vector3;

    /**
     * 光强度
     */
    amount?: number;

    /**
     * 灯光颜色
     */
    color?: Color;  
  }
  class DirectionalLight extends Light {
    /**
     * 平行光
     */
    constructor();

    /**
     * 
     * @param params 创建对象的属性参数。可包含此类的所有属性。
     */
    constructor(params: IDirectionalLightParams);

    isDirectionalLight: boolean;

    className: string;

    /**
     * 阴影生成参数，默认不生成阴影
     */
    shadow: Object;

    /**
     * 光方向
     */
    direction: Vector3;

    /**
     * 光强度
     */
    amount: number;

    /**
     * 灯光颜色
     */
    color: Color;

  }

  interface ILightParams extends ITransformAttributes {
    /**
     * 阴影生成参数，默认不生成阴影
     */
    shadow?: Object;

    /**
     * 光强度
     */
    amount?: number;

    /**
     * 灯光颜色
     */
    color?: Color;

    /**
     * Node 的名字，可以通过 getChildByName 查找
     */
    name?: string;
  }
  class Light extends ILightParams {
    /**
     * 灯光基础类
     */
    constructor();

    /**
     * 
     * @param params 创建对象的属性参数。可包含此类的所有属性。
     */
    constructor(params: ILightParams);

    /**
     * 光强度
     */
    amount: number;

    /**
     * 灯光颜色
     */
    color: Color;

    /**
     * 阴影生成参数，默认不生成阴影
     */
    shadow?: Object;

    isNode: boolean;

    className: string;

    /**
     * Node 的名字，可以通过 getChildByName 查找
     */
    name: string;

    /**
     * animation 查找 id
     */
    animationId: number;

    /**
     * 是否自动更新世界矩阵
     */
    autoUpdateWorldMatrix: boolean;

    /**
     * 父节点
     */
    parent: Node;

    /**
     * 每次更新的时候是否调用子节点的 onUpdate 方法
     */
    needCallChildUpdate: boolean;

    /**
     * 节点是否显示
     */
    visible: boolean;

    /**
     * 可视对象是否接受交互事件。默认为接受交互事件，即true。
     */
    pointerEnabled: boolean;

    /**
     * 子元素是否接受交互事件。
     */
    pointerChildren: boolean;

    /**
     * 是否用鼠标指针
     */
    useHandCursor: boolean;

    id: string;

    /**
     * 元素的up向量
     */
    up: Vector3;

    /**
     * 元素直接点数组
     */
    children: Node[];

    /**
     * 元素的世界矩阵
     */
    worldMatrix: Matrix4;

    /**
     * 
     * @param isChild 是否子节点，子节点不会处理动画及骨骼Mesh，即如果有动画将共享
     */
    clone(isChild?: boolean): Node;

    /**
     * 设置节点的动画，这个需要是模型的根节点
     * @param anim 动画实例
     */
    setAnim(anim: Animation): Node;

    /**
     * 重置子孙元素中 SkinedMesh 的根节点为当前元素
     */
    resetSkinedMeshRootNode(): void;

    /**
     * 将所以子孙元素放到一个对象中，对象key为元素的name，value为该元素
     */
    getChildrenNameMap(): Object;

    /**
     * 添加一个子元素
     * @param child 需要添加的子元素
     */
    addChild(child: Node): Node;

    /**
     * 移除指定的子元素
     * @param child 需要移除的元素
     */
    removeChild(child: Node): Node;

    /**
     * 将当前元素添加到某个父元素的子元素中
     * @param parent 需要添加到的父元素
     */
    addTo(parent: Node | Stage): Node;

    /**
     * 将当前元素从其父元素中移除
     */
    removeFromParent(): Node;

    /**
     * 更新本地矩阵
     */
    updateMatrix(): Node;

    /**
     * 更新transform属性
     */
    updateTransform(): Node;

    /**
     * 更新世界矩阵
     * @param force 是否强制更新
     */
    updateMatrixWorld(force?: boolean): Node;

    /**
     * 获取当前元素相对于指定元素的矩阵
     * @param ancestor 相对于的元素，需要是当前元素的祖先元素，不传表示获取世界矩阵
     */
    getConcatenatedMatrix(ancestor?: Node): Matrix4;

    /**
     * 遍历当前元素的子孙元素
     * @param callback 每个元素都会调用这个函数处理
     * @param onlyChild 是否只遍历子元素
     */
    traverse(callback: Function, onlyChild?: boolean): Node;

    /**
     * 遍历调用子孙元素onUpdate方法
     * @param dt
     */
    traverseUpdate(dt: number): Node;

    /**
     * 根据函数来获取一个子孙元素
     * @param fn 判读函数
     */
    getChildByFn(fn: Function): Node | null;

    /**
     * 根据函数来获取匹配的所有子孙元素
     * @param fn 判读函数
     */
    getChildrenByFn(fn: Function): Node[];

    /**
     * 获取指定name的首个子孙元素
     * @param name 元素name
     */
    getChildByName(name: string): Node | null;

    /**
     * 获取指定name的所有子孙元素
     * @param name 元素name
     */
    getChildrenByName(name: string): Node[];

    /**
     * 获取指定id的子孙元素
     * @param id 元素id
     */
    getChildById(id: string): Node | null;

    /**
     * 获取指定类名的所有子孙元素
     * @param className 类名
     */
    getChildrenByClassName(className: string): Node[];

    /**
     * 设置元素的缩放比例
     * @param x X缩放比例
     * @param y Y缩放比例
     * @param z Z缩放比例
     */
    setScale(x: number, y: number, z: number): Node;

    /**
     * 设置元素的位置
     * @param x X方向位置
     * @param y Y方向位置
     * @param z Z方向位置
     */
    setPosition(x: number, y: number, z: number): Node;

    /**
     * 设置元素的旋转
     * @param x X轴旋转角度
     * @param y Y轴旋转角度
     * @param z Z轴旋转角度
     */
    setRotation(x: number, y: number, z: number): Node;

    /**
     * 设置中心点
     * @param x 中心点x
     * @param y 中心点y
     * @param z 中心点z
     */
    setPivot(x: number, y: number, z: number): Node;

    /**
     * 改变元素的朝向
     * @param node 需要朝向的元素，或者坐标
     */
    lookAt(node: Node | Object | Vector3): Node;
    onUpdate(escapeTime: number): any;

    /**
     * raycast
     * @param ray
     * @param sort 是否按距离排序
     * @param eventMode 是否事件模式
     */
    raycast(ray: Ray, sort?: boolean, eventMode?: boolean): raycastInfo[] | null;

    /**
     * 元素的矩阵
     */
    matrix: Matrix4;

    /**
     * x轴坐标
     */
    x: number;

    /**
     * y轴坐标
     */
    y: number;

    /**
     * z轴坐标
     */
    z: number;

    /**
     * 缩放比例x
     */
    scaleX: number;

    /**
     * 缩放比例y
     */
    scaleY: number;

    /**
     * 缩放比例z
     */
    scaleZ: number;

    /**
     * 旋转角度x
     */
    rotationX: number;

    /**
     * 旋转角度y
     */
    rotationY: number;

    /**
     * 旋转角度z
     */
    rotationZ: number;

    /**
     * 中心点x
     */
    pivotX: number;

    /**
     * 中心点y
     */
    pivotY: number;

    /**
     * 中心点z
     */
    pivotZ: number;

    /**
     * 四元数角度
     */
    quaternion: Quaternion;

    /**
     * 获取元素的包围盒信息
     * @param parent 元素相对于哪个祖先元素的包围盒，不传表示世界
     * @param currentMatrix 当前计算的矩阵
     * @param bounds 当前计算的包围盒信息
     */
    getBounds(parent?: Node, currentMatrix?: Matrix4, bounds?: Bounds): Bounds;

  }

  class LightManager {
    /**
     * 光管理类
     */
    constructor();

    /**
     * 
     * @param params 创建对象的属性参数。可包含此类的所有属性。
     */
    constructor(params?: Object);

    isLightManager: boolean;

    className: string;

    /**
     * 增加光
     * @param light 光源
     */
    addLight(light: Light): void;

    /**
     * 获取方向光信息
     * @param camera 摄像机
     */
    getDirectionalInfo(camera: Camera): Object;

    /**
     * 获取聚光灯信息
     * @param camera 摄像机
     */
    getSpotInfo(camera: Camera): Object;

    /**
     * 获取点光源信息
     * @param camera 摄像机
     */
    getPointInfo(camera: Camera): Object;

    /**
     * 获取环境光信息
     */
    getAmbientInfo(): Object;

    /**
     * 更新所有光源信息
     * @param camera 摄像机
     */
    updateInfo(camera: Camera): void;

    /**
     * 获取光源信息
     */
    getInfo(): Object;

    /**
     * 重置所有光源
     */
    reset(): void;

  }

  interface IPointLightParams extends ITransformAttributes {
    /**
     * 阴影生成参数，默认不生成阴影
     */
    shadow?: Object;

    /**
     * Node 的名字，可以通过 getChildByName 查找
     */
    name?: string;

    /**
     * 光照范围, PointLight 和 SpotLight 时生效, 0 时代表光照范围无限大。
     */
    range?: number;

    /**
     * 光常量衰减值
     */
    constantAttenuation?: number;

    /**
     * 光一次衰减值
     */
    linearAttenuation?: number;

    /**
     * 光二次衰减值
     */
    quadraticAttenuation?: number;
  }
  class PointLight extends Light {
    /**
     * 点光源
     */
    constructor();

    /**
     * 
     * @param params 创建对象的属性参数。可包含此类的所有属性。
     */
    constructor(params: IPointLightParams);

    isPointLight: boolean;

    className: string;

    /**
     * 光常量衰减值
     */
    constantAttenuation: number;

    /**
     * 光一次衰减值
     */
    linearAttenuation: number;

    /**
     * 光二次衰减值
     */
    quadraticAttenuation: number;

    /**
     * 光照范围, PointLight 和 SpotLight 时生效, 0 时代表光照范围无限大。
     */
    range: number;

    /**
     * 获取光信息
     * @param out 信息接受数组
     * @param offset 偏移值
     */
    toInfoArray(out: any, offset: number): void;

    /**
     * 光强度
     */
    amount: number;

    /**
     * 灯光颜色
     */
    color: Color;

    isNode: boolean;

    /**
     * Node 的名字，可以通过 getChildByName 查找
     */
    name: string;

    /**
     * animation 查找 id
     */
    animationId: number;

    /**
     * 是否自动更新世界矩阵
     */
    autoUpdateWorldMatrix: boolean;

    /**
     * 父节点
     */
    parent: Node;

    /**
     * 每次更新的时候是否调用子节点的 onUpdate 方法
     */
    needCallChildUpdate: boolean;

    /**
     * 节点是否显示
     */
    visible: boolean;

    /**
     * 可视对象是否接受交互事件。默认为接受交互事件，即true。
     */
    pointerEnabled: boolean;

    /**
     * 子元素是否接受交互事件。
     */
    pointerChildren: boolean;

    /**
     * 是否用鼠标指针
     */
    useHandCursor: boolean;

    id: string;

    /**
     * 元素的up向量
     */
    up: Vector3;

    /**
     * 元素直接点数组
     */
    children: Node[];

    /**
     * 元素的世界矩阵
     */
    worldMatrix: Matrix4;

    /**
     * 
     * @param isChild 是否子节点，子节点不会处理动画及骨骼Mesh，即如果有动画将共享
     */
    clone(isChild?: boolean): Node;

    /**
     * 设置节点的动画，这个需要是模型的根节点
     * @param anim 动画实例
     */
    setAnim(anim: Animation): Node;

    /**
     * 重置子孙元素中 SkinedMesh 的根节点为当前元素
     */
    resetSkinedMeshRootNode(): void;

    /**
     * 将所以子孙元素放到一个对象中，对象key为元素的name，value为该元素
     */
    getChildrenNameMap(): Object;

    /**
     * 添加一个子元素
     * @param child 需要添加的子元素
     */
    addChild(child: Node): Node;

    /**
     * 移除指定的子元素
     * @param child 需要移除的元素
     */
    removeChild(child: Node): Node;

    /**
     * 将当前元素添加到某个父元素的子元素中
     * @param parent 需要添加到的父元素
     */
    addTo(parent: Node | Stage): Node;

    /**
     * 将当前元素从其父元素中移除
     */
    removeFromParent(): Node;

    /**
     * 更新本地矩阵
     */
    updateMatrix(): Node;

    /**
     * 更新transform属性
     */
    updateTransform(): Node;

    /**
     * 更新世界矩阵
     * @param force 是否强制更新
     */
    updateMatrixWorld(force?: boolean): Node;

    /**
     * 获取当前元素相对于指定元素的矩阵
     * @param ancestor 相对于的元素，需要是当前元素的祖先元素，不传表示获取世界矩阵
     */
    getConcatenatedMatrix(ancestor?: Node): Matrix4;

    /**
     * 遍历当前元素的子孙元素
     * @param callback 每个元素都会调用这个函数处理
     * @param onlyChild 是否只遍历子元素
     */
    traverse(callback: Function, onlyChild?: boolean): Node;

    /**
     * 遍历调用子孙元素onUpdate方法
     * @param dt
     */
    traverseUpdate(dt: number): Node;

    /**
     * 根据函数来获取一个子孙元素
     * @param fn 判读函数
     */
    getChildByFn(fn: Function): Node | null;

    /**
     * 根据函数来获取匹配的所有子孙元素
     * @param fn 判读函数
     */
    getChildrenByFn(fn: Function): Node[];

    /**
     * 获取指定name的首个子孙元素
     * @param name 元素name
     */
    getChildByName(name: string): Node | null;

    /**
     * 获取指定name的所有子孙元素
     * @param name 元素name
     */
    getChildrenByName(name: string): Node[];

    /**
     * 获取指定id的子孙元素
     * @param id 元素id
     */
    getChildById(id: string): Node | null;

    /**
     * 获取指定类名的所有子孙元素
     * @param className 类名
     */
    getChildrenByClassName(className: string): Node[];

    /**
     * 设置元素的缩放比例
     * @param x X缩放比例
     * @param y Y缩放比例
     * @param z Z缩放比例
     */
    setScale(x: number, y: number, z: number): Node;

    /**
     * 设置元素的位置
     * @param x X方向位置
     * @param y Y方向位置
     * @param z Z方向位置
     */
    setPosition(x: number, y: number, z: number): Node;

    /**
     * 设置元素的旋转
     * @param x X轴旋转角度
     * @param y Y轴旋转角度
     * @param z Z轴旋转角度
     */
    setRotation(x: number, y: number, z: number): Node;

    /**
     * 设置中心点
     * @param x 中心点x
     * @param y 中心点y
     * @param z 中心点z
     */
    setPivot(x: number, y: number, z: number): Node;

    /**
     * 改变元素的朝向
     * @param node 需要朝向的元素，或者坐标
     */
    lookAt(node: Node | Object | Vector3): Node;
    onUpdate(escapeTime: number): any;

    /**
     * raycast
     * @param ray
     * @param sort 是否按距离排序
     * @param eventMode 是否事件模式
     */
    raycast(ray: Ray, sort?: boolean, eventMode?: boolean): raycastInfo[] | null;

    /**
     * 元素的矩阵
     */
    matrix: Matrix4;

    /**
     * x轴坐标
     */
    x: number;

    /**
     * y轴坐标
     */
    y: number;

    /**
     * z轴坐标
     */
    z: number;

    /**
     * 缩放比例x
     */
    scaleX: number;

    /**
     * 缩放比例y
     */
    scaleY: number;

    /**
     * 缩放比例z
     */
    scaleZ: number;

    /**
     * 旋转角度x
     */
    rotationX: number;

    /**
     * 旋转角度y
     */
    rotationY: number;

    /**
     * 旋转角度z
     */
    rotationZ: number;

    /**
     * 中心点x
     */
    pivotX: number;

    /**
     * 中心点y
     */
    pivotY: number;

    /**
     * 中心点z
     */
    pivotZ: number;

    /**
     * 四元数角度
     */
    quaternion: Quaternion;

    /**
     * 获取元素的包围盒信息
     * @param parent 元素相对于哪个祖先元素的包围盒，不传表示世界
     * @param currentMatrix 当前计算的矩阵
     * @param bounds 当前计算的包围盒信息
     */
    getBounds(parent?: Node, currentMatrix?: Matrix4, bounds?: Bounds): Bounds;

  }

  interface ISpotLightParams extends ITransformAttributes {
    /**
     * 阴影生成参数，默认不生成阴影
     */
    shadow?: Object;

    /**
     * 切光角(角度)，落在这个角度之内的光亮度为1
     */
    cutoff?: number;

    /**
     * 外切光角(角度)，在切光角合外切光角之间的光亮度渐变到0
     */
    outerCutoff?: number;

    /**
     * 光照范围, PointLight 和 SpotLight 时生效, 0 时代表光照范围无限大。
     */
    range?: number;

    /**
     * 光常量衰减值
     */
    constantAttenuation?: number;

    /**
     * 光一次衰减值
     */
    linearAttenuation?: number;

    /**
     * 光二次衰减值
     */
    quadraticAttenuation?: number;

    /**
     * 光方向
     */
    direction?: Vector3;

    /**
     * 光强度
     */
    amount?: number;

    /**
     * 灯光颜色
     */
    color?: Color;

    /**
     * Node 的名字，可以通过 getChildByName 查找
     */
    name?: string;
  }
  class SpotLight extends Light {
    /**
     * 聚光灯
     */
    constructor();

    /**
     * 
     * @param params 创建对象的属性参数。可包含此类的所有属性。
     */
    constructor(params: ISpotLightParams);

    isSpotLight: boolean;

    className: string;

    /**
     * 阴影生成参数，默认不生成阴影
     */
    shadow: Object;

    /**
     * 切光角(角度)，落在这个角度之内的光亮度为1
     */
    cutoff: number;

    /**
     * 外切光角(角度)，在切光角合外切光角之间的光亮度渐变到0
     */
    outerCutoff: number;

    /**
     * 光常量衰减值
     */
    constantAttenuation: number;

    /**
     * 光一次衰减值
     */
    linearAttenuation: number;

    /**
     * 光二次衰减值
     */
    quadraticAttenuation: number;

    /**
     * 光照范围, PointLight 和 SpotLight 时生效, 0 时代表光照范围无限大。
     */
    range: number;

    /**
     * 光方向
     */
    direction: Vector3;

    /**
     * 获取光信息
     * @param out 信息接受数组
     * @param offset 偏移值
     */
    toInfoArray(out: any, offset: number): void;

    /**
     * 光强度
     */
    amount: number;

    /**
     * 灯光颜色
     */
    color: Color;

    isNode: boolean;

    /**
     * Node 的名字，可以通过 getChildByName 查找
     */
    name: string;

    /**
     * animation 查找 id
     */
    animationId: number;

    /**
     * 是否自动更新世界矩阵
     */
    autoUpdateWorldMatrix: boolean;

    /**
     * 父节点
     */
    parent: Node;

    /**
     * 每次更新的时候是否调用子节点的 onUpdate 方法
     */
    needCallChildUpdate: boolean;

    /**
     * 节点是否显示
     */
    visible: boolean;

    /**
     * 可视对象是否接受交互事件。默认为接受交互事件，即true。
     */
    pointerEnabled: boolean;

    /**
     * 子元素是否接受交互事件。
     */
    pointerChildren: boolean;

    /**
     * 是否用鼠标指针
     */
    useHandCursor: boolean;

    id: string;

    /**
     * 元素的up向量
     */
    up: Vector3;

    /**
     * 元素直接点数组
     */
    children: Node[];

    /**
     * 元素的世界矩阵
     */
    worldMatrix: Matrix4;

    /**
     * 
     * @param isChild 是否子节点，子节点不会处理动画及骨骼Mesh，即如果有动画将共享
     */
    clone(isChild?: boolean): Node;

    /**
     * 设置节点的动画，这个需要是模型的根节点
     * @param anim 动画实例
     */
    setAnim(anim: Animation): Node;

    /**
     * 重置子孙元素中 SkinedMesh 的根节点为当前元素
     */
    resetSkinedMeshRootNode(): void;

    /**
     * 将所以子孙元素放到一个对象中，对象key为元素的name，value为该元素
     */
    getChildrenNameMap(): Object;

    /**
     * 添加一个子元素
     * @param child 需要添加的子元素
     */
    addChild(child: Node): Node;

    /**
     * 移除指定的子元素
     * @param child 需要移除的元素
     */
    removeChild(child: Node): Node;

    /**
     * 将当前元素添加到某个父元素的子元素中
     * @param parent 需要添加到的父元素
     */
    addTo(parent: Node | Stage): Node;

    /**
     * 将当前元素从其父元素中移除
     */
    removeFromParent(): Node;

    /**
     * 更新本地矩阵
     */
    updateMatrix(): Node;

    /**
     * 更新transform属性
     */
    updateTransform(): Node;

    /**
     * 更新世界矩阵
     * @param force 是否强制更新
     */
    updateMatrixWorld(force?: boolean): Node;

    /**
     * 获取当前元素相对于指定元素的矩阵
     * @param ancestor 相对于的元素，需要是当前元素的祖先元素，不传表示获取世界矩阵
     */
    getConcatenatedMatrix(ancestor?: Node): Matrix4;

    /**
     * 遍历当前元素的子孙元素
     * @param callback 每个元素都会调用这个函数处理
     * @param onlyChild 是否只遍历子元素
     */
    traverse(callback: Function, onlyChild?: boolean): Node;

    /**
     * 遍历调用子孙元素onUpdate方法
     * @param dt
     */
    traverseUpdate(dt: number): Node;

    /**
     * 根据函数来获取一个子孙元素
     * @param fn 判读函数
     */
    getChildByFn(fn: Function): Node | null;

    /**
     * 根据函数来获取匹配的所有子孙元素
     * @param fn 判读函数
     */
    getChildrenByFn(fn: Function): Node[];

    /**
     * 获取指定name的首个子孙元素
     * @param name 元素name
     */
    getChildByName(name: string): Node | null;

    /**
     * 获取指定name的所有子孙元素
     * @param name 元素name
     */
    getChildrenByName(name: string): Node[];

    /**
     * 获取指定id的子孙元素
     * @param id 元素id
     */
    getChildById(id: string): Node | null;

    /**
     * 获取指定类名的所有子孙元素
     * @param className 类名
     */
    getChildrenByClassName(className: string): Node[];

    /**
     * 设置元素的缩放比例
     * @param x X缩放比例
     * @param y Y缩放比例
     * @param z Z缩放比例
     */
    setScale(x: number, y: number, z: number): Node;

    /**
     * 设置元素的位置
     * @param x X方向位置
     * @param y Y方向位置
     * @param z Z方向位置
     */
    setPosition(x: number, y: number, z: number): Node;

    /**
     * 设置元素的旋转
     * @param x X轴旋转角度
     * @param y Y轴旋转角度
     * @param z Z轴旋转角度
     */
    setRotation(x: number, y: number, z: number): Node;

    /**
     * 设置中心点
     * @param x 中心点x
     * @param y 中心点y
     * @param z 中心点z
     */
    setPivot(x: number, y: number, z: number): Node;

    /**
     * 改变元素的朝向
     * @param node 需要朝向的元素，或者坐标
     */
    lookAt(node: Node | Object | Vector3): Node;
    onUpdate(escapeTime: number): any;

    /**
     * raycast
     * @param ray
     * @param sort 是否按距离排序
     * @param eventMode 是否事件模式
     */
    raycast(ray: Ray, sort?: boolean, eventMode?: boolean): raycastInfo[] | null;

    /**
     * 元素的矩阵
     */
    matrix: Matrix4;

    /**
     * x轴坐标
     */
    x: number;

    /**
     * y轴坐标
     */
    y: number;

    /**
     * z轴坐标
     */
    z: number;

    /**
     * 缩放比例x
     */
    scaleX: number;

    /**
     * 缩放比例y
     */
    scaleY: number;

    /**
     * 缩放比例z
     */
    scaleZ: number;

    /**
     * 旋转角度x
     */
    rotationX: number;

    /**
     * 旋转角度y
     */
    rotationY: number;

    /**
     * 旋转角度z
     */
    rotationZ: number;

    /**
     * 中心点x
     */
    pivotX: number;

    /**
     * 中心点y
     */
    pivotY: number;

    /**
     * 中心点z
     */
    pivotZ: number;

    /**
     * 四元数角度
     */
    quaternion: Quaternion;

    /**
     * 获取元素的包围盒信息
     * @param parent 元素相对于哪个祖先元素的包围盒，不传表示世界
     * @param currentMatrix 当前计算的矩阵
     * @param bounds 当前计算的包围盒信息
     */
    getBounds(parent?: Node, currentMatrix?: Matrix4, bounds?: Bounds): Bounds;

  }

  class BasicLoader {
    /**
     * 基础的资源加载类
     */
    constructor();

    isBasicLoader: boolean;

    className: string;

    /**
     * 加载资源，这里会自动调用 loadImg 或者 loadRes
     * @param data 参数
     * @param data.src 资源地址
     * @param data.type 资源类型(img, json, buffer)，不提供将根据 data.src 来判断类型
     */
    load(data?: load_data): Promise<any>;

    /**
     * 判断链接是否跨域，无法处理二级域名，及修改 document.domain 的情况
     * @param url 需要判断的链接
     */
    isCrossOrigin(url: string): boolean;

    /**
     * 加载图片
     * @param url 图片地址
     * @param crossOrigin 是否跨域
     */
    loadImg(url: string, crossOrigin?: boolean): Promise<Image>;

    /**
     * 使用XHR加载其他资源
     * @param url 资源地址
     * @param type 资源类型(json, buffer, text)
     */
    loadRes(url: string, type?: string): Promise<any>;

    /**
     * XHR资源请求
     * @param opt 请求参数
     * @param opt.url 资源地址
     * @param opt.type 资源类型(json, buffer, text)
     * @param opt.method 请求类型(GET, POST ..)
     * @param opt.headers 请求头参数
     * @param opt.body POST请求发送的数据
     */
    request(opt?: request_opt): Promise<any>;

  }

  interface load_data {
    /**
     * 资源地址
     */
    src: string;
    /**
     * 资源类型(img, json, buffer)，不提供将根据 data.src 来判断类型
     */
    type: string;
  }

  interface request_opt {
    /**
     * 资源地址
     */
    url: string;
    /**
     * 资源类型(json, buffer, text)
     */
    type: string;
    /**
     * 请求类型(GET, POST ..)
     */
    method: string;
    /**
     * 请求头参数
     */
    headers: Object;
    /**
     * POST请求发送的数据
     */
    body: string;
  }

  class CubeTextureLoader extends Texture {
    /**
     * CubeTexture加载类
     */
    constructor();

    constructor();

    isCubeTextureLoader: boolean;

    className: string;

    /**
     * 加载CubeTexture
     * @param params 加载参数
     * @param params.crossOrigin 是否跨域，不传将自动判断
     * @param params.images 纹理图片地址数组，顺序为 right, left, top, bottom, front, back
     * @param params.right 右面的图片地址
     * @param params.left 左面的图片地址
     * @param params.top 上面的图片地址
     * @param params.bottom 下面的图片地址
     * @param params.front 前面的图片地址
     * @param params.back 背面的图片地址
     * @param params.uv uv
     */
    load(params: {
      crossOrigin?: boolean;
      images?: string[];
      right?: string;
      left?: string;
      top?: string;
      bottom?: string;
      front?: string;
      back?: string;
      uv?: number;
    }): Promise<CubeTexture>;

    isBasicLoader: boolean;

    /**
     * 判断链接是否跨域，无法处理二级域名，及修改 document.domain 的情况
     * @param url 需要判断的链接
     */
    isCrossOrigin(url: string): boolean;

    /**
     * 加载图片
     * @param url 图片地址
     * @param crossOrigin 是否跨域
     */
    loadImg(url: string, crossOrigin?: boolean): Promise<Image>;

    /**
     * 使用XHR加载其他资源
     * @param url 资源地址
     * @param type 资源类型(json, buffer, text)
     */
    loadRes(url: string, type?: string): Promise<any>;

    /**
     * XHR资源请求
     * @param opt 请求参数
     * @param opt.url 资源地址
     * @param opt.type 资源类型(json, buffer, text)
     * @param opt.method 请求类型(GET, POST ..)
     * @param opt.headers 请求头参数
     * @param opt.body POST请求发送的数据
     */
    request(opt?: request_opt): Promise<any>;

  }

  interface load_params {
    /**
     * 纹理图片地址
     */
    src: string;
    /**
     * 是否跨域，不传将自动判断
     */
    crossOrigin: boolean;
  }

  /**
   * GLTFLoader 模型加载完返回的对象格式
   */
  interface Model {
    /**
     * 模型的根节点
     */
    node: Node;
    /**
     * 模型的所有Mesh对象数组
     */
    meshes: Mesh[];
    /**
     * 模型的动画对象数组，没有动画的话为null
     */
    anim: Animation;
    /**
     * 模型中的所有Camera对象数组
     */
    cameras: Camera[];
    /**
     * 模型中的所有Light对象数组
     */
    lights: Light[];
    /**
     * 模型中的所有Texture对象数组
     */
    textures: Texture[];
    /**
     * 模型中的所有Material对象数组
     */
    materials: BasicMaterial[];
  }

  class GLTFLoader {
    /**
     * glTF模型加载类
     */
    constructor();

    isGLTFLoader: boolean;

    className: string;

    /**
     * 加载glTF模型
     * @param params 加载参数
     * @param params.src glTF模型地址
     * @param params.defaultScene 加载后要展示的场景，默认读模型里的
     * @param params.isMultiAnim 模型是否多动画，如果是的话会返回 anims 对象保存多个动画对象
     * @param params.isProgressive 是否渐进式加载，图片加载完前使用占位图片
     * @param params.isUnQuantizeInShader 是否在shader中进行量化解压数据
     * @param params.preHandlerImageURI 图片URL预处理函数
     * @param params.customMaterialCreator 是否使用自定义的Material创建器
     */
    load(params: {
      src: string;
      defaultScene?: Node;
      isMultiAnim?: boolean;
      isProgressive?: boolean;
      isUnQuantizeInShader?: boolean;
      preHandlerImageURI?: boolean;
      customMaterialCreator?: boolean;
    }): Promise<Model>;

    isBasicLoader: boolean;

    /**
     * 判断链接是否跨域，无法处理二级域名，及修改 document.domain 的情况
     * @param url 需要判断的链接
     */
    isCrossOrigin(url: string): boolean;

    /**
     * 加载图片
     * @param url 图片地址
     * @param crossOrigin 是否跨域
     */
    loadImg(url: string, crossOrigin?: boolean): Promise<Image>;

    /**
     * 使用XHR加载其他资源
     * @param url 资源地址
     * @param type 资源类型(json, buffer, text)
     */
    loadRes(url: string, type?: string): Promise<any>;

    /**
     * XHR资源请求
     * @param opt 请求参数
     * @param opt.url 资源地址
     * @param opt.type 资源类型(json, buffer, text)
     * @param opt.method 请求类型(GET, POST ..)
     * @param opt.headers 请求头参数
     * @param opt.body POST请求发送的数据
     */
    request(opt?: request_opt): Promise<any>;

  }

  class GLTFParser {
    constructor();

    /**
     * 
     * @param content
     * @param params
     */
    constructor(content: any | string, params: Object);

    isGLTFParser: boolean;

    className: string;

    static registerExtensionHandler(extensionName: string, handler: {parse: Function});
    static unregisterExtensionHandler(extensionName: string);
    static extensionHandlers: {[name: string]: {parse: Function}};
  }

  class LoadCache {
    constructor();

    isLoadCache: boolean;

    className: string;

  }

  class ISource {
    /*
    * 资源地址
    */
    src: string;
    /*
    * 资源id
    */
    id?: number;
    /*
    * 资源类型，对应ext，不传的话自动根据src来获取
    */
    type?: string;
    /*
    * 资源大小，用于精确计算当前加载进度
    */
    size?: string;
  }
  class LoadQueue {
    /**
     * 队列加载器，用于批量加载
     */
    constructor();

    /**
     * 
     * @param source 需要加载的资源列表
     */
    constructor(source: ISource[]);

    isLoadQueue: boolean;

    className: string;

    /**
     * 给LoadQueue类添加扩展Loader
     * @param ext 资源扩展，如gltf, png 等
     * @param LoaderClass 用于加载的类，需要继承BasicLoader
     */
    static addLoader(ext: string, LoaderClass: BasicLoader): void;

    /**
     * 最大并发连接数
     */
    maxConnections: number;

    /**
     * 添加需要加载的资源
     * @param source 资源信息
     * @param source.src 资源地址
     * @param source.id 资源id
     * @param source.type 资源类型，对应ext，不传的话自动根据src来获取
     * @param source.size 资源大小，用于精确计算当前加载进度
     */
    add(source: ISource[]): void;

    /**
     * 获取指定id的资源
     * @param id id
     */
    get(id: string): Object;

    /**
     * 获取指定id加载完后的数据
     * @param id id
     */
    getContent(id: string): Object;

    /**
     * 开始加载资源
     */
    start(): LoadQueue;

    /**
     * 获取当前已经加载完的资源数量
     */
    getLoaded(): number;

    /**
     * 获取需要加载的资源总数
     */
    getTotal(): number;

    /**
     * 获取加载的所有资源结果
     */
    getAllContent(): any;

  }

  class ShaderMaterialLoader {
    /**
     * ShaderMaterial加载类
     */
    constructor();

    /**
     * 加载ShaderMaterial
     * @param params 加载参数，所有参数均会传递给 ShaderMaterial 的构造器
     * @param params.fs fragment shader 文件的地址
     * @param params.vs vertex shader 文件的地址
     */
    load(params: {
      fs: string;
      vs: string;
    }): Promise<ShaderMaterial>;

    isBasicLoader: boolean;

    className: string;

    /**
     * 判断链接是否跨域，无法处理二级域名，及修改 document.domain 的情况
     * @param url 需要判断的链接
     */
    isCrossOrigin(url: string): boolean;

    /**
     * 加载图片
     * @param url 图片地址
     * @param crossOrigin 是否跨域
     */
    loadImg(url: string, crossOrigin?: boolean): Promise<Image>;

    /**
     * 使用XHR加载其他资源
     * @param url 资源地址
     * @param type 资源类型(json, buffer, text)
     */
    loadRes(url: string, type?: string): Promise<any>;

    /**
     * XHR资源请求
     * @param opt 请求参数
     * @param opt.url 资源地址
     * @param opt.type 资源类型(json, buffer, text)
     * @param opt.method 请求类型(GET, POST ..)
     * @param opt.headers 请求头参数
     * @param opt.body POST请求发送的数据
     */
    request(opt?: request_opt): Promise<any>;

  }

  class TextureLoader {
    /**
     * Texture加载类
     */
    constructor();

    isTextureLoader: boolean;

    className: string;

    /**
     * 加载Texture
     * @param params 加载参数
     * @param params.src 纹理图片地址
     * @param params.crossOrigin 是否跨域，不传将自动判断
     * @param params.uv uv
     */
    load(params: {src: string, crossOrigin?: boolean, uv?: number, flipY?: number}): Promise<Texture>;

    isBasicLoader: boolean;

    /**
     * 判断链接是否跨域，无法处理二级域名，及修改 document.domain 的情况
     * @param url 需要判断的链接
     */
    isCrossOrigin(url: string): boolean;

    /**
     * 加载图片
     * @param url 图片地址
     * @param crossOrigin 是否跨域
     */
    loadImg(url: string, crossOrigin?: boolean): Promise<Image>;

    /**
     * 使用XHR加载其他资源
     * @param url 资源地址
     * @param type 资源类型(json, buffer, text)
     */
    loadRes(url: string, type?: string): Promise<any>;

    /**
     * XHR资源请求
     * @param opt 请求参数
     * @param opt.url 资源地址
     * @param opt.type 资源类型(json, buffer, text)
     * @param opt.method 请求类型(GET, POST ..)
     * @param opt.headers 请求头参数
     * @param opt.body POST请求发送的数据
     */
    request(opt?: request_opt): Promise<any>;

  }


  class IMaterial {
    /**
     * 渲染顺序。
     */
    renderOrder?: number;
    /**
     * 是否开启网格模式
     */
    wireframe?: boolean;

    /**
     * 是否开启深度测试
     */
    depthTest?: boolean;
    /**
     * shader cache id
     */
    shaderCacheId?: string;

    /**
     * SAMPLE_ALPHA_TO_COVERAGE
     */
    sampleAlphaToCoverage?: boolean;

    /**
     * 是否开启depthMask
     */
    depthMask?: boolean;

    /**
     * 深度测试Range
     */
    depthRange?: any;

    /**
     * 深度测试方法
     */
    depthFunc?: GLenum;

    /**
     * 法线贴图
     */
    normalMap?: Texture;

    /**
     * 视差贴图
     */
    parallaxMap?: Texture;

    /**
     * 法线贴图scale
     */
    normalMapScale?: Vector3;

    /**
     * 是否忽略透明度
     */
    ignoreTranparent?: boolean;

    /**
     * gammaOutput
     * @deprecated Use gammaCorrection instead.
     */
    gammaOutput?: boolean;

    /**
     * gammaCorrection
     */
    gammaCorrection?: boolean;

    /**
     * gamma值
     */
    gammaFactor?: number;

    /**
     * 是否投射阴影
     */
    castShadows?: boolean;

    /**
     * 是否接受阴影
     */
    receiveShadows?: boolean;

    /**
     * uv transform eg:new Matrix3().fromRotationTranslationScale(Math.PI/2, 0, 0, 2, 2)
     */
    uvMatrix?: Matrix3;

    /**
     * uv1 transform eg:new Matrix3().fromRotationTranslationScale(Math.PI/2, 0, 0, 2, 2)
     */
    uvMatrix1?: Matrix3;

    /**
     * 是否开启 CullFace
     */
    cullFace?: boolean;

    /**
     * CullFace 类型
     */
    cullFaceType?: GLenum;

    /**
     * 显示面，可选值 FRONT, BACK, FRONT_AND_BACK
     */
    side?: GLenum;

    /**
     * 是否开启颜色混合
     */
    blend?: boolean;

    /**
     * 颜色混合方式
     */
    blendEquation?: GLenum;

    /**
     * 透明度混合方式
     */
    blendEquationAlpha?: GLenum;

    /**
     * 颜色混合来源比例
     */
    blendSrc?: GLenum;

    /**
     * 颜色混合目标比例
     */
    blendDst?: GLenum;

    /**
     * 透明度混合来源比例
     */
    blendSrcAlpha?: GLenum;

    /**
     * 透明度混合目标比例
     */
    blendDstAlpha?: GLenum;

    /**
     * 当前是否需要强制更新
     */
    isDirty?: boolean;

    /**
     * 透明度 0~1
     */
    transparency?: number;

    /**
     * 是否需要透明
     */
    transparent?: boolean;

    /**
     * 透明度剪裁，如果渲染的颜色透明度大于等于这个值的话渲染为完全不透明，否则渲染为完全透明
     */
    alphaCutoff?: number;

    /**
     * 是否使用HDR
     */
    useHDR?: boolean;

    /**
     * 曝光度，仅在 useHDR 为 true 时生效
     */
    exposure?: number;

    /**
     * 可以通过指定，semantic来指定值的获取方式，或者自定义get方法
     */
    uniforms?: Object;

    /**
     * 可以通过指定，semantic来指定值的获取方式，或者自定义get方法
     */
    attributes?: Object;
    /**
     * 在材质编译前Hack。
     */
    onBeforeCompile?(fs: string, vs: string): {fs: string, vs: string};
  }

  class IBasicMaterial extends IMaterial {
    /**
     * 光照类型，支持: NONE, PHONG, BLINN-PHONG, LAMBERT
     */
    lightType?: 'NONE' | 'PHONG' | 'BLINN-PHONG' | 'LAMBERT';
    /**
     * 漫反射贴图，或颜色
     */
    diffuse?: Texture | Color;

    /**
     * 环境光贴图，或颜色
     */
    ambient?: Texture | Color;

    /**
     * 镜面贴图，或颜色
     */
    specular?: Texture | Color;

    /**
     * 放射光贴图，或颜色
     */
    emission?: Texture | Color;

    /**
     * 环境贴图
     */
    specularEnvMap?: CubeTexture | Texture;

    /**
     * 环境贴图变化矩阵，如旋转等
     */
    specularEnvMatrix?: Matrix4;

    /**
     * 反射率
     */
    reflectivity?: number;

    /**
     * 折射比率
     */
    refractRatio?: number;

    /**
     * 折射率
     */
    refractivity?: number;

    /**
     * 高光发光值
     */
    shininess?: number;
  }

  class BasicMaterial extends IBasicMaterial {
    /**
     * 基础材质
     */
    constructor();

    /**
     * 
     * @param params 初始化参数，所有params都会复制到实例上
     */
    constructor(params: IBasicMaterial);

    isBasicMaterial: boolean;

    isMaterial: boolean;

    className: string;

    id: string;

    /**
     * clone 当前Material
     */
    clone(): Material;

    /**
     * 销毁贴图
     * @param {WebGLRenderer} renderer
     * @return {Material} this
     */
    destroyTextures(): void;
  }

  class GeometryMaterial {
    /**
     * 基础材质
     */
    constructor();

    /**
     * 
     * @param params 初始化参数，所有params都会复制到实例上
     */
    constructor(params: Object);

    isGeometryMaterial: boolean;

    className: string;

    /**
     * 顶点类型 POSITION, NORMAL, DEPTH, DISTANCE
     */
    vertexType: string;

    /**
     * 是否直接存储
     */
    writeOriginData: boolean;

    isBasicMaterial: boolean;

    /**
     * 光照类型，支持: NONE, PHONG, BLINN-PHONG, LAMBERT
     */
    lightType: string;

    /**
     * 漫反射贴图，或颜色
     */
    diffuse: Texture | Color;

    /**
     * 环境光贴图，或颜色
     */
    ambient: Texture | Color;

    /**
     * 镜面贴图，或颜色
     */
    specular: Texture | Color;

    /**
     * 放射光贴图，或颜色
     */
    emission: Texture | Color;

    /**
     * 环境贴图
     */
    specularEnvMap: CubeTexture | Texture;

    /**
     * 环境贴图变化矩阵，如旋转等
     */
    specularEnvMatrix: Matrix4;

    /**
     * 反射率
     */
    reflectivity: number;

    /**
     * 折射比率
     */
    refractRatio: number;

    /**
     * 折射率
     */
    refractivity: number;

    /**
     * 高光发光值
     */
    shininess: number;

    isMaterial: boolean;

    /**
     * 是否开启网格模式
     */
    wireframe: boolean;

    /**
     * 是否开启深度测试
     */
    depthTest: boolean;

    /**
     * SAMPLE_ALPHA_TO_COVERAGE
     */
    sampleAlphaToCoverage: boolean;

    /**
     * 是否开启depthMask
     */
    depthMask: boolean;

    /**
     * 深度测试Range
     */
    depthRange: any;

    /**
     * 深度测试方法
     */
    depthFunc: GLenum;

    /**
     * 法线贴图
     */
    normalMap: Texture;

    /**
     * 视差贴图
     */
    parallaxMap: Texture;

    /**
     * 法线贴图scale
     */
    normalMapScale: Vector3;

    /**
     * 是否忽略透明度
     */
    ignoreTranparent: boolean;

    /**
     * gammaOutput
     * @deprecated Use gammaCorrection instead.
     */
    gammaOutput: boolean;

    /**
     * gammaCorrection
     */
    gammaCorrection: boolean;

    /**
     * gamma值
     */
    gammaFactor: number;

    /**
     * 是否投射阴影
     */
    castShadows: boolean;

    /**
     * 是否接受阴影
     */
    receiveShadows: boolean;

    /**
     * uv transform eg:new Matrix3().fromRotationTranslationScale(Math.PI/2, 0, 0, 2, 2)
     */
    uvMatrix: Matrix3;

    /**
     * uv1 transform eg:new Matrix3().fromRotationTranslationScale(Math.PI/2, 0, 0, 2, 2)
     */
    uvMatrix1: Matrix3;

    /**
     * 是否开启 CullFace
     */
    cullFace: boolean;

    /**
     * CullFace 类型
     */
    cullFaceType: GLenum;

    /**
     * 显示面，可选值 FRONT, BACK, FRONT_AND_BACK
     */
    side: GLenum;

    /**
     * 是否开启颜色混合
     */
    blend: boolean;

    /**
     * 颜色混合方式
     */
    blendEquation: GLenum;

    /**
     * 透明度混合方式
     */
    blendEquationAlpha: GLenum;

    /**
     * 颜色混合来源比例
     */
    blendSrc: GLenum;

    /**
     * 颜色混合目标比例
     */
    blendDst: GLenum;

    /**
     * 透明度混合来源比例
     */
    blendSrcAlpha: GLenum;

    /**
     * 透明度混合目标比例
     */
    blendDstAlpha: GLenum;

    /**
     * 当前是否需要强制更新
     */
    isDirty: boolean;

    /**
     * 透明度 0~1
     */
    transparency: number;

    /**
     * 是否需要透明
     */
    transparent: boolean;

    /**
     * 透明度剪裁，如果渲染的颜色透明度大于等于这个值的话渲染为完全不透明，否则渲染为完全透明
     */
    alphaCutoff: number;

    /**
     * 是否使用HDR
     */
    useHDR: boolean;

    /**
     * 曝光度，仅在 useHDR 为 true 时生效
     */
    exposure: number;

    id: string;

    /**
     * 可以通过指定，semantic来指定值的获取方式，或者自定义get方法
     */
    uniforms: Object;

    /**
     * 可以通过指定，semantic来指定值的获取方式，或者自定义get方法
     */
    attributes: Object;

    /**
     * clone 当前Material
     */
    clone(): Material;

    /**
     * 销毁贴图
     * @param {WebGLRenderer} renderer
     * @return {Material} this
     */
    destroyTextures(): void;
  }

  class Material extends IMaterial {
    /**
     * 材质基类，一般不直接使用
     */
    constructor();

    /**
     * 
     * @param params 初始化参数，所有params都会复制到实例上
     */
    constructor(params: IMaterial);

    isMaterial: boolean;

    className: string;

    id: string;

    /**
     * clone 当前Material
     */
    clone(): Material;

    /**
     * 销毁贴图
     * @param {WebGLRenderer} renderer
     * @return {Material} this
     */
    destroyTextures(): void;
  }

  class IPBRMaterial extends IMaterial {
    /**
     * 基础颜色
     */
    baseColor?: Color;

    /**
     * 基础颜色贴图
     */
    baseColorMap?: Texture;

    /**
     * 金属度
     */
    metallic?: number;

    /**
     * 金属度贴图
     */
    metallicMap?: Texture;

    /**
     * 粗糙度
     */
    roughness?: number;

    /**
     * 粗糙度贴图
     */
    roughnessMap?: Texture;

    /**
     * 金属度及粗糙度贴图，金属度为B通道，粗糙度为G通道，可以指定R通道作为环境光遮蔽
     */
    metallicRoughnessMap?: Texture;

    /**
     * 环境光遮蔽贴图
     */
    occlusionMap?: Texture;

    /**
     * 环境光遮蔽贴图(occlusionMap)包含在 metallicRoughnessMap 的R通道中
     */
    isOcclusionInMetallicRoughnessMap?: boolean;

    /**
     * 漫反射辐照(Diffuse IBL)贴图
     */
    diffuseEnvMap?: CubeTexture | Texture;

    /**
     * BRDF贴图，跟环境反射贴图一起使用 [示例]{@link https://gw.alicdn.com/tfs/TB1EvwBRFXXXXbNXpXXXXXXXXXX-256-256.png}
     */
    brdfLUT?: Texture;

    /**
     * 环境反射(Specular IBL)贴图
     */
    specularEnvMap?: CubeTexture | Texture;

    /**
     * 放射光贴图，或颜色
     */
    emission?: Texture | Color;

    /**
     * 是否基于反射光泽度的 PBR，具体见 [KHR_materials_pbrSpecularGlossiness]{@link https://github.com/KhronosGroup/glTF/tree/master/extensions/Khronos/KHR_materials_pbrSpecularGlossiness}
     */
    isSpecularGlossiness?: boolean;

    /**
     * 镜面反射率，针对 isSpecularGlossiness 渲染
     */
    specular?: Color;

    /**
     * 光泽度，针对 isSpecularGlossiness 渲染，默认PBR无效
     */
    glossiness?: number;

    /**
     * 镜面反射即光泽度贴图，RGB 通道为镜面反射率，A 通道为光泽度
     */
    specularGlossinessMap?: Texture;

    /**
     * 使用SH进行漫反射的IBL的各多项式系数
     */
    diffuseEnvSphereHarmonics3?: SphericalHarmonics3;

    /**
     * IBL漫反射亮度
     */
    diffuseEnvIntensity?: number;

    /**
     * IBL高光亮度
     */
    specularEnvIntensity?: number;
  }

  class PBRMaterial extends IPBRMaterial {
    /**
     * PBR材质
     */
    constructor();

    /**
     * 
     * @param params 初始化参数，所有params都会复制到实例上
     */
    constructor(params: IPBRMaterial);

    isPBRMaterial: boolean;

    className: string;

    /**
     * 光照类型，只能为 PBR
     */
    readonly lightType: string;

    id: string;

    isMaterial: boolean;

    /**
     * clone 当前Material
     */
    clone(): Material;

    /**
     * 销毁贴图
     * @param {WebGLRenderer} renderer
     * @return {Material} this
     */
    destroyTextures(): void;
  }

  class IShaderMaterial extends IMaterial {
    /**
     * vertex shader 代码
     */
    vs: string;

    /**
     * fragment shader 代码
     */
    fs: string;

    /**
     * 获取定制的渲染参数
     */
    getCustomRenderOption: Function;

    isMaterial: boolean;
    /**
     * 是否使用 header cache shader
     */
    useHeaderCache: boolean;

    /**
     * 光照类型
     */
    lightType: string;
  }

  class ShaderMaterial {
    /**
     * Shader材质
     */
    constructor();

    /**
     * 
     * @param params 初始化参数，所有params都会复制到实例上
     */
    constructor(params: Object);

    isShaderMaterial: boolean;

    className: string;

    isMaterial: boolean;

    /**
     * 是否开启网格模式
     */
    wireframe: boolean;

    /**
     * 是否开启深度测试
     */
    depthTest: boolean;

    /**
     * SAMPLE_ALPHA_TO_COVERAGE
     */
    sampleAlphaToCoverage: boolean;

    /**
     * 是否开启depthMask
     */
    depthMask: boolean;

    /**
     * 深度测试Range
     */
    depthRange: any;

    /**
     * 深度测试方法
     */
    depthFunc: GLenum;

    /**
     * 法线贴图
     */
    normalMap: Texture;

    /**
     * 视差贴图
     */
    parallaxMap: Texture;

    /**
     * 法线贴图scale
     */
    normalMapScale: Vector3;

    /**
     * 是否忽略透明度
     */
    ignoreTranparent: boolean;

    /**
     * gammaOutput
     * @deprecated Use gammaCorrection instead.
     */
    gammaOutput: boolean;

    /**
     * gammaCorrection
     */
    gammaCorrection: boolean;

    /**
     * gamma值
     */
    gammaFactor: number;

    /**
     * 是否投射阴影
     */
    castShadows: boolean;

    /**
     * 是否接受阴影
     */
    receiveShadows: boolean;

    /**
     * uv transform eg:new Matrix3().fromRotationTranslationScale(Math.PI/2, 0, 0, 2, 2)
     */
    uvMatrix: Matrix3;

    /**
     * uv1 transform eg:new Matrix3().fromRotationTranslationScale(Math.PI/2, 0, 0, 2, 2)
     */
    uvMatrix1: Matrix3;

    /**
     * 是否开启 CullFace
     */
    cullFace: boolean;

    /**
     * CullFace 类型
     */
    cullFaceType: GLenum;

    /**
     * 显示面，可选值 FRONT, BACK, FRONT_AND_BACK
     */
    side: GLenum;

    /**
     * 是否开启颜色混合
     */
    blend: boolean;

    /**
     * 颜色混合方式
     */
    blendEquation: GLenum;

    /**
     * 透明度混合方式
     */
    blendEquationAlpha: GLenum;

    /**
     * 颜色混合来源比例
     */
    blendSrc: GLenum;

    /**
     * 颜色混合目标比例
     */
    blendDst: GLenum;

    /**
     * 透明度混合来源比例
     */
    blendSrcAlpha: GLenum;

    /**
     * 透明度混合目标比例
     */
    blendDstAlpha: GLenum;

    /**
     * 当前是否需要强制更新
     */
    isDirty: boolean;

    /**
     * 透明度 0~1
     */
    transparency: number;

    /**
     * 是否需要透明
     */
    transparent: boolean;

    /**
     * 透明度剪裁，如果渲染的颜色透明度大于等于这个值的话渲染为完全不透明，否则渲染为完全透明
     */
    alphaCutoff: number;

    /**
     * 是否使用HDR
     */
    useHDR: boolean;

    /**
     * 曝光度，仅在 useHDR 为 true 时生效
     */
    exposure: number;

    id: string;

    /**
     * 可以通过指定，semantic来指定值的获取方式，或者自定义get方法
     */
    uniforms: Object;

    /**
     * 可以通过指定，semantic来指定值的获取方式，或者自定义get方法
     */
    attributes: Object;

    /**
     * clone 当前Material
     */
    clone(): Material;

    /**
     * 销毁贴图
     * @param {WebGLRenderer} renderer
     * @return {Material} this
     */
    destroyTextures(): void;
  }

  class State {}
  /**
   * 语义
   */
  namespace semantic {
    var state: State;

    var camera: Camera;

    var lightManager: LightManager;

    var fog: Fog;

    var gl: WebGLRenderingContext;

    /**
     * 初始化
     * @param _state
     * @param _camera
     * @param _lightManager
     * @param _fog
     */
    function init(_state: State, _camera: Camera, _lightManager: LightManager, _fog: Fog): void;

    /**
     * 设置相机
     * @param _camera
     */
    function setCamera(_camera: Camera): void;

    var POSITION: semanticObject;

    var NORMAL: semanticObject;

    var TANGENT: semanticObject;

    var TEXCOORD_0: semanticObject;

    var TEXCOORD_1: semanticObject;

    var UVMATRIX_0: semanticObject;

    var UVMATRIX_1: semanticObject;

    var CAMERAFAR: semanticObject;

    var CAMERANEAR: semanticObject;

    var CAMERATYPE: semanticObject;

    var COLOR_0: semanticObject;

    var SKININDICES: semanticObject;

    var SKINWEIGHTS: semanticObject;

    var LOCAL: semanticObject;

    var MODEL: semanticObject;

    var VIEW: semanticObject;

    var PROJECTION: semanticObject;

    var VIEWPROJECTION: semanticObject;

    var MODELVIEW: semanticObject;

    var MODELVIEWPROJECTION: semanticObject;

    var MODELINVERSE: semanticObject;

    var VIEWINVERSE: semanticObject;

    var PROJECTIONINVERSE: semanticObject;

    var MODELVIEWINVERSE: semanticObject;

    var MODELVIEWPROJECTIONINVERSE: semanticObject;

    var MODELINVERSETRANSPOSE: semanticObject;

    var MODELVIEWINVERSETRANSPOSE: semanticObject;

    var VIEWPORT: semanticObject;

    var JOINTMATRIX: semanticObject;

    var JOINTMATRIXTEXTURE: semanticObject;

    var JOINTMATRIXTEXTURESIZE: semanticObject;

    var NORMALMAPSCALE: semanticObject;

    var SHININESS: semanticObject;

    var SPECULARENVMATRIX: semanticObject;

    var REFLECTIVITY: semanticObject;

    var REFRACTRATIO: semanticObject;

    var REFRACTIVITY: semanticObject;

    var AMBIENTLIGHTSCOLOR: semanticObject;

    var DIRECTIONALLIGHTSCOLOR: semanticObject;

    var DIRECTIONALLIGHTSINFO: semanticObject;

    var DIRECTIONALLIGHTSSHADOWMAP: semanticObject;

    var DIRECTIONALLIGHTSSHADOWMAPSIZE: semanticObject;

    var DIRECTIONALLIGHTSSHADOWBIAS: semanticObject;

    var DIRECTIONALLIGHTSPACEMATRIX: semanticObject;

    var POINTLIGHTSPOS: semanticObject;

    var POINTLIGHTSCOLOR: semanticObject;

    var POINTLIGHTSINFO: semanticObject;

    var POINTLIGHTSSHADOWMAP: semanticObject;

    var POINTLIGHTSSHADOWBIAS: semanticObject;

    var POINTLIGHTSPACEMATRIX: semanticObject;

    var SPOTLIGHTSPOS: semanticObject;

    var SPOTLIGHTSDIR: semanticObject;

    var SPOTLIGHTSCOLOR: semanticObject;

    var SPOTLIGHTSCUTOFFS: semanticObject;

    var SPOTLIGHTSINFO: semanticObject;

    var SPOTLIGHTSSHADOWMAP: semanticObject;

    var SPOTLIGHTSSHADOWMAPSIZE: semanticObject;

    var SPOTLIGHTSSHADOWBIAS: semanticObject;

    var SPOTLIGHTSPACEMATRIX: semanticObject;

    var FOGCOLOR: semanticObject;

    var FOGINFO: semanticObject;

    var POSITIONDECODEMAT: semanticObject;

    var NORMALDECODEMAT: semanticObject;

    var UVDECODEMAT: semanticObject;

    var BASECOLOR: semanticObject;

    var METALLIC: semanticObject;

    var ROUGHNESS: semanticObject;

    var DIFFUSEENVMAP: semanticObject;

    var BRDFLUT: semanticObject;

    var SPECULARENVMAP: semanticObject;

  }

  /**
   * semantic 对象
   */
  interface semanticObject {
    /**
     * 是否依赖 mesh
     */
    isDependMesh: boolean;
    /**
     * 是否不支持 instanced
     */
    notSupportInstanced: boolean;
    /**
     * 获取数据方法
     */
    get: Function;
  }

  class Color {
    /**
     * 颜色类
     */
    constructor();

    /**
     * 
     * @param r
     * @param g
     * @param b
     * @param a
     */
    constructor(r: number, g: number, b: number, a?: number);

    /**
     * 类名
     */
    className: string;

    isColor: boolean;

    /**
     * r
     */
    r: number;

    /**
     * g
     */
    g: number;

    /**
     * b
     */
    b: number;

    /**
     * a
     */
    a: number;

    /**
     * 转换到数组
     * @param array 转换到的数组
     * @param offset 数组偏移值
     */
    toRGBArray(array?: any, offset?: number): any;

    /**
     * 从数组赋值
     * @param array 数组
     * @param offset 数组偏移值
     */
    fromUintArray(array: any, offset?: number): Color;

    /**
     * 从十六进制值赋值
     * @param hex 颜色的十六进制值，可以以下形式："#ff9966", "ff9966", "#f96", "f96", 0xff9966
     */
    fromHEX(hex: string | number): Color;

    /**
     * 转16进制
     */
    toHEX(): string;

    isVector4: boolean;

    /**
     * 数据
     */
    elements: any;

    /**
     * Copy the values from one vec4 to this
     * @param m the source vector
     */
    copy(m: Color): Color;

    /**
     * Creates a new vec4 initialized with values from this vector
     */
    clone(): Color;

    /**
     * 转换到数组
     * @param array 数组
     * @param offset 数组偏移值
     */
    toArray(array?: any, offset?: number): any;

    /**
     * 从数组赋值
     * @param array 数组
     * @param offset 数组偏移值
     */
    fromArray(array: any, offset?: number): Color;

    /**
     * Set the components of a vec4 to the given values
     * @param x X component
     * @param y Y component
     * @param z Z component
     * @param w W component
     * @returns this
     */
    set(x: number, y: number, z: number, w: number): Color;

    /**
     * Adds two vec4's
     * @param a
     * @param b 如果不传，计算 this 和 a 的和
     * @returns this
     */
    add(a: Color, b?: Color): Color;

    /**
     * Subtracts vector b from vector a
     * @param a
     * @param b 如果不传，计算 this 和 a 的差
     * @returns this
     */
    subtract(a: Color, b?: Color): Color;

    /**
     * Multiplies two vec4's
     * @param a
     * @param b 如果不传，计算 this 和 a 的积
     * @returns this
     */
    multiply(a: Color, b?: Color): Color;

    /**
     * Divides two vec4's
     * @param a
     * @param b 如果不传，计算 this 和 a 的商
     * @returns this
     */
    divide(a: Color, b?: Color): Color;

    /**
     * Math.ceil the components of this
     * @returns this
     */
    ceil(): Color;

    /**
     * Math.floor the components of this
     * @returns this
     */
    floor(): Color;

    /**
     * Returns the minimum of two vec4's
     * @param a
     * @param b 如果不传，计算 this 和 a 的结果
     * @returns this
     */
    min(a: Color, b?: Color): Color;

    /**
     * Returns the maximum of two vec4's
     * @param a
     * @param b 如果不传，计算 this 和 a 的结果
     * @returns this
     */
    max(a: Color, b?: Color): Color;

    /**
     * Math.round the components of this
     * @returns this
     */
    round(): Color;

    /**
     * Scales this by a scalar number
     * @param scale amount to scale the vector by
     * @returns this
     */
    scale(scale: number): Color;

    /**
     * Adds two vec4's after scaling the second vector by a scalar value
     * @param scale the amount to scale the second vector by before adding
     * @param a
     * @param b 如果不传，计算 this 和 a 的结果
     * @returns this
     */
    scaleAndAdd(scale: number, a: Color, b?: Color): Color;

    /**
     * Calculates the euclidian distance between two vec4's
     * @param a
     * @param b 如果不传，计算 this 和 a 的结果
     */
    distance(a: Color, b?: Color): number;

    /**
     * Calculates the squared euclidian distance between two vec4's
     * @param a
     * @param b 如果不传，计算 this 和 a 的结果
     */
    squaredDistance(a: Color, b?: Color): number;

    /**
     * Calculates the length of this
     */
    length(): number;

    /**
     * Calculates the squared length of this
     */
    squaredLength(): number;

    /**
     * Negates the components of this
     * @returns this
     */
    negate(): Color;

    /**
     * Returns the inverse of the components of a vec4
     * @param a
     * @returns this
     */
    inverse(a?: Color): Color;

    /**
     * Normalize this
     * @returns this
     */
    normalize(): Color;

    /**
     * Calculates the dot product of two vec4's
     * @param a
     * @param b 如果不传，计算 this 和 a 的结果
     */
    dot(a: Color, b?: Color): number;

    /**
     * Performs a linear interpolation between two vec4's
     * @param v
     * @param t interpolation amount between the two vectors
     * @returns this
     */
    lerp(v: Color, t: number): Color;

    /**
     * Generates a random vector with the given scale
     * @param scale Length of the resulting vector. If ommitted, a unit vector will be returned
     * @returns this
     */
    random(scale?: number): Color;

    /**
     * Transforms the vec4 with a mat4
     * @param m matrix to transform with
     * @returns this
     */
    transformMat4(m: Matrix4): Color;

    /**
     * Transforms the vec4 with a quat
     * @param q quaternion to transform with
     * @returns this
     */
    transformQuat(q: Quaternion): Color;

    /**
     * Returns whether or not the vectors have exactly the same elements in the same position (when compared with ===)
     * @param a
     * @param b 如果不传，计算 this 和 a 的结果
     */
    exactEquals(a: Color, b?: Color): boolean;

    /**
     * Returns whether or not the vectors have approximately the same elements in the same position.
     * @param a
     * @param b 如果不传，计算 this 和 a 的结果
     */
    equals(a: Color, b?: Color): boolean;

    /**
     * X component
     */
    x: number;

    /**
     * Y component
     */
    y: number;

    /**
     * Z component
     */
    z: number;

    /**
     * W component
     */
    w: number;

    /**
     * Alias for {@link Color#subtract}
     */
    sub: Color['subtract'];

    /**
     * Alias for {@link Color#multiply}
     */
    mul: Color['multiply'];

    /**
     * Alias for {@link Color#divide}
     */
    div: Color['divide'];

    /**
     * Alias for {@link Color#distance}
     */
    dist: Color['distance'];

    /**
     * Alias for {@link Color#squaredDistance}
     */
    sqrDist: Color['squaredDistance'];

    /**
     * Alias for {@link Color#length}
     */
    len: Color['length'];

    /**
     * Alias for {@link Color#squaredLength}
     */
    sqrLen: Color['squaredLength'];
  }

  class Euler {
    constructor();

    /**
     * 
     * @param x X component
     * @param y Y component
     * @param z Z component
     */
    constructor(x?: number, y?: number, z?: number);

    /**
     * 类名
     */
    className: string;

    isEuler: boolean;

    /**
     * 旋转顺序，默认为 ZYX
     */
    order: string;

    elements: number[];

    /**
     * 克隆
     */
    clone(): Euler;

    /**
     * 复制
     * @param euler
     */
    copy(euler: Euler): Euler;

    /**
     * Set the components of a euler to the given values
     * @param x X component
     * @param y X component
     * @param z Z component
     */
    set(x: number, y: number, z: number): Euler;

    /**
     * 从数组赋值
     * @param array 数组
     * @param offset 数组偏移值
     */
    fromArray(array: any, offset?: number): Euler;

    /**
     * 转换到数组
     * @param array 数组
     * @param offset 数组偏移值
     */
    toArray(array?: any, offset?: number): any;

    /**
     * Creates a euler from the given 4x4 rotation matrix.
     * @param mat rotation matrix
     * @param order 旋转顺序，默认为当前Euler实例的order
     */
    fromMat4(mat: Matrix4, order?: string): Euler;

    /**
     * Creates a euler from the given quat.
     * @param quat
     * @param order 旋转顺序，默认为当前Euler实例的order
     */
    fromQuat(quat: Quaternion, order?: string): Euler;

    /**
     * X component
     */
    x: number;

    /**
     * Y component
     */
    y: number;

    /**
     * Z component
     */
    z: number;

  }

  class Frustum {
    /**
     * 平截头体
     */
    constructor();

    constructor();

    /**
     * 类名
     */
    className: string;

    isFrustum: boolean;

    /**
     * Copy the values from one frustum to this
     * @param m the source frustum
     */
    copy(m: Frustum): Frustum;

    /**
     * Creates a new frustum initialized with values from this frustum
     */
    clone(): Frustum;

    /**
     * fromMatrix
     * @param mat
     */
    fromMatrix(mat: Matrix4): Frustum;

    /**
     * 与球体相交
     * @param sphere
     */
    intersectsSphere(sphere: Sphere): boolean;

  }

  class Matrix3 {
    /**
     * 3x3 矩阵
     */
    constructor();

    /**
     * Creates a new identity mat3
     */
    constructor();

    /**
     * 类名
     */
    className: string;

    isMatrix3: boolean;

    /**
     * 数据
     */
    elements: any;

    /**
     * Copy the values from one mat3 to this
     * @param m the source matrix
     */
    copy(m: Matrix3): Matrix3;

    /**
     * Creates a new mat3 initialized with values from this matrix
     */
    clone(): Matrix3;

    /**
     * 转换到数组
     * @param array 数组
     * @param offset 数组偏移值
     */
    toArray(array?: any, offset?: number): any;

    /**
     * 从数组赋值
     * @param array 数组
     * @param offset 数组偏移值
     */
    fromArray(array: any, offset?: number): Matrix3;

    /**
     * Set the components of a mat3 to the given values
     * @param m00
     * @param m01
     * @param m02
     * @param m10
     * @param m11
     * @param m12
     * @param m20
     * @param m21
     * @param m22
     */
    set(m00: number, m01: number, m02: number, m10: number, m11: number, m12: number, m20: number, m21: number, m22: number): Matrix3;

    /**
     * Set this to the identity matrix
     */
    identity(): Matrix3;

    /**
     * Transpose the values of this
     */
    transpose(): Matrix3;

    /**
     * invert a matrix
     * @param m
     */
    invert(m?: Matrix3): Matrix3;

    /**
     * Calculates the adjugate of a mat3
     * @param m
     */
    adjoint(m?: Matrix3): Matrix3;

    /**
     * Calculates the determinant of this
     */
    determinant(): number;

    /**
     * Multiplies two matrix3's
     * @param a
     * @param b 如果不传，计算 this 和 a 的乘积
     */
    multiply(a: Matrix3, b?: Matrix3): Matrix3;

    /**
     * 左乘
     * @param m
     */
    premultiply(m: Matrix3): Matrix3;

    /**
     * Translate this by the given vector
     * @param v vector to translate by
     */
    translate(v: Vector2): Matrix3;

    /**
     * Rotates this by the given angle
     * @param rad the angle to rotate the matrix by
     */
    rotate(rad: number): Matrix3;

    /**
     * Scales the mat3 by the dimensions in the given vec2
     * @param v the vec2 to scale the matrix by
     */
    scale(v: Vector2): Matrix3;

    /**
     * Creates a matrix from a vector translation
     * @param v Translation vector
     */
    fromTranslation(v: Vector2): Matrix3;

    /**
     * Creates a matrix from a given angle
     * @param rad the angle to rotate the matrix by
     */
    fromRotation(rad: number): Matrix3;

    /**
     * Creates a matrix from a vector scaling
     * @param v Scaling vector
     */
    fromScaling(v: Vector2): Matrix3;

    /**
     * Calculates a 3x3 matrix from the given quaternion
     * @param q Quaternion to create matrix from
     */
    fromQuat(q: Quaternion): Matrix3;

    /**
     * Calculates a 3x3 normal matrix (transpose inverse) from the 4x4 matrix
     * @param m Mat4 to derive the normal matrix from
     */
    normalFromMat4(m: Matrix4): Matrix3;

    /**
     * Copies the upper-left 3x3 values into the given mat3.
     * @param m the source 4x4 matrix
     */
    fromMat4(m: Matrix4): Matrix3;

    /**
     * Returns Frobenius norm of this
     */
    frob(): number;

    /**
     * Adds two mat3's
     * @param a
     * @param b 如果不传，计算 this 和 a 的和
     */
    add(a: Matrix3, b?: Matrix3): Matrix3;

    /**
     * Subtracts matrix b from matrix a
     * @param a
     * @param b 如果不传，计算 this 和 a 的差
     */
    subtract(a: Matrix3, b?: Matrix3): Matrix3;

    /**
     * Returns whether or not the matrices have exactly the same elements in the same position (when compared with ===)
     * @param a
     * @param b 如果不传，比较 this 和 a 是否相等
     */
    exactEquals(a: Matrix3, b?: Matrix3): boolean;

    /**
     * Returns whether or not the matrices have approximately the same elements in the same position.
     * @param a
     * @param b 如果不传，比较 this 和 a 是否近似相等
     */
    equals(a: Matrix3, b?: Matrix3): boolean;

    /**
     * fromRotationTranslationScale
     * @param r rad angle
     * @param x
     * @param y
     * @param scaleX
     * @param scaleY
     */
    fromRotationTranslationScale(r: number, x: number, y: number, scaleX: number, scaleY: number): Matrix3;

    /**
     * Alias for {@link Vector4#subtract}
     */
    sub: Matrix3['subtract'];

    /**
     * Alias for {@link Vector4#multiply}
     */
    mul: Matrix3['multiply'];
  }

  /**
   * 含x, y, z属性的对象
   */
  interface XYZObject {
    x: number;
    y: number;
    z: number;
  }

  class Matrix4 {
    /**
     * 4x4 矩阵
     */
    constructor();

    /**
     * Creates a new identity mat4
     */
    constructor();

    /**
     * 类名
     */
    className: string;

    isMatrix4: boolean;

    /**
     * 数据
     */
    elements: any;

    /**
     * Copy the values from one mat4 to this
     * @param m the source matrix
     */
    copy(m: Matrix4): Matrix4;

    /**
     * Creates a new mat4 initialized with values from this matrix
     */
    clone(): Matrix4;

    /**
     * 转换到数组
     * @param array 数组
     * @param offset 数组偏移值
     */
    toArray(array?: any, offset?: number): any;

    /**
     * 从数组赋值
     * @param array 数组
     * @param offset 数组偏移值
     */
    fromArray(array: any, offset?: number): Matrix4;

    /**
     * Set the components of a mat3 to the given values
     * @param m00
     * @param m01
     * @param m02
     * @param m03
     * @param m10
     * @param m11
     * @param m12
     * @param m13
     * @param m20
     * @param m21
     * @param m22
     * @param m23
     * @param m30
     * @param m31
     * @param m32
     * @param m33
     */
    set(m00: number, m01: number, m02: number, m03: number, m10: number, m11: number, m12: number, m13: number, m20: number, m21: number, m22: number, m23: number, m30: number, m31: number, m32: number, m33: number): Matrix4;

    /**
     * Set this to the identity matrix
     */
    identity(): Matrix4;

    /**
     * Transpose the values of this
     */
    transpose(): Matrix4;

    /**
     * invert a matrix
     * @param m
     */
    invert(m?: Matrix4): Matrix4;

    /**
     * Calculates the adjugate of a mat4
     * @param m
     */
    adjoint(m?: Matrix4): Matrix4;

    /**
     * Calculates the determinant of this
     */
    determinant(): Matrix4;

    /**
     * Multiplies two matrix4's
     * @param a
     * @param b 如果不传，计算 this 和 a 的乘积
     */
    multiply(a: Matrix4, b?: Matrix4): Matrix4;

    /**
     * 左乘
     * @param m
     */
    premultiply(m: Matrix4): Matrix4;

    /**
     * Translate this by the given vector
     * @param v vector to translate by
     */
    translate(v: Vector3): Matrix4;

    /**
     * Scales the mat3 by the dimensions in the given vec2
     * @param v the vec3 to scale the matrix by
     */
    scale(v: Vector3): Matrix4;

    /**
     * Rotates this by the given angle
     * @param rad the angle to rotate the matrix by
     * @param axis the axis to rotate around
     */
    rotate(rad: number, axis: Vector3): Matrix4;

    /**
     * Rotates this by the given angle around the X axis
     * @param rad the angle to rotate the matrix by
     */
    rotateX(rad: number): Matrix4;

    /**
     * Rotates this by the given angle around the Y axis
     * @param rad the angle to rotate the matrix by
     */
    rotateY(rad: number): Matrix4;

    /**
     * Rotates this by the given angle around the Z axis
     * @param rad the angle to rotate the matrix by
     */
    rotateZ(rad: number): Matrix4;

    /**
     * Creates a matrix from a vector translation
     * @param transition Translation vector
     */
    fromTranslation(transition: Vector3): Matrix4;

    /**
     * Creates a matrix from a vector scaling
     * @param v Scaling vector
     */
    fromScaling(v: Vector3): Matrix4;

    /**
     * Creates a matrix from a given angle around a given axis
     * @param rad the angle to rotate the matrix by
     * @param axis the axis to rotate around
     */
    fromRotation(rad: number, axis: Vector3): Matrix4;

    /**
     * Creates a matrix from the given angle around the X axis
     * @param rad the angle to rotate the matrix by
     */
    fromXRotation(rad: number): Matrix4;

    /**
     * Creates a matrix from the given angle around the Y axis
     * @param rad the angle to rotate the matrix by
     */
    fromYRotation(rad: number): Matrix4;

    /**
     * Creates a matrix from the given angle around the Z axis
     * @param rad the angle to rotate the matrix by
     */
    fromZRotation(rad: number): Matrix4;

    /**
     * Creates a matrix from a quaternion rotation and vector translation
     * @param q Rotation quaternion
     * @param v Translation vector
     */
    fromRotationTranslation(q: Quaternion, v: Vector3): Matrix4;

    /**
     * Returns the translation vector component of a transformation
     * matrix. If a matrix is built with fromRotationTranslation,
     * the returned vector will be the same as the translation vector
     * originally supplied.
     * @param out Vector to receive translation component
     */
    getTranslation(out?: Vector3): Vector3;

    /**
     * Returns the scaling factor component of a transformation
     * matrix. If a matrix is built with fromRotationTranslationScale
     * with a normalized Quaternion paramter, the returned vector will be
     * the same as the scaling vector
     * originally supplied.
     * @param out Vector to receive scaling factor component
     */
    getScaling(out?: Vector3): Vector3;

    /**
     * Returns a quaternion representing the rotational component
     * of a transformation matrix. If a matrix is built with
     * fromRotationTranslation, the returned quaternion will be the
     * same as the quaternion originally supplied.
     * @param out Quaternion to receive the rotation component
     */
    getRotation(out: Quaternion): Quaternion;

    /**
     * Creates a matrix from a quaternion rotation, vector translation and vector scale
     * @param q Rotation quaternion
     * @param v Translation vector
     * @param s Scaling vector
     */
    fromRotationTranslationScale(q: Quaternion, v: Vector3, s: Vector3): Matrix4;

    /**
     * Creates a matrix from a quaternion rotation, vector translation and vector scale, rotating and scaling around the given origin
     * @param q Rotation quaternion
     * @param v Translation vector
     * @param s Scaling vector
     * @param o The origin vector around which to scale and rotate
     */
    fromRotationTranslationScaleOrigin(q: Quaternion, v: Vector3, s: Vector3, o: Vector3): Matrix4;

    /**
     * Calculates a 4x4 matrix from the given quaternion
     * @param q Quaternion to create matrix from
     */
    fromQuat(q: Quaternion): Matrix4;

    /**
     * Generates a frustum matrix with the given bounds
     * @param left Left bound of the frustum
     * @param right Right bound of the frustum
     * @param bottom Bottom bound of the frustum
     * @param top Top bound of the frustum
     * @param near Near bound of the frustum
     * @param far Far bound of the frustum
     */
    frustum(left: number, right: number, bottom: number, top: number, near: number, far: number): Matrix4;

    /**
     * Generates a perspective projection matrix with the given bounds
     * @param fovy Vertical field of view in radians
     * @param aspect Aspect ratio. typically viewport width/height
     * @param near Near bound of the frustum
     * @param far Far bound of the frustum
     */
    perspective(fovy: number, aspect: number, near: number, far: number): Matrix4;

    /**
     * Generates a perspective projection matrix with the given field of view.
     * @param fov Object containing the following values: upDegrees, downDegrees, leftDegrees, rightDegrees
     * @param Near bound of the frustum
     * @param far Far bound of the frustum
     */
    perspectiveFromFieldOfView(fov: Object, Near: number, far: number): Matrix4;

    /**
     * Generates a orthogonal projection matrix with the given bounds
     * @param left Left bound of the frustum
     * @param right Right bound of the frustum
     * @param bottom Bottom bound of the frustum
     * @param top Top bound of the frustum
     * @param near Near bound of the frustum
     * @param far Far bound of the frustum
     */
    ortho(left: number, right: number, bottom: number, top: number, near: number, far: number): Matrix4;

    /**
     * Generates a look-at matrix with the given eye position, focal point, and up axis
     * @param eye Position of the viewer
     * @param center Point the viewer is looking at
     * @param up pointing up
     */
    lookAt(eye: XYZObject, center: XYZObject, up: Vector3): Matrix4;

    /**
     * Generates a matrix that makes something look at something else.
     * @param eye Position of the viewer
     * @param Point the viewer is looking at
     * @param up pointing up
     */
    targetTo(eye: XYZObject, Point: XYZObject, up: Vector3): Matrix4;

    /**
     * Returns Frobenius norm of a mat4
     */
    frob(): number;

    /**
     * Adds two mat4's
     * @param a
     * @param b 如果不传，计算 this 和 a 的和
     */
    add(a: Matrix4, b?: Matrix4): Matrix4;

    /**
     * Subtracts matrix b from matrix a
     * @param a
     * @param b 如果不传，计算 this 和 a 的差
     */
    subtract(a: Matrix4, b?: Matrix4): Matrix4;

    /**
     * Returns whether or not the matrices have exactly the same elements in the same position (when compared with ===)
     * @param a
     * @param b 如果不传，比较 this 和 a 是否相等
     */
    exactEquals(a: Matrix4, b?: Matrix4): boolean;

    /**
     * Returns whether or not the matrices have approximately the same elements in the same position.
     * @param a
     * @param b 如果不传，比较 this 和 a 是否近似相等
     */
    equals(a: Matrix4, b?: Matrix4): boolean;

    /**
     * compose
     * @param q quaternion
     * @param v position
     * @param s scale
     * @param p [pivot]
     */
    compose(q: Quaternion, v: Vector3, s: Vector3, p: Vector3): Matrix4;

    /**
     * decompose
     * @param q quaternion
     * @param v position
     * @param s scale
     * @param p [pivot]
     */
    decompose(q: Quaternion, v: Vector3, s: Vector3, p: Vector3): Matrix4;

    /**
     * Alias for {@link Matrix4#subtract}
     */
    sub: Matrix4['subtract'];

    /**
     * Alias for {@link Matrix4#multiply}
     */
    mul: Matrix4['multiply'];

  }

  class Plane {
    /**
     * 平面
     */
    constructor();

    /**
     * 
     * @param normal 法线
     * @param distance 距离
     */
    constructor(normal?: Vector3, distance?: number);

    /**
     * 类名
     */
    className: string;

    isPlane: boolean;

    /**
     * Copy the values from one plane to this
     * @param m the source plane
     */
    copy(m: Plane): Plane;

    /**
     * Creates a new plane initialized with values from this plane
     */
    clone(): Plane;

    /**
     * [set description]
     * @param x 法线 x
     * @param y 法线 y
     * @param z 法线 z
     * @param w 距离
     */
    set(x: number, y: number, z: number, w: number): Plane;

    /**
     * 归一化
     */
    normalize(): Plane;

    /**
     * 与点的距离
     * @param point
     */
    distanceToPoint(point: Vector3): number;

    /**
     * 投影点
     * @param point
     */
    projectPoint(point: Vector3): Vector3;

  }

  class Quaternion {
    constructor();

    /**
     * Creates a new identity quat
     * @param x X component
     * @param y Y component
     * @param z Z component
     * @param w W component
     */
    constructor(x?: number, y?: number, z?: number, w?: number);

    /**
     * 类名
     */
    className: string;

    isQuaternion: boolean;

    elements: number[];

    /**
     * Copy the values from one quat to this
     * @param q
     * @param dontFireEvent wether or not don`t fire change event.
     */
    copy(q: Quaternion, dontFireEvent?: boolean): Quaternion;

    /**
     * Creates a new quat initialized with values from an existing quaternion
     */
    clone(): Quaternion;

    /**
     * 转换到数组
     * @param array 数组
     * @param offset 数组偏移值
     */
    toArray(array?: any, offset?: number): any;

    /**
     * 从数组赋值
     * @param array 数组
     * @param offset 数组偏移值
     * @param dontFireEvent wether or not don`t fire change event.
     */
    fromArray(array: any, offset?: number, dontFireEvent?: boolean): Quaternion;

    /**
     * Set the components of a quat to the given values
     * @param x X component
     * @param y Y component
     * @param z Z component
     * @param w W component
     * @param dontFireEvent wether or not don`t fire change event.
     */
    set(x: number, y: number, z: number, w: number, dontFireEvent?: boolean): Quaternion;

    /**
     * Set this to the identity quaternion
     * @param dontFireEvent wether or not don`t fire change event.
     */
    identity(dontFireEvent?: boolean): Quaternion;

    /**
     * Sets a quaternion to represent the shortest rotation from one
     * vector to another.
     * @param a the initial vector
     * @param b the destination vector
     * @param dontFireEvent wether or not don`t fire change event.
     */
    rotationTo(a: Vector3, b: Vector3, dontFireEvent?: boolean): Quaternion;

    /**
     * Sets the specified quaternion with values corresponding to the given
     * axes. Each axis is a vec3 and is expected to be unit length and
     * perpendicular to all other specified axes.
     * @param view the vector representing the viewing direction
     * @param right the vector representing the local "right" direction
     * @param up the vector representing the local "up" direction
     * @param dontFireEvent wether or not don`t fire change event.
     */
    setAxes(view: Vector3, right: Vector3, up: Vector3, dontFireEvent?: boolean): Quaternion;

    /**
     * Sets a quat from the given angle and rotation axis,
     * then returns it.
     * @param axis the axis around which to rotate
     * @param rad the angle in radians
     * @param dontFireEvent wether or not don`t fire change event.
     */
    setAxisAngle(axis: Vector3, rad: number, dontFireEvent?: boolean): Quaternion;

    /**
     * Gets the rotation axis and angle for a given
     * quaternion. If a quaternion is created with
     * setAxisAngle, this method will return the same
     * values as providied in the original parameter list
     * OR functionally equivalent values.
     * Example: The quaternion formed by axis [0, 0, 1] and
     * angle -90 is the same as the quaternion formed by
     * [0, 0, 1] and 270. This method favors the latter.
     * @param out_axis Vector receiving the axis of rotation
     */
    getAxisAngle(out_axis: Vector3): number;

    /**
     * Adds two quat's
     * @param q
     * @param dontFireEvent wether or not don`t fire change event.
     */
    add(q: Quaternion, dontFireEvent?: boolean): Quaternion;

    /**
     * Multiplies two quat's
     * @param q
     * @param dontFireEvent wether or not don`t fire change event.
     */
    multiply(q: Quaternion, dontFireEvent?: boolean): Quaternion;

    /**
     * premultiply the quat
     * @param q
     * @param dontFireEvent wether or not don`t fire change event.
     */
    premultiply(q: Quaternion, dontFireEvent?: boolean): Quaternion;

    /**
     * Scales a quat by a scalar number
     * @param scale the vector to scale
     * @param dontFireEvent wether or not don`t fire change event.
     */
    scale(scale: Vector3, dontFireEvent?: boolean): Quaternion;

    /**
     * Rotates a quaternion by the given angle about the X axis
     * @param rad angle (in radians) to rotate
     * @param dontFireEvent wether or not don`t fire change event.
     */
    rotateX(rad: number, dontFireEvent?: boolean): Quaternion;

    /**
     * Rotates a quaternion by the given angle about the Y axis
     * @param rad angle (in radians) to rotate
     * @param dontFireEvent wether or not don`t fire change event.
     */
    rotateY(rad: number, dontFireEvent?: boolean): Quaternion;

    /**
     * Rotates a quaternion by the given angle about the Z axis
     * @param rad angle (in radians) to rotate
     * @param dontFireEvent wether or not don`t fire change event.
     */
    rotateZ(rad: number, dontFireEvent?: boolean): Quaternion;

    /**
     * Calculates the W component of a quat from the X, Y, and Z components.
     * Assumes that quaternion is 1 unit in length.
     * Any existing W component will be ignored.
     * @param dontFireEvent wether or not don`t fire change event.
     * @returns this
     */
    calculateW(dontFireEvent?: boolean): Quaternion;

    /**
     * Calculates the dot product of two quat's
     * @param q
     */
    dot(q: Quaternion): number;

    /**
     * Performs a linear interpolation between two quat's
     * @param q
     * @param t interpolation amount between the two inputs
     * @param dontFireEvent wether or not don`t fire change event.
     */
    lerp(q: Quaternion, t: number, dontFireEvent?: boolean): Quaternion;

    /**
     * Performs a spherical linear interpolation between two quat
     * @param q
     * @param t interpolation amount between the two inputs
     * @param dontFireEvent wether or not don`t fire change event.
     */
    slerp(q: Quaternion, t: number, dontFireEvent?: boolean): Quaternion;

    /**
     * Performs a spherical linear interpolation with two control points
     * @param qa
     * @param qb
     * @param qc
     * @param qd
     * @param t interpolation amount
     * @param dontFireEvent wether or not don`t fire change event.
     */
    sqlerp(qa: Quaternion, qb: Quaternion, qc: Quaternion, qd: Quaternion, t: number, dontFireEvent?: boolean): Quaternion;

    /**
     * Calculates the inverse of a quat
     * @param dontFireEvent wether or not don`t fire change event.
     */
    invert(dontFireEvent?: boolean): Quaternion;

    /**
     * Calculates the conjugate of a quat
     * If the quaternion is normalized, this function is faster than quat.inverse and produces the same result.
     * @param dontFireEvent wether or not don`t fire change event.
     */
    conjugate(dontFireEvent?: boolean): Quaternion;

    /**
     * Calculates the length of a quat
     */
    length(): number;

    /**
     * Calculates the squared length of a quat
     */
    squaredLength(): number;

    /**
     * Normalize this
     * @param dontFireEvent wether or not don`t fire change event.
     */
    normalize(dontFireEvent?: boolean): Quaternion;

    /**
     * Creates a quaternion from the given 3x3 rotation matrix.
     * 
     * NOTE: The resultant quaternion is not normalized, so you should be sure
     * to renormalize the quaternion yourself where necessary.
     * @param m rotation matrix
     * @param dontFireEvent wether or not don`t fire change event.
     */
    fromMat3(m: Matrix3, dontFireEvent?: boolean): Quaternion;

    /**
     * Creates a quaternion from the given 3x3 rotation matrix.
     * 
     * NOTE: The resultant quaternion is not normalized, so you should be sure
     * to renormalize the quaternion yourself where necessary.
     * @param m rotation matrix
     * @param dontFireEvent wether or not don`t fire change event.
     */
    fromMat4(m: Matrix4, dontFireEvent?: boolean): Quaternion;

    /**
     * Returns whether or not the quaternions have exactly the same elements in the same position (when compared with ===)
     * @param q
     */
    exactEquals(q: Quaternion): boolean;

    /**
     * Returns whether or not the quaternions have approximately the same elements in the same position.
     * @param q
     */
    equals(q: Quaternion): boolean;

    /**
     * Creates a quaternion from the given euler.
     * @param euler
     * @param dontFireEvent wether or not don`t fire change event.
     */
    fromEuler(euler: Euler, dontFireEvent?: boolean): Quaternion;

    /**
     * X component
     */
    x: number;

    /**
     * Y component
     */
    y: number;

    /**
     * Z component
     */
    z: number;

    /**
     * W component
     */
    w: number;

    /**
     * Alias for {@link Quaternion#multiply}
     */
    mul: Quaternion['multiply'];

    /**
     * Alias for {@link Quaternion#length}
     */
    len: Quaternion['length'];

    /**
     * Alias for {@link Quaternion#squaredLength}
     */
    sqrLen: Quaternion['squaredLength'];

  }

  class Ray {
    /**
     * 射线
     */
    constructor();

    /**
     * 
     * @param params
     * @param params.origin 原点
     * @param params.direction 方向
     */
    constructor(params?: undefined_params);

    /**
     * 类名
     */
    className: string;

    /**
     * 是否是射线
     */
    isRay: boolean;

    /**
     * 原点
     */
    origin: Vector3;

    /**
     * 方向
     */
    direction: Vector3;

    /**
     * set
     * @param origin
     * @param direction
     */
    set(origin: Vector3, direction: Vector3): Ray;

    /**
     * copy
     * @param other
     */
    copy(other: Vector3): Ray;

    /**
     * clone
     */
    clone(): Ray;

    /**
     * 从摄像机设置
     * @param camera
     * @param x 屏幕x
     * @param y 屏幕y
     * @param width 屏幕宽
     * @param height 屏幕高
     */
    fromCamera(camera: Camera, x: number, y: number, width: number, height: number): void;

    /**
     * Transforms the ray with a mat4
     * @param mat4
     */
    transformMat4(mat4: Matrix4): void;

    /**
     * 排序碰撞点
     * @param points
     * @param pointName
     */
    sortPoints(points: Vector3[] | raycastInfo[], pointName?: string): void;

    /**
     * squaredDistance
     * @param point
     */
    squaredDistance(point: Vector3): number;

    /**
     * distance
     * @param point
     */
    distance(point: Vector3): number;

    /**
     * intersectsSphere
     * @param center [x, y, z]
     * @param radius
     */
    intersectsSphere(center: number[], radius: number): Vector3;

    /**
     * intersectsPlane
     * @param normal [x, y, z]
     * @param distance
     */
    intersectsPlane(normal: number[], distance: number): Vector3;

    /**
     * intersectsTriangle
     * @param triangle [[a.x, a.y, a.z], [b.x, b.y, b.z],[c.x, c.y, c.z]]
     */
    intersectsTriangle(triangle: any): Vector3;

    /**
     * intersectsBox
     * @param aabb [[min.x, min.y, min.z], [max.x, max.y, max.z]]
     */
    intersectsBox(aabb: any): Vector3;

    /**
     * intersectsTriangleCell
     * @param cell
     * @param positions
     */
    intersectsTriangleCell(cell: any, positions: any): Vector3;

  }

  interface undefined_params {
    /**
     * 是否跨域
     */
    crossOrigin: boolean;
    /**
     * 占位图片，默认为1像素的透明图片
     */
    placeHolder: Image;
    /**
     * 是否自动加载
     */
    autoLoad: boolean;
    /**
     * 图片地址
     */
    src: string;
  }

  class Sphere {
    /**
     * 
     * @param params 初始化参数，所有params都会复制到实例上
     */
    constructor(params?: {
      /**
       * 半径
       */
      radius: number;
    });

    /**
     * 类名
     */
    className: string;

    isSphere: boolean;

    /**
     * 半径
     */
    radius: number;

    /**
     * 克隆
     */
    clone(): Sphere;

    /**
     * 复制
     * @param sphere
     */
    copy(sphere: Sphere): Sphere;

    /**
     * 从点生成
     * @param points
     */
    fromPoints(points: any): Sphere;

    /**
     * transformMat4
     * @param mat4
     */
    transformMat4(mat4: Matrix4): Sphere;

  }

  class Vector2 {
    /**
     * 二维向量
     */
    constructor();

    /**
     * Creates a new empty vec2
     * @param x X component
     * @param y Y component
     */
    constructor(x?: number, y?: number);

    /**
     * 类名
     */
    className: string;

    isVector2: boolean;

    /**
     * 数据
     */
    elements: any;

    /**
     * Copy the values from one vec2 to this
     * @param m the source vector
     */
    copy(m: Vector2): Vector2;

    /**
     * Creates a new vec2 initialized with values from this vector
     */
    clone(): Vector2;

    /**
     * 转换到数组
     * @param array 数组
     * @param offset 数组偏移值
     */
    toArray(array?: any, offset?: number): any;

    /**
     * 从数组赋值
     * @param array 数组
     * @param offset 数组偏移值
     */
    fromArray(array: any, offset?: number): Vector2;

    /**
     * Set the components of a vec4 to the given values
     * @param x X component
     * @param y Y component
     * @returns this
     */
    set(x: number, y: number): Vector2;

    /**
     * Adds two vec2's
     * @param a
     * @param b 如果不传，计算 this 和 a 的和
     * @returns this
     */
    add(a: Vector2, b?: Vector2): Vector2;

    /**
     * Subtracts vector b from vector a
     * @param a
     * @param b 如果不传，计算 this 和 a 的差
     * @returns this
     */
    subtract(a: Vector2, b?: Vector2): Vector2;

    /**
     * Multiplies two vec2's
     * @param a
     * @param b 如果不传，计算 this 和 a 的积
     * @returns this
     */
    multiply(a: Vector2, b?: Vector2): Vector2;

    /**
     * Divides two vec2's
     * @param a
     * @param b 如果不传，计算 this 和 a 的商
     * @returns this
     */
    divide(a: Vector2, b?: Vector2): Vector2;

    /**
     * Math.ceil the components of this
     * @returns this
     */
    ceil(): Vector2;

    /**
     * Math.floor the components of this
     * @returns this
     */
    floor(): Vector2;

    /**
     * Returns the minimum of two vec2's
     * @param a
     * @param b 如果不传，计算 this 和 a 的结果
     * @returns this
     */
    min(a: Vector2, b?: Vector2): Vector2;

    /**
     * Returns the maximum of two vec2's
     * @param a
     * @param b 如果不传，计算 this 和 a 的结果
     * @returns this
     */
    max(a: Vector2, b?: Vector2): Vector2;

    /**
     * Math.round the components of this
     * @returns this
     */
    round(): Vector2;

    /**
     * Scales this by a scalar number
     * @param scale amount to scale the vector by
     * @returns this
     */
    scale(scale: number): Vector2;

    /**
     * Adds two vec2's after scaling the second vector by a scalar value
     * @param scale the amount to scale the second vector by before adding
     * @param a
     * @param b 如果不传，计算 this 和 a 的结果
     * @returns this
     */
    scaleAndAdd(scale: number, a: Vector2, b?: Vector2): Vector2;

    /**
     * Calculates the euclidian distance between two vec2's
     * @param a
     * @param b 如果不传，计算 this 和 a 的结果
     */
    distance(a: Vector2, b?: Vector2): number;

    /**
     * Calculates the squared euclidian distance between two vec2's
     * @param a
     * @param b 如果不传，计算 this 和 a 的结果
     */
    squaredDistance(a: Vector2, b?: Vector2): number;

    /**
     * Calculates the length of this
     */
    length(): number;

    /**
     * Calculates the squared length of this
     */
    squaredLength(): number;

    /**
     * Negates the components of this
     * @returns this
     */
    negate(): Vector2;

    /**
     * Returns the inverse of the components of a vec2
     * @param a
     * @returns this
     */
    inverse(a?: Vector2): Vector2;

    /**
     * Normalize this
     * @returns this
     */
    normalize(): Vector2;

    /**
     * Calculates the dot product of two vec2's
     * @param a
     * @param b 如果不传，计算 this 和 a 的结果
     */
    dot(a: Vector2, b?: Vector2): number;

    /**
     * Computes the cross product of two vec2's
     * @param a
     * @param b 如果不传，计算 this 和 a 的结果
     */
    cross(a: Vector2, b?: Vector2): Vector2;

    /**
     * Performs a linear interpolation between two vec2's
     * @param v
     * @param t interpolation amount between the two vectors
     * @returns this
     */
    lerp(v: Vector2, t: number): Vector2;

    /**
     * Generates a random vector with the given scale
     * @param scale Length of the resulting vector. If ommitted, a unit vector will be returned
     * @returns this
     */
    random(scale?: number): Vector2;

    /**
     * Transforms the vec2 with a mat3
     * @param m matrix to transform with
     * @returns this
     */
    transformMat3(m: Matrix3): Vector2;

    /**
     * Transforms the vec2 with a mat4
     * @param m matrix to transform with
     * @returns this
     */
    transformMat4(m: Matrix4): Vector2;

    /**
     * Returns whether or not the vectors have exactly the same elements in the same position (when compared with ===)
     * @param a
     * @param b 如果不传，计算 this 和 a 的结果
     */
    exactEquals(a: Vector2, b?: Vector2): boolean;

    /**
     * Returns whether or not the vectors have approximately the same elements in the same position.
     * @param a
     * @param b 如果不传，计算 this 和 a 的结果
     */
    equals(a: Vector2, b?: Vector2): boolean;

    /**
     * X component
     */
    x: number;

    /**
     * Y component
     */
    y: number;

    /**
     * Alias for {@link Vector2#subtract}
     */
    sub: Color['subtract'];

    /**
     * Alias for {@link Vector2#multiply}
     */
    mul: Vector2['multiply'];

    /**
     * Alias for {@link Vector2#divide}
     */
    div: Vector2['divide'];

    /**
     * Alias for {@link Vector2#distance}
     */
    dist: Vector2['distance'];

    /**
     * Alias for {@link Vector2#squaredDistance}
     */
    sqrDist: Vector2['squaredDistance'];

    /**
     * Alias for {@link Vector2#length}
     */
    len: Vector2['length'];

    /**
     * Alias for {@link Vector2#squaredLength}
     */
    sqrLen: Vector2['squaredLength'];

  }

  class Vector3 {
    /**
     * 三维向量
     */
    constructor();

    /**
     * Creates a new empty vec3
     * @param x X component
     * @param y Y component
     * @param z Z component
     */
    constructor(x?: number, y?: number, z?: number);

    /**
     * 类名
     */
    className: string;

    isVector3: boolean;

    /**
     * 数据
     */
    elements: any;

    /**
     * Copy the values from one vec3 to this
     * @param m the source vector
     */
    copy(m: Vector3): Vector3;

    /**
     * Creates a new vec3 initialized with values from this vec3
     */
    clone(): Vector3;

    /**
     * 转换到数组
     * @param array 数组
     * @param offset 数组偏移值
     */
    toArray(array?: any, offset?: number): any;

    /**
     * 从数组赋值
     * @param array 数组
     * @param offset 数组偏移值
     */
    fromArray(array: any, offset?: number): Vector3;

    /**
     * Set the components of a vec3 to the given values
     * @param x X component
     * @param y Y component
     * @param z Z component
     * @returns this
     */
    set(x: number, y: number, z: number): Vector3;

    /**
     * Adds two vec3's
     * @param a
     * @param b 如果不传，计算 this 和 a 的和
     * @returns this
     */
    add(a: Vector3, b?: Vector3): Vector3;

    /**
     * Subtracts vector b from vector a
     * @param a
     * @param b 如果不传，计算 this 和 a 的差
     * @returns this
     */
    subtract(a: Vector3, b?: Vector3): Vector3;

    /**
     * Multiplies two vec3's
     * @param a
     * @param b 如果不传，计算 this 和 a 的积
     * @returns this
     */
    multiply(a: Vector3, b?: Vector3): Vector3;

    /**
     * Divides two vec3's
     * @param a
     * @param b 如果不传，计算 this 和 a 的商
     * @returns this
     */
    divide(a: Vector3, b?: Vector3): Vector3;

    /**
     * Math.ceil the components of this
     * @returns this
     */
    ceil(): Vector3;

    /**
     * Math.floor the components of this
     * @returns this
     */
    floor(): Vector3;

    /**
     * Returns the minimum of two vec3's
     * @param a
     * @param b 如果不传，计算 this 和 a 的结果
     * @returns this
     */
    min(a: Vector3, b?: Vector3): Vector3;

    /**
     * Returns the maximum of two vec3's
     * @param a
     * @param b 如果不传，计算 this 和 a 的结果
     * @returns this
     */
    max(a: Vector3, b?: Vector3): Vector3;

    /**
     * Math.round the components of this
     * @returns this
     */
    round(): Vector3;

    /**
     * Scales this by a scalar number
     * @param scale amount to scale the vector by
     * @returns this
     */
    scale(scale: number): Vector3;

    /**
     * Adds two vec3's after scaling the second vector by a scalar value
     * @param scale the amount to scale the second vector by before adding
     * @param a
     * @param b 如果不传，计算 this 和 a 的结果
     * @returns this
     */
    scaleAndAdd(scale: number, a: Vector3, b?: Vector3): Vector3;

    /**
     * Calculates the euclidian distance between two vec3's
     * @param a
     * @param b 如果不传，计算 this 和 a 的结果
     */
    distance(a: Vector3, b?: Vector3): number;

    /**
     * Calculates the squared euclidian distance between two vec3's
     * @param a
     * @param b 如果不传，计算 this 和 a 的结果
     */
    squaredDistance(a: Vector3, b?: Vector3): number;

    /**
     * Calculates the length of this
     */
    length(): number;

    /**
     * Calculates the squared length of this
     */
    squaredLength(): number;

    /**
     * Negates the components of this
     * @returns this
     */
    negate(): Vector3;

    /**
     * Returns the inverse of the components of a vec3
     * @param a
     * @returns this
     */
    inverse(a?: Vector3): Vector3;

    /**
     * Normalize this
     * @returns this
     */
    normalize(): Vector3;

    /**
     * Calculates the dot product of two vec3's
     * @param a
     * @param b 如果不传，计算 this 和 a 的结果
     */
    dot(a: Vector3, b?: Vector3): number;

    /**
     * Computes the cross product of two vec3's
     * @param a
     * @param b 如果不传，计算 this 和 a 的结果
     */
    cross(a: Vector3, b?: Vector3): Vector3;

    /**
     * Performs a linear interpolation between two vec3's
     * @param v
     * @param t interpolation amount between the two vectors
     * @returns this
     */
    lerp(v: Vector3, t: number): Vector3;

    /**
     * Performs a hermite interpolation with two control points
     * @param a
     * @param b
     * @param c
     * @param d
     * @param t interpolation amount between the two inputs
     */
    hermite(a: Vector3, b: Vector3, c: Vector3, d: Vector3, t: number): Vector3;

    /**
     * Performs a bezier interpolation with two control points
     * @param a
     * @param b
     * @param c
     * @param d
     * @param t interpolation amount between the two inputs
     */
    bezier(a: Vector3, b: Vector3, c: Vector3, d: Vector3, t: number): Vector3;

    /**
     * Generates a random vector with the given scale
     * @param scale Length of the resulting vector. If ommitted, a unit vector will be returned
     * @returns this
     */
    random(scale?: number): Vector3;

    /**
     * Transforms the vec3 with a mat3
     * @param m matrix to transform with
     * @returns this
     */
    transformMat3(m: Matrix3): Vector3;

    /**
     * Transforms the vec3 with a mat4
     * @param m matrix to transform with
     * @returns this
     */
    transformMat4(m: Matrix4): Vector3;

    /**
     * Transforms the vec3 direction with a mat4
     * @param m matrix to transform with
     * @returns this
     */
    transformDirection(m: Matrix4): Vector3;

    /**
     * Transforms the vec3 with a quat
     * @param q quaternion to transform with
     * @returns this
     */
    transformQuat(q: Quaternion): Vector3;

    /**
     * Rotate this 3D vector around the x-axis
     * @param origin The origin of the rotation
     * @param rotation The angle of rotation
     */
    rotateX(origin: Vector3, rotation: number): Vector3;

    /**
     * Rotate this 3D vector around the y-axis
     * @param origin The origin of the rotation
     * @param rotation The angle of rotation
     */
    rotateY(origin: Vector3, rotation: number): Vector3;

    /**
     * Rotate this 3D vector around the z-axis
     * @param origin The origin of the rotation
     * @param rotation The angle of rotation
     */
    rotateZ(origin: Vector3, rotation: number): Vector3;

    /**
     * Returns whether or not the vectors have exactly the same elements in the same position (when compared with ===)
     * @param a
     * @param b 如果不传，计算 this 和 a 的结果
     */
    exactEquals(a: Vector3, b?: Vector3): boolean;

    /**
     * Returns whether or not the vectors have approximately the same elements in the same position.
     * @param a
     * @param b 如果不传，计算 this 和 a 的结果
     */
    equals(a: Vector3, b?: Vector3): boolean;

    /**
     * X component
     */
    x: number;

    /**
     * Y component
     */
    y: number;

    /**
     * Z component
     */
    z: number;

    /**
     * Alias for {@link Vector3#subtract}
     */
    sub: Vector3['subtract'];

    /**
     * Alias for {@link Vector3#multiply}
     */
    mul: Vector3['multiply'];

    /**
     * Alias for {@link Vector3#divide}
     */
    div: Vector3['divide'];

    /**
     * Alias for {@link Vector3#distance}
     */
    dist: Vector3['distance'];

    /**
     * Alias for {@link Vector3#squaredDistance}
     */
    sqrDist: Vector3['squaredDistance'];

    /**
     * Alias for {@link Vector3#length}
     */
    len: Vector3['length'];

    /**
     * Alias for {@link Vector3#squaredLength}
     */
    sqrLen: Vector3['squaredLength'];

  }

  class Vector4 {
    /**
     * 四维向量
     */
    constructor();

    /**
     * Creates a new empty vec4
     * @param x X component
     * @param y Y component
     * @param z Z component
     * @param w W component
     */
    constructor(x?: number, y?: number, z?: number, w?: number);

    /**
     * 类名
     */
    className: string;

    isVector4: boolean;

    /**
     * 数据
     */
    elements: any;

    /**
     * Copy the values from one vec4 to this
     * @param m the source vector
     */
    copy(m: Vector4): Vector4;

    /**
     * Creates a new vec4 initialized with values from this vector
     */
    clone(): Vector4;

    /**
     * 转换到数组
     * @param array 数组
     * @param offset 数组偏移值
     */
    toArray(array?: any, offset?: number): any;

    /**
     * 从数组赋值
     * @param array 数组
     * @param offset 数组偏移值
     */
    fromArray(array: any, offset?: number): Vector4;

    /**
     * Set the components of a vec4 to the given values
     * @param x X component
     * @param y Y component
     * @param z Z component
     * @param w W component
     * @returns this
     */
    set(x: number, y: number, z: number, w: number): Vector4;

    /**
     * Adds two vec4's
     * @param a
     * @param b 如果不传，计算 this 和 a 的和
     * @returns this
     */
    add(a: Vector4, b?: Vector4): Vector4;

    /**
     * Subtracts vector b from vector a
     * @param a
     * @param b 如果不传，计算 this 和 a 的差
     * @returns this
     */
    subtract(a: Vector4, b?: Vector4): Vector4;

    /**
     * Multiplies two vec4's
     * @param a
     * @param b 如果不传，计算 this 和 a 的积
     * @returns this
     */
    multiply(a: Vector4, b?: Vector4): Vector4;

    /**
     * Divides two vec4's
     * @param a
     * @param b 如果不传，计算 this 和 a 的商
     * @returns this
     */
    divide(a: Vector4, b?: Vector4): Vector4;

    /**
     * Math.ceil the components of this
     * @returns this
     */
    ceil(): Vector4;

    /**
     * Math.floor the components of this
     * @returns this
     */
    floor(): Vector4;

    /**
     * Returns the minimum of two vec4's
     * @param a
     * @param b 如果不传，计算 this 和 a 的结果
     * @returns this
     */
    min(a: Vector4, b?: Vector4): Vector4;

    /**
     * Returns the maximum of two vec4's
     * @param a
     * @param b 如果不传，计算 this 和 a 的结果
     * @returns this
     */
    max(a: Vector4, b?: Vector4): Vector4;

    /**
     * Math.round the components of this
     * @returns this
     */
    round(): Vector4;

    /**
     * Scales this by a scalar number
     * @param scale amount to scale the vector by
     * @returns this
     */
    scale(scale: number): Vector4;

    /**
     * Adds two vec4's after scaling the second vector by a scalar value
     * @param scale the amount to scale the second vector by before adding
     * @param a
     * @param b 如果不传，计算 this 和 a 的结果
     * @returns this
     */
    scaleAndAdd(scale: number, a: Vector4, b?: Vector4): Vector4;

    /**
     * Calculates the euclidian distance between two vec4's
     * @param a
     * @param b 如果不传，计算 this 和 a 的结果
     */
    distance(a: Vector4, b?: Vector4): number;

    /**
     * Calculates the squared euclidian distance between two vec4's
     * @param a
     * @param b 如果不传，计算 this 和 a 的结果
     */
    squaredDistance(a: Vector4, b?: Vector4): number;

    /**
     * Calculates the length of this
     */
    length(): number;

    /**
     * Calculates the squared length of this
     */
    squaredLength(): number;

    /**
     * Negates the components of this
     * @returns this
     */
    negate(): Vector4;

    /**
     * Returns the inverse of the components of a vec4
     * @param a
     * @returns this
     */
    inverse(a?: Vector4): Vector4;

    /**
     * Normalize this
     * @returns this
     */
    normalize(): Vector4;

    /**
     * Calculates the dot product of two vec4's
     * @param a
     * @param b 如果不传，计算 this 和 a 的结果
     */
    dot(a: Vector4, b?: Vector4): number;

    /**
     * Performs a linear interpolation between two vec4's
     * @param v
     * @param t interpolation amount between the two vectors
     * @returns this
     */
    lerp(v: Vector4, t: number): Vector4;

    /**
     * Generates a random vector with the given scale
     * @param scale Length of the resulting vector. If ommitted, a unit vector will be returned
     * @returns this
     */
    random(scale?: number): Vector4;

    /**
     * Transforms the vec4 with a mat4
     * @param m matrix to transform with
     * @returns this
     */
    transformMat4(m: Matrix4): Vector4;

    /**
     * Transforms the vec4 with a quat
     * @param q quaternion to transform with
     * @returns this
     */
    transformQuat(q: Quaternion): Vector4;

    /**
     * Returns whether or not the vectors have exactly the same elements in the same position (when compared with ===)
     * @param a
     * @param b 如果不传，计算 this 和 a 的结果
     */
    exactEquals(a: Vector4, b?: Vector4): boolean;

    /**
     * Returns whether or not the vectors have approximately the same elements in the same position.
     * @param a
     * @param b 如果不传，计算 this 和 a 的结果
     */
    equals(a: Vector4, b?: Vector4): boolean;

    /**
     * X component
     */
    x: number;

    /**
     * Y component
     */
    y: number;

    /**
     * Z component
     */
    z: number;

    /**
     * W component
     */
    w: number;

    /**
     * Alias for {@link Vector4#subtract}
     */
    sub: Color['subtract'];

    /**
     * Alias for {@link Vector4#multiply}
     */
    mul: Color['multiply'];

    /**
     * Alias for {@link Vector4#divide}
     */
    div: Color['divide'];

    /**
     * Alias for {@link Vector4#distance}
     */
    dist: Color['distance'];

    /**
     * Alias for {@link Vector4#squaredDistance}
     */
    sqrDist: Color['squaredDistance'];

    /**
     * Alias for {@link Vector4#length}
     */
    len: Color['length'];

    /**
     * Alias for {@link Vector4#squaredLength}
     */
    sqrLen: Color['squaredLength'];

  }

  namespace math {
    /**
     * 角度值转弧度值
     */
    var DEG2RAD: number;

    /**
     * 弧度值转角度值
     */
    var RAD2DEG: number;

    /**
     * 生成唯一ID
     * @param prefix ID前缀
     */
    function generateUUID(prefix?: string): string;

    /**
     * 截取
     * @param value 值
     * @param min 最小值
     * @param max 最大值
     */
    function clamp(value: number, min: number, max: number): number;

    /**
     * 角度值转换成弧度值
     * @param deg 角度值
     */
    function degToRad(deg: number): number;

    /**
     * 弧度值转换成角度值
     * @param rad 弧度值
     */
    function radToDeg(rad: number): number;

    /**
     * 是否是 2 的指数值
     * @param value
     */
    function isPowerOfTwo(value: number): boolean;

    /**
     * 最近的 2 的指数值
     * @param value
     */
    function nearestPowerOfTwo(value: number): number;

    /**
     * 下一个的 2 的指数值
     * @param value
     */
    function nextPowerOfTwo(value: number): number;

  }

  class SphericalHarmonics3 {
    className: string;
    isSphericalHarmonics3: boolean;
    static SH3_SCALE: number[];
    constructor();
    /**
     * 缩放
     */
    scale(scale: number): this;
    /**
     * 从数组创建
     */
    fromArray(data: number[][] | number[]): this;
    /**
     * 为render缩放
     */
    scaleForRender();
    /**
     * 转换为TypedArray
     */
    toArray(): Float32Array;
    /**
     * 克隆
     */
    clone(): this;
    /**
     * 复制
     */
    copy(other: SphericalHarmonics3): this;
  }

  class Buffer {
    /**
     * 缓冲
     */
    constructor();

    /**
     * 
     * @param gl
     * @param target
     * @param data
     * @param usage
     */
    constructor(gl: WebGLRenderingContext, target?: GLenum, data?: any, usage?: GLenum);

    /**
     * 缓存
     */
    static readonly cache: any;

    /**
     * 重置缓存
     */
    static reset(): void;

    /**
     * 生成顶点缓冲
     * @param gl
     * @param geometryData
     * @param usage
     */
    static createVertexBuffer(gl: WebGLRenderingContext, geometryData: GeometryData, usage?: GLenum): Buffer;

    /**
     * 生成索引缓冲
     * @param gl
     * @param geometryData
     * @param usage
     */
    static createIndexBuffer(gl: WebGLRenderingContext, geometryData: GeometryData, usage?: GLenum): Buffer;

    className: string;

    isBuffer: boolean;

    /**
     * target
     */
    target: GLenum;

    /**
     * usage
     */
    usage: GLenum;

    /**
     * buffer
     */
    buffer: WebGLBuffer;

    /**
     * 绑定
     */
    bind(): void;

    /**
     * 上传数据
     * @param data
     * @param offset 偏移值
     */
    upload(data: any, offset?: number): void;

    /**
     * 销毁
     */
    destroy(): void;

  }

  class Framebuffer {
    /**
     * 帧缓冲
     */
    constructor();

    /**
     * 
     * @param renderer
     * @param params 初始化参数，所有params都会复制到实例上
     */
    constructor(renderer: WebGLRenderer, params: Object);

    className: string;

    isFramebuffer: boolean;

    /**
     * bufferInternalFormat
     */
    bufferInternalFormat: GLenum;

    /**
     * internalFormat
     */
    internalFormat: GLenum;

    /**
     * format
     */
    format: GLenum;

    /**
     * type
     */
    type: GLenum;
    /**
     * minFilter
     */
    minFilter: GLenum;
    /**
     * magFilter
     */
    magFilter: GLenum;

    /**
     * attachment
     */
    attachment: GLenum;

    /**
     * 是否需要renderbuffer
     */
    needRenderbuffer: boolean;

    /**
     * 是否使用VAO
     */
    useVao: boolean;

    /**
     * renderer
     */
    renderer: WebGLRenderer;

    /**
     * texture
     */
    texture: Texture;

    /**
     * renderbuffer
     */
    renderbuffer: WebGLRenderbuffer;

    /**
     * framebuffer
     */
    framebuffer: WebGLFramebuffer;

    /**
     * 宽度。
     */
    readonly width: number;

    /**
     * 高度。
     */
    readonly height: number;

    /**
     * framebuffer 是否完成
     */
    isComplete(): boolean;

    /**
     * 绑定
     */
    bind(): void;

    /**
     * 解绑
     */
    unbind(): void;

    /**
     * 渲染当前纹理
     * @param x
     * @param y
     * @param width
     * @param height
     * @param clearColor
     */
    render(x?: number, y?: number, width?: number, height?: number, clearColor?: Color): void;

    /**
     * resize
     * @param width
     * @param height
     * @param force
     */
    resize(width: number, height: number, force?: boolean): void;

    /**
     * 读取区域像素
     * @param x
     * @param y
     * @param width
     * @param height
     */
    readPixels(x: number, y: number, width?: number, height?: number): any;

    /**
     * 销毁资源
     */
    destroyResource(): void;

  }

  class Program {
    constructor();

    /**
     * 
     * @param params 初始化参数，所有params都会复制到实例上
     * @param params.state WebGL state
     */
    constructor(params: Object);

    /**
     * 缓存
     */
    static readonly cache: any;

    /**
     * 重置缓存
     */
    static reset(): void;

    /**
     * 获取程序
     * @param shader
     * @param state
     * @param ignoreError
     */
    static getProgram(shader: Shader, state: WebGLState, ignoreError?: boolean): Program;

    /**
     * 获取空白程序
     * @param state
     */
    static getBlankProgram(state: WebGLState): Program;

    className: string;

    isProgram: boolean;

    /**
     * 片段代码
     */
    fragShader: string;

    /**
     * 顶点代码
     */
    vertexShader: string;

    /**
     * attribute 集合
     */
    attributes: {[key: string]: any};

    /**
     * uniform 集合
     */
    uniforms: {[key: string]: any};

    /**
     * program
     */
    program: WebGLProgram;

    /**
     * gl
     */
    gl: WebGLRenderingContext;

    /**
     * webglState
     */
    state: WebGLState;

    /**
     * id
     */
    id: string;

    /**
     * 生成 program
     */
    createProgram(): WebGLProgram;

    /**
     * 使用 program
     */
    useProgram(): void;

    /**
     * 生成 shader
     * @param shaderType
     * @param code
     */
    createShader(shaderType: number, code: string): WebGLShader;

    /**
     * 初始化 attribute 信息
     */
    initAttributes(): void;

    /**
     * 初始化 uniform 信息
     */
    initUniforms(): void;

  }

  class RenderInfo {
    /**
     * 渲染信息
     */
    constructor();

    constructor();

    className: string;

    isRenderInfo: boolean;

    /**
     * 增加面数
     * @param num
     */
    addFaceCount(num: number): void;

    /**
     * 增加绘图数
     * @param num
     */
    addDrawCount(num: number): void;

    /**
     * 重置信息
     */
    reset(): void;

    /**
     * 面数
     */
    readonly faceCount: number;

    /**
     * 绘图数
     */
    readonly drawCount: number;

  }

  class RenderList {
    /**
     * 渲染列表
     */
    constructor();

    constructor();


    className: string;

    isRenderList: boolean;

    /**
     * 不透明物体字典
     */
    dict: Object;

    /**
     * 透明物体列表
     */
    transparentList: any;

    /**
     * 重置列表
     */
    reset(): void;

    /**
     * 遍历列表执行回调
     * @param callback(meshes)
     */
    traverse(callback: (meshes: RenderList) => any): void;

    /**
     * 增加 mesh
     * @param mesh
     * @param camera
     */
    addMesh(mesh: Mesh, camera: Camera): void;

  }

  class VertexArrayObject {
    /**
     * VAO
     */
    constructor();

    /**
     * 
     * @param gl
     * @param id 缓存id
     * @param params
     */
    constructor(gl: WebGLRenderingContext, id: string, params: Object);

    /**
     * 获取 vao
     * @param  {WebGLRenderingContext} gl
     * @param  {String} id  缓存id
     * @param  {Object} params
     * @return {VertexArrayObject}
     */
    static getVao(gl: WebGLRenderingContext, id: string, params: Object): VertexArrayObject;

    className: string;

    isVertexArrayObject: boolean;

    /**
     * 是否使用 vao
     */
    useVao: boolean;

    /**
     * 是否使用 instanced
     */
    useInstanced: boolean;

    /**
     * 绘图方式
     */
    mode: GLenum;

    /**
     * 是否脏
     */
    isDirty: boolean;

    /**
     * bind
     */
    bind(): void;

    /**
     * unbind
     */
    unbind(): void;

    /**
     * draw
     */
    draw(): void;

    /**
     * 获取顶点数量
     */
    getVertexCount(): number;

    /**
     * drawInstance
     * @param primcount
     */
    drawInstance(primcount?: number): void;

    /**
     * addIndexBuffer
     * @param data
     * @param usage gl.STATIC_DRAW|gl.DYNAMIC_DRAW
     */
    addIndexBuffer(data: GeometryData, usage: GLenum): void;

    /**
     * addAttribute
     * @param geometryData
     * @param attribute
     * @param usage gl.STATIC_DRAW|gl.DYNAMIC_DRAW
     * @param onInit
     */
    // addAttribute(geometryData: GeometryData, attribute: Object, usage: GLenum, onInit: Function): AttributeObject;
    addAttribute(geometryData: GeometryData, attribute: Object, usage: GLenum, onInit: Function): any;

    /**
     * addInstancedAttribute
     * @param attribute
     * @param meshes
     * @param getData
     */
    addInstancedAttribute(attribute: Object, meshes: any, getData: Function): void;

  }

  class WebGLRenderer {
    /**
     * WebGL渲染器
     */
    constructor();

    /**
     * 
     * @param params 初始化参数，所有params都会复制到实例上
     */
    constructor(params: Object);

    className: string;

    isWebGLRenderer: boolean;

    /**
     * gl
     */
    gl: WebGLRenderingContext;

    /**
     * 宽
     */
    width: number;

    /**
     * 高
     */
    height: number;

    /**
     * 像素密度
     */
    pixelRatio: number;

    /**
     * dom元素
     */
    domElement: HTMLCanvasElement;

    /**
     * 是否使用instanced
     */
    useInstanced: boolean;

    /**
     * 是否使用VAO
     */
    useVao: boolean;

    /**
     * 是否开启透明背景
     */
    alpha: boolean;

    depth: boolean;

    stencil: boolean;

    /**
     * 是否开启抗锯齿
     */
    antialias: boolean;

    /**
     * boolean that indicates that the page compositor will assume the drawing buffer contains colors with pre-multiplied alpha.
     */
    premultipliedAlpha: boolean;

    /**
     * If the value is true the buffers will not be cleared and will preserve their values until cleared or overwritten by the author.
     */
    preserveDrawingBuffer: boolean;

    /**
     * boolean that indicates if a context will be created if the system performance is low.
     */
    failIfMajorPerformanceCaveat: boolean;

    /**
     * 是否使用framebuffer
     */
    useFramebuffer: boolean;

    /**
     * 若使用framebuffer，则可取得。
     */
    readonly framebuffer: Framebuffer;

    /**
     * 当前状态。
     */
    readonly state: WebGLState;

    /**
     * framebuffer配置
     */
    framebufferOption: Object;

    /**
     * 顶点着色器精度, 可以是以下值：highp, mediump, lowp
     */
    vertexPrecision: string;

    /**
     * 片段着色器精度, 可以是以下值：highp, mediump, lowp
     */
    fragmentPrecision: string;

    /**
     * 雾
     */
    fog: Fog;

    /**
     * 偏移值
     */
    offsetX: number;

    /**
     * 偏移值
     */
    offsetY: number;

    /**
     * 背景色
     */
    clearColor: Color;

    /**
     * 渲染信息
     */
    renderInfo: RenderInfo;

    /**
     * 渲染列表
     */
    renderList: RenderList;

    /**
     * 灯光管理器
     */
    lightManager: LightManager;

    /**
     * 改变大小
     * @param width 宽
     * @param height 高
     * @param force 是否强制刷新
     */
    resize(width: number, height: number, force?: boolean): void;

    /**
     * 设置viewport偏移值
     * @param x x
     * @param y y
     */
    setOffset(x: number, y: number): void;

    /**
     * 设置viewport
     * @param x x
     * @param y y
     * @param width width
     * @param height height
     */
    viewport(x?: number, y?: number, width?: number, height?: number): void;

    /**
     * 是否初始化
     */
    readonly isInit: boolean;

    /**
     * 初始化 context
     */
    initContext(): void;

    /**
     * 设置深度检测
     * @param material
     */
    setupDepthTest(material: Material): void;

    /**
     * 设置alphaToCoverage
     * @param material
     */
    setupSampleAlphaToCoverage(material: Material): void;

    /**
     * 设置背面剔除
     * @param material
     */
    setupCullFace(material: Material): void;

    /**
     * 设置混合
     * @param material
     */
    setupBlend(material: Material): void;

    /**
     * 设置通用的 uniform
     * @param program
     * @param mesh
     * @param force 是否强制更新
     */
    setupUniforms(program: Program, mesh: Mesh, force?: boolean): void;

    /**
     * 设置vao
     * @param vao
     * @param program
     * @param mesh
     */
    setupVao(vao: any, program: Program, mesh: Mesh): void;

    /**
     * 设置材质
     * @param program
     * @param mesh
     */
    setupMaterial(program: Program, mesh: Mesh): void;

    /**
     * 设置mesh
     * @param mesh
     * @param useInstanced
     */
    setupMesh(mesh: Mesh, useInstanced: boolean): Object;

    /**
     * 增加渲染信息
     * @param faceCount 面数量
     * @param drawCount 绘图数量
     */
    addRenderInfo(faceCount: number, drawCount: number): void;

    /**
     * 渲染一组mesh
     * @param meshes
     */
    renderMeshes(meshes: Mesh[]): void;

    /**
     * 渲染
     * @param stage
     * @param camera
     * @param fireEvent 是否发送事件
     */
    render(stage: Stage, camera: Camera, fireEvent?: boolean): void;

    /**
     * 渲染场景
     */
    renderScene(): void;

    /**
     * 清除背景
     * @param clearColor
     */
    clear(clearColor?: Color): void;

    /**
     * 清除深度
     */
    clearDepth(): void;

    /**
     * 将framebuffer渲染到屏幕
     * @param framebuffer
     */
    renderToScreen(framebuffer: Framebuffer): void;

    /**
     * 渲染一个mesh
     * @param mesh
     */
    renderMesh(mesh: Mesh): void;

    /**
     * 渲染一组 instanced mesh
     * @param mesh
     * @param meshes
     * @param material
     */
    renderInstancedMeshes(mesh: Mesh, meshes: Mesh[], material: Material): void;

    /**
     * 渲染一组普通mesh
     * @param meshes
     */
    renderMultipleMeshes(meshes: Mesh[]): void;

    /**
     * 销毁 WebGL 资源
     */
    releaseGLResource(): void;

  }

  class WebGLState {
    /**
     * WebGL 状态管理，减少 api 调用
     */
    constructor();

    /**
     * 
     * @param gl
     */
    constructor(gl: WebGLRenderingContext);

    className: string;

    isWebGLState: boolean;

    /**
     * 系统framebuffer
     */
    systemFramebuffer: null;

    /**
     * gl
     */
    gl: WebGLRenderingContext;

    /**
     * 重置状态
     */
    reset(): void;

    /**
     * enable
     * @param capability
     */
    enable(capability: GLenum): void;

    /**
     * disable
     * @param capability
     */
    disable(capability: GLenum): void;

    /**
     * bindFramebuffer
     * @param target
     * @param framebuffer
     */
    bindFramebuffer(target: GLenum, framebuffer: WebGLFramebuffer): void;

    /**
     * 绑定系统framebuffer
     */
    bindSystemFramebuffer(): void;

    /**
     * useProgram
     * @param program
     */
    useProgram(program: WebGLProgram): void;

    /**
     * depthFunc
     * @param func
     */
    depthFunc(func: GLenum): void;

    /**
     * depthMask
     * @param flag
     */
    depthMask(flag: GLenum): void;

    /**
     * clear
     * @param mask
     */
    clear(mask: number): void;

    /**
     * depthRange
     * @param zNear
     * @param zFar
     */
    depthRange(zNear: number, zFar: number): void;

    /**
     * stencilFunc
     * @param func
     * @param ref
     * @param mask
     */
    stencilFunc(func: GLenum, ref: number, mask: number): void;

    /**
     * stencilMask
     * @param mask
     */
    stencilMask(mask: number): void;

    /**
     * stencilOp
     * @param fail
     * @param zfail
     * @param zpass
     */
    stencilOp(fail: GLenum, zfail: GLenum, zpass: GLenum): void;

    /**
     * colorMask
     * @param red
     * @param green
     * @param blue
     * @param alpha
     */
    colorMask(red: boolean, green: boolean, blue: boolean, alpha: boolean): void;

    /**
     * cullFace
     * @param mode
     */
    cullFace(mode: GLenum): void;

    /**
     * frontFace
     * @param mode
     */
    frontFace(mode: GLenum): void;

    /**
     * blendFuncSeparate
     * @param srcRGB
     * @param dstRGB
     * @param srcAlpha
     * @param dstAlpha
     */
    blendFuncSeparate(srcRGB: GLenum, dstRGB: GLenum, srcAlpha: GLenum, dstAlpha: GLenum): void;

    /**
     * blendEquationSeparate
     * @param modeRGB
     * @param modeAlpha
     */
    blendEquationSeparate(modeRGB: GLenum, modeAlpha: GLenum): void;

    /**
     * pixelStorei
     * @param pname
     * @param param
     */
    pixelStorei(pname: GLenum, param: GLenum): void;

    /**
     * viewport
     * @param x
     * @param y
     * @param width
     * @param height
     */
    viewport(x: number, y: number, width: number, height: number): void;

    /**
     * activeTexture
     * @param texture
     */
    activeTexture(texture: number): void;

    /**
     * bindTexture
     * @param target
     * @param texture
     */
    bindTexture(target: GLenum, texture: WebGLTexture): void;

    /**
     * 获取当前激活的纹理对象
     */
    // getActiveTextureUnit(): TextureUnit;
    getActiveTextureUnit(): any;

  }

  /**
   * WebGL 能力
   */
  namespace capabilities {
    /**
     * 最大纹理数量
     */
    var MAX_TEXTURE_INDEX: number;

    /**
     * 最高着色器精度, 可以是以下值：highp, mediump, lowp
     */
    var MAX_PRECISION: string;

    /**
     * 最高顶点着色器精度, 可以是以下值：highp, mediump, lowp
     */
    var MAX_VERTEX_PRECISION: string;

    /**
     * 最高片段着色器精度, 可以是以下值：highp, mediump, lowp
     */
    var MAX_FRAGMENT_PRECISION: string;

    /**
     * 顶点浮点数纹理
     */
    var VERTEX_TEXTURE_FLOAT: boolean;

    /**
     * 片段浮点数纹理
     */
    var FRAGMENT_TEXTURE_FLOAT: boolean;

    /**
     * 初始化
     * @param gl
     */
    function init(gl: WebGLRenderingContext): void;

    /**
     * 获取 WebGL 能力
     * @param name
     */
    function get(name: string): number | string;

    /**
     * 获取最大支持精度
     * @param a
     * @param b
     */
    function getMaxPrecision(a: string, b: string): string;

  }

  /**
   * WebGL 扩展
   */
  namespace extensions {
    /**
     * ANGLE_instanced_arrays扩展
     */
    var instanced: any;

    /**
     * OES_vertex_array_Object扩展
     */
    var vao: any;

    /**
     * OES_texture_float扩展
     */
    // var texFloat: OESTextureFloat;
    var texFloat: any;

    /**
     * WEBGL_lose_context扩展
     */
    var loseContext: any;

    /**
     * 初始化
     * @param gl
     */
    function init(gl: WebGLRenderingContext): void;

    /**
     * 重置扩展
     * @param gl
     */
    function reset(gl: WebGLRenderingContext): void;

    /**
     * 使用扩展
     * @param name 扩展名称
     * @param alias 别名，默认和 name 相同
     */
    function use(name: string, alias?: string): void;

    /**
     * 获取扩展，如果不支持返回 null，必须在 Renderer 初始化完后用
     * @param name 扩展名称
     * @param alias 别名，默认和 name 相同
     */
    // function get(name: string, alias?: string): ExtensionObject | null;
    function get(name: string, alias?: string): any;

  }

  interface glTypeInfo {
    /**
     * 名字，e.g. FLOAT_VEC2
     */
    name: string;
    /**
     * 字节大小
     */
    byteSize: number;
    /**
     * uniform方法名字，e.g. uniform3f
     */
    uniformFuncName: string;
    /**
     * 类型，可以是 Scalar, Vector, Matrix
     */
    type: string;
    /**
     * 数量
     */
    size: number;
    /**
     * gl enum值
     */
    glValue: GLenum;
    /**
     * uniform单个值方法
     */
    uniform: Function;
    /**
     * uniform多个值方法
     */
    uniformArray: Function;
  }

  namespace glType {
    /**
     * init
     * @param gl
     */
    function init(gl: WebGLRenderingContext): void;

    /**
     * 获取信息
     * @param type
     */
    function get(type: GLenum): glTypeInfo;

  }

  class Shader {
    /**
     * Shader类
     */
    constructor();

    /**
     * 
     * @param params 初始化参数，所有params都会复制到实例上
     */
    constructor(params: {
      /**
       * vs 顶点代码
       */
      vs: string;

      /**
       * vs 片段代码
       */
      fs: string;
    });

    isShader: boolean;

    className: string;

    /**
     * vs 顶点代码
     */
    vs: string;

    /**
     * vs 片段代码
     */
    fs: string;

    /**
     * 内部的所有shader块字符串，可以用来拼接glsl代码
     */
    static shaders: Object;

    /**
     * 初始化
     * @param renderer
     */
    static init(renderer: WebGLRenderer): void;

    /**
     * 缓存
     */
    static readonly cache: Cache;

    /**
     * 重置
     */
    static reset(): void;

    /**
     * 获取header缓存的key
     * @param mesh mesh
     * @param material 材质
     * @param lightManager lightManager
     * @param fog fog
     */
    static getHeaderKey(mesh: Mesh, material: Material, lightManager: LightManager, fog: Fog): string;

    /**
     * 获取header
     * @param mesh
     * @param material
     * @param lightManager
     * @param fog
     */
    static getHeader(mesh: Mesh, material: Material, lightManager: LightManager, fog: Fog): string;

    /**
     * 获取 shader
     * @param mesh
     * @param material
     * @param isUseInstance
     * @param lightManager
     * @param fog
     */
    static getShader(mesh: Mesh, material: Material, isUseInstance: boolean, lightManager: LightManager, fog: Fog): Shader;

    /**
     * 获取基础 shader
     * @param material
     * @param isUseInstance
     * @param lightManager
     * @param fog
     */
    static getBasicShader(material: Material, isUseInstance: boolean, lightManager: LightManager, fog: Fog): Shader;

    /**
     * 获取自定义shader
     * @param vs 顶点代码
     * @param fs 片段代码
     * @param header 头代码
     * @param cacheKey 如果有，会以此值缓存 shader
     */
    static getCustomShader(vs: string, fs: string, header?: string, cacheKey?: string): Shader;

  }

  class CubeTexture extends Texture {
    /**
     * 立方体纹理
     */
    constructor();

    /**
     * 
     * @param params 初始化参数，所有params都会复制到实例上
     * @param params.image 图片列表，共6张
     */
    constructor(params: {
      image: Image[];
      [key: string]: any
    });

    isCubeTexture: boolean;

    className: string;

    target: number;

    internalFormat: number;

    format: number;

    magFilter: number;

    minFilter: number;

    wrapS: number;

    wrapT: number;

    /**
     * 右侧的图片
     */
    right: Image;

    /**
     * 左侧的图片
     */
    left: Image;

    /**
     * 顶部的图片
     */
    top: Image;

    /**
     * 底部的图片
     */
    bottom: Image;

    /**
     * 朝前的图片
     */
    front: Image;

    /**
     * 朝后的图片
     */
    back: Image;

    isTexture: boolean;

    /**
     * 图片对象
     */
    image: Image;

    /**
     * Texture Level
     */
    level: number;

    /**
     * 类型
     */
    type: GLenum;

    width: number;

    height: number;

    readonly border: number;

    name: string;

    premultiplyAlpha: boolean;

    /**
     * 是否翻转Texture的Y轴
     */
    flipY: boolean;

    /**
     * 是否压缩
     */
    compressed: boolean;

    /**
     * 是否需要更新Texture
     */
    needUpdate: boolean;

    /**
     * 是否需要销毁之前的Texture，Texture参数变更之后需要销毁
     */
    needDestory: boolean;

    /**
     * 是否每次都更新Texture
     */
    autoUpdate: boolean;

    /**
     * uv
     */
    uv: number;

    /**
     * 销毁当前Texture
     * @param gl gl
     */
    destroy(): void;

    /**
     * 更新局部贴图
     * @param xOffset
     * @param yOffset
     * @param image
     */
    updateSubTexture(xOffset: number, yOffset: number, image: Image | HTMLCanvasElement | ImageData): void;

  }

  class DataTexture extends Texture {
    /**
     * 数据纹理
     */
    constructor();

    /**
     * 
     * @param params 初始化参数，所有params都会复制到实例上
     * @param params.data 数据
     */
    constructor(params: {
      /**
       * 数据，改变数据的时候会自动更新Texture
       */
      data: any;
    });

    isDataTexture: boolean;

    className: string;

    target: number;

    internalFormat: number;

    format: number;

    type: number;

    magFilter: number;

    minFilter: number;

    wrapS: number;

    wrapT: number;

    /**
     * 数据，改变数据的时候会自动更新Texture
     */
    data: any;

    isTexture: boolean;

    /**
     * 图片对象
     */
    image: Image;

    /**
     * Texture Level
     */
    level: number;

    width: number;

    height: number;

    readonly border: number;

    name: string;

    premultiplyAlpha: boolean;

    /**
     * 是否翻转Texture的Y轴
     */
    flipY: boolean;

    /**
     * 是否压缩
     */
    compressed: boolean;

    /**
     * 是否需要更新Texture
     */
    needUpdate: boolean;

    /**
     * 是否需要销毁之前的Texture，Texture参数变更之后需要销毁
     */
    needDestory: boolean;

    /**
     * 是否每次都更新Texture
     */
    autoUpdate: boolean;

    /**
     * uv
     */
    uv: number;

    /**
     * 销毁当前Texture
     * @param gl gl
     */
    destroy(): void;

    /**
     * 更新局部贴图
     * @param xOffset
     * @param yOffset
     * @param image
     */
    updateSubTexture(xOffset: number, yOffset: number, image: Image | HTMLCanvasElement | ImageData): void;

  }

  class LazyTexture extends Texture {
    /**
     * 懒加载纹理
     */
    constructor();

    /**
     * 
     * @param params 初始化参数，所有params都会复制到实例上
     * @param params.crossOrigin 是否跨域
     * @param params.placeHolder 占位图片，默认为1像素的透明图片
     * @param params.autoLoad 是否自动加载
     * @param params.src 图片地址
     */
    constructor(params?: {
      src: string;
      placeHolder: string;
      crossOrigin: boolean;
      autoLoad: boolean;
    });

    isLazyTexture: boolean;

    className: string;

    /**
     * 图片是否跨域
     */
    crossOrigin: boolean;

    /**
     * 是否在设置src后立即加载图片
     */
    autoLoad: boolean;

    /**
     * 图片地址
     */
    src: string;

    /**
     * 加载图片
     */
    load(): Promise<Image>;

    isTexture: boolean;

    /**
     * 图片对象
     */
    image: Image;

    /**
     * Texture Target
     */
    target: GLenum;

    /**
     * Texture Level
     */
    level: number;

    /**
     * Texture Internal Format
     */
    internalFormat: GLenum;

    /**
     * 图片 Format
     */
    format: GLenum;

    /**
     * 类型
     */
    type: GLenum;

    width: number;

    height: number;

    readonly border: number;

    /**
     * magFilter
     */
    magFilter: GLenum;

    /**
     * minFilter
     */
    minFilter: GLenum;

    /**
     * wrapS
     */
    wrapS: GLenum;

    /**
     * wrapT
     */
    wrapT: GLenum;

    name: string;

    premultiplyAlpha: boolean;

    /**
     * 是否翻转Texture的Y轴
     */
    flipY: boolean;

    /**
     * 是否压缩
     */
    compressed: boolean;

    /**
     * 是否需要更新Texture
     */
    needUpdate: boolean;

    /**
     * 是否需要销毁之前的Texture，Texture参数变更之后需要销毁
     */
    needDestory: boolean;

    /**
     * 是否每次都更新Texture
     */
    autoUpdate: boolean;

    /**
     * uv
     */
    uv: number;

    /**
     * 销毁当前Texture
     * @param gl gl
     */
    destroy(): void;

    /**
     * 更新局部贴图
     * @param xOffset
     * @param yOffset
     * @param image
     */
    updateSubTexture(xOffset: number, yOffset: number, image: Image | HTMLCanvasElement | ImageData): void;

  }

  class Texture {
    /**
     * 纹理
     */
    constructor();

    /**
     * 
     * @param params 初始化参数，所有params都会复制到实例上
     */
    constructor(params: Object);

    isTexture: boolean;

    className: string;

    /**
     * 图片对象
     */
    image: Image | HTMLCanvasElement | ArrayBufferView | ImageData | HTMLVideoElement | ImageBitmap;

    /**
     * Texture Target
     */
    target: GLenum;

    /**
     * Texture Level
     */
    level: number;

    /**
     * Texture Internal Format
     */
    internalFormat: GLenum;

    /**
     * 图片 Format
     */
    format: GLenum;

    /**
     * 类型
     */
    type: GLenum;

    width: number;

    height: number;

    origWidth: number;

    origHeight: number;

    readonly border: number;

    /**
     * magFilter
     */
    magFilter: GLenum;

    /**
     * minFilter
     */
    minFilter: GLenum;

    /**
     * wrapS
     */
    wrapS: GLenum;

    /**
     * wrapT
     */
    wrapT: GLenum;

    name: string;

    premultiplyAlpha: boolean;

    /**
     * 是否翻转Texture的Y轴
     */
    flipY: boolean;

    /**
     * 是否压缩
     */
    compressed: boolean;

    /**
     * 是否需要更新Texture
     */
    needUpdate: boolean;

    /**
     * 是否需要销毁之前的Texture，Texture参数变更之后需要销毁
     */
    needDestory: boolean;

    /**
     * 是否每次都更新Texture
     */
    autoUpdate: boolean;

    /**
     * uv
     */
    uv: number;

    /**
     * 销毁当前Texture
     * @param gl gl
     */
    destroy(): void;

    /**
     * 更新局部贴图
     * @param xOffset
     * @param yOffset
     * @param image
     */
    updateSubTexture(xOffset: number, yOffset: number, image: Image | HTMLCanvasElement | ImageData): void;
  }

  class Cache {
    /**
     * 缓存类
     */
    constructor();

    constructor();

    /**
     * 获取对象
     * @param id
     */
    get(id: string): Object;

    /**
     * 获取对象
     * @param obj
     */
    getObject(obj: Object): Object;

    /**
     * 增加对象
     * @param id
     * @param obj
     */
    add(id: string, obj: Object): void;

    /**
     * 移除对象
     * @param id
     */
    remove(id: string): void;

    /**
     * 移除对象
     * @param obj
     */
    removeObject(obj: Object): void;

    /**
     * 移除所有对象
     */
    removeAll(): void;

    /**
     * 遍历所有缓存
     * @param callback
     */
    each(callback: Function): void;

  }

  class MeshPicker {
    /**
     * Mesh 选择工具，可以获取画布中某个区域内的Mesh
     */
    constructor();

    /**
     * 
     * @param params 创建对象的属性参数，可包含此类的所有属性。
     */
    constructor(params: Object);

    isMeshPicker: boolean;

    className: string;

    /**
     * 是否开启debug，开启后会将mesh以不同的颜色绘制在左下角
     */
    debug: boolean;

    /**
     * WebGLRenderer 的实例
     */
    renderer: WebGLRenderer;

    /**
     * 获取指定区域内的Mesh，注意无法获取被遮挡的Mesh
     * @param x 左上角的x坐标
     * @param y 左上角的y坐标
     * @param width 区域的宽
     * @param height 区域的高
     */
    getSelection(x: number, y: number, width?: number, height?: number): Mesh[];

  }

  class Ticker {
    /**
     * Ticker是一个定时器类。它可以按指定帧率重复运行，从而按计划执行代码。
     * @see
     */
    /**
     * @param fps 指定定时器的运行帧率。
     */
    constructor(fps?: number);

    /**
     * 添加定时器对象。定时器对象必须实现 tick 方法。
     * @param tickObject 要添加的定时器对象。此对象必须包含 tick 方法。
     */
    addTick(tickObject: object): void;

    /**
     * 获得测定的运行时帧率。
     */
    getMeasuredFPS(): number;

    /**
     * 指定的时间周期来调用函数, 类似setInterval
     */
    interval(callback: Function, duration: number): object;

    /**
     * 下次tick时回调
     */
    nextTick(callback: Function): object;

    /**
     * 暂停定时器。
     */
    pause();

    /**
     * 删除定时器对象。
     * @param tickObject 要添加的定时器对象。此对象必须包含 tick 方法。
     */
    removeTick(tickObject: object);

    /**
     * 恢复定时器。
     */
    resume(): void;

    /**
     * 启动定时器。
     */
    start(userRAF?: boolean): void;

    /**
     * 停止定时器。
     */
    stop(): void;

    /**
     * 延迟指定的时间后调用回调, 类似setTimeout
     */
    timeout(callback: Function, duration: number): object;
  }

  /**
   * WebGL支持检测
   */
  namespace WebGLSupport {
    /**
     * 是否支持 WebGL
     */
    function get(): boolean;

  }

}
