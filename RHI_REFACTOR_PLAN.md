# Hilo3d RHI 与 Render Graph 重构设计

> 状态：设计提案目标版本：Hilo3d
> 2.x 内部渐进迁移核心约束：可以重构现有渲染实现，但功能、画面和性能不得劣化

## 1. 结论

Hilo3d 将把当前“RHI 与两个生产 driver 并存”的结构，重构为真正的单一硬件抽象边界：

```text
Scene / Material / Mesh
          │
          ▼
Shared Renderer Frontend
裁剪、排序、灯光、阴影、PreparedDraw
          │
          ▼
Render Frame + Render Graph
Pass、依赖、临时资源、生命周期、调度
          │
          ▼
RHI
资源、PSO、绑定、CommandContext、Queue、Surface
          │
     ┌────┴────┐
     ▼         ▼
 WebGL2 RHI  WebGPU RHI
     │         │
     ▼         ▼
  WebGL2     WebGPU
```

RHI 参考 Unreal Engine
RHI 的分层思想，但不照搬 Unreal 的线程模型、显式 barrier、平台接口或 C++ 对象体系。接口以 WebGPU 的资源、pipeline、bind
group、command encoder、render
pass 和 queue 模型为基础，并为 WebGL2 提供无隐藏功能降级、无第二套状态缓存、可度量且不劣化的实现。

Render Graph 位于 RHI 之上。它声明 pass 和资源依赖，RHI 只负责创建资源和执行命令。Renderer、Render
Graph 和 RHI 不互相侵入职责。

本方案替换 `ENGINEERING_MODERNIZATION.md` 中以下旧约束：

- WebGL immediate path 只服务 portable wrapper，生产 renderer 仍绕过 RHI；
- 用 WebGPU command buffer 命名包装 WebGL immediate execution，却没有明确 execution-mode 契约；
- WebGL driver 直接执行 VAO draw；
- WebGPU driver 直接调用 `createNative*` 和 `submitNative`；
- 通用 RHI command path 只用于非生产路径。

RHI 保留 WebGL immediate execution 作为正式且明确的 backend 策略，不强制 WebGL 生成一份软件 command
buffer 再 replay。真正需要替换的是 native
bypass 和虚假的统一提交语义。性能保护改由更严格的基准、分配预算、缓存命中率和 A/B 对比完成。

## 2. 目标与非目标

### 2.1 目标

1. Renderer 到 WebGL2/WebGPU 的所有生产调用都经过 RHI。
2. 一份 renderer/pass 实现同时服务 WebGL2 和 WebGPU。
3. 两个后端具有一致的 pass 顺序、资源结果、错误边界和 frame 生命周期；具体执行可以是 WebGL
   immediate 或 WebGPU native deferred。
4. RHI 保持足够低层，不认识 Scene、Mesh、Material、Light、Shadow 或 RenderList。
5. 以 WebGPU 对象模型为主，不为了 WebGL2 把接口退化成 GL 风格状态机。
6. WebGL2 不模拟 compute、storage texture 等本身不支持的能力。
7. WebGL2 steady-state CPU、GPU 和内存性能不得比迁移前劣化。
8. WebGPU 保留当前直接映射 native API 的效率，但 native fast path 只能存在于 RHI backend 内部。
9. 引入 Render Frame 与 Render Graph，统一主 pass、阴影、render target、后处理和 present 的编排。
10. 所有迁移阶段都可与旧路径 A/B 对比并可单独回滚。

### 2.2 非目标

- 不支持 WebGL 1。
- 不在 WebGL2 上用 CPU 模拟 compute、storage buffer 或 storage texture。
- 不照搬 Unreal 的 RHI thread、并行 command list、多 GPU 或平台宏体系。
- 第一阶段不实现通用异步 compute、多 queue 调度和显式内存 alias。
- 不要求公开 RHI 成为 Hilo3d 用户 API；初期保持内部 API。
- 不允许用降低画质、减少 draw、关闭阴影或改变 shader 精度换取性能数字。

## 3. 架构硬约束

以下约束必须由架构测试检查，而不是依赖 code review 记忆。

### 3.1 唯一硬件边界

- `src/render/renderer/**`、`src/render/graph/**` 和公共 `src/render/**` 不得出现
  `WebGL2RenderingContext`、`GPUDevice`、`GPUBuffer`、`GPUTexture` 或其他 native 类型。
- 只有 `src/render/rhi/backends/webgl2/**` 可以调用 `gl.*`。
- 只有 `src/render/rhi/backends/webgpu/**` 可以调用 WebGPU native API。
- Renderer 不得导入 concrete backend 类，不得使用 `instanceof WebGPUDevice` 一类分支。
- native interop 必须通过显式 extension 获取，并且不得被内置 renderer feature 使用。

### 3.2 明确的执行语义

- Render Graph build/compile 必须无 GPU 副作用；只有 compile 成功后才进入 RHI execute。
- portable core 暴露 `RHICommandContext`，不承诺所有 backend 都生成可重排的软件 command buffer。
- WebGL2 context 可以在 execute 阶段立即调用 GL；WebGPU context 可以录制 native command buffer 并在
  `endFrame()` 提交。
- Renderer 和 pass 不得查询 execution mode，也不得依赖命令是立即还是延迟执行。
- 两个 backend 必须按编译后的 pass/draw 顺序产生相同资源结果。
- render pass `end()` 后不可继续 draw；frame `endFrame()` 后不可继续写入。
- frame 引用的 native 资源至少保留到该 frame submission 完成；WebGL submission 同步完成，WebGPU
  submission 可以异步完成。
