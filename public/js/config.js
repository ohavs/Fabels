// ============================================================
// שברי כוכב: זירת האש · STARSHARDS ARENA — configuration
// All gameplay balance is data-driven from this file.
// ============================================================

// ---- Firebase (project: fabels-70545) --------------------------------
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBQ6yYkRK02388cOZehXivoq_0T4aM_Gz4',
  authDomain: 'fabels-70545.firebaseapp.com',
  databaseURL: 'https://fabels-70545-default-rtdb.firebaseio.com',
  projectId: 'fabels-70545',
  storageBucket: 'fabels-70545.firebasestorage.app',
  messagingSenderId: '485284615942',
  appId: '1:485284615942:web:ec22a2407c430e272d3087',
};

export const firebaseConfigured = () =>
  !/^YOUR_/.test(FIREBASE_CONFIG.apiKey) && !/^YOUR_/.test(FIREBASE_CONFIG.projectId);

// ---- Core constants ----------------------------------------------------
export const GAME = {
  syncMs: 90,               // player state broadcast (~11Hz)
  botSyncMs: 110,           // host → guests bot snapshot
  respawnTime: 4,
  invulnTime: 2.5,
  maxPlayers: 6,
  matchTimeTeam: 300,       // team-vs-bots: 5 minutes
  teamTargetKills: 40,      // or first team to 40
  lobbyCountdown: 4,
  roomTTL: 2 * 60 * 60 * 1000,
  // movement (metres, seconds)
  moveSpeed: 6.2,
  sprintMult: 1.45,
  crouchMult: 0.5,
  adsMoveMult: 0.6,
  slideSpeed: 10.5,
  slideTime: 0.75,
  slideCd: 1.4,
  accel: 60,
  friction: 10,
  gravity: -24,
  jumpVel: 8.5,
  eyeHeight: 1.6,
  playerRadius: 0.42,
  playerHeight: 1.8,
  headY: 1.38,              // hits above this local height = headshot
  fallY: -25,               // below this = death
};

// ---- Gun-Game weapon ladder (index = tier) ------------------------------
// hitscan unless projectile; melee = short-range swing
export const WEAPON_LADDER = ['pistol', 'smg', 'shotgun', 'rifle', 'lmg', 'sniper', 'plasma', 'knife'];

export const WEAPONS = {
  pistol:  { dmg: 26, rate: 0.34, mag: 12, reload: 1.1, spread: 0.012, auto: false, pellets: 1, range: 60, hsMult: 2.0, color: 0x9db4c8 },
  smg:     { dmg: 14, rate: 0.09, mag: 30, reload: 1.5, spread: 0.035, auto: true,  pellets: 1, range: 45, hsMult: 1.6, color: 0xf4a259 },
  shotgun: { dmg: 9,  rate: 0.85, mag: 6,  reload: 1.9, spread: 0.075, auto: false, pellets: 8, range: 26, hsMult: 1.4, color: 0xc25b4e },
  rifle:   { dmg: 22, rate: 0.125, mag: 25, reload: 1.7, spread: 0.02, auto: true,  pellets: 1, range: 75, hsMult: 1.8, color: 0x5fa8d3 },
  lmg:     { dmg: 16, rate: 0.08, mag: 60, reload: 2.6, spread: 0.05, auto: true,  pellets: 1, range: 60, hsMult: 1.5, color: 0x7a8b5c },
  sniper:  { dmg: 95, rate: 1.5,  mag: 5,  reload: 2.2, spread: 0.002, auto: false, pellets: 1, range: 150, hsMult: 2.0, color: 0x8d6cab },
  plasma:  { dmg: 46, rate: 0.7,  mag: 8,  reload: 1.8, spread: 0.008, auto: false, pellets: 1, range: 100, hsMult: 1.0, color: 0x39e6c8, projectile: { speed: 38, radius: 0.22, splash: 3.2 } },
  knife:   { dmg: 100, rate: 0.5, mag: Infinity, reload: 0, spread: 0, auto: false, pellets: 1, range: 2.4, hsMult: 1.0, color: 0xffd166, melee: true },
  // bots' fixed weapon
  botgun:  { dmg: 11, rate: 0.42, mag: Infinity, reload: 0, spread: 0.05, auto: true, pellets: 1, range: 55, hsMult: 1.0, color: 0xff5964 },
  // zombie attacks
  spit:    { dmg: 12, rate: 1.8, mag: Infinity, reload: 0, spread: 0.02, auto: false, pellets: 1, range: 30, hsMult: 1, color: 0x7fbf4a, projectile: { speed: 14, radius: 0.2, splash: 1.6 } },
  zmelee:  { dmg: 14, rate: 0.9, mag: Infinity, reload: 0, spread: 0, auto: false, pellets: 1, range: 1.6, hsMult: 1, color: 0x69a24a, melee: true },
};

