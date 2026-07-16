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

- 删除 AMC 专有扩展；相关演示资产转换为标准 glTF。
- WebXR 使用标准 WebXR 类型与浏览器 API。
- 物理示例使用 `cannon-es`，Draco 使用由 Vite 封装的浏览器 WASM decoder。
- OSG、SMD、TGA 等示例 loader 都是严格 TypeScript，不再依赖旧 vendor 全局对象。
- 示例运行时资源来自仓库或 npm 依赖，不依赖第三方 CDN 才能通过测试。
- 处理 Draco 上游浏览器 wrapper 时，构建插件会验证预期结构；上游格式变化会直接使构建失败，而不是静默回退到 Node
  shim。

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

- 82 个测试文件；
- 504 个测试全部通过；
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

## 验收清单

- [x] 一方源码、示例、测试与脚本没有类型检查绕过或显式 `any`。
- [x] 内部实现使用原生 ESM 与原生 class；动态类系统只保留在公共兼容边界。
- [x] TypeScript project references 隔离 lib/test/examples/node 环境并严格检查全部一方代码。
- [x] typed ESLint、Prettier 与 EditorConfig 覆盖整仓。
- [x] 公共声明从源码生成，API 文档与 API report 同源。
- [x] ESM、UMD、类型、source map、package exports 与真实 tarball 一致。
- [x] 82 个浏览器单测文件与 504 个用例通过，并执行完整源码覆盖率门禁。
- [x] 79 个示例全部构建并通过 UI 错误检查。
- [x] 关键 WebGL 场景具有真实截图差异测试。
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
