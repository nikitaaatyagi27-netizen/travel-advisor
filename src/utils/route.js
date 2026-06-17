// Route optimization for an itinerary's stops — the Travelling Salesman Problem (TSP):
// given a set of stops, find the visiting order that minimizes total travel.
//
// TSP is NP-hard, but a day's itinerary is small, so we use the right tool for the size:
//   • N <= EXACT_LIMIT  → Held–Karp dynamic programming: returns the PROVABLY OPTIMAL order
//                          (O(n^2 · 2^n) time — instant for ~12 stops).
//   • larger            → nearest-neighbor + 2-opt heuristic: a near-optimal order, fast at
//                          any size (the exact method would take longer than the universe).
//
// Distance metric here is the haversine great-circle distance from lat/lng — zero API calls,
// works offline, good enough to prove the routing. Swapping in real driving time later means
// only replacing `distanceMatrix` with a Distance Matrix API result of the same shape.

const EXACT_LIMIT = 12; // Held–Karp stays instant up to ~12–13 stops; beyond, use heuristic.
const EARTH_KM = 6371;

const toRad = (deg) => (deg * Math.PI) / 180;

// Great-circle distance between two {lat, lng} points, in kilometers.
export const haversine = (a, b) => {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
};

// N×N symmetric distance matrix for a list of {lat, lng} stops.
export const distanceMatrix = (stops) =>
  stops.map((a) => stops.map((b) => haversine(a, b)));

// Total length of a route (an array of indices) given a distance matrix. Open path:
// we do NOT return to the start (a sightseeing day ends where it ends).
const routeLength = (order, dist) => {
  let total = 0;
  for (let i = 1; i < order.length; i += 1) total += dist[order[i - 1]][order[i]];
  return total;
};

// ── Held–Karp: exact optimal open-path TSP via DP over subsets ────────────────────────────
// dp[mask][j] = length of the shortest path that starts at stop 0, visits exactly the stops
// in `mask`, and ends at stop j. We build masks from small to large; the answer is the best
// dp[full][j] over all j. `parent` lets us reconstruct the order. Start is fixed at index 0
// (the route is an order of the SAME stops, so anchoring the start loses no generality for an
// open path — every ordering is reachable by relabeling, and fixing one end halves the work).
const heldKarp = (dist) => {
  const n = dist.length;
  const FULL = (1 << n) - 1;
  const INF = Infinity;
  // dp and parent indexed by [mask][j].
  const dp = Array.from({ length: 1 << n }, () => new Array(n).fill(INF));
  const parent = Array.from({ length: 1 << n }, () => new Array(n).fill(-1));

  dp[1][0] = 0; // start: only stop 0 visited, ending at 0, zero distance

  for (let mask = 1; mask <= FULL; mask += 1) {
    if (!(mask & 1)) continue; // every path starts at stop 0, so bit 0 must be set
    for (let j = 0; j < n; j += 1) {
      if (dp[mask][j] === INF) continue;
      if (!(mask & (1 << j))) continue;
      // Extend the path to an unvisited stop k.
      for (let k = 0; k < n; k += 1) {
        if (mask & (1 << k)) continue;
        const nextMask = mask | (1 << k);
        const cand = dp[mask][j] + dist[j][k];
        if (cand < dp[nextMask][k]) {
          dp[nextMask][k] = cand;
          parent[nextMask][k] = j;
        }
      }
    }
  }

  // Best endpoint over the full set.
  let best = INF;
  let end = 0;
  for (let j = 0; j < n; j += 1) {
    if (dp[FULL][j] < best) {
      best = dp[FULL][j];
      end = j;
    }
  }

  // Reconstruct the order by walking parents back from the best endpoint.
  const order = [];
  let mask = FULL;
  let j = end;
  while (j !== -1) {
    order.push(j);
    const pj = parent[mask][j];
    mask &= ~(1 << j);
    j = pj;
  }
  order.reverse();
  return { order, distance: best };
};

