# STRATA / 风蚀石庭

STRATA is a sandstone sculpture garden for bounded M0 meshlet streaming, DDGI and virtual shadows.
Open `examples/meshlet_strata.html?backend=webgpu` through `npm run examples:dev`. The example is
featured in the gallery and explicitly requires WebGPU.

## Visual target and comparison

The concept was generated first with the built-in image generator. It established a warm stone
aperture, bronze seams, concentric steps, a receding quarry promenade and a restrained editorial UI.

![Generated visual target](./images/strata/concept.png)

The fixed concept is 1672×941 pixels. Composition comparisons use that exact viewport at device
pixel ratio 1, with the production geometry and resolution. The implementation uses original
editable Blender geometry, PBR lighting, DDGI, virtual shadows, GTAO, TAA and the existing
volumetric-lighting feature. The saved native runtime captures include DDGI and virtual shadows; the
desktop views use the same 1672×941 dimensions as the concept. It is an interactive
geometry-and-material reconstruction, not a pixel-identical reproduction: individual erosion marks,
silhouettes and lighting still differ from the generated image.

![STRATA running on native WebGPU](./images/strata/runtime-overview.png)

The original ring silhouette, right-offset opening, low podium ellipse, foreground stone positions
and corridor vanishing point guide the desktop composition. UI placement is measured against the
same concept, including the narrow 114×180-pixel control panel. Surface and Passage use a compact
title treatment; portrait Overview reframes the sculpture. Orbit, wheel and touch use public
`OrbitControls`, and presets use `setView()`.

## Authored content

The editable [Blender scene](../examples/models/Strata/strata.blend), its
[authoring script](../examples/models/Strata/author_strata.py) and
[rebuild/provenance notes](../examples/models/Strata/README.md) accompany the runtime assets.
Blender MCP ran the authoring script in an isolated background process and preserved the previously
open project. The hero is a cut annular stone slab with broad front/back faces, deep side cuts,
chamfered and fractured rims, an asymmetric opening and three bronze repair joints. Sedimentary
ridges, broken edges and granular displacement are real geometry. Carved monoliths, boulders, quarry
walls, complete passage frames, floor, concentric podium and foreground gravel are also meshes.

The validated export contains 213 instances and 1,287,944 instance-weighted source triangles. Its
complete coarse scene contains 889,236 triangles, including ordinary geometry that is not streamed.
The three streamed prototypes contain 314 groups and 1,131 independent pages, totaling 8,520,768
encoded bytes across all authored levels:

| Prototype | Source triangles | Groups | Pages | Encoded bytes |
| --------- | ---------------: | -----: | ----: | ------------: |
| Aperture  |           91,632 |    211 |   749 |     5,724,412 |
| Monolith  |           32,480 |     74 |   291 |     2,060,604 |
| Boulder   |           12,320 |     29 |    91 |       735,752 |

`scene.json` and its referenced manifests remain authoritative. These are content counts, not
performance measurements. The validated content version is
`sha256:edd84f53519347fe3d83b18460af4f788aa419a7e26c5fe2120076745994c58a`.

The current material inputs are the generated `sandstone-weathered.png` and `limestone-quarry.png`.
They supply base color; vertices, normal streams, silhouettes and contact shadows come from the
scene geometry and renderer. The generated `quarry-sky.png` contains sky only and is sampled on an
unlit enclosing sphere. It does not contain the quarry, sculptures, podium or foreground terrain.
See the retained [image-generation prompts](./images/strata/prompts.md) and asset provenance notes
for the authored inputs.

## Streaming and rendering

Each asset first acquires every group's coarsest CPU page, then builds its ordinary fallback with
`createMeshletFallbackGeometry()`. Full source primitive JSON stays in ignored cooking inputs.
Camera distance and projected group error determine finer page demand. Fine leases are released when
no longer needed; setting CPU visibility false alone would retain cached pages and would not reclaim
GPU arena space. Coarse leases stay pinned while the scene is alive.

- **Adaptive** requests useful fine levels and lets the GPU choose complete resident LOD groups.
- **Coarse** releases fine pages while retaining a complete visible scene.
- **Streaming off** cancels fine demand and retains the coarse foundation. Re-enabling it applies
  the current camera's demand.
- **Live geometry** shows actual renderer cluster/residency counters, CPU page accounting, DDGI
  scene triangles and virtual-shadow requested/resident pages. Its **Indirect bounce** checkbox
  changes DDGI intensity between one and zero while keeping the scene and probe updates active.

