"""Original STRATA sculpture garden. Run with Blender 5.1 via Blender MCP.

Creates a separate Scene and writes only its referenced data to strata.blend.
It never saves, deletes, or overwrites the user's currently open project.
Raw cooking inputs go to ignored reports/strata-source; runtime assets are cooked by TypeScript.
"""
import bpy
import bmesh
import json
import math
from pathlib import Path
from mathutils import Vector, noise
import numpy as np

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'examples/models/Strata'
RAW = ROOT / 'reports/strata-source'
OUT.mkdir(parents=True, exist_ok=True)
RAW.mkdir(parents=True, exist_ok=True)
scene = bpy.data.scenes.new('STRATA_SculptureGarden')
scene.unit_settings.system = 'METRIC'
collection = bpy.data.collections.new('STRATA / original authored geometry')
scene.collection.children.link(collection)
old_scene = bpy.context.window.scene if bpy.context.window else None
if bpy.context.window:
    bpy.context.window.scene = scene

stone_image = bpy.data.images.load(str(OUT/'sandstone-weathered.png'), check_existing=False)
stone_image.name = 'STRATA_sandstone-weathered'
stone_image.pack()
floor_image = bpy.data.images.load(str(OUT/'limestone-quarry.png'), check_existing=False)
floor_image.name = 'STRATA_limestone-quarry'
floor_image.pack()
sky_image=bpy.data.images.load(str(OUT/'quarry-sky.png'),check_existing=False)
sky_image.name='STRATA_quarry-sky'
sky_image.pack()
materials = {}
material_config = {}
def material(name, color, roughness, metal=0, image=None):
    mat = bpy.data.materials.new('STRATA_'+name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metal
    if image:
        tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
        tex.image = image
        mat.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    materials[name] = mat
    material_config[name] = {'color': list(color), 'roughness': roughness, 'metallic': metal,
                             'texture': image.name.removeprefix('STRATA_')+'.png' if image else None}
    return mat

material('sandstone', (.92, .93, .94), .88, image=stone_image)
material('limestone', (.95, .91, .82), .88, image=floor_image)
material('chalk', (.93, .91, .85), .92, image=floor_image)
material('bronze', (.42, .27, .105), .42, .65)
material('recess', (.19, .14, .085), .94)
material('sky', (1,1,1), 1, image=sky_image)

prototypes = {}
objects = []
def mesh(name, vertices, faces, material_name, streamed=False, smooth=True):
    data = bpy.data.meshes.new('STRATA_'+name)
    data.from_pydata(vertices, [], faces)
    data.update()
    for polygon in data.polygons:
        polygon.use_smooth = smooth
    uv = data.uv_layers.new(name='UV0')
    for loop in data.loops:
        p = data.vertices[loop.vertex_index].co
        uv.data[loop.index].uv = ((p.x*.16+p.y*.12, p.z*.17) if streamed else (p.x*.27+p.z*.16, p.y*.27+p.z*.23))
    data.materials.append(materials[material_name])
    prototypes[name] = {'mesh': data, 'material': material_name, 'streamed': streamed}
    return data

def instance(asset, name, position=(0, 0, 0), scale=(1, 1, 1), rotation=0):
    obj = bpy.data.objects.new('STRATA_'+name, prototypes[asset]['mesh'])
    collection.objects.link(obj)
    obj.location = position
    obj.scale = scale
    obj.rotation_euler.z = rotation
    objects.append({'asset': asset, 'name': name,
                    'position': [position[0], position[2], -position[1]],
                    'scale': [scale[0], scale[2], scale[1]],
                    'rotationY': math.degrees(rotation)})
    return obj

def sgnpow(value, power):
    return math.copysign(abs(value)**power, value)

def n3(x, y, z):
    return noise.noise(Vector((x, y, z)), noise_basis='PERLIN_ORIGINAL')

def erosion(x, y, z, strength=1):
    # Unequal strata, fractured edges and granular relief are real vertex displacement.
    strata = z + .035*n3(x*.8, y*.8, z*.35)
    layers = .022*math.sin(strata*19+.7*math.sin(strata*5)) + .009*math.sin(strata*43+1.3)
    fracture = .10*n3(x*2.8+7, y*2.8, z*2.8) + .028*n3(x*11, y*11, z*11)
    return (layers + fracture)*strength

def ring_data(sectors, detail, stone):
    vertices, faces = [], []
    # Flat annular front/back, deep cut sides and small chamfers. This is a cut slab,
    # not a circular torus. Three bronze repair joints follow the reference.
    corners = [(.49,-1.16),(.65,-1.00),(.65,1.00),(.49,1.16),
               (-.49,1.16),(-.65,1.00),(-.65,-1.00),(-.49,-1.16)]
    samples = [4,18,4,20,4,18,4,20] if stone else [1,2,1,3,1,2,1,3]
    profile=[]
    for k, count in enumerate(samples):
        a,b=corners[k],corners[(k+1)%len(corners)]
        for j in range(count):
            t=j/count; profile.append((a[0]*(1-t)+b[0]*t,a[1]*(1-t)+b[1]*t))
    sides=len(profile)
    for start, end in sectors:
        steps=max(2, round((end-start)/360*detail)); base=len(vertices)
        for i in range(steps+1):
            angle=math.radians(start+(end-start)*i/steps); c,s=math.cos(angle),math.sin(angle)
            for radial,depth in profile:
                major=2.70+.065*math.sin(angle*3+.4)+.045*math.sin(angle*7)
                radius=major+radial
                x=radius*c*1.10; z=radius*s*1.02
                if z < -2.35: z=-2.35+(z+2.35)*.32
                if stone:
                    e=erosion(x,depth,z)
                    edge=min(1,abs(radial)/.65)
                    chip=.075*n3(x*5+13,depth*5-8,z*5)
                    radial += e*(.5+.5*edge)+chip*edge
                    # Broad cut faces remain planar; major relief belongs to broken rims.
                    face_relief=.022*n3(x*1.1+3,depth,z*1.1)+.007*n3(x*5,depth*5,z*5)
                    depth += math.copysign(face_relief if abs(depth)>1.05 else e*.6+chip*.2,depth)
                    x=(major+radial)*c*1.10
                    z0=(major+radial)*s*1.02
                    z=z0 if z0>=-2.35 else -2.35+(z0+2.35)*.32
                x += .70*(.65-radial)/1.30
                z -= .22*(.65-radial)/1.30
                vertices.append((x,depth,z))
                if i<steps:
                    # The local profile index is independent of previous sectors.
                    j=(len(vertices)-base-1)%sides
                    a=base+i*sides+j; b=base+i*sides+(j+1)%sides
                    faces.append((a,b,b+sides,a+sides))
        for i,reverse in [(0,True),(steps,False)]:
            center=len(vertices); points=vertices[base+i*sides:base+(i+1)*sides]
            vertices.append(tuple(sum(p[k] for p in points)/sides for k in range(3)))
            for j in range(sides):
                a=base+i*sides+j;b=base+i*sides+(j+1)%sides
                faces.append((center,b,a) if reverse else (center,a,b))
    return vertices,faces

v,f=ring_data([(78,225),(231,433)],512,True)
mesh('arch',v,f,'sandstone',True)
v,f=ring_data([(73,78),(225,231)],256,False)
# A curved inner-face restoration plate follows the third fracture in the concept.
base=len(v); plate_steps=64
for i in range(plate_steps+1):
    a=math.radians(302+48*i/plate_steps)
    for r,d in [(2.24,-1.19),(2.41,-1.19),(2.41,-1.10),(2.24,-1.10)]:
        radial=r-2.70
        v.append((r*math.cos(a)*1.10+.70*(.65-radial)/1.3,d,r*math.sin(a)*1.02-.22*(.65-radial)/1.3))
    if i<plate_steps:
        for j in range(4):
            a0=base+i*4+j;b0=base+i*4+(j+1)%4
            f.append((a0,b0,b0+4,a0+4))
f.extend([(base+3,base+2,base+1,base),(len(v)-4,len(v)-3,len(v)-2,len(v)-1)])
mesh('inlay',v,f,'bronze',False)
instance('arch','Sedimentary aperture',(-1.55,0,3.68),(1.02,1.12,1.06),rotation=.7853981633974483)
instance('inlay','Bronze restoration seams',(-1.55,0,3.68),(1.02,1.12,1.06),rotation=.7853981633974483)

def monolith():
    vertices,faces=[],[]; perimeter,height=112,144
    for row in range(height+1):
        z=4.8*row/height
        for col in range(perimeter):
            # Even spacing along flat faces preserves detail at the square corners.
            edge=col//(perimeter//4); t=(col%(perimeter//4))/(perimeter//4)
            xy=[(-.82+1.64*t,-.75),(.82,-.75+1.5*t),(.82-1.64*t,.75),(-.82,.75-1.5*t)][edge]
            x,y=xy; corner=min(abs(x)/.82,abs(y)/.75)
            wear=.045+.10*max(0,n3(x*3+4,y*3,z*3))
            if corner>.88:
                x*=1-wear*(corner-.88)/.12; y*=1-wear*(corner-.88)/.12
            e=erosion(x,y,z,.32)
            x+=e*x/.82; y+=e*y/.75
            # A naturally recessed bed, like the break in the reference's right pillar.
            seam=.055*math.exp(-((z-2.15)/.11)**2)
            x*=1-seam;y*=1-seam
            vertices.append((x,y,z+.035*n3(x*3,y*3,z*2)))
            if row<height:
                a=row*perimeter+col;b=row*perimeter+(col+1)%perimeter
                faces.append((a,b,b+perimeter,a+perimeter))
    for row,reverse in [(0,True),(height,False)]:
        center=len(vertices);vertices.append((0,0,row/height*4.8))
        for col in range(perimeter):
            a=row*perimeter+col;b=row*perimeter+(col+1)%perimeter
            faces.append((center,b,a) if reverse else (center,a,b))
    return vertices,faces
v,f=monolith();mesh('monolith',v,f,'sandstone',True)
pillar_positions=[(-7.2,-.5,1.0),(7.3,-.2,1.12),(-8.1,10,.75),(5.3,9,.78),
                  (-7.4,17,.78),(6.2,17,.80),(-7.8,28,.85),(6.5,28,.88),
                  (-7.5,40,1.0),(6.5,40,1.0)]
for i,(x,y,s) in enumerate(pillar_positions):
    instance('monolith',f'Carved standing stone {i:02}',(x,y,.85 if i==1 else 2.1 if i==0 else .25),(s,s,.90 if i==1 else .77 if i==0 else s),.025*math.sin(i*7))

def boulder():
    vertices=[(0,0,1)];faces=[];around,rings=112,56
    for row in range(1,rings):
        theta=math.pi*row/rings
        for col in range(around):
            phi=math.tau*col/around
            x,y,z=math.sin(theta)*math.cos(phi),math.sin(theta)*math.sin(phi),math.cos(theta)
            r=1+.22*n3(x*2+11,y*2,z*2)+.09*n3(x*5,y*5,z*5)+erosion(x,y,z,.45)
            vertices.append((x*r*1.5,y*r*1.05,z*r))
    bottom=len(vertices);vertices.append((0,0,-1))
    for col in range(around):
        faces.append((0,1+col,1+(col+1)%around))
        for row in range(rings-2):
            a=1+row*around+col;b=1+row*around+(col+1)%around
            faces.append((a,a+around,b+around,b))
        a=1+(rings-2)*around+col;b=1+(rings-2)*around+(col+1)%around
        faces.append((bottom,b,a))
    return vertices,faces
v,f=boulder();mesh('boulder',v,f,'sandstone',True)
for i,(x,y,s,rz) in enumerate([(-3.9,-5.5,1.1,.25),(-1.1,-6.4,.65,-.4),(7.8,6,.8,1.2),(-10,14,1.4,.5),(9,26,1.15,-.9)]):
    instance('boulder',f'Weathered stone {i}',(x,y,s*.72-.02),(s,s,s*.72),rz)

def rounded_box():
    bm=bmesh.new();bmesh.ops.create_cube(bm,size=1)
    bmesh.ops.bevel(bm,geom=list(bm.edges),offset=.045,segments=3,affect='EDGES')
    data=bpy.data.meshes.new('STRATA_block');bm.to_mesh(data);bm.free();data.update()
    data.materials.append(materials['limestone'])
    uv=data.uv_layers.new(name='UV0')
    for loop in data.loops:
        p=data.vertices[loop.vertex_index].co;uv.data[loop.index].uv=(p.x+p.y,p.z+p.y)
    prototypes['block']={'mesh':data,'material':'limestone','streamed':False}
rounded_box()
trim_data=prototypes['block']['mesh'].copy();trim_data.name='STRATA_trim'
trim_data.materials.clear();trim_data.materials.append(materials['bronze'])
prototypes['trim']={'mesh':trim_data,'material':'bronze','streamed':False}
def cliff():
    bm=bmesh.new();bmesh.ops.create_cube(bm,size=1)
    bmesh.ops.subdivide_edges(bm,edges=list(bm.edges),cuts=20,use_grid_fill=True)
    for v in bm.verts:
        p=v.co.copy(); normal=p.normalized()
        edge=sorted([abs(p.x),abs(p.y),abs(p.z)])[1]
        rough=.003*n3(p.x*8+2,p.y*8,p.z*8)+.002*n3(p.x*23,p.y*23,p.z*23)
        chip=.025*n3(p.x*15,p.y*15,p.z*15)*max(0,(edge-.38)/.12)
        v.co+=normal*(rough+chip)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    data=bpy.data.meshes.new('STRATA_quarry');bm.to_mesh(data);bm.free();data.update()
    data.materials.append(materials['chalk']); uv=data.uv_layers.new(name='UV0')
    for polygon in data.polygons: polygon.use_smooth=True
    for loop in data.loops:
        p=data.vertices[loop.vertex_index].co
        uv.data[loop.index].uv=(p.x*2+p.y*2+.5,p.z*1.6+p.y*.2+.5)
    prototypes['quarry']={'mesh':data,'material':'chalk','streamed':False}
cliff()
bm=bmesh.new();bmesh.ops.create_icosphere(bm,subdivisions=1,radius=1)
pebble=bpy.data.meshes.new('STRATA_pebble');bm.to_mesh(pebble);bm.free();pebble.update()
pebble.materials.append(materials['limestone']);uv=pebble.uv_layers.new(name='UV0')
for loop in pebble.loops:
    p=pebble.vertices[loop.vertex_index].co;uv.data[loop.index].uv=(p.x*.5+.5,p.y*.5+.5)
prototypes['pebble']={'mesh':pebble,'material':'limestone','streamed':False}

def podium():
    vertices,faces=[],[];segments=160
    profile=[(0,.0),(6.1,.0),(6.1,.13),(6.04,.2),(5.6,.2),(5.6,.35),(5.54,.41),
             (5.1,.41),(5.1,.57),(5.04,.63),(4.6,.63),(4.6,.77),(4.54,.83),(0,.83)]
    # Exclude central rings; create caps explicitly to keep all triangles nondegenerate.
    profile=profile[1:-1]
    for r,z in profile:
        for i in range(segments):
            a=i/segments*math.tau;vertices.append((r*math.cos(a),r*math.sin(a),z))
    for row in range(len(profile)-1):
        for i in range(segments):
            a=row*segments+i;b=row*segments+(i+1)%segments
            faces.append((a,b,b+segments,a+segments))
    for row,reverse in [(0,True),(len(profile)-1,False)]:
        center=len(vertices);vertices.append((0,0,profile[row][1]))
        for i in range(segments):
            a=row*segments+i;b=row*segments+(i+1)%segments
            faces.append((center,b,a) if reverse else (center,a,b))
    return vertices,faces
v,f=podium();mesh('podium',v,f,'limestone',False,False)
# A shallow curved limestone terrace leaves an open gravel bed at the front left.
terrace_vertices=[];terrace_faces=[];terrace_segments=160
for z in [0,.16]:
    for i in range(terrace_segments):
        a=i/terrace_segments*math.tau
        notch=max(0,-math.cos(a))*max(0,-math.sin(a))
        r=7.6*(1-.65*notch)
        terrace_vertices.append((r*math.cos(a),r*math.sin(a)*.79,z))
for i in range(terrace_segments):
    j=(i+1)%terrace_segments
    terrace_faces.append((i,j,j+terrace_segments,i+terrace_segments))
for row,reverse in [(0,True),(1,False)]:
    center=len(terrace_vertices);terrace_vertices.append((0,0,row*.16))
    for i in range(terrace_segments):
        a=row*terrace_segments+i;b=row*terrace_segments+(i+1)%terrace_segments
        terrace_faces.append((center,b,a) if reverse else (center,a,b))
mesh('terrace',terrace_vertices,terrace_faces,'limestone',False,False)
instance('terrace','Curved quarry terrace',(0,0,0))
instance('podium','Concentric gallery steps',(-2,0,0),(1.02,.72,1))
ground_vertices=[];ground_faces=[]
for row in range(49):
    for col in range(33):
        x=-40+col*2.5;y=-35+row*2.5
        ground_vertices.append((x,y,-.014+.008*n3(x*.7,y*.7,7)))
        if row<48 and col<32:
            a=row*33+col;ground_faces.append((a,a+1,a+34,a+33))
mesh('floor',ground_vertices,ground_faces,'limestone',False)
instance('floor','Gallery floor')
for i,(x,y,s) in enumerate(pillar_positions):
    instance('block',f'Stone foot {i}',(x,y,.425 if i==1 else 1.85 if i==0 else .25),(2.1*s,2.0*s,.85 if i==1 else .5))
    instance('trim',f'Bronze inset {i}',(x-.49*s,y-.77*s,1.9*s),(.11,.08,3.3*s))
instance('block','Left quarry terrace',(-9,3,.8),(5,12,1.6))
for side in [-1,1]:
    for row in range(8):
        y=1+row*8
        for tier in range(3):
            x=side*(10.9+tier*1.55)+.35*math.sin(row*2.2)
            height=(2.6+tier*1.7+.5*math.sin(row*1.3+side))*(1-.22*min(1,row/4))+(1.8*math.exp(-row*.7) if side<0 else -.7)
            layers=math.ceil(height/1.55); course=height/layers
            for level in range(layers):
                jitter=.10*math.sin(level*7+row*3)
                instance('quarry',f'Quarry terrace {side} {row} {tier} {level}',
                         (x+jitter,y+level*.07,course*(level+.5)),(3.1,8.06,course-.035))
for i in range(20):
    instance('block',f'Promenade paver {i}',(2.0,8+i*2.3,.04),(3.0,2.16,.13))
for side in [-1,1]:
    instance('block',f'Promenade border {side}',(2+side*1.75,27,.1),(.2,45,.25))
for i in range(4):
    y=43+i*6
    for side in [-1,1]:
        instance('block',f'Passage jamb {i} {side}',(2+side*2.1,y,1.55),(.7,.8,3.1))
    instance('block',f'Passage lintel {i}',(2,y,3.3),(4.9,.8,.4))
for side in [-1,1]:
    instance('quarry',f'Quarry horizon {side}',(side*15,72,4.1),(26,8,8.2))
gravel=np.random.default_rng(4187)
verts=[];faces=[]
seed=prototypes['pebble']['mesh']; seed.calc_loop_triangles()
for i in range(3600):
    if i<2600:
        x=float(gravel.uniform(-7,.2));y=float(gravel.uniform(-7.8,-4.7))
    else:
        x=float(gravel.choice([-1,1]))*float(gravel.uniform(7.2,10.5));y=float(gravel.uniform(-3,22))
    if ((x+2)/6.35)**2+(y/4.55)**2<1: continue
    scale=float(gravel.uniform(.028,.075));angle=float(gravel.uniform(0,math.tau));start=len(verts)
    for v in seed.vertices:
        px,py,pz=v.co
        verts.append((x+scale*(px*math.cos(angle)-py*math.sin(angle)),
                      y+scale*(px*math.sin(angle)+py*math.cos(angle)),scale*(pz*.6+.55)))
    for tri in seed.loop_triangles: faces.append(tuple(start+k for k in tri.vertices))
mesh('gravel',verts,faces,'limestone',False,True);instance('gravel','Scattered quarry gravel')
prototypes.pop('pebble')

scene.world=bpy.data.worlds.new('STRATA_sky')
scene.world.use_nodes=True
scene.world.node_tree.nodes.get('Background').inputs['Color'].default_value=(.64,.76,.89,1)
scene.world.node_tree.nodes.get('Background').inputs['Strength'].default_value=.5
sun_data=bpy.data.lights.new('STRATA_late_sun','SUN');sun_data.energy=2.4;sun_data.angle=.12
sun_data.color=(1,.83,.62)
sun=bpy.data.objects.new('STRATA_late_sun',sun_data);collection.objects.link(sun)
sun.rotation_euler=(math.radians(27),math.radians(-32),math.radians(-34))
area_data=bpy.data.lights.new('STRATA_sky_fill','AREA');area_data.energy=1800;area_data.shape='DISK';area_data.size=25
area=bpy.data.objects.new('STRATA_sky_fill',area_data);collection.objects.link(area);area.location=(8,-10,15)
area.rotation_euler=(Vector((0,0,2))-area.location).to_track_quat('-Z','Y').to_euler()
camera_data=bpy.data.cameras.new('STRATA_overview');camera=bpy.data.objects.new('STRATA_overview',camera_data)
collection.objects.link(camera);camera.location=(5,-16.7,3.4)
camera.rotation_euler=(Vector((-1.5,10,2.0))-camera.location).to_track_quat('-Z','Y').to_euler()
camera_data.lens=43;scene.camera=camera
scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True
scene.render.resolution_x=1672;scene.render.resolution_y=941;scene.render.resolution_percentage=100
scene.view_settings.view_transform='AgX'
scene.render.image_settings.file_format='PNG'
scene.render.filepath=str(ROOT/'reports/strata-blender.png')
scene.view_layers[0].update()

asset_config=[]
for name,info in prototypes.items():
    data=info['mesh'];data.calc_loop_triangles()
    positions=[];normals=[];uv0=[];indices=[];remap={}
    uv=data.uv_layers.active.data
    for tri in data.loop_triangles:
        for li in tri.loops:
            vertex=data.vertices[data.loops[li].vertex_index]
            normal=data.corner_normals[li].vector.normalized()
            tex=uv[li].uv
            key=(vertex.index,round(normal.x,6),round(normal.y,6),round(normal.z,6),round(tex.x,6),round(tex.y,6))
            if key not in remap:
                remap[key]=len(positions)//3
                positions.extend((vertex.co.x,vertex.co.z,-vertex.co.y))
                normals.extend((normal.x,normal.z,-normal.y))
                uv0.extend((tex.x,1-tex.y))
            indices.append(remap[key])
    primitive={'positions':positions,'normals':normals,'uv0':uv0,'indices':indices}
    (RAW/(name+'.json')).write_text(json.dumps(primitive,separators=(',',':')))
    asset_config.append({'name':name,'material':info['material'],'streamed':info['streamed'],
                         'triangles':len(indices)//3,'vertices':len(positions)//3})
config={'version':1,'materials':material_config,'assets':asset_config,'instances':objects,
        'views':{'overview':{'position':[5,3.4,16.7],'target':[-1.5,2.0,-10]},
                 'passage':{'position':[2,3.1,6.5],'target':[1.5,2.5,-22]},
                 'surface':{'position':[-.1,4.9,5.7],'target':[-2.7,4.2,0]}},
        'sourceTriangles':sum(a['triangles']*sum(1 for o in objects if o['asset']==a['name']) for a in asset_config)}
(RAW/'scene-source.json').write_text(json.dumps(config,indent=2)+'\n')
script=bpy.data.texts.new('STRATA_author_source.py');script.write(Path(__file__).read_text())
bpy.data.libraries.write(str(OUT/'strata.blend'),{scene,script},path_remap='RELATIVE_ALL',compress=True)
if old_scene and bpy.context.window:
    bpy.context.window.scene=old_scene
result={'scene':scene.name,'blend':str(OUT/'strata.blend'),'assets':asset_config,'instances':len(objects),
        'sourceTriangles':config['sourceTriangles'],'raw':str(RAW),'originalFileUnchanged':bpy.data.filepath}
