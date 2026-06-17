import React, { useState, useEffect, createRef } from 'react';
import {
  CircularProgress, Typography, Box, Alert, Chip, Rating, ToggleButton, ToggleButtonGroup,
} from '@mui/material';
import RestaurantIcon from '@mui/icons-material/Restaurant';
import PlaceIcon from '@mui/icons-material/Place';
import { getPlaceId } from '../../utils/placeId';
import { haversine } from '../../utils/route';

// Address across the two data sources, if present.
const addressOf = (place) => place.address || place.formatted_address || place.vicinity || null;
const reviewsOf = (place) => place.num_reviews || place.user_ratings_total || null;

// A place's photo URL across the two data sources (RapidAPI vs Google).
const photoOf = (place) =>
  place.photo?.images?.large?.url ||
  (place.photos?.length ? place.photos[0].getURI?.() : null);

// "Open now" / "Closes …" if the data actually carries hours; otherwise null (we hide it
// rather than fake it). RapidAPI sometimes provides `is_closed`/`open_now_text`.
const openStatus = (place) => {
  if (place.open_now_text) return place.open_now_text; // e.g. "Open now", "Closed"
  if (place.is_closed === false) return 'Open now';
  if (place.is_closed === true) return 'Closed';
  return null;
};

// Distance from the user (coords) to a place, formatted — only if we know both.
const distanceLabel = (coords, place) => {
  const lat = Number(place.latitude);
  const lng = Number(place.longitude);
  if (!coords || Number.isNaN(lat) || Number.isNaN(lng)) return null;
  const km = haversine(coords, { lat, lng });
  return km < 1 ? `${Math.round(km * 1000)} m away` : `${km.toFixed(1)} km away`;
};

