'use strict';

// ── Constants ─────────────────────────────────────────────────────────────────
const TOTAL_ROUNDS  = 5;
const ROUND_TIME    = 60; // seconds
const HOTSPOTS_PER  = 5;

// ── Scene data ─────────────────────────────────────────────────────────────────
// Hotspots stored as % of image width/height (x, y) with radius in % of min(w,h).
// Client renders transparent overlay divs at these positions; server validates clicks.
const SCENES = [
  {
    id: 'raffles-hotel',
    label: 'Raffles Hotel',
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b9/Raffles_Hotel_2011.jpg/640px-Raffles_Hotel_2011.jpg',
    hotspots: [
      { id: 0, x: 15, y: 20, radius: 6 },
      { id: 1, x: 72, y: 38, radius: 6 },
      { id: 2, x: 48, y: 65, radius: 6 },
      { id: 3, x: 30, y: 82, radius: 6 },
      { id: 4, x: 88, y: 55, radius: 6 }
    ]
  },
  {
    id: 'merlion',
    label: 'Merlion Park',
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/40/Merlion%2C_Singapore%2C_2022.jpg/640px-Merlion%2C_Singapore%2C_2022.jpg',
    hotspots: [
      { id: 0, x: 50, y: 12, radius: 6 },
      { id: 1, x: 20, y: 45, radius: 6 },
      { id: 2, x: 80, y: 30, radius: 6 },
      { id: 3, x: 35, y: 75, radius: 6 },
      { id: 4, x: 65, y: 88, radius: 6 }
    ]
  },
  {
    id: 'chinatown',
    label: 'Chinatown',
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/Chinatown%2C_Singapore_%2820201103140401%29.jpg/640px-Chinatown%2C_Singapore_%2820201103140401%29.jpg',
    hotspots: [
      { id: 0, x: 10, y: 25, radius: 6 },
      { id: 1, x: 50, y: 15, radius: 6 },
      { id: 2, x: 82, y: 40, radius: 6 },
      { id: 3, x: 25, y: 70, radius: 6 },
      { id: 4, x: 70, y: 80, radius: 6 }
    ]
  },
  {
    id: 'gardens-bay',
    label: 'Gardens by the Bay',
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/30/Gardens_by_the_Bay%2C_Singapore_%28aerial_view%29.jpg/640px-Gardens_by_the_Bay%2C_Singapore_%28aerial_view%29.jpg',
    hotspots: [
      { id: 0, x: 22, y: 30, radius: 6 },
      { id: 1, x: 55, y: 20, radius: 6 },
      { id: 2, x: 78, y: 45, radius: 6 },
      { id: 3, x: 40, y: 72, radius: 6 },
      { id: 4, x: 15, y: 80, radius: 6 }
    ]
  },
  {
    id: 'boat-quay',
    label: 'Boat Quay',
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3c/Boat_Quay%2C_Singapore_%28night%29.jpg/640px-Boat_Quay%2C_Singapore_%28night%29.jpg',
    hotspots: [
      { id: 0, x: 12, y: 35, radius: 6 },
      { id: 1, x: 38, y: 22, radius: 6 },
      { id: 2, x: 62, y: 50, radius: 6 },
      { id: 3, x: 80, y: 30, radius: 6 },
      { id: 4, x: 50, y: 80, radius: 6 }
    ]
  }
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ── Engine factory ────────────────────────────────────────────────────────────
function createGame(playerCount = 2) {
  // Pick TOTAL_ROUNDS scenes (shuffle so each game has a different order)
  const scenes = shuffle(SCENES.slice()).slice(0, TOTAL_ROUNDS);

  let roundIndex   = -1;    // -1 = not yet started
  let phase        = 'waiting';
  let foundIds     = [];    // hotspot IDs found this round
  let teamScore    = 0;     // cumulative across all rounds
  let _timerEnd    = 0;
  let _isGameOver  = false;

  // ── state() ─────────────────────────────────────────────────────────
  function state() {
    const scene = roundIndex >= 0 ? scenes[roundIndex] : null;
    return {
      gameType:    'spot-the-difference',
      phase,
      roundIndex,
      totalRounds: TOTAL_ROUNDS,
      scene,
      foundIds:    foundIds.slice(),
      teamScore,
      timeLeft:    phase === 'playing'
        ? Math.max(0, Math.ceil((_timerEnd - Date.now()) / 1000))
        : 0,
      timerDeadline: _timerEnd,
      isGameOver:  _isGameOver,
      playerCount
    };
  }

  // ── startRound() ─────────────────────────────────────────────────────
  function startRound() {
    if (phase !== 'waiting')                     return { ok: false, reason: 'Not in waiting phase' };
    if (roundIndex >= TOTAL_ROUNDS - 1)          return { ok: false, reason: 'All rounds complete' };
    roundIndex++;
    phase    = 'playing';
    foundIds = [];
    _timerEnd = Date.now() + ROUND_TIME * 1000;
    return { ok: true };
  }

  // ── clickHotspot(x, y) ───────────────────────────────────────────────
  // x, y are percentage coordinates (0–100) of the image
  function clickHotspot(x, y) {
    if (phase !== 'playing')    return { ok: false, reason: 'Not playing' };
    if (roundIndex < 0)         return { ok: false, reason: 'No active round' };

    const scene = scenes[roundIndex];
    for (const hs of scene.hotspots) {
      if (foundIds.includes(hs.id)) continue;
      const dx   = x - hs.x;
      const dy   = y - hs.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= hs.radius * 1.5) {  // 1.5× tolerance for touch targets
        foundIds.push(hs.id);
        teamScore++;
        const allFound = foundIds.length === scene.hotspots.length;
        if (allFound) {
          // Round complete — wait for host to start next
          if (roundIndex >= TOTAL_ROUNDS - 1) {
            phase       = 'finished';
            _isGameOver = true;
          } else {
            phase = 'waiting';
          }
        }
        return { ok: true, found: true, hotspotId: hs.id, allFound };
      }
    }
    return { ok: true, found: false };
  }

  // ── roundTimeout() ────────────────────────────────────────────────────
  // Called by the server's 60s timer
  function roundTimeout() {
    if (phase !== 'playing') return { ok: false };
    if (roundIndex >= TOTAL_ROUNDS - 1) {
      phase       = 'finished';
      _isGameOver = true;
    } else {
      phase = 'waiting';
    }
    return { ok: true };
  }

  // ── nextRound() ───────────────────────────────────────────────────────
  // Host advances between rounds
  function nextRound() {
    if (phase !== 'waiting')        return { ok: false, reason: 'Not in waiting phase' };
    if (roundIndex >= TOTAL_ROUNDS - 1) {
      phase       = 'finished';
      _isGameOver = true;
      return { ok: true, finished: true };
    }
    return startRound();
  }

  // ── finishGame() ──────────────────────────────────────────────────────
  function finishGame() {
    phase       = 'finished';
    _isGameOver = true;
    return { ok: true };
  }

  function isGameOver() { return _isGameOver; }
  function winner()     { return null; }  // co-op — no individual winner

  return { state, startRound, clickHotspot, roundTimeout, nextRound, finishGame, isGameOver, winner };
}

module.exports = { createGame, ROUND_TIME, TOTAL_ROUNDS, HOTSPOTS_PER };
