'use strict';
/* ── Kitchen Rush! — Web Audio Sound Effects ──────────────────────────────── */
/* Zero-dependency synthesized SFX using Web Audio API oscillators.            */
/* Used by both TV display and phone clients.                                 */

let _ctx = null;
function ctx() {
  if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (_ctx.state === 'suspended') _ctx.resume();
  return _ctx;
}

function osc(type, freq, startT, dur, vol) {
  const c = ctx();
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(vol, startT);
  g.gain.exponentialRampToValueAtTime(0.001, startT + dur);
  o.connect(g); g.connect(c.destination);
  o.start(startT); o.stop(startT + dur);
}

function noise(startT, dur, vol) {
  const c = ctx();
  const bufSize = c.sampleRate * dur;
  const buf = c.createBuffer(1, bufSize, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * vol;
  const src = c.createBufferSource();
  const g = c.createGain();
  src.buffer = buf;
  g.gain.setValueAtTime(vol * 0.3, startT);
  g.gain.exponentialRampToValueAtTime(0.001, startT + dur);
  src.connect(g); g.connect(c.destination);
  src.start(startT); src.stop(startT + dur);
}

const SFX = {
  // Chopping — sharp percussive hits
  chop() {
    const t = ctx().currentTime;
    noise(t, 0.06, 0.5);
    osc('square', 800 + Math.random() * 200, t, 0.04, 0.15);
  },

  // Stirring — soft swirling tone
  stir() {
    const t = ctx().currentTime;
    osc('sine', 300, t, 0.15, 0.12);
    osc('sine', 450, t + 0.05, 0.12, 0.08);
  },

  // Flip attempt — swoosh
  flipSwoosh() {
    const t = ctx().currentTime;
    const c = ctx();
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(200, t);
    o.frequency.exponentialRampToValueAtTime(800, t + 0.15);
    g.gain.setValueAtTime(0.15, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.connect(g); g.connect(c.destination);
    o.start(t); o.stop(t + 0.2);
  },

  // Flip perfect — satisfying ding!
  flipPerfect() {
    const t = ctx().currentTime;
    osc('sine', 880, t, 0.15, 0.25);
    osc('sine', 1320, t + 0.08, 0.2, 0.2);
    osc('triangle', 1760, t + 0.14, 0.25, 0.15);
  },

  // Flip miss — low buzz
  flipMiss() {
    const t = ctx().currentTime;
    osc('sawtooth', 150, t, 0.2, 0.12);
    osc('sawtooth', 120, t + 0.05, 0.15, 0.1);
  },

  // Task claimed — quick pick-up blip
  taskClaimed() {
    const t = ctx().currentTime;
    osc('sine', 523, t, 0.08, 0.15);
    osc('sine', 784, t + 0.06, 0.1, 0.18);
  },

  // Task completed — cheerful ascending chime
  taskComplete() {
    const t = ctx().currentTime;
    osc('triangle', 523, t, 0.12, 0.2);
    osc('triangle', 659, t + 0.08, 0.12, 0.2);
    osc('triangle', 784, t + 0.16, 0.15, 0.22);
    osc('sine', 1047, t + 0.24, 0.2, 0.18);
  },

  // Order served — triumphant fanfare!
  orderServed() {
    const t = ctx().currentTime;
    [523, 659, 784, 1047].forEach((f, i) => {
      osc('triangle', f, t + i * 0.1, 0.25, 0.22);
    });
    // Sparkle
    osc('sine', 2093, t + 0.35, 0.3, 0.1);
    osc('sine', 2637, t + 0.4, 0.25, 0.08);
  },

  // New order — bell ding-dong
  newOrder() {
    const t = ctx().currentTime;
    osc('sine', 880, t, 0.15, 0.2);
    osc('sine', 660, t + 0.12, 0.2, 0.18);
  },

  // Order expired — sad descending trombone
  orderExpired() {
    const t = ctx().currentTime;
    const c = ctx();
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(400, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.4);
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    o.connect(g); g.connect(c.destination);
    o.start(t); o.stop(t + 0.5);
  },

  // Countdown tick (how-to-play countdown)
  tick() {
    const t = ctx().currentTime;
    osc('sine', 1000, t, 0.05, 0.15);
  },

  // Countdown GO!
  go() {
    const t = ctx().currentTime;
    osc('triangle', 523, t, 0.1, 0.25);
    osc('triangle', 784, t + 0.08, 0.1, 0.25);
    osc('triangle', 1047, t + 0.16, 0.15, 0.3);
    osc('sine', 1568, t + 0.24, 0.2, 0.2);
  },

  // Game over — dramatic finish
  gameOver() {
    const t = ctx().currentTime;
    [784, 659, 523, 392].forEach((f, i) => {
      osc('triangle', f, t + i * 0.15, 0.3, 0.2);
    });
    // Final chord
    setTimeout(() => {
      const t2 = ctx().currentTime;
      osc('sine', 523, t2, 0.5, 0.15);
      osc('sine', 659, t2, 0.5, 0.12);
      osc('sine', 784, t2, 0.5, 0.12);
    }, 700);
  },

  // Player joined lobby — welcome bloop
  playerJoined() {
    const t = ctx().currentTime;
    osc('sine', 440, t, 0.08, 0.15);
    osc('sine', 660, t + 0.06, 0.1, 0.18);
  },

  // Button click — subtle blip
  click() {
    const t = ctx().currentTime;
    osc('sine', 600, t, 0.04, 0.1);
  },
};
