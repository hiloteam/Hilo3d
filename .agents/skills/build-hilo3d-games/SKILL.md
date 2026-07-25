---
name: build-hilo3d-games
description:
    Build, extend, debug, and optimize browser games with the published ESM package hilo3d 2.0.0 or
    its current alpha prerelease. Use for standalone TypeScript/Vite game projects involving Hilo3D
    2D sprites, atlas animation, Canvas text, 3D scenes, PBR materials, glTF assets, cameras,
    lighting, input, picking, physics integration, hybrid 2D UI over 3D worlds, WebGPU/WebGL2
    backend selection, rendering performance, or game architecture. Also use to scaffold a complete
    runnable 2D, 3D, or hybrid Hilo3D game without cloning the Hilo3D repository.
---

# Build Hilo3D Games

Build standalone browser games against the Hilo3D 2.0.0 release line. Do not require a Hilo3D source
checkout. Prefer strict TypeScript, native ESM, Vite, reusable resources, and a small playable
vertical slice before expanding content.

## Work from the 2.0.0 contract

- Resolve the dependency from the official npm registry: use exact `2.0.0` when published; otherwise
  use the highest exact `2.0.0-alpha.N`. Never substitute a 1.x, beta, or release candidate.
- Keep the generated exact version and package lock. Change it only when the user requests a version
  or after verifying compatibility with a newer 2.0.0 release.
- Use Node.js 22.22.2 or newer for the bundled starter.
- Import public API only from `hilo3d`.
- Treat installed declarations at `node_modules/hilo3d/dist/Hilo3d.d.ts` as the final local source
  of truth when a signature is uncertain.
- Never copy private engine internals, generated documentation, or repository-relative examples into
  a consumer game.
- Use only the public rendering backends `webgpu` and `webgl2`; use `backend: 'auto'` by default.

## Choose the game shape

Select one primary shape before writing code:

- **2D**: `Camera2D`, `Sprite`, `SpriteFrame`, `Text2D`, layers, and pointer events.
- **3D**: `PerspectiveCamera`, `Mesh`, geometry, PBR materials, lights, glTF, and optional physics.
- **Hybrid**: one 3D world camera plus a higher-priority `Camera2D` HUD in the same `Stage`.

If starting from nothing, run:

```sh
node <skill-root>/scripts/create-hilo3d-game.mjs \
  --type 2d \
  --name my-game \
  --output ./my-game
cd my-game
npm install
npm run dev
```

Valid types are `2d`, `3d`, and `hybrid`. The generator refuses to overwrite a non-empty output
directory. Its default `auto` version lookup prefers stable `2.0.0` and otherwise selects the latest
numbered alpha. Pass `--hilo-version 2.0.0-alpha.1` only to reproduce or test that exact release.
Read [Starter generator](references/starter-generator.md) when scaffolding or adapting the starter.

## Follow the implementation workflow

1. Define the smallest playable loop: player action, world response, success/failure feedback, and
   restart.
2. Scaffold or inspect the existing application. Preserve its framework and build conventions when
   it is already a valid modern ESM project.
3. Create all stages asynchronously with `await Stage.create(...)`.
4. Separate input state, simulation, presentation, and lifecycle cleanup.
5. Register simulation tickables before `stage` so state updates before rendering.
6. Load or generate assets before exposing gameplay. Surface load failures; do not silently render
   missing content.
7. Make resize behavior explicit for the Stage and every active camera.
8. Add interaction only for objects that need it, and enable only the necessary DOM event types.
9. Reuse geometry, materials, textures, atlas frames, and scratch math objects in steady-state code.
10. Validate type safety, production build, both applicable graphics backends, interaction, resize,
    pause/resume, and teardown.

## Avoid high-frequency mistakes

- `Camera2D` uses a top-left screen origin, but `Sprite` and `Text2D` default to the center anchor
  `(0.5, 0.5)`. For UI layouts expressed as left/top coordinates, set `anchorX: 0, anchorY: 0`;
  otherwise add half the rendered width/height to the position. Verify backgrounds, panels,
  portraits, titles, and responsive edge layouts in a real browser because a center-anchor mismatch
  commonly clips exactly half of the visual.
