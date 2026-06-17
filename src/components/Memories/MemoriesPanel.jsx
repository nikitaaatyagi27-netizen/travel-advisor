import React, { useRef, useState, useEffect } from 'react';
import {
  Box, Typography, List, ListItem, IconButton, Avatar, Chip,
  TextField, Button, ImageList, ImageListItem, Tooltip, CircularProgress,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import AddAPhotoIcon from '@mui/icons-material/AddAPhoto';
import PhotoCameraBackIcon from '@mui/icons-material/PhotoCameraBack';
import GoogleIcon from '@mui/icons-material/Google';
import LogoutIcon from '@mui/icons-material/Logout';
import EditIcon from '@mui/icons-material/Edit';
import { uploadPhoto, cloudinaryEnabled, thumbUrl } from '../../memories/cloudinary';

// Sidebar for Memories mode: the list of personal memory pins, each editable and able to
// hold photos. Click a row to fly the map there. Photos are shown as thumbnails.
const MemoriesPanel = ({
  memories, loading, user, authReady, onSignIn, onSignOut,
  onFlyTo, onUpdateMemory, onRemoveMemory, onAddPhoto, onAddPhotos, onRemovePhoto,
  onOpenSlideshow, focusedMemoryId,
}) => {
  // Which memory's title is currently being edited inline.
  const [editingId, setEditingId] = useState(null);
  // Scroll the focused memory (just created / just clicked) into view.
  const focusedRef = useRef(null);
  useEffect(() => {
    if (focusedMemoryId && focusedRef.current) {
      focusedRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [focusedMemoryId]);
  // One hidden file input reused per "Add photo" click; we remember which memory it's for.
  const fileInputRef = useRef(null);
  const pendingMemoryId = useRef(null);
  // Set of memory ids that currently have an upload in flight (to show a spinner).
  const [uploadingIds, setUploadingIds] = useState(new Set());
  const [uploadError, setUploadError] = useState(null);

  const setUploading = (memoryId, on) =>
    setUploadingIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(memoryId); else next.delete(memoryId);
      return next;
    });

  const pickPhoto = (memoryId) => {
    pendingMemoryId.current = memoryId;
    fileInputRef.current?.click();
  };

  const onFileChosen = async (e) => {
    const files = Array.from(e.target.files || []);
    const memoryId = pendingMemoryId.current;
    e.target.value = ''; // allow re-picking the same file
    if (!files.length) return;

    setUploadError(null);
    setUploading(memoryId, true);
    try {
      // Upload ALL files first, collect their photos, then add in ONE batch — adding them
      // one at a time fired a PATCH per photo, and those raced (an earlier, shorter array
      // could land last and drop photos).
      const uploaded = [];
      for (const file of files) {
        if (cloudinaryEnabled) {
          const { url, publicId } = await uploadPhoto(file, `memories/${user?.uid || 'dev'}`);
          uploaded.push({ url, publicId, name: file.name });
        } else {
          uploaded.push({ url: URL.createObjectURL(file), name: file.name, local: true });
        }
      }
      onAddPhotos?.(memoryId, uploaded);
    } catch (err) {
      setUploadError(err.message || 'Upload failed');
    } finally {
      setUploading(memoryId, false);
    }
  };

  // Not signed in → show a sign-in gate. Memories are private per account.
  if (authReady && !user) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <Typography variant="h6" gutterBottom>Your memories</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Sign in to save photo memories on your own private map. They'll be here on any
          device you log in from.
        </Typography>
        <Button variant="contained" startIcon={<GoogleIcon />} onClick={onSignIn} sx={{ textTransform: 'none' }}>
          Sign in with Google
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2 }}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.heic,.heif"
        multiple
        hidden
        onChange={onFileChosen}
      />

      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Typography variant="h6">
          Your memories {memories.length > 0 && <Chip size="small" label={memories.length} sx={{ ml: 1 }} />}
        </Typography>
        {user && (
          <Tooltip title={`Signed in as ${user.name || 'you'} — sign out`}>
            <IconButton size="small" onClick={onSignOut}><LogoutIcon fontSize="small" /></IconButton>
          </Tooltip>
        )}
      </Box>
      {loading && <Typography variant="caption" color="text.secondary">Loading…</Typography>}
      {!cloudinaryEnabled && (
        <Typography variant="caption" color="warning.main" sx={{ display: 'block', mb: 1 }}>
          Photo storage not set up yet — photos preview locally but won't persist on refresh.
        </Typography>
      )}
      {uploadError && (
        <Typography variant="caption" color="error" sx={{ display: 'block', mb: 1 }}>
          {uploadError}
        </Typography>
      )}

      {memories.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Click anywhere on the map to drop a memory pin, then add photos to it. Your
          memories are private to you.
        </Typography>
      ) : (
        <List dense>
          {/* Newest first — the place you're currently adding photos to stays at the top. */}
          {[...memories].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map((memory) => (
            <ListItem
              key={memory.id}
              ref={memory.id === focusedMemoryId ? focusedRef : null}
              alignItems="flex-start"
              sx={{
                flexDirection: 'column', alignItems: 'stretch', borderRadius: 1, mb: 1, p: 1.5,
                bgcolor: memory.id === focusedMemoryId ? 'rgba(228,105,154,0.15)' : 'action.hover',
                outline: memory.id === focusedMemoryId ? '2px solid' : 'none',
                outlineColor: 'secondary.main',
                transition: 'background-color 0.3s, outline-color 0.3s',
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                <Avatar sx={{ width: 28, height: 28, bgcolor: 'primary.main', mr: 1.5 }}>
                  <PhotoCameraBackIcon sx={{ fontSize: 16 }} />
                </Avatar>
                <Box sx={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => onOpenSlideshow?.(memory)}>
                  {editingId === memory.id ? (
                    <TextField
                      variant="standard"
                      autoFocus
                      defaultValue={memory.title}
                      onClick={(e) => e.stopPropagation()}
                      onBlur={(e) => { onUpdateMemory?.(memory.id, { title: e.target.value.trim() || memory.title }); setEditingId(null); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                      fullWidth
                    />
                  ) : (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <Typography variant="subtitle1" noWrap sx={{ fontWeight: 700 }}>
                        {memory.title}
                      </Typography>
                      <Tooltip title="Rename location">
                        <IconButton size="small" onClick={(e) => { e.stopPropagation(); setEditingId(memory.id); }} sx={{ p: 0.25 }}>
                          <EditIcon sx={{ fontSize: 14 }} />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  )}
                  <Chip
                    size="small"
                    label={`${memory.photos.length} photo${memory.photos.length === 1 ? '' : 's'}`}
                    sx={{ bgcolor: 'warning.main', color: 'warning.contrastText', fontWeight: 600, height: 20, mt: 0.25 }}
                  />
                </Box>
                <IconButton size="small" onClick={() => onRemoveMemory?.(memory.id)}>
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Box>

              <TextField
                variant="standard"
                placeholder="Add a note…"
                value={memory.note}
                onChange={(e) => onUpdateMemory?.(memory.id, { note: e.target.value })}
                sx={{ mt: 1 }}
                fullWidth
              />

              {memory.photos.length > 0 && (
                <ImageList cols={3} gap={4} sx={{ mt: 1, mb: 0 }}>
                  {memory.photos.map((photo) => (
                    <ImageListItem key={photo.url} sx={{ position: 'relative' }}>
                      <Box
                        component="img"
                        src={thumbUrl(photo.url, 200)}
                        alt={photo.name || 'memory'}
                        sx={{ height: 70, objectFit: 'cover', borderRadius: 1 }}
                      />
                      <Tooltip title="Remove photo">
                        <IconButton
                          size="small"
                          onClick={() => onRemovePhoto?.(memory.id, photo.publicId)}
                          sx={{ position: 'absolute', top: 0, right: 0, bgcolor: 'rgba(0,0,0,0.5)', color: '#fff', p: '2px' }}
                        >
                          <DeleteOutlineIcon sx={{ fontSize: 14 }} />
                        </IconButton>
                      </Tooltip>
                    </ImageListItem>
                  ))}
                </ImageList>
              )}

              <Button
                size="small"
                disabled={uploadingIds.has(memory.id)}
                startIcon={
                  uploadingIds.has(memory.id)
                    ? <CircularProgress size={14} />
                    : <AddAPhotoIcon fontSize="small" />
                }
                onClick={() => pickPhoto(memory.id)}
                sx={{ mt: 1, textTransform: 'none', alignSelf: 'flex-start' }}
              >
                {uploadingIds.has(memory.id) ? 'Uploading…' : 'Add photo'}
              </Button>
            </ListItem>
          ))}
        </List>
      )}
    </Box>
  );
};

export default MemoriesPanel;
