# AGENTS.md

These instructions apply to the entire repository. Hilo3D is a strict TypeScript, ESM-only 3D engine
with one shared rendering frontend, a Render Graph, a portable RHI, and WebGPU/WebGL2 backends.

## Read before changing code

- Start with [`documentation/README.md`](./documentation/README.md).
- For rendering work, read
  [`documentation/RENDERING_ARCHITECTURE.md`](./documentation/RENDERING_ARCHITECTURE.md).
- For engineering, packaging, or migration work, read
  [`documentation/ENGINEERING_MODERNIZATION.md`](./documentation/ENGINEERING_MODERNIZATION.md).
- Check `git status` first and preserve unrelated user changes.

## Toolchain and generated files

- Use Node.js 20.19.0 or newer and the npm version declared by the repository.
- Install with `npm ci`. Use `npm run dev` for engine work and `npm run examples:dev` for examples.
- `docs/` is generated TypeDoc output. `dist/`, `dist-examples/`, `coverage/`, `site/`, browser
  reports, and test results are also generated. Do not hand-edit or commit them.
- `documentation/` contains reviewed, hand-written source documentation and must be kept in sync
  with architectural changes.
- Visual baselines under `test/ui/__screenshots__/` are reviewed source artifacts, not disposable
  output.

## TypeScript and public API rules

- Maintained source, examples, tests, and Node tooling stay in strict TypeScript and native ESM.
- Do not add explicit `any`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, broad lint disables,
  CommonJS/UMD output, the retired dynamic class/mixin API, or WebGL1 compatibility paths.
- Use explicit domain types and type-only imports. Public module boundaries require explicit return
  types.
- Public API changes require tests, TypeDoc comments, `CHANGELOG.md`, and an updated API report via
  `npm run api:update` followed by `npm run api:check`.
- The public rendering backends are exactly `webgl2` and `webgpu`.

## Camera controls

- `src/controls/OrbitControls.ts` is the canonical orbit, dolly, and pan implementation for the
  engine and maintained browser examples.
- Examples that need pointer, wheel, or touch camera navigation must use the public `OrbitControls`
  API instead of implementing local camera gesture handlers. Scripted tours should use
  `OrbitControls.setView()` when the same perspective-camera contract applies.

## Rendering invariants

- `Renderer` is the public renderer entry point. `Renderer` and `Stage` are created only through
  asynchronous `Renderer.create()`/`Stage.create()`; `auto` prefers WebGPU and falls back to WebGL2.
  Explicit WebGPU selection must fail clearly rather than silently fall back.
- Scene collection, culling, sorting, instancing, shadows, post-processing, draw preparation, and
  resource coordination belong to the shared renderer. Do not implement parallel feature stacks per
  backend.
- Production frames follow: shared renderer -> `RenderGraphFrame` -> portable RHI -> selected
  backend. Do not bypass Render Graph or RHI for ordinary scene, render-target, readback, or present
  work.
- RHI core must not expose native `GPU*` or `WebGL*` types. Native access stays inside backend or
  internal implementation boundaries; optional interoperability uses checked renderer extensions.
- Keep Render Graph phases distinct: `setup` declares resources and dependencies, `prepare` creates
  reusable backend objects without issuing commands, and `execute` is the command-emission phase.
- Validate graph dependencies and descriptors before beginning the RHI frame. Commit cache/resource
  revisions only after a valid submission; failure paths must roll back frame-local state.
- Resource destruction is submission-aware. Device/context loss recovery must invalidate old device
  generations and rebuild from backend-neutral recipes without changing public resource identity.
- Avoid new per-draw allocations and backend branches in hot paths. Prepare immutable or reusable
  descriptors, bindings, pipelines, and vertex input before execution.

## Shader rules

- Portable raster shaders have one GLSL ES 3.00 source of truth using `in`/`out`, `texture()`,
  explicit fragment outputs, and std140 blocks.
- Portable WebGPU raster artifacts follow engine preprocessing -> Vulkan GLSL 4.50 -> Naga WASM ->
  WGSL. Do not add a parallel hand-authored raster WGSL tree or skip preprocessing.
