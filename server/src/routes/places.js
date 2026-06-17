import { Router } from 'express';

const router = Router();

// Simple in-memory TTL cache, keyed by the normalized request. This mirrors the
// client-side cache but at the server — so repeated requests from ANY user for the same
// map area are served without re-hitting the paid RapidAPI. (10 min TTL.)
const cache = new Map();
const TTL_MS = 10 * 60 * 1000;

const cacheKey = (type, p) =>
  `${type}-${p.bl_latitude}-${p.bl_longitude}-${p.tr_latitude}-${p.tr_longitude}`;

// GET /api/places?type=restaurants&bl_latitude=..&bl_longitude=..&tr_latitude=..&tr_longitude=..
//
// Proxies the Travel Advisor (RapidAPI) "list-in-boundary" endpoint. The RapidAPI key
// lives ONLY on the server (env var) and is never sent to the browser — fixing the key
// exposure that exists when the frontend calls RapidAPI directly.
router.get('/', async (req, res) => {
  const { type = 'restaurants', bl_latitude, bl_longitude, tr_latitude, tr_longitude } = req.query;

  if (!bl_latitude || !tr_latitude) {
    return res.status(400).json({ error: 'Missing map bounds' });
  }
  if (!['restaurants', 'attractions', 'hotels'].includes(type)) {
    return res.status(400).json({ error: 'Invalid type' });
  }

  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server is missing RAPIDAPI_KEY' });
  }

  const params = {
    bl_latitude, bl_longitude, tr_latitude, tr_longitude,
    limit: '30', currency: 'INR', lunit: 'km', lang: 'en_US',
  };

  const key = cacheKey(type, params);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.time < TTL_MS) {
    res.set('X-Cache', 'HIT');
    return res.json(hit.data);
  }

  try {
    const url = new URL(`https://travel-advisor.p.rapidapi.com/${type}/list-in-boundary`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

    const upstream = await fetch(url, {
      headers: {
        'x-rapidapi-key': apiKey,
        'x-rapidapi-host': 'travel-advisor.p.rapidapi.com',
      },
    });

    if (!upstream.ok) {
      return res.status(502).json({ error: `Upstream error ${upstream.status}` });
    }

    // Read as text first and parse defensively: RapidAPI sometimes returns an EMPTY 200
    // (quota/rate-limit hiccups), which crashes res.json() with "Unexpected end of JSON
    // input". Treat empty/unparseable bodies as "no places" rather than erroring out.
    const text = await upstream.text();
    if (!text.trim()) {
      return res.json([]); // empty area / transient empty response → no places
    }
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      console.warn('places proxy: non-JSON upstream body (first 120 chars):', text.slice(0, 120));
      return res.status(502).json({ error: 'Places provider returned an unexpected response' });
    }

    const places = (body?.data || []).filter(
      (place) => place.name && place.latitude && place.longitude
    );

    cache.set(key, { data: places, time: Date.now() });
    res.set('X-Cache', 'MISS');
    res.json(places);
  } catch (e) {
    console.error('places proxy failed:', e);
    res.status(502).json({ error: 'Could not reach places provider' });
  }
});

export default router;
