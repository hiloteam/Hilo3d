# Hilo3D 2D 渲染与多 Camera 合成

## 目标与边界

2D 不是独立后端，也不绕过现有 3D 渲染架构。`Sprite`、`Text2D` 和普通 `Mesh`
一样进入共享场景收集、Render Graph、portable RHI，再由 WebGL
2 或 WebGPU 执行。这样 layer、事件、资源恢复、纹理上传、提交 fence 和诊断都只有一套语义。

首版公共能力包括：

- 共享 quad 的 `Sprite`，支持尺寸、anchor、tint 和纹理图集 frame；
- `SpriteFrame` 序列帧动画，可设置统一帧率或逐帧 duration；
- Canvas 2D 栅格化的 `Text2D`，内容或样式改变时才更新纹理；
- 复用 `Stage.enableDOMEvent()` 与 CPU raycast 的 click/pointer 事件；
- `Camera2D` 的左上角像素坐标投影；
- `Camera.priority`、color/depth/stencil clear 开关；
- `Camera.visibility & Node.layer` 的 32-bit layer 过滤；
- 一个应用帧、一个 Render Graph/RHI submission 内的多 Camera 合成。

## 最小用法

```ts
import {
    Camera2D,
    DEFAULT_2D_LAYER,
    PerspectiveCamera,
    Sprite,
    SpriteFrame,
    Stage,
    Texture
} from 'hilo3d';

const worldCamera = new PerspectiveCamera({
    visibility: 1,
    priority: 0,
    clearColor: true
});
const uiCamera = new Camera2D({
    width: 1280,
    height: 720,
    visibility: DEFAULT_2D_LAYER,
    priority: 100,
    clearColor: false
});
const stage = await Stage.create({
    backend: 'auto',
    width: 1280,
    height: 720,
    cameras: [uiCamera, worldCamera]
});

const atlas = new Texture({ image, flipY: true });
const sprite = new Sprite({
    frames: [
        new SpriteFrame({ texture: atlas, x: 0, y: 0, width: 64, height: 64 }),
        new SpriteFrame({ texture: atlas, x: 64, y: 0, width: 64, height: 64 })
    ],
    x: 100,
    y: 80,
    frameRate: 12,
    useHandCursor: true
});
sprite.on('click', () => {
    sprite.pause();
});
stage.addChild(sprite);
stage.enableDOMEvent('click');
```

`Stage` 会在 tick 时按 `priority` 从低到高稳定排序。后绘制的高优先级 Camera 在 pointer hit
test 时先接受命中。普通 Camera 默认清 color/depth/stencil；`Camera2D`
默认保留 color、清 depth/stencil，因此可以直接叠在 3D
Camera 之后。一个 attachment 在当前应用帧还没有前序 writer 时会安全 clear，避免读取未定义的 surface 内容。

## Layer 语义

`Node.layer` 默认是 bit 0（值 `1`），`Sprite` 和 `Text2D` 默认是 bit
1（`DEFAULT_2D_LAYER`）。Camera 收集一个 Mesh 或 Light 的条件是：

```ts
(camera.visibility & node.layer) !== 0;
```

`visible` 仍是层级开关：父节点不可见会跳过整棵子树；`layer`
是逐可渲染节点的 Camera 过滤，不隐式覆盖子节点。Scriptable Render Pipeline 的 `cull()`
复用同一个 planner，因此不会出现默认 forward 与 SRP layer 语义分叉。

## Sprite batch 合同

所有默认 Sprite 共享一个单位 quad。`SpriteMaterial.forTexture(texture)` 按 Texture
identity 复用材质；UV rect、逻辑 size/anchor、tint 和 transform 都是实例数据。共享 draw-list
planner 用 `geometry + material` identity 分组，并按 portable `MAX_INSTANCES_PER_DRAW = 128`
自动拆批。

两个后端消费同一份实例合同：

- WebGL 2：模型矩阵与 Sprite 字段进入 interleaved instance vertex stream；
- WebGPU：模型矩阵进入固定 std140 `InstanceBlock`，Sprite 字段进入 instance vertex stream；
- raster shader 只有一份 GLSL ES 3.00 来源；WebGPU 继续走预处理 → Vulkan GLSL 4.50 → Naga → WGSL。

