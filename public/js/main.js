// ============================================================
// זירת האש · STARSHARDS ARENA — application orchestration
// boot → menu → lobby (map/bots options) → 3D match → results
// ============================================================

import {
  GAME, MAP_ORDER, RP_BY_PLACE, rewardsGunGame, rewardsTeam, QUICK_CHAT,
  CTF, BR, rewardsZombies, rewardsBr,
} from './config.js';
import { t } from './i18n.js';
import { FB, initFirebase } from './fb.js';
import {
  profile, loadProfile, playerLevel, setName, claimDaily, applyRewards, fetchLeaderboard,
} from './profile.js';
import { Input } from './input.js';
import { Game } from './game.js';
import { createRenderer } from './world.js';
import { Room } from './net.js';
import { attachBrains, botName } from './bots.js';
import {
  SFX, unlockAudio, setSoundEnabled, soundEnabled,
  startMusic, stopMusic, setMusicEnabled, musicEnabled,
} from './audio.js';
import * as UI from './ui.js';

const $ = UI.$;
const SETTINGS_KEY = 'starshards.settings';

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

// ---------------- boot ----------------
async function boot() {
  loadSettings();
  document.addEventListener('pointerdown', () => {
    unlockAudio();
    if (!state.game) startMusic('menu');   // browsers need a gesture before audio
  }, { once: true });

  UI.setLoadStatus(t('connecting'));
  const online = await initFirebase();
  UI.setLoadStatus(t('loading'));
  await loadProfile();
  UI.setConn(online);
  if (!online) UI.toast(t('offlineMode'));

  state.input = new Input();
  state.input.attach({
    canvas: $('game-canvas'),
    zoneL: $('zone-left'),
    zoneR: $('zone-right'),
  });
  UI.bindHUD(state.input, {
    onExit: exitMatch,
    onChat: (idx) => { state.input.wantChat = idx; },
  });

  state.renderer = createRenderer($('game-canvas'));
  window.addEventListener('resize', fitRenderer);

  wireMenu();
  UI.refreshMenu();

  const daily = claimDaily();
  UI.showScreen('menu');
  if (daily) UI.toast(t('daily', { n: daily }), 'gold');
}

function fitRenderer() {
  const c = $('game-canvas');
  // phones: cap the pixel ratio for a solid frame rate
  state.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, state.input?.touchMode ? 1.5 : 2));
  state.renderer.setSize(c.clientWidth, c.clientHeight, false);
  if (state.game) {
    state.game.camera.aspect = c.clientWidth / c.clientHeight;
    state.game.camera.updateProjectionMatrix();
  }
}

function wireMenu() {
  for (const m of ['gungame', 'duel', 'team', 'zombies', 'ctf', 'br']) {
    $('btn-' + m).addEventListener('click', () => { SFX.click(); enterMode(m); });
  }
  $('btn-practice').addEventListener('click', () => { SFX.click(); enterPracticeLobby(state.practice.mode || 'gungame'); });

  $('btn-shop').addEventListener('click', () => { SFX.click(); UI.renderShop(); UI.showScreen('shop'); });
  $('btn-back-shop').addEventListener('click', () => { SFX.click(); UI.refreshMenu(); UI.showScreen('menu'); });

  $('btn-board').addEventListener('click', async () => {
    SFX.click();
    UI.showScreen('board');
    UI.renderBoard(FB.online ? [] : null, FB.uid);
    if (FB.online) UI.renderBoard(await fetchLeaderboard() || [], FB.uid);
  });
  $('btn-back-board').addEventListener('click', () => { SFX.click(); UI.showScreen('menu'); });

  $('menu-name-input').addEventListener('change', (e) => {
    if (setName(e.target.value)) UI.toast(t('nameSaved'));
    UI.refreshMenu();
  });

  $('btn-join-code').addEventListener('click', async () => {
    SFX.click();
    const code = $('join-code-input').value.trim();
    if (!code) return;
    if (!FB.online) { UI.toast(t('onlineNeedsFirebase'), 'red'); return; }
    try {
      const room = await Room.joinByCode(code, lobbyInfo());
      enterOnlineLobby(room);
    } catch (e) {
      UI.toast(t(e.message === 'roomNotFound' ? 'roomNotFound' : 'joinFailed'), 'red');
    }
  });

  $('btn-start').addEventListener('click', () => {
    SFX.click();
    if (state.room) state.room.startMatch();
    else startOffline();     // practice lobby
  });
  $('btn-leave-lobby').addEventListener('click', async () => {
    SFX.click();
    clearInterval(state.lobbyTimer);
    if (state.room) { await state.room.leave(); state.room = null; }
    UI.refreshMenu();
    UI.showScreen('menu');
  });

  $('btn-menu').addEventListener('click', () => { SFX.click(); UI.refreshMenu(); UI.showScreen('menu'); });
  $('btn-again').addEventListener('click', () => {
    SFX.click();
    const e = state.lastEntry;
    if (e?.online) enterMode(e.mode);
    else enterPracticeLobby(state.practice.mode);
  });

  $('btn-sound').addEventListener('click', () => {
    setSoundEnabled(!soundEnabled());
    $('btn-sound').textContent = soundEnabled() ? '🔊' : '🔇';
    $('btn-sound').classList.toggle('off', !soundEnabled());
    saveSettings();
    SFX.click();
  });
  $('btn-music').addEventListener('click', () => {
    setMusicEnabled(!musicEnabled());
    $('btn-music').classList.toggle('off', !musicEnabled());
    if (musicEnabled()) startMusic(state.game ? 'battle' : 'menu');
    saveSettings();
    SFX.click();
  });
}

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    if (s.sound === false) { setSoundEnabled(false); $('btn-sound').textContent = '🔇'; $('btn-sound').classList.add('off'); }
    if (s.music === false) { setMusicEnabled(false); $('btn-music').classList.add('off'); }
  } catch { /* defaults */ }
}
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ sound: soundEnabled(), music: musicEnabled() })); } catch { /* ignore */ }
}

