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
直接 reject。后续若 device lost，renderer 会触发
`webgpuDeviceLost`、释放完整 device/context 资源图并进入明确的终止失败态；应用应创建新 stage，而不是静默切换 backend。

包只提供一个 ESM 入口，通过现代 bundler 或带 import
map 的浏览器原生 ESM 使用。工程不再发布 CommonJS、UMD、全局脚本或 namespace 声明变体，所有消费方共享同一份模块与类型契约。

## 渲染与 shader 契约

Hilo3d 2.x 提供两个必须明确选择的后端：`webgl2` 与 `webgpu`，并且永远不会创建 WebGL
1 上下文。两个后端共享唯一一份 GLSL ES 3.00 shader 源码；自定义 shader 必须使用
`in`/`out`、`texture()`、显式 fragment output 与 std140 uniform block。

WebGL 2 直接编译这份源码。WebGPU 会先解析引擎 shader variant，把激活后的 GLSL ES
3.00 接口改写为 Vulkan GLSL 4.50，包括 location、bind
group、纹理与 sampler 分离、裁剪空间深度转换；随后才交给 Naga WASM
frontend 生成 WGSL。工程中没有另一套手写 WGSL shader，也没有 GLSL 1.00 兼容转译器。

所有非纹理 shader 数据都通过固定 std140 uniform block 传递：

| Block           | WebGL 2 binding | WebGPU group/binding | 更新域                      |
| --------------- | --------------: | -------------------: | --------------------------- |
| `FrameBlock`    |               0 |                  0/0 | 每 renderer frame           |
| `CameraBlock`   |               1 |                  0/1 | 每 camera/render pass       |
| `SceneBlock`    |               2 |                  0/2 | scene revision              |
| `LightBlock`    |               3 |                  0/3 | 每 camera/render pass       |
| `MaterialBlock` |               4 |                  1/0 | material/IBL revision       |
| `ModelBlock`    |               5 |                  2/0 | object transform revision   |
| `GeometryBlock` |               6 |                  2/1 | geometry decode revision    |
| `SkinningBlock` |               7 |                  2/2 | skeleton pose revision      |
| `MorphBlock`    |               8 |                  2/3 | morph pose revision         |
| `InstanceBlock` |               — |                  2/4 | WebGPU instanced batch 更新 |

GLSL sampler 因 opaque resource 规则不能进入 UBO，是 block 外唯一允许的声明。WebGL
2 把它们分配到 texture unit；WebGPU 则把每个 sampler 降级为独立的 texture/sampler binding 对。自定义
`ShaderMaterial` block 必须在首次使用前调用 `registerUniformBlockBinding()`，再通过
`createStd140Layout()` 和 `UniformBuffer.fromSchema()`
创建与更新；block 外的 float、vector、matrix、integer 或 boolean
uniform 会直接失败。共享 WebGPU 纹理契约接受 2D、cube 及其 shadow sampler；3D、2D-array 和 integer
sampler 会在 GLSL 准备阶段失败，不会拖到不可用的 bind
group。同名 UBO 还会在进入 Naga 前比较两个 shader stage 的布局。depth texture 必须使用 shadow
sampler；绑定到普通 `sampler2D`
会因为对应 WGSL 纹理类型不同而在 GPU 分配前失败。完整 Naga 流水线、四组 bind-group
ABI、迁移示例和 breaking changes 见[工程现代化改造记录](./ENGINEERING_MODERNIZATION.md)。

WebGPU 离屏渲染使用 `WebGPURenderTarget`，支持 MRT color attachment、4× MSAA
resolve、可选的可采样 depth/stencil、显式 present、resize 与对齐后的异步 readback。
`StageParameters<'webgpu'>` 会选择 WebGPU 专用 framebuffer 配置，因此 WebGL
framebuffer 参数不会在 WebGPU backend 中被静默忽略。

## 文档与示例

- [API 文档](https://hilo3d.js.org/docs/)
- [完整示例库](https://hilo3d.js.org/examples/list.html)
- [glTF Viewer](https://hilo3d.js.org/examples/glTFViewer/index.html)
- [工程现代化改造记录](./ENGINEERING_MODERNIZATION.md)
- [变更记录](./CHANGELOG.md)

API 页面由 TypeDoc 直接从已检查的 TypeScript 源码生成。仓库中的
[`etc/hilo3d.api.md`](./etc/hilo3d.api.md) 固化公共声明面，供代码审查比较。

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
- `npm run test:ui` 加载每个示例，并拒绝页面、控制台、请求和 WebGL 2 错误。
- `npm run test:webgpu` 在 Chromium SwiftShader 中创建真实 WebGPU
  adapter/device/pipeline，经 Naga 转译 GLSL，并验证 Basic/PBR、实例化、带 primitive
  restart 和局部更新的索引 strip、mipmap 纹理替换、三类阴影光源、4× MSAA/stencil、双 attachment
  MRT、离屏呈现与像素回读。
- `npm run test:visual` 比较确定性的渲染截图。
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
