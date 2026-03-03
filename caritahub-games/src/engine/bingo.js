'use strict';

/**
 * Bingo engine — server-authoritative.
 *
 * Rules:
 *  - 2–8 players, each gets a unique 5×5 card with numbers 1–75.
 *    Columns: B=1-15, I=16-30, N=31-45, G=46-60, O=61-75.
 *    Center square (row2,col2) is FREE.
 *  - One player is the "caller" (seat 0, color = first in colors array).
 *    Caller calls numbers from the pool one at a time.
 *  - In standard mode, cards are auto-marked when a number is called.
 *  - In autoCallMode (TV Bingo), players must manually tap to mark their
 *    own cards. This ensures cognitive engagement (e.g. for seniors).
 *  - Win conditions (checked after each call):
 *    - Any row, column, or diagonal fully marked → BINGO!
 *    - Full card (full house) → FULL HOUSE!
 *  - Multiple winners can declare in the same call.
 *
 * Interface (matches CDI pattern):
 *   createGame(playerCount, options)  → engine object
 *   engine.state()           → full state (no secrets; all cards visible)
 *   engine.callNumber(seat)  → { ok, reason, number } — caller draws next number
 *   engine.markCell(seat,r,c)→ { ok, reason, number, bingo } — player taps a cell (autoCallMode only)
 *   engine.isGameOver()      → bool
 *   engine.winners()         → [{ seat, type }] array
 *
 * Options:
 *   autoCallMode: false  — when true, callNumber(-1) is allowed for server-driven
 *                          auto-calling (TV Bingo). No human caller seat needed.
 *                          Cards are NOT auto-marked; players must call markCell().
 */

const COLUMNS = ['B', 'I', 'N', 'G', 'O'];
// Number ranges per column
const COL_RANGES = [
  { min: 1,  max: 15 },
  { min: 16, max: 30 },
  { min: 31, max: 45 },
  { min: 46, max: 60 },
  { min: 61, max: 75 },
];
const CARD_SIZE = 5;
const FREE_ROW = 2;
const FREE_COL = 2;

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Generate a unique 5×5 Bingo card for a given column range set. */
function generateCard() {
  const grid = []; // grid[row][col]
  for (let r = 0; r < CARD_SIZE; r++) grid.push([]);

  for (let col = 0; col < CARD_SIZE; col++) {
    const { min, max } = COL_RANGES[col];
    const pool = [];
    for (let n = min; n <= max; n++) pool.push(n);
    shuffle(pool);
    const nums = pool.slice(0, CARD_SIZE);
    for (let row = 0; row < CARD_SIZE; row++) {
      grid[row][col] = nums[row];
    }
  }
  // FREE center
  grid[FREE_ROW][FREE_COL] = 0; // 0 = FREE
  return grid;
}

/** Build a 5×5 marked matrix (true = marked). FREE is pre-marked. */
function initialMarked() {
  const m = [];
  for (let r = 0; r < CARD_SIZE; r++) {
    m.push([false, false, false, false, false]);
  }
  m[FREE_ROW][FREE_COL] = true;
  return m;
}

/** Check win conditions on a marked grid. Returns array of win types found. */
function checkWins(marked) {
  const wins = [];
  // Rows
  for (let r = 0; r < CARD_SIZE; r++) {
    if (marked[r].every(v => v)) wins.push(`row${r}`);
  }
  // Columns
  for (let c = 0; c < CARD_SIZE; c++) {
    if (marked.every(row => row[c])) wins.push(`col${c}`);
  }
  // Diagonals
  if ([0,1,2,3,4].every(i => marked[i][i])) wins.push('diag-tl');
  if ([0,1,2,3,4].every(i => marked[i][CARD_SIZE-1-i])) wins.push('diag-tr');
  // Full house
  if (marked.every(row => row.every(v => v))) wins.push('fullhouse');
  return wins;
}

