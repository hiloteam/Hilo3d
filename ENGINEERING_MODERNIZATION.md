# Hilo3d 现代前端工程改造记录

状态：已完成 · 目标版本：2.0.0 · 最后核验：2026-07-13

范围：源码、示例、测试、构建、类型声明、API 文档、站点、npm 包、CI 与发布流程

## 结论

本仓库已经从“JavaScript 文件改名为 TypeScript、但主体仍按旧工程运行”的过渡状态，改造成一套单一、严格、可复现的现代前端库工程。

现在的工程事实是：

- 所有一方维护的引擎源码、示例、测试和 Node 工具均为受严格检查的 TypeScript；`src/` 与 `examples/`
  中不再存在一方 JavaScript 实现。
- 源码内部使用原生 ESM、原生
  `class`、显式领域类型和标准浏览器 API；旧的动态类系统仅保留为公共兼容边界，内部实现不再依赖它。
- 渲染器以 WebGL 2 和原生 GLSL ES 3.00 为唯一图形后端；数值 shader 数据全部通过固定 std140 UBO
  ABI 传递，不存在 WebGL 1、GLSL 1.00 或逐项 numeric uniform 路径。
- Vite 负责库与多页面示例构建，Vitest Browser Mode 在真实 Chromium
  WebGL 环境中运行单元测试，Playwright 覆盖全部示例和确定性视觉回归。
- 类型声明、TypeDoc API 页面和 API Extractor 签名报告全部从同一份已检查源码生成。
- npm 发布物按真实 tarball 校验，而不是只检查仓库内文件；CI 和发布共用唯一的 `npm run validate`
  门禁。
- 旧 Gulp、Webpack、Babel、Mocha、JSDoc、手写声明、旧 `build/`、已提交的旧
  `docs/`、旧测试页、运行时 vendor 脚本和远程 CDN 依赖已经退出活跃工程。

本次改造没有使用 `@ts-nocheck`、`@ts-ignore`、`@ts-expect-error`、显式
`any`、目录级 lint 逃逸、空视觉断言、覆盖率排除核心目录或捕获错误后继续成功等临时手段。

## 改造结果

| 领域     | 改造前                                                  | 当前实现                                                                |
| -------- | ------------------------------------------------------- | ----------------------------------------------------------------------- |
| 语言     | 大量 `.ts` 仅透传旧 JavaScript，主体使用 `Class.create` | 全部一方代码严格 TypeScript；内部为原生 class 与 ESM                    |
| 类型检查 | 单一配置混合浏览器、测试与 Node 环境                    | `base/lib/test/examples/node` project references，严格规则全覆盖        |
| 静态质量 | lint 文件白名单，无统一 formatter                       | typed ESLint flat config 覆盖整仓，Prettier 与 EditorConfig 固化格式    |
| 库构建   | Gulp、Webpack、Babel 和历史 polyfill                    | Vite 8 + Rolldown，ES2022 ESM 与独立 UMD 构建，完整 source map          |
| 类型发布 | 手工维护的 namespace/CommonJS 声明                      | `tsc` 从源码 emit，声明 rollup 后由三种消费配置校验                     |
| API 契约 | JSDoc 静态产物，与源码和包入口脱节                      | TypeDoc 零警告文档 + API Extractor 签名基线                             |
| 单元测试 | 旧断言、旧 mock、浏览器错误不一定失败                   | Vitest 原生 `expect`/`vi`，Chromium Browser Mode，错误门禁与 V8 覆盖率  |
| UI 测试  | 少量代表页面 smoke test                                 | Playwright 加载全部 79 个示例，并检查页面、控制台、请求和 WebGL 错误    |
| 视觉测试 | 截图比较为空实现                                        | Linux Chromium/SwiftShader 确定性基线与像素差异阈值                     |
| 示例     | 旧全局变量、vendor 脚本、远程运行时资源                 | 严格 TS 多页面应用，本地 npm 依赖与本地静态资产                         |
| 渲染 ABI | WebGL 1/2 分支、GLSL 1.00 转译与逐项 uniform            | WebGL 2-only、原生 GLSL ES 3.00、固定 std140 UBO 与 sampler-only 例外   |
| npm 包   | 仓库内入口能运行即视为通过                              | publint、Are the Types Wrong、Bundler/NodeNext/UMD 类型与真实运行时消费 |
| CI/发布  | 老版本 Actions、Node 与零散命令                         | Node 22 最低版本 + Node 24 双矩阵，npm 12、Chromium、单一完整门禁       |
| 文档站点 | 跟踪旧生成物                                            | CI 现场生成 TypeDoc 与 Vite 示例站点并部署 Pages                        |

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

