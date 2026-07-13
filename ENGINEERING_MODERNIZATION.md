# Hilo3d 现代前端工程改造记录

状态：已完成 · 目标版本：2.0.0 · 最后核验：2026-07-14

范围：源码、示例、测试、构建、类型声明、API 文档、站点、npm 包、CI 与发布流程

## 结论

本仓库已经从“JavaScript 文件改名为 TypeScript、但主体仍按旧工程运行”的过渡状态，改造成一套单一、严格、可复现的现代前端库工程。

现在的工程事实是：

- 所有一方维护的引擎源码、示例、测试和 Node 工具均为受严格检查的 TypeScript；`src/` 与 `examples/`
  中不再存在一方 JavaScript 实现，`npm run check:modernity`
  会阻止旧 JavaScript 或旧构建配置重新进入受维护目录。
- 源码与发布物统一使用原生 ESM、原生 `class`、显式领域类型和标准浏览器 API；旧动态类/mixin
  API 与 CommonJS/UMD 输出已完全删除。
- 渲染器提供显式选择的 WebGL 2 与 WebGPU 双后端。全部引擎 shader 都以 GLSL ES
  3.00 为唯一源码；共享材质/阴影/呈现 shader 以及 WebGPU 专用的 mipmap 等内部 pass 均严格执行“引擎预处理 →
  Vulkan GLSL 4.50 → Naga WASM → WGSL”，不存在手写 WGSL 镜像、WebGL 1、GLSL 1.00 或逐项 numeric
  uniform 路径。
- 渲染目录按 `common/webgl/webgpu` 明确分层；`UniformBuffer` 与 frame
  planning 保持后端中立，WebGPU 通过同步 `renderFrame()`
  合并资源已就绪的多 pass，并以 submission 内 UBO
  revision 快照保证阴影与多相机数据不会互相覆盖。Shader variant 使用有界结构化 hash 与精确碰撞校验。
- Vite 负责库与多页面示例构建，Vitest Browser
  Mode 在真实 Chromium 环境中运行单元测试；Playwright 从示例目录自动收集 78 个 HTML，除明确限定为 WebGL
  2 的 WebXR 页面外，逐页执行 WebGL 2 +
  WebGPU 双后端，并对两个后端执行确定性视觉、交互、后处理与拾取门禁；真实 WebGPU
  adapter/device/pipeline fixture 作为额外的深度验收，而不是 WebGPU 唯一覆盖。
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
| UI 测试  | 少量代表页面 smoke test                                 | 78 个 HTML 自动清单；除 WebXR 外全部执行 WebGL 2 + WebGPU              |
| 视觉测试 | 截图比较为空实现                                        | 两个后端共用确定场景、readback 断言、截图基线与像素差异阈值            |
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
  lost 会按 generation/device identity 过滤旧回调，发出
  `webgpuDeviceLost`，释放旧 managers/context/GPU 资源，按冻结的 adapter
  options 重新获取等价 adapter，复核 fallback policy、required
  features/limits，再用相同的有效 device
  descriptor 自动重建。恢复期间 render 安全跳帧；成功时保留公共 `RenderTarget` identity 并发出
  `webgpuDeviceRestored`，失败时发出
  `webgpuDeviceRecoveryFailed`，之后的 render 显式抛出原始恢复错误。renderer
  destroy 会取消正在进行的恢复。
- VAO、实例化、MRT/draw buffers、三维/数组纹理和 UBO 均使用 WebGL 2 core
  API；扩展注册表只保留各向异性过滤、context loss、浮点颜色附件和纹理压缩格式等真正可选能力。
- 删除 `KHR_techniques_webgl` loader、类型和 SampleTechniques 资产。该历史扩展以任意 GLSL
  1.00 与 classic numeric uniform 为接口，无法满足固定 UBO
  ABI；仅改内置样例而继续宣称支持会使外部资产在 program link 时失败，因此不保留伪兼容入口。
- 删除 AMC 专有扩展；相关演示资产转换为标准 glTF。
- WebXR 使用标准 WebXR 类型与浏览器 API；当前呈现层是 `XRWebGLLayer`，因此 `webxr.html`
  被明确声明为 WebGL 2-only。它暂不计入 WebGPU 上线门槛，也不会先请求 WebGPU、失败后再回退 WebGL
  2；其余 77 个 HTML 示例均进入双后端门禁。
- 资源观测统一为 `renderer.resourceManager.getDiagnostics(rootNode?)`
  返回的后端中立快照，包括已跟踪 mesh/resource、当前使用、待销毁数量和 frame 状态。会读取 WebGL 私有 cache 并产生日志副作用的
  `logGLResource()` 已从公共入口和源码删除。
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
2 默认值，不是能力探测。显式选择 WebGPU 后，浏览器不支持、adapter 不存在、feature/limit 不满足、恢复失败或 shader 编译失败都会成为可观察错误；引擎内部禁止吞掉错误后静默创建 WebGL
2
renderer、关闭 feature 或换一条低能力渲染路径继续运行。应用可以捕获该错误，并按自身产品策略显式发起一次独立的
`Stage.create({ backend: 'webgl2', ... })` 请求。

WebGL 2 backend 直接使用 core API 和原生 GLSL ES 3.00；项目不创建 WebGL 1 context，不保留 WebGL 1
extension adapter，也不接受 GLSL 1.00 自定义 shader。

### WebGPU device loss 自动恢复

`WebGPURenderer` 公开 `initializing`/`ready`/`recovering`/`failed`/`destroyed` 恢复状态与当前
`recoveryPromise`。活跃 device 丢失时，renderer 立即发出 `webgpuDeviceLost`，暂停 target 的 native
resource，销毁旧设备绑定的 manager/context。初始化成功时保存并冻结 adapter options、fallback adapter
policy 与实际生效的 device descriptor；恢复时不复用可能已经失效的旧 adapter，而是通过
`navigator.gpu.requestAdapter()`
按相同 options 重新获取等价 adapter，重新验证 fallback 策略、全部 required
feature、bind-group/UBO/texture/vertex 等引擎 limits，再按相同的有效 descriptor 请求替代 device。恢复期间的正常帧不会访问已丢失资源、创建 command
encoder 或提交 queue，而是安全返回。

成功后重建 buffer/texture/uniform/pipeline/bind-group manager 和 canvas context，并在原有
`RenderTarget`/attachment `Texture`
对象上重建 native 资源；当前选中 target、所有权与对象 identity 都不变，然后发出
`webgpuDeviceRestored`。adapter/device 请求或资源恢复失败会保存原始 cause、发出
`webgpuDeviceRecoveryFailed` 并进入 `failed`；后续 render 明确抛错，不吞错、不跳过功能、不切换 WebGL
2。generation 与 device
identity 保证过期 loss/recovery 回调不能覆盖新设备；显式 destroy 使恢复结果失效并确定性释放已创建资源。

