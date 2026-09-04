<div align="center">
  <img src="./website/assets/hilo3d-logo.png" width="320" alt="Hilo3D" />

  <p><strong>A performance-first TypeScript 3D engine for WebGPU and WebGL 2.</strong></p>

  <p>
    <a href="https://hilo3d.js.org/"><strong>Website</strong></a> ·
    <a href="https://hilo3d.js.org/examples/index.html">Examples</a> ·
    <a href="https://hilo3d.js.org/docs/">API</a> ·
    <a href="./README_ZH.md">简体中文</a>
  </p>
</div>

> Hilo3D 2.0 is in alpha and intentionally breaks the former object-scene API. See the
> [breaking changes](./CHANGELOG.md#breaking-changes).

## Why Hilo3D

Hilo3D combines a lightweight data-oriented ECS with one shared renderer, a validated Render Graph,
and a portable RHI.

- Entity composition is direct: render, physics, interaction, and gameplay components can live on
  the same generation-safe Entity.
- Transform, hierarchy, render records, culling bounds, animation state, and native physics handles
  use sparse-set or packed SoA storage.
- Cached queries and explicit System phases avoid whole-scene discovery and per-Entity dispatch.
- Render extraction is incremental. WebGPU and WebGL 2 consume the same renderer-owned
  `RenderWorld`.
- `auto` prefers WebGPU and falls back to WebGL 2; an explicit backend request fails clearly.
- The shared renderer owns culling, sorting, instancing, shadows, post-processing, recovery, and
  resource retirement through Render Graph and RHI.

Hilo3D does not use a generic archetype/chunk ECS. JavaScript object components stay in typed sparse
sets, while measured numeric hot paths use dedicated TypedArray SoA stores.

## Install

```sh
npm install hilo3d
```

Hilo3D is strict TypeScript and ESM-only. It supports modern WebGPU and WebGL 2 browsers; WebGL 1
and legacy global builds are outside the contract.

## First scene

```ts
import {
    BasicMaterial,
    BoxGeometry,
    CameraOutput,
    Engine,
    LocalTransform,
    MeshRenderer,
    PerspectiveCamera,
    World,
    createRenderExtractionSystem,
    createTransformSystem
} from 'hilo3d';

const world = await World.create({
    systems: [createTransformSystem(), createRenderExtractionSystem()]
});

const camera = world.createEntity(LocalTransform, { position: [0, 1.5, 5] });
world.add(camera, PerspectiveCamera, {
    fov: 60,
    near: 0.1,
    far: 1000,
    aspect: innerWidth / innerHeight
});
world.add(camera, CameraOutput, { enabled: true });

const cube = world.createEntity(LocalTransform);
world.add(cube, MeshRenderer, {
    geometry: new BoxGeometry(),
    material: new BasicMaterial()
});

const engine = await Engine.create({
    backend: 'auto',
    container: document.querySelector('#app')!,
    width: innerWidth,
    height: innerHeight
});

let previous = performance.now();
function frame(now: number): void {
    engine.frame(world, now - previous);
    previous = now;
    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

`World` can update headlessly. `Engine` owns only Canvas, Renderer, presentation, and graphics
recovery. Destroy both explicitly when their lifetimes end.

Entities are empty by default, so logical and resource-only Entities do not pay for transform
storage. Pass an initial component to `createEntity`; values whose fields are all optional, such as
`LocalTransform`, may omit the empty object.

For physics, add `RigidBody` and `Collider` to the same Entity as `MeshRenderer`; no application
binding table is required.

## Runtime flow

```text
World Systems
  input -> fixed physics -> update -> animation -> transform -> render extraction
                                      |
                                      v
                              packed RenderWorld
                                      |
                                      v
        Shared Renderer -> Render Graph -> portable RHI -> WebGPU / WebGL 2
```

Structural mutations requested during System execution are deferred to explicit synchronization
points. Transform work follows dirty subtrees, and renderer extraction copies only changed records.
Previous transform history is committed only after a valid submission.

## Rendering

Both backends share scene data, material and shader contracts, draw preparation, shadows,
post-processing, render targets, and recovery. Portable raster shaders have one GLSL ES 3.00 source
that is compiled directly for WebGL 2 and translated through Naga for WebGPU. WebGPU-only compute
uses validated WGSL through `ComputeShader`.

See [rendering architecture](./documentation/RENDERING_ARCHITECTURE.md),
[ECS architecture](./documentation/ECS_ARCHITECTURE_MIGRATION_PLAN.md), and the
[engineering index](./documentation/README.md).

## Develop

Requires Node.js 20.19.0 or newer and the npm version declared by this repository.

```sh
npm ci
npm run examples:dev
npm run typecheck
npm run test
npm run validate
```

Generated `docs/`, `dist/`, browser reports, and coverage are not source files.

## License

[MIT](./LICENSE) © Hilo3D contributors.
