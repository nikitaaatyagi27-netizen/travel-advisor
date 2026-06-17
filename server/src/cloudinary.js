import { v2 as cloudinary } from 'cloudinary';

// Server-side Cloudinary, used ONLY to DELETE assets (uploads happen unsigned from the
// browser). Deleting requires the API secret, which must never reach the client — so it
// lives here, configured from server env vars.
//
// GRACEFUL DEGRADATION: if the env vars aren't set, `cloudinaryConfigured` is false and
// deletes become no-ops (the Mongo record is still removed; the Cloudinary file is just
// left as an orphan). This keeps the app working before the secret is configured.

const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;

export const cloudinaryConfigured = Boolean(
  CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET
);

if (cloudinaryConfigured) {
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true,
  });
}

// Delete one asset by its Cloudinary public_id. Resolves true on success, false if not
// configured or the call failed (we don't throw — a failed remote delete shouldn't block
// removing the record locally; worst case is a leftover file).
export const destroyAsset = async (publicId) => {
  if (!cloudinaryConfigured || !publicId) return false;
  try {
    const res = await cloudinary.uploader.destroy(publicId, { invalidate: true });
    return res?.result === 'ok' || res?.result === 'not found';
  } catch (e) {
    console.error('Cloudinary destroy failed for', publicId, '-', e.message);
    return false;
  }
};

// Delete several assets, ignoring individual failures.
export const destroyAssets = async (publicIds = []) => {
  await Promise.all(publicIds.filter(Boolean).map((id) => destroyAsset(id)));
};
