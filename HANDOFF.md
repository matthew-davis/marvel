# Handoff / Progress Notes

Written 2026-07-09 to pause mid-build and resume in a later session.
Read this first before doing anything else.

## Goal

Rebuilding this repo (originally a 2018 Python/IMDbPy/MySQL one-off, now
archived to `/legacy`) into: a weekly-refreshed graph of Marvel films and
their cast/crew, stored as flat JSON in git, automated via GitHub Actions,
and shown as a 3D "holographic universe" (3d-force-graph) on GitHub Pages
at `https://matthew-davis.github.io/marvel/`.

## Status at a glance

- Legacy code archived to `/legacy`. Committed.
- Data pipeline (`discover.js`, `enrich.js`, `build-graph.js`) built and
  verified working end-to-end. **Not yet committed.**
- Full backfill of all 149 films: **was still running in the background**
  as of 2026-07-09 08:24 (120 movies done, ~13,365 people cached so far).
  May or may not still be running when you resume - see "Resuming the
  backfill" below.
- Frontend (`site/`) built and verified in a real browser (Playwright +
  screenshots), but only against a small 3-movie/137-person test dataset.
  **Performance test against the full dataset is the one open task.**
- Nothing beyond the very first scaffolding commit has been committed to
  git yet. Everything since - pipeline scripts, the whole `site/`
  frontend, and all fetched `data/movies` + `data/people` files - is
  sitting uncommitted in the working tree. Don't discard any of it.

## Key decisions already made

Don't re-litigate these without a real reason - they were deliberate calls
made earlier in this build, not defaults:

- **Film scope**: full Wikipedia "List of films based on Marvel Comics
  publications" page, trimmed to exclude the "Episodes as films" sections
  (both live-action and animated) and "Lego films" - those are TV episodes
  and children's shorts respectively, low graph value.
- **Graph edges**: bipartite movie<->person only. No direct person-to-person
  edges (would blow up fast on ensemble casts - a 60-credit Avengers cast
  alone would be ~1,770 pairwise edges).
