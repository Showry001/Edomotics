"""Renders the home theatre saved by build.py.

    blender -b _src/theatre/theatre.blend --disable-autoexec --python scripts/theatre/render.py -- <job> <wide|tall> [samples] [percent]

  passes   the room with the screen up and with it down, one linear picture per light group
           (GROUPS in build.py), each denoised on its own so the page can add them up in any mix;
           and regions.json: where the screen's cloth and picture land in the frame
  still    one finished picture with every light on (AgX), for checking the framing:
           _src/theatre/preview/

Output goes to _src/theatre/out/<framing>/ as EXR; export.py turns it into web images.
"""
import json
import os
import sys
import time

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build  # noqa: E402

OUT = os.path.join(build.SRC, 'out')
PREVIEW = os.path.join(build.SRC, 'preview')
FRAMES = {'wide': ('cam-wide', 1920, 1080), 'tall': ('cam-tall', 900, 1600)}
RAW = {'stars'}        # points of light, seen directly: denoising would only smear them


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
    c.samples, c.use_adaptive_sampling, c.adaptive_threshold = samples, True, 0.006
    c.use_denoising, c.denoiser, c.denoising_use_gpu = True, 'OPENIMAGEDENOISE', True
    c.max_bounces, c.diffuse_bounces, c.glossy_bounces = 12, 6, 4
    c.transmission_bounces, c.transparent_max_bounces = 8, 16
    c.caustics_reflective = c.caustics_refractive = False
    c.blur_glossy, c.sample_clamp_indirect = 1.0, 10.0
    c.seed, c.use_animated_seed = 11, False
    cam, w, h = FRAMES[framing]
    sc.camera = bpy.data.objects[cam]
    sc.render.resolution_x, sc.render.resolution_y = w, h
    sc.render.resolution_percentage = percent
    sc.render.use_border = False
    vs = sc.view_settings
    vs.view_transform, vs.look = 'AgX', 'None'
    vs.use_white_balance, vs.white_balance_temperature = True, 4000
    return sc


def compositor(sc, directory):
    """Each light group to its own EXR in `directory` (denoised, except RAW)."""
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
    for g in build.GROUPS:
        out.file_output_items.new('RGBA', g)
        if g in RAW:
            ng.links.new(rl.outputs[f'Combined_{g}'], out.inputs[g])
            continue
        dn = ng.nodes.new('CompositorNodeDenoise')
        dn.inputs['HDR'].default_value = True
        ng.links.new(rl.outputs[f'Combined_{g}'], dn.inputs['Image'])
        ng.links.new(rl.outputs['Denoising Albedo'], dn.inputs['Albedo'])
        ng.links.new(rl.outputs['Denoising Normal'], dn.inputs['Normal'])
        ng.links.new(dn.outputs['Image'], out.inputs[g])
    return out


def shoot(sc, out, directory):
    os.makedirs(directory, exist_ok=True)
    for f in os.listdir(directory):
        os.remove(os.path.join(directory, f))
    out.directory = directory + os.sep
    t = time.time()
    bpy.ops.render.render(write_still=False)
    for f in os.listdir(directory):            # the node adds the frame number: house0001.exr → house.exr
        g = next((g for g in build.GROUPS if f.startswith(g)), None)
        if g and f != f'{g}.exr':
            os.replace(os.path.join(directory, f), os.path.join(directory, f'{g}.exr'))
    print(f'  {os.path.relpath(directory, build.SRC)}  {time.time() - t:.0f}s', flush=True)


def project(sc, points):
    """Points in the room → pixels in the full-size frame (x right, y down)."""
    w, h = sc.render.resolution_x, sc.render.resolution_y
    out = []
    for p in points:
        v = world_to_camera_view(sc, sc.camera, Vector(p))
        out.append((v.x * w, (1 - v.y) * h))
    return out


def regions(sc):
    """Where the screen lands. The camera is level and square to it, so these are rectangles."""
    y = build.SCREEN_Y
    fx, vw = build.FAB_X, build.VIEW_W / 2
    (a, b) = project(sc, [(-fx, y, build.SOFFIT), (fx, y, build.HEM_DOWN)])
    (c, d) = project(sc, [(-vw, y - 0.0035, build.VIEW_Z + build.VIEW_H), (vw, y - 0.0035, build.VIEW_Z)])
    w, h = sc.render.resolution_x, sc.render.resolution_y
    pad = 0.012 * w
    x0, y0 = max(0, int(a[0] - pad)) // 2 * 2, max(0, int(a[1] - pad)) // 2 * 2
    x1, y1 = min(w, int(b[0] + pad + 2)), min(h, int(b[1] + pad * 2 + 2))
    r = lambda v: round(v, 2)
    return {
        'size': [w, h],
        'cloth': [r(a[0]), r(a[1]), r(b[0]), r(b[1])],      # x0, slot, x1, the bar's underside when down
        'picture': [r(c[0]), r(c[1]), r(d[0]), r(d[1])],
        'crop': [x0, y0, (x1 - x0) // 2 * 2, (y1 - y0) // 2 * 2],
    }


def passes(framing, samples=1024, percent=100):
    sc = setup(framing, samples, percent)
    info = regions(setup(framing, samples, 100))
    sc.render.resolution_percentage = percent
    out = compositor(sc, OUT)
    for down, name in ((False, 'up'), (True, 'down')):
        build.set_screen(down)
        shoot(sc, out, os.path.join(OUT, framing, name))
    info['percent'] = percent
    json.dump(info, open(os.path.join(OUT, framing, 'regions.json'), 'w'), indent=2)
    print(json.dumps(info))


def still(framing, samples=128, percent=50, down=0):
    sc = setup(framing, samples, percent)
    build.set_screen(bool(down))
    os.makedirs(PREVIEW, exist_ok=True)
    sc.render.image_settings.file_format = 'PNG'
    sc.render.filepath = os.path.join(PREVIEW, f'{framing}-{"down" if down else "up"}.png')
    bpy.ops.render.render(write_still=True)
    print('wrote', sc.render.filepath)


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    job, framing = (args + ['', 'wide'])[:2]
    nums = [int(float(a)) for a in args[2:]]
    if job == 'passes':
        passes(framing, *nums)
    elif job == 'still':
        still(framing, *nums)
    else:
        print(__doc__)
