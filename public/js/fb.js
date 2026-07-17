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
};

export async function initFirebase() {
  if (!firebaseConfigured()) return false;
  try {
    const [appM, authM, dbM, fsM] = await Promise.all([
      import(CDN('app')), import(CDN('auth')), import(CDN('database')), import(CDN('firestore')),
    ]);
    FB.app = appM.initializeApp(FIREBASE_CONFIG);

    const auth = authM.getAuth(FB.app);
    const cred = await authM.signInAnonymously(auth);
    FB.uid = cred.user.uid;

    FB.d = dbM;
    FB.db = dbM.getDatabase(FB.app);
    FB.f = fsM;
    FB.fs = fsM.getFirestore(FB.app);

    // clock sync for match timers
    dbM.onValue(dbM.ref(FB.db, '.info/serverTimeOffset'), (snap) => {
      FB.timeOffset = snap.val() || 0;
    });

    FB.online = true;
    return true;
  } catch (err) {
    console.warn('Firebase init failed — falling back to offline mode', err);
    FB.online = false;
    return false;
  }
}
