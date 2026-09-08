# Orbital Bloom

An original sculpture authored for the Hilo3D Lumen Forward+ example using Blender MCP.
Three gently twisting closed ribbons form a warm metal centerpiece designed to reveal
the movement, overlap, and color of many local lights. No third-party model or texture
is used; the asset is distributed under the repository's license.

- Asset: `orbital-bloom.glb`, glTF 2.0 binary, 325,308 bytes.
- Geometry: 3 indexed meshes, 11,520 vertices, 23,040 triangles, smooth exported normals.
- Materials: 3 opaque metallic/roughness materials; metallic 0.76–0.83, roughness 0.29–0.32.
- No textures, cameras, lights, animation, transmission, clearcoat, or required extensions.
- Coordinates: meters, glTF Y-up, lowest point at Y = 0, total height 4.8.
- Bounds: minimum `[-1.4921, 0, -1.5983]`, maximum `[2.1077, 4.8, 1.8750]`.
- Approximate center: `[0.3078, 2.4, 0.1383]`; the plinth is supplied by the example.

The [complete authoring recipe](./AUTHORING.md) reproduces the geometry and materials in
Blender 5.1.2. The export was rendered in Blender for visual review and its binary glTF
structure, indices, normals, triangle count, and opaque material contract were checked.
