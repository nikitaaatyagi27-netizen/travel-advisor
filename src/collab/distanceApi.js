import { SERVER_URL } from './config';

// Ask the server for the FASTEST, traffic-aware optimized order (Stages 1+2): the server
// fetches live-traffic travel times from Google and runs the time-dependent re-evaluation
// loop + Held–Karp. `points[0]` is the start (origin); the rest are the stops.
// Returns { order, totalMinutes, totalKm, iterations, trafficAware } or null on failure
// (caller then falls back to the local straight-line optimizer so it never breaks).
export const optimizeViaServer = async (points) => {
  try {
    const res = await fetch(`${SERVER_URL}/api/distance-matrix/optimize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data.order) ? data : null;
  } catch {
    return null;
  }
};
