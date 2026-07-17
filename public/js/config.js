// ============================================================
// שברי כוכב · STARSHARDS — configuration & balance data
// Everything gameplay-related is data-driven from this file.
// ============================================================

// ---- Firebase --------------------------------------------------------
// Replace with your own project's config (Firebase console → Project
// settings → Your apps → Web app). While the placeholders are left in
// place the game automatically runs in OFFLINE mode (practice vs bots,
// progression stored in localStorage).
export const FIREBASE_CONFIG = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'YOUR_PROJECT.firebaseapp.com',
  databaseURL: 'https://YOUR_PROJECT-default-rtdb.firebaseio.com',
  projectId: 'YOUR_PROJECT',
  storageBucket: 'YOUR_PROJECT.appspot.com',
  messagingSenderId: '0',
  appId: 'YOUR_APP_ID',
};

export const firebaseConfigured = () =>
  !/^YOUR_/.test(FIREBASE_CONFIG.apiKey) && !/^YOUR_/.test(FIREBASE_CONFIG.projectId);

// ---- Core constants --------------------------------------------------
export const GAME = {
  arena: 2200,            // world is arena x arena
  wallPad: 60,            // soft wall margin
  syncMs: 90,             // network state broadcast interval (~11Hz)
  enemySyncMs: 120,       // host → guests enemy snapshot interval
  pvpTime: 180,           // seconds per PvP match
  respawnPvp: 3,
  respawnCoop: 8,
  invulnTime: 2,          // seconds of spawn protection
  maxPlayersPvp: 6,
  maxPlayersCoop: 4,
  dashCd: 4,
  dashPower: 620,
  specialCd: 12,
  pickupMax: 6,
  pickupEveryMs: 9000,
  lobbyCountdown: 4,      // seconds from "starting" to "playing"
  roomTTL: 2 * 60 * 60 * 1000, // ignore rooms older than 2h
};

// ---- Weapons ----------------------------------------------------------
export const WEAPONS = {
  blaster: { dmg: 12, rate: 0.18, speed: 640, life: 0.85, pellets: 1, spread: 0,    r: 4 },
  spread:  { dmg: 7,  rate: 0.32, speed: 560, life: 0.60, pellets: 3, spread: 0.26, r: 3.5 },
  laser:   { dmg: 22, rate: 0.48, speed: 980, life: 0.90, pellets: 1, spread: 0,    r: 3, pierce: true },
  missile: { dmg: 30, rate: 0.85, speed: 430, life: 2.0,  pellets: 1, spread: 0,    r: 5, homing: true },
  // enemy weapon
  sting:   { dmg: 10, rate: 1.4,  speed: 300, life: 2.2,  pellets: 1, spread: 0,    r: 4 },
};

// ---- Ships ------------------------------------------------------------
// special: overdrive (x2 fire rate 3s) | blink (teleport) | shield (2.5s) | nova (AoE)
export const SHIPS = {
  storm:  { hp: 100, speed: 260, weapon: 'blaster', special: 'overdrive', cost: 0,    hue: 190 },
  shadow: { hp: 70,  speed: 330, weapon: 'spread',  special: 'blink',     cost: 800,  hue: 285 },
  aegis:  { hp: 150, speed: 200, weapon: 'missile', special: 'shield',    cost: 1500, hue: 130 },
  nova:   { hp: 80,  speed: 240, weapon: 'laser',   special: 'nova',      cost: 2500, hue: 25 },
};
export const SHIP_ORDER = ['storm', 'shadow', 'aegis', 'nova'];

export const SPECIALS = {
  overdrive: { dur: 3 },
  blink: { dist: 260 },
  shield: { dur: 2.5 },
  nova: { dmg: 55, radius: 240 },
};

// ---- Upgrades (4 tracks × 5 tiers) -------------------------------------
export const UPGRADE_TRACKS = ['dmg', 'rate', 'speed', 'hp'];
export const UPGRADE_COST = [200, 450, 800, 1300, 2000];
export const UPGRADE_BONUS = { dmg: 0.06, rate: 0.06, speed: 0.05, hp: 0.08 }; // per tier

// ---- Enemies (co-op) ----------------------------------------------------
export const ENEMIES = {
  crawler: { hp: 30,  speed: 150, dmg: 12, score: 10,  shards: 2,  r: 16, cost: 2 },
  stinger: { hp: 45,  speed: 110, dmg: 10, score: 20,  shards: 4,  r: 18, cost: 4, range: 380 },
  crusher: { hp: 140, speed: 70,  dmg: 25, score: 40,  shards: 8,  r: 28, cost: 8 },
  boss:    { hp: 900, speed: 60,  dmg: 30, score: 300, shards: 60, r: 52, cost: 0 },
};
export const waveBudget = (n) => 4 + n * 3;
export const bossWave = (n) => n % 5 === 0;
export const bossHp = (n) => ENEMIES.boss.hp + (n - 5) * 120;

// ---- Progression ---------------------------------------------------------
export const RANKS = [
  { id: 'bronze',   rp: 0 },
  { id: 'silver',   rp: 500 },
  { id: 'gold',     rp: 1200 },
  { id: 'platinum', rp: 2200 },
  { id: 'diamond',  rp: 3500 },
  { id: 'legend',   rp: 5000 },
];
export const rankFor = (rp) => {
  let r = RANKS[0];
  for (const k of RANKS) if (rp >= k.rp) r = k;
  return r;
};
export const levelFor = (xp) => Math.min(60, Math.floor(Math.sqrt(Math.max(0, xp) / 60)) + 1);
export const xpForLevel = (lvl) => 60 * (lvl - 1) * (lvl - 1);

// RP delta by final placement in PvP (index 0 = 1st place)
export const RP_BY_PLACE = [30, 18, 8, 0, -6, -12];

export const DAILY_SHARDS = 100;

// ---- Match rewards --------------------------------------------------------
export const rewardsPvp = (kills, place) => ({
  xp: 40 + kills * 15 + Math.max(0, 30 - place * 10),
  shards: 15 + kills * 8 + Math.max(0, 20 - place * 6),
});
export const rewardsCoop = (wave, kills) => ({
  xp: wave * 12 + kills * 4,
  shards: wave * 6 + kills * 2,
});

// ---- Quick chat ------------------------------------------------------------
export const QUICK_CHAT = ['gg', 'help', 'attack', 'nice'];
