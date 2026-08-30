# Screen-space reflections

Hilo3D 的首个生产 SSR 是 `ClusteredForwardPlusPipelineFactory` 的 WebGPU
high-end 可选路径。它默认关闭；关闭时不创建 material-attributes、radiance pyramid、trace
texture 或 SSR history，也不增加普通 Clustered frame 的 draw/dispatch。

```ts
const pipeline = new Hilo3d.ClusteredForwardPlusPipelineFactory({
    buckets,
    hiZ: true,
    temporalAA: { renderScale: 0.75 },
    screenSpaceReflections: {
        resolutionScale: 0.5,
        maxRayDistance: 80,
        thickness: 0.2,
        stride: 0.12,
        maxSteps: 64,
        roughnessCutoff: 0.85,
        edgeFade: 0.08,
        historyWeight: 0.9,
        depthThreshold: 0.03,
        intensity: 1
    }
});
```

SSR 必须和 `hiZ`、`temporalAA`
一起启用。显式缺少任一依赖会在 factory 构造时失败，不会静默降级到固定步长 trace 或无时序 resolve。配置还要求
`maxRayDistance >= 4 * stride` 且
`maxRayDistance >= 2 * thickness`，避免参数分别合法、组合后却没有足够 trace 区间或整个 ray 都落入 thickness
band。

## 帧内数据流

生产帧的顺序是：

1. GPU Scene 与 ordinary Forward opaque 共用的 depth/motion prepass；
2. current-frame RG32F Hi-Z min/max pyramid；
3. 按需先写 GTAO 所需的 material attributes 并生成 ambient visibility；
4. Clustered opaque PBR color 同时写 view-dependent reflection response 和已进入 scene
   color 的 environment/probe specular baseline；ordinary Forward opaque fallback
   color 后再以相同 GTAO visibility 补写三目标 reflection material ABI；
5. HDR radiance cone pyramid；
6. 8×8 receiver tile classification，64-tile coherent compaction 和 indirect hierarchical Hi-Z
   trace；
7. 低粗糙度确定性镜面 ray、每帧四条 32-phase rotated scrambled Hammersley visible-GGX
   ray、roughness-adaptive 距离/迭代预算、精确 depth refinement、hit-normal facing
   validation，以及 valid/uncertain/backface/miss 分类；
8. receiver-domain 与 hit-motion-domain 两路 history candidate、reactive rejection、YCoCg
   neighborhood moments、roughness-adaptive firefly clamp 与最高 24-frame sample-count/confidence
   accumulation；
9. 一个固定邻域 confidence reconstruction、一个 roughness-adaptive variance-guided stability
   pass、一个有界 residual-coverage cleanup pass 和 full-resolution depth/normal-aware
   resolve，再以 additive delta 原位替换 opaque scene 中已有的 environment/probe specular；
10. TAA/TAAU resolve；
11. transparent fallback、Bloom 和 display transform。

所有资源和依赖都由同一 Render
Graph 声明；prepare 只创建可复用的 pipeline/binding，execute 才记录命令。SSR 不直接访问原生 `GPU*`
对象，也不绕过 portable RHI。

ordinary Forward opaque 必须先通过正式 `depth-only` material role 把 fallback 深度合入 current-frame
scene depth，再构建 Hi-Z。否则 radiance 中虽能看到 fallback 物体，hierarchical
trace 却没有对应深度可命中；Car Concept 的 layered PBR 车身就是这条回归的发布夹具。

## Material attribute ABI

`material-attributes` 是内置材质的正式 semantic pass。普通消费者使用一个 single-sample `rgba8unorm`
target；SSR 启用时再附加两个 matching HDR target。HDR target 在支持 renderable、filterable
`rg11b10ufloat` 时使用该格式，否则回退到 `rgba16float`：

| Channel    | Contract                                              |
| ---------- | ----------------------------------------------------- |
| RG         | view-space normal 的 octahedral 编码，映射到 `[0, 1]` |
| B          | perceptual roughness，钳制到 `[0.045, 1]`             |
| A bit 0    | surface 是否接收 SSR                                  |
| A bits 1–7 | 7-bit quantized metallic                              |

SSR 的 location 1 写当前视角的 RGB reflection response，location 2 写 forward color 中已经存在的 RGB
environment/probe specular baseline。ordinary PBR 使用 IOR、metallic workflow 或 specular-glossiness
workflow 计算 response，并复用材质 environment map/BRDF LUT 计算 baseline；GPU
Scene 在没有 per-material environment map 的固定 bucket 路径使用 clustered ambient radiance
fallback，并把同一值加入 forward color。有效 screen-space hit 因而执行
`scene + gate * intensity * SSR - gate * confidence * baseline`，其中 `gate`
对低于可靠区间的 confidence 做 smoothstep 淡入。`intensity` 只缩放新 SSR
radiance，不会错误放大 fallback removal；miss 保留原 baseline，不再额外叠加一层高光。

