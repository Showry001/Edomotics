"""The home theatre behind the homepage theatre keypad, built in code.

    blender -b --factory-startup --disable-autoexec --python scripts/theatre/build.py

Writes _src/theatre/theatre.blend. Everything is modelled here, with the bedroom's helpers
(boxes, materials, lights: scripts/room/scene.py). render.py renders the light layers from the
saved file and imports the screen's dimensions from here.

Units are metres. x runs left to right, y from the back of the room (negative) to the screen
wall (y = 0), z up from the floor.
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'room'))
import scene as kit  # noqa: E402
from scene import lin, put, material, nodes_of, obj, box, cylinder, light  # noqa: E402

SRC = os.path.join(kit.ROOT, '_src', 'theatre')
BLEND = os.path.join(SRC, 'theatre.blend')

W, D, H = 5.6, 7.8, 3.05           # the room
X0, X1, Y0 = -W / 2, W / 2, -D
SOFFIT, SOFFIT_TOP = 2.62, 2.78    # the perimeter bulkhead: underside, top
TRAY = (-2.0, 2.0, -7.1, -0.78)    # the raised star ceiling inside it: x0, x1, y0, y1
STAGE_Z, STAGE_Y = 0.2, -0.88      # the low stage along the screen wall: height, front edge
GROUPS = ('ambient', 'house', 'cove', 'stars', 'step', 'screen')

# The screen: a motorised roller in a slot in the front bulkhead. 2.39:1 picture, black borders,
# a weighted bar along the hem. It drops in front of the slatted speaker wall.
SCREEN_Y = -0.27
SLOT = (-0.33, -0.21)
VIEW_W = 3.6
VIEW_H = VIEW_W / 2.39
VIEW_Z = 0.8                       # bottom of the picture when the screen is down
BORDER = 0.05
FAB_X = VIEW_W / 2 + BORDER        # half the width of the cloth
HEM = 0.045                        # the bar
HEM_DOWN = VIEW_Z - BORDER - HEM   # the bar's underside when the screen is down

SEATS = (-0.82, 0.0, 0.82)         # three recliners, centres
SEAT_BACK = -4.78                  # where their backs are
CAM_WIDE = ((0.0, -7.25, 1.72), 24.0, (0.0, -0.06))
CAM_TALL = ((0.0, -7.25, 1.72), 30.0, (0.0, -0.02))


# ----------------------------------------------------------------------------- helpers

def rbox(name, size, at, mat, bevel=0.0, seg=4, rot=(0, 0, 0), pivot=None):
    """A box of `size` centred on `at`, turned by `rot` (radians) about `pivot` (default: its centre)."""
    sx, sy, sz = size
    o = box(name, -sx / 2, sx / 2, -sy / 2, sy / 2, -sz / 2, sz / 2, mat, bevel, seg)
    o.location = at
    if any(rot):
        o.rotation_euler = rot
        if pivot is not None:
            p, c = Vector(pivot), Vector(at)
            o.location = p + o.rotation_euler.to_matrix() @ (c - p)
    return o


def cushion(name, size, at, mat, puff=(0.0, 0.0, 0.0), cuts=5, rot=(0, 0, 0), pivot=None):
    """Upholstery: a box whose faces swell by `puff` (x, y, z) in the middle and whose edges round
    off under subdivision (fewer cuts, softer edges)."""
    sx, sy, sz = size
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=2.0)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=cuts, use_grid_fill=True)
    for v in bm.verts:
        c = v.co.copy()
        p = Vector((c.x * sx / 2, c.y * sy / 2, c.z * sz / 2))
        for a in range(3):
            if puff[a] and abs(c[a]) > 0.999:
                b, d = [i for i in range(3) if i != a]
                p[a] += math.copysign(puff[a] * (1 - c[b] ** 2) * (1 - c[d] ** 2), c[a])
        v.co = p
    o = obj(name, bm, mat, smooth=True)
    kit.subdivide(o, 2)
    o.location = at
    if any(rot):
        o.rotation_euler = rot
        if pivot is not None:
            pv, c = Vector(pivot), Vector(at)
            o.location = pv + o.rotation_euler.to_matrix() @ (c - pv)
    return o


def many_boxes(name, boxes, mat, bevel=0.0):
    """One object made of many boxes (slats, grooves): (x0, x1, y0, y1, z0, z1) each."""
    bm = bmesh.new()
    for x0, x1, y0, y1, z0, z1 in boxes:
        r = bmesh.ops.create_cube(bm, size=1.0)
        for v in r['verts']:
            v.co = Vector((x0 if v.co.x < 0 else x1, y0 if v.co.y < 0 else y1, z0 if v.co.z < 0 else z1))
    o = obj(name, bm, mat, smooth=bevel > 0)
    if bevel:
        b = o.modifiers.new('bevel', 'BEVEL')
        b.width, b.segments, b.limit_method, b.harden_normals = bevel, 1, 'ANGLE', True
    return o


def group(o, g):
    o.lightgroup = g
    return o


# ----------------------------------------------------------------------------- materials

def wood(name, dark, light_, rough=0.4):
    """Smoked oak veneer: straight vertical grain, satin."""
    m = material(name, dark, rough, Specular_IOR_Level=0.45, Coat_Weight=0.12, Coat_Roughness=0.3)
    n, l, bsdf = nodes_of(m)
    coord, info = n.new('ShaderNodeTexCoord'), n.new('ShaderNodeObjectInfo')
    offset = n.new('ShaderNodeVectorMath')
    offset.operation = 'ADD'
    scale = n.new('ShaderNodeVectorMath')
    scale.operation = 'MULTIPLY'
    scale.inputs[1].default_value = (90.0, 90.0, 1.1)
    l.new(coord.outputs['Object'], offset.inputs[0])
    l.new(info.outputs['Random'], offset.inputs[1])
    l.new(offset.outputs[0], scale.inputs[0])
    grain = n.new('ShaderNodeTexNoise')
    put(grain, Scale=1.0, Detail=8.0, Roughness=0.6, Distortion=0.2)
    l.new(scale.outputs[0], grain.inputs['Vector'])
    ramp = n.new('ShaderNodeValToRGB')
    els = ramp.color_ramp.elements
    els[0].position, els[0].color = 0.32, lin(dark)
    els[1].position, els[1].color = 0.72, lin(light_)
    l.new(grain.outputs['Fac'], ramp.inputs['Fac'])
    l.new(ramp.outputs['Color'], bsdf.inputs['Base Color'])
    bump = n.new('ShaderNodeBump')
    put(bump, Strength=0.06, Distance=0.002)
    l.new(grain.outputs['Fac'], bump.inputs['Height'])
    l.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    return m


def leather(name, color):
    """Aniline leather: soft sheen, a fine pebbled grain and a few broad creases."""
    m = material(name, color, 0.5, Specular_IOR_Level=0.5, Coat_Weight=0.2, Coat_Roughness=0.38)
    n, l, bsdf = nodes_of(m)
    coord = n.new('ShaderNodeTexCoord')
    grain = n.new('ShaderNodeTexVoronoi')
    put(grain, Scale=900.0)
    l.new(coord.outputs['Object'], grain.inputs['Vector'])
    crease = n.new('ShaderNodeTexNoise')
    put(crease, Scale=9.0, Detail=6.0, Roughness=0.55)
    l.new(coord.outputs['Object'], crease.inputs['Vector'])
    tone = n.new('ShaderNodeMix')
    tone.data_type, tone.blend_type = 'RGBA', 'MULTIPLY'
    tone.inputs[0].default_value = 0.35
    tone.inputs[6].default_value = lin(color)
    l.new(crease.outputs['Color'], tone.inputs[7])
    l.new(tone.outputs[2], bsdf.inputs['Base Color'])
    rough = n.new('ShaderNodeMapRange')
    put(rough, To_Min=0.38, To_Max=0.6)
    l.new(crease.outputs['Fac'], rough.inputs['Value'])
    l.new(rough.outputs['Result'], bsdf.inputs['Roughness'])
    b1 = n.new('ShaderNodeBump')
    put(b1, Strength=0.12, Distance=0.0004)
    l.new(grain.outputs['Distance'], b1.inputs['Height'])
    b2 = n.new('ShaderNodeBump')
    put(b2, Strength=0.08, Distance=0.004)
    l.new(crease.outputs['Fac'], b2.inputs['Height'])
    l.new(b1.outputs['Normal'], b2.inputs['Normal'])
    l.new(b2.outputs['Normal'], bsdf.inputs['Normal'])
    return m


def carpet_material():
    m = kit.fabric_material('carpet', '#2b2420', 1.0, 0.7, weave=260.0, bump=0.45)
    n, l, bsdf = nodes_of(m)
    coord = n.new('ShaderNodeTexCoord')
    mottle = n.new('ShaderNodeTexNoise')
    put(mottle, Scale=5.0, Detail=10.0, Roughness=0.7)
    l.new(coord.outputs['Object'], mottle.inputs['Vector'])
    ramp = n.new('ShaderNodeValToRGB')
    els = ramp.color_ramp.elements
    els[0].position, els[0].color = 0.38, lin('#221c19')
    els[1].position, els[1].color = 0.64, lin('#352c27')
    l.new(mottle.outputs['Fac'], ramp.inputs['Fac'])
    l.new(ramp.outputs['Color'], bsdf.inputs['Base Color'])
    return m


def stars_material():
    """A black fabric ceiling with fibre-optic ends: a point in most cells of a jittered grid, each
    its own size, brightness and warmth. It never lights the room, so it isn't sampled as a lamp."""
    m = material('star-ceiling', '#141315', 0.95, Sheen_Weight=0.4)
    m.cycles.emission_sampling = 'NONE'
    n, l, bsdf = nodes_of(m)
    coord = n.new('ShaderNodeTexCoord')
    vor = n.new('ShaderNodeTexVoronoi')
    vor.voronoi_dimensions = '2D'
    put(vor, Scale=7.0, Randomness=1.0)
    l.new(coord.outputs['Object'], vor.inputs['Vector'])
    sep = n.new('ShaderNodeSeparateColor')
    l.new(vor.outputs['Color'], sep.inputs['Color'])
    # radius: 0.014–0.03 of a cell (a cell is ~14 cm, so 2–4 mm)
    r = n.new('ShaderNodeMapRange')
    put(r, To_Min=0.014, To_Max=0.03)
    l.new(sep.outputs['Red'], r.inputs['Value'])
    dot = n.new('ShaderNodeMath')
    dot.operation = 'LESS_THAN'
    l.new(vor.outputs['Distance'], dot.inputs[0])
    l.new(r.outputs['Result'], dot.inputs[1])
    keep = n.new('ShaderNodeMath')                 # half the cells stay dark
    keep.operation = 'GREATER_THAN'
    keep.inputs[1].default_value = 0.5
    l.new(sep.outputs['Blue'], keep.inputs[0])
    bright = n.new('ShaderNodeMath')               # most stars faint, a few bright
    bright.operation = 'POWER'
    bright.inputs[1].default_value = 3.0
    l.new(sep.outputs['Green'], bright.inputs[0])
    lift = n.new('ShaderNodeMath')
    lift.operation = 'MULTIPLY_ADD'
    lift.inputs[1].default_value = 0.85
    lift.inputs[2].default_value = 0.15
    l.new(bright.outputs[0], lift.inputs[0])
    a = n.new('ShaderNodeMath')
    a.operation = 'MULTIPLY'
    l.new(dot.outputs[0], a.inputs[0])
    l.new(keep.outputs[0], a.inputs[1])
    s = n.new('ShaderNodeMath')
    s.operation = 'MULTIPLY'
    s.inputs[1].default_value = 180.0
    l.new(a.outputs[0], s.inputs[0])
    s2 = n.new('ShaderNodeMath')
    s2.operation = 'MULTIPLY'
    l.new(s.outputs[0], s2.inputs[0])
    l.new(lift.outputs[0], s2.inputs[1])
    temp = n.new('ShaderNodeMapRange')
    put(temp, To_Min=3800.0, To_Max=6500.0)
    l.new(sep.outputs['Red'], temp.inputs['Value'])
    bb = n.new('ShaderNodeBlackbody')
    l.new(temp.outputs['Result'], bb.inputs['Temperature'])
    l.new(bb.outputs['Color'], bsdf.inputs['Emission Color'])
    l.new(s2.outputs[0], bsdf.inputs['Emission Strength'])
    return m


