# Hilo3d 当前渲染架构：Stage、RenderGraph、RHI、Compute 与双后端

> 本文基于当前仓库生产代码整理，描述已经落地的运行时链路，而不是重构规划中的目标状态。

## 结论先行

Hilo3d 当前采用的是“**一套共享渲染前端 + 一个可脚本化 PipelineHost + 一套后端无关的 RenderGraph + 一套 WebGPU 风格的可移植 RHI，以及 WebGPU/WebGL
2 两个具体后端**”架构。普通 raster 继续由两个后端实现；storage、compute 和 GPU-driven
raster 使用同一前端、同一个 Render Graph 与同一个 RHI command scope，但执行能力明确限定为 WebGPU。

它的关键价值不是简单地把 WebGL
API 换成另一组接口，而是把场景遍历、可见性判断、排序与实例化、Pass 组织、资源上传、Shader/Draw 准备、生命周期和恢复都放在共享层；后端只负责把同一份 RHI 资源与命令合同翻译成原生 WebGPU 或 WebGL
2 行为。因此，大多数渲染功能只需实现一次，双后端差异被限制在明确边界内。

![Hilo3d 当前渲染流程](./assets/hilo3d-rendering-pipeline.png)

## 1. 一帧是怎样完成的

### 1.1 Stage：应用与渲染器之间的入口

`Stage.tick(dt)` 先递归更新场景节点，再在存在 Camera 时调用 `renderer.render(stage, camera, true)`。

后端选择发生在创建阶段，而不是每次渲染时：

- `Stage` 与 `Renderer` 只通过异步 `Stage.create()` / `Renderer.create()` 创建。
- `auto` 策略默认先探测 WebGPU，不支持时选择 WebGL 2；显式 WebGL 2 也使用相同的异步创建边界。
- 显式指定 `webgpu` 不会静默回退。
- `preserveDrawingBuffer`，以及 `alpha: true + premultipliedAlpha: false` 这类 WebGL
  2 专属组合，会让 `auto` 直接选择 WebGL 2。
- Pipeline factory 的静态 requirements 会在探测前完成快照。`storage-buffer`、`storage-texture`、
  `compute-pass`、`indirect-draw`、storage texture format 和 compute/storage
  limits 都会把候选后端限定为 WebGPU；与显式 WebGL 2 或 WebGL
  2 专属 Canvas 选项冲突时，创建阶段直接失败。
- `auto`
  一旦因为上述 requirement 选择 WebGPU，后续 adapter、device、Naga 或 pipeline 初始化失败都不会回退 WebGL
  2。公开的 compute/storage capability 只在实际 WebGPU
  feature、format 与 limit 条件同时满足时为 true；不兼容设备在 runtime 创建前 fail-closed。
- `Renderer.create()` 直接返回初始化完成的
  `SharedRendererDriver`，帧热路径中没有额外 Proxy 或逐调用后端分发。

相关代码：[`Stage.ts`](../src/core/Stage.ts)、[`Renderer.ts`](../src/render/Renderer.ts)、[`RendererFactory.ts`](../src/render/internal/RendererFactory.ts)、[`RenderPipelineBackendSelection.ts`](../src/render/internal/RenderPipelineBackendSelection.ts)。

### 1.2 SharedRendererDriver：两套后端共享一条上层流水线

`SharedRendererDriver` 是生产环境中 WebGPU 与 WebGL 2 共用的 Renderer 前端。一次普通场景渲染会经历：

1. 更新场景世界矩阵和 Camera 的 View-Projection 矩阵。
2. 单次遍历收集可见 Mesh 与 Light。
3. 进行视锥裁剪，构建不透明、透明和显式 Instancing 队列。
4. 不透明物体按 `renderOrder / material / geometry`
   聚类，减少状态切换；透明物体保留上游给出的后向前顺序。
5. 规划 Shadow Atlas，并准备 Shadow Pass。
6. 把 Mesh 编译为可复用的 `PreparedDraw`：Pipeline、BindGroup、Vertex/Index
   Buffer、动态状态和 Draw 参数都在执行前准备完毕。
7. 把 Shadow、Main、Transparent、PostProcess、Present 或离屏 RenderTarget
   Pass 加入同一个应用帧 RenderGraph。

普通前向渲染至少包含 Main Pass；存在透明物体时增加 Transparent
Pass；存在投影灯光时在它们之前加入 Shadow
Pass。后处理、显式 Present、离屏渲染和 Readback 也通过同一 RenderGraph 组合，而不是绕过 RHI 走后端私有流程。

相关代码：[`SharedRendererDriver.ts`](../src/render/internal/SharedRendererDriver.ts)、[`RenderGraphFramePlan.ts`](../src/render/RenderGraphFramePlan.ts)、[`RenderList.ts`](../src/render/RenderList.ts)、[`MeshDrawListPlanner.ts`](../src/render/renderer/MeshDrawListPlanner.ts)、[`ForwardRenderer.ts`](../src/render/renderer/ForwardRenderer.ts)。

### 1.3 RenderPipelineHost：默认快路径与可脚本化编排

每个 Renderer 拥有一个 `RenderPipelineHost` 和一个 renderer-local `RenderPipeline`
runtime。创建时未传 `renderPipeline` 时，进程级 `ForwardRenderPipelineFactory` 创建一个 direct
runtime marker；host 识别它并直接调用原有
`ForwardRenderer`/offscreen 路径，不创建公共 context、中间 scene color 或额外 present
pass，因此默认逐 Draw 热路径不经过 feature facade。

显式传入 factory 时，runtime 的同步 `record()` 获得 frame-scoped `RenderPipelineContext`：

- `cull()` 与 `createRendererList()` 复用 shared renderer 的场景收集、排序、instancing 和 mesh
  processor；
