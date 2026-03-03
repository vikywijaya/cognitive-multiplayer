'use strict';

// ── State ────────────────────────────────────────────────────────────────────
let myRoomId = null;
let gameState = null;
let phase = 'lobby'; // 'lobby' | 'playing' | 'gameover'
let countdownInterval = null;
const CALL_INTERVAL = 15; // seconds

// ── DOM refs ─────────────────────────────────────────────────────────────────
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
const calledCountEl    = document.getElementById('calledCount');
const numberValueEl    = document.getElementById('numberValue');
const countdownCircle  = document.getElementById('countdownCircle');
const countdownTextEl  = document.getElementById('countdownText');
const bingoBoardEl     = document.getElementById('bingoBoard');
const playersStripEl   = document.getElementById('playersStrip');

// Game Over
const gameoverWinnerEl = document.getElementById('gameoverWinner');
const playAgainBtn     = document.getElementById('playAgainBtn');

// ── Constants ────────────────────────────────────────────────────────────────
const COLS = ['B', 'I', 'N', 'G', 'O'];
const COL_RANGES = [
  { min: 1, max: 15 }, { min: 16, max: 30 }, { min: 31, max: 45 },
  { min: 46, max: 60 }, { min: 61, max: 75 }
];

// ── Socket ───────────────────────────────────────────────────────────────────
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
    gameType: 'tv-bingo',
    reconnect: !!myRoomId
  });
});

socket.on('disconnect', () => {
  reconnectOverlay.classList.remove('hidden');
});

socket.on('connect_error', () => {
  reconnectOverlay.classList.remove('hidden');
});

// ── Joined ───────────────────────────────────────────────────────────────────
socket.on('joined', ({ roomId }) => {
  myRoomId = roomId;
  const joinUrl = `${location.origin}/tv-bingo-play?room=${roomId}`;
  joinUrlEl.textContent = joinUrl;

  qrContainer.innerHTML = '';
  new QRCode(qrContainer, {
    text: joinUrl,
    width: 300,
    height: 300,
    correctLevel: QRCode.CorrectLevel.H
  });
});

// ── Room update (lobby) ──────────────────────────────────────────────────────
socket.on('room_update', ({ players }) => {
  const phonePlayers = players.filter(p => p.color !== 'tv-host');
  renderLobbyPlayers(phonePlayers);
  startBtn.disabled = phonePlayers.filter(p => p.connected).length < 1;
});

// ── Game started ─────────────────────────────────────────────────────────────
socket.on('game_started', (state) => {
  gameState = state;
  switchPhase('playing');
  buildBoard();
  applyState(state);
  startCountdown();
});

// ── Game state update ────────────────────────────────────────────────────────
socket.on('game_state', (state) => {
  if (state.gameType !== 'tv-bingo') return;
  gameState = state;
  applyState(state);
});

// ── Number called (for animation + speech) ───────────────────────────────────
socket.on('tv_bingo_number_called', ({ number, column }) => {
  animateNumber(column, number);
  speakNumber(column, number);
  resetCountdown();
});

// ── Game over ────────────────────────────────────────────────────────────────
socket.on('game_over', ({ winner, reason }) => {
  clearCountdown();

  // Show winner name prominently
  const winnerNameEl = document.getElementById('gameoverWinnerName');
  if (winnerNameEl) {
    winnerNameEl.textContent = winner || '';
  }
  gameoverWinnerEl.textContent = reason || `Winner: ${winner}`;

  switchPhase('gameover');
  launchTvConfetti();
  playTvVictorySound();
  speakWinner(winner);
});

// ── Play again ───────────────────────────────────────────────────────────────
socket.on('play_again', () => {
  gameState = null;
  clearCountdown();
  numberValueEl.textContent = '--';
  numberValueEl.classList.remove('pop');
  // Clean up confetti
  const confettiEl = document.getElementById('confettiContainer');
  if (confettiEl) { confettiEl.classList.add('hidden'); confettiEl.innerHTML = ''; }
  switchPhase('lobby');
});

socket.on('error', ({ message }) => {
  console.error('Server error:', message);
});

// ── Button handlers ──────────────────────────────────────────────────────────
startBtn.addEventListener('click', () => {
  startBtn.disabled = true;
  socket.emit('tv_bingo_start');
});

playAgainBtn.addEventListener('click', () => {
  socket.emit('play_again');
});

// ── Phase switching ──────────────────────────────────────────────────────────
function switchPhase(newPhase) {
  phase = newPhase;
  lobbyPhase.classList.toggle('active', newPhase === 'lobby');
  playingPhase.classList.toggle('active', newPhase === 'playing');
  gameoverPhase.classList.toggle('active', newPhase === 'gameover');
}

// ── Lobby player list ────────────────────────────────────────────────────────
function renderLobbyPlayers(players) {
  if (players.length === 0) {
    lobbyPlayerList.innerHTML = '<div class="tv-player-empty">Waiting for players...</div>';
    return;
  }
  lobbyPlayerList.innerHTML = '';
  players.forEach((p, i) => {
    const div = document.createElement('div');
    div.className = 'tv-player-item';
    div.textContent = `${i + 1}. ${escHtml(p.name)}`;
    if (!p.connected) div.style.opacity = '0.5';
    lobbyPlayerList.appendChild(div);
  });
}

