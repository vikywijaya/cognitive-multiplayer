'use strict';

// ── URL params ────────────────────────────────────────────────────────────────
const params = new URLSearchParams(location.search);
const roomId = params.get('room');

// ── Session persistence key ───────────────────────────────────────────────────
const SESSION_KEY = roomId ? `tvReversi_${roomId}` : null;

// ── State ─────────────────────────────────────────────────────────────────────
let myColor = null;       // 'black' | 'white'
let myName  = '';
let gameState = null;
let currentScreen = 'join';

const myEngineColor = () => myColor === 'black' ? 'B' : 'W';

// ── Session persistence ───────────────────────────────────────────────────────
function saveSession() {
  if (!SESSION_KEY) return;
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ myName, myColor, currentScreen, ts: Date.now() }));
  } catch (e) {}
}

function loadSession() {
  if (!SESSION_KEY) return null;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (Date.now() - data.ts > 30 * 60 * 1000) { sessionStorage.removeItem(SESSION_KEY); return null; }
    return data;
  } catch (e) { return null; }
}

function clearSession() {
  if (SESSION_KEY) try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
}

// Restore session on page load
const savedSession = loadSession();
if (savedSession && savedSession.myName && savedSession.myColor) {
  myName  = savedSession.myName;
  myColor = savedSession.myColor;
}

// ── DOM refs ──────────────────────────────────────────────────────────────────
const joinScreen       = document.getElementById('joinScreen');
const waitingScreen    = document.getElementById('waitingScreen');
const playingScreen    = document.getElementById('playingScreen');
const gameoverScreen   = document.getElementById('gameoverScreen');
const reconnectOverlay = document.getElementById('reconnectOverlay');

// Join
const nameInput = document.getElementById('nameInput');
const joinBtn   = document.getElementById('joinBtn');
const joinError = document.getElementById('joinError');

// Waiting
const waitingName       = document.getElementById('waitingName');
const waitingPlayerList = document.getElementById('waitingPlayerList');

// Playing
const statusBar         = document.getElementById('statusBar');
const opponentScorePanel = document.getElementById('opponentScorePanel');
const myScorePanel       = document.getElementById('myScorePanel');
const opponentNameEl    = document.getElementById('opponentNameEl');
const myNameEl          = document.getElementById('myNameEl');
const opponentCountEl   = document.getElementById('opponentCountEl');
const myCountEl         = document.getElementById('myCountEl');
const opponentDiscIcon  = document.getElementById('opponentDiscIcon');
const myDiscIcon        = document.getElementById('myDiscIcon');
const myTurnOverlay     = document.getElementById('myTurnOverlay');
const canvas            = document.getElementById('boardCanvas');
const ctx               = canvas.getContext('2d');

// Game Over
const gameoverEmojiEl    = document.getElementById('gameoverEmoji');
const gameoverTitleEl    = document.getElementById('gameoverTitle');
const gameoverPersonalEl = document.getElementById('gameoverPersonal');
const gameoverMsgEl      = document.getElementById('gameoverMsg');

// Pre-fill name from session
if (myName && nameInput) nameInput.value = myName;

// ── Socket ────────────────────────────────────────────────────────────────────
const socket = io({
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  transports: ['websocket', 'polling']
});

socket.on('connect', () => {
  reconnectOverlay.classList.add('hidden');
  if (myColor && myName) {
    socket.emit('join_game', {
      roomId,
      playerName: myName,
      gameType: 'tv-reversi',
      reconnect: true
    });
  }
});

socket.on('disconnect', () => {
  reconnectOverlay.classList.remove('hidden');
});

socket.on('connect_error', () => {
  reconnectOverlay.classList.remove('hidden');
});

// Visibility change — handle phone background/foreground
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && myColor && myName) {
    if (!socket.connected) {
      reconnectOverlay.classList.remove('hidden');
      socket.connect();
    } else {
      socket.emit('join_game', { roomId, playerName: myName, gameType: 'tv-reversi', reconnect: true });
    }
  }
});

window.addEventListener('pageshow', (event) => {
  if (event.persisted && myColor && myName) {
    if (!socket.connected) {
      socket.connect();
    } else {
      socket.emit('join_game', { roomId, playerName: myName, gameType: 'tv-reversi', reconnect: true });
    }
  }
});

// ── Join flow ─────────────────────────────────────────────────────────────────
joinBtn.addEventListener('click', doJoin);
nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') doJoin(); });

function doJoin() {
  const name = nameInput.value.trim();
  if (!name) { joinError.textContent = 'Please enter your name.'; return; }
  if (!roomId) { joinError.textContent = 'No game room found. Please scan the QR code again.'; return; }
  myName = name;
  joinError.textContent = '';
  joinBtn.disabled = true;
  socket.emit('join_game', { roomId, playerName: name, gameType: 'tv-reversi' });
}