- `recordShadows()` 复用同一 Shadow Atlas、LightBlock、resource owner 和恢复链路；
- `ScriptableRenderGraph` 可创建 transient
  texture/buffer，导入 output、RenderTarget 和 renderer-owned `StorageBuffer`，获取 recovery-aware
  persistent target、按 stable key 释放单个 persistent
  target，并添加 scene/fullscreen/copy/compute/GPU-driven pass；单 key
  release 仅在有效 submission 后提交，失败帧会回滚；
- graph buffer 的 storage、vertex、index、copy、indirect、read-write 和 clear access 都在 `setup`
  显式声明。资源 usage 由存活 pass 汇总，imported `StorageBuffer` 必须提供 usage
  superset；copy/clear source、destination 和 byte range 在 RHI frame 开始前验证；
- sampled 与 copy usage 分离；copy 在 setup 声明确切 source/destination pair，并在
  `queue.beginFrame()` 前用实际 RHI texture descriptor 完成验证；
- fullscreen 输入使用固定线性 sampler，因此 capability 明确区分 sampleable 与 `filterable-sampled`；
- fullscreen bind-group descriptor/entry 使用高水位复用，但绑定 graph-transient view 的 native bind
  group 保持 frame lifetime，并由 submission fence 后确定性销毁；
- pipeline invocation 与 feature/setup/prepare/execute callback 的公开 facade 都绑定不可复用 lease
  shell；内部高水位 storage 可跨帧复用，但旧引用不会在后续 callback 重新有效。各阶段必须同步，返回 Promise-like 或在回调外使用 context/handle 会中止并回滚整帧；
- renderer-list 的 Mesh `beforeRender` 在首个声明该 Mesh 的 list 准备 draw
  snapshot 前触发，保证矩阵、材质和 UBO 修改作用于当前帧；Mesh `afterRender` 与公共 face
  count 以 execute 中实际 draw 为准，被 graph
  culling 删除或条件跳过的 list 不产生成功事件/face，重复 depth/override/color
  draw 不重复累计公共 face；
- 每个 scriptable invocation 开始时先解除上一 invocation 的 shadow scene binding，省略
  `recordShadows()` 不会复活旧 atlas/LightBlock；
- factory 可异步创建 runtime，但每个 Renderer 必须获得独立 runtime；同一个 runtime 不能附着到两个 Renderer。

带 feature 的 `ForwardRenderPipelineFactory` 在构造时快照配置并合并静态 capabilities/limits/format
requirements；每个 feature 配置在 Renderer 创建时产生独立且只能附着一次的 runtime。feature
context 暴露内置 forward/shadow 共用的 `cullingResults`，因此附加 Scene
Pass 无需重新 cull，也不会与 Shadow Atlas 的场景 identity 分叉。只有 feature 声明需要采样 scene
color/depth 时才创建中间资源；其中 scene color 使用公共 fullscreen 线性采样 ABI，因此要求
`filterable-sampled` format；无 feature 的默认 factory 始终保留 direct recorder。

scriptable output 同时暴露只读、后端无关的 color/depth/stencil load/store/clear
policy。带 feature 的 Forward pipeline 把该 policy 分配到首个和末个 Scene
Pass；中间队列 Pass 强制 store/load 以保持内容。当 filterable sampled scene
color 需要中间纹理且 output 选择 `load`
时，先把旧 output 搬入中间纹理；若中间 color 无法无损搬运 multisample/non-filterable 内容，则在 RHI
frame 开始前明确失败。scene color sampling 只允许在 opaque writer 之后。内置
`ForwardRenderPipelineFeature.requirements.sampledDepth`
仍保持 fail-closed；需要完整 Forward+ 深度预处理/采样链路时，应使用自定义 `RenderPipeline`
显式记录 depth Scene Pass、compute Pass 与最终 storage-aware Scene
Pass，而不是假定内置 feature 已经自动改写 forward shader。

设备恢复必须保留 runtime 创建时可见的完整公共 capability 超集，包括 limits 和全部公共 format/use/sample-count 查询；能力缩减会使恢复明确失败，而不是让旧 runtime 在后续 pass 中延迟出错。

相关代码：[`RenderPipelineHost.ts`](../src/render/internal/RenderPipelineHost.ts)、[`pipeline/`](../src/render/pipeline)、[`ScriptableRenderPipelineContext.ts`](../src/render/internal/ScriptableRenderPipelineContext.ts)。

### 1.4 WebGPU Compute 与 GPU-driven raster

Compute 不是 `Material`。它使用三个后端中立、不可变的 CPU 配置对象：

- `ComputeShader` 保存 Direct WGSL、entry point、workgroup size 和显式 binding ABI；
- `ComputeKernel` 保存 shader 与不可变 override constants；
- `ComputeRenderPass` 从 shader ABI 推导 graph
  access，在 prepare 阶段解析资源并复用显式 layout/pipeline/bind
  group，在 execute 阶段只发 direct 或 indirect dispatch。

compute binding 覆盖 uniform buffer、readonly/read-write storage buffer、完整 2D sampled
texture、filtering/non-filtering/comparison sampler 和完整覆盖的 transient write-only 2D storage
texture。首发 graph texture 不公开 array/cube/3D 或 mip/layer 子资源 view，也没有 persistent storage
texture；跨帧 GPU 数据使用 renderer-owned `StorageBuffer`。它是公共逻辑资源，CPU 写入走统一 upload
transaction，异步读取走 graph copy、submission fence 和 staging
map；每个 Renderer 同时只允许一个 pending storage-buffer readback，调用方应串行等待。`cpu-shadow` 与
`reinitialize` 恢复策略明确区分“恢复 CPU 快照”和“恢复后必须由完整 GPU
writer 重新初始化”。GPU 写入只在有效 submission 后提交内容分歧，后续相同 CPU
bytes 仍会重新上传，避免 CPU shadow 错误掩盖 GPU 修改。

