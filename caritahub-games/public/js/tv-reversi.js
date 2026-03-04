'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let myRoomId = null;
let gameState = null;
let phase = 'lobby'; // 'lobby' | 'playing' | 'gameover'

// ── DOM refs ──────────────────────────────────────────────────────────────────
const lobbyPhase       = document.getElementById('lobbyPhase');
const playingPhase     = document.getElementById('playingPhase');
const gameoverPhase    = document.getElementById('gameoverPhase');
const reconnectOverlay = document.getElementById('reconnectOverlay');

// Lobby
const qrContainer      = document.getElementById('qrcode');
const joinUrlEl        = document.getElementById('joinUrl');
const lobbyPlayerList  = document.getElementById('lobbyPlayerList');
const startBtn         = document.getElementById('startBtn');

// Playing
const blackCardEl      = document.getElementById('blackCard');
const whiteCardEl      = document.getElementById('whiteCard');
const blackNameEl      = document.getElementById('blackName');
const whiteNameEl      = document.getElementById('whiteName');
const blackCountEl     = document.getElementById('blackCount');
const whiteCountEl     = document.getElementById('whiteCount');
const turnIndicatorEl  = document.getElementById('turnIndicator');
const canvas           = document.getElementById('tvBoardCanvas');
const ctx              = canvas.getContext('2d');

// Game Over
const gameoverEmojiEl      = document.getElementById('gameoverEmoji');
const gameoverTitleEl      = document.getElementById('gameoverTitle');
const gameoverWinnerNameEl = document.getElementById('gameoverWinnerName');
const gameoverWinnerEl     = document.getElementById('gameoverWinner');
const playAgainBtn         = document.getElementById('playAgainBtn');

// ── Socket ────────────────────────────────────────────────────────────────────
const socket = io({
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  transports: ['websocket', 'polling']
});

socket.on('connect', () => {
  reconnectOverlay.classList.add('hidden');
  socket.emit('join_game', {
    roomId: myRoomId || null,
    playerName: 'TV Display',
    gameType: 'tv-reversi',
    reconnect: !!myRoomId
  });
});

socket.on('disconnect', () => {
  reconnectOverlay.classList.remove('hidden');
});

socket.on('connect_error', () => {
  reconnectOverlay.classList.remove('hidden');
});

// ── Joined ────────────────────────────────────────────────────────────────────
socket.on('joined', ({ roomId }) => {
  myRoomId = roomId;
  const joinUrl = `${location.origin}/tv-reversi-play?room=${roomId}`;
  joinUrlEl.textContent = joinUrl;

  qrContainer.innerHTML = '';
  new QRCode(qrContainer, {
    text: joinUrl,
    width: 300,
    height: 300,
    correctLevel: QRCode.CorrectLevel.H
  });
});

// ── Room update (lobby) ───────────────────────────────────────────────────────
socket.on('room_update', ({ players }) => {
  const phonePlayers = players.filter(p => p.color !== 'tv-host');
  renderLobbyPlayers(phonePlayers);
  const connectedCount = phonePlayers.filter(p => p.connected).length;
  startBtn.disabled = connectedCount < 2;
});

// ── Game started ──────────────────────────────────────────────────────────────
socket.on('game_started', (state) => {
  if (state.gameType !== 'tv-reversi') return;
  gameState = state;
  switchPhase('playing');
  resizeCanvas();
  applyState(state);
});

// ── Game state update ─────────────────────────────────────────────────────────
socket.on('game_state', (state) => {
  if (state.gameType !== 'tv-reversi') return;
  gameState = state;
  applyState(state);
});

// ── Game over ─────────────────────────────────────────────────────────────────
socket.on('game_over', ({ winner, reason }) => {
  if (winner) {
    gameoverEmojiEl.textContent = '🏆';
    gameoverTitleEl.textContent = 'Winner!';
    gameoverWinnerNameEl.textContent = winner;
  } else {
    gameoverEmojiEl.textContent = '🤝';
    gameoverTitleEl.textContent = "It's a Draw!";
    gameoverWinnerNameEl.textContent = '';
  }
  gameoverWinnerEl.textContent = reason || '';

  switchPhase('gameover');
  launchTvConfetti();
  playTvVictorySound();
  if (winner) speakWinner(winner);
});

