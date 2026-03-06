'use strict';

/**
 * Multiplayer Cooking Game Engine — Task-Based (Overcooked-style)
 *
 * TV = Master Display showing animated kitchen + 4 active orders.
 * Phones = Personal Workstations where players CHOOSE which task to work on.
 *
 * Key design:
 *   - All tasks in an order are available simultaneously (parallel work)
 *   - Players on their phone see available tasks and PICK one to claim
 *   - Each claimed task becomes a mini-game (chop/stir/flip)
 *   - TV shows character avatars moving to kitchen stations
 *
 * Task types:
 *   chopping  — rapid tap (target taps)
 *   stirring  — circular swipe (target circles)
 *   flipping  — timed QTE (tap when bar is green)
 *
 * Recipes (each has 3 parallel tasks):
 *   Burger   = Chop Onions + Grill Patty + Assemble          → 100pts
 *   Sushi    = Chop Fish   + Prepare Rice + Roll              → 120pts
 *   Pasta    = Chop Veggies + Stir Sauce + Plate              → 110pts
 *   Pancake  = Stir Batter + Flip Pancake + Plate             → 90pts
 */

const GAME_DURATION_MS = 180_000; // 3 minutes
const MAX_PLAYERS = 4;
const SCORE_PENALTY = 30;
const TARGET_ORDERS = 8;          // serve this many to WIN!

// ── Progressive difficulty ───────────────────────────────────────────────────
// Difficulty ramps up based on orders filled (0→8+)
// Phase 0 (0 orders):   easy   — slow orders, long lifetime, simple recipes
// Phase 1 (2 orders):   medium — moderate pace
// Phase 2 (4 orders):   hard   — faster pace, shorter lifetime
// Phase 3 (6+ orders):  rush   — maximum pressure!

function getDifficulty(ordersFilled, elapsed) {
  const phase = Math.min(3, Math.floor(ordersFilled / 2));
  // Also factor in time — after 90s, push harder even if not many orders filled
  const timePhase = elapsed > 120_000 ? 2 : elapsed > 60_000 ? 1 : 0;
  const effective = Math.max(phase, timePhase);

  const settings = [
    { orderInterval: 18_000, orderLifetime: 75_000, maxOrders: 2, tapMult: 0.8, circleMult: 0.8, label: 'Easy' },
    { orderInterval: 14_000, orderLifetime: 60_000, maxOrders: 3, tapMult: 0.9, circleMult: 0.9, label: 'Medium' },
    { orderInterval: 10_000, orderLifetime: 50_000, maxOrders: 4, tapMult: 1.0, circleMult: 1.0, label: 'Hard' },
    { orderInterval:  8_000, orderLifetime: 40_000, maxOrders: 5, tapMult: 1.2, circleMult: 1.2, label: 'Rush!' },
  ];
  return settings[effective];
}

// ── Kitchen stations (for TV visualization) ─────────────────────────────────

const STATIONS = {
  chop:  { x: 1, y: 0, label: 'Chopping Board', emoji: '🔪' },
  stove: { x: 3, y: 0, label: 'Stove',          emoji: '🍳' },
  plate: { x: 5, y: 0, label: 'Plating',        emoji: '🍽️' },
  idle:  { x: 3, y: 2, label: 'Waiting Area',    emoji: '🧑‍🍳' },
};

// Map task types to stations
const TASK_STATION = {
  chopping: 'chop',
  stirring: 'stove',
  flipping: 'plate',
};

// ── Task definitions ────────────────────────────────────────────────────────

