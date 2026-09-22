# Hilo3D engineering guide

Status: current contributor workflow, reviewed against source commit `6433334c` on 2026-09-20. This
document describes maintained commands and contracts; historical test runs are not a claim that a
new checkout passes. See [rendering architecture](./RENDERING_ARCHITECTURE.md) for renderer
internals, [compute/storage](./COMPUTE_AND_STORAGE.md) for shader exceptions, and
[the archived migration](./archive/ENGINEERING_MODERNIZATION.md) for earlier design decisions.

## Setup

Use Node.js 20.19.0 or newer and npm 10.9.4, as declared in package.json.

```sh
npm ci
npm run dev
# Or run the maintained gallery:
npm run examples:dev
```

### 多包与 workspace 决策

仓库采用一个 Git 仓库、一个 lockfile 和一组根级质量门禁管理多个独立发布包，也就是 npm workspaces
monorepo；它不是把所有能力重新合并为一个 npm 包。当前发布边界是根目录的 `hilo3d` 核心包，以及
`addon-particle/`、`addon-physics/`、`addon-live2d/` 三个 workspace：

- 粒子和物理，尤其 Rapier WASM，保持独立包和显式导入，未使用的能力不会进入核心依赖图；
- addon 用 peer dependency 声明支持的核心版本，用本地 `file:..` dev
  dependency 解析同仓核心，避免开发与 CI 意外加载 npm registry 中的旧版 `hilo3d`；
- 每个公开 export 都有 API Extractor 报告；JavaScript source map 内嵌 source
  content，addon 不发布会引用缺失 `../src` 的 declaration map；
- 发布门禁把核心与 addon 的实际 tarball 安装进空 consumer，并运行所有根入口和 Rapier
  subpath 的真实 ESM import。仅做 `publint`、声明检查或 dry-run 不足以证明 peer 版本可运行。

`addon-live2d` 只依赖核心公共 API；应用只提供模型资源。addon 内置并延迟初始化由其 `vendor/`
固定输入构建的运行时，发布包保留原样 Core、CPU Framework
bundle 和独立许可证；应用构建自动携带本地运行时资源，不配置 SDK 地址或访问 CDN。细节见
[Live2D](./LIVE2D.md)。

保持独立发布包比“单 npm 包 + 可选导出”更符合按需安装、WASM 隔离和依赖所有权。当前四个包尚不足以证明把根核心整体搬到
`packages/hilo3d/`
的大规模路径迁移有收益；如果以后出现独立版本、独立负责人或更多共享构建包，再统一迁入
`packages/*`，不改变上述发布边界。

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
`src/`、`examples/`、`test/`、`scripts/` 与工程配置。生成物和 `addon-live2d/vendor`
内保持原样的 SDK 输入单独排除；第三方来源、哈希与许可随输入保存，一方适配器和构建工具仍接受完整检查。

### 原生对象模型

引擎内部的 scene
graph、renderer、geometry、material、texture、loader、animation、math、light、camera 与 helper 均已迁移到原生类。构造参数、事件、WebGL 资源、uniform、shader
semantic、glTF、动画状态、纹理来源等动态结构均有明确的 interface、union 或 generic。

旧 `Class.create`、`Class.mix` 与 `EventMixin`
已从源码、根 barrel、类型声明和测试删除。所有可监听对象直接继承类型化的
`EventDispatcher`，资源生命周期统一使用 backend-neutral
`releaseGPUResources()`；不保留 backend 名称泄漏到公共 API 的旧别名。

相机输入也遵循单一公共实现：`src/controls/OrbitControls.ts`
提供透视相机的 orbit、dolly、pan、触摸手势与受约束的程序化
`setView()`。一方维护的浏览器示例复用该入口，不在示例目录内重复实现 pointer、wheel 或 touch 相机控制器；自动巡游在适用时同样通过 controls 更新视图。

### 运行时与资源

- `Stage` 与 `Renderer` 只提供异步 `create(...)` 创建入口。`Stage.create(...)` 接受
  `backend: 'auto' | 'webgl2' | 'webgpu'`；省略字段等同 `auto`。auto 通过
  `Renderer.isBackendSupported('webgpu', options)` 只执行 `requestAdapter` 与 adapter
  policy/feature/limit 校验，兼容时正式初始化一次 WebGPU，不兼容时直接创建 WebGL
  2。显式请求 WebGPU 后绝不会静默回退。
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
  2；双后端与 WebGPU-only 页面的完整范围由下文自动清单与合同验证。
- 资源观测统一为 `renderer.resourceManager.getDiagnostics(rootNode?)`
  返回的后端中立快照，包括已跟踪 mesh/resource、当前使用、待销毁数量和 frame 状态。会读取 WebGL 私有 cache 并产生日志副作用的
  `logGLResource()` 已从公共入口和源码删除。
