// ============================================================
// Core simulation — runs identically online and offline.
//
// Authority model (online):
//   • every client fully simulates ITS OWN ship (and nothing else's)
//   • remote ships are interpolated from network state
//   • damage to remote ships → onHitRemote event (victim applies it)
//   • co-op enemies: host simulates, guests interpolate + report edmg
// Offline (practice): everything is local, bots included.
// ============================================================

import {
  GAME, WEAPONS, ENEMIES, SPECIALS,
  waveBudget, bossWave, bossHp,
} from './config.js';
import { TAU, clamp, lerp, lerpAngle, dist, rng, circleHit, pushOut, randId } from './util.js';
import { SFX } from './audio.js';
import { BotBrain } from './bots.js';
import { t } from './i18n.js';

export function genObstacles(seed) {
  const r = rng(seed);
  const A = GAME.arena;
  const obs = [];
  const spawns = spawnRing();
  outer:
  for (let i = 0; i < 60 && obs.length < 14; i++) {
    const o = {
      x: 140 + r() * (A - 280),
      y: 140 + r() * (A - 280),
      r: 40 + r() * 55,
      hue: 180 + r() * 120,
      sides: 5 + Math.floor(r() * 3),
      rot: r() * TAU,
    };
    for (const s of spawns) if (dist(o.x, o.y, s.x, s.y) < o.r + 150) continue outer;
    for (const q of obs) if (dist(o.x, o.y, q.x, q.y) < o.r + q.r + 60) continue outer;
    obs.push(o);
  }
  return obs;
}

export function spawnRing() {
  const A = GAME.arena, c = A / 2, R = A * 0.38;
  const pts = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    pts.push({ x: c + Math.cos(a) * R, y: c + Math.sin(a) * R });
  }
  return pts;
}

export class Game {
  /**
   * @param {object} o
   *  mode 'pvp'|'coop' · online bool · isHost bool · seed int
   *  input Input · timeFn ()=>epoch ms · endAt epoch ms (pvp)
   */
  constructor(o) {
    this.mode = o.mode;
    this.online = !!o.online;
    this.isHost = o.isHost !== false;
    this.seed = o.seed ?? (Math.random() * 1e9) | 0;
    this.input = o.input || null;
    this.timeFn = o.timeFn || (() => Date.now());
    this.endAt = o.endAt || 0;

    this.obstacles = genObstacles(this.seed);
    this.spawns = spawnRing();
    this.rand = rng(this.seed ^ 0x9e3779b9);

    this.players = new Map();
    this.bullets = [];
    this.enemies = new Map();
    this.pickups = new Map();
    this.particles = [];
    this.floats = [];
    this.feed = [];              // [{text, t}] for the killfeed UI
    this.me = null;

    this.wave = 0;
    this.waveDelay = 2.5;        // seconds until next wave spawns
    this.pickupT = GAME.pickupEveryMs / 1000;
    this.over = null;            // set once → results object
    this.cam = { x: GAME.arena / 2, y: GAME.arena / 2, shake: 0 };
    this.elapsed = 0;

    // external hooks (wired by net.js / main.js)
    this.onShot = null;          // (shotSpec) local player fired
    this.onHitRemote = null;     // (toUid, dmg) I hit a remote ship
    this.onSelfDeath = null;     // (killerUid) my ship died
    this.onSelfState = null;
    this.onEnemyDamage = null;   // (id, dmg) guest → host
    this.onEnemyShot = null;     // (spec) host → guests
    this.onPickupTaken = null;   // (id)
    this.onPickupSpawn = null;   // (pickup) host
    this.onWave = null;          // (n) host
    this.onOver = null;          // (results)
    this.onKill = null;          // ({from, to}) my death report, online
  }

  // ---------------- players ----------------
  _basePlayer(uid, name, stats, ship) {
    return {
      uid, name, ship,
      hue: stats.hue, weapon: stats.weapon, special: stats.special,
      maxHp: stats.hp, hp: stats.hp,
      speed: stats.speed, dmgMul: stats.dmgMul ?? 1, rateMul: stats.rateMul ?? 1,
      x: 0, y: 0, a: 0, vx: 0, vy: 0, r: 16,
      alive: true, respawnT: 0, invulnT: GAME.invulnTime,
      fireCd: 0, dashCd: 0, specialCd: 0,
      overdriveT: 0, shieldT: 0,
      score: 0, kills: 0, deaths: 0, shardsGot: 0,
      local: false, bot: null, remote: false,
      // remote interpolation targets
      netX: 0, netY: 0, netA: 0, netVx: 0, netVy: 0,
      chatTxt: '', chatT: 0,
    };
  }

