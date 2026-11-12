// Card films: an element with data-film="name" plays a short clip from the project shoots over its
// photograph (media/cards/<name>.mp4, cut by scripts/media.mjs): the capability lists on the
// Automation and Home theatre pages. With a mouse it plays while the pointer
// rests on it; on touch screens, while a card is the one most in view (only where the photograph is
// shown at all). It plays once and holds its last frame; leaving fades back to the photograph.
// The photograph is a still of the same film. Nothing loads until it's wanted, and reduced motion
// keeps the photographs.
import { $$, reduced } from './core.js';

const BASE = `${import.meta.env.BASE_URL}media/cards/`;
const FADE = 450;                                  // ms, as .scard__img video in sections.css

export function initCardFilms(view, bag) {
  if (reduced) return;
  const cards = $$('[data-film]', view);
  if (!cards.length) return;
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const small = window.matchMedia('(max-width: 860px)').matches;
  const films = new Map();
  const frameOf = (card) => card.querySelector('.scard__img, .cap__img');

  function film(card) {
    let f = films.get(card);
    if (f) return f;
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.disablePictureInPicture = true;
    v.setAttribute('muted', '');
    v.setAttribute('playsinline', '');
    v.setAttribute('aria-hidden', 'true');
    const frame = frameOf(card);
    // Phones, and frames too small to need it, take the 480 px version.
    const sm = small || (frame && frame.getBoundingClientRect().width < 300);
    v.src = `${BASE}${card.dataset.film}${sm ? '-sm' : ''}.mp4`;
    frame?.append(v);
    f = { v, want: false, timer: 0 };
    // Show the film only once it is really moving, so a slow network never flashes black.
    bag.on(v, 'playing', () => { if (f.want) card.classList.add('is-film'); });
    films.set(card, f);
    return f;
  }

  function play(card) {
    const frame = frameOf(card);
    if (!frame || getComputedStyle(frame).display === 'none') return;   // no photograph here, no film
    const f = film(card);
    clearTimeout(f.timer);
    f.want = true;
    if (f.v.ended || f.v.currentTime > 0) f.v.currentTime = 0;
    f.v.play().catch(() => {});
  }

  function stop(card) {
    const f = films.get(card);
    if (!f || !f.want) return;
    f.want = false;
    card.classList.remove('is-film');
    f.timer = setTimeout(() => { if (!f.want) f.v.pause(); }, FADE);
  }

  if (fine) {
    cards.forEach((card) => {
      bag.on(card, 'pointerenter', (e) => { if (e.pointerType === 'mouse') play(card); });
      bag.on(card, 'pointerleave', () => stop(card));
    });
  } else {
    // Touch: in each carousel, the card most in view plays (once it is nearly all on screen).
    const ratios = new Map();
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => ratios.set(e.target, e.intersectionRatio));
      const groups = new Map();
      cards.forEach((c) => {
        const track = c.parentElement;
        const best = groups.get(track);
        if (!best || (ratios.get(c) || 0) > (ratios.get(best) || 0)) groups.set(track, c);
      });
      cards.forEach((c) => {
        const best = groups.get(c.parentElement);
        if (c === best && (ratios.get(c) || 0) >= 0.85) { if (!films.get(c)?.want) play(c); }
        else stop(c);
      });
    }, { threshold: [0, 0.5, 0.85, 1] });
    cards.forEach((c) => io.observe(c));
    bag.add(() => io.disconnect());
  }

  bag.add(() => {
    films.forEach((f) => {
      clearTimeout(f.timer);
      f.v.pause();
      f.v.removeAttribute('src');
      f.v.load();
      f.v.remove();
    });
    films.clear();
    cards.forEach((c) => c.classList.remove('is-film'));
  });
}
