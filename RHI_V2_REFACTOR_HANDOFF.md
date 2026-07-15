# RHI v2 重构 handoff

最后更新：2026-07-15（Asia/Shanghai）

## 0. 本会话结束时的权威接续状态

本节是最新 handoff；与后续第 1–9 节的旧记录冲突时，以本节和当前工作树为准。旧记录仅保留为历史上下文。

### 0.1 当前结论

引擎功能代码已经完成本轮收口，且双后端功能矩阵已通过。当前唯一正在处理的本机阻塞已从最初的 PBR/WebGL2
hot allocation 转为更重的 MRT/WebGL2 profiler quiescence 稳定化：

- PBR/WebGL2 的 RHI-v2 measured hot 21-sample 向量已严格全部为 0，paired smoke 通过；
- MRT/WebGL2 在 candidate 第 2 个 retained window 的 21-frame **quiescence probe**
  失败，尚未进入最终 measured 21-sample 判定；
- 失败只有两个孤立小样本，分别落在无显式分配的 `setViewportRecord` 和 `setBindGroup`
  成功路径，当前更像 profiler restart 后的晚期 V8 tier metadata，而不是已证实的 JS 对象分配；
- 不得因此放宽 hot=0、修改 classifier、缩短样本或把 quiescence 样本混入 measured 结果；
- `manifest.json` 的 `rig.acceptedFingerprintSha256` 仍为空数组；本机结果全部是
  `NON-EVIDENCE`，不能作为正式 baseline；
- 正式 Linux 物理 GPU paired A/B 通过前仍不得删除 legacy。

### 0.2 工作树与进程

- 工作目录：`/Users/06wj/Documents/github/Hilo3d`
- 分支：`chore/ts`
- `git status --short`：161 个 modified/deleted/untracked 条目
- 未 stage、未 commit
- `git diff --check`：通过
- smoke、Playwright、Vite、Vitest 进程均已退出
- 本会话的 sub-agent 均已停止；不会继续后台改文件
- 不要 reset、checkout 或删除任何现有未提交/未跟踪文件；当前工作树仍是唯一权威状态

### 0.3 本会话完成的引擎实现

#### Texture ABI

- `TextureResourceCache`
  补齐 3D、2D-array、R/RG、integer、snorm、float、packed、depth/depth-stencil 映射与 layered
  upload/recovery。
- 修复显式单层 `2d-array` 在 WebGL2 resource 层被错误降级为 `TEXTURE_2D`。
- public `Texture` 对非 null raw `DEPTH_COMPONENT24`、`DEPTH24_STENCIL8`、`DEPTH32F_STENCIL8`
  统一 fail closed；仅 `DEPTH_COMPONENT16`、`DEPTH_COMPONENT32F` 支持 portable raw depth
  upload/sub-update。null empty storage 仍支持。
- Texture/cache 定向 88/88；更大纹理相关矩阵也已通过。

#### Matrix / multi-location vertex ABI

- `GeometryComponentSize` 扩为 `1 | 2 | 3 | 4 | 9 | 16`，root export 与 API report 已同步。
- `VertexInputLayoutCompiler` 支持 `mat2/mat3/mat4`
  及方阵别名，按列展开连续 locations，正确计算 format/stride/offset/interleaved alias/generic
  defaults。
- `InstanceBatchCompiler` 支持 per-vertex matrix 与 instanced matrix location span/limit 校验。
- shader reflection 对 matrix 展开物理 locations，只有首列保留 name，避免 WebGL `bindAttribLocation`
  对非首列使用无效名称。
- legacy WebGL Program/VAO mat3/mat4 真实列指针已覆盖。
- matrix 定向累计 200/200；legacy/API 收尾 31/31。
- `ShaderArtifactRHIIntegration` 曾失败是 direct-RHI 测试漏调
  `PreparedDraw.prepareVertexInput()`，不是运行时回归；测试现验证 VAO 只在 prepare 阶段创建、execute 阶段不创建。

#### Sampler / texture arrays

- `RHIShaderBindingReflection`、validation、`ShaderArtifactCompiler`、`ShaderBindingLayoutCompiler`、`MeshDrawProcessor`
  全程保留并校验 `arrayIndex`；输入缺省归一化为 0，生成 reflection/plan 显式为 0。