// ---- Maps ----------------------------------------------------------------
export const MAP_ORDER = ['town', 'mine', 'port', 'canyon', 'city', 'ice'];
export const MAPS = {
  town:   { size: 72, sky: 0x87ceeb, fog: 0xbfe3f2, sun: 0xfff2cc, ground: 0x7ec850, accent: '#e0b23e' },
  mine:   { size: 64, sky: 0x1a1033, fog: 0x241645, sun: 0xb28dff, ground: 0x3d2f57, accent: '#b478ff' },
  port:   { size: 70, sky: 0x0b1e3d, fog: 0x14294d, sun: 0xcfe8ff, ground: 0x4a5568, accent: '#57c4e5' },
  canyon: { size: 76, sky: 0xffb347, fog: 0xf7c873, sun: 0xffe0b3, ground: 0xd9a066, accent: '#e07a5f' },
  city:   { size: 78, sky: 0x151538, fog: 0x252550, sun: 0xb8c4ff, ground: 0x3a3a52, accent: '#ff3e8a' },
  ice:    { size: 70, sky: 0xcfe8ff, fog: 0xe6f2ff, sun: 0xffffff, ground: 0xe8f4ff, accent: '#7db4ff' },
};

// ---- Bot difficulty --------------------------------------------------------
export const BOT_LEVELS = {
  easy:   { aimErr: 0.09, reactMs: 900, burst: 2, pause: 1.2, speed: 4.2, hp: 80 },
  normal: { aimErr: 0.05, reactMs: 550, burst: 4, pause: 0.8, speed: 5.2, hp: 100 },
  hard:   { aimErr: 0.022, reactMs: 280, burst: 6, pause: 0.45, speed: 6.0, hp: 120 },
};
export const BOT_LEVEL_ORDER = ['easy', 'normal', 'hard'];

// ---- Character skins (economy) ----------------------------------------------
export const SKINS = {
  scout:   { body: 0x3b82f6, accent: 0xfbbf24, skin: 0xf1c27d, cost: 0 },
  ember:   { body: 0xdc2626, accent: 0x1f2937, skin: 0xe0ac69, cost: 400 },
  jungle:  { body: 0x16a34a, accent: 0x854d0e, skin: 0x8d5524, cost: 400 },
  shadow:  { body: 0x312e81, accent: 0xa855f7, skin: 0xf1c27d, cost: 900 },
  sunset:  { body: 0xf97316, accent: 0xfde68a, skin: 0xc68642, cost: 900 },
  legend:  { body: 0xfacc15, accent: 0x0ea5e9, skin: 0xf1c27d, cost: 2000 },
};
export const SKIN_ORDER = ['scout', 'ember', 'jungle', 'shadow', 'sunset', 'legend'];

// ---- Progression --------------------------------------------------------------
export const RANKS = [
  { id: 'bronze', rp: 0 }, { id: 'silver', rp: 500 }, { id: 'gold', rp: 1200 },
  { id: 'platinum', rp: 2200 }, { id: 'diamond', rp: 3500 }, { id: 'legend', rp: 5000 },
];
export const rankFor = (rp) => { let r = RANKS[0]; for (const k of RANKS) if (rp >= k.rp) r = k; return r; };
export const levelFor = (xp) => Math.min(60, Math.floor(Math.sqrt(Math.max(0, xp) / 60)) + 1);
export const xpForLevel = (lvl) => 60 * (lvl - 1) * (lvl - 1);
export const RP_BY_PLACE = [30, 18, 8, 0, -6, -12];
export const DAILY_SHARDS = 100;

