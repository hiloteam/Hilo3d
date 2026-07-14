# Hilo3d

English | [简体中文](./README_ZH.md)

**A WebGPU-first, TypeScript-first 3D engine with a production WebGL 2 compatibility backend.**

Hilo3d vNext is designed around a WebGPU-shaped rendering hardware interface (RHI), explicit render
passes, reusable GPU resources, GLSL ES 3.00, physically based rendering, and glTF. WebGPU keeps its
native pipeline/bind-group/command model, while WebGL 2 implements the same portable subset through
immediate, state-cached GL execution.

[![npm](https://img.shields.io/npm/v/hilo3d.svg?style=flat-square)](https://www.npmjs.com/package/hilo3d)
[![CI](https://img.shields.io/github/actions/workflow/status/hiloteam/Hilo3d/npm_test.yml?style=flat-square)](https://github.com/hiloteam/Hilo3d/actions/workflows/npm_test.yml)
[![license](https://img.shields.io/npm/l/hilo3d.svg?style=flat-square)](./LICENSE)

- WebGPURHI is a thin mapping to native WebGPU objects and commands; it does not become a GL-style
  state machine and does not replay a second JavaScript command buffer.
- WebGL2RHI emulates pipeline, bind-group, render-pass, and command-encoder semantics while issuing
  GL calls immediately through a state-diff cache. `finish()`/`submit()` are ownership boundaries,
  not a deferred replay path.
- GLSL ES 3.00 is the only authored shader source. The Renderer shader compiler resolves variants
  and translates WebGPU modules through Naga before the RHI sees them.
- Backend policy is explicit: `auto` performs a capability-based choice, while an explicit `webgpu`
  or `webgl2` request is never changed silently.

## Install

```sh
npm install hilo3d
```

The package has one ESM entry point for modern bundlers and native browser ESM. WebGL 1, CommonJS,
UMD, and global-script builds are not part of the vNext contract.

## WebGPU quick start

`Stage.create()` defaults to `backend: 'auto'`, prefers WebGPU when a compatible adapter is
available, and waits for the selected backend to become ready. The returned stage is ready to
render.

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

Omitting `backend` is equivalent to `backend: 'auto'`. Auto selection calls
`WebGPURenderer.isSupported()` first. This lightweight probe only requests an adapter and validates
the fallback-adapter policy, required features, required limits, and Hilo3d's minimum adapter
limits. It does **not** request a device, acquire a canvas context, initialize Naga, create a
pipeline, or allocate GPU resources. A compatible adapter selects WebGPU; otherwise `Stage.create()`
creates WebGL 2 directly. Supplying the WebGL2-only `preserveDrawingBuffer` option also makes auto
selection choose WebGL 2 directly, as does requesting straight-alpha canvas compositing with
`alpha: true, premultipliedAlpha: false`.

Once the probe selects WebGPU, normal WebGPU initialization runs exactly once. A device or canvas
context error, shader-compiler failure, pipeline/resource initialization error, or any later failure
rejects `Stage.create()` and is never caught as a reason to fall back. Requesting
`backend: 'webgpu'` skips the auto probe and likewise never falls back.

Applications can use the same device- and GPU-resource-free probe without creating a renderer:

```ts
const webgpuSupported = await Hilo3d.WebGPURenderer.isSupported();
```

## WebGL 2 compatibility

Use the compatibility backend without changing scene, material, render-target, or GLSL code:

```ts
const stage = await Hilo3d.Stage.create({
    backend: 'webgl2',
    container: document.querySelector('#app')!,
    camera
});
```

The synchronous `new Stage()` constructor still defaults to WebGL 2 because it cannot await adapter
discovery; use `await Stage.create()` for the WebGPU-first auto policy. Hilo3d never creates a WebGL
1 context.

## Capability matrix

| Capability               | WebGPU                                                        | WebGL 2                                                        |
| ------------------------ | ------------------------------------------------------------- | -------------------------------------------------------------- |
| RHI execution            | Thin native encoder/pass/queue mapping                        | Immediate GL execution behind encoder/pass semantics           |
| Shader module input      | Renderer-prepared WGSL                                        | Renderer-prepared GLSL ES 3.00                                 |
| Multi-pass `renderFrame` | One encoder/submit for resource-ready renderer passes         | Ordered immediate execution; submit never replays commands     |
| Device-object reuse      | Bounded pipeline, layout, and sampler caches                  | Bounded pipeline, layout, sampler, framebuffer, and VAO caches |
| Incremental uploads      | UBO/geometry dirty ranges; texture revisions                  | UBO/geometry dirty ranges; texture revisions                   |
| Render targets           | MRT, 1×/4× MSAA, sampled attachments, async readback          | Same engine contract                                           |
| Unsupported RHI features | Reported through `features`/`limits`; rejected when requested | Compute/storage/1D/async buffer mapping report unsupported     |
| Loss handling            | Device reacquisition and resource recovery                    | Context restoration and resource recovery                      |
| Backend selection        | Explicit requests reject; `auto` uses an adapter-only probe   | Selected directly when the `auto` probe is unsupported         |

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

- `src/renderer/common` owns scene traversal, frame planning, render-target contracts, std140
  uniform data, and deterministic engine-resource ownership.
- `src/shader` owns authored GLSL preprocessing and engine shader variants; `src/renderer/shader`
  prepares backend interfaces, reflects bindings, and performs GLSL-to-WGSL compilation. RHI code
  never knows what a shader variant or material is.
- `src/renderer/webgpu` and `src/renderer/webgl` resolve Mesh, Material, Light, and RenderTarget
  semantics into backend-prepared resources. Their concrete RHI owns the native device,
  context/surface, and lifecycle; renderer managers own engine-resource allocations beneath that
  single owner.
- `src/rhi/RHI.ts` defines the portable WebGPU-shaped device, resource, pipeline, bind-group,
  render-pass, encoder, queue, surface, feature, and limit contracts.
- `src/rhi/webgpu` directly wraps native WebGPU. `src/rhi/webgl` contains the WebGL 2 emulation,
  state cache, framebuffer/VAO ownership, and context recovery. Neither RHI backend imports engine
  scene types.

The abstraction boundary intentionally follows WebGPU rather than the WebGL state machine. A WebGPU
render pass maps one-for-one to its native pass, and a WebGPU command encoder owns the native
encoder directly. WebGL2RHI applies pipeline and bind-group state only when it changes and executes
draw/copy commands during encoding; the returned command buffer is a single-use submission token.
Production WebGPU managers use one-hop native fast paths on that same concrete device, so the main
draw loop keeps native handles and pays no wrapper or virtual-dispatch cost. The production WebGL 2
renderer runs its engine-semantic Program/VAO work in a frame-scoped session backed by the RHI's
single context, canonical state differential, lifecycle, and device-owned sampler cache. Program,
VAO, and framebuffer caches remain renderer-semantic caches; it never creates a parallel context or
a replayable command list. Capabilities that do not have a sound WebGL 2 implementation—including
compute pipelines, storage textures, storage buffers, 1D textures, asynchronous buffer mapping,
base-vertex draws, and first-instance draws—are absent from its `features` or exposed as zero limits
and fail explicitly when requested. Inside the RHI contract, per-format sampling, filtering,
attachment, storage, and MSAA support is reported conservatively, including extension/tier-dependent
differences.

Every engine shader starts as GLSL ES 3.00. WebGL 2 compiles it directly. WebGPU resolves the shader
variant, rewrites its active interface to Vulkan GLSL 4.50, and passes it through the Naga WASM
frontend to produce WGSL. Engine utility passes use the same path; there is no handwritten fallback
WGSL shader set.

Shader variants use a structured, type- and length-delimited dual-lane 64-bit hash without an
intermediate serialized key. Exact fields are retained for collision checks, so a collision receives
a deterministic bucket key instead of aliasing another shader. Cache ownership is deliberately
single-layered: each RHI device owns bounded immutable sampler, bind-group-layout, pipeline-layout,
and render-pipeline caches; the Renderer owns material, Mesh, shader-variant, binding-set, and
upload revision caches. Buffers, textures, shader modules, and bind groups are never
descriptor-deduplicated by the RHI because their identity and lifetime are application data. Labels
do not participate in device cache keys. Device loss/context restoration and explicit destruction
clear every device cache.

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
