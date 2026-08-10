# Hilo3d Scriptable Render Pipeline（SRP）一次性改造设计与实施计划

> 状态：功能与公共 API 已实现；跨 commit 专用 SRP 性能基线仍是发布门禁  
> 目标版本：完成 async-only `Renderer.create()` / `Stage.create()`
> 基线后的首个架构版本；具体 semver 由发布评审决定  
> 制定日期：2026-07-16  
> 当前生产事实以 [`RENDERING_ARCHITECTURE.md`](./RENDERING_ARCHITECTURE.md)
> 和当前代码/测试为准；本文件中的“当前缺口”和 phase 描述保留为实施前问题及 review 轨迹。

## 1. 结论

Hilo3d 不需要重写 Renderer、Render
Graph 或 RHI 才能支持 SRP。当前共享渲染前端已经统一场景收集、PreparedDraw、阴影、后处理、Render
Graph、资源事务、提交生命周期以及 WebGL 2/WebGPU 双后端。SRP 改造应只在共享 Renderer 与 Render
Graph 之间增加一个**后端中立、逐帧同步、可脚本化的帧编排层**：

```text
Stage / Renderer.render() / Renderer.renderFrame()
                        │
                        ▼
              RenderPipelineHost
      frame transaction、事件、诊断、资源所有权
                        │
                        ▼
      ForwardRenderPipeline 或自定义 RenderPipeline
       culling、renderer list、feature、pass 编排
                        │
                        ▼
                RenderGraphFrame
       build → compile → prepare → execute → submit
                        │
                        ▼
             portable RHI（保持内部）
                  ┌─────┴─────┐
                  ▼           ▼
              WebGL 2       WebGPU
```

最终用户应同时获得两种能力：

1. 通过 `ForwardRenderPipelineFactory` 和稳定的 feature/pass 扩展默认前向管线，无需重写整条流程。
2. 通过自定义 `RenderPipelineFactory` 完整决定 culling、renderer
   list、阴影、离屏附件、场景 pass、fullscreen pass、copy 与最终输出顺序。

“一步到位”指**对外原子发布**，不是跳过工程阶段。实现可在未发布分支内按阶段完成，但在功能、像素、异常路径、资源恢复、API 和性能门禁全部通过前：

- 不公开预览类型或临时 deep-import 路径；
- 不让用户在两套 Renderer 或两套 feature stack 之间选择；
- 不长期保留旧编排和 SRP 编排两条生产路径；
- 不通过 native bypass、关闭功能或降低画质换取性能数字；
- 不修改现有 `Renderer.render()`、`renderToTarget()`、`renderFrame()` 的默认行为。

默认 `ForwardRenderPipeline`
的性能不劣化是合并条件，不是设计假设。只有专用基准证明默认路径没有统计显著回归，且硬门禁、分配、命令计数和原生对象计数全部通过，才允许切换生产入口。

### 1.1 当前落地摘要

- `RenderPipelineHost` 现在拥有唯一应用 `RenderGraphFrame`，默认命令与 SRP
  invocation 共用同一事务、回滚和 submission。
- `RendererCommonOptions.renderPipeline` 接受可复用 factory；factory
  requirements 会在异步后端选择前快照，feature/limit 参与选择，完整 capability/format 约束在设备选定后、runtime 创建前验证。
- 无 feature 的内置 forward
  runtime 由 host 识别并直接调用原生产 recorder，不创建公共 context、中间 scene color 或额外 present
  pass。
- 自定义 runtime 获得同步、frame-scoped 的 culling、renderer list、shadow、graph
  texture、RenderTarget import、persistent target、fullscreen、copy 和 output 原语。
- `ForwardRenderPipelineFeature` 是可复用配置；其 `create()`
  为每个 Renderer 产生独立 runtime，并把静态资源/能力 requirements 汇总到 pipeline factory。
- scriptable fullscreen 的 JS descriptor/entry storage 按高水位复用；绑定 graph-transient
  view 的 native bind group 仍采用 submission-fenced frame
  lifetime，每个存活 pass/frame 重新创建，不冒充跨帧 cache hit。
- WebGPU-only `storage-buffer`、`storage-texture`、`compute-pass` 与 `indirect-draw` 已在同一 SRP
  facade 上公开；requirements 在后端选择前排除 WebGL 2，runtime 仍使用同一 graph、事务和恢复链路。

### 1.2 2026-07-16 验证证据

- 完整 `npm run validate` 通过：coverage 147 个文件 / 1438 个测试、RHI portable 179 个测试、native
  contract 2 个测试、RHI benchmark contract 74 个测试。
- 浏览器门禁通过：完整示例/交互/parity 矩阵 189 个测试、WebGPU/Naga/双后端 SRP 文件 7 个测试、视觉与 WebGL
  2/WebGPU 首帧一致性 3 个测试。
- `test:render:architecture` 110 个测试通过，其中结构门禁确认默认 direct
  dispatch 在公共 facade 创建前返回，`SharedDrawPass.execute()` 不包含分配型集合操作或对象构造。
- build、类型消费、TypeDoc、API report、publint、ESM-only package 检查和 `npm pack --dry-run`
  均通过。
- 尚未生成跨 commit、同机交错运行的专用 SRP timing/allocation
  baseline。因此当前证据可以证明功能、结构、命令路径和双后端正确性，但不替代第 10 章定义的 CPU/GPU 统计门禁与实测
  `0 bytes/frame` 结论；该项继续作为发布签字条件。

## 2. 核心决策

| 问题                         | 决策                                                                                                             |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| SRP 位于哪里                 | 共享 Renderer 与 `RenderGraphFrame` 之间，只负责编排后端中立工作                                                 |
| 默认渲染器是否变化           | 仍只有一个公开 `Renderer`，默认创建内置 `ForwardRenderPipeline`                                                  |
| 如何选择自定义管线           | Renderer 创建时传入可复用的 `RenderPipelineFactory`；每个 Renderer 获得独立 runtime                              |
| 是否恢复 Renderer 子类       | 否；使用组合，不恢复公开抽象 Renderer 或 backend-specific driver                                                 |
| 是否公开 RHI                 | 否；公开 SRP facade、图资源 handle 和受限命令，不公开 `RHIDevice`、native handle 或 backend command context      |
| 是否公开内部 Render Graph    | 不直接公开；公开窄化且稳定的 `ScriptableRenderGraph` facade，内部仍可演进                                        |
| 自定义 shader 来源           | portable raster 保持 GLSL ES 3.00；Direct WGSL 只用于 ComputeShader，GLSL ES 3.10 只用于 readonly storage raster |
| 异步边界                     | factory 可在 `Renderer.create()` 中异步创建 runtime；record、setup、prepare、execute 必须同步                    |
| 默认路径如何保性能           | 管线选择只发生一次；默认路径无 feature 时直接调用现有 retained pass/cache，不增加逐 draw 分支、对象或二次命令流  |
| pipeline-owned GPU 资源      | 由 Renderer 的 recipe registry 管理，submission-aware，并参与 device/context loss 恢复                           |
| 多 Renderer 是否共享 runtime | 否；factory 可以共享，runtime、参数池、资源和诊断必须 renderer-local                                             |
| 对外发布方式                 | 所有 API、默认管线迁移、文档、示例、API report、双后端测试与性能报告同一版本原子发布                             |

## 3. 实施前基础与缺口

### 3.1 实施前已具备的基础

当前代码已经提供 SRP 所需的大部分底层能力：

- `SharedRendererDriver` 是 WebGL 2 与 WebGPU 唯一共享前端。
- `RenderGraphFrame` 已实现 build、compile、upload
  validation、prepare、execute、submit、commit 和 rollback。
- Render Graph 已有 imported/transient resource、依赖、稳定拓扑排序、pass culling、descriptor
  validation、生命周期分析和 submission-aware transient pool。
- `RenderPassTemplate<P>` 已有稳定 `setup / prepare / execute` 三阶段。
- `ForwardRenderer`、`OffscreenRenderTargetRenderer`、`ShadowAtlasRenderer`、`PostProcessRenderer`
  已能向调用方持有的同一个 graph 添加 pass。
- `PreparedDraw`、Pipeline、BindGroup、Vertex Input、Framebuffer 和资源 revision
  cache 已把昂贵准备移出 draw 热段。
- `Renderer.renderFrame()` 已能把多相机、多个 RenderTarget 和 present 组合进同一应用帧事务。
- RHI 已统一 WebGL 2 immediate execution 与 WebGPU deferred encoding 的可观察合同。
- device/context loss、资源 recipe、generation invalidation 和 submission-aware destroy 已经统一。

### 3.2 已解决的实施前缺口

| 缺口         | 当前表现                                                    | SRP 目标                                                                          |
| ------------ | ----------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 管线选择     | `SharedRendererDriver` 私有方法硬编码默认 forward 顺序      | 构造时选择一个 `RenderPipelineFactory`，默认 factory 复刻当前顺序                 |
| Culling 输出 | `RenderGraphFramePlan` 和 `RenderList` 由 Renderer 私有持有 | 提供 frame-scoped `CullingResultsHandle` 与 `RendererListHandle`                  |
| Pass 注入    | 应用只能调用 `render/renderToTarget/present`                | pipeline/feature 可声明场景、fullscreen、copy 和自定义高层 pass                   |
| 图资源       | 内部模块可创建/import graph resource，根 API 不可用         | 公开窄化的纹理 handle、相对 extent、target import 和 persistent resource registry |
| 扩展生命周期 | `getExtension('rhi')` 只适合显式互操作                      | SRP 资源自动接入 resize、submission、release 和恢复，不要求 native 访问           |
| 参数复用     | 内置 pass 自己维护高水位 storage                            | 提供公共 `RenderPassParameterPool<P>`，稳态不分配                                 |
| 默认管线配置 | 无稳定 feature 注入点                                       | 提供固定顺序的 `ForwardRenderPipelineFeature` 注入点                              |
| 公共契约     | 没有 pipeline factory/runtime/context 类型                  | 根 barrel、TypeDoc、API report、类型消费测试一次性补齐                            |

## 4. 目标与非目标

### 4.1 目标

1. 允许应用完整替换一帧中 scene
   pass 的编排，同时继续复用 Hilo3d 的 culling、材质、PreparedDraw、资源缓存和双后端。
2. 提供默认 `ForwardRenderPipeline`，其无 feature 行为与当前生产路径逐项一致。
3. 支持多个 camera/scene/target 请求在一个 `Renderer.renderFrame()` 中进入同一个 Render
   Graph 和 submission。
