import { useState, useCallback, useEffect } from 'react';

// Manages the trip code, kept in sync with the URL path (/trip/:code) without a router.
//
// IMPORTANT: trips are NOT auto-joined on page load. Since a refresh starts the app fresh
// anyway, we always begin on the main page (code = null) and clear any stale /trip/:code
// from the URL on load. The user enters a trip only by an explicit action (e.g. "Plan
// together"). This avoids the join dialog popping up on every refresh.
export const useTripCode = () => {
  const [code, setCode] = useState(null);

  // On mount, if the URL still points at a trip (e.g. after a refresh), reset it to "/".
  useEffect(() => {
    if (/^\/trip\//.test(window.location.pathname)) {
      window.history.replaceState({}, '', '/');
    }
  }, []);

  const enterTrip = useCallback((newCode) => {
    window.history.pushState({}, '', `/trip/${newCode}`);
    setCode(newCode);
  }, []);

  const leaveTrip = useCallback(() => {
    window.history.pushState({}, '', '/');
    setCode(null);
  }, []);

  return { code, enterTrip, leaveTrip };
};