`StorageGraphicsShader` 是独立的 WebGPU-only graphics source contract：vertex/fragment 仍由受控 GLSL
ES 3.10 storage subset 经统一预处理和 Naga 转为 WGSL，不接受手写 graphics WGSL；首版只允许 readonly
storage。其 Material/Scene texture reflection 仍保留 2D-array/3D/cube 与 sint/uint 类型表达，但
`GPUDrivenRenderPass` 绑定的 graph texture 当前必须是完整 2D view，非 2D
descriptor 会在构造/prepare 阶段拒绝。`GPUDrivenRenderPass` 把这种 shader 与普通 `Material`
的 blend/depth/cull raster state 组合，并支持 vertex pulling、显式 vertex/index buffer、direct
draw、draw indirect 和 indexed draw indirect。compute、copy 与 raster 都通过同一 graph
access 建边，不读取 GPU 产生的 count、排序结果或 indirect arguments。

Scriptable compute 与 GPU-driven raster 的 bind
group 采用两级生命周期：layout 和全部绑定资源都能反查到 `ResourceRegistry`
逻辑 handle 时，`ScriptableBindGroupResourceCache` 按 owner、group
slot、layout、资源 identity 与 buffer range 精确复用可恢复的 persistent bind
group；任何 frame/transient graph 资源都会使该 group 确定性回退到 submission-fenced frame bind
group。缓存不会把瞬态 texture/view 留到下一帧，也不会因为 descriptor 对象每帧重建而丢失稳定命中；device
generation 切换后，persistent recipe 使用同一逻辑 handle 重建原生 bind group。

普通 renderer list 也可以通过 `SceneRenderPass.storageShaderVariant` 使用 pass-global readonly
storage。固定 group 3 由整个 pass 共用，group 0–2 继续服务现有 pass/material/mesh
ABI；场景遍历、裁剪、排序、Material/Geometry/UBO 准备和 Mesh 事件仍走 shared renderer。storage-aware
variant 当前不合并 instanced batch，而是确定性展开为逐 Mesh direct
draw，保证正确性且不建立第二套场景渲染器。

Direct WGSL compiler 会反射并验证 entry point、literal workgroup size、workgroup storage、binding
ABI 与 pipeline override。当前 Naga WGSL validation/writer 路径不能可靠承载 Direct WGSL
`f16`，因此即使设备可申请 `shader-f16`，compute source 中的 `f16`
仍在 pipeline 创建前明确 fail-closed。

WebGL 2 对 compute pipeline、storage binding 和 indirect draw 提供的是明确的 negative
implementation：在任何 native GL compute/storage 模拟之前失败，不使用 texture-backed SSBO、transform
feedback、fragment compute 或 CPU fallback。完整公共合同、目标场景组合方式与首发边界见
[`COMPUTE_STORAGE_IMPLEMENTATION_PLAN.md`](./COMPUTE_STORAGE_IMPLEMENTATION_PLAN.md)。

相关代码：[`compute/`](../src/render/compute)、[`StorageBuffer.ts`](../src/render/StorageBuffer.ts)、[`storage/`](../src/render/storage)、[`ComputeRenderPass.ts`](../src/render/pipeline/passes/ComputeRenderPass.ts)、[`GPUDrivenRenderPass.ts`](../src/render/pipeline/passes/GPUDrivenRenderPass.ts)、[`ScriptableComputeDispatch.ts`](../src/render/renderer/ScriptableComputeDispatch.ts)、[`ScriptableGPUDrivenDraw.ts`](../src/render/renderer/ScriptableGPUDrivenDraw.ts)、[`compute_gpu_driven.ts`](../examples/compute_gpu_driven.ts)、[`compute_particles.ts`](../examples/compute_particles.ts)、[`compute_raytracing.ts`](../examples/compute_raytracing.ts)。

### 1.5 RenderGraphFrame：一帧的事务边界

`RenderGraphFrame` 把一帧固定为完整的同步事务：

```text
reset arena/uploads
    -> build graph
    -> compile graph
    -> validate uploads
    -> allocate/import live resources
    -> prepare passes
    -> begin RHI frame
    -> flush uploads
    -> execute passes
    -> submit
    -> commit resource revisions
```

如果 Build、Compile、Prepare 或 Execute 任一阶段失败，上传批次和资源使用记录会回滚；只有获得有效
`RHISubmission`
后，缓存 revision 与资源“本帧已使用”状态才会提交。这避免了“CPU 侧认为更新成功，但 GPU 命令并未提交”的状态撕裂。

`FrameArena`、`RHIUploadBatch`、Pass 参数、Builder/Compiler/Executor
Workspace 都采用高水位复用：容量增长到历史峰值后，稳态帧尽量复用已有数组、对象和 TypedArray，减少 GC 压力。

相关代码：[`RenderGraphFrame.ts`](../src/render/frame/RenderGraphFrame.ts)、[`FrameArena.ts`](../src/render/frame/FrameArena.ts)、[`RHIUploadBatch.ts`](../src/render/frame/RHIUploadBatch.ts)、[`FrameResourceUseTracker.ts`](../src/render/renderer/FrameResourceUseTracker.ts)。

## 2. RenderGraph 设计

### 2.1 图模型：声明“需要什么”，而不是立即操作 GPU

RenderGraph 使用数字 Handle 表示 Texture、Buffer 和 Pass。资源分为：

