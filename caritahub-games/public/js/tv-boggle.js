'use strict';

// ── State ────────────────────────────────────────────────────────────────────
let myRoomId = null;
let gameState = null;
let phase = 'lobby'; // 'lobby' | 'playing' | 'results' | 'gameover'
let countdownInterval = null;
const CALL_INTERVAL = 120; // seconds (full game duration)

// ── DOM refs ─────────────────────────────────────────────────────────────────
const lobbyPhase       = document.getElementById('lobbyPhase');
const playingPhase     = document.getElementById('playingPhase');
const resultsPhase     = document.getElementById('resultsPhase');
const gameoverPhase    = document.getElementById('gameoverPhase');
const reconnectOverlay = document.getElementById('reconnectOverlay');

// Lobby
const qrContainer      = document.getElementById('qrcode');
const joinUrlEl        = document.getElementById('joinUrl');
const lobbyPlayerList  = document.getElementById('lobbyPlayerList');
const startBtn         = document.getElementById('startBtn');

// Playing
const countdownCircle  = document.getElementById('countdownCircle');
const countdownTextEl  = document.getElementById('countdownText');
const boggleGridEl     = document.getElementById('boggleGrid');
const playersStripEl   = document.getElementById('playersStrip');

// Results
const resultsBoardEl   = document.getElementById('resultsBoard');

// Game Over
const gameoverWinnerNameEl = document.getElementById('gameoverWinnerName');
const gameoverWinnerEl     = document.getElementById('gameoverWinner');
const playAgainBtn         = document.getElementById('playAgainBtn');

// ── Grid cell colors ─────────────────────────────────────────────────────────
const CELL_COLORS = [
  '#1155cc', '#c0392b', '#1a6e1a', '#7d3c98',
  '#b7600a', '#0f7b6c', '#8e44ad', '#2980b9',
  '#d35400', '#27ae60', '#c0392b', '#2c3e50',
  '#16a085', '#e74c3c', '#2e86c1', '#6c3483'
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
    gameType: 'tv-boggle',
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
  const joinUrl = `${location.origin}/tv-boggle-play?room=${roomId}`;
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
  buildGrid(state.board);
  renderPlayersStrip(state.players);
  startCountdown();
});

// ── Game state (reconnect / mid-game sync) ──────────────────────────────────
socket.on('game_state', (state) => {
  if (state.gameType !== 'tv-boggle') return;
  gameState = state;

  // If scores exist (array from engine, non-null after endRound), the game ended
  if (state.scores && Array.isArray(state.scores) && state.scores.length > 0) {
    switchPhase('results');
    renderResults(state);
    return;
  }

  // Otherwise we are mid-game
  if (phase !== 'playing') {
    switchPhase('playing');
    buildGrid(state.board);
    startCountdown();
  }
  renderPlayersStrip(state.players);
});

// ── Boggle word counts update ────────────────────────────────────────────────
socket.on('boggle_counts', (data) => {
  // Server sends { submissionCounts: [count0, count1, ...] } indexed by seat
  // Map to name-keyed using gameState.players
  if (data && data.submissionCounts && gameState && gameState.players) {
    const mapped = {};
    gameState.players.forEach(p => {
      if (p.seat >= 0 && p.seat < data.submissionCounts.length) {
        mapped[p.name] = data.submissionCounts[p.seat];
      }
    });
    updatePlayerCounts(mapped);
  }
});

// ── Game over ────────────────────────────────────────────────────────────────
socket.on('game_over', ({ winner, reason, scores, playerWords }) => {
  clearCountdown();

  // If we have detailed results, show results phase first
  if (scores || playerWords) {
    gameState = gameState || {};
    if (scores) gameState.scores = scores;
    if (playerWords) gameState.playerWords = playerWords;
  }

  // Show winner
  gameoverWinnerNameEl.textContent = winner || '';
  gameoverWinnerEl.textContent = reason || `Winner: ${winner}`;

  switchPhase('gameover');
  launchTvConfetti();
  playTvVictorySound();
  speakWinner(winner);
});

// ── Play again ──────────────────────────────────────────────────────────────
socket.on('play_again', () => {
  gameState = null;
  clearCountdown();
  boggleGridEl.innerHTML = '';
  playersStripEl.innerHTML = '';
  resultsBoardEl.innerHTML = '';
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
  socket.emit('tv_boggle_start');
});

playAgainBtn.addEventListener('click', () => {
  socket.emit('play_again');
});

