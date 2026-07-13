# Hilo3d 现代前端工程改造记录

状态：已完成 · 目标版本：2.0.0 · 最后核验：2026-07-13

范围：源码、示例、测试、构建、类型声明、API 文档、站点、npm 包、CI 与发布流程

## 结论

本仓库已经从“JavaScript 文件改名为 TypeScript、但主体仍按旧工程运行”的过渡状态，改造成一套单一、严格、可复现的现代前端库工程。

现在的工程事实是：

- 所有一方维护的引擎源码、示例、测试和 Node 工具均为受严格检查的 TypeScript；`src/` 与 `examples/`
  中不再存在一方 JavaScript 实现，`npm run check:modernity`
  会阻止旧 JavaScript 或旧构建配置重新进入受维护目录。
- 源码与发布物统一使用原生 ESM、原生 `class`、显式领域类型和标准浏览器 API；旧动态类/mixin
  API 与 CommonJS/UMD 输出已完全删除。
- 渲染器提供显式选择的 WebGL 2 与 WebGPU 双后端。两者共享唯一一份 GLSL ES 3.00
  shader 源码；WebGPU 严格执行“引擎预处理 → Vulkan GLSL 4.50 → Naga WASM →
  WGSL”，不存在手写 WGSL 镜像、WebGL 1、GLSL 1.00 或逐项 numeric uniform 路径。
- Vite 负责库与多页面示例构建，Vitest Browser
  Mode 在真实 Chromium 环境中运行单元测试；Playwright 覆盖全部 WebGL
  2 示例、确定性视觉回归，并用真实 WebGPU adapter/device/pipeline 完成独立运行时验收。
- 类型声明、TypeDoc API 页面和 API Extractor 签名报告全部从同一份已检查源码生成。
- npm 发布物按真实 tarball 校验，而不是只检查仓库内文件；CI 和发布共用唯一的 `npm run validate`
  门禁。
- 旧 Gulp、Webpack、Babel、Mocha、JSDoc、手写声明、旧 `build/`、已提交的旧
  `docs/`、旧测试页、运行时 vendor 脚本和远程 CDN 依赖已经退出活跃工程。

本次改造没有使用 `@ts-nocheck`、`@ts-ignore`、`@ts-expect-error`、显式
`any`、目录级 lint 逃逸、空视觉断言、覆盖率排除核心目录或捕获错误后继续成功等临时手段。

## 改造结果

| 领域     | 改造前                                                  | 当前实现                                                               |
| -------- | ------------------------------------------------------- | ---------------------------------------------------------------------- |
| 语言     | 大量 `.ts` 仅透传旧 JavaScript，主体使用 `Class.create` | 全部一方代码严格 TypeScript；对象模型统一为原生 class 与 ESM           |
| 类型检查 | 单一配置混合浏览器、测试与 Node 环境                    | `base/lib/test/examples/node` project references，严格规则全覆盖       |
| 静态质量 | lint 文件白名单，无统一 formatter                       | typed ESLint flat config 覆盖整仓，Prettier 与 EditorConfig 固化格式   |
| 库构建   | Gulp、Webpack、Babel 和历史 polyfill                    | Vite 8 + Rolldown，ES2022 ESM、Naga/WASM 按需分包与完整 source map     |
| 类型发布 | 手工维护的 namespace/CommonJS 声明                      | `tsc` 从源码 emit，声明 rollup 后由 Bundler/NodeNext 消费配置校验      |
| API 契约 | JSDoc 静态产物，与源码和包入口脱节                      | TypeDoc 零警告文档 + API Extractor 签名基线                            |
| 单元测试 | 旧断言、旧 mock、浏览器错误不一定失败                   | Vitest 原生 `expect`/`vi`，Chromium Browser Mode，错误门禁与 V8 覆盖率 |
| UI 测试  | 少量代表页面 smoke test                                 | Playwright 覆盖全部示例、WebGL 2 错误与真实 WebGPU 绘制                |
| 视觉测试 | 截图比较为空实现                                        | Linux Chromium/SwiftShader 确定性基线与像素差异阈值                    |
| 示例     | 旧全局变量、vendor 脚本、远程运行时资源                 | 严格 TS 多页面应用，本地 npm 依赖与本地静态资产                        |
| 渲染 ABI | WebGL 1/2 分支、GLSL 1.00 转译与逐项 uniform            | WebGL 2 + WebGPU、GLSL→Naga→WGSL、按频率分组的固定 std140 UBO ABI      |
| npm 包   | 仓库内入口能运行即视为通过                              | publint、Are the Types Wrong、Bundler/NodeNext 与真实 ESM 运行时消费   |
| CI/发布  | 老版本 Actions、Node 与零散命令                         | Node 22 最低版本 + Node 24 双矩阵，npm 12、Chromium、单一完整门禁      |
| 文档站点 | 跟踪旧生成物                                            | CI 现场生成 TypeDoc 与 Vite 示例站点并部署 Pages                       |

