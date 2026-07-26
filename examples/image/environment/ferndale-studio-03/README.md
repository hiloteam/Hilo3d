# Ferndale Studio 03 environment

The default example environment is derived from
[Ferndale Studio 03](https://polyhaven.com/a/ferndale_studio_03) by Dimitrios Savva (photography)
and Greg Zaal (processing), published by Poly Haven under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).

Source assets:

- Poly Haven 2K Radiance HDR, used to bake the linear-light RGBD diffuse cube and the
  GGX-prefiltered RGBD specular mip chain.
- Poly Haven 8K tone-mapped JPEG, converted to the six 1024 px sRGB skybox faces.

All cubes use Hilo3D's canonical face order: right (+X), left (-X), top (+Y), bottom (-Y), front
(+Z), and back (-Z). The environment is rotated 180 degrees around Y so the clean infinity cove
frames the default camera view. The IBL was energy-normalized for the examples' shared HDR pipeline
while preserving the source's unclipped softbox highlights.
