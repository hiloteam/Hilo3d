# Scriptable Render Pipeline

Status: current contract, reviewed against source commit `6433334c` on 2026-09-20. The
[original implementation plan](./archive/SCRIPTABLE_RENDER_PIPELINE_PLAN.md) is historical. Pending
performance evidence is tracked in [the roadmap](./ROADMAP.md).

## Ownership and frame order

Every renderer owns one `RenderPipelineHost` and one pipeline runtime. `Renderer.create()` and
`Stage.create()` accept a reusable `RenderPipelineFactory`; omitting it creates an independent
default Forward runtime. Default and custom pipelines both receive a frame-scoped context and call
the same synchronous `record()` boundary. There is no retained default direct-recorder shortcut.

```text
Stage / Renderer.render() / Renderer.renderFrame()
  -> RenderPipelineHost: application frame, leases, transactions
  -> RenderPipeline.record(context): shared scene and graph operations
  -> RenderGraphFrame: setup -> compile -> prepare -> execute -> submit
  -> portable RHI -> WebGL2 / WebGPU
```

The shared renderer owns scene collection, culling, sorting, instancing, shadows, draw preparation,
uploads and resource recovery. A pipeline chooses their composition; it does not reimplement them or
access native GPU handles. Multi-camera rendering records into the same application graph and
submission. See [rendering architecture](./RENDERING_ARCHITECTURE.md).

## Factories, requirements and runtime

- Factory requirements are snapshotted before backend selection. Required capabilities, formats and
  limits are checked before runtime creation. A compute/storage requirement restricts selection to
  WebGPU; explicit WebGL2 or incompatible canvas options fail at creation.
- A factory may create its renderer-local runtime asynchronously during renderer creation. Frame
  recording and pass callbacks are synchronous; promise-like results are rejected.
- Creation methods expire when that factory invocation settles. Concurrent initialization is
  rejected; a factory result arriving after host destruction is cleaned up without reviving the host
  or destroying a runtime already owned by another renderer.
- Factories/configuration can be shared, but mutable runtimes, resource keys, caches and parameter
  pools belong to one renderer. Reusing an already attached feature runtime is rejected.
- Contexts and pass/feature facades are leased to an invocation or callback. Saving one for a later
  callback/frame does not make it valid when internal storage is reused.
- Public signatures live in [RenderPipeline](../src/render/pipeline/RenderPipeline.ts),
  [ForwardRenderPipeline](../src/render/pipeline/ForwardRenderPipeline.ts), and the generated API.
- Creation contexts can allocate runtime-owned render targets. The runtime destroys these targets;
  renderer resource release recreates their recipes and sampled bindings without changing identity.
  `recordView(camera, target, callback)` records auxiliary cameras before parent culling, with
  isolated camera/light/shadow/handle scopes in the same graph and submission. Parent leases are
  suspended; nested auxiliary views, async callbacks and partial submission after a caught callback
  failure are rejected. See [local reflection capture](./LOCAL_REFLECTIONS.md).

## Default Forward and features

Use `ForwardRenderPipelineFactory` to add reusable features or configure scene color and opaque
scene capture. `PostProcessRenderPipelineFactory` assembles common effects; see
[PBR and post-processing](./PBR_AND_POST_PROCESSING.md) and [checked recipes](./RECIPES.md).

The injection points, in order, are:

1. `before-shadow`, `after-shadow`;
2. `before-opaque`, `after-opaque`;
3. `before-transparent`, `after-transparent`;
4. `before-post-process`, `after-post-process`;
5. `before-output`.

Each feature declares sampled color/depth, split-scene and device requirements before recording.
Runtime depth/split requests and scene scale use the public runtime hooks. A feature may replace
scene color only with its explicit `linear`/`srgb` encoding. The final surface boundary performs
exactly one transfer. Keep Bloom in linear HDR before display conversion.

Feature runtimes receive callback-scoped scene resources and culling results. Reuse parameter pools
instead of allocating draw descriptors in execution. The default pipeline also hosts optional GPU
particle features; these remain inactive when no supported emitters are present.

Optional requirement, scale and notification methods are captured once during feature runtime
creation. Change the state read by these methods rather than replacing the methods after attachment.
Forward stores only implemented callbacks in its dispatch lists. GPU addon depth requirements are
queried once across opaque/transparent phases and skipped on unsupported devices; requirement
searches stop after a qualifying node, and portable raster discovery prunes hidden subtrees.