export const rewardsGunGame = (kills, place, won) => ({
  xp: 40 + kills * 12 + (won ? 60 : Math.max(0, 30 - place * 10)),
  shards: 15 + kills * 6 + (won ? 40 : 0),
});
export const rewardsTeam = (kills, won) => ({
  xp: 30 + kills * 10 + (won ? 80 : 0),
  shards: 12 + kills * 5 + (won ? 50 : 0),
});

export const QUICK_CHAT = ['gg', 'help', 'attack', 'nice'];

// ---- Grenades ---------------------------------------------------------------
export const GRENADE = { dmg: 82, radius: 5, fuse: 1.15, speed: 17, upVel: 5, cd: 0.9, start: 1, max: 3 };

// ---- Armor ------------------------------------------------------------------
export const ARMOR_MAX = 100;

// ---- Pickups ----------------------------------------------------------------
// weight = relative spawn chance; weapon crates only in loadout modes
export const PICKUPS = {
  everyMs: 7000,
  max: 8,
  kinds: {
    hp:     { weight: 3, amount: 40 },
    armor:  { weight: 2, amount: 50 },
    nade:   { weight: 2, amount: 1 },
    weapon: { weight: 3 },
  },
};
// modes where you start with a pistol and loot weapons from crates
export const LOADOUT_MODES = ['zombies', 'br', 'ctf'];
export const CRATE_TIERS = [
  { weapons: ['smg', 'shotgun'], color: 0x9db4c8, weight: 5 },   // common
  { weapons: ['rifle', 'lmg'],   color: 0x57c4e5, weight: 3 },   // rare
  { weapons: ['sniper', 'plasma'], color: 0xc084fc, weight: 2 }, // epic
];

// ---- Killstreaks ------------------------------------------------------------
export const KILLSTREAKS = [
  { at: 3, k: 'speed', dur: 20, mult: 1.14 },
  { at: 5, k: 'armor', amount: 50 },
  { at: 7, k: 'dmg', dur: 15, mult: 1.4 },
];

// ---- Zombies ----------------------------------------------------------------
export const ZOMBIES = {
  walker: { hp: 60,  speed: 2.6, dmg: 14, range: 1.5, rate: 0.9, score: 10, scale: 1,    color: 0x69a24a },
  runner: { hp: 35,  speed: 5.4, dmg: 10, range: 1.4, rate: 0.7, score: 15, scale: 0.85, color: 0x9bc95a },
  spitter:{ hp: 45,  speed: 3.0, dmg: 12, range: 11,  rate: 1.8, score: 20, scale: 0.95, color: 0x4aa284 },
  brute:  { hp: 320, speed: 1.9, dmg: 30, range: 1.9, rate: 1.3, score: 60, scale: 1.45, color: 0x3e6b34 },
};
export const zombieWave = (n) => {
  const list = [];
  let budget = 5 + n * 3;
  const pool = n < 2 ? ['walker'] : n < 4 ? ['walker', 'runner'] : ['walker', 'runner', 'spitter'];
  while (budget > 0) {
    const k = pool[(Math.random() * pool.length) | 0];
    list.push(k);
    budget -= k === 'walker' ? 2 : 3;
  }
  if (n % 4 === 0 && n > 0) list.push('brute');
  return list.slice(0, 14); // cap concurrent horde size
};
export const rewardsZombies = (wave, kills) => ({ xp: wave * 15 + kills * 3, shards: wave * 8 + kills });

// ---- Duel -------------------------------------------------------------------
export const DUEL = { maxPlayers: 2 };

// ---- CTF --------------------------------------------------------------------
export const CTF = { captures: 3, timeSec: 360, teamSize: 3, returnSec: 20, carrierSlow: 0.9 };

// ---- Battle Royale ----------------------------------------------------------
export const BR = {
  combatants: 8,             // humans + bot fill
  zonePhases: [              // [delay s, shrink s, radius factor of map size]
    [20, 20, 0.38], [15, 18, 0.26], [12, 15, 0.16], [10, 12, 0.08], [8, 10, 0.02],
  ],
  zoneDps: 6,
  lootCount: 14,
};
export const rewardsBr = (place, kills, of) => ({
  xp: 30 + kills * 12 + Math.max(0, (of - place)) * 10 + (place === 1 ? 70 : 0),
  shards: 10 + kills * 6 + (place === 1 ? 60 : place <= 3 ? 25 : 0),
});
