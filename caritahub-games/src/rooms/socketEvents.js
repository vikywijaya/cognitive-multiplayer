'use strict';

const roomManager = require('./roomManager');
const { createGame: createXiangqiGame }    = require('../engine/xiangqi');
const { createGame: createChessGame }      = require('../engine/chess');
const { createGame: createChordaidiGame }  = require('../engine/chordaidi');
const { createGame: createBingoGame }      = require('../engine/bingo');
const { createGame: createBoggleGame }     = require('../engine/boggle');
const { createGame: createTriviaGame }     = require('../engine/singapore-trivia');
const { createGame: createDiffGame }       = require('../engine/spot-the-difference');
const { createGame: createRhythmGame }     = require('../engine/rhythm-tap');
const { createGame: createHigherLowerGame } = require('../engine/higher-lower');
const { createGame: createReversiGame }        = require('../engine/reversi');
const { createGame: createSnakesLaddersGame } = require('../engine/snakes-ladders');
const { createGame: createCookingGame }        = require('../engine/cooking');
const analytics = require('../analytics/clickhouse');
const leaderboard = require('../leaderboard');

// Active game engines per room
const engines = new Map();
// Game type per room ('xiangqi' | 'chess')
const roomGameTypes = new Map();

// Per-IP join rate limiter (max 10 new joins per minute; reconnects are exempt)
const joinCounts = new Map();
function checkJoinRate(ip) {
  const now = Date.now();
  const entry = joinCounts.get(ip) || { count: 0, resetAt: now + 60_000 };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + 60_000; }
  entry.count++;
  joinCounts.set(ip, entry);
  return entry.count <= 10;
}

function roomSnapshot(room) {
  return {
    players: room.players.map(p => ({ name: p.name, color: p.color, connected: p.socketId !== null })),
    spectators: room.spectators.map(s => s.name)
  };
}

function gameStatePayload(roomId, room, engine) {
  const isOver = engine.isGameOver();
  let winner = null;
  if (isOver) {
    // Chess engine exposes winner() directly (handles stalemate draw)
    if (typeof engine.winner === 'function') {
      winner = engine.winner();
    } else {
      // Xiangqi: losing side is the one whose turn it is at game over
      winner = engine.turn() === 'w' ? 'black' : 'red';
    }
  }
  return {
    fen: engine.fen(),
    turn: engine.turn(),   // 'w' | 'b'
    inCheck: engine.inCheck(),
    isGameOver: isOver,
    winner,
    players: room.players.map(p => ({ name: p.name, color: p.color, connected: p.socketId !== null }))
  };
}

// ── Chor Dai Di helpers ─────────────────────────────────────────────────────
const CDI_COLORS = ['south', 'west', 'north', 'east'];

function seatForColor(color) { return CDI_COLORS.indexOf(color); }

/** Build the per-player game_state payload (hides other players' cards). */
function chordaidiPayload(roomId, room, engine, myColor) {
  const gs  = engine.state();
  const mySeat = seatForColor(myColor);
  return {
    gameType: 'chordaidi',
    myHand:       mySeat >= 0 ? gs.hands[mySeat] : [],
    handCounts:   gs.hands.map(h => h.length),
    currentSeat:  gs.currentSeat,
    tableCombo:   gs.tableCombo,
    tableOwner:   gs.tableOwner,
    passCount:    gs.passCount,
    isGameOver:   gs.isGameOver,
    winner:       gs.winner,
    players: room.players.map((p, i) => ({
      name: p.name, color: p.color, connected: p.socketId !== null,
      seat: seatForColor(p.color)
    }))
  };
}

/** Broadcast personalised states to all 4 players. */
function broadcastCDI(io, roomId, room, engine) {
  room.players.forEach(p => {
    if (!p.socketId) return;
    io.to(p.socketId).emit('game_state', chordaidiPayload(roomId, room, engine, p.color));
  });
}

// ── Bingo helpers ────────────────────────────────────────────────────────────
const BINGO_COLORS = ['caller', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
const BINGO_COLUMNS = ['B', 'I', 'N', 'G', 'O'];

// ── TV Bingo helpers ─────────────────────────────────────────────────────────
const TV_BINGO_COLORS = ['tv-host', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
const bingoAutoTimers = new Map(); // roomId → intervalHandle

function seatForTvBingoColor(color) {
  if (color === 'tv-host') return -1;
  const idx = TV_BINGO_COLORS.indexOf(color);
  return idx > 0 ? idx - 1 : -1; // p1=0, p2=1, ..., p8=7
}

function tvBingoPayload(roomId, room, engine) {
  const gs = engine.state();
  return {
    gameType: 'tv-bingo',
    called:      gs.called,
    lastCalled:  gs.lastCalled,
    cards:       gs.cards,
    marked:      gs.marked,
    isGameOver:  gs.isGameOver,
    winners:     gs.winners,
    playerCount: gs.playerCount,
    autoCallInterval: 15,
    players: room.players
      .filter(p => p.color !== 'tv-host')
      .map(p => ({
        name: p.name,
        color: p.color,
        connected: p.socketId !== null,
        seat: seatForTvBingoColor(p.color)
      }))
  };
}

function handleTvBingoGameOver(io, roomId, room, engine) {
  const ws = engine.winners();
  const phonePlayers = room.players.filter(p => p.color !== 'tv-host');
  ws.forEach(w => {
    const wp = phonePlayers[w.seat];
    if (wp) leaderboard.recordWin('tv-bingo', wp.name);
  });
  const winNames = ws.map(w => {
    const wp = phonePlayers[w.seat];
    return wp?.name || '?';
  });
  io.to(roomId).emit('game_over', {
    winner: winNames.join(', '),
    reason: `BINGO! ${winNames.join(' & ')} won!`
  });
  engines.delete(roomId);
  roomGameTypes.delete(roomId);
  analytics.logEvent('game_ended', roomId, 'server', 'auto-caller', { winner: winNames.join(', '), gameType: 'tv-bingo' });
}

function seatForBingoColor(color) { return BINGO_COLORS.indexOf(color); }

function bingoPayload(roomId, room, engine) {
  const gs = engine.state();
  return {
    gameType: 'bingo',
    called:      gs.called,
    lastCalled:  gs.lastCalled,
    cards:       gs.cards,
    marked:      gs.marked,
    isGameOver:  gs.isGameOver,
    winners:     gs.winners,
    callerSeat:  gs.callerSeat,
    playerCount: gs.playerCount,
    players: room.players.map(p => ({
      name: p.name, color: p.color, connected: p.socketId !== null,
      seat: seatForBingoColor(p.color)
    }))
  };
}

function broadcastBingo(io, roomId, room, engine) {
  io.to(roomId).emit('game_state', bingoPayload(roomId, room, engine));
}

// ── Boggle helpers ───────────────────────────────────────────────────────────
const BOGGLE_COLORS = ['red', 'blue', 'green', 'purple'];

function seatForBoggleColor(color) { return BOGGLE_COLORS.indexOf(color); }

function bogglePayload(roomId, room, engine) {
  const gs = engine.state();
  return {
    gameType: 'boggle',
    board:              gs.board,
    timeLeft:           gs.timeLeft,
    startTime:          gs.startTime,
    roundSeconds:       gs.roundSeconds,
    submissionCounts:   gs.submissionCounts,
    isGameOver:         gs.isGameOver,
    scores:             gs.scores,
    words:              gs.words,
    playerCount:        gs.playerCount,
    players: room.players.map(p => ({
      name: p.name, color: p.color, connected: p.socketId !== null,
      seat: seatForBoggleColor(p.color)
    }))
  };
}

// Active server-side round timers
const boggleTimers = new Map(); // roomId → timeoutHandle

// ── Singapore Trivia helpers ──────────────────────────────────────────────────
const TRIVIA_COLORS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];

function seatForTriviaColor(color) { return TRIVIA_COLORS.indexOf(color); }

function triviaPayload(roomId, room, engine) {
  const gs = engine.state();
  return {
    ...gs,
    players: room.players.map(p => ({
      name: p.name, color: p.color, connected: p.socketId !== null,
      seat: seatForTriviaColor(p.color)
    }))
  };
}

// Active per-question auto-reveal timers
const triviaTimers = new Map(); // roomId → timeoutHandle

// ── Spot the Difference helpers ───────────────────────────────────────────────
const DIFF_COLORS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];

function seatForDiffColor(color) { return DIFF_COLORS.indexOf(color); }

function diffPayload(roomId, room, engine) {
  const gs = engine.state();
  return {
    ...gs,
    players: room.players.map(p => ({
      name: p.name, color: p.color, connected: p.socketId !== null,
      seat: seatForDiffColor(p.color)
    }))
  };
}

