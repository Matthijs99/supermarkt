# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Dev setup

No build step. Serve the repo root over HTTP (required for CORS on the data fetch):

```
python -m http.server 8000
```

Then open `http://localhost:8000`. No package.json, no npm, no tests.

## Architecture

Three files: `index.html` (markup + Fuse.js CDN), `style.css`, `app.js`. No bundler, no modules — `app.js` runs as a classic script and exposes globals.

**Data flow:**
1. `loadData()` fetches `supermarkets.json` from checkjebon.nl (fallback to GitHub raw). Each supermarket has `{n, c, u, d[]}` where `d` is an array of products `{n, p, s, l}`.
2. On load, Fuse.js indexes are pre-built per supermarket and cached in `fuseCache`.
3. On search, `parseQuery()` splits the input into a positive query and `-foo` negative terms. `searchSupermarket()` combines guaranteed matches (`getGuaranteedMatches`) with Fuse fuzzy results.
4. `search()` flatMaps all supermarket results into `cachedResults[]`, recomputes the unit-type filter UI, then calls `applyFilterAndRender()`.
5. `applyFilterAndRender()` filters by dismissed products, enabled supermarkets, active unit, size range, negative terms, and the hide-unlabeled toggle; groups by supermarket; picks the best product per supermarket (lowest unit price, or lowest price if no unit price); sorts; renders incrementally via `renderedRows` (a `supermarket.n → HTMLElement` map) so unchanged rows keep their DOM nodes and only new rows get the `entering` animation.

**Matching:**
- Strict mode (default ON, toggled via `toggleStrictMode`): requires every query word to match a whole word in the product name. `generateSearchForms()` expands each word with Dutch plural variants (`peer`→`peren`, `kip`→`kippen`, `banaan`→`bananen`), skipping `+s` for words already ending in `s`.
- Loose mode: substring match on each word, plus a concatenated-string fallback for run-together queries.
- `parseQuery()` peels off `-term` tokens into `negativeTerms`, applied at render time.

**Size parsing:**
- `parseSize(s)` normalises size strings to `{grams}`, `{ml}`, or `{stuks}` (handles `per stuk`, `N stuks`, `per 100 g`, `N x M unit` multipacks anywhere in the string, `ca. N unit`).
- `parseProductSize(product)` is the entry point — tries `product.s` first, falls back to parsing the product name when the size field is empty.
- `determineFilterUnit(rows)` picks the majority unit type to auto-configure the filter UI.
- `buildUnitFilter()` renders a segmented control (gram/ml/stuks) when results span multiple unit types.
- `passesSizeFilter(size)` checks a single product against the active min/max range.

**UI controls in the filter bar** (rendered only when there's an active query):
- **Winkels popover** (`buildFilters` + `#sm-trigger` / `#sm-popover`): trigger shows `enabled / total` count; popover has per-supermarket checkboxes plus "Alles aan" / "Geen" actions; closes on outside click, Escape, or scroll.
- **Exacte match** switch: toggles `strictMode`, re-runs search.
- **Verberg zonder eenheid** switch (default ON): toggles `hideUnlabeled`, applied at render time only (no re-search).
- **Eenheid** segmented control: only shown when results have multiple unit types.
- **Size range** min/max inputs with unit label and clear button.
- **Per-row dismiss button** (`×`): adds the product to `dismissedProducts` so the next-best result for that supermarket surfaces. Cleared when the positive query changes.

**State globals:** `filterUnit`, `filterMin`, `filterMax`, `enabledSupermarkets`, `strictMode`, `hideUnlabeled`, `negativeTerms`, `dismissedProducts`, `renderedRows`, `cachedResults`, `currentQuery`, `currentStrictMode`.

**Git workflow:** feature branches use the naming convention `worktree-feature+<name>` and are developed in separate git worktrees under `.claude/worktrees/`.
