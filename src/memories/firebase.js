// Firebase client setup for Memories auth (Google sign-in).
//
// GRACEFUL DEGRADATION: if the REACT_APP_FIREBASE_* env vars aren't set yet, Firebase is
// NOT initialized and `firebaseEnabled` is false. The app then runs in DEV AUTH mode — a
// fake local user — so the whole Memories feature works before the Firebase project exists.
// Add the env vars (see .env.example) to switch on real Google login with zero code changes.

import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';

const cfg = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID,
};

export const firebaseEnabled = Boolean(cfg.apiKey && cfg.authDomain && cfg.projectId);

let auth = null;
let googleProvider = null;
if (firebaseEnabled) {
  const app = initializeApp(cfg);
  auth = getAuth(app);
  googleProvider = new GoogleAuthProvider();
} else {
  // eslint-disable-next-line no-console
  console.warn(
    '⚠️  Firebase not configured (REACT_APP_FIREBASE_* missing) — Memories run in DEV AUTH ' +
    'mode (a fake local user, no real login). Add the env vars to enable Google sign-in.'
  );
}

export { auth, googleProvider };