// ── Build the 5-column number board ──────────────────────────────────────────
function buildBoard() {
  bingoBoardEl.innerHTML = '';
  for (let col = 0; col < 5; col++) {
    const colDiv = document.createElement('div');
    colDiv.className = 'tv-board-col';

    const header = document.createElement('div');
    header.className = `tv-board-col-header col-${COLS[col]}`;
    header.textContent = COLS[col];
    colDiv.appendChild(header);

    const { min, max } = COL_RANGES[col];
    for (let n = min; n <= max; n++) {
      const numDiv = document.createElement('div');
      numDiv.className = 'tv-board-num';
      numDiv.id = `board-${n}`;
      numDiv.textContent = n;
      colDiv.appendChild(numDiv);
    }
    bingoBoardEl.appendChild(colDiv);
  }
}

// ── Apply full game state ────────────────────────────────────────────────────
function applyState(state) {
  // Called count
  calledCountEl.textContent = `${state.called.length} / 75`;

  // Update board highlights
  const calledSet = new Set(state.called);
  for (let n = 1; n <= 75; n++) {
    const el = document.getElementById(`board-${n}`);
    if (!el) continue;
    const col = Math.floor((n - 1) / 15);
    el.className = 'tv-board-num';
    if (calledSet.has(n)) {
      el.classList.add('called', `col-${COLS[col]}`);
    }
    if (n === state.lastCalled) {
      el.classList.add('last-called');
    }
  }

  // Last called number
  if (state.lastCalled) {
    const col = COLS[Math.floor((state.lastCalled - 1) / 15)];
    numberValueEl.textContent = `${col}-${state.lastCalled}`;
  }

  // Players strip
  renderPlayersStrip(state.players, state.winners);
}

// ── Players strip ────────────────────────────────────────────────────────────
function renderPlayersStrip(players, winners) {
  playersStripEl.innerHTML = '';
  (players || []).forEach(p => {
    const isWinner = (winners || []).some(w => w.seat === p.seat);
    const chip = document.createElement('div');
    chip.className = 'tv-player-chip' + (isWinner ? ' winner' : '');

    // Count marked cells for this player (excluding FREE space)
    let markedCount = 0;
    if (gameState && gameState.marked && p.seat >= 0 && p.seat < gameState.marked.length) {
      const marked = gameState.marked[p.seat];
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
          if (r === 2 && c === 2) continue; // skip FREE
          if (marked[r][c]) markedCount++;
        }
      }
    }

    if (isWinner) {
      chip.innerHTML = `<span class="tv-player-name">${escHtml(p.name)}</span> <span class="tv-player-bingo">BINGO!</span>`;
    } else {
      chip.innerHTML = `<span class="tv-player-name">${escHtml(p.name)}</span> <span class="tv-player-progress">${markedCount}/24</span>`;
    }
    playersStripEl.appendChild(chip);
  });
}

// ── Number animation ─────────────────────────────────────────────────────────
function animateNumber(col, num) {
  numberValueEl.textContent = `${col}-${num}`;
  numberValueEl.classList.remove('pop');
  void numberValueEl.offsetWidth; // force reflow
  numberValueEl.classList.add('pop');
}

// ── Text-to-speech ───────────────────────────────────────────────────────────
function speakNumber(col, num) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(`${col}, ${num}`);
  utterance.rate = 0.9;
  utterance.pitch = 1.0;
  utterance.volume = 1.0;
  window.speechSynthesis.speak(utterance);
}

// ── Countdown timer ──────────────────────────────────────────────────────────
const CIRCUMFERENCE = 2 * Math.PI * 45; // r=45 from SVG

function startCountdown() {
  resetCountdown();
}

function resetCountdown() {
  clearCountdown();
  let remaining = CALL_INTERVAL;
  countdownTextEl.textContent = remaining;
  countdownCircle.style.strokeDashoffset = '0';

  countdownInterval = setInterval(() => {
    remaining--;
    if (remaining <= 0) remaining = 0;
    countdownTextEl.textContent = remaining;
    const progress = 1 - (remaining / CALL_INTERVAL);
    countdownCircle.style.strokeDashoffset = `${progress * CIRCUMFERENCE}`;
  }, 1000);
}

function clearCountdown() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
}

// ── TV Confetti ─────────────────────────────────────────────────────────────
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

  // Clean up after animation
  setTimeout(() => {
    container.classList.add('hidden');
    container.innerHTML = '';
  }, 8000);
}

// ── TV Victory Sound (Web Audio API) ────────────────────────────────────────
function playTvVictorySound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();

    // Fanfare arpeggio: C5, E5, G5, C6 then full chord
    const notes = [523.25, 659.25, 783.99, 1046.50];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.4, ctx.currentTime + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + i * 0.18 + 0.5);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.18);
      osc.stop(ctx.currentTime + i * 0.18 + 0.6);
    });

    // Triumphant chord after arpeggio
    setTimeout(() => {
      const chord = [261.63, 329.63, 392.00, 523.25, 659.25]; // C4-E4-G4-C5-E5
      chord.forEach(freq => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.25, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 1.2);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 1.5);
      });
    }, 800);
  } catch (e) {
    // Audio not available — silently fail
  }
}

// ── Speak winner name ───────────────────────────────────────────────────────
function speakWinner(winnerName) {
  if (!('speechSynthesis' in window) || !winnerName) return;
  // Short delay so the fanfare plays first
  setTimeout(() => {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(`Bingo! Congratulations ${winnerName}!`);
    utterance.rate = 0.85;
    utterance.pitch = 1.1;
    utterance.volume = 1.0;
    window.speechSynthesis.speak(utterance);
  }, 1500);
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