`isImageCanRelease` 不以丢失恢复能力换取公开 CPU image 的释放。公开 image 清空前，引擎按逻辑
`Texture` identity 建立 backend-neutral recovery backing：TypedArray/DataView、ImageData、cube
face、显式 mipmap 与 sub-texture update 保存不可变副本，DOM/canvas/ImageBitmap/video 等 external
source 保留私有引用。WebGL 2 新 context allocation 与 WebGPU 新 device
manager 都从它建立各自的上传快照并重放同一 descriptor、base
level、mipmap 与增量更新；公开 image 始终不可访问。替换公开 source 会使旧 backing 失效；各 renderer 的 device-local 副本在资源释放时确定性清除，identity 不再可达后 engine
backing 由 WeakMap 回收。

公共 `releaseGPUResources()` 与完整 device teardown 分离：它释放 owned `RenderTarget`、device
allocation、UBO 和 pipeline/bind-group
cache，但保留可继续使用的 device/context/manager 与纹理恢复数据，并立即重建主画布 depth/MSAA
attachment，因此调用后的下一次 render 仍会创建 render pass 并提交。device
loss 的内部 suspend 路径则保留公共 target/attachment
identity 与 ownership，待新 device 激活后原位恢复。

### GLSL 预处理 → Naga → WGSL

全部生产 shader 都以 `src/shader/` 中的 GLSL ES 3.00 为唯一源码。两个后端复用材质、阴影与 fullscreen
present shader；仅 WebGPU 需要的 mipmap utility
pass 也继续写成 GLSL，而不是另建 WGSL 特例。WebGPU 不维护第二套手写 WGSL，对每个已解析的 shader
variant 和内部 utility pass 执行同一确定流水线：

1. 先由引擎解析 object-like/function-like
   `#define`、嵌套条件分支与 include，得到当前材质、灯光、geometry 和 render-state 对应的有效源码；预处理表达式完整处理位运算、移位、一元
   `~`、三元表达式、整数后缀、指数与八进制，宏参数按 GLSL
   token边界展开，递归或非法表达式直接报告源位置，不使用“解析失败视为 1”的宽松行为；
2. 将有效 GLSL ES 3.00 准备为 Naga 接受的 Vulkan GLSL 4.50：注入
   `HILO_WEBGPU`、分配稳定且紧凑的 vertex/varying/fragment location、拆分 matrix IO、把 std140
   block 映射到固定 set/binding；
3. 把 GLSL combined sampler 拆成 WebGPU 独立 texture/sampler binding；sampler
   array 的常量元素直接展开为 binding pair，dynamically-uniform 索引则生成有类型的 dispatch
   function，覆盖 texture builtin、sampler 函数参数和多数组组合，不依赖可选 binding-array feature；
4. 把用户 `main` 改为内部函数，再生成稳定 entry wrapper；wrapper 在用户函数返回后完成 matrix
   varying 写回以及 WebGL `[-w, w]` 到 WebGPU `[0, w]` 的 clip-space
   depth 转换，因此用户代码中的提前 `return` 也不能绕过后处理；
5. 比较顶点与片元阶段同名 UBO 的规范字段签名；字段类型、顺序、数组长度或宏展开结果不一致时，在进入 Naga 前直接失败；
6. 最后调用 `web-naga` 的 WASM GLSL frontend 生成 WGSL，把公共 std140
   ABI 确定性表达为 WGSL 默认 uniform 布局可接受的 `@align`/`@size` wrapper，再建立 shader
   module 与 pipeline。

预处理结果同时输出 vertex inputs、fragment outputs、uniform blocks 与 sampler
bindings 元数据；pipeline、vertex layout 与 bind
group 都消费同一份结果，不再各自用正则猜测接口。Naga 错误保留 stage 和送入 Naga 的完整 GLSL
4.50，避免只暴露下游 WGSL 错误。共享 present 与 WebGPU mipmap
pass 直接消费转译元数据中的默认 sampler ABI（group 1、texture binding 1、sampler binding
2，并显式提供空 group
0），不存在硬编码 WGSL、备用 module 或失败后 fallback。内置 Basic/PBR、灯光、阴影、skinning、morph、instancing、quantized、geometry、present 和 mipmap
shader corpus 都必须在单元测试中真实通过 Naga。

GLSL frontend 同时解析全局多声明、固定长度数组以及带 instance name、数组成员和 interpolation
qualifier 的 stage interface block，并把它们展平为稳定 location；UBO 的 `layout(...)`
qualifier 可以合法重排或包含显式 set/binding，但必须声明
`std140`，最终 binding 仍由固定 ABI 规范化。项目只接受 WebGL 2 对应的 GLSL ES 3.00
builtin 集：`textureProj*` 与 constant-offset 形式会进入 sampler-array 类型化 lowering，而
`textureGather*`、`textureQueryLevels`、`textureQueryLod`
等更高版本接口在两个后端之前统一失败，不能制造只在 WebGPU 可运行的方言。depth-only
pass 使用同一片元源码和 Naga 流水线，但把 color output 降为 private sink，只保留
`discard`、`gl_FragDepth` 与其他片元副作用，因此阴影不会依赖虚假的 color
attachment，也没有第二套 shadow shader。

这条路径不申请、探测或依赖可选的 `uniform_buffer_standard_layout` language feature。标量/`vec2`
数组、非方阵以及 `bool`/`bvec`
都会在 Naga 前后按同一 std140 字节契约做结构化降级与语义恢复；WebGPU 直接上传 WebGL
2 使用的同一份字节，不维护第二套压缩布局。内置 vertex/fragment corpus 除 Naga 转译外还必须通过真实
`GPUShaderModule.getCompilationInfo()`。

shader variant key 使用当前 geometry 产生的完整结构宏签名，包括四类 decode、color
size 与 morph 结构，而不是缓存某个 geometry 首次渲染时的粗略布尔值。公共 precision
header 按 renderer 实例参与 shader cache key，因此不同 WebGL 2/WebGPU
renderer 或运行时 precision 变化不会交叉复用错误源码。`commonOptions`
每次生成不可变快照并把规范化 signature 纳入 header/variant key；不存在可变的全局
`commonHeader`，也不要求调用方手动清 cache。

### 按更新频率固定的 UBO 与 bind group

所有内置数值 shader 数据按所有权和更新频率进入固定 std140 block。WebGL 2 使用稳定的 flat
binding；WebGPU 将同一逻辑 ABI 分到四个 bind group，避免高频对象数据导致全局或材质资源重新绑定：

