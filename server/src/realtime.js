import {
  addPin, removePin, getTrip,
  addItineraryItem, removeItineraryItem, moveItineraryItem, rebalanceItinerary,
} from './store.js';
import { sortByOrder } from './fracdex.js';

// Real-time collaboration layer.
//
// Mental model: each trip is a Socket.IO "room" keyed by the trip code. Anyone viewing
// /trip/<code> joins that room. When someone changes shared state (a pin, the itinerary),
// the server persists it and broadcasts to everyone else IN THAT ROOM — so updates are
// scoped to the trip and never leak across trips.
//
// Presence is tracked per-room in memory: a map of socketId -> { name, color }. The map
// itself updates live (cursor moves, viewport for "follow") are broadcast but NOT
// persisted — they're ephemeral by nature.

const COLORS = ['#e53935', '#8e24aa', '#3949ab', '#00897b', '#fb8c00', '#6d4c41', '#00acc1', '#c0ca33'];

// roomCode -> Map(socketId -> { name, color, viewport })
const presence = new Map();

// The public presence list for a room, DEDUPED by name: one person with two tabs is two
// sockets but should appear once in the bar. We collapse sockets that share a name, keeping
// the color of their earliest-joined socket so a member's color stays stable as tabs open/close.
const roomMembers = (code) => {
  const m = presence.get(code);
  if (!m) return [];
  const byName = new Map(); // name -> { name, color }
  for (const { name, color } of m.values()) {
    if (!byName.has(name)) byName.set(name, { name, color });
  }
  return Array.from(byName.values());
};

