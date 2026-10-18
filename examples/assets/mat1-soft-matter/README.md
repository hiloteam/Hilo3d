# Soft Matter — authored exhibit geometry

Original geometry created for Hilo3D's MAT1 material showcase in Blender 5.1.2. No downloaded
models, textures, or third-party geometry are included. These assets use the repository's MIT
license. The composition follows the generated art-direction reference used for this example; the
real-time example supplies its own lighting, textures, and MAT1 material definitions.

- `soft-matter.blend` is the editable source, with **26 named exhibit meshes** and a separate
  **Preview Studio — not exported** collection. The cloth is a baked, gravity-relaxed mesh, so
  loading the source does not depend on an external simulation cache.
- `soft-matter.glb` contains **six static runtime meshes**, one primitive per material: `velvet`,
  `wax`, `petal`, `leaf`, `brass`, and `stone`. It contains no cameras, lights, animations,
  textures, or external dependencies. Grouping objects by material reduces repeated draw submissions
  while retaining all **97,740 triangles**, world positions, normals, and UVs exactly.

## Coordinates and materials

The GLB uses glTF's Y-up coordinates, meters, and a front view from positive Z. The complete bounds
are approximately `[-4.494, 0.035, -1.456]` to `[4.057, 5.031, 2.386]`. Blender's source uses Z-up;
the exporter performs the standard coordinate conversion.

| Material name | Editable source mesh names                                                                                                                                   | Intended runtime treatment                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `velvet`      | `Velvet_Continuous_Drape`                                                                                                                                    | Burgundy cloth with grazing-angle sheen; continuous 8 mm shell.                  |
| `wax`         | `Wax_SixFlute_Sculpture`                                                                                                                                     | Closed asymmetric elliptical toroid with six deep helical flutes; profile SSS.   |
| `petal`       | `Petal_Outer_01`–`05`, `Petal_Middle_01`–`04`, `Petal_Inner_01`–`03`                                                                                         | Twelve broad, cupped single-surface petals; two-sided thin diffuse transmission. |
| `leaf`        | `Leaf_01`, `Leaf_02`                                                                                                                                         | Two bowed single-surface leaves; two-sided thin diffuse transmission.            |
| `brass`       | `Brass_Velvet_Stand`, `Brass_Bloom_Stem`, `Brass_Bloom_Heart_Filaments`, `Brass_Leaf_Veins`, `Brass_Plinth_Velvet`, `Brass_Plinth_Wax`, `Brass_Plinth_Bloom` | Metallic branch, veins, support, and fine pedestal inlays.                       |
| `stone`       | `Stone_Plinth_Velvet`, `Stone_Plinth_Wax`, `Stone_Plinth_Bloom`                                                                                              | Chamfered dark stone pedestals.                                                  |

Every mesh has `UVMap` coordinates. Petal and leaf UVs use **v=0 at the root, v=1 at the tip**, with
**u=0/1 at the left/right edges** and the midrib at u=0.5. This supports one shared procedural vein
texture without a separate texture per petal. The engine's normal managed-image UV normalization
still applies.

The six wax flutes range from 0.80 to 1.30 times the local cross-section radius, with rounded
shoulders and raised valleys. They make one complete helical turn around the ring, with a small
smooth phase variation. The gravity-relaxed cloth was widened 20% for the gallery composition and
its floor-contact wrinkles gently smoothed. The complete blossom is tilted 12° toward positive Z
around its stem attachment, leaving the branch connection fixed.

The plinth centers/heights/radii are `(-2.9, 0.75, 1.30)`, `(0, 0.95, 1.45)`, and
`(2.8, 0.70, 1.15)`, expressed as `(centerX, topY, radius)`. The wax sculpture occupies
approximately `[-1.226, 0.946, -0.547]` to `[1.249, 5.031, 0.693]`. Its bottom contact patch
slightly overlaps the central plinth to avoid a visible floating seam.

## Editing and export

Edit the 26 named exhibit meshes in the `.blend` source. Keep these separate for authoring. For a
runtime export, work on temporary copies and group only objects sharing the same material into six
meshes. Preserve world coordinates, existing split normals, UV seams, and triangle winding; do not
weld vertices, retriangulate, simplify, or recalculate normals. Leave the preview collection
unselected. Export binary glTF with **Selected Objects** enabled, including normals and UVs and
omitting cameras, lights, and animation. Keep the six material names stable because the example
replaces the preview materials by name. The Blender preview shaders are authoring helpers and are
not the reference for the engine's MAT1 behavior.

The runtime asset was grouped by concatenating the original float32 attribute streams and adjusting
indices; the editable `.blend` remained byte-for-byte unchanged. Before/after checks matched the
exact per-material multiset of ordered triangle vertex records, each containing `POSITION`,
`NORMAL`, and `TEXCOORD_0`. This verifies unchanged positions, split normals, UVs, seams, winding,
triangle counts, and bounds without a numerical tolerance. The six material JSON definitions also
matched exactly. Runtime triangle counts are 33,536 velvet, 18,432 wax, 18,480 petal, 1,736 leaf,
22,484 brass, and 3,072 stone.

The export was also checked for finite positions/normals/UVs, unit normals, named-material coverage,
six runtime meshes, triangle budget, and absence of camera/light/image payloads. Runtime
WebGL2/WebGPU rendering and feature comparisons are validated by the example's own browser tests.