The aperture bucket has an 8 MiB GPU arena; each other streamed prototype has 4 MiB. Every streamed
bucket admits at most 512 KiB of incremental page/page-table writes per frame and has a bounded
visible-cluster buffer. Each page manager separately budgets 16 MiB of CPU payload/scratch, eight
concurrent requests, 1 MiB of in-flight bytes and a 64 KiB source-page limit. Decode work is bounded
to eight pages and 256 KiB per update. These are per-asset limits; ordinary fallback buffers and
shared effects remain separate allocations. Readback is used for UI diagnostics only and never
drives GPU culling or indirect draw arguments. The renderer still follows shared frontend → Render
Graph → portable RHI. See [the M0 contract](./MESHLET_GEOMETRY.md) for initial allocation/recovery
accounting and limits.

Pages and static primitives live in immutable digest directories. A successful offline build
publishes `scene.json` by atomic rename only after every referenced version exists. The content
version includes texture bytes, so rebuilding an albedo also invalidates the image URL.

DDGI and virtual shadows are enabled by default. `gi=0` disables DDGI at initialization and disables
the Indirect bounce checkbox; `virtualShadows=0` selects the ordinary shadow path. The independent
`shadows=0` query removes the key light's shadows for diagnostic comparison. The ordinary shadow
fallback retains two stable cascades. Warm directional lighting and cooler fill illuminate the PBR
surfaces. Distance haze uses the pipeline's existing froxel volumetric-lighting feature. The current
showcase does not enable the physical-atmosphere, procedural cloud or cloud-shadow passes; its sky
is the separate sky-only texture described above.

DDGI covers a finite hero study: the aperture, nearest two monoliths, nearest two boulders, ten near
quarry courses and their supporting architecture contribute 74 meshes with at most 247,560
full-detail triangles. Initialization checks this authored selection against limits of 262,144
triangles and 96 meshes. The ray scene follows complete GPU-resident meshlet groups as pages arrive
or leave; it does not keep a permanent coarse lighting proxy. Selected materials use their actual
UV0 textures under strict `texturePolicy: 'sample'`, with an atlas capacity derived from the decoded
images: exactly 3,145,032 texels for the two stone textures.

Distant quarry courses, the remaining monolith/boulder instances and gravel explicitly opt out of
the ray scene while retaining normal raster and shadow participation. The sky sphere also opts out
of rays and remains an unlit background without casting or receiving shadows. This bounded selection
is an authored lighting scope, not whole-quarry ray coverage or silent budget eviction.

| Setting                   | Production | Software test profile |
| ------------------------- | ---------- | --------------------- |
| DDGI probe grid           | 7×5×7      | 5×3×5                 |
| DDGI updated probes/frame | 16         | 4                     |
| Rays per updated probe    | 64         | 64                    |
| Probe-volume span         | 21×8×21    | 21×8×21               |
| Virtual-shadow resolution | 1024       | 1024                  |
| Shadow page size          | 128        | 128                   |
| Physical shadow pages     | 32         | 8                     |
| Shadow page updates/frame | 8          | 4                     |

`window.__HILO3D_STRATA__.diagnostics()` exposes the official `DynamicGlobalIlluminationDiagnostics`
and `VirtualShadowMapDiagnostics` snapshots, together with the current `indirectLight` control
state. Scene triangle/ray counts and requested/resident shadow pages describe actual work; their
budgets are separate from the geometry arenas above.

## Lifecycle and capture

Page suspension pauses the ticker and controls while preserving resources. A persisted `pageshow`
resumes the same scene. Final teardown stops scheduling first, cancels requests, drains pending
diagnostics/submissions and releases scene/texture resources; cleanup failures remain observable.

Initial fine-detail readiness follows the currently active lease identities. Resizing or changing
the view while a real response is pending can replace those leases; cancellation of a superseded
lease does not dispose the scene. Readiness then waits for the replacement demand. Network or decode
errors belonging to a still-current lease retain the normal fatal error path.

`?test=1` installs the shared capture controller. The software profile caps the backing dimensions
at 640×400 and shadow slices at 1024 pixels. It uses the same scene, pages, material shaders,
lighting, submissions and interactions. `?test=1&quality=production` retains full output and shadow
resolution. No global time/randomness replacement or fake draw completion is used.

`scripts/geometry/preview-strata.ts` saves submitted native-GPU Overview, Passage, Surface and
portrait captures through `test/ui/stable-capture.ts`. Desktop captures use the original 1672×941
concept dimensions; `--without-shadows` is an explicit diagnostic comparison. The reference and
runtime images remain separate artifacts.

## Validation

The DDGI/virtual-shadow extension passed the following checks on 2026-10-29. The four STRATA cases
retain real HTTP Request identities, submissions, shaded pixels, post-capture pointer/wheel input,
preset changes, portrait layout, BFCache pause/resume and post-disposal error observation. The GI
comparison uses the actual checkbox, 32-frame convergence intervals and an aligned static baseline;
it does not replace fetch, preread response bodies, synthesize pixels or stop probe updates.

