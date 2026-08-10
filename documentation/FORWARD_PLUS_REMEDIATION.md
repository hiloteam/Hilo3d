# Forward+、Clustered、Hi-Z 与批处理整改规范

本文记录 2026-08 对 WebGPU high-end
profile、普通 Forward 实例批处理和相关验证证据的代码审查结论，并定义一次性整改后的生产合同。它是当前实现的验收清单；长期功能扩展仍以
[`MODERN_WEBGPU_RENDERING_ROADMAP.md`](./MODERN_WEBGPU_RENDERING_ROADMAP.md) 为准。

## 目标与边界

整改后的 high-end profile 必须继续遵守以下架构边界：

- 场景、深度、Hi-Z、cluster、HDR、兼容绘制和最终显示都通过同一个 Render Graph 与 RHI；
- WebGPU-only 能力继续在创建阶段 fail closed，不添加 WebGL 2 模拟路径；
- GPU Scene 可见性与 cluster light membership 不通过 CPU readback 决定；
- ordinary Forward 和 clustered storage PBR 对同一个材质必须拥有相同的逐贴图 slot 语义；
- 透明绘制严格保持全局 back-to-front 顺序，实例化不能改变混合结果；
- frustum、LOD 和 Hi-Z 使用的 bounds 必须保守，不能产生 false-negative visibility；
- 预算溢出必须保留确定性的 light membership，不能依赖 GPU invocation 调度顺序；
- fallback mesh 必须在共同的 linear HDR composition 中完成，不能在 display transform 后混入；
- 性能验收同时报告 CPU record/submit 与 GPU completion，不用逐帧 `waitForIdle()` 结果冒充吞吐。

## 问题、整改方案与验收

| 编号   | 问题                                                                                      | 整改方案                                                                                                                                                                 | 验收证据                                                      |
| ------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| FPC-01 | GPU PBR record 只保存 base-color/normal UV，其他 slot 丢失 transform、encoding 和 channel | storage record 保存全部内置 PBR slot 的 UV matrix、UV set、encoding 与 channel；clustered shader 使用与 ordinary Forward 等价的采样函数                                  | 逐 slot transform/encoding/channel 单元测试与 shader 源码契约 |
| FPC-02 | direct 与 instanced draw 分组提交，透明和显式 `renderOrder` 跨组失序                      | planner 输出统一的 ordered draw item；Forward、Offscreen、Scriptable 全部消费同一顺序                                                                                    | 混合 direct/batch 的 opaque、transparent 执行顺序测试         |
| FPC-03 | 无覆盖 depth tile 被当作完整 Z 范围，浪费全局 light-index 预算                            | 无覆盖 tile 写入 invalid range，count/write 统一跳过                                                                                                                     | 空 tile + 极小预算测试                                        |
| FPC-04 | light-centric atomic write 在截断时保留不确定的 light identity                            | bounded allocation 先以 sentinel 初始化，再用确定性的 `atomicMin` 插入链只保留最低稳定 light id；overflow 统计保持显式                                                   | 重复帧 membership 一致性测试                                  |
| FPC-05 | 近面/相机后方中心的局部光投影可能漏 tile                                                  | 完全位于相机后的球先剔除；与 near plane 相交的 sphere/cone 使用全屏保守 bounds                                                                                           | near-plane crossing light 测试                                |
| FPC-06 | directional light 被复制到每个 cluster；AreaLight 被按点光计算；shadow light 静默丢阴影   | directional light 使用独立全局列表；尚无 native LTC/shadow-atlas 采样时，AreaLight 或启用 shadow 的 light 明确触发整相机 ordinary Forward fallback                       | directional index、AreaLight 与 shadow-light 兼容路径测试     |
| FPC-07 | temporal Hi-Z 允许小幅移动对象只测试 previous bounds                                      | 只有 bounds 与 transform 均未变化的对象使用 previous-frame Hi-Z；动态对象至少跳过一帧                                                                                    | 小幅横移 disocclusion 测试                                    |
| FPC-08 | object sphere 不观察 position revision，且只覆盖 base LOD                                 | logical bucket 预计算所有 LOD 的保守 union sphere；position revision 变化时刷新 bounds 和 object record                                                                  | 动态 geometry 与 oversized LOD 测试                           |
| FPC-09 | high-end path 每帧执行两到三次完整 CPU scene plan/traversal                               | scriptable context 提供只更新 scene/camera transforms 的内部入口；GPU Scene 单次遍历同时收集 GPU records、fallback 和 lights；有 fallback 时只额外构建一次 renderer list | planner/traversal 计数架构测试                                |
| FPC-10 | 固定六张 Hi-Z texture 覆盖到 64 px，资源和剔除收益受限                                    | pyramid level 数按最大 viewport 规划；历史使用单 texture mip chain/subresource view 能力成熟前，至少完整覆盖 viewport 并按实际 level 绑定                                | 大于 64 px occluder/object 覆盖测试与资源上限测试             |
| FPC-11 | fallback 在 tone map/display 后绘制                                                       | compatible 与 fallback opaque/transparent 都写 linear HDR scene color/depth，再统一执行 Bloom/Color display                                                              | fallback 与 GPU Scene 同曝光/色调映射像素测试                 |
| FPC-12 | Bloom blur 把水平和垂直核混为不对称单 pass，强度为零仍分配和执行                          | 使用独立 horizontal/vertical pass；`bloomStrength: 0` 专门化 display shader 并省略 Bloom texture/pass                                                                    | 旋转对称与零强度 graph/shader 契约测试                        |
| FPC-13 | visible table 按 object × physical bucket 分配                                            | 使用单一 compact index table，bucket 通过 prefix offset 写入自己的连续区间；容量与 `maxObjects` 同阶                                                                     | buffer requirement 与多 bucket 规模测试                       |
| FPC-14 | ordinary WebGPU batch 每帧清空并求逆全部 normal matrix                                    | batch compiler 按 mesh identity 与 world-matrix revision 缓存 inverse-transpose normal matrix；model/previous 仍按提交事务逐帧打包                                       | 静止 batch 无 normal-matrix 重算诊断测试                      |
| FPC-15 | 规模测试逐帧 idle 且无阈值，不构成性能证据                                                | warm-up 后连续提交采样 CPU frame record；GPU completion 单独测量；性能工作流使用已登记 baseline 和 percentile                                                            | fixture 字段、无逐帧 idle、benchmark protocol 检查            |

## 实现顺序

1. 先完成 FPC-01～FPC-08，封闭所有已知错误画面和非保守剔除。
2. 再完成 FPC-09～FPC-14，减少重复 CPU/GPU 工作和无界内存放大。
3. 最后完成 FPC-15 与浏览器像素覆盖，形成可复现证据。

任何阶段不得通过放宽测试、覆盖不可达代码、吞掉 validation error 或降低现有 portable Forward/WebGL
2 行为来取得通过结果。

## 完成定义

- `npm run typecheck`、`npm run lint`、targeted Vitest 全部通过；
- renderer/Render Graph/RHI 改动通过 `npm run test:render:architecture` 与 `npm run test:rhi`；
- storage shader 与 WebGPU pipeline 通过 `npm run test:webgpu`；
- affected WebGPU UI/visual fixtures 通过；
- 本文全部编号有实现和自动化证据，未完成项不得描述为已修复。
