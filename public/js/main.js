// ============================================================
// זירת האש · STARSHARDS ARENA — application orchestration
// boot → menu → lobby (map/bots options) → 3D match → results
// ============================================================

import {
  GAME, MAP_ORDER, RP_BY_PLACE, rewardsGunGame, rewardsTeam, QUICK_CHAT,
  CTF, TACTICAL, BR, ZONEWARS, BUILDDM, BOXFIGHT, rewardsZombies, rewardsBr,
  DANCES, SKINS, SKIN_ORDER,
} from './config.js';
import { t } from './i18n.js';
import { FB, initFirebase, signInWithGoogle, signOutGoogle, isGoogleUser } from './fb.js';
import {
  profile, loadProfile, playerLevel, setName, claimDaily, applyRewards, fetchLeaderboard,
  trackChallenges, saveProfile, isAdmin, applyAdminUnlocks, currentPickaxeStyle,
} from './profile.js';
import { Input } from './input.js';
import { Game } from './game.js';
import { createRenderer } from './world.js';
import { Room } from './net.js';
import { attachBrains, botName } from './bots.js';
import {
  SFX, unlockAudio, setSoundEnabled, soundEnabled,
  startMusic, stopMusic, setMusicEnabled, musicEnabled,
  setSfxVolume, setMusicVolume,
} from './audio.js';
import { settings, loadSettings, saveSettings, flushSettingsOutbox } from './settings.js';
import { gamepad } from './gamepad.js';
import { LobbyStage } from './lobbystage.js';
import {
  ensureFriendCode, addFriendByCode, removeFriend, refreshFriendProfiles,
  setPresence, watchFriends, sendInvite, clearInvite, watchInvites,
  grantByCode, grantToUid, applyPendingGrants,
  watchFriendAdds, addFriendBack, clearFriendAdd,
} from './social.js';
import * as UI from './ui.js';

const $ = UI.$;

const state = {
  input: null,
  renderer: null,
  game: null,
  room: null,
  raf: 0,
  lastTs: 0,
  lastEntry: null,          // {mode, online}
  lobbyTimer: 0,
  matchStarted: false,
  practice: { mode: 'gungame', map: 'town', botLevel: 'normal', botCount: 3 },
};

// never let a slow/hung network call trap us on the loading screen
function withTimeout(promise, ms, fallback) {
  return Promise.race([
    Promise.resolve(promise).catch((e) => { console.warn('boot step failed', e); return fallback; }),
    new Promise((res) => setTimeout(() => res(fallback), ms)),
  ]);
}

// ---------------- boot ----------------
async function boot() {
  // whatever happens below, guarantee we reach the menu within 12s
  const failSafe = setTimeout(() => {
    if (!$('scr-menu').classList.contains('active')) {
      console.warn('boot fail-safe: forcing menu');
      try { finishBoot(false); } catch (e) { console.error(e); UI.showScreen('menu'); }
    }
  }, 10000);

  try {
    document.addEventListener('pointerdown', () => {
      unlockAudio();
      if (!state.game) startMusic('menu');
    }, { once: true });

    UI.setLoadStatus(t('connecting'));
    const online = await withTimeout(initFirebase(), 5000, false);
    UI.setLoadStatus(t('loading'));
    await withTimeout(loadProfile(), 4000, null);   // Firestore getDoc can hang → cap it
    if (isAdmin()) applyAdminUnlocks();              // god-mode for the admin account
    await withTimeout(applyPendingGrants(), 3000, 0); // apply gifts from the admin
    await withTimeout(loadSettings(), 3000, null);  // controls: local first, then cloud
    applyLoadedSettings();
    clearTimeout(failSafe);
    finishBoot(online);
  } catch (e) {
    console.error('boot error', e);
    clearTimeout(failSafe);
    finishBoot(false);
  }
}

