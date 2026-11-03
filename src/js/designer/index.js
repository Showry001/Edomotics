// Design your cinema: the options panel, the design summary and its link. The choices come from
// options.js. The 3D room (scene.js, with three.js) is fetched only when it's needed: as the
// section nears the screen on desktops, or when a phone or tablet visitor taps "Explore in 3D".
import { $, $$ } from '../core.js';
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
    const note = g.key === 'screen' ? '<p class="dgroup__note" data-note="screen"></p>' : '';
    return `<fieldset class="field dgroup chips"><legend>${g.label}</legend>${chips}${note}</fieldset>`;
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
    const body = `Hello Edomotics,\n\nI designed a home theatre on your website and would like to talk about it.\n\n${lines}\n\nMy design: ${link()}\n\nName:\nPhone:\nCity:\n`;
    return `mailto:${EMAIL}?subject=${encodeURIComponent('My home theatre design')}&body=${encodeURIComponent(body)}`;
  };

  function sync() {
    const lim = limits(state);
    GROUPS.filter((g) => g.items).forEach((g) => {
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
  }

  function set(patch) {
    const next = normalise({ ...state, ...patch });
    if (encode(next) === encode(state)) { sync(); return; }
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