| Block           | 数据所有者与典型内容                                           | 更新时机                      | WebGL 2 | WebGPU |
| --------------- | -------------------------------------------------------------- | ----------------------------- | ------: | -----: |
| `FrameBlock`    | render size、时间与帧序号                                      | 每个 renderer frame 一次      |       0 |    0/0 |
| `CameraBlock`   | view/projection、逆矩阵、相机位置、裁剪平面与物理像素 viewport | 每个 camera/render pass 一次  |       1 |    0/1 |
| `SceneBlock`    | fog 等 scene-owned 状态                                        | scene revision 变化时         |       2 |    0/2 |
| `LightBlock`    | view-space 灯光、衰减、阴影 atlas 参数                         | 每个 camera/render pass 一次  |       3 |    0/3 |
| `MaterialBlock` | Basic/PBR、IBL、UV 变换与材质标志                              | 最终 std140 字段变化时        |       4 |    1/0 |
| `ModelBlock`    | model 与 world-normal 变换                                     | 非实例对象 transform 变化时   |       5 |    2/0 |
| `GeometryBlock` | position/normal/UV decode 变换                                 | geometry revision 变化时      |       6 |    2/1 |
| `SkinningBlock` | joint palette                                                  | skeleton pose 变化时          |       7 |    2/2 |
| `MorphBlock`    | morph weights 与 target 状态                                   | morph pose 变化时             |       8 |    2/3 |
| `InstanceBlock` | 每批 model/normal matrix array                                 | WebGPU instanced batch 变化时 |       — |    2/4 |

WebGPU group 0 是 frame/pass/scene 全局域，group 1 是 material 与纹理域，group
2 是 object/geometry/pose 域，group
3 专供应用自定义 block。自定义 block 仍先通过共享 registry 注册：WebGL 2 flat binding
9 映射到 WebGPU group 3 binding 0，后续依次递增。内置名称和位置不允许按 shader variant 临时分配。
`CameraBlock.u_viewport` 的语义固定为当前 attachment 的物理像素
`(x, y, width, height)`；canvas、RenderTarget、平面阴影与点光六面阴影切换 camera/pass 时都更新同一 std140 字段，不保留 classic
`uniform` 兼容路径。

公开 `Std140Schema`
是刻意固定的扁平 scalar/vector/matrix（含定长数组）模型；嵌套 struct 不在这套跨 WebGL
2/WebGPU 可移植 ABI 中，构造时会明确拒绝，不能把嵌套对象强转后按错误 offset 打包。`UniformBuffer`
必须由 `Std140Layout` 创建，不再接受无布局的裸 TypedArray。

引擎在创建 backend 时校验 uniform buffer 数量、单 block 大小、alignment、bind
group 数量、纹理/vertex 资源上限和显式 required feature/limit。std140 schema 由 offset、matrix
stride、array stride 与固定 ABI 测试锁定；CPU revision 与 dirty byte
range 驱动上传，禁止为了“统一”而在每次 draw 重建或整块重传所有 block。

GeometryData、Geometry、Material 与 Texture 都发布单调 revision；每个 renderer/device 分别记录自己已经上传的版本，不清除会影响另一个 backend 的全局脏标记。`MaterialBlock`
还会把最终 std140 byte image 写入复用的候选区并直接逐字节比较，因此直接修改
`Color`/`Matrix`、纹理派生的 mip 数量或其他嵌套数值也会自动刷新；字节未变时不推进
`UniformBuffer.revision`，两后端都不会重复上传，也不要求应用手工设置 `isDirty`。WebGL
2 还为每个 VAO 单独记录 attribute/index 的 revision、shape 与 count，不能让阴影 VAO 的首次上传吞掉主渲染 VAO 的绑定更新。partial
buffer/texture/UBO 更新保留带 revision 的有界快照，上传成功后只推进当前 backend 的游标；慢消费者越过 64 条 UBO
history 后执行一次完整上传，再恢复 partial。资源以
`mesh → pass owner → material/shader/instancing variant`
保存；阴影、主画布和每个 RenderTarget 各自更新命中的 variant，不会用一次 pass 的快照覆盖其他 pass。材质/几何 identity 替换、target 销毁和 mesh 销毁会确定性释放对应状态，每个 mesh 的 variant 使用 32 项 LRU 上限；完整帧成功后才原子提交，异常帧只回收未提交的新资源。共享资源按 renderer 全局最终引用判断，不能被另一个 scene/pass 提前销毁。owner 释放会同时删除 CPU
UBO cache 和 native wrapper。pipeline、layout、sampler 与 bind-group
cache 都有明确的失效或容量边界；vertex/instance/index buffer variant 使用 per-owner
LRU，WebGPU 的 immutable sampler descriptor、每纹理 resolved snapshot 与每个 base
shader 的 numeric-depth 专化同样使用有界 access-order
LRU；pipeline 把不可淘汰的 in-flight 去重层与已完成的有界 LRU 分开。UBO/texture
identity 变化只失效 bind group，不重建稳定的 pipeline
layout，资源 churn 不会让历史 variant 永久常驻、重复并发编译或触发无关 pipeline 重编译。

WebGPU geometry 上传同样消费有界 dirty history：interleaved
attribute 只重打包受影响的 AoS 顶点区间，支持 matrix
column、normalized、stride/offset、多 source 与离散 range；只命中 padding 时不产生
`writeBuffer`。Uint8/Uint16/Uint32 index update 会按 WebGPU 的 4-byte copy
alignment 合并写入并保持 primitive-restart 规范化。历史游标落后或 shape/byteLength 变化时才执行一次完整重建，旧 native
buffer 在新资源成功后确定性销毁。

当前灯光着色使用 view-space 数据，因此 `LightBlock` 与 `CameraBlock`
同属 render-pass 频率。环境贴图、球谐与 IBL 强度允许逐材质变化，因此属于
`MaterialBlock`。WebGPU 阴影资源使用单一 depth-comparison atlas；atlas 尺寸、slice
rect、bias 与 light-space matrix 都进入 `LightBlock`，不会退回逐灯散装 uniform 或占用一组 sampler
array。WebGL 2 点光源 cube shadow 会为六个面分别显式开始 camera pass，即使复用同一个 shadow
camera 对象也必须刷新六组 `CameraBlock` view/view-projection bytes；不能用 camera
identity 代替 pass 边界。只有 Directional/Spot/Point light 接受
`ShadowCastingLightParameters`；Area/Ambient/base light 在构造或运行时设置 `shadow`
时就于后端中立层失败，不允许 WebGL 报错而 WebGPU 静默忽略。renderer-owned shadow camera 与 debug
helper 按 renderer/light 使用明确的 owner map；debug 关闭、shadow 置空、light
disabled、light 离开 stage、GPU resource release、device suspend/recovery 与 renderer
destroy 都会 prune 对应节点并解除 parent/listener。多个 renderer 不共享这些节点，重复恢复也不会让 light
children 增长。

WebGL 2 的 native resource 也不使用进程级单例所有权。Program、Buffer 与 VertexArrayObject 按
`WebGL2RenderingContext` 分区；Texture 与 `UniformBuffer` allocation、upload
cursor 和 cache 则由每个 `WebGLState` 的 backend manager 持有；不可变 `WebGLSampler`
variant 由有界 sampler manager 按 context 和 texture unit 管理。共享 `Texture`
只保存 CPU 内容、revision 与恢复 snapshot，WebGL uploader 不再位于
`src/texture`，公开 API 也不暴露 native texture/cache。VAO current binding、Framebuffer
reset/destroy、capability snapshot 与 extension object 同样是 context-local。

