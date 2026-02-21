'use strict';

// ── URL params ────────────────────────────────────────────────────────────────
const params  = new URLSearchParams(location.search);
const roomId  = params.get('room');
const myColor = params.get('color');   // 'p1' .. 'p6'
const myName  = decodeURIComponent(params.get('name') || '');

if (!roomId || !myColor) location.href = '/';

// ── Constants ─────────────────────────────────────────────────────────────────
const TRIVIA_COLORS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
const COLOR_NAMES   = { p1: 'Player 1', p2: 'Player 2', p3: 'Player 3', p4: 'Player 4', p5: 'Player 5', p6: 'Player 6' };
const COLOR_HEX     = { p1: '#1155cc', p2: '#c0392b', p3: '#1a6e1a', p4: '#7d3c98', p5: '#b7600a', p6: '#0e7490' };
const OPTION_LETTERS = ['A', 'B', 'C', 'D'];

const mySeat  = TRIVIA_COLORS.indexOf(myColor);
const isHost  = myColor === 'p1';

// ── State ─────────────────────────────────────────────────────────────────────
let gameState    = null;
let gameActive   = false;
let myAnswer     = null;   // index 0-3 that I submitted, or null
let timerInterval = null;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const statusBar        = document.getElementById('statusBar');
const waitingOverlay   = document.getElementById('waitingOverlay');
const waitingMsg       = document.getElementById('waitingMsg');
const gameUI           = document.getElementById('gameUI');
const triviaPlayers    = document.getElementById('triviaPlayers');
const triviaProgressFill = document.getElementById('triviaProgressFill');
const triviaQNum       = document.getElementById('triviaQNum');
const questionCard     = document.getElementById('questionCard');
const imageWrap        = document.getElementById('imageWrap');
const questionImg      = document.getElementById('questionImg');
const questionText     = document.getElementById('questionText');
const triviaTimer      = document.getElementById('triviaTimer');
const answeredCount    = document.getElementById('answeredCount');
const optionsGrid      = document.getElementById('optionsGrid');
const hostControls     = document.getElementById('hostControls');
const revealBtn        = document.getElementById('revealBtn');
const nextBtn          = document.getElementById('nextBtn');
const finishBtn        = document.getElementById('finishBtn');
const revealRow        = document.getElementById('revealRow');
const resultsOverlay   = document.getElementById('resultsOverlay');
const resultsTitle     = document.getElementById('resultsTitle');
const resultsBody      = document.getElementById('resultsBody');
const playAgainBtn     = document.getElementById('playAgainBtn');
const reconnectOverlay = document.getElementById('reconnectOverlay');

// ── Socket ────────────────────────────────────────────────────────────────────
const socket = io({ reconnectionAttempts: 5, reconnectionDelay: 1000, transports: ['websocket', 'polling'] });

socket.on('connect', () => {
  reconnectOverlay.classList.add('hidden');
  socket.emit('join_game', { roomId, playerName: myName, reconnect: true, gameType: 'singapore-trivia' });
});
socket.on('disconnect', () => reconnectOverlay.classList.remove('hidden'));
socket.on('connect_error', () => reconnectOverlay.classList.remove('hidden'));

socket.on('joined', ({ color }) => {
  statusBar.textContent = isHost ? 'You are the Host (Player 1)' : `You are ${COLOR_NAMES[color] || color}`;
});

socket.on('room_update', ({ players }) => {
  if (!gameActive) {
    waitingMsg.textContent = `Waiting for game to start… (${players.filter(p => p.connected).length} connected)`;
  }
});

socket.on('game_started', state => applyState(state));
socket.on('game_state',   state => applyState(state));

socket.on('game_over', ({ winner, reason }) => {
  gameActive = false;
  stopTimer();
  showResults(reason);
});

socket.on('play_again', () => {
  gameActive = false;
  gameState  = null;
  myAnswer   = null;
  stopTimer();
  resultsOverlay.classList.add('hidden');
  gameUI.classList.add('hidden');
  waitingOverlay.classList.remove('hidden');
  waitingMsg.textContent = 'Waiting for game to start…';
});

socket.on('error', ({ message }) => {
  statusBar.textContent = message;
});

// ── Apply state ───────────────────────────────────────────────────────────────
function applyState(state) {
  if (!state || state.gameType !== 'singapore-trivia') return;
  gameState = state;

  // Show game UI
  waitingOverlay.classList.add('hidden');
  gameUI.classList.remove('hidden');
  gameActive = !state.isGameOver;

  renderPlayers(state);
  updateProgress(state);

  if (state.phase === 'waiting') {
    renderWaiting(state);
  } else if (state.phase === 'question') {
    renderQuestion(state);
  } else if (state.phase === 'reveal') {
    renderReveal(state);
  } else if (state.phase === 'finished') {
    stopTimer();
    showResults();
  }
}

