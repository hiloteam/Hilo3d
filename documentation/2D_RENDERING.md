# Hilo3D 2D 渲染与多 Camera 合成

## 目标与边界

2D 不是独立后端，也不绕过现有 3D 渲染架构。`Sprite`、`Text2D` 和普通 `Mesh`
一样进入共享场景收集、Render Graph、portable RHI，再由 WebGL
2 或 WebGPU 执行。这样 layer、事件、资源恢复、纹理上传、提交 fence 和诊断都只有一套语义。

首版公共能力包括：

- 共享 quad 的 `Sprite`，支持尺寸、anchor、tint 和纹理图集 frame；
- `SpriteFrame` 序列帧动画，可设置统一帧率或逐帧 duration；
- `Sprite.setTexture()`、`setFrame()`、`setFrames()` 的原地动态换图；
- Canvas 2D 栅格化的 `Text2D`，支持实测宽度换行、CJK 断行、最多行数与 ellipsis；
- atlas-backed `SlicedSprite` 九宫格与四状态 `UiButton`；
- 复用 `Stage.enableDOMEvent()` 与 CPU raycast 的 click/pointer 事件；
- `Camera2D` 的左上角像素坐标投影；
- Node 级 `sortingLayer`、`zIndex` 与稳定场景树顺序；
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

`SpriteFrame.x/y` 始终以原始图片左上角为原点，向右/向下增长。`flipY`
属于纹理上传与后端采样策略，不改变图集帧坐标；应用代码和动画方向表都不应倒置 atlas 行号。该契约覆盖完整纹理与子矩形，并在 WebGL
2、WebGPU 真实浏览器渲染中保持一致。

运行时换图不需要操作材质：

```ts
sprite.setTexture(newTexture, { resize: true });
sprite.setFrame(newFrame, { resize: true });
sprite.setFrames(newFrames, { currentFrame: 0, autoPlay: false });
```

三个方法都会保留 Sprite 的节点、共享 Geometry、UV/size/tint 实例数组；纹理变化时自动切换到该 Texture 对应的共享
`SpriteMaterial`。仅传 `material: SpriteMaterial.forTexture(texture)`
也会从材质纹理推导初始完整 frame。

`Stage` 会在 tick 时按 `priority` 从低到高稳定排序。后绘制的高优先级 Camera 在 pointer hit
test 时先接受命中。普通 Camera 默认清 color/depth/stencil；`Camera2D`
默认保留 color、清 depth/stencil，因此可以直接叠在 3D
Camera 之后。一个 attachment 在当前应用帧还没有前序 writer 时会安全 clear，避免读取未定义的 surface 内容。

`Camera2D` 的投影原点在左上角，但 `Sprite` 和 `Text2D` 的默认 anchor 仍是中心
`(0.5, 0.5)`。按 UI 左上角坐标布局背景、面板或立绘时必须显式设置
`anchorX: 0, anchorY: 0`；保留中心 anchor 时，位置必须加上显示宽高的一半。两种坐标合同不能混用，否则真实浏览器渲染会把贴近边缘的内容裁掉一半。

`Sprite.x/y` 始终是
**anchor 在父节点局部坐标系中的位置**，不是图片左上角。父节点的 position/scale/rotation 会继续参与 world
transform；DOM pointer 坐标则由 Stage 和命中的 Camera 转换到这套 world/local 坐标。不要因为
`Camera2D` 使用左上角屏幕原点，就推断 Sprite 也默认左上角定位。

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
planner 先按 `(sortingLayer, zIndex, stable scene traversal)` 产生语义正确的显示顺序，再只合并相邻且
`geometry + material` identity 相同的 Sprite，并按 portable `MAX_INSTANCES_PER_DRAW = 128`
自动拆批。高值后绘制；相同值保持 `addChild()` 建立的场景树顺序。 `Node.layer` 是 Camera visibility
bit mask，与 `sortingLayer` 无关。

两个后端消费同一份实例合同：

- WebGL 2：模型矩阵与 Sprite 字段进入 interleaved instance vertex stream；
- WebGPU：模型矩阵进入固定 std140 `InstanceBlock`，Sprite 字段进入 instance vertex stream；
- raster shader 只有一份 GLSL ES 3.00 来源；WebGPU 继续走预处理 → Vulkan GLSL 4.50 → Naga → WGSL。

稳态动画只改已有
`Float32Array`，不重建 Geometry、Material、Shader、Pipeline 或 descriptor。当前门禁明确验证 300 个同纹理 Sprite 形成
`128 + 128 + 44` 三个 batch，并验证 planner 的高水位存储可复用。

