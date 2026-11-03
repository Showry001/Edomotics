// Design your cinema: every choice a visitor can make, and the rules that place things in the room.
// PLACEHOLDERS: the values follow common home-cinema practice until Edomotics supplies its own
// rooms, seats, finishes and screen sizes. Change them here; the panel and the 3D room follow.
// Distances are in metres; the room's screen wall is at z = 0 and the back wall at z = length.
const FT = 0.3048;

export const ROOMS = [
  { id: 's', label: '10 × 12 ft', w: 10 * FT, l: 12 * FT },
  { id: 'm', label: '14 × 18 ft', w: 14 * FT, l: 18 * FT },
  { id: 'l', label: '20 × 30 ft', w: 20 * FT, l: 30 * FT },
];
export const CEILING_HEIGHT = 10 * FT;

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
export const SCREENS = [
  { id: '100', label: '100″', inches: 100 },
  { id: '120', label: '120″', inches: 120 },
  { id: '135', label: '135″', inches: 135 },
];
export const SHAPES = [
  { id: 'wide', label: '16:9', ratio: 16 / 9 },
  { id: 'scope', label: '2.35:1', ratio: 2.35 },
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
  { key: 'screen', label: 'Screen size', items: SCREENS },
  { key: 'shape', label: 'Screen shape', items: SHAPES },
];

export const DEFAULTS = {
  room: 'm', rows: 2, seats: 3, seat: 'cognac', walls: 'walnut', ceiling: 'stars', floor: 'charcoal', screen: '120', shape: 'scope',
};

const LISTS = { room: ROOMS, seat: SEATS, walls: WALLS, ceiling: CEILINGS, floor: FLOORS, screen: SCREENS, shape: SHAPES };
export const pick = (key, id) => LISTS[key].find((o) => o.id === id) || LISTS[key].find((o) => o.id === DEFAULTS[key]);

export function screenSize(screenId, shapeId) {
  const d = pick('screen', screenId).inches * 0.0254;
  const r = pick('shape', shapeId).ratio;
  const h = d / Math.sqrt(1 + r * r);
  return { w: h * r, h };
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
    return [o.id, w <= room.w - 2 * RULES.screenSide && RULES.screenBottom + h <= CEILING_HEIGHT - RULES.screenTop];
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
  const W = room.w, L = room.l, H = CEILING_HEIGHT;
  const rows = Array.from({ length: s.rows }, (_, i) => {
    const fromBack = s.rows - 1 - i;
    return {
      z: L - RULES.backClear - RULES.seatDepth / 2 - fromBack * RULES.rowSpacing,
      y: i * RULES.riser,
      xs: Array.from({ length: s.seats }, (__, k) => (k - (s.seats - 1) / 2) * RULES.seatWidth),
    };
  });
  const scr = screenSize(s.screen, s.shape);
  const screen = { ...scr, y: Math.min(H - RULES.screenTop - scr.h / 2, RULES.screenBottom + scr.h / 2) };
  const row = rows[Math.floor(rows.length / 2)];
  const mlp = { x: row.xs[Math.floor((row.xs.length - 1) / 2)], y: row.y + 1.1, z: row.z + 0.15 };
  return { W, L, H, rows, screen, mlp };
}

// The design as a short, readable link parameter: room.rows.seats.seat.walls.ceiling.floor.screen.shape
const ORDER = ['room', 'rows', 'seats', 'seat', 'walls', 'ceiling', 'floor', 'screen', 'shape'];
export const encode = (s) => ORDER.map((k) => s[k]).join('.');
export function decode(str) {
  const parts = String(str || '').split('.');
  if (parts.length !== ORDER.length) return {};
  return Object.fromEntries(ORDER.map((k, i) => [k, parts[i]]));
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
    ['Screen', `${pick('screen', s.screen).label} · ${pick('shape', s.shape).label}`],
  ];
}
