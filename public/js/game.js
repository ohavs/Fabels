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
  ZOMBIES, zombieWave, BR, ZONEWARS, CTF, TACTICAL, BUILD, BUILDDM, BOXFIGHT, BUILD_MODES, LOADOUT_KIT,
  BUILD_MATERIALS, MATERIAL_ORDER, TAC_KIT, TAC_ECON, TAC_PRICES, CREATIVE,
} from './config.js';
import { clamp, lerp, lerpAngle, rayAABB, raySphere, randId } from './util.js';
import { World, mat } from './world.js';
import { buildCharacter, setCharacterWeapon, animateCharacter, flashCharacter, makeNameSprite, makeHpBar, updateHpBar } from './chars.js';
import { Effects, ViewModel } from './weapons.js';
import { attachBrains } from './bots.js';
import { SFX } from './audio.js';
import { t } from './i18n.js';

const V1 = new THREE.Vector3();
const V2 = new THREE.Vector3();

// shared unit geometries — every build piece scales one of these instead of
// allocating (and leaking) its own BufferGeometry per mesh
const BOXGEO = new THREE.BoxGeometry(1, 1, 1);
const CONEGEO = new THREE.ConeGeometry(3.05 * 0.7, 1.7, 4);

const forwardOf = (yaw, pitch = 0) => ({
  x: -Math.sin(yaw) * Math.cos(pitch),
  y: -Math.sin(pitch),
  z: -Math.cos(yaw) * Math.cos(pitch),
});