| 资源类型    | 含义                        | 典型用途                                                                 |
| ----------- | --------------------------- | ------------------------------------------------------------------------ |
| `transient` | 图执行器创建和管理          | MSAA Color、临时 Depth、compute scratch、间接参数、Readback Buffer       |
| `imported`  | 外部持久资源或延迟 Provider | Surface Texture、RenderTarget Attachment、renderer-owned `StorageBuffer` |
| `extracted` | 执行后把所有权交给调用方    | 自动创建的 Readback/Staging 资源                                         |

Pass 模板被严格分成三阶段：

- `setup`：只声明资源读写、Attachment、显式依赖和 Side Effect；不拥有 Device，也不能发命令。
- `prepare`：所有存活资源已经创建或导入，但 RHI
  Frame 尚未开始；用于提前准备 Pipeline、Framebuffer、Vertex Input 等后端对象。
- `execute`：唯一可以访问 `RHICommandContext` 并发出 RHI 命令的阶段。

Surface 使用延迟 Provider 导入。只有图编译后仍被存活 Pass 使用时，Executor 才调用
`surface.getCurrentTexture()`，从而把帧级 Surface Texture 的获取推迟到最后的安全时间点。

相关代码：[`RenderGraphBuilder.ts`](../src/render/graph/RenderGraphBuilder.ts)、[`RenderGraphResource.ts`](../src/render/graph/RenderGraphResource.ts)、[`SurfaceGraphBridge.ts`](../src/render/renderer/SurfaceGraphBridge.ts)。

### 2.2 编译：先证明图合法，再触碰 GPU

Compiler 是纯 CPU 阶段，主要完成：

1. 按实际 Device `capabilities` 规范化并校验 Buffer/Texture Descriptor。
2. 根据 texture/buffer 的 storage、vertex、index、copy、indirect、Attachment 和显式依赖统一建立 RAW、WAR、WAW 顺序；compute、copy 与 raster 不使用独立 hazard 系统。
3. 拒绝未初始化读取、Discard 后读取、同 Pass 非可移植读写反馈、Attachment 尺寸/采样数不匹配和依赖环。storage
   buffer 只有通过窄化的 `readWriteBuffer()` 才能合法原地读写；storage
   texture 仍不允许 sampled/write feedback。
4. 使用稳定拓扑排序得到可复现的 Pass 顺序；没有依赖关系时保留插入顺序。
5. 以标记输出和 Side Effect Pass 为根做反向可达分析，裁掉不会影响结果的 Pass 与资源。
6. 计算存活资源的 `firstUse / lastUse` 生命周期区间。

这意味着大量错误会在创建临时 GPU 资源和 `queue.beginFrame()` 之前失败，两个后端获得相同的错误边界。

相关代码：[`RenderGraphCompiler.ts`](../src/render/graph/RenderGraphCompiler.ts)、[`RenderGraphValidation.ts`](../src/render/graph/RenderGraphValidation.ts)。

### 2.3 执行：资源准备、Pass 执行与提交围栏

Executor 的顺序是：

1. 为存活资源租用 Workspace。
2. 从按 Descriptor 分桶的瞬态资源池取资源，或调用 Imported Provider。
3. 逐 Pass 执行 `prepare`，此时没有 CommandContext，确保原生对象创建不落入 Draw 热路径。
4. `graphicsQueue.beginFrame()`。
5. 在第一个 Pass 前统一 Flush `RHIUploadBatch`。
6. 按编译后的稳定顺序执行 copy、render 和 compute Pass；一个 command context 同时只允许一个 open
   render/compute pass。
7. `graphicsQueue.endFrame()` 得到 `RHISubmission`。
8. 等提交完成后再把瞬态资源归还池、释放 Workspace；提交失败则丢弃相关资源。

当前实现已经具备生命周期分析和跨帧瞬态资源池，但池中资源会保持占用直到对应 Submission 完成；本文不把“根据
`firstUse / lastUse` 在同一帧内做物理内存别名”列为当前已实现能力。

相关代码：[`RenderGraphExecutor.ts`](../src/render/graph/RenderGraphExecutor.ts)、[`RenderGraph.ts`](../src/render/graph/RenderGraph.ts)。

## 3. RHI 设计

### 3.1 WebGPU 风格、可移植子集

RHI 的对象模型接近 WebGPU：`Device / Queue / CommandContext / RenderPass / ComputePass / Surface / Buffer / Texture / Sampler / Shader / BindGroup / GraphicsPipeline / ComputePipeline`。但它不是 WebGPU
API 的简单拷贝。普通 raster 合同是 WebGPU 与 WebGL 2 的可移植子集；WebGPU-only compute/storage/
indirect 合同仍定义在 backend-neutral core 中，并要求不支持的 WebGL 2 后端在 native
call 前明确拒绝。

RHI Core 不依赖任一具体后端，也不允许原生 `GPU*` 或 `WebGL*`
类型跨越边界。上层只能依据统一 Descriptor、Usage Flags、Format、Capabilities 和命令合同编程。

相关代码：[`core/`](../src/render/rhi/core)、[`RHIArchitecture.test.ts`](../test/spec/rhi/portable/RHIArchitecture.test.ts)。

### 3.2 Device 与 Surface 分离

Device 负责资源、Pipeline、Queue、能力和丢失状态；Surface 负责 Canvas 配置、当帧纹理获取和显式
`present()` 边界。

这个拆分带来几个直接收益：

- Device 可以先于 Surface 存在，渲染资源不与默认帧缓冲绑定。
- Surface Texture 明确是 `frame` 生命周期，`present()` 后立即失效。
- Offscreen RenderTarget、Readback 和 Canvas 呈现共享同一套资源/命令语义。
- WebGPU 的隐式浏览器呈现与 WebGL 2 的默认帧缓冲行为被收敛为一致的显式生命周期边界。

