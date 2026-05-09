# Design: Handling Unlabeled Items

**Date:** 2026-05-09
**Branch:** `worktree-feature+unlabeled-items`

## Problem

Many products in the dataset have no usable size string in `product.s`. Examples (from live `supermarkets.json`):

| Supermarket | Product name | `s` field | `p` |
|---|---|---|---|
| Jumbo | `Jumbo Komkommer` | `""` | 0.85 |
| Jumbo | `Heinz Sandwich spread komkommer 300g` | `""` | 2.49 |
| Jumbo | `Go-Tan Atjar ketimoen (komkommer) 330g` | `""` | 2.99 |
| LIDL | `Komkommer` | `""` | 0.74 |
| LIDL | `Biologische komkommer` | `""` | 0.99 |

Two distinct sub-cases:

1. **Size is in the name, not in `s`.** Common at Jumbo. The data is recoverable.
2. **No size info anywhere.** A single piece sold per stuk, but the supplier never declared so. Not recoverable from the feed.

Currently, `parseSize()` returns `null` for both, so:
- No unit price is computed.
- The row renders with an empty unit-price slot, looking visually broken.
- Sort order pushes them to the bottom, but they remain mixed in with unit-priced items.
- Users cannot dismiss them as a class.

## Goals

1. **Recover** size from `product.n` when `product.s` is empty (case 1).
2. **Mark** unrecoverable items clearly (case 2) — distinct rendering, not blank.
3. **Hide** them on demand via an opt-in toggle.

## Non-Goals

- No category-based weight inference (e.g. "cucumber ≈ 400g"). Too opinionated, silently wrong, high maintenance.
- No backend / data-source changes. We only read what `checkjebon` provides.
- No persistence of the toggle across page reloads. Session-only, matching `strictMode`.

## Architecture

Three small, layered changes inside `app.js`. No new modules.

```
search() per product
  ├─ parseSize(product.s)
  ├─ if null → parseSize(product.n)        [NEW: name fallback]
  └─ result: size object or null

applyFilterAndRender() per row
  ├─ existing: supermarket / unit-type / size-range / negative-term filters
  └─ if hideUnlabeled && size === null: skip   [NEW]

render
  └─ if size === null: show "geen eenheid" placeholder   [NEW]
                       instead of empty unit-price div
```

UI: one new `sm-pill` toggle, mirroring the existing `#strict-wrap` pattern.

## Components

### 1. Name-fallback parser

New thin wrapper, used at the single callsite in `search()`:

```js
function parseProductSize(product) {
  return parseSize(product.s) ?? parseSize(product.n);
}
```

`parseSize` is already unit-anchored (`g|kg|mg|ml|cl|dl|l|gram|liter|stuks?`), so it will not false-positive on bare digits in product names. The greedy `(\d+)\s*(unit)\b` branch will catch the first hit in names like `"Heinz Sandwich spread komkommer 300g"`. First-match-wins is the same behavior the function has today for the `s` field.

Replace the call at `app.js:425`:
```js
const size = parseSize(item.s);
```
with
```js
const size = parseProductSize(item);
```

### 2. Hide-unlabeled toggle

**State (new global):**
```js
let hideUnlabeled = false;
```

**HTML** — new wrapper inside `#filter-bar`, placed after `#strict-wrap`:
```html
<div id="hide-unlabeled-wrap" style="display:none">
  <button type="button" id="hide-unlabeled-toggle" class="sm-pill"
          aria-pressed="false" onclick="toggleHideUnlabeled()">
    Verberg zonder eenheid
  </button>
</div>
```

**Visibility:** shown/hidden in `search()` together with `#strict-wrap` (visible when there is an active query, hidden when the query is empty).

**Handler:**
```js
function toggleHideUnlabeled() {
  hideUnlabeled = !hideUnlabeled;
  const btn = document.getElementById('hide-unlabeled-toggle');
  btn.setAttribute('aria-pressed', String(hideUnlabeled));
  btn.classList.toggle('active', hideUnlabeled);
  applyFilterAndRender();
}
```

