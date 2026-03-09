'use strict';

const LADDERS = { 4:14, 9:31, 20:38, 28:84, 40:59, 51:67, 63:81, 71:91 };
const SNAKES  = { 17:7, 54:34, 62:19, 64:60, 87:24, 93:73, 95:75, 99:78 };
const LADDER_TOPS = new Set(Object.values(LADDERS));
const SNAKE_TAILS = new Set(Object.values(SNAKES));

const SL_COLORS = ['red', 'blue', 'green', 'purple', 'orange', 'cyan'];
const COLOR_HEX = {
  red: '#e74c3c', blue: '#3498db', green: '#27ae60',
  purple: '#9b59b6', orange: '#e67e22', cyan: '#16a085'
};
const COLOR_LIGHT = {
  red: '#f1948a', blue: '#85c1e9', green: '#82e0aa',
  purple: '#c39bd3', orange: '#f0b27a', cyan: '#76d7c4'
};
const COLOR_DARK = {
  red: '#c0392b', blue: '#2980b9', green: '#1e8449',
  purple: '#7d3c98', orange: '#d35400', cyan: '#0e6655'
};

const params  = new URLSearchParams(window.location.search);
const myRoom  = params.get('room');
const myColor = params.get('color');
const myName  = params.get('name') || 'You';
const mySeat  = SL_COLORS.indexOf(myColor);

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

let cellSize         = 0;
let gameState        = null;
let diceAnim         = null;
let pendingState     = null;
let isAnimating      = false;
let displayPositions = [];

// ── Web Audio Sound FX ───────────────────────────────────────────────────────
let audioCtx = null;
function getAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function beep(freq, type, dur, vol, offset = 0) {
  try {
    const ac  = getAudio();
    const osc = ac.createOscillator();
    const g   = ac.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const t = ac.currentTime + offset;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g); g.connect(ac.destination);
    osc.start(t); osc.stop(t + dur + 0.05);
  } catch (e) {}
}

function playDiceRoll() {
  try {
    const ac     = getAudio();
    const pitches = [520, 440, 600, 400, 580, 460, 640, 480];
    let   t      = ac.currentTime + 0.02;
    let   gap    = 0.13;

    for (let i = 0; i < 13; i++) {
      // Warm wooden "tick" — triangle wave
      const osc1 = ac.createOscillator(), env1 = ac.createGain();
      osc1.type = 'triangle';
      osc1.frequency.value = pitches[i % pitches.length] * (0.92 + Math.random() * 0.16);
      env1.gain.setValueAtTime(0.0001, t);
      env1.gain.linearRampToValueAtTime(0.22, t + 0.007);
      env1.gain.exponentialRampToValueAtTime(0.0001, t + 0.065);
      osc1.connect(env1); env1.connect(ac.destination);
      osc1.start(t); osc1.stop(t + 0.07);

      // Low "thud" on each hit — sine wave for body resonance
      const osc2 = ac.createOscillator(), env2 = ac.createGain();
      osc2.type = 'sine';
      osc2.frequency.value = 140 + Math.random() * 70;
      env2.gain.setValueAtTime(0.0001, t);
      env2.gain.linearRampToValueAtTime(0.14, t + 0.005);
      env2.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
      osc2.connect(env2); env2.connect(ac.destination);
      osc2.start(t); osc2.stop(t + 0.05);

      t   += gap;
      gap  = Math.max(0.042, gap * 0.86); // accelerate
    }
  } catch (e) {}
}

function playMove()   { beep(700, 'sine', 0.06, 0.12); }
function playLadder() { [350,500,650,850,1100].forEach((f, i) => beep(f, 'triangle', 0.15, 0.22, i * 0.1)); }
function playSnake()  { [800,600,440,320,220].forEach((f, i) => beep(f, 'sawtooth', 0.15, 0.18, i * 0.1)); }
function playStay()   { beep(180, 'sine', 0.3, 0.2); beep(160, 'sine', 0.25, 0.12, 0.12); }
function playWin()    { [523,659,784,1047,1319].forEach((f, i) => beep(f, 'triangle', 0.3, 0.3, i * 0.18)); }

