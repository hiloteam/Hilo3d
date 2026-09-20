# Historical designs

These snapshots preserve design rationale and dated evidence from source commit `6433334c`, archived
on 2026-09-20. They are not current contributor instructions, API contracts or claims that checks
pass today. Proposed commands and removed APIs inside them must not be used as current guidance.

| Historical record                                                                 | Current replacement                                                                                              |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| [RHI migration](./RHI_REFACTOR_PLAN.md)                                           | [Rendering architecture](../RENDERING_ARCHITECTURE.md) and [benchmark protocol](../../benchmarks/rhi/README.md). |
| [Particle implementation](./PARTICLE_SYSTEM_IMPLEMENTATION_PLAN.md)               | [Particle system](../PARTICLE_SYSTEM.md).                                                                        |
| [SRP implementation](./SCRIPTABLE_RENDER_PIPELINE_PLAN.md)                        | [SRP contract](../SCRIPTABLE_RENDER_PIPELINE.md).                                                                |
| [Compute/storage implementation](./COMPUTE_STORAGE_IMPLEMENTATION_PLAN.md)        | [Compute and storage](../COMPUTE_AND_STORAGE.md).                                                                |
| [Engineering migration](./ENGINEERING_MODERNIZATION.md)                           | [Engineering guide](../ENGINEERING.md).                                                                          |
| [Temporal remediation](./TEMPORAL_RENDERING_REMEDIATION.md)                       | [Temporal rendering](../TEMPORAL_RENDERING.md).                                                                  |
| [Rendering survey and completed milestones](./MODERN_WEBGPU_RENDERING_ROADMAP.md) | [Rendering roadmap](../MODERN_WEBGPU_RENDERING_ROADMAP.md).                                                      |

Outstanding performance gates, resource streaming, geometry virtualization, physics P5 and particle
extensions are retained in [the current roadmap](../ROADMAP.md). Historical checkboxes do not close
those gates. Keep this archive out of primary consumer/AI navigation; link it only as historical
context.
