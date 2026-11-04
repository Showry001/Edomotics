"""The bedroom behind the homepage "One room" console, built in code.

    blender -b --factory-startup --disable-autoexec --python scripts/room/scene.py

Writes _src/room/room.blend. Everything is modelled here except the plant and the garden sky
(Poly Haven, CC0), read from _src/room/assets/. render.py renders the light layers and the
curtain and fan frames from the saved file, and imports set_curtain() and FAN from here.

Units are metres. x runs left to right, y from the camera (negative) to the bed wall (y = 0),
z up from the floor.
"""
import math
import os

import bmesh
import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
SRC = os.path.join(ROOT, '_src', 'room')
ASSETS = os.path.join(SRC, 'assets')
BLEND = os.path.join(SRC, 'room.blend')

W, D, H = 6.0, 6.6, 3.2           # the room
X0, X1, Y0 = -W / 2, W / 2, -D
WIN = (1.15, 2.95)               # floor-to-ceiling glass in the bed wall
PANEL_END = 1.0                  # the wood wall runs from the left wall to here
SLOT = 0.2                       # depth of the ceiling slot (cove light and curtain track)
BED_X = -0.9
FAN = Vector((-0.9, -2.0, 2.66)) # centre of the fan's blades: over the bed
GROUPS = ('day', 'cove', 'down', 'lamp')
SKY_TURN = 60                    # turns the garden so the palms and pool sit in the window


# ----------------------------------------------------------------------------- helpers

def lin(hexstr):
    """sRGB hex to the linear RGBA Blender's colour inputs expect."""
    h = hexstr.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((v + 0.055) / 1.055) ** 2.4 if v > 0.04045 else v / 12.92 for v in c) + (1.0,)


def put(node, **inputs):
    for k, v in inputs.items():
        node.inputs[k.replace('_', ' ')].default_value = v
    return node


def material(name, color, rough=0.6, **inputs):
    m = bpy.data.materials.new(name)
    bsdf = m.node_tree.nodes['Principled BSDF']
    put(bsdf, Base_Color=lin(color), Roughness=rough, **inputs)
    return m


def nodes_of(m):
    return m.node_tree.nodes, m.node_tree.links, m.node_tree.nodes['Principled BSDF']


def obj(name, bm, mat=None, smooth=False, parent=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if smooth:
        me.shade_smooth()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    if mat:
        me.materials.append(mat)
    if parent:
        o.parent = parent
    return o


def box(name, x0, x1, y0, y1, z0, z1, mat, bevel=0.0, seg=3):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((x0 if v.co.x < 0 else x1, y0 if v.co.y < 0 else y1, z0 if v.co.z < 0 else z1))
    o = obj(name, bm, mat, smooth=bevel > 0)
    if bevel:
        b = o.modifiers.new('bevel', 'BEVEL')
        b.width, b.segments, b.limit_method, b.harden_normals = bevel, seg, 'ANGLE', True
    return o


def cylinder(name, r, z0, z1, mat, at=(0, 0), seg=48, r2=None, bevel=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=z1 - z0)
    bmesh.ops.translate(bm, verts=bm.verts, vec=(at[0], at[1], (z0 + z1) / 2))
    o = obj(name, bm, mat, smooth=True)
    if bevel:
        b = o.modifiers.new('bevel', 'BEVEL')
        b.width, b.segments, b.limit_method, b.harden_normals = bevel, 3, 'ANGLE', True
    return o


def sphere(name, r, at, mat, scale=(1, 1, 1)):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=24, radius=r)
    for v in bm.verts:
        v.co = Vector((v.co.x * scale[0] + at[0], v.co.y * scale[1] + at[1], v.co.z * scale[2] + at[2]))
    return obj(name, bm, mat, smooth=True)


def light(name, kind, at, energy, kelvin, group, **props):
    ld = bpy.data.lights.new(name, kind)
    ld.energy = energy
    ld.use_temperature, ld.temperature = True, kelvin
    for k, v in props.items():
        setattr(ld, k, v)
    o = bpy.data.objects.new(name, ld)
    o.location = at
    o.lightgroup = group
    bpy.context.scene.collection.objects.link(o)
    return o


def subdivide(o, levels=2):
    s = o.modifiers.new('subd', 'SUBSURF')
    s.levels = s.render_levels = levels
    return s


def wrinkle(o, strength, size, seed):
    tex = bpy.data.textures.new(f'{o.name}-wrinkle', 'CLOUDS')
    tex.noise_scale, tex.noise_depth = size, 2
    d = o.modifiers.new('wrinkle', 'DISPLACE')
    d.texture, d.strength, d.mid_level = tex, strength, 0.5
    d.texture_coords = 'GLOBAL'
    o['seed'] = seed
    return d


