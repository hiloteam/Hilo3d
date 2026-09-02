# Hilo3D engineering baseline

Status: current contributor and release contract

## Language and package policy

Maintained source, tests, examples, and tooling use strict TypeScript and native ESM. Public module
boundaries have explicit return types. The repository does not accept explicit `any`, TypeScript
suppression comments, broad lint disables, CommonJS/UMD output, WebGL 1 paths, or a second scene
runtime.

The root package is `hilo3d`. Physics and particles are optional workspace packages with root
`hilo3d` as a peer dependency. Package consumers are checked under bundler and NodeNext resolution,
and packed artifacts are installed into an isolated ESM consumer during validation.

## Runtime baseline

The public application composition roots are:

- `World.create()` for generation-safe Entities, components, resources, and Systems;
- `Engine.create()` for Canvas, Renderer, presentation, and graphics recovery;
- `Renderer.create()` for advanced low-level graphics use.

Serialized scenes are `ScenePrefab` assets instantiated into a World. Runtime scene objects,
inheritance-based renderables, and compatibility facades are not part of the 2.0 contract.

Public API changes require TypeDoc comments, tests, `CHANGELOG.md`, package-consumer coverage, and
updated API reports. Architectural changes also update the corresponding hand-written document.

## Repository layout

- `src/ecs/`: Entity allocator, stores, queries, resources, command buffer, scheduler, World.
- `src/scene/`: components, domain Systems, prefab instantiation.
- `src/render/world/`: renderer-owned dense extraction.
- `src/render/`: shared renderer, Render Graph, RHI, shaders, caches, and recovery.
- `addon-physics/`, `addon-particle/`: optional World Systems and resources.
- `examples/`: maintained ECS examples.
- `test/spec/`, `test/ui/`: unit, browser, renderer, RHI, and parity contracts.
- `benchmarks/rhi/`, `benchmarks/ecs/`, `test/performance/`, `scripts/performance/`: immutable
  rendering and ECS migration benchmark protocols.
- `documentation/`: reviewed source documentation.

Generated `docs/`, `dist*/`, `coverage/`, `site/`, reports, and test results are never hand-edited
or committed.

## Toolchain and validation

Use Node.js 20.19.0 or newer and the npm version declared by the repository.

```sh
npm ci
npm run typecheck
npm run lint
npm run test:unit
npm run test:render:architecture
npm run test:rhi
npm run examples:build
npm run test:types
npm run api:check
npm run test:package
```

`npm run validate` is the complete local release gate; `npm run validate:ci` is the portable CI
gate. Physical native-GPU tests and registered benchmark collection remain separate so software
adapters cannot be presented as performance evidence.

CI coverage shards upload blob reports without applying whole-suite thresholds independently. The
merged coverage-report job is the only sharded lane that enforces global coverage percentages; a
single shard is expected to cover only its half of the test matrix.

`npm run site:build` is the single local and CI entry for API documentation deployment. It builds
and checks declarations for the core, particle addon, and physics addon before generating TypeDoc,
examples, and the linked site; workflows must not call the prebuilt API check without first
producing all three packages. The public `api:update` and `api:check` entries first remove cached
core/addon declarations so incremental TypeScript output cannot make an API report pass locally and
then fail from a clean checkout; `api:*:built` remains reserved for workflows that already ran a
clean full build.

Typed linting follows the same clean-checkout rule: workflows invoke `npm run lint`, which builds
core and addon declarations before ESLint, rather than assembling `build:types` and `lint:built`
steps that omit workspace declarations. `check:modernity` enforces both workflow contracts.

## Performance discipline

Hot ECS and renderer loops use indexed arrays or TypedArrays, cached queries, and reusable
high-water buffers. They avoid iterators, per-record closures, backend branches, wrapper creation,
and temporary descriptor allocation. Structural change is deferred and validated as a batch.

New optimization claims need cross-commit evidence from the registered workload. Immutable baselines
are never overwritten to make a candidate pass. Local benchmark smoke proves only that the collector
and workload execute.

The formal RHI profile is the audited Apple M3 Max macOS/Metal rig declared in
`benchmarks/rhi/manifest.json`. Collection requires its enrolled fingerprint, AC power, High Power
Mode, warning-free thermals, the exact Node/Playwright/Chromium identity, a physical Metal adapter,
GPU timers, precise memory, and allocation profiling. Formal capture runs three isolated rounds with
120 warm-up and 500 sampled frames per scenario; development smoke remains non-evidence.

The destructive ECS switch additionally uses `npm run benchmark:ecs:compare -- <baseline-worktree>`
against the frozen Node/Stage source commit. It alternates fresh processes for three 100k-static +
10k-dynamic rounds, requires at least 25% lower median round-p95, verifies dirty transform/bounds
counts, and rejects allocations attributed inside Transform propagation or render extraction.
Per-phase wall-clock diagnostics are opt-in through `WorldParameters.measurePhaseDurations`; the
default System path does not call the clock.

## Git and release hygiene

Preserve unrelated work, keep commits scoped, and use concise Conventional Commit messages. Release
confidence includes API extraction, package installation, examples, browser parity, RenderGraph/RHI
architecture, and documentation link checks. Report checks that were not run; never describe a smoke
or skipped physical lane as passing.
