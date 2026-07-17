# Hilo3D WebGPU Compute、Storage 与 GPU-Driven Rendering 一次性实施设计

> 状态：目标设计已确定，代码尚未实施
> 制定日期：2026-07-17
> 目标版本：完成全部验收门禁后的首个原子公开版本；具体 semver 由发布评审决定
> 当前生产事实仍以 [`RENDERING_ARCHITECTURE.md`](./RENDERING_ARCHITECTURE.md)、当前代码和测试为准。

## 1. 结论

Hilo3D 应在现有共享 Renderer、Render Graph 和 portable RHI 上增加一条完整的 WebGPU
Compute 与 compute-driven raster 能力链，而不是增加第二套 renderer、公开原生
`GPUDevice`，或把 compute 塞进现有 raster
`Material`。这条能力必须能自然承载 Forward+、高斯泼溅和 GPU 粒子，而不要求 CPU
readback、逐元素 draw 或 texture-backed SSBO。最终结构是：

```text
RenderPipelineFactory requirements
                 │
                 ▼
      Renderer.create() backend selection
       WebGPU 可用 ───── WebGL 2 明确拒绝
                 │
                 ▼
       ComputeShader（Direct WGSL）
                 │
                 ▼
       ComputeKernel（稳定 pipeline 配置）
                 │
                 ▼
       ComputeRenderPass（setup/prepare/execute）
                 │
                 ▼
   Render Graph buffer/texture hazard 与生命周期
                 │
      ┌──────────┴──────────┐
      ▼                     ▼
后续 Compute Pass    Storage-aware Raster Pass
                      vertex pulling / indirect draw
      │                     │
      └──────────┬──────────┘
                 ▼
 portable RHI compute pipeline/pass/dispatch
       + graphics storage/indirect draw
                 │
                 ▼
             WebGPU backend
```

核心决策如下：

| 问题                      | 决策                                                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Compute 支持范围          | WebGPU-only；WebGL 2 不做 texture、transform feedback 或 CPU 模拟                                                |
| Compute shader 来源       | Direct WGSL；不经过 GLSL 转换，但必须经过 Naga WGSL frontend 校验                                                |
| Raster shader 来源        | 继续只有 GLSL ES 3.00，经预处理、Vulkan GLSL 4.50、Naga 生成 WGSL                                                |
| Storage-aware raster 来源 | WebGPU-only GLSL ES 3.10 storage subset，经统一预处理和 Naga 生成 WGSL；不增加 graphics WGSL 树                  |
| Compute 是否属于 Material | 不是；使用独立的 `ComputeShader`、`ComputeKernel` 和 `ComputeRenderPass`                                         |
| 资源模型                  | 公共 `StorageBuffer`、graph buffer、storage texture、显式 binding range                                          |
| 图依赖                    | raster、copy、compute 共用同一 RAW/WAR/WAW 分析和拓扑排序                                                        |
| 同 pass 原地读写          | buffer 通过显式 `readWriteBuffer()` 支持；普通 read + write 重复声明仍拒绝                                       |
| Compute-driven raster     | graphics stage 可只读 storage buffer、vertex/index buffer 和 indirect args；提供 direct/indirect procedural draw |
| Pipeline layout           | 始终显式生成；不使用 WebGPU `layout: 'auto'` 作为生产合同                                                        |
| GPU command               | 同时支持 buffer clear、direct/indirect dispatch、direct/indirect draw                                            |
| Queue 模型                | 继续使用一个 frame command scope；不引入 async compute 或多 queue                                                |
| 发布策略                  | 内部可分工作包实施，但 capability、公共 API 和示例只在完整闭环后同版本开放                                       |

“一次性实施”是指**对外原子、能力完整、没有半公开状态**，并不意味着把所有代码放进一个不可评审的提交。在全部功能、异常路径、恢复、性能、API 和真实 WebGPU 门禁通过前：

- `storage-buffer`、`storage-texture`、`compute-pass` 以及实施时新增的 `indirect-draw` 继续返回
  `false`；
- 不导出临时类型或 deep-import 入口；
- 不让应用先创建 WebGL 2 renderer 再在运行时跳过 compute；
- 不保留手写 native WebGPU bypass；
- 不用降低验证、关闭恢复或隐藏错误来换取可运行 demo。

## 2. 目标与非目标

### 2.1 必须在首个公开版本完成

1. WebGPU Compute Shader、Compute Pipeline、Compute Pass、direct/indirect dispatch。
2. renderer-owned `StorageBuffer`，支持初始化、部分更新、range binding、异步 readback 和显式销毁。
3. transient、imported、persistent graph buffer，以及声明推导的 RHI usage。
4. `read-only-storage`、`read-write-storage` buffer binding。
5. sampled texture、sampler、uniform buffer、write-only storage texture compute binding。
6. buffer 的 read、write、read-write、copy、indirect graph access 与统一 hazard。
7. graphics-stage read-only storage buffer，以及 compute 输出作为 storage、vertex、index 和 indirect
   input。
8. compute → compute、compute → sampled/storage-aware raster、raster/copy → compute 的同帧依赖。
9. buffer clear、direct/indirect dispatch、direct/indirect draw 和 indexed indirect draw。
10. pipeline、layout、bind group、buffer、texture 全部接入 ResourceRegistry、submission
    fence 和 device generation。
11. 创建前 capability/limit/format 筛选；WebGL 2 明确 fail-closed。
12. CPU upload transaction、GPU readback、device loss、失败回滚和重新初始化合同。
13. Forward+、高斯泼溅、GPU 粒子三个无 CPU 同步的端到端验收 fixture。
14. 公共 API、TypeDoc、API report、类型消费、示例、真实 WebGPU
    pipeline/dispatch/draw/readback 和性能证据。

WGSL core 的 atomics、workgroup memory 和 barriers 可以直接在 `ComputeShader`
中使用；引擎负责能力和 limit 校验，但不为每个 WGSL 语法特性再造一层 JavaScript 包装。

### 2.2 明确不做

- 不在 WebGL 2 上模拟 SSBO 或 compute shader。
- 不开放 `GPUDevice`、`GPUBuffer`、`GPUComputePipeline`、`GPUCommandEncoder` 或原生 pass encoder。
- 不允许绕过 Render Graph 直接 dispatch 或提交 queue。
- 不把 `ComputeKernel` 继承自 `Material`，也不向 `Material` 增加无意义的 raster/compute 模式分支。
- 不允许 compute 通道提交 `@vertex` 或 `@fragment` WGSL；raster 继续走 GLSL 单一来源。需要 storage
  block 的 WebGPU-only raster shader 使用受限 GLSL ES 3.10 source contract，而不是 Direct WGSL。
- 不加入 async compute、多 queue、用户显式 barrier、timeline semaphore 或跨 queue ownership
  transfer。
- 不把 storage texture 的 sampled/write feedback 偷换成隐式拷贝。
- 不保证 GPU-only 状态在 device loss 后无损恢复；恢复语义必须由资源策略显式定义。
- 不把 subgroup、shader-f16、timestamp-query 等可选特性变成 compute 基线要求。
- 不同时设计通用 GPGPU 框架、粒子系统、物理引擎或节点式 shader 编辑器。

## 3. 当前基础与缺口

### 3.1 已有基础

| 层             | 当前已有能力                                                                                  |
| -------------- | --------------------------------------------------------------------------------------------- |
| RHI resource   | `STORAGE`、`INDIRECT` buffer usage，storage texture usage，mapping 与 copy                    |
| RHI binding    | storage/read-only-storage buffer、storage texture layout 和 WebGPU native 映射                |
| RHI validation | storage feature、format、sample count、binding size、offset alignment 和 stage resource count |
| Render Graph   | branded buffer handle、create/import/provider/extract、transient pool、read/write hazard      |
| Executor       | `prepare`/`execute` 都能按已声明 access 解析 `RHIBuffer`                                      |
| Renderer cache | buffer upload transaction、shader/pipeline/bind-group cache、ResourceRegistry recipe          |
| 生命周期       | submission-aware destroy、device generation、context/device loss recovery                     |
| SRP            | factory requirements、renderer-local runtime、三阶段 pass、高水位参数 storage                 |

### 3.2 必须补齐的缺口