- graph
  build、compile、资源预分配或 validation 失败时不进入 execute；execute 已开始后的硬件错误不承诺事务回滚，但必须终止 frame、恢复 RHI 可用状态并报告原始错误。

### 3.3 单一所有权

- 每个逻辑 RHI resource 只有一个 RHI owner device。
- native allocation、状态缓存、pipeline cache 和 sampler cache 只归 backend device 所有。
- Renderer 可以缓存 `PreparedDraw`，但不得缓存 native handle。
- persistent resource、frame resource 和 transient graph resource 必须是不同的生命周期类别。

### 3.4 能力而不是隐藏降级

- 通用 graphics 能力属于 core RHI。
- WebGPU-only 或设备可选能力通过 `features` 和 format capability 暴露。
- 不支持的能力在 graph compile、pipeline 创建或 pass validation 阶段失败。
- 禁止执行到 draw 中途才静默关闭功能或切换另一条低质量路径。

## 4. 目标目录

迁移完成后的建议结构：

```text
src/render/
├── Renderer.ts
├── RendererCore.ts
├── frame/
│   ├── RenderGraphFrame.ts
│   ├── RenderGraphFrameContext.ts
│   ├── RenderGraphFramePlanner.ts
│   └── FrameArena.ts
├── graph/
│   ├── RenderGraph.ts
│   ├── RenderGraphBuilder.ts
│   ├── RenderGraphCompiler.ts
│   ├── RenderGraphExecutor.ts
│   ├── RenderGraphResource.ts
│   └── RenderGraphValidation.ts
├── renderer/
│   ├── ForwardRenderer.ts
│   ├── PreparedDraw.ts
│   ├── MeshDrawProcessor.ts
│   ├── ResourceRegistry.ts
│   └── passes/
│       ├── ShadowPass.ts
│       ├── MainPass.ts
│       ├── TransparentPass.ts
│       ├── PostProcessPass.ts
│       └── PresentPass.ts
└── rhi/
    ├── core/
    │   ├── RHITypes.ts
    │   ├── RHICapabilities.ts
    │   ├── RHIResources.ts
    │   ├── RHIPipeline.ts
    │   ├── RHICommands.ts
    │   ├── RHIQueue.ts
    │   ├── RHISurface.ts
    │   └── RHIValidation.ts
    ├── backends/
    │   ├── webgl2/
    │   └── webgpu/
    └── RHIFactory.ts
```

迁移期间允许旧目录与新目录并存，但新代码不得反向依赖 `src/render/internal/webgl2` 或
`src/render/internal/webgpu`。

## 5. RHI 接口设计

### 5.1 设计原则

RHI 使用 WebGPU-shaped API，原因是它天然区分：

- resource descriptor 与 resource identity；
- pipeline state 与 draw command；
- bind group layout 与 resource binding；
- command context、frame scope 与 queue completion；
- device 与 surface；
- render pass attachment 与 load/store action。

但不会机械复制 WebGPU：

- 类型只保留 Hilo3d 确实需要且两个后端能清晰解释的部分；
- 不暴露 WebGPU native 对象；
- 不把 WebGPU 自动完成的状态转换伪造成一套显式 Vulkan barrier API；
- WebGL2 不支持的功能通过 capability gate，而不是空实现；
- shader 编译和材质 variant 不属于 RHI。

### 5.2 Device、Surface 与 Queue

Device 和 Surface 必须分离。一个 device 可以没有 surface，也可以在未来服务多个 surface。

```ts
export interface RHIDevice extends RHIDestroyable {
    readonly backend: RHIBackend;
    readonly capabilities: RHICapabilities;
    readonly generation: number;
    readonly lost: Promise<RHIDeviceLostInfo>;

    createBuffer(desc: RHIBufferDescriptor): RHIBuffer;
    createTexture(desc: RHITextureDescriptor): RHITexture;
    createSampler(desc: RHISamplerDescriptor): RHISampler;
    createShader(desc: RHIShaderDescriptor): RHIShader;
    createBindGroupLayout(desc: RHIBindGroupLayoutDescriptor): RHIBindGroupLayout;
    createPipelineLayout(desc: RHIPipelineLayoutDescriptor): RHIPipelineLayout;
    createBindGroup(desc: RHIBindGroupDescriptor): RHIBindGroup;
    createGraphicsPipeline(desc: RHIGraphicsPipelineDescriptor): RHIGraphicsPipeline;
    createSurface(canvas: HTMLCanvasElement): RHISurface;

    readonly graphicsQueue: RHIQueue;
}

export interface RHISurface extends RHIDestroyable {
    configure(config: RHISurfaceConfiguration): void;
    getCurrentTexture(): RHITexture;
    present(): void;
}
```

第一阶段只有 graphics queue。Copy 命令进入同一个 command encoder。未来增加 compute 时再扩展 queue
type，不预先暴露永远不可用的对象。

### 5.3 Resource

所有资源都具有稳定逻辑 identity、device generation 和显式销毁状态：

```ts
export interface RHIObject {
    readonly id: number;
    readonly deviceGeneration: number;
    label?: string;
}

export interface RHIDestroyable extends RHIObject {
    readonly destroyed: boolean;
    destroy(): void;
}
```

`destroy()` 的统一语义：

1. 立即禁止新 frame command 引用该资源；
2. 已开始执行或已经提交的 frame 继续持有 submission 引用；
3. native allocation 在最后一个 in-flight submission 完成后释放；
4. device loss 使旧 generation 的全部资源失效；
5. 可恢复的引擎资源由上层 `ResourceRegistry` 根据 descriptor/source 重建，不由 native
   wrapper 猜测如何恢复。

