'use strict';

// ── URL params ─────────────────────────────────────────────────────────────
const params    = new URLSearchParams(window.location.search);
const roomId    = params.get('room');
const myColor   = params.get('color');   // 'south' | 'west' | 'north' | 'east'
const myName    = params.get('name') || 'Player';

if (!roomId) window.location.href = '/';

// ── Card data ──────────────────────────────────────────────────────────────
const RANKS = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];
const SUITS = ['D','C','H','S'];                  // rank order matches server
const SUIT_GLYPHS = { D: '♦', C: '♣', H: '♥', S: '♠' };
const RED_SUITS = new Set(['D','H']);

function cardFromId(id) {
  return { id, rank: RANKS[Math.floor(id / 4)], suit: SUITS[id % 4] };
}

// ── DOM refs ───────────────────────────────────────────────────────────────
const statusBar        = document.getElementById('statusBar');
const cdiPlayersEl     = document.getElementById('cdiPlayers');
const cdiTableCardsEl  = document.getElementById('cdiTableCards');
const cdiComboTypeEl   = document.getElementById('cdiComboType');
const myHandEl         = document.getElementById('myHand');
const playBtn          = document.getElementById('playBtn');
const passBtn          = document.getElementById('passBtn');
const gameOverOverlay  = document.getElementById('gameOverOverlay');
const gameOverTitle    = document.getElementById('gameOverTitle');
const gameOverMsg      = document.getElementById('gameOverMsg');
const playAgainBtn     = document.getElementById('playAgainBtn');
const backLobbyBtn     = document.getElementById('backLobbyBtn');
const reconnectOverlay = document.getElementById('reconnectOverlay');
const reconnectMsg     = document.getElementById('reconnectMsg');
const backLobbyLink    = document.getElementById('backLobbyLink');

// ── State ──────────────────────────────────────────────────────────────────
let gameActive  = false;
let myTurn      = false;
let myHand      = [];
let selected    = new Set();   // set of selected card ids
let gameState   = null;

const SEAT_COLORS = ['south', 'west', 'north', 'east'];
const SEAT_NAMES  = { south: 'South', west: 'West', north: 'North', east: 'East' };
const SEAT_DOT    = { south: '#1155cc', west: '#1a6e1a', north: '#7d3c98', east: '#b7600a' };

// ── Socket ─────────────────────────────────────────────────────────────────
const socket = io({ reconnectionAttempts: 5, reconnectionDelay: 1000 });

socket.on('connect', () => {
  reconnectOverlay.style.display = 'none';
  socket.emit('join_game', { roomId, playerName: myName, reconnect: true, gameType: 'chordaidi' });
});

socket.on('disconnect', () => {
  reconnectOverlay.style.display = 'flex';
  reconnectMsg.textContent = 'Connection lost. Reconnecting…';
});

socket.on('reconnect_attempt', n => {
  reconnectMsg.textContent = `Reconnecting… (attempt ${n})`;
});

socket.on('reconnect_failed', () => {
  reconnectMsg.textContent = 'Could not reconnect.';
  backLobbyLink.classList.remove('hidden');
});

socket.on('joined', () => { /* seat confirmed */ });

socket.on('game_started', state => applyState(state));
socket.on('game_state',   state => applyState(state));

socket.on('invalid_move', ({ reason }) => flashStatus(`Invalid: ${reason}`, 3000));

socket.on('game_over', ({ winner, reason }) => showGameOver(winner, reason));

socket.on('play_again', () => {
  gameActive = false;
  myTurn = false;
  myHand = [];
  selected.clear();
  gameState = null;
  gameOverOverlay.classList.add('hidden');
  cdiPlayersEl.innerHTML = '';
  cdiTableCardsEl.innerHTML = '';
  cdiComboTypeEl.classList.add('hidden');
  myHandEl.innerHTML = '';
  updateActions();
  statusBar.textContent = 'Waiting for host to start…';
});

socket.on('player_disconnected', ({ playerName }) =>
  flashStatus(`${playerName} disconnected. Waiting…`, 0));

// ── Apply state ────────────────────────────────────────────────────────────
function applyState(state) {
  if (!state || state.gameType !== 'chordaidi') return;
  gameState  = state;
  gameActive = !state.isGameOver;
  myHand     = state.myHand || [];

  const mySeat = SEAT_COLORS.indexOf(myColor);
  myTurn = state.currentSeat === mySeat && gameActive;

  renderPlayers(state);
  renderTable(state.tableCombo);
  renderHand();
  updateActions();

  if (state.isGameOver) {
    showGameOver(state.winner, null);
    return;
  }

  const currentPlayer = state.players.find(p => SEAT_COLORS.indexOf(p.color) === state.currentSeat);
  statusBar.textContent = myTurn
    ? 'Your turn — select cards to play'
    : `${currentPlayer ? currentPlayer.name : 'Opponent'}'s turn`;
}