let _booted = false;
function finishBoot(online) {
  if (_booted) return;
  _booted = true;

  UI.setConn(online);
  if (!online) UI.toast(t('offlineMode'));

  if (!state.input) {
    state.input = new Input();
    state.input.attach({
      canvas: $('game-canvas'),
      zoneL: $('zone-left'),
      zoneR: $('zone-right'),
    });
    state.input.applySettings(settings);
    state.input.onCycleWeapon = (dir) => state.game?.cycleSlot(dir);
    state.input.onSelectSlot = (i) => state.game?.selectSlot(i);
    state.input.onCycleMaterial = (dir) => state.game?.cycleMaterial(dir);
    state.input.onSelectMaterial = (m) => state.game?.setMaterial(m);
    state.input.onBuy = (item) => state.game?.tacBuy(item);
    state.input.onEditPreset = (i) => state.game?.applyEditPreset(i);
    UI.bindHUD(state.input, {
      onExit: exitMatch,
      onChat: (idx) => { state.input.wantChat = idx; },
      onSettings: pauseForSettings,
      onSaveMap: () => saveCreativeMap(state.game),
      onLoadMap: () => loadCreativeMap(state.game),
      onClearMap: () => { state.game?.clearBuilds(); UI.toast(t('mapCleared')); },
    });
    state.renderer = createRenderer($('game-canvas'));
    window.addEventListener('resize', fitRenderer);
    // re-frame the home lineup on rotate/resize (slot count is aspect-aware)
    window.addEventListener('resize', () => {
      if (!state.game && $('scr-menu').classList.contains('active')) renderHome();
    });
    wireMenu();

    // physical controller: drives gameplay in a match, menu navigation otherwise
    gamepad.bind(state.input);
    gamepad.inMatch = () => !!state.game && state.input.enabled;
    gamepad.buyUi = UI.buyMenuCtl;   // tactical buy panel controls
    gamepad.doBack = handleGamepadBack;
    gamepad.onConnect = () => UI.updatePadStatus();
    gamepad.onFirstInput = () => { unlockAudio(); if (!state.game) startMusic('menu'); };
    gamepad.start();

    // drain any settings queued while offline once the network returns
    window.addEventListener('online', () => { flushSettingsOutbox(); });
  }

  UI.refreshMenu();
  const daily = claimDaily();
  UI.showScreen('menu');
  renderHome();
  if (daily) UI.toast(t('daily', { n: daily }), 'gold');

  // google account button
  if (online) {
    $('btn-google').classList.remove('hidden');
    refreshGoogleBtn();
    $('btn-google').addEventListener('click', onGoogleClick);
  }

  // admin panel button — only for the admin account
  $('btn-admin').classList.toggle('hidden', !isAdmin());

  // radial emote-wheel controls (hub + paging arrows) — works in lobby & match
  UI.initEmoteWheel();

  // social: my code + presence + incoming invites
  if (online) {
    ensureFriendCode();
    setPresence('menu');
    watchInvites((fromUid, inv) => {
      if (state.game) { return; }              // mid-match: leave it pending
      UI.showInviteBanner(inv.name || '?',
        () => { clearInvite(fromUid); joinRoomByCode(inv.room); },
        () => clearInvite(fromUid));
    });
    // someone added you as a friend → toast + one-tap add-back
    watchFriendAdds((fromUid, info) => {
      const name = info.name || '???';
      UI.toast(t('frAddedYou', { name }), 'gold');
      if (!(profile.friends && profile.friends[fromUid])) {
        UI.showInviteBanner(t('frAddBack', { name }),
          () => { addFriendBack(fromUid, name); clearFriendAdd(fromUid); UI.toast(t('frAdded', { name }), 'gold'); },
          () => clearFriendAdd(fromUid));
      } else {
        clearFriendAdd(fromUid);
      }
    });
  }

  // deep-link: ?room=CODE → auto-join a friend's room
  const roomCode = new URLSearchParams(location.search).get('room');
  if (roomCode) {
    history.replaceState(null, '', location.pathname);   // clean the URL
    joinRoomByCode(roomCode.trim().toUpperCase());
  }
}

// ---------------- google account ----------------
function refreshGoogleBtn() {
  const signed = isGoogleUser();
  $('btn-admin').classList.toggle('hidden', !isAdmin());
  // compact chip: green ✓ ring when signed in, plain Google mark otherwise
  const g = $('btn-google');
  g.classList.toggle('signed', signed);
  g.title = signed
    ? `✓ ${FB.user.displayName || FB.user.email || 'Google'} · ${t('googleSignOut')}`
    : t('googleSignIn');
}

async function onGoogleClick() {
  SFX.click();
  if (isGoogleUser()) {
    // sign out → reload as a fresh guest
    await signOutGoogle();
    location.reload();
    return;
  }
  const res = await signInWithGoogle();
  if (!res.ok) {
    if (res.reason !== 'auth/popup-closed-by-user' && res.reason !== 'auth/cancelled-popup-request') {
      UI.toast(t('googleFail'), 'red');
    }
    return;
  }
  if (res.mode === 'linked') {
    // same uid — all progress kept, now backed by the Google account
    UI.toast(t('googleLinked'), 'gold');
    if (isAdmin()) { applyAdminUnlocks(); UI.toast('👑 מצב אדמין הופעל', 'gold'); }
    saveProfile();
    refreshGoogleBtn();
    UI.refreshMenu();
  } else {
    // switched to an existing Google-owned player → boot fresh for that uid
    UI.toast(t('googleSwitched'), 'gold');
    setTimeout(() => location.reload(), 900);
  }
}

// B button in the menus → click whatever "back / leave" action the active
// screen offers, so the whole UI is escapable with the controller alone
function handleGamepadBack() {
  const scr = document.querySelector('.screen.active');
  if (!scr) return;
  const back = scr.querySelector(
    '#btn-back-settings, #btn-back-shop, #btn-back-board, #btn-back-friends, #btn-leave-lobby, #btn-menu',
  );
  if (back) { SFX.click(); back.click(); }
}

async function joinRoomByCode(code) {
  if (!code) return;
  if (!FB.online) { UI.toast(t('onlineNeedsFirebase'), 'red'); return; }
  if (state.room) { await state.room.leave(); state.room = null; state._partyPlayers = null; }
  UI.toast(t('joiningRoom'));
  try {
    const room = await Room.joinByCode(code, lobbyInfo());
    attachParty(room);
    showHome();
  } catch (e) {
    UI.toast(t(e.message === 'roomNotFound' ? 'roomNotFound' : 'joinFailed'), 'red');
  }
}

function fitRenderer() {
  const c = $('game-canvas');
  // pixel-ratio cap follows the quality setting (phones cap harder on high)
  const cap = settings.quality === 'low' ? 1
    : settings.quality === 'medium' ? 1.25
    : state.input?.touchMode ? 1.5 : 2;
  state.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap));
  state.renderer.setSize(c.clientWidth, c.clientHeight, false);
  if (state.game) {
    state.game.camera.aspect = c.clientWidth / c.clientHeight;
    state.game.camera.updateProjectionMatrix();
  }
}