// ── Nearest-neighbor: greedy construction (start at 0, always go to the closest unvisited) ─
const nearestNeighbor = (dist) => {
  const n = dist.length;
  const visited = new Array(n).fill(false);
  const order = [0];
  visited[0] = true;
  for (let step = 1; step < n; step += 1) {
    const last = order[order.length - 1];
    let bestK = -1;
    let bestD = Infinity;
    for (let k = 0; k < n; k += 1) {
      if (!visited[k] && dist[last][k] < bestD) {
        bestD = dist[last][k];
        bestK = k;
      }
    }
    order.push(bestK);
    visited[bestK] = true;
  }
  return order;
};

// ── 2-opt: repeatedly reverse a segment if doing so shortens the route (uncrosses edges) ──
const twoOpt = (order, dist) => {
  const route = [...order];
  const n = route.length;
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < n - 1; i += 1) {
      for (let k = i + 1; k < n; k += 1) {
        // Cost change of reversing route[i..k]. For an open path, compare the two boundary
        // edges before vs after the reversal (interior edge lengths are unchanged).
        const a = route[i - 1];
        const b = route[i];
        const c = route[k];
        const d = route[k + 1];
        let delta = 0;
        if (a !== undefined) delta += dist[a][c] - dist[a][b];
        if (d !== undefined) delta += dist[b][d] - dist[c][d];
        if (delta < -1e-9) {
          // Reverse the segment in place.
          let lo = i;
          let hi = k;
          while (lo < hi) {
            [route[lo], route[hi]] = [route[hi], route[lo]];
            lo += 1;
            hi -= 1;
          }
          improved = true;
        }
      }
    }
  }
  return route;
};

// Optimize the visiting order of `stops` ({ lat, lng, ... }).
//
// `origin` (optional {lat,lng}) is the route's STARTING point — typically the user's current
// location. It matters a lot: without it, the optimizer only minimizes distance BETWEEN the
// stops and has no reason to prefer one end as the start, so with 2 stops it can't tell
// "A→B" from "B→A". With an origin, the route is computed as origin → stops, so the nearest
// stop to where you are comes first (e.g. from Muzaffarnagar, Noida (on the way) before Delhi).
// The origin is used only to anchor the ordering; it's NOT included in the returned stops.
//
// Returns { order, indices, distance, legs, method } where order/indices refer to `stops`.
// `matrix` (optional) is a pre-computed N×N distance matrix for [origin?, ...stops] in the
// same point order we build below — pass real ROAD distances (Google Distance Matrix) here
// for accurate ordering. If omitted, we fall back to straight-line haversine.
export const optimizeRoute = (stops, origin = null, matrix = null) => {
  if (!stops || stops.length < 2) {
    return { order: stops || [], indices: stops ? stops.map((_, i) => i) : [], distance: 0, legs: [], method: 'exact' };
  }

  // Build the point list the TSP runs on. If we have an origin, it's the fixed start at
  // index 0; Held–Karp already anchors the path at index 0, so this Just Works.
  const points = origin ? [{ lat: origin.lat, lng: origin.lng }, ...stops] : stops;
  // Use the provided road-distance matrix if its size matches; else compute haversine.
  const dist = (matrix && matrix.length === points.length) ? matrix : distanceMatrix(points);
  let routeIdx; // order as indices into `points`
  let method;

  if (points.length <= EXACT_LIMIT) {
    routeIdx = heldKarp(dist).order;
    method = 'exact';
  } else {
    routeIdx = twoOpt(nearestNeighbor(dist), dist);
    method = 'heuristic';
  }

  const legs = [];
  for (let i = 1; i < routeIdx.length; i += 1) {
    legs.push(dist[routeIdx[i - 1]][routeIdx[i]]);
  }
  const distance = routeLength(routeIdx, dist);

  // If an origin was prepended, drop it (index 0) from the result and shift indices back
  // so they refer to the original `stops` array.
  const stopRouteIdx = origin
    ? routeIdx.filter((i) => i !== 0).map((i) => i - 1)
    : routeIdx;

  return {
    order: stopRouteIdx.map((i) => stops[i]),
    indices: stopRouteIdx,
    distance, // includes the origin→first-stop leg when an origin is given
    legs,
    method,
  };
};

export { EXACT_LIMIT };
