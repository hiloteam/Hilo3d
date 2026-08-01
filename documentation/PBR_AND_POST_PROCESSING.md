# PBR、HDR 与后处理

本文记录 Hilo3D 当前 PBR 材质、glTF layered materials、opaque scene
texture 和内置后处理的生产合同。实现仍遵循唯一共享路径：

`shared renderer -> Render Graph -> portable RHI -> WebGPU/WebGL 2`

WebGPU 和 WebGL 2 不维护两套材质或后处理算法；全部 raster shader 仍以 GLSL ES
3.00 为唯一人工源码，WebGPU 产物经 Naga 生成。

## 旧效果不稳定的原因

旧 PBR 的主要问题并不是某一个参数，而是照明、颜色空间和帧编排没有形成完整链路：

| 问题                                                               | 可见结果                                                       |
| ------------------------------------------------------------------ | -------------------------------------------------------------- |
| 较老的 GGX geometry term、简单 Lambert diffuse、无多次散射能量补偿 | 粗糙金属偏黑，高光在粗糙度变化时能量不稳定                     |
| clearcoat 与 base layer 混合不完整                                 | 清漆像额外加亮，而不是有 Fresnel 遮挡的第二层介质              |
| lighting、gamma encode 和材质级 tone mapping 混在同一 shader       | HDR 值过早被压缩或截断，Bloom 拿不到真实高亮                   |
| point/spot light 存在远距离能量下限，range 边界不平滑              | 灯光在远处不自然地残留，边界容易出现亮度断层                   |
| scene color 不可供透明材质读取                                     | transmission/volume 无法看到已渲染的不透明背景                 |
| 示例自行组织多张 RenderTarget 和分离 Gaussian blur                 | Bloom 尺寸、能量、resize、双后端与资源生命周期都不属于引擎合同 |

环境光照仍需要应用提供预过滤 specular environment、diffuse irradiance/SH 和 BRDF
LUT。引擎不会把任意普通图片假装成已卷积的 IBL；缺少这些输入时，材质只能获得场景中的直接光和 ambient
light。

## 当前 PBR 光照

共享 PBR shader 使用：

- perceptual roughness 到 GGX alpha 的平方映射；
- height-correlated Smith-GGX visibility；
- Schlick Fresnel 和 Burley diffuse；
- dielectric F0 从 IOR 推导，默认 IOR 1.5 对应约 4% 正入射反射率；
- 基于 Belcour/Barla 近似的薄膜干涉 Fresnel：以纳米厚度和薄膜 IOR 做解析光谱积分，并用最大 RGB 反射率约束 base
  layer 能量；
- anisotropic GGX distribution/visibility，并从 tangent direction、rotation 与强度组合各向异性轴；
- split-sum specular IBL、粗糙表面的能量补偿、specular AO 与 horizon occlusion；
- 带独立 roughness/normal 的 dielectric clearcoat layer，base layer 按 clearcoat Fresnel 衰减；
- rectangular area
  light 保留 LTC 积分，并拆分 diffuse/specular 贡献以正确参与 transmission 和 clearcoat 分层；
- inverse-square punctual light attenuation、近距离稳定下限、平滑有限 range 和平滑 spot cone；
- 线性 HDR attachment 输出；当目标是 `rgba16float`/`rgba32float` 时，材质级 gamma encode 和旧
  `useHDR` tone mapping 自动跳过，显示变换只在后处理末端发生。

## glTF layered material 扩展

`GLTFParser` 原生解析以下扩展，并把所有引用纹理加入资源预加载集合：

- `KHR_materials_anisotropy`
    - `anisotropyStrength`
    - `anisotropyRotation`
    - `anisotropyTexture`：RG direction、B strength
- `KHR_materials_clearcoat`
    - factor、roughness、normal 及三张可选纹理
    - clearcoat normal texture 的 `scale`
- `KHR_materials_transmission`
    - factor 与 R-channel texture
- `KHR_materials_volume`
    - thickness factor、G-channel texture、attenuation distance/color
- `KHR_materials_ior`
    - volume refraction 使用的 index of refraction；没有扩展时为 1.5
- `KHR_materials_iridescence`
    - factor、thin-film IOR、最小/最大纳米厚度
    - R-channel intensity texture 与 G-channel thickness texture

标准定义为有限区间的 factor 会在加载时校验，而不是把无效资产静默 clamp。材质 shader 仍会做最终数值保护，避免应用运行时修改导致 NaN/Inf 扩散。

## Opaque scene texture

`ForwardRenderPipelineFactory({ opaqueTexture: true })` 将前向场景拆成两个 renderer list：

```text
opaque scene pass
  -> exact scene-color copy
  -> transparent scene pass (u_opaqueTexture)
```

copy 是 Render Graph 中显式声明的 `TextureCopyPass`，不是同一 attachment 的读写 feedback。透明 PBR
draw 在 graph prepare 阶段获得 frame-lifetime scene texture bind
group；普通材质不承担该 binding。WebGPU 使用固定 group 3 texture/sampler pair，custom uniform
block 从 group 3 binding 2 开始；WebGL 2 使用同一 reflection 计划映射 combined
sampler。同一 transparent pass 内的所有 transmission shader variant 共用 renderer-owned canonical
group 3 layout，避免不同 glTF 材质排列各自创建 native layout 后无法绑定同一 opaque scene texture。