const diffTimers = new Map(); // roomId → timeoutHandle

// ── Rhythm Tap helpers ────────────────────────────────────────────────────────
const RHYTHM_COLORS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];

function seatForRhythmColor(color) { return RHYTHM_COLORS.indexOf(color); }

function rhythmPayload(roomId, room, engine) {
  const gs = engine.state();
  return {
    ...gs,
    players: room.players.map(p => ({
      name: p.name, color: p.color, connected: p.socketId !== null,
      seat: seatForRhythmColor(p.color)
    }))
  };
}

const rhythmTimers = new Map(); // roomId → timeoutHandle

// ── TV Higher or Lower helpers ──────────────────────────────────────────────
const TV_HL_COLORS = ['tv-host', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];

function seatForTvHlColor(color) {
  if (color === 'tv-host') return -1;
  const idx = TV_HL_COLORS.indexOf(color);
  return idx > 0 ? idx - 1 : -1; // p1=0, p2=1, ..., p8=7
}

function tvHlPayload(roomId, room, engine) {
  const gs = engine.state();
  return {
    gameType: 'tv-higher-lower',
    revealed:       gs.revealed,
    currentCard:    gs.currentCard,
    revealIndex:    gs.revealIndex,
    deckSize:       gs.deckSize,
    cardsRemaining: gs.cardsRemaining,
    alive:          gs.alive,
    currentSeat:    gs.currentSeat,
    lastGuess:      gs.lastGuess,
    isGameOver:     gs.isGameOver,
    winnerSeat:     gs.winnerSeat,
    playerCount:    gs.playerCount,
    players: room.players
      .filter(p => p.color !== 'tv-host')
      .map(p => ({
        name: p.name,
        color: p.color,
        connected: p.socketId !== null,
        seat: seatForTvHlColor(p.color)
      }))
  };
}

