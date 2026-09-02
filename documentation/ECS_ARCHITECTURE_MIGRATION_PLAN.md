# Hilo3D 性能优先 ECS 架构与破坏性迁移计划

状态：实现与登记性能验收完成 · 性质：生产架构、迁移记录与合并门禁

范围：场景对象模型、Transform 层级、逐帧调度、渲染提取、物理接线、动画、交互、粒子、Addon System
ABI、公共创建与销毁 API

相关生产文档：[`RENDERING_ARCHITECTURE.md`](./RENDERING_ARCHITECTURE.md)、
[`PHYSICS_ARCHITECTURE.md`](./PHYSICS_ARCHITECTURE.md)、
[`PARTICLE_SYSTEM.md`](./PARTICLE_SYSTEM.md)、[`2D_RENDERING.md`](./2D_RENDERING.md) 和
[`ENGINEERING_MODERNIZATION.md`](./ENGINEERING_MODERNIZATION.md)。当前源码和可执行测试是最高优先级事实来源；本文记录已经落地的目标设计和登记硬件性能门禁。

## 当前实施状态

截至 2026-09-02，P1-P6 的生产切换已经完成：

- `src/ecs/` 包含 World-scoped、generation-safe Entity allocator；句柄同时编码 World
  identity，可拒绝 stale 和 cross-World 使用；
- 默认 typed sparse-set、热点 Transform/interpolation SoA、per-entry/data/structure
  revision、required/excluded cached query 和高水位 buffer 复用已实现；
- 带 pending Entity 的 SoA command buffer 会在写入前验证 target
  lifetime、destroy 顺序、组件 presence 和 payload，避免无效批次产生半应用状态；
- typed World resource、transactional async setup、phase/dependency ordering、read/write
  hazard、fixed-step overload policy、同步 execute 和逆序 teardown 已实现；
- Transform/Hierarchy 使用 entity-indexed 关系数组、线性环检测、dirty subtree、current/previous
  submission history、fixed-step interpolation 和 camera-relative origin；
- Mesh、Camera、Light、skin/morph、Sprite、Animation、Interaction、Physics 和 Particle 均通过 World
  component/System 接线；共享 Renderer 只消费增量 `RenderWorld`；
- `Engine`/`World`/component/System 已从根入口发布，`Node`、旧 `Stage`、Node renderer
  traversal、per-Node update/event 和 physics binding 已从生产树删除；
- 10k query/update/churn、100k 宽树/深树、1% dirty、10k
  `Transform + MeshRenderer + RigidBody + Collider` 和双后端浏览器合同已建立。

P0 的 ADR、指标、current-RHI 跨提交采集器、不可覆盖快照协议和 Node/Stage 冻结基线已经完成。2026-09-02 在登记的 Apple
M3 Max macOS/Metal rig 上，以 Node 22.23.1 对冻结提交 `2f72d916510db137b8e3cbb16161a1b38721c227`
和 ECS candidate `541b9824ec18b20143597dfcec108ba9f356d0c6` 执行三轮交替专项比较：100k static + 10k
dynamic 场景的中位 round-p95 从 32.436 ms 降为 4.380 ms，降低 86.50%；每轮均提取 110k
record、仅更新 10k matrix/bounds，Transform/extraction 静态与动态核心边界的最大采样分配均为 0 B。

同机 current-RHI 完整 capture 还确认双后端像素、draw、upload 和 GPU
workload 计数保持一致；独立长 capture 出现时钟/机频漂移后，补充的 baseline/candidate 交替配对复测覆盖 state
switch、PBR、dynamic upload 和 churn，CPU 变化均在 5% 门槛内（PBR 约改善 2%-3%、dynamic
upload 约改善 1%-7%、churn 在正负 1% 内）。这些结果是登记硬件跨提交证据，不使用 SwiftShader
smoke 冒充性能结论。

## 结论先行

Hilo3D 应把当前以 `Stage`/`Node`
继承树为中心的运行时改造成一套**轻量、数据导向的ECS**：generation-safe Entity、typed sparse-set
component
store、热点 SoA、增量缓存 query、批量 System 和显式结构同步点。第一版不实现通用 archetype/chunk
ECS；只有登记基准证明 sparse-set/query 间接访问已经成为主要 CPU 瓶颈时，才为稳定的热点组合引入 chunk
storage。

本计划明确接受破坏性 API，不保留旧对象模型兼容层：

- `Node` **从公共 API 和生产热路径删除**。Entity 是无行为的稳定句柄，不使用继承，不拥有组件
  `Map`，也不逐 Entity 调用 `update()`。
- 当前 `Stage`
  **不原样保留，也不保留同名兼容 facade**。它同时承担场景根、Renderer/Canvas 所有权、Camera 列表、DOM 事件入口、逐帧更新和 Addon
  System 调度，职责不适合作为 ECS composition root。目标 API 拆成 `Engine` 与 `World`。
- `Engine` 负责图形设备、Canvas、Renderer、Render Pipeline、帧提交、恢复和展示生命周期。
- `World` 负责 Entity、Component、System、资源服务、固定步长和结构变更。
- 不再创建独立 `Scene` 运行时容器。可序列化场景、Prefab 和关卡是向 `World` 实例化的数据资产，避免
  `Stage`、`Scene`、`World` 三套所有权重叠。
