// ============================================================
// Controls & preferences — gamepad binds, look sensitivity, etc.
// Offline-first persistence:
//   • localStorage is written synchronously on every change (instant,
//     survives refresh / network loss).
//   • Firestore users/{uid}.settings is the cross-device cloud copy,
//     written debounced when signed-in & online.
//   • If a cloud write can't go out (offline), a "pending" flag is set;
//     the next successful load/save flushes it — so a change made on a
//     plane still lands in the cloud once you reconnect.
// ============================================================

import { FB } from './fb.js';
import { clamp } from './util.js';

const LS_KEY = 'starshards.settings.v2';
const PENDING_KEY = 'starshards.settings.pending';

// Default binds use the W3C "standard gamepad" button indices, i.e. an
// Xbox controller: 0=A 1=B 2=X 3=Y 4=LB 5=RB 6=LT 7=RT 8=View 9=Menu
// 10=L3 11=R3 12=D-up 13=D-down 14=D-left 15=D-right
export const DEFAULT_BINDS = {
  fire: 7, aim: 6, jump: 0, crouch: 1, reload: 2, gun: 3,
  nade: 4, edit: 5, sprint: 10, camera: 11, score: 8, emote: 9,
  wall: 12, ramp: 13, floor: 14, pick: 15,
  cone: -1,           // no free standard button by default — rebindable
};

// order shown in the rebinding list
export const BIND_ORDER = [
  'fire', 'aim', 'jump', 'crouch', 'sprint', 'reload', 'nade',
  'gun', 'wall', 'ramp', 'floor', 'cone', 'pick', 'edit', 'camera', 'emote', 'score',
];

function defaults() {
  return {
    sensX: 1.0, sensY: 1.0, invertY: false, deadzone: 0.14,
    vibration: true, aimAssist: true, autoFire: true,
    sound: true, music: true,
    binds: { ...DEFAULT_BINDS },
  };
}

export const settings = defaults();

function normalize(s) {
  const d = defaults();
  const out = { ...d, ...(s || {}) };
  out.binds = { ...d.binds, ...((s && s.binds) || {}) };
  out.sensX = clamp(+out.sensX || 1, 0.1, 4);
  out.sensY = clamp(+out.sensY || 1, 0.1, 4);
  out.deadzone = clamp(+out.deadzone || 0.14, 0.02, 0.45);
  for (const k of ['invertY', 'vibration', 'aimAssist', 'autoFire', 'sound', 'music']) {
    out[k] = !!out[k];
  }
  return out;
}

function readLocal() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { return null; }
}
function writeLocal() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(settings)); } catch { /* ignore */ }
}
function markPending() { try { localStorage.setItem(PENDING_KEY, '1'); } catch { /* ignore */ } }
function clearPending() { try { localStorage.removeItem(PENDING_KEY); } catch { /* ignore */ } }
function hasPending() { try { return localStorage.getItem(PENDING_KEY) === '1'; } catch { return false; } }

async function pushCloud() {
  if (!FB.online) throw new Error('offline');
  await FB.f.setDoc(FB.f.doc(FB.fs, 'users', FB.uid), { settings }, { merge: true });
}

// Load precedence:
//   • unsynced local edits (pending) always win, and get flushed up.
//   • otherwise the cloud copy is the source of truth (new device / sync).
//   • otherwise whatever is on this device.
export async function loadSettings() {
  const local = readLocal();
  const pending = hasPending();
  let cloud = null;
  if (FB.online) {
    try {
      const snap = await FB.f.getDoc(FB.f.doc(FB.fs, 'users', FB.uid));
      if (snap.exists()) cloud = snap.data().settings || null;
    } catch { /* stay with local */ }
  }
  let merged;
  if (pending || !cloud) merged = local || cloud;
  else merged = { ...(local || {}), ...cloud, binds: { ...((local && local.binds) || {}), ...(cloud.binds || {}) } };
  Object.assign(settings, normalize(merged));
  writeLocal();
  if (FB.online && (pending || !cloud)) {
    try { await pushCloud(); clearPending(); } catch { markPending(); }
  } else if (pending) {
    // couldn't reach cloud but keep the flag so a later save flushes it
    markPending();
  }
  return settings;
}

let cloudTimer = null;
export function saveSettings() {
  writeLocal();                       // always instant + offline-safe
  if (!FB.online) { markPending(); return; }
  clearTimeout(cloudTimer);
  cloudTimer = setTimeout(() => {
    pushCloud().then(clearPending).catch(markPending);
  }, 500);
}

// call when the network comes back (window 'online') to drain the outbox
export async function flushSettingsOutbox() {
  if (FB.online && hasPending()) {
    try { await pushCloud(); clearPending(); } catch { /* stay pending */ }
  }
}

export function resetBinds() {
  settings.binds = { ...DEFAULT_BINDS };
  saveSettings();
}
