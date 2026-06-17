// Reverse-geocode lat/lng → a short place name (e.g. "Delhi", "Kaza") using the Google
// Maps Geocoder that's already loaded for the app. Returns a best-effort name, or a
// lat,lng fallback string if geocoding isn't available or finds nothing.
//
// We prefer the most "place-like" component: locality (city/town) → sublocality →
// admin area (state) → the formatted address's first chunk.

export const reverseGeocode = (lat, lng) =>
  new Promise((resolve) => {
    const g = window.google?.maps;
    if (!g?.Geocoder) {
      resolve(`${lat.toFixed(3)}, ${lng.toFixed(3)}`);
      return;
    }
    const geocoder = new g.Geocoder();
    geocoder.geocode({ location: { lat, lng } }, (results, status) => {
      if (status !== 'OK' || !results?.length) {
        resolve(`${lat.toFixed(3)}, ${lng.toFixed(3)}`);
        return;
      }
      // Search all results' address components for the best place-level name.
      const pick = (types) => {
        for (const r of results) {
          const c = r.address_components?.find((comp) => types.some((t) => comp.types.includes(t)));
          if (c) return c.long_name;
        }
        return null;
      };
      const name =
        pick(['locality']) ||
        pick(['sublocality', 'postal_town']) ||
        pick(['administrative_area_level_2']) ||
        pick(['administrative_area_level_1']) ||
        results[0].formatted_address?.split(',')[0] ||
        `${lat.toFixed(3)}, ${lng.toFixed(3)}`;
      resolve(name);
    });
  });
