// Header — persistent across page transitions: the logo box that opens into the menu,
// active-link state. Per page: header colour follows the ground beneath it.
import { gsap, ScrollTrigger, $, $$, EASE, DUR, STAGGER, reduced, lenis } from './core.js';

export function initMenu() {
  const box = $('[data-mbox]');
  const panel = $('[data-menu]');
  const toggle = $('[data-menu-toggle]');
  const veil = $('[data-veil]');
  if (!box || !panel || !toggle) return { hide() {}, isOpen: () => false };
  const links = $$('.mbox__links a, .mcard', panel);
  let open = false;
  let collapsed = null;

  function show() {
    if (open) return;
    open = true;
    collapsed = box.getBoundingClientRect();
    panel.hidden = false;
    const full = box.getBoundingClientRect();
    toggle.setAttribute('aria-expanded', 'true');
    toggle.setAttribute('aria-label', 'Close menu');
    veil.classList.add('is-on');
    lenis?.stop();
    if (reduced) { links[0]?.focus(); return; }
    gsap.timeline()
      .fromTo(box, { width: collapsed.width, height: collapsed.height }, {
        width: full.width, height: full.height, duration: DUR.base, ease: EASE.io,
        onComplete: () => gsap.set(box, { clearProps: 'width,height' }),
      })
      .fromTo(links, { yPercent: 60, opacity: 0 }, { yPercent: 0, opacity: 1, duration: DUR.base, ease: EASE.out, stagger: 0.04 }, 0.25);
    links[0]?.focus({ preventScroll: true });
  }

  function hide({ focusToggle = false, instant = false } = {}) {
    if (!open) return;
    open = false;
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open menu');
    veil.classList.remove('is-on');
    lenis?.start();
    const done = () => { panel.hidden = true; gsap.set(box, { clearProps: 'width,height' }); };
    if (reduced || instant || !collapsed) done();
    else {
      const full = box.getBoundingClientRect();
      gsap.fromTo(box, { width: full.width, height: full.height }, {
        width: collapsed.width, height: collapsed.height, duration: DUR.fast + 0.2, ease: EASE.io, onComplete: done,
      });
    }
    if (focusToggle) toggle.focus();
  }

  toggle.addEventListener('click', () => (open ? hide() : show()));
  veil.addEventListener('click', () => hide());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) hide({ focusToggle: true }); });
  return { hide, isOpen: () => open };
}

// Marks the current section of the site in the menu (aria-current for assistive tech too).
export function setActiveNav(page) {
  const section = page === 'project' ? 'projects' : page;
  $$('[data-nav]').forEach((a) => {
    const on = a.dataset.nav === section;
    a.classList.toggle('is-current', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}

export function setHeaderTheme(theme) {
  const hdr = $('[data-hdr]');
  if (hdr && theme) hdr.dataset.on = theme;
}

// Header text follows the ground beneath it. Call after the page's pins exist.
export function initHeaderTheme(view) {
  const probe = 44;
  const sections = $$('main [data-theme], footer[data-theme]', view);
  setHeaderTheme(sections[0]?.dataset.theme);
  sections.forEach((sec) => {
    ScrollTrigger.create({
      trigger: sec, start: `top ${probe}px`, end: `bottom ${probe}px`,
      onToggle: (self) => { if (self.isActive) setHeaderTheme(sec.dataset.theme); },
    });
  });
}

export function headerEntrance(tl, at = 0) {
  tl.fromTo('.hdr__bar > *', { y: -14, opacity: 0 }, { y: 0, opacity: 1, duration: DUR.base, ease: EASE.out, stagger: STAGGER, clearProps: 'transform,opacity' }, at);
}
