# Hilo3D 粒子系统实现计划

状态：P0-P5 运行时与 P6 的序列化、capture/cache、baking、外部创作协议均已实现；示例迁移延后

调研基线：2026-08-14

外部基线：Unity 6.5 `6000.5.8f1` / Visual Effect Graph 17.5，Unreal Engine 5.8.1 / Niagara

实现记录：P0-P2 的当前公共用法、执行策略、模块范围、恢复语义和明确边界见
[`PARTICLE_SYSTEM.md`](./PARTICLE_SYSTEM.md)。现有 `compute_particles`
fixture 保持原实现，待粒子功能全部完成后再统一改造。P3 已加入 stateless eligibility/元数据、CPU
absolute-time reconstruction、无持久 state 的 WebGPU generator artifact、确定性 budget
manager 与短促 effect pool；实现边界见
[`PARTICLE_SYSTEM.md`](./PARTICLE_SYSTEM.md)。P4 已加入解析碰撞/trigger、WebGPU scene-depth
collision、只读深度 Soft Particle、CPU 紧凑事件、GPU 常驻 sub-emitter route、typed
`ParticleEventChannel` 与有界异步 aggregate readback。P5 已完成 mesh
bucket、ribbon/trail、受控 Lambert 光照、per-view ordering、时域合成和受限 motion
vector。P6 已加入带 schema/version 的规范 JSON、逐版本 application-owned upgrade、共享 parameter
identity table、稳定资源引用回调和反序列化后的 compiler
validation，并加入绑定 definition/plan/seed/parameter revision 的可复用内存 checkpoint。CPU
cache 复制完整 SoA、调度器和事件；stateless GPU 只保存绝对时间；stateful
GPU 因无同步 readback 合同而 fail-closed。P6 baking 复用同一 checkpoint/timeline：mesh
cache 输出 stable ID/generation 排序的 frame-major instance streams；flipbook 由应用在离线 frame
boundary 提供真实 RenderTarget
readback，核心只验证并打包 atlas，不伪造软件材质渲染。外部创作使用固定 system/emitter/module/renderer
ownership graph、可发布 JSON Schema、规范化 inspector IR、node-addressable
diagnostics 和版本化 deterministic preview command
protocol；它不会引入任意可执行 graph，也不会在 runtime 解释编辑器 metadata。

## 结论先行

Hilo3D 应实现粒子系统，但不应把现有 `compute_particles`
示例直接包装成公共 API，也不应在第一阶段实现节点编辑器。

推荐的产品形态是：

- 一套公共的 `ParticleSystem -> ParticleEmitter -> Module -> Renderer` 模型；
- 同一份 effect definition 编译为便携 CPU、有状态 WebGPU GPU、或轻量无状态执行计划；
- WebGL 2 与 WebGPU 共享生命周期、模块语义、材质、排序、边界、可伸缩性和诊断合同；
- WebGPU 的 compute/storage/indirect 只是执行加速路径，不形成第二套粒子产品；
- 首发提供固定、类型安全的模块库，运行时 IR 稳定后再考虑独立的可视化创作工具；
- 粒子模拟和绘制必须进入 shared renderer、Render Graph 与 RHI，不能从示例复制 native WebGPU 旁路。

Unity 的优势是固定模块易用、运行时控制完整；Niagara 的优势是 System/Emitter/Module/Parameter 的统一模型、CPU/GPU 执行选择、数据接口和可伸缩性。Hilo3D 应吸收两者的结构优点，同时采用 Unreal 最新 Lightweight/Stateless
Emitter 所证明的分层策略：简单效果走低状态成本路径，复杂效果才支付完整模拟成本。

## 1. 调研范围与证据边界

### 1.1 版本

