# Live2D model loading and rendering

`@hilo/addon-live2d` provides a high-level `Live2DModel.load()` API. Ordinary Hilo applications use
model/animation/parameter methods and Stage lifecycle, without creating Cubism objects, evaluating
Core or synchronizing drawable buffers. Core/Framework remain a separately deployed, licensed SDK;
the core engine does not import Cubism or the addon.

## Public application workflow

Configure `configureLive2D({ runtimeUrl })` once at bootstrap. Load a model with an optional abort
signal, timeout and explicit `assetVersion`, then add it to a ticking Stage. The loader fetches the
model3 manifest, moc3, textures and declared animation/effect resources. Each model owns its runtime
session and assets. Stage uses the existing Node update hook (milliseconds) to advance the session
(seconds) and sync geometry once per tick; camera invocations do not advance animation.

`playMotion()` defaults to force replacement and supports named priorities, group entry selection,
loop overrides and fades. Expression, parameter, pause/time-scale, eye-blink, physics and lip-sync
APIs use addon domain types. Persistent parameter overrides are applied after the motion baseline,
procedural hooks, expression, physics and pose stages; clearing an override restores animated
control instead of baking the manual value into the saved baseline. Procedural hooks receive a
narrow parameter writer, execute synchronously and cannot re-enter native evaluation or destroy the
model during that evaluation.

Model-local bounds and authored hit areas use positive-Y-up coordinates. Explicit model3 Layout is
handled through the SDK's matrix implementation and reusable transformed source buffers. Without
Layout, native units are retained. The general Node bounds/transform API remains unchanged.

The checked [Live2D recipe](../test/types/recipes/live2d.ts) owns a ticker with the normal
[page lifecycle](./RECIPES.md). Stage destruction dispatches non-Mesh child overrides exactly once,
continues sibling cleanup after failures, and releases the renderer last. Standalone Renderer users
can advance explicitly; the first explicit renderFrame must be preceded by model.prepare outside the
frame's allocation guard.

## SDK deployment and ownership

`hilo-live2d-runtime` consumes an application-owned SDK directory (or explicit Core/Framework
paths), emits a self-hosted ESM provider and content-hashed CPU/Core assets, and preserves license
notices and file provenance. SDK source and binary files are not published in the addon package. The
normal browser entry does not import SDK types/globals. The deployment provider alone loads the
unmodified external Core browser executable, then imports the CPU Framework bundle. It does not
rewrite CommonJS/UMD code and never imports Cubism's native WebGL renderer. All maintained
first-party code remains strict TypeScript/ESM.

Rollup and TypeScript are optional build peers for the Node tooling subpath. The generated runtime
uses the SDK's motion, expression, physics, pose, blink and layout implementations; these algorithms
are not recreated in the renderer. `/cubism` is the checked adapter boundary for tooling and
advanced providers. `/tools` is Node-only and is not imported into browser model code.

Provider initialization is shared, bounded by a deadline, and retried after failure. Cancellation of
one model does not cancel another model's shared initialization. SDK code/Framework state is
page-scoped; individual moc/model, motion/expression, physics/pose, image and GPU resources have
explicit model ownership. Failed, cancelled or late-completing loads release acquired resources.
Runtime API version mismatches and unsupported model rendering features fail before normal use.

No CDN is assumed. CSP nonce support belongs in the one-time configuration. `assetVersion` writes a
dedicated query parameter onto the manifest and each resolved resource URL while preserving its own
query/hash; arbitrary parent authentication/query parameters are not inherited. Use immutable model
versions or that explicit version to avoid stale mixed model/texture data after deployment.

## Portable rendering and automatic integration

Live2D produces ordinary transparent Mesh data and reusable per-draw buffers. The shared renderer
continues to own uploads, shader preparation, submission fences and device/context recovery.
`RenderNodeExtension.raster` lets default Forward discover portable prepasses automatically, with
visibility/layer filtering, conditional scene splitting, synchronous recording and submission-aware
callbacks. This hook has no compute/storage backend requirement. Low-level callers may retain the
old explicit feature; per-invocation mask recording is deduplicated.

Each distinct soft mask uses one renderer-owned persistent RenderTarget. Model-local coordinates
with bounded extents and a small border make mask contents independent of camera/world transforms.
The ordinary color meshes sample getColorTexture; existing graph dependency tracking connects the
producer/consumer. Explicit ordered renderer lists allow invisible mask sources to render without
changing color-scene visibility. No native interop or alternate shader tree is used.

High-level models set Node.sortingGroup. The shared transparent planner keeps each subtree atomic,
including nested groups, while retaining internal draw order. Groups use their root's sortingLayer,
zIndex, camera depth and stable scene order. Opaque and explicit unsorted lists are unchanged;
adjacent batching does not cross a group boundary. Camera2D picking uses the same hierarchy order.