资源 descriptor 在创建时规范化并冻结。draw 阶段不得重复 clone、sort 或 stringify descriptor。

### 5.4 Shader

Shader source 预处理、GLSL 到 WGSL 转译、宏展开、variant 选择和 reflection 都在 RHI 之上完成。

```ts
export interface RHIShaderArtifact {
    readonly backend: RHIBackend;
    readonly stage: 'vertex' | 'fragment';
    readonly code: string | Uint32Array;
    readonly entryPoint: string;
    readonly reflection: RHIShaderReflection;
    readonly cacheKey: number;
}

export interface RHIShaderDescriptor {
    readonly artifact: RHIShaderArtifact;
    readonly label?: string;
}
```

Renderer 只请求一个逻辑 shader variant；shader compiler/cache 根据当前 RHI
backend 提供 artifact。RHI 不接受含糊的 `'glsl' | 'wgsl'` 组合，也不负责把错误语言转成当前后端语言。

### 5.5 Pipeline 和 Bind Group

Graphics pipeline descriptor 采用 WebGPU 模型：

```ts
export interface RHIGraphicsPipelineDescriptor {
    readonly layout: RHIPipelineLayout;
    readonly vertex: RHIVertexState;
    readonly fragment?: RHIFragmentState;
    readonly primitive: RHIPrimitiveState;
    readonly depthStencil?: RHIDepthStencilState;
    readonly multisample?: RHIMultisampleState;
    readonly label?: string;
}
```

映射关系：

| RHI 对象                | WebGPU               | WebGL2                                                  |
| ----------------------- | -------------------- | ------------------------------------------------------- |
| `RHIGraphicsPipeline`   | `GPURenderPipeline`  | Program、固定管线状态和 vertex-layout plan 的不可变组合 |
| `RHIBindGroupLayout`    | `GPUBindGroupLayout` | UBO binding、texture unit、sampler slot 的预编译布局    |
| `RHIBindGroup`          | `GPUBindGroup`       | 资源 identity、offset 和预解析 binding table            |
| `RHIVertexBufferLayout` | vertex buffer layout | VAO attribute plan                                      |
| `RHISampler`            | `GPUSampler`         | immutable sampler object 或规范化 sampler state         |

WebGL backend 可以在 pipeline/bind group 创建时做昂贵解析，draw
execute 时只能进行数字 identity 比较、状态差分和必要的 `gl.*` 调用。

### 5.6 Command Context 与 Render Pass

接口形状参考 WebGPU command encoder/render pass，但 portable core 使用 `CommandContext`
命名，明确它既可以是 immediate context，也可以封装 native deferred encoder：

```ts
export interface RHICommandContext {
    beginRenderPass(desc: RHIRenderPassDescriptor): RHIRenderPassEncoder;
    copyBufferToBuffer(...args: readonly unknown[]): void;
    copyBufferToTexture(...args: readonly unknown[]): void;
    copyTextureToBuffer(...args: readonly unknown[]): void;
    copyTextureToTexture(...args: readonly unknown[]): void;
}

export interface RHIRenderPassEncoder {
    setPipeline(pipeline: RHIGraphicsPipeline): void;
    setBindGroup(index: number, bindGroup: RHIBindGroup, dynamicOffsets?: RHIUInt32View): void;
    setVertexBuffer(slot: number, buffer: RHIBuffer, offset?: number, size?: number): void;
    setIndexBuffer(buffer: RHIBuffer, format: RHIIndexFormat, offset?: number, size?: number): void;
    setViewport(
        x: number,
        y: number,
        width: number,
        height: number,
        minDepth: number,
        maxDepth: number
    ): void;
    setScissorRect(x: number, y: number, width: number, height: number): void;
    setBlendConstant(color: RHIColor): void;
    setStencilReference(reference: number): void;
    draw(
        vertexCount: number,
        instanceCount?: number,
        firstVertex?: number,
        firstInstance?: number
    ): void;
    drawIndexed(
        indexCount: number,
        instanceCount?: number,
        firstIndex?: number,
        baseVertex?: number,
        firstInstance?: number
    ): void;
    end(): void;
}

export interface RHIQueue {
    beginFrame(desc?: RHIFrameDescriptor): RHICommandContext;
    endFrame(context: RHICommandContext): RHISubmission;
    onSubmittedWorkDone(submission?: RHISubmission): Promise<void>;
}
```

`beginFrame()` 到 `endFrame()` 是独占 command scope，不是跨 backend 的统一 GPU 执行边界：

- WebGL2：context 方法直接通过 canonical state cache 执行 GL，`endFrame()`
  收口状态、诊断和同步完成的 submission；
- WebGPU：context 内部持有 `GPUCommandEncoder`，`endFrame()` 执行 native `finish()` 和
  `queue.submit()`，返回异步 submission；
- 可选的软件 recorder 只用于 capture、调试或未来 worker 模式，不进入 WebGL2 默认生产热路径。

接口只承诺 capability 声明支持的参数。例如 WebGL2 不支持非零 `firstInstance` 和通用
`baseVertex`，validation 必须在 graph compile 或 execute 前置阶段拒绝。

### 5.7 Upload

资源 upload 不能继续分散在 renderer manager、native queue 和 GL
resource 中。第一阶段采用两条明确路径：

- 创建时初始数据：由 resource factory 接收 immutable snapshot；
- 运行时更新：进入 frame 的 `RHIUploadBatch`，在 draw command 前统一 flush。

