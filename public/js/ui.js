// ============================================================
// UI layer — screens, FPS HUD, skins shop, leaderboard, results.
// All visible text is Hebrew; layout is native RTL (dir="rtl").
// ============================================================

import { t } from './i18n.js';
import {
  SKINS, SKIN_ORDER, MAP_ORDER, BOT_LEVEL_ORDER, WEAPON_LADDER, WEAPONS, xpForLevel, RETICLE,
} from './config.js';
import { paintIcons } from './icons.js';
import { profile, playerLevel, playerRank, buySkin, equipSkin, getChallenges } from './profile.js';
import { fmtTime, escapeHtml, clamp } from './util.js';
import { SFX, soundEnabled, setSoundEnabled, musicEnabled, setMusicEnabled } from './audio.js';
import { settings, saveSettings, resetBinds, BIND_ORDER } from './settings.js';
import { gamepad } from './gamepad.js';

const $ = (id) => document.getElementById(id);

// ---------------- screens ----------------
const SCREENS = ['load', 'menu', 'lobby', 'shop', 'board', 'settings', 'game', 'results'];
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
  renderChallenges();
}

function renderChallenges() {
  const el = $('challenges');
  const rows = getChallenges().map((c) => {
    const pct = Math.round((c.prog / c.n) * 100);
    return `<div class="chall-row${c.done ? ' done' : ''}">` +
      `<span class="ch-name">${t('ch_' + c.id)}</span>` +
      `<span class="ch-bar"><i style="width:${c.done ? 100 : pct}%"></i></span>` +
      `<span class="ch-reward">${c.done ? '✓' : `${c.prog}/${c.n} · 💠${c.reward}`}</span></div>`;
  }).join('');
  el.innerHTML = `<div class="chall-title">${t('challengesTitle')}</div>${rows}`;
}

// ---------------- lobby (online + offline practice) ----------------
function pillRow(el, items, selected, canPick, onPick, labelFn) {
  el.innerHTML = '';
  for (const it of items) {
    const b = document.createElement('button');
    b.className = 'opt-pill' + (it === selected ? ' sel' : '');
    b.textContent = labelFn(it);
    b.disabled = !canPick;
    if (canPick) b.addEventListener('click', () => { SFX.click(); onPick(it); });
    el.appendChild(b);
  }
}

export function renderLobbyOptions({ map, botLevel, botCount, showBots, canPick, onPick, practiceMode, privacy, maxPlayers }) {
  const wrap = $('practice-mode-wrap');
  wrap.style.display = practiceMode ? '' : 'none';
  if (practiceMode) {
    pillRow($('practice-mode-picker'), ['gungame', 'builddm', 'boxfight', 'zonewars', 'tactical', 'duel', 'team', 'zombies', 'ctf', 'br'],
      practiceMode, true, (m) => onPick({ mode: m }), (m) => t('mode_' + m));
  }
  pillRow($('map-picker'), MAP_ORDER, map, canPick, (m) => onPick({ map: m }), (m) => t('map_' + m));
  $('bots-opts').style.display = showBots ? '' : 'none';
  if (showBots) {
    pillRow($('bot-picker'), BOT_LEVEL_ORDER, botLevel, canPick, (b) => onPick({ botLevel: b }), (b) => t('bots_' + b));
    pillRow($('botcount-picker'), [0, 2, 3, 4, 5, 6], botCount, canPick, (n) => onPick({ botCount: n }), (n) => String(n));
  }
  // online host: cap the lobby size (per-map / per-mode, not fixed)
  $('maxplayers-wrap').style.display = maxPlayers ? '' : 'none';
  if (maxPlayers) {
    pillRow($('maxplayers-picker'), maxPlayers.options, maxPlayers.value, canPick,
      (n) => onPick({ maxPlayers: n }), (n) => String(n));
  }
  // online rooms: host chooses public (matchmaking) or private (code only)
  $('privacy-wrap').style.display = privacy ? '' : 'none';
  if (privacy) {
    pillRow($('privacy-picker'), ['public', 'private'], privacy.value, canPick,
      (v) => onPick({ private: v === 'private' }),
      (v) => t(v === 'public' ? 'roomPublic' : 'roomPrivate'));
  }
}

