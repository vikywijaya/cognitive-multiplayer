'use strict';
/* ── CaritaHub TV Cooking — host (Smart TV) client ─────────────────────── */

// ── Kitchen map constants (mirrored from engine) ──────────────────────────
const COLS = 10, ROWS = 7;
const TILE_SIZE = 80; // canvas pixels per tile

const T = {
  WALL: 'W', FLOOR: 'F',
  LETTUCE_SHELF: 'LS', POTATO_SHELF: 'PS', TOMATO_SHELF: 'TS',
  SINK: 'SK', CUTTING_BOARD: 'CB', STOVE: 'ST',
  COUNTER: 'CT', SERVE: 'SW',
};

const TILE_COLORS = {
  W:  '#2c1a4a',  // dark wall
  F:  '#3a2a5a',  // floor
  LS: '#2d6a4f',  // lettuce shelf – green
  PS: '#856404',  // potato shelf – brown/gold
  TS: '#a93226',  // tomato shelf – red
  SK: '#1a6fa0',  // sink – blue
  CB: '#7d6608',  // cutting board – wood
  ST: '#a04000',  // stove – orange/red
  CT: '#5d4e75',  // counter – purple-grey
  SW: '#b7950b',  // serving window – gold
};

const TILE_ICONS = {
  LS: '🥬', PS: '🥔', TS: '🍅',
  SK: '🚿', CB: '🔪', ST: '🔥',
  CT: '📦', SW: '🍽️',
};

const TILE_LABELS = {
  LS: 'Lettuce', PS: 'Potato', TS: 'Tomato',
  SK: 'Sink', CB: 'Chop', ST: 'Stove',
  CT: 'Counter', SW: 'Serve',
};

const ITEM_EMOJI = {
  lettuce_raw: '🥬', lettuce_washed: '🥬', lettuce_chopped: '🥗',
  tomato_raw: '🍅', tomato_washed: '🍅', tomato_chopped: '🍅',
  potato_raw: '🥔', potato_washed: '🥔', potato_cooking: '🍲',
  potato_cooked: '🥔', potato_burnt: '🫘',
  salad: '🥗', potato_soup: '🥣',
};

// ── Socket ────────────────────────────────────────────────────────────────
const socket = io({ transports: ['websocket', 'polling'] });

// ── State ─────────────────────────────────────────────────────────────────
let roomId = null;
let gameState = null;
let lastScore = 0;

// ── DOM ───────────────────────────────────────────────────────────────────
const lobbyPhase   = document.getElementById('lobbyPhase');
const playingPhase = document.getElementById('playingPhase');
const gameoverPhase = document.getElementById('gameoverPhase');
const lobbyPlayerList = document.getElementById('lobbyPlayerList');
const startBtn     = document.getElementById('startBtn');
const timerDisplay = document.getElementById('timerDisplay');
const scoreDisplay = document.getElementById('scoreDisplay');
const ordersList   = document.getElementById('ordersList');
const playersList  = document.getElementById('playersList');
const finalScore   = document.getElementById('finalScore');
const playAgainBtn = document.getElementById('playAgainBtn');
const reconnectOverlay = document.getElementById('reconnectOverlay');
const canvas = document.getElementById('kitchenCanvas');
const ctx    = canvas.getContext('2d');

// Resize canvas to fit kitchen
canvas.width  = COLS * TILE_SIZE;
canvas.height = ROWS * TILE_SIZE;

