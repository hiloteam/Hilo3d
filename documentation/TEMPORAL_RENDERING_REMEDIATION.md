# Motion Vector 与 TemporalAA 上线整改规范

本文记录 2026-08 在最新 `origin/dev` 基线上对 Motion Vector、TemporalAA、Clustered
Forward+ 时域集成、Hi-Z 显隐连续性和兼容 Forward
fallback 的专项审查。目标不是增加一个仅在 demo 中可用的滤镜，而是形成可回滚、可恢复、可验证且默认无性能回归的生产合同。

## 上线合同

- Motion Vector 是材质语义 pass，不允许 backend 私有旁路或平行 shader 树。
- previous state 只来自最近一次成功 submission；失败帧、不可见帧和 device
  generation 不能推进 camera、model、instance、skin、morph、GPU Scene object 或 visibility history。
- Camera 的 raster jitter 不改变 CPU
  frustum、picking、project/unproject；成功和失败路径都必须在 frame 边界清零 jitter。
- TAA
  history 只包含 opaque/masked 线性 HDR 结果。transparent/transmission 在 resolve 后合成，Bloom/display 再消费完整场景。
- Clustered GPU Scene 复用已有 depth prepass 输出 motion，不为 GPU-managed
  object 增加第二次几何 replay；ordinary Forward 与 Clustered fallback 继续使用材质 `motion-vector`
  pass。
- `temporalAA` 未启用时不分配或清空 GPU Scene visibility history，不增加默认 Clustered 的 GPU
  buffer 带宽。
- camera cut、显著 projection 变化、resize、显隐间断、显式 transform invalidation、history
  generation 变化和 device recovery 都必须 fail closed 到当前帧。

## Motion 数据 ABI

内置 Basic/PBR/Geometry 和 Clustered storage raster 使用同一 single-sample `rgba16float` 合同：

| 通道 | 含义                                              | 单位与方向                                                      | 无效值           |
| ---- | ------------------------------------------------- | --------------------------------------------------------------- | ---------------- |
| X/Y  | current-to-previous motion                        | render-target UV；resolve 使用 `historyUV = currentUV - motion` | `0, 0`           |
| Z    | 当前 surface 在 previous view 中的 expected depth | `log2(1 + abs(previousViewZ))`                                  | `-1`             |
| W    | 当前 surface 的 depth                             | `log2(1 + abs(currentViewZ))`                                   | 仍写当前有效深度 |

Z/W 不保存 device depth。这样同一判定不依赖 standard/reversed
depth、near/far 的非线性分布或 log-depth framebuffer 写法。previous clip `w <= 0`、history
revision 不连续或上一提交未参与 motion pass 时，Z 必须写 `-1`，resolve 不得猜测可用 history。

## 审查问题与整改

| 编号  | 审查发现                                                                                  | 生产风险                                                            | 整改结果                                                                                                          |
| ----- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| TR-01 | velocity 只有 `rg16float`，resolve 用当前 raw device depth 对比上一帧同 UV depth          | 运动 surface 比较的是错误位置；reversed/log depth 下阈值无物理意义  | ABI 扩为 `rgba16float`，携带 previous/current log-view-depth，并用 relative linear-depth error 判定               |
| TR-02 | mesh transform history 只看 revision，不知道上一帧是否真正输出过 motion                   | 物体离屏、隐藏或被裁剪后重现会读取陈旧 pose，形成长拖影             | direct/instanced motion draw 显式登记 participation；只接受最近成功 submission 的参与记录                         |
| TR-03 | camera/model history 没有成功提交序号                                                     | 中间失败或相机跳帧后仍可能把非连续帧当成上一帧                      | Camera 与所有 motion domain 加入 submission continuity；rollback 不推进序号                                       |
| TR-04 | RGB min/max clamp 与固定 history weight 对高反差运动过于宽松                              | emissive 边缘、薄几何和遮挡变化持续 ghost                           | 使用 YCoCg 3×3 variance clipping、motion response 与 luminance reactive response                                  |
| TR-05 | sharpened 输出直接反馈 history                                                            | 逐帧过锐和 ringing 累积                                             | history 保存未 sharpen 的 resolved color；sharpness 只作用最终输出                                                |
| TR-06 | WebGPU 在非 uniform control flow 中使用隐式导数 texture sample                            | Naga/WGSL validation 失败，真实设备或 SwiftShader 不能上线          | history 使用显式 LOD 采样；GPU validation 纳入浏览器验收                                                          |
| TR-07 | jitter/cut 生命周期分散，projection jump 不能可靠失效                                     | FOV jump、失败帧或多 camera 生命周期可出现旧帧闪回                  | Forward/Clustered 共用 submission-aware controller；检测 projection discontinuity，并在 submit/discard 清 jitter  |
| TR-08 | Clustered Forward+ 没有接入 TAA；若直接追加独立 motion pass 会重放全部 GPU Scene geometry | high-end profile 功能缺失或付出明显额外顶点成本                     | GPU Scene depth prepass 在启用时增加 motion MRT，复用同一 indirect bucket batch                                   |
| TR-09 | Hi-Z/frustum 剔除后的 GPU object 没有上一帧可见性证据                                     | 重新出现时可能使用很久以前的 object velocity                        | 启用 TAA 时双缓冲 per-object visibility；只有 previous visibility 非零才允许 motion history                       |
| TR-10 | GPU object dirty state 没有区分“本帧移动”和“移动后已稳定”                                 | stale previous matrix 可能重复输出非零 velocity，或静止物体每帧上传 | motion-changed flag 在稳定后的首帧清除；之后不再上传稳定 object record                                            |
| TR-11 | fallback opaque/transparent 与 resolve 顺序未定义                                         | fallback 物体缺 motion，或透明被错误写入 history                    | opaque fallback 先写 HDR/depth/motion，TAA resolve，transparent fallback 后合成，再 Bloom/display                 |
| TR-12 | camera history 长期持有且 TAA 关闭也可能产生新 buffer 工作                                | 多 camera 长会话增长；默认路径性能倒退                              | inactive camera history 由 graph 释放；Clustered visibility buffer、clear 和 compact write 全部按 TAA opt-in 创建 |