- 场景树能力不删除，而是改为 `LocalTransform`、`WorldTransform` 和 `Hierarchy` 数据以及专门的
  `TransformSystem`。父子关系不再意味着行为、可见性、更新或资源所有权自动耦合。
- `Mesh`、`Camera`、`Light`、`Sprite`、`RigidBody` 等不再是 `Node` 子类，而是可组合组件。
- 现有共享 Renderer、Render Graph、portable RHI、WebGPU/WebGL 2 后端和 shader
  ABI 不推倒重写。ECS 通过增量 `RenderExtractionSystem` 生成 renderer-owned `RenderWorld`。

这不是为了采用某种 ECS 流派，而是为了解决三个已经出现的结构问题：对象继承限制组合；同一帧存在多次全树遍历；CPU 场景模型与已有 GPU
Scene 的 stable record、dirty upload 和批量处理方向不一致。

## 1. 决策背景

### 1.1 当前对象模型的成本

当前 `Node` 同时拥有或参与以下职责：

- identity、名称、用户数据和事件；
- parent/children 层级；
- local/world transform、dirty 状态和 revision；
- animation、joint 和 skeleton 关联；
- visible、layer、2D sorting 和 pointer 配置；
- 虚方法 `update()` 与应用 `onUpdate` 回调；
- bounds、raycast、clone 和递归查询。

`Mesh`、`Camera`、`Light`、`Sprite`
和 helper 再通过继承增加行为。这对小场景易用，但使“一个对象同时是可渲染物、刚体、可交互目标和游戏逻辑载体”只能依赖外部 binding、子类组合或旁路注册表。

当前一帧还会在不同阶段执行 Node update、Addon renderer preparation、world matrix 更新、renderer
scene
collection 和其他功能遍历。单次遍历不是问题；当每个功能都只能从通用对象树重新发现目标时，静态对象也会反复支付扫描、分支和动态属性读取成本。

### 1.2 已有系统不是 Entity ECS

`StageSystem` 已经具备 descriptor、依赖拓扑、typed service、事务化 setup 和平坦 phase
callback 数组，是合格的**场景级 Addon 调度器**。但它不拥有 Entity/component
storage、query、结构同步点或组件读写声明，因此不能直接解决对象组合和批量更新问题。

迁移应复用其已经验证的生命周期思想，而不是把现有 `StageSystemRuntime` 误当成完整 ECS：

- descriptor dependency 演进为 World System schedule；
- typed service 演进为 World resource；
- phase callback 演进为显式 phase + read/write set；
- 每个 runtime 内部不再维护一套 Node-to-domain binding map，而是查询 World component store。

### 1.3 GPU Scene 已经提供数据导向下游

WebGPU high-end 路径已经使用 stable object slot、current/previous transform、bounds、layer、material
ID、geometry ID、dirty range、GPU culling 和 fixed indirect bucket。ECS 不应再创建第二套 GPU
Scene，而应把 CPU source-of-truth 变成与该数据库天然对齐的增量数据源。

WebGL 2 和不满足 GPU Scene 合同的对象同样应消费紧凑 `RenderWorld` 列表，而不是回退到 Node
traversal。后端差异仍停留在共享 Renderer/RHI 以下，不进入 component 或 gameplay System。

## 2. 方案比较与合理性

| 方案                             | 组合能力 | 稳态遍历 | 结构变更 | JS 实现复杂度 | 决策                     |
| -------------------------------- | -------- | -------- | -------- | ------------- | ------------------------ |
| 保留 Node 继承，继续增加 binding | 弱       | 多次树扫 | 简单     | 低            | 拒绝                     |
| Node 内挂 Component Map 的纯 EC  | 强       | 仍易树扫 | 中       | 低            | 拒绝作为生产核心         |
| sparse-set + 热点 SoA 的轻量 ECS | 强       | 批量查询 | 可控     | 中            | **第一目标架构**         |
| 全量 archetype/chunk ECS         | 强       | 最紧凑   | 搬迁昂贵 | 高            | 暂缓，必须由登记基准触发 |
| 全部组件放入 Wasm ECS            | 强       | 可控     | 边界复杂 | 很高          | 不作为本次迁移范围       |

纯 EC 可以消除继承限制，却无法约束组件行为。如果每个 Entity 保存
`Map<ComponentType, object>`，每帧再逐 Entity 调用各组件的 `update()`，最终只是把 `Node.onUpdate`
分散到更多对象上：动态分派、GC、全量扫描和系统顺序问题仍然存在。

轻量 ECS 能获得本项目需要的主要收益：

1. `RigidBody + Transform + MeshRenderer + Collider` 可以位于同一 Entity；用户不再维护
   `bind(node, body)`。
2. Physics、Render、Animation 和 Interaction 只遍历匹配自身 query 的 dense ID 集合。
3. Transform、bounds、render object 等热点数据可直接进入 TypedArray/SoA 和 GPU dirty upload。
4. System 的依赖、固定步长、读写关系和销毁顺序成为可检查合同。
5. 无渲染 World、多个 World、后台 simulation 和离线 authoring 不再被 Canvas/Renderer 所有权绑死。

