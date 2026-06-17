import mongoose from 'mongoose';

// A photo attached to a memory. `url` is the Cloudinary delivery URL (what we display);
// `publicId` is Cloudinary's id for the asset (kept so we could delete it from Cloudinary
// later). For now, before Cloudinary is wired, `url` may be a data/object URL.
const photoSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    publicId: { type: String, default: '' },
  },
  { _id: false }
);

// A single memory pin on a user's private memories map.
const memorySchema = new mongoose.Schema({
  // Firebase uid of the owner — every query is scoped to this so users only see their own.
  userId: { type: String, required: true, index: true },
  lat: { type: Number, required: true },
  lng: { type: Number, required: true },
  title: { type: String, default: 'New memory' },
  note: { type: String, default: '' },
  photos: { type: [photoSchema], default: [] },
  createdAt: { type: Date, default: Date.now },
});

export const Memory = mongoose.model('Memory', memorySchema);
