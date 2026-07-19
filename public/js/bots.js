// ============================================================
// 3D bot AI. A brain drives a regular player entity through
// p.bot.wish / wantFire / wantJump, so physics & combat are the
// exact same code path as humans. Difficulty (aim error,
// reaction time, burst discipline) comes from BOT_LEVELS.
// ============================================================

import { GAME } from './config.js';
import { clamp, lerpAngle, segmentBlocked } from './util.js';
import { BOT_NAMES } from './i18n.js';

export function botName(i) {
  return `🤖 ${BOT_NAMES[i % BOT_NAMES.length]}-${(Math.random() * 90 + 10) | 0}`;
}

export function attachBrains(game) {
  for (const p of game.players.values()) {
    if (p.bot && !p.bot.brain) {
      p.bot.brain = p.bot.zombie ? new ZombieBrain(p, game) : new BotBrain(p, game);
    }
  }
}

// ============================================================
// Zombies: relentless pursuit, melee swipes / acid spit.
// Simpler than soldier bots — they always know where you are,
// but they're slow and dumb about obstacles (by design).
// ============================================================
class ZombieBrain {
  constructor(p, game) {
    this.p = p;
    this.game = game;
    this.attackCd = 0;
    this.zig = Math.random() * Math.PI * 2;
    this.stuckT = 0;
    this.lastX = p.x; this.lastZ = p.z;
    p.bot.wish = { x: 0, z: 0 };
  }

  update(dt) {
    const p = this.p, g = this.game;
    const Z = p.bot.zdef;
    this.attackCd = Math.max(0, this.attackCd - dt);

    // nearest living human
    let t = null, td = Infinity;
    for (const q of g.players.values()) {
      if (q.bot || !q.alive) continue;
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d < td) { td = d; t = q; }
    }
    if (!t) { p.bot.wish.x = p.bot.wish.z = 0; return; }

    const nx = (t.x - p.x) / (td || 1), nz = (t.z - p.z) / (td || 1);
    p.yaw = Math.atan2(-nx, -nz);
    const dy = (t.y + 1.1) - (p.y + GAME.eyeHeight);
    p.pitch = clamp(-Math.atan2(dy, td), -1, 1);

    // runners zigzag; everyone else beelines
    this.zig += dt * 3;
    const zigAmt = p.bot.zombie === 'runner' ? 0.5 : 0.12;
    p.bot.wish.x = nx + -nz * Math.sin(this.zig) * zigAmt;
    p.bot.wish.z = nz + nx * Math.sin(this.zig) * zigAmt;
    const wl = Math.hypot(p.bot.wish.x, p.bot.wish.z) || 1;
    p.bot.wish.x /= wl; p.bot.wish.z /= wl;

    // attack
    if (this.attackCd <= 0 && td < Z.range * 1.05 && Math.abs((t.y) - p.y) < 2.2) {
      this.attackCd = Z.rate;
      this.game.zombieAttack(p, t);
    }

    // stuck → hop
    const moved = Math.hypot(p.x - this.lastX, p.z - this.lastZ);
    this.lastX = p.x; this.lastZ = p.z;
    if (moved < 0.3 * dt * Z.speed) {
      this.stuckT += dt;
      if (this.stuckT > 0.6) { if (p.grounded) p.bot.wantJump = true; this.stuckT = 0; }
    } else this.stuckT = 0;
  }
}

class BotBrain {
  constructor(p, game) {
    this.p = p;
    this.game = game;
    this.L = p.bot.level;
    this.target = null;
    this.seenAt = -1;         // when the current target was first seen
    this.lastSeenPos = null;
    this.retargetT = 0;
    this.wanderPt = null;
    this.strafeDir = Math.random() < 0.5 ? -1 : 1;
    this.strafeT = 0;
    this.burstLeft = 0;
    this.pauseT = 0;
    this.stuckT = 0;
    this.lastX = p.x; this.lastZ = p.z;
    p.bot.wish = { x: 0, z: 0 };
  }

  update(dt) {
    const p = this.p, g = this.game;
    this.retargetT -= dt;
    this.strafeT -= dt;
    this.pauseT -= dt;
    if (this.strafeT <= 0) { this.strafeT = 1 + Math.random() * 1.6; this.strafeDir *= -1; }

    if (this.retargetT <= 0) {
      this.retargetT = 0.35 + Math.random() * 0.3;
      this._pickTarget();
    }

    const t = this.target;
    const visible = t && t.alive && this._canSee(t);
    if (visible) {
      this.lastSeenPos = { x: t.x, y: t.y, z: t.z };
      if (this.seenAt < 0) this.seenAt = g.elapsed;
    } else {
      this.seenAt = -1;
    }

    if (visible) this._combat(t, dt);
    else this._roam(dt);

    // stuck detection → jump or new wander point
    const moved = Math.hypot(p.x - this.lastX, p.z - this.lastZ);
    this.lastX = p.x; this.lastZ = p.z;
    const wantsMove = Math.hypot(p.bot.wish.x, p.bot.wish.z) > 0.3;
    if (wantsMove && moved < 0.35 * dt * this.L.speed) {
      this.stuckT += dt;
      if (this.stuckT > 0.5) {
        if (Math.random() < 0.5 && p.grounded) p.bot.wantJump = true;
        else this.wanderPt = this._randomNav();
        this.stuckT = 0;
      }
    } else this.stuckT = 0;
  }

