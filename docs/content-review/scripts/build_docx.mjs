// Builds "Website_Content_Sitemap_and_Review_v1.0.docx" from build/extracted-content.json.
// Every piece of website copy comes from that file (extracted from the built site); nothing
// below retypes site text. Document furniture (instructions, labels) is written here.
// Layout: a compact review matrix (one table per website page, one row per content block,
// a status line per section), so the whole inventory stays within about fifteen pages.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AlignmentType, Bookmark, BorderStyle, CheckBox, Document, Footer, Header, HeadingLevel, HeightRule,
  InternalHyperlink, LevelFormat, Packer, PageNumber, Paragraph, ShadingType, Table, TableCell,
  TableLayoutType, TableOfContents, TableRow, TabStopType, TextRun, VerticalAlign, WidthType,
} from 'docx';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, '..');
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'build/extracted-content.json'), 'utf8'));
const OUT = path.join(ROOT, 'Website_Content_Sitemap_and_Review_v1.0.docx');

const VERSION = 'V1.0';
const fmtDate = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const PREPARED = fmtDate(process.env.PREPARED_DATE || data.site.extractedAt);
const SITE_DATE = process.env.SITE_DATE ? fmtDate(process.env.SITE_DATE) : '';
const CLIENT = 'Edomotics Smart Systems Pvt Ltd';

// ---------------------------------------------------------------- look ------------------
const INK = '12110E';
const MUTED = '6B655C';
const ACCENT = '9A6416';      // deep amber, readable as text
const ACCENT_LINE = 'D9922B'; // brand amber, for rules
const CURRENT = 'FAF7F2';     // current-content cells (read-only look)
const STONE = 'E6DED1';       // section rows
const LINE = 'D6CCBC';
const SANS = 'Arial';
const SERIF = 'Georgia';
const T = 15;                 // table text, half-points (7.5 pt)
const TS = 14;                // small table text (7 pt)

const A4 = { width: 11906, height: 16838 };
const MARGIN = { top: 850, bottom: 780, left: 720, right: 720, header: 400, footer: 380 };
const W = A4.width - MARGIN.left - MARGIN.right; // 10466
const sum = (a) => a.reduce((x, y) => x + y, 0);
const fit = (ws) => [...ws.slice(0, -1), W - sum(ws.slice(0, -1))]; // last column takes the rest of the width

const border = (color = LINE, size = 4) => ({ style: BorderStyle.SINGLE, size, color });
const BORDERS = { top: border(), bottom: border(), left: border(), right: border(), insideHorizontal: border(), insideVertical: border() };
const WRITE_BORDERS = { top: border(ACCENT_LINE, 6), bottom: border(ACCENT_LINE, 6), left: border(ACCENT_LINE, 6), right: border(ACCENT_LINE, 6),
  insideHorizontal: border(ACCENT_LINE, 4), insideVertical: border(ACCENT_LINE, 4) };

const run = (text, o = {}) => new TextRun({ text, font: o.font || SANS, size: o.size || 17, bold: o.bold, italics: o.italics, color: o.color || INK, characterSpacing: o.spacing });
const p = (children, o = {}) => new Paragraph({
  children: (Array.isArray(children) ? children : [children]).map((c) => (typeof c === 'string' ? run(c, o) : c)),
  alignment: o.align, spacing: { before: o.before ?? 0, after: o.after ?? 80, line: o.line ?? 252 },
  keepNext: o.keepNext, keepLines: o.keepLines, indent: o.indent, border: o.border, style: o.style,
  numbering: o.numbering, pageBreakBefore: o.pageBreakBefore, tabStops: o.tabStops,
});
const tp = (children, o = {}) => p(children, { after: 0, line: 240, ...o }); // paragraph inside a table cell
const label = (text, o = {}) => p(run(text.toUpperCase(), { size: 14, bold: true, color: ACCENT, spacing: 20 }), { before: o.before ?? 120, after: 50, keepNext: true });

