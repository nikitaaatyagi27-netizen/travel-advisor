// Cloudinary direct (unsigned) upload for memory photos.
//
// The browser POSTs the file straight to Cloudinary using a public "upload preset"; we get
// back a delivery URL (served from Cloudinary's CDN) which we store on the memory. Cloudinary
// auto-converts HEIC→JPEG and can deliver optimized/resized variants on the fly.
//
// GRACEFUL DEGRADATION: if the env vars aren't set, `cloudinaryEnabled` is false and callers
// fall back to a local object-URL preview (works in the UI, but not persisted). Add
// REACT_APP_CLOUDINARY_CLOUD_NAME + REACT_APP_CLOUDINARY_UPLOAD_PRESET to switch on real
// uploads with no code change.

const CLOUD_NAME = process.env.REACT_APP_CLOUDINARY_CLOUD_NAME;
const UPLOAD_PRESET = process.env.REACT_APP_CLOUDINARY_UPLOAD_PRESET;

export const cloudinaryEnabled = Boolean(CLOUD_NAME && UPLOAD_PRESET);

// Upload one image file. Returns { url, publicId }. Throws on failure.
// `folder` keeps each user's photos grouped in Cloudinary (optional, for tidiness).
export const uploadPhoto = async (file, folder) => {
  if (!cloudinaryEnabled) {
    throw new Error('Cloudinary not configured');
  }
  const form = new FormData();
  form.append('file', file);
  form.append('upload_preset', UPLOAD_PRESET);
  if (folder) form.append('folder', folder);

  // `/image/upload` accepts HEIC and converts it; Cloudinary stores a web-friendly asset.
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail?.error?.message || `Upload failed (${res.status})`);
  }
  const data = await res.json();
  return { url: data.secure_url, publicId: data.public_id };
};

// Build a delivery URL for a smaller, optimized version (for thumbnails / markers) from a
// stored secure_url. We inject Cloudinary transformation params after "/upload/".
//   f_auto = best format for the browser, q_auto = smart quality, w_/h_ = resize, c_fill = crop
export const thumbUrl = (url, size = 200) => {
  if (!url || !url.includes('/upload/')) return url;
  return url.replace('/upload/', `/upload/f_auto,q_auto,w_${size},h_${size},c_fill/`);
};
