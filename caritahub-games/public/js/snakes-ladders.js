'use strict';

// ── URL params ────────────────────────────────────────────────────────────────
const params  = new URLSearchParams(window.location.search);
const myRoom  = params.get('room');
const myColor = params.get('color');
const myName  = params.get('name') || 'You';

// ── Board constants (mirror of server engine) ─────────────────────────────────
const LADDERS = { 4:14, 9:31, 20:38, 28:84, 40:59, 51:67, 63:81, 71:91 };
const SNAKES  = { 17:7, 54:34, 62:19, 64:60, 87:24, 93:73, 95:75, 99:78 };

const LADDER_TOPS  = new Set(Object.values(LADDERS));
const SNAKE_TAILS  = new Set(Object.values(SNAKES));

// ── Player colours ────────────────────────────────────────────────────────────
const SL_COLORS = ['red', 'blue', 'green', 'purple', 'orange', 'cyan'];
const COLOR_HEX = {
  red:    '#e74c3c',
  blue:   '#3498db',
  green:  '#27ae60',
  purple: '#9b59b6',
  orange: '#e67e22',
  cyan:   '#16a085'
};
const mySeat = SL_COLORS.indexOf(myColor);

// ── DOM refs ──────────────────────────────────────────────────────────────────
const canvas        = document.getElementById('boardCanvas');
const ctx           = canvas.getContext('2d');
const statusBar     = document.getElementById('statusBar');
const rollBtn       = document.getElementById('rollBtn');
const diceDisplay   = document.getElementById('diceDisplay');
const playersPanel  = document.getElementById('playersPanel');
const gameOverlay   = document.getElementById('gameOverlay');
const gameOverTitle = document.getElementById('gameOverTitle');
const gameOverMsg   = document.getElementById('gameOverMsg');
const playAgainBtn  = document.getElementById('playAgainBtn');
const eventToast    = document.getElementById('eventToast');

let cellSize  = 0;
let gameState = null;
let diceAnim  = null;

// ── Socket ────────────────────────────────────────────────────────────────────
const socket = io();

socket.on('connect', () => {
  socket.emit('join_game', {
    roomId: myRoom,
    playerName: myName,
    reconnect: true,
    gameType: 'snakes-ladders'
  });
});

socket.on('game_started', (state) => {
  if (state.gameType !== 'snakes-ladders') return;
  gameState = state;
  applyState(state);
});

socket.on('game_state', (state) => {
  if (state.gameType !== 'snakes-ladders') return;
  gameState = state;
  stopDiceAnim();
  applyState(state);
});

socket.on('snakes_roll_result', ({ seat, dice, newPosition, snakeFrom, snakeTo, ladderFrom, ladderTo, stayed, playerName }) => {
  stopDiceAnim();
  showDiceFace(dice);
  showToast({ seat, dice, newPosition, snakeFrom, snakeTo, ladderFrom, ladderTo, stayed, playerName });
});

socket.on('game_over', ({ winner, reason }) => {
  const isWinner = winner === myColor;
  gameOverTitle.textContent = isWinner ? '🏆 You Win!' : 'Game Over';
  gameOverMsg.textContent   = reason || '';
  gameOverlay.classList.remove('hidden');
  if (isWinner) {
    launchConfetti();
    if ('vibrate' in navigator) navigator.vibrate([300, 100, 300, 100, 300]);
  }
});

socket.on('play_again', () => {
  gameOverlay.classList.add('hidden');
  gameState = null;
  drawEmptyBoard();
  statusBar.textContent = 'Waiting for game to start…';
  rollBtn.disabled = true;
});

socket.on('error', ({ message }) => {
  statusBar.textContent = message;
  rollBtn.disabled = gameState ? gameState.currentSeat !== mySeat : true;
});

// ── Roll ──────────────────────────────────────────────────────────────────────
rollBtn.addEventListener('click', () => {
  if (!gameState || gameState.currentSeat !== mySeat || gameState.isGameOver) return;
  rollBtn.disabled = true;
  startDiceAnim();
  socket.emit('snakes_roll');
  if ('vibrate' in navigator) navigator.vibrate(40);
});

