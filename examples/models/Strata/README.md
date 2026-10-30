# STRATA / 风蚀石庭 assets

These original sculptures and architecture were authored for the Hilo3D STRATA showcase in Blender
5.1 and are distributed under the repository MIT license. Current color inputs
`sandstone-weathered.png` and `limestone-quarry.png`, plus the sky-only `quarry-sky.png`, were
created with the built-in image generator. No model or texture was downloaded from an external asset
library. The generated concept illustration in `documentation/images/strata/concept.png` provided
visual direction; it is not used as a runtime scene image.

`strata.blend` is the editable scene, with its original authoring script embedded as a Blender text
block. `author_strata.py` is the accompanying reproducible authoring/export procedure. The script
creates a separate scene and writes that scene to this asset directory; it does not save or replace
the user's currently open Blender project. Its `ROOT` is resolved from the source file's checkout
location.

The aperture, carved standing stone and weathered boulder are streamed assets. The aperture is a
flat cut annular slab with deep sides, chamfered/fractured rims, an asymmetric opening and three
bronze repair joints. Irregular sedimentary ridges, broken edges and granular displacement are
actual vertices. Each streamed primitive uses a single material with position XYZ, unit normal XYZ
and UV0. The validated source prototypes have 91,632 aperture triangles, 32,480 monolith triangles
and 12,320 boulder triangles; `scene.json` and its referenced manifests carry the authoritative
counts.

Inlays, blocks, quarry cliffs, trim, podium, floor and gravel are ordinary indexed geometry in
`geometry/`. `sandstone-weathered.png` and `limestone-quarry.png` supply base color; runtime normal
mapping is intentionally absent from this version-1 layout. The sky-only image is sampled on an
unlit enclosing sphere. It supplies no terrain, sculptures or foreground objects, all of which are
real meshes. Distance haze uses the existing froxel volumetric-lighting feature rather than a new
atmosphere or procedural-cloud pass.

## Rebuild

1. Run `author_strata.py` through Blender MCP or Blender's Python console in the intended checkout.
   It exports the exact triangulated primitives and `scene-source.json` into ignored
   `reports/strata-source/`, and updates only the STRATA scene, textures and editable `.blend`.
2. From the repository checkout, run `npm ci` and `npm run strata:build`. The strict TypeScript
   cooker reads that source manifest, discovers its assets, and preserves the original static
   primitive values. Streamed assets use pinned meshoptimizer 1.3.0 boundary-locked, attribute-aware
   edge-collapse simplification at target ratios 0.5, 0.2 and 0.08. Absolute error budgets are 0.16
   for the aperture, 0.12 for the monolith and 0.08 for the boulder. Boundary and error constraints
   can stop simplification before its requested ratio.
3. Review `scene.json`, each `pages/<asset>/<digest>/manifest.json`, and its independent
   `page-N.bin` files. Every produced page passes exact lengths, CRC-32, vertex/index topology, unit
   normals, conservative meshlet sphere/cone checks and owning group bounds before publication.

Regeneration stages complete geometry versions before atomically publishing each immutable digest
directory. It never deletes earlier published versions or unrelated files. `scene.json` is replaced
by one final atomic rename, after all referenced files exist. A failed build leaves the previous
scene and its referenced versions usable; retrying an identical build verifies and reuses those
immutable bytes. The scene preserves materials, instances and views, adds asset-relative
`manifestURL` or `geometryURL`, and records a SHA-256 content version derived from the source
export, cooker settings, cooked bytes and local texture contents. This identity is separate from
both scene schema version 1 and meshlet format version 1.

`scene.json` records the current source and coarse-only triangle counts, including ordinary geometry
and repeated instances. The build reports exact group, page and encoded byte counts per asset; these
content counts are not claims about measured GPU performance. The ordinary fallback is assembled
from each group's coarsest pages at runtime; full-resolution source primitive JSON is not shipped
for these assets.

The validated export has 213 instances, 1,287,944 source triangles and 889,236 complete coarse-scene
triangles. Its streamed prototypes have 314 groups, 1,131 pages and 8,520,768 encoded page bytes
across all authored levels. The content version is
`sha256:edd84f53519347fe3d83b18460af4f788aa419a7e26c5fe2120076745994c58a`.

