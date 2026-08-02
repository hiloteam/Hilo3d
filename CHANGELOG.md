# Unreleased

### Breaking changes

- Replace the mutable `Material` monolith with immutable `MaterialDefinition` plus
  `MaterialInstance`. Remove legacy topology mutation, WebGL-style blend/side fields, material-owned
  render order and shadow participation, material display transforms, shared UV matrices, shadow
  proxy materials, `onBeforeCompile`, and `shaderCacheId`. Move object ordering and shadow flags to
  `Mesh`; require construction-time topology, explicit coverage/compositing, typed
  `MaterialAttributeSemantic`/`MaterialUniformSemantic`/`MaterialTextureSemantic` bindings, and
  explicit pass pipeline state. This is a direct migration with no compatibility adapter.
- Split per-texture-slot std140 metadata out of `MaterialBlock` into the fixed
  `MaterialTextureBlock`. The material scalar block is now 432 bytes, the texture-slot block is
  1,920 bytes, WebGPU material textures begin at binding 2, and custom uniform block registrations
  begin after ten built-in WebGL2 binding points.
- Expand the fixed Camera/Model/Skinning/Morph/Instance std140 ABI with current/previous transforms,
  render origins, and history/depth flags. Custom shaders that redeclare built-in blocks must use
  the updated field order and capacities.

### Changes

- Add canonical built-in material definitions, stable material IDs and revisions, explicit
  forward/depth-only/shadow-caster/picking roles, role-aware shader variants, per-slot texture/UV
  transform/encoding/channel data, and deterministic coverage/transmission/compositing ownership.
  Shadow rendering now requests the original material's shadow role, glTF constructs layered PBR
  topology and all texture transforms before instantiation, and display conversion remains solely in
  post-processing/output.
- Route opaque-composited transmission surfaces through the after-opaque forward queue so their
  scene-color dependency is satisfied without conflating transmission with alpha blending. Apply
  texture-slot encoding consistently to 2D, cube, and environment samples, including explicit sRGB
  decoding for the LDR studio IBL. WebGPU shader lowering now retains the managed material sampler
  for single-UV shaders instead of bypassing texture transforms, decoding, and channel remapping,
  restoring WebGL2/WebGPU material parity.
- Add the `high-end` rendering profile, per-camera standard/reversed depth modes, finite/infinite
  reversed-Z projection, depth-convention-aware surfaces, render targets, shadows, storage graphics,
  and GPU picking. Add optional camera-relative GPU transforms while preserving CPU world identity,
  plus submission-transactional current/previous camera, mesh, instance, skinning, and morph state.
  `Node.invalidateTransformHistory()` resets discontinuous motion deterministically.
- Add the WebGPU-only `ClusteredForwardPlusPipelineFactory` high-end opaque-scene slice. Registered
  ordinary Mesh buckets now use stable dirty GPU Scene records, six-level previous-frame Hi-Z
  occlusion, projected-size LOD compaction, fixed indexed-indirect draws, depth-driven logarithmic
  3D clusters, a bounded count/prefix/write light allocator, storage GGX PBR, HDR Bloom, ACES
  display, and on-demand visibility/overflow diagnostics. Add real WebGPU renderer coverage for the
  compute/dispatch/indirect-draw path. Make Hi-Z conservative for both standard and reversed depth,
  use the committed previous view/projection/depth convention for temporal occlusion, preserve the
  depth prepass during color shading, and use inverse-transpose object normal matrices. Registered
  buckets now migrate at runtime between the GPU path and a shared Forward compatibility path for
  material/geometry replacement, alpha, transparency, skinning, morphing, unregistered meshes, and
  object-capacity overflow; the fallback preserves normal opaque/transparent sorting, shadows, and
  transmission scene-color input without double-drawing GPU-managed meshes. Device limit
  requirements cover every configured geometry/cluster buffer and dispatch dimension. Add a real
  WebGPU 100k-static + 10k-dynamic + 256-light scale/recovery acceptance fixture and deterministic
  cluster-overflow coverage. Share metallic/roughness surface evaluation and the BRDF between
  ordinary Forward and clustered storage shaders so Forward+ replaces only light-list iteration. Add
  native GPU Scene base-color, metallic, roughness, combined metallic-roughness, occlusion,
  emission, and normal maps with UV0/UV1, UV matrices, tangent streams, sampler mutation, runtime
  texture replacement, and device-recovery coverage; incompatible alpha/layered/deformed inputs
  continue to use the Forward fallback.
- Let scriptable pipeline factories create persistent renderer-owned storage buffers, stage dirty
  writes before graph import, and commit or discard CPU temporal state at the actual submission
  boundary through `frameSubmitted()` and `frameDiscarded()`. Pipeline-owned buffers retain normal
  device-loss recipes and submission-aware destruction. Frame completion still runs when a
  post-submission pipeline callback throws, so presentation, events, diagnostics, and temporal
  cleanup are not skipped after GPU work has already been submitted.
- Let scriptable render graphs import engine-managed `Texture` objects as sampled persistent
  resources while preserving renderer upload/recovery/submission ownership. Expose the public
  per-stage sampler limit alongside the existing sampled-texture limit.

- Add modern WebGPU capability discovery for `subgroups`, adapter subgroup-size limits,
  `shader-f16`, and `timestamp-query`; expose renderer feature queries for explicit f32/workgroup
  fallback selection. Direct WGSL f16 now preserves the exact native artifact while completing Naga
  validation through an equivalent f32 specialization. Compute buffer `minBindingSize` is derived
  from WGSL store types, including the required one-element runtime-array minimum.
- Add submission-aware timestamp QuerySets, pass timestamp writes, explicit resolves, and validated
  debug groups/markers to the portable RHI. Opt-in renderer diagnostics now publish Render Graph
  record/compile/prepare/execute CPU timing, per-pass asynchronous GPU timing, and compiled resource
  lifetime intervals through a non-blocking three-slot readback ring; the default diagnostics-off
  path creates no query resources.
- Add explicit Render Graph texture views for mip, array-layer, dimension, compatible-format, and
  depth/stencil-aspect access across sampled, storage, attachment, and copy paths. Add
  renderer-owned double/triple-buffer history textures whose recipes survive device recovery, whose
  contents invalidate on descriptor or device-generation changes, and whose current/history rotation
  commits only after a successful submitted writer frame. History recipes initially accept one
  single-sample 2D color mip/layer so slot validity always means complete initialization.
- Add camera-relative cascaded shadows for directional lights on the shared WebGL 2/WebGPU shadow
  atlas path. `DirectionalLight.shadow` now supports one to four cascades, practical split
  weighting, a maximum shadow distance, cross-cascade blending, and texel stabilization while
  preserving the existing single-shadow default. Filtered directional shadow contrast is
  art-directable through `shadowStrength`. Add an interactive pastel sunset geometry-garden example
  with live cascade count, stabilization, orbit controls, split, blend, strength, distance, and 4×
  MSAA.
- Promote `OrbitControls` from an example helper to the public `src/controls` API, add constrained
  `setView()` support for scripted tours, and make maintained examples reuse the engine control
  instead of carrying local camera gesture implementations.

# 2.0.0-alpha.2 (2026-07-26)

### Breaking changes

- Expand the fixed `MaterialBlock` std140 ABI for layered PBR material data and reserve WebGPU group
  3 bindings 0/1 for the pass-global opaque scene texture. Portable custom uniform blocks retain
  registration order and now start at WebGPU group 3 binding 2.

### Changes

- Replace the legacy PBR lighting core with correlated Smith-GGX, Burley diffuse, anisotropic GGX,
  energy-compensated/specular-occluded IBL, layered clearcoat, and physically smooth punctual-light
  attenuation. Add glTF parsing and material shader support for `KHR_materials_anisotropy`,
  `KHR_materials_clearcoat`, `KHR_materials_transmission`, `KHR_materials_volume`, and
  `KHR_materials_ior`, plus spectrally integrated thin-film `KHR_materials_iridescence`.
- Add forward opaque scene-color capture and pass-global transparent-material sampling through the
  Render Graph/RHI path. Add a linear-HDR `PostProcessRenderPipelineFactory`, engine-owned
  soft-knee/13-tap/tent-pyramid `Bloom`, and a one-pass `ColorUber` display transform with LMS white
  balance, grading, PBR Neutral/ACES/Reinhard tone mapping, vignette, exact sRGB output, and
  display-space dithering.
