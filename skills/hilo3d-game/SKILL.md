---
name: hilo3d-game
description:
    Plan, scaffold, implement, debug, and optimize standalone 2D, 3D, and hybrid browser games with
    the published Hilo3D ESM package, strict TypeScript, and Vite. Use when Hilo3D is selected for
    gameplay systems, sprites or 3D scenes, cameras, input and picking, glTF/PBR, physics, mixed
    2D/3D composition, WebGPU/WebGL2 behavior, rendering performance, or a complete runnable game.
---

# Hilo3D Game

## Overview

Use Hilo3D as an opinionated browser-game runtime without coupling the game to the engine source
repository.

Preferred stack:

- the published `hilo3d` ESM package
- strict TypeScript and Vite
- Hilo3D 2D composition for scene-integrated UI and effects
- DOM overlays for text-heavy HUD, menus, settings, and accessibility
- glTF or GLB for shipped 3D assets
- `ParticleSystemDefinition` and `ParticleSystem` for scalable authored effects
- `cannon-es` when meaningful 3D physics is required
- `backend: 'auto'` unless the task explicitly targets WebGPU or WebGL2

For greenfield projects, use exact `2.0.0` when published; otherwise use the highest exact
`2.0.0-alpha.N`. Never substitute 1.x, beta, or release-candidate builds. Keep the dependency exact
and use Node.js 20.19.0 or newer for the bundled starter.

Import public API only from `hilo3d`; inspect `node_modules/hilo3d/dist/Hilo3d.d.ts` when a
signature is uncertain. Never copy private engine internals, generated docs, or repository examples
into a consumer game. If the engine is not selected, choose the stack first. Do not use this skill
to modify Hilo3D itself.

## Choose the Track

- **2D**: `Camera2D`, sprites, text, layers, batching, and pointer events for grid, top-down,
  side-view, tactics, arcade, or management games.
- **3D**: `PerspectiveCamera`, meshes, materials, lights, shadows, glTF, picking, animation, and
  optional physics for world-space games.
- **Hybrid**: A 3D world plus a higher-priority `Camera2D` when HUD, sprite effects, or a 2D
  gameplay layer must share the Hilo3D frame.

Keep one primary track obvious. Add hybrid composition only when it improves the game.

## Core Rules

1. Keep authoritative state outside Hilo3D objects.
    - Simulation owns rules, movement, combat, collision, objectives, timers, score, and
      progression.
    - Presentation maps simulation snapshots to nodes, animation, materials, cameras, text, and
      effects.
2. Treat `Stage`, nodes, tweens, materials, controls, and GPU resources as disposable view state.
3. Map keyboard, pointer, touch, and gamepad input to actions in one place; let simulation consume
   actions rather than renderer or DOM events.
4. Keep camera behavior separate from game rules. Choose locked, follow, room, tactical-pan, orbit,
   first-person, or scripted behavior early.
5. Use Hilo3D 2D for low-density scene presentation and DOM overlays for dense or responsive UI.
6. Address sprites, textures, audio, and glTF through stable manifest keys.
7. Define loading, start, pause, resume, restart, resize, and teardown paths.
8. Reuse geometry, materials, textures, atlas frames, bindings, and scratch math objects.

## Recommended Structure

Scale toward this ownership-based split when the vertical slice outgrows one file:

```text
src/
  app/
  game/
    simulation/
    content/
    input/
    assets/
  hilo/
    stage/
    view/
    adapters/
  ui/
  diagnostics/
  main.ts
```

Let `app/` own loading, scheduling, resize, pause, restart, and teardown. Keep `game/` free of DOM
and GPU dependencies. Let `hilo/` translate simulation snapshots into nodes, cameras, materials,
animation, and effects, and translate picked or browser input into game actions. Keep stage and view
modules thin: they create, update, and dispose presentation objects but do not own game rules. Keep
DOM and Hilo3D HUD ownership explicit under `ui/`; keep debug toggles and performance probes under
`diagnostics/`. Read [Game architecture](references/game-architecture.md) for the detailed module
shape and scheduler.

## Scaffold a New Game

```sh
node <skill-root>/scripts/create-hilo3d-game.mjs \
  --type 2d \
  --name my-game \
  --output ./my-game
cd my-game
npm install
npm run dev
```

