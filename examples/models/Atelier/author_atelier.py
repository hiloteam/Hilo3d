"""Original Blender asset recipe; run from Object Mode with ATELIER_OUTPUT set.

This is Blender authoring source, not Node/runtime tooling. It creates a separate
scene and restores the previous scene, active object, and selection. It neither
deletes existing user objects nor saves/overwrites a .blend file.
"""

import bpy
import math
import os
import random
import json
import struct
from pathlib import Path
from mathutils import Vector

OUTPUT = Path(os.environ.get("ATELIER_OUTPUT", str(Path.cwd() / "examples/models/Atelier/afternoon-atelier.glb")))
PREVIEW = Path(os.environ.get("ATELIER_PREVIEW", "/tmp/hilo3d-atelier-authoring.png"))
PREVIOUS_SCENE = bpy.context.window.scene
PREVIOUS_ACTIVE = bpy.context.view_layer.objects.active
PREVIOUS_SELECTED = list(bpy.context.selected_objects)
if bpy.context.mode != "OBJECT":
    raise RuntimeError("The atelier recipe requires Object Mode.")

scene = bpy.data.scenes.new("Hilo3D_Afternoon_Atelier")
bpy.context.window.scene = scene
scene.unit_settings.system = "METRIC"
scene.unit_settings.scale_length = 1.0
collection = bpy.data.collections.new("Atelier_Original_Geometry")
scene.collection.children.link(collection)
rng = random.Random(1807)
created = []
materials = {}


def material(name, color, roughness=0.72, metallic=0.0, emission=0.0):
    mat = bpy.data.materials.new(name)
    mat["atelier_name"] = name
    mat.use_nodes = True
    mat.diffuse_color = (*color, 1)
    mat.use_backface_culling = True
    mat.roughness = roughness
    mat.metallic = metallic
    shader = mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    if emission:
        shader.inputs["Emission Color"].default_value = (*color, 1)
        shader.inputs["Emission Strength"].default_value = emission
    materials[name] = mat
    return mat


def finish(obj, name, mat, group="Static"):
    obj.name = name
    for own in list(obj.users_collection):
        own.objects.unlink(obj)
    collection.objects.link(obj)
    obj.data.materials.append(mat)
    obj["atelier_group"] = group
    created.append(obj)
    return obj


def box(name, loc, size, mat, bevel=0.015, segments=2, group="Static", rotation=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    obj = bpy.context.object
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        modifier = obj.modifiers.new("Soft crafted edges", "BEVEL")
        modifier.width = bevel
        modifier.segments = segments
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        normal = obj.modifiers.new("Weighted surface normals", "WEIGHTED_NORMAL")
        bpy.ops.object.modifier_apply(modifier=normal.name)
    if rotation:
        obj.rotation_euler = rotation
    return finish(obj, name, mat, group)


def cylinder(name, loc, radius, depth, mat, top=None, vertices=24, group="Static"):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius,
                                  radius2=radius if top is None else top,
                                  depth=depth, location=loc)
    obj = bpy.context.object
    for polygon in obj.data.polygons:
        polygon.use_smooth = len(polygon.vertices) == 4
    return finish(obj, name, mat, group)


def lathe(name, loc, profile, mat, segments=24, group="Static"):
    vertices = []
    faces = []
    for radius, height in profile:
        for segment in range(segments):
            angle = segment * math.tau / segments
            vertices.append((radius * math.cos(angle), radius * math.sin(angle), height))
    for row in range(len(profile) - 1):
        for segment in range(segments):
            following = (segment + 1) % segments
            a, b = row * segments + segment, row * segments + following
            faces.append((a, b, b + segments, a + segments))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    obj.location = loc
    return finish(obj, name, mat, group)


def ellipsoid(name, loc, scale, mat, group="Static", rotation=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=6, radius=1, location=loc)
    obj = bpy.context.object
    obj.scale = scale
    if rotation:
        obj.rotation_euler = rotation
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return finish(obj, name, mat, group)


