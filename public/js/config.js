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
  syncMs: 90,               // RTDB player state broadcast (~11Hz baseline / fallback)
  rtcMs: 50,                // WebRTC fast-lane position broadcast (~20Hz, direct P2P)
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
  safeFall: 14,             // landing speed (m/s) above this hurts (≈ >4m drop)
  fallDmg: 6,               // damage per m/s above the safe landing speed
};

// ---- Gun-Game weapon ladder (index = tier) ------------------------------
// hitscan unless projectile; melee = short-range swing
export const WEAPON_LADDER = ['pistol', 'smg', 'shotgun', 'rifle', 'lmg', 'sniper', 'plasma', 'knife'];

export const WEAPONS = {
  pistol:  { dmg: 26, rate: 0.34, mag: 12, reload: 1.1, spread: 0.012, auto: false, pellets: 1, range: 60, hsMult: 2.0, color: 0x9db4c8, adsFov: 58 },
  smg:     { dmg: 14, rate: 0.09, mag: 30, reload: 1.5, spread: 0.035, auto: true,  pellets: 1, range: 45, hsMult: 1.6, color: 0xf4a259, adsFov: 60 },
  shotgun: { dmg: 9,  rate: 0.85, mag: 6,  reload: 1.9, spread: 0.075, auto: false, pellets: 8, range: 26, hsMult: 1.4, color: 0xc25b4e, adsFov: 66 },
  rifle:   { dmg: 22, rate: 0.125, mag: 25, reload: 1.7, spread: 0.02, auto: true,  pellets: 1, range: 75, hsMult: 1.8, color: 0x5fa8d3, adsFov: 50 },
  lmg:     { dmg: 16, rate: 0.08, mag: 60, reload: 2.6, spread: 0.05, auto: true,  pellets: 1, range: 60, hsMult: 1.5, color: 0x7a8b5c, adsFov: 56 },
  sniper:  { dmg: 95, rate: 1.5,  mag: 5,  reload: 2.2, spread: 0.002, auto: false, pellets: 1, range: 150, hsMult: 2.0, color: 0x8d6cab, adsFov: 20, scope: true },
  plasma:  { dmg: 46, rate: 0.7,  mag: 8,  reload: 1.8, spread: 0.008, auto: false, pellets: 1, range: 100, hsMult: 1.0, color: 0x39e6c8, adsFov: 56, projectile: { speed: 38, radius: 0.22, splash: 3.2 } },
  knife:   { dmg: 100, rate: 0.5, mag: Infinity, reload: 0, spread: 0, auto: false, pellets: 1, range: 2.4, hsMult: 1.0, color: 0xffd166, melee: true },
  // bots' fixed weapon
  botgun:  { dmg: 11, rate: 0.42, mag: Infinity, reload: 0, spread: 0.05, auto: true, pellets: 1, range: 55, hsMult: 1.0, color: 0xff5964 },
  // zombie attacks
  spit:    { dmg: 12, rate: 1.8, mag: Infinity, reload: 0, spread: 0.02, auto: false, pellets: 1, range: 30, hsMult: 1, color: 0x7fbf4a, projectile: { speed: 14, radius: 0.2, splash: 1.6 } },
  zmelee:  { dmg: 14, rate: 0.9, mag: Infinity, reload: 0, spread: 0, auto: false, pellets: 1, range: 1.6, hsMult: 1, color: 0x69a24a, melee: true },
  // harvesting tool (build modes) — low damage, gathers materials
  pickaxe: { dmg: 20, rate: 0.55, mag: Infinity, reload: 0, spread: 0, auto: false, pellets: 1, range: 3.2, hsMult: 1, color: 0xb0b6c0, melee: true, harvest: true },
};

// reticle style per weapon (drives the HUD crosshair shape)
export const RETICLE = {
  pistol: 'cross', smg: 'dot', shotgun: 'ring', rifle: 'chevron',
  lmg: 'wide', sniper: 'scope', plasma: 'circle', knife: 'dot',
  botgun: 'cross', pickaxe: 'dot',
};

