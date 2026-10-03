// Scroll chapters: "one room, one day" (the scene console), the opening cinema frame,
// stacked project slides, the principles numeral and the stepped story sequences.
import { gsap, ScrollTrigger, $, $$, EASE, DUR, STAGGER, PIN, reduced, isSmall, videoScrubber, scrollToTarget } from './core.js';
import videos from '../media-videos.json';
import { setHeaderTheme } from './header.js';

const BASE = import.meta.env.BASE_URL; // "/" locally, "/Edomotics/" on GitHub Pages

const pad = (n) => String(n).padStart(2, '0');

/* =====================================================================
   One room, one day — a two-key wall console (Relax, Night) drives the living room.
   One state, u ∈ [0, 1], is the only truth: 0 is Relax (daylight), 1 is Night.
   The film is scrubbed through 0 → FILM_END; the film's last frame regraded for night
   takes over from FILM_END → 1, so the change is pixel-aligned and can't ghost.
   Pressing a key tweens u, so a change can be reversed mid-way and the keys, captions,
   meter and picture can never disagree.
   ===================================================================== */
export function initRoom(view, bag) {
  const room = $('[data-room]', view);
  if (!room) return;
  const media = $('[data-room-media]', room);
  const photoDay = $('[data-room-day]', room);
  const photoNight = $('[data-room-night]', room);
  const keys = $$('[data-mode]', room);
  const caps = $$('[data-room-cap]', room);
  const stateEl = $('[data-console-state]', room);
  const meter = $('[data-console-meter]', room);
  const pulse = $('[data-key-pulse]', room);
  const consoleEl = $('[data-console]', room);

  const TARGET = { relax: 0, night: 1 };
  const LABEL = { relax: 'Relax', night: 'Night' };
  const FILM_START = 0.35; // seconds: a settled daylight frame
  const FILM_END = 0.8;    // share of u spent on the film; the night grade completes the rest
  const FULL = 3.4;        // seconds for a full Relax ⇄ Night change

  const state = { u: 0 };
  let mode = 'relax';
  let tween = null;
  let capTl = null;

  // The film and its night frame, over the photographs (which remain the no-film fallback).
  let video = null, night = null, scrub = null, ready = false;
  const showPhotos = (on) => { photoDay.hidden = !on; photoNight.hidden = !on; };
  if (videos['one-room']) {
    const sm = isSmall() ? '-sm' : '';
    video = Object.assign(document.createElement('video'), { className: 'room__video', muted: true, playsInline: true, preload: 'none' });
    video.setAttribute('aria-hidden', 'true');
    video.disablePictureInPicture = true;
    night = Object.assign(new Image(), { className: 'room__night', alt: '', decoding: 'async' });
    night.setAttribute('aria-hidden', 'true');
    media.append(video, night);
    showPhotos(false);
    // Nothing is fetched until the room is about a screen and a half away: the film is the
    // heaviest file on the page and most visitors meet it well after the first paint.
    const io = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      io.disconnect();
      video.poster = `${BASE}media/video/one-room-poster${sm}.webp`;
      night.src = `${BASE}media/video/one-room-night${sm}.webp`;
      video.preload = 'auto';
      video.src = `${BASE}media/video/one-room${sm}.mp4`;
    }, { rootMargin: '150% 0px 150% 0px' });
    io.observe(room);
    bag.add(() => io.disconnect());
    scrub = videoScrubber(video);
    // iOS paints seeked frames only after one play(); muted playback is allowed.
    const prime = () => video?.play().then(() => { video.pause(); render(); }).catch(() => {});
    bag.on(video, 'loadeddata', () => { ready = true; prime(); render(); }, { once: true });
    bag.on(video, 'error', () => {
      video.remove(); night.remove(); video = null; night = null; scrub = null; ready = false;
      showPhotos(true); render();
    }, { once: true });
    bag.add(() => { if (video) { video.removeAttribute('src'); video.load(); } });
  }

  function render() {
    const u = state.u;
    if (scrub && ready && video.duration) {
      const d = video.duration;
      const t = FILM_START + (d - 0.05 - FILM_START) * Math.min(1, u / FILM_END);
      scrub(t / d);
      night.style.opacity = Math.max(0, (u - FILM_END) / (1 - FILM_END));
    } else if (night) {
      night.style.opacity = u; // film still loading: cross-fade straight over its poster
    } else {
      photoNight.style.opacity = u;
    }
    if (meter) meter.style.transform = `scaleX(${u})`;
  }

  const capFor = (m) => caps.find((c) => c.dataset.roomCap === m);
  function showCap(prevMode, nextMode) {
    const prev = capFor(prevMode);
    const next = capFor(nextMode);
    caps.forEach((c) => c.classList.toggle('is-active', c === next));
    capTl?.progress(1).kill();
    if (reduced || !prev || !next) return;
    const pIn = [$('.mask > span', prev), $('p', prev)];
    capTl = gsap.timeline()
      .set(prev, { visibility: 'visible' })
      .to(pIn[0], { yPercent: -105, duration: 0.55, ease: EASE.io }, 0)
      .to(pIn[1], { autoAlpha: 0, duration: 0.4, ease: EASE.io }, 0)
      .set(prev, { clearProps: 'visibility' })
      .set(pIn, { clearProps: 'all' })
      .fromTo($('.mask > span', next), { yPercent: 105 }, { yPercent: 0, duration: 0.9, ease: EASE.out }, 0.35)
      .fromTo($('p', next), { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.8, ease: EASE.out }, 0.5);
  }

  function setMode(next) {
    if (!(next in TARGET) || next === mode) return;
    const prev = mode;
    mode = next;
    keys.forEach((k) => { const on = k.dataset.mode === next; k.classList.toggle('is-active', on); k.setAttribute('aria-pressed', String(on)); });
    if (stateEl) stateEl.textContent = LABEL[next];
    pulse?.classList.add('is-off');
    showCap(prev, next);
    tween?.kill();
    const to = TARGET[next];
    if (reduced) { state.u = to; render(); return; }
    if (video && !ready) video.play().then(() => video.pause()).catch(() => {}); // a press may be the first chance to load on iOS
    tween = gsap.to(state, { u: to, duration: Math.max(0.6, FULL * Math.abs(to - state.u)), ease: 'sine.inOut', onUpdate: render });
  }
  keys.forEach((k) => bag.on(k, 'click', () => setMode(k.dataset.mode)));
  bag.add(() => { tween?.kill(); capTl?.kill(); });
  render();

  if (reduced) return;
  // Arrival: the room settles from a slight push as it scrolls in; the console follows.
  gsap.fromTo(media, { scale: 1.12 }, {
    scale: 1, ease: 'none',
    scrollTrigger: { trigger: room, start: 'top bottom', end: 'top top', scrub: true },
  });
  const enter = gsap.timeline({ paused: true })
    .from(consoleEl, { y: 48, autoAlpha: 0, duration: DUR.slow, ease: EASE.out })
    .from($$('.mask > span', capFor('relax')), { yPercent: 105, duration: DUR.base, ease: EASE.out }, 0.1)
    .from($('p', capFor('relax')), { autoAlpha: 0, duration: DUR.base, ease: EASE.out }, 0.25);
  ScrollTrigger.create({ trigger: room, start: 'top 55%', once: true, onEnter: () => enter.play() });
  // Ambience: the room breathes slowly while it's on screen.
  const breathe = gsap.to($$('img, video', media), { scale: 1.035, duration: 9, ease: 'sine.inOut', yoyo: true, repeat: -1, paused: true });
  ScrollTrigger.create({
    trigger: room, start: 'top bottom', end: 'bottom top',
    onToggle: (self) => { if (self.isActive) { breathe.resume(); if (video && !ready) video.play().then(() => video.pause()).catch(() => {}); } else breathe.pause(); },
  });
}