  _placeAtSpawn(p, idx = this.players.size % this.spawns.length) {
    const s = this.spawns[idx % this.spawns.length];
    p.x = p.netX = s.x; p.y = p.netY = s.y;
    p.a = Math.atan2(GAME.arena / 2 - s.y, GAME.arena / 2 - s.x);
  }

  addLocal(uid, name, stats, ship, spawnIdx) {
    const p = this._basePlayer(uid, name, stats, ship);
    p.local = true;
    this._placeAtSpawn(p, spawnIdx);
    this.players.set(uid, p);
    this.me = p;
    this.cam.x = p.x; this.cam.y = p.y;
    return p;
  }

  addBot(name, stats, ship, difficulty = 1) {
    const uid = 'bot_' + randId(5);
    const p = this._basePlayer(uid, name, stats, ship);
    this._placeAtSpawn(p);
    p.bot = new BotBrain(p, this, difficulty);
    p.botMove = { x: 0, y: 0 }; p.botAim = { x: 1, y: 0 };
    p.botFire = false; p.botDash = false; p.botSpecial = false;
    this.players.set(uid, p);
    return p;
  }

  upsertRemote(uid, st) {
    let p = this.players.get(uid);
    if (!p) {
      p = this._basePlayer(uid, st.name || '???', {
        hp: st.maxHp || 100, speed: 260, hue: st.hue ?? 190,
        weapon: st.weapon || 'blaster', special: 'overdrive',
      }, st.ship || 'storm');
      p.remote = true;
      p.x = p.netX = st.x; p.y = p.netY = st.y;
      this.players.set(uid, p);
      this.feed.push({ text: t('playerJoined', { name: p.name }), t: 5 });
    }
    // detect death / respawn edges for local effects
    if (p.alive && st.alive === false) {
      p.alive = false;
      this._explosion(p.x, p.y, p.hue, 26);
      SFX.explode();
    } else if (!p.alive && st.alive) {
      p.alive = true;
      p.x = p.netX = st.x; p.y = p.netY = st.y;
      p.invulnT = GAME.invulnTime;
    }
    p.name = st.name ?? p.name;
    p.ship = st.ship ?? p.ship;
    p.hue = st.hue ?? p.hue;
    p.weapon = st.weapon ?? p.weapon;
    p.netX = st.x; p.netY = st.y; p.netA = st.a || 0;
    p.netVx = st.vx || 0; p.netVy = st.vy || 0;
    p.hp = st.hp; p.maxHp = st.maxHp || p.maxHp;
    p.kills = st.kills || 0; p.deaths = st.deaths || 0; p.score = st.score || 0;
    return p;
  }

  removePlayer(uid) {
    const p = this.players.get(uid);
    if (!p) return;
    if (p.alive) this._explosion(p.x, p.y, p.hue, 14);
    this.feed.push({ text: t('playerLeft', { name: p.name }), t: 5 });
    this.players.delete(uid);
  }

  creditKill(uid, victimName) {
    const p = this.players.get(uid);
    if (!p) return;
    p.kills++; p.score += 100;
    if (p === this.me) {
      this.feed.push({ text: t('youKilled', { name: victimName }), t: 4 });
    }
  }

  showChat(uid, key) {
    const p = this.players.get(uid);
    if (!p) return;
    p.chatTxt = t('chat_' + key);
    p.chatT = 2.6;
  }

  // ---------------- main step ----------------
  update(dt) {
    if (this.over) { this._fx(dt); return; }
    dt = Math.min(dt, 0.05);
    this.elapsed += dt;

    for (const p of this.players.values()) {
      this._tickTimers(p, dt);
      if (p.remote) this._interpRemote(p, dt);
      else this._controlAndMove(p, dt);
    }
    this._playersSoftPush();
    this._updateBullets(dt);
    if (this.mode === 'coop') this._updateEnemies(dt);
    this._updatePickups(dt);
    this._checkEnd();
    this._fx(dt);

    // camera follows me (even dead — spectate own wreck)
    if (this.me) {
      this.cam.x = lerp(this.cam.x, this.me.x, 1 - Math.pow(0.001, dt));
      this.cam.y = lerp(this.cam.y, this.me.y, 1 - Math.pow(0.001, dt));
    }
  }

  _tickTimers(p, dt) {
    p.fireCd = Math.max(0, p.fireCd - dt);
    p.dashCd = Math.max(0, p.dashCd - dt);
    p.specialCd = Math.max(0, p.specialCd - dt);
    p.invulnT = Math.max(0, p.invulnT - dt);
    p.overdriveT = Math.max(0, p.overdriveT - dt);
    p.shieldT = Math.max(0, p.shieldT - dt);
    p.chatT = Math.max(0, p.chatT - dt);
    if (!p.alive && !p.remote) {
      p.respawnT -= dt;
      if (p.respawnT <= 0) this._respawn(p);
    }
  }