packed byte 最大为 255，通过 UNORM 精确往返。相较旧的 `rgba16float`
attribute，常驻带宽和显存减半；两个 reflection target 在 `rg11b10ufloat` 可用时也各自减半。PBR
surface 写 receiver bit；Basic、Geometry 等没有正式 PBR 反射参数的内置 family 写无效 receiver。GPU
Scene storage PBR 和 ordinary Forward PBR 使用同一 ABI。自定义 opaque material 没有显式
`material-attributes`
pass 时保持清屏值并跳过 SSR，不会猜测 normal/roughness。alpha-mask 的属性 pass 重用同一 coverage
discard。clearcoat dominance 会把 trace normal/roughness 向 clearcoat
lobe 混合；anisotropy 使用与 forward IBL 相同的旋转 tangent 和强度弯折 trace
normal，避免 response、fallback 和 ray direction 来自不同材质 lobe。ordinary Forward 的 reflection
response/baseline 还复用主 PBR 的 GTAO visibility 与 iridescence factor/IOR/thickness，保证 additive
replacement 减掉的就是 opaque color 实际包含的 IBL。

## Trace、confidence 与粗糙度

Hi-Z 每级保存 device-depth 的 min/max，因此 standard 与 reversed depth 共用同一金字塔；GPU occlusion
culling 从相应边界读取 conservative farthest
depth，SSR 则使用完整区间做 coarse-to-fine 推进、line-segment refinement、grazing/depth-adaptive
thickness 和 hit-normal facing 测试。背景 crossing、过深 penetration 和背面候选不会被当作普通 valid
hit。trace 不假设反射 ray 必须远离相机，因此 camera-facing vertical
mirror 也能追踪位于镜面与相机之间的屏幕内物体。命中辐射按 roughness 与 ray distance 选择四级 HDR
color cone。perceptual roughness 不高于 0.1 时使用确定性镜面 ray；这与 Unreal legacy SSR 的
`Roughness < 0.1` 镜面退化一致。更粗糙 receiver 每帧使用四条完整分层的 scrambled Hammersley
visible-GGX ray，并用 32-phase Cranley-Patterson
rotation 扩展时间覆盖，而不是把四条射线聚集在长序列的相邻区间或逐帧使用无结构 hash。四条射线的 radiance/confidence 按总 ray
count 归一化，因此 miss 保留已有 environment/probe
fallback，不会把半分辨率命中轮廓放大成黑块。最大 ray distance 和 iteration
count 也随 roughness 收缩。最终 confidence 同时包含 screen-edge、ray-distance 和 roughness
fade，未命中、离屏、背景或超过 roughness cutoff 的像素不替换 fallback。

classification 同时检查 depth、receiver、roughness 和 reflection-response energy，先写每 tile
mask，再以 64-tile workgroup prefix scan 写出空间相干的 compact list；trace 通过 GPU-authored
indirect dispatch 执行。compact count 会在 GPU 上转换为 `x <= 65535` 的二维 indirect
dispatch，shader 再以真实 active count 做尾部越界保护，因此 4K full-resolution
trace 不会超过 WebGPU 单维 workgroup 上限。`ClusteredForwardPlusDiagnostics` 除 active
tile/pixel 与 hit/miss 外，还暴露 uncertain、backface-rejected、history
accepted/rejected 计数；uncertain 与 backface-rejected 是互斥 miss 子类，可直接验证命中质量和 temporal
rejection。同一 indirect list 也驱动昂贵的 temporal neighborhood 与 adaptive
filter；它们先用低成本 full-extent clear 确定 inactive pixel 状态，因此 sparse
receiver 场景不会在空 tile 上执行 history/filter taps。HDR color
cone 仍覆盖完整 scene，因为任一 active ray 都可能命中任意屏幕位置。

时序结果在合成前经过三级 filter。第一级用连续 3×3 邻域重建低 confidence 和 miss
hole；第二级按 roughness 扩大到 1–3 个 trace
pixel；第三级用连续 3×3 邻域和更强的中心权重清理低视角下残留的半分辨率覆盖缺口，避免稀疏样本被时序累积成横向条带或棋盘块，同时不把稳定反射过度模糊。三级都约束 receiver、roughness、view
normal、receiver/hit logarithmic depth 和 luminance，中心权重还会随 history
maturity 增长：未收敛像素优先借用邻域，成熟 history 则更保守。单帧亮度离群值在 temporal
resolve 前按 YCoCg neighborhood
variance 限幅，避免暗地面上的稀疏高亮成为 firefly。最终半分辨率到全分辨率 resolve 手动 gather 相邻 trace
pixel，并再次用 full-resolution normal/depth/roughness 权重拒绝跨边界泄漏。