## 语言与架构

### 严格 TypeScript 全覆盖

共享配置启用了 `strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、
`noImplicitOverride`、`noImplicitReturns`、`verbatimModuleSyntax`、`isolatedModules`、
`noFallthroughCasesInSwitch` 等规则。根 `tsconfig.json` 只维护 project references：

- `tsconfig.lib.json`：浏览器引擎源码与 declaration emit；
- `tsconfig.test.json`：Vitest 浏览器测试；
- `tsconfig.examples.json`：全部示例应用；
- `tsconfig.node.json`：Vite、Vitest、ESLint、Playwright 和工程脚本。

生产源码不会被测试全局类型或 Node 类型污染。lint 同时使用 TypeScript 类型信息检查
`src/`、`examples/`、`test/`、`scripts/` 与工程配置，生成物是唯一的目录级忽略对象。

### 原生对象模型

引擎内部的 scene
graph、renderer、geometry、material、texture、loader、animation、math、light、camera 与 helper 均已迁移到原生类。构造参数、事件、WebGL 资源、uniform、shader
semantic、glTF、动画状态、纹理来源等动态结构均有明确的 interface、union 或 generic。

旧 `Class.create`、`Class.mix` 与 `EventMixin`
已从源码、根 barrel、类型声明和测试删除。所有可监听对象直接继承类型化的
`EventDispatcher`，资源生命周期统一使用 backend-neutral
`releaseGPUResources()`；不保留 backend 名称泄漏到公共 API 的旧别名。

### 运行时与资源

- 应用通过 `backend: 'webgl2' | 'webgpu'` 选择图形后端；新代码应使用 `await Stage.create(...)`
  等待后端完成初始化。省略字段使用文档化的 WebGL 2 默认值，但显式请求 WebGPU 后绝不会静默回退。
- WebGL 2 上下文创建失败会直接报告不支持，不再尝试 WebGL
  1 或扩展模拟核心能力。WebGPU 会显式申请 adapter、校验 required
  feature/limit、创建设备并初始化 Naga WASM；任一步失败都会 reject
  `ready`。Naga 首次加载或 WASM 初始化失败不会污染进程级 Promise，后续新 renderer 可以重试。运行中 device
  lost 会按 generation/device identity 过滤旧回调，释放 managers、context 与 GPU 资源，发出
  `webgpuDeviceLost` 并进入终止失败态。
- VAO、实例化、MRT/draw buffers、三维/数组纹理和 UBO 均使用 WebGL 2 core
  API；扩展注册表只保留各向异性过滤、context loss、浮点颜色附件和纹理压缩格式等真正可选能力。
- 删除 `KHR_techniques_webgl` loader、类型和 SampleTechniques 资产。该历史扩展以任意 GLSL
  1.00 与 classic numeric uniform 为接口，无法满足固定 UBO
  ABI；仅改内置样例而继续宣称支持会使外部资产在 program link 时失败，因此不保留伪兼容入口。
- 删除 AMC 专有扩展；相关演示资产转换为标准 glTF。
- WebXR 使用标准 WebXR 类型与浏览器 API。
- 物理示例使用
  `cannon-es`。原 Draco 示例适配器及演示资产已退出：上游只提供 UMD/CommonJS 风格的浏览器 wrapper，而可用的纯 TypeScript 候选无法通过本仓库的严格 TypeScript
  6 声明检查；不通过构建期字符串改写、假声明或 `skipLibCheck` 伪装成现代模块。
- OSG、SMD、TGA 等示例 loader 都是严格 TypeScript，不再依赖旧 vendor 全局对象。
- 示例运行时资源来自仓库或 npm 依赖，不依赖第三方 CDN 才能通过测试。
- Vite 配置不读取、截断或改写 `node_modules`
  中的 UMD/CommonJS 源码；依赖必须提供可直接消费的 ESM 与严格类型契约，否则删除该集成，等待合格实现后再按正常模块边界接入。

## 双后端渲染与 shader ABI

### 显式后端选择

`Stage` 的公共后端类型只有 `webgl2` 与 `webgpu`。推荐统一使用异步工厂，让调用点明确表达初始化边界：

```ts
const webglStage = await Stage.create({ backend: 'webgl2', camera });
const webgpuStage = await Stage.create({ backend: 'webgpu', camera });
```

省略 `backend` 只表示选择文档化的 WebGL
2 默认值，不是能力探测。显式选择 WebGPU 后，浏览器不支持、adapter 不存在、feature/limit 不满足、device 丢失或 shader 编译失败都会成为可观察错误；禁止捕获后创建 WebGL
2 renderer、关闭 feature 或换一条低能力渲染路径继续运行。

WebGL 2 backend 直接使用 core API 和原生 GLSL ES 3.00；项目不创建 WebGL 1 context，不保留 WebGL 1
extension adapter，也不接受 GLSL 1.00 自定义 shader。

### GLSL 预处理 → Naga → WGSL

两个后端共享 `src/shader/` 中唯一一份 GLSL ES
3.00 源码。WebGPU 不维护第二套手写 WGSL，而是对每个已解析的 shader variant 执行确定流水线：

1. 先由引擎解析
   `#define`、条件分支与 include，得到当前材质、灯光、geometry 和 render-state 对应的有效源码；