// ── Socket ───────────────────────────────────────────────────────────────────
const socket = io();

socket.on('connect', () => {
  socket.emit('join_game', { roomId: myRoom, playerName: myName, reconnect: true, gameType: 'snakes-ladders' });
});

socket.on('game_started', (state) => {
  if (state.gameType !== 'snakes-ladders') return;
  gameState        = state;
  displayPositions = [...state.positions];
  pendingState     = null;
  isAnimating      = false;
  applyState(state);
});

socket.on('game_state', (state) => {
  if (state.gameType !== 'snakes-ladders') return;
  if (isAnimating) {
    pendingState = state;
  } else {
    gameState        = state;
    displayPositions = [...state.positions];
    stopDiceAnim();
    applyState(state);
  }
});

socket.on('snakes_roll_result', ({ seat, dice, newPosition, snakeFrom, snakeTo, ladderFrom, ladderTo, stayed, playerName }) => {
  stopDiceAnim();
  showDiceFace(dice);
  showToast({ seat, dice, newPosition, snakeFrom, snakeTo, ladderFrom, ladderTo, stayed, playerName });
  animateMove(seat, displayPositions[seat] ?? 0, newPosition, snakeFrom, snakeTo, ladderFrom, ladderTo, stayed);
});

socket.on('game_over', ({ winner, reason }) => {
  const isWinner = winner === myColor;
  gameOverTitle.textContent = isWinner ? '🏆 You Win!' : 'Game Over';
  gameOverMsg.textContent   = reason || '';
  gameOverlay.classList.remove('hidden');
  if (isWinner) { launchConfetti(); playWin(); if ('vibrate' in navigator) navigator.vibrate([300,100,300,100,300]); }
});

socket.on('play_again', () => {
  gameOverlay.classList.add('hidden');
  gameState        = null;
  displayPositions = [];
  drawEmpty();
  statusBar.textContent = 'Waiting for game to start…';
  statusBar.classList.remove('my-turn');
  rollBtn.disabled = true;
  rollBtn.classList.remove('pulse');
});

socket.on('error', ({ message }) => {
  statusBar.textContent = message;
  rollBtn.disabled = gameState ? (gameState.currentSeat !== mySeat || isAnimating) : true;
});

// ── Roll button ──────────────────────────────────────────────────────────────
rollBtn.addEventListener('click', () => {
  if (!gameState || gameState.currentSeat !== mySeat || gameState.isGameOver || isAnimating) return;
  rollBtn.disabled = true;
  rollBtn.classList.remove('pulse');
  startDiceAnim();
  playDiceRoll();
  socket.emit('snakes_roll');
  if ('vibrate' in navigator) navigator.vibrate(40);
});

playAgainBtn.addEventListener('click', () => { window.location.href = '/lobby.html?game=snakes-ladders'; });

// ── Animation ────────────────────────────────────────────────────────────────
function animateMove(seat, fromPos, finalPos, snakeFrom, snakeTo, ladderFrom, ladderTo, stayed) {
  isAnimating = true;

  if (stayed) {
    playStay();
    // Brief shake via position jitter
    let n = 0;
    const orig = displayPositions[seat];
    const iv = setInterval(() => {
      n++;
      drawBoardDisplay();
      if (n >= 6) { clearInterval(iv); displayPositions[seat] = orig; finishAnimation(); }
    }, 80);
    return;
  }

  // Intermediate square: where dice lands before snake/ladder
  const intermediateLand = ladderFrom ?? snakeFrom ?? finalPos;

  const steps = [];
  for (let s = fromPos + 1; s <= intermediateLand; s++) steps.push(s);

  if (steps.length === 0) { finishAnimation(); return; }

  let idx = 0;
  const STEP_MS = 55;

  function tick() {
    displayPositions[seat] = steps[idx];
    drawBoardDisplay();
    playMove();
    idx++;

    if (idx >= steps.length) {
      // Arrived at intermediate; handle snake/ladder
      if (ladderFrom) {
        setTimeout(() => {
          playLadder();
          displayPositions[seat] = ladderTo;
          drawBoardDisplay();
          setTimeout(finishAnimation, 320);
        }, 360);
      } else if (snakeFrom) {
        setTimeout(() => {
          playSnake();
          displayPositions[seat] = snakeTo;
          drawBoardDisplay();
          setTimeout(finishAnimation, 320);
        }, 360);
      } else {
        setTimeout(finishAnimation, 200);
      }
      return;
    }
    setTimeout(tick, STEP_MS);
  }
  tick();
}

