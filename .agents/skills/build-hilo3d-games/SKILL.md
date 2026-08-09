---
name: build-hilo3d-games
description:
    Plan, scaffold, build, extend, debug, and optimize standalone browser games with the published
    ESM package hilo3d 2.0.0 or its current alpha prerelease. Use when Hilo3D is selected for a
    strict TypeScript/Vite 2D sprite game, 3D game, or hybrid 3D world with 2D UI; when work
    involves gameplay architecture, cameras, input, picking, physics, asset loading, PBR, glTF,
    Canvas text, WebGPU/WebGL2 selection, or rendering performance; or when Codex should generate a
    complete runnable Hilo3D game without cloning the engine repository.
---

# Build Hilo3D Games

Use this skill as the Hilo3D specialist track. If the user has not selected an engine, choose the
game stack before committing to Hilo3D. Once Hilo3D is selected, keep the gameplay, camera, UI,
asset, and validation decisions in one coherent plan.

## Work from the published 2.0.0 contract

- Resolve `hilo3d` from the official npm registry. Use exact `2.0.0` when published; otherwise use
  the highest exact `2.0.0-alpha.N`. Never substitute 1.x, beta, or release-candidate builds.
- Keep the exact dependency version and package lock. Change them only at the user's request or
  after verifying compatibility with a newer 2.0.0 release.
- Use Node.js 20.19.0 or newer for the bundled starter.
- Import public API only from `hilo3d`. When a signature is uncertain, treat
  `node_modules/hilo3d/dist/Hilo3d.d.ts` as the final local source of truth.
- Never copy private engine internals, generated documentation, or repository-relative examples into
  a consumer game.
- Use only `webgpu` and `webgl2`; default to `backend: 'auto'`.

## Classify the work before coding

Identify the request mode:

- **Plan**: return a game-specific plan covering the player verbs, core loop, game states, camera,
  UI surface, asset workflow, controls, and test approach.
- **Scaffold**: choose a game shape, generate the smallest runnable project, and preserve the exact
  Hilo3D version.
- **Implement or extend**: preserve a valid existing ESM project's framework and conventions; add
  only the boundaries the game now needs.
- **Debug or optimize**: reproduce and measure the problem before changing architecture or render
  policy. Keep gameplay correctness separate from rendering evidence.

Then select one primary Hilo3D shape:

- **2D**: use `Camera2D`, `Sprite`, `SpriteFrame`, `Text2D`, layers, and pointer events for sprite,
  grid, top-down, side-view, tactics, or lightweight management games.
- **3D**: use `PerspectiveCamera`, `Mesh`, reusable geometry, materials, lights, glTF, picking, and
  optional physics for world-space games.
- **Hybrid**: use a 3D world camera plus a higher-priority `Camera2D` in the same `Stage` when the
  HUD or 2D effects must participate in Hilo3D composition.

Do not revisit the engine choice once the request or existing project makes it explicit.

## Plan the playable slice

Before expanding content:

1. Lock the game fantasy and the player's main verbs.
2. Define the core loop, success and failure states, progression, restart behavior, and target
   session length.
3. Choose the camera model: locked, follow, room-based, or tactical-pan for 2D; follow, orbit,
   first-person, or scripted for 3D.
4. Choose the UI surface early. Use Hilo3D 2D composition for low-density, scene-integrated HUD and
   effects. Use a DOM overlay when dense text, responsive menus, forms, settings, or accessibility
   benefit from normal web layout.
5. Decide which assets are generated placeholders and which are shipping sprites, atlases, audio,
   data, textures, or glTF/GLB files. Address them through stable manifest keys.
6. Define the task-scoped playtest and evidence needed before calling the slice complete.

Keep secondary UI collapsed or out of the playfield. Avoid turning the game shell into a generic
dashboard.

## Separate rules from Hilo3D presentation

Keep four ownership boundaries, even if a prototype starts in one file:

1. **Input** records actions, axes, pointer positions, and one-shot commands.
2. **Simulation** owns authoritative state, movement, combat, collision, objectives, score, and
   progression.
3. **Presentation** maps simulation state to Hilo3D nodes, animation, materials, cameras, text, and
   effects.
4. **Lifecycle** owns loading, start/pause/resume/restart, resize, listeners, and teardown.

Keep `Stage`, nodes, emitters, tweens, materials, and camera rigs disposable as view state. Do not
make game rules depend on a node, animation, or GPU resource remaining alive. Use one bridge where
presentation reads simulation snapshots and input produces actions. Derive animation and camera
effects from gameplay state rather than maintaining competing flags.

