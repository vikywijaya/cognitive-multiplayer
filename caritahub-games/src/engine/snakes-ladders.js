'use strict';

// Classic Snakes and Ladders board positions
const LADDERS = { 4:14, 9:31, 20:38, 28:84, 40:59, 51:67, 63:81, 71:91 };
const SNAKES  = { 17:7, 54:34, 62:19, 64:60, 87:24, 93:73, 95:75, 99:78 };

function createGame(playerCount) {
  const positions = new Array(playerCount).fill(0);
  let currentSeat = 0;
  let isGameOver  = false;
  let winnerSeat  = null;
  let lastRoll    = null;
  let lastEvent   = null; // 'ladder' | 'snake' | 'stayed' | 'win' | null

  return {
    roll(seat) {
      if (seat !== currentSeat) return { ok: false, reason: 'Not your turn' };
      if (isGameOver)           return { ok: false, reason: 'Game is over' };

      const dice   = Math.floor(Math.random() * 6) + 1;
      lastRoll  = dice;
      lastEvent = null;

      const curPos = positions[seat];
      let newPos   = curPos + dice;
      let snakeFrom = null, snakeTo = null;
      let ladderFrom = null, ladderTo = null;
      let stayed = false;

      if (newPos > 100) {
        // Exact roll required — stay put on overshoot
        newPos = curPos;
        stayed = true;
        lastEvent = 'stayed';
      } else if (LADDERS[newPos] !== undefined) {
        ladderFrom = newPos;
        ladderTo   = LADDERS[newPos];
        newPos     = ladderTo;
        lastEvent  = 'ladder';
      } else if (SNAKES[newPos] !== undefined) {
        snakeFrom = newPos;
        snakeTo   = SNAKES[newPos];
        newPos    = snakeTo;
        lastEvent = 'snake';
      }

      positions[seat] = newPos;

      if (newPos === 100) {
        isGameOver = true;
        winnerSeat = seat;
        lastEvent  = 'win';
      } else {
        currentSeat = (currentSeat + 1) % playerCount;
      }

      return {
        ok: true,
        dice,
        newPosition: newPos,
        snakeFrom, snakeTo,
        ladderFrom, ladderTo,
        stayed,
        won: isGameOver
      };
    },

    isGameOver: () => isGameOver,
    winner:     () => winnerSeat,

    state: () => ({
      positions:   [...positions],
      currentSeat,
      isGameOver,
      winner:      winnerSeat,
      lastRoll,
      lastEvent,
      playerCount
    })
  };
}

module.exports = { createGame, LADDERS, SNAKES };
