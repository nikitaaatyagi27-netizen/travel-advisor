// Property-based fuzz test for the fractional-index ordering primitive.
//
// This is the safety net for a hand-rolled CRDT primitive: example tests are not enough
// (an earlier version passed them and still produced duplicate keys under load). We assert
// the INVARIANTS from fracdex.js hold across tens of thousands of random operations:
//
//   (1) BETWEEN:     a < K < b
//   (2) NON-EMPTY:   K.length >= 1
//   (3) TERMINAL:    K never ends in 'a' or 'z'   (the rule that guarantees injectivity)
//   (4) NO COLLISION: maintaining a real list via insert/move never yields two equal keys
//
// Run: node server/test/fracdex.fuzz.mjs   (exit 0 = all invariants held)

import { keyBetween, keyAfterLast, sortByOrder, makeOrder, compareOrder } from '../src/fracdex.js';

let checks = 0;
let failures = 0;
const samples = [];
const fail = (msg) => {
  failures += 1;
  if (samples.length < 15) samples.push(msg);
};
const assert = (cond, msg) => {
  checks += 1;
  if (!cond) fail(msg);
};

const endsBad = (k) => k.length > 0 && (k[k.length - 1] === 'a' || k[k.length - 1] === 'z');

// Check the three single-call invariants for one keyBetween result.
const checkKey = (a, b, k) => {
  assert(k.length >= 1, `(2) empty key for (${a},${b})`);
  assert(a === null || a < k, `(1) lower: ${a} !< ${k}`);
  assert(b === null || k < b, `(1) upper: ${k} !< ${b}`);
  assert(!endsBad(k), `(3) terminal 'a'/'z': ${k} for (${a},${b})`);
};

const RUNAWAY = 4000; // a correct impl keeps keys short; guard against accidental blowup

// ── 1. Right-edge squeeze: repeatedly insert just before the upper bound ──────────────────
{
  let lo = keyBetween(null, null);
  let hi = keyAfterLast(lo);
  for (let n = 0; n < 5000; n += 1) {
    const k = keyBetween(lo, hi);
    if (k.length > RUNAWAY) { fail(`runaway R len=${k.length}`); break; }
    checkKey(lo, hi, k);
    hi = k;
  }
}

// ── 2. Left-edge squeeze: repeatedly insert just after the lower bound ────────────────────
{
  let lo = keyBetween(null, null);
  let hi = keyAfterLast(lo);
  for (let n = 0; n < 5000; n += 1) {
    const k = keyBetween(lo, hi);
    if (k.length > RUNAWAY) { fail(`runaway L len=${k.length}`); break; }
    checkKey(lo, hi, k);
    lo = k;
  }
}

// ── 3. Repeated front insert (open lower bound) ───────────────────────────────────────────
{
  let front = keyBetween(null, null);
  for (let n = 0; n < 5000; n += 1) {
    const k = keyBetween(null, front);
    if (k.length > RUNAWAY) { fail(`runaway front len=${k.length}`); break; }
    checkKey(null, front, k);
    front = k;
  }
}

// ── 4. Repeated end insert (open upper bound) ─────────────────────────────────────────────
{
  let end = keyBetween(null, null);
  for (let n = 0; n < 5000; n += 1) {
    const k = keyAfterLast(end);
    if (k.length > RUNAWAY) { fail(`runaway end len=${k.length}`); break; }
    checkKey(end, null, k);
    end = k;
  }
}

const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
const assertSortedUnique = (orders, label) => {
  for (let i = 1; i < orders.length; i += 1) {
    assert(orders[i - 1] < orders[i], `(4) ${label} not strictly increasing: ${orders[i - 1]} / ${orders[i]}`);
  }
};

// ── 5. Realistic INSERT churn: maintain a sorted list, insert between real neighbours ─────
{
  let list = [{ order: keyBetween(null, null) }];
  for (let n = 0; n < 20000; n += 1) {
    list.sort((p, q) => cmp(p.order, q.order));
    const idx = Math.floor(Math.random() * (list.length + 1));
    const before = list[idx - 1]?.order ?? null;
    const after = list[idx]?.order ?? null;
    let k;
    try { k = keyBetween(before, after); } catch (e) { fail(`(4) insert throw (${before},${after}): ${e.message}`); break; }
    checkKey(before, after, k);
    list.push({ order: k });
  }
  list.sort((p, q) => cmp(p.order, q.order));
  assertSortedUnique(list.map((x) => x.order), 'insert-churn');
}

// ── 6. Realistic MOVE churn: reorder existing items (the core CRDT operation) ─────────────
{
  let list = [];
  for (let n = 0; n < 30; n += 1) {
    const last = sortByOrder(list).at(-1);
    list.push({ id: n, order: keyAfterLast(last?.order || null) });
  }
  for (let n = 0; n < 20000; n += 1) {
    const sorted = sortByOrder(list);
    const pick = sorted[Math.floor(Math.random() * sorted.length)];
    const without = sorted.filter((x) => x.id !== pick.id);
    const tgt = Math.floor(Math.random() * (without.length + 1));
    const before = without[tgt - 1]?.order ?? null;
    const after = without[tgt]?.order ?? null;
    if (before !== null && after !== null && before >= after) { fail(`(4) move neighbours not ordered ${before}/${after}`); break; }
    let k;
    try { k = keyBetween(before, after); } catch (e) { fail(`(4) move throw (${before},${after}): ${e.message}`); break; }
    checkKey(before, after, k);
    pick.order = k;
  }
  assertSortedUnique(sortByOrder(list).map((x) => x.order), 'move-churn');
}

