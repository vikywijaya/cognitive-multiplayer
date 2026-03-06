'use strict';

/**
 * Server-side Cooking Game engine (Overcooked-style).
 *
 * Kitchen: 10-col × 7-row grid.
 * Top row (row 1) and bottom row (row 5) are station tiles.
 * Rows 2-4 are walkable floor.
 *
 * Item state machine:
 *   lettuce_raw → (wash) → lettuce_washed → (chop) → lettuce_chopped
 *   tomato_raw  → (wash) → tomato_washed  → (chop) → tomato_chopped
 *   potato_raw  → (wash) → potato_washed  → (stove 8s) → potato_cooked → (15s) → potato_burnt
 *
 * Recipes:
 *   Salad      = lettuce_chopped + tomato_chopped  → 100pts
 *   Potato Soup = potato_cooked  + tomato_chopped  → 150pts
 */

const COLS = 10;
const ROWS = 7;
const GAME_DURATION_MS = 180_000; // 3 minutes
const COOK_MS = 8_000;            // potato cooks in 8s
const BURN_EXTRA_MS = 15_000;     // burns 15s after cooked
const ORDER_INTERVAL_MS = 22_000; // new order every 22s
const ORDER_LIFETIME_MS = 65_000;
const MAX_ORDERS = 4;
const MAX_PLAYERS = 4;
const SCORE_PENALTY = 50;

const T = {
  WALL:          'W',
  FLOOR:         'F',
  LETTUCE_SHELF: 'LS',
  POTATO_SHELF:  'PS',
  TOMATO_SHELF:  'TS',
  SINK:          'SK',
  CUTTING_BOARD: 'CB',
  STOVE:         'ST',
  COUNTER:       'CT',
  SERVE:         'SW',
};

// MAP[row][col]
const MAP = [
  ['W','W', 'W', 'W', 'W', 'W', 'W', 'W', 'W','W'],  // row 0 – top wall
  ['W','LS','PS','TS','SK','CB','ST','CT','SW','W'],    // row 1 – top stations
  ['W','F', 'F', 'F', 'F', 'F', 'F', 'F', 'F', 'W'],  // row 2 – floor
  ['W','F', 'F', 'F', 'F', 'F', 'F', 'F', 'F', 'W'],  // row 3 – floor
  ['W','F', 'F', 'F', 'F', 'F', 'F', 'F', 'F', 'W'],  // row 4 – floor
  ['W','CT','CT','SK','CB','ST','CT','CT','SW','W'],    // row 5 – bottom stations
  ['W','W', 'W', 'W', 'W', 'W', 'W', 'W', 'W','W'],   // row 6 – bottom wall
];

const PLAYER_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12'];

const PLAYER_STARTS = [
  { x: 2, y: 2 },
  { x: 7, y: 4 },
  { x: 7, y: 2 },
  { x: 2, y: 4 },
];

// Item display labels
const ITEM_LABELS = {
  lettuce_raw:     'Lettuce',
  lettuce_washed:  'Washed Lettuce',
  lettuce_chopped: 'Chopped Lettuce',
  tomato_raw:      'Tomato',
  tomato_washed:   'Washed Tomato',
  tomato_chopped:  'Chopped Tomato',
  potato_raw:      'Potato',
  potato_washed:   'Washed Potato',
  potato_cooking:  'Cooking…',
  potato_cooked:   'Cooked Potato',
  potato_burnt:    'Burnt! 🔥',
  salad:           'Salad',
  potato_soup:     'Potato Soup',
};

const ITEM_EMOJI = {
  lettuce_raw: '🥬', lettuce_washed: '🥬', lettuce_chopped: '🥗',
  tomato_raw: '🍅', tomato_washed: '🍅', tomato_chopped: '🍅',
  potato_raw: '🥔', potato_washed: '🥔', potato_cooking: '🍲',
  potato_cooked: '🥔', potato_burnt: '🫘',
  salad: '🥗', potato_soup: '🥣',
};

const RECIPES = [
  {
    name: 'Salad', emoji: '🥗',
    ingredients: ['lettuce_chopped', 'tomato_chopped'],
    result: 'salad', points: 100,
  },
  {
    name: 'Potato Soup', emoji: '🥣',
    ingredients: ['potato_cooked', 'tomato_chopped'],
    result: 'potato_soup', points: 150,
  },
];

// Items that count as completed dishes (can be served)
const DISH_ITEMS = new Set(['salad', 'potato_soup']);

// Items that need washing (input → washed output)
const WASH_MAP = {
  lettuce_raw: 'lettuce_washed',
  tomato_raw:  'tomato_washed',
  potato_raw:  'potato_washed',
};