| 层                | 缺口                                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------------------------- |
| Shader            | 只有 vertex/fragment GLSL pair；没有 Direct WGSL compute、compute reflection ABI 或 kernel cache     |
| RHI stage         | `RHIShaderStage` 和 `RHIShaderStageName` 没有 compute                                                |
| RHI pipeline      | 只有 graphics pipeline，没有 compute pipeline descriptor/resource                                    |
| RHI commands      | 只有 render pass，没有 compute pass、dispatch 或 indirect dispatch                                   |
| Capability        | WebGPU 未报告 `compute-pipelines`，compute limits 不完整，SRP 三个 capability 固定为 false           |
| Public graph      | 只公开 texture handle；buffer 仍是内部能力                                                           |
| Hazard            | 当前统一拒绝同 pass read/write，无法表达合法的 storage buffer read-write                             |
| Resource API      | 没有 renderer-owned StorageBuffer、readback、GPU-write recovery policy                               |
| Binding compiler  | 当前主动拒绝 storage reflection，只能合并 vertex/fragment uniform/sampler                            |
| Graphics interop  | 没有 graphics-stage storage binding、graph vertex/index input、buffer clear 或 indirect draw command |
| Procedural raster | 公共 SRP 只能画 renderer list/fullscreen triangle，不能从 compute 结果直接 procedural/indirect draw  |
| Backend selection | `auto` probe 没有把 required compute/storage capability 纳入候选筛选                                 |
| Diagnostics       | 没有 dispatch、compute pipeline/bind-group switch 或 workgroup 统计                                  |

## 4. 对象模型与职责

### 4.1 Compute 不是 Material

`Material` 表达 raster draw state：vertex/fragment
shader、depth、blend、cull、attachment 和 mesh 语义。Compute 不拥有这些状态，因此不应出现
`ComputeMaterial extends Material`。

目标对象模型是：

| 对象                          | 所有权与职责                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------ |
| `ComputeShader`               | Direct WGSL source、entry point、显式 binding ABI、workgroup metadata                            |
| `ComputeKernel`               | 不可变 shader、pipeline constants 和 binding shape；可跨帧复用但不跨 Renderer 持有 GPU 对象      |
| `ComputeRenderPass`           | 稳定高层 pass；setup 声明 access，prepare 解析并缓存，execute 只 dispatch                        |
| `ComputeRenderPassParameters` | frame-scoped graph handle、offset/range、direct/indirect dispatch 数字                           |
| `StorageGraphicsShader`       | WebGPU-only GLSL ES 3.10 vertex/fragment source、storage reflection 和 vertex pulling ABI        |
| `GPUDrivenRenderPass`         | graph storage/vertex/index/indirect input、raster attachments 和 direct/indirect procedural draw |
| `StorageBuffer`               | renderer-owned 稳定公共 identity；管理 CPU 写入、readback、销毁和恢复策略                        |
| `RenderGraphBufferHandle`     | 只在一次同步 pipeline record invocation 内有效的逻辑资源 identity                                |

`ComputeKernel` 在使用体验上类似“compute
material”，但实现上只复用 Material 背后的 shader、layout、bind group、pipeline
cache 和 registry 基础设施，不复用其类型层级或 raster 状态。`GPUDrivenRenderPass`
仍然是 raster，因此继续组合一个普通 `Material`
表达 blend/depth/cull 状态；它不会把 dispatch 状态放进 Material。

### 4.2 资源所有权

- `ComputeShader` 和 `ComputeKernel` 是后端中立的 CPU 配置对象，可被多个 renderer 的 runtime 引用。
- `StorageBuffer` 由创建它的 Renderer 拥有，不能导入另一 Renderer，也不能在 WebGL 2
  Renderer 上创建。
- transient graph buffer/texture 由 Render Graph 管理。
- persistent graph buffer/texture 由 pipeline runtime owner key 和 Renderer registry 管理。
- concrete RHI resource、pipeline 和 bind group 只能存在于 renderer-local cache/registry。
- graph handle、prepare context 和 execute context 都不能跨 invocation 保存。

## 5. 公共 API 目标

以下签名用于固定语义和评审边界；实现时可以在不改变语义的前提下微调命名，但不能减少验证、所有权或恢复合同。

### 5.1 StorageBuffer

```ts
export type StorageBufferUsage = 'storage' | 'copy-source' | 'copy-destination' | 'indirect';

export type StorageBufferRecoveryPolicy = 'cpu-shadow' | 'reinitialize';

export interface StorageBufferDescriptor {
    readonly label?: string;
    readonly byteLength: number;
    readonly usage: readonly StorageBufferUsage[];
    readonly initialData?: ArrayBuffer | ArrayBufferView;
    readonly recovery?: StorageBufferRecoveryPolicy;
}

export interface StorageBufferRange {
    readonly buffer: StorageBuffer;
    readonly byteOffset: number;
    readonly byteLength: number;
}

export interface StorageBufferReadback {
    readonly data: Uint8Array;
    readonly byteOffset: number;
    readonly byteLength: number;
}

export interface StorageBuffer {
    readonly label: string;
    readonly byteLength: number;
    readonly usage: ReadonlySet<StorageBufferUsage>;
    readonly recovery: StorageBufferRecoveryPolicy;
    readonly isDestroyed: boolean;
    write(byteOffset: number, data: ArrayBufferView): void;
    range(byteOffset: number, byteLength: number): StorageBufferRange;
    read(byteOffset?: number, byteLength?: number): Promise<StorageBufferReadback>;
    destroy(): void;
}
```

创建入口属于 Renderer：

```ts
const buffer = renderer.createStorageBuffer({
    label: 'particles',
    byteLength: particleCount * particleStride,
    usage: ['storage', 'copy-source', 'copy-destination'],
    initialData,
    recovery: 'reinitialize'
});
```

约束：

- `byteLength`、initial data、write/read range 和 binding range 必须是安全整数并满足 RHI 对齐。
- `usage` 在创建后不可增加；graph import 会验证声明的用途是其子集。
- `write()` 只更新 CPU shadow 和待上传 revision；上传在下一次相关 frame 中进入统一 upload batch。
- `read()` 通过 graph copy 到 MAP_READ staging buffer，等待 submission 后 map，不阻塞同步 record。
- `destroy()` 只终止逻辑使用；native allocation 仍由 submission fence 延迟释放。
- `cpu-shadow` 恢复最新 CPU 写入快照，不声称保留后续 GPU 写入。
- `reinitialize` 在 device loss 后把内容标记为未初始化，必须由完整写入 pass 重新建立后才能读取。

### 5.2 Storage 数据布局

Direct WGSL compute 使用 WGSL host-shareable address-space layout，不能继续把它泛称为 std430。
`UniformBuffer` 仍保持现有 std140 ABI；StorageBuffer 使用独立布局合同。

首个公开版本应同时提供一个后端中立的 `StorageLayout` helper：

- 支持 `i32/u32/f32`、向量、矩阵、定长数组、嵌套 struct 和 CPU 已知长度的 storage array；
- 按 WGSL storage address space 的 alignment、size 和 array stride 计算；
- `bool` 不作为 host-shareable 存储字段；
- `f16` 只有在明确 capability 和 shader feature 启用时才可使用；
- atomic 字段的 CPU 表示限定为对应的 `i32/u32` bytes，原子语义只发生在 shader 中；
- 提供 allocation-free `writeInto()` 与字段 offset 查询；
- 可以作为 `StorageBufferDescriptor.initialData` 的构造辅助，但 raw bytes 始终是底层正式合同。

不得复用 `Std140Layout`、添加“近似 std430”分支，或让同一 layout 根据 backend 改变字节结果。

### 5.3 公共 graph buffer