function cell(children, o = {}) {
  const paras = (Array.isArray(children) ? children : [children]).map((c) => (typeof c === 'string' ? tp(run(c, { size: o.size || T, bold: o.bold, color: o.color })) : c));
  return new TableCell({
    width: { size: o.width, type: WidthType.DXA },
    shading: o.fill ? { fill: o.fill, type: ShadingType.CLEAR, color: 'auto' } : undefined,
    margins: { top: o.pad ?? 25, bottom: o.pad ?? 25, left: 80, right: 80 },
    verticalAlign: o.vAlign || VerticalAlign.TOP,
    columnSpan: o.span,
    children: paras.length ? paras : [tp('')],
  });
}
const row = (cells, o = {}) => new TableRow({ children: cells, tableHeader: o.header, cantSplit: true, height: o.height ? { value: o.height, rule: HeightRule.ATLEAST } : undefined });
const headRow = (titles, widths) => row(titles.map((t, i) => cell([tp(run(t, { size: TS, bold: true, color: 'FFFFFF' }), { keepNext: true })], { width: widths[i], fill: '2B2925' })), { header: true });
const table = (widths, rows, o = {}) => new Table({
  width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
  columnWidths: widths, layout: TableLayoutType.FIXED, borders: o.borders || BORDERS, rows,
  margins: { top: 25, bottom: 25, left: 80, right: 80 }, // table default as well as per cell (some editors read only this)
});
const spacer = (after = 120) => p('', { after, line: 200 });

// Two label/value pairs per row.
function kv4(pairs, widths = fit([1700, 3533, 1700, 0]), height) {
  const rows = [];
  for (let i = 0; i < pairs.length; i += 2) {
    const [a, b] = [pairs[i], pairs[i + 1]];
    const k = (t, w) => cell(t, { width: w, fill: STONE, bold: true, size: TS });
    rows.push(row(b
      ? [k(a[0], widths[0]), cell(a[1], { width: widths[1] }), k(b[0], widths[2]), cell(b[1], { width: widths[3] })]
      : [k(a[0], widths[0]), cell(a[1], { width: sum(widths.slice(1)), span: 3 })], { height }));
  }
  return table(widths, rows);
}

const anchorId = (id) => `ref_${id.replace(/[^A-Za-z0-9]/g, '_')}`;
const link = (id, text, size = 17) => new InternalHyperlink({ anchor: anchorId(id), children: [new TextRun({ text, font: SANS, size, color: ACCENT, underline: {} })] });
const boxes = (labels, checked, size = TS) => labels.flatMap((t) => [
  new CheckBox({ checked: t === checked, checkedState: { value: '2612', font: 'MS Gothic' }, uncheckedState: { value: '2610', font: 'MS Gothic' } }),
  run(` ${t}    `, { size }),
]);
const STATUS = ['Approved', 'Changes Required', 'Pending'];

// ---------------------------------------------------------------- review matrix ---------
// Each content block (the texts of a section, a set of cards, a form…) is one table row: every
// piece of text on its own line, its element name in a fixed left-hand column, and one
// "proposed change" cell beside the block.
const GLOBAL_NAMES = Object.fromEntries(data.globals.map((g) => [g.id, g.name]));
const ID_COLS = new Set(['#', 'No.', 'Step']);
const isLink = (c) => /^(Link|Links|Goes to)$/.test(c);
const isImage = (c) => /^Image description$/.test(c);
const LABEL_W = 1500;                       // element-name column inside the current-content cell
const COLS = [W - 2100, 2100];              // current content | proposed change

// Destinations and image descriptions follow the text on the same line, in small grey type.
const linkRun = (dest) => run(`   → ${dest}`, { size: TS, color: MUTED });
const imageRuns = (text) => [run('   Image: ', { size: TS, bold: true, color: MUTED }), run(text, { size: TS, italics: true, color: MUTED })];
const SEP = () => run('   ·   ', { size: T, color: ACCENT });

// Shorter names for a few element types, so names stay within their column.
const SHORT = { 'Section headline': 'Headline', 'Lead paragraph': 'Lead text', 'Control panel label': 'Panel label',
  'Selected scene indicator': 'Scene indicator', 'Pointer label (desktop)': 'Pointer label' };

// One line of content: element name, tab, text; wrapped lines align with the text.
const line = (element, runs) => tp([run(SHORT[element] || element, { size: TS, color: MUTED }), run('\t', { size: TS }), ...runs],
  { tabStops: [{ type: TabStopType.LEFT, position: LABEL_W }], indent: { left: LABEL_W, hanging: LABEL_W }, before: 24 });