# ----------------------------------------------------------------------------- materials

def wood_material():
    """Warm teak veneer: vertical grain, a little figure, satin finish. Each panel shifts the grain."""
    m = material('wood', '#7a5435', 0.42, Specular_IOR_Level=0.45, Coat_Weight=0.15, Coat_Roughness=0.3)
    n, l, bsdf = nodes_of(m)
    coord, info = n.new('ShaderNodeTexCoord'), n.new('ShaderNodeObjectInfo')
    offset = n.new('ShaderNodeVectorMath')
    offset.operation = 'ADD'
    scale = n.new('ShaderNodeVectorMath')
    scale.operation = 'MULTIPLY'
    scale.inputs[1].default_value = (70.0, 70.0, 0.9)       # long streaks up the panel
    l.new(coord.outputs['Object'], offset.inputs[0])
    l.new(info.outputs['Random'], offset.inputs[1])
    l.new(offset.outputs[0], scale.inputs[0])
    grain = n.new('ShaderNodeTexNoise')
    put(grain, Scale=1.0, Detail=8.0, Roughness=0.6, Distortion=0.15)
    l.new(scale.outputs[0], grain.inputs['Vector'])
    figure = n.new('ShaderNodeTexWave')
    figure.wave_type, figure.bands_direction = 'BANDS', 'X'
    put(figure, Scale=1.6, Distortion=1.2, Detail=2.0, Detail_Scale=1.0)
    l.new(offset.outputs[0], figure.inputs['Vector'])
    mix = n.new('ShaderNodeMath')
    mix.operation = 'MULTIPLY_ADD'
    mix.inputs[1].default_value = 0.18
    l.new(figure.outputs['Fac'], mix.inputs[0])
    l.new(grain.outputs['Fac'], mix.inputs[2])
    ramp = n.new('ShaderNodeValToRGB')
    els = ramp.color_ramp.elements
    els[0].position, els[0].color = 0.3, lin('#5e4029')
    els[1].position, els[1].color = 0.75, lin('#8d6646')
    l.new(mix.outputs[0], ramp.inputs['Fac'])
    l.new(ramp.outputs['Color'], bsdf.inputs['Base Color'])
    bump = n.new('ShaderNodeBump')
    put(bump, Strength=0.08, Distance=0.002)
    l.new(mix.outputs[0], bump.inputs['Height'])
    l.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    return m


def tile_material():
    """Large-format warm limestone, 1200 × 600 tiles with hairline joints."""
    m = material('stone-floor', '#d6cdbf', 0.32, Specular_IOR_Level=0.5)
    n, l, bsdf = nodes_of(m)
    coord = n.new('ShaderNodeTexCoord')
    brick = n.new('ShaderNodeTexBrick')
    brick.offset, brick.squash = 0.5, 1.0
    put(brick, Color1=lin('#d8cfc1'), Color2=lin('#cfc5b6'), Mortar=lin('#a89c8c'), Scale=1.0,
        Mortar_Size=0.0025, Mortar_Smooth=0.2, Bias=0.0, Brick_Width=1.2, Row_Height=0.6)
    l.new(coord.outputs['Object'], brick.inputs['Vector'])
    cloud = n.new('ShaderNodeTexNoise')
    put(cloud, Scale=2.5, Detail=8.0, Roughness=0.6)
    l.new(coord.outputs['Object'], cloud.inputs['Vector'])
    tint = n.new('ShaderNodeMix')
    tint.data_type, tint.blend_type = 'RGBA', 'MULTIPLY'
    tint.inputs[0].default_value = 0.12              # the colour sockets of a Mix node are 6, 7 → 2
    l.new(brick.outputs['Color'], tint.inputs[6])
    l.new(cloud.outputs['Color'], tint.inputs[7])
    l.new(tint.outputs[2], bsdf.inputs['Base Color'])
    rough = n.new('ShaderNodeMapRange')
    put(rough, To_Min=0.24, To_Max=0.42)
    l.new(cloud.outputs['Fac'], rough.inputs['Value'])
    l.new(rough.outputs['Result'], bsdf.inputs['Roughness'])
    bump = n.new('ShaderNodeBump')
    put(bump, Strength=0.3, Distance=0.001)
    l.new(brick.outputs['Fac'], bump.inputs['Height'])
    l.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    return m


