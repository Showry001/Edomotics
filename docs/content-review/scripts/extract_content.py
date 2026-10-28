#!/usr/bin/env python3
"""Build a structured inventory of every piece of visible text on the Edomotics website.

Reads the *built* site (shared header, footer and other parts already expanded, so the text
is exactly what visitors receive) and the site's scripts for text that only appears when a
visitor interacts (form messages, hover labels). Nothing is retyped by hand.

Usage:
  python3 extract_content.py <built-site-dir> <out.json> [--base /Edomotics]
"""
import datetime
import json
import pathlib
import re
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from htmltree import parse  # noqa: E402

PROJECT = pathlib.Path(__file__).resolve().parents[3]
LIVE = 'https://showry001.github.io/Edomotics'

# ---------------------------------------------------------------- pages -----------------
# Route, display name, parent and a one-line purpose (a summary for reviewers, not site copy).
PAGES = [
    ('/', 'Home', None, 'Introduces Edomotics and leads visitors to its services, projects, leadership and clients.'),
    ('/automation/', 'Home Automation', '/', 'Explains the home automation service: how it works, what it controls, scenes and technology partners.'),
    ('/home-theatre/', 'Home Theatre', '/', 'Explains the home theatre and media room service.'),
    ('/projects/', 'Projects', '/', 'Lists the featured projects, in a grid view and a list view.'),
    ('/about/', 'About', '/', 'Company story, numbers, principles, leadership, teams, experience centres and clients.'),
    ('/contact/', 'Contact', '/', 'Enquiry form and direct contact details.'),
]


def project_pages():
    data = json.loads((PROJECT / 'src/content/projects.json').read_text())
    return [p for p in data['projects'] if not p.get('hidden')], [p for p in data['projects'] if p.get('hidden')]