4. 支持可复用的 culling result、opaque/transparent/shadow renderer list 和 override material。
5. 支持 transient texture、public RenderTarget import、surface output、pipeline-owned persistent
   texture/target 和跨 pass 依赖。
6. 支持场景 raster pass、shadow pass、fullscreen material pass、texture
   copy、present，以及由这些原语组合的 deferred、SSAO、bloom、outline、reflection 和自定义后处理。
7. 保持 `setup / prepare / execute` 分离；graph compile 前无 GPU 副作用。
8. 保持资源 revision 只在有效 submission 后提交，失败帧回滚 frame-local 状态。
9. pipeline 和 feature 不感知 `webgl2`/`webgpu` 执行方式，只依据后端中立 capability 和 format
   contract。
10. 默认路径不增加逐 draw 虚调用、backend 分支、descriptor walk、软件 command replay 或稳态分配。
11. pipeline-owned persistent 资源参与 context/device
    loss 恢复，公共 identity 与 owner 不因恢复变化。
12. 所有新增公共类型具备 TSDoc、类型测试、API report、CHANGELOG、示例和双后端浏览器证据。

### 4.2 非目标

- 不恢复 WebGL 1、GLSL 1.00、classic numeric uniform 或手写 WGSL。
- 不公开 WebGL/WebGPU native 对象，也不把 `renderer.getExtension('rhi')` 变成常规 SRP 路径。
- 不把完整 RHI 作为公共 GPU 编程 API；SRP 面向当前引擎可移植 graphics 能力。
- 不在第一版加入 compute pipeline、storage resource、async
  compute、多 queue、显式 barrier 或同帧物理内存 alias。
- 不支持在活跃 frame 中热切换 pipeline；需要另一条 pipeline 时创建新的 Renderer。
- 不提供每 mesh 的 JavaScript predicate、callback draw 或反射式字符串命令列表。
- 不允许 pipeline 绕过 Render Graph 直接 begin/end RHI frame、获取 surface texture 或提交 queue。
- 不保证用户自定义算法本身与默认管线同速；保证的是默认管线无回归，以及 SRP
  framework 在稳态不制造隐藏的逐 draw 成本。
- 不把 WebXR 的现有 WebGL 2-only 平台边界伪装成 WebGPU SRP 支持。

## 5. 目标架构与职责

### 5.1 RenderPipelineHost

`RenderPipelineHost` 是 Renderer 内部唯一的 SRP 组合根，负责：

- 创建并持有 renderer-local pipeline runtime；
- 开始和结束唯一的 `RenderGraphFrame` 事务；
- 复用 invocation context、culling slot、renderer-list slot、pass 参数和诊断 storage；
- 持有 Mesh/Fullscreen draw processor、shadow、target bridge、resource registry 和 recovery
  coordinator；
- 在 pipeline record 前建立当前 scene/camera/output/viewport 语义；
- 统一 before/after render 事件、face/draw/pass 统计、surface acquire/present 和失败清理；
- 在有效 submission 后提交 resource use、revision 和 pending after-event；
- 在 pipeline/runtime 销毁时按 owner 释放 persistent recipe 和缓存。

它不决定 pass 顺序，不根据 backend 分支，也不允许 pipeline 接触原生对象。

### 5.2 RenderPipeline runtime

一个 Renderer 对应一个 runtime。runtime 只持有：

- 不可变配置；
- feature/pass 稳定实例；
- 参数池、高水位 slot 和少量 CPU 状态；
- pipeline-owned persistent resource 的稳定 owner key；
- engine `Material`、`Shader`、`UniformBuffer` 等后端中立对象。

runtime 不持有 RHI resource、native handle、surface texture、`PreparedDraw` 或跨帧 graph
handle。具体 GPU 对象始终归 Renderer cache/registry 和 RHI device 所有。

### 5.3 ScriptableRenderGraph facade

公开 facade 只表达 SRP 需要的图能力：

- transient texture 与显式 mip/layer/aspect/dimension view；
- 当前 output 与公共 RenderTarget attachment import；
- pipeline-owned persistent target import；
- renderer-owned 双/三缓冲 history texture；
- sampled/storage read-write declaration、color/depth attachment、copy
  source/destination 和显式依赖；
- stable pass template；
- terminal output/side effect 标记。

facade 内部直接写入现有 `RenderGraphBuilder`
storage，不建立第二份 graph，不在 compile 前创建 GPU 资源，也不复制 compiled graph。

### 5.4 RHI 与 backend

RHI 和两个 backend 不因 SRP 增加新职责。它们继续只处理资源、pipeline、binding、command、surface、validation 和 submission。任何 SRP
feature 需要的可移植能力都必须先成为正式的共享 renderer/RHI contract；禁止 feature 私自调用 native
API。

## 6. 架构硬约束

以下约束必须进入 architecture test，而不是仅写在 code review 说明中。

### 6.1 单一生产路径

- `Renderer.render()`、`renderToTarget()` 和 `renderFrame()` 最终都进入同一个 `RenderPipelineHost`。
- 默认和自定义 pipeline 共享同一套 culling、draw
  preparation、shadow、target、fullscreen、resource 和 recovery service。
- backend 目录不得出现 `RenderPipeline`、scene culling 或 feature 实现。
- 不允许保留 `renderSceneToSurfaceLegacy()` 一类发布时可选的第二 feature stack。

### 6.2 帧事务

- pipeline `record()` 和 pass `setup()` 只能声明 CPU 状态、资源和依赖。
- graph 依赖、descriptor、capability、attachment 和 upload 必须在 `graphicsQueue.beginFrame()`
  前全部验证。
- `prepare()` 可以创建/查询可复用 pipeline、binding、framebuffer 和 draw packet，但不能发命令。
- `execute()` 是唯一命令阶段；Promise-like 返回、递归 render 或 frame mutation 立即 poison 整帧。
- 只有有效 `RHISubmission` 才能提交 revision、resource-use 和 after-render 事件。
- WebGL 2 execute 已发出的 immediate 命令不能伪造回滚，但 frame-local
  CPU 状态仍不得 commit，下一帧必须可确定恢复。

### 6.3 后端中立

- `src/render/pipeline/**` 和公开 SRP 类型不得出现 `GPU*`、`WebGL*` 或 concrete backend import。
- pipeline context 暴露 capability/format，不暴露 backend execution mode。
- 默认 pipeline、内置 feature 和 package 示例不得根据 `renderer.backend`
  改变画质、pass 或 shader 语义。
- 显式不支持的 capability 在 record/compile/prepare 阶段报错，不静默跳过 pass。

### 6.4 所有权与恢复

- factory 可供多个 Renderer 复用，runtime 不可共享。
- graph handle 只在当前 frame generation 有效；跨 callback 或跨 frame 使用必须确定性失败。
- pipeline persistent resource 按 runtime owner 注册 backend-neutral recipe，由 Renderer
  registry 重建。
- pipeline destroy、Renderer `releaseGPUResources()`、device/context loss 和 Renderer
  destroy 都必须覆盖 pipeline resource。
- submission 在途时逻辑 destroy 立即生效，native release 等 fence 完成。

### 6.5 Shader ABI

- 自定义 scene/fullscreen pass 使用 `ShaderMaterial`/`Shader` 的 GLSL ES 3.00 源码。
- non-sampler 数据继续进入注册过的 std140 block；graph texture 只绑定 sampler slot。
- WebGPU 路径仍执行引擎预处理 → Vulkan GLSL 4.50 → Naga WASM → WGSL。
- pipeline/feature 不能提交手写 WGSL 或 backend-specific shader tree。

### 6.6 热路径

- pipeline 选择和 feature 静态需求聚合只在 runtime 创建时发生。
- 默认无 feature 路径不得增加逐 mesh、逐 draw、逐 binding 的虚调用或类型判断。
- pass/参数/attachment/renderer-list storage 使用高水位复用；扩容只允许发生在容量首次不足时。
- 默认 draw execute 不经过公共 facade wrapper；facade 在 build 阶段直接生成现有 internal pass 参数。
- generation/作用域检查发生在 pipeline API 调用或 pass 边界，不进入 `PreparedDraw` 迭代。
- 禁止在稳态 record/prepare/execute 中按 Draw 使用 descriptor
  clone、spread、`.map()`、`.filter()`、闭包、字符串 cache key 或临时 typed
  array；为不可复活 facade 创建的 callback-scoped lease
  shell/accessor 是显式、可计量的 pass 级成本。

## 7. 公共 API 设计

本节给出目标签名。实施时允许做不改变所有权、同步边界和性能模型的等价命名调整；任何边界改变必须先更新本设计并单独审查。

### 7.1 Factory 与 runtime

```ts
export interface RenderPipelineCreateContext {
    readonly capabilities: RenderPipelineCapabilities;
}

export type RenderPipelineTextureUse =
    | 'sampled'
    | 'filterable-sampled'
    | 'color-attachment'
    | 'depth-stencil-attachment'
    | 'copy-source'
    | 'copy-destination';

export interface RenderPipelineLimits {
    readonly maxTextureDimension2D: number;
    readonly maxColorAttachments: number;
    readonly maxSampledTexturesPerShaderStage: number;
}

export interface RenderPipelineCapabilities {
    readonly limits: Readonly<RenderPipelineLimits>;
    supportsTextureFormat(
        format: RenderTargetColorFormat | RenderTargetDepthStencilFormat,
        use: RenderPipelineTextureUse,
        sampleCount?: RenderTargetSampleCount
    ): boolean;
}

export interface RenderPipelineTextureRequirement {
    readonly format: RenderTargetColorFormat | RenderTargetDepthStencilFormat;
    readonly use: RenderPipelineTextureUse;
    readonly sampleCount?: RenderTargetSampleCount;
}

export interface RenderPipelineRequirements {
    readonly requiredFeatures?: readonly RendererFeatureName[];
    readonly requiredCapabilities?: readonly RenderPipelineCapabilityName[];
    readonly requiredLimits?: Readonly<Record<string, number>>;
    readonly requiredTextureFormats?: readonly Readonly<RenderPipelineTextureRequirement>[];
}

export interface RenderPipelineFactory {
    readonly name: string;
    readonly requirements?: Readonly<RenderPipelineRequirements>;
    create(context: RenderPipelineCreateContext): RenderPipeline | Promise<RenderPipeline>;
}

export interface RenderPipeline {
    readonly name: string;
    record(context: RenderPipelineContext): unknown;
    destroy(): void;
}

export interface RendererCommonOptions {
    // Existing fields omitted.
    renderPipeline?: RenderPipelineFactory;
}
```