const note = (text) => tp(run(text, { size: TS, italics: true, color: MUTED }), { indent: { left: LABEL_W }, before: 10 });
const heading = (text, noteText) => tp([run(text, { size: TS, bold: true }), ...(noteText ? [run(`   ${noteText}`, { size: TS, italics: true, color: MUTED })] : [])], { before: 60 });

// A block row may run on to the next page; section rows stay with the row below.
const blockRow = (paras) => new TableRow({ children: [cell(paras, { width: COLS[0], fill: CURRENT }), cell('', { width: COLS[1] })] });
const fullRow = (paras, fill) => row([cell(paras, { width: W, span: 2, fill, pad: 30 })]);

function nounFor(title) {
  return [[/slide/i, 'Slide'], [/step/i, 'Step'], [/testimon/i, 'Review'], [/centre/i, 'Centre'], [/leader/i, 'Person'],
    [/team/i, 'Panel'], [/press mention/i, 'Article'], [/menu links/i, 'Menu item'], [/detail/i, 'Detail'], [/project/i, 'Project'],
    [/principle/i, 'Principle'], [/capabilit/i, 'Row'], [/scene/i, 'Caption'], [/statistic/i, 'Figure'], [/message/i, 'Message'],
    [/photograph behind/i, 'Page'], [/contact/i, 'Item']].find(([re]) => re.test(title))?.[1] || 'Card';
}

// Repeated items: one line each, text fields first, then destination and image description.
function itemParas(b) {
  const idCol = b.columns.find((c) => ID_COLS.has(c));
  const field = b.columns.find((c) => !ID_COLS.has(c));
  if (b.kind === 'logos') {
    const [name, how] = b.title.split(/ \((.*)\)$/);
    return [line(name, b.rows.flatMap((r, k) => [...(k ? [SEP()] : []), run(r[b.columns.indexOf(field)], { size: T })])),
      ...(how ? [note(how)] : []), ...(b.note ? [note(b.note)] : [])];
  }
  if (b.kind === 'images') return b.rows.map((r, k) => line(`Image ${k + 1}`, [run(r[b.columns.indexOf(field)], { size: T })]));
  const noun = nounFor(b.title);
  return [heading(b.title, b.note), ...b.rows.map((r, k) => {
    const val = (c) => r[b.columns.indexOf(c)];
    const text = b.columns.filter((c) => !ID_COLS.has(c) && !isLink(c) && !isImage(c) && val(c));
    const parts = text.map((c, i) => run(val(c), { size: T, bold: i === 0 && text.length > 1 && val(c).length <= 60 }));
    return line(`${noun} ${idCol ? val(idCol) : k + 1}`, [
      ...(parts.length ? parts.flatMap((x, i) => (i ? [run(text.length > 2 ? '  ·  ' : ' — ', { size: T, color: MUTED }), x] : [x])) : [run('—', { size: T })]),
      ...b.columns.filter((c) => isLink(c) && val(c)).map((c) => linkRun(val(c))),
      ...b.columns.filter((c) => isImage(c) && val(c)).flatMap((c) => imageRuns(val(c))),
    ]);
  })];
}

function formParas(b) {
  return [...(b.title ? [heading(b.title)] : []), ...b.fields.flatMap((f, k) => {
    const bits = [`Answer: ${f.type}`, `Required: ${f.required}`, ...(f.options.length ? [`Choices: ${f.options.join(' / ')}`] : []), `Placeholder: ${f.placeholder}`];
    return [
      line(`Field ${k + 1}`, [run(f.label, { size: T, bold: true }), run(`   ${bits.join('  ·  ')}`, { size: TS, color: MUTED })]),
      tp([run('Error message: ', { size: TS, bold: true, color: MUTED }), run(f.errors.length ? f.errors.join('  /  ') : 'None', { size: TS, color: MUTED })], { indent: { left: LABEL_W }, before: 10 }),
    ];
  })];
}

function blockParas(b) {
  if (b.kind === 'text') {
    return b.rows.flatMap((r) => [line(r.element, [run(r.text, { size: T }), ...(r.link ? [linkRun(r.link)] : [])]), ...(r.note ? [note(r.note)] : [])]);
  }
  if (b.kind === 'note') return [note(b.text)];
  if (b.kind === 'ref') {
    return [line('Shared element', [link(b.global, `${b.global} ${GLOBAL_NAMES[b.global]}`, T), run(' — reviewed once in Global Elements.', { size: T })]),
      ...(b.note ? [note(b.note)] : [])];
  }
  if (b.kind === 'form') return formParas(b);
  return itemParas(b);
}

