// Media pipeline: responsive AVIF + WebP sizes, monochrome partner logos, web-ready video.
// Run with `npm run media`. Sources live in _src/; output goes to public/media/.
import sharp from 'sharp';
import ffmpeg from 'ffmpeg-static';
import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, readdirSync, readFileSync, writeFileSync, unlinkSync, copyFileSync, statSync } from 'node:fs';
import path from 'node:path';

const OUT = 'public/media';
// -sm and -md always exist (the markup links -md directly for previews and og:image);
// larger sizes are only made when the source is big enough to be worth a separate file.
const SIZES = [{ suffix: '-sm', width: 640 }, { suffix: '-md', width: 1280 }, { suffix: '-lg', width: 1920 }, { suffix: '', width: 2400 }];
const QUALITY = { webp: { '-sm': 70, default: 74 }, avif: { '-sm': 50, default: 54 } };

mkdirSync(`${OUT}/img`, { recursive: true });
mkdirSync(`${OUT}/logos`, { recursive: true });
mkdirSync(`${OUT}/video`, { recursive: true });

// Photographs: name → source. _src/photos/ holds full-resolution masters (3200px) of shots the
// site already used from the client shoots; the brief's 2000px WebPs remain for the regraded
// living-room set; Framer originals cover the rest.
const brief = '_src/edomotics-brief/images';
const framer = '_src/framer/img';
const masters = '_src/photos';
const PHOTOS = {
  'dining-corridor': `${masters}/dining-corridor.jpg`,
  'living-marble': `${masters}/living-marble.jpg`,
  'living-hex': `${masters}/living-hex.jpg`,
  'living-amber-wide': `${brief}/living-amber-wide.webp`,
  'cinema-recliners': `${masters}/cinema-recliners.jpg`,
  'bedroom-pendant': `${masters}/bedroom-pendant.jpg`,
  'bedroom-sculpted': `${masters}/bedroom-sculpted.jpg`,
  'bedroom-lakeview': `${masters}/bedroom-lakeview.jpg`,
  'living-curved': `${masters}/living-curved.jpg`,
  'living-media-wall': `${masters}/living-media-wall.jpg`,
  'lounge-amber': `${masters}/lounge-amber.jpg`,
  'bedroom-cove': `${framer}/rising-3.jpg`,
  'living-dining': `${framer}/blog-1.jpg`,
  'villa-dusk': `${framer}/rising-2.jpg`,
  'lounge-tall': `${framer}/rising-4.jpg`,
  'project-ravi-prasad': `${framer}/project-1.jpg`,
  // Leadership portraits, square. Ganesh and Keshava: studio portraits supplied by Edomotics
  // (square crops; the full frames are in _src/founders/originals/). Manjunath: the 365px
  // original from the Edomotics Framer site (shown small, never upscaled).
  'founder-ganesh-vudutha': '_src/founders/ganesh-vudutha.jpg',
  'founder-keshava-varma': '_src/founders/keshava-varma.jpg',
  'founder-manjunath-n-m': '_src/founders/manjunath-n-m.jpg',
  'team-hyderabad': `${framer}/team-hyderabad.jpg`,
  'team-bangalore': `${framer}/team-bangalore.jpg`,
  // One room: the rendered bedroom with every light on (scripts/room/), landscape and portrait.
  'room-wide': '_src/room/web/still-wide-on-open.png',
  'room-tall': '_src/room/web/still-tall-on-open.png',
  // One theatre: the rendered home theatre in its lounge scene (scripts/theatre/), landscape and portrait.
  'theatre-wide': '_src/theatre/web/still-wide-lounge.png',
  'theatre-tall': '_src/theatre/web/still-tall-lounge.png',
};

// The manifest records each photo's real widths and aspect so the Vite plugin can write
// exact srcset / width / height attributes (no layout shift, no guessing in the markup).
// Project photography is picked up automatically: _src/projects/<slug>/*.jpg becomes
// pictures named <slug>-01, <slug>-02… (in file-name order), ready to list in projects.json.
function projectPhotos() {
  const dir = '_src/projects';
  const found = {};
  if (!existsSync(dir)) return found;
  for (const slug of readdirSync(dir)) {
    const folder = path.join(dir, slug);
    let files;
    try { files = readdirSync(folder).filter((f) => /\.(jpe?g|png|webp|tiff?)$/i.test(f)).sort(); } catch { continue; }
    files.forEach((f, i) => { found[`${slug}-${String(i + 1).padStart(2, '0')}`] = path.join(folder, f); });
  }
  return found;
}

