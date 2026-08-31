# Hilo3D physics architecture

Status: current optional-addon contract

## Ownership

`@hilo3d/addon-physics` contains the backend-neutral physics API and ECS components. The Rapier 2D
and 3D adapters live in separate entry points so applications do not load both WASM modules.

A physics World System owns one native `PhysicsWorld` and publishes a typed `PhysicsRuntime`
resource. Native handles are indexed by World-local Entity index. Application code does not maintain
a render-object/physics binding table.

Typical composition is direct:

```ts
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

A compound collider uses its own Entity with `Collider + AttachedBody`; the referenced Entity must
be live and own `RigidBody`. A character controller similarly references an explicit collider
Entity.

## Fixed-step synchronization

The System runs in the `physics` phase inside the World fixed-step loop.

1. Exact changed-component queues synchronize created, changed, and removed native bodies,
   colliders, and controllers.
2. Fixed and kinematic-position bodies copy authored Transform state into physics.
3. Interpolated dynamic histories capture their previous native pose.
4. The backend advances by the fixed delta in seconds.
5. Dynamic and kinematic-velocity bodies write authoritative poses to Transform SoA.
6. The current interpolation pose is stored for the later Transform phase.
7. Native collision/contact handles are resolved to generation-safe Entity handles.

Physics is the fixed-step authority for dynamic and kinematic-velocity bodies. Authored Transform is
the authority for fixed and kinematic-position bodies. TransformSystem samples previous/current
physics poses using the World interpolation alpha without modifying native simulation state.

## Components and resource

- `RigidBody`: backend-neutral body descriptor, optional dimension, optional interpolation.
- `Collider`: backend-neutral shape, material, sensor, group, and event data.
- `AttachedBody`: compound relation to a body Entity.
- `CharacterController`: controller options and collider relation.
- `PHYSICS_RUNTIME_2D` / `PHYSICS_RUNTIME_3D`: native ownership, events, handles, snapshots.

Component payload storage uses exact changed queues, so one changed body does not rescan every
physics component.

## Snapshots and stale handles

`PhysicsRuntime.takeSnapshot()` stores backend bytes plus Entity/native-handle associations. Restore
invalidates old wrapper identities, reconnects only live backend handles, clears events, resets
interpolation history, and rejects stale associations. Snapshot support does not promise
bit-identical cross-platform determinism.

## Backend contract

`PhysicsBackendWorld` defines body/collider/joint/controller creation, fixed stepping, queries,
events, debugging, snapshots, and destruction. The root engine imports neither Rapier module nor
physics code.

Use:

```ts
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
```

The 2D and 3D adapters have conformance tests for stepping, collision/contact events, queries,
character motion, snapshots, and wrapper invalidation.