function finishAnimation() {
  isAnimating = false;
  if (pendingState) {
    const s  = pendingState;
    pendingState = null;
    gameState        = s;
    displayPositions = [...s.positions];
    stopDiceAnim();
    applyState(s);
  } else if (gameState && gameState.currentSeat === mySeat && !gameState.isGameOver) {
    rollBtn.disabled = false;
    rollBtn.classList.add('pulse');
  }
}

// ── Apply state ──────────────────────────────────────────────────────────────
function applyState(state) {
  const myTurn = state.currentSeat === mySeat && !state.isGameOver;
  if (state.isGameOver) {
    statusBar.textContent = 'Game over!';
    statusBar.classList.remove('my-turn');
  } else if (myTurn) {
    statusBar.textContent = '🎲 Your turn — Roll the dice!';
    statusBar.classList.add('my-turn');
  } else {
    const cur = state.players[state.currentSeat];
    statusBar.textContent = `${cur?.name || 'Opponent'}'s turn…`;
    statusBar.classList.remove('my-turn');
  }
  rollBtn.disabled = !myTurn || isAnimating;
  rollBtn.classList.toggle('pulse', myTurn && !isAnimating);
  drawBoard(state);
  renderPlayers(state);
}

// ── Canvas sizing ────────────────────────────────────────────────────────────
// Board = 10×10 grid. Below it: a "Start" strip of height 0.65 × cellSize
const START_STRIP = 0.65;

function squareToPos(num) {
  if (num < 1 || num > 100) return null;
  const idx      = num - 1;
  const boardRow = Math.floor(idx / 10);
  const col      = boardRow % 2 === 0 ? idx % 10 : 9 - (idx % 10);
  return { x: col * cellSize + cellSize / 2, y: (9 - boardRow) * cellSize + cellSize / 2 };
}

function resizeCanvas() {
  const w      = canvas.parentElement.clientWidth;
  canvas.width  = w;
  canvas.height = w + (w / 10) * START_STRIP;
  cellSize      = w / 10;
  if (gameState) drawBoardDisplay();
  else drawEmpty();
}

// ── Draw helpers ─────────────────────────────────────────────────────────────
function drawEmpty() {
  drawGrid();
  drawSnakesAndLadders();
  drawStartArea([]);
}

function drawBoardDisplay() {
  drawGrid();
  drawSnakesAndLadders();
  drawTokens(displayPositions, displayPositions.length);
  drawStartArea(displayPositions);
}

function drawBoard(state) {
  drawGrid();
  drawSnakesAndLadders();
  drawTokens(state.positions, state.playerCount);
  drawStartArea(state.positions);
}

// ── Grid ─────────────────────────────────────────────────────────────────────
function drawGrid() {
  const w = canvas.width;
  const boardH = 10 * cellSize;
  ctx.clearRect(0, 0, w, canvas.height);

  // Board background gradient
  const bg = ctx.createLinearGradient(0, 0, w, boardH);
  bg.addColorStop(0, '#fffdf0');
  bg.addColorStop(1, '#fdf5cc');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, boardH);

  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 10; c++) {
      const boardRow = 9 - r;
      const sq = boardRow % 2 === 0 ? boardRow * 10 + c + 1 : boardRow * 10 + (10 - c);

      const fill = (r + c) % 2 === 0 ? '#fffdf0' : '#f5e8be';

      ctx.fillStyle = fill;
      ctx.fillRect(c * cellSize, r * cellSize, cellSize, cellSize);

      // Square number
      ctx.fillStyle = '#7a6030';
      ctx.font = `600 ${Math.max(7, cellSize * 0.18)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(sq, c * cellSize + cellSize * 0.5, r * cellSize + 2);

      // Grid lines
      ctx.strokeStyle = 'rgba(0,0,0,0.07)';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(c * cellSize, r * cellSize, cellSize, cellSize);
    }
  }

  // Gold star at square 100
  const p100 = squareToPos(100);
  if (p100) {
    ctx.fillStyle = '#e6a800';
    ctx.font = `bold ${Math.max(9, cellSize * 0.24)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('★', p100.x, p100.y + cellSize * 0.15);
  }

  // Board border
  ctx.strokeStyle = '#c8a830';
  ctx.lineWidth = 2.5;
  ctx.strokeRect(1.5, 1.5, w - 3, boardH - 3);
}