- Replace the Bloom example's application-owned RenderTarget/Gaussian/composite implementation with
  the built-in HDR Bloom and Color Uber pipeline.
- Add a layered PBR studio with live anisotropy, clearcoat, transmission, and volume comparisons,
  plus a switchable Khronos glTF material gallery using the attributed Anisotropy Barn Lamp,
  Clearcoat Wicker, Dragon Attenuation, and animated Iridescent Dish with Olives sample assets.
- Replace the overlapping legacy PBR sphere stack with a controlled 30-sample Material Lab,
  switchable steel/copper/gold/ceramic families, explicit metallic/roughness axes, studio lighting,
  and the engine HDR post-processing pipeline.
- Remove the twelve low-resolution baked/cloud cube-map images from the examples. Shared PBR and
  glTF pages now use a seam-coherent procedural studio environment with neutral fill, warm/cool
  softboxes, generated mipmaps, and runtime PNG face URLs for the CubeTextureLoader/image-release
  examples.
- Add measured-width `Text2D` wrapping for mixed CJK/Latin content, max-line clipping and ellipsis,
  baseline, paragraph spacing, and letter spacing. Add in-place Sprite source replacement,
  material-only Sprite initialization, atlas-batched `SlicedSprite`, four-state `UiButton`, and
  ImageGen-authored responsive text/nine-slice examples for WebGL 2 and WebGPU.
- Add Node-level `sortingLayer` and `zIndex` for Sprite/Text2D display order, retain stable
  scene-tree order for ties, make pointer picking select the same topmost 2D node, and restrict
  transparent instancing to adjacent compatible items so batching cannot reorder interleaved
  textures. Document the independent top-left Camera2D and centered Sprite-anchor contracts, and add
  an ImageGen-authored pixel-town example with A* walking, click-to-route interaction, and foot-Y
  ordering across both backends.
- Lower the supported development and package runtime floor to Node.js 20.19.0, the shared minimum
  accepted by Vite 8 and ESLint 10, and pin npm 10.9.4 so the declared package manager also runs on
  Node 20.

### Fixes

- Keep float scene-color variants linear by suppressing material-local gamma encoding and legacy
  per-material tone mapping until the final display transform. Preserve HDR Bloom energy with
  normalized Karis weights, remove the non-physical far-distance light floor, and use refracted
  volume path length for Beer-Lambert attenuation.
- Rebalance the Khronos layered-material gallery around neutral photographic key/fill lighting,
  readable opaque transmission backdrops, restrained warm highlights, and a 90-degree orbit pitch so
  dark metals and iridescent glass remain legible without clipping the top view.
- Define one portable coordinate contract for fullscreen render targets, native fragment
  coordinates, top-left managed 2D textures, cube-map face rows, BRDF/LTC lookup tables, compute
  storage rows, pointer input, and readback. Apply it to Bloom, Color Uber, graph present,
  transmission, ShaderToy, Life Game, the compute particle field, the compute path tracer, and
  built-in material/environment sampling so WebGL 2 and WebGPU retain the same Y orientation.
- Keep shared Shadow Atlas rectangles in positive top-left coordinates and convert light-space UVs
  through the portable render-target helper. WebGL 2 no longer samples a vertically mirrored depth
  atlas that made moving shadows appear to rotate opposite their casters.
- Correct `SpriteFrame`'s top-left atlas-row offset for `flipY` textures on both backends. Full
  textures were unaffected, but subframes previously selected the vertically opposite source row,
  swapping nine-slice top/bottom pieces and requiring reversed character-direction maps. Use a
  strictly nine-slice-safe postal UI atlas with uniform stretchable edges and deterministically
  mirrored corners/edge lighting.
- Expand the game-building skill's coordinate contract: Sprite positions target their anchor in the
  parent local coordinate system, and the default center anchor does not become top-left merely
  because Camera2D uses a top-left screen origin.

# 2.0.0-alpha.1 (2026-07-25)

### Breaking changes

- Replace the public abstract/concrete renderer split with one public `Renderer`. Create every
  backend through `await Renderer.create(...)`; direct `new Renderer()` and `new Stage()`
  construction are unavailable so initialization always has one explicit asynchronous boundary.
- Remove the public `WebGLRenderer`, `WebGPURenderer`, `WebGLRenderTarget`, and `WebGPURenderTarget`
  classes and their backend-specific parameter and lifecycle types. The sole offscreen surface
  remains the backend-neutral `RenderTarget` returned by Renderer.
- Replace the backend-class support probe with `Renderer.isBackendSupported('webgpu', options)`.
  Explicit backend requests remain fail-closed; `auto` still probes WebGPU without requesting a
  device or allocating GPU resources.
- Move the render frontend to `src/render` and the RHI to `src/render/rhi/{webgl2,webgpu}`. Remove
  the legacy `src/renderer` and `src/rhi` source trees and do not provide compatibility re-export
  paths.

### Changes

- Add a portable `build-hilo3d-games` Agent Skill with strict TypeScript/Vite starters for 2D, 3D,
  and hybrid games, stable-first `2.0.0` dependency resolution, focused public-API references, and
  repository checks that keep bundled examples and version-selection behavior valid.
- Separate the full release gate from npm's publish lifecycle: `npm run release:check` retains the
  complete validation matrix, while `prepublishOnly` performs only fast deterministic checks before
  `prepack` builds the tarball, avoiding repeated browser suites and expired publish OTPs.
- Make the releasable-texture example deterministic by always installing a replacement CPU image
  before marking the texture for upload, removing a random page error from the WebGL2/WebGPU UI
  release gate.
- Add a shared 2D frontend with atlas-backed `Sprite`, `SpriteFrame` sequence animation,
  Canvas-2D-backed `Text2D`, pixel-space `Camera2D`, actual-size sprite pointer hit tests, and
  automatic portable instance batches capped at 128 sprites per draw. Sprite raster uses one GLSL ES
  3.00 source through native WebGL 2 or the existing Naga WGSL pipeline.
- Add ordered multi-camera Stage composition through `Camera.priority`, per-camera color/depth/
  stencil clear policy, and `Camera.visibility & Node.layer` filtering for Mesh, Light, scriptable
  culling, and pointer input. All cameras record into one Render Graph/RHI frame; Camera2D defaults
  to the dedicated 2D layer and preserves prior 3D color.
- Redesign the examples gallery with categorized metadata, search, responsive navigation, accessible
  controls, isolated per-example query parameters, source/direct links, loading states, and a shared
  renderer statistics panel that reports the active WebGL 2 or WebGPU backend.
- Curate the gallery into focused Highlights and All Examples collections, replace generic
  descriptions with capability-oriented copy, merge five primitive micro-pages into one visual
  geometry lab, rename the two CanvasTexture demos, and remove obsolete OSG/SMD/TGA loaders,
  duplicated Polly content, unused media, and the non-visual math fixture page.
- Refresh the shared example lighting and dark canvas treatment, and rebuild Quick Start, point
  lights, instancing, and bloom around deterministic showcase scenes. Add an ImageGen-authored
  graphite/cyan/violet showroom-floor texture used by the new scenes.
- Add renderer-local scriptable render pipelines through `RendererCommonOptions.renderPipeline`,
  reusable `RenderPipelineFactory` configurations, frame-scoped culling/renderer-list handles, a
  narrow `ScriptableRenderGraph`, retained pass-parameter pools, recovery-aware persistent targets,
  and shared scene, shadow, fullscreen, copy, and present pass primitives.
- Add `ForwardRenderPipelineFactory` feature injection with per-Renderer feature runtimes and
  creation-time capability/limit/format requirements. The empty default feature set retains the
  existing direct forward recorder with no intermediate scene target or public-facade draw cost.
  WebGPU-only `storage-buffer`, `storage-texture`, `compute-pass`, and `indirect-draw` requirements
  now participate in backend selection and device capability/limit/format validation.
- Add the WebGPU compute/storage foundation on the shared renderer path: WGSL host-shareable
  `StorageLayout`, renderer-owned `StorageBuffer` upload/readback/recovery semantics, public graph
  buffer access, Direct WGSL `ComputeShader` validation through Naga, immutable `ComputeKernel`,
  `ComputeRenderPass`, and uniform/storage/complete-2D sampled or write-only-storage-texture
  bindings. Compute is a dedicated pass model rather than a `Material` subtype.
- Add portable RHI compute pipeline/pass contracts, direct and indirect dispatch, buffer clear,
  direct/indexed indirect draw, compute/storage limits and diagnostics, a one-hop WebGPU backend,
  and a WebGL 2 negative implementation that fails before native GL work instead of emulating
  storage or compute. Creation-time pipeline requirements now prevent compute/storage pipelines from
  falling back to WebGL 2.