- texture/sampler 两条 reflection 按 `(name, arrayIndex)` 严格配对。
- Material resolver 按逻辑名称复用返回值，再选择数组元素；循环内没有新增 Map/slice/复合 key 分配。
- numeric-depth mask 继续按物理 sampler element 位编号；例如 mask=2 只特化 `maps[1]`。
- `sampler2DShadow[]` 每个元素生成 comparison binding。
- WebGL2 真实 `uniform sampler2D maps[2]` 验证两个 location、texture unit `[0, 1]`
  与 steady-state 不重复激活。
- 双 Fake backend 覆盖 array depth element、shadow comparison array、steady reuse 和单元素重绑。
- 6 files / 160 tests 全绿。

#### WebGPU upload pages

- 移除全局 capacity high-water 向新 page 传播；spill page 按当前请求从 64 KiB 起 right-size。
- remapped ready page 使用 best-fit 最小容量，避免一次大上传后并发小上传持续放大内存。
- 没有增加 `queue.writeBuffer` fallback、任意 hard cap 或破坏 abort/frame atomicity。
- WebGPU backend 定向 30/30；后续 RHI v2 全套为 181/181。

#### 其他收口

- `test/ui/examples.spec.ts` 的 presentation
  wait 改为 deadline 只限制“是否再启动一次 probe”；已启动的 compositor
  read 可以完成并通过，外层 Playwright timeout 仍限制 hang。`refract.html` 后续双端均一次通过。
- ShadowAtlas 集成测试改读真实 `drawArguments.instanceCount`，并验证 backend 实际 shadow
  draw 数；没有运行时改动。
- `scripts/performance/rhi-owned-chromium.ts` 的 helper 改为静态 ESM import，移除 CommonJS
  `require`。
- `PipelineResourceCache`、`WebGPUV2Queue` 移除 lint suppression，改为无 iterator 的 while index
  loop。
- 曾短暂尝试 classic numeric uniform compatibility，但已完整撤回。当前权威设计要求 ShaderMaterial
  numeric 数据迁入注册 std140 block，并禁止重新引入 block 外 numeric uniform
  fallback。源码全局无该临时实现残留。

### 0.4 当前真实验证结果

在上述最终引擎合并态实际通过：

```text
npm run typecheck
  PASS

npm run format:check
  PASS

npm run check:modernity
  PASS

git diff --check
  PASS

npm run test:rhi-benchmark-contract
  8 files / 85 tests PASS

npm run test:rhi-v2
  12 files / 181 tests PASS

npm run test:render:architecture
  6 files / 48 tests PASS

sampler-array targeted matrix
  6 files / 160 tests PASS

ShadowAtlas + MeshDrawProcessor + PreparedDraw targeted matrix
  7 files / 101 tests PASS

npm run test:ui:webgl2
  contract 9/9; Playwright 92/92 PASS

npm run test:ui:webgpu
  contract 9/9; Playwright 91/91 PASS

npm run test:webgpu:native
  1/1 PASS
```

shared pipeline 30-file
matrix 最初为 426/428，唯一两项失败都是同一个 ShadowAtlas 测试读取已删除的旧私有字段；修正后该文件 4/4、相关 7
files / 101 和 architecture 48/48 均复跑通过。没有用断言掩盖运行时错误。

### 0.5 已通过的 PBR/WebGL2 allocation smoke

执行：

```sh
npm run test:rhi-benchmark-smoke -- \
  --scenario=pbr-lights-shadows \
  --backend=webgl2
```

结果：PASS。关键原始输出：

```text
RHI-v2 hot=[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]

RHI-v2 renderer=
[1630176,1563060,1546208,1545292,1545292,1546208,1545292,
 1640192,1563876,1545292,1545292,1548040,1545272,1546200,
 1622412,1552000,1534568,1535484,1534568,1534568,1535484]

legacy renderer=
[2751352,2751316,2751428,2751324,2751484,2751372,2771812,
 2857832,2783744,2773920,2773976,2773872,2773976,2773920,
 2847688,2773592,2763644,2762748,2763664,2763644,2763692]

rendererMedian=1545292
legacyRendererMedian=2763692

pixels=
134267b3fece65e60718cb2ec52939d97933c2f76fd3c7281bc761515d3f7c93/
134267b3fece65e60718cb2ec52939d97933c2f76fd3c7281bc761515d3f7c93
```