// ---- Maps ----------------------------------------------------------------
export const MAP_ORDER = ['town', 'mine', 'port', 'canyon', 'city', 'ice', 'island'];
export const MAPS = {
  town:   { size: 72, sky: 0x87ceeb, fog: 0xbfe3f2, sun: 0xfff2cc, ground: 0x7ec850, accent: '#e0b23e' },
  mine:   { size: 64, sky: 0x1a1033, fog: 0x241645, sun: 0xb28dff, ground: 0x3d2f57, accent: '#b478ff' },
  port:   { size: 70, sky: 0x0b1e3d, fog: 0x14294d, sun: 0xcfe8ff, ground: 0x4a5568, accent: '#57c4e5' },
  canyon: { size: 76, sky: 0xffb347, fog: 0xf7c873, sun: 0xffe0b3, ground: 0xd9a066, accent: '#e07a5f' },
  city:   { size: 78, sky: 0x151538, fog: 0x252550, sun: 0xb8c4ff, ground: 0x3a3a52, accent: '#ff3e8a' },
  ice:    { size: 70, sky: 0xcfe8ff, fog: 0xe6f2ff, sun: 0xffffff, ground: 0xe8f4ff, accent: '#7db4ff' },
  island: { size: 80, sky: 0x8fd7f0, fog: 0xcdeef8, sun: 0xfff6d8, ground: 0x8ed06a, accent: '#3ec9a7' },
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
  // new — optional accessories: pads (shoulder pads), pack (backpack), visorGlow (emissive visor)
  neon:    { body: 0x06b6d4, accent: 0xec4899, skin: 0xf1c27d, visorGlow: 0x22d3ee, cost: 700 },
  crimson: { body: 0x991b1b, accent: 0xfacc15, skin: 0xe0ac69, pads: 0x111827, cost: 900 },
  arctic:  { body: 0xe5e7eb, accent: 0x38bdf8, skin: 0xf1c27d, pack: 0x94a3b8, cost: 1100 },
  toxic:   { body: 0x3f6212, accent: 0x84cc16, skin: 0x8d5524, visorGlow: 0xa3e635, cost: 1300 },
  royal:   { body: 0x6d28d9, accent: 0xfbbf24, skin: 0xf1c27d, pads: 0x4c1d95, pack: 0xfbbf24, cost: 1800 },
  galaxy:  { body: 0x1e1b4b, accent: 0xa78bfa, skin: 0xe0ac69, visorGlow: 0xc4b5fd, pack: 0x312e81, cost: 2600 },
};
export const SKIN_ORDER = ['scout', 'ember', 'jungle', 'shadow', 'sunset', 'neon', 'crimson', 'arctic', 'toxic', 'legend', 'royal', 'galaxy'];

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