合同：

- `renderPipeline` 省略时使用内置、进程级稳定的 `ForwardRenderPipelineFactory`。
- factory requirements 在 backend 探测前快照并规范化：feature/capability/texture
  requirement 稳定去重，同名 limit 取更严格值；调用方不能削弱 pipeline 的要求。
- `requiredFeatures` 与 `requiredLimits` 参与 `auto` 的 WebGPU adapter 探测；完整 capability/format
  requirements 在设备选定后、runtime 创建前验证。默认 factory 不增加当前 Renderer
  baseline 之外的要求。
- factory 在 RHI、shader compiler 和共享 renderer service
  ready 后调用一次，可同步返回 runtime，也可返回 Promise；`Renderer.create()`
  必须等待它完成后才 resolve。
- factory reject/throw 时，`Renderer.create()`
  保留原始 cause、确定性销毁已经创建的 surface/device/service 并 reject；backend 一旦选定，不因 factory 初始化失败回退。
- factory 不获得 Renderer、resource registry、RHI device 或 surface，只获得不可变 capability。
- runtime 必须由 factory 新建；同一 runtime 绑定第二个 Renderer 时直接失败。
- `destroy()` 恰好调用一次；即使用户实现抛错，Renderer 仍完成其自身资源清理并报告聚合错误。

默认与 feature 用法：

```ts
const renderer = await Renderer.create({
    backend: 'auto',
    domElement: canvas,
    renderPipeline: new ForwardRenderPipelineFactory({
        features: [new BloomRenderFeature(bloomOptions)]
    })
});
```

完整替换用法：

```ts
class DeferredPipelineFactory implements RenderPipelineFactory {
    readonly name = 'deferred';

    create(context: RenderPipelineCreateContext): RenderPipeline {
        return new DeferredPipeline(context);
    }
}

const renderer = await Renderer.create({
    backend: 'auto',
    renderPipeline: new DeferredPipelineFactory()
});
```

### 7.2 RenderPipelineContext

`RenderPipelineCapabilities` 是 Renderer 初始化时冻结的后端中立有效能力快照。它至少提供 color/depth
format 与 sample-count 查询、最大 color attachment 数量以及 SRP 可使用的 portable
limits；不提供 backend 名称、native extension 或原生 limit 对象。device/context
recovery 必须重新满足该快照以及所有已注册 resource
recipe，不能在恢复后悄悄缩减能力或重新创建 pipeline runtime。

```ts
export interface RenderPipelineContext {
    readonly frameIndex: number;
    readonly scene: RendererScene;
    readonly camera: Camera;
    readonly viewport: RendererViewport;
    readonly output: RenderPipelineOutput;
    readonly capabilities: RenderPipelineCapabilities;
    readonly graph: ScriptableRenderGraph;

    cull(options?: Readonly<CullingOptions>): CullingResultsHandle;
    createRendererList(descriptor: Readonly<RendererListDescriptor>): RendererListHandle;
    acquirePassParameters<P extends object>(pool: RenderPassParameterPool<P>): P;
}

export interface RenderPipelineOutput {
    readonly kind: 'surface' | 'render-target';
    readonly width: number;
    readonly height: number;
    readonly sampleCount: RenderTargetSampleCount;
    readonly colorAttachmentCount: number;
    readonly depthStencilFormat: RenderTargetDepthStencilFormat | null;
    readonly depthStencilAttachment: Readonly<RenderPipelineOutputDepthStencilAttachment> | null;
    colorFormat(index: number): RenderTargetColorFormat;
    colorAttachment(index: number): Readonly<RenderPipelineOutputColorAttachment>;
}

export interface RenderPipelineOutputColorAttachment {
    readonly clearValue: Readonly<RenderTargetColor>;
    readonly loadOp: RenderTargetLoadOp;
    readonly storeOp: RenderTargetStoreOp;
}

export interface RenderPipelineOutputDepthStencilAttachment {
    readonly depthClearValue: number;
    readonly depthLoadOp: RenderTargetLoadOp;
    readonly depthStoreOp: RenderTargetStoreOp;
    readonly stencilClearValue: number;
    readonly stencilLoadOp: RenderTargetLoadOp;
    readonly stencilStoreOp: RenderTargetStoreOp;
}
```

`RenderPipelineContext` 是绑定到单次 invocation lease 的只读 facade，背后的 Renderer 高水位 storage
slot 仍可复用：

- `scene/camera/output/viewport` 在 `record()`
  前更新，返回后失效；嵌套 facade 使用冻结 accessor，在动态作用域外读取或写入都会失败；
- 不能从 `record()` 中保存 context 并在之后使用；
- 每次 invocation 创建绑定不可复用 token 的公开 shell；旧 shell 不会在 storage
  slot 被后续 invocation 复用时重新变为有效；
- 同一个 `renderFrame()` 中每次 `frame.render*()` 获得独立 invocation generation 和高水位 slot；
- output attachment policy 来自当前 surface 或所选 RenderTarget，保持 clear/load/store 的原始值；
- context 不提供 `render()`、`resize()`、`setRenderTarget()`、`destroy()` 或 queue submit；
- pipeline 必须至少产生一个最终 output writer 或显式 side-effect，否则 graph 可裁掉全部工作；
- public `RendererFrame` 继续只组合应用级 render/target/present 请求，不直接暴露内部 graph。

### 7.3 CullingResults 与 RendererList

```ts
declare const cullingResultsHandleBrand: unique symbol;
declare const rendererListHandleBrand: unique symbol;

export type CullingResultsHandle = number & {
    readonly [cullingResultsHandleBrand]: true;
};
export type RendererListHandle = number & {
    readonly [rendererListHandleBrand]: true;
};

export interface CullingOptions {
    readonly camera?: Camera;
    readonly frustumCulling?: boolean;
}

export type RendererListQueue = 'opaque' | 'transparent' | 'all';
export type RendererListSorting = 'material-front-to-back' | 'back-to-front' | 'none';

export interface RendererListDescriptor {
    readonly cullingResults: CullingResultsHandle;
    readonly queue: RendererListQueue;
    readonly sorting: RendererListSorting;
    readonly overrideMaterial?: Material;
    readonly castShadowsOnly?: boolean;
}
```

实现约束：

- handle 是当前 frame generation 内的数字，不向用户暴露 Renderer 私有数组的可变所有权。
- culling slot 保存可见 Mesh、Light、shadow
  caster、深度和稳定 identity；数组、record 和 Set 高水位复用。
- 多 camera 在同一 application frame 中使用不同 slot，后一次 cull 不覆盖前一次 pass 参数。
- 默认 opaque、transparent 和 instanced 行为必须与当前 `RenderList`/`MeshDrawListPlanner` 一致。
- `overrideMaterial` 进入现有 material/pipeline revision cache，不创建旁路 pipeline。
- 不提供每 mesh JavaScript
  predicate。后续如需 layer/tag，应先加入可索引的 scene 数据和结构化 filter，而不是每 draw
  callback。
- pipeline 可以读取计数等诊断，但默认路径直接消费内部 slot，不通过逐 Mesh getter。

### 7.4 图纹理与 output

公开 SRP 第一版只暴露图纹理，不暴露任意 RHI
buffer。Geometry、UniformBuffer、instancing、skinning 和 morph 继续通过引擎对象进入现有资源系统；readback 继续使用公共 RenderTarget
API。

```ts
declare const renderGraphTextureHandleBrand: unique symbol;
declare const renderGraphPassHandleBrand: unique symbol;

export type RenderGraphTextureHandle = number & {
    readonly [renderGraphTextureHandleBrand]: true;
};
export type RenderGraphPassHandle = number & {
    readonly [renderGraphPassHandleBrand]: true;
};

export type RenderPipelineExtent =
    | Readonly<{ width: number; height: number }>
    | Readonly<{
          relativeTo: 'output';
          scale: number;
          minWidth?: number;
          minHeight?: number;
      }>;

export interface RenderPipelineTextureDescriptor {
    readonly format: RenderTargetColorFormat | RenderTargetDepthStencilFormat;
    readonly extent: RenderPipelineExtent;
    readonly sampleCount?: RenderTargetSampleCount;
    readonly mipLevelCount?: number;
}

export interface RenderPipelineTargetResources {
    readonly width: number;
    readonly height: number;
    readonly sampleCount: RenderTargetSampleCount;
    readonly colorAttachmentCount: number;
    color(index: number): RenderGraphTextureHandle;
    readonly depthStencil: RenderGraphTextureHandle | null;
}

export type RenderPipelineOutputResources = RenderPipelineTargetResources;

export interface RenderPipelinePersistentTargetDescriptor {
    readonly label?: string;
    readonly extent: RenderPipelineExtent;
    readonly colorFormats: readonly RenderTargetColorFormat[];
    readonly depthStencilFormat?: RenderTargetDepthStencilFormat;
    readonly sampleCount?: RenderTargetSampleCount;
}

export interface ScriptableRenderGraph {
    createTexture(
        name: string,
        descriptor: Readonly<RenderPipelineTextureDescriptor>
    ): RenderGraphTextureHandle;
    importOutput(): RenderPipelineOutputResources;
    importRenderTarget(target: RenderTarget): RenderPipelineTargetResources;
    acquirePersistentTarget(
        key: object,
        descriptor: Readonly<RenderPipelinePersistentTargetDescriptor>
    ): RenderPipelineTargetResources;
    releasePersistentTarget(key: object): boolean;
    addPass<P extends object>(pass: ScriptableRenderPass<P>, parameters: P): RenderGraphPassHandle;
}
```

资源规则：

- usage 不由用户填写；由 sampled read、attachment、copy 和 present 声明聚合，再映射到 portable RHI
  usage。
- extent 在 record 阶段用物理像素 viewport 确定性解析；取整规则统一，不允许 backend 各自取整。
- `importOutput()` 只建立延迟 provider；graph culling 后确有存活 writer 才获取 surface texture。
- target resource 的内部 attachment storage 由 invocation slot 高水位复用，公开 facade
  shell 则绑定当前 invocation token；使用 `color(index)` 避免为 attachment handle 创建公开数组。
- public RenderTarget attachment 保持原 identity、load/store、MSAA 和跨帧内容规则。
- selected output 的最终 writer 即使选择 `storeOp: 'discard'`
  也保持存活；其内容不可再读，但不会因 Render Graph culling 而跳过本次明确请求的 render。
