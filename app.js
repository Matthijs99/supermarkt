const DATA_URLS = [
  'https://www.checkjebon.nl/data/supermarkets.json',
  'https://raw.githubusercontent.com/supermarkt/checkjebon/main/data/supermarkets.json',
];

let supermarketsData = null;
const fuseCache = new Map();
let debounceTimer = null;
const enabledSupermarkets = new Set();

let currentQuery      = '';
let cachedResults     = [];
let filterUnit        = null;
let filterMin         = null;
let filterMax         = null;
let negativeTerms     = [];
let strictMode        = true;
let currentStrictMode = true;

async function loadData() {
  for (const url of DATA_URLS) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(res.status);
      supermarketsData = await res.json();
      return;
    } catch (e) {
      console.warn('Could not load from', url, e);
    }
  }
  throw new Error('All data sources failed');
}

// --- Size parsing ---

function parseNum(s) {
  return parseFloat(String(s).replace(',', '.'));
}

function weightToGrams(amount, unit) {
  switch (unit.toLowerCase()) {
    case 'mg':                  return amount / 1000;
    case 'g': case 'gram':      return amount;
    case 'kg':                  return amount * 1000;
    default:                    return null;
  }
}

function volumeToMl(amount, unit) {
  switch (unit.toLowerCase()) {
    case 'ml':                  return amount;
    case 'cl':                  return amount * 10;
    case 'dl':                  return amount * 100;
    case 'l': case 'liter':     return amount * 1000;
    default:                    return null;
  }
}

const WEIGHT_RE = /g|kg|mg|gram/i;
const VOLUME_RE = /ml|cl|dl|l|liter/i;

function parseSize(s) {
  if (!s) return null;
  const str = s.trim();

  // "per stuk" or bare "stuk"
  if (/^(per\s+)?stuk$/i.test(str)) return { stuks: 1 };

  // "N stuks" / "N st."
  let m = str.match(/^(\d+(?:[.,]\d+)?)\s*stuks?\.?$/i);
  if (m) return { stuks: parseNum(m[1]) };

  // "per 100 gram" / "per 100 ml" (already normalised)
  m = str.match(/^per\s+(\d+(?:[.,]\d+)?)\s*(g|kg|mg|ml|cl|dl|l|gram|liter)\b/i);
  if (m) {
    const n = parseNum(m[1]), u = m[2];
    const g = weightToGrams(n, u);
    if (g !== null) return { grams: g };
    const ml = volumeToMl(n, u);
    if (ml !== null) return { ml };
  }

  // "N x M unit" (multipacks)
  m = str.match(/^(\d+(?:[.,]\d+)?)\s*[xX×]\s*(\d+(?:[.,]\d+)?)\s*(g|kg|mg|ml|cl|dl|l|gram|liter)\b/i);
  if (m) {
    const total = parseNum(m[1]) * parseNum(m[2]), u = m[3];
    const g = weightToGrams(total, u);
    if (g !== null) return { grams: g };
    const ml = volumeToMl(total, u);
    if (ml !== null) return { ml };
  }

  // "ca. N unit" or plain "N unit"
  m = str.match(/(?:ca\.?\s*)?(\d+(?:[.,]\d+)?)\s*(g|kg|mg|ml|cl|dl|l|gram|liter)\b/i);
  if (m) {
    const n = parseNum(m[1]), u = m[2];
    const g = weightToGrams(n, u);
    if (g !== null) return { grams: g };
    const ml = volumeToMl(n, u);
    if (ml !== null) return { ml };
  }

  return null;
}

function calcUnitPrice(price, size) {
  if (!size) return null;
  if (size.grams > 0) return { value: price / size.grams * 100, label: '/100g' };
  if (size.ml > 0)    return { value: price / size.ml * 100,    label: '/100ml' };
  if (size.stuks > 0) return { value: price / size.stuks,        label: '/stuk' };
  return null;
}

function fmt(n) {
  return '€ ' + n.toFixed(2);
}

function normalizeStr(s) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function generateSearchForms(word) {
  const forms = new Set([word, word + 'en']);
  if (!word.endsWith('s')) forms.add(word + 's');
  // Double-vowel shortening: peer→peren, banaan→bananen, tomaat→tomaten
  const m = word.match(/^(.+?)(aa|ee|oo|uu)([bcdfghjklmnpqrstvwxyz])$/i);
  if (m) forms.add(m[1] + m[2][0] + m[3] + 'en');
  // Consonant-doubling: kip→kippen, kat→katten, ham→hammen, vis→vissen
  const cv = word.match(/^(.+[aeiou])([bcdfghjklmnpqrstvwxyz])$/i);
  if (cv && cv[1].length >= 2) forms.add(cv[1] + cv[2] + cv[2] + 'en');
  return [...forms];
}