// Items that need chopping (input → chopped output)
const CHOP_MAP = {
  lettuce_washed: 'lettuce_chopped',
  tomato_washed:  'tomato_chopped',
};

// Items that can be cooked on stove
const COOKABLE = new Set(['potato_washed']);

// ── Helpers ───────────────────────────────────────────────────────────────────

function getTile(x, y) {
  if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return T.WALL;
  return MAP[y][x];
}

function isFloor(x, y) { return getTile(x, y) === T.FLOOR; }

function tileKey(x, y) { return `${x},${y}`; }

function adjacentStations(x, y) {
  const result = [];
  for (const [dx, dy] of [[0,-1],[0,1],[-1,0],[1,0]]) {
    const nx = x + dx, ny = y + dy;
    const t = getTile(nx, ny);
    if (t !== T.FLOOR && t !== T.WALL) result.push({ x: nx, y: ny, tile: t });
  }
  return result;
}

function tryCombine(itemA, itemB) {
  for (const recipe of RECIPES) {
    const [i0, i1] = recipe.ingredients;
    if ((itemA === i0 && itemB === i1) || (itemA === i1 && itemB === i0)) {
      return recipe.result;
    }
  }
  return null;
}

// ── Engine factory ────────────────────────────────────────────────────────────

let _orderIdSeq = 0;

