"""Original Rain Tea Garden asset, authored through Blender MCP (Blender 5.1).
Run in Blender's Python environment. Existing scenes are preserved.
Phases may be called independently through MCP: architecture, garden, finish.
"""
import bpy
import math
import random
from mathutils import Vector
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SCENE_NAME = 'RainTeaGarden'
PALETTE = {
 'Plaster_Cream':'F3E9CF', 'Plaster_Gable':'E6D9BC', 'Cedar_Main':'AE7750',
 'Cedar_Light':'C99563', 'Cedar_Dark':'754E37', 'Cedar_End':'D2A277',
 'Roof_Under':'426C6B', 'Roof_Teal_0':'6BABA5', 'Roof_Teal_1':'7FB8AB',
 'Roof_Teal_2':'59938F', 'Roof_Teal_3':'8ABCB0', 'Roof_Ridge':'4B8788',
 'Stone_Base':'C8D5CE', 'Stone_Warm':'C9C6AF', 'Stone_Cool':'A8BBBD',
 'Stone_Paving':'DCD8C3', 'Stone_Crease':'A1AAA0', 'Moss':'839F72',
 'Grass_Sage':'A9C594', 'Grass_Deep':'658E73', 'Leaf_Mint':'8EB799',
 'Leaf_Light':'B6D2A3', 'Leaf_Dark':'608B78', 'Pond_Bed':'8AB4AC',
 'Noren_Coral':'D68F88', 'Noren_Light':'E8A19B', 'Porcelain':'D8EADF',
 'Ink_Tea':'455D51', 'Lantern_Paper':'FFEAC1', 'Lantern_Metal':'667C70',
 'Sakura_Pink':'F6C6D3', 'Sakura_Light':'FFE0E5', 'Sakura_White':'FFF0E7',
 'Sakura_Deep':'D99FAF', 'Sakura_Center':'E8C783',
 'Hydrangea_Blue':'8FB7D8', 'Hydrangea_Lilac':'B4A4D4', 'Hydrangea_Light':'CCD8EE',
 'Water_Glass':'82CDD0', 'Glass_Mint':'B8E5DE', 'Lily':'A6C587',
 'Flower_Cream':'FFF1D1', 'Bamboo':'C2BB81'
}

def linear(v):
 return v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4

def mat(name):
 key='Tea_'+name
 m=bpy.data.materials.get(key)
 if m is not None: return m
 h=PALETTE[name]; rgb=tuple(linear(int(h[i:i+2],16)/255) for i in (0,2,4))
 m=bpy.data.materials.new(key); m.use_nodes=True
 p=m.node_tree.nodes.get('Principled BSDF')
 p.inputs['Base Color'].default_value=(*rgb,1)
 p.inputs['Roughness'].default_value=.72 if name.startswith('Roof') else .88
 p.inputs['Metallic'].default_value=0
 m.diffuse_color=(*rgb,1)
 if name=='Lantern_Paper':
  p.inputs['Emission Color'].default_value=(*rgb,1); p.inputs['Emission Strength'].default_value=.25
 return m

def B(p): return (p[0],-p[2],p[1])

class Batch:
 def __init__(self): self.groups={}
 def add(self, name, material, vertices, faces, smooth=False):
  key=(name,material); v,f,sm=self.groups.setdefault(key,([],[],[])); off=len(v)
  v.extend([tuple(x) for x in vertices]); f.extend([tuple(off+i for i in face) for face in faces]); sm.extend([smooth]*len(faces))
 def flush(self, scene, origin_by_name=None):
  created=[]
  for (name,material),(vertices,faces,smooth) in self.groups.items():
   origin=(origin_by_name or {}).get(name,(0,0,0))
   mesh=bpy.data.meshes.new(name+'Mesh')
   mesh.from_pydata([B(tuple(p[i]-origin[i] for i in range(3))) for p in vertices],[],faces); mesh.update()
   mesh.materials.append(mat(material))
   for poly,flag in zip(mesh.polygons,smooth): poly.use_smooth=flag
   uv=mesh.uv_layers.new(name='UVMap')
   for poly in mesh.polygons:
    for loop_index in poly.loop_indices:
     p=vertices[mesh.loops[loop_index].vertex_index]
     uv.data[loop_index].uv=(p[0]/12+.5,p[2]/12+.5)
   obj=bpy.data.objects.new(name,mesh); scene.collection.objects.link(obj); obj.location=B(origin)
   obj['authored_with']='Blender MCP'; obj['material_role']=material
   created.append(obj)
  self.groups.clear(); return created

def face_out(vertices,face,normal):
 a,b,c=[Vector(vertices[i]) for i in face[:3]]
 return tuple(reversed(face)) if (b-a).cross(c-a).dot(Vector(normal))<0 else tuple(face)

