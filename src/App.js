import React, { useState, useEffect, useCallback } from 'react';
import { CssBaseline, Grid, Box, Drawer, Button } from '@mui/material';
import PhotoLibraryIcon from '@mui/icons-material/PhotoLibrary';
import CloseIcon from '@mui/icons-material/Close';
import HomeIcon from '@mui/icons-material/Home';
import Header from './components/Header/Header';
import Map from './components/Map/Map';
import List from './components/List/List';
import JoinTripDialog from './components/Collab/JoinTripDialog';
import CollabBar from './components/Collab/CollabBar';
import CollabPanel from './components/Collab/CollabPanel';
import MemoriesPanel from './components/Memories/MemoriesPanel';
import PhotoSlideshow from './components/Memories/PhotoSlideshow';
import MemorySearch from './components/Memories/MemorySearch';
import CinematicIntro from './components/Intro/CinematicIntro';
import { AnimatePresence } from 'framer-motion';
import { useTripCode } from './collab/useTripCode';
import { useCollabTrip } from './collab/useCollabTrip';
import { createTrip as createCollabTrip } from './collab/tripApi';
import { useMemories } from './memories/useMemories';
import { useAuth } from './memories/useAuth';
import { reverseGeocode } from './memories/geocode';
import { getPlacesData } from './api/travelAdvisorAPI';

// Stable id for a place/pin across API shapes (mirrors utils/placeId but inline here
// to build pins from either data source).
const pinIdFor = (place) =>
  place.location_id || place.place_id || `${place.name}-${place.latitude}-${place.longitude}`;

