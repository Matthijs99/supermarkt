# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Dev setup

No build step. Serve the repo root over HTTP (required for CORS on the data fetch):

```
python -m http.server 8000
```

Then open `http://localhost:8000`. No package.json, no npm, no tests.

## Architecture

Single-file app: everything lives in `index.html` — inline CSS, inline JS, no separate files.

**Data flow:**
1. `loadData()` fetches `supermarkets.json` from checkjebon.nl (fallback to GitHub raw). Each supermarket has `{n, c, u, d[]}` where `d` is an array of products `{n, p, s, l}`.
2. On load, Fuse.js indexes are pre-built per supermarket and cached in `fuseCache`.
3. On search, `searchSupermarket()` combines guaranteed substring matches with Fuse fuzzy results, returns all matching items.
4. `search()` flatMaps all supermarket results into `cachedResults[]`, determines the filter unit, then calls `applyFilterAndRender()`.
5. `applyFilterAndRender()` filters by size range, groups by supermarket, picks the best product per supermarket (lowest unit price, or lowest price if no unit price), sorts, and renders.

**Size filter:**
- `parseSize(s)` normalises size strings to `{grams}`, `{ml}`, or `{stuks}`.
- `determineFilterUnit(rows)` picks the majority unit type across results to auto-configure the filter UI.
- `passesSizeFilter(size)` checks a single product against the active min/max range.
- Filter state: `filterUnit`, `filterMin`, `filterMax` globals.

**Git workflow:** feature branches use the naming convention `worktree-feature+<name>` and are developed in separate git worktrees under `.claude/worktrees/`.
