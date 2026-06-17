// Base URL of the collaboration backend (Express + Socket.IO).
// Override in development/production via REACT_APP_SERVER_URL in .env.
export const SERVER_URL =
  process.env.REACT_APP_SERVER_URL || 'http://localhost:4000';
