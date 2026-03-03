'use strict';

// ── URL params ───────────────────────────────────────────────────────────────
const params = new URLSearchParams(location.search);
const roomId = params.get('room');

// ── Session persistence key ─────────────────────────────────────────────────
const SESSION_KEY = roomId ? `tvHL_${roomId}` : null;

// ── State ────────────────────────────────────────────────────────────────────
let myColor = null;
let mySeat  = -1;
let myName  = '';
let myRoomId = roomId;
let gameState = null;
let currentScreen = 'join'; // join | waiting | playing | gameover

// ── Constants ────────────────────────────────────────────────────────────────
const TV_HL_COLORS = ['tv-host', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];

function seatForColor(color) {
  if (color === 'tv-host') return -1;
  const idx = TV_HL_COLORS.indexOf(color);
  return idx > 0 ? idx - 1 : -1;
}

// ── Card color mapping ──────────────────────────────────────────────────────
function cardColor(num) {
  if (num >= 1 && num <= 10) return '#1155cc';     // blue
  if (num >= 11 && num <= 15) return '#1a6e1a';    // green
  if (num >= 16 && num <= 20) return '#7d3c98';    // purple
  if (num >= 21 && num <= 25) return '#c0392b';    // red
  if (num >= 26 && num <= 30) return '#b7600a';    // orange
  return '#555';
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
const cardsRemainingEl   = document.getElementById('cardsRemaining');
const currentCardDisplay = document.getElementById('currentCardDisplay');
const currentCardLabel   = document.getElementById('currentCardLabel');
const yourTurnText       = document.getElementById('yourTurnText');
const waitingTurnText    = document.getElementById('waitingTurnText');
const guessButtons       = document.getElementById('guessButtons');
const higherBtn          = document.getElementById('higherBtn');
const lowerBtn           = document.getElementById('lowerBtn');
const resultFeedback     = document.getElementById('resultFeedback');
const eliminatedOverlay  = document.getElementById('eliminatedOverlay');
const historyStripEl     = document.getElementById('historyStrip');

// Game Over
const gameoverEmoji      = document.getElementById('gameoverEmoji');
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
      roomId: myRoomId,
      playerName: myName,
      gameType: 'tv-higher-lower',
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
    if (!socket.connected) {
      reconnectOverlay.classList.remove('hidden');
      socket.connect();
    } else {
      socket.emit('join_game', {
        roomId: myRoomId,
        playerName: myName,
        gameType: 'tv-higher-lower',
        reconnect: true
      });
    }
  }
});