// ── Play again ────────────────────────────────────────────────────────────────
socket.on('play_again', () => {
  gameState = null;
  const confettiEl = document.getElementById('confettiContainer');
  if (confettiEl) { confettiEl.classList.add('hidden'); confettiEl.innerHTML = ''; }
  switchPhase('lobby');
});

socket.on('error', ({ message }) => {
  console.error('Server error:', message);
});

// ── Button handlers ───────────────────────────────────────────────────────────
startBtn.addEventListener('click', () => {
  startBtn.disabled = true;
  socket.emit('tv_reversi_start');
});

playAgainBtn.addEventListener('click', () => {
  socket.emit('play_again');
});

// ── Phase switching ───────────────────────────────────────────────────────────
function switchPhase(newPhase) {
  phase = newPhase;
  lobbyPhase.classList.toggle('active', newPhase === 'lobby');
  playingPhase.classList.toggle('active', newPhase === 'playing');
  gameoverPhase.classList.toggle('active', newPhase === 'gameover');
}

// ── Lobby player list ─────────────────────────────────────────────────────────
function renderLobbyPlayers(players) {
  if (players.length === 0) {
    lobbyPlayerList.innerHTML = '<div class="tv-player-empty">Waiting for players…</div>';
    return;
  }
  lobbyPlayerList.innerHTML = '';
  players.forEach((p) => {
    const div = document.createElement('div');
    div.className = 'tv-player-item';
    const disc = p.color === 'black' ? '⚫' : '⚪';
    div.textContent = `${disc} ${escHtml(p.name)}`;
    if (!p.connected) div.style.opacity = '0.5';
    lobbyPlayerList.appendChild(div);
  });
}

// ── Apply full game state ─────────────────────────────────────────────────────
function applyState(state) {
  // Player names
  const blackPlayer = state.players.find(p => p.color === 'black');
  const whitePlayer = state.players.find(p => p.color === 'white');
  if (blackPlayer) blackNameEl.textContent = blackPlayer.name + (!blackPlayer.connected ? ' (disconnected)' : '');
  if (whitePlayer) whiteNameEl.textContent = whitePlayer.name + (!whitePlayer.connected ? ' (disconnected)' : '');

  // Disc counts
  blackCountEl.textContent = state.discs.B ?? 2;
  whiteCountEl.textContent = state.discs.W ?? 2;

  // Active player highlight
  const blackTurn = state.turn === 'B' && !state.isGameOver;
  const whiteTurn = state.turn === 'W' && !state.isGameOver;
  blackCardEl.classList.toggle('active', blackTurn);
  whiteCardEl.classList.toggle('active', whiteTurn);

  // Turn indicator
  if (state.isGameOver) {
    turnIndicatorEl.textContent = 'Game Over';
  } else if (state.skippedLast) {
    const skippedColor = state.turn === 'B' ? 'White' : 'Black';
    turnIndicatorEl.textContent = `${skippedColor} has no moves — turn skipped`;
  } else {
    const turnName = state.turn === 'B'
      ? (blackPlayer?.name || 'Black')
      : (whitePlayer?.name || 'White');
    turnIndicatorEl.textContent = `${turnName}'s turn`;
  }

  drawBoard(state);
}

// ── Board rendering ───────────────────────────────────────────────────────────
function resizeCanvas() {
  const wrap = canvas.parentElement;
  const size = Math.min(wrap.clientWidth, wrap.clientHeight);
  canvas.width  = size;
  canvas.height = size;
  if (gameState) drawBoard(gameState);
}