def box(batch,name,material,center,size,bevel=.025,basis=None):
 h=[d/2 for d in size]; r=min(bevel,min(h)*.42); inner=[d-r for d in h]
 verts=[]; ids={}
 for sx in (-1,1):
  for sy in (-1,1):
   for sz in (-1,1):
    signs=(sx,sy,sz)
    for ax in range(3):
     p=[signs[k]*(h[k] if k==ax else inner[k]) for k in range(3)]
     ids[(signs,ax)]=len(verts); verts.append(p)
 faces=[]
 for ax in range(3):
  u,v=[k for k in range(3) if k!=ax]
  for s in (-1,1):
   f=[]
   for su,sv in [(-1,-1),(1,-1),(1,1),(-1,1)]:
    signs=[0,0,0]; signs[ax]=s; signs[u]=su; signs[v]=sv
    f.append(ids[(tuple(signs),ax)])
   n=[0,0,0];n[ax]=s;faces.append(face_out(verts,f,n))
 for a,b in [(0,1),(0,2),(1,2)]:
  c=3-a-b
  for sa in (-1,1):
   for sb in (-1,1):
    signs0=[0,0,0];signs0[a]=sa;signs0[b]=sb;signs0[c]=-1
    signs1=signs0.copy();signs1[c]=1
    f=[ids[(tuple(signs0),a)],ids[(tuple(signs0),b)],ids[(tuple(signs1),b)],ids[(tuple(signs1),a)]]
    n=[0,0,0];n[a]=sa;n[b]=sb;faces.append(face_out(verts,f,n))
 for sx in (-1,1):
  for sy in (-1,1):
   for sz in (-1,1):
    signs=(sx,sy,sz);faces.append(face_out(verts,[ids[(signs,a)] for a in range(3)],signs))
 out=[]
 for p in verts:
  q=Vector(center)
  if basis:
   for k in range(3): q+=Vector(basis[k])*p[k]
  else:q+=Vector(p)
  out.append(q)
 batch.add(name,material,out,faces)

def beam(batch,name,material,a,b,width=.1,depth=None):
 d=Vector(b)-Vector(a); y=d.normalized(); ref=Vector((0,0,1))
 if abs(y.dot(ref))>.92:ref=Vector((1,0,0))
 x=ref.cross(y).normalized();z=x.cross(y).normalized()
 box(batch,name,material,(Vector(a)+Vector(b))/2,(width,d.length,depth or width),min(width*.18,.025),(x,y,z))

def ellipsoid(batch,name,material,center,scale,segments=12,rings=6):
 verts=[(center[0],center[1]-scale[1],center[2])];faces=[]
 for j in range(1,rings):
  a=-math.pi/2+math.pi*j/rings
  for i in range(segments):
   t=2*math.pi*i/segments
   verts.append((center[0]+scale[0]*math.cos(a)*math.cos(t),center[1]+scale[1]*math.sin(a),center[2]+scale[2]*math.cos(a)*math.sin(t)))
 top=len(verts);verts.append((center[0],center[1]+scale[1],center[2]))
 for i in range(segments):faces.append((0,1+(i+1)%segments,1+i))
 for j in range(rings-2):
  for i in range(segments):
   a=1+j*segments+i;b=1+j*segments+(i+1)%segments;c=b+segments;d=a+segments;faces.append((a,b,c,d))
 for i in range(segments):faces.append((top,1+(rings-2)*segments+i,1+(rings-2)*segments+(i+1)%segments))
 batch.add(name,material,verts,[tuple(reversed(f)) for f in faces],True)

def lathe(batch,name,material,center,profile,segments=16):
 verts=[];faces=[]
 for y,r in profile:
  for i in range(segments):
   t=i*math.tau/segments;verts.append((center[0]+r*math.cos(t),center[1]+y,center[2]+r*math.sin(t)))
 for j in range(len(profile)-1):
  for i in range(segments):
   a=j*segments+i;b=j*segments+(i+1)%segments;faces.append((a,b,b+segments,a+segments))
 faces.append(tuple(reversed(range(segments))));faces.append(tuple((len(profile)-1)*segments+i for i in range(segments)))
 batch.add(name,material,verts,[tuple(reversed(f)) for f in faces],True)

def tube(batch,name,material,points,radii,sides=8):
 verts=[];faces=[]
 for j,p in enumerate(points):
  d=Vector(points[min(j+1,len(points)-1)])-Vector(points[max(j-1,0)])
  d.normalize();ref=Vector((0,1,0))
  if abs(d.dot(ref))>.94:ref=Vector((1,0,0))
  u=d.cross(ref).normalized();v=d.cross(u).normalized()
  for i in range(sides):
   t=i*math.tau/sides;verts.append(Vector(p)+radii[j]*(math.cos(t)*u+math.sin(t)*v))
 for j in range(len(points)-1):
  for i in range(sides):
   a=j*sides+i;b=j*sides+(i+1)%sides;faces.append((a,b,b+sides,a+sides))
 faces.append(tuple(reversed(range(sides))));faces.append(tuple((len(points)-1)*sides+i for i in range(sides)))
 batch.add(name,material,verts,faces,True)

def leaf(batch,name,material,center,length=.23,width=.09,yaw=0,pitch=.3):
 d=Vector((math.cos(yaw)*math.cos(pitch),math.sin(pitch),math.sin(yaw)*math.cos(pitch)))
 side=Vector((-math.sin(yaw),0,math.cos(yaw)));c=Vector(center)
 verts=[c-d*length*.45,c+side*width,c+d*length*.55,c-side*width,c+Vector((0,width*.35,0))]
 faces=[(0,1,4),(1,2,4),(2,3,4),(3,0,4)]
 batch.add(name,material,verts,faces)
 

def get_scene():
 scene=bpy.data.scenes.get(SCENE_NAME)
 if scene is None:
  scene=bpy.data.scenes.new(SCENE_NAME); scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
 bpy.context.window.scene=scene
 return scene