Transmission 使用投影后的 screen-space refraction
ray；volume 根据折射方向修正光程，再用 Beer-Lambert attenuation 处理吸收。它是屏幕空间实现，因此：

- 只能折射 opaque copy 中已经存在的内容；
- 屏幕外 ray 会 clamp 到可见边界；
- 不解决多层透明物体互相折射、离屏内容、色散或真实多次内部反射。

这些限制是显式的最低实现边界，不会通过 backend 私有 framebuffer 抓取绕过 Render Graph。

## 内置 Bloom

`Bloom` 是 `after-transparent` forward feature，在线性 `rgba16float` scene color 上执行：

1. soft-knee threshold 与 firefly clamp；
2. 半分辨率 13-tap Karis 加权预滤波；
3. 有界 half-resolution 13-tap downsample pyramid；
4. 从最粗层向上执行 9-tap tent upsample，并用 `scatter` 控制跨尺度扩散；
5. tone mapping 之前在线性 HDR 中 additive composite。

Karis 权重会除以累计权重，因此恒定高亮保持能量，不会因为 firefly 抑制而把整张 Bloom 直接 tone-map。Pyramid
level 根据输出尺寸、`maxLevels` 和 `minResolution` 每帧确定，所有 transient texture 由 Render
Graph 分配和回收。

## Color Uber

`ColorUber` 是最终的 `after-post-process` display transform。一个 fullscreen pass 按顺序完成：

- exposure；
- LMS white balance；
- color filter 与 contrast；
- channel mixer；
- lift/gamma/gain；
- hue shift 与 saturation；
- PBR Neutral、ACES fitted、Reinhard 或 no tone mapping；
- aspect-correct vignette；
- 精确 linear-to-sRGB；
- display-space 8-bit dithering。

默认 tone mapper 是 Khronos PBR Neutral，避免高亮压缩时过度 hue shift。Bloom 必须在 Color
Uber 之前，不能在 sRGB/tone-mapped 结果上模糊。

当前 `exposure` 是固定的手动 EV compensation；运行时尚未提供 scene luminance histogram、eye
adaptation、GPU exposure
history 或可调 slope/toe/shoulder 的 filmic 曲线。相关增量与时域、Bloom 和设备恢复的组合要求记录在
[`MODERN_WEBGPU_RENDERING_ROADMAP.md`](./MODERN_WEBGPU_RENDERING_ROADMAP.md)
的 E0 工作包中，不能把规划状态误写成当前能力。

## 推荐用法

完整 HDR 管线使用 `PostProcessRenderPipelineFactory`：

```ts
const stage = await Hilo3d.Stage.create({
    backend: 'auto',
    camera,
    container,
    renderPipeline: new Hilo3d.PostProcessRenderPipelineFactory({
        bloom: {
            threshold: 1,
            knee: 0.5,
            intensity: 0.8,
            scatter: 0.7
        },
        colorUber: {
            exposure: 0,
            toneMapping: 'pbr-neutral',
            dithering: true
        },
        opaqueTexture: true
    })
});
```

该 factory 固定 attachment-zero scene color 为 `rgba16float`，默认启用 Bloom、Color Uber 和 opaque
texture。需要自行组合时，也可以把 `Bloom`/`ColorUber` 作为 `ForwardRenderPipelineFactory.features`
使用；调用方必须保证 Bloom 输入仍是线性 HDR 格式，并让 Color Uber 位于所有 HDR effect 之后。

三个示例覆盖基础参数矩阵、直接 layered material API 和真实 glTF 资产路径：

- [`pbr2.html`](../examples/pbr2.html) 使用单层 30-sample
  matrix 展示 metallic/roughness 响应，并在窄视口缩放、平移 scene grid，避免 UI 遮挡材质样本；
- [`pbr_layered_materials.html`](../examples/pbr_layered_materials.html)
  可实时开关 anisotropy、clearcoat 与 transmission，画面同时使用 volume attenuation、opaque
  texture、Bloom 和 Color Uber；
- [`gltf_material_extensions.html`](../examples/gltf_material_extensions.html) 可切换 Khronos glTF
  Sample Assets 中的 Anisotropy Barn Lamp、Clearcoat Wicker 和 Dragon
  Attenuation，以及带动画、薄膜干涉和体积折射的 Iridescent Dish with
  Olives。模型许可与 SHA-256 记录在
  [`examples/models/KhronosPBR/ATTRIBUTION.md`](../examples/models/KhronosPBR/ATTRIBUTION.md)。

共享 example 环境不再读取旧的 6 张低分辨率 diffuse bake 和 6 张 cloud cube face。当前
[`studioEnvironment.ts`](../examples/shared/studioEnvironment.ts) 从连续 cube
direction 函数生成 neutral studio、warm/cool softbox、平滑 diffuse reference 和带 mip
chain 的 specular reference；Skybox 与 image-release 专项页面把同一环境编码为 runtime PNG data
URL，以继续验证 loader 与 CPU image release，而不保留另一套旧图片。它是 deterministic example
reference，不替代应用在生产中提供经过正式卷积的 HDR IBL。

## 验证要求

改动 PBR、Bloom、Color Uber 或 scene texture ABI 时至少需要：

- WebGL 2 GLSL compile/link；
- Naga GLSL -> WGSL 转换；
- 真实 WebGPU shader module/pipeline；
- Render Graph dependency/copy validation；
- WebGL 2 与 WebGPU 的 transmissive PBR + post-processing browser render；
- public API report、TypeDoc、类型测试和 example build。
