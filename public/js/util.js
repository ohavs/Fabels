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

// ---- 3D helpers (plain math — keeps hit detection identical on all clients) ----

// ray vs AABB slab test; returns entry distance t or Infinity
export function rayAABB(ox, oy, oz, dx, dy, dz, b) {
  let tmin = 0, tmax = Infinity;
  const axes = [[ox, dx, b.x0, b.x1], [oy, dy, b.y0, b.y1], [oz, dz, b.z0, b.z1]];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return Infinity;
    } else {
      let t1 = (lo - o) / d, t2 = (hi - o) / d;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin;
}

// ray vs sphere; returns t or Infinity
export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return Infinity;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return Infinity;
  return tca - Math.sqrt(r2 - d2);
}

// is the straight segment a→b blocked by any collider?
export function segmentBlocked(ax, ay, az, bx, by, bz, colliders) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.hypot(dx, dy, dz) || 1;
  const nx = dx / len, ny = dy / len, nz = dz / len;
  for (const c of colliders) {
    const t = rayAABB(ax, ay, az, nx, ny, nz, c);
    if (t < len) return true;
  }
  return false;
}

export const fmtTime = (sec) => {
  sec = Math.max(0, Math.ceil(sec));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
};

export const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
