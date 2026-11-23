// Design your cinema: the options panel, the design summary and its link. The choices come from
// options.js. The 3D room (scene.js, with three.js) is fetched only when it's needed: as the
// section nears the screen on desktops, or when a phone or tablet visitor taps "Explore in 3D".
import { $, $$, lenis } from '../core.js';
import { GROUPS, RULES, normalise, limits, encode, decode, describe } from './options.js';

const LITE = '(max-width: 860px), (pointer: coarse)';
const EMAIL = 'info@edomotics.com';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function hasWebGL() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return !!gl;
  } catch {
    return false;
  }
}

const stepper = (key, name, fewer, more) => `
  <div class="dstep">
    <span class="dstep__name" id="d-${key}">${name}</span>
    <button type="button" class="round" data-step="${key}" data-dir="-1" aria-label="${fewer}">−</button>
    <output class="dstep__val" data-out="${key}" aria-labelledby="d-${key}"></output>
    <button type="button" class="round" data-step="${key}" data-dir="1" aria-label="${more}">+</button>
  </div>`;

function panelHTML() {
  return GROUPS.map((g) => {
    if (g.type === 'steps') {
      return `<fieldset class="field dgroup"><legend>${g.label}</legend>${stepper('rows', 'Rows', 'Fewer rows', 'More rows')}${stepper('seats', 'Seats per row', 'Fewer seats per row', 'More seats per row')}<p class="dgroup__note" data-note="seating"></p></fieldset>`;
    }
    const chips = g.items.map((o) => `<label class="chip"><input type="radio" name="d-${g.key}" value="${o.id}"><span>${g.swatch ? `<i class="dswatch" style="--c: ${o.color}" aria-hidden="true"></i>` : ''}${esc(o.label)}</span></label>`).join('');
    const note = g.key === 'screen' ? '<p class="dgroup__note" data-note="screen"></p>' : g.note ? `<p class="dgroup__note">${esc(g.note)}</p>` : '';
    return `<fieldset class="field dgroup chips" data-group="${g.key}"><legend>${g.label}</legend>${chips}${note}</fieldset>`;
  }).join('');
}

