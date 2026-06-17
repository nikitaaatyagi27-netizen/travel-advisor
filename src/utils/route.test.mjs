// Correctness tests for route optimization. Run: node src/utils/route.test.mjs
//
// The load-bearing claim is "Held–Karp returns the OPTIMAL order" — so we verify it against
// brute force (trying every permutation) for small N, where brute force is feasible and is
// ground truth. We also check the large-N heuristic produces valid routes.

import { optimizeRoute, distanceMatrix } from './route.js';

let pass = 0;
let fail = 0;
const samples = [];
const ok = (cond, msg) => {
  if (cond) pass += 1;
  else { fail += 1; if (samples.length < 10) samples.push(msg); }
};

const permutations = (arr) => {
  if (arr.length <= 1) return [arr];
  const out = [];
  for (let i = 0; i < arr.length; i += 1) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const p of permutations(rest)) out.push([arr[i], ...p]);
  }
  return out;
};
const routeLen = (order, dist) => {
  let t = 0;
  for (let i = 1; i < order.length; i += 1) t += dist[order[i - 1]][order[i]];
  return t;
};
// Brute-force optimal open-path length, start fixed at 0 (same convention as Held–Karp).
const bruteOptimal = (stops) => {
  const dist = distanceMatrix(stops);
  const rest = [...Array(stops.length).keys()].slice(1);
  let best = Infinity;
  for (const p of permutations(rest)) best = Math.min(best, routeLen([0, ...p], dist));
  return best;
};
const randStops = (n) => Array.from({ length: n }, () => ({ lat: 28 + Math.random(), lng: 77 + Math.random() }));

// 1. Held–Karp == brute-force optimal across many random instances.
for (let n = 2; n <= 8; n += 1) {
  for (let trial = 0; trial < 40; trial += 1) {
    const stops = randStops(n);
    const r = optimizeRoute(stops);
    const brute = bruteOptimal(stops);
    ok(Math.abs(r.distance - brute) < 1e-6, `N=${n}: exact ${r.distance} != brute ${brute}`);
    const sorted = [...r.indices].sort((a, b) => a - b);
    ok(sorted.every((v, i) => v === i) && sorted.length === n, `N=${n}: indices not a permutation`);
    ok(r.method === 'exact', `N=${n}: expected exact method`);
  }
}

// 2. Large-N heuristic: valid permutation, finite distance, legs sum to total.
for (const n of [13, 20, 40]) {
  const stops = randStops(n);
  const r = optimizeRoute(stops);
  ok(r.method === 'heuristic', `N=${n}: expected heuristic method`);
  const sorted = [...r.indices].sort((a, b) => a - b);
  ok(sorted.every((v, i) => v === i), `N=${n}: heuristic not a permutation`);
  ok(Number.isFinite(r.distance) && r.distance > 0, `N=${n}: bad distance`);
  const legSum = r.legs.reduce((a, b) => a + b, 0);
  ok(Math.abs(legSum - r.distance) < 1e-6, `N=${n}: legs != distance`);
}

// 3. Colinear points are visited monotonically (the obvious optimal route).
{
  const stops = [{ lat: 0, lng: 0 }, { lat: 0, lng: 4 }, { lat: 0, lng: 1 }, { lat: 0, lng: 3 }, { lat: 0, lng: 2 }];
  const lngs = optimizeRoute(stops).order.map((s) => s.lng);
  const mono = lngs.every((v, i) => i === 0 || v >= lngs[i - 1]) || lngs.every((v, i) => i === 0 || v <= lngs[i - 1]);
  ok(mono, `colinear not monotonic: ${lngs}`);
}

// 4. Edge cases.
ok(optimizeRoute([]).distance === 0, 'empty');
ok(optimizeRoute([{ lat: 1, lng: 1 }]).distance === 0, 'single');
ok(optimizeRoute([{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }]).indices.length === 2, 'two stops');

if (samples.length) console.log(samples.join('\n'));
console.log(`route tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
