// ============================================================
// Math, seeded RNG and misc helpers
// ============================================================

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
export const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

// shortest-path angle interpolation
export function lerpAngle(a, b, t) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return a + d * t;
}

// Deterministic RNG (mulberry32) — same seed ⇒ same arena on every client
export function rng(seed) {
  let s = seed >>> 0;
  return function () {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const randId = (len = 8) =>
  Array.from(crypto.getRandomValues(new Uint8Array(len)), (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');

// 5-char room code, unambiguous uppercase
export const roomCode = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[b % 31]).join('');

export const now = () => performance.now();

export function circleHit(ax, ay, ar, bx, by, br) {
  const r = ar + br;
  return dist2(ax, ay, bx, by) < r * r;
}

// resolve circle out of circle, returns new [x, y]
export function pushOut(x, y, r, ox, oy, or_) {
  const d = dist(x, y, ox, oy);
  const min = r + or_;
  if (d >= min || d === 0) return null;
  const nx = (x - ox) / d, ny = (y - oy) / d;
  return [ox + nx * min, oy + ny * min];
}

export const fmtTime = (sec) => {
  sec = Math.max(0, Math.ceil(sec));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
};

export const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
