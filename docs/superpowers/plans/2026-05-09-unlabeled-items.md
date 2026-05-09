# Unlabeled Items Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover sizes from product names when the `s` field is empty, mark still-unparseable items as "geen eenheid" instead of rendering them blank, and add an opt-in toggle to hide them.

**Architecture:** Three layered changes inside the existing single-file app: a `parseProductSize` wrapper that falls back from `s` to `n`, a render-time placeholder for `size === null` rows, and a `hideUnlabeled` global plus sm-pill toggle that mirrors the existing strict-mode pattern.

**Tech Stack:** Vanilla JS in `app.js`, plain HTML in `index.html`, plain CSS in `style.css`. No build, no tests (per `CLAUDE.md`). Verification is manual via `python -m http.server 8000`.

**Spec:** `docs/superpowers/specs/2026-05-09-unlabeled-items-design.md`

---

## File Structure

| File | Role | Changes |
|---|---|---|
| `app.js` | All app logic | Add `parseProductSize`; swap callsite; add `hideUnlabeled` global; add `toggleHideUnlabeled`; modify `applyFilterAndRender` (filter guard + empty-state hint); modify result-row template; modify `search` (toggle wrap visibility) |
| `index.html` | Markup | Add `#hide-unlabeled-wrap` next to `#strict-wrap` |
| `style.css` | Styling | Add `.unit-price-missing` rule |

No new files. All edits stay inside the existing single-page architecture.

---

## Task 1: Name-fallback parser

**Files:**
- Modify: `app.js` — add `parseProductSize` near `parseSize` (around line 104)
- Modify: `app.js:425` — swap callsite to use the new wrapper

**Outcome:** Products like Jumbo `Heinz Sandwich spread komkommer 300g` (with empty `s`) get a unit price computed from their name. Products with no size anywhere remain `size === null`.

- [ ] **Step 1: Add `parseProductSize` wrapper**

In `app.js`, immediately after the existing `parseSize` function (the line `return null; }` that ends the function on/near line 104), add:

```js
function parseProductSize(product) {
  return parseSize(product.s) ?? parseSize(product.n);
}
```

- [ ] **Step 2: Swap the callsite in `search()`**

Find the line in `app.js` (currently around line 425) inside the `cachedResults = supermarketsData.flatMap(...)` block:

```js
const size      = parseSize(item.s);
```

Replace it with:

```js
const size      = parseProductSize(item);
```

- [ ] **Step 3: Manual verification**

Start the dev server and open the app:

```bash
python -m http.server 8000
```