- 物理能力位于独立的 `@hilo/addon-physics` ESM workspace；主 `hilo3d`
  入口不引用物理代码或 WASM。当前 `/rapier2d` 与 `/rapier3d` 入口分别使用 Rapier 的 2D/3D
  compat 包，并通过公共 Stage System
  ABI 接入；原 Cannon 依赖与示例已删除。原 Draco 示例适配器及演示资产已退出：上游只提供 UMD/CommonJS 风格的浏览器 wrapper，而可用的纯 TypeScript 候选无法通过本仓库的严格 TypeScript
  6 声明检查；不通过构建期字符串改写、假声明或 `skipLibCheck` 伪装成现代模块。
- 粒子能力位于独立的 `@hilo/addon-particle` ESM workspace；主入口仅保留通用的 `RenderNodeExtension`
  和 Stage System ABI，不导入粒子系统。粒子包通过 typed Stage
  service 托管系统、帧级预算与 renderer-before-teardown 销毁，也保留显式生命周期的独立构造方式。
- 示例画廊只保留仍能说明当前引擎能力的加载路径。OSG、SMD、TGA 等历史格式示例及其大体积专用资产已经移除；glTF、CanvasTexture、HDR 与压缩纹理示例继续使用严格 TypeScript 和受支持的公共 API。
- 示例运行时资源来自仓库或 npm 依赖，不依赖第三方 CDN 才能通过测试。
- Vite 配置不读取、截断或改写 `node_modules`
  中的 UMD/CommonJS 源码；依赖必须提供可直接消费的 ESM 与严格类型契约，否则删除该集成，等待合格实现后再按正常模块边界接入。

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
  先检查 Markdown 源链接/锚点、现行 npm 命令、recipes 与 catalog 同步，再生成可浏览的 API 站点，并把本文件、中文 README、CHANGELOG 与贡献规则作为 project
  documents 纳入同一个站点；无效链接、未导出类型和文档警告都会失败。
- `npm run api:check` 使用 API Extractor 将当前声明与 [`etc/hilo3d.api.md`](../etc/hilo3d.api.md)
  比较；公共签名意外改变会失败，计划内变更必须运行 `npm run api:update` 并审查 diff。

API Extractor 通过 `--typescript-compiler-folder node_modules/typescript` 使用项目锁定的 TypeScript
system declarations。这样 WebGPU DOM 类型、声明 emit 与 API 分析使用同一版本，不会让工具内置的旧
`lib.dom.d.ts` 猜测或漏掉 `GPU*` 公共类型；这保留全部 API 检查，只消除编译器版本漂移。

API Extractor 的 release-tag 提示按项目级固定政策关闭：Hilo3d
2.x 的根 barrel 导出面全部视为 public，不设置 alpha/beta 分层。setter 文档提示也按固定政策关闭：访问器说明由 getter/TypeDoc 作为唯一正文来源。两项都不关闭 TypeScript 诊断、forgotten
export、API 差异或 TypeDoc 验证，也不是待删除的迁移豁免。

`npm run site:build` 是本地和 CI 部署 API 文档的单一入口。它会先为核心包、粒子、物理和 Live2D
addon 构建并检查声明，再生成 TypeDoc、示例和相互链接的站点；工作流不得在未生成这四个包时直接调用依赖预构建产物的 API 检查。

typed lint 同样遵循干净 checkout 规则：工作流调用
`npm run lint`，由该命令先构建核心和 addon 声明，再执行 ESLint；不得自行组合会遗漏 workspace 声明的
`build:types` 和 `lint:built`。`check:modernity` 会强制检查这两项工作流契约。

唯一的 `Renderer`、backend-neutral `RenderTarget`、`Stage<'webgpu'>`、异步
`MeshPicker`、`ShadowCastingLightParameters`、`KTXTextureOptions`、资源诊断与压缩纹理 capability 从根 barrel 导出，因而同时进入
`.d.ts`、TypeDoc 与 API report。Concrete backend driver、target、Naga translator、native
manager 和 binding API 保持内部；不存在文档手写声称为公共接口的影子 API。包消费类型测试直接通过
`Renderer`/`RenderTarget` 使用 MRT、MSAA、readback、压缩纹理查询和资源诊断，不把 backend-specific
target 当成跨后端主契约。

Renderer 在首次 WebGPU device 创建和 device recovery 前复用已经完成 `await initialize()` 的
`ShaderArtifactCompiler`，把 mipmap GLSL utility 准备为 vertex/fragment Shader
Artifact 后显式注入具体设备。内部 `RHIFactory` 把 mipmap Artifact 定义为 WebGPU device create
options 的必填依赖，并在运行时再次校验；它和 WebGPU backend 都不反向 import
renderer/GLSL、不隐式启动 Naga，也没有 WGSL fallback。shader
module/layout/sampler 在 device 创建时建立，按 format 复用的 pipeline 与逐 mip/layer view、bind
group 在 texture allocation 时准备，因此 command execute 只编码 mipmap render pass。