// ── Render: waiting between questions ────────────────────────────────────────
function renderWaiting(state) {
  stopTimer();
  questionText.textContent = isHost
    ? 'Click "Next Question" when everyone is ready.'
    : 'Waiting for host to start next question…';
  imageWrap.classList.add('hidden');
  optionsGrid.innerHTML = '';
  revealRow.classList.add('hidden');
  answeredCount.textContent = '';
  triviaTimer.textContent = '';

  // Host controls
  if (isHost) {
    hostControls.classList.remove('hidden');
    revealBtn.classList.add('hidden');
    nextBtn.classList.remove('hidden');
    finishBtn.classList.add('hidden');
  } else {
    hostControls.classList.add('hidden');
  }
}

// ── Render: active question ───────────────────────────────────────────────────
function renderQuestion(state) {
  const q = state.currentQuestion;
  if (!q) return;

  revealRow.classList.add('hidden');

  // Image
  if (q.imageUrl) {
    questionImg.src = q.imageUrl;
    imageWrap.classList.remove('hidden');
  } else {
    imageWrap.classList.add('hidden');
  }

  questionText.textContent = q.text;
  answeredCount.textContent = `${state.answeredCount} / ${state.playerCount} answered`;

  // Start client-side timer (server timeLeft as seed)
  startTimer(state.timeLeft);

  // Render options
  renderOptions(q.options, state.answers, null);

  // Host: show reveal button (can reveal early)
  if (isHost) {
    hostControls.classList.remove('hidden');
    revealBtn.classList.remove('hidden');
    nextBtn.classList.add('hidden');
    finishBtn.classList.add('hidden');
  } else {
    hostControls.classList.add('hidden');
  }
}

// ── Render: reveal phase ──────────────────────────────────────────────────────
function renderReveal(state) {
  stopTimer();
  triviaTimer.textContent = '';

  const q = state.currentQuestion; // correctIndex now visible
  if (!q) return;

  answeredCount.textContent = `${state.answeredCount} / ${state.playerCount} answered`;

  // Show options with correct/wrong highlighting
  renderOptions(q.options, state.answers, q.correctIndex);

  // Points gained row
  revealRow.classList.remove('hidden');
  revealRow.innerHTML = '';
  state.pointsGained.forEach((pts, seat) => {
    if (seat >= state.playerCount) return;
    const chip = document.createElement('div');
    chip.className = `trivia-reveal-chip${pts > 0 ? ' correct' : ''}`;
    chip.style.borderColor = COLOR_HEX[TRIVIA_COLORS[seat]] || '#ccc';
    chip.innerHTML = `
      <span class="trivia-reveal-dot" style="background:${COLOR_HEX[TRIVIA_COLORS[seat]]}"></span>
      <span>${escHtml(gameState.players?.[seat]?.name || COLOR_NAMES[TRIVIA_COLORS[seat]])}</span>
      <span class="trivia-reveal-pts">${pts > 0 ? `+${pts} pts` : '—'}</span>
    `;
    revealRow.appendChild(chip);
  });

  // Host controls
  if (isHost) {
    hostControls.classList.remove('hidden');
    revealBtn.classList.add('hidden');
    const isLast = state.questionIndex >= state.totalQuestions - 1;
    nextBtn.classList.toggle('hidden', isLast);
    finishBtn.classList.toggle('hidden', !isLast);
  } else {
    hostControls.classList.add('hidden');
  }
}

// ── Render options ─────────────────────────────────────────────────────────────
function renderOptions(options, answers, correctIndex) {
  optionsGrid.innerHTML = '';
  options.forEach((text, idx) => {
    const btn = document.createElement('button');
    btn.className = 'trivia-option-btn';

    // Determine state
    const iSelected = answers[mySeat] === idx;
    const isCorrect = correctIndex !== null && idx === correctIndex;
    const isWrong   = correctIndex !== null && iSelected && idx !== correctIndex;
    const isRevealed = correctIndex !== null;

    if (isCorrect)      btn.classList.add('trivia-option-correct');
    else if (isWrong)   btn.classList.add('trivia-option-wrong');
    else if (iSelected) btn.classList.add('trivia-option-selected');
    if (isRevealed)     btn.classList.add('trivia-option-revealed');

    btn.innerHTML = `<span class="trivia-option-letter">${OPTION_LETTERS[idx]}</span><span class="trivia-option-text">${escHtml(text)}</span>`;

    // Click to answer (only if not yet answered and question is active)
    if (!isRevealed && myAnswer === null) {
      btn.addEventListener('click', () => submitAnswer(idx));
    } else {
      btn.disabled = true;
    }

    // Show dots of who answered this option (during reveal)
    if (isRevealed && answers) {
      const dotsWrap = document.createElement('div');
      dotsWrap.className = 'trivia-option-dots';
      answers.forEach((ans, seat) => {
        if (ans === idx) {
          const dot = document.createElement('span');
          dot.className = 'trivia-option-dot';
          dot.style.background = COLOR_HEX[TRIVIA_COLORS[seat]] || '#ccc';
          dot.title = COLOR_NAMES[TRIVIA_COLORS[seat]];
          dotsWrap.appendChild(dot);
        }
      });
      btn.appendChild(dotsWrap);
    }

    optionsGrid.appendChild(btn);
  });
}

