// PARITY TEST: the client copy (src/collab/fracdex.js) and the server copy
// (server/src/fracdex.js) are hand-duplicated because the two halves of the app don't share
// a module. This test imports BOTH and asserts they produce byte-identical results across a
// large shared vector — so the two can never silently drift (fix #6). If this fails, someone
// edited one fracdex.js without mirroring the change into the other.
//
// Run: node server/test/fracdex.parity.mjs   (exit 0 = the two copies agree)

import * as server from '../src/fracdex.js';
import * as client from '../../src/collab/fracdex.js';

let checks = 0;
let failures = 0;
const samples = [];
const eq = (a, b, label) => {
  checks += 1;
  // Compare both success values and thrown-error behaviour.
  let ra, rb, ea = null, eb = null;
  try { ra = a(); } catch (e) { ea = e.message; }
  try { rb = b(); } catch (e) { eb = e.message; }
  const ok = ra === rb && (!!ea === !!eb);
  if (!ok) {
    failures += 1;
    if (samples.length < 15) samples.push(`${label}: server=${ea ? `throw(${ea})` : ra} client=${eb ? `throw(${eb})` : rb}`);
  }
};

// Deterministic pseudo-random so failures reproduce.
let seed = 1234567;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

// 1. keyBetween / keyAfterLast parity by maintaining a sorted list with both impls in lockstep.
{
  let list = [server.keyBetween(null, null)];
  // sanity: both produce 'm' for the open/open case
  eq(() => server.keyBetween(null, null), () => client.keyBetween(null, null), 'open/open');
  for (let n = 0; n < 20000; n += 1) {
    list.sort();
    const idx = Math.floor(rnd() * (list.length + 1));
    const lo = list[idx - 1] ?? null;
    const hi = list[idx] ?? null;
    eq(() => server.keyBetween(lo, hi), () => client.keyBetween(lo, hi), `keyBetween(${lo},${hi})`);
    // Advance the list using the server impl (client is asserted identical, so it's safe).
    try { list.push(server.keyBetween(lo, hi)); } catch { /* skip invalid bound */ }
  }
}

// 2. keyAfterLast parity on a deep chain.
{
  let k = null;
  for (let n = 0; n < 5000; n += 1) {
    const cur = k;
    eq(() => server.keyAfterLast(cur), () => client.keyAfterLast(cur), `keyAfterLast(${cur})`);
    k = server.keyAfterLast(cur);
  }
}

// 3. makeOrder + compareOrder + sortByOrder parity on compound keys.
{
  const sites = ['', 'a', 'bob', 'site42', 'z9'];
  const frics = ['m', 'h', 't', 'mm', 'zz', 'am', 'mn'];
  const orders = [];
  for (const f of frics) for (const s of sites) {
    eq(() => server.makeOrder(f, s), () => client.makeOrder(f, s), `makeOrder(${f},${s})`);
    orders.push(server.makeOrder(f, s));
  }
  for (let i = 0; i < orders.length; i += 1) {
    for (let j = 0; j < orders.length; j += 1) {
      const a = orders[i], b = orders[j];
      eq(() => Math.sign(server.compareOrder(a, b)), () => Math.sign(client.compareOrder(a, b)), `compareOrder(${a},${b})`);
    }
  }
  const items = orders.map((o, i) => ({ id: String(i), order: o }));
  eq(
    () => server.sortByOrder(items).map((x) => x.id).join(','),
    () => client.sortByOrder(items).map((x) => x.id).join(','),
    'sortByOrder',
  );
}

if (samples.length) console.log(samples.join('\n'));
console.log(`\nfracdex parity: ${checks - failures}/${checks} checks identical, ${failures} differ`);
process.exit(failures ? 1 : 0);
