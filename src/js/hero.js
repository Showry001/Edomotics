// Heroes. Home: the headline rises over a playing room and the intro fills word by word.
// Inner pages: label and statement rise, then the photograph settles from a slight zoom
// and drifts back as the page scrolls.
import { gsap, $, $$, SplitText, EASE, DUR, STAGGER, reduced, splitLines } from './core.js';
import { headerEntrance } from './header.js';

export function initHeroVideo(view, bag) {
  const video = $('[data-hero-video]', view);
  if (!video || reduced) return;
  const play = () => video.play().catch(() => {});
  if (video.readyState >= 2) play();
  else bag.on(video, 'loadeddata', play, { once: true });
  // Pause when out of view to spare the CPU on mid-range phones.
  const io = new IntersectionObserver(([entry]) => (entry.isIntersecting ? play() : video.pause()), { threshold: 0 });
  io.observe(video.closest('section') || video);
  bag.add(() => { io.disconnect(); video.pause(); video.removeAttribute('src'); video.load(); });
}

export function heroEntrance(view, { first }) {
  const title = $('[data-hero-title]', view);
  if (!title) return;
  const tl = gsap.timeline({ delay: first ? 0.15 : 0.35 });
  let lines = [];
  splitLines(title, (self) => {
    lines = self.lines;
    if (tl.progress() === 0) gsap.set(lines, { yPercent: 105 });
  });
  const extras = $$('[data-hero-cue], .hero__intro-in', view);
  gsap.set(extras, { opacity: 0 });
  tl.fromTo($('[data-hero-media]', view), { scale: 1.08 }, { scale: 1, duration: 2.4, ease: EASE.out }, 0)
    .to(lines, { yPercent: 0, duration: DUR.reveal, ease: EASE.out, stagger: 0.09 }, 0.1)
    .to(extras, { opacity: 1, duration: DUR.base, ease: EASE.out }, 0.9);
  if (first) headerEntrance(tl, 0.55);

  gsap.fromTo($('[data-hero-media]', view), { scale: 1 }, {
    scale: 1.1, ease: 'none', immediateRender: false,
    scrollTrigger: { trigger: $('.hero', view), start: 'top top', end: 'bottom top', scrub: true },
  });
}

export function pageHero(view, { first }) {
  const hero = $('[data-page-hero]', view);
  if (!hero) return;
  const tl = gsap.timeline({ delay: first ? 0.15 : 0.4 });
  const label = $('[data-ph-label]', hero);
  const title = $('[data-ph-title]', hero);
  const media = $('[data-ph-media]', hero);
  const aside = $$('[data-ph-aside]', hero);
  let lines = [];
  splitLines(title, (self) => {
    lines = self.lines;
    if (tl.progress() === 0) gsap.set(lines, { yPercent: 105 });
  });
  gsap.set([label, ...aside].filter(Boolean), { opacity: 0, y: 16 });
  tl.to(lines, { yPercent: 0, duration: DUR.reveal, ease: EASE.out, stagger: 0.09 }, 0)
    .to([label, ...aside].filter(Boolean), { opacity: 1, y: 0, duration: DUR.base, ease: EASE.out, stagger: 0.08 }, 0.3);
  if (media) {
    const inner = $('img, video', media);
    tl.fromTo(media, { clipPath: 'inset(12% 6% 0% 6%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: DUR.reveal + 0.2, ease: EASE.io }, 0.15)
      .fromTo(inner, { scale: 1.18 }, { scale: 1, duration: DUR.reveal + 0.6, ease: EASE.out }, 0.15);
    gsap.fromTo(inner, { yPercent: 0 }, {
      yPercent: 10, ease: 'none', immediateRender: false,
      scrollTrigger: { trigger: media, start: 'top top', end: 'bottom top', scrub: true },
    });
  }
  if (first) headerEntrance(tl, 0.5);
}

// Words brighten from 25% to full as the paragraph crosses the viewport.
export function initFill(view) {
  $$('[data-fill]', view).forEach((el) => {
    const split = SplitText.create(el, { type: 'words', wordsClass: 'w' });
    gsap.fromTo(split.words, { opacity: 0.25 }, {
      opacity: 1, ease: 'none', stagger: 0.1,
      scrollTrigger: { trigger: el, start: 'top 88%', end: el.closest('.hero') ? 'top 38%' : 'bottom 55%', scrub: true },
    });
  });
}