`RHIUploadBatch` 使用可复用 staging arena，合并相邻 buffer range。WebGPU backend 使用
`queue.writeBuffer`、staging copy 或 `copyExternalImageToTexture`；WebGL backend 在 graph
execute 的 upload 段执行
`bufferSubData`、`texSubImage*`。两者必须定义一致的 upload-before-draw 顺序。

### 5.8 Capability

Capability 分三层：

1. device feature：例如 texture compression、timestamp query；
2. typed limits：buffer size、texture dimension、binding count、alignment；
3. per-format capability：sampled、filterable、renderable、blendable、storage、sample counts。

禁止使用 `0` 同时表达“不支持”“未知”和合法数值。可选能力使用显式 boolean/feature
set，不支持的 limit 使用 `undefined` 或不暴露对应 feature。

## 6. WebGL2 RHI：保证性能不劣化

WebGL2 是 RHI 的性能约束端。默认生产路径采用 immediate command context：Render
Graph 完成 build、validation、资源规划和 pass 排序后，executor 顺序调用 WebGL
RHI；RHI 通过单一 state cache 直接调用 `gl.*`。不再增加“先逐 draw 录制 JS command，再逐 draw
replay”的第二次遍历。

这与 WebGPU 的 native deferred encoder 执行策略不同，但 portable renderer 看到的是同一个
`RHICommandContext`，并且不依赖执行策略。RHI 的真实性来自唯一硬件边界和完整资源/命令覆盖，不来自强迫所有 API 具有完全相同的驱动调度方式。

### 6.1 Immediate fast path

WebGL command context 是 concrete backend
object。`beginRenderPass()`、`setPipeline()`、`setBindGroup()`
和 draw 直接进入预解析 backend 状态，不经过 Proxy、通用 command object 或 backend switch。

禁止：

- 为每个 draw 创建对象或闭包；
- `commands.push({ ... })`；
- 每个 draw 创建 array、Map、Set 或 typed array；
- draw 时执行 descriptor hash、sort、reflection 或 layout 推导；
- command context 中使用 `instanceof` 做 backend 分派；
- 为通用接口再套 Proxy 或 command facade。

Frame/graph 所需的 pass node、参数块和 draw list storage 按历史 high-water
mark 扩容，并在 frame 之间复用；扩容只能发生在容量不足时，不能稳定每帧发生。

### 6.2 预编译 backend 对象

WebGL backend 在非热路径预编译：

- pipeline → program、raster/depth/blend state packet；
- bind group layout → UBO/texture/sampler slot plan；
- bind group → resource index 和 dynamic offset plan；
- vertex layout + buffers → VAO；
- render pass descriptor → framebuffer/attachment plan。

execute 阶段只传递稳定 backend object/numeric identity，通过单一 canonical state cache 做差分。现有
`Program`、`VertexArrayObject`、`Framebuffer` 和 sampler manager 可以迁入 WebGL RHI
backend，但不能继续由 renderer 直接持有。

### 6.3 单一状态缓存

WebGL2 只能存在一个 active state tracker，覆盖：

- program；
- VAO；
- framebuffer；
- viewport/scissor；
- depth/stencil/blend/cull；
- UBO bindings；
- texture units 和 samplers；
- pixel pack/unpack state。

所有 RHI draw、upload、readback 和 native extension 操作都必须经过同一状态所有权协议。Native
extension 返回的 session 在结束时使相关 cache 失效或重新同步，不能形成第二套 active state。

### 6.4 Execute

WebGL 的执行路径如下：

```text
build + compile Render Graph（无 GPU 副作用）
        │
        ▼
queue.beginFrame → WebGL command context
        │
        ├── execute ordered uploads
        ├── execute compiled pass/draw list
        ├── state-diff + gl calls
        └── queue.endFrame → synchronous submission
```

所有可能失败的 shader/pipeline/resource prepare、graph validation 和 transient allocation 尽量在
`beginFrame()`
前完成。execute 内不重新构建 renderer 语义。WebGL 硬件调用不可事务回滚，因此 execute 中发生错误时只保证停止后续命令、恢复内部状态并报告错误，不承诺撤销已经执行的 GL 调用。

可选 capture/debug recorder 可以包装 `RHICommandContext`
记录命令，但默认关闭，不参与正式性能基线，也不能成为 renderer 与 WebGL backend 之间的必经层。

### 6.5 WebGL 特殊限制

- barrier：由 Render Graph 做依赖和反馈环验证，WebGL backend 不暴露虚假的 native barrier。
- compute/storage：capability 为 false，graph compile 时拒绝。
- first instance/base vertex：只有扩展或可靠模拟方案存在时才报告支持；默认拒绝非零值。
- cube、cube mip、MRT、MSAA resolve 和 readback：作为 graphics core
  contract 的必测能力，不允许 renderer 绕过 RHI。
- context loss：创建新的 backend generation，上层 registry 重放可恢复资源；旧 frame
  context 和旧 generation resource 一律失效。

## 7. WebGPU RHI：保留 native 效率

WebGPU backend 的 concrete encoder、render pass 和 queue 方法可直接映射 native
API，但只能在 backend 内部：

```text
RHICommandContext(WebGPU concrete class)
        └── GPUCommandEncoder
RHIRenderPassEncoder(WebGPU concrete class)
        └── GPURenderPassEncoder
RHIQueue(WebGPU concrete class)
        └── GPUQueue
```

性能规则：

