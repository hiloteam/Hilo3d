# @hilo3d/addon-physics

Optional, backend-neutral 2D/3D physics for Hilo3D. The first adapters use Rapier; importing
`hilo3d` alone never imports this package or a Rapier WASM module.

## Rapier 3D

```ts
import * as Hilo3d from 'hilo3d';
import {
    PHYSICS_WORLD_3D_SERVICE,
    bindNode3D,
    createRapier3DPhysicsPlugin
} from '@hilo3d/addon-physics/rapier3d';

const physicsPlugin = createRapier3DPhysicsPlugin({
    gravity: { x: 0, y: -9.81, z: 0 },
    fixedTimeStep: 1 / 60,
    maxSubSteps: 4
});

const stage = await Hilo3d.Stage.create({
    camera,
    plugins: [physicsPlugin]
});
const world = stage.pluginHost.get(PHYSICS_WORLD_3D_SERVICE);

const body = world.createRigidBody({
    type: 'dynamic',
    position: { x: 0, y: 4, z: 0 }
});
world.createCollider({ shape: { type: 'ball', radius: 0.5 }, density: 1 }, body);
bindNode3D(world, body, mesh);
```

Use `@hilo3d/addon-physics/rapier2d` for the independent 2D adapter. Import the package root when
implementing a different `PhysicsBackend` without loading Rapier. The portable world also includes
filtered ray/shape/overlap/point queries and kinematic character movement with slope, step, snap,
grounded, and contact output.

See the repository's [architecture](../documentation/PHYSICS_ARCHITECTURE.md) and
[implementation plan](../documentation/PHYSICS_IMPLEMENTATION_PLAN.md) for contracts, lifecycle,
supported features, and current release boundaries.
