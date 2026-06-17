import mongoose from 'mongoose';
import { customAlphabet } from 'nanoid';
import { Trip } from './models/Trip.js';
import { Memory } from './models/Memory.js';
import { keyAfterLast, sortByOrder, makeOrder, stripSite } from './fracdex.js';

// Site id stamped onto every order key the SERVER mints (adds/backfills). The server is the
// ordering authority, so a single stable site id is enough to tiebreak its keys against any
// client-minted ones deterministically. (Client moves carry the client's own site id.)
const SERVER_SITE = 'srv';

// Generate short, friendly, URL-safe trip codes (no ambiguous chars like O/0/l/1).
const makeCode = customAlphabet('23456789abcdefghjkmnpqrstuvwxyz', 6);

// The store presents ONE interface (createTrip / getTrip / mutators) regardless of
// whether it's backed by MongoDB or an in-memory Map. The Socket.IO and REST layers
// don't care which is active — so the app runs with or without a database configured.

let useMongo = false;
const memory = new Map(); // code -> trip object (when running without MongoDB)
const memMemories = new Map(); // memory id -> memory object (in-memory Memories fallback)
let memMemSeq = 1;

// Reports which backend is active so the health endpoint can surface it.
export const storeStatus = () => (useMongo ? 'mongodb' : 'in-memory');

export const connectStore = async (mongoUri) => {
  if (!mongoUri) {
    console.warn(
      '⚠️  No MONGODB_URI set — using in-memory store. Trips are LOST on restart. ' +
      'Set MONGODB_URI in server/.env to persist.'
    );
    return;
  }

  try {
    // Fail fast (5s) instead of hanging if Atlas is unreachable / IP not allow-listed.
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
    await Trip.init(); // ensure indexes (unique `code`) are built
    useMongo = true;
    console.log('✅ Connected to MongoDB');

    mongoose.connection.on('disconnected', () =>
      console.warn('⚠️  MongoDB disconnected — will retry automatically.')
    );
    mongoose.connection.on('reconnected', () =>
      console.log('✅ MongoDB reconnected.')
    );
  } catch (e) {
    // Don't crash the whole server if the DB is misconfigured — fall back to in-memory
    // so the app still runs, but make the reason loud.
    console.error(
      '❌ Could not connect to MongoDB — falling back to in-memory (data NOT persisted).\n' +
      `   Reason: ${e.message}\n` +
      '   Check MONGODB_URI, your Atlas IP allow-list, and the database user/password.'
    );
  }
};

const blankTrip = (code) => ({ code, pins: [], itinerary: [], version: 0, createdAt: new Date() });

export const createTrip = async () => {
  const code = makeCode();
  if (useMongo) {
    const trip = await Trip.create({ code });
    return trip.toObject();
  }
  const trip = blankTrip(code);
  memory.set(code, trip);
  return trip;
};

// Ensure every itinerary item has a fractional-index `order` key, preserving the items'
// current array order. Self-heals trips created before the `order` field existed (their
// items have order ''), so the sort and keyBetween() never see an invalid empty bound.
// Returns true if anything changed (so callers can persist the fix).
const backfillOrder = (trip) => {
  if (!trip?.itinerary?.length) return false;
  let prev = null;
  let changed = false;
  for (const item of trip.itinerary) {
    if (!item.order) {
      item.order = makeOrder(keyAfterLast(prev), SERVER_SITE);
      changed = true;
    }
    prev = item.order;
  }
  return changed;
};

export const getTrip = async (code) => {
  if (useMongo) {
    const trip = await Trip.findOne({ code });
    if (!trip) return null;
    if (backfillOrder(trip)) await trip.save();
    return trip.toObject();
  }
  const trip = memory.get(code);
  if (trip) backfillOrder(trip);
  return trip || null;
};

// --- Mutators. Each returns the updated trip so callers can broadcast fresh state. ---
//
// `persist` bumps the trip `version` on every successful mutation (so each broadcast carries
// a strictly increasing version a client can use for gap detection). `mutate` may return
// `false` to signal "no real change" — then we DON'T bump the version (e.g. a duplicate add
// or a move targeting an already-removed item), so a no-op never advances the sequence.

const persist = async (code, mutate) => {
  if (useMongo) {
    const trip = await Trip.findOne({ code });
    if (!trip) return null;
    const changed = mutate(trip) !== false;
    if (changed) trip.version = (trip.version || 0) + 1;
    await trip.save();
    return trip.toObject();
  }
  const trip = memory.get(code);
  if (!trip) return null;
  const changed = mutate(trip) !== false;
  if (changed) trip.version = (trip.version || 0) + 1;
  return trip;
};

export const addPin = (code, pin) =>
  persist(code, (t) => { t.pins.push(pin); });

export const removePin = (code, pinId) =>
  persist(code, (t) => { t.pins = t.pins.filter((p) => p.id !== pinId); });

// --- Itinerary: granular, action-based edits ---
//
// The client no longer sends the whole list. Instead it sends add/remove/move actions,
// and each mutator touches ONLY the affected item. Visit order lives in each item's
// `order` field (a fractional-index key); the list is "items sorted by order". Because a
// move rewrites only one item's key, two people moving two different items merge cleanly
// instead of overwriting each other (the old whole-list approach was last-write-wins).
//
// Each returns { trip, item } so the realtime layer can broadcast just the changed item.

