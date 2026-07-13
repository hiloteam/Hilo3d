# Hilo3d

English | [简体中文](./README_ZH.md)

A TypeScript-first 3D rendering engine with explicit WebGL 2 and WebGPU backends, physically based
rendering, and glTF support. WebGL 1 is not supported.

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

const stage = await Stage.create({
    backend: 'webgl2',
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

Select WebGPU explicitly and await its adapter, device, Naga WASM compiler, and render resources:

```ts
const stage = await Stage.create({
    backend: 'webgpu',
    container: document.querySelector('#app')!,
    camera,
    width: innerWidth,
    height: innerHeight
});
```

Omitting `backend` selects the documented `webgl2` default. Requesting `webgpu` never falls back to
WebGL 2: unavailable adapters, missing required features or limits, and initialization errors reject
`Stage.create()`. A later device loss emits `webgpuDeviceLost`, releases the device/context resource
graph, and leaves that renderer in an explicit terminal failed state; create a new stage instead of
silently changing backends.

The package has one ESM-only entry point. Use it through a modern bundler or native browser ESM with
an import map. Hilo3d does not publish CommonJS, UMD, global-script, or namespace declaration
variants, so every consumer uses the same module and type contract.

## Rendering and shader contract

Hilo3d 2.x has two deliberately selected backends: `webgl2` and `webgpu`. It never creates WebGL 1
contexts. Both backends share one canonical GLSL ES 3.00 shader source; custom shaders must use
`in`/`out`, `texture()`, explicit fragment outputs, and std140 uniform blocks.

WebGL 2 compiles that source directly. WebGPU first resolves the engine's shader variants, rewrites
the active GLSL ES 3.00 interface to Vulkan GLSL 4.50 (locations, bind groups, separate texture and
sampler resources, and clip-space depth), and only then passes it through the Naga WASM frontend to
produce WGSL. There is no second hand-maintained WGSL shader tree and no GLSL 1.00 compatibility
translator.

All non-texture shader data uses a fixed std140 uniform-block ABI:

| Block           | WebGL 2 binding | WebGPU group/binding | Update scope                    |
| --------------- | --------------: | -------------------: | ------------------------------- |
| `FrameBlock`    |               0 |                  0/0 | renderer frame                  |
| `CameraBlock`   |               1 |                  0/1 | camera/render pass              |
| `SceneBlock`    |               2 |                  0/2 | scene revision                  |
| `LightBlock`    |               3 |                  0/3 | camera/render pass              |
| `MaterialBlock` |               4 |                  1/0 | material/IBL revision           |
| `ModelBlock`    |               5 |                  2/0 | object transform revision       |
| `GeometryBlock` |               6 |                  2/1 | geometry decode revision        |
| `SkinningBlock` |               7 |                  2/2 | skeleton pose revision          |
| `MorphBlock`    |               8 |                  2/3 | morph pose revision             |
| `InstanceBlock` |               — |                  2/4 | WebGPU instanced batch revision |

GLSL samplers are the only declarations outside UBOs because opaque resources cannot be block
members. WebGL 2 assigns them texture units; WebGPU lowers each one to a separate texture/sampler
binding pair. Register a custom `ShaderMaterial` block with `registerUniformBlockBinding()` before
its first use, then create and update it through `createStd140Layout()` and
`UniformBuffer.fromSchema()`. Classic float, vector, matrix, integer, or boolean uniforms are
rejected. The shared WebGPU texture contract accepts 2D, cube, and their shadow samplers; 3D,
2D-array, and integer sampler declarations fail during GLSL preparation instead of reaching an
unusable bind group. Depth textures require a shadow sampler; binding one to an ordinary `sampler2D`
fails before GPU allocation because that GLSL declaration has a different WGSL texture type.
Same-name UBO layouts are checked across shader stages before Naga runs. See the
[engineering modernization record](./ENGINEERING_MODERNIZATION.md) for the Naga pipeline, four
bind-group ABI, migration example, and breaking changes.

WebGPU offscreen rendering uses `WebGPURenderTarget`: MRT color attachments, 4× MSAA resolve,
optional sampleable depth/stencil, explicit presentation, resize, and aligned asynchronous readback
are supported. `StageParameters<'webgpu'>` selects WebGPU-specific framebuffer options, so WebGL
framebuffer configuration is never silently ignored by the WebGPU backend.

## Documentation and examples

- [API documentation](https://hilo3d.js.org/docs/)
- [Example gallery](https://hilo3d.js.org/examples/list.html)
- [glTF viewer](https://hilo3d.js.org/examples/glTFViewer/index.html)
- [Engineering modernization record](./ENGINEERING_MODERNIZATION.md)
- [Changelog](./CHANGELOG.md)

API pages are generated from the checked TypeScript source with TypeDoc. The committed API report in
[`etc/hilo3d.api.md`](./etc/hilo3d.api.md) locks the public declaration surface for review.

## Development

The runtime requires either WebGL 2 or WebGPU according to the selected backend. Development
requires Node.js 22.22.2 or newer and npm 12.0.1. The versions are recorded in `.node-version` and
`package.json`.

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
- `npm run check:modernity` rejects maintained JavaScript implementations and retired tool configs.
- `npm run test:coverage` runs browser unit tests and enforces full-source coverage thresholds.
- `npm run test:ui` loads every example and rejects page, console, request, and WebGL 2 errors.
- `npm run test:webgpu` creates a real WebGPU adapter/device/pipeline, translates GLSL through Naga,
  and renders Basic/PBR, instancing, an indexed strip with primitive restart and partial updates, a
  replaced mipmapped texture, all three shadow-light kinds, 4× MSAA/stencil, two-attachment MRT,
  offscreen presentation, and pixel readback in Chromium SwiftShader.
- `npm run test:visual` compares deterministic rendering screenshots.
- `npm run docs:build` generates the API reference; `npm run api:check` verifies the public
  signature report; `npm run site:build` assembles the public site.
- `npm run test:package` validates the built and packed npm contract.
- `npm run validate` runs the complete CI and pre-publish gate.

The published ESM graph targets ES2022 and keeps `gl-matrix` external for dependency deduplication.
Naga is dynamically imported: the engine entry is about 1.06 MB, while the roughly 2.05 MB Naga
JavaScript/WASM graph is emitted as an independent lazy chunk and fetched only during WebGPU
initialization. Declarations and source maps are generated from `src/`; the real installed tarball
is checked with publint, Are the Types Wrong, Bundler and NodeNext consumers, ESM runtime loading,
and an actual Naga GLSL-to-WGSL translation.

See [Contributing](./.github/CONTRIBUTING.md) for the TypeScript, API, testing, and review policy.

## License

[MIT](./LICENSE)
