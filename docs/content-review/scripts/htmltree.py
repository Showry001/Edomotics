"""Minimal HTML tree builder on the standard library (no third-party packages)."""
from html.parser import HTMLParser

VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'}


class Node:
    __slots__ = ('tag', 'attrs', 'children', 'parent', 'text')

    def __init__(self, tag, attrs=None, parent=None, text=None):
        self.tag, self.attrs, self.children, self.parent, self.text = tag, dict(attrs or {}), [], parent, text

    # --- queries ---------------------------------------------------------
    @property
    def classes(self):
        return (self.attrs.get('class') or '').split()

    def has_class(self, *names):
        cls = self.classes
        return any(n in cls for n in names)

    def iter(self):
        for c in self.children:
            yield c
            if c.tag != '#text':
                yield from c.iter()

    def find_all(self, pred):
        return [n for n in self.iter() if n.tag != '#text' and pred(n)]

    def find(self, pred):
        for n in self.iter():
            if n.tag != '#text' and pred(n):
                return n
        return None

    def elements(self):
        return [c for c in self.children if c.tag != '#text']

    def ancestors(self):
        p = self.parent
        while p is not None:
            yield p
            p = p.parent


class _Builder(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node('#root')
        self.cur = self.root

    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs, self.cur)
        self.cur.children.append(node)
        if tag not in VOID:
            self.cur = node

    def handle_startendtag(self, tag, attrs):
        self.cur.children.append(Node(tag, attrs, self.cur))

    def handle_endtag(self, tag):
        n = self.cur
        while n is not None and n.tag != tag:
            n = n.parent
        if n is not None and n.parent is not None:
            self.cur = n.parent

    def handle_data(self, data):
        self.cur.children.append(Node('#text', parent=self.cur, text=data))


def parse(html):
    b = _Builder()
    b.feed(html)
    return b.root
