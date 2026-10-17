# Cloth, thin surfaces and subsurface diffusion

Availability: **Unreleased source**. These additions are separate from the prepared alpha.9 package;
see [version boundaries](./VERSIONS.md). They extend the existing PBR Definition/Instance and shared
GLSL surface evaluator. They do not introduce another material system or rendering backend.

## Cloth sheen

`PBRMaterial.sheenColor` is linear RGB in [0, 1]. Supplying a color, even black, or a sheen texture
enables the immutable sheen topology. Direct construction retains the supplied `Color` reference;
change its components and call `invalidateData()` on every material sharing it. Loader/builder
defaults are copied for each material. `sheenRoughness` is a mutable scalar in [0, 1]. A material
without the topology cannot activate it through a later scalar mutation.

`sheenColorMap` defaults to sRGB RGB; `sheenRoughnessMap` uses linear alpha. Both retain the normal
per-slot UV set, transform, encoding and channel contract. The effective shader roughness has a 0.05
floor to bound the smooth grazing lobe.

The shared BRDF uses the Charlie distribution with fitted visibility and reciprocal energy
normalization. A checked directional-albedo table limits the sheen contribution and attenuates the
underlying surface. Direct lights, rectangular area lights and environment lighting evaluate the
same layer. The environment integration samples the source radiance, rather than treating an
existing GGX convolution as a sheen convolution. SSR replaces only its matching underlying GGX
response and fallback; the sheen environment contribution remains in scene color.

The exact 32×32 table is encoded as a lazy 4 KiB RGBA8 texture, with RG storing a 16-bit value over
[0, 8]. Quantization error is at most 0.0000611. The source retains its CPU recovery recipe; GPU
copies belong to each renderer's existing texture cache. Only a sheen-enabled shader binds the
additional sampler. Environment integration uses 32 radiance samples and area sheen uses 16.
Punctual base attenuation is symmetric in light/view direction. The existing area-light GGX LTC
integral and IBL base attenuation retain a view-dependent approximation.

The implementation and integration data reference the
[Khronos sheen specification](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_sheen/README.md).
`scripts/generate-sheen-albedo.ts` reproduces the checked integration data. Numerical furnace and
reciprocity checks accompany the shader, independently of the visual fixture.

## Thin diffuse transmission

`diffuseTransmissionFactor` selects the fraction of dielectric diffuse scattering sent to the
opposite hemisphere. It stays in [0, 1], and its texture uses linear alpha.
`diffuseTransmissionColor` is independent linear RGB in [0, 1]; its texture defaults to sRGB RGB.
The reflected diffuse term loses the matching fraction, while the back hemisphere receives a Lambert
diffuse transmission term. Metallic surfaces do not acquire dielectric transmission.

This models a thin sheet, such as a backlit leaf or fabric. It does not require an opaque scene
snapshot, change coverage, enable alpha blending, or move an otherwise opaque material into the
transparent queue. Directional, point and spot lights retain their shared shadow visibility; area
lights retain the existing unshadowed LTC lighting boundary. Environment/ambient back lighting uses
the opposite normal. Front-facing GTAO does not incorrectly occlude the back hemisphere.

The loader recognizes `KHR_materials_sheen` and the current
[`KHR_materials_diffuse_transmission` specification](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_diffuse_transmission/README.md).
The latter is a **Release Candidate**, not a claim of a ratified glTF extension. Both use the
existing texture-transform builder, including required-extension handling and input validation.
Unlit and specular/glossiness combinations are rejected. Thin diffuse transmission with nonzero
volume thickness or a volume thickness map is unsupported and fails explicitly; the engine does not
silently ignore volumetric absorption.

## Profile-based subsurface scattering

Create a `SubsurfaceScatteringProfile` and supply it as `PBRMaterial.subsurfaceProfile`. Its
immutable RGB `radius` values are Gaussian standard deviations in the same world units as geometry
and camera positions. Defaults are `[0.001, 0.00035, 0.0002]`, suitable for millimetre-scale
scattering in a metre-based scene. Equal radius triples define the same profile, independently of
allocation order. This is a bounded separable screen-space diffusion model, not volumetric ray
transport or an offline skin reference renderer.

`subsurfaceFactor` is a mutable strength in [0, 1]. `subsurfaceThickness` is an authored world-space
limit for diffusion radius and depth-neighbour rejection; it is not a measured exit-surface
thickness. Its default is three times the largest profile radius, capped at 10000 world units. Use
the values appropriate to the asset's physical scale.

Enable the pipeline explicitly using `new SubsurfaceScattering(options)` in Forward features,
`PostProcessRenderPipelineFactory({ subsurfaceScattering: options })`, or the corresponding
Clustered Forward+ option. An active profile material drawn without a participating pipeline fails
before submission. Custom SRPs declare `SceneRenderPassParameters.subsurfaceScattering` and own the
same extraction/diffusion/composition responsibility.

The renderer replays only visible participating opaque/masked PBR surfaces with the `subsurface`
semantic role. It retains the shared skin/morph, normal-map, coverage, lighting and depth contracts.
Three single-sample RGBA16F attachments contain diffuse lighting/strength, profile/thickness, and
normal/logarithmic view-depth/coverage. Two separable filters reject nonparticipating pixels,
different profiles, depth discontinuities and incompatible normals. Accepted weights are normalized
per color channel. Composition replaces the original diffuse contribution using
`scene + strength * (filteredDiffuse - originalDiffuse)`; specular, sheen and emission remain sharp.

