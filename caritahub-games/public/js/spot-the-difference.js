'use strict';

// ── URL params ────────────────────────────────────────────────────────────────
const params  = new URLSearchParams(location.search);
const roomId  = params.get('room');
const myColor = params.get('color');
const myName  = decodeURIComponent(params.get('name') || '');

if (!roomId || !myColor) location.href = '/';

// ── Constants ─────────────────────────────────────────────────────────────────
const DIFF_COLORS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
const COLOR_NAMES = { p1: 'Player 1', p2: 'Player 2', p3: 'Player 3',
                      p4: 'Player 4', p5: 'Player 5', p6: 'Player 6' };
const COLOR_HEX   = { p1: '#1155cc', p2: '#c0392b', p3: '#1a6e1a',
                      p4: '#7d3c98', p5: '#b7600a', p6: '#0e7490' };

const isHost = myColor === 'p1';

// ── State ─────────────────────────────────────────────────────────────────────
let gameState      = null;
let gameActive     = false;
let timerInterval  = null;
let timerDeadline  = 0;
let currentSceneId = null;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const statusBar        = document.getElementById('statusBar');
const waitingOverlay   = document.getElementById('waitingOverlay');
const waitingMsg       = document.getElementById('waitingMsg');
const reconnectOverlay = document.getElementById('reconnectOverlay');
const gameUI           = document.getElementById('gameUI');
const diffPlayers      = document.getElementById('diffPlayers');
const diffTimer        = document.getElementById('diffTimer');
const diffRoundLabel   = document.getElementById('diffRoundLabel');
const diffFoundLabel   = document.getElementById('diffFoundLabel');
const diffScoreLabel   = document.getElementById('diffScoreLabel');
const diffSceneLabel   = document.getElementById('diffSceneLabel');
const diffImgLeft      = document.getElementById('diffImgLeft');
const diffImgRight     = document.getElementById('diffImgRight');
const diffRightWrap    = document.getElementById('diffRightWrap');
const diffOverlay      = document.getElementById('diffOverlay');
const diffMissFlash    = document.getElementById('diffMissFlash');
const diffWaitHost     = document.getElementById('diffWaitHost');
const diffHostControls = document.getElementById('diffHostControls');
const diffStartBtn     = document.getElementById('diffStartBtn');
const diffNextBtn      = document.getElementById('diffNextBtn');
const diffFinishBtn    = document.getElementById('diffFinishBtn');
const resultsOverlay   = document.getElementById('resultsOverlay');
const resultsTitle     = document.getElementById('resultsTitle');
const resultsBody      = document.getElementById('resultsBody');
const playAgainBtn     = document.getElementById('playAgainBtn');

// ── Socket ────────────────────────────────────────────────────────────────────
const socket = io({
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
  transports: ['websocket', 'polling']
});

socket.on('connect', () => {
  reconnectOverlay.classList.add('hidden');
  socket.emit('join_game', { roomId, playerName: myName, reconnect: true,
                             gameType: 'spot-the-difference' });
});
socket.on('disconnect',    () => reconnectOverlay.classList.remove('hidden'));
socket.on('connect_error', () => reconnectOverlay.classList.remove('hidden'));

socket.on('joined', ({ color }) => {
  statusBar.textContent = isHost
    ? 'You are the Host (Player 1)'
    : `You are ${COLOR_NAMES[color] || color}`;
});

socket.on('room_update', ({ players }) => {
  if (!gameActive) {
    const n = players.filter(p => p.connected).length;
    waitingMsg.textContent = `Waiting for game… (${n} player${n !== 1 ? 's' : ''} connected)`;
  }
});

socket.on('game_started', state => applyState(state));
socket.on('game_state',   state => applyState(state));

socket.on('diff_miss', ({ x, y }) => showMissAt(x, y));

socket.on('game_over', ({ winner, reason }) => {
  gameActive = false;
  stopTimer();
  showResults(reason);
});

socket.on('play_again', () => {
  gameActive     = false;
  gameState      = null;
  currentSceneId = null;
  stopTimer();
  resultsOverlay.classList.add('hidden');
  gameUI.classList.add('hidden');
  waitingOverlay.classList.remove('hidden');
  waitingMsg.textContent = 'Waiting for game to start…';
});

socket.on('error', ({ message }) => { statusBar.textContent = message; });