function strictWordMatch(productName, queryWords) {
  return queryWords.every(w => {
    const forms = generateSearchForms(w).map(escapeRegex).join('|');
    return new RegExp('\\b(?:' + forms + ')\\b', 'i').test(productName);
  });
}

function parseQuery(raw) {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  const neg = [], pos = [];
  for (const t of tokens) {
    if (t.startsWith('-') && t.length > 1) neg.push(t.slice(1).toLowerCase());
    else pos.push(t);
  }
  return { positiveQuery: pos.join(' '), negativeTerms: neg };
}

function getGuaranteedMatches(products, query) {
  const words  = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const concat = normalizeStr(query);
  return products.filter(p => {
    if (strictMode) return strictWordMatch(p.n, words);
    const name     = p.n.toLowerCase();
    const nameNorm = normalizeStr(p.n);
    const allWords = words.every(w => name.includes(w));
    const concatHit = concat.length >= 2 && nameNorm.includes(concat);
    return allWords || concatHit;
  });
}

// --- Fuzzy search ---

function getFuse(supermarket) {
  if (!fuseCache.has(supermarket.n)) {
    fuseCache.set(supermarket.n, new Fuse(supermarket.d, {
      keys: ['n'],
      threshold: 0.2,
      includeScore: true,
      minMatchCharLength: 2,
      useExtendedSearch: true,
    }));
  }
  return fuseCache.get(supermarket.n);
}

function searchSupermarket(supermarket, query) {
  const words      = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const guaranteed = getGuaranteedMatches(supermarket.d, query);
  let fuzzy = getFuse(supermarket).search(query).map(r => r.item);
  if (strictMode) fuzzy = fuzzy.filter(item => strictWordMatch(item.n, words));
  const seen = new Set(guaranteed);
  for (const item of fuzzy) seen.add(item);
  return [...seen];
}

// --- Size filter ---

function determineFilterUnit(rows) {
  let g = 0, ml = 0, st = 0;
  for (const row of rows) {
    if (row.size?.grams !== undefined) g++;
    else if (row.size?.ml !== undefined) ml++;
    else if (row.size?.stuks !== undefined) st++;
  }
  if (ml >= g && ml >= st && ml > 0) return 'ml';
  if (g >= ml && g >= st && g > 0) return 'grams';
  if (st > 0) return 'stuks';
  return null;
}

function displayUnit(unit) {
  if (unit === 'ml')    return 'L';
  if (unit === 'grams') return 'g';
  if (unit === 'stuks') return 'stuks';
  return '';
}

function filterStep(unit) {
  if (unit === 'ml')    return 0.1;
  if (unit === 'grams') return 50;
  return 1;
}

function passesSizeFilter(size) {
  if (!size || !filterUnit || (filterMin === null && filterMax === null)) return true;
  let value;
  if      (filterUnit === 'ml'    && size.ml    !== undefined) value = size.ml / 1000;
  else if (filterUnit === 'grams' && size.grams !== undefined) value = size.grams;
  else if (filterUnit === 'stuks' && size.stuks !== undefined) value = size.stuks;
  else return true;
  if (filterMin !== null && value < filterMin) return false;
  if (filterMax !== null && value > filterMax) return false;
  return true;
}

function updateFilterUI(prevUnit) {
  const wrap  = document.getElementById('filter-wrap');
  const label = document.getElementById('filter-unit-label');
  const minEl = document.getElementById('min-size');
  const maxEl = document.getElementById('max-size');

  if (!filterUnit) { wrap.style.display = 'none'; return; }

  label.textContent = displayUnit(filterUnit);
  const step = filterStep(filterUnit);
  minEl.step = maxEl.step = step;

  if (prevUnit !== filterUnit) {
    filterMin = filterMax = null;
    minEl.value = '';
    maxEl.value = '';
  }

  wrap.style.display = '';
}

function getUnitTypes(rows) {
  const types = new Set();
  for (const row of rows) {
    if (row.size?.grams !== undefined) types.add('grams');
    else if (row.size?.ml !== undefined) types.add('ml');
    else if (row.size?.stuks !== undefined) types.add('stuks');
  }
  return types;
}

