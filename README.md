# Hilo3d

English | [简体中文](./README_ZH.md)

A TypeScript-first 3D rendering engine with explicit WebGL 2 and WebGPU backends, physically based
rendering, and glTF support. WebGL 1 is not supported.

[![npm](https://img.shields.io/npm/v/hilo3d.svg?style=flat-square)](https://www.npmjs.com/package/hilo3d)
[![CI](https://img.shields.io/github/actions/workflow/status/hiloteam/Hilo3d/npm_test.yml?style=flat-square)](https://github.com/hiloteam/Hilo3d/actions/workflows/npm_test.yml)
[![license](https://img.shields.io/npm/l/hilo3d.svg?style=flat-square)](./LICENSE)

## Install

```sh
npm install hilo3d
```

Hilo3d 2.x uses ESM as its primary package entry:

```ts
import {
    AmbientLight,
    BoxGeometry,
    Color,
    DirectionalLight,
    Mesh,
    PBRMaterial,
    PerspectiveCamera,
    Stage,
    Ticker,
    Vector3
} from 'hilo3d';

const camera = new PerspectiveCamera({
    aspect: innerWidth / innerHeight,
    z: 4
});

const stage = await Stage.create({
    backend: 'webgl2',
    container: document.querySelector('#app')!,
    camera,
    width: innerWidth,
    height: innerHeight
});

const mesh = new Mesh({
    geometry: new BoxGeometry(),
    material: new PBRMaterial({
        baseColor: new Color(0.832, 0.119, 0.093)
    })
}).addTo(stage);

mesh.onUpdate = () => {
    mesh.rotationX += 1;
    mesh.rotationY += 1;
};

stage.addChild(new AmbientLight({ amount: 0.5 })).addChild(
    new DirectionalLight({
        amount: 5,
        direction: new Vector3(-1.3, -0.8, 0)
    })
);

const ticker = new Ticker(60);
ticker.addTick(stage);
ticker.start();
```

Select WebGPU explicitly and await its adapter, device, Naga WASM compiler, and render resources:

```ts
const stage = await Stage.create({
    backend: 'webgpu',
    container: document.querySelector('#app')!,
    camera,
    width: innerWidth,
    height: innerHeight
});
```

Omitting `backend` selects the documented `webgl2` default. Requesting `webgpu` never falls back to
WebGL 2: unavailable adapters, missing required features or limits, and initialization errors reject
`Stage.create()`. Initialization freezes the adapter options and effective device descriptor. A
later device loss emits `webgpuDeviceLost`, requests a fresh equivalent adapter with those options,
revalidates the fallback-adapter policy plus every required feature and limit, and requests the
replacement device with the same effective descriptor before rebuilding the context, managers, and
target resources. Rendering safely skips frames while recovery is active; successful recovery
preserves each `RenderTarget` object identity and emits `webgpuDeviceRestored`. If recovery fails,
`webgpuDeviceRecoveryFailed` is emitted and subsequent renders throw the recovery error explicitly.
Destroying the renderer cancels an in-flight recovery without changing backends.

Textures using `isImageCanRelease` keep an engine-private recovery backing keyed by the logical
`Texture` after their public CPU image is discarded: raw pixels and `ImageData` updates are copied
into an exact private full-content checkpoint, while external sources follow the documented private
reference/checkpoint path. The incremental journal is capped at 64 entries; a lagging WebGL 2
context or WebGPU device performs one exact full replay and then resumes incremental updates without
exposing the released public image. `releaseGPUResources()` remains a reusable lifecycle operation
rather than a device teardown: it clears owned targets and caches, immediately recreates the
main-canvas depth/MSAA attachments, and leaves the next render valid. Renderer-owned WebGPU shadow
cameras and debug helpers are scoped per light and renderer and are pruned when debug, shadow,
enabled, or stage-membership ownership changes, as well as during release and destruction.

The package has one ESM-only entry point. Use it through a modern bundler or native browser ESM with
an import map. Hilo3d does not publish CommonJS, UMD, global-script, or namespace declaration
variants, so every consumer uses the same module and type contract.

## Rendering and shader contract

Hilo3d 2.x has two deliberately selected backends: `webgl2` and `webgpu`. It never creates WebGL 1
contexts. Every engine shader has GLSL ES 3.00 as its sole source of truth. Shared material, shadow,
and presentation shaders are reused by both backends; WebGPU-only utility passes such as mipmap
generation remain GLSL rather than introducing a WGSL exception. Custom shaders must use `in`/`out`,
`texture()`, explicit fragment outputs, and std140 uniform blocks.

WebGL 2 compiles that source directly. WebGPU first resolves the engine's shader variants, rewrites
the active GLSL ES 3.00 interface to Vulkan GLSL 4.50 (locations, bind groups, separate texture and
sampler resources, and clip-space depth), and only then passes it through the Naga WASM frontend to
produce WGSL. The renderer-owned presentation and mipmap pipelines go through the same preprocessing
and Naga translator and have no handwritten or fallback WGSL modules. There is no GLSL 1.00
compatibility translator. Generated WGSL represents the shared std140 ABI with explicit
`@align`/`@size` wrappers that work with WebGPU's default language features; it never requests or
depends on the optional `uniform_buffer_standard_layout` feature.

The preprocessing frontend resolves function-like macros and the complete conditional integer
expression grammar used by the engine, flattens named stage interface blocks, and handles fixed
arrays and multi-declarations before Naga. It deliberately accepts only the WebGL 2 / GLSL ES 3.00
builtin surface: unsupported later-version query/gather operations fail before either backend is
created. Depth-only passes reuse the same fragment shader through a color-output-free Naga variant;
there is no shadow-only WGSL or dummy color attachment.

All non-texture shader data uses a fixed std140 uniform-block ABI:

| Block           | WebGL 2 binding | WebGPU group/binding | Update scope                             |
| --------------- | --------------: | -------------------: | ---------------------------------------- |
| `FrameBlock`    |               0 |                  0/0 | renderer frame                           |
| `CameraBlock`   |               1 |                  0/1 | camera/render-pass matrices and viewport |
| `SceneBlock`    |               2 |                  0/2 | scene revision                           |
| `LightBlock`    |               3 |                  0/3 | camera/render pass                       |
| `MaterialBlock` |               4 |                  1/0 | final std140 bytes                       |
| `ModelBlock`    |               5 |                  2/0 | object transform revision                |
| `GeometryBlock` |               6 |                  2/1 | geometry decode revision                 |
| `SkinningBlock` |               7 |                  2/2 | skeleton pose revision                   |
| `MorphBlock`    |               8 |                  2/3 | morph pose revision                      |
| `InstanceBlock` |               — |                  2/4 | WebGPU instanced batch revision          |

The four WebGPU groups follow update frequency: global/pass/scene in group 0, material and texture
resources in group 1, object/geometry/pose in group 2, and registered custom blocks in group 3.
`CameraBlock.u_viewport` is the active attachment's physical-pixel `(x, y, width, height)` and is
rewritten for canvas, render-target, and every shadow pass on both backends. `MaterialBlock`
compares a reusable snapshot of its final std140 bytes, so direct changes to nested `Color`/matrix
values and texture-derived values are detected without manual `isDirty` flags; an unchanged byte
image causes no revision or upload.

GLSL samplers are the only declarations outside UBOs because opaque resources cannot be block
members. WebGL 2 assigns them texture units; WebGPU lowers each one to a separate texture/sampler
binding pair. Register a custom `ShaderMaterial` block with `registerUniformBlockBinding()` before
its first use, then create and update it through `createStd140Layout()` and
`UniformBuffer.fromSchema()`. Classic float, vector, matrix, integer, or boolean uniforms are
rejected. The public std140 schema is intentionally flat—scalars, vectors, matrices, and fixed
arrays—and rejects nested structs instead of packing a backend-dependent layout. The shared shader
contract supports GLSL ES 3.00 `sampler3D`, `sampler2DArray`, `sampler2DArrayShadow`, and the
complete signed/unsigned integer sampler families for 2D, 3D, cube, and 2D-array textures. Managed
`Texture` uploads cover 2D, cube, 3D, and 2D-array targets, including signed and unsigned integer
formats. Integer textures require `NEAREST` magnification, `NEAREST`/`NEAREST_MIPMAP_NEAREST`
minification, anisotropy 1, and an explicit complete chain when mipmapping is selected. Mipmapped 3D
textures likewise require an explicit complete chain. Compressed 3D textures are rejected
consistently before backend allocation because WebGPU has no compressed 3D texture model; compressed
2D-array textures remain available when the native format feature is present. Sampler arrays keep
WebGL 2's dynamically-uniform indexing semantics: constant elements become direct binding pairs,
while dynamic indices are lowered to typed dispatch functions for texture builtins and user
functions without optional WebGPU binding-array features. Depth textures support both comparison
sampling through shadow samplers and numeric `.r` reads through ordinary samplers. Numeric depth
bindings are specialized to WGSL `texture_depth_*` after Naga and require nearest-only filtering
with anisotropy disabled, matching WebGPU's non-filtering binding contract; WebGL 2 selects
comparison mode from the reflected sampler type on every binding. External images always use the
standard sRGB-managed upload path. Raw TypedArray/DataView texture storage is untagged, tightly
packed, and applies `flipY` with identical row ordering in WebGL 2 and WebGPU; the old
backend-specific color-conversion boolean has been removed. WebGPU video textures observe decoded
frames with `requestVideoFrameCallback`, stage each completed frame in a renderer-owned canvas, and
fence the queue copy before that canvas can be rewritten. The first undecoded frame remains a valid
zero-initialized texture; source replacement, resource release, and device recovery cancel and
rebuild frame observation explicitly. There is no WebGL fallback, placeholder substitution, or
direct upload from an unavailable decoder backing. Same-name UBO layouts are checked across shader
stages before Naga runs. See the [engineering modernization record](./ENGINEERING_MODERNIZATION.md)
for the Naga pipeline, four bind-group ABI, migration example, and breaking changes.

Texture subresource writes use one descriptor-only API on both backends:

```ts
texture.updateSubTexture({
    mipLevel: 0,
    x: 16,
    y: 8,
    width: 4,
    height: 4,
    image: pixels
});
```

Cube updates add `face`; 2D-array updates require `layer` and `depth`; 3D updates require `z` and
`depth`. The old positional overload has been removed, and non-base writes require an explicit mip
chain. Cube chains include level zero and contain six consecutive entries per level in
`+X, -X, +Y, -Y, +Z, -Z` order. Portable raw depth writes use depth16unorm or depth32float, plus
feature-gated depth32float-stencil8; raw DEPTH24/DEPTH24_STENCIL8, external depth sources, and depth
mipmap filters are rejected before backend allocation. Raw, external, compressed, 3D, array, and
cube updates share a 64-entry journal and an exact checkpoint so a slower context/device can recover
without losing writes. Compressed writes accept exact raw block data: origins are block-aligned and
non-block dimensions are legal only at a logical mip edge. Edge and 1×1/2×2 tail-mip copies retain
their logical extent while satisfying the physical 4×4 block copy contract.

Offscreen rendering is backend-neutral. `Renderer.createRenderTarget()` returns the public
`RenderTarget` contract on both backends, with MRT color attachments, 1×/4× MSAA, optional
depth/stencil and sampleable attachments, resize, explicit target selection, and asynchronous
readback. Attachment `Texture` identities remain stable across resize and context/device recovery;
WebGL 2 resize is transactional and either commits every attachment or restores the previous target.
Both backends present through a fullscreen texture-load pipeline; WebGL 2 never performs an invalid
single-sample-to-antialiased-default-framebuffer blit, and pass failures restore canvas bindings
before propagating the error. The post-processing examples and the asynchronous `MeshPicker` use
only this shared surface, with no WebGL-only implementation or CPU picking fallback. The old public
`Framebuffer`, `LightShadow`, and `CubeLightShadow` types, public light `lightShadow` fields,
renderer-owned `useFramebuffer`/`framebufferOption`, and implicit target creation have been removed;
shadows and native framebuffer handles are backend internals.

Directional, spot, and point lights expose the shared `ShadowCastingLightParameters` contract and
render shadows on both backends. Area, ambient, and base lights reject shadow configuration before
backend selection instead of allowing one backend to ignore it.

Primitive topology is normalized before either backend sees it: `LINE_LOOP` becomes explicit `LINES`
indices and `TRIANGLE_FAN` becomes `TRIANGLES`, consistently for indexed, non-indexed, and
glTF-loaded geometry. Texture upload also has one contract across backends: external images follow
the browser's sRGB-managed path, while tightly packed TypedArray/DataView sources use deterministic
row order and `flipY` handling.

Dynamic WebGPU geometry updates use attribute and index dirty ranges rather than rebuilding every
buffer. Interleaved matrices, normalized/strided data, discrete ranges, 4-byte-aligned small index
writes, history expiry, shape changes, and old-buffer disposal are part of the tested contract.

Native compressed textures are capability-driven through `Renderer.supportsTextureCompression()`.
WebGPU enables adapter-exposed BC, ETC2 (also used for ETC1 sources), and ASTC features when it
creates the device; its ETC2/EAC table maps all ten WebGL 2 core formats. PVRTC is explicitly
unsupported by WebGPU instead of being decoded or substituted silently. WebGL 2 reports its
corresponding native extension support independently. When a mipmap filter is selected, both
backends require the exact complete mip chain and validate every level's dimensions; KTX files with
a legal base-only or partial chain remain usable with a non-mipmap filter. KTX1 headers and mip
sizes honor the container endianness marker, and container format/extent/mipmap fields cannot be
overridden by request options.

Backend-neutral resource diagnostics are available from
`renderer.resourceManager.getDiagnostics(rootNode?)`. The old WebGL-only `logGLResource()` helper
has been removed; diagnostics return a stable ownership snapshot without logging or inspecting
backend-private caches. Render resources are owned by
`mesh → pass owner → material/shader/instancing variant`; each mesh keeps at most 32 variants with
LRU eviction. Target replacement/destruction, mesh/material/geometry identity changes, failed-frame
rollback, and final shared references all participate in deterministic cleanup. WebGL 2 programs,
buffers, vertex arrays, textures, framebuffer state, capability snapshots, and extension objects are
scoped to their owning context. Multiple renderers may use the same logical scene resources without
sharing native handles, and releasing or restoring one context cannot invalidate another.

## Documentation and examples

- [API documentation](https://hilo3d.js.org/docs/)
- [Example gallery](https://hilo3d.js.org/examples/list.html)
- [glTF viewer](https://hilo3d.js.org/examples/glTFViewer/index.html)
- [Engineering modernization record](./ENGINEERING_MODERNIZATION.md)
- [Changelog](./CHANGELOG.md)

API pages are generated from the checked TypeScript source with TypeDoc. The committed API report in
[`etc/hilo3d.api.md`](./etc/hilo3d.api.md) locks the public declaration surface for review.

The example manifest is collected automatically from all 78 HTML files, producing 155 backend/page
cases. Every page is exercised with both `webgl2` and `webgpu` except `webxr.html`: browser WebXR
presentation currently uses `XRWebGLLayer`, so that page is the sole explicit WebGL 2-only
exception, is not part of the WebGPU release gate, and does not attempt WebGPU followed by a
fallback. The gate requires an actual WebGL draw or WebGPU canvas acquisition, render-pass draw, and
queue submission, with no page, network, console, validation, uncaptured GPU, or device-loss errors.
It also exercises fractional-DPR render targets, decoded video textures, compressed textures, and
GPU mesh picking on both backends. Interaction cases require action-local native draw progress (and
a fresh queue submission on WebGPU), then compare GPU readbacks for life-game texture injection,
ShaderToy pointer input, a same-source post-process kernel change, and glTF Viewer model
replacement. Page, request/response, console, DevTools graphics, and uncaptured GPU diagnostics
remain active through those actions and cleanup. GPU instrumentation is sampled again after a
stable-frame window and after `GPUQueue.onSubmittedWorkDone()` resolves for every observed queue, so
delayed validation errors cannot arrive after a case has already passed. The deterministic lit PBR
first frame must be byte-for-byte identical between WebGL 2 and WebGPU.

## Development

The runtime requires either WebGL 2 or WebGPU according to the selected backend. Development
requires Node.js 22.22.2 or newer and npm 12.0.1. The versions are recorded in `.node-version` and
`package.json`.

```sh
npm install --global npm@12.0.1
npm ci
npx playwright install chromium
npm run validate
```

Focused commands:

- `npm run dev` starts library development.
- `npm run examples:dev` serves the complete example gallery.
- `npm run typecheck`, `npm run lint`, and `npm run format:check` run static gates.
- `npm run check:modernity` rejects maintained JavaScript implementations and retired tool configs.
- `npm run test:coverage` runs browser unit tests and enforces full-source coverage thresholds.
- `npm run test:ui` runs the automatic 78-page backend matrix (WebGL 2 + WebGPU, with the explicit
  WebXR exception; 155 page/backend cases) and rejects page, console, request, response,
  draw/submit, and GPU validation errors. It also exercises fractional DPR, life-game input,
  ShaderToy pointer input, glTF Viewer lifecycle, and live post-process changes through both
  backends.
- `npm run test:webgpu` creates a real WebGPU adapter/device/pipeline, translates GLSL through Naga,
  and renders Basic/PBR, instancing, an indexed strip with primitive restart and partial updates, a
  replaced mipmapped texture, all three shadow-light kinds, 4× MSAA/stencil, two-attachment MRT,
  offscreen presentation, pixel readback, native compressed textures, and GPU mesh picking in
  Chromium SwiftShader. The same real-browser path creates managed 3D, 2D-array, integer-array, and
  depth-array textures plus a numeric depth texture and a dynamically indexed sampler array;
  compiles the extended GLSL sampler set through Naga; builds the actual bind groups and pipeline;
  draws, submits, and checks the exact `[64, 128, 200, 255]` pixel readback with no compilation or
  GPU validation errors. The fixture actively calls `GPUDevice.destroy()`, observes a newly acquired
  adapter/device, replays a released texture, preserves the selected `RenderTarget` identity, and
  requires exact pre/post-recovery pixel readback. Unit coverage also verifies failed, stale, and
  destroy-cancelled recovery, reusable `releaseGPUResources()`, and exact pruning of renderer-owned
  shadow cameras and helpers.
- `npm run test:webgpu:native` is an explicit optional hardware lane. It disables Chromium's
  software rasterizer, forces every adapter request to use `forceFallbackAdapter: false`, rejects a
  fallback or known software adapter, and runs the production WebGPU fixture through draw, submit,
  queue completion, recovery, and readback. It is intentionally not part of portable `validate`; the
  manual `Native WebGPU (optional)` workflow requires a self-hosted Linux runner labelled `gpu` with
  a working physical GPU driver. WebXR remains outside this WebGPU lane.
- `npm run test:visual` compares the same deterministic lit PBR scene, readback assertions, and
  screenshots through WebGL 2 and WebGPU, including exact cross-backend first-frame equality.
- `npm run docs:build` generates the API reference; `npm run api:check` verifies the public
  signature report; `npm run site:build` assembles the public site.
- `npm run test:package` validates the built and packed npm contract.
- `npm run validate` runs the complete CI and pre-publish gate.

The published ESM graph targets ES2022 and keeps `gl-matrix` external for dependency deduplication.
Naga is dynamically imported: the engine entry is about 1.06 MB, while the roughly 2.05 MB Naga
JavaScript/WASM graph is emitted as an independent lazy chunk and fetched only during WebGPU
initialization. Declarations and source maps are generated from `src/`; the real installed tarball
is checked with publint, Are the Types Wrong, Bundler and NodeNext consumers, ESM runtime loading,
and an actual Naga GLSL-to-WGSL translation.

See [Contributing](./.github/CONTRIBUTING.md) for the TypeScript, API, testing, and review policy.

## License

[MIT](./LICENSE)