// ── Phase helpers ─────────────────────────────────────────────────────────
function showPhase(id) {
  [lobbyPhase, playingPhase, gameoverPhase].forEach(el => el.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ── Lobby ─────────────────────────────────────────────────────────────────
function buildJoinUrl(rid) {
  const base = `${location.protocol}//${location.host}`;
  return `${base}/tv-cooking-play?room=${rid}`;
}

function renderLobbyPlayers(players) {
  const cooks = players.filter(p => p.color !== 'tv-host');
  if (!cooks.length) {
    lobbyPlayerList.innerHTML = '<div class="player-empty">Waiting for players…</div>';
    startBtn.disabled = true;
    return;
  }
  lobbyPlayerList.innerHTML = cooks.map(p => `
    <div class="player-pill">
      <div class="player-dot" style="background:${p.color}"></div>
      <span>${escHtml(p.name)}</span>
      ${!p.connected ? '<span style="color:#888;font-size:14px">(reconnecting)</span>' : ''}
    </div>
  `).join('');
  startBtn.disabled = !cooks.some(p => p.connected);
}

// ── Kitchen rendering ─────────────────────────────────────────────────────
function drawTile(x, y, tile) {
  const px = x * TILE_SIZE, py = y * TILE_SIZE;
  const color = TILE_COLORS[tile] || '#222';
  ctx.fillStyle = color;
  ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);

  // Border
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 2;
  ctx.strokeRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);

  // Icon + label for stations
  if (TILE_ICONS[tile]) {
    ctx.font = `${Math.round(TILE_SIZE * 0.4)}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(TILE_ICONS[tile], px + TILE_SIZE / 2, py + TILE_SIZE * 0.42);

    ctx.font = `bold ${Math.round(TILE_SIZE * 0.14)}px sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(TILE_LABELS[tile], px + TILE_SIZE / 2, py + TILE_SIZE * 0.82);
  }
}

function drawStationItem(x, y, stationData) {
  if (!stationData || !stationData.item) return;
  const px = x * TILE_SIZE, py = y * TILE_SIZE;

  // Item emoji in bottom-right corner of the tile
  ctx.font = `${Math.round(TILE_SIZE * 0.28)}px serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText(stationData.emoji || '📦', px + TILE_SIZE - 4, py + TILE_SIZE - 4);

  // Cook progress bar on stove
  if (stationData.cookProgress !== null && stationData.cookProgress !== undefined && !stationData.burnt) {
    const barW = TILE_SIZE - 12;
    const barH = 6;
    const barX = px + 6, barY = py + TILE_SIZE - 14;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = stationData.cooked ? '#2ecc71' : '#ff9f43';
    ctx.fillRect(barX, barY, barW * Math.min(1, stationData.cookProgress), barH);
  }
}

function drawPlayer(p) {
  const px = p.x * TILE_SIZE, py = p.y * TILE_SIZE;
  const cx = px + TILE_SIZE / 2, cy = py + TILE_SIZE / 2;
  const radius = TILE_SIZE * 0.3;

  // Shadow
  ctx.beginPath();
  ctx.ellipse(cx, cy + radius * 0.6, radius * 0.8, radius * 0.25, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fill();

  // Player circle
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = p.color;
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 3;
  ctx.stroke();

  // Name initial
  ctx.font = `bold ${Math.round(TILE_SIZE * 0.22)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  ctx.fillText(p.name.charAt(0).toUpperCase(), cx, cy);

  // Held item emoji (above player)
  if (p.holdingEmoji) {
    ctx.font = `${Math.round(TILE_SIZE * 0.28)}px serif`;
    ctx.fillText(p.holdingEmoji, cx, cy - radius - 14);
  }

  // Name label below player
  ctx.font = `bold ${Math.round(TILE_SIZE * 0.14)}px sans-serif`;
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'top';
  ctx.fillText(p.name.slice(0, 8), cx, py + TILE_SIZE - 4);
}

function renderKitchen(gs) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!gs || !gs.map) return;
  const map = gs.map;

  // Draw tiles
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const tile = map[row][col];
      drawTile(col, row, tile);
    }
  }

  // Draw station items
  if (gs.stations) {
    for (const [key, si] of Object.entries(gs.stations)) {
      const [x, y] = key.split(',').map(Number);
      drawStationItem(x, y, si);
    }
  }

  // Draw players
  if (gs.players) {
    for (const p of gs.players) drawPlayer(p);
  }
}

