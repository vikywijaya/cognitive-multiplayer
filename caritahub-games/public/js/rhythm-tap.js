'use strict';

// ── URL params ────────────────────────────────────────────────────────────────
const params  = new URLSearchParams(location.search);
const roomId  = params.get('room');
const myColor = params.get('color');
const myName  = decodeURIComponent(params.get('name') || '');

if (!roomId || !myColor) location.href = '/';

// ── Constants ─────────────────────────────────────────────────────────────────
const RHYTHM_COLORS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
const COLOR_NAMES   = { p1: 'Player 1', p2: 'Player 2', p3: 'Player 3',
                        p4: 'Player 4', p5: 'Player 5', p6: 'Player 6' };
const COLOR_HEX     = { p1: '#1155cc', p2: '#c0392b', p3: '#1a6e1a',
                        p4: '#7d3c98', p5: '#b7600a', p6: '#0e7490' };

// Visual lane colors (fixed 4 lanes)
const LANE_COLORS  = ['#1155cc', '#c0392b', '#1a6e1a', '#7d3c98'];
const LANE_LABELS  = ['Blue', 'Red', 'Green', 'Purple'];

const mySeat = RHYTHM_COLORS.indexOf(myColor);
const isHost = myColor === 'p1';

// Canvas timing
const TRAVEL_TIME_MS = 2000;  // ms for a beat to travel full canvas height
const TAP_ZONE_PCT   = 0.82;  // tap zone is at 82% of canvas height
const BEAT_H         = 28;    // px height of each beat block

// ── State ─────────────────────────────────────────────────────────────────────
let gameState    = null;
let gameActive   = false;
let animFrameId  = null;
let myLanes      = [];

// ── DOM refs ──────────────────────────────────────────────────────────────────
const statusBar          = document.getElementById('statusBar');
const waitingOverlay     = document.getElementById('waitingOverlay');
const waitingMsg         = document.getElementById('waitingMsg');
const reconnectOverlay   = document.getElementById('reconnectOverlay');
const gameUI             = document.getElementById('gameUI');
const rhythmPlayers      = document.getElementById('rhythmPlayers');
const rhythmPatternName  = document.getElementById('rhythmPatternName');
const rhythmBpmLabel     = document.getElementById('rhythmBpmLabel');
const rhythmCanvas       = document.getElementById('rhythmCanvas');
const rhythmFeedback     = document.getElementById('rhythmFeedback');
const rhythmButtons      = document.getElementById('rhythmButtons');
const rhythmHostControls = document.getElementById('rhythmHostControls');
const rhythmStartBtn     = document.getElementById('rhythmStartBtn');
const rhythmFinishBtn    = document.getElementById('rhythmFinishBtn');
const resultsOverlay     = document.getElementById('resultsOverlay');
const resultsTitle       = document.getElementById('resultsTitle');
const resultsBody        = document.getElementById('resultsBody');
const playAgainBtn       = document.getElementById('playAgainBtn');

const ctx = rhythmCanvas.getContext('2d');

// ── Socket ────────────────────────────────────────────────────────────────────
const socket = io({
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
  transports: ['websocket', 'polling']
});

