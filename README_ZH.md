# Hilo3d

[English](./README.md) | 简体中文

**一个 WebGPU-first、TypeScript-first，并提供生产级 WebGL 2 兼容后端的 3D 引擎。**

Hilo3d vNext 围绕 WebGPU-shaped RHI、显式 render pass、可复用 GPU 资源、GLSL ES
3.00、PBR 与 glTF 设计。WebGPU 保留原生 pipeline/bind-group/command 模型；WebGL
2 则通过带状态差分缓存的即时 GL 执行实现同一可移植子集。

[![npm](https://img.shields.io/npm/v/hilo3d.svg?style=flat-square)](https://www.npmjs.com/package/hilo3d)
[![CI](https://img.shields.io/github/actions/workflow/status/hiloteam/Hilo3d/npm_test.yml?style=flat-square)](https://github.com/hiloteam/Hilo3d/actions/workflows/npm_test.yml)
[![license](https://img.shields.io/npm/l/hilo3d.svg?style=flat-square)](./LICENSE)

- WebGPURHI 是 native WebGPU 对象与命令的薄映射，不退化成 GL 风格状态机，也不会再回放一份 JavaScript
  command buffer。
- WebGL2RHI 模拟 pipeline、bind group、render pass 与 command encoder 语义，编码时就通过 state-diff
  cache 即时执行 GL；`finish()`/`submit()` 只是归属边界，不做延迟回放。
- GLSL ES 3.00 是唯一人工编写的 shader 源码。Renderer
  shader 编译层先解析 variant、通过 Naga 生成 WebGPU module，RHI 只消费已准备好的后端 module。
- 后端策略始终显式：`auto` 按能力选择；显式请求 `webgpu` 或 `webgl2` 时绝不会静默切换。

## 安装

```sh
npm install hilo3d
```

包只提供一个 ESM 入口，面向现代 bundler 与浏览器原生 ESM。WebGL
1、CommonJS、UMD 和全局脚本构建不属于 vNext 契约。

## WebGPU 快速开始

`Stage.create()` 默认使用
`backend: 'auto'`，存在兼容 adapter 时优先 WebGPU，并等待最终选中的后端完成初始化；返回的 stage 可以直接渲染。

```ts
import * as Hilo3d from 'hilo3d';

const camera = new Hilo3d.PerspectiveCamera({ aspect: innerWidth / innerHeight, z: 4 });

const stage = await Hilo3d.Stage.create({
    backend: 'webgpu',
    container: document.querySelector('#app')!,
    camera,
    width: innerWidth,
    height: innerHeight
});

const box = new Hilo3d.Mesh({
    geometry: new Hilo3d.BoxGeometry(),
    material: new Hilo3d.PBRMaterial({
        baseColor: new Hilo3d.Color(0.832, 0.119, 0.093)
    })
}).addTo(stage);

stage.addChild(new Hilo3d.AmbientLight({ amount: 1 }));

const ticker = new Hilo3d.Ticker(60);
ticker.addTick(stage);
ticker.start();
```

省略 `backend` 等同于 `backend: 'auto'`。auto 会先调用
`Renderer.isBackendSupported('webgpu', options)`：这个轻量探测只请求 adapter，并校验 fallback-adapter 策略、required
feature、required limit 和 Hilo3d 的最低 adapter limits；不会请求 device、获取 canvas
context、初始化 Naga、创建 pipeline 或分配 GPU 资源。adapter 兼容时选择 WebGPU，否则直接创建 WebGL
2。传入 WebGL 2-only 的 `preserveDrawingBuffer`，或请求 `alpha: true, premultipliedAlpha: false`
的 straight-alpha canvas 合成时，auto 也会直接选择 WebGL 2。

探测选中 WebGPU 后，正式 WebGPU 初始化只执行一次。device 或 canvas
context 创建错误、shader 编译器失败、pipeline/资源初始化错误以及之后的任何错误都会让
`Stage.create()` reject，绝不会被捕获后当作回退理由。显式请求 `backend: 'webgpu'`
会跳过 auto 探测，同样绝不回退。

应用也可以在不创建 renderer 的情况下复用同一不创建 device 或 GPU 资源的探测：

```ts
const webgpuSupported = await Hilo3d.Renderer.isBackendSupported('webgpu', {
    powerPreference: 'high-performance'
});
```

## WebGL 2 兼容

无需修改 scene、material、render target 或 GLSL 代码即可使用兼容后端：

```ts
const stage = await Hilo3d.Stage.create({
    backend: 'webgl2',
    container: document.querySelector('#app')!,
    camera
});
```

同步 `new Stage()` 仍默认使用 WebGL 2，因为构造函数无法等待异步 adapter 探测；需要 WebGPU-first
auto 策略时应使用 `await Stage.create()`。Hilo3d 永远不会创建 WebGL 1 上下文。

## 直接创建 Renderer

`Renderer` 是唯一公开的 renderer 类。需要同步获得 WebGL
2 时使用构造函数；自动选择或 WebGPU 使用异步工厂：

```ts
const webglRenderer = new Hilo3d.Renderer({
    backend: 'webgl2',
    domElement: document.querySelector('canvas')!
});

const autoRenderer = await Hilo3d.Renderer.create({
    backend: 'auto',
    domElement: document.createElement('canvas')
});

const webgpuRenderer = await Hilo3d.Renderer.create({
    backend: 'webgpu',
    domElement: document.createElement('canvas')
});
```

所有 Renderer 都创建同一公开 `RenderTarget` 契约。可以通过 `renderer.backend`
观察最终后端，但 scene、material、target 与 shader API 不随之变化。

## 能力矩阵

| 能力                  | WebGPU                                             | WebGL 2                                                  |
| --------------------- | -------------------------------------------------- | -------------------------------------------------------- |
| RHI 执行              | 薄封装 native encoder/pass/queue                   | encoder/pass 语义下的即时 GL 执行                        |
| Shader module 输入    | Renderer 准备好的 WGSL                             | Renderer 准备好的 GLSL ES 3.00                           |
| 多 pass `renderFrame` | 资源已就绪的 renderer pass 使用一个 encoder/submit | 按顺序即时执行；submit 绝不回放命令                      |
| Device 对象复用       | 有界 pipeline、layout 与 sampler cache             | 有界 pipeline、layout、sampler、framebuffer 与 VAO cache |
| 增量上传              | UBO/geometry dirty range；texture revision         | UBO/geometry dirty range；texture revision               |
| Render target         | MRT、1×/4× MSAA、可采样 attachment、异步回读       | 相同引擎契约                                             |
| RHI 不支持能力        | 通过 `features`/`limits` 声明，请求时拒绝          | compute/storage/1D/异步 buffer mapping 明确不支持        |
| 丢失处理              | 重新获取 device 并恢复资源                         | 恢复 context 与资源                                      |
| 后端选择              | 显式请求失败即 reject；`auto` 只做 adapter 探测    | `auto` 探测不支持时直接选择；不回退 WebGL 1              |

## 一帧，多 pass

应用自主管理 frame graph 时使用
`renderFrame()`。WebGPU 中，回调内资源已就绪的 scene、target 与 present 调用共享一个应用 command
encoder，最终最多产生一次应用提交；WebGL 2 则通过相同的后端中立 facade 按顺序执行同一组命令。

```ts
const reflectionTarget = renderer.createRenderTarget({
    width: renderer.width,
    height: renderer.height
});
const sceneTarget = renderer.createRenderTarget({ width: renderer.width, height: renderer.height });

renderer.renderFrame(frame => {
    frame.renderToTarget(reflectionTarget, stage, reflectionCamera);
    frame.renderToTarget(sceneTarget, stage, camera, true);
    frame.present(sceneTarget);
});
```

renderer 尺寸变化时需要 resize 应用持有的 target。请在自定义 tick 中调用该 frame
callback，不要同时让 `Stage`
执行默认渲染。callback 必须同步执行，不能返回 Promise，也不能在返回后继续持有 `frame`
facade。进入 callback 前应确定 scene transform、material、`GeometryData`
与 texture 更新；同一帧首次使用后不能再改变 geometry 或 texture 内容。冷启动 texture
mipmap 准备和显式 readback 属于独立 GPU 工作，不计入应用 pass 的单次提交承诺。renderer 的 resize、`setRenderTarget()`、资源释放/销毁，以及 render
target 的 resize、readback、destroy 必须在 callback 外执行；WebGPU 录制期间尝试这些操作会中止整帧，且不会提交部分 command。

## 现代渲染架构

- `src/render` 负责唯一公开的 Renderer、scene traversal、frame planning、render target 契约、std140
  uniform 数据、shader 接口准备和确定性引擎资源归属。
- `src/shader` 负责 GLSL 预处理和引擎 shader variant；`src/render/shader`
  负责反射 binding 与 GLSL→WGSL 编译；RHI 不知道 shader variant 或 material。
- `src/render/rhi/RHI.ts` 定义 WebGPU-shaped 的 device、resource、pipeline、bind group、render
  pass、encoder、queue、surface、feature 与 limit 契约。
- `src/render/rhi/RHIFactory.ts`
  是唯一硬件组合根：只构造一次具体 RHI 并负责后端能力探测，不在每条 command 外再包一层 facade。
- `src/render/rhi/webgpu` 直接包装 native WebGPU；`src/render/rhi/webgl2` 包含 WebGL
  2 语义模拟、state cache、framebuffer/VAO 归属和 context
  recovery。两个 RHI 都不引用引擎 scene 类型。
- 后端准备与 native 执行全部是内部实现，不存在后端专属的公开 Renderer 或 RenderTarget 类；内部 Renderer
  factory 只在构造时选择一次具体 driver，并直接返回该实例。

抽象边界刻意采用 WebGPU 模型，而不是 WebGL 状态机。WebGPU render pass 与 native pass 一对一，command
encoder 直接持有 native encoder。WebGL2RHI 只在 pipeline 或 bind
group 状态变化时应用 GL 状态，draw/copy 在编码期间已执行；返回的 command buffer 只是一次性 submit
token。生产 WebGPU 路径直接使用同一个 concrete device 上的一跳 native fast path，主 draw
loop 保留 native handle，不承担逐 draw wrapper 或虚调用开销。WebGL 2 路径则在 frame-scoped
session 中执行 Program/VAO，并共享 RHI 唯一的 context、canonical state
differential、lifecycle 与 device-owned sampler
cache；Program、VAO、framebuffer 仍属于 render 层 cache，不会创建并行 context 或可回放命令列表。无法在 WebGL
2 中正确实现的 compute pipeline、storage texture/buffer、1D texture、异步 buffer
mapping、base-vertex 与 first-instance draw 会从 `features` 中缺席或以 0
limit 暴露，请求时明确报错。RHI 契约内部会保守声明格式相关的采样、过滤、attachment、storage 和 MSAA 能力，包括 extension/tier 导致的差异。

全部引擎 shader 都以 GLSL ES 3.00 为起点。WebGL 2 直接编译；WebGPU 先解析 shader
variant，把生效接口改写成 Vulkan GLSL 4.50，再交给 Naga WASM frontend 生成 WGSL。引擎内部 utility
pass 也使用相同路径，不维护手写 fallback WGSL shader 集。

Shader variant 使用结构化、带类型与长度边界的双通道 64-bit
hash，不生成中间序列化 key；同时保留精确字段用于碰撞检查，发生碰撞时会得到确定性 bucket
key，不会错误复用另一个 shader。Cache 归属只保留一层：每个 RHI device 持有有界的 immutable
sampler、bind-group-layout、pipeline-layout 与 render-pipeline
cache；Renderer 持有 material、Mesh、shader variant、binding set 和 upload revision
cache。RHI 不按 descriptor 去重 buffer、texture、shader module 或 bind
group，因为它们的 identity 与生命周期属于应用数据；label 不参与 device cache key。Device
lost/context restore 和显式 destroy 会清空所有 device cache。

Texture identity 保持后端中立：共享对象只保存 CPU 内容、不可变 update
snapshot 与单调 revision；每个 WebGL context 和 WebGPU device 分别持有 native allocation 与 upload
cursor。WebGL descriptor snapshot 让 framebuffer resize/reset 可稳定复用 native
object；WebGPU 会延迟销毁仍被待提交 command 引用的 buffer 与 texture。不可取消的内部生命周期 observer 会先释放所有后端 allocation，再执行可被用户取消的公开事件，context/device
lost 与显式资源释放也遵循同一规则。WebGL sampler variant 是不可变、有界且按 texture
unit 绑定的，因此同一张 depth texture 可以在一次 draw 中同时用于数值读取和 comparison
sampling，不需要改写 texture 全局状态。

两个后端的 render target owner 都会跟踪 attachment allocation generation。Texture
target 变化、上传失败或显式销毁 attachment 时会使旧 allocation 失效；target 会在再次使用前重建资源或重新挂接，并拒绝陈旧的 native
handle。

Uniform buffer、动态 geometry 与 texture 都携带后端本地 revision；allocation
shape 稳定时，两个后端只上传 UBO 与 geometry 合并后的 dirty
range，texture 则从所需 revision 重放不可变的 subresource update snapshot。WebGPU command-state
cache 还会在单个 pass 内消除重复的 pipeline、bind group、vertex/index
buffer、viewport 与 stencil 命令。

## 自定义 GLSL 与 UBO 契约

数值 shader 数据必须放入已注册的 std140 block；sampler 是唯一允许放在 block 外的 uniform。

```ts
Hilo3d.registerUniformBlockBinding('EffectBlock');
const effectLayout = Hilo3d.createStd140Layout({ tint: 'vec4' });
const effectBlock = Hilo3d.UniformBuffer.fromSchema(effectLayout, {
    tint: [0.6, 0.8, 1, 1]
});

const material = new Hilo3d.ShaderMaterial({
    attributes: { a_position: 'POSITION' },
    uniformBlocks: { EffectBlock: effectBlock },
    vs: `#version 300 es
layout(std140) uniform EffectBlock { vec4 tint; };
in vec3 a_position; out vec4 v_tint;
void main() { v_tint = tint; gl_Position = vec4(a_position, 1.0); }`,
    fs: `#version 300 es
precision highp float;
in vec4 v_tint; layout(location = 0) out vec4 outColor;
void main() { outColor = v_tint; }`
});

effectBlock.set('tint', [1, 0.5, 0.2, 1]);
```

使用 `in`/`out`、`texture()` 和显式 fragment output。每个 custom
block 必须在首次使用前注册；跨 stage 的同名 block
layout 必须相同；schema 只使用 scalar、vector、matrix 或定长数组组成的扁平结构。

## Device 与资源生命周期

WebGPU device lost 后先触发
`webgpuDeviceLost`，使用冻结的要求重新获取等价 adapter/device，复核 feature 与 limit，重建 device-owned
manager/cache，在不改变公开 target 对象 identity 的前提下恢复 render-target 资源，最后触发
`webgpuDeviceRestored`。恢复期间安全跳帧；最终失败会触发
`webgpuDeviceRecoveryFailed`，之后的 render 显式抛错，并且绝不切换到 WebGL
2。`releaseGPUResources()` 会清理自有 GPU 状态，但 renderer 仍可继续使用。

应用需要后端中立的完成 fence 时使用 `await renderer.waitForIdle()`。Native 互操作只能显式通过
`renderer.getExtension('webgl2-native')` 或 `renderer.getExtension('webgpu-native')`
获取，公开 Renderer 不直接暴露 context 或 device 字段。使用前必须检查 extension 是否存在，常规渲染继续使用共享的 Renderer/RenderTarget
API。

## 文档

- [API 文档](https://hilo3d.js.org/docs/)
- [完整示例库](https://hilo3d.js.org/examples/list.html)
- [glTF Viewer](https://hilo3d.js.org/examples/glTFViewer/index.html)
- [vNext 渲染工程记录](./ENGINEERING_MODERNIZATION.md#双后端渲染与-shader-abi)
- [ShaderMaterial 迁移指南](./ENGINEERING_MODERNIZATION.md#shadermaterial-迁移)
- [Breaking changes](./CHANGELOG.md#breaking-changes)
- [贡献指南](./.github/CONTRIBUTING.md)