2. 将有效 GLSL ES 3.00 准备为 Naga 接受的 Vulkan GLSL 4.50：注入
   `HILO_WEBGPU`、分配稳定且紧凑的 vertex/varying/fragment location、拆分 matrix IO、把 std140
   block 映射到固定 set/binding；
3. 把 GLSL combined sampler 拆成 WebGPU 独立 texture/sampler
   binding，并展开只使用编译期常量索引的 sampler array；动态 sampler array 索引直接报错；
4. 把用户 `main` 改为内部函数，再生成稳定 entry wrapper；wrapper 在用户函数返回后完成 matrix
   varying 写回以及 WebGL `[-w, w]` 到 WebGPU `[0, w]` 的 clip-space
   depth 转换，因此用户代码中的提前 `return` 也不能绕过后处理；
5. 比较顶点与片元阶段同名 UBO 的规范字段签名；字段类型、顺序、数组长度或宏展开结果不一致时，在进入 Naga 前直接失败；
6. 最后调用 `web-naga` 的 WASM GLSL frontend 生成 WGSL，并用 WGSL 建立 shader module 与 pipeline。

预处理结果同时输出 vertex inputs、fragment outputs、uniform blocks 与 sampler
bindings 元数据；pipeline、vertex layout 与 bind
group 都消费同一份结果，不再各自用正则猜测接口。Naga 错误保留 stage 和送入 Naga 的完整 GLSL
4.50，避免只暴露下游 WGSL 错误。内置 Basic/PBR、灯光、阴影、skinning、morph、instancing、quantized、geometry 和 screen
shader corpus 都必须在单元测试中真实通过 Naga。

shader variant key 使用当前 geometry 产生的完整结构宏签名，包括四类 decode、color
size 与 morph 结构，而不是缓存某个 geometry 首次渲染时的粗略布尔值。公共 precision
header 按 renderer 实例参与 shader cache key，因此不同 WebGL 2/WebGPU
renderer 或运行时 precision 变化不会交叉复用错误源码。

### 按更新频率固定的 UBO 与 bind group

所有内置数值 shader 数据按所有权和更新频率进入固定 std140 block。WebGL 2 使用稳定的 flat
binding；WebGPU 将同一逻辑 ABI 分到四个 bind group，避免高频对象数据导致全局或材质资源重新绑定：

| Block           | 数据所有者与典型内容                        | 更新时机                      | WebGL 2 | WebGPU |
| --------------- | ------------------------------------------- | ----------------------------- | ------: | -----: |
| `FrameBlock`    | render size、时间与帧序号                   | 每个 renderer frame 一次      |       0 |    0/0 |
| `CameraBlock`   | view/projection、逆矩阵、相机位置与裁剪平面 | 每个 camera/render pass 一次  |       1 |    0/1 |
| `SceneBlock`    | fog 等 scene-owned 状态                     | scene revision 变化时         |       2 |    0/2 |
| `LightBlock`    | view-space 灯光、衰减、阴影 atlas 参数      | 每个 camera/render pass 一次  |       3 |    0/3 |
| `MaterialBlock` | Basic/PBR、IBL、UV 变换与材质标志           | material revision 变化时      |       4 |    1/0 |
| `ModelBlock`    | model 与 world-normal 变换                  | 非实例对象 transform 变化时   |       5 |    2/0 |
| `GeometryBlock` | position/normal/UV decode 变换              | geometry revision 变化时      |       6 |    2/1 |
| `SkinningBlock` | joint palette                               | skeleton pose 变化时          |       7 |    2/2 |
| `MorphBlock`    | morph weights 与 target 状态                | morph pose 变化时             |       8 |    2/3 |
| `InstanceBlock` | 每批 model/normal matrix array              | WebGPU instanced batch 变化时 |       — |    2/4 |

