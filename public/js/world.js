// ============================================================
// 3D world builder — renderer, lighting and the four low-poly
// maps, all generated procedurally (no model files).
// Every solid box registers an AABB collider used by the
// shared physics in game.js, so all clients agree on geometry.
// ============================================================

import * as THREE from './vendor/three.module.js';
import { MAPS } from './config.js';
import { rng } from './util.js';

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}

// one reusable box geometry; materials cached per color
const BOX = new THREE.BoxGeometry(1, 1, 1);
const matCache = new Map();
export function mat(color, opts = {}) {
  const key = color + '|' + (opts.emissive || 0) + '|' + (opts.flat ? 1 : 0);
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshLambertMaterial({
      color,
      emissive: opts.emissive || 0x000000,
      emissiveIntensity: opts.emissiveIntensity ?? 0.6,
    }));
  }
  return matCache.get(key);
}

export class World {
  constructor(mapId) {
    this.mapId = mapId;
    this.cfg = MAPS[mapId];
    this.scene = new THREE.Scene();
    this.colliders = [];   // {x0,y0,z0,x1,y1,z1}
    this.spawns = [];
    this.navPoints = [];
    this.size = this.cfg.size;
    this._build();
  }

  // ---- construction helpers ----
  box(x, y, z, w, h, d, color, { collide = true, rotY = 0, shadow = true, emissive } = {}) {
    const m = new THREE.Mesh(BOX, mat(color, { emissive }));
    m.position.set(x, y + h / 2, z);
    m.scale.set(w, h, d);
    if (rotY) m.rotation.y = rotY;
    m.castShadow = shadow;
    m.receiveShadow = true;
    this.scene.add(m);
    if (collide) {
      // rotated boxes get a conservative AABB
      const rw = rotY ? Math.max(w, d) : w, rd = rotY ? Math.max(w, d) : d;
      this.colliders.push({ x0: x - rw / 2, y0: y, z0: z - rd / 2, x1: x + rw / 2, y1: y + h, z1: z + rd / 2 });
    }
    return m;
  }

  cyl(x, y, z, r, h, color, { collide = true, seg = 8, emissive } = {}) {
    const g = new THREE.CylinderGeometry(r, r, h, seg);
    const m = new THREE.Mesh(g, mat(color, { emissive }));
    m.position.set(x, y + h / 2, z);
    m.castShadow = true;
    m.receiveShadow = true;
    this.scene.add(m);
    if (collide) this.colliders.push({ x0: x - r, y0: y, z0: z - r, x1: x + r, y1: y + h, z1: z + r });
    return m;
  }

  cone(x, y, z, r, h, color, { collide = false, seg = 6, emissive, rotY = 0 } = {}) {
    const g = new THREE.ConeGeometry(r, h, seg);
    const m = new THREE.Mesh(g, mat(color, { emissive }));
    m.position.set(x, y + h / 2, z);
    m.rotation.y = rotY;
    m.castShadow = true;
    this.scene.add(m);
    if (collide) this.colliders.push({ x0: x - r * 0.7, y0: y, z0: z - r * 0.7, x1: x + r * 0.7, y1: y + h, z1: z + r * 0.7 });
    return m;
  }

  // staircase out of step boxes (walkable thanks to physics step-up)
  stairs(x, y, z, dir, steps, stepW, color) {
    for (let i = 0; i < steps; i++) {
      const h = 0.5 * (i + 1);
      const off = i * 0.9 + 0.45;
      const dx = dir === 'x' ? off : dir === '-x' ? -off : 0;
      const dz = dir === 'z' ? off : dir === '-z' ? -off : 0;
      const w = dir.includes('x') ? 0.9 : stepW;
      const d = dir.includes('z') ? 0.9 : stepW;
      this.box(x + dx, y, z + dz, w, h, d, color);
    }
  }