const List = ({ places, type, setType, rating, setRating, childClicked, setChildClicked, isLoading, error, hovered, setHovered, coords }) => {
  const [elRefs, setElRefs] = useState([]);

  useEffect(() => {
    setElRefs((refs) => Array(places?.length).fill().map((_, i) => refs[i] || createRef()));
  }, [places]);

  // When a place is selected (e.g. clicked on the map), scroll its row into view here.
  useEffect(() => {
    if (childClicked == null || childClicked === '') return; // nothing selected
    const idx = Number(childClicked);
    if (!Number.isNaN(idx) && elRefs[idx]?.current) {
      elRefs[idx].current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [childClicked, elRefs]);

  return (
    <Box sx={{ p: 2 }}>
      {/* Floating "Nearby places" card */}
      <Box sx={{
        bgcolor: 'background.paper', borderRadius: 3, boxShadow: 4,
        overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 100px)',
      }}>
        {/* Header */}
        <Box sx={{ p: 2, pb: 1.5 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.1 }}>Nearby places</Typography>
          <Typography variant="caption" color="text.secondary">
            {isLoading ? 'Searching…' : `${places?.length || 0} result${places?.length === 1 ? '' : 's'}`}
          </Typography>

          {/* Pill tabs */}
          <Box sx={{ mt: 1.5 }}>
            <ToggleButtonGroup
              value={type}
              exclusive
              onChange={(e, v) => v && setType(v)}
              size="small"
              sx={{
                gap: 1,
                '& .MuiToggleButton-root': {
                  border: '1px solid', borderColor: 'divider', borderRadius: '999px !important',
                  textTransform: 'none', px: 2, py: 0.4,
                  '&.Mui-selected': { bgcolor: 'primary.main', color: 'primary.contrastText', '&:hover': { bgcolor: 'primary.dark' } },
                },
              }}
            >
              <ToggleButton value="restaurants">Restaurants</ToggleButton>
              <ToggleButton value="hotels">Hotels</ToggleButton>
              <ToggleButton value="attractions">Attractions</ToggleButton>
            </ToggleButtonGroup>
          </Box>
        </Box>

        {/* Rows */}
        <Box sx={{ overflow: 'auto', borderTop: '1px solid', borderColor: 'divider' }}>
          {isLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
          ) : error ? (
            <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>
          ) : !places?.length ? (
            <Box sx={{ textAlign: 'center', color: 'text.secondary', py: 6, px: 2 }}>
              <Typography variant="body2">No places found here. Try moving the map and "Search this area".</Typography>
            </Box>
          ) : (
            places.map((place, i) => {
              const id = getPlaceId(place, i);
              // Guard against null/'' — Number(null) is 0, which would wrongly match index 0.
              const expanded = childClicked != null && childClicked !== '' && Number(childClicked) === i;
              const active = hovered === id || expanded;
              const photo = photoOf(place);
              const open = openStatus(place);
              const dist = distanceLabel(coords, place);
              return (
                <Box
                  key={id}
                  ref={elRefs[i]}
                  onMouseEnter={() => setHovered?.(id)}
                  onMouseLeave={() => setHovered?.(null)}
                  onClick={() => setChildClicked?.((cur) => (Number(cur) === i ? null : String(i)))}
                  sx={{
                    cursor: 'pointer', borderBottom: '1px solid', borderColor: 'divider',
                    bgcolor: expanded ? 'action.selected' : active ? 'action.hover' : 'transparent',
                    transition: 'background-color 0.15s',
                    '&:hover': { bgcolor: 'action.hover' },
                  }}
                >
                  {/* Slim row: thumbnail + name + rating + distance. */}
                  <Box sx={{ display: 'flex', gap: 1.5, p: 1.5 }}>
                    <Box sx={{
                      width: 52, height: 52, borderRadius: 2, flexShrink: 0, overflow: 'hidden',
                      bgcolor: 'action.hover', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {photo
                        ? <Box component="img" src={photo} alt={place.name} sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : <RestaurantIcon sx={{ color: 'text.disabled' }} />}
                    </Box>
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700 }} noWrap>{place.name}</Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.25 }}>
                        {Number(place.rating) > 0 && (
                          <>
                            <Rating value={Number(place.rating)} precision={0.1} size="small" readOnly />
                            <Typography variant="caption" color="text.secondary">{Number(place.rating).toFixed(1)}</Typography>
                          </>
                        )}
                        {open && (
                          <Chip size="small" label={open}
                            sx={{ height: 18, fontSize: 11, bgcolor: /open/i.test(open) ? 'success.light' : 'grey.300', color: /open/i.test(open) ? 'success.dark' : 'text.secondary' }} />
                        )}
                      </Box>
                      {dist && <Typography variant="caption" color="text.secondary">{dist}</Typography>}
                    </Box>
                  </Box>

                  {/* Expanded detail — shown when this place is selected (clicked on the map).
                      A bigger photo + whatever extra fields the data actually has. */}
                  {expanded && (
                    <Box sx={{ px: 1.5, pb: 1.5 }}>
                      {photo && (
                        <Box component="img" src={photo} alt={place.name}
                          sx={{ width: '100%', height: 140, objectFit: 'cover', borderRadius: 2, mb: 1 }} />
                      )}
                      {reviewsOf(place) && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                          {reviewsOf(place)} reviews
                        </Typography>
                      )}
                      {addressOf(place) && (
                        <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5 }}>
                          <PlaceIcon sx={{ fontSize: 16, color: 'text.disabled', mt: '1px' }} />
                          <Typography variant="caption" color="text.secondary">{addressOf(place)}</Typography>
                        </Box>
                      )}
                      {place.web_url && (
                        <Typography
                          variant="caption" component="a" href={place.web_url} target="_blank" rel="noreferrer"
                          sx={{ display: 'block', mt: 0.5, color: 'primary.main', textDecoration: 'none' }}
                        >
                          View details →
                        </Typography>
                      )}
                    </Box>
                  )}
                </Box>
              );
            })
          )}
        </Box>
      </Box>
    </Box>
  );
};

export default List;