def architecture():
 scene=get_scene(); b=Batch();rng=random.Random(310)
 # Cream walls, genuinely open serving front and warm interior.
 box(b,'House_Plaster','Plaster_Cream',(0,1.95,-3.98),(5.6,2.8,.16),.04)
 for x in [-2.72,2.72]:box(b,'House_Plaster','Plaster_Cream',(x,1.97,-2.07),(.18,2.74,3.75),.03)
 box(b,'House_Interior','Cedar_Dark',(0,.57,-2.05),(5.55,.18,3.92),.025)
 # Narrow veranda planks, footings and beams.
 for i in range(22):box(b,'Veranda_Planks','Cedar_Light',(-2.9+i*.277,.66,-.35),(.254,.13,2.25),.015)
 for x in [-2.7,-1.6,1.6,2.7]:
  box(b,'House_Timber','Cedar_Main',(x,1.93,-.24),(.19,2.6,.2),.025)
  box(b,'Stone_Footings','Stone_Warm',(x,.4,-.24),(.38,.44,.4),.07)
 for x in [-2.72,2.72]:
  for z in [-3.95,-2.5,-1.1]:box(b,'House_Timber','Cedar_Main',(x,1.94,z),(.2,2.75,.2),.025)
 for y in [.88,2.95,3.35]:
  box(b,'House_Timber','Cedar_Main',(0,y,-.25),(5.95,.15,.22),.018)
 for x in [-2.78,2.78]:
  box(b,'House_Timber','Cedar_Main',(x,3.34,-2.05),(.2,.18,4.4),.025)
 # Side and front shoji lattices.
 for xc in [-2.18,2.18]:
  box(b,'Shoji_Paper','Plaster_Gable',(xc,1.85,-.18),(.85,1.95,.045),.01)
  for i in range(5):box(b,'Shoji_Lattice','Cedar_Light',(xc-.42+i*.21,1.85,-.125),(.033,1.94,.045),.006)
  for j in range(7):box(b,'Shoji_Lattice','Cedar_Light',(xc,.91+j*.31,-.12),(.87,.033,.052),.006)
 for zc in [-1.35,-2.8]:
  for i in range(6):box(b,'Shoji_Side','Cedar_Light',(2.835,1.9,zc-.53+i*.215),(.032,1.95,.032),.005)
  for j in range(7):box(b,'Shoji_Side','Cedar_Light',(2.84,.94+j*.32,zc),(.03,.032,1.09),.005)
 # Front gable plate and circular window / wooden spokes.
 b.add('House_Gable','Plaster_Gable',[(-2.75,3.4,-.55),(2.75,3.4,-.55),(0,5.15,-.55)],[(0,1,2)])
 beam(b,'Gable_Frame','Cedar_Main',(-2.95,3.4,-.49),(0,5.29,-.49),.18)
 beam(b,'Gable_Frame','Cedar_Main',(0,5.29,-.49),(2.95,3.4,-.49),.18)
 beam(b,'Gable_Frame','Cedar_Main',(0,3.45,-.45),(0,5.22,-.45),.13)
 ring=[(.50*math.cos(i*math.tau/40),4.34+.50*math.sin(i*math.tau/40),-.41) for i in range(41)]
 tube(b,'Round_Window_Frame','Cedar_Main',ring,[.048]*41,6)
 b.add('Round_Window_Dark','Cedar_Dark',[(0,4.34,-.445)]+[(.45*math.cos(i*math.tau/32),4.34+.45*math.sin(i*math.tau/32),-.445) for i in range(32)],[(0,1+i,1+(i+1)%32) for i in range(32)])
 for x in [-.29,-.145,0,.145,.29]:
  half=math.sqrt(.44**2-x*x);beam(b,'Round_Window_Lattice','Cedar_Light',(x,4.34-half,-.365),(x,4.34+half,-.365),.035)
 for h in [-.24,0,.24]:
  half=math.sqrt(.44**2-h*h);beam(b,'Round_Window_Lattice','Cedar_Light',(-half,4.34+h,-.365),(half,4.34+h,-.365),.034)
 # Main curved tile roof; each little cap is real curved geometry.
 def roof_y(x):return 5.28-.58*abs(x)+.23*(abs(x)/3.4)**6
 for sign in [-1,1]:
  # Continuous cedar underside closes the roof for GI and volumetric shadowing.
  for r in range(7):
   x0=sign*r*.485;x1=sign*(r+1)*.485
   verts=[(x0,roof_y(x0)-.055,-4.45),(x1,roof_y(x1)-.055,-4.45),(x1,roof_y(x1)-.055,-.42),(x0,roof_y(x0)-.055,-.42)]
   b.add('Roof_Underside','Cedar_Dark',verts,[(0,1,2,3)])
  for zi in range(17):
   zc=-4.32+zi*.24
   for r in range(7):
    verts=[]
    for u in range(3):
     x=sign*(r*.485+u*.27)
     for v in range(5):
      t=-math.pi/2+math.pi*v/4; z=zc+.128*math.sin(t)
      verts.append((x,roof_y(x)+.085*math.cos(t)+.022,z))
    faces=[]
    for u in range(2):
     for v in range(4):
      f=(u*5+v,u*5+v+1,(u+1)*5+v+1,(u+1)*5+v)
      faces.append(face_out(verts,f,(0,1,0)))
    b.add('Roof_Tiles','Roof_Teal_'+str((zi+r+rng.randrange(2))%4),verts,faces,True)
  for z in [-4.48,-.36]:tube(b,'Roof_Borders','Roof_Ridge',[(sign*i*.17,roof_y(i*.17)+.035,z) for i in range(21)],[.075]*21,8)
 tube(b,'Roof_Ridge','Roof_Ridge',[(0,5.31,-4.5),(0,5.34,-2.4),(0,5.4,-.24)],[.12,.12,.14],10)
 for z in [-4.55,-.23]:
  ellipsoid(b,'Ridge_Endcap','Roof_Ridge',(0,5.42,z),(.19,.19,.075),12,6)
 # Lower veranda roof sweeping toward the visitor.
 def awning_y(z):
  t=(z+.6)/1.75;return 3.95-.8*t+.17*t**4
 for xi in range(25):
  xc=-3.36+xi*.28
  for r in range(4):
   verts=[]
   for u in range(3):
    z=-.64+r*.425+u*.23
    for v in range(5):
     t=-math.pi/2+math.pi*v/4;x=xc+.148*math.sin(t)
     verts.append((x,awning_y(z)+.085*math.cos(t),z))
   faces=[face_out(verts,(u*5+v,u*5+v+1,(u+1)*5+v+1,(u+1)*5+v),(0,1,0)) for u in range(2) for v in range(4)]
   b.add('Awning_Tiles','Roof_Teal_'+str((xi+r)%4),verts,faces,True)
 # Thin roof base, rafters and fascia.
 b.add('Awning_Underside','Cedar_Dark',[(-3.5,3.89,-.6),(3.5,3.89,-.6),(3.5,3.23,1.15),(-3.5,3.23,1.15)],[(0,1,2,3)])
 beam(b,'Awning_Fascia','Cedar_Main',(-3.53,3.25,1.15),(3.53,3.25,1.15),.15)
 for x in [-3.4,-2.8,-2.2,-1.6,-1,-.4,.2,.8,1.4,2,2.6,3.2]:beam(b,'Awning_Rafters','Cedar_Main',(x,3.87,-.6),(x,3.20,1.2),.09)
 # Counter, stools, inner shelving and tea vessels.
 box(b,'Tea_Counter','Cedar_Main',(0,1.21,-.48),(3.2,.12,.84),.03)
 for x in [-1.4,-.9,-.4,.1,.6,1.1,1.4]:box(b,'Counter_Panels','Cedar_Light',(x,.92,-.06),(.44,.55,.055),.015)
 for x in [-.84,.84]:
  box(b,'Tea_Stools','Cedar_Main',(x,.97,.48),(.55,.10,.43),.04)
  for dx in [-.19,.19]:
   for dz in [-.13,.13]:beam(b,'Tea_Stools','Cedar_Dark',(x+dx,.69,.48+dz),(x+dx*.82,.93,.48+dz*.82),.065)
 box(b,'Interior_Back','Cedar_Dark',(0,2.01,-3.78),(3.9,2.6,.10),.02)
 for y in [1.4,2.02,2.6]:box(b,'Tea_Shelves','Cedar_Light',(0,y,-3.48),(3.9,.075,.64),.01)
 for i in range(14):
  x=-1.68+(i%7)*.54;y=1.46+(i//7)*.62;z=-3.45
  lathe(b,'Tea_Jars','Porcelain' if i%3 else 'Ink_Tea',(x,y,z),[(0,.09),(.02,.13),(.24,.14),(.3,.09),(.34,.085)],12)
 for x in [-.95,.15,.55]:
  lathe(b,'Tea_Cups','Porcelain',(x,1.29,-.26),[(0,.075),(.025,.1),(.17,.12),(.185,.11)],12)
  lathe(b,'Tea_Saucers','Porcelain',(x,1.28,-.26),[(0,.14),(.02,.15),(.035,.10)],12)
 ellipsoid(b,'Tea_Kettle','Ink_Tea',(-.55,1.48,-.38),(.24,.2,.2),16,8)
 lathe(b,'Tea_Kettle_Lid','Cedar_Dark',(-.55,1.67,-.38),[(0,.15),(.035,.10),(.07,.04)],12)
 tube(b,'Tea_Kettle_Spout','Ink_Tea',[(-.34,1.48,-.38),(-.17,1.58,-.38),(-.15,1.68,-.38)],[.065,.05,.045],8)
 tube(b,'Tea_Kettle_Handle','Cedar_Dark',[(-.74,1.57,-.38),(-.81,1.8,-.38),(-.51,1.93,-.38),(-.27,1.77,-.38),(-.31,1.57,-.38)],[.025]*5,6)
 # Curtain rod and hanging wooden leaf plaque.
 beam(b,'Noren_Rod','Cedar_Dark',(-1.82,3.04,.82),(1.82,3.04,.82),.045)
 beam(b,'Sign_Bracket','Cedar_Dark',(2.74,3.05,.37),(3.49,3.05,.37),.09)
 for x in [3.12,3.48]:beam(b,'Sign_Cord','Ink_Tea',(x,3.04,.37),(x,2.68,.37),.018)
 box(b,'Tea_Sign','Cedar_Main',(3.30,2.43,.39),(.65,.6,.07),.035)
 b.flush(scene)
 # Separate cloth panels have top-edge origins for small runtime wind motion.
 for i in range(4):
  batch=Batch();name='Noren_'+str(i);xc=-1.38+i*.91
  vertices=[]
  for row in range(4):
   for col in range(6):
    x=xc-.42+.84*col/5;y=3.0-.73*row/3;z=.88+.025*math.cos(col*math.pi*.8)*(row/3)
    vertices.append((x,y,z))
  faces=[]
  for row in range(3):
   for col in range(5):
    a=row*6+col;faces.append((a,a+1,a+7,a+6))
  batch.add(name,'Noren_Coral' if i%2 else 'Noren_Light',vertices,faces,True)
  batch.flush(scene,{name:(xc,3.0,.88)})
 # Logo as physical inset leaf shapes on plaque / center curtain.
 b=Batch()
 for x,y,z,scale in [(3.30,2.42,.438,.7),(.47,2.64,.94,.75)]:
  for dx,dy,a in [(-.09,0,-.45),(.07,.04,.45),(0,.16,0)]:
   pts=[(x+dx*scale,y+(dy-.13)*scale,z),(x+(dx-.055)*scale,y+(dy+.02)*scale,z),(x+dx*scale,y+(dy+.19)*scale,z),(x+(dx+.055)*scale,y+(dy+.02)*scale,z)]
   b.add('Tea_Leaf_Logos','Flower_Cream',pts,[(2,1,0),(3,2,0)])
 b.flush(scene)
 return {'phase':'architecture','objects':len(scene.objects)}

def garden():
 scene=get_scene();b=Batch();rng=random.Random(725)
 # Curving pale island and sunk turquoise pond bed.
 ellipsoid(b,'Island_Base','Stone_Base',(0,-.43,.2),(6.45,.43,5.05),64,8)
 ellipsoid(b,'Garden_Soil','Grass_Sage',(-1.8,.20,.4),(3.78,.25,4.33),72,14)
 # Lower the shore under the actual pond footprint so solid soil cannot hide transparent water.
 verts,_,_=b.groups[('Garden_Soil','Grass_Sage')]
 for i,(x,y,z) in enumerate(verts):
  pond_radius=math.sqrt(((x-2)/3.04)**2+((z-2.23)/2.28)**2)
  shore=max(0,min(1,(pond_radius-.91)/.18))
  verts[i]=(x,min(y,-.08+shore*.55),z)
 ellipsoid(b,'Pond_Basin','Pond_Bed',(2.0,.02,2.23),(3.0,.10,2.25),48,6)
 for i in range(42):
  t=i*math.tau/42; x=6.02*math.cos(t);z=.2+4.75*math.sin(t)
  ellipsoid(b,'Island_Rim','Stone_Warm' if i%3 else 'Stone_Cool',(x,.09,z),(.43,.32,.35),10,5)
 # Irregular mossy pond curb, with openings under bridge.
 for i in range(24):
  t=i*math.tau/24;x=2+3.04*math.cos(t);z=2.25+2.28*math.sin(t)
  if abs(x-.65)<.9 and z<.8:continue
  ellipsoid(b,'Pond_Stones','Stone_Cool' if i%4==0 else 'Stone_Warm',(x,.28,z),(.35+rng.random()*.15,.22+rng.random()*.16,.28+rng.random()*.1),10,5)
  if i%2==0:ellipsoid(b,'Stone_Moss','Moss',(x-.08,.45,z),(.31,.045,.19),8,4)
 # Path to veranda, individual bevelled stone slabs.
 path=[(-3.25,3.52,1.05,.74),(-2.45,2.9,1.10,.72),(-3.20,2.35,.85,.64),(-1.95,2.17,1.04,.82),(-2.78,1.5,.98,.7),(-1.45,1.3,.88,.75),(-2.25,.69,1.02,.7),(-1.45,.27,.87,.65)]
 for i,(x,z,w,d) in enumerate(path):box(b,'Stone_Paving','Stone_Paving',(x,.39,z),(w,.20,d),.13)
 # Two broad entry steps.
 box(b,'Entry_Steps','Stone_Paving',(0,.35,.97),(3.7,.2,.56),.08)
 box(b,'Entry_Steps','Stone_Paving',(0,.48,.61),(4.1,.17,.55),.075)
 # Front-right stepping islands and submerged pebble field.
 for x,z in [(3.62,3.2),(4.06,2.34),(3.92,1.55)]:ellipsoid(b,'Pond_Stepping_Stones','Stone_Paving',(x,.27,z),(.65,.20,.38),12,6)
 for i in range(24):
  t=rng.random()*math.tau;r=math.sqrt(rng.random())
  x=2+2.7*r*math.cos(t);z=2.2+1.9*r*math.sin(t)
  ellipsoid(b,'Underwater_Pebbles','Stone_Cool' if i%2 else 'Pond_Bed',(x,.075,z),(.15+rng.random()*.2,.075,.11+rng.random()*.13),8,4)
 # Arched cedar bridge, raised apex, posts and flowing rails.
 def bridge_y(z):return .49+.53*math.sin(math.pi*(z-.45)/2.8)
 for i in range(17):
  z=.45+i*2.8/16
  box(b,'Bridge_Planks','Cedar_Light' if i%3 else 'Cedar_Main',(.7,bridge_y(z),z),(1.62,.105,.185),.02)
 for x in [-.19,1.59]:
  points=[(x,bridge_y(.42+i*2.88/24)+.66,.42+i*2.88/24) for i in range(25)]
  tube(b,'Bridge_Handrails','Cedar_Main',points,[.064]*25,6)
  points2=[(x,bridge_y(.42+i*2.88/24)+.31,.42+i*2.88/24) for i in range(25)]
  tube(b,'Bridge_Handrails','Cedar_Main',points2,[.042]*25,6)
  for z in [.47,1.37,2.37,3.24]:
   y=bridge_y(z)
   box(b,'Bridge_Posts','Cedar_Main',(x,y+.34,z),(.14,.92,.14),.018)
   box(b,'Bridge_Caps','Cedar_End',(x,y+.84,z),(.25,.10,.25),.03)
   ellipsoid(b,'Bridge_Finials','Lantern_Metal',(x,y+.94,z),(.115,.1,.115),8,4)
 # Garden rocks at the tree and water's far bank.
 for i,(x,z,s) in enumerate([(-4.4,.1,.85),(-4.7,1.8,.65),(-3.9,3.0,.5),(4.2,-.15,.7),(4.75,1,.58),(3.85,-1.1,.62),(-4.6,-2.75,.6)]):
  ellipsoid(b,'Garden_Rocks','Stone_Cool' if i%2 else 'Stone_Warm',(x,.28+s*.3,z),(s,.55*s,.65*s),10,5)
  ellipsoid(b,'Garden_Moss','Moss',(x-.12,.29+s*.75,z+.05),(.72*s,.095,.49*s),10,4)
 # Cedar/bamboo garden fence, behind the right bank.
 for z in [-2.2,-1.35,-.5,.35]:
  lathe(b,'Bamboo_Fence','Bamboo',(4.55,.2,z),[(0,.055),(1.7,.055),(1.72,.075)],8)
 for h in [.82,1.5]:beam(b,'Bamboo_Fence','Bamboo',(4.55,h,-2.3),(4.55,h,.55),.065)
 # Stone lanterns with warm inner glazing.
 for x,z,k in [(-3.6,.55,1.0),(4.7,.25,.78)]:
  box(b,'Stone_Lanterns','Stone_Cool',(x,.5,z),(.34,.8,.34),.045)
  box(b,'Stone_Lanterns','Stone_Warm',(x,.93,z),(.69,.10,.61),.08)
  box(b,'Stone_Lantern_Glow','Lantern_Paper',(x,1.18,z),(.40,.38,.38),.01)
  for dx in [-.23,.23]:
   for dz in [-.22,.22]:box(b,'Stone_Lanterns','Stone_Cool',(x+dx,1.18,z+dz),(.055,.45,.055),.008)
  lathe(b,'Stone_Lantern_Roof','Stone_Cool',(x,1.4,z),[(0,.5),(.1,.43),(.27,.15),(.31,.12)],8)
  ellipsoid(b,'Stone_Lantern_Top','Stone_Warm',(x,1.8,z),(.12,.18,.12),8,5)
 # Pond lilies: flat scalloped disks and simple folded blossoms.
 for x,z,r in [(1.5,3.6,.28),(2.2,3.8,.34),(2.9,3.25,.3),(1.8,1.7,.24)]:
  verts=[(x,.20,z)]+[(x+r*math.cos(t),.205,z+r*.72*math.sin(t)) for t in [i*math.tau/18 for i in range(18)]]
  b.add('Lily_Pads','Lily',verts,[(0,1+(i+1)%18,1+i) for i in range(1,17)])
  for i in range(7):
   t=i*math.tau/7;leaf(b,'Lotus_Petals','Sakura_Light',(x+.025*math.cos(t),.24,z+.025*math.sin(t)),.22,.05,t,.75)
 # Low shrubs, leafy silhouettes and hydrangea flower balls.
 clusters=[(-4.2,1.0,.8),(-4.7,-.8,.6),(-4.1,-3.1,.8),(3.75,-.75,.8),(4.6,1.6,.6),(-4,2.5,.5),(3.2,-2.8,.7),(-2.6,3.55,.5)]
 for idx,(x,z,s) in enumerate(clusters):
  for j in range(5):
   a=j*2.4;ellipsoid(b,'Garden_Shrubs','Leaf_Mint' if j%2 else 'Grass_Deep',(x+math.cos(a)*s*.4,.5+(.2 if j==0 else 0),z+math.sin(a)*s*.35),(s*.5,s*.43,s*.45),10,5)
  for j in range(48):
   a=rng.random()*math.tau; rr=rng.random()*s
   leaf(b,'Garden_Leaves','Leaf_Light' if j%3 else 'Leaf_Dark',(x+rr*math.cos(a),.52+rng.random()*.43,z+rr*math.sin(a)),.34,.10,a,.5)
  if idx%2==0:
   for j in range(3):
    cx=x+(j-1)*.34;cz=z+(.1 if j%2 else -.2);cy=.85+.1*(j%2)
    ellipsoid(b,'Hydrangea_Core','Hydrangea_Blue',(cx,cy,cz),(.29,.26,.27),10,5)
    for n in range(16):
     a=n*2.39996; yy=1-2*(n+.5)/16;rr=math.sqrt(1-yy*yy)
     c=(cx+.29*rr*math.cos(a),cy+.25*yy,cz+.27*rr*math.sin(a))
     col=['Hydrangea_Blue','Hydrangea_Lilac','Hydrangea_Light'][(n+j)%3]
     for petal in range(4):
      pa=petal*math.pi/2
      ellipsoid(b,'Hydrangea_Florets_'+str((n+j)%3),col,(c[0]+.043*math.cos(pa),c[1]+.015,c[2]+.043*math.sin(pa)),(.055,.025,.043),6,3)
 # Grasses at edges.
 for i in range(44):
  a=rng.random()*math.tau;x=5.5*math.cos(a);z=.2+4.1*math.sin(a)
  for j in range(3):leaf(b,'Grass_Blades','Leaf_Light',(x,.26,z),.32+rng.random()*.3,.022,a+j*.6,1.1)
 b.flush(scene)
 # Water is authored in Blender; realtime runtime supplies weighted material.
 w=Batch();verts=[(2,.18,2.23)]+[(2+2.92*math.cos(i*math.tau/64),.18,2.23+2.16*math.sin(i*math.tau/64)) for i in range(64)]
 w.add('WaterSurface','Water_Glass',verts,[(0,1+(i+1)%64,1+i) for i in range(64)])
 w.flush(scene)
 return {'phase':'garden','objects':len(scene.objects)}

def ornaments():
 scene=get_scene();b=Batch();rng=random.Random(109)
 # Branching, S-curved cherry tree. Twig silhouettes remain visible between blossoms.
 trunk=[(-4.05,.2,-1.9),(-4.2,1.0,-1.83),(-3.95,2.0,-1.8),(-4.2,3.0,-1.78),(-3.85,4.1,-1.65),(-3.8,4.8,-1.5)]
 tube(b,'Sakura_Trunk','Cedar_Dark',trunk,[.38,.31,.26,.2,.14,.075],10)
 for i,tip in enumerate([(-5.6,5.5,-1.9),(-5.1,6.0,-3.1),(-3.1,6.0,-2.5),(-2.4,5.7,-1.1),(-4.2,6.7,-1.5),(-5.7,5.4,-.1),(-3.5,5.9,.0)]):
  start=trunk[3+(i%2)];mid=((start[0]+tip[0])*.5,start[1]+.75,(start[2]+tip[2])*.5)
  tube(b,'Sakura_Branches','Cedar_Main',[start,mid,tip],[.12,.085,.025],8)
  for j in range(8):
   a=j*2.399+i;rr=.3+.58*rng.random();c=(tip[0]+math.cos(a)*rr,tip[1]+rng.uniform(-.3,.3),tip[2]+math.sin(a)*rr)
   col=['Sakura_Pink','Sakura_Light','Sakura_White'][(i+j)%3]
   # Small lobes support a broken silhouette; individually folded blossoms cover the surface.
   ellipsoid(b,'Sakura_Canopy_'+str((i+j)%3),col,c,(.34,.26,.32),9,5)
   if j%2==0:tube(b,'Sakura_Twigs','Cedar_Main',[tip,((tip[0]+c[0])/2,c[1]-.12,(tip[2]+c[2])/2),c],[.023,.013,.004],5)
   for n in range(18):
    a=n*2.39996;ny=1-2*(n+.5)/18;nr=math.sqrt(1-ny*ny)
    normal=Vector((nr*math.cos(a),ny,nr*math.sin(a)))
    tangent=normal.cross(Vector((0,1,0)))
    if tangent.length<.01:tangent=Vector((1,0,0))
    tangent.normalize();bitangent=normal.cross(tangent).normalized()
    center=Vector(c)+Vector((normal.x*.38,normal.y*.31,normal.z*.36))
    radius=.095+rng.random()*.05
    for k in range(5):
     angle=k*math.tau/5+rng.random()*.13
     direction=tangent*math.cos(angle)+bitangent*math.sin(angle)
     side=normal.cross(direction)
     base=center+direction*.016
     verts=[base,center+direction*radius*.66+side*radius*.46,
       center+direction*radius+side*radius*.10-normal*.024,
       center+direction*radius*.91-side*radius*.14-normal*.025,
       center+direction*radius*.58-side*radius*.43,
       center+direction*radius*.53+normal*.018]
     faces=[face_out(verts,f,normal) for f in [(0,1,5),(1,2,5),(2,3,5),(3,4,5),(4,0,5)]]
     b.add('Sakura_Flowers_'+str((n+i)%3),['Sakura_White','Sakura_Pink','Sakura_Light'][(n+i)%3],verts,faces)
 # Bring the tree forward into the left silhouette rather than hiding its trunk behind the house.
 for (name,_),(vertices,_,_) in b.groups.items():
  if name.startswith('Sakura_'):
   vertices[:]=[(x-.4,y-.1,z+1.35) for x,y,z in vertices]
 # Potted front plant.
 for x,z in [(-2.55,.35),(2.35,.28)]:
  lathe(b,'Ceramic_Pots','Porcelain',(x,.70,z),[(0,.15),(.08,.24),(.36,.29),(.46,.22),(.5,.25)],16)
  for j in range(9):
   a=j*2.4;end=(x+.38*math.cos(a),1.38+rng.random()*.35,z+.36*math.sin(a))
   beam(b,'Potted_Stems','Cedar_Dark',(x,1.13,z),end,.018)
   for k in range(3):leaf(b,'Potted_Leaves','Leaf_Light' if k%2 else 'Leaf_Dark',(end[0],end[1]-.1*k,end[2]),.3,.11,a+k*.9,.25)
 # Warm paper lantern with real segmented silhouette and ribs.
 lathe(b,'Lantern_Hanging','Lantern_Paper',(2.75,2.09,.66),[(0,.12),(.08,.23),(.22,.27),(.50,.27),(.65,.22),(.72,.11)],20)
 for h in [0,.08,.18,.3,.42,.54,.64,.71]:
  r=.12 if h in [0,.71] else (.23 if h in [.08,.64] else .272)
  points=[(2.75+r*math.cos(i*math.tau/24),2.09+h,.66+r*math.sin(i*math.tau/24)) for i in range(25)]
  tube(b,'Lantern_Ribs','Cedar_End',points,[.009]*25,4)
 beam(b,'Lantern_Cord','Cedar_Dark',(2.75,3.25,.66),(2.75,2.81,.66),.017)
 box(b,'Lantern_Floor_Glass','Lantern_Paper',(-2.05,.94,.66),(.27,.47,.25),.005)
 for dx in [-.18,.18]:
  for dz in [-.16,.16]:box(b,'Lantern_Floor_Frame','Lantern_Metal',(-2.05+dx,.94,.66+dz),(.045,.65,.045),.006)
 for h in [.65,1.25]:box(b,'Lantern_Floor_Frame','Lantern_Metal',(-2.05,h,.66),(.43,.065,.4),.02)
 b.flush(scene)
 # Individually pivoted wind chime parts.
 c=Batch();ellipsoid(c,'ChimeGlass','Glass_Mint',(-2.25,2.89,.88),(.16,.18,.16),16,8);c.flush(scene,{'ChimeGlass':(-2.25,3.15,.88)})
 c=Batch();beam(c,'Chime_String','Cedar_Dark',(-2.25,3.3,.88),(-2.25,2.63,.88),.008)
 box(c,'ChimePaper','Water_Glass',(-2.25,2.40,.88),(.12,.46,.008),.004)
 c.flush(scene,{'ChimePaper':(-2.25,2.63,.88),'Chime_String':(-2.25,3.3,.88)})
 return {'phase':'ornaments','objects':len(scene.objects)}

def finish():
 scene=get_scene()
 # Only this newly authored scene is exported; the pre-existing startup scene remains untouched.
 world=bpy.data.worlds.new('RainTeaGarden_World');world.use_nodes=True
 world.node_tree.nodes.get('Background').inputs[0].default_value=(.55,.7,.8,1)
 world.node_tree.nodes.get('Background').inputs[1].default_value=.6;scene.world=world
 camera_data=bpy.data.cameras.new('Tea_Preview_Camera');camera=bpy.data.objects.new('Tea_Preview_Camera',camera_data);scene.collection.objects.link(camera)
 camera.location=B((12,9.1,17));target=Vector(B((-.2,2,.15)))
 camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler();camera_data.lens=48;scene.camera=camera
 for name,loc,power,size,color in [('Tea_Soft_Sun',(-5,11,7),1700,7,(1,.88,.72)),('Tea_Sky_Fill',(7,8,-3),1000,9,(.72,.88,1))]:
  data=bpy.data.lights.new(name,'AREA');data.energy=power;data.shape='DISK';data.size=size;data.color=color
  light=bpy.data.objects.new(name,data);scene.collection.objects.link(light);light.location=B(loc);light.rotation_euler=(Vector(B((0,1,0)))-light.location).to_track_quat('-Z','Y').to_euler()
 scene.render.engine='CYCLES';scene.cycles.samples=24
 scene.render.resolution_x=1200;scene.render.resolution_y=840;scene.render.resolution_percentage=100
 scene.view_settings.view_transform='AgX';scene.render.image_settings.file_format='PNG'
 # Count triangles before exporting, preserving meaningful independent animated nodes.
 deps=bpy.context.evaluated_depsgraph_get();total=0
 for obj in scene.objects:
  if obj.type=='MESH':
   mesh=obj.data;mesh.calc_loop_triangles();total+=len(mesh.loop_triangles)
 scene['asset_title']='雨后茶寮 / After the rain';scene['triangle_count']=total;scene['asset_authoring']='Original geometry authored through Blender MCP, 2026-10-13'
 blend=ROOT/'rain-tea-garden.blend';glb=ROOT/'rain-tea-garden.glb'
 bpy.ops.wm.save_as_mainfile(filepath=str(blend),check_existing=False)
 bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',use_active_scene=True,export_apply=True,export_animations=False,export_cameras=False,export_lights=False,export_extras=True,export_yup=True,export_vertex_color='NONE',export_materials='EXPORT')
 return {'phase':'finish','scene':scene.name,'meshes':sum(o.type=='MESH' for o in scene.objects),'triangles':total,'glb':str(glb),'glb_bytes':glb.stat().st_size,'blend':str(blend)}

if __name__=='__main__':
 if bpy.data.scenes.get(SCENE_NAME) is not None:
  raise RuntimeError('RainTeaGarden already exists; use a fresh Blender file to rebuild without replacing user data')
 architecture();garden();ornaments();print(finish())