同一 shader/geometry/texture identity 可在多个 renderer 中各自建立 native
allocation，不会把 A 的 program/state/gl 返回给 B。A 的 context
loss、restore、`releaseGPUResources()`
或 destroy 只清理 A 的 namespace，不删除 B 的 handle、不覆盖 B 的 extension/capability 视图。Texture
content descriptor snapshot 会检测 size/format/mipmap 变化，并在 framebuffer
resize/reset 时稳定复用 native object；一个 texture attachment 不能同时归属两个 framebuffer
graph。不可取消的内部 destroy observer 会先释放所有 backend
allocation，再触发公开事件；`Texture.needDestroy` 也会同步失效该逻辑纹理在所有 WebGL
context 与 WebGPU device 上的旧 allocation，不能由第一个消费者吞掉全局状态。

这一所有权边界由两个真实 WebGL 2
context 的首次分配、reset/release 和继续渲染回归锁定，不使用单 context mock 代替。旧的根导出
`capabilities`/`extensions` 单例已删除，因为它们无法表示“当前”多个context；调用方从所属
`WebGLRenderer.capabilities`/`WebGLRenderer.extensions`
读取。Program、Buffer、VAO 等仍公开的低层 cache 检查必须显式传入 `gl`，Texture native
cache 则完全由 backend manager 私有持有。

固定 ABI 同时固定容量：最多 8 个 directional light、8 个 spot light、16 个 point light、8 个 area
light、128 个 skin joint、8 个 morph weight 与每个 WebGPU instanced batch
128 个实例。超过容量必须分批或抛出带领域名称的错误；禁止截断数组、复用最后一项或退回 classic
uniform。

### texture 与 sampler 是 opaque resource 例外

GLSL opaque sampler 不能成为 uniform block 成员，因此 sampler 是 block 外唯一合法的 `uniform`
声明。WebGL 2 在 program link 后为 active sampler 分配整数 texture
unit；WebGPU 预处理器把同一声明降级为独立的 texture/sampler binding pair。材质纹理、环境贴图、BRDF
LUT、LTC、shadow atlas 和 post-process input 都遵守这一规则。

共享 shader/texture 契约完整支持 GLSL ES 3.00 的 `sampler3D`、`sampler2DArray`、
`sampler2DArrayShadow`，以及 `isampler*`/`usampler*`
在 2D、3D、cube、2D-array 上的全部组合。预处理器在保留 sampler
array 与函数参数语义的同时生成准确的 WGSL dimension、sample type 和 comparison binding；bind-group
layout 根据 float/depth/sint/uint 选择 filtering、comparison 或 non-filtering
sampler，不依赖不可用的占位资源。

managed `Texture` 的公共 target 契约覆盖 2D、cube、3D 与 2D-array，raw upload、显式 mip、recovery
backing、`flipY` 和 device/context limit 验证都保留 depth/layer 维度；signed/unsigned integer
internal format 使用严格匹配的 typed storage 与 WGSL sint/uint sample type。integer texture 必须使用
`NEAREST` magnification、`NEAREST` 或 `NEAREST_MIPMAP_NEAREST`
minification、`anisotropic: 1`；一旦使用 mipmap filter 就必须提供显式完整 chain。3D
texture 的 mip 深度逐层收缩，也必须提供显式完整 chain。WebGPU 规范没有 compressed 3D
texture，因此 WebGL 2 与 WebGPU 都在原生分配前拒绝该组合；compressed 2D-array 则保留，并在 format
feature 可用时上传完整 layer/mip 数据。

`Texture.updateSubTexture()` 只接受完整 descriptor，不保留旧的 `(xOffset, yOffset, image)`
重载。所有 target 都必须提供
`mipLevel/x/y/width/height/image`：2D 不接受子资源选择字段；cube 必须提供
`face: 0..5`；2D-array 必须提供 `layer/depth`；3D 必须提供
`z/depth`。这些字段互斥，并在后端选择前完成范围、source 尺寸和 raw 数据长度校验。非 base
level 只能更新显式 mip chain，自动生成的 mip 始终由 level 0 派生。

cube 显式 mip chain 包含 level 0，每个 level 连续提供六项，顺序固定为
`+X, -X, +Y, -Y, +Z, -Z`，总项数为
`mipmapCount * 6`；每项的 face、width 与 height 必须与所在 level 完全一致。managed raw depth 支持
`DEPTH_COMPONENT16/DEPTH_COMPONENT/UNSIGNED_SHORT`、
`DEPTH_COMPONENT32F/DEPTH_COMPONENT/FLOAT`，以及 device 提供 `depth32float-stencil8` feature 时的
`DEPTH32F_STENCIL8/DEPTH_STENCIL/FLOAT_32_UNSIGNED_INT_24_8_REV`。DEPTH24/DEPTH24_STENCIL8 仍可作为无初始数据的 attachment
allocation，但 raw base/sub-update 因没有可移植 WebGPU 字节表示而在后端中立层拒绝；depth external
image 与 depth mipmap filter 同样拒绝。

compressed sub-update 只接受 raw
block 数据；origin 必须按 block 对齐，width/height 只有到达逻辑 mip 边缘时才允许不是 block 整数倍，payload 必须与 block 数精确相符。WebGPU 对 2×2、1×1 等 mip
tail 使用底层格式要求的物理 4×4 copy extent，因此完整 8→4→2→1
chain 可正常上传。Texture 每次局部更新都会同步维护准确的完整 CPU
checkpoint，同时只保留最多 64 条增量历史。每个 WebGL context/WebGPU
device 独立确认 revision；消费者落后于 checkpoint 边界时，
`TextureUpdateSnapshot.requiresFullUpload` 为
`true`，从完整 checkpoint 重放成功后再继续增量，不清除其他 backend 的游标。

depth texture 同时支持 comparison 与 numeric 两条正式 ABI：shadow sampler 直接使用 Naga 生成的
`texture_depth_*`/comparison sampler；普通 sampler 在运行时解析出真实 depth resource 后，将对应 Naga
WGSL binding 专门化为 `texture_depth_*`，并把标量 sample/load 结果恢复成 GLSL 的 vec4 `.r`
语义。WebGPU numeric depth 必须是 nearest-only、`anisotropic: 1` 的 non-filtering
sampler，非法 filter 在创建 bind group 前失败；WebGL 2 按 Program 反射出的 shadow/ordinary
sampler 类型选择按 texture unit 绑定的不可变 `WebGLSampler` variant，comparison
function 来自同一 render-target 契约；WebGPU bind group 使用相同的默认 compare，因此同一个 depth
attachment 可安全用于两种读取方式。sampler 仍按完整 descriptor 缓存，并在 resolved
binding 中保存不可变快照。