def screen_material():
    """Matte white projection cloth (gain 1). The picture is its glow, in its own light group."""
    m = material('screen-white', '#e9e8e5', 1.0, Specular_IOR_Level=0.1, Emission_Strength=1.0)
    n, l, bsdf = nodes_of(m)
    put(bsdf, Emission_Color=(1.0, 1.0, 1.0, 1.0))
    m.cycles.emission_sampling = 'FRONT'
    return m


# ----------------------------------------------------------------------------- the room

def shell(M):
    t = 0.25
    box('floor', X0 - t, X1 + t, Y0 - t, t, -0.2, 0.0, M['carpet'])
    box('wall-left', X0 - t, X0, Y0 - t, t, -0.2, H + 0.1, M['panel-back'])
    box('wall-right', X1, X1 + t, Y0 - t, t, -0.2, H + 0.1, M['panel-back'])
    box('wall-front', X0 - t, X1 + t, 0.0, t, -0.2, H + 0.1, M['felt'])
    box('wall-back', X0 - t, X1 + t, Y0 - t, Y0, -0.2, H + 0.1, M['panel-back'])
    box('ceiling', X0, X1, Y0, 0.0, H, H + 0.2, M['ceiling'])
    tx0, tx1, ty0, ty1 = TRAY
    tray = group(box('tray', tx0, tx1, ty0, ty1, H - 0.01, H, M['stars']), 'stars')
    # The fibre ends are seen, not felt: their light on the room is too faint to show and would
    # only come back as speckle, so rays from other surfaces pass by them.
    tray.visible_diffuse = tray.visible_glossy = tray.visible_transmission = tray.visible_volume_scatter = False
    # The bulkhead around it: a ring at SOFFIT, with the screen's slot in the front run.
    box('soffit-left', X0, tx0, Y0, 0.0, SOFFIT, SOFFIT_TOP, M['ceiling'])
    box('soffit-right', tx1, X1, Y0, 0.0, SOFFIT, SOFFIT_TOP, M['ceiling'])
    box('soffit-back', tx0, tx1, Y0, ty0, SOFFIT, SOFFIT_TOP, M['ceiling'])
    box('soffit-front-a', tx0, tx1, ty1, SLOT[0], SOFFIT, SOFFIT_TOP, M['ceiling'])
    box('soffit-front-b', tx0, tx1, SLOT[1], 0.0, SOFFIT, SOFFIT_TOP, M['ceiling'])
    box('slot', tx0, tx1, SLOT[0], SLOT[1], SOFFIT_TOP - 0.06, SOFFIT_TOP, M['black'])
    box('slot-l', tx0, -FAB_X - 0.06, SLOT[0], SLOT[1], SOFFIT, SOFFIT_TOP, M['ceiling'])
    box('slot-r', FAB_X + 0.06, tx1, SLOT[0], SLOT[1], SOFFIT, SOFFIT_TOP, M['ceiling'])
    # Upstands along the inner edge hide the cove's LED line.
    lip = 0.07
    box('lip-left', tx0, tx0 + 0.03, ty0, ty1, SOFFIT_TOP, SOFFIT_TOP + lip, M['ceiling'])
    box('lip-right', tx1 - 0.03, tx1, ty0, ty1, SOFFIT_TOP, SOFFIT_TOP + lip, M['ceiling'])
    box('lip-back', tx0, tx1, ty0, ty0 + 0.03, SOFFIT_TOP, SOFFIT_TOP + lip, M['ceiling'])
    box('lip-front', tx0, tx1, ty1 - 0.03, ty1, SOFFIT_TOP, SOFFIT_TOP + lip, M['ceiling'])
    # Ambient: what a dark room keeps (an exit light, a standby glow). Always on, very dim.
    light('ambient', 'AREA', (0.0, Y0 + 0.5, SOFFIT - 0.05), 3.0, 7000, 'ambient', shape='RECTANGLE',
          size=3.0, size_y=0.6, spread=math.radians(140))


