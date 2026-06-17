import {
  addPin, removePin, getTrip,
  addItineraryItem, removeItineraryItem, moveItineraryItem,
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

const roomMembers = (code) => {
  const m = presence.get(code);
  return m ? Array.from(m.values()).map(({ name, color }) => ({ name, color })) : [];
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
      const color = COLORS[members.size % COLORS.length];
      me = { name: name || 'Guest', color, viewport: null };
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
      const trip = await addPin(joinedCode, { ...pin, addedBy: me?.name });
      if (trip) io.to(joinedCode).emit('pin:added', trip.pins[trip.pins.length - 1]);
    });

    // --- Pins: remove ---
    socket.on('pin:remove', async ({ pinId }) => {
      if (!joinedCode) return;
      const trip = await removePin(joinedCode, pinId);
      if (trip) io.to(joinedCode).emit('pin:removed', { pinId });
    });

    // --- Itinerary: granular, action-based edits (add / remove / move) ---
    //
    // Each action touches one item and is broadcast as the same granular event, so
    // concurrent edits by different people merge instead of overwriting each other.
    // We broadcast to EVERYONE (incl. sender) so the server's assigned order key is the
    // single source of truth — the sender reconciles its optimistic state with it.

    // Every broadcast carries the trip's new `version` so receivers can spot a dropped event.

    socket.on('itinerary:add', async ({ item }) => {
      if (!joinedCode) return;
      const { trip, item: added } = await addItineraryItem(joinedCode, { ...item, addedBy: me?.name });
      if (trip && added) io.to(joinedCode).emit('itinerary:item-added', { ...added, version: trip.version });
    });

    socket.on('itinerary:remove', async ({ itemId }) => {
      if (!joinedCode) return;
      const trip = await removeItineraryItem(joinedCode, itemId);
      if (trip) io.to(joinedCode).emit('itinerary:item-removed', { itemId, version: trip.version });
    });

    socket.on('itinerary:move', async ({ itemId, order }) => {
      if (!joinedCode) return;
      const { trip, item: moved, orphaned } = await moveItineraryItem(joinedCode, itemId, order);
      if (trip && moved) {
        io.to(joinedCode).emit('itinerary:item-moved', { ...moved, version: trip.version });
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