// ── 7. Concurrent merge: two people move two DIFFERENT items from the same snapshot ───────
{
  const X = keyBetween(null, null);
  const Y = keyAfterLast(X);
  const Z = keyAfterLast(Y);
  const zNew = keyBetween(null, X); // Priya: Z -> front
  const xNew = keyAfterLast(Z);     // Aman:  X -> end
  const merged = [
    { id: 'X', order: xNew },
    { id: 'Y', order: Y },
    { id: 'Z', order: zNew },
  ];
  const result = sortByOrder(merged).map((i) => i.id).join('');
  assert(result === 'ZYX', `(merge) expected ZYX, got ${result}`);
}

// ── 8. Explicit INJECTIVITY: the exact property the first prototype violated. Across many
//      random (a, b) neighbour pairs drawn from a growing key set, keyBetween must never
//      return a key already present (i.e. it can't map two different requests onto one key).
{
  let list = [{ order: keyBetween(null, null) }];
  const seen = new Set(list.map((x) => x.order));
  let maxLen = 1;
  for (let n = 0; n < 40000; n += 1) {
    list.sort((p, q) => cmp(p.order, q.order));
    const idx = Math.floor(Math.random() * (list.length + 1));
    const before = list[idx - 1]?.order ?? null;
    const after = list[idx]?.order ?? null;
    let k;
    try { k = keyBetween(before, after); } catch (e) { fail(`(8) throw (${before},${after}): ${e.message}`); break; }
    assert(!seen.has(k), `(8) COLLISION: ${k} already exists (neighbours ${before}/${after})`);
    seen.add(k);
    list.push({ order: k });
    if (k.length > maxLen) maxLen = k.length;
  }
  // A correct impl keeps keys compact even after 40k inserts (no pathological growth).
  assert(maxLen < 200, `(8) key length grew to ${maxLen} (possible inefficiency)`);
  console.log(`injectivity: 40000 inserts, ${seen.size} unique keys, max key length ${maxLen}`);
}

// ── 9. COMPOUND-KEY TIEBREAK: two sites mint the SAME fractional key from the same snapshot.
//      Without a tiebreak the two items have equal keys and the order is undefined / can
//      diverge across replicas. With compound keys, compareOrder must give a TOTAL order
//      (the site id breaks the tie) and every replica must agree. ──────────────────────────
{
  // Two clients, same snapshot [A=h, C=t], both move their item between A and C → both pick
  // the same fractional key 'm'. Compound keys keep them distinct and deterministically sorted.
  const fA = keyBetween(null, null);          // 'm'
  const A = makeOrder(fA, 'siteA');
  const C = makeOrder(keyAfterLast(fA), 'siteC');
  const fracBetween = keyBetween(A, C);        // same frac both clients would compute
  const fromAlice = makeOrder(fracBetween, 'alice');
  const fromBob = makeOrder(fracBetween, 'bob');
  assert(compareOrder(fromAlice, fromBob) !== 0, '(9) compound keys with same frac must not tie');
  assert(compareOrder(fromAlice, fromBob) === -compareOrder(fromBob, fromAlice), '(9) compareOrder must be antisymmetric');

  // Both replicas sort the SAME three items and must agree on the final order.
  const items = [{ id: '1', order: A }, { id: '2', order: fromAlice }, { id: '3', order: fromBob }, { id: '4', order: C }];
  const r1 = sortByOrder(items).map((i) => i.id).join('');
  const r2 = sortByOrder([...items].reverse()).map((i) => i.id).join(''); // different input order
  assert(r1 === r2, `(9) replicas diverged: ${r1} vs ${r2}`);
}

// ── 10. TOTAL ORDER under heavy collision: many sites repeatedly minting keys between the
//        same neighbours. compareOrder must remain a strict total order (no two distinct
//        compound keys compare equal; comparison is consistent). ──────────────────────────
{
  const sites = ['a', 'b', 'c', 'd', 'e'];
  const lo = makeOrder(keyBetween(null, null), 'x');
  const hi = makeOrder(keyAfterLast('m'), 'x');
  const keys = new Set();
  for (let n = 0; n < 5000; n += 1) {
    const site = sites[n % sites.length] + (n % 97); // vary site id
    const k = makeOrder(keyBetween(lo, hi), site);
    keys.add(k);
  }
  const arr = [...keys];
  for (let i = 0; i < arr.length; i += 1) {
    for (let j = i + 1; j < Math.min(arr.length, i + 20); j += 1) {
      assert(compareOrder(arr[i], arr[j]) !== 0, `(10) distinct compound keys tied: ${arr[i]} / ${arr[j]}`);
    }
  }
}

if (samples.length) console.log(samples.join('\n'));
console.log(`\nfracdex fuzz: ${checks - failures}/${checks} checks passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
