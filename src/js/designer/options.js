// Design your cinema: every choice a visitor can make, and the rules that place things in the room.
// Rooms, screen sizes, shapes, screen types and speaker styles are Edomotics' own (Nov 2026); seats,
// finishes and the rest are placeholders until it supplies them. Change them here; the panel and the
// 3D room follow.
// Distances are in metres; the room's screen wall is at z = 0 and the back wall at z = length.
const FT = 0.3048;

// Inside width × length, and the ceiling height: the larger rooms are taller, so the largest
// screens fit in them.
export const ROOMS = [
  { id: 's', label: '12 × 15 ft', w: 12 * FT, l: 15 * FT, h: 10 * FT },
  { id: 'm', label: '14 × 18 ft', w: 14 * FT, l: 18 * FT, h: 10 * FT },
  { id: 'ml', label: '16 × 24 ft', w: 16 * FT, l: 24 * FT, h: 11 * FT },
  { id: 'l', label: '20 × 30 ft', w: 20 * FT, l: 30 * FT, h: 12 * FT },
];

export const SEATS = [
  { id: 'cognac', label: 'Cognac', color: '#6e3c22' },
  { id: 'ivory', label: 'Ivory', color: '#d6c9b3' },
  { id: 'graphite', label: 'Graphite', color: '#3c3b38' },
  { id: 'oxblood', label: 'Oxblood', color: '#5c1e1d' },
];
export const WALLS = [
  { id: 'walnut', label: 'Walnut slats', kind: 'slats', color: '#5a3a25' },
  { id: 'oak', label: 'Oak slats', kind: 'slats', color: '#a07a52' },
  { id: 'charcoal', label: 'Charcoal fabric', kind: 'fabric', color: '#2e2d2b' },
  { id: 'sand', label: 'Sand fabric', kind: 'fabric', color: '#a8977f' },
];
export const CEILINGS = [
  { id: 'plain', label: 'Plain' },
  { id: 'cove', label: 'Cove light' },
  { id: 'stars', label: 'Starlit' },
];
export const FLOORS = [
  { id: 'charcoal', label: 'Charcoal', color: '#2a2927' },
  { id: 'sand', label: 'Sand', color: '#8f7f69' },
  { id: 'oxblood', label: 'Oxblood', color: '#45201d' },
];
export const SCREENS = [120, 135, 150, 165, 180, 200].map((inches) => ({ id: String(inches), label: `${inches}″`, inches }));
export const SHAPES = [
  { id: 'wide', label: '16:9', ratio: 16 / 9 },
  { id: 'scope', label: '2.35:1', ratio: 2.35 },
];

// The picture: a projection screen (fixed, or motorised: it rolls down from a ceiling cassette)
// with the projector that lights it, or a television. Speakers: a layout (ear-level . subwoofers .
// overhead) and whether they are seen.
export const DISPLAYS = [
  { id: 'screen', label: 'Projection screen' },
  { id: 'tv', label: 'Television' },
];
export const TV_SIZES = [
  { id: '75', label: '75″', inches: 75 },
  { id: '85', label: '85″', inches: 85 },
  { id: '98', label: '98″', inches: 98 },
];
export const SCREEN_TYPES = [
  { id: 'fixed', label: 'Fixed frame' },
  { id: 'drop', label: 'Motorised' },
];
export const THROWS = [
  { id: 'long', label: 'Long throw', ratio: 1.5 },
  { id: 'short', label: 'Short throw', ratio: 0.7 },
  { id: 'ust', label: 'Ultra short throw', ratio: 0.25 },
];
export const SOUNDS = [
  { id: '51', label: '5.1', ear: 5, subs: 1, over: 0 },
  { id: '71', label: '7.1', ear: 7, subs: 1, over: 0 },
  { id: '512', label: '5.1.2', ear: 5, subs: 1, over: 2 },
  { id: '714', label: '7.1.4', ear: 7, subs: 1, over: 4 },
  { id: '924', label: '9.2.4', ear: 9, subs: 2, over: 4 },
  { id: '926', label: '9.2.6', ear: 9, subs: 2, over: 6 },
];
export const SPEAKER_STYLES = [
  { id: 'visible', label: 'Visible' },
  { id: 'hidden', label: 'Concealed' },
];