### 2.1 为什么第一版不做通用 archetype/chunk

archetype/chunk 的价值来自稳定组件组合下的紧凑顺序迭代和原生缓存局部性。Hilo3D 运行在 JavaScript/TypeScript 中，可直接控制的连续内存主要是 TypedArray；通用 JS
component object 即使被放进 chunk，也不能获得与 C++/Rust 相同的布局保证。

同时，添加/删除组件、切换 LOD/representation、加载/卸载资源、编辑器操作和动态 Collider 都会触发archetype 搬迁。过早采用它会增加：

- archetype 爆炸与 empty chunk 管理；
- Entity location 更新和搬迁复制；
- query matching、序列化和调试复杂度；
- 结构变更期间的引用失效风险；
- 组件对象与 TypedArray chunk 并存造成的双重表示。

第一版通过 sparse-set 获得 O(1) presence、add/remove 和 dense
iteration；对确实需要连续数值布局的热点组件单独使用 SoA。未来的 chunk 必须是 store 的内部替换，不得改变 Entity、query 或 System 公共合同。

## 3. 目标运行时结构

```text
Engine
  ├─ Renderer / RenderPipelineHost
  ├─ RenderGraph / portable RHI / backend
  ├─ Canvas、device recovery、present、frame submission
  └─ frame(world, timing)
          │
          ▼
World
  ├─ EntityAllocator               generation-safe identity
  ├─ ComponentRegistry            stable numeric component type
  ├─ ComponentStores              sparse-set / hot SoA
  ├─ QueryRegistry                incrementally maintained matches
  ├─ ResourceRegistry             typed world-scoped services
  ├─ SystemSchedule               compiled phases and dependencies
  └─ CommandBuffer                deferred structural changes
          │
          ├─ TransformSystem
          ├─ AnimationSystem
          ├─ PhysicsSystem
          ├─ InteractionSystem
          └─ RenderExtractionSystem
                     │
                     ▼
             renderer-owned RenderWorld
               dense views · dirty records · stable render IDs
```

### 3.1 Engine 与 World

目标生命周期示例：

```ts
const engine = await Engine.create({
    canvas,
    backend: 'auto',
    renderPipeline
});

const world = await World.create({
    initialCapacity: 131_072,
    systems: [physicsSystem, animationSystem, interactionSystem, transformSystem, extractionSystem]
});

const camera = world.createEntity();
world.add(camera, LocalTransform, {
    position: [0, 2, 6],
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1]
});
world.add(camera, PerspectiveCamera, {
    fov: 60,
    near: 0.1,
    far: 1_000,
    priority: 0
});

engine.frame(world, deltaTimeMilliseconds);
```

这里的 API 只表达目标所有权，不锁定最终命名细节。必须锁定的是：

- World 可以在没有 Engine/Renderer 的情况下 update；
- Engine 不拥有 gameplay component；
- 一个 World 在同一时刻只能被一个执行中的 frame 驱动；
- Renderer 不回调任意 Entity object，也不遍历 hierarchy 发现 renderable；
- Engine 和 World 都有显式、幂等、按依赖逆序的 destroy。

### 3.2 Entity identity

Entity 是 opaque、generation-safe 的整数句柄。公共句柄必须能检测 stale
use；内部 query 热循环只处理已经验证的 dense entity index，不逐元素重复做 generation lookup。

要求：

- create/destroy 为摊销 O(1)；
- 释放槽可以复用，但旧句柄永不误指向新 Entity；
- Entity 不包含方法、事件监听器、children 数组或 component map；
- 不为 100k Entity 强制分配 100k wrapper object；
- debug name、tag 和 authoring metadata 是可选冷组件，不污染基础 Entity record。

具体 index/generation 位宽必须由容量、复用压力和 TypedArray 方案确定，不在公共 API 中暴露。

### 3.3 Component 类型和存储

Component type 在注册时获得稳定 numeric ID，并声明存储策略：

```ts
interface ComponentDefinition<T> {
    readonly name: string;
    readonly storage: 'sparse-set' | 'soa';
    createStore(capacity: number): ComponentStore<T>;
}
```

这只是说明性接口。正式 API 必须保持严格 TypeScript、显式返回类型和 type-only
import，且不接受任意字符串作为运行时组件合同。

默认 sparse-set store：

- `sparse[entityIndex] -> denseIndex | absent`；
- `denseEntities[denseIndex] -> entityIndex`；
- component payload 与 dense entity 数组同序；
- swap-remove 为 O(1)，迭代顺序默认不作为语义合同；
- store revision 与 per-entry revision 分离。

热点 SoA store 至少包括：

- local position/quaternion/scale；
- world matrix、normal basis、transform revision；
- world bounds 和 bounds revision；
- render active/layer/sorting flags；
- physics interpolated pose；
- 必要时的 skin/morph pose index。

TypedArray 扩容只允许发生在结构同步点，按容量批量增长；稳态 frame 不得扩容、创建 iterator、生成临时数组或复制完整 store。

