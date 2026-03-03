'use strict';

// ── URL params ───────────────────────────────────────────────────────────────
const params = new URLSearchParams(location.search);
const roomId = params.get('room');

// ── Session persistence key ─────────────────────────────────────────────────
const SESSION_KEY = roomId ? `tvBoggle_${roomId}` : null;

// ── State ────────────────────────────────────────────────────────────────────
let myColor = null;
let mySeat  = -1;
let myName  = '';
let myRoomId = roomId;
let gameState = null;
let myWords = [];          // accepted words
let roundSeconds = 120;    // default, overridden by server
let startTime = 0;
let timerInterval = null;
let currentScreen = 'join';

// ── Seat helper ─────────────────────────────────────────────────────────────
const TV_BOGGLE_COLORS = ['tv-host', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];

function seatForColor(color) {
  if (color === 'tv-host') return -1;
  const idx = TV_BOGGLE_COLORS.indexOf(color);
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
}

// ── DOM refs ─────────────────────────────────────────────────────────────────
const joinScreen       = document.getElementById('joinScreen');
const waitingScreen    = document.getElementById('waitingScreen');
const playingScreen    = document.getElementById('playingScreen');
const resultsScreen    = document.getElementById('resultsScreen');
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
const timerBarEl   = document.getElementById('timerBar');
const timerTextEl  = document.getElementById('timerText');
const wordInput    = document.getElementById('wordInput');
const submitBtn    = document.getElementById('submitBtn');
const rejectMsgEl  = document.getElementById('rejectMsg');
const wordCountEl  = document.getElementById('wordCount');
const wordsListEl  = document.getElementById('wordsList');

// Results
const resultsRankEl         = document.getElementById('resultsRank');
const resultsScoreEl        = document.getElementById('resultsScore');
const resultsWordsListEl    = document.getElementById('resultsWordsList');
const resultsOthersListEl   = document.getElementById('resultsOthersList');

// Game Over
const gameoverEmojiEl    = document.getElementById('gameoverEmoji');
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
      gameType: 'tv-boggle',
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
        roomId: roomId,
        playerName: myName,
        gameType: 'tv-boggle',
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
        roomId: roomId,
        playerName: myName,
        gameType: 'tv-boggle',
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
    gameType: 'tv-boggle'
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

  if (!reconnected) {
    waitingName.textContent = `You joined as ${myName}`;
    switchScreen('waiting');
  } else {
    waitingName.textContent = `Reconnecting as ${myName}...`;
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

  if (currentScreen === 'join' && myColor && myColor !== 'spectator') {
    waitingName.textContent = `You joined as ${myName}`;
    switchScreen('waiting');
  }
});

// ── Game started ─────────────────────────────────────────────────────────────
socket.on('game_started', (state) => {
  if (state.gameType !== 'tv-boggle') return;
  gameState = state;
  myWords = [];
  roundSeconds = state.roundSeconds || 120;
  startTime = Date.now();
  switchScreen('playing');
  startTimer();
  clearWordsList();
  updateWordCount();
  saveSession();
});

// ── Game state update ────────────────────────────────────────────────────────
socket.on('game_state', (state) => {
  if (state.gameType !== 'tv-boggle') return;
  gameState = state;

  // If scores exist (round ended), show results
  if (state.scores) {
    renderResults(state);
    if (currentScreen !== 'results' && currentScreen !== 'gameover') {
      switchScreen('results');
    }
    saveSession();
    return;
  }

  // Game is in progress — restore playing screen
  if (state.board) {
    // Restore accepted words if server provides them
    if (state.myWords && Array.isArray(state.myWords)) {
      myWords = state.myWords;
    }
    roundSeconds = state.roundSeconds || 120;

    // Calculate remaining time from server state
    if (state.startedAt) {
      const elapsed = Math.floor((Date.now() - state.startedAt) / 1000);
      const remaining = Math.max(0, roundSeconds - elapsed);
      startTime = Date.now() - (elapsed * 1000);
    } else {
      startTime = Date.now();
    }

    if (currentScreen !== 'playing' && currentScreen !== 'gameover') {
      switchScreen('playing');
    }

    startTimer();
    renderMyWords();
    updateWordCount();
  }

  saveSession();
});

