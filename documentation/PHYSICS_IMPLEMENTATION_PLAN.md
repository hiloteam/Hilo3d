# Physics implementation and rollout plan

This plan turns [the physics architecture](./PHYSICS_ARCHITECTURE.md) into reviewable release
slices. The status column describes the current repository state.

## Acceptance principles

- No physics or Rapier import may be reachable from the `hilo3d` package entry.
- 2D and 3D packages must be independently importable and must not load each other's WASM.
- All maintained code remains strict TypeScript and ESM with no suppression or `any` escape hatch.
- Simulation overload is bounded and observable; teardown and failed setup are transactional.
- Portable APIs are tested against a fake backend and each shipped Rapier adapter.
- New public core API is documented, reported by API Extractor, and recorded in the changelog.

## Delivery matrix

| Slice | Scope                                                                                            | Status      | Evidence required                                   |
| ----- | ------------------------------------------------------------------------------------------------ | ----------- | --------------------------------------------------- |
| P0    | generic Stage System ABI, ordering, typed services, async setup rollback, reverse teardown       | Implemented | core unit tests, typecheck, API report              |
| P1    | optional addon package, portable backend/world contracts, fixed scheduler, bindings, diagnostics | Implemented | scheduler/conformance unit tests, package checks    |
| P2    | Rapier 2D/3D bodies, colliders, joints, events, queries, controllers, snapshots and debug        | Implemented | real WASM integration tests in both dimensions      |
| P3    | Hilo node bridges and a maintained Rapier 3D browser example; remove Cannon                      | Implemented | examples build and browser smoke                    |
| P4    | shape/overlap/point queries and portable character controller                                    | Implemented | 2D/3D WASM movement and query fixtures              |
| P5    | mesh cooking/cache, rollback identity and command capture                                        | Planned     | asset fixtures, replay checks, bounded memory tests |

## P0 — domain-neutral Stage System ABI

1. Add versioned descriptors, typed service tokens, setup context, and frame/lifetime hooks.
2. Validate all IDs, hard `requires`, soft `before`/`after` ordering, cycles, and declared service
   providers before initial setup.
3. Topologically initialize; publish services only when setup commits; roll back partial setup and
   Stage construction on failure.
4. Reject reentrant dispatch and dependency-breaking uninstall.
5. Run finalizers in reverse dependency order, dispose runtimes that complete after host teardown,
   and aggregate teardown errors.

Exit gate: the base engine contains no physics reference and can host an unrelated test System.

## P1 — portable physics runtime

1. Define conditional 2D/3D vectors, poses, bodies, colliders, shapes, joints, events, queries,
   snapshots, and diagnostics.
2. Keep native objects behind numeric handles and `PhysicsBackendWorld`.
3. Implement bounded fixed-step accumulation, pause/time scale, dropped-time reporting, kinematic
   input distribution, and visual interpolation.
4. Add generation-checked object wrappers, cascading removal, event cleanup, and idempotent destroy.
5. Add generic transform targets, plus guarded Hilo3D 2D/3D node targets.

Exit gate: a fake backend can exercise scheduling and ownership without Rapier or a browser.

## P2 — Rapier adapters

1. Use the separate official `@dimforge/rapier2d-compat` and `@dimforge/rapier3d-compat` packages so
   asynchronous WASM startup is explicit and each dimension has an independent entry.
2. Validate and map every portable descriptor to native Rapier builders.
3. Drain collision/contact queues once per substep and map native handles back through the portable
   world.
4. Copy native snapshots, replace native worlds on restore, and free old worlds and event queues.
5. Expose named typed native extensions for deliberately non-portable Rapier features.

Exit gate: real 2D and 3D worlds fall under gravity, raycast, emit collision events, restore a
snapshot, and destroy cleanly.

## P3 — packaging, example, and migration

1. Publish the addon from `addon-physics/` with root, `/rapier2d`, and `/rapier3d` exports; keep
   Rapier as optional peer dependencies.
2. Integrate addon build/typecheck/package checks into the monorepo without adding an export from
   `hilo3d`.
3. Replace the Cannon example with a Rapier 3D System example showing fixed stepping, interpolation,
   CCD, events, diagnostics, and automatic Stage teardown.
4. Remove `cannon-es` and every maintained Cannon instruction from dependencies, docs, and the
   `hilo3d-game` skill.

Exit gate: maintained TypeScript and package manifests contain no `cannon-es`, the gallery builds,
and the addon tarball contains only declared files.

## P4 — advanced scene queries and locomotion

The shared shape descriptor pipeline now drives casts and overlaps with start-penetration policy,
time of impact, normals, witnesses, filter masks, and a bounded result collector; point projection
uses the same filters. The kinematic character controller is expressed in gameplay terms—up axis,
offset, slope, autostep, ground snap, dynamic-body impulse, mass, corrected translation, grounded
state, and detailed contact output—without leaking Rapier classes.

Application velocity, jumping, moving-platform inheritance, and automatic body mutation remain
policy outside the controller. Vehicles are not standardized at this stage.

## P5 — content and rollback

Add asynchronous collision-mesh cooking with stable content hashes, bounded cache ownership, convex
decomposition policy, and explicit static/dynamic restrictions. Define stable application IDs over
native handles before adding rollback: snapshot bytes alone do not preserve application wrapper or
view identity.

Command capture must record ordered mutations at fixed-step boundaries and reject callbacks or
native extensions that cannot be replayed deterministically.

## Verification checklist

- `npm run format:check`
- `npm run lint`
- `npm run typecheck`
- targeted Stage System and physics Vitest suites
- `npm run test:skill`
- `npm run examples:build`
- `npm run api:update && npm run api:check`
- `npm run test:types`
- `npm run test:package`
- `npm run test:addon-package`

Run WebGL2 and WebGPU UI lanes when the browser example or Hilo node binding changes visually. Never
report a physical browser/WASM or GPU lane as passing unless it was actually executed.
