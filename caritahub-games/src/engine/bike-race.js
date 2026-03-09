'use strict';

/**
 * TV Bike Race Engine
 *
 * TV = Master display showing the race track with animated bike characters.
 * Phones = Player controllers where tapping LEFT and RIGHT pedals alternately
 *          makes their character accelerate.
 *
 * Pedaling mechanic:
 *   - Player has two pedals: LEFT and RIGHT
 *   - Alternating (L→R or R→L): full speed boost (+SPEED_PER_TAP_ALTERNATE)
 *   - Same side twice in a row: reduced boost (+SPEED_PER_TAP_SAME)
 *   - Speed decays each tick when not tapping
 *
 * Win: First player to complete TOTAL_LAPS laps wins!
 */

const TRACK_LENGTH    = 2000;              // track units per lap (0 → 2000 = lap complete)
const TOTAL_LAPS      = 3;                // number of laps to finish the race
const MAX_PLAYERS     = 6;
const TICK_MS         = 100;              // server tick interval
const SPEED_PER_TAP_ALTERNATE = 2.0;     // speed boost for alternating pedal tap
const SPEED_PER_TAP_SAME      = 0.6;     // speed boost for same-side repeat tap
const MAX_SPEED       = 10;              // max speed units per tick
const SPEED_DECAY     = 0.87;            // multiplied each tick (100 ms)
const GAME_TIMEOUT_MS = 240_000;         // 4-minute maximum race time (3 laps)

const PLAYER_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c'];
const PLAYER_EMOJIS = ['🐢', '🐇', '🦊', '🐻', '🦔', '🐼'];

// ── Engine factory ────────────────────────────────────────────────────────────

function createGame() {
  const players = [];   // { id, name, color, emoji, position, speed, lastPedal, lap, lapStartTime, lapTimes, bestLap, finished, finishTime, rank }
  let started    = false;
  let over       = false;
  let elapsed    = 0;
  let lastTickAt = null;
  let finishCount = 0;

  // ── Player management ────────────────────────────────────────────────────

  function addPlayer(id, name) {
    if (players.length >= MAX_PLAYERS) return null;
    const idx = players.length;
    const p = {
      id, name,
      color:        PLAYER_COLORS[idx],
      emoji:        PLAYER_EMOJIS[idx],
      position:     0,          // 0 → TRACK_LENGTH (per lap)
      speed:        0,          // current speed (units per tick)
      lastPedal:    null,       // 'left' | 'right' | null
      lap:          1,          // current lap (1-based)
      lapStartTime: 0,          // elapsed ms at start of current lap
      lapTimes:     [],         // time taken for each completed lap
      bestLap:      null,       // best lap time in ms
      finished:     false,
      finishTime:   null,
      rank:         null,
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
    if (!player || !started || over || player.finished) return { ok: false };

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
    if (!started || over) return;

    const now = Date.now();
    if (lastTickAt === null) { lastTickAt = now; return; }
    const dt = now - lastTickAt;
    lastTickAt = now;
    elapsed += dt;

    // timeout — assign final ranks by lap then position
    if (elapsed >= GAME_TIMEOUT_MS) {
      const unfinished = players
        .filter(p => !p.finished)
        .sort((a, b) => b.lap - a.lap || b.position - a.position);
      let r = finishCount + 1;
      for (const p of unfinished) { p.rank = r++; p.finished = true; }
      over = true;
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

      // Lap / finish line
      if (player.position >= TRACK_LENGTH) {
        const lapTime = elapsed - player.lapStartTime;
        player.lapTimes.push(lapTime);
        if (player.bestLap === null || lapTime < player.bestLap) player.bestLap = lapTime;
        player.lapStartTime = elapsed;

        if (player.lap < TOTAL_LAPS) {
          // Complete this lap, start next
          player.lap++;
          player.position -= TRACK_LENGTH; // wrap around
        } else {
          // Final lap done — finished!
          player.position  = TRACK_LENGTH;
          player.finished  = true;
          player.finishTime = elapsed;
          player.rank      = ++finishCount;
        }
      }
    }

    // Race over when all players have finished
    if (players.length > 0 && players.every(p => p.finished)) {
      over = true;
    }
  }

  // ── Start race ────────────────────────────────────────────────────────────

  function start() {
    started    = true;
    lastTickAt = null;
    elapsed    = 0;
  }

  // ── Live rank (by lap then position, for unfinished players) ──────────────

  function _liveRank(player) {
    if (player.finished) return player.rank;
    const ahead = players.filter(p => p !== player && (
      p.lap > player.lap ||
      (p.lap === player.lap && p.position > player.position)
    ));
    return ahead.length + 1;
  }

  // ── State snapshots ───────────────────────────────────────────────────────

  /** Full state broadcast to TV */
  function state() {
    return {
      players: players.map(p => ({
        id:         p.id,
        name:       p.name,
        color:      p.color,
        emoji:      p.emoji,
        position:   Math.round(p.position * 100) / 100,
        speed:      Math.round(p.speed * 100) / 100,
        progress:   parseFloat(((p.lap - 1 + p.position / TRACK_LENGTH) / TOTAL_LAPS).toFixed(4)),
        lap:        p.lap,
        totalLaps:  TOTAL_LAPS,
        bestLap:    p.bestLap,
        lapTimes:   p.lapTimes,
        finished:   p.finished,
        rank:       p.finished ? p.rank : _liveRank(p),
        finishTime: p.finishTime,
      })),
      trackLength:  TRACK_LENGTH,
      totalLaps:    TOTAL_LAPS,
      started,
      over,
      elapsed:      Math.round(elapsed),
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
      progress:     parseFloat(((p.lap - 1 + p.position / TRACK_LENGTH) / TOTAL_LAPS).toFixed(4)),
      lap:          p.lap,
      totalLaps:    TOTAL_LAPS,
      bestLap:      p.bestLap,
      finished:     p.finished,
      rank:         p.finished ? p.rank : _liveRank(p),
      totalPlayers: players.length,
      lastPedal:    p.lastPedal,
      finishTime:   p.finishTime,
    };
  }

  function winner() {
    const w = players.find(p => p.rank === 1);
    return w?.name || null;
  }

  return {
    addPlayer, removePlayer, getPlayer,
    pedalTap, tick, start, state, playerState, winner,
    get players()  { return players; },
    get over()     { return over; },
    get started()  { return started; },
  };
}

module.exports = { createGame, PLAYER_COLORS, PLAYER_EMOJIS, TRACK_LENGTH, TOTAL_LAPS, MAX_PLAYERS };
