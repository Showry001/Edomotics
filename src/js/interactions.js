// Section-level interactions, scoped to one page view: reveals, the carousel, counters,
// testimonials, the enquiry form, the footer year and the projects index.
import { gsap, ScrollTrigger, SplitText, $, $$, EASE, DUR, STAGGER, reduced, splitLines } from './core.js';

/* ---------------- Reveals ---------------- */
export function initReveals(view) {
  $$('[data-lines]', view).forEach((el) => {
    splitLines(el, (self) => gsap.from(self.lines, {
      yPercent: 105, duration: DUR.reveal, ease: EASE.out, stagger: STAGGER,
      scrollTrigger: { trigger: el, start: 'top 88%', once: true },
    }));
  });

  // Photographs wipe up while settling from a slight zoom.
  // A paused timeline played by its own trigger: a `once` trigger attached to a still-empty
  // timeline is measured lazily and can unsettle later triggers while the page mounts.
  $$('[data-reveal]', view).forEach((fig) => {
    const img = $('img, video', fig);
    const tl = gsap.timeline({ paused: true })
      .fromTo(fig, { clipPath: 'inset(100% 0% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: DUR.reveal, ease: EASE.out })
      .fromTo(img, { scale: 1.16 }, { scale: 1, duration: DUR.reveal * 1.25, ease: EASE.out }, 0);
    ScrollTrigger.create({ trigger: fig, start: 'top 86%', once: true, onEnter: () => tl.play() });
  });

  // Gentle drift inside oversized frames.
  $$('[data-parallax] img, [data-cta-img] img', view).forEach((img) => {
    gsap.fromTo(img, { yPercent: -6 }, {
      yPercent: 6, ease: 'none',
      scrollTrigger: { trigger: img.closest('figure'), start: 'top bottom', end: 'bottom top', scrub: true },
    });
  });

  // Cards that overlap a photograph ride slightly faster than it — the overlap breathes.
  $$('.team__card, [data-float]', view).forEach((card) => {
    gsap.fromTo(card, { y: 70 }, {
      y: -20, ease: 'none',
      scrollTrigger: { trigger: card.parentElement, start: 'top bottom', end: 'bottom top', scrub: true },
    });
  });

  // Grids of cards and tiles: one quiet staggered entrance each.
  $$('[data-car-track], [data-tiles], [data-stagger]', view).forEach((w) => {
    gsap.from(w.children, {
      y: 48, opacity: 0, duration: DUR.slow, ease: EASE.out, stagger: 0.06,
      scrollTrigger: { trigger: w, start: 'top 88%', once: true },
    });
  });

  $$('[data-cta-card]', view).forEach((card) => gsap.from(card, {
    y: 80, opacity: 0, duration: DUR.slow, ease: EASE.out,
    scrollTrigger: { trigger: card, start: 'top 92%', once: true },
  }));
}

/* ---------------- Counters ---------------- */
export function initCounters(view) {
  $$('[data-count-to]', view).forEach((el) => {
    const to = +el.dataset.countTo;
    const o = { v: 0 };
    el.textContent = '0';
    ScrollTrigger.create({
      trigger: el, start: 'top 90%', once: true,
      onEnter: () => gsap.to(o, { v: to, duration: DUR.reveal + 0.4, ease: EASE.out, onUpdate: () => { el.textContent = Math.round(o.v); } }),
    });
  });
}

/* ---------------- Client logos: columns that drift upward ----------------
   Each column carries a hidden copy of its tiles so it loops without a seam. Columns move at
   slightly different speeds and start at different points, so the wall never lines up. */
export function initLogoWall(view, bag) {
  $$('[data-logo-wall]', view).forEach((wall) => {
    const cols = $$('.clients__col', wall);
    if (reduced || !cols.length) return;
    cols.forEach((col) => [...col.children].forEach((li) => {
      const copy = li.cloneNode(true);
      copy.setAttribute('aria-hidden', 'true');
      $('img', copy).alt = '';
      col.append(copy);
    }));
    const SPEEDS = [24, 31, 20]; // px per second
    const START = [0, 0.45, 0.2]; // share of a loop already travelled
    const state = cols.map((col, i) => ({ col, y: 0, loop: 0, speed: SPEEDS[i % 3], start: START[i % 3] }));
    const measure = () => state.forEach((c) => {
      const gap = parseFloat(getComputedStyle(c.col).rowGap) || 0;
      c.loop = (c.col.scrollHeight + gap) / 2;
      c.y = -c.loop * c.start;
      c.col.style.transform = `translate3d(0, ${c.y}px, 0)`;
    });
    measure();
    let visible = false;
    const tick = (time, dt) => {
      if (!visible) return;
      const step = Math.min(dt, 100) / 1000;
      state.forEach((c) => {
        if (!c.loop) return;
        c.y -= c.speed * step;
        if (c.y <= -c.loop) c.y += c.loop;
        c.col.style.transform = `translate3d(0, ${c.y}px, 0)`;
      });
    };
    gsap.ticker.add(tick);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { rootMargin: '100px 0px' });
    io.observe(wall);
    let t = 0;
    bag.on(window, 'resize', () => { clearTimeout(t); t = setTimeout(measure, 200); });
    $$('img', wall).forEach((img) => { if (!img.complete) bag.on(img, 'load', measure, { once: true }); });
    bag.add(() => { gsap.ticker.remove(tick); io.disconnect(); clearTimeout(t); });
  });
}

/* ---------------- Carousel: mouse/pen drag, arrows, native touch swipe ---------------- */
export function initCarousel(view, bag) {
  $$('[data-carousel]', view).forEach((wrap) => {
    const track = $('[data-car-track]', wrap);
    const bar = wrap.previousElementSibling;
    const prev = bar && $('[data-car-prev]', bar);
    const next = bar && $('[data-car-next]', bar);
    if (!track) return;
    const step = () => {
      const card = track.firstElementChild;
      return card ? card.getBoundingClientRect().width + parseFloat(getComputedStyle(track).columnGap || 0) : 300;
    };
    const update = () => {
      if (!prev) return;
      prev.disabled = track.scrollLeft <= 2;
      next.disabled = track.scrollLeft >= track.scrollWidth - track.clientWidth - 2;
    };
    if (prev) {
      bag.on(prev, 'click', () => track.scrollBy({ left: -step(), behavior: reduced ? 'auto' : 'smooth' }));
      bag.on(next, 'click', () => track.scrollBy({ left: step(), behavior: reduced ? 'auto' : 'smooth' }));
    }
    bag.on(track, 'scroll', update, { passive: true });
    update();

    // Touch keeps the browser's own swipe (momentum, snap). Mouse and pen drag the track:
    // the pointer is captured once a drag is clear, so images are never lifted and text is never selected.
    let drag = null;
    let dragged = false;
    bag.on(track, 'dragstart', (e) => e.preventDefault());
    bag.on(track, 'pointerdown', (e) => {
      dragged = false;
      if (e.pointerType === 'touch' || e.button !== 0) return;
      drag = { id: e.pointerId, x: e.clientX, left: track.scrollLeft, moved: false, lastX: e.clientX, lastT: e.timeStamp, v: 0 };
    });
    bag.on(track, 'pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x;
      if (!drag.moved) {
        if (Math.abs(dx) < 6) return;
        drag.moved = true;
        track.classList.add('is-dragging');
        try { track.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ }
        window.getSelection()?.removeAllRanges();
      }
      e.preventDefault();
      const dt = Math.max(1, e.timeStamp - drag.lastT);
      drag.v = (e.clientX - drag.lastX) / dt;
      drag.lastX = e.clientX;
      drag.lastT = e.timeStamp;
      track.scrollLeft = drag.left - dx;
    });
    const end = (e) => {
      if (!drag || (e.pointerId !== undefined && e.pointerId !== drag.id)) return;
      const { moved, v } = drag;
      drag = null;
      if (!moved) return;
      dragged = true;
      track.classList.remove('is-dragging');
      // A flick carries on a little; scroll-snap then settles on the nearest card.
      if (!reduced && Math.abs(v) > 0.25) track.scrollBy({ left: -v * 320, behavior: 'smooth' });
    };
    bag.on(track, 'pointerup', end);
    bag.on(track, 'pointercancel', end);
    bag.on(track, 'lostpointercapture', end);
    bag.on(track, 'click', (e) => { if (dragged) { e.preventDefault(); e.stopPropagation(); dragged = false; } }, true);
  });
}