const UNIT_LABELS = { grams: 'gram', ml: 'ml', stuks: 'stuks' };

function buildUnitFilter(unitTypes) {
  const wrap = document.getElementById('unit-filter-wrap');
  wrap.innerHTML = '';

  if (unitTypes.size < 2) { wrap.style.display = 'none'; return; }

  const prefix = document.createElement('span');
  prefix.className = 'filter-prefix';
  prefix.textContent = 'Eenheid:';
  wrap.appendChild(prefix);

  const seg = document.createElement('div');
  seg.className = 'segmented';
  seg.setAttribute('role', 'radiogroup');
  seg.setAttribute('aria-label', 'Eenheid');
  wrap.appendChild(seg);

  for (const unit of ['grams', 'ml', 'stuks']) {
    if (!unitTypes.has(unit)) continue;
    const isActive = unit === filterUnit;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'seg-btn';
    btn.setAttribute('aria-pressed', String(isActive));
    btn.textContent = UNIT_LABELS[unit];
    btn.addEventListener('click', () => {
      if (filterUnit === unit) return;
      const prev = filterUnit;
      filterUnit = unit;
      seg.querySelectorAll('.seg-btn').forEach(b => {
        b.setAttribute('aria-pressed', String(b === btn));
      });
      updateFilterUI(prev);
      applyFilterAndRender();
    });
    seg.appendChild(btn);
  }

  wrap.style.display = '';
}

function updateSmTriggerCount() {
  const total = supermarketsData.length;
  const enabled = enabledSupermarkets.size;
  document.getElementById('sm-trigger-count').textContent = `${enabled} / ${total}`;
}

function setSmPopoverOpen(open) {
  const trigger = document.getElementById('sm-trigger');
  const popover = document.getElementById('sm-popover');
  trigger.setAttribute('aria-expanded', String(open));
  if (open) {
    const rect = trigger.getBoundingClientRect();
    popover.style.top = `${rect.bottom + 8}px`;
    popover.style.left = `${rect.left + rect.width / 2}px`;
    popover.hidden = false;
  } else {
    popover.hidden = true;
  }
}

function buildFilters() {
  const list = document.getElementById('sm-list');
  list.innerHTML = '';
  supermarketsData.forEach(sm => {
    enabledSupermarkets.add(sm.n);
    const li = document.createElement('li');
    const label = document.createElement('label');
    label.className = 'sm-option';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.addEventListener('change', () => {
      if (cb.checked) enabledSupermarkets.add(sm.n);
      else enabledSupermarkets.delete(sm.n);
      updateSmTriggerCount();
      applyFilterAndRender();
    });
    const span = document.createElement('span');
    span.textContent = (sm.c || sm.n).replace(/\s*\(via[^)]*\)/i, '');
    label.appendChild(cb);
    label.appendChild(span);
    li.appendChild(label);
    list.appendChild(li);
  });
  updateSmTriggerCount();

  const trigger = document.getElementById('sm-trigger');
  const popover = document.getElementById('sm-popover');

  trigger.addEventListener('click', e => {
    e.stopPropagation();
    setSmPopoverOpen(popover.hidden);
  });

  document.addEventListener('click', e => {
    if (popover.hidden) return;
    if (!popover.contains(e.target) && e.target !== trigger) {
      setSmPopoverOpen(false);
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !popover.hidden) {
      setSmPopoverOpen(false);
      trigger.focus();
    }
  });

  window.addEventListener('scroll', () => {
    if (!popover.hidden) setSmPopoverOpen(false);
  }, { passive: true });

  popover.querySelector('[data-action="all"]').addEventListener('click', () => {
    list.querySelectorAll('input[type=checkbox]').forEach(cb => {
      if (!cb.checked) cb.checked = true;
    });
    supermarketsData.forEach(sm => enabledSupermarkets.add(sm.n));
    updateSmTriggerCount();
    applyFilterAndRender();
  });

  popover.querySelector('[data-action="none"]').addEventListener('click', () => {
    list.querySelectorAll('input[type=checkbox]').forEach(cb => {
      cb.checked = false;
    });
    enabledSupermarkets.clear();
    updateSmTriggerCount();
    applyFilterAndRender();
  });
}