- Add the storage-aware raster path with constrained GLSL ES 3.10 translated through Naga, readonly
  graphics storage bindings, graph vertex/index/indirect inputs, `GPUDrivenRenderPass`, and
  `SceneRenderPass` group-3 pass-global storage variants. Scene variants reuse ordinary renderer
  lists and deterministically expand instanced batches to direct per-mesh draws.
- Add a polished deterministic WebGPU showcase and acceptance example: depth prepass → sampled-depth
  tile culling → Scene group-3 storage shading, Gaussian cull/reorder/indirect draw, and a
  1024-particle Hilo3D wordmark driven by Direct WGSL fractal value/curl noise, breathing, swirl,
  return motion, compaction, GPU-generated indirect draw, and additive glow. GPU-produced counts,
  indices, and draw arguments remain GPU-only. The Forward+/Gaussian algorithms are acceptance-scale
  proofs, and the page is not a production performance baseline.
- Add a standalone interactive WebGPU compute-physics showcase with 65,536 persistent GPU bodies
  split between a readable Hilo3D word lattice and an independent deep-field collision layer of
  size-tiered stars, drifting aurora/nebula particles, and cyber-dune grains. Three-octave
  value/curl noise, magnetic/shockwave/vortex pointer fields, meteor-head collisions and wake
  forces, boundary physics, GPU-authored indirect arguments, and three particle raster layers stay
  on the public Render Graph/RHI path. Its deterministic test mode drives real pointer input without
  reading particle state back to the CPU.
- Keep storage texture writes write-only and complete for the selected single-mip view; overlapping
  sampled/write feedback remains invalid. Persistent texture state uses renderer-owned history
  recipes, while persistent buffer state uses externally owned renderer `StorageBuffer` objects
  imported per frame; each Renderer accepts one pending storage-buffer readback. `cpu-shadow`
  recovery restores CPU bytes rather than later GPU mutations, and Direct WGSL `f16` remains
  fail-closed until the Naga validation path can validate it end to end. Storage-aware graphics
  retains broader Material/Scene texture reflection, while `GPUDrivenRenderPass` validates explicit
  graph view dimension, format, and sample type before backend execution.
- Expose the built-in forward culling results to features, reject feature runtimes shared across
  Renderers, and preserve selected RenderTarget color/depth/stencil clear/load/store operations
  across feature-enabled scene, intermediate-color, and output passes.
- Reject pre-opaque scene-color sampling and keep the built-in forward feature's `sampledDepth`
  option fail-closed; a custom SRP can explicitly compose depth prepass, compute culling, and a
  storage-aware Scene pass for Forward+.
- Add backend-neutral `Renderer.waitForIdle()` for application completion fences. Native WebGL 2 or
  WebGPU interoperability is opt-in through `Renderer.getExtension()` instead of public `gl` or
  `gpuDevice` fields.
- Harden scriptable rendering with role-specific sampled/copy texture usage, pre-frame exact-copy
  validation, explicit resolve terminal tracking, per-invocation shadow binding isolation,
  effective-material transparent depth sorting, filterable fullscreen capability checks, complete
  recovery capability-superset validation, non-revivable per-invocation/per-callback lease facades
  over reusable internal storage, and an internal-only pass-pool acquisition path.
- Route `renderToTarget()` through the configured pipeline, make public graph handles unique across
  invocations, reject nested rendering through record/prepare/execute, add transactional per-key
  persistent-target release, preserve pre-draw Mesh event mutation before draw preparation, and
  align after-scene events/face counts with every renderer-list occurrence actually drawn by live
  graph passes.
- Keep backend selection outside the draw loop and preserve the existing native fast paths, state
  caches, prepared resources, and pass-level execution so the unified public surface adds no
  per-draw dispatch or allocation cost.
- Add one internal `RHIFactory` composition root for concrete RHI construction and support probes;
  backend drivers receive the concrete RHI directly rather than a command-forwarding facade.

### Fixes

- Keep the full WebGL2/WebGPU Playwright matrix in local/release validation, while GitHub hosted CI
  runs the stable WebGL2 UI/visual matrix and the native/offscreen WebGPU RHI lane instead of
  pretending its SwiftShader environment supports reliable canvas presentation.
- Route ShaderToy's two backend cases through its dedicated offscreen pixel/hash interaction gate
  instead of loading the same continuous ray-march page again in the generic gate, while retaining
  native draw/submit, GPU health, page, network, console, DevTools graphics, and stable-frame
  checks.
- Keep the portable RHI benchmark smoke bounded to a single-draw production scenario and isolate
  every scenario/backend in fresh Chromium. PR CI runs the stable WebGL 2 production smoke while
  WebGPU remains covered by dedicated RHI/browser lanes and the enrolled physical-GPU benchmark;
  local non-evidence WebGPU smoke avoids the physical-rig-only timestamp-query feature and uses the
  stable Playwright transport.
- Clear handled old-generation submission-fence failures across every renderer submission tracker
  only after successful device recovery, so a recovered renderer's `waitForIdle()` observes new
  failures without hiding tracker/collection errors.
- Restore the full portable Playwright UI, WebGPU, and visual matrix to `validate:ci`; the
  physical-GPU lane remains a separate manual workflow.
- Remove the production handwritten WebGPU mipmap WGSL module. Renderer initialization reuses its
  compiler and supplies required GLSL/Naga artifacts through the WebGPU RHI creation contract, while
  native shader, pipeline, view, and bind-group creation completes before frame execution.
- Preserve WebGL2 buffer capacity and portable texture-copy orientation, restore browser-managed
  external-image color conversion, reject unsupported WebGL2 stencil uploads and depth/stencil
  readbacks before native commands, validate render-attachment subresources and depth/stencil
  operations before backend execution, mark unused WebGPU combined depth/stencil sibling aspects
  read-only, reject pipelines that read an unavailable aspect or write a read-only/unused aspect,
  and reject partial WebGL2 compressed buffer uploads whose opaque blocks cannot preserve the
  portable top-left row contract without format-specific recompression.
- Make render-target release, replacement, and destroy cleanup resumable per handle so a cleanup
  failure retains its owner/record, never double-releases completed handles, and never leaks a
  staged replacement allocation.
- Elide unchanged vertex-buffer bindings between adjacent prepared draws and keep WebGPU
  buffer-range validation paths static, removing draw-count-amplified hot-path allocations without
  weakening the backend validation contract.

## Earlier 2.0.0 development baseline (2026-07-14)

### Breaking changes

- Replace the renderer-interface-only `Renderer` export with an abstract shared renderer base and a
  separate `RendererContract` type. Backend implementations now inherit common frame planning,
  render/light queues, diagnostics, and resource ownership from that base; the protected result is
  available as the exported `RenderGraphFramePlan` type for custom subclasses.
- Add the required synchronous `Renderer.renderFrame(callback)` application-frame boundary. Custom
  renderer implementations must provide it; callbacks may not return a Promise or retain the frame
  facade after returning.
- Make `UniformBuffer` a backend-neutral CPU/std140 object. Remove its WebGL-native `getBuffer()`,
  `bind()`, and `destroy()` methods; native allocations now belong to renderer-local WebGL/WebGPU
  managers and are released through renderer resource ownership.
- Make `Texture` a backend-neutral CPU descriptor. Remove `Texture.getCache()`, `reset()`,
  `getGLTexture()`, `setGLTexture()`, `updateTexture()`, the protected WebGL upload hooks, and the
  root `TextureWebGLState` type; WebGL allocation, upload revision, descriptor snapshot, and native
  cache ownership now belong to the renderer's texture manager/uploader.
- Restrict `TextureBinding` and `MaterialTexture` to engine `Texture<unknown>` objects so both
  backends consume one real resource contract. Remove the WebGL-native `location`, `type`, `size`,
  and `glTypeInfo` fields from `ProgramBindingInfo`.
- Change `Shader.reset(gl?)` to backend-independent `Shader.reset()`. Change `RendererFrameCallback`
  to return `unknown`; the runtime rejects Promise-like results and escaped frame facades rather
  than allowing asynchronous recording.
- Remove the unused WebGL-native `GeometryData.glBuffer` field. Geometry data now exposes only CPU
  content/revisions, while each backend owns its buffer variants.
