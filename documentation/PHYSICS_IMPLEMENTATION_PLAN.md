# Physics ECS implementation record

Status: completed

The physics addon now uses the production World System ABI.

- Backend-neutral `PhysicsWorld` and separate Rapier 2D/3D entry points remain intact.
- `RigidBody`, `Collider`, `AttachedBody`, and `CharacterController` are composable Entity
  components with exact changed queues.
- `createPhysicsSystem()` owns native lifecycle and fixed-step synchronization.
- Dynamic bodies use fixed-step Transform interpolation.
- Collision/contact events resolve native handles back to Entity identities.
- Snapshots preserve association arrays and fail closed on stale native handles.
- Compound colliders require a live referenced body.
- The former scene-object transform bridge and binding API have been removed.

Acceptance lives in `test/spec/physics/PhysicsEcsSystem.test.ts` and
`test/spec/physics/RapierPhysics.test.ts`. See [Physics architecture](./PHYSICS_ARCHITECTURE.md) for
the current contract.
