# @hilo3d/addon-physics

Optional backend-neutral 2D/3D physics for Hilo3D's ECS runtime.

```ts
import {
    CameraOutput,
    Engine,
    LocalTransform,
    MeshRenderer,
    PerspectiveCamera,
    World,
    createRenderExtractionSystem,
    createTransformSystem
} from 'hilo3d';
import { Collider, RigidBody } from '@hilo3d/addon-physics';
import { createRapier3DPhysicsSystem } from '@hilo3d/addon-physics/rapier3d';

const world = await World.create({
    systems: [
        createRapier3DPhysicsSystem({
            gravity: { x: 0, y: -9.81, z: 0 },
            fixedTimeStep: 1 / 60
        }),
        createTransformSystem(),
        createRenderExtractionSystem()
    ]
});

const ball = world.createEntity();
world.add(ball, LocalTransform, { position: [0, 4, 0] });
world.add(ball, MeshRenderer, { geometry, material });
world.add(ball, RigidBody, {
    dimension: '3d',
    type: 'dynamic',
    interpolate: true
});
world.add(ball, Collider, {
    dimension: '3d',
    shape: { type: 'ball', radius: 0.5 }
});
```

`RigidBody + Collider + MeshRenderer` share one Entity; no application binding is needed.
`AttachedBody` creates compound colliders, and `CharacterController` references a collider Entity.
The System owns fixed-step synchronization, interpolation, Entity-resolved events, snapshots, and
native lifecycle.

Use the root entry for backend-neutral APIs. Import `@hilo3d/addon-physics/rapier2d` or
`@hilo3d/addon-physics/rapier3d` explicitly to load one adapter.
