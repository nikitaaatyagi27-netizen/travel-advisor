import { Router } from 'express';
import { createTrip, getTrip } from '../store.js';

const router = Router();

// POST /api/trips  → create a new trip, return its shareable code.
router.post('/', async (req, res) => {
  try {
    const trip = await createTrip();
    res.status(201).json({ code: trip.code, pins: trip.pins, itinerary: trip.itinerary });
  } catch (e) {
    console.error('createTrip failed:', e);
    res.status(500).json({ error: 'Could not create trip' });
  }
});

// GET /api/trips/:code  → load an existing trip (pins + itinerary).
router.get('/:code', async (req, res) => {
  try {
    const trip = await getTrip(req.params.code);
    if (!trip) return res.status(404).json({ error: 'Trip not found' });
    res.json({ code: trip.code, pins: trip.pins, itinerary: trip.itinerary });
  } catch (e) {
    console.error('getTrip failed:', e);
    res.status(500).json({ error: 'Could not load trip' });
  }
});

export default router;