batch 不允许跨越中间显示项：`A(atlas1), B(atlas2), C(atlas1)`
必须保留三个 draw，C 不能跨过 B 与 A 合并。性能依靠 atlas 和场景树中相邻的同材质 Sprite，而不是通过重排透明对象换取 draw
call。不要用 `SpriteMaterial.renderOrder`
排一个 Sprite；默认材质按 Texture 共享，修改材质可能同时影响多个 Sprite。

## Canvas 文字

`Text2D` 把完整标签栅格化为一个 Canvas 纹理和一个 Sprite
quad。多行、font、fill、stroke、padding、line height、`maxWidth`、实测宽度自动换行、中文断行、
`maxLines`、`overflow: 'ellipsis'`、baseline、段落间距、字间距与 backing resolution 都由 Canvas
2D 处理。Canvas 只在 `setText()` 或 `setStyle()`
时重绘；普通 tick 不读 Canvas，也不触发纹理上传。重绘会复用原 Canvas、Texture 和 SpriteMaterial
identity，只推进 Texture content
revision；因此低频更新 HUD 分数不会反复创建材质、shader 或 pipeline。

```ts
const description = new Text2D({
    text: '枫叶镇 Maple Post 的快递将在 18:30 前送达。',
    style: {
        font: '600 16px system-ui',
        maxWidth: 280,
        maxLines: 3,
        overflow: 'ellipsis',
        lineHeight: 24,
        paragraphSpacing: 8,
        letterSpacing: 0.5
    }
});
```

每个动态 `Text2D` 默认拥有自己的纹理，所以它仍是一个 draw
item，但不同标签不能像同图集 Sprite 一样合并。大量静态字形应预烘焙到同一个 font atlas，再使用普通
`Sprite`/`SpriteFrame`，以获得完整的跨文字 batch。

## Nine-slice 与按钮

`SlicedSprite` 把一个 atlas frame 分成九个相邻 Sprite。四个角保持源像素尺寸，边和中心按目标
`width`/`height` 拉伸；九个分片共享同一 Texture 的默认材质，因此排序相邻时进入同一个 Sprite instance
batch。

```ts
const panel = new SlicedSprite({
    frame: panelFrame,
    insets: { left: 24, right: 24, top: 20, bottom: 20 },
    width: 480,
    height: 260
});

const button = new UiButton({
    frames: { up, hover, down, disabled },
    insets: { left: 24, right: 24, top: 20, bottom: 20 },
    width: 260,
    height: 72,
    label: 'START'
});
stage.enableDOMEvent(['pointermove', 'pointerdown', 'pointerup', 'click']);
```

`UiButton` 复用同一组九个分片，状态变化只调用分片的
`setFrame()`，不会重建节点或实例数组。label是一个居中的
`Text2D`。禁用状态会同时关闭按钮及其分片的 pointer picking。

Nine-slice 只能保真拉伸专门为切片设计的素材。四角装饰必须完整落在 corner
insets 内；四条边的可拉伸区必须连续、等宽且没有居中的徽章、卡扣、缺口或跨切线装饰；中心区应是可重复或可均匀拉伸的平面。不能把普通装饰框随意切九块，否则边缘过渡会被拉长，最终表现为顶边、正文和底边互相脱节。至少用一个比源 frame 更宽、一个更高的真实浏览器尺寸验收。

## 点击与命中

Sprite 覆盖了单位 quad 的默认 raycast，使用实际 width、height、anchor 和 world
transform 做矩形命中，不会因为渲染几何体共享而把点击区域错误限制为 1×1。多 Camera 命中按 priority 逆序，并应用相同的 layer
mask；同一 Camera 内按 `(sortingLayer, zIndex, stable scene traversal)`
选择视觉上最上层的命中，因此被覆盖的 Sprite 不会抢走点击。被 2D Camera 隔离的 UI 也不会被 3D
Camera 抢占。

事件仍由 `Stage.enableDOMEvent()` 按需启用。不开启 DOM event 时没有 Canvas
listener 或每帧 picking 成本。

## 性能注意事项

