import { Router } from 'express';
import { requireAuth } from '../auth.js';
import {
  listMemories, createMemory, updateMemory, deleteMemory, removePhotoFromMemory,
} from '../store.js';
import { destroyAsset, destroyAssets } from '../cloudinary.js';

// Per-user Memories API. Every route requires auth and operates only on the caller's own
// memories (the store scopes all queries by req.userId), so users can't touch each other's.
const router = Router();

router.use(requireAuth);

// GET /api/memories  → all of MY memories.
router.get('/', async (req, res) => {
  try {
    res.json(await listMemories(req.userId));
  } catch (e) {
    console.error('listMemories failed:', e);
    res.status(500).json({ error: 'Could not load memories' });
  }
});

// POST /api/memories  → create a memory pin at a location.
router.post('/', async (req, res) => {
  const { lat, lng, title, note } = req.body || {};
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'lat and lng are required numbers' });
  }
  try {
    res.status(201).json(await createMemory(req.userId, { lat, lng, title, note }));
  } catch (e) {
    console.error('createMemory failed:', e);
    res.status(500).json({ error: 'Could not create memory' });
  }
});

// PATCH /api/memories/:id  → update title/note/photos of MY memory.
router.patch('/:id', async (req, res) => {
  try {
    const updated = await updateMemory(req.userId, req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: 'Memory not found' });
    res.json(updated);
  } catch (e) {
    console.error('updateMemory failed:', e);
    res.status(500).json({ error: 'Could not update memory' });
  }
});

// DELETE /api/memories/:id/photos/*  → remove ONE photo from MY memory AND delete the file
// from Cloudinary. The `*` captures the full publicId, which contains slashes
// (e.g. memories/dev/abc123).
router.delete('/:id/photos/*', async (req, res) => {
  const publicId = req.params[0]; // everything after /photos/
  try {
    const { memory, removed } = await removePhotoFromMemory(req.userId, req.params.id, publicId);
    if (!memory) return res.status(404).json({ error: 'Memory or photo not found' });
    if (removed?.publicId) await destroyAsset(removed.publicId); // delete the file too
    res.json(memory);
  } catch (e) {
    console.error('removePhoto failed:', e);
    res.status(500).json({ error: 'Could not remove photo' });
  }
});

// DELETE /api/memories/:id  → delete MY memory AND all its photos from Cloudinary.
router.delete('/:id', async (req, res) => {
  try {
    const photos = await deleteMemory(req.userId, req.params.id);
    if (!photos) return res.status(404).json({ error: 'Memory not found' });
    await destroyAssets(photos.map((p) => p.publicId)); // clean up the files too
    res.status(204).end();
  } catch (e) {
    console.error('deleteMemory failed:', e);
    res.status(500).json({ error: 'Could not delete memory' });
  }
});

export default router;
