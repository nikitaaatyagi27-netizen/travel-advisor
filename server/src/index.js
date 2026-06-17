import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';

import { connectStore, storeStatus } from './store.js';
import tripsRouter from './routes/trips.js';
import placesRouter from './routes/places.js';
import memoriesRouter from './routes/memories.js';
import distanceRouter from './routes/distance.js';
import { registerRealtime } from './realtime.js';
import { initAuth, authStatus } from './auth.js';

const PORT = process.env.PORT || 4000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:3000';

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true, store: storeStatus(), auth: authStatus() }));
app.use('/api/trips', tripsRouter);
app.use('/api/places', placesRouter);
app.use('/api/memories', memoriesRouter);
app.use('/api/distance-matrix', distanceRouter);

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: CLIENT_ORIGIN } });
registerRealtime(io);

const start = async () => {
  initAuth();
  await connectStore(process.env.MONGODB_URI);
  server.listen(PORT, () => {
    console.log(`🚀 Server listening on http://localhost:${PORT}`);
    console.log(`   Allowing client origin: ${CLIENT_ORIGIN}`);
  });
};

start();