相关代码：[`RHIResources.ts`](../src/render/rhi/core/RHIResources.ts)、[`RHISurface.ts`](../src/render/rhi/core/RHISurface.ts)。

### 3.3 显式 Queue 与帧状态机

当前 RHI 暴露一个互斥 Frame Scope：

```text
queue.beginFrame()
    -> upload/copy/clear/render pass/compute pass commands
    -> queue.endFrame() -> RHISubmission

失败路径：queue.abortFrame()
```

`RHICommandContext` 允许 copy/clear 在 pass 外执行，并保证 render pass 与 compute
pass 不会同时打开；direct/indirect dispatch、draw/drawIndexed
indirect 分别只能出现在正确 pass 内。后端可以立即执行或延迟编码，但上层无法观察或依赖这一差异。`RHISubmission.done`
是资源原生生命周期的围栏：逻辑 `destroy()` 可以立即生效，真正的原生释放必须等所有引用它的提交结束。

相关代码：[`RHICommands.ts`](../src/render/rhi/core/RHICommands.ts)、[`RHIQueue.ts`](../src/render/rhi/core/RHIQueue.ts)。

### 3.4 能力驱动与统一验证

每个 Device 创建一个不可变 `RHICapabilities`
快照，包括 Feature、Limit 和逐 Format 的 sampled/filterable/renderable/blendable/storage/sampleCounts 信息。

所有 Descriptor 和跨资源操作先经过共享验证层：

- 资源 Usage、尺寸、对齐和格式能力。
- BindGroup/Pipeline Layout 兼容性。
- compute workgroup/dispatch limits、storage binding 数量与 range/dynamic alignment、storage texture
  format/access/sample count、clear/indirect usage/offset/range，以及 pass 状态机。
- Attachment 子资源、load/store、read-only
  aspect 与 Pipeline 写入兼容性，以及 Copy、Mipmap 和 Map 约束。
- Device Ownership、Device Generation、Destroyed 状态。

因此，上层不会用“先调用后端，再从原生错误猜能力”的方式分支；同一非法输入在两套后端上尽量得到同一类
`RHIValidationError`。

相关代码：[`RHICapabilities.ts`](../src/render/rhi/core/RHICapabilities.ts)、[`RHIValidation.ts`](../src/render/rhi/core/RHIValidation.ts)、[`RHICopyValidation.ts`](../src/render/rhi/core/RHICopyValidation.ts)。

### 3.5 Shader 产物在 RHI 之上完成分流

普通引擎材质仍以 GLSL ES 3.00 为唯一来源，`ShaderArtifactCompiler`
在进入 RHI 前生成后端专用 Artifact：

- WebGL 2：保留 GLSL，补齐 Uniform Block 与 Combined Sampler 的可移植 Binding 计划。
- WebGPU：通过 Naga 将 GLSL 转译为 WGSL，并生成同一套 Binding、Vertex Input、Fragment Output
  Reflection。

RHI 只接收已经带后端判别、代码、入口、Reflection 和 Cache Key 的 Shader
Artifact。这样 Shader 语言差异不会污染 RenderGraph 或 RHI 命令层。

WebGPU compute 是一个有意的独立 source contract：`ComputeShader` 接受 Direct WGSL，
`WgslComputeShaderCompiler` 必须先用 Naga WGSL frontend 校验语法、entry point、workgroup
metadata 与显式 binding ABI，再形成 RHI artifact。它不经过 GLSL 转换，也不改变普通 graphics
shader 的单一 GLSL 来源。storage-aware raster 则使用 `StorageGraphicsShaderCompiler` 的受控 GLSL ES
3.10 readonly storage subset，仍经 engine preprocessing、Vulkan GLSL
4.50 和 Naga 生成 WGSL；仓库不维护手写 graphics WGSL 镜像。

WebGPU mipmap utility 同样在设备创建前从 GLSL ES 3.00 经 Naga 准备为 Shader
Artifact，再注入具体设备。共享 Renderer 复用已初始化的材质 compiler；低层 `RHIFactory`
不反向启动 shader 编译，而是把 mipmap Artifact 作为 WebGPU device create
options 的必填依赖，使该能力在类型和运行时合同中都显式可见。Shader
module、layout 和 sampler 在设备创建阶段建立，按 format 复用的 pipeline 与逐 mip/layer view、bind
group 在 texture allocation 阶段准备；`generateMipmaps()` 的 execute 路径只编码 render
pass，不创建这些原生对象。

相关代码：[`ShaderArtifactCompiler.ts`](../src/render/renderer/ShaderArtifactCompiler.ts)、[`GlslToWgsl.ts`](../src/render/shader/GlslToWgsl.ts)、[`WgslComputeCompiler.ts`](../src/render/shader/WgslComputeCompiler.ts)、[`StorageGraphicsShaderCompiler.ts`](../src/render/shader/StorageGraphicsShaderCompiler.ts)、[`NagaModule.ts`](../src/render/shader/NagaModule.ts)。

## 4. WebGPU / WebGL 2 双后端如何实现同一合同

