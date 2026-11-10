"""The film on the theatre's screen: a slow push over the sea at sunset, made in Blender.

    blender -b --factory-startup --disable-autoexec --python scripts/theatre/film.py -- still [frame]
    blender -b --factory-startup --disable-autoexec --python scripts/theatre/film.py -- frames [samples] [first last]

2.39:1 at 1280 × 536, 24 fps. `frames` writes FRAMES pictures to _src/theatre/film/; media.mjs
joins them into a 10 s loop (the last second dissolves into the first), and export.py takes a
frame from it for the stills. Original footage: nothing here comes from anywhere else.
"""
import math
import os
import sys

import bpy
from mathutils import Euler, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(ROOT, '_src', 'theatre', 'film')
PREVIEW = os.path.join(ROOT, '_src', 'theatre', 'preview')
FPS, FRAMES = 24, 264                 # 11 s: 10 s of film plus the second that dissolves into it
SUN = (math.radians(2.6), math.radians(4.0))   # elevation, and how far right of straight ahead
SPEED = 0.9                           # metres a second, low over the water


def lin(hexstr):
    h = hexstr.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((v + 0.055) / 1.055) ** 2.4 if v > 0.04045 else v / 12.92 for v in c) + (1.0,)


def water():
    m = bpy.data.materials.new('sea')
    n, l = m.node_tree.nodes, m.node_tree.links
    bsdf = n['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = lin('#0b1b22')
    bsdf.inputs['Roughness'].default_value = 0.06
    bsdf.inputs['IOR'].default_value = 1.33
    bsdf.inputs['Specular IOR Level'].default_value = 0.6
    # Ripples on top of the swell, moving with time (the w of a 4D noise).
    coord = n.new('ShaderNodeTexCoord')
    noise = n.new('ShaderNodeTexNoise')
    noise.noise_dimensions = '4D'
    noise.inputs['Scale'].default_value = 7.0
    noise.inputs['Detail'].default_value = 12.0
    noise.inputs['Roughness'].default_value = 0.6
    fc = noise.inputs['W'].driver_add('default_value')
    fc.driver.expression = 'frame / 60'
    l.new(coord.outputs['Object'], noise.inputs['Vector'])
    bump = n.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.35
    bump.inputs['Distance'].default_value = 0.03
    l.new(noise.outputs['Fac'], bump.inputs['Height'])
    l.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    return m


def clouds():
    """A high, thin layer of streaky cloud, lit from below by the low sun."""
    me = bpy.data.meshes.new('clouds')
    me.from_pydata([(-40000, -2000, 1400), (40000, -2000, 1400), (40000, 60000, 1400), (-40000, 60000, 1400)], [], [(0, 1, 2, 3)])
    o = bpy.data.objects.new('clouds', me)
    bpy.context.scene.collection.objects.link(o)
    m = bpy.data.materials.new('cloud')
    me.materials.append(m)
    n, l = m.node_tree.nodes, m.node_tree.links
    out = n['Material Output']
    n.remove(n['Principled BSDF'])
    coord = n.new('ShaderNodeTexCoord')
    stretch = n.new('ShaderNodeMapping')
    stretch.inputs['Scale'].default_value = (0.00035, 0.0009, 1.0)    # bands across the sky
    l.new(coord.outputs['Object'], stretch.inputs['Vector'])
    noise = n.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 1.0
    noise.inputs['Detail'].default_value = 12.0
    noise.inputs['Roughness'].default_value = 0.62
    noise.inputs['Distortion'].default_value = 0.4
    l.new(stretch.outputs['Vector'], noise.inputs['Vector'])
    ramp = n.new('ShaderNodeValToRGB')
    els = ramp.color_ramp.elements
    els[0].position, els[0].color = 0.54, (0, 0, 0, 1)
    els[1].position, els[1].color = 0.8, (1, 1, 1, 1)
    l.new(noise.outputs['Fac'], ramp.inputs['Fac'])
    diff, trans, clear = n.new('ShaderNodeBsdfDiffuse'), n.new('ShaderNodeBsdfTranslucent'), n.new('ShaderNodeBsdfTransparent')
    diff.inputs['Color'].default_value = (1.0, 0.92, 0.9, 1)
    trans.inputs['Color'].default_value = (1.0, 0.78, 0.55, 1)
    body = n.new('ShaderNodeMixShader')
    body.inputs['Fac'].default_value = 0.5
    l.new(diff.outputs['BSDF'], body.inputs[1])
    l.new(trans.outputs['BSDF'], body.inputs[2])
    mix = n.new('ShaderNodeMixShader')
    l.new(ramp.outputs['Color'], mix.inputs['Fac'])
    l.new(clear.outputs['BSDF'], mix.inputs[1])
    l.new(body.outputs['Shader'], mix.inputs[2])
    l.new(mix.outputs['Shader'], out.inputs['Surface'])


def glow(sc):
    """A soft bloom around the sun, the way a lens sees it."""
    ng = bpy.data.node_groups.new('film', 'CompositorNodeTree')
    sc.compositing_node_group = ng
    sc.render.use_compositing = True
    rl = ng.nodes.new('CompositorNodeRLayers')
    g = ng.nodes.new('CompositorNodeGlare')
    for k, v in (('Type', 'Bloom'), ('Quality', 'High'), ('Threshold', 0.8), ('Size', 0.6), ('Strength', 0.35), ('Saturation', 1.0)):
        if k in g.inputs:
            try:
                g.inputs[k].default_value = v
            except (TypeError, ValueError):
                pass
    out = ng.nodes.new('NodeGroupOutput') if hasattr(ng, 'interface') else ng.nodes.new('CompositorNodeComposite')
    if out.bl_idname == 'NodeGroupOutput':
        ng.interface.new_socket('Image', in_out='OUTPUT', socket_type='NodeSocketColor')
    ng.links.new(rl.outputs['Image'], g.inputs['Image'])
    ng.links.new(g.outputs['Image'], out.inputs[0])


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.fps = FPS
    sc.frame_start, sc.frame_end = 1, FRAMES

    sea = water()
    # The swell near the camera: an animated ocean, tiled; flat rippled water beyond it.
    me = bpy.data.meshes.new('ocean')
    ocean = bpy.data.objects.new('ocean', me)
    sc.collection.objects.link(ocean)
    me.materials.append(sea)
    mod = ocean.modifiers.new('ocean', 'OCEAN')
    mod.geometry_mode = 'GENERATE'
    mod.resolution, mod.viewport_resolution = 14, 4
    mod.spatial_size, mod.repeat_x, mod.repeat_y = 60, 12, 12
    mod.wave_scale, mod.choppiness, mod.wind_velocity = 1.1, 1.15, 9.0
    mod.wave_alignment, mod.wave_direction, mod.damping = 0.4, math.radians(80), 0.5
    mod.use_normals = True
    fc = mod.driver_add('time')
    fc.driver.expression = 'frame / 24'
    # The swell repeats every tile; turned at an angle, the repeats line up away from the camera's
    # vanishing point instead of on it. The generated grid starts half a tile behind its origin.
    turn = math.radians(33)
    ocean.rotation_euler = (0, 0, turn)
    half = mod.spatial_size * mod.repeat_x / 2 - mod.spatial_size / 2
    centre = Euler((0, 0, turn)).to_matrix() @ Vector((half, half, 0))
    ocean.location = Vector((0.0, 330.0, 0.0)) - centre
    bpy.ops.object.select_all(action='DESELECT')
    for p in me.polygons:
        p.use_smooth = True
    far = bpy.data.meshes.new('far')
    far.from_pydata([(-30000, -100, -1.0), (30000, -100, -1.0), (30000, 40000, -1.0), (-30000, 40000, -1.0)], [], [(0, 1, 2, 3)])
    fo = bpy.data.objects.new('far', far)
    sc.collection.objects.link(fo)
    far.materials.append(sea)

    # Sky and sun: a physical sky low in the west, and a sun lamp for the path of light on the water.
    w = bpy.data.worlds.new('sky')
    sc.world = w
    nt = w.node_tree
    sky = nt.nodes.new('ShaderNodeTexSky')
    sky.sky_type = 'MULTIPLE_SCATTERING'
    sky.sun_elevation, sky.sun_rotation = SUN[0], SUN[1]
    sky.sun_size, sky.sun_intensity = math.radians(1.3), 0.004
    sky.altitude, sky.air_density, sky.aerosol_density, sky.ozone_density = 20.0, 1.2, 3.2, 1.0
    nt.links.new(sky.outputs['Color'], nt.nodes['Background'].inputs['Color'])
    nt.nodes['Background'].inputs['Strength'].default_value = 0.05
    clouds()
    sd = bpy.data.lights.new('sun', 'SUN')
    sd.energy, sd.angle = 1.6, math.radians(1.3)
    sd.use_temperature, sd.temperature = True, 2600
    sun = bpy.data.objects.new('sun', sd)
    sc.collection.objects.link(sun)
    # Light travels along -Z of the lamp: point it from the sun toward the camera.
    d = Vector((math.sin(SUN[1]) * math.cos(SUN[0]), math.cos(SUN[1]) * math.cos(SUN[0]), math.sin(SUN[0])))
    sun.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()

    cd = bpy.data.cameras.new('cam')
    cd.lens, cd.sensor_width, cd.sensor_fit = 70.0, 36.0, 'HORIZONTAL'
    cd.shift_y = 0.04
    cd.clip_start, cd.clip_end = 0.1, 200000.0
    cam = bpy.data.objects.new('cam', cd)
    sc.collection.objects.link(cam)
    cam.rotation_euler = Euler((math.radians(90.4), 0, 0))
    y0 = 0.0
    bpy.context.preferences.edit.keyframe_new_interpolation_type = 'LINEAR'   # a steady glide
    cam.location = (0.0, y0, 2.3)
    cam.keyframe_insert('location', frame=1)
    cam.location = (0.0, y0 + SPEED * FRAMES / FPS, 2.3)
    cam.keyframe_insert('location', frame=FRAMES)
    sc.camera = cam
    return sc


def setup(sc, samples, percent=100):
    sc.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    for dev in prefs.devices:
        dev.use = dev.type == 'METAL'
    c = sc.cycles
    c.device, c.samples = 'GPU', samples
    c.use_adaptive_sampling, c.adaptive_threshold = True, 0.01
    c.use_denoising, c.denoiser = True, 'OPENIMAGEDENOISE'
    c.max_bounces, c.glossy_bounces = 6, 4
    c.caustics_reflective = c.caustics_refractive = False
    c.sample_clamp_indirect = 8.0
    sc.render.resolution_x, sc.render.resolution_y = 1280, 536
    sc.render.resolution_percentage = percent
    vs = sc.view_settings
    vs.view_transform = 'AgX'
    try:
        vs.look = 'AgX - Medium High Contrast'
    except TypeError:
        vs.look = 'None'
    vs.exposure = 0.0
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGB'
    glow(sc)


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    job = args[0] if args else ''
    sc = build()
    if job == 'still':
        setup(sc, 64)
        sc.frame_set(int(args[1]) if len(args) > 1 else 120)
        os.makedirs(PREVIEW, exist_ok=True)
        sc.render.filepath = os.path.join(PREVIEW, 'film.png')
        bpy.ops.render.render(write_still=True)
        print('wrote', sc.render.filepath)
    elif job == 'frames':
        setup(sc, int(args[1]) if len(args) > 1 else 64)
        if len(args) > 3:
            sc.frame_start, sc.frame_end = int(args[2]), int(args[3])
        os.makedirs(OUT, exist_ok=True)
        sc.render.filepath = os.path.join(OUT, '')
        bpy.ops.render.render(animation=True)
    else:
        print(__doc__)