WebGPU group 0 是 frame/pass/scene 全局域，group 1 是 material 与纹理域，group
2 是 object/geometry/pose 域，group
3 专供应用自定义 block。自定义 block 仍先通过共享 registry 注册：WebGL 2 flat binding
9 映射到 WebGPU group 3 binding 0，后续依次递增。内置名称和位置不允许按 shader variant 临时分配。

引擎在创建 backend 时校验 uniform buffer 数量、单 block 大小、alignment、bind
group 数量、纹理/vertex 资源上限和显式 required feature/limit。std140 schema 由 offset、matrix
stride、array stride 与固定 ABI 测试锁定；CPU revision 与 dirty byte
range 驱动上传，禁止为了“统一”而在每次 draw 重建或整块重传所有 block。

GeometryData、Geometry、Material 与 Texture 都发布单调 revision；每个 renderer/device 分别记录自己已经上传的版本，不清除会影响另一个 backend 的全局脏标记。WebGL
2 还为每个 VAO 单独记录 attribute/index 的 revision、shape 与 count，不能让阴影 VAO 的首次上传吞掉主渲染 VAO 的绑定更新。partial
buffer/texture/UBO 更新保留带 revision 的有界快照，上传成功后只推进当前 backend 的游标；慢消费者越过 64 条 UBO
history 后执行一次完整上传，再恢复 partial。同一 mesh 在阴影、主渲染和呈现 pass 中产生的资源先在 frame
epoch 内求并集，只有完整帧成功后才原子提交和 diff；异常帧回滚并回收失败帧孤儿，未参与本帧的 mesh 保留上一份完整快照。owner 释放会同时删除 CPU
UBO cache 和 native wrapper。pipeline、layout、sampler 与 bind-group
cache 都有明确的失效或容量边界；vertex/instance/index buffer variant 使用 per-owner
LRU，pipeline 把不可淘汰的 in-flight 去重层与已完成的有界 LRU 分开。UBO/texture
identity 变化只失效 bind group，不重建稳定的 pipeline
layout，资源 churn 不会让历史 variant 永久常驻、重复并发编译或触发无关 pipeline 重编译。

当前灯光着色使用 view-space 数据，因此 `LightBlock` 与 `CameraBlock`
同属 render-pass 频率。环境贴图、球谐与 IBL 强度允许逐材质变化，因此属于
`MaterialBlock`。WebGPU 阴影资源使用单一 depth-comparison atlas；atlas 尺寸、slice
rect、bias 与 light-space matrix 都进入 `LightBlock`，不会退回逐灯散装 uniform 或占用一组 sampler
array。

固定 ABI 同时固定容量：最多 8 个 directional light、8 个 spot light、16 个 point light、8 个 area
light、128 个 skin joint、8 个 morph weight 与每个 WebGPU instanced batch
128 个实例。超过容量必须分批或抛出带领域名称的错误；禁止截断数组、复用最后一项或退回 classic
uniform。

### texture 与 sampler 是 opaque resource 例外

GLSL opaque sampler 不能成为 uniform block 成员，因此 sampler 是 block 外唯一合法的 `uniform`
声明。WebGL 2 在 program link 后为 active sampler 分配整数 texture
unit；WebGPU 预处理器把同一声明降级为独立的 texture/sampler binding pair。材质纹理、环境贴图、BRDF
LUT、LTC、shadow atlas 和 post-process input 都遵守这一规则。

共享的 WebGPU shader/texture 契约接受引擎实际提供的 2D、cube 及其 shadow
sampler；3D、2D-array 与 integer
sampler 不会先生成一个无法绑定的 pipeline，而是在 GLSL 准备阶段以带声明名称和类型的错误明确拒绝。depth
texture 必须使用 shadow sampler；普通 `sampler2D` 会被 Naga 表达为
`texture_2d<f32>`，无法与 WebGPU 的 `texture_depth_2d`
安全混用，因此绑定在任何 GPU 分配前明确失败。sampler 本身仍按完整 descriptor 缓存，并在 resolved
binding 中保存不可变快照，互不覆盖。