`Class.create`、`Class.mix` 与 `EventMixin`
继续作为 2.x 已发布 API 存在，并有类型与消费测试；这是有意保留的兼容边界，不是内部架构。新代码不得基于该兼容 API 扩展引擎内部实现。

### 运行时与资源

- WebGL 2 是强制运行条件。上下文创建失败会直接报告不支持，不再尝试 WebGL 1 或扩展模拟核心能力。
- VAO、实例化、MRT/draw buffers、三维/数组纹理和 UBO 均使用 WebGL 2 core
  API；扩展注册表只保留各向异性过滤、context loss、浮点颜色附件和纹理压缩格式等真正可选能力。
- 删除 `KHR_techniques_webgl` loader、类型和 SampleTechniques 资产。该历史扩展以任意 GLSL
  1.00 与 classic numeric uniform 为接口，无法满足固定 UBO
  ABI；仅改内置样例而继续宣称支持会使外部资产在 program link 时失败，因此不保留伪兼容入口。
- 删除 AMC 专有扩展；相关演示资产转换为标准 glTF。
- WebXR 使用标准 WebXR 类型与浏览器 API。
- 物理示例使用 `cannon-es`，Draco 使用由 Vite 封装的浏览器 WASM decoder。
- OSG、SMD、TGA 等示例 loader 都是严格 TypeScript，不再依赖旧 vendor 全局对象。
- 示例运行时资源来自仓库或 npm 依赖，不依赖第三方 CDN 才能通过测试。
- 处理 Draco 上游浏览器 wrapper 时，构建插件会验证预期结构；上游格式变化会直接使构建失败，而不是静默回退到 Node
  shim。

## WebGL 2 渲染 ABI

### 单一图形后端

引擎 shader 直接编写为原生 GLSL ES 3.00，使用 `in`/`out`、`texture()`、显式 fragment output 与 WebGL
2 core API。运行时不再 prepend WebGL 1 兼容宏，也不再把 `attribute`、`varying`、 `texture2D()` 或
`gl_FragColor` 动态改写为新语法。

这是一项有意的 breaking change：Hilo3d 2.x 不支持 WebGL 1 设备，应用也不能继续提交 GLSL
1.00 自定义 shader。删除兼容层的目的不是减少几条分支，而是让 shader 接口、资源能力、测试矩阵和错误模型只存在一种解释。

### 固定 uniform block binding ABI

所有内置数值 shader 数据按所有权和更新频率进入固定 std140
block。绑定号由 block 名称决定，而不是取决于某个 program 的反射顺序：

| Binding | Block           | 数据所有者与典型内容                        | 更新时机                      |
| ------: | --------------- | ------------------------------------------- | ----------------------------- |
|       0 | `FrameBlock`    | render size、时间与帧序号                   | 每个 renderer frame 一次      |
|       1 | `CameraBlock`   | view/projection、逆矩阵、相机位置与裁剪平面 | 每个 camera/render pass 一次  |
|       2 | `SceneBlock`    | fog 等 scene-owned 状态                     | scene revision 变化时         |
|       3 | `LightBlock`    | view-space 灯光、衰减与阴影参数             | 每个 camera/render pass 一次  |
|       4 | `MaterialBlock` | Basic/PBR、IBL、UV 变换与材质标志           | material revision 变化时      |
|       5 | `ModelBlock`    | model 与 world-normal 变换                  | 非实例对象的 transform 变化时 |
|       6 | `GeometryBlock` | position/normal/UV decode 变换              | geometry revision 变化时      |
|       7 | `SkinningBlock` | joint palette                               | skeleton pose 变化时          |
|       8 | `MorphBlock`    | morph weights 与 target 状态                | morph pose 变化时             |