## 帧序

启用 Clustered TAA 后，一个 camera frame 的关键顺序是：

1. 更新 stable camera/scene transform，并暂存 jitter；
2. GPU frustum/Hi-Z cull、bucket prefix 与 visible compact，同时写 current visibility；
3. GPU Scene depth batch，一次 raster 同时写 depth 与 motion；
4. Cluster allocation 与 Clustered PBR opaque；
5. ordinary Forward fallback opaque 写入同一 HDR/depth，随后用材质 motion role 补写同一 motion
   target；
6. TAA initialize 或 resolve，写 current color/depth history 与未进入 history 的 sharpened output；
7. ordinary Forward fallback transparent/transmission 合成；
8. Bloom、display transform、present；
9. 只有 queue 接受 submission 后才轮换 color/depth/visibility history 并提交 previous transforms。

任何 setup、prepare、execute 或提交失败都会走 discard：jitter 被清除，history index、visibility
index 和 previous transform 都保持最后成功状态。

## 画质策略

- history UV 必须留在 half-texel 内；越界直接拒绝。
- depth rejection 在 reprojected UV 周围取保守 2×2 history depth 最小误差，降低边缘 sampling
  mismatch，同时不允许跨越相对深度阈值。
- clamp 在 YCoCg 中使用 3×3 mean/variance 与真实 neighborhood extent 的交集，避免单纯 RGB
  box 对亮度和色度同时过宽。
- 大 motion 最多只保留 60%
  history；当前/上一亮度差进一步降低 weight。该 response 是安全默认，不是 authored reactive
  mask 的替代品。
- transparent、particle、UI 不写当前 history。它们保持清晰的当前帧 composition，后续 TAAU 工作包再定义单独的 reactive/composition
  policy。

## 性能与内存

TAA 是明确 opt-in。以不含 backend row-pitch/alignment 的格式字节估算：

| 资源/工作          | ordinary Forward                                        | Clustered Forward+                                                                    |
| ------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Motion target      | `8 B/pixel` transient；额外 opaque/masked motion replay | `8 B/pixel` transient；GPU object 融入已有 depth prepass，只有 fallback opaque replay |
| Color history      | 双缓冲 `rgba16float`，合计 `16 B/pixel` persistent      | 相同                                                                                  |
| Depth history      | 双缓冲 `r32float`，合计 `8 B/pixel` persistent          | 相同                                                                                  |
| Resolved target    | `8 B/pixel` transient                                   | 相同                                                                                  |
| Visibility history | 无                                                      | 双缓冲 `uint`，合计 `8 B/object`；只在启用时存在                                      |

1080p 下，上述 history 加 motion/resolved 的理论额外峰值约 83 MB；其中约 50 MB 是跨帧 persistent
history。resolve 每像素读取 3×3 current neighborhood、一个 color history、一个 motion
sample 和最多四个 depth history texel，并输出三张 attachment。它适合 high-end/native-resolution
profile，不应在内存受限设备上默认开启。TAAU、动态分辨率、history packing 或 half-resolution
variant 必须作为独立质量档设计，不能偷偷改变当前 ABI。

## 自动化验收

| 范围           | 自动化入口                                            | 必须证明                                                                                                              |
| -------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| ABI/target     | Material、shader、PostProcessing Vitest               | 只有 `rgba16float`/single-sample 合法，previous/current view depth 均存在                                             |
| 提交事务       | BuiltIn UBO 与 PostProcessing Vitest                  | 成功帧推进；失败、显隐间断、显式 invalidation 不消费旧 history；jitter 恢复为零                                       |
| Clustered 集成 | Clustered Forward+ real-WebGPU Vitest                 | fused depth/motion pipeline、全部 compact material bucket、fallback、Hi-Z、resize、camera cut、device recovery 均有效 |
| 真实画面       | `test/ui/temporal-aa.spec.ts`                         | 静态 history 收敛、camera cut 首帧不闪回、后续稳定、浏览器 GPU validation 为零                                        |
| 架构/RHI       | `test:render:architecture`、`test:rhi`、`test:webgpu` | 不绕过 Render Graph/RHI，portable shader 与真实 WebGPU pipeline 可创建                                                |

用于人工审阅和自动化像素验收的页面是
[`examples/temporal_aa_observatory.html`](../examples/temporal_aa_observatory.html)。它同时覆盖 100 个 GPU
Scene object、ordinary Forward opaque/transmission fallback、动态局部光、Hi-Z、Bloom、camera
cut 和 motion pause，测试模式固定内部 640×360 以保持软件 WebGPU 的确定性。

## 明确保留到后续版本

- transparent/particle history 与 per-material authored reactive mask；
- TAAU、动态分辨率、exposure-compensated history 和 resolution-scale controller；
- normal/material ID rejection、velocity dilation 和专用 thin-feature reconstruction；
- memory-constrained quality tier 与 history format packing。

这些是功能路线，不是当前实现的隐藏缺陷；在各自 ABI、质量和性能证据完成前不得以无测试开关并入当前生产路径。