- backend 在 device 初始化时选择一次，不在 draw 中判断 backend；
- RHI interface 的实际对象就是 concrete backend object，不增加 Proxy/forwarder；
- `beginFrame()` 创建 native encoder，`endFrame()` 在 backend 内完成 native finish/submit；
- pipeline、bind group 和 shader module 使用稳定 cache key；
- cache lookup 前不得每 draw 深拷贝 descriptor；
- `setPipeline`、`setBindGroup`、vertex/index buffer 使用 command-state 去重；
- shader 编译和 pipeline 创建移出首次 draw，进入 prepare/prewarm；
- render pass 内不创建临时 descriptor、数组或 typed array。

当前 `createNativeCommandEncoder()`、`submitNative()` 等能力可以转成 backend-private implementation
detail；删除 renderer 对这些方法的引用不等于增加第二层动态转发。

## 8. Render Frame

### 8.1 职责

`RenderGraphFrame` 是一次逻辑帧或一次显式离屏渲染事务，负责：

- 固定本帧 renderer、camera、viewport、fog、lights 和 frame index；
- 持有 frame arena、upload batch、render graph builder 和诊断计数；
- 统一一次或多次 stage/render-target pass；
- 正常完成时 compile、execute、end frame；
- build/compile 异常时不进入 RHI execute；execute 异常时终止 frame 并按统一错误契约处理；
- 提交后登记 in-flight resource 引用；
- 在 `finally` 中恢复 renderer 的 frame 状态。

### 8.2 消除全局 semantic

当前 material semantic 的模块全局 camera/light/fog/renderer 必须替换为不可变或 frame-scoped
context：

```ts
export interface RenderGraphFrameContext {
    readonly renderer: RendererCore;
    readonly rhi: RHIDevice;
    readonly frameIndex: number;
    readonly camera: Camera;
    readonly lightManager: LightManager;
    readonly fog: Fog | null;
    readonly viewport: Readonly<RHIViewport>;
}
```

uniform/parameter resolver 显式接收 context。跨 renderer 嵌套渲染不会覆盖外层状态。

### 8.3 生命周期

```text
beginFrame
   │
   ├── reset reusable frame arena
   ├── snapshot immutable frame context
   ├── update scene transforms
   ├── build visibility/render lists
   ├── prepare resources and uploads
   ├── build render graph
   ├── compile graph
   ├── execute compiled passes through RHI
   ├── end frame / obtain submission
   └── endFrame / abortFrame
```

`render()` 是单 stage 的便捷入口；`renderFrame(callback)` 可以在一个 frame
graph 中添加多个 target/pass；`renderToTarget()` 添加 graph
pass 而不是立即切换后端 framebuffer；`present()` 是 graph 的最终 pass 或显式 surface copy/pass。

恢复期间的行为必须统一：调用方要么收到明确的 `RendererRecoveringError`，要么得到一个带 `skipped`
状态的 frame result；不能出现 WebGPU 静默跳过 callback、WebGL 抛错、present 又表现不同的情况。

## 9. Render Graph

### 9.1 位置和职责

Render Graph 位于 shared renderer 与 RHI 之间：

```text
Renderer feature declares passes/resources
                │
                ▼
RenderGraphCompiler
validation → dependency → culling → lifetime → schedule
                │
                ▼
RenderGraphExecutor
allocate/import resources → call stable pass executors → execute RHI context
```

它负责：

- pass 的读写资源声明；
- attachment load/store/clear；
- pass 依赖和稳定拓扑顺序；
- 未使用 pass/resource 裁剪；
- transient resource 生命周期；
- read/write feedback 和非法组合验证；
- render target 切换和 resolve 编排；
- 诊断、命名和 frame capture；
- 后续可选的 pass merge、resource pooling 和 alias。

它不负责：

- 创建 shader variant；
- 决定 mesh 是否可见；
- 解释 Material；
- 调用 `gl.*` 或 WebGPU native API；
- 在 graph compile 阶段执行 draw。

### 9.2 Resource handle

```ts
declare const rgTextureHandleBrand: unique symbol;
declare const rgBufferHandleBrand: unique symbol;

type RGTextureHandle = number & { readonly [rgTextureHandleBrand]: true };
type RGBufferHandle = number & { readonly [rgBufferHandleBrand]: true };

interface RGTextureDesc {
    readonly size: RGExtent;
    readonly format: RHITextureFormat;
    readonly usage: RHITextureUsageFlags;
    readonly sampleCount: number;
    readonly mipLevelCount: number;
}
```

Graph resource 分为：

- imported：surface texture、persistent shadow map、用户 RenderTarget；
- transient：仅在当前 graph 内有效；
- extracted：执行后提升为 persistent resource，必须显式申请。

Handle 只在当前 frame generation 有效。pass executor 只能访问已经声明的资源。

### 9.3 Pass API

为了避免每帧创建闭包，内置 renderer 使用稳定 pass template：

```ts
interface RenderPassTemplate<P> {
    readonly name: string;
    setup(builder: RGPassBuilder, params: P): void;
    execute(context: RGPassContext, params: P): void;
}

graph.addPass(MainPassTemplate, frameArena.alloc<MainPassParams>());
```

用户扩展可以有更易用的 callback API，但核心 pass 必须使用：

- 稳定 executor function；
- frame arena 中的参数块；
- 数字 resource handle；
- 可复用 pass node storage。

### 9.4 编译阶段

第一版 compiler 按以下顺序工作：

1. 验证 resource descriptor 和 capability；
2. 建立 writer-reader 依赖；
3. 检测 cycle、未初始化读取和同 pass 非法 feedback；
4. 从 external output/present/readback 标记反向裁剪；
5. 生成稳定执行顺序；
6. 计算 transient resource first/last use；
7. 从 descriptor-keyed pool 获取物理资源；
8. 生成 render pass、resolve 和 upload 顺序；
9. 从 queue 获取本帧 `RHICommandContext`，执行 pass template；
10. `endFrame()` 并登记 submission。

