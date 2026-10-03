// About hero: a field of team portraits drifting toward you through depth.
// Each slot is a photograph placed in 3D space behind the title. It glides at constant speed
// toward the picture plane — so perspective carries it outward from the centre as it grows —
// then fades and returns, far away again, with the next person at the next curated position.
import { gsap, $, $$, EASE, DUR, reduced, isSmall, splitLines } from './core.js';
import { headerEntrance } from './header.js';
import { TEAM } from '../content/team.js';

// Anchors around the title, as % of the field's full width / height (offsets from centre).
// Perspective shrinks them toward the middle when far away; near the picture plane they
// sweep out past the frame. Ordered so consecutive spawns land on opposite sides.
const ANCHORS = [
  [-72, -54], [66, -62], [-60, 64], [88, 26], [-26, -84], [26, 80],
  [-92, 6], [54, 60], [-48, -88], [94, -28], [-12, 78],
];
const LIFE = 12;        // seconds from the far distance to the picture plane
const FADE_IN = 1;      // once its photograph has loaded
const FADE_OUT = 1.8;   // at the end of its life
const DEPTHS = [-1700, -2200];

const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const clamp01 = (v) => Math.min(1, Math.max(0, v));

export function initField(view, bag, { first = false } = {}) {
  const hero = $('[data-people-hero]', view);
  const field = hero && $('[data-field]', hero);
  if (!field || !TEAM.length) return;
  const tip = $('[data-field-tip]', hero);
  const tipName = tip && $('[data-tip-name]', tip);
  const tipRole = tip && $('[data-tip-role]', tip);

  const count = Math.min(isSmall() ? 6 : 8, TEAM.length);
  let queue = shuffle(TEAM.slice());
  let qi = 0;
  let ai = Math.floor(Math.random() * ANCHORS.length);
  let W = 0, H = 0;
  const measure = () => { const r = field.getBoundingClientRect(); W = r.width; H = r.height; };
  measure();
  bag.on(window, 'resize', measure);

  const slots = Array.from({ length: count }, (_, i) => {
    const el = document.createElement('figure');
    el.className = 'pfield__slot';
    const img = new Image();
    img.alt = '';
    img.decoding = 'async';
    img.draggable = false;
    el.append(img);
    field.append(el);
    return { el, img, i, born: 0, loadedAt: Infinity, z0: 0, x: 0, y: 0, ax: 0, ay: 0, member: null };
  });

  // The next person not already on screen.
  const nextMember = () => {
    const showing = new Set(slots.map((s) => s.member));
    for (let tries = 0; tries < queue.length * 2; tries++) {
      if (qi >= queue.length) { queue = shuffle(queue); qi = 0; }
      const m = queue[qi++];
      if (!showing.has(m) || TEAM.length <= count) return m;
    }
    return queue[qi++ % queue.length];
  };

  let clock = 0;
  const spawn = (s, progress = 0) => {
    const [ax, ay] = ANCHORS[ai++ % ANCHORS.length];
    s.ax = ax; s.ay = ay;
    s.z0 = DEPTHS[s.i % DEPTHS.length];
    s.born = clock - progress * LIFE;
    s.member = nextMember();
    s.loadedAt = Infinity;
    s.el.style.opacity = '0';
    s.img.onload = s.img.onerror = () => { s.loadedAt = Math.max(clock, s.born); };
    s.img.src = s.member.src;
    if (s.img.complete && s.img.naturalWidth) s.loadedAt = Math.max(clock, s.born);
  };

  const place = (s) => {
    const age = clock - s.born;
    const p = age / LIFE;
    const z = s.z0 * (1 - p);
    const fin = clamp01((clock - s.loadedAt) / FADE_IN);
    const fout = clamp01((LIFE - age) / FADE_OUT);
    s.el.style.opacity = String(fin * fin * fout);
    s.el.style.zIndex = String(Math.round(3000 + z));
    s.el.style.transform = `translate3d(${(s.ax / 100) * W}px, ${(s.ay / 100) * H}px, ${z}px)`;
  };

  // Staggered start: the field is already full on the first frame, at varied depths.
  slots.forEach((s, i) => spawn(s, Math.max(0, 0.82 - (i * 0.82) / count)));

  if (reduced) {
    // A still composition: every portrait held at a mid-depth, nothing moving.
    slots.forEach((s, i) => { s.born = clock - (0.35 + (i % 4) * 0.12) * LIFE; s.loadedAt = -Infinity; place(s); });
  } else {
    let running = true;
    const tick = (time, deltaMs) => {
      if (!running) return;
      clock += Math.min(deltaMs / 1000, 0.1); // a backgrounded tab resumes calmly, never in a burst
      for (const s of slots) {
        if (clock - s.born >= LIFE) spawn(s);
        place(s);
      }
    };
    gsap.ticker.add(tick);
    bag.add(() => gsap.ticker.remove(tick));
    const io = new IntersectionObserver(([e]) => { running = e.isIntersecting; }, { threshold: 0 });
    io.observe(hero);
    bag.add(() => io.disconnect());

    // Entrance: the field fades up, the title rises, the count and the words follow.
    const title = $('[data-ph-title]', hero);
    const later = $$('[data-ph-later]', hero);
    const tl = gsap.timeline({ delay: first ? 0.15 : 0.4 });
    let lines = [];
    splitLines(title, (self) => {
      lines = self.lines;
      if (tl.progress() === 0) gsap.set(lines, { yPercent: 105 });
    });
    gsap.set(later, { opacity: 0, y: 14 });
    tl.fromTo(field, { opacity: 0 }, { opacity: 1, duration: 0.8 }, 0)
      .to(lines, { yPercent: 0, duration: DUR.reveal, ease: EASE.out, stagger: 0.09 }, 0.1)
      .to(later, { opacity: 1, y: 0, duration: DUR.base, ease: EASE.out, stagger: 0.1 }, 0.9);
    if (first) headerEntrance(tl, 0.5);

    // Leaving the hero: the words lift away and the field pushes gently forward.
    gsap.timeline({ scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: true } })
      .to($('.phero-people__copy', hero), { yPercent: -30, opacity: 0, ease: 'none' }, 0)
      .to(field, { scale: 1.12, ease: 'none' }, 0);

    // Desktop: the vanishing point leans toward the pointer, a little.
    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
      const origin = { x: 50, y: 50 };
      const toX = gsap.quickTo(origin, 'x', { duration: 1.2, ease: 'power3', onUpdate: () => { field.style.perspectiveOrigin = `${origin.x}% ${origin.y}%`; } });
      const toY = gsap.quickTo(origin, 'y', { duration: 1.2, ease: 'power3' });
      bag.on(hero, 'pointermove', (e) => {
        const r = hero.getBoundingClientRect();
        toX(50 + ((e.clientX - r.left) / r.width - 0.5) * 8);
        toY(50 + ((e.clientY - r.top) / r.height - 0.5) * 8);
      });
    }
  }

  // Who's this? A small card follows the cursor over a portrait (fine pointers only).
  if (tip && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    const xTo = gsap.quickTo(tip, 'x', { duration: 0.35, ease: 'power3' });
    const yTo = gsap.quickTo(tip, 'y', { duration: 0.35, ease: 'power3' });
    bag.on(hero, 'pointermove', (e) => { xTo(e.clientX + 16); yTo(e.clientY + 22); });
    slots.forEach((s) => {
      bag.on(s.el, 'pointerenter', () => {
        tipName.textContent = s.member.name;
        tipRole.textContent = s.member.role;
        gsap.to(tip, { autoAlpha: 1, scale: 1, duration: 0.3, ease: 'power1.in' });
      });
      bag.on(s.el, 'pointerleave', () => gsap.to(tip, { autoAlpha: 0, scale: 0.9, duration: 0.3, ease: 'power1.out' }));
    });
    bag.on(hero, 'pointerleave', () => gsap.to(tip, { autoAlpha: 0, scale: 0.9, duration: 0.3 }));
  }

  bag.add(() => { slots.forEach((s) => { s.img.onload = s.img.onerror = null; s.el.remove(); }); });
}
