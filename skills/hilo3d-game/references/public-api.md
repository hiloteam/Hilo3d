# Hilo3D 2.x ECS public API

Inspect the installed `dist/Hilo3d.d.ts` for exact signatures. Import the core from `hilo3d` and
optional features only from their addon package roots.

## Initialization

```ts
import * as Hilo3d from 'hilo3d';

const world = await Hilo3d.World.create({
    systems: [Hilo3d.createTransformSystem(), Hilo3d.createRenderExtractionSystem()]
});
const engine = await Hilo3d.Engine.create({
    backend: 'auto',
    container,
    width,
    height
});
```

`World.update(dt)` is headless. `engine.frame(world, dt)` performs World phases, renders every
enabled camera, commits successful transform history, and runs cleanup.

## Entity composition

```ts
const entity = world.createEntity();
world.add(entity, Hilo3d.LocalTransform, { position: [0, 2, 0] });
world.add(entity, Hilo3d.MeshRenderer, {
    geometry: new Hilo3d.BoxGeometry(),
    material: new Hilo3d.PBRMaterial({
        baseColor: new Hilo3d.Color(0.2, 0.65, 1),
        metallic: 0.2,
        roughness: 0.55
    }),
    castShadows: true,
    receiveShadows: true
});
world.add(entity, Hilo3d.RenderOrder, { renderOrder: 0 });
```

`LocalTransform`, `Hierarchy`, visibility, order, camera, light, animation, interaction, 2D,
physics, and particle integration are independent components. `WorldTransform` is derived.

## Cameras and lights

```ts
const camera = world.createEntity();
world.add(camera, Hilo3d.LocalTransform, { position: [0, 2, 6] });
world.add(camera, Hilo3d.PerspectiveCamera, {
    fov: 55,
    aspect: width / height,
    near: 0.1,
    far: 500,
    priority: 0
});
world.add(camera, Hilo3d.CameraOutput, { enabled: true });

const light = world.createEntity();
world.add(light, Hilo3d.LocalTransform, {});
world.add(light, Hilo3d.DirectionalLight, {
    color: [1, 0.95, 0.85],
    amount: 3,
    direction: [-1, -1, -0.5]
});
```

Use `OrthographicCamera` for pixel/world-space 2D. Multiple enabled cameras are ordered by priority
inside one Engine submission.

## Systems and commands

Systems declare phase, dependencies, and component/resource access. Cache stores and queries during
setup. During execution, use `world.commands` for structural mutations; direct `world.add/remove` is
rejected while a phase dispatches.

## Assets and teardown

`GLTFLoader.load()` returns a model whose prefab instantiates into a World. Shared Geometry,
Material, Texture, and clips remain resources rather than Entities.

Destroy in ownership order:

```ts
controls.destroy();
engine.destroy();
world.destroy();
texture.destroy();
```

There is no Stage/Node facade or scene-object physics binding API.
