import React, { useRef, useLayoutEffect, useState } from 'react';
import { Box, Button, Typography } from '@mui/material';
import { gsap } from 'gsap';

// Cinematic three-panel intro that plays before the app.
//
// Choreography (a GSAP timeline):
//   black screen → panel 1 slides in from LEFT (noodles) → hold 1.5s
//   → panel 2 crashes in from RIGHT (backpacker) → hold
//   → panel 3 drops in from TOP (hotel bed) → hold ("breathe")
//   → logo + app name fade in centered over all three → onDone.
//
// Media: three muted, autoplaying, looping videos in /public/intro (drop your stock clips
// there — see the file names below). Falls back gracefully to a dark panel if a clip is
// missing. A unified CSS color grade ties the three clips together. Always skippable.

// Three VERTICAL columns (a triptych). Entry: left column from left, middle from top,
// right column from right.
const PANELS = [
  { src: '/intro/noodles.mp4',    from: { xPercent: -120 }, label: 'Taste' },     // left column ← from left
  { src: '/intro/backpacker.mp4', from: { yPercent: -120 }, label: 'Explore' },   // middle column ↓ from top
  { src: '/intro/hotel.mp4',      from: { xPercent: 120 },  label: 'Unwind' },     // right column → from right
];

// Unified cinematic color grade applied to all three panels.
const GRADE = 'saturate(1.15) contrast(1.06) brightness(0.95) sepia(0.12)';

const CinematicIntro = ({ onDone }) => {
  const rootRef = useRef(null);
  const panelRefs = useRef([]);
  const logoRef = useRef(null);
  const tlRef = useRef(null);
  const [skipVisible, setSkipVisible] = useState(false);
  // Becomes true once the logo has resolved — then we reveal the "Explore" button and WAIT
  // for the user to click it (the intro does NOT auto-advance). Videos keep looping meanwhile.
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      const panels = panelRefs.current;
      // Start state: panels off-screen in their entry directions, logo hidden.
      panels.forEach((el, i) => gsap.set(el, PANELS[i].from));
      gsap.set(logoRef.current, { opacity: 0, scale: 0.9 });

      // No onComplete → onDone: the sequence ends on the logo and then HOLDS until the user
      // clicks Explore. The looping videos keep the screen alive while it waits.
      const tl = gsap.timeline();
      tlRef.current = tl;

      // Panel 1 — slide from left, then hold 1.5s.
      tl.to(panels[0], { xPercent: 0, yPercent: 0, duration: 0.9, ease: 'power4.out' })
        .to({}, { duration: 1.5 });

      // Panel 2 — crash from right (snappier), then hold.
      tl.to(panels[1], { xPercent: 0, yPercent: 0, duration: 0.7, ease: 'power4.out' })
        .to({}, { duration: 1.3 });

      // Panel 3 — drop from top, then hold (the "breathe" beat).
      tl.to(panels[2], { xPercent: 0, yPercent: 0, duration: 0.8, ease: 'power4.out' })
        .to({}, { duration: 1.4 });

      // Logo + app name resolve, then reveal the Explore button.
      tl.to(logoRef.current, {
        opacity: 1, scale: 1, duration: 1.1, ease: 'power2.out',
        onComplete: () => setReady(true),
      });
    }, rootRef);

    // Let the user skip mid-sequence (appears shortly after it starts), so the cinematic
    // intro never traps someone who just wants to get in.
    const t = setTimeout(() => setSkipVisible(true), 1200);
    return () => { clearTimeout(t); ctx.revert(); };
  }, []);

  const skip = () => {
    tlRef.current?.kill();
    onDone?.();
  };

  return (
    <Box
      ref={rootRef}
      sx={{ position: 'fixed', inset: 0, zIndex: 2000, bgcolor: '#000', overflow: 'hidden' }}
    >
      {/* Three vertical columns (triptych), each filling a third of the width. */}
      <Box sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'row' }}>
        {PANELS.map((panel, i) => (
          <Box
            key={panel.src}
            ref={(el) => { panelRefs.current[i] = el; }}
            sx={{ position: 'relative', flex: 1, overflow: 'hidden', bgcolor: '#111' }}
          >
            <Box
              component="video"
              src={panel.src}
              autoPlay
              muted
              loop
              playsInline
              sx={{ width: '100%', height: '100%', objectFit: 'cover', filter: GRADE, display: 'block' }}
            />
            {/* Soft dark gradient at panel edges so the seams + logo read cleanly. */}
            <Box sx={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(0,0,0,0.25), rgba(0,0,0,0.1) 40%, rgba(0,0,0,0.35))', pointerEvents: 'none' }} />
          </Box>
        ))}
      </Box>

      {/* Logo + app name, centered over everything. */}
      <Box
        ref={logoRef}
        sx={{
          position: 'absolute', inset: 0, zIndex: 3,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          textAlign: 'center', color: '#fff', pointerEvents: 'none',
        }}
      >
        <Typography variant="h2" sx={{ fontWeight: 800, letterSpacing: 1, textShadow: '0 4px 24px rgba(0,0,0,0.7)' }}>
          Travel Advisor
        </Typography>
        <Box sx={{ height: 3, width: 90, bgcolor: 'warning.main', my: 1.5, borderRadius: 2 }} />
        <Typography variant="h6" sx={{ fontWeight: 400, opacity: 0.9, textShadow: '0 2px 12px rgba(0,0,0,0.7)' }}>
          Taste · Explore · Unwind
        </Typography>

        {/* Explore — the user must click this to enter the app (no auto-advance). Fades/
            scales in once the logo has resolved. */}
        {ready && (
          <Button
            onClick={onDone}
            variant="contained"
            size="large"
            sx={{
              mt: 4, px: 5, py: 1.3, pointerEvents: 'auto',
              textTransform: 'none', fontSize: 18, fontWeight: 700, borderRadius: 999,
              boxShadow: '0 6px 30px rgba(0,0,0,0.5)',
              animation: 'introExploreIn 0.6s ease-out',
              '@keyframes introExploreIn': {
                from: { opacity: 0, transform: 'translateY(16px) scale(0.92)' },
                to: { opacity: 1, transform: 'translateY(0) scale(1)' },
              },
            }}
          >
            Explore →
          </Button>
        )}
      </Box>

      {/* Skip — lets the user bail DURING the sequence. Once the Explore button is up
          (ready), Skip disappears since Explore is the way in. */}
      {skipVisible && !ready && (
        <Button
          onClick={skip}
          variant="outlined"
          size="small"
          sx={{
            position: 'absolute', bottom: 24, right: 24, zIndex: 4,
            color: '#fff', borderColor: 'rgba(255,255,255,0.5)', textTransform: 'none',
            '&:hover': { borderColor: '#fff', bgcolor: 'rgba(255,255,255,0.1)' },
          }}
        >
          Skip intro →
        </Button>
      )}
    </Box>
  );
};

export default CinematicIntro;