// ── Joined ────────────────────────────────────────────────────────────────────
socket.on('joined', ({ color, reconnected }) => {
  myColor = color;

  if (color === 'spectator' || color === 'tv-host') {
    joinError.textContent = 'Game is full or room not found. Please scan the QR code again.';
    joinBtn.disabled = false;
    clearSession();
    return;
  }

  saveSession();

  // Style disc icons based on assigned color
  styleDiscIcons();

  if (!reconnected) {
    waitingName.textContent = `You joined as ${myName} (${color === 'black' ? '⚫ Black' : '⚪ White'})`;
    switchScreen('waiting');
  } else {
    waitingName.textContent = `Reconnecting as ${myName}…`;
    setTimeout(() => {
      if (currentScreen === 'join') {
        switchScreen('waiting');
        waitingName.textContent = `You joined as ${myName}`;
      }
    }, 1000);
  }
});

// ── Room update ───────────────────────────────────────────────────────────────
socket.on('room_update', ({ players }) => {
  const phonePlayers = players.filter(p => p.color !== 'tv-host');
  waitingPlayerList.innerHTML = '';
  phonePlayers.forEach(p => {
    const div = document.createElement('div');
    div.className = 'waiting-player-item';
    const disc = p.color === 'black' ? '⚫' : '⚪';
    div.textContent = `${disc} ${escHtml(p.name)}` + (p.connected ? '' : ' (disconnected)');
    if (!p.connected) div.style.opacity = '0.5';
    waitingPlayerList.appendChild(div);
  });

  if (currentScreen === 'join' && myColor && myColor !== 'spectator') {
    waitingName.textContent = `You joined as ${myName}`;
    switchScreen('waiting');
  }
});

// ── Game started ──────────────────────────────────────────────────────────────
socket.on('game_started', (state) => {
  if (state.gameType !== 'tv-reversi') return;
  gameState = state;
  switchScreen('playing');
  resizeCanvas();
  applyState(state);
  saveSession();
});

// ── Game state update ─────────────────────────────────────────────────────────
socket.on('game_state', (state) => {
  if (state.gameType !== 'tv-reversi') return;
  gameState = state;

  if (currentScreen !== 'playing' && currentScreen !== 'gameover') {
    switchScreen('playing');
    resizeCanvas();
  }

  applyState(state);
  saveSession();
});

// ── Game over ─────────────────────────────────────────────────────────────────
socket.on('game_over', ({ winner, reason }) => {
  // winner is the winning player's name (or null for draw)
  const winnerName = winner;
  const iWon = winnerName && winnerName === myName;
  const isDraw = !winnerName;

  if (isDraw) {
    gameoverEmojiEl.textContent = '🤝';
    gameoverTitleEl.textContent = "It's a Draw!";
    gameoverPersonalEl.textContent = '';
  } else if (iWon) {
    gameoverEmojiEl.textContent = '🏆';
    gameoverTitleEl.textContent = 'You Win!';
    gameoverPersonalEl.textContent = 'Congratulations!';
    if ('vibrate' in navigator) navigator.vibrate([300, 100, 300, 100, 300]);
  } else {
    gameoverEmojiEl.textContent = '😔';
    gameoverTitleEl.textContent = 'You Lose';
    gameoverPersonalEl.textContent = '';
  }

  gameoverMsgEl.textContent = reason || (winnerName ? `${winnerName} wins!` : "It's a draw!");
  switchScreen('gameover');
  launchConfetti();
  playVictorySound();
  saveSession();
});

// ── Play again ────────────────────────────────────────────────────────────────
socket.on('play_again', () => {
  gameState = null;
  switchScreen('waiting');
  waitingName.textContent = `You joined as ${myName}`;
  saveSession();
});

// ── Invalid move feedback ─────────────────────────────────────────────────────
socket.on('invalid_move', ({ reason }) => {
  if (statusBar) {
    const prev = statusBar.textContent;
    statusBar.textContent = `Invalid: ${reason}`;
    setTimeout(() => { if (gameState) applyStatusText(gameState); }, 1500);
  }
  if ('vibrate' in navigator) navigator.vibrate([50, 50, 50]);
});

socket.on('error', ({ message }) => {
  joinError.textContent = message;
  joinBtn.disabled = false;
});

// ── Screen switching ──────────────────────────────────────────────────────────
function switchScreen(name) {
  currentScreen = name;
  joinScreen.classList.toggle('active', name === 'join');
  waitingScreen.classList.toggle('active', name === 'waiting');
  playingScreen.classList.toggle('active', name === 'playing');
  gameoverScreen.classList.toggle('active', name === 'gameover');
}

// ── Style disc icons ──────────────────────────────────────────────────────────
function styleDiscIcons() {
  if (!myColor) return;
  if (myColor === 'black') {
    myDiscIcon.classList.add('disc-black-icon');
    opponentDiscIcon.classList.add('disc-white-icon');
  } else {
    myDiscIcon.classList.add('disc-white-icon');
    opponentDiscIcon.classList.add('disc-black-icon');
  }
}

