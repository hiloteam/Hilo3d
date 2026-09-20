# Motion vectors and temporal rendering

Status: current motion/TAA/TAAU and Clustered temporal contract, reviewed on 2026-09-20. The
[original remediation review](./archive/TEMPORAL_RENDERING_REMEDIATION.md) is historical. Remaining
feature and evidence work belongs to [the roadmap](./ROADMAP.md).

## 上线合同

- Motion Vector 是材质语义 pass，不允许 backend 私有旁路或平行 shader 树。
- previous state 只来自最近一次成功 submission；失败帧、不可见帧和 device
  generation 不能推进 camera、model、instance、skin、morph、GPU Scene object 或 visibility history。
- Camera 的 raster jitter 不改变 CPU
  frustum、picking、project/unproject；成功和失败路径都必须在 frame 边界清零 jitter。
- TAA/TAAU
  history 只包含 opaque/masked 线性 HDR 结果。transparent/transmission 在 resolve 后以 output
  resolution 合成，Bloom/display 再消费完整场景。
- `renderScale` 是 0.5–1 的固定配置；`dynamicResolution` 可在同一范围内声明 min/max、初始比例与 GPU
  budget。sub-native 模式同步缩放 scene color、depth、motion、Hi-Z 和 cluster
  viewport，但 color/depth history、resolve 与后续透明组合保持 output resolution。
- 动态控制只消费异步 WebGPU `timestamp-query` Graph
  sample，采用 EWMA、迟滞、量化步进、warmup 与 settling；sample
  unavailable/failed/saturated 时保持当前比例，不使用 CPU frame time 猜测 GPU 压力。
- 内置材质通过 `temporalReactiveFactor`（0–1）写独立 `r8unorm` reactive MRT；resolve 做 3×3
  conservative dilation 后与 luminance heuristic 合并。transparent/particle/UI 不进入 opaque
  history，保持 output-resolution composition policy。
- Clustered GPU Scene 复用已有 depth prepass 输出 motion，不为 GPU-managed
  object 增加第二次几何 replay；ordinary Forward 与 Clustered fallback 继续使用材质 `motion-vector`
  pass。
- `temporalAA` 未启用时不分配或清空 GPU Scene visibility history，不增加默认 Clustered 的 GPU
  buffer 带宽。
- camera cut、显著 projection 变化、resize、显隐间断、显式 transform invalidation、history
  generation 变化和 device recovery 都必须 fail closed 到当前帧。

## Motion 数据 ABI

内置 Basic/PBR/Geometry 和 Clustered storage raster 使用同一 single-sample `rgba16float` 合同：

| 通道 | 含义                                              | 单位与方向                                            | 无效值           |
| ---- | ------------------------------------------------- | ----------------------------------------------------- | ---------------- |
| X/Y  | current-to-previous motion                        | render-target UV，包含 current/previous raster jitter | `0, 0`           |
| Z    | 当前 surface 在 previous view 中的 expected depth | `log2(1 + abs(previousViewZ))`                        | `-1`             |
| W    | 当前 surface 的 depth                             | `log2(1 + abs(currentViewZ))`                         | 仍写当前有效深度 |

Z/W 不保存 device depth。这样同一判定不依赖 standard/reversed
depth、near/far 的非线性分布或 log-depth framebuffer 写法。previous clip `w <= 0`、history
revision 不连续或上一提交未参与 motion pass 时，Z 必须写 `-1`，resolve 不得猜测可用 history。

TAA/TAAU 的 history 位于固定 output pixel grid，所以 resolve 使用
`physicalMotion = motion - (currentJitterUV - previousJitterUV)`，再以
`historyUV = currentUV - physicalMotion` 重投影。SSR、GTAO、SSGI 的原始 motion ABI 不变。Jitter
UV 从 camera 的实际 NDC projection offset 乘 0.5 获得，通过
`hiloRenderTargetUV(delta) - hiloRenderTargetUV(vec2(0))`
做一次 backend-native 向量归一。每个 camera 独立保存 pending/committed
jitter；只有有效 submission 才提交，失败不消费相位。 `TemporalAABlock` 保留前四个 scalar 的 0–15
byte 布局，新增 offset 16 的 `vec4 u_jitterDelta`，总长 32
bytes；camera 绑定独立并复用失活绑定，避免同一 application frame 多 camera 串用数据。

未经几何覆盖的 clear-background 像素（Z=-1、W=0）只允许在 3×3 reconstruction
footprint 借用最近、previous-history 有效的 geometry
motion，并继续经过相同 history-depth 阈值检查。已有 geometry 但 history 无效的像素（W>0）不会借用邻居；远离轮廓的背景也不会接受旧颜色。

