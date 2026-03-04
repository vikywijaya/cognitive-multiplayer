'use strict';

// ── URL params ────────────────────────────────────────────────────────
const params   = new URLSearchParams(window.location.search);
const myRoom   = params.get('room');
const myColor  = params.get('color');  // 'black' | 'white'
const myName   = params.get('name') || 'You';

// ── DOM refs ──────────────────────────────────────────────────────────
const canvas          = document.getElementById('boardCanvas');
const ctx             = canvas.getContext('2d');
const statusBar       = document.getElementById('statusBar');
const myNameEl        = document.getElementById('myName');
const opponentNameEl  = document.getElementById('opponentName');
const myCountEl       = document.getElementById('myCount');
const opponentCountEl = document.getElementById('opponentCount');
const myPanelEl       = document.getElementById('myPanel');
const opponentPanelEl = document.getElementById('opponentPanel');
const myDiscEl        = document.getElementById('myDisc');
const opponentDiscEl  = document.getElementById('opponentDisc');
const gameOverOverlay = document.getElementById('gameOverOverlay');
const gameOverTitle   = document.getElementById('gameOverTitle');
const gameOverMsg     = document.getElementById('gameOverMsg');
const playAgainBtn    = document.getElementById('playAgainBtn');
const resignBtn       = document.getElementById('resignBtn');

// My disc color in engine terms: 'B' for black, 'W' for white
const myEngineColor = myColor === 'black' ? 'B' : 'W';

// ── State ─────────────────────────────────────────────────────────────
let gameState = null;  // latest payload from server

// ── Socket ────────────────────────────────────────────────────────────
const socket = io();

socket.on('connect', () => {
  socket.emit('join_game', {
    roomId: myRoom,
    playerName: myName,
    reconnect: true,
    gameType: 'reversi'
  });
});

socket.on('game_started', (state) => { applyState(state); });
socket.on('game_state',   (state) => { applyState(state); });

socket.on('game_over', ({ winner, reason }) => {
  const isWinner = winner === myColor;
  const isDraw   = winner === null;
  gameOverTitle.textContent = isDraw ? "It's a Draw!" : isWinner ? 'You Win!' : 'You Lose';
  gameOverMsg.textContent   = reason || '';
  gameOverOverlay.classList.remove('hidden');
});

socket.on('invalid_move', ({ reason }) => {
  statusBar.textContent = `Invalid: ${reason}`;
});

socket.on('error', ({ message }) => {
  statusBar.textContent = message;
});

// ── Apply server state ────────────────────────────────────────────────
function applyState(state) {
  gameState = state;

  // Identify opponent
  const opponent = state.players.find(p => p.color !== myColor);
  const me       = state.players.find(p => p.color === myColor);

  if (opponent) opponentNameEl.textContent = opponent.name + (!opponent.connected ? ' (disconnected)' : '');
  myNameEl.textContent = me?.name || myName;

  // Style my disc icon based on my color
  if (myColor === 'black') {
    myDiscEl.classList.replace('disc-white', 'disc-black');
    opponentDiscEl.classList.replace('disc-black', 'disc-white');
  } else {
    myDiscEl.classList.replace('disc-black', 'disc-white');
    opponentDiscEl.classList.replace('disc-white', 'disc-black');
  }

  // Disc counts
  const myDiscCount  = myColor === 'black' ? state.discs.B : state.discs.W;
  const oppDiscCount = myColor === 'black' ? state.discs.W : state.discs.B;
  myCountEl.textContent       = myDiscCount;
  opponentCountEl.textContent = oppDiscCount;

  // Active panel highlight
  const myTurn = state.turn === myEngineColor && !state.isGameOver;
  myPanelEl.classList.toggle('panel-active', myTurn);
  opponentPanelEl.classList.toggle('panel-active', !myTurn && !state.isGameOver);

  // Status
  if (state.isGameOver) {
    statusBar.textContent = 'Game over!';
  } else if (state.skippedLast) {
    const skippedColor = state.turn === 'B' ? 'White' : 'Black';
    statusBar.textContent = `${skippedColor} has no valid moves — turn skipped`;
  } else {
    statusBar.textContent = myTurn ? 'Your turn — click to place a disc' : "Opponent's turn…";
  }

  drawBoard();
}

// ── Board rendering ───────────────────────────────────────────────────
function resizeCanvas() {
  const wrap = document.getElementById('boardWrap');
  const size = wrap.clientWidth;
  canvas.width  = size;
  canvas.height = size;
  if (gameState) drawBoard();
}

function drawBoard() {
  if (!gameState) return;
  const size = canvas.width;
  const cell = size / 8;
  const state = gameState;

  // Background
  ctx.fillStyle = '#2d6a4f';
  ctx.fillRect(0, 0, size, size);

  // Grid lines
  ctx.strokeStyle = '#1b4332';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 8; i++) {
    const px = i * cell;
    ctx.beginPath(); ctx.moveTo(px, 0);      ctx.lineTo(px, size);   ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0,  px);     ctx.lineTo(size, px);   ctx.stroke();
  }

  // Reference dots (standard Reversi board dots)
  const dotPositions = [[2,2],[2,6],[6,2],[6,6]];
  ctx.fillStyle = '#1b4332';
  for (const [dr, dc] of dotPositions) {
    ctx.beginPath();
    ctx.arc(dc * cell + cell / 2, dr * cell + cell / 2, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Valid move hints (only for current player on their turn)
  const isMyTurn = state.turn === myEngineColor && !state.isGameOver;
  if (isMyTurn && state.validMoves) {
    ctx.fillStyle = 'rgba(240, 192, 64, 0.3)';
    for (const [r, c] of state.validMoves) {
      ctx.fillRect(c * cell + 1, r * cell + 1, cell - 2, cell - 2);
    }
    // Dot in centre of valid move cells
    ctx.fillStyle = 'rgba(240, 192, 64, 0.7)';
    for (const [r, c] of state.validMoves) {
      const cx = c * cell + cell / 2;
      const cy = r * cell + cell / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, cell * 0.15, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Discs
  if (!state.board) return;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const disc = state.board[r][c];
      if (!disc) continue;

      const cx = c * cell + cell / 2;
      const cy = r * cell + cell / 2;
      const radius = cell * 0.42;

      // Shadow
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.4)';
      ctx.shadowBlur  = 6;
      ctx.shadowOffsetY = 3;

      // Disc face
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

      // Disc rim
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.strokeStyle = disc === 'B' ? '#333' : '#aaa';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
}

// ── Click / touch handling ────────────────────────────────────────────
canvas.addEventListener('click', (e) => {
  if (!gameState || gameState.isGameOver) return;
  if (gameState.turn !== myEngineColor) return;

  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width  / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = (e.clientX - rect.left)  * scaleX;
  const y = (e.clientY - rect.top)   * scaleY;

  const cell = canvas.width / 8;
  const col  = Math.floor(x / cell);
  const row  = Math.floor(y / cell);

  if (row < 0 || row > 7 || col < 0 || col > 7) return;

  socket.emit('reversi_move', { row, col });
});

// ── Resign ────────────────────────────────────────────────────────────
resignBtn.addEventListener('click', () => {
  if (confirm('Are you sure you want to resign?')) {
    socket.emit('resign');
  }
});

// ── Play again ────────────────────────────────────────────────────────
playAgainBtn.addEventListener('click', () => {
  window.location.href = `/lobby.html?game=reversi`;
});

// ── Resize observer ───────────────────────────────────────────────────
const ro = new ResizeObserver(resizeCanvas);
ro.observe(document.getElementById('boardWrap'));
resizeCanvas();
