# Rendering and performance

The production path is:

```text
World components -> RenderExtractionSystem -> RenderWorld -> Renderer -> Render Graph -> RHI
```

WebGL2 and WebGPU consume the same RenderWorld. Do not traverse Entity hierarchy in rendering code
or branch gameplay components by backend.

Performance rules:

- reuse Geometry, Material, Texture, queries, stores, and scratch arrays;
- mutate `TransformStore` and change-tracked components instead of reconstructing Entities;
- keep static transforms and render records clean;
- batch structural churn through commands;
- inspect World/RenderWorld/Renderer diagnostics before optimizing;
- retain sparse-set storage unless an enrolled benchmark identifies query indirection as the main
  bottleneck.

Renderer-level render-target work receives renderer-owned extracted views:

```ts
const renderWorld = world.getResource(Hilo3d.RENDER_WORLD);
const camera = renderWorld.cameras.get(world.entityIndex(cameraEntity));
renderer.renderToTarget(target, renderWorld, camera);
const pixels = await target.readColorAttachment();
```

Use `engine.frame(world, dt)` for ordinary presentation so successful submissions commit transform
history and failure paths roll back. Direct renderer calls are for explicit render-target tooling.

Custom raster shaders use GLSL ES 3.00, registered std140 uniform blocks, and the managed texture UV
normalization helpers. Test WebGL2 compile/link, Naga translation, and WebGPU pipeline creation.