function wireMenu() {
  // ---- home = lobby ----
  $('home-mode-card').addEventListener('click', () => {
    if (state.room && !state.room.isHost) return;   // only the party host picks the mode
    SFX.click();
    UI.openModePopover(state.practice.mode, (m) => setHomeMode(m));
  });
  $('btn-mode-close').addEventListener('click', () => { SFX.click(); UI.closeModePopover(); });
  // click on the dark backdrop (outside the panel) closes any popover
  for (const pop of document.querySelectorAll('.mode-popover')) {
    pop.addEventListener('click', (e) => { if (e.target === pop) pop.classList.add('hidden'); });
  }
  $('home-cfg').addEventListener('click', () => { SFX.click(); openHomeOpts(); });
  $('btn-mode-opts-close').addEventListener('click', () => { SFX.click(); $('mode-opts-popover').classList.add('hidden'); });
  $('home-play').addEventListener('click', () => { SFX.click(); onPlay(); });
  $('home-dance').addEventListener('click', () => {
    SFX.click();
    const w = $('emote-wheel');
    if (w.classList.contains('hidden')) {
      UI.buildEmoteWheel((idx) => {
        state.lobbyStage?.dance(idx);
        // lobby dances auto-stop after a few seconds (back to idle sway)
        clearTimeout(state._lobbyDanceT);
        state._lobbyDanceT = setTimeout(() => state.lobbyStage?.dance(-1), 6000);
      });
      w.classList.remove('hidden');
    } else {
      w.classList.add('hidden');
    }
  });
  $('btn-leave-party').addEventListener('click', () => { SFX.click(); leaveParty(); });
  $('btn-chall').addEventListener('click', () => { SFX.click(); UI.refreshMenu(); $('chall-popover').classList.remove('hidden'); });
  $('btn-chall-close').addEventListener('click', () => { SFX.click(); $('chall-popover').classList.add('hidden'); });
  $('btn-join').addEventListener('click', () => {
    SFX.click();
    if (!FB.online) { UI.toast(t('onlineNeedsFirebase'), 'red'); return; }
    const code = prompt(t('roomCodePrompt'));
    if (code) joinRoomByCode(code.trim().toUpperCase());
  });

  $('btn-shop').addEventListener('click', () => { SFX.click(); openLocker('skins'); });
  $('btn-back-shop').addEventListener('click', () => { SFX.click(); UI.stopShopPreview(); showHome(); });

  // ---- top navigation tabs (Fortnite-style) ----
  const navHome = (which) => {
    UI.closeEmoteWheel();
    if (which === 'play') { showHome(); }
    else if (which === 'locker') openLocker('skins');
    else if (which === 'shop') openLocker('shop');
    else if (which === 'chall') { state.lobbyStage?.stop(); UI.refreshMenu(); $('chall-popover').classList.remove('hidden'); }
    else if (which === 'board') $('btn-board').click();
  };
  for (const b of document.querySelectorAll('.home-tab')) {
    b.addEventListener('click', () => {
      SFX.click();
      for (const x of document.querySelectorAll('.home-tab')) x.classList.toggle('sel', x === b);
      navHome(b.dataset.nav);
    });
  }

  // ---- admin grants panel (visible only to the admin account) ----
  let adminGrant = 'none';      // quick-pack: none|dances|skins|all
  let adminTargetUid = '';      // chosen from friend tiles (preferred)
  let adminDanceId = '';        // specific dance tile
  let adminSkinId = '';         // specific skin tile

  // build the gamey tile pickers once (icons, not dropdowns)
  const dTiles = $('admin-dance-tiles'), sTiles = $('admin-skin-tiles');
  for (const d of DANCES) {
    const b = document.createElement('button');
    b.className = 'admin-tile'; b.dataset.id = d.id;
    b.innerHTML = `<span class="at-emoji">${d.icon}</span><span class="at-name">${d.name}</span>`;
    b.addEventListener('click', () => {
      SFX.click();
      adminDanceId = adminDanceId === d.id ? '' : d.id;
      for (const x of dTiles.children) x.classList.toggle('sel', x.dataset.id === adminDanceId);
    });
    dTiles.appendChild(b);
  }
  for (const id of SKIN_ORDER) {
    const b = document.createElement('button');
    b.className = 'admin-tile'; b.dataset.id = id;
    b.innerHTML = `<span class="at-emoji">🎽</span><span class="at-name">${t('skin_' + id)}</span>`;
    b.addEventListener('click', () => {
      SFX.click();
      adminSkinId = adminSkinId === id ? '' : id;
      for (const x of sTiles.children) x.classList.toggle('sel', x.dataset.id === adminSkinId);
    });
    sTiles.appendChild(b);
  }

  const setAdminTarget = (uid, name) => {
    adminTargetUid = uid;
    $('admin-target-name').textContent = name ? ` ${name}` : '—';
  };
  const renderAdminFriends = () => {
    const wrap = $('admin-friend-list');
    wrap.innerHTML = '';
    const friends = Object.entries(profile.friends || {});
    if (!friends.length) { wrap.innerHTML = '<span class="af-empty">אין חברים עדיין — השתמש בקוד ידני</span>'; return; }
    for (const [uid, f] of friends) {
      const b = document.createElement('button');
      b.className = 'admin-friend' + (uid === adminTargetUid ? ' sel' : '');
      b.textContent = f.name || '???';
      b.addEventListener('click', () => {
        SFX.click();
        setAdminTarget(uid, f.name);
        $('admin-code').value = '';
        for (const x of wrap.children) x.classList.toggle('sel', x === b);
      });
      wrap.appendChild(b);
    }
  };

  $('btn-admin').addEventListener('click', () => {
    SFX.click();
    closeDrawer();
    setAdminTarget('', '');
    renderAdminFriends();
    $('admin-popover').classList.remove('hidden');
  });
  $('btn-admin-close').addEventListener('click', () => { SFX.click(); $('admin-popover').classList.add('hidden'); });

  // manual code entry clears the friend selection
  $('admin-code').addEventListener('input', () => { if ($('admin-code').value) setAdminTarget('', ''); renderAdminFriends(); });

  // shard quick-chips
  for (const b of document.querySelectorAll('#admin-popover .chip-pick')) {
    b.addEventListener('click', () => { SFX.click(); $('admin-shards').value = b.dataset.shards; });
  }
  for (const b of document.querySelectorAll('#admin-popover .admin-pick')) {
    b.addEventListener('click', () => {
      SFX.click();
      adminGrant = b.dataset.grant;
      for (const x of document.querySelectorAll('#admin-popover .admin-pick')) x.classList.toggle('sel', x === b);
    });
  }
  $('btn-admin-grant').addEventListener('click', async () => {
    SFX.click();
    const shards = Math.max(0, parseInt($('admin-shards').value, 10) || 0);
    const grant = { shards };
    if (adminGrant === 'all') { grant.all = true; }
    else if (adminGrant === 'dances') { grant.dances = 'all'; }
    else if (adminGrant === 'skins') { grant.skins = 'all'; }
    else {
      if (adminDanceId) grant.dances = [adminDanceId];
      if (adminSkinId) grant.skins = [adminSkinId];
    }
    if (!grant.all && !grant.dances && !grant.skins && !shards) { UI.toast('בחר מה להעניק', 'red'); return; }

    // prefer the picked friend (uid); fall back to a manual code
    let res;
    if (adminTargetUid) res = await grantToUid(adminTargetUid, grant);
    else {
      const code = $('admin-code').value.trim().toUpperCase();
      if (!code) { UI.toast('בחר חבר או הזן קוד', 'red'); return; }
      res = await grantByCode(code, grant);
    }
    if (res.ok) { UI.toast('✓ הוענק בהצלחה', 'gold'); $('admin-popover').classList.add('hidden'); }
    else if (res.reason === 'notFound') UI.toast('לא נמצא', 'red');
    else if (res.reason === 'self') UI.toast('זה החשבון שלך', 'red');
    else if (res.reason === 'denied') UI.toast('אין הרשאה (עדכן חוקי DB)', 'red');
    else UI.toast('נדרש חיבור', 'red');
  });

  $('btn-board').addEventListener('click', async () => {
    SFX.click();
    state.lobbyStage?.stop();
    UI.showScreen('board');
    UI.renderBoard(FB.online ? [] : null, FB.uid);
    if (FB.online) UI.renderBoard(await fetchLeaderboard() || [], FB.uid);
  });
  $('btn-back-board').addEventListener('click', () => { SFX.click(); showHome(); });

  // ---- side drawer (friends + navigation) ----
  $('btn-drawer-open').addEventListener('click', () => { SFX.click(); openDrawer(); });
  $('btn-drawer-close').addEventListener('click', () => { SFX.click(); closeDrawer(); });
  $('drawer-scrim').addEventListener('click', () => closeDrawer());
  // any nav button inside the drawer also closes it
  for (const b of document.querySelectorAll('#side-drawer .drawer-nav .drawer-btn')) {
    b.addEventListener('click', () => closeDrawer());
  }
  $('drawer-add-friend').addEventListener('click', async () => {
    SFX.click();
    const res = await addFriendByCode($('drawer-friend-input').value);
    if (res.ok) {
      $('drawer-friend-input').value = '';
      UI.toast(t('frAdded', { name: res.name }), 'gold');
      renderDrawerFriends();
    } else {
      UI.toast(t(res.reason === 'notFound' ? 'frNotFound' : res.reason === 'self' ? 'frSelf'
        : res.reason === 'dup' ? 'frDup' : 'frNeedOnline'), 'red');
    }
  });

  // topbar friend-code: copy + share
  $('btn-code-copy').addEventListener('click', async () => {
    SFX.click();
    const code = ensureFriendCode();
    try { await navigator.clipboard.writeText(code); UI.toast(t('frCodeCopied')); }
    catch { UI.toast(code, 'gold'); }
  });
  $('btn-code-share').addEventListener('click', async () => {
    SFX.click();
    const code = ensureFriendCode();
    const text = `בוא לשחק איתי ב-Fabels! הקוד שלי: ${code}\nhttps://fabels-70545.web.app`;
    try {
      if (navigator.share) await navigator.share({ title: 'Fabels', text });
      else { await navigator.clipboard.writeText(text); UI.toast(t('frCodeCopied')); }
    } catch { /* user cancelled share */ }
  });

  // legacy friends screen back button (kept for safety)
  $('btn-back-friends')?.addEventListener('click', () => { SFX.click(); stopFriendsWatch(); showHome(); });
  $('btn-copy-code')?.addEventListener('click', async () => {
    SFX.click();
    try { await navigator.clipboard.writeText(profile.friendCode || ''); UI.toast(t('frCodeCopied')); }
    catch { UI.toast(profile.friendCode || '', 'gold'); }
  });

  $('menu-name-input').addEventListener('change', (e) => {
    if (setName(e.target.value)) UI.toast(t('nameSaved'));
    UI.refreshMenu();
    renderHome();
  });

  $('btn-menu').addEventListener('click', () => { SFX.click(); showHome(); });
  $('btn-again').addEventListener('click', () => {
    SFX.click();
    const e = state.lastEntry;
    if (e) state.practice.mode = e.mode;
    showHome();
  });

  $('btn-sound').addEventListener('click', () => {
    setSoundEnabled(!soundEnabled());
    settings.sound = soundEnabled();
    $('btn-sound').textContent = soundEnabled() ? '🔊' : '🔇';
    $('btn-sound').classList.toggle('off', !soundEnabled());
    saveSettings();
    SFX.click();
  });
  $('btn-music').addEventListener('click', () => {
    setMusicEnabled(!musicEnabled());
    settings.music = musicEnabled();
    $('btn-music').classList.toggle('off', !musicEnabled());
    if (musicEnabled()) startMusic(state.game ? 'battle' : 'menu');
    saveSettings();
    SFX.click();
  });

  // settings / controls screen
  $('btn-settings').addEventListener('click', () => {
    SFX.click();
    state.lobbyStage?.stop();
    UI.renderSettings(() => state.input?.applySettings(settings), applyDisplaySettings);
    UI.showScreen('settings');
  });
  $('btn-back-settings').addEventListener('click', () => {
    SFX.click();
    if (state.input) state.input.applySettings(settings);
    gamepad.clearFocus();
    if (state.paused) resumeFromSettings();   // opened mid-match → resume
    else showHome();
  });
}

