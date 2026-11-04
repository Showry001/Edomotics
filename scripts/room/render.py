"""Renders the bedroom saved by scene.py.

    blender -b _src/room/room.blend --disable-autoexec --python scripts/room/render.py -- <job> <wide|tall>

  still <framing> [samples] [percent] [curtain] [fan°]
      one finished picture (all lights, AgX), for checking the look: _src/room/preview/
  passes <framing> [samples]
      the room with the curtain open and closed, one linear picture per light group
  curtain <framing> [frames] [samples]
      the curtain running from open to closed, cropped to where it moves, at half size
  fan <framing> [frames] [samples]
      the fan turning through a third of a turn (its blades repeat every 120°), cropped

Every picture is light from one group only (GROUPS in scene.py), denoised on its own, so the
page can add them up in any mix: that's how the lights dim without flicker. Output goes to
_src/room/out/<framing>/ as EXR; export.py turns it into web images.
"""
import json
import math
import os
import sys
import time

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scene  # noqa: E402  (the room's dimensions, the curtain and the fan)

OUT = os.path.join(scene.SRC, 'out')
PREVIEW = os.path.join(scene.SRC, 'preview')
FRAMES = {'wide': ('cam-wide', 1920, 1080), 'tall': ('cam-tall', 900, 1600)}


def setup(framing, samples, percent=100):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    for d in prefs.devices:
        d.use = d.type == 'METAL'
    c = sc.cycles
    c.device = 'GPU'
    c.samples, c.use_adaptive_sampling, c.adaptive_threshold = samples, True, 0.008
    c.use_denoising, c.denoiser, c.denoising_use_gpu = True, 'OPENIMAGEDENOISE', True
    c.max_bounces, c.diffuse_bounces, c.glossy_bounces = 12, 6, 4
    c.transmission_bounces, c.transparent_max_bounces = 8, 16
    c.caustics_reflective = c.caustics_refractive = False
    c.blur_glossy, c.sample_clamp_indirect = 1.0, 10.0
    c.seed, c.use_animated_seed = 7, False
    cam, w, h = FRAMES[framing]
    sc.camera = bpy.data.objects[cam]
    sc.render.resolution_x, sc.render.resolution_y = w, h
    sc.render.resolution_percentage = percent
    sc.render.use_border = False
    sc.view_settings.view_transform, sc.view_settings.look = 'AgX', 'None'
    # Warm lamps read orange to a camera; balance the preview the way a photographer would.
    vs = sc.view_settings
    vs.use_white_balance, vs.white_balance_temperature = True, 4300
    return sc


def compositor(sc, directory):
    """Denoise each light group separately and write it to its own EXR in `directory`."""
    vl = sc.view_layers[0]
    vl.cycles.denoising_store_passes = True
    sc.cycles.use_denoising = False          # the combined picture isn't used
    ng = bpy.data.node_groups.new('passes', 'CompositorNodeTree')
    sc.compositing_node_group = ng
    sc.render.use_compositing = True
    rl = ng.nodes.new('CompositorNodeRLayers')
    rl.scene, rl.layer = sc, vl.name
    out = ng.nodes.new('CompositorNodeOutputFile')
    out.format.media_type, out.format.file_format = 'IMAGE', 'OPEN_EXR'
    out.format.color_depth, out.format.exr_codec = '32', 'ZIP'
    out.directory, out.file_name = directory + os.sep, ''
    for g in scene.GROUPS:
        dn = ng.nodes.new('CompositorNodeDenoise')
        dn.inputs['HDR'].default_value = True
        ng.links.new(rl.outputs[f'Combined_{g}'], dn.inputs['Image'])
        ng.links.new(rl.outputs['Denoising Albedo'], dn.inputs['Albedo'])
        ng.links.new(rl.outputs['Denoising Normal'], dn.inputs['Normal'])
        out.file_output_items.new('RGBA', g)
        ng.links.new(dn.outputs['Image'], out.inputs[g])
    return out


def shoot(sc, out, directory):
    """Render once; leave day.exr, cove.exr… in `directory`."""
    os.makedirs(directory, exist_ok=True)
    for f in os.listdir(directory):
        os.remove(os.path.join(directory, f))
    out.directory = directory + os.sep
    t = time.time()
    bpy.ops.render.render(write_still=False)
    for f in os.listdir(directory):            # the node adds the frame number: day0001.exr → day.exr
        g = next((g for g in scene.GROUPS if f.startswith(g)), None)
        if g and f != f'{g}.exr':
            os.replace(os.path.join(directory, f), os.path.join(directory, f'{g}.exr'))
    print(f'  {os.path.relpath(directory, scene.SRC)}  {time.time() - t:.0f}s', flush=True)


