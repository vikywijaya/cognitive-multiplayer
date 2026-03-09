'use strict';

/**
 * Server-side Reversi (Othello) engine.
 * Board: 8x8 array, row 0 = top, row 7 = bottom.
 * 'B' = Black disc, 'W' = White disc, null = empty.
 * Black always moves first.
 * A valid move must flip at least one opponent disc.
 * If a player has no valid moves, their turn is skipped.
 * Game ends when neither player can move or the board is full.
 * Winner: player with more discs (tie = draw).
 */

const DIRS = [
  [-1, -1], [-1, 0], [-1, 1],
  [0,  -1],           [0,  1],
  [1,  -1], [1,  0], [1,  1]
];

function inBounds(r, c) {
  return r >= 0 && r < 8 && c >= 0 && c < 8;
}

function opponent(color) {
  return color === 'B' ? 'W' : 'B';
}

/**
 * Returns list of discs that would be flipped if `color` places at (r, c).
 * Empty list means the move is invalid.
 */
function getFlips(board, r, c, color) {
  if (board[r][c] !== null) return [];
  const opp = opponent(color);
  const flips = [];

  for (const [dr, dc] of DIRS) {
    const line = [];
    let nr = r + dr, nc = c + dc;
    while (inBounds(nr, nc) && board[nr][nc] === opp) {
      line.push([nr, nc]);
      nr += dr;
      nc += dc;
    }
    // Line is valid only if it ends on a disc of our own color
    if (line.length > 0 && inBounds(nr, nc) && board[nr][nc] === color) {
      for (const pos of line) flips.push(pos);
    }
  }
  return flips;
}

/**
 * Returns all valid move positions for `color` as an array of [r, c].
 */
function validMoves(board, color) {
  const moves = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (board[r][c] === null && getFlips(board, r, c, color).length > 0) {
        moves.push([r, c]);
      }
    }
  }
  return moves;
}

function cloneBoard(board) {
  return board.map(row => [...row]);
}

function countDiscs(board) {
  let B = 0, W = 0;
  for (const row of board) {
    for (const cell of row) {
      if (cell === 'B') B++;
      else if (cell === 'W') W++;
    }
  }
  return { B, W };
}

function createInitialBoard() {
  const board = Array.from({ length: 8 }, () => Array(8).fill(null));
  // Standard Reversi starting position
  board[3][3] = 'W';
  board[3][4] = 'B';
  board[4][3] = 'B';
  board[4][4] = 'W';
  return board;
}

// ── Public engine factory ─────────────────────────────────────────────

function createGame() {
  let board = createInitialBoard();
  let turn = 'B'; // Black moves first
  let skippedLast = false; // whether the previous turn was skipped
  let over = false;
  let winnerColor = null; // 'B' | 'W' | 'draw' | null

  function checkGameOver() {
    const blackMoves = validMoves(board, 'B');
    const whiteMoves = validMoves(board, 'W');

    if (blackMoves.length === 0 && whiteMoves.length === 0) {
      // No moves for either side
      over = true;
      const { B, W } = countDiscs(board);
      if (B > W) winnerColor = 'B';
      else if (W > B) winnerColor = 'W';
      else winnerColor = 'draw';
      return;
    }

    // Current player has no moves → skip their turn
    if (validMoves(board, turn).length === 0) {
      skippedLast = true;
      turn = opponent(turn);
    } else {
      skippedLast = false;
    }
  }

  // Immediately resolve any initial skips (shouldn't happen at start but be safe)
  checkGameOver();

  /**
   * Place a disc for `color` at (row, col).
   * Returns { ok: true } or { ok: false, reason: string }.
   */
  function move(row, col) {
    if (over) return { ok: false, reason: 'Game is over' };
    if (!inBounds(row, col)) return { ok: false, reason: 'Out of bounds' };

    const flips = getFlips(board, row, col, turn);
    if (flips.length === 0) return { ok: false, reason: 'Invalid move — must flip at least one disc' };

    // Apply move
    board[row][col] = turn;
    for (const [fr, fc] of flips) {
      board[fr][fc] = turn;
    }

    turn = opponent(turn);
    checkGameOver();
    return { ok: true };
  }

  function isGameOver() { return over; }

  function winner() {
    if (!over) return null;
    return winnerColor; // 'B' | 'W' | 'draw'
  }

  function currentTurn() { return turn; } // 'B' | 'W'

  function boardState() { return cloneBoard(board); }

  function state() {
    const { B, W } = countDiscs(board);
    const moves = over ? [] : validMoves(board, turn);
    return {
      board: cloneBoard(board),
      turn,
      validMoves: moves,
      discs: { B, W },
      isGameOver: over,
      winner: winnerColor,
      skippedLast
    };
  }

  return { move, isGameOver, winner, turn: currentTurn, boardState, state };
}

module.exports = { createGame };
