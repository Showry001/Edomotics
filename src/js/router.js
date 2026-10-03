// Page transitions: the page you leave is frozen where it stands, then
// recedes and dims while the next page slides up over it. The header never reloads.
// Internal links are fetched in the background (and prefetched on hover); anything the
// router can't handle falls back to a normal page load.
import { gsap, ScrollTrigger, $, $$, EASE, DUR, reduced, lenis, isSmall, scrollToTarget } from './core.js';
import { mountPage } from './pages.js';
import { setHeaderTheme } from './header.js';

const cache = new Map();
let unmount = null;
let busy = false;
let queued = null;
let menu = null;

const viewEl = () => $('[data-view]');
const keyOf = (href) => href.split('#')[0];

function isPage(url) {
  if (url.origin !== location.origin) return false;
  const path = url.pathname.replace(/index\.html$/, '');
  return !/\.[a-z0-9]{2,5}$/i.test(path); // no file extension: a page, not an asset
}

function fetchPage(href) {
  const key = keyOf(href);
  if (!cache.has(key)) {
    cache.set(key, fetch(key, { credentials: 'same-origin' })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
      .catch((err) => { cache.delete(key); throw err; }));
  }
  return cache.get(key);
}

function scrollToHash(hash, immediate = false) {
  if (!hash || hash === '#' || hash === '#top') { scrollToTarget(0, { immediate }); return; }
  const el = document.getElementById(decodeURIComponent(hash.slice(1)));
  if (!el) return;
  scrollToTarget(el, { immediate });
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: true });
}

function rememberScroll() {
  history.replaceState({ ...(history.state || {}), edo: true, y: window.scrollY }, '');
}

function swapHead(doc) {
  document.title = doc.title;
  ['description', 'og:title', 'og:description', 'og:image'].forEach((name) => {
    const sel = name.startsWith('og:') ? `meta[property="${name}"]` : `meta[name="${name}"]`;
    const next = doc.head.querySelector(sel);
    const cur = document.head.querySelector(sel);
    if (next && cur) cur.setAttribute('content', next.getAttribute('content'));
  });
}

// Fixed descendants (the hero film, an active pin) would jump when their page becomes a
// transformed layer, so re-anchor them where they stand.
function anchorFixed(view) {
  $$('[data-hero-media], .pin-spacer > *', view).forEach((el) => {
    if (getComputedStyle(el).position !== 'fixed') return;
    const r = el.getBoundingClientRect();
    let parent = el.parentElement;
    while (parent && parent !== view && getComputedStyle(parent).position === 'static') parent = parent.parentElement;
    const p = parent.getBoundingClientRect();
    Object.assign(el.style, { position: 'absolute', top: `${r.top - p.top}px`, left: `${r.left - p.left}px`, width: `${r.width}px`, height: `${r.height}px` });
  });
}

function announce(doc) {
  const el = $('[data-announcer]');
  if (el) el.textContent = doc.title;
}