// ── Start strip ──────────────────────────────────────────────────────────────
function drawStartArea(positions) {
  const w      = canvas.width;
  const boardH = 10 * cellSize;
  const stripH = START_STRIP * cellSize;

  // Dark background
  const g = ctx.createLinearGradient(0, boardH, 0, boardH + stripH);
  g.addColorStop(0, '#0d1b2e');
  g.addColorStop(1, '#162338');
  ctx.fillStyle = g;
  ctx.fillRect(0, boardH, w, stripH);

  // Separator line
  ctx.strokeStyle = '#c8a830';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, boardH); ctx.lineTo(w, boardH);
  ctx.stroke();

  // "START" label
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.font = `bold ${Math.max(8, cellSize * 0.2)}px sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('START', 10, boardH + stripH * 0.5);

  // Off-board tokens
  const r        = Math.max(8, cellSize * 0.24);
  const offSeats = [];
  if (Array.isArray(positions)) {
    positions.forEach((p, i) => { if (p === 0) offSeats.push(i); });
  }
  const startX = w * 0.40;
  offSeats.forEach((seat, idx) => {
    drawTokenAt(startX + idx * (r * 2.5), boardH + stripH * 0.5, r, seat);
  });
}

// ── Cubic bezier helper ───────────────────────────────────────────────────────
function bezierPoint(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  return mt*mt*mt*p0 + 3*mt*mt*t*p1 + 3*mt*t*t*p2 + t*t*t*p3;
}

// ── Snakes & Ladders graphics ─────────────────────────────────────────────────
function drawSnakesAndLadders() {
  ctx.lineCap  = 'round';
  ctx.lineJoin = 'round';

  // ── LADDERS ────────────────────────────────────────────────────────────────
  for (const [fromStr, to] of Object.entries(LADDERS)) {
    const p1 = squareToPos(+fromStr), p2 = squareToPos(to);
    if (!p1 || !p2) continue;
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const len = Math.sqrt(dx*dx + dy*dy);
    if (!len) continue;

    const ux = dx/len, uy = dy/len;   // unit along ladder
    const nx = -uy, ny = ux;          // unit perpendicular
    const railOffset = cellSize * 0.11;
    const railW = Math.max(3, cellSize * 0.09);
    const rungW = Math.max(2, cellSize * 0.065);

    // Draw one wood-grain rail
    const drawRail = (ax, ay, bx, by) => {
      const midX = (ax+bx)/2, midY = (ay+by)/2;
      const g = ctx.createLinearGradient(
        midX - nx*railW*0.7, midY - ny*railW*0.7,
        midX + nx*railW*0.7, midY + ny*railW*0.7
      );
      g.addColorStop(0,    '#5D2E0C');
      g.addColorStop(0.30, '#A0522D');
      g.addColorStop(0.55, '#D2691E');
      g.addColorStop(0.75, '#F4A460');
      g.addColorStop(1,    '#8B4513');
      ctx.save();
      ctx.shadowColor   = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur    = 5;
      ctx.shadowOffsetX = 1.5;
      ctx.shadowOffsetY = 2;
      ctx.strokeStyle = g;
      ctx.lineWidth   = railW;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.restore();
    };

    drawRail(p1.x+nx*railOffset, p1.y+ny*railOffset, p2.x+nx*railOffset, p2.y+ny*railOffset);
    drawRail(p1.x-nx*railOffset, p1.y-ny*railOffset, p2.x-nx*railOffset, p2.y-ny*railOffset);

    // Rungs with alternating shades and a highlight stripe
    const rungs = Math.max(2, Math.floor(len / (cellSize * 0.85)));
    for (let i = 0; i <= rungs; i++) {
      const t  = i / rungs;
      const cx = p1.x + dx*t, cy = p1.y + dy*t;
      const r1x = cx + nx*(railOffset + railW*0.3), r1y = cy + ny*(railOffset + railW*0.3);
      const r2x = cx - nx*(railOffset + railW*0.3), r2y = cy - ny*(railOffset + railW*0.3);

      ctx.save();
      ctx.shadowColor   = 'rgba(0,0,0,0.28)';
      ctx.shadowBlur    = 3;
      ctx.shadowOffsetY = 1.5;
      ctx.strokeStyle = i%2===0 ? '#CD853F' : '#DEB887';
      ctx.lineWidth   = rungW;
      ctx.beginPath(); ctx.moveTo(r1x, r1y); ctx.lineTo(r2x, r2y); ctx.stroke();
      // Highlight
      ctx.shadowBlur  = 0;
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth   = rungW * 0.4;
      ctx.beginPath();
      ctx.moveTo(r1x - ux, r1y - uy);
      ctx.lineTo(r2x - ux, r2y - uy);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ── SNAKES ────────────────────────────────────────────────────────────────
  const SNAKE_PALETTES = [
    { body:'#27ae60', dark:'#1a6637', light:'#58d68d', pat:'#0e4620' },
    { body:'#8e44ad', dark:'#5b2c6f', light:'#bb8fce', pat:'#4a235a' },
    { body:'#d35400', dark:'#873600', light:'#f0b27a', pat:'#6e2c00' },
    { body:'#cb4335', dark:'#7b241c', light:'#f1948a', pat:'#641e16' },
    { body:'#117a65', dark:'#0e6655', light:'#48c9b0', pat:'#0b5345' },
    { body:'#2471a3', dark:'#154360', light:'#5dade2', pat:'#0e3460' },
    { body:'#d4ac0d', dark:'#9a7d0a', light:'#f7dc6f', pat:'#7d6608' },
    { body:'#2c3e50', dark:'#1c2833', light:'#566573', pat:'#17202a' },
  ];

  let si = 0;
  for (const [fromStr, to] of Object.entries(SNAKES)) {
    const head = squareToPos(+fromStr), tail = squareToPos(to);
    if (!head || !tail) continue;

    const pal = SNAKE_PALETTES[si++ % SNAKE_PALETTES.length];
    const dx = tail.x - head.x, dy = tail.y - head.y;
    const len = Math.sqrt(dx*dx + dy*dy);
    const ux = dx/len, uy = dy/len;
    const bodyW = Math.max(5, cellSize * 0.14);

    // S-curve control points
    const midX = head.x + dx*0.5, midY = head.y + dy*0.5;
    const perp  = cellSize * 0.9;
    const cp1x = midX - uy*perp,        cp1y = midY + ux*perp;
    const cp2x = midX + uy*perp*0.6,    cp2y = midY - ux*perp*0.6;

    // 1. Drop shadow / dark outline
    ctx.save();
    ctx.shadowColor   = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur    = 8;
    ctx.shadowOffsetY = 3;
    ctx.strokeStyle = pal.dark;
    ctx.lineWidth   = bodyW + Math.max(2.5, cellSize*0.05);
    ctx.beginPath();
    ctx.moveTo(head.x, head.y);
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, tail.x, tail.y);
    ctx.stroke();
    ctx.restore();

    // 2. Main body with gradient
    const bodyGrad = ctx.createLinearGradient(head.x, head.y, tail.x, tail.y);
    bodyGrad.addColorStop(0,    pal.dark);
    bodyGrad.addColorStop(0.4,  pal.body);
    bodyGrad.addColorStop(1,    pal.light);
    ctx.strokeStyle = bodyGrad;
    ctx.lineWidth   = bodyW;
    ctx.beginPath();
    ctx.moveTo(head.x, head.y);
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, tail.x, tail.y);
    ctx.stroke();

    // 3. Sheen stripe
    const sheenGrad = ctx.createLinearGradient(head.x, head.y, tail.x, tail.y);
    sheenGrad.addColorStop(0,   'rgba(255,255,255,0.28)');
    sheenGrad.addColorStop(0.5, 'rgba(255,255,255,0.07)');
    sheenGrad.addColorStop(1,   'rgba(255,255,255,0.0)');
    ctx.strokeStyle = sheenGrad;
    ctx.lineWidth   = bodyW * 0.38;
    ctx.beginPath();
    ctx.moveTo(head.x, head.y);
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, tail.x, tail.y);
    ctx.stroke();

    // 4. Scale dots along body
    const numScales = Math.max(4, Math.floor(len / (cellSize * 0.5)));
    for (let i = 1; i < numScales; i++) {
      const t  = i / numScales;
      const bx = bezierPoint(head.x, cp1x, cp2x, tail.x, t);
      const by = bezierPoint(head.y, cp1y, cp2y, tail.y, t);
      ctx.fillStyle = i%2===0 ? pal.pat : 'rgba(255,255,255,0.15)';
      ctx.beginPath();
      ctx.arc(bx, by, Math.max(1.5, cellSize*0.025), 0, Math.PI*2);
      ctx.fill();
    }

    // 5. Head — elongated oval facing away from body
    const headAngle = Math.atan2(cp1y - head.y, cp1x - head.x) + Math.PI;
    const headR     = Math.max(6, cellSize * 0.185);

    ctx.save();
    ctx.translate(head.x, head.y);
    ctx.rotate(headAngle);

    ctx.shadowColor   = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur    = 6;
    ctx.shadowOffsetY = 2;

    const hg = ctx.createRadialGradient(-headR*0.25, -headR*0.25, headR*0.1, 0, 0, headR*1.4);
    hg.addColorStop(0,    pal.light);
    hg.addColorStop(0.55, pal.body);
    hg.addColorStop(1,    pal.dark);
    ctx.beginPath();
    ctx.ellipse(0, 0, headR*1.35, headR*0.95, 0, 0, Math.PI*2);
    ctx.fillStyle = hg;
    ctx.fill();
    ctx.shadowBlur  = 0;
    ctx.strokeStyle = pal.dark;
    ctx.lineWidth   = Math.max(1, cellSize*0.025);
    ctx.stroke();

    // Nostrils
    const nostrilR = Math.max(1, cellSize*0.018);
    ctx.fillStyle  = pal.dark;
    [0.45, -0.45].forEach(s => {
      ctx.beginPath();
      ctx.arc(headR*1.1, s*headR*0.55, nostrilR, 0, Math.PI*2);
      ctx.fill();
    });

    // Eyes with vertical-slit pupils
    const eyeR   = Math.max(2.2, cellSize*0.05);
    const eyeFwd = headR*0.62, eyeSide = headR*0.65;
    [1, -1].forEach(side => {
      ctx.fillStyle = '#fffde7';
      ctx.beginPath();
      ctx.arc(eyeFwd, side*eyeSide, eyeR, 0, Math.PI*2);
      ctx.fill();
      // Vertical slit pupil
      ctx.save();
      ctx.translate(eyeFwd, side*eyeSide);
      ctx.scale(0.42, 1);
      ctx.fillStyle = '#0d0d0d';
      ctx.beginPath();
      ctx.arc(0, 0, eyeR*0.78, 0, Math.PI*2);
      ctx.fill();
      ctx.restore();
      // Eye shine
      ctx.fillStyle = 'rgba(255,255,255,0.72)';
      ctx.beginPath();
      ctx.arc(eyeFwd - eyeR*0.1, side*eyeSide - eyeR*0.3, eyeR*0.28, 0, Math.PI*2);
      ctx.fill();
    });

    // Forked tongue
    const ts = headR*1.35, tl = headR*0.95, fl = headR*0.52, fa = 0.42;
    ctx.strokeStyle = '#e74c3c';
    ctx.lineWidth   = Math.max(1, cellSize*0.022);
    ctx.beginPath(); ctx.moveTo(ts, 0); ctx.lineTo(ts+tl, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ts+tl, 0);
    ctx.lineTo(ts+tl + fl*Math.cos(fa), -fl*Math.sin(fa)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ts+tl, 0);
    ctx.lineTo(ts+tl + fl*Math.cos(fa),  fl*Math.sin(fa)); ctx.stroke();

    ctx.restore();
  }
}

// ── Token drawing ─────────────────────────────────────────────────────────────
function drawTokenAt(x, y, r, seat) {
  const hex   = COLOR_HEX[SL_COLORS[seat]]   || '#888';
  const light = COLOR_LIGHT[SL_COLORS[seat]]  || '#bbb';
  const dark  = COLOR_DARK[SL_COLORS[seat]]   || '#555';

  ctx.save();
  ctx.shadowColor   = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur    = 7;
  ctx.shadowOffsetY = 3;

  const grad = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.05, x, y, r);
  grad.addColorStop(0,   light);
  grad.addColorStop(0.55, hex);
  grad.addColorStop(1,   dark);

  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = '#fff';
  ctx.font = `bold ${Math.max(7, r * 0.9)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(seat + 1, x, y);
}