const lobbyInfo = () => ({ name: profile.name, skin: profile.skin, lvl: playerLevel() });

// ---------------- offline practice lobby ----------------
function enterPracticeLobby(mode) {
  state.practice.mode = mode;
  state.room = null;
  state.lastEntry = { mode, online: false };
  UI.showScreen('lobby');
  renderPracticeLobby();
}

function renderPracticeLobby() {
  const pr = state.practice;
  const fakeMeta = { mode: pr.mode, state: 'waiting', host: 'me', maxPlayers: 1 + pr.botCount };
  UI.renderLobby([{ uid: 'me', name: profile.name, lvl: playerLevel(), me: true }], fakeMeta, 'me', '');
  UI.renderLobbyOptions({
    map: pr.map, botLevel: pr.botLevel, botCount: pr.botCount,
    showBots: pr.mode !== 'zombies' && pr.mode !== 'duel', canPick: true,
    practiceMode: pr.mode,
    onPick: (patch) => { Object.assign(pr, patch); renderPracticeLobby(); },
  });
  $('lobby-status').textContent = t('mode_practice') + ' · ' + t('mode_' + pr.mode);
  $('btn-start').disabled = false;
  $('btn-start').style.display = '';
}

// ---------------- online mode entry ----------------
async function enterMode(mode) {
  if (!FB.online) {
    UI.toast(t('offlineMode'));
    enterPracticeLobby(mode);
    return;
  }
  UI.setLoadStatus(t('connecting'));
  UI.showScreen('load');
  try {
    const room = await Room.quickMatch(mode, lobbyInfo(), {
      map: MAP_ORDER[(Math.random() * MAP_ORDER.length) | 0],
    });
    enterOnlineLobby(room);
  } catch (e) {
    console.warn(e);
    UI.toast(t('netError'), 'red');
    UI.showScreen('menu');
  }
}

function enterOnlineLobby(room) {
  state.room = room;
  state.matchStarted = false;
  state.lastEntry = { mode: room.mode, online: true };
  UI.showScreen('lobby');

  const renderOpts = () => {
    const m = room.meta || {};
    UI.renderLobbyOptions({
      map: m.map || 'town', botLevel: m.botLevel || 'normal', botCount: m.botCount || 4,
      showBots: room.mode === 'team',
      canPick: room.isHost && m.state === 'waiting',
      onPick: (patch) => room.setOptions(patch),
    });
  };

  room.onLobby = (players, meta) => {
    if (state.matchStarted) return;
    UI.renderLobby(players, meta, FB.uid, room.id);
    renderOpts();
    if (room.mode === 'duel' && players.length >= 2 && room.isHost && meta.state === 'waiting') {
      room.startMatch();
    }
    if (room.isHost && meta.state === 'waiting' && players.length >= (meta.maxPlayers || 6)) {
      room.startMatch();
    }
  };
  room.onMeta = (meta) => {
    if (state.matchStarted || !meta) return;
    renderOpts();
    if (meta.state === 'starting' && meta.startAt) {
      clearInterval(state.lobbyTimer);
      state.lobbyTimer = setInterval(() => {
        const left = (meta.startAt - FB.serverNow()) / 1000;
        if (left <= 0) {
          clearInterval(state.lobbyTimer);
          beginOnlineMatch();
        } else {
          UI.setLobbyCountdown(left);
          if (left < 3.5) SFX.countdown();
        }
      }, 250);
    }
  };
  room._emitLobby();
  if (room.meta) room.onMeta(room.meta);
}

