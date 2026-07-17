// ============================================================
// UI layer — screen manager, HUD, shop, leaderboard, results.
// All visible text is Hebrew; layout is native RTL (dir="rtl").
// ============================================================

import { t } from './i18n.js';
import {
  SHIPS, SHIP_ORDER, WEAPONS, UPGRADE_TRACKS, UPGRADE_COST, UPGRADE_BONUS,
  RANKS, xpForLevel, GAME,
} from './config.js';
import {
  profile, playerLevel, playerRank, buyShip, equipShip, buyUpgrade,
} from './profile.js';
import { SHIP_SHAPES } from './render.js';
import { fmtTime, escapeHtml, clamp } from './util.js';
import { SFX } from './audio.js';

const $ = (id) => document.getElementById(id);
const SHIP_EMOJI = { storm: '🚀', shadow: '🛸', aegis: '🛡️', nova: '☄️' };

// ---------------- screens ----------------
const SCREENS = ['load', 'menu', 'lobby', 'shop', 'board', 'game', 'results'];
export function showScreen(name) {
  for (const s of SCREENS) $('scr-' + s).classList.toggle('active', s === name);
}

// ---------------- toasts ----------------
export function toast(text, cls = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + cls;
  el.textContent = text;
  $('toasts').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity 0.4s'; }, 2600);
  setTimeout(() => el.remove(), 3100);
}

export function setLoadStatus(text) { $('load-status').textContent = text; }

export function setConn(online) {
  const b = $('menu-conn');
  b.textContent = online ? t('connected') : 'לא מקוון';
  b.classList.toggle('online', online);
}

// ---------------- main menu ----------------
export function refreshMenu() {
  $('menu-name-input').value = profile.name;
  const lvl = playerLevel();
  $('menu-level').textContent = t('level', { n: lvl });
  $('menu-rank').textContent = t('rank_' + playerRank().id) + ` · ${profile.rp} RP`;
  $('menu-shards').textContent = `💠 ${profile.shards}`;
  const lo = xpForLevel(lvl), hi = xpForLevel(lvl + 1);
  $('menu-xpbar').style.width = `${clamp(((profile.xp - lo) / Math.max(1, hi - lo)) * 100, 0, 100)}%`;
}

// ---------------- lobby ----------------
export function renderLobby(players, meta, myUid, roomId) {
  if (!meta) return;
  $('lobby-title').textContent = t('lobbyTitle_' + meta.mode);
  $('lobby-code').textContent = t('roomCode', { code: roomId });

  const ul = $('lobby-players');
  ul.innerHTML = '';
  for (const p of players) {
    const li = document.createElement('li');
    li.innerHTML =
      `<span class="p-ship">${SHIP_EMOJI[p.ship] || '🚀'}</span>` +
      `<span class="p-name">${escapeHtml(p.name || '?')}${p.me ? ' (אתם)' : ''}</span>` +
      `<span class="p-lvl">${t('level', { n: p.lvl || 1 })}</span>` +
      (p.uid === meta.host ? `<span class="p-host">★ מארח</span>` : '');
    ul.appendChild(li);
  }
  const max = meta.maxPlayers || 6;
  for (let i = players.length; i < max; i++) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = '· מקום פנוי ·';
    ul.appendChild(li);
  }

  const isHost = meta.host === myUid;
  const btn = $('btn-start');
  btn.style.display = isHost && meta.state === 'waiting' ? '' : 'none';
  btn.disabled = !(isHost && players.length >= 1);
  if (meta.state === 'waiting') {
    $('lobby-status').className = 'lobby-status';
    $('lobby-status').textContent = isHost
      ? (players.length < 2 ? t('waitingForPlayers') + ' · ' + t('youAreHost') : t('youAreHost'))
      : t('waitingForPlayers');
  }
}

export function setLobbyCountdown(sec) {
  const el = $('lobby-status');
  el.className = 'lobby-status count';
  el.textContent = t('startsIn', { n: Math.max(0, Math.ceil(sec)) });
  $('btn-start').style.display = 'none';
}