def fabric_material(name, color, rough=0.9, sheen=0.6, weave=420.0, bump=0.15, uv=False):
    """Woven upholstery or linen: soft sheen and a fine weave in the bump."""
    m = material(name, color, rough, Sheen_Weight=sheen, Sheen_Roughness=0.45, Specular_IOR_Level=0.3)
    n, l, bsdf = nodes_of(m)
    coord = n.new('ShaderNodeTexCoord')
    tex = n.new('ShaderNodeTexNoise')
    put(tex, Scale=weave, Detail=2.0, Roughness=0.5)
    l.new(coord.outputs['UV' if uv else 'Object'], tex.inputs['Vector'])
    b = n.new('ShaderNodeBump')
    put(b, Strength=bump, Distance=0.0006)
    l.new(tex.outputs['Fac'], b.inputs['Height'])
    l.new(b.outputs['Normal'], bsdf.inputs['Normal'])
    return m


def curtain_material():
    """Heavy linen. Lets a little light through when the garden is bright behind it."""
    m = fabric_material('curtain', '#8a7967', 0.88, 0.7, weave=900.0, bump=0.2, uv=True)
    n, l, bsdf = nodes_of(m)
    out = n['Material Output']
    trans = n.new('ShaderNodeBsdfTranslucent')
    put(trans, Color=lin('#c9a982'))
    mix = n.new('ShaderNodeMixShader')
    mix.inputs['Fac'].default_value = 0.25
    l.new(bsdf.outputs['BSDF'], mix.inputs[1])
    l.new(trans.outputs['BSDF'], mix.inputs[2])
    l.new(mix.outputs['Shader'], out.inputs['Surface'])
    return m


def rug_material():
    m = fabric_material('rug', '#c4b6a2', 1.0, 0.8, weave=160.0, bump=0.5)
    n, l, bsdf = nodes_of(m)
    coord = n.new('ShaderNodeTexCoord')
    mottle = n.new('ShaderNodeTexNoise')
    put(mottle, Scale=6.0, Detail=10.0, Roughness=0.7)
    l.new(coord.outputs['Object'], mottle.inputs['Vector'])
    ramp = n.new('ShaderNodeValToRGB')
    els = ramp.color_ramp.elements
    els[0].position, els[0].color = 0.4, lin('#a89784')
    els[1].position, els[1].color = 0.62, lin('#d3c7b5')
    l.new(mottle.outputs['Fac'], ramp.inputs['Fac'])
    l.new(ramp.outputs['Color'], bsdf.inputs['Base Color'])
    return m


def glass_material():
    """Clear glazing: sees through without refraction, so daylight comes in cleanly, with a faint reflection."""
    m = bpy.data.materials.new('glass')
    n, l = m.node_tree.nodes, m.node_tree.links
    n.remove(n['Principled BSDF'])
    out = n['Material Output']
    clear, gloss = n.new('ShaderNodeBsdfTransparent'), n.new('ShaderNodeBsdfGlossy')
    put(gloss, Roughness=0.02)
    fres = n.new('ShaderNodeFresnel')
    put(fres, IOR=1.5)
    mix = n.new('ShaderNodeMixShader')
    l.new(fres.outputs['Fac'], mix.inputs['Fac'])
    l.new(clear.outputs['BSDF'], mix.inputs[1])
    l.new(gloss.outputs['BSDF'], mix.inputs[2])
    l.new(mix.outputs['Shader'], out.inputs['Surface'])
    return m


def emitter(name, color, kelvin, strength, rough=0.3):
    """A surface that glows in warm white (opal glass, a downlight lens)."""
    m = material(name, color, rough, Emission_Strength=strength)
    n, l, bsdf = nodes_of(m)
    bb = n.new('ShaderNodeBlackbody')
    put(bb, Temperature=kelvin)
    l.new(bb.outputs['Color'], bsdf.inputs['Emission Color'])
    return m


# ----------------------------------------------------------------------------- the room