function drawTokens(positions, playerCount) {
  const r     = Math.max(7, cellSize * 0.19);
  const byPos = new Map();
  const count = playerCount || positions.length;
  for (let seat = 0; seat < count; seat++) {
    const pos = positions[seat];
    if (pos === 0) continue; // drawn in start strip
    if (!byPos.has(pos)) byPos.set(pos, []);
    byPos.get(pos).push(seat);
  }
  for (const [pos, seats] of byPos) {
    const centre = squareToPos(pos);
    if (!centre) continue;
    let centres;
    if (seats.length === 1) {
      centres = [{ x: centre.x, y: centre.y + cellSize * 0.1 }];
    } else {
      centres = seats.map((_, i) => {
        const angle = (2 * Math.PI / seats.length) * i - Math.PI / 2;
        const dist  = Math.min(r * 0.85, cellSize * 0.22);
        return { x: centre.x + Math.cos(angle) * dist, y: centre.y + cellSize * 0.1 + Math.sin(angle) * dist };
      });
    }
    seats.forEach((seat, i) => drawTokenAt(centres[i].x, centres[i].y, r, seat));
  }
}

// ── Players panel ─────────────────────────────────────────────────────────────
function renderPlayers(state) {
  playersPanel.innerHTML = '';
  state.players.forEach((p, i) => {
    const div = document.createElement('div');
    div.className = 'player-row' + (i === state.currentSeat && !state.isGameOver ? ' active' : '');
    const hex   = COLOR_HEX[p.color] || '#888';
    const isMe  = p.color === myColor;
    const pos   = state.positions[i];
    const label = pos === 0 ? 'Start' : pos === 100 ? '🏆 100' : `Sq. ${pos}`;
    div.innerHTML = `
      <div class="player-token" style="background:${hex}">${i + 1}</div>
      <span class="player-name${isMe ? ' me' : ''}">${escHtml(p.name)}${isMe ? ' (You)' : ''}${!p.connected ? ' ⚡' : ''}</span>
      <span class="player-pos${pos === 100 ? ' winner' : ''}">${label}</span>
    `;
    playersPanel.appendChild(div);
  });
}

