# STRATA image generation ledger

These assets were generated with the built-in `image_gen` tool. The concept preceded Blender
authoring and runtime implementation. The sandstone image is a diffuse material input; geometry,
lighting, shadows and screenshots are produced by the engine. Original tool outputs remain in the
Codex generated-image directory; selected copies are retained in this repository.

## Sky-only environment

Saved as `examples/models/Strata/quarry-sky.png`. This contains only clouds and sky; the ring,
sculptures, quarry, steps and floor are rendered geometry.

```text
Use case: photorealistic-natural. Asset type: sky-only environment photograph for a 3D sculpture garden; 2:1 panoramic image. Match the sky color and wispy clouds of the reference image, removing all architecture, stone sculptures, typography, UI, terrain and objects. Fill the whole frame with an open late-afternoon sky. Warm luminous pale ivory/peach glow concentrated at the left edge; a subtle gradient to dusty soft blue on the upper right. A few thin elongated white cirrus streaks crossing the lower-right third, very restrained. The lower band grades to warm atmospheric ivory haze, with NO visible horizon or ground. Natural photographic sky, subtle and softly luminous, no dramatic storm clouds, no saturated blue, no bright visible sun disc, no vignette. No text. This will only be used as an environmental sky surrounding real rendered 3D objects, not as a scene render.
```

## Concept

Saved as `documentation/images/strata/concept.png`.

```text
Use case: stylized-concept / ui-mockup. Asset type: visual target for an original interactive real-time 3D engine demonstration of meshlet geometry and streamed levels of detail. Create one exquisite wide 16:9 desktop screenshot concept, no browser chrome. Design a coherent scene that can actually be modeled with static opaque geometry in Blender and rendered with direct PBR lighting, shadows and ambient occlusion. Title STRATA: a sunlit sandstone sculpture garden inside an open-air architectural quarry. Hero composition: at center-left a monumental broken circular sandstone arch, tilted very slightly, a thick asymmetrical ring with many fine sculpted sedimentary ridges following the ring, a dramatic clean oval opening framing a distant narrow corridor. The ring rises from an elegantly rounded layered stone podium with three low concentric steps. Around it are a few tall rectangular sandstone monoliths with closely carved horizontal strata, staggered in depth along a curved sunken promenade; low terraced quarry walls recede into the distance. Foreground contains two small rounded striated boulders and pale fine gravel patches, entirely solid geometry, not vegetation. Warm ivory ground, amber sandstone, subtle darker terracotta ridges, tiny restrained aged-bronze inset accents. Soft blue-gray contact shadows and a warm late-afternoon sun from upper left, airy cream sky, extremely legible silhouette and elegant negative space. Camera: perspective 45 degree lens, three-quarter elevated view, hero takes 50 percent of image width and 65 percent of height, visible floor steps; horizon in upper third, no lens effects, no water, no fog walls, no impossible detail. Art style: refined architectural maquette meets premium contemporary sculpture museum; convincing smoothly beveled geometry with dense relief detail, tasteful and serene, not low-poly or cartoon, not a ruin full of rubble. UI is sparse and editorial: upper-left large dark brown serif word STRATA, below it small sans-serif 'A study in distance & detail'; upper-right small 'HILO3D / WEBGPU'. At far right an airy ivory floating narrow panel with thin hairline separators, exact readable labels 'DETAIL' and 'Adaptive', 'STREAMING' and 'On', plus a small minimalist horizontal indicator; keep it unobtrusive. Bottom-left three slim camera navigation labels '01 Overview', '02 Passage', '03 Surface'; bottom-right small 'Drag to orbit · Scroll to explore'. All text restrained and visually aligned. Main 3D scene dominates, no huge dashboard cards, no fake charts, no people, no logos other than specified words, no external brand elements, no watermark. Deliver a polished implementable visual target, not a collage or wireframe.
```

## Sandstone albedo

First study: originally saved as `sandstone-albedo.png`; superseded during visual matching and
archived under ignored `reports/strata-obsolete/matching-revisions/textures/`. It was used through a
managed UV0 material texture with explicit sRGB encoding.