- Make WebGPU manager/target suspend, device-rebind, and atomic attachment-replacement operations
  renderer-internal. Public `WebGPUTextureManager` mutations now preserve render-target ownership;
  `registerExternal()` rejects target-owned textures instead of creating detached allocations.
- Require Node.js 22.22.2 and npm 12 for development and releases.
- Publish a single ES2022 ESM package entry and remove CommonJS/UMD, global-script, and namespace
  declaration variants.
- Remove the dynamic `Class.create`/`Class.mix` and `EventMixin` APIs in favor of native classes and
  `EventDispatcher`; use backend-neutral `releaseGPUResources()` for renderer resource lifecycles.
- Require WebGL 2 when the WebGL backend is selected and native GLSL ES 3.00 for shader sources;
  remove WebGL 1 contexts, compatibility shader rewriting, and extension adapters for WebGL 2 core
  features.
- Change asynchronous `Stage.create()` to default to `backend: 'auto'`. Auto selection uses the
  public, device- and GPU-resource-free `WebGPURenderer.isSupported()` adapter probe and prefers
  WebGPU when the fallback-adapter policy, required features/limits, and engine minimum limits are
  satisfied; it otherwise creates WebGL 2 directly. The probe never requests a device or canvas
  context and never initializes the shader compiler, pipelines, or resources. Supplying
  `preserveDrawingBuffer` or requesting `alpha: true, premultipliedAlpha: false` straight-alpha
  compositing selects WebGL 2 directly. Synchronous `new Stage()` remains WebGL 2 by default because
  it cannot await adapter discovery.
- Keep explicit `backend: 'webgpu'` fail-closed with no fallback. Once auto has selected WebGPU,
  device/context creation, compiler, pipeline, and resource initialization errors also reject
  directly instead of being reinterpreted as capability failures.
- Make `Renderer`/`RenderTarget` the backend-neutral offscreen contract for WebGL 2 and WebGPU,
  including MRT, 1×/4× MSAA, sampleable attachments, target rendering, resize, and asynchronous
  readback. `MeshPicker` now accepts a `Stage` and returns `Promise<Mesh[]>` from a backend-neutral
  GPU object-ID pass with no CPU fallback.
- Remove the public `Framebuffer`, `LightShadow`, and `CubeLightShadow` types, public light
  `lightShadow` fields, renderer-owned `useFramebuffer`/`framebufferOption`, implicit render-target
  creation, and backend-specific framebuffer example. Native framebuffer and shadow allocation are
  renderer internals; the replacement example uses the shared `RenderTarget` contract.
- Remove the WebGL-cache-specific `logGLResource()` export. Use
  `renderer.resourceManager.getDiagnostics(rootNode?)` for stable backend-neutral ownership counts.
- Remove the context-blind `capabilities` and `extensions` singletons. WebGL 2 callers use the
  owning `WebGLRenderer.capabilities` and `WebGLRenderer.extensions`; remaining public low-level
  Program/Buffer/VAO cache inspection requires `getCache(gl)`, while Texture native caches are
  backend-private.
- Restrict shadow construction to directional, spot, and point lights through
  `ShadowCastingLightParameters`. Area, ambient, and base lights reject shadow configuration before
  backend selection instead of allowing a backend to ignore it.
- Require low-level `WebGPUTextureManager` construction to receive an already initialized
  `NagaShaderTranslator`; the optional resource-destroy callback moves to the third argument.
- Narrow `KTXLoadRequest` texture overrides to the exported `KTXTextureOptions` contract. Callers
  may set sampler, lifecycle, name, UV, and anisotropy options, but container-owned texel format,
  extent, image, mipmap, and compression metadata can no longer be overridden.
- Move every non-sampler shader value to the fixed std140 `FrameBlock`, `CameraBlock`, `SceneBlock`,
  `LightBlock`, `MaterialBlock`, `ModelBlock`, `GeometryBlock`, `SkinningBlock`, or `MorphBlock`
  ABI. Custom `ShaderMaterial` numeric uniforms must migrate to a registered UBO; samplers are the
  only classic uniform exception.
- Remove `KHR_techniques_webgl` loading and its GLSL 1.00 sample assets because the extension's
  arbitrary classic-uniform shader interface is incompatible with the fixed WebGL 2 UBO ABI.
- Remove the example-only Draco adapter and assets instead of retaining its build-time UMD/CommonJS
  wrapper rewrite; future decoder integrations must provide directly consumable ESM and strict
  TypeScript declarations.
- Remove the backend-specific `Texture.colorSpaceConversion` boolean. External images now always use
  the browser-standard sRGB-managed path, while raw TypedArray/DataView pixels remain explicit
  untagged values on both backends.
- Replace `Texture.updateSubTexture(xOffset, yOffset, image)` with the sole descriptor form
  `updateSubTexture({ mipLevel, face?, layer?, z?, x, y, width, height, depth?, image })`. The
  positional overload has been removed.
- Correct legacy public API spellings: `SkinedMesh` is now `SkinnedMesh`, `needBasicUnifroms` is
  `needBasicUniforms`, `ignoreTranparent` is `ignoreTransparent`, and the
  diffuse-environment/ambient-light material flag now uses its correctly spelled name.
- Replace the legacy Gulp, Webpack, Mocha, JSDoc and Electron toolchain with Vite, strict
  TypeScript, Vitest Browser Mode, Playwright, TypeDoc and ESLint flat config.

### Changes

- Add a WebGPU-shaped RHI with separate thin native WebGPU and immediate, state-cached WebGL 2
  implementations. It covers device resources, prepared shader modules, pipeline/layout/bind-group
  objects, render passes, command encoders, queues, surfaces, explicit features/limits, and
  device/context recovery without importing engine scene semantics.
- Split rendering code into explicit `renderer/common`, `renderer/shader`, `renderer/webgl`,
  `renderer/webgpu`, `rhi/webgl`, and `rhi/webgpu` boundaries. Move GLSL-to-WGSL compilation above
  the RHI, move WebGL shadow allocation under its renderer backend, and keep common frame planning
  free of native graphics handles.
- Give RHI devices bounded immutable sampler, bind-group-layout, pipeline-layout, and
  render-pipeline caches with fixed-field keys and deterministic loss/destroy invalidation. Keep
  material, Mesh, shader-variant, binding-set, and upload caches in Renderer; do not
  descriptor-deduplicate buffers, textures, shader modules, or bind groups in the RHI.
- Record resource-ready WebGPU scene, shadow, target, and presentation passes through an explicit
  application frame. One submission uses revision-snapshotted UBO slots so each camera/pass observes
  its own data; recording failures poison the frame instead of submitting partial commands.
- Add bounded per-group bind-group layout/resource caches, WebGPU sampler/snapshot and numeric-depth
  specialization LRUs, presentation bind-group reuse, pooled UBO submission slots, dirty-range
  instance uploads, and per-pass command-state deduplication.
- Move WebGL texture allocation/upload into a per-state manager and backend uploader, detect
  descriptor changes without replacing stable framebuffer texture objects, and release native
  allocations through an internal lifecycle channel that public events cannot cancel.
- Add a bounded immutable WebGLSampler cache with per-texture descriptor-key memoization and
  per-unit bindings. Numeric and comparison reads can share one depth texture without mutating its
  global state, and active samplers are never evicted from a texture unit.
- Track render-target attachment allocation generations across WebGL 2 and WebGPU. Texture target
  changes, failed uploads, and public attachment destruction now invalidate the previous allocation;
  targets rebuild or reattach before reuse and reject stale native handles.
- Protect pending WebGPU submissions from early target, buffer, texture, and shadow-atlas
  destruction; defer native retirement until submission ends and reject same-submission geometry or
  instance-buffer mutation instead of rewriting resources already referenced by recorded passes.
- Replace serialized shader variant keys with a bounded, structured dual-lane 64-bit hash, exact
  collision buckets, stable-draw revision snapshots, source-aware custom shader keys, and
  generation-safe cache release. GLSL ES 3.00 remains the only authored portable raster language;
  WebGPU-only compute/storage use the constrained source contracts described above.
- Migrate all maintained engine, test, example and tooling code to checked TypeScript without
  type-checking bypasses.
- Split TypeScript into referenced library, test, example and Node projects with strict shared
  rules.
- Generate bundled public declarations and API reports directly from the checked source.
- Add repository-wide typed linting, deterministic formatting and enforced browser coverage.
- Add Vite multi-page example builds and an automatically collected 80-HTML Playwright matrix.
  Seventy-eight pages run through WebGL 2 and WebGPU; `webxr.html` is explicitly WebGL 2-only while
  browsers expose XR presentation through `XRWebGLLayer`, and `compute_gpu_driven.html` is
  explicitly WebGPU-only because its required capabilities are not simulated on WebGL 2.