# ---------------------------------------------------------------- text helpers ----------
SKIP_CLASSES = {
    'visually-hidden', 'ap', 'cue__capsule', 'steps__line', 'steps__count', 'pfield', 'pfield-tip',
    'hero__shade', 'hero__intro-shade', 'room__shade', 'pstage__shade', 'pstage__bar', 'veil', 'tx-shade',
    'dot', 'console__dot', 'key__led', 'key__pulse', 'console__meter', 'approach__num', 'voices__mark',
    'cinema__shade', 'fcard__img', 'carousel-nav',
}
SKIP_TAGS = {'svg', 'script', 'style', 'template', 'video', 'source', 'use', 'symbol', 'path', 'input', 'textarea', 'select'}
TEXT_BLOCKS = {'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'blockquote', 'li', 'figcaption', 'label', 'legend', 'dt', 'dd', 'button'}
BLOCKISH = TEXT_BLOCKS | {'div', 'section', 'ul', 'ol', 'dl', 'figure', 'article', 'nav', 'header', 'footer', 'form', 'fieldset', 'img', 'picture', 'main', 'aside'}


def norm(s):
    return re.sub(r'\s+', ' ', (s or '').replace('\xa0', ' ')).strip()


def skipped(n):
    return n.tag in SKIP_TAGS or bool(SKIP_CLASSES.intersection(n.classes))


def text_of(n):
    if n is None:
        return ''
    out = []

    def rec(x):
        for c in x.children:
            if c.tag == '#text':
                out.append(c.text)
            elif c.tag == 'br':
                out.append(' ')
            elif c.tag == 'i' and 'pcard__dot' in c.classes:
                out.append(' · ')
            elif not skipped(c):
                rec(c)
    rec(n)
    return norm(''.join(out))


def has_block_desc(n):
    return any(d.tag in BLOCKISH for d in n.iter() if d.tag != '#text' and not skipped(d))


# ---------------------------------------------------------------- destinations ----------
class Dest:
    def __init__(self, base):
        self.base = base.rstrip('/')
        self.names = {r: name for r, name, _, _ in PAGES}
        self.anchors = {}  # (route, id) -> section name

    def add_project(self, route, name):
        self.names[route] = name

    def route_name(self, route):
        return self.names.get(route, route)

    def __call__(self, href, page_route):
        if not href:
            return ''
        if href.startswith('tel:'):
            return 'Phone call: ' + href[4:]
        if href.startswith('mailto:'):
            return 'Email: ' + href[7:].split('?')[0]
        if href.startswith('http'):
            return 'External: ' + href
        if self.base and href.startswith(self.base + '/'):
            href = href[len(self.base):]
        path, _, frag = href.partition('#')
        route = path or page_route
        page = 'This page' if route == page_route else f'{self.route_name(route)} page'
        if not frag:
            return page
        if frag in ('top',):
            return f'{page}, back to the top'
        section = self.anchors.get((route, frag))
        return f'{page}, {section} section' if section else f'{page} (#{frag})'


# ---------------------------------------------------------------- roles ----------------
def role_of(n):
    t, cls = n.tag, n.classes
    if t == 'h1':
        return 'Page headline'
    if t == 'h2':
        return 'Section headline'
    if t in ('h3', 'h4', 'h5', 'h6'):
        return 'Heading'
    if t == 'blockquote':
        return 'Quote'
    if t in ('a',):
        return 'Link / button'
    if t == 'button':
        return 'Button'
    if t == 'li':
        return 'List item'
    if t == 'figcaption':
        return 'Caption'
    if t in ('label', 'legend'):
        return 'Form label'
    if t == 'dt':
        return 'Label'
    if t == 'dd':
        return 'Value'
    if t == 'p':
        if any(c == 'count' or c.endswith('__label') or c in ('steps__hint',) for c in cls):
            return 'Label'
        if 't-lead' in cls or any(c.endswith(('__lead', '__lede')) for c in cls):
            return 'Lead paragraph'
        if 'say__by' in cls:
            return 'Attribution'
        if any(c in cls for c in ('t-l', 't-xl', 't-m')):
            return 'Statement'
        return 'Body text'
    return 'Supporting text'


# ---------------------------------------------------------------- section walker --------
class Section:
    def __init__(self, ctx):
        self.ctx = ctx
        self.blocks = []
        self.images = []
        self.flags = []

    def text(self, role, text, link=None, note=None):
        if not text:
            return
        if not self.blocks or self.blocks[-1]['kind'] != 'text':
            self.blocks.append({'kind': 'text', 'rows': []})
        self.blocks[-1]['rows'].append({'element': role, 'text': text, 'link': link, 'note': note})
        if '[NEEDS COPY' in text:
            self.flags.append(f'Placeholder text awaiting client content: “{text}”')

    def table(self, kind, title, columns, rows, note=None):
        if rows:
            self.blocks.append({'kind': kind, 'title': title, 'columns': columns, 'rows': rows, 'note': note})
            for r in rows:
                for cell in r:
                    if isinstance(cell, str) and '[NEEDS COPY' in cell:
                        self.flags.append(f'Placeholder text awaiting client content: “{cell}”')

    def ref(self, gid, note=None):
        self.blocks.append({'kind': 'ref', 'global': gid, 'note': note})

    def note(self, text):
        self.blocks.append({'kind': 'note', 'text': text})

    def image(self, n):
        alt = norm(n.attrs.get('alt'))
        if alt:
            self.images.append(alt)


def inline_links(n, ctx):
    return [{'label': text_of(a), 'dest': ctx.dest(a.attrs.get('href'), ctx.route)} for a in n.find_all(lambda x: x.tag == 'a')]


def emit_text_block(n, sec, ctx):
    links = inline_links(n, ctx)
    text = text_of(n)
    link = None
    if n.tag in ('a',):
        link = ctx.dest(n.attrs.get('href'), ctx.route)
    elif links:
        link = '; '.join(f'“{l["label"]}” → {l["dest"]}' for l in links)
    sec.text(role_of(n), text, link)


def first(n, pred):
    return n.find(pred) if n is not None else None


def cls(name):
    return lambda x: name in x.classes


def walk(node, sec, ctx):
    kids = node.elements() if node.tag != '#text' else []
    i = 0
    while i < len(kids):
        n = kids[i]
        i += 1
        if skipped(n) and not (n.tag == 'span' and 'pstage__cursor' in n.classes):
            continue
        h = HANDLERS.get(handler_key(n))
        if h:
            consumed = h(n, sec, ctx, kids[i:])
            i += consumed or 0
            continue
        if n.tag == 'img':
            sec.image(n)
        elif n.tag == 'a' and not has_block_desc(n):
            emit_text_block(n, sec, ctx)
        elif n.tag in TEXT_BLOCKS and not has_block_desc(n):
            emit_text_block(n, sec, ctx)
        elif n.tag == 'span' and re.search(r'\w', text_of(n)) and not has_block_desc(n):
            sec.text('Supporting text', text_of(n))
        else:
            walk(n, sec, ctx)


def handler_key(n):
    for k in n.classes:
        if k in CLASS_HANDLERS:
            return k
    if n.tag == 'form':
        return 'form'
    if n.tag == 'dl' and 'contact-meta' in n.classes:
        return 'contact-meta'
    return None


# ---- component handlers (each returns how many following siblings it consumed) ----------
def h_scards(n, sec, ctx, _):
    rows = []
    for k, li in enumerate([c for c in n.elements() if 'scard' in c.classes], 1):
        img = first(li, lambda x: x.tag == 'img')
        rows.append([str(k), text_of(first(li, cls('scard__name'))), text_of(first(li, cls('scard__line'))), norm(img.attrs.get('alt')) if img else ''])
    if rows:
        sec.table('cards', 'Cards (scroll sideways)', ['#', 'Title', 'Description', 'Image description'], rows)
    else:
        rows = []
        for k, li in enumerate([c for c in n.elements() if 'fcard' in c.classes], 1):
            img = first(li, lambda x: x.tag == 'img')
            rows.append([str(k), text_of(first(li, cls('fcard__role'))), text_of(first(li, cls('fcard__name'))),
                         text_of(first(li, cls('fcard__more'))), norm(img.attrs.get('alt')) if img else ''])
        sec.table('cards', 'Leadership cards', ['#', 'Role', 'Name', 'Line shown on hover', 'Image description'], rows,
                  note='On phones and tablets each card shows the portrait beside the name, with the line always visible.')


def h_caps(n, sec, ctx, _):
    rows = [[text_of(first(li, cls('cap__n'))), text_of(first(li, cls('cap__name'))), text_of(first(li, cls('cap__text')))]
            for li in n.elements() if 'cap' in li.classes]
    sec.table('cards', 'Capability rows', ['No.', 'Title', 'Description'], rows)


def h_principles(n, sec, ctx, _):
    rows = [[text_of(first(li, cls('principle__n'))), text_of(first(li, lambda x: x.tag == 'h3')),
             text_of(first(li, lambda x: x.tag == 'p'))] for li in n.elements() if 'principle' in li.classes]
    sec.table('cards', 'Principles', ['No.', 'Title', 'Description'], rows)


def h_steps(n, sec, ctx, _):
    rows = []
    for k, li in enumerate([c for c in n.elements() if 'step' in c.classes], 1):
        rows.append([f'{k:02d}', text_of(first(li, cls('step__title'))), text_of(first(li, cls('step__sub'))),
                     text_of(first(li, cls('step__text')))])
    sec.table('cards', 'Steps (revealed one at a time while scrolling)', ['Step', 'Title', 'Subtitle', 'Text'], rows)


def h_tiles(n, sec, ctx, _):
    rows, k = [], 0
    for li in n.elements():
        img = first(li, lambda x: x.tag == 'img')
        if img is not None:
            k += 1
            rows.append([str(k), norm(img.attrs.get('alt'))])
    sec.table('logos', 'Partner logos', ['#', 'Partner (logo)'], rows)
    for li in n.elements():
        a = first(li, lambda x: x.tag == 'a')
        if a is not None:
            emit_text_block(a, sec, ctx)


def h_clients(n, sec, ctx, _):
    sec.ref('G4')


def h_centres(n, sec, ctx, _):
    sec.ref('G5')


def h_quotes(n, sec, ctx, _):
    label = first(n, cls('count'))
    if label is not None:
        sec.text('Label', text_of(label))
    rows = []
    for k, b in enumerate(n.find_all(lambda x: x.has_class('person')), 1):
        quote = norm(re.sub(r'<[^>]+>', '', b.attrs.get('data-text', '')))
        rows.append([str(k), quote, norm(b.attrs.get('data-name')), norm(b.attrs.get('data-org'))])
    sec.table('testimonials', 'Testimonials (visitors choose a name to read each review)', ['#', 'Quote', 'Name', 'Organisation'], rows,
              note='The first review is shown when the page opens; the others appear when a visitor selects a name.')


def h_press(n, sec, ctx, _):
    rows = []
    for k, li in enumerate(n.elements(), 1):
        a = first(li, lambda x: x.tag == 'a')
        rows.append([str(k), text_of(li), ctx.dest(a.attrs.get('href'), ctx.route) if a is not None else 'No link'])
    sec.table('cards', 'Press mentions', ['#', 'Publication', 'Link'], rows)


def h_team(n, sec, ctx, rest):
    group = [n] + [x for x in rest[:5] if 'team' in x.classes]
    consumed = 0
    for x in rest:
        if 'team' in x.classes:
            consumed += 1
        else:
            break
    group = [n] + rest[:consumed]
    rows = []
    for t in group:
        img = first(t, lambda x: x.tag == 'img')
        card = first(t, cls('team__card'))
        rows.append([text_of(first(card, cls('count'))), text_of(first(card, lambda x: x.tag == 'h3')),
                     text_of([p for p in card.elements() if p.tag == 'p'][-1]), norm(img.attrs.get('alt')) if img else ''])
    sec.table('cards', 'Team panels (photograph with a card)', ['Label', 'Heading', 'Text', 'Image description'], rows)
    return consumed


def h_stats(n, sec, ctx, _):
    rows = [[text_of(first(s, lambda x: x.tag == 'dd')), text_of(first(s, lambda x: x.tag == 'dt'))]
            for s in n.elements() if 'bigstat' in s.classes]
    sec.table('stats', 'Statistics', ['Figure', 'Label'], rows, note='Figures count up from zero when they come into view.')


def h_room_caps(n, sec, ctx, _):
    rows = [[text_of(first(c, lambda x: x.tag == 'h3')), text_of(first(c, lambda x: x.tag == 'p'))]
            for c in n.elements() if 'room__cap' in c.classes]
    sec.table('cards', 'Scene captions (change with the selected button)', ['Scene', 'Caption'], rows,
              note='The Relax caption shows first; the Night caption replaces it when a visitor presses Night.')


def h_console(n, sec, ctx, _):
    label = first(n, cls('console__label'))
    own = norm(''.join(c.text for c in label.children if c.tag == '#text'))
    sec.text('Control panel label', own)
    sec.text('Selected scene indicator', text_of(first(n, cls('console__state'))), note='Changes between the two button names.')
    for key in n.find_all(cls('key')):
        sec.text('Button', text_of(first(key, cls('key__name'))))


def h_leaders(n, sec, ctx, _):
    rows = []
    for k, li in enumerate([c for c in n.elements() if 'leader' in c.classes], 1):
        img = first(li, lambda x: x.tag == 'img')
        rows.append([str(k), text_of(first(li, cls('leader__role'))), text_of(first(li, cls('leader__name'))),
                     norm(img.attrs.get('alt')) if img else ''])
    sec.table('cards', 'Leadership cards', ['#', 'Role', 'Name', 'Image description'], rows)


def h_pcount(n, sec, ctx, _):
    shown = len(ctx.live_projects)
    sec.text('Label', text_of(n).replace(' all ', f' {shown} '),
             note='The number is filled in automatically from the projects listed (the page code holds the word “all” until it loads).')


def h_pinfo(n, sec, ctx, _):
    rows = [[text_of(first(d, lambda x: x.tag == 'dt')), text_of(first(d, lambda x: x.tag == 'dd'))] for d in n.elements()]
    sec.table('cards', 'Project details', ['Detail', 'Value'], rows)


def h_pgrid(n, sec, ctx, _):
    rows = []
    for k, a in enumerate(n.find_all(cls('pcard')), 1):
        img = first(a, lambda x: x.tag == 'img')
        rows.append([str(k), text_of(first(a, cls('pcard__name'))), text_of(first(a, cls('pcard__details'))),
                     f'“{text_of(first(a, cls("pcard__go")))}” → {ctx.dest(a.attrs.get("href"), ctx.route)}',
                     norm(img.attrs.get('alt')) if img else ''])
    sec.table('cards', 'Project cards (grid view)', ['#', 'Project', 'Number and type', 'Link', 'Image description'], rows)
    more = first(n, cls('pgrid__more'))
    if more is not None:
        sec.text('Label', 'Closing card:')
        walk(more, sec, ctx)


def h_plist(n, sec, ctx, _):
    rows = []
    for a in n.find_all(cls('prow')):
        rows.append([text_of(first(a, cls('prow__n'))), text_of(first(a, cls('prow__name'))), text_of(first(a, cls('prow__kind'))),
                     ctx.dest(a.attrs.get('href'), ctx.route)])
    sec.table('cards', 'Project rows (list view; a photograph follows the pointer)', ['No.', 'Project', 'Type', 'Link'], rows)


def h_pslides(n, sec, ctx, _):
    rows = []
    for k, s in enumerate([c for c in n.elements() if 'pslide' in c.classes], 1):
        media = first(s, cls('pslide__media'))
        img = first(s, lambda x: x.tag == 'img')
        rows.append([text_of(first(s, cls('pcap__count'))), text_of(first(s, cls('pcap__name'))), text_of(first(s, cls('pcap__specs'))),
                     text_of(first(s, cls('pcap__lead'))),
                     f'“{text_of(first(s, cls("pcap__link")))}” → {ctx.dest(media.attrs.get("href"), ctx.route)}',
                     norm(img.attrs.get('alt')) if img else ''])
    sec.table('cards', 'Project slides (each fills the screen in turn)', ['Counter', 'Project', 'Type', 'Description', 'Link', 'Image description'], rows,
              note='On desktop a “View project” label follows the pointer over the photograph; phones show the “View project” link. The description is hidden on phones.')
    cursor = first(n, cls('pstage__cursor'))
    if cursor is not None:
        sec.text('Pointer label (desktop)', text_of(cursor))
    return 0


def h_mcards(n, sec, ctx, _):
    rows = [[str(k), text_of(a), ctx.dest(a.attrs.get('href'), ctx.route)] for k, a in enumerate(n.find_all(cls('mcard')), 1)]
    sec.table('cards', 'Recent projects (in the menu)', ['#', 'Project', 'Link'], rows)


def h_nav(n, sec, ctx, _):
    rows = [[str(k), text_of(a), ctx.dest(a.attrs.get('href'), ctx.route)] for k, a in enumerate(n.find_all(lambda x: x.tag == 'a'), 1)]
    sec.table('cards', 'Menu links', ['#', 'Menu label', 'Goes to'], rows)


def h_pnext(n, sec, ctx, _):
    sec.text('Label', text_of(first(n, cls('pnext__label'))))
    sec.text('Heading', text_of(first(n, cls('t-xl'))))
    go = first(n, cls('link-arrow'))
    sec.text('Link / button', text_of(go), ctx.dest(n.attrs.get('href'), ctx.route))
    img = first(n, lambda x: x.tag == 'img')
    if img is not None:
        sec.image(img)


def h_contact_meta(n, sec, ctx, _):
    rows = []
    for d in n.elements():
        dd = first(d, lambda x: x.tag == 'dd')
        links = '; '.join(f'“{text_of(a)}” → {ctx.dest(a.attrs.get("href"), ctx.route)}' for a in dd.find_all(lambda x: x.tag == 'a'))
        rows.append([text_of(first(d, lambda x: x.tag == 'dt')), text_of(dd), links])
    sec.table('cards', 'Further contact details', ['Label', 'Text', 'Links'], rows)


def h_form(n, sec, ctx, _):
    fields = []
    for f in n.elements():
        if 'field' not in f.classes:
            continue
        lab = first(f, lambda x: x.tag in ('label', 'legend'))
        label_text = text_of(lab) if lab is not None else ''
        required = '*' in label_text
        label_text = norm(label_text.replace('*', ''))
        ctrl = first(f, lambda x: x.tag in ('input', 'select', 'textarea'))
        name = ctrl.attrs.get('name') if ctrl is not None else ''
        if ctrl is None:
            kind = ''
        elif ctrl.tag == 'select':
            kind = 'Choice from a list'
        elif ctrl.tag == 'textarea':
            kind = 'Long text'
        elif ctrl.attrs.get('type') == 'checkbox':
            kind = 'Tick one or more'
        else:
            kind = {'email': 'Email address', 'tel': 'Phone number', 'text': 'Text'}.get(ctrl.attrs.get('type', 'text'), 'Text')
        options = [text_of(o) for o in f.find_all(lambda x: x.tag == 'option')] or \
                  [text_of(o) for o in f.find_all(lambda x: x.tag == 'label' and 'chip' in x.classes)]
        placeholder = norm(ctrl.attrs.get('placeholder')) if ctrl is not None else ''
        fields.append({'label': label_text, 'name': name, 'type': kind, 'required': 'Yes' if required else 'No',
                       'options': options, 'placeholder': placeholder or 'None', 'errors': ctx.form_errors.get(name, [])})
    sec.blocks.append({'kind': 'form', 'title': 'Enquiry form fields', 'fields': fields})
    foot = first(n, cls('form__foot'))
    if foot is not None:
        btn = first(foot, lambda x: x.tag == 'button')
        sec.text('Button', text_of(btn), note=f'While sending, the button reads “{ctx.form_states.get("sending", "")}”.')
        sec.text('Supporting text', text_of(first(foot, cls('form__note'))))
    sec.table('messages', 'Messages shown after pressing the button', ['When', 'Message'], ctx.form_messages,
              note='These messages appear only after the visitor presses the button. Online submission is not connected yet, so visitors currently see the “not connected” message.')


CLASS_HANDLERS = {
    'carousel__track': h_scards, 'caps__list': h_caps, 'approach__list': h_principles, 'steps__texts': h_steps,
    'tiles': h_tiles, 'clients': h_clients, 'centres': h_centres, 'voices__grid': h_quotes, 'press__list': h_press,
    'team': h_team, 'bigstats__grid': h_stats, 'room__caps': h_room_caps, 'console': h_console, 'pinfo__meta': h_pinfo,
    'pgrid': h_pgrid, 'plist': h_plist, 'leaders__grid': h_leaders, 'pbar__count': h_pcount, 'mbox__cards': h_mcards, 'mbox__links': h_nav, 'pnext': h_pnext,
}
HANDLERS = dict(CLASS_HANDLERS)
HANDLERS['form'] = h_form
HANDLERS['contact-meta'] = h_contact_meta


# ---------------------------------------------------------------- section naming --------
TYPE_BY_CLASS = [
    ('hero', 'Hero (full-screen film)'), ('phero-people', 'Hero (moving team portraits)'), ('phero', 'Hero'),
    ('projhead', 'Hero'), ('scenes', 'Feature cards (sideways carousel)'), ('statement', 'Statement (figures)'),
    ('room', 'Interactive scene control'), ('approach', 'Principles'), ('cinema-body', 'Introduction'),
    ('cinema', 'Full-screen image with headline'), ('pstage', 'Featured projects (full-screen slides)'),
    ('projects', 'Section heading'), ('about', 'Teams'), ('founders', 'Leadership cards'), ('leadership', 'Leadership'),
    ('brands', 'Partner logos'), ('voices', 'Clients, testimonials and press'), ('cta', 'Call to action'),
    ('steps', 'Step-by-step story'), ('caps', 'Capabilities list'), ('bigstats', 'Statistics'),
    ('pindex', 'Project index (grid and list views)'), ('enquiry', 'Enquiry form'),
]
TYPE_BY_LABEL = {
    'Project details': 'Project details', 'Photographs': 'Photo gallery', 'All projects': 'Navigation link',
    'Next project': 'Next project', 'Our story': 'Story', 'Experience centres': 'Experience centres',
    'From our projects': 'Featured project', 'Client testimonial': 'Testimonial', 'Related expertise': 'Related service',
}
NAME_BY_CLASS = {
    'hero': 'Hero', 'cinema': 'Home theatre (full-screen opening)', 'cinema-body': 'Home theatre (introduction)',
    'projects': 'Projects (heading)', 'pstage': 'Featured projects (full-screen slides)', 'cta': 'Call to action',
    'pindex': 'Project index', 'voices': 'Clients, testimonials and press',
}


def section_name_type(sec_node, index):
    cls_tokens = sec_node.classes
    label = first(sec_node, lambda x: x.has_class('count', 'phero__label') and x.tag == 'p')
    label_text = text_of(label) if label is not None else ''
    aria = norm(sec_node.attrs.get('aria-label'))
    ctype = None
    for token, t in TYPE_BY_CLASS:
        if token in cls_tokens:
            ctype = t
            break
    if 'say' in cls_tokens:
        ctype = 'Testimonial' if aria == 'Client testimonial' else 'Statement'
    ctype = ctype or TYPE_BY_LABEL.get(aria) or TYPE_BY_LABEL.get(label_text) or 'Content section'
    if index == 0:
        ctype = ctype if ctype.startswith('Hero') else 'Hero'
    name = next((NAME_BY_CLASS[t] for t in cls_tokens if t in NAME_BY_CLASS), None)
    if index == 0:
        name = 'Hero'
    if name is None:
        name = label_text if (label_text and not re.match(r'^\d', label_text)) else (aria or text_of(first(sec_node, lambda x: x.tag in ('h1', 'h2')))[:60])
    return name.rstrip('.'), ctype


# ---------------------------------------------------------------- scripts ---------------
def js_strings():
    """Form messages and the About hero hover labels, read from the site's scripts."""
    src = (PROJECT / 'src/js/interactions.js').read_text()
    direct = re.search(r"const DIRECT = '([^']*)'", src).group(1)
    direct = norm(re.sub(r'<[^>]+>', '', direct))

    def plain(expr):
        expr = expr.strip()
        if expr[0] in '\'"`':
            expr = expr[1:-1]
        expr = expr.replace('${DIRECT}', direct).replace('${bad.length}', '[number]')
        expr = re.sub(r'<a href="\$\{mailto\(data\)\}">([^<]*)</a>', r'\1', expr)
        return norm(re.sub(r'<[^>]+>', '', expr))

    rules_src = src[src.index('const rules = {'):src.index('const fieldOf')]
    errors = {}
    for m in re.finditer(r'\n\s{6}(\w+): \(\) =>([\s\S]*?)(?=\n\s{6}\w+: \(\) =>|\n\s{4}\};)', rules_src):
        errors[m.group(1)] = [norm(s) for s in re.findall(r"'([A-Z][^']+)'", m.group(2))]

    when = {
        'error': 'A field needs attention',
        'info': None, 'ok': 'The enquiry was sent', 'fail': 'Sending failed',
    }
    messages = []
    for m in re.finditer(r"show\('(\w+)',\s*([\s\S]*?)\);\n", src):
        kind, expr = m.group(1), m.group(2)
        if '?' in expr and ':' in expr and kind == 'error' and 'highlighted' in expr:
            one, many = re.findall(r"('[^']*'|`[^`]*`)", expr)
            messages.append(['One field needs attention', plain(one)])
            messages.append(['Several fields need attention', plain(many)])
            continue
        text = plain(expr)
        if 'aren’t connected' in text:
            w = 'Online submission not yet connected (current behaviour)'
        elif text.startswith('Sending'):
            w = 'While the enquiry is being sent'
        elif kind == 'ok':
            w = 'The enquiry was sent successfully'
        elif kind == 'error':
            w = 'Sending failed'
        else:
            w = when.get(kind) or kind
        messages.append([w, text])
    sending = re.search(r"label\.textContent = on \? '([^']+)' : '([^']+)'", src)
    states = {'sending': sending.group(1), 'idle': sending.group(2)} if sending else {}

    team = (PROJECT / 'src/content/team.js').read_text()
    placeholder = re.search(r"const PLACEHOLDER = \{ name: '([^']*)', role: '([^']*)'", team)
    count = len(re.findall(r'\.\.\.PLACEHOLDER', team))
    return errors, messages, states, {'count': count, 'name': placeholder.group(1), 'role': placeholder.group(2)}


# ---------------------------------------------------------------- page extraction -------
class Ctx:
    pass


def meta_of(root):
    head = root.find(lambda x: x.tag == 'head')

    def m(attr, val):
        el = head.find(lambda x: x.tag == 'meta' and x.attrs.get(attr) == val)
        return norm(el.attrs.get('content')) if el is not None else ''
    title = head.find(lambda x: x.tag == 'title')
    return {'title': text_of(title) if title is not None else '', 'description': m('name', 'description'),
            'ogTitle': m('property', 'og:title'), 'ogDescription': m('property', 'og:description')}


def extract_page(html, route, ctx):
    root = parse(html)
    ctx.route = route
    main = root.find(lambda x: x.tag == 'main')
    sections, globals_used = [], ['G1', 'G2']
    tops = [s for s in main.elements() if s.tag == 'section']
    # anchors first, so in-page links can name their target section
    for k, s in enumerate(tops):
        name, _ = section_name_type(s, k)
        for el in [s] + s.find_all(lambda x: 'id' in x.attrs):
            if el.attrs.get('id'):
                ctx.dest.anchors[(route, el.attrs['id'])] = name
    for k, s in enumerate(tops):
        name, ctype = section_name_type(s, k)
        sec = Section(ctx)
        if 'cta' in s.classes:
            img = first(s, lambda x: x.tag == 'img')
            sec.ref('G3', note=f'Photograph on this page: {norm(img.attrs.get("alt"))}' if img is not None else None)
            globals_used.append('G3')
        elif 'pstage' in s.classes:
            h_pslides(s, sec, ctx, [])
        else:
            if 'hero' in s.classes and s.find(lambda x: x.tag == 'video'):
                sec.note('Background: a looping film of a living room (no text).')
            if 'phero-people' in s.classes:
                tp = ctx.team_placeholder
                sec.note(f'Background: {tp["count"]} floating portrait photographs. These are temporary stock photographs, not Edomotics staff. '
                         f'Hovering a portrait shows a label that currently reads “{tp["name"]}” and “{tp["role"]}”. Needs verification: real team photographs, names and roles are required.')
                sec.flags.append('About hero portraits are temporary stock photographs with placeholder names and roles.')
            walk(s, sec, ctx)
        if sec.images:
            sec.blocks.append({'kind': 'images', 'title': 'Image descriptions (read aloud by screen readers)', 'columns': ['#', 'Image description'], 'rows': [[str(i), a] for i, a in enumerate(sec.images, 1)]})
        for b in sec.blocks:
            if b['kind'] == 'ref' and b['global'] not in globals_used:
                globals_used.append(b['global'])
        sections.append({'num': len(sections) + 1, 'name': name, 'type': ctype, 'blocks': sec.blocks, 'flags': sec.flags})
    return meta_of(root), sections, globals_used, root


def extract_globals(home_root, about_root, contact_root, ctx, cta_alts):
    ctx.route = '(every page)'
    out = []
    # G1 header and menu
    sec = Section(ctx)
    skip = home_root.find(cls('skip'))
    sec.text('Link / button', text_of(skip), 'Main content of the current page', note='Hidden until a keyboard user presses Tab; jumps past the menu.')
    hdr = home_root.find(lambda x: x.tag == 'header')
    logo = hdr.find(lambda x: x.tag == 'img')
    sec.text('Logo', norm(logo.attrs.get('alt')), ctx.dest(first(hdr, cls('mbox__logo')).attrs.get('href'), ctx.route), note='Image description of the logo.')
    cta = first(hdr, cls('hdr__right'))
    sec.text('Link / button', text_of(cta), ctx.dest(first(cta, lambda x: x.tag == 'a').attrs.get('href'), ctx.route),
             note='Top right on larger screens; inside the logo bar on phones.')
    sec.text('Menu button', 'Opens and closes the menu (icon only; read aloud as “Open menu” / “Close menu”).')
    walk(first(hdr, cls('mbox__panel')), sec, ctx)
    out.append({'id': 'G1', 'name': 'Header and menu', 'type': 'Navigation', 'appearsOn': 'Every page', 'blocks': sec.blocks, 'flags': []})
    # G2 footer
    sec = Section(ctx)
    walk(home_root.find(lambda x: x.tag == 'footer'), sec, ctx)
    for b in sec.blocks:
        for r in b.get('rows', []):
            if isinstance(r, dict) and r['text'].startswith('©'):
                r['note'] = 'The year updates automatically each year.'
    out.append({'id': 'G2', 'name': 'Footer', 'type': 'Footer', 'appearsOn': 'Every page', 'blocks': sec.blocks, 'flags': []})
    # G3 call to action
    sec = Section(ctx)
    cta_sec = home_root.find(lambda x: x.tag == 'section' and 'cta' in x.classes)
    h2 = first(cta_sec, lambda x: x.tag == 'h2')
    emit_text_block(h2, sec, ctx)
    sec.table('cards', 'Photograph behind the card, by page', ['Page', 'Image description'], cta_alts)
    out.append({'id': 'G3', 'name': 'Call to action band', 'type': 'Call to action',
                'appearsOn': ', '.join(r[0] for r in cta_alts), 'blocks': sec.blocks, 'flags': []})
    # G4 clients
    sec = Section(ctx)
    cl = home_root.find(cls('clients'))
    head = first(cl, cls('clients__head'))
    walk(head, sec, ctx)
    rows = [[str(k), norm(img.attrs.get('alt'))] for k, img in enumerate(first(cl, cls('clients__wall')).find_all(lambda x: x.tag == 'img'), 1)]
    sec.table('logos', 'Client logos (three columns drifting slowly upwards)', ['#', 'Client (logo)'], rows)
    out.append({'id': 'G4', 'name': 'Commercial clients', 'type': 'Client logos', 'appearsOn': 'Home, About', 'blocks': sec.blocks, 'flags': []})
    # G5 centres
    sec = Section(ctx)
    ul = contact_root.find(cls('centres'))
    rows = []
    for a in ul.find_all(cls('centre')):
        rows.append([text_of(first(a, cls('centre__city'))), text_of(first(a, cls('centre__role'))), text_of(first(a, cls('centre__addr'))),
                     ctx.dest(a.attrs.get('href'), '/contact/').replace('External: https://www.google.com/maps/search/', 'Google Maps search: ').split('?')[0]
                     if 'google' in a.attrs.get('href', '') else ctx.dest(a.attrs.get('href'), '/contact/')])
    sec.table('cards', 'Experience centres', ['City', 'Role', 'Address', 'Link'], [[r[0], r[1], r[2], 'Opens the address in Google Maps'] for r in rows])
    out.append({'id': 'G5', 'name': 'Experience centres', 'type': 'Locations', 'appearsOn': 'About, Contact', 'blocks': sec.blocks, 'flags': []})
    return out


def flat_texts(obj):
    """Every content string in an extracted structure (for verification)."""
    out = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k in ('kind', 'num', 'id', 'element', 'type', 'title', 'columns', 'note', 'link', 'flags', 'global', 'appearsOn', 'name', 'route', 'url', 'parent', 'purpose', 'meta', 'globalsUsed', 'required'):
                if k in ('meta',):
                    out += flat_texts(v)
                continue
            out += flat_texts(v)
    elif isinstance(obj, list):
        for v in obj:
            out += flat_texts(v)
    elif isinstance(obj, str) and obj:
        out.append(obj)
    return out


def main():
    site = pathlib.Path(sys.argv[1])
    out_path = pathlib.Path(sys.argv[2])
    base = sys.argv[sys.argv.index('--base') + 1] if '--base' in sys.argv else ''
    ctx = Ctx()
    ctx.dest = Dest(base)
    ctx.form_errors, ctx.form_messages, ctx.form_states, ctx.team_placeholder = js_strings()
    live, hidden = project_pages()
    ctx.live_projects = live
    for p in live:
        ctx.dest.add_project(f'/projects/{p["slug"]}/', p['name'])

    routes = [(r, n, par, pur) for r, n, par, pur in PAGES]
    for p in live:
        routes.insert(4 + live.index(p), (f'/projects/{p["slug"]}/', p['name'], '/projects/',
                                          f'Presents the {p["name"]}: photographs and project details.'))
    pages, roots, cta_alts = [], {}, []
    for route, name, parent, purpose in routes:
        file = site / (route.strip('/') + '/index.html' if route != '/' else 'index.html')
        meta, sections, used, root = extract_page(file.read_text(encoding='utf-8'), route, ctx)
        roots[route] = root
        for s in sections:
            for b in s['blocks']:
                if b['kind'] == 'ref' and b['global'] == 'G3':
                    cta_alts.append([name, b['note'].replace('Photograph on this page: ', '') if b['note'] else ''])
        pages.append({'id': f'P{len(pages) + 1}', 'name': name, 'route': route, 'url': LIVE + route, 'parent': parent,
                      'purpose': purpose, 'meta': meta, 'globalsUsed': used, 'sections': sections})

    globals_ = extract_globals(roots['/'], roots['/about/'], roots['/contact/'], ctx, cta_alts)

    # Shared parts must be identical wherever they appear; record any difference.
    consistency = []
    def block_text(root, pred):
        n = root.find(pred)
        return text_of(n) if n is not None else None
    for gid, pred, where in [
        ('G3', lambda x: x.tag == 'section' and 'cta' in x.classes and True, ['/', '/automation/', '/home-theatre/', '/projects/', '/about/']),
        ('G4', cls('clients'), ['/', '/about/']),
        ('G5', cls('centres'), ['/about/', '/contact/']),
        ('G2', lambda x: x.tag == 'footer', [r for r, *_ in routes]),
    ]:
        def core(route):
            n = roots[route].find(pred)
            if n is None:
                return None
            h = first(n, lambda x: x.tag == 'h2') if gid == 'G3' else n
            return text_of(h)
        texts = {r: core(r) for r in where}
        same = len(set(t for t in texts.values() if t is not None)) == 1
        consistency.append({'global': gid, 'pages': where, 'identical': same})

    commit = subprocess.run(['git', '-C', str(PROJECT), 'rev-parse', '--short', 'HEAD'], capture_output=True, text=True).stdout.strip()
    data = {
        'site': {'name': 'Edomotics', 'liveUrl': LIVE + '/', 'commit': commit,
                 'extractedAt': datetime.date.today().isoformat(), 'base': base},
        'hiddenProjects': [p['name'] for p in hidden],
        'globals': globals_,
        'pages': pages,
        'consistency': consistency,
    }
    out_path.write_text(json.dumps(data, indent=2, ensure_ascii=False))
    n_sections = sum(len(p['sections']) for p in pages)
    print(f'pages {len(pages)} · sections {n_sections} · globals {len(globals_)} · strings {len(flat_texts(data["pages"])) + len(flat_texts(data["globals"]))}')
    for c in consistency:
        print('shared', c['global'], 'identical' if c['identical'] else 'DIFFERS', c['pages'])


if __name__ == '__main__':
    main()