第一版不做 aggressive pass reorder 和内存 alias，先保证行为和性能。资源池复用稳定后再引入 alias。

### 9.5 WebGPU 与 WebGL 映射

- WebGPU：graph usage 用于校验 texture/buffer usage、pass
  attachment 和 copy 顺序；WebGPU 自身完成 API 内部资源状态转换。
- WebGL2：graph
  usage 用于禁止纹理反馈环、安排 FBO、resolve、mipmap 和 readback；没有意义的 barrier 不产生 GL 调用。
- 两个后端执行同一个 pass 顺序和相同 draw list。

Unreal RDG 的可借鉴点是 setup/execute 分离、pass resource declaration、transient
lifetime 和 validation；不复制其 RHI thread、C++ lambda 分配方式和显式 pipeline barrier 模型。

## 10. Shared Renderer

### 10.1 PreparedDraw

每个可绘制对象在 revision 变化时生成或更新 `PreparedDraw`：

```ts
interface PreparedDraw {
    readonly pipeline: RHIGraphicsPipeline;
    readonly bindGroups: readonly RHIBindGroup[];
    readonly vertexBuffers: readonly RHIBufferBinding[];
    readonly indexBuffer: RHIIndexBufferBinding | null;
    readonly draw: RHIDrawArguments;
    readonly sortKeyHigh: number;
    readonly sortKeyLow: number;
}
```

实际实现应使用固定字段或 pooled array，不能因为接口示例中的 readonly array 每 draw 分配数组。

PreparedDraw 的 cache invalidation 由显式 revision 驱动：

- geometry revision；
- material/shader variant revision；
- render-state revision；
- resource binding revision；
- target format/sample count；
- device generation。

draw loop 只做顺序读取、少量 identity 比较和 RHI command 调用。

### 10.2 Pass 统一

以下功能从两个 driver 迁移到 shared passes：

- shadow planning 和 shadow pass；
- light collection 和 uniform packing；
- opaque/transparent/instanced draw；
- render target、MRT 和 resolve；
- fullscreen present；
- render info；
- before/after render event 语义。

Backend 只处理硬件映射。后端不得各自决定灯光上限、阴影 atlas 算法、事件参数或 face 统计方式。

## 11. 性能不劣化方案

“性能不劣化”必须通过旧/新路径同机 A/B 数据证明。仅检查源码中有没有 `.map()`，或者仅凭单个 demo
FPS，不构成证明。

### 11.1 双轨机制

迁移期保留内部开关：

```ts
type RendererArchitecture = 'legacy' | 'rhi';
```

该开关不公开发布，只用于测试、benchmark 和回滚。同一个 commit、同一浏览器、同一 adapter/context、同一场景分别运行两条路径。

旧路径只有在以下条件全部满足后才可删除：

- 功能和像素结果达到 parity；
- WebGL2 和 WebGPU 性能门禁通过；
- 稳态分配门禁通过；
- device/context loss 恢复测试通过；
- 连续运行和资源释放测试通过。

### 11.2 基准场景

至少建立以下固定 benchmark：

| 场景                         | 目的                                           |
| ---------------------------- | ---------------------------------------------- |
| 1 个静态 unlit draw          | 固定开销和空 graph 成本                        |
| 1,000 个共享 pipeline draw   | command 和状态去重                             |
| 10,000 个共享 pipeline draw  | WebGL RHI immediate context 与 JS 热路径       |
| 2,000 个高状态切换 draw      | pipeline、bind group 和 texture 切换           |
| 大批 instancing              | instance upload 和 drawIndexed                 |
| PBR、多灯光、阴影            | 真实 renderer CPU/GPU 负载                     |
| MRT + MSAA resolve + 后处理  | Render Graph、attachment 和 transient resource |
| 动态 geometry/texture upload | upload batch、staging 和资源更新               |
| 首次进入复杂场景             | shader/pipeline prepare 和 hitch               |
| 10,000 帧场景 churn          | cache 上界、资源释放和内存稳定性               |

每个场景固定 camera、分辨率、DPR、draw 数、shader
variant、纹理和灯光数量。禁止 benchmark 代码根据 backend 改变画质。

### 11.3 指标

每个 backend 至少采集：

- frame build CPU time；
- graph compile CPU time；
- RHI command issue/encode CPU time；
- RHI execute/end-frame CPU time；
- renderer 总 CPU p50、p95、p99；
- GPU frame time；
- steady-state JS allocation bytes/frame；
- heap high-water mark 和 10,000 帧后 retained heap；
- native buffer/texture/pipeline/bind-group/VAO/program 创建次数；
- RHI command 数、实际 draw 数、GL/WebGPU state call 数；
- pipeline、bind group、VAO 和 framebuffer cache hit rate；
- shader/pipeline 首次准备耗时。

### 11.4 门禁预算

在专用、固定版本的浏览器和机器上，以迁移前冻结 baseline 为准。门禁分两层：

1. 非劣化门禁：paired A/B 的正向回归在至少 7 轮中可重复，且 95% confidence
   interval 排除 0 时，直接判定失败；即使回归幅度小于下表 hard cap 也不能合并。
2. Hard cap：无论统计显著性如何，只要超过下表上限就直接失败，用于拦截高噪声环境中的明显退化。