def cove(M):
    """LED lines on the bulkhead, behind the upstands, washing the star ceiling."""
    tx0, tx1, ty0, ty1 = TRAY
    z = SOFFIT_TOP + 0.015
    runs = [
        ('cove-left', (tx0 - 0.07, (ty0 + ty1) / 2, z), ty1 - ty0, (0, math.radians(-150), 0), 0.03, ty1 - ty0),
        ('cove-right', (tx1 + 0.07, (ty0 + ty1) / 2, z), ty1 - ty0, (0, math.radians(150), 0), 0.03, ty1 - ty0),
        ('cove-back', (0.0, ty0 - 0.07, z), tx1 - tx0, (math.radians(150), 0, 0), tx1 - tx0, 0.03),
        ('cove-front', (0.0, ty1 + 0.07, z), tx1 - tx0, (math.radians(-150), 0, 0), tx1 - tx0, 0.03),
    ]
    for name, at, length, rot, sx, sy in runs:
        o = light(name, 'AREA', at, 9.0 * length, 2700, 'cove', shape='RECTANGLE', size=sx, size_y=sy,
                  spread=math.radians(110))
        o.rotation_euler = rot


def downlights(M):
    """Wall-washers in the side bulkheads; three pinholes over the seats."""
    for side in (-1, 1):
        x = side * (W / 2 - 0.38)
        for i, y in enumerate((-6.2, -4.7, -3.2, -1.7)):
            cylinder(f'wash-trim-{side}-{i}', 0.04, SOFFIT - 0.004, SOFFIT + 0.001, M['black'], at=(x, y))
            group(cylinder(f'wash-lens-{side}-{i}', 0.026, SOFFIT - 0.006, SOFFIT - 0.004, M['lens'], at=(x, y), seg=32), 'house')
            o = light(f'wash-{side}-{i}', 'SPOT', (x, y, SOFFIT - 0.02), 70.0, 3000, 'house',
                      spot_size=math.radians(70), spot_blend=0.7, shadow_soft_size=0.02)
            o.rotation_euler = (0, math.radians(-14 * side), 0)       # toward the wall
    # Pinholes in the star ceiling: one over each seat, one over the walkway behind it.
    for i, x in enumerate(SEATS):
        for j, (y, power) in enumerate(((SEAT_BACK + 0.55, 45.0), (SEAT_BACK - 0.45, 40.0))):
            cylinder(f'pin-trim-{i}-{j}', 0.03, H - 0.014, H - 0.009, M['black'], at=(x, y))
            group(cylinder(f'pin-lens-{i}-{j}', 0.016, H - 0.016, H - 0.014, M['lens'], at=(x, y), seg=24), 'house')
            light(f'pin-{i}-{j}', 'SPOT', (x, y, H - 0.03), power, 2900, 'house',
                  spot_size=math.radians(40), spot_blend=0.6, shadow_soft_size=0.015)