const TASK_TYPES = {
  chop_onions:    { type: 'chopping', label: 'Chop Onions',     emoji: '🧅', targetTaps: 15, station: 'chop' },
  chop_fish:      { type: 'chopping', label: 'Chop Fish',       emoji: '🐟', targetTaps: 12, station: 'chop' },
  chop_veggies:   { type: 'chopping', label: 'Chop Veggies',    emoji: '🥦', targetTaps: 14, station: 'chop' },
  grill_patty:    { type: 'flipping', label: 'Grill Patty',     emoji: '🥩', station: 'stove' },
  prepare_rice:   { type: 'stirring', label: 'Prepare Rice',    emoji: '🍚', targetCircles: 6, station: 'stove' },
  stir_sauce:     { type: 'stirring', label: 'Stir Sauce',      emoji: '🍅', targetCircles: 8, station: 'stove' },
  stir_batter:    { type: 'stirring', label: 'Stir Batter',     emoji: '🥣', targetCircles: 6, station: 'stove' },
  flip_pancake:   { type: 'flipping', label: 'Flip Pancake',    emoji: '🥞', station: 'plate' },
  roll_sushi:     { type: 'flipping', label: 'Roll Sushi',      emoji: '🍣', station: 'plate' },
  assemble:       { type: 'flipping', label: 'Assemble Burger', emoji: '🍔', station: 'plate' },
  plate_pasta:    { type: 'flipping', label: 'Plate Pasta',     emoji: '🍝', station: 'plate' },
  plate_pancake:  { type: 'flipping', label: 'Plate Pancake',   emoji: '🥞', station: 'plate' },
};

// ── Recipes ─────────────────────────────────────────────────────────────────

const RECIPES = [
  { name: 'Burger',  emoji: '🍔', points: 100, steps: ['chop_onions',  'grill_patty',   'assemble'] },
  { name: 'Sushi',   emoji: '🍣', points: 120, steps: ['chop_fish',    'prepare_rice',  'roll_sushi'] },
  { name: 'Pasta',   emoji: '🍝', points: 110, steps: ['chop_veggies', 'stir_sauce',    'plate_pasta'] },
  { name: 'Pancake', emoji: '🥞', points: 90,  steps: ['stir_batter',  'flip_pancake',  'plate_pancake'] },
];

const PLAYER_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12'];
const PLAYER_EMOJIS = ['👩‍🍳', '👨‍🍳', '🧑‍🍳', '👩‍🍳'];

// ── Helpers ─────────────────────────────────────────────────────────────────

let _orderIdSeq = 0;
let _taskIdSeq  = 0;

function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ── Engine factory ──────────────────────────────────────────────────────────