// ---------------- shop ----------------
function drawShipPreview(canvas, shipId) {
  const ctx = canvas.getContext('2d');
  const s = 74 * (window.devicePixelRatio || 1);
  canvas.width = canvas.height = s;
  ctx.setTransform(s / 74, 0, 0, s / 74, 0, 0);
  ctx.clearRect(0, 0, 74, 74);
  ctx.save();
  ctx.translate(37, 37);
  ctx.rotate(-Math.PI / 2);
  ctx.scale(1.6, 1.6);
  const hue = SHIPS[shipId].hue;
  const shape = SHIP_SHAPES[shipId];
  ctx.beginPath();
  shape.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  const g = ctx.createLinearGradient(-16, 0, 18, 0);
  g.addColorStop(0, `hsl(${hue}, 45%, 16%)`);
  g.addColorStop(1, `hsl(${hue}, 60%, 34%)`);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = `hsl(${hue}, 95%, 62%)`;
  ctx.lineWidth = 2;
  ctx.shadowColor = `hsl(${hue}, 95%, 60%)`;
  ctx.shadowBlur = 10;
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = `hsla(${hue}, 100%, 82%, 0.95)`;
  ctx.beginPath(); ctx.arc(4, 0, 3.4, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

export function renderShop() {
  $('shop-shards').textContent = `💠 ${profile.shards}`;

  // ships
  const grid = $('shop-ships');
  grid.innerHTML = '';
  for (const id of SHIP_ORDER) {
    const s = SHIPS[id];
    const owned = !!profile.ships[id];
    const equipped = profile.ship === id;
    const card = document.createElement('div');
    card.className = 'ship-card' + (equipped ? ' equipped' : '');
    card.innerHTML =
      `<canvas></canvas>` +
      `<div class="s-name">${t('ship_' + id)}</div>` +
      `<div class="s-desc">${t('shipDesc_' + id)}</div>` +
      `<div class="s-stats"><span>❤️ ${s.hp}</span><span>🏃 ${s.speed}</span><span>🔫 ${t('weapon_' + s.weapon)}</span></div>`;
    const btn = document.createElement('button');
    btn.className = 'shop-buy' + (owned ? ' own' : '');
    if (equipped) { btn.textContent = '✓ ' + t('equipped'); btn.disabled = true; }
    else if (owned) { btn.textContent = t('equip'); }
    else { btn.textContent = s.cost === 0 ? t('free') : `💠 ${s.cost}`; btn.disabled = profile.shards < s.cost; }
    btn.addEventListener('click', () => {
      SFX.click();
      const ok = owned ? equipShip(id) : buyShip(id);
      if (!ok) { toast(t('notEnough'), 'red'); return; }
      renderShop(); refreshMenu();
    });
    card.appendChild(btn);
    grid.appendChild(card);
    drawShipPreview(card.querySelector('canvas'), id);
  }

  // upgrades
  const list = $('shop-upgrades');
  list.innerHTML = '';
  for (const track of UPGRADE_TRACKS) {
    const tier = profile.up[track];
    const maxed = tier >= UPGRADE_COST.length;
    const row = document.createElement('div');
    row.className = 'upgrade-row';
    const pips = Array.from({ length: UPGRADE_COST.length }, (_, i) =>
      `<span class="u-pip${i < tier ? ' on' : ''}"></span>`).join('');
    row.innerHTML =
      `<span class="u-name">${t('up_' + track)}</span>` +
      `<span class="u-pips">${pips}</span>` +
      `<span class="u-bonus">+${Math.round(UPGRADE_BONUS[track] * 100)}%</span>`;
    const btn = document.createElement('button');
    btn.className = 'shop-buy';
    if (maxed) { btn.textContent = t('upMax'); btn.disabled = true; }
    else { btn.textContent = `💠 ${UPGRADE_COST[tier]}`; btn.disabled = profile.shards < UPGRADE_COST[tier]; }
    btn.addEventListener('click', () => {
      SFX.click();
      if (!buyUpgrade(track)) { toast(t('notEnough'), 'red'); return; }
      renderShop(); refreshMenu();
    });
    row.appendChild(btn);
    list.appendChild(row);
  }
}

// ---------------- leaderboard ----------------
export function renderBoard(rows, myUid) {
  const el = $('board-list');
  el.innerHTML = '';
  if (rows === null) {
    el.innerHTML = `<div class="board-empty">${t('boardOffline')}</div>`;
    return;
  }
  if (!rows.length) {
    el.innerHTML = `<div class="board-empty">${t('boardEmpty')}</div>`;
    return;
  }
  rows.forEach((r, i) => {
    const div = document.createElement('div');
    div.className = 'board-row' + (i === 0 ? ' top1' : '') + (r.uid === myUid ? ' me' : '');
    div.innerHTML =
      `<span class="b-place">${i + 1}</span>` +
      `<span class="b-name">${escapeHtml(r.name || '?')}</span>` +
      `<span class="b-lvl">${t('level', { n: r.level })}</span>` +
      `<span class="b-rp">${r.rp} RP</span>`;
    el.appendChild(div);
  });
}

// ---------------- HUD ----------------
let lastFeedKey = '';
let lastWaveSeen = 0;
let bannerTimer = null;

export function banner(text, ms = 1800) {
  const el = $('hud-banner');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => el.classList.remove('show'), ms);
}

export function resetHUD() {
  lastFeedKey = '';
  lastWaveSeen = 0;
  $('hud-feed').innerHTML = '';
  $('hud-respawn').textContent = '';
  $('hud-banner').classList.remove('show');
  $('chat-panel').classList.add('hidden');
}

export function updateHUD(game) {
  const me = game.me;
  if (!me) return;

  $('hud-center').textContent = game.mode === 'pvp'
    ? fmtTime(game.timeLeft())
    : t('wave', { n: Math.max(1, game.wave) });
  $('hud-score').textContent = me.score;
  $('hud-kills').textContent = me.kills;

  const frac = clamp(me.hp / me.maxHp, 0, 1);
  const fill = $('hud-hp-fill');
  fill.style.width = `${frac * 100}%`;
  fill.classList.toggle('low', frac < 0.3);
  $('hud-hp-text').textContent = Math.max(0, Math.round(me.hp));

  // killfeed (rebuild only when it changes)
  const key = game.feed.map((f) => f.text).join('|');
  if (key !== lastFeedKey) {
    lastFeedKey = key;
    $('hud-feed').innerHTML = game.feed.slice(-5).map((f) => `<li>${escapeHtml(f.text)}</li>`).join('');
  }

  // wave banner (co-op)
  if (game.mode === 'coop' && game.wave > lastWaveSeen) {
    lastWaveSeen = game.wave;
    banner(t('wave', { n: game.wave }));
  }

  $('hud-respawn').textContent = (!me.alive && !game.over)
    ? t('respawnIn', { n: Math.max(1, Math.ceil(me.respawnT)) })
    : '';

  updateCooldownBtn($('btn-dash'), me.dashCd, GAME.dashCd);
  updateCooldownBtn($('btn-special'), me.specialCd, GAME.specialCd);
}

function updateCooldownBtn(btn, cd, maxCd) {
  const cooling = cd > 0.05;
  btn.classList.toggle('cooling', cooling);
  btn.querySelector('.ab-cd').textContent = cooling ? Math.ceil(cd) : '';
}

// bind HUD action buttons to the input layer
export function bindHUD(input, { onExit, onChat }) {
  const press = (el, fn) => {
    el.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); fn(); }, { passive: false });
    el.addEventListener('mousedown', (e) => { e.stopPropagation(); fn(); });
  };
  press($('btn-dash'), () => { input.wantDash = true; });
  press($('btn-special'), () => { input.wantSpecial = true; });
  press($('btn-chat'), () => $('chat-panel').classList.toggle('hidden'));
  for (const b of $('chat-panel').querySelectorAll('button')) {
    press(b, () => {
      onChat(+b.dataset.chat);
      $('chat-panel').classList.add('hidden');
    });
  }
  $('btn-exit').onclick = onExit;
}

