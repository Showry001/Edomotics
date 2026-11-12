// Scroll chapters: the opening cinema frame, stacked project slides, the principles numeral and
// the stepped story sequences. ("One room, one day" lives in room/.)
import { gsap, ScrollTrigger, $, $$, EASE, STAGGER, PIN, reduced, scrollToTarget } from './core.js';
import { setHeaderTheme } from './header.js';

const pad = (n) => String(n).padStart(2, '0');

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
   [data-step-film]      on a step's media: its film (media/steps/<name>.mp4), looping over the
                         photograph (a still of the same film) while that step is on screen.
   [data-step]           the words for each step.
   ===================================================================== */
const STEP_FILMS = `${import.meta.env.BASE_URL}media/steps/`;

function stepFilms(block, medias, bag) {
  const list = medias.map((m) => (m.dataset.stepFilm ? { m, v: null } : null));
  if (!bag || !list.some(Boolean)) return { show() {} };
  const small = window.matchMedia('(max-width: 860px)').matches;
  let want = -1, near = false;
  // Nothing loads until its step is shown with the block near the screen.
  const load = (f) => {
    if (f.v) return f.v;
    const v = document.createElement('video');
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.disablePictureInPicture = true;
    v.setAttribute('muted', '');
    v.setAttribute('playsinline', '');
    v.setAttribute('aria-hidden', 'true');
    v.src = `${STEP_FILMS}${f.m.dataset.stepFilm}${small ? '-sm' : ''}.mp4`;
    // Shown only once it is really moving, so a slow network never flashes black.
    bag.on(v, 'playing', () => f.m.classList.add('is-film'));
    f.m.append(v);
    f.v = v;
    return v;
  };
  const sync = (restart) => list.forEach((f, j) => {
    if (!f) return;
    if (j === want && near) {
      const v = load(f);
      if (restart && v.currentTime > 0) v.currentTime = 0;     // each step's film starts from its beginning
      v.play().catch(() => {});
    } else if (f.v && !f.v.paused) f.v.pause();
  });
  const io = new IntersectionObserver(([e]) => { near = e.isIntersecting; sync(false); }, { rootMargin: '25% 0px' });
  io.observe(block);
  bag.add(() => {
    io.disconnect();
    list.forEach((f) => {
      if (!f?.v) return;
      f.v.pause();
      f.v.removeAttribute('src');
      f.v.load();
      f.v.remove();
      f.m.classList.remove('is-film');
    });
  });
  return { show(i) { if (i === want) return; want = i; sync(true); } };
}

export function initSteps(view, bag) {
  const blocks = $$('[data-steps]', view);
  if (!blocks.length) return null;
  const mm = gsap.matchMedia();
  blocks.forEach((block) => {
    const stage = $('.steps__stage', block);
    const texts = $$('[data-step]', block);
    const medias = $$('[data-step-media]', block);
    const films = stepFilms(block, medias, bag);
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
        films.show(i);
        medias.forEach((m, j) => { m.style.zIndex = j === i ? 2 : j === prev ? 1 : 0; });
        gsap.fromTo(medias[i], { clipPath: down ? 'inset(0% 0% 100% 0%)' : 'inset(100% 0% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 1.1 * d, ease: EASE.io, overwrite: true });
        gsap.fromTo($$('img, video', medias[i]), { scale: 1.15 }, { scale: 1, duration: 1.5 * d, ease: EASE.out, overwrite: true });
      }
    };

    mm.add({ wide: '(min-width: 861px)', narrow: '(max-width: 860px)', rm: '(prefers-reduced-motion: reduce)' }, (ctx) => {
      if (ctx.conditions.narrow || reduced) {
        // Small screens: no pin. Each step simply shows; the camera holds a gentle frame, and the
        // first step's film plays (the only photograph shown).
        texts.forEach((t) => t.classList.add('is-active'));
        films.show(0);
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