`npm run site:build` 将维护的静态首页放在站点根路径，将 TypeDoc 输出放入
`/docs/`，将完整 Vite 示例构建放入 `/examples/`，并复制 `CNAME`。同时发布 root
`llms.txt`、维护的 Markdown、recipes 与 `documentation/build.json`
来源信息；源码链接固定到构建 commit，本地修改和未打 release tag 的 checkout 标为 development。详见
[AI 文档维护](./AI_DOCUMENTATION.md) 与
[版本边界](./VERSIONS.md)。首页、文档和案例页互相提供导航入口。生成目录不提交到主工作树，由 Pages 工作流在
`dev` 分支更新后重新构建并通过 GitHub
Actions 部署。站点构建完成后还会扫描生成的 HTML/CSS/glTF/Markdown/llms.txt，拒绝缺失的内部资源和依赖站点根路径的内部链接，确保自定义域名与 GitHub
Pages 子路径部署使用同一份产物。

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

### 96 个 HTML 的后端适用矩阵

Playwright 递归扫描 `examples/`
自动生成页面清单，不维护容易漏项的手工白名单。当前有 96 个 HTML，包含 94 个示例和两个画廊入口；81 个页面执行双后端，WebXR 执行 WebGL
2，14 个页面执行 WebGPU，共 177 个 page/backend 组合。WebGPU-only 范围包含 Bloom、两个 Clustered
Forward+ 灯光场景、动态 GI、体积光、大气天气、阴影驻留、SSR、TAA、四个 compute 场景和 GPU 粒子星云；准确路径由
`test/ui/example-paths.ts` 的 `WEBGPU_ONLY_EXAMPLE_PATHS`
与独立合同锁定。这些是创建前的显式能力边界，不是初始化失败后的 runtime fallback。

任何示例的后端适用范围发生变化时，必须同步更新
`examples/shared/catalog.ts`、`test/ui/example-paths.ts` 和 `test/ui/example-paths.contract.ts`
中的显式数量与例外集合，并在提交前运行
`npm run test:ui:contract`。画廊在任一首选后端下都展示完整 catalog，并为单后端条目标记 `WebGPU only`
或
`WebGL 2 only`；选择不兼容条目时，iframe 使用该条目唯一支持的后端。已有双后端页面改为单后端时，总 page/backend 测试组合数会减少一，但画廊条目总数保持不变。

画廊对 94 个示例逐项维护标题、用途、主题与后端要求；缺失元数据、重复路径、已删除页面的残留条目都会令合同失败。默认展示 25 个精选；主题数量、搜索与后端筛选始终限定在当前 Highlights 或 All
examples 集合内。主题数量同时反映搜索和后端条件，无结果的未选主题不显示；多词搜索支持顺序无关匹配及中文主题关键词。
`q`、`category`、`collection`、`compatible`
保存在画廊 URL 中，不传给示例；切换示例会清除上一个示例的专属参数。手机侧栏关闭后使用 `inert`
避免隐藏元素获得焦点，支持 `/`
搜索、Escape 关闭和 Tab 焦点循环。示例构建在场景脚本前注入轻量错误桥，将未捕获错误交给同源父画廊显示并提供重试；它不拦截或吞掉浏览器原始错误，也不替代真实 GPU 完成验证。静态发布不复制
`.blend`
创作源文件；它们继续保留在仓库；Markdown 授权与来源说明继续随静态资产发布。完整逐项用途与保留/清理决策见
[示例目录整理](./EXAMPLE_CATALOG.md)。

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
validation 或 decoder-backing 上传错误。`renderTarget`、bloom、life-game 还会在各自适用后端以 DPR
1.25/1.5 下验证取整后的 backing size、真实 draw 和相同终态错误门禁，避免非整数尺寸进入 GPU
descriptor。CI 使用单 worker控制 SwiftShader GPU/内存峰值；没有重试或吞错来掩盖失败。

ShaderToy 的专用交互门禁会暂停 ticker，通过 320×180 offscreen
target 做两次显式 readback，断言彩色像素、pointer 坐标、输出 hash 变化和新的 native
draw/submit；普通示例门禁因此不再重复加载同一重型 ray-march 页面。这个唯一例外仍在两个后端保留 GPU
health、页面、网络、console、DevTools graphics 与终态稳定帧门禁，并由
`DEDICATED_RELEASE_TEST_EXAMPLE_PATHS`
契约锁定；通用门禁与专用门禁合计仍覆盖完整的 177 个 page/backend 组合。由于该 ray-march 交互在 GitHub
hosted runner 上成本过高，GitHub
Actions 明确跳过这一个专用用例；本地与发布前完整 Playwright 门禁仍会执行它。

### WebGPU 深度运行时测试