// ── Word accepted ────────────────────────────────────────────────────────────
socket.on('boggle_accept', ({ word }) => {
  if (!myWords.includes(word.toLowerCase())) {
    myWords.push(word.toLowerCase());
  }
  renderMyWords();
  updateWordCount();
  rejectMsgEl.textContent = '';
  wordInput.focus();

  // Haptic feedback
  if ('vibrate' in navigator) navigator.vibrate(100);
});

// ── Word rejected ────────────────────────────────────────────────────────────
socket.on('boggle_reject', ({ word, reason }) => {
  // Flash input red
  wordInput.classList.add('reject-flash');
  setTimeout(() => { wordInput.classList.remove('reject-flash'); wordInput.focus(); }, 600);

  // Show rejection reason briefly
  rejectMsgEl.textContent = `"${escHtml(word)}" — ${escHtml(reason)}`;
  rejectMsgEl.style.opacity = '1';
  setTimeout(() => {
    rejectMsgEl.style.opacity = '0';
    setTimeout(() => { rejectMsgEl.textContent = ''; rejectMsgEl.style.opacity = '1'; }, 300);
  }, 2000);

  // Error vibration
  if ('vibrate' in navigator) navigator.vibrate([50, 50, 50]);
});

// ── Submission counts (optional) ─────────────────────────────────────────────
socket.on('boggle_counts', (data) => {
  // Could display how many words others have found
  // For now, no-op
});

// ── Game over ────────────────────────────────────────────────────────────────
socket.on('game_over', ({ winner, reason }) => {
  stopTimer();

  // Determine if I won — server sends winner as player name
  const iWon = winner && winner === myName;

  if (iWon) {
    gameoverEmojiEl.textContent = '\uD83C\uDFC6';
    gameoverTitleEl.textContent = 'You Won!';
    gameoverPersonalEl.textContent = 'Top Word Hunter!';
    if ('vibrate' in navigator) navigator.vibrate([300, 100, 300, 100, 300]);
    launchConfetti();
    playVictorySound();
  } else {
    gameoverEmojiEl.textContent = '\uD83C\uDF1F';
    gameoverTitleEl.textContent = 'Game Over';
    gameoverPersonalEl.textContent = '';
  }

  gameoverMsgEl.textContent = reason || (winner ? `Winner: ${winner}` : 'Thanks for playing!');
  switchScreen('gameover');
  saveSession();
});

// ── Play again ───────────────────────────────────────────────────────────────
socket.on('play_again', () => {
  gameState = null;
  myWords = [];
  stopTimer();
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
  resultsScreen.classList.toggle('active', name === 'results');
  gameoverScreen.classList.toggle('active', name === 'gameover');

  // Focus word input when switching to playing screen
  if (name === 'playing') {
    wordInput.focus();
  }
}

// ── Word submission ──────────────────────────────────────────────────────────
submitBtn.addEventListener('click', submitWord);
wordInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') submitWord();
});

function submitWord() {
  const word = wordInput.value.trim();
  if (!word) { wordInput.focus(); return; }
  socket.emit('boggle_submit', { word });
  wordInput.value = '';
  wordInput.focus(); // keep keyboard open
}

// ── Render accepted words ────────────────────────────────────────────────────
function renderMyWords() {
  wordsListEl.innerHTML = '';
  myWords.forEach(w => {
    const chip = document.createElement('span');
    chip.className = 'word-chip';
    chip.innerHTML = `<span class="check">&#10003;</span> ${escHtml(w.toUpperCase())}`;
    wordsListEl.appendChild(chip);
  });
}

function clearWordsList() {
  wordsListEl.innerHTML = '';
}