// A file is rebuilt only when it is missing or older than its source.
const fresh = (out, src) => existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs;

async function photos() {
  const manifest = {};
  const keep = new Set();
  for (const [name, src] of Object.entries({ ...PHOTOS, ...projectPhotos(), ...filmPhotos(), ...stockPhotos() })) {
    const meta = await sharp(src).metadata();
    const portrait = (meta.orientation || 1) >= 5;
    const width = portrait ? meta.height : meta.width;
    const height = portrait ? meta.width : meta.height;
    const widths = [];
    for (const { suffix, width: target } of SIZES) {
      const w = Math.min(target, width); // never upscale
      const last = widths[widths.length - 1];
      const required = suffix === '-sm' || suffix === '-md';
      if (last && (w === last.w || (!required && w < last.w * 1.15))) continue;
      const base = `${OUT}/img/${name}${suffix}`;
      for (const fmt of ['webp', 'avif']) {
        const out = `${base}.${fmt}`;
        keep.add(out);
        if (fresh(out, src)) continue;
        const q = QUALITY[fmt][suffix] ?? QUALITY[fmt].default;
        const img = sharp(src).rotate().resize({ width: w, withoutEnlargement: true });
        await (fmt === 'avif' ? img.avif({ quality: q, effort: 5, chromaSubsampling: '4:2:0' }) : img.webp({ quality: q, effort: 5 })).toFile(out);
      }
      widths.push({ w, file: `media/img/${name}${suffix}.webp` });
    }
    manifest[name] = { width, height, widths, avif: true };
    console.log('photo', name, `${width}x${height}`, widths.map((x) => x.w).join('/'));
  }
  // Remove outputs no photo uses any more, so the deploy carries only what the site needs.
  for (const f of readdirSync(`${OUT}/img`)) if (/\.(webp|avif)$/.test(f) && !keep.has(`${OUT}/img/${f}`)) unlinkSync(`${OUT}/img/${f}`);
  writeFileSync('src/media-manifest.json', JSON.stringify(manifest, null, 2));
}

// Brand logo: white source → ink and paper versions, keeping its facet shading as alpha.
async function brandLogo() {
  const src = '_src/framer/img/logo.png';
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (const [name, rgb] of [['logo-ink', [18, 17, 14]], ['logo-paper', [243, 238, 230]]]) {
    const out = Buffer.alloc(data.length);
    for (let i = 0; i < data.length; i += 4) {
      const lum = (data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722) / 255;
      out[i] = rgb[0]; out[i + 1] = rgb[1]; out[i + 2] = rgb[2];
      out[i + 3] = Math.round(data[i + 3] * Math.min(1, 0.35 + lum * 0.65));
    }
    await sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } })
      .png({ compressionLevel: 9 }).toFile(`${OUT}/img/${name}.png`);
  }
  console.log('brand logo');
}

// Partner logos → one monochrome system. Each logo becomes an alpha mask (ink-coloured),
// so a wall of thirteen different brand treatments reads as one quiet surface.
const LOGOS = [
  ['basalte', 'logo-01.jpg'], ['wiim', 'logo-02.jpeg'], ['schneider-electric', 'logo-03.webp'],
  ['hunter-douglas', 'logo-04.png'], ['yale', 'logo-05.png'], ['honeywell', 'logo-06.png'],
  ['somfy', 'logo-07.png'], ['assa-abloy', 'logo-08.png'], ['control4', 'logo-09.png'],
  ['grandstream', 'logo-10.jpg'], ['intesis', 'logo-11.jpg'], ['legrand', 'logo-12.png'],
  ['steinel', 'logo-13.png'],
];

