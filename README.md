# Hilo3d

English | [简体中文](./README_ZH.md)

A TypeScript-first WebGL 3D rendering engine with physically based rendering and glTF support.

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

const stage = new Stage({
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

For a browser `<script>` without a bundler, the self-contained UMD artifact exposes
`globalThis.Hilo3d`:

```html
<script src="https://cdn.jsdelivr.net/npm/hilo3d@2/dist/Hilo3d.umd.cjs"></script>
```

The root package export is ESM-only. The `hilo3d/umd` compatibility subpath resolves to the modern
ESM build for `import` and to the self-contained UMD build for `require`; direct browser scripts use
the UMD file shown above.

## Documentation and examples

- [API documentation](https://hilo3d.js.org/docs/)
- [Example gallery](https://hilo3d.js.org/examples/list.html)
- [glTF viewer](https://hilo3d.js.org/examples/glTFViewer/index.html)
- [Engineering modernization record](./ENGINEERING_MODERNIZATION.md)
- [Changelog](./CHANGELOG.md)

API pages are generated from the checked TypeScript source with TypeDoc. The committed API report in
[`etc/hilo3d.api.md`](./etc/hilo3d.api.md) locks the public declaration surface for review.

## Development

Development requires Node.js 22.22.2 or newer and npm 12.0.1. The versions are recorded in
`.node-version` and `package.json`.

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
- `npm run test:coverage` runs browser unit tests and enforces full-source coverage thresholds.
- `npm run test:ui` loads every example and rejects page, console, request, and WebGL errors.
- `npm run test:visual` compares deterministic rendering screenshots.
- `npm run docs:build` generates the API reference; `npm run site:build` assembles the public site.
- `npm run test:package` validates the built and packed npm contract.
- `npm run validate` runs the complete CI and pre-publish gate.

The ESM build targets ES2022 and keeps the runtime dependency external. The UMD build is
self-contained for direct browser use. Declarations and source maps are generated from `src/`, and
the real tarball is checked with publint, Are the Types Wrong, Bundler and NodeNext consumers, ESM
runtime loading, and the UMD browser global.

See [Contributing](./.github/CONTRIBUTING.md) for the TypeScript, API, testing, and review policy.

## License

[MIT](./LICENSE)
