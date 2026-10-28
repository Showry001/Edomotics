#!/usr/bin/env python3
"""Checks the review document against the content extracted from the website.

  1. Sitemap: every page of the built site is in the sitemap and has its own review, in order.
  2. Coverage and order: every piece of site text, link destination and note is in the document,
     inside the right page and section, in the same order as on the site.
  3. Shared elements: each is reviewed once, in order, and pages refer to the ones they use.
  4. Status: every section starts as Pending and nothing is pre-approved.
  5. Wording: no implementation terms in the document.

Usage: python3 verify_docx.py <document.docx> <extracted-content.json> [--site <built-site-dir>]
"""
import json
import pathlib
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
W14 = '{http://schemas.microsoft.com/office/word/2010/wordml}'


def norm(s):
    return ' '.join(str(s).replace(' ', ' ').split())


def paragraphs(docx):
    """(style, text, checkboxes) for every paragraph, in document order."""
    root = ET.fromstring(zipfile.ZipFile(docx).read('word/document.xml'))
    out = []
    for p in root.iter(W + 'p'):
        style = p.find(f'{W}pPr/{W}pStyle')
        text = []
        boxes = []
        for el in p.iter():
            if el.tag == W + 't':
                text.append(el.text or '')
            elif el.tag == W + 'tab':
                text.append('\t')
            elif el.tag == W14 + 'checked':
                boxes.append(el.get(W14 + 'val') in ('1', 'true'))
        out.append((style.get(W + 'val') if style is not None else '', norm(''.join(text)), boxes))
    return out


class Segment:
    """A run of the document between two headings, searched front to back."""

    def __init__(self, paras):
        self.text = '\n'.join(t for _, t, _ in paras)
        self.pos = 0

    def expect(self, s, where, errors):
        s = norm(s)
        if not s:
            return
        k = self.text.find(s, self.pos)
        if k >= 0:
            self.pos = k
        elif s in self.text:
            errors.append(f'{where}: out of order: “{s[:80]}”')
        else:
            errors.append(f'{where}: missing: “{s[:80]}”')


def expected(block, names):
    """The strings a block must show, in the order the document shows them."""
    k = block['kind']
    if k == 'text':
        for r in block['rows']:
            yield r['text']
            if r.get('link'):
                yield f"→ {r['link']}"
            if r.get('note'):
                yield r['note']
    elif k == 'note':
        yield block['text']
    elif k == 'ref':
        yield f"{block['global']} {names[block['global']]} — reviewed once in Global Elements."
        if block.get('note'):
            yield block['note']
    elif k == 'form':
        if block.get('title'):
            yield block['title']
        for f in block['fields']:
            yield from (f['label'], f"Answer: {f['type']}", f"Required: {f['required']}", *f['options'], f"Placeholder: {f['placeholder']}", *(f['errors'] or ['None']))
    else:
        if k == 'logos':  # one line named after the block (the bracketed part follows the list)
            yield re.sub(r' \(.*\)$', '', block['title'])
        elif k != 'images':  # image descriptions are numbered lines without a title
            yield block['title']
        if block.get('note') and k != 'logos':
            yield block['note']
        # logo lists show the names only (the numbering is the inventory's, not the site's)
        keep = [i for i, c in enumerate(block['columns']) if not (k == 'logos' and c in ('#', 'No.'))]
        for r in block['rows']:
            yield from (r[i] for i in keep if r[i])