`npm run test:webgpu` 在 Chromium 中以最小 ANGLE/WebGPU 参数启用 SwiftShader
adapter。它属于本地/发布完整浏览器门禁；GitHub hosted Linux 的 SwiftShader 无法稳定完成 canvas
presentation，因此 hosted CI 不伪装执行这条通道。测试创建真实 `GPUAdapter`、`GPUDevice`、canvas
context、Naga shader module、bind group、render pipeline 与 command
encoder，在同一帧覆盖 Basic/PBR、`InstanceBlock` 批处理、带 primitive restart 和局部更新的 Uint8
indexed strip、mipmap 2D texture 替换、directional/spot/point 三类阴影、4× MSAA/stencil offscreen
target、双 attachment MRT、fullscreen present 与对齐 readback。测试同时断言 backend、draw
count、face count、attachment/sample count、texture revision、非零像素、GPU validation
error、页面异常和控制台错误；它不是只检查 `navigator.gpu`、只 mock device 或只测试 WGSL 字符串。

同一真实浏览器闭环还通过 managed `Texture` 创建 3D、2D-array、unsigned-integer
array、depth-array、numeric depth 与动态 sampler-array 资源，让 Naga 转译包含 `sampler3D`、
`sampler2DArray`、`sampler2DArrayShadow`、`usampler2DArray`、普通 depth `sampler2D`
和 UBO 动态索引的 GLSL ES 3.00，随后建立真实 bind-group layout、bind group 与 render
pipeline，执行 draw、queue submit 和 buffer map。门禁要求 shader compilation message 与 GPU
validation error 均为空，全部纹理解析出的 dimension 正确，并且 1×1 输出像素精确为
`[64, 128, 200, 255]`；这证明能力不是只在 translator 或 fake-device 单测中存在。

这项专用 fixture 是普通双后端示例之外的深度能力测试，不是唯一的 WebGPU UI 覆盖。同一套 `test:webgpu`
还让压缩纹理示例分别通过两个后端渲染各自声明支持的 source，确认 WebGPU 原生 BC/ETC2/ASTC 路径且明确跳过 PVRTC，并让异步 GPU
`MeshPicker` 在两个后端选择同一 mesh。

G0/L0 的 renderer browser fixture 直接构造注册的 opaque `Mesh`、GPU Scene
bucket 与动态局部光，验证 previous-frame Hi-Z、frustum/occlusion/LOD/compact、fixed indexed-indirect
arguments、3D cluster allocator、storage GGX PBR 与 diagnostics
readback。该测试不把 diagnostics 数据用于 draw 或 light
allocation，也不替代受控硬件上的 100k/10k 性能 baseline。

Compute/storage 另有 WebGPU-only showcase/acceptance fixture：它通过公共 SRP 记录 depth
prepass、sampled-depth tile culling、Scene group-3 readonly storage、Gaussian
reorder 与 1024 粒子 Hilo3D wordmark 的 fractal value/curl
noise、呼吸、涡旋、回归和 compaction，再用 GPU-generated indirect draw 产生 Gaussian 与 additive
particle glow。门禁检查真实 compute pass/dispatch/indirect draw、最终 readback 和 reload
determinism；只允许最后一次颜色验收 readback，不把 visible count、排序或 indirect
arguments 映射到 CPU。Forward+/Gaussian 算法仍是 acceptance-scale，页面也不是性能 baseline。

独立的 `compute_particles.html` 继续复用同一公共路径，把 65,536 个持久 GPU body 分成 4096 个 Hilo3D
word-lattice 粒子和 61,440 个分层星空、极光/星云与 cyber-dune deep-field body；三 octave value/curl
noise、回归力、轨道力场、低频流星头部碰撞和尾迹力场、边界反弹与鼠标磁吸/shockwave/vortex 都在一次 Direct
WGSL compute 中更新，再由三次 indirect draw 分别绘制 deep
field、additive 速度 halo 与 alpha-blended 发光 core。专用 Playwright 门禁发送真实 pointer 事件，检查上下坐标映射、字形采样覆盖和边缘背景亮度，冻结步进后比较确定性 readback
hash，并检查 compute dispatch、indirect draw 和终态 GPU validation；页面不把粒子状态映射回 CPU。

`compute_raytracing.html` 则用一个 renderer-owned storage buffer 跨帧累积 HDR
radiance/normal/depth，由 Direct WGSL
compute 对解析球体、SDF 倒角方块、静态水面和 SDF 挤出/倒角的 Hilo3D 水晶字形求交，并完成五次 bounce、Fresnel 反射/折射、吸收、RGB 分波段色散、面积光软阴影、球透镜与文字投影光谱焦散、带可见性测试和 HG 相函数的单次体积散射及 Russian
roulette。公共 storage-aware GPU-driven pass 执行边缘感知降噪、anamorphic
bloom、ACES 与 present；拖拽环绕或滚轮 dolly 会重置累积，全程保持同一个 registry-stable bind
group。专用 Playwright 门禁验证真实 compute/dispatch/draw、渐进 readback、原生 bind-group 创建数稳定与终态 GPU
validation，且源码不访问 native WebGPU 对象。

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
只支持手动触发，并要求带 `self-hosted`、`linux`、`gpu` 标签的 runner；默认 hosted
CI 通过 SwiftShader native/offscreen RHI 测试覆盖 WebGPU 核心，不声称具有 WebGPU
presentation 能力。WebXR 明确不属于该 WebGPU 通道。