candidate 三个 quiescence window 也通过 terminal-five-zero 规则；中间有少量非 terminal tier
metadata，但不进入 measured hot vector：

```text
window 1: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]
window 2: [0,540,0,48,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]
window 3: [0,0,0,204,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]
```

此结果只证明本机 smoke 协议通过；没有写 evidence artifact，不是正式性能声明。

### 0.6 当前唯一已知失败：MRT/WebGL2 quiescence

执行：

```sh
npm run test:rhi-benchmark-smoke -- \
  --scenario=mrt-msaa-postprocess \
  --backend=webgl2
```

legacy 三个 window 全部完成；candidate window 1 完成，window 2 在 measured frames 之前的 quiescence
proof 失败：

```text
observed [0,0,0,0,0,0,0,0,0,784,0,0,0,0,0,0,0,708,0,0,0]
```

失败原因是最后只有 3 个连续零，而固定规则要求最后 5 个连续零。诊断栈：

```text
q10: 784 B
renderAllocationRendererBoundary
  -> renderRendererFrame
  -> SharedRendererDriver.renderFrame/executeApplicationFrame
  -> RenderFrame/RenderGraph/RenderGraphExecutor
  -> SharedDrawPass.execute
  -> WebGL2Commands.setViewportRecord

q18: 708 B
renderAllocationRendererBoundary
  -> renderRendererFrame
  -> SharedRendererDriver.renderFrame/executeApplicationFrame
  -> RenderFrame/RenderGraph/RenderGraphExecutor
  -> SharedDrawPass.execute
  -> PreparedDraw.execute
  -> WebGL2Commands.setBindGroup
```

静态检查到的事实：

- `setViewportRecord` 成功路径只有数值校验、稳定 viewport 状态写和 native state call；
- `setBindGroup` 成功路径只有品牌/范围校验、稳定 slot/typed-array 更新和诊断整数递增；
- 两条成功路径都没有显式对象、数组、字符串、iterator 或 closure 分配；
- 两个孤立值约 700–800 B，且出现在 profiler restart 后的较晚 quiescence frame，形态与 V8 tier/code
  metadata 更一致；
- 但尚未用统一协议修复并复跑，因此不能把“V8 tier-up”写成最终已证实根因。

### 0.7 下一会话应从这里继续

1. 完成 MRT quiescence 的协议级诊断，不要先改 hot-path classifier 或业务方法。
2. 审查 protocol v10 的真实顺序：
    - allocation phase 前 30 ordinary post-suspend frames；
    - Stage A：sampling 下固定 288 production frames，GC 后 stop，profile 丢弃；
    - Stage B：3 个 bounded retained windows；每个 window 新启 sampler，当前只跑 1 个 unmarked
      production frame + 32 个 Runtime no-op tasks，再跑 21-frame marked quiescence 和 7 measured
      frames；
    - quiescence 必须以 5 个连续 zero-hot 结束；measured 总数仍是 21，candidate
      hot 取 max 且必须为 0。
3. 重点验证“每个 retained profiler restart 后只有 1 个真实 render warm
   frame”是否不足以覆盖 MRT 的 profiler-induced re-tier。任何修复必须：
    - 对 formal collector 与 smoke 使用同一固定协议；
    - 对全部场景统一，不能 MRT 特判；
    - 保持 21 measured samples、hot classifier、max=0、terminal quiescence fail-closed 不变；
    - 保持 retained profile/pipe payload 有界；不要简单塞入大量 retained full
      frames而不审计 payload；
    - bump fixture protocol version，并同步 fixture-contract、collector/smoke contract
      tests、README 与 fixture checksum/manifest contract（若 checksum 由协议影响）；
    - 更新 `benchmarks/rhi-v2/README.md`：其现有文字仍描述旧的 draw-target/单 retained
      session 细节，而当前 v10 实际是 3 个 bounded retained windows。
4. 修复后先跑：

```sh
npm run test:rhi-benchmark-contract
npm run test:rhi-benchmark-smoke -- --scenario=pbr-lights-shadows --backend=webgl2
npm run test:rhi-benchmark-smoke -- --scenario=mrt-msaa-postprocess --backend=webgl2
```

5. PBR 与 MRT 都稳定通过后，继续顺序跑，避免浏览器并发污染：