### 3.4 Query

Query 在创建或 store 结构 revision 变化时增量维护，不在每一帧扫描全部 Entity 做 component
presence 判断。System setup 时缓存 store 和 query handle：

```ts
const movingBodies = world.query(LocalTransform, RigidBody);

function fixedUpdate(): void {
    const entities = movingBodies.entities;
    for (let i = 0; i < movingBodies.length; i++) {
        const entityIndex = entities[i];
        // 直接访问 setup 时缓存的 store；热循环不做 Map.get()/instanceof/generator。
    }
}
```

禁止在核心热路径使用：

- `entity.getComponent()` 的逐元素 Map lookup；
- generator/iterator；
- `Array.filter/map/reduce`；
- 每帧创建 query object 或 tuple；
- component object 自带 `update()` 的动态分派；
- Proxy 驱动的属性脏检测。

### 3.5 System schedule

World 使用固定 phase，并在安装集合变化时编译依赖图和平坦 callback 数组：

```text
input
  -> fixed-pre-physics
  -> physics
  -> fixed-post-physics
  -> update
  -> animation
  -> transform
  -> render-extract
  -> Engine render/submit
  -> cleanup
```

System descriptor 必须声明：

- stable package-qualified ID 和 ABI version；
- hard dependency 与 before/after edge；
- 执行 phase；
- component/resource read set 和 write set；
- setup、execute、destroy；
- 是否允许 fixed-step、多次执行或没有 Renderer 的 World。

第一版 read/write 声明用于验证 hazard、文档化 ownership 和为未来 Worker 调度保留合同，不以未验证的自动并行为目标。调度编译只在 System 集合变化时发生；每帧只遍历实现当前 phase 的平坦数组。

### 3.6 结构变更

System 迭代期间直接 add/remove component 或 destroy Entity 会使 dense
query 失效。因此生产 System 将结构变更写入 `CommandBuffer`，在明确同步点批量应用：

- fixed-step 结束；
- update 结束；
- render extraction 开始前；
- frame cleanup。

同一批命令必须定义 destroy、remove、add、set 和 reparent 的冲突顺序。无效 Entity、重复组件和 dependency 错误在开发/测试构建中 fail-closed；生产构建不得静默产生半应用状态。

## 4. 场景、Transform 与层级

### 4.1 不保留 Node，但保留层级能力

删除 `Node` 不等于把场景改成完全扁平。`Hierarchy` 是独立关系数据，建议使用 entity-indexed
`parent/firstChild/nextSibling/previousSibling` 数组，避免每个 Entity 分配 children array。

`TransformSystem` 负责：

- local TRS dirty queue；
- reparent 与 cycle validation；
- parent-before-child world matrix 更新；
- 脏祖先向后代传播；
- current/previous submitted transform 协调；
- camera-relative rendering origin；
- world bounds dirty propagation。

`LocalTransform` 和 `Hierarchy` 是 authored component；`WorldTransform`、normal basis 和 world
bounds 是 System 自动维护的 derived store，应用不能把它们作为第二套 source-of-truth 手工添加或替换。

静态且未受脏祖先影响的 Transform 不得每帧重新计算 world
matrix。层级遍历只服务 Transform 依赖，不再被 Renderer、Physics、Animation 或 Interaction 当作通用对象发现机制。

### 4.2 可见性与更新不继承层级副作用

现有 `visible`、`needCallChildUpdate`、`pointerChildren` 和 `autoUpdateChildWorldMatrix`
把不同领域的传播规则绑定到同一树。目标模型分别表达：

- `RenderVisibility`/layer mask；
- `UpdateEnabled` 或 System 自己的状态；
- `PointerTarget` 与 interaction propagation policy；
- `TransformStatic`/mobility；
- 可选 `HierarchyVisibility` 策略 System。

默认规则必须显式，不能因为一个父 Entity 不渲染就意外暂停物理或动画。

## 5. 组合模型

### 5.1 Mesh 与 RigidBody 位于同一 Entity

目标用法：

```ts
const crate = world.createEntity();

world.add(crate, LocalTransform, {
    position: [0, 5, 0],
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1]
});
world.add(crate, MeshRenderer, { geometry: boxGeometry, material: crateMaterial });
world.add(crate, RigidBody, { type: 'dynamic', mass: 10 });
world.add(crate, Collider, { shape: boxCollider });
```

应用不再调用
`physicsWorld.bind(node, body)`。但是“无 bind”只表示**没有应用维护的跨对象关联**，不表示没有同步工作：PhysicsSystem 仍必须把 backend
body handle 与 Entity index 对齐，并按明确 authority 更新 Transform。

默认 authority：

| RigidBody 类型     | 默认方向                             |
| ------------------ | ------------------------------------ |
| dynamic            | Physics pose -> Local/WorldTransform |
| velocity-kinematic | Physics pose -> Transform            |
| position-kinematic | Transform -> Physics target          |
| fixed              | Transform -> Physics pose            |