```ts
export type RenderGraphBufferHandle = number & {
    readonly __renderGraphBufferHandle: unique symbol;
};

export interface RenderPipelineBufferDescriptor {
    readonly label?: string;
    readonly byteLength: number;
}

export type RenderGraphBufferReadUse = 'storage' | 'vertex' | 'index' | 'copy-source' | 'indirect';
export type RenderGraphBufferWriteUse = 'storage' | 'copy-destination';

export interface ScriptableRenderGraph {
    createBuffer(
        name: string,
        descriptor: Readonly<RenderPipelineBufferDescriptor>
    ): RenderGraphBufferHandle;
    importStorageBuffer(buffer: StorageBuffer): RenderGraphBufferHandle;
    acquirePersistentBuffer(
        key: object,
        descriptor: Readonly<RenderPipelineBufferDescriptor>
    ): RenderGraphBufferHandle;
    releasePersistentBuffer(key: object): boolean;
}

export interface ScriptableRenderPassBuilder {
    readBuffer(buffer: RenderGraphBufferHandle, use: RenderGraphBufferReadUse): void;
    writeBuffer(buffer: RenderGraphBufferHandle, use: RenderGraphBufferWriteUse): void;
    readWriteBuffer(buffer: RenderGraphBufferHandle): void;
    copyBuffer(source: RenderGraphBufferHandle, destination: RenderGraphBufferHandle): void;
    clearBuffer(buffer: RenderGraphBufferHandle, byteOffset?: number, byteLength?: number): void;
    writeStorageTexture(texture: RenderGraphTextureHandle): void;
}
```

transient descriptor 不接受 native usage bit。Graph 根据存活 pass 声明汇总 `STORAGE`、`COPY_SRC`、
`COPY_DST`、`VERTEX`、`INDEX`、`INDIRECT` 和 `STORAGE_BINDING`；imported
resource 必须在 compile/prepare 前验证 usage superset。`clearBuffer()` 是一个 write access，并要求
`COPY_DST`；它映射WebGPU buffer clear，不通过上传一个同尺寸零数组实现。

### 5.4 ComputeShader 与显式 binding ABI

```ts
export type ShaderReadBinding =
    | Readonly<{
          name: string;
          group: number;
          binding: number;
          kind: 'uniform-buffer' | 'read-only-storage-buffer';
          minBindingSize?: number;
          dynamicOffset?: boolean;
      }>
    | Readonly<{
          name: string;
          group: number;
          binding: number;
          kind: 'sampled-texture';
          sampleType: 'float' | 'unfilterable-float' | 'depth' | 'sint' | 'uint';
          viewDimension?: '2d' | '2d-array' | '3d' | 'cube';
      }>
    | Readonly<{
          name: string;
          group: number;
          binding: number;
          kind: 'sampler' | 'comparison-sampler';
      }>;

export type ComputeShaderBinding =
    | ShaderReadBinding
    | Readonly<{
          name: string;
          group: number;
          binding: number;
          kind: 'storage-buffer';
          minBindingSize?: number;
          dynamicOffset?: boolean;
      }>
    | Readonly<{
          name: string;
          group: number;
          binding: number;
          kind: 'storage-texture';
          access: 'write-only';
          format: RenderTargetColorFormat;
          viewDimension?: '2d' | '2d-array' | '3d';
      }>;

export interface ComputeShaderDescriptor {
    readonly label?: string;
    readonly source: string;
    readonly entryPoint?: string;
    readonly workgroupSize: readonly [number, number?, number?];
    readonly bindings: readonly ComputeShaderBinding[];
}

export class ComputeShader {
    constructor(descriptor: Readonly<ComputeShaderDescriptor>);
}
```

binding descriptor 是 Hilo3D 的显式 pipeline ABI，不依赖 WebGPU auto
layout，也不允许运行时从字符串 map 猜测资源。WGSL source 与 descriptor 不一致时必须在 kernel
prepare、RHI pipeline creation 或真实 WebGPU validation 中失败，且发生在 RHI frame 开始前。

### 5.5 ComputeKernel 与 ComputeRenderPass

```ts
export interface ComputeKernelDescriptor {
    readonly label?: string;
    readonly shader: ComputeShader;
    readonly constants?: Readonly<Record<string, number | boolean>>;
}

export class ComputeKernel {
    constructor(descriptor: Readonly<ComputeKernelDescriptor>);
}

export interface ComputeBufferBinding {
    readonly buffer: RenderGraphBufferHandle;
    readonly byteOffset?: number;
    readonly byteLength?: number;
}

export interface ComputeTextureBinding {
    readonly texture: RenderGraphTextureHandle;
}

export type ComputeDispatch =
    | Readonly<{ x: number; y?: number; z?: number }>
    | Readonly<{
          indirectBuffer: RenderGraphBufferHandle;
          indirectOffset?: number;
      }>;

export interface ComputeRenderPassParameters {
    readonly buffers: readonly ComputeBufferBinding[];
    readonly textures: readonly ComputeTextureBinding[];
    readonly dispatch: ComputeDispatch;
}

export class ComputeRenderPass implements ScriptableRenderPass<ComputeRenderPassParameters> {
    constructor(kernel: ComputeKernel, name?: string);
}
```

规则：

- binding array 顺序在 kernel 构造时由 `(group, binding)` 固定，不能每帧按名称查找。
- `setup` 根据 shader binding kind 自动声明 graph access；用户不能把 WGSL writable
  binding 声明成 read。
- `prepare` 解析 graph resource，创建或复用 shader、layout、bind group 和 pipeline。
- `execute` 只设置 pipeline/bind group 并 direct/indirect dispatch。
- 参数来自 `RenderPassParameterPool`；数组容量和 descriptor storage 高水位复用。
- pipeline constants 冻结在 kernel 上并进入结构化 cache key，不允许逐帧变更导致 pipeline churn。

### 5.6 Storage-aware graphics 与 GPUDrivenRenderPass

Forward+ 的 fragment lighting、高斯泼溅的 vertex pulling 和 GPU 粒子渲染都需要 graphics
stage 读取 compute 产生的 storage buffer。只支持“compute 写 texture、graphics sampled
texture”不足以形成合理的现代 GPU-driven rendering 底座。

新增一个与现有双后端 `Shader` 分离的 WebGPU-only graphics source contract：

```ts
export interface StorageGraphicsShaderDescriptor {
    readonly label?: string;
    readonly vertexSource: string;
    readonly fragmentSource: string;
    readonly bindings: readonly ShaderReadBinding[];
}

export class StorageGraphicsShader {
    constructor(descriptor: Readonly<StorageGraphicsShaderDescriptor>);
}
```

它使用 GLSL ES 3.10 storage block subset 作为唯一源码，经 engine preprocessing、Vulkan GLSL
4.50 和 Naga 生成 WGSL。只允许 vertex/fragment `readonly buffer`；graphics stage 首版不能写 storage
buffer，避免把 raster side effect、片元执行次数和 graph write 语义混在一起。现有 GLSL ES 3.00
`ShaderMaterial` 和内置双后端材质不改变。

通用 compute-driven raster pass 形态：

```ts
export type GPUDrivenDraw =
    | Readonly<{
          kind: 'draw';
          vertexCount: number;
          instanceCount?: number;
          firstVertex?: number;
          firstInstance?: number;
      }>
    | Readonly<{
          kind: 'draw-indirect';
          buffer: RenderGraphBufferHandle;
          byteOffset?: number;
      }>
    | Readonly<{
          kind: 'draw-indexed-indirect';
          buffer: RenderGraphBufferHandle;
          byteOffset?: number;
      }>;

export interface GPUDrivenVertexAttribute {
    readonly shaderLocation: number;
    readonly format: GPUDrivenVertexFormat;
    readonly byteOffset: number;
}

export interface GPUDrivenVertexBufferLayout {
    readonly arrayStride: number;
    readonly stepMode?: 'vertex' | 'instance';
    readonly attributes: readonly GPUDrivenVertexAttribute[];
}

export interface GPUDrivenRenderPassOptions {
    readonly name?: string;
    readonly shader: StorageGraphicsShader;
    readonly material: Material;
    readonly vertexLayouts?: readonly GPUDrivenVertexBufferLayout[];
    readonly indexFormat?: 'uint16' | 'uint32';
}

export interface GPUDrivenRenderPassParameters {
    readonly buffers: readonly ComputeBufferBinding[];
    readonly vertexBuffers?: readonly ComputeBufferBinding[];
    readonly indexBuffer?: ComputeBufferBinding;
    readonly draw: GPUDrivenDraw;
    readonly colorAttachments: readonly Readonly<RenderPipelineColorAttachment>[];
    readonly depthStencilAttachment?: Readonly<RenderPipelineDepthStencilAttachment>;
    readonly viewport?: RendererViewport;
    readonly scissor?: RendererViewport;
}

export class GPUDrivenRenderPass implements ScriptableRenderPass<GPUDrivenRenderPassParameters> {
    constructor(options: Readonly<GPUDrivenRenderPassOptions>);
}
```