// wall edit state → 9-bit mask (bit row*3+col set = that cell is an opening).
// Accepts a number, or the legacy 'door'/'full' strings.
const editMask = (e) => {
  if (typeof e === 'number') return e & 0x1ff;
  if (e === 'door') return 1 << 1;   // bottom-centre cell removed
  return 0;
};

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
    this.builds = new Map();           // id → {id, t, meshes, hp, owner}
    this.matchStats = { headshots: 0, nadeKills: 0, builds: 0 };
    this.pickups = new Map();          // id → {k, x, y, z, tier?, mesh}
    this.pickupT = PICKUPS.everyMs / 1000;
    this.isLoadout = LOADOUT_MODES.includes(o.mode);
    this.isTactical = o.mode === 'tactical';          // round-based plant/defuse
    this.isCreative = o.mode === 'creative';          // free build canvas, save/load
    this.myFace = o.myFace || null;                   // my uploaded face photo (dataURL)
    this.myPickaxe = o.myPickaxe || null;             // my equipped pickaxe style (cosmetic)
    this.viewModel.pickStyle = this.myPickaxe;        // first-person pickaxe recolor
    this.baseFov = o.baseFov || 75;                   // user FOV setting (settings screen)
    this.teamplay = ['team', 'zombies', 'ctf', 'tactical'].includes(o.mode);
    this.wave = 0;
    this.waveDelay = 3;
    this.startAt = o.startAt || Date.now();
    // BR and Zone Wars share the same shrinking-zone / last-standing rules
    this.brLike = o.mode === 'br' || o.mode === 'zonewars';
    this.zoneCfg = o.mode === 'zonewars' ? ZONEWARS : BR;
    this.canBuild = BUILD_MODES.includes(o.mode) || this.brLike;
    this.thirdPerson = BUILD_MODES.includes(o.mode);  // build modes start in 3rd person
    this.isBox = o.mode === 'boxfight';               // small bounded build-fight
    this.me = null;

    if (this.brLike) this._initZone();
    if (this.isBox) this._initArena();
    if (o.mode === 'ctf') this._initCtf();
    if (this.isTactical) this._initTactical();
    this.feed = [];
    this.over = null;
    this.elapsed = 0;
    this.teamScore = 0;
    this.botScore = 0;
    this.hudFlags = { hitmarker: 0, headshot: 0, hurt: 0, tierBanner: '', winBanner: '' };
    this._bobT = 0;
    this.shake = 0;                 // screen-shake magnitude, decays
    this.recoilP = 0; this.recoilY = 0;  // visual camera recoil (does not move aim)
    this.dmgFloats = [];            // floating damage numbers
    this.dmgDirs = [];              // incoming-damage direction pings {x, z, t}
    this.interpDelayMs = 120;       // render behind newest snapshot (adaptive: lower on WebRTC)

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
    this.onWave = null;         // zombies host → net
    this.onCtfState = null;     // ctf host → net (flags/score snapshot)
    this.onCtfEvent = null;     // ctf host → net (banner events)
    this.onTacState = null;     // tactical host → net (round/bomb snapshot)
    this.onBuildPlace = null;   // my build → net
    this.onBuildDestroy = null; // build I destroyed → net
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
      inv: null, slot: 0,          // Fortnite-style hotbar (local player, loadout modes)
      cash: this.isTactical ? TAC_ECON.start : 0,   // tactical round economy
      kills: 0, deaths: 0, score: 0,
      // stance: 0 stand · 1 crouch · 2 slide (synced); crouchK = smoothed 0..1
      stance: 0, crouchK: 0, slideT: 0, slideCd: 0, slideDirX: 0, slideDirZ: 0,
      ads: false, bloom: 0,
      armor: 0, nades: GRENADE.start, nadeCd: 0,
      mats: this.mode === 'builddm' ? BUILDDM.matsStart : this.mode === 'boxfight' ? BOXFIGHT.matsStart : this.mode === 'zonewars' ? ZONEWARS.matsStart : BUILD.matsStart, buildCd: 0, pickCd: 0,
      buildMat: 'wood',            // current build material (wood/brick/metal)
      streak: 0, buffSpeedT: 0, buffDmgT: 0, danceT: 0, lastShotAt: -99,
      local: false, remote: false, bot: null,
      netX: 0, netY: 0, netZ: 0, netYaw: 0, netPitch: 0,
      view: null, speedSm: 0, chatT: 0, deadT: 0,
    };
  }

  // Boxfight: a fixed small arena ring at map centre, with out-of-bounds
  // damage (no shrink, no last-standing — it's a timed deathmatch).
  _initArena() {
    const r = this.world.size * BOXFIGHT.arenaFactor;
    this.arena = { r };
    const geo = new THREE.CylinderGeometry(1, 1, 40, 40, 1, true);
    const m = new THREE.MeshBasicMaterial({ color: 0xff5aa0, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false });
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.y = 20; mesh.scale.set(r, 1, r);
    this.scene.add(mesh);
    this.arena.mesh = mesh;
  }

  _updateArena(dt) {
    if (!this.arena) return;
    this._arenaTick = (this._arenaTick || 0) + dt;
    if (this._arenaTick < 0.5) return;
    this._arenaTick = 0;
    for (const q of this.players.values()) {
      if (!q.alive || q.remote) continue;
      if (Math.hypot(q.x, q.z) > this.arena.r) {
        q.invulnT = 0;
        this._damagePlayer(q, BOXFIGHT.arenaDps * 0.5, 'zone', {});
        if (q === this.me) this.hudFlags.hurt = 0.4;
      }
    }
  }

  _spawnPos(p, idx = -1) {
    const spawns = this.world.spawns;
    // Tactical: spawn at your team's side, spread around the base
    if (this.isTactical && this.tac) return this._tacSpawn(p);
    // Boxfight keeps everyone near the centre so fights stay tight. Pick a
    // central spawn (farthest from enemies among the closest half) and pull
    // it inside the arena ring so nobody spawns in the out-of-bounds zone.
    if (this.isBox && spawns.length) {
      const central = [...spawns]
        .sort((a, b) => (a.x * a.x + a.z * a.z) - (b.x * b.x + b.z * b.z))
        .slice(0, Math.max(4, Math.ceil(spawns.length / 2)));
      let best = central[0], bestD = -1;
      for (const s of central) {
        let d = Infinity;
        for (const q of this.players.values()) {
          if (q === p || !q.alive) continue;
          d = Math.min(d, (q.x - s.x) ** 2 + (q.z - s.z) ** 2);
        }
        if (d === Infinity) d = Math.random() * 1e6;
        if (d > bestD) { bestD = d; best = s; }
      }
      const ringR = (this.arena ? this.arena.r : this.world.size * BOXFIGHT.arenaFactor) * 0.65;
      const d = Math.hypot(best.x, best.z);
      if (d > ringR) { const k = ringR / d; return { x: best.x * k, y: best.y, z: best.z * k }; }
      return best;
    }
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

  addLocal(uid, name, skinId, spawnIdx, team = 'p') {
    const p = this._base(uid, name, skinId, team);
    p.local = true;
    if (this.mode === 'ctf' && this.ctf) {
      const base = this.ctf.bases[team] || this.ctf.bases.r;
      this._place(p, { x: base.x + (Math.random() - 0.5) * 4, y: base.y, z: base.z + (Math.random() - 0.5) * 4 });
    } else {
      this._place(p, this._spawnPos(p, spawnIdx ?? 0));
    }
    this.players.set(uid, p);
    this.me = p;
    if (this.isLoadout) this._giveInventory(p);   // Fortnite-style hotbar
    // own character (shown in third person, hidden in first person)
    this._makeView(p, false);
    this.viewModel.setWeapon(this._heldItem());
    this._syncCamera(p);
    return p;
  }

  _makeView(p, isBot) {
    // my own model gets the uploaded face photo (local view only)
    const char = buildCharacter(p.skin, p === this.me && this.myFace ? { face: this.myFace } : {});
    char.group.position.set(p.x, p.y, p.z);
    const nameColor = this.mode === 'ctf'
      ? (p.team === 'r' ? '#ff6b6b' : '#7db4ff')
      : isBot ? '#ff9b9b' : '#ffffff';
    const name = makeNameSprite(p.name, nameColor);
    char.nameSprite = name;
    char.group.add(name);
    const bar = makeHpBar();
    char.group.add(bar.bg, bar.fg);
    setCharacterWeapon(char, p.weapon);
    this.scene.add(char.group);
    p.view = { char, bar };
  }

  addBot(name, level, spawnIdx, team = 'b') {
    const uid = 'bot_' + randId(5);
    const skins = Object.keys(SKINS);
    const p = this._base(uid, name, skins[(Math.random() * skins.length) | 0], team);
    const L = BOT_LEVELS[level] || BOT_LEVELS.normal;
    p.maxHp = p.hp = L.hp;
    p.weapon = this.isLoadout ? 'pistol' : 'botgun';
    if (!this.isLoadout) p.ammo = Infinity;
    p.bot = { level: L, brain: null };
    if (this.mode === 'ctf' && this.ctf && this.ctf.bases[team]) {
      const base = this.ctf.bases[team];
      this._place(p, { x: base.x + (Math.random() - 0.5) * 5, y: base.y, z: base.z + (Math.random() - 0.5) * 5 });
    } else {
      this._place(p, this._spawnPos(p, spawnIdx ?? -1));
    }
    this.players.set(uid, p);
    this._makeView(p, true);
    return p;
  }

  // ---------------- zombies ----------------
  static zombiePalette(kind) {
    const Z = ZOMBIES[kind];
    return { body: Z.color, accent: 0x2f3b25, skin: 0x9fb96b };
  }

  addZombie(kind, waveN) {
    const Z = ZOMBIES[kind];
    const uid = 'bot_' + randId(5);
    const p = this._base(uid, `${t('zombie_' + kind)}-${(Math.random() * 90 + 10) | 0}`, Game.zombiePalette(kind), 'b');
    p.maxHp = p.hp = Z.hp + waveN * 2;
    p.weapon = kind === 'spitter' ? 'spit' : 'zmelee';
    p.ammo = Infinity;
    p.zscale = Z.scale;
    p.bot = { zombie: kind, zdef: Z, level: { speed: Z.speed, hp: Z.hp }, brain: null, wish: { x: 0, z: 0 } };
    // spawn at a random arena edge
    const S = this.world.size / 2 - 3;
    const edge = (Math.random() * 4) | 0;
    const r = (Math.random() - 0.5) * 2 * S;
    const pos = [[r, -S], [r, S], [-S, r], [S, r]][edge];
    this._place(p, { x: pos[0], y: 0, z: pos[1] });
    p.invulnT = 0.5;
    this.players.set(uid, p);
    this._makeView(p, true);
    return p;
  }

  _zombieWaves(dt) {
    if (this.over) return;
    const anyZombie = [...this.players.values()].some((q) => q.bot && q.alive);
    if (anyZombie) return;
    this.waveDelay -= dt;
    if (this.waveDelay > 0) return;
    this.waveDelay = 4;
    this.wave++;
    const list = zombieWave(this.wave);
    for (const kind of list) this.addZombie(kind, this.wave);
    attachBrains(this);
    this.feed.push({ text: t(list.includes('brute') ? 'zbruteIncoming' : 'zwaveIncoming', { n: this.wave }), t: 4 });
    this.hudFlags.tierBanner = t('zwave', { n: this.wave });
    SFX.tierUp();
    if (this.onWave) this.onWave(this.wave);
  }

  // ---------------- battle royale: shrinking zone ----------------
  _initZone() {
    const S = this.world.size;
    const r0 = S * this.zoneCfg.startFactor;
    this.zone = { r: r0, r0 };
    const geo = new THREE.CylinderGeometry(1, 1, 44, 48, 1, true);
    const mat_ = new THREE.MeshBasicMaterial({
      color: 0x39a0ff, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false,
    });
    this.zone.mesh = new THREE.Mesh(geo, mat_);
    this.zone.mesh.position.y = 22;
    this.scene.add(this.zone.mesh);
    this._zoneWarned = 0;
  }

  // radius is a pure function of match time → identical on every client
  _zoneRadius(tSec) {
    const S = this.world.size;
    let r = S * this.zoneCfg.startFactor, elapsed = tSec;
    for (const [wait, shrink, factor] of this.zoneCfg.zonePhases) {
      const target = S * factor;
      if (elapsed < wait) return r;
      elapsed -= wait;
      if (elapsed < shrink) return lerp(r, target, elapsed / shrink);
      elapsed -= shrink;
      r = target;
    }
    return r;
  }

  _updateZone(dt) {
    if (!this.zone) return;
    const tSec = Math.max(0, (this.timeFn() - this.startAt) / 1000);
    const prev = this.zone.r;
    this.zone.r = this._zoneRadius(tSec);
    this.zone.mesh.scale.set(this.zone.r, 1, this.zone.r);
    if (this.zone.r < prev - 0.001 && this.elapsed - this._zoneWarned > 8) {
      this._zoneWarned = this.elapsed;
      this.hudFlags.tierBanner = t('zoneShrinking');
      SFX.wave?.();
    }
    // damage everyone I simulate that is outside the circle
    this._zoneTick = (this._zoneTick || 0) + dt;
    if (this._zoneTick >= 0.5) {
      this._zoneTick = 0;
      for (const q of this.players.values()) {
        if (!q.alive || q.remote) continue;
        if (Math.hypot(q.x, q.z) > this.zone.r) {
          q.invulnT = 0;
          this._damagePlayer(q, this.zoneCfg.zoneDps * 0.5, 'zone', {});
          if (q === this.me) this.hudFlags.hurt = 0.4;
        }
      }
    }
    // last one standing — every client can see this via state sync.
    // Require ≥2 combatants ever present so a solo practice run doesn't
    // instantly declare victory.
    if (!this.over && this.elapsed > 5 && this.players.size >= 2) {
      const alive = [...this.players.values()].filter((q) => q.alive);
      if (alive.length === 1) {
        const w = alive[0];
        this.forceGameOver({ winnerUid: w.uid, winnerName: w.name, brPlace: w === this.me ? 1 : this._brMyPlace });
      }
    }
    // my personal elimination → short delay, then my results
    if (this._brEndT !== undefined && !this.over) {
      this._brEndT -= dt;
      if (this._brEndT <= 0) this.forceGameOver({ brPlace: this._brMyPlace });
    }
  }

  spawnBrLoot() {
    if (!this.brLike) return;
    for (let i = 0; i < this.zoneCfg.lootCount; i++) this._spawnRandomPickup();
  }

  brAliveCount() {
    return [...this.players.values()].filter((q) => q.alive).length;
  }

  // ---------------- capture the flag ----------------
  _initCtf() {
    // two bases: the farthest-apart spawn pair
    const sp = this.world.spawns;
    let a = sp[0], b = sp[1], best = 0;
    for (let i = 0; i < sp.length; i++) for (let j = i + 1; j < sp.length; j++) {
      const d = (sp[i].x - sp[j].x) ** 2 + (sp[i].z - sp[j].z) ** 2;
      if (d > best) { best = d; a = sp[i]; b = sp[j]; }
    }
    this.ctf = {
      score: { r: 0, b: 0 },
      bases: { r: a, b: b },
      flags: {
        r: { state: 'base', carrier: null, x: a.x, y: a.y, z: a.z, dropT: 0 },
        b: { state: 'base', carrier: null, x: b.x, y: b.y, z: b.z, dropT: 0 },
      },
    };
    for (const teamId of ['r', 'b']) {
      const color = teamId === 'r' ? 0xff4444 : 0x448cff;
      const g = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 6), mat(0xcccccc));
      pole.position.y = 1.3;
      const cloth = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.06), mat(color, { emissive: color }));
      cloth.position.set(-0.45, 2.2, 0);
      g.add(pole, cloth);
      this.scene.add(g);
      this.ctf.flags[teamId].mesh = g;
      // base pad
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.12, 24), mat(color));
      const base = this.ctf.bases[teamId];
      pad.position.set(base.x, 0.06 + base.y, base.z);
      this.scene.add(pad);
    }
  }

  myTeam() { return this.me?.team || 'r'; }

  _updateCtf(dt) {
    if (!this.ctf) return;
    const authoritative = !this.online || this.isHost;
    for (const teamId of ['r', 'b']) {
      const f = this.ctf.flags[teamId];
      // visual placement
      if (f.state === 'carried') {
        const c = this.players.get(f.carrier);
        if (c && c.alive) {
          f.x = c.x; f.y = c.y; f.z = c.z;
        } else if (authoritative) {
          // carrier died/left → drop
          f.state = 'dropped'; f.carrier = null; f.dropT = CTF.returnSec;
          this._ctfEvent('fdrop', teamId);
        }
      }
      f.mesh.position.set(f.x, f.y + (f.state === 'carried' ? 1.2 : 0), f.z);
      f.mesh.rotation.y += dt;

      if (!authoritative) continue;

      if (f.state === 'dropped') {
        f.dropT -= dt;
        if (f.dropT <= 0) this._ctfReturn(teamId);
      }
      // touches (humans only, enemy flag → grab; own flag dropped → return)
      for (const q of this.players.values()) {
        if (!q.alive || q.bot) continue;
        const d2 = (q.x - f.x) ** 2 + (q.z - f.z) ** 2;
        if (d2 > 2.6) continue;
        if (q.team !== teamId && f.state !== 'carried') {
          f.state = 'carried'; f.carrier = q.uid; f.dropT = 0;
          this._ctfEvent('ftaken', teamId, q.name);
        } else if (q.team === teamId && f.state === 'dropped') {
          this._ctfReturn(teamId);
        }
      }
      // capture: enemy carrier reaches their own base while their flag is home
      if (f.state === 'carried') {
        const c = this.players.get(f.carrier);
        if (c) {
          const myBase = this.ctf.bases[c.team];
          const myFlag = this.ctf.flags[c.team];
          if (myFlag.state === 'base'
            && (c.x - myBase.x) ** 2 + (c.z - myBase.z) ** 2 < 4.5) {
            this.ctf.score[c.team]++;
            this._ctfReturn(teamId);
            this._ctfEvent('fcap', teamId, c.name, this.ctf.score);
            if (this.ctf.score[c.team] >= CTF.captures) {
              this.forceGameOver({ teamWin: c.team === this.myTeam(), ctfWinner: c.team });
            }
          }
        }
      }
    }
    if (authoritative && this.onCtfState) this._ctfSyncT = (this._ctfSyncT || 0) + dt;
    if (authoritative && this.onCtfState && this._ctfSyncT > 0.25) {
      this._ctfSyncT = 0;
      this.onCtfState(this.getCtfState());
    }
    if (authoritative && this.endAt && this.timeFn() >= this.endAt && !this.over) {
      const s = this.ctf.score;
      const winner = s.r === s.b ? null : s.r > s.b ? 'r' : 'b';
      this.forceGameOver({ teamWin: winner ? winner === this.myTeam() : false, ctfWinner: winner });
    }
  }

  _ctfReturn(teamId) {
    const f = this.ctf.flags[teamId];
    const base = this.ctf.bases[teamId];
    f.state = 'base'; f.carrier = null;
    f.x = base.x; f.y = base.y; f.z = base.z;
    this._ctfEvent('fret', teamId);
  }

  _ctfEvent(kind, teamId, name = '', score = null) {
    const msgs = { ftaken: t('flagTaken', { name }), fdrop: t('flagDropped'), fret: t('flagReturned'), fcap: t('flagCaptured', { name }) };
    this.feed.push({ text: msgs[kind], t: 4 });
    if (kind === 'fcap') SFX.tierUp();
    if (this.onCtfEvent && (!this.online || this.isHost)) this.onCtfEvent({ kind, teamId, name });
  }

  getCtfState() {
    const out = { score: this.ctf.score };
    for (const teamId of ['r', 'b']) {
      const f = this.ctf.flags[teamId];
      out[teamId] = { s: f.state, c: f.carrier, x: +f.x.toFixed(1), y: +f.y.toFixed(1), z: +f.z.toFixed(1), dt: +f.dropT.toFixed(1) };
    }
    return out;
  }

  setCtfState(st) {
    if (!this.ctf || !st) return;
    this.ctf.score = st.score || this.ctf.score;
    for (const teamId of ['r', 'b']) {
      const f = this.ctf.flags[teamId], v = st[teamId];
      if (!v) continue;
      f.state = v.s; f.carrier = v.c || null; f.dropT = v.dt || 0;
      if (f.state !== 'carried') { f.x = v.x; f.y = v.y; f.z = v.z; }
    }
  }

  // ==================== Tactical (plant / defuse rounds) ====================
  _initTactical() {
    // two team spawns = the farthest-apart pair (attackers r vs defenders b)
    const sp = this.world.spawns;
    let a = sp[0], b = sp[1], best = 0;
    for (let i = 0; i < sp.length; i++) for (let j = i + 1; j < sp.length; j++) {
      const d = (sp[i].x - sp[j].x) ** 2 + (sp[i].z - sp[j].z) ** 2;
      if (d > best) { best = d; a = sp[i]; b = sp[j]; }
    }
    this.tac = {
      phase: 'prep', round: 1, score: { r: 0, b: 0 }, timer: TACTICAL.prepTime,
      planted: false, plantProg: 0, defuseProg: 0, bomb: null,
      site: { x: 0, z: 0, r: TACTICAL.siteR }, spawns: { r: a, b: b }, endReason: '', roundWinner: null,
    };
    // plant-site ring
    const ring = new THREE.Mesh(
      new THREE.CylinderGeometry(TACTICAL.siteR, TACTICAL.siteR, 0.12, 32, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffcf3f, transparent: true, opacity: 0.26, side: THREE.DoubleSide, depthWrite: false }));
    ring.position.set(0, 0.12, 0);
    this.scene.add(ring); this.tac.siteMesh = ring;
    // bomb (hidden until planted)
    const bomb = new THREE.Group();
    bomb.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.3), mat(0x222831)));
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.03), mat(0xff3131, { emissive: 0xff3131 }));
    led.position.set(0, 0.12, 0.16); bomb.add(led);
    bomb.visible = false; bomb.position.set(0, 0.2, 0);
    this.scene.add(bomb); this.tac.bombMesh = bomb; this.tac.bombLed = led;
  }

  _tacSpawn(p) {
    const base = this.tac.spawns[p.team === 'r' ? 'r' : 'b'];
    const idx = [...this.players.values()].filter((q) => q.team === p.team).indexOf(p);
    const ang = idx * 1.35;
    return { x: base.x + Math.cos(ang) * 2, y: base.y, z: base.z + Math.sin(ang) * 2 };
  }

  _tacTeamAlive(team) { let n = 0; for (const p of this.players.values()) if (p.team === team && p.alive) n++; return n; }

  _updateTactical(dt) {
    const tac = this.tac; if (!tac) return;
    // shared visuals (all clients)
    if (tac.bombMesh) tac.bombMesh.visible = tac.planted;
    if (tac.planted && tac.bombLed) {
      const fast = tac.timer < 8 ? 16 : 6;
      tac.bombLed.material.emissiveIntensity = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(this.elapsed * fast));
    }
    if (tac.siteMesh) tac.siteMesh.material.color.setHex(tac.planted ? 0xff4444 : 0xffcf3f);

    if (this.online && !this.isHost) return;   // guests display only; host drives + syncs

    tac.timer = Math.max(0, tac.timer - dt);
    if (tac.phase === 'prep') {
      if (tac.timer <= 0) { tac.phase = 'live'; tac.timer = TACTICAL.roundTime; this.hudFlags.tierBanner = t('tacLive'); }
    } else if (tac.phase === 'live') {
      this._tacObjectives();
      this._tacPlantTick(dt);
      if (!tac.planted) {
        if (this._tacTeamAlive('r') === 0) return this._endTacRound('b', 'elim');
        if (this._tacTeamAlive('b') === 0) return this._endTacRound('r', 'elim');
        if (tac.timer <= 0) return this._endTacRound('b', 'time');
      }
    } else if (tac.phase === 'planted') {
      this._tacObjectives();
      this._tacDefuseTick(dt);
      if (tac.timer <= 0) return this._endTacRound('r', 'detonate');
      if (this._tacTeamAlive('b') === 0) return this._endTacRound('r', 'nodefuse');
    } else if (tac.phase === 'end') {
      if (tac.timer <= 0) this._startTacRound();
    }
    this._tacSync(dt);
  }

  // steer idle bots toward the objective (they still break off to fight)
  _tacObjectives() {
    const tac = this.tac;
    for (const p of this.players.values()) {
      if (!p.bot || !p.alive) continue;
      if (p.team === 'r') p.bot.objective = tac.planted ? null : { x: tac.site.x, z: tac.site.z };
      else p.bot.objective = tac.planted && tac.bomb ? { x: tac.bomb.x, z: tac.bomb.z } : { x: tac.site.x, z: tac.site.z };
    }
  }

  _tacPlantTick(dt) {
    const tac = this.tac;
    let planter = null;
    for (const p of this.players.values()) {
      if (!p.alive || p.team !== 'r') continue;
      if (Math.hypot(p.x - tac.site.x, p.z - tac.site.z) <= tac.site.r) { planter = p; break; }
    }
    if (planter) { tac.plantProg += dt; if (tac.plantProg >= TACTICAL.plantTime) this._tacPlant(planter); }
    else tac.plantProg = Math.max(0, tac.plantProg - dt * 2);
  }

  _tacPlant(p) {
    const tac = this.tac;
    tac.planted = true; tac.phase = 'planted'; tac.timer = TACTICAL.bombTimer;
    tac.bomb = { x: p.x, z: p.z }; tac.defuseProg = 0; tac.plantProg = 0;
    if (p === this.me) p.cash = Math.min(TAC_ECON.max, p.cash + TAC_ECON.plant);
    if (tac.bombMesh) tac.bombMesh.position.set(p.x, 0.2, p.z);
    this.hudFlags.winBanner = t('bombPlanted');
    if (this._near(p, 60)) SFX.tierUp?.();
  }

  _tacDefuseTick(dt) {
    const tac = this.tac;
    const bx = tac.bomb ? tac.bomb.x : tac.site.x, bz = tac.bomb ? tac.bomb.z : tac.site.z;
    let defuser = null;
    for (const p of this.players.values()) {
      if (!p.alive || p.team !== 'b') continue;
      if (Math.hypot(p.x - bx, p.z - bz) <= 1.8) { defuser = p; break; }
    }
    if (defuser) { tac.defuseProg += dt; if (tac.defuseProg >= TACTICAL.defuseTime) this._endTacRound('b', 'defuse'); }
    else tac.defuseProg = Math.max(0, tac.defuseProg - dt * 1.5);
  }

  _endTacRound(winner, reason) {
    const tac = this.tac;
    if (tac.phase === 'end') return;
    tac.score[winner]++;
    tac.phase = 'end'; tac.timer = 4; tac.endReason = reason; tac.roundWinner = winner;
    tac.planted = false; tac.plantProg = 0; tac.defuseProg = 0;
    this._tacPay(winner === this.myTeam());          // round credits (host/offline)
    this.hudFlags.winBanner = t(winner === this.myTeam() ? 'roundWon' : 'roundLost');
    SFX.tierUp?.();
    if (tac.score[winner] >= TACTICAL.winRounds) {
      this.forceGameOver({ teamWin: winner === this.myTeam(), tacWinner: winner });
    }
    this._tacSync(0, true);
  }

  _startTacRound() {
    const tac = this.tac;
    tac.round++; tac.phase = 'prep'; tac.timer = TACTICAL.prepTime;
    tac.planted = false; tac.bomb = null; tac.plantProg = 0; tac.defuseProg = 0;
    if (tac.bombMesh) tac.bombMesh.visible = false;
    // host respawns bots + itself; remote humans respawn themselves on round++
    for (const p of this.players.values()) {
      if (p.remote) continue;
      p.alive = true; p.hp = p.maxHp; p.armor = 0; p.invulnT = GAME.invulnTime;
      if (p.inv) this._giveInventory(p);
      else if (p.bot) {
        // bots "buy" with a scripted economy: pistols round 1, better gear later
        const shop = ['smg', 'shotgun', 'rifle', 'rifle', 'lmg', 'sniper'];
        p.weapon = tac.round <= 1 ? 'pistol' : shop[(Math.random() * shop.length) | 0];
        p.ammo = WEAPONS[p.weapon].mag;
        if (tac.round > 1 && Math.random() < 0.6) p.armor = 50;
        if (p.view) setCharacterWeapon(p.view.char, p.weapon);
      }
      if (p.bot) p.bot.objective = null;
      this._place(p, this._tacSpawn(p));
    }
    this.hudFlags.tierBanner = t('tacRound', { n: tac.round });
    this._tacSync(0, true);
  }

  _tacSync(dt, force) {
    if (!this.onTacState) return;
    this._tacSyncT = (this._tacSyncT || 0) + (dt || 0);
    if (!force && this._tacSyncT < 0.25) return;
    this._tacSyncT = 0;
    this.onTacState(this.getTacState());
  }

  getTacState() {
    const tac = this.tac;
    return {
      ph: tac.phase, rd: tac.round, sr: tac.score.r, sb: tac.score.b,
      tm: +tac.timer.toFixed(1), pl: tac.planted ? 1 : 0,
      pp: +tac.plantProg.toFixed(1), dp: +tac.defuseProg.toFixed(1),
      bx: tac.bomb ? +tac.bomb.x.toFixed(1) : 0, bz: tac.bomb ? +tac.bomb.z.toFixed(1) : 0,
      rw: tac.roundWinner || '',
    };
  }

  setTacState(st) {
    const tac = this.tac; if (!tac || !st) return;
    const prevRound = tac.round;
    // round just ended → pay my round credits (guests mirror the host's econ)
    if (st.ph === 'end' && tac.phase !== 'end' && st.rw) this._tacPay(st.rw === this.myTeam());
    tac.phase = st.ph; tac.round = st.rd; tac.score.r = st.sr; tac.score.b = st.sb;
    tac.roundWinner = st.rw || tac.roundWinner;
    tac.timer = st.tm; tac.planted = !!st.pl; tac.plantProg = st.pp; tac.defuseProg = st.dp;
    tac.bomb = st.pl ? { x: st.bx, z: st.bz } : null;
    if (tac.bomb && tac.bombMesh) tac.bombMesh.position.set(st.bx, 0.2, st.bz);
    // a new round started → respawn my own player
    if (st.rd > prevRound && this.me) {
      this.me.alive = true; this.me.hp = this.me.maxHp; this.me.armor = 0; this.me.invulnT = GAME.invulnTime;
      if (this.me.inv) this._giveInventory(this.me);
      this._place(this.me, this._tacSpawn(this.me));
    }
  }

  // zombie melee swipe (host/offline); spitters go through _tryFire
  zombieAttack(p, target) {
    const Z = p.bot.zdef;
    if (p.weapon === 'spit') { this._tryFire(p); return; }
    this.fx.impact(V1.set(target.x, target.y + 1.2, target.z), 0x7fbf4a, 8, 3);
    if (this._near(target, 40)) SFX.hit();
    this._damagePlayer(target, Z.dmg, p.uid, {});
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
    if (p.alive) this._pushSnap(p, p.netX, p.netY, p.netZ, p.netYaw, p.netPitch);
    p.hp = st.hp; p.maxHp = st.maxHp || 100;
    p.armor = st.ar || 0;
    p.stance = st.st || 0;
    if (st.tm) p.team = st.tm;
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
      p.buildCd = Math.max(0, p.buildCd - dt);
      p.pickCd = Math.max(0, p.pickCd - dt);
      p.mantleCd = Math.max(0, (p.mantleCd || 0) - dt);
      p.buffSpeedT = Math.max(0, p.buffSpeedT - dt);
      p.buffDmgT = Math.max(0, p.buffDmgT - dt);
      p.danceT = Math.max(0, p.danceT - dt);
      if (p.reloadT > 0) {
        p.reloadT -= dt;
        if (p.reloadT <= 0) {
          p.reloadT = 0;
          p.ammo = WEAPONS[p.weapon].mag;
          if (p.inv && p.inv[p.slot]) p.inv[p.slot].ammo = p.ammo;
          if (p === this.me) SFX.reloadDone();
        }
      }
      if (!p.alive && !p.remote && !this.brLike && !this.isTactical) {
        p.respawnT -= dt;
        if (p.respawnT <= 0 && !this.over) this._respawn(p);
      }

      if (p.remote) this._interpRemote(p, dt);
      else if (p.bot && !(this.online && !this.isHost)) this._botStep(p, dt);
      else if (p.bot) this._interpRemote(p, dt); // guest view of host's bots
      else if (p.local) this._localStep(p, dt);
    }

    if (this.mode === 'zombies' && (!this.online || this.isHost)) this._zombieWaves(dt);
    if (this.brLike) this._updateZone(dt);
    if (this.isBox) this._updateArena(dt);
    if (this.mode === 'ctf') this._updateCtf(dt);
    if (this.isTactical) this._updateTactical(dt);
    this._updateProjectiles(dt);
    this._updateGrenades(dt);
    this._updatePickups(dt);
    this._updateViews(dt);
    this._updateGhost();
    this._updateFeel(dt);
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
      // sticky aim assist (touch + gamepad): slow the look while over an enemy
      const assist = input.aimAssistOn && (input.touchMode || input._padActive)
        && this._aimNearEnemy(p) ? 0.45 : 1;
      p.yaw -= look.dx * assist;
      p.pitch = clamp(p.pitch + look.dy * assist, -1.45, 1.45);
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
      // no ADS while holding the pickaxe or a build piece (you can't scope a pickaxe)
      const holdingTool = (this.canBuild && input.tool && input.tool !== 'gun') || p.weapon === 'pickaxe';
      p.ads = input.aiming && !WEAPONS[p.weapon].melee && !holdingTool;
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
      } else if ((input.consumeSlide() || (input.crouchHeld && this._wasSprinting)) && p.grounded && p.slideCd <= 0 && moving) {
        // slide: sprint+crouch, OR a long-press of the crouch button (wantSlide)
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
      if (this.ctf && (this.ctf.flags.r.carrier === p.uid || this.ctf.flags.b.carrier === p.uid)) speed *= CTF.carrierSlow;

      if (input.consumeJump() && p.grounded) {
        if (p.slideT > 0) {
          // slide-jump: convert the slide into a boosted leap (momentum carries)
          p.vx = p.slideDirX * GAME.slideSpeed * 1.12;
          p.vz = p.slideDirZ * GAME.slideSpeed * 1.12;
          p.vy = GAME.jumpVel * 1.05;
          p.slideT = 0; p.stance = 0; p.grounded = false;
          SFX.jump();
        } else if (p.stance !== 0) { p.stance = 0; input.crouchHeld = input.touchMode ? false : input.crouchHeld; }
        else {
          p.vy = GAME.jumpVel;
          p.grounded = false;
          SFX.jump();
        }
      }
      if (input.consumeReload()) this._startReload(p);
      if (input.consumeNade()) this.throwNade(p);
      const em = input.consumeEmote();
      if (em >= 0) this.doEmote(em);
      if (input.consumeCamera()) this.thirdPerson = !this.thirdPerson;
      const chat = input.consumeChat();
      if (chat >= 0 && this.onChat) this.onChat(chat);

      // action routed by the selected tool (gun / pickaxe / build piece / edit)
      const tool = this.canBuild ? input.tool : 'gun';
      if (tool !== 'edit' && this._editSess) this._editSess = null;   // dropped a pending edit
      if (tool === 'wall' || tool === 'ramp' || tool === 'floor' || tool === 'cone') {
        if (input.firing) this.placeBuild({ wall: 'w', ramp: 'r', floor: 'f', cone: 'c' }[tool]);
      } else if (tool === 'pick' || (tool === 'gun' && p.weapon === 'pickaxe')) {
        // pickaxe — whether picked from the build bar or held as hotbar slot 0
        if (input.firing) this._swingPickaxe(p);
      } else if (tool === 'edit') {
        this._editStep(p, input);
      } else {
        // gun: manual, or mobile auto-fire when the crosshair rests on an enemy
        if (input.firing || (input.touchMode && input.autoFire && this._crosshairOnEnemy(p))) {
          this._tryFire(p);
        }
      }
    }

    // smooth crouch factor (also drives eye height + hitbox scale)
    const targetK = p.stance === 2 ? 1.15 : p.stance === 1 ? 1 : 0;
    p.crouchK = lerp(p.crouchK, targetK, Math.min(1, dt * 10));

    this._physics(p, wishX, wishZ, speed, dt);
    if (p.y < GAME.fallY && p.alive) this._killPlayer(p, p.uid, false);

    // footsteps: soft rhythmic taps while running (faster cadence sprinting)
    this._stepT = (this._stepT || 0) - dt;
    const spd = Math.hypot(p.vx, p.vz);
    if (p.alive && p.grounded && p.stance !== 2 && spd > 2.4 && this._stepT <= 0) {
      const fast = spd > GAME.moveSpeed + 0.5;
      SFX.step(fast);
      this._stepT = fast ? 0.27 : 0.36;
    }

    this._syncCamera(p, dt);
  }

  // wider cone than auto-fire: used to soften look sensitivity (sticky aim)
  _aimNearEnemy(p) {
    const f = forwardOf(p.yaw, p.pitch);
    for (const q of this.players.values()) {
      if (q === p || !q.alive) continue;
      if (this.teamplay && q.team === p.team) continue;
      const dx = q.x - p.x, dy = (q.y + 1.1) - (p.y + GAME.eyeHeight), dz = q.z - p.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > 45 || d < 1) continue;
      const dot = (dx * f.x + dy * f.y + dz * f.z) / d;
      if (dot > Math.cos(0.09 + 0.8 / d)) return true;
    }
    return false;
  }

  // is an enemy under the crosshair (small cone + line of sight)?
  _crosshairOnEnemy(p) {
    if (p.fireCd > 0 || p.reloadT > 0) return false;
    const f = forwardOf(p.yaw, p.pitch);
    const w = WEAPONS[p.weapon];
    for (const q of this.players.values()) {
      if (q === p || !q.alive || q.invulnT > 0) continue;
      if (this.teamplay && q.team === p.team) continue;
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
    const sp = Math.hypot(p.vx, p.vz);
    let s = w.spread;
    if (p.ads) s *= (sp < 0.5 ? 0.26 : 0.42);   // standing-still ADS is pin-point
    if (p.stance === 1) s *= 0.7;                // crouch bonus
    if (sp > GAME.moveSpeed * 0.6) s *= 1.5;     // running penalty
    if (!p.grounded) s *= 1.9;                   // airborne penalty
    return s + p.bloom;
  }

  _syncCamera(p, dt = 1 / 60) {
    // kill-cam: while dead, ease the camera toward the killer
    if (!p.alive && this._killerCam) {
      const killer = this.players.get(this._killerCam);
      if (killer && killer.alive) {
        const dx = killer.x - p.x, dz = killer.z - p.z;
        const d = Math.hypot(dx, dz) || 1;
        const wantYaw = Math.atan2(-dx, -dz);
        const wantPitch = -Math.atan2((killer.y + 1.3) - (p.y + GAME.eyeHeight), d);
        p.yaw = lerpAngle(p.yaw, wantYaw, Math.min(1, dt * 3));
        p.pitch = lerp(p.pitch, wantPitch, Math.min(1, dt * 3));
      }
    } else if (p.alive) {
      this._killerCam = null;
    }
    const sp = Math.hypot(p.vx, p.vz);
    if (sp > 1 && p.grounded) this._bobT += Math.min(0.06, sp * 0.004);
    const eye = GAME.eyeHeight - p.crouchK * 0.62;
    const tp = this.thirdPerson && !p.ads;   // ADS always snaps to first person

    if (tp) {
      // over-the-shoulder: sit behind & above, pull in when a wall is close
      const f = forwardOf(p.yaw, p.pitch);
      const back = 4.2, up = 1.7, side = 0.65;
      const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
      let dist = back;
      const ox = p.x + rx * side, oy = p.y + eye + 0.3, oz = p.z + rz * side;
      // don't clip the camera through geometry behind the player
      for (const c of this.world.colliders) {
        const tt = rayAABB(oy !== undefined ? ox : ox, oy, oz, -f.x, -f.y, -f.z, c);
        if (tt < dist) dist = Math.max(1.2, tt - 0.3);
      }
      this.camera.position.set(ox - f.x * dist, oy - f.y * dist + up, oz - f.z * dist);
      this.camera.rotation.y = p.yaw;
      this.camera.rotation.x = -p.pitch;
    } else {
      const bob = Math.sin(this._bobT * 9) * 0.035 * Math.min(1, sp / 6) * (p.ads ? 0.3 : 1);
      this.camera.position.set(p.x, p.y + eye + bob, p.z);
      this.camera.rotation.y = p.yaw + this.recoilY;
      this.camera.rotation.x = -p.pitch + this.recoilP;   // visual recoil kick
    }
    // screen shake (position jitter) — applied in both camera modes
    if (this.shake > 0.001) {
      const s = this.shake * 0.14;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
      this.camera.rotation.z = (Math.random() - 0.5) * this.shake * 0.03;
    } else {
      this.camera.rotation.z = 0;
    }

    // FOV: sprint widens, ADS narrows to the weapon's own zoom.
    // baseFov is the user's setting (default 75); hip/sprint/third-person
    // scale around it, ADS stays absolute (it's a zoom level).
    const w = WEAPONS[p.weapon];
    const sniper = p.weapon === 'sniper';
    const base = this.baseFov || 75;
    const targetFov = p.ads ? (w.adsFov || 55)
      : tp ? base * 0.93 : sp > GAME.moveSpeed * 1.1 ? base * 1.09 : base;
    if (Math.abs(this.camera.fov - targetFov) > 0.1) {
      this.camera.fov = lerp(this.camera.fov, targetFov, Math.min(1, dt * 12));
      this.camera.updateProjectionMatrix();
    }
    // scoped weapons (sniper) show a full-screen scope overlay once the
    // zoom is nearly complete — the viewmodel is already hidden by then
    this._scoped = !!w.scope && p.ads && Math.abs(this.camera.fov - targetFov) < 6;
    // first-person viewmodel shows the currently held item (pickaxe while
    // building/harvesting); hidden entirely in third person
    this.viewModel.setWeapon(this._heldItem());
    this.viewModel.update(dt, sp, p.reloadT > 0, p.ads, sniper, tp);
  }

  // what the local player is "holding" right now (weapon or pickaxe)
  _heldItem() {
    const tool = this.canBuild && this.input ? this.input.tool : 'gun';
    if (tool === 'pick' || tool === 'wall' || tool === 'ramp' || tool === 'floor' || tool === 'cone' || tool === 'edit') return 'pickaxe';
    return this.me ? this.me.weapon : 'pistol';
  }

  // ---------------- shared physics (players + bots) ----------------
  // fixed sub-stepping: large frames are split so collision response and
  // acceleration behave identically at 30fps and 120fps
  _physics(p, wishX, wishZ, speed, dt) {
    const steps = dt > 0.017 ? Math.min(4, Math.ceil(dt / 0.0166)) : 1;
    const h = dt / steps;
    for (let i = 0; i < steps; i++) this._physStep(p, wishX, wishZ, speed, h);
  }

  _physStep(p, wishX, wishZ, speed, dt) {
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

    // X axis (step-up for low ledges, mantle/hurdle for taller ones)
    let nx = p.x + p.vx * dt;
    let hits = overlaps(nx, p.y, p.z);
    if (hits.length) {
      const stepTop = Math.max(...hits.map((c) => c.y1));
      const rise = stepTop - p.y;
      if (p.grounded && rise <= 0.6 && !overlaps(nx, stepTop + 0.01, p.z).length) {
        p.y = stepTop + 0.01;                                   // stairs / kerbs
      } else if (this._canMantle(p, rise, wishX) && !overlaps(nx, stepTop + 0.02, p.z).length) {
        this._mantle(p, stepTop);                               // hurdle up the ledge
      } else {
        nx = p.x; p.vx = 0;
      }
    }
    p.x = nx;

    // Z axis (step-up + mantle)
    let nz = p.z + p.vz * dt;
    hits = overlaps(p.x, p.y, nz);
    if (hits.length) {
      const stepTop = Math.max(...hits.map((c) => c.y1));
      const rise = stepTop - p.y;
      if (p.grounded && rise <= 0.6 && !overlaps(p.x, stepTop + 0.01, nz).length) {
        p.y = stepTop + 0.01;
      } else if (this._canMantle(p, rise, wishZ) && !overlaps(p.x, stepTop + 0.02, nz).length) {
        this._mantle(p, stepTop);
      } else {
        nz = p.z; p.vz = 0;
      }
    }
    p.z = nz;

    // Y axis
    let ny = p.y + p.vy * dt;
    const wasAir = !p.grounded;
    const impactVy = p.vy;                 // captured before landing zeroes it
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
    if (wasAir && p.grounded) this._onLand(p, Math.max(0, -impactVy));
  }

  // landing: thud/shake scaled by impact speed + Fortnite-style fall damage
  _onLand(p, impact) {
    if (p === this.me) {
      if (impact > GAME.safeFall) SFX.thud();
      else SFX.land();
      if (impact > 10) this.addShake(Math.min(0.6, impact / 45));
    }
    if (impact <= GAME.safeFall || p.invulnT > 0 || !p.alive || p.remote) return;
    if (p.bot && p.bot.zdef) return;              // zombies lunge around freely
    const dmg = Math.min(75, Math.round((impact - GAME.safeFall) * GAME.fallDmg));
    p.hp -= dmg;
    if (p === this.me) {
      this.hudFlags.hurt = 0.5;
      this.onRumble?.(0.6, 140);
      SFX.grunt();
    }
    if (p.hp <= 0) this._killPlayer(p, p.uid, false);
  }

  // Mantle / hurdle: climb a ledge that's too tall for the step-up but within
  // reach — but only when you're actually pushing into it (so you don't
  // magically climb every wall). Fortnite-style: chest-to-head-high ledges.
  _canMantle(p, rise, wish) {
    return (p.mantleCd || 0) <= 0 && rise > 0.6 && rise <= 1.85
      && Math.abs(wish) > 0.35 && (p.grounded || p.vy > -4);
  }

  _mantle(p, stepTop) {
    p.y = stepTop + 0.02;
    p.vy = Math.max(p.vy, 2.6);      // small pop to settle onto the ledge
    p.mantleCd = 0.45;
    p.climbT = 0.45;                 // drive the 3rd-person climb pose
    if (p === this.me) { this.addShake(0.12); this.onRumble?.(0.3, 90); SFX.jump?.(); }
  }

  // Record a timestamped position sample for a remote entity. The interp
  // step below renders slightly in the past and slides between samples,
  // which turns discrete network updates (RTDB ~11Hz, WebRTC ~20Hz) into
  // smooth constant-velocity motion — the standard "snapshot interpolation".
  _pushSnap(p, x, y, z, yaw, pitch) {
    const s = p.snaps || (p.snaps = []);
    s.push({ t: performance.now(), x, y, z, yaw, pitch });
    if (s.length > 10) s.shift();
  }

  _interpRemote(p, dt) {
    const s = p.snaps;
    if (!s || !s.length) {
      // no buffer yet → fall back to simple exponential smoothing
      const k = 1 - Math.pow(0.00004, dt);
      p.x = lerp(p.x, p.netX, k); p.y = lerp(p.y, p.netY, k); p.z = lerp(p.z, p.netZ, k);
      p.yaw = lerpAngle(p.yaw, p.netYaw, k); p.pitch = lerp(p.pitch, p.netPitch, k);
      return;
    }
    const render = performance.now() - this.interpDelayMs;
    let a = null, b = null;
    for (let i = s.length - 1; i >= 0; i--) {
      if (s[i].t <= render) { a = s[i]; b = s[i + 1] || null; break; }
    }
    let tx, ty, tz, tyaw, tpitch;
    if (a && b) {
      // between two samples — plain interpolation
      const f = clamp((render - a.t) / (b.t - a.t || 1), 0, 1);
      tx = lerp(a.x, b.x, f); ty = lerp(a.y, b.y, f); tz = lerp(a.z, b.z, f);
      tyaw = lerpAngle(a.yaw, b.yaw, f); tpitch = lerp(a.pitch, b.pitch, f);
    } else if (a) {
      // ran past the newest sample — extrapolate briefly from last velocity,
      // but never across a teleport (a huge prev→a jump gives a bogus velocity)
      const prev = s[s.length - 2];
      const ahead = clamp(render - a.t, 0, 160);
      const jump2 = prev ? (a.x - prev.x) ** 2 + (a.z - prev.z) ** 2 : 0;
      if (prev && a.t > prev.t && jump2 < 64) {
        const inv = 1 / (a.t - prev.t);
        tx = a.x + (a.x - prev.x) * inv * ahead;
        ty = a.y + (a.y - prev.y) * inv * ahead;
        tz = a.z + (a.z - prev.z) * inv * ahead;
      } else { tx = a.x; ty = a.y; tz = a.z; }
      tyaw = a.yaw; tpitch = a.pitch;
    } else {
      // render time predates our oldest sample — clamp to it
      const f0 = s[0];
      tx = f0.x; ty = f0.y; tz = f0.z; tyaw = f0.yaw; tpitch = f0.pitch;
    }
    if ((p.x - tx) ** 2 + (p.z - tz) ** 2 > 64) { p.x = tx; p.y = ty; p.z = tz; }
    else {
      // light smoothing on top removes any residual micro-jitter
      const k = 1 - Math.pow(0.0001, dt);
      p.x = lerp(p.x, tx, k); p.y = lerp(p.y, ty, k); p.z = lerp(p.z, tz, k);
    }
    p.yaw = lerpAngle(p.yaw, tyaw, Math.min(1, dt * 20));
    p.pitch = lerp(p.pitch, tpitch, Math.min(1, dt * 20));
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
    if (isFinite(w.mag)) { p.ammo--; if (p.inv && p.inv[p.slot]) p.inv[p.slot].ammo = p.ammo; }
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
      this.addRecoil(p.weapon);
      const rw = WEAPONS[p.weapon] || {};
      this.onRumble?.(rw.melee ? 0.35 : Math.min(0.6, 0.15 + (rw.dmg || 20) / 200), 55);
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
    let tWall = w.range, hitBuild = null;
    for (const c of this.world.colliders) {
      const tt = rayAABB(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, c);
      if (tt < tWall) { tWall = tt; hitBuild = c.buildId || null; }
    }
    // ground plane
    if (dir.y < -1e-6) {
      const tg = -eye.y / dir.y;
      if (tg > 0 && tg < tWall) { tWall = tg; hitBuild = null; }
    }

    let hitP = null, hitT = tWall, headshot = false;
    for (const q of this.players.values()) {
      if (q === p || !q.alive || q.invulnT > 0) continue;
      if (this.teamplay && q.team === p.team) continue;
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
        if (headshot && p === this.me) this.matchStats.headshots++;
        const dmg = w.dmg * (headshot ? w.hsMult : 1) * (p.buffDmgT > 0 ? 1.4 : 1);
        this._damagePlayer(hitP, dmg, p.uid, { hs: headshot, mel: false });
      }
    } else if (hitT < w.range) {
      this.fx.impact(end, hitBuild ? 0x9a7148 : 0xd9c9a0, 4, 2);
      if (hitBuild && !visual) this.damageBuild(hitBuild, w.dmg);
    }
  }

  _melee(p, w) {
    const f = forwardOf(p.yaw);
    let best = null, bestD = w.range;
    for (const q of this.players.values()) {
      if (q === p || !q.alive || q.invulnT > 0) continue;
      if (this.teamplay && q.team === p.team) continue;
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
            if (this.teamplay && q.team === pr.team) continue;
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
    if (this.me) this.addShake(Math.max(0, 1.2 - Math.hypot(pr.x - this.me.x, pr.z - this.me.z) / 20));
    if (this._nearPoint(pr.x, pr.z, 50)) SFX.explode();
    if (pr.visual) return;
    const owner = this.players.get(pr.owner);
    for (const q of this.players.values()) {
      if (!q.alive || q.uid === pr.owner || q.invulnT > 0) continue;
      if (this.teamplay && owner && q.team === owner.team) continue;
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

  // ---------------- building (3m grid, PLAYER-RELATIVE like Fortnite) ----------------
  // pieces snap to the player's own grid cell and always connect to them:
  //   wall  → the grid edge directly in front, facing the player
  //   floor → the tile the player stands on
  //   ramp  → fills the player's cell, rising in the facing direction
  // Where the next build piece lands. 1v1.lol / Fortnite model: you build
  // where you AIM, snapped to a single global lattice at any height —
  // *not* relative to the cell you happen to stand in. That is what makes
  // it feel deterministic instead of random.
  _buildTarget(kind, p = this.me) {
    const G = BUILD.grid;                         // 3m tile
    const reach = BUILD.reach;
    const eyeY = p.y + GAME.eyeHeight;
    const f = forwardOf(p.yaw, p.pitch);          // full look ray (incl. pitch)

    // march the look ray to the first surface (world or a placed build) so
    // you can build snug against what you're looking at; else clamp to reach
    let tHit = reach;
    for (const c of this.world.colliders) {
      const tt = rayAABB(p.x, eyeY, p.z, f.x, f.y, f.z, c);
      if (tt >= 0 && tt < tHit) tHit = tt;
    }
    const t = Math.max(0.6, Math.min(reach, tHit - 0.05));
    const aimX = p.x + f.x * t, aimY = eyeY + f.y * t, aimZ = p.z + f.z * t;

    // horizontal facing decides piece orientation
    const h = forwardOf(p.yaw);
    const ax = Math.abs(h.x) > Math.abs(h.z) ? 'x' : 'z';
    const dir = ax === 'x' ? (h.x >= 0 ? 1 : -1) : (h.z >= 0 ? 1 : -1);

    // the grid cell the crosshair points at
    const ix = Math.floor(aimX / G), iz = Math.floor(aimZ / G);
    const cx = ix * G + G / 2, cz = iz * G + G / 2;

    if (kind === 'f') {
      // floor tile at the aimed cell, snapped to the nearest grid height
      const fy = Math.max(0, Math.round(aimY / G) * G);
      return { kind, ax, dir, x: cx, y: fy, z: cz };
    }
    // walls & ramps occupy a full cell → base sits on the grid level below aim
    const base = Math.max(0, Math.floor(aimY / G) * G);
    if (kind === 'w') {
      // wall on the face of the aimed cell nearest the player (blocks the way)
      if (ax === 'x') {
        const lineX = (dir > 0 ? ix : ix + 1) * G;
        return { kind, ax: 'x', dir, x: lineX, y: base, z: cz };
      }
      const lineZ = (dir > 0 ? iz : iz + 1) * G;
      return { kind, ax: 'z', dir, x: cx, y: base, z: lineZ };
    }
    // ramp fills the aimed cell, rising forward
    return { kind, ax, dir, x: cx, y: base, z: cz };
  }

  // translucent preview of where the current build piece will land
  _updateGhost() {
    const p = this.me;
    const tool = this.input ? this.input.tool : 'gun';
    // edit tool → highlight the aimed 3×3 cell of your wall instead
    if (this.canBuild && tool === 'edit' && p && p.alive && !this.over) {
      if (this._ghost) this._ghost.visible = false;
      this._updateEditGhost(p);
      return;
    }
    if (this._editGrp) this._editGrp.visible = false;
    const active = this.canBuild && p && p.alive && !this.over && (tool === 'wall' || tool === 'ramp' || tool === 'floor' || tool === 'cone');
    if (!active) { if (this._ghost) this._ghost.visible = false; return; }
    const kind = { wall: 'w', ramp: 'r', floor: 'f', cone: 'c' }[tool];
    const g = this._buildTarget(kind);
    if (!this._ghost) {
      const mat_ = new THREE.MeshBasicMaterial({ color: 0x8effa0, transparent: true, opacity: 0.32, depthWrite: false });
      this._ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat_);
      this._ghost.renderOrder = 5;
      const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: 0x2effa0 }));
      this._ghost.add(edge);
      this.scene.add(this._ghost);
    }
    const gh = this._ghost;
    gh.visible = true;
    const matId = p.buildMat || 'wood';
    const afford = p.mats >= this._buildCost(kind, matId);
    const supported = this._hasSupport(g);
    // material tint when placeable; red when short on mats OR floating in air
    gh.material.color.setHex(afford && supported ? (BUILD_MATERIALS[matId]?.ghost || 0x8effa0) : 0xff6b6b);
    const W = 3.05;
    gh.rotation.set(0, 0, 0);
    if (kind === 'f') { gh.position.set(g.x, g.y + 0.14, g.z); gh.scale.set(W, 0.28, W); }
    else if (kind === 'w') {
      if (g.ax === 'x') { gh.position.set(g.x, g.y + 1.5, g.z); gh.scale.set(0.25, 3, W); }
      else { gh.position.set(g.x, g.y + 1.5, g.z); gh.scale.set(W, 3, 0.25); }
    } else if (kind === 'c') { // cone / roof — box preview capping the cell
      gh.position.set(g.x, g.y + 0.85, g.z); gh.scale.set(W, 1.7, W);
    } else { // ramp — sloped preview matching the real steps (rises toward +dir)
      gh.position.set(g.x, g.y + 1.1, g.z);
      if (g.ax === 'x') { gh.scale.set(W, 0.3, W); gh.rotation.z = g.dir * 0.62; }
      else { gh.scale.set(W, 0.3, W); gh.rotation.x = -g.dir * 0.62; }
    }
  }

  // a piece may only be placed on the ground or touching an existing
  // structure/world surface — no floating builds (Fortnite-style anchoring)
  _hasSupport(t) {
    if (t.y <= 0.01) return true;                 // sits on the ground
    const W = 3.05, m = 0.4;                      // touch tolerance
    let x0, x1, y0, y1, z0, z1;
    if (t.kind === 'w') {
      if (t.ax === 'x') { x0 = t.x - 0.3; x1 = t.x + 0.3; z0 = t.z - W / 2; z1 = t.z + W / 2; }
      else { x0 = t.x - W / 2; x1 = t.x + W / 2; z0 = t.z - 0.3; z1 = t.z + 0.3; }
      y0 = t.y; y1 = t.y + 3;
    } else {
      x0 = t.x - W / 2; x1 = t.x + W / 2; z0 = t.z - W / 2; z1 = t.z + W / 2;
      y0 = t.y; y1 = t.y + (t.kind === 'f' ? 0.3 : t.kind === 'c' ? 1.7 : 2.4);
    }
    for (const c of this.world.colliders) {
      if (x1 + m > c.x0 && x0 - m < c.x1 && y1 + m > c.y0 && y0 - m < c.y1 && z1 + m > c.z0 && z0 - m < c.z1) return true;
    }
    return false;
  }

  _buildCost(kind, mat = 'wood') {
    if (this.isCreative) return 0;                    // creative builds are free
    const base = kind === 'w' ? BUILD.wallCost : kind === 'r' ? BUILD.rampCost
      : kind === 'c' ? BUILD.coneCost : BUILD.floorCost;
    return Math.ceil(base * (BUILD_MATERIALS[mat]?.costMul || 1));
  }

  // cycle / pick the active build material (local player)
  cycleMaterial(dir) {
    const p = this.me;
    if (!p) return;
    const i = MATERIAL_ORDER.indexOf(p.buildMat || 'wood');
    const n = MATERIAL_ORDER.length;
    p.buildMat = MATERIAL_ORDER[(((i + dir) % n) + n) % n];
    SFX.reload?.();
  }

  setMaterial(m) { if (this.me && BUILD_MATERIALS[m]) { this.me.buildMat = m; SFX.reload?.(); } }

  placeBuild(kind) {
    const p = this.me;
    if (!p?.alive || p.buildCd > 0) return;
    const material = p.buildMat || 'wood';
    const cost = this._buildCost(kind, material);
    if (p.mats < cost) { this.hudFlags.tierBanner = t('noMats'); return; }
    const tgt = this._buildTarget(kind);
    if (!this._hasSupport(tgt)) return;           // no floating builds
    const slotKey = `${kind}:${tgt.x.toFixed(1)}:${tgt.y.toFixed(1)}:${tgt.z.toFixed(1)}:${tgt.ax}`;
    for (const b of this.builds.values()) if (b.slot === slotKey) return;
    p.mats -= cost;
    p.buildCd = BUILD.placeCd;
    this.matchStats.builds++;
    const spec = { id: 'b' + randId(5), t: kind, o: p.uid, slot: slotKey, mat: material, ...tgt };
    this._addBuild(spec);
    if (this.online && this.onBuildPlace) this.onBuildPlace(spec);
    SFX.reloadDone();
  }

  // bot places a piece relative to itself (host/offline authority).
  // Bots build for free but are rate-limited so they don't spam.
  botBuild(p, kind) {
    if (!this.canBuild || !p.alive || (p.bot.buildCd || 0) > 0) return false;
    const tgt = this._buildTarget(kind, p);
    if (!this._hasSupport(tgt)) return false;     // bots obey anchoring too
    const slotKey = `${kind}:${tgt.x.toFixed(1)}:${tgt.y.toFixed(1)}:${tgt.z.toFixed(1)}:${tgt.ax}`;
    for (const b of this.builds.values()) if (b.slot === slotKey) return false;
    p.bot.buildCd = 0.6 + Math.random() * 0.5;
    const spec = { id: 'b' + randId(5), t: kind, o: p.uid, slot: slotKey, mat: 'wood', ...tgt };
    this._addBuild(spec);
    if (this.online && this.onBuildPlace) this.onBuildPlace(spec);
    if (this._nearPoint(tgt.x, tgt.z, 40)) SFX.reloadDone();
    return true;
  }

  // ---------------- game feel: shake, recoil, damage numbers ----------------
  addShake(a) { this.shake = Math.min(1.4, this.shake + a); }

  addRecoil(weapon) {
    const w = WEAPONS[weapon] || {};
    const base = w.melee ? 0 : (w.dmg >= 80 ? 0.09 : w.dmg >= 40 ? 0.05 : 0.022);
    this.recoilP += base;                        // kick up
    this.recoilY += (Math.random() - 0.5) * base * 0.8;
    this.addShake(base * 3.2);
  }

  // damage values recur constantly (weapon dmg × multipliers), so the text
  // textures are cached instead of re-rasterized on every single hit
  _dmgTex(dmg, hs) {
    if (!this._dmgTexCache) this._dmgTexCache = new Map();
    const key = dmg + (hs ? 'h' : 'n');
    let tex = this._dmgTexCache.get(key);
    if (!tex) {
      const c = document.createElement('canvas');
      c.width = 128; c.height = 64;
      const g = c.getContext('2d');
      g.font = '900 46px "Heebo", system-ui, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,0.85)';
      g.fillStyle = hs ? '#ff5252' : '#ffe08a';
      g.strokeText(dmg, 64, 34); g.fillText(dmg, 64, 34);
      tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      this._dmgTexCache.set(key, tex);
      if (this._dmgTexCache.size > 64) {   // bounded: drop the oldest entry
        const [k0, t0] = this._dmgTexCache.entries().next().value;
        t0.dispose();
        this._dmgTexCache.delete(k0);
      }
    }
    return tex;
  }

  dmgFloat(x, y, z, dmg, hs) {
    // billboarded text sprite, floats up and fades; texture shared via cache
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this._dmgTex(dmg, hs), transparent: true, depthTest: false }));
    sp.scale.set(1.1 * (hs ? 1.25 : 1), 0.55 * (hs ? 1.25 : 1), 1);
    sp.position.set(x + (Math.random() - 0.5) * 0.6, y, z + (Math.random() - 0.5) * 0.6);
    sp.renderOrder = 30;
    this.scene.add(sp);
    this.dmgFloats.push({ sp, life: 0.8, vy: 1.8 });
    if (this.dmgFloats.length > 30) { const old = this.dmgFloats.shift(); this.scene.remove(old.sp); old.sp.material.dispose(); }
  }

  _updateFeel(dt) {
    this.shake = Math.max(0, this.shake - dt * 3.5);
    for (let i = this.dmgDirs.length - 1; i >= 0; i--) {
      this.dmgDirs[i].t -= dt;
      if (this.dmgDirs[i].t <= 0) this.dmgDirs.splice(i, 1);
    }
    this.recoilP = Math.max(0, this.recoilP - dt * 0.9);
    this.recoilY *= Math.pow(0.001, dt);
    for (let i = this.dmgFloats.length - 1; i >= 0; i--) {
      const f = this.dmgFloats[i];
      f.life -= dt;
      f.sp.position.y += f.vy * dt;
      f.vy *= Math.pow(0.02, dt);
      f.sp.material.opacity = Math.min(1, f.life * 2.2);
      if (f.life <= 0) { this.scene.remove(f.sp); f.sp.material.dispose(); this.dmgFloats.splice(i, 1); }   // map is cached — keep it
    }
  }

  // ---------------- pickaxe: harvest materials + light melee ----------------
  _swingPickaxe(p) {
    if (p.pickCd > 0) return;
    p.pickCd = WEAPONS.pickaxe.rate;
    p.swingT = 0.3;   // drive the 3rd-person chop animation
    const f = forwardOf(p.yaw, p.pitch);
    const eye = { x: p.x, y: p.y + GAME.eyeHeight, z: p.z };
    const range = WEAPONS.pickaxe.range;
    // nearest hit: player, build, or world surface within range
    let tHit = range, kind = null, victim = null, buildId = null;
    for (const q of this.players.values()) {
      if (q === p || !q.alive) continue;
      if (this.teamplay && q.team === p.team) continue;
      const tt = raySphere(eye.x, eye.y, eye.z, f.x, f.y, f.z, q.x, q.y + 1.1, q.z, 0.7);
      if (tt < tHit) { tHit = tt; kind = 'player'; victim = q; }
    }
    for (const c of this.world.colliders) {
      const tt = rayAABB(eye.x, eye.y, eye.z, f.x, f.y, f.z, c);
      if (tt < tHit) { tHit = tt; kind = c.buildId ? 'build' : 'world'; buildId = c.buildId || null; }
    }
    if (f.y < -1e-6) {
      const tg = -eye.y / f.y;
      if (tg > 0 && tg < tHit) { tHit = tg; kind = 'world'; }
    }
    const hit = V1.set(eye.x + f.x * tHit, eye.y + f.y * tHit, eye.z + f.z * tHit);
    if (kind === 'player') {
      this._damagePlayer(victim, WEAPONS.pickaxe.dmg, p.uid, { mel: true });
      this.fx.impact(hit, 0xffd166, 8, 4);
    } else if (kind === 'build') {
      // creative: your own pieces break in one swing (fast canvas cleanup)
      const bld = this.builds.get(buildId);
      const instant = this.isCreative && bld && bld.owner === p.uid;
      this.damageBuild(buildId, instant ? 1e6 : 25);   // damageBuild broadcasts the destroy
      this.fx.impact(hit, 0x9a7148, 8, 4);
    } else if (kind === 'world') {
      // harvest: every hit yields materials (arcade-simple, infinite)
      p.mats = Math.min(this.matsMax(), p.mats + BUILD.harvestPerHit);
      this.fx.impact(hit, 0x7dd3fc, 8, 4);
    }
    SFX.hit();
  }

  // ---------------- edit: toggle the aimed 3×3 cell of your own wall ----------------
  // Ray-tests the wall's FULL plane (not just the remaining panels) so you can
  // punch a hole and fill it back in. Returns {b,row,col} or null.
  _editHit(p) {
    const f = forwardOf(p.yaw, p.pitch);
    const ex = p.x, ey = p.y + GAME.eyeHeight, ez = p.z;
    const W = 3.05, H3 = 3, T = 0.25;
    let tBest = BUILD.reach, best = null;
    for (const b of this.builds.values()) {
      if (b.owner !== p.uid || b.t !== 'w') continue;
      const box = b.ax === 'x'
        ? { x0: b.x - T, y0: b.y, z0: b.z - W / 2, x1: b.x + T, y1: b.y + H3, z1: b.z + W / 2 }
        : { x0: b.x - W / 2, y0: b.y, z0: b.z - T, x1: b.x + W / 2, y1: b.y + H3, z1: b.z + T };
      const tt = rayAABB(ex, ey, ez, f.x, f.y, f.z, box);
      if (tt >= 0 && tt < tBest) { tBest = tt; best = { b, t: tt }; }
    }
    if (!best) return null;
    const b = best.b, cw = W / 3, ch = H3 / 3;
    const hy = ey + f.y * best.t;
    const along = b.ax === 'x' ? (ez + f.z * best.t - b.z) : (ex + f.x * best.t - b.x);
    const row = clamp(Math.floor((hy - b.y) / ch), 0, 2);
    const col = clamp(Math.round(along / cw) + 1, 0, 2);
    return { b, row, col };
  }

  // full 3×3 grid overlay on the aimed wall (1v1.lol-style): every cell shows
  // its pending state, the aimed cell is picked out, so you can see the edit
  // before you confirm it.
  _updateEditGhost(p) {
    const hit = this._editHit(p);
    if (!this._editGrp) {
      this._editGrp = new THREE.Group();
      this._editCells = [];
      const cube = new THREE.BoxGeometry(1, 1, 1);
      const edge = new THREE.EdgesGeometry(cube);
      for (let i = 0; i < 9; i++) {
        const cell = new THREE.Mesh(cube, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.3, depthTest: false, depthWrite: false }));
        cell.renderOrder = 6;
        cell.add(new THREE.LineSegments(edge, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 })));
        this._editCells.push(cell);
        this._editGrp.add(cell);
      }
      this.scene.add(this._editGrp);
    }
    if (!hit) { this._editGrp.visible = false; return; }
    this._editGrp.visible = true;
    const { b, row: ar, col: ac } = hit;
    const W = 3.05, H3 = 3, T = 0.25, cw = W / 3, ch = H3 / 3;
    const sess = this._editSess && this._editSess.id === b.id ? this._editSess : null;
    const mask = sess ? sess.mask : editMask(b.edit);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
      const idx = r * 3 + c, cell = this._editCells[idx];
      const open = !!(mask & (1 << idx));            // will be a hole after apply
      const aimed = r === ar && c === ac;
      cell.material.color.setHex(aimed ? 0xffd200 : open ? 0x37e0ff : 0x9effb0);
      cell.material.opacity = aimed ? 0.5 : open ? 0.34 : 0.13;
      const cy = b.y + r * ch + ch / 2, off = (c - 1) * cw;
      if (b.ax === 'x') { cell.position.set(b.x, cy, b.z + off); cell.scale.set(T + 0.12, ch * 0.9, cw * 0.9); }
      else { cell.position.set(b.x + off, cy, b.z); cell.scale.set(cw * 0.9, ch * 0.9, T + 0.12); }
    }
  }

  // drag-select edit: press+drag paints cells into a pending mask, release
  // confirms it in one rebuild and swaps back to the last build piece so you
  // can immediately re-place (exactly the 1v1.lol / Fortnite edit-then-build loop).
  _editStep(p, input) {
    if (input.firing) {
      const hit = this._editHit(p);
      if (!hit) return;
      const cell = hit.row * 3 + hit.col;
      const sess = this._editSess;
      if (!sess || sess.id !== hit.b.id) {
        // begin a session on this wall — toggle the first cell, set paint value
        const toggled = editMask(hit.b.edit) ^ (1 << cell);
        this._editSess = { id: hit.b.id, mask: toggled, paint: (toggled >> cell) & 1, last: cell };
        SFX.hit();
      } else if (cell !== sess.last) {
        // drag into a new cell — paint it to match the first cell's new state
        if (sess.paint) sess.mask |= (1 << cell); else sess.mask &= ~(1 << cell);
        sess.last = cell;
        SFX.hit();
      }
    } else if (this._editSess) {
      // released — confirm and return to building
      const sess = this._editSess;
      this._editSess = null;
      this._applyEdit(sess.id, sess.mask);
      if (this.input) this.input.setTool(this.input.lastPiece || 'wall');
    }
  }

  // Fortnite "simple edit" presets applied to the aimed wall in one press:
  // 0 door (bottom+mid centre) · 1 window (centre) · 2 half wall · 3 full reset
  applyEditPreset(i) {
    const p = this.me;
    if (!p?.alive || !this.canBuild) return;
    const hit = this._editHit(p);
    if (!hit) return;
    const masks = [(1 << 1) | (1 << 4), 1 << 4, 0b111111000, 0];
    this._editSess = null;                        // cancel any pending drag
    this._applyEdit(hit.b.id, masks[i] ?? 0);
  }

  _applyEdit(id, mask) {
    const b = this.builds.get(id);
    if (!b || editMask(b.edit) === mask) return;      // no change → nothing to do
    b.edit = mask;
    const spec = { id: b.id, t: 'w', o: b.owner, slot: b.slot, mat: b.mat, x: b.x, y: b.y, z: b.z, ax: b.ax, dir: b.dir, edit: mask };
    const keepHp = b.hp;
    this.removeBuild(b.id, false);
    this._addBuild(spec);
    const nb = this.builds.get(b.id); if (nb) nb.hp = Math.min(keepHp, nb.maxHp);   // editing doesn't heal
    if (this.online && this.onBuildPlace) this.onBuildPlace(spec);
    SFX.reloadDone();
  }

  _addBuild(spec) {
    if (this.builds.has(spec.id)) return;
    const meshes = [];
    const material = BUILD_MATERIALS[spec.mat] || BUILD_MATERIALS.wood;
    const woodM = mat(material.color);
    const darkM = mat(material.trim);
    const addPiece = (x, y, z, w, h, d, { collide = true, m: useM = woodM, rz = 0 } = {}) => {
      const m = new THREE.Mesh(BOXGEO, useM);
      m.position.set(x, y + h / 2, z);
      m.scale.set(w, h, d);
      if (rz) m.rotation.z = rz;
      m.castShadow = true;
      m.receiveShadow = true;
      this.scene.add(m);
      meshes.push(m);
      if (collide) {
        this.world.colliders.push({ x0: x - w / 2, y0: y, z0: z - d / 2, x1: x + w / 2, y1: y + h, z1: z + d / 2, buildId: spec.id });
      }
    };
    const W = 3.05, H3 = 3, T = 0.25;
    if (spec.t === 'w') {
      // 3×3 editable grid (1v1.lol): bit row*3+col set → that cell is an
      // opening. Build a panel for every cell that isn't removed.
      const mask = editMask(spec.edit);
      const cw = W / 3, ch = H3 / 3;
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
          if (mask & (1 << (row * 3 + col))) continue;   // removed cell
          const py = spec.y + row * ch;
          const off = (col - 1) * cw;
          if (spec.ax === 'x') addPiece(spec.x, py, spec.z + off, T, ch, cw);
          else addPiece(spec.x + off, py, spec.z, cw, ch, T);
        }
      }
      // decorative top/bottom trim (non-colliding)
      if (spec.ax === 'x') {
        addPiece(spec.x, spec.y + H3 - 0.18, spec.z, T + 0.1, 0.18, W, { collide: false, m: darkM });
        addPiece(spec.x, spec.y, spec.z, T + 0.1, 0.18, W, { collide: false, m: darkM });
      } else {
        addPiece(spec.x, spec.y + H3 - 0.18, spec.z, W, 0.18, T + 0.1, { collide: false, m: darkM });
        addPiece(spec.x, spec.y, spec.z, W, 0.18, T + 0.1, { collide: false, m: darkM });
      }
    } else if (spec.t === 'f') {
      // floor tile: full 3×3 slab
      addPiece(spec.x, spec.y, spec.z, W, 0.28, W);
      addPiece(spec.x, spec.y, spec.z, W, 0.1, W, { collide: false, m: darkM });
    } else if (spec.t === 'c') {
      // cone / roof: a 4-sided pyramid capping the cell
      const H = 1.7;
      const cone = new THREE.Mesh(CONEGEO, woodM);
      cone.rotation.y = Math.PI / 4;
      cone.position.set(spec.x, spec.y + H / 2, spec.z);
      cone.castShadow = true; cone.receiveShadow = true;
      this.scene.add(cone);
      meshes.push(cone);
      // solid collider bounding the pyramid so you can stand on / shelter under it
      this.world.colliders.push({
        x0: spec.x - W / 2, y0: spec.y, z0: spec.z - W / 2,
        x1: spec.x + W / 2, y1: spec.y + H, z1: spec.z + W / 2, buildId: spec.id,
      });
    } else {
      // ramp: 4 rising steps spanning the cell
      for (let i = 0; i < 4; i++) {
        const off = (i - 1.5) * 0.76;
        const h = 0.6 * (i + 1);
        if (spec.ax === 'x') addPiece(spec.x + spec.dir * off, spec.y, spec.z, 0.78, h, W);
        else addPiece(spec.x, spec.y, spec.z + spec.dir * off, W, h, 0.78);
      }
    }
    this.builds.set(spec.id, {
      id: spec.id, t: spec.t, meshes, hp: material.hp, maxHp: material.hp, mat: spec.mat || 'wood',
      owner: spec.o, slot: spec.slot || '',
      x: spec.x, y: spec.y, z: spec.z, ax: spec.ax, dir: spec.dir, edit: editMask(spec.edit),
    });
  }

  applyRemoteBuild(spec) { this._addBuild(spec); }

  // ---------------- creative: save / load the whole build canvas ----------------
  exportBuilds() {
    const out = [];
    for (const b of this.builds.values()) {
      out.push({ t: b.t, x: +b.x.toFixed(2), y: +b.y.toFixed(2), z: +b.z.toFixed(2), ax: b.ax, dir: b.dir, mat: b.mat, edit: editMask(b.edit) });
    }
    return out;
  }

  importBuilds(list) {
    let n = 0;
    for (const s of list || []) {
      if (this.builds.size >= CREATIVE.maxPieces) break;
      const slotKey = `${s.t}:${(+s.x).toFixed(1)}:${(+s.y).toFixed(1)}:${(+s.z).toFixed(1)}:${s.ax}`;
      let dup = false;
      for (const b of this.builds.values()) if (b.slot === slotKey) { dup = true; break; }
      if (dup) continue;
      const spec = { id: 'b' + randId(5), o: this.me?.uid || 'map', slot: slotKey, ...s };
      this._addBuild(spec);
      if (this.online && this.onBuildPlace) this.onBuildPlace(spec);
      n++;
    }
    return n;
  }

  clearBuilds() {
    for (const id of [...this.builds.keys()]) {
      this.removeBuild(id, false);
      if (this.online && this.onBuildDestroy) this.onBuildDestroy(id);
    }
  }

  removeBuild(id, withFx = true) {
    const b = this.builds.get(id);
    if (!b) return;
    if (withFx && b.meshes[0]) {
      const m = b.meshes[0];
      this.fx.impact(V1.copy(m.position), 0x9a7148, 14, 5);
      if (this._nearPoint(m.position.x, m.position.z, 45)) SFX.explode();
    }
    for (const m of b.meshes) this.scene.remove(m);
    this.world.colliders = this.world.colliders.filter((c) => c.buildId !== id);
    this.builds.delete(id);
  }

  damageBuild(id, dmg) {
    const b = this.builds.get(id);
    if (!b) return;
    b.hp -= dmg;
    if (b.hp <= 0) {
      this.removeBuild(id, true);
      if (this.online && this.onBuildDestroy) this.onBuildDestroy(id);
    }
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
    if (this.me) this.addShake(Math.max(0, 1.4 - Math.hypot(g.x - this.me.x, g.z - this.me.z) / 18));
    if (this._nearPoint(g.x, g.z, 60)) SFX.explode();
    if (g.visual) return;
    const dmgMul = this.players.get(g.owner)?.buffDmgT > 0 ? 1.4 : 1;
    for (const q of this.players.values()) {
      if (!q.alive || q.invulnT > 0) continue;
      const owner = this.players.get(g.owner);
      // friendly fire off only in team modes; FFA grenades hit everyone
      if (this.teamplay && owner && q.team === owner.team && q !== owner) continue;
      const d = Math.hypot(q.x - g.x, q.y + 0.9 - g.y, q.z - g.z);
      if (d < GRENADE.radius) {
        const dmg = GRENADE.dmg * dmgMul * (1 - (d / GRENADE.radius) * 0.75);
        this._damagePlayer(q, dmg, g.owner, { nade: true });
      }
    }
    // grenades wreck builds
    for (const [id, b] of this.builds) {
      const m = b.meshes[0];
      if (!m) continue;
      if (Math.hypot(m.position.x - g.x, m.position.z - g.z) < GRENADE.radius + 1.5) {
        this.damageBuild(id, GRENADE.dmg);
      }
    }
  }

  // ---------------- pickups ----------------
  _updatePickups(dt) {
    const authoritative = !this.online || this.isHost;
    if (authoritative && !this.over && !this.isCreative) {   // creative: clean canvas
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
    } else if (pk.k === 'mats') {
      color = 0xc98d4e;
      const b1 = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.18, 0.28), new THREE.MeshBasicMaterial({ color: 0x9a7148 }));
      const b2 = b1.clone(); b2.position.y = 0.2; b2.rotation.y = 0.5;
      group.add(b1, b2);
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
    } else if (pk.k === 'mats') {
      q.mats = Math.min(this.matsMax(), q.mats + PICKUPS.kinds.mats.amount);
      this.feed.push({ text: `+${PICKUPS.kinds.mats.amount} 🧱`, t: 2.5 });
    } else if (pk.k === 'weapon' && this.isLoadout) {
      if (q.inv) {
        this._invPickup(q, pk.w);               // slot it into the hotbar
      } else {
        q.weapon = pk.w; q.ammo = WEAPONS[pk.w].mag; q.reloadT = 0;
      }
      if (q === this.me) {
        this.viewModel.setWeapon(this._heldItem());
        this.hudFlags.tierBanner = t('gotWeapon', { w: t('weapon_' + pk.w) });
      }
    }
    if (q === this.me) SFX.pickup();
  }

  // ---------------- killstreaks & emotes ----------------
  matsMax() { return this.mode === 'builddm' ? BUILDDM.matsMax : this.mode === 'boxfight' ? BOXFIGHT.matsMax : BUILD.matsMax; }

  _matsPerKill() { return this.mode === 'builddm' ? BUILDDM.matsPerKill : this.mode === 'boxfight' ? BOXFIGHT.matsPerKill : BUILD.matsPerKill; }

  _myKillFx() {
    const me = this.me;
    me.streak++;
    me.mats = Math.min(this.matsMax(), me.mats + this._matsPerKill());
    for (const ks of KILLSTREAKS) {
      if (me.streak !== ks.at) continue;
      if (ks.k === 'speed') { me.buffSpeedT = ks.dur; this.hudFlags.tierBanner = t('streak3'); }
      if (ks.k === 'armor') { me.armor = Math.min(ARMOR_MAX, me.armor + ks.amount); this.hudFlags.tierBanner = t('streak5'); }
      if (ks.k === 'dmg') { me.buffDmgT = ks.dur; this.hudFlags.tierBanner = t('streak7'); }
      SFX.tierUp();
    }
  }

  doEmote(idx = 0) {
    if (!this.me?.alive) return;
    this.me.danceT = 3.4;
    this.me.danceType = idx;
    if (this.onEmote) this.onEmote(idx);
    this.feed.push({ text: t('emoted', { name: this.me.name }), t: 3 });
    SFX.pickup();
  }

  applyEmote(uid, idx = 0) {
    const p = this.players.get(uid);
    if (!p) return;
    p.danceT = 3.4;
    p.danceType = idx;
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
  _damagePlayer(q, dmg, fromUid, { hs = false, mel = false, nade = false } = {}) {
    if (!q.alive || q.invulnT > 0) return;
    // guests don't own bots — relay damage to the host
    if (q.bot && this.online && !this.isHost) {
      if (this.onBotDamage) this.onBotDamage(q.uid, Math.round(dmg));
      this.hudFlags.hitmarker = 0.25;
      if (hs) { this.hudFlags.headshot = 0.5; SFX.headshot(); } else SFX.hit();
      return;
    }
    if (q.remote) {
      if (this.onHitRemote) this.onHitRemote(q.uid, Math.round(dmg), { hs, mel, nade, from: fromUid });
      this.hudFlags.hitmarker = 0.25;
      if (fromUid === this.me?.uid) this.dmgFloat(q.x, q.y + 1.4, q.z, Math.round(dmg), hs);
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
    if (q.bot) { q.bot.underFire = this.elapsed; q.bot.lastAttacker = fromUid; }
    if (q === this.me) {
      this.hudFlags.hurt = 0.5;
      this.onRumble?.(0.7, 160);   // controller kick when you take a hit
      this.addShake(0.5);          // getting hit shakes the screen
      // remember where the hit came from → HUD direction arc
      const atk = this.players.get(fromUid);
      if (atk && atk !== this.me) {
        this.dmgDirs.push({ x: atk.x, z: atk.z, t: 1.1 });
        if (this.dmgDirs.length > 6) this.dmgDirs.shift();
      }
      SFX.hurt();
    } else {
      const from = this.players.get(fromUid);
      if (from === this.me) {
        this.hudFlags.hitmarker = 0.25;
        // floating damage number at the hit point
        this.dmgFloat(q.x, q.y + 1.4, q.z, Math.round(dmg), hs);
        if (hs) { this.hudFlags.headshot = 0.5; SFX.headshot(); } else SFX.hit();
      }
    }
    if (q.hp <= 0) this._killPlayer(q, fromUid, mel, nade);
  }

  applyHitOnMe(dmg, fromUid, hs, mel, nade) {
    if (this.me) this._damagePlayer(this.me, dmg, fromUid, { hs, mel, nade });
  }

  // host applies guests' damage to bots
  applyBotDamageEvent(botId, dmg, fromUid) {
    const b = this.players.get(botId);
    if (b && b.bot && b.alive) this._damagePlayer(b, dmg, fromUid, {});
  }

  _killPlayer(q, fromUid, mel, nade = false) {
    q.hp = 0;
    q.armor = 0;
    q.alive = false;
    q.deaths++;
    if (q === this.me) {
      q.streak = 0;
      // kill-cam: watch whoever got you while waiting to respawn
      this._killerCam = fromUid !== q.uid ? fromUid : null;
      const killer0 = this.players.get(fromUid);
      if (killer0 && killer0 !== q) this.hudFlags.tierBanner = t('killedByCam', { name: killer0.name });
    }
    q.respawnT = GAME.respawnTime;
    this.fx.impact(V1.set(q.x, q.y + 1, q.z), 0xff8866, 18, 6);
    if (q === this.me || this._near(q, 45)) SFX.die();

    const killer = this.players.get(fromUid);
    const killerName = killer ? killer.name : '?';

    // battle royale: my elimination is final — queue my personal results
    if (this.brLike && q === this.me && !this.over) {
      this._brMyPlace = this.brAliveCount() + 1;
      this._brEndT = 2.2;
      this.hudFlags.winBanner = t('brDead', { n: this._brMyPlace });
    }

    if (!this.online) {
      this.feed.push({ text: killer === q ? t('fellDown', { name: q.name }) : t(mel ? 'killKnife' : 'kill', { a: killerName, b: q.name }), t: 5 });
      if (killer && killer !== q) {
        this._creditLocal(killer, q, mel);
        if (killer === this.me && nade) this.matchStats.nadeKills++;
      }
      if (mel && !q.bot) this._demote(q);
      this._tallyTeams(killer, q);
    } else if (q === this.me) {
      if (this.onSelfDeath) this.onSelfDeath(fromUid, mel, nade);
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
      if (this.isTactical) killer.cash = Math.min(TAC_ECON.max, killer.cash + TAC_ECON.kill);
      if (!this.isLoadout) this._advanceTier(killer);
    }
  }

  // called by net when a kill event says I'm the killer
  creditKill(victimName, mel, victimIsBot, nade = false) {
    if (!this.me) return;
    this.me.kills++;
    this.me.score += 100;
    if (this.isTactical) this.me.cash = Math.min(TAC_ECON.max, this.me.cash + TAC_ECON.kill);
    if (nade) this.matchStats.nadeKills++;
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
    if ((this.mode === 'gungame' || this.mode === 'duel') && p.tier >= WEAPON_LADDER.length) {
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

  // ---------------- inventory (Fortnite-style hotbar, local player) ----------------
  _giveInventory(p, kit) {
    const items = kit || (this.isTactical ? TAC_KIT : LOADOUT_KIT);
    p.inv = items.map((w) => ({ w, ammo: isFinite(WEAPONS[w]?.mag) ? WEAPONS[w].mag : Infinity }));
    this._equipSlot(p, Math.min(1, p.inv.length - 1));   // start on the first weapon
  }

  _equipSlot(p, i) {
    if (!p.inv || !p.inv.length) return;
    i = ((i % p.inv.length) + p.inv.length) % p.inv.length;
    p.slot = i;
    const it = p.inv[i];
    p.weapon = it.w;
    p.ammo = it.ammo;
    p.reloadT = 0;
    if (p === this.me) this.viewModel.setWeapon(this._heldItem());
    else if (p.view) setCharacterWeapon(p.view.char, p.weapon);
  }

  // local player hotbar controls (bound to LB/RB and the touch slots)
  cycleSlot(dir) {
    const p = this.me;
    if (!p || !p.inv || !p.alive) return;
    this._equipSlot(p, p.slot + dir);
    SFX.reload?.();
  }

  selectSlot(i) {
    const p = this.me;
    if (p && p.inv && p.alive) this._equipSlot(p, i);
  }

  // drop a picked-up weapon into the inventory (replace current weapon slot,
  // or the first weapon slot if the pickaxe is out) and equip it
  _invPickup(p, w) {
    if (!p.inv) return false;
    let i = p.slot > 0 ? p.slot : p.inv.findIndex((s, k) => k > 0);
    if (i <= 0) i = Math.min(1, p.inv.length - 1);
    p.inv[i] = { w, ammo: isFinite(WEAPONS[w]?.mag) ? WEAPONS[w].mag : Infinity };
    this._equipSlot(p, i);
    return true;
  }

  // ---------------- tactical economy (buy phase) ----------------
  tacCanBuy() {
    return this.isTactical && !!this.tac && this.tac.phase === 'prep' && !!this.me?.alive;
  }

  // buy 'smg'|'shotgun'|'rifle'|'lmg'|'sniper'|'armor'|'nade' during prep
  tacBuy(item) {
    const p = this.me;
    if (!this.tacCanBuy() || !p) return false;
    const price = TAC_PRICES[item];
    if (price == null || p.cash < price) return false;
    if (item === 'armor') {
      if (p.armor >= ARMOR_MAX) return false;
      p.armor = Math.min(ARMOR_MAX, p.armor + 50);
    } else if (item === 'nade') {
      if (p.nades >= GRENADE.max) return false;
      p.nades++;
    } else {
      if (!p.inv || p.inv.some((s) => s.w === item)) return false;   // already own it
      const it = { w: item, ammo: WEAPONS[item].mag };
      if (p.inv.length < 4) { p.inv.push(it); this._equipSlot(p, p.inv.length - 1); }
      else { const i = p.slot > 0 ? p.slot : 1; p.inv[i] = it; this._equipSlot(p, i); }
    }
    p.cash -= price;
    SFX.reloadDone();
    return true;
  }

  _tacPay(won) {
    if (!this.me) return;
    this.me.cash = Math.min(TAC_ECON.max, this.me.cash + (won ? TAC_ECON.win : TAC_ECON.lose));
  }

  _respawn(p) {
    if (p === this.me) this._editSess = null;    // drop any pending edit
    const s = this._spawnPos(p);
    this._place(p, s);
    p.hp = p.maxHp;
    p.armor = 0;
    p.nades = GRENADE.start;
    p.alive = true;
    p.invulnT = GAME.invulnTime;
    if (p.inv) this._giveInventory(p);            // restock the hotbar
    p.ammo = WEAPONS[p.weapon].mag;
    p.reloadT = 0;
  }

  // ---------------- bots (host / offline) ----------------
  _botStep(p, dt) {
    p.bot.buildCd = Math.max(0, (p.bot.buildCd || 0) - dt);
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
    if (p.alive && p.bot.wantBuild) { this.botBuild(p, p.bot.wantBuild); p.bot.wantBuild = null; }
  }

  // ---------------- bot net sync ----------------
  getBotSnapshot() {
    const out = {};
    for (const p of this.players.values()) {
      if (!p.bot) continue;
      out[p.uid] = {
        n: p.name, x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2),
        yaw: +p.yaw.toFixed(2), hp: Math.round(p.hp), m: p.maxHp, a: p.alive ? 1 : 0,
        s: typeof p.skin === 'string' ? p.skin : null, zk: p.bot.zombie || null,
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
        const skin = s.zk ? Game.zombiePalette(s.zk) : (s.s || 'ember');
        p = this._base(uid, s.n, skin, 'b');
        p.bot = { zombie: s.zk || null, zdef: s.zk ? ZOMBIES[s.zk] : null, level: BOT_LEVELS[this.botLevel], brain: null };
        p.weapon = s.zk ? 'zmelee' : 'botgun';
        if (s.zk) p.zscale = ZOMBIES[s.zk].scale;
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
      if (p.alive) this._pushSnap(p, s.x, s.y, s.z, s.yaw, 0);
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
      // own body only renders in third person; hide its name/hp sprites always
      const isSelf = p === this.me;
      char.group.visible = p.alive && (!isSelf || (this.thirdPerson && !p.ads));
      if (isSelf && bar) { bar.bg.visible = false; bar.fg.visible = false; }
      if (isSelf && char.nameSprite) char.nameSprite.visible = false;
      if (!p.alive || !char.group.visible) continue;
      // keep the held weapon in the character's hand up to date (pickaxe while building)
      setCharacterWeapon(char, isSelf ? this._heldItem() : p.weapon, isSelf ? this.myPickaxe : null);
      // crouch/slide squash follows the synced stance
      p.crouchK = lerp(p.crouchK, p.stance === 2 ? 1.15 : p.stance === 1 ? 1 : 0, 0.2);
      const zs = p.zscale || 1;
      char.group.scale.set(zs, zs * (1 - Math.min(1, p.crouchK) * 0.3), zs);
      char.group.position.set(p.x, p.y, p.z);
      char.group.rotation.y = p.yaw + Math.PI;
      const sp = p.remote || (p.bot && this.online && !this.isHost)
        ? Math.hypot(p.netX - p.x, p.netZ - p.z) * 12
        : Math.hypot(p.vx, p.vz);
      p.speedSm = lerp(p.speedSm, sp, 0.2);
      animateCharacter(char, dt, p.speedSm, true, p.danceT > 0 ? (p.danceType || 0) : -1);
      // pickaxe / melee swing: raise-and-chop the weapon arm + the held tool
      if (p.swingT > 0 && p.danceT <= 0) {
        p.swingT = Math.max(0, p.swingT - dt);
        const chop = Math.sin((1 - p.swingT / 0.3) * Math.PI);   // 0→1→0
        char.shR.rotation.x = -2.5 + chop * 2.7;
        char.shR.rotation.z = -0.15;
        char.gunAnchor.rotation.set(-1.35 + chop * 2.0, 0, 0);
      } else {
        char.gunAnchor.rotation.set(0, 0, 0);
      }
      // climbing / mantle: arms reach up, legs tuck as you pull over the ledge
      if (p.climbT > 0 && p.danceT <= 0) {
        p.climbT = Math.max(0, p.climbT - dt);
        const k = p.climbT / 0.45;                                // 1→0
        char.shL.rotation.x = -2.7; char.shR.rotation.x = -2.7;
        char.hipL.rotation.x = 0.6 + k * 0.5; char.hipR.rotation.x = 0.4 + k * 0.3;
      }
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
    const authoritative = !this.online || this.isHost;
    if (this.mode === 'team' && authoritative) {
      if (this.teamScore >= this.targetKills || this.botScore >= this.targetKills
        || (this.endAt && this.timeFn() >= this.endAt)) {
        this.forceGameOver({ teamWin: this.teamScore >= this.botScore });
      }
    }
    if (this.mode === 'zombies' && authoritative && this.wave > 0) {
      const humans = [...this.players.values()].filter((q) => !q.bot);
      if (humans.length && humans.every((q) => !q.alive)) {
        this.forceGameOver({ teamWin: false });
      }
    }
    // build deathmatch / boxfight: pure timer — every client ends at the same clock
    if ((this.mode === 'builddm' || this.isBox) && this.endAt && this.timeFn() >= this.endAt) {
      this.forceGameOver();
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
      wave: this.wave,
      teamScore: this.teamScore,
      botScore: this.botScore,
      ctfScoreR: this.ctf?.score.r, ctfScoreB: this.ctf?.score.b,
      brOf: this.brLike ? Math.max(this.zoneCfg.combatants, this.players.size) : undefined,
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
      tier: p.tier, w: p.weapon, st: p.stance, tm: p.team,
      kills: p.kills, deaths: p.deaths, score: p.score,
    };
  }

  // Compact position/aim packet for the WebRTC fast lane (sent ~20Hz).
  // Only the fast-changing fields; identity/loadout/score still travel on
  // the slower RTDB full-state so this stays tiny.
  getNetPacket() {
    const p = this.me;
    return {
      t: 's',
      x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2),
      yaw: +p.yaw.toFixed(2), pitch: +p.pitch.toFixed(2),
      hp: Math.round(p.hp), st: p.stance, a: p.alive ? 1 : 0,
    };
  }

  // Apply a fast-lane packet from a peer. Position/aim only — alive/death
  // transitions are left to the authoritative RTDB full-state so their
  // fx/sfx/feed fire exactly once.
  applyNetState(uid, s) {
    const p = this.players.get(uid);
    if (!p || !p.remote || !p.alive || s.a === 0) return;
    p.netX = s.x; p.netY = s.y; p.netZ = s.z;
    p.netYaw = s.yaw; p.netPitch = s.pitch;
    if (typeof s.hp === 'number') p.hp = s.hp;
    if (typeof s.st === 'number') p.stance = s.st;
    this._pushSnap(p, s.x, s.y, s.z, s.yaw, s.pitch);
  }

  dispose() {
    this.fx.dispose();
    this.scene.traverse((o) => {
      if (o.isMesh) o.geometry?.dispose?.();
    });
    if (this._dmgTexCache) { for (const t of this._dmgTexCache.values()) t.dispose(); this._dmgTexCache.clear(); }
  }
}
