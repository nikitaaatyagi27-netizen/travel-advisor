import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

// Auth for the Memories API: verifies the Firebase ID token a logged-in client sends in
// the `Authorization: Bearer <token>` header, and puts the user's uid on `req.userId`.
//
// GRACEFUL DEGRADATION: Firebase Admin needs a service-account credential to verify tokens.
// Until that's configured (set FIREBASE_SERVICE_ACCOUNT to the JSON, or GOOGLE_APPLICATION_
// CREDENTIALS to a key file), we run in DEV MODE: the server trusts an `x-dev-user` header
// as the uid. This lets the whole per-user feature be built and tested locally before the
// Firebase project exists. Dev mode is obvious in the logs and must never be used in prod.

let firebaseReady = false;

export const initAuth = () => {
  // Prefer an inline JSON blob (easy for hosting env vars); fall back to ADC / key file.
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  try {
    if (raw) {
      initializeApp({ credential: cert(JSON.parse(raw)) });
      firebaseReady = true;
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      initializeApp({ credential: applicationDefault() }); // key file from env var path
      firebaseReady = true;
    }
  } catch (e) {
    console.error('⚠️  Firebase Admin init failed — falling back to DEV auth.', e.message);
    firebaseReady = false;
  }

  if (firebaseReady) {
    console.log('🔐 Firebase Admin ready — verifying real ID tokens.');
  } else {
    console.warn(
      '⚠️  No Firebase credentials — Memories API runs in DEV AUTH mode (trusts the ' +
      '`x-dev-user` header as the user id). Fine for local dev; NOT for production.'
    );
  }
};

export const authStatus = () => (firebaseReady ? 'firebase' : 'dev');

// Express middleware: sets req.userId or responds 401.
export const requireAuth = async (req, res, next) => {
  if (firebaseReady) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing auth token' });
    try {
      const decoded = await getAuth().verifyIdToken(token);
      req.userId = decoded.uid;
      return next();
    } catch {
      return res.status(401).json({ error: 'Invalid auth token' });
    }
  }

  // DEV MODE: trust the x-dev-user header (defaulting to a fixed local user).
  req.userId = req.headers['x-dev-user'] || 'dev-user';
  return next();
};