def shell(M):
    """Floor, walls, ceiling with a slot along the bed wall (cove light, curtain track), the glazing."""
    t = 0.25
    box('floor', X0 - t, X1 + t, Y0 - t, 3.0, -0.2, 0.0, M['floor'])
    box('wall-left', X0 - t, X0, Y0 - t, t, -0.2, H + SLOT + 0.1, M['plaster'])
    box('wall-right', X1, X1 + t, Y0 - t, t, -0.2, H + SLOT + 0.1, M['plaster'])
    box('wall-front', X0 - t, X1 + t, Y0 - t, Y0, -0.2, H + SLOT + 0.1, M['plaster'])
    box('wall-back', X0 - t, WIN[0], 0.0, t, -0.2, H + SLOT + 0.1, M['plaster'])
    box('wall-back-r', WIN[1], X1 + t, 0.0, t, -0.2, H + SLOT + 0.1, M['plaster'])
    box('wall-head', WIN[0], WIN[1], 0.0, t, H + SLOT - 0.02, H + SLOT + 0.1, M['plaster'])
    # Ceiling: flat, with a slot along the wood wall (the cove) that widens into the curtain pocket.
    box('ceiling', X0, X1, Y0, -0.32, H, H + 0.2, M['ceiling'])
    box('ceiling-strip', X0, PANEL_END, -0.32, -0.16, H, H + 0.2, M['ceiling'])
    box('ceiling-cap', X0, X1, -0.34, 0.0, H + SLOT, H + SLOT + 0.1, M['ceiling'])
    # Outside: a stone terrace, then the garden (the sky image).
    box('terrace', X0, X1 + 8.0, t, 3.2, -0.2, -0.02, M['terrace'])
    # The glazing: two sliding panels in slim black frames.
    box('glass', WIN[0], WIN[1], 0.11, 0.115, 0.0, H + SLOT, M['glass'])
    mid = (WIN[0] + WIN[1]) / 2
    for i, (a, b) in enumerate([(WIN[0], WIN[0] + 0.045), (mid - 0.03, mid + 0.03), (WIN[1] - 0.045, WIN[1])]):
        box(f'mullion-{i}', a, b, 0.07, 0.15, 0.0, H + SLOT, M['black'])
    box('sill', WIN[0], WIN[1], 0.04, 0.16, 0.0, 0.035, M['black'])
    # A portal helps the renderer find the daylight coming through the glass.
    p = light('portal', 'AREA', (mid, 0.06, (H + SLOT) / 2), 1.0, 6500, 'day', shape='RECTANGLE',
              size=WIN[1] - WIN[0], size_y=H + SLOT)
    p.data.cycles.is_portal = True
    p.rotation_euler = (math.radians(-90), 0, 0)  # faces into the room
    # Night ambience: the faint cool light a room keeps after dark, whatever the curtain does.
    # It belongs to the daylight group, so the darkest scene still shows the room, dimly.
    light('night', 'AREA', (BED_X + 0.6, Y0 + 0.4, H - 0.05), 14.0, 9000, 'day', shape='RECTANGLE',
          size=4.5, size_y=1.5, spread=math.radians(150))


def wood_wall(M):
    """Full-height veneer panels with hairline joints, rising into the ceiling slot."""
    n, gap = 5, 0.012
    width = (PANEL_END - X0 - gap * (n - 1)) / n
    for i in range(n):
        x = X0 + i * (width + gap)
        box(f'panel-{i}', x, x + width, -0.03, 0.0, 0.012, H + SLOT, M['wood'], bevel=0.002, seg=1)
    box('panel-back', X0, PANEL_END, -0.012, 0.0, 0.0, H + SLOT, M['shadow'])


def cove(M):
    """An LED line in the slot grazes the wood wall from the top."""
    x0, x1 = X0 + 0.25, PANEL_END - 0.05
    light('cove', 'AREA', ((x0 + x1) / 2, -0.075, H + SLOT - 0.036), 60.0, 3000, 'cove',
          shape='RECTANGLE', size=x1 - x0, size_y=0.035, spread=math.radians(80))
    box('cove-channel', x0, x1, -0.11, -0.04, H + SLOT - 0.03, H + SLOT, M['black'])


def downlights(M):
    """Four recessed spots: pools of light on the bed and the floor."""
    lens = M['down-lens']
    for i, (x, y) in enumerate([(-2.1, -1.5), (0.3, -1.5), (-2.1, -4.0), (1.6, -4.0)]):
        cylinder(f'down-trim-{i}', 0.045, H - 0.004, H + 0.001, M['black'], at=(x, y))
        lo = cylinder(f'down-lens-{i}', 0.03, H - 0.006, H - 0.004, lens, at=(x, y), seg=32)
        lo.lightgroup = 'down'
        light(f'down-{i}', 'SPOT', (x, y, H - 0.02), 120.0, 3500, 'down',
              spot_size=math.radians(62), spot_blend=0.6, shadow_soft_size=0.02)