def rod(name, start, end, radius, mat, group="Static"):
    vector = Vector(end) - Vector(start)
    obj = cylinder(name, (Vector(start) + Vector(end)) / 2, radius, vector.length,
                   mat, vertices=8, group=group)
    obj.rotation_euler = vector.to_track_quat("Z", "Y").to_euler()
    return obj


def book(loc, width, height, color, yaw=0):
    x, y, z = loc
    obj = box("Clothbound volume", (x, y, z + height / 2), (width, 0.22, height), color, 0.006, 1)
    obj.rotation_euler.y = yaw
    for level in (0.075, height - 0.06):
        box("Gold spine rule", (x, y - 0.113, z + level), (width * 0.8, 0.004, 0.008), brass, 0)


try:
    plaster = material("ChalkPlaster", (0.74, 0.69, 0.57), 0.93)
    wall = material("WallPigment", (0.38, 0.48, 0.32), 0.9)
    wall_secondary = material("WallSecondaryPigment", (0.74, 0.69, 0.57), 0.93)
    oak = material("HoneyOak", (0.39, 0.205, 0.085), 0.54)
    dark_oak = material("OakEndGrain", (0.24, 0.105, 0.034), 0.6)
    linen = material("OatLinen", (0.81, 0.735, 0.61), 0.95)
    cream = material("CreamWool", (0.66, 0.56, 0.405), 0.98)
    terracotta = material("Terracotta", (0.57, 0.195, 0.092), 0.85)
    sage = material("SageVelvet", (0.22, 0.31, 0.18), 0.92)
    brass = material("BrushedBrass", (0.63, 0.40, 0.16), 0.33, 0.72)
    ceramic = material("IvoryGlaze", (0.82, 0.79, 0.67), 0.24)
    black = material("Espresso", (0.044, 0.032, 0.022), 0.68)
    leaves = material("OliveLeaves", (0.12, 0.205, 0.065), 0.87)
    glow = material("WarmDiffuser", (1.0, 0.65, 0.30), 0.88, emission=1.8)
    lamp_linen = material("LinenLampshade", (0.82, 0.66, 0.42), 0.91, emission=0.32)
    wall_lens = material("WallWashLens", (1.0, 0.92, 0.75), 0.32, emission=0.8)
    canvas = material("ArtworkPaper", (0.86, 0.78, 0.59), 0.97)
    sky = material("WindowDaylight", (0.7, 0.78, 0.80), 0.98, emission=0.25)
    floor_palette = [material("OakBoard%02d" % i, (0.37 + i * 0.015, 0.20 + i * 0.010, 0.088 + i * 0.006), 0.65) for i in range(5)]
    book_palette = [terracotta, sage, cream, plaster, dark_oak]

    # Architectural cutaway: front and ceiling stay open for an unobstructed view.
    box("Foundation", (0, 0, -0.15), (7.0, 5.5, 0.28), dark_oak, 0.025)
    for row in range(11):
        for column in range(5):
            x = -2.8 + column * 1.4
            y = -2.46 + row * 0.49
            box("Individual oak floorboard", (x, y, 0.008), (1.392, 0.484, 0.032),
                floor_palette[rng.randrange(5)], 0.005, 1)
    box("Back color wall", (-0.80, 2.65, 1.6), (5.2, 0.16, 3.2), wall)
    box("Door side pier", (3.18, 2.65, 1.6), (0.52, 0.16, 3.2), wall_secondary)
    box("Door lintel", (2.3, 2.65, 2.9), (1.30, 0.16, 0.6), wall_secondary)
    box("Window wall bottom", (-3.46, 0, 0.40), (0.16, 5.4, 0.80), wall_secondary)
    box("Window wall top", (-3.46, 0, 2.97), (0.16, 5.4, 0.46), wall_secondary)
    box("Window front pier", (-3.46, -2.42, 1.74), (0.16, 0.70, 2.04), wall_secondary)
    # A broad full-height return beside the sofa receives the practical's wall
    # wash and reflects actual painted-wall radiance onto the pale upholstery.
    box("Reading alcove painted wall", (-3.46, 1.59, 1.74), (0.16, 2.18, 2.04), wall_secondary)
    box("Deep oak window sill", (-3.35, -0.825, 0.85), (0.38, 2.64, 0.11), oak)
    box("Window frame top", (-3.37, -0.825, 2.74), (0.13, 2.64, 0.12), oak)
    for y in (-2.08, -0.83, 0.43):
        box("Window mullion", (-3.37, y, 1.79), (0.12, 0.07, 1.95), oak, 0.007)
    box("Window crossbar", (-3.37, -0.825, 1.8), (0.12, 2.57, 0.045), oak, 0.006)
    # Sky is outside the room and visibly behind the empty glazed opening.
    box("Distant window sky", (-3.62, -0.825, 1.81), (0.02, 2.60, 1.80), sky, 0)
    # The curtain parks at the front reveal, leaving the painted reading alcove
    # clear for the real wall washer rather than reflecting from white linen.
    for y in (-2.2,):
        for pleat in range(5):
            cylinder("Linen curtain fold", (-3.12 + (pleat % 2) * 0.025, y + pleat * 0.07, 1.80),
                     0.062, 1.78, linen, vertices=10)
    box("Back oak skirting", (-0.82, 2.52, 0.12), (5.2, 0.08, 0.19), oak, 0.007)
    box("Left oak skirting", (-3.35, 0, 0.12), (0.07, 5.3, 0.19), oak, 0.007)
    box("Back picture rail", (-0.82, 2.51, 2.99), (5.2, 0.05, 0.04), oak, 0.004)

    # Built-in shelving, readable books, ceramics, and low panelled cupboards.
    for x in (-0.2, 0.98):
        box("Bookcase back panel", (x, 2.42, 1.46), (1.12, 0.08, 2.62), dark_oak, 0.005)
        for side in (-0.56, 0.56):
            box("Bookcase upright", (x + side, 2.25, 1.46), (0.065, 0.4, 2.72), oak, 0.006)
        for z in (0.15, 0.72, 1.25, 1.84, 2.38, 2.81):
            box("Bookcase shelf", (x, 2.22, z), (1.16, 0.45, 0.062), oak, 0.006)
        for side in (-0.28, 0.28):
            box("Cupboard door", (x + side, 1.98, 0.45), (0.515, 0.04, 0.49), oak, 0.009)
            cylinder("Cupboard pull", (x + side + (0.18 if side < 0 else -0.18), 1.945, 0.49),
                     0.023, 0.027, brass, vertices=10).rotation_euler.x = math.pi / 2
        for row, z in enumerate((0.76, 1.29, 1.88, 2.42)):
            count = 5 if row != 2 else 3
            for i in range(count):
                book((x - 0.40 + i * 0.125, 2.18, z), 0.075 + (i % 3) * 0.018,
                     0.25 + rng.random() * 0.13, book_palette[(i + row) % 5])
    lathe("Shelf ceramic vessel", (0.15, 2.17, 1.88), [(0,0),(.09,0),(.115,.06),(.12,.18),(.07,.26),(.055,.28),(.048,.28),(.052,.24)], ceramic)
    ellipsoid("Shelf river stone", (1.31, 2.15, 2.53), (.16, .11, .07), cream)
    lathe("Stoneware bowl", (1.22, 2.15, 1.30), [(0,0),(.07,0),(.18,.10),(.18,.13),(.165,.13),(.06,.04)], terracotta)

    # Quiet framed original abstract artwork above the sofa.
    box("Painting frame", (-1.95, 2.48, 2.06), (1.17, 0.07, 1.14), oak, 0.025)
    box("Painting mount", (-1.95, 2.431, 2.06), (1.04, 0.012, 1.01), canvas, 0)
    disc = cylinder("Painting sun", (-2.13, 2.418, 2.27), 0.23, 0.008, terracotta, vertices=32)
    disc.rotation_euler.x = math.pi / 2
    box("Painting horizon", (-1.87, 2.416, 1.9), (0.73, 0.009, 0.12), sage, 0)
    box("Painting stripe", (-1.65, 2.411, 2.05), (0.12, 0.01, 0.50), cream, 0)

    # Deep, generous two-seat linen sofa with timber base and seam piping.
    for x in (-2.75, -0.75):
        for y in (0.57, 1.55):
            cylinder("Sofa turned leg", (x, y, .15), .055, .26, dark_oak, vertices=12)
    box("Sofa oak platform", (-1.75, 1.1, .32), (2.53, 1.19, .15), oak, .055, 3)
    box("Sofa upholstered base", (-1.75, 1.08, .47), (2.56, 1.20, .22), linen, .10, 4)
    for x in (-2.97, -.53):
        box("Soft rolled sofa arm", (x, 1.08, .78), (.22, 1.20, .69), linen, .105, 5)
    box("Sofa back", (-1.75, 1.62, 1.00), (2.40, .27, .87), linen, .105, 5)
    for x in (-2.34, -1.17):
        box("Seat cushion", (x, 1.04, .65), (1.13, .95, .22), linen, .085, 4)
        box("Seat seam", (x, .561, .65), (1.01, .007, .014), cream, .003, 1)
        box("Back cushion", (x, 1.40, 1.01), (1.08, .28, .66), linen, .12, 5,
            rotation=(math.radians(-8), 0, 0))
    for x, y, z, mat, tilt in ((-2.64,.95,1.03,terracotta,-12), (-.84,1.00,1.04,sage,15), (-2.15,1.11,1.01,cream,9)):
        box("Loose linen cushion", (x,y,z), (.48,.22,.46), mat, .105, 5,
            rotation=(math.radians(-15),math.radians(tilt),math.radians(tilt)))

    # Woven rug and low oval coffee table; no image textures or baked illumination.
    box("Bound wool rug", (-.65, -.56, .043), (4.0, 2.52, .035), cream, .16, 4)
    box("Rug centre weave", (-.65,-.56,.064), (3.86,2.38,.013), linen, .12, 3)
    for edge in (-1.64, .52):
        box("Rug woven stripe", (-.65,edge,.073), (3.70,.024,.005), terracotta, 0)
        box("Rug fine stripe", (-.65,edge+.045,.073), (3.70,.010,.005), oak, 0)
    for x in (-1.20,.05):
        for y in (-.63,-.03):
            cylinder("Coffee table tapered leg", (x,y,.24), .046, .38, dark_oak, top=.065, vertices=12)
    box("Oval coffee table", (-.58,-.34,.47), (1.96,1.00,.115), oak,.32,6)
    box("Art book cover", (-.9,-.31,.552), (.56,.40,.036), sage,.009,1,rotation=(0,0,.15))
    box("Art book pages", (-.9,-.31,.580), (.53,.375,.027), canvas,.003,1,rotation=(0,0,.15))
    box("Art book top", (-.9,-.31,.598), (.56,.40,.012), sage,.004,1,rotation=(0,0,.15))
    cylinder("Tea cup saucer", (-.12,-.5,.55), .13,.015, ceramic,vertices=24)
    lathe("Tea cup", (-.12,-.5,.56), [(0,0),(.065,0),(.083,.12),(.078,.13),(.068,.13),(.057,.02)], ceramic)
    cylinder("Tea surface", (-.12,-.5,.67), .068,.002, dark_oak,vertices=20)
    lathe("Small bud vase", (.07,-.1,.54), [(0,0),(.07,0),(.095,.11),(.06,.19),(.027,.23),(.025,.23)], terracotta)
    for i in range(3):
        rod("Dried stem", (.07,-.1,.73), (.07+(i-1)*.065,-.1+(i%2)*.06,1.00+i*.04), .005, oak)
        ellipsoid("Dried flower", (.07+(i-1)*.065,-.1+(i%2)*.06,1.00+i*.04), (.035,.025,.06), cream)

    # Sculptural reading chair at right: continuous bent timber and warm upholstery.
    for x in (1.38,2.38):
        for y in (-.72,.25):
            rod("Reading chair splayed leg", (x,y,.05), (x+(.08 if x<2 else -.08),y,.6), .039, oak)
        rod("Reading chair arm", (x,-.74,.88), (x,.30,.97), .048, oak)
        rod("Reading chair arm post", (x,-.65,.35), (x,-.65,.89), .033, oak)
    box("Reading chair seat", (1.88,-.25,.57), (.96,.99,.22), terracotta,.10,4)
    box("Reading chair back", (1.88,.24,.98), (.96,.25,.83), terracotta,.10,4,
        rotation=(math.radians(-12),0,0))
    box("Reading chair cushion", (1.87,-.01,.94), (.48,.17,.44), cream,.10,4,
        rotation=(math.radians(-18),0,math.radians(-8)))

    # Movable floor lamp: child pieces share a stable hinge-independent root.
    lamp_location = (-2.75, -.45, 0)
    cylinder("Lamp foot", (-2.75,-.45,.07), .25,.095, brass, group="Lamp")
    cylinder("Lamp upright", (-2.75,-.45,.91), .025,1.72, brass,vertices=16,group="Lamp")
    lathe("Pleated linen shade", (-2.75,-.45,1.63), [(0.39,0),(.40,.02),(.235,.50),(.22,.52),(.213,.49),(.375,.018)], lamp_linen,segments=32,group="Lamp")
    cylinder("Lamp warm diffuser", (-2.75,-.45,1.645), .35,.016, glow,vertices=32,group="Lamp")
    cylinder("Shade finial", (-2.75,-.45,2.16), .03,.06, brass,vertices=12,group="Lamp")

    # A separate, visible adjustable brass head supplies the upward wall wash.
    # Its open tube and lens face local +Z in Blender (+Y after glTF export).
    # The runtime light is attached to the exported emitter directly in front
    # of that lens, so geometry and the SpotLight cannot point independently.
    wall_head_center = Vector((-2.40, -0.34, 1.25))
    wall_head_target = Vector((-3.38, 2.0, 2.15))
    wall_head_direction = (wall_head_target - wall_head_center).normalized()
    wall_head_rotation = wall_head_direction.to_track_quat("Z", "Y").to_euler()
    head = lathe("Adjustable brass wall washer", wall_head_center,
                 [(0,-.12),(.074,-.12),(.085,-.10),(.095,.10),(.095,.12),
                  (.081,.12),(.071,-.075),(0,-.075)], brass,segments=24,group="Lamp")
    head.rotation_euler = wall_head_rotation
    lens = cylinder("Wall washer luminous lens", wall_head_center + wall_head_direction * .092,
                    .078,.012,wall_lens,vertices=24,group="Lamp")
    lens.rotation_euler = wall_head_rotation
    bracket_end = wall_head_center - wall_head_direction * .10
    rod("Wall washer bracket",(-2.75,-.45,1.16),(-2.48,-.45,1.16),.018,brass,group="Lamp")
    rod("Wall washer tilt mount",(-2.48,-.45,1.16),bracket_end,.018,brass,group="Lamp")
    ellipsoid("Wall washer hinge",bracket_end,(.037,.037,.037),brass,group="Lamp")
    wall_emitter_position = wall_head_center + wall_head_direction * .15

    # The opening looks into a small warm vestibule; the door is a real rigid occluder.
    door_location = (1.68, 2.50, 0)
    for x in (1.64,2.98):
        box("Oak door jamb", (x,2.51,1.25), (.10,.25,2.5), oak,.012)
    box("Oak door header", (2.30,2.51,2.52), (1.45,.25,.12), oak,.012)
    box("Door leaf", (2.30,2.50,1.23), (1.21,.065,2.40), oak,.017,2,group="Door")
    for z in (.64,1.77):
        box("Door recessed panel", (2.30,2.46,z), (1.01,.027,.89), dark_oak,.018,2,group="Door")
        box("Door floating panel", (2.30,2.44,z), (.94,.018,.82), oak,.012,2,group="Door")
    rod("Door brass handle", (2.64,2.37,1.08),(2.81,2.37,1.08),.025,brass,group="Door")
    box("Vestibule floor", (2.30,3.15,0), (1.52,1.15,.10), oak,.01)
    box("Vestibule rear wall", (2.30,3.72,1.30), (1.5,.12,2.6), terracotta,.01)
    box("Vestibule side wall", (3.07,3.17,1.30), (.10,1.15,2.6), plaster,.01)

    # A small olive tree balances the chair. Broad geometric leaves read at normal view size.
    lathe("Olive ceramic planter", (2.87,1.42,0), [(0,0),(.22,0),(.29,.05),(.35,.47),(.35,.51),(.31,.51),(.29,.42)], ceramic,segments=24)
    cylinder("Planter soil", (2.87,1.42,.46), .31,.025, black,vertices=24)
    rod("Olive trunk", (2.87,1.42,.44), (2.87,1.42,1.89), .038,dark_oak)
    for branch in range(9):
        angle = branch * 2.4
        z = .92 + branch * .115
        tip = (2.87 + math.cos(angle)*.37, 1.42 + math.sin(angle)*.31, z+.32)
        rod("Olive branch", (2.87,1.42,z),tip,.011,dark_oak)
        for leaf in range(5):
            t=(leaf+1)/5
            p=(2.87+(tip[0]-2.87)*t,1.42+(tip[1]-1.42)*t,z+.32*t)
            ellipsoid("Olive leaf",p,(.045,.12,.015),leaves,rotation=(.3,.4,angle+leaf*.7))

    # Join by material within each rigid group. This preserves moveable roots and
    # material identity while reducing draw buckets and keeping ray geometry compact.
    groups = {}
    for obj in created:
        key = (obj["atelier_group"], obj.data.materials[0]["atelier_name"])
        groups.setdefault(key, []).append(obj)
    exported = []
    export_names = {}
    roots = {}
    for name, loc in (("Door",door_location),("Lamp",lamp_location)):
        pivot = bpy.data.objects.new(name+"Pivot",None)
        collection.objects.link(pivot)
        pivot.location = loc
        roots[name] = pivot
        export_names[pivot.name] = name+"Pivot"
    emitters = []
    for name, position, rotation in (
        ("ReadingEmitter",Vector((-2.665,-.415,1.57)),None),
        ("WallWashEmitter",wall_emitter_position,wall_head_rotation),
    ):
        emitter = bpy.data.objects.new(name,None)
        collection.objects.link(emitter)
        emitter.parent = roots["Lamp"]
        emitter.location = position - roots["Lamp"].location
        if rotation is not None:
            emitter.rotation_euler = rotation
        emitters.append(emitter)
        export_names[emitter.name] = name
    for (group, mat_name), objects in groups.items():
        bpy.ops.object.select_all(action="DESELECT")
        for obj in objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        if len(objects) > 1:
            bpy.ops.object.join()
        obj = bpy.context.object
        obj.name = "Atelier_"+group+"_"+mat_name
        export_names[obj.name] = "Atelier_"+group+"_"+mat_name
        bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
        if group in roots:
            obj.parent = roots[group]
            obj.location = -roots[group].location
        exported.append(obj)
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action="DESELECT")
    for obj in exported + list(roots.values()) + emitters:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = exported[0]
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(OUTPUT),export_format="GLB",use_selection=True,
                             use_active_scene=True,export_yup=True,export_normals=True,
                             export_texcoords=False,export_materials="EXPORT",
                             export_cameras=False,export_lights=False,export_animations=False,
                             export_extras=False,export_apply=True)

    # Blender datablock names are global across preserved scenes. Normalize only
    # this export's semantic glTF names so repeated, non-destructive authoring
    # keeps stable runtime lookup names (DoorPivot / LampPivot / WallPigment).
    binary = OUTPUT.read_bytes()
    json_size = struct.unpack_from("<I", binary, 12)[0]
    gltf = json.loads(binary[20:20+json_size])
    for node in gltf.get("nodes", []):
        if node.get("name") in export_names:
            node["name"] = export_names[node["name"]]
    material_names = {mat.name: name for name, mat in materials.items()}
    for mat in gltf.get("materials", []):
        if mat.get("name") in material_names:
            mat["name"] = material_names[mat["name"]]
    json_bytes = json.dumps(gltf, separators=(",", ":")).encode("utf8")
    json_bytes += b" " * ((-len(json_bytes)) % 4)
    remaining_chunks = binary[20+json_size:]
    OUTPUT.write_bytes(struct.pack("<III", 0x46546c67, 2, 20+len(json_bytes)+len(remaining_chunks))
                       + struct.pack("<II",len(json_bytes),0x4e4f534a)
                       + json_bytes + remaining_chunks)

    # Independent Blender art preview. Browser screenshots remain runtime evidence.
    camera_data=bpy.data.cameras.new("Atelier_preview_camera")
    camera=bpy.data.objects.new("Atelier_preview_camera",camera_data)
    scene.collection.objects.link(camera)
    camera.location=(7.1,-9.7,6.6)
    camera.rotation_euler=(Vector((0,.3,1.10))-camera.location).to_track_quat("-Z","Y").to_euler()
    camera.data.type="ORTHO"
    camera.data.ortho_scale=10.6
    scene.camera=camera
    world=bpy.data.worlds.new("Atelier_preview_world")
    scene.world=world
    world.use_nodes=True
    world.node_tree.nodes["Background"].inputs["Color"].default_value=(.72,.77,.82,1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value=.35
    def area(name,loc,power,size,color,target):
        data=bpy.data.lights.new(name,"AREA")
        data.energy=power
        data.shape="DISK"
        data.size=size
        data.color=color
        obj=bpy.data.objects.new(name,data)
        scene.collection.objects.link(obj)
        obj.location=loc
        obj.rotation_euler=(Vector(target)-obj.location).to_track_quat("-Z","Y").to_euler()
    area("Afternoon window",(-4,-1,4.5),900,4,(1,.81,.57),(0,0,0))
    area("Soft open ceiling",(1,-2,6),550,5,(1,.89,.76),(0,.7,0))
    area("Reading lamp",(-2.75,-.45,1.60),40,.5,(1,.58,.22),(-2.75,-.45,0))
    scene.render.engine="CYCLES"
    scene.cycles.samples=32
    scene.cycles.use_denoising=True
    scene.render.resolution_x=1440
    scene.render.resolution_y=1080
    scene.render.resolution_percentage=100
    scene.render.image_settings.file_format="PNG"
    scene.render.filepath=str(PREVIEW)
    scene.view_settings.view_transform="AgX"
    scene.render.film_transparent=True
    bpy.context.view_layer.update()
    triangles=0
    for obj in exported:
        obj.data.calc_loop_triangles()
        triangles+=len(obj.data.loop_triangles)
    result={"asset":str(OUTPUT),"bytes":OUTPUT.stat().st_size,"triangles":triangles,
            "mesh_count":len(exported),"materials":len(materials),"scene":scene.name,
            "preview":str(PREVIEW)}
    if os.environ.get("ATELIER_RENDER_PREVIEW","1")=="1":
        bpy.ops.render.render(write_still=True)
finally:
    bpy.context.window.scene=PREVIOUS_SCENE
    for obj in bpy.context.selected_objects:
        obj.select_set(False)
    for obj in PREVIOUS_SELECTED:
        obj.select_set(True)
    bpy.context.view_layer.objects.active=PREVIOUS_ACTIVE
