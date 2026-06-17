// Fetch a Google Distance Matrix for a list of points, returning both distance (km) and
// traffic-aware travel time (minutes). Shared by the /distance-matrix route and the
// time-dependent optimize loop. `departureTime` = unix seconds or "now" (factors in traffic).

const KEY = () => process.env.GOOGLE_MAPS_API_KEY;

export const fetchGoogleMatrix = async (points, departureTime = 'now') => {
  if (!KEY()) throw new Error('Server missing GOOGLE_MAPS_API_KEY');
  const coords = points.map((p) => `${p.lat},${p.lng}`).join('|');
  const url = new URL('https://maps.googleapis.com/maps/api/distancematrix/json');
  url.searchParams.set('origins', coords);
  url.searchParams.set('destinations', coords);
  url.searchParams.set('mode', 'driving');
  url.searchParams.set('departure_time', String(departureTime));
  url.searchParams.set('traffic_model', 'best_guess');
  url.searchParams.set('key', KEY());

  const upstream = await fetch(url);
  const data = await upstream.json();
  if (data.status !== 'OK') {
    throw new Error(`Distance Matrix: ${data.status}${data.error_message ? ` (${data.error_message})` : ''}`);
  }
  const distance = data.rows.map((row) =>
    row.elements.map((el) => (el.status === 'OK' ? el.distance.value / 1000 : Infinity))
  );
  const time = data.rows.map((row) =>
    row.elements.map((el) => {
      if (el.status !== 'OK') return Infinity;
      return ((el.duration_in_traffic || el.duration).value) / 60; // minutes
    })
  );
  return { distance, time };
};