def pillow(name, sx, sy, t, mat, loc, rot, seed):
    """A filled cushion: puffed in the middle, pinched to a seam at the edges."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=2.0)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=22, use_grid_fill=True)
    for v in bm.verts:
        x, y, z = v.co
        fx, fy = max(0.0, 1 - abs(x) ** 3), max(0.0, 1 - abs(y) ** 3)
        puff = max(0.07, (fx * fy) ** 0.6)
        v.co = Vector((x * sx / 2 * (1 - 0.05 * (1 - fy)), y * sy / 2 * (1 - 0.05 * (1 - fx)), z * t / 2 * puff))
    o = obj(name, bm, mat, smooth=True)
    subdivide(o, 1)
    wrinkle(o, 0.012, 0.09, seed)
    o.location, o.rotation_euler = loc, rot
    return o


def bed(M):
    bx, x0, x1 = BED_X, BED_X - 1.025, BED_X + 1.025
    foot = -2.39
    # Floating base: upholstered platform on a recessed black plinth.
    box('bed-plinth', x0 + 0.12, x1 - 0.12, foot + 0.12, -0.2, 0.0, 0.09, M['black'])
    base = box('bed-base', x0, x1, foot, -0.14, 0.09, 0.38, M['upholstery'], bevel=0.04, seg=4)
    box('headboard', x0 - 0.05, x1 + 0.05, -0.15, -0.035, 0.3, 1.42, M['upholstery'], bevel=0.05, seg=5)
    mattress = box('mattress', x0 + 0.05, x1 - 0.05, foot + 0.06, -0.17, 0.38, 0.62, M['sheet'], bevel=0.06, seg=5)
    # Pillows lean on the headboard; two cushions in front.
    pills = []
    for i, dx in enumerate((-0.47, 0.47)):
        pills.append(pillow(f'pillow-{i}', 0.82, 0.55, 0.2, M['sheet'], (bx + dx, -0.36, 0.84),
                            (math.radians(-68), 0, math.radians(1.5 if i else -1.5)), i))
    for i, dx in enumerate((-0.34, 0.34)):
        pills.append(pillow(f'cushion-{i}', 0.55, 0.5, 0.17, M['cushion'], (bx + dx, -0.58, 0.8),
                            (math.radians(-62), 0, math.radians(-3 if i else 3)), i + 2))
    duvet = drape('duvet', (x0 - 0.27, x1 + 0.27), (foot - 0.3, -0.86), 0.66, (80, 64),
                  [base, mattress, *pills], M['duvet'], stiffness=8.0, seed=3, pin=1.0)
    drape('throw', (x0 - 0.3, x1 + 0.3), (foot - 0.12, foot + 0.5), 0.71, (72, 18),
          [base, mattress, duvet], M['throw'], stiffness=4.0, seed=5, pin=0.6)
    # Bench at the foot.
    bench_y0, bench_y1 = foot - 0.58, foot - 0.16
    box('bench-top', bx - 0.75, bx + 0.75, bench_y0, bench_y1, 0.33, 0.45, M['bench'], bevel=0.025, seg=4)
    for i, (x, y) in enumerate([(bx - 0.7, bench_y0 + 0.05), (bx + 0.7, bench_y0 + 0.05), (bx - 0.7, bench_y1 - 0.05), (bx + 0.7, bench_y1 - 0.05)]):
        box(f'bench-leg-{i}', x - 0.011, x + 0.011, y - 0.011, y + 0.011, 0.0, 0.33, M['black'], bevel=0.003, seg=1)
    return x0, x1


def drape(name, xs, ys, z, res, colliders, mat, stiffness, seed, pin):
    """Let a sheet of fabric fall onto the bed (Blender's cloth simulation), then keep the result.
    `pin` holds one line of the cloth still (a fraction of the way from ys[0] to ys[1]), as its own
    weight and a tucked edge would, so it drapes instead of sliding off the bed."""
    sc = bpy.context.scene
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=res[0], y_segments=res[1], size=0.5)
    for v in bm.verts:
        v.co = Vector((xs[0] + (v.co.x + 0.5) * (xs[1] - xs[0]), ys[0] + (v.co.y + 0.5) * (ys[1] - ys[0]), z))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    cloth = obj(name, bm, mat, smooth=True)
    held = cloth.vertex_groups.new(name='pin')
    line = ys[0] + (ys[1] - ys[0]) * pin
    step = (ys[1] - ys[0]) / res[1]
    held.add([v.index for v in cloth.data.vertices if abs(v.co.y - line) < step * 0.6], 1.0, 'REPLACE')
    for c in colliders:
        if not any(m.type == 'COLLISION' for m in c.modifiers):
            c.modifiers.new('collision', 'COLLISION')
            c.collision.thickness_outer, c.collision.cloth_friction = 0.008, 40.0
    sim = cloth.modifiers.new('cloth', 'CLOTH')
    s = sim.settings
    s.quality, s.mass = 8, 0.35
    s.tension_stiffness = s.compression_stiffness = 15.0
    s.bending_stiffness = stiffness * 0.1
    s.vertex_group_mass = 'pin'
    sim.collision_settings.distance_min = 0.006
    sim.collision_settings.use_self_collision = False
    sim.point_cache.frame_end = 40
    for f in range(1, 41):
        sc.frame_set(f)
    dg = bpy.context.evaluated_depsgraph_get()
    baked = bpy.data.meshes.new_from_object(cloth.evaluated_get(dg))
    old = cloth.data
    cloth.modifiers.clear()
    cloth.data = baked
    bpy.data.meshes.remove(old)
    sc.frame_set(1)
    baked.shade_smooth()
    sol = cloth.modifiers.new('thick', 'SOLIDIFY')
    sol.thickness, sol.offset = 0.018, 1.0
    subdivide(cloth, 1)
    wrinkle(cloth, 0.022, 0.22, seed)
    return cloth


def nightstands(M, bed_x0, bed_x1):
    tops = []
    for i, (a, b) in enumerate([(bed_x0 - 0.62, bed_x0 - 0.07), (bed_x1 + 0.07, bed_x1 + 0.62)]):
        box(f'stand-plinth-{i}', a + 0.08, b - 0.08, -0.38, -0.08, 0.0, 0.14, M['black'])
        box(f'stand-{i}', a, b, -0.46, -0.04, 0.14, 0.52, M['walnut'], bevel=0.006, seg=2)
        box(f'stand-drawer-{i}', a + 0.02, b - 0.02, -0.461, -0.455, 0.36, 0.362, M['black'])
        tops.append(((a + b) / 2, -0.25, 0.52))
    # A small stack of books, a stone bowl.
    (lx, ly, lz), (rx, ry, rz) = tops
    box('book-0', lx - 0.14, lx + 0.1, ly - 0.08, ly + 0.09, lz, lz + 0.035, M['book-a'], bevel=0.003, seg=1)
    box('book-1', lx - 0.12, lx + 0.08, ly - 0.07, ly + 0.08, lz + 0.035, lz + 0.062, M['book-b'], bevel=0.003, seg=1)
    sphere('bowl', 0.075, (rx + 0.06, ry, rz + 0.03), M['ceramic'], scale=(1, 1, 0.42))
    return tops


def pendants(M, tops):
    """Opal glass globes hanging beside the bed."""
    for i, (x, y, _) in enumerate(tops):
        y = y - 0.02
        cylinder(f'pendant-cord-{i}', 0.0025, 1.36, H, M['black'], at=(x, y), seg=12)
        cylinder(f'pendant-canopy-{i}', 0.05, H - 0.02, H, M['black'], at=(x, y))
        cylinder(f'pendant-cap-{i}', 0.022, 1.34, 1.38, M['bronze'], at=(x, y))
        g = sphere(f'pendant-{i}', 0.11, (x, y, 1.24), M['opal'])
        g.lightgroup = 'lamp'


def plant():
    """Poly Haven's potted plant (CC0), in the corner by the wood wall."""
    path = os.path.join(ASSETS, 'potted_plant_02', 'potted_plant_02_1k.blend')
    with bpy.data.libraries.load(path, link=False) as (src, dst):
        dst.objects = list(src.objects)
    for img in bpy.data.images:                       # its textures sit beside the library file
        if img.filepath.startswith('//textures'):
            img.filepath = os.path.join(os.path.dirname(path), img.filepath[2:])
    parts = [o for o in dst.objects if o is not None and o.type == 'MESH']
    root = bpy.data.objects.new('plant', None)
    bpy.context.scene.collection.objects.link(root)
    for o in parts:
        bpy.context.scene.collection.objects.link(o)
        if o.parent is None:
            o.parent = root
    bpy.context.view_layer.update()
    zs = [(o.matrix_world @ Vector(c)).z for o in parts for c in o.bound_box]
    k = 1.5 / (max(zs) - min(zs))
    root.scale = (k, k, k)
    root.location = (-2.55, -0.95, -min(zs) * k)
    root.rotation_euler.z = math.radians(35)


def fan(M):
    """A modern three-blade fan. Everything that turns hangs from the empty 'fan-rotor'."""
    cylinder('fan-canopy', 0.075, H - 0.06, H, M['bronze'], at=FAN.xy, bevel=0.01)
    cylinder('fan-rod', 0.012, FAN.z + 0.06, H - 0.06, M['bronze'], at=FAN.xy, seg=24)
    rotor = bpy.data.objects.new('fan-rotor', None)
    rotor.location = FAN
    bpy.context.scene.collection.objects.link(rotor)
    hub = cylinder('fan-hub', 0.105, -0.05, 0.05, M['bronze'], bevel=0.02)
    hub.parent = rotor
    cap = sphere('fan-cap', 0.06, (0, 0, -0.05), M['bronze'], scale=(1, 1, 0.45))
    cap.parent = rotor
    for k in range(3):
        b = blade(M['bronze'])
        b.parent = rotor
        b.rotation_euler = (math.radians(9), 0, math.radians(120 * k))  # pitch (x first), then turn into place
    return rotor


def blade(mat):
    bm = bmesh.new()
    r0, r1, steps = 0.1, 0.66, 24
    top, bot = [], []
    for i in range(steps + 1):
        s = i / steps
        x = r0 + (r1 - r0) * s
        half = 0.07 - 0.025 * s
        sweep = 0.018 * math.sin(math.pi * s)
        top.append((x, half + sweep))
        bot.append((x, -half + sweep * 0.4))
    tip = [(r1 + 0.045 * math.sin(math.pi * a / 10), (top[-1][1] + bot[-1][1]) / 2 + (top[-1][1] - bot[-1][1]) / 2 * math.cos(math.pi * a / 10)) for a in range(1, 10)]
    outline = top + tip + bot[::-1]
    verts = [bm.verts.new((x, y, 0.0)) for x, y in outline]
    face = bm.faces.new(verts)
    ext = bmesh.ops.extrude_face_region(bm, geom=[face])
    bmesh.ops.translate(bm, verts=[v for v in ext['geom'] if isinstance(v, bmesh.types.BMVert)], vec=(0, 0, 0.009))
    bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0, -0.0045))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = obj('fan-blade', bm, mat)
    bv = o.modifiers.new('bevel', 'BEVEL')
    bv.width, bv.segments, bv.limit_method, bv.harden_normals = 0.003, 2, 'ANGLE', True
    o.data.shade_smooth()
    return o