视觉 interpolation 写入独立的 interpolated render
pose 或受控 WorldTransform 输出，不修改 fixed-step 的物理 source-of-truth。teleport、spawn、restore、camera
cut 和 origin shift 必须继续遵守 current/previous submission history 合同。

### 5.2 Collider multiplicity

一个 Entity 默认只能拥有一个给定 component type。单 Collider 可以直接放在 body Entity；compound
body 使用独立 Collider Entity 加 typed `AttachedBody { body: Entity }`
relationship。这样每个 Collider 拥有独立 material、filter、sensor、event 和 lifecycle，同时仍不需要 Node
binding。

禁止把可变 Collider object 数组塞进 `RigidBody`
component；它会破坏增量生命周期、query 和稳定 identity。

### 5.3 推荐核心组件

| 领域      | 组件                                                                       |
| --------- | -------------------------------------------------------------------------- |
| Identity  | `Name`、`TagSet`、typed application components                             |
| Transform | `LocalTransform`、`WorldTransform`、`Hierarchy`、`TransformMobility`       |
| Render    | `MeshRenderer`、`RenderBounds`、`RenderVisibility`、`RenderOrder`          |
| Camera    | `PerspectiveCamera`/`OrthographicCamera`、`CameraOutput`、`CameraPriority` |
| Light     | `DirectionalLight`、`PointLight`、`SpotLight`、`AreaLight`、`ShadowCaster` |
| 2D        | `SpriteRenderer`、`SpriteAnimation`、`CanvasText`                          |
| Animation | `Animator`、`SkeletonPose`、`MorphPose`                                    |
| Physics   | `RigidBody`、`Collider`、`AttachedBody`、`CharacterController`             |
| Input     | `PointerTarget`、`PointerCapture`                                          |

Geometry、Material、Texture、Shader、RenderTarget 等是可共享资源，不因为 ECS 改成 Entity component。

## 6. 渲染接线

### 6.1 Render extraction 是唯一场景入口

`RenderExtractionSystem` 维护 renderer-owned `RenderWorld`，从以下 dirty source 增量更新：

- `WorldTransform` revision；
- `MeshRenderer` resource identity/revision；
- bounds、visibility、layer 和 render order；
- Camera、Light、skin、morph 和 sprite 数据；
- Entity create/destroy 和 component add/remove。

Renderer 不得：

- 遍历 Entity hierarchy；
- 查询任意 application component；
- 调用 Entity/component callback；
- 持有可在下一结构同步点失效的 sparse-set dense index；
- 为 WebGPU 与 WebGL 2 各建一套 extraction。

`RenderWorld` 分配 renderer-local stable render object ID，并记录 Entity
identity 仅用于事件、diagnostics 和 picking 回传。它继续驱动现有 scene
collection、culling、sorting、instancing、Shadow、Render Graph 和 RHI；WebGPU GPU Scene 可以把 dirty
ranges 直接合并上传，WebGL 2 则读取同一 dense CPU record。

### 6.2 提交与历史状态

World mutation revision 和 renderer submission revision 必须分离。成功执行 World update 不代表 GPU
frame 成功提交。previous transform、visibility history、shadow cache 和 renderer resource
cache 仍只能在有效 submission 后 commit；graph build/prepare/execute 失败必须 rollback
renderer-local pending state。

Entity 销毁先使 World component 不可查询；对应 render record 的 retirement 继续服从 submission
fence，不能立即复用仍被 in-flight frame 引用的 GPU slot。

### 6.3 Camera 组合

Camera 是普通 Entity component。`RenderExtractionSystem` 按 `CameraPriority`
和稳定 tie-break 收集 active camera，生成一个 frame 的 ordered view
list。多 Camera 仍进入同一个 Render Graph/RHI submission；UI、clear/load 和 layer
mask 合同不因 ECS 改变。

## 7. 物理、动画、交互和 Addon

### 7.1 Physics addon

保留 `@hilo3d/addon-physics` 的独立包、backend-neutral contract、Rapier
2D/3D 可选依赖、fixed-step、interpolation、snapshot 和 explicit native extension。删除 Node
bridge 和 binding table，改由 PhysicsSystem 直接查询组件。

Physics backend 的 native handle 只存放在 addon-owned
store/resource，不进入核心 RHI 或 Renderer。snapshot restore 以应用 stable component/asset
ID 重建关联，仍不把 Rapier object 暴露给公共 component。

### 7.2 Animation 与 skin/morph

AnimationSystem 批量查询 `Animator + LocalTransform` 或 pose
component。动画 clip 是共享资源；playing state 是 component。Skeleton 不通过 Node name
map 寻址，而在 asset instantiate 时解析为 stable Entity relationship/pose index。

动画写 Transform/pose dirty
range；TransformSystem 和 RenderExtractionSystem 分别消费这些 revision，不再递归查找 SkinnedMesh。

### 7.3 Pointer 与事件

逐 Node `EventDispatcher` 不进入基础 Entity。Pointer
picking 返回 Entity；InteractionSystem 使用集中事件 queue、capture table 和显式 hierarchy
propagation policy。应用通过 System 或订阅 world event channel 消费事件。

资源、Engine、Renderer 的稀疏生命周期事件仍可以保留 typed
dispatcher；禁止给每个 Entity 默认分配监听器容器。

