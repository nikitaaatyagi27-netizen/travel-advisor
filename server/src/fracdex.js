// Fractional indexing for the shared itinerary's ordering.
//
// WHY: the itinerary is a co-edited ordered list. If "position" were an array index, two
// people reordering at the same instant would fight — each sends the whole list, the last
// to arrive wins, silently erasing the other's reorder (last-write-wins). Instead each item
// carries an `order` string and the list is "items sorted by order". A move rewrites ONLY
// that item's key, so two people moving two DIFFERENT items never collide — edits merge.
//
// ── THE INVARIANT WE MAINTAIN ───────────────────────────────────────────────────────────
// keyBetween(a, b) returns a string K with, for valid inputs (a < b, or null = open end):
//   (1) BETWEEN:   a < K < b   (lexicographically)
//   (2) NON-EMPTY: K.length >= 1
//   (3) STABLE TERMINAL: K never ends in the lowest digit 'a' or the highest digit 'z'.
//
// (3) is the load-bearing rule and the thing my first prototype lacked. Because no key ends
// in 'a' or 'z':
//   • You can ALWAYS find a key below any K: K doesn't end in 'a', so lower its last digit.
//   • You can ALWAYS find a key above any K: K doesn't end in 'z', so raise its last digit.
//   • Two distinct neighbours always have a gap between them, so keyBetween is INJECTIVE —
//     it can't map two different neighbour-pairs onto the same key (the exact bug that made
//     the earlier version produce duplicate `order` values under fuzzing).
// We treat 'a' and 'z' purely as boundary markers ("smaller than any real key" / "larger
// than any real key"); the usable terminal digits are 'b'..'y'.
//
// Keys are compared as plain strings; lexicographic order == intended visit order.

const DIGITS = 'abcdefghijklmnopqrstuvwxyz';
const MIN = 0; // 'a' — boundary marker, never a terminal digit
const MAX = DIGITS.length - 1; // 'z' (25) — boundary marker, never a terminal digit
const val = (c) => DIGITS.indexOf(c);
const chr = (v) => DIGITS[v];

// Midpoint terminal digit strictly between two digit values lo and hi (lo < hi). Used only
// when there's a gap of >= 2, so the result is strictly inside and is in 'b'..'y' as long
// as lo/hi are the boundary markers or real digits — see callers, which guarantee that.
const midDigit = (lo, hi) => Math.floor((lo + hi) / 2);

// ── COMPOUND KEYS: fractional-index + a site tiebreaker (defined first; used below) ───────
// keyBetween is injective for ONE caller, but two replicas computing keyBetween from the
// SAME snapshot can independently mint the SAME fractional key (e.g. both pick 'm' between
// 'h' and 't'). Equal keys make sort order depend on a tiebreak — and with no tiebreak the
// two replicas can DIVERGE permanently (the one thing a CRDT must never do).
//
// Fix: store the order as a COMPOUND key `"<frac>#<siteId>"`. We compare by `<frac>` first,
// then by `<siteId>` — a deterministic, replica-independent tiebreak. `siteId` is any stable
// per-client string. Only the `<frac>` part participates in keyBetween's between-ness math.
const SEP = '#';
export const stripSite = (order) => (order == null ? '' : String(order).split(SEP)[0]);
const siteOf = (order) => {
  const s = String(order ?? '');
  const i = s.indexOf(SEP);
  return i === -1 ? '' : s.slice(i + 1);
};

export const keyBetween = (lo, hi) => {
  // Bounds may be COMPOUND keys ("<frac>#<site>"); only the fractional part participates in
  // the between-ness math, so strip any site tiebreaker first.
  // Treat empty/missing as an open end. Legacy itinerary rows predate `order` and carry ''
  // (or nothing); '' is not a real key, so coerce it to null ("open bound").
  const a = stripSite(lo) || null;
  const b = stripSite(hi) || null;
  if (a !== null && b !== null && a >= b) {
    throw new Error(`keyBetween: lower "${a}" must be < upper "${b}"`);
  }
  if (a === null && b === null) return chr(midDigit(MIN, MAX)); // 'm' — middle, max room
  if (a === null) return before(b);
  if (b === null) return after(a);
  return between(a, b);
};

// A key strictly greater than `a` (open upper bound). Invariant (3) guarantees `a` does not
// end in 'z', so we can always raise a digit and land in 'b'..'y'.
// Recurse from the LEFT, keeping the prefix. At the first digit with headroom below 'z' we
// emit a digit strictly above it (a higher first-differing digit ⇒ a greater string, so the
// discarded tail doesn't matter). If the digit is in the top region ('y'/'z'), there's no
// room there — keep it and recurse on the tail. Empty input ⇒ middle digit 'm'.
const after = (a) => {
  if (a.length === 0) return chr(midDigit(MIN, MAX)); // 'm'
  const d = val(a[0]);
  if (d <= MAX - 2) {
    // d is 'a'..'x': a usable digit ('b'..'y') sits strictly above it.
    return chr(Math.floor((d + 1 + MAX) / 2));
  }
  if (d === MAX - 1) {
    // d is 'y': nothing usable strictly between 'y' and 'z'. Step up to the 'z' boundary
    // (non-terminal) and append a middle digit. "zm..." > any "y..." since 'z' > 'y'.
    return chr(MAX) + chr(midDigit(MIN, MAX)); // e.g. after("y...") -> "zm"
  }
  // d is 'z' (MAX): keep it (non-terminal) and recurse — go deeper to find room above.
  return a[0] + after(a.slice(1));
};

