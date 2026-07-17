// ============================================================
// Player profile, economy & progression.
// Online  → Firestore users/{uid}   (source of truth)
// Offline → localStorage            (same shape)
// ============================================================

import { FB } from './fb.js';
import {
  SHIPS, UPGRADE_TRACKS, UPGRADE_COST, UPGRADE_BONUS,
  levelFor, rankFor, DAILY_SHARDS,
} from './config.js';
import { randomName } from './i18n.js';

const LS_KEY = 'starshards.profile';

function defaultProfile() {
  return {
    name: randomName(),
    xp: 0,
    rp: 0,
    shards: 250,
    ship: 'storm',
    ships: { storm: true },
    up: { dmg: 0, rate: 0, speed: 0, hp: 0 },
    stats: { kills: 0, deaths: 0, wins: 0, matches: 0, waves: 0, bestWave: 0 },
    lastDaily: 0,
    createdAt: Date.now(),
  };
}

export const profile = defaultProfile();

function normalize(p) {
  const d = defaultProfile();
  const out = { ...d, ...p };
  out.up = { ...d.up, ...(p.up || {}) };
  out.ships = { storm: true, ...(p.ships || {}) };
  out.stats = { ...d.stats, ...(p.stats || {}) };
  if (!SHIPS[out.ship] || !out.ships[out.ship]) out.ship = 'storm';
  return out;
}

export async function loadProfile() {
  let data = null;
  if (FB.online) {
    try {
      const snap = await FB.f.getDoc(FB.f.doc(FB.fs, 'users', FB.uid));
      if (snap.exists()) data = snap.data();
    } catch (e) { console.warn('profile load failed', e); }
  }
  if (!data) {
    try { data = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { /* ignore */ }
  }
  Object.assign(profile, normalize(data || {}));
  if (FB.online && !data) await saveProfile(); // first login: create doc
  return profile;
}

let saveTimer = null;
export function saveProfile() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(profile)); } catch { /* ignore */ }
  if (!FB.online) return Promise.resolve();
  // debounce Firestore writes
  return new Promise((res) => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        await FB.f.setDoc(FB.f.doc(FB.fs, 'users', FB.uid), {
          ...profile,
          level: levelFor(profile.xp), // denormalized for leaderboard rows
        }, { merge: true });
      } catch (e) { console.warn('profile save failed', e); }
      res();
    }, 400);
  });
}

// ---- derived ----------------------------------------------------------
export const playerLevel = () => levelFor(profile.xp);
export const playerRank = () => rankFor(profile.rp);

// effective ship stats after upgrades
export function effectiveStats(shipId = profile.ship) {
  const s = SHIPS[shipId];
  return {
    hp: Math.round(s.hp * (1 + profile.up.hp * UPGRADE_BONUS.hp)),
    speed: Math.round(s.speed * (1 + profile.up.speed * UPGRADE_BONUS.speed)),
    dmgMul: 1 + profile.up.dmg * UPGRADE_BONUS.dmg,
    rateMul: 1 / (1 + profile.up.rate * UPGRADE_BONUS.rate),
    weapon: s.weapon,
    special: s.special,
    hue: s.hue,
  };
}

// ---- economy actions ---------------------------------------------------
export function buyShip(shipId) {
  const s = SHIPS[shipId];
  if (!s || profile.ships[shipId] || profile.shards < s.cost) return false;
  profile.shards -= s.cost;
  profile.ships[shipId] = true;
  profile.ship = shipId;
  saveProfile();
  return true;
}

export function equipShip(shipId) {
  if (!profile.ships[shipId]) return false;
  profile.ship = shipId;
  saveProfile();
  return true;
}

export function buyUpgrade(track) {
  if (!UPGRADE_TRACKS.includes(track)) return false;
  const tier = profile.up[track];
  if (tier >= UPGRADE_COST.length) return false;
  const cost = UPGRADE_COST[tier];
  if (profile.shards < cost) return false;
  profile.shards -= cost;
  profile.up[track] = tier + 1;
  saveProfile();
  return true;
}

export function setName(name) {
  name = String(name).trim().slice(0, 20);
  if (!name) return false;
  profile.name = name;
  saveProfile();
  return true;
}

// returns shards granted (0 when already claimed today)
export function claimDaily() {
  const day = 24 * 60 * 60 * 1000;
  if (Date.now() - profile.lastDaily < day) return 0;
  profile.lastDaily = Date.now();
  profile.shards += DAILY_SHARDS;
  saveProfile();
  return DAILY_SHARDS;
}

// apply match rewards; returns {levelUp, rankUp} flags for UI fanfare
export function applyRewards({ xp = 0, shards = 0, rp = 0, kills = 0, deaths = 0, win = false, waves = 0 }) {
  const beforeLvl = playerLevel();
  const beforeRank = playerRank().id;
  profile.xp += xp;
  profile.shards += shards;
  profile.rp = Math.max(0, profile.rp + rp);
  profile.stats.kills += kills;
  profile.stats.deaths += deaths;
  profile.stats.matches += 1;
  if (win) profile.stats.wins += 1;
  if (waves) {
    profile.stats.waves += waves;
    profile.stats.bestWave = Math.max(profile.stats.bestWave, waves);
  }
  saveProfile();
  return {
    levelUp: playerLevel() > beforeLvl ? playerLevel() : 0,
    rankUp: playerRank().id !== beforeRank ? playerRank().id : null,
  };
}

// ---- leaderboard ---------------------------------------------------------
export async function fetchLeaderboard(topN = 50) {
  if (!FB.online) return null;
  try {
    const q = FB.f.query(
      FB.f.collection(FB.fs, 'users'),
      FB.f.orderBy('rp', 'desc'),
      FB.f.limit(topN),
    );
    const snap = await FB.f.getDocs(q);
    return snap.docs.map((d) => {
      const u = d.data();
      return { uid: d.id, name: u.name, rp: u.rp || 0, level: u.level || 1, kills: u.stats?.kills || 0 };
    });
  } catch (e) {
    console.warn('leaderboard failed', e);
    return null;
  }
}