| 指标                       | Hard cap                                                    |
| -------------------------- | ----------------------------------------------------------- |
| 稳态 renderer CPU p50      | 不高于 baseline 2%                                          |
| 稳态 renderer CPU p95      | 不高于 baseline 3%                                          |
| 10,000 draw WebGL2 CPU     | 不高于 baseline 3%                                          |
| WebGPU encode + submit CPU | 不高于 baseline 2%                                          |
| GPU frame time             | 不高于 baseline 2%，draw 和画质必须相同                     |
| steady-state 热路径分配    | 核心 draw/context 临时上限 16 KiB/帧；renderer 总量不得增加 |
| retained heap              | 不高于 baseline 5%，且随帧数保持有界                        |
| native object 创建         | 稳态不得增加；峰值不得无界增长                              |
| 首次复杂帧 p95             | 不高于 baseline 5%，后续通过 prewarm 继续降低               |

若浏览器噪声高于预算，必须增加样本和重复次数，不能放宽门禁。推荐每个 case：

- 300 帧 warm-up；
- 2,000 帧采样；
- legacy/RHI 顺序随机；
- 至少 7 轮独立重复；
- 报告 median、bootstrap confidence interval 和原始结果文件。

普通共享 CI 不适合做亚毫秒性能结论。PR
CI 运行功能、结构、计数和分配门禁；定时或专用 runner 运行 wall-clock/GPU
gate。删除旧路径前必须有专用 runner 的正式报告。

### 11.5 热路径禁止项

以下操作不得出现在稳定 draw/RHI-context execute 热路径：

- descriptor clone、sort 或 `JSON.stringify`；
- `.map()`、`.filter()`、`.slice()`、spread；
- 新建 Map、Set、Array、typed array、Matrix 或临时 command object；
- 字符串拼接 cache key；
- shader reflection、variant 编译或 pipeline 创建；
- backend `instanceof` 或字符串 backend switch；
- native handle wrapper 的重复创建；
- 每 draw 的资源所有权扫描。

允许在 resource revision 变化、cache miss、graph capacity 扩容和首次 pipeline
prepare 时执行昂贵工作，但必须计数并保持有界。

### 11.6 性能 instrumentation

新增内部 counters：

```ts
interface RHIFrameDiagnostics {
    commandCount: number;
    drawCount: number;
    pipelineSwitches: number;
    bindGroupSwitches: number;
    vertexBufferSwitches: number;
    nativeStateCalls: number;
    frameArenaGrowths: number;
    transientAllocations: number;
    cacheHits: number;
    cacheMisses: number;
}
```

诊断对象每 renderer 复用，不得因开启默认计数而产生每帧分配。详细 trace 只在显式 debug/profile 模式开启。

## 12. 测试策略

### 12.1 RHI conformance

同一套 contract 对 WebGL2 和 WebGPU 执行，至少覆盖：

- command context/pass 状态机；
- graph build/compile 不产生 GPU 副作用；
- compiled pass 和 draw 顺序在两个 backend 一致；
- WebGL synchronous submission 与 WebGPU asynchronous submission completion；
- copy、render、resolve 和 present 顺序；
- destroy/in-flight resource 生命周期；
- device generation 和 stale resource 拒绝；
- pipeline/bind group/layout 兼容；
- cube、mip、MRT、MSAA、depth/stencil 和 readback；
- capability/format gate；
- validation error 在执行前可观察。

现有只检查 submission counter 的测试必须升级为真实 framebuffer/buffer 结果断言。测试不得再声称 WebGL
`endFrame()` 是 GPU 执行边界；它检查的是 frame scope、结果、顺序和 completion 契约。

### 12.2 Architecture tests

现有 `RenderPerformanceArchitecture.test.ts` 中锁定 direct VAO、native encoder 和 native
submit 的断言需要替换为：

- renderer 只依赖 RHI core；
- native API 只能在对应 backend 目录；
- WebGL RHI immediate context 热路径无分配且不增加软件 replay；
- WebGPU concrete RHI 直接持有 native encoder，无 Proxy/二次 command recording；
- 两个旧 driver 不再承载 renderer feature；
- Render Graph 不依赖 backend；
- RHI 不依赖 Scene/Material/Mesh/Renderer。

### 12.3 Runtime 与视觉测试

- 所有现有 renderer/RHI unit test 保留或迁移；
- 现有 UI 双后端矩阵必须继续通过；
- 增加 legacy/RHI 同帧像素 readback 对比；
- 增加 WebGL2/WebGPU pass/draw ordering fixture；
- 增加多 pass graph、pass culling、transient reuse 和 abort fixture；
- 增加 context/device loss 期间 build、execute、recover fixture；
- 视觉回归容差不得因架构迁移而放宽；
- 真实 native WebGPU 门禁继续运行。

## 13. 分阶段迁移

### Phase 0：冻结基线

工作：

- 固定 benchmark 场景、浏览器版本、测试机器和采样脚本；
- 记录 legacy WebGL2/WebGPU 功能、像素、CPU、GPU、allocation 和内存数据；
- 给当前 native object 和 cache 增加统一计数；
- 标记 `ENGINEERING_MODERNIZATION.md` 中将被替换的 RHI 约束。

退出条件：baseline 可重复，波动范围已知，报告入库。

### Phase 1：RHI core 与 contract

工作：

- 在并行目录建立 RHI types、validation 和 factory；
- 分离 device/surface；
- 定义 resource generation 和 submission lifetime；
- 建立双 backend conformance test；
- 暂不接入生产 renderer。

退出条件：Fake WebGL/Fake WebGPU contract 完整通过，接口中无 Scene/Material 类型。

### Phase 2：最小双后端实现

工作：