- persistent target 以 runtime owner + stable key + descriptor recipe 缓存；descriptor
  revision 变化时事务 resize。
- `releasePersistentTarget(key)` 提供单 key 确定性释放；release 只在当前 application
  frame 有效提交后 commit，record/compile/prepare/execute 失败时 rollback，且不能释放本帧已 acquire 的 target。
- persistent resource 在 device/context
  recovery 后按 recipe 原位重建；pipeline 不接收 generation-specific handle。
- history current 只有在本帧声明 writer 且 submission 有效时才轮换；失败帧回滚 write
  index。descriptor revision、camera cut/显式 invalidation 与 registry
  generation 变化都会使旧 history 失效并递增公开 generation。
- history 首版只接受单 sample、单 mip、单 layer 的 2D color texture，确保 slot-level `valid`
  与“完整初始化”同义；多 mip/array/volume history 留给后续 subresource-validity 扩展。
- texture view 的 mip/layer/aspect 进入 graph hazard
  identity；不同 subresource 可并行，重叠 sampled/storage/attachment/copy access 继续拒绝。
- transient resource 在 submission 完成后归还池；第一版不宣称同帧 alias。
- graph handle 不能保存在 runtime 字段中；跨 frame 使用必须抛出 generation error。
- 同 pass sampled read/write feedback、未初始化读取、非法 discard 后读取和 attachment shape
  mismatch 继续由 compiler 拒绝。

### 7.5 ScriptableRenderPass

```ts
export interface ScriptableRenderPass<P extends object> {
    readonly name: string;
    setup(builder: ScriptableRenderPassBuilder, parameters: P): unknown;
    prepare?(context: ScriptableRenderPrepareContext, parameters: P): unknown;
    execute(context: ScriptableRenderPassContext, parameters: P): unknown;
}

export interface ScriptableRenderPassBuilder {
    readTexture(texture: RenderGraphTextureHandle): void;
    copyTexture(source: RenderGraphTextureHandle, destination: RenderGraphTextureHandle): void;
    useColorAttachment(options: Readonly<RenderPipelineColorAttachment>): void;
    useDepthStencilAttachment(options: Readonly<RenderPipelineDepthStencilAttachment>): void;
    useRendererList(list: RendererListHandle): void;
    dependsOn(pass: RenderGraphPassHandle): void;
    markSideEffect(): void;
}

export interface RenderPipelineColorAttachment {
    readonly texture: RenderGraphTextureHandle;
    readonly resolveTarget?: RenderGraphTextureHandle;
    readonly loadOp: RenderTargetLoadOp;
    readonly storeOp: RenderTargetStoreOp;
    readonly clearValue?: RenderTargetColor;
}

export interface RenderPipelineDepthStencilAttachment {
    readonly texture: RenderGraphTextureHandle;
    readonly depthLoadOp?: RenderTargetLoadOp;
    readonly depthStoreOp?: RenderTargetStoreOp;
    readonly depthClearValue?: number;
    readonly depthReadOnly?: boolean;
    readonly stencilLoadOp?: RenderTargetLoadOp;
    readonly stencilStoreOp?: RenderTargetStoreOp;
    readonly stencilClearValue?: number;
    readonly stencilReadOnly?: boolean;
}

export interface ScriptableRenderPassContext {
    readonly commands: ScriptableRenderCommands;
}

export interface ScriptableRenderPrepareContext {
    readonly capabilities: RenderPipelineCapabilities;
}

export interface ScriptableRenderCommands {
    setViewport(viewport: RendererViewport): void;
    setScissor(rect: RendererViewport): void;
    setStencilReference(reference: number): void;
    drawRendererList(list: RendererListHandle): void;
    copyTexture(source: RenderGraphTextureHandle, destination: RenderGraphTextureHandle): void;
}
```

公共 command surface 只允许：

- 执行 setup 已声明且 prepare 已准备的 `RendererListHandle`；
- 设置当前 raster pass 的 viewport、scissor 和 stencil reference；
- 执行已声明 source/destination 的 texture copy；
- `execute()` 返回时由框架确定性结束当前 pass；用户不能遗留或跨 pass 保存 command scope。

它不暴露 RHI device、pipeline/bind group 创建、native texture/view、surface
acquire 或 queue。需要绘制场景几何时使用 renderer list；需要自定义屏幕效果时使用 GLSL
`ShaderMaterial` + `FullscreenRenderPass`；需要当前 RHI 不支持的命令时先扩展 portable
RHI 和共享 renderer contract。

阶段合同：

- `setup` 无 device、无命令、无 shader 编译；只声明依赖和 attachment。
- sampled read 与 copy source/destination 使用不同 usage；copy 必须在 setup 声明确切 pair。
- `prepare` 在存活资源分配/import 后、RHI
  frame 前运行；可解析 ShaderMaterial、Pipeline、BindGroup、Framebuffer 和 PreparedDraw，并对实际 copy
  texture descriptor 做最终校验。
- `execute` 只顺序执行已经准备的 command，不做 shader reflection、pipeline creation 或 descriptor
  validation。
- 三个 callback 都必须是 pass 实例上的稳定方法；核心 API 不提供每帧 inline closure sugar。
- 同一 pass instance 在一个 graph 中可出现多次，但每次必须取得独立参数 slot。

### 7.6 参数池

```ts
export class RenderPassParameterPool<P extends object> {
    constructor(factory: () => P, reset?: (parameters: P) => void);
}
```

- pool 在 pipeline runtime 创建时建立，并只归该 runtime 所有。
- `factory` 只在历史高水位增长时调用，不是每帧回调。
- `acquirePassParameters()` 从当前 frame cursor 取得独立 slot；下一帧 cursor reset，storage 保留。
- 参数对象不能包含 native/RHI handle；可包含当前 frame 的 graph、culling、renderer-list handle。
- `reset` 不得依赖旧 frame handle；内置参数类型优先提供固定字段和显式 `set*()`，避免 descriptor
  clone。
- 默认 pipeline 的 retained pass storage 继续复用现有实现，不为迁移而再包一层参数对象。

### 7.7 内置 pass 原语

根 API 提供稳定、可组合的 pass，而不是要求每个用户重写 execute：

| 原语                   | 用途                                               | 底层复用                                                           |
| ---------------------- | -------------------------------------------------- | ------------------------------------------------------------------ |
| `SceneRenderPass`      | opaque/transparent/override-material renderer list | `ForwardRenderer`、`SharedDrawPassParameters`、`MeshDrawProcessor` |
| `ShadowRenderPass`     | directional/spot/point shadow atlas                | `ShadowAtlasSceneAdapter`、`ShadowAtlasRenderer`                   |
| `FullscreenRenderPass` | ShaderMaterial 屏幕三角形、采样图纹理              | `FullscreenDrawProcessor`、`PostProcessPassTemplate`               |
| `TextureCopyPass`      | 可移植 texture copy/resolve 辅助                   | Render Graph + RHI copy validation                                 |
| `PresentRenderPass`    | RenderTarget/graph color 到 surface                | 现有 fullscreen present 路径                                       |

`FullscreenRenderPass` 在构造时固定 shader、material、线性 sampler
slot 名称和 attachment 数量；每帧参数只写数字 handle、viewport、clear/load/store 和 UBO
revision。输入格式必须通过 `filterable-sampled` 能力查询；它不得使用 `Record<string, ...>`
或反射式 sampler 映射作为稳态路径。

### 7.8 默认 Forward pipeline 与 feature

```ts
export type ForwardRenderInjectionPoint =
    | 'before-shadow'
    | 'after-shadow'
    | 'before-opaque'
    | 'after-opaque'
    | 'before-transparent'
    | 'after-transparent'
    | 'before-post-process'
    | 'after-post-process'
    | 'before-output';

export interface ForwardRenderPipelineFeature {
    readonly name: string;
    readonly injectionPoint: ForwardRenderInjectionPoint;
    readonly requirements: Readonly<ForwardRenderFeatureRequirements>;
    create(context: RenderPipelineCreateContext): ForwardRenderPipelineFeatureRuntime;
}

export interface ForwardRenderPipelineFeatureRuntime {
    record(context: ForwardRenderFeatureContext): unknown;
    destroy(): void;
}

export interface ForwardRenderFeatureRequirements extends RenderPipelineRequirements {
    readonly sampledSceneColor: boolean;
    readonly sampledDepth: boolean;
}

export interface ForwardRenderPipelineResources {
    readonly color: RenderGraphTextureHandle | null;
    readonly depth: RenderGraphTextureHandle | null;
    replaceColor(texture: RenderGraphTextureHandle): void;
}

export interface ForwardRenderFeatureContext {
    readonly pipeline: RenderPipelineContext;
    readonly cullingResults: CullingResultsHandle;
    readonly resources: ForwardRenderPipelineResources;
}
```

规则：

- feature 配置数组在 factory 构造时快照并验证；每个配置为每个 Renderer 创建独立 feature
  runtime，已经附着的 singleton runtime 再次返回时明确失败，避免跨 Renderer 共享可变状态或重复销毁。
- feature runtime 创建后按 injection point + 插入顺序稳定编排一次，销毁时按创建逆序释放并聚合错误。
- 每次 feature `record()` callback 获得独立 lease shell；内部 forward resource state 跨 injection
  point 复用，但前一个 callback 保留的 context/resources 不会在后续 callback 或帧中重新有效。
- `cullingResults` 是内置 Shadow Pass、opaque/transparent Scene
  Pass 使用的同一个 handle；feature 创建额外 RendererList 时应复用它，而不是再次 `cull()`。
- 静态 requirements 只声明是否需要 sampled scene color/depth 或中间 target；不根据 backend 改变。
- feature 可同时声明 `requiredFeatures`、`requiredCapabilities`、`requiredLimits` 和 texture format
  requirements；factory 在 backend 选择前合并这些约束。
- 无 feature 的默认 factory 预绑定 direct recorder，不进入 feature loop，不创建中间 scene
  color，不增加 present pass。
- 需要 sampled scene color 的 feature 才把主场景改写到 `filterable-sampled` transient/persistent
  target，再执行 feature 和 output pass；单采样、可过滤 output 使用 `load`
  时先把已有颜色搬入中间 target，无法无损搬运的组合在 RHI frame 前失败。
- 首个 Scene Pass 使用 selected output 的 clear/load
  policy，队列之间固定 store/load，末个直接 output writer 或最终 output pass 使用 selected store
  policy。
- `sampledSceneColor` 只允许 `after-opaque` 及更晚的 injection point，避免 feature 在 scene
  writer 之前读取未初始化资源。
