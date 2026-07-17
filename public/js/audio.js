// ============================================================
// Procedural WebAudio SFX — no audio files anywhere.
// Gunshots, impacts and UI cues synthesized from oscillators + noise.
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
    master.gain.value = 0.32;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

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

function noise({ dur = 0.2, vol = 0.4, f = 1200, delay = 0, hp = 0 }) {
  if (!enabled || !ensureCtx()) return;
  const t0 = ctx.currentTime + delay;
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const flt = ctx.createBiquadFilter();
  flt.type = hp ? 'highpass' : 'lowpass';
  flt.frequency.setValueAtTime(hp || f, t0);
  if (!hp) flt.frequency.exponentialRampToValueAtTime(80, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(flt).connect(g).connect(master);
  src.start(t0);
}

// gunshot profiles per weapon
const GUNS = {
  pistol:  () => { noise({ dur: 0.09, vol: 0.5, f: 2400 }); tone({ type: 'square', f0: 240, f1: 90, dur: 0.07, vol: 0.3 }); },
  smg:     () => { noise({ dur: 0.06, vol: 0.38, f: 2800 }); tone({ type: 'square', f0: 320, f1: 140, dur: 0.05, vol: 0.22 }); },
  shotgun: () => { noise({ dur: 0.28, vol: 0.7, f: 1600 }); tone({ type: 'sine', f0: 110, f1: 40, dur: 0.25, vol: 0.5 }); },
  rifle:   () => { noise({ dur: 0.09, vol: 0.45, f: 3000 }); tone({ type: 'sawtooth', f0: 260, f1: 100, dur: 0.07, vol: 0.26 }); },
  lmg:     () => { noise({ dur: 0.08, vol: 0.42, f: 2200 }); tone({ type: 'square', f0: 200, f1: 80, dur: 0.07, vol: 0.3 }); },
  sniper:  () => { noise({ dur: 0.4, vol: 0.75, f: 2000 }); tone({ type: 'sine', f0: 160, f1: 40, dur: 0.35, vol: 0.5 }); },
  plasma:  () => { tone({ type: 'sawtooth', f0: 900, f1: 240, dur: 0.22, vol: 0.4 }); tone({ type: 'sine', f0: 1400, f1: 500, dur: 0.16, vol: 0.25, delay: 0.02 }); },
  knife:   () => { noise({ dur: 0.12, vol: 0.3, hp: 3000 }); tone({ type: 'sine', f0: 700, f1: 1400, dur: 0.09, vol: 0.2 }); },
  botgun:  () => { noise({ dur: 0.07, vol: 0.3, f: 2000 }); tone({ type: 'triangle', f0: 300, f1: 130, dur: 0.06, vol: 0.2 }); },
};

export const SFX = {
  shoot(w) { (GUNS[w] || GUNS.pistol)(); },
  reload()   { tone({ type: 'square', f0: 500, f1: 300, dur: 0.05, vol: 0.2 }); tone({ type: 'square', f0: 350, f1: 550, dur: 0.06, vol: 0.2, delay: 0.14 }); },
  reloadDone(){ tone({ type: 'square', f0: 650, f1: 900, dur: 0.06, vol: 0.25 }); },
  hit()      { tone({ type: 'triangle', f0: 900, f1: 600, dur: 0.05, vol: 0.3 }); },
  headshot() { tone({ type: 'sine', f0: 1200, f1: 1800, dur: 0.08, vol: 0.35 }); tone({ type: 'sine', f0: 1800, f1: 2400, dur: 0.07, vol: 0.2, delay: 0.05 }); },
  hurt()     { tone({ type: 'sawtooth', f0: 180, f1: 60, dur: 0.18, vol: 0.4 }); noise({ dur: 0.12, vol: 0.2, f: 700 }); },
  die()      { noise({ dur: 0.5, vol: 0.5, f: 1200 }); tone({ type: 'sine', f0: 220, f1: 40, dur: 0.5, vol: 0.4 }); },
  explode()  { noise({ dur: 0.5, vol: 0.65, f: 1600 }); tone({ type: 'sine', f0: 110, f1: 28, dur: 0.45, vol: 0.55 }); },
  jump()     { tone({ type: 'sine', f0: 260, f1: 420, dur: 0.09, vol: 0.16 }); },
  land()     { noise({ dur: 0.07, vol: 0.18, f: 500 }); },
  tierUp()   { [520, 660, 880].forEach((f, i) => tone({ type: 'triangle', f0: f, f1: f, dur: 0.12, vol: 0.3, delay: i * 0.07 })); },
  tierDown() { [440, 330].forEach((f, i) => tone({ type: 'triangle', f0: f, f1: f * 0.9, dur: 0.16, vol: 0.3, delay: i * 0.1 })); },
  pickup()   { tone({ type: 'sine', f0: 660, f1: 990, dur: 0.09, vol: 0.3 }); },
  click()    { tone({ type: 'square', f0: 700, f1: 500, dur: 0.04, vol: 0.15 }); },
  win()      { [440, 554, 659, 880].forEach((f, i) => tone({ type: 'triangle', f0: f, f1: f, dur: 0.22, vol: 0.3, delay: i * 0.13 })); },
  lose()     { [392, 330, 262, 196].forEach((f, i) => tone({ type: 'triangle', f0: f, f1: f * 0.97, dur: 0.28, vol: 0.3, delay: i * 0.16 })); },
  countdown(){ tone({ type: 'sine', f0: 880, f1: 880, dur: 0.1, vol: 0.3 }); },
  go()       { tone({ type: 'sine', f0: 1320, f1: 1320, dur: 0.25, vol: 0.35 }); },
};