这些名称和 binding 是公共 ABI，不允许重新排序或按 shader variant 临时分配。引擎通过
`UNIFORM_BLOCK_DATA_SIZE` 检查绑定范围，通过 `MAX_UNIFORM_BUFFER_BINDINGS`、
`MAX_UNIFORM_BLOCK_SIZE` 与 `UNIFORM_BUFFER_OFFSET_ALIGNMENT`
验证设备和动态 range。std140 布局由类型化 schema 生成并由 offset、matrix stride、array
stride 测试锁定；字段更新只上传 dirty byte range，不会为了使用 UBO 而在每次 draw 重新 `bufferData`
整块数据。

内置 block 占用 0–8。应用自定义 block 必须在 program 首次 link 前调用
`registerUniformBlockBinding(name)`，默认从 9 开始稳定分配；也可以显式指定全局唯一 binding。未注册 block、binding 冲突、超出设备上限或 buffer/range 小于反射大小都会立即失败。

当前灯光着色使用 view-space 数据，因此 `LightBlock` 与 `CameraBlock`
同属 render-pass 频率：切换 camera 时各更新一次，但不会在同一 pass 的每个 model
draw 重复上传。当前环境贴图、球谐与 IBL 强度允许逐材质变化，因此属于 `MaterialBlock`；`SceneBlock`
不虚构一个尚不存在的全局 environment owner。若未来引入 Stage
environment，必须作为显式 API/ABI 迁移评审，不能仅为追求名称整齐而改变现有材质语义。

固定 ABI 同时固定资源容量：最多 8 个 directional light、8 个 spot light、16 个 point
light、8 个 area light、128 个 skin joint 和 8 个 morph
weight。超过容量会抛出带领域名称和实际数量的错误，禁止截断数组、复用最后一项或退回 classic
uniform。提高上限必须先验证 WebGL 2 最低
`MAX_UNIFORM_BLOCK_SIZE`、纹理单元预算、shader 编译成本和所有 std140
offset 测试，再作为 ABI 变更评审。

### sampler 是唯一例外

GLSL opaque sampler 不能成为 uniform block 成员，因此 sampler 是 block 外唯一合法的
`uniform`：材质纹理、环境贴图、BRDF LUT、LTC、阴影贴图和 post-process input 都属于这个例外。program
link 后只为 active sampler 写入整数 texture
unit；渲染阶段绑定纹理对象。任何 block 外的 float、vector、matrix、integer、boolean 或其数组都会被
`Program` 拒绝，不能借 `ShaderMaterial`、`onBeforeCompile` 或示例代码绕过。

sampler 例外不是继续保留通用逐项 uniform 系统的理由。纹理 UV
channel、强度、尺寸、阈值和 kernel 等数值元数据必须进入相应的 Scene、Light、Material 或自定义 block；只有 opaque
texture handle 留在 classic uniform。

### 实例化、骨骼与 morph 边界

- 一次 instanced draw 不能按 `gl_InstanceID` 改变 UBO range。每实例 model/normal
  transform 使用显式 instanced vertex attributes；不再通过正则把 `uniform` 偷换成 `attribute`。
- `ModelBlock` 只服务普通 draw 或整个 batch 的公共数据；model-view 与 MVP 在 shader 中由
  `CameraBlock × ModelBlock`
  推导，不重复上传 camera-dependent 派生矩阵。自定义每实例数据也必须显式声明为 instance
  attribute，并接受 `MAX_VERTEX_ATTRIBS` 预算检查。
- geometry decode 变换属于低频 `GeometryBlock`，绝不能因为它被 vertex
  shader 使用就变成每实例 attribute 或每 model draw 重写。