// Consecutive notes join the block after them, so a note never stands alone in a row.
function blockRows(blocks) {
  const rows = [];
  let pending = [];
  blocks.forEach((b) => {
    const paras = blockParas(b);
    if (b.kind === 'note') { pending.push(...paras); return; }
    rows.push(blockRow([...pending, ...paras]));
    pending = [];
  });
  if (pending.length) rows.push(blockRow(pending));
  return rows;
}

// The section's title row: number, name and type on the left, approval status on the right.
const sectionRow = (title, type, id) => row([cell([p([
  ...(id ? [new Bookmark({ id: anchorId(id), children: [run(title, { size: 17, bold: true })] })] : [run(title, { size: 17, bold: true })]),
  run(`   ${type}`, { size: TS, color: MUTED }),
  run('\t', { size: TS }), ...boxes(STATUS, 'Pending'),
], { style: 'SectionRow', after: 0, line: 240, keepNext: true, tabStops: [{ type: TabStopType.RIGHT, position: W - 200 }] })],
{ width: W, span: 2, fill: STONE, pad: 45 })]);

// Placeholders listed by what they wait for ("city", "credits"), other flags as written.
const flagItems = (flags) => [...new Set(flags.map((f) => (f.match(/NEEDS COPY: ([^\]]+)\]/) || [])[1] || f))];
const needsInput = (flags) => (flags.length
  ? [fullRow([tp([run('Needs your input: ', { size: TS, bold: true, color: ACCENT }), run(flagItems(flags).join('  ·  '), { size: TS, color: ACCENT })])], 'FFF6E8')]
  : []);

function matrix(groups) {
  const head = row([
    cell([tp([run('Element', { size: TS, bold: true, color: 'FFFFFF' }), run('\tCurrent content (as on the website)', { size: TS, bold: true, color: 'FFFFFF' })],
      { tabStops: [{ type: TabStopType.LEFT, position: LABEL_W }], keepNext: true })], { width: COLS[0], fill: '2B2925' }),
    cell([tp(run('Proposed change / comment', { size: TS, bold: true, color: 'FFFFFF' }), { keepNext: true })], { width: COLS[1], fill: '2B2925' }),
  ], { header: true });
  return table(COLS, [head, ...groups.flat()]);
}

// ---------------------------------------------------------------- styles & frame --------
const styles = {
  default: { document: { run: { font: SANS, size: 17, color: INK } } },
  paragraphStyles: [
    { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
      run: { font: SERIF, size: 30, color: INK }, paragraph: { spacing: { before: 280, after: 100 }, outlineLevel: 0, keepNext: true,
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: ACCENT_LINE, space: 4 } } } },
    { id: 'SectionRow', name: 'Section Row', basedOn: 'Normal', quickFormat: false, run: { font: SANS, size: 17 } },
  ],
};
const numbering = {
  config: [
    { reference: 'bullets', levels: [
      { level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 240 } } } },
      { level: 1, format: LevelFormat.BULLET, text: '–', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 760, hanging: 240 } } } },
      { level: 2, format: LevelFormat.BULLET, text: '·', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1160, hanging: 240 } } } },
    ] },
    { reference: 'steps', levels: [
      { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 280 } } } },
    ] },
  ],
};
const bullet = (children, level = 0, o = {}) => p(children, { numbering: { reference: 'bullets', level }, after: o.after ?? 30 });
const step = (children) => p(children, { numbering: { reference: 'steps', level: 0 }, after: 30 });

const H1 = (text, id, o = {}) => new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: o.pageBreak,
  children: id ? [new Bookmark({ id: anchorId(id), children: [new TextRun(text)] })] : [new TextRun(text)] });

