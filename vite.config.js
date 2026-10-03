import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();

// Where the site is served from. "/" locally; GitHub Pages serves the repository at
// /<repo>/, so the deploy workflow builds with BASE_PATH=/Edomotics/.
const BASE = (() => {
  const b = process.env.BASE_PATH || '/';
  return `/${b.replace(/^\/+|\/+$/g, '')}/`.replace(/^\/\/$/, '/');
})();
// Hidden projects stay in the data file but are left out of every page, list and build.
const readProjects = () => JSON.parse(readFileSync(resolve(root, 'src/content/projects.json'), 'utf8')).projects.filter((p) => !p.hidden);

// Every page of the site. Clean URLs: /automation/ is served from automation/index.html.
// Project pages are registered from src/content/projects.json (generate them with `npm run projects`).
const PAGES = {
  home: 'index.html',
  automation: 'automation/index.html',
  theatre: 'home-theatre/index.html',
  projects: 'projects/index.html',
  about: 'about/index.html',
  contact: 'contact/index.html',
  ...Object.fromEntries(readProjects().map((p) => [`project-${p.slug}`, `projects/${p.slug}/index.html`])),
};

const pad = (n) => String(n).padStart(2, '0');

// Derived fields every project partial can use, so templates stay logic-free.
function projectFields(p, i, list) {
  return {
    ...p,
    n: pad(i + 1),
    total: pad(list.length),
    url: `/projects/${p.slug}/`,
    meta: [p.location, p.kind].filter(Boolean).join(' · '),
    // The Projects grid's real card widths (see .pgrid in pages.css): wide cards in a seven-card
    // rhythm on desktop, every third card full width on tablets, one column on phones.
    cardSizes: `(min-width: 1081px) ${i % 7 === 0 || i % 7 === 6 ? '62vw' : '31vw'}, (min-width: 641px) ${i % 3 === 0 ? '100vw' : '50vw'}, 100vw`,
  };
}

// Shared markup, written once:
//   <!-- @include name key="value" -->            partials/name.html, with {{key}} filled in
//   <!-- @each projects partial="name" limit="3" featured="true" -->
//                                                 partials/loop/name.html once per project
function partials() {
  const fill = (body, data) => body.replace(/\{\{([\w.-]+)\}\}/g, (_, k) => {
    const v = k.split('.').reduce((o, key) => (o == null ? o : o[key]), data);
    return v == null || typeof v === 'object' ? '' : String(v);
  });
  const expand = (html, depth = 0) => {
    if (depth > 5) throw new Error('Partials nested too deeply');
    html = html.replace(/<!--\s*@each\s+projects((?:\s+[\w-]+="[^"]*")*)\s*-->/g, (_, attrs) => {
      const a = Object.fromEntries([...attrs.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
      let list = readProjects();
      if (a.featured === 'true') list = list.filter((p) => p.featured);
      if (a.limit) list = list.slice(0, +a.limit);
      const body = readFileSync(resolve(root, 'partials/loop', `${a.partial}.html`), 'utf8');
      return expand(list.map((p, i) => fill(body, projectFields(p, i, list))).join('\n'), depth + 1);
    });
    return html.replace(/<!--\s*@include\s+([\w-]+)((?:\s+[\w-]+="[^"]*")*)\s*-->/g, (_, name, attrs) => {
      const data = Object.fromEntries([...attrs.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
      return expand(fill(readFileSync(resolve(root, 'partials', `${name}.html`), 'utf8'), data), depth + 1);
    });
  };
  return {
    name: 'partials',
    transformIndexHtml: { order: 'pre', handler: (html) => expand(html) },
    handleHotUpdate({ file, server }) {
      if (file.includes('/partials/') || file.endsWith('projects.json')) server.ws.send({ type: 'full-reload' });
    },
  };
}

// <img data-pic="name" sizes="…" alt="…"> → src, srcset, width and height from the media
// manifest written by scripts/media.mjs (so nothing shifts while images load).
function responsivePictures() {
  return {
    name: 'responsive-pictures',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const manifest = JSON.parse(readFileSync(resolve(root, 'src/media-manifest.json'), 'utf8'));
        return html.replace(/<img([^>]*?)\sdata-pic="([^"]+)"([^>]*)>/g, (match, before, name, after) => {
          const pic = manifest[name];
          if (!pic) throw new Error(`Unknown picture "${name}" — add it to scripts/media.mjs or _src/projects/`);
          const srcset = pic.widths.map((v) => `/${v.file} ${v.w}w`).join(', ');
          const mid = pic.widths[Math.min(1, pic.widths.length - 1)].file;
          const attrs = `${before}${after}`;
          const loading = /\sloading=/.test(attrs) ? '' : ' loading="lazy"';
          const decoding = /\sdecoding=/.test(attrs) ? '' : ' decoding="async"';
          const img = `<img${before} src="/${mid}" srcset="${srcset}" width="${pic.width}" height="${pic.height}"${loading}${decoding}${after}>`;
          if (!pic.avif) return img;
          // AVIF first (about a third smaller); the <img> keeps WebP for anything that can't decode it.
          const sizes = (attrs.match(/\ssizes="([^"]*)"/) || [])[1];
          const avif = srcset.replace(/\.webp /g, '.avif ');
          return `<picture><source type="image/avif" srcset="${avif}"${sizes ? ` sizes="${sizes}"` : ''}>${img}</picture>`;
        });
      },
    },
  };
}

// The markup links pages and media root-absolutely (/projects/…, /media/…). When the site
// lives in a sub-folder, prefix every such URL in the finished HTML. Runs after Vite's own
// rewriting, so anything Vite has already based is left alone.
function basePaths() {
  if (BASE === '/') return { name: 'base-paths' };
  const based = (url) => (url.startsWith('/') && !url.startsWith('//') && !url.startsWith(BASE) ? BASE + url.slice(1) : url);
  return {
    name: 'base-paths',
    transformIndexHtml: {
      order: 'post',
      handler: (html) => html
        .replace(/\s(href|src|poster|content|data-preview)="([^"]*)"/g, (m, attr, url) => ` ${attr}="${based(url)}"`)
        .replace(/\ssrcset="([^"]*)"/g, (m, set) => ` srcset="${set.split(',').map((part) => {
          const [url, ...rest] = part.trim().split(/\s+/);
          return [based(url), ...rest].join(' ');
        }).join(', ')}"`),
    },
  };
}

export default defineConfig({
  base: BASE,
  appType: 'mpa',
  plugins: [partials(), responsivePictures(), basePaths()],
  server: { port: 5178, host: '127.0.0.1' },
  preview: { port: 5179, host: '127.0.0.1' },
  build: {
    target: 'es2020',
    assetsInlineLimit: 2048,
    rollupOptions: { input: Object.fromEntries(Object.entries(PAGES).map(([k, v]) => [k, resolve(root, v)])) },
  },
});
