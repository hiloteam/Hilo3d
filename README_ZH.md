<div align="center">
  <img src="./website/assets/hilo3d-logo.png" width="320" alt="Hilo3D" />

  <p><strong>面向生产级 2D 与 3D 体验的现代 Web 图形引擎。</strong></p>

  <p>
    可移植 RHI、经过验证的 Render Graph 与可脚本化渲染管线<br />
    共同驱动 WebGPU 和 WebGL 2 的统一渲染器。
  </p>

  <p>
    <a href="https://hilo3d.js.org/"><strong>官网</strong></a> ·
    <a href="https://hilo3d.js.org/examples/list.html">示例</a> ·
    <a href="https://hilo3d.js.org/docs/">文档</a> ·
    <a href="https://hilo3d.js.org/docs/modules/Hilo3d.html">API</a> ·
    <a href="./README.md">English</a>
  </p>

  <p>
    <a href="https://www.npmjs.com/package/hilo3d"><img src="https://img.shields.io/npm/v/hilo3d.svg?style=flat-square" alt="npm 版本" /></a>
    <a href="https://github.com/hiloteam/Hilo3d/actions/workflows/npm_test.yml"><img src="https://img.shields.io/github/actions/workflow/status/hiloteam/Hilo3d/npm_test.yml?style=flat-square" alt="CI 状态" /></a>
    <a href="https://github.com/hiloteam/Hilo3d/blob/dev/LICENSE"><img src="https://img.shields.io/npm/l/hilo3d.svg?style=flat-square" alt="MIT 许可证" /></a>
  </p>
</div>