// ---------------- friends screen flow ----------------
let friendsUnsub = null;
function stopFriendsWatch() { if (friendsUnsub) { friendsUnsub(); friendsUnsub = null; } }

const friendsCtl = {
  onJoin: (code) => { closeDrawer(); joinRoomByCode(code); },
  onRemove: (uid) => { removeFriend(uid); renderDrawerFriends(); },
};

let drawerPres = {};
function renderDrawerFriends() {
  UI.renderFriendsList(drawerPres, friendsCtl, 'drawer-friends-list');
}

// Fortnite-style side drawer: friends live-list + navigation
function openDrawer() {
  UI.closeEmoteWheel();           // don't leave the wheel hanging behind the drawer
  state.lobbyStage?.stop?.();     // pause the 3D stage while the drawer is up (perf)
  UI.renderFriendCode(ensureFriendCode());
  $('side-drawer').classList.remove('hidden');
  renderDrawerFriends();
  if (FB.online) {
    stopFriendsWatch();
    friendsUnsub = watchFriends((p) => { drawerPres = p; renderDrawerFriends(); });
    refreshFriendProfiles().then(renderDrawerFriends);
  }
}
function closeDrawer() {
  $('side-drawer').classList.add('hidden');
  stopFriendsWatch();
  // only resume the 3D stage if we're still on the home screen (a nav button
  // may have taken us elsewhere, which manages the stage itself)
  if ($('scr-menu').classList.contains('active')) state.lobbyStage?.start?.();
}

