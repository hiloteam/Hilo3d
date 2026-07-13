# Hilo3d

[English](./README.md) | 简体中文

**一个 WebGPU-first、TypeScript-first，并提供生产级 WebGL 2 兼容后端的 3D 引擎。**

Hilo3d vNext 围绕显式 render pass、可复用 GPU 资源、GLSL ES
3.00、PBR 与 glTF 设计。WebGPU 获得现代 command
recording 路径，同时无需维护第二套 shader 语言，也不放弃 WebGL 2 覆盖范围。

[![npm](https://img.shields.io/npm/v/hilo3d.svg?style=flat-square)](https://www.npmjs.com/package/hilo3d)
[![CI](https://img.shields.io/github/actions/workflow/status/hiloteam/Hilo3d/npm_test.yml?style=flat-square)](https://github.com/hiloteam/Hilo3d/actions/workflows/npm_test.yml)
[![license](https://img.shields.io/npm/l/hilo3d.svg?style=flat-square)](./LICENSE)

- WebGPU 把资源已就绪的 scene、target 与 present pass 记录进一个应用 command encoder，并只提交一次。
- WebGL 2 实现相同的 renderer、render target、shader 与资源契约。
- GLSL ES 3.00 是唯一 shader 源码；WebGPU 通过 Naga 转译解析后的 variant。
- 后端失败始终显式暴露，Hilo3d 不会静默切换用户请求的后端。

## 安装

```sh
npm install hilo3d
```

包只提供一个 ESM 入口，面向现代 bundler 与浏览器原生 ESM。WebGL
1、CommonJS、UMD 和全局脚本构建不属于 vNext 契约。

## WebGPU 快速开始

`Stage.create()`
会等待 adapter、device、按需加载的 Naga 编译器和初始渲染资源，因此返回的 stage 可以直接渲染。

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

请求 `backend: 'webgpu'`
后绝不会回退。adapter 不可用、所需 feature 或 limit 不足、shader 编译器初始化失败或 device 创建错误都会让
`Stage.create()` reject。若应用希望把 WebGL 2 作为 fallback 策略，必须捕获错误，再显式发起一次
`Stage.create({ backend: 'webgl2', ... })` 请求。

## WebGL 2 兼容

无需修改 scene、material、render target 或 GLSL 代码即可使用兼容后端：

```ts
const stage = await Hilo3d.Stage.create({
    backend: 'webgl2',
    container: document.querySelector('#app')!,
    camera
});
```

省略 `backend` 时使用文档化的 `webgl2` 默认值。Hilo3d 永远不会创建 WebGL 1 上下文。

## 能力矩阵

| 能力                  | WebGPU                                                        | WebGL 2                                          |
| --------------------- | ------------------------------------------------------------- | ------------------------------------------------ |
| Shader 输入           | GLSL ES 3.00 → Naga → WGSL                                    | 直接使用 GLSL ES 3.00                            |
| 多 pass `renderFrame` | 资源已就绪的 renderer pass 使用一个 encoder/submit            | 按顺序立即执行                                   |
| 原生对象复用          | Pipeline、bind group、buffer、texture、sampler、command state | Program、VAO、buffer、texture、sampler、GL state |
| 增量上传              | UBO/geometry dirty range；texture revision                    | UBO/geometry dirty range；texture revision       |
| Render target         | MRT、1×/4× MSAA、可采样 attachment、异步回读                  | 相同契约                                         |
| 引擎渲染              | PBR、阴影、实例化、glTF、后处理、拾取                         | 相同契约                                         |
| 丢失处理              | 重新获取 device 并恢复资源                                    | 恢复 context 与资源                              |
| 后端不可用            | 显式 reject，不回退                                           | 显式 reject，不回退 WebGL 1                      |

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

- `src/renderer/common` 负责后端中立的 frame planning、traversal、render target 契约、std140 uniform
  buffer 与确定性资源归属。
- `src/renderer/webgpu` 负责 command encoding、pipeline、bind
  group、buffer、texture、呈现与 device 生命周期。
- `src/renderer/webgl` 负责 WebGL program、VAO、buffer/texture/sampler/UBO manager、texture
  uploader、context state、framebuffer 集成、呈现与 context 生命周期。

全部引擎 shader 都以 GLSL ES 3.00 为起点。WebGL 2 直接编译；WebGPU 先解析 shader
variant，把生效接口改写成 Vulkan GLSL 4.50，再交给 Naga WASM frontend 生成 WGSL。引擎内部 utility
pass 也使用相同路径，不维护手写 fallback WGSL shader 集。

Shader variant 使用结构化、带类型与长度边界的双通道 64-bit
hash，不生成中间序列化 key；同时保留精确字段用于碰撞检查，发生碰撞时会得到确定性的 bucket
key，不会错误复用另一个 shader。按 device/context 隔离的 pipeline、bind group、GPU
resource 与 command state cache 避免重复创建和绑定；后端 manager 为渲染 variant、WebGPU sampler
descriptor、每纹理 sampler snapshot 与数值 depth
shader 专化设置按访问顺序更新的 LRU 上限，共享 resource manager 负责资源归属与确定性释放。

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

## 文档

- [API 文档](https://hilo3d.js.org/docs/)
- [完整示例库](https://hilo3d.js.org/examples/list.html)
- [glTF Viewer](https://hilo3d.js.org/examples/glTFViewer/index.html)
- [vNext 渲染工程记录](./ENGINEERING_MODERNIZATION.md#双后端渲染与-shader-abi)
- [ShaderMaterial 迁移指南](./ENGINEERING_MODERNIZATION.md#shadermaterial-迁移)
- [Breaking changes](./CHANGELOG.md#breaking-changes)
- [贡献指南](./.github/CONTRIBUTING.md)