Open `http://localhost:8000`, search `komkommer`, and check:
- `Heinz Sandwich spread komkommer 300g` (Jumbo) shows a `/100g` unit price.
- `Go-Tan Atjar ketimoen (komkommer) 330g` (Jumbo) shows a `/100g` unit price.
- `Jumbo Komkommer` and LIDL `Komkommer` still have no unit price (still unlabeled — that's Task 2).
- Existing labeled items (e.g. AH `Komkommer salade 300 g`) still show their unit price unchanged.

- [ ] **Step 4: Commit**

```bash
git add app.js
git commit -m "Parse product size from name when 's' field is empty"
```

---

## Task 2: "geen eenheid" rendering

**Files:**
- Modify: `app.js` — change the `unitHtml` template inside `applyFilterAndRender` (around line 381)
- Modify: `style.css` — add `.unit-price-missing` rule after the existing `.unit-price` block (around line 394)

**Outcome:** Rows with `size === null` no longer render with a blank unit-price slot — they show a muted italic "geen eenheid" line that's clearly distinct from a real unit price.

- [ ] **Step 1: Update the result-row template**

In `app.js`, find this block inside the `resultsEl.innerHTML = rows.map(...)` template (currently around line 381):

```js
const unitHtml = row.unitPrice
  ? `<div class="unit-price">${fmt(row.unitPrice.value)}${row.unitPrice.label}</div>`
  : '';
```

Replace it with:

```js
const unitHtml = row.unitPrice
  ? `<div class="unit-price">${fmt(row.unitPrice.value)}${row.unitPrice.label}</div>`
  : `<div class="unit-price unit-price-missing">geen eenheid</div>`;
```

- [ ] **Step 2: Add the CSS rule**

In `style.css`, find the existing `.cheapest .unit-price { color: #b45309; }` line (currently line 394). Insert this rule on the line after it:

```css
.unit-price-missing {
  font-size: .8rem;
  font-weight: 400;
  font-style: italic;
  color: var(--text-soft);
  letter-spacing: 0;
}
.cheapest .unit-price-missing { color: var(--text-soft); }
```

The second rule prevents the cheapest-row amber color from coloring the placeholder (an unlabeled item should never be marked "goedkoopst" anyway, but this is defensive).

- [ ] **Step 3: Manual verification**

Reload the browser tab. Search `komkommer`:
- `Jumbo Komkommer` and LIDL `Komkommer` rows now show a small italic muted "geen eenheid" line where the unit price would be.
- Their layout matches the other rows' price column (no shift, no broken alignment).
- Other rows are unchanged.

Search `chips` — same expectations: any unlabeled rows show "geen eenheid", others unchanged.

- [ ] **Step 4: Commit**

```bash
git add app.js style.css
git commit -m "Render 'geen eenheid' for products without parseable size"
```

---

## Task 3: Hide-unlabeled toggle — UI scaffold

**Files:**
- Modify: `index.html` — add `#hide-unlabeled-wrap` after `#strict-wrap` (around line 61)
- Modify: `app.js` — add `hideUnlabeled` global (around line 17), add `toggleHideUnlabeled` (after `toggleStrictMode`, around line 451), show/hide the wrap inside `search()` (around line 412 and 439)

**Outcome:** A new "Verberg zonder eenheid" sm-pill appears next to "Exacte match" when there's an active query. Clicking it toggles its `aria-pressed` and `active` class. No filtering effect yet — that's Task 4. After this task, the UI is in place but functionally inert.

- [ ] **Step 1: Add the toggle markup**

In `index.html`, find the `#strict-wrap` block (currently lines 56–61):

```html
<div id="strict-wrap" style="display:none">
  <button type="button" id="strict-toggle" class="sm-pill active"
          aria-pressed="true" onclick="toggleStrictMode()">
    Exacte match
  </button>
</div>
```

Immediately after that closing `</div>` (and before `<div id="sm-filter-wrap"></div>` on the next line), insert:

```html
<div id="hide-unlabeled-wrap" style="display:none">
  <button type="button" id="hide-unlabeled-toggle" class="sm-pill"
          aria-pressed="false" onclick="toggleHideUnlabeled()">
    Verberg zonder eenheid
  </button>
</div>
```

Note the differences from `#strict-wrap`: no `active` class, `aria-pressed="false"` — the toggle starts off (visible items not hidden).

- [ ] **Step 2: Add the global state**

In `app.js`, find the existing globals block (currently lines 11–18):

```js
let currentQuery      = '';
let cachedResults     = [];
let filterUnit        = null;
let filterMin         = null;
let filterMax         = null;
let negativeTerms     = [];
let strictMode        = true;
let currentStrictMode = true;
```

Add one line after `let strictMode        = true;`:

```js
let hideUnlabeled     = false;
```

The result should look like:

```js
let strictMode        = true;
let hideUnlabeled     = false;
let currentStrictMode = true;
```

- [ ] **Step 3: Add the handler**

In `app.js`, find the existing `toggleStrictMode` function (currently lines 445–451):

```js
function toggleStrictMode() {
  strictMode = !strictMode;
  const btn = document.getElementById('strict-toggle');
  btn.setAttribute('aria-pressed', String(strictMode));
  btn.classList.toggle('active', strictMode);
  if (currentQuery) search(searchEl.value);
}
```

Immediately after its closing `}`, add:

```js
function toggleHideUnlabeled() {
  hideUnlabeled = !hideUnlabeled;
  const btn = document.getElementById('hide-unlabeled-toggle');
  btn.setAttribute('aria-pressed', String(hideUnlabeled));
  btn.classList.toggle('active', hideUnlabeled);
  applyFilterAndRender();
}
```

Note: this calls `applyFilterAndRender()` directly, not `search()`. The toggle is a render-time filter — no need to re-search.

- [ ] **Step 4: Show/hide the wrap with the strict wrap**

In `app.js`, inside `search()`, find the empty-query branch (currently around lines 405–417):

```js
if (!positiveQuery) {
  cachedResults = [];
  currentQuery = '';
  currentStrictMode = strictMode;
  filterUnit = null;
  updateFilterUI(filterUnit);
  buildUnitFilter(new Set());
  document.getElementById('sm-filter-wrap').style.display = 'none';
  document.getElementById('strict-wrap').style.display = 'none';
  resultsEl.innerHTML = '';
  statusEl.textContent = '';
  return;
}
```

Add one line after the `strict-wrap` line:

```js
document.getElementById('hide-unlabeled-wrap').style.display = 'none';
```

Then find the end of the active-search branch (currently around lines 437–440):

```js
updateFilterUI(prevUnit);
buildUnitFilter(newUnitTypes);
document.getElementById('sm-filter-wrap').style.display = '';
document.getElementById('strict-wrap').style.display = '';
```

Add one line after the `strict-wrap` line:

```js
document.getElementById('hide-unlabeled-wrap').style.display = '';
```

- [ ] **Step 5: Manual verification**

Reload the browser tab.
- Empty search box → no `Verberg zonder eenheid` button visible.
- Type `komkommer` → button appears next to `Exacte match`, in the off (non-active) state.
- Click it → it visually toggles to the active style; click again → back to off.
- No change in the result list (filter logic comes in Task 4).
- Clear the search → button hides again.

- [ ] **Step 6: Commit**

```bash
git add index.html app.js
git commit -m "Add 'Verberg zonder eenheid' toggle scaffold (UI only)"
```

---

## Task 4: Hide-unlabeled toggle — filter logic + empty-state hint

**Files:**
- Modify: `app.js` — add the `hideUnlabeled` guard inside the loop in `applyFilterAndRender` (currently around line 343), introduce `unlabeledHiddenCount`, extend the empty-state hint logic (currently around lines 353–360)

**Outcome:** Toggling the button now filters out `size === null` rows. When that filtering is the *only* reason the result list is empty, the user sees a hint pointing them to the toggle.

- [ ] **Step 1: Add the counter and the filter guard**

In `app.js`, find the start of `applyFilterAndRender` and the `for (const row of cachedResults)` loop (currently around lines 328–344):

```js
function applyFilterAndRender() {
  const resultsEl = document.getElementById('results');
  const statusEl  = document.getElementById('status');

  const bestBySm = new Map();
  for (const row of cachedResults) {
    if (!enabledSupermarkets.has(row.sm.n)) continue;
    if (filterUnit) {
      const ut = row.size?.grams !== undefined ? 'grams'
               : row.size?.ml    !== undefined ? 'ml'
               : row.size?.stuks !== undefined ? 'stuks'
               : null;
      if (ut !== null && ut !== filterUnit) continue;
    }
    if (!passesSizeFilter(row.size)) continue;
    if (negativeTerms.length > 0 && negativeTerms.some(t => row.product.n.toLowerCase().includes(t))) continue;
    const cur = bestBySm.get(row.sm);
```

Make two changes:

(a) Before the `for` loop, declare the counter:

```js
const bestBySm = new Map();
let unlabeledHiddenCount = 0;
for (const row of cachedResults) {
```

(b) Inside the loop, **after** the negative-terms guard and **before** the `const cur = ...` line, add the new guard:

```js
if (negativeTerms.length > 0 && negativeTerms.some(t => row.product.n.toLowerCase().includes(t))) continue;
if (hideUnlabeled && row.size === null) { unlabeledHiddenCount++; continue; }
const cur = bestBySm.get(row.sm);
```

Order matters: the new guard must be the *last* filter check before the best-pick logic, so that `unlabeledHiddenCount` only counts rows that would otherwise have rendered.

- [ ] **Step 2: Extend the empty-state hint**

In `app.js`, find the empty-state block (currently around lines 353–362):

```js
if (rows.length === 0) {
  const hint = strictMode && cachedResults.length === 0
    ? 'Geen exacte resultaten. Zet "Exacte match" uit voor meer resultaten.'
    : cachedResults.length === 0
      ? 'Geen resultaten gevonden.'
      : 'Geen resultaten binnen dit formaat.';
  statusEl.textContent = hint;
  resultsEl.innerHTML = '';
  return;
}
```

Replace the entire `if (rows.length === 0) { ... }` block with:

```js
if (rows.length === 0) {
  const hint = unlabeledHiddenCount > 0
    ? 'Alleen items zonder eenheid. Schakel "Verberg zonder eenheid" uit om ze te tonen.'
    : strictMode && cachedResults.length === 0
      ? 'Geen exacte resultaten. Zet "Exacte match" uit voor meer resultaten.'
      : cachedResults.length === 0
        ? 'Geen resultaten gevonden.'
        : 'Geen resultaten binnen dit formaat.';
  statusEl.textContent = hint;
  resultsEl.innerHTML = '';
  return;
}
```

The new hint takes precedence when (and only when) the toggle hid at least one row that would otherwise have rendered.

- [ ] **Step 3: Manual verification**

Reload the browser tab. Search `komkommer`:
- Toggle off (default): `Jumbo Komkommer` and LIDL `Komkommer` rows show with `geen eenheid`.
- Click the toggle on: those rows disappear; labeled rows remain.
- Click off again: unlabeled rows return.

Construct a query where every result is unlabeled (e.g. search for a generic Jumbo-only term whose products all have empty `s` and no name-size — try `jumbo bakkerij` or similar; if nothing fits, this case is rare in practice and the existing fallback hints will cover it). Toggle on; status bar should read `Alleen items zonder eenheid. Schakel "Verberg zonder eenheid" uit om ze te tonen.`

Search a normal query like `melk` — toggle should work without affecting labeled items, and the empty-state hint logic shouldn't fire.

- [ ] **Step 4: Commit**

```bash
git add app.js
git commit -m "Hide unlabeled items when toggle is on; show hint if all results are unlabeled"
```

---

## Task 5: Full verification checklist

**Outcome:** Confirm the spec's verification checklist passes end-to-end. No code changes — just exercising the feature.

- [ ] **Step 1: Run the dev server**

```bash
python -m http.server 8000
```

- [ ] **Step 2: Walk the spec checklist**

Open `http://localhost:8000` and confirm each item:

- [ ] `komkommer` query: Jumbo and LIDL "Komkommer" rows show with "geen eenheid" label, sorted to bottom.
- [ ] `komkommer` query: Jumbo "Heinz Sandwich spread komkommer 300g" row gets a `/100g` unit price (recovered from name).
- [ ] Toggle `Verberg zonder eenheid` on → unlabeled rows disappear, labeled rows stay.
- [ ] Toggle off again → unlabeled rows return.
- [ ] Empty `komkommer` query (cleared input) → toggle wrap hides.
- [ ] Switching unit-filter pills (gram/ml/stuks) does not hide unlabeled rows on its own.
- [ ] A query like `chips` or `melk` (with mostly labeled items) — unlabeled rows render with the muted "geen eenheid" line, no layout breakage.
- [ ] Strict-mode toggle still works alongside the new toggle.
- [ ] Page reload resets `hideUnlabeled` to false (off).

- [ ] **Step 3: If everything passes, no commit needed.** If a checklist item fails, file the regression as the next task and fix it before considering the feature done.