function createGame() {
  const players = [];      // { id, name, color, emoji, score, claimedTaskId, station }
  const orders  = [];      // active orders
  let teamScore   = 0;
  let timeLeftMs  = GAME_DURATION_MS;
  let lastTickAt  = null;
  let orderAccum  = 0;
  let over        = false;
  let won         = false;
  let tasksCompleted = 0;
  let ordersFilled   = 0;
  let ordersExpired  = 0;

  // ── Player management ───────────────────────────────────────────────────

  function addPlayer(id, name) {
    if (players.length >= MAX_PLAYERS) return null;
    const idx = players.length;
    const player = {
      id, name,
      color: PLAYER_COLORS[idx],
      emoji: PLAYER_EMOJIS[idx],
      score: 0,
      claimedTaskId: null,
      station: 'idle',        // current station for TV visualization
    };
    players.push(player);
    return player;
  }

  function removePlayer(id) {
    const idx = players.findIndex(p => p.id === id);
    if (idx !== -1) {
      const player = players[idx];
      // Release any claimed task
      _releasePlayerTask(player);
      players.splice(idx, 1);
    }
  }

  function getPlayer(id) { return players.find(p => p.id === id) || null; }

  // ── Task claiming ─────────────────────────────────────────────────────────
  // Players CHOOSE which task to work on from their phone

  function claimTask(playerId, taskId) {
    const player = getPlayer(playerId);
    if (!player || over) return { ok: false, reason: 'Not active' };

    // Can't claim if already working on something
    if (player.claimedTaskId) return { ok: false, reason: 'Already working on a task! Finish it first.' };

    // Find the task
    const { task, order } = _findTask(taskId);
    if (!task) return { ok: false, reason: 'Task not found' };
    if (task.status !== 'available') return { ok: false, reason: 'Task already taken' };

    // Claim it
    task.status = 'claimed';
    task.claimedBy = player.name;
    task.claimedColor = player.color;
    task.progress = 0;
    player.claimedTaskId = task.id;
    player.station = task.station;

    return {
      ok: true, action: 'task_claimed',
      task: _taskSnapshot(task),
      orderId: order.id,
      orderName: order.recipeName,
    };
  }

  // Release a player's current task (e.g. disconnect or cancel)
  function _releasePlayerTask(player) {
    if (!player.claimedTaskId) return;
    const { task } = _findTask(player.claimedTaskId);
    if (task && task.status === 'claimed') {
      task.status = 'available';
      task.claimedBy = null;
      task.claimedColor = null;
      task.progress = 0;
    }
    player.claimedTaskId = null;
    player.station = 'idle';
  }

  // ── Player actions (mini-game inputs) ─────────────────────────────────────

  function tapAction(playerId) {
    const player = getPlayer(playerId);
    if (!player || over) return { ok: false, reason: 'Not active' };
    const task = _getClaimedTask(player);
    if (!task) return { ok: false, reason: 'No claimed task' };
    if (task.type !== 'chopping') return { ok: false, reason: 'This task needs chopping, not tapping!' };

    task.progress++;
    if (task.progress >= task.targetTaps) {
      _completeTask(task, player);
      return { ok: true, action: 'task_completed', taskId: task.id };
    }
    return { ok: true, action: 'tap_registered', progress: task.progress, target: task.targetTaps };
  }

  function stirAction(playerId, circles) {
    const player = getPlayer(playerId);
    if (!player || over) return { ok: false, reason: 'Not active' };
    const task = _getClaimedTask(player);
    if (!task) return { ok: false, reason: 'No claimed task' };
    if (task.type !== 'stirring') return { ok: false, reason: 'This task needs stirring!' };

    task.progress = Math.min(task.targetCircles, task.progress + (circles || 1));
    if (task.progress >= task.targetCircles) {
      _completeTask(task, player);
      return { ok: true, action: 'task_completed', taskId: task.id };
    }
    return { ok: true, action: 'stir_registered', progress: task.progress, target: task.targetCircles };
  }

  function flipAction(playerId, timing) {
    const player = getPlayer(playerId);
    if (!player || over) return { ok: false, reason: 'Not active' };
    const task = _getClaimedTask(player);
    if (!task) return { ok: false, reason: 'No claimed task' };
    if (task.type !== 'flipping') return { ok: false, reason: 'This task needs flipping!' };

    // Green zone is 0.35 - 0.65
    const inGreen = timing >= 0.35 && timing <= 0.65;
    if (inGreen) {
      _completeTask(task, player);
      return { ok: true, action: 'task_completed', result: 'perfect', taskId: task.id };
    } else {
      return { ok: true, action: 'flip_missed', result: 'miss' };
    }
  }

  function _getClaimedTask(player) {
    if (!player.claimedTaskId) return null;
    const { task } = _findTask(player.claimedTaskId);
    return (task && task.status === 'claimed') ? task : null;
  }

  function _findTask(taskId) {
    for (const order of orders) {
      for (const task of order.tasks) {
        if (task.id === taskId) return { task, order };
      }
    }
    return { task: null, order: null };
  }

  function _completeTask(task, player) {
    task.status = 'completed';
    tasksCompleted++;
    player.score += 10;
    player.claimedTaskId = null;
    player.station = 'idle';

    // Check if all tasks in the order are done
    for (const order of orders) {
      if (order.tasks.some(t => t.id === task.id)) {
        const allDone = order.tasks.every(t => t.status === 'completed');
        if (allDone) {
          order.status = 'completed';
          teamScore += order.points;
          ordersFilled++;
          // Check win condition
          if (ordersFilled >= TARGET_ORDERS) {
            won = true;
            over = true;
          }
        }
        break;
      }
    }
  }

  // ── Order management ──────────────────────────────────────────────────────

  function _spawnOrder() {
    const diff = getDifficulty(ordersFilled, GAME_DURATION_MS - timeLeftMs);
    if (orders.length >= diff.maxOrders || players.length === 0) return;

    // Early game: prefer simpler recipes (Pancake, Burger), later: all recipes
    let pool = RECIPES;
    if (ordersFilled < 2) {
      pool = RECIPES.filter(r => r.name === 'Pancake' || r.name === 'Burger');
    } else if (ordersFilled < 4) {
      pool = RECIPES.filter(r => r.name !== 'Sushi'); // Sushi is hardest
    }

    const recipe = pickRandom(pool);
    const orderId = ++_orderIdSeq;

    // ALL tasks start as 'available' — players choose which to claim
    // Difficulty scales task targets
    const tasks = recipe.steps.map((stepKey) => {
      const taskDef = TASK_TYPES[stepKey];
      return {
        id: ++_taskIdSeq,
        taskKey: stepKey,
        type: taskDef.type,
        label: taskDef.label,
        emoji: taskDef.emoji,
        station: taskDef.station,
        targetTaps: Math.round((taskDef.targetTaps || 0) * diff.tapMult),
        targetCircles: Math.round((taskDef.targetCircles || 0) * diff.circleMult),
        status: 'available', // available → claimed → completed
        claimedBy: null,
        claimedColor: null,
        progress: 0,
      };
    });

    const lifetime = diff.orderLifetime;
    orders.push({
      id: orderId,
      recipeName: recipe.name,
      emoji: recipe.emoji,
      points: recipe.points,
      tasks,
      timeLeft: lifetime,
      maxTime: lifetime,
      status: 'active',
    });
  }

  // ── Game tick (call every ~200ms) ─────────────────────────────────────────

  function tick() {
    if (over) return;
    const now = Date.now();
    if (lastTickAt === null) {
      lastTickAt = now;
      // Spawn initial orders
      while (orders.length < 2 && players.length > 0) _spawnOrder();
      return;
    }
    const dt = now - lastTickAt;
    lastTickAt = now;

    // Game timer
    timeLeftMs -= dt;
    if (timeLeftMs <= 0) { timeLeftMs = 0; over = true; return; }

    // Order timers & expiry
    for (let i = orders.length - 1; i >= 0; i--) {
      const order = orders[i];
      if (order.status !== 'active') continue;
      order.timeLeft -= dt;
      if (order.timeLeft <= 0) {
        order.status = 'expired';
        // Release any claimed tasks for this order
        for (const task of order.tasks) {
          if (task.claimedBy) {
            const p = players.find(pl => pl.name === task.claimedBy);
            if (p) { p.claimedTaskId = null; p.station = 'idle'; }
          }
        }
        orders.splice(i, 1);
        teamScore = Math.max(0, teamScore - SCORE_PENALTY);
        ordersExpired++;
      }
    }

    // Remove completed orders (keep briefly for animation, then remove)
    for (let i = orders.length - 1; i >= 0; i--) {
      if (orders[i].status === 'completed') {
        orders.splice(i, 1);
      }
    }

    // Spawn new orders (interval based on difficulty)
    const diff = getDifficulty(ordersFilled, GAME_DURATION_MS - timeLeftMs);
    orderAccum += dt;
    if (orderAccum >= diff.orderInterval && orders.length < diff.maxOrders && players.length > 0) {
      _spawnOrder();
      orderAccum = 0;
    }
  }

  // ── State snapshots ───────────────────────────────────────────────────────

  function _taskSnapshot(t) {
    return {
      id: t.id, taskKey: t.taskKey, type: t.type, label: t.label,
      emoji: t.emoji, station: t.station,
      targetTaps: t.targetTaps, targetCircles: t.targetCircles,
      status: t.status, progress: t.progress,
      claimedBy: t.claimedBy, claimedColor: t.claimedColor,
    };
  }

  function _generateChefHint() {
    const activeOrders = orders.filter(o => o.status === 'active');
    if (!activeOrders.length) return { text: 'Waiting for customers…', urgent: false };

    // Find most urgent order
    let mostUrgent = null;
    let lowestFrac = 1;
    for (const o of activeOrders) {
      const frac = o.timeLeft / o.maxTime;
      if (frac < lowestFrac) { lowestFrac = frac; mostUrgent = o; }
    }

    // Find unclaimed tasks across all orders
    const unclaimed = [];
    for (const o of activeOrders) {
      for (const t of o.tasks) {
        if (t.status === 'available') unclaimed.push({ task: t, order: o });
      }
    }

    // Count idle players
    const idlePlayers = players.filter(p => !p.claimedTaskId);

    // Urgent order warning
    if (mostUrgent && lowestFrac < 0.25) {
      const need = mostUrgent.tasks.filter(t => t.status === 'available');
      if (need.length) {
        return {
          text: `⚠️ ${mostUrgent.emoji} ${mostUrgent.recipeName} almost expired! Need ${need.map(t => t.emoji).join(' ')}`,
          urgent: true, targetOrder: mostUrgent.id,
        };
      }
      const inProg = mostUrgent.tasks.filter(t => t.status === 'claimed');
      if (inProg.length) {
        return {
          text: `⏰ Hurry! ${mostUrgent.emoji} ${mostUrgent.recipeName} running out of time!`,
          urgent: true, targetOrder: mostUrgent.id,
        };
      }
    }

    // Idle players + unclaimed tasks = suggest specific assignments
    if (idlePlayers.length > 0 && unclaimed.length > 0) {
      const pick = unclaimed[0];
      const stationName = pick.task.station === 'chop' ? 'Chopping' : pick.task.station === 'stove' ? 'Stove' : 'Plating';
      return {
        text: `👨‍🍳 ${pick.task.emoji} ${pick.task.label} needed for ${pick.order.emoji} ${pick.order.recipeName}! Head to ${stationName}!`,
        urgent: false, targetOrder: pick.order.id,
      };
    }

    // Everyone busy — encouragement
    if (idlePlayers.length === 0 && players.length > 0) {
      return { text: '🔥 Great teamwork! Keep it up chefs!', urgent: false };
    }

    // Default
    if (unclaimed.length > 0) {
      return { text: `📋 ${unclaimed.length} task${unclaimed.length > 1 ? 's' : ''} waiting! Check the tables!`, urgent: false };
    }
    return { text: '👨‍🍳 Looking good! Waiting for new orders…', urgent: false };
  }

  function state() {
    const diff = getDifficulty(ordersFilled, GAME_DURATION_MS - timeLeftMs);
    return {
      players: players.map(p => ({
        id: p.id, name: p.name, color: p.color, emoji: p.emoji,
        score: p.score, station: p.station,
        busy: !!p.claimedTaskId,
        claimedTaskId: p.claimedTaskId,
      })),
      orders: orders.filter(o => o.status === 'active').map(o => ({
        id: o.id, recipeName: o.recipeName, emoji: o.emoji, points: o.points,
        timeLeft: Math.max(0, o.timeLeft), maxTime: o.maxTime,
        tasks: o.tasks.map(_taskSnapshot),
      })),
      score: teamScore,
      timeLeftMs: Math.max(0, timeLeftMs),
      over,
      won,
      goal: TARGET_ORDERS,
      stats: { tasksCompleted, ordersFilled, ordersExpired },
      stations: STATIONS,
      difficulty: diff.label,
      chefHint: _generateChefHint(),
    };
  }

  // Personal state for a player's phone — includes available tasks they can claim
  function playerState(playerId) {
    const p = getPlayer(playerId);
    if (!p) return null;

    // Get the task they're currently working on
    let currentTask = null;
    if (p.claimedTaskId) {
      const { task, order } = _findTask(p.claimedTaskId);
      if (task && task.status === 'claimed') {
        currentTask = {
          ..._taskSnapshot(task),
          orderName: order.recipeName,
          orderEmoji: order.emoji,
        };
      } else {
        // Task was removed (order expired) — clear claim
        p.claimedTaskId = null;
        p.station = 'idle';
      }
    }

    // Get all available (unclaimed) tasks across all orders
    const availableTasks = [];
    for (const order of orders) {
      if (order.status !== 'active') continue;
      for (const task of order.tasks) {
        if (task.status === 'available') {
          availableTasks.push({
            ..._taskSnapshot(task),
            orderId: order.id,
            orderName: order.recipeName,
            orderEmoji: order.emoji,
          });
        }
      }
    }

    return {
      id: p.id, name: p.name, color: p.color, emoji: p.emoji,
      score: p.score, station: p.station,
      currentTask,
      availableTasks,
    };
  }

  return {
    addPlayer, removePlayer, getPlayer,
    claimTask, tapAction, stirAction, flipAction,
    tick, state, playerState,
    get players() { return players; },
    get over() { return over; },
  };
}

module.exports = { createGame, PLAYER_COLORS, PLAYER_EMOJIS, RECIPES, TASK_TYPES, STATIONS, TARGET_ORDERS, getDifficulty };
