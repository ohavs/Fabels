// ============================================================
// Core FPS simulation + 3D view. Runs identically online/offline.
//
// Authority model (online):
//   • every client fully simulates ITS OWN soldier
//   • remote soldiers interpolate from network state
//   • damage to remote soldiers → onHitRemote (victim applies)
//   • team-vs-bots: host simulates bots, guests interpolate;
//     bot damage to remote humans is relayed by the host as hits
// Offline (practice): everything local, bots included.
// ============================================================

import * as THREE from './vendor/three.module.js';
import {
  GAME, WEAPONS, WEAPON_LADDER, BOT_LEVELS, SKINS,
  GRENADE, ARMOR_MAX, PICKUPS, LOADOUT_MODES, CRATE_TIERS, KILLSTREAKS,
} from './config.js';
import { clamp, lerp, lerpAngle, rayAABB, raySphere, randId } from './util.js';
import { World } from './world.js';
import { buildCharacter, setCharacterWeapon, animateCharacter, flashCharacter, makeNameSprite, makeHpBar, updateHpBar } from './chars.js';
import { Effects, ViewModel } from './weapons.js';
import { SFX } from './audio.js';
import { t } from './i18n.js';

const V1 = new THREE.Vector3();
const V2 = new THREE.Vector3();

const forwardOf = (yaw, pitch = 0) => ({
  x: -Math.sin(yaw) * Math.cos(pitch),
  y: -Math.sin(pitch),
  z: -Math.cos(yaw) * Math.cos(pitch),
});

export class Game {
  /**
   * mode 'gungame'|'team' · online bool · isHost bool · mapId string
   * input Input · timeFn ()=>ms · endAt ms (team mode) · botLevel key
   */
  constructor(o) {
    this.mode = o.mode;
    this.online = !!o.online;
    this.isHost = o.isHost !== false;
    this.mapId = o.mapId;
    this.input = o.input || null;
    this.timeFn = o.timeFn || (() => Date.now());
    this.endAt = o.endAt || 0;
    this.botLevel = o.botLevel || 'normal';
    this.targetKills = o.targetKills || GAME.teamTargetKills;

    // 3D
    this.world = new World(this.mapId);
    this.scene = this.world.scene;
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.08, 400);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.fx = new Effects(this.scene);
    this.viewModel = new ViewModel(this.camera);

    // sim
    this.players = new Map();
    this.projectiles = [];
    this.grenades = [];
    this.pickups = new Map();          // id → {k, x, y, z, tier?, mesh}
    this.pickupT = PICKUPS.everyMs / 1000;
    this.isLoadout = LOADOUT_MODES.includes(o.mode);
    this.me = null;
    this.feed = [];
    this.over = null;
    this.elapsed = 0;
    this.teamScore = 0;
    this.botScore = 0;
    this.hudFlags = { hitmarker: 0, headshot: 0, hurt: 0, tierBanner: '', winBanner: '' };
    this._bobT = 0;

