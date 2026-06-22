import React, { useState } from 'react';
import {
  Box, Typography, List, ListItem, ListItemText, IconButton, Divider, Avatar,
  Tooltip, Chip, Button,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import AddLocationAltIcon from '@mui/icons-material/AddLocationAlt';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import RouteIcon from '@mui/icons-material/Route';
import TrafficIcon from '@mui/icons-material/Traffic';
import ReplayIcon from '@mui/icons-material/Replay';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';

const colorFor = (members, name) =>
  members.find((m) => m.name === name)?.color || '#777';

// Sidebar for trip mode: the shared pins bucket + the co-edited ordered itinerary.
const CollabPanel = ({
  pins, itinerary, members,
  onFlyTo, onRemovePin, onAddToItinerary, onRemoveFromItinerary, onMoveItineraryItem,
  onRetryItem, onOptimizeRoute, routeFocus, onExitRouteFocus,
}) => {
  // Last route summary returned by the optimizer (total distance + method), shown inline.
  const [route, setRoute] = useState(null);
  const [optimizing, setOptimizing] = useState(false);
  // The route's starting point — the user's GPS location, captured fresh each optimize.
  const [origin, setOrigin] = useState(null);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState(null);
  // Which itinerary stop is "active" (clicked) — its number circle goes amber.
  const [activeItineraryId, setActiveItineraryId] = useState(null);

  // Run the optimizer from a given origin and show the result summary.
  const runOptimize = async (from) => {
    setOptimizing(true);
    try {
      const result = await onOptimizeRoute?.(from);
      if (result) setRoute(result);
    } finally {
      setOptimizing(false);
    }
  };

  // Clicking "Optimize route" ALWAYS starts the route from the user's real GPS location.
  // We fetch a fresh device location each time (never the map center), so the route begins
  // where YOU are, not at whatever place is selected/centered.
  const onOptimizeClick = () => {
    if (!navigator.geolocation) {
      setLocError('Geolocation not supported by your browser.');
      return;
    }
    setLocating(true);
    setLocError(null);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const here = { lat: coords.latitude, lng: coords.longitude };
        setOrigin(here);
        setLocating(false);
        runOptimize(here);
      },
      () => {
        setLocating(false);
        setLocError("Couldn't get your location — allow location access to optimize from where you are.");
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };
  // Itinerary edits are granular actions: each touches one item, so concurrent edits by
  // different people merge instead of overwriting the whole list.
  const move = (item, index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= itinerary.length) return;
    onMoveItineraryItem(item.id, target);
  };

  const inItinerary = (pinId) => itinerary.some((i) => i.id === pinId);

  return (
    <Box sx={{ p: 2 }}>
      {/* ---- Shared pins ---- */}
      <Typography variant="h6" gutterBottom>
        Shared pins {pins.length > 0 && <Chip size="small" label={pins.length} sx={{ ml: 1 }} />}
      </Typography>
      {pins.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          No pins yet. Click a place on the map and add it — everyone in the trip will
          see it instantly.
        </Typography>
      ) : (
        <List dense>
          {pins.map((pin) => (
            <ListItem
              key={pin.id}
              sx={{
                borderRadius: 1, '&:hover': { bgcolor: 'action.hover' },
                opacity: pin._pending ? 0.55 : 1, // optimistic pin, awaiting server confirmation
                transition: 'opacity 0.25s',
              }}
              secondaryAction={
                <Box>
                  <Tooltip title={inItinerary(pin.id) ? 'Already in itinerary' : 'Add to itinerary'}>
                    <span>
                      <IconButton
                        edge="end"
                        size="small"
                        disabled={inItinerary(pin.id)}
                        onClick={() => onAddToItinerary(pin)}
                      >
                        <AddLocationAltIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <IconButton edge="end" size="small" onClick={() => onRemovePin(pin.id)}>
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Box>
              }
            >
              <Avatar sx={{ width: 24, height: 24, bgcolor: colorFor(members, pin.addedBy), fontSize: 12, mr: 1.5 }}>
                {pin.addedBy?.[0]?.toUpperCase()}
              </Avatar>
              <ListItemText
                primary={pin.placeName}
                secondary={`by ${pin.addedBy}`}
                onClick={() => onFlyTo(pin)}
                sx={{ cursor: 'pointer' }}
                primaryTypographyProps={{ noWrap: true }}
              />
            </ListItem>
          ))}
        </List>
      )}

      <Divider sx={{ my: 2 }} />

      {/* ---- Collaborative itinerary ---- */}
      <Typography variant="h6" gutterBottom>
        Itinerary {itinerary.length > 0 && <Chip size="small" label={`${itinerary.length} stops`} sx={{ ml: 1 }} />}
      </Typography>
      {itinerary.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Add pins to the itinerary to build an ordered plan together. Everyone can
          reorder it live.
        </Typography>
      ) : (
        <>
        {/* Stats header — big numbers + live-traffic strip, shown once a route is computed. */}
        {route && route.method === 'traffic' && route.minutes != null && (
          <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, mb: 1.5, overflow: 'hidden' }}>
            <Box sx={{ display: 'flex', textAlign: 'center', py: 1.25 }}>
              {[
                { v: Math.round(route.minutes), u: 'min' },
                { v: Math.round(route.distance), u: 'km' },
                { v: itinerary.length, u: itinerary.length === 1 ? 'stop' : 'stops' },
              ].map((s, k) => (
                <Box key={s.u} sx={{ flex: 1, borderLeft: k ? '1px solid' : 'none', borderColor: 'divider' }}>
                  <Typography sx={{ fontSize: 22, fontWeight: 800, color: 'primary.main', lineHeight: 1 }}>{s.v}</Typography>
                  <Typography variant="caption" color="text.secondary">{s.u}</Typography>
                </Box>
              ))}
            </Box>
            <Box sx={{ bgcolor: 'warning.main', color: 'warning.contrastText', px: 1.5, py: 0.5, display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <TrafficIcon sx={{ fontSize: 16 }} />
              <Typography variant="caption" sx={{ fontWeight: 600 }}>
                Live traffic{origin ? ' · from your location' : ''}
              </Typography>
            </Box>
          </Box>
        )}

        <List dense>
          {itinerary.map((item, index) => {
            const isActive = activeItineraryId === item.id;
            return (
            <ListItem
              key={item.id}
              sx={{
                borderRadius: 1,
                bgcolor: item.failed ? 'rgba(229,57,53,0.10)' : (isActive ? 'action.hover' : 'transparent'),
                '&:hover': { bgcolor: item.failed ? 'rgba(229,57,53,0.16)' : 'action.hover' },
                // Optimistic edit not yet confirmed by the server — dim it slightly. A failed
                // edit is shown at full opacity (it needs attention), tinted red instead.
                opacity: item.unconfirmed ? 0.55 : 1,
                transition: 'opacity 0.25s, background-color 0.25s',
              }}
              secondaryAction={
                <Box sx={{ display: 'flex' }}>
                  {item.failed ? (
                    <Tooltip title="Couldn't save — retry">
                      <IconButton size="small" color="error" onClick={() => onRetryItem?.(item.id)}>
                        <ReplayIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  ) : (
                    <>
                      <IconButton size="small" onClick={() => move(item, index, -1)} disabled={index === 0}>
                        <ArrowUpwardIcon fontSize="small" />
                      </IconButton>
                      <IconButton size="small" onClick={() => move(item, index, 1)} disabled={index === itinerary.length - 1}>
                        <ArrowDownwardIcon fontSize="small" />
                      </IconButton>
                    </>
                  )}
                  <IconButton size="small" onClick={() => onRemoveFromItinerary(item.id)}>
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Box>
              }
            >
              {/* Numbered circle — red on failure, amber for the active stop, olive otherwise. */}
              <Avatar sx={{
                width: 26, height: 26, fontSize: 13, mr: 1.5, fontWeight: 700,
                bgcolor: item.failed ? 'error.main' : (isActive ? 'warning.main' : 'primary.main'),
                color: item.failed ? '#fff' : (isActive ? 'warning.contrastText' : 'primary.contrastText'),
              }}>
                {item.failed ? <ErrorOutlineIcon sx={{ fontSize: 16 }} /> : index + 1}
              </Avatar>
              <ListItemText
                primary={item.placeName}
                secondary={
                  item.failed
                    ? "Couldn't save — tap retry"
                    : (item.unconfirmed ? 'syncing…' : (isActive ? 'active stop' : null))
                }
                onClick={() => { setActiveItineraryId(item.id); onFlyTo(item); }}
                sx={{ cursor: 'pointer' }}
                primaryTypographyProps={{ noWrap: true, fontWeight: 600 }}
                secondaryTypographyProps={item.failed ? { color: 'error.main', fontWeight: 600 } : undefined}
              />
            </ListItem>
            );
          })}
        </List>

        {/* Full-width Optimize / Exit button at the bottom. */}
        {itinerary.length >= 2 && (
          <>
            <Button
              fullWidth
              variant={routeFocus ? 'outlined' : 'contained'}
              disabled={optimizing || locating}
              startIcon={<RouteIcon fontSize="small" />}
              onClick={routeFocus ? onExitRouteFocus : onOptimizeClick}
              sx={{ textTransform: 'none', mt: 1, py: 1, fontWeight: 700 }}
            >
              {locating ? 'Getting location…' : optimizing ? 'Optimizing…' : routeFocus ? 'Exit route view' : 'Optimize route'}
            </Button>
            {locError && (
              <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.5 }}>
                {locError}
              </Typography>
            )}
          </>
        )}
        </>
      )}
    </Box>
  );
};

export default CollabPanel;
