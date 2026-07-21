// ============================================================
// Player profile, economy & progression.
// Online  → Firestore users/{uid}   (source of truth)
// Offline → localStorage            (same shape)
// ============================================================

import { FB } from './fb.js';
import { SKINS, levelFor, rankFor, DAILY_SHARDS, dailyChallenges,
  DANCES, FREE_DANCES, DEFAULT_EMOTES, ADMIN_EMAILS } from './config.js';
import { randomName } from './i18n.js';

const LS_KEY = 'starshards.profile.v2';

// free dances everyone owns from the start
function baseDances() {
  const d = {};
  for (const id of FREE_DANCES) d[id] = true;
  return d;
}

function defaultProfile() {
  return {
    name: randomName(),
    xp: 0,
    rp: 0,
    shards: 250,
    skin: 'scout',
    skins: { scout: true },
    dances: baseDances(),
    emotes: [...DEFAULT_EMOTES],
    stats: { kills: 0, deaths: 0, wins: 0, matches: 0 },
    chall: { date: '', prog: {}, done: {} },
    lastDaily: 0,
    createdAt: Date.now(),
  };
}

export const profile = defaultProfile();

function normalize(p) {
  const d = defaultProfile();
  const out = { ...d, ...p };
  out.skins = { scout: true, ...(p.skins || {}) };
  out.dances = { ...baseDances(), ...(p.dances || {}) };
  out.stats = { ...d.stats, ...(p.stats || {}) };
  out.chall = { date: '', prog: {}, done: {}, ...(p.chall || {}) };
  // equipped emote slots: keep only owned/known dances, pad to 8 slots
  const valid = new Set(DANCES.map((x) => x.id));
  let em = Array.isArray(p.emotes) ? p.emotes.filter((x) => valid.has(x)) : [...DEFAULT_EMOTES];
  for (const id of DEFAULT_EMOTES) { if (em.length >= 8) break; if (!em.includes(id)) em.push(id); }
  out.emotes = em.slice(0, 8);
  const isCustom = typeof out.skin === 'string' && out.skin.startsWith('c!');
  if (!isCustom && (!SKINS[out.skin] || !out.skins[out.skin])) out.skin = 'scout';
  return out;
}

// ---- admin / god-mode ----------------------------------------------------
// admin is decided by the signed-in Google email (anonymous guests are never
// admin). client flags are convenience unlocks only, not anti-cheat.
export function isAdmin() {
  const email = (FB.user && FB.user.email || '').toLowerCase();
  return !!email && ADMIN_EMAILS.includes(email);
}

// unlock everything for the admin account: all skins, all dances, and a big
// shard balance. safe to call repeatedly (idempotent-ish).
export function applyAdminUnlocks() {
  if (!isAdmin()) return false;
  for (const id of Object.keys(SKINS)) profile.skins[id] = true;
  for (const d of DANCES) profile.dances[d.id] = true;
  if (profile.shards < 999999) profile.shards = 999999;
  profile.isAdmin = true;
  saveProfile();
  return true;
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
  if (FB.online && !data) await saveProfile();
  return profile;
}

let saveTimer = null;
export function saveProfile() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(profile)); } catch { /* ignore */ }
  if (!FB.online) return Promise.resolve();
  return new Promise((res) => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        await FB.f.setDoc(FB.f.doc(FB.fs, 'users', FB.uid), {
          ...profile,
          level: levelFor(profile.xp),
        }, { merge: true });
      } catch (e) { console.warn('profile save failed', e); }
      res();
    }, 400);
  });
}

export const playerLevel = () => levelFor(profile.xp);
export const playerRank = () => rankFor(profile.rp);

export function buySkin(id) {
  const s = SKINS[id];
  if (!s || profile.skins[id] || profile.shards < s.cost) return false;
  profile.shards -= s.cost;
  profile.skins[id] = true;
  profile.skin = id;
  saveProfile();
  return true;
}