def stage(M):
    """A low carpeted stage along the screen wall, its nosing lit from below."""
    box('stage', X0, X1, STAGE_Y, 0.0, 0.0, STAGE_Z, M['carpet'])
    box('stage-nose', X0, X1, STAGE_Y - 0.025, STAGE_Y + 0.02, 0.035, STAGE_Z + 0.008, M['oak'], bevel=0.004, seg=2)
    group(box('stage-led', X0 + 0.05, X1 - 0.05, STAGE_Y - 0.02, STAGE_Y + 0.01, 0.028, 0.033, M['led']), 'step')
    o = light('stage-glow', 'AREA', (0.0, STAGE_Y - 0.01, 0.03), 26.0, 2700, 'step', shape='RECTANGLE',
              size=W - 0.1, size_y=0.02, spread=math.radians(120))
    o.rotation_euler = (math.radians(-20), 0, 0)


def speaker_wall(M):
    """Vertical oak slats on black felt, floor to bulkhead; two towers and a centre speaker."""
    slats, x, w, gap = [], X0 + 0.02, 0.034, 0.018
    while x + w < X1 - 0.02:
        slats.append((x, x + w, -0.05, -0.004, STAGE_Z, SOFFIT))
        x += w + gap
    many_boxes('slats', slats, M['oak'], bevel=0.002)
    # An LED line in the bulkhead behind the screen's slot grazes the slats from the top.
    o = light('graze', 'AREA', (0.0, -0.12, SOFFIT - 0.006), 70.0, 2700, 'cove', shape='RECTANGLE',
              size=W - 0.5, size_y=0.025, spread=math.radians(70))
    o.rotation_euler = (math.radians(14), 0, 0)      # toward the wall
    box('graze-channel', -W / 2 + 0.25, W / 2 - 0.25, -0.15, -0.09, SOFFIT - 0.004, SOFFIT + 0.001, M['black'])
    for side in (-1, 1):
        cx = side * 2.28
        rbox(f'tower-{side}', (0.34, 0.4, 1.3), (cx, -0.48, STAGE_Z + 0.65), M['walnut'], bevel=0.012, seg=3)
        box(f'tower-grille-{side}', cx - 0.15, cx + 0.15, -0.69, -0.675, STAGE_Z + 0.06, STAGE_Z + 1.24, M['grille'])
        box(f'tower-foot-{side}', cx - 0.13, cx + 0.13, -0.62, -0.34, STAGE_Z, STAGE_Z + 0.02, M['black'])
    rbox('centre', (1.0, 0.32, 0.26), (0.0, -0.5, STAGE_Z + 0.16), M['walnut'], bevel=0.012, seg=3)
    box('centre-grille', -0.47, 0.47, -0.67, -0.655, STAGE_Z + 0.05, STAGE_Z + 0.27, M['grille'])