// Placement rules (placeholders): seat pitch and depth, side aisles, row spacing, clearances.
export const RULES = {
  seatWidth: 0.8, seatDepth: 1.0, aisle: 0.5, rowSpacing: 1.85, riser: 0.25,
  backClear: 0.45, frontClear: 1.8, screenSide: 0.35, screenBottom: 0.6, screenTop: 0.3,
  minRows: 1, maxRows: 3, minSeats: 2, maxSeats: 5,
};

// The panel, in order. 'steps' is the rows × seats stepper; the rest are single choices.
export const GROUPS = [
  { key: 'room', label: 'Room', items: ROOMS },
  { key: 'seating', label: 'Seating', type: 'steps' },
  { key: 'seat', label: 'Seats', items: SEATS, swatch: true },
  { key: 'walls', label: 'Walls', items: WALLS, swatch: true },
  { key: 'ceiling', label: 'Ceiling', items: CEILINGS },
  { key: 'floor', label: 'Floor', items: FLOORS, swatch: true },
  { key: 'display', label: 'Display', items: DISPLAYS },
  { key: 'screen', label: 'Screen size', items: SCREENS, when: (s) => s.display === 'screen' },
  { key: 'tv', label: 'Television size', items: TV_SIZES, when: (s) => s.display === 'tv' },
  { key: 'shape', label: 'Screen shape', items: SHAPES, when: (s) => s.display === 'screen' },
  { key: 'stype', label: 'Screen type', items: SCREEN_TYPES, when: (s) => s.display === 'screen' },
  { key: 'throw', label: 'Projector', items: THROWS, when: (s) => s.display === 'screen' },
  { key: 'sound', label: 'Sound system', items: SOUNDS, note: 'Speakers at ear level · subwoofers · overhead speakers.' },
  { key: 'spk', label: 'Speakers', items: SPEAKER_STYLES },
];

export const DEFAULTS = {
  room: 'm', rows: 2, seats: 3, seat: 'cognac', walls: 'walnut', ceiling: 'stars', floor: 'charcoal', screen: '120', shape: 'scope',
  display: 'screen', tv: '85', stype: 'fixed', throw: 'long', sound: '714', spk: 'hidden',
};

const LISTS = {
  room: ROOMS, seat: SEATS, walls: WALLS, ceiling: CEILINGS, floor: FLOORS, screen: SCREENS, shape: SHAPES,
  display: DISPLAYS, tv: TV_SIZES, stype: SCREEN_TYPES, throw: THROWS, sound: SOUNDS, spk: SPEAKER_STYLES,
};
export const pick = (key, id) => LISTS[key].find((o) => o.id === id) || LISTS[key].find((o) => o.id === DEFAULTS[key]);

export function screenSize(screenId, shapeId) {
  const d = pick('screen', screenId).inches * 0.0254;
  const r = pick('shape', shapeId).ratio;
  const h = d / Math.sqrt(1 + r * r);
  return { w: h * r, h };
}

export function tvSize(tvId) {
  const d = pick('tv', tvId).inches * 0.0254;
  const h = d / Math.sqrt(1 + (16 / 9) ** 2);
  return { w: h * 16 / 9, h };
}

// What fits the chosen room: seats per row, rows, and which screen sizes.
export function limits(s) {
  const room = pick('room', s.room);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const seats = clamp(Math.floor((room.w - 2 * RULES.aisle) / RULES.seatWidth), RULES.minSeats, RULES.maxSeats);
  const depth = room.l - RULES.backClear - RULES.frontClear - RULES.seatDepth;
  const rows = clamp(1 + Math.floor(depth / RULES.rowSpacing), RULES.minRows, RULES.maxRows);
  const fits = Object.fromEntries(SCREENS.map((o) => {
    const { w, h } = screenSize(o.id, s.shape);
    return [o.id, w <= room.w - 2 * RULES.screenSide && RULES.screenBottom + h <= room.h - RULES.screenTop];
  }));
  return { seats, rows, fits };
}