| 维度             | WebGPU 后端                                            | WebGL 2 后端                                         | 共享层看到的内容                     |
| ---------------- | ------------------------------------------------------ | ---------------------------------------------------- | ------------------------------------ |
| Device 创建      | 异步请求 Adapter/Device                                | 同步获取 WebGL2 Context                              | `RHIDevice` + `ready`                |
| 命令模型         | `GPUCommandEncoder` 延迟编码，`queue.submit()`         | RHI 命令调用时立即执行 GL API，帧尾 `gl.flush()`     | `beginFrame/endFrame/abortFrame`     |
| Pipeline/Binding | 原生 graphics/compute Pipeline、BindGroup/Layout       | Graphics Program；compute/storage 创建前 fail-closed | 显式 RHI pipeline/layout/binding     |
| Compute/Indirect | ComputePass、dispatch、clear、draw indirect 一跳映射   | 不模拟 compute/storage/indirect；native GL 前拒绝    | 同一 graph、command scope 与验证合同 |
| Vertex Input     | 原生 Pipeline Vertex State                             | 精确绑定包对应的 VAO Cache                           | `PreparedDraw` Vertex/Index Binding  |
| Render Target    | 原生 Texture View / RenderPass                         | Default/Offscreen FBO 与 DrawBuffer Cache            | Attachment Descriptor                |
| Surface          | `GPUCanvasContext.getCurrentTexture()`，浏览器隐式呈现 | 默认 Framebuffer 的帧级包装                          | `getCurrentTexture()` + `present()`  |
| Shader           | WGSL ShaderModule                                      | GLSL Shader/Program                                  | `RHIShaderArtifact` + Reflection     |
| 上传             | 可复用 Mapped Upload Page，编码 Copy                   | PBO/直接 GL 上传路径                                 | `RHIUploadBatch`                     |
| 提交完成         | `onSubmittedWorkDone()`                                | 同步命令模型下的 Submission 边界                     | `RHISubmission.done`                 |

WebGPU 后端基本把 RHI 对象映射到原生 WebGPU 对象，并显式保留一帧引用直到提交完成。WebGL
2 后端则在内部实现 graphics Pipeline、BindGroup、RenderPass 和 Surface 语义，用 State
Tracker、VAO、Framebuffer、Sampler 等缓存把状态机 API 适配为同一个显式合同。

两者的差异只存在于 [`backends/webgpu/`](../src/render/rhi/backends/webgpu) 和
[`backends/webgl2/`](../src/render/rhi/backends/webgl2)
内。生产工厂只从这两个 RHI 后端目录创建设备；旧 RHI wrapper 与 feature driver 已删除，仓库只有
`SharedRendererDriver` 这一条生产渲染路径。

## 5. 资源、缓存与恢复

### 5.1 热路径准备与缓存

`PreparedDraw` 是后端无关、分配稳定的 Draw Packet。它通过 Geometry、Material Variant、Render
State、Resource Binding、Target 和 Device Generation
revision 判断是否复用。执行时只顺序读取已准备好的 Pipeline、BindGroup、Buffer 和 Draw 参数。

共享层还维护 Buffer、Texture、Shader、Pipeline、BindGroup、Uniform Binding、RenderTarget 和 Shadow
Atlas 等缓存；compute/storage 路径另有 `StorageBufferResourceCache`、compute pipeline/sampler
cache、storage graphics/GPU-driven pipeline cache、只接纳 registry-stable 依赖的 scriptable
bind-group cache 和复用的 dispatch/draw state。后端再维护与原生 API 相关的 Vertex
Input、Framebuffer 和状态缓存；WebGPU 持久/瞬态 Texture 的默认全资源 native Texture
View 也按 Texture 复用，同时仍为每次 RHI `createView()` 返回独立逻辑对象。`frame` 生命周期的 Surface
Texture View 不跨帧复用，因为 `present()` 后对应 Canvas Texture 已失效。诊断计数器统一记录 Cache
Hit/Miss、Pipeline/BindGroup/Vertex Buffer Switch、Native State Call 和 Transient
Allocation，并分别公开 indirect draw、dispatch、精确 direct workgroup、buffer clear、compute
pipeline/bind-group switch；indirect dispatch 不从 CPU 猜测 workgroup 数。

### 5.2 提交感知的生命周期

`ResourceRegistry`
保存逻辑资源 Handle 和可重建 Recipe，不把原生 Handle 暴露给业务层。`SubmissionResourceTracker`
只在连续的已提交帧完成后回收零引用资源；失败的提交也会结束原生所有权，但错误仍通过公开 Promise 传播。device
loss 恢复成功且全部稳定 cache 已同步后，recovery
coordinator 会在 renderer 共用的 mesh、fullscreen 和 shadow submission
tracker 以及 compute/storage 使用跟踪全部到达 idle 边界后，确认并清除这次旧 generation 已经处理的 submission-fence 失败；tracker/collection 内部失败不会被清除，后续
`waitForIdle()` 也只观察恢复后的新 fence 失败。

这解决了典型的 GPU 异步生命周期问题：CPU 已经不再引用某资源，不代表 GPU 已经执行完使用它的命令。

### 5.3 Device/Context 丢失恢复

WebGL Context Lost 或 WebGPU Device Lost 后，`RHIRecoveryCoordinator`
会关闭资源访问闸门、创建同后端替代 Device、按 Recipe 重建资源、重新创建并配置 Surface，再同步 Texture/Buffer/Fullscreen/RenderTarget/StorageBuffer/compute/GPU-driven 等缓存。恢复前的 Device
Generation 会让旧对象确定性失效，避免误用陈旧原生资源。

`StorageBuffer` 的公共 identity 在恢复后保持不变，但内容语义由创建时策略决定：`cpu-shadow`
重建最近 CPU 快照，不声称保留之后的 GPU 写入；只在 GPU 上发生过变化的 `cpu-shadow`
资源会回到初始或最后一次 CPU 写入状态，而不是丢失前的设备端状态。`reinitialize`
重建设备 allocation 后保持未初始化，直到 graph 中的完整 writer 成功提交。读取、indirect 使用或依赖旧内容的 partial
read-write 会在此之前失败。

替代 Device 在接管 registry 前会重新验证 pipeline 静态 requirements 和创建时可见的公共能力下限；能力缩减会让恢复明确失败，而不是带着不兼容 runtime 继续执行。显式
`releaseGPUResources()` 会清除 pipeline persistent target 记录，后续帧再按同一 backend-neutral
recipe 重建。