```sh
npm run test:rhi-benchmark-smoke -- --scenario=dynamic-geometry-texture-upload --backend=webgl2
npm run test:rhi-benchmark-smoke -- --scenario=scene-churn-10000-frame --backend=webgl2
npm run test:rhi-benchmark-smoke -- --scenario=pbr-lights-shadows --backend=webgpu
npm run test:rhi-benchmark-smoke
```

6. smoke 全绿后在安全镜像执行最终 `validate` /
   `validate:ci`。不要在当前工作树直接运行，因为二者先执行 `clean`，会删除
   `coverage/dist/dist-examples/docs/playwright-report/reports/site/test-results`
   等未跟踪目录。安全镜像必须以当前 dirty tree 覆盖为权威内容。

### 0.8 CI 与正式外部门禁

- `package.json` 的 `validate:ci` 已包含 `test:rhi-benchmark-smoke`。
- `.github/workflows/npm_test.yml` timeout 已为 360 分钟。
- `validate` 当前不包含 smoke；最终仍应分别执行 smoke 与 validate。
- `benchmarks/rhi-v2/manifest.json`：`acceptedFingerprintSha256: []`，保持为空。
- 正式 Phase 0/7 仍需受审固定 Linux 物理 GPU runner 上的 10 scenarios × 2 backends × legacy/RHI-v2 ×
  7 rounds × 2,000 frames paired A/B。
- 在该证据通过前：不要冻结本机 baseline、不要填写 fingerprint、不要把本机 native WebGPU
  1/1 或 SwiftShader UI/smoke 当正式 GPU 证据、不要删除 legacy。

---

以下第 1–9 节是上一轮 handoff 的历史记录；其中“当前失败”“下一步”和测试计数已经被本节取代。

## 1. 当前目标与仓库状态

目标仍是完成 `RHI_V2_REFACTOR_PLAN.md` 的全部内容。

- 工作目录：`/Users/06wj/Documents/github/Hilo3d`
- 当前分支：`chore/ts`
- 工作树非常脏：当前约 157 个 modified/deleted/untracked 条目。
- 这些改动包含用户原有工作和本轮 RHI v2 实现；不要
  `git reset --hard`、不要 checkout 覆盖、不要删除未跟踪文件。
- `RHI_V2_REFACTOR_PLAN.md`、多数 `src/render/rhi/v2`
  相关实现和测试目前仍是未跟踪文件，这是当前工作树的既有状态，不代表可以清理。
- 未创建 commit，也未 stage。
- 当前没有遗留的 smoke/Vite 进程；最后一轮 smoke 因 handoff 请求用 Ctrl-C 正常终止，退出码 130。

## 2. 总体结论

实现主体已经推进到 Phase 7：公开 `Renderer` 默认走 `SharedRendererDriver` 和 RHI
v2，legacy 只用于 benchmark、回滚和旧路径专项测试。Phase 1–6 的代码主体已经完成，Phase
7 的默认路径切换也已完成。

仍不能宣称整个计划完成，原因不是缺少一段可以在本机随意补写的代码，而是以下正式退出条件尚未满足：

1. 本机 CDP 稳态分配门禁仍在收尾，当前 WebGL2 PBR case 尚未达到 hot-path 最大值严格为 0。
2. `npm run validate` 尚未在最终快照上完整复跑。
3. Phase 0/7 所要求的固定 Linux 物理 GPU paired A/B 证据不存在。
4. 因正式性能/像素/内存证据不存在，Phase 8 不能删除 legacy。

`benchmarks/rhi-v2/manifest.json` 中的 `rig.acceptedFingerprintSha256`
仍是空数组，仓库也没有已冻结的正式 baseline。这里必须 fail
closed，绝不能填假 fingerprint、生成合成性能数据或把开发机 smoke 当正式证据。

## 3. 已完成的主要实现

### 3.1 RHI v2、双后端与 shared renderer

- RHI v2 core、validation、factory、device/surface 解耦、generation/submission lifetime 已实现。
- WebGL2 使用 concrete immediate command context，没有软件 command replay。
- WebGPU 使用 concrete native encoder/queue 映射，没有 Proxy 或二次 command list。
- `Renderer -> constructRenderer() -> SharedRendererDriver` 是生产默认路径。
- legacy `WebGL2Driver`、`WebGPUDriver`、`constructLegacyRHI`
  没有从公开生产入口引用，只由 benchmark/legacy tests/旧实现自身引用。
