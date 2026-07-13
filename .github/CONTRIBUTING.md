# Contributing to Hilo3d

Hilo3d is maintained as a strict TypeScript library. Pull requests must keep the source, published
declarations, tests, examples, documentation, and package metadata in sync.

## Development setup

Use Node.js 22.22.2 or newer and the npm version recorded in `package.json`.

```sh
npm install --global npm@12.0.1
npm ci
npx playwright install chromium
npm run validate
```

Use `npm run dev` for engine development and `npm run examples:dev` for the example gallery.

## Required quality checks

- `npm run format:check` checks the repository's canonical formatting.
- `npm run lint` runs type-aware ESLint over every maintained TypeScript file.
- `npm run typecheck` checks the library, tests, examples, and Node tooling as isolated TypeScript
  projects.
- `npm run test:coverage` runs browser unit tests and enforces coverage thresholds.
- `npm run test:ui` and `npm run test:visual` run the Playwright UI and rendering suites.
- `npm run docs:check` validates the TypeDoc API documentation.
- `npm run test:package` builds and tests the actual npm package contract.
- `npm run validate` is the single CI and release gate.

Do not commit generated `dist/`, `dist-examples/`, `docs/`, coverage, or browser report files.
Visual regression baselines under `test/ui/__screenshots__/` are reviewed source artifacts and must
be committed when a rendering change is intentional.

## TypeScript and API policy

- Do not use `@ts-nocheck`, `@ts-ignore`, `@ts-expect-error`, explicit `any`, broad lint disables,
  or other mechanisms that bypass a failing check.
- Use native classes, standard ESM, explicit domain types, and type-only imports where relevant.
- Keep compatibility behavior at a documented public boundary; do not build new internals on a
  legacy abstraction.
- Public API changes must update tests, TypeDoc comments, the generated API report via
  `npm run api:update`, and `CHANGELOG.md`.

## WebGL 2 and shader policy

- The renderer has one backend: WebGL 2 with native GLSL ES 3.00. Do not add WebGL 1 context
  fallback, GLSL 1.00 compatibility macros, or extension wrappers for WebGL 2 core features.
- Engine and example shaders must use `in`/`out`, `texture()`, and explicit fragment outputs.
  `attribute`, `varying`, `texture2D`, `textureCube`, `gl_FragColor`, and WebGL 1 shader extensions
  are rejected by the test suite.
- Non-sampler shader data belongs in a std140 uniform block. Samplers are the only permitted classic
  uniforms; `Program` rejects any other active classic uniform at link time.
- Built-in bindings 0–8 are reserved for `FrameBlock`, `CameraBlock`, `SceneBlock`, `LightBlock`,
  `MaterialBlock`, `ModelBlock`, `GeometryBlock`, `SkinningBlock`, and `MorphBlock`. Do not reorder
  or repurpose them.
- Register a custom block with `registerUniformBlockBinding` before linking it. Every new block must
  document its owner and update frequency and include std140 offset, size, and dirty-update tests.
- Instanced object data uses explicit instance attributes. Do not restore source rewriting that
  changes a uniform into an attribute, and do not place per-instance data in a per-draw UBO.

## Commits and pull requests

Use concise Conventional Commit messages, for example `fix: handle incomplete GLTF buffers` or
`docs: clarify renderer lifecycle`. A pull request should explain user-visible behavior, include
appropriate automated coverage, and pass `npm run validate` from a clean checkout.