`GPUDrivenVertexFormat` 是公开的严格 union，覆盖 portable RHI 已支持的 vertex formats，但不会把 RHI
namespace 或 native `GPUVertexFormat` 暴露到公共 API。

规则：

- storage buffer 作为 vertex pulling 输入时声明 storage read；真正的 vertex/index input 分别声明
  `vertex`/`index` read。
- vertex layout 和 index format 固定在 pass options 中并进入 pipeline key；只使用 vertex pulling 时
  `vertexLayouts` 可以为空。
- indirect args 声明 `indirect` read，必须由前序 compute/copy/clear pass 初始化。
- baseline indirect args 的 `firstInstance` 必须为
  `0`；非零值只有在后续独立 capability 明确覆盖 adapter 的 `indirect-first-instance`
  feature 后才能开放，不能由 `indirect-draw` 暗示支持。
- direct/indirect draw 都使用同一个 prepared graphics pipeline 和 attachment validation。
- `Material` 只提供 raster state；storage binding 和 graph handle 属于 pass 参数。
- `SceneRenderPass` 另外增加 pass-global readonly storage bindings，供 Forward+ 的 mesh/PBR
  draw 共用；这些 binding 在 shared
  MeshDrawProcessor 中准备，不为每个 mesh 创建独立 buffer 或 layout。
- graphics storage ABI 与 compute storage ABI 共用 reflection、range、alignment 和 bind-group
  cache 基础设施。
- 首版不要求 multi-draw indirect；一个或少量 indirect
  draw 足以覆盖粒子和高斯泼溅基线，Forward+ 继续由 renderer list 发出普通 indexed draw。

## 6. Direct WGSL Compute 合同

### 6.1 为什么不走 GLSL 转换

WebGL 2 没有 compute shader 或 SSBO，GLSL ES
3.00 也不能表达 compute/storage。为一个只会在 WebGPU 执行的 stage 设计 GLSL ES 3.10/私有 Vulkan
GLSL 方言，会增加：

- 第二套 compute-specific preprocessor 语法；
- storage block layout 重写；
- GLSL→WGSL 语义差异和额外错误层；
- 无法由 WebGL 2 compile/link 提供的虚假“跨后端验证”。

Direct WGSL 在这里不是 graphics shader 镜像，而是 WebGPU-only
Compute 的唯一源码，因此不会产生同一功能的 GLSL/WGSL 双树。

### 6.2 为什么仍保留 Naga

“不走 GLSL 转换”不等于“只交给浏览器运行时碰运气”。当前 `web-naga` 提供 WGSL frontend，compute
compiler 必须：

1. 在 Renderer 初始化的既有 Naga 异步边界内加载 WASM；
2. 使用 `WgslFrontend.parse(source)` 验证语法和 WGSL 模块；
3. 可选地用 Naga 输出规范化 WGSL 作为缓存 artifact，但不得改变公开 source identity；
4. 保留原始 source、entry point、kernel label 和 Naga cause 形成结构化错误；
5. 再由真实 WebGPU `createComputePipeline` 验证显式 layout、override constants 和设备 limits。

Naga 当前不导出完整结构化 reflection，因此首版使用显式 `ComputeShaderBinding[]` 作为 engine
ABI。禁止用正则解析任意 WGSL 来伪造 reflection；如果未来 Naga
binding 提供可靠 reflection，可在不改变公共 ABI 的情况下增加一致性校验。

### 6.3 静态规则调整

实现版本必须同步修改 `AGENTS.md`、`check:modernity` 和工程文档：

- `@compute` 只允许出现在 ComputeShader 专用源目录或受检查的 tagged source 中；
- compute 通道中的 `@vertex`、`@fragment` 继续禁止；
- `src/shader`、material、scene/fullscreen、present、mipmap 等 raster shader 仍禁止手写 WGSL；
- GLSL ES 3.10 只允许出现在 `StorageGraphicsShader` 专用路径，并必须静态关联 `storage-buffer`
  requirement；普通 Shader/ShaderMaterial 仍只接受 GLSL ES 3.00；
- 不开放任意 `.wgsl` deep import；package 只导出结构化 `ComputeShader` API；
- 静态测试必须包含允许的 compute/GLSL ES 3.10 storage graphics 正例，以及 graphics
  WGSL、普通 Shader 中的 ES 3.10、越界路径、未校验 raw source 的负例。

## 7. RHI Core 设计

### 7.1 Stage、capability 与 limits

增加：

```ts
RHIShaderStage.COMPUTE;
RHIShaderStageName = 'vertex' | 'fragment' | 'compute';
```

WebGPU RHI 在完整实现后报告 `compute-pipelines`。`RHILimits` 补齐：

- `maxDynamicStorageBuffersPerPipelineLayout`
- `maxComputeWorkgroupStorageSize`
- `maxComputeInvocationsPerWorkgroup`
- `maxComputeWorkgroupSizeX/Y/Z`
- `maxComputeWorkgroupsPerDimension`

可选 limit 不得用零同时表示“不支持”和“未知”；WebGL 2 保持 `undefined`/feature false，公共 pipeline
capability 再映射成确定性的 false。

`storage-buffers` 的完成语义同时覆盖 vertex、fragment 和 compute visibility。Pipeline-layout
validation 必须分别统计三个 stage 的 storage binding 数；不能只让 compute stage 通过而 graphics
compiler 继续拒绝。

### 7.2 Compute pipeline

```ts
export interface RHIComputeState {
    readonly shader: RHIShader;
    readonly constants?: Readonly<Record<string, number | boolean>>;
}

export interface RHIComputePipelineDescriptor extends RHIResourceDescriptorBase {
    readonly layout: RHIPipelineLayout;
    readonly compute: RHIComputeState;
}

export interface RHIComputePipeline extends RHIResource {
    readonly layout: RHIPipelineLayout;
    readonly descriptor: Readonly<RHIComputePipelineDescriptor>;
}
```

`RHIDevice` 增加 `createComputePipeline()`。Shader artifact 继续包含 backend-neutral
reflection；WebGPU artifact 的 code 是经过 Naga WGSL frontend 验证的 WGSL，WebGL 2 不能创建 compute
shader。

### 7.3 Compute pass 与 dispatch

```ts
export interface RHIComputePassDescriptor {
    readonly label?: string;
}

export interface RHIComputePassEncoder extends RHIDeviceOwnedObject {
    readonly contextId: number;
    readonly state: 'open' | 'ended' | 'aborted';
    setPipeline(pipeline: RHIComputePipeline): void;
    setBindGroup(index: number, bindGroup: RHIBindGroup, dynamicOffsets?: RHIUInt32View): void;
    dispatchWorkgroups(x: number, y?: number, z?: number): void;
    dispatchWorkgroupsIndirect(buffer: RHIBuffer, offset?: number): void;
    end(): void;
}
```

`RHICommandContextState` 增加 `compute-pass`，`RHICommandContext` 增加
`beginComputePass()`。一个 context 同一时刻只能打开一个 render 或 compute
pass；copy/write 只能在 pass 外执行。abort 必须关闭 native pass、释放 pass
storage，并保留原始失败原因。

为 compute-driven raster 同时补齐：

```ts
interface RHICommandContext {
    clearBuffer(buffer: RHIBuffer, offset?: number, size?: number): void;
}

interface RHIRenderPassEncoder {
    drawIndirect(buffer: RHIBuffer, offset?: number): void;
    drawIndexedIndirect(buffer: RHIBuffer, offset?: number): void;
}
```

`clearBuffer` 在 pass 外编码；draw indirect 只能在 render pass 内编码。三者都必须进入 command
diagnostics、resource retention 和 portable state validation。

### 7.4 Validation

portable validation 必须覆盖：