/* ---------------- Testimonials: the reader chooses whose words ---------------- */
// Each [data-quote-btn] carries its review in data-text, data-name and data-org; the quote and
// its citation always change together.
export function initQuotes(view, bag) {
  $$('[data-quote]', view).forEach((wrap) => {
    const q = $('[data-quote-text]', wrap);
    const nameEl = $('[data-quote-name]', wrap);
    const orgEl = $('[data-quote-org]', wrap);
    const cite = $('.voices__cite', wrap);
    const fig = $('[data-quote-fig]', wrap) || q;
    const btns = $$('[data-quote-btn]', wrap);
    if (!q || !btns.length) return;
    let shown = btns.find((b) => b.classList.contains('is-active')) || btns[0];
    let busy = false;
    let pending = null;

    const apply = (b) => {
      q.innerHTML = b.dataset.text;
      if (nameEl) nameEl.textContent = b.dataset.name || '';
      if (orgEl) orgEl.textContent = b.dataset.org || '';
      shown = b;
    };
    // Reserve the height of the longest review, so the page never jumps as they change.
    const fit = () => {
      if (busy) return;
      const current = shown;
      fig.style.minHeight = '';
      let h = 0;
      btns.forEach((b) => { apply(b); h = Math.max(h, fig.offsetHeight); });
      apply(current);
      fig.style.minHeight = `${h}px`;
    };
    fit();
    document.fonts?.ready.then(fit);
    let t = 0;
    bag.on(window, 'resize', () => { clearTimeout(t); t = setTimeout(fit, 200); });
    bag.add(() => clearTimeout(t));

    const done = () => {
      busy = false;
      if (pending && pending !== shown) { const p = pending; pending = null; swap(p); } else pending = null;
    };
    const swap = (b) => {
      if (reduced) { apply(b); return; }
      busy = true;
      const out = SplitText.create(q, { type: 'lines', mask: 'lines', linesClass: 'ln' });
      if (cite) gsap.to(cite, { autoAlpha: 0, y: -8, duration: 0.4, ease: EASE.io, overwrite: true });
      gsap.to(out.lines, {
        yPercent: -105, duration: 0.6, ease: EASE.io, stagger: 0.04,
        onComplete: () => {
          out.revert();
          apply(b);
          const inn = SplitText.create(q, { type: 'lines', mask: 'lines', linesClass: 'ln' });
          if (cite) gsap.fromTo(cite, { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.8, delay: 0.3, ease: EASE.out, overwrite: true });
          gsap.from(inn.lines, {
            yPercent: 105, duration: DUR.slow, ease: EASE.out, stagger: STAGGER,
            onComplete: () => { inn.revert(); done(); },
          });
        },
      });
    };
    btns.forEach((b) => bag.on(b, 'click', () => {
      if (b.classList.contains('is-active')) return;
      btns.forEach((o) => { const on = o === b; o.classList.toggle('is-active', on); o.setAttribute('aria-pressed', String(on)); });
      if (busy) pending = b; else swap(b);
    }));
  });
}

