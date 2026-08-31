# Hilo3D production rendering architecture

Status: current production contract

## Frame ownership

```text
Engine.frame(world, dt)
  -> World input/fixed/update/animation/transform phases
  -> RenderExtractionSystem
  -> renderer-owned RenderWorld
  -> Renderer / RenderPipelineHost
  -> RenderGraphFrame (setup -> compile -> prepare -> execute)
  -> portable RHI
  -> WebGPU or WebGL 2
```

`Engine` owns the Canvas, Renderer, presentation, resize policy, recovery, and frame submission.
`World` owns Entity/component/System state and can update without a graphics device. They are
created independently through asynchronous factories where initialization can fail.

`RenderExtractionSystem` is the only ordinary scene-data entry into the Renderer. It resolves
component composition and writes dense renderer-local stores:

- stable render IDs and retirement queues;
- packed current/previous matrices and world-space culling spheres;
- Geometry, Material, visibility, layers, order, skin, morph, and sprite data;
- dense camera and light views;
- explicit render extensions.

Renderer code never searches Entity hierarchy, invokes gameplay callbacks, or resolves component
maps. WebGPU GPU Scene and WebGL 2 CPU lists consume this same extraction.

## Incremental extraction

Component stores that feed rendering expose bounded changed-Entity queues. Transform maintains a
separate dirty-subtree queue and reports exactly which world matrices changed. Extraction therefore
does no full scene scan after structure stabilizes.

A render record is created only when the Entity has `LocalTransform + MeshRenderer` (or an
equivalent sprite record), retains its ID while that composition remains live, and is retired at the
next renderer submission boundary. Bounds are recomputed only when Geometry or world transform
changes and are stored as packed `x, y, z, radius` values.

Current transform history becomes previous history only after a valid submission. Graph validation,
prepare, or execution failure leaves pending history and frame-local cache revisions uncommitted.

## Shared renderer and Render Graph

`Renderer` is the public low-level graphics entry. `Engine` is the normal ECS composition root. Both
production backends use the same:

- scene culling, sorting, instancing, draw planning, shadows, and post-processing;
- Render Pipeline host and Render Graph builder/compiler/executor;
- material/shader reflection and semantic uniform blocks;
- render-target, readback, storage, upload, cache, and retirement services;
- device/context-loss recipes and public resource identities.

Render Graph phases remain strict:

1. `setup` declares resources, accesses, and dependencies.
2. validation and compilation finish before an RHI frame begins.
3. `prepare` creates reusable backend objects without issuing commands.
4. `execute` emits commands.
5. cache/resource revisions commit only after successful submission.

Resource destruction is submission-aware. Recovery invalidates the old device generation and
rebuilds backend objects from backend-neutral recipes.

## Portable RHI

RHI core exposes backend-neutral descriptors and capabilities only; native `GPU*` and `WebGL*`
objects remain inside backend or checked extension boundaries. Ordinary render, render-target,
readback, and presentation work cannot bypass Render Graph or RHI.

The public backends are exactly:

- `webgpu`: deferred command encoding, graphics and compute, storage, indirect workloads;
- `webgl2`: immediate graphics execution with unsupported compute/storage contracts rejected.

`auto` probes WebGPU first and falls back to WebGL 2. An explicit WebGPU request never silently
falls back.

## Shader ABI

Portable raster shaders have one GLSL ES 3.00 source of truth. Engine preprocessing produces Vulkan
GLSL 4.50 and Naga produces WGSL for WebGPU. There is no parallel hand-authored portable raster WGSL
tree.

Non-sampler portable data is registered std140 uniform-block data. GLSL samplers are the only
classic uniforms. Direct WGSL is reserved for `ComputeShader`; storage-aware raster uses the
constrained readonly-std430 `StorageGraphicsShader` path.

All managed 2D textures use top-left logical UVs and cross exactly one normalization boundary
through `hiloTextureUV()` or `hiloRenderTargetUV()`.

## Camera composition and output

Camera Entities combine `LocalTransform`, a projection component, and optional `CameraOutput`. The
extracted camera store is priority-sorted by `Engine`. One camera uses the direct path; multiple
cameras record into a single synchronous renderer frame and one submission. Camera clear policy,
visibility mask, viewport, and render target are renderer data, not hierarchy side effects.

## Diagnostics and validation

World diagnostics expose phase timings, fixed-step overload, entity/component/query counts, and
queued commands. Transform and RenderWorld diagnostics expose updated matrix, bounds, component,
structure, and retirement counts. Renderer diagnostics retain upload ranges, draw/dispatch counts,
cache behavior, and recovery state.

Relevant gates are:

```sh
npm run test:render:architecture
npm run test:rhi
npm run test:rhi-benchmark-contract
npm run test:ui:webgl2
npm run test:ui:webgpu
npm run test:webgpu
```

Physical-GPU performance evidence follows the immutable enrolled-rig protocol under
`benchmarks/rhi/`; local SwiftShader smoke is correctness evidence only.
