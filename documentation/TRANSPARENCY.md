# Transparency and weighted-blended composition

This contract describes the current source checkout. The weighted-blended API is an unreleased
addition after `2.0.0-alpha.9`; installed-package availability follows [versions](./VERSIONS.md).

## Material classes and composition order

`MaterialInstance.transparencyClass` distinguishes `opaque`, `sorted-alpha`, `additive`,
`transmission`, `weighted-blended`, and `custom`. Coverage remains independent: alpha-mask materials
still discard below their authored cutoff. Transmission takes precedence over alpha blending when
classifying glass and other refractive surfaces.

Ordinary alpha, additive, transmission and custom blending keep the shared, stable back-to-front
renderer list. Refraction retains the captured opaque scene, authored thickness, attenuation and
IOR. It is never automatically moved to weighted blending. The transparent queue uses opaque depth
for visibility and normally does not write it.

Weighted blending is a separate, explicit approximate composition class. All weighted layers resolve
ahead of the sorted transparent queue. Sorted glass, additive effects and ordinary alpha then draw
in their established shared order. The opaque refraction snapshot is taken before weighted layers,
on both Forward and Clustered Forward+. Applications that require exact interleaving between a
weighted surface and a sorted surface must choose one compatible composition class for those
intersections; arbitrary intersecting refractive layers are not solved by this approximation.

## Opt-in and supported assets

Enable `weightedBlendedTransparency: true` on `ForwardRenderPipelineFactory` or
`ClusteredForwardPlusPipelineFactory`, then author participating Basic/PBR materials with
`compositing: { mode: 'weighted-blended' }`. Both choices are required. Rendering such a material
through a pipeline that has not enabled weighted blending fails explicitly. The mode cannot be used
with transmission, GeometryMaterial, SpriteMaterial, or custom shader definitions.

The shared Basic/PBR surface evaluators retain image textures, UV sets/transforms, alpha coverage,
normal mapping, skinning and morphing. Ordinary Forward supports planner-instanced Basic/PBR meshes,
including authored particle quads. Clustered lit PBR uses the existing direct storage lighting path
for both weighted passes, including its material variants and DDGI when enabled; compatible
Basic/unlit content joins the same accumulation attachments. GPU addon particle/custom storage
programs do not automatically acquire weighted semantics and retain their explicit addon composition
paths.

When DDGI is enabled with its strict default asset policy, opt transparent particle meshes out of
ray-scene contribution explicitly with `mesh.contributeToGlobalIllumination = false`. This retains
GI reception/composition and keeps unsupported opaque content fail-closed. Transparent layers do not
become opaque diffuse-ray blockers; transmitted ray transport is a separate capability. The
submitted GI diagnostics count these authored exclusions under `exclusions.disabled`.

Forward uses linear `rgba16float` scene color when weighted blending is enabled. An explicitly
incompatible scene color format is rejected. Static requirements check blendable and filterable
`rgba16float` and `r16float` support before runtime creation; WebGL 2 devices without the required
floating-point attachments fail rather than silently switching composition methods.

## Portable graph implementation

The shared renderer records two material roles, `weighted-accumulation` and `weighted-revealage`,
followed by one premultiplied fullscreen composition. Accumulation uses three `rgba16float` MRTs
with the same additive blend equation; revealage uses one additive `r16float` attachment. No indexed
per-attachment blend extension or backend-specific shader tree is required. Both backends compile
one GLSL ES 3.00 source; WebGPU follows preprocessing → Vulkan GLSL → Naga → WGSL. Native Clustered
PBR uses the constrained readonly-storage variant of that same surface evaluator.

The mathematical weighted sum remains `sum(vec4(radiance * alpha, alpha) * max(0.01, alpha³))`. A
common factor of 128 improves small-value storage and cancels in the RGB/alpha division. The three
attachments are a numeric representation of this one sum, not separate transparency algorithms.

Before allocation the controller counts visible raster primitives times `mesh.instanceCount`,
including every planner-instanced member. Indexed/non-indexed triangle lists, strips, fans, points,
and line topologies have explicit conservative counts; primitive-restart markers can only reduce the
bound. Unsupported wireframe, custom stencil/depth range/depth testing and alpha-to-coverage
configurations fail explicitly. Ordinary opaque/mask coverage remains supported.

For primitive bound N, let P be the next power of two and S = 16384/P. The supported source-radiance
domain is signed finite FP16, [-65504, 65504]; after the common weight factor, every component has
magnitude less than H = 2²³. Choose a dyadic middle range M nearest sqrt(H × S). Each RGBA
contribution is split into an unscaled low segment clamped to ±S, a middle remainder clamped to ±M
and scaled by min(1, S/M), and the final remainder scaled by min(1, S/H). Every stored component is
bounded by S. A rounded FP16 addition increases magnitude by at most twice the addend, so after at
most N fragments every bin stays at or below 32768, safely below 65504. The exact same split applies
to weighted alpha; it cannot overflow separately. Composition restores all segments in float32
before dividing RGB by alpha. A positive-weight mean lies within the source domain, so only
reconstruction roundoff at its endpoints is constrained to that mathematical envelope. Ordinary HDR
radiance is not clipped to unit/display range.

The low segment has no count-dependent downscaling, preserving its FP16 small-value precision. The
larger segments retain FP16 quantization, and accumulation error still depends on depth complexity.
This is approximate weighted color blending, not exact per-pixel depth sorting; near-opaque
intersections and dissimilar layer colors retain that algorithmic limitation. Nonfinite or
out-of-domain source radiance is deliberately shown as a magenta diagnostic instead of letting NaN
propagate into exposure/tone mapping. Valid in-budget radiance does not take that path.