export function initDesigner(view, bag) {
  const root = $('[data-designer]', view);
  if (!root) return;
  const panel = $('[data-designer-panel]', root);
  const stage = $('[data-designer-stage]', root);
  const status = $('[data-designer-status]', root);
  const startBtn = $('[data-designer-start]', root);
  const hint = $('[data-designer-hint]', root);
  const summary = $('[data-designer-summary]', root);
  const send = $('[data-designer-send]', root);
  const copy = $('[data-designer-copy]', root);
  const sceneState = $('[data-designer-scene-state]', root);
  const sceneKeys = $$('[data-scene]', root);
  const viewBtns = $$('[data-designer-view]', root);
  const rollBtn = $('[data-designer-roll]', root);

  let state = normalise(decode(new URLSearchParams(location.search).get('design')));
  let sceneId = sceneKeys.find((k) => k.classList.contains('is-active'))?.dataset.scene || 'interval';
  let viewId = 'overview';
  let api = null;
  let alive = true;
  let loading = false;

  panel.innerHTML = panelHTML();

  const link = () => {
    const url = new URL(location.href);
    url.hash = '';
    url.search = '';
    url.searchParams.set('design', encode(state));
    return url.href;
  };
  const mail = () => {
    const lines = describe(state).map(([k, v]) => `${k}: ${v}`).join('\n');
    const body = `Hello Edomotics,\n\nI designed a home theatre on your website and would like to talk about it.\n\n${lines}\n\nName:\nPhone:\nCity:\n`;
    return `mailto:${EMAIL}?subject=${encodeURIComponent('My home theatre design')}&body=${encodeURIComponent(body)}`;
  };

  // A motorised screen can be raised and lowered; choosing one brings it down.
  const motorised = (s) => s.display === 'screen' && s.stype === 'drop';
  let screenDown = true;
  const showRoll = () => {
    rollBtn.hidden = !motorised(state);
    rollBtn.textContent = screenDown ? 'Raise screen' : 'Lower screen';
  };

  function sync() {
    const lim = limits(state);
    GROUPS.filter((g) => g.items).forEach((g) => {
      // Choices that apply to one kind of display only show with it.
      if (g.when) $(`[data-group="${g.key}"]`, panel).hidden = !g.when(state);
      $$(`input[name="d-${g.key}"]`, panel).forEach((i) => {
        i.checked = i.value === state[g.key];
        if (g.key === 'screen') i.disabled = !lim.fits[i.value];
      });
    });
    [['rows', lim.rows], ['seats', lim.seats]].forEach(([k, max]) => {
      $(`[data-out="${k}"]`, panel).textContent = state[k];
      $(`[data-step="${k}"][data-dir="-1"]`, panel).disabled = state[k] <= (k === 'rows' ? RULES.minRows : RULES.minSeats);
      $(`[data-step="${k}"][data-dir="1"]`, panel).disabled = state[k] >= max;
    });
    $('[data-note="seating"]', panel).textContent = `This room takes up to ${lim.rows} ${lim.rows === 1 ? 'row' : 'rows'} of ${lim.seats}.`;
    const tooWide = Object.values(lim.fits).some((ok) => !ok);
    $('[data-note="screen"]', panel).textContent = tooWide ? 'Larger screens need a wider room.' : '';
    summary.innerHTML = describe(state).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
    send.href = mail();
    showRoll();
  }

  function set(patch) {
    const next = normalise({ ...state, ...patch });
    if (encode(next) === encode(state)) { sync(); return; }
    if (motorised(next) && !motorised(state)) screenDown = true;
    state = next;
    sync();
    api?.update(state);
    // Keep the address current, so a reload or a shared link opens this design.
    const url = new URL(location.href);
    url.searchParams.set('design', encode(state));
    history.replaceState(history.state, '', url);
  }

  bag.on(panel, 'change', (e) => {
    const name = e.target.name || '';
    if (name.startsWith('d-')) set({ [name.slice(2)]: e.target.value });
  });
  bag.on(panel, 'click', (e) => {
    const b = e.target.closest('[data-step]');
    if (b) set({ [b.dataset.step]: state[b.dataset.step] + Number(b.dataset.dir) });
  });
  bag.on(panel, 'submit', (e) => e.preventDefault());


  // Send this design: a dialog takes the visitor's name, phone, location and budget, and sends
  // them with the design summary to data-endpoint (a JSON POST answered with 2xx). With no
  // endpoint set, nothing is sent and the visitor is offered their email app instead.
  const dialog = $('[data-dsend]', root);
  const dform = $('[data-dsend-form]', root);
  const dstatus = $('[data-dsend-status]', root);
  const dsubmit = $('[data-dsend-submit]', root);
  const dlabel = $('[data-dsend-label]', root);
  const dendpoint = (dform.dataset.endpoint || '').trim();
  const DIRECT = 'call <a href="tel:+919100444648">+91 910 044 4648</a> or write to <a href="mailto:info@edomotics.com">info@edomotics.com</a>';
  const drules = {
    name: () => dform.elements.name.value.trim().length >= 2 || 'Please tell us your name.',
    phone: () => {
      const v = dform.elements.phone.value.trim();
      if (!v) return 'Please add a phone number, so we can call you.';
      const digits = v.replace(/\D/g, '').length;
      return (/^[+\d\s().-]+$/.test(v) && digits >= 8 && digits <= 15) || 'Please check the number: digits, spaces and a leading + only.';
    },
    location: () => dform.elements.location.value.length <= 80 || 'Please keep the location short.',
  };
  const dmark = (name, msg) => {
    const bad = typeof msg === 'string';
    const input = dform.elements[name];
    input.closest('.field')?.classList.toggle('is-invalid', bad);
    input.setAttribute('aria-invalid', String(bad));
    const err = $(`[data-error-for="${name}"]`, dform);
    if (err) err.textContent = bad ? msg : '';
    return bad;
  };
  const dcheck = (name) => dmark(name, drules[name]());
  const dshow = (kind, html) => { dstatus.hidden = false; dstatus.className = `form__status is-${kind}`; dstatus.innerHTML = html; };
  const dsending = (on) => { dsubmit.disabled = on; dlabel.textContent = on ? 'Sending…' : 'Send design'; dform.setAttribute('aria-busy', String(on)); };
  const ask = $('[data-dsend-ask]', root);
  const done = $('[data-dsend-done]', root);
  let dtried = false;
  const details = () => ({
    name: dform.elements.name.value.trim(),
    phone: dform.elements.phone.value.trim(),
    location: dform.elements.location.value.trim(),
    budget: dform.elements.budget.value,
  });
  const dmailto = (d) => {
    const lines = [`Name: ${d.name}`, `Phone: ${d.phone}`, d.location && `Location: ${d.location}`, d.budget && `Budget: ${d.budget}`,
      '', 'My home theatre design:', ...describe(state).map(([k, v]) => `${k}: ${v}`)].filter((x) => x !== false && x !== undefined);
    return `mailto:${EMAIL}?subject=${encodeURIComponent('My home theatre design')}&body=${encodeURIComponent(lines.join('\n'))}`;
  };
  function openSend() {
    $('[data-dsend-summary]', dform).innerHTML = describe(state).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
    ask.hidden = false;
    done.hidden = true;
    dstatus.hidden = true;
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    lenis?.stop();
    dform.elements.name.focus();
  }
  const closeSend = () => { if (dialog.open) dialog.close(); };
  bag.on(dialog, 'close', () => lenis?.start());
  bag.on(dialog, 'click', (e) => { if (e.target === dialog) closeSend(); }); // a click on the backdrop
  $$('[data-dsend-close]', root).forEach((b) => bag.on(b, 'click', closeSend));
  bag.on(send, 'click', (e) => { e.preventDefault(); openSend(); });
  Object.keys(drules).forEach((name) => {
    bag.on(dform.elements[name], 'input', () => { if (dtried) dcheck(name); });
    bag.on(dform.elements[name], 'blur', () => { if (dtried || dform.elements[name].value) dcheck(name); });
  });
  bag.on(dform, 'submit', async (e) => {
    e.preventDefault();
    dtried = true;
    const bad = Object.keys(drules).filter((name) => dcheck(name));
    if (bad.length) {
      dshow('error', bad.length === 1 ? 'Please check the highlighted field.' : `Please check the ${bad.length} highlighted fields.`);
      dform.elements[bad[0]].focus();
      return;
    }
    if (dform.elements.website.value) return; // honeypot: a person never fills this in
    const d = details();
    if (!dendpoint) {
      dshow('info', `<strong>Online sending isn’t connected yet, so nothing has been sent.</strong> <a href="${dmailto(d)}">Send your design from your email app</a>, or ${DIRECT}.`);
      return;
    }
    dsending(true);
    try {
      const res = await fetch(dendpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ ...d, subject: 'Home theatre design', design: describe(state).map(([label, value]) => ({ label, value })) }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      dform.reset();
      dtried = false;
      Object.keys(drules).forEach((name) => dmark(name, true));
      ask.hidden = true;
      done.hidden = false;
      done.focus();
    } catch (err) {
      dshow('error', `<strong>Your design couldn’t be sent.</strong> Please try again in a moment, or ${DIRECT}.`);
    } finally {
      dsending(false);
    }
  });
  bag.add(() => { closeSend(); lenis?.start(); });

  let copied = 0;
  bag.on(copy, 'click', async () => {
    const label = copy.dataset.label || copy.textContent;
    copy.dataset.label = label;
    try {
      await navigator.clipboard.writeText(link());
      copy.textContent = 'Link copied';
    } catch {
      copy.textContent = 'Copy the page address to share';
    }
    clearTimeout(copied);
    copied = setTimeout(() => { copy.textContent = label; }, 2400);
  });
  bag.add(() => clearTimeout(copied));

  // Lighting scenes and camera views drive the 3D room once it's there.
  const showScene = (id) => {
    sceneId = id;
    sceneKeys.forEach((k) => { const on = k.dataset.scene === id; k.classList.toggle('is-active', on); k.setAttribute('aria-pressed', String(on)); });
    if (sceneState) sceneState.textContent = $('.key__name', sceneKeys.find((k) => k.dataset.scene === id))?.textContent || '';
  };
  const showView = (id) => {
    viewId = id;
    viewBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.designerView === id)));
    if (!id) hint?.classList.add('is-done');
  };
  sceneKeys.forEach((k) => bag.on(k, 'click', () => { showScene(k.dataset.scene); api?.setScene(k.dataset.scene); }));
  viewBtns.forEach((b) => bag.on(b, 'click', () => { showView(b.dataset.designerView); api?.setView(b.dataset.designerView); }));
  bag.on(rollBtn, 'click', () => { screenDown = !screenDown; api?.setRoll(screenDown); showRoll(); });

  const say = (text) => { status.textContent = text; };
  async function mount() {
    if (api || loading) return;
    loading = true;
    if (startBtn) startBtn.hidden = true;
    say('Building the room…');
    try {
      const { createScene } = await import('./scene.js');
      if (!alive) return;
      api = createScene(stage, state, {
        lite: window.matchMedia(LITE).matches,
        sceneId,
        viewId,
        onReady: () => { stage.classList.add('is-live'); say(''); },
        onView: showView,
      });
    } catch (err) {
      console.error('[edomotics] designer', err);
      stage.classList.add('is-failed');
      say('The 3D room could not start on this device. Your choices still make the design below.');
    } finally {
      loading = false;
    }
  }
  bag.add(() => { alive = false; api?.dispose(); api = null; });

  sync();
  showScene(sceneId);
  showView(viewId);

  if (!hasWebGL()) {
    stage.classList.add('is-failed');
    say('The 3D room needs a newer browser. Your choices still make the design below.');
  } else if (window.matchMedia(LITE).matches) {
    // Phones and tablets: the room starts on a tap, so it never costs battery unasked.
    startBtn.hidden = false;
    bag.on(startBtn, 'click', mount);
  } else {
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { io.disconnect(); mount(); } }, { rootMargin: '50% 0px' });
    io.observe(stage);
    bag.add(() => io.disconnect());
  }
}