export function renderLobby(players, meta, myUid, roomId) {
  if (!meta) return;
  $('lobby-title').textContent = t('lobbyTitle_' + meta.mode);
  $('lobby-code').textContent = roomId ? t('roomCode', { code: roomId }) : '';

  const ul = $('lobby-players');
  ul.innerHTML = '';
  for (const p of players) {
    const li = document.createElement('li');
    li.innerHTML =
      `<span class="p-ship">🪖</span>` +
      `<span class="p-name">${escapeHtml(p.name || '?')}${p.me ? ' (אתם)' : ''}</span>` +
      `<span class="p-lvl">${t('level', { n: p.lvl || 1 })}</span>` +
      (p.uid === meta.host ? `<span class="p-host">★ מארח</span>` : '');
    ul.appendChild(li);
  }
  const max = meta.maxPlayers || 6;
  for (let i = players.length; i < Math.min(max, players.length + 2); i++) {
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
    $('lobby-status').textContent = isHost ? t('youAreHost') : t('waitingForPlayers');
  }
}

export function setLobbyCountdown(sec) {
  const el = $('lobby-status');
  el.className = 'lobby-status count';
  el.textContent = t('startsIn', { n: Math.max(0, Math.ceil(sec)) });
  $('btn-start').style.display = 'none';
}

// ---------------- skins shop ----------------
function drawSkinPreview(canvas, skinId) {
  const s = SKINS[skinId];
  const dpr = window.devicePixelRatio || 1;
  canvas.width = 84 * dpr; canvas.height = 104 * dpr;
  const c = canvas.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const hex = (n) => '#' + n.toString(16).padStart(6, '0');
  c.clearRect(0, 0, 84, 104);
  // legs
  c.fillStyle = '#2d3142';
  c.fillRect(30, 62, 9, 30); c.fillRect(45, 62, 9, 30);
  c.fillStyle = hex(s.accent);
  c.fillRect(28, 88, 13, 8); c.fillRect(43, 88, 13, 8);
  // torso
  c.fillStyle = hex(s.body);
  c.fillRect(24, 34, 36, 30);
  c.fillStyle = hex(s.accent);
  c.fillRect(24, 58, 36, 5);
  c.fillRect(24, 40, 36, 4);
  // arms
  c.fillStyle = hex(s.body);
  c.fillRect(14, 36, 9, 24); c.fillRect(61, 36, 9, 24);
  c.fillStyle = hex(s.skin);
  c.fillRect(14, 58, 9, 7); c.fillRect(61, 58, 9, 7);
  // head + visor + helmet
  c.fillStyle = hex(s.skin);
  c.fillRect(28, 8, 28, 26);
  c.fillStyle = '#1f2430';
  c.fillRect(31, 17, 22, 6);
  c.fillStyle = hex(s.accent);
  c.fillRect(26, 4, 32, 8);
}