- main、shadow、render target、postprocess、present 已迁入 shared passes。
- explicit frame context、FrameArena、upload batch、RenderGraph、PreparedDraw、resource
  registry、recovery coordinator 已接入。

### 3.2 Render Graph sampled RenderTarget 依赖

已新增公共 RenderTarget texture 的显式 sampled graph dependency：

- 本 graph 没有 writer 时读取跨帧 persistent 内容。
- 有一个或多个 writer 时，pure consumer 依赖最后 writer，同时保留完整 writer chain。
- 即使 consumer 先插入，也会被 compiler 正确重排。
- 同 pass feedback 仍被拒绝。
- 普通 imported texture 的原有插入顺序语义不变。

主要文件：

- `src/render/graph/RenderGraphResource.ts`
- `src/render/graph/RenderGraphBuilder.ts`
- `src/render/graph/RenderGraphCompiler.ts`
- `src/render/internal/SharedRendererDriver.ts`
- `src/render/renderer/RenderTargetGraphBridge.ts`
- `src/render/renderer/RenderTargetTextureBindingProvider.ts`
- `src/render/renderer/MeshDrawProcessor.ts`

相关 agent 曾跑 105 + 20 + 12 + 51 个定向测试，全部通过。

### 3.3 graph-transient MSAA lifetime

已实现真实 graph-transient MSAA backing，避免 persistent source/depth 与 graph
transient 各保留一份：

- RenderTarget resource record 使用 `persistent | graph-transient` 显式 lifetime policy。
- graph-transient source 使用判别联合类型并明确为 `null`，不伪造 handle。
- 只有所有相关 attachment 都满足首 pass clear、末 pass discard 时才使用 transient MSAA。
- 任一 load/store 需要跨 graph 保留内容时原子切回 persistent。
- opaque/transparent 在同一 graph 共用同一 transient source。
- replacement、resize、recovery、partial allocation failure 保持事务语义。

相关 agent 的最终结果：9 files / 121 tests，通过 typecheck、ESLint、modernity。

### 3.4 VAO 移出 draw 热路径

已完成：

- `RHIGraphicsPipeline.prepareVertexInput()` 后端中立契约。
- `PreparedDraw` 持有构造期分配、原地更新的稳定 vertex/index binding packet。
- `SharedDrawPass.prepareForExecute()` 在 graph preparation 阶段确保 VAO。
- WebGL draw execute 只 lookup/bind；miss 或已淘汰记录明确抛错，不在 draw 内补建。
- prepare lookup 不污染真实 cache hit/miss/frame diagnostics。
- 第一次真实 draw 计 miss，后续计 hit。
- 维持 256 条有界 LRU，destroyed-buffer record 可原地重配。
- WebGPU/Fake backend 是无分配 no-op。
- 无 vertex layout 的直接 RHI draw 在 pipeline 创建期预建空 VAO。

最终定向结果：

- PreparedDraw / SharedDrawPass / Architecture：23/23
- WebGL VAO 行为：4/4
- Phase 2 双后端 conformance：2/2
- 相关 ESLint：通过

### 3.5 copy/upload 成功路径临时对象清理

已完成：

- `writeBuffer` 验证不再动态拼接 path。
- `writeTexture` 核心验证标量化，不再创建 normalized extent/origin/validated object。
- WebGL 普通 texture upload 不再创建临时 normalized object/byte view；特殊范围使用 queue cache。
- WebGPU 普通 texture upload 使用 queue-owned、身份稳定的 WebIDL descriptor。
- external-image 的验证、尺寸、pixel-store 保存恢复、origin/extent、native descriptor 已标量化。
- WebGL external upload 移除每次调用的数组、解构循环和 `.bind()`。
- WebGPU video completion callback 改为状态持有，不再逐上传创建 closure。
- Structured WebGPU mock 模拟 WebIDL 同步快照。

相关定向 RHI 测试曾完整达到 4 files / 70 tests 全绿；最终全套 RHI v2 也已复跑通过，见下节。

### 3.6 其他热路径与测量修正