## Scene and graph operations

| Operation                         | Contract                                                                                                                                       |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `cull()` / `createRendererList()` | Reuse shared visibility, ordering, material and geometry preparation; handles are invocation-scoped.                                           |
| `prepareScene()`                  | Update transforms/camera without building a CPU list; GPU-driven pipelines can collect their own database and cull only compatibility content. |
| `recordShadows()`                 | Reuse the shared shadow atlas, cache, resources and recovery.                                                                                  |
| Scene/fullscreen/copy passes      | Declare exact graph reads, writes and outputs; do not issue commands while setting up the graph.                                               |
| Transient textures/buffers        | Frame-owned, validated before execution and recycled after submission lifetime allows.                                                         |
| Imported targets/textures/storage | Keep explicit ownership and usage; imports do not transfer application ownership.                                                              |
| Persistent targets/history        | Renderer-owned recipes; resize, release, recovery and validity use the shared lifecycle.                                                       |

The narrow public graph is [ScriptableRenderGraph](../src/render/pipeline/ScriptableRenderGraph.ts).
Portable RHI and internal graph implementation types are not a consumer API. For compute, indirect
draw and readonly storage raster, use [Compute and storage](./COMPUTE_AND_STORAGE.md).

## Pass phases and failure

- `setup`: declare resources, accesses and dependencies. Graph validation rejects uninitialized
  reads, incompatible descriptors, feedback and cycles before the RHI frame begins.
- `prepare`: resolve reusable shaders, pipelines, bindings and vertex inputs. Do not emit commands.
- `execute`: emit commands using the prepared resources and declared scope.
- Successful submission commits staged uploads, cache revisions, resource use and temporal state.
  `frameSubmitted()` advances runtime history; discarded frames invoke rollback hooks.
- Submission, discard and destruction hooks finish synchronously. A failing feature or addon does
  not prevent the remaining owners from being notified and cleaned up; errors are reported after
  that work. Rejected asynchronous phase callbacks are observed as well as rejected synchronously.
- Before submission, failure aborts the frame and preserves committed CPU/history state. After
  submission, publication errors do not undo accepted GPU work: resource tracking and ownership
  transfer finish before errors reach the caller. A submission already marked failed does not
  advance runtime/history state.

Timeline observers consume immutable snapshots outside the recording/command scope. Their optional
Promises are observed and reported through the timeline error path; they are not awaited as part of
frame submission and do not extend the lifetime of recording contexts.

Destroy and device/context recovery remain submission-aware. Persistent resource identity is stable
while backend generations change. History is invalidated when its recipe or generation changes;
never consume a stale device's view or infer successful submission from recording alone.

Persistent targets must use one descriptor per key throughout an application frame, including when
the first acquisition reuses an existing allocation. History resize and release keep failed cleanup
ownership for a later retry. Frame completion visits only resources acquired or released in that
frame; it does not scan every dormant persistent target and history.

Texture view reuse still aggregates every requested parent usage. Read, copy, storage and attachment
roles share a view only when they resolve to the same physical texture; MSAA attachment and resolve
textures remain distinct.

## Shader and performance contract

Portable raster uses GLSL ES 3.00, std140 blocks, semantic material roles and the common preprocess
-> Vulkan GLSL 4.50 -> Naga -> WGSL chain. Managed image/attachment UVs cross exactly one
normalization boundary. Compute and storage raster have the explicit exceptions described in
[Compute and storage](./COMPUTE_AND_STORAGE.md).

There are no per-backend feature stacks. Draw execution does not allocate facade wrappers, native
descriptors, proxy materials or a second command stream. Reusable JavaScript fullscreen parameter
storage does not imply native bind groups referencing transient views can survive the frame; those
are destroyed after their submission fence.

Execute facades and their unique lease tokens are created during preparation; execution activates
them once and invalidates them on exit. Persistent scriptable bind-group cache hits compare existing
recipes directly without rebuilding recipe objects. Destroying a storage buffer invalidates only
groups indexed by that dependency, and native retirement continues to wait for the submission fence.
Compute uniform buffers are prepared and enlisted for upload only when the graph keeps their pass;
setup records the source and range without creating the native buffer.