playAgainBtn.addEventListener('click', () => {
  window.location.href = '/lobby.html?game=snakes-ladders';
});

// ── Apply state ───────────────────────────────────────────────────────────────
function applyState(state) {
  // Status
  if (state.isGameOver) {
    statusBar.textContent = 'Game over!';
  } else {
    const isMyTurn = state.currentSeat === mySeat;
    if (isMyTurn) {
      statusBar.textContent = 'Your turn — Roll the dice!';
    } else {
      const cur = state.players[state.currentSeat];
      statusBar.textContent = `${cur?.name || 'Opponent'}'s turn…`;
    }
  }

  // Roll button
  rollBtn.disabled = state.currentSeat !== mySeat || state.isGameOver;

  drawBoard(state);
  renderPlayers(state);
}

// ── Board rendering ───────────────────────────────────────────────────────────
function squareToPos(num) {
  if (num < 1 || num > 100) return null;
  const idx      = num - 1;
  const boardRow = Math.floor(idx / 10);
  const col      = boardRow % 2 === 0 ? idx % 10 : 9 - (idx % 10);
  const canvasRow = 9 - boardRow;
  return { x: col * cellSize + cellSize / 2, y: canvasRow * cellSize + cellSize / 2 };
}

function resizeCanvas() {
  const size   = canvas.parentElement.clientWidth;
  canvas.width  = size;
  canvas.height = size;
  cellSize = size / 10;
  if (gameState) drawBoard(gameState);
  else drawEmptyBoard();
}

function drawEmptyBoard() {
  drawGrid();
  drawSnakesAndLadders();
}

function drawBoard(state) {
  drawGrid();
  drawSnakesAndLadders();
  if (state) drawTokens(state);
}

function drawGrid() {
  const size = canvas.width;
  ctx.clearRect(0, 0, size, size);

  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 10; c++) {
      const boardRow = 9 - r;
      const sq = boardRow % 2 === 0
        ? boardRow * 10 + c + 1
        : boardRow * 10 + (10 - c);

      // Cell background
      let bg;
      if (LADDERS[sq] !== undefined)    bg = '#c8f0d4'; // ladder bottom
      else if (LADDER_TOPS.has(sq))     bg = '#a8e6bc'; // ladder top
      else if (SNAKES[sq] !== undefined) bg = '#f5c6c4'; // snake head
      else if (SNAKE_TAILS.has(sq))     bg = '#fadbd8'; // snake tail
      else bg = (r + c) % 2 === 0 ? '#fdf6e3' : '#f0e8cc';

      ctx.fillStyle = bg;
      ctx.fillRect(c * cellSize, r * cellSize, cellSize, cellSize);

      // Square number (small, top-centre)
      const fontSize = Math.max(7, cellSize * 0.19);
      ctx.fillStyle = '#555';
      ctx.font = `${fontSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(sq, c * cellSize + cellSize * 0.5, r * cellSize + 2);

      // Grid border
      ctx.strokeStyle = 'rgba(0,0,0,0.1)';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(c * cellSize, r * cellSize, cellSize, cellSize);
    }
  }

  // Square 100 marker
  const p100 = squareToPos(100);
  if (p100) {
    ctx.fillStyle = '#ffd700';
    ctx.font = `bold ${Math.max(8, cellSize * 0.2)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('★', p100.x, p100.y + cellSize * 0.18);
  }
}