async function transition(oldView, nextView, doc, url, restoreY) {
  const y = window.scrollY;
  const vh = window.innerHeight;
  const prevTheme = $('[data-hdr]')?.dataset.on;
  const shade = $('[data-tx-shade]');
  const leave = unmount;

  // 1 · Freeze the page we're leaving exactly as it looks.
  ScrollTrigger.getAll().forEach((t) => t.disable(false));
  lenis?.stop();
  anchorFixed(oldView);
  Object.assign(oldView.style, {
    position: 'fixed', top: `${-y}px`, left: '0', right: '0', zIndex: '1',
    transformOrigin: `50% ${y + vh / 2}px`, pointerEvents: 'none',
  });
  oldView.inert = true;

  // 2 · Bring in the next page at the top of the document and measure it in place.
  nextView.style.position = 'relative';
  nextView.style.zIndex = '3';
  oldView.after(nextView);
  window.scrollTo(0, 0);
  lenis?.scrollTo(0, { immediate: true, force: true });
  swapHead(doc);
  unmount = mountPage(nextView, { first: false });
  const nextTheme = $('[data-hdr]')?.dataset.on;
  if (prevTheme) setHeaderTheme(prevTheme);
  if (restoreY) {
    window.scrollTo(0, restoreY);
    lenis?.scrollTo(restoreY, { immediate: true, force: true });
    ScrollTrigger.update();
  }

  // 3 · The move itself.
  if (!reduced) {
    const d = isSmall() ? DUR.page - 0.2 : DUR.page;
    gsap.delayedCall(d * 0.55, () => setHeaderTheme(nextTheme));
    await new Promise((resolve) => {
      gsap.timeline({ onComplete: resolve })
        .fromTo(nextView, { y: vh }, { y: 0, duration: d, ease: EASE.io }, 0)
        .to(oldView, { scale: 0.94, duration: d, ease: EASE.io }, 0)
        .fromTo(shade, { opacity: 0 }, { opacity: 1, duration: d * 0.9, ease: EASE.io }, 0);
    });
  } else {
    setHeaderTheme(nextTheme);
  }

  // 4 · Let go of the old page.
  oldView.remove();
  leave?.();
  gsap.set(nextView, { clearProps: 'transform,position,zIndex' });
  gsap.set(shade, { opacity: 0 });
  lenis?.start();
  ScrollTrigger.refresh();

  if (url.hash && !restoreY) scrollToHash(url.hash, true);
  else {
    const h1 = $('h1', nextView);
    if (h1) { h1.setAttribute('tabindex', '-1'); h1.focus({ preventScroll: true }); }
  }
  announce(doc);
}

async function navigate(url, { push, restoreY = null }) {
  if (busy) { queued = { url, push, restoreY }; return; }
  busy = true;
  menu?.hide({ instant: true });
  if (push) rememberScroll();
  let doc;
  try {
    doc = new DOMParser().parseFromString(await fetchPage(url.href), 'text/html');
  } catch {
    location.href = url.href;
    return;
  }
  const next = doc.querySelector('[data-view]');
  if (!next) { location.href = url.href; return; }
  if (push) history.pushState({ edo: true, y: 0 }, '', url.href);
  try {
    await transition(viewEl(), document.importNode(next, true), doc, url, restoreY);
  } catch (err) {
    console.error('[edomotics] transition', err);
    location.href = url.href;
    return;
  }
  busy = false;
  if (queued) { const q = queued; queued = null; navigate(q.url, q); }
}

function onClick(e) {
  const a = e.target.closest('a[href]');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  if ((a.target && a.target !== '_self') || a.hasAttribute('download') || 'noRouter' in a.dataset) return;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin) return;
  const samePage = url.pathname === location.pathname && url.search === location.search;
  if (samePage) {
    if (!url.hash && a.getAttribute('href') !== '/' && a.getAttribute('href') !== location.pathname) return;
    e.preventDefault();
    menu?.hide();
    scrollToHash(url.hash || '#top');
    return;
  }
  if (!isPage(url)) return;
  e.preventDefault();
  navigate(url, { push: true });
}

export function initRouter(menuApi) {
  menu = menuApi;
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  history.replaceState({ ...(history.state || {}), edo: true, y: window.scrollY }, '');
  unmount = mountPage(viewEl(), { first: true });
  if (location.hash) requestAnimationFrame(() => scrollToHash(location.hash, true));

  document.addEventListener('click', onClick);
  window.addEventListener('popstate', (e) => navigate(new URL(location.href), { push: false, restoreY: e.state?.y ?? 0 }));

  // Prefetch on intent so most transitions start instantly.
  const prefetch = (e) => {
    const a = e.target.closest?.('a[href]');
    if (!a) return;
    const url = new URL(a.href, location.href);
    if (isPage(url) && url.pathname !== location.pathname) fetchPage(url.href).catch(() => {});
  };
  document.addEventListener('pointerover', prefetch, { passive: true });
  document.addEventListener('touchstart', prefetch, { passive: true });
  document.addEventListener('focusin', prefetch);
}