// ── applyState ────────────────────────────────────────────────────────────────
function applyState(state) {
  if (!state || state.gameType !== 'spot-the-difference') return;
  gameState = state;
  waitingOverlay.classList.add('hidden');
  gameUI.classList.remove('hidden');
  gameActive = !state.isGameOver;

  renderPlayers(state);
  updateInfoBar(state);

  if (state.phase === 'waiting') {
    renderWaiting(state);
  } else if (state.phase === 'playing') {
    renderPlaying(state);
  } else if (state.phase === 'finished') {
    stopTimer();
    showResults(`Team score: ${state.teamScore} points!`);
  }
}

// ── renderWaiting ─────────────────────────────────────────────────────────────
function renderWaiting(state) {
  stopTimer();
  diffTimer.textContent = '—';
  diffWaitHost.classList.add('hidden');

  if (isHost) {
    diffHostControls.classList.remove('hidden');
    if (state.roundIndex < 0) {
      // Before first round
      diffStartBtn.classList.remove('hidden');
      diffStartBtn.disabled = false;
      diffNextBtn.classList.add('hidden');
      diffFinishBtn.classList.add('hidden');
    } else {
      // Between rounds
      diffStartBtn.classList.add('hidden');
      diffNextBtn.classList.remove('hidden');
      diffNextBtn.disabled = false;
      diffFinishBtn.classList.remove('hidden');
      diffFinishBtn.disabled = false;
    }
  } else {
    diffHostControls.classList.add('hidden');
    if (state.roundIndex >= 0) diffWaitHost.classList.remove('hidden');
  }
}

// ── renderPlaying ─────────────────────────────────────────────────────────────
function renderPlaying(state) {
  const scene = state.scene;
  if (!scene) return;

  diffWaitHost.classList.add('hidden');

  // Load images only when scene changes
  if (scene.id !== currentSceneId) {
    currentSceneId = scene.id;
    diffImgLeft.src  = scene.imageUrl;
    diffImgRight.src = scene.imageUrl;
    diffSceneLabel.textContent = scene.label;
    // Re-render overlay after image loads (for accurate getBoundingClientRect)
    diffImgRight.onload = () => renderHotspotOverlay(state);
  }
  // Also render immediately (handles cached images / re-renders)
  renderHotspotOverlay(state);

  // Start countdown from server's timeLeft
  startTimer(state.timeLeft);

  // Host: only show finish button during play (can end early)
  if (isHost) {
    diffHostControls.classList.remove('hidden');
    diffStartBtn.classList.add('hidden');
    diffNextBtn.classList.add('hidden');
    diffFinishBtn.classList.remove('hidden');
    diffFinishBtn.disabled = false;
  } else {
    diffHostControls.classList.add('hidden');
  }
}

// ── renderHotspotOverlay ──────────────────────────────────────────────────────
function renderHotspotOverlay(state) {
  const scene = state.scene;
  if (!scene) return;

  diffOverlay.innerHTML = '';

  const imgRect  = diffImgRight.getBoundingClientRect();
  const wrapRect = diffRightWrap.getBoundingClientRect();
  const imgW = imgRect.width;
  const imgH = imgRect.height;

  if (imgW === 0 || imgH === 0) return; // image not yet laid out

  scene.hotspots.forEach(hs => {
    const found = (state.foundIds || []).includes(hs.id);
    const el = document.createElement('div');
    el.className = 'diff-hotspot' + (found ? ' diff-hotspot-found' : '');

    // Convert % coords to px relative to the wrapper
    const offsetLeft = imgRect.left - wrapRect.left;
    const offsetTop  = imgRect.top  - wrapRect.top;
    const pxX = offsetLeft + (hs.x / 100) * imgW;
    const pxY = offsetTop  + (hs.y / 100) * imgH;
    const pxR = (hs.radius / 100) * Math.min(imgW, imgH);

    el.style.left   = `${pxX - pxR}px`;
    el.style.top    = `${pxY - pxR}px`;
    el.style.width  = `${pxR * 2}px`;
    el.style.height = `${pxR * 2}px`;

    // Clicking an overlay sends the hotspot's canonical % coords
    if (!found && state.phase === 'playing') {
      el.addEventListener('click', () => {
        socket.emit('diff_click', { x: hs.x, y: hs.y });
      });
    }

    diffOverlay.appendChild(el);
  });
}