function createGame() {
  const players = [];        // { id, name, color, x, y, holding }
  const stations = new Map(); // tileKey → { item, cookStart, cooked, burnt }
  const orders = [];
  let score = 0;
  let timeLeftMs = GAME_DURATION_MS;
  let lastTickAt = null;
  let orderAccum = 0;
  let over = false;

  // Seed one order immediately
  orders.push(_makeOrder());

  // ── Player management ───────────────────────────────────────────────────────

  function addPlayer(id, name) {
    if (players.length >= MAX_PLAYERS) return null;
    const idx = players.length;
    const color = PLAYER_COLORS[idx];
    const start = PLAYER_STARTS[idx] || { x: 4, y: 3 };
    const player = { id, name, color, x: start.x, y: start.y, holding: null };
    players.push(player);
    return player;
  }

  function removePlayer(id) {
    const idx = players.findIndex(p => p.id === id);
    if (idx !== -1) players.splice(idx, 1);
  }

  function getPlayer(id) { return players.find(p => p.id === id) || null; }

  // ── Movement ────────────────────────────────────────────────────────────────

  function move(playerId, dir) {
    const p = getPlayer(playerId);
    if (!p || over) return false;
    const DIRS = { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0] };
    const d = DIRS[dir];
    if (!d) return false;
    const nx = p.x + d[0], ny = p.y + d[1];
    if (!isFloor(nx, ny)) return false;
    if (players.some(o => o.id !== playerId && o.x === nx && o.y === ny)) return false;
    p.x = nx;
    p.y = ny;
    return true;
  }

  // ── Action ──────────────────────────────────────────────────────────────────

  function action(playerId, stationX, stationY) {
    const p = getPlayer(playerId);
    if (!p || over) return { ok: false, reason: 'Game not active' };

    const adj = adjacentStations(p.x, p.y);
    if (!adj.some(s => s.x === stationX && s.y === stationY)) {
      return { ok: false, reason: 'Not adjacent' };
    }

    const tile = getTile(stationX, stationY);
    const key  = tileKey(stationX, stationY);
    const si   = stations.get(key);
    const held = p.holding;

    // ── No item held: try to pick up ──────────────────────────────────────────
    if (!held) {
      if (tile === T.LETTUCE_SHELF) { p.holding = 'lettuce_raw'; return { ok: true, action: 'pickup', item: p.holding }; }
      if (tile === T.TOMATO_SHELF)  { p.holding = 'tomato_raw';  return { ok: true, action: 'pickup', item: p.holding }; }
      if (tile === T.POTATO_SHELF)  { p.holding = 'potato_raw';  return { ok: true, action: 'pickup', item: p.holding }; }

      if (si && si.item) {
        if (tile === T.STOVE && si.cookStart && !si.cooked) {
          return { ok: false, reason: 'Still cooking' };
        }
        p.holding = si.item;
        stations.delete(key);
        return { ok: true, action: 'pickup', item: p.holding };
      }
      return { ok: false, reason: 'Nothing to pick up' };
    }

    // ── Holding an item ───────────────────────────────────────────────────────

    // Serve completed dish
    if (tile === T.SERVE) {
      if (!DISH_ITEMS.has(held)) return { ok: false, reason: 'Not a completed dish' };
      const idx = orders.findIndex(o => o.result === held);
      if (idx === -1) return { ok: false, reason: 'No order for this dish' };
      const order = orders.splice(idx, 1)[0];
      score += order.points;
      p.holding = null;
      return { ok: true, action: 'served', points: order.points, dish: held };
    }

    // Wash at sink
    if (tile === T.SINK) {
      const washed = WASH_MAP[held];
      if (!washed) return { ok: false, reason: `Can't wash ${held}` };
      p.holding = washed;
      return { ok: true, action: 'washed', item: p.holding };
    }

    // Chop at cutting board
    if (tile === T.CUTTING_BOARD) {
      const chopped = CHOP_MAP[held];
      if (!chopped) return { ok: false, reason: `Can't chop ${held}` };
      p.holding = chopped;
      return { ok: true, action: 'chopped', item: p.holding };
    }

    // Place on stove to cook
    if (tile === T.STOVE) {
      if (si && si.item) return { ok: false, reason: 'Stove occupied' };
      if (!COOKABLE.has(held)) return { ok: false, reason: `Can't cook ${held}` };
      stations.set(key, { item: 'potato_cooking', cookStart: Date.now(), cooked: false, burnt: false });
      p.holding = null;
      return { ok: true, action: 'cooking_started' };
    }

    // Put down on counter (or combine)
    if (tile === T.COUNTER) {
      if (si && si.item) {
        const combined = tryCombine(si.item, held);
        if (combined) {
          stations.set(key, { item: combined });
          p.holding = null;
          return { ok: true, action: 'combined', result: combined };
        }
        // Swap: pick up what's there, put down what's held
        const prev = si.item;
        stations.set(key, { item: held });
        p.holding = prev;
        return { ok: true, action: 'swapped', putDown: held, pickedUp: prev };
      }
      stations.set(key, { item: held });
      p.holding = null;
      return { ok: true, action: 'put_down', item: held };
    }

    return { ok: false, reason: 'No valid action here' };
  }

  // ── Game tick (call every ~200ms) ─────────────────────────────────────────

  function tick() {
    if (over) return;
    const now = Date.now();
    if (lastTickAt === null) { lastTickAt = now; return; }
    const dt = now - lastTickAt;
    lastTickAt = now;

    // Game timer
    timeLeftMs -= dt;
    if (timeLeftMs <= 0) { timeLeftMs = 0; over = true; return; }

    // Order timers & expiry
    for (let i = orders.length - 1; i >= 0; i--) {
      orders[i].timeLeft -= dt;
      if (orders[i].timeLeft <= 0) {
        orders.splice(i, 1);
        score = Math.max(0, score - SCORE_PENALTY);
      }
    }

    // Spawn new orders
    orderAccum += dt;
    if (orderAccum >= ORDER_INTERVAL_MS && orders.length < MAX_ORDERS) {
      orders.push(_makeOrder());
      orderAccum = 0;
    }

    // Stove cooking
    for (const [, si] of stations) {
      if (si.item === 'potato_cooking' && si.cookStart) {
        const elapsed = now - si.cookStart;
        if (elapsed >= COOK_MS + BURN_EXTRA_MS) {
          si.item = 'potato_burnt';
          si.cooked = true;
          si.burnt = true;
        } else if (elapsed >= COOK_MS && !si.cooked) {
          si.item = 'potato_cooked';
          si.cooked = true;
        }
      }
    }
  }

  // ── State snapshot ────────────────────────────────────────────────────────

  function getAvailableActions(player) {
    if (!player || over) return [];
    const adj = adjacentStations(player.x, player.y);
    const actions = [];
    for (const { x, y, tile } of adj) {
      const key = tileKey(x, y);
      const si  = stations.get(key);
      const held = player.holding;

      if (!held) {
        if (tile === T.LETTUCE_SHELF) actions.push({ stationX: x, stationY: y, label: 'Pick up Lettuce 🥬', tile });
        else if (tile === T.TOMATO_SHELF) actions.push({ stationX: x, stationY: y, label: 'Pick up Tomato 🍅', tile });
        else if (tile === T.POTATO_SHELF) actions.push({ stationX: x, stationY: y, label: 'Pick up Potato 🥔', tile });
        else if ((tile === T.COUNTER || tile === T.STOVE || tile === T.SINK || tile === T.CUTTING_BOARD) && si && si.item) {
          if (tile === T.STOVE && si.cookStart && !si.cooked) {
            const elapsed = Date.now() - si.cookStart;
            const pct = Math.min(100, Math.round(elapsed / COOK_MS * 100));
            actions.push({ stationX: x, stationY: y, label: `Cooking… ${pct}%`, tile, disabled: true });
          } else {
            const emoji = ITEM_EMOJI[si.item] || '📦';
            const lbl   = ITEM_LABELS[si.item] || si.item;
            actions.push({ stationX: x, stationY: y, label: `Pick up ${emoji} ${lbl}`, tile });
          }
        }
      } else {
        // Holding an item
        if (tile === T.SERVE && DISH_ITEMS.has(held)) {
          actions.push({ stationX: x, stationY: y, label: `🍽️ SERVE ${ITEM_LABELS[held] || held}!`, tile, primary: true });
        } else if (tile === T.SINK && WASH_MAP[held]) {
          actions.push({ stationX: x, stationY: y, label: `🚿 Wash ${ITEM_LABELS[held] || held}`, tile });
        } else if (tile === T.CUTTING_BOARD && CHOP_MAP[held]) {
          actions.push({ stationX: x, stationY: y, label: `🔪 Chop ${ITEM_LABELS[held] || held}`, tile });
        } else if (tile === T.STOVE && COOKABLE.has(held) && (!si || !si.item)) {
          actions.push({ stationX: x, stationY: y, label: `🔥 Cook ${ITEM_LABELS[held] || held}`, tile });
        } else if (tile === T.COUNTER) {
          if (si && si.item) {
            const combined = tryCombine(si.item, held);
            if (combined) {
              actions.push({ stationX: x, stationY: y, label: `🍽️ Combine → ${ITEM_LABELS[combined] || combined}`, tile, primary: true });
            } else {
              actions.push({ stationX: x, stationY: y, label: `↔️ Swap with ${ITEM_EMOJI[si.item] || ''} ${ITEM_LABELS[si.item] || si.item}`, tile });
            }
          } else {
            actions.push({ stationX: x, stationY: y, label: `📥 Put down ${ITEM_LABELS[held] || held}`, tile });
          }
        }
      }
    }
    return actions;
  }

  function state() {
    const now = Date.now();
    return {
      map: MAP,
      cols: COLS,
      rows: ROWS,
      players: players.map(p => ({
        id:      p.id,
        name:    p.name,
        color:   p.color,
        x:       p.x,
        y:       p.y,
        holding: p.holding,
        holdingLabel: p.holding ? (ITEM_LABELS[p.holding] || p.holding) : null,
        holdingEmoji: p.holding ? (ITEM_EMOJI[p.holding]  || '📦')       : null,
      })),
      stations: Object.fromEntries(
        [...stations.entries()].map(([k, si]) => {
          const cookProgress = (si.cookStart && !si.burnt)
            ? Math.min(1, (now - si.cookStart) / COOK_MS)
            : null;
          return [k, {
            item:         si.item,
            label:        ITEM_LABELS[si.item] || si.item,
            emoji:        ITEM_EMOJI[si.item]  || '📦',
            cookProgress,
            cooked:       si.cooked || false,
            burnt:        si.burnt  || false,
          }];
        })
      ),
      orders: orders.map(o => ({
        id:         o.id,
        recipeName: o.recipeName,
        emoji:      o.emoji,
        timeLeft:   Math.max(0, o.timeLeft),
        maxTime:    o.maxTime,
        points:     o.points,
      })),
      score,
      timeLeftMs: Math.max(0, timeLeftMs),
      over,
    };
  }

  function playerState(playerId) {
    const p = getPlayer(playerId);
    if (!p) return null;
    return {
      id:           p.id,
      name:         p.name,
      color:        p.color,
      holding:      p.holding,
      holdingLabel: p.holding ? (ITEM_LABELS[p.holding] || p.holding) : null,
      holdingEmoji: p.holding ? (ITEM_EMOJI[p.holding]  || '📦')       : null,
      actions:      getAvailableActions(p),
    };
  }

  return { addPlayer, removePlayer, getPlayer, move, action, tick, state, playerState, get players() { return players; } };
}

function _makeOrder() {
  const recipe = RECIPES[Math.floor(Math.random() * RECIPES.length)];
  return {
    id:         ++_orderIdSeq,
    recipeName: recipe.name,
    emoji:      recipe.emoji,
    ingredients: recipe.ingredients.slice(),
    result:     recipe.result,
    points:     recipe.points,
    timeLeft:   ORDER_LIFETIME_MS,
    maxTime:    ORDER_LIFETIME_MS,
  };
}

module.exports = { createGame, MAP, COLS, ROWS, T, PLAYER_COLORS };