Authored reactivity 使用同一 render pass 的 single-sample `r8unorm` location 1：`0` 保留正常history
policy，`1` 完全拒绝 history，中间值线性抑制。ordinary built-in motion shader 从
`MaterialBlock.u_temporalReactiveFactor` 读取；Clustered fused prepass 从 `builtin-pbr-storage-v4`
surface record 的第三个 vec4 W 分量读取。目标先清零，因此不声明第二输出的 custom motion
shader 保持非 reactive；custom shader 可在 `HILO_TEMPORAL_REACTIVE_MASK` 变体中显式写location 1。

## 帧序

启用 Clustered TAA/TAAU 后，一个 camera frame 的关键顺序是：

1. 更新 stable camera/scene transform，并暂存 jitter；
2. GPU frustum/Hi-Z cull、bucket prefix 与 visible compact，同时写 current visibility；
3. GPU Scene depth batch，一次 raster 同时写 depth、motion 与 authored reactive mask；
4. Cluster allocation 与 Clustered PBR opaque；
5. ordinary Forward fallback opaque 写入同一 HDR/depth，随后用材质 motion
   role 补写同一 motion/reactive target；
6. TAA initialize 或 resolve；TAAU 先以 Catmull-Rom 重建当前颜色，并写 output-resolution color/depth
   history、未进入 history 的 sharpened output 与 full-resolution scene depth；
7. native clustered 或 ordinary Forward transparent/transmission 合成，随后用透明 motion、reactive
   coverage 与当前深度 resolve 独立的 color/mask/depth history；
8. GPU particle 在 output
   resolution 独立记录 overlay/reactive/depth，resolve 自己的短 history，再合成回场景；
9. Bloom、display transform、present；
10. 只有 queue 接受 submission 后才轮换 opaque、透明、粒子与 visibility history，并提交 previous
    transforms 和 GPU particle state。

任何 setup、prepare、execute 或提交失败都会走 discard：jitter 被清除，history index、visibility
index 和 previous transform 都保持最后成功状态。

## 画质策略

- history UV 必须留在 half-texel 内；越界直接拒绝。
- depth rejection 在 reprojected UV 周围取保守 2×2 history depth 最小误差，降低边缘 sampling
  mismatch，同时不允许跨越相对深度阈值。
- clamp 在 YCoCg 中使用 3×3 mean/variance 与真实 neighborhood extent 的交集，避免单纯 RGB
  box 对亮度和色度同时过宽。
- 大 physical motion 最多只保留 60%
  history；原 history 亮度偏离当前真实 neighborhood 范围时进一步降低 weight。合法抗锯齿混合色和本帧单点样本的差异不再被误判为 shading 变化。材质 authored
  mask 仍做 3×3 dilation 后与该 heuristic 取最大抑制量，`1` 完全拒绝 history。
- transparent、transmission 与 particle 不写 opaque
  history。它们在 TAAU 后以 output-resolution 独立 history resolve：透明使用 motion/reactive/depth
  agreement 和衰减 resurrection；particle 使用隔离 overlay/mask/depth
  history，避免污染表面 history。UI 保持在全部时域 composition 之后。
- TAAU full-resolution depth 使用对应 internal depth texel；stencil 从零开始。依赖 opaque
  stencil 标记的透明自定义 pass 必须保持原生 `renderScale=1`。

## 性能与内存

TAA/TAAU 是明确 opt-in。以不含 backend row-pitch/alignment 的格式字节估算：

| 资源/工作           | ordinary Forward                                                      | Clustered Forward+                                                                             |
| ------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Motion target       | `8 B/internal pixel` transient；额外 opaque/masked motion replay      | `8 B/internal pixel` transient；GPU object 融入已有 depth prepass，只有 fallback opaque replay |
| Reactive target     | `1 B/internal pixel` transient；与 motion replay 使用同一 render pass | `1 B/internal pixel` transient；与 GPU Scene depth/motion 使用同一 prepass                     |
| Color history       | 双缓冲 output-resolution `rgba16float`，合计 `16 B/pixel` persistent  | 相同                                                                                           |
| Depth history       | 双缓冲 output-resolution `r32float`，合计 `8 B/pixel` persistent      | 相同                                                                                           |
| Resolved target     | output-resolution `8 B/pixel` transient                               | 相同                                                                                           |
| TAAU resolved depth | sub-native 模式额外一张 output-resolution depth transient             | 相同                                                                                           |
| Visibility history  | 无                                                                    | 双缓冲 `uint`，合计 `8 B/object`；只在启用时存在                                               |
| Transparent history | 无                                                                    | 双缓冲 `rgba16float` color + `r8unorm` mask + `r32float` depth；按需存在                       |
| Particle history    | 无                                                                    | 独立双缓冲 color/mask/depth；仅可见 GPU particle 且 TAAU 启用时按需存在                        |