- `PreparedDraw.execute()` 使用稳定 viewport state，避免每 draw 重复 setViewport 和相关临时行为。
- WebGL bind-group/VAO/attribute 扫描改为 indexed loops。
- stencil front/back state 在 pipeline 构造时归一化，不在 applyState 中重复处理。
- `WebGL2Commands.setPipeline()` 对同 pipeline 提前返回。
- stale VAO record 可复用原生 VAO 和 backing arrays。
- TimingProbe 在整个 allocation phase 一次 suspend/resume，不再每个 sample 改写 prototype。
- allocation classifier 使用专用 `renderAllocationRendererBoundary()`，排除 application-side scene
  mutation/churn，但保留 renderer/frame/RHI lifecycle。
- smoke 固定为 30 帧普通 warmup、5 个丢弃 profile、21 个 measured
  profile；hot 使用最大值，renderer 使用中位数。
- fixture protocol 已升到 v3。

### 3.7 benchmark workload 与证据链基础设施

- manifest 固定 10 个计划场景、两个 backend、300 warmup、2,000 samples、7 轮、seeded
  ordering/bootstrap。
- MRT case 是 4 MRT + 4x MSAA resolve + 3 postprocess + 256 draws。
- PBR/shadow、dynamic upload、first complex frame、10,000 frame churn 已有生产 fixture。
- preflight、environment audit、collector、schema、summarizer、freeze、verify、report、candidate
  evaluator 均已实现并 fail closed。
- paired significance 与 frozen-baseline hard cap 分开计算。
- 像素 hash、draw count、环境/commit/fixture checksum、canonical baseline path、symlink/mutation
  guards 均有契约测试。

## 4. 当前已通过的验证

在 VAO/copy 最终合并后的稳定工作树上已实际执行：

```text
npm run typecheck
  PASS

npm run test:rhi-v2
  12 files / 149 tests PASS

npm run test:render:architecture
  6 files / 46 tests PASS

npm run check:modernity
  PASS

npm run test:rhi-benchmark-contract
  7 files / 62 tests PASS
```

`test/performance/RHICandidateGate.test.ts` 中完整 evidence-chain
case 在本机约 5.1 秒，曾撞到 Vitest 默认 5 秒超时。已为这个单独的重型用例设置显式 15 秒上限；单文件 11/11 和完整 performance
contract 62/62 均已复跑通过。没有放宽任何 benchmark 判定。

更早的同一工作树阶段还跑过：

- WebGL2 UI matrix：92/92
- WebGPU UI matrix：91/91
- native WebGPU gate：通过
- Render Graph / transient / renderer 多组定向测试：通过

这些 UI 结果早于最后的 VAO/copy 改动，最终交付前仍应复跑，不要把它们当最终快照证据。

## 5. 当前唯一已知本机失败：CDP hot allocation smoke

已执行：

```sh
npm run test:rhi-benchmark-smoke -- \
  --scenario=pbr-lights-shadows \
  --backend=webgl2
```

第一次稳定完整运行失败：

```text
RHI-v2 hot draw/context allocated 16312 bytes

15044 WebGL2Commands.ts :: recordDraw
  140 WebGL2Commands.ts :: applyPipelineDrawBuffers
  112 WebGL2Commands.ts :: setPipeline
   96 WebGL2Commands.ts :: drawIndexed
   96 WebGL2State.ts    :: setViewport
   80 PreparedDraw.ts   :: execute
   80 WebGL2Commands.ts :: setIndexBuffer
   80 WebGL2Commands.ts :: prepareDraw
   72 WebGL2State.ts    :: setScissor
   64 SharedDrawPass.ts :: execute
   64 WebGL2Commands.ts :: setBindGroup
   48 WebGL2Commands.ts :: setVertexBuffer
```

`recordDraw()` 当前只有两个整数
`++`，显式源码中没有对象创建。多个仅含状态更新的方法同时出现几十字节，也可能表示 V8
tier-up/deopt 或 WebGL native binding 的采样归因，而不一定是一个直观的 `new`/array
literal。不能据此删掉 profiler 分类或放宽 0 门禁；必须用样本分布证伪。

为了下一轮诊断，`scripts/performance/smoke-rhi-production-fixture.ts`
已增加失败消息中的 21 个 measured hot-byte 样本向量。这个诊断补丁：

- 不改变采样次数；
- 不改变 hot classifier；
- 不改变最大值为 0 的门禁；
- 不写 evidence artifact。

