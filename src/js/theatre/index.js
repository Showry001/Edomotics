// One theatre: a wall keypad of six scenes drives a home cinema. The room is mixed live from
// rendered light layers (gl.js); without WebGL2 the keys swap between finished stills instead.
//
// Cinema: the screen comes down, the lights go out, the stars come on, the projector warms up and
// the film plays. Intermission: the film holds and the room comes up softly. Pre-show: the screen
// comes down to the Edomotics card under warm light. Lounge, lights on and off take the screen back
// up. The picture never moves on its own: only a key changes it.
import { gsap, ScrollTrigger, $, $$, EASE, DUR, reduced } from '../core.js';
import THEATRE from '../../media-theatre.json';
import LOOK from './look.json';

const BASE = `${import.meta.env.BASE_URL}media/theatre/`;
const TALL = '(max-aspect-ratio: 1/1)';
const FOCUS = { wide: [0.5, 0.5], tall: [0.5, 0.42] };    // as object-position on the stills (sections.css)
const GROUPS = THEATRE.groups;                           // ambient, house, cove, stars, step
const LIGHTS = GROUPS.slice(1);
const LUMA = [0.2126, 0.7152, 0.0722];
const START = 'lounge';
const STILL_AT = 4;              // seconds into the film: the frame the stills (and film-still) show
const T = reduced
  ? { drop: 0.4, lights: 0.3, warm: 0.2, fade: 0.2 }
  : { drop: 3.4, lights: 2.2, warm: 0.9, fade: 1.0 };   // seconds: screen travel, light fades, projector