# ----------------------------------------------------------------------------- the curtain

CURTAIN_Y = -0.17
CURTAIN_OPEN, CURTAIN_CLOSED = 0.42, X1 - 0.03 - (WIN[0] - 0.1)  # how much of the track it covers
FABRIC, PLEATS = 3.0, 14


def _amplitude(span):
    """Depth of the folds that fits FABRIC metres of cloth into `span` metres of track."""
    k = 2 * math.pi * PLEATS / span
    lo, hi = 0.0, 0.3
    for _ in range(36):
        a = (lo + hi) / 2
        steps, length, px, py = 1500, 0.0, 0.0, 0.0
        for i in range(1, steps + 1):
            x = span * i / steps
            y = a * math.sin(k * x)
            length += math.hypot(x - px, y - py)
            px, py = x, y
        lo, hi = (a, hi) if length < FABRIC else (lo, a)
    return a


def set_curtain(o, s):
    """Rebuild the curtain for s: 0 = open (gathered by the right wall), 1 = closed across the glass.

    The folds belong to the cloth (they're laid out along the fabric, not the track), so as the
    curtain runs they bunch and spread like the real thing instead of sliding."""
    xr = X1 - 0.03
    span = CURTAIN_OPEN + (CURTAIN_CLOSED - CURTAIN_OPEN) * s
    a = _amplitude(span)
    cols, rows = PLEATS * 18, 56
    top, bottom = H + SLOT - 0.012, 0.012
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    grid = []
    for j in range(rows + 1):
        v = j / rows
        z = bottom + (top - bottom) * v
        low = (1 - v) ** 2                     # the hem relaxes, the heading is tight
        row = []
        for i in range(cols + 1):
            t = i / cols
            depth = a * (1 + 0.1 * math.sin(2 * math.pi * 3.1 * t + 1.7) + 0.06 * math.sin(2 * math.pi * 7.3 * t)) * (1 + 0.12 * low)
            phase = 2 * math.pi * PLEATS * t + 0.25 * low * math.sin(9.0 * t + 2.0)
            x = xr - span * t + 0.012 * low * math.sin(5.0 * t + 1.0)
            y = CURTAIN_Y + depth * math.sin(phase)
            row.append(bm.verts.new((x, y, z)))
        grid.append(row)
    for j in range(rows):
        for i in range(cols):
            f = bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
            for loop, (ii, jj) in zip(f.loops, ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))):
                loop[uv].uv = (ii / cols * FABRIC, jj / rows * (top - bottom))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        f.smooth = True
    bm.to_mesh(o.data)
    bm.free()
    o.data.update()