// ── TV Boggle helpers ────────────────────────────────────────────────────────
const TV_BOGGLE_COLORS = ['tv-host', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
const tvBoggleTimers = new Map(); // roomId → timeoutHandle

function seatForTvBoggleColor(color) {
  if (color === 'tv-host') return -1;
  const idx = TV_BOGGLE_COLORS.indexOf(color);
  return idx > 0 ? idx - 1 : -1; // p1=0, p2=1, ..., p8=7
}

function tvBogglePayload(roomId, room, engine) {
  const gs = engine.state();
  return {
    gameType: 'tv-boggle',
    board:            gs.board,
    timeLeft:         gs.timeLeft,
    startTime:        gs.startTime,
    roundSeconds:     gs.roundSeconds,
    submissionCounts: gs.submissionCounts,
    isGameOver:       gs.isGameOver,
    scores:           gs.scores,
    words:            gs.words,
    playerCount:      gs.playerCount,
    players: room.players
      .filter(p => p.color !== 'tv-host')
      .map(p => ({
        name: p.name,
        color: p.color,
        connected: p.socketId !== null,
        seat: seatForTvBoggleColor(p.color)
      }))
  };
}

// ── Snakes & Ladders helpers ──────────────────────────────────────────────────
const SL_COLORS = ['red', 'blue', 'green', 'purple', 'orange', 'cyan'];

function seatForSlColor(color) { return SL_COLORS.indexOf(color); }

function slPayload(roomId, room, engine) {
  const gs = engine.state();
  return {
    gameType:    'snakes-ladders',
    positions:   gs.positions,
    currentSeat: gs.currentSeat,
    isGameOver:  gs.isGameOver,
    winner:      gs.winner,
    lastRoll:    gs.lastRoll,
    lastEvent:   gs.lastEvent,
    playerCount: gs.playerCount,
    players: room.players.map(p => ({
      name: p.name, color: p.color, connected: p.socketId !== null,
      seat: seatForSlColor(p.color)
    }))
  };
}

// ── Cooking Game helpers ──────────────────────────────────────────────────────
const COOKING_COLORS = ['tv-host', 'cook1', 'cook2', 'cook3', 'cook4'];
const cookingTimers = new Map(); // roomId → intervalHandle

function cookingTick(io, roomId) {
  const engine = engines.get(roomId);
  const room   = roomManager.getRoom(roomId);
  if (!engine || !room) {
    clearInterval(cookingTimers.get(roomId));
    cookingTimers.delete(roomId);
    return;
  }
  engine.tick();
  const gs = engine.state();
  io.to(roomId).emit('cooking_state', gs);

  // Send personalised action lists to each connected player phone
  for (const rp of room.players) {
    if (rp.color === 'tv-host' || !rp.socketId) continue;
    const ps = engine.playerState(rp.name);
    if (ps) io.to(rp.socketId).emit('cooking_player_state', ps);
  }

  if (gs.over) {
    clearInterval(cookingTimers.get(roomId));
    cookingTimers.delete(roomId);
    io.to(roomId).emit('cooking_game_over', { score: gs.score });
    engines.delete(roomId);
    roomGameTypes.delete(roomId);
    analytics.logEvent('game_ended', roomId, 'server', 'timer', { score: gs.score, gameType: 'cooking' });
  }
}

// ── TV Reversi helpers ────────────────────────────────────────────────────────
const TV_REVERSI_COLORS = ['tv-host', 'black', 'white']; // tv-host = display, black moves first

function tvReversiPayload(roomId, room, engine) {
  const gs = engine.state();
  return {
    gameType:    'tv-reversi',
    board:       gs.board,
    turn:        gs.turn,
    validMoves:  gs.validMoves,
    discs:       gs.discs,
    isGameOver:  gs.isGameOver,
    winner:      gs.winner,
    skippedLast: gs.skippedLast,
    players: room.players
      .filter(p => p.color !== 'tv-host')
      .map(p => ({ name: p.name, color: p.color, connected: p.socketId !== null }))
  };
}

// ── Reversi helpers ──────────────────────────────────────────────────────────
const REVERSI_COLORS = ['black', 'white']; // black moves first

function reversiPayload(roomId, room, engine) {
  const gs = engine.state();
  return {
    gameType: 'reversi',
    board:       gs.board,
    turn:        gs.turn,        // 'B' | 'W'
    validMoves:  gs.validMoves,
    discs:       gs.discs,
    isGameOver:  gs.isGameOver,
    winner:      gs.winner,      // 'B' | 'W' | 'draw' | null
    skippedLast: gs.skippedLast,
    players: room.players.map(p => ({
      name: p.name, color: p.color, connected: p.socketId !== null
    }))
  };
}

module.exports = function wireEvents(io) {
  io.on('connection', socket => {
    console.log('connect', socket.id);

    // ── Ping/pong test ──────────────────────────────────────────────
    socket.on('ping', () => socket.emit('pong', { time: Date.now() }));

    // ── Join / Create room ──────────────────────────────────────────
    // Accepts both 'join_game' (new standard) and 'join_xiangqi' (backward compat)
    const handleJoin = ({ roomId, playerName, reconnect, gameType = 'xiangqi' }) => {
      if (!reconnect) {
        const ip = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
        if (!checkJoinRate(ip)) {
          return socket.emit('error', { message: 'Too many join attempts. Please wait a moment.' });
        }
      }
      if (!playerName || !playerName.trim()) {
        return socket.emit('error', { message: 'Please enter your name.' });
      }
      const name = playerName.trim().slice(0, 30);

      let targetRoomId = roomId;
      if (!targetRoomId) {
        let colors;
        if (gameType === 'chess')          colors = ['white', 'black'];
        else if (gameType === 'chordaidi') colors = ['south', 'west', 'north', 'east'];
        else if (gameType === 'bingo')     colors = BINGO_COLORS.slice(); // 8 seats
        else if (gameType === 'boggle')         colors = BOGGLE_COLORS.slice(0, 4); // up to 4
        else if (gameType === 'singapore-trivia')  colors = TRIVIA_COLORS.slice(0, 6); // up to 6
        else if (gameType === 'spot-the-difference') colors = DIFF_COLORS.slice(0, 6);
        else if (gameType === 'rhythm-tap')          colors = RHYTHM_COLORS.slice(0, 6);
        else if (gameType === 'tv-bingo')          colors = TV_BINGO_COLORS.slice(); // 1 host + 8 players
        else if (gameType === 'tv-higher-lower')   colors = TV_HL_COLORS.slice(); // 1 host + 8 players
        else if (gameType === 'tv-boggle')           colors = TV_BOGGLE_COLORS.slice(); // 1 host + 8 players
        else if (gameType === 'tv-reversi')          colors = TV_REVERSI_COLORS.slice(); // 1 host + 2 players
        else if (gameType === 'snakes-ladders')      colors = SL_COLORS.slice(0, 6); // up to 6 players
        else if (gameType === 'reversi')             colors = REVERSI_COLORS.slice();
        else if (gameType === 'cooking')             colors = COOKING_COLORS.slice(); // tv-host + up to 4 cooks
        else                               colors = ['red', 'black'];
        targetRoomId = roomManager.createRoom({ colors });
        roomGameTypes.set(targetRoomId, gameType);
      }

      const result = roomManager.joinRoom(targetRoomId, socket.id, name);
      if (result.error) {
        return socket.emit('error', { message: result.error });
      }

      socket.join(targetRoomId);
      socket.data.roomId = targetRoomId;
      socket.data.playerName = name;
      socket.data.color = result.color;

      socket.emit('joined', {
        roomId: targetRoomId,
        color: result.color,
        reconnected: result.reconnected
      });

      const room = result.room;

      // If game already in progress, send current state to reconnecting player
      if (engines.has(targetRoomId)) {
        const engine = engines.get(targetRoomId);
        const gt = roomGameTypes.get(targetRoomId) || 'xiangqi';
        if (gt === 'chordaidi') {
          socket.emit('game_state', chordaidiPayload(targetRoomId, room, engine, socket.data.color));
        } else if (gt === 'bingo') {
          socket.emit('game_state', bingoPayload(targetRoomId, room, engine));
        } else if (gt === 'boggle') {
          socket.emit('game_state', bogglePayload(targetRoomId, room, engine));
        } else if (gt === 'singapore-trivia') {
          socket.emit('game_state', triviaPayload(targetRoomId, room, engine));
        } else if (gt === 'spot-the-difference') {
          socket.emit('game_state', diffPayload(targetRoomId, room, engine));
        } else if (gt === 'rhythm-tap') {
          socket.emit('game_state', rhythmPayload(targetRoomId, room, engine));
        } else if (gt === 'tv-bingo') {
          socket.emit('game_state', tvBingoPayload(targetRoomId, room, engine));
        } else if (gt === 'tv-higher-lower') {
          socket.emit('game_state', tvHlPayload(targetRoomId, room, engine));
        } else if (gt === 'tv-boggle') {
          socket.emit('game_state', tvBogglePayload(targetRoomId, room, engine));
        } else if (gt === 'tv-reversi') {
          socket.emit('game_state', tvReversiPayload(targetRoomId, room, engine));
        } else if (gt === 'snakes-ladders') {
          socket.emit('game_state', slPayload(targetRoomId, room, engine));
        } else if (gt === 'reversi') {
          socket.emit('game_state', reversiPayload(targetRoomId, room, engine));
        } else if (gt === 'cooking') {
          socket.emit('cooking_state', engine.state());
          if (socket.data.color !== 'tv-host') {
            const ps = engine.playerState(name);
            if (ps) socket.emit('cooking_player_state', ps);
          }
        } else {
          socket.emit('game_state', gameStatePayload(targetRoomId, room, engine));
        }
      }

      io.to(targetRoomId).emit('room_update', roomSnapshot(room));
      analytics.logEvent('player_joined', targetRoomId, socket.id, name, { color: result.color, gameType });
    };

    socket.on('join_game',    handleJoin);
    socket.on('join_xiangqi', (data) => handleJoin({ ...data, gameType: data.gameType || 'xiangqi' }));

    // ── Chor Dai Di: required player count ──────────────────────────
    // start_game is repurposed — for CDI we need 4 players
    // The 'start_game' handler below already handles the count check

    // ── Start game ──────────────────────────────────────────────────
    socket.on('start_game', () => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      const room = roomManager.getRoom(roomId);
      if (!room) return;
      if (engines.has(roomId)) return; // already started

      const gameType = roomGameTypes.get(roomId) || 'xiangqi';
      const nonHostPlayers = room.players.filter(p => p.color !== 'tv-host');
      const requiredPlayers = gameType === 'chordaidi' ? 4
        : gameType === 'cooking' ? 1
        : 2;
      const countForCheck = gameType === 'cooking' ? nonHostPlayers.length : room.players.length;
      if (countForCheck < requiredPlayers) {
        return socket.emit('error', { message: `Waiting for ${requiredPlayers - countForCheck} more player(s).` });
      }

      let engine;
      if (gameType === 'chess')          engine = createChessGame();
      else if (gameType === 'chordaidi') engine = createChordaidiGame();
      else if (gameType === 'bingo')     engine = createBingoGame(room.players.length);
      else if (gameType === 'boggle')           engine = createBoggleGame(room.players.length);
      else if (gameType === 'singapore-trivia')  engine = createTriviaGame(room.players.length);
      else if (gameType === 'spot-the-difference') engine = createDiffGame(room.players.length);
      else if (gameType === 'rhythm-tap')          engine = createRhythmGame(room.players.length);
      else if (gameType === 'snakes-ladders')      engine = createSnakesLaddersGame(room.players.length);
      else if (gameType === 'reversi')             engine = createReversiGame();
      else if (gameType === 'cooking') {
        engine = createCookingGame();
        // Register non-host players in the cooking engine
        for (const rp of nonHostPlayers) {
          engine.addPlayer(rp.name, rp.name);
        }
      }
      else                               engine = createXiangqiGame();
      engines.set(roomId, engine);

      if (gameType === 'chordaidi') {
        // Send each player their personalised state (private hand)
        room.players.forEach(p => {
          if (!p.socketId) return;
          io.to(p.socketId).emit('game_started', chordaidiPayload(roomId, room, engine, p.color));
        });
      } else if (gameType === 'bingo') {
        io.to(roomId).emit('game_started', bingoPayload(roomId, room, engine));
      } else if (gameType === 'boggle') {
        io.to(roomId).emit('game_started', bogglePayload(roomId, room, engine));
        // Auto-end round after 60 seconds
        const timer = setTimeout(() => {
          const eng = engines.get(roomId);
          const rm  = roomManager.getRoom(roomId);
          if (!eng || !rm) return;
          eng.endRound();
          const payload = bogglePayload(roomId, rm, eng);
          io.to(roomId).emit('game_state', payload);
          // Determine winner and record
          const winSeat = eng.winner();
          const winPlayer = rm.players.find(p => seatForBoggleColor(p.color) === winSeat);
          if (winPlayer) leaderboard.recordWin('boggle', winPlayer.name);
          const winnerColor = winPlayer?.color || null;
          io.to(roomId).emit('game_over', {
            winner: winnerColor,
            reason: winPlayer ? `${winPlayer.name} wins with ${eng.state().scores[winSeat]} points!` : "Time's up!"
          });
          engines.delete(roomId);
          roomGameTypes.delete(roomId);
          boggleTimers.delete(roomId);
          analytics.logEvent('game_ended', roomId, 'timer', 'timer', { winner: winnerColor, gameType: 'boggle' });
        }, 60_000);
        boggleTimers.set(roomId, timer);
      } else if (gameType === 'singapore-trivia') {
        io.to(roomId).emit('game_started', triviaPayload(roomId, room, engine));
      } else if (gameType === 'spot-the-difference') {
        io.to(roomId).emit('game_started', diffPayload(roomId, room, engine));
      } else if (gameType === 'rhythm-tap') {
        io.to(roomId).emit('game_started', rhythmPayload(roomId, room, engine));
      } else if (gameType === 'snakes-ladders') {
        io.to(roomId).emit('game_started', slPayload(roomId, room, engine));
      } else if (gameType === 'reversi') {
        io.to(roomId).emit('game_started', reversiPayload(roomId, room, engine));
      } else if (gameType === 'cooking') {
        const gs = engine.state();
        io.to(roomId).emit('cooking_started', gs);
        // Send personal action states immediately
        for (const rp of room.players) {
          if (rp.color === 'tv-host' || !rp.socketId) continue;
          const ps = engine.playerState(rp.name);
          if (ps) io.to(rp.socketId).emit('cooking_player_state', ps);
        }
        // Start tick loop at 200ms
        const timer = setInterval(() => cookingTick(io, roomId), 200);
        cookingTimers.set(roomId, timer);
      } else {
        const payload = gameStatePayload(roomId, room, engine);
        io.to(roomId).emit('game_started', payload);
      }
      analytics.logEvent('game_started', roomId, socket.id, socket.data.playerName, { gameType });
    });

    // ── Make move ───────────────────────────────────────────────────
    socket.on('make_move', ({ from, to, promotion }) => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      const engine = engines.get(roomId);
      if (!engine) return socket.emit('invalid_move', { reason: 'Game not started' });

      const room = roomManager.getRoom(roomId);
      if (!room) return;

      // Verify it is this socket's color's turn
      const playerColor = socket.data.color;
      const engineTurn = engine.turn();
      const gameType = roomGameTypes.get(roomId) || 'xiangqi';
      const firstColor = gameType === 'chess' ? 'white' : 'red';

      if ((engineTurn === 'w' && playerColor !== firstColor) ||
          (engineTurn === 'b' && playerColor !== 'black')) {
        return socket.emit('invalid_move', { reason: 'Not your turn' });
      }

      if (engine.isGameOver()) {
        return socket.emit('invalid_move', { reason: 'Game is over' });
      }

      const result = engine.move(from, to, promotion || null);
      if (!result.ok) {
        return socket.emit('invalid_move', { reason: result.reason });
      }

      const payload = gameStatePayload(roomId, room, engine);
      io.to(roomId).emit('game_state', payload);
      analytics.logEvent('move_made', roomId, socket.id, socket.data.playerName, { from, to, gameType });

      if (payload.isGameOver) {
        if (payload.winner) {
          const winPlayer = room.players.find(p => p.color === payload.winner);
          if (winPlayer) leaderboard.recordWin(gameType, winPlayer.name);
        }
        analytics.logEvent('game_ended', roomId, socket.id, socket.data.playerName, { winner: payload.winner, gameType });
        // Clean up engine so play_again / rematch is possible
        engines.delete(roomId);
        roomGameTypes.delete(roomId);
      }
    });

    // ── Reversi: place disc ──────────────────────────────────────────
    socket.on('reversi_move', ({ row, col }) => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      const engine = engines.get(roomId);
      if (!engine) return socket.emit('invalid_move', { reason: 'Game not started' });
      const room = roomManager.getRoom(roomId);
      if (!room) return;

      // Verify it is this player's turn
      const playerColor = socket.data.color; // 'black' | 'white'
      const engineTurn  = engine.turn();     // 'B' | 'W'
      const isMyTurn    = (engineTurn === 'B' && playerColor === 'black') ||
                          (engineTurn === 'W' && playerColor === 'white');
      if (!isMyTurn) return socket.emit('invalid_move', { reason: 'Not your turn' });

      if (engine.isGameOver()) return socket.emit('invalid_move', { reason: 'Game is over' });

      const result = engine.move(row, col);
      if (!result.ok) return socket.emit('invalid_move', { reason: result.reason });

      const payload = reversiPayload(roomId, room, engine);
      io.to(roomId).emit('game_state', payload);
      analytics.logEvent('move_made', roomId, socket.id, socket.data.playerName, { row, col, gameType: 'reversi' });

      if (payload.isGameOver) {
        // Map engine winner ('B'/'W'/'draw') to player color ('black'/'white')
        const winColor = payload.winner === 'B' ? 'black' : payload.winner === 'W' ? 'white' : null;
        if (winColor) {
          const winPlayer = room.players.find(p => p.color === winColor);
          if (winPlayer) leaderboard.recordWin('reversi', winPlayer.name);
        }
        io.to(roomId).emit('game_over', {
          winner: winColor,
          reason: winColor
            ? `${room.players.find(p => p.color === winColor)?.name || winColor} wins!`
            : "It's a draw!"
        });
        analytics.logEvent('game_ended', roomId, socket.id, socket.data.playerName, { winner: winColor, gameType: 'reversi' });
        engines.delete(roomId);
        roomGameTypes.delete(roomId);
      }
    });

    // ── Chor Dai Di: play cards ──────────────────────────────────────
    socket.on('cdi_play', ({ cardIds }) => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      const engine = engines.get(roomId);
      if (!engine) return socket.emit('invalid_move', { reason: 'Game not started' });
      const room = roomManager.getRoom(roomId);
      if (!room) return;

      const seat = seatForColor(socket.data.color);
      const result = engine.play(seat, cardIds);
      if (!result.ok) return socket.emit('invalid_move', { reason: result.reason });

      broadcastCDI(io, roomId, room, engine);
      if (engine.isGameOver()) {
        const winSeat = engine.winner();
        const winPlayer = room.players.find(p => seatForColor(p.color) === winSeat);
        io.to(roomId).emit('game_over', { winner: winPlayer?.color || null, reason: `${winPlayer?.name || 'Someone'} played all cards!` });
        if (winPlayer) leaderboard.recordWin('chordaidi', winPlayer.name);
        engines.delete(roomId);
        roomGameTypes.delete(roomId);
      }
    });

    // ── Chor Dai Di: pass ────────────────────────────────────────────
    socket.on('cdi_pass', () => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      const engine = engines.get(roomId);
      if (!engine) return socket.emit('invalid_move', { reason: 'Game not started' });
      const room = roomManager.getRoom(roomId);
      if (!room) return;

      const seat = seatForColor(socket.data.color);
      const result = engine.pass(seat);
      if (!result.ok) return socket.emit('invalid_move', { reason: result.reason });

      broadcastCDI(io, roomId, room, engine);
    });

    // ── Bingo: caller draws next number ─────────────────────────────
    socket.on('bingo_call', () => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      const engine = engines.get(roomId);
      if (!engine) return socket.emit('error', { message: 'Game not started' });
      const room = roomManager.getRoom(roomId);
      if (!room) return;

      const seat = seatForBingoColor(socket.data.color);
      const result = engine.callNumber(seat);
      if (!result.ok) return socket.emit('error', { message: result.reason });

      broadcastBingo(io, roomId, room, engine);

      if (engine.isGameOver()) {
        const ws = engine.winners();
        // Record wins for all winner seats
        ws.forEach(w => {
          const wp = room.players.find(p => seatForBingoColor(p.color) === w.seat);
          if (wp) leaderboard.recordWin('bingo', wp.name);
        });
        const winNames = ws.map(w => {
          const wp = room.players.find(p => seatForBingoColor(p.color) === w.seat);
          return wp?.name || '?';
        });
        io.to(roomId).emit('game_over', {
          winner: winNames.join(', '),
          reason: `BINGO! ${winNames.join(' & ')} won!`
        });
        engines.delete(roomId);
        roomGameTypes.delete(roomId);
        analytics.logEvent('game_ended', roomId, socket.id, socket.data.playerName, { winner: winNames.join(', '), gameType: 'bingo' });
      }
    });

    // ── TV Bingo: host starts auto-call game ───────────────────────────
    socket.on('tv_bingo_start', () => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      if (socket.data.color !== 'tv-host') return;
      const room = roomManager.getRoom(roomId);
      if (!room) return;
      if (engines.has(roomId)) return; // already started

      const phonePlayers = room.players.filter(p => p.color !== 'tv-host');
      if (phonePlayers.length < 1) {
        return socket.emit('error', { message: 'Need at least 1 player to start.' });
      }

      const engine = createBingoGame(phonePlayers.length, { autoCallMode: true });
      engines.set(roomId, engine);
      roomGameTypes.set(roomId, 'tv-bingo');

      io.to(roomId).emit('game_started', tvBingoPayload(roomId, room, engine));
      analytics.logEvent('game_started', roomId, socket.id, 'tv-host', { gameType: 'tv-bingo', playerCount: phonePlayers.length });

      // Auto-call: first number after 5s, then every 15s
      const callAndBroadcast = () => {
        const eng = engines.get(roomId);
        const rm = roomManager.getRoom(roomId);
        if (!eng || !rm) {
          clearInterval(bingoAutoTimers.get(roomId));
          bingoAutoTimers.delete(roomId);
          return;
        }

        const result = eng.callNumber(-1);
        if (!result.ok) {
          clearInterval(bingoAutoTimers.get(roomId));
          bingoAutoTimers.delete(roomId);
          return;
        }

        io.to(roomId).emit('game_state', tvBingoPayload(roomId, rm, eng));
        io.to(roomId).emit('tv_bingo_number_called', {
          number: result.number,
          column: BINGO_COLUMNS[Math.floor((result.number - 1) / 15)],
          calledCount: eng.state().called.length,
          totalNumbers: 75
        });

        // Note: game does NOT end from callNumber in autoCallMode.
        // Game ends when a player marks their winning cell via tv_bingo_mark.
        // But stop the timer if all 75 numbers have been called.
        if (eng.state().pool.length === 0) {
          clearInterval(bingoAutoTimers.get(roomId));
          bingoAutoTimers.delete(roomId);
        }
      };

      // First call after 5 seconds, then recurring every 15 seconds
      const firstCallTimeout = setTimeout(() => {
        callAndBroadcast();
        // After first call, start recurring 15-second interval
        const interval = setInterval(callAndBroadcast, 15_000);
        bingoAutoTimers.set(roomId, interval);
      }, 5_000);
      bingoAutoTimers.set(roomId, firstCallTimeout);
    });

    // ── TV Bingo: player taps a cell to mark it ──────────────────────
    socket.on('tv_bingo_mark', ({ row, col }) => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      const engine = engines.get(roomId);
      if (!engine) return socket.emit('error', { message: 'Game not started' });
      const room = roomManager.getRoom(roomId);
      if (!room) return;

      const seat = seatForTvBingoColor(socket.data.color);
      if (seat < 0) return; // tv-host or spectator cannot mark

      const result = engine.markCell(seat, row, col);

      if (!result.ok) {
        if (result.wrongTap) {
          // Player tapped a number that hasn't been called — send feedback
          socket.emit('tv_bingo_wrong_tap', { row, col, number: result.number, reason: result.reason });
        }
        return;
      }

      // Send updated state to the marking player (their card changed)
      socket.emit('tv_bingo_mark_ok', { row, col, number: result.number });

      // Broadcast full state so TV and all players see progress
      io.to(roomId).emit('game_state', tvBingoPayload(roomId, room, engine));

      // Check if this mark triggered BINGO
      if (result.bingo) {
        // Stop the auto-call timer
        if (bingoAutoTimers.has(roomId)) {
          clearInterval(bingoAutoTimers.get(roomId));
          bingoAutoTimers.delete(roomId);
        }
        handleTvBingoGameOver(io, roomId, room, engine);
      }
    });

    // ── TV Higher or Lower: host starts game ──────────────────────────
    socket.on('tv_hl_start', () => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      if (socket.data.color !== 'tv-host') return;
      const room = roomManager.getRoom(roomId);
      if (!room) return;
      if (engines.has(roomId)) return; // already started

      const phonePlayers = room.players.filter(p => p.color !== 'tv-host');
      if (phonePlayers.length < 1) {
        return socket.emit('error', { message: 'Need at least 1 player to start.' });
      }

      const engine = createHigherLowerGame(phonePlayers.length);
      engines.set(roomId, engine);
      roomGameTypes.set(roomId, 'tv-higher-lower');

      io.to(roomId).emit('game_started', tvHlPayload(roomId, room, engine));
      analytics.logEvent('game_started', roomId, socket.id, 'tv-host', { gameType: 'tv-higher-lower', playerCount: phonePlayers.length });
    });

    // ── TV Higher or Lower: player guesses ──────────────────────────────
    socket.on('tv_hl_guess', ({ direction }) => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      const engine = engines.get(roomId);
      if (!engine) return socket.emit('error', { message: 'Game not started' });
      const room = roomManager.getRoom(roomId);
      if (!room) return;

      const seat = seatForTvHlColor(socket.data.color);
      if (seat < 0) return; // tv-host or spectator cannot guess

      const result = engine.guess(seat, direction);
      if (!result.ok) return socket.emit('error', { message: result.reason });

      // Broadcast the result for animation (TV and phones)
      const phonePlayers = room.players.filter(p => p.color !== 'tv-host');
      const guesserName = phonePlayers[seat]?.name || '?';
      const eliminatedName = result.eliminatedSeat !== null
        ? (phonePlayers[result.eliminatedSeat]?.name || '?')
        : null;

      io.to(roomId).emit('tv_hl_result', {
        seat,
        guesserName,
        direction,
        correct: result.correct,
        revealedCard: result.revealedCard,
        previousCard: result.previousCard,
        eliminatedName
      });

      // Broadcast full state
      io.to(roomId).emit('game_state', tvHlPayload(roomId, room, engine));

      // Check game over
      if (result.isGameOver) {
        const winSeat = engine.winner();
        const winPlayer = winSeat !== null ? phonePlayers[winSeat] : null;
        if (winPlayer) leaderboard.recordWin('tv-higher-lower', winPlayer.name);
        io.to(roomId).emit('game_over', {
          winner: winPlayer?.name || null,
          reason: winPlayer
            ? `${winPlayer.name} is the last one standing!`
            : 'Game over — no survivors!'
        });
        engines.delete(roomId);
        roomGameTypes.delete(roomId);
        analytics.logEvent('game_ended', roomId, socket.id, socket.data.playerName, { winner: winPlayer?.name || null, gameType: 'tv-higher-lower' });
      }
    });

    // ── TV Boggle: host starts game ─────────────────────────────────
    socket.on('tv_boggle_start', () => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      if (socket.data.color !== 'tv-host') return;
      const room = roomManager.getRoom(roomId);
      if (!room) return;
      if (engines.has(roomId)) return; // already started

      const phonePlayers = room.players.filter(p => p.color !== 'tv-host');
      if (phonePlayers.length < 1) {
        return socket.emit('error', { message: 'Need at least 1 player to start.' });
      }

      const engine = createBoggleGame(phonePlayers.length, { roundSeconds: 120 });
      engines.set(roomId, engine);
      roomGameTypes.set(roomId, 'tv-boggle');

      io.to(roomId).emit('game_started', tvBogglePayload(roomId, room, engine));
      analytics.logEvent('game_started', roomId, socket.id, 'tv-host', { gameType: 'tv-boggle', playerCount: phonePlayers.length });

      // Auto-end round after 120 seconds (2 minutes)
      const timer = setTimeout(() => {
        const eng = engines.get(roomId);
        const rm  = roomManager.getRoom(roomId);
        if (!eng || !rm) return;
        eng.endRound();
        const payload = tvBogglePayload(roomId, rm, eng);
        io.to(roomId).emit('game_state', payload);
        // Determine winner and record
        const winSeat = eng.winner();
        const tvPhonePlayers = rm.players.filter(p => p.color !== 'tv-host');
        const winPlayer = winSeat !== null ? tvPhonePlayers[winSeat] : null;
        if (winPlayer) leaderboard.recordWin('tv-boggle', winPlayer.name);
        io.to(roomId).emit('game_over', {
          winner: winPlayer?.name || null,
          reason: winPlayer ? `${winPlayer.name} wins with ${eng.state().scores[winSeat]} points!` : "Time's up!"
        });
        engines.delete(roomId);
        roomGameTypes.delete(roomId);
        tvBoggleTimers.delete(roomId);
        analytics.logEvent('game_ended', roomId, 'timer', 'timer', { winner: winPlayer?.name || null, gameType: 'tv-boggle' });
      }, 120_000);
      tvBoggleTimers.set(roomId, timer);
    });

    // ── Boggle: submit a word (handles both 'boggle' and 'tv-boggle') ──
    socket.on('boggle_submit', ({ word }) => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      const engine = engines.get(roomId);
      if (!engine) return socket.emit('error', { message: 'Game not started' });
      const room = roomManager.getRoom(roomId);
      if (!room) return;

      const gt = roomGameTypes.get(roomId);
      const seat = gt === 'tv-boggle'
        ? seatForTvBoggleColor(socket.data.color)
        : seatForBoggleColor(socket.data.color);
      if (seat < 0) return; // tv-host or invalid color

      const result = engine.submitWord(seat, word);
      if (!result.ok) return socket.emit('boggle_reject', { word, reason: result.reason });

      // Confirm to submitter; broadcast updated counts to all
      socket.emit('boggle_accept', { word: result.word });
      io.to(roomId).emit('boggle_counts', {
        submissionCounts: engine.state().submissionCounts
      });
    });

    // ── Boggle: host ends round early ────────────────────────────────
    socket.on('boggle_end', () => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      const engine = engines.get(roomId);
      if (!engine) return;
      const room = roomManager.getRoom(roomId);
      if (!room) return;
      // Only the red (seat 0 / host) player can end early
      if (socket.data.color !== 'red') return;

      // Cancel auto-timer
      if (boggleTimers.has(roomId)) {
        clearTimeout(boggleTimers.get(roomId));
        boggleTimers.delete(roomId);
      }

      engine.endRound();
      const payload = bogglePayload(roomId, room, engine);
      io.to(roomId).emit('game_state', payload);

      const winSeat = engine.winner();
      const winPlayer = room.players.find(p => seatForBoggleColor(p.color) === winSeat);
      if (winPlayer) leaderboard.recordWin('boggle', winPlayer.name);
      const winnerColor = winPlayer?.color || null;
      io.to(roomId).emit('game_over', {
        winner: winnerColor,
        reason: winPlayer ? `${winPlayer.name} wins with ${engine.state().scores[winSeat]} points!` : "Game over!"
      });
      engines.delete(roomId);
      roomGameTypes.delete(roomId);
      analytics.logEvent('game_ended', roomId, socket.id, socket.data.playerName, { winner: winnerColor, gameType: 'boggle' });
    });

    // ── TV Reversi: host starts game ────────────────────────────────
    socket.on('tv_reversi_start', () => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      if (socket.data.color !== 'tv-host') return;
      const room = roomManager.getRoom(roomId);
      if (!room) return;
      if (engines.has(roomId)) return; // already started

      const phonePlayers = room.players.filter(p => p.color !== 'tv-host');
      if (phonePlayers.length < 2) {
        return socket.emit('error', { message: 'Need 2 players to start.' });
      }

      const engine = createReversiGame();
      engines.set(roomId, engine);
      roomGameTypes.set(roomId, 'tv-reversi');

      io.to(roomId).emit('game_started', tvReversiPayload(roomId, room, engine));
      analytics.logEvent('game_started', roomId, socket.id, 'tv-host', { gameType: 'tv-reversi' });
    });

    // ── TV Reversi: player places a disc ────────────────────────────
    socket.on('tv_reversi_move', ({ row, col }) => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      const engine = engines.get(roomId);
      if (!engine) return socket.emit('invalid_move', { reason: 'Game not started' });
      const room = roomManager.getRoom(roomId);
      if (!room) return;

      const playerColor = socket.data.color; // 'black' | 'white'
      if (playerColor === 'tv-host') return;

      const engineTurn = engine.turn(); // 'B' | 'W'
      const isMyTurn   = (engineTurn === 'B' && playerColor === 'black') ||
                         (engineTurn === 'W' && playerColor === 'white');
      if (!isMyTurn) return socket.emit('invalid_move', { reason: 'Not your turn' });
      if (engine.isGameOver()) return socket.emit('invalid_move', { reason: 'Game is over' });

      const result = engine.move(row, col);
      if (!result.ok) return socket.emit('invalid_move', { reason: result.reason });

      const payload = tvReversiPayload(roomId, room, engine);
      io.to(roomId).emit('game_state', payload);
      analytics.logEvent('move_made', roomId, socket.id, socket.data.playerName, { row, col, gameType: 'tv-reversi' });

      if (payload.isGameOver) {
        const winColor = payload.winner === 'B' ? 'black' : payload.winner === 'W' ? 'white' : null;
        const winPlayer = winColor ? room.players.find(p => p.color === winColor) : null;
        if (winPlayer) leaderboard.recordWin('tv-reversi', winPlayer.name);
        io.to(roomId).emit('game_over', {
          winner: winPlayer?.name || null,
          reason: winPlayer ? `${winPlayer.name} wins!` : "It's a draw!"
        });
        analytics.logEvent('game_ended', roomId, socket.id, socket.data.playerName, { winner: winColor, gameType: 'tv-reversi' });
        engines.delete(roomId);
        roomGameTypes.delete(roomId);
      }
    });

    // ── Cooking: player tap (chopping mini-game) ─────────────────────
    socket.on('cooking_tap', () => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      const engine = engines.get(roomId);
      const room   = roomManager.getRoom(roomId);
      if (!engine || !room) return;
      if (roomGameTypes.get(roomId) !== 'cooking') return;
      const playerName = socket.data.playerName;
      const result = engine.tapAction(playerName);
      if (!result.ok) {
        socket.emit('cooking_action_error', { reason: result.reason });
        return;
      }
      // Send personal state immediately
      const ps = engine.playerState(playerName);
      if (ps) socket.emit('cooking_player_state', ps);
      // If task completed, broadcast full state
      if (result.action === 'task_completed') {
        const gs = engine.state();
        io.to(roomId).emit('cooking_state', gs);
        for (const rp of room.players) {
          if (rp.color === 'tv-host' || !rp.socketId) continue;
          const rps = engine.playerState(rp.name);
          if (rps) io.to(rp.socketId).emit('cooking_player_state', rps);
        }
      }
      analytics.logEvent('move_made', roomId, socket.id, playerName, { action: 'tap', gameType: 'cooking' });
    });

    // ── Cooking: player stir (stirring mini-game) ─────────────────────
    socket.on('cooking_stir', ({ circles }) => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      const engine = engines.get(roomId);
      const room   = roomManager.getRoom(roomId);
      if (!engine || !room) return;
      if (roomGameTypes.get(roomId) !== 'cooking') return;
      const playerName = socket.data.playerName;
      const result = engine.stirAction(playerName, circles || 1);
      if (!result.ok) {
        socket.emit('cooking_action_error', { reason: result.reason });
        return;
      }
      const ps = engine.playerState(playerName);
      if (ps) socket.emit('cooking_player_state', ps);
      if (result.action === 'task_completed') {
        const gs = engine.state();
        io.to(roomId).emit('cooking_state', gs);
        for (const rp of room.players) {
          if (rp.color === 'tv-host' || !rp.socketId) continue;
          const rps = engine.playerState(rp.name);
          if (rps) io.to(rp.socketId).emit('cooking_player_state', rps);
        }
      }
      analytics.logEvent('move_made', roomId, socket.id, playerName, { action: 'stir', gameType: 'cooking' });
    });

    // ── Cooking: player flip (QTE mini-game) ──────────────────────────
    socket.on('cooking_flip', ({ timing }) => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      const engine = engines.get(roomId);
      const room   = roomManager.getRoom(roomId);
      if (!engine || !room) return;
      if (roomGameTypes.get(roomId) !== 'cooking') return;
      const playerName = socket.data.playerName;
      const result = engine.flipAction(playerName, timing || 0);
      if (!result.ok) {
        socket.emit('cooking_action_error', { reason: result.reason });
        return;
      }
      const ps = engine.playerState(playerName);
      if (ps) socket.emit('cooking_player_state', ps);
      if (result.action === 'task_completed') {
        const gs = engine.state();
        io.to(roomId).emit('cooking_state', gs);
        for (const rp of room.players) {
          if (rp.color === 'tv-host' || !rp.socketId) continue;
          const rps = engine.playerState(rp.name);
          if (rps) io.to(rp.socketId).emit('cooking_player_state', rps);
        }
      }
      socket.emit('cooking_flip_result', { result: result.result || result.action });
      analytics.logEvent('move_made', roomId, socket.id, playerName, { action: 'flip', gameType: 'cooking' });
    });

    // ── Snakes & Ladders: player rolls the dice ──────────────────────
    socket.on('snakes_roll', () => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      const engine = engines.get(roomId);
      if (!engine) return socket.emit('error', { message: 'Game not started' });
      const room = roomManager.getRoom(roomId);
      if (!room) return;

      const seat = seatForSlColor(socket.data.color);
      if (seat < 0) return socket.emit('error', { message: 'Not a valid player colour' });

      const result = engine.roll(seat);
      if (!result.ok) return socket.emit('error', { message: result.reason });

      io.to(roomId).emit('snakes_roll_result', {
        seat,
        dice:        result.dice,
        newPosition: result.newPosition,
        snakeFrom:   result.snakeFrom,
        snakeTo:     result.snakeTo,
        ladderFrom:  result.ladderFrom,
        ladderTo:    result.ladderTo,
        stayed:      result.stayed,
        won:         result.won,
        playerName:  socket.data.playerName
      });

      const payload = slPayload(roomId, room, engine);
      io.to(roomId).emit('game_state', payload);
      analytics.logEvent('move_made', roomId, socket.id, socket.data.playerName, { dice: result.dice, gameType: 'snakes-ladders' });

      if (result.won) {
        const winPlayer = room.players.find(p => seatForSlColor(p.color) === engine.winner());
        if (winPlayer) leaderboard.recordWin('snakes-ladders', winPlayer.name);
        io.to(roomId).emit('game_over', {
          winner: winPlayer?.color || null,
          reason: winPlayer ? `${winPlayer.name} reached 100! 🏆` : 'Game over!'
        });
        analytics.logEvent('game_ended', roomId, socket.id, socket.data.playerName, { winner: winPlayer?.color, gameType: 'snakes-ladders' });
        engines.delete(roomId);
        roomGameTypes.delete(roomId);
      }
    });

    // ── Singapore Trivia: host starts/advances question ─────────────
    // Called both to start Q1 (phase='waiting', questionIndex=-1)
    // and to advance from reveal to next question (phase='reveal').
    socket.on('trivia_next', () => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      if (socket.data.color !== 'p1') return; // host only
      const engine = engines.get(roomId);
      if (!engine) return;
      const room = roomManager.getRoom(roomId);
      if (!room) return;

      // Clear any pending auto-reveal timer
      if (triviaTimers.has(roomId)) {
        clearTimeout(triviaTimers.get(roomId));
        triviaTimers.delete(roomId);
      }

      const phase = engine.state().phase;

      // If coming from reveal phase, advance to next/finished first
      if (phase === 'reveal') {
        const advResult = engine.nextQuestion();
        if (!advResult.ok) return socket.emit('error', { message: advResult.reason });
        if (advResult.finished) {
          // All questions done — trivia_finish will handle the game_over
          io.to(roomId).emit('game_state', triviaPayload(roomId, room, engine));
          return;
        }
        // Now phase is 'waiting' — fall through to startQuestion
      }

      // Start the question (phase must be 'waiting')
      const startResult = engine.startQuestion();
      if (!startResult.ok) return socket.emit('error', { message: startResult.reason });

      io.to(roomId).emit('game_state', triviaPayload(roomId, room, engine));

      // Auto-reveal after 20 seconds
      const timer = setTimeout(() => {
        const eng = engines.get(roomId);
        const rm  = roomManager.getRoom(roomId);
        if (!eng || !rm) return;
        if (eng.state().phase !== 'question') return;
        eng.revealAnswers();
        io.to(roomId).emit('game_state', triviaPayload(roomId, rm, eng));
        triviaTimers.delete(roomId);
      }, 20_000);
      triviaTimers.set(roomId, timer);
    });

    // ── Singapore Trivia: host manually reveals answers ──────────────
    socket.on('trivia_reveal', () => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      if (socket.data.color !== 'p1') return; // host only
      const engine = engines.get(roomId);
      if (!engine) return;
      const room = roomManager.getRoom(roomId);
      if (!room) return;

      // Cancel auto-reveal timer
      if (triviaTimers.has(roomId)) {
        clearTimeout(triviaTimers.get(roomId));
        triviaTimers.delete(roomId);
      }

      const result = engine.revealAnswers();
      if (!result.ok) return socket.emit('error', { message: result.reason });
      io.to(roomId).emit('game_state', triviaPayload(roomId, room, engine));
    });

    // ── Singapore Trivia: submit answer ─────────────────────────────
    socket.on('trivia_answer', ({ answerIndex }) => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      const engine = engines.get(roomId);
      if (!engine) return;
      const room = roomManager.getRoom(roomId);
      if (!room) return;

      const seat = seatForTriviaColor(socket.data.color);
      const result = engine.submitAnswer(seat, answerIndex);
      if (!result.ok) return socket.emit('error', { message: result.reason });

      // Broadcast updated answer count to all (no secret info here)
      io.to(roomId).emit('game_state', triviaPayload(roomId, room, engine));

      // If all players answered, auto-reveal
      if (result.allAnswered) {
        if (triviaTimers.has(roomId)) {
          clearTimeout(triviaTimers.get(roomId));
          triviaTimers.delete(roomId);
        }
        engine.revealAnswers();
        io.to(roomId).emit('game_state', triviaPayload(roomId, room, engine));
      }
    });

    // ── Singapore Trivia: host finishes game after last question ─────
    socket.on('trivia_finish', () => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      if (socket.data.color !== 'p1') return; // host only
      const engine = engines.get(roomId);
      if (!engine) return;
      const room = roomManager.getRoom(roomId);
      if (!room) return;

      if (triviaTimers.has(roomId)) {
        clearTimeout(triviaTimers.get(roomId));
        triviaTimers.delete(roomId);
      }

      // nextQuestion sets phase to 'finished' and isGameOver = true
      engine.nextQuestion();

      const gs = engine.state();
      const winSeat = engine.winner();
      const winPlayer = room.players.find(p => seatForTriviaColor(p.color) === winSeat);
      const winnerColor = winPlayer?.color || null;
      if (winPlayer) leaderboard.recordWin('singapore-trivia', winPlayer.name);

      io.to(roomId).emit('game_state', triviaPayload(roomId, room, engine));
      io.to(roomId).emit('game_over', {
        winner: winnerColor,
        reason: winPlayer
          ? `${winPlayer.name} wins with ${gs.scores[winSeat]} points!`
          : "Game over!"
      });
      engines.delete(roomId);
      roomGameTypes.delete(roomId);
      analytics.logEvent('game_ended', roomId, socket.id, socket.data.playerName, { winner: winnerColor, gameType: 'singapore-trivia' });
    });

    // ── Spot the Difference: host starts first round ──────────────────
    socket.on('diff_start', () => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      if (socket.data.color !== 'p1') return;
      const engine = engines.get(roomId);
      if (!engine) return;
      const room = roomManager.getRoom(roomId);
      if (!room) return;

      const result = engine.startRound();
      if (!result.ok) return socket.emit('error', { message: result.reason });

      io.to(roomId).emit('game_state', diffPayload(roomId, room, engine));

      // Auto-timeout after 60 seconds
      const timer = setTimeout(() => {
        const eng = engines.get(roomId);
        const rm  = roomManager.getRoom(roomId);
        if (!eng || !rm) return;
        eng.roundTimeout();
        io.to(roomId).emit('game_state', diffPayload(roomId, rm, eng));
        diffTimers.delete(roomId);
      }, 60_000);
      diffTimers.set(roomId, timer);
      analytics.logEvent('diff_round_start', roomId, socket.id, socket.data.playerName, { round: engine.state().roundIndex });
    });

    // ── Spot the Difference: player clicks a spot ─────────────────────
    socket.on('diff_click', ({ x, y }) => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      const engine = engines.get(roomId);
      if (!engine) return;
      const room = roomManager.getRoom(roomId);
      if (!room) return;

      // Validate coords
      if (typeof x !== 'number' || typeof y !== 'number') return;
      if (x < 0 || x > 100 || y < 0 || y > 100) return;

      const result = engine.clickHotspot(x, y);
      if (!result.ok) return;

      if (result.found) {
        io.to(roomId).emit('game_state', diffPayload(roomId, room, engine));
        analytics.logEvent('diff_found', roomId, socket.id, socket.data.playerName, { hotspotId: result.hotspotId });

        if (result.allFound) {
          // Clear round timer
          if (diffTimers.has(roomId)) {
            clearTimeout(diffTimers.get(roomId));
            diffTimers.delete(roomId);
          }
          if (engine.isGameOver()) {
            const gs = engine.state();
            io.to(roomId).emit('game_over', {
              winner: null,
              reason: `All differences found! Team score: ${gs.teamScore} pts 🎉`
            });
            engines.delete(roomId);
            roomGameTypes.delete(roomId);
            analytics.logEvent('game_ended', roomId, socket.id, socket.data.playerName, { teamScore: gs.teamScore, gameType: 'spot-the-difference' });
          }
        }
      } else {
        // Wrong click — private feedback to the clicker only
        socket.emit('diff_miss', { x, y });
      }
    });

    // ── Spot the Difference: host advances to next round ──────────────
    socket.on('diff_next', () => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      if (socket.data.color !== 'p1') return;
      const engine = engines.get(roomId);
      if (!engine) return;
      const room = roomManager.getRoom(roomId);
      if (!room) return;

      // Cancel existing round timer
      if (diffTimers.has(roomId)) {
        clearTimeout(diffTimers.get(roomId));
        diffTimers.delete(roomId);
      }

      const result = engine.nextRound();
      if (!result.ok) return socket.emit('error', { message: result.reason });

      io.to(roomId).emit('game_state', diffPayload(roomId, room, engine));

      if (engine.isGameOver()) {
        const gs = engine.state();
        io.to(roomId).emit('game_over', {
          winner: null,
          reason: `Game complete! Team score: ${gs.teamScore} pts 🎉`
        });
        engines.delete(roomId);
        roomGameTypes.delete(roomId);
        analytics.logEvent('game_ended', roomId, socket.id, socket.data.playerName, { teamScore: gs.teamScore, gameType: 'spot-the-difference' });
      } else {
        // Start new round timer
        const timer = setTimeout(() => {
          const eng = engines.get(roomId);
          const rm  = roomManager.getRoom(roomId);
          if (!eng || !rm) return;
          eng.roundTimeout();
          io.to(roomId).emit('game_state', diffPayload(roomId, rm, eng));
          diffTimers.delete(roomId);
        }, 60_000);
        diffTimers.set(roomId, timer);
      }
    });

    // ── Spot the Difference: host ends game early ─────────────────────
    socket.on('diff_finish', () => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      if (socket.data.color !== 'p1') return;
      const engine = engines.get(roomId);
      if (!engine) return;
      const room = roomManager.getRoom(roomId);
      if (!room) return;

      if (diffTimers.has(roomId)) {
        clearTimeout(diffTimers.get(roomId));
        diffTimers.delete(roomId);
      }

      engine.finishGame();
      const gs = engine.state();
      io.to(roomId).emit('game_state', diffPayload(roomId, room, engine));
      io.to(roomId).emit('game_over', {
        winner: null,
        reason: `Game ended. Team score: ${gs.teamScore} pts`
      });
      engines.delete(roomId);
      roomGameTypes.delete(roomId);
      analytics.logEvent('game_ended', roomId, socket.id, socket.data.playerName, { teamScore: gs.teamScore, gameType: 'spot-the-difference', reason: 'host_ended' });
    });

    // ── Rhythm Tap: host starts game ──────────────────────────────────
    socket.on('rhythm_start', () => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      if (socket.data.color !== 'p1') return;
      const engine = engines.get(roomId);
      if (!engine) return;
      const room = roomManager.getRoom(roomId);
      if (!room) return;

      const startTime = Date.now();
      const result = engine.startGame(startTime);
      if (!result.ok) return socket.emit('error', { message: result.reason });

      io.to(roomId).emit('game_state', rhythmPayload(roomId, room, engine));

      // Auto-end when last beat expires + 2s buffer
      const lastBeat = engine.lastBeatTime();
      const endDelay = lastBeat + 2000;

      const timer = setTimeout(() => {
        const eng = engines.get(roomId);
        const rm  = roomManager.getRoom(roomId);
        if (!eng || !rm) return;
        eng.endGame();
        const gs = eng.state();
        io.to(roomId).emit('game_state', rhythmPayload(roomId, rm, eng));

        const winSeat   = eng.winner();
        const winPlayer = rm.players.find(p => seatForRhythmColor(p.color) === winSeat);
        const winnerColor = winPlayer?.color || null;
        if (winPlayer) leaderboard.recordWin('rhythm-tap', winPlayer.name);
        io.to(roomId).emit('game_over', {
          winner: winnerColor,
          reason: winPlayer
            ? `${winPlayer.name} wins with ${gs.scores[winSeat]} hits!`
            : 'Game over!'
        });
        engines.delete(roomId);
        roomGameTypes.delete(roomId);
        rhythmTimers.delete(roomId);
        analytics.logEvent('game_ended', roomId, 'timer', 'timer', { winner: winnerColor, gameType: 'rhythm-tap' });
      }, endDelay);
      rhythmTimers.set(roomId, timer);
      analytics.logEvent('game_started', roomId, socket.id, socket.data.playerName, { gameType: 'rhythm-tap', pattern: engine.state().patternName });
    });

    // ── Rhythm Tap: player taps a lane ────────────────────────────────
    socket.on('rhythm_tap', ({ lane, clientTime }) => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      const engine = engines.get(roomId);
      if (!engine) return;
      const room = roomManager.getRoom(roomId);
      if (!room) return;

      if (typeof lane !== 'number' || lane < 0 || lane > 3) return;
      if (typeof clientTime !== 'number') return;

      const seat   = seatForRhythmColor(socket.data.color);
      const result = engine.tapBeat(seat, lane, clientTime);
      if (!result.ok) return;

      // Private timing feedback to the tapping player
      socket.emit('rhythm_tap_result', {
        hit:       result.hit,
        accuracy:  result.accuracy || 'miss',
        beatIndex: result.beatIndex ?? null
      });

      // Broadcast updated scores to all
      const gs = engine.state();
      io.to(roomId).emit('rhythm_score_update', {
        scores:   gs.scores,
        beatsHit: gs.beatsHit
      });
    });

    // ── Rhythm Tap: host ends game early ──────────────────────────────
    socket.on('rhythm_finish', () => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      if (socket.data.color !== 'p1') return;
      const engine = engines.get(roomId);
      if (!engine) return;
      const room = roomManager.getRoom(roomId);
      if (!room) return;

      if (rhythmTimers.has(roomId)) {
        clearTimeout(rhythmTimers.get(roomId));
        rhythmTimers.delete(roomId);
      }

      engine.endGame();
      const gs        = engine.state();
      const winSeat   = engine.winner();
      const winPlayer = room.players.find(p => seatForRhythmColor(p.color) === winSeat);
      const winnerColor = winPlayer?.color || null;
      if (winPlayer) leaderboard.recordWin('rhythm-tap', winPlayer.name);

      io.to(roomId).emit('game_state', rhythmPayload(roomId, room, engine));
      io.to(roomId).emit('game_over', {
        winner: winnerColor,
        reason: winPlayer
          ? `${winPlayer.name} wins with ${gs.scores[winSeat]} hits!`
          : 'Game over!'
      });
      engines.delete(roomId);
      roomGameTypes.delete(roomId);
      analytics.logEvent('game_ended', roomId, socket.id, socket.data.playerName, { winner: winnerColor, gameType: 'rhythm-tap', reason: 'host_ended' });
    });

    // ── Undo request ────────────────────────────────────────────────
    socket.on('request_undo', () => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      const room = roomManager.getRoom(roomId);
      if (!room) return;
      const opponent = room.players.find(p => p.color !== socket.data.color && p.socketId);
      if (!opponent) return socket.emit('error', { message: 'Opponent not connected' });
      io.to(opponent.socketId).emit('undo_requested', { from: socket.data.playerName });
      analytics.logEvent('undo_requested', roomId, socket.id, socket.data.playerName);
    });

    // ── Approve undo ────────────────────────────────────────────────
    socket.on('approve_undo', () => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      const engine = engines.get(roomId);
      if (!engine) return;
      const room = roomManager.getRoom(roomId);
      if (!room) return;
      if (!engine.undo()) return;
      io.to(roomId).emit('game_state', gameStatePayload(roomId, room, engine));
    });

    // ── Decline undo ────────────────────────────────────────────────
    socket.on('decline_undo', () => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      const room = roomManager.getRoom(roomId);
      if (!room) return;
      const requester = room.players.find(p => p.color !== socket.data.color && p.socketId);
      if (!requester) return;
      io.to(requester.socketId).emit('undo_declined');
    });

    // ── Resign ──────────────────────────────────────────────────────
    socket.on('resign', () => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      const room = roomManager.getRoom(roomId);
      if (!room) return;
      // Opponent of the resigning player wins
      const winnerPlayer = room.players.find(p => p.color !== socket.data.color);
      const winner = winnerPlayer?.color || null;
      io.to(roomId).emit('game_over', { winner, reason: `${socket.data.playerName} resigned` });
      const gt = roomGameTypes.get(roomId) || 'xiangqi';
      if (winnerPlayer) leaderboard.recordWin(gt, winnerPlayer.name);
      engines.delete(roomId);
      roomGameTypes.delete(roomId);
      analytics.logEvent('game_ended', roomId, socket.id, socket.data.playerName, { winner, reason: 'resign' });
    });

    // ── Play again ──────────────────────────────────────────────────
    socket.on('play_again', () => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      const room = roomManager.getRoom(roomId);
      if (!room) return;

      // Clear any running Boggle timer
      if (boggleTimers.has(roomId)) {
        clearTimeout(boggleTimers.get(roomId));
        boggleTimers.delete(roomId);
      }
      // Clear any running Trivia timer
      if (triviaTimers.has(roomId)) {
        clearTimeout(triviaTimers.get(roomId));
        triviaTimers.delete(roomId);
      }
      // Clear any running Spot the Difference timer
      if (diffTimers.has(roomId)) {
        clearTimeout(diffTimers.get(roomId));
        diffTimers.delete(roomId);
      }
      // Clear any running Rhythm Tap timer
      if (rhythmTimers.has(roomId)) {
        clearTimeout(rhythmTimers.get(roomId));
        rhythmTimers.delete(roomId);
      }
      // Clear any running TV Bingo auto-call timer
      if (bingoAutoTimers.has(roomId)) {
        clearInterval(bingoAutoTimers.get(roomId));
        bingoAutoTimers.delete(roomId);
      }
      // Clear any running TV Boggle timer
      if (tvBoggleTimers.has(roomId)) {
        clearTimeout(tvBoggleTimers.get(roomId));
        tvBoggleTimers.delete(roomId);
      }
      // Clear any running Cooking tick timer
      if (cookingTimers.has(roomId)) {
        clearInterval(cookingTimers.get(roomId));
        cookingTimers.delete(roomId);
      }
      // Clear engine so start_game can run fresh
      engines.delete(roomId);
      roomGameTypes.delete(roomId);

      // Tell everyone to return to the waiting screen
      io.to(roomId).emit('play_again');
      // Re-broadcast room state so TV host re-evaluates the Start button
      io.to(roomId).emit('room_update', roomSnapshot(room));
    });

    // ── Disconnect ──────────────────────────────────────────────────
    socket.on('disconnect', () => {
      console.log('disconnect', socket.id);
      const result = roomManager.leaveRoom(socket.id);
      if (!result) return;
      const { roomId, room, wasPlayer, playerName } = result;
      if (!wasPlayer) return;

      // 2s delay absorbs the lobby→game-page socket transition race
      setTimeout(() => {
        const currentRoom = roomManager.getRoom(roomId);
        if (!currentRoom) return;
        const player = currentRoom.players.find(p => p.name === playerName);
        if (player && player.socketId !== null) return; // already reconnected

        io.to(roomId).emit('player_disconnected', { playerName });
        io.to(roomId).emit('room_update', roomSnapshot(currentRoom));
        analytics.logEvent('player_disconnected', roomId, socket.id, playerName || '');
      }, 2000);
    });
  });
};