// ── Render players row ─────────────────────────────────────────────────────
function renderPlayers(state) {
  cdiPlayersEl.innerHTML = '';
  const order = SEAT_COLORS;
  order.forEach((color, seat) => {
    const playerData = state.players.find(p => p.color === color);
    const name = playerData ? playerData.name : `Seat ${seat + 1}`;
    const count = state.handCounts[seat] ?? '?';
    const isActive = state.currentSeat === seat;

    const div = document.createElement('div');
    div.className = 'cdi-player' + (isActive ? ' active-turn' : '');

    const dot = document.createElement('span');
    dot.className = 'cdi-player-dot';
    dot.style.background = SEAT_DOT[color];

    const nameEl = document.createElement('span');
    nameEl.textContent = `${SEAT_NAMES[color]}: ${name}${color === myColor ? ' (you)' : ''}`;

    const countEl = document.createElement('span');
    countEl.className = 'cdi-player-count';
    countEl.textContent = `${count} cards`;

    div.appendChild(dot);
    div.appendChild(nameEl);
    div.appendChild(countEl);
    cdiPlayersEl.appendChild(div);
  });
}

// ── Render table ───────────────────────────────────────────────────────────
const COMBO_LABELS = {
  single: 'Single', pair: 'Pair', triple: 'Triple',
  straight: 'Straight', flush: 'Flush', fullhouse: 'Full House',
  quads: 'Four of a Kind', straightflush: 'Straight Flush'
};

function renderTable(tableCombo) {
  cdiTableCardsEl.innerHTML = '';
  if (!tableCombo || !tableCombo.cardIds || tableCombo.cardIds.length === 0) {
    cdiComboTypeEl.classList.add('hidden');
    return;
  }
  tableCombo.cardIds.forEach(id => {
    cdiTableCardsEl.appendChild(makeCardTile(cardFromId(id), false));
  });
  cdiComboTypeEl.textContent = COMBO_LABELS[tableCombo.type] || tableCombo.type;
  cdiComboTypeEl.classList.remove('hidden');
}

// ── Render hand ────────────────────────────────────────────────────────────
function renderHand() {
  myHandEl.innerHTML = '';
  const sorted = [...myHand].sort((a, b) => a - b);
  sorted.forEach(id => {
    const tile = makeCardTile(cardFromId(id), true);
    if (selected.has(id)) tile.classList.add('selected');
    tile.addEventListener('click', () => toggleSelect(id, tile));
    myHandEl.appendChild(tile);
  });
}

function makeCardTile(card, interactive) {
  const div = document.createElement('div');
  div.className = 'card-tile ' + (RED_SUITS.has(card.suit) ? 'red-suit' : 'black-suit');
  div.dataset.id = card.id;

  const rankEl = document.createElement('span');
  rankEl.className = 'card-tile-rank';
  rankEl.textContent = card.rank;

  const suitEl = document.createElement('span');
  suitEl.className = 'card-tile-suit';
  suitEl.textContent = SUIT_GLYPHS[card.suit];

  div.appendChild(rankEl);
  div.appendChild(suitEl);
  if (!interactive) div.style.cursor = 'default';
  return div;
}

function toggleSelect(id, tile) {
  if (!myTurn || !gameActive) return;
  if (selected.has(id)) {
    selected.delete(id);
    tile.classList.remove('selected');
  } else {
    selected.add(id);
    tile.classList.add('selected');
  }
  updateActions();
}

// ── Action buttons ─────────────────────────────────────────────────────────
function updateActions() {
  playBtn.disabled = !myTurn || !gameActive || selected.size === 0;
  passBtn.disabled = !myTurn || !gameActive || !gameState?.tableCombo;
}

playBtn.addEventListener('click', () => {
  if (selected.size === 0) return;
  socket.emit('cdi_play', { cardIds: [...selected] });
  selected.clear();
});

passBtn.addEventListener('click', () => {
  socket.emit('cdi_pass');
});

playAgainBtn.addEventListener('click', () => { socket.emit('play_again'); });
backLobbyBtn.addEventListener('click', () => { window.location.href = '/'; });

// ── Game over ──────────────────────────────────────────────────────────────
function showGameOver(winnerSeat, reason) {
  gameActive = false;
  gameOverOverlay.classList.remove('hidden');

  let winnerName = null;
  if (gameState && winnerSeat !== null && winnerSeat !== undefined) {
    const winColor = SEAT_COLORS[winnerSeat];
    const wp = gameState.players.find(p => p.color === winColor);
    winnerName = wp ? wp.name : SEAT_NAMES[winColor];
  }

  const mySeat = SEAT_COLORS.indexOf(myColor);
  if (winnerSeat === mySeat) {
    gameOverTitle.textContent = 'You Win! 🎉';
    gameOverMsg.textContent   = 'You played all your cards first!';
  } else if (winnerName) {
    gameOverTitle.textContent = 'Game Over';
    gameOverMsg.textContent   = reason || `${winnerName} wins!`;
  } else {
    gameOverTitle.textContent = 'Game Over';
    gameOverMsg.textContent   = reason || '';
  }
  updateActions();
}

// ── Flash status ───────────────────────────────────────────────────────────
let flashTimer = null;
function flashStatus(msg, duration) {
  statusBar.textContent = msg;
  if (flashTimer) clearTimeout(flashTimer);
  if (duration > 0) {
    flashTimer = setTimeout(() => {
      statusBar.textContent = myTurn ? 'Your turn — select cards to play' : "Opponent's turn";
    }, duration);
  }
}
