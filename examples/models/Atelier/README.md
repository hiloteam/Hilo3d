# Afternoon Atelier

An original warm reading room authored for Hilo3D through Blender MCP. The oak
furniture, linen sofa and cushions, reading chair, books, ceramics, olive tree,
window, curtains, rug, movable floor lamp and panelled door are all original
procedural geometry. No external model, image, texture, font, or paid asset is
included. Distributed under the repository's license.

- File: `afternoon-atelier.glb`, binary glTF 2.0, 875,668 bytes.
- Geometry: 27 indexed opaque meshes, 27,324 triangles, exported surface normals.
- Materials: 23 standard metallic/roughness materials; all use constant factors.
- No image textures, baked lighting, animations, cameras, or exported lights.
- No required glTF extensions. The warm diffuser, linen lampshade and wall-washer lens use emissive color.
- Units: meters; glTF Y-up. The open front of the room faces +Z; rear wall is −Z.
- `DoorPivot` is at `[1.68, 0, -2.50]`; rotate around Y to open the rigid door.
- `LampPivot` is at `[-2.75, 0, 0.45]`; moving this root also moves its geometry,
  both authored emitter nodes, and the attached runtime lights.
- `ReadingEmitter` is a child of `LampPivot`, at local `[0.085, 1.57, -0.035]`.
  Its local **−Y** axis is the linen shade's downward opening.
- `WallWashEmitter` is another child of `LampPivot`. Its local **+Y** axis points
  through the separate brass head's lens and open rim. Its emitter is 3 cm in
  front of that rim. Both head geometry and emitter transform come from the same
  authored center/target, including the exported quaternion. Runtime spotlights
  are attached to these nodes; moving the lamp does not independently move or aim lights.
- `WallPigment` and `WallSecondaryPigment` are the mutable rear and window-side
  wall materials. Book spines retain their independent original colors.
- `WindowDaylight` is an authoring-preview sky card. The maintained browser
  example hides it so sun and indirect rays pass through the actual window.

The software ray scene uses 27,312 triangles after hiding the 12-triangle sky
card. The roof and front are an intentional architectural cutaway. The example
uses runtime light transport; the asset contains no illumination baked into
textures or vertex colors.

The two-bay window leaves a full-height painted return beside the sofa. The brass
head illuminates this wall while pale upward-facing seat cushions receive its
diffuse reflection. The curtain parks at the front reveal instead of intercepting
the wall-wash beam. This is geometry and actual light transport, not a receiver
color adjustment or a wall-colored fill light.

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

Set `ATELIER_RENDER_PREVIEW=0` to skip the Cycles art preview. The preview is an
authoring check, not evidence of browser rendering, GPU performance, or production
lighting quality. Browser screenshots and interaction checks must use the real
`dynamic_global_illumination_atelier.html?backend=webgpu&test=1` example.