  house(x, z, w, d, h, wallColor, roofColor, rotY = 0) {
    this.box(x, 0, z, w, h, d, wallColor, { rotY });
    const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.72, h * 0.6, 4), mat(roofColor));
    roof.position.set(x, h + h * 0.3, z);
    roof.rotation.y = Math.PI / 4 + rotY;
    roof.castShadow = true;
    this.scene.add(roof);
    // door decal
    const door = new THREE.Mesh(BOX, mat(0x4a3728));
    door.scale.set(0.9, 1.6, 0.12);
    door.position.set(x + Math.sin(rotY) * (d / 2), 0.8, z + Math.cos(rotY) * (d / 2));
    this.scene.add(door);
  }

  tree(x, z, s = 1) {
    this.cyl(x, 0, z, 0.22 * s, 1.4 * s, 0x8b5a2b, { seg: 6 });
    this.cone(x, 1.1 * s, z, 1.1 * s, 2.4 * s, 0x2e8b57, { seg: 7 });
  }

  crate(x, y, z, s, color = 0xb08954) {
    this.box(x, y, z, s, s, s, color, { rotY: 0 });
  }

  spawn(x, z, y = 0) { this.spawns.push({ x, y, z }); this.navPoints.push({ x, y, z }); }
  nav(x, z, y = 0) { this.navPoints.push({ x, y, z }); }

  // ---- shared environment ----
  _base() {
    const { sky, fog, sun, ground } = this.cfg;
    const S = this.size;
    this.scene.background = new THREE.Color(sky);
    this.scene.fog = new THREE.Fog(fog, S * 0.55, S * 1.7);

    const hemi = new THREE.HemisphereLight(0xffffff, ground, 1.25);
    this.scene.add(hemi);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    const dir = new THREE.DirectionalLight(sun, 2.2);
    dir.position.set(S * 0.4, S * 0.7, S * 0.25);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    const c = S * 0.75;
    Object.assign(dir.shadow.camera, { left: -c, right: c, top: c, bottom: -c, near: 1, far: S * 2.2 });
    dir.shadow.bias = -0.002;
    this.scene.add(dir);

    // ground
    const g = new THREE.Mesh(new THREE.PlaneGeometry(S * 3, S * 3), mat(ground));
    g.rotation.x = -Math.PI / 2;
    g.receiveShadow = true;
    this.scene.add(g);

    // arena boundary: visible low wall + invisible tall collider
    const wallC = 0x333a4d;
    const H = 30, half = S / 2;
    for (const [x, z, w, d] of [
      [0, -half, S, 1], [0, half, S, 1], [-half, 0, 1, S], [half, 0, 1, S],
    ]) {
      this.box(x, 0, z, w, 1.4, d, wallC, { collide: false });
      this.colliders.push({ x0: x - w / 2, y0: 0, z0: z - d / 2, x1: x + w / 2, y1: H, z1: z + d / 2 });
    }
  }

  _build() {
    this._base();
    const r = rng(0xc0ffee ^ this.mapId.split('').reduce((a, c) => a + c.charCodeAt(0), 0));
    ({ town: this._town, mine: this._mine, port: this._port, canyon: this._canyon })[this.mapId].call(this, r);
    // scatter nav points between spawns
    const S = this.size;
    for (let i = 0; i < 14; i++) this.nav((r() - 0.5) * S * 0.8, (r() - 0.5) * S * 0.8);
  }

  // ═══════════ MAP 1: העיירה — sunny village ═══════════
  _town(r) {
    const houseCols = [0xf2d5a0, 0xe8b4b8, 0xbcd8c1, 0xd8d3cd, 0xf4e8c1];
    const roofCols = [0xc0392b, 0x8e5b3a, 0x6b4f9e, 0x3a6b8e];
    // two rows of houses along a main street
    for (let i = 0; i < 4; i++) {
      const x = -22 + i * 15;
      this.house(x, -12, 6 + r() * 2, 5.5, 4 + r() * 1.5, houseCols[i % 5], roofCols[i % 4]);
      this.house(x + 6, 12, 6 + r() * 2, 5.5, 4 + r() * 1.5, houseCols[(i + 2) % 5], roofCols[(i + 1) % 4]);
    }
    // street decals
    this.box(0, 0.01, 0, this.size, 0.02, 7, 0x9a9a94, { collide: false, shadow: false });
    // central fountain plaza
    this.cyl(0, 0, 0, 2.4, 0.7, 0x8fa8c8);
    this.cyl(0, 0.7, 0, 0.5, 1.4, 0x6f8cb0);
    // watchtower with stairs to the top
    this.box(24, 0, 0, 4, 6.5, 4, 0x9b7653);
    this.box(24, 6.5, 0, 5.4, 0.5, 5.4, 0x7a5c3f);
    this.stairs(20.5, 0, -3.4, '-x', 7, 2, 0xa98a6a);
    this.nav(24, 0, 7);
    // crates & low cover in the street
    for (let i = 0; i < 8; i++) {
      const x = -26 + r() * 52, z = -3.2 + r() * 6.4;
      this.crate(x, 0, z, 1.1 + r() * 0.5);
    }
    this.box(-10, 0, 4.5, 4, 1.1, 0.8, 0xc8c2b8);
    this.box(12, 0, -4.5, 4, 1.1, 0.8, 0xc8c2b8);
    // trees around the edges
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      this.tree(Math.cos(a) * 30 + (r() - 0.5) * 4, Math.sin(a) * 30 + (r() - 0.5) * 4, 0.8 + r() * 0.7);
    }
    // spawns: village corners + tower area
    this.spawn(-30, -20); this.spawn(30, 20); this.spawn(-30, 20); this.spawn(30, -20);
    this.spawn(0, -26); this.spawn(0, 26); this.spawn(-16, 0); this.spawn(18, 6);
  }

  // ═══════════ MAP 2: מכרה הגבישים — glowing crystal cave ═══════════
  _mine(r) {
    // crystal clusters (emissive)
    const crysCols = [0xb478ff, 0x7dd3fc, 0xf472b6];
    for (let i = 0; i < 12; i++) {
      const x = (r() - 0.5) * 52, z = (r() - 0.5) * 52;
      if (Math.hypot(x, z) < 7) continue;
      const c = crysCols[(r() * 3) | 0];
      this.cone(x, 0, z, 1 + r() * 0.8, 2.5 + r() * 3, c, { collide: true, emissive: c, rotY: r() * 3 });
      this.cone(x + 1.2, 0, z - 0.6, 0.6, 1.6 + r(), c, { emissive: c, rotY: r() * 3 });
      if (r() < 0.5) {
        const l = new THREE.PointLight(c, 6, 12);
        l.position.set(x, 2.2, z);
        this.scene.add(l);
      }
    }
    // rock pillars
    for (let i = 0; i < 9; i++) {
      const x = (r() - 0.5) * 50, z = (r() - 0.5) * 50;
      if (Math.hypot(x, z) < 6) continue;
      this.cyl(x, 0, z, 1.6 + r() * 1.4, 5 + r() * 6, 0x4a3d63, { seg: 7 });
    }
    // central raised platform with two staircases
    this.box(0, 0, 0, 10, 2.6, 10, 0x554a75);
    this.stairs(-6.2, 0, 0, '-x', 5, 3, 0x6b5d8f);
    this.stairs(6.2, 0, 0, 'x', 5, 3, 0x6b5d8f);
    this.cone(0, 2.6, 0, 1.4, 4.5, 0xb478ff, { collide: true, emissive: 0xb478ff });
    this.nav(0, 0, 2.6);
    // bridges
    this.box(0, 1.6, 16, 3, 0.5, 14, 0x6b5d8f);
    this.stairs(0, 0, 8.4, 'z', 4, 3, 0x6b5d8f);
    // mine carts (cover)
    for (let i = 0; i < 5; i++) {
      this.box(-20 + i * 10, 0, (r() - 0.5) * 30, 2.2, 1.3, 1.4, 0x5c5c66, { rotY: r() });
    }
    this.spawn(-26, -26); this.spawn(26, 26); this.spawn(-26, 26); this.spawn(26, -26);
    this.spawn(0, -28); this.spawn(0, 28); this.spawn(-28, 0); this.spawn(28, 0);
  }

  // ═══════════ MAP 3: נמל החלל — sci-fi cargo port ═══════════
  _port(r) {
    const contCols = [0xd35d47, 0x3d8bfd, 0x43aa8b, 0xf9c74f, 0x9d4edd];
    // container rows — some stacked two high
    for (let i = 0; i < 12; i++) {
      const x = -25 + (i % 4) * 16 + (r() - 0.5) * 3;
      const z = -18 + Math.floor(i / 4) * 18 + (r() - 0.5) * 3;
      const c1 = contCols[(r() * 5) | 0];
      this.box(x, 0, z, 6, 2.6, 2.6, c1, { rotY: r() < 0.3 ? Math.PI / 2 : 0 });
      if (r() < 0.5) this.box(x + (r() - 0.5), 2.6, z, 6, 2.6, 2.6, contCols[(r() * 5) | 0]);
    }
    // landing pad (glowing ring)
    this.cyl(0, 0, 0, 6, 0.3, 0x2b3a55);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(5, 0.18, 8, 32), mat(0x57c4e5, { emissive: 0x57c4e5 }));
    ring.position.set(0, 0.42, 0);
    ring.rotation.x = Math.PI / 2;
    this.scene.add(ring);
    // control tower with stair access
    this.box(-26, 0, 0, 5, 8, 5, 0x3f4f6e);
    this.box(-26, 8, 0, 7, 2.2, 7, 0x57c4e5, { emissive: 0x203a55 });
    this.stairs(-22.2, 0, 4.2, 'x', 6, 2.4, 0x51617f);
    this.stairs(-18, 3, 4.2, 'x', 6, 2.4, 0x51617f); // upper flight continues
    // catwalk
    this.box(14, 3.4, 0, 2.4, 0.4, 26, 0x51617f);
    this.stairs(14, 0, -14.5, 'z', 7, 2.4, 0x51617f);
    // glowing pylons
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      this.box(Math.cos(a) * 20, 0, Math.sin(a) * 20, 0.7, 4.5, 0.7, 0x57c4e5, { emissive: 0x2a5f75 });
    }
    this.spawn(-30, -24); this.spawn(30, 24); this.spawn(-30, 24); this.spawn(30, -24);
    this.spawn(0, -30); this.spawn(0, 30); this.spawn(26, 0); this.spawn(-14, -10);
    this.nav(14, 3.8, 8); this.nav(-26, 10.2, 0);
  }

  // ═══════════ MAP 4: קניון האש — desert mesas ═══════════
  _canyon(r) {
    const rock = 0xc4763f, rock2 = 0xa85f33;
    // big mesas
    for (const [x, z, w, h, d] of [
      [-20, -16, 10, 7, 9], [22, 14, 12, 9, 10], [-18, 18, 9, 5, 8], [18, -18, 8, 6, 8], [0, 0, 7, 3.2, 7],
    ]) {
      this.box(x, 0, z, w, h, d, rock);
      this.box(x, 0, z, w + 2.4, h * 0.45, d + 2.4, rock2); // wider base tier
    }
    // stairs up the central mesa
    this.stairs(-4.8, 0, 0, '-x', 6, 3, rock2);
    this.nav(0, 3.2, 0);
    // rock arch
    this.box(6, 0, -8, 1.6, 6, 1.6, rock2);
    this.box(12, 0, -8, 1.6, 6, 1.6, rock2);
    this.box(9, 6, -8, 8, 1.4, 2, rock);
    // cacti + barrels
    for (let i = 0; i < 8; i++) {
      const x = (r() - 0.5) * 56, z = (r() - 0.5) * 56;
      if (Math.hypot(x, z) < 8) continue;
      this.cyl(x, 0, z, 0.35, 1.8 + r() * 1.4, 0x3f9b4f, { seg: 7 });
    }
    for (let i = 0; i < 6; i++) {
      this.cyl(-24 + r() * 48, 0, -24 + r() * 48, 0.6, 1.1, 0x8a3324);
    }
    // dry river bed decal
    this.box(0, 0.01, 22, this.size, 0.02, 6, 0xcaa472, { collide: false, shadow: false });
    this.spawn(-30, -28); this.spawn(30, 28); this.spawn(-30, 28); this.spawn(30, -28);
    this.spawn(0, -30); this.spawn(0, 30); this.spawn(-30, 0); this.spawn(30, 0);
  }
}
