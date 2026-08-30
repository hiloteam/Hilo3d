# Hilo3D engineering documentation

This directory contains the repository's hand-written engineering and architecture documents.
Generated API documentation is written to the root `docs/` directory and must not be edited or
committed.

## Start here

| Document                                                                        | Purpose                                                                                                                             |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| [Rendering architecture](./RENDERING_ARCHITECTURE.md)                           | Current production rendering path: shared renderer, Render Graph, portable RHI, and WebGPU/WebGL2 backends                          |
| [PBR, HDR, and post-processing](./PBR_AND_POST_PROCESSING.md)                   | Layered glTF materials, modern PBR lighting, opaque scene texture, Bloom, Color Uber, and linear color contracts                    |
| [Material system modernization](./MATERIAL_SYSTEM_MODERNIZATION.md)             | Current Definition/Instance architecture, semantic passes, typed bindings, texture-slot ABI, breaking changes, and roadmap          |
| [Modern WebGPU rendering roadmap](./MODERN_WEBGPU_RENDERING_ROADMAP.md)         | Current rendering gaps and an actionable GPU Scene, temporal, lighting, virtualization, and high-end WebGPU roadmap                 |
| [Temporal rendering remediation](./TEMPORAL_RENDERING_REMEDIATION.md)           | Production Motion Vector/TAA ABI, history validity, Clustered integration, performance contract, and release evidence               |
| [Screen-space reflections](./SCREEN_SPACE_REFLECTIONS.md)                       | Production WebGPU Hi-Z SSR, material attribute ABI, temporal rejection, lifecycle rules, limitations, and release evidence          |
| [Ground-truth ambient occlusion](./GROUND_TRUTH_AMBIENT_OCCLUSION.md)           | Analytic horizon GTAO, bent/multi-bounce PBR integration, log-depth temporal lifecycle, acceptance fixture, and release boundaries  |
| [Screen-space global illumination](./SCREEN_SPACE_GLOBAL_ILLUMINATION.md)       | Portable Forward/Clustered SSGI, radiance tracing, temporal denoise, lifecycle, quality budgets, and release boundaries             |
| [Froxel volumetric lighting](./VOLUMETRIC_LIGHTING.md)                          | WebGPU Clustered froxels, height/local fog, light injection, radiative integration, temporal lifecycle, and quality tiers           |
| [Physical atmosphere and weather](./PHYSICAL_ATMOSPHERE_AND_WEATHER.md)         | GPU histogram exposure, filmic display, atmosphere LUTs, temporal volumetric clouds, cloud shadows, and integration order           |
| [2D rendering and multi-camera composition](./2D_RENDERING.md)                  | Sprite batching, frame animation, Canvas text, pointer input, camera priority, clear policy, and layer masks                        |
| [Particle system](./PARTICLE_SYSTEM.md)                                         | Implemented P0-P5 runtime and complete P6 JSON/graph authoring, diagnostics/preview, deterministic checkpoints and baking contracts |
| [Particle system implementation plan](./PARTICLE_SYSTEM_IMPLEMENTATION_PLAN.md) | Unity 6.5/UE 5.8.1 feature analysis and a phased portable CPU, WebGPU stateful, and stateless particle architecture                 |
| [Compute/storage implementation](./COMPUTE_STORAGE_IMPLEMENTATION_PLAN.md)      | Implemented Direct WGSL compute, storage resources, GPU-driven raster contract, first-release boundaries, and evidence              |
| [Scriptable Render Pipeline design](./SCRIPTABLE_RENDER_PIPELINE_PLAN.md)       | SRP API, implemented architecture, migration record, release performance gates, and compute/storage integration                     |
| [Engineering modernization](./ENGINEERING_MODERNIZATION.md)                     | TypeScript, ESM, tooling, packaging, examples, testing, API documentation, and release baseline                                     |
| [RHI refactor plan](./RHI_REFACTOR_PLAN.md)                                     | RHI design goals, invariants, migration phases, and acceptance criteria                                                             |

## Source-of-truth order

When documents disagree, use this order:

1. Current source code and executable tests.
2. `RENDERING_ARCHITECTURE.md` for the production rendering path.
3. `MATERIAL_SYSTEM_MODERNIZATION.md` for current material ownership, semantic-pass, variant,
   texture-slot and GPU-data contracts plus the remaining long-term roadmap.
4. `ENGINEERING_MODERNIZATION.md` for the maintained engineering baseline.
5. `COMPUTE_STORAGE_IMPLEMENTATION_PLAN.md` for the implemented compute/storage and GPU-driven
   rendering contract, first-release boundaries, acceptance fixtures, and validation record.
6. `RHI_REFACTOR_PLAN.md` for design intent and acceptance criteria not superseded above.
7. `SCRIPTABLE_RENDER_PIPELINE_PLAN.md` for the implemented SRP design rationale, rollout record,
   acceptance checklist, and the integration points now used by compute/storage.

Update the relevant document whenever a change alters an architectural invariant, public workflow,
backend policy, or validation requirement. Keep diagrams in [`assets/`](./assets/) and reference
them with relative links.