Diffusion precedes opaque temporal accumulation and display processing. It has no private color
history and therefore cannot revive a removed surface. Forward rejects an ordering that places
diffusion after another after-opaque scene-color consumer. The turnkey post-process factory inserts
it before SSGI and TAA. Screen-space GI added afterward is a separate correction; it is not included
in the extracted lighting diffusion. Material fog is unsupported; later volumetric composition
remains a separate pipeline operation.

An enabled Forward diffusion feature always retains the after-opaque boundary. If `beforeRender`
activates a zero-strength profile or replaces an ordinary material with an SSS material, that same
frame receives diffusion. The record-time participation check still omits all SSS attachments and
passes when the submitted surfaces are inactive.

When DDGI, SSGI and SSS are combined, the DDGI hybrid baseline passes through the identical
diffusion kernel and material strength before SSGI subtracts it. This preserves exact baseline
replacement at nonuniform lighting edges, including probe-confidence-zero neighbours. Confidence
alpha is retained. MAT1 materials can receive the supported GI, but their new scattering models are
not ray-scene contributor BSDFs: explicitly set `contributeToGlobalIllumination = false` on those
meshes; strict DDGI otherwise rejects them.

SSS supports opaque and alpha-masked PBR. Unlit, specular/glossiness, transparent/refraction,
weighted blending and thin diffuse transmission combinations fail explicitly, as do incompatible
custom raster states and `renderer.forceMaterial` overrides involving an active SSS surface. The
first slice requires a full-output viewport; partial viewport/scissor diffusion fails before
allocating its attachments. Sheen can coexist because only the underlying diffuse contribution is
filtered. The fixed compact GPU Scene bucket format does not contain MAT1 parameters; compatible
meshes use the existing Clustered direct lane.

SSS receivers can consume static/dynamic reflection probes and main-camera SSR. Active SSS geometry
is not supported as dynamic probe capture content: auxiliary atlas views do not run diffusion, and
attempting to capture it fails before submission. Probe-bound receivers already follow the normal
nonrecursive capture exclusion. Otherwise use capture visibility layers, with an ordinary PBR proxy
on a capture-only layer when needed, as described in [local reflections](./LOCAL_REFLECTIONS.md). An
inactive profile (`subsurfaceFactor: 0`) can be captured as ordinary PBR.

## Cost, ownership and failure behaviour

Materials without sheen/thin-transmission topology compile those paths out of their variants. An
absent SSS feature has no diffusion controller or passes. An enabled SSS feature with no visible
active profile surfaces records no SSS attachments or passes. Setting a profile material's factor to
zero disables its participation without changing the material definition.

SSS quality is explicit: 9, 17 or 25 taps per axis, a projected kernel radius capped at 1–256 pixels
(default 64), a normal rejection cosine, and a hard `maxPixelCount` (default 1920 × 1080). Six
RGBA16F targets require 48 declared bytes per pixel. The DDGI/SSGI hybrid adds three RGBA16F targets
only when its baseline must also be diffused, for 72 bytes per pixel and a four-input composite.
These counts exclude shared scene color/depth, allocation padding and pool retention. The pixel
budget is checked before attachment allocation; a larger invocation fails rather than silently
changing quality. This is a format estimate, not a physical-device memory measurement.

All attachments, dependencies, uploads and command submission use the shared Render Graph/RHI.
Frame-local parameter storage remains immutable until submission/discard. A failed frame publishes
no diffusion result; resize and device/context recovery rebuild through normal resource recipes. No
native GPU/WebGL objects enter the public material or profile API.

The existing `MaterialBlock` fields retain their offsets, with MAT1 values appended to a 528-byte
block. Four texture slots are appended at indices 24–27; `MaterialTextureBlock` is 2240 bytes for 28
slots. `SubsurfaceScatteringBlock` uses stable shared binding 13 and WebGPU global-group binding 5.
Automatically assigned custom uniform bindings now begin at 14.

## Acceptance

- Material, loader and UBO tests cover topology, revisions, copied builder colors, malformed glTF
  data, extension mapping, channels and stable byte layouts.
- `MAT1Rendering.test.ts` uses actual WebGL2 and WebGPU pixels for back lighting, directional
  textures, sheen changes, environment lighting and resource rebuilding.
- `SheenEnergy.test.ts` checks numerical energy bounds and reciprocity;
  `SheenReciprocityRendering.test.ts` also checks the combined base/sheen response on both backends.
- `SubsurfaceScattering.test.ts` exercises diffusion, edge isolation, lighting preservation,
  composition, budgets, failed frames, resize and resource lifecycle.
- `SubsurfaceTargetValidation.test.ts` checks actual custom-SRP draws with invalid attachment
  formats, missing depth and multisampling, followed by valid retries on both backends.
- `test/ui/mat1-materials.spec.ts` presents cloth, a backlit thin surface and wax through Forward
  and Clustered, checks feature toggles, camera changes, resizing and errors after teardown.

The portable browser fixture uses 320×128 pixels and the native acceptance profile uses 500×200;
both retain the same shaders, effects, eight temporal phases, controls and pixel assertions.
Interactive controls schedule their own renders, and tests wait for that batch instead of submitting
a duplicate batch before each capture. Resize coverage additionally renders 480×240. Native WebGPU
Forward and Clustered cases also resize to 1920×1080, check rendered color coverage and continued
submission, and reject fallback adapters.

Executed checks and remaining hardware/release evidence belong in the [roadmap](./ROADMAP.md). The
existence of these tests is not a claim that a command ran or that an enrolled performance baseline
exists.