export function equipSkin(id) {
  if (!profile.skins[id]) return false;
  profile.skin = id;
  saveProfile();
  return true;
}

// custom skin: `packed` is the 'c!...' string chars.js understands; the face
// photo (small dataURL) rides in the profile and is applied to my own model
export function equipCustomSkin(packed, facePhoto) {
  profile.skin = packed;
  profile.customSkin = packed;
  if (facePhoto !== undefined) profile.facePhoto = facePhoto || '';
  saveProfile();
  return true;
}

// ---- dances / emotes -----------------------------------------------------
const danceDef = (id) => DANCES.find((d) => d.id === id) || null;
export const ownsDance = (id) => !!profile.dances[id];

export function buyDance(id) {
  const d = danceDef(id);
  if (!d || profile.dances[id]) return false;
  if (!isAdmin() && profile.shards < d.cost) return false;
  if (!isAdmin()) profile.shards -= d.cost;
  profile.dances[id] = true;
  saveProfile();
  return true;
}

// put a dance into one of the 8 equipped emote-wheel slots
export function setEmoteSlot(slot, id) {
  if (slot < 0 || slot > 7 || !profile.dances[id]) return false;
  const em = [...profile.emotes];
  while (em.length < 8) em.push(DEFAULT_EMOTES[em.length] || 'wave');
  em[slot] = id;
  profile.emotes = em;
  saveProfile();
  return true;
}

// resolve equipped emote ids → indices into the DANCES table (for animation)
export function emoteIndices() {
  return profile.emotes.map((id) => DANCES.findIndex((d) => d.id === id));
}
export const danceIndex = (id) => DANCES.findIndex((d) => d.id === id);

export function setName(name) {
  name = String(name).trim().slice(0, 20);
  if (!name) return false;
  profile.name = name;
  saveProfile();
  return true;
}

export function claimDaily() {
  const day = 24 * 60 * 60 * 1000;
  if (Date.now() - profile.lastDaily < day) return 0;
  profile.lastDaily = Date.now();
  profile.shards += DAILY_SHARDS;
  saveProfile();
  return DAILY_SHARDS;
}

export function applyRewards({ xp = 0, shards = 0, rp = 0, kills = 0, deaths = 0, win = false }) {
  const beforeLvl = playerLevel();
  const beforeRank = playerRank().id;
  profile.xp += xp;
  profile.shards += shards;
  profile.rp = Math.max(0, profile.rp + rp);
  profile.stats.kills += kills;
  profile.stats.deaths += deaths;
  profile.stats.matches += 1;
  if (win) profile.stats.wins += 1;
  saveProfile();
  return {
    levelUp: playerLevel() > beforeLvl ? playerLevel() : 0,
    rankUp: playerRank().id !== beforeRank ? playerRank().id : null,
  };
}

// ---- daily challenges ----------------------------------------------------
function ensureToday() {
  const today = new Date().toISOString().slice(0, 10);
  if (profile.chall.date !== today) {
    profile.chall = { date: today, prog: {}, done: {} };
  }
  return today;
}

export function getChallenges() {
  const today = ensureToday();
  return dailyChallenges(today).map((c) => ({
    ...c,
    prog: Math.min(c.n, profile.chall.prog[c.id] || 0),
    done: !!profile.chall.done[c.id],
  }));
}

// deltas: {kills, headshots, wins, matches, builds, nadeKills}
// returns the list of challenges completed by this update
export function trackChallenges(deltas) {
  ensureToday();
  const completed = [];
  for (const c of getChallenges()) {
    if (c.done) continue;
    const add = deltas[c.type] || 0;
    if (!add) continue;
    const next = (profile.chall.prog[c.id] || 0) + add;
    profile.chall.prog[c.id] = next;
    if (next >= c.n) {
      profile.chall.done[c.id] = true;
      profile.shards += c.reward;
      completed.push(c);
    }
  }
  saveProfile();
  return completed;
}

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
