import { useState, useEffect, useCallback } from 'react';
import { signInWithPopup, signOut as fbSignOut, onAuthStateChanged } from 'firebase/auth';
import { auth, googleProvider, firebaseEnabled } from './firebase';

// Auth state for Memories. Real Google sign-in when Firebase is configured; otherwise a
// DEV fallback user so the feature is usable before the Firebase project exists.
//
// Returns:
//   user      → { uid, name, photoURL } | null   (in dev mode, a fixed local user)
//   ready     → true once we know the auth state (avoids UI flicker)
//   signIn()  → Google popup (no-op note in dev mode)
//   signOut()
//   getAuthHeaders() → headers to attach to Memories API calls (Bearer token, or x-dev-user)

const DEV_USER = { uid: 'dev-user', name: 'You (dev)', photoURL: null };

export const useAuth = () => {
  const [user, setUser] = useState(firebaseEnabled ? null : DEV_USER);
  const [ready, setReady] = useState(!firebaseEnabled);

  useEffect(() => {
    if (!firebaseEnabled) return undefined;
    return onAuthStateChanged(auth, (fbUser) => {
      setUser(
        fbUser ? { uid: fbUser.uid, name: fbUser.displayName, photoURL: fbUser.photoURL } : null
      );
      setReady(true);
    });
  }, []);

  const signIn = useCallback(async () => {
    if (!firebaseEnabled) return; // dev mode: already "signed in" as DEV_USER
    await signInWithPopup(auth, googleProvider);
  }, []);

  const signOut = useCallback(async () => {
    if (!firebaseEnabled) return;
    await fbSignOut(auth);
  }, []);

  // Build auth headers for API requests. Real: a fresh Firebase ID token. Dev: the
  // x-dev-user header the server trusts when it has no Firebase credentials.
  const getAuthHeaders = useCallback(async () => {
    if (!firebaseEnabled) return { 'x-dev-user': DEV_USER.uid };
    const token = await auth.currentUser?.getIdToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  return { user, ready, signIn, signOut, getAuthHeaders, firebaseEnabled };
};