/* ---------------- Home theatre: a frame opens to full bleed ---------------- */
export function initCinema(view) {
  const section = $('[data-cinema]', view);
  if (!section) return null;
  const stage = $('.cinema__stage', section);
  const frame = $('[data-cinema-frame]', section);
  const img = $('[data-cinema-img]', section);
  const lines = $$('[data-cinema-title] .mask > span', section);
  const count = $('[data-cinema-count]', section);
  const mm = gsap.matchMedia();
  mm.add({ wide: '(min-width: 768px)', narrow: '(max-width: 767px)' }, (ctx) => {
    const inset = ctx.conditions.wide ? 'inset(18% 32% 18% 32%)' : 'inset(26% 8% 26% 8%)';
    // The frame opens from cream, so the header reads ink until the photograph fills the screen.
    const tl = gsap.timeline({
      defaults: { ease: 'none' },
      scrollTrigger: {
        trigger: stage, start: 'top top', end: () => `+=${window.innerHeight * PIN.cinema}`,
        pin: true, scrub: true, invalidateOnRefresh: true,
        onUpdate: (self) => { if (self.isActive) setHeaderTheme(tl.time() > 0.45 ? 'dark' : 'light'); },
      },
    });
    tl
      .fromTo(frame, { clipPath: inset }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 1, ease: EASE.io }, 0)
      .fromTo(img, { scale: 1.3 }, { scale: 1, duration: 1, ease: EASE.io }, 0)
      .fromTo($('[data-cinema-shade]', section), { opacity: 0 }, { opacity: 1, duration: 0.4 }, 0.6)
      .fromTo(count, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.3 }, 0.7)
      .fromTo(lines, { yPercent: 105 }, { yPercent: 0, duration: 0.45, ease: EASE.out, stagger: STAGGER }, 0.75)
      .to({}, { duration: 0.35 });
  });
  return mm;
}

