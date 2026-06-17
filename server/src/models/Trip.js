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

const tripSchema = new mongoose.Schema({
  // Short shareable code that appears in the URL (/trip/:code).
  code: { type: String, required: true, unique: true, index: true },
  pins: { type: [pinSchema], default: [] },
  itinerary: { type: [itineraryItemSchema], default: [] },
  // Monotonic version, bumped on EVERY shared-state mutation. Broadcast with each change so
  // clients can detect a dropped event (a gap in the sequence) and request a full resync —
  // the safety net against silent divergence on a flaky connection.
  version: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});

export const Trip = mongoose.model('Trip', tripSchema);