const App = () => {
  // Cinematic intro plays on every load (skippable). The app renders behind it.
  const [introDone, setIntroDone] = useState(false);

  const [coords, setCoords] = useState({ lat: 28.6315, lng: 77.2167 });
  const [bounds, setBounds] = useState(null);
  const [cache, setCache] = useState({});
  const [places, setPlaces] = useState([]);
  const [type, setType] = useState('restaurants');
  const [rating, setRating] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [childClicked, setChildClicked] = useState(null);
  const [hovered, setHovered] = useState(null);
  // Incremented to trigger a fetch of the current map area. The user drives this via
  // the "Search this area" button (or by changing type/rating) instead of refetching
  // on every map pan, which protects the API quota.
  const [searchTrigger, setSearchTrigger] = useState(0);
  // True when the map has moved away from the area we last loaded, so we can offer
  // the "Search this area" button.
  const [mapMoved, setMapMoved] = useState(false);

  // Collaborative-trip mode: a shared, real-time trip joined via /trip/:code.
  const { code: collabCode, enterTrip, leaveTrip } = useTripCode();
  const [collabName, setCollabName] = useState(null);
  const inCollab = Boolean(collabCode && collabName);
  const collab = useCollabTrip(collabCode, collabName);

  // "Route focus" view: after optimizing, spotlight the route + its stops and hide the
  // search-result cards and non-itinerary pins so the plan reads clearly.
  const [routeFocus, setRouteFocus] = useState(false);
  // When true, search-result cards are NOT shown on the map even if `places` holds cached
  // results. We suppress after optimizing/exiting route view so stale cards don't reappear,
  // and only un-suppress when the user actively runs a search. This beats clearing `places`,
  // which the cache would just refill on the next trigger.
  const [suppressResults, setSuppressResults] = useState(false);

  // Memories mode: a private personal map of saved pins with photos, scoped to the signed-in
  // user. Takes over the screen (search + collab are hidden) while active. The sidebar (the
  // location list) is hidden by default — opened via "See all memories".
  const [memoriesMode, setMemoriesMode] = useState(false);
  const [memoriesSidebarOpen, setMemoriesSidebarOpen] = useState(false);
  const [slideshowId, setSlideshowId] = useState(null); // memory whose photos are open
  const [focusedMemoryId, setFocusedMemoryId] = useState(null); // most recently touched memory
  const auth = useAuth();
  const memories = useMemories(auth);

  const toggleMemories = useCallback(() => {
    setMemoriesMode((on) => !on);
    setMemoriesSidebarOpen(false);
    setSlideshowId(null);
  }, []);

  // Clicking a pin: fly there, and either open its photo slideshow (if it has photos) or
  // open the sidebar so you can add photos to it. Either way we always open the sidebar and
  // mark this memory as the focused one so it scrolls into view / highlights.
  const openMemorySlideshow = useCallback((memory) => {
    setCoords({ lat: memory.lat, lng: memory.lng });
    setFocusedMemoryId(memory.id);
    if (memory.photos?.length) {
      setSlideshowId(memory.id);
    } else {
      // No photos yet → open the sidebar so the user can add some to this pin.
      setMemoriesSidebarOpen(true);
    }
  }, []);

  // Click the map in memories mode to drop a memory pin. Auto-name it (reverse geocode),
  // create it, open the sidebar, and focus it so it sits ready at the top for adding photos.
  const addMemoryAt = useCallback(async (lat, lng) => {
    setCoords({ lat, lng });
    setMemoriesSidebarOpen(true); // always pop the sidebar out — shows the sign-in gate when logged out
    if (!auth.user) return; // not signed in: sidebar now shows the sign-in gate, don't try to save
    const title = await reverseGeocode(lat, lng);
    try {
      const created = await memories.addMemory({ lat, lng, title });
      if (created) setFocusedMemoryId(created.id);
    } catch { /* surfaced via memories.error */ }
  }, [memories, auth.user]);

  const startCollabTrip = useCallback(async () => {
    try {
      const created = await createCollabTrip();
      enterTrip(created.code);
    } catch {
      setError("Couldn't start a shared trip. Is the server running?");
    }
  }, [enterTrip]);

  const leaveCollab = useCallback(() => {
    collab.stopFollowing();
    setCollabName(null);
    leaveTrip();
  }, [collab, leaveTrip]);

  const searchThisArea = () => {
    setMapMoved(false);
    setSuppressResults(false); // user is actively searching → show results again
    setSearchTrigger((n) => n + 1);
  };

  // While following a friend, mirror their map view onto ours.
  useEffect(() => {
    if (collab.followViewport?.center) {
      setCoords(collab.followViewport.center);
    }
  }, [collab.followViewport]);

  // Add the currently-pinned place to the shared trip.
  const addCollabPin = useCallback((place) => {
    collab.addPin({
      id: pinIdFor(place),
      placeName: place.name || 'Pinned place',
      lat: Number(place.latitude),
      lng: Number(place.longitude),
    });
  }, [collab]);

  // Promote a pin into the ordered itinerary (append to the end). The hook assigns the
  // fractional-index order key and the server reconciles it.
  const addToItinerary = useCallback((pin) => {
    collab.addItineraryItem({
      id: pin.id, placeName: pin.placeName, lat: pin.lat, lng: pin.lng,
    });
  }, [collab]);

  const flyToPin = useCallback((pinOrItem) => {
    setCoords({ lat: pinOrItem.lat, lng: pinOrItem.lng });
  }, []);

  // The user's location used as the route's start — kept so the map can draw a "You" marker
  // and connect the route line from you to the first stop.
  const [routeOrigin, setRouteOrigin] = useState(null);

  // Optimize the route AND enter route-focus view. `origin` is the user's REAL GPS location
  // (fetched by the panel each time), so the route starts where YOU are — not the map center.
  const optimizeAndFocus = useCallback(async (origin) => {
    const start = origin || coords;
    const result = await collab.optimizeItinerary(start);
    if (result) {
      setRouteOrigin(start);
      setRouteFocus(true);
      setSuppressResults(true); // hide search cards for a clean route view
    }
    return result;
  }, [collab, coords]);

  // Exit route-focus but KEEP search cards suppressed, so the last search's cards don't
  // reappear and crowd the map. (Run a new search anytime to see places again.)
  const exitRouteFocus = useCallback(() => {
    setRouteFocus(false);
    setSuppressResults(true);
    setRouteOrigin(null);
  }, []);

  // Leaving the trip should drop route-focus too.
  useEffect(() => {
    if (!inCollab) setRouteFocus(false);
  }, [inCollab]);

  // Clear places when switching to hotels
  useEffect(() => {
    if (type === 'hotels') {
      setPlaces([]);
    }
  }, [type]);

  // Re-search automatically when the user changes type or rating (an active search intent,
  // so show results again).
  useEffect(() => {
    setSuppressResults(false);
    setSearchTrigger((n) => n + 1);
  }, [type, rating]);

  // Restaurants & Attractions (RapidAPI) — runs only when the user asks to search.
  useEffect(() => {
    if (!bounds || type === 'hotels') return;

    const sw = bounds.sw;
    const ne = bounds.ne;

    if (!sw || !ne) return;

    const key = `${type}-${sw?.lat?.toFixed(3)}-${sw?.lng?.toFixed(3)}-${ne?.lat?.toFixed(3)}-${ne?.lng?.toFixed(3)}`;

    // Check cache
    if (cache[key] && Date.now() - cache[key].time < 10 * 60 * 1000) {
      setPlaces(cache[key].data);
      return;
    }

    // Clear the previous search's results so cards from earlier searches don't linger on
    // the map while the new ones load (they used to pile up across searches).
    setPlaces([]);
    setChildClicked(null); // clear any prior selection so nothing's highlighted on a new search
    setIsLoading(true);
    setError(null);

    getPlacesData(type, sw, ne)
      .then((data) => {
        const filtered = data?.filter((place) => {
          if (!rating) return true;
          if (!place.rating) return true;
          return Number(place.rating) >= rating;
        });

        setPlaces(filtered || []);
        setSuppressResults(false); // fresh results arrived → make sure they're shown

        // Save to cache
        setCache((prev) => ({
          ...prev,
          [key]: {
            data: filtered || [],
            time: Date.now(),
          },
        }));

        setIsLoading(false);
      })
      .catch(() => {
        setError("Couldn't load places. Check your connection and try again.");
        setIsLoading(false);
      });
    // `bounds` and `cache` are intentionally excluded: we fetch only when the user
    // triggers a search (searchTrigger), reading the latest bounds at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTrigger]);

  // Memories mode renders its own full-screen layout: a full-width map of the user's pins,
  // a toggleable sidebar drawer (the location list), and a full-size photo slideshow.
  // The cinematic intro overlays whatever's rendered, on every load until dismissed.
  const intro = !introDone ? <CinematicIntro onDone={() => setIntroDone(true)} /> : null;

  if (memoriesMode) {
    const slideshowMemory = memories.memories.find((m) => m.id === slideshowId) || null;
    return (
      <>
        {intro}
        <CssBaseline />
        <Header
          setCoords={setCoords}
          inCollab={false}
          memoriesMode
          onToggleMemories={toggleMemories}
        />

        <Box sx={{ position: 'relative', width: '100vw', height: 'calc(100vh - 64px)' }}>
          {/* Full-width memories map */}
          <Map
            coords={coords}
            setCoords={setCoords}
            setBounds={setBounds}
            places={[]}
            setChildClicked={setChildClicked}
            type={type}
            setPlaces={setPlaces}
            setIsLoading={setIsLoading}
            setError={setError}
            hovered={hovered}
            setHovered={setHovered}
            mapMoved={mapMoved}
            setMapMoved={setMapMoved}
            searchThisArea={searchThisArea}
            memoriesMode
            memories={memories.memories}
            onAddMemory={addMemoryAt}
            onMemoryClick={openMemorySlideshow}
          />

          {/* Top controls: Home (back to main dashboard) + "See all memories" (opens
              sidebar) + a place search to fly the map anywhere without dragging. */}
          <Box sx={{ position: 'absolute', top: 16, left: 16, zIndex: 5, display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
            <Button
              variant="contained"
              color="secondary"
              startIcon={<HomeIcon />}
              onClick={toggleMemories}
              sx={{ textTransform: 'none', boxShadow: 4 }}
            >
              Home
            </Button>
            {!memoriesSidebarOpen && (
              <Button
                variant="contained"
                startIcon={<PhotoLibraryIcon />}
                onClick={() => setMemoriesSidebarOpen(true)}
                sx={{ textTransform: 'none', boxShadow: 4 }}
              >
                See all memories
              </Button>
            )}
            <MemorySearch setCoords={setCoords} />
          </Box>

          {/* The location list, as a closeable drawer */}
          <Drawer
            anchor="left"
            open={memoriesSidebarOpen}
            onClose={() => setMemoriesSidebarOpen(false)}
            PaperProps={{ sx: { width: { xs: '85vw', sm: 380 } } }}
          >
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', p: 1 }}>
              <Button size="small" startIcon={<CloseIcon />} onClick={() => setMemoriesSidebarOpen(false)} sx={{ textTransform: 'none' }}>
                Close
              </Button>
            </Box>
            <MemoriesPanel
              memories={memories.memories}
              loading={memories.loading}
              user={auth.user}
              authReady={auth.ready}
              focusedMemoryId={focusedMemoryId}
              onSignIn={auth.signIn}
              onSignOut={auth.signOut}
              onFlyTo={openMemorySlideshow}
              onOpenSlideshow={openMemorySlideshow}
              onUpdateMemory={memories.updateMemory}
              onRemoveMemory={memories.removeMemory}
              onAddPhoto={memories.addPhoto}
              onAddPhotos={memories.addPhotos}
              onRemovePhoto={memories.removePhoto}
            />
          </Drawer>

          {/* Full-size cinematic photo slideshow for the clicked pin. AnimatePresence lets
              its fade-up/fade-out run on open and close. */}
          <AnimatePresence>
            {slideshowMemory && (
              <PhotoSlideshow
                key={slideshowMemory.id}
                memory={slideshowMemory}
                onClose={() => setSlideshowId(null)}
              />
            )}
          </AnimatePresence>
        </Box>
      </>
    );
  }

  return (
    <>
      {intro}
      <CssBaseline />
      <Header
        setCoords={setCoords}
        onStartCollab={startCollabTrip}
        inCollab={inCollab}
        memoriesMode={memoriesMode}
        onToggleMemories={toggleMemories}
      />

      {/* Ask for a display name when we have a trip code but haven't joined yet */}
      <JoinTripDialog
        open={Boolean(collabCode) && !collabName}
        code={collabCode}
        onJoin={setCollabName}
      />

      {/* Presence + sharing strip while inside a shared trip */}
      {inCollab && (
        <CollabBar
          code={collabCode}
          members={collab.members}
          you={collab.you}
          followingName={collab.followingName}
          onFollow={collab.follow}
          onStopFollowing={collab.stopFollowing}
          onLeave={leaveCollab}
        />
      )}

      <Grid container sx={{width: '100vw', height: '100vh' }}>
        {/* SIDEBAR — collab panel in a shared trip, otherwise the places list. (Memories
            mode has its own full-screen layout above.) */}
        <Grid size={{xs:12,md:4}} sx={{ height: '100vh', overflow: 'auto' }}>
          {inCollab ? (
            <CollabPanel
              pins={collab.pins}
              itinerary={collab.itinerary}
              members={collab.members}
              onFlyTo={flyToPin}
              onRemovePin={collab.removePin}
              onAddToItinerary={addToItinerary}
              onRemoveFromItinerary={collab.removeItineraryItem}
              onMoveItineraryItem={collab.moveItineraryItem}
              onRetryItem={collab.retryItem}
              onOptimizeRoute={optimizeAndFocus}
              routeFocus={routeFocus}
              onExitRouteFocus={exitRouteFocus}
            />
          ) : (
            <List
              places={places}
              type={type}
              setType={setType}
              rating={rating}
              setRating={setRating}
              childClicked={childClicked}
              setChildClicked={setChildClicked}
              isLoading={isLoading}
              error={error}
              hovered={hovered}
              setHovered={setHovered}
              coords={coords}
            />
          )}
        </Grid>

        {/* MAP */}
        <Grid size={{xs:12,md:8}}  sx={{ height: '100vh' }}>
          <Box sx={{ height: '100%', width: '100%' }}>
            <Map
              coords={coords}
              setCoords={setCoords}
              setBounds={setBounds}
              places={places}
              setChildClicked={setChildClicked}
              type={type}
              rating={rating}
              setPlaces={setPlaces}
              setIsLoading={setIsLoading}
              setError={setError}
              hovered={hovered}
              setHovered={setHovered}
              mapMoved={mapMoved}
              setMapMoved={setMapMoved}
              searchThisArea={searchThisArea}
              inCollab={inCollab}
              collabPins={collab.pins}
              collabItinerary={collab.itinerary}
              collabMembers={collab.members}
              routeFocus={routeFocus}
              routeOrigin={routeOrigin}
              hideSearchResults={routeFocus || suppressResults}
              onAddCollabPin={addCollabPin}
              onBroadcastViewport={collab.broadcastViewport}
              following={Boolean(collab.followingName)}
            />
          </Box>
        </Grid>
      </Grid>
    </>
  );
};

export default App;