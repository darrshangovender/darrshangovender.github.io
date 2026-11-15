# darrshangovender.github.io

Personal site of [Darrshan Govender](https://github.com/darrshangovender), industrial AI engineer and founder of [Agulhas Code](https://agulhascode.co.za), Durban, South Africa.

Industrial AI engineer and founder of Agulhas Code in Durban, South Africa: predictive maintenance, cited procedure assistants and human-supervised agents for heavy industry, each published with how it was tested and where it falls short.

A static site: plain HTML, one inlined stylesheet, two small scripts and a lazily loaded pair of demos. No framework, no npm, no trackers, no cookies and no third-party requests. The fonts (Instrument Serif, Instrument Sans, IBM Plex Mono, all SIL OFL, Latin subsets) are served from `assets/fonts/`. It works from GitHub Pages and from `file://`; opened straight from disk, Chrome blocks web-font loads, so the page falls back to the system fonts in the same stacks (layout and behaviour are unchanged, and the console reports the blocked font requests).

## What is on the pages

| Page | What it is |
|---|---|
| `/` | Hero with the one-line bio and a drawing of the maintenance loop; four headline results; the three flagship systems (asset-health, plant-copilot, maintenance-agent) each with an architecture drawing, a key result and what it cannot show; two replays driven by the repositories' own output; the LLM-infrastructure repositories with the mcp-gateway request path; how I work; contact. |
| `/about/` | A plain, quotable page: who, where, what, and how Agulhas Code relates to the repositories. |
| `/llms.txt` | A factual summary and link list for AI crawlers. |
| `404.html` | Not-found page (`noindex`). |

Machine-readable identity is one JSON-LD graph per page: a `Person` with a stable `@id` (`https://darrshangovender.github.io/#person`), the `Organization` Agulhas Code, and the public flagship repositories as `SoftwareSourceCode`, each pointing back to the person as author. The email address is shown as a visible contact link and is not in the JSON-LD.

All demo data is **synthetic** and labelled so.

## Closed-loop block (off until the repositories are public)

`closed-loop` and `closed-loop-v2` are not public yet, so their section, nav link, JSON-LD nodes and `llms.txt` lines are switched off. In `index.html` the section sits inside a clearly marked HTML comment (`OFF-OPEN:closed-loop` ... `OFF-CLOSE:closed-loop`). Switching it on is a rebuild with the generator's `--closed-loop` flag, which uncomments the section and adds the nodes and lines in one step. The generator is a development tool kept beside the draft, not in this repository.

## Run it locally

Nothing to install.

```bash
# open index.html directly (file:// works), or serve the folder:
python -m http.server 8000      # Windows: py -m http.server 8000
```

`404.html` and the `/about/` page use paths that assume the site root, so test the 404 over HTTP.

## Layout

```
index.html              the home page (inline CSS and boot script, hashed in the CSP meta; inline SVG drawings; JSON-LD)
about/index.html        the about page
404.html                not found
llms.txt, robots.txt, sitemap.xml
assets/css/demos.css    styles for the two replays, fetched when the Replays section nears the viewport
assets/js/app.js        theme toggle, phone nav, lazy loader for the replays
assets/js/pf.js         tiny DOM helpers shared by the replays
assets/js/replay.js     asset-health replay
assets/js/agent.js      maintenance-agent walk-through
assets/fonts/           woff2 subsets and LICENCES.txt
assets/img/             favicon.svg, PNG icons, og.png (1200x630)
data/*.json, data/*.js  exported excerpts (the .js copy is the same payload for file://)
tools/                  exporters for the demo data; tools/src holds the stylesheet and replay markup the generator inlines
```

The Content-Security-Policy is a meta tag: `default-src 'none'; script-src 'self' <hash of the boot script>; style-src 'self' <hash of the inline stylesheet>; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'`. Nothing sets a `style` attribute; dynamic geometry goes through SVG attributes and the CSSOM.

### Why classic scripts and not ES modules

Chrome blocks module scripts and `fetch()` of local files on `file://`. The demos are small IIFE scripts that share a tiny `window.PF` namespace, and the data ships both as `.json` (for reading) and as a `.js` file that assigns `window.PORTFOLIO_DATA` (for loading).

### Motion, themes and accessibility

Light and dark follow the operating system; the toggle in the header overrides it and remembers the choice in `localStorage` (the page works if storage is blocked). Under `prefers-reduced-motion: reduce` the loop's travelling dot, the replay animation and the approval-gate animation are off, and the replay opens on its final state. Controls are real buttons with a visible focus ring and 44 px touch targets. Below 760 px each drawing is replaced by the same steps as an ordered list, so no small text has to be read off a shrunken diagram.

## Data provenance

Everything in `data/` was generated by running the repositories' own code, offline, with no API keys:

| File | Produced by | From |
|---|---|---|
| `data/asset-health.{json,js}` | `tools/export_asset_health.py` | asset-health: `simulate --seed 42` (16 assets, 270 days), analysed as of 2025-07-28 with `analyse_source`, the same snapshot as the committed `docs/example-report.html`. Fused score is the 6 h median of the last 60 days; intervals are the real daily RUL checkpoints; the work order is the real drafted one (template narrative, no LLM). |
| `data/maintenance-agent.{json,js}` | `tools/export_maintenance_agent.py` | maintenance-agent: the orchestrator, rule-based planner, 16-rule verifier, signing gate and mock CMMS on synthetic alert `ALR-1004`, fixed clock. The clean run is approved and released; the unsafe run is the same draft after a signed edit removes isolation step 5.7. Timestamps are dropped and hashes shortened to 8 hex characters; the hash chain was checked intact before export. |

The architecture drawings are redrawn from the diagrams and step lists in each repository's README. Every number in the copy appears in a repository README or the previous version of this site; `SOURCES.md` in the draft folder lists each one with its file and line.

## Checks run on 15 Nov 2026 (draft)

Lighthouse 13 against a local server that gzips like GitHub Pages: mobile (simulated slow 4G, 4x CPU) performance 93, accessibility 100, best practices 100, SEO 100; desktop 100 / 100 / 100 / 100. Layout shift 0. Page transfer about 97 KiB including fonts, with the demos fetched only when scrolled to. `html-validate` clean, `lychee --offline` no broken internal links, `typos` clean on the HTML, no console errors or CSP violations over HTTP at desktop and phone widths in both themes, no horizontal overflow from 320 to 1440 px. Re-measure after deploying, since GitHub Pages' own headers and network differ.

## Licence

MIT, see [LICENSE](LICENSE). The projects described remain under their own licences in their own repositories. Fonts are under the SIL Open Font License, see `assets/fonts/LICENCES.txt`.