第二轮 smoke 本来用于拿到该向量，但因本 handoff 请求被中断，因此尚无第二轮结果。该脚本刚修改后还需要 Prettier 和 performance
contract 复验。

## 6. 下一会话的推荐执行顺序

### 6.1 先稳定并复现 allocation failure

```sh
npx prettier --write scripts/performance/smoke-rhi-production-fixture.ts
npm run test:rhi-benchmark-contract
npm run test:rhi-benchmark-smoke -- \
  --scenario=pbr-lights-shadows \
  --backend=webgl2
```

观察新增的 21 项 hot-byte vector：

- 如果大多数为 0、只有一个晚期大值，优先验证 timing prototype 恢复后的 V8
  re-tiering。`beginAllocationSampling()`
  会一次性恢复原 prototype，但当前在恢复后没有额外的未采样 warmup，只直接跑 5 个 profiler-on
  discard。
- 可在不放宽门禁的前提下，给 allocation phase 增加固定的 post-suspend ordinary
  warmup；正式 collector 与 smoke 必须保持同一协议，并更新 contract/README。不要只改 smoke。
- 如果 21 个 sample 都稳定出现相似 `recordDraw` 分配，则继续检查 WebGL native
  draw/getError、try/catch、诊断 counter access 和手工 inline `recordDraw` 的对照实验。
- 每次生产改动后先跑 WebGL 定向测试和 `test:rhi-v2`，再跑完整 smoke；避免在 Vite
  smoke 运行期间修改源码，否则 HMR 会污染测量。

### 6.2 hot=0 后检查 renderer 总量

门禁还要求 candidate renderer allocation median 不高于 paired
legacy。若该项失败，失败消息会分别输出 candidate/legacy renderer top
frames。不要提前大改 RenderFrame/RenderGraph shell；先依据真实 median profile 定位。

### 6.3 扩展 smoke matrix

PBR WebGL2 通过后依次跑：

```sh
npm run test:rhi-benchmark-smoke -- --scenario=mrt-msaa-postprocess --backend=webgl2
npm run test:rhi-benchmark-smoke -- --scenario=dynamic-geometry-texture-upload --backend=webgl2
npm run test:rhi-benchmark-smoke -- --scenario=scene-churn-10000-frame --backend=webgl2
npm run test:rhi-benchmark-smoke -- --scenario=pbr-lights-shadows --backend=webgpu
npm run test:rhi-benchmark-smoke
```

copy/external-image 成功路径已有源码和 mock 测试，但默认 representative smoke 的 dynamic
texture 是 typed data。应补一个真实 external Canvas/ImageBitmap allocation
case，或者扩展固定 workload 使 external path 被真实 CDP 覆盖；legacy/v2 必须画质和输入一致。

### 6.4 smoke 全绿后接入 PR CI

当前 `package.json` 的 `validate:ci` 尚未调用 `test:rhi-benchmark-smoke`。计划 11.4 要求 PR
CI 有功能、结构、计数和分配门禁。只有 smoke 稳定全绿后再把它加入 `validate:ci`（并评估是否也加入本地
`validate`），不要先接入一个已知失败的门禁。

### 6.5 最终全量验证

至少执行：

```sh
npm run typecheck
npm run check:modernity
npm run test:render:architecture
npm run test:rhi-v2
npm run test:rhi-benchmark-contract
npm run test:rhi-benchmark-smoke
npm run validate
```

`validate`
包含 format、lint、coverage、build、types、browser/UI、examples、docs、API、package 和 pack。工作树很大，若失败要区分用户已有变更与本轮回归，不得重置规避。

最终还应显式复跑：

```sh
npm run test:ui:webgl2
npm run test:ui:webgpu
npm run test:webgpu:native
```

### 6.6 更新计划状态

在真实验证后再更新 `RHI_V2_REFACTOR_PLAN.md` 的验收框：

可根据实现/架构测试诚实勾选的结构项包括：

- Renderer/Graph 无 native 类型。
- RHI 是生产硬件边界。
- WebGL immediate，无软件 replay。
- 双 backend contract、device/surface 解耦。
- shader compile/variant 位于 RHI 上层。
- WebGPU concrete native mapping。
- explicit frame semantic context。
- Render Graph imported/transient/dependency/culling/validation/execution。
- shared main/shadow/target/postprocess/present。
- in-flight/generation-aware lifecycle。