def curtain(M):
    me = bpy.data.meshes.new('curtain')
    o = bpy.data.objects.new('curtain', me)
    bpy.context.scene.collection.objects.link(o)
    me.materials.append(M['curtain'])
    sol = o.modifiers.new('thick', 'SOLIDIFY')
    sol.thickness, sol.offset = 0.004, 0.0
    set_curtain(o, 0.0)
    box('curtain-track', WIN[0] - 0.12, X1, CURTAIN_Y - 0.03, CURTAIN_Y + 0.03, H + SLOT - 0.02, H + SLOT, M['black'])
    return o


# ----------------------------------------------------------------------------- world, cameras

def world():
    w = bpy.data.worlds.new('garden')
    bpy.context.scene.world = w
    n, l = w.node_tree.nodes, w.node_tree.links
    bg = n['Background']
    env = n.new('ShaderNodeTexEnvironment')
    env.image = bpy.data.images.load(os.path.join(ASSETS, 'pool', 'pool_4k.hdr'))
    coord, mapping = n.new('ShaderNodeTexCoord'), n.new('ShaderNodeMapping')
    mapping.inputs['Rotation'].default_value = (0, 0, math.radians(SKY_TURN))
    l.new(coord.outputs['Generated'], mapping.inputs['Vector'])
    l.new(mapping.outputs['Vector'], env.inputs['Vector'])
    l.new(env.outputs['Color'], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = 1.0
    w.lightgroup = 'day'


def camera(name, at, lens, shift, portrait=False):
    cd = bpy.data.cameras.new(name)
    cd.lens, cd.sensor_width = lens, 36.0
    cd.sensor_fit = 'VERTICAL' if portrait else 'HORIZONTAL'
    cd.sensor_height = 36.0 if portrait else 24.0
    cd.shift_x, cd.shift_y = shift
    cd.clip_start, cd.clip_end = 0.05, 200.0
    c = bpy.data.objects.new(name, cd)
    c.location = at
    c.rotation_euler = (math.radians(90), 0, 0)  # level, looking at the bed wall: verticals stay vertical
    bpy.context.scene.collection.objects.link(c)
    return c


# ----------------------------------------------------------------------------- build

def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'
    vl = sc.view_layers[0]
    for g in GROUPS:
        vl.lightgroups.add(name=g)

    M = {
        'plaster': material('plaster', '#e3ded7', 0.92),
        'ceiling': material('ceiling', '#e9e6e0', 0.95),
        'shadow': material('shadow-gap', '#1c1915', 0.8),
        'floor': tile_material(),
        'terrace': material('terrace', '#c9bfb0', 0.7),
        'wood': wood_material(),
        'walnut': material('walnut', '#3b2a1f', 0.45, Coat_Weight=0.2),
        'black': material('black', '#171614', 0.45, Metallic=0.3),
        'bronze': material('bronze', '#2e2924', 0.38, Metallic=0.75),
        'glass': glass_material(),
        'upholstery': fabric_material('upholstery', '#8f8273', 0.92, 0.6, weave=600.0, bump=0.25),
        'sheet': fabric_material('sheet', '#ebe6de', 0.85, 0.5, weave=700.0, bump=0.12),
        'duvet': fabric_material('duvet', '#ddd5c9', 0.9, 0.5, weave=500.0, bump=0.15),
        'throw': fabric_material('throw', '#3d3631', 0.95, 0.8, weave=180.0, bump=0.4),
        'cushion': fabric_material('cushion', '#8f5a2e', 0.7, 0.9, weave=500.0, bump=0.15),
        'bench': fabric_material('bench', '#7d6e60', 0.85, 0.6, weave=500.0, bump=0.2),
        'rug': rug_material(),
        'curtain': curtain_material(),
        'book-a': material('book-a', '#cfc4b2', 0.8),
        'book-b': material('book-b', '#4a3d33', 0.8),
        'ceramic': material('ceramic', '#b9ab98', 0.5),
        'opal': emitter('opal', '#f2ece2', 2700, 9.0, 0.25),
        'down-lens': emitter('down-lens', '#f4efe6', 3500, 40.0, 0.2),
    }

    shell(M)
    wood_wall(M)
    cove(M)
    downlights(M)
    box('rug', BED_X - 1.75, BED_X + 1.75, -3.55, -0.3, 0.0, 0.014, M['rug'], bevel=0.006, seg=2)
    bed_x0, bed_x1 = bed(M)
    tops = nightstands(M, bed_x0, bed_x1)
    pendants(M, tops)
    plant()
    fan(M)
    curtain(M)
    world()
    camera('cam-wide', (-0.1, -6.4, 1.25), 24.0, (0.0, 0.02))
    camera('cam-tall', (-0.2, -6.2, 1.3), 30.0, (0.0, 0.04), portrait=True)
    sc.camera = bpy.data.objects['cam-wide']

    bpy.ops.file.pack_all()
    os.makedirs(SRC, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=BLEND, compress=True)
    print('saved', BLEND)


if __name__ == '__main__':
    build()
