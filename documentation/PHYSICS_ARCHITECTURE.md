# Hilo3D physics architecture

This document defines the production physics boundary introduced by `@hilo3d/addon-physics`. The
first adapters use Rapier 0.20, but Rapier is an implementation dependency, not Hilo3D's physics
object model.

## Goals and non-goals

The system must:

- remain completely optional: importing `hilo3d` does not import a physics package or WASM;
- expose one backend-neutral ownership and scheduling model for 2D and 3D;
- keep simulation state separate from scene-graph and renderer state;
- use bounded fixed steps, visual interpolation, explicit overload handling, and diagnostics;
- cover rigid bodies, compound colliders, materials, filters, sensors, events, joints, queries,
  kinematic character motion, snapshots, debug geometry, and deterministic teardown;
- support future backends through `PhysicsBackend<D>` without changing application ownership;
- retain an explicit native extension escape hatch for backend-specific advanced features.

The first release does not claim bit-identical cross-browser determinism, network rollback policy,
mesh cooking, vehicle behavior, cloth, or fluids. Rapier-specific advanced APIs remain reachable
through the typed native extension. These omissions are release boundaries, not silent fallbacks.

## Package and import boundary

```text
application
  ├─ hilo3d                         render/scene core; no physics import
  └─ @hilo3d/addon-physics
       ├─ package root              portable types, scheduler, System, Hilo node bridges
       ├─ /rapier2d                 portable API + Rapier 2D WASM adapter only
       └─ /rapier3d                 portable API + Rapier 3D WASM adapter only
```

The addon is a separate ESM package under `addon-physics/`. Both Rapier packages are optional peer
dependencies. A consumer installing only `hilo3d` receives no physics code; a 3D consumer imports
only `/rapier3d` and does not load the 2D module. The package is declared side-effect-free so an
unused addon can be tree-shaken.

The root engine knows only the small, general `StageSystem` ABI. It does not mention Rapier, physics
bodies, or WASM.

## Stage System standard

Every System is a reusable factory with immutable metadata and a fresh runtime per Stage:

```ts
interface StageSystem {
    readonly descriptor: {
        readonly id: string;
        readonly version: string;
        readonly apiVersion: 1;
        readonly requires?: readonly string[];
        readonly before?: readonly string[];
        readonly after?: readonly string[];
        readonly provides?: readonly StageSystemService<unknown>[];
    };
    setup(context: StageSystemSetupContext): StageSystemRuntime | Promise<StageSystemRuntime>;
}
```

The standard has these invariants:

1. `Stage.create()` snapshots the System list, validates unique IDs, hard dependencies, ordering
   cycles, declared service-provider conflicts, and the exact System ABI before setup starts.
2. Setup runs in topological order and may be asynchronous. A failure rolls back already-created
   runtimes in reverse order and destroys the Stage.
3. Systems publish exactly their descriptor-declared, identity-based `StageSystemService<T>` tokens.
   Publications stay private to setup and commit atomically with the runtime; string lookup and
   unchecked global registries are not part of the contract.
4. `requires` is a hard setup/lifecycle edge. `before` and `after` are soft execution edges that are
   ignored when their target is absent, so independent addons do not need a shared numeric order
   registry. All present edges participate in cycle detection.
5. Ordering is compiled only when the installed set changes. Each frame phase walks a flat array of
   only the callbacks that implement that phase; there is no per-frame graph sort or scan of
   unrelated runtimes. Hooks are synchronous and non-reentrant, and mutation during a phase is
   rejected.
6. A runtime can be removed only after all hard dependants. Destruction runs in reverse compiled
   order; service access remains valid while its runtime is being destroyed.
7. `Stage.destroy()` owns System teardown even when a renderer failure occurs. If destruction races
   an asynchronous dynamic setup, the late runtime is destroyed instead of being installed. Multiple
   teardown failures are reported as an `AggregateError`.

The per-frame order is:

```text
system.beforeUpdate(dt)
  -> Node/particle update
  -> system.afterUpdate(dt)       physics fixed-step and transform output
  -> system.beforeRender()
  -> shared Renderer / Render Graph / RHI
  -> system.afterRender()         also runs when rendering throws
```

This ABI is intentionally domain-neutral. Audio, navigation, networking, analytics, authoring, and
other optional systems can use the same lifecycle and service rules.

## Physics layers

```text
Stage System / application lifecycle
                  │
                  ▼
PhysicsWorld<'2d' | '3d'>
  ownership · fixed step · interpolation · events · snapshots · diagnostics
                  │
                  ▼
PhysicsBackend / PhysicsBackendWorld
  typed descriptors · numeric handles · native-free common contract
                  │
        ┌─────────┴─────────┐
        ▼                   ▼
Rapier2DBackend       Rapier3DBackend       future Box2D/Jolt/custom adapters
        │                   │
        └──────── native/WASM lifetime ─────┘
```

`PhysicsWorld` is authoritative for wrapper ownership, scheduling, scene bindings, and event
routing. A backend owns native worlds, handles, queues, serialization, and allocation. Public
wrappers never expose a Rapier class; backend-specific code must request a named typed extension.

## Coordinates, units, and time

- 3D uses a right-handed Cartesian frame and quaternions `(x, y, z, w)`.
- 2D uses Hilo3D's XY plane and a counter-clockwise angle in radians. The node bridge converts the
  angle to Hilo3D's degree-based Z rotation and preserves the node's initial Z position.
- One world unit represents one metre by default. `lengthUnit` configures the backend's numerical
  scale; applications must use one scale consistently for render art and collision shapes.
- Public Stage and `PhysicsWorld.advance()` deltas are milliseconds. Backend steps are seconds.
- Render scale is visual-only. Runtime non-uniform scaling is not baked into a collider.

The Hilo transform bridge operates in world space. It rejects non-zero pivots and scaled parents,
because silently composing either into a rigid pose would produce incorrect physics. Multiple
colliders attached to one body are the supported compound-shape mechanism.

## Scheduling and overload policy

The default fixed interval is `1/60 s`. Each visual delta is scaled, clamped to `maxDeltaSeconds`,
accumulated, and consumed by at most `maxSubSteps`. Whole excess steps are dropped rather than
permitting an unbounded spiral of death. Both per-frame and lifetime dropped time are observable.

Dynamic and velocity-kinematic bodies default to physics-to-view synchronization. Fixed and
position-kinematic bodies default to view-to-physics synchronization. Callers may override the
direction or disable it. Input motion is distributed across multiple substeps; output pose uses
shortest-path quaternion interpolation and shortest-angle 2D interpolation. Simulation state stays
on fixed boundaries; interpolation affects only the bound view.

Pausing freezes stepping without destroying the world. `timeScale` supports slow motion but is
validated as finite and non-negative.

## Object model

### Rigid bodies

The portable body contract supports dynamic, fixed, position-kinematic, and velocity-kinematic
bodies; pose and velocity; gravity scale; damping; sleeping; enabled axes; mass additions;
dominance; extra solver iterations; CCD and soft CCD; forces, impulses, torque, and torque impulse.

Wrappers carry a world generation. Removal, restoration, and destruction invalidate stale wrappers
instead of allowing handles to alias newly allocated native objects.

### Colliders

Shared material and interaction properties include density or explicit mass, friction, restitution,
combine rules, contact skin, sensor mode, collision/solver groups, collision events, and
contact-force thresholds.

| Dimension | Portable shapes                                                                                                        |
| --------- | ---------------------------------------------------------------------------------------------------------------------- |
| 2D        | ball, cuboid/rounded cuboid, capsule, segment, triangle, polyline, triangle mesh, convex hull, heightfield, half-space |
| 3D        | ball, cuboid/rounded cuboid, capsule, cylinder, cone, triangle mesh, convex hull, heightfield                          |

Triangle meshes and heightfields are intended for fixed environment collision. Dynamic gameplay
objects should prefer convex and primitive shapes.