// ---------------- results ----------------
export function renderResults(results, rewards, myName) {
  const title = $('res-title');
  const isPvp = results.mode === 'pvp';
  const myRow = results.placements.find((p) => p.me);
  const myPlace = results.placements.indexOf(myRow) + 1;

  if (isPvp) {
    title.textContent = results.win ? t('victory') : t('place', { n: myPlace });
    title.className = results.win ? 'win' : (myPlace <= 2 ? '' : 'lose');
    $('res-sub').textContent = t('mode_pvp');
  } else {
    title.textContent = t('gameOver');
    title.className = 'lose';
    $('res-sub').textContent = t('resultWaves', { n: results.wave });
  }

  const table = $('res-table');
  table.innerHTML = '';
  results.placements.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'res-row' + (p.me ? ' me' : '');
    row.innerHTML =
      `<span class="r-place">${i + 1}</span>` +
      `<span class="r-name">${escapeHtml(p.name)}${p.me ? ' (אתם)' : ''}</span>` +
      `<span class="r-kd">${p.kills}/${p.deaths}</span>` +
      `<span class="r-score">${p.score}</span>`;
    table.appendChild(row);
  });

  const rw = $('res-rewards');
  rw.innerHTML = '';
  const chip = (txt, cls = '') => {
    const c = document.createElement('span');
    c.className = 'reward-chip ' + cls;
    c.textContent = txt;
    rw.appendChild(c);
  };
  chip(t('rewardXp', { n: rewards.xp }), 'xp');
  chip(t('rewardShards', { n: rewards.shards }));
  if (rewards.rp) chip(t('rewardRp', { n: (rewards.rp > 0 ? '+' : '') + rewards.rp }), 'rp');
}

export { $ };