- WebGL2 实现 concrete immediate command context 和单一 state cache；
- WebGPU 实现 concrete native encoder/queue 映射；
- 支持 buffer、texture、sampler、shader、pipeline、bind group、render pass、copy 和 surface；
- 做 unlit triangle、indexed textured mesh、offscreen target 和 present。

退出条件：相同 RHI pass/draw 代码在两个 backend 得到相同像素；renderer 不接触 native
handle；WebGL 不出现第二次软件 command 遍历；最小 benchmark 通过预算。

### Phase 3：Render Frame 与最小 Render Graph

工作：

- 引入 frame context、frame arena 和 upload batch；
- 移除全局 semantic；
- 建立 imported/transient resource、pass dependency、culling 和执行；
- 将单 camera、单 main pass 和 present 接入 graph。

退出条件：旧/新路径像素一致；空 graph 和单 draw 固定开销通过预算；build/compile 异常不进入 execute，execute 异常按统一契约终止。

### Phase 4：Geometry、Material 与 PreparedDraw

工作：

- 将 Program/VAO/WebGPU pipeline/bind-group manager 能力迁入对应 RHI 或 shared prepared cache；
- 建立 revision-driven PreparedDraw；
- 迁移 vertex/index/instance、UBO 和 texture binding；
- shader/pipeline prepare 移出 draw。

退出条件：opaque、transparent、instancing、skinning、morph 和 ShaderMaterial parity；1k/10k draw
benchmark 通过。

### Phase 5：Render Target、Shadow 与后处理

工作：

- 统一 render target、MRT、MSAA resolve、readback；
- 统一 shadow planning/atlas/pass；
- 加入 postprocess 和 present pass；
- backend driver 不再包含 renderer feature。

退出条件：现有 UI/视觉矩阵通过；真实 PBR/阴影/MRT benchmark 通过。

### Phase 6：资源生命周期与恢复

工作：

- 用 `ResourceRegistry` 替换分散 manager ownership；
- mesh detach/release 与 last-used-frame 回收；
- submission-aware deferred destroy；
- WebGL context loss 和 WebGPU device loss 使用统一 generation/rebuild 流程。

退出条件：10,000 帧 churn 内存有界；恢复前后对象 identity、画面和 target selection 符合契约。

### Phase 7：切换默认路径

工作：

- `rhi` 成为测试和开发默认；
- legacy 只保留 benchmark/回滚；
- 完成专用 runner 性能报告；
- 修复所有超预算 case。

退出条件：功能、视觉、性能、内存和恢复门禁连续通过。

### Phase 8：删除 legacy

工作：

- 删除 `WebGL2Driver`、`WebGPUDriver` 中已迁移的 feature 实现；
- 删除 renderer 对 native fast path 的访问；
- 删除把 WebGL immediate context 描述成 deferred command buffer 的旧语义和冲突测试；
- 合并/移动仍有价值的 backend implementation；
- 更新工程文档和 API report。

退出条件：仓库只剩一个 shared renderer 和两个 RHI backend；`npm run validate` 通过。

## 14. 回滚规则

每个 phase 都必须满足：

- feature 以完整纵向切片迁移，不允许一半资源走旧 manager、一半命令走新 RHI；
- legacy/RHI 不能在同一个 frame 同时修改同一 native context/device；
- 新路径失败可以在下一帧切回 legacy，但不能在半帧中途切换；
- 超过性能预算的 phase 不进入下一阶段；
- 为通过 benchmark 而引入 native bypass 视为架构失败；
- 不得为了表面统一给 WebGL 强制增加软件 command replay；需要 capture/调试时使用非默认 decorator。

## 15. 验收清单

- [ ] Renderer 和 Render Graph 不引用 WebGL/WebGPU native 类型。
- [ ] RHI 是唯一硬件调用边界。
- [ ] WebGL2 使用明确的 immediate command context，不伪装 deferred command buffer。
- [ ] 两个 backend 的 pass/draw 顺序、结果和 frame 生命周期一致。
- [ ] Device 与 Surface 解耦。
- [ ] Shader 编译/variant 位于 RHI 之上。
- [ ] WebGL pipeline/bind group/VAO 在非热路径预编译。
- [ ] WebGL RHI context 没有软件 command replay；TODO：将临时 16 KiB/帧 hot-path 预算收紧回零分配。
- [ ] WebGPU RHI concrete object 直接映射 native，无 Proxy 和重复 command list。
- [ ] Render Frame 使用显式 context，不再依赖全局 semantic。
- [ ] Render Graph 支持 imported/transient resource、依赖、裁剪、validation 和执行。
- [ ] 主 pass、阴影、render target、后处理和 present 使用 shared pass。
- [ ] 资源销毁考虑 in-flight submission 和 device generation。
- [ ] legacy/RHI 功能与像素 parity 通过。
- [ ] WebGL2 和 WebGPU 性能门禁通过。
- [ ] 10,000 帧资源 churn 后内存有界。
- [ ] context/device loss 恢复门禁通过。
- [ ] `npm run validate` 通过。

## 16. 参考

- Unreal Engine Graphics Programming
  Overview：<https://dev.epicgames.com/documentation/en-us/unreal-engine/graphics-programming-overview-for-unreal-engine>
- Unreal Engine Render Dependency
  Graph：<https://dev.epicgames.com/documentation/en-us/unreal-engine/render-dependency-graph-in-unreal-engine>
- WebGPU Specification：<https://www.w3.org/TR/webgpu/>

这些资料用于参考分层、资源与 command 模型。Hilo3d 的最终契约以 WebGL2/WebGPU 浏览器能力、TypeScript/JavaScript 热路径成本和本文件的性能门禁为准。