// ---- Emotes / dances --------------------------------------------------------
// The array index IS the danceType passed to animateCharacter(); order is
// permanent (don't reorder — it would remap owned dances). First 5 are free.
export const DANCES = [
  { id: 'floss',   name: 'פלוס',        icon: '🕺', cost: 0 },
  { id: 'wave',    name: 'נפנוף',        icon: '👋', cost: 0 },
  { id: 'flex',    name: 'שרירים',       icon: '💪', cost: 0 },
  { id: 'cheer',   name: 'עידוד',        icon: '🎉', cost: 0 },
  { id: 'bow',     name: 'קידה',         icon: '🙇', cost: 0 },
  { id: 'laugh',   name: 'צחוק',         icon: '😂', cost: 150 },
  { id: 'robot',   name: 'רובוט',        icon: '🤖', cost: 150 },
  { id: 'clap',    name: 'מחיאות כפיים', icon: '👏', cost: 150 },
  { id: 'disco',   name: 'דיסקו',        icon: '🪩', cost: 200 },
  { id: 'dab',     name: 'דאב',          icon: '🙆', cost: 200 },
  { id: 'spin',    name: 'סחרור',        icon: '🌀', cost: 250 },
  { id: 'twist',   name: 'טוויסט',       icon: '🍥', cost: 250 },
  { id: 'ymca',    name: 'YMCA',         icon: '🔤', cost: 300 },
  { id: 'jacks',   name: 'קפיצות',       icon: '🤸', cost: 250 },
  { id: 'kick',    name: 'בעיטות',       icon: '🦵', cost: 300 },
  { id: 'moonwalk',name: 'מונ-ווק',      icon: '🌙', cost: 350 },
  { id: 'worm',    name: 'התולעת',       icon: '🐛', cost: 350 },
  { id: 'salute',  name: 'הצדעה',        icon: '🫡', cost: 200 },
  { id: 'headbang',name: 'הד-בנג',       icon: '🤘', cost: 300 },
  { id: 'shuffle', name: 'שאפל',         icon: '👟', cost: 350 },
  { id: 'breakdance', name: 'ברייקדאנס', icon: '💥', cost: 450 },
  { id: 'tpose',   name: 'T-פוז',        icon: '🧍', cost: 500 },
  { id: 'handsup', name: 'ידיים למעלה',  icon: '🙌', cost: 200 },
  { id: 'swim',    name: 'שחייה',        icon: '🏊', cost: 300 },
];
export const FREE_DANCES = DANCES.filter((d) => d.cost === 0).map((d) => d.id);
// default equipped wheel (up to 8 shown on the emote wheel)
export const DEFAULT_EMOTES = ['floss', 'wave', 'flex', 'cheer', 'bow', 'clap', 'robot', 'disco'];

// accounts with full unlock / admin powers (matched against the Google email)
export const ADMIN_EMAILS = ['ohav88@gmail.com'];

// ---- Building (Fortnite-style walls & ramps) --------------------------------
export const BUILD = {
  matsStart: 10, matsMax: 30, matsPerKill: 4,
  wallCost: 2, rampCost: 3, floorCost: 2, coneCost: 3,
  wallHp: 130,
  placeCd: 0.12,        // snappy turbo-building like 1v1.lol
  reach: 8,            // how far ahead you can place (metres)
  grid: 3,            // build grid size (Fortnite tile)
  harvestPerHit: 12,  // mats gained per pickaxe hit on a node
};

// Build materials (Fortnite-style): wood is cheap/weak/fast, brick medium,
// metal expensive/tough. One shared `mats` pool; costMul scales the per-piece
// cost and hp sets the structure's health. color/trim drive the mesh look.
export const BUILD_MATERIALS = {
  wood:  { hp: 130, costMul: 1,   color: 0x9a7148, trim: 0x6f4e2e, ghost: 0xcaa26a },
  brick: { hp: 250, costMul: 1.5, color: 0xb0584a, trim: 0x7d3b2e, ghost: 0xe08a76 },
  metal: { hp: 420, costMul: 2,   color: 0x8b95a6, trim: 0x59626f, ghost: 0xc3ccd9 },
};
export const MATERIAL_ORDER = ['wood', 'brick', 'metal'];

// modes that play in third person with the build bar & pickaxe
export const BUILD_MODES = ['builddm', 'boxfight', 'creative'];

// Creative: free building on your own island — no cost, no timer, save/load
export const CREATIVE = { maxPieces: 400 };