const header = new Header({ children: [new Paragraph({
  tabStops: [{ type: TabStopType.RIGHT, position: W }],
  border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: LINE, space: 4 } },
  children: [run('EDOMOTICS', { size: 14, bold: true, spacing: 40 }), run(`\tWebsite Content Sitemap & Review  ·  ${VERSION}`, { size: 14, color: MUTED })],
})] });
const footer = new Footer({ children: [new Paragraph({
  tabStops: [{ type: TabStopType.RIGHT, position: W }],
  border: { top: { style: BorderStyle.SINGLE, size: 4, color: LINE, space: 4 } },
  children: [
    run(`Website Content Review Document  ·  ${VERSION}`, { size: 14, color: MUTED }),
    new TextRun({ children: ['\tPage ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], font: SANS, size: 14, color: MUTED }),
  ],
})] });

// ---------------------------------------------------------------- 1. cover --------------
const pages = data.pages;
const nSections = sum(pages.map((pg) => pg.sections.length));
const globalsUsedBy = (gid) => pages.filter((pg) => pg.globalsUsed.includes(gid)).map((pg) => pg.name);

const cover = [
  p(run('EDOMOTICS', { size: 18, bold: true, spacing: 80, color: ACCENT }), { before: 200, after: 120 }),
  p(run('Website Content Sitemap & Review', { font: SERIF, size: 52 }), { after: 80, line: 240 }),
  p(run('A page-by-page inventory of the text on the Edomotics website, for review, comment and approval.', { size: 20, color: MUTED }), {
    after: 280, border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: ACCENT_LINE, space: 10 } } }),
  label('Website overview', { before: 0 }),
  kv4([
    ['Project', 'Edomotics website'], ['Client', CLIENT],
    ['Document', 'Website Content Sitemap & Review'], ['Version', VERSION],
    ['Date prepared', PREPARED], ['Review status', 'Pending Client Review'],
    ['Website address', data.site.liveUrl], ['Version reviewed', SITE_DATE ? `As published on ${SITE_DATE}` : 'Current live version'],
    ['Coverage', `${pages.length} pages · ${nSections} page sections · ${data.globals.length} shared elements`],
  ]),
  label('Reviewer (to be completed by the client)', { before: 200 }),
  kv4([['Reviewer name', ''], ['Role', ''], ['Email', ''], ['Phone', ''], ['Date review returned', '']], undefined, 380),
];

// ---------------------------------------------------------------- 2. version history ----
const versionHistory = (() => {
  const w = fit([1000, 1600, 4466, 1600, 0]);
  return [
    H1('Version History', 'version-history'),
    table(w, [
      headRow(['Version', 'Date', 'Description of Changes', 'Updated By', 'Review Status'], w),
      row([cell(VERSION, { width: w[0] }), cell(PREPARED, { width: w[1] }), cell('Initial content inventory prepared for client review', { width: w[2] }), cell('', { width: w[3] }), cell('Pending Client Review', { width: w[4] })]),
    ]),
  ];
})();

// ---------------------------------------------------------------- 3. change log ----------
const changeLog = (() => {
  const w = fit([700, 900, 1000, 1100, 2080, 2080, 1000, 800, 0]);
  return [
    H1('Change Log', 'change-log'),
    p([run('Record every content change made after this version, one row per change (add rows with Tab in the last cell). '),
      run('Versioning: ', { bold: true }), run('V1.0 initial content inventory · V1.1 minor edits (typing errors, small wording changes) · V1.2 changes requested by the client during review · V2.0 major revision (new pages, restructured sections or rewritten copy).')], { after: 100 }),
    table(w, [
      headRow(['Version', 'Date', 'Page', 'Section', 'Original / Previous Content', 'Revised Content', 'Reason', 'Updated By', 'Client Approval Status'], w),
      ...Array.from({ length: 4 }, () => row(w.map((x) => cell('', { width: x })), { height: 420 })),
    ]),
  ];
})();

// ---------------------------------------------------------------- 4. how to review ------
const howTo = [
  H1('How to Review', 'how-to-review'),
  p('Every piece of text on the website is listed page by page, in the order it appears on screen, with image descriptions (read aloud by screen readers) and where each link goes. Text shared by many pages (header, menu, footer, closing call to action, client logos, experience centres) is listed once under Global Elements.', { after: 80 }),
  step([run('Open the file in Google Docs, choose '), run('File › Save as Google Docs', { bold: true }), run(', then switch the mode at the top right from '), run('Editing', { bold: true }), run(' to '), run('Suggesting', { bold: true }), run(' so every change is recorded (in Word: '), run('Review › Track Changes', { bold: true }), run(').')]),
  step([run('Leave the shaded '), run('Current content', { bold: true }), run(' column as it is: it records what was reviewed.')]),
  step([run('Type new wording, questions or instructions in the '), run('Proposed change / comment', { bold: true }), run(' column beside the item; it grows as you type.')]),
  step([run('Tick one box on each section’s title row: '), run('Approved', { bold: true }), run(', '), run('Changes Required', { bold: true }), run(' or '), run('Pending', { bold: true }), run(' (every section starts as Pending). If the boxes cannot be clicked, as in Google Docs, delete the statuses that do not apply.')]),
  step([run('List all requests in the '), run('Consolidated Client Feedback Summary', { bold: true }), run(', complete the '), run('Final Sign-off', { bold: true }), run(', and share the document back (or return the file with your initials and the date in its name).')]),
  p([run('Notes in grey italics say when text appears (for example, only after a button is pressed). '), run('Needs your input', { bold: true, color: ACCENT }), run(' marks placeholders waiting for your content. Agreed wording is applied to the website and recorded in the Change Log as a new version. If Word asks to update fields when opening, choose Yes (this refreshes the contents and page numbers).')], { before: 60, after: 60 }),
];

// ---------------------------------------------------------------- 5. contents ------------
const contents = [
  p(run('Contents', { font: SERIF, size: 30 }), { before: 240, after: 80, keepNext: true, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: ACCENT_LINE, space: 4 } } }),
  new TableOfContents('Contents', { hyperlink: true, headingStyleRange: '1-1' }),
];