// push the loaded control/audio settings into the live systems
function applyLoadedSettings() {
  setSoundEnabled(settings.sound);
  setMusicEnabled(settings.music);
  setSfxVolume(settings.sfxVol);
  setMusicVolume(settings.musicVol);
  $('btn-sound').textContent = settings.sound ? '🔊' : '🔇';
  $('btn-sound').classList.toggle('off', !settings.sound);
  $('btn-music').classList.toggle('off', !settings.music);
  state.input?.applySettings(settings);
  applyDisplaySettings();
}

// FOV + graphics quality — safe to call any time, applies live where possible
function applyDisplaySettings() {
  if (state.game) state.game.baseFov = settings.fov;
  if (state.renderer) {
    const wantShadows = settings.quality !== 'low';
    if (state.renderer.shadowMap.enabled !== wantShadows) {
      state.renderer.shadowMap.enabled = wantShadows;
      // force a material refresh so a live scene picks the change up
      state.game?.scene?.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
    }
    fitRenderer();
  }
}

const lobbyInfo = () => ({ name: profile.name, skin: profile.skin, lvl: playerLevel() });

// ═══════════ HOME = the lobby (Fortnite-style) ═══════════
// The 3D lineup stage lives on the home screen. Solo players see just their
// own character (no network). Inviting a friend lazily spins up a "party"
// room; friends fill the slots. PLAY launches the selected mode — offline
// with bots when solo, online for the whole party.
function homeStage() {
  if (!state.lobbyStage) state.lobbyStage = new LobbyStage($('home-stage'));
  return state.lobbyStage;
}

export function showHome() {
  UI.closeModePopover();
  UI.closeEmoteWheel();
  $('mode-opts-popover').classList.add('hidden');
  UI.refreshMenu();
  UI.showScreen('menu');
  renderHome();
}

// open the full-screen locker on a given sub-tab (skins|dances|pickaxes|shop)
function openLocker(tab = 'skins') {
  state.lobbyStage?.stop();
  UI.closeEmoteWheel();
  UI.renderShop();
  UI.setLockerTab(tab);
  UI.showScreen('shop');
}

function renderHome() {
  const pr = state.practice;
  const room = state.room;
  const mode = room ? room.mode : pr.mode;
  const isHost = !room || room.isHost;
  UI.setLobbyModeCard(mode, isHost);            // guests can't change the mode
  UI.renderFriendCode(ensureFriendCode());      // show my code in the topbar

  // characters on stage
  let players, max;
  if (room && state._partyPlayers && state._partyPlayers.length) {
    players = state._partyPlayers.map((p) => ({ name: p.name, skin: p.skin, me: p.uid === FB.uid }));
    max = (room.meta && room.meta.maxPlayers) || 6;
  } else {
    players = [{ name: profile.name, skin: profile.skin, me: true }];
    max = 4;
  }
  // portrait phones: no empty pads (keep your character big); wide screens
  // show up to 6 slots with friend pads
  const portrait = window.innerHeight > window.innerWidth * 1.15;
  const slots = portrait
    ? Math.min(players.length, 4)
    : Math.min(Math.max(4, players.length), Math.max(4, max), 6);
  homeStage().setPlayers(players.map((p) => ({
    name: p.name || '?', skin: p.skin || (p.me ? profile.skin : 'scout'),
    me: !!p.me, face: p.me ? profile.facePhoto : undefined,
  })), slots);
  homeStage().start();

  // party code + leave button
  $('home-code').classList.toggle('hidden', !room);
  if (room) $('home-code').textContent = t('roomCode', { code: room.id });
  $('btn-leave-party').classList.toggle('hidden', !room);

  // PLAY button + status (guests wait for the host to launch)
  const playBtn = $('home-play');
  if (room && !isHost) {
    playBtn.disabled = true;
    $('home-status').textContent = t('frWaitHost');
  } else {
    playBtn.disabled = false;
    $('home-status').textContent = room ? t('partySize', { n: players.length }) : '';
  }
  updateHomeInvites();
}

