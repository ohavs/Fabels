// ============================================================
// שברי כוכב · STARSHARDS — application orchestration
// boot → menu → (lobby) → match loop → results → rewards
// ============================================================

import { GAME, SHIPS, SHIP_ORDER, RP_BY_PLACE, rewardsPvp, rewardsCoop, QUICK_CHAT } from './config.js';
import { t, randomName } from './i18n.js';
import { FB, initFirebase } from './fb.js';
import {
  profile, loadProfile, playerLevel, setName, claimDaily, applyRewards, effectiveStats, fetchLeaderboard,
} from './profile.js';
import { Input } from './input.js';
import { Game } from './game.js';
import { Renderer, setQuality, getQuality } from './render.js';
import { Room } from './net.js';
import { SFX, unlockAudio, setSoundEnabled, soundEnabled } from './audio.js';
import * as UI from './ui.js';

const $ = UI.$;
const SETTINGS_KEY = 'starshards.settings';

const state = {
  input: null,
  game: null,
  renderer: null,
  room: null,
  raf: 0,
  lastTs: 0,
  lastMode: null,       // for "play again"
  lobbyTimer: 0,
  matchStarted: false,
};

// ---------------- boot ----------------
async function boot() {
  loadSettings();
  document.addEventListener('pointerdown', unlockAudio, { once: true });

  UI.setLoadStatus(t('connecting'));
  const online = await initFirebase();
  UI.setLoadStatus(t('loading'));
  await loadProfile();
  UI.setConn(online);
  if (!online) UI.toast(t('offlineMode'));

  state.input = new Input();
  state.input.attach({
    zoneL: $('zone-left'),
    zoneR: $('zone-right'),
    canvas: $('game-canvas'),
  });
  UI.bindHUD(state.input, {
    onExit: exitMatch,
    onChat: (idx) => { state.input.wantChat = idx; },
  });

  wireMenu();
  UI.refreshMenu();

  const daily = claimDaily();
  UI.showScreen('menu');
  if (daily) UI.toast(t('daily', { n: daily }), 'gold');
}

function wireMenu() {
  $('btn-pvp').addEventListener('click', () => { SFX.click(); enterMode('pvp'); });
  $('btn-coop').addEventListener('click', () => { SFX.click(); enterMode('coop'); });
  $('btn-practice').addEventListener('click', () => { SFX.click(); startOffline('pvp'); });

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
      enterLobby(room);
    } catch (e) {
      UI.toast(t(e.message === 'roomNotFound' ? 'roomNotFound' : 'joinFailed'), 'red');
    }
  });

  $('btn-start').addEventListener('click', () => { SFX.click(); state.room?.startMatch(); });
  $('btn-leave-lobby').addEventListener('click', async () => {
    SFX.click();
    clearInterval(state.lobbyTimer);
    await state.room?.leave();
    state.room = null;
    UI.refreshMenu();
    UI.showScreen('menu');
  });

  $('btn-menu').addEventListener('click', () => { SFX.click(); UI.refreshMenu(); UI.showScreen('menu'); });
  $('btn-again').addEventListener('click', () => {
    SFX.click();
    if (state.lastMode?.online) enterMode(state.lastMode.mode);
    else startOffline(state.lastMode?.mode || 'pvp');
  });

  $('btn-sound').addEventListener('click', () => {
    setSoundEnabled(!soundEnabled());
    $('btn-sound').textContent = soundEnabled() ? '🔊' : '🔇';
    $('btn-sound').classList.toggle('off', !soundEnabled());
    saveSettings();
    SFX.click();
  });
  $('btn-quality').addEventListener('click', () => {
    SFX.click();
    setQuality(getQuality() === 'high' ? 'low' : 'high');
    $('btn-quality').classList.toggle('off', getQuality() === 'low');
    saveSettings();
  });
}

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    if (s.sound === false) { setSoundEnabled(false); $('btn-sound').textContent = '🔇'; $('btn-sound').classList.add('off'); }
    if (s.quality === 'low') { setQuality('low'); $('btn-quality').classList.add('off'); }
  } catch { /* defaults */ }
}
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ sound: soundEnabled(), quality: getQuality() })); } catch { /* ignore */ }
}

const lobbyInfo = () => ({
  name: profile.name, ship: profile.ship, lvl: playerLevel(),
  hue: SHIPS[profile.ship].hue, weapon: SHIPS[profile.ship].weapon,
});

// ---------------- mode entry ----------------
async function enterMode(mode) {
  if (!FB.online) {
    UI.toast(t('offlineMode'));
    startOffline(mode);
    return;
  }
  UI.setLoadStatus(t('connecting'));
  UI.showScreen('load');
  try {
    const room = await Room.quickMatch(mode, lobbyInfo());
    enterLobby(room);
  } catch (e) {
    console.warn(e);
    UI.toast(t('netError'), 'red');
    UI.showScreen('menu');
  }
}