| Gate                                                | Executed result                                                                                                                                               |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Complete affected hosted-profile WebGL2 groups      | 123/123 passed: catalog 27, catalog-scenes 71, CSM 3, physics 9, post-processing 11, chromatic 2.                                                             |
| Complete software `npm run test:webgpu`             | 38/38 passed in 31.7 minutes, including all four STRATA cases.                                                                                                |
| Native production STRATA                            | 4/4 passed in 179.9 seconds.                                                                                                                                  |
| Focused renderer/geometry/assets/shader regressions | 37 files / 347 tests passed; the final GI/cache lifecycle suite separately passed all three cases.                                                            |
| Shader source guardrails                            | 17 tests passed, including complete-source/fragment classification and regex-context regressions.                                                             |
| Architecture and RHI                                | 150 architecture, 224 portable RHI and three native RHI API tests passed; one optional f16 capability case was skipped.                                       |
| Static and package contracts                        | Build, modernity, format, lint, typecheck, synchronized versions, consumer skill, API update/check, consumer types, docs, examples and package checks passed. |

All three browser lanes finished without retries, skips, flaky cases or unexpected failures. Every
WebGL2 group and both complete broad-lane receipts confirm unchanged source. The broad gates used
HEAD `da3f2506c984f76740ec541df03ff35184992506` plus the tested working tree, with fetched
`origin/dev` at `df0d45528eb032957b420f19dc2067cfa9199355` and fingerprint
`5a52414241d8fb4b08f0b027f6ff8f62e84bee78b96bf2c7206c16b48fe66574`.

The native four-case receipt uses fingerprint
`24795da8383141566e048bf690d75977813c8b6af8f41be8556f04aef07fe73e`. Only
`scripts/shader-modernity.ts` and its regression test changed afterward to correct regex matching
context; renderer and example sources were unchanged. The subsequent broad lanes use the corrected
scanner. These final acceptance notes were updated after testing; no runtime or test implementation
changed after the broad gates.

Ignored reports preserve exact cases, timings, images, blobs, JSON/HTML and source receipts:

- `reports/strata-lighting-ui-ci-verified/`: all six complete hosted-profile groups.
- `reports/strata-lighting-webgpu-verified/`: the full software matrix and extracted STRATA
  evidence.
- `reports/strata-lighting-native-final/`: native production cases and extracted evidence.
- `reports/strata-validation/`: focused CPU/GPU regressions, including virtual-atlas sampling,
  scaled/sheared-camera bias, ray transport, cache retirement, rollback and recovery.

The final software streaming case took 168.743 seconds against its unchanged 180-second budget.
Actual DDGI scene triangles changed from 98,504 coarse to 184,794 refined, returned to 98,504 after
coarsening and reached 184,794 after streaming resumed. Fine demand reached 627 pages. The software
GI comparison changed 64.50% of receiver pixels, with mean RGB difference 8.92870 against a repeated
on-state baseline of 0.075524; restoration produced mean difference 8.90112. Diagnostics recorded
256 rays per frame and eight resident shadow pages. These counts and local durations are correctness
evidence, not hardware memory measurements or enrolled performance comparisons.

Development evidence remains separate. An earlier software run passed three cases but reached the
unchanged fine-page readiness deadline at 604/627 pages. Aligning request concurrency with the
existing eight-page decode budget resolved that case without increasing timeouts or weakening
assertions. Reports remain in `reports/strata-lighting-software/`. The first final WebGL2 attempt
was deliberately interrupted during catalog testing to fix the independently reviewed scanner issue;
`reports/strata-lighting-ui-ci-final/` records nine passes, one interruption and 17 unrun cases. It
is not counted as a completed group or a renderer failure.

The original MR #142 records predate the lighting extension: three native STRATA cases, 37 software
WebGPU cases and 123 WebGL2 cases passed. Those historical receipts remain in
`reports/strata-all-fixed-native/`, `reports/strata-validation/full-webgpu.json` and
`reports/strata-ui-ci-fixed/`; they do not substitute for the newer results above. The original
startup-demand regression reproduced an `AbortError`/disposed scene before its lease-identity fix.
The source geometry, textures and immutable content version listed above have not changed.

The complete `npm run validate`/coverage aggregate, the entire native WebGPU matrix and enrolled
physical performance benchmarks were not run. Local macOS checks used Node 25.8.1, npm 10.9.4 and
Playwright 1.61.1; hosted-profile checks do not establish a hosted Linux driver result. Remaining M0
work is tracked in [ROADMAP](./ROADMAP.md).
