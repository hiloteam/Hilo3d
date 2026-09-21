# Hilo3D documentation

Hand-written documentation lives here. Generated TypeDoc output in `docs/` and the assembled `site/`
are build artifacts; do not edit or commit them. These documents describe the current source
checkout. Start with [version boundaries](./VERSIONS.md) when using an installed npm package.

## Use the engine

- [Getting started](./GETTING_STARTED.md): install the 2.0 prerelease and run a scene.
- [Checked recipes](./RECIPES.md): 2D/3D, OrbitControls, GLB, post-processing, physics and
  particles.
- [2D and multi-camera](./2D_RENDERING.md), [animation](./ANIMATION_SYSTEM.md),
  [PBR/post-processing](./PBR_AND_POST_PROCESSING.md).
- [Particles](./PARTICLE_SYSTEM.md), [physics](./PHYSICS_ARCHITECTURE.md), [Live2D](./LIVE2D.md).
- [Example catalog](./EXAMPLE_CATALOG.md) and [game skill](../skills/hilo3d-game/SKILL.md).
- [AI documentation entry](../llms.txt): a short index; [maintenance](./AI_DOCUMENTATION.md).

## Current technical contracts

| Document                                                       | Responsibility                                                            |
| -------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [Rendering architecture](./RENDERING_ARCHITECTURE.md)          | Shared frontend, Render Graph, RHI, shader and resource lifecycle.        |
| [Scriptable Render Pipeline](./SCRIPTABLE_RENDER_PIPELINE.md)  | Factories, contexts, scene lists, features, passes and transactions.      |
| [Compute and storage](./COMPUTE_AND_STORAGE.md)                | Direct WGSL compute, readonly storage raster, graph hazards and recovery. |
| [Material system](./MATERIAL_SYSTEM.md)                        | Definition/Instance, semantic roles, texture slots, UBO/storage layouts.  |
| [Temporal rendering](./TEMPORAL_RENDERING.md)                  | Motion ABI, TAA/TAAU, reactive and transparent/particle histories.        |
| [GTAO](./GROUND_TRUTH_AMBIENT_OCCLUSION.md)                    | Horizon AO, bent normals, integration and quality boundaries.             |
| [SSR](./SCREEN_SPACE_REFLECTIONS.md)                           | Hi-Z reflection tracing, material response, rejection and fallback.       |
| [SSGI](./SCREEN_SPACE_GLOBAL_ILLUMINATION.md)                  | Portable diffuse trace, temporal denoise and composition.                 |
| [Dynamic GI](./DYNAMIC_GLOBAL_ILLUMINATION.md)                 | Unreleased DDGI/software-BVH and SSGI hybrid, with evidence boundaries.   |
| [Volumetric lighting](./VOLUMETRIC_LIGHTING.md)                | Froxels, fog, lighting, integration and history.                          |
| [Atmosphere and weather](./PHYSICAL_ATMOSPHERE_AND_WEATHER.md) | Atmosphere LUTs, clouds/shadows, exposure and display.                    |
| [Physics](./PHYSICS_ARCHITECTURE.md)                           | Optional Stage Systems, portable worlds, Rapier and lifetime.             |
| [Particles](./PARTICLE_SYSTEM.md)                              | Optional addon, CPU/GPU/stateless execution and P6 authoring.             |

## Contribute and plan

- [AGENTS](../AGENTS.md) and [contributing](../.github/CONTRIBUTING.md): repository rules.
- [Engineering](./ENGINEERING.md): toolchain, packages, testing, CI and release workflow.
- [Roadmap](./ROADMAP.md): implemented slices, evidence gates, extensions and unstarted work.
- [Rendering roadmap](./MODERN_WEBGPU_RENDERING_ROADMAP.md): A0/M0 and remaining rendering work.
- [Physics rollout](./PHYSICS_IMPLEMENTATION_PLAN.md): delivered P0–P4 and planned P5.
- [Archive](./archive/README.md): historical designs and dated validation; not current instructions.

## Showcase notes

[CSM toy town](./CSM_TOY_SHOWCASE.md), [LUMEN lighting study](./LUMEN_LIGHTING_STUDY.md),
[physics exhibits](./PHYSICS_EXAMPLES.md) and [example catalog](./EXAMPLE_CATALOG.md) preserve art
direction, interaction and reviewed evidence. Asset licenses and immutable benchmark baselines
remain source artifacts; their age alone is not a reason to remove them.

## Sources and maintenance

For a consumer, the installed package's declarations and matching release docs define available API.
For engine work, current source and executable tests take precedence, followed by rendering
architecture, the relevant current topic and engineering workflow. Roadmaps describe future work;
archives are historical context and never override current contracts.

Update the relevant contract when architecture, lifecycle, backend policy or workflow changes. Keep
exact API signatures in TypeDoc/declarations and use checked recipe source for runnable snippets.
Link to existing topic owners rather than duplicating ABI tables or completion lists. Record dated
validation separately from implementation status. Run `npm run docs:check` for source links,
commands, recipe synchronization and TypeDoc; publishing also runs site link validation.