export function renderShop() {
  $('shop-shards').textContent = `💠 ${profile.shards}`;
  const grid = $('shop-skins');
  grid.innerHTML = '';
  for (const id of SKIN_ORDER) {
    const s = SKINS[id];
    const owned = !!profile.skins[id];
    const equipped = profile.skin === id;
    const card = document.createElement('div');
    card.className = 'ship-card' + (equipped ? ' equipped' : '');
    card.innerHTML = `<canvas></canvas><div class="s-name">${t('skin_' + id)}</div>`;
    const btn = document.createElement('button');
    btn.className = 'shop-buy' + (owned ? ' own' : '');
    if (equipped) { btn.textContent = '✓ ' + t('equipped'); btn.disabled = true; }
    else if (owned) { btn.textContent = t('equip'); }
    else { btn.textContent = s.cost === 0 ? t('free') : `💠 ${s.cost}`; btn.disabled = profile.shards < s.cost; }
    btn.addEventListener('click', () => {
      SFX.click();
      const ok = owned ? equipSkin(id) : buySkin(id);
      if (!ok) { toast(t('notEnough'), 'red'); return; }
      renderShop(); refreshMenu();
    });
    card.appendChild(btn);
    grid.appendChild(card);
    drawSkinPreview(card.querySelector('canvas'), id);
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
let bannerTimer = null;
let sbToggle = false;

export function banner(text, ms = 2000) {
  const el = $('hud-banner');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => el.classList.remove('show'), ms);
}

export function resetHUD() {
  lastFeedKey = '';
  sbToggle = false;
  $('hud-feed').innerHTML = '';
  $('hud-respawn').textContent = '';
  $('hud-banner').classList.remove('show');
  $('chat-panel').classList.add('hidden');
  $('emote-wheel').classList.add('hidden');
  $('scoreboard').classList.add('hidden');
  $('scope').classList.add('hidden');
  $('btn-crouch').classList.remove('on');
  $('btn-aim').classList.remove('on');
  $('btn-sprint').classList.remove('on');
}

// Fortnite-style weapon hotbar (local player, loadout modes)
const WPN_SHORT = { pickaxe: 'מכוש', pistol: 'אקדח', smg: 'SMG', shotgun: 'ציד', rifle: 'AR', lmg: 'LMG', sniper: 'צלף', plasma: 'פלזמה', knife: 'סכין' };
function renderHotbar(game, input) {
  const bar = $('hotbar');
  const me = game.me;
  if (!me || !me.inv || !me.inv.length) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  bar.classList.toggle('raised', game.canBuild);   // sit above the build bar
  // (re)build the slot tiles when the inventory size changes
  if (bar.children.length !== me.inv.length) {
    bar.innerHTML = '';
    me.inv.forEach((_, i) => {
      const el = document.createElement('button');
      el.className = 'hb-slot';
      el.innerHTML = `<span class="hb-key">${i + 1}</span><span class="hb-name"></span><span class="hb-ammo"></span>`;
      const pick = (e) => { e.preventDefault(); e.stopPropagation(); input.onSelectSlot?.(i); };
      el.addEventListener('touchstart', pick, { passive: false });
      el.addEventListener('click', pick);
      bar.appendChild(el);
    });
  }
  const building = game.canBuild && input.tool !== 'gun';
  [...bar.children].forEach((el, i) => {
    const it = me.inv[i];
    const w = WEAPONS[it.w] || {};
    el.classList.toggle('on', i === me.slot && !building);
    el.querySelector('.hb-name').textContent = WPN_SHORT[it.w] || it.w;
    el.querySelector('.hb-ammo').textContent = isFinite(it.ammo) ? it.ammo : '';
    el.style.borderColor = i === me.slot && !building ? '#ffd200' : '';
    el.style.setProperty('--wc', '#' + (w.color || 0x888888).toString(16).padStart(6, '0'));
  });
}

export function updateHUD(game, input) {
  const me = game.me;
  if (!me) return;

  // center: mode status
  if (game.mode === 'team') {
    $('hud-center').textContent = `${fmtTime(game.timeLeft())} · ${t('teamScore', { a: game.teamScore, b: game.botScore })}`;
  } else if (game.mode === 'zombies') {
    $('hud-center').textContent = t('zwave', { n: Math.max(1, game.wave) });
  } else if (game.mode === 'ctf' && game.ctf) {
    $('hud-center').textContent = `${fmtTime(game.timeLeft())} · ${t('ctfScore', { r: game.ctf.score.r, b: game.ctf.score.b })}`;
  } else if (game.brLike) {
    $('hud-center').textContent = t('brAlive', { n: game.brAliveCount() });
  } else if (game.mode === 'builddm' || game.mode === 'boxfight') {
    const lead = [...game.players.values()].sort((a, b) => b.kills - a.kills)[0];
    $('hud-center').textContent = `${fmtTime(game.timeLeft())}${lead && lead.kills > 0 ? ' · ' + t('dmLeader', { name: lead.name, n: lead.kills }) : ''}`;
  } else if (game.mode === 'tactical' && game.tac) {
    const tac = game.tac;
    const parts = [t('tacScore', { a: tac.score.r, b: tac.score.b }), fmtTime(tac.timer)];
    if (tac.planted) parts.push(tac.defuseProg > 0 ? t('defusing') : '💣');
    else if (tac.plantProg > 0) parts.push(t('planting'));
    else if (tac.phase === 'prep') parts.push(t('tacPrep'));
    $('hud-center').textContent = parts.join(' · ');
  } else {
    $('hud-center').textContent = `נשק ${Math.min(me.tier + 1, WEAPON_LADDER.length)}/${WEAPON_LADDER.length}`;
  }
  $('hud-score').textContent = me.score;
  $('hud-kills').textContent = me.kills;

  // hp + armor
  const frac = clamp(me.hp / me.maxHp, 0, 1);
  const fill = $('hud-hp-fill');
  fill.style.width = `${frac * 100}%`;
  fill.classList.toggle('low', frac < 0.3);
  $('hud-armor-fill').style.width = `${clamp(me.armor / 100, 0, 1) * 100}%`;
  $('hud-hp-text').textContent = Math.max(0, Math.round(me.hp));
  $('rsc-nade').textContent = `💣 ${me.nades}`;
  $('rsc-mats').textContent = `🧱 ${me.mats}`;
  $('rsc-mats').style.display = game.canBuild ? '' : 'none';

  renderHotbar(game, input);
  drawMinimap(game);

  // weapon / active tool label
  const tool = game.canBuild ? input.tool : 'gun';
  const toolName = { wall: 'קיר', ramp: 'רמפה', floor: 'רצפה', cone: 'גג', pick: 'מכוש', edit: 'עריכה' }[tool];
  $('hud-weapon-name').textContent = toolName || t('weapon_' + me.weapon);
  const ammoEl = $('hud-ammo');
  if (tool !== 'gun') { ammoEl.textContent = ''; ammoEl.className = 'reloading'; }
  else if (me.reloadT > 0) { ammoEl.textContent = '⟳'; ammoEl.className = 'reloading'; }
  else { ammoEl.textContent = isFinite(me.ammo) ? String(me.ammo) : '∞'; ammoEl.className = ''; }
  const pips = $('hud-tier');
  if (pips.children.length !== WEAPON_LADDER.length) {
    pips.innerHTML = WEAPON_LADDER.map(() => '<span></span>').join('');
  }
  const showLadder = !game.isLoadout;
  pips.style.display = showLadder ? '' : 'none';
  if (showLadder) [...pips.children].forEach((el, i) => el.classList.toggle('on', i <= me.tier));

  // build bar: highlight the active tool + grey out unaffordable pieces
  if (game.canBuild) {
    for (const b of document.querySelectorAll('#build-bar .bb')) {
      const tl = b.dataset.tool;
      b.classList.toggle('sel', tl === tool || (tl === 'gun' && tool === 'gun'));
      const cost = { wall: 2, ramp: 3, floor: 2, cone: 3 }[tl];
      if (cost) b.classList.toggle('nomats', me.mats < cost);
    }
  }
  $('btn-cam').classList.toggle('on', game.thirdPerson);

  // dynamic crosshair: gap follows the real bullet spread, style per weapon
  const ch = $('crosshair');
  const sniperScoped = game._scoped && tool === 'gun';
  ch.dataset.w = RETICLE[me.weapon] || 'cross';
  if (tool !== 'gun') ch.dataset.w = tool === 'pick' ? 'dot' : 'build';
  ch.classList.toggle('hidden', sniperScoped || !me.alive);
  $('scope').classList.toggle('hidden', !sniperScoped || !me.alive);
  if (me.alive && !sniperScoped) {
    const spread = tool === 'gun' ? game.effectiveSpread(me) : 0.004;
    const gap = Math.round(7 + spread * 620);
    ch.style.setProperty('--gap', gap + 'px');
  }

  // flags
  const h = game.hudFlags;
  const hm = $('hitmarker');
  hm.classList.toggle('show', h.hitmarker > 0);
  hm.classList.toggle('hs', h.headshot > 0);
  $('hurt-vignette').classList.toggle('show', h.hurt > 0);
  if (h.tierBanner) { banner(h.tierBanner); h.tierBanner = ''; }
  if (h.winBanner) { banner(h.winBanner, 4000); h.winBanner = ''; }

  // feed
  const key = game.feed.map((f) => f.text).join('|');
  if (key !== lastFeedKey) {
    lastFeedKey = key;
    $('hud-feed').innerHTML = game.feed.slice(-5).map((f) => `<li>${escapeHtml(f.text)}</li>`).join('');
  }

  $('hud-respawn').textContent = (!me.alive && !game.over)
    ? t('respawnIn', { n: Math.max(1, Math.ceil(me.respawnT)) })
    : '';

  // desktop pointer-lock hint — irrelevant on touch or with a controller
  // (the Xbox browser has no mouse, so the gamepad drives look directly)
  $('lock-hint').classList.toggle('show',
    !input.touchMode && !document.pointerLockElement && !gamepad.connected);

  // scoreboard
  const showSb = input.scoreHeld || sbToggle;
  $('scoreboard').classList.toggle('hidden', !showSb);
  if (showSb) renderScoreboard(game);
}

// ---------------- minimap / radar ----------------
let mmBaked = null;
let mmBakedFor = '';

function bakeMinimap(game) {
  const S = game.world.size;
  const c = document.createElement('canvas');
  c.width = c.height = 120;
  const x = c.getContext('2d');
  x.fillStyle = 'rgba(12, 6, 36, 0.85)';
  x.fillRect(0, 0, 120, 120);
  x.fillStyle = 'rgba(160, 150, 220, 0.4)';
  const k = 120 / S;
  for (const b of game.world.colliders) {
    const w = (b.x1 - b.x0) * k, h = (b.z1 - b.z0) * k;
    if (w > 100 || h > 100) continue; // skip border walls
    x.fillRect((b.x0 + S / 2) * k, (b.z0 + S / 2) * k, Math.max(1.5, w), Math.max(1.5, h));
  }
  x.strokeStyle = 'rgba(0, 213, 255, 0.7)';
  x.lineWidth = 2;
  x.strokeRect(1, 1, 118, 118);
  mmBaked = c;
  mmBakedFor = game.mapId + game.world.size;
}

function drawMinimap(game) {
  const cv = $('minimap');
  const x = cv.getContext('2d');
  if (!mmBaked || mmBakedFor !== game.mapId + game.world.size) bakeMinimap(game);
  x.clearRect(0, 0, 120, 120);
  x.drawImage(mmBaked, 0, 0);
  const S = game.world.size, k = 120 / S;
  const px = (v) => (v + S / 2) * k;

  // pickups
  x.fillStyle = 'rgba(255, 210, 0, 0.8)';
  for (const pk of game.pickups.values()) x.fillRect(px(pk.x) - 1.5, px(pk.z) - 1.5, 3, 3);

  // battle-royale zone circle
  if (game.zone) {
    x.strokeStyle = 'rgba(57, 160, 255, 0.9)';
    x.lineWidth = 1.5;
    x.beginPath();
    x.arc(60, 60, game.zone.r * k, 0, Math.PI * 2);
    x.stroke();
  }

  // CTF flags
  if (game.ctf) {
    for (const teamId of ['r', 'b']) {
      const f = game.ctf.flags[teamId];
      x.fillStyle = teamId === 'r' ? '#ff4444' : '#448cff';
      x.fillRect(px(f.x) - 2.5, px(f.z) - 2.5, 5, 5);
    }
  }

  for (const p of game.players.values()) {
    if (!p.alive || p === game.me) continue;
    const sameTeam = game.teamplay && p.team === game.me?.team;
    const isEnemyBot = !!p.bot;
    // enemies show on the radar only when they fired recently (or PvE bots always)
    const ping = game.elapsed - (p.lastShotAt || -99) < 3;
    if (!sameTeam && !isEnemyBot && !ping) continue;
    x.fillStyle = sameTeam ? '#3dff8b' : '#ff5252';
    x.beginPath();
    x.arc(px(p.x), px(p.z), sameTeam ? 2.6 : 3, 0, Math.PI * 2);
    x.fill();
  }

  // me: white arrow rotated by yaw
  const me = game.me;
  if (me) {
    x.save();
    x.translate(px(me.x), px(me.z));
    x.rotate(-me.yaw);
    x.fillStyle = '#ffffff';
    x.beginPath();
    x.moveTo(0, -5); x.lineTo(3.4, 4); x.lineTo(-3.4, 4);
    x.closePath();
    x.fill();
    x.restore();
  }
}

function renderScoreboard(game) {
  const rows = [...game.players.values()]
    .sort((a, b) => b.tier - a.tier || b.kills - a.kills);
  $('scoreboard-rows').innerHTML =
    `<div class="sb-row head"><span></span><span>שם</span><span>נשק</span><span>ח/מ</span><span>ניקוד</span></div>` +
    rows.map((p, i) =>
      `<div class="sb-row${p === game.me ? ' me' : ''}">` +
      `<span>${i + 1}</span>` +
      `<span>${escapeHtml(p.name)}</span>` +
      `<span>${p.bot ? '🤖' : t('weapon_' + (WEAPON_LADDER[p.tier] || p.weapon))}</span>` +
      `<span class="sb-kd">${p.kills}/${p.deaths}</span>` +
      `<span>${p.score}</span></div>`,
    ).join('');
}

// bind HUD buttons to the input layer
export function bindHUD(input, { onExit, onChat, onSettings }) {
  paintIcons();
  window.addEventListener('touchstart', () => document.body.classList.add('touch'), { once: true, passive: true });

  const hold = (el, down, up) => {
    el.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); down(); }, { passive: false });
    el.addEventListener('touchend', (e) => { e.preventDefault(); up && up(); }, { passive: false });
    el.addEventListener('touchcancel', () => up && up());
    el.addEventListener('click', (e) => { e.preventDefault(); down(); up && up(); }); // desktop-friendly
  };

  // fire button also aims while dragging (Fortnite-mobile style)
  const fireBtn = $('btn-fire');
  let fireTouch = null;
  fireBtn.addEventListener('touchstart', (e) => {
    e.preventDefault(); e.stopPropagation();
    const t0 = e.changedTouches[0];
    fireTouch = { id: t0.identifier, px: t0.clientX, py: t0.clientY };
    input.firing = true;
  }, { passive: false });
  fireBtn.addEventListener('touchmove', (e) => {
    if (!fireTouch) return;
    for (const t0 of e.changedTouches) {
      if (t0.identifier !== fireTouch.id) continue;
      e.preventDefault();
      const sens = 0.005 * input.sensitivity * (input.aiming ? 0.5 : 1);
      input.lookDX += (t0.clientX - fireTouch.px) * sens;
      input.lookDY += (t0.clientY - fireTouch.py) * sens;
      fireTouch.px = t0.clientX; fireTouch.py = t0.clientY;
    }
  }, { passive: false });
  const fireEnd = () => { fireTouch = null; input.firing = false; };
  fireBtn.addEventListener('touchend', (e) => { e.preventDefault(); fireEnd(); }, { passive: false });
  fireBtn.addEventListener('touchcancel', fireEnd);

  hold($('btn-jump'), () => { input.wantJump = true; });
  hold($('btn-reload'), () => { input.wantReload = true; });
  hold($('btn-nade'), () => { input.wantNade = true; });
  hold($('btn-crouch'), () => {
    input.crouchHeld = !input.crouchHeld;
    $('btn-crouch').classList.toggle('on', input.crouchHeld);
  });
  hold($('btn-sprint'), () => {
    input.sprintToggle = !input.sprintToggle;
    $('btn-sprint').classList.toggle('on', input.sprintToggle);
  });
  hold($('btn-aim'), () => {
    input.aiming = !input.aiming;
    $('btn-aim').classList.toggle('on', input.aiming);
  });
  hold($('btn-cam'), () => { input.wantCamera = true; });
  hold($('btn-score'), () => { sbToggle = !sbToggle; });
  hold($('btn-chat'), () => $('chat-panel').classList.toggle('hidden'));
  hold($('btn-emote'), () => $('emote-wheel').classList.toggle('hidden'));
  if (onSettings) hold($('btn-ingame-settings'), () => onSettings());

  // build bar tool selection
  for (const b of document.querySelectorAll('#build-bar .bb')) {
    hold(b, () => { input.setTool(b.dataset.tool); $('emote-wheel').classList.add('hidden'); });
  }
  // reflect tool changes on the bar
  input.onTool = (tool) => {
    for (const b of document.querySelectorAll('#build-bar .bb')) {
      b.classList.toggle('sel', b.dataset.tool === tool);
    }
  };

  for (const b of $('chat-panel').querySelectorAll('button')) {
    const fn = () => { onChat(+b.dataset.chat); $('chat-panel').classList.add('hidden'); };
    b.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); fn(); }, { passive: false });
    b.addEventListener('click', fn);
  }
  for (const b of $('emote-wheel').querySelectorAll('button')) {
    const fn = () => { input.wantEmote = +b.dataset.emote; $('emote-wheel').classList.add('hidden'); };
    b.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); fn(); }, { passive: false });
    b.addEventListener('click', fn);
  }
  $('btn-exit').addEventListener('click', onExit);
  $('btn-exit').addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); onExit(); }, { passive: false });
}