纹理色彩管理也只有一条跨后端语义：DOM/external
image 一律进入浏览器标准的 sRGB-managed 上传路径；旧的 `colorSpaceConversion`
布尔开关已删除，因为 WebGPU 没有与 WebGL `NONE`
等价且同步的 copy 语义。TypedArray/DataView 是未标记的原始数值，不发生隐式色彩转换，并统一采用紧密行布局；`flipY`
在两个后端上传前都形成相同的确定性行顺序，非对齐 DataView 会先安全复制到其 `type`
声明的分量视图，绝不静默忽略或依赖驱动默认 unpack 对齐。

`HTMLVideoElement` 也不使用特例回退。WebGPU 通过 `requestVideoFrameCallback`
只观察已解码帧，将完整帧写入该 texture 私有的 staging canvas，再用 `copyExternalImageToTexture`
上传。queue copy 在途时不允许改写 canvas；等待 `onSubmittedWorkDone()`
后才接受下一帧，允许视频正常播放时丢弃中间帧而不阻塞 decoder。首帧未到达时保持新建 GPU
texture 的合法零初始内容，不推进 uploaded revision、不生成 mipmap、不释放 source。视频 source
identity 变更、texture destroy、manager suspend/device
recovery 都会取消旧 callback 并重建观察。捕获、copy 或 queue 失败会保留 cause 并在下次资源同步时显式抛出；不直传缺少 decoder
backing 的 video、不停止播放伪造静态纹理、不回退 WebGL。

任何 block 外的 float、vector、matrix、integer、boolean 或其数组都会被拒绝，不能借
`ShaderMaterial`、`onBeforeCompile`、示例代码或 backend 分支绕过。纹理 UV
channel、强度、尺寸、阈值和 kernel 等数值元数据必须进入 Scene、Light、Material 或注册过的自定义 block；opaque
resource 例外不是保留通用逐项 uniform 系统的理由。

### Render target、MRT 与 readback

公共离屏契约只有后端中立的 `Renderer` 与 `RenderTarget`：两个 renderer 都实现
`createRenderTarget()`、`setRenderTarget()` 和 `renderToTarget()`，调用方不接触原生
`WebGLFramebuffer`、`GPUTexture` 或 backend-specific handle。统一 descriptor 支持多 color
attachment、1×/4× MSAA resolve、可选 depth/stencil、合法情况下可采样的 color/depth
texture、resize、所有权、显式 present 选择与异步区域 readback；跨 backend
target、非法 attachment、MSAA depth sampling、无附件 target、销毁后复用和 depth-only
present 均直接报错。

WebGPU MRT pipeline target 与 attachment location 一一对应，支持中间为 `null` 的 sparse color
slot；depth-only target 不声明颜色输出。resize 在新 color/depth/MSAA
allocation 全部成功后才提交，失败会销毁新资源并保留旧 target
identity、尺寸和可用 allocation，不存在部分替换。

两个实现返回相同的紧凑 top-to-bottom texel 结果。WebGPU 内部遵守每行 256-byte copy
alignment 后再压紧，WebGL 2 内部处理 framebuffer
resolve 和坐标方向；这些 native 差异不会泄漏到调用方。target-owned texture 继续使用引擎 `Texture`
identity，因此材质 sampler、bind-group/cache 与资源释放共享同一生命周期，不复制旁路纹理系统。attachment
identity 在 resize、WebGL context restore 与 WebGPU device
recovery 前后保持不变。两个 backend 的 target owner 都跟踪 attachment allocation generation：公开
`Texture.destroy()`、target 变化或上传失败会先清除旧 native
handle；WebGL 重新挂接 manager 的当前 allocation，WebGPU 则在同一逻辑 texture
identity 下原子重建，设备 suspend 期间禁止在失效 device 上分配。若这类失效发生在 WebGPU command
recording 期间，整帧会被 poison 且不提交，下一帧再恢复，旧 observer 或 material
binding 不能创建脱离 target 的旁路纹理。WebGL resize 会事务性更新全部 draw/resolve/depth
attachment，任一 allocation 失败就完整回滚，回滚本身失败则销毁 target 并抛出聚合错误，绝不留下半提交状态。显式 present 在两个 backend 都使用 fullscreen
texture-load pipeline；WebGL
2 不会把单采样 FBO 非法 blit 到浏览器可能启用 MSAA 的默认 framebuffer。WebGL
pass 的 clear 写掩码、begin/resolve/invalidate 异常恢复和嵌套 framebuffer 保存状态都有硬门禁，任何失败都在抛错前恢复 canvas
binding，下一帧会完整重绑 program、材质状态与 sampler。

示例 `PostProcess` 只使用公共 `RenderTarget`、UBO 和 fullscreen draw 组成 ping-pong
graph；`MeshPicker` 同样通过公共 target 执行 object-ID pass，再异步 readback。两者都在 WebGL
2 与 WebGPU 上运行，拾取不存在 CPU ray-cast 回退，后处理也不存在 WebGL-only
framebuffer 分支。旧的公共 `Framebuffer`、`LightShadow`、`CubeLightShadow`、灯光上的 `lightShadow`
字段、renderer-owned `useFramebuffer`/`framebufferOption`、隐式 present 以及 WebGPU 的无效 `clear*`
兼容桩已删除；`renderTarget.html` 只展示显式创建、resize 和 scoped render。shadow
allocation 通过内部 registry 持有；WebGL 原生 framebuffer
wrapper 仅是 RenderTarget/阴影的内部实现，不进入根出口或 API report。

WebGPU 不支持的 `LINE_LOOP` 与 `TRIANGLE_FAN` 不通过 backend 分支跳过：`Geometry`
在上传前把它们规范化为显式 `LINES`/`TRIANGLES` indices，glTF
sync/async/extension 解析路径也在暴露 geometry 前执行同一转换；索引类型、非索引 primitive、短输入和重复调用均有测试锁定。

### 原生压缩纹理能力

`Renderer.supportsTextureCompression()` 是两个后端共享的显式能力入口。WebGL
2 根据对应扩展报告 BC、ETC1、ETC2、ASTC 与 PVRTC；WebGPU 在创建设备时启用 adapter 实际暴露的
`texture-compression-bc`、 `texture-compression-etc2` 和 `texture-compression-astc`，ETC1
source 复用 ETC2 native feature；ETC2/EAC 映射覆盖 WebGL 2 定义的全部 10 个 core
format。WebGPU 对 PVRTC 明确返回不支持，loader/示例据此跳过该 source，不做 CPU 解码、格式替换或空纹理回退。缺少 required
feature 的压缩格式在 GPU 分配前报错。只要选择 mipmap
filter，两个后端都要求层数恰好覆盖到 1×1，并校验每层 width/height；base-only 或 partial
KTX 可以配合非 mipmap filter 使用，超过纹理理论最大层数的容器则在 loader 阶段失败。KTX1
header 与每级 `imageSize`
都服从容器端序标志；无效标志、运行时生成 mip、截断 payload/padding 立即失败。格式、尺寸、压缩状态、image 与 mipmaps 只由容器决定，外部请求只能提供明确白名单中的 sampler、名称、UV 和生命周期选项，不能覆盖 texel
layout。

