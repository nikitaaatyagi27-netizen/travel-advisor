import { SERVER_URL } from './config';

// Create a brand-new trip; returns { code, pins, itinerary }.
export const createTrip = async () => {
  const res = await fetch(`${SERVER_URL}/api/trips`, { method: 'POST' });
  if (!res.ok) throw new Error('Could not create trip');
  return res.json();
};

// Load an existing trip by its code; returns the trip or throws on 404/error.
export const fetchTrip = async (code) => {
  const res = await fetch(`${SERVER_URL}/api/trips/${code}`);
  if (!res.ok) throw new Error('Trip not found');
  return res.json();
};