- Gate the same deterministic lit PBR readback and screenshot through both backends, and exercise
  fractional-DPR resizing, life-game and ShaderToy input, glTF Viewer load/replace/release, live
  post-process changes, native compressed textures, and GPU mesh picking on both backends. The first
  WebGL 2 and WebGPU frames must be byte-for-byte identical.
- Validate the packed package with publint, Are the Types Wrong, Bundler and NodeNext consumers, and
  ESM runtime loading.
- Generate and deploy the API documentation and examples site from TypeDoc and Vite in CI.
- Run the existing engine suite in headless Chromium with real WebGL contexts.
- Bundle the area-light LTC lookup data and skybox textures locally so rendering never depends on
  third-party runtime URLs.
- Remove obsolete `OES_standard_derivatives` and `WEBGL_depth_texture` requests because both are
  WebGL 2 core features, and enforce this class of WebGL 1 extension wrapper in the modernity gate.
- Add type-safe std140 layout packing, stable global uniform-block bindings, reflected range-size
  validation, partial dirty uploads, and static/runtime rejection of legacy shader interfaces.
- Keep GLSL ES 3.00 as the single portable raster shader source, prepare active variants as Vulkan
  GLSL 4.50, and translate them through Naga WASM to WGSL. Preparation assigns IO locations,
  separates texture and sampler bindings, maps the four WebGPU bind groups, and converts clip-space
  depth.
- Route renderer-owned fullscreen presentation and WebGPU mipmap generation through that same GLSL
  preprocessing and Naga path. Both consume translated sampler metadata and have no handwritten or
  fallback WGSL module; the modernity gate rejects graphics WGSL entry points and only permits
  Direct WGSL `@compute` structurally associated with `ComputeShader` validation.
- Express the shared std140 ABI in generated WGSL with explicit `@align`/`@size` wrappers that work
  with WebGPU's default language features; do not request or depend on the optional
  `uniform_buffer_standard_layout` feature.
- Load Naga through a dynamic ESM boundary so WebGL 2 consumers do not download its JavaScript/WASM
  graph; package smoke initializes Naga and translates GLSL from the installed tarball.
- Add WebGPU buffer, texture, uniform, bind-group, render-state, pipeline, and resource-lifecycle
  managers with device-limit validation and deterministic caches.
- Complete the GLSL ES 3.00 texture surface across WebGL 2 and WebGPU: `sampler3D`,
  `sampler2DArray`, `sampler2DArrayShadow`, and every signed/unsigned integer sampler family for 2D,
  3D, cube, and 2D-array textures now pass through Naga into dimension- and sample-type-correct bind
  groups. Managed `Texture` supports 2D, cube, 3D, and 2D-array targets plus signed/unsigned integer
  formats. Integer textures require nearest-only sampling, anisotropy 1, and explicit complete mip
  chains; mipmapped 3D textures also require explicit complete chains. Both backends reject
  compressed 3D textures before allocation, while native compressed 2D-array textures remain
  supported.
- Preserve dynamically-uniform sampler-array indexing by lowering flattened texture/sampler pairs
  into typed dispatch functions, including texture builtins, sampler function parameters, and
  multiple arrays. Add ordinary-sampler numeric depth reads by specializing Naga WGSL bindings to
  `texture_depth_*`; WebGPU enforces nearest-only non-filtering depth samplers, while WebGL 2
  selects comparison mode from reflected sampler types.
- Complete the shader preprocessing frontend with function-like macros, strict recursive expansion,
  bitwise/shift/ternary conditional expressions, named interface blocks, arrays, multi-declarations,
  reordered std140 layout qualifiers, and projective sampler operations. Reject builtins outside the
  GLSL ES 3.00/WebGL 2 contract before backend selection, and derive depth-only Naga variants that
  preserve discard/depth side effects without declaring dummy color outputs.
- Support descriptor-based subresource updates for 2D, cube, 3D, and 2D-array textures across both
  backends, including raw, external-image, and legal compressed block updates. Define cube mip
  chains as six entries per level in canonical `+X, -X, +Y, -Y, +Z, -Z` order; add portable raw
  depth16/depth32float and feature-gated depth32float-stencil8 uploads; reject nonportable raw depth
  tuples before allocation; and use physical 4×4 upload extents for compressed 2×2/1×1 mip tails.
- Cap each texture's sub-update journal at 64 entries while maintaining an exact full-content
  checkpoint. Independently paced WebGL contexts and WebGPU devices replay the checkpoint when
  behind and then resume incremental revisions. Route CubeTexture, DataTexture, and LazyTexture
  construction through the base validation contract and preserve loaded LazyTexture depth/wrapR.
- Make geometry, material, texture, and partial-upload revisions backend-local; add bounded cache
  eviction, transactional GPU resource replacement, immutable descriptor-keyed samplers, and
  destroy-during-initialization cleanup.
- Scope WebGL 2 program, buffer, vertex-array, texture, framebuffer, custom uniform-buffer,
  capability, extension, and current-binding state to the owning context. Multiple renderers no
  longer reuse native handles or destroy each other's allocations during release or context
  restoration; `Texture.needDestroy` invalidates old allocations across every WebGL context and
  WebGPU device instead of being consumed by only the first backend.
- Detect `MaterialBlock` changes from a reusable snapshot of the final std140 bytes, including
  direct mutations of nested color/matrix and texture-derived values, without requiring manual
  `isDirty`; unchanged bytes do not advance revisions or upload again.
- Give raw texture uploads one backend-neutral, tightly packed row contract; WebGL 2 and WebGPU now
  apply `flipY` to TypedArray/DataView sources in the same deterministic byte order.
- Upload WebGPU `HTMLVideoElement` textures from decoded-frame callbacks through a private staging
  canvas. Queue completion fences prevent the canvas from changing during a copy; source changes,
  release, and device recovery cancel and rebuild observation without a WebGL or placeholder
  fallback.
- Bound backend-neutral UBO dirty history with full-upload recovery for slow consumers. Own render
  state by `mesh → pass owner → material/shader/instancing variant`, cap each mesh at 32 variants
  with LRU eviction, atomically union resources across passes, and reclaim failed-frame and replaced
  identity resources without destroying shared final references.
- Upload dynamic WebGPU interleaved attributes and Uint8/16/32 indices by precise dirty ranges,
  including matrix columns, normalized/strided sources, discrete regions, 4-byte copy alignment,
  primitive-restart conversion, history-expiry fallback, buffer resize, and deterministic old-buffer
  destruction.
- Isolate shader structural/precision cache keys per geometry and renderer; keep pending pipeline
  compilations deduplicated outside the settled LRU and allow Naga initialization to retry after a
  transient failure. Remove the mutable global shader header and include canonical `commonOptions`
  snapshots in every header and shader-variant key.
- Recover automatically after WebGPU device loss: emit `webgpuDeviceLost`, safely skip renders,
  request a fresh equivalent adapter with the frozen initial options, revalidate the fallback policy
  plus all required features and limits, and request a replacement device with the same effective
  descriptor. Rebuild context/managers while preserving selected `RenderTarget` and attachment
  identities, then emit `webgpuDeviceRestored`. Emit `webgpuDeviceRecoveryFailed` and make later
  renders throw explicitly on failure; renderer destruction cancels in-flight or stale-generation
  recovery.
- Preserve engine-private, `Texture`-identity recovery backings for `isImageCanRelease` textures,
  including immutable raw/cube/mipmap/sub-texture snapshots and private external-source references,
  so a new WebGL 2 context allocation or WebGPU device can replay uploads without restoring access
  to the released public image.
- Keep `releaseGPUResources()` reusable on WebGPU by rebuilding main-canvas depth/MSAA attachments
  immediately instead of tearing down the device. Scope shadow cameras and debug helpers per
  renderer/light and prune them when debug, shadow, enabled, stage membership, release, recovery, or
  destruction changes ownership.
- Reject cross-stage UBO layout mismatches before Naga and keep generated entry-point
  post-processing correct when custom GLSL returns early.
