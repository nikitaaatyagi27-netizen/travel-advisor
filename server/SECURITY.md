# API Key Security

## The problem we fixed

In a Create React App, every `REACT_APP_*` variable is **baked into the public JS bundle**.
Anyone can open DevTools on the deployed site and read them. Originally the RapidAPI travel
key lived in the React app, so it was exposed to the world.

## The fix: a backend proxy

The RapidAPI key now lives **only** in `server/.env` (`RAPIDAPI_KEY`). The browser calls our
own endpoint instead of RapidAPI:

```
Browser → GET /api/places (our server) → server attaches the secret → RapidAPI
```

The key never reaches the browser. The proxy also caches responses, so repeated requests
for the same map area don't re-hit the paid API.

- Proxy route: `server/src/routes/places.js`
- Frontend caller: `src/api/travelAdvisorAPI.js` (now points at our backend)

## The Google Maps key is different — it CAN'T be proxied

The Google Maps JavaScript SDK runs **in the browser**, so its key *must* be present
client-side. You can't hide it. Instead you make a leaked key **useless to others** by
restricting it in Google Cloud Console:

1. Go to **Google Cloud Console → APIs & Services → Credentials**.
2. Click your Maps API key.
3. **Application restrictions** → **HTTP referrers (web sites)** → add:
   - `http://localhost:3000/*` (dev)
   - `https://your-deployed-domain.com/*` (prod)
   Now the key only works when called from YOUR sites.
4. **API restrictions** → **Restrict key** → enable only:
   - Maps JavaScript API
   - Places API
   This caps the damage if it's ever scraped.
5. (Optional) Set a **billing quota / budget alert** so a leaked key can't run up costs.

## Still to do (housekeeping)

- The old keys were committed to `.env` earlier in this project's history. They should be
  **rotated** (regenerated) in RapidAPI and Google Cloud, since the originals are compromised.
- `.env` files are now git-ignored (root `.gitignore` and `server/.gitignore`).
- The unused weather key was removed from the client; if you use it later, proxy it too.