任何 block 外的 float、vector、matrix、integer、boolean 或其数组都会被拒绝，不能借
`ShaderMaterial`、`onBeforeCompile`、示例代码或 backend 分支绕过。纹理 UV
channel、强度、尺寸、阈值和 kernel 等数值元数据必须进入 Scene、Light、Material 或注册过的自定义 block；opaque
resource 例外不是保留通用逐项 uniform 系统的理由。

### Render target、MRT 与 readback

`StageParameters<Backend>` 会根据 backend 选择对应的 framebuffer/render-target 配置，不能把 WebGL
`FramebufferParameters` 静默透传给 WebGPU。WebGPU renderer 提供
`createRenderTarget()`、`setRenderTarget()` 与
`present()`；显式 target 的所有权和是否 present 都由参数表达，不通过隐藏全局 framebuffer 状态猜测。

`WebGPURenderTarget` 支持多 color attachment、4× MSAA
resolve、可选 depth/stencil、可采样 color/depth
texture、resize 与异步 readback。readback 遵守 WebGPU 每行 256-byte
alignment，并在返回前压紧为调用方请求的区域。非法 attachment 格式、跨 device target、MSAA depth
sampling、无附件 target、销毁后复用和 depth-only present 都直接报错。

`useFramebuffer` 在 WebGPU 下创建 renderer-owned sampleable target，并通过独立 fullscreen present
pass 输出到 canvas；它不是被忽略的 WebGL 参数。target-owned texture 仍使用引擎 `Texture`
identity，因此材质 sampler、bind-group cache 与资源释放共享同一生命周期，不复制一套旁路纹理系统。

### 实例化、骨骼与 morph 边界

- WebGL 2 使用 instanced vertex attributes 传递每实例 model/normal matrix；WebGPU 使用 group 2 的
  `InstanceBlock`，由 `gl_InstanceIndex`
  读取固定数组，并在超过 128 个实例时拆成多个 draw。两个路径都由 `HILO_WEBGPU` 的编译期 shader
  variant 明确表达，不运行时改写 uniform 声明。
- `ModelBlock` 只服务普通 draw 或整个 batch 的公共数据；model-view 与 MVP 在 shader 中由
  `CameraBlock × ModelBlock` 推导，不重复上传 camera-dependent 派生矩阵。
- vertex geometry/morph attribute 按兼容格式打包到尽量少的 interleaved GPU buffer，并同时校验
  `maxVertexAttributes` 与 `maxVertexBuffers`；不能假设开发机暴露超过 WebGPU 保证下限的 slot。
- geometry decode 变换属于低频 `GeometryBlock`，绝不能因为 vertex shader 使用它就退化为每 model
  draw 重写。
- joint index/weight 和 morph target 仍是 vertex attribute；joint palette 进入
  `SkinningBlock`，morph weight 进入
  `MorphBlock`。骨骼、形变与实例化组合必须使用各自 revision，不能共享错误 pose。

### ShaderMaterial 迁移

旧的数值 semantic/uniform 写法：

```ts
new ShaderMaterial({
    uniforms: {
        u_color: {
            get: () => [1, 0, 0, 1]
        }
    }
});
```

必须迁为注册过的 std140 block：

```ts
import {
    ShaderMaterial,
    UniformBuffer,
    createStd140Layout,
    registerUniformBlockBinding
} from 'hilo3d';

registerUniformBlockBinding('EffectBlock');

const effectLayout = createStd140Layout({
    color: 'vec4',
    strength: 'float'
});
const effectBlock = UniformBuffer.fromSchema(effectLayout, {
    color: [1, 0, 0, 1],
    strength: 0.75
});

const material = new ShaderMaterial({
    attributes: { a_position: 'POSITION' },
    uniformBlocks: { EffectBlock: effectBlock },
    vs: `#version 300 es
        layout(std140) uniform EffectBlock {
            vec4 color;
            float strength;
        };
        in vec3 a_position;
        out vec4 v_color;
        void main() {
            v_color = vec4(color.rgb * strength, color.a);
            gl_Position = vec4(a_position, 1.0);
        }`,
    fs: `#version 300 es
        precision highp float;
        in vec4 v_color;
        layout(location = 0) out vec4 outColor;
        void main() {
            outColor = v_color;
        }`
});

effectBlock.set('strength', 1);
```

