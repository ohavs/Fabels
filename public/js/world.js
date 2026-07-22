// ============================================================
// 3D world builder — renderer, lighting and the four low-poly
// maps, all generated procedurally (no model files).
// Every solid box registers an AABB collider used by the
// shared physics in game.js, so all clients agree on geometry.
// ============================================================

import * as THREE from './vendor/three.module.js';
import { MAPS } from './config.js';
import { rng, TAU } from './util.js';

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
      // exact AABB of the rotated footprint (no phantom corners)
      let rw = w, rd = d;
      if (rotY) {
        const c = Math.abs(Math.cos(rotY)), s = Math.abs(Math.sin(rotY));
        rw = w * c + d * s;
        rd = w * s + d * c;
      }
      this.colliders.push({ x0: x - rw / 2, y0: y, z0: z - rd / 2, x1: x + rw / 2, y1: y + h, z1: z + rd / 2 });
    }
    return m;
  }

  // long diagonal ridge as stepped axis-aligned segments — visuals match colliders
  ridge(x, z, len, h, ang, color, thick = 1.8) {
    const segs = Math.max(2, Math.ceil(len / 3));
    for (let i = 0; i < segs; i++) {
      const t = (i - (segs - 1) / 2) * 3;
      this.box(x + Math.cos(ang) * t, 0, z + Math.sin(ang) * t, 3.2, h * (0.85 + Math.random() * 0.3), thick, color);
    }
  }

  cyl(x, y, z, r, h, color, { collide = true, seg = 8, emissive } = {}) {
    const g = new THREE.CylinderGeometry(r, r, h, seg);
    const m = new THREE.Mesh(g, mat(color, { emissive }));
    m.position.set(x, y + h / 2, z);
    m.castShadow = true;
    m.receiveShadow = true;
    this.scene.add(m);
    // tighter box than the circumscribed square: no invisible corner walls
    const cr = r * 0.78;
    if (collide) this.colliders.push({ x0: x - cr, y0: y, z0: z - cr, x1: x + cr, y1: y + h, z1: z + cr });
    return m;
  }

  cone(x, y, z, r, h, color, { collide = false, seg = 6, emissive, rotY = 0 } = {}) {
    const g = new THREE.ConeGeometry(r, h, seg);
    const m = new THREE.Mesh(g, mat(color, { emissive }));
    m.position.set(x, y + h / 2, z);
    m.rotation.y = rotY;
    m.castShadow = true;
    this.scene.add(m);
    const cr = r * 0.5; // cones taper — collide only with the thick core
    if (collide) this.colliders.push({ x0: x - cr, y0: y, z0: z - cr, x1: x + cr, y1: y + h * 0.8, z1: z + cr });
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

  // enterable building: four walls with a doorway, walkable flat roof
  room(x, z, w, d, h, wallColor, roofColor, doorSide = 'z') {
    const T = 0.35, doorW = 1.5, doorH = 2.3;
    // north/south walls (along X)
    for (const [zz, hasDoor] of [[z - d / 2, doorSide === '-z'], [z + d / 2, doorSide === 'z']]) {
      if (hasDoor) {
        const seg = (w - doorW) / 2;
        this.box(x - (doorW + seg) / 2, 0, zz, seg, h, T, wallColor);
        this.box(x + (doorW + seg) / 2, 0, zz, seg, h, T, wallColor);
        this.box(x, doorH, zz, doorW, h - doorH, T, wallColor); // lintel
      } else {
        this.box(x, 0, zz, w, h, T, wallColor);
        // window
        this.box(x, 1.1, zz + (zz > z ? 0.02 : -0.02), 1.4, 1, 0.1, 0x9fd8ef, { collide: false, shadow: false });
      }
    }
    // east/west walls (along Z)
    for (const [xx, hasDoor] of [[x - w / 2, doorSide === '-x'], [x + w / 2, doorSide === 'x']]) {
      if (hasDoor) {
        const seg = (d - doorW) / 2;
        this.box(xx, 0, z - (doorW + seg) / 2, T, h, seg, wallColor);
        this.box(xx, 0, z + (doorW + seg) / 2, T, h, seg, wallColor);
        this.box(xx, doorH, z, T, h - doorH, doorW, wallColor);
      } else {
        this.box(xx, 0, z, T, h, d, wallColor);
        this.box(xx + (xx > x ? 0.02 : -0.02), 1.1, z, 0.1, 1, 1.4, 0x9fd8ef, { collide: false, shadow: false });
      }
    }
    // walkable roof slab + parapet
    this.box(x, h, z, w + 0.5, 0.3, d + 0.5, roofColor);
    this.box(x, h + 0.3, z - d / 2 - 0.1, w + 0.5, 0.45, 0.25, roofColor);
    this.box(x, h + 0.3, z + d / 2 + 0.1, w + 0.5, 0.45, 0.25, roofColor);
    // interior cover
    this.crate(x + w / 4, 0, z - d / 4, 0.9);
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
    // plank seams (decal, non-colliding)
    this.box(x, y + s / 2, z, s * 1.01, 0.06, s * 0.2, 0x6f4e2e, { collide: false, shadow: false });
  }

  // ======================= low-poly prop toolkit =======================
  barrel(x, z, color = 0xc0392b) {
    this.cyl(x, 0, z, 0.4, 1.1, color, { seg: 8 });
    this.box(x, 0.35, z, 0.86, 0.08, 0.86, 0x2b2b30, { collide: false, shadow: false });
    this.box(x, 0.75, z, 0.86, 0.08, 0.86, 0x2b2b30, { collide: false, shadow: false });
  }

  barrelStack(x, z, color) {
    this.barrel(x, z, color); this.barrel(x + 0.9, z + 0.2, color);
    this.barrel(x + 0.45, z - 0.7, color);
  }

  // fence run of posts + two rails between (x1,z1)-(x2,z2)
  fence(x1, z1, x2, z2, color = 0x6f4e2e) {
    const dx = x2 - x1, dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    const n = Math.max(1, Math.round(len / 2));
    const ux = dx / len, uz = dz / len;
    for (let i = 0; i <= n; i++) {
      const px = x1 + ux * (len * i / n), pz = z1 + uz * (len * i / n);
      this.box(px, 0, pz, 0.16, 1.2, 0.16, color);
    }
    // two rails as one thin collider spanning the run
    const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
    const along = Math.abs(dx) > Math.abs(dz);
    for (const ry of [0.45, 0.95]) {
      if (along) this.box(cx, ry, cz, len, 0.12, 0.1, color, { collide: ry === 0.45 });
      else this.box(cx, ry, cz, 0.1, 0.12, len, color, { collide: ry === 0.45 });
    }
  }

  lamp(x, z, hue = 0xffe9a0, h = 4.4) {
    this.cyl(x, 0, z, 0.14, h, 0x3a3a44, { seg: 6 });
    this.box(x, h, z, 0.5, 0.5, 0.5, hue, { collide: false, emissive: hue, shadow: false });
    const l = new THREE.PointLight(hue, 3.5, 12);
    l.position.set(x, h, z);
    this.scene.add(l);
  }

  bush(x, z, s = 1, color = 0x2f8f4e) {
    this.box(x, 0, z, 1.1 * s, 0.9 * s, 1.1 * s, color, { collide: false });
    this.box(x + 0.4 * s, 0.1, z - 0.3 * s, 0.7 * s, 0.7 * s, 0.7 * s, color, { collide: false });
  }

  rock(x, z, s = 1, color = 0x8a8f99) {
    this.cone(x, 0, z, 1.1 * s, 1.4 * s, color, { collide: true, seg: 5, rotY: Math.random() * 3 });
  }

  bench(x, z, rotY = 0) {
    this.box(x, 0.4, z, 1.8, 0.14, 0.5, 0x8b5a2b, { rotY });
    this.box(x, 0.75, z - (rotY ? 0 : 0.2), 1.8, 0.4, 0.12, 0x8b5a2b, { collide: false, rotY });
  }

  // low sandbag cover
  sandbags(x, z, w = 2.4, rotY = 0) {
    this.box(x, 0, z, w, 0.9, 0.7, 0x9a8f5f, { rotY });
    this.box(x, 0.9, z, w * 0.7, 0.5, 0.7, 0x8a7f4f, { collide: false, rotY });
  }

  // shipping container (cargo cover), optionally stacked
  container(x, z, color, rotY = 0, stack = false) {
    this.box(x, 0, z, 6, 2.6, 2.6, color, { rotY });
    // ribs
    this.box(x, 1.3, z + (rotY ? 0 : 1.32), 6, 2.4, 0.06, 0x1e1e24, { collide: false, rotY, shadow: false });
    if (stack) this.box(x + (Math.random() - 0.5), 2.6, z, 6, 2.6, 2.6, color, { rotY });
  }

  // raised platform reachable by a stair on one side
  platform(x, z, w, d, h, color, stairDir = 'z') {
    this.box(x, 0, z, w, h, d, color);
    const sx = stairDir === 'x' ? x + w / 2 + 0.5 : stairDir === '-x' ? x - w / 2 - 0.5 : x;
    const sz = stairDir === 'z' ? z + d / 2 + 0.5 : stairDir === '-z' ? z - d / 2 - 0.5 : z;
    this.stairs(sx, 0, sz, stairDir, Math.ceil(h / 0.5), Math.min(w, d), color);
    this.nav(x, z, h + 0.2);
  }

  // low-poly car / vehicle cover
  car(x, z, color, rotY = 0) {
    this.box(x, 0.3, z, 3.6, 0.9, 1.7, color, { rotY });
    this.box(x, 1.2, z, 2.0, 0.7, 1.5, 0x2a3550, { collide: false, rotY });
    // wheels
    for (const [ox, oz] of [[1.2, 0.9], [1.2, -0.9], [-1.2, 0.9], [-1.2, -0.9]]) {
      const wx = x + (rotY ? oz : ox), wz = z + (rotY ? ox : oz);
      this.cyl(wx, 0, wz, 0.35, 0.3, 0x18181c, { collide: false, seg: 7 });
    }
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

    // arena boundary: low wall + tall VISIBLE holo-barrier (no more mystery walls)
    const wallC = 0x333a4d;
    const H = 30, half = S / 2, holoH = 9;
    const holoMat = new THREE.MeshBasicMaterial({
      color: 0x57c4e5, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false,
    });
    const holoEdge = new THREE.MeshBasicMaterial({
      color: 0x57c4e5, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false,
    });
    for (const [x, z, w, d, rot] of [
      [0, -half, S, 1, 0], [0, half, S, 1, 0], [-half, 0, 1, S, Math.PI / 2], [half, 0, 1, S, Math.PI / 2],
    ]) {
      this.box(x, 0, z, w, 1.4, d, wallC, { collide: false });
      this.colliders.push({ x0: x - w / 2, y0: 0, z0: z - d / 2, x1: x + w / 2, y1: H, z1: z + d / 2 });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(S, holoH), holoMat);
      plane.position.set(x, 1.4 + holoH / 2, z);
      plane.rotation.y = rot;
      this.scene.add(plane);
      const edge = new THREE.Mesh(new THREE.PlaneGeometry(S, 0.22), holoEdge);
      edge.position.set(x, 1.4 + holoH, z);
      edge.rotation.y = rot;
      this.scene.add(edge);
    }
  }

  _build() {
    this._base();
    const r = rng(0xc0ffee ^ this.mapId.split('').reduce((a, c) => a + c.charCodeAt(0), 0));
    ({
      town: this._town, mine: this._mine, port: this._port,
      canyon: this._canyon, city: this._city, ice: this._ice,
      towers: this._towers, maze: this._maze, dunes: this._dunes,
      island: this._island,
    })[this.mapId].call(this, r);
    // classic maps were designed for a smaller arena — fill the enlarged outer
    // band with themed cover + perimeter spawns so bigger doesn't mean emptier
    if (!['island', 'towers', 'maze', 'dunes'].includes(this.mapId)) this._outer(r);
    // scatter nav points between spawns
    const S = this.size;
    for (let i = 0; i < 18; i++) this.nav((r() - 0.5) * S * 0.82, (r() - 0.5) * S * 0.82);
  }

  // themed clutter in the outer ring of the (now larger) classic maps
  _outer(r) {
    const half = this.size / 2;
    const r0 = 27, r1 = half - 6;
    if (r1 <= r0 + 3) return;
    const ring = (fn, count) => {
      for (let i = 0; i < count; i++) {
        const a = r() * TAU, rad = r0 + r() * (r1 - r0);
        fn(Math.cos(a) * rad, Math.sin(a) * rad, a);
      }
    };
    switch (this.mapId) {
      case 'town':
        ring((x, z) => { if (r() < 0.4) this.house(x, z, 5 + r() * 2, 4 + r() * 1.5, 3.5 + r() * 1.5, 0xe8d8b8, 0x8e5b3a, r() * 0.6); else this.tree(x, z, 0.8 + r() * 0.7); }, 16);
        ring((x, z) => this.crate(x, 0, z, 1 + r() * 0.4), 6);
        ring((x, z) => this.lamp(x, z, 0xffe9a0), 3); break;
      case 'mine':
        ring((x, z) => { const c = [0xb478ff, 0x7dd3fc, 0xf472b6][(r() * 3) | 0]; this.cone(x, 0, z, 1 + r() * 0.8, 2.5 + r() * 3, c, { collide: true, emissive: c, rotY: r() * 3 }); }, 12);
        ring((x, z) => this.cyl(x, 0, z, 1.4 + r() * 1.2, 4 + r() * 5, 0x4a3d63, { seg: 7 }), 7); break;
      case 'port':
        ring((x, z) => this.container(x, z, [0xd35d47, 0x3d8bfd, 0x43aa8b, 0xf9c74f][(r() * 4) | 0], r() < 0.4 ? Math.PI / 2 : 0, r() < 0.4), 11);
        ring((x, z) => this.barrelStack(x, z, 0xf9a825), 5); break;
      case 'canyon':
        ring((x, z) => { if (r() < 0.45) { this.box(x, 0, z, 6 + r() * 3, 4 + r() * 4, 6 + r() * 3, 0xc4763f); this.box(x, 0, z, 8 + r() * 3, 2 + r() * 1.5, 8 + r() * 3, 0xa85f33); } else this.rock(x, z, 0.7 + r() * 0.7, 0x9a5a33); }, 12);
        ring((x, z) => { const h = 1.8 + r() * 1.4; this.cyl(x, 0, z, 0.35, h, 0x3f9b4f, { seg: 7 }); }, 6); break;
      case 'city':
        ring((x, z) => { const h = 6 + r() * 9, w = 7 + r() * 3; this.box(x, 0, z, w, h, w, [0x565678, 0x4a4a6b, 0x626287][(r() * 3) | 0]); const c = [0xff3e8a, 0x00d5ff, 0xffd200, 0x9d5cff][(r() * 4) | 0]; this.box(x, h - 0.8, z + w / 2 + 0.05, w * 0.85, 0.35, 0.12, c, { collide: false, emissive: c, shadow: false }); }, 11);
        ring((x, z) => this.car(x, z, [0xff3e8a, 0x00d5ff, 0xffd200][(r() * 3) | 0], r() * 0.5), 5); break;
      case 'ice':
        ring((x, z) => { if (r() < 0.5) { this.cyl(x, 0, z, 0.25, 1.3, 0x7a5c48, { seg: 6 }); this.cone(x, 1, z, 1.2, 2.8, 0xd8ecdf, { seg: 7 }); } else this.cone(x, 0, z, 1 + r(), 3 + r() * 3, 0xd6ecff, { collide: true, emissive: 0x9fccf5, rotY: r() * 3 }); }, 13);
        ring((x, z) => this.box(x, 0, z, 2 + r() * 1.5, 0.7, 2 + r() * 1.5, 0xeef6ff, { collide: false }), 5); break;
      default: break;
    }
    // perimeter spawns near the new border so fights use the whole map
    const s = half - 9;
    this.spawn(-s, -s); this.spawn(s, s); this.spawn(-s, s); this.spawn(s, -s);
    this.spawn(0, -s); this.spawn(0, s); this.spawn(-s, 0); this.spawn(s, 0);
  }

  // ═══════════ MAP 1: העיירה — sunny village with distinct districts ═══════════
  // zones: NW residential · centre plaza+fountain · NE church landmark ·
  //        SE market square · SW green park
  _town(r) {
    const houseCols = [0xf2d5a0, 0xe8b4b8, 0xbcd8c1, 0xd8d3cd, 0xf4e8c1];
    const roofCols = [0xc0392b, 0x8e5b3a, 0x6b4f9e, 0x3a6b8e];
    // roads (decals)
    this.box(0, 0.01, 0, this.size, 0.02, 8, 0xa79f90, { collide: false, shadow: false });
    this.box(0, 0.01, 0, 8, 0.02, this.size, 0xa79f90, { collide: false, shadow: false });

    // ---- centre: fountain plaza ----
    this.cyl(0, 0, 0, 3, 0.7, 0x9fb3cf);
    this.cyl(0, 0.7, 0, 0.6, 1.8, 0x7c93b4);
    this.box(0, 2.5, 0, 1.2, 0.4, 1.2, 0x9fb3cf, { collide: false });
    for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI * 2; this.lamp(Math.cos(a) * 5, Math.sin(a) * 5, 0xffe9a0, 4); }

    // ---- NW: residential cluster (enterable + roofs) ----
    this.room(-24, -14, 8, 6.5, 3.8, houseCols[0], roofCols[0], 'z');
    this.stairs(-19.4, 0, -17, 'x', 8, 2, 0xa98a6a); this.nav(-24, -14, 4.1);
    this.house(-13, -20, 6, 5.5, 4, houseCols[1], roofCols[1]);
    this.house(-26, -25, 6.5, 5, 4.5, houseCols[2], roofCols[2], 0.3);
    this.fence(-32, -8, -8, -8);
    for (let i = 0; i < 4; i++) this.bush(-30 + i * 6, -6, 1);

    // ---- NE: church landmark (tall spire, walkable base, bell tower) ----
    this.room(22, -18, 9, 8, 4.5, 0xe8e0d0, 0x8a5a3a, '-z');
    this.box(22, 0, -18, 3.4, 11, 3.4, 0xe0d8c8);           // tower
    const spire = new THREE.Mesh(new THREE.ConeGeometry(2.6, 5, 4), mat(0x6b4f9e));
    spire.position.set(22, 13.5, -18); spire.rotation.y = Math.PI / 4; spire.castShadow = true;
    this.scene.add(spire);
    this.box(22, 8.5, -18, 1.2, 1.6, 1.2, 0x3a3a30, { collide: false, emissive: 0xffe9a0 }); // bell window glow
    this.stairs(24.5, 0, -13.4, 'z', 9, 2.4, 0xcfc6b4);
    this.nav(22, -18, 4.6);

    // ---- SE: market square (stalls, barrels, crates, cover) ----
    for (let i = 0; i < 3; i++) {
      const mx = 12 + i * 8, mz = 16;
      this.box(mx, 0, mz, 4, 0.2, 3, 0x8b5a2b);                 // stall base
      this.box(mx - 1.7, 0, mz - 1.2, 0.2, 2.6, 0.2, 0x6f4e2e); // posts
      this.box(mx + 1.7, 0, mz - 1.2, 0.2, 2.6, 0.2, 0x6f4e2e);
      this.box(mx, 2.7, mz, 4.4, 0.3, 3.4, [0xd94f4f, 0x4f8fd9, 0xd9b64f][i], { collide: false }); // awning
      this.barrelStack(mx - 0.5, mz + 1.4, [0xc0392b, 0x2e8b57, 0xb08954][i]);
    }
    this.crate(20, 0, 22, 1.2); this.crate(21, 0, 22.6, 1.1); this.crate(20.5, 1.2, 22, 1);
    this.sandbags(8, 20, 3, Math.PI / 2);

    // ---- SW: green park (trees, benches, hedges, pond) ----
    const pond = new THREE.Mesh(new THREE.CircleGeometry(4, 20), mat(0x4a89b8));
    pond.rotation.x = -Math.PI / 2; pond.position.set(-20, 0.03, 18); this.scene.add(pond);
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; this.tree(-20 + Math.cos(a) * 8, 18 + Math.sin(a) * 8, 0.9 + r() * 0.5); }
    this.bench(-14, 12); this.bench(-26, 22, Math.PI / 2);
    this.fence(-32, 8, -8, 8);
    for (let i = 0; i < 5; i++) this.bush(-30 + i * 5, 10, 1.1);

    // scattered street cover + lamps along the roads
    for (let i = 0; i < 6; i++) this.crate(-24 + i * 9, 0, (r() < 0.5 ? -3 : 3), 1 + r() * 0.4);
    this.lamp(-8, 8, 0xffe9a0); this.lamp(8, -8, 0xffe9a0); this.car(6, 3, 0x4f8fd9);
    // edge trees
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; this.tree(Math.cos(a) * 33 + (r() - 0.5) * 3, Math.sin(a) * 33 + (r() - 0.5) * 3, 0.8 + r() * 0.6); }

    this.spawn(-30, -22); this.spawn(30, 22); this.spawn(-28, 24); this.spawn(28, -22);
    this.spawn(0, -28); this.spawn(0, 28); this.spawn(-16, 2); this.spawn(16, -2);
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
    // enterable mining shack
    this.room(-18, -10, 6, 5, 3.2, 0x6b5d8f, 0x4a3d63, 'x');
    this.nav(-18, -10, 0);
    this.spawn(-26, -26); this.spawn(26, 26); this.spawn(-26, 26); this.spawn(26, -26);
    this.spawn(0, -28); this.spawn(0, 28); this.spawn(-28, 0); this.spawn(28, 0);
  }

  // ═══════════ MAP 3: נמל החלל — sci-fi cargo port ═══════════
  _port(r) {
    const contCols = [0xd35d47, 0x3d8bfd, 0x43aa8b, 0xf9c74f, 0x9d4edd];
    // ---- SE cargo yard: neat container rows (maze cover), some stacked ----
    for (let i = 0; i < 10; i++) {
      const x = 6 + (i % 3) * 8;
      const z = 6 + Math.floor(i / 3) * 8;
      this.container(x, z, contCols[(r() * 5) | 0], r() < 0.3 ? Math.PI / 2 : 0, r() < 0.45);
    }
    // ---- centre: glowing landing pad ----
    this.cyl(0, 0, 0, 6, 0.3, 0x2b3a55);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(5, 0.18, 8, 32), mat(0x57c4e5, { emissive: 0x57c4e5 }));
    ring.position.set(0, 0.42, 0); ring.rotation.x = Math.PI / 2; this.scene.add(ring);
    const padLight = new THREE.PointLight(0x57c4e5, 6, 18); padLight.position.set(0, 3, 0); this.scene.add(padLight);
    // ---- NW: control tower (two-flight stair to a glowing cabin) ----
    this.box(-26, 0, 0, 5, 8, 5, 0x3f4f6e);
    this.box(-26, 8, 0, 7, 2.2, 7, 0x57c4e5, { emissive: 0x203a55 });
    this.stairs(-22.2, 0, 4.2, 'x', 6, 2.4, 0x51617f);
    this.stairs(-18, 3, 4.2, 'x', 6, 2.4, 0x51617f);
    this.nav(-26, 0, 10.2);
    // ---- N: loading crane over the yard ----
    this.box(16, 0, -8, 1, 12, 1, 0x8a929e);          // mast
    this.box(16, 0, 8, 1, 12, 1, 0x8a929e);
    this.box(16, 12, 0, 1.2, 1, 18, 0xf9c74f);        // jib
    this.box(16, 6, 0, 1.4, 0.3, 1.4, 0x2a2f3a, { collide: false }); // hook block
    // ---- catwalk spanning N-S with stair access ----
    this.box(-8, 3.4, 0, 2.6, 0.4, 26, 0x51617f);
    this.fence(-9.3, -13, -9.3, 13, 0x35404f);
    this.fence(-6.7, -13, -6.7, 13, 0x35404f);
    this.stairs(-8, 0, -14.5, 'z', 7, 2.6, 0x51617f);
    this.nav(-8, 3.8, 6);
    // ---- SW: fuel depot (barrels + pipes) ----
    for (let i = 0; i < 4; i++) this.barrelStack(-24 + i * 2.5, 20, 0xf9a825);
    this.box(-20, 1, 24, 8, 0.5, 0.5, 0x6a7280, { collide: false });
    // glowing pylons ring the arena
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      this.box(Math.cos(a) * 24, 0, Math.sin(a) * 24, 0.7, 5, 0.7, 0x57c4e5, { emissive: 0x2a5f75 });
    }
    this.spawn(-30, -24); this.spawn(30, 24); this.spawn(-30, 24); this.spawn(24, -24);
    this.spawn(0, -30); this.spawn(0, 30); this.spawn(28, 0); this.spawn(-26, -14);
  }

  // ═══════════ MAP 5: עיר הניאון — night city blocks ═══════════
  _city(r) {
    const neon = [0xff3e8a, 0x00d5ff, 0xffd200, 0x9d5cff];
    const bldg = [0x565678, 0x4a4a6b, 0x626287];
    // extra city glow so night reads as neon, not black
    this.scene.add(new THREE.AmbientLight(0x8888c0, 0.55));
    // building grid with streets between
    for (let gx = -1; gx <= 1; gx++) {
      for (let gz = -1; gz <= 1; gz++) {
        if (gx === 0 && gz === 0) continue; // central plaza stays open
        const x = gx * 22, z = gz * 22;
        const h = 7 + r() * 10;
        const w = 8 + r() * 3, d = 8 + r() * 3;
        this.box(x, 0, z, w, h, d, bldg[(r() * 3) | 0]);
        // neon edge strips on several faces + lit windows
        const c = neon[(r() * 4) | 0];
        this.box(x, h - 0.8, z + d / 2 + 0.05, w * 0.9, 0.35, 0.12, c, { collide: false, emissive: c, shadow: false });
        this.box(x, h - 0.8, z - d / 2 - 0.05, w * 0.9, 0.35, 0.12, c, { collide: false, emissive: c, shadow: false });
        this.box(x - w / 2 - 0.05, h * 0.5, z, 0.12, h * 0.7, 0.35, neon[(r() * 4) | 0], { collide: false, emissive: c, shadow: false });
        for (let wy = 1.6; wy < h - 1.4; wy += 2.1) {
          if (r() < 0.35) continue;
          this.box(x + (r() - 0.5) * w * 0.5, wy, z + d / 2 + 0.03, 0.9, 0.7, 0.06, 0xffe9a0, { collide: false, emissive: 0xffe9a0, shadow: false });
        }
        // some rooftops reachable via stairs
        if ((gx + gz) % 2 === 0 && h < 10) {
          this.stairs(x + w / 2 + 0.6, 0, z - 2, 'z', Math.ceil(h / 0.5), 2, 0x44445f);
          this.nav(x, z, h + 0.3);
        }
      }
    }
    // street decals
    this.box(0, 0.01, 0, this.size, 0.02, 6, 0x1c1c2c, { collide: false, shadow: false });
    this.box(0, 0.01, 0, 6, 0.02, this.size, 0x1c1c2c, { collide: false, shadow: false });
    // central plaza: holo-fountain + enterable kiosk
    this.cyl(0, 0, 0, 2.2, 0.5, 0x33334d);
    this.cone(0, 0.5, 0, 1, 3, 0x00d5ff, { collide: true, emissive: 0x00d5ff });
    const l = new THREE.PointLight(0x00d5ff, 8, 16);
    l.position.set(0, 3, 0);
    this.scene.add(l);
    this.room(11, -11, 6, 5, 3.2, 0x3a3a55, 0x26263a, '-x');
    // neon street signs + lamps
    for (let i = 0; i < 5; i++) {
      const x = -28 + i * 14, z = i % 2 ? 8.5 : -8.5;
      this.box(x, 0, z, 0.3, 4.5, 0.3, 0x44445f);
      const c = neon[i % 4];
      this.box(x, 4.5, z, 1.8, 0.9, 0.2, c, { collide: false, emissive: c, shadow: false });
      if (i % 2 === 0) {
        const lamp = new THREE.PointLight(c, 5, 13);
        lamp.position.set(x, 4.2, z);
        this.scene.add(lamp);
      }
    }
    // parked neon cars (cover) + roadside barriers
    for (let i = 0; i < 5; i++) this.car(-24 + i * 12, (r() < 0.5 ? -1 : 1) * (3 + r() * 2), neon[(r() * 4) | 0], r() * 0.4);
    for (let i = 0; i < 4; i++) {
      const bx = -18 + i * 12;
      this.box(bx, 0, 5, 2.4, 1, 0.5, 0x2a2a3d);
      this.box(bx, 1, 5, 2.4, 0.12, 0.5, neon[i % 4], { collide: false, emissive: neon[i % 4], shadow: false });
    }
    // holo billboards on two building faces
    this.box(-22, 9, -13.5, 5, 3, 0.2, 0xff3e8a, { collide: false, emissive: 0xff3e8a, shadow: false });
    this.box(22, 11, 13.5, 5, 3, 0.2, 0x00d5ff, { collide: false, emissive: 0x00d5ff, shadow: false });
    this.spawn(-30, -30); this.spawn(30, 30); this.spawn(-30, 30); this.spawn(30, -30);
    this.spawn(0, -32); this.spawn(0, 32); this.spawn(-32, 0); this.spawn(32, 0);
  }

  // ═══════════ MAP 6: האי הקפוא — frozen island ═══════════
  _ice(r) {
    // frozen lake decal (centre)
    const lake = new THREE.Mesh(new THREE.CircleGeometry(11, 32), mat(0xb8e0ff));
    lake.rotation.x = -Math.PI / 2;
    lake.position.y = 0.02;
    this.scene.add(lake);
    // ice spikes & boulders
    for (let i = 0; i < 12; i++) {
      const x = (r() - 0.5) * 54, z = (r() - 0.5) * 54;
      if (Math.hypot(x, z) < 13) continue;
      if (r() < 0.5) this.cone(x, 0, z, 1 + r(), 3 + r() * 3.5, 0xd6ecff, { collide: true, emissive: 0x9fccf5, rotY: r() * 3 });
      else this.cyl(x, 0, z, 1.4 + r(), 2 + r() * 2, 0xc4dff5, { seg: 7 });
    }
    // igloos (dome + entrance tunnel, solid)
    for (const [x, z, rot] of [[-18, 14, 0.6], [20, -12, -2.2]]) {
      const dome = new THREE.Mesh(new THREE.SphereGeometry(3, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xf4faff));
      dome.position.set(x, 0, z);
      dome.castShadow = true;
      this.scene.add(dome);
      this.colliders.push({ x0: x - 2.6, y0: 0, z0: z - 2.6, x1: x + 2.6, y1: 2.9, z1: z + 2.6 });
      this.cyl(x + Math.cos(rot) * 3.4, 0, z + Math.sin(rot) * 3.4, 1.1, 1.5, 0xe8f4ff, { seg: 8 });
    }
    // snowy pines
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU;
      const x = Math.cos(a) * 28 + (r() - 0.5) * 5, z = Math.sin(a) * 28 + (r() - 0.5) * 5;
      this.cyl(x, 0, z, 0.25, 1.3, 0x7a5c48, { seg: 6 });
      this.cone(x, 1, z, 1.2, 2.8, 0xd8ecdf, { seg: 7 });
    }
    // ice ridge walls (stepped segments — colliders match what you see)
    this.ridge(-6, -20, 16, 2.6, 0.3, 0xcfe6f8);
    this.ridge(10, 18, 14, 2.2, -0.5, 0xcfe6f8);
    this.room(-16, -8, 7, 6, 3.4, 0x9fb8cc, 0x718ea6, 'x');
    this.stairs(-11.6, 0, -11.4, 'x', 7, 2, 0x718ea6);
    this.nav(-16, -8, 0); this.nav(-16, -8, 3.7);
    // central frozen fort
    this.box(0, 0, 0, 6, 2, 6, 0xdcefff);
    this.stairs(-3.9, 0, 0, '-x', 4, 2.4, 0xc4dff5);
    this.nav(0, 0, 2.1);
    // ---- camp: crates, a campfire (warm light), supply barrels ----
    this.crate(16, 0, 6, 1.2, 0x9fb8cc); this.crate(17, 0, 6.6, 1.1, 0x9fb8cc); this.crate(16, 1.2, 6, 1, 0x9fb8cc);
    const fire = new THREE.PointLight(0xff8a3a, 5, 10); fire.position.set(-10, 1, -4); this.scene.add(fire);
    for (let i = 0; i < 4; i++) { const a = i / 4 * TAU; this.box(-10 + Math.cos(a) * 0.8, 0, -4 + Math.sin(a) * 0.8, 0.5, 0.4, 0.5, 0x5a4a3a, { collide: false }); }
    this.box(-10, 0.3, -4, 0.6, 0.6, 0.6, 0xff6a2a, { collide: false, emissive: 0xff6a2a, shadow: false });
    for (let i = 0; i < 3; i++) this.barrel(20 + i * 1.2, -8, 0x4a89b8);
    // ice-fishing hut
    this.room(-20, 6, 5, 4.5, 3, 0xbcd3e6, 0x7a94a8, 'z'); this.nav(-20, 6, 0);
    // snow drifts (low cover)
    for (let i = 0; i < 5; i++) this.box(-24 + r() * 48, 0, -24 + r() * 48, 2 + r() * 1.5, 0.7, 2 + r() * 1.5, 0xeef6ff, { collide: false });
    this.spawn(-28, -26); this.spawn(28, 26); this.spawn(-28, 26); this.spawn(28, -26);
    this.spawn(0, -30); this.spawn(0, 30); this.spawn(-30, 0); this.spawn(30, 0);
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
    // enterable desert outpost with roof access
    this.room(14, 8, 7, 6, 3.4, 0xd9a066, 0xa85f33, '-x');
    this.stairs(18.2, 0, 11.6, 'x', 7, 2, 0xa85f33);
    this.nav(14, 8, 0); this.nav(14, 8, 3.7);

    // ---- SW: mining camp (tents, crates, cart, barrels, wooden watchtower) ----
    for (let i = 0; i < 2; i++) {
      const tx = -22 + i * 6, tz = 22;
      const tent = new THREE.Mesh(new THREE.ConeGeometry(2.2, 2.6, 4), mat(i ? 0xb5651d : 0xcaa06a));
      tent.position.set(tx, 1.3, tz); tent.rotation.y = Math.PI / 4; tent.castShadow = true;
      this.scene.add(tent);
      this.colliders.push({ x0: tx - 1.4, y0: 0, z0: tz - 1.4, x1: tx + 1.4, y1: 2, z1: tz + 1.4 });
    }
    this.crate(-14, 0, 20, 1.2); this.crate(-13, 0, 20.6, 1.1); this.crate(-14, 1.2, 20, 1);
    this.barrelStack(-10, 22, 0x8a5a2b);
    this.box(-18, 0.3, 25, 2.4, 0.7, 1.4, 0x6f4e2e);   // cart body
    this.cyl(-19, 0, 25.9, 0.5, 0.4, 0x3a2a18, { collide: false, seg: 7 });
    this.cyl(-17, 0, 25.9, 0.5, 0.4, 0x3a2a18, { collide: false, seg: 7 });
    // wooden watchtower
    this.box(-26, 0, 14, 3, 5.5, 3, 0x8a6234);
    this.box(-26, 5.5, 14, 4.2, 0.4, 4.2, 0x6f4e2e);
    this.stairs(-23.4, 0, 11, '-z', 8, 2, 0x8a6234); this.nav(-26, 14, 5.7);

    // cacti (saguaro with arms) + rocks
    for (let i = 0; i < 8; i++) {
      const x = (r() - 0.5) * 56, z = (r() - 0.5) * 56;
      if (Math.hypot(x, z) < 9) continue;
      const h = 1.8 + r() * 1.4;
      this.cyl(x, 0, z, 0.35, h, 0x3f9b4f, { seg: 7 });
      if (r() < 0.5) { this.box(x + 0.5, h * 0.6, z, 0.9, 0.3, 0.3, 0x3f9b4f, { collide: false }); this.box(x + 0.9, h * 0.6, z, 0.3, 0.9, 0.3, 0x3f9b4f, { collide: false }); }
    }
    for (let i = 0; i < 6; i++) this.rock(-24 + r() * 48, -24 + r() * 48, 0.7 + r() * 0.6, 0x9a5a33);
    // dry river bed decal
    this.box(0, 0.01, 22, this.size, 0.02, 6, 0xcaa472, { collide: false, shadow: false });
    this.spawn(-30, -28); this.spawn(30, 28); this.spawn(-30, 28); this.spawn(30, -28);
    this.spawn(0, -30); this.spawn(0, 30); this.spawn(-30, 0); this.spawn(30, 0);
  }

  // ═══════════ MAP 7: האי שלי — flat creative island (a build canvas) ═══════════
  _island(r) {
    const S = this.size, half = S / 2;
    // sandy beach ring just inside the border (flat decal)
    this.box(0, 0.01, -half + 3, S, 0.02, 6, 0xf0dfa8, { collide: false, shadow: false });
    this.box(0, 0.01, half - 3, S, 0.02, 6, 0xf0dfa8, { collide: false, shadow: false });
    this.box(-half + 3, 0.01, 0, 6, 0.02, S, 0xf0dfa8, { collide: false, shadow: false });
    this.box(half - 3, 0.01, 0, 6, 0.02, S, 0xf0dfa8, { collide: false, shadow: false });
    // faint 3m build-grid decals so builders can line pieces up
    for (let i = -4; i <= 4; i++) {
      this.box(i * 9, 0.005, 0, 0.14, 0.01, S - 14, 0x79b95a, { collide: false, shadow: false });
      this.box(0, 0.005, i * 9, S - 14, 0.01, 0.14, 0x79b95a, { collide: false, shadow: false });
    }
    // central marker plaza
    this.cyl(0, 0, 0, 2.4, 0.18, 0x9fd9b8, { collide: false, seg: 16 });
    // palms around the beach + a few rocks — decoration only, canvas stays clear
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * Math.PI * 2;
      this.tree(Math.cos(a) * (half - 5) + (r() - 0.5) * 3, Math.sin(a) * (half - 5) + (r() - 0.5) * 3, 0.9 + r() * 0.5);
    }
    this.rock(-half + 7, half - 9, 0.8, 0x9aa8b0); this.rock(half - 8, -half + 8, 0.7, 0x9aa8b0);
    this.lamp(-6, -6, 0xffe9a0); this.lamp(6, 6, 0xffe9a0);
    // spawns spread around the canvas
    this.spawn(-12, -12); this.spawn(12, 12); this.spawn(-12, 12); this.spawn(12, -12);
    this.spawn(0, -20); this.spawn(0, 20); this.spawn(-20, 0); this.spawn(20, 0);
  }

  // ═══════════ MAP 8: מגדלי הקרב — vertical high-ground fortress ═══════════
  _towers(r) {
    const core = 0x555a6b, deck = 0x6a7080, neon = 0x8ab4ff;
    // ---- ground level: cover for low fights ----
    for (let i = 0; i < 12; i++) this.crate(-34 + r() * 68, 0, -34 + r() * 68, 1 + r() * 0.5, 0x4a4f60);
    for (let i = 0; i < 4; i++) { const a = i / 4 * TAU; this.sandbags(Math.cos(a) * 15, Math.sin(a) * 15, 3, i % 2 ? Math.PI / 2 : 0); }
    this.lamp(-18, 18, neon, 5); this.lamp(18, -18, neon, 5);

    // ---- central keep: deck @6, upper core @12, glowing spire ----
    this.platform(0, 0, 12, 12, 6, core, 'z');
    this.box(0, 6, 0, 6, 6, 6, core);                 // upper core up to 12
    this.stairs(0, 6, 4.6, 'z', 12, 3, deck);         // deck (6) → roof (12)
    this.box(0, 12, 0, 7.5, 0.4, 7.5, deck);          // roof slab
    this.crate(2.4, 12, 2.4, 1, deck); this.crate(-2.4, 12, -2.4, 1, deck);
    const spire = new THREE.Mesh(new THREE.ConeGeometry(2.2, 5, 6), mat(neon, { emissive: neon }));
    spire.position.set(0, 14.9, 0); spire.castShadow = true; this.scene.add(spire);
    const beacon = new THREE.PointLight(neon, 7, 34); beacon.position.set(0, 16, 0); this.scene.add(beacon);
    this.nav(0, 0, 6); this.nav(0, 0, 12);

    // ---- 4 axis towers @6, each bridged to the centre deck ----
    for (const [x, z, sd] of [[0, -26, '-z'], [0, 26, 'z'], [26, 0, 'x'], [-26, 0, '-x']]) {
      this.platform(x, z, 9, 9, 6, core, sd);         // reachable from the ground
      this.crate(x + 2.2, 6, z, 1, deck); this.crate(x - 2.2, 6, z, 1, deck);
      if (x === 0) {                                   // bridge along Z
        const z0 = Math.sign(z) * 6, z1 = z - Math.sign(z) * 4.5, cz = (z0 + z1) / 2, len = Math.abs(z1 - z0);
        this.box(0, 6, cz, 3, 0.3, len, deck);
        this.box(0, 6.55, cz, 3.4, 0.12, len, neon, { collide: false, emissive: neon, shadow: false });
      } else {                                         // bridge along X
        const x0 = Math.sign(x) * 6, x1 = x - Math.sign(x) * 4.5, cx = (x0 + x1) / 2, len = Math.abs(x1 - x0);
        this.box(cx, 6, 0, len, 0.3, 3, deck);
        this.box(cx, 6.55, 0, len, 0.12, 3.4, neon, { collide: false, emissive: neon, shadow: false });
      }
    }
    this.spawn(-36, -36); this.spawn(36, 36); this.spawn(-36, 36); this.spawn(36, -36);
    this.spawn(0, -38); this.spawn(0, 38); this.spawn(-38, 0); this.spawn(38, 0);
  }

  // ═══════════ MAP 9: המבוך — walled CQB compound ═══════════
  _maze(r) {
    const wc = 0x555c66, wc2 = 0x47505a, roof = 0x3a4048;
    // ring of buildings — some enterable (door + walkable roof), some solid
    for (const [x, z] of [[-26, -26], [0, -26], [26, -26], [-26, 0], [26, 0], [-26, 26], [0, 26], [26, 26]]) {
      if (r() < 0.6) {
        this.room(x, z, 8, 8, 4, wc, roof, ['z', '-z', 'x', '-x'][(r() * 4) | 0]);
        this.stairs(x + 4.6, 0, z - 2, 'z', 9, 2, wc2);
        this.nav(x, z, 4.3);
      } else {
        this.box(x, 0, z, 8, 3.5 + r() * 2.5, 8, wc2);
      }
    }
    // central objective platform + sandbag cover
    this.platform(0, 0, 9, 9, 2.5, wc, 'x');
    for (let i = 0; i < 4; i++) { const a = i / 4 * TAU; this.sandbags(Math.cos(a) * 4, Math.sin(a) * 4, 2.4, i % 2 ? Math.PI / 2 : 0); }
    // connecting corridor walls (cover + sightline breaks)
    const wall = (x, z, w, d) => this.box(x, 0, z, w, 3, d, wc2);
    wall(-13, -26, 5, 0.6); wall(13, -26, 5, 0.6); wall(-26, -13, 0.6, 5); wall(26, 13, 0.6, 5);
    wall(-13, 26, 5, 0.6); wall(13, 13, 5, 0.6); wall(0, 14, 0.6, 5); wall(-14, 0, 5, 0.6);
    // scattered crates / barrels
    for (let i = 0; i < 14; i++) {
      const x = -32 + r() * 64, z = -32 + r() * 64;
      if (Math.hypot(x, z) < 6) continue;
      if (r() < 0.6) this.crate(x, 0, z, 1 + r() * 0.4, 0x6a5a3a); else this.barrel(x, z, 0x8a5a2b);
    }
    this.lamp(-14, -14, 0xffe0a0); this.lamp(14, 14, 0xffe0a0);
    this.lamp(14, -14, 0xffe0a0); this.lamp(-14, 14, 0xffe0a0);
    this.spawn(-34, -34); this.spawn(34, 34); this.spawn(-34, 34); this.spawn(34, -34);
    this.spawn(0, -36); this.spawn(0, 36); this.spawn(-36, 0); this.spawn(36, 0);
  }

  // ═══════════ MAP 10: הדיונות — vast open desert, long-range ═══════════
  _dunes(r) {
    const sand = 0xe0b877, rock = 0xb98a52, rock2 = 0x9a6f3f, acc = 0xe07a5f;
    // rolling dune mounds (wide low cones)
    for (let i = 0; i < 10; i++) {
      const x = (r() - 0.5) * 92, z = (r() - 0.5) * 92;
      if (Math.hypot(x, z) < 12) continue;
      this.cone(x, 0, z, 5 + r() * 4, 3 + r() * 2.5, sand, { collide: true, seg: 6, rotY: r() * 3 });
    }
    // big rock formations (cover + low high-ground)
    for (let i = 0; i < 5; i++) {
      const x = (r() - 0.5) * 82, z = (r() - 0.5) * 82;
      if (Math.hypot(x, z) < 15) continue;
      this.box(x, 0, z, 6 + r() * 4, 3 + r() * 3, 6 + r() * 4, rock);
      this.box(x, 0, z, 9 + r() * 3, 1.5, 9 + r() * 3, rock2);
    }
    // central ruin: broken pillar ring + raised platform (mid high-ground)
    this.platform(0, 0, 10, 10, 3, rock, 'x');
    for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; this.box(Math.cos(a) * 8, 0, Math.sin(a) * 8, 1.4, 4 + r() * 3, 1.4, rock2); }
    this.box(0, 3, 0, 2, 3, 2, acc, { emissive: 0x5a2a1a });
    // oasis with palms
    const oasis = new THREE.Mesh(new THREE.CircleGeometry(5, 20), mat(0x3a89a8));
    oasis.rotation.x = -Math.PI / 2; oasis.position.set(-30, 0.03, 26); this.scene.add(oasis);
    for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; this.tree(-30 + Math.cos(a) * 7, 26 + Math.sin(a) * 7, 0.9 + r() * 0.5); }
    // sparse cover: cacti, rocks, a wreck
    for (let i = 0; i < 10; i++) {
      const x = (r() - 0.5) * 98, z = (r() - 0.5) * 98;
      if (Math.hypot(x, z) < 10) continue;
      if (r() < 0.5) { const h = 1.8 + r() * 1.4; this.cyl(x, 0, z, 0.35, h, 0x4f8f4f, { seg: 7 }); }
      else this.rock(x, z, 0.8 + r() * 0.8, rock2);
    }
    this.car(10, -12, 0x8a6a4a, 0.4);
    // ruined arch landmark
    this.box(22, 0, -22, 2, 7, 2, rock2); this.box(30, 0, -22, 2, 7, 2, rock2); this.box(26, 7, -22, 10, 1.6, 2.4, rock);
    this.spawn(-42, -42); this.spawn(42, 42); this.spawn(-42, 42); this.spawn(42, -42);
    this.spawn(0, -44); this.spawn(0, 44); this.spawn(-44, 0); this.spawn(44, 0);
  }
}