- shader stage、pipeline kind 和 layout visibility 一致；
- storage feature、binding type、min size、offset/range 和 dynamic alignment；
- compute stage 的每类 binding 数量与 pipeline-layout dynamic storage 数量；
- workgroup size 各维、总 invocation 数和 workgroup storage；
- direct dispatch 各维是非零安全整数且不超过 `maxComputeWorkgroupsPerDimension`；
- indirect buffer 具有 `INDIRECT` usage，offset 4-byte 对齐且 12 bytes 范围有效；
- draw indirect 参数范围至少 16 bytes，draw-indexed indirect 至少 20
  bytes；对应字段和 offset 按 WebGPU 合同校验，不从 CPU 读取参数内容；
- graph vertex/index/indirect buffer 的 RHI usage 与实际 render-pass command 匹配；
- clear range 4-byte 对齐、非空、在 buffer 内，并具有 `COPY_DST` usage；
- storage texture format 支持 storage、sample count 为 1、view dimension/access 与 shader ABI 一致；
- destroyed、wrong-device、old-generation resource 和 incompatible layout；
- compute pass 状态、重复 end、frame end 时 pass 未关闭；
- shader reflection binding 与 explicit layout 一一匹配，不忽略多余 binding。

所有可在 portable 层发现的错误都必须在 native call 前失败。

### 7.5 Diagnostics

`RHIFrameDiagnostics` 增加：

- `dispatchCount`
- `computePipelineSwitches`
- `computeBindGroupSwitches`
- `dispatchedWorkgroupCount`
- `indirectDrawCount`
- `bufferClearCount`

direct dispatch 可精确累计 workgroup；indirect dispatch 只累计 dispatch 次数，不能通过 CPU 猜测 GPU
buffer 中的 workgroup 数。所有 backend、fake、frame reset 和公开诊断快照必须同步更新。

## 8. Render Graph 资源与 hazard

### 8.1 Access 语义

Graph 不只记录“读集合/写集合”，还要记录用途和读写语义。Buffer access 至少包含：

| Access             | 内容依赖         | 新内容版本 | RHI usage  |
| ------------------ | ---------------- | ---------- | ---------- |
| storage read       | 是               | 否         | `STORAGE`  |
| storage write      | 否，声明完整覆盖 | 是         | `STORAGE`  |
| storage read-write | 是               | 是         | `STORAGE`  |
| vertex input       | 是               | 否         | `VERTEX`   |
| index input        | 是               | 否         | `INDEX`    |
| copy source        | 是               | 否         | `COPY_SRC` |
| copy destination   | 否，完整 copy 时 | 是         | `COPY_DST` |
| clear              | 否，覆盖声明范围 | 是         | `COPY_DST` |
| indirect           | 是               | 否         | `INDIRECT` |

“write 不依赖旧内容”必须是真实合同。部分写入、atomic、append/counter 或 WGSL `read_write`
binding 必须使用 `readWriteBuffer()`，不能谎报为 write 来规避初始化检查。

### 8.2 同 pass read-write

现有的同 pass read/write 拒绝继续作为默认规则，但为 storage buffer 增加一个窄化例外：

- 只能通过单个 `readWriteBuffer()` 声明；
- 不能再对同一 handle 调用 `readBuffer()` 或 `writeBuffer()`；
- 编译器从前一 writer 建 RAW 边，并把当前 pass 设为新的 writer；
- buffer 在 pass 前必须有已初始化内容；
- shader binding 必须是 `storage-buffer`，不能是 read-only；
- 同一 logical buffer 的重叠 range 首版按整 buffer
  hazard 处理，先保证正确性；未来才能增加 range-aware hazard。

storage texture 首版只支持 write-only binding。要读取旧纹理应绑定独立 sampled
texture；同一 subresource sampled/write feedback 继续拒绝，不插入隐式 copy。

### 8.3 Hazard 与拓扑

同一资源跨 raster、copy、compute pass 的规则统一：

| 前序                                  | 后序                                  | 依赖 |
| ------------------------------------- | ------------------------------------- | ---- |
| write/read-write/clear                | read/vertex/index/indirect/read-write | RAW  |
| read/vertex/index/indirect/read-write | write/read-write/clear                | WAR  |
| write/read-write/clear                | write/read-write/clear                | WAW  |

WebGPU 在同一 command encoder 中按 pass 顺序提供必要的可见性；上层不暴露 barrier。Render
Graph 仍需生成正确顺序、拒绝未初始化读取、裁掉无效 pass，并让 transient
lifetime 覆盖最后一个真实消费者。

### 8.4 Prepare 与 execute

- setup 只声明 handle、access、dispatch source 和 side effect，不创建 GPU 对象。
- compile 完成 capability、descriptor、hazard、初始化、循环和 pass-culling 验证。
- prepare 解析存活资源并创建/复用 layout、bind group、compute/graphics pipeline、vertex
  input 和 indirect draw plan；不得发命令。
- execute 获取同一 `RHICommandContext`，按编译顺序交错 render/copy/compute pass。
- pipeline/bind group/revision 只在有效 submission 后提交；失败帧回滚 pending cache state。

## 9. WebGPU backend

### 9.1 Capabilities

Compute 是 WebGPU core execution model，不应伪装成 requestable `GPUFeatureName`。WebGPU
backend 在实现闭环后：

- 报告 `compute-pipelines`；
- 从 `GPUSupportedLimits` 快照全部 compute/storage limits；
- storage texture 仍逐 format 查询，不能用一个全局 bool 代替；
- adapter probe 校验 pipeline required limits，但不为 compute 请求不存在的 native feature。

### 9.2 Pipeline 与 command mapping

- `RHIComputePipeline` 一跳映射 `GPUComputePipeline`。
- 显式 `RHIPipelineLayout` 一跳映射 `GPUPipelineLayout`；不使用 auto layout。
- `RHIComputePassEncoder` 一跳映射 `GPUComputePassEncoder`。
- direct/indirect dispatch 一跳映射对应 WebGPU command。
- graphics readonly storage binding 继续使用同一 bind-group layout 映射，并允许 vertex/fragment
  visibility。
- `clearBuffer`、`drawIndirect`、`drawIndexedIndirect` 一跳映射对应 WebGPU command。
- pipeline、layout、bind group、buffer、texture/view 被 frame strong-reference
  storage 保留到 submission settle。
- compute pass storage 和 descriptor snapshot 使用 queue 高水位池，不逐 dispatch 分配。

### 9.3 Shader artifact

Compute WGSL 只在 shared compiler 经过 Naga 验证后形成 `RHIWebGPUShaderArtifact`。Storage-aware
graphics 则由 shared GLSL ES 3.10 → Vulkan GLSL 4.50 →
Naga 路径产生相同 artifact。Backend 只创建 native shader module，不再解析 engine
binding、猜测 access 或改写 source。

## 10. WebGL 2 fail-closed

WebGL 2 的行为是正式合同，不是暂时缺实现：

- `storage-buffers`、`storage-textures`、`compute-pipelines` feature 为 false；
- 对应 limits 不存在；format `storage` 为 false；
- `createStorageBuffer()` 在 Renderer capability validation 阶段失败；
- RHI `createComputePipeline()`、compute shader、storage binding、storage
  texture 和 dispatch 在 native GL 调用前抛 `unsupported-feature`；
- storage-aware graphics shader、draw indirect 和 indexed draw indirect 同样 fail-closed；buffer
  clear 可以继续作为独立 portable copy 操作实现，但不能被用来暗示 compute/indirect draw 支持；
- 不创建 texture-backed SSBO、transform-feedback kernel、fragment-shader compute 或 CPU fallback；
- 不在帧中检查 `renderer.backend` 后静默跳过 pass。

需要双后端功能时，应用在 Renderer 创建前选择 compute pipeline factory 或独立 graphics fallback
factory。

## 11. Cache、上传与资源生命周期

### 11.1 StorageBufferResourceCache

新增独立 cache，不把 `BufferResourceCache` 的 `vertex | index | uniform`
union 直接扩成包含所有 compute 语义的大类。它负责：

- `StorageBuffer` → registry handle 的 renderer-local 映射；
- immutable usage/size/recovery recipe；
- CPU write revision、bounded dirty ranges 和 4-byte 对齐 staging snapshot；
- 扩容策略；StorageBuffer 公共 size 不变时不得静默换逻辑长度；
- upload batch prepare/commit/rollback；
- submission use tracking和延迟释放；
- device generation 变化后的 recipe 重建与 revision 同步。