  _respawn(p) {
    const s = this.spawns[(Math.random() * this.spawns.length) | 0];
    p.x = s.x; p.y = s.y; p.vx = p.vy = 0;
    p.hp = p.maxHp;
    p.alive = true;
    p.invulnT = GAME.invulnTime;
  }

  _controlAndMove(p, dt) {
    if (p.alive) {
      let mx = 0, my = 0, aimX = 0, aimY = 0, fire = false, dash = false, special = false, chat = -1;
      if (p.local && this.input) {
        this.input.update();
        mx = this.input.move.x; my = this.input.move.y;
        aimX = this.input.aim.x; aimY = this.input.aim.y;
        fire = this.input.firing;
        dash = this.input.consumeDash();
        special = this.input.consumeSpecial();
        chat = this.input.consumeChat();
        if (chat >= 0 && this.onChat) this.onChat(chat);
      } else if (p.bot) {
        p.bot.update(dt);
        mx = p.botMove.x; my = p.botMove.y;
        aimX = p.botAim.x; aimY = p.botAim.y;
        fire = p.botFire;
        dash = p.botDash; p.botDash = false;
        special = p.botSpecial; p.botSpecial = false;
      }

      // facing: aim while firing, else movement direction
      const moving = Math.hypot(mx, my) > 0.05;
      if (fire || Math.hypot(aimX, aimY) > 0.5) p.a = Math.atan2(aimY, aimX);
      else if (moving) p.a = lerpAngle(p.a, Math.atan2(my, mx), 1 - Math.pow(0.0001, dt));

      // acceleration + friction
      const accel = p.speed * 6;
      p.vx += mx * accel * dt;
      p.vy += my * accel * dt;
      const fr = Math.pow(0.0025, dt);
      p.vx *= fr; p.vy *= fr;
      const sp = Math.hypot(p.vx, p.vy);
      const maxSp = p.speed * (p.overdriveT > 0 ? 1.15 : 1);
      if (sp > maxSp) { p.vx *= maxSp / sp; p.vy *= maxSp / sp; }

      if (dash && p.dashCd <= 0) this._dash(p, mx, my);
      if (special && p.specialCd <= 0) this._special(p);
      if (fire && p.fireCd <= 0) this._fire(p);

      // thruster trail
      if (sp > 60 && Math.random() < dt * 30) {
        this.particles.push({
          x: p.x - Math.cos(p.a) * 14, y: p.y - Math.sin(p.a) * 14,
          vx: -p.vx * 0.2 + (Math.random() - 0.5) * 30, vy: -p.vy * 0.2 + (Math.random() - 0.5) * 30,
          life: 0.35, maxLife: 0.35, size: 3.2, hue: p.hue, glow: true,
        });
      }
    } else {
      p.vx *= Math.pow(0.01, dt); p.vy *= Math.pow(0.01, dt);
    }

    p.x += p.vx * dt; p.y += p.vy * dt;
    this._collideWorld(p);
  }

  _interpRemote(p, dt) {
    // extrapolate the network target by its velocity, then chase it
    p.netX += p.netVx * dt; p.netY += p.netVy * dt;
    const k = 1 - Math.pow(0.00005, dt);
    p.x = lerp(p.x, p.netX, k);
    p.y = lerp(p.y, p.netY, k);
    p.a = lerpAngle(p.a, p.netA, k);
    if (dist(p.x, p.y, p.netX, p.netY) > 300) { p.x = p.netX; p.y = p.netY; }
  }

  _collideWorld(p) {
    const pad = 20;
    p.x = clamp(p.x, pad, GAME.arena - pad);
    p.y = clamp(p.y, pad, GAME.arena - pad);
    for (const o of this.obstacles) {
      const res = pushOut(p.x, p.y, p.r, o.x, o.y, o.r);
      if (res) { [p.x, p.y] = res; }
    }
  }