// Also handle iOS Safari's pagehide/pageshow for bfcache
window.addEventListener('pageshow', (event) => {
  if (event.persisted && myColor && myName) {
    if (!socket.connected) {
      socket.connect();
    } else {
      socket.emit('join_game', {
        roomId: myRoomId,
        playerName: myName,
        gameType: 'tv-higher-lower',
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
    gameType: 'tv-higher-lower'
  });
}

// ── Joined ───────────────────────────────────────────────────────────────────
socket.on('joined', ({ roomId: rid, color, reconnected }) => {
  myColor = color;
  mySeat = seatForColor(color);
  if (rid) myRoomId = rid;

  if (color === 'spectator' || color === 'tv-host') {
    joinError.textContent = 'Game is full. You are a spectator.';
    joinBtn.disabled = false;
    clearSession();
    return;
  }

  // Save session immediately on join
  saveSession();

  if (!reconnected) {
    waitingName.textContent = `You joined as ${escHtml(myName)}`;
    switchScreen('waiting');
  } else {
    waitingName.textContent = `Reconnecting as ${escHtml(myName)}...`;
    setTimeout(() => {
      if (currentScreen === 'join') {
        switchScreen('waiting');
        waitingName.textContent = `You joined as ${escHtml(myName)}`;
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

  if (currentScreen === 'join' && myColor && myColor !== 'spectator') {
    waitingName.textContent = `You joined as ${escHtml(myName)}`;
    switchScreen('waiting');
  }
});

// ── Game started ─────────────────────────────────────────────────────────────
socket.on('game_started', (state) => {
  if (state.gameType !== 'tv-higher-lower') return;
  gameState = state;
  switchScreen('playing');
  renderPlayingScreen(state);
  saveSession();
});

// ── Game state update ────────────────────────────────────────────────────────
socket.on('game_state', (state) => {
  if (state.gameType !== 'tv-higher-lower') return;
  gameState = state;

  if (currentScreen !== 'playing' && currentScreen !== 'gameover') {
    switchScreen('playing');
  }

  renderPlayingScreen(state);
  saveSession();
});

// ── Guess result (for animation) ─────────────────────────────────────────────
socket.on('tv_hl_result', ({ seat, guesserName, direction, correct, revealedCard, previousCard, eliminatedName }) => {
  // Animate result feedback
  if (seat === mySeat) {
    // My guess result
    if (correct) {
      resultFeedback.textContent = 'Correct!';
      resultFeedback.className = 'result-feedback result-correct';
      if ('vibrate' in navigator) navigator.vibrate(200);
    } else {
      resultFeedback.textContent = 'Wrong!';
      resultFeedback.className = 'result-feedback result-wrong';
      if ('vibrate' in navigator) navigator.vibrate([100, 50, 100, 50, 200]);
    }
    // Clear feedback after animation
    setTimeout(() => {
      resultFeedback.textContent = '';
      resultFeedback.className = 'result-feedback';
    }, 1500);
  } else {
    // Another player's guess — brief vibrate to draw attention
    if (document.visibilityState === 'visible' && 'vibrate' in navigator) {
      navigator.vibrate(50);
    }
  }
});

// ── Game over ────────────────────────────────────────────────────────────────
socket.on('game_over', ({ winner, reason }) => {
  const iWon = winner && winner === myName;

  if (iWon) {
    gameoverEmoji.textContent = '🏆';
    gameoverTitleEl.textContent = 'YOU WIN!';
    gameoverPersonalEl.textContent = 'Last one standing!';
  } else {
    const wasAlive = gameState && gameState.alive && mySeat >= 0 && gameState.alive[mySeat];
    if (wasAlive) {
      gameoverEmoji.textContent = '😊';
      gameoverTitleEl.textContent = 'Game Over';
      gameoverPersonalEl.textContent = 'You survived!';
    } else {
      gameoverEmoji.textContent = '👏';
      gameoverTitleEl.textContent = 'Game Over';
      gameoverPersonalEl.textContent = '';
    }
  }

  gameoverMsgEl.textContent = reason || (winner ? `Winner: ${winner}` : 'Game over!');

  // Delay so players can see the final card before the winner screen
  setTimeout(() => {
    switchScreen('gameover');
    if (iWon) {
      if ('vibrate' in navigator) navigator.vibrate([300, 100, 300, 100, 300]);
      launchConfetti();
      playVictorySound();
    }
    saveSession();
  }, 3000);
});

// ── Play again ───────────────────────────────────────────────────────────────
socket.on('play_again', () => {
  gameState = null;
  resultFeedback.textContent = '';
  resultFeedback.className = 'result-feedback';
  switchScreen('waiting');
  waitingName.textContent = `You joined as ${escHtml(myName)}`;
  saveSession();
});

// ── Error ────────────────────────────────────────────────────────────────────
socket.on('error', ({ message }) => {
  if (currentScreen === 'join') {
    joinError.textContent = message;
    joinBtn.disabled = false;
  } else {
    // Show as brief alert for non-join errors
    alert(message);
  }
});

// ── Screen switching ─────────────────────────────────────────────────────────
function switchScreen(name) {
  currentScreen = name;
  joinScreen.classList.toggle('active', name === 'join');
  waitingScreen.classList.toggle('active', name === 'waiting');
  playingScreen.classList.toggle('active', name === 'playing');
  gameoverScreen.classList.toggle('active', name === 'gameover');
}

// ── Render playing screen ────────────────────────────────────────────────────
function renderPlayingScreen(state) {
  if (!state) return;

  // Cards remaining
  cardsRemainingEl.textContent = `Cards remaining: ${state.cardsRemaining} / ${state.deckSize}`;

  // Current card display
  const card = state.currentCard;
  if (card != null) {
    currentCardDisplay.textContent = card;
    currentCardDisplay.style.background = cardColor(card);
    currentCardLabel.textContent = 'Current Card';
  } else {
    currentCardDisplay.textContent = '?';
    currentCardDisplay.style.background = '#555';
    currentCardLabel.textContent = 'Waiting...';
  }

  // Am I alive?
  const amAlive = mySeat >= 0 && state.alive && state.alive[mySeat];
  const isMyTurn = amAlive && state.currentSeat === mySeat && !state.isGameOver;

  // Turn indicator
  if (state.isGameOver) {
    yourTurnText.classList.add('hidden');
    waitingTurnText.classList.add('hidden');
    guessButtons.classList.add('hidden');
    eliminatedOverlay.classList.add('hidden');
  } else if (!amAlive && mySeat >= 0) {
    // Eliminated
    yourTurnText.classList.add('hidden');
    waitingTurnText.classList.add('hidden');
    guessButtons.classList.add('hidden');
    eliminatedOverlay.classList.remove('hidden');
  } else if (isMyTurn) {
    // My turn
    yourTurnText.classList.remove('hidden');
    waitingTurnText.classList.add('hidden');
    guessButtons.classList.remove('hidden');
    eliminatedOverlay.classList.add('hidden');
    // Re-enable buttons
    higherBtn.disabled = false;
    lowerBtn.disabled = false;
  } else {
    // Waiting for someone else
    yourTurnText.classList.add('hidden');
    waitingTurnText.classList.remove('hidden');
    guessButtons.classList.add('hidden');
    eliminatedOverlay.classList.add('hidden');

    // Show who's turn it is
    const currentPlayer = state.players && state.players.find(p => p.seat === state.currentSeat);
    if (currentPlayer) {
      waitingTurnText.textContent = `Waiting for ${escHtml(currentPlayer.name)}...`;
    } else {
      waitingTurnText.textContent = 'Waiting...';
    }
  }

  // History strip (last revealed cards)
  renderHistory(state.revealed);
}

// ── Guess buttons ────────────────────────────────────────────────────────────
higherBtn.addEventListener('click', () => {
  higherBtn.disabled = true;
  lowerBtn.disabled = true;
  socket.emit('tv_hl_guess', { direction: 'higher' });
});

lowerBtn.addEventListener('click', () => {
  higherBtn.disabled = true;
  lowerBtn.disabled = true;
  socket.emit('tv_hl_guess', { direction: 'lower' });
});

// ── Render history strip ─────────────────────────────────────────────────────
function renderHistory(revealed) {
  historyStripEl.innerHTML = '';
  if (!revealed || revealed.length === 0) return;

  // Show last 10 cards, newest first
  const recent = revealed.slice().reverse().slice(0, 10);
  recent.forEach((num, idx) => {
    const circle = document.createElement('div');
    circle.className = 'history-card' + (idx === 0 ? ' newest' : '');
    circle.textContent = num;
    circle.style.background = cardColor(num);
    historyStripEl.appendChild(circle);
  });
}

// ── Confetti ─────────────────────────────────────────────────────────────────
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