// ── Phase switching ──────────────────────────────────────────────────────────
function switchPhase(newPhase) {
  phase = newPhase;
  lobbyPhase.classList.toggle('active', newPhase === 'lobby');
  playingPhase.classList.toggle('active', newPhase === 'playing');
  resultsPhase.classList.toggle('active', newPhase === 'results');
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

// ── Build 4x4 Boggle grid ───────────────────────────────────────────────────
function buildGrid(board) {
  boggleGridEl.innerHTML = '';
  if (!board || board.length === 0) return;

  for (let i = 0; i < 16; i++) {
    const cell = document.createElement('div');
    cell.className = 'tv-boggle-cell';
    cell.style.backgroundColor = CELL_COLORS[i % CELL_COLORS.length];
    cell.style.animationDelay = `${i * 0.05}s`;

    // Display 'Q' as 'Qu'
    const letter = board[i] || '';
    cell.textContent = letter.toUpperCase() === 'Q' ? 'Qu' : letter.toUpperCase();

    boggleGridEl.appendChild(cell);
  }
}

// ── Players strip (during game) ──────────────────────────────────────────────
function renderPlayersStrip(players) {
  playersStripEl.innerHTML = '';
  (players || []).forEach(p => {
    if (p.color === 'tv-host') return; // skip TV display itself
    const chip = document.createElement('div');
    chip.className = 'tv-player-chip';
    chip.dataset.playerId = p.id || p.seat || '';
    chip.dataset.playerName = p.name || '';
    chip.innerHTML = `<span class="tv-player-name">${escHtml(p.name)}</span> <span class="tv-player-count" data-count-for="${escHtml(p.name)}">0 words</span>`;
    playersStripEl.appendChild(chip);
  });
}

// ── Update word counts in player strip ───────────────────────────────────────
function updatePlayerCounts(counts) {
  if (!counts) return;

  // Handle array format: [{ name, count }, ...]
  if (Array.isArray(counts)) {
    counts.forEach(({ name, count }) => {
      const el = playersStripEl.querySelector(`[data-count-for="${escAttr(name)}"]`);
      if (el) el.textContent = `${count} word${count !== 1 ? 's' : ''}`;
    });
    return;
  }

  // Handle object format: { playerName: count, ... }
  for (const [name, count] of Object.entries(counts)) {
    const el = playersStripEl.querySelector(`[data-count-for="${escAttr(name)}"]`);
    if (el) el.textContent = `${count} word${count !== 1 ? 's' : ''}`;
  }
}

// ── Countdown timer (120 seconds) ────────────────────────────────────────────
const CIRCUMFERENCE = 2 * Math.PI * 45; // r=45 from SVG

function startCountdown() {
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

    // Color changes as time runs low
    if (remaining <= 10) {
      countdownCircle.style.stroke = '#e74c3c';
    } else if (remaining <= 30) {
      countdownCircle.style.stroke = '#ffd700';
    } else {
      countdownCircle.style.stroke = '#4ecca3';
    }

    if (remaining <= 0) {
      clearCountdown();
    }
  }, 1000);
}

function clearCountdown() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
}

// ── Results rendering ────────────────────────────────────────────────────────
function renderResults(state) {
  resultsBoardEl.innerHTML = '';

  // Engine returns seat-indexed arrays:
  //   state.scores = [5, 3, 7]
  //   state.words  = [[{word,score,unique}, ...], ...]
  //   state.players = [{name, seat, ...}, ...]
  const scoresArr = state.scores || [];
  const wordsArr  = state.words  || [];
  const players   = state.players || [];

  // Build ranked list by mapping seats to player names
  const ranked = players
    .map(p => ({
      name:  p.name,
      seat:  p.seat,
      score: (p.seat >= 0 && p.seat < scoresArr.length) ? scoresArr[p.seat] : 0,
      words: (p.seat >= 0 && p.seat < wordsArr.length)  ? wordsArr[p.seat]  : []
    }))
    .sort((a, b) => b.score - a.score);

  ranked.forEach((entry, i) => {
    const rank = i + 1;
    const div = document.createElement('div');
    div.className = `tv-results-player rank-${rank}`;

    // Header: rank + name + score
    const header = document.createElement('div');
    header.className = 'tv-results-player-header';

    const rankMedals = { 1: '🥇', 2: '🥈', 3: '🥉' };
    const rankEl = document.createElement('span');
    rankEl.className = 'tv-results-player-rank';
    rankEl.textContent = rankMedals[rank] || `#${rank}`;

    const nameEl = document.createElement('span');
    nameEl.className = 'tv-results-player-name';
    nameEl.textContent = escHtml(entry.name);

    const scoreEl = document.createElement('span');
    scoreEl.className = 'tv-results-player-score';
    scoreEl.textContent = `${entry.score} pts`;

    header.appendChild(rankEl);
    header.appendChild(nameEl);
    header.appendChild(scoreEl);
    div.appendChild(header);

    // Word list — engine returns [{word, score, unique}, ...]
    const wordsDiv = document.createElement('div');
    wordsDiv.className = 'tv-results-words';

    (entry.words || []).forEach(w => {
      const span = document.createElement('span');
      span.className = `tv-results-word ${w.unique ? 'unique' : 'duplicate'}`;
      span.textContent = w.word;
      wordsDiv.appendChild(span);
    });

    div.appendChild(wordsDiv);
    resultsBoardEl.appendChild(div);
  });
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
    const utterance = new SpeechSynthesisUtterance(`Word Master! Congratulations ${winnerName}!`);
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

function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