def main():
    docx, data_path = sys.argv[1], sys.argv[2]
    site = pathlib.Path(sys.argv[sys.argv.index('--site') + 1]) if '--site' in sys.argv else None
    data = json.loads(pathlib.Path(data_path).read_text(encoding='utf-8'))
    paras = paragraphs(docx)
    errors, checked = [], 0
    names = {g['id']: g['name'] for g in data['globals']}

    h1 = [i for i, (st, _, _) in enumerate(paras) if st == 'Heading1']
    h1_text = [paras[i][1] for i in h1]

    def part(title):
        """Paragraphs from the H1 `title` up to the next H1."""
        if title not in h1_text:
            errors.append(f'heading missing: {title}')
            return []
        k = h1_text.index(title)
        return paras[h1[k]:h1[k + 1] if k + 1 < len(h1) else len(paras)]

    def split_sections(ps, titles):
        """Section title rows in document order, and each section's paragraphs (keyed by expected title)."""
        idx = [i for i, (st, _, _) in enumerate(ps) if st == 'SectionRow']
        order = [ps[i][1] for i in idx]
        segs = {}
        for t in titles:
            j = next((j for j, o in enumerate(order) if o.startswith(t + ' ')), None)
            if j is not None:
                segs[t] = ps[idx[j]:(idx[j + 1] if j + 1 < len(idx) else len(ps))]
        return order, segs

    # 1. sitemap and page order
    page_titles = [f"Page {i + 1} · {pg['name']}" for i, pg in enumerate(data['pages'])]
    found = [t for t in h1_text if t.startswith('Page ')]
    if found != page_titles:
        errors.append(f'page order: document has {found}, site has {page_titles}')
    sm = Segment(part('Hierarchical Sitemap'))
    for pg in data['pages']:
        sm.pos = 0
        for s in (pg['name'], pg['route']):
            sm.expect(s, f"sitemap / {pg['name']}", errors)
            checked += 1
    if site:
        rel = (f.parent.relative_to(site).as_posix() for f in site.rglob('index.html'))
        built = sorted('/' if r == '.' else f'/{r}/' for r in rel)
        listed = sorted(pg['route'] for pg in data['pages'])
        if built != listed:
            errors.append(f'routes: built site has {built}, document covers {listed}')

    # 2. pages: sections, content and order
    n_sections = 0
    for title, pg in zip(page_titles, data['pages']):
        ps = part(title)
        seg = Segment(ps)
        # page information (one summary line, any order) and search/sharing text (identical texts shown once)
        for s in (pg['name'], pg['url'], pg['purpose'], *(f'{g} {names[g]}' for g in pg['globalsUsed']), *dict.fromkeys(v for v in pg['meta'].values() if v)):
            seg.pos = 0
            seg.expect(s, title, errors)
            checked += 1
        seg.pos = 0
        want = [f"{s['num']}. {s['name']}" for s in pg['sections']]
        order, by_sec = split_sections(ps, want)
        if len(order) != len(want) or any(not o.startswith(w + ' ') for o, w in zip(order, want)):
            errors.append(f'{title}: section order {order} != {want}')
        for s, h in zip(pg['sections'], want):
            n_sections += 1
            sseg = Segment(by_sec.get(h, []))
            sseg.expect(f"{h} {s['type']}", f'{title} / {h}', errors)
            for b in s['blocks']:
                for x in expected(b, names):
                    sseg.expect(x, f'{title} / {h}', errors)
                    checked += 1

    # 3. shared elements
    want = [f"{g['id']} · {g['name']}" for g in data['globals']]
    order, by_sec = split_sections(part('Global Elements'), want)
    if len(order) != len(want) or any(not o.startswith(w + ' ') for o, w in zip(order, want)):
        errors.append(f'global order {order} != {want}')
    for g, h in zip(data['globals'], want):
        gseg = Segment(by_sec.get(h, []))
        for b in g['blocks']:
            for x in expected(b, names):
                gseg.expect(x, h, errors)
                checked += 1

    # 4. approval status: Pending only, one per section and shared element
    rows = [boxes for st, _, boxes in paras if st == 'SectionRow']
    if len(rows) != n_sections + len(data['globals']):
        errors.append(f'{len(rows)} approval-status lines for {n_sections} sections + {len(data["globals"])} shared elements')
    if any(b != [False, False, True] for b in rows):
        errors.append('an approval status is not “Pending” only')
    signoff = [boxes for _, t, boxes in paras if 'Approved in full' in t]
    if not signoff or any(any(b) for b in signoff):
        errors.append('final sign-off status is pre-filled')

    # 5. wording
    full = '\n'.join(t for _, t, _ in paras)
    for term in (r'third\s*way', r'\bcss\b', r'\bhtml\b', r'\bjavascript\b', r'\bdiv\b', r'\bclass=', r'\bdata-', r'\bcomponent', r'\.js\b', r'\bjson\b'):
        for m in re.finditer(term, full, re.I):
            errors.append(f'implementation term in document: “{full[max(0, m.start() - 30):m.end() + 30]}”')

    print(f'checked {checked} content items in {len(data["pages"])} pages, {n_sections} sections and {len(data["globals"])} shared elements')
    if errors:
        print(f'{len(errors)} problem(s):')
        for e in errors:
            print('  -', e)
        sys.exit(1)
    print('OK: all content present, in order; statuses Pending; no implementation terms')


if __name__ == '__main__':
    main()
