// Server-side route optimization (Held–Karp exact + nearest-neighbor/2-opt heuristic),
// operating on a PRECOMPUTED cost matrix (travel time in minutes, or distance). Mirrors the
// client's src/utils/route.js ordering math, but here it runs the time-dependent re-evaluation
// loop because that makes repeated Google calls (must be server-side).
//
// The cost matrix is N×N where index 0 is the fixed start (origin). An OPEN path: start at 0,
// visit all others, don't return.

const EXACT_LIMIT = 13;

const pathCost = (order, cost) => {
  let t = 0;
  for (let i = 1; i < order.length; i += 1) t += cost[order[i - 1]][order[i]];
  return t;
};

// Held–Karp: exact optimal open path starting at index 0.
const heldKarp = (cost) => {
  const n = cost.length;
  const FULL = (1 << n) - 1;
  const dp = Array.from({ length: 1 << n }, () => new Array(n).fill(Infinity));
  const parent = Array.from({ length: 1 << n }, () => new Array(n).fill(-1));
  dp[1][0] = 0;
  for (let mask = 1; mask <= FULL; mask += 1) {
    if (!(mask & 1)) continue;
    for (let j = 0; j < n; j += 1) {
      if (dp[mask][j] === Infinity || !(mask & (1 << j))) continue;
      for (let k = 0; k < n; k += 1) {
        if (mask & (1 << k)) continue;
        const nm = mask | (1 << k);
        const cand = dp[mask][j] + cost[j][k];
        if (cand < dp[nm][k]) { dp[nm][k] = cand; parent[nm][k] = j; }
      }
    }
  }
  let best = Infinity; let end = 0;
  for (let j = 0; j < n; j += 1) if (dp[FULL][j] < best) { best = dp[FULL][j]; end = j; }
  const order = []; let mask = FULL; let j = end;
  while (j !== -1) { order.push(j); const pj = parent[mask][j]; mask &= ~(1 << j); j = pj; }
  return order.reverse();
};

const nearestNeighbor = (cost) => {
  const n = cost.length; const visited = new Array(n).fill(false); const order = [0];
  visited[0] = true;
  for (let s = 1; s < n; s += 1) {
    const last = order[order.length - 1]; let bk = -1; let bd = Infinity;
    for (let k = 0; k < n; k += 1) if (!visited[k] && cost[last][k] < bd) { bd = cost[last][k]; bk = k; }
    order.push(bk); visited[bk] = true;
  }
  return order;
};

const twoOpt = (order, cost) => {
  const r = [...order]; const n = r.length; let improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < n - 1; i += 1) {
      for (let k = i + 1; k < n; k += 1) {
        const a = r[i - 1]; const b = r[i]; const c = r[k]; const d = r[k + 1];
        let delta = cost[a][c] - cost[a][b];
        if (d !== undefined) delta += cost[b][d] - cost[c][d];
        if (delta < -1e-9) { let lo = i; let hi = k; while (lo < hi) { [r[lo], r[hi]] = [r[hi], r[lo]]; lo += 1; hi -= 1; } improved = true; }
      }
    }
  }
  return r;
};

// Optimal visiting order over a cost matrix (index 0 = fixed start). Returns indices.
export const orderByCost = (cost) => {
  if (cost.length <= EXACT_LIMIT) return heldKarp(cost);
  return twoOpt(nearestNeighbor(cost), cost);
};

export { pathCost, EXACT_LIMIT };
