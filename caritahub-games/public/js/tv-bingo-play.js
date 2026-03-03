'use strict';

// ── URL params ───────────────────────────────────────────────────────────────
const params = new URLSearchParams(location.search);
const roomId = params.get('room');

// ── Session persistence key ─────────────────────────────────────────────────
const SESSION_KEY = roomId ? `tvBingo_${roomId}` : null;

// ── State ────────────────────────────────────────────────────────────────────
let myColor = null;
let mySeat  = -1;
let myName  = '';
let gameState = null;
let calledSet = new Set(); // numbers that have been called (for highlighting tappable cells)
let currentScreen = 'join'; // track which screen we're on

// ── Constants ────────────────────────────────────────────────────────────────
const COLS = ['B', 'I', 'N', 'G', 'O'];
const CARD_SIZE = 5;
const FREE_ROW = 2;
const FREE_COL = 2;

const TV_BINGO_COLORS = ['tv-host', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];

function seatForColor(color) {
  if (color === 'tv-host') return -1;
  const idx = TV_BINGO_COLORS.indexOf(color);
  return idx > 0 ? idx - 1 : -1;
}

// ── Session persistence helpers ─────────────────────────────────────────────
function saveSession() {
  if (!SESSION_KEY) return;
  try {
    const data = {
      myName,
      myColor,
      mySeat,
      currentScreen,
      ts: Date.now()
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
  } catch (e) { /* storage full or unavailable */ }
}

function loadSession() {
  if (!SESSION_KEY) return null;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    // Expire sessions older than 30 minutes
    if (Date.now() - data.ts > 30 * 60 * 1000) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
    return data;
  } catch (e) { return null; }
}

function clearSession() {
  if (!SESSION_KEY) return;
  try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
}

// ── Restore session on page load ────────────────────────────────────────────
const savedSession = loadSession();
if (savedSession && savedSession.myName && savedSession.myColor) {
  myName  = savedSession.myName;
  myColor = savedSession.myColor;
  mySeat  = savedSession.mySeat;
  // Pre-fill name input for visual feedback during reconnect
}

// ── DOM refs ─────────────────────────────────────────────────────────────────
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
const cardTitleEl    = document.getElementById('cardTitle');
const bingoCardEl    = document.getElementById('bingoCard');
const historyStripEl = document.getElementById('historyStrip');

// Game Over
const gameoverTitleEl    = document.getElementById('gameoverTitle');
const gameoverPersonalEl = document.getElementById('gameoverPersonal');
const gameoverMsgEl      = document.getElementById('gameoverMsg');

// If we have a saved name, pre-fill the input
if (myName && nameInput) {
  nameInput.value = myName;
}

// ── Socket ───────────────────────────────────────────────────────────────────
const socket = io({
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  transports: ['websocket', 'polling']
});