- `sampledDepth` 会让 Forward depth attachment 保持 single-sample/sampleable；fullscreen 普通 depth
  `sampler2D` 使用 non-filtering sampler，并在 WebGPU artifact 中专门化为 numeric depth
  texture。comparison sampler 仍需独立显式合同。
- feature 未产生 terminal output 时，由默认 pipeline 继续写入原 output；重复 terminal
  writer 或悬空 output 由 graph validation 拒绝。
- 动态禁用 feature 时其 pass 可被 graph culling 删除；feature set 和 attachment
  shape 不在活跃 frame 中修改。
- 完整自定义 pipeline 不受 injection point 限制，直接用 graph dependency 表达顺序。

### 7.9 `Renderer.renderFrame()` 的关系

`RendererFrame` 保持应用级命令 facade：

```text
renderer.renderFrame(frame => {
    frame.renderToTarget(reflection, stage, reflectionCamera);
    frame.renderToTarget(sceneColor, stage, camera);
    frame.present(sceneColor);
});
```

每个 `frame.render*()` 同步调用当前 pipeline runtime 的一次 `record()`，把产生的 pass 都加入同一个
`RenderGraphFrame`。它不是第二套 graph，也不允许 pipeline 再调用
`renderFrame()`。现有“一个应用 frame 最多一次应用 submission”的合同保持不变；冷启动 mipmap、显式 readback 等现有独立工作仍按当前文档处理。

### 7.10 事件与统计

- Renderer 的 `beforeRender` / `beforeRenderScene` 在一次 scene invocation 开始时触发。
- Mesh `beforeRender` 在 Mesh 首次进入本 invocation 的已声明 renderer list、且 draw
  snapshot 尚未准备时触发；相同 Mesh 被多个 pass 使用时去重，确保事件修改参与当前帧资源准备。
- Mesh 和 Renderer `afterRender` 只在整个 graph 获得有效 submission 后触发；失败帧不触发成功事件。
- `useRendererList()` 声明可能的 draw，因此 graph 后续裁掉或 execute 条件跳过的 list 可能已触发
  `beforeRender`，但不会触发 Mesh `afterRender`，也不计入公共 face
  count；后两者以 execute 中实际调用 `drawRendererList()` 为准。
- 默认 pipeline 的事件集合和顺序必须与当前行为一致。
- face count 按实际提交的 scene draw 语义统计，不能因 depth/override
  pass 重复计为公共场景面数；同一 invocation 内相同 Mesh 只计一次，pass/draw/command 诊断仍从 graph/RHI 实际执行结果取得。
- 自定义 pipeline 若故意重复绘制同一 renderer list，额外 draw 进入 draw/pass 诊断，但公共 face
  count 规则必须在 API 文档中保持确定。

### 7.11 错误与作用域

- `record/setup/prepare/execute` 返回 Promise-like 值均抛出带阶段和 pipeline/pass name 的
  `TypeError`；只有 factory create 属于可等待的初始化边界。
- context、graph、builder、prepare/execute context、command facade、parameter
  slot 和 handle 返回作用域后使用，抛出 deterministic invalid-state/generation error；公开 callback
  shell 使用不可复用 lease token，底层高水位 slot 再次活跃也不会让旧引用复活。
- pipeline record 中调用 resize、target resize/readback/destroy、resource release、Renderer
  destroy 或嵌套 render，会 poison 当前 application frame。
- graph compile 前失败不得 acquire surface、begin RHI frame 或创建 transient GPU resource。
- prepare 失败不得 begin RHI frame；execute 失败调用 `abortFrame()` 并回滚 frame-local
  revision/use。
- 自定义 pass error 保留原始 `cause`，不降级、跳过或切 backend。

## 8. 内部目录与迁移边界

目标目录：

```text
src/render/
├── Renderer.ts
├── RendererCore.ts
├── internal/
│   ├── RendererFactory.ts
│   ├── SharedRendererDriver.ts
│   └── RenderPipelineHost.ts
├── pipeline/
│   ├── RenderPipeline.ts
│   ├── RenderPipelineContext.ts
│   ├── RenderPipelineCapabilities.ts
│   ├── RenderPipelineResources.ts
│   ├── CullingResults.ts
│   ├── RendererList.ts
│   ├── ScriptableRenderGraph.ts
│   ├── ScriptableRenderPass.ts
│   ├── RenderPassParameterPool.ts
│   ├── passes/
│   │   ├── SceneRenderPass.ts
│   │   ├── ShadowRenderPass.ts
│   │   ├── FullscreenRenderPass.ts
│   │   ├── TextureCopyPass.ts
│   │   └── PresentRenderPass.ts
│   └── forward/
│       ├── ForwardRenderPipelineFactory.ts
│       ├── ForwardRenderPipeline.ts
│       ├── ForwardRenderPipelineFeature.ts
│       └── ForwardRenderPipelineResources.ts
├── frame/
├── graph/
├── renderer/
└── rhi/
```

现有模块迁移关系：

| 当前模块/职责                                  | 目标归属                                    | 要求                                             |
| ---------------------------------------------- | ------------------------------------------- | ------------------------------------------------ |
| `SharedRendererDriver.executeApplicationFrame` | `RenderPipelineHost`                        | 原事务顺序、提交、诊断和错误清理保持一致         |
| `prepareScene/buildFramePlan`                  | culling service + culling slots             | 默认排序/裁剪结果保持一致，多 camera slot 不覆盖 |
| `renderSceneShadows`                           | `ForwardRenderPipeline` 调用 shadow service | atlas、LightBlock、owner/recovery 不复制         |
| `ForwardRenderer.build`                        | `SceneRenderPass` 内部实现                  | 继续使用 retained pass set 和 PreparedDraw       |
| `OffscreenRenderTargetRenderer.build`          | output/target scene pass helper             | MRT/MSAA/load/store/bridge 规则保持一致          |
| `PostProcessRenderer`                          | fullscreen/present pass service             | shader、bind group、submission tracker 继续共享  |
| `RenderGraphFrame`                             | 不迁移                                      | 继续作为唯一事务和 graph execution owner         |
| RHI/core/backends                              | 不迁移                                      | SRP 不增加 backend feature stack                 |

`SharedRendererDriver` 最终只保留公开 Renderer 状态、backend/device/surface 初始化、生命周期入口和向
`RenderPipelineHost` 的薄调用；它不再私有硬编码具体 pass 顺序。

## 9. 默认 Forward pipeline 的规范行为

无 feature 时，一次 `render(stage, camera)` 必须按以下顺序生成与当前路径相同的工作：

1. Renderer 验证 ready/recovery/frame 状态并分配 frame index。
2. 更新 scene world matrix 与 camera view-projection。
3. 取得一个复用的 culling slot，收集可见 Mesh/Light，完成 frustum
   culling、opaque/transparent/instancing 分类和稳定排序。
4. 建立 camera/pass semantic snapshot，开始一次 mesh upload/resource-use 事务。
5. 按当前规则规划 directional/spot/point shadow atlas；没有 shadow slice 时不产生 shadow
   pass 或 atlas allocation。
6. 在 fireEvent 开启时发出与当前一致的 before events。
7. 直接向 surface output 或选中的 RenderTarget 添加 opaque Main Pass。
8. 仅在存在 transparent draw 时添加 Transparent Pass，并保持 load/store、排序与 instancing 语义。
9. 直接 surface 路径不因为 SRP 自动增加中间 color texture、fullscreen copy 或额外 present draw。
10. graph compile/prepare/execute/submit 成功后才提交资源 revision、submission
    tracker、face/draw/pass 统计和 after events。
11. surface 有存活工作且处于 acquired 状态时执行一次现有 portable `present()` 边界。
12. 失败时按当前规则 detach shadow binding、释放 acquired surface、rollback
    upload/use，并保持下一帧可用。

离屏路径必须继续保留：

- 公共 RenderTarget identity 和 owner 验证；
- color/depth/stencil load/store/clear；
- MRT sparse slot；
- 1×/4× MSAA 和 resolve；
- sampled attachment 的 last-writer graph dependency；
- target resize、destroy、readback 和 device recovery 规则；
- `frame.present(target)` 的显式 fullscreen present 行为。

有 feature 时，只为 feature 静态声明且 graph 实际存活的资源和 pass 付费。默认 direct
recorder 与 feature recorder 在 runtime 创建时预先选择，不在逐 draw 热段判断。

## 10. 性能不劣化方案

### 10.1 “不劣化”的定义

性能验收只针对相同 backend、相同浏览器、相同机器、相同 scene、相同分辨率、相同 draw/pass、相同 shader 和相同画质的当前默认路径与 SRP 默认
`ForwardRenderPipeline`。

以下任一项失败都视为性能回归：

- paired 测量出现可重复、统计显著的正向 CPU/GPU 回归；
- 超过硬上限，即使统计置信度不足；
- 默认路径每帧分配增加；
- pass、draw、RHI command、native state call 或 native object 创建无业务原因增加；
- cache hit rate 下降或 cache key cardinality 无界增长；
- 为保持时间数字减少 draw、阴影、MSAA、材质精度或输出质量。

用户自定义 pass 的业务成本不计入默认路径保证，但 SRP
framework 自身只允许为每次 invocation 和公开 feature/setup/prepare/execute
callback 创建不可复用 lease
shell；其余内部 storage 在高水位稳定后必须零额外稳态分配。编排开销保持 O(cull + pass +
feature)，不能产生 O(draw) 的额外 callback/dispatch。

### 10.2 结构性性能约束

1. 当前 `render()` 到私有 scene
   method 的一次调用，替换为到已固定 runtime 的一次调用；不额外套 Proxy 或 command facade。
2. 默认 runtime 创建时绑定 direct recorder；空 feature 列表不循环、不排序、不分配。
3. `ForwardRenderer`、`MeshDrawProcessor`、`PreparedDraw` 和 RHI execute loop 保持原类型与直接调用。
4. 公共 graph facade 只在 build 阶段写入内部 builder，不产生镜像 graph 或 replay list。
5. culling、renderer list、invocation state、pass params 和 attachment 使用 cursor + high-water
   storage；公开 invocation/callback shell 绑定唯一 lease，不进入 storage pool。
6. renderer-list 过滤和排序使用结构化枚举，不调用每 Mesh 用户函数。
7. pipeline persistent descriptor 只在 revision 变化时规范化和比较。
8. feature requirements、sampler slot、injection order 和 pass shape 在 runtime 创建时预编译。
9. generation 校验不进入 draw loop、bind loop 或 backend state cache。
10. 诊断 counter 复用当前对象，详细 trace 继续只在显式 profile 模式启用。

