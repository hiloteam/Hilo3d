# Hilo3d 当前渲染架构：Stage、RenderGraph、RHI 与双后端

> 本文基于当前仓库生产代码整理，描述已经落地的运行时链路，而不是重构规划中的目标状态。

## 结论先行

Hilo3d 当前采用的是“**一套共享渲染前端 + 一套后端无关的 RenderGraph + 一套 WebGPU 风格的可移植 RHI，以及 WebGPU/WebGL
2 两个具体后端**”架构。

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
- `Renderer.create()` 直接返回初始化完成的
  `SharedRendererDriver`，帧热路径中没有额外 Proxy 或逐调用后端分发。

相关代码：[`Stage.ts`](../src/core/Stage.ts)、[`Renderer.ts`](../src/render/Renderer.ts)、[`RendererFactory.ts`](../src/render/internal/RendererFactory.ts)。

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

### 1.3 RenderGraphFrame：一帧的事务边界

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

| 资源类型    | 含义                        | 典型用途                                                |
| ----------- | --------------------------- | ------------------------------------------------------- |
| `transient` | 图执行器创建和管理          | MSAA Color、临时 Depth、后处理临时纹理、Readback Buffer |
| `imported`  | 外部持久资源或延迟 Provider | Surface Texture、RenderTarget Attachment、缓存资源      |
| `extracted` | 执行后把所有权交给调用方    | 自动创建的 Readback/Staging 资源                        |

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
2. 根据普通读写、Color Attachment、Depth/Stencil Attachment 和显式依赖建立 RAW、WAR、WAW 顺序。
3. 拒绝未初始化读取、Discard 后读取、同 Pass 非可移植读写反馈、Attachment 尺寸/采样数不匹配和依赖环。
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
6. 按编译后的稳定顺序执行 Pass。
7. `graphicsQueue.endFrame()` 得到 `RHISubmission`。
8. 等提交完成后再把瞬态资源归还池、释放 Workspace；提交失败则丢弃相关资源。

当前实现已经具备生命周期分析和跨帧瞬态资源池，但池中资源会保持占用直到对应 Submission 完成；本文不把“根据
`firstUse / lastUse` 在同一帧内做物理内存别名”列为当前已实现能力。

相关代码：[`RenderGraphExecutor.ts`](../src/render/graph/RenderGraphExecutor.ts)、[`RenderGraph.ts`](../src/render/graph/RenderGraph.ts)。

## 3. RHI 设计

### 3.1 WebGPU 风格、可移植子集

RHI 的对象模型接近 WebGPU：`Device / Queue / CommandContext / RenderPass / Surface / Buffer / Texture / Sampler / Shader / BindGroup / Pipeline`。但它不是 WebGPU
API 的简单拷贝，而是 WebGPU 与 WebGL 2 都能可靠实现的可移植图形子集。

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

当前 RHI 暴露一个互斥 Graphics Frame Scope：

```text
queue.beginFrame()
    -> upload/copy/render pass commands
    -> queue.endFrame() -> RHISubmission

失败路径：queue.abortFrame()
```

`RHICommandContext` 允许后端立即执行或延迟编码，但上层无法观察或依赖这一差异。`RHISubmission.done`
是资源原生生命周期的围栏：逻辑 `destroy()` 可以立即生效，真正的原生释放必须等所有引用它的提交结束。

相关代码：[`RHICommands.ts`](../src/render/rhi/core/RHICommands.ts)、[`RHIQueue.ts`](../src/render/rhi/core/RHIQueue.ts)。

### 3.4 能力驱动与统一验证

每个 Device 创建一个不可变 `RHICapabilities`
快照，包括 Feature、Limit 和逐 Format 的 sampled/filterable/renderable/blendable/storage/sampleCounts 信息。

所有 Descriptor 和跨资源操作先经过共享验证层：

- 资源 Usage、尺寸、对齐和格式能力。
- BindGroup/Pipeline Layout 兼容性。
- Attachment、Copy、Mipmap 和 Map 约束。
- Device Ownership、Device Generation、Destroyed 状态。

因此，上层不会用“先调用后端，再从原生错误猜能力”的方式分支；同一非法输入在两套后端上尽量得到同一类
`RHIValidationError`。