function createGame(playerCount = 2, options = {}) {
  const autoCallMode = options.autoCallMode || false;
  const minPlayers = autoCallMode ? 1 : 2;
  if (playerCount < minPlayers || playerCount > 8) throw new Error(`Bingo requires ${minPlayers}–8 players`);

  // Build number pool 1-75, shuffled
  const pool = shuffle(Array.from({ length: 75 }, (_, i) => i + 1));
  const called = []; // numbers called so far

  // Each player gets a card + marked matrix
  const cards   = Array.from({ length: playerCount }, generateCard);
  const marked  = Array.from({ length: playerCount }, initialMarked);

  let _isGameOver = false;
  let _winners = []; // [{ seat, types }]

  function state() {
    return {
      gameType: autoCallMode ? 'tv-bingo' : 'bingo',
      pool: pool.slice(),          // remaining (for server; clients don't see)
      called: called.slice(),       // all called numbers
      lastCalled: called.length ? called[called.length - 1] : null,
      cards,                        // all cards (all visible in bingo)
      marked,                       // per-player marked grids
      isGameOver: _isGameOver,
      winners: _winners,
      playerCount,
      callerSeat: autoCallMode ? -1 : 0, // -1 = auto/TV, 0 = human caller
      autoCallMode,
    };
  }

  function callNumber(seat) {
    if (autoCallMode) {
      if (seat !== -1) return { ok: false, reason: 'Auto-call mode: server calls only' };
    } else {
      if (seat !== 0) return { ok: false, reason: 'Only the caller can draw numbers' };
    }
    if (_isGameOver)  return { ok: false, reason: 'Game is over' };
    if (pool.length === 0) return { ok: false, reason: 'All numbers have been called!' };

    const num = pool.pop();
    called.push(num);

    // In autoCallMode, do NOT auto-mark — players must tap manually
    if (!autoCallMode) {
      // Mark all cards (standard bingo with human caller)
      for (let p = 0; p < playerCount; p++) {
        for (let r = 0; r < CARD_SIZE; r++) {
          for (let c = 0; c < CARD_SIZE; c++) {
            if (cards[p][r][c] === num) {
              marked[p][r][c] = true;
            }
          }
        }
      }

      // Check for new winners
      const newWinners = _checkNewWinners();
      return { ok: true, number: num, newWinners };
    }

    // autoCallMode: just return the called number, no marking
    return { ok: true, number: num, newWinners: [] };
  }

  /**
   * Manual mark — player taps a cell on their card (autoCallMode only).
   * Validates that the number at (row, col) has actually been called.
   * Returns { ok, reason?, number?, bingo? }
   */
  function markCell(seat, row, col) {
    if (!autoCallMode) return { ok: false, reason: 'Manual marking only in auto-call mode' };
    if (_isGameOver)   return { ok: false, reason: 'Game is over' };
    if (seat < 0 || seat >= playerCount) return { ok: false, reason: 'Invalid seat' };
    if (row < 0 || row >= CARD_SIZE || col < 0 || col >= CARD_SIZE) {
      return { ok: false, reason: 'Invalid cell' };
    }
    // Cannot mark the FREE cell (already marked)
    if (row === FREE_ROW && col === FREE_COL) {
      return { ok: false, reason: 'FREE cell is already marked' };
    }
    // Already marked
    if (marked[seat][row][col]) {
      return { ok: false, reason: 'Already marked' };
    }

    const num = cards[seat][row][col];

    // Check if this number has been called
    if (!called.includes(num)) {
      return { ok: false, reason: 'This number has not been called yet', number: num, wrongTap: true };
    }

    // Mark the cell
    marked[seat][row][col] = true;

    // Check if this player just completed bingo
    const wins = checkWins(marked[seat]);
    const alreadyWon = _winners.find(w => w.seat === seat);
    let bingo = false;

    if (wins.length > 0 && !alreadyWon) {
      _winners.push({ seat, types: wins });
      _isGameOver = true;
      bingo = true;
    }

    return { ok: true, number: num, bingo, wins: wins.length > 0 ? wins : undefined };
  }

  /** Internal: scan all players for new winners. */
  function _checkNewWinners() {
    const newWinners = [];
    for (let p = 0; p < playerCount; p++) {
      const wins = checkWins(marked[p]);
      const alreadyWon = _winners.find(w => w.seat === p);
      if (wins.length > 0 && !alreadyWon) {
        newWinners.push({ seat: p, types: wins });
      }
    }
    if (newWinners.length > 0) {
      _winners.push(...newWinners);
      _isGameOver = true;
    }
    return newWinners;
  }

  function isGameOver() { return _isGameOver; }
  function winners() { return _winners; }

  return { state, callNumber, markCell, isGameOver, winners };
}

module.exports = { createGame, COLUMNS, CARD_SIZE, FREE_ROW, FREE_COL };
