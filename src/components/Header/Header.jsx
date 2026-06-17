import React, { useState } from 'react';
import { AppBar, Toolbar, Typography, Box, Button } from '@mui/material';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import GroupsIcon from '@mui/icons-material/Groups';
import PhotoLibraryIcon from '@mui/icons-material/PhotoLibrary';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { Autocomplete } from '@react-google-maps/api';

const Header = ({ setCoords, onStartCollab, inCollab, memoriesMode, onToggleMemories }) => {
  const [autocomplete, setAutocomplete] = useState(null);
  const [locating, setLocating] = useState(false);

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords: { latitude, longitude } }) => {
        setCoords({ lat: latitude, lng: longitude });
        setLocating(false);
      },
      () => {
        alert("Couldn't get your location. Please allow location access.");
        setLocating(false);
      }
    );
  };

  const onLoad = (autoC) => {
    console.log('✅ Autocomplete loaded');
    setAutocomplete(autoC);
  };

  const onPlaceChanged = () => {
    if (!autocomplete) return;

    const place = autocomplete.getPlace();
    console.log("full google data",place);

    if (!place?.geometry) {
      console.warn('❌ No geometry found');
      return;
    }

    const lat = place.geometry.location.lat();
    const lng = place.geometry.location.lng();

    console.log('📍 Selected place:', place.formatted_address);
    console.log('➡️ New coords:', lat, lng);

    setCoords({ lat, lng });
  };

  // Memories mode takes over the screen: hide search/collab and show a focused header
  // with a way back to the normal map.
  if (memoriesMode) {
    return (
      <AppBar position="static">
        <Toolbar sx={{ display: 'flex', justifyContent: 'space-between' }}>
          <Typography variant="h5">📸 Memories</Typography>
          <Button
            variant="contained"
            color="secondary"
            startIcon={<ArrowBackIcon />}
            onClick={onToggleMemories}
            sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}
          >
            Back to map
          </Button>
        </Toolbar>
      </AppBar>
    );
  }

  // Clean, light header (matches the redesigned places UI): 2-line logo, outlined buttons,
  // rounded search box.
  const navBtn = {
    textTransform: 'none', whiteSpace: 'nowrap', borderRadius: 2,
    color: 'text.primary', borderColor: 'divider',
    bgcolor: 'background.paper',
    '&:hover': { borderColor: 'primary.main', bgcolor: 'action.hover' },
  };

  return (
    <AppBar position="static" elevation={0} sx={{ bgcolor: 'background.paper', borderBottom: '1px solid', borderColor: 'divider' }}>
      <Toolbar sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>

        <Typography variant="h6" sx={{ color: 'primary.main', fontWeight: 800, lineHeight: 1, letterSpacing: 0.2 }}>
          Travel<br />Advisor
        </Typography>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {!inCollab && (
            <>
              <Button variant="outlined" startIcon={<PhotoLibraryIcon />} onClick={onToggleMemories} sx={navBtn}>
                Memories
              </Button>
              <Button variant="outlined" startIcon={<GroupsIcon />} onClick={onStartCollab} sx={navBtn}>
                Plan together
              </Button>
            </>
          )}

          <Button
            variant="outlined"
            startIcon={<MyLocationIcon />}
            onClick={useMyLocation}
            disabled={locating}
            sx={navBtn}
          >
            {locating ? 'Locating…' : 'My location'}
          </Button>

          <Autocomplete onLoad={onLoad} onPlaceChanged={onPlaceChanged}>
            <input
              type="text"
              placeholder="Search places…"
              style={{
                width: '260px', padding: '10px 14px',
                borderRadius: '999px', border: '1px solid #e0ddd4',
                outline: 'none', fontSize: 14, background: '#fff',
              }}
            />
          </Autocomplete>
        </Box>

      </Toolbar>
    </AppBar>
  );
};

export default Header;