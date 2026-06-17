import React, { useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Typography, Box, Alert,
} from '@mui/material';

// Prompts the user for a display name before they join a trip room.
// Shown when we have a trip code (from the URL) but no name yet.
const JoinTripDialog = ({ open, code, onJoin }) => {
  const [name, setName] = useState('');

  const submit = () => {
    const trimmed = name.trim();
    if (trimmed) onJoin(trimmed);
  };

  return (
    <Dialog open={open} maxWidth="xs" fullWidth>
      <DialogTitle>Join the trip</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          You're joining trip <strong>{code}</strong>. Pick a name so your friends know
          which pins are yours.
        </Typography>
        <TextField
          autoFocus
          fullWidth
          label="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="e.g. Rahul"
        />
        <Alert severity="info" sx={{ mt: 2 }}>
          Anyone with this link can view and edit the trip.
        </Alert>
        <Box sx={{ display: 'none' }} />
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={submit} disabled={!name.trim()}>
          Join
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default JoinTripDialog;
