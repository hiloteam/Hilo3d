# Meshlet geometry streaming fixture

This original procedural surface was authored for Hilo3D and is covered by the repository MIT
license. It contains no downloaded or third-party artwork. `source.ts` defines a deterministic 24 by
24 curved XY grid with 625 vertices, 1152 triangles, analytic normals, UV0 and front-facing
positive-Z winding. Its asymmetry makes missing geometry and unintended reflections visible.

`near-flat-cone.json` retains four exact Float32 vertices and two triangles from the original STRATA
boulder. Its nearly flat cone exposes a serialized axis-length error in the upstream bounds
estimate: adding a fixed cutoff epsilon alone was insufficient. The cooker recomputes the cutoff
from actual triangle planes and the rounded axis; the runtime validator remains strict.

`manifest.json` and the independent `page-N.bin` files are reviewed browser test inputs. Rebuild
them deliberately with `npm run geometry:fixture` after reviewing cooker changes. The generator uses
the pinned meshoptimizer 1.3.0 ESM/WASM simplifier and clusterizer; its MIT license remains in the
npm package. All generated LODs are real attribute-aware edge-collapse simplifications with locked
group boundaries. Each group has independently fetchable complete replacement pages.

To cook another single-material rigid primitive, write a JSON object containing numeric arrays
`positions` (XYZ), `normals` (unit-length XYZ, tolerance 0.001), `uv0` (UV), and `indices` (triangle
triples), then run:

```sh
npm run geometry:cook -- primitive.json output-version-directory
```

The output directory must not already exist. The cooker writes a version-1 `manifest.json` and
uncompressed `page-N.bin` files; hosting and stable asset identity/version are application-owned.
Material primitives must be cooked separately. The first implementation does not encode skins,
morphs, tangents, secondary UVs or arbitrary vertex attributes.