- 同一 atlas 必须共享同一个 `SpriteMaterial`；默认构造已自动完成，应用不要为每个 Sprite 创建材质。
- 用 `sortingLayer`/`zIndex` 表达显示语义，并尽量让同 atlas Sprite 在最终顺序中保持相邻。
- 用 atlas frame 改 UV，不要为每帧动画创建 Geometry。
- 大量文本优先 font atlas；`Text2D` 更适合 HUD 标签、分数和低频变化文字。
- `Camera.priority` 数量通常很小；Stage 原地稳定排序，不创建每帧 Camera 数组。
- 多 Camera 在一个 Render Graph/RHI frame 内记录和提交，不为每个 Camera 创建独立 submission。
- Surface color、depth 和 stencil 先组合在 renderer-owned linear persistent target，最终 output
  pass 再执行 display transfer；Camera stack 不读取 presentation surface。
- 单 Camera 仍可使用 transient MSAA attachment 并 resolve 到 composition target。多 Camera
  stack 整体使用 single-sample
  color/depth/stencil，保证后续 Camera 能无损 load 前序内容，避免新建 MSAA
  attachment 无法加载已 resolve color 的隐式降级分支。

## 2D Studio 交互案例

六个案例共用 `examples/shared/studio2d.ts` 的展厅导航与参数面板；场景主体始终由
`Sprite`、`SlicedSprite`、`UiButton`、`Text2D`
和共享 Stage 渲染。HTML 负责导航、参数输入和可访问的状态说明，不能用 DOM 画面代替引擎能力。

| 案例                                                    | 展示能力                                                      | 可操作内容                                                       |
| ------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------- |
| [Luminous garden](../examples/2d_sprite_animation.html) | 八帧图集动画、Tint、透明倒影、父节点变换、2D/3D/2D 三相机合成 | 点击月蛾暂停、逐帧选择、帧率和缩放、换色、合成层开关             |
| [Stardust atelier](../examples/2d_sprite_batch.html)    | 同图集共享材质合批、独立位置/尺寸/颜色/透明度                 | 512/2,048/4,096/8,192 精灵、旋涡/流带/轨道队形、速度、展开、暂停 |
| [Letters to the moon](../examples/2d_text.html)         | Canvas 文字、描边、动态内容、点击 Text2D 命中                 | 编辑明信片、字号、描边、配色、寄信与分数反馈                     |
| [The field journal](../examples/2d_text_layout.html)    | 中英混排、实测字宽、换行、最多行数、省略号、字距、段落间距    | 实时栏宽、截断行数、字距、排版边界；手机单列堆叠                 |
| [The travel bureau](../examples/2d_ui_button.html)      | 面板与按钮九宫格、四状态 UiButton、尺寸变化后的真实命中       | 实际图集原图九分区、切线、宽高拉伸、悬停/按下/禁用、解锁目的地   |
| [Maple afternoon](../examples/2d_sorting_town.html)     | 脚底 Y 排序、稳定场景顺序、四方向序列帧、A* 寻路              | 点击道路、自动巡游、路径提示、速度、时光配色、关闭排序作对照     |

星群页面的“预期精灵批次”仅为
`ceil(activeSprites / 128)`：4,096 个星种对应 32 个批次，8,192 个对应 64 个批次。它不包含文字、背景等额外绘制，也不是帧率或跨提交性能证据。精灵数组与随机种子在初始化时分配；切换数量只改显隐，动画只更新既有 Sprite。

展厅使用 `ResizeObserver`
按画布容器实测尺寸调整 Stage 与 Camera，而非假定整个 window 都是画布。明信片、售票界面与排版手帐在窄屏重新排布内容；侧栏参数移到画布下方。所有案例均保留
`?backend=webgl2`、`?backend=webgpu` 与
`auto`，在展厅内跳转时保留查询参数。动画与星群初始播放状态尊重 `prefers-reduced-motion`。

### 小镇素材落地点与实体避让

旧对象 atlas 第二行有 74–86
px 底部透明留白，不能把整个格子的下边界当作地面。案例现在用逐帧有效像素矩形创建
`SpriteFrame`，并以实际可见底边布置对象及设置
`zIndex`。地图建筑和树木美术继续复用，位置按完整街区重新布置：北侧三间店面朝向主街，东南两间建筑朝向下方环路，西南为有开放草坪的花园，湖岸用树木和路牌组织边界。

每个物件单独声明底座占地，寻路网格剔除与底座及 8
px 余量相交的 tile；连通域过滤避免选择与主广场隔离的道路点。可打开“显示实体底座”，或者固定角色到“花坛后方／花坛前方”检查遮挡，再关闭排序观察错误顺序的对照效果。