// --- Render ---

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
    if (!cur
      || (row.unitPrice && (!cur.unitPrice || row.unitPrice.value < cur.unitPrice.value))
      || (!row.unitPrice && !cur.unitPrice && row.product.p < cur.product.p)) {
      bestBySm.set(row.sm, row);
    }
  }
  const rows = [...bestBySm.values()];

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

  rows.sort((a, b) => {
    if (a.unitPrice && b.unitPrice) return a.unitPrice.value - b.unitPrice.value;
    if (a.unitPrice) return -1;
    if (b.unitPrice) return 1;
    return a.product.p - b.product.p;
  });

  statusEl.textContent = '';
  const cheapest = rows[0];

  resultsEl.innerHTML = rows.map(row => {
    const isCheapest = row === cheapest;
    const href = (row.sm.u && row.product.l) ? row.sm.u + row.product.l : null;
    const nameHtml = href
      ? `<a href="${href}" target="_blank" rel="noopener">${row.product.n}</a>`
      : row.product.n;
    const badge    = isCheapest ? `<span class="cheapest-badge">goedkoopst</span>` : '';
    const unitHtml = row.unitPrice
      ? `<div class="unit-price">${fmt(row.unitPrice.value)}${row.unitPrice.label}</div>`
      : '';

    return `
      <div class="result-row${isCheapest ? ' cheapest' : ''}">
        <div class="supermarket-name">${row.sm.c || row.sm.n}</div>
        <div class="product-name">${nameHtml}${badge}</div>
        <div class="prices">
          ${unitHtml}
          <div class="price">${fmt(row.product.p)}</div>
          <div class="size">${row.product.s || ''}</div>
        </div>
      </div>`;
  }).join('');
}

function search(query) {
  const resultsEl = document.getElementById('results');
  const statusEl  = document.getElementById('status');

  const { positiveQuery, negativeTerms: newNeg } = parseQuery(query);
  negativeTerms = newNeg;

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

  if (positiveQuery !== currentQuery || strictMode !== currentStrictMode) {
    currentQuery = positiveQuery;
    currentStrictMode = strictMode;
    cachedResults = supermarketsData.flatMap(sm => {
      const products = searchSupermarket(sm, positiveQuery);
      return products.map(item => {
        const size      = parseSize(item.s);
        const unitPrice = calcUnitPrice(item.p, size);
        return { sm, product: item, size, unitPrice };
      });
    });

    const prevUnit = filterUnit;
    const newUnitTypes = getUnitTypes(cachedResults);
    if (!filterUnit || !newUnitTypes.has(filterUnit)) {
      filterUnit = determineFilterUnit(cachedResults);
    }
    updateFilterUI(prevUnit);
    buildUnitFilter(newUnitTypes);
    document.getElementById('sm-filter-wrap').style.display = '';
    document.getElementById('strict-wrap').style.display = '';
  }

  applyFilterAndRender();
}

function toggleStrictMode() {
  strictMode = !strictMode;
  document.getElementById('strict-toggle')
          .setAttribute('aria-checked', String(strictMode));
  if (currentQuery) search(searchEl.value);
}

// --- Init ---

const searchEl = document.getElementById('search');
const statusEl = document.getElementById('status');

searchEl.addEventListener('input', () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => search(searchEl.value), 600);
});

searchEl.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    clearTimeout(debounceTimer);
    search(searchEl.value);
  }
});

document.getElementById('min-size').addEventListener('input', e => {
  filterMin = e.target.value !== '' ? parseFloat(e.target.value) : null;
  applyFilterAndRender();
});
document.getElementById('max-size').addEventListener('input', e => {
  filterMax = e.target.value !== '' ? parseFloat(e.target.value) : null;
  applyFilterAndRender();
});
document.getElementById('filter-clear').addEventListener('click', () => {
  filterMin = filterMax = null;
  document.getElementById('min-size').value = '';
  document.getElementById('max-size').value = '';
  applyFilterAndRender();
});

loadData()
  .then(() => {
    // Pre-build all Fuse indexes while the user hasn't typed yet
    supermarketsData.forEach(sm => getFuse(sm));
    buildFilters();
    statusEl.textContent = '';
    searchEl.disabled = false;
    searchEl.placeholder = 'Zoek een product… bijv. "paprika chips"';
    searchEl.focus();
  })
  .catch(() => {
    statusEl.textContent = 'Kon data niet laden. Controleer je internetverbinding en herlaad de pagina.';
  });
