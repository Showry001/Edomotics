// One room, one day: a wall keypad drives the bedroom. Three keys work one thing each (lights,
// fan, curtains); three set a scene (welcome, twilight, away). One state is the only truth and
// every key, caption and pixel reads from it, so a press can be reversed mid-way without the
// room and the keypad ever disagreeing. The room itself is mixed live from rendered light
// layers (gl.js); without WebGL2 the keys swap between finished stills instead.
import { gsap, ScrollTrigger, $, $$, EASE, DUR, reduced } from '../core.js';
import ROOM from '../../media-room.json';
import LOOK from './look.json';

const BASE = `${import.meta.env.BASE_URL}media/room/`;
const TALL = '(max-aspect-ratio: 1/1)';        // portrait screens get the portrait render
const FOCUS = { wide: [0.5, 0.5], tall: [0.62, 0.42] };   // as object-position on the stills (sections.css)
const LIGHTS = ['cove', 'down', 'lamp'];
const FAN_TURNS = 4;                            // thirds of a turn per press (the blades repeat every 120°)
const LUMA = [0.2126, 0.7152, 0.0722];

const NAMES = {
  welcome: 'Welcome', twilight: 'Twilight', away: 'Away',
  'lights-on': 'Lights on', 'lights-off': 'Lights off', fan: 'Fan on', 'fan-done': 'Fan off',
  'curtains-closing': 'Curtains closing', 'curtains-opening': 'Curtains opening',
  'curtains-closed': 'Curtains closed', 'curtains-open': 'Curtains open',
};