export function initTheatre(view, bag) {
  const room = $('[data-theatre]', view);
  if (!room) return;
  const media = $('[data-theatre-media]', room);
  const layers = $('[data-theatre-frame]', room);
  const keys = $$('[data-scene]', room);
  const keypad = $('[data-keypad]', room);

  const first = LOOK.scenes[START];
  const live = { ...Object.fromEntries(LIGHTS.map((g) => [g, first[g]])), s: 0, proj: 0, picMix: 0 };
  let scene = START;
  let shown = null;           // what the projector has: 'card' | 'film'
  let tl = null;

  /* ---------------- the picture ---------------- */
  let gl = null, canvas = null, set = null, dirty = true, alive = true;
  const stills = { el: null, files: null };

  const weights = () => [LOOK.ambient, ...LIGHTS.map((g) => live[g])].map((v) => [v, v, v]);
  const lum = (rgb) => rgb.reduce((a, x, i) => a + x * LUMA[i], 0);
  const content = () => (shown === 'card' ? THEATRE.cardMean : THEATRE.film.mean);
  // Darker scenes get a little more exposure, the way eyes adjust (export.py grades the stills alike).
  function exposure() {
    const lit = (w) => w.reduce((sum, wg, g) => sum + wg * lum(set.mean[g]), 0);
    const top = lit([LOOK.ambient, ...LIGHTS.map((g) => LOOK.scenes.lights[g])]);
    const now = lit([LOOK.ambient, ...LIGHTS.map((g) => live[g])])
      + lum(set.screenMean.map((v, i) => v * content()[i])) * LOOK.projector * live.proj * live.picMix;
    const { strength, max } = LOOK.adapt;
    return LOOK.exposure + Math.min(max, Math.max(0, strength * Math.log2(top / Math.max(now, 1e-6))));
  }
  function frame() {
    if (gl && film.fresh && shown === 'film') { film.fresh = false; gl.picture(film.el); dirty = true; }
    if (!dirty || !gl) return;
    dirty = false;
    gl.draw({ w: weights(), s: live.s, proj: live.proj, picMix: live.picMix, ev: exposure(), balance: LOOK.balance });
  }
  const request = () => { dirty = true; };
  gsap.ticker.add(frame);
  bag.add(() => gsap.ticker.remove(frame));

  const framing = () => (window.matchMedia(TALL).matches ? 'tall' : 'wide');
  async function mountGL() {
    let createTheatreGL;
    try {
      ({ createTheatreGL } = await import('./gl.js'));    // fetched only when the theatre is near
    } catch (err) {
      console.error('[edomotics] theatre', err);
      return fallback();
    }
    if (!alive || gl) return;
    const name = framing();
    set = THEATRE[name];
    if (!set) return fallback();
    canvas = Object.assign(document.createElement('canvas'), { className: 'room__canvas' });
    canvas.setAttribute('aria-hidden', 'true');
    layers.append(canvas);
    try {
      gl = createTheatreGL(canvas, set, BASE, () => { unmountGL(); fallback(); });
    } catch (err) {
      console.error('[edomotics] theatre', err);
      canvas.remove();
      canvas = null;
      return fallback();
    }
    gl.resize(...FOCUS[name]);
    const mine = gl;
    if (shown) showPicture(shown, true);
    gl.ready.then(() => {
      if (gl !== mine || !alive) return;
      dirty = true;
      frame();
      canvas.classList.add('is-live');
    }).catch((err) => {
      if (gl !== mine) return;
      console.error('[edomotics] theatre', err);
      unmountGL();
      fallback();
    });
  }
  function unmountGL() {
    gl?.dispose();
    canvas?.remove();
    gl = null;
    canvas = null;
  }

  // No WebGL2: finished stills, one per scene, cross-faded.
  function fallback() {
    if (stills.el) return;
    stills.files = THEATRE[framing()]?.stills;
    if (!stills.files) return;
    stills.el = Object.assign(new Image(), { className: 'room__img room__still', alt: '', decoding: 'async' });
    stills.el.setAttribute('aria-hidden', 'true');
    layers.append(stills.el);
    showStill();
  }
  function showStill() {
    if (!stills.el) return;
    const file = stills.files[scene];
    if (!file) return;
    const next = new Image();
    next.onload = () => {
      if (!stills.el) return;
      gsap.to(stills.el, { autoAlpha: 0, duration: reduced ? 0 : 0.35, ease: EASE.io, onComplete: () => {
        if (!stills.el) return;
        stills.el.src = next.src;
        gsap.to(stills.el, { autoAlpha: 1, duration: reduced ? 0 : 0.6, ease: EASE.io });
      } });
    };
    next.src = BASE + file;
  }

  /* ---------------- the film ---------------- */
  // A muted, looping video, made only when it's first needed. Each new frame is copied to the
  // screen (requestVideoFrameCallback where there is one; otherwise every tick while it plays).
  // With reduced motion the screen holds a single frame of it instead.
  const film = { el: null, fresh: false, want: false, onScreen: true };
  function filmEl() {
    if (film.el || reduced || !THEATRE.film.src) return film.el;
    const v = document.createElement('video');
    Object.assign(v, { muted: true, loop: true, playsInline: true, preload: 'auto', src: BASE + THEATRE.film.src });
    v.setAttribute('aria-hidden', 'true');
    v.setAttribute('playsinline', '');
    v.className = 'theatre__film';
    // Start where the stills' frame is, so the picture doesn't jump when the video takes over.
    v.addEventListener('loadedmetadata', () => { if (!v.currentTime) v.currentTime = STILL_AT; }, { once: true });
    room.append(v);
    const onFrame = () => {
      if (!film.el) return;
      film.fresh = true;
      if ('requestVideoFrameCallback' in v) v.requestVideoFrameCallback(onFrame);
    };
    if ('requestVideoFrameCallback' in v) v.requestVideoFrameCallback(onFrame);
    else {
      const poll = () => { if (film.el && !v.paused && v.readyState >= 2) film.fresh = true; };
      gsap.ticker.add(poll);
      bag.add(() => gsap.ticker.remove(poll));
    }
    film.el = v;
    return v;
  }
  function play(on) {
    film.want = on;
    const v = on ? filmEl() : film.el;
    if (!v) return;
    if (on && film.onScreen) v.play().catch(() => {});
    else v.pause();
  }
  // What the projector shows. The film starts on its own first frame until the video has one.
  function showPicture(kind, now = false) {
    shown = kind;
    if (!gl) return;
    if (kind === 'card') gl.picture(BASE + THEATRE.card).then(request).catch(() => {});
    else {
      const v = filmEl();
      if (v && v.readyState >= 2) { gl.picture(v); request(); }
      else if (THEATRE.film.still) gl.picture(BASE + THEATRE.film.still).then(request).catch(() => {});
    }
    if (now) request();
  }

  /* ---------------- scenes ---------------- */
  // The stars wait until the room has mostly gone dark, the way a cinema brings them up.
  function lights(to, at, duration = T.lights) {
    const others = LIGHTS.filter((g) => g !== 'stars');
    tl.to(live, { ...Object.fromEntries(others.map((g) => [g, to[g]])), duration, ease: 'sine.inOut' }, at);
    const later = to.stars > live.stars && !reduced ? duration * 0.5 : 0;
    tl.to(live, { stars: to.stars, duration: duration * (later ? 0.8 : 1), ease: 'sine.inOut' }, at + later);
  }
  function go(name) {
    const to = LOOK.scenes[name];
    scene = name;
    tl?.kill();
    tl = gsap.timeline({ onUpdate: request });
    if (name !== 'cinema') play(false);                      // intermission: the picture holds at once
    if (to.picture === 'film') filmEl();                     // start loading while the screen comes down
    if (to.screen) {
      let at = 0;
      if (live.s < 1) {
        // Down it comes; the room dims as it travels, and the projector starts once it lands.
        const travel = T.drop * (1 - live.s);
        tl.to(live, { s: 1, duration: travel, ease: 'power1.inOut' }, 0);
        lights(to, reduced ? 0 : 0.3);
        at = travel;
      } else {
        lights(to, 0, name === 'cinema' ? T.lights : T.lights * 0.8);
      }
      if (shown !== to.picture && live.picMix > 0) {
        tl.to(live, { picMix: 0, duration: T.fade * 0.5, ease: 'sine.in' }, at);
        at += T.fade * 0.5;
      }
      tl.add(() => { if (shown !== to.picture) showPicture(to.picture); }, at);
      if (live.proj < 1) {
        tl.to(live, { proj: 1, duration: T.warm, ease: 'power2.out' }, at);       // warming up: a dark glow
        at += T.warm;
      }
      tl.to(live, { picMix: 1, duration: T.fade, ease: 'sine.inOut' }, at);
      if (to.picture === 'film' && name !== 'intermission') {
        tl.add(() => { if (scene === name) play(true); }, Math.max(at, live.s >= 1 ? T.lights * 0.4 : at));
      }
    } else {
      // The picture goes, the projector stops, then the screen goes back up.
      let at = 0;
      if (live.proj > 0) {
        tl.to(live, { picMix: 0, proj: 0, duration: T.fade * 0.7, ease: 'sine.inOut' }, 0);
        at = T.fade * 0.6;
      }
      if (live.s > 0) tl.to(live, { s: 0, duration: T.drop * 0.9 * live.s, ease: 'power1.inOut' }, at);
      lights(to, 0);
    }
    indicate();
    showStill();
    request();
  }
  function indicate() {
    keys.forEach((k) => {
      const on = k.dataset.scene === scene;
      k.classList.toggle('is-on', on);
      k.setAttribute('aria-pressed', String(on));
    });
  }
  keys.forEach((k) => bag.on(k, 'click', () => go(k.dataset.scene)));
  indicate();

  /* ---------------- loading, resizing, leaving ---------------- */
  const canGL = (() => {
    try {
      const probe = document.createElement('canvas').getContext('webgl2');
      probe?.getExtension('WEBGL_lose_context')?.loseContext();
      return !!probe;
    } catch {
      return false;
    }
  })();
  // Nothing is fetched until the theatre is about a screen and a half away.
  const io = new IntersectionObserver(([entry]) => {
    if (!entry.isIntersecting) return;
    io.disconnect();
    if (canGL) mountGL(); else fallback();
  }, { rootMargin: '150% 0px 150% 0px' });
  io.observe(room);
  bag.add(() => io.disconnect());
  // The film rests while the theatre is off screen.
  const seen = new IntersectionObserver(([entry]) => {
    film.onScreen = entry.isIntersecting;
    if (film.el) play(film.want);
  });
  seen.observe(room);
  bag.add(() => seen.disconnect());

  const ro = new ResizeObserver(() => { if (gl) { gl.resize(...FOCUS[framing()]); request(); } });
  ro.observe(media);
  bag.add(() => ro.disconnect());
  const mq = window.matchMedia(TALL);
  const swap = () => {
    if (gl) { unmountGL(); mountGL(); }
    if (stills.el) { stills.el.remove(); stills.el = null; fallback(); }
  };
  bag.on(mq, 'change', swap);
  bag.add(() => {
    alive = false;
    tl?.kill();
    gsap.killTweensOf(live);
    if (film.el) { film.el.pause(); film.el.removeAttribute('src'); film.el.load(); film.el.remove(); film.el = null; }
    unmountGL();
  });

  if (reduced) return;
  // The room holds still; only a key press changes it. The keypad rises in once.
  const enter = gsap.from(keypad, { y: 48, autoAlpha: 0, duration: DUR.slow, ease: EASE.out, paused: true });
  ScrollTrigger.create({ trigger: room, start: 'top 55%', once: true, onEnter: () => enter.play() });
}