### 10.3 基线冻结

新增独立的 SRP renderer benchmark protocol，不覆盖 RHI immutable baseline：

- 基线是实施前最后一个通过 `npm run validate` 的明确 commit；
- baseline
  manifest 固定 commit、浏览器、OS、adapter/context、DPR、场景 revision、warm-up 和 sample 数；
- candidate 与 baseline 通过两个干净 worktree 构建，在同机同浏览器交错运行；
- baseline artifact 不允许被 candidate 命令覆盖；如场景契约变化，创建新 baseline
  generation 并保留旧 generation；
- 普通本机 smoke 输出不作为合并证据。

建议目录与命令：

```text
benchmarks/srp/
scripts/performance/collect-srp-benchmark.ts
scripts/performance/verify-srp-baseline.ts
scripts/performance/render-srp-benchmark-report.ts

npm run benchmark:srp:collect
npm run benchmark:srp:verify
npm run benchmark:srp:report
```

### 10.4 基准场景

| 场景                                | 主要风险                                                    |
| ----------------------------------- | ----------------------------------------------------------- |
| 空 scene + surface clear            | pipeline/context/graph 固定成本                             |
| 1 个静态 unlit draw                 | 最小 scene 固定成本                                         |
| 1,000 / 10,000 个共享 pipeline draw | culling、renderer list、draw 热段和 WebGL immediate path    |
| 2,000 个高状态切换 draw             | pipeline/bind group/VAO/cache 行为                          |
| 大批 instancing                     | batch 规划、InstanceBlock 和拆批                            |
| PBR + 多灯光 + 三类阴影             | LightBlock、shadow atlas、pass 编排                         |
| opaque + transparent                | 排序、attachment load/store 和 pass 数                      |
| MRT + 4× MSAA + resolve             | graph resource、target bridge 和 framebuffer/pipeline shape |
| 多 camera `renderFrame()`           | invocation slot、semantic snapshot 和单 submission          |
| RenderTarget + present              | imported resource、last writer 和 fullscreen present        |
| 2/4/8 个 no-op feature              | feature 固定成本和 graph culling                            |
| 2/4/8 个 fullscreen feature         | 参数池、sampled resource、pipeline/bind group reuse         |
| 10,000 帧 scene/resource churn      | retained heap、owner cleanup 和 persistent recipe 上界      |
| context/device loss + 恢复          | runtime identity、cache rebuild 和恢复后首帧                |

### 10.5 指标与硬门禁

| 指标                            | 合并门禁                                                             |
| ------------------------------- | -------------------------------------------------------------------- |
| 默认 pass/draw/RHI command 数   | 与 baseline 精确一致                                                 |
| 默认 native object 创建数       | 稳态与峰值不得增加；初始化差异必须逐项解释并审查                     |
| 默认 steady-state JS allocation | 相对 baseline 增量必须为 0 bytes/frame                               |
| renderer CPU p50                | 无统计显著回归；hard cap +2%                                         |
| renderer CPU p95                | 无统计显著回归；hard cap +3%                                         |
| 10,000 draw WebGL 2 CPU         | 无统计显著回归；hard cap +3%                                         |
| WebGPU encode + submit CPU      | 无统计显著回归；hard cap +2%                                         |
| GPU frame time                  | 无统计显著回归；hard cap +2%，像素和工作量相同                       |
| graph build + compile CPU       | 无统计显著回归；hard cap +3%                                         |
| retained heap                   | 10,000 帧后不高于 baseline 5%，并随帧数有界                          |
| cache hit rate                  | 不低于 baseline；key/cardinality 有界                                |
| 首次复杂帧 p95                  | hard cap +5%，不得把成本推迟成后续随机 hitch                         |
| no-op feature                   | 无 GPU pass/resource/command；仅允许 O(feature) callback lease shell |

“hard cap 内”不代表自动通过。只要至少 7 轮 paired A/B 的 95% confidence
interval 排除 0 且显示回归，就必须修复。环境噪声过大时增加样本，不放宽预算。

推荐协议：

- 300 帧 warm-up；
- 2,000 帧采样；
- baseline/candidate 顺序随机交错；
- 至少 7 轮独立重复；
- 固定浏览器 binary、flags、viewport、DPR、adapter 和电源模式；
- 报告 median、p95、p99、bootstrap confidence interval 和原始结果；
- wall-clock/GPU gate 在专用 runner 执行；PR CI 运行结构、计数、分配和 smoke gate。

## 11. 测试与验证策略

### 11.1 Unit 与 contract

至少新增：

- factory requirements 的快照/合并、auto probe、正式 capability validation 和不可削弱规则；
- factory 每 Renderer 只创建一个 runtime，factory 可共享而 runtime 不共享；
- sync/async factory
  resolve、reject 后完整清理，以及 record/setup/prepare/execute 的 Promise-like 拒绝；
- context、handle、builder 和 parameter slot 的 frame-generation 失效；
- 多 camera culling slot/semantic/UBO snapshot 不互相覆盖；
- opaque、transparent、instanced、shadow caster renderer list 与当前结果一致；
- override material 的 shader/pipeline/resource revision 与 owner 清理；
- 同 pass 多次调度取得独立参数；高水位稳定后无参数对象增长；
- transient、output、RenderTarget 和 persistent resource 的 read/write/dependency/culling；
- relative extent 在整数和非整数 DPR 下确定性解析；
- feature injection order、static requirements、禁用和 terminal output validation；
- pipeline destroy、Renderer release/destroy、target destroy 和 submission 在途资源释放；
- setup/compile/prepare/execute 失败的 frame poison、rollback 和下一帧恢复。

### 11.2 Architecture test

`npm run test:render:architecture` 必须增加断言：

- 所有生产 scene render 都经过 `RenderPipelineHost`；
- 默认 pipeline 只有一份 forward/shadow/target/postprocess feature 实现；
- `src/render/pipeline/**` 不导入 concrete backend 或 native type；
- RHI/graph core 不反向依赖 pipeline、Scene、Mesh 或 Material；
- public SRP context 不暴露 RHI device、surface、queue 或 native extension；
- 默认 execute loop 仍直接消费 `PreparedDraw`，没有 facade、Proxy 或软件 replay；
- pass template 和参数 storage 是稳定实例，高水位后不增长；
- 默认无 feature graph 的 pass/resource/command 计数与冻结 snapshot 一致。

### 11.3 默认行为 parity

在 WebGL 2 和 WebGPU 上逐项比较迁移前后：

- clear、opaque、transparent、renderOrder 和 instancing；
- Basic/PBR、fog、灯光、directional/spot/point shadow；
- skinning、morph、quantized geometry 和 ShaderMaterial；
- RenderTarget、MRT、MSAA、depth/stencil、sampled attachment、readback 和 present；
- 多 camera/multi-target `renderFrame()` 的 pass 顺序、UBO 值和单 submission；
- before/after event、face/draw/pass diagnostics；
- resize、DPR 1.25/1.5、resource release、target ownership；
- WebGL context loss、WebGPU device loss、恢复后公共 identity 和逐字节像素。

默认 pipeline 的视觉 baseline 不因“架构重构”放宽容差。若预期像素没有变化，截图和 readback 应保持一致。

### 11.4 自定义 SRP browser fixture

新增至少一个不依赖 internal import 的公开 API 示例/fixture，同时在两个 backend 运行：

1. 自定义 pipeline 创建 3 attachment G-buffer（颜色、法线编码、材质参数）和 depth。
2. 使用 override `ShaderMaterial` 绘制 scene renderer list。
3. fullscreen lighting pass 采样 G-buffer/depth 写入 scene color。
4. transparent renderer list load scene color 后继续绘制。
5. 一个 feature 执行 ping-pong bloom/tone-map。
6. 最终输出到 surface；另一路在 `renderFrame()` 中输出到 RenderTarget 后 present。
7. 断言双后端 pass/draw/submit、无 GPU validation error、非空 readback 和像素 parity。

这能证明 SRP 不是只导出了类型，也不是只能调用默认 forward helper。

### 11.5 Shader 与 WebGPU

任何示例或内置 SRP shader 必须进入：

- WebGL 2 compile/link；
- Naga GLSL→WGSL corpus；
- WebGPU shader module compilation；
- 真实 WebGPU pipeline/draw/submit/readback；
- 适当的双后端 UI/视觉 fixture。

### 11.6 API、包与文档

公共 API 合入时必须：

- 从 `src/Hilo3d.ts` 根入口导出 SRP factory/runtime/context/handle/descriptor/pass/feature；
- 为每个公共类型和方法写 TSDoc，并明确作用域、同步性和 ownership；
- 更新 `CHANGELOG.md`；
- 运行 `npm run api:update` 并审查 `etc/hilo3d.api.md`；
- 运行 `npm run api:check`、`npm run test:types`、`npm run test:package`；
- 更新 README/README_ZH 的创建、默认 pipeline、feature 和完整 custom pipeline 示例；
- 更新本文件状态和 `RENDERING_ARCHITECTURE.md` 当前事实。

## 12. 分阶段实施计划

阶段用于控制风险，不代表允许发布半成品。Phase 0–7 可形成内部 review commit；Phase 8 前不发布 SRP
API，Phase 9 后才算完成。

### Phase 0：冻结行为与性能基线

工作：

- 记录当前 commit、工具链、浏览器、双 backend 默认像素和行为 snapshot；
- 建立 `benchmarks/srp` manifest、collector、统计、verify 和 report；
- 固定 default pass/resource/RHI command/native object/cache counter snapshot；
- 补齐当前事件、多 camera、target、shadow、失败和恢复 parity 测试。

退出条件：baseline 不可变、可在干净 worktree 重放，波动范围已知，所有后续 candidate 可自动比较。

### Phase 1：内部 PipelineHost 与生命周期合同

工作：

- 新增内部 `RenderPipelineHost`、runtime owner 和 invocation generation；
- 把 `executeApplicationFrame` 的事务、诊断、surface、submission 和错误清理搬入 host；
- 保持当前私有 scene methods 作为唯一 recorder，暂不公开 API；
- 增加 nested/async/作用域/poison contract tests。

退出条件：生产行为和调用图不变；默认 benchmark、pass/command/object 计数与 baseline 一致。

### Phase 2：提取内置 ForwardRenderPipeline

工作：