Texture coordinates cross the established managed-image/render-target normalization boundary once.
ImageBitmap row orientation is normalized explicitly on WebGL2 because WebGL unpack-flip flags do
not apply to bitmaps. The upload path preserves low/zero-alpha RGB bytes without a Canvas2D
roundtrip, operates only on texture revisions, and retains renderer recovery recipes.

## Supported release boundary

The runtime baseline is **Cubism SDK for Web 5-r.5**. Loading requires a `.model3.json` manifest and
`.moc3` runtime model; Cubism 2 `.model.json` / `.moc` and Editor `.cmo3` documents are not
accepted. Traditional Cubism 3.x, 4.x and 5.0 runtime exports are the compatibility target, using
Core's older-format support. This is not a claim that every model/version combination has browser
coverage: the maintained actual-SDK fixture is Hatsune Miku. For newly authored assets, select the
**SDK 5.0 / Cubism 5.0** export target until advanced 5.3 composition is implemented. A newer Editor
can select an older runtime target; see the
[official target-version guide](https://docs.live2d.com/en/cubism-editor-manual/target-version-selection/).

- WebGL2 and WebGPU use shared GLSL ES 3.00 -> engine preprocessing -> Naga raster artifacts.
- Cubism Web SDK R5 supplies CPU evaluation. Traditional normal/additive/multiply blending,
  multiply/screen colors, soft/inverted masks, model opacity and authored Layout are supported.
- Core drawable interpolation within 1e-4 of opacity endpoints is normalized, including the official
  Haru sample's 1.0000499486923218 initial value. Overallocated Core blend buffer capacity is not
  treated as extra drawables. Invalid data still fails explicitly.
- Empty ArtMesh placeholders retain their source indices without entering color or mask draw lists.
  An empty mask still clears its target, preserving normal and inverted clipping semantics.
- Artwork is straight-alpha sRGB; output is premultiplied linear scene color. Gamma-space SDK
  equivalence and isolated group opacity are not claimed.
- Advanced Cubism 5.3 blending/grouped offscreen composition are rejected. Clustered, shadows,
  motion-vector roles and arbitrary 3D transparent interleaving are outside this unlit Forward
  scope.
- A node belongs to one renderer; multiple models receive independent sessions. The high-level model
  owns all loaded assets. Low-level borrowed-source/texture ownership remains available explicitly.

## Official sample and validation

Run `npm run examples:dev` and open `/examples/live2d.html`, or select Live2D from the examples
gallery. This free integration example uses the official
[Hatsune Miku sample](../examples/models/live2d/Miku/README.md), exported for SDK 3.3 / Cubism 3.3.
Original runtime files, archive hashes, source URLs and separate Crypton/Piapro character terms
accompany the model. It supplies eight motions, physics and no expression files or audio. Pointer
tracking uses the public parameter hook, while full-body/head presets and a zoom slider frame the
model with an orthographic camera. This sample has no authored hit areas, so head framing uses
documented proportions of its model-local bounds.

The stage uses a separate generated environment illustration, with a quiet center, edge lighting and
contact shadow behind the canvas. Its
[asset and generation prompt](../examples/assets/live2d/README.md) are recorded alongside the PNG;
the official character textures are unchanged.

The normal examples and GitHub Pages builds include the model and its notices. The character is not
covered by the engine's MIT license: preserve its attribution and follow the linked character terms
for reuse or another deployment. The artwork never enters npm packages.

The repository keeps example-only SDK inputs under
[third-party/live2d](../third-party/live2d/README.md). The examples Vite plugin builds an offline
runtime into `.cache/live2d-example-runtime` and serves it at
`/examples/assets/live2d/runtime/runtime.js`; the production examples build copies that runtime and
its notices to the same public path. Generated bundles are not source files, and neither SDK inputs
nor sample artwork enter npm packages. Normal example startup does not require a prebuilt addon or a
third-party CDN. Model and SDK licensing are separate from Hilo3D's MIT license; the source notices
describe their scope.

Portable tests use authored fake SDK/model fixtures and asymmetric image data, not proprietary SDK
binaries. They cover initialization sharing/retry, deadlines, abort races/late cleanup, independent
sessions, animation policies, update ordering, static validation, real Stage pixels,
sorting/picking, context/device recovery and destruction. SDK deployment tests inspect unchanged
Core bytes, license/provenance, CPU-only module graphs, nonce handling, load order and retry
behavior. The official Miku example is the maintained actual-SDK browser fixture for both backends,
with stable captures, post-capture interactions and page lifecycle coverage. Test existence
describes the contract; the handoff records which checks actually ran for a given change.
