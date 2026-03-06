'use strict';

/**
 * Multiplayer Cooking Game Engine — Task-Based
 *
 * TV = Master Display showing 4 active orders + task assignments.
 * Phones = Personal Workstations receiving specific mini-game tasks.
 *
 * Task types:
 *   chopping  — rapid tap (target: 20 taps)
 *   stirring  — circular swipe (target: 8 circles)
 *   flipping  — timed QTE (tap when bar is in green zone)
 *
 * Orders are multi-step recipes composed of tasks assigned to specific players.
 *
 * Recipes:
 *   Burger   = Chop Onions + Grill Patty + Assemble          → 100pts
 *   Sushi    = Chop Fish   + Prepare Rice + Roll              → 120pts
 *   Pasta    = Chop Veggies + Stir Sauce + Plate              → 110pts
 *   Pancake  = Stir Batter  + Flip Pancake + Plate            → 90pts
 *
 * Gameplay loop:
 *   1. Orders appear on TV with assigned tasks per player
 *   2. Phone receives a specific task with a mini-game
 *   3. Player completes mini-game → task done
 *   4. When all tasks for an order are done → order served → points
 *   5. If order timer expires → penalty
 */

const GAME_DURATION_MS = 180_000; // 3 minutes
const ORDER_INTERVAL_MS = 15_000; // new order every 15s
const ORDER_LIFETIME_MS = 60_000; // each order lasts 60s
const MAX_ORDERS = 4;
const MAX_PLAYERS = 4;
const SCORE_PENALTY = 30;
const TASK_TIMEOUT_MS = 20_000; // individual task timeout

// ── Task definitions ────────────────────────────────────────────────────────

const TASK_TYPES = {
  chop_onions:    { type: 'chopping', label: 'Chop Onions',   emoji: '🧅', targetTaps: 20, timeMs: 12_000 },
  chop_fish:      { type: 'chopping', label: 'Chop Fish',     emoji: '🐟', targetTaps: 15, timeMs: 10_000 },
  chop_veggies:   { type: 'chopping', label: 'Chop Veggies',  emoji: '🥦', targetTaps: 18, timeMs: 11_000 },
  grill_patty:    { type: 'flipping', label: 'Grill Patty',   emoji: '🥩', timeMs: 8_000 },
  prepare_rice:   { type: 'stirring', label: 'Prepare Rice',  emoji: '🍚', targetCircles: 8, timeMs: 10_000 },
  stir_sauce:     { type: 'stirring', label: 'Stir Sauce',    emoji: '🍅', targetCircles: 10, timeMs: 12_000 },
  stir_batter:    { type: 'stirring', label: 'Stir Batter',   emoji: '🥣', targetCircles: 8, timeMs: 10_000 },
  flip_pancake:   { type: 'flipping', label: 'Flip Pancake',  emoji: '🥞', timeMs: 6_000 },
  roll_sushi:     { type: 'flipping', label: 'Roll Sushi',    emoji: '🍣', timeMs: 8_000 },
  assemble:       { type: 'flipping', label: 'Assemble Burger', emoji: '🍔', timeMs: 7_000 },
  plate_pasta:    { type: 'flipping', label: 'Plate Pasta',   emoji: '🍝', timeMs: 6_000 },
  plate_pancake:  { type: 'flipping', label: 'Plate Pancake', emoji: '🥞', timeMs: 6_000 },
};

// ── Recipes ─────────────────────────────────────────────────────────────────

const RECIPES = [
  {
    name: 'Burger', emoji: '🍔', points: 100,
    steps: ['chop_onions', 'grill_patty', 'assemble'],
  },
  {
    name: 'Sushi', emoji: '🍣', points: 120,
    steps: ['chop_fish', 'prepare_rice', 'roll_sushi'],
  },
  {
    name: 'Pasta', emoji: '🍝', points: 110,
    steps: ['chop_veggies', 'stir_sauce', 'plate_pasta'],
  },
  {
    name: 'Pancake', emoji: '🥞', points: 90,
    steps: ['stir_batter', 'flip_pancake', 'plate_pancake'],
  },
];

const PLAYER_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12'];

// ── Helpers ─────────────────────────────────────────────────────────────────

let _orderIdSeq = 0;
let _taskIdSeq  = 0;

function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ── Engine factory ──────────────────────────────────────────────────────────

