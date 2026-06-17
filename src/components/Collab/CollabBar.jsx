import React, { useState } from 'react';
import { Box, Avatar, Tooltip, Button, Chip, Snackbar } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import PersonPinIcon from '@mui/icons-material/PersonPin';

// Presence + sharing strip shown while inside a trip.
//   - colored avatars of everyone present
//   - a "copy link" button to invite friends
//   - per-member "follow" buttons (you can mirror a friend's map)
//   - leave-trip button
const CollabBar = ({ code, members, you, followingName, onFollow, onStopFollowing, onLeave }) => {
  const [copied, setCopied] = useState(false);

  const copyLink = () => {
    const url = `${window.location.origin}/trip/${code}`;
    navigator.clipboard?.writeText(url);
    setCopied(true);
  };

  const others = members.filter((m) => m.name !== you?.name);

  return (
    <Box
      sx={{
        display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap',
        px: 2, py: 1, bgcolor: 'background.paper', borderBottom: '1px solid',
        borderColor: 'divider',
      }}
    >
      <Chip size="small" color="primary" label={`Trip ${code}`} />

      {/* Presence avatars */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        {members.map((m) => (
          <Tooltip key={m.name} title={m.name + (m.name === you?.name ? ' (you)' : '')}>
            <Avatar sx={{ width: 28, height: 28, bgcolor: m.color, fontSize: 13 }}>
              {m.name?.[0]?.toUpperCase()}
            </Avatar>
          </Tooltip>
        ))}
      </Box>

      <Button size="small" startIcon={<ContentCopyIcon />} onClick={copyLink}>
        Copy invite link
      </Button>

      {/* Follow controls */}
      {followingName ? (
        <Button size="small" variant="outlined" color="secondary" onClick={onStopFollowing}>
          Stop following {followingName}
        </Button>
      ) : (
        others.map((m) => (
          <Button
            key={m.name}
            size="small"
            startIcon={<PersonPinIcon />}
            onClick={() => onFollow(m.name)}
          >
            Follow {m.name}
          </Button>
        ))
      )}

      <Box sx={{ flexGrow: 1 }} />
      <Button size="small" color="inherit" onClick={onLeave}>Leave trip</Button>

      <Snackbar
        open={copied}
        autoHideDuration={2000}
        onClose={() => setCopied(false)}
        message="Invite link copied"
      />
    </Box>
  );
};

export default CollabBar;
