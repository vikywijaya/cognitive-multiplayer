'use strict';

// ── Constants ─────────────────────────────────────────────────────────────────
const HIT_WINDOW    = 400;  // ms — total tolerance window (±200ms each side)
const PERFECT_MS    = 150;  // ms — within this = 'perfect'
const INTRO_DELAY   = 2000; // ms before first beat

// ── Beat patterns ─────────────────────────────────────────────────────────────
// Each beat: { lane: 0-3, time: ms_from_game_start }
function makeBeatPattern(lanes, intervalMs) {
  return lanes.map((lane, i) => ({ lane, time: INTRO_DELAY + i * intervalMs }));
}

const PATTERNS = [
  {
    name: 'Kopi Break',
    bpm: 80,
    beats: makeBeatPattern(
      [0,2,1,3, 0,1,2,3, 1,0,3,2, 2,3,0,1, 0,0,2,2, 1,1,3,3, 0,3,1,2, 3,2,1,0],
      750
    )
  },
  {
    name: 'Orchard Road',
    bpm: 100,
    beats: makeBeatPattern(
      [0,1,2,3, 0,2,1,3, 3,1,2,0, 2,0,3,1, 0,1,0,2, 3,2,3,1, 0,2,1,3, 1,3,2,0],
      600
    )
  },
  {
    name: 'National Day Parade',
    bpm: 120,
    beats: makeBeatPattern(
      [0,1,2,3, 2,3,0,1, 0,0,1,1, 2,2,3,3, 0,3,1,2, 2,0,3,1, 0,1,2,3, 0,1,2,3],
      500
    )
  }
];

// ── Lane ownership by player count ────────────────────────────────────────────
function getLaneOwnership(playerCount) {
  if (playerCount <= 1) return [[0, 1, 2, 3]];
  if (playerCount === 2) return [[0, 1], [2, 3]];
  if (playerCount === 3) return [[0], [1], [2, 3]];
  // 4+ players: one lane each; extras share lane 3
  const ownership = [[0], [1], [2], [3]];
  for (let i = 4; i < playerCount; i++) ownership.push([3]);
  return ownership;
}

// ── Engine factory ────────────────────────────────────────────────────────────
function createGame(playerCount = 2) {
  // Pick a random pattern
  const pattern      = PATTERNS[Math.floor(Math.random() * PATTERNS.length)];
  const beats        = pattern.beats.slice();
  const laneOwnership = getLaneOwnership(playerCount);

  let phase      = 'waiting';
  let startTime  = null;
  let scores     = new Array(playerCount).fill(0);
  let beatsHit   = new Array(beats.length).fill(false);
  let _isGameOver = false;

  // ── state() ─────────────────────────────────────────────────────────
  function state() {
    return {
      gameType:     'rhythm-tap',
      phase,
      patternName:  pattern.name,
      bpm:          pattern.bpm,
      beats,
      startTime,
      scores:       scores.slice(),
      beatsHit:     beatsHit.slice(),
      totalBeats:   beats.length,
      laneOwnership,
      isGameOver:   _isGameOver,
      playerCount
    };
  }

  // ── startGame(serverStartTime) ───────────────────────────────────────
  function startGame(serverStartTime) {
    if (phase !== 'waiting') return { ok: false, reason: 'Already started' };
    phase     = 'playing';
    startTime = serverStartTime;
    return { ok: true };
  }

  // ── tapBeat(seat, lane, clientTime) ──────────────────────────────────
  // clientTime is epoch ms recorded by the client at tap moment
  function tapBeat(seat, lane, clientTime) {
    if (phase !== 'playing')           return { ok: false, reason: 'Not playing' };
    if (seat < 0 || seat >= playerCount) return { ok: false, reason: 'Invalid seat' };

    // Verify lane ownership
    const myLanes = laneOwnership[seat] || [];
    if (!myLanes.includes(lane)) {
      return { ok: true, hit: false, accuracy: 'wrong_lane' };
    }

    const gameTime = clientTime - startTime;

    // Find closest unhit beat in this lane within the window
    let bestIdx  = -1;
    let bestDist = Infinity;
    for (let i = 0; i < beats.length; i++) {
      if (beatsHit[i])           continue;
      if (beats[i].lane !== lane) continue;
      const dist = Math.abs(beats[i].time - gameTime);
      if (dist <= HIT_WINDOW && dist < bestDist) {
        bestDist = dist;
        bestIdx  = i;
      }
    }

    if (bestIdx === -1) return { ok: true, hit: false, accuracy: 'miss' };

    beatsHit[bestIdx] = true;
    scores[seat]++;
    const accuracy = bestDist <= PERFECT_MS ? 'perfect' : 'good';
    return { ok: true, hit: true, accuracy, beatIndex: bestIdx };
  }

  // ── endGame() ─────────────────────────────────────────────────────────
  function endGame() {
    phase       = 'results';
    _isGameOver = true;
    return { ok: true };
  }

  // ── isGameOver() / winner() ────────────────────────────────────────
  function isGameOver() { return _isGameOver; }

  function winner() {
    if (!_isGameOver) return null;
    const max = Math.max(...scores);
    // Return first seat with max score (ties go to lower seat number)
    return scores.indexOf(max);
  }

  // ── lastBeatTime() — convenience for server timer setup ──────────────
  function lastBeatTime() {
    return beats[beats.length - 1]?.time ?? 0;
  }

  return { state, startGame, tapBeat, endGame, isGameOver, winner, lastBeatTime };
}

module.exports = { createGame, HIT_WINDOW, PERFECT_MS, INTRO_DELAY };