  _pickTarget() {
    const p = this.p, g = this.game;
    let best = null, bestScore = Infinity;
    for (const q of g.players.values()) {
      if (q === p || !q.alive) continue;
      if ((g.teamplay || g.mode === 'ctf') && q.team === p.team) continue;
      if (!g.teamplay && q.bot && Math.random() < 0.6) continue; // FFA bots prefer humans
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      const score = d + (this._canSee(q) ? 0 : 25);
      if (score < bestScore) { bestScore = score; best = q; }
    }
    this.target = best;
  }

  _canSee(q) {
    const p = this.p;
    const d = Math.hypot(q.x - p.x, q.z - p.z);
    if (d > 55) return false;
    return !segmentBlocked(
      p.x, p.y + GAME.eyeHeight, p.z,
      q.x, q.y + 1.3, q.z,
      this.game.world.colliders,
    );
  }

  _combat(t, dt) {
    const p = this.p, L = this.L;
    const dx = t.x - p.x, dz = t.z - p.z;
    const d = Math.hypot(dx, dz) || 1;

    // aim with human-ish error, smoothed turn
    const err = L.aimErr * (1 + d / 40);
    const wantYaw = Math.atan2(-dx, -dz) + (Math.random() - 0.5) * err * 6;
    p.yaw = lerpAngle(p.yaw, wantYaw, clamp(dt * 7, 0, 1));
    const dy = (t.y + 1.2) - (p.y + GAME.eyeHeight);
    p.pitch = clamp(-Math.atan2(dy, d) + (Math.random() - 0.5) * err * 3, -1.2, 1.2);

    // hold an 8–18m band, orbit-strafe
    const band = clamp((d - 12) / 8, -1, 1);
    const nx = dx / d, nz = dz / d;
    const px = -nz * this.strafeDir, pz = nx * this.strafeDir;
    let wx = nx * band + px * 0.8;
    let wz = nz * band + pz * 0.8;
    const wl = Math.hypot(wx, wz) || 1;
    p.bot.wish.x = wx / wl;
    p.bot.wish.z = wz / wl;

    // burst fire after reaction delay
    const reacted = this.seenAt >= 0 && (this.game.elapsed - this.seenAt) * 1000 >= L.reactMs;
    if (reacted && this.pauseT <= 0) {
      if (this.burstLeft <= 0) this.burstLeft = L.burst;
      const aimErrNow = Math.abs(lerpAngle(p.yaw, wantYaw, 1) - p.yaw);
      if (aimErrNow < 0.25 && d < 50) {
        p.bot.wantFire = true;
        this.burstLeft--;
        if (this.burstLeft <= 0) this.pauseT = L.pause * (0.7 + Math.random() * 0.6);
      }
    }
    if (Math.random() < 0.004 && p.grounded) p.bot.wantJump = true;

    // ---- building AI (build modes only) ----
    if (this.game.canBuild) this._buildTactics(t, d, dx, dz);
  }

  // wall up when under fire, ramp toward the target to push high ground
  _buildTactics(t, d, dx, dz) {
    const p = this.p, g = this.game;
    if ((p.bot.buildCd || 0) > 0) return;
    const recentlyHit = p.bot.underFire && (g.elapsed - p.bot.underFire) < 1.4;
    const skill = { easy: 0.15, normal: 0.4, hard: 0.75 }[this.game.botLevel] ?? 0.4;

    // face the threat so the wall drops between us and them
    if (recentlyHit || (d < 22 && this.seenAt >= 0)) {
      p.yaw = Math.atan2(-dx, -dz);
      // defensive wall — chance scales with difficulty
      if (Math.random() < skill) { p.bot.wantBuild = 'w'; return; }
    }
    // push: ramp up when the target is higher or far, sometimes rush a ramp
    if (d > 14 && p.grounded && Math.random() < skill * 0.25) {
      p.yaw = Math.atan2(-dx, -dz);
      p.bot.wantBuild = 'r';
      p.bot.wantJump = true;   // hop onto the ramp
    }
  }

  _roam(dt) {
    const p = this.p;
    // objective (e.g. tactical plant/defuse site) pulls idle bots toward it
    const goal = this.lastSeenPos || p.bot.objective || this.wanderPt || (this.wanderPt = this._randomNav());
    const dx = goal.x - p.x, dz = goal.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 2.2) {
      if (this.lastSeenPos) this.lastSeenPos = null;
      this.wanderPt = this._randomNav();
      return;
    }
    const wantYaw = Math.atan2(-dx, -dz);
    p.yaw = lerpAngle(p.yaw, wantYaw, clamp(dt * 5, 0, 1));
    p.pitch = lerpAngle(p.pitch, 0, dt * 3);
    p.bot.wish.x = dx / d;
    p.bot.wish.z = dz / d;
  }

  _randomNav() {
    const nav = this.game.world.navPoints;
    return nav[(Math.random() * nav.length) | 0];
  }
}