  _playersSoftPush() {
    const arr = [...this.players.values()].filter((p) => p.alive && !p.remote);
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i], b = arr[j];
        const d = dist(a.x, a.y, b.x, b.y), min = a.r + b.r;
        if (d < min && d > 0) {
          const push = (min - d) / 2, nx = (a.x - b.x) / d, ny = (a.y - b.y) / d;
          a.x += nx * push; a.y += ny * push;
          b.x -= nx * push; b.y -= ny * push;
        }
      }
    }
  }

  // ---------------- combat ----------------
  _dash(p, mx, my) {
    p.dashCd = GAME.dashCd;
    let dx = mx, dy = my;
    if (Math.hypot(dx, dy) < 0.1) { dx = Math.cos(p.a); dy = Math.sin(p.a); }
    const l = Math.hypot(dx, dy) || 1;
    p.vx = (dx / l) * GAME.dashPower;
    p.vy = (dy / l) * GAME.dashPower;
    p.invulnT = Math.max(p.invulnT, 0.25);
    for (let i = 0; i < 10; i++) {
      this.particles.push({
        x: p.x, y: p.y,
        vx: -p.vx * 0.15 + (Math.random() - 0.5) * 80, vy: -p.vy * 0.15 + (Math.random() - 0.5) * 80,
        life: 0.4, maxLife: 0.4, size: 3, hue: p.hue, glow: true,
      });
    }
    if (p === this.me || !this.online) SFX.dash();
  }

  _special(p) {
    p.specialCd = GAME.specialCd;
    const S = SPECIALS[p.special] || {};
    switch (p.special) {
      case 'overdrive':
        p.overdriveT = S.dur;
        break;
      case 'blink': {
        const nx = p.x + Math.cos(p.a) * S.dist;
        const ny = p.y + Math.sin(p.a) * S.dist;
        this._explosion(p.x, p.y, p.hue, 8, 0.5);
        p.x = clamp(nx, 20, GAME.arena - 20);
        p.y = clamp(ny, 20, GAME.arena - 20);
        this._collideWorld(p);
        p.invulnT = Math.max(p.invulnT, 0.3);
        break;
      }
      case 'shield':
        p.shieldT = S.dur;
        break;
      case 'nova': {
        this._explosion(p.x, p.y, p.hue, 40, 1.6);
        this.cam.shake = Math.min(14, this.cam.shake + 10);
        const dmg = S.dmg * p.dmgMul;
        for (const q of this.players.values()) {
          if (q === p || !q.alive || this.mode === 'coop') continue;
          if (dist(p.x, p.y, q.x, q.y) < S.radius) this._damagePlayer(q, dmg, p.uid);
        }
        for (const e of this.enemies.values()) {
          if (dist(p.x, p.y, e.x, e.y) < S.radius) this._damageEnemy(e, dmg, p.uid);
        }
        break;
      }
    }
    SFX.special();
  }

  _fire(p) {
    const w = WEAPONS[p.weapon];
    p.fireCd = w.rate * p.rateMul * (p.overdriveT > 0 ? 0.5 : 1);
    const shot = { x: p.x + Math.cos(p.a) * 20, y: p.y + Math.sin(p.a) * 20, a: p.a, w: p.weapon };
    this._spawnBullets(shot, p.uid, p.dmgMul, false, p.hue);
    if (p.local && this.onShot) this.onShot(shot);
    SFX.shoot(p.weapon);
  }

  // spawn bullets from a shot spec; visual=true for remote players' shots
  _spawnBullets(shot, owner, dmgMul, visual, hue) {
    const w = WEAPONS[shot.w];
    for (let i = 0; i < w.pellets; i++) {
      const off = w.pellets > 1 ? (i - (w.pellets - 1) / 2) * w.spread : 0;
      const a = shot.a + off;
      this.bullets.push({
        x: shot.x, y: shot.y, a,
        vx: Math.cos(a) * w.speed, vy: Math.sin(a) * w.speed,
        r: w.r, dmg: w.dmg * dmgMul, life: w.life, weapon: shot.w,
        pierce: !!w.pierce, homing: !!w.homing,
        owner, team: 'p', visual, hue: hue ?? 190, hit: null,
      });
    }
  }

  applyRemoteShot(uid, shot) {
    const p = this.players.get(uid);
    this._spawnBullets(shot, uid, 1, true, p ? p.hue : 0);
    if (p && this.mode === 'coop' && !this.isHost) {
      // guests still hear teammates fight
      SFX.shoot(shot.w);
    }
  }

  spawnEnemyShot(spec) {
    const w = WEAPONS.sting;
    this.bullets.push({
      x: spec.x, y: spec.y, a: spec.a,
      vx: Math.cos(spec.a) * w.speed, vy: Math.sin(spec.a) * w.speed,
      r: w.r, dmg: w.dmg, life: w.life, weapon: 'sting',
      pierce: false, homing: false, owner: 'enemy', team: 'e', visual: false, hue: 0, hit: null,
    });
  }

  _updateBullets(dt) {
    const arr = this.bullets;
    for (let i = arr.length - 1; i >= 0; i--) {
      const b = arr[i];
      b.life -= dt;
      if (b.life <= 0) { arr.splice(i, 1); continue; }

      if (b.homing) this._homing(b, dt);
      b.x += b.vx * dt; b.y += b.vy * dt;

      if (b.x < 0 || b.y < 0 || b.x > GAME.arena || b.y > GAME.arena) { arr.splice(i, 1); continue; }

      let dead = false;
      for (const o of this.obstacles) {
        if (circleHit(b.x, b.y, b.r, o.x, o.y, o.r)) { this._spark(b.x, b.y, b.hue); dead = true; break; }
      }

      if (!dead && b.team === 'p') {
        // vs players (PvP) — my bullets damage, remote visuals just spark
        if (this.mode === 'pvp') {
          for (const q of this.players.values()) {
            if (q.uid === b.owner || !q.alive) continue;
            if (!circleHit(b.x, b.y, b.r, q.x, q.y, q.r)) continue;
            if (b.hit?.has(q.uid)) continue;
            this._spark(b.x, b.y, q.hue);
            if (!b.visual) this._damagePlayer(q, b.dmg, b.owner);
            if (b.pierce) { (b.hit ??= new Set()).add(q.uid); }
            else { dead = true; }
            break;
          }
        }
        // vs enemies (co-op)
        if (!dead && this.mode === 'coop' && !b.visual) {
          for (const e of this.enemies.values()) {
            if (e.hp <= 0) continue;
            if (!circleHit(b.x, b.y, b.r, e.x, e.y, e.r)) continue;
            if (b.hit?.has(e.id)) continue;
            this._spark(b.x, b.y, 0);
            this._damageEnemy(e, b.dmg, b.owner);
            if (b.pierce) { (b.hit ??= new Set()).add(e.id); }
            else { dead = true; }
            break;
          }
        }
      } else if (!dead && b.team === 'e') {
        // enemy bullets hurt only ships I simulate (mine + offline bots)
        for (const q of this.players.values()) {
          if (q.remote || !q.alive) continue;
          if (!circleHit(b.x, b.y, b.r, q.x, q.y, q.r)) continue;
          this._damagePlayer(q, b.dmg, 'enemy');
          dead = true;
          break;
        }
      }

      if (dead) arr.splice(i, 1);
    }
  }

  _homing(b, dt) {
    let best = null, bestD = 500 * 500;
    const consider = (x, y, id) => {
      const d = (b.x - x) ** 2 + (b.y - y) ** 2;
      if (d < bestD) { bestD = d; best = { x, y }; }
    };
    if (this.mode === 'coop') {
      for (const e of this.enemies.values()) if (e.hp > 0) consider(e.x, e.y, e.id);
    } else {
      for (const q of this.players.values()) if (q.alive && q.uid !== b.owner) consider(q.x, q.y, q.uid);
    }
    if (!best) return;
    const want = Math.atan2(best.y - b.y, best.x - b.x);
    b.a = lerpAngle(b.a, want, clamp(4 * dt, 0, 1));
    const sp = Math.hypot(b.vx, b.vy);
    b.vx = Math.cos(b.a) * sp; b.vy = Math.sin(b.a) * sp;
  }

  _damagePlayer(q, dmg, fromUid) {
    if (!q.alive || q.invulnT > 0 || q.shieldT > 0) return;
    if (q.remote) {
      // shooter side: report the hit, victim applies it
      if (this.onHitRemote) this.onHitRemote(q.uid, Math.round(dmg));
      this.floats.push({ x: q.x, y: q.y - 24, txt: String(Math.round(dmg)), life: 0.7, color: '#ffd166' });
      SFX.hit();
      return;
    }
    q.hp -= dmg;
    this.floats.push({ x: q.x, y: q.y - 24, txt: String(Math.round(dmg)), life: 0.7, color: q === this.me ? '#ff6b6b' : '#ffd166' });
    if (q === this.me) {
      this.cam.shake = Math.min(10, this.cam.shake + 3);
      SFX.hurt();
    } else SFX.hit();
    if (q.hp <= 0) this._killPlayer(q, fromUid);
  }

  // damage arriving from the network, targeting my own ship
  applyHitOnMe(dmg, fromUid) {
    if (this.me) this._damagePlayer(this.me, dmg, fromUid);
  }

  _killPlayer(q, fromUid) {
    q.hp = 0;
    q.alive = false;
    q.deaths++;
    q.respawnT = this.mode === 'pvp' ? GAME.respawnPvp : GAME.respawnCoop;
    this._explosion(q.x, q.y, q.hue, 30);
    SFX.explode();
    this.cam.shake = Math.min(16, this.cam.shake + (q === this.me ? 10 : 4));

    const killer = this.players.get(fromUid);
    if (!this.online) {
      // offline: credit directly & feed
      if (killer) { killer.kills++; killer.score += 100; }
      this.feed.push({
        text: t('kill', { a: killer ? killer.name : t('enemy_' + (this._lastEnemyKind || 'crawler')), b: q.name }),
        t: 5,
      });
    } else if (q === this.me) {
      // online: victim announces its own death; killer credited via event
      if (this.onSelfDeath) this.onSelfDeath(fromUid);
    }
  }

  // ---------------- enemies (co-op) ----------------
  _updateEnemies(dt) {
    const simulate = !this.online || this.isHost;

    if (simulate) {
      if (this.enemies.size === 0 && !this.over) {
        this.waveDelay -= dt;
        if (this.waveDelay <= 0) this._spawnWave(++this.wave);
      }
      for (const e of this.enemies.values()) this._enemyAI(e, dt);
    } else {
      for (const e of this.enemies.values()) {
        const k = 1 - Math.pow(0.0005, dt);
        e.x = lerp(e.x, e.netX, k); e.y = lerp(e.y, e.netY, k);
        e.a = lerpAngle(e.a, e.netA, k);
      }
    }

    // contact damage — every client applies to ships IT simulates
    for (const e of this.enemies.values()) {
      e.touchCd = Math.max(0, (e.touchCd || 0) - dt);
      if (e.hp <= 0 || e.touchCd > 0) continue;
      for (const q of this.players.values()) {
        if (q.remote || !q.alive) continue;
        if (circleHit(e.x, e.y, e.r, q.x, q.y, q.r)) {
          e.touchCd = 0.6;
          this._lastEnemyKind = e.kind;
          this._damagePlayer(q, e.dmg, 'enemy');
          break;
        }
      }
    }
  }

  _spawnWave(n) {
    this.waveDelay = 2.5;
    const boss = bossWave(n);
    const list = [];
    if (boss) {
      list.push('boss');
      for (let i = 0; i < 2 + n / 5; i++) list.push('crawler');
    } else {
      let budget = waveBudget(n);
      const kinds = ['crawler', 'crawler', 'stinger', n >= 3 ? 'crusher' : 'crawler'];
      while (budget > 0) {
        const k = kinds[(Math.random() * kinds.length) | 0];
        list.push(k);
        budget -= ENEMIES[k].cost;
      }
    }
    for (const kind of list) this._spawnEnemy(kind, n);
    this.feed.push({ text: boss ? t('bossIncoming') : t('waveIncoming', { n }), t: 4 });
    boss ? SFX.boss() : SFX.wave();
    if (this.onWave) this.onWave(n);
  }

  _spawnEnemy(kind, waveN) {
    const E = ENEMIES[kind];
    const id = 'e' + randId(5);
    const edge = (Math.random() * 4) | 0;
    const A = GAME.arena, m = 30;
    const pos = [
      [Math.random() * A, m], [Math.random() * A, A - m],
      [m, Math.random() * A], [A - m, Math.random() * A],
    ][edge];
    const hp = kind === 'boss' ? bossHp(waveN) : E.hp + Math.floor(waveN * 1.5);
    this.enemies.set(id, {
      id, kind, x: pos[0], y: pos[1], a: 0,
      hp, maxHp: hp, speed: E.speed, dmg: E.dmg, r: E.r,
      score: E.score, shards: E.shards,
      fireCd: 1 + Math.random(), abilityCd: 3, touchCd: 0.8,
      netX: pos[0], netY: pos[1], netA: 0,
    });
  }

  _enemyAI(e, dt) {
    if (e.hp <= 0) return;
    const target = this._nearestShip(e.x, e.y);
    const E = ENEMIES[e.kind];
    let sx = 0, sy = 0;
    if (target) {
      const d = dist(e.x, e.y, target.x, target.y) || 1;
      const dirX = (target.x - e.x) / d, dirY = (target.y - e.y) / d;
      e.a = Math.atan2(dirY, dirX);

      if (e.kind === 'stinger') {
        const want = E.range;
        const app = clamp((d - want) / 150, -1, 1);
        sx = dirX * app + -dirY * 0.5; sy = dirY * app + dirX * 0.5;
        e.fireCd -= dt;
        if (e.fireCd <= 0 && d < want * 1.6) {
          e.fireCd = WEAPONS.sting.rate;
          this._enemyFire(e.x, e.y, e.a);
        }
      } else if (e.kind === 'boss') {
        sx = dirX; sy = dirY;
        const enraged = e.hp < e.maxHp * 0.3;
        e.fireCd -= dt;
        if (e.fireCd <= 0) {
          e.fireCd = enraged ? 1.6 : 2.5;
          const N = 10;
          for (let i = 0; i < N; i++) this._enemyFire(e.x, e.y, (i / N) * TAU + this.elapsed);
        }
        e.abilityCd -= dt;
        if (e.abilityCd <= 0) {
          e.abilityCd = 6;
          this._spawnEnemy('crawler', this.wave);
          this._spawnEnemy('crawler', this.wave);
        }
        if (enraged) { sx *= 1.5; sy *= 1.5; }
      } else {
        sx = dirX; sy = dirY; // crawler / crusher: straight chase
      }
    }

    e.x += sx * e.speed * dt;
    e.y += sy * e.speed * dt;
    e.x = clamp(e.x, 20, GAME.arena - 20);
    e.y = clamp(e.y, 20, GAME.arena - 20);
    for (const o of this.obstacles) {
      const res = pushOut(e.x, e.y, e.r, o.x, o.y, o.r);
      if (res) [e.x, e.y] = res;
    }
    // enemy separation
    for (const q of this.enemies.values()) {
      if (q === e || q.hp <= 0) continue;
      const res = pushOut(e.x, e.y, e.r * 0.8, q.x, q.y, q.r * 0.8);
      if (res) [e.x, e.y] = res;
    }
  }

  _enemyFire(x, y, a) {
    const spec = { x, y, a };
    this.spawnEnemyShot(spec);
    if (this.online && this.isHost && this.onEnemyShot) this.onEnemyShot(spec);
  }

  _nearestShip(x, y) {
    let best = null, bestD = Infinity;
    for (const q of this.players.values()) {
      if (!q.alive) continue;
      const d = dist(x, y, q.x, q.y);
      if (d < bestD) { bestD = d; best = q; }
    }
    return best;
  }

  _damageEnemy(e, dmg, fromUid) {
    const authoritative = !this.online || this.isHost;
    if (!authoritative) {
      if (this.onEnemyDamage) this.onEnemyDamage(e.id, Math.round(dmg));
      this.floats.push({ x: e.x, y: e.y - e.r - 8, txt: String(Math.round(dmg)), life: 0.6, color: '#fff' });
      SFX.hit();
      return;
    }
    e.hp -= dmg;
    this.floats.push({ x: e.x, y: e.y - e.r - 8, txt: String(Math.round(dmg)), life: 0.6, color: '#fff' });
    SFX.hit();
    if (e.hp <= 0) this._killEnemy(e, fromUid);
  }

  // host applies damage reported by guests
  applyEnemyDamageEvent(id, dmg, fromUid) {
    const e = this.enemies.get(id);
    if (e && e.hp > 0) this._damageEnemy(e, dmg, fromUid);
  }

  _killEnemy(e, fromUid) {
    this.enemies.delete(e.id);
    this._explosion(e.x, e.y, e.kind === 'boss' ? 320 : 0, e.kind === 'boss' ? 60 : 16, e.kind === 'boss' ? 2 : 1);
    e.kind === 'boss' ? SFX.bigExplode() : SFX.explode();
    const killer = this.players.get(fromUid);
    if (killer && !killer.remote) {
      killer.kills++;
      killer.score += e.score;
      killer.shardsGot += e.shards;
    } else if (killer) {
      killer.score += e.score; // display-only; their client tracks its own rewards
    }
  }

  // guest: merge host snapshot
  setEnemySnapshot(snap) {
    snap = snap || {};
    for (const id of [...this.enemies.keys()]) {
      if (!snap[id]) {
        const e = this.enemies.get(id);
        this._explosion(e.x, e.y, e.kind === 'boss' ? 320 : 0, e.kind === 'boss' ? 60 : 16);
        e.kind === 'boss' ? SFX.bigExplode() : SFX.explode();
        this.enemies.delete(id);
      }
    }
    for (const [id, s] of Object.entries(snap)) {
      let e = this.enemies.get(id);
      if (!e) {
        const E = ENEMIES[s.k];
        e = {
          id, kind: s.k, x: s.x, y: s.y, a: s.a || 0,
          hp: s.hp, maxHp: s.m || E.hp, speed: E.speed, dmg: E.dmg, r: E.r,
          score: E.score, shards: E.shards,
          netX: s.x, netY: s.y, netA: s.a || 0, touchCd: 0.8,
        };
        this.enemies.set(id, e);
      } else {
        e.netX = s.x; e.netY = s.y; e.netA = s.a || 0;
        e.hp = s.hp; e.maxHp = s.m || e.maxHp;
      }
    }
  }

  getEnemySnapshot() {
    const out = {};
    for (const e of this.enemies.values()) {
      out[e.id] = { k: e.kind, x: Math.round(e.x), y: Math.round(e.y), a: +e.a.toFixed(2), hp: Math.round(e.hp), m: e.maxHp };
    }
    return out;
  }

  // when host migrates to me mid-match
  becomeHost() {
    this.isHost = true;
    for (const e of this.enemies.values()) { e.x = e.netX; e.y = e.netY; }
  }

  // ---------------- pickups ----------------
  _updatePickups(dt) {
    const authoritative = !this.online || this.isHost;
    if (authoritative) {
      this.pickupT -= dt;
      if (this.pickupT <= 0 && this.pickups.size < GAME.pickupMax) {
        this.pickupT = GAME.pickupEveryMs / 1000;
        const pk = {
          id: 'k' + randId(5),
          k: Math.random() < 0.45 ? 'hp' : 'shard',
          x: 120 + Math.random() * (GAME.arena - 240),
          y: 120 + Math.random() * (GAME.arena - 240),
        };
        let blocked = false;
        for (const o of this.obstacles) if (circleHit(pk.x, pk.y, 14, o.x, o.y, o.r)) blocked = true;
        if (!blocked) {
          this.pickups.set(pk.id, pk);
          if (this.online && this.onPickupSpawn) this.onPickupSpawn(pk);
        }
      }
    }
    for (const [id, pk] of this.pickups) {
      for (const q of this.players.values()) {
        if (q.remote || !q.alive) continue;
        if (!circleHit(pk.x, pk.y, 16, q.x, q.y, q.r)) continue;
        this.pickups.delete(id);
        if (pk.k === 'hp') q.hp = Math.min(q.maxHp, q.hp + 35);
        else q.shardsGot += 8;
        if (q === this.me) SFX.pickup();
        this.floats.push({ x: pk.x, y: pk.y - 16, txt: pk.k === 'hp' ? '+35' : '💠+8', life: 0.8, color: pk.k === 'hp' ? '#6ee7a0' : '#7dd3fc' });
        if (this.online && this.onPickupTaken) this.onPickupTaken(id);
        break;
      }
    }
  }

  addPickup(pk) { this.pickups.set(pk.id, pk); }
  removePickup(id) { this.pickups.delete(id); }

  // ---------------- match end ----------------
  _checkEnd() {
    if (this.over) return;
    if (this.mode === 'pvp') {
      if (this.endAt && this.timeFn() >= this.endAt) this._finish();
    } else {
      // co-op: everyone down at once = defeat (needs at least the local ship present)
      const all = [...this.players.values()];
      if (all.length && all.every((p) => !p.alive)) this._finish(false);
    }
  }

  timeLeft() {
    return this.endAt ? Math.max(0, (this.endAt - this.timeFn()) / 1000) : 0;
  }

  _finish(win = undefined) {
    const placements = [...this.players.values()]
      .map((p) => ({ uid: p.uid, name: p.name, kills: p.kills, deaths: p.deaths, score: p.score, me: p === this.me }))
      .sort((a, b) => b.kills - a.kills || b.score - a.score || a.deaths - b.deaths);
    this.over = {
      mode: this.mode,
      placements,
      wave: this.wave,
      win: this.mode === 'pvp'
        ? placements.length > 0 && placements[0].me
        : !!win,
      myShards: this.me ? this.me.shardsGot : 0,
    };
    if (this.onOver) this.onOver(this.over);
  }

  // called by net when host declares co-op over
  forceGameOver() { if (!this.over) this._finish(false); }

  // ---------------- fx ----------------
  _spark(x, y, hue) {
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * TAU, s = 60 + Math.random() * 160;
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.25, maxLife: 0.25, size: 2.2, hue, glow: true });
    }
  }

  _explosion(x, y, hue, n = 20, scale = 1) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, s = (40 + Math.random() * 260) * scale;
      this.particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 0.5 + Math.random() * 0.5, maxLife: 1, size: 2 + Math.random() * 4 * scale, hue, glow: true,
      });
    }
  }

  _fx(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= Math.pow(0.05, dt); p.vy *= Math.pow(0.05, dt);
    }
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i];
      f.life -= dt; f.y -= 30 * dt;
      if (f.life <= 0) this.floats.splice(i, 1);
    }
    for (let i = this.feed.length - 1; i >= 0; i--) {
      this.feed[i].t -= dt;
      if (this.feed[i].t <= 0) this.feed.splice(i, 1);
    }
    this.cam.shake = Math.max(0, this.cam.shake - 30 * dt);
  }

  // compact state for the network
  getSelfState() {
    const p = this.me;
    return {
      name: p.name, ship: p.ship, hue: p.hue, weapon: p.weapon,
      x: Math.round(p.x), y: Math.round(p.y), a: +p.a.toFixed(2),
      vx: Math.round(p.vx), vy: Math.round(p.vy),
      hp: Math.round(p.hp), maxHp: p.maxHp, alive: p.alive,
      score: p.score, kills: p.kills, deaths: p.deaths,
    };
  }
}