The current runtime reserves an 8 MiB arena for the aperture and 4 MiB for each other streamed
prototype, with at most 512 KiB of incremental uploads per asset per frame. Each CPU page manager
has a separate 16 MiB payload/scratch budget, eight concurrent requests, 1 MiB of in-flight bytes, a
64 KiB source-page limit and at most eight pages/256 KiB of decode work per update. These limits
exclude ordinary fallback geometry, shared renderer effects and JavaScript object overhead.

DDGI and virtual shadows are enabled by default. `gi=0` and `virtualShadows=0` independently disable
those features for diagnosis. The **Indirect bounce** checkbox under **Live geometry** changes DDGI
intensity without removing geometry or stopping probe updates. The same panel reports GI scene
triangles and shadow-page residency, and the test API exposes the official
`DynamicGlobalIlluminationDiagnostics` and `VirtualShadowMapDiagnostics` snapshots.

The finite ray scene includes the hero aperture, nearest two monoliths, nearest two boulders, ten
near quarry courses and supporting architecture: 74 contributors and at most 247,560 full-detail
triangles, checked against 96-mesh/262,144-triangle limits. Complete GPU-resident meshlet groups
provide the selected geometry as pages arrive or leave. The two stone textures contribute exactly
3,145,032 decoded UV0 texels under strict texture sampling. Distant quarry courses, remaining
monolith/boulder instances and gravel explicitly opt out of rays while keeping their raster/shadow
roles. The sky is also excluded from the ray scene and remains an unlit, non-shadowing background.

Production DDGI uses a 7×5×7 grid with 16 probes updated per frame; the software test profile uses
5×3×5 with four updates. Both span 21×8×21 world units and trace 64 rays per updated probe. Virtual
shadows use a 1024 virtual resolution, 128-pixel pages and 32 physical pages in production, or eight
in the software test profile, with eight/four page updates per frame respectively. These lighting
allocations are separate from geometry-streaming budgets. See the
[showcase contract](../../../documentation/STRATA_SHOWCASE.md) for the full lighting scope,
lifecycle and capture details.

Composition is compared with the original concept at exactly 1672×941. The native runtime capture
uses that same size; geometry, erosion detail and lighting do not reproduce every generated pixel.
The concept image itself is never used to render terrain or sculptures. The runtime now follows
current lease identity during initial fine loading: resizing can supersede an old request without
disposing the scene, while current network/decode errors remain fatal.

The DDGI/virtual-shadow extension passed its final validation on 2026-10-29: four native production
STRATA cases, all 123 cases across the six affected WebGL2 CI groups, and all 38 cases in the complete
software WebGPU matrix. There were no browser retries, skips or unexpected failures. The software
streaming case took 168.743 seconds against its original 180-second budget; no timeout or pixel
threshold was relaxed. GI scene triangles followed coarse/refined residency, and the actual Indirect
bounce checkbox produced a pixel change well above the repeated static baseline.

Final reports are retained in ignored `reports/strata-lighting-native-final/`,
`reports/strata-lighting-ui-ci-verified/` and `reports/strata-lighting-webgpu-verified/`. Exact source
fingerprints, the scanner-only change between native and broad runs, interim failures and the
original MR #142 results are recorded in the
[showcase validation](../../../documentation/STRATA_SHOWCASE.md#validation).

These are correctness gates, not an enrolled performance benchmark or a complete native-matrix
result. The full `npm run validate`/coverage aggregate was not run. The visual asset content version
remains unchanged; it does not by itself identify or validate renderer/runtime changes.

The cooker derives cone cutoffs from actual Float32 triangle planes and the serialized axis, then
places the apex behind every plane after rounding. Hemisphere-spanning or unrepresentable cones use
the explicit `coneCutoff: 1` contract, which disables only cone rejection. Geometry, frustum and
Hi-Z behavior remain intact. A four-vertex excerpt from the boulder is retained as the strict
near-flat-cone regression under `test/fixtures/meshlets/`.