// A valid design: unknown ids fall back to the defaults, counts stay within the room, and a
// screen too wide for the room steps down to the largest that fits.
export function normalise(input) {
  const s = { ...DEFAULTS, ...input };
  Object.keys(LISTS).forEach((k) => { s[k] = pick(k, s[k]).id; });
  const lim = limits(s);
  s.rows = Math.max(RULES.minRows, Math.min(lim.rows, Math.round(+s.rows) || DEFAULTS.rows));
  s.seats = Math.max(RULES.minSeats, Math.min(lim.seats, Math.round(+s.seats) || DEFAULTS.seats));
  if (!lim.fits[s.screen]) s.screen = [...SCREENS].reverse().find((o) => lim.fits[o.id])?.id || SCREENS[0].id;
  return s;
}

// Where everything goes. Rows sit toward the back wall; the front row is on the floor and each row
// behind rises by one step. The main listening position is the centre seat of the middle row.
export function layout(s) {
  const room = pick('room', s.room);
  const W = room.w, L = room.l, H = room.h;
  const rows = Array.from({ length: s.rows }, (_, i) => {
    const fromBack = s.rows - 1 - i;
    return {
      z: L - RULES.backClear - RULES.seatDepth / 2 - fromBack * RULES.rowSpacing,
      y: i * RULES.riser,
      xs: Array.from({ length: s.seats }, (__, k) => (k - (s.seats - 1) / 2) * RULES.seatWidth),
    };
  });
  const tv = s.display === 'tv';
  const scr = tv ? tvSize(s.tv) : screenSize(s.screen, s.shape);
  const bottom = tv ? 0.75 : RULES.screenBottom;
  const screen = { ...scr, tv, y: Math.min(H - RULES.screenTop - scr.h / 2, bottom + scr.h / 2) };
  const row = rows[Math.floor(rows.length / 2)];
  const mlp = { x: row.xs[Math.floor((row.xs.length - 1) / 2)], y: row.y + 1.1, z: row.z + 0.15 };
  return { W, L, H, rows, screen, mlp };
}

// The design as a short, readable link parameter: room.rows.seats.seat.walls.ceiling.floor.screen.shape…
const ORDER = ['room', 'rows', 'seats', 'seat', 'walls', 'ceiling', 'floor', 'screen', 'shape', 'display', 'tv', 'stype', 'throw', 'sound', 'spk'];
// Links made earlier still open: they carried a screen surface and a projector light (17 parts),
// or only the first nine choices. Values that no longer exist fall back to the defaults.
const EARLIER = ['room', 'rows', 'seats', 'seat', 'walls', 'ceiling', 'floor', 'screen', 'shape', 'display', 'tv', 'stype', 'surface', 'throw', 'lamp', 'sound', 'spk'];
const FIRST = 9;
export const encode = (s) => ORDER.map((k) => s[k]).join('.');
export function decode(str) {
  const parts = String(str || '').split('.');
  const keys = parts.length === ORDER.length ? ORDER : parts.length === EARLIER.length ? EARLIER : parts.length === FIRST ? ORDER : null;
  if (!keys) return {};
  return Object.fromEntries(parts.map((v, i) => [keys[i], v]).filter(([k]) => k in DEFAULTS));
}

export function describe(s) {
  const n = s.rows * s.seats;
  return [
    ['Room', pick('room', s.room).label],
    ['Seating', `${s.rows} ${s.rows === 1 ? 'row' : 'rows'} of ${s.seats} · ${n} seats`],
    ['Seats', pick('seat', s.seat).label],
    ['Walls', pick('walls', s.walls).label],
    ['Ceiling', pick('ceiling', s.ceiling).label],
    ['Floor', `${pick('floor', s.floor).label} carpet`],
    s.display === 'tv'
      ? ['Display', `${pick('tv', s.tv).label} television`]
      : ['Screen', `${pick('screen', s.screen).label} · ${pick('shape', s.shape).label} · ${pick('stype', s.stype).label}`],
    ...(s.display === 'tv' ? [] : [['Projector', pick('throw', s.throw).label]]),
    ['Sound', `${pick('sound', s.sound).label} · ${pick('spk', s.spk).label} speakers`],
  ];
}
