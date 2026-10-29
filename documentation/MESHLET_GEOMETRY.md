# Meshlet geometry and page streaming

Status: bounded source implementation; validation and performance gates are recorded separately
below. This is the bounded M0 geometry slice on the existing WebGPU Clustered Forward+ pipeline. It
uses the shared Render Graph, portable RHI, PBR material evaluator and GLSL → Naga raster path.

## Offline asset contract

One asset describes a rigid, indexed, single-material primitive. Split a multi-material model into
material primitives before cooking. Version 1 stores position XYZ, normal XYZ and logical UV0 XY in
eight float32 components per vertex, with unit normals and page-local uint32 indices. It does not
encode skin, morph, UV1, vertex colors or tangent streams.

Run the offline cooker from a repository checkout after `npm ci`; the npm runtime package does not
ship this CLI or the meshoptimizer development dependency.
`npm run geometry:cook -- input.json output-directory` accepts arrays named `positions`, `normals`,
`uv0` and `indices`. It writes `manifest.json` and independently fetchable `page-N.bin` files. The
pinned offline `meshoptimizer` dependency partitions geometry and performs actual attribute-aware
edge-collapse simplification. Group boundaries remain locked across LODs. Each group has a
conservative local sphere and complete fine-to-coarse replacement pages with monotonic absolute
error. Each page contains clusters of at most 64 vertices and 64 triangles.

This format uses discrete group LODs. It does not claim an arbitrary hierarchical cluster DAG,
native mesh/task shaders or Nanite equivalence. Version 1 pages are uncompressed; offline use of
meshoptimizer does not imply compressed HTTP transport or runtime meshopt decoding.

The manifest declares exact page counts, wire lengths and CRC-32 checksums. Decoding validates
magic/version, header fields, exact length, finite attributes, index ranges, complete meshlet
coverage and conservative sphere/cone bounds before page installation. Checksums detect corrupt or
mismatched content; they are not cryptographic authentication. Content changes require a new asset
content version, independently of the format's schema version.

## CPU page ownership

`MeshletGeometry` holds a frozen manifest and private copies of validated CPU pages. Its identity
does not change when pages arrive or are evicted. `setPageData()` and `evictPage()` advance a CPU
revision; `hasPage()` reports CPU availability, not GPU residency.

The optional `@hilo/addon-assets` `GeometryPageManager` owns requests and CPU pages for one
geometry. Its source declares a stable asset id, content version and URL for every manifest page.
Application demand is explicit: `acquirePage(pageId, { priority, visible })` returns a
reference-counted lease. Visible fine-page leases also request and pin their group's coarsest page.
Shared leases reuse requests and pages; releasing one does not remove another lease's fallback.

`lease.ready` resolves when the requested and coarse CPU pages are decoded and installed. It does
**not** promise GPU upload completion. Rendering must continue to advance residency. A changed
demand rejects the previous pending waiter with `AbortError`; failed requests remain observable
until retry or a demand change. Final release, cancellation and manager destruction prevent late
responses from publishing data. The manager exclusively owns its geometry's pages while alive.

Separate limits cover HTTP concurrency, live page records, source size, CPU payload/scratch,
in-flight network bytes and decode work per update. Responses are read with exact byte bounds and
cancelled on failure. CPU admission reserves decode and defensive-copy scratch before accepting
concurrent responses. Hidden pages can be evicted under pressure; visible pages and their coarse
dependencies remain protected. A working set larger than the configured budget reports a stall.

Updates use demand-driven animation frames by default. With `autoUpdate: false`, the application
calls `update()` before rendering. `destroy()` stops updates, cancels requests and releases owned
CPU pages. GPU resource retirement remains the renderer's responsibility.

## Renderer integration and budgets

The renderer path is WebGPU-only and retains the existing Clustered pipeline's single
PerspectiveCamera view contract. Version 1 accepts the compact opaque/alpha-masked PBR subset with
UV0 textures. UV1, tangent normal mapping and whole-object `bucket.lods` cannot be combined with
meshlet buckets and fail explicitly. Standard shadow-atlas rendering, directional virtual shadows,
DDGI, depth, PBR, material attributes and TAA use shared semantic shader code. The existing virtual
shadow and DDGI content restrictions still apply to the rest of the scene.

Register the asset as `GPUSceneBucket.meshlets` alongside the ordinary `geometry` and `material`.
The ordinary geometry supplies scene identity, bounds and a complete fallback. Before every group
has an available complete GPU LOD, the object uses this fallback. Asset authors must make fallback
geometry cover the same surface; an unrelated placeholder does not satisfy that contract.

After loading each group's coarsest CPU page, `createMeshletFallbackGeometry(meshlets)` builds an
independent small ordinary mesh with rebased indices. Register it as `geometry` and retain the same
`meshlets` object for later refinement. This avoids requiring the full-resolution source mesh at
startup. The helper rejects incomplete coarse sets and copies its output; later page eviction does
not invalidate the ordinary fallback.

