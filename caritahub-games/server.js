require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const httpServer = http.createServer(app);

const corsOrigin = process.env.CORS_ORIGIN || '*';

const io = new Server(httpServer, {
  cors: { origin: corsOrigin, methods: ['GET', 'POST'] },
  // Fly.io: ensure WebSocket upgrades work behind the proxy
  transports: ['websocket', 'polling'],
  allowEIO3: true
});

// Rate limit static/API routes (generous; join_xiangqi is rate-limited in socket events)
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false
});
app.use(limiter);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// /join encodes ?room=&game= — serve the game lobby page
app.get('/join', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'lobby.html'));
});

// TV Bingo — TV display (host) page
app.get('/tv-bingo', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'tv-bingo.html'));
});

// TV Bingo — mobile player page (seniors scan QR to reach this)
app.get('/tv-bingo-play', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'tv-bingo-play.html'));
});

// TV Higher or Lower — TV display (host) page
app.get('/tv-higher-lower', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'tv-higher-lower.html'));
});

// TV Higher or Lower — mobile player page
app.get('/tv-higher-lower-play', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'tv-higher-lower-play.html'));
});

// TV Boggle — TV display (host) page
app.get('/tv-boggle', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'tv-boggle.html'));
});

// TV Boggle — mobile player page
app.get('/tv-boggle-play', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'tv-boggle-play.html'));
});

// TV Reversi — TV display (host) page
app.get('/tv-reversi', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'tv-reversi.html'));
});

// TV Reversi — mobile player page (players scan QR to reach this)
app.get('/tv-reversi-play', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'tv-reversi-play.html'));
});

// TV Cooking — TV display (host) page
app.get('/tv-cooking', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'tv-cooking.html'));
});

// TV Cooking — mobile player page (players scan QR to reach this)
app.get('/tv-cooking-play', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'tv-cooking-play.html'));
});

// Leaderboard endpoint
app.get('/api/leaderboard', (req, res) => {
  const leaderboard = require('./src/leaderboard');
  res.json(leaderboard.getAllLeaderboards(10));
});

// Health endpoint
app.get('/health', (req, res) => {
  const roomManager = require('./src/rooms/roomManager');
  res.json({
    status: 'ok',
    rooms: roomManager.roomCount(),
    connections: io.engine.clientsCount
  });
});

// Socket.IO setup — room events wired in rooms module
require('./src/rooms/socketEvents')(io);

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`caritahub-games listening on port ${PORT}`);
});

module.exports = { io };