/* ---------------- Enquiry form ---------------- */
// Submissions go to data-endpoint on the form: any URL that accepts a JSON POST and answers 2xx
// (Formspree, a serverless function, a CRM webhook). With no endpoint set, nothing is sent and
// the visitor is told so plainly, with the enquiry ready to send by email instead.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DIRECT = 'call <a href="tel:+919100444648">+91 910 044 4648</a> or write to <a href="mailto:info@edomotics.com">info@edomotics.com</a>';

export function initForm(view, bag) {
  $$('[data-form]', view).forEach((form) => {
    const status = $('[data-form-status]', form);
    const submit = $('[data-submit]', form);
    const label = $('[data-submit-label]', form);
    const endpoint = (form.dataset.endpoint || '').trim();
    const el = form.elements;
    const checked = () => $$('input[name="interest"]:checked', form).map((i) => i.value);
    const rules = {
      name: () => el.name.value.trim().length >= 2 || 'Please tell us your name.',
      email: () => {
        const v = el.email.value.trim();
        if (!v) return 'Please add an email address, so we can reply.';
        return EMAIL.test(v) || 'That email address doesn’t look complete.';
      },
      phone: () => {
        const v = el.phone?.value.trim() || '';
        if (!v) return true;
        const digits = v.replace(/\D/g, '').length;
        return (/^[+\d\s().-]+$/.test(v) && digits >= 8 && digits <= 15) || 'Please check the number: digits, spaces and a leading + only.';
      },
      interest: () => checked().length > 0 || 'Please choose at least one, or “Not sure yet”.',
      message: () => (el.message?.value.length || 0) <= 2000 || 'Please keep the message under 2,000 characters.',
    };
    const fieldOf = (name) => (name === 'interest' ? $('.chips', form) : el[name]?.closest('.field'));
    const control = (name) => (name === 'interest' ? $('input[name="interest"]', form) : el[name]);
    const mark = (name, msg) => {
      const field = fieldOf(name);
      const err = $(`[data-error-for="${name}"]`, form);
      const bad = typeof msg === 'string';
      field?.classList.toggle('is-invalid', bad);
      if (name === 'interest') $$('input[name="interest"]', form).forEach((i) => i.toggleAttribute('aria-invalid', bad));
      else control(name)?.setAttribute('aria-invalid', String(bad));
      if (err) err.textContent = bad ? msg : '';
      return bad;
    };
    const check = (name) => mark(name, rules[name]());
    const show = (kind, html) => {
      if (!status) return;
      status.hidden = false;
      status.className = `form__status is-${kind}`;
      status.innerHTML = html;
    };
    const sending = (on) => {
      if (submit) submit.disabled = on;
      if (label) label.textContent = on ? 'Sending…' : 'Send enquiry';
      form.setAttribute('aria-busy', String(on));
    };
    const collect = () => ({
      name: el.name.value.trim(),
      email: el.email.value.trim(),
      phone: el.phone?.value.trim() || '',
      interest: checked(),
      centre: el.centre?.value || '',
      stage: el.stage?.value || '',
      message: el.message?.value.trim() || '',
      page: location.href,
    });
    const mailto = (d) => {
      const body = [
        `Name: ${d.name}`, `Email: ${d.email}`, d.phone && `Phone: ${d.phone}`,
        `Interested in: ${d.interest.join(', ')}`, d.centre && `Nearest experience centre: ${d.centre}`, d.stage && `Project stage: ${d.stage}`,
        d.message && `\n${d.message}`,
      ].filter(Boolean).join('\n');
      return `mailto:info@edomotics.com?subject=${encodeURIComponent(`Enquiry from ${d.name}`)}&body=${encodeURIComponent(body)}`;
    };

    // Once someone has tried to send, errors clear as soon as they're fixed.
    let tried = false;
    Object.keys(rules).forEach((name) => {
      const targets = name === 'interest' ? $$('input[name="interest"]', form) : [el[name]].filter(Boolean);
      targets.forEach((t) => {
        bag.on(t, name === 'interest' ? 'change' : 'input', () => { if (tried) check(name); });
        if (name !== 'interest') bag.on(t, 'blur', () => { if (tried || t.value) check(name); });
      });
    });

    bag.on(form, 'submit', async (e) => {
      e.preventDefault();
      tried = true;
      const bad = Object.keys(rules).filter((name) => check(name));
      if (bad.length) {
        show('error', bad.length === 1 ? 'Please check the highlighted field.' : `Please check the ${bad.length} highlighted fields.`);
        control(bad[0])?.focus();
        return;
      }
      if (el.website?.value) return; // honeypot: a person never fills this in
      const data = collect();
      if (!endpoint) {
        show('info', `<strong>Online enquiries aren’t connected yet, so nothing has been sent.</strong> <a href="${mailto(data)}">Send this enquiry from your email app</a>, or ${DIRECT}.`);
        return;
      }
      sending(true);
      show('info', 'Sending your enquiry…');
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        form.reset();
        tried = false;
        Object.keys(rules).forEach((name) => mark(name, true));
        show('ok', '<strong>Thank you. Your enquiry has been sent.</strong> We’ll be in touch to arrange a conversation, or a visit to the experience centre.');
      } catch (err) {
        show('error', `<strong>Your enquiry couldn’t be sent.</strong> Please try again in a moment, or ${DIRECT}.`);
      } finally {
        sending(false);
      }
    });
  });
}

