# Particle ECS implementation record

Status: completed for the current production scope

The particle addon retains its portable CPU, stateful WebGPU, stateless WebGPU, authoring,
serialization, preview, cache, baking, budget, mesh, sprite, and ribbon capabilities. Runtime
ownership has moved to the World model:

- `ParticleEmitter` relates an Entity to one particle resource.
- `ParticleRuntime` is a typed World resource and owns optional created resources.
- `createParticleWorldSystem()` performs simulation, budgeting, and explicit render-extension
  synchronization.
- Transform data comes from packed World Transform storage.
- Renderer integration uses `RenderExtensionComponent -> RenderWorld`; there is no scene-object
  inheritance or symbol-based discovery.
- Particles themselves remain packed simulation records, not Entities.

Future expansion must preserve the fixed-capacity, allocation-stable, Render Graph/RHI, recovery,
and fail-closed backend contracts described in [Particle system](./PARTICLE_SYSTEM.md).
