# Rain Tea Garden

原创的“雨后茶寮 / After the rain”案例资产，按本仓库
[MIT 许可证](../../../LICENSE)发布。建筑、屋瓦、木桥、石径、树木、花丛与茶具通过 Blender
MCP 在 Blender 5.1.2 中创作；没有下载或混用第三方模型、材质和纹理。

先通过内置 ImageGen 制作[概念图](../../../documentation/images/rain-tea-garden/concept.png)，再按构图和配色建立可环绕查看的三维场景。完整生成提示和来源保留在
[concept.json](./concept.json)。概念图是创作参考，不是引擎截图，也不作为运行时背景替代模型。

## 创作与运行资产

- [author_rain_tea_garden.py](./author_rain_tea_garden.py)：通过 Blender MCP 执行的原生 Blender
  Python 建模脚本。
- [rain-tea-garden.blend](./rain-tea-garden.blend)：可编辑的 Blender 场景，包含造型、PBR 材质及 Blender 预览灯光与相机。
- [rain-tea-garden.glb](./rain-tea-garden.glb)：供 Hilo3D 加载的 glTF 2.0 二进制资产，只导出新建的
  `RainTeaGarden` 场景。

建模脚本使用固定随机种子生成庭院植物，并按对象角色和材质合并几何。屋瓦、木构、石径、樱花、绣球和摆件均为实际网格；风铃与门帘保留独立命名和转轴。各网格带 UV0。材质采用原创色板与金属度/粗糙度参数，不含图像贴图。

导出采用 Blender 自带的 Khronos glTF Blender I/O v5.1.20，应用几何修改，转换为 glTF
Y-up，保留对象名称、材质和 extras，不导出相机、灯光或动画。Blender 预览设置与实时案例渲染分开：运行时通过公共 Hilo3D
API 配置灯光、动态 GI、体积光、落花贴花及加权透明的池水、风铃和蒸汽。

2026-10-13 导出后的文件检查：1 个 glTF 场景、112 个 mesh /
primitive、39 个材质、91,687 个三角形，GLB 为 4,929,252 字节。全部 primitive 有 UV0，文件不含图像或外部 URI，GLB 头部、版本及声明长度检查通过。这是当前创作修订的结构记录，不构成浏览器渲染或性能验收。

## 重新生成

安装 Blender 5.1.2 后，从仓库根目录执行：

```sh
blender --background --factory-startup --python examples/models/RainTeaGarden/author_rain_tea_garden.py
```

脚本也可以通过 Blender MCP 在 Blender 的 Python 环境中运行。按
`architecture()`、`garden()`、`ornaments()`、`finish()`
顺序调用可分阶段创作；完整执行入口自动按此顺序完成建模并在脚本目录保存 `.blend` /
`.glb`。脚本创建独立场景并保留启动文件中原有场景；如果完整执行时已存在
`RainTeaGarden`，会报错，避免覆盖用户已编辑的场景。重新生成会更新同名导出文件，应先保存需要保留的修改。

静态示例构建使用 GLB，不复制 `.blend`
创作源文件。场景设计、交互和实际验证边界见[案例说明](../../../documentation/RAIN_TEA_GARDEN.md)。