- Unity 当前稳定 Update 是
  [Unity 6.5 `6000.5.8f1`](https://unity.com/releases/editor/whats-new/6000.5.8f1)，发布于 2026-08-12。
- Unity 6.5 对应 Visual Effect Graph 17.5；Unity 官方包清单将它定义为 GPU 模拟的节点式 VFX 工具。
- Unreal 官方文档当前版本是
  [Unreal Engine 5.8](https://dev.epicgames.com/documentation/en-us/unreal-engine)，本次读取的 Epic
  `release` 源码提交是 `71fe36aac5a8df5ccd66c763ffc902b29b6a9c43`，提交说明为 `5.8.1 release`。

### 1.2 源码使用范围

本计划只从源码提取公开架构事实，不复制 Unity 或 Unreal 的实现、代码生成模板、算法代码或受许可保护的表达。

- Unity Built-in Particle System 使用公开的 Unity C# reference source `6000.5.8f1`。
- Unity Visual Effect Graph 使用 Unity-Technologies/Graphics `6000.5/staging` 的 17.5 源码。
- Unreal Niagara 使用 EpicGames/UnrealEngine 官方私有仓库 `release`
  分支；源码链接需要已关联 Epic 权限的 GitHub 账号。
- Hilo3D 的设计和实现必须保持独立，并遵守本仓库 strict TypeScript、ESM、Render Graph、RHI 和 shader
  source-of-truth 规则。

## 2. Unity 6.5 粒子系统分析

Unity 实际提供两种不同层级的方案：Built-in Particle System 与 Visual Effect Graph。

### 2.1 Built-in Particle System

它面向数千级、强运行时交互和快速配置，核心是一个组件及一组固定模块。

| 领域     | 功能                                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------------------- |
| 生命周期 | duration、loop、prewarm、start delay、lifetime、simulation speed、fixed step、play/pause/stop/clear/simulate              |
| 发射     | rate over time、rate over distance、burst、发射上限                                                                       |
| 形状     | sphere、hemisphere、cone、box、circle、edge、donut、mesh、skinned mesh、sprite、texture 等                                |
| 初始属性 | speed、size、rotation、color、gravity、local/world/custom simulation space、random seed                                   |
| 更新模块 | velocity、limit velocity、inherit velocity、force、external forces、noise、color/size/rotation over lifetime 或 by speed  |
| 交互     | collision、trigger、sub emitter、force field                                                                              |
| 表现     | billboard、stretched billboard、horizontal/vertical billboard、mesh、texture sheet animation、trails、lights、custom data |
| 脚本     | 手动 emit、粒子 Get/Set、playback state、trail state、custom data、确定性 seed                                            |
| CPU 扩展 | `IJobParticleSystem`、parallel-for 和 batch job，可直接访问 SoA 粒子属性                                                  |

源码层面的关键观察：

1. `MainModule`、`EmissionModule`、`ShapeModule` 等模块是指向同一 native
   ParticleSystem 的轻量代理，不是彼此独立的运行时对象。
2. 模块集合覆盖常用效果，用户不必先理解 shader 或 GPU buffer。
3. `GetParticles`/`SetParticles`、`GetPlaybackState`/`SetPlaybackState`、手动 `Simulate` 和 Jobs
   API 使 CPU 侧控制非常完整。
4. 粒子 Job 数据按 positions、velocities、colors、sizes 等数组暴露，而不是每粒子对象树。

对 Hilo3D 最有价值的部分是固定模块的易用性、曲线/渐变值域、完整播放控制和数据导向布局。Hilo3D 不应复制 Unity 模块代理的可变 struct 语义；不可变 definition 加 renderer-local
compiled plan 更符合当前资源事务和缓存模型。

### 2.2 Visual Effect Graph 17.5

VFX Graph 面向 GPU 大规模效果。它把逻辑分为两条轴：

- 纵向 processing flow：Spawn -> Initialize -> Update -> Output；
- 横向 property flow：Operator/Expression 为 Context 和 Block 提供值。

主要能力包括：

- 多 System、多输出和 particle strip；
- GPU event 与 output event；
- 可暴露属性、subgraph、custom HLSL、Shader Graph output；
- GPU collision、纹理/深度等外部数据采样；
- sprite、mesh、strip/ribbon、lit/unlit、decal、volumetric 等输出；
- fixed/recorded/automatic bounds、culling、indirect rendering、sorting、motion vectors；
- 高容量 GPU attribute storage、dead list、event buffer 和每输出工作缓冲。

源码层面的关键观察：

1. `VFXContextType` 明确区分 Spawn、Init、Update、Output、Event、GPU
   Spawner 等阶段，Block 只能进入兼容 Context。
2. `VFXDataParticle` 根据实际被模块读取/写入的 attribute 生成布局，而不是固定保存全部属性。
3. capacity、dead list、attribute buffer、GPU event buffer、indirect buffer、sort
   buffer 和 motion-vector buffer 都是编译结果的一部分。
4. 图首先被编译为 expression/context/task/buffer 描述，再生成 compute 或 raster
   shader；编辑器图不是运行时直接解释执行。

对 Hilo3D 的启示是先定义可验证 IR 和编译边界，后做编辑器。若先实现 graph UI，会在 attribute
ABI、执行阶段、后端策略尚未稳定时固化错误模型。

### 2.3 Unity 方案的局限

- Built-in 与 VFX Graph 是两套 authoring/runtime 体系，功能与平台覆盖并不完全相同。
- Built-in 的完全 CPU 可读写能力不能直接扩展为无 stall 的 GPU 粒子合同。
- VFX Graph 的编辑器、编译器和渲染管线耦合规模远超 Hilo3D 当前需求。
- Hilo3D 不应公开“看起来可同步读取全部粒子”的统一 API，再在 GPU 路径里隐藏 readback。

## 3. Unreal Engine 5.8.1 Niagara 分析

Niagara 采用更统一的模型：一个 System 包含多个 Emitter，Emitter 的 stack 包含模块，Parameter
Map 连接 System、Emitter、Particle 和外部数据，Renderer 独立消费粒子 attributes。

### 3.1 Stateful Niagara

典型执行组为：

1. System Spawn / System Update；
2. Emitter Spawn / Emitter Update；
3. Particle Spawn / Particle Update；
4. Simulation Stage / Event Handler；
5. Renderer。

主要能力包括：

- Emitter 级 CPU 或 GPU Compute simulation target；
- 可复用 module、dynamic input、scratch pad、custom HLSL；
- typed parameter、namespace、parameter collection 和 user parameter；
- Data Interface 接入 camera、texture、mesh、skeletal mesh、spline、audio、physics、render
  target、grid、scene query 等数据；
- event、GPU event、Data Channel 和跨系统数据交换；
- sprite、mesh、ribbon、light、decal、component、volume renderer；
- simulation stage、neighbor/grid、fluids 和自定义迭代；
- pooling、Sim Cache、Baker、debug HUD、profiling、validation 和版本化 module/emitter；
- Effect Type、significance、distance/visibility/instance/budget culling、per-platform quality
  overrides；
- Large World Coordinates 与 simulation rebasing。

UE 5.8 还加入了粒子排序的 GPU
Bitonic 路径，并按数量阈值在 Bitonic 与 Radix 间选择。这说明排序不应被写死为一个全局算法，而应由 workload 和后端能力选择。

源码层面的关键观察：

1. `FNiagaraDataSet`/`FNiagaraDataBuffer` 将 float、int 和 half
   component 分开保存，CPU 与 GPU 都消费编译后的 dataset layout。
2. Emitter instance 明确选择 `CPUSim` 或 `GPUComputeSim`，但 renderer property、parameter
   binding 和 System 容器仍复用。
3. GPU compute dispatcher 按渲染阶段组织 simulation dispatch，管理 source/destination
   buffer、instance count、free ID、indirect args、readback 和数据接口依赖。
4. Sprite、mesh、ribbon、light、decal、component、volume 由独立 renderer
   properties 实现；模拟 attribute 与输出表示解耦。
5. Data Channel 将大量短促 impact FX 聚合进共享常驻系统，减少大量 System
   instance 的 tick 与分配成本。

### 3.2 Lightweight / Stateless Emitter

最新 Niagara 允许同一个 System 同时包含 stateful 与 stateless emitter。Stateless
emitter 使用受限固定模块，避免为每个粒子保存跨帧状态，并可由 CPU 或 GPU 在需要绘制时根据 emitter
age、spawn info、seed 和参数生成当前粒子数据。

它的核心权衡是：

- 优点：更少 tick、更少 emitter/particle memory、更短或无脚本编译时间，适合大量简单效果；
- 限制：固定模块集合，不能使用任意 scratch module、dynamic input 或完整事件/数据接口能力；
- 兼容：继续使用 Niagara System、parameter、renderer 与 scalability 外壳。

源码显示 stateless emitter 仍持有 emitter age、seed、spawn
info、参数和固定 bounds，但粒子属性可按当前时间重建；它依据粒子数量和能力选择 CPU 或 GPU data
generation，并复用普通 Niagara renderer。

这对 Hilo3D 很重要：性能分层应是同一产品内的编译选择，而不是再创建一个 `GPUParticleSystem` 类。

### 3.3 Niagara 方案的局限

- 完整 graph/compiler/VM/data-interface 体系体量巨大，不适合作为 Hilo3D 首发范围。
- 每个 stateful emitter 仍有 System/Emitter CPU 管理成本；这也是 Unreal 引入 stateless
  emitter 和 Data Channel 的原因。
- 大量 renderer 与 data interface 依赖 Unreal 已有的物理、材质、编辑器、资产和 world
  subsystem，不能直接映射到 Hilo3D。

## 4. 功能矩阵与 Hilo3D 目标

### 4.1 产品级对比

| 维度              | Unity Built-in       | Unity VFX Graph  | Niagara Stateful     | Niagara Stateless  | Hilo3D 目标                       |
| ----------------- | -------------------- | ---------------- | -------------------- | ------------------ | --------------------------------- |
| 易用固定模块      | 强                   | 中               | 强                   | 强但受限           | 首发必须强                        |
| 自定义图逻辑      | 弱                   | 强               | 强                   | 无                 | 后续工具，不进首发                |
| CPU 粒子访问      | 强                   | 弱               | 强                   | 不以持久粒子为模型 | CPU plan 可选；GPU 不伪装同步访问 |
| GPU 大规模模拟    | 无统一公开编程模型   | 强               | 强                   | 强                 | WebGPU stateful/stateless         |
| WebGL 2           | 支持                 | 依平台/管线      | 不适用 Web           | 不适用 Web         | CPU simulation + instanced raster |
| 多 emitter system | 通过层级组合         | 支持             | 支持                 | 可混合             | 支持                              |
| Renderer 解耦     | 中                   | 强               | 强                   | 复用同一 renderer  | 强制解耦                          |
| 事件/数据通道     | callback/sub emitter | GPU/output event | event/data channel   | 受限               | 分阶段实现                        |
| Scalability       | culling mode         | bounds/culling   | Effect Type 完整体系 | 复用               | renderer-local budget profile     |
| Cache/Bake        | playback state       | 有限             | Sim Cache/Baker      | 可重建             | 后续 deterministic capture/bake   |

### 4.2 Unity Built-in 完整模块目录

Unity 6.5 的 public
binding 和模块手册可归纳为下列固定模块；这比只列 Noise、Force、Color 等常见项更完整。Hilo3D 不照抄属性名，但必须对每一类作出实现或拒绝决定。

| Unity 模块                        | 能力范围                                                                                                                    |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Main                              | duration/loop/delay/prewarm、初始 lifetime/speed/size/rotation/color、gravity、space、scale、capacity、ring buffer、culling |
| Emission                          | rate over time/distance、burst                                                                                              |
| Shape                             | sphere/hemisphere/cone/box/circle/edge/donut、mesh/skinned mesh/sprite/texture、arc/thickness/spread/direction              |
| Velocity over Lifetime            | linear、orbital、orbital offset、radial、speed modifier、simulation space                                                   |
| Limit Velocity over Lifetime      | scalar/axis limit、dampen、drag、size/speed 对 drag 的影响                                                                  |
| Inherit Velocity                  | current/initial emitter velocity                                                                                            |
| Lifetime by Emitter Speed         | 按生成时 emitter speed 映射 lifetime                                                                                        |
| Force over Lifetime               | XYZ force、local/world space、randomized                                                                                    |
| Color/Size/Rotation over Lifetime | curve/gradient、separate axes                                                                                               |
| Color/Size/Rotation by Speed      | 速度区间映射、separate axes                                                                                                 |
| External Forces                   | multiplier、layer/list filter、ParticleSystemForceField                                                                     |
| Noise                             | strength/axes、frequency、damping、quality、octaves、scroll、remap、position/rotation/size amount                           |
| Collision                         | planes/world、2D/3D、dampen/bounce/lifetime loss、kill speed、quality、radius、collider force、messages                     |
| Triggers                          | inside/outside/enter/exit、kill/callback、collider query                                                                    |
| Sub Emitters                      | birth/collision/death/trigger/manual、inherit properties                                                                    |
| Texture Sheet Animation           | grid/sprites、whole sheet/single row、lifetime/speed/FPS time、start frame/cycles                                           |
| Lights                            | ratio、distribution、color、range/intensity、light limit                                                                    |
| Trails                            | per-particle/ribbon、lifetime、width、color、UV mode、world/local、lighting data                                            |
| Custom Data                       | custom1/custom2 vector or color streams                                                                                     |
| Renderer                          | billboard/stretched/horizontal/vertical/mesh、alignment、sort、pivot、flip、masking、shadow/probes、vertex streams          |

关键不是追求 Unity
Inspector 的 1:1 数量，而是覆盖它证明有高频价值的能力族：运动、按生命周期/速度修饰、形状、交互、子效果、atlas、trail 和 custom
channel。

### 4.3 Unity VFX Graph 完整能力族

17.5 源码中的 block/context 进一步补足 GPU VFX 所需能力：

- Spawn：constant/variable rate、single/periodic burst、spawn over distance、custom spawner、GPU
  event；
- Initialize/Attribute：set/add/scale/inherit、curve/map 采样、mass from volume、自定义 attribute；
- Position/Shape：box、circle、cone、line、sphere、torus、mesh、SDF、depth、sequential、tile/warp；
- Velocity/Orientation：direction、speed、random、spherical、tangent、orient、connect target；
- Force：force、gravity、drag、turbulence/curl noise、vector field、conform to sphere/SDF；
- Collision：plane、sphere、oriented box、cone、camera depth、SDF；
- Update：age/reap、Euler/angular integration、previous-position backup；
- Output：point、line、quad/planar primitive、mesh、static mesh、strip/ribbon、Shader Graph
  shading，以及 camera fade、sub-pixel AA；
- Graph/runtime：多 system/output、particle strip、GPU/output
  event、operator/expression、subgraph、custom HLSL、exposed property、property/event
  binding、indirect、sorting、motion vector、fixed/automatic bounds；
- 高级数据：texture/depth/mesh/skinned mesh/SDF/scene
  data 采样，以及后续可扩展的 volume/decal/lit 输出。

Hilo3D 首版固定模块不需要复刻 graph，但 Particle IR 必须给 attribute、event、external
resource 和多 renderer 留出可验证的扩展点，否则 P6 工具阶段会被迫重写 runtime。

### 4.4 Niagara Stateful 与 Stateless 完整能力族

Niagara 在 Unity 能力族之外还强调以下部分：

- System/Emitter：多 emitter timeline、system/emitter spawn/update、warmup、fixed tick、local/world
  space、CPU/GPU simulation target、parameter binding/collection；
- Spawn/Initialize：rate/burst、spawn per distance/unit、lifetime、mass、persistent
  ID、sprite/mesh/ribbon attributes，以及 box/sphere/cylinder/cone/torus/mesh/skeletal
  mesh/spline 等 location；
- Motion/Force：add velocity、acceleration、gravity、drag、wind、curl noise、point/line/vortex
  attraction、rotate around point、vector field、force solver；
- Attribute：color/size/rotation over life 或 by speed、camera offset、facing/alignment、mesh
  orientation/index、ribbon width/id/link、SubUV、dynamic material parameter、custom parameter；
- Interaction：CPU scene query、GPU depth/distance-field collision、kill
  volume/distance、collision/death/location event、event handler、sub emitter；
- Simulation Stage：particle 或 Data Interface iteration、多次迭代、1D/2D/3D direct
  dispatch、partial attribute update、grid/neighbor/fluid 工作流；
- Data Interface：camera、texture、curve、mesh/skeletal
  mesh、spline、audio、physics、landscape、vector field、render target、grid、neighbor、particle
  read、scene query 等外部数据；
- Renderer：sprite、mesh、ribbon、light、decal、component、volume；插件还可增加 geometry
  cache、UI 等 renderer；
- 跨系统与工具：Data Channel、parameter definition/versioning、pool、Sim Cache、Baker、debug
  HUD、profiler、validation、Effect Type、significance、distance/visibility/instance/budget
  culling、platform/quality override、Large World Coordinate rebasing。

UE 5.8.1 源码中的 Stateless 固定模块已经包括 Initialize/Shape、Add
Velocity、Acceleration、Gravity、Drag、Curl Noise、Rotate Around Point、Scale
Color/Sprite/Mesh/Ribbon、size by speed、Sprite Facing、Sprite/Mesh Rotation、Mesh
Index、SubUV、Camera Offset、Dynamic Material、Light/Decal
Attribute 和 owner-scale/accurate-velocity
support。它通过 age/seed/参数解析或 LUT 近似重建结果；不是“只能匀速”的演示路径。

### 4.5 Hilo3D 完整取舍矩阵

优先级含义：`M0` 是首个可用版本，`M1` 是生产可用闭环，`M2` 是高级表达，`X` 是当前产品边界外。

| 能力族                 | Hilo3D 决定                                                                                              | 优先级 |
| ---------------------- | -------------------------------------------------------------------------------------------------------- | ------ |
| System/Emitter         | 多 emitter、duration/loop/delay/prewarm、fixed step、seed、manual event、local/world space               | M0     |
| Emission               | time/distance rate、burst、manual；event/sub-emitter spawn 后补                                          | M0/M1  |
| Analytic Shape         | point/line/edge、box、circle/disc、sphere/hemisphere、cone、torus；支持 surface/volume、arc/thickness    | M0     |
| Asset Shape            | static mesh area/vertex、texture mask；skinned mesh/SDF/depth location 在资源合同成熟后                  | M1/M2  |
| Initialize             | lifetime、mass、position/direction/speed、color、2D/3D size、2D/3D rotation、sprite/mesh/ribbon attrs    | M0/M1  |
| Basic Motion           | velocity、gravity、force/acceleration、wind、drag、limit velocity、inherit emitter velocity              | M0     |
| Procedural Motion      | vector/curl noise、turbulence、radial/orbital/vortex、point/line attraction、rotate around point         | M0/M1  |
| Conform/Field          | vector-field texture、conform sphere；SDF/grid field 后置                                                | M1/M2  |
| Attribute Modifiers    | color/alpha/size/rotation/frame over life 和 by speed、camera offset/fade、screen-space size             | M0/M1  |
| Orientation            | view/world-up/velocity alignment、mesh orientation/rotation、target/look-at                              | M0/M1  |
| Kill                   | age、speed、distance、plane/box/sphere volume、capacity overflow policy                                  | M0/M1  |
| Collision              | analytic plane/sphere/box/capsule；WebGPU scene depth；SDF/physics adapter 后评审                        | M1/M2  |
| Event                  | manual/batched CPU event、birth/death/collision event、GPU event/sub-emitter、bounded aggregate readback | M1     |
| Custom Data            | typed scalar/vector/color channels、dynamic material channels；禁止每粒子 JS callback                    | M1     |
| Sprite Output          | billboard/stretched、blend/depth、sort、atlas/SubUV、soft particle、camera fade、sub-pixel policy        | M0/M1  |
| Mesh Output            | instancing、mesh index/bucket、orientation、opaque/masked/transparent 子集                               | M2     |
| Ribbon/Trail           | ribbon id/link、width/color/age/UV、strip compact、indirect                                              | M2     |
| Lit/Decal/Light/Volume | lit particle 可做；decal/light/volume 等依赖场景基础系统成熟度                                           | M2/X   |
| Component Output       | 不实现 Niagara 式每粒子 SceneComponent；与无每粒子对象/无每粒子 tick 的合同冲突                          | X      |
| External Data          | 首先做 texture/depth/mesh/camera 的 typed provider；不首发 Niagara 式通用 Data Interface VM              | M1/M2  |
| Simulation Stage       | 内部固定 multi-pass kernel 可做；不公开 arbitrary grid/neighbor/fluid stage                              | M2/X   |
| Stateless              | 不是缩水类；为符合条件的 M0/M1 固定模块提供解析式或 LUT 实现并明确 approximation                         | M1     |
| Scalability            | bounds、frustum/distance/visibility/instance/budget culling、quality override、pool/budget profile       | M0/M1  |
| Cache/Authoring        | versioned JSON、capture/cache、bake、diagnostics、preview；graph editor 最后                             | M2     |
| Runtime Access         | CPU plan 可做显式 snapshot/batch edit；GPU 只做异步调试 readback，不承诺同步 particles[]                 | M1/X   |
| Timeline/Binding       | typed parameter/event binding 与 deterministic seek；具体 Timeline UI 交给外部工具                       | M1/M2  |
| Large World/Rebase     | 粒子遵守未来统一 Transform/world-origin 合同，不自建粒子专用 double/world system                         | M2/X   |
| Arbitrary Code/VM      | 不公开任意 WGSL/HLSL、JS callback、通用 VM 或同步 GPU particle access                                    | X      |

`M0/M1/M2` 是产品优先级而不是一个大版本一次交付；第 15 节把它们拆到可验证的 P0-P6 阶段。

## 5. Hilo3D 产品边界

### 5.1 必须实现

- 一套跨 WebGL 2/WebGPU 的公共 API 和 definition 格式；
- 多 emitter system、固定模块、曲线/渐变、typed parameter；
- sprite 粒子、便携 CPU simulation、WebGPU GPU simulation；
- deterministic seed、固定步长、播放控制、手动 burst/event；
- local/world simulation space、bounds、frustum culling、多 Camera；
- 透明混合、排序、texture sheet、soft particle 和 post-process 合成合同；
- 无每粒子对象、无每粒子 Mesh、无每粒子 draw call；
- submission-aware GPU state、device loss recovery 和 renderer-local resource identity；
- diagnostics、质量档、budget/culling 策略和可执行测试。

### 5.2 首发不实现

- 节点编辑器、通用 shader graph 或 Niagara 式 VM；
- 任意用户 WGSL/HLSL 粒子 module；
- 流体、网格邻域、3D grid、SDF 烘焙或通用 GPGPU 框架；
- 与具体物理引擎绑定的通用 collision；
- 每粒子 JS callback、同步 GPU 粒子读取或用 readback 决定 draw count；
- WebGL 2 texture-backed SSBO、transform feedback compute 或 fragment-compute 模拟；
- 为 WebGPU 和 WebGL 2 各维护一套 module/runtime/renderer 产品。

## 6. 公共对象模型

### 6.1 对象层级

```text
ParticleSystemDefinition (immutable, serializable)
  └─ ParticleEmitterDefinition[]
       ├─ spawn modules
       ├─ initialize modules
       ├─ update modules
       └─ ParticleRendererDefinition[]

ParticleSystem extends Node (runtime instance)
  ├─ definition
  ├─ typed parameter values
  ├─ playback clock / seed / events
  └─ renderer-local compiled runtime(s)
       ├─ portable CPU plan
       ├─ WebGPU stateful plan
       └─ stateless plan
```

`ParticleSystemDefinition` 与 emitter/module/renderer definition 构造后冻结。运行时值放在
`ParticleSystem` 的 parameter set 中；修改静态 topology 必须创建新的 definition，避免热路径中 module
layout 和 shader ABI 随意变化。

### 6.2 建议 API 轮廓

```ts
const fireDefinition = ParticleSystemDefinition.create({
    emitters: [
        {
            name: 'flame',
            capacity: 4096,
            execution: 'auto',
            duration: 2,
            looping: true,
            emission: { rateOverTime: 600 },
            shape: { type: 'cone', radius: 0.25, angle: 18 },
            initialize: {
                lifetime: { min: 0.7, max: 1.2 },
                speed: { min: 1.5, max: 2.4 },
                size: { min: 0.08, max: 0.16 }
            },
            modules: [
                { type: 'force-over-lifetime', y: 0.8 },
                { type: 'color-over-lifetime', gradient: flameGradient },
                { type: 'size-over-lifetime', curve: flameSize }
            ],
            renderers: [
                {
                    type: 'sprite',
                    material: flameMaterial,
                    alignment: 'view',
                    sort: 'distance'
                }
            ]
        }
    ]
});

const fire = new ParticleSystem({ definition: fireDefinition, seed: 42 });
stage.addChild(fire);
fire.play();
fire.emit('flame', 32);
```

最终名称可在 P0 API review 中调整，但以下语义必须固定：definition 与 instance 分离、execution
mode 明确、GPU 不提供伪同步读取。

### 6.3 播放控制

第一版公开：

- `play()`、`pause()`、`stop({ clear })`、`restart()`；
- `simulate(deltaTime, { fixedStep })`；
- `emit(emitter, count | command)`；
- `sendEvent(event, payload)`，首版只接受小型 typed CPU payload；
- `timeScale`、`looping`、`prewarm`、`autoPlay`；
- `seed` 与 `deterministic`；
- `isPlaying`、`isPaused`、`isComplete`。

不提供跨后端同步 `particles[]`。CPU plan 可以在后续提供显式 snapshot；GPU
snapshot 必须是调试用途的异步 readback，并且不能参与同帧 simulation/draw 决策。

### 6.4 Typed parameter

公共参数使用带类型的 `ParticleParameter<T>` token，而不是 shader
binding 字符串。definition 保存稳定的 token identity/type/default，`ParticleParameterSet`
提供单调 revision。当前参数已接入连续生成率与 spawn initialization 的 CPU、stateless 和 stateful
WebGPU command 路径；改变 module、renderer 或 attribute topology 仍需创建新 definition。类型：

- `float`、`uint`、`boolean`；
- `Vector2`、`Vector3`、`Vector4`、`Color`；
- `Texture`；
- curve、gradient 和少量 shape value。

parameter 只改变运行时数据；改变 module、renderer、attribute layout、blend/depth
state 或 texture-slot topology 必须创建新的 definition。

### 6.5 固定模块清单

Hilo3D 首先提供固定、可序列化的 discriminated module
union，不要求用户编写 shader 或 graph。下表中的“Stateless”只表示能否从 spawn data、seed 与 absolute
age 重建每粒子结果；标记“条件”的模块由 compiler 根据具体参数给出可解释的诊断。

| 阶段        | 模块                                                                     | 主要能力                                                         | 计划阶段  | Stateless   |
| ----------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------- | --------- | ----------- |
| system      | main/lifecycle                                                           | duration、loop、delay、prewarm、fixed step、time scale、capacity | P1        | 是          |
| system      | simulation-space、bounds、culling、quality                               | local/world、manual/automatic bounds、budget/visibility policy   | P1/P3     | 是          |
| spawn       | rate-over-time、rate-over-distance、burst、manual-emit                   | 连续、按路程、批次和外部命令发射                                 | P1        | 条件        |
| spawn       | event-spawn、sub-emitter-spawn                                           | birth/death/collision/manual event 驱动                          | P4        | 否          |
| initialize  | point、line/edge、box、circle/disc、sphere/hemisphere、cone、torus shape | surface/volume、arc、thickness、spread、顺序/随机分布和初始方向  | P1/P2     | 是          |
| initialize  | static-mesh、skinned-mesh、texture-mask、depth/SDF shape                 | 从资产或场景数据采样                                             | P5/P6     | 条件        |
| initialize  | lifetime、position、direction/speed、mass、color、size、rotation         | 常量、区间、curve/two-curves、gradient/two-gradients             | P1/P2     | 是          |
| initialize  | mesh-orientation/index、ribbon-id/link、custom-channel                   | 为非 sprite renderer 和材质提供初始数据                          | P2/P5     | 是          |
| update      | velocity-over-lifetime、acceleration/force、gravity/wind、drag           | 基础运动、局部/世界空间和质量                                    | P1        | 条件        |
| update      | limit-velocity、inherit-emitter-velocity、lifetime-by-emitter-speed      | 限速、继承发射器运动和按发射速度调 lifetime                      | P1/P2     | 条件        |
| update      | radial/orbital/vortex、point/line-attraction、rotate-around-point        | 程序化轨道和吸引/排斥                                            | P2        | 条件        |
| update      | noise/turbulence                                                         | 确定性空间噪声位置扰动或 vector/curl force                       | P1/P2     | 取决于 mode |
| update      | vector-field、conform-sphere、conform-SDF                                | 纹理场和目标表面约束                                             | P2/P6     | 条件        |
| update      | color/alpha/size/rotation-over-lifetime                                  | 随 normalized age 改变视觉属性                                   | P1        | 是          |
| update      | color/size/rotation-by-speed                                             | 按速度区间改变视觉属性                                           | P1/P2     | 条件        |
| update      | camera-offset/fade、screen-space-size、subpixel-policy                   | 相机距离、屏幕尺寸和小粒子稳定性                                 | P2        | 条件        |
| update      | texture-sheet/SubUV-animation                                            | frame over lifetime/speed/FPS、cycles、随机起始帧                | P1/P2     | 是          |
| update      | dynamic-material/custom-data                                             | typed scalar/vector/color channel 到材质 binding                 | P2        | 是          |
| kill        | age、speed、distance、plane/box/sphere-volume                            | 生命周期与条件/体积淘汰                                          | P1/P2     | 条件        |
| interaction | analytic-collision、scene-depth-collision、trigger                       | plane/sphere/box/capsule 或深度碰撞、inside/enter/exit           | P4        | 否          |
| interaction | external-force-provider、event-channel                                   | 共享力场和 GPU/CPU 事件链                                        | P4        | 否          |
| output      | sprite                                                                   | billboard/stretched、blend/depth、sort、atlas、soft particle     | P1/P4     | 不适用      |
| output      | mesh                                                                     | mesh index/bucket、orientation、instancing、材质子集             | P5        | 不适用      |
| output      | ribbon/trail                                                             | link/order、width/color/age/UV、strip compact                    | P5        | 不适用      |
| output      | lit/decal/light/volume                                                   | 依赖光照、decal、light/volume 基础设施的受控输出                 | P5/后评审 | 不适用      |

模块不是逐个虚函数或逐粒子 JS callback。compiler 会验证 phase、读写 attribute 和 execution
eligibility，再把相邻模块 fuse 成 CPU loop 或 WebGPU
kernel。即使模块名称接近 Unity/Niagara，Hilo3D 也只实现自身明确记录的参数与语义。

### 6.6 Noise 模块合同

Noise 属于基础模块，但必须拆清“无反馈的显示偏移”和“参与积分的力”，避免 CPU、GPU 与 Stateless路径各自解释：

```ts
type ParticleNoiseModule = Readonly<{
    type: 'noise';
    mode: 'position-offset' | 'force';
    field: 'vector' | 'curl';
    strength: ParticleValue<Vector3>;
    frequency: number;
    octaves: 1 | 2 | 3 | 4;
    lacunarity?: number;
    persistence?: number;
    scrollVelocity?: Vector3;
    damping?: number;
    space?: 'local' | 'world';
    seedOffset?: number;
}>;
```

- `position-offset` 从 immutable spawn position、absolute age、system/emitter seed 和 scroll 计算
  `noiseOffset`，渲染位置为
  `position + noiseOffset`；它不把结果反馈给下一 step，因此可进入 Stateless
  plan。首版碰撞仍使用 canonical position，不使用显示偏移。
- `force` 每个 fixed step 对 velocity 积分。`vector` 使用三个去相关标量场，`curl`
  使用无散旋度场；两者都是 stateful，不能被 compiler 静默降为 Stateless。
- `damping` 只对 force
  mode 生效；无效参数组合、非有限数、`frequency <= 0`、非法 octave 必须在进入 renderer/RHI
  frame 前失败。
- P1 实现 CPU reference 与 `position-offset`/`vector force`；P2 在 CPU reference 上补齐 curl
  force 并实现 WebGPU kernel。P3 才允许 compiler 自动选择 Stateless `position-offset`。
- CPU 和 GPU 使用同一 hash、lattice、octave 累加顺序与 float32 合同；首版不依赖 backend texture
  noise。测试包含固定采样点 golden、固定步数 state hash、CPU/WebGPU 容差和 device-loss 重建。
- Noise 首版只影响 position/velocity。rotation、size 或 color 的随机变化由各自的 typed
  over-lifetime/by-speed module 表达，暂不做一个难以验证的多目标 mega-module。

## 7. 值、随机数与确定性

### 7.1 值类型

统一值域：

- constant；
- random between two constants；
- curve；
- random between two curves；
- color/gradient 的对应形式。

Curve 使用排序 keyframe、线性/平滑切线与明确 wrap mode。进入 compiled
plan 时烘焙为固定格式 LUT；CPU 与 GPU 消费同一 LUT bytes，避免两端分别解释高阶曲线。

### 7.2 随机合同

- 使用 counter/hash based PRNG，不依赖全局可变随机序列；
- key 至少包含 system seed、emitter stable id、particle stable id、spawn generation 和 property
  lane；
- compact/sort 后 particle index 改变不能改变随机结果；
- CPU 路径用 `Math.fround` 锁定必须与 GPU 对齐的 float32 中间值；
- 测试比较确定性状态 hash 和容差内图像，不宣称不同 GPU 的所有浮点 bit-exact。

## 8. Particle IR 与 attribute layout

### 8.1 编译流程

```text
immutable definition
  -> schema/topology validation
  -> phase ordering and dependency validation
  -> attribute liveness
  -> curve/gradient/shape baking
  -> execution eligibility
  -> compiled particle plan
       ├─ CPU module program + SoA layout
       ├─ WebGPU compute kernels + storage layout
       └─ renderer packets + shader variants
```

编译必须在 RHI frame 之前完成。definition hash、layout hash、module static features、renderer
topology 和 device generation 共同形成 cache key；参数 revision 不重编译 plan。

### 8.2 Attribute

核心 attribute 候选：

- stable particle id / generation / alive；
- age / lifetime / normalized age；
- position / previous position / velocity；
- size / rotation / angular velocity；
- color；
- sprite frame / mesh index / ribbon id；
- custom scalar/vector channels。

只分配被 module 或 renderer 实际使用的 attribute。CPU 使用按 attribute 分开的 typed
arrays；GPU 使用生成的 SoA/bucket storage layout，避免把最大 AoS record 固定到所有效果。

### 8.3 Stable ID 与 compact

- ID 来自 emitter-local 单调 spawn sequence 与 generation，不等于 buffer index；
- CPU compact 使用 dense alive range 与 swap/move，不能创建临时 particle object；
- GPU 使用 alive/dead list、atomic counter 和 compact index；
- sort 只重排 index，不搬动完整 particle state；
- indirect args 由 GPU 生成，生产帧不回读 alive count。

## 9. 三种执行计划

### 9.1 Portable CPU stateful plan

适用于 WebGL 2、WebGPU 小规模效果和需要 CPU 事件/精确交互的 emitter。

- simulation state 是 SoA TypedArray；
- 固定 timestep accumulator，有最大 catch-up step 防止页面恢复时爆炸；
- spawn/update/kill 在一个或少数 fused loops 中执行；
- compact 后一次性更新 dynamic instance buffer；
- WebGL 2/WebGPU 都使用共享 unit quad 或 mesh + instance stream；
- 不经过 `Mesh[]`、`Material[]` 或每粒子 draw packet；
- 首版在主线程执行；只有 profiling 证明必要且 SharedArrayBuffer/worker 同步合同明确后才增加 worker
  plan。

### 9.2 WebGPU stateful plan

适用于碰撞、邻域、持续力场或无法由绝对时间重建的大规模效果。

目标数据流：

```text
small CPU spawn/event/parameter upload
  -> initialize new particles
  -> simulate existing particles
  -> kill + alive/dead compact
  -> optional per-view sort/index build
  -> indirect args
  -> storage-aware particle raster
```

要求：

- 所有 buffer access 进入 Render Graph；
- compute 使用 Direct WGSL，固定模块由内部模板生成并经 Naga 验证；
- raster 继续使用 GLSL ES 3.10 readonly-storage -> Vulkan GLSL -> Naga -> WGSL；
- resource、pipeline、bind group 在 prepare 阶段稳定缓存；
- execute 只 dispatch/draw，不创建 backend object；
- state buffer 使用 `reinitialize` recipe，并由 deterministic initializer 在 recovery 后完整重建；
- frame 失败不提交 staged GPU state revision；下一有效帧按积累 simulation
  time 恢复或按配置丢弃超额 catch-up。

### 9.3 Stateless plan

适用于仅依赖 spawn time、seed、初始值和可解析时间函数的简单效果。

- 不保存 position/velocity 等跨帧 particle state；
- 根据 absolute system time 计算当前活跃 spawn interval 和每粒子 normalized age；
- WebGL 2 用 CPU 生成当帧 instance attributes；
- WebGPU 可用 compute 生成 renderer input，且无需 persistent state recovery；
- compiler 只有在全部 module 都声明 `stateless-compatible` 时才选择此计划；
- 用户显式请求 `stateless` 而 definition 不兼容时，在 renderer/RHI frame 前报出具体 module。

`execution: 'auto'` 的初步策略：简单 module set 优先 stateless；否则 WebGPU 大容量 emitter 选择 GPU
stateful；其余选择 CPU stateful。阈值必须通过 benchmark profile 决定，不写死为营销数字。

## 10. Renderer 集成

### 10.1 Shared renderer 所有权

ParticleSystem 是可收集的 scene node，但不是 Mesh。shared renderer 增加 particle
collection 和 renderer-local `ParticleRuntimeManager`：

- Stage 每 application frame 只推进一次 system clock；
- 每个 Renderer 为同一 public ParticleSystem identity 保存独立 compiled/resource state；
- culling、layer mask、multi-camera 和 render order 在 shared frontend 处理；
- default Forward 与 custom SRP 通过公共 particle feature/renderer-list extension 记录同一批 graph
  pass；
- 后端只能翻译 RHI 资源与命令，不能拥有 module 或 emitter 语义。

不能让 example 自己实现 `ForwardRenderPipelineFeature` 再称为产品 API。产品 particle
feature 必须由 engine source 提供，并可被默认 Forward 与显式 pipeline factory 复用。

### 10.2 Sprite renderer

首发支持：

- view-facing、world-up、velocity/stretch alignment；
- uniform/non-uniform size、rotation、pivot；
- alpha、premultiplied-alpha、additive；
- depth test、可选 depth write、soft particle；
- texture sheet rows/columns、frame over lifetime、cycle count；
- `none`、distance、youngest、oldest 排序；
- renderer/system `renderOrder`。

CPU plan 使用 instance vertex stream；GPU plan 使用 vertex pulling/readonly storage 和 indirect
draw。两者共享 particle surface shader chunks、texture/color/soft-depth 语义，不维护两套视觉公式。

### 10.3 透明、TAA 与后处理

- 粒子默认在 opaque TAA/TAAU resolve 后、Bloom/tone mapping 前进入 linear HDR scene color；
- transparent particle 不写 opaque motion/depth history；
- 高 emissive/快速闪烁粒子通过显式 composition policy 避免污染 opaque history；
- soft particle 读取当前 scene depth，但不能与同一 pass 的 depth write 形成非法 feedback；
- 首版只在 system/renderer group 粒度与普通 transparent
  queue 排序，不承诺每粒子与任意透明 Mesh 全局交错；
- opaque/masked mesh particle 的 motion
  vector、shadow 和 TAA 支持属于后续阶段，不能由首版透明 sprite API 暗示已支持。

### 10.4 Multi-camera

- simulation 每 application frame 一次，不能每 Camera 重复推进；
- billboard、soft depth、frustum 和排序是 per-camera；
- 无排序/additive emitter 可复用同一 alive index；
- distance sort 使用 per-view index/scratch/indirect state，并设置明确的同时活动 Camera 上限；
- 多 Camera 中任一 draw 被 graph cull 不影响 simulation state；
- Camera layer mask 继续遵守 `(camera.visibility & particle.layer) !== 0`。

### 10.5 后续 renderer

实现顺序：

1. sprite；
2. mesh instance；
3. ribbon/trail；
4. lit particle；
5. decal/light/volume 只在对应 Hilo3D 基础系统成熟后单独评审。

每种 renderer 都只能消费 attribute/parameter，不得把专属行为塞回通用 simulation core。

## 11. Bounds、culling 与 simulation policy

### 11.1 Bounds

公开模式：

- `manual`：用户给出 emitter-local AABB；
- `automatic`：compiler 从 shape、lifetime、velocity、force 和 size 求保守界；
- `dynamic`：仅 CPU plan 首发支持精确动态更新；GPU dynamic
  bounds 属于后续异步 reduction，不得阻塞 readback。

无法保守推导的 GPU module 必须要求 manual
bounds，并在创建或编译时说明原因。不能用无限 bounds 作为静默默认值。

### 11.2 Culling reaction

每个 emitter 支持：

- `render-only`：不可见时继续模拟，只跳过 draw；
- `pause`：不可见时冻结；
- `pause-and-catch-up`：恢复时在最大 step 内追帧；
- `stop`：达到策略条件后停止并清空。

默认 stateful emitter 为 `render-only`，stateless emitter 可安全按 absolute
time 跳帧。visibility、distance、instance budget 和 quality profile 的 reaction 必须显式且可诊断。

## 12. Collision、事件与数据通道

### 12.1 Collision 分层

- P1：解析 plane/sphere/box collider，CPU/GPU 共享数学合同；
- P2：GPU scene-depth collision，作为需要 sampled depth 的 WebGPU module；
- P3：公开 `ParticleCollisionProvider`，允许物理插件提供批量 CPU query；
- 不把 cannon-es 或任一第三方物理对象放入 core API。

### 12.2 Event

- CPU event 使用紧凑 event buffer，在 simulation 后批量处理；
- GPU event 留在 GPU，用于 sub-emitter spawn 或 data channel；
- 不对每个 collision/death 调用 JS callback；如果需要应用观察，提供有上限、显式异步的 aggregate
  readback；
- event payload schema 在 definition 中固定并参与 layout hash。

### 12.3 Data channel / system as a service

后续提供 renderer-local 或 Stage-local `ParticleEventChannel`：

- 应用提交 impact position、normal、velocity、color、type 等小 payload；
- 一个常驻 emitter 消费多个 burst，避免创建大量短命 ParticleSystem；
- channel 有 capacity、overflow policy 和 diagnostics；
- WebGPU 走小 upload + GPU spawn，WebGL 2 走同一 payload 的 CPU spawn。

## 13. Scalability 与诊断

### 13.1 Quality/Budget profile

建议公开 `ParticleBudgetProfile`，至少控制：

- system/emitter 最大实例数；
- 总粒子预算和每 emitter capacity scale；
- distance/visibility culling；
- spawn rate scale；
- renderer/module enable mask；
- sorting、soft particle、collision、ribbon 等昂贵能力档位；
- 超预算 reaction 与 priority/significance。

预算管理属于 renderer-local manager，不能在每个 ParticleSystem 内各自猜全局负载。

### 13.2 Diagnostics

并入 `RendererDiagnostics`：

- active/culled system、emitter、estimated alive particle；
- CPU simulated particle、CPU simulation time、upload bytes；
- GPU dispatch、workgroup、alive/compact/sort pass、indirect draw；
- attribute/storage/instance/scratch bytes；
- plan/cache hit/miss、plan 类型和 fallback 原因；
- dropped spawn/event、capacity overflow、budget cull；
- bounds mode、device recovery/reinitialize 次数。

Render Graph timeline 应显示命名的 particle simulate/compact/sort/draw
pass。默认关闭 diagnostics 时不能引入逐粒子计数、GPU query 或 readback。

## 14. Device loss、销毁与错误边界

- public ParticleSystem/definition identity 在 device recovery 后不变；
- CPU plan 保留 CPU SoA state，可重新上传 instance data；
- GPU stateful plan 使用 deterministic initializer + committed clock/spawn
  log 重建，不声称保留丢失瞬间的 native buffer；
- stateless plan 由 age/seed/spawn info 直接重建；
- event/spawn log 使用有界 ring，超过可重建窗口时按 policy restart emitter，并发出 diagnostics；
- destroy 立即使公共 runtime 不可用，native buffer/pipeline/bind group 受 submission fence 保护；
- explicit `execution: 'gpu'` 在 WebGL 2 必须清晰失败，`auto` 才能选择 portable CPU plan；
- shader/layout/capability 错误必须在 `queue.beginFrame()` 前暴露。

## 15. 分阶段实施

### P0：合同、IR 与确定性基础

交付：

- `ParticleSystemDefinition`、`ParticleEmitterDefinition` 和 discriminated module/renderer types；
- immutable snapshot、validation、stable hash、definition version；
- curve/gradient LUT、counter-based RNG、typed parameter；
- attribute liveness、SoA layout、compiled plan interfaces；
- `ParticleSystem extends Node` 的播放时钟、seed、layer、bounds 与销毁合同；
- 架构测试阻止 backend type、native handle、任意 WGSL 或每粒子对象进入公共 core。

门禁：

- 相同 seed/definition/fixed-step 的 CPU state hash 可复现；
- 非法 phase、attribute、curve、capacity、bounds 和 execution 组合在 renderer/RHI frame 前失败；
- definition mutation 不会暗中改变已编译 runtime。

### P1：便携 CPU Sprite MVP

模块：

- lifecycle/space/capacity、rate over time、rate over distance、burst、manual emit；
- point/line/edge/box/circle/disc/sphere/hemisphere/cone shape，以及 surface/volume、arc/thickness；
- initial lifetime/position/direction/speed/color/size/rotation；
- velocity/force/gravity/wind/drag、limit velocity、inherit emitter velocity；
- noise position offset 与 vector force 的 CPU reference；
- color/alpha/size/rotation over lifetime，以及首批 by-speed 变体；
- age/capacity kill、texture sheet frame-over-life animation。

渲染：

- unit quad instancing；
- view/world-up/stretched billboard；
- alpha/premultiplied/additive、depth test；
- system-level transparent order 与 CPU distance sort；
- WebGL 2/WebGPU 共用 portable shader 和 visual fixtures。

门禁：

- 稳态 simulation/draw 无每粒子对象和无每粒子 draw；
- multi-camera 不重复 simulation；
- context/device loss 后 CPU state 与 public identity 保留；
- WebGL 2 与 WebGPU 在容差内表现一致；
- play/pause/restart/prewarm/manual emit/fixed step 有单元和浏览器覆盖。

### P2：WebGPU Stateful GPU Plan

交付：

- persistent state、alive/dead list、spawn command、compact、indirect args；
- module WGSL compiler/template 和 layout reflection；
- noise curl force 的 CPU reference、WebGPU kernel 与跨路径 parity fixtures；
- torus/donut shape、mass、lifetime-by-emitter-speed、radial/orbital/vortex、point/line
  attraction、rotate-around-point、vector field 与 conform-sphere；
- camera offset/fade、screen-space size、完整 by-speed、SubUV speed/FPS、typed custom/material
  channel；
- speed/distance/plane/box/sphere kill 和 advanced orientation；
- storage-aware sprite raster；
- optional distance sort；小规模 Bitonic 与大规模 Radix/分桶算法通过 profile 选择；
- recovery initializer、submission commit/rollback；
- 迁移现有 `compute_particles` fixture 到公共 ParticleSystem API。

门禁：

- 生产循环无 alive count/sort/state readback；
- graph access 完整覆盖 storage/indirect/vertex/attachment dependency；
- relevant Vitest、`test:render:architecture`、`test:rhi`、`test:webgpu`
  和真实浏览器 pipeline 通过；
- device loss、reload、deterministic seed 和 failure rollback 有覆盖。

### P3：Stateless 与规模化（已完成）

交付：

- [x] stateless eligibility checker；
- [x] CPU stateless
      generator 覆盖 P1 可解析子集以及 gravity/drag/orbit/noise-offset 等有明确解析式或有界重建的模块；WebGPU 无状态路径覆盖 point
      shape、连续生成、sprite 渲染，以及 velocity/force/gravity/wind/drag 和 camera
      renderer 模块，其余定义明确回退到 CPU stateless；
- [x] WebGPU stateless generator 接入 Render Graph、indirect draw 和 regeneration recovery；
- [x] 每个 module 的 `exact`、`approximated`、`stateful-only` metadata 和资产级诊断；
- [x] renderer-local renderer-data/cache recovery contract；
- [x] bounds、layer、hierarchical visibility 与 pool；
- [x] renderer-local budget/profile 及其对 spawn/render quality 的实际应用；

门禁：

- 相同效果在 stateful/stateless 允许子集内视觉和时间语义一致；
- 大量 emitter 时不会产生与 emitter × capacity 成正比的持久 particle state；
- budget 降级原因可诊断且确定性。

### P4：交互、Soft Particle 与事件（已完成）

交付：

- [x] analytic collider；
- [x] WebGPU scene-depth collision；
- [x] soft particle；
- [x] CPU batched event、GPU sub-emitter event；
- [x] typed ParticleEventChannel；
- [x] bounded async aggregate readback。

门禁：

- sampled depth 与 particle write 不产生 graph feedback；
- GPU event 不经 CPU count/readback 驱动 spawn；
- event overflow、channel capacity 和 callback policy 有负向测试。

### P5：Mesh、Ribbon/Trail 与高级渲染（已完成）

交付：

- [x] mesh instancing、mesh index 和 per-mesh bucket；
- [x] ribbon/trail topology、segment compact 和 indirect draw；
- [x] lit particle 与场景光照的受控子集；
- [x] per-view sorting、soft depth、Bloom/TAA composition 完整矩阵；
- [x] optional motion vector 仅在明确支持的 opaque/masked renderer 上开放。

门禁：

- 多 mesh/ribbon 不退化为每粒子 draw；
- transparent ordering 限制写入 API 文档；
- WebGL 2 不支持的高级能力明确 fail/disable 于已声明的 quality plan，不静默改视觉语义。

### P6：序列化、烘焙与创作工具准备

交付：

- [x] versioned JSON definition 与逐版本 upgrade pipeline；
- [x] deterministic capture/simulation cache；
- [x] flipbook/mesh cache baking 接口；
- [x] 外部 graph authoring 所需的 schema、IR、compile diagnostics 和 preview protocol。

已实现的 JSON 合同保留共享 `ParticleParameter` identity，以应用提供的稳定 ID 引用
`Texture`/`Geometry`，不持久化运行时对象 ID；未知字段/tag、未来版本、缺失/跳级 upgrade、资源类型不匹配和 compiler
validation 失败均 fail-closed。JSON upgrade 只处理 plain data，不解释 UI graph，也不承担 simulation
cache 或 baking 职责。Simulation cache 是独立的版本化内存对象：绑定相同 immutable
definition/compiled plan、seed、parameter set identity/revision 和 event capacity；捕获 CPU
fixed-step/SoA/event/manual queue 以及系统 playback/budget/culling 状态；纯 stateless
GPU 仅捕获绝对时间；stateful GPU 明确拒绝，不引入生产循环同步 readback。

Baking 同样拒绝 stateful GPU，以保证结束或失败时能恢复调用者 checkpoint。Mesh
cache 面向 CPU/CPU-materialized stateless mesh
emitter，输出 position、previous-position、velocity、size、rotation、color、mesh-index、stable
identity、frame offsets 与 bounds；flipbook
callback 返回公共 RenderTarget 紧凑 readback，所有帧 extent/format 一致后打包 atlas。两者使用 half-open
fixed-rate timeline，并以 frame/particle/texture/byte limits 限制离线内存和工作量。

外部 authoring contract 已完成：versioned JSON Schema 限定 system/emitter/module/renderer
node 与有序 ownership edge，compiler 重建并验证同一 `ParticleSystemDefinition`，normalized
IR 暴露 plan/layout/hash，diagnostics 定位 graph path/node，preview protocol 提供 deterministic
compile/play/pause/restart/seek/step/inspect/dispose。可视化编辑器仍单独立项；运行时不解释 UI
metadata，也不支持任意可执行 graph。

## 16. 建议目录

```text
src/particle/
  ParticleAuthoring.ts
  ParticleAuthoringPreview.ts
  ParticleBaking.ts
  ParticleDefinitionSerialization.ts
  ParticleSimulationCache.ts
  ParticleSystem.ts
  ParticleSystemDefinition.ts
  ParticleEmitterDefinition.ts
  ParticleParameter.ts
  ParticleCurve.ts
  ParticleGradient.ts
  ParticleRandom.ts
  ParticleModules.ts
  ParticleRenderers.ts
  ParticleBounds.ts
  ParticleCompiler.ts
  ParticleCompiledPlan.ts
  cpu/
    ParticleCPUState.ts
    ParticleCPUSimulator.ts
    ParticleCPUInstanceWriter.ts
  stateless/
    ParticleStatelessCompiler.ts
    ParticleStatelessRuntime.ts

src/render/particle/
  ParticleRuntimeManager.ts
  ParticleRenderFeature.ts
  ParticleResourceCache.ts
  ParticlePipelineCache.ts
  ParticleGPUPlan.ts
  ParticleGPURecovery.ts
  ParticleDiagnostics.ts
  passes/
  shader/

src/shader/particle/
  portable sprite raster GLSL/chunks

test/spec/particle/
test/ui/particle-*.spec.ts
benchmarks/particles/
examples/particles_*.ts
```

如果实现中发现公共模块与 renderer 内部强耦合，应优先调整边界，而不是把 backend 或 graph
handle 泄漏到 `src/particle/`。

## 17. 验证矩阵

### 17.1 单元/架构

- definition snapshot、hash、serialization version；
- curve/gradient LUT 与 CPU/GPU reference samples；
- RNG、stable ID、spawn/burst/rate-over-distance；
- attribute liveness/layout/alignment；
- module phase 和 stateless eligibility；
- fixed-step、pause、prewarm、catch-up、culling reaction；
- bounds 推导和 manual requirement；
- public API 无 native GPU/WebGL type、无 explicit `any`、无 backend branch。

### 17.2 Renderer/RHI

- setup/prepare/execute 分离；
- state/alive/dead/sort/indirect RAW/WAR/WAW；
- failed graph/prepare/execute 的 staged revision rollback；
- destroy/release/submission fence；
- WebGL 2 对 GPU-only plan fail-closed；
- default Forward、feature Forward、自定义 SRP、RenderTarget、多 Camera。

### 17.3 Browser/visual

- WebGL 2 与 WebGPU portable sprite parity；
- alpha/additive/premultiplied、depth、soft particle、texture sheet；
- local/world space、moving emitter、camera movement、resize、DPR；
- standard/reversed depth；
- TAA/TAAU、Bloom/HDR、transparent composition；
- deterministic reload、context/device loss recovery；
- GPU stateful/stateless real pipeline，不能只用 mock adapter。

### 17.4 性能证据

至少保留以下受控 workload，而不是写一个绝对 FPS 宣称：

- 小规模、多 emitter、频繁 burst 的 CPU/Stateless overhead；
- 中规模 portable sprite 的 simulation、upload 和 draw record；
- 大规模 WebGPU stateful simulate/compact/sort/indirect；
- additive 无排序与 alpha 排序对比；
- 1/2/4 Camera 的 simulation-once、sort-per-view 成本；
- capacity occupancy 10%/50%/100%；
- recovery 和 warm cache 后稳态。

性能回归遵守仓库 current-RHI 跨提交冻结快照协议；本地 smoke 不能作为发布证据，不能覆盖 immutable
baseline 让候选通过。

## 18. API 与发布要求

每个公开阶段都必须：

- 为公共类、interface、type 和行为边界写 TypeDoc；
- 增加类型测试、runtime 测试和浏览器示例；
- 更新 `CHANGELOG.md`；
- 运行 `npm run api:update` 后提交经评审的 API report，再运行 `npm run api:check`；
- 运行 `npm run typecheck`、`npm run lint`、targeted
  Vitest、`npm run test:render:architecture`、`npm run test:rhi`；
- 按功能运行 `npm run test:ui:webgl2`、`npm run test:ui:webgpu` 和 `npm run test:webgpu`；
- package 入口变化时运行 `npm run test:types` 与 `npm run test:package`。

## 19. 需要坚持的架构决策

1. **一套公共系统，多个 compiled plan。** 不增加 `WebGPUParticleSystem`、`WebGLParticleSystem`。
2. **固定模块优先，graph 后置。** 易用性先于无限可编程性，IR 先于编辑器。
3. **Stateless 是执行优化，不是另一种资产。** 同一个 System 可混合不同 emitter plan。
4. **GPU 不伪装 CPU 可读。** 不隐藏同步 readback，不用 CPU count 驱动 GPU draw。
5. **Renderer 与 simulation 解耦。** Sprite/Mesh/Ribbon 消费 attributes，不定义生命周期算法。
6. **Attribute 按使用分配。** 不为简单粒子支付最大 record 成本。
7. **Simulation 一帧一次，view work 按 Camera。** 多 Camera 不重复推进粒子时间。
8. **Bounds 与 scalability 是首发合同。** 不能等效果完成后再补性能治理。
9. **错误在 GPU frame 前暴露。** phase/layout/capability/bounds 不合法时 fail-closed。
10. **示例迁移是完成条件。** 现有 compute 粒子页最终必须使用公共 API，避免产品与 showcase 长期分叉。

## 20. 主要参考资料

### Unity 6.5

- [Unity 6000.5.8f1 release](https://unity.com/releases/editor/whats-new/6000.5.8f1)
- [Particle System module component reference](https://docs.unity3d.com/6000.5/Documentation/Manual/ParticleSystemModules.html)
- [Particle System renderer module](https://docs.unity3d.com/6000.5/Documentation/Manual/PartSysRendererModule.html)
- [Visual Effect Graph 17.5](https://docs.unity3d.com/6000.5/Documentation/Manual/com.unity.visualeffectgraph.html)
- [Visual Effect Graph logic](https://docs.unity3d.com/Packages/com.unity.visualeffectgraph@17.5/manual/GraphLogicAndPhilosophy.html)
- [Visual Effect Graph contexts](https://docs.unity3d.com/Packages/com.unity.visualeffectgraph@17.5/manual/Contexts.html)
- [UnityCsReference ParticleSystem modules at 6000.5.8f1](https://github.com/Unity-Technologies/UnityCsReference/blob/d52e6d50a6cea7b4b528c9c6871b0d8a953ff82e/Modules/ParticleSystem/ScriptBindings/ParticleSystemModules.bindings.cs)
- [UnityCsReference ParticleSystem API at 6000.5.8f1](https://github.com/Unity-Technologies/UnityCsReference/blob/d52e6d50a6cea7b4b528c9c6871b0d8a953ff82e/Modules/ParticleSystem/ScriptBindings/ParticleSystem.bindings.cs)
- [Unity ParticleSystem Jobs source](https://github.com/Unity-Technologies/UnityCsReference/blob/d52e6d50a6cea7b4b528c9c6871b0d8a953ff82e/Modules/ParticleSystem/Managed/IJobParticleSystem.cs)
- [VFXContext source](https://github.com/Unity-Technologies/Graphics/blob/42f0bd3c6df7805b954d41f1b4b623fa879434b1/Packages/com.unity.visualeffectgraph/Editor/Models/Contexts/VFXContext.cs)
- [VFX block implementations](https://github.com/Unity-Technologies/Graphics/tree/42f0bd3c6df7805b954d41f1b4b623fa879434b1/Packages/com.unity.visualeffectgraph/Editor/Models/Blocks/Implementations)
- [VFX context/output implementations](https://github.com/Unity-Technologies/Graphics/tree/42f0bd3c6df7805b954d41f1b4b623fa879434b1/Packages/com.unity.visualeffectgraph/Editor/Models/Contexts/Implementations)
- [VFXDataParticle source](https://github.com/Unity-Technologies/Graphics/blob/42f0bd3c6df7805b954d41f1b4b623fa879434b1/Packages/com.unity.visualeffectgraph/Editor/Data/VFXDataParticle.cs)
- [VFX graph compiler source](https://github.com/Unity-Technologies/Graphics/blob/42f0bd3c6df7805b954d41f1b4b623fa879434b1/Packages/com.unity.visualeffectgraph/Editor/Compiler/VFXGraphCompiledData.cs)

### Unreal Engine 5.8.1

- [Niagara overview](https://dev.epicgames.com/documentation/en-us/unreal-engine/overview-of-niagara-effects-for-unreal-engine)
- [Niagara renderer reference](https://dev.epicgames.com/documentation/en-us/unreal-engine/render-module-reference-for-niagara-effects-in-unreal-engine)
- [Niagara Simulation Stage API](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Plugins/Niagara/UNiagaraSimulationStageGeneric)
- [Niagara lightweight emitters](https://dev.epicgames.com/documentation/en-us/unreal-engine/niagara-lightweight-emitters-overview)
- [Niagara scalability and best practices](https://dev.epicgames.com/documentation/en-us/unreal-engine/scalability-and-best-practices-for-niagara)
- [Niagara Data Channels](https://dev.epicgames.com/documentation/en-us/unreal-engine/niagara-data-channels-overview)
- [Measuring Niagara performance](https://dev.epicgames.com/documentation/en-us/unreal-engine/measuring-performance-in-niagara)
- [Unreal Engine 5.8 release notes](https://dev.epicgames.com/documentation/en-us/unreal-engine/unreal-engine-5-8-release-notes)
- [Niagara plugin API](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Plugins/Niagara)
- [NiagaraDataSet source](https://github.com/EpicGames/UnrealEngine/blob/71fe36aac5a8df5ccd66c763ffc902b29b6a9c43/Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraDataSet.h)
- [NiagaraEmitterInstance source](https://github.com/EpicGames/UnrealEngine/blob/71fe36aac5a8df5ccd66c763ffc902b29b6a9c43/Engine/Plugins/FX/Niagara/Source/Niagara/Private/NiagaraEmitterInstanceImpl.cpp)
- [Niagara GPU compute dispatcher source](https://github.com/EpicGames/UnrealEngine/blob/71fe36aac5a8df5ccd66c763ffc902b29b6a9c43/Engine/Plugins/FX/Niagara/Source/Niagara/Private/NiagaraGpuComputeDispatch.cpp)
- [Niagara stateless emitter source](https://github.com/EpicGames/UnrealEngine/blob/71fe36aac5a8df5ccd66c763ffc902b29b6a9c43/Engine/Plugins/FX/Niagara/Source/Niagara/Internal/Stateless/NiagaraStatelessEmitter.h)
- [Niagara stateless runtime source](https://github.com/EpicGames/UnrealEngine/blob/71fe36aac5a8df5ccd66c763ffc902b29b6a9c43/Engine/Plugins/FX/Niagara/Source/Niagara/Private/Stateless/NiagaraStatelessEmitterInstance.cpp)
- [Niagara stateless fixed module headers](https://github.com/EpicGames/UnrealEngine/tree/71fe36aac5a8df5ccd66c763ffc902b29b6a9c43/Engine/Plugins/FX/Niagara/Source/Niagara/Internal/Stateless/Modules)
- [Niagara stateless Curl Noise source](https://github.com/EpicGames/UnrealEngine/blob/71fe36aac5a8df5ccd66c763ffc902b29b6a9c43/Engine/Plugins/FX/Niagara/Source/Niagara/Private/Stateless/Modules/NiagaraStatelessModule_CurlNoiseForce.cpp)
- [Niagara stateless velocity/force solver source](https://github.com/EpicGames/UnrealEngine/blob/71fe36aac5a8df5ccd66c763ffc902b29b6a9c43/Engine/Plugins/FX/Niagara/Source/Niagara/Private/Stateless/Modules/NiagaraStatelessModule_SolveVelocitiesAndForces.cpp)

Epic 源码链接是官方私有仓库，未关联 Epic 权限的账号会看到 404；对应的公开行为可由同节官方文档与 API
reference 复核。
