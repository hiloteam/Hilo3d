# Hilo3D engineering documentation

This directory contains the repository's hand-written engineering and architecture documents.
Generated API documentation is written to the root `docs/` directory and must not be edited or
committed.

## Start here

| Document                                                                   | Purpose                                                                                                                |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| [Rendering architecture](./RENDERING_ARCHITECTURE.md)                      | Current production rendering path: shared renderer, Render Graph, portable RHI, and WebGPU/WebGL2 backends             |
| [PBR, HDR, and post-processing](./PBR_AND_POST_PROCESSING.md)              | Layered glTF materials, modern PBR lighting, opaque scene texture, Bloom, Color Uber, and linear color contracts       |
| [Material system modernization](./MATERIAL_SYSTEM_MODERNIZATION.md)        | Current material audit, semantic multi-pass design, Definition/Instance split, GPU material ABI, migration, and gates  |
| [Modern WebGPU rendering roadmap](./MODERN_WEBGPU_RENDERING_ROADMAP.md)    | Current rendering gaps and an actionable GPU Scene, temporal, lighting, virtualization, and high-end WebGPU roadmap    |
| [2D rendering and multi-camera composition](./2D_RENDERING.md)             | Sprite batching, frame animation, Canvas text, pointer input, camera priority, clear policy, and layer masks           |
| [Compute/storage implementation](./COMPUTE_STORAGE_IMPLEMENTATION_PLAN.md) | Implemented Direct WGSL compute, storage resources, GPU-driven raster contract, first-release boundaries, and evidence |
| [Scriptable Render Pipeline design](./SCRIPTABLE_RENDER_PIPELINE_PLAN.md)  | SRP API, implemented architecture, migration record, release performance gates, and compute/storage integration        |
| [Engineering modernization](./ENGINEERING_MODERNIZATION.md)                | TypeScript, ESM, tooling, packaging, examples, testing, API documentation, and release baseline                        |
| [RHI refactor plan](./RHI_REFACTOR_PLAN.md)                                | RHI design goals, invariants, migration phases, and acceptance criteria                                                |
| [RHI refactor handoff](./RHI_REFACTOR_HANDOFF.md)                          | Dated implementation checkpoints, validation evidence, and historical handoff notes                                    |

## Source-of-truth order

When documents disagree, use this order:

1. Current source code and executable tests.
2. `RENDERING_ARCHITECTURE.md` for the production rendering path.
3. `MATERIAL_SYSTEM_MODERNIZATION.md` for the planned material ownership, semantic-pass, variant,
   GPU-data, migration, and acceptance contracts; it does not override current runtime facts.
4. `ENGINEERING_MODERNIZATION.md` for the maintained engineering baseline.
5. `COMPUTE_STORAGE_IMPLEMENTATION_PLAN.md` for the implemented compute/storage and GPU-driven
   rendering contract, first-release boundaries, acceptance fixtures, and validation record.
6. `RHI_REFACTOR_PLAN.md` for design intent and acceptance criteria not superseded above.
7. `SCRIPTABLE_RENDER_PIPELINE_PLAN.md` for the implemented SRP design rationale, rollout record,
   acceptance checklist, and the integration points now used by compute/storage.
8. `RHI_REFACTOR_HANDOFF.md` as historical context; older checkpoints may describe transitional
   branches, incomplete work, or retired names.

Update the relevant document whenever a change alters an architectural invariant, public workflow,
backend policy, or validation requirement. Keep diagrams in [`assets/`](./assets/) and reference
them with relative links.
