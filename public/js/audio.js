// ============================================================
// Procedural WebAudio SFX — no audio files anywhere.
// Each effect is synthesized from oscillators + noise.
// ============================================================

let ctx = null;
let master = null;
let enabled = true;

export function setSoundEnabled(v) { enabled = v; }
export function soundEnabled() { return enabled; }

function ensureCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// Must be called from a user gesture once (mobile autoplay policy)
export function unlockAudio() { ensureCtx(); }

function tone({ type = 'square', f0 = 440, f1 = f0, dur = 0.1, vol = 0.5, delay = 0 }) {
  if (!enabled || !ensureCtx()) return;
  const t0 = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function noise({ dur = 0.2, vol = 0.4, f = 1200, delay = 0 }) {
  if (!enabled || !ensureCtx()) return;
  const t0 = ctx.currentTime + delay;
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const flt = ctx.createBiquadFilter();
  flt.type = 'lowpass';
  flt.frequency.setValueAtTime(f, t0);
  flt.frequency.exponentialRampToValueAtTime(80, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(flt).connect(g).connect(master);
  src.start(t0);
}

export const SFX = {
  shoot(weapon = 'blaster') {
    const m = {
      blaster: { f0: 880, f1: 220, dur: 0.08, type: 'square', vol: 0.25 },
      spread:  { f0: 620, f1: 180, dur: 0.1,  type: 'sawtooth', vol: 0.22 },
      laser:   { f0: 1400, f1: 500, dur: 0.14, type: 'sine', vol: 0.3 },
      missile: { f0: 240, f1: 90,  dur: 0.25, type: 'sawtooth', vol: 0.3 },
      sting:   { f0: 500, f1: 300, dur: 0.09, type: 'triangle', vol: 0.18 },
    }[weapon] || {};
    tone(m);
  },
  hit()       { tone({ type: 'triangle', f0: 300, f1: 120, dur: 0.07, vol: 0.3 }); },
  hurt()      { tone({ type: 'sawtooth', f0: 180, f1: 60, dur: 0.18, vol: 0.4 }); noise({ dur: 0.12, vol: 0.2, f: 700 }); },
  explode()   { noise({ dur: 0.45, vol: 0.55, f: 1600 }); tone({ type: 'sine', f0: 120, f1: 30, dur: 0.4, vol: 0.5 }); },
  bigExplode(){ noise({ dur: 0.8, vol: 0.7, f: 2000 }); tone({ type: 'sine', f0: 90, f1: 24, dur: 0.7, vol: 0.6 }); },
  dash()      { tone({ type: 'sine', f0: 300, f1: 900, dur: 0.15, vol: 0.3 }); },
  special()   { tone({ type: 'sine', f0: 400, f1: 1200, dur: 0.3, vol: 0.35 }); tone({ type: 'sine', f0: 600, f1: 1800, dur: 0.3, vol: 0.2, delay: 0.05 }); },
  pickup()    { tone({ type: 'sine', f0: 660, f1: 990, dur: 0.09, vol: 0.3 }); tone({ type: 'sine', f0: 990, f1: 1320, dur: 0.09, vol: 0.25, delay: 0.07 }); },
  wave()      { tone({ type: 'sawtooth', f0: 140, f1: 280, dur: 0.5, vol: 0.35 }); tone({ type: 'sawtooth', f0: 140, f1: 280, dur: 0.5, vol: 0.25, delay: 0.25 }); },
  boss()      { tone({ type: 'sawtooth', f0: 80, f1: 160, dur: 1.0, vol: 0.5 }); noise({ dur: 0.9, vol: 0.25, f: 400, delay: 0.1 }); },
  click()     { tone({ type: 'square', f0: 700, f1: 500, dur: 0.04, vol: 0.15 }); },
  win()       { [440, 554, 659, 880].forEach((f, i) => tone({ type: 'triangle', f0: f, f1: f, dur: 0.22, vol: 0.3, delay: i * 0.13 })); },
  lose()      { [392, 330, 262, 196].forEach((f, i) => tone({ type: 'triangle', f0: f, f1: f * 0.97, dur: 0.28, vol: 0.3, delay: i * 0.16 })); },
  countdown() { tone({ type: 'sine', f0: 880, f1: 880, dur: 0.1, vol: 0.3 }); },
  go()        { tone({ type: 'sine', f0: 1320, f1: 1320, dur: 0.25, vol: 0.35 }); },
};
