// ============================================================
// Social layer — friend codes, friends list, presence & invites.
//   • friend code: short shareable code stored on the Firestore profile;
//     adding a friend looks the code up with a users query.
//   • friends: one-sided list saved in my own profile (name cached).
//   • presence: RTDB presence/{uid} = {name, state, room, at} written by
//     each client with onDisconnect cleanup → friends see online/in-room.
//   • invites: RTDB invites/{toUid}/{fromUid} = {room, name, at} → the
//     receiver gets a banner and can jump straight into the room.
// Everything degrades gracefully when offline or when the DB rules
// haven't been updated yet (writes just fail silently).
// ============================================================

import { FB } from './fb.js';
import { profile, saveProfile } from './profile.js';
import { DANCES, SKINS } from './config.js';

// ---- friend code -----------------------------------------------------------
// unambiguous alphabet (no O/0/I/1); 6 chars ≈ 1B combinations
const CODE_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function ensureFriendCode() {
  if (profile.friendCode) return profile.friendCode;
  let c = '';
  for (let i = 0; i < 6; i++) c += CODE_ABC[(Math.random() * CODE_ABC.length) | 0];
  profile.friendCode = c;
  if (!profile.friends) profile.friends = {};
  saveProfile();
  return c;
}

// ---- friends CRUD ----------------------------------------------------------
// look a friend code up in Firestore and add them to my list.
// returns {ok, name} or {ok:false, reason: 'offline'|'notFound'|'self'|'dup'}
export async function addFriendByCode(code) {
  code = String(code || '').trim().toUpperCase();
  if (!code) return { ok: false, reason: 'notFound' };
  if (!FB.online) return { ok: false, reason: 'offline' };
  if (code === profile.friendCode) return { ok: false, reason: 'self' };
  try {
    const q = FB.f.query(
      FB.f.collection(FB.fs, 'users'),
      FB.f.where('friendCode', '==', code),
      FB.f.limit(1),
    );
    const snap = await FB.f.getDocs(q);
    if (snap.empty) return { ok: false, reason: 'notFound' };
    const doc = snap.docs[0];
    if (doc.id === FB.uid) return { ok: false, reason: 'self' };
    if (profile.friends && profile.friends[doc.id]) return { ok: false, reason: 'dup' };
    const u = doc.data();
    if (!profile.friends) profile.friends = {};
    profile.friends[doc.id] = { name: u.name || '???', addedAt: Date.now() };
    saveProfile();
    return { ok: true, name: u.name || '???' };
  } catch (e) {
    console.warn('addFriend failed', e);
    return { ok: false, reason: 'offline' };
  }
}

export function removeFriend(uid) {
  if (profile.friends && profile.friends[uid]) {
    delete profile.friends[uid];
    saveProfile();
  }
}

// refresh cached names/levels from Firestore (best effort, capped)
export async function refreshFriendProfiles() {
  if (!FB.online || !profile.friends) return;
  const uids = Object.keys(profile.friends).slice(0, 30);
  await Promise.all(uids.map(async (uid) => {
    try {
      const snap = await FB.f.getDoc(FB.f.doc(FB.fs, 'users', uid));
      if (snap.exists()) {
        const u = snap.data();
        profile.friends[uid].name = u.name || profile.friends[uid].name;
        profile.friends[uid].level = u.level || 1;
        profile.friends[uid].skin = typeof u.skin === 'string' && !u.skin.startsWith('c!') ? u.skin : 'scout';
      }
    } catch { /* keep cache */ }
  }));
  saveProfile();
}

// ---- presence --------------------------------------------------------------
let presenceArmed = false;

// state: 'menu' | 'lobby' | 'match'; room: joinable room code ('' when none)
export function setPresence(state, room = '') {
  if (!FB.online) return;
  try {
    const ref = FB.d.ref(FB.db, 'presence/' + FB.uid);
    FB.d.set(ref, { name: profile.name, state, room, at: FB.serverNow() }).catch(() => {});
    if (!presenceArmed) {
      presenceArmed = true;
      FB.d.onDisconnect(ref).remove();
      // re-arm after transport drops (the server wiped it)
      FB.onConn((ok) => { if (ok) { presenceArmed = false; setPresence(state); } });
    }
  } catch { /* rules not deployed yet — degrade to offline display */ }
}

