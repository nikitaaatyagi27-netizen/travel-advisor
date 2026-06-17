import React, { useState, useEffect, useCallback } from 'react';
import { Box, IconButton, Typography, GlobalStyles } from '@mui/material';
import { motion, AnimatePresence } from 'framer-motion';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CloseIcon from '@mui/icons-material/Close';
import { thumbUrl } from '../../memories/cloudinary';

// Cinematic full-screen photo slideshow for one memory pin. Manual navigation (arrows / ← →,
// Esc or backdrop closes). The "cinematic" feel comes from:
//   • a fade-up-from-black entry with the photo scaling in
//   • direction-aware slide+crossfade between photos (AnimatePresence)
//   • a PRONOUNCED Ken Burns drift (slow zoom + pan) on whichever photo is showing
//   • a vignette + dark frame so the photo reads like a cinema screen
//   • chrome (title, counter, dots) that fades in elegantly
// Photos use a high-res HEIC-safe Cloudinary delivery so they display everywhere.

const MotionBox = motion(Box);

// Slide/crossfade variants. `dir` is +1 (forward) or -1 (back) so the photo slides the right way.
const photoVariants = {
  enter: (dir) => ({ x: dir > 0 ? '60%' : '-60%', opacity: 0, scale: 0.96 }),
  center: { x: 0, opacity: 1, scale: 1 },
  exit: (dir) => ({ x: dir > 0 ? '-60%' : '60%', opacity: 0, scale: 0.96 }),
};

const PhotoSlideshow = ({ memory, onClose }) => {
  const photos = memory?.photos || [];
  // Track index + direction so AnimatePresence slides the correct way.
  const [[index, dir], setState] = useState([0, 0]);

  const go = useCallback((delta) => {
    setState(([i]) => [(i + delta + photos.length) % photos.length, delta]);
  }, [photos.length]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onClose]);

  if (!memory || photos.length === 0) return null;
  const current = photos[index];
  const multi = photos.length > 1;

  return (
    <>
      {/* Pronounced Ken Burns drift — slow zoom + pan, applied to the active photo. */}
      <GlobalStyles styles={{
        '@keyframes kenburns': {
          '0%':   { transform: 'scale(1.0) translate(0%, 0%)' },
          '100%': { transform: 'scale(1.18) translate(-3%, -2%)' },
        },
      }} />

      <MotionBox
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.4 }}
        sx={{
          position: 'fixed', inset: 0, zIndex: 1300,
          bgcolor: '#000',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {/* The photo stage: each photo enters/exits with a direction-aware slide+fade, and the
            inner image continuously Ken-Burns-drifts. */}
        <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <AnimatePresence initial custom={dir} mode="popLayout">
            <MotionBox
              key={current.url}
              custom={dir}
              variants={photoVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ x: { type: 'spring', stiffness: 260, damping: 30 }, opacity: { duration: 0.35 }, scale: { duration: 0.45 } }}
              onClick={(e) => { e.stopPropagation(); if (multi) go(1); }}
              sx={{
                position: 'absolute',
                width: '100%', height: '100%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: multi ? 'pointer' : 'default',
              }}
            >
              <Box
                component="img"
                src={thumbUrl(current.url, 1600)}
                alt={current.name || memory.title}
                sx={{
                  maxWidth: '92vw', maxHeight: '92vh', objectFit: 'contain',
                  boxShadow: '0 10px 60px rgba(0,0,0,0.7)',
                  // Pronounced Ken Burns: slow, large zoom+pan that alternates direction per photo.
                  animation: `kenburns 12s ease-out forwards`,
                  animationDirection: index % 2 === 0 ? 'normal' : 'alternate-reverse',
                }}
              />
            </MotionBox>
          </AnimatePresence>
        </Box>

        {/* Vignette — darkened edges so the photo reads like a cinema screen. */}
        <Box sx={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          boxShadow: 'inset 0 0 220px 80px rgba(0,0,0,0.8)',
        }} />

        {/* Header: title + counter + close, fading in. */}
        <MotionBox
          onClick={(e) => e.stopPropagation()}
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.5 }}
          sx={{ position: 'absolute', top: 0, left: 0, right: 0, p: 2.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#fff', zIndex: 2 }}
        >
          <Box>
            <Typography variant="h5" sx={{ fontWeight: 700, textShadow: '0 2px 8px rgba(0,0,0,0.6)' }}>
              {memory.title}
            </Typography>
            <Box sx={{ height: 2, width: 48, bgcolor: 'warning.main', mt: 0.5, borderRadius: 1 }} />
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.8)' }}>
              {index + 1} / {photos.length}
            </Typography>
            <IconButton onClick={onClose} sx={{ color: '#fff', bgcolor: 'rgba(255,255,255,0.08)', '&:hover': { bgcolor: 'rgba(255,255,255,0.2)' } }}>
              <CloseIcon />
            </IconButton>
          </Box>
        </MotionBox>

        {/* Arrows */}
        {multi && (
          <>
            <IconButton
              onClick={(e) => { e.stopPropagation(); go(-1); }}
              sx={{ position: 'absolute', left: 16, zIndex: 2, color: '#fff', bgcolor: 'rgba(255,255,255,0.1)', backdropFilter: 'blur(4px)', '&:hover': { bgcolor: 'rgba(255,255,255,0.28)' } }}
              size="large"
            >
              <ChevronLeftIcon fontSize="large" />
            </IconButton>
            <IconButton
              onClick={(e) => { e.stopPropagation(); go(1); }}
              sx={{ position: 'absolute', right: 16, zIndex: 2, color: '#fff', bgcolor: 'rgba(255,255,255,0.1)', backdropFilter: 'blur(4px)', '&:hover': { bgcolor: 'rgba(255,255,255,0.28)' } }}
              size="large"
            >
              <ChevronRightIcon fontSize="large" />
            </IconButton>

            {/* Progress dots */}
            <Box
              onClick={(e) => e.stopPropagation()}
              sx={{ position: 'absolute', bottom: 24, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 1, zIndex: 2 }}
            >
              {photos.map((p, i) => (
                <Box
                  key={p.url}
                  onClick={() => setState([i, i > index ? 1 : -1])}
                  sx={{
                    width: i === index ? 24 : 8, height: 8, borderRadius: 4,
                    bgcolor: i === index ? 'warning.main' : 'rgba(255,255,255,0.45)',
                    cursor: 'pointer', transition: 'all 0.3s ease',
                  }}
                />
              ))}
            </Box>
          </>
        )}
      </MotionBox>
    </>
  );
};

export default PhotoSlideshow;