def region(sc, points, pad):
    """The pixel rectangle (left, top, width, height; y down, at the render's size) the points cover."""
    cam = sc.camera
    w = sc.render.resolution_x * sc.render.resolution_percentage // 100
    h = sc.render.resolution_y * sc.render.resolution_percentage // 100
    xs, ys = [], []
    for p in points:
        v = world_to_camera_view(sc, cam, p)
        xs.append(v.x * w)
        ys.append((1 - v.y) * h)
    x0, x1 = max(0, math.floor(min(xs) - pad * w)), min(w, math.ceil(max(xs) + pad * w))
    y0, y1 = max(0, math.floor(min(ys) - pad * h)), min(h, math.ceil(max(ys) + pad * h))
    x0, y0 = x0 - x0 % 2, y0 - y0 % 2              # even, so it lands on whole pixels at full size
    x1, y1 = min(w, x1 + x1 % 2), min(h, y1 + y1 % 2)
    return [x0, y0, x1 - x0, y1 - y0], (w, h)


def crop(sc, rect, size):
    x, y, rw, rh = rect
    w, h = size
    r = sc.render
    r.use_border, r.use_crop_to_border = True, True
    r.border_min_x, r.border_max_x = x / w, (x + rw) / w
    r.border_min_y, r.border_max_y = 1 - (y + rh) / h, 1 - y / h


def curtain_points(s):
    o = bpy.data.objects['curtain']
    scene.set_curtain(o, s)
    bpy.context.view_layer.update()
    return [o.matrix_world @ v.co for v in list(o.data.vertices)[::7]]


def fan_points():
    c = scene.FAN
    return [Vector((c.x + 0.72 * math.cos(a), c.y + 0.72 * math.sin(a), c.z + dz))
            for a in [i * math.pi / 32 for i in range(64)] for dz in (-0.09, 0.05)]


def save_regions(framing, key, data):
    path = os.path.join(OUT, framing, 'regions.json')
    regions = json.load(open(path)) if os.path.exists(path) else {}
    regions[key] = data
    json.dump(regions, open(path, 'w'), indent=2)


def passes(framing, samples=1024):
    sc = setup(framing, samples)
    out = compositor(sc, OUT)
    curtain = bpy.data.objects['curtain']
    bpy.data.objects['fan-rotor'].rotation_euler.z = 0.0
    for s, name in ((0.0, 'open'), (1.0, 'closed')):
        scene.set_curtain(curtain, s)
        shoot(sc, out, os.path.join(OUT, framing, name))
    save_regions(framing, 'size', [sc.render.resolution_x, sc.render.resolution_y])


def curtain_frames(framing, frames=24, samples=512):
    sc = setup(framing, samples, 50)
    pts = curtain_points(0.0) + curtain_points(1.0)
    rect, size = region(sc, pts, 0.01)
    crop(sc, rect, size)
    out = compositor(sc, OUT)
    curtain = bpy.data.objects['curtain']
    for i in range(frames):
        scene.set_curtain(curtain, i / (frames - 1))
        shoot(sc, out, os.path.join(OUT, framing, 'curtain', f'{i:02d}'))
    save_regions(framing, 'curtain', {'rect': rect, 'scale': 0.5, 'frames': frames})


def fan_frames(framing, frames=24, samples=512):
    sc = setup(framing, samples)
    rect, size = region(sc, fan_points(), 0.004)
    crop(sc, rect, size)
    out = compositor(sc, OUT)
    scene.set_curtain(bpy.data.objects['curtain'], 0.0)
    rotor = bpy.data.objects['fan-rotor']
    for i in range(frames):
        rotor.rotation_euler.z = math.radians(120 * i / frames)
        shoot(sc, out, os.path.join(OUT, framing, 'fan', f'{i:02d}'))
    save_regions(framing, 'fan', {'rect': rect, 'scale': 1, 'frames': frames, 'turn': 120})


def still(framing, samples=256, percent=50, s=0.0, angle=0.0):
    sc = setup(framing, samples, percent)
    scene.set_curtain(bpy.data.objects['curtain'], s)
    bpy.data.objects['fan-rotor'].rotation_euler.z = math.radians(angle)
    os.makedirs(PREVIEW, exist_ok=True)
    sc.render.image_settings.file_format = 'PNG'
    sc.render.filepath = os.path.join(PREVIEW, f'{framing}-{s:g}.png')
    bpy.ops.render.render(write_still=True)
    print('wrote', sc.render.filepath)


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    job, framing = (args + ['', 'wide'])[:2]
    nums = [float(a) for a in args[2:]]
    if job == 'still':
        still(framing, int(nums[0]) if nums else 256, int(nums[1]) if len(nums) > 1 else 50,
              nums[2] if len(nums) > 2 else 0.0, nums[3] if len(nums) > 3 else 0.0)
    elif job == 'passes':
        passes(framing, *[int(n) for n in nums])
    elif job == 'curtain':
        curtain_frames(framing, *[int(n) for n in nums])
    elif job == 'fan':
        fan_frames(framing, *[int(n) for n in nums])
    else:
        print(__doc__)
