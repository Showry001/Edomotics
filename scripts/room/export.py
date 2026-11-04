"""Turns render.py's EXR light layers into the images the One room section loads.

    blender -b --factory-startup --disable-autoexec --python scripts/room/export.py [-- looks]

Each light group is kept in 8 bits with a curve that holds deep shadow and bright lamps alike,
after scaling it to its own brightness (k, saved in room.json), so dim layers keep their detail:
    e = (kv / (kv + 1)) ** (1 / 2.2)      the page decodes v = x / (1 - x) / k, with x = e ** 2.2
Writes PNGs and room.json to _src/room/web/ (`npm run media room` makes the site's WebP), and
the finished stills (poster, no-WebGL fallback) graded with the page's look, src/js/room/look.json.
"looks" only writes those stills to _src/room/preview/, for tuning the look.
"""
import json
import math
import os
import sys

import numpy as np
import OpenImageIO as oiio

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
SRC = os.path.join(ROOT, '_src', 'room')
OUT, WEB, PREVIEW = (os.path.join(SRC, d) for d in ('out', 'web', 'preview'))
LOOK = json.load(open(os.path.join(ROOT, 'src', 'js', 'room', 'look.json')))
GROUPS = ('day', 'cove', 'down', 'lamp')
STATES = ('open', 'closed')


def read(path):
    return oiio.ImageBuf(path).get_pixels(oiio.FLOAT)[..., :3].astype(np.float32)


def write(path, rgb8):
    h, w = rgb8.shape[:2]
    out = oiio.ImageOutput.create(path)
    out.open(path, oiio.ImageSpec(w, h, 3, oiio.UINT8))
    out.write_image(np.ascontiguousarray(rgb8))
    out.close()


def scale_for(v):
    """Brings a layer's bright end (99th percentile) to 1, where the curve has room either side."""
    return round(float(1.0 / max(np.percentile(v @ np.array([0.2126, 0.7152, 0.0722], np.float32), 99), 1e-3)), 4)


def encode(v, k):
    v = np.maximum(v * k, 0.0)
    return np.clip(np.round((v / (v + 1.0)) ** (1 / 2.2) * 255), 0, 255).astype(np.uint8)


# AgX, as the page's shader has it (the usual polynomial fit of Blender's view transform).
AGX = np.array([[0.842479062253094, 0.0423282422610123, 0.0423756549057051],
                [0.0784335999999992, 0.878468636469772, 0.0784336],
                [0.0792237451477643, 0.0791661274605434, 0.879142973793104]], np.float32)
AGX_INV = np.array([[1.19687900512017, -0.0528968517574562, -0.0529716355144438],
                    [-0.0980208811401368, 1.15190312990417, -0.0980434501171241],
                    [-0.0990297440797205, -0.0989611768448433, 1.15107367264116]], np.float32)


def agx(v):
    lo, hi = -12.47393, 4.026069
    x = np.clip(np.log2(np.maximum(v @ AGX, 1e-10)), lo, hi)
    x = (x - lo) / (hi - lo)
    x2, x4 = x * x, x ** 4
    x = 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232
    return np.clip(x @ AGX_INV, 0.0, 1.0)


def luma(rgb):
    return float(rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32))


def adapt(means, lights, state):
    """Extra exposure for a darker scene, as eyes adjust: a share of the drop, never too much."""
    w, ref = weights(lights), weights('on')
    lum = sum(luma(means[state][g] * w[g]) for g in GROUPS)
    top = sum(luma(means['open'][g] * ref[g]) for g in GROUPS)
    a = LOOK['adapt']
    return min(a['max'], max(0.0, a['strength'] * math.log2(top / max(lum, 1e-6))))


def grade(linear, ev=0.0):
    """Exposure, white balance and AgX: linear light in, display pixels out."""
    v = linear * (2 ** (LOOK['exposure'] + ev)) * np.array(LOOK['balance'], np.float32)
    return np.clip(np.round(agx(v) * 255), 0, 255).astype(np.uint8)