// ---- Daily challenges -------------------------------------------------------
export const CHALLENGE_POOL = [
  { id: 'kills8', type: 'kills', n: 8, reward: 80 },
  { id: 'kills15', type: 'kills', n: 15, reward: 140 },
  { id: 'hs4', type: 'headshots', n: 4, reward: 90 },
  { id: 'win1', type: 'wins', n: 1, reward: 120 },
  { id: 'matches3', type: 'matches', n: 3, reward: 70 },
  { id: 'builds6', type: 'builds', n: 6, reward: 60 },
  { id: 'nades3', type: 'nadeKills', n: 3, reward: 110 },
];
// deterministic 3 challenges per calendar day
export const dailyChallenges = (dateStr) => {
  let h = 0;
  for (const c of dateStr) h = (h * 31 + c.charCodeAt(0)) | 0;
  const pool = [...CHALLENGE_POOL];
  const out = [];
  for (let i = 0; i < 3; i++) {
    h = (h * 1103515245 + 12345) & 0x7fffffff;
    out.push(pool.splice(h % pool.length, 1)[0]);
  }
  return out;
};

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
    mats:   { weight: 2, amount: 8 },
    weapon: { weight: 3 },
  },
};
// modes where you start with a pistol and loot weapons from crates
export const LOADOUT_MODES = ['zombies', 'br', 'ctf', 'builddm', 'zonewars', 'boxfight', 'tactical', 'creative'];

// Fortnite-style carried inventory for loadout modes (slot 0 = pickaxe,
// then weapons). LB/RB cycle these; pickups swap into a weapon slot.
export const LOADOUT_KIT = ['pickaxe', 'rifle', 'shotgun', 'sniper'];

// Tactical mode economy (CS / Fortnite-Ballistic): rounds start with just a
// pickaxe + pistol; credits buy gear during the prep phase.
export const TAC_KIT = ['pickaxe', 'pistol'];
export const TAC_ECON = { start: 800, win: 1000, lose: 650, kill: 200, plant: 300, max: 9000 };
export const TAC_PRICES = { smg: 400, shotgun: 500, rifle: 800, lmg: 1000, sniper: 1200, armor: 400, nade: 200 };

// ---- Build Battle (Fortnite-style build deathmatch) -------------------------
export const BUILDDM = {
  timeSec: 600,          // 10 minutes, most kills wins
  matsStart: 30,
  matsMax: 60,
  matsPerKill: 8,
};
// Boxfight — a tight, fast build-fight in a small bounded arena: constant
// close-quarters combat, respawns, most kills in the time limit wins.
export const BOXFIGHT = {
  timeSec: 240,          // 4 minutes
  matsStart: 500,
  matsMax: 999,
  matsPerKill: 40,
  arenaFactor: 0.24,     // arena radius as a factor of map size (small box)
  arenaDps: 12,          // out-of-bounds damage per second
};
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

// ---- Tactical (CS / Fortnite-Ballistic style) -------------------------------
// Round-based: attackers (r) plant a device at the site, defenders (b) defuse.
// No respawn within a round; first team to `winRounds` wins the match.
export const TACTICAL = {
  teamSize: 3,
  winRounds: 5,          // best-of-9 → first to 5
  prepTime: 9,           // seconds at round start before it goes live (buy phase)
  roundTime: 95,         // time to plant; if it lapses with no plant → defenders win
  plantTime: 3.2,        // seconds an attacker must hold the site to plant
  defuseTime: 4.5,       // seconds a defender must hold the bomb to defuse
  bombTimer: 38,         // seconds from plant to detonation (attackers win)
  siteR: 4.2,            // plant-site radius, centred on the map
};

// ---- Battle Royale ----------------------------------------------------------
export const BR = {
  combatants: 8,             // humans + bot fill
  startFactor: 0.75,         // zone start radius as a factor of map size
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

// Zone Wars — a tight, fast, build-heavy BR: small arena, quick shrinks,
// everyone starts loaded with materials. Last one standing wins.
export const ZONEWARS = {
  combatants: 4,
  startFactor: 0.42,         // arena starts much smaller than BR (0.75)
  zonePhases: [              // [delay s, shrink s, radius factor of map size]
    [8, 10, 0.28], [6, 8, 0.18], [5, 7, 0.10], [5, 6, 0.045],
  ],
  zoneDps: 8,
  lootCount: 8,
  matsStart: 400,            // build-focused → start rich
};