### 7.4 应用行为

内置功能不得以 `BehaviorComponent.update()`
实现。应用逻辑首选类型化 System。若后续为小型 demo 提供 callback
behavior，必须是显式 opt-in 的 convenience
addon，并在文档中标明它是低规模路径；核心性能和示例不能依赖它。

## 8. 公共 API 取舍

| 当前 API/概念               | 目标处理                                       | 原因                                      |
| --------------------------- | ---------------------------------------------- | ----------------------------------------- |
| `Node` class                | **删除**                                       | 继承、对象树和逐对象行为阻止数据导向组合  |
| `Node.children/parent`      | `Hierarchy` store/API                          | 保留层级，不保留对象数组                  |
| `Node.onUpdate/update()`    | **删除**；使用 System                          | 避免逐对象动态调用                        |
| `Node.userData`             | 删除；使用 typed application component         | 消除 unchecked 数据袋                     |
| `Mesh extends Node`         | `MeshRenderer` component + resource handles    | Mesh 可与 Physics/Input 任意组合          |
| `Camera/Light extends Node` | Camera/Light component                         | 同上                                      |
| `Sprite extends Mesh`       | Sprite components + shared quad/resource       | 组合 animation、input、physics            |
| 当前 `Stage`                | **删除并拆为 `Engine` + `World`**              | 分离设备展示与 simulation ownership       |
| `Stage.tick()`              | `Engine.frame(world, dt)` / `World.update(dt)` | 支持 headless update 和明确帧边界         |
| `Stage.systems`             | `World` SystemSchedule + ResourceRegistry      | System 可以直接 query component           |
| `Renderer`/Render Graph/RHI | 保留架构，允许输入 API 破坏性调整              | 已是正确的共享后端边界                    |
| Node physics binding        | **删除**                                       | 相同 Entity 上的组件由 PhysicsSystem 联结 |

这里“删除 Stage”是删除当前 public class 和职责组合，不是删除舞台/世界概念。若最终产品命名坚持使用
`Stage`，它也必须只是新 `World` 或 `Engine` 中一个职责清晰的名字，不能继承 Node、不能保存 scene
children，也不能作为兼容旧 API 的双模型 facade。由于本计划明确不考虑兼容，推荐直接使用
`Engine`/`World`，避免新旧语义混淆。

## 9. 性能原则与风险控制

### 9.1 必须满足的热路径规则

- steady-state update、transform propagation、query iteration 和 render extraction 不产生逐 Entity
  allocation；
- 不使用 per-Entity `Map`、Proxy、closure、iterator 或 polymorphic `update()`；
- component store、query、command buffer 和 dirty queue 预分配并以高水位复用；
- static scene 的 Transform 和 render
  extraction 成本与 dirty 数量相关，而不是与全场景 Entity 数量相关；
- query 选择最小 dense store 为驱动集，并增量维护稳定匹配；
- Renderer 只消费 snapshot/dense record，不访问变化中的 World store；
- component add/remove、Entity destroy 和 reparent 在同步点批量完成；
- 热 store 使用 numeric component ID 和直接字段数组，不按字符串或 constructor 反射查找；
- debug validation 可以更严格，但关闭验证不得改变语义或掩盖 stale handle；
- capacity overflow 明确扩容或报错，不能静默丢 Entity/component/render object。

### 9.2 主要退化风险

| 风险                             | 典型错误实现                           | 防护                                   |
| -------------------------------- | -------------------------------------- | -------------------------------------- |
| component lookup 比直接属性慢    | 热循环反复 `getComponent()`            | setup 缓存 store，query 输出 dense ID  |
| GC 增加                          | Entity/component wrapper 和 tuple      | opaque numeric handle、SoA、高水位复用 |
| 结构变更卡顿                     | archetype 搬迁或即时 query 修补        | sparse-set、command buffer、批处理     |
| Transform 层级变慢               | 每帧重算全部 world matrix              | dirty roots、拓扑顺序、静态子树        |
| Renderer 出现双份状态            | World 与 GPU Scene 都做全量镜像        | revision/dirty extraction、稳定 slot   |
| physics 看似无 bind 实际多次复制 | Node pose、component pose、native pose | 单一 authority、一次批量同步           |
| sparse-set 迭代顺序不稳定        | gameplay 暗中依赖 dense order          | 语义禁止依赖；需要时显式 stable sort   |
| 过早并行导致同步成本             | 每个小 System 都发 Worker job          | 第一版单线程；读写声明只建立未来合同   |

## 10. 性能基准与发布门禁

### 10.1 基线原则

实施前冻结当前提交的 current-RHI 基准快照。比较必须来自同一受控硬件、浏览器、驱动、viewport、后端和场景，使用跨提交不可覆盖记录；不得为了让 ECS
candidate 通过而改写旧基线。SwiftShader smoke 只用于正确性和诊断，不作为正式性能证据。

每个场景记录：