相关代码：[`ResourceRegistry.ts`](../src/render/renderer/ResourceRegistry.ts)、[`SubmissionResourceTracker.ts`](../src/render/renderer/SubmissionResourceTracker.ts)、[`RHIRecoveryCoordinator.ts`](../src/render/renderer/RHIRecoveryCoordinator.ts)。

## 6. 当前渲染架构的优势

![Hilo3d 渲染架构优势](./assets/hilo3d-rendering-advantages.png)

### 6.1 一次实现，两端一致

场景遍历、灯光与阴影、Pass、材质、资源准备和 Draw
List 都只有一份实现。增加新 Pass 或优化排序策略时，默认同时作用于 WebGPU 与 WebGL
2，减少功能漂移和双份维护成本。WebGPU-only
compute 也复用这套前端、graph、事务和恢复机制；所谓“only”只限定执行后端，不建立第二套 renderer。

### 6.2 后端差异有清晰边界

RHI
Core 无原生 API 类型，Renderer 热路径也不根据后端逐 Draw 分支。具体后端只实现资源、命令、Surface 和原生缓存；问题更容易定位，模块也更容易单独测试。

### 6.3 图级正确性优先

RenderGraph 在 GPU 执行前统一检查依赖、资源初始化、Attachment 兼容性和能力约束，并裁掉无效 Pass。相比手工串联命令，这种设计更适合继续扩展 Shadow、Post
Process、多 RenderTarget 和 Readback 流程。

### 6.4 稳态低分配、低状态开销

FrameArena、高水位 Workspace、Pass
Storage、PreparedDraw 和多层 Cache 把创建对象、Descriptor 归一化、Shader/Pipeline/BindGroup/Vertex
Input 准备尽量移出 Draw 热路径。不透明物体聚类和 Instancing 进一步减少 Pipeline 与资源切换。

### 6.5 生命周期与异常路径完整

上传有事务回滚，资源释放受 Submission Fence 保护，Surface Texture 有显式失效边界，Device
Generation 阻止陈旧对象复用，Context/Device
Lost 有统一恢复协调。这些能力对长时间运行、动态资源和复杂后处理场景尤其重要。

### 6.6 为继续演进保留结构空间

RenderGraph 的声明/编译/执行分层、Capabilities 驱动的 RHI，以及 Shared
Renderer 的组合式 Pass，使未来加入新的图优化、调试可视化或更多可移植 GPU 能力时，不需要重新拆分 WebGPU/WebGL
2 两套上层渲染器。

## 7. 当前边界与使用注意

- RHI 已有互斥 render/compute pass、direct/indirect dispatch、clear 和 indirect
  draw 合同，但仍只有一个 frame command scope，不提供 async
  compute、多 queue、用户 barrier 或 native encoder escape hatch。
- `storage-buffer`、`storage-texture`、`compute-pass` 与 `indirect-draw` 是 WebGPU-only
  capability。显式或自动选择 WebGL 2 时不会模拟或静默跳过；pipeline
  requirements 会在创建阶段排除不兼容后端。
- graph compute texture 首发只表达完整 2D subresource；storage
  texture 是 transient、write-only、完整覆盖，没有 persistent storage texture、layer/mip
  view 或 sampled/write feedback。跨帧状态使用外部 renderer-owned `StorageBuffer`，每帧通过
  `importStorageBuffer()` 导入。
- 每个 Renderer 同时只处理一个 `StorageBuffer.read()`；并发 readback 会明确拒绝。`cpu-shadow`
  恢复 CPU 快照而不保留 GPU mutation；需要保留或重算 GPU-only 状态时选择合适策略并显式重建。
- `SceneRenderPass` 已能让普通 renderer list 在 group 3 读取 pass-global storage；命中 instancing
  batch 时会展开为 direct per-mesh draw。需要 storage
  instancing 的后续优化不能改变这个确定性正确性合同。
- 自定义 SRP 可以组合 depth prepass、compute tile/cluster culling 与 storage-aware Scene
  Pass 实现完整 Forward+。内置 Forward feature 的 `sampledDepth: true` 仍关闭，也不会自动生成 PBR
  storage shader variant。
- WebGPU-only effect 页面同时是可展示 example 与真实浏览器验收：depth prepass → sampled-depth tile
  cull → Scene group-3 storage、Gaussian cull/reorder/indirect draw，以及 1024 粒子 Hilo3D
  wordmark 的 fractal value/curl noise、呼吸、涡旋、回归、compact、GPU indirect additive
  glow。Forward+/Gaussian 算法仍是 acceptance-scale，整个页面也不是生产性能 baseline。
- 独立交互式粒子页面使用 65,536 个持久 storage body，其中 4096 个组成连续可读的 Hilo3D word
  lattice，61,440 个组成独立的分层星空、极光/星云与 cyber-dune deep field；std140
  pointer/time 控制块、三 octave value/curl
  noise、回归/轨道/鼠标力场、低频流星头部碰撞和尾迹力场与边界碰撞共用一次 compute。compute 同帧生成两组 draw
  arguments，deep field、velocity halo 和 luminous core 由 Render Graph 中三次 storage-aware
  indirect `GPUDrivenRenderPass` 完成，不走原生 WebGPU bypass 或粒子状态 readback。
- Direct WGSL `f16` 当前因 Naga validation 路径限制而 fail-closed；workgroup
  memory、barrier、atomic 与受验证的 scalar override 仍可直接使用。
- compute/storage buffer 的 `minBindingSize` 是显式 ABI
  promise；引擎会在开帧前校验调用方声明值与实际绑定 range，但当前不会从 WGSL/GLSL 类型布局反射更大的 exact
  minimum。错误低报仍可能由 native WebGPU validation 在 dispatch/draw 时拒绝。