相关代码：[`RHICapabilities.ts`](../src/render/rhi/core/RHICapabilities.ts)、[`RHIValidation.ts`](../src/render/rhi/core/RHIValidation.ts)、[`RHICopyValidation.ts`](../src/render/rhi/core/RHICopyValidation.ts)。

### 3.5 Shader 产物在 RHI 之上完成分流

引擎材质仍以 GLSL 为主要来源，但 `ShaderArtifactCompiler` 在进入 RHI 前生成后端专用 Artifact：

- WebGL 2：保留 GLSL，补齐 Uniform Block 与 Combined Sampler 的可移植 Binding 计划。
- WebGPU：通过 Naga 将 GLSL 转译为 WGSL，并生成同一套 Binding、Vertex Input、Fragment Output
  Reflection。

RHI 只接收已经带后端判别、代码、入口、Reflection 和 Cache Key 的 Shader
Artifact。这样 Shader 语言差异不会污染 RenderGraph 或 RHI 命令层。

相关代码：[`ShaderArtifactCompiler.ts`](../src/render/renderer/ShaderArtifactCompiler.ts)、[`GlslToWgsl.ts`](../src/render/shader/GlslToWgsl.ts)。

## 4. WebGPU / WebGL 2 双后端如何实现同一合同

| 维度             | WebGPU 后端                                            | WebGL 2 后端                                                 | 共享层看到的内容                      |
| ---------------- | ------------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------- |
| Device 创建      | 异步请求 Adapter/Device                                | 同步获取 WebGL2 Context                                      | `RHIDevice` + `ready`                 |
| 命令模型         | `GPUCommandEncoder` 延迟编码，`queue.submit()`         | RHI 命令调用时立即执行 GL API，帧尾 `gl.flush()`             | `beginFrame/endFrame/abortFrame`      |
| Pipeline/Binding | 原生 Pipeline、BindGroup、BindGroupLayout              | Program、Uniform Block、Texture/Sampler 和状态绑定的后端实现 | `RHIGraphicsPipeline`、`RHIBindGroup` |
| Vertex Input     | 原生 Pipeline Vertex State                             | 精确绑定包对应的 VAO Cache                                   | `PreparedDraw` Vertex/Index Binding   |
| Render Target    | 原生 Texture View / RenderPass                         | Default/Offscreen FBO 与 DrawBuffer Cache                    | Attachment Descriptor                 |
| Surface          | `GPUCanvasContext.getCurrentTexture()`，浏览器隐式呈现 | 默认 Framebuffer 的帧级包装                                  | `getCurrentTexture()` + `present()`   |
| Shader           | WGSL ShaderModule                                      | GLSL Shader/Program                                          | `RHIShaderArtifact` + Reflection      |
| 上传             | 可复用 Mapped Upload Page，编码 Copy                   | PBO/直接 GL 上传路径                                         | `RHIUploadBatch`                      |
| 提交完成         | `onSubmittedWorkDone()`                                | 同步命令模型下的 Submission 边界                             | `RHISubmission.done`                  |

WebGPU 后端基本把 RHI 对象映射到原生 WebGPU 对象，并显式保留一帧引用直到提交完成。WebGL
2 后端则在内部实现 Pipeline、BindGroup、RenderPass 和 Surface 语义，用 State
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
Atlas 等缓存。后端再维护与原生 API 相关的 Vertex
Input、Framebuffer 和状态缓存。诊断计数器统一记录 Cache Hit/Miss、Pipeline/BindGroup/Vertex Buffer
Switch、Native State Call 和 Transient Allocation。

### 5.2 提交感知的生命周期

`ResourceRegistry`
保存逻辑资源 Handle 和可重建 Recipe，不把原生 Handle 暴露给业务层。`SubmissionResourceTracker`
只在连续的已提交帧完成后回收零引用资源；失败的提交也会结束原生所有权，但错误仍通过公开 Promise 传播。

这解决了典型的 GPU 异步生命周期问题：CPU 已经不再引用某资源，不代表 GPU 已经执行完使用它的命令。

### 5.3 Device/Context 丢失恢复

WebGL Context Lost 或 WebGPU Device Lost 后，`RHIRecoveryCoordinator`
会关闭资源访问闸门、创建同后端替代 Device、按 Recipe 重建资源、重新创建并配置 Surface，再同步 Texture/Buffer/Fullscreen/RenderTarget 等缓存。恢复前的 Device
Generation 会让旧对象确定性失效，避免误用陈旧原生资源。

