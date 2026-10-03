// Media pipeline: responsive AVIF + WebP sizes, monochrome partner logos, web-ready video.
// Run with `npm run media`. Sources live in _src/; output goes to public/media/.
import sharp from 'sharp';
import ffmpeg from 'ffmpeg-static';
import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, readdirSync, writeFileSync, unlinkSync, copyFileSync, statSync } from 'node:fs';
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
  'living-hex-dusk': `${brief}/living-hex-dusk.webp`,
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
  // Leadership portraits, from the Edomotics Framer site (365px originals: shown small, never upscaled).
  'founder-ganesh-vudutha': '_src/founders/ganesh-vudutha.jpg',
  'founder-keshava-varma': '_src/founders/keshava-varma.jpg',
  'founder-manjunath-n-m': '_src/founders/manjunath-n-m.jpg',
  'team-hyderabad': `${framer}/team-hyderabad.jpg`,
  'team-bangalore': `${framer}/team-bangalore.jpg`,
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
  for (const [name, src] of Object.entries({ ...PHOTOS, ...projectPhotos() })) {
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

function frame(src, out, { last = false } = {}) {
  const pre = last ? ['-sseof', '-0.08'] : [];
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', ...pre, '-i', src, '-frames:v', '1', '-update', '1', out]);
}

// Night: the last evening frame, regraded. Mid-tones fall away, the fixtures keep their
// strength and bloom softly — the same frame, so the crossfade can never ghost.
async function nightGrade(src, out, width) {
  const { data, info } = await sharp(src).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  const base = Buffer.alloc(n * 3);
  const hi = Buffer.alloc(n * 3);
  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let i = 0; i < n; i++) {
    const r = data[i * 3] / 255, g = data[i * 3 + 1] / 255, b = data[i * 3 + 2] / 255;
    const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const m = smooth(0.62, 0.9, L);
    const k = 0.32 + 0.18 * L; // darker overall, with enough mid-tone to keep the room legible
    const nr = r * k * 1.06, ng = g * k * 0.95, nb = b * k * 0.9;
    base[i * 3] = Math.round(255 * (nr * (1 - m) + r * m));
    base[i * 3 + 1] = Math.round(255 * (ng * (1 - m) + g * 0.96 * m));
    base[i * 3 + 2] = Math.round(255 * (nb * (1 - m) + b * 0.86 * m));
    hi[i * 3] = Math.round(255 * r * m); hi[i * 3 + 1] = Math.round(255 * g * m * 0.9); hi[i * 3 + 2] = Math.round(255 * b * m * 0.7);
  }
  const raw = { raw: { width: info.width, height: info.height, channels: 3 } };
  const glow = await sharp(hi, raw).blur(Math.max(6, info.width / 70)).linear(0.75, 0).png().toBuffer();
  // sharp resizes before compositing, so composite at full size first, then resize.
  const full = await sharp(base, raw).composite([{ input: glow, blend: 'screen' }]).png().toBuffer();
  await sharp(full).resize({ width, withoutEnlargement: true }).webp({ quality: 78 }).toFile(out);
}

function poster(src, out) {
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', src, '-frames:v', '1', '-q:v', '3', out]);
}

async function videos() {
  const v = '_src/framer/video';
  encode(`${v}/hero.mp4`, `${OUT}/video/hero.mp4`, { width: 1280, crf: 26 });
  encode(`${v}/hero.mp4`, `${OUT}/video/hero-sm.mp4`, { width: 720, crf: 27 });
  poster(`${OUT}/video/hero.mp4`, `${OUT}/video/hero-poster.jpg`);
  await sharp(`${OUT}/video/hero-poster.jpg`).webp({ quality: 72 }).toFile(`${OUT}/video/hero-poster.webp`);

  // Scroll-scrubbed chapters: drop footage into _src/videos/ with these names.
  // The site switches from the photo crossfade to the scrubbed video automatically.
  const available = {};
  for (const name of ['one-room', 'cinema']) {
    const src = `_src/videos/${name}.mp4`;
    available[name] = existsSync(src);
    if (!available[name]) continue;
    encode(src, `${OUT}/video/${name}.mp4`, { scrub: true, width: 1280, crf: 23, gop: 2 });
    encode(src, `${OUT}/video/${name}-sm.mp4`, { scrub: true, width: 720, crf: 25, gop: 2 });
    const tmp = `${OUT}/video/.${name}`;
    frame(src, `${tmp}-first.png`);
    frame(src, `${tmp}-last.png`, { last: true });
    for (const [suffix, w] of [['', 1280], ['-sm', 720]]) {
      await sharp(`${tmp}-first.png`).resize({ width: w }).webp({ quality: 74 }).toFile(`${OUT}/video/${name}-poster${suffix}.webp`);
      if (name === 'one-room') await nightGrade(`${tmp}-last.png`, `${OUT}/video/${name}-night${suffix}.webp`, w);
    }
    unlinkSync(`${tmp}-first.png`);
    unlinkSync(`${tmp}-last.png`);
  }
  writeFileSync('src/media-videos.json', JSON.stringify(available, null, 2));
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

const only = process.argv[2];
if (!only || only === 'photos') await photos();
if (!only || only === 'brand') await brandLogo();
if (!only || only === 'logos') await logos();
if (!only || only === 'clients') await clients();
if (!only || only === 'videos') await videos();
console.log('done:', readdirSync(`${OUT}/img`).length, 'images,', readdirSync(`${OUT}/logos`).length, 'logos');