// ── Dice SVG rendering ───────────────────────────────────────────────────────
// pip [col, row]: col/row ∈ {0=left/top, 1=center, 2=right/bottom}
const PIP_COORDS = {
  1: [[1,1]],
  2: [[0,0],[2,2]],
  3: [[0,0],[1,1],[2,2]],
  4: [[0,0],[2,0],[0,2],[2,2]],
  5: [[0,0],[2,0],[1,1],[0,2],[2,2]],
  6: [[0,0],[2,0],[0,1],[2,1],[0,2],[2,2]]
};
const PIP_X = [22, 50, 78]; // x centres for cols 0,1,2
const PIP_Y = [22, 50, 78]; // y centres for rows 0,1,2

function diceSVG(n) {
  const pips = PIP_COORDS[n] || PIP_COORDS[1];
  const dots = pips.map(([c, r]) =>
    `<circle cx="${PIP_X[c]}" cy="${PIP_Y[r]}" r="9" fill="#1a1a2e"/>`
  ).join('');
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">${dots}</svg>`;
}

// ── Dice animation ────────────────────────────────────────────────────────────
function startDiceAnim() {
  diceDisplay.classList.remove('landing');
  diceDisplay.classList.add('rolling');
  // Start slow, ramp up to fast
  let delay = 160;
  function spin() {
    if (!diceAnim) return;
    diceDisplay.innerHTML = diceSVG(Math.ceil(Math.random() * 6));
    delay = Math.max(45, delay * 0.88);
    diceAnim = setTimeout(spin, delay);
  }
  diceAnim = setTimeout(spin, delay);
}