- Hilo3D event listeners receive the base `DispatchEvent` type. Narrow optional pointer fields with
  runtime checks before reading `stageX`, `stageY`, `hitPoint`, or propagation helpers.
- Pass render-target operations in target-first order:
  `renderer.renderToTarget(target, scene, camera)`.
- Keep gameplay state authoritative outside render callbacks. Update simulation before ticking
  `stage`.
- Show initialization and required-asset failures in the page, not only in the developer console.
- Keep generated games independent from this skill after scaffolding; runtime code and build scripts
  must depend only on published packages and application-owned assets.

## Respect core API rules

Use this baseline:

```ts
import * as Hilo3d from 'hilo3d';

const camera = new Hilo3d.PerspectiveCamera({
    aspect: innerWidth / innerHeight,
    near: 0.1,
    far: 200,
    z: 6
});

const stage = await Hilo3d.Stage.create({
    backend: 'auto',
    container: document.querySelector<HTMLElement>('#app')!,
    camera,
    width: innerWidth,
    height: innerHeight,
    pixelRatio: Math.min(devicePixelRatio || 1, 2)
});

const ticker = new Hilo3d.Ticker(60);
ticker.addTick(stage);
ticker.start();
```

Keep these invariants:

- `Stage` and `Renderer` are created only through their asynchronous `create()` factories.
- `auto` prefers WebGPU and falls back to WebGL2 only during capability selection. Explicit `webgpu`
  failure must remain visible.
- `Ticker` deltas are milliseconds. Convert with `dt / 1000` for units-per-second movement.
- Clamp long deltas after tab suspension and use a fixed step for deterministic physics.
- `Node` rotations are degrees. Do not feed radians into `rotationX/Y/Z`.
- Update `PerspectiveCamera.aspect` or call `Camera2D.resize()` whenever the Stage size changes.
- Call `stage.destroy()` and remove application-owned DOM listeners during teardown.

Read [Public API](references/public-api.md) for the practical interface map and
[Game architecture](references/game-architecture.md) for state, loop, input, collision, lifecycle,
and testing patterns.

## Route to focused guidance

- Read [2D games](references/2d-games.md) for sprite atlases, animation, UI text, batching, layers,
  pointer events, and pixel-space layout.
- Read [3D games](references/3d-games.md) for meshes, materials, lighting, shadows, glTF, animation,
  environment assets, and `cannon-es` physics.
- Read [Rendering and performance](references/rendering-performance.md) for camera composition,
  backend policy, draw-call control, transparency, shaders, render targets, diagnostics, and
  WebGPU-only compute.

Load only the references needed for the current task. Do not read every reference by default.

## Build a real game, not a rendering demo

Every generated game should have:

- a clear objective and immediate player agency;
- start, playing, paused, won, or lost states as appropriate;
- readable feedback through motion, color, text, or sound hooks;
- keyboard and pointer/touch behavior suitable for its controls;
- deterministic restart without reloading the page;
- responsive layout and capped device pixel ratio;
- no per-frame object churn in hot paths;
- explicit cleanup;
- a concise control hint visible in the game.

Use DOM overlays only for accessibility-heavy menus, forms, and settings. Use `Text2D` and sprites
for in-world or canvas-composited HUD elements that should participate in Hilo3D camera/layer
composition.

## Verify completion

Run the narrowest available equivalents of:

```sh
npm run typecheck
npm run build
```

Then test:

1. the default `auto` backend;
2. explicit `?backend=webgl2` and `?backend=webgpu` selection when the app supports query routing;
3. first load with an empty cache;
4. resize and high-DPI behavior;
5. keyboard plus pointer/touch controls;
6. pause, resume, restart, win/loss, and teardown;
7. missing or failed assets;
8. sustained play without increasing draw calls, listeners, or resource counts.

Do not claim a backend passed unless it was actually exercised. If WebGPU is unavailable, report
that limitation and still test WebGL2.