// ---------------- match setup ----------------
const endAtFor = (mode, startAt) =>
  mode === 'team' ? startAt + GAME.matchTimeTeam * 1000
    : mode === 'ctf' ? startAt + CTF.timeSec * 1000
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
  });

  // CTF: humans alternate red/blue by join order
  const myTeam = room.mode === 'ctf' ? (myIdx % 2 === 0 ? 'r' : 'b') : 'p';
  game.addLocal(FB.uid, profile.name, profile.skin, myIdx, myTeam);

  if (room.isHost) {
    const lvl = meta.botLevel || 'normal';
    if (room.mode === 'team') {
      for (let i = 0; i < (meta.botCount || 4); i++) game.addBot(botName(i), lvl);
    } else if (room.mode === 'ctf') {
      const humansR = order.filter((_, i) => i % 2 === 0).length;
      const humansB = order.length - humansR;
      for (let i = humansR; i < CTF.teamSize; i++) game.addBot(botName(i), lvl, -1, 'r');
      for (let i = humansB; i < CTF.teamSize; i++) game.addBot(botName(i + 3), lvl, -1, 'b');
    } else if (room.mode === 'br') {
      for (let i = order.length; i < BR.combatants; i++) game.addBot(botName(i), lvl);
    }
    attachBrains(game);
  }

  room.onGameOver((results) => finishMatch(results));
  room.bindGame(game);
  if (room.isHost) game.spawnBrLoot();
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
  });

  const myTeam = mode === 'ctf' ? 'r' : 'p';
  game.addLocal('me', profile.name, profile.skin, 0, myTeam);

  if (mode === 'duel') {
    game.addBot(botName(0), 'hard');
  } else if (mode === 'ctf') {
    for (let i = 1; i < CTF.teamSize; i++) game.addBot(botName(i), pr.botLevel, -1, 'r');
    for (let i = 0; i < CTF.teamSize; i++) game.addBot(botName(i + 3), pr.botLevel, -1, 'b');
  } else if (mode === 'br') {
    for (let i = 1; i < BR.combatants; i++) game.addBot(botName(i), pr.botLevel);
  } else if (mode !== 'zombies') {
    for (let i = 0; i < pr.botCount; i++) game.addBot(botName(i), pr.botLevel);
  }
  attachBrains(game);
  game.spawnBrLoot();
  game.onChat = (idx) => game.showChat('me', QUICK_CHAT[idx]);
  game.onOver = (results) => finishMatch(results);
  startLoop(game);
  SFX.go();
}

// ---------------- game loop ----------------
function startLoop(game) {
  stopLoop();
  state.game = game;
  UI.resetHUD();
  UI.showScreen('game');
  fitRenderer();
  state.input.enabled = true;
  state.input.aiming = false;
  state.input.crouchHeld = false;
  state.input.requestLock();
  // mobile: go fullscreen + lock to landscape (best effort)
  if (state.input.touchMode) {
    document.documentElement.requestFullscreen?.().then(() => {
      screen.orientation?.lock?.('landscape').catch(() => {});
      fitRenderer();
    }).catch(() => {});
  }
  state.lastTs = performance.now();
  startMusic('battle');

  const frame = (ts) => {
    const dt = Math.min(0.1, (ts - state.lastTs) / 1000) || 0.016;
    state.lastTs = ts;
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
  state.input.enabled = false;
  state.input.exitLock();
}

async function exitMatch() {
  SFX.click();
  stopLoop();
  startMusic('menu');
  if (state.room) { await state.room.leave(); state.room = null; }
  state.game?.dispose();
  state.game = null;
  UI.refreshMenu();
  UI.showScreen('menu');
}

// ---------------- results & rewards ----------------
function finishMatch(results) {
  const game = state.game;
  if (!game) return;

  setTimeout(async () => {
    stopLoop();
    const wasOnline = !!state.room;
    if (state.room) { state.room.leave(); state.room = null; }

    const myRow = results.placements.find((p) => p.me) || { kills: 0, deaths: 0 };
    const place = Math.max(0, results.placements.indexOf(results.placements.find((p) => p.me)));
    let rw;
    if (results.mode === 'team' || results.mode === 'ctf') {
      rw = rewardsTeam(myRow.kills, results.win);
      rw.rp = 0;
    } else if (results.mode === 'zombies') {
      rw = rewardsZombies(results.wave, myRow.kills);
      rw.rp = 0;
    } else if (results.mode === 'br') {
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
