import React, { useEffect, useState, useRef } from 'react';
import GoogleMapReact from 'google-map-react';
import { Paper, Typography, Box, Rating, Button, Tooltip } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import PushPinIcon from '@mui/icons-material/PushPin';
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera';
import RestaurantIcon from '@mui/icons-material/Restaurant';
import HotelIcon from '@mui/icons-material/Hotel';
import AttractionsIcon from '@mui/icons-material/Attractions';
import { getPlaceId } from '../../utils/placeId';
import { thumbUrl } from '../../memories/cloudinary';
import { haversine } from '../../utils/route';
import mapStyles from '../../mapStyles';

// "Open now"/"Closed" if the data carries hours, else null (don't fake it).
const placeOpenStatus = (place) => {
  if (place.open_now_text) return place.open_now_text;
  if (place.is_closed === false) return 'Open Now';
  if (place.is_closed === true) return 'Closed Now';
  return null;
};

// Distance from the user to a place, formatted — only if both locations are known.
const placeDistance = (coords, place) => {
  const lat = Number(place.latitude);
  const lng = Number(place.longitude);
  if (!coords || Number.isNaN(lat) || Number.isNaN(lng)) return null;
  const km = haversine(coords, { lat, lng });
  return km < 1 ? `${Math.round(km * 1000)} m away` : `${km.toFixed(1)} km away`;
};

