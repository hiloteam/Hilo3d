# Live2D model loading and rendering

`@hilo/addon-live2d` provides a high-level `Live2DModel.load()` API. Ordinary Hilo applications use
model/animation/parameter methods and Stage lifecycle, without creating Cubism objects, evaluating
Core or synchronizing drawable buffers. The addon includes its runtime and initializes it lazily;
the core engine does not import Cubism or the addon.

## Public application workflow

Call `Live2DModel.load(modelUrl)` directly, then add the result to a ticking Stage. Model loads
accept an optional abort signal, timeout and explicit `assetVersion`; no SDK setup or runtime URL is
needed. The loader fetches the model3 manifest, moc3, textures and declared animation/effect
resources. Each model owns its runtime session and assets. Stage uses the existing Node update hook
(milliseconds) to advance the session (seconds) and sync geometry once per tick; camera invocations
do not advance animation.

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

## Runtime ownership and packaging

The runtime belongs to `addon-live2d`. Pinned original inputs, provenance and license notices live
under [addon-live2d/vendor](../addon-live2d/vendor/README.md). The addon build verifies their
hashes, bundles the CPU Framework and adapter, and preserves Core byte-for-byte. The completed
assets and notices ship under `dist/runtime/prebuilt/`; consumer installation never downloads or
builds an SDK.

The first model load dynamically imports the internal default loader. Its static asset URLs let
application bundlers copy/fingerprint the Core executable and standalone CPU module into their own
output. Native ESM deployments retain the package directory layout. The loader fetches only these
package/application-local assets, with no third-party runtime host. It loads Core before evaluating
the CPU module and shares initialization among concurrent models. Applications do not manipulate
Cubism classes or SDK globals. No native Cubism renderer enters the module graph.

`configureLive2D({ nonce, timeoutMilliseconds })` optionally controls CSP and the shared startup
limit; no setup call is needed normally. The former `runtimeUrl` option is removed. Advanced
SDK-independent runtime injection remains available for tests and specialized integrations.

SDK code/Framework state is page-scoped; individual moc/model, motion/expression, physics/pose,
image and GPU resources have explicit model ownership. Failed, cancelled or late-completing model
loads release acquired resources. Cancellation of one model does not cancel another model's shared
initialization. The default deadline is 30 seconds.

The included SDK files retain their own terms, separately from the adapter MIT license; see
[package notices](../addon-live2d/THIRD-PARTY-NOTICES.md). Their inclusion does not license
character artwork. Internal deployment tooling remains available to contributors but is not part of
the ordinary model-loading workflow.

`assetVersion` writes a dedicated query parameter onto the manifest and each resolved resource URL
while preserving its own query/hash; arbitrary parent authentication/query parameters are not
inherited. Use immutable model versions or this explicit version to avoid mixed model/texture data.

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

The example uses the same zero-configuration addon loader as installed applications. Vite's
source-checkout plugin prepares assets from the addon's pinned inputs and resolves their static URLs
before normal asset processing. A published package already contains those files, so consumers need
no Hilo-specific Vite plugin. Builds preserve the notices alongside example runtime assets.

Portable tests use authored fake SDK/model fixtures and asymmetric image data, not proprietary SDK
binaries. They cover initialization sharing/retry, deadlines, abort races/late cleanup, independent
sessions, animation policies, update ordering, static validation, real Stage pixels,
sorting/picking, context/device recovery and destruction. SDK deployment tests inspect unchanged
Core bytes, license/provenance, CPU-only module graphs, nonce handling, load order and retry
behavior. The official Miku example is the maintained actual-SDK browser fixture for both backends,
with stable captures, post-capture interactions and page lifecycle coverage. Test existence
describes the contract; the handoff records which checks actually ran for a given change.

The package contract installs real tarballs into an empty consumer, bundles the public addon with
Vite, blocks every external network request, and checks default startup, concurrent model ownership,
real pixels, CSP nonce propagation and retry of an injected CPU-module request failure.