### 实例化、骨骼与 morph 边界

- WebGL 2 使用 instanced vertex attributes 传递每实例 model/normal matrix；WebGPU 使用 group 2 的
  `InstanceBlock`，由 `gl_InstanceIndex`
  读取固定数组，并在超过 128 个实例时拆成多个 draw。两个路径都由 `HILO_WEBGPU` 的编译期 shader
  variant 明确表达，不运行时改写 uniform 声明。
- `ModelBlock` 只服务普通 draw 或整个 batch 的公共数据；model-view 与 MVP 在 shader 中由
  `CameraBlock × ModelBlock` 推导，不重复上传 camera-dependent 派生矩阵。
- vertex geometry/morph attribute 按兼容格式打包到尽量少的 interleaved GPU buffer，并同时校验
  `maxVertexAttributes` 与 `maxVertexBuffers`；不能假设开发机暴露超过 WebGPU 保证下限的 slot。
- WebGL 2 根据 program 反射严格区分 converted 与 integer attribute：`ivec*`/`uvec*` 只使用
  `vertexAttribIPointer` 并校验 signed/unsigned storage，float/vector/matrix 才使用
  `vertexAttribPointer`；不允许 normalized 或符号不匹配的整数旁路。
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

`WebGPURenderer`、backend-neutral `Renderer`/`RenderTarget`、`Stage<'webgpu'>`、异步
`MeshPicker`、`ShadowCastingLightParameters`、`KTXTextureOptions`、资源诊断、压缩纹理 capability、Naga
translator 元数据和 WebGPU binding API 都从根 barrel 导出，因而同时进入 `.d.ts`、TypeDoc 与 API
report；不存在只在内部可用、文档手写声称支持的影子 API。包消费类型测试直接通过
`Renderer`/`RenderTarget` 使用 MRT、MSAA、readback、压缩纹理查询和资源诊断，不把 backend-specific
target 当成跨后端主契约。

低层 `WebGPUTextureManager` 构造器显式接收已经完成 `await initialize()` 的
`NagaShaderTranslator`；renderer 在 manager 创建和 device
recovery 前都复用这个已初始化实例。这样 present/mipmap 等内部 pipeline 不可能绕过统一编译器，也不会在 manager 内隐式启动另一套初始化或 WGSL
fallback。

`npm run site:build` 将 TypeDoc 输出放入 `/docs/`，将完整 Vite 示例构建放入
`/examples/`，再生成站点根跳转与 `CNAME`。生成目录不提交到主工作树，由 Pages 工作流每次重新构建。

## 测试体系

### 单元测试与覆盖率

单元测试运行于 Vitest Browser Mode + Playwright
Chromium，因此 DOM、Canvas 与 WebGL 行为来自真实浏览器上下文。WebGPU 资源管理器、std140/WGSL
layout、bind group、pipeline state、buffer packing 与 texture lifecycle 使用确定的 typed device
doubles 做边界测试；shader corpus 则加载真实 Naga WASM 完成 GLSL→WGSL 编译。测试初始化会把未预期的
`console.error`、shader compile/link error 与未捕获异常升级为失败。

纹理单元测试覆盖 2D/cube/3D/2D-array 的 descriptor 校验与 raw/external/compressed 上传分派、cube 显式 mip 顺序、managed
raw depth aspect、压缩边缘与 2×2/1×1 tail
extent，以及 200 次局部更新后快慢 backend 的 checkpoint 恢复；构造测试还锁定 CubeTexture/DataTexture/LazyTexture 均经过基类校验，并保留 LazyTexture 加载后的
`depth` 与 `wrapR`。

覆盖率统计显式包含
`src/**/*.ts`，仅排除声明文件；没有为了达到数字排除 loader、renderer、animation 等低覆盖模块。阈值是完整源码的无回退基线：`60/40/58/62`
分别约束statements/branches/functions/lines。后续改动不得降低基线；新增功能应同时提高相关模块覆盖率。

WebGPU device recovery 还有独立状态机测试，覆盖 target suspend/restore、同一 target
identity 与所有权恢复、重新获取 adapter、完整 capability 复核、released texture
backing 重放、恢复失败、过期 generation/device loss 回调、destroy 取消、`releaseGPUResources()`
后重新渲染，以及 shadow owner 在 debug/shadow/enabled/stage
membership 和 recovery 边界上的精确 prune，不以单纯修改状态字段冒充 GPU 资源重建。独立 Playwright
fixture 还在真实 Chromium/Dawn 设备上主动调用 `GPUDevice.destroy()`，要求 Lost → 新 adapter/device →
Restored 事件顺序正确、选中的 `RenderTarget`
identity 不变、已释放 texture 能重新上传，恢复后实际 draw/queue/readback 成功，且恢复前后 scene
pixel 逐字节完全相等并区别于 clear color。

### 78 个 HTML 的双后端 UI 矩阵

Playwright 递归扫描 `examples/`
自动生成页面清单，不维护容易漏项的手工白名单。当前清单固定为 78 个 HTML：其中 77 个页面分别以
`?backend=webgl2` 和 `?backend=webgpu` 运行，`webxr.html` 因浏览器 WebXR 当前使用 `XRWebGLLayer`
而只运行 WebGL
2，共形成 155 个 page/backend 组合。WebXR 例外是显式产品边界，暂不计入 WebGPU 上线门槛；它不是 WebGPU 初始化失败后的回退。

每个组合都必须通过以下检查：

- 页面、ES module 与本地异步资源完成加载；
- 页面中存在 canvas 时，其尺寸有效且 `data-hilo3d-backend` 与请求后端一致；
- 至少一个真实 backend canvas 必须产生可见的非空帧；优先使用直接像素读取，若 WebGPU
  present 后浏览器禁止从 canvas 读取，则隔离该 canvas 并读取 Chromium compositor
  screenshot，不能用 DOM 完成标记或 draw counter 代替最终可见结果；
- 无 `pageerror`、非预期 `console.error`、失败 request 或 HTTP 4xx/5xx response；
- WebGL 2 组合必须观察到真实 draw；WebGPU 组合必须观察到 canvas texture acquisition、render-pass
  draw 与 queue submission，并且无 uncaptured error、device loss 或 DevTools rendering/validation
  error；GPU instrumentation 必须先等待两个稳定 animation frame，再对所有实际观察到的 `GPUQueue`
  执行 `onSubmittedWorkDone()`，成功后才允许终态采样；queue fence reject、uncaptured
  error 与非主动销毁的 device loss 都是硬失败，不允许延迟 validation event 越过门禁；
- loader 示例的模型与纹理请求真实完成。