/* ---------------- Projects: full-bleed photographs wipe over one another ----------------
   Featured-projects sequence. The frame pins; each photograph wipes up over the
   last and drifts as it passes; one caption layer above every photograph swaps to the project
   in view once its photograph covers half the frame; a hairline fills with progress. */
export function initProjects(view, bag) {
  const stage = $('[data-pstage]', view);
  if (!stage) return null;
  const slides = $$('[data-pslide]', stage);
  const medias = slides.map((s) => $('[data-pslide-media]', s));
  const caps = slides.map((s) => $('[data-pcap]', s));
  const bar = $('[data-pstage-bar]', stage);
  const n = slides.length;
  if (!n) return null;
  medias.forEach((m, i) => { m.style.zIndex = i + 1; });

  let active = -1;
  const show = (i, instant = false) => {
    if (i === active) return;
    const prev = active;
    active = i;
    caps.forEach((c, j) => c.classList.toggle('is-active', j === i));
    // Sequenced, not crossfaded: the outgoing caption has gone before the next one rises,
    // so two names never ghost over each other.
    if (prev >= 0) gsap.to($$('.pcap__anim', caps[prev]), { autoAlpha: 0, y: -8, duration: instant ? 0 : 0.22, ease: EASE.io, overwrite: true });
    gsap.fromTo($$('.pcap__anim', caps[i]), { autoAlpha: 0, y: 16 }, {
      autoAlpha: 1, y: 0, duration: instant ? 0 : 0.6, delay: instant || prev < 0 ? 0 : 0.22, ease: EASE.out, stagger: 0.05, overwrite: true,
    });
  };
  gsap.set($$('.pcap__anim', stage), { autoAlpha: 0 });
  show(0, true);

  // Timeline units: slide i finishes wiping in at time i; the last one holds for half a unit.
  const total = n - 0.5;
  gsap.set(medias.slice(1), { clipPath: 'inset(100% 0% 0% 0%)' });
  const tl = gsap.timeline({
    defaults: { ease: 'none' },
    scrollTrigger: {
      trigger: stage, start: 'top top', end: () => `+=${window.innerHeight * PIN.project * total}`,
      pin: true, scrub: true, invalidateOnRefresh: true,
      onUpdate: (self) => {
        show(Math.min(n - 1, Math.floor(tl.time() + 0.5)));
        if (bar) bar.style.transform = `scaleX(${self.progress})`;
      },
    },
  });
  medias.forEach((m, i) => {
    const from = Math.max(0, i - 1);
    const to = i === n - 1 ? total : i + 1;
    tl.fromTo($('img', m), { yPercent: i === 0 ? 0 : 5 }, { yPercent: -5, duration: to - from }, from);
    if (i > 0) tl.to(m, { clipPath: 'inset(0% 0% 0% 0%)', duration: 1, ease: 'power1.inOut' }, i - 1);
  });
  tl.to({}, { duration: 0.01 }, total - 0.01);
  const st = tl.scrollTrigger;

  // Keyboard: focusing a project's link brings its photograph into view.
  medias.forEach((m, i) => bag.on(m, 'focus', () => {
    if (st.isActive && active === i) return;
    scrollToTarget(st.start + (st.end - st.start) * (i / total), { immediate: true });
  }));

  // "View project" rides with the cursor over the photographs.
  const cursor = $('[data-pstage-cursor]', stage);
  if (cursor && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    gsap.set(cursor, { xPercent: -50, yPercent: -50, scale: 0.85 });
    const xTo = gsap.quickTo(cursor, 'x', { duration: 0.45, ease: 'power3' });
    const yTo = gsap.quickTo(cursor, 'y', { duration: 0.45, ease: 'power3' });
    bag.on(stage, 'pointerenter', (e) => {
      gsap.set(cursor, { x: e.clientX, y: e.clientY });
      gsap.to(cursor, { autoAlpha: 1, scale: 1, duration: 0.4, ease: EASE.out, overwrite: 'auto' });
    });
    bag.on(stage, 'pointermove', (e) => { xTo(e.clientX); yTo(e.clientY); });
    bag.on(stage, 'pointerleave', () => gsap.to(cursor, { autoAlpha: 0, scale: 0.85, duration: 0.3, ease: EASE.io, overwrite: 'auto' }));
    bag.add(() => gsap.set(cursor, { autoAlpha: 0 }));
  }
  return null;
}