def side_walls(M):
    """Upholstered panels between oak pilasters; a sconce on each pilaster; step lights low down."""
    pil = (-6.15, -4.6, -3.05, -1.5)
    for side in (-1, 1):
        wall = side * W / 2
        inward = -side
        def xs(a, b):
            lo, hi = wall + inward * a, wall + inward * b
            return min(lo, hi), max(lo, hi)
        edges = [Y0] + [e for p in pil for e in (p - 0.11, p + 0.11)] + [0.0]
        for i in range(0, len(edges), 2):
            a, b = edges[i] + 0.006, edges[i + 1] - 0.006
            for j, (z0, z1) in enumerate(((0.12, 1.02), (1.03, SOFFIT - 0.006))):
                box(f'panel-{side}-{i}-{j}', *xs(0.0, 0.055), a, b, z0, z1, M['panel'], bevel=0.018, seg=3)
            box(f'skirt-{side}-{i}', *xs(0.0, 0.035), a, b, 0.0, 0.11, M['black'])
        for k, y in enumerate(pil):
            box(f'pilaster-{side}-{k}', *xs(0.0, 0.085), y - 0.11, y + 0.11, 0.0, SOFFIT, M['oak'], bevel=0.004, seg=2)
            sconce(M, side, wall + inward * 0.085, y, k)
        for k, y in enumerate((-5.38, -3.83, -2.28)):
            x = wall + inward * 0.056
            box(f'step-plate-{side}-{k}', *sorted((x, x + inward * 0.006)), y - 0.06, y + 0.06, 0.29, 0.35, M['black'])
            group(box(f'step-lens-{side}-{k}', *sorted((x + inward * 0.006, x + inward * 0.008)), y - 0.045, y + 0.045, 0.295, 0.31, M['led']), 'step')
            o = light(f'step-{side}-{k}', 'SPOT', (x + inward * 0.03, y, 0.3), 3.0, 2700, 'step',
                      spot_size=math.radians(120), spot_blend=1.0, shadow_soft_size=0.02)
            o.rotation_euler = (0, math.radians(-35 * inward), 0)   # down, into the aisle


