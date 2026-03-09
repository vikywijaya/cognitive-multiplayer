'use strict';

/**
 * TV Bike Race Engine
 *
 * TV = Master display showing the race track with animated bike characters.
 * Phones = Player controllers where tapping LEFT and RIGHT pedals alternately
 *          makes their character accelerate.
 *
 * Format: TOTAL_ROUNDS rounds of 1 lap each.
 * After each round the server calls startNextRound() and the race repeats.
 * Overall winner = most round wins; tiebreaker = lowest total finish time.
 */

const TRACK_LENGTH    = 2000;              // track units (0 → 2000 = finish)
const TOTAL_ROUNDS    = 3;                // number of rounds
const MAX_PLAYERS     = 6;
const TICK_MS         = 100;              // server tick interval
const SPEED_PER_TAP_ALTERNATE = 2.0;     // speed boost for alternating pedal tap
const SPEED_PER_TAP_SAME      = 0.6;     // speed boost for same-side repeat tap
const MAX_SPEED       = 10;              // max speed units per tick
const SPEED_DECAY     = 0.87;            // multiplied each tick (100 ms)
const ROUND_TIMEOUT_MS = 120_000;        // 2-minute max per round

const PLAYER_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c'];
const PLAYER_EMOJIS = ['🐢', '🐇', '🦊', '🐻', '🦔', '🐼'];

// ── Engine factory ────────────────────────────────────────────────────────────

