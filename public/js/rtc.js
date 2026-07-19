// ============================================================
// WebRTC peer-to-peer mesh — the low-latency "fast lane".
//
// Firebase Realtime Database is still the backbone (matchmaking,
// authoritative hits/kills/bots/builds). On top of it, this mesh
// opens a *direct* UDP DataChannel between every pair of human
// players and carries the high-frequency position/aim packets over
// it. Direct P2P shaves the client→Google→client hop, so movement
// arrives in ~20–60ms instead of ~100–200ms.
//
//   • signaling (SDP + ICE) rides the RDB at rooms/{id}/sig/...
//   • STUN only (Google public) — no paid TURN server, so it stays
//     100% free. Peers behind strict NAT simply never open a channel
//     and keep flowing over RDB — automatic, invisible fallback.
//   • glare-free: the lexicographically smaller uid always offers.
//   • DataChannel is unordered + no-retransmit: for a stream of
//     positions, a dropped packet is worthless — you want the next
//     one, not a stale resend.
// ============================================================

import { FB } from './fb.js';

const RTC_CONFIG = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ],
};

export function rtcSupported() {
  return typeof RTCPeerConnection !== 'undefined';
}

export class Mesh {
  constructor(roomId) {
    this.roomId = roomId;
    this.me = FB.uid;
    this.peers = new Map();   // uid -> peer record
    this.onState = null;      // (uid, obj) => {}  incoming packet
    this._closed = false;
    this._started = false;
  }

  _ref(path) { return FB.d.ref(FB.db, `rooms/${this.roomId}/sig/${path}`); }

  async start(peerUids = []) {
    if (this._started || this._closed || !rtcSupported()) return;
    this._started = true;
    // clear any stale inbox from a previous session, and auto-clean on drop
    try { await FB.d.remove(this._ref(this.me)); } catch { /* ignore */ }
    try { FB.d.onDisconnect(this._ref(this.me)).remove(); } catch { /* ignore */ }
    for (const uid of peerUids) this.addPeer(uid);
  }

  addPeer(uid) {
    if (this._closed || !uid || uid === this.me || this.peers.has(uid)) return;
    if (!rtcSupported()) return;
    const peer = {
      uid,
      offerer: this.me < uid,   // deterministic: smaller uid creates the offer
      pc: null, dc: null, ready: false, remoteSet: false,
      pendingIce: [], unsubs: [],
    };
    this.peers.set(uid, peer);
    try { this._connect(peer); } catch { this.removePeer(uid); }
  }

  removePeer(uid) {
    const peer = this.peers.get(uid);
    if (!peer) return;
    this._teardown(peer);
    this.peers.delete(uid);
  }

  _connect(peer) {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    peer.pc = pc;

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        // my ICE goes into the peer's inbox, tagged from me
        FB.d.push(this._ref(`${peer.uid}/${this.me}/ice`), e.candidate.toJSON()).catch(() => {});
      }
    };
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === 'failed' || st === 'disconnected' || st === 'closed') peer.ready = false;
    };

    const wire = (dc) => {
      peer.dc = dc;
      dc.onopen = () => { peer.ready = true; };
      dc.onclose = () => { peer.ready = false; };
      dc.onmessage = (e) => {
        if (!this.onState) return;
        try { this.onState(peer.uid, JSON.parse(e.data)); } catch { /* ignore */ }
      };
    };

    if (peer.offerer) {
      wire(pc.createDataChannel('state', { ordered: false, maxRetransmits: 0 }));
      pc.createOffer()
        .then((o) => pc.setLocalDescription(o))
        .then(() => FB.d.set(this._ref(`${peer.uid}/${this.me}/desc`),
          { type: pc.localDescription.type, sdp: pc.localDescription.sdp }))
        .catch(() => {});
    } else {
      pc.ondatachannel = (e) => wire(e.channel);
    }

    // listen on MY inbox from this peer: sig/{me}/{peer}/{desc,ice}
    const inbox = `${this.me}/${peer.uid}`;
    peer.unsubs.push(FB.d.onValue(this._ref(`${inbox}/desc`), async (s) => {
      const desc = s.val();
      if (!desc || peer.remoteSet) return;
      try {
        await pc.setRemoteDescription(desc);
        peer.remoteSet = true;
        for (const c of peer.pendingIce) { try { await pc.addIceCandidate(c); } catch { /* ignore */ } }
        peer.pendingIce = [];
        if (!peer.offerer) {
          const a = await pc.createAnswer();
          await pc.setLocalDescription(a);
          FB.d.set(this._ref(`${peer.uid}/${this.me}/desc`), { type: a.type, sdp: a.sdp }).catch(() => {});
        }
      } catch { /* ignore */ }
    }));
    peer.unsubs.push(FB.d.onChildAdded(this._ref(`${inbox}/ice`), async (s) => {
      const c = s.val();
      if (!c) return;
      if (!peer.remoteSet) { peer.pendingIce.push(c); return; }
      try { await pc.addIceCandidate(c); } catch { /* ignore */ }
    }));
  }

  _teardown(peer) {
    for (const u of peer.unsubs) { try { u(); } catch { /* ignore */ } }
    peer.unsubs = [];
    try { peer.dc && peer.dc.close(); } catch { /* ignore */ }
    try { peer.pc && peer.pc.close(); } catch { /* ignore */ }
    peer.ready = false;
    // remove my outbound signaling to this peer's inbox
    FB.d.remove(this._ref(`${peer.uid}/${this.me}`)).catch(() => {});
  }

  broadcast(obj) {
    if (this._closed) return;
    let payload = null;
    for (const peer of this.peers.values()) {
      if (!peer.ready || !peer.dc || peer.dc.readyState !== 'open') continue;
      if (payload === null) payload = JSON.stringify(obj);
      try { peer.dc.send(payload); } catch { /* ignore */ }
    }
  }

  connectedCount() {
    let n = 0;
    for (const p of this.peers.values()) if (p.ready) n++;
    return n;
  }

  close() {
    if (this._closed) return;
    this._closed = true;
    for (const peer of this.peers.values()) this._teardown(peer);
    this.peers.clear();
    try { FB.d.onDisconnect(this._ref(this.me)).cancel(); } catch { /* ignore */ }
    FB.d.remove(this._ref(this.me)).catch(() => {});
  }
}
