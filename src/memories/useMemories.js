import { useState, useCallback, useEffect } from 'react';
import {
  apiListMemories, apiCreateMemory, apiUpdateMemory, apiDeleteMemory, apiRemovePhoto,
} from './memoriesApi';

// Owns the user's personal Memories, backed by the per-user server API (MongoDB).
//
// Memories load when a user is present and are scoped to that user server-side, so logging
// in on any device shows the same memories. Mutations update the server then reflect the
// result locally. Photos are handled as an array on each memory; the NEXT milestone uploads
// photo files to Cloudinary and stores the returned URL — for now `addPhoto` accepts a
// {url} object (a local preview) so the UI flow already works.
//
// `auth` = { user, getAuthHeaders } from useAuth. When user is null, memories stay empty.
export const useMemories = (auth) => {
  const { user, getAuthHeaders } = auth;
  const [memories, setMemories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Load this user's memories when they sign in (and clear on sign-out).
  useEffect(() => {
    if (!user) { setMemories([]); return; }
    let cancelled = false;
    setLoading(true);
    apiListMemories(getAuthHeaders)
      .then((list) => { if (!cancelled) setMemories(list); })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); })
    return () => { cancelled = true; };
  }, [user, getAuthHeaders]);

  const addMemory = useCallback(async ({ lat, lng, title = 'New memory', note = '' }) => {
    const created = await apiCreateMemory(getAuthHeaders, { lat, lng, title, note });
    setMemories((prev) => [...prev, created]);
    return created;
  }, [getAuthHeaders]);

  // Persist a field change. We update locally first for snappiness, then send to the server.
  const updateMemory = useCallback((id, patch) => {
    setMemories((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
    apiUpdateMemory(getAuthHeaders, id, patch).catch((e) => setError(e.message));
  }, [getAuthHeaders]);

  const removeMemory = useCallback((id) => {
    setMemories((prev) => prev.filter((m) => m.id !== id));
    apiDeleteMemory(getAuthHeaders, id).catch((e) => setError(e.message));
  }, [getAuthHeaders]);

  // Append one or more photos in a SINGLE update + a SINGLE PATCH. Adding photos one-by-one
  // with a PATCH each caused racing requests where an earlier (shorter) array could land
  // last and drop photos — so callers that upload multiple files must add them together.
  const addPhotos = useCallback((id, newPhotos) => {
    const toAdd = Array.isArray(newPhotos) ? newPhotos : [newPhotos];
    if (!toAdd.length) return;
    setMemories((prev) => {
      const next = prev.map((m) => (m.id === id ? { ...m, photos: [...m.photos, ...toAdd] } : m));
      const target = next.find((m) => m.id === id);
      if (target) apiUpdateMemory(getAuthHeaders, id, { photos: target.photos }).catch((e) => setError(e.message));
      return next;
    });
  }, [getAuthHeaders]);

  // Backwards-compatible single-photo helper (delegates to the batch version).
  const addPhoto = useCallback((id, photo) => addPhotos(id, [photo]), [addPhotos]);

  // Remove a photo by its Cloudinary publicId — the server deletes BOTH the Mongo record
  // and the Cloudinary file, keeping the two in sync. We update locally optimistically.
  // (Local-preview photos with no publicId were never uploaded, so just drop them locally.)
  const removePhoto = useCallback((id, publicId) => {
    setMemories((prev) =>
      prev.map((m) => (m.id === id ? { ...m, photos: m.photos.filter((p) => p.publicId !== publicId) } : m))
    );
    if (publicId) apiRemovePhoto(getAuthHeaders, id, publicId).catch((e) => setError(e.message));
  }, [getAuthHeaders]);

  return { memories, loading, error, addMemory, updateMemory, removeMemory, addPhoto, addPhotos, removePhoto };
};
