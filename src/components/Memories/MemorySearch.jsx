import React, { useState } from 'react';
import { Autocomplete } from '@react-google-maps/api';
import { Paper, Box } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';

// Place search for Memories mode: type a place (e.g. "Himachal Pradesh", "Kaza") and the
// map flies there — no manual dragging. Reuses Google Places Autocomplete (same mechanism
// as the main header search); on select it just moves the map via setCoords.
const MemorySearch = ({ setCoords }) => {
  const [autocomplete, setAutocomplete] = useState(null);

  const onPlaceChanged = () => {
    const place = autocomplete?.getPlace();
    if (!place?.geometry) return; // user typed but didn't pick a suggestion
    setCoords({
      lat: place.geometry.location.lat(),
      lng: place.geometry.location.lng(),
    });
  };

  return (
    <Paper
      elevation={4}
      sx={{ display: 'flex', alignItems: 'center', px: 1.5, py: 0.5, borderRadius: '24px', minWidth: 260 }}
    >
      <SearchIcon sx={{ color: 'text.secondary', mr: 1 }} />
      <Autocomplete onLoad={setAutocomplete} onPlaceChanged={onPlaceChanged}>
        <Box
          component="input"
          placeholder="Search a place to fly there…"
          sx={{
            border: 'none', outline: 'none', background: 'transparent',
            fontSize: 15, width: 240, py: 0.5,
          }}
        />
      </Autocomplete>
    </Paper>
  );
};

export default MemorySearch;