function stopDiceAnim() {
  if (diceAnim) { clearTimeout(diceAnim); diceAnim = null; }
  diceDisplay.classList.remove('rolling');
}

function showDiceFace(n) {
  if (n < 1 || n > 6) return;
  diceDisplay.classList.remove('rolling', 'landing');
  void diceDisplay.offsetWidth; // force reflow to restart animation
  diceDisplay.innerHTML = diceSVG(n);
  diceDisplay.classList.add('landing');
  // Flash the controls strip
  const ctrl = document.getElementById('controls');
  ctrl.classList.remove('dice-flash');
  void ctrl.offsetWidth;
  ctrl.classList.add('dice-flash');
  setTimeout(() => ctrl.classList.remove('dice-flash'), 500);
}

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimer = null;
function showToast({ seat, dice, newPosition, snakeFrom, snakeTo, ladderFrom, ladderTo, stayed, playerName }) {
  const name = seat === mySeat ? 'You' : (playerName || `P${seat + 1}`);
  let msg;
  if      (ladderFrom)          msg = `${name} rolled ${dice} 🪜 Ladder! ${ladderFrom} → ${ladderTo}`;
  else if (snakeFrom)           msg = `${name} rolled ${dice} 🐍 Snake! ${snakeFrom} → ${snakeTo}`;
  else if (stayed)              msg = `${name} rolled ${dice} — too high, stays at ${newPosition}`;
  else if (newPosition === 100) msg = `${name} rolled ${dice} 🏆 Reached 100!`;
  else                          msg = `${name} rolled ${dice} → square ${newPosition}`;
  eventToast.textContent = msg;
  eventToast.classList.remove('hidden', 'fade-out');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => eventToast.classList.add('fade-out'), 3200);
  setTimeout(() => eventToast.classList.add('hidden'), 3800);
}

// ── Confetti ──────────────────────────────────────────────────────────────────
function launchConfetti() {
  const el = document.getElementById('confettiContainer');
  if (!el) return;
  el.classList.remove('hidden');
  el.innerHTML = '';
  const cols = ['#ffd700', '#ff6b6b', '#4ecca3', '#3498db', '#9b59b6', '#ff9f43'];
  for (let i = 0; i < 80; i++) {
    const p = document.createElement('div');
    p.className = 'confetti-piece';
    p.style.cssText = `left:${Math.random() * 100}%;background:${cols[i % cols.length]};animation-delay:${Math.random() * 2}s;animation-duration:${2.5 + Math.random() * 1.5}s;`;
    if (Math.random() > 0.5) p.style.borderRadius = '50%';
    const s = `${6 + Math.random() * 8}px`;
    p.style.width = s; p.style.height = s;
    el.appendChild(p);
  }
  setTimeout(() => { el.classList.add('hidden'); el.innerHTML = ''; }, 5000);
}

function escHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// ── Init ──────────────────────────────────────────────────────────────────────
new ResizeObserver(resizeCanvas).observe(canvas.parentElement);
resizeCanvas();
diceDisplay.innerHTML = diceSVG(1); // show a die face on load