### 11.2 Compute resource caches

新增或从现有 cache 抽取共享基础：

- `ComputeShaderArtifactCompiler`
- `ComputeShaderResourceCache`
- `ComputeBindingLayoutCompiler`
- `ComputeBindGroupResourceCache`
- `ComputePipelineResourceCache`
- `StorageGraphicsShaderArtifactCompiler`
- `GPUDrivenPipelineResourceCache`

cache key 必须是有界结构化数据并做精确碰撞校验，至少包含：

- ComputeShader identity/source revision；
- entry point；
- binding ABI；
- pipeline constants；
- graphics shader pair、raster state、vertex/index layout 和 direct/indirect draw kind；
- resource handle generation、offset、range 和 texture view identity；
- device generation。

禁止逐帧 stringify 大对象、遍历任意字符串 map 或把 native object identity 暴露到 shared renderer。

### 11.3 Persistent resource transaction

`acquirePersistentBuffer()`/`releasePersistentBuffer()` 复用 persistent target 的事务语义：

- descriptor 改变时创建 pending replacement；
- 成功 submission 后才提交 replacement/release；
- record、compile、prepare、execute 或 submit 失败时回滚；
- active frame 已 acquire 的 key 不能在同一 frame 后续 release；
- runtime destroy 释放其 owner 下所有 buffer、texture、pipeline 和 bind group recipe。

## 12. Device loss 与内容恢复

资源对象 identity 可以恢复，GPU-only 内容不能凭空恢复。实现必须区分：

### 12.1 `cpu-shadow`

- registry recipe 用最新已提交 CPU write snapshot 重建 buffer；
- GPU 对 buffer 的写入不会自动同步回 CPU；
- device loss 后这些 GPU 写入丢失，恢复到 CPU shadow 内容；
- 适合静态输入、CPU 驱动数据和可接受重算的缓存。

### 12.2 `reinitialize`

- 重建设备对象，但逻辑内容状态变为 unavailable；
- 下一帧必须先有完整 write/read-write initialization pass；
- graph 在重新初始化完成前拒绝 read、indirect 或 partial read-write；
- 适合粒子、GPU simulation、counter、prefix sum 中间状态。

### 12.3 Readback checkpoint

显式 `StorageBuffer.read()` 只返回快照，不默认把结果变成恢复源。若以后增加 checkpoint
API，必须是显式、异步且计入 copy/map 成本的独立功能，不能在每帧隐藏 readback。

replacement device 还必须是 capability/limit/format superset。恢复失败保持现有 renderer
recovery-failed 合同，不关闭 compute 后继续渲染低能力路径。

## 13. Capability、后端选择与降级

### 13.1 公共 capability

```ts
type RenderPipelineCapabilityName =
    'storage-buffer' | 'storage-texture' | 'compute-pass' | 'indirect-draw';
```

映射条件：

- `storage-buffer`：公共资源、graph access、vertex/fragment/compute binding compiler、RHI 和 WebGPU
  backend 全部可用。
- `compute-pass`：`storage-buffer` 加 Direct WGSL compiler、compute
  pipeline/pass/dispatch 全部可用。
- `storage-texture`：compute pass 可用，并至少存在一个公开格式通过 format-specific storage 检查。
- `indirect-draw`：graph indirect access、RHI draw/drawIndexed
  indirect 和 GPUDrivenRenderPass 全部可用。

同时扩展 `RenderPipelineLimits` 和
`supportsTextureFormat(format, 'storage')`，使 factory 能在 runtime 创建前声明 workgroup、binding 和具体 storage
format 需求。

### 13.2 创建前选择

`Renderer.create()` 必须在 backend selection 前读取冻结的 pipeline requirements：

- required compute/storage capability 会从 `auto` 候选中排除 WebGL 2；
- WebGPU adapter 不存在、limits 不足或格式不满足时返回“无兼容 backend”；
- `preserveDrawingBuffer` 等强制 WebGL 2 的选项与 compute requirement 同时出现时直接报告配置冲突；
- 显式 WebGL 2 + compute requirement 在创建 runtime 或 RHI frame 前失败；
- 显式 WebGPU 不做 fallback；初始化、Naga、pipeline 或恢复失败均向调用方传播。

### 13.3 可选效果

可选 compute 效果必须在冷路径选择两份预编译配置：

```text
WebGPU + capability satisfied -> ComputeFeatureFactory
otherwise                    -> GraphicsFallbackFeatureFactory
```

不能在逐 dispatch/draw 热路径查询 backend，也不能在同一个 pass 内混放 native compute 和 graphics
fallback。

## 14. 性能与现代图形约束

首个版本必须满足：

- 一个 frame 仍只有一个 Render Graph、一个 RHI command context 和一个 submission。
- compute/raster/copy 可交错，但不创建软件 command list 再 replay。
- kernel、shader、pipeline layout 和 binding
  shape 稳定；每帧只变化资源 handle/range 和 dispatch 数字。
- parameter、descriptor、dynamic-offset、pass storage 使用高水位复用。
- 稳态不逐 dispatch 创建数组、对象、closure、字符串 key、pipeline 或 bind-group layout。
- bind group 只有资源 identity/range 变化时才创建或命中 cache；frame-transient 资源遵循 submission
  fence。
- graph compile 复杂度保持 O(pass + resource + dependency)，首版整 buffer hazard 不增加区间树。
- indirect dispatch 不做 CPU readback。
- compute-generated visible count、sort result 和 draw
  args 不回读 CPU；GPUDrivenRenderPass 直接 indirect draw。
- 高斯泼溅/粒子使用 vertex pulling 或 compact vertex
  buffer，不为每个元素创建 Mesh、Material、Geometry 或 JavaScript draw record。
- 默认 Forward pipeline 在不使用 compute 时不得增加逐 draw 分支或分配。
- benchmark 必须同时记录 CPU record/prepare/execute、native object count、dispatch count、GPU
  timing（可用时）和 steady-state allocation。

async
compute、多 queue 和用户 barrier 不属于“现代”的必要条件；在浏览器 WebGPU 中，先保证显式资源、正确 hazard、低分配和稳定 pipeline/cache 比模拟桌面 Vulkan 调度模型更重要。

## 15. 目标场景闭环

Compute/Storage 底座的验收不能只做“数组乘二”。以下三个场景用于证明 API 没有把关键能力留到 native
bypass 或 CPU 同步中。

### 15.1 Forward+

目标数据流：

```text
Scene depth prepass
        │
        ▼
optional depth min/max or hierarchy compute
        │
        ▼
tile/cluster light culling compute
 light buffer + depth -> grid + index list + counters
        │
        ▼
SceneRenderPass / PBR fragment shader
 readonly storage: lights + grid + index list
        │
        ▼
color output
```

底座必须提供：

- depth texture sampled by compute；
- readonly light input、read-write counters、grid/index output；
- buffer clear、atomics、workgroup memory 和多 compute pass；
- fragment-stage readonly storage buffer；
- pass-global storage bindings，所有 mesh draw 共享同一 light grid/list；
- compute write → fragment read 的 RAW edge；
- capability requirement 在 Renderer 创建前排除 WebGL 2。

Forward+ feature 可以继续复用现有 culling、renderer list、mesh preparation、PBR
material 和 attachments；它只替换灯光分配及对应 lighting shader variant，不建立第二套 scene
renderer。WebGL 2 fallback 是创建前选择的传统 forward feature，不在同一帧查询 backend。

### 15.2 高斯泼溅

目标数据流：

```text
persistent splat attributes
        │
        ▼
project + frustum/screen cull compute
        │
        ▼
prefix/compact + depth key generation
        │
        ▼
GPU radix/tile sort（多 pass、ping-pong/read-write buffer）
        │
        ├──> indirect draw args
        ▼
GPUDrivenRenderPass
vertex pulling: sorted index + splat attributes
procedural quad + alpha blend + depth policy
```

底座必须提供：