- CPU phase p50/p95/p99：system、transform、physics sync、render extraction、renderer prepare；
- GPU frame time，确认 CPU 改造没有改变渲染 workload；
- JS allocation bytes/frame、minor/major GC 次数与 pause；
- heap peak/steady resident、TypedArray capacity 和 component count；
- visited/matched/dirty entity 数；
- updated world matrix、bounds 和 render record 数；
- GPU upload bytes/ranges、draw/dispatch、visible object 和 cache hit；
- spawn/despawn/add/remove/reparent throughput。

### 10.2 必测场景

1. 100k static + 10k dynamic + 256 lights，复用当前 GPU Scene 规模 fixture。
2. 同规模 WebGL 2 CPU collection/culling，证明移除树遍历不是只优化 WebGPU。
3. 100k Transform 宽树、深树和混合树，分别测试 0%、1%、10%、100% dirty。
4. 10k `Transform + MeshRenderer + RigidBody + Collider` 动态实体，分别测 physics 和 render
   extraction。
5. 每帧批量 spawn/despawn、add/remove component 和 reparent 的结构 churn。
6. 多 Camera、透明排序、sprite batch、skin/morph、shadow caster 和 pointer picking。
7. headless World fixed-step，排除 Renderer/GPU 噪声。
8. device/context loss 前后，验证 render ID、recipe 和 component identity 恢复。

### 10.3 合并门槛

在登记硬件上，最终切换至少满足：

- 代表性静态和动态场景的 end-to-end CPU frame 不得比冻结基线回退超过 5%；
- 100k/10k 场景的 scene update + transform + render extraction p95 至少降低 25%；
- 静态稳态核心 update/extraction 为零逐帧 JS allocation；
- 1% Transform dirty 场景的 matrix/bounds 更新数量与 dirty subtree 同阶，不扫描全部 renderable；
- 同场景 GPU pass、draw/dispatch 和 upload 不发生无法解释的增加；
- WebGL 2 与 WebGPU 的像素、排序、picking、物理插值和生命周期合同保持正确；
- entity/component churn 不产生无界内存增长或超过约定 frame budget 的周期性 compaction 峰值。

迁移专项门禁由 `benchmarks/ecs/manifest.json` 冻结 Node/Stage 基线提交，并通过
`npm run benchmark:ecs:compare -- <baseline-worktree>` 执行。它在 Node
22.23.1 的独立进程中交替运行三轮 100k static + 10k dynamic fixture，以各轮 p95 的中位数判定 25%
CPU 改善，同时检查 10k matrix/bounds dirty 数和 Transform/render
extraction 核心边界的采样分配。World 的事务/回滚外壳仍保留
`try`/`finally`；V8 为异常处理上下文产生的固定开销不冒充逐 Entity 热循环分配，核心边界以 inspector 调用树单独归因。逐 phase 墙钟诊断通过
`WorldParameters.measurePhaseDurations` 显式启用，默认生产更新不读取时钟。

若 25%
CPU 改善目标没有达到，不得以“架构更现代”作为切换理由；先用 profiler 判断瓶颈是 query、Transform、extraction、Renderer
prepare 还是测试噪声。若 sparse-set 间接访问成为主要成本，再进入 archetype/chunk 评估，而不是预先实现。

## 11. 分阶段实施

### P0：基线、ADR 与可执行合同

- 冻结 Node/Stage current-RHI 性能快照；
- 增加上述 CPU/GC/dirty/upload 观测；
- 用 ADR 锁定 `Engine + World`、Node 删除、sparse-set/SoA 和无兼容层决策；
- 定义 Entity lifetime、System phase、command conflict、Transform authority 和 render extraction
  ABI；
- 建立最小 benchmark，不改生产入口。

完成标准：基线可复现，指标能定位 Node traversal、matrix update、scene
collection 和 upload，而不是只有总 FPS。

### P1：ECS kernel

- `EntityAllocator`、generation validation 和 free list；
- component registration、typed sparse-set 和 SoA 基础；
- cached query、resource registry、command buffer；
- System descriptor、schedule compile、phase dispatch 和 destroy；
- stale handle、query mutation、dependency cycle、rollback 和 capacity 测试。

完成标准：headless
benchmark 满足零稳态 allocation，create/destroy/add/remove/query 通过压力与 property 测试。

### P2：Transform/Hierarchy vertical slice

- Local/WorldTransform SoA、hierarchy relationship 和 dirty propagation；
- reparent/cycle、static subtree、world origin 和 previous/current revision；
- Camera 与基础 MeshRenderer component；
- 不接完整 renderer，先验证矩阵和 bounds parity。

完成标准：宽/深/混合层级正确，1% dirty 不退化为全量矩阵计算。

### P3：统一 RenderWorld extraction

- Mesh、Camera、Light、visibility、layer、sorting、skin/morph、sprite 的 component store；
- renderer-local stable render ID、dirty extraction、destroy retirement；
- WebGPU GPU Scene 与 WebGL 2 CPU list 都切换到 RenderWorld；
- 保留 Render Graph/RHI/Shader/Material/Geometry 资源体系；
- 移除 Renderer 内 scene traversal 和 Node callback。

完成标准：双后端 scene、shadow、transparent、multi-camera、post-process、readback、picking 和 recovery 门禁通过；性能达到中期阈值。