    // hooks (wired by net.js / main.js)
    this.onShot = null;         // (spec) my tracer for others
    this.onHitRemote = null;    // (toUid, dmg, {hs, mel, from})
    this.onSelfDeath = null;    // (killerUid, mel)
    this.onBotDamage = null;    // guest → host (botId, dmg)
    this.onBotShot = null;      // host → guests (visual)
    this.onKillBroadcast = null;// host announces bot deaths
    this.onWin = null;          // gungame: I completed the ladder
    this.onOver = null;         // (results)
    this.onChat = null;
    this.onPickupSpawn = null;  // host → net
    this.onPickupTaken = null;
    this.onNadeThrow = null;    // my grenade → remote visual
    this.onEmote = null;
  }

  // ---------------- entities ----------------
  _base(uid, name, skinId, team) {
    return {
      uid, name, skin: skinId, team,
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
      yaw: 0, pitch: 0, grounded: true,
      hp: 100, maxHp: 100, alive: true, respawnT: 0, invulnT: GAME.invulnTime,
      tier: 0, weapon: WEAPON_LADDER[0],
      ammo: WEAPONS[WEAPON_LADDER[0]].mag, reloadT: 0, fireCd: 0,
      kills: 0, deaths: 0, score: 0,
      // stance: 0 stand · 1 crouch · 2 slide (synced); crouchK = smoothed 0..1
      stance: 0, crouchK: 0, slideT: 0, slideCd: 0, slideDirX: 0, slideDirZ: 0,
      ads: false, bloom: 0,
      armor: 0, nades: GRENADE.start, nadeCd: 0,
      streak: 0, buffSpeedT: 0, buffDmgT: 0, danceT: 0, lastShotAt: -99,
      local: false, remote: false, bot: null,
      netX: 0, netY: 0, netZ: 0, netYaw: 0, netPitch: 0,
      view: null, speedSm: 0, chatT: 0, deadT: 0,
    };
  }

  _spawnPos(p, idx = -1) {
    const spawns = this.world.spawns;
    if (idx >= 0) return spawns[idx % spawns.length];
    // farthest spawn from living enemies
    let best = spawns[0], bestD = -1;
    for (const s of spawns) {
      let d = Infinity;
      for (const q of this.players.values()) {
        if (q === p || !q.alive || q.team === p.team && this.mode === 'team') continue;
        d = Math.min(d, (q.x - s.x) ** 2 + (q.z - s.z) ** 2);
      }
      if (d === Infinity) d = Math.random() * 1e6;
      if (d > bestD) { bestD = d; best = s; }
    }
    return best;
  }

  _place(p, s) {
    p.x = p.netX = s.x; p.y = p.netY = s.y + 0.05; p.z = p.netZ = s.z;
    p.vx = p.vy = p.vz = 0;
    p.yaw = Math.atan2(-(0 - p.x), -(0 - p.z)); // face arena centre
  }

  addLocal(uid, name, skinId, spawnIdx) {
    const p = this._base(uid, name, skinId, 'p');
    p.local = true;
    this._place(p, this._spawnPos(p, spawnIdx ?? 0));
    this.players.set(uid, p);
    this.me = p;
    this.viewModel.setWeapon(p.weapon);
    this._syncCamera(p);
    return p;
  }

  _makeView(p, isBot) {
    const char = buildCharacter(p.skin);
    char.group.position.set(p.x, p.y, p.z);
    const skin = SKINS[p.skin] || SKINS.scout;
    const name = makeNameSprite(p.name, isBot ? '#ff9b9b' : '#ffffff');
    char.group.add(name);
    const bar = makeHpBar();
    char.group.add(bar.bg, bar.fg);
    setCharacterWeapon(char, p.weapon);
    this.scene.add(char.group);
    p.view = { char, bar };
  }

  addBot(name, level, spawnIdx) {
    const uid = 'bot_' + randId(5);
    const skins = Object.keys(SKINS);
    const p = this._base(uid, name, skins[(Math.random() * skins.length) | 0], 'b');
    const L = BOT_LEVELS[level] || BOT_LEVELS.normal;
    p.maxHp = p.hp = L.hp;
    p.weapon = 'botgun';
    p.ammo = Infinity;
    p.bot = { level: L, brain: null };
    this._place(p, this._spawnPos(p, spawnIdx ?? -1));
    this.players.set(uid, p);
    this._makeView(p, true);
    return p;
  }

  upsertRemote(uid, st) {
    let p = this.players.get(uid);
    if (!p) {
      p = this._base(uid, st.name || '???', st.skin || 'scout', 'p');
      p.remote = true;
      p.x = p.netX = st.x || 0; p.y = p.netY = st.y || 0; p.z = p.netZ = st.z || 0;
      this.players.set(uid, p);
      this._makeView(p, false);
      this.feed.push({ text: t('playerJoined', { name: p.name }), t: 5 });
    }
    if (p.alive && st.alive === false) {
      p.alive = false;
      this.fx.impact(V1.set(p.x, p.y + 1, p.z), 0xff8866, 16, 5);
      if (this._near(p, 40)) SFX.die();
    } else if (!p.alive && st.alive) {
      p.alive = true;
      p.x = p.netX = st.x; p.y = p.netY = st.y; p.z = p.netZ = st.z;
      p.invulnT = GAME.invulnTime;
    }
    p.name = st.name ?? p.name;
    p.netX = st.x; p.netY = st.y; p.netZ = st.z;
    p.netYaw = st.yaw || 0; p.netPitch = st.pitch || 0;
    p.hp = st.hp; p.maxHp = st.maxHp || 100;
    p.armor = st.ar || 0;
    p.stance = st.st || 0;
    p.tier = st.tier || 0;
    if (st.w && st.w !== p.weapon) {
      p.weapon = st.w;
      if (p.view) setCharacterWeapon(p.view.char, p.weapon);
    }
    p.kills = st.kills || 0; p.deaths = st.deaths || 0; p.score = st.score || 0;
    return p;
  }

  removePlayer(uid) {
    const p = this.players.get(uid);
    if (!p) return;
    if (p.view) this.scene.remove(p.view.char.group);
    this.feed.push({ text: t('playerLeft', { name: p.name }), t: 5 });
    this.players.delete(uid);
  }

  showChat(uid, key) {
    const p = this.players.get(uid);
    if (!p) return;
    this.feed.push({ text: `${p.name}: ${t('chat_' + key)}`, t: 3.5 });
  }

  _near(p, d) {
    if (!this.me) return false;
    return (p.x - this.me.x) ** 2 + (p.z - this.me.z) ** 2 < d * d;
  }

  // ---------------- main step ----------------
  update(dt) {
    dt = Math.min(dt, 0.05);
    this.elapsed += dt;

    for (const p of this.players.values()) {
      p.fireCd = Math.max(0, p.fireCd - dt);
      p.invulnT = Math.max(0, p.invulnT - dt);
      p.chatT = Math.max(0, p.chatT - dt);
      p.nadeCd = Math.max(0, p.nadeCd - dt);
      p.buffSpeedT = Math.max(0, p.buffSpeedT - dt);
      p.buffDmgT = Math.max(0, p.buffDmgT - dt);
      p.danceT = Math.max(0, p.danceT - dt);
      if (p.reloadT > 0) {
        p.reloadT -= dt;
        if (p.reloadT <= 0) {
          p.reloadT = 0;
          p.ammo = WEAPONS[p.weapon].mag;
          if (p === this.me) SFX.reloadDone();
        }
      }
      if (!p.alive && !p.remote) {
        p.respawnT -= dt;
        if (p.respawnT <= 0 && !this.over) this._respawn(p);
      }

      if (p.remote) this._interpRemote(p, dt);
      else if (p.bot && !(this.online && !this.isHost)) this._botStep(p, dt);
      else if (p.bot) this._interpRemote(p, dt); // guest view of host's bots
      else if (p.local) this._localStep(p, dt);
    }

    this._updateProjectiles(dt);
    this._updateGrenades(dt);
    this._updatePickups(dt);
    this._updateViews(dt);
    this.fx.update(dt);
    this._decayHud(dt);
    for (let i = this.feed.length - 1; i >= 0; i--) {
      this.feed[i].t -= dt;
      if (this.feed[i].t <= 0) this.feed.splice(i, 1);
    }
    this._checkEnd();
  }

  // ---------------- local player ----------------
  _localStep(p, dt) {
    const input = this.input;
    input.update();
    const look = input.consumeLook();
    if (p.alive && !this.over) {
      p.yaw -= look.dx;
      p.pitch = clamp(p.pitch + look.dy, -1.45, 1.45);
    }

    p.slideCd = Math.max(0, p.slideCd - dt);
    p.bloom = Math.max(0, p.bloom - dt * 0.09);

    let wishX = 0, wishZ = 0, speed = GAME.moveSpeed;
    if (p.alive && !this.over) {
      const f = forwardOf(p.yaw);
      const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
      wishX = rx * input.move.x + f.x * input.move.y;
      wishZ = rz * input.move.x + f.z * input.move.y;
      const wl = Math.hypot(wishX, wishZ);
      if (wl > 1) { wishX /= wl; wishZ /= wl; }

      // ---- stance state machine: stand / sprint / crouch / slide ----
      p.ads = input.aiming && !WEAPONS[p.weapon].melee;
      const moving = wl > 0.3;
      const sprinting = input.sprintHeld && moving && input.move.y > 0.2
        && !p.ads && !input.crouchHeld && p.slideT <= 0 && p.grounded;

      if (p.slideT > 0) {
        // sliding: locked direction, decaying boost
        p.slideT -= dt;
        const k = p.slideT / GAME.slideTime;
        speed = GAME.slideSpeed * (0.35 + 0.65 * k);
        wishX = p.slideDirX; wishZ = p.slideDirZ;
        p.stance = 2;
        if (p.slideT <= 0) p.stance = input.crouchHeld ? 1 : 0;
      } else if (input.crouchHeld && this._wasSprinting && p.grounded && p.slideCd <= 0 && moving) {
        // sprint + crouch = slide
        p.slideT = GAME.slideTime;
        p.slideCd = GAME.slideCd + GAME.slideTime;
        p.slideDirX = wishX; p.slideDirZ = wishZ;
        p.stance = 2;
        SFX.jump();
      } else if (input.crouchHeld) {
        p.stance = 1;
        speed = GAME.moveSpeed * GAME.crouchMult;
      } else {
        p.stance = 0;
        speed = sprinting ? GAME.moveSpeed * GAME.sprintMult : GAME.moveSpeed;
      }
      this._wasSprinting = sprinting;
      if (p.ads) speed *= GAME.adsMoveMult;
      if (p.buffSpeedT > 0) speed *= 1.14;

      if (input.consumeJump() && p.grounded) {
        if (p.stance !== 0 && p.slideT <= 0) { p.stance = 0; input.crouchHeld = input.touchMode ? false : input.crouchHeld; }
        else {
          p.vy = GAME.jumpVel;
          p.grounded = false;
          SFX.jump();
        }
      }
      if (input.consumeReload()) this._startReload(p);
      if (input.consumeNade()) this.throwNade(p);
      if (input.consumeEmote()) this.doEmote();
      const chat = input.consumeChat();
      if (chat >= 0 && this.onChat) this.onChat(chat);

      // fire: manual, or mobile auto-fire when the crosshair rests on an enemy
      if (input.firing || (input.touchMode && input.autoFire && this._crosshairOnEnemy(p))) {
        this._tryFire(p);
      }
    }

    // smooth crouch factor (also drives eye height + hitbox scale)
    const targetK = p.stance === 2 ? 1.15 : p.stance === 1 ? 1 : 0;
    p.crouchK = lerp(p.crouchK, targetK, Math.min(1, dt * 10));

    this._physics(p, wishX, wishZ, speed, dt);
    if (p.y < GAME.fallY && p.alive) this._killPlayer(p, p.uid, false);
    this._syncCamera(p, dt);
  }

  // is an enemy under the crosshair (small cone + line of sight)?
  _crosshairOnEnemy(p) {
    if (p.fireCd > 0 || p.reloadT > 0) return false;
    const f = forwardOf(p.yaw, p.pitch);
    const w = WEAPONS[p.weapon];
    for (const q of this.players.values()) {
      if (q === p || !q.alive || q.invulnT > 0) continue;
      if (this.mode === 'team' && q.team === p.team) continue;
      const dx = q.x - p.x, dy = (q.y + 1.1) - (p.y + GAME.eyeHeight), dz = q.z - p.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > w.range || d < 0.5) continue;
      const dot = (dx * f.x + dy * f.y + dz * f.z) / d;
      if (dot > Math.cos(0.05 + 0.5 / d)) {
        if (!this._losBlocked(p.x, p.y + GAME.eyeHeight, p.z, q.x, q.y + 1.1, q.z)) return true;
      }
    }
    return false;
  }

  _losBlocked(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz) || 1;
    for (const c of this.world.colliders) {
      if (rayAABB(ax, ay, az, dx / len, dy / len, dz / len, c) < len) return true;
    }
    return false;
  }

  // effective spread: base × stance/motion/ADS modifiers + bloom
  effectiveSpread(p) {
    const w = WEAPONS[p.weapon];
    let s = w.spread;
    if (p.ads) s *= 0.35;
    if (p.stance === 1) s *= 0.7;
    const sp = Math.hypot(p.vx, p.vz);
    if (sp > GAME.moveSpeed * 0.6) s *= 1.5;
    if (!p.grounded) s *= 1.9;
    return s + p.bloom;
  }

  _syncCamera(p, dt = 1 / 60) {
    const sp = Math.hypot(p.vx, p.vz);
    if (sp > 1 && p.grounded) this._bobT += Math.min(0.06, sp * 0.004);
    const bob = Math.sin(this._bobT * 9) * 0.035 * Math.min(1, sp / 6) * (p.ads ? 0.3 : 1);
    const eye = GAME.eyeHeight - p.crouchK * 0.62;
    this.camera.position.set(p.x, p.y + eye + bob, p.z);
    this.camera.rotation.y = p.yaw;
    this.camera.rotation.x = -p.pitch;

    // FOV: sprint widens, ADS narrows (sniper = scope)
    const sniper = p.weapon === 'sniper';
    const targetFov = p.ads ? (sniper ? 24 : 55)
      : sp > GAME.moveSpeed * 1.1 ? 82 : 75;
    if (Math.abs(this.camera.fov - targetFov) > 0.1) {
      this.camera.fov = lerp(this.camera.fov, targetFov, Math.min(1, dt * 10));
      this.camera.updateProjectionMatrix();
    }
    this.viewModel.update(dt, sp, p.reloadT > 0, p.ads, sniper);
  }

  // ---------------- shared physics (players + bots) ----------------
  _physics(p, wishX, wishZ, speed, dt) {
    const accel = p.grounded ? 11 : 3.2;
    p.vx = lerp(p.vx, wishX * speed, Math.min(1, accel * dt));
    p.vz = lerp(p.vz, wishZ * speed, Math.min(1, accel * dt));
    p.vy += GAME.gravity * dt;

    const r = GAME.playerRadius, H = GAME.playerHeight;
    const cols = this.world.colliders;
    const overlaps = (x, y, z) => {
      const out = [];
      for (const c of cols) {
        if (x + r > c.x0 && x - r < c.x1 && y < c.y1 && y + H > c.y0 && z + r > c.z0 && z - r < c.z1) out.push(c);
      }
      return out;
    };

    // X axis (with step-up)
    let nx = p.x + p.vx * dt;
    let hits = overlaps(nx, p.y, p.z);
    if (hits.length) {
      const stepTop = Math.max(...hits.map((c) => c.y1));
      if (p.grounded && stepTop - p.y <= 0.55 && !overlaps(nx, stepTop + 0.01, p.z).length) {
        p.y = stepTop + 0.01;
      } else {
        nx = p.x; p.vx = 0;
      }
    }
    p.x = nx;

    // Z axis (with step-up)
    let nz = p.z + p.vz * dt;
    hits = overlaps(p.x, p.y, nz);
    if (hits.length) {
      const stepTop = Math.max(...hits.map((c) => c.y1));
      if (p.grounded && stepTop - p.y <= 0.55 && !overlaps(p.x, stepTop + 0.01, nz).length) {
        p.y = stepTop + 0.01;
      } else {
        nz = p.z; p.vz = 0;
      }
    }
    p.z = nz;

    // Y axis
    let ny = p.y + p.vy * dt;
    const wasAir = !p.grounded;
    p.grounded = false;
    hits = overlaps(p.x, ny, p.z);
    if (hits.length) {
      if (p.vy <= 0) {
        ny = Math.max(...hits.map((c) => c.y1)) + 0.001;
        p.vy = 0; p.grounded = true;
      } else {
        ny = Math.min(...hits.map((c) => c.y0)) - H - 0.001;
        p.vy = 0;
      }
    }
    if (ny <= 0) { ny = 0; if (p.vy <= 0) { p.vy = 0; p.grounded = true; } }
    p.y = ny;
    if (wasAir && p.grounded && p === this.me) SFX.land();
  }

  _interpRemote(p, dt) {
    const k = 1 - Math.pow(0.00004, dt);
    p.x = lerp(p.x, p.netX, k);
    p.y = lerp(p.y, p.netY, k);
    p.z = lerp(p.z, p.netZ, k);
    p.yaw = lerpAngle(p.yaw, p.netYaw, k);
    p.pitch = lerp(p.pitch, p.netPitch, k);
    if ((p.x - p.netX) ** 2 + (p.z - p.netZ) ** 2 > 64) { p.x = p.netX; p.y = p.netY; p.z = p.netZ; }
  }

  // ---------------- firing ----------------
  _startReload(p) {
    const w = WEAPONS[p.weapon];
    if (p.reloadT > 0 || !isFinite(w.mag) || p.ammo >= w.mag) return;
    p.reloadT = w.reload;
    if (p === this.me) SFX.reload();
  }

  _tryFire(p) {
    if (p.fireCd > 0 || p.reloadT > 0 || !p.alive) return;
    const w = WEAPONS[p.weapon];
    if (p.ammo <= 0) { this._startReload(p); return; }
    p.fireCd = w.rate;
    if (isFinite(w.mag)) p.ammo--;
    if (p === this.me) p.bloom = Math.min(0.045, p.bloom + w.spread * 0.9 + 0.004);
    this.fireWeapon(p, false);
    if (p.bot && this.online && this.isHost && this.onBotShot) {
      const f = forwardOf(p.yaw, p.pitch);
      this.onBotShot({
        o: p.uid, x: +p.x.toFixed(2), y: +(p.y + GAME.eyeHeight).toFixed(2), z: +p.z.toFixed(2),
        dx: +f.x.toFixed(3), dy: +f.y.toFixed(3), dz: +f.z.toFixed(3), w: p.weapon,
      });
    }
    if (p === this.me) {
      this.viewModel.kick();
      if (this.onShot) {
        const f = forwardOf(p.yaw, p.pitch);
        this.onShot({ x: +p.x.toFixed(2), y: +(p.y + GAME.eyeHeight).toFixed(2), z: +p.z.toFixed(2), dx: +f.x.toFixed(3), dy: +f.y.toFixed(3), dz: +f.z.toFixed(3), w: p.weapon });
      }
      if (p.ammo === 0) this._startReload(p);
    }
  }

  // performs the actual shot; visual=true → tracer only, no damage
  fireWeapon(p, visual, originOverride, dirOverride) {
    const w = WEAPONS[p.weapon];
    p.lastShotAt = this.elapsed;   // minimap radar ping
    const eye = originOverride || { x: p.x, y: p.y + GAME.eyeHeight, z: p.z };
    const baseDir = dirOverride || forwardOf(p.yaw, p.pitch);
    if (this._near(p, 55) || p === this.me) SFX.shoot(p.weapon);

    // muzzle position for the tracer
    let muzzle;
    if (p === this.me) {
      muzzle = this.viewModel.muzzleWorld(V1.clone());
    } else if (p.view) {
      muzzle = p.view.char.gunAnchor.getWorldPosition(V1.clone());
    } else {
      muzzle = V1.clone().set(eye.x, eye.y - 0.2, eye.z);
    }
    this.fx.muzzleFlash(muzzle);

    if (w.melee) { if (!visual) this._melee(p, w); return; }

    if (w.projectile) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(w.projectile.radius, 8, 8),
        new THREE.MeshBasicMaterial({ color: w.color }),
      );
      m.position.set(eye.x, eye.y, eye.z);
      this.scene.add(m);
      this.projectiles.push({
        mesh: m, owner: p.uid, team: p.team, visual,
        x: eye.x, y: eye.y, z: eye.z,
        vx: baseDir.x * w.projectile.speed, vy: baseDir.y * w.projectile.speed, vz: baseDir.z * w.projectile.speed,
        life: 2.5, w,
      });
      return;
    }

    for (let i = 0; i < w.pellets; i++) {
      const sp = p === this.me ? this.effectiveSpread(p) : w.spread * (p.bot ? 1.4 : 1);
      const dx = baseDir.x + (Math.random() - 0.5) * 2 * sp;
      const dy = baseDir.y + (Math.random() - 0.5) * 2 * sp;
      const dz = baseDir.z + (Math.random() - 0.5) * 2 * sp;
      const dl = Math.hypot(dx, dy, dz) || 1;
      this._hitscan(p, eye, { x: dx / dl, y: dy / dl, z: dz / dl }, w, visual, muzzle);
    }
  }

  _hitscan(p, eye, dir, w, visual, muzzle) {
    let tWall = w.range;
    for (const c of this.world.colliders) {
      const tt = rayAABB(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, c);
      if (tt < tWall) tWall = tt;
    }
    // ground plane
    if (dir.y < -1e-6) {
      const tg = -eye.y / dir.y;
      if (tg > 0 && tg < tWall) tWall = tg;
    }

    let hitP = null, hitT = tWall, headshot = false;
    for (const q of this.players.values()) {
      if (q === p || !q.alive || q.invulnT > 0) continue;
      if (this.mode === 'team' && q.team === p.team) continue;
      // three-sphere body approximation, squashed when crouching/sliding
      const hs2 = 1 - Math.min(1, q.crouchK) * 0.3;
      const spheres = [
        [q.x, q.y + 0.45 * hs2, q.z, 0.4, false],
        [q.x, q.y + 1.1 * hs2, q.z, 0.45, false],
        [q.x, q.y + 1.62 * hs2, q.z, 0.3, true],
      ];
      for (const [cx, cy, cz, r, hs] of spheres) {
        const tt = raySphere(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, cx, cy, cz, r);
        if (tt < hitT) { hitT = tt; hitP = q; headshot = hs; }
      }
    }

    const end = V2.set(eye.x + dir.x * hitT, eye.y + dir.y * hitT, eye.z + dir.z * hitT);
    this.fx.tracer(muzzle, end, p.team === 'b' ? 0xff7b72 : 0xfff0b0);
    if (hitP) {
      this.fx.impact(end, 0xff5964, 5, 2.5);
      if (hitP.view) flashCharacter(hitP.view.char);
      if (!visual) {
        const dmg = w.dmg * (headshot ? w.hsMult : 1) * (p.buffDmgT > 0 ? 1.4 : 1);
        this._damagePlayer(hitP, dmg, p.uid, { hs: headshot, mel: false });
      }
    } else if (hitT < w.range) {
      this.fx.impact(end, 0xd9c9a0, 4, 2);
    }
  }

  _melee(p, w) {
    const f = forwardOf(p.yaw);
    let best = null, bestD = w.range;
    for (const q of this.players.values()) {
      if (q === p || !q.alive || q.invulnT > 0) continue;
      if (this.mode === 'team' && q.team === p.team) continue;
      const dx = q.x - p.x, dz = q.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > w.range || Math.abs(q.y - p.y) > 1.6) continue;
      const dot = (dx * f.x + dz * f.z) / (d || 1);
      if (dot > 0.45 && d < bestD) { best = q; bestD = d; }
    }
    if (best) {
      this.fx.impact(V1.set(best.x, best.y + 1.2, best.z), 0xffd166, 10, 4);
      this._damagePlayer(best, w.dmg * (p.buffDmgT > 0 ? 1.4 : 1), p.uid, { hs: false, mel: true });
    }
  }

  _updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      pr.life -= dt;
      const steps = 2; // sub-steps for tunnel-proofing
      let exploded = false;
      for (let s = 0; s < steps && !exploded; s++) {
        pr.x += pr.vx * dt / steps; pr.y += pr.vy * dt / steps; pr.z += pr.vz * dt / steps;
        if (pr.y <= 0.1) exploded = true;
        if (!exploded) {
          for (const c of this.world.colliders) {
            if (pr.x > c.x0 && pr.x < c.x1 && pr.y > c.y0 && pr.y < c.y1 && pr.z > c.z0 && pr.z < c.z1) { exploded = true; break; }
          }
        }
        if (!exploded) {
          for (const q of this.players.values()) {
            if (q.uid === pr.owner || !q.alive) continue;
            if (this.mode === 'team' && q.team === pr.team) continue;
            if ((q.x - pr.x) ** 2 + (q.y + 0.9 - pr.y) ** 2 + (q.z - pr.z) ** 2 < 0.8) { exploded = true; break; }
          }
        }
      }
      pr.mesh.position.set(pr.x, pr.y, pr.z);
      if (exploded || pr.life <= 0) {
        this.scene.remove(pr.mesh);
        this.projectiles.splice(i, 1);
        if (exploded) this._explode(pr);
      }
    }
  }

  _explode(pr) {
    const { splash } = pr.w.projectile;
    this.fx.explosion(V1.set(pr.x, pr.y, pr.z), pr.w.color);
    if (this._nearPoint(pr.x, pr.z, 50)) SFX.explode();
    if (pr.visual) return;
    const owner = this.players.get(pr.owner);
    for (const q of this.players.values()) {
      if (!q.alive || q.uid === pr.owner || q.invulnT > 0) continue;
      if (this.mode === 'team' && owner && q.team === owner.team) continue;
      const d = Math.hypot(q.x - pr.x, q.y + 0.9 - pr.y, q.z - pr.z);
      if (d < splash) {
        const dmg = pr.w.dmg * (1 - (d / splash) * 0.7);
        this._damagePlayer(q, dmg, pr.owner, { hs: false, mel: false });
      }
    }
  }

  _nearPoint(x, z, d) {
    if (!this.me) return false;
    return (x - this.me.x) ** 2 + (z - this.me.z) ** 2 < d * d;
  }

  // ---------------- grenades ----------------
  throwNade(p) {
    if (!p.alive || p.nades <= 0 || p.nadeCd > 0) return;
    p.nades--;
    p.nadeCd = GRENADE.cd;
    const f = forwardOf(p.yaw, p.pitch);
    const spec = {
      x: p.x + f.x, y: p.y + GAME.eyeHeight + f.y, z: p.z + f.z,
      vx: f.x * GRENADE.speed + p.vx * 0.5, vy: f.y * GRENADE.speed + GRENADE.upVel, vz: f.z * GRENADE.speed + p.vz * 0.5,
    };
    this._spawnNade(spec, p.uid, false);
    if (p === this.me && this.onNadeThrow) {
      this.onNadeThrow({ x: +spec.x.toFixed(2), y: +spec.y.toFixed(2), z: +spec.z.toFixed(2), vx: +spec.vx.toFixed(2), vy: +spec.vy.toFixed(2), vz: +spec.vz.toFixed(2) });
    }
    SFX.jump();
  }

  _spawnNade(spec, owner, visual) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), new THREE.MeshBasicMaterial({ color: 0x2f4a2f }));
    m.position.set(spec.x, spec.y, spec.z);
    this.scene.add(m);
    this.grenades.push({ mesh: m, owner, visual, fuse: GRENADE.fuse, ...spec });
  }

  applyRemoteNade(spec) { this._spawnNade(spec, spec.o || 'x', true); }

  _updateGrenades(dt) {
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      g.fuse -= dt;
      g.vy += GAME.gravity * dt;
      g.x += g.vx * dt; g.y += g.vy * dt; g.z += g.vz * dt;
      if (g.y < 0.14) { g.y = 0.14; g.vy = Math.abs(g.vy) * 0.35; g.vx *= 0.6; g.vz *= 0.6; }
      for (const c of this.world.colliders) {
        if (g.x > c.x0 && g.x < c.x1 && g.y > c.y0 && g.y < c.y1 && g.z > c.z0 && g.z < c.z1) {
          // simple bounce back
          g.vx *= -0.4; g.vz *= -0.4;
          g.x += g.vx * dt * 2; g.z += g.vz * dt * 2;
          break;
        }
      }
      g.mesh.position.set(g.x, g.y, g.z);
      g.mesh.material.color.setHex(Math.sin(g.fuse * 20) > 0 ? 0xff4444 : 0x2f4a2f);
      if (g.fuse <= 0) {
        this.scene.remove(g.mesh);
        this.grenades.splice(i, 1);
        this._nadeExplode(g);
      }
    }
  }

  _nadeExplode(g) {
    this.fx.explosion(V1.set(g.x, g.y + 0.3, g.z), 0xffaa33);
    if (this._nearPoint(g.x, g.z, 60)) SFX.explode();
    if (g.visual) return;
    const dmgMul = this.players.get(g.owner)?.buffDmgT > 0 ? 1.4 : 1;
    for (const q of this.players.values()) {
      if (!q.alive || q.invulnT > 0) continue;
      const owner = this.players.get(g.owner);
      if (this.mode !== 'gungame' && this.mode !== 'duel' && owner && q.team === owner.team && q !== owner) continue;
      if (q.uid === g.owner && false) continue; // self-damage allowed
      const d = Math.hypot(q.x - g.x, q.y + 0.9 - g.y, q.z - g.z);
      if (d < GRENADE.radius) {
        const dmg = GRENADE.dmg * dmgMul * (1 - (d / GRENADE.radius) * 0.75);
        this._damagePlayer(q, dmg, g.owner, {});
      }
    }
  }

  // ---------------- pickups ----------------
  _updatePickups(dt) {
    const authoritative = !this.online || this.isHost;
    if (authoritative && !this.over) {
      this.pickupT -= dt;
      if (this.pickupT <= 0 && this.pickups.size < PICKUPS.max) {
        this.pickupT = PICKUPS.everyMs / 1000;
        this._spawnRandomPickup();
      }
    }
    // rotate + bob visuals; collect for locally-simulated humans
    for (const [id, pk] of this.pickups) {
      pk.mesh.rotation.y += dt * 2;
      pk.mesh.position.y = pk.y + 0.65 + Math.sin(this.elapsed * 3 + pk.x) * 0.12;
      for (const q of this.players.values()) {
        if (q.remote || q.bot || !q.alive) continue;
        if ((q.x - pk.x) ** 2 + (q.z - pk.z) ** 2 > 1.3 || Math.abs(q.y - pk.y) > 2) continue;
        this._applyPickup(q, pk);
        this._removePickupLocal(id);
        if (this.online && this.onPickupTaken) this.onPickupTaken(id);
        break;
      }
    }
  }

  _spawnRandomPickup() {
    const nav = this.world.navPoints;
    const s = nav[(Math.random() * nav.length) | 0];
    const kinds = Object.entries(PICKUPS.kinds)
      .filter(([k]) => k !== 'weapon' || this.isLoadout);
    const total = kinds.reduce((a, [, v]) => a + v.weight, 0);
    let r = Math.random() * total, kind = kinds[0][0];
    for (const [k, v] of kinds) { r -= v.weight; if (r <= 0) { kind = k; break; } }
    const pk = {
      id: 'k' + randId(5), k: kind,
      x: s.x + (Math.random() - 0.5) * 3, y: s.y, z: s.z + (Math.random() - 0.5) * 3,
    };
    if (kind === 'weapon') {
      const total2 = CRATE_TIERS.reduce((a, t) => a + t.weight, 0);
      let r2 = Math.random() * total2;
      pk.tier = 0;
      CRATE_TIERS.forEach((t, i) => { r2 -= t.weight; if (r2 <= 0 && pk.tier === 0 && i > 0) pk.tier = i; });
      pk.w = CRATE_TIERS[pk.tier].weapons[(Math.random() * CRATE_TIERS[pk.tier].weapons.length) | 0];
    }
    this.addPickup(pk);
    if (this.online && this.onPickupSpawn) this.onPickupSpawn(pk);
  }

  addPickup(pk) {
    if (this.pickups.has(pk.id)) return;
    const group = new THREE.Group();
    let color = 0x3dff8b;
    if (pk.k === 'hp') {
      const g1 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.16), new THREE.MeshBasicMaterial({ color: 0x3dff8b }));
      const g2 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.16), new THREE.MeshBasicMaterial({ color: 0x3dff8b }));
      group.add(g1, g2);
    } else if (pk.k === 'armor') {
      color = 0x57c4e5;
      group.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.32), new THREE.MeshBasicMaterial({ color })));
    } else if (pk.k === 'nade') {
      color = 0xffaa33;
      group.add(new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), new THREE.MeshBasicMaterial({ color: 0x4a6b3a })));
    } else { // weapon crate
      color = CRATE_TIERS[pk.tier || 0].color;
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.42, 0.42), new THREE.MeshBasicMaterial({ color }));
      group.add(box);
    }
    const glow = new THREE.PointLight(color, 3, 4);
    glow.position.y = 0.4;
    group.add(glow);
    group.position.set(pk.x, pk.y + 0.65, pk.z);
    this.scene.add(group);
    pk.mesh = group;
    this.pickups.set(pk.id, pk);
  }

  _removePickupLocal(id) {
    const pk = this.pickups.get(id);
    if (!pk) return;
    this.scene.remove(pk.mesh);
    this.pickups.delete(id);
  }

  removePickup(id) { this._removePickupLocal(id); }

  _applyPickup(q, pk) {
    if (pk.k === 'hp') {
      q.hp = Math.min(q.maxHp, q.hp + PICKUPS.kinds.hp.amount);
      this.feed.push({ text: `+${PICKUPS.kinds.hp.amount} ❤️`, t: 2.5 });
    } else if (pk.k === 'armor') {
      q.armor = Math.min(ARMOR_MAX, q.armor + PICKUPS.kinds.armor.amount);
      this.feed.push({ text: `+${PICKUPS.kinds.armor.amount} 🛡️`, t: 2.5 });
    } else if (pk.k === 'nade') {
      q.nades = Math.min(GRENADE.max, q.nades + 1);
      this.feed.push({ text: '+💣', t: 2.5 });
    } else if (pk.k === 'weapon' && this.isLoadout) {
      q.weapon = pk.w;
      q.ammo = WEAPONS[pk.w].mag;
      q.reloadT = 0;
      if (q === this.me) {
        this.viewModel.setWeapon(pk.w);
        this.hudFlags.tierBanner = t('gotWeapon', { w: t('weapon_' + pk.w) });
      }
    }
    if (q === this.me) SFX.pickup();
  }

  // ---------------- killstreaks & emotes ----------------
  _myKillFx() {
    const me = this.me;
    me.streak++;
    for (const ks of KILLSTREAKS) {
      if (me.streak !== ks.at) continue;
      if (ks.k === 'speed') { me.buffSpeedT = ks.dur; this.hudFlags.tierBanner = t('streak3'); }
      if (ks.k === 'armor') { me.armor = Math.min(ARMOR_MAX, me.armor + ks.amount); this.hudFlags.tierBanner = t('streak5'); }
      if (ks.k === 'dmg') { me.buffDmgT = ks.dur; this.hudFlags.tierBanner = t('streak7'); }
      SFX.tierUp();
    }
  }

  doEmote() {
    if (!this.me?.alive) return;
    if (this.onEmote) this.onEmote();
    this.feed.push({ text: t('emoted', { name: this.me.name }), t: 3 });
    SFX.pickup();
  }

  applyEmote(uid) {
    const p = this.players.get(uid);
    if (!p) return;
    p.danceT = 2.6;
    this.feed.push({ text: t('emoted', { name: p.name }), t: 3 });
  }

  // remote player fired — tracer/projectile visual only
  applyRemoteShot(uid, s) {
    const p = this.players.get(uid);
    if (!p) return;
    const dl = Math.hypot(s.dx, s.dy, s.dz) || 1;
    const saveW = p.weapon;
    p.weapon = s.w;
    this.fireWeapon(p, true, { x: s.x, y: s.y, z: s.z }, { x: s.dx / dl, y: s.dy / dl, z: s.dz / dl });
    p.weapon = saveW;
  }

  // ---------------- damage & kills ----------------
  _damagePlayer(q, dmg, fromUid, { hs = false, mel = false } = {}) {
    if (!q.alive || q.invulnT > 0) return;
    // guests don't own bots — relay damage to the host
    if (q.bot && this.online && !this.isHost) {
      if (this.onBotDamage) this.onBotDamage(q.uid, Math.round(dmg));
      this.hudFlags.hitmarker = 0.25;
      if (hs) { this.hudFlags.headshot = 0.5; SFX.headshot(); } else SFX.hit();
      return;
    }
    if (q.remote) {
      if (this.onHitRemote) this.onHitRemote(q.uid, Math.round(dmg), { hs, mel, from: fromUid });
      this.hudFlags.hitmarker = 0.25;
      if (hs) { this.hudFlags.headshot = 0.5; SFX.headshot(); } else SFX.hit();
      return;
    }
    // armor (shield) absorbs damage first
    if (q.armor > 0) {
      const absorbed = Math.min(q.armor, dmg);
      q.armor -= absorbed;
      dmg -= absorbed;
    }
    q.hp -= dmg;
    if (q === this.me) {
      this.hudFlags.hurt = 0.5;
      SFX.hurt();
    } else {
      const from = this.players.get(fromUid);
      if (from === this.me) {
        this.hudFlags.hitmarker = 0.25;
        if (hs) { this.hudFlags.headshot = 0.5; SFX.headshot(); } else SFX.hit();
      }
    }
    if (q.hp <= 0) this._killPlayer(q, fromUid, mel);
  }

  applyHitOnMe(dmg, fromUid, hs, mel) {
    if (this.me) this._damagePlayer(this.me, dmg, fromUid, { hs, mel });
  }

  // host applies guests' damage to bots
  applyBotDamageEvent(botId, dmg, fromUid) {
    const b = this.players.get(botId);
    if (b && b.bot && b.alive) this._damagePlayer(b, dmg, fromUid, {});
  }

  _killPlayer(q, fromUid, mel) {
    q.hp = 0;
    q.armor = 0;
    q.alive = false;
    q.deaths++;
    if (q === this.me) q.streak = 0;
    q.respawnT = GAME.respawnTime;
    this.fx.impact(V1.set(q.x, q.y + 1, q.z), 0xff8866, 18, 6);
    if (q === this.me || this._near(q, 45)) SFX.die();

    const killer = this.players.get(fromUid);
    const killerName = killer ? killer.name : '?';

    if (!this.online) {
      this.feed.push({ text: t(mel ? 'killKnife' : 'kill', { a: killerName, b: q.name }), t: 5 });
      if (killer && killer !== q) this._creditLocal(killer, q, mel);
      if (mel && !q.bot) this._demote(q);
      this._tallyTeams(killer, q);
    } else if (q === this.me) {
      if (this.onSelfDeath) this.onSelfDeath(fromUid, mel);
      if (mel) this._demote(q);
    } else if (q.bot && this.isHost) {
      // host announces bot deaths so every client can tally the team score
      if (this.onKillBroadcast) this.onKillBroadcast(fromUid, killerName, q.uid, q.name, mel);
      if (killer && !killer.remote) this._creditLocal(killer, q, mel);
      this._tallyTeams(killer, q);
    }
  }

  _creditLocal(killer, victim, mel) {
    killer.kills++;
    killer.score += 100;
    if (killer === this.me) {
      this.feed.push({ text: t('youKilled', { name: victim.name }), t: 4 });
      this._myKillFx();
      if (!this.isLoadout) this._advanceTier(killer);
    }
  }

  // called by net when a kill event says I'm the killer
  creditKill(victimName, mel, victimIsBot) {
    if (!this.me) return;
    this.me.kills++;
    this.me.score += 100;
    this.feed.push({ text: t('youKilled', { name: victimName }), t: 4 });
    this._myKillFx();
    if (!this.isLoadout) this._advanceTier(this.me);
  }

  tallyRemoteKill(killerUid, victimUid) {
    // team-mode scoreboard from events (works for all clients)
    const kBot = killerUid.startsWith('bot_');
    const vBot = victimUid.startsWith('bot_');
    if (this.mode !== 'team') return;
    if (vBot && !kBot) this.teamScore++;
    if (!vBot && kBot) this.botScore++;
  }

  _tallyTeams(killer, victim) {
    if (this.mode !== 'team') return;
    if (victim.team === 'b' && killer && killer.team === 'p') this.teamScore++;
    if (victim.team === 'p' && killer && killer.team === 'b') this.botScore++;
  }

  _advanceTier(p) {
    p.tier++;
    if (this.mode === 'gungame' && p.tier >= WEAPON_LADDER.length) {
      if (p === this.me && this.onWin) this.onWin();
      this.forceGameOver({ winnerUid: p.uid, winnerName: p.name });
      return;
    }
    p.tier = Math.min(p.tier, WEAPON_LADDER.length - 1);
    this._setTier(p);
    if (p === this.me) {
      SFX.tierUp();
      this.hudFlags.tierBanner = p.tier === WEAPON_LADDER.length - 1
        ? t('lastWeapon')
        : t('tierUp', { w: t('weapon_' + p.weapon) });
    }
  }

  _demote(q) {
    if (q.tier > 0) {
      q.tier--;
      this._setTier(q);
      if (q === this.me) { SFX.tierDown(); this.hudFlags.tierBanner = t('tierDown'); }
    }
  }

  _setTier(p) {
    p.weapon = WEAPON_LADDER[p.tier];
    p.ammo = WEAPONS[p.weapon].mag;
    p.reloadT = 0;
    if (p === this.me) this.viewModel.setWeapon(p.weapon);
    else if (p.view) setCharacterWeapon(p.view.char, p.weapon);
  }

  _respawn(p) {
    const s = this._spawnPos(p);
    this._place(p, s);
    p.hp = p.maxHp;
    p.armor = 0;
    p.nades = GRENADE.start;
    p.alive = true;
    p.invulnT = GAME.invulnTime;
    p.ammo = WEAPONS[p.weapon].mag;
    p.reloadT = 0;
  }

  // ---------------- bots (host / offline) ----------------
  _botStep(p, dt) {
    if (!p.bot.brain) {
      // lazily import-free: brain assigned by bots.js through attachBrains()
      p.vx = p.vz = 0;
    } else if (p.alive) {
      p.bot.brain.update(dt);
    }
    const L = p.bot.level;
    const wish = p.bot.wish || { x: 0, z: 0 };
    this._physics(p, p.alive ? wish.x : 0, p.alive ? wish.z : 0, L.speed, dt);
    if (p.y < GAME.fallY && p.alive) this._killPlayer(p, p.uid, false);
    if (p.alive && p.bot.wantJump && p.grounded) { p.vy = GAME.jumpVel; p.grounded = false; p.bot.wantJump = false; }
    if (p.alive && p.bot.wantFire) { this._tryFire(p); p.bot.wantFire = false; }
  }

  // ---------------- bot net sync ----------------
  getBotSnapshot() {
    const out = {};
    for (const p of this.players.values()) {
      if (!p.bot) continue;
      out[p.uid] = {
        n: p.name, x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2),
        yaw: +p.yaw.toFixed(2), hp: Math.round(p.hp), m: p.maxHp, a: p.alive ? 1 : 0, s: p.skin,
      };
    }
    return out;
  }

  setBotSnapshot(snap) {
    snap = snap || {};
    for (const uid of [...this.players.keys()]) {
      const p = this.players.get(uid);
      if (p.bot && !snap[uid]) this.removePlayer(uid);
    }
    for (const [uid, s] of Object.entries(snap)) {
      let p = this.players.get(uid);
      if (!p) {
        p = this._base(uid, s.n, s.s || 'ember', 'b');
        p.bot = { level: BOT_LEVELS[this.botLevel], brain: null };
        p.weapon = 'botgun';
        p.remote = false;
        p.x = p.netX = s.x; p.y = p.netY = s.y; p.z = p.netZ = s.z;
        this.players.set(uid, p);
        this._makeView(p, true);
      }
      if (p.alive && !s.a) {
        p.alive = false;
        this.fx.impact(V1.set(p.x, p.y + 1, p.z), 0xff8866, 14, 5);
        if (this._near(p, 45)) SFX.die();
      } else if (!p.alive && s.a) {
        p.alive = true;
        p.x = p.netX = s.x; p.y = p.netY = s.y; p.z = p.netZ = s.z;
      }
      p.netX = s.x; p.netY = s.y; p.netZ = s.z; p.netYaw = s.yaw;
      p.hp = s.hp; p.maxHp = s.m || 100;
    }
  }

  becomeHost() {
    this.isHost = true;
    for (const p of this.players.values()) {
      if (p.bot) { p.x = p.netX; p.y = p.netY; p.z = p.netZ; }
    }
  }

  // ---------------- views ----------------
  _updateViews(dt) {
    for (const p of this.players.values()) {
      if (!p.view) continue;
      const { char, bar } = p.view;
      char.group.visible = p.alive;
      if (!p.alive) continue;
      // crouch/slide squash follows the synced stance
      p.crouchK = lerp(p.crouchK, p.stance === 2 ? 1.15 : p.stance === 1 ? 1 : 0, 0.2);
      char.group.scale.y = 1 - Math.min(1, p.crouchK) * 0.3;
      char.group.position.set(p.x, p.y, p.z);
      char.group.rotation.y = p.yaw + Math.PI;
      const sp = p.remote || (p.bot && this.online && !this.isHost)
        ? Math.hypot(p.netX - p.x, p.netZ - p.z) * 12
        : Math.hypot(p.vx, p.vz);
      p.speedSm = lerp(p.speedSm, sp, 0.2);
      animateCharacter(char, dt, p.speedSm, true, p.danceT > 0);
      updateHpBar(bar, p.hp / p.maxHp);
      // spawn-protection shimmer
      char.group.traverse((o) => {
        if (o.isMesh && o.material.transparent !== undefined) {
          const flick = p.invulnT > 0 && Math.sin(this.elapsed * 16) > 0;
          o.material.opacity = flick ? 0.4 : 1;
          o.material.transparent = flick;
        }
      });
    }
  }

  _decayHud(dt) {
    const h = this.hudFlags;
    h.hitmarker = Math.max(0, h.hitmarker - dt);
    h.headshot = Math.max(0, h.headshot - dt);
    h.hurt = Math.max(0, h.hurt - dt);
  }

  // ---------------- match end ----------------
  timeLeft() { return this.endAt ? Math.max(0, (this.endAt - this.timeFn()) / 1000) : 0; }

  _checkEnd() {
    if (this.over) return;
    if (this.mode === 'team' && (!this.online || this.isHost)) {
      if (this.teamScore >= this.targetKills || this.botScore >= this.targetKills
        || (this.endAt && this.timeFn() >= this.endAt)) {
        this.forceGameOver({ teamWin: this.teamScore >= this.botScore });
      }
    }
  }

  forceGameOver(extra = {}) {
    if (this.over) return;
    const humans = [...this.players.values()].filter((p) => !p.bot);
    const placements = humans
      .map((p) => ({ uid: p.uid, name: p.name, kills: p.kills, deaths: p.deaths, tier: p.tier, score: p.score, me: p === this.me }))
      .sort((a, b) => b.tier - a.tier || b.kills - a.kills || a.deaths - b.deaths);
    this.over = {
      mode: this.mode,
      placements,
      teamScore: this.teamScore,
      botScore: this.botScore,
      winnerName: extra.winnerName || (placements[0] && placements[0].name),
      win: extra.winnerUid ? extra.winnerUid === this.me?.uid
        : extra.teamWin !== undefined ? extra.teamWin
        : placements.length > 0 && placements[0].me,
      ...extra,
    };
    if (this.onOver) this.onOver(this.over);
  }

  getSelfState() {
    const p = this.me;
    return {
      name: p.name, skin: p.skin,
      x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2),
      yaw: +p.yaw.toFixed(2), pitch: +p.pitch.toFixed(2),
      hp: Math.round(p.hp), maxHp: p.maxHp, alive: p.alive, ar: Math.round(p.armor),
      tier: p.tier, w: p.weapon, st: p.stance,
      kills: p.kills, deaths: p.deaths, score: p.score,
    };
  }

  dispose() {
    this.fx.dispose();
    this.scene.traverse((o) => {
      if (o.isMesh) o.geometry?.dispose?.();
    });
  }
}