// ---------------------------------------------------------------- 6. sitemap -------------
const sitemap = (() => {
  const children = (parent) => pages.filter((pg) => pg.parent === parent);
  const tree = [];
  const walk = (parent, level) => children(parent).forEach((pg) => {
    tree.push(bullet([link(`page-${pg.id}`, pg.name), run(`   ${pg.route}`, { color: MUTED }), run(`   ·   ${pg.sections.length} sections`, { color: MUTED })], level));
    walk(pg.route, level + 1);
  });
  walk(null, 0);
  // Placeholders, grouped by page and section.
  const needs = [];
  pages.forEach((pg) => {
    const bits = pg.sections.filter((s) => s.flags.length).map((s) => {
      return `${s.name} (${flagItems(s.flags).join(', ')})`;
    });
    if (bits.length) needs.push(bullet([run(`${pg.name}: `, { bold: true }), run(bits.join('; '))]));
  });
  return [
    H1('Hierarchical Sitemap', 'sitemap'),
    p(`${pages.length} pages, all published at ${data.site.liveUrl}`, { after: 60 }),
    ...tree,
    bullet([run('Shared by the pages: '), ...data.globals.flatMap((g, i) => [link(g.id, `${g.id} ${g.name}`), run(i < data.globals.length - 1 ? ', ' : '')])], 0, { after: 80 }),
    label('Not included'),
    bullet('No legal pages, custom “page not found” page or separate thank-you page exist; enquiry messages appear on the Contact page and are listed there.'),
    ...(data.hiddenProjects.length ? [bullet(`${data.hiddenProjects.join(', ')} is in the website’s project list but switched off (not visible), so it is not reviewed.`)] : []),
    bullet('Other websites that pages link to (support portal, social media, press, maps) are not part of this review.'),
    label('Needs your input'),
    ...needs,
    bullet([run('Contact: ', { bold: true }), run('the enquiry form is not yet connected to an inbox, so visitors see the “not connected” message. Needs verification: where should enquiries be delivered?')]),
  ];
})();

// ---------------------------------------------------------------- 7. globals -------------
const globalsPart = [
  H1('Global Elements', 'globals'),
  p('Shared by several pages: review once here, and a change applies everywhere the element appears.', { after: 80 }),
  matrix(data.globals.map((g) => [
    sectionRow(`${g.id} · ${g.name}`, `${g.type}  ·  ${g.id === 'G1' || g.id === 'G2' ? 'every page' : globalsUsedBy(g.id).join(', ')}`, g.id),
    ...blockRows(g.blocks),
  ])),
];