/* ---------------- Principles: the numeral rolls to the active idea ---------------- */
export function initApproach(view) {
  const items = $$('[data-principle]', view);
  if (!items.length) return;
  const strip = $('[data-numeral]', view);
  const setActive = (i) => {
    items.forEach((el, j) => el.classList.toggle('is-active', i === j));
    if (strip) strip.style.transform = `translateY(${-i}em)`;
  };
  items.forEach((el, i) => ScrollTrigger.create({
    trigger: el, start: 'top 58%', end: 'bottom 58%',
    onToggle: (self) => self.isActive && setActive(i),
  }));
  setActive(0);
}

/* =====================================================================
   Stepped stories.
   [data-steps]          pinned stage; scroll moves between steps.
   [data-step-media]     one photograph per step — wipes between them, or
   [data-camera]         one photograph, with a camera keyframe per step (data-cam="scale,x,y,light").
   [data-step]           the words for each step.
   ===================================================================== */
export function initSteps(view) {
  const blocks = $$('[data-steps]', view);
  if (!blocks.length) return null;
  const mm = gsap.matchMedia();
  blocks.forEach((block) => {
    const stage = $('.steps__stage', block);
    const texts = $$('[data-step]', block);
    const medias = $$('[data-step-media]', block);
    const camera = $('[data-camera]', block);
    const camImg = camera && $('img', camera);
    const nowEl = $('[data-step-now]', block);
    const bar = $('[data-step-bar]', block);
    const n = texts.length;
    const cams = texts.map((t) => (t.dataset.cam || '1,0,0,1').split(',').map(Number));
    let current = -1;

    const show = (i, instant = false) => {
      if (i === current) return;
      const prev = current;
      current = i;
      if (nowEl) nowEl.textContent = pad(i + 1);
      texts.forEach((t, j) => t.classList.toggle('is-active', j === i));
      const d = instant ? 0 : 1;
      const outT = texts[prev];
      const inT = texts[i];
      if (outT) gsap.to($$('.steps__anim', outT), { yPercent: -40, autoAlpha: 0, duration: 0.5 * d, ease: EASE.io, stagger: 0.04, overwrite: true });
      gsap.fromTo($$('.steps__anim', inT), { yPercent: 40, autoAlpha: 0 }, { yPercent: 0, autoAlpha: 1, duration: 0.9 * d, delay: 0.25 * d, ease: EASE.out, stagger: 0.06, overwrite: true });
      if (medias.length) {
        const down = prev > i;
        medias.forEach((m, j) => { m.style.zIndex = j === i ? 2 : j === prev ? 1 : 0; });
        gsap.fromTo(medias[i], { clipPath: down ? 'inset(0% 0% 100% 0%)' : 'inset(100% 0% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 1.1 * d, ease: EASE.io, overwrite: true });
        gsap.fromTo($('img', medias[i]), { scale: 1.15 }, { scale: 1, duration: 1.5 * d, ease: EASE.out, overwrite: true });
      }
    };

    mm.add({ wide: '(min-width: 861px)', narrow: '(max-width: 860px)', rm: '(prefers-reduced-motion: reduce)' }, (ctx) => {
      if (ctx.conditions.narrow || reduced) {
        // Small screens: no pin. Each step simply shows; the camera holds a gentle frame.
        texts.forEach((t) => t.classList.add('is-active'));
        return undefined;
      }
      current = -1;
      show(0, true);
      const st = ScrollTrigger.create({
        trigger: stage, start: 'top top', end: () => `+=${window.innerHeight * PIN.step * (n - 1) + window.innerHeight * 0.6}`,
        pin: true, scrub: camImg ? true : false, invalidateOnRefresh: true,
        onUpdate: (self) => {
          const p = self.progress;
          show(Math.min(n - 1, Math.floor(p * n * 0.999)));
          if (bar) bar.style.transform = `scaleY(${p})`;
          if (camImg) {
            // Continuous camera between step keyframes: the room is filmed by the scroll.
            const f = Math.min(n - 1, p * (n - 1));
            const a = Math.floor(f), b = Math.min(n - 1, a + 1), k = gsap.parseEase(EASE.io)(f - a);
            const v = cams[a].map((x, j) => x + (cams[b][j] - x) * k);
            gsap.set(camImg, { scale: v[0], xPercent: v[1], yPercent: v[2], filter: `brightness(${v[3]})` });
          }
        },
      });
      if (camImg) gsap.set(camImg, { scale: cams[0][0], xPercent: cams[0][1], yPercent: cams[0][2], filter: `brightness(${cams[0][3]})` });
      return () => { st.kill(); gsap.set(camImg || [], { clearProps: 'all' }); };
    });
  });
  return mm;
}