- 把当前 surface/target/shadow/forward/transparent/present 顺序提取为内部 runtime；
- `SharedRendererDriver` 只向 host 提交 scene invocation；
- runtime 直接复用现有 renderer service 和 retained storage；
- 不增加 feature、公共 facade 或第二套 draw implementation。

退出条件：全部默认 parity 测试通过；默认 graph snapshot 和 performance
gate 通过；旧私有编排方法删除而不是保留开关。

### Phase 3：CullingResults 与 RendererList slot

工作：

- 将 `RenderGraphFramePlanner`/`RenderList` 结果迁入 renderer-local 高水位 slot；
- 加入 frame-scoped numeric handle 和 generation validation；
- 支持 opaque/transparent/all、shadow caster 和 override material；
- 默认 pipeline 直接访问内部 slot storage，公共 handle 不进入 draw loop。

退出条件：单/多 camera、instancing、排序、灯光和阴影结果 parity；稳态 slot/array 增长为零。

### Phase 4：ScriptableRenderGraph 与参数池

工作：

- 新增窄化 graph facade、texture/output/target handle 和相对 extent；
- 新增 `RenderPassParameterPool`、stable pass template 和作用域校验；
- facade 直接写入现有 builder storage；
- 加入 scene/fullscreen/copy/present pass 原语；
- 禁止 public native/RHI escape。

退出条件：自定义 graph contract
tests 通过；compile 前零 GPU 副作用；高水位稳定后内部 storage 不再增长、公开 lease
shell 分配保持 O(callback)；architecture test 证明无镜像 graph。

### Phase 5：Persistent resource 与恢复

工作：

- 增加 runtime owner + stable key + recipe 的 persistent target/history registry；
- descriptor revision 触发事务 resize；
- 接入 submission tracker、release、destroy、WebGL context loss 和 WebGPU device loss；
- 覆盖 history 双/三缓冲、失败 submission 回滚、recovery invalidation、多 Renderer
  factory 复用和 runtime cleanup。

退出条件：恢复前后逻辑 identity、输出像素和 owner 不变；10,000 帧/资源 churn 有界；失败 resize/rebuild 不留下半提交资源。

### Phase 6：Forward feature 与完整 custom pipeline

工作：

- 实现固定 injection point、静态 requirements 和 direct/feature recorder 预绑定；
- 迁移默认 postprocess/present helper 到公共原语；
- 编写 deferred + fullscreen feature 双后端 fixture；
- 验证 custom pipeline 在 `renderFrame()` 多 camera/target 下仍为一个 graph/submission。

退出条件：无 feature 默认路径不增加 pass/resource/command；feature/custom
fixture 真实双后端 draw/submit/readback 成功。

### Phase 7：公共 API 与消费面

工作：

- 在 `RendererCommonOptions` 增加 `renderPipeline`；Stage 创建参数自然透传；
- 从根 barrel 导出经过审查的 SRP 类型；
- 补 TSDoc、README、README_ZH、示例、CHANGELOG、API report 和包消费类型测试；
- 拒绝 deep import、异步逐帧 runtime callback 和 runtime 共享；factory
  create 可在唯一初始化边界异步。

退出条件：`api:check`、`test:types`、`test:package`、`docs:check` 全部通过；公开示例只从 `hilo3d`
根入口导入。

### Phase 8：性能报告与原子启用

工作：

- 在专用 runner 对 baseline/candidate 做完整 paired A/B；
- 修复任何显著回归或 hard-cap 失败；
- 执行双后端 UI、WebGPU、视觉、恢复和完整 `npm run validate`；
- 审查 benchmark 原始结果、报告、API diff、视觉 diff 和 package tarball；
- 一次性启用并发布公共 SRP API 与默认 Forward runtime。

退出条件：本文件全部性能、功能、API、包和证据门禁通过；不存在临时 flag、hidden bypass 或未说明限制。

### Phase 9：清理与文档转正

工作：

- 删除迁移 flag、旧私有编排入口、临时 adapter、重复测试和过时注释；
- 将 `RENDERING_ARCHITECTURE.md` 更新为 SRP 当前生产流程；
- 将本文状态改为“已完成”，记录完成日期、commit、性能报告 generation 和实际命令；
- 更新 `documentation/README.md` 的 source-of-truth 说明（如需要）。

退出条件：仓库只剩一套 Renderer → PipelineHost → RenderGraphFrame → RHI 生产路径，`npm run validate`
在清理后再次通过。

## 13. 文件级改造清单

| 文件/目录                                     | 计划改动                                                                               |
| --------------------------------------------- | -------------------------------------------------------------------------------------- |
| `src/render/RendererOptions.ts`               | 增加 `renderPipeline?: RenderPipelineFactory`，快照并合并 factory requirements         |
| `src/render/Renderer.ts`                      | 导出 SRP 相关公共类型，保持唯一 Renderer 入口                                          |
| `src/render/RendererCore.ts`                  | 移除对单一 frame planner 的硬耦合，公共 RendererContract 行为不变                      |
| `src/render/internal/SharedRendererDriver.ts` | 委托 PipelineHost，删除具体 pass 顺序                                                  |
| `src/render/internal/RenderPipelineHost.ts`   | 新增唯一 frame/pipeline/lifecycle 组合根                                               |
| `src/render/pipeline/**`                      | 新增公共 facade、runtime、culling/list、pass、资源和默认 forward pipeline              |
| `src/render/graph/**`                         | 仅补 facade 所需的内部低开销入口和 validation，不公开 compiler/executor implementation |
| `src/render/renderer/**`                      | 复用并按需提取 service；不复制 backend 或 feature 逻辑                                 |
| `src/render/rhi/**`                           | 原则上不改；只有正式 portable capability 缺口才独立扩展                                |
| `src/Hilo3d.ts`                               | 根导出 SRP API，不增加 package subpath                                                 |
| `test/spec/renderer/**`                       | pipeline、context、pass、resource、parity、failure、recovery 单测                      |
| `test/spec/rhi/**`                            | 保持 portable contract，补 SRP 不绕过 RHI 的 architecture 断言                         |
| `test/ui/**`                                  | 自定义 pipeline/feature 双后端 runtime、像素和视觉 fixture                             |
| `benchmarks/srp/**`                           | immutable baseline contract、场景和 schema                                             |
| `scripts/performance/**`                      | SRP collector、verify、statistics 和 report                                            |
| `README.md` / `README_ZH.md`                  | 默认、feature、custom pipeline 使用文档                                                |
| `CHANGELOG.md` / `etc/hilo3d.api.md`          | 公共 API 记录与签名基线                                                                |
| `documentation/RENDERING_ARCHITECTURE.md`     | 仅在实现完成后更新当前事实                                                             |

## 14. 兼容性与发布策略

### 14.1 默认兼容

本节以 async-only `Renderer.create()` / `Stage.create()`
已完成并成为发布基线为前提。构造函数移除是独立于 SRP 的兼容性变更，必须在对应发布评审中单独说明，不能由 SRP
compatibility layer 掩盖。

- 省略 `renderPipeline` 时仍得到当前 forward 行为。
- `Renderer.create()` / `Stage.create()` 仍是唯一创建入口；省略 backend 的 WebGPU-first `auto`
  策略、显式 backend fail-closed 和选中后的不回退规则不变。
- `render()`、`renderToTarget()`、`renderFrame()` 和 readback 的职责不变；`setRenderTarget()` 与
  `present()` 的 presentation options 显式携带 attachment-zero
  `colorEncoding`，不再从自定义 shader 或 attachment format 猜测显示语义。
- clear、MSAA、depth/stencil、events、diagnostics、resource manager 和 recovery 可观察语义不变。
- 已使用 async `create()` 的应用无需为默认 SRP 迁移；`renderPipeline` 本身是 additive public API。

### 14.2 不提供的兼容层

- 不重新导出 abstract Renderer、WebGLRenderer/WebGPURenderer 或 backend-specific pipeline。
- 不提供旧/新 architecture runtime switch。
- 不发布 `hilo3d/render/graph` 或 `hilo3d/rhi` deep-import subpath。
- 不接受手写 command buffer、native callback 或 backend-only pass 作为 SRP compatibility escape。

### 14.3 发布证据

发布 PR 必须附：

- API report diff；
- default behavior/parity 测试摘要；
- WebGL 2/WebGPU UI、WebGPU 深度 fixture 和视觉 diff；
- context/device loss 与 persistent resource 恢复结果；
- SRP benchmark baseline/candidate manifest、原始数据和报告；
- 实际运行的 validation 命令与未运行项；
- 已知 capability 边界，不得把未来能力写成当前支持。

## 15. 回滚规则

- 每个 phase 必须保持完整纵向 ownership；不能一半 pass 走 SRP resource registry、一半绕过它。
- 任何 frame 中只能有一个 PipelineHost 和一个 RenderGraphFrame transaction。
- candidate 失败只能在下一次开发构建或 commit 回退，不能在半帧中切换旧编排。
- 性能门禁失败时停止公开 API 和默认切换，修复后重新完整采样；不得覆盖 baseline。
- 功能 parity 失败时修复共享 service，不在 custom/default pipeline 复制 feature 逻辑。
- 如果公共 API 设计在 Phase 7 前发现根本问题，允许整体调整未发布类型；Phase
  8 发布后只按正常 semver 演进。
- 发布后需要紧急回滚时回退完整 SRP 发布 commit/release，不增加隐藏 runtime flag 或 native bypass。

## 16. 主要风险与缓解

| 风险                                 | 后果                                        | 缓解                                                                             |
| ------------------------------------ | ------------------------------------------- | -------------------------------------------------------------------------------- |
| 直接公开内部 Render Graph/RHI        | API 面失控、native 生命周期泄漏、后续难演进 | 只公开窄化 SRP facade、数字 handle 和高层 pass command                           |
| 默认管线多一层抽象                   | CPU 回归、逐 draw dispatch                  | runtime 构造时固定 direct recorder；默认 execute loop 不经 facade；专用 A/B 门禁 |
| 用户每帧创建 pass/descriptor/closure | GC 与 hitch                                 | stable pass + parameter pool；文档和示例只展示 retained 模式；诊断统计增长       |
| 多 camera 覆盖 culling/UBO/params    | 错画面或资源引用错误                        | invocation/culling/pass 高水位 slot + frame generation + submission snapshot     |
| feature 隐式要求中间纹理             | 默认带宽和 GPU 时间增加                     | 静态 requirements；无 feature direct-to-output；只分配存活 graph resource        |
| persistent history 在恢复后失效      | TAA/bloom/history 错误或 crash              | backend-neutral recipe、owner registry、generation invalidation 和真实 loss test |
| custom pipeline 绕过事件/统计        | API 行为漂移                                | host 统一 frame/event/diagnostics；renderer list 首用 frame stamp                |
| capability 差异导致 backend 分支     | 双端功能漂移                                | capability-driven validation；不支持即明确失败；共享 shader/pass                 |
| 参数对象被同帧多次覆盖               | execute 使用最后一次数据                    | 每次 addPass 强制当前 frame 独立 pool slot                                       |
| factory/runtime 被多个 Renderer 共享 | cache、owner 和恢复串扰                     | factory 可共享，runtime attach token 单 owner，重复绑定抛错                      |
| benchmark 噪声掩盖回归               | 错误放行                                    | 固定环境、随机 paired 顺序、至少 7 轮、CI 结构门禁 + 专用 runner timing          |

