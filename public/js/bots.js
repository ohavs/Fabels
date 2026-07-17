// ============================================================
// Bot AI — offline practice opponents & co-op teammates.
// A bot drives a regular player entity via botMove/botAim/botFire,
// so the simulation treats bots exactly like local players.
// ============================================================

import { dist, clamp, TAU } from './util.js';
import { GAME } from './config.js';

export class BotBrain {
  constructor(p, game, difficulty = 1) {
    this.p = p;                 // the player entity this brain drives
    this.game = game;
    this.aimErr = 0.3 / difficulty;
    this.retargetT = 0;
    this.strafeDir = Math.random() < 0.5 ? -1 : 1;
    this.strafeT = 0;
    this.target = null;
    this.wander = Math.random() * TAU;
  }

  update(dt) {
    const p = this.p;
    if (!p.alive) { p.botFire = false; return; }

    this.retargetT -= dt;
    this.strafeT -= dt;
    if (this.strafeT <= 0) {
      this.strafeT = 1 + Math.random() * 2;
      this.strafeDir = -this.strafeDir;
    }
    if (this.retargetT <= 0) {
      this.retargetT = 0.6 + Math.random() * 0.6;
      this.target = this._pickTarget();
    }

    const t = this.target;
    if (!t || t.hp <= 0 || (t.alive === false)) {
      // wander toward arena center-ish
      this.wander += (Math.random() - 0.5) * 1.5 * dt;
      p.botMove = { x: Math.cos(this.wander) * 0.5, y: Math.sin(this.wander) * 0.5 };
      p.botFire = false;
      return;
    }

    const d = dist(p.x, p.y, t.x, t.y);
    const dirX = (t.x - p.x) / (d || 1);
    const dirY = (t.y - p.y) / (d || 1);

    // keep a comfortable combat range, orbit-strafe around the target
    const desired = this.game.mode === 'pvp' ? 300 : 240;
    const approach = clamp((d - desired) / 220, -1, 1);
    const perpX = -dirY * this.strafeDir;
    const perpY = dirX * this.strafeDir;
    let mx = dirX * approach + perpX * 0.75;
    let my = dirY * approach + perpY * 0.75;

    // soft wall avoidance
    const A = GAME.arena, pad = 180;
    if (p.x < pad) mx += 1; if (p.x > A - pad) mx -= 1;
    if (p.y < pad) my += 1; if (p.y > A - pad) my -= 1;

    const ml = Math.hypot(mx, my) || 1;
    p.botMove = { x: mx / ml, y: my / ml };

    // aim with human-ish error + light lead
    const lead = clamp(d / 640, 0, 0.5);
    const ax = t.x + (t.vx || 0) * lead - p.x;
    const ay = t.y + (t.vy || 0) * lead - p.y;
    const aa = Math.atan2(ay, ax) + (Math.random() - 0.5) * this.aimErr;
    p.botAim = { x: Math.cos(aa), y: Math.sin(aa) };
    p.botFire = d < 700;

    // occasional dash when hurt or too close
    if ((p.hp < p.maxHp * 0.3 || d < 120) && p.dashCd <= 0 && Math.random() < 0.02) {
      p.botDash = true;
    }
    if (p.specialCd <= 0 && d < 350 && Math.random() < 0.008) p.botSpecial = true;
  }

  _pickTarget() {
    const g = this.game, p = this.p;
    let best = null, bestD = Infinity;
    if (g.mode === 'coop') {
      for (const e of g.enemies.values()) {
        if (e.hp <= 0) continue;
        const d = dist(p.x, p.y, e.x, e.y);
        if (d < bestD) { bestD = d; best = e; }
      }
    } else {
      for (const q of g.players.values()) {
        if (q === p || !q.alive) continue;
        const d = dist(p.x, p.y, q.x, q.y);
        if (d < bestD) { bestD = d; best = q; }
      }
    }
    return best;
  }
}
