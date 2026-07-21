// ============================================================
// Firebase bootstrap. Modular SDK is imported dynamically ONLY
// when config.js holds a real project config, so the game keeps
// working fully offline (practice mode) without any network.
//
// After init(), FB exposes:
//   FB.online   – true when Firebase is live
//   FB.uid      – anonymous auth uid
//   FB.db / FB.d  – Realtime Database instance / namespace fns
//   FB.fs / FB.f  – Firestore instance / namespace fns
//   FB.serverNow() – RTDB-offset-corrected epoch ms
// ============================================================

import { FIREBASE_CONFIG, firebaseConfigured } from './config.js';

const V = '10.12.2';
const CDN = (m) => `https://www.gstatic.com/firebasejs/${V}/firebase-${m}.js`;

export const FB = {
  online: false,
  uid: null,
  app: null,
  db: null, d: null,   // realtime database
  fs: null, f: null,   // firestore
  timeOffset: 0,
  serverNow: () => Date.now() + FB.timeOffset,
  connected: false,      // live RTDB transport state (.info/connected)
  _connCbs: [],
  onConn(cb) { FB._connCbs.push(cb); },
};

export async function initFirebase() {
  if (!firebaseConfigured()) return false;
  try {
    const [appM, authM, dbM, fsM] = await Promise.all([
      import(CDN('app')), import(CDN('auth')), import(CDN('database')), import(CDN('firestore')),
    ]);
    FB.app = appM.initializeApp(FIREBASE_CONFIG);

    const auth = authM.getAuth(FB.app);
    FB.auth = auth;
    FB.authM = authM;
    // restore a previous session (Google or anonymous) before minting a new
    // anonymous user, so a signed-in player keeps their account across visits
    const existing = await new Promise((res) => {
      const stop = authM.onAuthStateChanged(auth, (u) => { stop(); res(u); }, () => { stop(); res(null); });
      setTimeout(() => res(auth.currentUser), 2500);
    });
    const user = existing || (await authM.signInAnonymously(auth)).user;
    FB.uid = user.uid;
    FB.user = user;

    FB.d = dbM;
    FB.db = dbM.getDatabase(FB.app);
    FB.f = fsM;
    FB.fs = fsM.getFirestore(FB.app);

    // clock sync for match timers
    dbM.onValue(dbM.ref(FB.db, '.info/serverTimeOffset'), (snap) => {
      FB.timeOffset = snap.val() || 0;
    });

    // transport watchdog: report drops/recoveries to whoever subscribed.
    // ('.info/connected' starts false — only fire after the first connect
    // so boot doesn't look like a disconnect.)
    let everConnected = false;
    dbM.onValue(dbM.ref(FB.db, '.info/connected'), (snap) => {
      const v = !!snap.val();
      if (v) everConnected = true;
      else if (!everConnected) return;
      if (v === FB.connected) return;
      FB.connected = v;
      for (const cb of FB._connCbs) { try { cb(v); } catch { /* ignore */ } }
    });

    FB.online = true;
    return true;
  } catch (err) {
    console.warn('Firebase init failed — falling back to offline mode', err);
    FB.online = false;
    return false;
  }
}

// ---- Google sign-in --------------------------------------------------------
// Anonymous user → LINK the Google account (uid unchanged, progress kept).
// If that Google account is already tied to another player, sign into it
// instead (returns 'switched' so the app can reload state for the other uid).
export async function signInWithGoogle() {
  if (!FB.online || !FB.auth) return { ok: false, reason: 'offline' };
  const provider = new FB.authM.GoogleAuthProvider();
  try {
    if (FB.user && FB.user.isAnonymous) {
      const cred = await FB.authM.linkWithPopup(FB.user, provider);
      FB.user = cred.user;
      return { ok: true, mode: 'linked', user: cred.user };
    }
    const cred = await FB.authM.signInWithPopup(FB.auth, provider);
    FB.user = cred.user; FB.uid = cred.user.uid;
    return { ok: true, mode: 'signed', user: cred.user };
  } catch (e) {
    if (e && (e.code === 'auth/credential-already-in-use' || e.code === 'auth/email-already-in-use')) {
      // this Google account already owns a player → switch to it
      try {
        const cred = await FB.authM.signInWithPopup(FB.auth, provider);
        FB.user = cred.user; FB.uid = cred.user.uid;
        return { ok: true, mode: 'switched', user: cred.user };
      } catch (e2) { return { ok: false, reason: e2.code || 'popup' }; }
    }
    return { ok: false, reason: (e && e.code) || 'popup' };
  }
}

export async function signOutGoogle() {
  if (!FB.auth) return;
  try { await FB.authM.signOut(FB.auth); } catch { /* ignore */ }
}

export const isGoogleUser = () => !!(FB.user && !FB.user.isAnonymous);
