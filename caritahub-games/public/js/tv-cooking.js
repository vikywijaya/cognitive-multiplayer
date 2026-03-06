'use strict';
/* ── CaritaHub TV Cooking — host (Smart TV) client ─────────────────────── */
/* Shows animated Overcooked-style kitchen + order tickets panel            */

const socket = io({ transports: ['websocket', 'polling'] });

// ── State ─────────────────────────────────────────────────────────────────
let roomId = null;
let gameState = null;
let lastScore = 0;

// ── DOM ───────────────────────────────────────────────────────────────────
const lobbyPhase       = document.getElementById('lobbyPhase');
const playingPhase     = document.getElementById('playingPhase');
const gameoverPhase    = document.getElementById('gameoverPhase');
const lobbyPlayerList  = document.getElementById('lobbyPlayerList');
const startBtn         = document.getElementById('startBtn');
const timerDisplay     = document.getElementById('timerDisplay');
const scoreDisplay     = document.getElementById('scoreDisplay');
const ordersList       = document.getElementById('ordersList');
const chefsBar         = document.getElementById('chefsBar');
const avatarsContainer = document.getElementById('avatarsContainer');
const servingWindow    = document.getElementById('servingWindow');
const finalScore       = document.getElementById('finalScore');
const gameoverStats    = document.getElementById('gameoverStats');
const playAgainBtn     = document.getElementById('playAgainBtn');
const reconnectOverlay = document.getElementById('reconnectOverlay');

// ── Station positions for avatar placement (% of kitchen scene) ──────────
const STATION_POS = {
  chop:  { x: 14, y: 60 },
  stove: { x: 46, y: 60 },
  plate: { x: 78, y: 60 },
  idle:  { x: 46, y: 82 },
};
// Offset avatars at same station so they don't overlap
function avatarPos(station, index, totalAtStation) {
  const base = STATION_POS[station] || STATION_POS.idle;
  const spread = 8; // % spread per player
  const offset = (index - (totalAtStation - 1) / 2) * spread;
  return { x: base.x + offset, y: base.y };
}