- 大型 structured StorageBuffer 和 aligned subrange binding；
- 多 kernel pipeline、ping-pong、read-write、clear、atomic 和 indirect dispatch；
- compute 生成的 visible count、sorted index 和 draw args 全程不回读 CPU；
- vertex-stage readonly storage buffer 和 `vertex_index`/`instance_index` procedural expansion；
- draw indirect、blend/depth/cull raster state 和 graph attachments；
- sort/indirect output → vertex/indirect input 的 RAW edge；
- resize、camera change、submission fence 和 device-loss reinitialize。

基础设施不规定全局 radix sort、tile
sort 或 OIT 的具体算法，但必须让这些算法都能只通过公开 kernel/pass/resource 组合实现。验收 fixture 至少执行 cull/compact、两个以上排序或重排 dispatch、GPU-generated
draw args 和一次 indirect blended draw。

### 15.3 GPU 粒子

目标数据流：

```text
particle state + spawn commands
        │
        ▼
simulate / kill / spawn compute
        │
        ▼
compact or alive-index build + draw args
        │
        ▼
GPUDrivenRenderPass
vertex pulling or compact vertex buffer + indirect draw
```

底座必须提供：

- persistent read-write state、free/alive list 和 atomic counters；
- CPU 对 spawn command 的小范围 upload，而不是完整粒子状态回传；
- simulation、collision/sample texture、compaction 和 optional sort 多 pass；
- storage/vertex/indirect usage 组合；
- one/few indirect draw，不为每个粒子创建 Mesh 或 draw packet；
- `reinitialize` recovery 和显式 deterministic seed 测试。

### 15.4 “合理实现”的判定

三个场景都必须满足：

- 无逐帧 GPU→CPU visible-count/sort-result readback；
- 无 texture-backed SSBO、transform-feedback compute 或原生 WebGPU extension bypass；
- 无逐元素 JavaScript 对象和 draw call；
- 所有资源 access 都进入 Render Graph；
- shader/pipeline/bind group 在 prepare 阶段稳定缓存；
- dispatch/draw 只依赖 frame 参数和 graph handle；
- WebGL 2 fallback 是独立 factory/feature，而不是运行时静默降级。

满足这些条件后，这套基础设施可以合理实现 Forward+、高斯泼溅和 GPU 粒子；具体算法、画质策略和平台调优仍属于各 feature 自身，而不是 compute
core 的隐藏职责。

## 16. 内部实施工作包

所有工作包可以独立评审，但在工作包 F 完成前公共 capability 保持 false。

### A. 合同与门禁

- 冻结本文 API/错误/恢复语义。
- 增加 capability 与 limit 的负向测试占位。
- 更新 shader policy 和 `check:modernity` 的受限 Direct WGSL/GLSL ES 3.10 storage graphics 规则。
- 保持 production API 不导出新类型。

### B. Storage resource 与 Render Graph

- 实现 `StorageLayout`、renderer-owned `StorageBuffer`、range、upload、readback 和 recovery policy。
- 公开 graph buffer handle、transient/import/persistent/release/copy/clear。
- 增加 access kind、usage 推导、read-write buffer hazard 和初始化验证。
- 增加 storage/vertex/index/indirect 跨 compute/raster access。
- 补 transient pool、descriptor superset、transaction 和 recovery tests。

### C. Direct WGSL compiler 与 binding ABI

- 新增 `ComputeShader`、Naga WGSL frontend compiler、错误类型和 artifact cache。
- 扩展 RHI reflection 的 storage access、storage texture、workgroup metadata。
- 新增 compute binding-layout compiler，不削弱现有 graphics compiler 的 GLSL/std140 ABI。
- 新增 `StorageGraphicsShader` 的 GLSL ES 3.10 storage subset、graphics storage reflection 和 shared
  binding-layout support。
- 补 WGSL/GLSL ES 3.10 corpus、metadata/layout conflict 和 static policy tests。

### D. RHI 与 WebGPU compute

- 增加 compute stage、limits、pipeline、pass、buffer clear、direct/indirect
  dispatch、draw/drawIndexed indirect、diagnostics 和 validation。
- WebGPU 一跳映射、pass storage、strong reference retention 和 submission lifecycle。
- WebGL 2 negative implementation。
- 扩展 Fake RHI、structured WebGPU mock、architecture allocation guards 和 real adapter fixture。

### E. SRP ComputeKernel/Pass 闭环

- 实现 `ComputeKernel`、`ComputeRenderPass`、参数池和 cache/registry integration。
- 实现 `GPUDrivenRenderPass`、graphics storage binding、graph vertex/index/indirect
  input 和 pass-global SceneRenderPass storage binding。
- 打通 buffer、uniform、sampled texture、sampler、storage texture bindings。
- 打通 compute→compute、compute→sampled/storage-aware raster、readback 和 device-loss
  reinitialize 场景。
- 增加 Forward+、高斯泼溅、GPU 粒子三个确定性验收 fixture 和至少一个用户示例；fixture 不冒充正式性能 baseline。

### F. 原子开放与发布证据

- 把 WebGPU RHI feature 和公共 SRP capability 改为 true。
- 把 required capability 纳入 `auto` backend probe。
- 更新根 barrel、TSDoc、CHANGELOG、API report、类型消费和 package exports。
- 跑完整验证、WebGPU 浏览器矩阵、真实 pipeline/readback、恢复和性能 baseline。
- 只有全部验收通过才合并公开入口；否则回退 capability flip，而不是保留半支持状态。

## 17. 主要代码落点

| 领域                  | 主要文件/目录                                                                                                                 |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| RHI types/capability  | `src/render/rhi/core/RHITypes.ts`、`RHICapabilities.ts`、`RHIResources.ts`                                                    |
| RHI pipeline/commands | `src/render/rhi/core/RHIPipeline.ts`、`RHICommands.ts`、`RHIValidation.ts`                                                    |
| WebGPU                | `src/render/rhi/backends/webgpu/` 下 capabilities、device、pipeline、commands、queue                                          |
| WebGL 2 negative path | `src/render/rhi/backends/webgl2/` 下 capabilities、device、validation-facing methods                                          |
| Graph                 | `src/render/graph/RenderGraphResource.ts`、builder、compiler、executor、transient pool                                        |
| Public SRP            | `src/render/pipeline/RenderPipeline.ts`、`ScriptableRenderGraph.ts`、compute/GPU-driven `passes/`                             |
| SRP implementation    | `src/render/internal/ScriptableRenderPipelineContext.ts`、`RenderPipelineHost.ts`                                             |
| Shader                | 新 ComputeShader/compiler、StorageGraphicsShader/compiler；现有 `GlslToWgsl.ts` 共享 Naga/GLSL 基础但不承载 compute GLSL 转换 |
| Caches                | `src/render/renderer/` 下 storage buffer、compute shader/binding/pipeline/readback caches                                     |
| Backend selection     | `src/render/internal/RendererFactory.ts`、`SharedRendererDriver.ts`                                                           |
| Public exports        | `src/Hilo3d.ts`、render/pipeline barrels、API report                                                                          |
| Tests                 | `test/spec/rhi/portable/`、renderer/SRP specs、`test/ui/webgpu.spec.ts`、native WebGPU lane                                   |

实现时应优先新增职责清晰的小模块，而不是继续扩大 `GlslToWgsl.ts`、
`ScriptableRenderPipelineContext.ts` 或 `WebGPUCommands.ts`
的单文件复杂度。共享 validation/helper 可以抽取，native 类型仍只能停留在 backend。

## 18. 验证矩阵

### 18.1 单元与结构测试

- StorageLayout 对齐、size、array stride、nested struct、非法 bool/f16/overflow。
- StorageBuffer usage、range、dirty span、partial upload、readback、destroy 和跨 Renderer 拒绝。
- WGSL Naga parse 与 GLSL ES 3.10 storage graphics 正例/负例、entry point、binding ABI、override
  constant。
- RHI shader stage、layout、pipeline、pass state、buffer clear、direct/indirect dispatch/draw
  limits。
- storage buffer/texture feature、format、access、size、offset、dynamic alignment。
- wrong-device、destroyed、old-generation、unclosed pass 和 abort cleanup。
- graph uninitialized read、RAW/WAR/WAW、read-write、storage→vertex/index/indirect、cycle、pass
  culling、lifetime 和 usage superset。
