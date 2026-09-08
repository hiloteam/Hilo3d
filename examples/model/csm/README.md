# Toy diorama landmarks

Original moulded-toy buildings authored in Blender for the miniature CSM diorama. A buttery cream
windmill cottage, peach station, and lavender lighthouse use satin plastic, glass, and brass
materials. Rounded roof ribs, recessed mint doors, porthole mouldings, a tiny station bell, and open
balcony rails provide details at different shadow-map distances.

- `toy-landmarks.blend`: editable Blender 5.1 source, 208 named mesh components in three building
  collections, one rotor pivot, and two glass groups. Rounded edges remain editable bevel modifiers.
- `toy-landmarks.glb`: fourteen meshes using ten materials, 42,852 triangles, approximately 1.35
  MiB; no textures, extensions, animation clips, cameras, or lights.
- Coordinates: metres, glTF Y up. The windmill is centred at X/Z `[-10, -28]`, the station at
  `[-12, 12]`, and the lighthouse at `[12, -42]`. Their bases already sit at Y `0.7`; add the
  complete imported scene without an additional height offset.
- Windmill platform: 9.6 × 8.1 metres; station platform: 9.7 × 7.8 metres; lighthouse platform:
  6.8-metre diameter. Platforms use rounded corners and are slightly larger than the buildings.
- Every exported primitive includes normals and UV0. The model uses standard glTF metallic/roughness
  factors; the lantern is opaque mint plastic and window glints are geometry.
- `ToyHouseWindows` contains only seven inset-glass panes: two cottage windows, two station windows,
  and three lighthouse portholes. Its independent `Toy • house window glass` material retains the
  original deep-teal daylight color. Doors, mouldings, mullions, and glints use static materials.
- `ToyLighthouseLantern` contains only the upper lantern glazing, between Y `13.2` and `14.8`, with
  an independent `Toy • lighthouse lantern glass` material retaining its mint daylight color. The
  white lantern mullions, lavender sill, and coral cap remain separate static geometry.
- Both glass groups export as identity-transform meshes with world-position vertices. Their
  materials have no baked emission; the example controls their warm illumination at runtime.
- `ToyWindmillRotor` is an articulated node with four material-grouped children containing the
  blades, spokes, sail mouldings, and centre hub. Its glTF pivot is `[-10.3, 10.36, -23.59]` and its
  rotation axis is local **Z**. The axle support and all buildings remain static. A quarter-turn
  check preserves the pivot exactly and the rotor bounds centre within 0.000001 metres.

To rebuild the export, open this source in a separate background Blender process and duplicate the
source scene into an isolated export scene. Apply bevel and weighted-normal modifiers, and join
copies by material separately for static geometry, rotor children, house windows, and lantern
glazing. Preserve the `ToyWindmillRotor` parent and its world-space pose. Preserve the glass group
names and bake their world transforms into the joined vertices. Smart UV Project all faces and apply
a 0.73-ratio Decimate modifier. Export the selected meshes and rotor node with **Active Scene**, Y
up, normals, UVs, and materials enabled; disable animations, cameras, and lights. Keep the editable
source components separate. Glass material isolation does not require another geometry reduction:
partition the existing export's indexed triangles and compact each group's attribute streams to
preserve the approved surface geometry, normals, UVs, and rotor transforms exactly.

## Lighting and comparison

The [example runtime](../../cascaded_shadows.ts) starts the train, windmill, water, and sea motion.
Shadow controls preserve the current playback state. Pause motion explicitly with the animation
button when comparing a fixed pose. The close-up sun deck uses actual fine picket geometry: one
1024² map and four 512² cascades both receive 1,048,576 directional-shadow texels. The ordinary view
uses one 2048² map or four 1024² cascades. Both modes share the same view-depth range and configured
bias within each budget. Atlas padding, local-light allocations, and draw costs can differ; this is
a visual study, with no performance-benchmark claim.

Dusk lowers directional light and material environment intensity, enables the independently glowing
windows/lantern, and turns on three streetlights, a locomotive headlight, and a rotating lighthouse
spotlight. Each spotlight uses a 512² shared-atlas shadow. The local-shadow control leaves lights on
so their real cast shadows can be inspected separately from the directional CSM comparison.

The [river](../../scenes/csm-toy-water.ts) and [sea/sky](../../scenes/csm-toy-surroundings.ts) use
portable GLSL ES 3.00, registered std140 blocks, and the engine's shared shadow-atlas helpers. Their
stylized waves, foam, clouds, and sunset are analytic; no separate raster WGSL or native backend
rendering path is used.

## Weather and gradual lighting

Switching to dusk fades in house windows first, then the station, bridge, harbor, headlight, and
lighthouse at staggered intervals. The transition uses wall-clock time and completes even when scene
motion is paused. Streetlight cones point vertically down from their globes; their shadow cameras
explicitly match each light's cone and range. Grass and paths use rough, uncoated plastic.

The weather control selects clear, rain, snow, or storm without changing playback state. Static quad
buffers and portable GLSL animate the falling particles; storm lightning has occasional short
flashes and can also be triggered manually. Automatic lightning is suppressed by the system's
reduced-motion preference.

Snow accumulates over approximately 25 seconds of active playback and melts over approximately 20
seconds after snowfall stops. A merged mesh follows the actual upward-facing terrain, roof, bridge,
and tree geometry, with softened snow-cap edges and ordinary PBR shadow reception. Moving train
parts, the windmill rotor, glass, and water are excluded. The snow amount control provides an
immediate preview; pausing freezes both precipitation and accumulation.