角色使用重新生成的平泽唯（Yui Hirasawa）像素图集：四行分别为前、左、右、后方向，各四帧。原图为 1254
× 1254，行列起点存在半像素分界，脚底也有少量帧间偏移；每次 `gotoFrame()` 同步更新以源像素测得的
`anchorY`。角色 world
Y 始终表示实际鞋底位置，不受透明留白影响，无需修改引擎排序或制作第二套动画系统。

### 九宫格素材与颜色

售票案例提供 ImageGen 生成的 **Astral Guild · 翡翠鎏金** 与 **Rose Reliquary · 玫瑰秘藏**
两套原始透明 PNG 图集，每套包含 up/hover/down/disabled 四种状态。`ornateUi2d.ts` 中的 `SpriteFrame`
按每帧真实 bounds 取图；原图不进行色键去背或二次位图编辑。源像素 inset 为左右 154、上下 140，包住完整宝石与卷草。按钮按 1/7 显示，固定角部为 22
× 20 个逻辑像素；大面板按 2/7 显示，固定角部为 44 × 40。

大面板保留四角全部美术，四条边取均匀的单行/单列图集样本，中心取平面色块，避免将颗粒纹理拉成条纹。按钮仍采用完整原图九宫格。UiButton 的 label 独立抵消父节点缩放，保持正常字号和Canvas 分辨率。两套按钮在初始化时构建，换皮只切换显隐；状态切换继续复用原有九个分片。源图示意、当前皮肤、按钮切线与宽高控制联动；禁用/解锁状态在两套皮肤间保持一致。

其他文字案例的纸张面板继续使用 `studio2d.ts` 中的 Canvas 矢量图集。合批页面改用 `stardustAtlas.ts`
的 256 × 256 透明粒子图集，包括柔光、光点、四角星芒、椭圆光斑和光丝。小尺寸纹理通过 Sprite
Tint 着色，适合密集星群，不依赖缩到几像素的复杂道具图标。

合批页的 **RENDER DEBUG** 以半透明面板悬浮在画布左上角（不拦截指针），每 250 ms 读取
`renderer.renderInfo.drawCount` 和 `faceCount`，显示实际 Draw
calls、Triangles，并用观察窗口中的 tick 间隔计算 FPS 和 Frame
interval。Draw 是整个应用帧的实际绘制统计；Triangles 沿用引擎的可见场景面数合同。Frame
interval 是帧间隔，不是 GPU 计时。浏览器测试验证 512、4,096、8,192 精灵切换时实际 Draw 和 Triangles 增量，不能用预期批次数冒充真实调试指标。

新生成的 `luminous-garden.png`、既有月蛾/星种/小镇图集，以及 Canvas
UI 图集均以 sRGB 颜色存储进入线性合成；带动态 Tint
alpha 的美术 Sprite 使用直通 alpha 混合，避免低 alpha 装饰仍保留完整 RGB 亮度。示例中的 Text2D 在首次上传前指定 sRGB 存储，以保留 CSS 字色。这些都是案例侧的现有 Texture 配置，没有新 shader 或独立渲染路径。

ImageGen 主场景的完整提示词和素材来源见 [2D Studio art](../examples/image/2d/README.md)。

![Luminous garden sprite animation](./assets/2d-sprite-animation-example.png)

![2D responsive text layout example](./assets/2d-text-layout-example.png)

![2D nine-slice UI button example](./assets/2d-ui-button-example.png)

![Rose Reliquary nine-slice UI](./assets/2d-ui-button-rose-example.png)

![Stardust renderer debug panel](./assets/2d-sprite-batch-example.png)

![2D sorting town example](./assets/2d-sorting-town-example.png)

### 验证入口

`test/ui/examples.spec.ts` 中的 `2D studio`
用例覆盖双后端逐帧切换、月蛾点击、星群数量与队形、文字编辑和换行、九宫格悬停/按下/禁用/解锁与缩放命中、道路规划及六页手机布局；原有通用案例测试继续校验实际 WebGL2/WebGPU
draw、图像呈现、资源请求和 GPU 错误。

```sh
npx playwright test test/ui/examples.spec.ts --project=chromium --grep '2D studio|2d_.*renders through'
npx vitest run test/spec/2d test/spec/camera/Camera2D.test.ts
```

若默认 4173 端口已有其他工作目录的服务，必须使用 `HILO3D_PLAYWRIGHT_PORT`
指向本工作目录的独立服务；不能把另一份源码的浏览器结果作为当前改动证据。上述浏览器矩阵是 Chromium
SwiftShader 便携覆盖，不替代物理 GPU 的性能和兼容性验收。