相关代码：[`ResourceRegistry.ts`](../src/render/renderer/ResourceRegistry.ts)、[`SubmissionResourceTracker.ts`](../src/render/renderer/SubmissionResourceTracker.ts)、[`RHIRecoveryCoordinator.ts`](../src/render/renderer/RHIRecoveryCoordinator.ts)。

## 6. 当前渲染架构的优势

![Hilo3d 渲染架构优势](./assets/hilo3d-rendering-advantages.png)

### 6.1 一次实现，两端一致

场景遍历、灯光与阴影、Pass、材质、资源准备和 Draw
List 都只有一份实现。增加新 Pass 或优化排序策略时，默认同时作用于 WebGPU 与 WebGL
2，减少功能漂移和双份维护成本。

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

- RHI 当前公开的是互斥 Graphics Frame
  Scope；虽然能力模型包含部分存储/计算相关 Feature 名称，但尚未提供 Compute
  Pipeline/Dispatch 命令合同。
- RenderGraph 每帧重新 Build/Compile，依靠高水位存储复用降低成本；当前没有跨帧复用完整的 Compiled
  Graph。
- 已有 Pass 裁剪、资源生命周期区间和跨帧瞬态资源池，但没有宣称同帧物理内存别名复用。
- WebGL
  2 的立即执行与 WebGPU 的延迟提交无法在原生层完全相同，RHI 保证的是上层可观察合同和错误边界一致。
- WebGPU Shader 路径依赖异步初始化 Naga Translator，因此显式 WebGPU 创建必须等待 `ready`。
- WebGPU 没有 `preserveDrawingBuffer`
  等价物；需要保留结果时应使用显式 RenderTarget、Copy 或 Readback Pass。

## 8. 核心代码索引

| 关注点                         | 入口                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Stage 与后端策略               | [`Stage.ts`](../src/core/Stage.ts)                                                                                 |
| 公共 Renderer 与一次性后端选择 | [`Renderer.ts`](../src/render/Renderer.ts)、[`RendererFactory.ts`](../src/render/internal/RendererFactory.ts)      |
| 双后端共享渲染前端             | [`SharedRendererDriver.ts`](../src/render/internal/SharedRendererDriver.ts)                                        |
| 场景与可见队列                 | [`RenderGraphFramePlan.ts`](../src/render/RenderGraphFramePlan.ts)、[`RenderList.ts`](../src/render/RenderList.ts) |
| 帧事务                         | [`frame/`](../src/render/frame)                                                                                    |
| RenderGraph                    | [`graph/`](../src/render/graph)                                                                                    |
| Draw/Pass/资源准备             | [`renderer/`](../src/render/renderer)                                                                              |
| RHI Core                       | [`rhi/core/`](../src/render/rhi/core)                                                                              |
| RHI Factory                    | [`RHIFactory.ts`](../src/render/rhi/RHIFactory.ts)                                                                 |
| WebGPU 后端                    | [`backends/webgpu/`](../src/render/rhi/backends/webgpu)                                                            |
| WebGL 2 后端                   | [`backends/webgl2/`](../src/render/rhi/backends/webgl2)                                                            |

## 9. 两张配图的生成规格

两张配图均通过 Codex 内置 `imagegen` 模式生成，并保存为项目内 PNG。

### 渲染流程图

```text
Use case: infographic-diagram
Asset type: Hilo3d architecture documentation diagram
Primary request: show the current Hilo3d rendering flow from Stage through the shared renderer and RenderGraphFrame, with RenderGraph build/compile/prepare/execute phases inside it, then RHI, split into WebGPU and WebGL 2 backends, and end at GPU/Canvas
Composition/framing: 16:9 landscape, left-to-right main flow, Pass lane above and resource-lifecycle lane below
Style/medium: clean vector-like technical infographic, dark navy background, cyan and violet accents, crisp English technical labels
Constraints: accurately show Stage -> Shared Renderer -> RenderGraphFrame -> RHI -> WebGPU/WebGL 2; show RenderGraph inside RenderGraphFrame; render the labels exactly as "RenderGraphFrame", "RenderGraph" and "RHI"; do not show any deprecated standalone frame label; no extra architecture layers; no watermark
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
