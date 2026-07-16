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

## Commits and pull requests

Use concise Conventional Commit messages, for example `fix: handle incomplete GLTF buffers` or
`docs: clarify renderer lifecycle`. A pull request should explain user-visible behavior, include
appropriate automated coverage, and pass `npm run validate` from a clean checkout.
