// ============================================================
// Lobby stage — Fortnite-style 3D lineup for the lobby screen.
// Your character front-and-centre with slots beside for friends:
// filled slots show the player's actual skin (custom skins + your
// face photo included), empty slots glow as holographic pads.
// Runs its own small renderer + rAF loop only while visible.
// ============================================================

import * as THREE from './vendor/three.module.js';
import { buildCharacter, animateCharacter, makeNameSprite } from './chars.js';

export class LobbyStage {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 60);
    this.camera.position.set(0, 2.0, 7.4);
    this.camera.lookAt(0, 1.15, 0);

    this.scene.add(new THREE.HemisphereLight(0xbfd6ff, 0x2a1f4d, 1.05));
    const sun = new THREE.DirectionalLight(0xfff2cc, 1.25);
    sun.position.set(3, 6, 5);
    this.scene.add(sun);

    // stage floor: soft disc + rim glow
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(4.6, 4.6, 0.18, 40),
      new THREE.MeshLambertMaterial({ color: 0x2b2357 }));
    disc.position.y = -0.09;
    this.scene.add(disc);
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(4.6, 0.05, 8, 48),
      new THREE.MeshBasicMaterial({ color: 0x37e0ff }));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.02;
    this.scene.add(rim);

    this.chars = [];        // {char, dance, me}
    this.pads = [];         // holo pads for empty slots
    this.myDance = -1;
    this._raf = 0;
    this._last = 0;
    this._running = false;
  }

  _clear() {
    for (const c of this.chars) this.scene.remove(c.char.group);
    for (const p of this.pads) this.scene.remove(p);
    this.chars = [];
    this.pads = [];
  }

  // players: [{name, skin, me, face}] · slots: total pads to show (≥ players)
  setPlayers(players, slots = 4) {
    this._clear();
    const n = Math.max(slots, players.length);
    // me takes the centre-most slot; others fill outward
    const order = [...players].sort((a, b) => (b.me ? 1 : 0) - (a.me ? 1 : 0));
    const xs = [];
    for (let i = 0; i < n; i++) xs.push((i - (n - 1) / 2) * 2.25);
    xs.sort((a, b) => Math.abs(a) - Math.abs(b));   // centre first

    for (let i = 0; i < n; i++) {
      const x = xs[i];
      if (i < order.length) {
        const p = order[i];
        const char = buildCharacter(p.skin || 'scout', p.me && p.face ? { face: p.face } : {});
        char.group.position.set(x, 0, Math.abs(x) * 0.22);   // slight arc
        char.group.rotation.y = -x * 0.055;                  // face the camera
        const label = makeNameSprite(p.me ? `⭐ ${p.name}` : p.name, p.me ? '#ffd200' : '#ffffff');
        label.position.y = 2.5;
        char.group.add(label);
        this.scene.add(char.group);
        this.chars.push({ char, me: !!p.me, dance: -1 });
      } else {
        // empty slot: holographic pad waiting for a friend
        const pad = new THREE.Group();
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(0.62, 0.045, 8, 32),
          new THREE.MeshBasicMaterial({ color: 0x37e0ff, transparent: true, opacity: 0.5 }));
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 0.06;
        pad.add(ring);
        const plus = makeNameSprite('+', '#37e0ff');
        plus.position.y = 1.1;
        pad.add(plus);
        pad.position.set(x, 0, Math.abs(x) * 0.22);
        this.scene.add(pad);
        this.pads.push(pad);
      }
    }
    this._frame();          // reframe for the new lineup width
  }

  // cycle / set my dance (-1 = stop)
  dance(i) {
    this.myDance = i;
    for (const c of this.chars) if (c.me) c.dance = i;
  }

  _fit() {
    const w = this.canvas.clientWidth || 300;
    const h = this.canvas.clientHeight || 220;
    if (w !== this._w || h !== this._h) {
      this._w = w; this._h = h;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this._frame();
    }
  }

  // pull the camera back so the whole lineup fits the current viewport aspect
  // (fullscreen background: portrait phones need more distance than wide desktops)
  _frame() {
    const a = this.camera.aspect || 1.6;
    let halfW = 1.7;
    for (const c of this.chars) halfW = Math.max(halfW, Math.abs(c.char.group.position.x) + 1.2);
    for (const p of this.pads) halfW = Math.max(halfW, Math.abs(p.position.x) + 1.0);
    const vHalf = (this.camera.fov * Math.PI / 180) / 2;
    const distH = 1.75 / Math.tan(vHalf);                       // fit character height
    const hHalf = Math.atan(Math.tan(vHalf) * a);
    const distW = halfW / Math.tan(hHalf);                      // fit lineup width
    const dist = Math.min(22, Math.max(5.5, distW, distH));
    this.camera.position.set(0, 1.65, dist);
    this.camera.lookAt(0, 1.0, 0);
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._last = performance.now();
    const tick = (now) => {
      if (!this._running) return;
      const dt = Math.min(0.05, (now - this._last) / 1000);
      this._last = now;
      this._fit();
      const tm = now / 1000;
      for (const c of this.chars) {
        // idle sway for everyone; my character dances on demand
        animateCharacter(c.char, dt, 0, true, c.dance);
        if (c.dance < 0) c.char.group.rotation.y += Math.sin(tm * 0.6) * 0.0006;
      }
      for (const p of this.pads) {
        p.children[0].rotation.z = tm * 0.8;
        p.children[0].material.opacity = 0.35 + 0.2 * Math.sin(tm * 2.4);
      }
      this.renderer.render(this.scene, this.camera);
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }

  stop() {
    this._running = false;
    cancelAnimationFrame(this._raf);
  }
}