// online-friends invite chips over the stage
let homeInvitesUnsub = null;
function updateHomeInvites() {
  if (homeInvitesUnsub) { homeInvitesUnsub(); homeInvitesUnsub = null; }
  const wrap = $('home-party-invite');
  if (!FB.online) { wrap.classList.add('hidden'); return; }
  homeInvitesUnsub = watchFriends((pres) => UI.renderLobbyFriends(pres, {
    onInvite: async (uid) => {
      const room = await ensureParty();
      if (room) { sendInvite(uid, room.id); UI.toast(t('frInviteSent')); }
    },
  }));
}

// select a game mode from the floating picker
function setHomeMode(mode) {
  state.practice.mode = mode;
  state.lastEntry = { mode, online: !!state.room };
  UI.closeModePopover();
  if (state.room && state.room.isHost) state.room.setOptions({ mode });
  renderHome();
}

// per-mode settings popover (map / bots / player cap)
function openHomeOpts() {
  const pr = state.practice;
  const room = state.room;
  const mode = room ? room.mode : pr.mode;
  const m = room ? (room.meta || {}) : pr;
  const cap = mode === 'duel' ? 2 : 12;
  const canPick = !room || room.isHost;
  $('mode-opts-title').textContent = `⚙️ ${t('mode_' + mode)}`;
  UI.renderLobbyOptions({
    map: m.map || pr.map, botLevel: m.botLevel || pr.botLevel, botCount: m.botCount ?? pr.botCount,
    showBots: mode !== 'zombies' && mode !== 'duel' && mode !== 'creative',
    maxPlayers: room && mode !== 'duel'
      ? { value: m.maxPlayers || 6, options: [2, 3, 4, 6, 8, 10, 12].filter((n) => n <= cap) } : null,
    privacy: null,                              // parties are invite-only
    canPick,
    onPick: (patch) => {
      if (room && room.isHost) room.setOptions(patch);
      else Object.assign(pr, patch);
      openHomeOpts();
      renderHome();
    },
  });
  $('mode-opts-popover').classList.remove('hidden');
}

// PLAY: party host launches for everyone; solo runs offline with bots (no net)
function onPlay() {
  const room = state.room;
  if (room) {
    if (room.isHost) room.startMatch();
    else UI.toast(t('frWaitHost'));
    return;
  }
  state.lastEntry = { mode: state.practice.mode, online: false };
  startOffline();
}

// lazily create the party room the first time you invite / a friend joins
async function ensureParty() {
  if (state.room) return state.room;
  if (!FB.online) { UI.toast(t('onlineNeedsFirebase'), 'red'); return null; }
  const pr = state.practice;
  try {
    const room = await Room.createParty(pr.mode, lobbyInfo(), {
      map: pr.map, botLevel: pr.botLevel, botCount: pr.botCount, maxPlayers: pr.maxPlayers,
    });
    attachParty(room);
    return room;
  } catch (e) { console.warn(e); UI.toast(t('netError'), 'red'); return null; }
}

// wire a party room's callbacks to the home screen
function attachParty(room) {
  state.room = room;
  state.matchStarted = false;
  state.lastEntry = { mode: room.mode, online: true };
  room.onConnState = (ok) => UI.toast(t(ok ? 'connBack' : 'connLost'), ok ? 'gold' : 'red');
  setPresence('lobby', room.id);
  room.onLobby = (players) => {
    if (state.matchStarted) return;
    state._partyPlayers = players;
    renderHome();
    const meta = room.meta || {};
    if (room.isHost && meta.state === 'waiting') {
      const capN = room.mode === 'duel' ? 2 : (meta.maxPlayers || 6);
      if (players.length >= capN) room.startMatch();
    }
  };
  room.onMeta = (meta) => {
    if (state.matchStarted || !meta) return;
    if (meta.state === 'starting' && meta.startAt) {
      clearInterval(state.lobbyTimer);
      state.lobbyTimer = setInterval(() => {
        const left = (meta.startAt - FB.serverNow()) / 1000;
        if (left <= 0) { clearInterval(state.lobbyTimer); beginOnlineMatch(); }
        else { UI.setLobbyCountdown(left); if (left < 3.5) SFX.countdown(); }
      }, 250);
    } else {
      renderHome();
    }
  };
  room._emitLobby();
  if (room.meta) room.onMeta(room.meta);
}

async function leaveParty() {
  clearInterval(state.lobbyTimer);
  if (homeInvitesUnsub) { homeInvitesUnsub(); homeInvitesUnsub = null; }
  if (state.room) { await state.room.leave(); state.room = null; }
  state._partyPlayers = null;
  setPresence('menu');
  renderHome();
}

// ---------------- creative: save / load my island ----------------
function saveCreativeMap(game, silent) {
  if (!game?.isCreative) return;
  profile.myMap = JSON.stringify({ map: game.mapId, b: game.exportBuilds() });
  saveProfile();
  if (!silent) UI.toast(t('mapSaved'), 'gold');
}

