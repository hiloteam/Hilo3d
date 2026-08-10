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
一起启用。显式缺少任一依赖会在 factory 构造时失败，不会静默降级到固定步长 trace 或无时序 resolve。

## 帧内数据流

生产帧的顺序是：

1. shared depth/motion prepass；
2. current-frame RG32F Hi-Z min/max pyramid；
3. Clustered opaque PBR color，同时写 material attributes；
4. ordinary Forward opaque fallback color、material attributes 和 motion；
5. HDR radiance cone pyramid；
6. half-resolution hierarchical Hi-Z reflection trace；
7. motion/depth rejection、3×3 neighborhood clamp 和 temporal accumulation；
8. 在线性 HDR 中把 reflection 合成回 opaque scene；
9. TAA/TAAU resolve；
10. transparent fallback、Bloom 和 display transform。

所有资源和依赖都由同一 Render
Graph 声明；prepare 只创建可复用的 pipeline/binding，execute 才记录命令。SSR 不直接访问原生 `GPU*`
对象，也不绕过 portable RHI。

## Material attribute ABI

`material-attributes` 是内置材质的正式 semantic pass，目标固定为 single-sample `rgba16float`：

| Channel    | Contract                                             |
| ---------- | ---------------------------------------------------- |
| RG         | view-space normal 的 octahedral 编码，范围 `[-1, 1]` |
| B          | perceptual roughness，钳制到 `[0.045, 1]`            |
| A bit 0    | surface 是否接收 SSR                                 |
| A bits 1–8 | 8-bit quantized metallic                             |

这个整数 packing 最大为 511，可被 float16 精确表示。PBR surface 写 receiver
bit；Basic、Geometry 等没有正式 PBR 反射参数的内置 family 写无效 receiver。GPU Scene storage
PBR 和 ordinary Forward PBR 使用同一 ABI。自定义 opaque material 没有显式 `material-attributes`
pass 时保持清屏值并跳过 SSR，不会猜测 normal/roughness。alpha-mask 的属性 pass 重用同一 coverage
discard。

## Trace、confidence 与粗糙度

Hi-Z 每级保存 device-depth 的 min/max，因此 standard 与 reversed depth 共用同一金字塔；GPU occlusion
culling 从相应边界读取 conservative farthest
depth，SSR 则使用完整区间做 coarse-to-fine 推进和精确 scene-depth
thickness 测试。命中辐射按 roughness 与 ray distance 选择四级 HDR color
cone。最终 confidence 同时包含 screen-edge、ray-distance 和 roughness
fade，未命中、离屏、背景、背向或超过 roughness cutoff 的像素返回零贡献。

这是纯 screen-space 效果：屏幕外、被前景完全遮挡或当前 color
buffer 中不存在的信息没有可用命中。当前版本确定性返回零作为 fallback；它不伪装成 probe、BVH、SDF 或硬件 ray
tracing。

## Temporal 与生命周期

SSR history 是双缓冲 `rgba16float` radiance/confidence 加双缓冲 `r32float` log-view-depth。motion
XY 负责 reprojection，motion Z 与 previous depth history 做 relative-depth disocclusion
reject，当前 3×3 邻域限制旧 radiance，像素速度降低 history weight。

camera cut、投影/depth convention 改变、camera identity 切换、resize、device
generation 改变和首次使用都会初始化 history。history 交换由 Render
Graph 在有效 submission 后提交；record/prepare/submit 失败不会推进旧 history。设备恢复从 backend-neutral
recipe 重建资源，public pipeline identity 不变。

## 上线证据

- `test/spec/renderer/ClusteredForwardPlus.test.ts`：配置/limit/format 合同，以及真实 WebGPU 的 GPU
  Scene、ordinary fallback、camera cut、resize、standard/reversed depth 和 device recovery。
- `test/ui/screen-space-reflections.spec.ts`：真实浏览器 GPU
  validation、静态 history 收敛，以及同一视角 SSR on/off 的非零像素贡献。
- `examples/screen_space_reflections_palace.html`：使用仓库内 Khronos Car Concept、GPU
  Scene 发光装置、ordinary Forward PBR floor、三档 roughness、TAA、Bloom 和 Hi-Z
  SSR 的独立维护示例； `ssr=false` 可显示确定性无 SSR 对照。Car Concept 资产来源、CC BY
  4.0 许可和 hash 记录在 `examples/models/CarConcept/README.md`。

现有 `examples/temporal_aa_observatory.html` 保持为独立 TAA/TAAU 案例，不承担 SSR release evidence。

SSGI 尚未由此功能实现。后续 SSGI 可以复用 RG32F Hi-Z、material attribute ABI、motion/depth
history 和 rejection 规则，但必须拥有独立的采样、能量与验证合同。
