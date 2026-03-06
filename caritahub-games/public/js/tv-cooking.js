'use strict';
/* ── CaritaHub TV Cooking — host (Smart TV) client ─────────────────────── */

const socket = io({ transports: ['websocket', 'polling'] });

// ── State ─────────────────────────────────────────────────────────────────
let roomId = null;
let gameState = null;
let lastScore = 0;
let lastOrderIds = new Set();

// ── DOM ───────────────────────────────────────────────────────────────────
const lobbyPhase     = document.getElementById('lobbyPhase');
const playingPhase   = document.getElementById('playingPhase');
const gameoverPhase  = document.getElementById('gameoverPhase');
const lobbyPlayerList = document.getElementById('lobbyPlayerList');
const startBtn       = document.getElementById('startBtn');
const timerDisplay   = document.getElementById('timerDisplay');
const scoreDisplay   = document.getElementById('scoreDisplay');
const ordersGrid     = document.getElementById('ordersGrid');
const chefsBar       = document.getElementById('chefsBar');
const finalScore     = document.getElementById('finalScore');
const gameoverStats  = document.getElementById('gameoverStats');
const playAgainBtn   = document.getElementById('playAgainBtn');
const reconnectOverlay = document.getElementById('reconnectOverlay');

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

// ── Helpers ───────────────────────────────────────────────────────────────
function formatTime(ms) {
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function spawnScorePop(text) {
  const el = document.createElement('div');
  el.className = 'score-pop';
  el.textContent = text;
  el.style.left = `${window.innerWidth / 2 - 40 + Math.random() * 80}px`;
  el.style.top  = `${window.innerHeight * 0.35}px`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1600);
}

// ── Render orders grid (4 slots) ──────────────────────────────────────────
function renderOrders(gs) {
  const orders = gs.orders || [];
  const newOrderIds = new Set(orders.map(o => o.id));

  let html = '';
  for (let i = 0; i < MAX_SLOTS; i++) {
    const order = orders[i];
    if (!order) {
      html += '<div class="order-slot empty"><div class="order-slot-placeholder">Waiting for order…</div></div>';
      continue;
    }

    const frac = order.timeLeft / order.maxTime;
    const urgent = frac < 0.3;

    let tasksHtml = '';
    for (const task of order.tasks) {
      let statusClass = task.status;
      let rightContent = '';

      if (task.status === 'completed') {
        rightContent = '<span class="task-check">&#10003;</span>';
      } else if (task.status === 'active') {
        // Show progress for active tasks
        const target = task.targetTaps || task.targetCircles || 1;
        const pct = Math.min(100, Math.round((task.progress / target) * 100));
        if (task.type === 'flipping') {
          rightContent = '<span class="task-type-badge flipping">TAP!</span>';
        } else {
          rightContent = `<div class="task-progress-bar"><div class="task-progress-fill" style="width:${pct}%"></div></div>`;
        }
      }

      const assigneeHtml = task.assignedTo
        ? `<span class="task-assignee"><span class="task-assignee-dot" style="background:${task.assignedColor || '#888'}"></span>${escHtml(task.assignedTo)}</span>`
        : '';

      tasksHtml += `
        <div class="task-row ${statusClass}">
          <span class="task-emoji">${task.emoji}</span>
          <span class="task-label">${escHtml(task.label)}</span>
          <span class="task-type-badge ${task.type}">${task.type}</span>
          ${assigneeHtml}
          ${rightContent}
        </div>
      `;
    }

    html += `
      <div class="order-slot${urgent ? ' urgent' : ''}" data-order-id="${order.id}">
        <div class="order-header">
          <span class="order-name">${order.emoji} ${escHtml(order.recipeName)}</span>
          <span class="order-points">+${order.points} pts</span>
        </div>
        <div class="order-timer-bar">
          <div class="order-timer-fill" style="width:${Math.round(frac * 100)}%"></div>
        </div>
        <div class="order-time-text">${Math.ceil(order.timeLeft / 1000)}s left</div>
        <div class="order-tasks">${tasksHtml}</div>
      </div>
    `;
  }

  ordersGrid.innerHTML = html;

  // Check for completed orders (were in lastOrderIds but no longer present)
  for (const oldId of lastOrderIds) {
    if (!newOrderIds.has(oldId)) {
      // Order was completed or expired — the score pop handles this
    }
  }
  lastOrderIds = newOrderIds;
}

const MAX_SLOTS = 4;

// ── Render chefs bar ──────────────────────────────────────────────────────
function renderChefs(players) {
  if (!players || !players.length) { chefsBar.innerHTML = ''; return; }
  chefsBar.innerHTML = players.map(p => `
    <div class="chef-card">
      <div class="chef-dot" style="background:${p.color}"></div>
      <span class="chef-name">${escHtml(p.name)}</span>
      <span class="chef-status${p.hasTask ? ' busy' : ''}">${
        p.hasTask
          ? `${p.taskEmoji || ''} ${escHtml(p.taskLabel || 'Working…')}`
          : 'Idle'
      }</span>
    </div>
  `).join('');
}

// ── Render full game state ────────────────────────────────────────────────
function renderGameState(gs) {
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

  renderOrders(gs);
  renderChefs(gs.players);
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
  lastOrderIds = new Set((gs.orders || []).map(o => o.id));
  showPhase('playingPhase');
  renderGameState(gs);
});

socket.on('cooking_state', (gs) => {
  gameState = gs;
  renderGameState(gs);
});

socket.on('cooking_game_over', ({ score }) => {
  const gs = gameState;
  finalScore.textContent = score || 0;
  if (gs && gs.stats) {
    gameoverStats.innerHTML = `
      Orders Completed: ${gs.stats.ordersFilled || 0}<br>
      Orders Expired: ${gs.stats.ordersExpired || 0}<br>
      Tasks Completed: ${gs.stats.tasksCompleted || 0}
    `;
  }
  showPhase('gameoverPhase');
  gameState = null;
});

socket.on('play_again', () => {
  gameState = null;
  lastScore = 0;
  lastOrderIds = new Set();
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
