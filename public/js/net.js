// ============================================================
// Multiplayer over Firebase Realtime Database (3D FPS edition).
//
//   Room lifecycle: waiting → starting (countdown) → playing → ended
//   • quick match via /index/{mode}; join by 5-char room code
//   • host picks map / bot difficulty / bot count in the lobby
//   • presence via onDisconnect().remove(); host migration by joinedAt
//   • victim-authoritative hits; host-authoritative bots
// ============================================================

import { FB } from './fb.js';
import { GAME, QUICK_CHAT } from './config.js';
import { roomCode } from './util.js';
import { t } from './i18n.js';
import { Mesh, rtcSupported } from './rtc.js';

const maxFor = (mode) => (mode === 'duel' ? 2 : GAME.maxPlayers);
const teamlike = (mode) => mode === 'team' || mode === 'zombies' || mode === 'ctf';

export class Room {
  constructor(id, mode) {
    this.id = id;
    this.mode = mode;               // 'gungame' | 'team'
    this.meta = null;
    this.playersCache = {};
    this.myJoinedAt = 0;
    this.game = null;
    this.onLobby = null;
    this.onMeta = null;
    this._unsubs = [];
    this._timers = [];
    this._t0 = 0;
    this._left = false;
    this.mesh = null;               // WebRTC fast lane (created in bindGame)
  }

  get myUid() { return FB.uid; }
  get isHost() { return this.meta && this.meta.host === FB.uid; }
  _ref(path) { return FB.d.ref(FB.db, `rooms/${this.id}${path ? '/' + path : ''}`); }
  _idxRef() { return FB.d.ref(FB.db, `index/${this.mode}/${this.id}`); }