function loadCreativeMap(game, silent) {
  if (!game?.isCreative || !profile.myMap) return;
  try {
    const m = JSON.parse(profile.myMap);
    const n = game.importBuilds(m.b);
    if (!silent && n) UI.toast(t('mapLoaded', { n }));
  } catch { /* corrupt save — ignore */ }
}

// ---------------- match setup ----------------
const endAtFor = (mode, startAt) =>
  mode === 'team' ? startAt + GAME.matchTimeTeam * 1000
    : mode === 'ctf' ? startAt + CTF.timeSec * 1000
    : mode === 'builddm' ? startAt + BUILDDM.timeSec * 1000
    : mode === 'boxfight' ? startAt + BOXFIGHT.timeSec * 1000
    : 0;

function beginOnlineMatch() {
  if (state.matchStarted || !state.room) return;
  state.matchStarted = true;
  const room = state.room;
  const meta = room.meta;
  const order = room.playerOrder();
  const myIdx = Math.max(0, order.indexOf(FB.uid));

  const game = new Game({
    mode: room.mode,
    online: true,
    isHost: room.isHost,
    mapId: meta.map || 'town',
    botLevel: meta.botLevel || 'normal',
    input: state.input,
    timeFn: () => FB.serverNow(),
    startAt: meta.startAt,
    endAt: endAtFor(room.mode, meta.startAt),
    myFace: profile.facePhoto || null,
    myPickaxe: currentPickaxeStyle(),
    baseFov: settings.fov,
  });

  // CTF / tactical: humans alternate red/blue by join order
  const myTeam = (room.mode === 'ctf' || room.mode === 'tactical') ? (myIdx % 2 === 0 ? 'r' : 'b') : 'p';
  game.addLocal(FB.uid, profile.name, profile.skin, myIdx, myTeam);

  if (room.isHost) {
    const lvl = meta.botLevel || 'normal';
    const wantBots = (meta.botCount ?? 4) > 0;   // botCount 0 = friends only
    if (room.mode === 'team') {
      for (let i = 0; i < (meta.botCount ?? 4); i++) game.addBot(botName(i), lvl);
    } else if (room.mode === 'ctf' && wantBots) {
      const humansR = order.filter((_, i) => i % 2 === 0).length;
      const humansB = order.length - humansR;
      for (let i = humansR; i < CTF.teamSize; i++) game.addBot(botName(i), lvl, -1, 'r');
      for (let i = humansB; i < CTF.teamSize; i++) game.addBot(botName(i + 3), lvl, -1, 'b');
    } else if (room.mode === 'tactical' && wantBots) {
      const humansR = order.filter((_, i) => i % 2 === 0).length;
      const humansB = order.length - humansR;
      for (let i = humansR; i < TACTICAL.teamSize; i++) game.addBot(botName(i), lvl, -1, 'r');
      for (let i = humansB; i < TACTICAL.teamSize; i++) game.addBot(botName(i + 3), lvl, -1, 'b');
    } else if ((room.mode === 'br' || room.mode === 'zonewars') && wantBots) {
      const total = (room.mode === 'zonewars' ? ZONEWARS : BR).combatants;
      for (let i = order.length; i < total; i++) game.addBot(botName(i), lvl);
    }
    attachBrains(game);
  }

  room.onGameOver((results) => finishMatch(results));
  room.bindGame(game);
  if (room.isHost) game.spawnBrLoot();
  // creative online: the host restores their island; builds sync to everyone
  if (room.mode === 'creative' && room.isHost) loadCreativeMap(game, true);
  if (homeInvitesUnsub) { homeInvitesUnsub(); homeInvitesUnsub = null; }
  setPresence('match', room.id);
  startLoop(game);
  SFX.go();
}

function startOffline() {
  const pr = state.practice;
  const mode = pr.mode || 'gungame';
  const now = Date.now();
  const game = new Game({
    mode,
    online: false,
    isHost: true,
    mapId: pr.map,
    botLevel: pr.botLevel,
    input: state.input,
    timeFn: () => Date.now(),
    startAt: now,
    endAt: endAtFor(mode, now),
    myFace: profile.facePhoto || null,
    myPickaxe: currentPickaxeStyle(),
    baseFov: settings.fov,
  });

  const myTeam = (mode === 'ctf' || mode === 'tactical') ? 'r' : 'p';
  game.addLocal('me', profile.name, profile.skin, 0, myTeam);

  if (mode === 'duel') {
    game.addBot(botName(0), 'hard');
  } else if (mode === 'ctf') {
    const fill = pr.botCount > 0;
    if (fill) {
      for (let i = 1; i < CTF.teamSize; i++) game.addBot(botName(i), pr.botLevel, -1, 'r');
      for (let i = 0; i < CTF.teamSize; i++) game.addBot(botName(i + 3), pr.botLevel, -1, 'b');
    }
  } else if (mode === 'tactical') {
    // always fill both teams so rounds can play out (min 1 enemy)
    for (let i = 1; i < TACTICAL.teamSize; i++) game.addBot(botName(i), pr.botLevel, -1, 'r');
    for (let i = 0; i < TACTICAL.teamSize; i++) game.addBot(botName(i + 3), pr.botLevel, -1, 'b');
  } else if (mode === 'br' || mode === 'zonewars') {
    const total = (mode === 'zonewars' ? ZONEWARS : BR).combatants;
    if (pr.botCount > 0) for (let i = 1; i < total; i++) game.addBot(botName(i), pr.botLevel);
  } else if (mode === 'builddm') {
    for (let i = 0; i < pr.botCount; i++) game.addBot(botName(i), pr.botLevel);
  } else if (mode !== 'zombies' && mode !== 'creative') {
    for (let i = 0; i < pr.botCount; i++) game.addBot(botName(i), pr.botLevel);
  }
  attachBrains(game);
  game.spawnBrLoot();
  if (mode === 'creative') loadCreativeMap(game, true);   // restore my saved island
  setPresence('match');
  game.onChat = (idx) => game.showChat('me', QUICK_CHAT[idx]);
  game.onOver = (results) => finishMatch(results);
  startLoop(game);
  SFX.go();
}

