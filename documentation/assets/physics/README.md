# Physics collection 审阅截图

这九张图片是六座物理展品的人工视觉审阅资料，供文档和合并请求展示构图、材质、物理状态与响应式界面。它们不参与自动像素比较，也不是性能或跨设备兼容性基线；自动验收仍由
[`test/ui/physics.spec.ts`](../../../test/ui/physics.spec.ts) 及对应 CPU 合同负责。

## 拍摄参数

- Playwright Chromium，无头运行，使用 Metal 原生 WebGPU；启动参数为
  `--enable-unsafe-webgpu --ignore-gpu-blocklist --use-angle=metal`。
- 页面显式选择 `?backend=webgpu`；机械信使近景另外使用 `&view=detail`。
- 桌面视口 1440 × 900、DPR 2，输出 2880 × 1800；手机视口 390 × 844、DPR 2，输出 780 × 1688。
- 通过页面真实按钮重建、释放或加载物体，暂停后直接调用浏览器截图，输出 JPEG，质量 90。没有后期合成、修图或变更物理状态来替换画面。
- 捕获时未开启视频、trace 画面采集或软件 GPU。各页均观察到原生 WebGPU 提交，页面、控制台、GPU 与网络错误记录为空；截图之后逐张检查了构图与界面。

## 图片与场景

| 图片                                                                   | 来源页面                                                      | 捕获状态                                                |
| ---------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------- |
| [01-impulse-garden.jpg](./01-impulse-garden.jpg)                       | [刚体花园](../../../examples/physics/rapier3d.html)           | 暂停并重建，29 枚骨牌完整直立。                         |
| [02-material-atelier.jpg](./02-material-atelier.jpg)                   | [材质实验室](../../../examples/physics/rapier_materials.html) | 四分之一速重新释放，在首次回弹与滑行出现差异时暂停。    |
| [03-kinetic-engine.jpg](./03-kinetic-engine.jpg)                       | [动力机械](../../../examples/physics/rapier_joints.html)      | 电机约 −14.7 rpm，曲柄滑块与双摆弹簧机构运行后暂停。    |
| [04-marble-works.jpg](./04-marble-works.jpg)                           | [弹珠工坊](../../../examples/physics/rapier2d_marble.html)    | 30 颗弹珠、210 分、6 次传感通过，球流分布在轨道和钉阵。 |
| [05-clockwork-courier-route.jpg](./05-clockwork-courier-route.jpg)     | [机械信使](../../../examples/physics/rapier_character.html)   | 自动越阶后到达斜坡入口，保留配送路线全景。              |
| [05-clockwork-courier-detail.jpg](./05-clockwork-courier-detail.jpg)   | [机械信使](../../../examples/physics/rapier_character.html)   | 起点近景，展示镜片、关节与机身细节。                    |
| [06-suspension-atelier-loaded.jpg](./06-suspension-atelier-loaded.jpg) | [悬索桥](../../../examples/physics/rapier_bridge.html)        | 两件重物共 6.4 kg，70 个约束，跨中挠度约 237 mm。       |
| [05-clockwork-courier-mobile.jpg](./05-clockwork-courier-mobile.jpg)   | [机械信使](../../../examples/physics/rapier_character.html)   | 手机近景，展示触屏方向与动作按钮。                      |
| [06-suspension-atelier-mobile.jpg](./06-suspension-atelier-mobile.jpg) | [悬索桥](../../../examples/physics/rapier_bridge.html)        | 手机全景，两件重物共 6.4 kg，跨中挠度约 245 mm。        |

这些读数描述各张截图捕获的瞬间，不是稳定平衡值或跨运行确定性保证。图片总大小为 3,144,283 bytes。