原生 1080p 下，上述 history 加 motion/reactive/resolved 的理论额外峰值约 85 MB；其中约 50
MB 是跨帧 persistent history。TAAU 的 current scene/motion/depth 成本按 `renderScale²`
下降，但 output history、resolved color 与新增 resolved depth 不缩放。原生 resolve 每像素读取 3×3
current neighborhood；TAAU 额外用 16-tap Catmull-Rom 重建当前颜色。两者还读取一个 color
history、一个 motion sample 和最多四个 depth history texel，并输出三张 color
attachment。它适合 high-end profile，不应在内存受限设备上默认开启。动态控制开启后还会激活 Render
Graph timestamp query/resolve/readback 三槽 ring；回读不阻塞生产帧，ring 饱和时保持当前比例。history
packing 或更低质量 tier 必须作为独立设计，不能偷偷改变当前 ABI。

表中约 85 MB 的旧峰值估算只覆盖 opaque
TAAU 基线；启用透明或粒子短 history 时还需按上述格式计入各自 output-resolution
persistent 资源，未启用对应内容时不创建。

## 自动化验收

| 范围           | 自动化入口                                                   | 必须证明                                                                                                                              |
| -------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| ABI/target     | Material、shader、PostProcessing Vitest                      | `rgba16float` motion + optional `r8unorm` reactive MRT 合法，previous/current view depth 与 authored factor 均存在                    |
| 提交事务       | BuiltIn UBO 与 PostProcessing Vitest                         | 成功帧推进；失败、显隐间断、显式 invalidation 不消费旧 history；jitter 恢复为零                                                       |
| Clustered 集成 | Clustered Forward+ real-WebGPU Vitest、PostProcessing Vitest | fused depth/motion/reactive pipeline、全部 compact material bucket、fallback、动态 Hi-Z/SSR/volumetric/atmosphere-cloud extent 均有效 |
| 动态控制       | PostProcessing Vitest、Graph timeline                        | 只消费 ready GPU sample；warmup/迟滞/settling/上下限、重复/失败 sample 与销毁边界均 fail closed                                       |
| 真实画面       | `test/ui/temporal-aa.spec.ts`                                | 静态 history 收敛、camera cut 首帧不闪回、后续稳定、浏览器 GPU validation 为零                                                        |
| 架构/RHI       | `test:render:architecture`、`test:rhi`、`test:webgpu`        | 不绕过 Render Graph/RHI，portable shader 与真实 WebGPU pipeline 可创建                                                                |

用于人工审阅和自动化像素验收的页面是
[`examples/temporal_aa_observatory.html`](../examples/temporal_aa_observatory.html)。它同时覆盖 100 个 GPU
Scene object、ordinary Forward opaque/transmission fallback、动态局部光、Hi-Z、Bloom、camera
cut 和 motion pause；测试模式固定 output 640×360，并以 `renderScale=0.75` 覆盖 TAAU。

## 明确保留到后续版本

- 更广的 authored spatial reactive
  mask 与透明材质/粒子适用面；当前 Clustered 已有 transparent/transmission/GPU-particle 独立 short
  history、coverage/depth rejection 与有界 resurrection，不能再把这组首版能力列为未实现；
- exposure-compensated history 与 content-aware quality controller；
- normal/material ID rejection、velocity dilation 和专用 thin-feature reconstruction；
- memory-constrained quality tier 与 history format packing。

这些是功能路线，不是当前实现的隐藏缺陷；在各自 ABI、质量和性能证据完成前不得以无测试开关并入当前生产路径。

## 静态 jitter 回归

`test/spec/renderer/TemporalJitterStability.test.ts`
使用斜向不规则不透明白条与 clear 黑背景，保持 TAA、相同 history weight、variance clipping 和 jitter
sequence 全部启用。控制组只恢复旧的 jitter 重投影、单点亮度 reactive 与无轮廓 motion
reconstruction 三处表达式；候选必须让八相位收敛后的邻帧像素差降至控制组的 20% 以下，并保持 submission
phase 连续。该测试同时覆盖 WebGL 2、WebGPU、反向 Z 与 TAAU，并验证 std140
offset/size。它是画质回归，不是 GPU 性能证据。