The renderer owns a fixed-capacity packed geometry arena per meshlet bucket and renderer. Its
capacity is independent of total source asset size. `maxResidentBytes` bounds the arena;
`maxUploadBytesPerFrame` bounds admitted page and page-table writes; `maxVisibleMeshlets` bounds
compacted output. `maximumProjectedError` controls screen-space LOD selection in physical pixels;
zero requests the finest available level. Visibility output and control buffers have their own fixed
allocations and are included in total allocation diagnostics. Initial arena allocation and full
CPU-shadow device recovery are separate from incremental page admission and can upload the full
reserved arena. The per-frame admission counter is not a measurement of every native queue upload.
Registering the same asset in several material buckets creates independent arenas. Meshlet
`allocatedBytes` counts the arena, visibility/history and control buffers; retained ordinary
fallback buffers, shared renderer resources and driver overhead are accounted separately.

GPU work selects complete resident LODs, culls clusters and compacts object/meshlet references into
fixed material buckets. Vertex pulling consumes a bounded triangle template and the packed page
data. It changes vertex sourcing while retaining the existing PBR evaluator. Draw count does not
grow by creating a CPU Mesh or a separate draw for each cluster. Overflow must retain a complete
object fallback rather than draw a truncated surface.

Page mappings, upload revisions and temporal participation follow successful frame submission.
Discarded frames do not publish residency. A later frame retries pending changes. Resource release
and device recovery rebuild renderer-owned data from retained backend-neutral CPU pages. Arena
allocation, occupied page bytes, pending uploads and visible cluster counters are distinct from the
manager's CPU/network accounting; none is a hardware memory or performance measurement.

## DDGI and virtual-shadow composition

DDGI uses the finest **resident** complete page from each group, independently of the main camera's
selected raster LOD or visible-cluster overflow. Pages admitted by the current frame participate in
the same candidate ray-scene update; CPU availability alone does not make a page a ray input. If any
group has no resident page, the entire ordinary fallback supplies that object's ray geometry.
Refinement and eviction therefore change transport geometry instead of leaving GI permanently on the
coarse fallback. Offscreen objects still contribute under the existing hierarchy, layer and
`contributeToGlobalIllumination` rules.

A cached internal geometry snapshot preserves positions, normals and logical UV0 without changing
`Mesh.geometry`. Page identities determine cache reuse; source pages are weakly referenced. After a
successful ray-scene update, buckets with no remaining GI participants release their snapshots; a
bucket still shared by any contributing instance retains its cache. The snapshot owns 96 numeric
bytes per selected triangle, separately from the geometry arena, the asset manager's CPU accounting
and DDGI's packed triangle/BVH/material storage. The existing global DDGI `maxTriangles` limit
counts every contributing instance and is checked before allocating a new meshlet snapshot. A
refined working set that exceeds it fails clearly. Material textures, masks, transforms, ray-scene
dirty ranges, probe updates and optional SSGI composition retain the
[DDGI contract](./DYNAMIC_GLOBAL_ILLUMINATION.md).

Directional virtual shadows select complete resident group LODs by projected error in shadow texels.
Selection uses the light's clipmap projection and virtual resolution, so all physical pages of one
clipmap choose the same group LOD, including page borders. It does not reuse the main-view
visible-cluster list. Each physical page has a bounded independent cluster output; reserving a whole
object's output fails atomically to its ordinary geometry when capacity is exhausted or a complete
group set is unavailable. Missing or deferred virtual-shadow atlas pages separately keep the
existing stable-CSM fallback.

Enabling virtual shadows adds `12 * maxVisibleMeshlets * physicalPageCount` bytes of visibility
storage per meshlet bucket, plus 24-byte indirect and 256-byte aligned-offset records per physical
page. These fixed allocations are included in meshlet `allocatedBytes` and device-limit planning;
they are additional to `maxResidentBytes`, which bounds only the geometry arena. Indirect
`firstInstance` remains zero because the shader consumes an explicit per-page visible offset. The
shared selected-object table uses the configured object capacity as its physical-page stride.

Physical atlas rows and local page UVs use top-left coordinates. The shared virtual-atlas helper
places that coordinate directly into the page's raster rectangle. Sampling then explicitly converts
the top-left atlas coordinate to this path's projected-attachment coordinate with `(u, 1 - v)` and
crosses `hiloRenderTargetUV()` exactly once. This documented local attachment-coordinate exception
does not change the engine's top-left managed-texture convention. The
[asymmetric atlas fixture](../test/spec/renderer/VirtualShadowAtlasSampling.test.ts) exercises the
production helper on WebGL2 and WebGPU, checking nonadjacent physical rows and different local V
positions rather than a vertically symmetric image.