// ── showMissAt ────────────────────────────────────────────────────────────────
function showMissAt(xPct, yPct) {
  const imgRect  = diffImgRight.getBoundingClientRect();
  const wrapRect = diffRightWrap.getBoundingClientRect();
  const px = (imgRect.left - wrapRect.left) + (xPct / 100) * imgRect.width;
  const py = (imgRect.top  - wrapRect.top)  + (yPct / 100) * imgRect.height;

  diffMissFlash.style.left = `${px - 15}px`;
  diffMissFlash.style.top  = `${py - 15}px`;
  diffMissFlash.classList.remove('hidden');
  setTimeout(() => diffMissFlash.classList.add('hidden'), 500);
}

// ── Timer ─────────────────────────────────────────────────────────────────────
function startTimer(secondsLeft) {
  stopTimer();
  timerDeadline = Date.now() + secondsLeft * 1000;
  tickTimer();
  timerInterval = setInterval(tickTimer, 500);
}
function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}
function tickTimer() {
  const remaining = Math.max(0, Math.ceil((timerDeadline - Date.now()) / 1000));
  diffTimer.textContent = `${remaining}s`;
  diffTimer.classList.toggle('diff-timer-urgent', remaining <= 10 && remaining > 0);
  if (remaining === 0) stopTimer();
}

// ── updateInfoBar ─────────────────────────────────────────────────────────────
function updateInfoBar(state) {
  const rNum  = state.roundIndex >= 0 ? state.roundIndex + 1 : '—';
  diffRoundLabel.textContent = `Round ${rNum} / ${state.totalRounds}`;
  const found = (state.foundIds || []).length;
  const total = state.scene?.hotspots?.length || 5;
  diffFoundLabel.textContent = `Found: ${found} / ${total}`;
  diffScoreLabel.textContent = `Team: ${state.teamScore} pts`;
}

// ── renderPlayers ─────────────────────────────────────────────────────────────
function renderPlayers(state) {
  diffPlayers.innerHTML = '';
  (state.players || []).forEach(p => {
    const chip = document.createElement('div');
    chip.className = `diff-player-chip${p.color === myColor ? ' diff-me' : ''}`;
    chip.style.borderColor = COLOR_HEX[p.color] || '#ccc';
    chip.innerHTML = `
      <span class="diff-chip-dot" style="background:${COLOR_HEX[p.color] || '#ccc'}"></span>
      <span class="diff-chip-name">${escHtml(p.name)}</span>
    `;
    diffPlayers.appendChild(chip);
  });
}

// ── showResults ───────────────────────────────────────────────────────────────
function showResults(reason) {
  if (!gameState) return;
  const total = (gameState.scene?.hotspots?.length || 5) * gameState.totalRounds;
  resultsTitle.textContent = '🎉 Game Complete!';
  let html = '';
  if (reason) html += `<p class="diff-result-reason">${escHtml(reason)}</p>`;
  html += `<div class="diff-result-score-big">${gameState.teamScore}<span style="font-size:1.5rem"> / ${total}</span></div>`;
  html += `<p class="diff-result-sub">differences found together</p>`;
  // Show player list
  html += '<div style="margin-top:16px;">';
  (gameState.players || []).forEach(p => {
    html += `<div class="diff-result-player">
      <span class="diff-chip-dot" style="background:${COLOR_HEX[p.color] || '#ccc'}; display:inline-block; width:10px; height:10px; border-radius:50%; margin-right:6px;"></span>
      <span style="color:${COLOR_HEX[p.color] || '#333'}; font-weight:700">${escHtml(p.name)}</span>
    </div>`;
  });
  html += '</div>';
  resultsBody.innerHTML = html;
  resultsOverlay.classList.remove('hidden');
}

// ── Host button handlers ──────────────────────────────────────────────────────
diffStartBtn.addEventListener('click', () => {
  diffStartBtn.disabled = true;
  socket.emit('diff_start');
});
diffNextBtn.addEventListener('click', () => {
  diffNextBtn.disabled = true;
  socket.emit('diff_next');
});
diffFinishBtn.addEventListener('click', () => {
  diffFinishBtn.disabled = true;
  socket.emit('diff_finish');
});
playAgainBtn.addEventListener('click', () => socket.emit('play_again'));

// ── Re-render overlay on resize (% → px) ─────────────────────────────────────
window.addEventListener('resize', () => {
  if (gameState && gameState.phase === 'playing') renderHotspotOverlay(gameState);
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
