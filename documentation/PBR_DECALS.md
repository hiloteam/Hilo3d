# Projected PBR decals

Availability: **Unreleased source**; see [version boundaries](./VERSIONS.md).

`PBRMaterial.decals` binds a bounded set of world-space projectors to an opaque or alpha-masked
receiver. The material evaluates color, normal and roughness before lighting and uses the same
projection in its material-attributes pass, so GTAO and SSR observe the painted surface. Projection
does not modify silhouette, alpha coverage or shadow-caster geometry. Both backends use the same
GLSL source and normal material/resource ownership; no extra decal scene geometry is required.

```ts
const projector = new Hilo3d.DecalProjector({
    transform: projectorWorldMatrix,
    atlasRect: [0, 0, 0.5, 0.5],
    layer: 1,
    roughness: 0.8,
    affectsRoughness: true
});
const material = new Hilo3d.PBRMaterial({
    metallic: 0,
    decals: {
        projectors: [projector],
        baseColorAtlas: colorAtlas,
        normalAtlas,
        roughnessAtlas,
        receiverMask: 1
    }
});
projector.update({ transform: nextWorldMatrix, opacity: 0.5 });
```

## Projection and authored atlases

The world transform maps the local cube `[-0.5, 0.5]` into the receiver volume. Projection points
along local negative Z; surfaces facing positive Z receive it. Matrices, colors and atlas rectangles
are copied. `update()` validates all replacement fields before publishing one new revision, so an
invalid edit cannot leave partially changed projector data.

Atlas rectangles use top-left normalized coordinates. Color RGB defaults to sRGB decoding and alpha
is the shared coverage mask for all three surface properties. For already-linear or hardware-sRGB
textures choose `baseColorEncoding: 'linear'`. Normal and roughness atlases are linear; roughness
uses red. Atlas channels share the same normalized rectangles but may have different resolutions.
Atlases with mipmaps need authored padding at every mip level; base-level clamping does not create
missing mip gutters. Texture assets and their restoration recipes remain application-owned.

Membership is one to eight distinct projectors per material. Increasing `order` defines overlap;
ties retain the original membership order even after edits. `layer` intersects the material's
`receiverMask`, and zero intersection disables that projector. Projection volume, normal threshold
and fade, XY edge fade, maximum camera distance and distance fade all constrain coverage. Disabled
projectors preserve shader topology. New membership or atlas topology requires a new material.

Normal decals construct a tangent basis on the receiver from the projector's world X axis. This
keeps projected normals aligned with the receiver under rotation and nonuniform scale. Degenerate
grazing bases retain the current receiver normal. Colors are blended in linear space, and projection
does not change receiver alpha, so a decal cannot fill an alpha-masked hole.

## Rendering and temporal contract

The shared Forward and Clustered direct PBR paths consume the same material-owned `DecalBlock` and
atlas samplers. The fixed compact GPU Scene bucket material schema does not contain projector data;
registering a decal material as an indirect bucket fails explicitly. Ordinary decal receivers use
the existing shared direct path. Checked graph texture bindings let the direct path compose DDGI
with GTAO and atmosphere/cloud visibility without occupying a conflicting pass-global group.

Decals have no geometric velocity when their projector or atlas changes. Their receiver's motion
pass therefore rejects color history across the entire receiver, including a projector's previous
footprint. This conservative policy avoids trails on moved/removed decals and edited atlas pixels;
it trades temporal accumulation on those receivers for correctness. A later spatial history policy
must preserve rejection of the old footprint and submission rollback.

Replacing the material, including removing its complete decal membership, invalidates the mesh's
motion history through committed material identity. Failed replacement frames do not replace that
identity. This covers old paint even when the new material has no decal reactive flag.

The portable std140 block is 1280 bytes: eight world-to-local matrices and six eight-element vec4
arrays for atlas rectangles, color/coverage, projection normals, tangents, surface parameters and
distance controls. It uses shared binding point 11 and WebGPU material-group binding 65. Material
samplers use the existing reflected sampler allocation. No decal block, atlas sampler or projector
iteration exists in materials without decals.

CPU block bytes change only when projector revisions change. GPU uploads use the existing
submission-aware material cache; discarded frames retry uploads, and device recovery recreates
resources from CPU recipes without changing projector/material identity. Transparent, transmission
and unlit receivers fail explicitly; attached skinned decals and screen-space deferred projection
are outside this world-space opaque-surface contract.

## Validation

`test/spec/renderer/PBRDecals.test.ts` covers validation, atomic edits, std140 size and stable dirty
revisions; asymmetric atlas rows on both backends; layer, distance and projection movement; overlap
order; normal/roughness agreement in material attributes; and native Clustered direct rendering.
Executed checks and remaining evidence gates are tracked in the main [roadmap](./ROADMAP.md).