### 视觉回归

视觉套件使用固定 viewport、UTC、英文 locale、固定 device
scale、禁用动画的 Chromium 和 SwiftShader。同一个确定性灯光 PBR 场景分别通过 WebGL
2 与 WebGPU 渲染；除截图外还断言 readback 背景像素、变换后像素数、方向光覆盖和前景颜色数量，并在运行时要求两个后端的首帧截图逐字节相同。两个后端仍各自保存
`test/ui/__screenshots__/`
基线以定位单后端回归；失败时保留 screenshot 与 trace，本地运行还会保留 video。GitHub hosted
CI 只运行稳定的 WebGL 2 visual baseline，完整双后端视觉与像素 parity 属于本地/发布或物理 GPU 验证。

## CI 与站点发布

CI 只保留项目最低版本 Node 20.19.0 这一个测试档位，使用当前维护的 GitHub
Actions、锁文件安装、固定 npm 10.9.4 和显式 Chromium 系统依赖，避免在 Node
20/22/24 上重复运行同一套高成本 GPU 矩阵。PR、`dev`、`master`
与版本 tag 先执行 modernity、格式、声明、lint、TypeScript project
references 和示例目录合同预检；预检成功后并行执行两个 Vitest
coverage 分片、RHI/架构、包/API/文档，以及六个 Playwright WebGL 2 页面/交互/视觉工作组。每个 GPU
job 内仍只使用一个 worker，不在同一 SwiftShader 进程并发争用设备；coverage 模式因此关闭 Vitest 文件并行，同时保留跨 runner 的两个分片。coverage
artifact 保留上传时的仓库相对目录，汇总 job 从其嵌套 `reports/vitest` 目录只读取 blob
report；跨 runner 分片完成后分别合并 coverage 和 Playwright 报告，并由稳定的 `Required CI`
聚合门禁统一给 branch
protection 使用。预检导致测试分片跳过时，报告汇总也跳过，避免缺失产物掩盖最初的失败。Playwright
presentation/UI 使用 `channel: chromium` 的完整 Chromium headless
compositor，保留 SwiftShader、单 worker、零重试和既有像素/物理/交互断言；不使用独立的 headless
shell。示例 HTML 由 Vite 统一声明空 favicon，避免浏览器自动请求不存在的 `/favicon.ico`。Linux hosted
runner 的 SwiftShader 会在 coverage instrumentation 下销毁 storage-aware
raster 的真实设备，因此只有对应的一项真实设备集成测试在 GitHub Actions
coverage 中跳过；本地 coverage 仍执行该测试，portable storage/RHI 合同继续由独立 RHI job 验证。

### 动态 GI 浏览器验收

`dynamic_global_illumination_atelier.html` 是 WebGPU-only 专项案例，进入 `test:webgpu` 和
`test:webgpu:native`，不重复进入普通 gallery 首帧矩阵。真实像素覆盖 GI 开关、独立灯具移动、门/墙色变化、截图后继续交互和销毁后的错误观察。该专项在本地也关闭视频，保留 trace、失败截图和显式 compositor 像素证据：同机 SwiftShader 首帧在视频录制下超过 120 秒，关闭视频的完整交互用例约 21 秒，诊断运行的 21 帧预热在 20 秒内完成。测试没有放宽像素阈值、增加 retries 或省略真实提交。原生 Metal 美术对照使用 production 分辨率；它与软件 GPU
CI 的正确性证据分开。

### 重型浏览器测试的维护约定

`HILO3D_UI_GROUP` 将同一 hosted UI 命令分成
`catalog`、`catalog-scenes`、`csm`、`physics`、`post-processing` 和
`chromatic`。默认不设该变量时仍运行完整矩阵。分组规则位于
`scripts/playwright-ui-groups.ts`；预检执行
`npx jiti scripts/check-ui-groups.ts`，用 Playwright 实际发现的测试 ID 验证六组的并集等于完整 WebGL2 清单，且没有重复或空组。新增测试必须进入恰好一组，新增工作组时同步修改规则、workflow
matrix 和清单检查。Chromatic 与 SSGI
chapel 已由双后端专项覆盖，不再重复运行通用首帧门禁；SSGI 专项继续验证启用/关闭后的像素差异、页面错误和 GPU 健康。

