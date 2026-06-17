import { Router } from 'express';
import { fetchGoogleMatrix } from '../googleMatrix.js';
import { orderByCost, pathCost } from '../route.js';

const router = Router();

// POST /api/distance-matrix  { points, departureTime? }
//   → { distance: N×N km, time: N×N minutes (traffic-aware) }
// Raw matrix (used as a fallback / direct lookup). The client falls back to haversine on error.
router.post('/', async (req, res) => {
  const { points, departureTime } = req.body || {};
  if (!Array.isArray(points) || points.length < 2 || points.length > 25) {
    return res.status(400).json({ error: 'Provide 2–25 points' });
  }
  try {
    const { distance, time } = await fetchGoogleMatrix(points, departureTime || 'now');
    res.json({ distance, time, mode: 'driving' });
  } catch (e) {
    console.error('distance-matrix failed:', e.message);
    res.status(502).json({ error: e.message });
  }
});

// POST /api/optimize-route  { points }   (index 0 = start/origin)
//   → { order: indices into points[1..] (the stops, origin excluded),
//       totalMinutes, totalKm, iterations, trafficAware: true }
//
// STAGE 2 — the time-dependent re-evaluation loop. A naive optimize times every leg as if you
// leave NOW. But you'll reach stop 3 in (say) 90 min, when traffic differs. So we iterate:
//   1) optimize on the current time matrix
//   2) compute each leg's PREDICTED departure (now + sum of earlier legs)
//   3) re-fetch the matrix at a representative future departure time
//   4) re-optimize; if the order is unchanged, stop (else repeat, capped)
// This is the part Google's API doesn't do for you — the actual "intelligence".
router.post('/optimize', async (req, res) => {
  const { points } = req.body || {};
  if (!Array.isArray(points) || points.length < 2 || points.length > 25) {
    return res.status(400).json({ error: 'Provide 2–25 points (index 0 = start)' });
  }

  const MAX_ITERS = 3;
  const nowSec = Math.floor(Date.now() / 1000);

  try {
    let departureTime = 'now';
    let order = null;
    let result = null;
    let iterations = 0;

    for (let iter = 0; iter < MAX_ITERS; iter += 1) {
      iterations = iter + 1;
      const { distance, time } = await fetchGoogleMatrix(points, departureTime);
      const newOrder = orderByCost(time); // optimize by TRAVEL TIME (traffic-aware)
      result = {
        distance,
        time,
        totalMinutes: pathCost(newOrder, time),
        totalKm: pathCost(newOrder, distance),
        rawOrder: newOrder,
      };

      // Converged: the order didn't change from the previous iteration → done.
      if (order && newOrder.join(',') === order.join(',')) { order = newOrder; break; }
      order = newOrder;

      // Predict when we'd START the journey's *middle* leg, and re-fetch traffic for then.
      // (Distance Matrix takes ONE departure_time for the whole matrix, so we use a
      // representative future time — the moment we'd set off on roughly the mid stop.)
      const half = Math.floor(order.length / 2);
      let minutesUntilMid = 0;
      for (let i = 1; i <= half; i += 1) minutesUntilMid += time[order[i - 1]][order[i]];
      departureTime = nowSec + Math.round(minutesUntilMid * 60);
    }

    // Exclude the origin (index 0) from the returned order, and shift to refer to the
    // caller's stop list (points[1..]).
    const stopsOrder = order.filter((i) => i !== 0).map((i) => i - 1);
    res.json({
      order: stopsOrder,
      totalMinutes: result.totalMinutes,
      totalKm: result.totalKm,
      iterations,
      trafficAware: true,
    });
  } catch (e) {
    console.error('optimize-route failed:', e.message);
    res.status(502).json({ error: e.message });
  }
});

export default router;
