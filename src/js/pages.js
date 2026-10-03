// Page lifecycle. mountPage() wires every module found in a page view and returns one
// function that tears it all down — so a page can leave without leaving anything behind.
import { gsap, ScrollTrigger, reduced, createBag } from './core.js';
import { initHeaderTheme, setActiveNav } from './header.js';
import { initHeroVideo, heroEntrance, pageHero, initFill } from './hero.js';
import { initRoom, initCinema, initProjects, initApproach, initSteps } from './chapters.js';
import { initReveals, initCounters, initCarousel, initQuotes, initForm, initFooter, initProjectIndex, initLogoWall } from './interactions.js';
import { initField } from './field.js';

function safely(name, fn) {
  try { return fn(); } catch (err) { console.error('[edomotics]', name, err); return undefined; }
}

export function mountPage(view, { first = false } = {}) {
  const bag = createBag();
  const mms = [];
  const keep = (mm) => mm && mms.push(mm);
  setActiveNav(view.dataset.page);

  // Interactions that work the same with or without motion.
  safely('carousel', () => initCarousel(view, bag));
  safely('quotes', () => initQuotes(view, bag));
  safely('form', () => initForm(view, bag));
  safely('footer', () => initFooter(view, bag));
  safely('index', () => initProjectIndex(view, bag));
  safely('logos', () => initLogoWall(view, bag));

  if (reduced) {
    safely('field', () => initField(view, bag, { first }));
    safely('room', () => initRoom(view, bag));
    return () => bag.empty();
  }

  const ctx = gsap.context(() => {
    safely('heroVideo', () => initHeroVideo(view, bag));
    safely('hero', () => heroEntrance(view, { first }));
    safely('pageHero', () => pageHero(view, { first }));
    safely('field', () => initField(view, bag, { first }));
    safely('fill', () => initFill(view));
    safely('room', () => initRoom(view, bag));
    safely('steps', () => keep(initSteps(view)));
    safely('approach', () => initApproach(view));
    safely('cinema', () => keep(initCinema(view)));
    safely('projects', () => keep(initProjects(view, bag)));
    safely('reveals', () => initReveals(view));
    safely('counters', () => initCounters(view));
    safely('headerTheme', () => initHeaderTheme(view));
  }, view);

  // Pins may be created in any order; measure them in document order.
  ScrollTrigger.sort();
  ScrollTrigger.refresh();

  return () => {
    mms.forEach((mm) => mm.revert());
    ctx.revert();
    bag.empty();
  };
}