- **Refresh policy**: movies within 18 months of release get their credits
  refetched every run (TMDB credits get corrected/expanded post-release).
  People are fetched once and frozen forever - matches the original target
  spec literally ("fetch person details ONLY for people not already stored
  locally").
- **Pages deploy**: native GitHub Actions deploy
  (`upload-pages-artifact` + `deploy-pages`), no `/docs` folder or
  `gh-pages` branch.
- **Frontend stack**: TypeScript + Vite, no framework (vanilla DOM/three.js
  wiring) - the app is one 3D canvas + a search box + a detail panel, state
  needs are small.
- **Node default appearance**: nodes render as plain colored glow spheres
  by default. Real TMDB portrait/poster textures only load lazily and get
  applied when a node enters focus (selected, or a direct connection of the
  selected node). This was a deliberate perf call for thousands-of-nodes
  scale, not yet validated against real data volume - revisit after the
  performance test if it looks wrong.
- **TMDB auth**: v4 Read Access Token as a `Bearer` header via
  `TMDB_READ_TOKEN` env var locally / GitHub Actions secret in CI. Never
  committed anywhere.
- **GitHub Pages URL**: `https://matthew-davis.github.io/marvel/` (project
  page, since the repo is `matthew-davis/marvel`, not a
  `matthew-davis.github.io` repo). `site/vite.config.ts` sets
  `base: '/marvel/'` to match.

## What's outstanding, in order

1. **Resume/finish the backfill** (see below).
2. **Rebuild the graph**: `node scripts/build-graph.js` once the backfill
   is complete, to compile the full `data/graph.json`.
3. **Check `data/needs-review.json`** - if it exists, some movie titles had
   ambiguous TMDB matches that need a manual decision (none had appeared as
   of this writing, but the backfill wasn't finished either).
4. **Performance-test the frontend** against the real dataset (thousands of
   person nodes, not 137). Only tested against the small sample so far.
   Use the `run` skill (browser-driven pattern) or Playwright directly -
   see "How this session tested the frontend" below for the exact recipe
   that worked in this sandboxed environment (no `chromium-cli` available,
   had to install Playwright + Chromium manually).
5. **Decide on commit structure** and commit everything. Suggest logical
   chunks (pipeline scripts, then frontend, then data) rather than one
   giant commit, but that's a style call, not a correctness one.
6. **Push to GitHub and wire up the live parts** (needs manual action, not
   automatable from here):
   - Add `TMDB_READ_TOKEN` as a repo secret (Settings -> Secrets and
     variables -> Actions)
   - Enable Pages with source = "GitHub Actions" (Settings -> Pages)
   - Manually trigger `weekly-refresh` once via `workflow_dispatch` to
     confirm it runs cleanly in GitHub's CI environment (different from
     local - worth verifying, not assuming)
7. **Confirm the deployed site** actually loads at
   `https://matthew-davis.github.io/marvel/` after the Pages workflow runs.

## Resuming the backfill

As of **2026-07-09 08:24**, `node scripts/enrich.js` (full run, no
`ENRICH_LIMIT`) was running in the background: 120/149 movies done, ~13,365
people cached. Movie-credit fetching had already finished by that point;
it was purely in the tail-end phase of fetching newly-discovered people.

This may or may not still be running by the time you read this - check:

```bash
ps aux | grep enrich.js
ls data/movies | wc -l   # should reach 149 once fully done
ls data/people | wc -l
tail -20 /tmp/claude-1000/-home-matthewdavis-Development-marvel/*/scratchpad/enrich-full.log  # may no longer exist - it was a scratchpad path, not persistent
```

If it's not running anymore, it's **safe to just restart it**:

```bash
TMDB_READ_TOKEN=<your token> node scripts/enrich.js
```

It will skip every movie/person already cached (and only refetch movies
still inside the 18-month release window), so restarting does **not**
redo already-completed work or waste API quota on it.

## Known gotchas hit this session

- **`3d-force-graph` requires `three@>=0.179`**. An initial pin to
  `^0.169` plus a stale nested copy under
  `site/node_modules/3d-force-graph/node_modules/three` caused a runtime
  crash: `object.matrixWorld.determinantAffine is not a function`. Fixed
  by bumping `site/package.json`'s `three` to `^0.179.0` and doing a clean
  `rm -rf node_modules package-lock.json && npm install` inside `site/` so
  npm dedupes to a single copy. If this error resurfaces, check for
  duplicates: `find node_modules -path "*three/package.json"`.
- **`site/public/data/graph.json` is generated, not source** - it's a copy
  of `data/graph.json` made by `site/scripts/sync-data.js`, which runs
  automatically via the `predev`/`prebuild` npm lifecycle hooks in
  `site/package.json`. It's gitignored. Don't hand-edit it; edit
  `data/graph.json` (or rerun `build-graph.js`) and let the sync script
  copy it over.
- **Headless Chromium sometimes throws benign
  `THREE.WebGLProgram: Shader Error` console warnings** under software
  rendering (no real GPU in this sandbox, SwiftShader fallback). Didn't
  affect actual rendering or interaction in testing - screenshots and
  behavior were correct regardless. Likely a headless-environment
  artifact, not a real bug, but worth a sanity check in a real browser
  with real GPU acceleration at some point.
- **No `chromium-cli` in this environment** - had to install Playwright +
  Chromium manually into a scratchpad dir (`npm install playwright` +
  `npx playwright install chromium`, skipping `--with-deps` since there's
  no sudo access). If testing again, check whether that install persisted
  or needs redoing.

## Verified working (screenshots taken this session, not just typechecked)

- `discover.js`: scrapes the live Wikipedia page via the MediaWiki API
  (not raw HTML scraping), correctly found 149 films including
  2025/2026/2027 announced titles (confirms it's live, not stale).
- `enrich.js`: TMDB search-matching + credit fetching + person caching,
  smoke-tested live against 3 real movies before the full backfill.
- `build-graph.js`: compiles the bipartite `graph.json` correctly (140
  nodes / 140 edges from the 3-movie test set).
- Frontend, against the 3-movie test set: 3D rendering with dark nebula
  background, glowing colored spheres, camera fly-to on node click,
  portrait/poster textures correctly applied on focus, cyan pulse
  particles traveling along active edges, unfocused clusters visibly
  desaturating/dimming while staying visible (not disappearing), Fuse.js
  search, and the 2D detail panel populating with real connection lists.

## File map

```
discover.js          scripts/  - Wikipedia -> movies-index.json
enrich.js            scripts/  - TMDB resolution + credits + people cache
build-graph.js        scripts/  - compiles data/graph.json
data/movies-index.json          - {title, year, tmdb_id}[]
data/movies/{tmdb_id}.json       - one file per film, full cast/crew
data/people/{tmdb_id}.json       - one file per person, fetched once
data/graph.json                  - compiled {nodes, edges} for the frontend
data/needs-review.json           - ambiguous TMDB matches, if any (check!)
.github/workflows/weekly-refresh.yml   - cron: discover+enrich+build-graph+commit
.github/workflows/deploy-pages.yml     - native Actions Pages deploy
site/                            - TypeScript + Vite frontend
  src/graph-view.ts              - core 3d-force-graph setup, focus/dim/camera logic
  src/detail-panel.ts            - 2D connections panel
  src/search.ts                  - Fuse.js wiring
  src/tokens.css                 - color/type/motion design tokens
  scripts/sync-data.js           - copies ../data/graph.json into public/ before dev/build
legacy/                          - archived 2018 Python/IMDbPy/MySQL project
```