### Joints

Both dimensions expose fixed, revolute, prismatic, rope, and spring joints. 3D additionally exposes
spherical joints. Common supported axes accept limits and motor target position/velocity with
stiffness and damping. A backend must reject an unsupported joint operation; it must not ignore it.

### Events and queries

The world routes collision start/end and thresholded contact-force events by collider handle. Events
contain stable collider/body wrappers for the current generation and are also emitted by each
collider with `self`/`other` orientation. Sensors use the same collision event path.

Ray, shape-cast, overlap-shape, and point-projection queries accept group masks, body/collider
exclusions, body-type and sensor/solid filters, and a final predicate. Shape overlap collection is
explicitly bounded. Queries observe the last completed fixed step; transform writes become queryable
after the next step instead of forcing an implicit simulation update.

### Character controllers

Both dimensions expose a backend-neutral kinematic character controller. It computes collision-
constrained translation for an existing collider and reports grounded state plus contact details:
obstacle handle, applied/remaining translation, time of impact, witnesses, and normals.
Configuration covers the up axis, collision offset, sliding, autostep, climb/slide slopes, ground
snap, normal nudge, character mass, and impulses applied to dynamic bodies.

The controller does not own gameplay velocity or mutate the body automatically. The application
applies the returned translation to its position-kinematic body at the fixed-step boundary, keeping
input, gravity, jump, moving-platform, and networking policy outside the engine adapter.

## Snapshots, diagnostics, and debugging

Snapshots are copied byte arrays tagged with schema version, dimension, and backend identity.
Restoring a snapshot replaces backend state, clears transform bindings and character controllers,
rebuilds body/collider/joint wrapper indexes, and starts a new generation. Application `userData`,
controllers, and view bindings are deliberately not serialized; the application must re-associate
entities by its own stable IDs.

`getDiagnostics()` reports live body/collider/joint/binding counts, simulated step count,
accumulator, interpolation alpha, and dropped time. `debugRender()` returns backend-neutral packed
line vertices and per-vertex RGBA colors so an application can choose its own debug renderer.

## Failure and lifetime rules

- Rapier initialization is asynchronous. A rejected initialization does not poison the module-level
  promise; a later world may retry.
- Descriptors validate finite values, positive extents, normalized non-zero axes/quaternions, packed
  mesh sizes, heightfield dimensions, and 16-bit interaction masks before native creation.
- Worlds, event queues, and WASM resources have exactly one owner and idempotent teardown.
- Physics callbacks are drained after each fixed step, outside the renderer.
- Restored or removed wrappers fail loudly on use.
- Native extensions are opt-in and backend-specific. Portable systems must not depend on them.

## Adding another backend

A new adapter implements `PhysicsBackend<'2d' | '3d'>` and returns a `PhysicsBackendWorld`. The
adapter owns native initialization and maps every common descriptor. It must add conformance tests
for body lifecycle, every declared shape and joint, filtering, event draining, snapshot restoration,
debug output, teardown, and fixed-step integration through `PhysicsWorld`.

If a backend cannot implement a common operation faithfully, it must reject creation or the
operation with an actionable error. Capability-dependent extensions use a namespaced token; they do
not weaken the portable interface.

## Release boundary and next contracts

The implemented P0/P1 surface is rigid-body simulation, colliders, joints, ray/shape/overlap/point
queries, kinematic character controllers, events, fixed-step scheduling, node synchronization,
snapshots, diagnostics, debug geometry, and native extensions in both 2D and 3D. Planned portable
contracts are, in order:

1. detailed contact-pair inspection, point enumeration, query batching, and query-pipeline reuse;
2. moving-platform velocity policy and richer character depenetration diagnostics;
3. collision-mesh cooking/cache and asset-pipeline metadata;
4. rollback identity maps, deterministic command capture, and asynchronous snapshot storage;
5. vehicles and articulation only after at least two backends can support a credible shared model.

These additions must extend the backend conformance suite before entering the portable API.
