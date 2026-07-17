// ============================================================
// Multiplayer over Firebase Realtime Database.
//
//   Room lifecycle: waiting → starting (countdown) → playing → ended
//   • quick match via /index/{mode} (count is a hint, verified on join)
//   • join by 5-char room code
//   • presence via onDisconnect().remove()
//   • host migration: earliest joinedAt among survivors takes over
//   • transient nodes (shots/hits/…) are pruned by their pusher
// ============================================================

import { FB } from './fb.js';
import { GAME, QUICK_CHAT } from './config.js';
import { roomCode } from './util.js';
import { t } from './i18n.js';
import { SFX } from './audio.js';

const maxFor = (mode) => (mode === 'coop' ? GAME.maxPlayersCoop : GAME.maxPlayersPvp);

export class Room {
  constructor(id, mode) {
    this.id = id;
    this.mode = mode;
    this.meta = null;
    this.playersCache = {};      // uid → last known state (lobby + game)
    this.myJoinedAt = 0;
    this.game = null;
    this.onLobby = null;         // (playersArr, meta)
    this.onMeta = null;          // (meta)
    this._unsubs = [];
    this._timers = [];
    this._t0 = 0;
    this._left = false;
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
  static async quickMatch(mode, lobbyInfo) {
    const idxSnap = await FB.d.get(FB.d.ref(FB.db, `index/${mode}`));
    const now = FB.serverNow();
    const cands = Object.entries(idxSnap.val() || {})
      .filter(([, v]) => v.state === 'waiting' && now - (v.at || 0) < GAME.roomTTL)
      .sort((a, b) => (b[1].count || 0) - (a[1].count || 0));

    for (const [id] of cands) {
      const room = new Room(id, mode);
      if (await room._tryJoin(lobbyInfo)) return room;
    }
    return Room.create(mode, lobbyInfo);
  }

  static async create(mode, lobbyInfo) {
    const id = roomCode();
    const room = new Room(id, mode);
    const meta = {
      mode, state: 'waiting', host: FB.uid,
      seed: (Math.random() * 1e9) | 0,
      startAt: 0, wave: 0,
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

  // meta + players listeners live for the whole room lifetime
  _attachCore() {
    this._unsubs.push(FB.d.onValue(this._ref('meta'), (s) => {
      const prev = this.meta;
      this.meta = s.val();
      if (!this.meta) return;
      if (this.onMeta) this.onMeta(this.meta, prev);
      this._emitLobby();
      // co-op wave banner for guests
      if (this.game && prev && this.meta.wave > (prev.wave || 0) && !this.game.isHost) {
        this.game.wave = this.meta.wave;
        this.game.feed.push({ text: t('waveIncoming', { n: this.meta.wave }), t: 4 });
        SFX.wave();
      }
    }));

    this._unsubs.push(FB.d.onChildAdded(this._ref('players'), (s) => {
      this.playersCache[s.key] = s.val();
      if (this.game && s.key !== FB.uid) this.game.upsertRemote(s.key, s.val());
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
    const newHost = order[0];
    if (newHost !== FB.uid) return;      // deterministic: only the heir writes
    FB.d.update(this._ref('meta'), { host: FB.uid }).catch(() => {});
    if (this.game && !this.game.isHost) {
      this.game.becomeHost();
      this._startHostLoops();
      this.game.feed.push({ text: t('hostLeft'), t: 4 });
    }
  }

  // ---------------- lobby → match ----------------
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

    // hydrate remote players already in cache
    for (const [uid, st] of Object.entries(this.playersCache)) {
      if (uid !== FB.uid && st.x !== undefined) game.upsertRemote(uid, st);
    }

    // ---- outbound: my state ~11Hz ----
    const meRef = this._ref('players/' + FB.uid);
    FB.d.set(meRef, { ...game.getSelfState(), joinedAt: this.myJoinedAt });
    this._timers.push(setInterval(() => {
      if (game.me) d.update(meRef, game.getSelfState()).catch(() => {});
    }, GAME.syncMs));

    const pushTransient = (path, val) => {
      const r = d.push(this._ref(path), { ...val, t: FB.serverNow() });
      setTimeout(() => d.remove(r).catch(() => {}), 5000);
    };
    const fresh = (v) => !v.t || v.t > this._t0 - 3000;

    // ---- shots ----
    game.onShot = (shot) => pushTransient('shots', { o: FB.uid, ...shot });
    this._unsubs.push(d.onChildAdded(this._ref('shots'), (s) => {
      const v = s.val();
      if (!v || v.o === FB.uid || !fresh(v)) return;
      game.applyRemoteShot(v.o, v);
    }));

    // ---- hits (victim-authoritative) ----
    game.onHitRemote = (toUid, dmg) => pushTransient('hits', { to: toUid, from: FB.uid, dmg });
    this._unsubs.push(d.onChildAdded(this._ref('hits'), (s) => {
      const v = s.val();
      if (!v || v.to !== FB.uid || !fresh(v)) return;
      game.applyHitOnMe(v.dmg, v.from);
    }));

    // ---- kill events (announced by the victim) ----
    game.onSelfDeath = (fromUid) => {
      const killerName = this.playersCache[fromUid]?.name || t('enemy_crawler');
      pushTransient('events', { k: 'kill', a: fromUid, an: killerName, b: FB.uid, bn: game.me.name });
      d.update(meRef, game.getSelfState()).catch(() => {});
    };
    game.onChat = (idx) => pushTransient('events', { k: 'chat', u: FB.uid, c: idx });

    this._unsubs.push(d.onChildAdded(this._ref('events'), (s) => {
      const v = s.val();
      if (!v || !fresh(v)) return;
      switch (v.k) {
        case 'kill':
          game.feed.push({ text: t('kill', { a: v.an, b: v.bn }), t: 5 });
          if (v.a === FB.uid) game.creditKill(FB.uid, v.bn);
          break;
        case 'chat':
          if (v.u !== FB.uid) game.showChat(v.u, QUICK_CHAT[v.c] || 'gg');
          else game.showChat(FB.uid, QUICK_CHAT[v.c] || 'gg');
          break;
        case 'over':
          if (this.mode === 'coop') game.forceGameOver();
          break;
      }
    }));

    // ---- co-op enemy sync ----
    if (this.mode === 'coop') {
      game.onEnemyDamage = (id, dmg) => pushTransient('edmg', { id, dmg, from: FB.uid });
      this._unsubs.push(d.onChildAdded(this._ref('edmg'), (s) => {
        const v = s.val();
        if (!v || !fresh(v) || !game.isHost || v.from === FB.uid) return;
        game.applyEnemyDamageEvent(v.id, v.dmg, v.from);
      }));

      this._unsubs.push(d.onValue(this._ref('enemies'), (s) => {
        if (!game.isHost) game.setEnemySnapshot(s.val());
      }));

      this._unsubs.push(d.onChildAdded(this._ref('eshots'), (s) => {
        const v = s.val();
        if (!v || !fresh(v) || game.isHost) return;
        game.spawnEnemyShot(v);
      }));

      game.onOver = (results) => {
        if (game.isHost && !results.win) {
          pushTransient('events', { k: 'over' });
          d.update(this._ref('meta'), { state: 'ended' }).catch(() => {});
          d.update(this._idxRef(), { state: 'ended' }).catch(() => {});
        }
        if (this._onGameOver) this._onGameOver(results);
      };
    } else {
      game.onOver = (results) => {
        if (game.isHost) {
          d.update(this._ref('meta'), { state: 'ended' }).catch(() => {});
          d.update(this._idxRef(), { state: 'ended' }).catch(() => {});
        }
        if (this._onGameOver) this._onGameOver(results);
      };
    }

    // ---- pickups ----
    game.onPickupSpawn = (pk) => d.set(this._ref('pickups/' + pk.id), pk).catch(() => {});
    game.onPickupTaken = (id) => d.remove(this._ref('pickups/' + id)).catch(() => {});
    this._unsubs.push(d.onChildAdded(this._ref('pickups'), (s) => {
      const v = s.val();
      if (v) game.addPickup(v);
    }));
    this._unsubs.push(d.onChildRemoved(this._ref('pickups'), (s) => {
      game.removePickup(s.key);
    }));

    if (game.isHost) this._startHostLoops();

    // host flips the room to "playing" once the countdown elapses
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
    if (!game || this.mode !== 'coop') return;
    game.onWave = (n) => FB.d.update(this._ref('meta'), { wave: n }).catch(() => {});
    game.onEnemyShot = (spec) => {
      const r = FB.d.push(this._ref('eshots'), { ...spec, t: FB.serverNow() });
      setTimeout(() => FB.d.remove(r).catch(() => {}), 5000);
    };
    this._timers.push(setInterval(() => {
      if (game.isHost && !game.over) {
        FB.d.set(this._ref('enemies'), game.getEnemySnapshot()).catch(() => {});
      }
    }, GAME.enemySyncMs));
  }

  // ---------------- teardown ----------------
  async leave() {
    if (this._left) return;
    this._left = true;
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
    } catch { /* network teardown is best-effort */ }
    this.game = null;
  }
}