These are structural constraints, not a claim of measured zero allocation or no timing regression.
The old plan's proposed `benchmark:srp:*` commands are not implemented. A dedicated, reviewed
cross-commit SRP protocol and baseline remain an explicit evidence gate in the roadmap. Do not
restore legacy rendering to create a same-commit comparison.

## Examples and validation

[CHROMATIC](../examples/scriptable_pipeline.html) composes portable fullscreen effects through
[scriptablePipelineEffects](../examples/shared/scriptablePipelineEffects.ts); it retains shared PBR,
shadows and `OrbitControls`. Its [browser test](../test/ui/scriptable-pipeline.spec.ts) covers real
draws, interaction, dual-backend output and lifecycle. Frozen screenshots and historical timing
records are in the archived plan, not assertions about a new checkout.

For changes, run typecheck/lint, affected renderer tests, architecture and RHI checks, then affected
WebGL2/WebGPU browser lanes. Shader changes require actual compilation/translation/pipeline
coverage. Public API changes additionally require TypeDoc, changelog, API report, type consumption
and package checks; exact commands and CI boundaries are in [Engineering](./ENGINEERING.md).

## Explicit ordered mesh lists

`context.createOrderedRendererList({ cullingResults, meshes, overrideMaterial?, materialPass? })`
snapshots exact mesh membership and sequence. The culling handle supplies shared camera/light
context; visibility, layer and frustum membership are intentionally the caller's responsibility.
Draw preparation, shader roles, texture graph dependencies and mesh render hooks remain shared, but
sorting and planner instancing are disabled for this list. Update detached world matrices before
recording. This supports hidden mask producers such as the [Live2D addon](./LIVE2D.md).

## Portable scene-node prepasses

Optional `RenderNodeExtension.raster` contributions are discovered by default Forward before the
transparent pass. They receive the current pipeline/culling context, respect hierarchy visibility
and camera layers, and request split rendering only while active. Nested asynchronous record results
are rejected. Commit/discard callbacks are deduplicated per application frame across views. This
backend-neutral hook is separate from storage/compute-specific GPU scene contributions.

## Graph textures in storage-aware scene passes

`SceneStorageShaderVariant.textures` adds named `SceneStorageTextureBinding` records to the same
reserved group-three ABI as its readonly storage buffers. Each record supplies an exact shader
sampler name, a graph texture/view handle, and an immutable `ComputeSampler`.
`SceneRenderPass.setup` declares every texture read; preparation resolves graph views and
recovery-aware samplers into the frame-owned bind group. Material/mesh groups retain their normal
preparation and resource tracking.

Every per-mesh shader must match the canonical group-three buffer and texture/sampler locations,
kinds and sampled texture types. Missing/duplicate names, wrong comparison samplers, unsupported
sampling capabilities, feedback and ABI mismatches fail rather than binding placeholders. Deferred
sampled resource slots are explicitly represented and accepted only in a declared deferred group.

Clustered direct PBR places its frame/light/probe buffers at bindings 0–4, GTAO at 8/9 and cloud
visibility at 10/11. This allows deformed and decal-bearing PBR receivers to combine DDGI, GTAO and
atmosphere/cloud shadows in the shared direct path. It uses the same surface evaluation and graph
history as the bucket path; no second backend feature implementation is introduced.

Planner-instanced direct PBR receivers use the shared per-mesh storage draw decomposition, retaining
individual transforms while sharing the same lighting/graph inputs. They are not rejected merely
because DDGI or a decal moves them outside a rigid GPU Scene bucket. Material variant manifests warm
the actual weighted pass roles and enabled opaque GTAO/cloud variants against the same budget.

## Pass-owned uniform blocks

`SceneRenderPassParameters.uniformBlocks` binds registered std140 buffers by exact block name for
one scene pass. Camera, frame, scene, light, material and object blocks remain engine-owned and
cannot be replaced through this channel. The reserved weighted-transparency normalization block is
explicitly allowed; custom names must already be registered. Buffer layouts/sizes pass the same
shared reflection and RHI checks as material uniforms. The caller keeps bytes stable until
submission/discard and uses per-invocation parameter-pool slots for values that differ between
views. The existing upload transaction and submission resource tracker own their backend lifetime.