// Append a new stop after the current last one. Ignores duplicates (same id) — returning
// `false` keeps the version from advancing on a no-op. The minted key is a COMPOUND key
// (fractional + server site) so it tiebreaks deterministically against client-minted keys.
export const addItineraryItem = async (code, item) => {
  let added = null;
  const trip = await persist(code, (t) => {
    if (t.itinerary.some((i) => i.id === item.id)) return false; // duplicate → no-op
    const last = sortByOrder(t.itinerary).at(-1);
    added = { ...item, order: makeOrder(keyAfterLast(last?.order || null), SERVER_SITE) };
    t.itinerary.push(added);
    return true;
  });
  return { trip, item: added };
};

// Remove a stop. Returns `false` (no version bump) when the id wasn't present.
export const removeItineraryItem = (code, itemId) =>
  persist(code, (t) => {
    const before = t.itinerary.length;
    t.itinerary = t.itinerary.filter((i) => i.id !== itemId);
    return t.itinerary.length !== before;
  });

// Set one item's order key (the new fractional-index position). Only that item changes.
// If the item was concurrently REMOVED (a move/remove race), we can't move it — we report
// `orphaned: true` so the realtime layer can tell the mover to drop it (fix #7), and return
// `false` so the version isn't bumped for a move that didn't happen.
export const moveItineraryItem = async (code, itemId, order) => {
  let moved = null;
  let orphaned = false;
  const trip = await persist(code, (t) => {
    const it = t.itinerary.find((i) => i.id === itemId);
    if (!it) { orphaned = true; return false; } // raced with a remove
    it.order = order;
    moved = { id: it.id, order };
    return true;
  });
  return { trip, item: moved, orphaned };
};

// --- Memories (per-user private map pins). Every operation is scoped to a userId, so one
// user can never read or change another user's memories. Mongo when available, else an
// in-memory Map (lost on restart — same trade-off as trips). ---

// Normalize a Mongo/in-memory memory to a plain client shape with an `id` string.
const memOut = (m) => ({
  id: String(m._id || m.id),
  lat: m.lat, lng: m.lng, title: m.title, note: m.note,
  photos: (m.photos || []).map((p) => ({ url: p.url, publicId: p.publicId || '' })),
  createdAt: m.createdAt,
});

export const listMemories = async (userId) => {
  if (useMongo) {
    const docs = await Memory.find({ userId }).sort({ createdAt: 1 });
    return docs.map((d) => memOut(d.toObject()));
  }
  return [...memMemories.values()].filter((m) => m.userId === userId).map(memOut);
};

export const createMemory = async (userId, { lat, lng, title, note }) => {
  if (useMongo) {
    const doc = await Memory.create({ userId, lat, lng, title, note, photos: [] });
    return memOut(doc.toObject());
  }
  const m = { id: `mem-${memMemSeq++}`, userId, lat, lng, title: title || 'New memory', note: note || '', photos: [], createdAt: new Date() };
  memMemories.set(m.id, m);
  return memOut(m);
};

// Update only fields the owner is allowed to change; returns the updated memory or null
// if it doesn't exist OR isn't owned by this user (so cross-user edits silently 404).
export const updateMemory = async (userId, id, patch) => {
  const allowed = {};
  if (patch.title !== undefined) allowed.title = patch.title;
  if (patch.note !== undefined) allowed.note = patch.note;
  if (Array.isArray(patch.photos)) allowed.photos = patch.photos;

  if (useMongo) {
    const doc = await Memory.findOneAndUpdate({ _id: id, userId }, allowed, { new: true });
    return doc ? memOut(doc.toObject()) : null;
  }
  const m = memMemories.get(id);
  if (!m || m.userId !== userId) return null;
  Object.assign(m, allowed);
  return memOut(m);
};

// Remove ONE photo (by its Cloudinary publicId) from a memory. Returns { memory, removed }
// where `removed` is the photo that was taken out (so the route can delete it from
// Cloudinary), or { memory: null } if the memory isn't found / not owned by this user.
export const removePhotoFromMemory = async (userId, id, publicId) => {
  if (useMongo) {
    const doc = await Memory.findOne({ _id: id, userId });
    if (!doc) return { memory: null, removed: null };
    const removed = doc.photos.find((p) => p.publicId === publicId) || null;
    doc.photos = doc.photos.filter((p) => p.publicId !== publicId);
    await doc.save();
    return { memory: memOut(doc.toObject()), removed: removed ? { ...removed.toObject?.() || removed } : null };
  }
  const m = memMemories.get(id);
  if (!m || m.userId !== userId) return { memory: null, removed: null };
  const removed = m.photos.find((p) => p.publicId === publicId) || null;
  m.photos = m.photos.filter((p) => p.publicId !== publicId);
  return { memory: memOut(m), removed };
};

// Delete a memory; returns the deleted memory's photos (so the route can delete the files
// from Cloudinary), or null if not found / not owned.
export const deleteMemory = async (userId, id) => {
  if (useMongo) {
    const doc = await Memory.findOneAndDelete({ _id: id, userId });
    return doc ? memOut(doc.toObject()).photos : null;
  }
  const m = memMemories.get(id);
  if (!m || m.userId !== userId) return null;
  const photos = memOut(m).photos;
  memMemories.delete(id);
  return photos;
};
