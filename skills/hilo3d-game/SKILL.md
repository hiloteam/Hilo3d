---
name: hilo3d-game
description:
    Plan, scaffold, implement, debug, and optimize standalone 2D, 3D, and hybrid browser games with
    Hilo3D 2.x Engine + World ECS, strict TypeScript, and Vite.
---

# Hilo3D Game

Build against the published ESM package and its ECS runtime. Hilo3D 2.x has no public `Node`,
scene-object `Mesh`, or `Stage` compatibility model.

## Runtime choices

- `Engine` owns canvas, renderer, backend selection, resize, submission, and recovery.
- `World` owns Entity, Component, System, resources, fixed-step scheduling, and structural commands.
- An Entity is an opaque generation-safe handle. Compose behavior with components such as
  `LocalTransform`, `MeshRenderer`, `RigidBody`, `PointerTarget`, or `SpriteRenderer`.
- Install `createTransformSystem()` before `createRenderExtractionSystem()`. Add animation,
  interaction, text, physics, or particle Systems only when used.
- Use `backend: 'auto'` unless the task explicitly needs WebGL2 or WebGPU.
- Use `@hilo3d/addon-physics/rapier2d` or `/rapier3d` for physics and `@hilo3d/addon-particle` for
  authored particles.

Keep Geometry, Material, Texture, Shader, and animation clips as shared resources. Do not create a
component object with an `update()` method or keep an application binding table between render and
physics objects. Put `MeshRenderer + RigidBody + Collider` on the same Entity.

## Workflow

1. Define the simulation state, input actions, camera model, rendering track, assets, pause/restart,
   resize, and teardown behavior.
2. Create the World asynchronously with its complete initial System set, then create the Engine.
3. Create camera Entities and add `CameraOutput`; compose renderable and gameplay Entities.
4. Drive simulation from typed Systems or one application scheduler. Call `engine.frame(world, dt)`
   once per animation frame; deltas are milliseconds.
5. Queue add/remove/destroy/reparent operations through `world.commands` while a System is running.
6. Reuse resources and scratch data. Use component stores directly inside hot System loops.
7. Destroy controls, Engine, World, listeners, and application-owned resources explicitly.

For a starter:

```sh
node <skill-root>/scripts/create-hilo3d-game.mjs \
  --type 3d \
  --name my-game \
  --output ./my-game
```

The generator resolves `hilo3d@next`, accepts only 2.0.0 releases, and pins the concrete version.
Use Node.js 20.19.0 or newer.

## Guardrails

- Application Transform values use position/quaternion/scale tuples; do not port degree-based Node
  mutations.
- `WorldTransform` is derived. Write `LocalTransform` or use `TransformStore` methods.
- Use public `OrbitControls(engine, world, cameraEntity)` for perspective orbit/dolly/pan.
- Update camera components when dimensions change, after calling `engine.resize()`.
- Pointer picking returns Entity identity. Use `PointerTarget`, the interaction queue, or
  `MeshPicker`; do not allocate listeners per Entity.
- Renderer-level work consumes `RenderWorld`, never World hierarchy or application components.
- Custom raster shaders remain GLSL ES 3.00 with registered std140 blocks and portable UV helpers.
- Measure before changing storage. Sparse sets plus hotspot SoA are the default; do not introduce a
  general archetype/chunk layer without benchmark evidence.

## References

Read only the relevant reference:

- [Public API](references/public-api.md): initialization, composition, lifecycle, and package entry
  points.
- [2D games](references/2d-games.md): orthographic cameras, sprites, text, sorting, and pointer
  data.
- [3D games](references/3d-games.md): meshes, lighting, glTF prefabs, controls, picking, and
  physics.
- [Game architecture](references/game-architecture.md): ownership, scheduling, structural changes,
  restart, and teardown.
- [Particle effects](references/particle-effects.md): particle World System and component wiring.
- [Rendering and performance](references/rendering-performance.md): RenderWorld, render targets,
  backends, diagnostics, and hot-path rules.
- [Starter generator](references/starter-generator.md): generation and version-selection details.

## Verify

Run strict typecheck and production build, then exercise the exact backend in a real browser. Verify
load, controls/input, resize, pause/restart, teardown, and failure reporting. Do not report an unrun
GPU or performance path as passing.
