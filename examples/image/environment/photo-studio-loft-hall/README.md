# Photo Studio Loft Hall environment

The shared example lighting and softly blurred room background are derived from
[Photo Studio Loft Hall](https://polyhaven.com/a/photo_studio_loft_hall) by Sergej Majboroda,
published by Poly Haven under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). The
source contains warm window light, tall windows, an indoor studio and a wooden floor.

The unclipped
[2K Radiance HDR source](https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/photo_studio_loft_hall_2k.hdr)
is 2048 × 1024 pixels. Its SHA-256 is
`2eadabfce70a1f27d958aa18b2572d75883f9964f4656c10e706a44cafe129d0`. The baker downloads it into
`.cache/example-environment/`; the source is not committed.

Regenerate all nine derived assets from the repository root after `npm ci`:

```sh
npm exec -- jiti scripts/bake-example-environment.ts
```

The script verifies the source digest, uses the engine's maintained Radiance parser and formats the
spherical-harmonic JSON using the repository's Prettier configuration. No random sampling is used.
These files are reviewed example assets; the source cache remains disposable.

## Lighting and background

The presentation is inspired by Sketchfab's separation of environment lighting and background blur.
This is a separately licensed Poly Haven environment and an independently implemented blur; it does
not reproduce a proprietary environment asset or claim an equivalent blur-slider value.

The diffuse cube, specular cube and spherical harmonics retain linear HDR light. The background
comes from the same room and orientation, but compresses display highlights and blurs room details
to keep the model readable. The visible window shapes remain aligned with reflections. Neither a
flat gray backdrop nor sharp photographic room clutter is included.

The source longitude is rotated by −90° around the panorama so the default camera's −Z view faces
the window wall. World longitude equals source longitude minus π/2; latitude increases toward +Y.
The brightest source texel points toward approximately `(0.797612, -0.126977, -0.589655)` in world
space. This is a bright room texel, not an authored directional-light vector.

All cubes use canonical face order: right (+X), left (−X), top (+Y), bottom (−Y), front (+Z), back
(−Z). Rows run from top to bottom. With face coordinates `(u, v)` spanning `[-1, 1]`, normalized
direction vectors are `(1, -v, -u)`, `(-1, -v, u)`, `(u, 1, v)`, `(u, -1, -v)`, `(u, -v, 1)` and
`(-u, -v, -1)` respectively.

## Bake recipe

- Normalize source radiance toward a solid-angle-weighted mean luminance of `0.45`, then apply one
  further global scale if the diffuse cube would exceed `0.95` in any channel. This preserves HDR
  ratios while fitting the shader's RGB-only diffuse storage. This source uses final scale
  `0.43383629592481254`, final spherical mean luminance `0.37431502050046794` and peak diffuse
  channel `0.95`. No individual radiance channel is clipped.
- Bake the 64 px diffuse cube using deterministic spherical quadrature over the source's
  solid-angle-weighted 128 × 64 mip. Each sample contributes
  `radiance × max(N·L, 0) × solidAngle / π`. Integrating every source cell keeps small, intense
  window highlights from becoming Monte Carlo noise. Store the result as sRGB RGB with alpha 255;
  the diffuse shader reads RGB only.
- Bake the 256 px specular cube with nine roughness levels. Perceptual roughness spans zero to one
  linearly across the mip chain. Level zero samples the source directly. Other levels use 1024
  deterministic Hammersley GGX half-vector samples, reflected light directions weighted by `N·L`,
  and PDF-based source mip selection. Source mip rows use spherical solid-angle weights.
- Encode specular RGBD according to `pbr.frag`: let `D` be
  `floor(255 / max(1, maxComponent(sRGB(linearRGB)))) / 255`; stored RGB is `sRGB(linearRGB) × D`,
  and stored alpha is `D`. The shader divides by D before decoding sRGB.
- Project the full normalized panorama into the engine's signed real spherical-harmonic basis. Apply
  cosine-convolution factors π, 2π/3 and π/4 to the three bands. The nine RGB irradiance
  coefficients in `spherical-harmonics.json` are consumed with
  `new SphericalHarmonics3().fromArray(coefficients).scaleForRender()`, whose basis normalization
  and division by π produce a diffuse response consistent with the cube.
- Bake six 128 px RGB PNG background faces. Give the display background an independent +3 EV
  exposure (`x = normalizedRadiance × 8`) and apply per-channel Reinhard display compression
  `x / (1 + x)` first, then perform spherical GGX convolution at perceptual roughness `0.3` with 256
  Hammersley samples per texel. Compressing display highlights before blur preserves window shapes
  without broad HDR bloom. Finally encode sRGB. This is a display-only filter; the IBL and spherical
  harmonics always use the unclipped HDR source.

Each `.rgbd` file starts with the eight ASCII bytes `H3DRGBD1`, then little-endian uint32 face size
and mip count. Payload order is mip-major, then the six canonical faces, with top-to-bottom RGBA8
texels. The diffuse file has one level; the specular file has a complete chain through 1 × 1.
