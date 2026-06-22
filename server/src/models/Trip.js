import mongoose from 'mongoose';

// A single pinned place (the shared "pins" bucket — order doesn't matter).
const pinSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    placeName: { type: String, default: 'Pinned place' },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    addedBy: { type: String, default: 'Someone' },
    note: { type: String, default: '' }, // v2
    votes: { type: [String], default: [] }, // v2
    category: { type: String, default: '' }, // v3
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

// A stop in the shared, ORDERED itinerary. Visit order is determined by the `order`
// field (a fractional-index sortable string), NOT by array position — so concurrent
// reorders by different people merge instead of clobbering. See server/src/fracdex.js.
const itineraryItemSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    placeName: { type: String, default: 'Stop' },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    addedBy: { type: String, default: 'Someone' },
    order: { type: String, default: '' }, // fractional-index key; list sorts by this
  },
  { _id: false }
);

// Default cap on pins per trip — a cheap abuse guard so a single trip code can't be used to
// flood the database with unlimited entries. Stored per-trip (in `settings`) so it could be
// raised for a specific trip later without a code change.
export const DEFAULT_MAX_PINS = 50;

// A trip with no activity for this long is considered abandoned and auto-deleted by MongoDB's
// TTL monitor (see the `expiresAt` index below). Every mutation pushes `expiresAt` forward.
export const TRIP_TTL_DAYS = 30;
export const ttlFromNow = () => new Date(Date.now() + TRIP_TTL_DAYS * 24 * 60 * 60 * 1000);

const tripSchema = new mongoose.Schema({
  // Short shareable code that appears in the URL (/trip/:code).
  code: { type: String, required: true, unique: true, index: true },
  pins: { type: [pinSchema], default: [] },
  itinerary: { type: [itineraryItemSchema], default: [] },
  // Monotonic version, bumped on EVERY shared-state mutation. Broadcast with each change so
  // clients can detect a dropped event (a gap in the sequence) and request a full resync —
  // the safety net against silent divergence on a flaky connection.
  version: { type: Number, default: 0 },
  // Touched on every mutation; surfaces "when did anyone last edit this trip".
  lastActiveAt: { type: Date, default: Date.now },
  // TTL anchor: MongoDB deletes the doc once the clock passes this time. Pushed forward on
  // every mutation, so an actively-used trip never expires, but an abandoned one is reaped
  // ~TRIP_TTL_DAYS after its last edit. `expireAfterSeconds: 0` = "expire AT expiresAt".
  expiresAt: { type: Date, default: ttlFromNow, index: { expireAfterSeconds: 0 } },
  // Per-trip settings. `maxPins` caps the shared pins bucket (abuse guard).
  settings: {
    maxPins: { type: Number, default: DEFAULT_MAX_PINS },
  },
  createdAt: { type: Date, default: Date.now },
});

export const Trip = mongoose.model('Trip', tripSchema);
