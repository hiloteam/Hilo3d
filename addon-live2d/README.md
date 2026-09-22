# @hilo/addon-live2d

Live2D model loading, animation and rendering for Hilo3D. Install the addon and load a model; the
addon includes and initializes everything needed to evaluate it. No SDK download, runtime URL, CDN,
global script tag or application-side build step is required.

```ts
import { Live2DModel } from '@hilo/addon-live2d';

const model = await Live2DModel.load('/models/Miku/miku_sample_t04.model3.json', { signal });
stage.addChild(model);
model.playMotion('Idle', { loop: true });
model.setParameter('ParamMouthOpenY', 0.5);
// Stage.tick updates animation and meshes. Stage.destroy releases the model and assets.
```

`stage` is an existing, ticking Hilo3D Stage and `signal` is the application's optional AbortSignal.
Supply the model3 manifest and its referenced model, texture and animation files. See the checked
`test/types/recipes/live2d.ts` recipe in the repository for full setup and teardown.

## Package-local runtime

The runtime is prepared when this addon is built and shipped in `dist/runtime/prebuilt/`. It is
loaded lazily on the first model load. Standard application bundlers consume its static
`new URL(..., import.meta.url)` asset references and copy the two runtime assets into the
application's own output. Native browser ESM hosting keeps those files beside the addon modules.
Nothing is fetched from a third-party host. Node/SSR imports do not initialize the browser runtime.

The maintained Vite example and the installed-package browser test exercise the same default loader.
Run `npm run examples:dev` in the repository and open `examples/live2d.html` to see Miku. Consumers
do not run the internal SDK builder. Model artwork is not included in the npm package.

Optional `configureLive2D({ nonce, timeoutMilliseconds })` sets a CSP nonce or a shared
initialization deadline. Ordinary applications need no configuration. There is no `runtimeUrl`
option. The default runtime is owned by this addon and follows its release version.

The adapter is MIT licensed; the included third-party runtime retains its separate licenses and
notices. See [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md).

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