- RenderGraph 每帧重新 Build/Compile，依靠高水位存储复用降低成本；当前没有跨帧复用完整的 Compiled
  Graph。
- 已有 Pass 裁剪、资源生命周期区间和跨帧瞬态资源池，但没有宣称同帧物理内存别名复用。
- WebGL
  2 的立即执行与 WebGPU 的延迟提交无法在原生层完全相同，RHI 保证的是上层可观察合同和错误边界一致。
- WebGPU Shader 路径依赖异步初始化 Naga Translator，因此显式 WebGPU 创建必须等待 `ready`。
- WebGPU 没有 `preserveDrawingBuffer`
  等价物；需要保留结果时应使用显式 RenderTarget、Copy 或 Readback Pass。

## 8. 核心代码索引

| 关注点                         | 入口                                                                                                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Stage 与后端策略               | [`Stage.ts`](../src/core/Stage.ts)                                                                                                                                       |
| 公共 Renderer 与一次性后端选择 | [`Renderer.ts`](../src/render/Renderer.ts)、[`RendererFactory.ts`](../src/render/internal/RendererFactory.ts)                                                            |
| Compute/storage 后端选择       | [`RenderPipelineBackendSelection.ts`](../src/render/internal/RenderPipelineBackendSelection.ts)                                                                          |
| 双后端共享渲染前端             | [`SharedRendererDriver.ts`](../src/render/internal/SharedRendererDriver.ts)                                                                                              |
| PipelineHost 与公共 SRP        | [`RenderPipelineHost.ts`](../src/render/internal/RenderPipelineHost.ts)、[`pipeline/`](../src/render/pipeline)                                                           |
| Compute/storage 公共配置       | [`compute/`](../src/render/compute)、[`StorageBuffer.ts`](../src/render/StorageBuffer.ts)、[`storage/`](../src/render/storage)                                           |
| Compute/GPU-driven 运行时      | [`ScriptableComputeDispatch.ts`](../src/render/renderer/ScriptableComputeDispatch.ts)、[`ScriptableGPUDrivenDraw.ts`](../src/render/renderer/ScriptableGPUDrivenDraw.ts) |
| 场景与可见队列                 | [`RenderGraphFramePlan.ts`](../src/render/RenderGraphFramePlan.ts)、[`RenderList.ts`](../src/render/RenderList.ts)                                                       |
| 帧事务                         | [`frame/`](../src/render/frame)                                                                                                                                          |
| RenderGraph                    | [`graph/`](../src/render/graph)                                                                                                                                          |
| Draw/Pass/资源准备             | [`renderer/`](../src/render/renderer)                                                                                                                                    |
| RHI Core                       | [`rhi/core/`](../src/render/rhi/core)                                                                                                                                    |
| RHI Factory                    | [`RHIFactory.ts`](../src/render/rhi/RHIFactory.ts)                                                                                                                       |
| WebGPU 后端                    | [`backends/webgpu/`](../src/render/rhi/backends/webgpu)                                                                                                                  |
| WebGL 2 后端                   | [`backends/webgl2/`](../src/render/rhi/backends/webgl2)                                                                                                                  |

## 9. 两张配图的生成规格

两张配图均通过 Codex 内置 `imagegen` 模式生成，并保存为项目内 PNG。

### 渲染流程图

```text
Use case: infographic-diagram
Asset type: Hilo3d architecture documentation diagram
Primary request: show the current Hilo3d rendering flow from Stage through Shared Renderer, RenderPipelineHost and RenderGraphFrame, then portable RHI, WebGPU/WebGL 2 and GPU/Canvas; include the WebGPU-only compute, storage and GPU-driven raster path without introducing a second renderer or graph
Composition/framing: 16:9 landscape, left-to-right main flow; peer raster, compute, copy/clear, GPU-driven raster and output Pass groups independently connected to one unified RAW/WAR/WAW dependency bus above; shared frame/resource lifecycle lane below
Style/medium: clean vector-like technical infographic, dark navy background, cyan and violet accents, crisp English technical labels
Constraints: accurately show Stage -> Shared Renderer -> RenderPipelineHost -> RenderGraphFrame -> Portable RHI -> WebGPU/WebGL 2; show "Default Forward / Direct Fast Path" and "Scriptable Pipeline / Scene · Compute · GPU-Driven" as two host paths converging into one RenderGraphFrame; associate "ComputeShader (Direct WGSL) -> ComputeKernel -> ComputeRenderPass" with the scriptable path; show RenderGraph inside RenderGraphFrame with Build, Compile, Prepare and Execute; show RenderPass / ComputePass in Portable RHI; show Graphics + Compute, Storage / Indirect and queue.submit() only in WebGPU; show WebGL 2 graphics plus "Compute / Storage / Indirect: fail-closed" rather than an emulation path; include Persistent Targets, StorageBuffer, Submission Fence and Recovery in the shared lifecycle lane; render the labels exactly as "RenderPipelineHost", "RenderGraphFrame", "RenderGraph" and "Portable RHI"; do not show a fixed raster -> compute -> copy order, a second graph, backend-specific SRP branches or any deprecated standalone frame label; no watermark
```

### 渲染优势图

```text
Use case: infographic-diagram
Asset type: Hilo3d architecture advantages infographic
Primary request: summarize six proven advantages of the current rendering architecture: shared dual-backend frontend, clear RHI boundary, validated RenderGraph, low-overhead hot path, submission-safe lifecycle and capability-driven portability
Composition/framing: 16:9 landscape, central Hilo3d architecture hub with six balanced benefit cards
Style/medium: clean vector-like engineering infographic, dark navy background, cyan/blue/violet accents, concise English technical labels
Constraints: use only the six supplied advantages; avoid unverifiable performance numbers; no watermark
```
