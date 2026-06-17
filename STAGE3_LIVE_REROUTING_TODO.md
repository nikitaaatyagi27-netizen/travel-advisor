# TODO — Stage 3: Live re-routing during the journey (DEFERRED)

> ⏳ Build this AFTER everything else. Deferred because it can only be validated with a real
> moving user (a phone in a car) — it does nothing at a desk. Stages 1 & 2 (fastest-time +
> live-traffic optimization, and the time-dependent re-evaluation loop) are built and work
> without this.

## What Stage 3 adds
Continuously track the user's GPS during an ACTIVE trip and re-optimize only when something
actually changed (avoid blind timer re-calls):

Re-optimization triggers:
- User deviates from the route by > 300 m
- Current leg is running 20%+ over its estimated time
- User marks a stop as complete
- 10 minutes have passed on a long leg

On a trigger: re-fetch only the affected legs → re-run Held–Karp with the updated matrix →
push the new order to the client.

## Why it's a different product
This turns the collaborative trip *planner* into a live turn-by-turn *navigation* app. It
needs: background geolocation watching, a notion of an "active journey," deviation detection,
and live UI. Most naturally a mobile concern. Revisit when there's a phone-in-car setup.

## What already exists to build on (from Stages 1 & 2)
- `server/src/routes/distance.js` — Google Distance Matrix proxy (add traffic via departure_time)
- `src/utils/route.js` — Held–Karp + the time-dependent re-evaluation loop
- `src/collab/distanceApi.js` — client fetch of the matrix
- Origin (user location) already captured in `CollabPanel` and threaded into optimize.