Note: re-renders only. Unlike `toggleStrictMode`, no re-search needed — the toggle is purely a render-time filter.

### 3. Filter logic

In `applyFilterAndRender`, after the existing unit-type guard (around `app.js:340`), add:
```js
if (hideUnlabeled && row.size === null) continue;
```

The unit-filter check (`if (ut !== null && ut !== filterUnit) continue;`) deliberately lets `ut === null` pass through, so unlabeled items remain visible regardless of which unit pill is active. This is intentional: `determineFilterUnit` always sets a unit when there are results, so any auto-hide-on-unit-filter rule would equal "always hide".

### 4. Render change

In the result-row template (around `app.js:381`):
```js
const unitHtml = row.unitPrice
  ? `<div class="unit-price">${fmt(row.unitPrice.value)}${row.unitPrice.label}</div>`
  : `<div class="unit-price unit-price-missing">geen eenheid</div>`;
```

New CSS rule (`style.css`):
```css
.unit-price-missing {
  font-style: italic;
  /* muted color matching existing secondary-text style */
}
```

Exact color picked from existing muted-text usage in `style.css` during implementation.

### 5. Empty-state message

In `applyFilterAndRender`, extend the empty-result hint logic. While iterating `cachedResults`, count rows that were skipped *only* because of the `hideUnlabeled` guard (i.e. they would have passed every other filter). If `rows.length === 0` and that count is > 0, show:
```
Alleen items zonder eenheid. Schakel "Verberg zonder eenheid" uit om ze te tonen.
```
Existing hints take precedence when the cause is something else (no results at all, strict-mode mismatch, size-range filter, etc.).

## Behavior & Edge Cases

| Scenario | Outcome |
|---|---|
| `product.s = "300 g"` | unchanged — parsed from `s` |
| `product.s = ""`, name has `"...300g"` | name-fallback parses 300g, unit price computed |
| `product.s = ""`, name has no size | `size === null`, rendered as "geen eenheid" |
| Sort | `unitPrice === null` rows still drop to the bottom (existing logic) |
| Best-per-supermarket pick | Unit-priced rows beat unlabeled rows within the same supermarket (existing logic, no change) |
| User clicks unit-filter pill (gram/ml/stuks) | Unlabeled items stay visible (existing `ut !== null` guard) |
| User sets size range min/max | `passesSizeFilter` returns true when `size` is null (existing) — unlabeled items unaffected |
| User toggles hide-unlabeled | Re-render only, no re-search |
| User clears search | Toggle wrap hides alongside strict wrap |
| Strict mode interaction | None — strict mode filters earlier, by name-words |

## Manual Verification Checklist

No automated tests in this project. After implementation, manually verify:

- [ ] `komkommer` query: Jumbo and LIDL "Komkommer" rows show with "geen eenheid" label, sorted to bottom.
- [ ] `komkommer` query: Jumbo "Heinz Sandwich spread komkommer 300g" row gets a `/100g` unit price (recovered from name).
- [ ] Toggle `Verberg zonder eenheid` on → unlabeled rows disappear, labeled rows stay.
- [ ] Toggle off again → unlabeled rows return.
- [ ] Empty `komkommer` query (no input) → toggle wrap is hidden.
- [ ] Switching unit-filter pills (gram/ml/stuks) does not hide unlabeled rows on its own.
- [ ] A query like `chips` or `melk` (with mostly labeled items) — unlabeled rows render with the muted "geen eenheid" line, no layout breakage.
- [ ] Strict-mode toggle still works alongside the new toggle.
- [ ] Page reload resets `hideUnlabeled` to false (off).

## Out of Scope

- Category weight inference (cucumber → 400g, etc.).
- Persisting toggle state to localStorage.
- A dedicated section / heading separating "labeled" and "unlabeled" rows.
- Heuristics that infer "per stuk" from product name keywords.