`catalog-scenes` 承担自动发现的 HTML 原生绘制/像素验收；`catalog`
承担画廊导航、2D 交互、运行时交互和基础视觉用例。拆分依据为同类 GitHub hosted
runner 的耗时产物：dev 的 run 34704509285 中，原 catalog
87 个用例累计 1424.9 秒，其中 72 个通用页面用例占 1146.5 秒；PR #125 的 run
35451054903 在新增画廊用例后超过 1500 秒整组期限。两个分组继续各使用一个 GPU
worker、独立 blob 文件和原有逐例/整组超时；清单检查保证每个用例恰好运行一次。画廊筛选/URL 状态测试使用轻量 iframe 文档，避免仅验证后端选择菜单时在 hosted
WebGL2 通道启动真实 WebGPU
presentation；原有双后端画廊集成和全部页面的原生绘制、像素、GPU 健康检查保留。

使用 `createExampleContext()` 的示例在显式 `?test=1` 时提供共享截图控制，正常页面不暴露该控制。
`test/ui/stable-capture.ts` 先确认真实 native draw，再暂停 ticker、等待 renderer
submission 完成、采集 compositor 像素，并在 `finally`
中恢复 ticker；queue 或截图失败也恢复。Physics、CSM、Chromatic 共用此路径。测试模式还通过
`examples/shared/test-frame-control.ts`
等待上一帧提交完成，再留出 50ms 输入处理窗口，避免点击、状态读取和断言期间持续提交 SwiftShader 帧。截图持有暂停状态时，后台 fence 完成不能提前恢复 ticker；页面销毁后也不能重新恢复。Physics 使用真实 elapsed
time 推进仿真，保持现有动作和物理断言。CSM 的虚拟时钟专项显式使用 `testClock=1`，由 Playwright
clock 控制 RAF/timer，不让真实 GPU fence 阻塞虚拟时间推进；其余 CSM 用例使用提交限流。Chromatic 的
`test=1` 模式通过专用 `advanceFrames()`
先跨过浏览器 resize/RAF 事件边界，再固定推进真实 Stage 帧并等待提交，测试断言帧数精确增长、原生 draw/pass 和像素变化，正常页面仍由 ticker 连续驱动。Physics 测试使用 512px 阴影图，CSM 保留其等预算阴影对比规格，Chromatic 保留实际后处理链。随机种子、动画相位和分辨率按示例已有合同控制，禁止全局替换随机数或时钟以掩盖时序错误。

CSM 和 Physics 截图前等待两个实际 ticker 帧，不能以 RAF 回调数代替已渲染帧数；限流期间 RAF 仍可执行，但场景可能尚未更新。等待者在页面销毁时会被清理并拒绝。

UI 默认关闭 trace 连续画面采集，保留 DOM、操作、源码和网络记录；CI 关闭视频，保留失败截图和显式像素断言。涉及像素和 presentation 的工作组继续使用完整 Chromium；无像素要求的合同由 Node 或独立 RHI
lane 检查。 `scripts/playwright-timing-reporter.ts` 将每例耗时、超时预算及结果写入
`reports/ui-timings`，上传保留 14 天，并在 Actions
summary 列出最慢 20 项。耗时达到预算 70% 时发出诊断提示；这些结果不是 GPU 性能基线。每组 Playwright 总期限为 25 分钟，早于 Actions 的 30 分钟 job 期限，给失败报告和产物上传预留时间。调整超时前应比较同 runner 的多次记录，确认耗时分布并检查 trace；禁止通过重试、跳过或更新视觉基线消除失败。

修改重型示例或截图工具后，至少运行受影响的完整工作组，例如：

```sh
CI=true HILO3D_UI_GROUP=physics npm run test:ui:webgl2:ci -- --reporter=line,./scripts/playwright-timing-reporter.ts
```

共享截图工具变更需补充 WebGPU 验证；CI 编排变更需通过清单检查。运行本地多个工作组时用
`HILO3D_PLAYWRIGHT_PORT` 分配不同端口，优先串行 GPU 检查，避免本机资源竞争污染耗时判断。

WebGPU 由独立 RHI job 中的 native/offscreen SwiftShader
lane 验证 adapter、device、pipeline、draw、submit、readback 与 backend contract。GitHub hosted
Linux 不稳定的 WebGPU canvas presentation 不作为虚假的合并门禁；完整双后端页面/视觉矩阵仍由本地
`npm run validate`、`npm run release:check` 与手动 physical-GPU workflow 负责。串行的
`npm run validate:ci` 保留为 hosted 门禁的本地复现入口，过期任务由 concurrency 自动取消。