如果自定义 shader 使用相机、场景或模型数据，应声明对应的 canonical
block，而不是复制一套同义散装 uniform。如果使用纹理，sampler 可以保留在 block 外；与纹理相关的其他数值仍放在 block 内。

## 构建、包与发布契约

### 构建格式

- 根入口 `hilo3d`：唯一的 ES2022 ESM 入口；`gl-matrix` 保持 external，便于依赖去重。
- `web-naga` 通过动态 import 进入发布模块图；主引擎 chunk 约 1.06 MB，约 2.05 MB 的 Naga
  JavaScript/WASM 作为独立 chunk，只在 WebGPU 初始化时请求，不增加纯 WebGL 2 应用的初始下载。
- 不发布 `require` condition、CommonJS/UMD 文件、浏览器全局对象或 namespace 声明镜像。
- ESM 模块产物带许可证 banner 和完整 source map；单一公共入口不等于把可选编译器内联为单文件。
- `.d.ts` 与 `.d.ts.map` 由 `src/Hilo3d.ts` 的真实依赖图生成，不存在手写镜像声明。

`package.json` 用 `exports` 明确入口，`files` 只允许发布
`dist/`、README、CHANGELOG 与许可证。Node 最低版本、npm 版本和 ESM 包语义都有机器可读约束。

### 包消费验证

发布校验覆盖：

1. `moduleResolution: "Bundler"` 的 ESM 类型消费；
2. `moduleResolution: "NodeNext"` 的 ESM 类型消费；
3. 根 ESM 的 Node 运行时导入；
4. 安装真实 tarball 后初始化 Naga WASM 并完成一次 GLSL→WGSL 转译；
5. publint 包结构检查；
6. Are the Types Wrong 导出条件检查；
7. `npm pack --dry-run` 文件白名单检查。

校验对象是构建后的真实包内容，因而能够发现错误 export
condition、缺失声明、错误扩展名、未发布依赖或多打包文件。

## API 文档与站点

API 工程有两个互补产物：

- `npm run docs:build` 使用 TypeDoc 从 `src/Hilo3d.ts`
  生成可浏览的 API 站点，并把本文件、中文 README、CHANGELOG 与贡献规则作为 project
  documents 纳入同一个站点；无效链接、未导出类型和文档警告都会失败。
- `npm run api:check` 使用 API Extractor 将当前声明与 [`etc/hilo3d.api.md`](./etc/hilo3d.api.md)
  比较；公共签名意外改变会失败，计划内变更必须运行 `npm run api:update` 并审查 diff。

API Extractor 通过 `--typescript-compiler-folder node_modules/typescript` 使用项目锁定的 TypeScript
system declarations。这样 WebGPU DOM 类型、声明 emit 与 API 分析使用同一版本，不会让工具内置的旧
`lib.dom.d.ts` 猜测或漏掉 `GPU*` 公共类型；这保留全部 API 检查，只消除编译器版本漂移。

API Extractor 的 release-tag 提示按项目级固定政策关闭：Hilo3d
2.x 的根 barrel 导出面全部视为 public，不设置 alpha/beta 分层。setter 文档提示也按固定政策关闭：访问器说明由 getter/TypeDoc 作为唯一正文来源。两项都不关闭 TypeScript 诊断、forgotten
export、API 差异或 TypeDoc 验证，也不是待删除的迁移豁免。

`WebGPURenderer`、backend-neutral `Renderer`、`Stage<'webgpu'>`、Naga translator 元数据和 WebGPU
binding API 都从根 barrel 导出，因而同时进入 `.d.ts`、TypeDoc 与 API
report；不存在只在内部可用、文档手写声称支持的影子 API。

`npm run site:build` 将 TypeDoc 输出放入 `/docs/`，将完整 Vite 示例构建放入
`/examples/`，再生成站点根跳转与 `CNAME`。生成目录不提交到主工作树，由 Pages 工作流每次重新构建。

## 测试体系

### 单元测试与覆盖率

单元测试运行于 Vitest Browser Mode + Playwright
Chromium，因此 DOM、Canvas 与 WebGL 行为来自真实浏览器上下文。WebGPU 资源管理器、std140/WGSL
layout、bind group、pipeline state、buffer packing 与 texture lifecycle 使用确定的 typed device
doubles 做边界测试；shader corpus 则加载真实 Naga WASM 完成 GLSL→WGSL 编译。测试初始化会把未预期的
`console.error`、shader compile/link error 与未捕获异常升级为失败。

