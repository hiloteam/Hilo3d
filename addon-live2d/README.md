# @hilo/addon-live2d

Live2D model loading, animation and rendering for Hilo3D. The normal application API contains no
Cubism classes or renderer setup: configure one deployment URL, load a model and add it to Stage.

```ts
import { configureLive2D, Live2DModel } from '@hilo/addon-live2d';

configureLive2D({ runtimeUrl: '/live2d/runtime.js' });
const model = await Live2DModel.load('/models/Miku/miku_sample_t04.model3.json', { signal });
stage.addChild(model);
model.playMotion('Idle', { loop: true });
model.setParameter('ParamMouthOpenY', 0.5);
// Stage.tick updates animation and meshes. Stage.destroy releases the model and assets.
```

`stage` is an existing, ticking Hilo3D Stage and `signal` is the application's optional AbortSignal.
See the checked `test/types/recipes/live2d.ts` recipe in the source repository for full
setup/teardown. The repository's `examples/live2d.html` demonstrates the official Hatsune Miku
sample with motions, pointer tracking, physics and head close-ups. Run `npm run examples:dev` in the
repository to open it. Its model and SDK notices are retained separately; they are not included in
the npm package.

## Deploy the runtime once

The model solver is the official licensed Cubism SDK. This npm package contains the Hilo adapter and
deployment tool, not the SDK binary, Framework source or character artwork. Build self-hosted
runtime assets from your own SDK installation:

```sh
npm install --save-dev rollup typescript
hilo-live2d-runtime --sdk ./vendor/CubismSdkForWeb --output ./public/live2d
```

For split SDK layouts, use `--core-file`, `--framework-dir`, `--core-license` and `--output`; see
`hilo-live2d-runtime --help` for the exact flags. The tool keeps Core byte-for-byte intact, compiles
only CPU Framework modules and the adapter to ESM, rejects native WebGL renderer imports, and copies
SDK/MIT notices with hashed-file provenance. The generated provider loads Core before the Framework.
The ordinary addon entry point never accesses SDK globals. Rollup and TypeScript are optional build
peers and are not imported by browser model code.

Keep the generated provider entry revalidated on deployment; its Core/CPU module assets have
content-hashed names. Supply a CSP nonce with `configureLive2D({ runtimeUrl, nonce })` when needed.
No CDN is selected implicitly. SDK/model licensing remains separate from the addon MIT license.

## Model control

- `playMotion(group, { index, loop, priority, fadeInSeconds, fadeOutSeconds })`: named playback;
  default `force` replaces the previous motion. `background`/`normal` respect active priorities.
- `isMotionPlaying`, `stopMotions()`, `setExpression()` and `clearExpression()` control playback.
- `parameters`, `hasParameter()` and `getParameter()` expose model parameter metadata/live values.
- `setParameter()` queues a persistent final override, evaluated on the next update.
  `clearParameter()`/`clearParameters()` return control to animation.
- `beforeExpressions` and `afterExpressions` receive SDK-independent get/set/add/multiply access for
  procedural character behavior. They are synchronous; do not re-enter update or destroy the model
  from these native-evaluation hooks.
- `paused`, `timeScale`, `motionTimeScale`, `automaticEyeBlink`, `physicsEnabled` and `lipSync`
  control clocks and model-declared effects. Default blinking runs when no motion updates the model.
- `getModelBounds()` and named `hitTest()` use model-local coordinates (positive Y upwards).
  Explicit model3 Layout is applied by the official matrix implementation; without Layout, native
  model units are retained. Normal Hilo transforms and camera/layer rules remain available.

The loader eagerly loads declared motions, expressions, physics and pose so playback APIs are
synchronous after load. It validates resources and rolls back failed/cancelled loads, including late
SDK completion. The default load/runtime initialization deadline is 30 seconds; configure or
override `timeoutMilliseconds`. Use explicit `assetVersion` to version all referenced URLs together;
it does not copy arbitrary parent query/auth parameters to child resources.

Models have independent sessions and clocks. Stage automatically updates, records portable mask
passes and destroys models before its renderer. With a standalone Renderer, use `model.advance(ms)`;
with an explicit first `renderFrame()`, call `model.prepare(renderer)` before opening the frame.
Disable `automaticUpdate` only when taking ownership of stepping. Stop the application ticker before
Stage destruction. Runtime code/SDK initialization is page-scoped; model allocations, animation
objects, textures and bitmaps are session-owned and released on destruction.

## Rendering contract

Models use `.model3.json` + `.moc3`; legacy Cubism 2 `.moc` and Editor `.cmo3` files are not
supported. Traditional Cubism 3.x/4.x/5.0 runtime exports are the compatibility target. The current
SDK baseline is Web 5-r.5, with Hatsune Miku as the maintained actual-SDK browser fixture. Use the
SDK 5.0 / Cubism 5.0 export target for new models; an Editor version and a model's runtime export
version are distinct.

WebGL2 and WebGPU share GLSL ES 3.00 shaders, Render Graph/RHI commands, resource recovery and
soft/inverted masks. Normal/additive/compatible multiply blending and multiply/screen colors are
supported. Each high-level model enables a transparent sorting group, so overlapping models keep
parts contiguous; Node sorting layers, zIndex and scene order control model placement. Camera2D
pointer selection follows the same groups.

Artwork is straight-alpha sRGB and scene blending is linear. Whole-model opacity multiplies
individual drawable opacity. Group opacity and gamma-space SDK-equivalent compositing are not
claimed. Cubism 5.3 advanced blend modes/grouped offscreen composition fail explicitly. The current
runtime adapter is validated against Cubism Web SDK R5. This release targets unlit Forward models;
Clustered, shadows, motion vectors and arbitrary 3D transparency interleaving remain outside scope.

The low-level `Live2DNode`, source adapter and `live2DFeature` exports remain for existing advanced
integrations. Default Forward discovers masks automatically; manually installing the legacy feature
is unnecessary and does not duplicate mask work.