// Symmetric: emit a digit strictly below the first digit with headroom above 'a'; otherwise
// (digit in the bottom region 'a'/'b') keep it and recurse. Empty input ⇒ 'm'.
const before = (b) => {
  if (b.length === 0) return chr(midDigit(MIN, MAX)); // 'm'
  const d = val(b[0]);
  if (d >= MIN + 2) {
    // d is 'c'..'z': a usable digit ('b'..'y') sits strictly below it. floor(d/2) is in
    // [1, d-1] for d>=2, so it's < d and never the 'a' boundary.
    return chr(midDigit(MIN, d));
  }
  if (d === MIN + 1) {
    // d is 'b': nothing usable strictly between 'a' and 'b'. Drop to the 'a' boundary
    // (non-terminal) and append a middle digit. "am..." < any "b..." since 'a' < 'b'.
    return chr(MIN) + chr(midDigit(MIN, MAX)); // e.g. before("b...") -> "am"
  }
  // d is 'a' (MIN): keep it (non-terminal) and recurse — go deeper to find room below.
  return b[0] + before(b.slice(1));
};

// A key strictly between two real keys a < b. Copy the shared prefix, then resolve at the
// first differing position; if the digits are adjacent, descend keeping `a`'s side.
const between = (a, b) => {
  let i = 0;
  let prefix = '';
  // Copy the common prefix.
  while (i < a.length && i < b.length && a[i] === b[i]) {
    prefix += a[i];
    i += 1;
  }
  // If `a` ran out on the shared prefix (a is a prefix of b, e.g. a="m", b="mam"), the only
  // constraint is "< the rest of b". Find a key strictly below b's remaining digits.
  if (i >= a.length) {
    return prefix + before(b.slice(i));
  }

  const da = val(a[i]);
  const db = val(b[i]); // b is strictly greater, so it has a digit here

  if (db - da > 1) {
    // Gap → a terminal digit strictly between them sits here (in 'b'..'y' since they differ
    // by >= 2 and lie within [MIN, MAX]).
    return prefix + chr(midDigit(da, db));
  }
  // Adjacent (db === da + 1): no room at this position. Keep `a`'s digit, then find a key
  // strictly ABOVE the remainder of `a` (open upper) — stays above a, still below b.
  return prefix + a[i] + after(a.slice(i + 1));
};

// Convenience: the order key that places a new item AFTER the current last item.
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

// Sort a list of {order, ...} items by their compound order key. Deterministic across
// replicas (the site tiebreak removes the last source of divergence). Final fallback on
// `id` keeps it stable even for legacy rows that share an (empty) key and no site.
export const sortByOrder = (items) =>
  [...items].sort((x, y) => {
    const c = compareOrder(x.order ?? '', y.order ?? '');
    if (c !== 0) return c;
    const ix = x.id ?? '';
    const iy = y.id ?? '';
    return ix < iy ? -1 : ix > iy ? 1 : 0;
  });

// ── REBALANCING ──────────────────────────────────────────────────────────────────────────
// Fractional keys only GROW when people repeatedly insert/move between the SAME two neighbours
// (each squeeze adds a character). At realistic scale this never bites — the fuzz test shows
// keys stay ~9 chars even after 40k inserts — but a pathological pattern (always drop a stop
// into the same gap, thousands of times) would let keys creep longer. Production fractional-
// index systems (Figma, Jira's LexoRank) periodically REBALANCE: rewrite every key to a fresh,
// evenly-spaced, short one, preserving the visible order. We do the same when a key crosses a
// length threshold. This is server-authoritative and broadcast as full state (NOT per-item
// moves), so it can't clobber a concurrent edit — clients just adopt the rebalanced order.
export const KEY_LENGTH_THRESHOLD = 12; // rebalance once any fractional key reaches this length

// True if any item's fractional key has grown past the threshold (time to rebalance).
export const needsRebalance = (items) =>
  items.some((it) => stripSite(it.order ?? '').length >= KEY_LENGTH_THRESHOLD);

// Generate `n` strictly-increasing, evenly-spaced fractional keys, none ending in 'a'/'z'.
// Picks the smallest digit width whose capacity (24^width, using digits 'b'..'y') exceeds n,
// then spreads n positions evenly across that space. Used to re-key a whole list compactly.
export const evenKeys = (n) => {
  if (n <= 0) return [];
  const LO = 1; // 'b'  (0='a' is a boundary marker, never a terminal)
  const SPAN = 24; // usable digits 'b'..'y'
  let width = 1;
  let capacity = SPAN;
  while (capacity < n + 1) { width += 1; capacity *= SPAN; }
  const out = [];
  for (let i = 1; i <= n; i += 1) {
    let pos = Math.round((i * capacity) / (n + 1)); // even spacing, avoids the 0/capacity edges
    pos = Math.min(capacity - 1, Math.max(1, pos));
    let key = '';
    for (let w = 0; w < width; w += 1) {
      key = chr(LO + (pos % SPAN)) + key; // shift each base-24 digit into 'b'..'y'
      pos = Math.floor(pos / SPAN);
    }
    out.push(key);
  }
  return out;
};

// Rebalance: return items re-keyed with fresh evenly-spaced compound keys, in their CURRENT
// sorted order, so the visible order is unchanged but keys are short again. `siteId` stamps the
// new keys (use the server's site — rebalancing is server-authoritative). Pure: returns a new
// array of { ...item, order }, leaving the caller to persist + broadcast as full state.
export const rebalanceOrders = (items, siteId = '') => {
  const sorted = sortByOrder(items);
  const fresh = evenKeys(sorted.length);
  return sorted.map((it, idx) => ({ ...it, order: makeOrder(fresh[idx], siteId) }));
};
