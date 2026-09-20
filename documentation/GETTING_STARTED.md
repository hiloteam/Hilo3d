# Getting started with Hilo3D 2.0

This guide uses the 2.0 API. During the alpha, install `next` and save the resolved version exactly;
`npm install hilo3d` may select the older 1.x `latest` release. Check [versions](./VERSIONS.md)
before copying a feature from development documentation.

```sh
npm create vite@latest my-hilo-app -- --template vanilla-ts
cd my-hilo-app
npm install
npm install --save-exact hilo3d@next
npm run dev
```

Use Node.js 20.19.0 or newer. Hilo3D is ESM-only; import public APIs from `hilo3d`. Optional physics
and particles are separate packages and are unnecessary for a core scene. A Vite app's `#app`
container must have a nonzero size, for example `width: 100vw; height: 100vh` with body margin zero.

## First 3D scene

Copy [scene3d.ts](../test/types/recipes/scene3d.ts) and its
[lifecycle.ts](../test/types/recipes/lifecycle.ts) helper into your application's `src/`. They
create an async Stage, a PBR box, ambient light, public OrbitControls, resize handling and teardown.
From Vite's main module, get the container, call `startScene3D(container)` and display startup
errors in the page. Call the returned `destroy()` when unmounting the application.

<!-- recipe: test/types/recipes/scene3d.ts -->

```ts
import {
    AmbientLight,
    BoxGeometry,
    Color,
    DirectionalLight,
    Mesh,
    OrbitControls,
    PBRMaterial,
    PerspectiveCamera,
    Stage,
    Vector3
} from 'hilo3d';
import { runScene, type RunningScene } from './lifecycle.js';

export async function startScene3D(container: HTMLElement): Promise<RunningScene> {
    const camera = new PerspectiveCamera({ x: 3, y: 2, z: 4 });
    const stage = await Stage.create({
        backend: 'auto',
        container,
        camera,
        clearColor: new Color(0.03, 0.04, 0.06)
    });
    let controls: OrbitControls | undefined;
    try {
        new Mesh({
            geometry: new BoxGeometry(),
            material: new PBRMaterial({
                baseColor: new Color(0.83, 0.12, 0.09),
                metallic: 0.1,
                roughness: 0.6
            })
        }).addTo(stage);
        new AmbientLight({ amount: 1 }).addTo(stage);
        new DirectionalLight({ amount: 3, direction: new Vector3(-1, -1, -1) }).addTo(stage);
        controls = new OrbitControls(stage);
        return runScene(
            stage,
            () => {
                const width = Math.max(1, container.clientWidth);
                const height = Math.max(1, container.clientHeight);
                stage.resize(width, height, Math.min(devicePixelRatio || 1, 2));
                camera.aspect = width / height;
            },
            () => controls?.dispose()
        );
    } catch (error: unknown) {
        controls?.dispose();
        stage.destroy();
        throw error;
    }
}
```

<!-- /recipe -->

The common lifecycle helper stops the ticker before destruction, retains resources during persisted
`pagehide`, resumes on persisted `pageshow`, and removes application listeners. Its complete source
is included in [recipes](./RECIPES.md). Loading errors should reach a visible application error
state; explicit WebGPU requests must not silently retry on WebGL2.

## Next steps

- [2D scene and camera resizing](./RECIPES.md#2d-scene), [2D coordinates](./2D_RENDERING.md).
- [GLB and animation](./RECIPES.md#assets-and-animation).
- [Post-processing](./RECIPES.md#post-processing): portable Bloom/filmic, WebGPU auto exposure.
- [Particles and physics](./RECIPES.md#optional-addons): matching package versions and explicit
  ownership.
- [AI/game workflow](../skills/hilo3d-game/SKILL.md): a more complete independent game generator.

## Common mistakes

Ticker/Stage deltas are milliseconds; `Animation.update()` takes seconds. Node rotations use
degrees. Sprite/Text2D anchors default to the center even though Camera2D uses a top-left origin.
Resize Stage and each camera together. Use `OrbitControls.setView()` for compatible scripted views,
and dispose controls during teardown. Reuse materials/geometries and stop ticking before destroying
resources. Core declarations describe only core APIs; install addons only when needed.