- Add shared WebGL 2/WebGPU render targets with MRT, 1×/4× MSAA resolve, optional sampleable
  depth/stencil, explicit ownership/presentation, resize, and tightly packed asynchronous color
  readback. Attachment `Texture` identities survive resize and context/device recovery; WebGL 2
  resize updates every draw/resolve/depth attachment transactionally. Both backends present through
  fullscreen texture-load pipelines; WebGL 2 restores canvas and saved framebuffer state on every
  clear/resolve failure instead of blitting into an antialiased default framebuffer. WebGPU keeps
  its required 256-byte row alignment internal to the implementation.
- Build post-processing ping-pong passes and asynchronous `MeshPicker` exclusively on the shared
  render-target contract, with dual-backend interaction tests and no hidden fallback path.
- Normalize `LINE_LOOP` and `TRIANGLE_FAN` to explicit `LINES` and `TRIANGLES` indices before upload
  for indexed, non-indexed, and glTF-loaded geometry, so WebGL 2 and WebGPU consume the same
  topology.
- Add shared compressed-texture capability queries. WebGPU enables adapter-exposed BC, ETC2, and
  ASTC device features, maps all ten WebGL 2 core ETC2/EAC formats, and explicitly rejects PVRTC
  instead of substituting or decoding it. Both backends require an exact, dimensionally valid mip
  chain when a mipmap filter is selected, while the KTX loader continues to accept legal base-only
  and partial chains for non-mipmap sampling. KTX1 parsing honors container endianness for headers
  and mip sizes, rejects truncation, and keeps container texel metadata authoritative over request
  options.
- Replace WebGL cache logging with backend-neutral tracked/used/pending resource diagnostics.
- Partition WebGPU resources by update frequency: global/pass resources in group 0, material and
  texture resources in group 1, object/geometry/pose resources in group 2, and custom blocks in
  group 3. Instanced transforms use the bounded `InstanceBlock` instead of matrix vertex attributes.
- Add Naga compilation coverage for the built-in shader feature corpus and a dedicated Playwright
  test that creates a real Chromium WebGPU adapter/device/pipeline and exercises Basic/PBR,
  instancing, indexed strips with partial updates, mipmapped texture replacement, three shadow-light
  kinds, 4× MSAA/stencil, MRT, presentation, and readback through SwiftShader. This fixture actively
  destroys the device, verifies fresh adapter/device recovery, released-texture replay, selected
  `RenderTarget` identity, and exact pre/post-recovery readback. It supplements the full
  example-gallery WebGPU matrix; it is not the only WebGPU UI path.
- Extend that real-browser WebGPU gate with managed 3D, 2D-array, integer-array, and depth-array
  textures. It translates the extended sampler set through Naga, builds the actual bind groups and
  pipeline, draws and submits without shader-compilation or GPU-validation errors, and requires the
  exact `[64, 128, 200, 255]` pixel readback.
- Require all 155 page/backend cases to observe a real WebGL draw or WebGPU canvas acquisition,
  render-pass draw, and queue submission, with page, network, console, GPU validation, uncaptured
  error, and unexpected device-loss failures promoted to release-gate failures. After the
  stable-frame window, fence every observed real `GPUQueue` with `onSubmittedWorkDone()` before the
  final instrumentation sample so delayed validation events cannot arrive after a passing result.
  Interaction gates additionally require action-local draw/submit progress and GPU readback changes
  for life-game attachment updates, ShaderToy pointer input, post-process kernels, and glTF Viewer
  replacement. WebGPU color render-target allocations include `COPY_DST`, so public attachment
  `updateSubTexture()` writes are real GPU updates rather than ignored validation errors.
- Add an explicit optional native WebGPU Playwright project and manual self-hosted GPU workflow. It
  requests `forceFallbackAdapter: false`, disables Chromium's software rasterizer, rejects fallback
  and known software adapters, and reuses the production draw/recovery/readback fixture without
  pretending that physical GPU availability is a portable PR or release requirement. WebXR remains
  excluded from the WebGPU gate.
- Expand WebGL 2 instanced matrix attributes into legal column locations, preserve independent read
  and draw framebuffer bindings across reset/check/bind/unbind transactions, reject cross-context
  framebuffer copies, and route reflected `ivec*`/`uvec*` inputs through strictly typed
  `vertexAttribIPointer` calls. Keep point-shadow cube attachments square and complete. Refresh
  `CameraBlock` for each of the six point-shadow faces even though the shadow camera object is
  reused. Prepare ShaderToy derivatives in uniform control flow so the same GLSL compiles cleanly
  through Naga and Dawn.
- Render WebGPU directional, spot, and point-light shadows through a comparison depth atlas whose
  rects, matrices, and bias data live in `LightBlock`. Restrict shadow parameters to those three
  light kinds and reject Area/Ambient/base-light shadow assignment before backend selection.
- Make package entry evaluation safe in non-browser runtimes.
- Fix the `COPY_WRITE_BUFFER_BINDING` WebGL2 constant.

## [1.19.1](https://github.com/hiloteam/Hilo3d/compare/1.19.0...1.19.1) (2025-10-15)

### Bug Fixes