// ── Sidebar rendering ─────────────────────────────────────────────────────
function formatTime(ms) {
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function renderOrders(orders) {
  if (!orders || !orders.length) {
    ordersList.innerHTML = '<div class="player-empty">No orders yet…</div>';
    return;
  }
  ordersList.innerHTML = orders.map(o => {
    const frac = o.timeLeft / o.maxTime;
    const urgent = frac < 0.3;
    return `
      <div class="order-card${urgent ? ' urgent' : ''}">
        <div class="order-name">${o.emoji} ${escHtml(o.recipeName)}</div>
        <div class="order-timer-bar">
          <div class="order-timer-fill" style="width:${Math.round(frac*100)}%"></div>
        </div>
        <div class="order-points">+${o.points} pts · ${Math.ceil(o.timeLeft/1000)}s left</div>
      </div>
    `;
  }).join('');
}

function renderPlayers(players) {
  if (!players || !players.length) { playersList.innerHTML = ''; return; }
  const cooks = players.filter(p => p.color !== 'tv-host');
  playersList.innerHTML = cooks.map(p => `
    <div class="player-status-card">
      <div class="player-status-dot" style="background:${p.color}"></div>
      <span class="player-status-name">${escHtml(p.name)}</span>
      <span class="player-status-holding">${p.holdingEmoji ? p.holdingEmoji + ' ' + escHtml(p.holdingLabel || '') : ''}</span>
    </div>
  `).join('');
}

function renderSidebar(gs) {
  const ms = gs.timeLeftMs || 0;
  timerDisplay.textContent = formatTime(ms);
  timerDisplay.classList.toggle('low', ms < 30_000);
  scoreDisplay.textContent = gs.score || 0;

  // Score pop animation
  if (gs.score > lastScore) {
    const diff = gs.score - lastScore;
    spawnScorePop(`+${diff}`);
    lastScore = gs.score;
  }

  renderOrders(gs.orders);
  renderPlayers(gs.players);
}

function spawnScorePop(text) {
  const el = document.createElement('div');
  el.className = 'score-pop';
  el.textContent = text;
  el.style.left = `${250 + Math.random() * 60}px`;
  el.style.top  = `${window.innerHeight * 0.4}px`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1600);
}

// ── Socket events ─────────────────────────────────────────────────────────
socket.on('connect', () => {
  reconnectOverlay.classList.add('hidden');
  // TV host joins as 'tv-host'
  socket.emit('join_game', { gameType: 'cooking', playerName: 'TV-Host', roomId: null });
});

socket.on('disconnect', () => reconnectOverlay.classList.remove('hidden'));

socket.on('joined', ({ roomId: rid }) => {
  roomId = rid;

  // Build QR code and URL
  const url = buildJoinUrl(rid);
  document.getElementById('joinUrl').textContent = rid;
  document.getElementById('qrcode').innerHTML = '';
  new QRCode(document.getElementById('qrcode'), {
    text: url, width: 200, height: 200,
    colorDark: '#000', colorLight: '#fff',
    correctLevel: QRCode.CorrectLevel.M,
  });
});

socket.on('room_update', ({ players }) => {
  if (gameState) return; // game in progress
  renderLobbyPlayers(players);
});

socket.on('cooking_started', (gs) => {
  gameState = gs;
  lastScore = gs.score || 0;
  showPhase('playingPhase');
  renderKitchen(gs);
  renderSidebar(gs);
});

socket.on('cooking_state', (gs) => {
  gameState = gs;
  renderKitchen(gs);
  renderSidebar(gs);
});

socket.on('cooking_game_over', ({ score }) => {
  finalScore.textContent = score || 0;
  showPhase('gameoverPhase');
  gameState = null;
});

socket.on('play_again', () => {
  gameState = null;
  lastScore = 0;
  ordersList.innerHTML = '<div class="player-empty">No orders yet…</div>';
  showPhase('lobbyPhase');
});

socket.on('error', ({ message }) => console.warn('Server error:', message));

// ── UI controls ───────────────────────────────────────────────────────────
startBtn.addEventListener('click', () => {
  socket.emit('start_game');
});

playAgainBtn.addEventListener('click', () => {
  socket.emit('play_again');
});

// ── Helpers ───────────────────────────────────────────────────────────────
function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