// ---------------- game loop ----------------
function startLoop(game) {
  stopLoop();
  state.lobbyStage?.stop();
  UI.closeModePopover();
  state.game = game;
  game.onRumble = (s, ms) => gamepad.rumble(s, ms);
  UI.resetHUD();
  UI.setupHudForMode(game, state.input);
  UI.showScreen('game');
  fitRenderer();
  state.input.enabled = true;
  state.input.aiming = false;
  state.input.crouchHeld = false;
  state.input.canBuildTools = game.canBuild;   // enables the quick-build swap
  state.input.requestLock();
  // mobile: go fullscreen + lock to landscape (best effort)
  if (state.input.touchMode) {
    document.documentElement.requestFullscreen?.().then(() => {
      screen.orientation?.lock?.('landscape').catch(() => {});
      fitRenderer();
    }).catch(() => {});
  }
  startMusic('battle');
  runLoop();
}

// the render/update loop, restartable so the settings pause can resume it
function runLoop() {
  cancelAnimationFrame(state.raf);
  state.lastTs = performance.now();
  const frame = (ts) => {
    const dt = Math.min(0.1, (ts - state.lastTs) / 1000) || 0.016;
    state.lastTs = ts;
    const game = state.game;
    if (!game) return;
    game.update(dt);
    state.renderer.render(game.scene, game.camera);
    UI.updateHUD(game, state.input);
    state.raf = requestAnimationFrame(frame);
  };
  state.raf = requestAnimationFrame(frame);
}

function stopLoop() {
  cancelAnimationFrame(state.raf);
  state.raf = 0;
  state.paused = false;
  state.input.enabled = false;
  state.input.exitLock();
}

// in-game settings: freeze the match, open the settings screen, resume on back
function pauseForSettings() {
  if (!state.game) return;
  cancelAnimationFrame(state.raf); state.raf = 0;
  state.paused = true;
  state.input.enabled = false;
  state.input.exitLock();
  UI.renderSettings(() => state.input.applySettings(settings), applyDisplaySettings);
  UI.showScreen('settings');
}

function resumeFromSettings() {
  state.paused = false;
  state.input.applySettings(settings);
  UI.showScreen('game');
  state.input.enabled = true;
  state.input.requestLock();
  runLoop();
}

async function exitMatch() {
  SFX.click();
  if (state.game?.isCreative) saveCreativeMap(state.game, true);   // auto-save the island
  stopLoop();
  startMusic('menu');
  if (state.room) { await state.room.leave(); state.room = null; }
  state._partyPlayers = null;
  state.game?.dispose();
  state.game = null;
  setPresence('menu');
  showHome();
}

// ---------------- results & rewards ----------------
function finishMatch(results) {
  const game = state.game;
  if (!game) return;

  setTimeout(async () => {
    stopLoop();
    const wasOnline = !!state.room;
    if (state.room) { state.room.leave(); state.room = null; }
    state._partyPlayers = null;
    setPresence('menu');

    const myRow = results.placements.find((p) => p.me) || { kills: 0, deaths: 0 };
    const place = Math.max(0, results.placements.indexOf(results.placements.find((p) => p.me)));
    let rw;
    if (results.mode === 'team' || results.mode === 'ctf' || results.mode === 'tactical') {
      rw = rewardsTeam(myRow.kills, results.win);
      rw.rp = 0;
    } else if (results.mode === 'zombies') {
      rw = rewardsZombies(results.wave, myRow.kills);
      rw.rp = 0;
    } else if (results.mode === 'br' || results.mode === 'zonewars') {
      const brPlace = results.win ? 1 : (results.brPlace || place + 1);
      rw = rewardsBr(brPlace, myRow.kills, results.brOf || BR.combatants);
      rw.rp = wasOnline ? (brPlace === 1 ? 30 : brPlace <= 3 ? 10 : -4) : 0;
    } else {
      rw = rewardsGunGame(myRow.kills, place, results.win);
      rw.rp = wasOnline ? (RP_BY_PLACE[Math.min(place, RP_BY_PLACE.length - 1)] ?? 0) : 0;
    }
    if (!wasOnline) {
      rw.xp = Math.floor(rw.xp / 2);
      rw.shards = Math.floor(rw.shards / 2);
    }

    const fx = applyRewards({
      xp: rw.xp, shards: rw.shards, rp: rw.rp,
      kills: myRow.kills, deaths: myRow.deaths, win: results.win,
    });

    // daily challenge progress
    const ms = game.matchStats || {};
    const completed = trackChallenges({
      kills: myRow.kills, wins: results.win ? 1 : 0, matches: 1,
      headshots: ms.headshots || 0, builds: ms.builds || 0, nadeKills: ms.nadeKills || 0,
    });
    for (const c of completed) UI.toast(t('chDone', { n: c.reward }), 'gold');

    UI.renderResults(results, rw);
    UI.showScreen('results');
    startMusic('menu');
    results.win ? SFX.win() : SFX.lose();
    if (fx.levelUp) UI.toast(t('levelUp', { n: fx.levelUp }), 'gold');
    if (fx.rankUp) UI.toast(t('rankUp', { rank: t('rank_' + fx.rankUp) }), 'gold');
    state.game?.dispose();
    state.game = null;
  }, 1600);
}

boot();

// debug handle (console tinkering / automated tests)
window.__ss = state;