  playerOrder() {
    return Object.entries(this.playersCache)
      .sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0))
      .map(([uid]) => uid);
  }

  // ---------------- matchmaking ----------------
  static async quickMatch(mode, lobbyInfo, options) {
    const idxSnap = await FB.d.get(FB.d.ref(FB.db, `index/${mode}`));
    const now = FB.serverNow();
    const cands = Object.entries(idxSnap.val() || {})
      .filter(([, v]) => v.state === 'waiting' && now - (v.at || 0) < GAME.roomTTL)
      .sort((a, b) => (b[1].count || 0) - (a[1].count || 0));
    for (const [id] of cands) {
      const room = new Room(id, mode);
      if (await room._tryJoin(lobbyInfo)) return room;
    }
    return Room.create(mode, lobbyInfo, options);
  }

  static async create(mode, lobbyInfo, options = {}) {
    const id = roomCode();
    const room = new Room(id, mode);
    const meta = {
      mode, state: 'waiting', host: FB.uid,
      map: options.map || 'town',
      botLevel: options.botLevel || 'normal',
      botCount: options.botCount || 4,
      startAt: 0,
      createdAt: FB.serverNow(), maxPlayers: maxFor(mode),
    };
    await FB.d.set(room._ref('meta'), meta);
    room.meta = meta;
    await room._enter(lobbyInfo);
    await FB.d.set(room._idxRef(), { state: 'waiting', count: 1, at: FB.serverNow() });
    return room;
  }

  static async joinByCode(code, lobbyInfo) {
    code = String(code).trim().toUpperCase();
    const metaSnap = await FB.d.get(FB.d.ref(FB.db, `rooms/${code}/meta`));
    const meta = metaSnap.val();
    if (!meta) throw new Error('roomNotFound');
    if (meta.state !== 'waiting' && meta.state !== 'starting') throw new Error('roomNotFound');
    const room = new Room(code, meta.mode);
    if (!(await room._tryJoin(lobbyInfo, true))) throw new Error('joinFailed');
    return room;
  }

  async _tryJoin(lobbyInfo, allowStarting = false) {
    try {
      const [metaSnap, playersSnap] = await Promise.all([
        FB.d.get(this._ref('meta')),
        FB.d.get(this._ref('players')),
      ]);
      const meta = metaSnap.val();
      if (!meta) return false;
      const okState = meta.state === 'waiting' || (allowStarting && meta.state === 'starting');
      if (!okState) return false;
      const count = Object.keys(playersSnap.val() || {}).length;
      if (count >= (meta.maxPlayers || maxFor(this.mode))) return false;
      this.meta = meta;
      this.mode = meta.mode;
      await this._enter(lobbyInfo);
      FB.d.runTransaction(this._idxRef(), (v) =>
        v ? { ...v, count: (v.count || 0) + 1, at: FB.serverNow() } : v).catch(() => {});
      return true;
    } catch (e) {
      console.warn('join failed', e);
      return false;
    }
  }

  async _enter(lobbyInfo) {
    this.myJoinedAt = FB.serverNow();
    const meRef = this._ref('players/' + FB.uid);
    await FB.d.set(meRef, { ...lobbyInfo, joinedAt: this.myJoinedAt });
    FB.d.onDisconnect(meRef).remove();
    this._attachCore();
  }

  _attachCore() {
    this._unsubs.push(FB.d.onValue(this._ref('meta'), (s) => {
      const prev = this.meta;
      this.meta = s.val();
      if (!this.meta) return;
      if (this.onMeta) this.onMeta(this.meta, prev);
      this._emitLobby();
    }));
    this._unsubs.push(FB.d.onChildAdded(this._ref('players'), (s) => {
      this.playersCache[s.key] = s.val();
      if (this.game && s.key !== FB.uid) this.game.upsertRemote(s.key, s.val());
      if (this.mesh && s.key !== FB.uid) this.mesh.addPeer(s.key);
      this._emitLobby();
    }));
    this._unsubs.push(FB.d.onChildChanged(this._ref('players'), (s) => {
      this.playersCache[s.key] = { ...this.playersCache[s.key], ...s.val() };
      if (this.game && s.key !== FB.uid) this.game.upsertRemote(s.key, this.playersCache[s.key]);
      this._emitLobby();
    }));
    this._unsubs.push(FB.d.onChildRemoved(this._ref('players'), (s) => {
      delete this.playersCache[s.key];
      if (this.game) this.game.removePlayer(s.key);
      if (this.mesh) this.mesh.removePeer(s.key);
      this._emitLobby();
      this._maybeMigrateHost(s.key);
    }));
  }

  _emitLobby() {
    if (!this.onLobby) return;
    const arr = this.playerOrder().map((uid) => ({ uid, ...this.playersCache[uid], me: uid === FB.uid }));
    this.onLobby(arr, this.meta);
  }

  _maybeMigrateHost(leftUid) {
    if (!this.meta || this.meta.host !== leftUid) return;
    const order = this.playerOrder();
    if (!order.length) return;
    if (order[0] !== FB.uid) return;
    FB.d.update(this._ref('meta'), { host: FB.uid }).catch(() => {});
    if (this.game && !this.game.isHost) {
      this.game.becomeHost();
      this._startHostLoops();
      this.game.feed.push({ text: t('hostLeft'), t: 4 });
    }
  }

  // host-only lobby options
  setOptions(patch) {
    if (!this.isHost) return;
    FB.d.update(this._ref('meta'), patch).catch(() => {});
    // private rooms are hidden from quick-match (still joinable by code)
    if (patch.private !== undefined) {
      FB.d.update(this._idxRef(), {
        state: patch.private ? 'private' : 'waiting', at: FB.serverNow(),
      }).catch(() => {});
    }
  }

  async startMatch() {
    if (!this.isHost || !this.meta || this.meta.state !== 'waiting') return;
    const startAt = FB.serverNow() + GAME.lobbyCountdown * 1000;
    await FB.d.update(this._ref('meta'), { state: 'starting', startAt });
    FB.d.update(this._idxRef(), { state: 'starting', at: FB.serverNow() }).catch(() => {});
  }

  // ---------------- gameplay sync ----------------
  bindGame(game) {
    this.game = game;
    this._t0 = FB.serverNow();
    const d = FB.d;

    for (const [uid, st] of Object.entries(this.playersCache)) {
      if (uid !== FB.uid && st.x !== undefined) game.upsertRemote(uid, st);
    }

    const meRef = this._ref('players/' + FB.uid);
    d.set(meRef, { ...game.getSelfState(), joinedAt: this.myJoinedAt });
    this._timers.push(setInterval(() => {
      if (game.me) d.update(meRef, game.getSelfState()).catch(() => {});
    }, GAME.syncMs));

    // ---- WebRTC fast lane: direct P2P position/aim at ~20Hz ----
    // RTDB above stays the reliable baseline & carries identity/score;
    // this just delivers movement sooner to peers with a live channel.
    // Peers where the direct channel never opens keep using RTDB only.
    if (rtcSupported()) {
      this.mesh = new Mesh(this.id);
      this.mesh.onState = (uid, pkt) => { if (pkt && pkt.t === 's') game.applyNetState(uid, pkt); };
      const humanUids = Object.keys(this.playersCache).filter((u) => u !== FB.uid);
      this.mesh.start(humanUids).catch(() => {});
      this._timers.push(setInterval(() => {
        if (!game.me || !this.mesh) return;
        const n = this.mesh.connectedCount();
        // render closer to real-time when the low-latency lane is live
        game.interpDelayMs = n > 0 ? 85 : 120;
        if (n > 0) this.mesh.broadcast(game.getNetPacket());
      }, GAME.rtcMs));
    }

    const pushTransient = (path, val) => {
      const r = d.push(this._ref(path), { ...val, t: FB.serverNow() });
      setTimeout(() => d.remove(r).catch(() => {}), 5000);
    };
    const fresh = (v) => !v.t || v.t > this._t0 - 3000;

    // ---- my tracers for others ----
    game.onShot = (shot) => pushTransient('shots', { o: FB.uid, ...shot });
    this._unsubs.push(d.onChildAdded(this._ref('shots'), (s) => {
      const v = s.val();
      if (!v || v.o === FB.uid || !fresh(v)) return;
      game.applyRemoteShot(v.o, v);
    }));

    // ---- hits (victim-authoritative) ----
    game.onHitRemote = (toUid, dmg, info = {}) =>
      pushTransient('hits', { to: toUid, from: info.from || FB.uid, dmg, hs: !!info.hs, mel: !!info.mel, nd: !!info.nade });
    this._unsubs.push(d.onChildAdded(this._ref('hits'), (s) => {
      const v = s.val();
      if (!v || v.to !== FB.uid || !fresh(v)) return;
      game.applyHitOnMe(v.dmg, v.from, v.hs, v.mel, v.nd);
    }));

    // ---- kills / chat / win / over ----
    game.onSelfDeath = (fromUid, mel, nade) => {
      const killerName = this.playersCache[fromUid]?.name
        || [...game.players.values()].find((q) => q.uid === fromUid)?.name || '🤖';
      pushTransient('events', { k: 'kill', a: fromUid, an: killerName, b: FB.uid, bn: game.me.name, mel: !!mel, nd: !!nade, vb: false });
      d.update(meRef, game.getSelfState()).catch(() => {});
    };
    game.onKillBroadcast = (fromUid, killerName, botUid, botName, mel) =>
      pushTransient('events', { k: 'kill', a: fromUid, an: killerName, b: botUid, bn: botName, mel: !!mel, vb: true });
    game.onChat = (idx) => pushTransient('events', { k: 'chat', u: FB.uid, c: idx });
    game.onWin = () => pushTransient('events', { k: 'win', u: FB.uid, name: game.me.name });
    game.onNadeThrow = (spec) => pushTransient('events', { k: 'nade', u: FB.uid, ...spec });
    game.onEmote = (idx) => pushTransient('events', { k: 'emote', u: FB.uid, i: idx || 0 });

    this._unsubs.push(d.onChildAdded(this._ref('events'), (s) => {
      const v = s.val();
      if (!v || !fresh(v)) return;
      switch (v.k) {
        case 'kill':
          game.feed.push({ text: t(v.mel ? 'killKnife' : 'kill', { a: v.an, b: v.bn }), t: 5 });
          game.tallyRemoteKill(v.a, v.b);
          // credit myself unless I'm the host who already credited locally (bot victims)
          if (v.a === FB.uid && !(v.vb && game.isHost)) game.creditKill(v.bn, v.mel, v.vb, v.nd);
          break;
        case 'chat':
          game.showChat(v.u, QUICK_CHAT[v.c] || 'gg');
          break;
        case 'nade':
          if (v.u !== FB.uid) game.applyRemoteNade(v);
          break;
        case 'emote':
          if (v.u !== FB.uid) game.applyEmote(v.u, v.i || 0);
          break;
        case 'wave':
          if (!game.isHost) {
            game.wave = v.n;
            game.hudFlags.tierBanner = t('zwave', { n: v.n });
          }
          break;
        case 'ctf':
          if (!game.isHost) {
            const msgs = {
              ftaken: t('flagTaken', { name: v.name }), fdrop: t('flagDropped'),
              fret: t('flagReturned'), fcap: t('flagCaptured', { name: v.name }),
            };
            game.feed.push({ text: msgs[v.kind] || '', t: 4 });
          }
          break;
        case 'win':
          game.hudFlags.winBanner = t('winner', { name: v.name });
          game.forceGameOver({ winnerUid: v.u, winnerName: v.name });
          break;
        case 'over':
          game.forceGameOver({ teamWin: !!v.teamWin });
          break;
      }
    }));

    // ---- bots (team / zombies / ctf) ----
    if (teamlike(this.mode)) {
      game.onBotDamage = (id, dmg) => pushTransient('bdmg', { id, dmg, from: FB.uid });
      this._unsubs.push(d.onChildAdded(this._ref('bdmg'), (s) => {
        const v = s.val();
        if (!v || !fresh(v) || !game.isHost || v.from === FB.uid) return;
        game.applyBotDamageEvent(v.id, v.dmg, v.from);
      }));
      this._unsubs.push(d.onValue(this._ref('bots'), (s) => {
        if (!game.isHost) game.setBotSnapshot(s.val());
      }));
      this._unsubs.push(d.onChildAdded(this._ref('bshots'), (s) => {
        const v = s.val();
        if (!v || !fresh(v) || game.isHost) return;
        game.applyRemoteShot(v.o, v);
      }));
    }

    game.onOver = (results) => {
      if (game.isHost) {
        if (teamlike(this.mode) && results.teamWin !== undefined) {
          pushTransient('events', { k: 'over', teamWin: !!results.teamWin });
        }
        d.update(this._ref('meta'), { state: 'ended' }).catch(() => {});
        d.update(this._idxRef(), { state: 'ended', at: FB.serverNow() }).catch(() => {});
      }
      if (this._onGameOver) this._onGameOver(results);
    };

    // ---- CTF: host-authoritative flags/score snapshot + banner events ----
    if (this.mode === 'ctf') {
      game.onCtfState = (st) => d.set(this._ref('flags'), st).catch(() => {});
      game.onCtfEvent = (ev) => pushTransient('events', { k: 'ctf', ...ev });
      this._unsubs.push(d.onValue(this._ref('flags'), (s) => {
        if (!game.isHost) game.setCtfState(s.val());
      }));
    }

    // ---- builds (anyone places; destroyer removes) ----
    game.onBuildPlace = (spec) => d.set(this._ref('builds/' + spec.id), spec).catch(() => {});
    game.onBuildDestroy = (id) => d.remove(this._ref('builds/' + id)).catch(() => {});
    this._unsubs.push(d.onChildAdded(this._ref('builds'), (s) => {
      const v = s.val();
      if (v && v.o !== FB.uid) game.applyRemoteBuild(v);
    }));
    this._unsubs.push(d.onChildRemoved(this._ref('builds'), (s) => {
      game.removeBuild(s.key, true);
    }));

    // ---- pickups (all modes; host spawns, taker removes) ----
    game.onPickupSpawn = (pk) => d.set(this._ref('pickups/' + pk.id), {
      k: pk.k, x: pk.x, y: pk.y, z: pk.z, tier: pk.tier ?? 0, w: pk.w ?? null,
    }).catch(() => {});
    game.onPickupTaken = (id) => d.remove(this._ref('pickups/' + id)).catch(() => {});
    this._unsubs.push(d.onChildAdded(this._ref('pickups'), (s) => {
      const v = s.val();
      if (v) game.addPickup({ id: s.key, ...v });
    }));
    this._unsubs.push(d.onChildRemoved(this._ref('pickups'), (s) => {
      game.removePickup(s.key);
    }));

    if (game.isHost) this._startHostLoops();

    if (this.isHost) {
      const wait = Math.max(0, (this.meta?.startAt || 0) - FB.serverNow());
      this._timers.push(setTimeout(() => {
        FB.d.update(this._ref('meta'), { state: 'playing' }).catch(() => {});
        FB.d.update(this._idxRef(), { state: 'playing', at: FB.serverNow() }).catch(() => {});
      }, wait + 200));
    }
  }

  onGameOver(cb) { this._onGameOver = cb; }

  _startHostLoops() {
    const game = this.game;
    if (!game || !teamlike(this.mode)) return;
    game.onWave = (n) => {
      const r = FB.d.push(this._ref('events'), { k: 'wave', n, t: FB.serverNow() });
      setTimeout(() => FB.d.remove(r).catch(() => {}), 5000);
    };
    game.onBotShot = (spec) => {
      const r = FB.d.push(this._ref('bshots'), { ...spec, t: FB.serverNow() });
      setTimeout(() => FB.d.remove(r).catch(() => {}), 5000);
    };
    this._timers.push(setInterval(() => {
      if (game.isHost && !game.over) {
        FB.d.set(this._ref('bots'), game.getBotSnapshot()).catch(() => {});
      }
    }, GAME.botSyncMs));
  }

  // ---------------- teardown ----------------
  async leave() {
    if (this._left) return;
    this._left = true;
    if (this.mesh) { try { this.mesh.close(); } catch { /* ignore */ } this.mesh = null; }
    for (const u of this._unsubs) { try { u(); } catch { /* ignore */ } }
    for (const tm of this._timers) { clearInterval(tm); clearTimeout(tm); }
    this._unsubs = []; this._timers = [];
    const d = FB.d;
    try {
      const meRef = this._ref('players/' + FB.uid);
      FB.d.onDisconnect(meRef).cancel();
      await d.remove(meRef);
      await d.runTransaction(this._idxRef(), (v) =>
        v ? { ...v, count: Math.max(0, (v.count || 1) - 1), at: FB.serverNow() } : v);
      const left = await d.get(this._ref('players'));
      if (!left.exists()) {
        await d.remove(this._ref());
        await d.remove(this._idxRef());
      }
    } catch { /* best-effort teardown */ }
    this.game = null;
  }
}