额外交互门禁在两个后端分别点击 life-game canvas、拖动 ShaderToy、切换运行中 post-process
kernel、验证 GPU `MeshPicker` 返回同一对象，并让 glTF
Viewer 完成初次加载、GLB 替换和页面释放。这些用例不以 DOM
value 或“没有抛错”代替行为断言：操作前后必须出现新的 native draw，WebGPU 还必须出现新的 queue
submission；life-game 验证 render-target
attachment 的局部写入像素，ShaderToy 在冻结时间后比较 pointer 前后的离屏 readback，post-process 对同一 scene
texture 比较两套 kernel 输出，glTF
Viewer 则比较替换前后实际模型渲染的 readback。页面、request/response、console、DevTools
graphics 与 uncaptured GPU
error 门禁一直保持到交互和 pagehide 清理完成，最后再等待稳定帧做终态采样。video 示例在 WebGL
2/WebGPU 上都必须从本地媒体资源产生真实 draw，且无 GPU
validation 或 decoder-backing 上传错误。`renderTarget`、bloom、SSAO、life-game 还在 DPR
1.25/1.5 下验证取整后的 backing size、真实 draw 和相同终态错误门禁，避免非整数尺寸进入 GPU
descriptor。CI 使用单 worker控制 SwiftShader GPU/内存峰值；没有重试或吞错来掩盖失败。

### WebGPU 深度运行时测试

`npm run test:webgpu` 在 Chromium 中启用 SwiftShader WebGPU adapter，创建真实
`GPUAdapter`、`GPUDevice`、canvas context、Naga shader module、bind group、render
pipeline 与 command encoder，在同一帧覆盖 Basic/PBR、`InstanceBlock` 批处理、带 primitive
restart 和局部更新的 Uint8 indexed strip、mipmap 2D
texture 替换、directional/spot/point 三类阴影、4× MSAA/stencil offscreen target、双 attachment
MRT、fullscreen present 与对齐 readback。测试同时断言 backend、draw count、face
count、attachment/sample count、texture revision、非零像素、GPU validation
error、页面异常和控制台错误；它不是只检查 `navigator.gpu`、只 mock device 或只测试 WGSL 字符串。

同一真实浏览器闭环还通过 managed `Texture` 创建 3D、2D-array、unsigned-integer
array、depth-array、numeric depth 与动态 sampler-array 资源，让 Naga 转译包含 `sampler3D`、
`sampler2DArray`、`sampler2DArrayShadow`、`usampler2DArray`、普通 depth `sampler2D`
和 UBO 动态索引的 GLSL ES 3.00，随后建立真实 bind-group layout、bind group 与 render
pipeline，执行 draw、queue submit 和 buffer map。门禁要求 shader compilation message 与 GPU
validation error 均为空，全部纹理解析出的 dimension 正确，并且 1×1 输出像素精确为
`[64, 128, 200, 255]`；这证明能力不是只在 translator 或 fake-device 单测中存在。

这项专用 fixture 是 77 个普通示例 WebGPU 页面之外的深度能力测试，不是唯一的 WebGPU UI 覆盖。同一套
`test:webgpu`
还让压缩纹理示例分别通过两个后端渲染各自声明支持的 source，确认 WebGPU 原生 BC/ETC2/ASTC 路径且明确跳过 PVRTC，并让异步 GPU
`MeshPicker` 在两个后端选择同一 mesh。

WebGPU shader
corpus（包括 present/mipmap 内部 pass）与真实运行时测试是互补门禁：前者扩大 feature/variant 覆盖，后者证明浏览器端 Naga
WASM 加载、pipeline creation、draw 与 queue submission 端到端可用。

### 可选物理 GPU 门禁

`npm run test:webgpu:native` 使用独立的 `chromium-native-webgpu` Playwright
project：它不带任何 SwiftShader adapter/ANGLE 参数，禁用软件光栅器，给每次 `requestAdapter` 强制传入
`forceFallbackAdapter: false`，并拒绝 `adapter.info.isFallbackAdapter` 不是 `false`
或指纹明确属于 SwiftShader、llvmpipe、lavapipe 等软件实现的 adapter。通过 adapter 校验后，它复用正式 WebGPU 深度 fixture，要求 draw、submit、所有 queue 完成、device
recovery、纹理重放与 readback 全部成功。

物理 GPU 是否暴露给 Chromium 取决于 runner 驱动和宿主环境，因此这条命令不属于可移植的
`npm run validate`，也不会伪装成普通 GitHub-hosted CI 的必跑门禁。`.github/workflows/native_gpu.yml`
只支持手动触发，并要求带 `self-hosted`、`linux`、`gpu`
标签的 runner；默认 CI 仍以 SwiftShader 提供确定性、可复现的完整矩阵。WebXR 明确不属于该 WebGPU 通道。

### 视觉回归

视觉套件使用固定 viewport、UTC、英文 locale、固定 device scale、禁用动画的 Linux
Chromium 和 SwiftShader。同一个确定性灯光 PBR 场景分别通过 WebGL
2 与 WebGPU 渲染；除截图外还断言 readback 背景像素、变换后像素数、方向光覆盖和前景颜色数量，并在运行时要求两个后端的首帧截图逐字节相同。两个后端仍各自保存
`test/ui/__screenshots__/` 基线以定位单后端回归；失败时保留 screenshot、trace 与 video。

## CI 与站点发布

CI 在 Node 22.22.2 与 Node 24 两档执行，使用当前维护的 GitHub Actions、锁文件安装、固定 npm
12.0.1 和显式 Chromium 系统依赖。PR、`dev`、`master` 与版本 tag 使用同一个
`npm run validate`；过期任务由 concurrency 自动取消。Chromium 同时启用确定性的 SwiftShader WebGL
2 与 WebGPU adapter，78 页矩阵、双后端交互和双后端视觉门禁不依赖 CI
runner 是否暴露物理 GPU。物理 GPU 项目只能由上述手动 self-hosted
workflow 显式运行，不改变发布门禁的可移植性。

站点发布工作流同样从干净 checkout 执行 `npm ci` 和
`npm run site:build`，再部署生成 artifact。仓库不再跟踪旧 API 生成物，也不会从开发者本机的残留目录发布。

## 唯一验收入口

```sh
npm ci
npx playwright install chromium
npm run validate
```

`validate` 按顺序执行：清理生成物、旧 JavaScript/旧工具配置门禁、格式检查、typed
lint、全部 TypeScript project
references、浏览器单测与覆盖率、库构建、两类 ESM 类型消费、78 个 HTML 双后端 UI 矩阵（仅 WebXR 显式 WebGL
2-only）、双后端交互、WebGPU 深度运行时、双后端视觉回归、全部示例构建、TypeDoc 验证、API 签名比较、npm 包契约验证和 pack 文件检查。任一步失败都会阻止 CI 与发布。