def sconce(M, side, x, y, k):
    """A slim bronze sconce throwing a scallop up and down the oak."""
    inward = -side
    body_x = sorted((x, x + inward * 0.06))
    box(f'sconce-{side}-{k}', *body_x, y - 0.035, y + 0.035, 1.66, 1.94, M['bronze'], bevel=0.006, seg=2)
    for end, z, rot in (('up', 1.945, math.pi), ('down', 1.655, 0.0)):
        group(box(f'sconce-glow-{end}-{side}-{k}', body_x[0] + 0.006, body_x[1] - 0.006, y - 0.028, y + 0.028,
                  z - 0.003, z + 0.003, M['lamp']), 'cove')
        o = light(f'sconce-{end}-{side}-{k}', 'SPOT', (x + inward * 0.03, y, z), 9.0, 2700, 'cove',
                  spot_size=math.radians(56), spot_blend=0.85, shadow_soft_size=0.012)
        o.rotation_euler = (rot, 0, 0)


def recliners(M):
    """A row of three leather recliners, joined by arms with lit cup holders; a glow beneath."""
    yb, depth = SEAT_BACK, 0.95
    yf = yb + depth
    seat_w, arm_w = 0.62, 0.2
    arms = sorted({round(x + s * (seat_w + arm_w) / 2, 3) for x in SEATS for s in (-1, 1)})
    for i, x in enumerate(SEATS):
        L = M['leather']
        cushion(f'seat-base-{i}', (seat_w, depth - 0.1, 0.32), (x, yb + depth / 2 + 0.02, 0.26), L, (0.0, 0.01, 0.0), 4)
        cushion(f'seat-cushion-{i}', (seat_w - 0.03, depth - 0.32, 0.13), (x, yb + 0.21 + (depth - 0.32) / 2, 0.47), L,
                (0.0, 0.0, 0.035), 3)
        # The back: a shell that swells at the back and rounds over the top, reclined a little,
        # with a headrest roll and a lumbar cushion on the seat side.
        tilt = (math.radians(12), 0, 0)              # leans back, toward the camera
        piv = (x, yb + 0.13, 0.42)
        cushion(f'seat-back-{i}', (seat_w + 0.03, 0.24, 0.7), (x, yb + 0.13, 0.42 + 0.35), L, (0.012, 0.04, 0.03), 4,
                rot=tilt, pivot=piv)
        cushion(f'seat-head-{i}', (seat_w - 0.04, 0.2, 0.2), (x, yb + 0.22, 1.02), L, (0.0, 0.04, 0.03), 3,
                rot=tilt, pivot=piv)
        cushion(f'seat-lumbar-{i}', (seat_w - 0.05, 0.16, 0.34), (x, yb + 0.25, 0.68), L, (0.0, 0.04, 0.0), 3,
                rot=tilt, pivot=piv)
    for i, x in enumerate(arms):
        cushion(f'arm-{i}', (arm_w, depth - 0.06, 0.56), (x, yb + depth / 2 - 0.01, 0.38), M['leather'], (0.012, 0.0, 0.025), 4)
        cy = yf - 0.2
        cylinder(f'cup-{i}', 0.042, 0.6, 0.665, M['black'], at=(x, cy), seg=40)
        group(cylinder(f'cup-ring-{i}', 0.047, 0.661, 0.664, M['led'], at=(x, cy), seg=40), 'step')
        cylinder(f'cup-in-{i}', 0.04, 0.62, 0.6655, M['black'], at=(x, cy), seg=40)
    # A recessed plinth, with an LED line under the overhang all round: the row floats on a glow.
    x0, x1 = arms[0] - arm_w / 2, arms[-1] + arm_w / 2
    p0, p1, q0, q1 = x0 + 0.06, x1 - 0.06, yb + 0.08, yf - 0.1
    box('row-plinth', p0, p1, q0, q1, 0.0, 0.1, M['black'])
    for name, at, sx, sy, power in (('back', (0.0, q0 - 0.02, 0.095), p1 - p0, 0.02, 9.0),
                                    ('front', (0.0, q1 + 0.02, 0.095), p1 - p0, 0.02, 9.0),
                                    ('left', (p0 - 0.02, (q0 + q1) / 2, 0.095), 0.02, q1 - q0, 3.0),
                                    ('right', (p1 + 0.02, (q0 + q1) / 2, 0.095), 0.02, q1 - q0, 3.0)):
        light(f'row-glow-{name}', 'AREA', at, power, 2700, 'step', shape='RECTANGLE', size=sx, size_y=sy,
              spread=math.radians(150))


