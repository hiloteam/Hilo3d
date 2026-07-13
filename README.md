# Hilo3d

English | [简体中文](./README_ZH.md)

**A WebGPU-first, TypeScript-first 3D engine with a production WebGL 2 compatibility backend.**

Hilo3d vNext is designed around explicit render passes, reusable GPU resources, GLSL ES 3.00,
physically based rendering, and glTF. It gives WebGPU a modern command-recording path without
maintaining a second shader language or giving up WebGL 2 reach.

[![npm](https://img.shields.io/npm/v/hilo3d.svg?style=flat-square)](https://www.npmjs.com/package/hilo3d)
[![CI](https://img.shields.io/github/actions/workflow/status/hiloteam/Hilo3d/npm_test.yml?style=flat-square)](https://github.com/hiloteam/Hilo3d/actions/workflows/npm_test.yml)
[![license](https://img.shields.io/npm/l/hilo3d.svg?style=flat-square)](./LICENSE)

- WebGPU records resource-ready scene, target, and present passes into one application command
  encoder and one queue submission.
- WebGL 2 implements the same renderer, render-target, shader, and resource contracts.
- GLSL ES 3.00 is the only shader source; WebGPU translates resolved variants through Naga.
- Backend failures are explicit. Hilo3d never silently changes the backend you requested.

## Install

```sh
npm install hilo3d
```

The package has one ESM entry point for modern bundlers and native browser ESM. WebGL 1, CommonJS,
UMD, and global-script builds are not part of the vNext contract.

## WebGPU quick start

`Stage.create()` waits for the adapter, device, lazy Naga compiler, and initial render resources, so
the returned stage is ready to render.

```ts
import * as Hilo3d from 'hilo3d';

const camera = new Hilo3d.PerspectiveCamera({ aspect: innerWidth / innerHeight, z: 4 });

const stage = await Hilo3d.Stage.create({
    backend: 'webgpu',
    container: document.querySelector('#app')!,
    camera,
    width: innerWidth,
    height: innerHeight
});

const box = new Hilo3d.Mesh({
    geometry: new Hilo3d.BoxGeometry(),
    material: new Hilo3d.PBRMaterial({
        baseColor: new Hilo3d.Color(0.832, 0.119, 0.093)
    })
}).addTo(stage);

stage.addChild(new Hilo3d.AmbientLight({ amount: 1 }));

const ticker = new Hilo3d.Ticker(60);
ticker.addTick(stage);
ticker.start();
```

Requesting `backend: 'webgpu'` never falls back. An unavailable adapter, insufficient required
features or limits, shader compiler initialization failure, or device creation error rejects
`Stage.create()`. If an application wants WebGL 2 as a fallback policy, it must catch that error and
make a second, explicit `Stage.create({ backend: 'webgl2', ... })` request.

## WebGL 2 compatibility

Use the compatibility backend without changing scene, material, render-target, or GLSL code:

```ts
const stage = await Hilo3d.Stage.create({
    backend: 'webgl2',
    container: document.querySelector('#app')!,
    camera
});
```

Omitting `backend` selects the documented `webgl2` default. Hilo3d never creates a WebGL 1 context.

## Capability matrix

| Capability               | WebGPU                                                        | WebGL 2                                          |
| ------------------------ | ------------------------------------------------------------- | ------------------------------------------------ |
| Shader input             | GLSL ES 3.00 → Naga → WGSL                                    | GLSL ES 3.00 directly                            |
| Multi-pass `renderFrame` | One encoder/submit for resource-ready renderer passes         | Ordered immediate execution                      |
| Native-object reuse      | Pipeline, bind group, buffer, texture, sampler, command state | Program, VAO, buffer, texture, sampler, GL state |
| Incremental uploads      | UBO/geometry dirty ranges; texture revisions                  | UBO/geometry dirty ranges; texture revisions     |
| Render targets           | MRT, 1×/4× MSAA, sampled attachments, async readback          | Same contract                                    |
| Engine rendering         | PBR, shadows, instancing, glTF, post-processing, picking      | Same contract                                    |
| Loss handling            | Device reacquisition and resource recovery                    | Context restoration and resource recovery        |
| Unsupported backend      | Rejects explicitly; no fallback                               | Rejects explicitly; no WebGL 1 fallback          |

## One frame, multiple passes

Use `renderFrame()` for an application-owned frame graph. On WebGPU, resource-ready scene, target,
and present calls in the callback share one application command encoder and finish with at most one
application submission. WebGL 2 executes the same commands in order through the same backend-neutral
facade.

```ts
const reflectionTarget = renderer.createRenderTarget({
    width: renderer.width,
    height: renderer.height
});
const sceneTarget = renderer.createRenderTarget({ width: renderer.width, height: renderer.height });

renderer.renderFrame(frame => {
    frame.renderToTarget(reflectionTarget, stage, reflectionCamera);
    frame.renderToTarget(sceneTarget, stage, camera, true);
    frame.present(sceneTarget);
});
```

Resize application-owned targets when the renderer size changes. Use this frame callback from a
custom tick instead of also letting `Stage` perform its default render. The callback is synchronous:
do not return a Promise or retain its `frame` facade. Settle scene transforms, material values,
`GeometryData`, and texture updates before entering it; geometry and texture content cannot change
after first use in the same frame. Cold texture mipmap preparation and explicit readback are
separate GPU work and are not counted as application-pass submission. Run renderer
resize/`setRenderTarget()`/resource release/destruction and render-target
resize/readback/destruction outside the callback; attempting those operations while WebGPU is
recording aborts the entire frame and prevents a partial submission.

## Modern renderer architecture

- `src/renderer/common` owns backend-neutral frame planning, traversal, render-target contracts,
  std140 uniform buffers, and deterministic resource ownership.
- `src/renderer/webgpu` owns command encoding, pipelines, bind groups, buffers, textures,
  presentation, and device lifecycle.
- `src/renderer/webgl` owns WebGL programs, VAOs, buffer/texture/sampler/UBO managers, the texture
  uploader, context state, framebuffer integration, presentation, and context lifecycle.

Every engine shader starts as GLSL ES 3.00. WebGL 2 compiles it directly. WebGPU resolves the shader
variant, rewrites its active interface to Vulkan GLSL 4.50, and passes it through the Naga WASM
frontend to produce WGSL. Engine utility passes use the same path; there is no handwritten fallback
WGSL shader set.

Shader variants use a structured, type- and length-delimited dual-lane 64-bit hash without an
intermediate serialized key. Exact fields are retained for collision checks, so a collision receives
a deterministic bucket key instead of aliasing another shader. Device/context-scoped pipeline,
bind-group, GPU-resource, and command-state caches avoid redundant creation and binding. Backend
managers enforce access-order LRU bounds for render variants, WebGPU sampler descriptors,
per-texture sampler snapshots, and numeric-depth shader specializations. The shared resource manager
tracks ownership and provides deterministic release.

Texture identity is backend-neutral: the shared object stores CPU content, immutable update
snapshots, and monotonic revisions only. Each WebGL context and WebGPU device owns its native
allocations and upload cursor. WebGL descriptor snapshots preserve stable native objects across
framebuffer resize/reset; WebGPU defers destruction of buffers and textures referenced by a pending
submission. Internal lifecycle observers release every backend allocation before cancellable public
events run, including device/context loss and explicit resource release. WebGL sampler variants are
immutable, bounded, and bound per texture unit, so one depth texture can be read numerically and
through a comparison sampler in the same draw without mutating global texture state.

Render-target owners track attachment allocation generations on both backends. Texture target
changes, failed uploads, and explicit attachment destruction invalidate the previous allocation; the
target rebuilds or reattaches before reuse and rejects stale native handles.

Uniform buffers, dynamic geometry, and textures carry backend-local revisions. Both backends upload
only merged UBO and geometry dirty ranges when allocation shape is stable, while textures replay
immutable subresource-update snapshots from the required revision. WebGPU command-state caching also
suppresses repeated pipeline, bind-group, vertex/index buffer, viewport, and stencil commands within
a pass.

## Custom GLSL and UBO contract

Numeric shader data belongs in registered std140 blocks. Samplers are the only uniforms allowed
outside blocks.

```ts
Hilo3d.registerUniformBlockBinding('EffectBlock');
const effectLayout = Hilo3d.createStd140Layout({ tint: 'vec4' });
const effectBlock = Hilo3d.UniformBuffer.fromSchema(effectLayout, {
    tint: [0.6, 0.8, 1, 1]
});

const material = new Hilo3d.ShaderMaterial({
    attributes: { a_position: 'POSITION' },
    uniformBlocks: { EffectBlock: effectBlock },
    vs: `#version 300 es
layout(std140) uniform EffectBlock { vec4 tint; };
in vec3 a_position; out vec4 v_tint;
void main() { v_tint = tint; gl_Position = vec4(a_position, 1.0); }`,
    fs: `#version 300 es
precision highp float;
in vec4 v_tint; layout(location = 0) out vec4 outColor;
void main() { outColor = v_tint; }`
});

effectBlock.set('tint', [1, 0.5, 0.2, 1]);
```

Use `in`/`out`, `texture()`, and explicit fragment outputs. Register each custom block before first
use, keep same-name block layouts identical across stages, and use flat schemas of scalars, vectors,
matrices, or fixed arrays.

## Device and resource lifecycle

WebGPU device loss emits `webgpuDeviceLost`, reacquires an equivalent adapter/device with the frozen
requirements, revalidates features and limits, rebuilds device-owned managers and caches, restores
render-target resources without changing their public object identity, and emits
`webgpuDeviceRestored`. Frames are skipped while recovery is active. Terminal recovery emits
`webgpuDeviceRecoveryFailed`; later renders throw that error and the renderer never switches to
WebGL 2. `releaseGPUResources()` clears owned GPU state while leaving the renderer reusable.

## Documentation

- [API documentation](https://hilo3d.js.org/docs/)
- [Example gallery](https://hilo3d.js.org/examples/list.html)
- [glTF viewer](https://hilo3d.js.org/examples/glTFViewer/index.html)
- [vNext renderer engineering record](./ENGINEERING_MODERNIZATION.md#双后端渲染与-shader-abi)
- [ShaderMaterial migration guide](./ENGINEERING_MODERNIZATION.md#shadermaterial-迁移)
- [Breaking changes](./CHANGELOG.md#breaking-changes)
- [Contributing](./.github/CONTRIBUTING.md)
