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

  // In-flight optimistic itinerary actions: itemId -> timeout handle. When we emit an add/move
  // we start a timer; if the server's confirming broadcast doesn't arrive in time (it crashed,
  // the network ate the response), the timer flips the item to `failed` so the user sees an
  // error + retry instead of an item stuck forever on "syncing…". A confirming broadcast (or
  // an explicit action-failed) clears the timer.
  const pendingRef = useRef(new Map());
  const ACTION_TIMEOUT_MS = 8000;

  // Stop tracking an in-flight action (its outcome arrived).
  const clearPending = useCallback((itemId) => {
    const t = pendingRef.current.get(itemId);
    if (t) { clearTimeout(t); pendingRef.current.delete(itemId); }
  }, []);

  // Mark an optimistic item as failed: clear its pending timer and flag it for the UI.
  const failItem = useCallback((itemId) => {
    clearPending(itemId);
    setItinerary((prev) =>
      prev.map((i) => (i.id === itemId ? { ...i, unconfirmed: false, failed: true } : i)),
    );
  }, [clearPending]);

  // Start the confirm-or-fail timer for an optimistic action on `itemId`.
  const markPending = useCallback((itemId) => {
    clearPending(itemId); // restart the clock if it was already pending (e.g. a retry)
    const t = setTimeout(() => failItem(itemId), ACTION_TIMEOUT_MS);
    pendingRef.current.set(itemId, t);
  }, [clearPending, failItem]);

  // --- Optimistic PINS: same broadcast-back + timeout model as the itinerary. A pin shows on
  // the local map instantly; the server's broadcast confirms it. If no confirmation arrives in
  // time (server crashed / response lost) we ROLL BACK: an unconfirmed add is removed, an
  // unconfirmed remove is restored. pinPendingRef: pinId -> { timeout, rollback }. ---
  const pinPendingRef = useRef(new Map());

  const clearPinPending = useCallback((pinId) => {
    const entry = pinPendingRef.current.get(pinId);
    if (entry) { clearTimeout(entry.timeout); pinPendingRef.current.delete(pinId); }
  }, []);

  // Track an optimistic pin op; `rollback` undoes the optimistic change if it times out.
  const markPinPending = useCallback((pinId, rollback) => {
    clearPinPending(pinId);
    const timeout = setTimeout(() => {
      pinPendingRef.current.delete(pinId);
      rollback();
      setError('Could not reach the server — that pin change was undone.');
    }, ACTION_TIMEOUT_MS);
    pinPendingRef.current.set(pinId, { timeout, rollback });
  }, [clearPinPending]);

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

    // Snapshot the pending-timer maps so the cleanup closure references a stable value (these
    // refs are created once and never reassigned, but this keeps react-hooks/exhaustive-deps
    // happy and is correct regardless).
    const pending = pendingRef.current;
    const pinPending = pinPendingRef.current;

    const socket = io(SERVER_URL, {
      transports: ['websocket', 'polling'],
      // Reconnection is on by default; we set these explicitly to document intent. We retry
      // forever (Infinity) rather than giving up — a long tunnel/flaky link should recover on
      // its own without the user refreshing. On each successful reconnect the 'connect'
      // handler re-joins the room and pulls fresh state, so no missed updates linger.
      reconnection: true,
      reconnectionDelay: 1000, // first retry after 1s
      reconnectionDelayMax: 5000, // backoff caps at 5s between retries
      reconnectionAttempts: Infinity,
      timeout: 20000,
    });
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
    socket.on('disconnect', (reason) => {
      setConnected(false);
      // When the SERVER ends the connection (a restart/redeploy, or an explicit
      // socket.disconnect()), Socket.IO does NOT auto-reconnect — it assumes the kick was
      // intentional. For a live trip we DO want back in, so reconnect manually. Every other
      // reason (transport drop, ping timeout, network loss) is handled by auto-reconnect.
      if (reason === 'io server disconnect') socket.connect();
    });

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
      // Full authoritative state supersedes any in-flight optimistic itinerary actions — clear
      // their fail timers so they don't later flip a now-correct item to "failed". (This also
      // fires on a server-side rebalance, which arrives as a fresh trip:state.)
      pendingRef.current.forEach((t) => clearTimeout(t));
      pendingRef.current.clear();
    });
    socket.on('trip:error', ({ message }) => setError(message));

    // Pins.
    // Pins are optimistic: the local user sees their own pin instantly (added by addPin
    // below, flagged `_pending`), and this broadcast CONFIRMS it (clears `_pending`) — or adds
    // it fresh for everyone else in the room. Dedupes by id so the optimistic copy + the
    // broadcast never double-add.
    socket.on('pin:added', (pin) => {
      clearPinPending(pin.id); // server confirmed — stop the rollback timer
      setPins((prev) =>
        prev.some((p) => p.id === pin.id)
          ? prev.map((p) => (p.id === pin.id ? { ...pin, _pending: false } : p)) // confirm
          : [...prev, pin]
      );
    });
    socket.on('pin:removed', ({ pinId }) => {
      clearPinPending(pinId);
      setPins((prev) => prev.filter((p) => p.id !== pinId));
    });
    // Server refused the pin (e.g. the trip hit its pin cap). Roll back the optimistic pin
    // and surface why, instead of leaving it dangling until its timeout.
    socket.on('pin:rejected', ({ pinId, reason }) => {
      clearPinPending(pinId);
      setPins((prev) => prev.filter((p) => p.id !== pinId));
      setError(reason || 'That pin could not be added.');
    });

    // Itinerary — granular actions, kept sorted by each item's fractional-index `order`.
    // The server is the source of truth for `order`, so we reconcile our optimistic state
    // with whatever it broadcasts (including for our own edits). The server's copy is
    // authoritative and CONFIRMED, so it replaces any optimistic/unconfirmed local copy.
    socket.on('itinerary:item-added', ({ version, ...item }) => {
      if (!applyVersion(version)) return; // stale/duplicate broadcast — ignore
      clearPending(item.id); // confirmed by the server — stop the fail timer
      setItinerary((prev) =>
        prev.some((i) => i.id === item.id)
          ? sortByOrder(prev.map((i) => (i.id === item.id ? item : i))) // confirm provisional
          : sortByOrder([...prev, item])
      );
    });
    socket.on('itinerary:item-removed', ({ itemId, version }) => {
      if (!applyVersion(version)) return;
      clearPending(itemId);
      setItinerary((prev) => prev.filter((i) => i.id !== itemId));
    });
    socket.on('itinerary:item-moved', ({ id, order, version }) => {
      if (!applyVersion(version)) return;
      clearPending(id);
      setItinerary((prev) =>
        sortByOrder(prev.map((i) => (i.id === id ? { ...i, order, unconfirmed: false, failed: false } : i)))
      );
    });
    // The server couldn't save this action (e.g. DB write failed). Flag the item so the UI
    // shows an error + a retry affordance instead of leaving it stuck on "syncing…".
    socket.on('itinerary:action-failed', ({ itemId }) => {
      if (itemId) failItem(itemId);
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
      pending.forEach((t) => clearTimeout(t)); // don't leak fail timers on unmount
      pending.clear();
      pinPending.forEach((e) => clearTimeout(e.timeout));
      pinPending.clear();
    };
  }, [code, name, clearPending, failItem, clearPinPending]);

  // --- Actions ---

  // Optimistic add: the pin shows on the local map immediately (flagged `_pending`), then the
  // server's `pin:added` broadcast confirms it. If confirmation never comes, it rolls back.
  const addPin = useCallback((pin) => {
    setPins((prev) => (prev.some((p) => p.id === pin.id) ? prev : [...prev, { ...pin, _pending: true }]));
    sendOrQueue('pin:add', { pin });
    markPinPending(pin.id, () => setPins((prev) => prev.filter((p) => p.id !== pin.id))); // rollback = un-add
  }, [sendOrQueue, markPinPending]);

  // Optimistic remove: the pin disappears locally at once; `pin:removed` confirms it. If that
  // never arrives, we restore the pin (rollback) so the user isn't misled into thinking it's gone.
  const removePin = useCallback((pinId) => {
    let removed = null;
    setPins((prev) => { removed = prev.find((p) => p.id === pinId) || null; return prev.filter((p) => p.id !== pinId); });
    sendOrQueue('pin:remove', { pinId });
    markPinPending(pinId, () => { if (removed) setPins((prev) => (prev.some((p) => p.id === pinId) ? prev : [...prev, removed])); });
  }, [sendOrQueue, markPinPending]);

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
    markPending(item.id);
  }, [sendOrQueue, markPending]);

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
      sortByOrder(prev.map((i) => (i.id === itemId ? { ...i, order, unconfirmed: true, failed: false } : i)))
    );
    sendOrQueue('itinerary:move', { itemId, order });
    markPending(itemId);
  }, [sendOrQueue, markPending]);

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
      if (oldKey.get(id) !== order) { sendOrQueue('itinerary:move', { itemId: id, order }); markPending(id); }
    });

    return summary;
  }, [sendOrQueue, markPending]);

  // Re-send a failed itinerary action. A failed item still sits in local state carrying its
  // intended `order`; we just re-emit it, clear the failed flag, and restart the fail timer.
  // (Both add and move funnel through itinerary:move on the server — re-asserting the item's
  // order via a move re-adds it if it never landed, and re-positions it if it did.)
  const retryItem = useCallback((itemId) => {
    const item = itineraryRef.current.find((i) => i.id === itemId);
    if (!item) return;
    setItinerary((prev) =>
      prev.map((i) => (i.id === itemId ? { ...i, failed: false, unconfirmed: true } : i)),
    );
    // Re-add (so it lands even if the original add never persisted), then the server's
    // broadcast carries the canonical order and clears the pending state.
    sendOrQueue('itinerary:add', { item: { id: item.id, placeName: item.placeName, lat: item.lat, lng: item.lng } });
    sendOrQueue('itinerary:move', { itemId: item.id, order: item.order });
    markPending(itemId);
  }, [sendOrQueue, markPending]);

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
    retryItem,
    optimizeItinerary,
    broadcastViewport,
    follow,
    stopFollowing,
  };
};
