'use strict';
/* ── CaritaHub TV Cooking — host (Smart TV) client ─────────────────────── */
/* Shows animated Overcooked-style kitchen + order tickets panel            */
/* Includes how-to-play intro screen + SFX via cooking-sfx.js              */

const socket = io({ transports: ['websocket', 'polling'] });

// ── State ─────────────────────────────────────────────────────────────────
let roomId = null;
let gameState = null;
let lastScore = 0;
let pendingGameState = null; // buffered state during how-to-play
let htpTimer = null;

// ── DOM ───────────────────────────────────────────────────────────────────
const lobbyPhase       = document.getElementById('lobbyPhase');
const howToPlayPhase   = document.getElementById('howToPlayPhase');
const playingPhase     = document.getElementById('playingPhase');
const gameoverPhase    = document.getElementById('gameoverPhase');
const lobbyPlayerList  = document.getElementById('lobbyPlayerList');
const startBtn         = document.getElementById('startBtn');
const timerDisplay     = document.getElementById('timerDisplay');
const scoreDisplay     = document.getElementById('scoreDisplay');
const tablesLeft       = document.getElementById('tablesLeft');
const tablesRight      = document.getElementById('tablesRight');
const chefsBar         = document.getElementById('chefsBar');
const avatarsContainer = document.getElementById('avatarsContainer');
const servingWindow    = document.getElementById('servingWindow');
const finalScore       = document.getElementById('finalScore');
const gameoverStats    = document.getElementById('gameoverStats');
const playAgainBtn     = document.getElementById('playAgainBtn');
const reconnectOverlay = document.getElementById('reconnectOverlay');
const htpCountdown     = document.getElementById('htpCountdown');
const htpReadyBtn      = document.getElementById('htpReadyBtn');

// ── Station positions for avatar placement (% of kitchen scene) ──────────
const STATION_POS = {
  chop:  { x: 18, y: 22 },
  stove: { x: 72, y: 22 },
  plate: { x: 45, y: 78 },
  idle:  { x: 45, y: 50 },
};
function avatarPos(station, index, totalAtStation) {
  const base = STATION_POS[station] || STATION_POS.idle;
  const spread = 8;
  const offset = (index - (totalAtStation - 1) / 2) * spread;
  return { x: base.x + offset, y: base.y };
}

