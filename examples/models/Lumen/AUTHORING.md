# Orbital Bloom authoring recipe

This is the complete original Blender Python recipe used to author the sculpture.
It uses Blender's procedural mesh API; no source model, texture, external library, or
download is required. Blender 5.1.2 was used for the checked-in export.

Run the code in Blender's Python console or through Blender MCP in Object Mode.
Set `OUTPUT` to the desired absolute repository path when Blender's working directory
is not the repository root. Running the recipe creates a new, uniquely named scene
and collection. It preserves the previous active scene, active object, and selection,
does not change existing geometry, and does not save or overwrite any `.blend` file.

The three closed tapered ribbons use 192 longitudinal samples, a 20-sample rounded
rectangle profile, and smooth normals. Their profile slowly twists to provide broad
surfaces and rounded edges that respond clearly to moving local lights. The lowest
point is anchored at zero, and Blender's exporter converts Z-up authoring coordinates
to glTF's Y-up convention.

```python
import bpy
import math
from mathutils import Vector, Matrix
from pathlib import Path

OUTPUT = Path.cwd() / "examples/models/Lumen/orbital-bloom.glb"
PREFIX = "Lumen_Orbital_Bloom"
SEGMENTS = 192
PROFILE = 20

previous_scene = bpy.context.window.scene
previous_active = bpy.context.view_layer.objects.active
previous_selected = list(bpy.context.selected_objects)
if bpy.context.mode != "OBJECT":
    raise RuntimeError("Run the authoring recipe from Object Mode.")

scene = bpy.data.scenes.new(PREFIX)
collection = bpy.data.collections.new(PREFIX + "_Sculpture")
scene.collection.children.link(collection)
scene.unit_settings.system = "METRIC"
scene.unit_settings.scale_length = 1.0
bpy.context.window.scene = scene

def point(t, index):
    radius = [1.50, 1.43, 1.37][index]
    height = [2.05, 1.91, 1.98][index]
    wobble = [0.15, -0.13, 0.10][index]
    return Vector((
        radius * math.sin(t) + 0.16 * math.sin(2 * t),
        0.24 * math.sin(2 * t) + wobble * math.cos(t),
        height * math.cos(t),
    ))

objects = []
try:
    palette = [
        ("Champagne", (0.80, 0.65, 0.39, 1), 0.80, 0.29),
        ("Pale_Gold", (0.83, 0.75, 0.56, 1), 0.76, 0.32),
        ("Warm_Platinum", (0.79, 0.76, 0.65, 1), 0.83, 0.30),
    ]
    for index, (label, color, metallic, roughness) in enumerate(palette):
        material = bpy.data.materials.new(PREFIX + "_" + label)
        material.use_nodes = True
        material.use_backface_culling = True
        material.diffuse_color = color
        material.metallic = metallic
        material.roughness = roughness
        shader = material.node_tree.nodes.get("Principled BSDF")
        shader.inputs["Base Color"].default_value = color
        shader.inputs["Metallic"].default_value = metallic
        shader.inputs["Roughness"].default_value = roughness

        yaw = (index * math.tau / 3.0) + 0.18
        tilt = [0.19, -0.21, 0.12][index]
        rotation = Matrix.Rotation(yaw, 3, "Z") @ Matrix.Rotation(tilt, 3, "Y")
        offset = Vector((
            0.22 * math.cos(yaw),
            0.22 * math.sin(yaw),
            2.27 + [0.0, 0.03, 0.13][index],
        ))
        vertices = []
        for segment in range(SEGMENTS):
            t = segment * math.tau / SEGMENTS
            center = point(t, index)
            tangent = (point(t + 0.0001, index) - point(t - 0.0001, index)).normalized()
            in_plane = Vector((math.sin(t), 0.0, math.cos(t)))
            outward = (in_plane - tangent * in_plane.dot(tangent)).normalized()
            binormal = tangent.cross(outward).normalized()
            twist = 0.62 * math.sin(t + 0.45 * index) + 0.32 * math.sin(2 * t)
            width_axis = outward * math.cos(twist) + binormal * math.sin(twist)
            depth_axis = tangent.cross(width_axis).normalized()
            width = 0.25 + 0.07 * math.cos(t - 0.60)
            thickness = 0.054
            for side in range(PROFILE):
                a = side * math.tau / PROFILE
                c, s = math.cos(a), math.sin(a)
                u = math.copysign(abs(c) ** 0.52, c) * width
                v = math.copysign(abs(s) ** 0.52, s) * thickness
                p = rotation @ (center + u * width_axis + v * depth_axis) + offset
                vertices.append(tuple(p))
        faces = []
        for segment in range(SEGMENTS):
            following = (segment + 1) % SEGMENTS
            for side in range(PROFILE):
                next_side = (side + 1) % PROFILE
                faces.append((
                    segment * PROFILE + side,
                    segment * PROFILE + next_side,
                    following * PROFILE + next_side,
                    following * PROFILE + side,
                ))
        mesh = bpy.data.meshes.new(PREFIX + "_" + label + "_Mesh")
        mesh.from_pydata(vertices, [], faces)
        mesh.update()
        for polygon in mesh.polygons:
            polygon.use_smooth = True
        obj = bpy.data.objects.new(PREFIX + "_" + label, mesh)
        collection.objects.link(obj)
        obj.data.materials.append(material)
        obj["author"] = "Original procedural sculpture authored for Hilo3D Lumen."
        objects.append(obj)

    # One uniform scale preserves the ribbon profile. Anchor the lowest point at y=0 in glTF.
    all_points = [v.co.copy() for obj in objects for v in obj.data.vertices]
    lowest = min(v.z for v in all_points)
    highest = max(v.z for v in all_points)
    scale = 4.8 / (highest - lowest)
    for obj in objects:
        for vertex in obj.data.vertices:
            vertex.co.x *= scale
            vertex.co.y *= scale
            vertex.co.z = (vertex.co.z - lowest) * scale
        obj.data.update()
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.context.view_layer.update()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(OUTPUT),
        export_format="GLB",
        use_selection=True,
        use_active_scene=True,
        export_yup=True,
        export_normals=True,
        export_texcoords=False,
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_extras=False,
        export_apply=True,
    )
    coords = [v.co for obj in objects for v in obj.data.vertices]
    minimum = [min(v[i] for v in coords) for i in range(3)]
    maximum = [max(v[i] for v in coords) for i in range(3)]
    result = {
        "asset": str(OUTPUT),
        "bytes": OUTPUT.stat().st_size,
        "triangles": SEGMENTS * PROFILE * 2 * len(objects),
        "vertices": sum(len(o.data.vertices) for o in objects),
        "scene": scene.name,
        "blender_bounds": {"min": minimum, "max": maximum},
        "gltf_bounds": {
            "min": [minimum[0], minimum[2], -maximum[1]],
            "max": [maximum[0], maximum[2], -minimum[1]],
        },
    }
finally:
    bpy.context.window.scene = previous_scene
    for obj in bpy.context.selected_objects:
        obj.select_set(False)
    for obj in previous_selected:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = previous_active
```