Authored directional `minBias`/`maxBias` retain the selected stable CSM cascade's depth units.
Before sampling a virtual clipmap, both depth rows are expressed in the same view-space basis: the
virtual world-space Z row is multiplied by the existing `mat3(inverseView)`, then its norm is
divided by the selected CSM view-to-shadow Z-row norm. This also preserves the conversion for scaled
or sheared cameras without adding a matrix inverse. The standard/reversed-depth sign is then applied
as usual. This conversion prevents a different clipmap depth span from magnifying the authored bias
and erasing shallow receiver shadows; it does not retune the light's public bias values. The same
fixture compares actual stable/virtual receiver shadows with authored bias.

Geometry-page mappings, DDGI upload revisions/probe histories and virtual-shadow page tables retain
their own submission transactions in the same Render Graph. A rejected frame does not commit
candidate GPU mappings or histories; CPU snapshots may be prepared early and their uploads are
retried against the appropriate committed revisions. Device recovery restores CPU-backed geometry,
invalidates probe/virtual-page histories and resumes bounded updates. Renderer destruction releases
the extra CPU snapshots and virtual-shadow buffers.

## Acceptance and remaining scope

[STRATA / 风蚀石庭](./STRATA_SHOWCASE.md) is the maintained visual and streaming showcase. It uses
original Blender geometry, independent immutable page URLs, projected-distance demand, coarse
comparison and real CPU/GPU residency counters. Its additional regressions cover non-temporal
capability sizing, multiple materials/instances, material compatibility changes, positive-error LOD
selection and opaque textured shadow casters. The cooker computes conservative cone data from
serialized Float32 triangle planes, including a retained near-flat boulder regression.

The original procedural fixture in `test/fixtures/meshlets/` is reviewed source data. Regenerate it
with `npm run geometry:fixture`; inspect manifest/page changes rather than treating them as
disposable build output. Its source grid, normals and UVs also create an ordinary geometry
reference.

`npm run test:meshlets` exercises actual HTTP page responses, the production WebGPU pipeline,
offscreen pixels, coarse-to-fine updates, per-frame upload limits, transformed geometry, eviction,
device recovery and teardown. It is also included in the software and native WebGPU commands.
Format, cooker, CPU ownership, streaming and renderer transaction regressions supplement that path.

Historical validation of the initial slice on 2026-10-28, before DDGI/virtual-shadow composition, on
development branch `codex/meshlet-geometry-streaming` based on dev
`df0d45528eb032957b420f19dc2067cfa9199355`, using npm 10.9.4:

| Gate                                                                                      | Executed result                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Meshlet format/cooker/ownership/streaming, Clustered, shadow and architecture regressions | 24 files / 286 tests passed on the final cleanup source.                                                                                                                                 |
| Portable RHI and native-RHI tests                                                         | 224 portable and 3 native-RHI tests passed; the software adapter's optional f16 case was skipped.                                                                                        |
| Complete software WebGPU browser command                                                  | 34 tests passed in 24.9 minutes, including the new HTTP page fixture and existing 110k-object, SSR, GI, shadow and lifecycle scenes.                                                     |
| Native meshlet browser fixture                                                            | Passed with fallback-adapter rejection enabled, after the final cleanup fix.                                                                                                             |
| Actual installed packages                                                                 | `test:package` passed, including the new core/addon ESM exports and absence of the offline meshoptimizer dependency; existing asset worker, pixels and recovery passed on both backends. |
| Static/package contracts                                                                  | Build, typecheck, lint, API update/check, consumer types, documentation and formatting checks passed.                                                                                    |
| UI ownership                                                                              | Group audit passed: all 123 existing WebGL2 cases are scheduled exactly once.                                                                                                            |

The complete software browser run preceded a final destruction-only correction: clear retained
caster references and release every meshlet buffer even when one retirement throws. Afterwards, 11
focused CPU/GPU tests, the final 286-test combined selection and the native page fixture passed. No
pixel threshold, retry or existing failing case was weakened. The procedural source contains 1,152
triangles; its complete coarsest pages contain 228 triangles. This is a geometry correctness
fixture, not a frame-time or bandwidth benchmark.

Full `validate`/coverage, every gallery/editor/physics browser group and the complete native-device
matrix were not rerun. Physical-device CPU/GPU time, memory pressure, low-bandwidth teleport
workloads and cross-commit bandwidth/culling comparisons require separately reviewed evidence. Wider
vertex formats, deformation, compressed/range-loaded pages and a hierarchical cluster DAG remain
future extensions in [the roadmap](./ROADMAP.md).

Follow-up validation on 2026-10-29 covered the expanded M0/DDGI/directional-VSM combination: all six
shared WebGL2 CI groups passed (123/123), the complete software WebGPU command passed (38/38), and
focused native acceptance passed (4/4), without retries or skips in those runs. The
[STRATA validation record](./STRATA_SHOWCASE.md#validation) owns the exact source fingerprints,
native/tooling boundary and report locations. Focused source fixtures include
`MeshletRayGeometry.test.ts`, `MeshletGlobalIllumination.test.ts` and
`MeshletVirtualShadows.test.ts`. These functional results do not complete the full `validate`
aggregate, coverage, the complete native-device matrix or physical-performance enrollment.
