'use strict';

/**
 * Higher or Lower engine — server-authoritative.
 *
 * Rules:
 *  - 1–8 players, 30 cards numbered 1–30 shuffled into a random sequence.
 *  - First card is revealed automatically. Players take turns predicting
 *    whether the NEXT card will be higher or lower than the current card.
 *  - Correct guess → player stays alive, turn passes to next alive player.
 *  - Equal value → treated as correct (player survives).
 *  - Wrong guess → player eliminated.
 *  - Last player standing wins. If only 1 player, survive all 30 cards to win.
 *  - Game also ends if all 30 cards are revealed.
 *
 * Interface:
 *   createGame(playerCount)       → engine object
 *   engine.state()                → { revealed, alive, currentSeat, ... }
 *   engine.guess(seat, direction) → { ok, correct, revealedCard, ... }
 *   engine.isGameOver()           → bool
 *   engine.winner()               → seat index | null
 */

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function createGame(playerCount = 2) {
  if (playerCount < 1 || playerCount > 8) throw new Error('Higher or Lower requires 1–8 players');

  // Shuffle cards 1–30
  const deck = shuffle(Array.from({ length: 30 }, (_, i) => i + 1));

  // Reveal first card automatically
  const revealed = [deck[0]];
  let revealIndex = 1; // next card to reveal

  const alive = new Array(playerCount).fill(true);
  let currentSeat = 0; // first alive player
  let lastGuess = null; // { seat, guess, correct, card, previousCard }
  let _isGameOver = false;
  let _winnerSeat = null;

  function aliveCount() {
    return alive.filter(Boolean).length;
  }

  function nextAliveSeat(fromSeat) {
    if (aliveCount() === 0) return -1;
    let seat = (fromSeat + 1) % playerCount;
    while (!alive[seat]) {
      seat = (seat + 1) % playerCount;
      if (seat === fromSeat) break; // safety: wrapped around
    }
    return seat;
  }

  function checkGameOver() {
    const ac = aliveCount();
    // Only 1 player and all cards revealed
    if (playerCount === 1 && revealIndex >= deck.length) {
      _isGameOver = true;
      _winnerSeat = alive[0] ? 0 : null;
      return;
    }
    // Multi-player: 1 or 0 alive
    if (playerCount > 1 && ac <= 1) {
      _isGameOver = true;
      _winnerSeat = alive.indexOf(true);
      if (_winnerSeat === -1) _winnerSeat = null;
      return;
    }
    // All cards revealed — survivor(s) win; pick the one with most recent survival
    if (revealIndex >= deck.length) {
      _isGameOver = true;
      // Winner = first alive seat (they all survived equally)
      _winnerSeat = alive.indexOf(true);
      if (_winnerSeat === -1) _winnerSeat = null;
      return;
    }
  }

  function state() {
    return {
      gameType: 'tv-higher-lower',
      deck: deck.slice(0, revealIndex), // only show revealed cards + their positions
      deckSize: deck.length,
      revealed,
      revealIndex,
      currentCard: revealed[revealed.length - 1],
      alive: alive.slice(),
      currentSeat,
      lastGuess,
      isGameOver: _isGameOver,
      winnerSeat: _winnerSeat,
      playerCount,
      cardsRemaining: deck.length - revealIndex
    };
  }

  function guess(seat, direction) {
    if (_isGameOver) return { ok: false, reason: 'Game is over' };
    if (seat !== currentSeat) return { ok: false, reason: 'Not your turn' };
    if (!alive[seat]) return { ok: false, reason: 'You are eliminated' };
    if (direction !== 'higher' && direction !== 'lower') {
      return { ok: false, reason: 'Must guess "higher" or "lower"' };
    }
    if (revealIndex >= deck.length) return { ok: false, reason: 'No more cards' };

    const previousCard = revealed[revealed.length - 1];
    const newCard = deck[revealIndex];
    revealIndex++;
    revealed.push(newCard);

    // Determine correctness
    let correct;
    if (newCard === previousCard) {
      // Equal = player survives
      correct = true;
    } else if (direction === 'higher') {
      correct = newCard > previousCard;
    } else {
      correct = newCard < previousCard;
    }

    let eliminatedSeat = null;
    if (!correct) {
      alive[seat] = false;
      eliminatedSeat = seat;
    }

    lastGuess = { seat, guess: direction, correct, card: newCard, previousCard };

    // Advance to next alive player
    if (aliveCount() > 0) {
      currentSeat = nextAliveSeat(seat);
    }

    checkGameOver();

    return {
      ok: true,
      correct,
      revealedCard: newCard,
      previousCard,
      eliminatedSeat,
      isGameOver: _isGameOver,
      winnerSeat: _winnerSeat
    };
  }

  function isGameOver() { return _isGameOver; }

  function winner() { return _winnerSeat; }

  // Initial game-over check (edge case: 0 alive — shouldn't happen)
  checkGameOver();

  return { state, guess, isGameOver, winner };
}

module.exports = { createGame };
