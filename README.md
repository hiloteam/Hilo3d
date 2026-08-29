<div align="center">
  <img src="./website/assets/hilo3d-logo.png" width="320" alt="Hilo3D" />

  <p><strong>A modern Web graphics engine for production 2D and 3D experiences.</strong></p>

  <p>
    A portable RHI, validated Render Graph, and Scriptable Render Pipeline<br />
    power one shared renderer for WebGPU and WebGL 2.
  </p>

  <p>
    <a href="https://hilo3d.js.org/"><strong>Website</strong></a> ·
    <a href="https://hilo3d.js.org/examples/list.html">Examples</a> ·
    <a href="https://hilo3d.js.org/docs/">Documentation</a> ·
    <a href="https://hilo3d.js.org/docs/modules/Hilo3d.html">API</a> ·
    <a href="./README_ZH.md">简体中文</a>
  </p>

  <p>
    <a href="https://www.npmjs.com/package/hilo3d"><img src="https://img.shields.io/npm/v/hilo3d.svg?style=flat-square" alt="npm version" /></a>
    <a href="https://github.com/hiloteam/Hilo3d/actions/workflows/npm_test.yml"><img src="https://img.shields.io/github/actions/workflow/status/hiloteam/Hilo3d/npm_test.yml?style=flat-square" alt="CI status" /></a>
    <a href="https://github.com/hiloteam/Hilo3d/blob/dev/LICENSE"><img src="https://img.shields.io/npm/l/hilo3d.svg?style=flat-square" alt="MIT license" /></a>
  </p>
</div>