// ── Submit answer ─────────────────────────────────────────────────────────────
function submitAnswer(idx) {
  if (myAnswer !== null) return;
  if (!gameActive || gameState?.phase !== 'question') return;
  myAnswer = idx;
  socket.emit('trivia_answer', { answerIndex: idx });
  // Immediately lock the button visually
  const btns = optionsGrid.querySelectorAll('.trivia-option-btn');
  btns.forEach((btn, i) => {
    btn.disabled = true;
    if (i === idx) btn.classList.add('trivia-option-selected');
  });
}

// ── Player chips ──────────────────────────────────────────────────────────────
function renderPlayers(state) {
  triviaPlayers.innerHTML = '';
  (state.players || []).forEach((p, i) => {
    const chip = document.createElement('div');
    chip.className = `trivia-player-chip${p.color === myColor ? ' trivia-me' : ''}`;
    chip.style.borderColor = COLOR_HEX[p.color] || '#ccc';

    // Show if this player has answered (during question phase)
    const hasAnswered = state.answers && state.answers[i] !== null;
    const answeredClass = state.phase === 'question' && hasAnswered ? ' trivia-answered' : '';

    chip.innerHTML = `
      <span class="trivia-chip-dot${answeredClass}" style="background:${COLOR_HEX[p.color]}"></span>
      <span class="trivia-chip-name">${escHtml(p.name)}</span>
      <span class="trivia-chip-score">${state.scores[i] || 0}pt</span>
    `;
    triviaPlayers.appendChild(chip);
  });
}

// ── Progress bar ──────────────────────────────────────────────────────────────
function updateProgress(state) {
  const qi = Math.max(0, state.questionIndex);
  const pct = state.phase === 'finished' ? 100 : ((qi) / state.totalQuestions) * 100;
  triviaProgressFill.style.width = `${pct}%`;
  const display = state.questionIndex >= 0 ? state.questionIndex + 1 : '—';
  triviaQNum.textContent = `Q ${display} / ${state.totalQuestions}`;
}

// ── Timer ─────────────────────────────────────────────────────────────────────
let timerDeadline = 0;
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
  triviaTimer.textContent = `⏱ ${remaining}s`;
  triviaTimer.classList.toggle('trivia-timer-urgent', remaining <= 5);
  if (remaining === 0) stopTimer();
}

// ── Results ───────────────────────────────────────────────────────────────────
function showResults(reason) {
  if (!gameState) return;
  const scores  = gameState.scores;
  const players = gameState.players || [];

  // Sort by score desc
  const ranked = players.map((p, i) => ({ name: p.name, color: p.color, score: scores[i] || 0, seat: i }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0]?.score || 0;
  const isMe = ranked[0]?.seat === mySeat;

  resultsTitle.textContent = isMe ? '🏆 You Win!' : `🏆 ${escHtml(ranked[0]?.name || '?')} Wins!`;

  let html = '';
  if (reason) html += `<p class="trivia-result-reason">${escHtml(reason)}</p>`;
  ranked.forEach((p, rank) => {
    const medal = rank === 0 ? '🥇' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : `${rank + 1}.`;
    html += `<div class="trivia-result-row${p.score === best ? ' trivia-result-winner' : ''}">
      <span class="trivia-result-medal">${medal}</span>
      <span class="trivia-result-name" style="color:${COLOR_HEX[p.color]}">${escHtml(p.name)}</span>
      <span class="trivia-result-score">${p.score} pt${p.score !== 1 ? 's' : ''}</span>
    </div>`;
  });
  resultsBody.innerHTML = html;
  resultsOverlay.classList.remove('hidden');
}

// ── Host controls ─────────────────────────────────────────────────────────────
revealBtn.addEventListener('click', () => {
  revealBtn.disabled = true;
  socket.emit('trivia_reveal');
});

nextBtn.addEventListener('click', () => {
  nextBtn.disabled = true;
  socket.emit('trivia_next');
});

finishBtn.addEventListener('click', () => {
  finishBtn.disabled = true;
  socket.emit('trivia_finish');
});

playAgainBtn.addEventListener('click', () => {
  socket.emit('play_again');
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
