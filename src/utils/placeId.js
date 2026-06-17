// A stable identifier for a place across the RapidAPI and Google Places data shapes.
// Used as the React key in both the List and the Map so hover/selection stay in sync
// and rows don't flicker when the list is filtered or reordered.
export const getPlaceId = (place, index = 0) => {
  if (!place) return `place-${index}`;
  return (
    place.location_id ||
    place.place_id ||
    `${place.name || 'place'}-${place.latitude}-${place.longitude}`
  );
};