export const registerRealtime = (io) => {
  io.on('connection', (socket) => {
    let joinedCode = null;
    let me = null;

    // --- Join a trip room ---
    socket.on('trip:join', async ({ code, name }) => {
      const trip = await getTrip(code);
      if (!trip) {
        socket.emit('trip:error', { message: 'Trip not found' });
        return;
      }

      joinedCode = code;
      socket.join(code);

      if (!presence.has(code)) presence.set(code, new Map());
      const members = presence.get(code);
      const myName = name || 'Guest';
      // Reuse an existing color if this name is already in the room (another tab of the same
      // person), so their tabs render consistently. Otherwise pick the next color by DISTINCT
      // name count — multi-tab users don't burn extra color slots.
      const existing = Array.from(members.values()).find((mem) => mem.name === myName);
      const distinctNames = new Set(Array.from(members.values()).map((mem) => mem.name)).size;
      const color = existing ? existing.color : COLORS[distinctNames % COLORS.length];
      me = { name: myName, color, viewport: null };
      members.set(socket.id, me);

      // Send the joiner the current shared state (itinerary sorted by its order keys).
      // `version` lets the client detect dropped events later and resync.
      socket.emit('trip:state', {
        code: trip.code,
        pins: trip.pins,
        itinerary: sortByOrder(trip.itinerary),
        version: trip.version || 0,
        you: { name: me.name, color: me.color },
      });

      // Tell everyone (including the joiner) the updated presence list.
      io.to(code).emit('presence:update', roomMembers(code));
    });

    // --- Resync: a client that detected a version gap (a dropped event) asks for full
    // authoritative state. We re-send trip:state, the same payload as on join. ---
    socket.on('trip:resync', async () => {
      if (!joinedCode) return;
      const trip = await getTrip(joinedCode);
      if (!trip) return;
      socket.emit('trip:state', {
        code: trip.code,
        pins: trip.pins,
        itinerary: sortByOrder(trip.itinerary),
        version: trip.version || 0,
        you: me ? { name: me.name, color: me.color } : null,
      });
    });

    // --- Pins: add ---
    socket.on('pin:add', async ({ pin }) => {
      if (!joinedCode) return;
      try {
        const trip = await addPin(joinedCode, { ...pin, addedBy: me?.name });
        if (trip) io.to(joinedCode).emit('pin:added', trip.pins[trip.pins.length - 1]);
      } catch (err) {
        socket.emit('trip:error', { message: `Couldn't save pin: ${err.message}` });
      }
    });

    // --- Pins: remove ---
    socket.on('pin:remove', async ({ pinId }) => {
      if (!joinedCode) return;
      try {
        const trip = await removePin(joinedCode, pinId);
        if (trip) io.to(joinedCode).emit('pin:removed', { pinId });
      } catch (err) {
        socket.emit('trip:error', { message: `Couldn't remove pin: ${err.message}` });
      }
    });

    // --- Itinerary: granular, action-based edits (add / remove / move) ---
    //
    // Each action touches one item and is broadcast as the same granular event, so
    // concurrent edits by different people merge instead of overwriting each other.
    // We broadcast to EVERYONE (incl. sender) so the server's assigned order key is the
    // single source of truth — the sender reconciles its optimistic state with it.

    // Every broadcast carries the trip's new `version` so receivers can spot a dropped event.
    //
    // Each itinerary handler is wrapped so that if the store throws (e.g. the DB save fails),
    // we tell JUST the sender via `itinerary:action-failed` with the item's id — instead of
    // silently doing nothing, which would leave the sender's optimistic copy stuck "syncing…"
    // forever. The client uses this (and a timeout) to flip the item into a "failed" state.

    socket.on('itinerary:add', async ({ item }) => {
      if (!joinedCode) return;
      try {
        const { trip, item: added } = await addItineraryItem(joinedCode, { ...item, addedBy: me?.name });
        if (trip && added) io.to(joinedCode).emit('itinerary:item-added', { ...added, version: trip.version });
      } catch (err) {
        socket.emit('itinerary:action-failed', { itemId: item?.id, action: 'add', error: err.message });
      }
    });

    socket.on('itinerary:remove', async ({ itemId }) => {
      if (!joinedCode) return;
      try {
        const trip = await removeItineraryItem(joinedCode, itemId);
        if (trip) io.to(joinedCode).emit('itinerary:item-removed', { itemId, version: trip.version });
      } catch (err) {
        socket.emit('itinerary:action-failed', { itemId, action: 'remove', error: err.message });
      }
    });

    socket.on('itinerary:move', async ({ itemId, order }) => {
      if (!joinedCode) return;
      let result;
      try {
        result = await moveItineraryItem(joinedCode, itemId, order);
      } catch (err) {
        socket.emit('itinerary:action-failed', { itemId, action: 'move', error: err.message });
        return;
      }
      const { trip, item: moved, orphaned, needsRebalance: needsRebal } = result;
      if (trip && moved) {
        io.to(joinedCode).emit('itinerary:item-moved', { ...moved, version: trip.version });
        // A key grew past the length threshold — compact ALL keys and broadcast full state so
        // every client adopts the rebalanced order. Done after the move broadcast so clients
        // briefly see the move, then settle on the rebalanced (visually identical) order.
        if (needsRebal) {
          const rebalanced = await rebalanceItinerary(joinedCode);
          if (rebalanced) {
            io.to(joinedCode).emit('trip:state', {
              code: rebalanced.code,
              pins: rebalanced.pins,
              itinerary: sortByOrder(rebalanced.itinerary),
              version: rebalanced.version || 0,
              you: null, // full-state rebroadcast; presence/you unchanged
            });
          }
        }
      } else if (orphaned) {
        // The item was removed by someone else before this move landed (move/remove race).
        // Tell just the mover so their optimistic copy disappears instead of lingering. We
        // send NO version: this is a local correction, not a new sequenced state change, and
        // it must apply regardless of where the mover's version sits (the authoritative
        // remove that actually bumped the version is broadcast separately to everyone).
        socket.emit('itinerary:item-removed', { itemId });
      }
    });

    // --- Follow: share your map viewport so a follower can mirror it (ephemeral) ---
    socket.on('viewport:change', ({ center, zoom }) => {
      if (!joinedCode || !me) return;
      me.viewport = { center, zoom };
      socket.to(joinedCode).emit('viewport:changed', {
        name: me.name,
        color: me.color,
        center,
        zoom,
      });
    });

    // --- Leave / disconnect ---
    const leave = () => {
      if (joinedCode && presence.has(joinedCode)) {
        presence.get(joinedCode).delete(socket.id);
        io.to(joinedCode).emit('presence:update', roomMembers(joinedCode));
        if (presence.get(joinedCode).size === 0) presence.delete(joinedCode);
      }
    };

    socket.on('disconnect', leave);
  });
};
