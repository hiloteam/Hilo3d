# Game architecture on World ECS

Keep simulation state and presentation ownership explicit:

```text
app scheduler
  -> input actions
  -> gameplay Systems/resources
  -> World fixed/update/animation/transform phases
  -> RenderExtractionSystem
  -> Engine submission
```

Use typed components for gameplay data and Systems for batch behavior. Cache queries and stores in
System setup. Avoid per-Entity callbacks, dynamic component maps, generators, and temporary tuples
inside hot loops.

Structural changes are deferred while Systems execute. Queue spawn, add/remove, destroy, and
reparent operations through `WorldCommandBuffer`; they become visible at phase synchronization
points. Component value updates that preserve membership may use the cached store.

Pause gameplay by gating gameplay Systems or the application scheduler while keeping the required
presentation policy explicit. Restart by resetting resources/components or constructing a fresh
World; do not reload the page. Keep one Engine when graphics resources should survive a level
change.

For teardown, stop the scheduler first, remove DOM/input listeners, destroy controls, destroy the
Engine, destroy the World, then release application-owned shared resources. Both Engine and World
destroy operations are idempotent.
