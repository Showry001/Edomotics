"""Turns render.py's EXR light layers into the images the theatre section loads.

    blender -b --factory-startup --disable-autoexec --python scripts/theatre/export.py [-- looks]

Per framing: the room with the screen up, one layer per light group; the same groups with the
screen down, cropped to the screen; and the light the picture throws (screen down). Layers are
8-bit with the bedroom's curve (scripts/room/export.py): e = (kv / (kv + 1)) ** (1 / 2.2).
Also writes the pre-show card (the Edomotics logo on a dark 2.39:1 card), theatre.json, and one
finished still per scene, graded with src/js/theatre/look.json (poster, no-WebGL fallback).
"looks" only writes the stills, to _src/theatre/preview/.
"""
import json
import math
import os
import sys

import numpy as np
import OpenImageIO as oiio

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
SRC = os.path.join(ROOT, '_src', 'theatre')
OUT, WEB, PREVIEW, FILM = (os.path.join(SRC, d) for d in ('out', 'web', 'preview', 'film'))
LOGO = os.path.join(ROOT, '_src', 'designer', 'edomotics-logo.webp')
LOOK = json.load(open(os.path.join(ROOT, 'src', 'js', 'theatre', 'look.json')))
ROOM = ('ambient', 'house', 'cove', 'stars', 'step')
STILL_FRAME = 120
PICTURE = (1280, 536)
LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)

sys.path.insert(0, os.path.join(HERE, '..', 'room'))
from export import agx, encode, write  # noqa: E402  (the bedroom's curve, AgX and PNG writer)


def read(path):
    return oiio.ImageBuf(path).get_pixels(oiio.FLOAT)[..., :3].astype(np.float32)


def read_rgba(path):
    buf = oiio.ImageBuf(path)
    px = buf.get_pixels(oiio.FLOAT).astype(np.float32)
    if px.shape[2] == 3:
        px = np.concatenate([px, np.ones(px.shape[:2] + (1,), np.float32)], 2)
    return px


def resize(img, w, h):
    src = oiio.ImageBuf(oiio.ImageSpec(img.shape[1], img.shape[0], img.shape[2], oiio.FLOAT))
    src.set_pixels(oiio.ROI(), np.ascontiguousarray(img))
    dst = oiio.ImageBufAlgo.resize(src, roi=oiio.ROI(0, w, 0, h, 0, 1, 0, img.shape[2]))
    return dst.get_pixels(oiio.FLOAT).astype(np.float32)


def to_linear(srgb):
    return np.where(srgb <= 0.04045, srgb / 12.92, ((srgb + 0.055) / 1.055) ** 2.4).astype(np.float32)


def to_srgb8(lin_):
    v = np.clip(lin_, 0, 1)
    s = np.where(v <= 0.0031308, v * 12.92, 1.055 * v ** (1 / 2.4) - 0.055)
    return np.clip(np.round(s * 255), 0, 255).astype(np.uint8)


def scale_for(v):
    """Brings a layer's bright end to 1; sparse layers (stars, step lights) by their brightest points."""
    lum = v @ LUMA
    return round(float(1.0 / max(np.percentile(lum, 99), np.percentile(lum, 99.9) / 6, 1e-3)), 4)


