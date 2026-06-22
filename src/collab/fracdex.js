// Fractional indexing for the shared itinerary's ordering — CLIENT copy.
// Identical logic to server/src/fracdex.js (the two are duplicated because client and
// server don't share a module here — keep them in sync). The invariant, the rationale, and
// the per-branch reasoning live in the server file; see also server/test/fracdex.fuzz.mjs
// (property test) and server/test/fracdex.parity.mjs (asserts THIS file matches the server
// copy byte-for-byte in behaviour, so the two can't silently drift).

const DIGITS = 'abcdefghijklmnopqrstuvwxyz';
const MIN = 0; // 'a' — boundary marker, never a terminal digit
const MAX = DIGITS.length - 1; // 'z' — boundary marker, never a terminal digit
const val = (c) => DIGITS.indexOf(c);
const chr = (v) => DIGITS[v];
const midDigit = (lo, hi) => Math.floor((lo + hi) / 2);

// ── COMPOUND KEYS: fractional-index + a site tiebreaker ──────────────────────────────────
// Order is stored as `"<frac>#<siteId>"`. Compare by <frac> first, then <siteId>, so two
// replicas that independently mint the same fractional key still agree on the final order
// (no divergence). Only <frac> participates in keyBetween's math. See the server file.
const SEP = '#';
export const stripSite = (order) => (order == null ? '' : String(order).split(SEP)[0]);
const siteOf = (order) => {
  const s = String(order ?? '');
  const i = s.indexOf(SEP);
  return i === -1 ? '' : s.slice(i + 1);
};

export const keyBetween = (lo, hi) => {
  // Bounds may be compound keys; only the fractional part participates in the math.
  // Treat empty/missing as an open end (legacy rows carry '' which isn't a real key).
  const a = stripSite(lo) || null;
  const b = stripSite(hi) || null;
  if (a !== null && b !== null && a >= b) {
    throw new Error(`keyBetween: lower "${a}" must be < upper "${b}"`);
  }
  if (a === null && b === null) return chr(midDigit(MIN, MAX)); // 'm'
  if (a === null) return before(b);
  if (b === null) return after(a);
  return between(a, b);
};

// A key strictly greater than `a` (open upper bound).
const after = (a) => {
  if (a.length === 0) return chr(midDigit(MIN, MAX));
  const d = val(a[0]);
  if (d <= MAX - 2) return chr(Math.floor((d + 1 + MAX) / 2)); // usable digit above a[0]
  if (d === MAX - 1) return chr(MAX) + chr(midDigit(MIN, MAX)); // 'y' -> "zm"
  return a[0] + after(a.slice(1)); // 'z' — keep and descend
};

// A key strictly less than `b` (open lower bound).
const before = (b) => {
  if (b.length === 0) return chr(midDigit(MIN, MAX));
  const d = val(b[0]);
  if (d >= MIN + 2) return chr(midDigit(MIN, d)); // usable digit below b[0]
  if (d === MIN + 1) return chr(MIN) + chr(midDigit(MIN, MAX)); // 'b' -> "am"
  return b[0] + before(b.slice(1)); // 'a' — keep and descend
};

// A key strictly between two real keys a < b.
const between = (a, b) => {
  let i = 0;
  let prefix = '';
  while (i < a.length && i < b.length && a[i] === b[i]) {
    prefix += a[i];
    i += 1;
  }
  if (i >= a.length) return prefix + before(b.slice(i)); // a is a prefix of b

  const da = val(a[i]);
  const db = val(b[i]);
  if (db - da > 1) return prefix + chr(midDigit(da, db)); // gap → midpoint digit
  return prefix + a[i] + after(a.slice(i + 1)); // adjacent → keep a's digit, go above its tail
};

export const keyAfterLast = (lastOrder) => keyBetween(stripSite(lastOrder) || null, null);

// Build a compound order key from a bare fractional key + a site id.
export const makeOrder = (frac, siteId = '') => (siteId ? `${frac}${SEP}${siteId}` : frac);

// Compare two compound order strings: fractional part first, then site id. Total order.
export const compareOrder = (a, b) => {
  const fa = stripSite(a);
  const fb = stripSite(b);
  if (fa < fb) return -1;
  if (fa > fb) return 1;
  const sa = siteOf(a);
  const sb = siteOf(b);
  if (sa < sb) return -1;
  if (sa > sb) return 1;
  return 0;
};

// Sort items by their compound order key (deterministic across replicas), then by id.
export const sortByOrder = (items) =>
  [...items].sort((x, y) => {
    const c = compareOrder(x.order ?? '', y.order ?? '');
    if (c !== 0) return c;
    const ix = x.id ?? '';
    const iy = y.id ?? '';
    return ix < iy ? -1 : ix > iy ? 1 : 0;
  });

// ── REBALANCING (mirror of server/src/fracdex.js; see there for the full rationale) ───────
// Keys only grow when people repeatedly squeeze into the same gap; production fractional-index
// systems periodically rewrite all keys to fresh evenly-spaced short ones. Server-authoritative
// (broadcast as full state). These are exported for parity; the client only reads rebalanced
// state, it doesn't trigger rebalancing.
export const KEY_LENGTH_THRESHOLD = 12;

export const needsRebalance = (items) =>
  items.some((it) => stripSite(it.order ?? '').length >= KEY_LENGTH_THRESHOLD);

export const evenKeys = (n) => {
  if (n <= 0) return [];
  const LO = 1;
  const SPAN = 24; // 'b'..'y'
  let width = 1;
  let capacity = SPAN;
  while (capacity < n + 1) { width += 1; capacity *= SPAN; }
  const out = [];
  for (let i = 1; i <= n; i += 1) {
    let pos = Math.round((i * capacity) / (n + 1));
    pos = Math.min(capacity - 1, Math.max(1, pos));
    let key = '';
    for (let w = 0; w < width; w += 1) {
      key = chr(LO + (pos % SPAN)) + key;
      pos = Math.floor(pos / SPAN);
    }
    out.push(key);
  }
  return out;
};

export const rebalanceOrders = (items, siteId = '') => {
  const sorted = sortByOrder(items);
  const fresh = evenKeys(sorted.length);
  return sorted.map((it, idx) => ({ ...it, order: makeOrder(fresh[idx], siteId) }));
};
