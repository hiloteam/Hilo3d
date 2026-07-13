# Hilo3d

[English](./README.md) | 简体中文

一个 TypeScript-first、显式支持 WebGL
2 与 WebGPU 双后端的 3D 渲染引擎，支持基于物理的渲染与 glTF；不支持 WebGL 1。

[![npm](https://img.shields.io/npm/v/hilo3d.svg?style=flat-square)](https://www.npmjs.com/package/hilo3d)
[![CI](https://img.shields.io/github/actions/workflow/status/hiloteam/Hilo3d/npm_test.yml?style=flat-square)](https://github.com/hiloteam/Hilo3d/actions/workflows/npm_test.yml)
[![license](https://img.shields.io/npm/l/hilo3d.svg?style=flat-square)](./LICENSE)

## 安装

```sh
npm install hilo3d
```

Hilo3d 2.x 以 ESM 作为包的主入口：

```ts
import {
    AmbientLight,
    BoxGeometry,
    Color,
    DirectionalLight,
    Mesh,
    PBRMaterial,
    PerspectiveCamera,
    Stage,
    Ticker,
    Vector3
} from 'hilo3d';

const camera = new PerspectiveCamera({
    aspect: innerWidth / innerHeight,
    z: 4
});

const stage = await Stage.create({
    backend: 'webgl2',
    container: document.querySelector('#app')!,
    camera,
    width: innerWidth,
    height: innerHeight
});

const mesh = new Mesh({
    geometry: new BoxGeometry(),
    material: new PBRMaterial({
        baseColor: new Color(0.832, 0.119, 0.093)
    })
}).addTo(stage);

mesh.onUpdate = () => {
    mesh.rotationX += 1;
    mesh.rotationY += 1;
};

stage.addChild(new AmbientLight({ amount: 0.5 })).addChild(
    new DirectionalLight({
        amount: 5,
        direction: new Vector3(-1.3, -0.8, 0)
    })
);

const ticker = new Ticker(60);
ticker.addTick(stage);
ticker.start();
```

使用 WebGPU 时必须显式选择后端，并等待 adapter、device、Naga WASM 编译器和渲染资源初始化：

```ts
const stage = await Stage.create({
    backend: 'webgpu',
    container: document.querySelector('#app')!,
    camera,
    width: innerWidth,
    height: innerHeight
});
```

省略 `backend` 时使用文档化的 `webgl2` 默认值。显式请求 `webgpu` 后绝不会静默退回 WebGL
2；adapter 不可用、缺少所需 feature/limit 或初始化失败都会让 `Stage.create()`
直接 reject。初始化会冻结 adapter options 与实际生效的 device descriptor。运行中 device
lost 会先触发 `webgpuDeviceLost`，再按相同 options 重新获取等价 adapter，完整复核 fallback
adapter 策略、全部所需 feature/limit，最后使用同一份有效 descriptor 请求替代 device 并重建 context、manager 与 target 资源。恢复期间的 render 会安全跳帧。成功后保留每个
`RenderTarget` 对象的 identity 并触发 `webgpuDeviceRestored`；失败则触发
`webgpuDeviceRecoveryFailed`，之后的 render 显式抛出恢复错误。销毁 renderer 会取消正在进行的恢复，不会切换后端。

使用 `isImageCanRelease` 的纹理在公开 CPU image 被释放后，仍按逻辑 `Texture`
identity 保留 engine-private recovery backing：raw pixel、mipmap 与 sub-texture
update 会复制到精确的私有完整内容 checkpoint，external image
source 则遵守文档化的私有引用/checkpoint 路径。增量日志最多保留 64 条；落后的 WebGL 2
context 或 WebGPU
device 会先做一次精确完整重放，再继续消费增量，且不会重新暴露已释放的公开 image。`releaseGPUResources()`
是可重复使用的资源生命周期操作，不是 device teardown：它清理 owned
target 与 cache 后立即重建主画布的 depth/MSAA attachment，下一帧仍可直接渲染。WebGPU 自有的 shadow
camera/debug helper 按 renderer 与 light 精确归属；debug、shadow、enabled 或 stage
membership 变化，以及 release/destroy 时都会立即清理。

包只提供一个 ESM 入口，通过现代 bundler 或带 import
map 的浏览器原生 ESM 使用。工程不再发布 CommonJS、UMD、全局脚本或 namespace 声明变体，所有消费方共享同一份模块与类型契约。

## 渲染与 shader 契约

Hilo3d 2.x 提供两个必须明确选择的后端：`webgl2` 与 `webgpu`，并且永远不会创建 WebGL
1 上下文。全部引擎 shader 都以 GLSL ES
3.00 为唯一源码；材质、阴影与呈现 shader 在两个后端复用，WebGPU 专用的 mipmap 等内部 utility
pass 也保持为 GLSL，不引入 WGSL 特例。自定义 shader 必须使用 `in`/`out`、`texture()`、显式 fragment
output 与 std140 uniform block。

WebGL 2 直接编译这份源码。WebGPU 会先解析引擎 shader variant，把激活后的 GLSL ES
3.00 接口改写为 Vulkan GLSL 4.50，包括 location、bind
group、纹理与 sampler 分离、裁剪空间深度转换；随后才交给 Naga WASM
frontend 生成 WGSL。renderer-owned present 与 mipmap pipeline 也经过同一预处理和 Naga
translator，不存在手写或 fallback WGSL module；工程也没有 GLSL 1.00 兼容转译器。WGSL 通过显式
`@align`/`@size` wrapper 表达共享的 std140 ABI，只依赖 WebGPU 默认 language
feature，不申请或探测可选的 `uniform_buffer_standard_layout`。

预处理 frontend 会在 Naga 前完整解析 function-like macro、引擎使用的 GLSL 条件整数表达式、具名 stage
interface block、固定数组与多声明。只接受 WebGL 2 / GLSL ES 3.00
builtin；更高版本的 query/gather 接口会在进入任一后端前失败。depth-only pass 复用同一 fragment
shader 的无 color-output Naga variant，不维护 shadow 专用 WGSL，也不挂虚假的 color attachment。

所有非纹理 shader 数据都通过固定 std140 uniform block 传递：

| Block           | WebGL 2 binding | WebGPU group/binding | 更新域                                  |
| --------------- | --------------: | -------------------: | --------------------------------------- |
| `FrameBlock`    |               0 |                  0/0 | 每 renderer frame                       |
| `CameraBlock`   |               1 |                  0/1 | 每 camera/render pass 的矩阵与 viewport |
| `SceneBlock`    |               2 |                  0/2 | scene revision                          |
| `LightBlock`    |               3 |                  0/3 | 每 camera/render pass                   |
| `MaterialBlock` |               4 |                  1/0 | 最终 std140 bytes                       |
| `ModelBlock`    |               5 |                  2/0 | object transform revision               |
| `GeometryBlock` |               6 |                  2/1 | geometry decode revision                |
| `SkinningBlock` |               7 |                  2/2 | skeleton pose revision                  |
| `MorphBlock`    |               8 |                  2/3 | morph pose revision                     |
| `InstanceBlock` |               — |                  2/4 | WebGPU instanced batch 更新             |

WebGPU 四个 group 按更新频率划分：group 0 是 global/pass/scene，group
1 是 material 与 texture，group 2 是 object/geometry/pose，group 3 是已注册的 custom
block。`CameraBlock.u_viewport` 固定表示当前 attachment 的物理像素
`(x, y, width, height)`，主画布、RenderTarget 与每个 shadow pass 都在两个后端同步更新。
`MaterialBlock` 会比较可复用的最终 std140 字节快照，所以直接修改嵌套
`Color`/矩阵或纹理派生值也能自动刷新；字节未变时不推进 revision、不上传，也不要求手工设置
`isDirty`。

GLSL sampler 因 opaque resource 规则不能进入 UBO，是 block 外唯一允许的声明。WebGL
2 把它们分配到 texture unit；WebGPU 则把每个 sampler 降级为独立的 texture/sampler binding 对。自定义
`ShaderMaterial` block 必须在首次使用前调用 `registerUniformBlockBinding()`，再通过
`createStd140Layout()` 和 `UniformBuffer.fromSchema()`
创建与更新；block 外的 float、vector、matrix、integer 或 boolean uniform 会直接失败。公开 std140
schema 只接受扁平的 scalar、vector、matrix 与定长数组，嵌套 struct 会明确失败，不允许产生依赖后端的错误布局。共享 shader 契约完整支持 GLSL
ES 3.00 的 `sampler3D`、
`sampler2DArray`、`sampler2DArrayShadow`，以及 2D、3D、cube、2D-array 的全部 signed/unsigned integer
sampler family。managed `Texture` 上传统一支持 2D、cube、3D、2D-array target 与 signed/unsigned
integer format。integer texture 必须使用 `NEAREST` magnification、
`NEAREST`/`NEAREST_MIPMAP_NEAREST`
minification、`anisotropic: 1`，选择 mipmap 时还必须提供显式完整 chain；3D
texture 选择 mipmap 时同样必须提供显式完整 chain。由于 WebGPU 没有 compressed 3D
texture 模型，两个后端都会在分配前拒绝 compressed 3D；2D-array compressed texture 在原生 format
feature 可用时正常工作。sampler array 保留 WebGL
2 的 dynamically-uniform 索引语义：常量元素直接映射 binding pair，动态索引则生成覆盖 texture
builtin 与用户 sampler 函数的类型化 dispatch，不依赖可选 WebGPU binding-array
feature。同名 UBO 还会在进入 Naga 前比较两个 shader stage 的布局。depth texture 既能通过 shadow
sampler 做 comparison sampling，也能通过普通 sampler 读取数值 `.r`；后者在 Naga 后专门映射为 WGSL
`texture_depth_*`，并按 WebGPU non-filtering binding 契约要求 nearest-only
filter 与关闭 anisotropy。WebGL 2 则按反射到的 sampler 类型逐次选择 texture comparison
mode。完整 Naga 流水线、四组 bind-group ABI、迁移示例和 breaking
changes 见[工程现代化改造记录](./ENGINEERING_MODERNIZATION.md)。

纹理上传只有一套跨后端语义：DOM/external
image 使用浏览器标准的 sRGB-managed 路径；TypedArray/DataView 是紧密行布局的未标记原始数值，两个后端用相同的字节顺序执行
`flipY`。旧的 `Texture.colorSpaceConversion` 后端开关已删除。WebGPU 视频纹理通过
`requestVideoFrameCallback` 观察已解码帧，先写入 renderer-owned staging canvas，再等待 queue
copy 完成后允许覆写该 canvas。首个已解码帧到达前保持合法的零初始纹理；替换 source、释放资源或 device
recovery 都会明确取消并重建帧观察。这条路径不回退 WebGL、不替换占位纹理，也不依赖已不可用的解码器 backing。

纹理子资源更新在两个后端只有 descriptor API：

```ts
texture.updateSubTexture({
    mipLevel: 0,
    x: 16,
    y: 8,
    width: 4,
    height: 4,
    image: pixels
});
```

cube update 增加 `face`，2D-array 必须提供 `layer + depth`，3D 必须提供
`z + depth`；旧位置参数 API 已删除，非 base level 只能更新显式 mip chain。cube chain 包含 level
0，每个 level 连续提供六项，顺序固定为 `+X, -X, +Y, -Y, +Z, -Z`。可移植的 managed raw depth
update 支持 depth16unorm、depth32float 与 feature-gated depth32float-stencil8；raw
DEPTH24/DEPTH24_STENCIL8、depth external source 和 depth mipmap
filter 会在后端分配前拒绝。raw、external、compressed、3D、array 与 cube
update 共享最多 64 条的日志与精确 checkpoint，较慢的 context/device 不会丢更新。compressed
update 只接受精确 raw
block 数据；origin 必须按 block 对齐，非 block 整数倍的尺寸只允许出现在逻辑 mip 边缘。边缘和 1×1/2×2 尾级保留逻辑尺寸，同时满足实际 4×4
block copy 契约。

离屏渲染是后端中立的：两个 renderer 都通过 `Renderer.createRenderTarget()` 返回公共 `RenderTarget`
契约，统一支持 MRT、1×/4×
MSAA、可选可采样 depth/stencil、resize、显式 target 选择与异步 readback。attachment `Texture`
在 resize 与 context/device recovery 前后保持同一 identity；WebGL 2
resize 采用事务提交，要么全部 attachment 成功更新，要么恢复旧 target。两个 backend 都通过 fullscreen
texture-load pipeline 显式呈现；WebGL
2 不会把单采样 FBO 非法 blit 到可能启用 MSAA 的默认 framebuffer，pass 失败也会先恢复 canvas
binding 再抛错。PostProcess 和异步 `MeshPicker` 只使用这个契约，没有 WebGL-only 分支或 CPU
fallback。旧的公共 `Framebuffer`、`LightShadow`、`CubeLightShadow`、灯光 `lightShadow`
字段、renderer-owned `useFramebuffer`/`framebufferOption`
与隐式 target 已删除；shadow 和原生 framebuffer handle 只是后端内部实现。

Directional、Spot 与 Point light 通过共享的 `ShadowCastingLightParameters`
契约在两个后端渲染阴影；Area、Ambient 与 base
light 会在后端选择前拒绝 shadow 配置，不允许某个后端静默忽略。

primitive topology 会在进入后端前统一规范化：`LINE_LOOP` 转为显式 `LINES` indices，`TRIANGLE_FAN`
转为 `TRIANGLES`，索引、非索引与 glTF geometry 路径使用同一规则。

WebGPU 动态 geometry 使用 attribute/index dirty range 增量上传，不会每次重建完整 buffer；interleaved
matrix、normalized/stride、离散区间、4-byte 对齐的小 index 写入、历史过期、shape 变化和旧 buffer 释放均由自动测试锁定。

原生压缩纹理在启用 mipmap
filter 时由两个后端执行同一严格契约：mip 层数必须完整且每层尺寸必须准确；合法的 base-only 或 partial
KTX 仍可配合非 mipmap filter 使用，不会被 loader 误拒。KTX1 header 与 mip
size 遵守容器端序标志，请求参数不能覆盖容器声明的格式、尺寸与 mipmap 数据。WebGPU 的 ETC2/EAC 映射覆盖 WebGL
2 规定的全部 10 个 core format。应用通过 `Renderer.supportsTextureCompression()`
查询当前后端能力；WebGPU 按 adapter
feature 启用 BC、ETC2/ETC1 与 ASTC，明确拒绝 PVRTC，不做 CPU 解码、格式替换或空纹理回退。

渲染资源按 `mesh → pass owner → material/shader/instancing variant`
持有，每个 mesh 最多保留 32 个 variant，通过 LRU 淘汰。target 替换/销毁、mesh/material/geometry
identity 变更、失败帧回滚与全局最终引用都参与确定性释放。WebGL 2 的 program、buffer、vertex
array、texture、framebuffer
state、capability 快照与 extension 对象全部按所属 context 隔离。多个 renderer 可以共用同一逻辑 scene 资源而不共用 native
handle；释放或恢复任一 context 不会破坏其他 renderer。

## 文档与示例

- [API 文档](https://hilo3d.js.org/docs/)
- [完整示例库](https://hilo3d.js.org/examples/list.html)
- [glTF Viewer](https://hilo3d.js.org/examples/glTFViewer/index.html)
- [工程现代化改造记录](./ENGINEERING_MODERNIZATION.md)
- [变更记录](./CHANGELOG.md)

API 页面由 TypeDoc 直接从已检查的 TypeScript 源码生成。仓库中的
[`etc/hilo3d.api.md`](./etc/hilo3d.api.md) 固化公共声明面，供代码审查比较。

示例清单递归收集全部 78 个 HTML，共形成 155 个 page/backend 组合。除 `webxr.html` 外，每个页面都在
`webgl2` 和 `webgpu` 上运行；由于浏览器 WebXR 呈现层当前使用 `XRWebGLLayer`，它是唯一明确的 WebGL
2-only 例外，不计入 WebGPU 发布门禁，也不实现 WebGPU 失败后回退。每个组合必须观察到真实 WebGL
draw 或 WebGPU canvas acquisition、render-pass draw 与 queue
submit，且没有页面、网络、控制台、validation、uncaptured
GPU 或 device-loss 错误。门禁还覆盖非整数 DPR、glTF
Viewer 加载/替换/释放、ShaderToy 指针输入、运行中 post-process 控制、压缩纹理与 GPU mesh
picking，以及两个后端的已解码视频纹理。关键交互必须产生操作后的 native
draw 增量（WebGPU 还必须新增 queue submission），并分别用 GPU
readback 验证 life-game 局部纹理写入、ShaderToy 指针变化、相同场景输入下的 post-process
kernel 差异和 glTF 模型替换。页面、请求/响应、控制台、DevTools 图形错误与 uncaptured
GPU 错误监听会持续到交互和清理结束；GPU instrumentation 会先等待稳定帧，再等待所有已观察到的真实
`GPUQueue.onSubmittedWorkDone()`，最后才取样；延迟到达的 validation
error 不能在用例判定通过后漏出。确定性灯光 PBR 首帧必须在 WebGL 2 与 WebGPU 之间逐字节相同。

## 开发

运行环境必须支持所选后端对应的 WebGL 2 或 WebGPU。开发环境要求 Node.js 22.22.2 或更高版本以及 npm
12.0.1；版本分别记录在 `.node-version` 和 `package.json` 中。

```sh
npm install --global npm@12.0.1
npm ci
npx playwright install chromium
npm run validate
```

常用命令：

- `npm run dev` 启动库开发环境。
- `npm run examples:dev` 启动完整示例库。
- `npm run typecheck`、`npm run lint` 和 `npm run format:check` 执行静态门禁。
- `npm run check:modernity` 拒绝受维护目录中的 JavaScript 实现与已退出的旧工具配置。
- `npm run test:coverage` 在浏览器中运行单元测试，并检查完整源码范围的覆盖率。
- `npm run test:ui`
  执行 78 个 HTML/155 个 page/backend 组合（仅 WebXR 为明确例外），检查真实 draw/submit、GPU 验证、页面、控制台、请求与响应，并在双后端验证非整数 DPR、ShaderToy、glTF
  Viewer 和 post-process 交互。
- `npm run test:webgpu` 在 Chromium SwiftShader 中创建真实 WebGPU
  adapter/device/pipeline，经 Naga 转译 GLSL，并验证 Basic/PBR、实例化、带 primitive
  restart 和局部更新的索引 strip、mipmap 纹理替换、三类阴影光源、4× MSAA/stencil、双 attachment
  MRT、离屏呈现、像素回读、原生压缩纹理与 GPU mesh picking。同一真实浏览器闭环还创建 managed
  3D、2D-array、integer-array、depth-array、数值 depth texture 与动态索引 sampler
  array，经 Naga 编译扩展 GLSL sampler 集，建立真实 bind
  group/pipeline，完成 draw/submit，并要求像素 readback 精确等于
  `[64, 128, 200, 255]`，同时没有 shader compilation 或 GPU validation 错误。fixture 会主动调用
  `GPUDevice.destroy()`，观察重新获取的 adapter/device，重放已释放纹理，保持当前 `RenderTarget`
  identity，并要求恢复前后像素 readback 完全相等。单元测试还验证恢复失败、过期回调、destroy 取消、可重复使用的
  `releaseGPUResources()`，以及 renderer-owned shadow camera/helper 的精确 prune。
- `npm run test:webgpu:native`
  是显式、可选的物理 GPU 通道：禁用 Chromium 软件光栅器，强制所有 adapter 请求使用
  `forceFallbackAdapter: false`，拒绝 fallback 或已知软件 adapter，并用正式 WebGPU
  fixture 验证 draw、submit、queue 完成、device recovery 与 readback。它不会伪装成可移植 `validate`
  的必跑项；手动的 `Native WebGPU (optional)` workflow 只在带 `gpu`
  标签、已正确安装物理 GPU 驱动的 self-hosted Linux runner 上运行。WebXR 仍明确排除在此通道之外。
- `npm run test:visual` 比较双后端的确定性 PBR readback 与截图，包括首帧跨后端逐字节相等。
- `npm run docs:build` 生成 API 文档；`npm run api:check` 校验公共签名报告；`npm run site:build`
  组装发布站点。
- `npm run test:package` 校验构建后和打包后的 npm 契约。
- `npm run validate` 执行 CI 与发布前共用的完整门禁。

发布的 ESM 模块图以 ES2022 为目标，并将 `gl-matrix`
保持为 external 以便依赖去重。Naga 使用动态 import：引擎入口约 1.06 MB，约 2.05 MB 的 Naga
JavaScript/WASM 模块会成为独立 chunk，只在 WebGPU 初始化时加载。类型声明和 source map 均从 `src/`
生成；真实安装后的 tarball 会经过 publint、Are the Types
Wrong、Bundler 与 NodeNext 消费项目、ESM 运行时加载和一次真实 Naga GLSL→WGSL 转译校验。

TypeScript、API、测试和评审规则见[贡献指南](./.github/CONTRIBUTING.md)。

## 许可证

[MIT](./LICENSE)