覆盖率统计显式包含
`src/**/*.ts`，仅排除声明文件；没有为了达到数字排除 loader、renderer、animation 等低覆盖模块。阈值是完整源码的无回退基线：`60/40/58/62`
分别约束statements/branches/functions/lines。后续改动不得降低基线；新增功能应同时提高相关模块覆盖率。

### 全量 WebGL 2 UI 测试

Playwright 自动从示例构建输入生成页面清单，不维护容易漏项的手工白名单。全部 HTML 示例都必须通过以下检查：

- 页面完成加载并创建预期 Canvas；
- 无 `pageerror`；
- 无非预期 `console.error`；
- 无失败的本地资源请求；
- 无 shader compile/link 或 WebGL 初始化错误；
- loader 示例的异步模型与纹理真实完成请求。

示例套件按页面串行执行，以避免多个 SwiftShader
WebGL 上下文同时加载大型模型时争抢 GPU/内存；断言本身没有减少，也没有重试掩盖失败。

### WebGPU 真实运行时测试

`npm run test:webgpu` 在 Chromium 中启用 SwiftShader WebGPU adapter，创建真实
`GPUAdapter`、`GPUDevice`、canvas context、Naga shader module、bind group、render
pipeline 与 command encoder，在同一帧覆盖 Basic/PBR、`InstanceBlock` 批处理、带 primitive
restart 和局部更新的 Uint8 indexed strip、mipmap 2D
texture 替换、directional/spot/point 三类阴影、4× MSAA/stencil offscreen target、双 attachment
MRT、fullscreen present 与对齐 readback。测试同时断言 backend、draw count、face
count、attachment/sample count、texture revision、非零像素、GPU validation
error、页面异常和控制台错误；它不是只检查 `navigator.gpu`、只 mock device 或只测试 WGSL 字符串。

WebGPU shader
corpus 与真实运行时测试是互补门禁：前者扩大 feature/variant 覆盖，后者证明浏览器端 Naga
WASM 加载、pipeline creation、draw 与 queue submission 端到端可用。

### 视觉回归

视觉套件使用固定 viewport、UTC、英文 locale、固定 device scale、禁用动画的 Linux
Chromium 和 SwiftShader。基线场景使用确定性的灯光 PBR 立方体，截图保存在
`test/ui/__screenshots__/`，像素差异比例上限为 0.5%。失败时保留 screenshot、trace 与 video 供定位。

## CI 与站点发布

CI 在 Node 22.22.2 与 Node 24 两档执行，使用当前维护的 GitHub Actions、锁文件安装、固定 npm
12.0.1 和显式 Chromium 系统依赖。PR、`dev`、`master` 与版本 tag 使用同一个
`npm run validate`；过期任务由 concurrency 自动取消。Chromium 同时启用确定性的 SwiftShader WebGL
2 与 WebGPU adapter，WebGPU 验收不依赖 CI runner 是否暴露物理 GPU。

站点发布工作流同样从干净 checkout 执行 `npm ci` 和
`npm run site:build`，再部署生成 artifact。仓库不再跟踪旧 API 生成物，也不会从开发者本机的残留目录发布。

## 唯一验收入口

```sh
npm ci
npx playwright install chromium
npm run validate
```

`validate` 按顺序执行：清理生成物、旧 JavaScript/旧工具配置门禁、格式检查、typed
lint、全部 TypeScript project references、浏览器单测与覆盖率、库构建、两类 ESM 类型消费、全量 WebGL
2
UI、真实 WebGPU 绘制、视觉回归、全部示例构建、TypeDoc 验证、API 签名比较、npm 包契约验证和 pack 文件检查。任一步失败都会阻止 CI 与发布。

其中 shader 静态门禁会同时扫描 `src/shader/` 和示例中的 shader 源码：禁止 GLSL 1.00
`attribute`/`varying`、`texture2D`/`textureCube`、`gl_FragColor`/`gl_FragData`、WebGL 1 shader
extensions，以及 block 外的 non-sampler `uniform`。运行时门禁会再次在 program link 或 Naga
translation 时拒绝漏网接口，静态规则、WebGL 2 link、Naga corpus 与真实 WebGPU pipeline 互为补充。

## 验收清单