在最终 smoke/validate 和正式物理机证据前不要勾选：

- 稳态零分配。
- legacy/v2 正式像素 parity。
- WebGL2/WebGPU 性能门禁。
- 真实 retained heap/churn 门禁。
- `npm run validate`。

## 7. 外部 Linux 物理 GPU 阻塞与 Phase 8

以下工作只能在受审的固定 Linux 物理 GPU runner 上完成：

1. 审核并登记 machine/browser/GPU/driver/power-profile fingerprint。
2. 在干净 commit 上采集全部 10 场景 × WebGL2/WebGPU × legacy/v2 × 7 轮 × 2,000 帧。
3. 提交真实 raw capture、frozen legacy summary、variance report。
4. 再采集当前 candidate，生成 JSON/Markdown paired gate report。
5. 证明 CPU/GPU、allocation、retained heap、pixel hash、draw count 全部门禁。

当前可用的入口：

```sh
npm run benchmark:rhi:audit-environment
npm run benchmark:rhi:preflight
npm run benchmark:rhi:collect
npm run benchmark:rhi:summarize
npm run benchmark:rhi:freeze
npm run benchmark:rhi:report
npm run benchmark:rhi:gate
```

本机预期 preflight 会因为缺少 `HILO3D_RHI_BENCHMARK_ENVIRONMENT`、空 fingerprint
allowlist、非受审 Linux GPU 环境而 fail closed。这是正确行为。

只有正式 Phase 0/7 报告通过后，才执行 Phase 8：删除 legacy driver/manager/semantic
fallback/冲突测试，更新 API report 与工程文档，然后再次
`npm run validate`。现在不要删除 legacy，否则会失去 paired A/B 的同 commit 对照路径。

## 8. 本轮新增/重点修改文件索引

核心实现：

- `src/render/internal/SharedRendererDriver.ts`
- `src/render/frame/`
- `src/render/graph/`
- `src/render/renderer/`
- `src/render/rhi/core/`
- `src/render/rhi/backends/webgl2/`
- `src/render/rhi/backends/webgpu/`
- `src/render/rhi/legacy/`

本轮最后热路径相关：

- `src/render/renderer/PreparedDraw.ts`
- `src/render/renderer/passes/SharedDrawPass.ts`
- `src/render/rhi/core/RHIPipeline.ts`
- `src/render/rhi/core/RHICopyValidation.ts`
- `src/render/rhi/backends/webgl2/WebGL2Commands.ts`
- `src/render/rhi/backends/webgl2/WebGL2Pipeline.ts`
- `src/render/rhi/backends/webgpu/WebGPUV2Commands.ts`
- `src/render/rhi/backends/webgpu/WebGPUV2Queue.ts`
- `src/render/rhi/backends/webgpu/WebGPUV2ExternalImages.ts`

benchmark/measurement：

- `benchmarks/rhi-v2/manifest.json`
- `benchmarks/rhi-v2/fixture-contract.ts`
- `benchmarks/rhi-v2/README.md`
- `test/performance/fixtures/rhi-v2-production.ts`
- `scripts/performance/rhi-playwright-collector.ts`
- `scripts/performance/smoke-rhi-production-fixture.ts`
- `test/performance/RHIProductionCollector.test.ts`
- `test/performance/RHIProductionWorkload.test.ts`
- `test/performance/RHICandidateGate.test.ts`

文档：

- `RHI_V2_REFACTOR_PLAN.md`
- `ENGINEERING_MODERNIZATION.md`
- 本文件。

## 9. 交接时的最后状态

- 所有并行 agent 已停止；不会再有后台文件写入。
- typecheck、RHI v2、architecture、modernity、benchmark contract 当前记录为全绿。
- 第一轮 PBR/WebGL2 CDP smoke 真实失败为 hot max 16,312 bytes。
- 第二轮带 21-sample vector 的 smoke 被手动中断，尚待下一会话复跑。
- `scripts/performance/smoke-rhi-production-fixture.ts` 的最新诊断补丁尚待 Prettier/contract 验证。
- `validate:ci` 尚未接入 smoke。
- 正式 Linux GPU baseline/candidate evidence 仍为空，Phase 8 保持阻塞。