Portable RHI benchmark smoke 只以单 draw 生产场景验证 fixture、allocation
profiler、readback 和当前 RHI 路径。它不属于普通合并门禁；独立 workflow 仅在 benchmark/performance 路径变化、每日定时或手动触发时运行 WebGL
2 production smoke。GitHub hosted Linux 的 SwiftShader WebGPU production
fixture 会在首帧前丢失 fallback device，因此 WebGPU 仍由独立 `test:rhi` native
lane、本地完整 UI/视觉矩阵和已登记 M3 Max macOS/Metal physical-GPU
benchmark 覆盖。正式采集固定 Node、Playwright/Chromium 二进制、系统/Metal 指纹，并在每次审计、采集与冻结前要求接入交流电、High
Power
Mode 和无热/性能告警。面向小型引擎的全量正式采集固定为 3 轮、每轮 120 帧预热和 500 帧 CPU/GPU 采样，不作为优化开发的逐次内循环；开发中使用 production
smoke 与受影响的定向测试，只有建立或替换跨提交不可变证据时才执行全量矩阵。分配证据保留逐字节采样，但在固定 profiler 预热与丢弃的稳定探针后让每个真实帧使用独立 CDP
profile，避免高 draw 场景产生无界响应。绝对分配门禁只由单 draw 哨兵承担；压力场景仍记录分配数据供跨提交分析，不把 V8
sampler tier
metadata 的波动误判为引擎回归。正式采集输出 scenario/backend/round 阶段进度，为每个浏览器阶段设置失败关闭超时，并在无响应时中止 owned
heap-profiler session。脚本直接运行时默认按 WebGPU、WebGL
2 顺序为每个 scenario/backend 启动独立 Chromium，且非证据 SwiftShader 用例不申请正式 rig 才需要的 WebGPU
`timestamp-query`。smoke 始终标记为 non-evidence，不替代物理 GPU 多场景冻结基线；需要扩展诊断时显式使用
`--all` 入口。定向 churn
smoke 默认覆盖一个完整普通 mesh 替换周期后结束，只有验证 10,000 帧完成行为时才传
`--full-churn`；正式登记采集始终完成全部 churn 帧。

站点发布工作流同样从干净 checkout 执行 `npm ci`，再通过自包含的 `npm run site:build`
完成核心与 addon 声明构建、API 检查和站点生成后部署 artifact。仓库不再跟踪旧 API 生成物，也不会从开发者本机的残留目录发布。

## 唯一验收入口

```sh
npm ci
npx playwright install chromium
npm run validate
```

`validate` 按顺序执行：清理生成物、旧 JavaScript/旧工具配置门禁、格式检查、typed
lint、全部 TypeScript project
references、浏览器单测与覆盖率、库构建、两类 ESM 类型消费、96 个 HTML 后端适用矩阵（81 个双后端、WebXR 显式 WebGL
2-only、14 个 compute、Clustered、GI、时序与粒子页面（包括 Bloom）显式 WebGPU-only）、双后端交互、WebGPU 深度运行时、双后端视觉回归、全部示例构建、TypeDoc 验证、API 签名比较、npm 包契约验证和 pack 文件检查。任一步失败都会阻止 CI 与发布。

其中 shader 静态门禁会扫描 `src/shader/` 和示例中的 shader 源码：禁止 GLSL 1.00
`attribute`/`varying`、`texture2D`/`textureCube`、`gl_FragColor`/`gl_FragData`、WebGL 1 shader
extensions，以及 block 外的 non-sampler `uniform`。现代性门禁只允许与 `new ComputeShader(...)`
结构化关联并由 compiler/Naga 验证的 Direct WGSL `@compute`；`@vertex`/`@fragment` graphics
WGSL、普通 Shader 中的 GLSL ES 3.10 和未受控 raw source 继续禁止。`StorageGraphicsShader`
是唯一 GLSL ES 3.10 readonly-storage 入口。扫描范围同时覆盖生产 `.vert`/`.frag`/`.glsl`/`.wgsl`
源文件，不允许通过非 TypeScript 扩展绕过。运行时门禁会再次在 program link、Naga
translation 或 WebGPU pipeline creation 时拒绝漏网接口，静态规则、WebGL 2 link、Naga
corpus 与真实 WebGPU pipeline 互为补充。

## npm 发布生命周期

版本提交的功能 CI 通过后，创建并推送 npm 发布 tag：

```sh
npm run release:tag:push
```

`release:check` 保留为完整 `validate`
的显式别名，可用于本地候选版本验收，但不再是 tag 发布步骤。功能提交 push 触发的普通 CI 负责单元、覆盖率、RHI、浏览器、视觉、文档、API 和包消费门禁；发布操作应在该提交的 CI 通过后进行。

`release:tag:push` 要求工作区干净，确认根包与两个 addon 的版本完全一致、可作为 Git tag，并拒绝本地或
`origin` 上指向其他提交的同名 tag。命令创建带 `publish <version>` 注释的版本 tag，只推送
`refs/tags/<version>`，再从远端核验其目标提交；同一提交上的重试是幂等的。

