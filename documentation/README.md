# Hilo3D engineering documentation

This directory contains the repository's hand-written engineering and architecture documents.
Generated API documentation is written to the root `docs/` directory and must not be edited or
committed.

## Start here

| Document                                                                  | Purpose                                                                                                          |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| [Rendering architecture](./RENDERING_ARCHITECTURE.md)                     | Current production rendering path: shared renderer, Render Graph, portable RHI, and WebGPU/WebGL2 backends       |
| [Scriptable Render Pipeline design](./SCRIPTABLE_RENDER_PIPELINE_PLAN.md) | SRP API, implemented architecture, migration record, release performance gates, and future compute/storage route |
| [Engineering modernization](./ENGINEERING_MODERNIZATION.md)               | TypeScript, ESM, tooling, packaging, examples, testing, API documentation, and release baseline                  |
| [RHI refactor plan](./RHI_REFACTOR_PLAN.md)                               | RHI design goals, invariants, migration phases, and acceptance criteria                                          |
| [RHI refactor handoff](./RHI_REFACTOR_HANDOFF.md)                         | Dated implementation checkpoints, validation evidence, and historical handoff notes                              |

## Source-of-truth order

When documents disagree, use this order:

1. Current source code and executable tests.
2. `RENDERING_ARCHITECTURE.md` for the production rendering path.
3. `ENGINEERING_MODERNIZATION.md` for the maintained engineering baseline.
4. `RHI_REFACTOR_PLAN.md` for design intent and acceptance criteria not superseded above.
5. `SCRIPTABLE_RENDER_PIPELINE_PLAN.md` for the implemented SRP design rationale, rollout record,
   acceptance checklist, and future storage/compute extension route.
6. `RHI_REFACTOR_HANDOFF.md` as historical context; older checkpoints may describe transitional
   branches, incomplete work, or retired names.

Update the relevant document whenever a change alters an architectural invariant, public workflow,
backend policy, or validation requirement. Keep diagrams in [`assets/`](./assets/) and reference
them with relative links.