// ── Apply game state ──────────────────────────────────────────────────────────
function applyState(state) {
  styleDiscIcons();

  const mePlayer  = state.players.find(p => p.color === myColor);
  const oppPlayer = state.players.find(p => p.color !== myColor);

  if (mePlayer)  myNameEl.textContent  = mePlayer.name;
  if (oppPlayer) opponentNameEl.textContent = oppPlayer.name + (!oppPlayer.connected ? ' !' : '');

  // Disc counts
  const myDiscs  = myColor === 'black' ? state.discs.B : state.discs.W;
  const oppDiscs = myColor === 'black' ? state.discs.W : state.discs.B;
  myCountEl.textContent  = myDiscs  ?? 2;
  opponentCountEl.textContent = oppDiscs ?? 2;

  // Active panel highlight
  const isMyTurn = state.turn === myEngineColor() && !state.isGameOver;
  myScorePanel.classList.toggle('active', isMyTurn);
  opponentScorePanel.classList.toggle('active', !isMyTurn && !state.isGameOver);

  // My-turn border on board
  myTurnOverlay.classList.toggle('visible', isMyTurn);

  applyStatusText(state);
  drawBoard(state);
}

function applyStatusText(state) {
  if (!statusBar) return;
  if (state.isGameOver) {
    statusBar.textContent = 'Game over!';
  } else if (state.skippedLast) {
    const skippedColor = state.turn === myEngineColor() ? 'Your opponent has' : 'You have';
    statusBar.textContent = `${skippedColor} no valid moves — turn skipped`;
  } else {
    const isMyTurn = state.turn === myEngineColor();
    statusBar.textContent = isMyTurn ? 'Your turn — tap to place a disc' : "Opponent's turn…";
  }
}

// ── Board rendering ───────────────────────────────────────────────────────────
function resizeCanvas() {
  const wrap = canvas.parentElement;
  const size = wrap.clientWidth;
  canvas.width  = size;
  canvas.height = size;
  if (gameState) drawBoard(gameState);
}

function drawBoard(state) {
  if (!state || !state.board) return;
  const size = canvas.width;
  const cell = size / 8;
  const isMyTurn = state.turn === myEngineColor() && !state.isGameOver;

  // Background
  ctx.fillStyle = '#2d6a4f';
  ctx.fillRect(0, 0, size, size);

  // Grid
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

  // Valid move hints (only on your turn)
  if (isMyTurn && state.validMoves) {
    ctx.fillStyle = 'rgba(240,192,64,0.3)';
    for (const [r, c] of state.validMoves) {
      ctx.fillRect(c * cell + 1, r * cell + 1, cell - 2, cell - 2);
    }
    ctx.fillStyle = 'rgba(240,192,64,0.75)';
    for (const [r, c] of state.validMoves) {
      const cx = c * cell + cell / 2;
      const cy = r * cell + cell / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, cell * 0.15, 0, Math.PI * 2);
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
      ctx.shadowColor = 'rgba(0,0,0,0.4)';
      ctx.shadowBlur  = 6;
      ctx.shadowOffsetY = 3;

      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      if (disc === 'B') {
        const grad = ctx.createRadialGradient(cx - radius * 0.3, cy - radius * 0.3, radius * 0.05, cx, cy, radius);
        grad.addColorStop(0, '#555');
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

// ── Click / touch to place disc ───────────────────────────────────────────────
canvas.addEventListener('click', (e) => {
  if (!gameState || gameState.isGameOver) return;
  if (gameState.turn !== myEngineColor()) return; // not your turn

  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width  / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = (e.clientX - rect.left)  * scaleX;
  const y = (e.clientY - rect.top)   * scaleY;

  const cell = canvas.width / 8;
  const col  = Math.floor(x / cell);
  const row  = Math.floor(y / cell);

  if (row < 0 || row > 7 || col < 0 || col > 7) return;

  socket.emit('tv_reversi_move', { row, col });

  // Light vibration feedback on tap
  if ('vibrate' in navigator) navigator.vibrate(30);
});

// ── Resize observer ───────────────────────────────────────────────────────────
const ro = new ResizeObserver(resizeCanvas);
ro.observe(canvas.parentElement);

// ── Confetti ─────────────────────────────────────────────────────────────────
function launchConfetti() {
  const container = document.getElementById('confettiContainer');
  if (!container) return;
  container.classList.remove('hidden');
  container.innerHTML = '';
  const colors = ['#ffd700', '#ff6b6b', '#4ecca3', '#1155cc', '#7d3c98', '#ff9f43', '#ee5a24'];
  for (let i = 0; i < 80; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDelay = `${Math.random() * 2}s`;
    piece.style.animationDuration = `${2 + Math.random() * 2}s`;
    if (Math.random() > 0.5) piece.style.borderRadius = '50%';
    const size = `${6 + Math.random() * 8}px`;
    piece.style.width = size;
    piece.style.height = size;
    container.appendChild(piece);
  }
  setTimeout(() => { container.classList.add('hidden'); container.innerHTML = ''; }, 5000);
}

// ── Victory sound ─────────────────────────────────────────────────────────────
function playVictorySound() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const notes = [523.25, 659.25, 783.99, 1046.50];
    notes.forEach((freq, i) => {
      const osc  = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.3, audioCtx.currentTime + i * 0.15);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + i * 0.15 + 0.4);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(audioCtx.currentTime + i * 0.15);
      osc.stop(audioCtx.currentTime + i * 0.15 + 0.5);
    });
  } catch (e) {}
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