// show/hide the build bar & reset tool for a new match
export function setupHudForMode(game, input) {
  const bar = $('build-bar');
  bar.classList.toggle('hidden', !game.canBuild);
  input.setTool('gun');
  input.sprintToggle = false;
  $('btn-sprint').classList.remove('on');
  $('btn-crouch').classList.remove('on');
  $('btn-aim').classList.remove('on');
}

// ---------------- results ----------------
export function renderResults(results, rewards) {
  const title = $('res-title');
  const myRow = results.placements.find((p) => p.me);
  const myPlace = results.placements.indexOf(myRow) + 1;

  if (results.mode === 'team') {
    title.textContent = results.win ? t('teamWin', { n: results.teamScore }) : t('teamLose');
    title.className = results.win ? 'win' : 'lose';
    $('res-sub').textContent = t('mode_team');
  } else if (results.mode === 'zombies') {
    title.textContent = t('gameOver');
    title.className = 'lose';
    $('res-sub').textContent = t('zSurvived', { n: results.wave });
  } else if (results.mode === 'ctf') {
    title.textContent = results.win ? t('ctfWin') : t('ctfLose');
    title.className = results.win ? 'win' : 'lose';
    $('res-sub').textContent = t('ctfScore', { r: results.ctfScoreR ?? '', b: results.ctfScoreB ?? '' }) || t('mode_ctf');
  } else if (results.mode === 'tactical') {
    title.textContent = results.win ? t('tacWin') : t('tacLose');
    title.className = results.win ? 'win' : 'lose';
    $('res-sub').textContent = t('mode_tactical');
  } else if (results.mode === 'br' || results.mode === 'zonewars') {
    title.textContent = results.win ? t('brWin') : t('brPlace', { n: results.brPlace || myPlace, of: results.brOf || '' });
    title.className = results.win ? 'win' : 'lose';
    $('res-sub').textContent = results.winnerName ? t('winner', { name: results.winnerName }) : t('mode_' + results.mode);
  } else {
    title.textContent = results.win ? t('victory') : t('place', { n: myPlace });
    title.className = results.win ? 'win' : (myPlace <= 2 ? '' : 'lose');
    $('res-sub').textContent = results.winnerName ? t('winner', { name: results.winnerName }) : t('mode_gungame');
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

// ---------------- settings & controls ----------------
const PAD_BTN_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'L3', 'R3', '↑', '↓', '←', '→'];
const padBtnName = (i) => (i < 0 ? '—' : (PAD_BTN_NAMES[i] ?? ('#' + i)));

export function updatePadStatus() {
  const el = $('pad-status');
  if (!el) return;
  el.textContent = gamepad.connected ? t('padConnected') : t('padNone');
  el.classList.toggle('on', gamepad.connected);
}

export function renderSettings(onInputApply) {
  const body = $('settings-body');
  body.innerHTML = '';
  $('settings-title').textContent = t('settingsTitle');
  updatePadStatus();

  const commit = () => { saveSettings(); if (onInputApply) onInputApply(); };

  const section = (titleKey) => {
    const h = document.createElement('h3');
    h.className = 'settings-sec';
    h.textContent = t(titleKey);
    body.appendChild(h);
  };

  const sliderRow = (labelKey, key, min, max, step, fmt) => {
    const row = document.createElement('div');
    row.className = 'set-row';
    const lab = document.createElement('span'); lab.className = 'set-label'; lab.textContent = t(labelKey);
    const val = document.createElement('span'); val.className = 'set-val';
    const inp = document.createElement('input');
    inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step; inp.value = settings[key];
    inp.className = 'set-slider';
    const show = () => { val.textContent = fmt ? fmt(settings[key]) : settings[key]; };
    inp.addEventListener('input', () => { settings[key] = +inp.value; show(); commit(); });
    show();
    row.append(lab, inp, val);
    body.appendChild(row);
  };

  const toggleRow = (labelKey, get, set) => {
    const row = document.createElement('div');
    row.className = 'set-row';
    const lab = document.createElement('span'); lab.className = 'set-label'; lab.textContent = t(labelKey);
    const btn = document.createElement('button');
    btn.className = 'set-toggle';
    const paint = () => { const on = get(); btn.textContent = on ? t('on') : t('off'); btn.classList.toggle('on', on); };
    btn.addEventListener('click', () => { set(!get()); paint(); commit(); SFX.click(); });
    paint();
    row.append(lab, btn);
    body.appendChild(row);
  };

  // --- controls ---
  section('secControls');
  sliderRow('sensX', 'sensX', 0.2, 3, 0.05, (v) => v.toFixed(2) + '×');
  sliderRow('sensY', 'sensY', 0.2, 3, 0.05, (v) => v.toFixed(2) + '×');
  sliderRow('deadzone', 'deadzone', 0.02, 0.45, 0.01, (v) => Math.round(v * 100) + '%');
  toggleRow('invertY', () => settings.invertY, (v) => { settings.invertY = v; });
  toggleRow('aimAssist', () => settings.aimAssist, (v) => { settings.aimAssist = v; });
  toggleRow('vibration', () => settings.vibration, (v) => { settings.vibration = v; if (v) gamepad.rumble(0.5, 150); });
  toggleRow('autoFire', () => settings.autoFire, (v) => { settings.autoFire = v; });

  // --- audio ---
  section('secAudio');
  toggleRow('sound', () => soundEnabled(), (v) => { setSoundEnabled(v); settings.sound = v; });
  toggleRow('music', () => musicEnabled(), (v) => { setMusicEnabled(v); settings.music = v; });

  // --- gamepad binds ---
  section('secBinds');
  const bindsWrap = document.createElement('div');
  bindsWrap.className = 'binds-wrap';
  body.appendChild(bindsWrap);
  const drawBinds = () => {
    bindsWrap.innerHTML = '';
    for (const action of BIND_ORDER) {
      const row = document.createElement('div');
      row.className = 'set-row bind-row';
      const lab = document.createElement('span'); lab.className = 'set-label'; lab.textContent = t('act_' + action);
      const btn = document.createElement('button');
      btn.className = 'bind-btn';
      btn.textContent = padBtnName(settings.binds[action]);
      btn.addEventListener('click', () => {
        if (btn.classList.contains('listening')) return;
        btn.classList.add('listening');
        btn.textContent = t('pressBtn');
        gamepad.captureBind().then((idx) => {
          settings.binds[action] = idx;
          btn.classList.remove('listening');
          btn.textContent = padBtnName(idx);
          commit();
          gamepad.rumble(0.4, 90);
        });
      });
      row.append(lab, btn);
      bindsWrap.appendChild(row);
    }
  };
  drawBinds();

  const reset = document.createElement('button');
  reset.className = 'ghost-btn slim';
  reset.textContent = t('resetBinds');
  reset.addEventListener('click', () => { resetBinds(); drawBinds(); SFX.click(); });
  body.appendChild(reset);
}

export { $ };
