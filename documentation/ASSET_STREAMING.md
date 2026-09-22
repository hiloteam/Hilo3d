# A0 asset streaming

Status: **Unreleased texture slice implemented; physical-device performance evidence pending.**
`@hilo/addon-assets` is an optional workspace. The checkout version does not imply this addon is
published. See [version boundaries](./VERSIONS.md).

## Ownership

The addon owns versioned manifests, HTTP requests, worker decoding, demand arbitration, leases and
residency budgets. Core `Renderer.uploadTextures()` validates and uploads ordinary Texture objects
through the shared Render Graph, TextureResourceCache and RHIUploadBatch. It creates an upload-only
submission, emits no draw or present, and resolves at that submission's fence. It rejects nested
frame use, preserves uncommitted cache revisions on failure, and uses the existing submission-aware
resource registry for retirement. This is a generic renderer capability, not a backend-specific
asset stack.

`createAssetStageSystem()` installs `ASSET_STAGE_SERVICE`. The manager updates before Stage
traversal and is destroyed before the renderer. Standalone AssetManager defaults to demand-driven
rAF updates; use `autoUpdate: false` and call `update()` for an application-owned cadence. Updates
may start HTTP work and return before decoding finishes. Tick before awaiting a lease's `ready`; do
not wait for residency during Stage System setup while no update loop is running.

## Identity, demand and failure

A manifest declares non-empty id/version/URL, exact response byte length, dimensions and full mip
count. `(id, version)` is the shared identity. Reusing it with different metadata is rejected; a new
content revision requires a new version. HTTP URLs receive `hilo_asset_version`. Each lease has its
own priority, visibility and finest desired mip. Highest visible priority is serviced first; finest
visible mip wins. Hidden demand does not block visible consumers of the same identity.

An immediate 1×1 placeholder permits scene construction. First residency uses the coarsest authored
mip, then promotes to the desired suffix. `ready` resolves after initial demand reaches a completed
upload. `setDemand()` returns a fresh readiness promise and rejects a superseded pending waiter with
AbortError. Ignored readiness promises are internally observed. Final release cancels work and
retires the texture; cancellation of one lease does not invalidate other owners. Late worker results
cannot publish after demand changes, release or manager destruction.

Network/decoder errors and deadline failures reject affected waiters and remain in diagnostics until
explicit retry or changed demand. Automatic retry loops are avoided. Worker cancellation terminates
the running worker, including synchronous WASM work; subsequent jobs create a new one.
Initialization failures do not retain a poisoned worker. HTTP response reads are bounded by declared
size.

## Formats and coordinates

The first slice supports non-array, non-cube 2D KTX2 with full mip chains: ETC1S/BasisLZ and UASTC
LDR, including UASTC Zstandard. Native storage formats, HDR, `.basis` containers, video, arrays,
cubemaps, premultiplied images and swizzled/orientation-flipped assets are rejected explicitly. This
does not change core KTX1 support. glTF `KHR_texture_basisu` import integration is not included in
this slice.

KTX2 headers, section ranges/overlap, manifest agreement and metadata are checked before WASM.
Source orientation must be top-left `rd`; GPU blocks cannot be vertically flipped by the engine. The
addon sets `Texture.flipY=false`, so managed texture sampling keeps the existing single
normalization boundary. DFD transfer selects linear/sRGB storage. Device capability preference is
ASTC 4×4, BC3, ETC2 RGBA, then uncompressed RGBA8; native GPU handles never cross the addon
boundary.

The decoder uses an unmodified, checksum-pinned WASM C ABI from
`@h00w/basis-universal-transcoder@2.1.0`. Its JavaScript wrapper is neither imported nor adapted.
Strict TypeScript supplies the required numeric ABI and bounded heap-growth callback. The binary and
notices ship with the addon; the upstream package is a development build input only. Actual ETC1S
and UASTC fixtures, full-chain decoding and all four output families are tested.

## Budget and residency contract

Independent limits cover concurrent fetch/decode jobs, live identity count, source bytes, owned CPU
payload/reserved job scratch, in-flight bytes, estimated resident texel bytes, uploads per update
and upload bytes per update. Default worker heap limit is 32 MiB per worker, reserved conservatively
in CPU accounting; WASM growth is rejected above that limit. Custom decoders own their internal
memory policy. Budgets exclude JS object/VM overhead and unrelated engine resources; GPU values are
texel estimates, not driver memory measurements.

One mip suffix is an atomic upload unit. Requests that cannot fit alone fail immediately and require
a coarser demand or larger budget; they do not wait indefinitely or silently exceed upload budgets.
Old and replacement GPU allocations are counted together until completion. Hidden residents are
evicted in LRU order when CPU/GPU admission stalls; visible residents are retained, so a working set
larger than the budget reports a stall instead of thrashing. Eviction retirement bytes remain
charged until the renderer fence settles. Public `Renderer.waitForIdle()` snapshots already
submitted work, so later animation frames cannot indefinitely extend retirement; failures still
settle every captured fence before the wait rejects. Diagnostics report demand, resident mip, bytes,
cancellation, evictions, failure and stall reason.

Mip suffixes use physically smaller allocations and keep the public Texture object. CPU mip bytes
are retained for recovery. Loss invalidates residency and clears backend ownership; restored
textures are replayed through the same upload budget. Old asynchronous completion cannot publish
residency into a new device epoch.

The current implementation fetches whole KTX2 files and re-fetches on refinement (normal HTTP
caching may reuse the response). It does not claim sparse HTTP range streaming, virtual textures,
incremental tile uploads or a global budget covering all renderer allocations. Geometry
pages/meshopt remain the next A0 slice after measured texture workloads. Compiled shader warmup is
independent.

## Validation and remaining evidence

Unit coverage includes priority, coarse-first promotion, shared lease ownership, stale replies,
cancel/retry, source-size rejection, bounded admission, hidden eviction and device epochs. Browser
fixtures decode real files in workers, upload through both backends, inspect pixels and exercise
device recovery without replacing the public texture. Package tests repeat this against installed
tarballs and emitted local worker/WASM assets, without repository aliases.

Use [Texture Residency Lab](../examples/asset_streaming.html) to switch visible sets and requested
detail under a one-set budget. These are correctness fixtures, not enrolled throughput measurements.
Physical low-bandwidth cold-start, teleport, peak-memory and device-pressure budgets remain evidence
gates in [ROADMAP](./ROADMAP.md). Do not mark all of A0 complete based on format loading alone.

Validation recorded on 2026-09-22 for the implementation worktree based on `16827950` (not a release
tag or immutable performance capture): `test:unit` passed 2,194 tests with one capability skip;
`test:ui:contract` passed 34 tests; the two backend residency interactions and two generic example
rendering cases passed. `test:package:built` and `test:addon-assets-package` passed with real
worker, WASM, pixel and recovery checks. Type checking, lint, formatting, API reports, documentation
sources, example build, architecture/RHI checks, package version synchronization and UI grouping
also passed. The physical-GPU lane, full visual matrix and full `validate` were not run.
