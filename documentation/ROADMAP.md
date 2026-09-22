# Hilo3D roadmap

Reviewed against source commit `6433334c` on 2026-09-20. This is a source-development roadmap;
`package.json` is not proof that every checkout feature is published. See [versions](./VERSIONS.md).
Current contracts are indexed in [documentation](./README.md); old proposals live in
[archive](./archive/README.md).

Rendering planning update: 2026-09-22. REFL0 now has a bounded implementation; other planned
additions remain requirements rather than available APIs. Priorities express the recommended order,
not delivery dates.

## Status vocabulary

- **Implemented**: a bounded slice exists in source and has executable coverage. This does not claim
  that all checks passed on this checkout or that performance evidence is enrolled.
- **Evidence pending**: the implementation exists, but a specified independent release gate remains.
- **Extension**: expand the stated coverage of an implemented slice.
- **Not started**: no production implementation of the proposed contract.
- **Separate product**: tooling outside the runtime, with no implied delivery commitment.

## Active work

| ID                 | Status           | Scope and dependencies                                                                                                                                                                                                    | Exit evidence                                                                                                                                                          |
| ------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PERF-G0/L0         | Evidence pending | Enroll the existing 110k-object/256-light fixture; depends on current GPU Scene/Clustered.                                                                                                                                | Fixed rig/browser/driver, raw CPU record/GPU pass/upload/resident-memory measurements, repeatability and reviewed budgets.                                             |
| PERF-S0            | Evidence pending | Stress stable and opt-in virtual shadows with fast camera motion and high caster churn.                                                                                                                                   | Same scene/quality, dirty/deferred/residency counters, recovery and comparable physical-GPU captures.                                                                  |
| PERF-GI0           | Evidence pending | DDGI implementation and isolated candidate collector exist; baseline review is outstanding.                                                                                                                               | Clean committed workload, independent candidate review and accepted budgets; [protocol](../benchmarks/ddgi/README.md).                                                 |
| PERF-SRP           | Evidence pending | Define and implement a dedicated default/custom SRP cross-commit protocol; proposed old `benchmark:srp:*` commands do not exist.                                                                                          | Versioned fixture, timing/allocation/command counts, reviewed immutable baseline; no legacy renderer restoration.                                                      |
| A0                 | Not started      | KTX2/Basis, capability-selected transcoding, worker decode, mip residency, upload/memory/in-flight budgets. Uses graph/resource lifecycle and diagnostics.                                                                | Cold start, cancellation, teleport, memory pressure and recovery with real compressed assets and physical-device budgets.                                              |
| M0                 | Not started      | Offline meshlets, cluster LOD, GPU culling/material bins and geometry pages. Depends on GPU Scene and A0.                                                                                                                 | Static rigid scene correctness, bandwidth/cull benefit and content/format versioning; no Nanite equivalence claim.                                                     |
| S0-extension       | Extension        | Non-rigid/direct casters and local-light virtual pages after pressure evidence. Current opt-in path covers rigid GPU Scene directional clipmaps.                                                                          | Explicit compatibility policy, dynamic/deformed coverage and bounded residency, with shared stable atlas retained where required.                                      |
| GI0-extension      | Extension        | Prioritize texture-aware diffuse transport, alpha-mask occlusion and common rigid instancing; deformed geometry and offscreen specular ray transport follow separately. Local reflection-probe fallback belongs to REFL0. | New transport/visibility/recovery fixtures and separate memory/update/quality evidence. A0 is a scaling dependency, not a prerequisite for the implemented DDGI slice. |
| V0-extension       | Extension        | Prioritize shared shadow-atlas sampling in froxels, including offscreen caster coverage. Transparent volumetric history remains a later slice.                                                                            | Light/caster/medium changes, rejection and device recovery; budgeted physical-GPU evidence.                                                                            |
| Material-extension | Extension        | MAT1 below owns the cloth, thin-surface and SSS slices; other families and unified schemas remain content-driven extensions.                                                                                              | Shared semantic roles, ABI, shader parity and bounded variants. Existing high-end manifest/warmup is implemented.                                                      |
| Temporal-extension | Extension        | Exposure-compensated history, broader spatial masks, quality/memory tiers and thin-feature reconstruction.                                                                                                                | Stable directional fixtures and measured quality/memory tradeoffs. Existing transparent/particle short history is implemented.                                         |
| Physics-P5         | Not started      | Collision mesh cooking/cache, stable application identity, deterministic command capture and asynchronous snapshot storage.                                                                                               | Asset and replay fixtures, bounded ownership, real 2D/3D adapter conformance; [plan](./PHYSICS_IMPLEMENTATION_PLAN.md).                                                |
| Particle-extension | Extension        | GPU checkpoints and wider stateless subsets only with explicit deterministic/recovery contracts.                                                                                                                          | Supported subset and failure behavior, replay/device-loss evidence; [current boundary](./PARTICLE_SYSTEM.md#current-boundary).                                         |
| Particle-editor    | Separate product | Visual editor on the implemented P6 schema/IR/preview protocol.                                                                                                                                                           | Usable authoring application and asset round trips; an authoring protocol alone is not an editor.                                                                      |

No completion date or hardware result is implied by priority. Start with evidence needed to select
the next performance investment, then A0 before M0. Coverage extensions can proceed independently
when their content and budget are known. See
[rendering work packages](./MODERN_WEBGPU_RENDERING_ROADMAP.md).

## Planned rendering additions

| ID                                                                                              | Priority                   | Status            | First delivery slice                                                                                                                                                            | Exit evidence                                                                                                                                                |
| ----------------------------------------------------------------------------------------------- | -------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [REFL0](./MODERN_WEBGPU_RENDERING_ROADMAP.md#refl0-local-reflection-probes)                     | P1                         | Implemented slice | Static box-projected cubemaps and explicit two-probe material blends; budgeted, atomic HDR dynamic captures on both backends. [Contract](./LOCAL_REFLECTIONS.md).               | Room transitions, offscreen reflectors, roughness/mip behavior, no duplicate specular energy, atomic capture publication and device recovery.                |
| [DECAL0](./MODERN_WEBGPU_RENDERING_ROADMAP.md#decal0-pbr-decals)                                | P1                         | Not started       | Projected opaque-surface decals, atlas, layer/angle/distance filtering and base-color/normal/roughness changes.                                                                 | Consistent PBR/GTAO/SSR attributes, overlap ordering, moving receiver/projector history rejection and bounded pass/resource costs.                           |
| [TRANS0](./MODERN_WEBGPU_RENDERING_ROADMAP.md#trans0-transparency-quality)                      | P1                         | Not started       | Transparency classification, ordering/overdraw diagnostics and opt-in approximate OIT for suitable smoke/particle content; glass retains a separate sorted refraction contract. | Intersecting layers, dense particles, camera motion, temporal composition, explicit approximation limits and bounded memory/bandwidth.                       |
| [RG1](./MODERN_WEBGPU_RENDERING_ROADMAP.md#rg1-graph-compilation-and-transient-memory)          | P1, measurement-driven     | Not started       | Reuse validated schedules for stable topology, reuse compatible transient textures with disjoint lifetimes, and expose peak resource budgets.                                   | CPU compile/record and peak transient allocation comparison; topology/descriptor/resize/recovery invalidation, submission lifetime and rollback correctness. |
| [MAT1](./MODERN_WEBGPU_RENDERING_ROADMAP.md#mat1-cloth-thin-surfaces-and-subsurface-scattering) | P2, content-driven         | Not started       | Sheen and thin-surface diffuse transmission first; separately scoped profile-based skin/wax subsurface scattering afterward.                                                    | Shared semantic/texture-slot ABI, energy and thickness fixtures, supported glTF mapping, lighting/temporal consistency and quality budgets.                  |
| [DEFORM0](./MODERN_WEBGPU_RENDERING_ROADMAP.md#deform0-reusable-gpu-deformation)                | P2, character-scale-driven | Not started       | Opt-in WebGPU compute skin/morph output reused by depth, shadow, motion and color passes.                                                                                       | Vertex-path image parity, current/previous pose correctness, multi-camera and shadow reuse, recovery, memory bounds and measured multi-pass savings.         |

For the lighting/appearance lane, first close GI0 asset coverage and V0 atlas shadows, then
prioritize DECAL0 -> TRANS0. REFL0 has a bounded implementation; broader capture visibility, finer
temporal masks and enrolled physical-device performance evidence remain extensions. This is a
recommended sequence, not an artificial dependency between independent features. RG1 starts with
measured CPU/transient-memory pressure; MAT1 and DEFORM0 need representative material or
animated-character content. A0 -> M0 remains the independent streaming and geometry lane. Existing
performance evidence gates stay open until their own acceptance passes.

RG1 makes the remaining graph-reuse work under F0 explicit; MAT1 narrows Material-extension rather
than duplicating it. New feature details and acceptance boundaries live in the rendering roadmap.

## Delivered foundation

Shared renderer/Render Graph/RHI, async creation and recovery; SRP; compute/storage/indirect;
Definition/Instance materials and shared GPU PBR records; GPU Scene/Hi-Z/Clustered; TAA/TAAU and
dynamic resolution; GTAO/SSR/SSGI; exposure, froxels and weather; stable shadow caching and opt-in
directional virtual pages; initial DDGI/software-BVH hybrid; 2D/multi-camera, animation, physics
P0–P4 and particle P0–P6 have current source implementations with stated boundaries.

Documentation now separates current contracts, consumer recipes, the roadmap and archived plans. AI
discovery uses a short [llms.txt](../llms.txt), published Markdown and explicit version metadata.
Recipes are checked against a packed checkout; future changes must preserve these checks rather than
introduce a separate hand-maintained API description. Evaluate agent use with
[the task checklist](./AI_DOCUMENTATION.md#consumer-task-checklist).

## Evidence maintenance

Each completed work item must link its implementation, tests, executed command/date/commit and
remaining boundaries. Keep historical validation records dated. Do not replace immutable snapshots
or infer current passing results from old reports. Smoke, software-GPU correctness, physical-GPU
execution and enrolled cross-commit performance are distinct evidence categories.

The RHI migration's temporary hot-path allocation budget is historical; review current allocation
measurements under [the enrolled protocol](../benchmarks/rhi/README.md) before tightening it. The
removed legacy renderer must not be restored for comparisons. Performance acceptance belongs here
and in the benchmark protocols, not in archived implementation checklists.