socket.on('connect', () => {
  reconnectOverlay.classList.add('hidden');
  socket.emit('join_game', { roomId, playerName: myName, reconnect: true,
                             gameType: 'rhythm-tap' });
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

socket.on('rhythm_tap_result', ({ hit, accuracy }) => showFeedback(hit, accuracy));

socket.on('rhythm_score_update', ({ scores, beatsHit }) => {
  if (!gameState) return;
  gameState.scores   = scores;
  gameState.beatsHit = beatsHit;
  renderPlayers(gameState);
});

socket.on('game_over', ({ winner, reason }) => {
  gameActive = false;
  stopRenderLoop();
  showResults(reason);
});

socket.on('play_again', () => {
  gameActive = false;
  gameState  = null;
  myLanes    = [];
  stopRenderLoop();
  clearCanvas();
  resultsOverlay.classList.add('hidden');
  gameUI.classList.add('hidden');
  waitingOverlay.classList.remove('hidden');
  waitingMsg.textContent = 'Waiting for game to start…';
});

socket.on('error', ({ message }) => { statusBar.textContent = message; });

// ── applyState ────────────────────────────────────────────────────────────────
function applyState(state) {
  if (!state || state.gameType !== 'rhythm-tap') return;
  gameState = state;
  waitingOverlay.classList.add('hidden');
  gameUI.classList.remove('hidden');
  gameActive = !state.isGameOver;

  // Determine which lanes this player owns
  myLanes = (state.laneOwnership || [])[mySeat] || [];

  renderPlayers(state);
  updatePatternInfo(state);

  if (state.phase === 'waiting') {
    renderWaiting(state);
  } else if (state.phase === 'playing') {
    renderPlaying(state);
  } else if (state.phase === 'results') {
    stopRenderLoop();
    showResults('Game over! Check the scores above.');
  }
}

// ── renderWaiting ─────────────────────────────────────────────────────────────
function renderWaiting(state) {
  stopRenderLoop();
  clearCanvas();
  setButtonStates(false);

  if (isHost) {
    rhythmHostControls.classList.remove('hidden');
    rhythmStartBtn.classList.remove('hidden');
    rhythmStartBtn.disabled = false;
    rhythmFinishBtn.classList.add('hidden');
  } else {
    rhythmHostControls.classList.add('hidden');
  }
}

// ── renderPlaying ─────────────────────────────────────────────────────────────
function renderPlaying(state) {
  sizeCanvas();
  setButtonStates(true);

  if (isHost) {
    rhythmHostControls.classList.remove('hidden');
    rhythmStartBtn.classList.add('hidden');
    rhythmFinishBtn.classList.remove('hidden');
    rhythmFinishBtn.disabled = false;
  } else {
    rhythmHostControls.classList.add('hidden');
  }

  if (!animFrameId) startRenderLoop();
}

// ── setButtonStates ───────────────────────────────────────────────────────────
function setButtonStates(playing) {
  const btns = rhythmButtons.querySelectorAll('.rhythm-tap-btn');
  btns.forEach(btn => {
    const lane  = parseInt(btn.dataset.lane, 10);
    const mine  = myLanes.includes(lane);
    btn.disabled = !playing || !mine;
    btn.classList.toggle('rhythm-lane-mine',  mine);
    btn.classList.toggle('rhythm-lane-other', !mine);
  });
}

// ── Canvas sizing ─────────────────────────────────────────────────────────────
function sizeCanvas() {
  const wrap = rhythmCanvas.parentElement;
  rhythmCanvas.width  = wrap.clientWidth;
  rhythmCanvas.height = Math.min(Math.round(wrap.clientWidth * 0.85), 360);
}

function clearCanvas() {
  ctx.clearRect(0, 0, rhythmCanvas.width, rhythmCanvas.height);
}

// ── requestAnimationFrame render loop ────────────────────────────────────────
function startRenderLoop() {
  function frame() {
    if (!gameState || !gameActive || gameState.phase !== 'playing') {
      animFrameId = null;
      return;
    }
    drawFrame(gameState);
    animFrameId = requestAnimationFrame(frame);
  }
  animFrameId = requestAnimationFrame(frame);
}

function stopRenderLoop() {
  if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
}

// ── drawFrame ─────────────────────────────────────────────────────────────────
function drawFrame(state) {
  const W = rhythmCanvas.width;
  const H = rhythmCanvas.height;
  if (W === 0 || H === 0) return;

  const now      = Date.now();
  const gameTime = now - state.startTime;

  ctx.clearRect(0, 0, W, H);

  const laneW    = W / 4;
  const tapZoneY = H * TAP_ZONE_PCT;

  // ── Lane backgrounds ─────────────────────────────────────────────────
  for (let lane = 0; lane < 4; lane++) {
    const lx   = lane * laneW;
    const mine = myLanes.includes(lane);

    ctx.fillStyle = mine ? `${LANE_COLORS[lane]}18` : '#f8f8f818';
    ctx.fillRect(lx, 0, laneW, H);

    // Divider
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(lx, 0);
    ctx.lineTo(lx, H);
    ctx.stroke();
  }

  // ── Tap zone line ────────────────────────────────────────────────────
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth   = 2;
  ctx.setLineDash([8, 5]);
  ctx.beginPath();
  ctx.moveTo(0, tapZoneY);
  ctx.lineTo(W, tapZoneY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Target circles per lane at tap zone
  for (let lane = 0; lane < 4; lane++) {
    const cx = lane * laneW + laneW / 2;
    ctx.strokeStyle = `${LANE_COLORS[lane]}55`;
    ctx.lineWidth   = 3;
    ctx.beginPath();
    ctx.arc(cx, tapZoneY, 20, 0, Math.PI * 2);
    ctx.stroke();
  }

  // ── Beat blocks ──────────────────────────────────────────────────────
  (state.beats || []).forEach((beat, idx) => {
    const hit  = (state.beatsHit || [])[idx];
    const beatY = tapZoneY - ((beat.time - gameTime) / TRAVEL_TIME_MS) * H;

    // Skip off-screen beats
    if (beatY < -(BEAT_H + 10) || beatY > H + BEAT_H) return;

    const lx  = beat.lane * laneW + 5;
    const bW  = laneW - 10;
    const bY  = beatY - BEAT_H / 2;

    const inWindow = Math.abs(beat.time - gameTime) <= 400;

    if (hit) {
      // Hit: dim
      ctx.globalAlpha = 0.18;
      ctx.fillStyle   = LANE_COLORS[beat.lane];
      roundRect(ctx, lx, bY, bW, BEAT_H, 8);
      ctx.fill();
      ctx.globalAlpha = 1;
    } else {
      // Active
      ctx.fillStyle   = inWindow ? LANE_COLORS[beat.lane] : `${LANE_COLORS[beat.lane]}cc`;
      ctx.shadowColor = LANE_COLORS[beat.lane];
      ctx.shadowBlur  = inWindow ? 12 : 0;
      roundRect(ctx, lx, bY, bW, BEAT_H, 8);
      ctx.fill();
      ctx.shadowBlur  = 0;
    }
  });
}

// Rounded rect helper (fallback for older browsers)
function roundRect(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
}

// ── Tap button handlers ───────────────────────────────────────────────────────
let lastFeedbackTimer = null;

rhythmButtons.querySelectorAll('.rhythm-tap-btn').forEach(btn => {
  const tap = (e) => {
    e.preventDefault();
    if (!gameState || gameState.phase !== 'playing') return;
    const lane = parseInt(btn.dataset.lane, 10);
    if (!myLanes.includes(lane)) return;
    socket.emit('rhythm_tap', { lane, clientTime: Date.now() });

    // Visual press flash
    btn.classList.add('rhythm-btn-pressed');
    setTimeout(() => btn.classList.remove('rhythm-btn-pressed'), 120);
  };
  btn.addEventListener('touchstart', tap, { passive: false });
  btn.addEventListener('click', tap);
});

// ── Accuracy feedback ─────────────────────────────────────────────────────────
function showFeedback(hit, accuracy) {
  if (lastFeedbackTimer) clearTimeout(lastFeedbackTimer);

  const text = hit ? (accuracy === 'perfect' ? 'PERFECT!' : 'GOOD!') : 'MISS';
  const cls  = hit ? (accuracy === 'perfect' ? 'rhythm-feedback-perfect' : 'rhythm-feedback-good')
                    : 'rhythm-feedback-miss';

  rhythmFeedback.textContent = text;
  rhythmFeedback.className   = `rhythm-feedback ${cls}`;

  lastFeedbackTimer = setTimeout(() => {
    rhythmFeedback.textContent = '';
    rhythmFeedback.className   = 'rhythm-feedback';
  }, 700);
}

// ── Player chips ──────────────────────────────────────────────────────────────
function renderPlayers(state) {
  rhythmPlayers.innerHTML = '';
  const ownership = state.laneOwnership || [];
  (state.players || []).forEach((p, i) => {
    const chip = document.createElement('div');
    chip.className = `rhythm-player-chip${p.color === myColor ? ' rhythm-me' : ''}`;
    chip.style.borderColor = COLOR_HEX[p.color] || '#ccc';

    const lanes = (ownership[i] || []).map(l => LANE_LABELS[l] || `L${l}`).join(', ');
    const hits  = (state.scores || [])[i] || 0;

    chip.innerHTML = `
      <span class="rhythm-chip-dot" style="background:${COLOR_HEX[p.color] || '#ccc'}"></span>
      <span class="rhythm-chip-name">${escHtml(p.name)}</span>
      <span class="rhythm-chip-lanes">${escHtml(lanes)}</span>
      <span class="rhythm-chip-score">${hits} hit${hits !== 1 ? 's' : ''}</span>
    `;
    rhythmPlayers.appendChild(chip);
  });
}

// ── Pattern info ──────────────────────────────────────────────────────────────
function updatePatternInfo(state) {
  rhythmPatternName.textContent = state.patternName || '';
  rhythmBpmLabel.textContent    = state.bpm ? `${state.bpm} BPM` : '';
}

// ── Results ───────────────────────────────────────────────────────────────────
function showResults(reason) {
  if (!gameState) return;
  const scores  = gameState.scores || [];
  const players = gameState.players || [];

  const ranked = players
    .map((p, i) => ({ name: p.name, color: p.color, score: scores[i] || 0 }))
    .sort((a, b) => b.score - a.score);

  const topScore = ranked[0]?.score || 0;
  const winner   = ranked[0];

  resultsTitle.textContent = winner
    ? (ranked[0].color === myColor ? '🏆 You Win!' : `🏆 ${escHtml(winner.name)} Wins!`)
    : '🏆 Results';

  let html = '';
  if (reason) html += `<p class="rhythm-result-reason">${escHtml(reason)}</p>`;
  ranked.forEach((p, rank) => {
    const medal = rank === 0 ? '🥇' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : `${rank + 1}.`;
    html += `<div class="rhythm-result-row${p.score === topScore ? ' rhythm-result-winner' : ''}">
      <span class="rhythm-result-medal">${medal}</span>
      <span class="rhythm-result-name" style="color:${COLOR_HEX[p.color] || '#333'}">${escHtml(p.name)}</span>
      <span class="rhythm-result-score">${p.score} hit${p.score !== 1 ? 's' : ''}</span>
    </div>`;
  });
  resultsBody.innerHTML = html;
  resultsOverlay.classList.remove('hidden');
}

// ── Host controls ─────────────────────────────────────────────────────────────
rhythmStartBtn.addEventListener('click', () => {
  rhythmStartBtn.disabled = true;
  socket.emit('rhythm_start');
});
rhythmFinishBtn.addEventListener('click', () => {
  rhythmFinishBtn.disabled = true;
  socket.emit('rhythm_finish');
});
playAgainBtn.addEventListener('click', () => socket.emit('play_again'));

// ── Canvas resize ─────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  if (gameState && gameState.phase === 'playing') sizeCanvas();
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