function updateWordCount() {
  wordCountEl.innerHTML = `<span>${myWords.length}</span> word${myWords.length !== 1 ? 's' : ''}`;
}

// ── Countdown timer ──────────────────────────────────────────────────────────
function startTimer() {
  stopTimer();
  updateTimerDisplay();
  timerInterval = setInterval(updateTimerDisplay, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function updateTimerDisplay() {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const remaining = Math.max(0, roundSeconds - elapsed);
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  timerTextEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;

  // Urgent styling when under 30 seconds
  if (remaining <= 30) {
    timerBarEl.classList.add('urgent');
  } else {
    timerBarEl.classList.remove('urgent');
  }

  // Timer has expired — stop (server handles round end)
  if (remaining <= 0) {
    stopTimer();
    timerTextEl.textContent = '0:00';
  }
}

// ── Render results screen ────────────────────────────────────────────────────
function renderResults(state) {
  // Engine returns seat-indexed arrays:
  //   state.scores = [5, 3, 7]    (indexed by seat)
  //   state.words  = [[{word,score,unique}, ...], ...]  (indexed by seat)
  //   state.players = [{name, seat, ...}, ...]
  const scoresArr = state.scores || [];
  const wordsArr  = state.words  || [];
  const players   = state.players || [];

  // Build enriched entries from seat-indexed data
  const entries = players.map(p => ({
    seat:  p.seat,
    name:  p.name,
    score: (p.seat >= 0 && p.seat < scoresArr.length) ? scoresArr[p.seat] : 0,
    words: (p.seat >= 0 && p.seat < wordsArr.length)  ? wordsArr[p.seat]  : []
  }));

  const sortedEntries = [...entries].sort((a, b) => b.score - a.score);

  // My entry
  const myEntry = entries.find(e => e.seat === mySeat);
  const myRank = sortedEntries.findIndex(e => e.seat === mySeat) + 1;

  // Rank
  if (myRank === 1) {
    resultsRankEl.textContent = '1st Place!';
  } else if (myRank === 2) {
    resultsRankEl.textContent = '2nd Place';
  } else if (myRank === 3) {
    resultsRankEl.textContent = '3rd Place';
  } else if (myRank > 0) {
    resultsRankEl.textContent = `${myRank}th Place`;
  } else {
    resultsRankEl.textContent = '';
  }

  // Score
  resultsScoreEl.textContent = myEntry ? myEntry.score : 0;

  // My words — engine returns [{word, score, unique}, ...]
  resultsWordsListEl.innerHTML = '';
  if (myEntry && myEntry.words) {
    myEntry.words.forEach(w => {
      const item = document.createElement('div');
      item.className = 'results-word-item';

      const textEl = document.createElement('span');
      textEl.className = w.unique ? 'results-word-text unique' : 'results-word-text duplicate';
      textEl.textContent = w.word.toUpperCase();

      const ptsEl = document.createElement('span');
      if (w.unique) {
        ptsEl.className = 'results-word-pts scored';
        ptsEl.textContent = `+${w.score || 0}`;
      } else {
        ptsEl.className = 'results-word-pts zero';
        ptsEl.textContent = 'dup';
      }

      item.appendChild(textEl);
      item.appendChild(ptsEl);
      resultsWordsListEl.appendChild(item);
    });
  }

  // Other players' scores
  resultsOthersListEl.innerHTML = '';
  sortedEntries.forEach(e => {
    if (e.seat === mySeat) return; // skip self
    const row = document.createElement('div');
    row.className = 'results-other-player';

    const nameEl = document.createElement('span');
    nameEl.className = 'results-other-name';
    nameEl.textContent = escHtml(e.name || `Player ${e.seat + 1}`);

    const scoreEl = document.createElement('span');
    scoreEl.className = 'results-other-score';
    scoreEl.textContent = e.score || 0;

    row.appendChild(nameEl);
    row.appendChild(scoreEl);
    resultsOthersListEl.appendChild(row);
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