def card():
    """The pre-show picture: the logo as supplied, centred on a dark card (the cinema designer's look)."""
    w, h = PICTURE
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    r = np.sqrt(((xx - w / 2) / (w * 0.6)) ** 2 + ((yy - h / 2) / (w * 0.6)) ** 2)
    t = np.clip(r, 0, 1)[..., None]
    a, b = to_linear(np.array([0x1d, 0x1c, 0x18], np.float32) / 255), to_linear(np.array([0x0c, 0x0b, 0x09], np.float32) / 255)
    bg = a * (1 - t) + b * t
    logo = read_rgba(LOGO)
    ys, xs = np.nonzero(logo[..., 3] > 0.01)
    logo = logo[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    lw = round(w * 0.4)
    lh = round(lw * logo.shape[0] / logo.shape[1])
    logo = resize(logo, lw, lh)
    x0, y0 = (w - lw) // 2, (h - lh) // 2
    alpha = np.clip(logo[..., 3:4], 0, 1)
    rgb = to_linear(np.clip(logo[..., :3] / np.maximum(alpha, 1e-4), 0, 1))   # OIIO reads it premultiplied
    region = bg[y0:y0 + lh, x0:x0 + lw]
    bg[y0:y0 + lh, x0:x0 + lw] = region * (1 - alpha) + rgb * alpha
    return bg


def film_frames():
    if not os.path.isdir(FILM):
        return []
    return sorted(f for f in os.listdir(FILM) if f.endswith('.png'))


def picture(kind):
    """The picture on the screen as linear light, PICTURE-sized."""
    if kind == 'card':
        return card()
    frames = film_frames()
    if not frames:
        return np.full((PICTURE[1], PICTURE[0], 3), 0.08, np.float32)
    f = frames[min(STILL_FRAME, len(frames) - 1)]
    return to_linear(read(os.path.join(FILM, f)))


def film_mean():
    frames = film_frames()
    if not frames:
        return [0.2, 0.12, 0.06]
    ms = [to_linear(read(os.path.join(FILM, f))).mean((0, 1)) for f in (frames[24::12] or frames)]
    return [round(float(c), 5) for c in np.mean(ms, 0)]


def weights(scene):
    s = LOOK['scenes'][scene]
    return {'ambient': LOOK['ambient'], **{g: float(s[g]) for g in ROOM[1:]}}


def grade(linear, ev):
    v = linear * (2 ** (LOOK['exposure'] + ev)) * np.array(LOOK['balance'], np.float32)
    return np.clip(np.round(agx(v) * 255), 0, 255).astype(np.uint8)


def luma(rgb):
    return float(np.asarray(rgb) @ LUMA)


def adapt(means, scene, screen_mean, content_mean):
    """Extra exposure for a darker scene, as eyes adjust; the page does the same (theatre/index.js)."""
    def lum(sc):
        w = weights(sc)
        v = sum(luma(means[g]) * w[g] for g in ROOM)
        if LOOK['scenes'][sc]['screen'] and LOOK['scenes'][sc]['picture']:
            v += luma(np.asarray(screen_mean) * np.asarray(content_mean)) * LOOK['projector']
        return v
    a = LOOK['adapt']
    return min(a['max'], max(0.0, a['strength'] * math.log2(lum('lights') / max(lum(scene), 1e-6))))


def framing(name, data, looks_only, fmean):
    base = os.path.join(OUT, name)
    reg = json.load(open(os.path.join(base, 'regions.json')))
    up = {g: read(os.path.join(base, 'up', f'{g}.exr')) for g in ROOM}
    down = {g: read(os.path.join(base, 'down', f'{g}.exr')) for g in ROOM}
    screen = read(os.path.join(base, 'down', 'screen.exr'))
    h, w = screen.shape[:2]
    s = w / reg['size'][0]                         # passes may be rendered below full size
    cx, cy, cw, ch = (int(round(v * s)) // 2 * 2 for v in reg['crop'])
    cloth = [round(v * s, 2) for v in reg['cloth']]
    pic = [round(v * s, 2) for v in reg['picture']]
    means = {g: up[g].mean((0, 1)) for g in ROOM}
    smean = screen.mean((0, 1))

    stills = {}
    contents = {k: picture(k) for k in ('card', 'film')}
    cmeans = {'card': contents['card'].mean((0, 1)), 'film': np.array(fmean, np.float32)}
    px0, py0, px1, py1 = (int(round(v)) for v in pic)
    yy, xx = np.mgrid[0:ch, 0:cw]
    edge = np.minimum.reduce([xx, yy, cw - 1 - xx, ch - 1 - yy]).astype(np.float32)
    feather = np.clip(edge / 10.0, 0, 1)[..., None]
    for scene, spec in LOOK['scenes'].items():
        wts = weights(scene)
        room = sum(up[g] * wts[g] for g in ROOM)
        if spec['screen']:
            crop = sum(down[g][cy:cy + ch, cx:cx + cw] * wts[g] for g in ROOM)
            room[cy:cy + ch, cx:cx + cw] = room[cy:cy + ch, cx:cx + cw] * (1 - feather) + crop * feather
            if spec['picture']:
                m = np.broadcast_to(cmeans[spec['picture']], room.shape).copy()
                m[py0:py1, px0:px1] = resize(contents[spec['picture']], px1 - px0, py1 - py0)
                room = room + screen * m * LOOK['projector']
        cm = cmeans[spec['picture']] if spec['picture'] else np.zeros(3, np.float32)
        stills[scene] = grade(room, adapt(means, scene, smean, cm))
    if looks_only:
        for k, img in stills.items():
            write(os.path.join(PREVIEW, f'look-{name}-{k}.png'), img)
        return

    entry = {'size': [w, h], 'crop': [cx, cy, cw, ch], 'cloth': cloth, 'picture': pic,
             'up': [], 'down': [], 'k': [], 'mean': [[round(float(c), 5) for c in means[g]] for g in ROOM],
             'screenMean': [round(float(c), 5) for c in smean]}
    for state, layers, sl in (('up', up, (slice(None), slice(None))), ('down', down, (slice(cy, cy + ch), slice(cx, cx + cw)))):
        for g in ROOM:
            v = layers[g][sl]
            k = scale_for(v)
            file = f'{name}-{state}-{g}.png'
            write(os.path.join(WEB, file), encode(v, k))
            entry[state].append(file)
            entry['k'].append(k)
    k = scale_for(screen)
    entry['screen'] = f'{name}-screen.png'
    write(os.path.join(WEB, entry['screen']), encode(screen, k))
    entry['k'].append(k)
    entry['stills'] = {}
    for scene, img in stills.items():
        entry['stills'][scene] = f'still-{name}-{scene}.png'
        write(os.path.join(WEB, entry['stills'][scene]), img)
    data[name] = entry


def main():
    looks_only = 'looks' in sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else False
    os.makedirs(PREVIEW if looks_only else WEB, exist_ok=True)
    fmean = film_mean()
    data = {'groups': list(ROOM), 'film': {'mean': fmean, 'frames': len(film_frames())},
            'cardMean': [round(float(c), 5) for c in card().mean((0, 1))]}
    for name in ('wide', 'tall'):
        if os.path.exists(os.path.join(OUT, name, 'regions.json')):
            framing(name, data, looks_only, fmean)
            print('exported', name)
    if not looks_only:
        write(os.path.join(WEB, 'card.png'), to_srgb8(card()))
        json.dump(data, open(os.path.join(WEB, 'theatre.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