async function logos() {
  for (const [name, file] of LOGOS) {
    const src = path.join('_src/framer/logos', file);
    const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const n = info.width * info.height;
    let transparent = 0;
    const counts = new Map();
    for (let i = 0; i < n; i++) {
      const a = data[i * 4 + 3];
      if (a < 16) { transparent++; continue; }
      const key = ((data[i * 4] >> 4) << 8) | ((data[i * 4 + 1] >> 4) << 4) | (data[i * 4 + 2] >> 4);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const useAlpha = transparent / n > 0.3;
    let bg = [255, 255, 255];
    if (!useAlpha) {
      const [key] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      bg = [((key >> 8) & 15) * 17, ((key >> 4) & 15) * 17, (key & 15) * 17];
    }
    const out = Buffer.alloc(n * 4);
    for (let i = 0; i < n; i++) {
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2], a = data[i * 4 + 3] / 255;
      let m;
      if (useAlpha) m = a;
      else {
        const d = Math.sqrt((r - bg[0]) ** 2 + (g - bg[1]) ** 2 + (b - bg[2]) ** 2) / 441;
        m = a * Math.min(1, Math.max(0, (d - 0.12) / 0.28));
      }
      out[i * 4] = 18; out[i * 4 + 1] = 17; out[i * 4 + 2] = 14; out[i * 4 + 3] = Math.round(m * 255);
    }
    await sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } })
      .trim({ threshold: 1 })
      .resize({ height: 160, width: 520, fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9, palette: true })
      .toFile(`${OUT}/logos/${name}.png`);
    console.log('logo', name, useAlpha ? 'alpha' : `bg ${bg}`);
  }
}

