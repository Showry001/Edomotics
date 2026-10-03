# Edomotics

The website of Edomotics, a leading home automation system integrator in Hyderabad.

A multi-page site with animated page transitions, built with Vite, GSAP and Lenis.

## Run

```bash
npm install
npm run dev
```

The dev server runs at http://127.0.0.1:5178. Add `?motion=reduce` to any URL to preview the static, reduced-motion version.

```bash
npm run build
```

The build goes to `dist/`, which is static. Run `npm run preview` to serve the build locally.

To serve the site from a sub-folder (for example GitHub Pages at `/Edomotics/`), build with `BASE_PATH`. Every internal link, image and video path is then prefixed for you:

```bash
BASE_PATH=/Edomotics/ npm run build
```

## Pages

| URL | File |
|---|---|
| `/` | `index.html` |
| `/automation/` | `automation/index.html` |
| `/home-theatre/` | `home-theatre/index.html` |
| `/projects/` | `projects/index.html` |
| `/projects/<slug>/` | `projects/akhil-sanjana-residence/`, `dr-akhil-sunitha-residence/`, `seshu-rajalakshmi-residence/` (generated from `src/content/projects.json`) |
| `/about/` | `about/index.html` |
| `/contact/` | `contact/index.html` |

**To add a page:** create its `index.html`, wrap its content in `<div class="view" data-view data-page="…">`, and add it to `PAGES` in `vite.config.js`.

## Projects

Every project lives in one file: `src/content/projects.json`. The homepage slides, the menu cards, the Projects grid and list, and each project page are all built from it.

**To add a project:**

1. Put its photographs in `_src/projects/<slug>/`. Any `.jpg`, `.png`, `.webp` or `.tif` works; they become `<slug>-01`, `<slug>-02`, … in file-name order, so prefix the files `01-`, `02-` and so on. Masters of about 3000px are plenty; there's no need to keep camera originals here.
2. Run `npm run media` to make the responsive images.
3. Add an entry to `projects.json` with `slug`, `name`, `kind`, `location` and `cover` (for example `"<slug>-01"`). You can also add `lead`, `gallery` and `heroVideo`. Set `"featured": true` to show it on the homepage and in the menu (the first three featured projects are used).
4. Run `npm run projects` to generate `projects/<slug>/index.html`. Leave anything you don't know empty: the page shows it as `[NEEDS COPY]`.

Gallery blocks are `"wide"` (one photo) or `"pair"` (a portrait, then a landscape). They can use any picture name in `src/media-manifest.json`, so a photo already on the site is reused rather than duplicated. `"hidden": true` keeps a project in the data file but off the site.

The Projects grid follows a seven-card rhythm, and its last tile fills whatever space the final row leaves, so it holds together at any count.

## How it fits together

- **Shared parts (`partials/`):** the header, footer, call to action, client logos and experience centres. Pages include them with `<!-- @include name key="value" -->`. Lists of projects use `<!-- @each projects partial="pcard" featured="true" limit="3" -->`, filled from `partials/loop/`.
- **Images:** `<img data-pic="name">` expands at build time into a full responsive image (srcset, width, height) from `src/media-manifest.json`.
- **`src/js/router.js`:** page transitions, history, prefetch, focus and screen-reader announcements.
- **`src/js/pages.js`:** mounts every module found in a page and returns one teardown function.
- **`src/js/chapters.js`:** the One room, one day console (Relax and Night), the cinema frame, project slides, principles and stepped stories.
- **`src/js/interactions.js`:** reveals, the carousel (mouse drag and touch swipe), counters, testimonials, the enquiry form, the footer and the projects index.
- **`src/styles/`:** `main.css` brings in everything and is linked from `partials/head.html`, so pages never paint unstyled. Inside it: `base.css` (tokens, type), `sections*.css` (homepage) and `pages.css` (inner pages and transitions). Don't import CSS from JavaScript: on the dev server that makes the raw HTML flash on reload.

## Media

Source files live in `_src/`, which stays on the working machine and is not part of the repository (it holds camera originals and is large). The generated media in `public/media/` is committed, so the site builds without it. Sources: `_src/projects/` and `_src/photos/` hold 3200px masters of the client photography; the brief and Framer folders hold the rest. Run this to regenerate everything in `public/media/`:

```bash
npm run media
```

- **Photographs:** every picture is made at up to four widths (640, 1280, 1920 and 2400px, never upscaled) in AVIF and WebP. `<img data-pic>` becomes a `<picture>`: browsers that read AVIF (about a third smaller) use it, and the rest fall back to WebP. Everything below the first screen loads lazily. Unchanged files are skipped on later runs, and files nothing uses are removed.
- **Hero film:** encoded twice, `hero.mp4` (1280px) for larger screens and `hero-sm.mp4` (720px) for phones.
- **`_src/videos/one-room.mp4`:** the One room, one day film. It is encoded for scrubbing (a keyframe every 2 frames) at desktop and phone sizes, with a poster and a regraded night frame. The console's Relax key shows the film's opening daylight; Night plays it to the end and settles on the night frame. Nothing is downloaded until the section is about a screen and a half away. Replace this file with clean footage and rerun.
- **`_src/clients/`:** client logos, as transparent PNG or SVG. They are trimmed, sized and saved as lossless WebP in `public/media/clients/`; the list itself is in `partials/clients.html`. Each logo there carries `--s` (1 ÷ √aspect ratio) so wide and compact marks look the same size.
- **`_src/videos/cinema.mp4`** (optional): if present, it is encoded the same way for the homepage cinema chapter.

## Hosting

**GitHub Pages:** every push to `main` builds and publishes the site through `.github/workflows/deploy.yml`, at `https://showry001.github.io/Edomotics/`. In the repository's *Settings → Pages*, set *Source* to *GitHub Actions* (once).

**Other hosts:** `public/_headers` sets long cache lifetimes on Netlify and Cloudflare Pages: a year for `/assets/` (file names carry a content hash) and 30 days for `/media/`. On other hosts, set the same rules there and turn on gzip or Brotli for HTML, CSS and JS.

## Before launch

- **Enquiry form:** on `contact/index.html`, set `data-endpoint="https://…"` on `<form data-form>`. It must be a URL that accepts a JSON POST and returns 2xx, such as Formspree, a serverless function, or a CRM or Freshdesk webhook. The form sends `name`, `email`, `phone`, `interest` (an array), `centre`, `stage`, `message` and `page`. Until it is set, nothing is sent: visitors are told so and offered a pre-filled email instead.
- **Placeholders:** search the HTML for `[NEEDS COPY` to find every gap left for the client.