- prepare 前零命令、compile 前零 GPU 副作用、失败 rollback。
- high-water storage 稳态不增长；dispatch 热路径无分配型集合或对象构造。

### 18.2 Backend 测试

- Structured WebGPU mock 精确断言 create shader/layout/pipeline、begin/end
  pass、bind、dispatch 顺序。
- WebGL 2 精确断言在任何 native GL compute/storage 模拟前失败。
- 真实 WebGPU：kernel 写 buffer → copy → map → exact byte comparison。
- 真实 WebGPU：compute 写 storage texture → GLSL fullscreen sampled draw → exact pixel/readback。
- direct 与 indirect dispatch 结果一致。
- compute 写 readonly graphics storage/vertex/indirect buffers → indirect draw → exact
  pixel/readback。
- read-write buffer 的 atomic/counter 或 deterministic prefix operation。
- Forward+ fixture 验证 tile light list 被 fragment-stage storage binding 消费。
- 高斯泼溅 fixture 验证 cull/reorder/indirect blended draw 全程无 CPU count readback。
- 粒子 fixture 验证 simulate/compact/indirect draw 与 deterministic seed。
- device loss 后 recipe 重建、`cpu-shadow` 恢复和 `reinitialize` 未初始化读取拒绝。

### 18.3 创建与 API 测试

- `auto` + required compute 只选择 WebGPU。
- WebGPU 不可用时返回无兼容 backend，不回退 WebGL 2。
- explicit WebGL 2 + compute/storage requirement 失败。
- capability/limit/format requirements 在 runtime 创建前失败。
- 根入口、Bundler/NodeNext 类型消费、TypeDoc、API report 和真实 tarball exports。
- static modernity：允许受控 compute WGSL 和 storage graphics GLSL ES 3.10，拒绝 graphics
  WGSL、普通 Shader ES 3.10 和未校验入口。

### 18.4 必跑命令

迭代期至少运行：

```text
npm run typecheck
npm run lint
npm run test:render:architecture
npm run test:rhi
npm run test:webgpu
npm run api:check
npm run test:types
npm run test:package
```

公共 API 变更先运行 `npm run api:update` 并 review diff。最终发布证据必须包含：

```text
npm run validate
```

`npm run test:webgpu:native`
只在合适的物理 GPU 环境运行，并作为单独证据记录；没有运行时不得报告通过。

## 19. 验收清单

### 架构与 API

- [ ] Compute 只通过 `ComputeShader`、`ComputeKernel`、`ComputeRenderPass`
      公开，没有 Material 继承。
- [ ] Direct WGSL 只允许 compute，Naga WGSL frontend 是强制步骤。
- [ ] Storage-aware graphics 只使用受控 GLSL ES 3.10 → Naga，没有 graphics WGSL 镜像。
- [ ] 用户无法获取 native device/buffer/pipeline/encoder。
- [ ] 所有 compute work 都经过共享 Render Graph 和 portable RHI。
- [ ] StorageBuffer、storage texture、buffer clear、direct/indirect
      dispatch/draw、readback 和恢复同版本开放。
- [ ] GPUDrivenRenderPass 与 SceneRenderPass pass-global graphics storage binding 可用。
- [ ] 公共类型有完整 TSDoc、API report、类型消费和 package export。

### 正确性

- [ ] raster/copy/compute 共用统一 RAW/WAR/WAW 拓扑。
- [ ] compute→storage/vertex/index/indirect graphics input 全部由 graph 建边。
- [ ] read-write buffer 有显式 access，不通过谎报 write 绕过初始化。
- [ ] storage texture format/access/sample count 全部在 frame 前验证。
- [ ] layout、binding reflection、range、dynamic offset 和 limits 全部 fail-closed。
- [ ] WebGL 2 没有模拟路径，required capability 不会静默降级。
- [ ] direct/indirect dispatch 和 compute→raster/readback 有真实 WebGPU 精确结果。
- [ ] Forward+、高斯泼溅、GPU 粒子 fixture 都没有 CPU count/sort readback 或 native bypass。

### 生命周期与失败

- [ ] 所有 concrete resource 都有 registry recipe 或明确的 frame-only lifetime。
- [ ] submission fence 保留 compute 引用并延迟 destroy。
- [ ] upload/cache revision 只在成功 submission 后提交。
- [ ] record/compile/prepare/execute/submit 失败全部回滚。
- [ ] device loss 保留公共 identity，并区分 `cpu-shadow` 与 `reinitialize` 内容语义。
- [ ] replacement device 必须满足 capability/limit/format superset。

### 性能

- [ ] 默认非 compute Forward pipeline 无逐 draw 新分支、分配或 native object churn。
- [ ] steady-state compute record/prepare/execute 无逐 dispatch descriptor tree 或字符串 map。
- [ ] pipeline/layout/shader cache 稳定，bind-group churn 有可解释上界。
- [ ] diagnostics 能区分 draw、dispatch、pipeline switch、bind-group switch 和 transient
      allocation。
- [ ] 已建立不可覆盖的跨 commit performance baseline，并记录硬件/浏览器/驱动信息。

## 20. 风险与固定处理

| 风险                                         | 固定处理                                                                                            |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Direct WGSL 与现有“禁止手写 WGSL”冲突        | 将规则收窄为禁止 graphics WGSL 镜像；只开放受控 ComputeShader 通道                                  |
| Forward+/泼溅需要 graphics storage           | 增加受控 GLSL ES 3.10 StorageGraphicsShader 和 pass-global/程序化 raster binding，不用 texture 模拟 |
| 显式 binding metadata 与 WGSL 不一致         | Naga parse + portable layout validation + 真实 WebGPU pipeline creation 三层失败                    |
| GPU 写入无法 device-loss 无损恢复            | 强制公开 `cpu-shadow`/`reinitialize` 策略，不做隐式 readback                                        |
| 同 pass read-write 破坏现有 graph invariant  | 只增加 buffer 专用 `readWriteBuffer()`；texture feedback 继续拒绝                                   |
| StorageLayout 被误做成 std140/std430 混合    | 以 WGSL host-shareable layout 为唯一 storage 规则，独立于 UniformBuffer                             |
| API 表面过宽                                 | 公开稳定高层 kernel/pass/resource，不公开 RHI/native encoder                                        |
| Indirect draw 参数来自 GPU、CPU 无法检查内容 | 校验 usage/offset/range；结果由真实 WebGPU fixture 和像素/readback 证明，不隐藏 CPU map             |
| WebGL 2 用户体验                             | 创建前 capability 筛选和独立 graphics fallback factory，不运行时跳过                                |
| Compute 影响默认路径                         | capability 冷路径选择，默认 recorder 无新逐 draw 分支，专用性能门禁                                 |
| WebGPU validation 太晚                       | portable validation 和 prepare 必须先完成，native pipeline 错误仍发生在 beginFrame 前               |
| 单文件复杂度继续增长                         | 新增独立 compiler/cache/pass 模块，只抽共享基础，不堆进 graphics 文件                               |

## 21. Definition of Done

只有同时满足以下条件，Hilo3D 才能声称支持 Compute/Storage：

1. WebGPU `storage-buffer`、`storage-texture`、`compute-pass`、`indirect-draw`
   capability 对真实支持设备为 true。
2. WebGL 2 对这些能力为 false，且所有相关入口在 native GL 前明确失败。
3. Direct WGSL compute 经 Naga、显式 ABI、portable RHI validation 和真实 WebGPU pipeline 验证。
4. StorageBuffer、storage texture、buffer clear、direct/indirect dispatch/draw、read-write
   hazard、readback 和恢复全部可用。
5. compute、storage-aware raster、copy 在一个 Render Graph 和一个 submission 中正确排序。
6. 公共 API、文档、CHANGELOG、API report、类型消费、package 和示例同版本交付。
7. Forward+、高斯泼溅、GPU 粒子 fixture 与完整 portable、browser、real WebGPU、device-loss、negative
   WebGL 2 和性能门禁通过。
8. 没有 native bypass、WebGL 模拟、隐式 fallback、手写 graphics
   WGSL 镜像或未声明的 GPU-only 恢复承诺。

在这些条件完成前，代码可以逐步合入内部基础，但公共 capability 必须继续保持 false。