/* ---------------- Footer ---------------- */
export function initFooter(view) {
  const year = $('[data-year]', view);
  if (year) year.textContent = new Date().getFullYear();
}

/* ---------------- Projects index: grid ⇄ list, with a floating preview in the list ---------------- */
export function initProjectIndex(view, bag) {
  const root = $('[data-pindex]', view);
  if (!root) return;
  const count = $('[data-pcount]', root);
  if (count) count.textContent = String($$('.pcard', root).length);
  const toggles = $$('[data-view-toggle]', root);
  const views = { grid: $('[data-pgrid]', root), list: $('[data-plist]', root) };
  let mode = 'grid';
  const set = (next) => {
    if (next === mode) return;
    mode = next;
    toggles.forEach((t) => { const on = t.dataset.viewToggle === next; t.classList.toggle('is-active', on); t.setAttribute('aria-pressed', String(on)); });
    const show = views[next];
    const hide = views[next === 'grid' ? 'list' : 'grid'];
    gsap.killTweensOf([hide, show, ...show.children]);
    if (reduced) { hide.hidden = true; show.hidden = false; ScrollTrigger.refresh(); return; }
    gsap.to(hide, {
      opacity: 0, y: 24, duration: 0.45, ease: EASE.io,
      onComplete: () => {
        hide.hidden = true; show.hidden = false; gsap.set(hide, { clearProps: 'all' });
        gsap.fromTo(show.children, { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: DUR.slow, ease: EASE.out, stagger: 0.07, clearProps: 'all' });
        ScrollTrigger.refresh();
      },
    });
  };
  toggles.forEach((t) => bag.on(t, 'click', () => set(t.dataset.viewToggle)));

  // List view: the project's photograph follows the cursor (fine pointers only).
  const preview = $('[data-ppreview]', root);
  if (!preview || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  const img = $('img', preview);
  const xTo = gsap.quickTo(preview, 'x', { duration: 0.6, ease: 'power3' });
  const yTo = gsap.quickTo(preview, 'y', { duration: 0.6, ease: 'power3' });
  $$('[data-prow]', root).forEach((row) => {
    bag.on(row, 'pointerenter', () => {
      img.src = row.dataset.preview;
      gsap.to(preview, { autoAlpha: 1, scale: 1, duration: 0.5, ease: EASE.out });
    });
    bag.on(row, 'pointerleave', () => gsap.to(preview, { autoAlpha: 0, scale: 0.92, duration: 0.4, ease: EASE.io }));
  });
  bag.on(views.list, 'pointermove', (e) => { xTo(e.clientX); yTo(e.clientY); });
  bag.add(() => gsap.set(preview, { autoAlpha: 0 }));
}