这是纯 screen-space trace：屏幕外、被前景完全遮挡或当前 color
buffer 中不存在的信息没有 screen-space 命中；这些位置确定性保留 forward
PBR 已经计算的 environment/probe fallback。它不伪装成 BVH、SDF 或硬件 ray tracing。

## Temporal 与生命周期

SSR history 是双缓冲 `rgba16float` radiance/sample-count/confidence、双缓冲 `r32float` receiver
log-view-depth、双缓冲 `rgba16float` receiver normal/roughness + hit log-view-depth
state，以及双缓冲 `rgba16float` reflection response + packed material state。绝对 hit
UV 不再写入 half-float history，避免高分辨率下 1–2
pixel 量化；trace 直接写命中物体的 motion、expected-previous/current log
depth。resolve 同时评估 receiver motion candidate 和 hit-motion candidate，用 previous
state 中真实保存的 normal/roughness/depth/response/packed material 做 continuity，而不是在 history
UV 上误采当前帧 attribute。authored/transparent reactive mask 会降低两路 candidate；三级 spatial
filter 也用 response 与 packed material continuity 阻止跨材质边界借样。

当前 3×3 radiance 在 YCoCg 中生成 mean/variance
clamp，并在粗糙 stochastic 区域先抑制单帧 firefly；history alpha 的整数部分保存最高 31 的 capped
sample count，小数部分保存 confidence。粗糙表面最多使用 24-frame
accumulation，镜面、快速 motion、miss 和 disocclusion 更快响应；miss 可以短暂继承低 confidence
history 完成局部 hole fill，但会持续衰减。

实现细节同时对照了 Epic UE 5.8/5.8.x 与 `ue6-main` 源码：legacy SSR 的 GGX ray 与 hit-normal
validation，以及 Lumen reflection 的 uncertain state、surface/hit temporal candidate、YCoCg
variance/sample-count resolve 和 coherent tile dispatch。Hilo3D 没有复制 Lumen 的 surface
cache、radiance cache 或硬件/软件 ray tracing；本引擎对应的是 roughness cutoff、active-tile indirect
trace、forward environment/probe baseline 和 hit-aware temporal rejection。参考：
[Epic UnrealEngine repository](https://github.com/EpicGames/UnrealEngine)、
[06wj UnrealEngine mirror](https://github.com/06wj/UnrealEngine)、
[UE 5.8 Lumen Performance Guide](https://dev.epicgames.com/documentation/en-us/unreal-engine/lumen-performance-guide-for-unreal-engine)、
[Lumen Technical Details](https://dev.epicgames.com/documentation/en-us/unreal-engine/lumen-technical-details-in-unreal-engine)、
[UE 5.8 Release Notes](https://dev.epicgames.com/documentation/en-us/unreal-engine/unreal-engine-5-8-release-notes)。

camera cut、投影/depth convention 改变、camera identity 切换、resize、device
generation 改变和首次使用都会初始化 history。history 交换由 Render
Graph 在有效 submission 后提交；record/prepare/submit 失败不会推进旧 history。设备恢复从 backend-neutral
recipe 重建资源，public pipeline identity 不变。

## 上线证据

- `test/spec/renderer/ClusteredForwardPlus.test.ts`：配置/limit/format 合同，以及真实 WebGPU 的 GPU
  Scene、ordinary fallback、active/hit/miss diagnostics、roughness cutoff、moving receiver、camera
  cut、camera-facing reflection rays、resize、standard/reversed depth 和 device recovery。
- `test/ui/screen-space-reflections.spec.ts`：默认 0.5× trace resolution、真实浏览器 GPU
  validation、roughness 0.08 deterministic 与 0.16/0.24
  stochastic 地面反射 ROI 连续帧的局部 changed-pixel/mean-delta 闪烁门槛、静态与 camera/hero motion
  history 收敛、低视角 grazing ROI 连续帧门槛、roughness active-work
  rejection、垂直镜面命中，以及同一视角 SSR on/off 的非零像素贡献。
- `examples/screen_space_reflections_palace.html`：使用仓库内 Khronos Car Concept、镜头外 studio
  light field、ordinary Forward PBR 烟熏漆地面、TAA、Bloom 和高精度 Hi-Z SSR 的独立维护示例；
  `ssr=false` 可显示确定性无 SSR 对照。Car Concept 资产来源、CC BY 4.0 许可和 hash 记录在
  `examples/models/CarConcept/README.md`。

现有 `examples/temporal_aa_observatory.html` 保持为独立 TAA/TAAU 案例，不承担 SSR release evidence。

SSGI 已作为独立的 portable Forward/Clustered 功能交付，并复用 material attribute ABI 与 motion/depth
history。它直接 trace 当前 scene depth，不依赖 SSR 的 RG32F
Hi-Z；两者保持独立的采样、能量、history 和验证合同。完整边界见
[`SCREEN_SPACE_GLOBAL_ILLUMINATION.md`](./SCREEN_SPACE_GLOBAL_ILLUMINATION.md)。