// live presence of my friends → cb(map uid → {name,state,room,at}|null)
// returns an unsubscribe fn
export function watchFriends(cb) {
  if (!FB.online || !profile.friends) return () => {};
  const unsubs = [];
  const cur = {};
  for (const uid of Object.keys(profile.friends).slice(0, 30)) {
    try {
      unsubs.push(FB.d.onValue(FB.d.ref(FB.db, 'presence/' + uid), (s) => {
        cur[uid] = s.val();
        cb({ ...cur });
      }, () => { cur[uid] = null; cb({ ...cur }); }));
    } catch { /* ignore */ }
  }
  return () => { for (const u of unsubs) { try { u(); } catch { /* ignore */ } } };
}

// ---- admin grants ----------------------------------------------------------
// The admin account grants goodies to another player by their friend code.
// A grant is pushed to RTDB grants/{targetUid}/{pushId}; the target applies &
// removes it on next load. Server-side, DB rules must restrict writing to
// grants/* to the admin email (auth.token.email) — see database.rules.json.

// resolve a friend code → uid via the same Firestore lookup friends use
async function uidForCode(code) {
  code = String(code || '').trim().toUpperCase();
  if (!code || !FB.online) return null;
  try {
    const q = FB.f.query(
      FB.f.collection(FB.fs, 'users'),
      FB.f.where('friendCode', '==', code),
      FB.f.limit(1),
    );
    const snap = await FB.f.getDocs(q);
    if (snap.empty) return null;
    return snap.docs[0].id;
  } catch { return null; }
}

// grant: { shards?:number, dances?:[ids]|'all', skins?:[ids]|'all', all?:bool }
// returns {ok} or {ok:false, reason}
export async function grantByCode(code, grant) {
  if (!FB.online) return { ok: false, reason: 'offline' };
  const uid = await uidForCode(code);
  if (!uid) return { ok: false, reason: 'notFound' };
  if (uid === FB.uid) return { ok: false, reason: 'self' };
  try {
    const ref = FB.d.push(FB.d.ref(FB.db, 'grants/' + uid));
    await FB.d.set(ref, { ...grant, from: profile.name, at: FB.serverNow() });
    return { ok: true, uid };
  } catch (e) {
    console.warn('grant failed', e);
    return { ok: false, reason: 'denied' };
  }
}

// apply any pending grants addressed to me, then delete them. safe offline.
export async function applyPendingGrants() {
  if (!FB.online) return 0;
  let applied = 0;
  try {
    const ref = FB.d.ref(FB.db, 'grants/' + FB.uid);
    const snap = await FB.d.get(ref);
    if (!snap.exists()) return 0;
    const grants = snap.val() || {};
    for (const g of Object.values(grants)) {
      if (!g) continue;
      if (typeof g.shards === 'number') profile.shards += g.shards;
      const dGrant = g.all ? 'all' : g.dances;
      const sGrant = g.all ? 'all' : g.skins;
      if (dGrant === 'all') for (const d of DANCES) profile.dances[d.id] = true;
      else if (Array.isArray(dGrant)) for (const id of dGrant) profile.dances[id] = true;
      if (sGrant === 'all') for (const id of Object.keys(SKINS)) profile.skins[id] = true;
      else if (Array.isArray(sGrant)) for (const id of sGrant) profile.skins[id] = true;
      applied++;
    }
    await FB.d.remove(ref);
    if (applied) saveProfile();
  } catch (e) { console.warn('applyGrants failed', e); }
  return applied;
}

// ---- invites ---------------------------------------------------------------
export function sendInvite(toUid, roomCode) {
  if (!FB.online || !roomCode) return false;
  try {
    const ref = FB.d.ref(FB.db, `invites/${toUid}/${FB.uid}`);
    FB.d.set(ref, { room: roomCode, name: profile.name, at: FB.serverNow() }).catch(() => {});
    FB.d.onDisconnect(ref).remove();
    return true;
  } catch { return false; }
}

export function clearInvite(fromUid) {
  if (!FB.online) return;
  try { FB.d.remove(FB.d.ref(FB.db, `invites/${FB.uid}/${fromUid}`)).catch(() => {}); } catch { /* ignore */ }
}

// listen for invites addressed to me; only fresh ones (≤75s old) surface
export function watchInvites(cb) {
  if (!FB.online) return () => {};
  try {
    const ref = FB.d.ref(FB.db, 'invites/' + FB.uid);
    const unsub = FB.d.onChildAdded(ref, (s) => {
      const v = s.val();
      if (!v || !v.room) return;
      if (v.at && FB.serverNow() - v.at > 75000) { clearInvite(s.key); return; }
      cb(s.key, v);
    });
    return () => { try { unsub(); } catch { /* ignore */ } };
  } catch { return () => {}; }
}