> Hilo3D 2.0 目前处于 alpha 阶段。现有项目升级前应先查看
> [破坏性变更](./CHANGELOG.md#breaking-changes)。

## 为什么选择 Hilo3D

Hilo3D 在同一引擎中兼顾高层场景创作和底层 GPU 控制。应用始终使用同一套场景、材质、渲染目标与 shader 契约，渲染器则选择原生 WebGPU 路径或生产级 WebGL
2 兼容路径。

- **一个渲染器，两个后端** — `auto` 优先选择兼容的 WebGPU；WebGPU 不可用时使用 WebGL
  2。显式请求的后端绝不会静默切换。
- **现代材质与显示输出** — 支持 glTF
  2.0、分层 PBR、HDR 光照、Bloom、自动曝光、filmic 色调映射、transmission、volume、iridescence、clearcoat 与 anisotropy。
- **2D 与 3D 协同**
  — 统一提供场景图、网格、动画、相机、灯光、阴影、Sprite、文本、批处理、拾取和分层多相机合成。
- **GPU 驱动渲染** — 两个后端均支持实例化与多 Pass 渲染；WebGPU high-end profile 进一步提供 GPU
  Scene 剔除/LOD、Hi-Z、间接绘制 bucket 与 Clustered Forward+。
- **稳定的高端光照**
  — 提供 TAA/TAAU、动态分辨率、GTAO、SSR、SSGI、froxel 体积光、物理大气、时域云、云影与眼适应。
- **可塑造的帧流程** — 经过验证的 Render
  Graph 和可脚本化渲染管线统一协调阴影、场景 Pass、后处理、渲染目标、回读与最终呈现。
- **生产级生命周期** — 有界 GPU 缓存、增量上传、明确的资源所有权，以及 WebGPU device loss 和 WebGL
  context loss 恢复。

## 安装

```sh
npm install hilo3d
```

Hilo3D 只提供 ESM。目标环境是支持 WebGPU 或 WebGL 2 的现代浏览器；WebGL
1 和旧式全局构建不属于 2.0 契约。

## 使用 Codex 构建游戏

独立的 [`hilo3d-game` Agent Skill](https://github.com/hiloteam/Hilo3d/tree/dev/skills/hilo3d-game)
可以帮助 Codex 规划、搭建、实现、调试和优化 Hilo3D 2D、3D 与混合浏览器游戏。它使用已发布的 `hilo3d`
包，并放在 `.agents/skills` 之外，因此可随仓库分发，同时不会成为维护引擎源码时自动加载的贡献者指引。

## 创建第一个场景

```ts
import * as Hilo3d from 'hilo3d';

const camera = new Hilo3d.PerspectiveCamera({
    aspect: innerWidth / innerHeight,
    z: 4
});

const stage = await Hilo3d.Stage.create({
    backend: 'auto',
    container: document.querySelector('#app')!,
    camera,
    width: innerWidth,
    height: innerHeight
});

new Hilo3d.Mesh({
    geometry: new Hilo3d.BoxGeometry(),
    material: new Hilo3d.PBRMaterial({
        baseColor: new Hilo3d.Color(0.83, 0.12, 0.09)
    })
}).addTo(stage);

stage.addChild(new Hilo3d.AmbientLight({ amount: 1 }));

const ticker = new Hilo3d.Ticker(60);
ticker.addTick(stage);
ticker.start();
```

后端选择和 GPU 初始化都是异步过程，因此 `Stage.create()` 也是异步工厂。应用需要指定后端时，可以使用
`backend: 'webgpu'` 或 `backend: 'webgl2'`。

## 查看引擎实际效果

<table>
  <tr>
    <td width="33.33%"><a href="https://hilo3d.js.org/examples/bloom.html?backend=webgpu"><img src="./website/assets/example-bloom.webp" alt="HDR Bloom 示例" /></a></td>
    <td width="33.33%"><a href="https://hilo3d.js.org/examples/gltf_material_extensions.html"><img src="./website/assets/example-gltf-materials.webp" alt="glTF 材质扩展示例" /></a></td>
    <td width="33.33%"><a href="https://hilo3d.js.org/examples/compute_raytracing.html?backend=webgpu"><img src="./website/assets/example-compute-raytracing.webp" alt="Compute 路径追踪示例" /></a></td>
  </tr>
  <tr>
    <td><strong>HDR Bloom</strong><br />由引擎后处理管线塑造的 compute 驱动光效。</td>
    <td><strong>glTF 材质扩展</strong><br />在共享 WebGPU/WebGL 2 渲染器中展示分层 Khronos 资产。</td>
    <td><strong>Compute 路径追踪</strong><br />包含降噪、焦散和 HDR 输出的渐进式 WebGPU 路径追踪。</td>
  </tr>
</table>

[浏览完整示例库 →](https://hilo3d.js.org/examples/list.html)

## 现代渲染技术栈

可选的 WebGPU high-end profile 与可移植渲染器共用同一套 Scene、Material、Render
Graph 和 RHI 契约。不支持的设备会在 runtime 创建前通过 capability 检查明确失败；不在原生 GPU
Scene 覆盖范围内的兼容 Mesh 会继续走共享 Forward 路径，并合成进同一线性 HDR 帧。

| 系统               | 当前生产切片                                                                                          |
| ------------------ | ----------------------------------------------------------------------------------------------------- |
| GPU Scene          | 脏对象/材质数据库、previous-frame Hi-Z 遮挡、projected-radius LOD、紧凑可见区间与固定 indirect bucket |
| Clustered Forward+ | depth-driven 3D cluster、有界且确定性的灯光分配、storage PBR、共享方向光/聚光/点光阴影与 LTC 面光     |
| 时域渲染           | Motion Vector、authored reactive mask、原生 TAA、0.5–1.0 TAAU 与 timestamp 驱动的动态分辨率           |
| 屏幕空间光照       | WebGPU/WebGL 2 可移植 GTAO 与 SSGI，以及 WebGPU Clustered hierarchical SSR                            |
| 体积与天气         | Froxel 高度雾/局部雾、方向光/点光/聚光注入、物理大气 LUT、时域云与云影                                |
| HDR 显示           | GPU histogram 曝光、非对称眼适应、Bloom 与可配置 filmic 显示变换                                      |

可以体验
[Clustered Sponza 实验室](https://hilo3d.js.org/examples/clustered_forward_plus_sponza.html)、
[Temporal Observatory](https://hilo3d.js.org/examples/temporal_aa_observatory.html)、
[Silent Dragon GTAO](https://hilo3d.js.org/examples/ground_truth_ambient_occlusion.html)、
[Afterimage SSR](https://hilo3d.js.org/examples/screen_space_reflections_palace.html)、
[Prismatic Vespers SSGI](https://hilo3d.js.org/examples/screen_space_global_illumination_chapel.html)、
[Neon Reliquary 体积光](https://hilo3d.js.org/examples/volumetric_neon_reliquary.html)和
[Stormfront Observatory](https://hilo3d.js.org/examples/stormfront_observatory.html)。

完整的已完成边界、兼容路径和后续流送/虚拟化工作见
[现代 WebGPU 渲染路线图](./documentation/MODERN_WEBGPU_RENDERING_ROADMAP.md)。

## 渲染 Profile

|              | 可移植 Profile                                             | WebGPU High-end Profile                                            |
| ------------ | ---------------------------------------------------------- | ------------------------------------------------------------------ |
| 后端         | WebGPU 与 WebGL 2                                          | WebGPU                                                             |
| 场景与材质   | 共享场景图、PBR 材质、glTF、Sprite、文本                   | 同一公开模型，加注册 PBR bucket 与 Forward fallback                |
| 帧合成       | Render Graph、渲染目标、MRT、MSAA、后处理                  | 同一 Render Graph，加 GPU Scene、clustered lighting 与原生 compute |
| 光照与画质   | Forward PBR、阴影、GTAO、SSGI、TAA/TAAU、Bloom、Color Uber | 追加 Hi-Z SSR、动态分辨率、froxel、大气/云、自动曝光               |
| GPU 工作负载 | 实例化、uniform buffer、增量资源上传                       | Compute、storage buffer/texture、indirect GPU 工作流               |
| Shader 路径  | 人工编写 GLSL ES 3.00                                      | Raster GLSL → Naga → WGSL；经过验证的 Direct WGSL compute          |
| 恢复         | WebGL context 恢复或 WebGPU 资源重建                       | WebGPU device 重获取与 submission-aware history 重建               |

WebGPU-only 功能在 WebGL 2 上会明确通过 capability 检查失败，不会被不完整地模拟。

## 架构概览

```text
场景 · 材质 · 2D · 动画 · 灯光
                    │
                共享渲染器
                    │
       Render Graph · 可脚本化渲染管线
                    │
               可移植 RHI
              ┌─────┴─────┐
           WebGPU       WebGL 2
```

共享渲染器负责场景收集、剔除、排序、实例化、阴影、后处理、绘制准备和资源协调。生产帧统一流经 Render
Graph 与可移植 RHI；后端代码只负责原生 API 执行。

Raster shader 只有一份 GLSL ES 3.00 源码。WebGL
2 直接编译该源码；WebGPU 路径先进行引擎预处理，再通过 Naga 生成 WGSL。WebGPU-only
compute 使用引擎经过验证的 `ComputeShader` 契约。

完整的帧、资源、shader 与恢复契约见 [渲染架构文档](./documentation/RENDERING_ARCHITECTURE.md)。

## 文档

- [入门与 API 文档](https://hilo3d.js.org/docs/)
- [示例库](https://hilo3d.js.org/examples/list.html)
- [`hilo3d-game` Agent Skill](https://github.com/hiloteam/Hilo3d/tree/dev/skills/hilo3d-game)
- [工程文档索引](./documentation/README.md)
- [渲染架构](./documentation/RENDERING_ARCHITECTURE.md)
- [PBR、HDR 与后处理](./documentation/PBR_AND_POST_PROCESSING.md)
- [现代 WebGPU 渲染路线图](./documentation/MODERN_WEBGPU_RENDERING_ROADMAP.md)
- [材质系统现代化](./documentation/MATERIAL_SYSTEM_MODERNIZATION.md)
- [时域渲染](./documentation/TEMPORAL_RENDERING_REMEDIATION.md)
- [屏幕空间全局光照](./documentation/SCREEN_SPACE_GLOBAL_ILLUMINATION.md)
- [Froxel 体积光](./documentation/VOLUMETRIC_LIGHTING.md)
- [物理大气与天气](./documentation/PHYSICAL_ATMOSPHERE_AND_WEATHER.md)
- [2D 渲染与多相机合成](./documentation/2D_RENDERING.md)
- [可脚本化渲染管线](./documentation/SCRIPTABLE_RENDER_PIPELINE_PLAN.md)
- [破坏性变更](./CHANGELOG.md#breaking-changes)

## 本地开发

需要 Node.js 20.19.0 或更高版本，以及仓库声明的 npm 版本。

```sh
npm ci
npm run dev
```

常用命令：

```sh
npm run examples:dev  # 在本地运行示例库
npm run typecheck     # 检查维护中的 TypeScript
npm run test          # 运行测试套件
npm run validate      # 运行完整发布验证
```

提交 Pull Request 前请先阅读[贡献指南](./.github/CONTRIBUTING.md)。

## 许可证

[MIT](./LICENSE) © Hilo3D contributors.
