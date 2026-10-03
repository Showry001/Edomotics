import { gsap, ScrollTrigger, initLenis } from './js/core.js';
import { initMenu } from './js/header.js';
import { initRouter } from './js/router.js';

function boot() {
  const menu = initMenu();
  initLenis();
  initRouter(menu);
  document.fonts?.ready.then(() => ScrollTrigger.refresh());
  window.addEventListener('load', () => ScrollTrigger.refresh(), { once: true });
  // Dev-only handle for inspecting triggers in the console; stripped from production builds.
  if (import.meta.env.DEV) window.__edo = { gsap, ScrollTrigger };
}

const fonts = document.fonts?.ready ?? Promise.resolve();
Promise.race([fonts, new Promise((r) => setTimeout(r, 1200))]).then(boot);