> Hilo3D 2.0 is currently in alpha. Existing projects should review the
> [breaking changes](./CHANGELOG.md#breaking-changes) before upgrading.

## Why Hilo3D

Hilo3D keeps high-level scene authoring and low-level GPU control in the same engine. Applications
use one scene, material, render-target, and shader contract while the renderer selects a native
WebGPU path or a production WebGL 2 compatibility path.

- **One renderer, two backends** — `auto` prefers compatible WebGPU and uses WebGL 2 when WebGPU is
  unavailable. Explicit backend requests never change silently.
- **Modern materials and output** — glTF 2.0, layered PBR, HDR lighting, Bloom, automatic exposure,
  filmic tone mapping, transmission, volume, iridescence, clearcoat, and anisotropy.
- **2D and 3D together** — scene graph, meshes, animation, cameras, lights, shadows, sprites, text,
  batching, picking, and layered multi-camera composition.
- **GPU-driven rendering** — instancing and multi-pass rendering across both backends, plus a WebGPU
  high-end profile with GPU Scene culling/LOD, Hi-Z, indirect buckets, and Clustered Forward+.
- **Stable high-end lighting** — TAA/TAAU, dynamic resolution, GTAO, SSR, SSGI, froxel volumetrics,
  physical atmosphere, temporal clouds, cloud shadows, and eye adaptation.
- **A frame you can shape** — a validated Render Graph and scriptable render pipeline coordinate
  shadows, scene passes, post-processing, render targets, readback, and presentation.
- **Production lifecycle** — bounded GPU caches, incremental uploads, explicit resource ownership,
  and recovery from WebGPU device loss or WebGL context loss.

## Install

```sh
npm install hilo3d
```

Hilo3D is ESM-only. It targets modern browsers with WebGPU or WebGL 2; WebGL 1 and legacy global
builds are outside the 2.0 contract.

## Build games with Codex

The standalone
[`hilo3d-game` Agent Skill](https://github.com/hiloteam/Hilo3d/tree/dev/skills/hilo3d-game) helps
Codex plan, scaffold, implement, debug, and optimize Hilo3D 2D, 3D, and hybrid browser games. It
uses the published `hilo3d` package and is kept outside `.agents/skills` so it is distributed from
this repository without becoming guidance for contributors working on the engine itself.

## Create your first scene

```ts
import * as Hilo3d from 'hilo3d';

const camera = new Hilo3d.PerspectiveCamera({
    aspect: innerWidth / innerHeight,
    z: 4
});

const stage = await Hilo3d.Stage.create({
    backend: 'auto',
    container: document.querySelector('#app')!,
    camera,
    width: innerWidth,
    height: innerHeight
});

new Hilo3d.Mesh({
    geometry: new Hilo3d.BoxGeometry(),
    material: new Hilo3d.PBRMaterial({
        baseColor: new Hilo3d.Color(0.83, 0.12, 0.09)
    })
}).addTo(stage);

stage.addChild(new Hilo3d.AmbientLight({ amount: 1 }));

const ticker = new Hilo3d.Ticker(60);
ticker.addTick(stage);
ticker.start();
```

`Stage.create()` is asynchronous because backend selection and GPU initialization are asynchronous.
Use `backend: 'webgpu'` or `backend: 'webgl2'` when an application requires a specific backend.

## See the engine in motion

<table>
  <tr>
    <td width="33.33%"><a href="https://hilo3d.js.org/examples/bloom.html?backend=webgpu"><img src="./website/assets/example-bloom.webp" alt="HDR Bloom example" /></a></td>
    <td width="33.33%"><a href="https://hilo3d.js.org/examples/gltf_material_extensions.html"><img src="./website/assets/example-gltf-materials.webp" alt="glTF material extensions example" /></a></td>
    <td width="33.33%"><a href="https://hilo3d.js.org/examples/compute_raytracing.html?backend=webgpu"><img src="./website/assets/example-compute-raytracing.webp" alt="Compute path tracing example" /></a></td>
  </tr>
  <tr>
    <td><strong>HDR Bloom</strong><br />Compute-driven light shaped through the engine post-processing pipeline.</td>
    <td><strong>glTF material extensions</strong><br />Layered Khronos assets on the shared WebGPU and WebGL 2 renderer.</td>
    <td><strong>Compute path tracing</strong><br />Progressive WebGPU tracing with denoising, caustics, and HDR output.</td>
  </tr>
</table>

[Browse the complete example gallery →](https://hilo3d.js.org/examples/list.html)

## Modern rendering stack

The opt-in WebGPU high-end profile is built on the same Scene, Material, Render Graph, and RHI
contracts as the portable renderer. Unsupported devices fail capability checks before the runtime is
created; compatible meshes that are outside the native GPU Scene slice remain on the shared Forward
path and compose into the same linear HDR frame.

| System                  | Current production slice                                                                                                                  |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| GPU Scene               | Dirty object/material databases, previous-frame Hi-Z occlusion, projected-radius LOD, compact visible ranges, and fixed indirect buckets  |
| Clustered Forward+      | Depth-driven 3D clusters, bounded deterministic light allocation, storage PBR, shared directional/spot/point shadows, and LTC area lights |
| Shadow caching          | Stable atlas tiles, exact per-slice invalidation, scissored depth clears, transactional reuse, and recovery-aware diagnostics             |
| Temporal rendering      | Motion vectors, authored reactive masks, native TAA, 0.5–1.0 TAAU, and timestamp-driven dynamic resolution                                |
| Screen-space lighting   | Portable GTAO and SSGI on WebGPU/WebGL 2, plus WebGPU Clustered hierarchical SSR                                                          |
| Volumetrics and weather | Froxel height/local fog, directional/point/spot injection, physical atmosphere LUTs, temporal clouds, and cloud shadows                   |
| HDR display             | GPU histogram exposure, asymmetric eye adaptation, Bloom, and configurable filmic display transforms                                      |

Explore the
[Clustered Sponza lab](https://hilo3d.js.org/examples/clustered_forward_plus_sponza.html),
[Temporal Observatory](https://hilo3d.js.org/examples/temporal_aa_observatory.html),
[Silent Dragon GTAO](https://hilo3d.js.org/examples/ground_truth_ambient_occlusion.html),
[Afterimage SSR](https://hilo3d.js.org/examples/screen_space_reflections_palace.html),
[Prismatic Vespers SSGI](https://hilo3d.js.org/examples/screen_space_global_illumination_chapel.html),
[Neon Reliquary volumetrics](https://hilo3d.js.org/examples/volumetric_neon_reliquary.html), and
[Stormfront Observatory](https://hilo3d.js.org/examples/stormfront_observatory.html).

See the [modern WebGPU rendering roadmap](./documentation/MODERN_WEBGPU_RENDERING_ROADMAP.md) for
the exact completed boundaries, remaining compatibility paths, and future streaming/virtualization
work.

## Rendering profiles

|                      | Portable profile                                              | WebGPU high-end profile                                                      |
| -------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Backend              | WebGPU and WebGL 2                                            | WebGPU                                                                       |
| Scene and materials  | Shared scene graph, PBR materials, glTF, sprites, text        | The same public model with registered PBR buckets and Forward fallback       |
| Frame composition    | Render Graph, render targets, MRT, MSAA, post-processing      | The same graph with GPU Scene, clustered lighting, and native compute        |
| Lighting and quality | Forward PBR, shadows, GTAO, SSGI, TAA/TAAU, Bloom, Color Uber | Adds Hi-Z SSR, dynamic resolution, froxels, atmosphere/clouds, auto exposure |
| GPU workloads        | Instancing, uniform buffers, incremental resource uploads     | Compute, storage buffers/textures, indirect GPU workflows                    |
| Shader path          | Authored GLSL ES 3.00                                         | Raster GLSL → Naga → WGSL; validated direct WGSL compute                     |
| Recovery             | WebGL context restoration or WebGPU resource rebuild          | WebGPU device reacquisition with submission-aware history rebuild            |

Unsupported WebGPU-only features fail capability checks on WebGL 2 instead of being partially
emulated.

## Architecture at a glance

```text
Scene · Materials · 2D · Animation · Lights
                    │
              Shared Renderer
                    │
    Render Graph · Scriptable Render Pipeline
                    │
               Portable RHI
              ┌─────┴─────┐
           WebGPU       WebGL 2
```

The shared renderer owns scene collection, culling, sorting, instancing, shadows, post-processing,
draw preparation, and resource coordination. Production frames flow through the Render Graph and
portable RHI; backend code remains responsible only for native API execution.

Raster shaders have one GLSL ES 3.00 source of truth. WebGL 2 compiles that source directly, while
the WebGPU path preprocesses it for Naga and produces WGSL. WebGPU-only compute uses the engine's
validated `ComputeShader` contract.

Read the [rendering architecture](./documentation/RENDERING_ARCHITECTURE.md) for the complete frame,
resource, shader, and recovery contracts.

## Documentation

- [Getting started and API documentation](https://hilo3d.js.org/docs/)
- [Example gallery](https://hilo3d.js.org/examples/list.html)
- [`hilo3d-game` Agent Skill](https://github.com/hiloteam/Hilo3d/tree/dev/skills/hilo3d-game)
- [Engineering documentation index](./documentation/README.md)
- [Rendering architecture](./documentation/RENDERING_ARCHITECTURE.md)
- [PBR, HDR, and post-processing](./documentation/PBR_AND_POST_PROCESSING.md)
- [Modern WebGPU rendering roadmap](./documentation/MODERN_WEBGPU_RENDERING_ROADMAP.md)
- [Material system modernization](./documentation/MATERIAL_SYSTEM_MODERNIZATION.md)
- [Temporal rendering](./documentation/TEMPORAL_RENDERING_REMEDIATION.md)
- [Screen-space global illumination](./documentation/SCREEN_SPACE_GLOBAL_ILLUMINATION.md)
- [Froxel volumetric lighting](./documentation/VOLUMETRIC_LIGHTING.md)
- [Physical atmosphere and weather](./documentation/PHYSICAL_ATMOSPHERE_AND_WEATHER.md)
- [2D rendering and multi-camera composition](./documentation/2D_RENDERING.md)
- [Scriptable render pipeline](./documentation/SCRIPTABLE_RENDER_PIPELINE_PLAN.md)
- [Breaking changes](./CHANGELOG.md#breaking-changes)

## Develop locally

Requires Node.js 20.19.0 or newer and the npm version declared by the repository.

```sh
npm ci
npm run dev
```

Useful commands:

```sh
npm run examples:dev  # run the example gallery locally
npm run typecheck     # check maintained TypeScript
npm run test          # run the test suite
npm run validate      # run the full release validation
```

See the [contributing guide](./.github/CONTRIBUTING.md) before opening a pull request.

## License

[MIT](./LICENSE) © Hilo3D contributors.