// ---------------------------------------------------------------- 8. pages ---------------
const pagesPart = pages.flatMap((pg, i) => {
  // Search and sharing text; a sharing text identical to its browser counterpart is shown once, with both labels.
  const m = pg.meta;
  const meta = [
    ...(m.ogTitle === m.title ? [['Tab & sharing title', m.title]] : [['Browser tab title', m.title], ['Sharing title', m.ogTitle]]),
    ...(m.ogDescription === m.description ? [['Search & sharing text', m.description]] : [['Search description', m.description], ['Sharing description', m.ogDescription]]),
  ].filter(([, t]) => t);
  const info = (k, v) => [run(`${k}  `, { size: TS, bold: true, color: ACCENT }), run(v, { size: TS })];
  return [
    H1(`Page ${i + 1} · ${pg.name}`, `page-${pg.id}`),
    p([...info('ADDRESS', pg.url), run('     '), ...info('STATUS', 'Pending'), run('     '), ...info('VERSION', VERSION), run('     '),
      ...info('SHARED ELEMENTS', pg.globalsUsed.map((g) => `${g} ${GLOBAL_NAMES[g]}`).join(', '))], { after: 20, keepNext: true }),
    p(info('PURPOSE', pg.purpose), { after: 100 }),
    matrix([
      [fullRow([tp([run('Search and sharing text', { size: 17, bold: true }), run('   browser tab, search results, link previews', { size: TS, color: MUTED })], { keepNext: true })], STONE),
        blockRow(meta.map(([k, t]) => line(k, [run(t, { size: T })])))],
      ...pg.sections.map((s) => [
        sectionRow(`${s.num}. ${s.name}`, s.type),
        ...blockRows(s.blocks),
        ...needsInput(s.flags),
      ]),
    ]),
  ];
});

// ---------------------------------------------------------------- 9. feedback & sign-off -
const feedback = (() => {
  const w = fit([1300, 1400, 1300, 800, 2960, 1800, 0]);
  return [
    H1('Consolidated Client Feedback Summary', 'feedback'),
    p('Every requested change in one place. Priority: High, Medium or Low. Nature of change: wording, new content, removal, correction or image description.', { after: 80 }),
    table(w, [
      headRow(['Page', 'Section', 'Nature of change', 'Priority', 'Client’s proposed content', 'Additional instructions', 'Approval status'], w),
      ...Array.from({ length: 6 }, () => row(w.map((x) => cell('', { width: x })), { height: 420 })),
    ]),
  ];
})();

const writeBox = (title, height, hint) => table([W], [row([cell([
  tp(run(title.toUpperCase(), { size: 14, bold: true, color: ACCENT, spacing: 20 })),
  ...(hint ? [tp(run(hint, { size: TS, italics: true, color: MUTED }), { before: 20 })] : []),
], { width: W })], { height })], { borders: WRITE_BORDERS });

const signOff = [
  H1('Final Sign-off', 'sign-off'),
  p([run('Overall review status:   ', { bold: true }), ...boxes(['Approved in full', 'Approved with changes', 'Revisions required'], null, 17), run('Current status: Pending', { color: MUTED })], { after: 100 }),
  writeBox('Outstanding changes', 800, 'Anything that must be completed before the content can be approved in full.'),
  spacer(80),
  writeBox('Final comments', 600),
  spacer(80),
  kv4([['Reviewer name', ''], ['Role', ''], ['Signature', ''], ['Date', '']], undefined, 420),
  p(`By signing above, I confirm that I have reviewed the website content set out in this document on behalf of ${CLIENT}, and that the approval decisions recorded in it reflect the client’s instructions.`, { before: 100, after: 0 }),
];

// ---------------------------------------------------------------- assemble ---------------
const doc = new Document({
  creator: 'Edomotics website team',
  title: 'Website Content Sitemap & Review',
  subject: `Edomotics website content review ${VERSION}`,
  description: 'Page-by-page inventory of the Edomotics website text for client review and approval.',
  styles,
  numbering,
  features: { updateFields: true },
  sections: [{
    properties: { page: { size: A4, margin: MARGIN } },
    headers: { default: header },
    footers: { default: footer },
    children: [...cover, ...versionHistory, ...changeLog, ...howTo, ...contents, ...sitemap, ...globalsPart, ...pagesPart, ...feedback, ...signOff],
  }],
});

const buf = await Packer.toBuffer(doc);
fs.writeFileSync(OUT, buf);
console.log('written', path.relative(process.cwd(), OUT), `${Math.round(buf.length / 1024)} KB`);