function enterLobby(room) {
  state.room = room;
  state.matchStarted = false;
  state.lastMode = { mode: room.mode, online: true };
  UI.showScreen('lobby');

  room.onLobby = (players, meta) => {
    if (state.matchStarted) return;
    UI.renderLobby(players, meta, FB.uid, room.id);
    // host auto-starts a full room
    if (room.isHost && meta.state === 'waiting' && players.length >= (meta.maxPlayers || 6)) {
      room.startMatch();
    }
  };
  room.onMeta = (meta) => {
    if (state.matchStarted || !meta) return;
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
function makeRenderer(seed) {
  const r = new Renderer($('game-canvas'), $('minimap'));
  r.setWorld(seed);
  return r;
}

function beginOnlineMatch() {
  if (state.matchStarted || !state.room) return;
  state.matchStarted = true;
  const room = state.room;
  const meta = room.meta;

  const game = new Game({
    mode: room.mode,
    online: true,
    isHost: room.isHost,
    seed: meta.seed,
    input: state.input,
    timeFn: () => FB.serverNow(),
    endAt: room.mode === 'pvp' ? meta.startAt + GAME.pvpTime * 1000 : 0,
  });
  const spawnIdx = Math.max(0, room.playerOrder().indexOf(FB.uid));
  game.addLocal(FB.uid, profile.name, effectiveStats(), profile.ship, spawnIdx);
  room.onGameOver((results) => finishMatch(results));
  room.bindGame(game);

  startLoop(game, meta.seed);
  SFX.go();
}

function startOffline(mode) {
  state.lastMode = { mode, online: false };
  const seed = (Math.random() * 1e9) | 0;
  const game = new Game({
    mode,
    online: false,
    isHost: true,
    seed,
    input: state.input,
    timeFn: () => Date.now(),
    endAt: mode === 'pvp' ? Date.now() + GAME.pvpTime * 1000 : 0,
  });

  game.addLocal('me', profile.name, effectiveStats(), profile.ship, 0);
  const botCount = mode === 'pvp' ? 3 : 2;
  for (let i = 0; i < botCount; i++) {
    const ship = SHIP_ORDER[(Math.random() * SHIP_ORDER.length) | 0];
    const s = SHIPS[ship];
    game.addBot('🤖 ' + randomName(), {
      hp: s.hp, speed: s.speed, dmgMul: 1, rateMul: 1,
      weapon: s.weapon, special: s.special, hue: s.hue,
    }, ship, 0.8 + Math.random() * 0.5);
  }
  game.onChat = (idx) => game.showChat(game.me.uid, QUICK_CHAT[idx]);
  game.onOver = (results) => finishMatch(results);

  startLoop(game, seed);
  SFX.go();
}

// ---------------- game loop ----------------
function startLoop(game, seed) {
  stopLoop();
  state.game = game;
  state.renderer = makeRenderer(seed);
  UI.resetHUD();
  UI.showScreen('game');
  state.renderer.resize();
  state.lastTs = performance.now();

  const frame = (ts) => {
    const dt = Math.min(0.1, (ts - state.lastTs) / 1000) || 0.016;
    state.lastTs = ts;
    game.update(dt);
    state.renderer.draw(game, dt);
    UI.updateHUD(game);
    state.raf = requestAnimationFrame(frame);
  };
  state.raf = requestAnimationFrame(frame);
}

function stopLoop() {
  cancelAnimationFrame(state.raf);
  state.raf = 0;
}

async function exitMatch() {
  SFX.click();
  stopLoop();
  if (state.room) { await state.room.leave(); state.room = null; }
  state.game = null;
  UI.refreshMenu();
  UI.showScreen('menu');
}

// ---------------- results & rewards ----------------
function finishMatch(results) {
  const game = state.game;
  if (!game) return;

  // let the final explosion breathe before the results screen
  setTimeout(async () => {
    stopLoop();
    const wasOnline = !!state.room;
    if (state.room) { state.room.leave(); state.room = null; }

    const myRow = results.placements.find((p) => p.me) || { kills: 0, deaths: 0 };
    const place = results.placements.indexOf(results.placements.find((p) => p.me));
    let rw;
    if (results.mode === 'pvp') {
      rw = rewardsPvp(myRow.kills, Math.max(0, place));
      rw.rp = wasOnline ? (RP_BY_PLACE[Math.min(place, RP_BY_PLACE.length - 1)] ?? 0) : 0;
    } else {
      rw = rewardsCoop(results.wave, myRow.kills);
      rw.rp = 0;
    }
    rw.shards += results.myShards || 0;
    if (!wasOnline) { // practice pays half
      rw.xp = Math.floor(rw.xp / 2);
      rw.shards = Math.floor(rw.shards / 2);
    }

    const fx = applyRewards({
      xp: rw.xp, shards: rw.shards, rp: rw.rp,
      kills: myRow.kills, deaths: myRow.deaths,
      win: results.win, waves: results.mode === 'coop' ? results.wave : 0,
    });

    UI.renderResults(results, rw, profile.name);
    UI.showScreen('results');
    results.win ? SFX.win() : SFX.lose();
    if (fx.levelUp) UI.toast(t('levelUp', { n: fx.levelUp }), 'gold');
    if (fx.rankUp) UI.toast(t('rankUp', { rank: t('rank_' + fx.rankUp) }), 'gold');
    state.game = null;
  }, 1400);
}

boot();

// debug handle (console tinkering / automated tests)
window.__ss = state;
