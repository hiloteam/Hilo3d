# Afternoon Atelier

An original warm reading room initially authored for Hilo3D through Blender MCP,
with subsequent revisions reproduced by the same Blender 5.1.2 recipe in an
isolated background Blender process. The oak
furniture, linen sofa and cushions, reading chair, books, ceramics, olive tree,
window, curtains, rug, movable floor lamp and panelled door are all original
procedural geometry. No external model, image, texture, font, or paid asset is
included. Distributed under the repository's license.

- File: `afternoon-atelier.glb`, binary glTF 2.0, 897,808 bytes.
- Geometry: 27 indexed opaque meshes, 28,488 triangles, exported surface normals.
- Materials: 23 standard metallic/roughness materials; all use constant factors.
- No image textures, baked lighting, animations, cameras, or exported lights.
- No required glTF extensions. The linen shade and inset upper/lower diffusers use emissive color.
- Units: meters; glTF Y-up. The open front of the room faces +Z; rear wall is −Z.
- `DoorPivot` is at `[1.68, 0, -2.50]`; rotate around Y to open the rigid door.
- `LampPivot` is at `[-2.75, 0, 0.45]`; moving this root also moves its geometry,
  both authored emitter nodes, and the attached runtime lights.
- `ReadingEmitter` is a child of `LampPivot`, at local `[0.085, 1.57, -0.035]`.
  Its local **−Y** axis is the linen shade's downward opening.
- `WallWashEmitter` is another child of `LampPivot`, at local `[0, 2.082, 0]`.
  Its local **+Y** axis points vertically through the open drum's upper aperture.
  It sits 23 mm above the upper brass rim. Both emitters have identity rotation;
  their axes match the modeled apertures. Runtime lights are children of these
  nodes, so moving the lamp never independently moves or aims its light sources.
- `WallPigment` and `WallSecondaryPigment` are the mutable rear and window-side
  wall materials. Book spines retain their independent original colors.
- `WindowDaylight` is an authoring-preview sky card. The maintained browser
  example hides it so sun and indirect rays pass through the actual window.

The software ray scene uses 28,476 triangles after hiding the 12-triangle sky
card. The roof and front are an intentional architectural cutaway. The example
uses runtime light transport; the asset contains no illumination baked into
textures or vertex colors.

The floor lamp is one open linen drum with fine rolled brass bindings and inset
upper/lower diffusers. It has no side projector, protruding bracket or finial
above the uplight source. The lower diffuser has a central opening for the mast;
the downward emitter is offset from the solid stem. Its broad upward light can
illuminate the nearby painted wall while the lower aperture supplies reading light.

A tall, narrow front casement occupies approximately world Z = 1.1–2.25. The
full-height painted return extends from Z = −2.68 to 1.08, including the space
in front of the sofa's forward-facing upholstery. The curtain parks at the front
reveal. Fixed, near-neutral `OatLinen` factors `[0.82, 0.80, 0.75]` let that
upholstery and the rug show colored illumination without changing receiver
materials when the wall pigment changes. All reflections come from geometry and
actual light transport; the asset contains no wall-colored fill or painted bounce.

## Reproduce

Use Blender 5.1.2, open a Python console in Object Mode, and run:

```python
import os
os.environ["ATELIER_OUTPUT"] = "/absolute/repository/examples/models/Atelier/afternoon-atelier.glb"
os.environ["ATELIER_PREVIEW"] = "/tmp/hilo3d-atelier-authoring.png"
exec(compile(open("/absolute/repository/examples/models/Atelier/author_atelier.py").read(), "author_atelier.py", "exec"))
```

The [complete Blender recipe](./author_atelier.py) creates a new, uniquely named
scene. Existing objects, scenes, active selection and active object are retained;
it neither saves nor overwrites the user's `.blend` file. Geometry is grouped by
material within the static room, door and lamp roots to keep draw buckets small.
The recipe's private random generator only chooses deterministic book/floor
variations. It does not replace application or browser randomness.

The checked-in revision was exported without rendering, using an independent
factory-startup Blender process on macOS:

```sh
ATELIER_RENDER_PREVIEW=0 \
ATELIER_OUTPUT=/absolute/repository/examples/models/Atelier/afternoon-atelier.glb \
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
  --python /absolute/repository/examples/models/Atelier/author_atelier.py
```

This command does not open or modify the user's existing Blender session or save
a `.blend` file. The recipe also supports the console/MCP workflow above.

Set `ATELIER_RENDER_PREVIEW=0` to skip the Cycles art preview. The preview is an
authoring check, not evidence of browser rendering, GPU performance, or production
lighting quality. Browser screenshots and interaction checks must use the real
`dynamic_global_illumination_atelier.html?backend=webgpu&test=1` example.
