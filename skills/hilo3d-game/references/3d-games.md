# ECS 3D games

Share Geometry and Material resources, then attach `MeshRenderer` to Entities. Use
`RenderVisibility` and `RenderOrder` for draw policy; shadow participation belongs to
`MeshRenderer`, not the Material.

Alpha masking is immutable material topology:

```ts
const foliage = new Hilo3d.PBRMaterial({
    baseColor: new Hilo3d.Color(0.3, 0.7, 0.25),
    roughness: 0.8,
    coverage: { mode: 'mask', cutoff: 0.5 }
});
```

Enable `castShadows` and `receiveShadows` only on relevant `MeshRenderer` components.

Use `OrbitControls(engine, world, cameraEntity)` for orbit/dolly/pan. For picking, use
`MeshPicker({ engine, world, camera })`; it returns Entity identity.

glTF authoring records are not runtime scene objects:

```ts
const model = await new Hilo3d.GLTFLoader().load({ src: modelUrl });
const instance = model.instantiate(world);
```

The instance exposes created Entity handles. Animation targets, skeletons, morphs, cameras, and
lights are resolved into World components during instantiation.

For physics, import the dimension-specific entry:

```ts
import { Collider, RigidBody, createRapier3DPhysicsSystem } from '@hilo3d/addon-physics/rapier3d';

const body = world.createEntity();
world.add(body, Hilo3d.LocalTransform, {});
world.add(body, Hilo3d.MeshRenderer, { geometry, material });
world.add(body, RigidBody, { type: 'dynamic', dimension: '3d', interpolate: true });
world.add(body, Collider, {
    dimension: '3d',
    shape: { type: 'cuboid', halfExtents: { x: 0.5, y: 0.5, z: 0.5 } }
});
```

No `bind()` call or scene-object adapter is required.