def weights(lights):
    w = {'day': np.array(LOOK['day'], np.float32)}
    w.update({g: np.full(3, LOOK['lights'][lights][g], np.float32) for g in GROUPS[1:]})
    return w


def mix(layers, lights):
    w = weights(lights)
    return sum(layers[g] * w[g] for g in GROUPS)


def atlas(frames):
    """Frames side by side in a near-square grid (one texture per light group)."""
    n, (h, w) = len(frames), frames[0].shape[:2]
    cols = max(1, round(math.sqrt(n * h / w)))
    rows = math.ceil(n / cols)
    sheet = np.zeros((rows * h, cols * w, 3), np.uint8)
    for i, f in enumerate(frames):
        r, c = divmod(i, cols)
        sheet[r * h:(r + 1) * h, c * w:(c + 1) * w] = f
    return sheet, cols


def framing(name, data, looks_only):
    base = os.path.join(OUT, name)
    regions = json.load(open(os.path.join(base, 'regions.json')))
    full = {s: {g: read(os.path.join(base, s, f'{g}.exr')) for g in GROUPS} for s in STATES}
    means = {s: {g: full[s][g].mean((0, 1)) for g in GROUPS} for s in STATES}
    stills = {}
    for lights in LOOK['lights']:
        for s in STATES:
            stills[f'{lights}-{s}'] = grade(mix(full[s], lights), adapt(means, lights, s))
    if looks_only:
        for k, img in stills.items():
            write(os.path.join(PREVIEW, f'look-{name}-{k}.png'), img)
        return
    entry = {'size': regions['size'], 'full': [], 'k': [],
             'mean': [[round(float(c), 5) for c in means[s][g]] for s in STATES for g in GROUPS]}
    for s in STATES:
        for g in GROUPS:
            file, k = f'{name}-{s}-{g}.png', scale_for(full[s][g])
            write(os.path.join(WEB, file), encode(full[s][g], k))
            entry['full'].append(file)
            entry['k'].append(k)
    for k, img in stills.items():
        write(os.path.join(WEB, f'still-{name}-{k}.png'), img)
    for seq in ('curtain', 'fan'):
        if seq not in regions:
            continue
        info = dict(regions[seq])
        x, y, w, h = info['rect']
        k = 1 / info['scale']
        info['rect'] = [round(x * k), round(y * k), round(w * k), round(h * k)]   # in full-size pixels
        info['atlas'], info['k'] = [], []
        for gi, g in enumerate(GROUPS):
            k = entry['k'][gi]                       # the open room's scale for this light
            frames = [encode(read(os.path.join(base, seq, f'{i:02d}', f'{g}.exr')), k) for i in range(info['frames'])]
            info['k'].append(k)
            sheet, cols = atlas(frames)
            file = f'{name}-{seq}-{g}.png'
            write(os.path.join(WEB, file), sheet)
            info['atlas'].append(file)
        info['cols'], info['cell'] = cols, [frames[0].shape[1], frames[0].shape[0]]
        if seq == 'fan':
            # The fan frames are lit with the curtain open; this is how much each light changes
            # on the fan when the curtain closes (the page scales the frames by it).
            fx, fy, fw, fh = info['rect']
            info['closed'] = [[round(float(c), 4) for c in
                               full['closed'][g][fy:fy + fh, fx:fx + fw].mean((0, 1)) /
                               np.maximum(full['open'][g][fy:fy + fh, fx:fx + fw].mean((0, 1)), 1e-6)]
                              for g in GROUPS]
        entry[seq] = info
    data[name] = entry


def main():
    looks_only = 'looks' in sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else False
    os.makedirs(PREVIEW if looks_only else WEB, exist_ok=True)
    data = {'groups': list(GROUPS)}
    for name in ('wide', 'tall'):
        if os.path.exists(os.path.join(OUT, name, 'regions.json')):
            framing(name, data, looks_only)
            print('exported', name)
    if not looks_only:
        json.dump(data, open(os.path.join(WEB, 'room.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