export function initRoom(view, bag) {
  const room = $('[data-room]', view);
  if (!room) return;
  const media = $('[data-room-media]', room);
  const layers = $('[data-room-frame]', room);
  const keys = $$('[data-key]', room);
  const caps = $$('[data-room-cap]', room);
  const stateEl = $('[data-keypad-state]', room);
  const keypad = $('[data-keypad]', room);

  // What the keys asked for, and where the room is on its way there.
  const target = { lights: 'on', c: 0 };
  const live = { cove: 1, down: 1, lamp: 1, c: 0, curtOn: 0, fanOn: 0, fanPos: 0, fanBlur: 0 };
  let spinning = false;
  let lastCap = 'welcome';
  let lastKey = 'welcome';

  /* ---------------- the picture ---------------- */
  let gl = null, canvas = null, set = null, dirty = true, alive = true;
  const stills = { el: null, files: null };

  const weights = () => [LOOK.day, ...LIGHTS.map((g) => [live[g], live[g], live[g]])];
  // Darker scenes get a little more exposure, the way eyes adjust (export.py makes the stills the same way).
  function exposure(w) {
    const lum = (s) => w.reduce((sum, wg, g) => sum + wg.reduce((a, x, i) => a + x * set.mean[s * 4 + g][i] * LUMA[i], 0), 0);
    const top = [LOOK.day, [1, 1, 1], [1, 1, 1], [1, 1, 1]].reduce((sum, wg, g) => sum + wg.reduce((a, x, i) => a + x * set.mean[g][i] * LUMA[i], 0), 0);
    const now = lum(0) * (1 - live.c) + lum(1) * live.c;
    const { strength, max } = LOOK.adapt;
    return LOOK.exposure + Math.min(max, Math.max(0, strength * Math.log2(top / Math.max(now, 1e-6))));
  }
  function frame() {
    if (!dirty || !gl) return;
    dirty = false;
    const w = weights();
    gl.draw({ w, c: live.c, curtOn: live.curtOn, fanOn: live.fanOn, fanPos: live.fanPos, fanBlur: live.fanBlur, ev: exposure(w), balance: LOOK.balance });
  }
  const request = () => { dirty = true; };
  gsap.ticker.add(frame);
  bag.add(() => gsap.ticker.remove(frame));

  const framing = () => (window.matchMedia(TALL).matches ? 'tall' : 'wide');
  let createRoomGL = null;
  async function mountGL() {
    try {
      ({ createRoomGL } = await import('./gl.js'));    // fetched only when the room is near
    } catch (err) {
      console.error('[edomotics] room', err);
      return fallback();
    }
    if (!alive || gl) return;
    const name = framing();
    set = ROOM[name];
    if (!set) return fallback();
    canvas = Object.assign(document.createElement('canvas'), { className: 'room__canvas' });
    canvas.setAttribute('aria-hidden', 'true');
    layers.append(canvas);
    try {
      gl = createRoomGL(canvas, set, BASE, () => { unmountGL(); fallback(); });
    } catch (err) {
      console.error('[edomotics] room', err);
      canvas.remove();
      canvas = null;
      return fallback();
    }
    gl.resize(...FOCUS[name]);
    const mine = gl;
    gl.ready.then(() => {
      if (gl !== mine || !alive) return;
      dirty = true;
      frame();
      canvas.classList.add('is-live');
    }).catch((err) => {
      if (gl !== mine) return;
      console.error('[edomotics] room', err);
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

  // No WebGL2: finished stills, one per lighting and curtain state, cross-faded.
  function fallback() {
    if (stills.el) return;
    const name = framing();
    stills.files = ROOM[name]?.stills;
    if (!stills.files) return;
    stills.el = Object.assign(new Image(), { className: 'room__img room__still', alt: '', decoding: 'async' });
    stills.el.setAttribute('aria-hidden', 'true');
    layers.append(stills.el);
    showStill();
  }
  function showStill() {
    if (!stills.el) return;
    const file = stills.files[`${target.lights}-${target.c ? 'closed' : 'open'}`];
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

  /* ---------------- the devices ---------------- */
  function setLights(mode) {
    target.lights = mode;
    const to = LOOK.lights[mode];
    gsap.to(live, { ...Object.fromEntries(LIGHTS.map((g) => [g, to[g]])), duration: reduced ? 0.2 : 1.4, ease: 'sine.inOut', overwrite: 'auto', onUpdate: request });
  }
  let curtainTween = null;
  function setCurtain(to) {
    target.c = to;
    curtainTween?.kill();
    if (live.c === to) return;
    const motion = !reduced;
    live.curtOn = motion ? 1 : 0;
    curtainTween = gsap.to(live, {
      c: to, duration: motion ? Math.max(0.6, 2.4 * Math.abs(to - live.c)) : 0.3, ease: 'sine.inOut',
      onUpdate: request,
      onComplete: () => { live.curtOn = 0; request(); if (lastKey === 'curtains') say(to ? 'curtains-closed' : 'curtains-open'); },
    });
  }
  let fanTween = null;
  function spin() {
    if (reduced) {
      // No turning blades for reduced motion: the key and the state line still answer.
      spinning = true;
      fanTween?.kill();
      fanTween = gsap.delayedCall(1.2, () => { spinning = false; indicate(); if (lastKey === 'fan') say('fan-done'); });
      return;
    }
    const n = set?.fan?.frames || 24;
    const from = live.fanPos;
    const to = (Math.ceil(from / n - 1e-6) + FAN_TURNS) * n;
    let last = from, lastT = performance.now();
    const running = spinning;                    // pressed again while turning: keep going, then slow
    spinning = true;
    live.fanOn = 1;
    fanTween?.kill();
    fanTween = gsap.to(live, {
      fanPos: to, duration: 1.35, ease: running ? 'power2.out' : 'power2.inOut',
      onUpdate: () => {
        // Motion blur: the shutter stays open for about half the time between frames.
        const now = performance.now();
        const dt = Math.max(1, now - lastT);
        live.fanBlur = Math.min(n / 2, (Math.abs(live.fanPos - last) * 0.5 * 16.7) / dt);
        last = live.fanPos;
        lastT = now;
        request();
      },
      onComplete: () => {
        live.fanPos = 0; live.fanOn = 0; live.fanBlur = 0;
        spinning = false;
        request();
        indicate();
        if (lastKey === 'fan') say('fan-done');
      },
    });
  }

  /* ---------------- keys, captions, the state line ---------------- */
  const ON = {
    lights: () => target.lights !== 'off',
    fan: () => spinning,
    curtains: () => target.c === 1,
    welcome: () => target.lights === 'on' && target.c === 0,
    twilight: () => target.lights === 'twilight',
    away: () => target.lights === 'off' && target.c === 1,
  };
  function indicate() {
    keys.forEach((k) => {
      const on = ON[k.dataset.key]();
      k.classList.toggle('is-on', on);
      k.setAttribute('aria-pressed', String(on));
    });
  }
  const say = (key) => { if (stateEl) stateEl.textContent = NAMES[key]; };

  let capTl = null;
  const capFor = (k) => caps.find((c) => c.dataset.roomCap === k);
  function showCap(nextKey) {
    if (nextKey === lastCap) return;
    const prev = capFor(lastCap), next = capFor(nextKey);
    lastCap = nextKey;
    caps.forEach((c) => c.classList.toggle('is-active', c === next));
    capTl?.progress(1).kill();
    if (reduced || !prev || !next) return;
    const out = [$('.mask > span', prev), $('p', prev)];
    capTl = gsap.timeline()
      .set(prev, { visibility: 'visible' })
      .to(out[0], { yPercent: -105, duration: 0.55, ease: EASE.io }, 0)
      .to(out[1], { autoAlpha: 0, duration: 0.4, ease: EASE.io }, 0)
      .set(prev, { clearProps: 'visibility' })
      .set(out, { clearProps: 'all' })
      .fromTo($('.mask > span', next), { yPercent: 105 }, { yPercent: 0, duration: 0.9, ease: EASE.out }, 0.35)
      .fromTo($('p', next), { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.8, ease: EASE.out }, 0.5);
  }

  const ACTIONS = {
    lights: () => { const on = target.lights === 'off'; setLights(on ? 'on' : 'off'); say(on ? 'lights-on' : 'lights-off'); },
    fan: () => { spin(); say('fan'); },
    curtains: () => { const close = target.c === 0; setCurtain(close ? 1 : 0); say(close ? 'curtains-closing' : 'curtains-opening'); },
    welcome: () => { setLights('on'); setCurtain(0); say('welcome'); },
    twilight: () => { setLights('twilight'); say('twilight'); },
    away: () => { setLights('off'); setCurtain(1); say('away'); },
  };
  keys.forEach((k) => bag.on(k, 'click', () => {
    lastKey = k.dataset.key;
    ACTIONS[lastKey]();
    showCap(k.dataset.key);
    indicate();
    showStill();
    request();
  }));
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
  // Nothing is fetched until the room is about a screen and a half away.
  const io = new IntersectionObserver(([entry]) => {
    if (!entry.isIntersecting) return;
    io.disconnect();
    if (canGL) mountGL(); else fallback();
  }, { rootMargin: '150% 0px 150% 0px' });
  io.observe(room);
  bag.add(() => io.disconnect());

  const ro = new ResizeObserver(() => { if (gl) { gl.resize(...FOCUS[framing()]); request(); } });
  ro.observe(media);
  bag.add(() => ro.disconnect());
  // Turning a phone or tablet swaps the portrait and landscape renders.
  const mq = window.matchMedia(TALL);
  const swap = () => {
    if (gl) { unmountGL(); mountGL(); }
    if (stills.el) { stills.el.remove(); stills.el = null; fallback(); }
  };
  bag.on(mq, 'change', swap);
  bag.add(() => {
    alive = false;
    capTl?.kill(); curtainTween?.kill(); fanTween?.kill();
    gsap.killTweensOf(live);
    unmountGL();
  });

  if (reduced) return;
  // Arrival: the room settles from a slight push as it scrolls in; the keypad follows.
  gsap.fromTo(media, { scale: 1.12 }, {
    scale: 1, ease: 'none',
    scrollTrigger: { trigger: room, start: 'top bottom', end: 'top top', scrub: true },
  });
  const enter = gsap.timeline({ paused: true })
    .from(keypad, { y: 48, autoAlpha: 0, duration: DUR.slow, ease: EASE.out })
    .from($$('.mask > span', capFor('welcome')), { yPercent: 105, duration: DUR.base, ease: EASE.out }, 0.1)
    .from($('p', capFor('welcome')), { autoAlpha: 0, duration: DUR.base, ease: EASE.out }, 0.25);
  ScrollTrigger.create({ trigger: room, start: 'top 55%', once: true, onEnter: () => enter.play() });
  // Ambience: the room breathes slowly while it's on screen.
  const breathe = gsap.to(layers, { scale: 1.035, duration: 9, ease: 'sine.inOut', yoyo: true, repeat: -1, paused: true });
  ScrollTrigger.create({
    trigger: room, start: 'top bottom', end: 'bottom top',
    onToggle: (self) => (self.isActive ? breathe.resume() : breathe.pause()),
  });
}