function createGame() {
  const players = [];   // { id, name, color, emoji, position, speed, lastPedal, finished, finishTime, rank, roundTimes, roundRanks }
  let started      = false;
  let over         = false;         // entire game finished (all rounds done)
  let roundOver    = false;         // current round finished
  let currentRound = 1;
  let elapsed      = 0;
  let lastTickAt   = null;
  let finishCount  = 0;

  // ── Player management ────────────────────────────────────────────────────

  function addPlayer(id, name) {
    if (players.length >= MAX_PLAYERS) return null;
    const idx = players.length;
    const p = {
      id, name,
      color:       PLAYER_COLORS[idx],
      emoji:       PLAYER_EMOJIS[idx],
      position:    0,      // 0 → TRACK_LENGTH
      speed:       0,
      lastPedal:   null,   // 'left' | 'right' | null
      finished:    false,
      finishTime:  null,
      rank:        null,
      roundTimes:  [],     // finish time per round (null = DNF)
      roundRanks:  [],     // rank per round
    };
    players.push(p);
    return p;
  }

  function removePlayer(id) {
    const idx = players.findIndex(p => p.id === id);
    if (idx !== -1) players.splice(idx, 1);
  }

  function getPlayer(id) {
    return players.find(p => p.id === id) || null;
  }

  // ── Pedal tap (player action) ─────────────────────────────────────────────

  function pedalTap(playerId, side) {
    const player = getPlayer(playerId);
    if (!player || !started || over || roundOver || player.finished) return { ok: false };

    const isAlternate = player.lastPedal !== null && player.lastPedal !== side;
    const boost = isAlternate ? SPEED_PER_TAP_ALTERNATE : SPEED_PER_TAP_SAME;

    player.lastPedal = side;
    player.speed = Math.min(MAX_SPEED, player.speed + boost);

    return {
      ok: true,
      isAlternate,
      speed:    Math.round(player.speed * 10) / 10,
      position: player.position,
    };
  }

  // ── Game physics tick (called every TICK_MS) ──────────────────────────────

  function tick() {
    if (!started || over || roundOver) return;

    const now = Date.now();
    if (lastTickAt === null) { lastTickAt = now; return; }
    const dt = now - lastTickAt;
    lastTickAt = now;
    elapsed += dt;

    // Round timeout — assign remaining ranks by position
    if (elapsed >= ROUND_TIMEOUT_MS) {
      const unfinished = players
        .filter(p => !p.finished)
        .sort((a, b) => b.position - a.position);
      let r = finishCount + 1;
      for (const p of unfinished) {
        p.rank = r++;
        p.finished = true;
        p.roundRanks.push(p.rank);
        p.roundTimes.push(null); // DNF
      }
      _endRound();
      return;
    }

    for (const player of players) {
      if (player.finished) continue;

      // Decay speed
      player.speed *= SPEED_DECAY;
      if (player.speed < 0.01) player.speed = 0;

      // Advance position
      const movement = player.speed * (dt / TICK_MS);
      player.position = Math.min(TRACK_LENGTH, player.position + movement);

      // Finish line
      if (player.position >= TRACK_LENGTH && !player.finished) {
        player.finished  = true;
        player.finishTime = elapsed;
        player.rank      = ++finishCount;
        player.roundRanks.push(player.rank);
        player.roundTimes.push(elapsed);
      }
    }

    // Round over when all players finished
    if (players.length > 0 && players.every(p => p.finished)) {
      _endRound();
    }
  }

  function _endRound() {
    roundOver = true;
    if (currentRound >= TOTAL_ROUNDS) over = true;
  }

  // ── Advance to next round ─────────────────────────────────────────────────

  function startNextRound() {
    if (currentRound >= TOTAL_ROUNDS) return;
    currentRound++;
    roundOver  = false;
    elapsed    = 0;
    lastTickAt = null;
    finishCount = 0;
    for (const p of players) {
      p.position   = 0;
      p.speed      = 0;
      p.lastPedal  = null;
      p.finished   = false;
      p.finishTime = null;
      p.rank       = null;
    }
  }

  // ── Start race (first round) ──────────────────────────────────────────────

  function start() {
    started    = true;
    lastTickAt = null;
    elapsed    = 0;
  }

  // ── Live rank (by position, for unfinished players) ───────────────────────

  function _liveRank(player) {
    if (player.finished) return player.rank;
    const ahead = players.filter(p => p !== player && p.position > player.position);
    return ahead.length + 1;
  }

  // ── Overall standings (most round wins, tiebreak by total time) ───────────

  function _overallStandings() {
    return [...players].sort((a, b) => {
      const aWins = a.roundRanks.filter(r => r === 1).length;
      const bWins = b.roundRanks.filter(r => r === 1).length;
      if (bWins !== aWins) return bWins - aWins;
      const aTime = a.roundTimes.reduce((s, t) => s + (t ?? 9999999), 0);
      const bTime = b.roundTimes.reduce((s, t) => s + (t ?? 9999999), 0);
      return aTime - bTime;
    });
  }

  // ── State snapshots ───────────────────────────────────────────────────────

  /** Full state broadcast to TV */
  function state() {
    return {
      players: players.map(p => ({
        id:          p.id,
        name:        p.name,
        color:       p.color,
        emoji:       p.emoji,
        position:    Math.round(p.position * 100) / 100,
        speed:       Math.round(p.speed * 100) / 100,
        progress:    parseFloat((p.position / TRACK_LENGTH).toFixed(4)),
        finished:    p.finished,
        rank:        p.finished ? p.rank : _liveRank(p),
        finishTime:  p.finishTime,
        roundTimes:  p.roundTimes,
        roundRanks:  p.roundRanks,
        roundWins:   p.roundRanks.filter(r => r === 1).length,
      })),
      trackLength:   TRACK_LENGTH,
      currentRound,
      totalRounds:   TOTAL_ROUNDS,
      roundOver,
      started,
      over,
      elapsed:       Math.round(elapsed),
    };
  }

  /** Personalized state for each player's phone */
  function playerState(playerId) {
    const p = getPlayer(playerId);
    if (!p) return null;
    return {
      id:           p.id,
      name:         p.name,
      color:        p.color,
      emoji:        p.emoji,
      position:     Math.round(p.position * 100) / 100,
      speed:        Math.round(p.speed * 100) / 100,
      progress:     parseFloat((p.position / TRACK_LENGTH).toFixed(4)),
      finished:     p.finished,
      rank:         p.finished ? p.rank : _liveRank(p),
      totalPlayers: players.length,
      lastPedal:    p.lastPedal,
      finishTime:   p.finishTime,
      roundTimes:   p.roundTimes,
      roundRanks:   p.roundRanks,
      roundWins:    p.roundRanks.filter(r => r === 1).length,
      currentRound,
      totalRounds:  TOTAL_ROUNDS,
    };
  }

  function winner() {
    const standings = _overallStandings();
    return standings[0]?.name || null;
  }

  function overallRankings() {
    return _overallStandings().map((p, i) => ({
      name:       p.name,
      emoji:      p.emoji,
      color:      p.color,
      rank:       i + 1,
      roundRanks: p.roundRanks,
      roundTimes: p.roundTimes,
      roundWins:  p.roundRanks.filter(r => r === 1).length,
      totalTime:  p.roundTimes.reduce((s, t) => s + (t ?? 0), 0),
    }));
  }

  return {
    addPlayer, removePlayer, getPlayer,
    pedalTap, tick, start, startNextRound, state, playerState, winner, overallRankings,
    get players()      { return players; },
    get over()         { return over; },
    get roundOver()    { return roundOver; },
    get currentRound() { return currentRound; },
    get started()      { return started; },
  };
}

module.exports = { createGame, PLAYER_COLORS, PLAYER_EMOJIS, TRACK_LENGTH, TOTAL_ROUNDS, MAX_PLAYERS };