def screen(M):
    """The cloth (black borders, white picture), the bar, and the roller's housing in the slot."""
    z_top = SOFFIT + 0.002
    box('screen-cloth', -FAB_X, FAB_X, SCREEN_Y - 0.002, SCREEN_Y, VIEW_Z - BORDER, z_top, M['velvet'])
    group(box('screen-picture', -VIEW_W / 2, VIEW_W / 2, SCREEN_Y - 0.0035, SCREEN_Y - 0.002, VIEW_Z, VIEW_Z + VIEW_H,
              M['screen']), 'screen')
    box('screen-bar', -FAB_X, FAB_X, SCREEN_Y - 0.014, SCREEN_Y + 0.012, HEM_DOWN, HEM_DOWN + HEM, M['black'], bevel=0.006, seg=2)
    cylinder('screen-roller', 0.05, -FAB_X, FAB_X, M['black'])
    r = bpy.data.objects['screen-roller']
    r.rotation_euler = (0, math.radians(90), 0)
    r.location = (0, (SLOT[0] + SLOT[1]) / 2, SOFFIT_TOP + 0.06)


def set_screen(down):
    """Up: rolled into the slot, the bar flush with the bulkhead. Down: the picture at VIEW_Z."""
    for name in ('screen-cloth', 'screen-picture'):
        bpy.data.objects[name].hide_render = not down
    bar = bpy.data.objects['screen-bar']
    bar.location.z = 0.0 if down else (SOFFIT - HEM) - HEM_DOWN