### P4：Physics 无 binding 接线

- RigidBody、Collider、AttachedBody、character component；
- PhysicsSystem fixed-step、authority、interpolation、event queue；
- 删除 PhysicsWorld Node bridge 和 binding map；
- snapshot/restore、compound collider 和 stale native handle 测试。

完成标准：同一 Entity 的 Mesh + RigidBody 无应用 binding；2D/3D backend conformance 保持。

### P5：Animation、Interaction、2D 与 Particle

- clip/Animator、skeleton relationship、skin/morph pose；
- pointer target/capture/event propagation；
- sprite animation、Canvas text 和 2D sorting；
- particle addon 改为 World resource/System/component 接线；
- examples 从 `onUpdate` 改为明确 System。

完成标准：所有现有功能都有单一 ECS 路径，不存在 Node-only fallback。

### P6：破坏性切换与删除

- 删除 `Node`、`Mesh extends Node`、`Camera/Light extends Node` 和当前 `Stage`；
- 删除旧 traversal、Node EventDispatcher、`onUpdate`、Addon RenderNodeExtension 和 physics binding；
- 根导出切换为 `Engine`、`World`、component/resource/System API；
- 重写 examples、TypeDoc、API report、package consumer、CHANGELOG 和架构文档；
- 删除迁移期 adapter、feature flag 和重复测试。

完成标准：生产包只有一套 ECS scene/runtime；不存在隐藏兼容模型、双重 transform
source-of-truth 或 Renderer scene traversal。

## 12. 代码组织建议

```text
src/
  core/
    Engine.ts
  ecs/
    Entity.ts
    World.ts
    Component.ts
    SparseSet.ts
    Query.ts
    CommandBuffer.ts
    System.ts
    Resource.ts
  scene/
    components/
      Transform.ts
      Hierarchy.ts
      MeshRenderer.ts
      Camera.ts
      Light.ts
      Interaction.ts
    systems/
      TransformSystem.ts
      AnimationSystem.ts
      InteractionSystem.ts
      RenderExtractionSystem.ts
  render/
    world/
      RenderWorld.ts
      RenderObjectStore.ts
```

目录只表达依赖方向。`ecs/` 不得 import Renderer、WebGPU/WebGL、Geometry、Material 或 physics
backend； `scene/components` 可以保存对公开资源的 typed handle；`render/world` 依赖 scene component
contract，但 component 不反向依赖 renderer internal。

## 13. 明确非目标

第一版不承诺：

- 通用 archetype/chunk；
- 自动多线程 System 调度；
- 将全部 component 放进 SharedArrayBuffer/Wasm；
- ECS 网络复制、rollback gameplay 或编辑器 undo 模型；
- bit-identical physics determinism；
- 把 Geometry、Material、Texture 等共享资源实体化；
- 为旧 `Stage`/`Node`/`Mesh` API 提供 shim、deprecation 周期或运行时 adapter；
- 同时维护 Node renderer 和 ECS renderer 做长期 A/B。

这些边界避免把一次对象模型重构扩大为编辑器、网络和语言运行时重写。后续能力必须建立在已经通过性能门禁的 World/component/System 合同上。

## 14. 最终验收清单

- [x] `Node` 和当前 `Stage` 已从源码、根导出、示例、测试和文档删除。
- [x] Entity 是 generation-safe opaque handle，没有 per-Entity component map/wrapper requirement。
- [x] 默认 component store 为 typed sparse-set，热点 Transform/bounds/render 数据使用 SoA。
- [x] query 增量维护，核心 System 热循环没有 Map lookup、iterator 或逐 Entity 动态分派。
- [x] System schedule 只在安装集合变化时编译，并验证 dependency/read-write contract。
- [x] Transform hierarchy 使用 dirty subtree 更新，静态场景不全量重算。
- [x] Renderer 只消费 RenderWorld，不遍历 Entity hierarchy 或回调 component。
- [x] `MeshRenderer + RigidBody + Collider` 可以在同一 Entity，无应用 binding。
- [x] Physics authority、interpolation、snapshot 和 compound Collider lifecycle 有自动测试。
- [x] WebGPU GPU Scene 与 WebGL 2 共用同一 extraction 数据源。
- [x] graph/submission rollback、temporal history、resource retirement 和 device recovery 保持正确。
- [x] 登记基准达到 CPU、GC、dirty/update 和内存门槛；未用 smoke 数据冒充性能证据。
- [x] 公共 API、TypeDoc、API report、CHANGELOG、package consumer 和示例全部更新。
- [x] 生产树没有 Node/ECS 双模型、兼容 facade、隐藏 binding map 或长期 feature flag。

本地正确性门禁于 2026-09-01 通过：`npm run validate`、`npm run site:build`、
`npm run test:rhi-benchmark-contract` 和明确标记为非证据的
`npm run test:rhi-benchmark-smoke`。正式 ECS 性能门禁于 2026-09-02 通过
`npm run benchmark:ecs:compare -- /tmp/hilo3d-baseline-profile`；基线、候选 SHA、逐轮 p95、dirty 计数和分配结果由命令输出完整记录。