// ── Phase helpers ─────────────────────────────────────────────────────────
function showPhase(id) {
  [lobbyPhase, playingPhase, gameoverPhase].forEach(el => el.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ── Helpers ───────────────────────────────────────────────────────────────
function formatTime(ms) {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}
function escHtml(s) {
  return s ? String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : '';
}
function spawnScorePop(text) {
  const el = document.createElement('div');
  el.className = 'score-pop';
  el.textContent = text;
  el.style.left = `${window.innerWidth * 0.35 + Math.random() * 60}px`;
  el.style.top  = `${window.innerHeight * 0.3}px`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1600);
}
function spawnServedItem(emoji) {
  const el = document.createElement('div');
  el.className = 'served-item';
  el.textContent = emoji;
  servingWindow.appendChild(el);
  setTimeout(() => el.remove(), 1600);
}

// ── Lobby rendering ───────────────────────────────────────────────────────
function buildJoinUrl(rid) {
  return `${location.protocol}//${location.host}/tv-cooking-play?room=${rid}`;
}
function renderLobbyPlayers(players) {
  const cooks = players.filter(p => p.color !== 'tv-host');
  if (!cooks.length) {
    lobbyPlayerList.innerHTML = '<div class="player-empty">Waiting for chefs…</div>';
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

// ── Kitchen avatar rendering ──────────────────────────────────────────────
function renderAvatars(players) {
  if (!players) return;
  // Group by station for offset calculation
  const stationGroups = {};
  for (const p of players) {
    const s = p.station || 'idle';
    if (!stationGroups[s]) stationGroups[s] = [];
    stationGroups[s].push(p);
  }

  let html = '';
  for (const p of players) {
    const s = p.station || 'idle';
    const group = stationGroups[s];
    const idx = group.indexOf(p);
    const pos = avatarPos(s, idx, group.length);
    const busyClass = p.busy ? ' busy' : '';

    html += `
      <div class="avatar${busyClass}" style="left:${pos.x}%;top:${pos.y}%;" data-player="${escHtml(p.name)}">
        <div class="avatar-emoji">${p.emoji || '🧑‍🍳'}</div>
        <div class="avatar-name" style="background:${p.color};color:#fff;">${escHtml(p.name)}</div>
        ${p.busy ? `<div class="avatar-task-label">${escHtml(p.station === 'chop' ? '🔪 Chopping' : p.station === 'stove' ? '🍳 Cooking' : p.station === 'plate' ? '🍽️ Plating' : 'Working…')}</div>` : ''}
      </div>
    `;
  }
  avatarsContainer.innerHTML = html;
}

// ── Station activity bubbles ──────────────────────────────────────────────
function updateStationActivity(players) {
  ['chop', 'stove', 'plate'].forEach(s => {
    const stationEl = document.getElementById('station' + s.charAt(0).toUpperCase() + s.slice(1));
    if (!stationEl) return;
    const working = players.filter(p => p.station === s && p.busy);
    const existing = stationEl.querySelector('.station-activity');
    if (working.length > 0) {
      if (!existing) {
        const div = document.createElement('div');
        div.className = 'station-activity';
        div.innerHTML = '<div class="station-bubble"></div><div class="station-bubble"></div><div class="station-bubble"></div>';
        stationEl.querySelector('.station-body').appendChild(div);
      }
    } else if (existing) {
      existing.remove();
    }
  });
}

// ── Orders panel rendering ────────────────────────────────────────────────
let prevOrderIds = new Set();

function renderOrders(orders) {
  if (!orders || !orders.length) {
    ordersList.innerHTML = '<div class="order-empty-slot">Waiting for orders…</div>';
    return;
  }
  const newIds = new Set(orders.map(o => o.id));

  // Check for completed orders (disappeared)
  for (const oldId of prevOrderIds) {
    if (!newIds.has(oldId)) {
      // An order was completed or expired
    }
  }
  prevOrderIds = newIds;

  ordersList.innerHTML = orders.map(o => {
    const frac = o.timeLeft / o.maxTime;
    const urgent = frac < 0.3;

    const tasksHtml = o.tasks.map(t => {
      let rightHtml = '';
      if (t.status === 'completed') {
        rightHtml = '<span class="order-task-check">✓</span>';
      } else if (t.status === 'claimed' && t.claimedBy) {
        rightHtml = `<span class="order-task-claimer"><span class="order-task-claimer-dot" style="background:${t.claimedColor || '#888'}"></span>${escHtml(t.claimedBy)}</span>`;
      } else {
        rightHtml = '<span style="color:#ff9f43;font-size:11px;font-weight:700;">OPEN</span>';
      }
      return `
        <div class="order-task-row ${t.status}">
          <span class="order-task-emoji">${t.emoji}</span>
          <span class="order-task-label">${escHtml(t.label)}</span>
          <span class="order-task-badge ${t.type}">${t.type}</span>
          ${rightHtml}
        </div>
      `;
    }).join('');

    return `
      <div class="order-ticket${urgent ? ' urgent' : ''}">
        <div class="order-ticket-header">
          <span class="order-ticket-name">${o.emoji} ${escHtml(o.recipeName)}</span>
          <span class="order-ticket-pts">+${o.points}</span>
        </div>
        <div class="order-timer-bar">
          <div class="order-timer-fill" style="width:${Math.round(frac * 100)}%"></div>
        </div>
        <div class="order-tasks-list">${tasksHtml}</div>
      </div>
    `;
  }).join('');
}

// ── Chefs bar ─────────────────────────────────────────────────────────────
function renderChefsBar(players) {
  if (!players) return;
  chefsBar.innerHTML = players.map(p => `
    <div class="chef-chip">
      <div class="chef-chip-dot" style="background:${p.color}"></div>
      <span>${p.emoji || '🧑‍🍳'} ${escHtml(p.name)}</span>
      <span class="chef-chip-status${p.busy ? ' busy' : ''}">${p.busy ? 'Working' : 'Idle'}</span>
    </div>
  `).join('');
}

// ── Full state render ─────────────────────────────────────────────────────
function renderGameState(gs) {
  const ms = gs.timeLeftMs || 0;
  timerDisplay.textContent = formatTime(ms);
  timerDisplay.classList.toggle('low', ms < 30000);
  scoreDisplay.textContent = `${gs.score || 0} pts`;

  if (gs.score > lastScore) {
    const diff = gs.score - lastScore;
    spawnScorePop(`+${diff}`);
    lastScore = gs.score;
  }

  renderAvatars(gs.players);
  updateStationActivity(gs.players);
  renderOrders(gs.orders);
  renderChefsBar(gs.players);
}

// ── Socket events ─────────────────────────────────────────────────────────
socket.on('connect', () => {
  reconnectOverlay.classList.add('hidden');
  socket.emit('join_game', { gameType: 'cooking', playerName: 'TV-Host', roomId: null });
});
socket.on('disconnect', () => reconnectOverlay.classList.remove('hidden'));

socket.on('joined', ({ roomId: rid }) => {
  roomId = rid;
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
  if (gameState) return;
  renderLobbyPlayers(players);
});

socket.on('cooking_started', (gs) => {
  gameState = gs;
  lastScore = gs.score || 0;
  prevOrderIds = new Set((gs.orders || []).map(o => o.id));
  showPhase('playingPhase');
  renderGameState(gs);
});

socket.on('cooking_state', (gs) => {
  gameState = gs;
  renderGameState(gs);
});

socket.on('cooking_game_over', ({ score }) => {
  finalScore.textContent = score || 0;
  if (gameState && gameState.stats) {
    gameoverStats.innerHTML = `
      Orders Completed: ${gameState.stats.ordersFilled || 0}<br>
      Orders Expired: ${gameState.stats.ordersExpired || 0}<br>
      Tasks Completed: ${gameState.stats.tasksCompleted || 0}
    `;
  }
  showPhase('gameoverPhase');
  gameState = null;
});

socket.on('play_again', () => {
  gameState = null; lastScore = 0; prevOrderIds = new Set();
  showPhase('lobbyPhase');
});

socket.on('error', ({ message }) => console.warn('Server error:', message));

// ── UI controls ───────────────────────────────────────────────────────────
startBtn.addEventListener('click', () => socket.emit('start_game'));
playAgainBtn.addEventListener('click', () => socket.emit('play_again'));
