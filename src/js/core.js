// Shared setup: GSAP plugins, custom eases, Lenis smooth scroll, small DOM helpers.
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import { CustomEase } from 'gsap/CustomEase';
import Lenis from 'lenis';

gsap.registerPlugin(ScrollTrigger, SplitText, CustomEase);

// Two curves for the whole site: a long settle for reveals, a quart in-out for state changes.
CustomEase.create('edo.out', 'M0,0 C0.22,1 0.36,1 1,1');
CustomEase.create('edo.io', 'M0,0 C0.76,0 0.24,1 1,1');

export const EASE = { out: 'edo.out', io: 'edo.io' };
export const DUR = { fast: 0.5, base: 0.9, slow: 1.3, reveal: 1.6, page: 1.05 };
export const STAGGER = 0.07;
export const PIN = { cinema: 1.6, project: 1.1, step: 0.85 };

export const root = document.documentElement;
export const reduced = root.classList.contains('reduced');
export const isSmall = () => window.matchMedia('(max-width: 767px)').matches;
export const $ = (s, c = document) => c.querySelector(s);
export const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));

export { gsap, ScrollTrigger, SplitText };

ScrollTrigger.config({ ignoreMobileResize: true });

export let lenis = null;

export function initLenis() {
  if (reduced) return null;
  lenis = new Lenis({ lerp: 0.09, smoothWheel: true, allowNestedScroll: true });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
  return lenis;
}

export function scrollToTarget(target, { immediate = false } = {}) {
  if (lenis) lenis.scrollTo(target, immediate ? { immediate: true, force: true } : { duration: 1.6, easing: gsap.parseEase(EASE.io), force: true });
  else if (typeof target === 'number') window.scrollTo(0, target);
  else target.scrollIntoView();
}

// Line-masked split for headings. Re-splits on resize/font load without replaying.
export function splitLines(el, onSplit) {
  return SplitText.create(el, { type: 'lines', mask: 'lines', linesClass: 'ln', autoSplit: true, onSplit });
}

// A per-page bag of listeners and teardown steps, emptied when the page leaves.
export function createBag() {
  const fns = [];
  return {
    on(target, type, fn, opts) { target.addEventListener(type, fn, opts); fns.push(() => target.removeEventListener(type, fn, opts)); },
    add(fn) { fns.push(fn); },
    empty() { while (fns.length) { try { fns.pop()(); } catch (e) { console.error('[edomotics] cleanup', e); } } },
  };
}

// Scroll-scrubbed video: seeks to the requested progress without queueing seeks,
// so scrubbing stays frame-accurate in both directions.
export function videoScrubber(video) {
  let target = 0;
  let busy = false;
  const seek = () => { busy = true; video.currentTime = target; };
  video.addEventListener('seeked', () => {
    busy = false;
    if (Math.abs(video.currentTime - target) > 1 / 48) seek();
  });
  return (progress) => {
    if (!video.duration || video.readyState < 1) return;
    target = Math.max(0, Math.min(video.duration - 0.05, progress * video.duration));
    if (!busy) seek();
  };
}