`.github/workflows/publish.yml` 监听版本 tag。GitHub-hosted
runner 只用仓库固定的 Node/npm 工具链确认 tag、三个包版本与提交完全一致，不重复执行普通 push
CI 已经覆盖的功能门禁；随后切换到 npm Trusted Publishing 支持的 Node 24/npm
11，通过 OIDC 依次发布核心、粒子 addon 和物理 addon。两个 addon 的 `hilo3d` peer
dependency 必须等于同批版本；幂等重试跳过 registry 中已经存在的包版本。预发布版本自动使用
`next`，正式版本使用 `latest`，不得让 prerelease 覆盖 `latest`。npm package 的 Trusted
Publisher 必须为三个 npm 包分别绑定 `hiloteam/Hilo3d` 与 `publish.yml`，允许
`npm publish`；workflow 只授予 `contents: read` 与
`id-token: write`。如 registry 只接受了部分包，可通过 workflow dispatch 传入已有 `release_tag`
重试；workflow 会检出该 tag，并跳过 registry 中已经存在的同版本包。

`npm publish` 的 `prepublishOnly` 仍运行轻量 `publish:check`：现代性门禁和 tag/commit 复核。Hilo3D
Skill 由 `validate` 与 `validate:ci` 中的 `test:skill` 回归，不在上传阶段重复高成本矩阵； `prepack`
从 tagged source 重新构建 JS、source map 和声明。

## 后续维护规则

1. 禁止新增类型、lint、测试或 API 检查的临时豁免；无法表达的领域结构应先补类型模型。
2. 公共 API 变更必须同时更新源码 TSDoc、测试、API report、CHANGELOG 与消费测试。
3. 新增示例必须进入 Vite MPA 和自动 Playwright 页面清单，并默认通过 WebGL 2 +
   WebGPU；只有 WebXR 这类浏览器平台边界或 compute/storage 这类正式公开为 WebGPU-only 的 capability 才能显式列为单后端例外，例外不得实现失败后回退。不得以远程脚本或全局变量绕过依赖管理。
4. 渲染行为变化必须审查视觉 diff；只有确认是预期变化时才更新基线。
5. 覆盖率阈值只能保持或提高，不能通过扩大 exclude、空断言或无意义执行来提升。
6. 不提交
   `dist/`、`dist-examples/`、`docs/`、`site/`、coverage 或浏览器报告；发布只接受 CI 现场生成物。
7. 新工具必须替换旧工具的职责，不允许两套活跃构建、测试、文档或发布链路长期并存。
8. 不得恢复动态类/mixin
   API、backend-specific 生命周期别名、CommonJS/UMD 构建或浏览器全局入口。不得在 Vite/Node 工具中读取并改写第三方 UMD/CommonJS 源码来制造 ESM 入口。
9. 不得新增 WebGL 1/GLSL 1.00 兼容源码、手写 graphics WGSL 镜像或 block 外 numeric uniform；portable
   raster（包括 renderer-owned present、mipmap 与后续 utility
   pass）必须继续执行“当前 variant 预处理 → Vulkan GLSL 4.50 → Naga → WGSL”。Direct WGSL 只能通过
   `ComputeShader`，storage-aware raster 只能通过 `StorageGraphicsShader` 的受控 GLSL ES 3.10
   contract。
10. 不得让 WebGPU 失败后静默创建 WebGL 2
    renderer，也不得通过关闭 feature、跳过 pass、替换空纹理或吞掉 validation error 伪造成功；device
    recovery 只能在同一 WebGPU 后端内重建资源，恢复失败必须保留 cause 并进入显式失败态。可选能力必须成为显式 API、capability 或错误。
11. 新增 uniform block 必须先分配全局稳定 binding、定义 std140
    schema、补 offset/size 测试，并标明 owner、更新频率和 dirty
    revision；不能按 program 反射顺序临时占号。
12. 新增 portable raster shader feature 必须同时进入 WebGL 2 compile/link、Naga
    corpus 和适当的 WebGPU pipeline/UI 测试；WebGPU-only compute/storage feature 必须进入 Direct
    WGSL/GLSL ES 3.10 compiler、portable RHI、真实 WebGPU 与 WebGL 2
    negative 门禁。只让某个 backend 通过字符串快照不算完成。
13. 新离屏、后处理、拾取和 readback 功能必须建立在公共 `Renderer`/`RenderTarget`
    上；不得新增只服务单后端的业务层 framebuffer 包装、CPU fallback 或静默能力替换。资源工具必须消费
    `getDiagnostics()`，不得恢复 backend cache 日志探针。
14. 新增 WebGPU
    device-owned 资源必须接入 suspend/restore/destroy 生命周期，并用测试证明恢复后公共对象 identity、所有权与当前 target 不变；CPU
    source 允许公开释放时必须提供私有、可清理且真实恢复测试覆盖的 backing，不能依赖旧 adapter 或不可观察的空重建。