Revealage uses the mathematically equivalent optical-depth sum `sum(-log(1 - alpha))`. For alpha
below 0.01, a fourth-order `-log1p(-alpha)` polynomial avoids float32 cancellation; this lets
hundreds of individually faint layers accumulate instead of repeatedly rounding `(1 - alpha)` to
one. Composition evaluates `1 - exp(-depth)`, with a small-depth polynomial and a cap at 24.
Alpha-one fragments write 24, producing exactly opaque float32 coverage; positive optical-depth
overflow also means fully opaque, while NaN/negative depth is diagnosed. R16 still has its
normal/subnormal quantization floor; it does not represent arbitrarily small per-fragment opacity.
Alpha-zero layers leave both destination radiance and alpha unchanged.

The same single-sample opaque depth attachment is read-only in both geometry passes. The weight is
independent of standard, reversed, or logarithmic depth encoding. Existing shader depth writes and
coverage remain identical across accumulation and revealage. Managed fullscreen texture coordinates
cross the render-target normalization boundary once. Native clustered light lists cover the full
view-depth range whenever native transparent PBR exists, so opaque tile depth does not discard
lights illuminating otherwise empty transparent pixels.

## Temporal ordering, budgets and lifetime

Opaque TAA/TAAU resolves before weighted composition. Post-resolve draws use an unjittered
output-resolution raster camera and a matching opaque depth replay, so transparent silhouettes and
occlusion do not follow the eight opaque jitter phases. A cached internal camera snapshot preserves
the original culling/shadow identity and leaves the opaque camera and motion history untouched.
Clustered GPU Scene reuses its compact visible/indirect depth list; it does not rebuild GPU-managed
objects through a CPU renderer list. Ordinary Forward receivers use the shared depth-only role.

Weighted, sorted, transmission and GPU transparent contributions stay outside opaque TAA history.
Their post-resolve coverage no longer overwrites opaque motion or reactive inputs. Fixed-grid
composition uses current transparent pixels directly, without resurrecting removed layers from a
separate color/mask/depth history. Existing opaque temporal and GPU simulation commit/discard rules
remain submission-aware.

The matching depth target is output resolution and single-sample. Ordinary single-camera renders use
a transient target. Explicit surface camera composition retains pipeline-owned matching depth
according to each camera's depth/stencil load-clear policy, including a preceding camera that has no
transparent draws, so later `clearDepth: false` views preserve earlier-layer occlusion. This
resource follows renderer-owned resize, release and recovery. Existing render-target TAA depth
restrictions remain unchanged. Clustered also records a bounded frame-buffer copy that substitutes
the stable view-projection matrix. This work is conditional on TAA/TAAU and visible post-resolve
mesh or GPU contributions. GPU opaque particle replay may require a temporary color scratch
attachment while rebuilding the matching depth.

`weightedBlendedTransparency: { maxPixelCount, maxFragmentCount }` bounds each invocation. The pixel
limit defaults to 3840 × 2160; four transient attachments require 26 bytes per pixel, excluding
shared color/depth and existing pool retention. The primitive limit is an integer in [1, 1048576]
and defaults to 1048576. Exceeding either budget fails before attachment allocation/submission.
Creation requires three MRTs and at least 24 aggregate color-attachment bytes per sample, in
addition to floating-point blending/sampling capabilities. Replacement devices must preserve these
limits. No weighted graph textures, numeric uniform buffers or passes are allocated when disabled or
when the visible queue is empty.

The normalization is one 16-byte `WeightedTransparencyBlock` with `u_weightedTransparency` at byte
offset zero, shared binding point 12 and WebGPU global-group binding 4. Per-invocation parameter
pool slots keep its CPU bytes immutable until submission/discard; changing N never creates a shader
variant. Automatically assigned custom uniform blocks now begin at shared binding point 13. Native
Clustered material variants retain their existing bounded variant budget and fail explicitly on
exhaustion.

Every weighted attachment, read, blend, resize and output is owned by the Render Graph/RHI path. The
controller owns no persistent image history or mutable submission cursor. Failed graph recording
cannot publish a weighted result, and retry reconstructs fresh cleared attachments. Device recovery
rebuilds through the normal resource generation; explicit `releaseGPUResources()` follows the
renderer-wide contract and destroys public render targets, which the application recreates.

## Validation

`test/spec/renderer/WeightedBlendedTransparency.test.ts` exercises actual WebGL 2 and WebGPU pixels
for order independence, HDR/alpha, opaque occlusion, standard/reversed depth, sorted overlays,
zero-alpha identity, failed-frame retry, resize, released-resource rebuilding, empty queues and
configuration limits. Its WebGPU Clustered test also checks direct PBR lighting and transparent
temporal composition. Capability tests distinguish renderability from blendability. The native
shader tests necessarily run the portable WebGL compile/link and real Naga/WebGPU pipeline paths.

Additional fixtures cover instanced quads with asymmetric top-left UVs and real WebGL context-loss
recovery. `SceneStorageGraphTextures.test.ts` checks directional graph sampling, binding rejection,
resize and actual WebGPU device recovery. A complete combination fixture renders DDGI, GTAO,
atmosphere/cloud shadows, fog, direct PBR decals and weighted transparency together, retaining
strict GI asset validation for all meshes except the explicitly excluded particle.

`WeightedBlendedPrecision.test.ts` covers 70 overlapping HDR layers, legal FP16 endpoint radiance,
dark/low-alpha mixtures, 256 very faint layers, planner/direct instancing and numeric-budget failure
before submission. `WeightedTransparencyNumerics.test.ts` locks the 16-byte ABI, dyadic headroom,
topology counts and attachment-capability rejection. The sampled-scene fixture also proves a failed
prepare does not advance sampler retirement; successful retry commits the same sampler use.