- joint index/weight 和 morph target 仍是 vertex attribute；joint palette 进入
  `SkinningBlock`，morph weight 进入
  `MorphBlock`。骨骼/形变与实例化组合必须走明确支持的路径，不能因为 block 绑定方便而共享错误 pose。
- geometry-owned decode 数据、material-owned UV 变换和 model-owned
  transform 不得互相塞入错误 scope；否则会把低频数据退化为逐 draw 上传。

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

- 根入口 `hilo3d`：ES2022 ESM，是默认且唯一的现代入口；`gl-matrix` 保持 external，便于依赖去重。
- 兼容子路径 `hilo3d/umd`：`import` 条件解析到现代 ESM，`require` 条件解析到自包含UMD/CJS；浏览器
  `<script>` 直接加载 UMD 文件。它不会伪装成根路径 CommonJS 支持。
- 两种格式都带许可证 banner 和 source map。
- `.d.ts` 与 `.d.ts.map` 由 `src/Hilo3d.ts` 的真实依赖图生成，不存在手写镜像声明。

`package.json` 用 `exports` 明确入口，`files` 只允许发布
`dist/`、README、CHANGELOG 与许可证。Node 最低版本、npm 版本和 ESM 包语义都有机器可读约束。

### 包消费验证

发布校验覆盖：

1. `moduleResolution: "Bundler"` 的 ESM 类型消费；
2. `moduleResolution: "NodeNext"` 的 ESM 类型消费；
3. `hilo3d/umd` 的类型与加载方式；
4. 根 ESM 的 Node 运行时导入；
5. 浏览器 UMD 全局 `Hilo3d`；
6. publint 包结构检查；
7. Are the Types Wrong 导出条件检查；
8. `npm pack --dry-run` 文件白名单检查。

校验对象是构建后的真实包内容，因而能够发现错误 export
condition、缺失声明、错误扩展名、未发布依赖或多打包文件。

## API 文档与站点

API 工程有两个互补产物：

- `npm run docs:build` 使用 TypeDoc 从 `src/Hilo3d.ts`
  生成可浏览的 API 站点；无效链接、未导出类型和文档警告都会失败。
- `npm run api:check` 使用 API Extractor 将当前声明与 [`etc/hilo3d.api.md`](./etc/hilo3d.api.md)
  比较；公共签名意外改变会失败，计划内变更必须运行 `npm run api:update` 并审查 diff。

API Extractor 的 release-tag 提示按项目级固定政策关闭：Hilo3d
2.x 的根 barrel 导出面全部视为 public，不设置 alpha/beta 分层。setter 文档提示也按固定政策关闭：访问器说明由 getter/TypeDoc 作为唯一正文来源。两项都不关闭 TypeScript 诊断、forgotten
export、API 差异或 TypeDoc 验证，也不是待删除的迁移豁免。

`npm run site:build` 将 TypeDoc 输出放入 `/docs/`，将完整 Vite 示例构建放入
`/examples/`，再生成站点根跳转与 `CNAME`。生成目录不提交到主工作树，由 Pages 工作流每次重新构建。

## 测试体系

### 单元测试与覆盖率

单元测试运行于 Vitest Browser Mode + Playwright
Chromium，因此 DOM、Canvas 与 WebGL 行为来自真实浏览器上下文。测试初始化会把未预期的
`console.error`、shader compile/link error 与未捕获异常升级为失败。

当前基线：

- 86 个测试文件；
- 526 个测试全部通过；
- statements 60.92%；
- branches 40.00%；
- functions 58.96%；
- lines 62.59%。

覆盖率统计显式包含
`src/**/*.ts`，仅排除声明文件；没有为了达到数字排除 loader、renderer、animation 等低覆盖模块。阈值是完整源码的无回退基线：`60/40/58/62`
分别约束statements/branches/functions/lines。后续改动不得降低基线；新增功能应同时提高相关模块覆盖率。

### 全量 UI 测试