- [x] 一方源码、示例、测试与脚本没有类型检查绕过或显式 `any`。
- [x] `check:modernity` 阻止 `.js/.jsx/.mjs/.cjs` 实现、旧工具配置、CommonJS
      require/source 改写、WebGL 1 core-extension wrapper、类型/lint/coverage suppression 与显式
      `any` 回流。
- [x] 源码与发布物使用原生 ESM、原生 class 与 `EventDispatcher`；动态类/mixin API 已删除。
- [x] TypeScript project references 隔离 lib/test/examples/node 环境并严格检查全部一方代码。
- [x] typed ESLint、Prettier 与 EditorConfig 覆盖整仓。
- [x] 公共声明从源码生成，API 文档与 API report 同源。
- [x] 单一 ESM 入口、类型、source map、package exports 与真实 tarball 一致。
- [x] 浏览器单测执行完整源码覆盖率门禁，阈值面向 `src/**/*.ts`，不排除 renderer 或 WebGPU 核心目录。
- [x] 全部示例构建并通过 WebGL 2 UI 错误检查；关键场景具有真实截图差异测试。
- [x] `webgl2` 与 `webgpu` 后端显式选择，WebGPU 不支持时直接失败且不会静默回退。
- [x] shader 只有 GLSL ES 3.00 source of truth；WebGPU 在引擎预处理后由 Naga WASM 生成 WGSL。
- [x] Naga corpus 覆盖 Basic/PBR、灯光、阴影、skinning、morph、instancing、quantized 与 screen
      variant。
- [x] Playwright 在真实 WebGPU
      adapter/device/pipeline 上完成一帧 draw 与 submit，不以 mock 冒充 UI 验收。
- [x] 内置数值 shader 数据进入固定 std140
      ABI；WebGPU 按 global/material/object/custom 四组和更新频率绑定。
- [x] WebGPU instancing 使用 `InstanceBlock` 分批，阴影使用 comparison depth atlas 与 `LightBlock`
      元数据。
- [x] ShaderMaterial、自定义 loader shader 与全部示例遵守 UBO/sampler 边界。
- [x] std140 offset/stride、固定 block binding、dirty-range upload 和非法 classic
      uniform 有自动测试。
- [x] 旧构建、测试、文档生成和运行时 vendor 链路已删除。
- [x] CI 验证最低 Node 与当前 Node，发布前复用同一完整门禁。

## 后续维护规则

1. 禁止新增类型、lint、测试或 API 检查的临时豁免；无法表达的领域结构应先补类型模型。
2. 公共 API 变更必须同时更新源码 TSDoc、测试、API report、CHANGELOG 与消费测试。
3. 新增示例必须进入 Vite MPA 和自动 Playwright 页面清单；不得以远程脚本或全局变量绕过依赖管理。
4. 渲染行为变化必须审查视觉 diff；只有确认是预期变化时才更新基线。
5. 覆盖率阈值只能保持或提高，不能通过扩大 exclude、空断言或无意义执行来提升。
6. 不提交
   `dist/`、`dist-examples/`、`docs/`、`site/`、coverage 或浏览器报告；发布只接受 CI 现场生成物。
7. 新工具必须替换旧工具的职责，不允许两套活跃构建、测试、文档或发布链路长期并存。
8. 不得恢复动态类/mixin
   API、backend-specific 生命周期别名、CommonJS/UMD 构建或浏览器全局入口。不得在 Vite/Node 工具中读取并改写第三方 UMD/CommonJS 源码来制造 ESM 入口。
9. 不得新增 WebGL 1/GLSL 1.00 兼容源码、手写 WGSL 镜像或 block 外 numeric uniform；WebGPU
   shader 必须继续执行“当前 variant 预处理 → Vulkan GLSL 4.50 → Naga → WGSL”。
10. 不得让 WebGPU 失败后静默创建 WebGL 2
    renderer，也不得通过关闭 feature、跳过 pass、替换空纹理或吞掉 validation
    error 伪造成功；可选能力必须成为显式 API、capability 或错误。
11. 新增 uniform block 必须先分配全局稳定 binding、定义 std140
    schema、补 offset/size 测试，并标明 owner、更新频率和 dirty
    revision；不能按 program 反射顺序临时占号。
12. 新增 shader feature 必须同时进入 WebGL 2 compile/link、Naga corpus 和适当的 WebGPU
    pipeline/UI 测试；只让某个 backend 通过字符串快照不算完成。