## 17. 验收清单

### 架构

- [ ] 公开 Renderer 仍只有一个，backend 仍只有 `webgl2` 和 `webgpu`。
- [ ] 所有 scene render 都经过唯一 `RenderPipelineHost` 和 `RenderGraphFrame`。
- [ ] 默认/custom
      pipeline 共享 culling、PreparedDraw、shadow、target、fullscreen、resource 和 recovery
      service。
- [ ] pipeline/feature/pass 不导入 concrete backend 或 native type。
- [ ] 公共 SRP API 不暴露 RHI device、queue、surface 或 native handle。
- [ ] RHI/graph core 不依赖 Scene、Mesh、Material 或 pipeline。
- [ ] 不存在发布时可选 legacy path、native bypass 或第二 command stream。

### 功能

- [ ] 默认 Forward pipeline 的 pass、draw、事件、统计、像素和 target 行为与 baseline 一致。
- [ ] 自定义 pipeline 可控制 culling、renderer list、shadow、MRT/depth、fullscreen、copy 和 output。
- [ ] feature 注入点、顺序、requirements 和 terminal output 可验证且稳定。
- [ ] 多 camera/target `renderFrame()` 保持一个 graph 和最多一次应用 submission。
- [ ] transient/imported/persistent resource 的依赖、culling、resize、destroy 和 recovery 正确。
- [ ] setup/compile/prepare/execute 失败不提交 frame-local revision/use。
- [ ] WebGL context loss 和 WebGPU device loss 后 runtime 与公共资源 identity 正确恢复。

### 性能

- [ ] 默认 pass/draw/RHI command/native object 计数与 baseline 精确一致。
- [ ] 默认 steady-state JS allocation 相对 baseline 增量为 0。
- [ ] 默认 CPU/GPU 无统计显著回归且所有 hard cap 通过。
- [ ] 无 feature direct recorder 不循环 feature、不创建中间纹理或额外 output pass。
- [ ] 高水位稳定后 culling/list/pass/graph 内部 storage 不增长；公开 lease
      shell 只按 callback 数量线性创建。
- [ ] 默认 draw execute 无新增 facade、Proxy、backend branch 或逐 draw 虚调用。
- [ ] 10,000 帧 churn 后 retained heap 和 persistent recipe/cardinality 有界。

### Shader 与双后端

- [ ] SRP portable raster shader 只有 GLSL ES 3.00 source of truth 和 std140/sampler
      ABI；受控 compute/storage source contract 按当前架构文档执行。
- [ ] WebGL 2 compile/link、Naga、真实 WebGPU pipeline/draw/readback 全部通过。
- [ ] 自定义 deferred/fullscreen fixture 在 WebGL 2/WebGPU 得到一致、非空且可验证的结果。
- [ ] UI、交互和视觉门禁没有放宽容差或新增静默 fallback。

### 公共 API 与发布

- [ ] 所有公共 SRP 类型有 TSDoc，并从 `src/Hilo3d.ts` 根入口导出。
- [ ] `RendererCommonOptions.renderPipeline`、Stage 透传和默认 factory 有类型/运行时测试。
- [ ] README、README_ZH、CHANGELOG、API report、包消费测试和架构文档已同步。
- [ ] `npm run api:check`、`npm run test:types`、`npm run test:package` 通过。
- [ ] `npm run typecheck`、`npm run lint`、`npm run test:render:architecture`、`npm run test:rhi`
      通过。
- [ ] `npm run test:ui:webgl2`、`npm run test:ui:webgpu`、`npm run test:webgpu` 和视觉门禁通过。
- [ ] `npm run validate` 通过。
- [ ] 专用 SRP benchmark 报告、原始结果和 immutable baseline 已审查。
- [ ] 迁移 flag、旧编排、临时 deep import 和重复实现已删除。

## 18. 建议提交序列

实现可以按以下 Conventional Commit 拆分 review，但只在全部完成后发布：

1. `test(render): freeze scriptable pipeline baselines`
2. `refactor(render): introduce the render pipeline host`
3. `refactor(render): extract the default forward pipeline`
4. `feat(render): add frame-scoped culling and renderer lists`
5. `feat(render): add the scriptable render graph facade`
6. `feat(render): add retained scriptable render passes`
7. `feat(render): add persistent pipeline resources and recovery`
8. `feat(render): add forward pipeline features`
9. `feat(render): expose scriptable render pipelines`
10. `test(render): add dual-backend custom pipeline coverage`
11. `perf(render): verify scriptable pipeline non-regression`
12. `docs(render): publish the scriptable pipeline architecture`
13. `refactor(render): remove transitional pipeline code`

每个提交都必须保持 strict
TypeScript、ESM、测试可运行和单一资源 ownership；禁止用类型逃逸或临时 backend bypass 跨过阶段。

## 19. 完成后的维护规则

1. 新 renderer feature 默认实现为 `ForwardRenderPipelineFeature` 或共享 pass，不进入 backend。
2. 新 pass 必须声明完整资源依赖，不能通过 native extension 隐藏读取/写入。
3. 新 pass 参数必须使用 retained storage；默认/内置路径不得每帧创建 closure 或 descriptor tree。
4. 新 portable raster shader 必须继续通过 WebGL 2、Naga 和真实 WebGPU pipeline 覆盖；WebGPU-only
   compute/storage shader 必须通过其 Naga、portable RHI、真实 WebGPU 与 WebGL 2 negative 门禁。
5. 新 persistent resource 必须注册 recipe、owner、submission lifetime 和 recovery test。
6. 新 feature 若改变 scene
   color/depth 中间资源需求，必须声明静态 requirements 并增加 bandwidth/performance benchmark。
7. 新 capability 在 WebGL 2/WebGPU 无一致实现时必须显式 gate，不得静默降级。
8. 公共 SRP API 变化继续要求 TSDoc、测试、CHANGELOG、API report、类型消费和 package 验证。
9. 默认 Forward pipeline 的性能 baseline 只能新增 generation，不能覆盖历史数据来让 candidate 通过。
10. Render Graph/RHI 内部可以继续优化，但 public SRP
    facade 的作用域、同步、所有权和错误合同必须保持稳定。

## 20. SSBO、storage texture 与 compute 的已实现衔接

当前 SRP 已通过公开 `storage-buffer`、`storage-texture`、`compute-pass` 和 `indirect-draw`
capability 支持这类能力。它们是 WebGPU-only：factory/feature 声明为 required 后，backend
selection 会排除 WebGL 2，并在 runtime 创建前校验实际 WebGPU feature、limit 和 storage
format；不兼容时明确失败，不运行时跳过。

完整公开设计、API、hazard、Direct WGSL、GPU-driven raster、恢复和首发边界独立维护在
[`COMPUTE_STORAGE_IMPLEMENTATION_PLAN.md`](./COMPUTE_STORAGE_IMPLEMENTATION_PLAN.md)。该文件取代本节早期“compute
GLSL 转换”和“先公开部分 storage binding”的实施顺序；本节只保留与 SRP 的衔接摘要。

固定衔接原则：

1. WebGPU-only Compute 使用受控 Direct WGSL，并经 Naga WGSL frontend、显式 binding ABI、portable RHI
   validation 和真实 WebGPU pipeline 验证；现有双后端 raster shader 继续使用 GLSL ES 3.00。
2. Forward+、高斯泼溅和 GPU 粒子所需的 graphics-stage readonly storage 使用专用 WebGPU-only GLSL ES
   3.10 storage source contract，经统一预处理和 Naga 生成 WGSL；不新增 graphics WGSL 镜像。
3. Compute 不继承 `Material`；公开
   `ComputeShader`、`ComputeKernel`、`ComputeRenderPass`。Compute-driven
   raster 继续组合普通 Material 表达 raster state，并通过 `GPUDrivenRenderPass` 消费 graph
   storage/vertex/index/indirect buffer。
4. `UniformBuffer` 保持 std140；StorageBuffer 使用独立 WGSL host-shareable
   layout、revision、dirty-range、readback 和 recovery policy。
5. raster、copy、compute 共用同一 Render Graph。Buffer
   read/write/read-write、clear、vertex/index/indirect access 和 storage texture
   access 全部进入统一 RAW/WAR/WAW、初始化、culling 和 lifetime 分析。
6. RHI 已增加 compute pipeline/pass、direct/indirect dispatch、buffer clear 和 indirect
   draw，不公开原生 `GPU*` 对象；WebGPU 一跳映射，WebGL
   2 明确 fail-closed，不做 texture/CPU/transform-feedback 模拟。
7. required compute/storage/indirect capability 在 Renderer 创建前参与 `auto`
   候选筛选。WebGPU 不可用时返回“无兼容 backend”，不能创建 WebGL 2 后静默跳过 pass。
8. 公共 capability、根导出、示例和文档与 StorageBuffer、storage texture、direct/indirect
   dispatch/draw、graph hazard、readback、device-loss recovery、真实 WebGPU 和负向 WebGL 2
   policy 原子开放。
9. 首发 graph compute texture 只表达完整 2D subresource，storage texture 仅 transient
   write-only；跨帧 state 使用 renderer-owned `StorageBuffer`。内置 Forward feature 已支持 portable
   non-filtering depth sampling；完整自定义 SRP 仍可显式组合 depth prepass、compute 与 Scene group-3
   storage。

这样扩展不会重写 SRP：factory requirements、renderer-local runtime、同步 record、graph
handle、三阶段 pass、persistent
recipe 和 submission 生命周期全部复用；新增的是 compute/storage/GPU-driven
resource 与 pass 种类，而不是第二套 Renderer 或 backend-specific feature stack。