Playwright 自动从示例构建输入生成页面清单，不维护容易漏项的手工白名单。当前 79 个 HTML 示例全部通过以下检查：

- 页面完成加载并创建预期 Canvas；
- 无 `pageerror`；
- 无非预期 `console.error`；
- 无失败的本地资源请求；
- 无 shader compile/link 或 WebGL 初始化错误；
- loader 示例的异步模型与纹理真实完成请求。

示例套件按页面串行执行，以避免多个 SwiftShader
WebGL 上下文同时加载大型模型时争抢 GPU/内存；断言本身没有减少，也没有重试掩盖失败。

### 视觉回归

视觉套件使用固定 viewport、UTC、英文 locale、固定 device scale、禁用动画的 Linux
Chromium 和 SwiftShader。基线场景使用确定性的灯光 PBR 立方体，截图保存在
`test/ui/__screenshots__/`，像素差异比例上限为 0.5%。失败时保留 screenshot、trace 与 video 供定位。

## CI 与站点发布

CI 在 Node 22.22.2 与 Node 24 两档执行，使用当前维护的 GitHub Actions、锁文件安装、固定 npm
12.0.1 和显式 Chromium 系统依赖。PR、`dev`、`master` 与版本 tag 使用同一个
`npm run validate`；过期任务由 concurrency 自动取消。

站点发布工作流同样从干净 checkout 执行 `npm ci` 和
`npm run site:build`，再部署生成 artifact。仓库不再跟踪旧 API 生成物，也不会从开发者本机的残留目录发布。

## 唯一验收入口

```sh
npm ci
npx playwright install chromium
npm run validate
```

`validate` 按顺序执行：清理生成物、格式检查、typed lint、全部 TypeScript project
references、浏览器单测与覆盖率、库构建、三类类型消费、全量 UI、视觉回归、全部示例构建、TypeDoc 验证、API 签名比较、npm 包契约验证和 pack 文件检查。任一步失败都会阻止 CI 与发布。

其中 shader 静态门禁会同时扫描 `src/shader/` 和示例中的 shader 源码：禁止 GLSL 1.00
`attribute`/`varying`、`texture2D`/`textureCube`、`gl_FragColor`/`gl_FragData`、WebGL 1 shader
extensions，以及 block 外的 non-sampler `uniform`。运行时门禁会再次在 program
link 时拒绝漏网接口，静态规则与运行时规则互为补充。

## 验收清单

- [x] 一方源码、示例、测试与脚本没有类型检查绕过或显式 `any`。
- [x] 内部实现使用原生 ESM 与原生 class；动态类系统只保留在公共兼容边界。
- [x] TypeScript project references 隔离 lib/test/examples/node 环境并严格检查全部一方代码。
- [x] typed ESLint、Prettier 与 EditorConfig 覆盖整仓。
- [x] 公共声明从源码生成，API 文档与 API report 同源。
- [x] ESM、UMD、类型、source map、package exports 与真实 tarball 一致。
- [x] 86 个浏览器单测文件与 526 个用例通过，并执行完整源码覆盖率门禁；当前 statements
      63.75%、branches 43.94%、functions 63.55%、lines 65.35%。
- [x] 79 个示例全部构建并通过 UI 错误检查。
- [x] 关键 WebGL 场景具有真实截图差异测试。
- [x] 渲染器只创建 WebGL 2 上下文，shader 全部使用原生 GLSL ES 3.00。
- [x] 内置数值 shader 数据进入 binding 0–8 的固定 std140 ABI，sampler 是唯一 classic uniform。
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
8. 不得新增 WebGL 1/GLSL 1.00 兼容源码、运行时 shader 转译或 block 外 numeric
   uniform；兼容需求应通过明确的新后端设计讨论，而不是在 WebGL 2 backend 中恢复分支。
9. 新增 uniform block 必须先分配全局稳定 binding、定义 std140
   schema、补 offset/size 测试，并标明 owner、更新频率和 dirty
   revision；不能按 program 反射顺序临时占号。
