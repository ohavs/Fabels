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