const Map = ({
  coords,
  setCoords,
  setBounds,
  places,
  setChildClicked,
  type,
  rating,
  setPlaces,
  setIsLoading,
  setError,
  hovered,
  setHovered,
  mapMoved,
  setMapMoved,
  searchThisArea,
  inCollab,
  collabPins,
  collabItinerary,
  collabMembers,
  onAddCollabPin,
  onBroadcastViewport,
  following,
  routeFocus,
  routeOrigin,
  hideSearchResults,
  memoriesMode,
  memories,
  onAddMemory,
  onMemoryClick
}) => {
  // In route-focus, dim everything that isn't the route: blurred, faded, non-interactive.
  const dimmedSx = {
    filter: 'blur(2px)',
    opacity: 0.35,
    pointerEvents: 'none',
    transition: 'filter 0.3s ease, opacity 0.3s ease',
  };
  const focusTransition = { transition: 'filter 0.3s ease, opacity 0.3s ease' };
  // Ids of pins that are part of the itinerary — these stay sharp in route-focus.
  const itineraryIds = new Set((collabItinerary || []).map((s) => s.id));
  const [mapInstance, setMapInstance] = useState(null);
  const [mapsInstance, setMapsInstance] = useState(null);
  // The place pin whose card is "pinned open" by a click (stays until you click elsewhere).
  // This makes the card reliably appear on the map even on a dense/collab map where hover
  // is finicky.
  const [selectedPlaceId, setSelectedPlaceId] = useState(null);
  const lastBroadcast = useRef(0);
  const routeLine = useRef(null);

  // Draw the itinerary as a route polyline (stops connected in visiting order). The
  // itinerary arrives already sorted by its fractional-index `order`, so this reflects the
  // current plan — and updates live when anyone reorders or runs "Optimize route".
  useEffect(() => {
    if (!mapInstance || !mapsInstance) return undefined;

    // Clear any previous line.
    if (routeLine.current) {
      routeLine.current.setMap(null);
      routeLine.current = null;
    }

    // Only draw the route line in route-focus view (after "Optimize route"); it goes away
    // when the user exits route view.
    const stops = inCollab && routeFocus ? (collabItinerary || []) : [];
    if (stops.length < 2) return undefined;

    // The route path starts at the user's location (origin) when we have it, so the dotted
    // line visibly runs YOU → stop 1 → stop 2 → … (matching the distance/time which already
    // include that first leg).
    const pathPoints = [
      ...(routeOrigin ? [{ lat: Number(routeOrigin.lat), lng: Number(routeOrigin.lng) }] : []),
      ...stops.map((s) => ({ lat: Number(s.lat), lng: Number(s.lng) })),
    ];

    const ROUTE_COLOR = '#f2b705'; // golden/butter yellow — reads clearly on the map
    // Aesthetic DOTTED line: the base stroke is invisible (opacity 0); we render round dots
    // repeated along it, plus sparse arrowheads to show direction of travel.
    const dot = {
      path: mapsInstance.SymbolPath.CIRCLE,
      scale: 3,
      fillColor: ROUTE_COLOR, fillOpacity: 1,
      strokeColor: '#fff', strokeWeight: 1,
    };
    const arrow = {
      path: mapsInstance.SymbolPath.FORWARD_CLOSED_ARROW,
      scale: 3, fillColor: ROUTE_COLOR, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 1,
    };
    routeLine.current = new mapsInstance.Polyline({
      path: pathPoints,
      geodesic: true,
      strokeOpacity: 0, // hide the solid line; the icons below ARE the visible route
      icons: [
        { icon: dot, offset: '0', repeat: '14px' },       // the dotted trail
        { icon: arrow, offset: '0', repeat: '160px' },    // sparse direction arrows
      ],
      map: mapInstance,
    });

    return () => {
      if (routeLine.current) {
        routeLine.current.setMap(null);
        routeLine.current = null;
      }
    };
  }, [mapInstance, mapsInstance, inCollab, collabItinerary, routeOrigin, routeFocus]);

  // When route-focus turns ON, frame the whole route so every stop is visible at once.
  useEffect(() => {
    if (!routeFocus || !mapInstance || !mapsInstance) return;
    const stops = collabItinerary || [];
    if (stops.length < 2) return;
    const bounds = new mapsInstance.LatLngBounds();
    if (routeOrigin) bounds.extend({ lat: Number(routeOrigin.lat), lng: Number(routeOrigin.lng) });
    stops.forEach((s) => bounds.extend({ lat: Number(s.lat), lng: Number(s.lng) }));
    mapInstance.fitBounds(bounds, 64); // 64px padding so the start + all stops are visible
    // Only when focus toggles on (not on every itinerary edit), so it doesn't yank the map
    // around while you're inspecting the route.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeFocus, mapInstance, mapsInstance]);

  const colorForMember = (name) =>
    collabMembers?.find((m) => m.name === name)?.color || '#1976d2';

  // ✅ GOOGLE PLACES NEW API — HOTELS
  useEffect(() => {
    if (type === 'hotels' && mapInstance && mapsInstance) {
      setIsLoading(true);
      setError?.(null);

      const center = new mapsInstance.LatLng(coords.lat, coords.lng);

      const request = {
        fields: [
          'displayName',
          'location',
          'rating',
          'userRatingCount',
          'formattedAddress',
          'priceLevel',
          'photos'
        ],
        locationRestriction: {
          center: center,
          radius: 5000,
        },
        includedTypes: ['lodging'],
        maxResultCount: 20,
      };

      mapsInstance.places.Place.searchNearby(request)
        .then((response) => {
          const hotels = response.places.map((place) => ({
            name: place.displayName?.text || place.displayName|| 'No Name',
            rating: place.rating || 0,
            num_reviews: place.userRatingCount || 0,
            price_level: place.priceLevel,
            address: place.formattedAddress,
            photos: place.photos || [],
            latitude: place.location?.lat(),
            longitude: place.location?.lng(),
          }));

          // Apply the same rating filter the restaurants/attractions path uses,
          // so all three types behave consistently.
          const filtered = hotels.filter((place) => {
            if (!rating) return true;
            if (!place.rating) return true;
            return Number(place.rating) >= rating;
          });

          setPlaces(filtered);
          setIsLoading(false);
        })
        .catch((err) => {
          console.log("Hotels Error:", err);
          setError?.("Couldn't load hotels. Try again.");
          setIsLoading(false);
        });
    }
  }, [type, coords, rating, mapInstance, mapsInstance, setPlaces, setIsLoading, setError]);

  return (
    <Box sx={{ height: '100vh', width: '100%', position: 'relative' }}>
      {mapMoved && type !== 'hotels' && !memoriesMode && (
        <Button
          variant="contained"
          startIcon={<SearchIcon />}
          onClick={searchThisArea}
          sx={{
            position: 'absolute',
            top: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 5,
            borderRadius: '24px',
            boxShadow: 4,
            textTransform: 'none',
          }}
        >
          Search this area
        </Button>
      )}

      <GoogleMapReact
        bootstrapURLKeys={{ key: process.env.REACT_APP_GOOGLE_MAPS_API_KEY }}
        center={coords}
        defaultZoom={12}
        yesIWantToUseGoogleMapApiInternals
        onGoogleApiLoaded={({ map, maps }) => {
          setMapInstance(map);
          setMapsInstance(maps);
        }}
        options={{
          gestureHandling: 'greedy',
          clickableIcons: false,
          styles: mapStyles, // muted, minimal tiles so our UI + pins stand out
          disableDefaultUI: true,
          zoomControl: true,
        }}
        onChange={(e) => {
          if (e.marginBounds) {
            setCoords({ lat: e.center.lat, lng: e.center.lng });
            setBounds({ ne: e.marginBounds.ne, sw: e.marginBounds.sw });
            // Offer "Search this area" once the user moves the map (hotels search
            // automatically on pan, so the button only applies to RapidAPI types).
            if (type !== 'hotels') setMapMoved?.(true);

            // In collab mode, share our viewport so followers can mirror it — but only
            // when WE are driving (not while following someone else), and throttled to
            // avoid flooding the socket.
            if (inCollab && !following) {
              const now = Date.now();
              if (now - lastBroadcast.current > 300) {
                lastBroadcast.current = now;
                onBroadcastViewport?.({ lat: e.center.lat, lng: e.center.lng }, e.zoom);
              }
            }
          }
        }}
        onChildClick={(child) => setChildClicked(child)}
        // In memories mode, clicking an empty point on the map drops a memory pin there.
        // Otherwise, clicking empty map dismisses any open place card.
        onClick={({ lat, lng }) => {
          if (memoriesMode) onAddMemory?.(lat, lng);
          else setSelectedPlaceId(null);
        }}
      >
        {/* Normal search-result markers. Hidden in memories mode (different map) and whenever
            results are suppressed (route view, or after planning) so stale cards don't show. */}
        {!memoriesMode && !hideSearchResults && places?.map((place, i) => {
          const id = getPlaceId(place, i);
          // The card shows on hover OR when this pin is clicked-open (stays until dismissed).
          const isActive = hovered === id || selectedPlaceId === id;
          const CatIcon = type === 'hotels' ? HotelIcon : type === 'attractions' ? AttractionsIcon : RestaurantIcon;
          const photo = place.photo?.images?.large?.url || (place.photos?.length ? place.photos[0].getURI?.() : null);
          return (
          <Box
            key={id}
            lat={Number(place.latitude)}
            lng={Number(place.longitude)}
            onMouseEnter={() => setHovered?.(id)}
            onMouseLeave={() => setHovered?.(null)}
            onClick={(e) => {
              e.stopPropagation();
              setSelectedPlaceId((cur) => (cur === id ? null : id));
              // Tell the sidebar which place was clicked, so it can scroll to + expand it.
              setChildClicked?.(String(i));
              setHovered?.(id);
            }}
            sx={{
              position: 'absolute',
              transform: 'translate(-50%, -50%)',
              cursor: 'pointer',
              zIndex: isActive ? 6 : 2,
              '&:hover': { zIndex: 6 },
            }}
          >
            {/* Photo card AT the location: photo on top, then name + rating + open badge +
                distance. The card itself is the marker (no separate pin). In collab, the
                Add-to-trip button shows on the active card. */}
            <Paper
              elevation={isActive ? 10 : 3}
              sx={{
                width: 180, borderRadius: 2, overflow: 'hidden',
                border: '2px solid', borderColor: isActive ? 'primary.main' : 'transparent',
                transform: isActive ? 'scale(1.05)' : 'scale(1)',
                transition: 'transform 0.12s ease, box-shadow 0.12s ease',
              }}
            >
              <Box sx={{ position: 'relative' }}>
                {photo
                  ? <Box component="img" src={photo} alt={place.name}
                      sx={{ width: '100%', height: 88, objectFit: 'cover', display: 'block' }} />
                  : <Box sx={{ width: '100%', height: 88, bgcolor: 'primary.main', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <CatIcon sx={{ color: '#fff', fontSize: 30 }} />
                    </Box>}
                {/* Open/Closed badge over the photo. */}
                {placeOpenStatus(place) && (
                  <Box component="span" sx={{
                    position: 'absolute', top: 6, left: 6,
                    px: 0.75, py: 0.15, borderRadius: 1, fontSize: 10, fontWeight: 700,
                    bgcolor: /open/i.test(placeOpenStatus(place)) ? 'success.light' : 'grey.300',
                    color: /open/i.test(placeOpenStatus(place)) ? 'success.dark' : 'text.secondary',
                  }}>
                    {placeOpenStatus(place)}
                  </Box>
                )}
              </Box>
              <Box sx={{ p: 1 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 700, lineHeight: 1.2 }} noWrap>{place.name}</Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
                  {Number(place.rating) > 0 && (
                    <>
                      <Rating size="small" value={Number(place.rating)} precision={0.1} readOnly sx={{ fontSize: 14 }} />
                      <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>{Number(place.rating).toFixed(1)}</Typography>
                    </>
                  )}
                </Box>
                {placeDistance(coords, place) && (
                  <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>{placeDistance(coords, place)}</Typography>
                )}
                {inCollab && isActive && (
                  <Button
                    size="small" variant="contained" fullWidth
                    startIcon={<PushPinIcon sx={{ fontSize: 14 }} />}
                    onClick={(e) => { e.stopPropagation(); onAddCollabPin?.(place); }}
                    sx={{ mt: 0.75, textTransform: 'none', fontSize: 11, py: 0.3 }}
                  >
                    Add to trip
                  </Button>
                )}
              </Box>
            </Paper>
          </Box>
          );
        })}

        {/* Collab mode: shared pins from everyone in the trip, colored by who added it.
            These render on top of the normal place markers so you always see the group's
            pins — including ones added by friends looking elsewhere. */}
        {inCollab && collabPins?.map((pin) => (
          <Box
            key={pin.id}
            lat={Number(pin.lat)}
            lng={Number(pin.lng)}
            sx={{
              position: 'absolute',
              transform: 'translate(-50%, -100%)',
              zIndex: 4,
              // Optimistic pin not yet confirmed by the server — show it semi-transparent.
              opacity: pin._pending ? 0.5 : 1,
              transition: 'opacity 0.25s',
              // Route-focus: dim pins that aren't part of the route (itinerary pins stay sharp).
              ...(routeFocus && !itineraryIds.has(pin.id) ? dimmedSx : focusTransition),
            }}
          >
            <Tooltip title={`${pin.placeName} · ${pin.addedBy}`}>
              <PushPinIcon
                sx={{
                  fontSize: 34,
                  color: colorForMember(pin.addedBy),
                  filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.4))',
                }}
              />
            </Tooltip>
          </Box>
        ))}

        {/* Route start = the user's location. Shows a "You" marker so it's clear the route
            (and its distance/time) begins from where you are, not from stop 1. */}
        {inCollab && routeOrigin && (
          <Box
            lat={Number(routeOrigin.lat)}
            lng={Number(routeOrigin.lng)}
            sx={{ position: 'absolute', transform: 'translate(-50%, -50%)', zIndex: 6 }}
          >
            <Tooltip title="Your start location">
              <Box sx={{
                display: 'flex', alignItems: 'center', gap: 0.5,
                bgcolor: '#1976d2', color: '#fff', borderRadius: 999,
                px: 1, py: 0.4, fontSize: 12, fontWeight: 700,
                border: '2px solid #fff', boxShadow: '0 2px 6px rgba(0,0,0,0.4)', whiteSpace: 'nowrap',
              }}>
                <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#fff' }} />
                You
              </Box>
            </Tooltip>
          </Box>
        )}

        {/* Collab mode: numbered TEARDROP markers on each itinerary stop, marking its order
            along the route. Updates live as the plan is reordered/optimized. */}
        {inCollab && collabItinerary?.map((stop, i) => (
          <Box
            key={`itin-${stop.id}`}
            lat={Number(stop.lat)}
            lng={Number(stop.lng)}
            sx={{
              position: 'absolute',
              transform: 'translate(-50%, -100%)', // tip of the teardrop sits on the point
              zIndex: 5,
            }}
          >
            <Tooltip title={`${i + 1}. ${stop.placeName}`}>
              <Box
                sx={{
                  width: 30, height: 30, borderRadius: '50% 50% 50% 0',
                  transform: 'rotate(-45deg)',
                  bgcolor: '#f2b705',
                  border: '2px solid #fff',
                  boxShadow: '0 2px 5px rgba(0,0,0,0.4)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <Box component="span" sx={{ transform: 'rotate(45deg)', color: '#3a2e00', fontSize: 13, fontWeight: 700 }}>
                  {i + 1}
                </Box>
              </Box>
            </Tooltip>
          </Box>
        ))}

        {/* Memories mode: a camera marker per memory pin. Shows the first photo as a
            thumbnail once one is attached; click to fly the map to it. */}
        {memoriesMode && memories?.map((memory) => (
          <Box
            key={memory.id}
            lat={Number(memory.lat)}
            lng={Number(memory.lng)}
            onClick={() => onMemoryClick?.(memory)}
            sx={{
              position: 'absolute',
              transform: 'translate(-50%, -100%)',
              zIndex: 5,
              cursor: 'pointer',
            }}
          >
            <Tooltip title={`${memory.title}${memory.note ? ` · ${memory.note}` : ''}`}>
              {memory.photos?.length ? (
                <Box
                  component="img"
                  src={thumbUrl(memory.photos[0].url, 96)}
                  alt={memory.title}
                  sx={{
                    width: 48, height: 48, objectFit: 'cover',
                    borderRadius: '8px', border: '3px solid #fff',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
                  }}
                />
              ) : (
                <Box
                  sx={{
                    width: 36, height: 36, borderRadius: '50%',
                    bgcolor: '#7b1fa2', color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: '2px solid #fff',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
                  }}
                >
                  <PhotoCameraIcon sx={{ fontSize: 20 }} />
                </Box>
              )}
            </Tooltip>
          </Box>
        ))}
      </GoogleMapReact>
    </Box>
  );
};

export default Map;