- WebGPU-only compute uses direct WGSL through `ComputeShader`; it must pass the engine's explicit
  binding/workgroup contract and Naga WGSL validation before pipeline creation.
- WebGPU-only storage-aware raster uses the constrained `StorageGraphicsShader` GLSL ES 3.10
  readonly-std430 contract and still follows preprocessing -> Vulkan GLSL 4.50 -> Naga -> WGSL.
- Portable non-sampler data belongs in registered std140 uniform blocks. GLSL samplers are the only
  values outside blocks; both backends reject classic numeric uniforms. The constrained
  storage-aware raster contract is the only std430 exception.
- All engine-managed 2D textures use top-left logical UVs and must cross exactly one normalization
  boundary. Use `hiloTextureUV()` for managed image textures and `hiloRenderTargetUV()` for scene
  color, depth, shadow atlases, and other Render Graph/RenderTarget attachments. Do not call
  `texture()` or `textureLod()` with an unconverted logical UV. Pre-normalizing in a vertex stage or
  using another backend-native coordinate is an exception only when the shader documents the
  boundary and a directional, asymmetric WebGL2/WebGPU fixture proves row parity.
- A shader change is complete only after the relevant WebGL2 compile/link, Naga translation, and
  real WebGPU pipeline or browser coverage passes.

## Repository map

- `src/`: engine source and public API.
- `src/controls/`: reusable public camera and interaction controls.
- `src/render/`: shared renderer, frame orchestration, Render Graph, RHI, shaders, and UBO support.
- `src/render/graph/`: graph builder, compiler, validation, resource model, and executor.
- `src/render/rhi/core/`: backend-neutral contracts, descriptors, capabilities, and validation.
- `src/render/rhi/backends/`: production WebGPU and WebGL2 RHI implementations.
- `src/render/renderer/`: shared draw preparation, caches, passes, targets, recovery, and lifecycle.
- `examples/`: TypeScript examples and browser fixtures.
- `test/spec/`: unit, renderer, shader, and RHI tests.
- `test/ui/`: Playwright contracts, parity, interaction, and visual tests.
- `test/performance/`, `benchmarks/rhi/`, `scripts/performance/`: current-RHI benchmark protocol and
  immutable cross-commit snapshots.
- `documentation/`: maintained engineering documents and diagrams.

## Validation guidance

Run the smallest relevant checks while iterating, then broaden in proportion to risk:

- Documentation/config only: `npm run format:check`; also run `npm run docs:check` when TypeDoc
  project documents or links change.
- TypeScript implementation: `npm run typecheck`, `npm run lint`, and targeted Vitest files.
- Renderer/Render Graph/RHI: add `npm run test:render:architecture` and `npm run test:rhi`.
- Browser rendering: run the affected `npm run test:ui:webgl2` and/or `npm run test:ui:webgpu` lane.
- Shader/WebGPU pipeline: include `npm run test:webgpu`; use `npm run test:webgpu:native` only on a
  suitable physical-GPU machine.
- Package/API changes: run `npm run api:check`, `npm run test:types`, and `npm run test:package`.
- Full release confidence: `npm run validate`. Portable CI uses `npm run validate:ci` and keeps the
  physical native-GPU lane separate.

Do not report an unrun check as passing. RHI benchmark smoke output is local non-evidence unless it
was produced and verified by the enrolled baseline protocol; never overwrite immutable benchmark
baselines to make a candidate pass. Do not restore a legacy renderer for same-commit A/B testing;
compare verified current-RHI snapshots from different commits instead.

## Change and review hygiene

- Keep changes scoped and preserve existing behavior unless the task explicitly changes it.
- Update tests and the relevant document when changing architecture, backend behavior, shader ABI,
  resource lifecycle, or contributor workflow.
- Use concise Conventional Commit messages.
- In the final handoff, list material changes, checks actually run, checks not run, and any known
  compatibility or evidence limitations.