稳态动画只改已有
`Float32Array`，不重建 Geometry、Material、Shader、Pipeline 或 descriptor。当前门禁明确验证 300 个同纹理 Sprite 形成
`128 + 128 + 44` 三个 batch，并验证 planner 的高水位存储可复用。

透明 Sprite 的实例化意味着同一 batch 内按收集顺序绘制，而不是为每个 Sprite 做全局透明深度排序。需要严格交错排序的对象应使用不同
`SpriteMaterial.renderOrder` 分层；这会有意拆分 batch。

## Canvas 文字

`Text2D` 把完整标签栅格化为一个 Canvas 纹理和一个 Sprite
quad。多行、font、fill、stroke、padding、line height 与 backing resolution 都由 Canvas
2D 处理。Canvas 只在 `setText()` 或 `setStyle()`
时重绘；普通 tick 不读 Canvas，也不触发纹理上传。重绘会复用原 Canvas、Texture 和 SpriteMaterial
identity，只推进 Texture content
revision；因此低频更新 HUD 分数不会反复创建材质、shader 或 pipeline。

每个动态 `Text2D` 默认拥有自己的纹理，所以它仍是一个 draw
item，但不同标签不能像同图集 Sprite 一样合并。大量静态字形应预烘焙到同一个 font atlas，再使用普通
`Sprite`/`SpriteFrame`，以获得完整的跨文字 batch。

## 点击与命中

Sprite 覆盖了单位 quad 的默认 raycast，使用实际 width、height、anchor 和 world
transform 做矩形命中，不会因为渲染几何体共享而把点击区域错误限制为 1×1。多 Camera 命中按 priority 逆序，并应用相同的 layer
mask；因此被 2D Camera 隔离的 UI 不会被 3D Camera 抢占。

事件仍由 `Stage.enableDOMEvent()` 按需启用。不开启 DOM event 时没有 Canvas
listener 或每帧 picking 成本。

## 性能注意事项

- 同一 atlas 必须共享同一个 `SpriteMaterial`；默认构造已自动完成，应用不要为每个 Sprite 创建材质。
- 用 atlas frame 改 UV，不要为每帧动画创建 Geometry。
- 大量文本优先 font atlas；`Text2D` 更适合 HUD 标签、分数和低频变化文字。
- `Camera.priority` 数量通常很小；Stage 原地稳定排序，不创建每帧 Camera 数组。
- 多 Camera 在一个 Render Graph/RHI frame 内记录和提交，不为每个 Camera 创建独立 submission。
- 保留前序 color 的 overlay pass 直接写 single-sample surface；这是因为新建 MSAA
  attachment 无法加载已 resolve 的前序 Camera
  color。首个或显式清 color 的 Camera 仍可使用正常 MSAA。
- 如果后续 Camera 配置 `clearDepth: false` 或 `clearStencil: false`，整个 Camera
  stack 会在该帧使用 single-sample persistent
  depth/stencil，以保证前序深度或模板内容确实可 load；默认会清 depth/stencil 的 2D
  overlay 不触发这个降级。

## 示例

- [`2d_sprite_animation.html`](../examples/2d_sprite_animation.html)：序列帧月蛾、Sprite 点击暂停，以及背景 2D
  Camera、3D world Camera、2D UI Camera 的三层合成。
- [`2d_text.html`](../examples/2d_text.html)：Canvas 多行文字、描边、低频动态分数与点击换文案。
- [`2d_sprite_batch.html`](../examples/2d_sprite_batch.html)：单 atlas 的 4,096 Sprite；按 128
  instances 自动形成 32 个 portable Sprite batch。

三套 “Moonlit
Conservatory” 美术资源由 ImageGen 生成，透明序列帧条与 4×4 图集经过 Pillow 做色键去背、边缘消色与 alpha 检查。示例可用
`?backend=webgl2` 或 `?backend=webgpu` 显式选择后端。