# ----------------------------------------------------------------------------- cameras

def camera(name, spec, portrait=False):
    at, lens, shift = spec
    cd = bpy.data.cameras.new(name)
    cd.lens, cd.sensor_width = lens, 36.0
    cd.sensor_fit = 'VERTICAL' if portrait else 'HORIZONTAL'
    cd.sensor_height = 36.0 if portrait else 24.0
    cd.shift_x, cd.shift_y = shift
    cd.clip_start, cd.clip_end = 0.05, 100.0
    c = bpy.data.objects.new(name, cd)
    c.location = at
    c.rotation_euler = (math.radians(90), 0, 0)   # level and square to the screen
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
        'carpet': carpet_material(),
        'felt': material('felt', '#0d0c0b', 1.0, Sheen_Weight=0.5),
        'ceiling': material('ceiling', '#1d1b1a', 0.95),
        'stars': stars_material(),
        'black': material('black', '#121110', 0.45, Metallic=0.3),
        'oak': wood('oak', '#3a2a1e', '#6a4c34', 0.42),
        'walnut': wood('walnut', '#22170f', '#3d2a1c', 0.3),
        'grille': kit.fabric_material('grille', '#151413', 1.0, 0.4, weave=1400.0, bump=0.2),
        'panel': kit.fabric_material('panel', '#5b4c41', 0.95, 0.6, weave=700.0, bump=0.2),
        'panel-back': material('panel-back', '#2a2420', 0.95),
        'bronze': material('bronze', '#3a3027', 0.35, Metallic=0.8),
        'leather': leather('leather', '#6a4630'),
        'velvet': material('velvet', '#060606', 1.0, Sheen_Weight=0.3),
        'screen': screen_material(),
        'lens': kit.emitter('lens', '#f4efe6', 3000, 30.0, 0.2),
        'led': kit.emitter('led', '#f4e6d0', 2700, 6.0, 0.3),
        'lamp': kit.emitter('lamp', '#f4e6d0', 2700, 12.0, 0.3),
    }

    shell(M)
    cove(M)
    downlights(M)
    stage(M)
    speaker_wall(M)
    side_walls(M)
    recliners(M)
    screen(M)
    set_screen(False)
    w = bpy.data.worlds.new('dark')
    w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.0
    sc.world = w
    camera('cam-wide', CAM_WIDE)
    camera('cam-tall', CAM_TALL, portrait=True)
    sc.camera = bpy.data.objects['cam-wide']

    os.makedirs(SRC, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=BLEND, compress=True)
    print('saved', BLEND)


if __name__ == '__main__':
    build()