function drawSnakesAndLadders() {
  ctx.lineCap = 'round';

  // ── Ladders ──────────────────────────────────────────────────────────
  for (const [fromStr, to] of Object.entries(LADDERS)) {
    const from = parseInt(fromStr);
    const p1   = squareToPos(from); // bottom
    const p2   = squareToPos(to);   // top
    if (!p1 || !p2) continue;

    const dx  = p2.x - p1.x;
    const dy  = p2.y - p1.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) continue;
    const nx = (-dy / len) * cellSize * 0.13;
    const ny = (dx  / len) * cellSize * 0.13;

    ctx.strokeStyle = '#27ae60';
    ctx.lineWidth   = Math.max(2, cellSize * 0.07);

    // Left rail
    ctx.beginPath();
    ctx.moveTo(p1.x + nx, p1.y + ny);
    ctx.lineTo(p2.x + nx, p2.y + ny);
    ctx.stroke();

    // Right rail
    ctx.beginPath();
    ctx.moveTo(p1.x - nx, p1.y - ny);
    ctx.lineTo(p2.x - nx, p2.y - ny);
    ctx.stroke();

    // Rungs
    const rungCount = Math.max(2, Math.floor(len / (cellSize * 0.9)));
    ctx.lineWidth = Math.max(1.5, cellSize * 0.05);
    for (let i = 1; i <= rungCount; i++) {
      const t  = i / (rungCount + 1);
      const rx = p1.x + dx * t;
      const ry = p1.y + dy * t;
      ctx.beginPath();
      ctx.moveTo(rx + nx, ry + ny);
      ctx.lineTo(rx - nx, ry - ny);
      ctx.stroke();
    }
  }

  // ── Snakes ────────────────────────────────────────────────────────────
  for (const [fromStr, to] of Object.entries(SNAKES)) {
    const from = parseInt(fromStr);
    const head = squareToPos(from); // head (high)
    const tail = squareToPos(to);   // tail (low)
    if (!head || !tail) continue;

    const dx = tail.x - head.x;
    const dy = tail.y - head.y;
    const wobble = cellSize * 1.1;

    ctx.strokeStyle = '#c0392b';
    ctx.lineWidth   = Math.max(3, cellSize * 0.11);
    ctx.lineCap     = 'round';

    ctx.beginPath();
    ctx.moveTo(head.x, head.y);
    ctx.bezierCurveTo(
      head.x + wobble,       head.y + wobble * 0.6,
      tail.x - wobble * 0.5, tail.y - wobble * 0.6,
      tail.x, tail.y
    );
    ctx.stroke();

    // Snake head dot
    ctx.fillStyle = '#e74c3c';
    ctx.beginPath();
    ctx.arc(head.x, head.y, Math.max(4, cellSize * 0.16), 0, Math.PI * 2);
    ctx.fill();

    // Snake eyes (tiny white dots)
    const eyeR  = Math.max(1.5, cellSize * 0.04);
    const angle = Math.atan2(dy, dx) + Math.PI; // direction from head to tail, then flip
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(head.x + Math.cos(angle + 0.5) * eyeR * 2.5, head.y + Math.sin(angle + 0.5) * eyeR * 2.5, eyeR, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(head.x + Math.cos(angle - 0.5) * eyeR * 2.5, head.y + Math.sin(angle - 0.5) * eyeR * 2.5, eyeR, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawTokens(state) {
  const r = Math.max(7, cellSize * 0.19);

  // Group by position
  const byPos = new Map();
  for (let seat = 0; seat < state.positions.length; seat++) {
    const pos = state.positions[seat];
    if (!byPos.has(pos)) byPos.set(pos, []);
    byPos.get(pos).push(seat);
  }

  for (const [pos, seats] of byPos.entries()) {
    let centres;

    if (pos === 0) {
      // Off-board: stack tokens in bottom-right corner
      centres = seats.map((_, i) => ({
        x: canvas.width - r - 3 - i * (r * 2 + 3),
        y: canvas.height - r - 3
      }));
    } else {
      const centre = squareToPos(pos);
      if (!centre) continue;

      if (seats.length === 1) {
        centres = [{ x: centre.x, y: centre.y + cellSize * 0.12 }];
      } else {
        // Arrange in a circle
        centres = seats.map((_, i) => {
          const angle = (2 * Math.PI / seats.length) * i - Math.PI / 2;
          const dist  = Math.min(r * 0.85, cellSize * 0.22);
          return {
            x: centre.x + Math.cos(angle) * dist,
            y: centre.y + cellSize * 0.12 + Math.sin(angle) * dist
          };
        });
      }
    }

    seats.forEach((seat, i) => {
      const { x, y } = centres[i];
      const hex      = COLOR_HEX[SL_COLORS[seat]] || '#888';

      ctx.save();
      ctx.shadowColor   = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur    = 5;
      ctx.shadowOffsetY = 2;

      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = hex;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth   = 2;
      ctx.stroke();
      ctx.restore();

      // Seat number label
      ctx.fillStyle    = '#fff';
      ctx.font         = `bold ${Math.max(7, r * 0.85)}px sans-serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(seat + 1, x, y);
    });
  }
}

// ── Players panel ─────────────────────────────────────────────────────────────
function renderPlayers(state) {
  playersPanel.innerHTML = '';
  state.players.forEach((p, i) => {
    const div      = document.createElement('div');
    div.className  = 'player-row' + (i === state.currentSeat && !state.isGameOver ? ' active' : '');

    const hex   = COLOR_HEX[p.color] || '#888';
    const isMe  = p.color === myColor;
    const pos   = state.positions[i];
    const posLabel = pos === 0 ? 'Start'
      : pos === 100 ? '🏆 100'
      : `Sq. ${pos}`;

    div.innerHTML = `
      <div class="player-token" style="background:${hex}">${i + 1}</div>
      <span class="player-name${isMe ? ' me' : ''}">${escHtml(p.name)}${isMe ? ' (You)' : ''}${!p.connected ? ' ⚡' : ''}</span>
      <span class="player-pos${pos === 100 ? ' winner' : ''}">${posLabel}</span>
    `;
    playersPanel.appendChild(div);
  });
}

// ── Dice animation ────────────────────────────────────────────────────────────
const DICE_FACES = ['⚀','⚁','⚂','⚃','⚄','⚅'];

function startDiceAnim() {
  diceAnim = setInterval(() => {
    diceDisplay.textContent = DICE_FACES[Math.floor(Math.random() * 6)];
  }, 80);
}

function stopDiceAnim() {
  if (diceAnim) { clearInterval(diceAnim); diceAnim = null; }
}

function showDiceFace(num) {
  if (num >= 1 && num <= 6) diceDisplay.textContent = DICE_FACES[num - 1];
}

// ── Toast notification ────────────────────────────────────────────────────────
let toastTimer = null;

function showToast({ seat, dice, newPosition, snakeFrom, snakeTo, ladderFrom, ladderTo, stayed, playerName }) {
  const name = seat === mySeat ? 'You' : (playerName || `Player ${seat + 1}`);
  let msg;

  if (ladderFrom) {
    msg = `${name} rolled ${dice} — Ladder! ↑ ${ladderFrom} → ${ladderTo}`;
  } else if (snakeFrom) {
    msg = `${name} rolled ${dice} — Snake! ↓ ${snakeFrom} → ${snakeTo}`;
  } else if (stayed) {
    msg = `${name} rolled ${dice} — Too high, stays at ${newPosition}`;
  } else if (newPosition === 100) {
    msg = `${name} rolled ${dice} and reached 100! 🏆`;
  } else {
    msg = `${name} rolled ${dice} — moved to ${newPosition}`;
  }

  eventToast.textContent = msg;
  eventToast.classList.remove('hidden', 'fade-out');

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => eventToast.classList.add('fade-out'), 3200);
  setTimeout(() => eventToast.classList.add('hidden'), 3800);
}

// ── Confetti ──────────────────────────────────────────────────────────────────
function launchConfetti() {
  const container = document.getElementById('confettiContainer');
  if (!container) return;
  container.classList.remove('hidden');
  container.innerHTML = '';
  const colors = ['#ffd700','#ff6b6b','#4ecca3','#3498db','#9b59b6','#ff9f43'];
  for (let i = 0; i < 80; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDelay    = `${Math.random() * 2}s`;
    piece.style.animationDuration = `${2.5 + Math.random() * 1.5}s`;
    if (Math.random() > 0.5) piece.style.borderRadius = '50%';
    const s = `${6 + Math.random() * 8}px`;
    piece.style.width = s; piece.style.height = s;
    container.appendChild(piece);
  }
  setTimeout(() => { container.classList.add('hidden'); container.innerHTML = ''; }, 5000);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Init ──────────────────────────────────────────────────────────────────────
new ResizeObserver(resizeCanvas).observe(canvas.parentElement);
resizeCanvas();