```text
Use case: photorealistic-natural. Asset type: seamless square diffuse albedo texture for a real-time sandstone sculpture, not a photograph of an object. Create a perfectly flat orthographic close scan of warm pale cream and honey sandstone with fine natural horizontal sedimentary laminations. The stone has subtle irregular rust ochre veins and tiny mineral grains; predominantly light ivory beige, not dark brown, no saturated yellow. Layers vary organically in thickness and fade in and out, with mild broad undulation, no perfectly periodic sine-wave stripes, no wood grain, no fabric weave, no diagonal hatching. Texture must tile seamlessly at all four edges. Even neutral diffuse illumination, no directional light, no shadows, no ambient occlusion, no perspective, no specular highlight, no cracks opening into deep black crevices. Fine realistic rock grain and restrained low contrast, large enough flat quiet regions between very thin lamination lines. Fill the entire 1:1 image with the material. No border, no text, no watermark.
```

## Sandstone strata study (replaced during matching)

Built-in imagegen; the intermediate `sandstone-strata.png` was superseded by the paler weathered
version. It is archived under ignored `reports/strata-obsolete/matching-revisions/textures/`.

```text
Use case: photorealistic-natural. Asset type: seamless square 2048x2048 PBR base-color texture for actual 3D sandstone geometry. Primary request: create a flat orthographic material scan of deeply stratified weathered golden sandstone, with the same distinctive rusty orange, reddish ochre, honey and pale ivory horizontal sediment layers as the huge stone ring in the reference concept. The reference image is only a material/color reference; do not reproduce its composition, ring, scenery or UI. Fill the entire square with stone surface at consistent scale, no perspective, no object silhouette. About 35 irregular horizontal sediment bands of varied thickness, interleaved fine ivory laminae, dark terracotta thin iron-oxide lines, tiny irregular pores, subtle fractures and mineral grains. Natural unpolished desert sandstone, never marble, wood, smooth plaster, or polished stone. Flat neutral diffuse illumination, no cast shadows, no specular highlights, no ambient occlusion, no gradient lighting. High frequency detailed albedo, midtone warm orange with realistic contrast, horizontally and vertically tileable. No text, no labels, no frame.
```

## Quarried limestone floor

Built-in imagegen; saved as `examples/models/Strata/limestone-quarry.png`.

```text
Use case: photorealistic-natural. Asset type: square tileable PBR limestone base-color map for a real 3D sculpture garden floor and carved steps. Fill entire image with warm pale ivory-beige quarry limestone surface, orthographic macro material scan. Irregular mineral clouds, fine sand grain, subtle tiny pores, pale ochre veins and occasional very fine shallow natural cracks. About 3 meters of continuous stone. Sandy matte quarried stone, understated and realistically detailed, NOT marble, NOT travertine holes, NOT ceramic tiles. Light warm ivory and bone color with only muted honey-beige variation. Flat neutral illumination, no shadows or baked lighting, no specular highlight, no objects, no borders, no perspective, no text. Seamless both directions. 2048x2048.
```

## Final weathered sandstone color

Built-in imagegen; saved as `examples/models/Strata/sandstone-weathered.png`.

```text
Use case: precise-object-edit. Asset type: seamless PBR sandstone albedo map. Image 1 is the existing flat stone texture to revise; image 2 is the fixed sculpture garden concept reference. Change only the material appearance in Image 1: make the texture substantially paler, less saturated and less contrasty to match the actual sandstone in Image 2. About 70% of the surface should be light honey-beige/ivory sandstone; rusty reddish sediment bands should be thin occasional accents, not dominant dark red stripes. Reduce orange/red saturation by about half; remove the almost black seams and replace them with subtle muted taupe. Keep the irregular horizontal sedimentary layers, pores, granular material detail and seamless flat material framing. Neutral shadow-free base color, no lighting, no objects or scenery, no text. Preserve a square tileable texture. Avoid the look of a layer cake, bacon, lasagna or wood.
```
