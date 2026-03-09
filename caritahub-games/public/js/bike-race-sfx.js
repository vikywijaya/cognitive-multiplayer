'use strict';
/* ═══════════════════════════════════════════════
   Bike Race — Sound Effects (Web Audio API)
   TV host side: countdown, horn, crowd, fanfare
   Phone side  : pedal click, boost ding
   ═══════════════════════════════════════════════ */

const BikeRaceSFX = (() => {
  let ctx = null;

  function _ctx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  /** Pure tone */
  function tone(freq, dur, vol = 0.5, type = 'sine', delay = 0) {
    const c = _ctx();
    const t = c.currentTime + delay;
    const osc  = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain); gain.connect(c.destination);
    osc.start(t); osc.stop(t + dur + 0.05);
  }

  /** Frequency sweep (whoosh/horn) */
  function sweep(f0, f1, dur, vol = 0.5, type = 'sawtooth', delay = 0) {
    const c = _ctx();
    const t = c.currentTime + delay;
    const osc  = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain); gain.connect(c.destination);
    osc.start(t); osc.stop(t + dur + 0.05);
  }

  /** White noise burst (crowd roar, cheers) */
  function noise(dur, vol = 0.15, delay = 0) {
    const c    = _ctx();
    const t    = c.currentTime + delay;
    const size = Math.ceil(c.sampleRate * dur);
    const buf  = c.createBuffer(1, size, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < size; i++) data[i] = Math.random() * 2 - 1;
    const src  = c.createBufferSource();
    src.buffer = buf;
    const gain = c.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(gain); gain.connect(c.destination);
    src.start(t);
  }

  return {
    /** Countdown tick — 3=low red, 2=orange, 1=green */
    countTick(n) {
      const freqs = { 3: 330, 2: 440, 1: 660 };
      tone(freqs[n] || 440, 0.18, 0.65, 'square');
      noise(0.08, 0.06);
    },

    /** GO! — bike horn fanfare + crowd burst */
    go() {
      tone(523.25, 0.12, 0.8, 'sawtooth', 0.00);
      tone(659.25, 0.12, 0.8, 'sawtooth', 0.12);
      tone(783.99, 0.12, 0.8, 'sawtooth', 0.24);
      tone(1046.5,  0.5, 0.9, 'square',   0.36);
      sweep(300, 1200, 0.3, 0.3, 'sawtooth', 0.36); // horn blast
      noise(0.8, 0.25, 0.36); // crowd erupts
    },

    /** Leader change jingle */
    leaderChange() {
      tone(880,  0.1, 0.4, 'sine', 0.0);
      tone(1100, 0.15, 0.4, 'sine', 0.1);
      tone(1320, 0.2, 0.4, 'sine', 0.22);
    },

    /** Someone is in final stretch */
    finalStretch() {
      sweep(400, 700, 0.4, 0.3, 'sine');
      noise(0.4, 0.1);
    },

    /** Finish line crossed — victory fanfare */
    finish() {
      const notes = [523, 659, 784, 1047, 1319, 1568];
      notes.forEach((f, i) => tone(f, 0.22, 0.7, 'square', i * 0.09));
      sweep(200, 800, 0.6, 0.4, 'sawtooth', 0.2); // crowd cheer sweep
      noise(1.2, 0.3, 0.2); // sustained crowd roar
    },

    /** Smaller finish (2nd, 3rd) */
    finishSmall() {
      tone(880,  0.12, 0.5, 'sine');
      tone(1100, 0.2,  0.5, 'sine', 0.14);
      noise(0.4, 0.12, 0.1);
    },

    /** Rapid crowd cheer burst */
    crowd() {
      noise(0.3, 0.18);
    },

    /** Phone — pedal click */
    pedalClick(isAlternate) {
      if (isAlternate) {
        tone(220, 0.06, 0.35, 'square');
        tone(330, 0.04, 0.2, 'sine', 0.06);
      } else {
        tone(150, 0.05, 0.2, 'square');
      }
    },

    /** Phone — boost (alternating pedal reward) */
    boost() {
      sweep(300, 600, 0.12, 0.25, 'sine');
    },

    /** Unlock audio context on first user interaction */
    unlock() { _ctx(); },
  };
})();