Read [Game architecture](references/game-architecture.md) for the module split, state machine,
scheduler, asset manifest, input, collision, lifecycle, and testing patterns.

## Scaffold when starting from nothing

```sh
node <skill-root>/scripts/create-hilo3d-game.mjs \
  --type 2d \
  --name my-game \
  --output ./my-game
cd my-game
npm install
npm run dev
```

Valid types are `2d`, `3d`, and `hybrid`. The generator refuses to overwrite a non-empty directory.
Its `auto` lookup prefers stable `2.0.0` and otherwise selects the latest numbered alpha. Pass an
explicit `--hilo-version` only to reproduce or test that exact published release. Read
[Starter generator](references/starter-generator.md) when scaffolding or adapting the output.

## Implement in dependency order

1. Scaffold or inspect the application and define explicit game states.
2. Load or generate required assets before play; surface failures in the page instead of silently
   rendering missing content.
3. Create every `Stage` or `Renderer` through its asynchronous `create()` factory.
4. Register input, simulation, presentation, tween/animation, and `stage` tickables in dependency
   order so authoritative state updates before rendering.
5. Make resize behavior explicit for the Stage, every active camera, and both Hilo3D and DOM UI.
6. Add picking only to interactive objects and enable only the required DOM event types.
7. Reuse geometry, materials, textures, atlas frames, bindings, and scratch math objects in
   steady-state code.
8. Implement deterministic restart and one complete teardown path without reloading the page.

## Preserve Hilo3D invariants

- `auto` prefers WebGPU and falls back to WebGL2 only during capability selection. Keep later WebGPU
  initialization, shader, pipeline, and resource failures visible.
- `Ticker` deltas are milliseconds. Convert with `dt / 1000`, clamp long deltas after tab
  suspension, and use a fixed step for deterministic rules or physics.
- `Node` rotations are degrees. Do not feed radians into `rotationX/Y/Z`.
- Update `PerspectiveCamera.aspect` or call `Camera2D.resize()` whenever the Stage size changes.
- For orbit, dolly, and pan on a perspective camera, use public `OrbitControls`; use `setView()` for
  scripted views that share the same contract, and call `dispose()` during teardown.
- Never infer Sprite positioning from the Camera origin. `Camera2D` is top-left, but `Sprite` and
  `Text2D` anchors default to `(0.5, 0.5)`. Set both anchors to `0` when `x/y` are left/top layout
  coordinates.
- Narrow optional Hilo3D pointer fields at runtime before reading `stageX`, `stageY`, `hitPoint`, or
  propagation helpers from the base `DispatchEvent` type.
- Pass render-target operations in target-first order:
  `renderer.renderToTarget(target, scene, camera)`.
- Call `stage.destroy()`, dispose controls, and remove application-owned DOM, audio, gamepad, and
  other external listeners during teardown.
- Keep generated games independent from this skill. Runtime code must depend only on published
  packages and application-owned assets.

Read [Public API](references/public-api.md) when exact construction, loading, scene graph, material,
camera, or renderer behavior is needed.

## Route to focused guidance

- Read [2D games](references/2d-games.md) for coordinates and anchors, sprite atlases, animation,
  display order, batching, Canvas text, scalable controls, picking, and hybrid composition.
- Read [3D games](references/3d-games.md) for world scale, reusable meshes, materials, lighting,
  shadows, glTF, camera controls, picking, animation, and `cannon-es` physics.
- Read [Rendering and performance](references/rendering-performance.md) for backend policy,
  multi-camera composition, draw-call control, transparency, shaders, render targets, diagnostics,
  and WebGPU-only compute.

Load only the references required for the current task.

## Deliver a game, not a rendering demo

For implementation work, require:

- a clear objective and immediate player agency;
- explicit loading, playing, paused, won, or lost states as appropriate;
- readable feedback through motion, color, text, or sound hooks;
- keyboard and suitable pointer/touch controls with a visible control hint;
- deterministic restart, responsive layout, and a capped device pixel ratio;
- no avoidable per-frame object churn; and
- explicit cleanup.

Implement the smallest playable vertical slice before broad content. Keep the chosen 2D, 3D, or
hybrid track obvious in the code boundaries and asset organization.

## Verify completion

Run the narrowest available equivalents of:

```sh
npm run typecheck
npm run build
```

Use the containing project's browser-game QA workflow for runtime, controls, resize, lifecycle,
assets, and backend coverage. Exercise the specific backend when a backend-specific claim matters.
Do not report a runtime path, backend, or performance result as passing unless it was actually
tested or measured.