- Fix WebGLResourceManager.destroyUnusedResource typo
  ([c8c9075](https://github.com/hiloteam/Hilo3d/commit/c8c9075fd0ece73c5c65adb28e997d2229e35b5c))
- github workflows node not found
  ([c1d1eea](https://github.com/hiloteam/Hilo3d/commit/c1d1eea617bd7b873beb0bd7618072849fd95bff))
- remove uc browser game mode support
  ([58401a5](https://github.com/hiloteam/Hilo3d/commit/58401a54f596f8c60c595a50c25bb8dd823e8a2f))
- return a white texture when the texture is missing in semantic.handlerTexture
  ([f38bd14](https://github.com/hiloteam/Hilo3d/commit/f38bd1456e7d258c73b5022930401fa38f29b72c))
- The stencilMask method should be passed a numeric parameter
  ([33f71d9](https://github.com/hiloteam/Hilo3d/commit/33f71d9482dab23eea107a4669475c71c4aa425a))

### Features

- add webxr demo
  ([7610e68](https://github.com/hiloteam/Hilo3d/commit/7610e682299690da1d2bd5d18770fd2974bc52da))
- fire event while render mesh
  ([85923a7](https://github.com/hiloteam/Hilo3d/commit/85923a727c798e0904e881d51c3e4a50a4869eed))

# [1.19.0](https://github.com/hiloteam/Hilo3d/compare/1.18.0...1.19.0) (2023-05-05)

### Bug Fixes

- Fix Framebuffer unbind bug
  ([bd8557c](https://github.com/hiloteam/Hilo3d/commit/bd8557cac5b669b1c09cea411f463c6e349f632f))
- Implement the transpose function only in webgl1
  ([012a4f7](https://github.com/hiloteam/Hilo3d/commit/012a4f7cda33b76a03932c17525b5fafc40c0efc))

### Features

- Add material.getShadowMaterial to allow users to customize shadow material
  ([21fde64](https://github.com/hiloteam/Hilo3d/commit/21fde64c332f544f0acf43c0981841040bab9587))
- Add the ability to visualize shadow camera for debug
  ([a327a69](https://github.com/hiloteam/Hilo3d/commit/a327a69247b48637b3e72104644b4dbaf8f75236))
- Add the enableShadow property to lightManager to control whether to generate shadow map
  ([fe1b99c](https://github.com/hiloteam/Hilo3d/commit/fe1b99ceb644eabe5fc64952f16a950ebeb60be3))
- Add the ILightManager interface, which allows users to implement their own lighting controls
  ([8075db3](https://github.com/hiloteam/Hilo3d/commit/8075db3f128362ed188976a81839773f46724dc7))
- Add the onlySyncQuaternion attribute of Node to optimize performance
  ([0739e6a](https://github.com/hiloteam/Hilo3d/commit/0739e6ad9198cd6b91e6cd381986a8686b936a76))
- Add worldMatrixVersion attribute to node for performance optimization
  ([6f8d76b](https://github.com/hiloteam/Hilo3d/commit/6f8d76b70ae563c69c5d1d89549e7f638dd663d6))
- Store shadow map Z in four channels to optimize precision
  ([5bba760](https://github.com/hiloteam/Hilo3d/commit/5bba76065d8ac081a2515026f7dd9b638af07fb9))

### Performance Improvements

- Optimize the performance of node transform changes
  ([5a263cf](https://github.com/hiloteam/Hilo3d/commit/5a263cfdb4366295c9b749a1d205fb56495a4c98))

# [1.18.0](https://github.com/hiloteam/Hilo3d/compare/1.17.0...1.18.0) (2023-01-29)

### Bug Fixes

- Fix Texture reset internalFormat bug
  ([2b3f534](https://github.com/hiloteam/Hilo3d/commit/2b3f534a4af77e3c3ee717879776b5feab5b591e))
- framebuffer resize should resize all attachments
  ([2b8aa0b](https://github.com/hiloteam/Hilo3d/commit/2b8aa0b38df7b0ec745d40c3861733cea6e7595a))

### Features

- add framebuffer drawBuffers
  ([2f68dc1](https://github.com/hiloteam/Hilo3d/commit/2f68dc101b9848d3252e4112fbea9eb441870f10))
- add uniform buffer object support
  ([03d2fa3](https://github.com/hiloteam/Hilo3d/commit/03d2fa3630664c04b79a163c969e443e95594070))

# [1.17.0](https://github.com/hiloteam/Hilo3d/compare/1.16.4...1.17.0) (2022-12-19)

### Features

- Add WebGL2 support ([#40](https://github.com/hiloteam/Hilo3d/issues/40))
  ([3dc82ec](https://github.com/hiloteam/Hilo3d/commit/3dc82ec8f0ce8880413e6e756a57108baa81b77e))

## [1.16.4](https://github.com/hiloteam/Hilo3d/compare/1.16.3...1.16.4) (2022-11-14)

### Bug Fixes

- add TypedArray forEach polyfill to fix iOS9 bug
  ([59bf238](https://github.com/hiloteam/Hilo3d/commit/59bf238e12a63fc58e937f083ed77f2204e0bbce))
- Fix the bug of destroying mesh when using multiple materials
  ([e9e0175](https://github.com/hiloteam/Hilo3d/commit/e9e0175036631ec7649aaf16bac06b4a5e9599a9))
- wrong value in get shadow pcf while pos out of range
  ([#39](https://github.com/hiloteam/Hilo3d/issues/39))
  ([f8a425a](https://github.com/hiloteam/Hilo3d/commit/f8a425a0aaf4ad7cc8f177af9ead230f90902e0e))

## [1.16.3](https://github.com/hiloteam/Hilo3d/compare/1.16.2...1.16.3) (2022-08-24)

### Bug Fixes

- Fix animation normalization bug
  ([35b5d19](https://github.com/hiloteam/Hilo3d/commit/35b5d194777e8d7fc3b5b3c1adc853a372e50d68))
- Fix pointerChildren value judgment error during node raycast
  ([4eee579](https://github.com/hiloteam/Hilo3d/commit/4eee5798cc5eefe7451af8d8317ecc1fe3d6e333))
- Fix frontface should be set in all cases
  ([6ccc39d](https://github.com/hiloteam/Hilo3d/commit/6ccc39de8ad048acd2602e5005c942422ac320fe))
- Fix in some cases, detecting the supportTransform property will report an error
  ([9215ba6](https://github.com/hiloteam/Hilo3d/commit/9215ba663bb44a4838cfe71ddf300be0dd8ef2b4))

### Features

- add lightManager.updateCustomInfo
  ([cc6d95b](https://github.com/hiloteam/Hilo3d/commit/cc6d95bae1b1d8732e066314a7511a13dbe71991))

## [1.16.2](https://github.com/hiloteam/Hilo3d/compare/1.16.1...1.16.2) (2022-03-24)

### Bug Fixes

- in KHR_techniques_webgl, premultiplyAlpha of material default value should be false
  ([bdf4100](https://github.com/hiloteam/Hilo3d/commit/bdf41003b803c50fad7e43ec9992c6fc33a14111))

## [1.16.1](https://github.com/hiloteam/Hilo3d/compare/1.16.0...1.16.1) (2022-03-23)

### Features

- add _Time semantic
  ([4a9a43d](https://github.com/hiloteam/Hilo3d/commit/4a9a43de486e295a50863d3c064e6687098a44f1))
- add material.shaderName
  ([25b1880](https://github.com/hiloteam/Hilo3d/commit/25b1880aaf56c6e0b172e19c984741cc7a17a0b0))
- imporve parsing of glTF KHR_techniques_webgl extension
  ([ca69682](https://github.com/hiloteam/Hilo3d/commit/ca6968209eada71714591122a3ee64d74a482c71))

# [1.16.0](https://github.com/hiloteam/Hilo3d/compare/1.15.20...1.16.0) (2022-01-04)

### Bug Fixes

- KHR_techniques_webgl parse texture bug
  ([f45879e](https://github.com/hiloteam/Hilo3d/commit/f45879ed7b826eb6049e14069120f0c2e3192f6b))
- pbr shader texture lod bug
  ([8256991](https://github.com/hiloteam/Hilo3d/commit/825699140ccc44bf7b9bbc83769526a5fac9584c))
- the nextTick callback of ticker should pass in the dt parameter
  ([db267cb](https://github.com/hiloteam/Hilo3d/commit/db267cb06d40bdb8ad63a3db7d14ca3ed1a43f71))
- unlit material transparency bug
  ([1006c60](https://github.com/hiloteam/Hilo3d/commit/1006c60340c511a908fd90d5ef8f331b1749d468))

### Features

- add JOINT & WEIGHT semantic
  ([2a9da6a](https://github.com/hiloteam/Hilo3d/commit/2a9da6aa59113c8e5f0d7cd4df46a938cd2e7d15))
- Add the function of dynamically modifying the targetFPS of the ticker
  ([e41f6cf](https://github.com/hiloteam/Hilo3d/commit/e41f6cf521040b0ffa0bf32b980eca1de0c15f84))

## [1.15.20](https://github.com/hiloteam/Hilo3d/compare/1.15.19...1.15.20) (2021-07-19)

### Bug Fixes

- the webglContextLost & webglContextRestored event should be triggered last
  ([87c9d2d](https://github.com/hiloteam/Hilo3d/commit/87c9d2d8ed9b2005f990db6acdab2e1e107058d9))

## [1.15.19](https://github.com/hiloteam/Hilo3d/compare/1.15.18...1.15.19) (2021-05-20)

### Features

- add wrapS & wrapT property of the framebuffer
  ([eaae512](https://github.com/hiloteam/Hilo3d/commit/eaae5129fc4324ece40d652bf7b76c625ef36d9b))

## [1.15.18](https://github.com/hiloteam/Hilo3d/compare/1.15.17...1.15.18) (2021-05-14)

- update doc & .d.ts

## [1.15.17](https://github.com/hiloteam/Hilo3d/compare/1.15.16...1.15.17) (2021-02-22)

### Bug Fixes

- glTF texture should ignore texture colorspace conversion, fix
  [#32](https://github.com/hiloteam/Hilo3d/issues/32)
  ([08f1252](https://github.com/hiloteam/Hilo3d/commit/08f1252e4658131f425419f25c21313859645aea))

### Features

- add colorSpaceConversion property of the texture
  ([ddd170b](https://github.com/hiloteam/Hilo3d/commit/ddd170be451b7f76103f54d31ab934398254da2b))
- add PBRMaterial emissionFactor support
  ([de7cf25](https://github.com/hiloteam/Hilo3d/commit/de7cf25fd36cbc845fa829f7270f95e8f7aaa795))

## [1.15.16](https://github.com/hiloteam/Hilo3d/compare/1.15.15...1.15.16) (2021-01-20)

- update doc & .d.ts
- refactor: optimize multiple destroy framebuffer
  ([c68599e](https://github.com/hiloteam/Hilo3d/commit/c68599e131c2f1b258d5675884cdcc06fcdda279))

## [1.15.15](https://github.com/hiloteam/Hilo3d/compare/1.15.14...1.15.15) (2021-01-05)

### Bug Fixes

- Animation.clipTime should be updated while updating the animStatesList
  ([447ae1e](https://github.com/hiloteam/Hilo3d/commit/447ae1e75a2213865a9ed42ac08a048ecf0ac9a5))

## [1.15.14](https://github.com/hiloteam/Hilo3d/compare/1.15.13...1.15.14) (2020-12-15)

### Features

- add LoadCache.getLoaded
  ([302c690](https://github.com/hiloteam/Hilo3d/commit/302c690b341c30537510f8b1b56cccc491a217b8))
- add Loader.preHandlerUrl
  ([ed7ff87](https://github.com/hiloteam/Hilo3d/commit/ed7ff8715701bbd5d81278985d88b76597297171))

## [1.15.13](https://github.com/hiloteam/Hilo3d/compare/1.15.12...1.15.13) (2020-11-18)

### Bug Fixes

- RenderList.useInstanced should update after renderer init
  ([d91293e](https://github.com/hiloteam/Hilo3d/commit/d91293ec2cefb7041ceb727aa07db7b37f229ba4))

## [1.15.12](https://github.com/hiloteam/Hilo3d/compare/1.15.11...1.15.12) (2020-11-05)

### Bug Fixes

- Semantic Tangent data should also be returned when there is no normal map
  ([c7b261b](https://github.com/hiloteam/Hilo3d/commit/c7b261b08803b6c4a0b185a9bac26e8725cf3e5d))

### Features

- Add GLTFLoader KHR_materials_clearcoat extension support
  ([0cfa90c](https://github.com/hiloteam/Hilo3d/commit/0cfa90c5109f8cd06aaa0478cc93fae1e4aeed00))
- Add material stencil support, close [#30](https://github.com/hiloteam/Hilo3d/issues/30)
  ([6dbb2c1](https://github.com/hiloteam/Hilo3d/commit/6dbb2c1530e47ba8a5ab5e148cdc4565a921cded))
- Add PBRMaterial Clearcoat support, close [#15](https://github.com/hiloteam/Hilo3d/issues/15)
  ([b83cbe6](https://github.com/hiloteam/Hilo3d/commit/b83cbe62dd243e1987573ab85871c5f64aaef68e))

## [1.15.11](https://github.com/hiloteam/Hilo3d/compare/1.15.10...1.15.11) (2020-10-19)

### Bug Fixes

- attribute pointer should use GeometryData.size
  ([bdab767](https://github.com/hiloteam/Hilo3d/commit/bdab767f621b17cb5fdd00ce633c1571383f91b0))

## [1.15.10](https://github.com/hiloteam/Hilo3d/compare/1.15.9...1.15.10) (2020-10-13)

### Bug Fixes

- Add light.isDirty and fix the bug that directionalLight lignt shadow does not update
  ([d808a89](https://github.com/hiloteam/Hilo3d/commit/d808a8992366c9d7537a26836f472bfd4ae1d051))

### Features

- add material.frontFace
  ([ef85b56](https://github.com/hiloteam/Hilo3d/commit/ef85b56f2eb1170ac2763deee2d059d514c08297))

## [1.15.9](https://github.com/hiloteam/Hilo3d/compare/1.15.8...1.15.9) (2020-09-10)

### Bug Fixes

- capabilities remove duplicate MAX_COMBINED_TEXTURE_IMAGE_UNITS
  ([f601071](https://github.com/hiloteam/Hilo3d/commit/f6010717e78dcf3e96e482797016bf71143e8d32))

### Features

- add userData property to Node,Geometry,Material and Skeleton
  ([40db285](https://github.com/hiloteam/Hilo3d/commit/40db285bfd5e3299b8e94931bed453b2a583d964))

## [1.15.8](https://github.com/hiloteam/Hilo3d/compare/1.15.7...1.15.8) (2020-09-01)

- update doc & .d.ts

## [1.15.7](https://github.com/hiloteam/Hilo3d/compare/1.15.6...1.15.7) (2020-08-31)

### Bug Fixes

- iOS 9 doesn't support TypedArray slice, add polyfill
  ([7ad428a](https://github.com/hiloteam/Hilo3d/commit/7ad428ac71cd8a72ed8f601dd8e43097de7075ee))

## [1.15.6](https://github.com/hiloteam/Hilo3d/compare/1.15.5...1.15.6) (2020-08-26)

- update doc & .d.ts

## [1.15.5](https://github.com/hiloteam/Hilo3d/compare/1.15.4...1.15.5) (2020-07-31)

### Bug Fixes

- vao.getResources miss checking whether the attribute is empty
  ([40ea681](https://github.com/hiloteam/Hilo3d/commit/40ea681bc8189081a784600522977d17e48a8486))

### Features

- add pbrMaterial.isSpecularEnvMapIncludeMipmaps
  ([#23](https://github.com/hiloteam/Hilo3d/issues/23))
  ([fea3cdf](https://github.com/hiloteam/Hilo3d/commit/fea3cdfaded3c34452ba7bcf2273e74fd5fa76cb))

## [1.15.4](https://github.com/hiloteam/Hilo3d/compare/1.15.3...1.15.4) (2020-07-07)

### Bug Fixes

- skeleton.clone should also clone jointNames
  ([8168c64](https://github.com/hiloteam/Hilo3d/commit/8168c6457fb51f5d5df1119dde202956b0a5ac8e))

## [1.15.3](https://github.com/hiloteam/Hilo3d/compare/1.15.2...1.15.3) (2020-07-03)

### Bug Fixes

- skinnedMesh bone position is wrong under special circumstances
  ([cccd91e](https://github.com/hiloteam/Hilo3d/commit/cccd91e0dc2c552922c0083293532530ee56428d))

## [1.15.2](https://github.com/hiloteam/Hilo3d/compare/1.15.1...1.15.2) (2020-06-30)

### Bug Fixes

- ResourceManager.destroyUnsuedResource parameter become optional
  ([3e15fbe](https://github.com/hiloteam/Hilo3d/commit/3e15fbe9d6c141e580e85bfe97bd11cb253c4d0d))

## [1.15.1](https://github.com/hiloteam/Hilo3d/compare/1.15.0...1.15.1) (2020-06-24)

### Features

- add skeleton.resetJointNamesByNodeName
  ([91418e4](https://github.com/hiloteam/Hilo3d/commit/91418e4e3521a33e9b3dcf5a05df0da7f4460dee))

# [1.15.0](https://github.com/hiloteam/Hilo3d/compare/1.14.0...1.15.0) (2020-06-24)

### Bug Fixes

- cubic spline interpolation for quaternions is wrong
  ([47a93ab](https://github.com/hiloteam/Hilo3d/commit/47a93abef05435236dab150146e37031476c113c))
- geometryData bindLayout change should repoint attribute
  ([25d1282](https://github.com/hiloteam/Hilo3d/commit/25d12826b77dbfdff51ff647aaca90dcbea0be93))

### Features

- Add easier log level control
  ([b0a2870](https://github.com/hiloteam/Hilo3d/commit/b0a28708be3fbfa5714c4daeee6bbd1965d4a094))
- add Skeleton ([#9](https://github.com/hiloteam/Hilo3d/issues/9))
  ([7944d70](https://github.com/hiloteam/Hilo3d/commit/7944d70eed88a694875e4a8842c53131a490f982))
- add SkinedMesh.resetJointNamesByNodeName
  ([14f095b](https://github.com/hiloteam/Hilo3d/commit/14f095b49de7a8819563b2ddc331069019e0bbeb))
- add skinedMesh.resetSkinIndices
  ([b7df689](https://github.com/hiloteam/Hilo3d/commit/b7df689785484f731fb1952ad9783926850d8ee8))

### Performance Improvements

- improve resource management performance ([#10](https://github.com/hiloteam/Hilo3d/issues/10))
  ([6ff8cbd](https://github.com/hiloteam/Hilo3d/commit/6ff8cbd73f622ac2d47a895e797dabfca37084aa))

# [1.14.0](https://github.com/hiloteam/Hilo3d/compare/1.13.47...1.14.0) (2020-05-06)

### Bug Fixes

- GLTFParser.getImageType use indexOf check support type
  ([262dfb8](https://github.com/hiloteam/Hilo3d/commit/262dfb8d931b421a0d56b2bb7ef1522e6c6f8682))

### Features

- add GeometryData.getCopy
  ([4a03269](https://github.com/hiloteam/Hilo3d/commit/4a0326911c0cd83dcb362ef5c2d19a0c9614ab36))
- AnimationStates support custom State handler register
  ([cda1d01](https://github.com/hiloteam/Hilo3d/commit/cda1d012e0596c7114a0f8eac9ab3e83f7ad1141))

## [1.13.47](https://github.com/hiloteam/Hilo3d/compare/1.13.46...1.13.47) (2020-01-07)

### Bug Fixes

- LazyTexture release ktx image buffer data has not work
  ([321f017](https://github.com/hiloteam/Hilo3d/commit/321f017c20f6ef49b91704def1901831626f3b4a))

## [1.13.46](https://github.com/hiloteam/Hilo3d/compare/1.13.45...1.13.46) (2019-12-31)

### Performance Improvements

- optimize Buffer.uploadGeometryData
  ([152ec21](https://github.com/hiloteam/Hilo3d/commit/152ec2156002b02ca11a3a4dd8d23ce735176d44))
