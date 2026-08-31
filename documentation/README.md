# Hilo3D engineering documentation

This directory contains reviewed source documentation. Generated TypeDoc output is written to
`docs/` and must not be edited or committed.

## Start here

| Document                                                      | Purpose                                                                                               |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| [ECS architecture](./ECS_ARCHITECTURE_MIGRATION_PLAN.md)      | Production Entity/component/System model, performance evidence, migration record, and final contracts |
| [Rendering architecture](./RENDERING_ARCHITECTURE.md)         | `Engine -> World -> RenderWorld -> Render Graph -> RHI` production flow                               |
| [Physics architecture](./PHYSICS_ARCHITECTURE.md)             | Backend-neutral 2D/3D ownership and ECS synchronization                                               |
| [Particle system](./PARTICLE_SYSTEM.md)                       | World-owned particle resources and render-extension extraction                                        |
| [2D rendering](./2D_RENDERING.md)                             | Sprite, text, sorting, pointer, and multi-camera component contracts                                  |
| [Engineering modernization](./ENGINEERING_MODERNIZATION.md)   | TypeScript, ESM, packaging, validation, and contributor baseline                                      |
| [Material system](./MATERIAL_SYSTEM_MODERNIZATION.md)         | Material Definition/Instance and shader semantics                                                     |
| [PBR and post-processing](./PBR_AND_POST_PROCESSING.md)       | PBR, HDR, and post-processing contracts                                                               |
| [Modern WebGPU roadmap](./MODERN_WEBGPU_RENDERING_ROADMAP.md) | GPU Scene, temporal, lighting, and virtualization work                                                |
| [Compute/storage](./COMPUTE_STORAGE_IMPLEMENTATION_PLAN.md)   | Direct WGSL compute and storage-aware raster                                                          |
| [RHI refactor](./RHI_REFACTOR_PLAN.md)                        | Portable RHI invariants and historical migration record                                               |

The ECS, rendering, physics, particle, 2D, and engineering documents describe current production
behavior. Files named `*_PLAN.md` other than the completed ECS migration record may contain
historical rationale; current source, tests, and the production architecture documents take
precedence.

## Source-of-truth order

1. Current source and executable tests.
2. `ECS_ARCHITECTURE_MIGRATION_PLAN.md` for runtime ownership and performance gates.
3. `RENDERING_ARCHITECTURE.md` for frame, graph, RHI, shader, and recovery contracts.
4. Domain architecture documents for physics, particles, 2D, and materials.
5. Historical implementation plans and roadmaps.

Update the relevant production document whenever a change alters a public API, architecture
invariant, backend policy, or validation requirement.