Valid types are `2d`, `3d`, and `hybrid`. The generator refuses to overwrite a non-empty directory
and prefers stable `2.0.0` over the latest numbered alpha. Pass `--hilo-version` only to reproduce
or test an exact published release. Keep generated games independent from the skill itself.

## Implementation Workflow

1. Define the player verbs, core loop, game states, camera, input actions, UI surface, assets,
   restart behavior, and smallest playable slice.
2. Load required assets before play and surface failures in the page.
3. Create every `Stage` or `Renderer` through its asynchronous `create()` factory.
4. Register input, simulation, presentation, animation, and `stage` tickables so authoritative state
   updates before rendering.
5. Implement resize for the Stage, every active camera, and both Hilo3D and DOM UI.
6. Add picking only to interactive objects and enable only the required DOM event types.
7. Finish deterministic restart and one complete teardown path without reloading the page.

## Hilo3D Guardrails

- `auto` falls back from WebGPU to WebGL2 only during capability selection. Keep later WebGPU
  initialization, shader, pipeline, and resource failures visible.
- `Ticker` deltas are milliseconds. Convert with `dt / 1000`, clamp long deltas, and use a fixed
  step for deterministic rules or physics.
- `Node` rotations are degrees, not radians.
- Update `PerspectiveCamera.aspect` or call `Camera2D.resize()` when the Stage size changes.
- Use public `OrbitControls` for perspective-camera orbit, dolly, and pan. Use `setView()` for
  compatible scripted views and call `dispose()` during teardown.
- `Camera2D` is top-left, but `Sprite` and `Text2D` anchors default to `(0.5, 0.5)`. Set anchors to
  `0` when `x` and `y` are left/top coordinates.
- Narrow optional pointer fields before reading `stageX`, `stageY`, `hitPoint`, or propagation
  helpers from `DispatchEvent`.
- Pass render-target operations target-first: `renderer.renderToTarget(target, scene, camera)`.
- Call `stage.destroy()`, dispose controls, and remove application-owned listeners during teardown.

## Playable and Browser Safety

- Deliver an objective, immediate agency, state progression, feedback, controls help, and restart;
  do not stop at a rendering demo when the request is for a game.
- Keep the first playable view sparse. Collapse journals, settings, and other secondary surfaces.
- Keep screen shake, hit-stop, parallax, Bloom, and color effects restrained enough to preserve
  gameplay readability.
- Start with built-in Hilo3D materials and correct lighting. Use custom shaders only when the visual
  target requires them, and isolate complex setup behind material factories.
- Keep post-processing optional and measurable rather than making the game loop depend on it.
- Cap device pixel ratio and verify responsive layout, pause, resize, and teardown.
- Reproduce gameplay problems before changing architecture and measure rendering problems before
  optimizing them.
- Inspect renderer statistics, draw calls, resources, transparency, post-processing, and backend
  diagnostics before adding custom render paths.
- Exercise the exact backend when making a WebGPU- or WebGL2-specific claim. Never report an unrun
  runtime or performance path as passing.

## Anti-Patterns

- Storing game rules or save state in Hilo3D nodes
- Implementing local orbit, dolly, or pan gestures instead of using `OrbitControls`
- Forcing dense UI into the canvas without a presentation requirement
- Scattering asset paths across gameplay code
- Importing engine internals into a consumer game
- Silently changing backend after WebGPU initialization begins
- Allocating render resources or scratch objects every frame
- Shipping without restart, resize handling, or teardown

## References

Load only what the task requires:

- [Game architecture](references/game-architecture.md): module boundaries, state, scheduling, input,
  assets, lifecycle, and isolated gameplay tests
- [Starter generator](references/starter-generator.md): generator commands and adaptation rules
- [Public API](references/public-api.md): exact construction and runtime contracts
- [2D games](references/2d-games.md): coordinates, anchors, sprites, text, controls, batching, and
  hybrid composition
- [3D games](references/3d-games.md): scale, meshes, materials, lighting, glTF, cameras, picking,
  animation, and `cannon-es`
- [Particle effects](references/particle-effects.md): portable definitions, runtime selection,
  lifecycle, and authoring boundaries
- [Rendering and performance](references/rendering-performance.md): backend policy, draw calls,
  shaders, render targets, diagnostics, and WebGPU compute

## Verify Completion

Run the containing project's equivalents of `npm run typecheck` and `npm run build`, then exercise
loading, controls, resize, restart, teardown, assets, and the relevant backend in a real browser.