function createGame() {
  const players = [];      // { id, name, color, score, currentTask }
  const orders  = [];      // active orders
  let teamScore   = 0;
  let timeLeftMs  = GAME_DURATION_MS;
  let lastTickAt  = null;
  let orderAccum  = 0;
  let over        = false;
  let tasksCompleted = 0;
  let ordersFilled   = 0;
  let ordersExpired  = 0;

  // Note: initial orders are spawned on first tick (after players are added)

  // ── Player management ───────────────────────────────────────────────────

  function addPlayer(id, name) {
    if (players.length >= MAX_PLAYERS) return null;
    const idx = players.length;
    const color = PLAYER_COLORS[idx];
    const player = { id, name, color, score: 0, currentTask: null };
    players.push(player);
    return player;
  }

  function removePlayer(id) {
    const idx = players.findIndex(p => p.id === id);
    if (idx !== -1) {
      // Unassign any tasks belonging to this player
      const player = players[idx];
      for (const order of orders) {
        for (const task of order.tasks) {
          if (task.assignedTo === player.name && task.status === 'active') {
            task.status = 'pending';
            task.assignedTo = null;
          }
        }
      }
      players.splice(idx, 1);
    }
  }

  function getPlayer(id) { return players.find(p => p.id === id) || null; }

  // ── Order & Task management ─────────────────────────────────────────────

  function _spawnOrder() {
    if (orders.length >= MAX_ORDERS || players.length === 0) return;
    const recipe = pickRandom(RECIPES);
    const orderId = ++_orderIdSeq;

    // Create tasks from recipe steps and assign to players round-robin
    const tasks = recipe.steps.map((stepKey, i) => {
      const taskDef = TASK_TYPES[stepKey];
      // Assign tasks to different players (round-robin across available players)
      const assignee = players.length > 0 ? players[i % players.length] : null;
      return {
        id: ++_taskIdSeq,
        taskKey: stepKey,
        type: taskDef.type,
        label: taskDef.label,
        emoji: taskDef.emoji,
        targetTaps: taskDef.targetTaps || 0,
        targetCircles: taskDef.targetCircles || 0,
        timeMs: taskDef.timeMs,
        assignedTo: assignee ? assignee.name : null,
        assignedColor: assignee ? assignee.color : null,
        status: 'pending', // pending → active → completed | failed
        progress: 0,       // taps or circles completed
        startedAt: null,
        // For flipping QTE
        qteWindowStart: null,
        qteWindowEnd: null,
        qteResult: null,
      };
    });

    // First task starts as active
    if (tasks.length > 0) {
      tasks[0].status = 'active';
    }

    orders.push({
      id: orderId,
      recipeName: recipe.name,
      emoji: recipe.emoji,
      points: recipe.points,
      tasks,
      timeLeft: ORDER_LIFETIME_MS,
      maxTime: ORDER_LIFETIME_MS,
      status: 'active', // active → completed | expired
    });
  }

  // Check if order's current active task is done and advance
  function _advanceOrder(order) {
    const currentIdx = order.tasks.findIndex(t => t.status === 'active');
    if (currentIdx === -1) return;

    const current = order.tasks[currentIdx];
    if (current.status !== 'completed') return;

    // Move to next task
    const nextIdx = currentIdx + 1;
    if (nextIdx < order.tasks.length) {
      order.tasks[nextIdx].status = 'active';
    } else {
      // All tasks done — order complete!
      order.status = 'completed';
      teamScore += order.points;
      ordersFilled++;
    }
  }

  // Assign waiting tasks when players become free
  function _reassignTasks() {
    for (const order of orders) {
      if (order.status !== 'active') continue;
      for (const task of order.tasks) {
        if (task.status !== 'active') continue;
        if (task.assignedTo) {
          // Check if assigned player still exists
          const p = players.find(pl => pl.name === task.assignedTo);
          if (!p) {
            // Re-assign to someone free
            const free = players.find(pl => !pl.currentTask);
            if (free) {
              task.assignedTo = free.name;
              task.assignedColor = free.color;
            }
          }
        }
      }
    }
  }

  // ── Player actions (mini-game inputs) ───────────────────────────────────

  // Called when player taps (for chopping)
  function tapAction(playerId) {
    const player = getPlayer(playerId);
    if (!player || over) return { ok: false, reason: 'Not active' };

    const task = _getActiveTaskForPlayer(player.name);
    if (!task) return { ok: false, reason: 'No active task' };
    if (task.type !== 'chopping') return { ok: false, reason: 'Wrong action for this task' };

    task.progress++;
    if (task.progress >= task.targetTaps) {
      _completeTask(task, player);
      return { ok: true, action: 'task_completed', taskId: task.id };
    }
    return { ok: true, action: 'tap_registered', progress: task.progress, target: task.targetTaps };
  }

  // Called for stirring progress (circular motion)
  function stirAction(playerId, circles) {
    const player = getPlayer(playerId);
    if (!player || over) return { ok: false, reason: 'Not active' };

    const task = _getActiveTaskForPlayer(player.name);
    if (!task) return { ok: false, reason: 'No active task' };
    if (task.type !== 'stirring') return { ok: false, reason: 'Wrong action for this task' };

    task.progress = Math.min(task.targetCircles, task.progress + (circles || 1));
    if (task.progress >= task.targetCircles) {
      _completeTask(task, player);
      return { ok: true, action: 'task_completed', taskId: task.id };
    }
    return { ok: true, action: 'stir_registered', progress: task.progress, target: task.targetCircles };
  }

  // Called for flipping QTE (player taps at the right moment)
  function flipAction(playerId, timing) {
    const player = getPlayer(playerId);
    if (!player || over) return { ok: false, reason: 'Not active' };

    const task = _getActiveTaskForPlayer(player.name);
    if (!task) return { ok: false, reason: 'No active task' };
    if (task.type !== 'flipping') return { ok: false, reason: 'Wrong action for this task' };

    // timing is a value 0-1 representing where the bar was when tapped
    // Green zone is 0.4 - 0.6
    const inGreen = timing >= 0.35 && timing <= 0.65;
    if (inGreen) {
      _completeTask(task, player);
      return { ok: true, action: 'task_completed', result: 'perfect', taskId: task.id };
    } else {
      // Failed flip — player can retry
      task.progress = 0; // reset
      return { ok: true, action: 'flip_missed', result: 'miss' };
    }
  }

  function _getActiveTaskForPlayer(playerName) {
    for (const order of orders) {
      if (order.status !== 'active') continue;
      for (const task of order.tasks) {
        if (task.status === 'active' && task.assignedTo === playerName) {
          return task;
        }
      }
    }
    return null;
  }

  function _completeTask(task, player) {
    task.status = 'completed';
    tasksCompleted++;
    player.score += 10; // bonus per task

    // Find the order this task belongs to and advance
    for (const order of orders) {
      const idx = order.tasks.findIndex(t => t.id === task.id);
      if (idx !== -1) {
        _advanceOrder(order);
        break;
      }
    }
  }

  // ── Game tick (call every ~200ms) ───────────────────────────────────────

  function tick() {
    if (over) return;
    const now = Date.now();
    if (lastTickAt === null) {
      lastTickAt = now;
      // Spawn initial orders now that players are registered
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
        orders.splice(i, 1);
        teamScore = Math.max(0, teamScore - SCORE_PENALTY);
        ordersExpired++;
      }
    }

    // Remove completed orders
    for (let i = orders.length - 1; i >= 0; i--) {
      if (orders[i].status === 'completed') {
        orders.splice(i, 1);
      }
    }

    // Spawn new orders
    orderAccum += dt;
    if (orderAccum >= ORDER_INTERVAL_MS && orders.length < MAX_ORDERS && players.length > 0) {
      _spawnOrder();
      orderAccum = 0;
    }

    _reassignTasks();
  }

  // ── State snapshots ─────────────────────────────────────────────────────

  function state() {
    return {
      players: players.map(p => ({
        id:    p.id,
        name:  p.name,
        color: p.color,
        score: p.score,
        hasTask: !!_getActiveTaskForPlayer(p.name),
        taskLabel: _getActiveTaskForPlayer(p.name)?.label || null,
        taskEmoji: _getActiveTaskForPlayer(p.name)?.emoji || null,
      })),
      orders: orders.filter(o => o.status === 'active').map(o => ({
        id:         o.id,
        recipeName: o.recipeName,
        emoji:      o.emoji,
        points:     o.points,
        timeLeft:   Math.max(0, o.timeLeft),
        maxTime:    o.maxTime,
        tasks: o.tasks.map(t => ({
          id:            t.id,
          label:         t.label,
          emoji:         t.emoji,
          type:          t.type,
          assignedTo:    t.assignedTo,
          assignedColor: t.assignedColor,
          status:        t.status,
          progress:      t.progress,
          targetTaps:    t.targetTaps,
          targetCircles: t.targetCircles,
        })),
      })),
      score:      teamScore,
      timeLeftMs: Math.max(0, timeLeftMs),
      over,
      stats: { tasksCompleted, ordersFilled, ordersExpired },
    };
  }

  // Personal state for a single player's phone
  function playerState(playerId) {
    const p = getPlayer(playerId);
    if (!p) return null;

    const task = _getActiveTaskForPlayer(p.name);
    return {
      id:    p.id,
      name:  p.name,
      color: p.color,
      score: p.score,
      task: task ? {
        id:            task.id,
        taskKey:       task.taskKey,
        type:          task.type,
        label:         task.label,
        emoji:         task.emoji,
        targetTaps:    task.targetTaps,
        targetCircles: task.targetCircles,
        timeMs:        task.timeMs,
        progress:      task.progress,
        status:        task.status,
      } : null,
    };
  }

  return {
    addPlayer, removePlayer, getPlayer,
    tapAction, stirAction, flipAction,
    tick, state, playerState,
    get players() { return players; },
    get over() { return over; },
  };
}

module.exports = { createGame, PLAYER_COLORS, RECIPES, TASK_TYPES };