// Video: no audio, H.264 for reach, faststart so it begins before it finishes loading.
// The hero loops ambiently; scrub videos get a keyframe every 6 frames so seeking is smooth.
function encode(src, out, { scrub = false, width = 1280, crf = 25, gop = 2 } = {}) {
  const args = ['-y', '-loglevel', 'error', '-i', src, '-an',
    '-vf', `scale='min(${width},iw)':-2:flags=lanczos,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-profile:v', 'high',
    '-movflags', '+faststart'];
  // Scrubbed video: a keyframe every `gop` frames and no B-frames, so any frame decodes fast.
  if (scrub) args.push('-g', String(gop), '-keyint_min', String(gop), '-sc_threshold', '0', '-bf', '0');
  args.push(out);
  execFileSync(ffmpeg, args, { stdio: 'inherit' });
  console.log('video', out);
}

function frame(src, out) {
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', src, '-frames:v', '1', '-update', '1', out]);
}

function poster(src, out) {
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', src, '-frames:v', '1', '-q:v', '3', out]);
}

// The hero: the Seshu & Rajalakshmi lounge as its lights come up, cut from the 4K original (the
// same take the first site used, at last at full quality). 1920 wide for screens from 768 px, and a
// portrait cut for phones, so a phone gets sharp pixels instead of a magnified slice of landscape.
const HERO = { src: '_src/drive/video/video-ss/C2041.MP4', from: 9.3, to: 22.4 };
function heroCut(out, vf, crf) {
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-ss', String(HERO.from), '-to', String(HERO.to), '-i', HERO.src, '-an',
    '-vf', `${vf},format=yuv420p`, '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-profile:v', 'high',
    '-movflags', '+faststart', out], { stdio: 'inherit' });
  console.log('video', out, `${(statSync(out).size / 1e6).toFixed(1)} MB`);
}
async function hero() {
  if (!existsSync(HERO.src)) return false;
  heroCut(`${OUT}/video/hero.mp4`, 'fps=30,scale=1920:-2:flags=lanczos', 21);
  heroCut(`${OUT}/video/hero-sm.mp4`, 'fps=30,crop=ih*9/16:ih:(iw-ih*9/16)*0.5:0,scale=720:1280:flags=lanczos', 23);
  frame(`${OUT}/video/hero.mp4`, `${OUT}/video/hero-poster.png`);
  await sharp(`${OUT}/video/hero-poster.png`).webp({ quality: 80 }).toFile(`${OUT}/video/hero-poster.webp`);
  await sharp(`${OUT}/video/hero-poster.png`).jpeg({ quality: 82, mozjpeg: true }).toFile(`${OUT}/video/hero-poster.jpg`);
  unlinkSync(`${OUT}/video/hero-poster.png`);
  return true;
}

async function videos() {
  const v = '_src/framer/video';
  if (!(await hero())) {
    encode(`${v}/hero.mp4`, `${OUT}/video/hero.mp4`, { width: 1280, crf: 26 });
    encode(`${v}/hero.mp4`, `${OUT}/video/hero-sm.mp4`, { width: 720, crf: 27 });
    poster(`${OUT}/video/hero.mp4`, `${OUT}/video/hero-poster.jpg`);
    await sharp(`${OUT}/video/hero-poster.jpg`).webp({ quality: 72 }).toFile(`${OUT}/video/hero-poster.webp`);
  }

  // Scroll-scrubbed footage: drop it into _src/videos/ with these names.
  for (const name of ['cinema']) {
    const src = `_src/videos/${name}.mp4`;
    if (!existsSync(src)) continue;
    encode(src, `${OUT}/video/${name}.mp4`, { scrub: true, width: 1280, crf: 23, gop: 2 });
    encode(src, `${OUT}/video/${name}-sm.mp4`, { scrub: true, width: 720, crf: 25, gop: 2 });
    const tmp = `${OUT}/video/.${name}`;
    frame(src, `${tmp}-first.png`);
    for (const [suffix, w] of [['', 1280], ['-sm', 720]]) {
      await sharp(`${tmp}-first.png`).resize({ width: w }).webp({ quality: 74 }).toFile(`${OUT}/video/${name}-poster${suffix}.webp`);
    }
    unlinkSync(`${tmp}-first.png`);
  }
}

// Client logos: the official artwork as supplied, which is the reversed (white) version.
// The site sits on cream, so each logo is turned into an ink mark: brightness becomes opacity,
// so white artwork turns ink and any dark detail inside it (IKEA's oval, Sattva's tiles) stays
// knocked out. Proportions are untouched; trimmed and sized consistently.
const INK = [18, 17, 14];
async function clients() {
  const dir = '_src/clients';
  if (!existsSync(dir)) return;
  mkdirSync(`${OUT}/clients`, { recursive: true });
  for (const file of readdirSync(dir).filter((f) => /\.(png|webp|svg)$/i.test(f))) {
    const name = file.replace(/\.[^.]+$/, '');
    if (file.endsWith('.svg')) { copyFileSync(path.join(dir, file), `${OUT}/clients/${file}`); continue; }
    const { data, info } = await sharp(path.join(dir, file)).ensureAlpha().trim({ threshold: 2 })
      .resize({ width: 520, height: 200, fit: 'inside', withoutEnlargement: true })
      .raw().toBuffer({ resolveWithObject: true });
    for (let i = 0; i < data.length; i += 4) {
      const lum = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
      data[i + 3] = Math.round(data[i + 3] * lum);
      data[i] = INK[0]; data[i + 1] = INK[1]; data[i + 2] = INK[2];
    }
    await sharp(data, { raw: info }).webp({ lossless: true, effort: 6 }).toFile(`${OUT}/clients/${name}.webp`);
    console.log('client', name);
  }
}

// The picture on the 3D cinema screen (Design your cinema): the Edomotics logo as supplied,
// centred on a dark title card. 16:9; the screen crops it to 2.35:1, so the logo sits inside both.
async function designer() {
  const src = '_src/designer/edomotics-logo.webp';
  if (!existsSync(src)) return;
  mkdirSync(`${OUT}/designer`, { recursive: true });
  const [W, H] = [2048, 1152];
  const logo = await sharp(src).trim({ threshold: 2 }).resize({ width: Math.round(W * 0.46) }).toBuffer();
  const glow = Buffer.from(`<svg width="${W}" height="${H}"><defs><radialGradient id="g" cx="50%" cy="50%" r="60%"><stop offset="0" stop-color="#1d1c18"/><stop offset="1" stop-color="#0c0b09"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`);
  await sharp(glow).composite([{ input: logo, gravity: 'center' }]).webp({ quality: 82 }).toFile(`${OUT}/designer/screen.webp`);
  console.log('designer screen');
}

// One room: the bedroom's light layers and movement frames, rendered in Blender and exported by
// scripts/room/ (scene.py, render.py, export.py). Layers carry data, not pictures, so they're
// kept at a high quality; the stills are the no-WebGL fallback, one per lighting and curtain state.
async function room() {
  const dir = '_src/room/web';
  if (!existsSync(`${dir}/room.json`)) return;
  mkdirSync(`${OUT}/room`, { recursive: true });
  const data = JSON.parse(readFileSync(`${dir}/room.json`, 'utf8'));
  const keep = new Set();
  const webp = async (file, opts) => {
    const name = file.replace(/\.png$/, '.webp');
    const out = `${OUT}/room/${name}`;
    keep.add(out);
    if (!fresh(out, `${dir}/${file}`)) await sharp(`${dir}/${file}`).webp(opts).toFile(out);
    return name;
  };
  const LAYER = { quality: 90, smartSubsample: true, effort: 6 };
  for (const framing of ['wide', 'tall']) {
    const set = data[framing];
    if (!set) continue;
    set.full = await Promise.all(set.full.map((f) => webp(f, LAYER)));
    for (const seq of ['curtain', 'fan']) if (set[seq]) set[seq].atlas = await Promise.all(set[seq].atlas.map((f) => webp(f, LAYER)));
    set.stills = {};
    for (const lights of ['on', 'twilight', 'off']) {
      for (const curtain of ['open', 'closed']) {
        set.stills[`${lights}-${curtain}`] = await webp(`still-${framing}-${lights}-${curtain}.png`, { quality: 76, effort: 5 });
      }
    }
  }
  for (const f of readdirSync(`${OUT}/room`)) if (!keep.has(`${OUT}/room/${f}`)) unlinkSync(`${OUT}/room/${f}`);
  writeFileSync('src/media-room.json', JSON.stringify(data));
  console.log('room', [...keep].length, 'files');
}

// Home theatre: the light layers (screen up, screen down cropped to the screen, the picture's own
// light), rendered and exported by scripts/theatre/; the pre-show card; one still per scene (the
// no-WebGL fallback); and the film, joined from its frames into a 10 s loop whose last second
// dissolves into the first.
async function theatre() {
  const dir = '_src/theatre/web';
  if (!existsSync(`${dir}/theatre.json`)) return;
  const out = `${OUT}/theatre`;
  mkdirSync(out, { recursive: true });
  const data = JSON.parse(readFileSync(`${dir}/theatre.json`, 'utf8'));
  const keep = new Set();
  const webp = async (file, opts, from = dir) => {
    const name = path.basename(file).replace(/\.png$/, '.webp');
    keep.add(`${out}/${name}`);
    if (!fresh(`${out}/${name}`, `${from}/${file}`)) await sharp(`${from}/${file}`).webp(opts).toFile(`${out}/${name}`);
    return name;
  };
  const LAYER = { quality: 90, smartSubsample: true, effort: 6 };
  for (const framing of ['wide', 'tall']) {
    const set = data[framing];
    if (!set) continue;
    set.up = await Promise.all(set.up.map((f) => webp(f, LAYER)));
    set.down = await Promise.all(set.down.map((f) => webp(f, LAYER)));
    set.screen = await webp(set.screen, LAYER);
    for (const scene of Object.keys(set.stills)) set.stills[scene] = await webp(set.stills[scene], { quality: 76, effort: 5 });
  }
  data.card = await webp('card.png', { quality: 88, effort: 5 });
  const frames = '_src/theatre/film';
  const last = `${frames}/0264.png`;
  if (existsSync(last)) {
    const mp4 = `${out}/film.mp4`;
    keep.add(mp4);
    if (!fresh(mp4, last)) {
      execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-framerate', '24', '-start_number', '1', '-i', `${frames}/%04d.png`,
        '-filter_complex', '[0:v]split[x][y];[x]trim=start_frame=24:end_frame=264,setpts=PTS-STARTPTS[a];' +
          '[y]trim=start_frame=0:end_frame=24,setpts=PTS-STARTPTS[b];[a][b]xfade=transition=fade:duration=1:offset=9,format=yuv420p[v]',
        '-map', '[v]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '22', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart', '-an', mp4], { stdio: 'inherit' });
    }
    data.film.src = 'film.mp4';
    const still = `${out}/film-still.webp`;                 // the frame the stills show
    keep.add(still);
    if (!fresh(still, `${frames}/0121.png`)) await sharp(`${frames}/0121.png`).webp({ quality: 84, effort: 5 }).toFile(still);
    data.film.still = 'film-still.webp';
  }
  for (const f of readdirSync(out)) if (!keep.has(`${out}/${f}`)) unlinkSync(`${out}/${f}`);
  writeFileSync('src/media-theatre.json', JSON.stringify(data));
  console.log('theatre', keep.size, 'files');
}

// Films, cut from the project shoots in _src/drive/video/ (the client's Drive, and the "website
// content" folder copied into wc/). A film is one or more parts, each a moment of a clip (from–to,
// in seconds), fitted together into the set's length and dissolving into each other. `turn` stands
// a clip upright where the camera was on its side (ffmpeg transpose); x, y place the crop; `push`
// is a slow push-in across the part, [from, to] zoom (x, y then place the zoom). `poster` is the
// moment of the film (in seconds) shown as its photograph: it is taken from the 4K source, so the
// photo and the film always agree. `overlay` puts the site's own film (the theatre section's
// sunset) on a blank screen in the shot, fading in as a projector would: [x, y, w, h] in source pixels.
//   Card films play over the capability rows on the Automation and Home theatre pages
//   (src/js/cardfilms.js). Step films play in the stepped stories on those pages (initSteps).
// `node scripts/media.mjs cards|steps [name]` re-cuts films and posters.
const GRADE = 'eq=contrast=1.05:saturation=1.05';
const CARD_FILMS = [
  // Home automation
  { name: 'lighting', parts: [{ src: 'wc/lib-0167.MP4', from: 1.2, to: 7.4 }], poster: 4.95 },
  { name: 'climate', parts: [{ src: 'wc/ac-2106.MP4', from: 4, to: 9 }], poster: 0.2 },
  { name: 'curtains', parts: [{ src: 'video-pk/C2817.MP4', from: 3, to: 15.5 }], poster: 0 },
  { name: 'music', parts: [{ src: 'wc/media-2562.MP4', from: 14, to: 19 }], poster: 4.95 },
  { name: 'security', parts: [{ src: 'wc/cctv-0179.MP4', from: 0.3, to: 5.3 }], poster: 0.2 },
  { name: 'access', parts: [{ src: 'wc/bell-2107.MP4', from: 3.8, to: 6.8 }, { src: 'wc/phone-2096.MP4', from: 14, to: 17 }], poster: 2.2 },
  // Home theatre
  { name: 'cinema', parts: [{ src: 'wc/cinema-2589.MP4', from: 0.5, to: 5.5 }], poster: 2.5 },
  { name: 'control', parts: [{ src: 'video-dr/C0010.MP4', from: 18, to: 23, turn: 2, grade: GRADE }], poster: 4.95 },
];
// The Seshu theatre was shot dark: lift it (as its stills on the project page are lifted).
const SESHU = 'eq=gamma=1.25:contrast=1.05:saturation=1.08';
// The stepped stories: Walk through intelligence (Automation) and Seven moments (Home theatre).
const STEP_FILMS = [
  // Automation: the Prudvi Kotta entrance at dusk; living rooms across the projects, their lights
  // coming up; the Prudvi Kotta sheers opening on the garden.
  { name: 'entrance', parts: [{ src: 'video-pk/C2880.MP4', from: 0, to: 5.5, y: 0.6 }], poster: 7.6 },
  { name: 'living', parts: [
    { src: 'video-ss/C2034.MP4', from: 2.5, to: 7.5 },
    { src: 'wc/living-0176.MP4', from: 2.5, to: 7.5, grade: 'eq=gamma=1.25:saturation=1.1,colorbalance=rs=0.04:bs=-0.04:rm=0.05:bm=-0.05:rh=0.03:bh=-0.03' },
    { src: 'video-pk/C2817.MP4', from: 18, to: 25, y: 0.8 },
  ], poster: 2.4 },
  { name: 'curtains', parts: [{ src: 'video-pk/C2817.MP4', from: 0.5, to: 14.5, y: 0.5 }], poster: 6.5 },
  // Home theatre: one moment each, from three theatres in the shoots (video-dr, video-ss and wc).
  { name: 'space', parts: [{ src: 'video-dr/C0008.MP4', from: 0.3, to: 8.3, push: [1, 1.08], grade: 'hqdn3d=3:3:4:4' }], poster: 4 },
  { name: 'lighting', parts: [{ src: 'wc/front-2573.MP4', from: 6, to: 14 }], poster: 7.6 },
  { name: 'screen', parts: [{ src: 'wc/screen-2594.MP4', from: 10.5, to: 17.7, overlay: { film: `${OUT}/theatre/film.mp4`, at: 2, rect: [964, 716, 1964, 824], start: 1.6, fade: 1.4 } }], poster: 7.4 },
  { name: 'sound', parts: [{ src: 'wc/front-2573.MP4', from: 14, to: 20, x: 0, y: 0.8, push: [1.15, 1.4] }], poster: 6 },
  { name: 'acoustics', parts: [{ src: 'video-ss/C2016.MP4', from: 1, to: 10, grade: SESHU }], poster: 7.5 },
  { name: 'control', parts: [{ src: 'video-ss/C2026.MP4', from: 0.2, to: 4.2, x: 0.85, grade: SESHU }], poster: 0.5 },
  { name: 'cinema', parts: [{ src: 'video-ss/C2013.MP4', from: 2, to: 10, grade: SESHU }], poster: 3.4 },
];

const FILM_SETS = {
  cards: { films: CARD_FILMS, seconds: 5, dissolve: 0.4, poster: [1080, 1440], pic: 'card',
    sizes: [{ suffix: '', w: 720, h: 960, crf: 23 }, { suffix: '-sm', w: 480, h: 640, crf: 25 }] },
  steps: { films: STEP_FILMS, seconds: 8, dissolve: 0.6, poster: [1920, 1440], pic: 'step',
    sizes: [{ suffix: '', w: 1440, h: 1080, crf: 23 }, { suffix: '-sm', w: 800, h: 600, crf: 25 }] },
};

// Scale to cover the frame and crop; with `push`, cover the frame at the closer zoom first, then
// shrink from there frame by frame (so the push never enlarges a picture already made smaller).
function frameChain(p, w, h, each) {
  const steps = [p.turn ? `transpose=${p.turn}` : null];
  if (p.push) {
    const [z0, z1] = p.push, W = Math.ceil((w * z1) / 2) * 2, H = Math.ceil((h * z1) / 2) * 2;
    steps.push(`scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos`, `crop=${W}:${H}:(iw-${W})*${p.x ?? 0.5}:(ih-${H})*${p.y ?? 0.5}`,
      `scale=w='2*trunc(${w}*(${z0}+(${z1 - z0})*min(t/${each.toFixed(3)},1))/2)':h=-2:eval=frame:flags=lanczos`,
      `crop=${w}:${h}:(iw-${w})*${p.x ?? 0.5}:(ih-${h})*${p.y ?? 0.5}`);
  } else {
    steps.push(`scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos`, `crop=${w}:${h}:(iw-${w})*${p.x ?? 0.5}:(ih-${h})*${p.y ?? 0.5}`);
  }
  steps.push(p.grade || null);
  return steps.filter(Boolean).join(',');
}
// Each part gets an equal share of the film, plus the overlap it dissolves through.
function partTimes(f, set) {
  const each = (set.seconds + set.dissolve * (f.parts.length - 1)) / f.parts.length;
  return f.parts.map((p, i) => ({ p, each, start: i * (each - set.dissolve), speed: (p.to - p.from) / each }));
}
function cutFilm(f, set, { w, h, crf }, file) {
  const parts = partTimes(f, set);
  const args = ['-y', '-loglevel', 'error'];
  parts.forEach(({ p }) => args.push('-ss', String(p.from), '-to', String(p.to), '-i', `_src/drive/video/${p.src}`));
  let extra = parts.length;
  const chains = parts.map(({ p, speed, each }, i) => {
    let base = `[${i}:v]setpts=(PTS-STARTPTS)/${speed.toFixed(4)},fps=30`;
    if (p.overlay) {
      const o = p.overlay, [ox, oy, ow, oh] = o.rect, k = extra++;
      args.push('-ss', String(o.at || 0), '-i', o.film);
      base = `[${k}:v]scale=${ow}:${oh}:flags=lanczos,format=yuva420p,fade=t=in:st=${o.start}:d=${o.fade}:alpha=1,setpts=PTS-STARTPTS[ov${i}];`
        + `${base}[base${i}];[base${i}][ov${i}]overlay=${ox}:${oy}:shortest=1`;
    }
    return `${base},${frameChain(p, w, h, each)},format=yuv420p,trim=duration=${each.toFixed(3)},setpts=PTS-STARTPTS,settb=AVTB[v${i}]`;
  });
  let graph = chains.join(';');
  let last = 'v0';
  for (let i = 1; i < parts.length; i++) {
    graph += `;[${last}][v${i}]xfade=transition=fade:duration=${set.dissolve}:offset=${parts[i].start.toFixed(3)}[x${i}]`;
    last = `x${i}`;
  }
  args.push('-filter_complex', graph, '-map', `[${last}]`, '-t', String(set.seconds), '-an', '-c:v', 'libx264',
    '-preset', 'slow', '-crf', String(crf), '-profile:v', 'high', '-movflags', '+faststart', '-pix_fmt', 'yuv420p', file);
  execFileSync(ffmpeg, args, { stdio: 'inherit' });
  console.log('film', path.basename(file), `${(statSync(file).size / 1024).toFixed(0)} KB`);
}
// A film's photograph: the poster moment of the finished film, rendered at full poster size
// from the 4K source (so stitched parts and overlays are exactly as the film shows them).
async function cutPoster(f, set, dir) {
  const tmp = `${dir}/.${f.name}.mp4`, png = `${dir}/${f.name}.png`;
  cutFilm(f, set, { w: set.poster[0], h: set.poster[1], crf: 10 }, tmp);
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-ss', String(f.poster), '-i', tmp, '-frames:v', '1', png]);
  await sharp(png).jpeg({ quality: 93, chromaSubsampling: '4:4:4', mozjpeg: true }).toFile(`${dir}/${f.name}.jpg`);
  unlinkSync(png);
  unlinkSync(tmp);
  console.log('poster', f.name, `${f.poster}s`);
}

// Cut a set's films (public/media/<set>/) and posters (_src/<set>/); only missing ones unless forced.
async function films(name, { force = false, pick = null } = {}) {
  const set = FILM_SETS[name];
  const out = `${OUT}/${name}`, dir = `_src/${name}`;
  mkdirSync(out, { recursive: true });
  mkdirSync(dir, { recursive: true });
  const keep = new Set();
  for (const f of set.films) {
    const ready = f.parts.every((p) => existsSync(`_src/drive/video/${p.src}`));
    const redo = force && (!pick || pick === f.name);
    for (const s of set.sizes) {
      const file = `${out}/${f.name}${s.suffix}.mp4`;
      keep.add(file);
      if (ready && (redo || !existsSync(file))) cutFilm(f, set, s, file);
    }
    if (ready && (redo || !existsSync(`${dir}/${f.name}.jpg`))) await cutPoster(f, set, dir);
  }
  for (const f of readdirSync(out)) if (!keep.has(`${out}/${f}`)) unlinkSync(`${out}/${f}`);
}

// Film photographs (films() writes them): pictures named card-<film> and step-<film>.
function filmPhotos() {
  const found = {};
  for (const [name, set] of Object.entries(FILM_SETS)) {
    for (const f of set.films) {
      const src = `_src/${name}/${f.name}.jpg`;
      if (existsSync(src)) found[`${set.pic}-${f.name}`] = src;
    }
  }
  return found;
}
// Stock photographs for the homepage cards (Unsplash License; sources in _src/stock/CREDITS.md):
// _src/stock/home-<card>.jpg becomes the picture home-<card>.
function stockPhotos() {
  const dir = '_src/stock';
  if (!existsSync(dir)) return {};
  return Object.fromEntries(readdirSync(dir).filter((f) => /^home-.+\.jpg$/.test(f)).map((f) => [f.replace(/\.jpg$/, ''), `${dir}/${f}`]));
}

const only = process.argv[2];
if (only === 'hero') await hero();
if (only === 'cards' || only === 'steps') await films(only, { force: true, pick: process.argv[3] || null });
else if (!only) { await films('cards'); await films('steps'); }
if (!only || only === 'room') await room();
if (!only || only === 'theatre') await theatre();
if (!only || only === 'designer') await designer();
if (!only || only === 'photos') await photos();
if (!only || only === 'brand') await brandLogo();
if (!only || only === 'logos') await logos();
if (!only || only === 'clients') await clients();
if (!only || only === 'videos') await videos();
console.log('done:', readdirSync(`${OUT}/img`).length, 'images,', readdirSync(`${OUT}/logos`).length, 'logos');