// ── Phase helpers ─────────────────────────────────────────────────────────
function showPhase(id) {
  [lobbyPhase, howToPlayPhase, playingPhase, gameoverPhase].forEach(el => el.classList.remove('active'));
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

// ── How To Play countdown ─────────────────────────────────────────────────
function startHowToPlay(gs) {
  pendingGameState = gs;
  showPhase('howToPlayPhase');
  let remaining = 10;
  htpCountdown.textContent = remaining;

  htpTimer = setInterval(() => {
    remaining--;
    htpCountdown.textContent = remaining;
    if (remaining <= 3 && remaining > 0) SFX.tick();
    if (remaining <= 0) {
      endHowToPlay();
    }
  }, 1000);
}

function endHowToPlay() {
  if (htpTimer) { clearInterval(htpTimer); htpTimer = null; }
  SFX.go();
  const gs = pendingGameState || gameState;
  pendingGameState = null;
  showPhase('playingPhase');
  if (gs) renderGameState(gs);
}

htpReadyBtn.addEventListener('click', () => {
  SFX.click();
  endHowToPlay();
});

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

// ── Kitchen avatar rendering (DOM-diffing to preserve CSS transitions) ────
function renderAvatars(players) {
  if (!players) return;
  const stationGroups = {};
  for (const p of players) {
    const s = p.station || 'idle';
    if (!stationGroups[s]) stationGroups[s] = [];
    stationGroups[s].push(p);
  }

  // Reuse existing avatar elements to preserve CSS transitions
  const existingAvatars = {};
  for (const el of avatarsContainer.querySelectorAll('.avatar')) {
    existingAvatars[el.dataset.player] = el;
  }
  const seen = new Set();

  for (const p of players) {
    const s = p.station || 'idle';
    const group = stationGroups[s];
    const idx = group.indexOf(p);
    const pos = avatarPos(s, idx, group.length);
    const pName = escHtml(p.name);
    seen.add(pName);

    let el = existingAvatars[pName];
    if (el) {
      // Update existing avatar — preserves CSS transition
      el.style.left = pos.x + '%';
      el.style.top  = pos.y + '%';
      el.className = 'avatar' + (p.busy ? ' busy' : '');
      // Update task label
      const labelEl = el.querySelector('.avatar-task-label');
      if (p.busy) {
        const taskLabel = p.station === 'chop' ? '🔪 Chopping' : p.station === 'stove' ? '🍳 Cooking' : p.station === 'plate' ? '🍽️ Plating' : 'Working…';
        if (labelEl) { labelEl.textContent = taskLabel; }
        else {
          const lbl = document.createElement('div');
          lbl.className = 'avatar-task-label';
          lbl.textContent = taskLabel;
          el.appendChild(lbl);
        }
      } else if (labelEl) {
        labelEl.remove();
      }
    } else {
      // Create new avatar
      el = document.createElement('div');
      el.className = 'avatar' + (p.busy ? ' busy' : '');
      el.style.left = pos.x + '%';
      el.style.top  = pos.y + '%';
      el.dataset.player = pName;
      el.innerHTML = `
        <div class="avatar-emoji">${p.emoji || '🧑‍🍳'}</div>
        <div class="avatar-name" style="background:${p.color};color:#fff;">${pName}</div>
        ${p.busy ? `<div class="avatar-task-label">${escHtml(p.station === 'chop' ? '🔪 Chopping' : p.station === 'stove' ? '🍳 Cooking' : p.station === 'plate' ? '🍽️ Plating' : 'Working…')}</div>` : ''}
      `;
      avatarsContainer.appendChild(el);
    }
  }

  // Remove disconnected players
  for (const [name, el] of Object.entries(existingAvatars)) {
    if (!seen.has(name)) el.remove();
  }
}

// ── Station activity bubbles ──────────────────────────────────────────────
const _stationActive = { chop: false, stove: false, plate: false };
function updateStationActivity(players) {
  ['chop', 'stove', 'plate'].forEach(s => {
    const stationEl = document.getElementById('station' + s.charAt(0).toUpperCase() + s.slice(1));
    if (!stationEl) return;
    const isWorking = players.some(p => p.station === s && p.busy);
    // Only modify DOM when state changes
    if (isWorking === _stationActive[s]) return;
    _stationActive[s] = isWorking;
    const existing = stationEl.querySelector('.station-activity');
    if (isWorking && !existing) {
      const div = document.createElement('div');
      div.className = 'station-activity';
      div.innerHTML = '<div class="station-bubble"></div><div class="station-bubble"></div><div class="station-bubble"></div>';
      stationEl.querySelector('.station-body').appendChild(div);
    } else if (!isWorking && existing) {
      existing.remove();
    }
  });
}

// ── Dining room rendering + SFX triggers ──────────────────────────────────
let prevOrderIds = new Set();
let prevOrderCount = 0;

const CUSTOMER_GROUPS = [
  ['👨', '👩'],
  ['👴', '👵'],
  ['👦', '👧', '🧑'],
  ['👩‍💼'],
  ['🧔', '👱‍♀️'],
  ['👨‍🦱', '👩‍🦰'],
];
const TASK_ICONS = { chopping: '🔪', stirring: '🥄', flipping: '👆' };

function moodEmoji(frac) {
  if (frac > 0.65) return '😊';
  if (frac > 0.4)  return '😐';
  if (frac > 0.2)  return '😤';
  return '😡';
}

function renderTableCard(o) {
  const frac = o.timeLeft / o.maxTime;
  const urgent = frac < 0.25;
  const customers = CUSTOMER_GROUPS[o.id % CUSTOMER_GROUPS.length];

  const tasksHtml = o.tasks.map(t => {
    const icon = TASK_ICONS[t.type] || '?';
    if (t.status === 'completed') return `<span class="ctask completed">${icon}✓</span>`;
    else if (t.status === 'claimed') return `<span class="ctask claimed">${icon}</span>`;
    else return `<span class="ctask available">${icon}</span>`;
  }).join('');

  return `
    <div class="ctable${urgent ? ' urgent' : ''}">
      <div class="ctable-seats">${customers.map(e => `<span>${e}</span>`).join('')}</div>
      <div class="ctable-top">
        <span class="ctable-dish">${o.emoji} ${escHtml(o.recipeName)}</span>
        <span class="ctable-mood">${moodEmoji(frac)}</span>
      </div>
      <div class="ctable-timer"><div class="ctable-timer-fill" style="width:${Math.round(frac * 100)}%"></div></div>
      <div class="ctable-tasks">${tasksHtml}</div>
    </div>
  `;
}

function renderTables(orders) {
  if (!orders || !orders.length) {
    tablesLeft.innerHTML = '<div class="table-empty">Waiting for customers…</div>';
    tablesRight.innerHTML = '';
    prevOrderIds = new Set();
    prevOrderCount = 0;
    return;
  }
  const newIds = new Set(orders.map(o => o.id));
  if (orders.length > prevOrderCount && prevOrderCount > 0) SFX.newOrder();
  prevOrderIds = newIds;
  prevOrderCount = orders.length;

  // Split orders: first half left, second half right
  const mid = Math.ceil(orders.length / 2);
  tablesLeft.innerHTML  = orders.slice(0, mid).map(o => renderTableCard(o)).join('');
  tablesRight.innerHTML = orders.slice(mid).map(o => renderTableCard(o)).join('');
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
let prevScore = 0;

function renderGameState(gs) {
  const ms = gs.timeLeftMs || 0;
  timerDisplay.textContent = formatTime(ms);
  timerDisplay.classList.toggle('low', ms < 30000);
  scoreDisplay.textContent = `${gs.score || 0} pts`;

  // Goal progress
  const goalEl = document.getElementById('goalDisplay');
  if (goalEl && gs.goal) {
    const filled = (gs.stats && gs.stats.ordersFilled) || 0;
    goalEl.textContent = `${filled}/${gs.goal} Orders`;
    goalEl.classList.toggle('close', filled >= gs.goal - 2);
  }

  // Score change SFX
  if (gs.score > lastScore) {
    const diff = gs.score - lastScore;
    spawnScorePop(`+${diff}`);
    // If it's a big jump (order completed = 90-120 pts), play order served
    if (diff >= 50) {
      SFX.orderServed();
      // Find the recipe emoji for the served animation
      spawnServedItem('✅');
    }
    lastScore = gs.score;
  } else if (gs.score < prevScore) {
    // Score decreased = order expired
    SFX.orderExpired();
  }
  prevScore = gs.score;

  renderAvatars(gs.players);
  updateStationActivity(gs.players);
  renderTables(gs.orders);
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
  // SFX for new player joining
  const cooks = players.filter(p => p.color !== 'tv-host');
  if (cooks.length > 0) SFX.playerJoined();
  renderLobbyPlayers(players);
});

socket.on('cooking_started', (gs) => {
  gameState = gs;
  lastScore = gs.score || 0;
  prevScore = gs.score || 0;
  prevOrderIds = new Set((gs.orders || []).map(o => o.id));
  prevOrderCount = (gs.orders || []).length;
  // Show how-to-play first
  startHowToPlay(gs);
});

socket.on('cooking_state', (gs) => {
  gameState = gs;
  // If still in how-to-play, just buffer the latest state
  if (howToPlayPhase.classList.contains('active')) {
    pendingGameState = gs;
    return;
  }
  renderGameState(gs);
});

socket.on('cooking_game_over', ({ score, won }) => {
  if (won) SFX.victory(); else SFX.gameOver();
  const goEmoji = document.querySelector('.gameover-emoji');
  const goTitle = document.querySelector('.gameover-title');
  if (won) {
    goEmoji.textContent = '🎉';
    goTitle.textContent = 'You Won!';
    goTitle.style.color = '#4ecca3';
  } else {
    goEmoji.textContent = '⏰';
    goTitle.textContent = "Time's Up!";
    goTitle.style.color = '#ff6b6b';
  }
  finalScore.textContent = score || 0;
  if (gameState && gameState.stats) {
    gameoverStats.innerHTML = `
      Orders Served: ${gameState.stats.ordersFilled || 0}${gameState.goal ? ' / ' + gameState.goal : ''}<br>
      Orders Expired: ${gameState.stats.ordersExpired || 0}<br>
      Tasks Completed: ${gameState.stats.tasksCompleted || 0}
    `;
  }
  showPhase('gameoverPhase');
  gameState = null;
});

socket.on('play_again', () => {
  gameState = null; lastScore = 0; prevScore = 0;
  prevOrderIds = new Set(); prevOrderCount = 0;
  showPhase('lobbyPhase');
});

socket.on('error', ({ message }) => console.warn('Server error:', message));

// ── UI controls ───────────────────────────────────────────────────────────
startBtn.addEventListener('click', () => {
  SFX.click();
  socket.emit('start_game');
});
playAgainBtn.addEventListener('click', () => {
  SFX.click();
  socket.emit('play_again');
});
