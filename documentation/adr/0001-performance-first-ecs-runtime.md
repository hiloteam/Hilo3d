# ADR 0001: performance-first ECS runtime

Status: accepted and implemented on 2026-09-01

## Context

The former inheritance-based scene runtime coupled identity, hierarchy, transform, rendering,
events, updates, and addon ownership. Combining rendering and physics required external association,
and independent features repeatedly rediscovered targets by walking the same object tree.

Hilo3D already had data-oriented renderer records, dirty GPU uploads, a Render Graph, and a portable
RHI. The CPU scene source did not match that direction.

## Decision

Use two explicit composition roots:

- `World` owns generation-safe Entity handles, component stores, cached queries, resources, Systems,
  fixed steps, and deferred structural commands.
- `Engine` owns Canvas, Renderer, presentation, graphics recovery, and submission.

Runtime scene state is composition, not inheritance. Hierarchy is `Hierarchy` relationship data;
Transform is packed SoA; renderable, camera, light, animation, interaction, physics, 2D, and
particle capabilities are components or World resources.

The default component store is a typed sparse set. Numeric hot paths use dedicated TypedArray SoA.
Queries are incrementally maintained. Structural changes requested during dispatch apply at explicit
phase boundaries.

Do not implement a generic archetype/chunk store in the first version. JavaScript object layout does
not gain native struct locality merely by grouping objects, while dynamic composition would add
archetype migration and query complexity. A chunk store may be introduced behind the existing store
contract only after registered profiling identifies sparse-set indirection as the dominant cost.

Render extraction is the single application-scene boundary. It incrementally builds a renderer-owned
`RenderWorld` with stable render IDs, packed matrices/bounds, dense camera/light views, and
submission-aware retirement. WebGPU and WebGL 2 share that data and the existing Render
Graph/RHI/shader architecture.

No compatibility facade or parallel scene renderer is retained. Serialized scenes are `ScenePrefab`
assets instantiated into a World.

## Consequences

- `MeshRenderer + RigidBody + Collider` can coexist on one Entity without application binding.
- Headless and multiple Worlds do not require a Canvas or graphics device.
- Static frames avoid whole-scene Transform and extraction work.
- Add/remove/reparent operations have explicit synchronization latency.
- Entity handles and component payloads must not be retained as unchecked object identities.
- Public application code must migrate to `Engine`, `World`, components, and Systems.
- Performance claims require immutable cross-commit registered-rig evidence; local smoke data is not
  accepted as release evidence.

## Rejected alternatives

- An object with a component `Map`: composition improves, but whole-tree scans, dynamic dispatch,
  allocations, and scheduling ambiguity remain.
- A generic archetype/chunk ECS immediately: higher implementation and structural-mutation cost
  without measured JavaScript benefit.
- A Wasm-owned ECS: cross-boundary ownership and resource integration exceed this migration's scope.
- A long-lived dual runtime: doubles behavior, tests, renderer inputs, and transform authority.

## Verification

The migration is accepted through ECS unit/property tests, Transform dirty-subtree diagnostics,
RenderWorld dirty/bounds counters, physics/animation/interaction/2D/particle tests, package/API
checks, dual-backend browser coverage, and the immutable performance protocol documented in
`benchmarks/rhi/README.md`.
