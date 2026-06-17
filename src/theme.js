import { createTheme } from '@mui/material/styles';

// App-wide palette: olive green (primary) + pink (secondary) + butter yellow (accent).
// Applied globally via ThemeProvider, so MUI components across the whole app pick it up.
const OLIVE = '#6b7a3a';      // olive green
const OLIVE_DARK = '#54632b';
const PINK = '#e4699a';       // pink
const PINK_DARK = '#c84e80';
const BUTTER = '#f5d97a';     // butter yellow (accent / "other features")

const theme = createTheme({
  palette: {
    primary: { main: OLIVE, dark: OLIVE_DARK, contrastText: '#fff' },
    secondary: { main: PINK, dark: PINK_DARK, contrastText: '#fff' },
    // `warning` is MUI's built-in "accent" channel we reuse for butter-yellow highlights.
    warning: { main: BUTTER, dark: '#e6c24f', contrastText: '#5a4b12' },
    background: { default: '#faf8f0' }, // warm off-white so olive/pink read well
  },
  shape: { borderRadius: 10 },
  typography: {
    h5: { fontWeight: 700 },
    h6: { fontWeight: 700 },
  },
});

// Named accent for ad-hoc inline styling (e.g. butter-yellow chips/badges).
export const ACCENT = BUTTER;

export default theme;
