import { SERVER_URL } from '../collab/config';

// REST calls for the per-user Memories API. Each takes a `getAuthHeaders` function (from
// useAuth) so every request carries the user's identity (Firebase token, or dev header).

const authed = async (getAuthHeaders, path, options = {}) => {
  const headers = { 'Content-Type': 'application/json', ...(await getAuthHeaders()) };
  const res = await fetch(`${SERVER_URL}/api/memories${path}`, { ...options, headers });
  if (!res.ok && res.status !== 204) {
    throw new Error((await res.json().catch(() => ({}))).error || `Request failed (${res.status})`);
  }
  return res.status === 204 ? null : res.json();
};

export const apiListMemories = (getAuthHeaders) => authed(getAuthHeaders, '');

export const apiCreateMemory = (getAuthHeaders, body) =>
  authed(getAuthHeaders, '', { method: 'POST', body: JSON.stringify(body) });

export const apiUpdateMemory = (getAuthHeaders, id, patch) =>
  authed(getAuthHeaders, `/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });

export const apiDeleteMemory = (getAuthHeaders, id) =>
  authed(getAuthHeaders, `/${id}`, { method: 'DELETE' });

// Remove one photo (by Cloudinary publicId) from a memory — deletes the file from
// Cloudinary AND the record from MongoDB. Returns the updated memory.
export const apiRemovePhoto = (getAuthHeaders, id, publicId) =>
  authed(getAuthHeaders, `/${id}/photos/${publicId}`, { method: 'DELETE' });