其中 shader 静态门禁会扫描 `src/shader/` 和示例中的 shader 源码：禁止 GLSL 1.00
`attribute`/`varying`、`texture2D`/`textureCube`、`gl_FragColor`/`gl_FragData`、WebGL 1 shader
extensions，以及 block 外的 non-sampler `uniform`；现代性门禁还会扫描全部生产 TypeScript，禁止
`@vertex`/`@fragment`/`@compute` 手写 WGSL entry point。运行时门禁会再次在 program link 或 Naga
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
- [x] 自动清单包含 78 个 HTML；除 WebXR 显式 WebGL 2-only 例外外，全部通过 WebGL 2 +
      WebGPU 页面、请求、控制台与 GPU 错误门禁。
- [x] 同一确定 PBR 场景和关键交互在两个后端都有 readback/截图或行为断言；WebGPU 不只依赖独立 fixture。
- [x] `webgl2` 与 `webgpu` 后端显式选择，WebGPU 不支持时直接失败且不会静默回退。
- [x] WebGPU device
      lost 会重新获取等价 adapter、复核 capability，并自动恢复 device/context/manager、released
      texture backing 与原 target identity；恢复期安全跳帧、失败后显式抛错、destroy 可取消。
- [x] shader 只有 GLSL ES 3.00 source of truth；材质、阴影、present 与 mipmap utility
      pass 都在引擎预处理后由 Naga WASM 生成 WGSL。
- [x] 生成 WGSL 在默认 WebGPU language feature 上保留 std140 ABI，不依赖可选
      `uniform_buffer_standard_layout`。
- [x] Naga
      corpus 覆盖 Basic/PBR、灯光、阴影、skinning、morph、instancing、quantized、present 与 mipmap
      variant。
- [x] Playwright 在真实 WebGPU adapter/device/pipeline 上完成一帧 draw、submit 与 queue
      fence，不以 mock 冒充 UI 验收；另有不混入默认 CI 的可选物理 GPU 通道。
- [x] 内置数值 shader 数据进入固定 std140
      ABI；WebGPU 按 global/material/object/custom 四组和更新频率绑定。
- [x] WebGPU instancing 使用 `InstanceBlock` 分批，阴影使用 comparison depth atlas 与 `LightBlock`
      元数据。
- [x] ShaderMaterial、自定义 loader shader 与全部示例遵守 UBO/sampler 边界。
- [x] GLSL ES 3.00 的 3D、2D-array、array-shadow 与 signed/unsigned integer sampler
      family 全部经过 Naga、真实 bind group/pipeline、draw/submit 和精确像素 readback 闭环。
- [x] managed `Texture` 在双后端统一支持 2D/cube/3D/2D-array 与 integer format；integer/3D mip
      chain、nearest/anisotropy 约束、compressed 3D 拒绝和 compressed 2D-array 路径都有自动测试。
- [x] `updateSubTexture()` 只有 descriptor API，四类 target 的 raw/external/compressed update、cube
      mip 顺序、depth 原始上传、压缩尾级 block extent、有界历史与慢 backend
      checkpoint 恢复都有自动测试。
- [x] `Renderer`/`RenderTarget` 为双后端统一实现，覆盖 MRT、1×/4× MSAA、sampleable
      attachment、resize、render-to-target 与异步 readback；PostProcess 和 MeshPicker 不含 backend
      fallback。
- [x] 公共 `Framebuffer`/`LightShadow`/`CubeLightShadow`、灯光 `lightShadow` 与 renderer-owned
      framebuffer 配置已删除，没有临时兼容入口。
- [x] WebGPU 原生压缩纹理按 adapter
      feature 支持 BC/ETC2/ASTC，并明确拒绝 PVRTC，不替换空纹理或伪解码。
- [x] 后端中立 `getDiagnostics()` 替代并删除会探查 WebGL cache 的 `logGLResource()`。
- [x] std140 offset/stride、固定 block binding、dirty-range upload 和非法 classic
      uniform 有自动测试。
- [x] 旧构建、测试、文档生成和运行时 vendor 链路已删除。
- [x] CI 验证最低 Node 与当前 Node，发布前复用同一完整门禁。

## 后续维护规则

1. 禁止新增类型、lint、测试或 API 检查的临时豁免；无法表达的领域结构应先补类型模型。
2. 公共 API 变更必须同时更新源码 TSDoc、测试、API report、CHANGELOG 与消费测试。
3. 新增示例必须进入 Vite MPA 和自动 Playwright 页面清单，并默认通过 WebGL 2 +
   WebGPU；只有 WebXR 这类受浏览器平台 API 限制的边界才能显式列为单后端例外，例外不得实现失败后回退。不得以远程脚本或全局变量绕过依赖管理。
4. 渲染行为变化必须审查视觉 diff；只有确认是预期变化时才更新基线。
5. 覆盖率阈值只能保持或提高，不能通过扩大 exclude、空断言或无意义执行来提升。
6. 不提交
   `dist/`、`dist-examples/`、`docs/`、`site/`、coverage 或浏览器报告；发布只接受 CI 现场生成物。
7. 新工具必须替换旧工具的职责，不允许两套活跃构建、测试、文档或发布链路长期并存。
8. 不得恢复动态类/mixin
   API、backend-specific 生命周期别名、CommonJS/UMD 构建或浏览器全局入口。不得在 Vite/Node 工具中读取并改写第三方 UMD/CommonJS 源码来制造 ESM 入口。
9. 不得新增 WebGL 1/GLSL 1.00 兼容源码、手写 WGSL 镜像或 block 外 numeric uniform；WebGPU
   shader（包括 renderer-owned present、mipmap 与后续 utility
   pass）必须继续执行“当前 variant 预处理 → Vulkan GLSL 4.50 → Naga → WGSL”。
10. 不得让 WebGPU 失败后静默创建 WebGL 2
    renderer，也不得通过关闭 feature、跳过 pass、替换空纹理或吞掉 validation error 伪造成功；device
    recovery 只能在同一 WebGPU 后端内重建资源，恢复失败必须保留 cause 并进入显式失败态。可选能力必须成为显式 API、capability 或错误。
11. 新增 uniform block 必须先分配全局稳定 binding、定义 std140
    schema、补 offset/size 测试，并标明 owner、更新频率和 dirty
    revision；不能按 program 反射顺序临时占号。
12. 新增 shader feature 必须同时进入 WebGL 2 compile/link、Naga corpus 和适当的 WebGPU
    pipeline/UI 测试；只让某个 backend 通过字符串快照不算完成。
13. 新离屏、后处理、拾取和 readback 功能必须建立在公共 `Renderer`/`RenderTarget`
    上；不得新增只服务单后端的业务层 framebuffer 包装、CPU fallback 或静默能力替换。资源工具必须消费
    `getDiagnostics()`，不得恢复 backend cache 日志探针。
14. 新增 WebGPU
    device-owned 资源必须接入 suspend/restore/destroy 生命周期，并用测试证明恢复后公共对象 identity、所有权与当前 target 不变；CPU
    source 允许公开释放时必须提供私有、可清理且真实恢复测试覆盖的 backing，不能依赖旧 adapter 或不可观察的空重建。
