import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import { SERVER_URL } from './config';
import { keyBetween, keyAfterLast, sortByOrder, makeOrder } from './fracdex';
import { optimizeRoute } from '../utils/route';
import { optimizeViaServer } from './distanceApi';

// A stable, per-browser-tab site id used to tiebreak fractional-index keys this client mints.
// Random + short; uniqueness across collaborators is all we need (it only breaks frac ties).
const mySiteId = Math.random().toString(36).slice(2, 8);

// Owns the realtime connection for a single trip and all shared collaborative state.
//
// Returns the live shared state (pins, itinerary, presence, you) plus action functions
// the UI calls to mutate that state. Every action emits a socket event; the server
// persists + broadcasts, and our listeners fold the result back into state — so the
// local user and remote users converge on the same view.
//
// `code` null  → not in a trip (collab mode off, hook stays idle).
export const useCollabTrip = (code, name) => {
  const socketRef = useRef(null);

  const [connected, setConnected] = useState(false);
  const [pins, setPins] = useState([]);
  const [itinerary, setItinerary] = useState([]);
  const [members, setMembers] = useState([]);
  const [you, setYou] = useState(null);
  const [error, setError] = useState(null);

  // The viewport we're currently mirroring when "following" a friend (or null).
  const [followViewport, setFollowViewport] = useState(null);
  const [followingName, setFollowingName] = useState(null);

  // Last shared-state `version` we've applied. Every server broadcast carries the trip's new
  // version; if one arrives more than 1 ahead of this, we missed an event (dropped on a flaky
  // link) and ask for a full resync. `-1` = nothing applied yet (haven't seen trip:state).
  const versionRef = useRef(-1);
  // Actions emitted while the socket was disconnected. Replayed in order on reconnect so a
  // brief drop (e.g. phone in a tunnel) doesn't silently lose the user's edits.
  const outboxRef = useRef([]);

  // Emit now if connected, else queue for replay on reconnect. The server is the source of
  // truth, so re-applying a queued action after a resync is safe (adds dedupe by id; a move
  // just re-sets one key; a remove of an already-gone item is a no-op).
  const sendOrQueue = useCallback((event, payload) => {
    const socket = socketRef.current;
    if (socket && socket.connected) socket.emit(event, payload);
    else outboxRef.current.push({ event, payload });
  }, []);

  useEffect(() => {
    if (!code || !name) return undefined;

    const socket = io(SERVER_URL, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    // On (re)connect, (re)join and flush any actions queued while we were offline. trip:join
    // triggers a fresh trip:state, which re-bases our version — so replayed actions land on
    // top of authoritative state.
    socket.on('connect', () => {
      setConnected(true);
      socket.emit('trip:join', { code, name });
      const queued = outboxRef.current;
      outboxRef.current = [];
      queued.forEach(({ event, payload }) => socket.emit(event, payload));
    });
    socket.on('disconnect', () => setConnected(false));

    // Apply a version stamp from a broadcast. Returns false if this event is STALE (older than
    // what we've applied — ignore it) and triggers a resync if we detect a GAP (missed event).
    const applyVersion = (v) => {
      if (typeof v !== 'number') return true; // event without a version → always apply
      if (v <= versionRef.current) return false; // stale/duplicate → ignore
      if (v > versionRef.current + 1 && versionRef.current !== -1) {
        // Missed at least one event — our optimistic state may be wrong. Get authoritative
        // state; the resulting trip:state resets versionRef cleanly.
        socket.emit('trip:resync');
      }
      versionRef.current = v;
      return true;
    };

    // Initial + full shared state for this trip (also the resync reply). Authoritative: it
    // resets our version and replaces local optimistic state wholesale.
    socket.on('trip:state', (state) => {
      setPins(state.pins || []);
      setItinerary(sortByOrder(state.itinerary || []));
      if (state.you) setYou(state.you);
      versionRef.current = typeof state.version === 'number' ? state.version : 0;
    });
    socket.on('trip:error', ({ message }) => setError(message));

    // Pins.
    socket.on('pin:added', (pin) =>
      setPins((prev) => (prev.some((p) => p.id === pin.id) ? prev : [...prev, pin]))
    );
    socket.on('pin:removed', ({ pinId }) =>
      setPins((prev) => prev.filter((p) => p.id !== pinId))
    );

    // Itinerary — granular actions, kept sorted by each item's fractional-index `order`.
    // The server is the source of truth for `order`, so we reconcile our optimistic state
    // with whatever it broadcasts (including for our own edits). The server's copy is
    // authoritative and CONFIRMED, so it replaces any optimistic/unconfirmed local copy.
    socket.on('itinerary:item-added', ({ version, ...item }) => {
      if (!applyVersion(version)) return; // stale/duplicate broadcast — ignore
      setItinerary((prev) =>
        prev.some((i) => i.id === item.id)
          ? sortByOrder(prev.map((i) => (i.id === item.id ? item : i))) // confirm provisional
          : sortByOrder([...prev, item])
      );
    });
    socket.on('itinerary:item-removed', ({ itemId, version }) => {
      if (!applyVersion(version)) return;
      setItinerary((prev) => prev.filter((i) => i.id !== itemId));
    });
    socket.on('itinerary:item-moved', ({ id, order, version }) => {
      if (!applyVersion(version)) return;
      setItinerary((prev) =>
        sortByOrder(prev.map((i) => (i.id === id ? { ...i, order, unconfirmed: false } : i)))
      );
    });

    // Presence.
    socket.on('presence:update', (list) => setMembers(list || []));

    // A friend moved their map — if we're following them, mirror it.
    socket.on('viewport:changed', ({ name: who, center, zoom }) => {
      setFollowingName((current) => {
        if (current === who) setFollowViewport({ center, zoom });
        return current;
      });
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [code, name]);

  // --- Actions ---

  const addPin = useCallback((pin) => {
    sendOrQueue('pin:add', { pin });
  }, [sendOrQueue]);

  const removePin = useCallback((pinId) => {
    sendOrQueue('pin:remove', { pinId });
  }, [sendOrQueue]);

  // Keep a live ref to the current itinerary so move/add can read neighbors without
  // being re-created on every list change (and without stale-closure bugs).
  const itineraryRef = useRef(itinerary);
  useEffect(() => { itineraryRef.current = itinerary; }, [itinerary]);

  // Add a stop to the end. The server assigns the real `order` and broadcasts it back; we
  // optimistically append with a PROVISIONAL compound key so it appears instantly. It's
  // marked `unconfirmed: true` until the server's broadcast confirms it — the UI can dim it,
  // and a move shouldn't fully trust its provisional neighbours (the server may re-key it).
  const addItineraryItem = useCallback((item) => {
    const list = itineraryRef.current;
    if (list.some((i) => i.id === item.id)) return;
    const frac = keyAfterLast(sortByOrder(list).at(-1)?.order || null);
    const provisional = { ...item, order: makeOrder(frac, mySiteId), unconfirmed: true };
    setItinerary((prev) => sortByOrder([...prev, provisional]));
    sendOrQueue('itinerary:add', { item });
  }, [sendOrQueue]);

  const removeItineraryItem = useCallback((itemId) => {
    setItinerary((prev) => prev.filter((i) => i.id !== itemId));
    sendOrQueue('itinerary:remove', { itemId });
  }, [sendOrQueue]);

  // Move the item to sit at `targetIndex` in the CURRENT sorted list. We compute a new
  // fractional-index key between that slot's neighbors and stamp our site id onto it — so if
  // another client picks the same fractional key from the same snapshot, the site tiebreak
  // keeps every replica's order identical. Changes only this item's order.
  const moveItineraryItem = useCallback((itemId, targetIndex) => {
    const sorted = sortByOrder(itineraryRef.current);
    const without = sorted.filter((i) => i.id !== itemId);
    const clamped = Math.max(0, Math.min(targetIndex, without.length));
    const before = without[clamped - 1]?.order ?? null;
    const after = without[clamped]?.order ?? null;
    let frac;
    try {
      frac = keyBetween(before, after);
    } catch {
      return; // neighbors not strictly ordered (shouldn't happen) — skip rather than crash
    }
    const order = makeOrder(frac, mySiteId);
    setItinerary((prev) =>
      sortByOrder(prev.map((i) => (i.id === itemId ? { ...i, order, unconfirmed: true } : i)))
    );
    sendOrQueue('itinerary:move', { itemId, order });
  }, [sendOrQueue]);

  // Optimize the itinerary's visiting order and apply it. We reassign fresh, strictly-
  // increasing fractional-index keys in the optimized sequence and emit a `move` per stop —
  // so the reorder flows through the same conflict-free path as manual drags (merges if
  // someone is mid-edit). Returns a route summary for the UI, or null if nothing to optimize.
  //
  // `origin` ({lat,lng}) is the route's START (the user's location) so the route is computed
  // as YOU → stops. We FIRST ask the server for a FASTEST, traffic-aware order (real Google
  // travel times + the time-dependent re-evaluation loop). If the server is unreachable we
  // fall back to the local straight-line distance optimizer, so it never breaks.
  const optimizeItinerary = useCallback(async (origin = null) => {
    const current = sortByOrder(itineraryRef.current);
    if (current.length < 2) return null;

    const stopPts = current.map((i) => ({ lat: Number(i.lat), lng: Number(i.lng) }));
    const points = origin ? [{ lat: origin.lat, lng: origin.lng }, ...stopPts] : stopPts;

    // Try the server's traffic-aware time optimizer (Stages 1+2). Needs an origin so the
    // server can fix index 0 as the start.
    let orderedStops; // array of itinerary items in the new visiting order
    let summary;
    const server = origin ? await optimizeViaServer(points) : null;
    if (server) {
      orderedStops = server.order.map((idx) => current[idx]);
      summary = { minutes: server.totalMinutes, distance: server.totalKm, method: 'traffic', iterations: server.iterations };
    } else {
      // Fallback: local straight-line optimizer (no traffic, distance-based).
      const result = optimizeRoute(stopPts, origin, null);
      orderedStops = result.indices.map((idx) => current[idx]);
      summary = { distance: result.distance, method: 'straight-line' };
    }

    // Mint a chain of strictly-increasing COMPOUND keys for the new order (site-stamped, like
    // a manual move, so concurrent edits still tiebreak deterministically).
    let prevKey = null;
    const oldKey = new Map(current.map((i) => [i.id, i.order]));
    const updates = orderedStops.map((item) => {
      const frac = keyAfterLast(prevKey);
      prevKey = frac;
      return { id: item.id, order: makeOrder(frac, mySiteId) };
    });

    setItinerary((prev) => {
      const byId = new Map(updates.map((u) => [u.id, u.order]));
      return sortByOrder(prev.map((i) => (byId.has(i.id) ? { ...i, order: byId.get(i.id), unconfirmed: true } : i)));
    });
    updates.forEach(({ id, order }) => {
      if (oldKey.get(id) !== order) sendOrQueue('itinerary:move', { itemId: id, order });
    });

    return summary;
  }, [sendOrQueue]);

  // Share our own map viewport so anyone following us can mirror it.
  const broadcastViewport = useCallback((center, zoom) => {
    socketRef.current?.emit('viewport:change', { center, zoom });
  }, []);

  const follow = useCallback((memberName) => {
    setFollowingName(memberName);
    setFollowViewport(null);
  }, []);

  const stopFollowing = useCallback(() => {
    setFollowingName(null);
    setFollowViewport(null);
  }, []);

  return {
    connected,
    pins,
    itinerary,
    members,
    you,
    error,
    followingName,
    followViewport,
    addPin,
    removePin,
    addItineraryItem,
    removeItineraryItem,
    moveItineraryItem,
    optimizeItinerary,
    broadcastViewport,
    follow,
    stopFollowing,
  };
};
