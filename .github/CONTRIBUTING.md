# Contributing to Hilo3d

Hilo3d is maintained as a strict TypeScript library. Pull requests must keep the source, published
declarations, tests, examples, documentation, and package metadata in sync.

## Development setup

Use Node.js 20.19.0 or newer and the npm version recorded in `package.json`.

```sh
npm install --global npm@10.9.4
npm ci
npx playwright install chromium
npm run validate
```

Use `npm run dev` for engine development and `npm run examples:dev` for the example gallery. Use
`npm run examples:serve` to serve the gallery on port 4173 for both localhost and the local network;
it opens `/examples/index.html` with WebGPU selected by default. Pass `?backend=webgl2` explicitly
when testing the WebGL 2 lane.

## Required quality checks

- `npm run format:check` checks the repository's canonical formatting.
- `npm run check:modernity` rejects maintained JavaScript implementations, retired build/test
  configuration files, TypeScript/lint/coverage suppressions, and explicit `any` escape hatches.
- `npm run lint` runs type-aware ESLint over every maintained TypeScript file.
- `npm run typecheck` checks the library, tests, examples, and Node tooling as isolated TypeScript
  projects.
- `npm run test:coverage` runs browser unit tests and enforces coverage thresholds.
- `npm run test:browser` runs the full portable Playwright UI, WebGPU, and visual rendering suites
  locally and for release validation. Hosted PR CI runs the stable WebGL 2 presentation matrix in
  four isolated shards and keeps WebGPU presentation in the local/physical-GPU lanes.
- `npm run test:webgpu` runs the real Chromium WebGPU/Naga render path; it must not be replaced by a
  mocked-device smoke test.
- `npm run test:webgpu:native` is an optional physical-GPU check. It must run only on a machine with
  a real GPU/driver, rejects fallback and known software adapters, and is deliberately excluded from
  portable `validate`. The manual self-hosted workflow uses the `linux` and `gpu` runner labels.
- `npm run docs:check` validates the TypeDoc API documentation.
- `npm run api:check` rejects unreviewed changes to the generated public declaration report.
- `npm run test:package` builds and tests the actual npm package contract.
- `npm run validate` is the complete local and release gate, including the full browser GPU matrix.
- `npm run validate:ci` reproduces the portable hosted checks serially. GitHub Actions executes the
  same required gates as separate preflight, coverage, RHI, package, and sharded WebGL 2 UI jobs so
  failures surface earlier. The non-evidence RHI performance smoke and physical-GPU
  `npm run test:webgpu:native` lane remain separate.

Do not commit generated `dist/`, `dist-examples/`, `docs/`, coverage, or browser report files.
Visual regression baselines under `test/ui/__screenshots__/` are reviewed source artifacts and must
be committed when a rendering change is intentional.

## TypeScript and API policy

- Do not use `@ts-nocheck`, `@ts-ignore`, `@ts-expect-error`, explicit `any`, broad lint disables,
  or other mechanisms that bypass a failing check.
- Use native classes, standard ESM, explicit domain types, and type-only imports where relevant.
- Dependencies must expose directly consumable ESM and strict declarations. Do not read, truncate,
  or rewrite dependency UMD/CommonJS sources in Vite or Node tooling, and do not mask invalid
  dependency declarations with compiler suppressions.
- Extend `EventDispatcher` and the backend-neutral renderer lifecycle directly. Do not restore the
  dynamic class/mixin API, backend-specific lifecycle aliases, CommonJS/UMD builds, or global entry.
- Public API changes must update tests, TypeDoc comments, the generated API report via
  `npm run api:update`, and `CHANGELOG.md`.

## WebGL 2, WebGPU, and shader policy

- Public rendering backends are exactly `webgl2` and `webgpu`. Never add WebGL 1 context fallback,
  GLSL 1.00 compatibility macros, or extension wrappers for WebGL 2 core features. Explicit WebGPU
  selection must reject unsupported capabilities instead of silently falling back to WebGL 2.
- Engine and example shaders have one GLSL ES 3.00 source of truth and must use `in`/`out`,
  `texture()`, explicit fragment outputs, and std140 blocks. `attribute`, `varying`, `texture2D`,
  `textureCube`, `gl_FragColor`, `gl_FragData`, and WebGL 1 shader extensions are rejected.
- WebGPU shaders must follow the fixed pipeline: resolve the active engine variant, prepare Vulkan
  GLSL 4.50 interfaces and bindings, then translate through Naga WASM to WGSL. Do not add a parallel
  hand-authored WGSL tree or skip engine preprocessing before Naga.
- Non-sampler shader data belongs in a std140 uniform block. GLSL samplers are the only declarations
  outside blocks: WebGL 2 maps them to texture units and WebGPU maps them to separate
  texture/sampler binding pairs. Both backends reject classic numeric uniforms.
- WebGL 2 reserves flat bindings 0–8 for `FrameBlock`, `CameraBlock`, `SceneBlock`, `LightBlock`,
  `MaterialBlock`, `ModelBlock`, `GeometryBlock`, `SkinningBlock`, and `MorphBlock`. WebGPU maps
  global/pass blocks to group 0, material resources to group 1, object/geometry/pose blocks to group
  2, and custom blocks to group 3; `InstanceBlock` is group 2 binding 4.
- Register a custom block with `registerUniformBlockBinding` before first use. Every new block must
  document its owner and update frequency and include std140 offset, size, dirty-update, WebGPU
  binding, and Naga corpus tests.
- WebGL 2 instanced transforms use explicit instance attributes. WebGPU instanced transforms use the
  fixed-size `InstanceBlock` and split larger batches; do not restore runtime source rewriting or
  consume unbounded vertex-buffer slots.
- A shader change is complete only when WebGL 2 compile/link, Naga corpus translation, and the
  relevant real WebGPU pipeline or UI test pass.
- UI completion waits for stable browser frames and then fences every observed `GPUQueue` with
  `onSubmittedWorkDone()` before sampling uncaptured errors or device loss. Do not replace this with
  a timer, DOM completion marker, or queue-submit counter.
- WebXR is the sole explicit WebGL 2-only example boundary and is not part of WebGPU parity or the
  optional native WebGPU lane.

## Commits and pull requests

Use concise Conventional Commit messages, for example `fix: handle incomplete GLTF buffers` or
`docs: clarify renderer lifecycle`. A pull request should explain user-visible behavior, include
appropriate automated coverage, pass `npm run validate` from a clean checkout, and complete the
local browser-test checklist.