function drawBoard(state) {
  if (!state || !state.board) return;
  const size = canvas.width;
  const cell = size / 8;

  // Background
  ctx.fillStyle = '#2d6a4f';
  ctx.fillRect(0, 0, size, size);

  // Grid lines
  ctx.strokeStyle = '#1b4332';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 8; i++) {
    const px = i * cell;
    ctx.beginPath(); ctx.moveTo(px, 0);  ctx.lineTo(px, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, px);  ctx.lineTo(size, px); ctx.stroke();
  }

  // Reference dots
  ctx.fillStyle = '#1b4332';
  for (const [dr, dc] of [[2,2],[2,6],[6,2],[6,6]]) {
    ctx.beginPath();
    ctx.arc(dc * cell + cell / 2, dr * cell + cell / 2, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Valid move hints (subtle — helps audience follow game)
  if (!state.isGameOver && state.validMoves) {
    ctx.fillStyle = 'rgba(240,192,64,0.2)';
    for (const [r, c] of state.validMoves) {
      ctx.fillRect(c * cell + 1, r * cell + 1, cell - 2, cell - 2);
    }
    ctx.fillStyle = 'rgba(240,192,64,0.55)';
    for (const [r, c] of state.validMoves) {
      const cx = c * cell + cell / 2;
      const cy = r * cell + cell / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, cell * 0.14, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Discs
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const disc = state.board[r][c];
      if (!disc) continue;

      const cx = c * cell + cell / 2;
      const cy = r * cell + cell / 2;
      const radius = cell * 0.42;

      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur  = 8;
      ctx.shadowOffsetY = 4;

      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      if (disc === 'B') {
        const grad = ctx.createRadialGradient(cx - radius * 0.3, cy - radius * 0.3, radius * 0.05, cx, cy, radius);
        grad.addColorStop(0, '#666');
        grad.addColorStop(1, '#111');
        ctx.fillStyle = grad;
      } else {
        const grad = ctx.createRadialGradient(cx - radius * 0.3, cy - radius * 0.3, radius * 0.05, cx, cy, radius);
        grad.addColorStop(0, '#fff');
        grad.addColorStop(1, '#ccc');
        ctx.fillStyle = grad;
      }
      ctx.fill();
      ctx.restore();

      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.strokeStyle = disc === 'B' ? '#333' : '#aaa';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
}

// Resize canvas when window resizes
window.addEventListener('resize', () => {
  if (phase === 'playing') resizeCanvas();
});

// ── TV Confetti ───────────────────────────────────────────────────────────────
function launchTvConfetti() {
  const container = document.getElementById('confettiContainer');
  if (!container) return;
  container.classList.remove('hidden');
  container.innerHTML = '';

  const colors = ['#ffd700', '#ff6b6b', '#4ecca3', '#1155cc', '#7d3c98', '#ff9f43', '#ee5a24', '#00d2d3'];
  const shapes = ['circle', 'square'];

  for (let i = 0; i < 150; i++) {
    const piece = document.createElement('div');
    piece.className = 'tv-confetti-piece';
    const color = colors[Math.floor(Math.random() * colors.length)];
    const shape = shapes[Math.floor(Math.random() * shapes.length)];
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = color;
    piece.style.animationDelay = `${Math.random() * 3}s`;
    piece.style.animationDuration = `${3 + Math.random() * 3}s`;
    if (shape === 'circle') piece.style.borderRadius = '50%';
    const size = 10 + Math.random() * 15;
    piece.style.width = `${size}px`;
    piece.style.height = `${size}px`;
    container.appendChild(piece);
  }

  setTimeout(() => {
    container.classList.add('hidden');
    container.innerHTML = '';
  }, 8000);
}

// ── TV Victory Sound ──────────────────────────────────────────────────────────
function playTvVictorySound() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const notes = [523.25, 659.25, 783.99, 1046.50];
    notes.forEach((freq, i) => {
      const osc  = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.4, audioCtx.currentTime + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + i * 0.18 + 0.5);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(audioCtx.currentTime + i * 0.18);
      osc.stop(audioCtx.currentTime + i * 0.18 + 0.6);
    });

    setTimeout(() => {
      const chord = [261.63, 329.63, 392.00, 523.25, 659.25];
      chord.forEach(freq => {
        const osc  = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 1.2);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(audioCtx.currentTime);
        osc.stop(audioCtx.currentTime + 1.5);
      });
    }, 800);
  } catch (e) {
    // Audio not available — silently fail
  }
}

// ── Speak winner name ─────────────────────────────────────────────────────────
function speakWinner(winnerName) {
  if (!('speechSynthesis' in window) || !winnerName) return;
  setTimeout(() => {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(`Congratulations ${winnerName}, you win!`);
    utterance.rate = 0.85;
    utterance.pitch = 1.1;
    utterance.volume = 1.0;
    window.speechSynthesis.speak(utterance);
  }, 1200);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