socket.on('connect', () => {
  reconnectOverlay.classList.add('hidden');
  if (myColor && myName) {
    // Reconnecting — either socket drop, page refresh, or returning from background
    socket.emit('join_game', {
      roomId: roomId,
      playerName: myName,
      gameType: 'tv-bingo',
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

// ── Visibility change — handle phone background/foreground ──────────────────
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && myColor && myName) {
    // Page is back in foreground — check socket health
    if (!socket.connected) {
      reconnectOverlay.classList.remove('hidden');
      socket.connect(); // force reconnect
    } else {
      // Socket is connected but we may have missed state updates while in background.
      // Re-request current state by re-joining (server sends game_state on rejoin).
      socket.emit('join_game', {
        roomId: roomId,
        playerName: myName,
        gameType: 'tv-bingo',
        reconnect: true
      });
    }
  }
});

// Also handle iOS Safari's pagehide/pageshow for bfcache
window.addEventListener('pageshow', (event) => {
  if (event.persisted && myColor && myName) {
    // Page restored from bfcache
    if (!socket.connected) {
      socket.connect();
    } else {
      socket.emit('join_game', {
        roomId: roomId,
        playerName: myName,
        gameType: 'tv-bingo',
        reconnect: true
      });
    }
  }
});

// ── Join flow ────────────────────────────────────────────────────────────────
joinBtn.addEventListener('click', doJoin);
nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') doJoin(); });

function doJoin() {
  const name = nameInput.value.trim();
  if (!name) {
    joinError.textContent = 'Please enter your name.';
    return;
  }
  if (!roomId) {
    joinError.textContent = 'No game room found. Please scan the QR code again.';
    return;
  }
  myName = name;
  joinError.textContent = '';
  joinBtn.disabled = true;

  socket.emit('join_game', {
    roomId: roomId,
    playerName: name,
    gameType: 'tv-bingo'
  });
}

// ── Joined ───────────────────────────────────────────────────────────────────
socket.on('joined', ({ color, reconnected }) => {
  myColor = color;
  mySeat = seatForColor(color);

  if (color === 'spectator' || color === 'tv-host') {
    joinError.textContent = 'Game is full. You are a spectator.';
    joinBtn.disabled = false;
    clearSession();
    return;
  }

  // Save session immediately on join
  saveSession();

  // On reconnect, don't force to waiting screen — server will send game_state
  // which will switch us to the correct screen. Only go to waiting if not reconnecting.
  if (!reconnected) {
    waitingName.textContent = `You joined as ${myName}`;
    switchScreen('waiting');
  } else {
    // Reconnected — show a temporary status while we wait for game_state
    waitingName.textContent = `Reconnecting as ${myName}...`;
    // If we don't receive game_state within 1s, show waiting screen
    // (game might not have started yet)
    setTimeout(() => {
      if (currentScreen === 'join') {
        switchScreen('waiting');
        waitingName.textContent = `You joined as ${myName}`;
      }
    }, 1000);
  }
});

// ── Room update ──────────────────────────────────────────────────────────────
socket.on('room_update', ({ players }) => {
  const phonePlayers = players.filter(p => p.color !== 'tv-host');
  waitingPlayerList.innerHTML = '';
  phonePlayers.forEach(p => {
    const div = document.createElement('div');
    div.className = 'waiting-player-item';
    div.textContent = escHtml(p.name) + (p.connected ? '' : ' (disconnected)');
    if (!p.connected) div.style.opacity = '0.5';
    waitingPlayerList.appendChild(div);
  });

  // If we got room_update and we're still on join screen (reconnect before game),
  // switch to waiting
  if (currentScreen === 'join' && myColor && myColor !== 'spectator') {
    waitingName.textContent = `You joined as ${myName}`;
    switchScreen('waiting');
  }
});

// ── Game started ─────────────────────────────────────────────────────────────
socket.on('game_started', (state) => {
  if (state.gameType !== 'tv-bingo') return;
  gameState = state;
  calledSet = new Set(state.called);
  switchScreen('playing');
  applyState(state);
  saveSession();
});

// ── Game state update ────────────────────────────────────────────────────────
socket.on('game_state', (state) => {
  if (state.gameType !== 'tv-bingo') return;
  gameState = state;
  calledSet = new Set(state.called);

  // If we're not on the playing screen (e.g. after page refresh/reconnect),
  // switch to it now — the game is in progress
  if (currentScreen !== 'playing' && currentScreen !== 'gameover') {
    switchScreen('playing');
  }

  applyState(state);
  saveSession();
});

// ── Number called ────────────────────────────────────────────────────────────
socket.on('tv_bingo_number_called', ({ number, column }) => {
  calledSet.add(number);

  // Vibrate to alert the senior a new number was called
  if (document.visibilityState === 'visible' && 'vibrate' in navigator) {
    navigator.vibrate(200);
  }
});

// ── Mark result: correct tap ─────────────────────────────────────────────────
socket.on('tv_bingo_mark_ok', ({ row, col, number }) => {
  // Quick vibration for correct tap
  if ('vibrate' in navigator) navigator.vibrate(100);
});

// ── Mark result: wrong tap ───────────────────────────────────────────────────
socket.on('tv_bingo_wrong_tap', ({ row, col, number, reason }) => {
  // Error vibration
  if ('vibrate' in navigator) navigator.vibrate([50, 50, 50]);

  // Flash the cell red
  const cellEl = document.querySelector(`[data-row="${row}"][data-col="${col}"]`);
  if (cellEl) {
    cellEl.classList.add('wrong-tap');
    setTimeout(() => cellEl.classList.remove('wrong-tap'), 600);
  }
});

// ── Game over ────────────────────────────────────────────────────────────────
socket.on('game_over', ({ winner, reason }) => {
  // Check if I won
  const iWon = gameState && gameState.winners &&
    gameState.winners.some(w => w.seat === mySeat);

  if (iWon) {
    gameoverTitleEl.textContent = 'BINGO!';
    gameoverPersonalEl.textContent = 'You Won!';
    if ('vibrate' in navigator) navigator.vibrate([300, 100, 300, 100, 300]);
  } else {
    gameoverTitleEl.textContent = 'Game Over';
    gameoverPersonalEl.textContent = '';
  }

  gameoverMsgEl.textContent = reason || `Winner: ${winner}`;
  switchScreen('gameover');
  launchConfetti();
  playVictorySound();
  saveSession();
});

// ── Play again ───────────────────────────────────────────────────────────────
socket.on('play_again', () => {
  gameState = null;
  calledSet = new Set();
  switchScreen('waiting');
  waitingName.textContent = `You joined as ${myName}`;
  saveSession();
});

// ── Error ────────────────────────────────────────────────────────────────────
socket.on('error', ({ message }) => {
  joinError.textContent = message;
  joinBtn.disabled = false;
});

// ── Screen switching ─────────────────────────────────────────────────────────
function switchScreen(name) {
  currentScreen = name;
  joinScreen.classList.toggle('active', name === 'join');
  waitingScreen.classList.toggle('active', name === 'waiting');
  playingScreen.classList.toggle('active', name === 'playing');
  gameoverScreen.classList.toggle('active', name === 'gameover');
}

// ── Apply game state ─────────────────────────────────────────────────────────
function applyState(state) {
  if (mySeat < 0 || mySeat >= state.cards.length) return;

  // Render my card
  renderCard(state.cards[mySeat], state.marked[mySeat], state.lastCalled);

  // History strip (last 15, newest first)
  renderHistory(state.called);
}

// ── Render bingo card (tappable) ─────────────────────────────────────────────
function renderCard(card, marked, lastCalled) {
  bingoCardEl.innerHTML = '';

  // Header row
  const headerRow = document.createElement('div');
  headerRow.className = 'bingo-row';
  COLS.forEach(letter => {
    const cell = document.createElement('div');
    cell.className = `bingo-cell bingo-header-cell col-${letter}`;
    cell.textContent = letter;
    headerRow.appendChild(cell);
  });
  bingoCardEl.appendChild(headerRow);

  // Number rows
  for (let r = 0; r < CARD_SIZE; r++) {
    const row = document.createElement('div');
    row.className = 'bingo-row';
    for (let c = 0; c < CARD_SIZE; c++) {
      const cell = document.createElement('div');
      const isFree = r === FREE_ROW && c === FREE_COL;
      const isMarked = marked[r][c];
      const num = card[r][c];

      let cls = 'bingo-cell';
      if (isFree) cls += ' free';
      if (isMarked) cls += ' marked';

      cell.className = cls;
      cell.textContent = isFree ? 'FREE' : num;
      cell.dataset.row = r;
      cell.dataset.col = c;

      // Tap handler — only for non-free, non-marked cells
      if (!isFree && !isMarked) {
        cell.addEventListener('click', () => handleCellTap(r, c, num));
      }

      row.appendChild(cell);
    }
    bingoCardEl.appendChild(row);
  }
}

// ── Handle cell tap ──────────────────────────────────────────────────────────
function handleCellTap(row, col, num) {
  // Emit mark request to server — server validates if number was called
  socket.emit('tv_bingo_mark', { row, col });
}

// ── Render called history strip ──────────────────────────────────────────────
function renderHistory(called) {
  historyStripEl.innerHTML = '';
  const recent = called.slice().reverse().slice(0, 15);
  recent.forEach((n, idx) => {
    const col = Math.floor((n - 1) / 15);
    const ball = document.createElement('div');
    ball.className = `history-ball col-${COLS[col]}` + (idx === 0 ? ' newest' : '');
    ball.textContent = `${COLS[col]}${n}`;
    historyStripEl.appendChild(ball);
  });
}

// ── Confetti ────────────────────────────────────────────────────────────────
function launchConfetti() {
  const container = document.getElementById('confettiContainer');
  if (!container) return;
  container.classList.remove('hidden');
  container.innerHTML = '';

  const colors = ['#ffd700', '#ff6b6b', '#4ecca3', '#1155cc', '#7d3c98', '#ff9f43', '#ee5a24'];
  const shapes = ['circle', 'square'];

  for (let i = 0; i < 80; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    const color = colors[Math.floor(Math.random() * colors.length)];
    const shape = shapes[Math.floor(Math.random() * shapes.length)];
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = color;
    piece.style.animationDelay = `${Math.random() * 2}s`;
    piece.style.animationDuration = `${2 + Math.random() * 2}s`;
    if (shape === 'circle') piece.style.borderRadius = '50%';
    piece.style.width = `${6 + Math.random() * 8}px`;
    piece.style.height = piece.style.width;
    container.appendChild(piece);
  }

  // Clean up after animation
  setTimeout(() => {
    container.classList.add('hidden');
    container.innerHTML = '';
  }, 5000);
}

// ── Victory sound (Web Audio API — no external file needed) ─────────────────
function playVictorySound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.3, ctx.currentTime + i * 0.15);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + i * 0.15 + 0.4);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.15);
      osc.stop(ctx.currentTime + i * 0.15 + 0.5);
    });
    // Closing chord
    setTimeout(() => {
      const chord = [523.25, 659.25, 783.99, 1046.50];
      chord.forEach(freq => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.8);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 1);
      });
    }, 700);
  } catch (e) {
    // Audio not available — silently fail
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
