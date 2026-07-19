// ============================================================
// Procedural low-poly weapon models + combat visual effects
// (tracers, muzzle flashes, impact sparks, plasma orbs).
// Models are built from boxes/cylinders — no asset files.
// All meshes point down -Z (the character/camera forward).
// ============================================================

import * as THREE from './vendor/three.module.js';
import { WEAPONS } from './config.js';
import { mat } from './world.js';

const BOX = new THREE.BoxGeometry(1, 1, 1);
const UNIT_CYL = new THREE.CylinderGeometry(1, 1, 1, 10);   // unit cylinder along +Y

// shared low-poly gun palette (cached materials, so reuse is cheap)
const COL = {
  dark: 0x24272d, metal: 0x3a3f48, black: 0x16181c, steel: 0x8a929e,
  chrome: 0xbfc6cf, wood: 0x6b4a2f, tan: 0x9c7f52,
};

// axis-aligned box brick
function p(parent, w, h, d, color, x, y, z, emissive) {
  const m = new THREE.Mesh(BOX, mat(color, emissive ? { emissive: color } : {}));
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

// cylinder lying along -Z (barrels, shrouds, scope tubes)
function cyl(parent, r, len, color, x, y, z, emissive) {
  const m = new THREE.Mesh(UNIT_CYL, mat(color, emissive ? { emissive: color } : {}));
  m.scale.set(r, len, r);
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

// cylinder standing along +Y (grips, bipod legs, bolt handles) — caller tilts it
function post(parent, r, len, color, x, y, z) {
  const m = new THREE.Mesh(UNIT_CYL, mat(color));
  m.scale.set(r, len, r);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

// clip-on red-dot optic (rail + housing + glowing lens)
function reddot(parent, z) {
  p(parent, 0.03, 0.03, 0.16, COL.black, 0, 0.085, z);
  p(parent, 0.05, 0.06, 0.08, COL.dark, 0, 0.13, z);
  p(parent, 0.036, 0.036, 0.012, 0xff4a4a, 0, 0.13, z - 0.045, true);
}

// each builder returns a Group with muzzle at group.userData.muzzle (local Vector3).
// Everything points down -Z (forward); sights sit +Y, grip/mag hang -Y.
export function buildGunMesh(id, scale = 1) {
  const g = new THREE.Group();
  const col = WEAPONS[id]?.color ?? 0x888888;
  switch (id) {
    case 'pistol': {
      p(g, 0.07, 0.08, 0.30, COL.metal, 0, 0.03, -0.05);   // slide
      p(g, 0.066, 0.05, 0.24, COL.black, 0, -0.02, -0.03);  // frame
      cyl(g, 0.02, 0.06, COL.steel, 0, 0.03, -0.22);        // barrel tip
      const grip = p(g, 0.062, 0.15, 0.085, col, 0, -0.11, 0.05); grip.rotation.x = 0.32;
      p(g, 0.05, 0.03, 0.09, COL.black, 0, -0.185, 0.07);   // mag floorplate
      p(g, 0.024, 0.024, 0.02, COL.black, 0, 0.08, -0.17);  // front sight
      p(g, 0.03, 0.024, 0.02, COL.black, 0, 0.08, 0.07);    // rear sight
      g.userData.muzzle = new THREE.Vector3(0, 0.03, -0.26);
      break;
    }
    case 'smg': {
      p(g, 0.075, 0.1, 0.34, COL.dark, 0, 0, -0.06);        // body
      cyl(g, 0.022, 0.18, COL.steel, 0, 0.02, -0.3);        // barrel shroud
      p(g, 0.05, 0.05, 0.09, COL.black, 0, 0.02, -0.42);    // muzzle collar
      const mag = p(g, 0.05, 0.19, 0.07, col, 0, -0.15, -0.02); mag.rotation.x = 0.1;
      const grip = p(g, 0.056, 0.13, 0.08, COL.black, 0, -0.1, 0.09); grip.rotation.x = 0.3;
      p(g, 0.05, 0.09, 0.14, COL.dark, 0, 0, 0.2);          // collapsible stock
      cyl(g, 0.018, 0.12, COL.black, 0, 0.0, 0.14);         // stock strut
      p(g, 0.02, 0.03, 0.16, COL.black, 0, 0.075, -0.06);   // top rail
      g.userData.muzzle = new THREE.Vector3(0, 0.02, -0.44);
      break;
    }
    case 'shotgun': {
      p(g, 0.075, 0.09, 0.4, col, 0, 0, -0.12);             // receiver
      cyl(g, 0.028, 0.42, COL.steel, 0, 0.05, -0.3);        // barrel
      cyl(g, 0.03, 0.34, COL.dark, 0, -0.02, -0.26);        // tube magazine
      p(g, 0.075, 0.06, 0.12, COL.wood, 0, -0.05, -0.2);    // pump grip
      const stock = p(g, 0.06, 0.12, 0.22, COL.wood, 0, -0.03, 0.2); stock.rotation.x = -0.05;
      p(g, 0.022, 0.026, 0.02, COL.chrome, 0, 0.11, -0.46); // bead sight
      g.userData.muzzle = new THREE.Vector3(0, 0.05, -0.52);
      break;
    }
    case 'rifle': {   // AR — the hero weapon
      p(g, 0.07, 0.085, 0.3, COL.dark, 0, 0.02, -0.02);     // upper receiver
      p(g, 0.058, 0.06, 0.26, COL.black, 0, 0.02, -0.32);   // handguard
      cyl(g, 0.018, 0.34, COL.steel, 0, 0.035, -0.42);      // barrel
      cyl(g, 0.03, 0.08, COL.black, 0, 0.035, -0.62);       // muzzle brake
      p(g, 0.024, 0.055, 0.02, COL.black, 0, 0.092, -0.3);  // front sight post
      reddot(g, -0.02);                                      // optic
      const m1 = p(g, 0.05, 0.11, 0.07, col, 0, -0.1, 0.0); m1.rotation.x = 0.14;
      const m2 = p(g, 0.05, 0.1, 0.068, col, 0, -0.17, -0.03); m2.rotation.x = 0.42; // curved mag
      const grip = p(g, 0.055, 0.12, 0.08, COL.black, 0, -0.1, 0.13); grip.rotation.x = 0.34;
      cyl(g, 0.022, 0.12, COL.black, 0, 0.02, 0.16);        // buffer tube
      p(g, 0.05, 0.1, 0.16, COL.dark, 0, 0.0, 0.25);        // stock
      g.userData.muzzle = new THREE.Vector3(0, 0.035, -0.66);
      break;
    }
    case 'lmg': {
      p(g, 0.095, 0.13, 0.4, COL.dark, 0, 0, -0.05);        // big receiver
      cyl(g, 0.025, 0.42, COL.steel, 0, 0.04, -0.44);       // heavy barrel
      cyl(g, 0.045, 0.08, COL.black, 0, 0.04, -0.64);       // flash hider
      p(g, 0.11, 0.14, 0.15, col, 0, -0.02, 0.08);          // ammo box
      const grip = p(g, 0.06, 0.13, 0.08, COL.black, 0, -0.11, 0.16); grip.rotation.x = 0.3;
      p(g, 0.055, 0.1, 0.16, COL.dark, 0, 0, 0.26);         // stock
      const l1 = post(g, 0.012, 0.2, COL.black, -0.05, -0.1, -0.46); l1.rotation.z = 0.5;
      const l2 = post(g, 0.012, 0.2, COL.black, 0.05, -0.1, -0.46); l2.rotation.z = -0.5; // bipod
      p(g, 0.02, 0.03, 0.16, COL.black, 0, 0.1, -0.08);     // top rail
      g.userData.muzzle = new THREE.Vector3(0, 0.04, -0.68);
      break;
    }
    case 'sniper': {   // bolt-action — the hero weapon #2
      p(g, 0.065, 0.09, 0.44, COL.dark, 0, 0, -0.02);       // receiver
      cyl(g, 0.02, 0.5, COL.steel, 0, 0.03, -0.44);         // long barrel
      cyl(g, 0.036, 0.09, COL.black, 0, 0.03, -0.7);        // muzzle brake
      p(g, 0.02, 0.05, 0.03, COL.black, 0, 0.09, -0.14);    // scope mount (front)
      p(g, 0.02, 0.05, 0.03, COL.black, 0, 0.09, 0.06);     // scope mount (rear)
      cyl(g, 0.035, 0.28, COL.black, 0, 0.135, -0.04);      // scope tube
      cyl(g, 0.05, 0.06, COL.dark, 0, 0.135, -0.2);         // objective bell
      p(g, 0.03, 0.03, 0.008, 0x66ccff, 0, 0.135, 0.11, true); // ocular lens glow
      const bolt = post(g, 0.012, 0.09, COL.steel, 0.06, 0.0, 0.07); bolt.rotation.z = -0.9;
      const grip = p(g, 0.05, 0.12, 0.08, col, 0, -0.1, 0.12); grip.rotation.x = 0.32;
      p(g, 0.055, 0.11, 0.26, COL.dark, 0, -0.02, 0.26);    // stock
      p(g, 0.05, 0.05, 0.1, COL.dark, 0, 0.06, 0.16);       // cheek riser
      g.userData.muzzle = new THREE.Vector3(0, 0.03, -0.76);
      break;
    }
    case 'plasma': {
      p(g, 0.09, 0.11, 0.36, 0x1e2a3a, 0, 0, -0.06);        // body
      cyl(g, 0.052, 0.3, 0x142130, 0, 0.03, -0.2);          // barrel shroud
      cyl(g, 0.032, 0.34, col, 0, 0.03, -0.18, true);       // glowing core
      p(g, 0.02, 0.06, 0.14, col, 0.065, 0.02, -0.02, true);  // energy cell R
      p(g, 0.02, 0.06, 0.14, col, -0.065, 0.02, -0.02, true); // energy cell L
      const grip = p(g, 0.056, 0.14, 0.08, 0x22303f, 0, -0.11, 0.05); grip.rotation.x = 0.3;
      p(g, 0.05, 0.05, 0.02, col, 0, 0.03, -0.34, true);    // emitter ring
      g.userData.muzzle = new THREE.Vector3(0, 0.03, -0.42);
      break;
    }
    case 'knife': {
      const blade = p(g, 0.016, 0.06, 0.32, COL.chrome, 0, 0.03, -0.18); blade.rotation.x = 0.04;
      p(g, 0.006, 0.02, 0.3, COL.steel, 0.008, 0.055, -0.18);  // edge highlight
      p(g, 0.09, 0.022, 0.03, COL.dark, 0, 0.0, -0.02);      // guard
      p(g, 0.035, 0.045, 0.13, COL.black, 0, 0.0, 0.06);     // handle
      g.userData.muzzle = new THREE.Vector3(0, 0.03, -0.34);
      break;
    }
    case 'pickaxe': {  // harvesting tool (building modes)
      const handle = post(g, 0.02, 0.5, COL.wood, 0, -0.04, -0.08); handle.rotation.x = Math.PI / 2;
      const head = p(g, 0.05, 0.07, 0.3, COL.steel, 0, 0.07, -0.32); head.rotation.x = 0.32;
      p(g, 0.045, 0.045, 0.09, COL.chrome, 0, 0.13, -0.44);  // pick tip
      g.userData.muzzle = new THREE.Vector3(0, 0.08, -0.46);
      break;
    }
    case 'zmelee':
    case 'spit': {
      // zombie claws
      for (let i = -1; i <= 1; i++) {
        const claw = p(g, 0.02, 0.02, 0.16, 0xd8e6b0, i * 0.038, 0, -0.1);
        claw.rotation.x = 0.2;
      }
      g.userData.muzzle = new THREE.Vector3(0, 0, -0.2);
      break;
    }
    default: {  // botgun — alien carbine
      p(g, 0.08, 0.11, 0.34, 0x4a1824, 0, 0, -0.06);
      cyl(g, 0.03, 0.22, 0x5c1f2e, 0, 0.02, -0.28);
      cyl(g, 0.028, 0.2, 0xff5964, 0, 0.02, -0.3, true);     // glowing barrel core
      const grip = p(g, 0.058, 0.14, 0.08, 0x23272f, 0, -0.11, 0.04); grip.rotation.x = 0.3;
      p(g, 0.05, 0.05, 0.02, 0xff5964, 0, 0.02, -0.44, true); // muzzle glow
      g.userData.muzzle = new THREE.Vector3(0, 0.02, -0.48);
    }
  }
  g.scale.setScalar(scale);
  return g;
}

// ============================================================
// Effects manager — pooled tracers, sparks, muzzle light
// ============================================================
export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.tracers = [];
    this.sparks = [];
    this.flash = new THREE.PointLight(0xffe9a0, 0, 9);
    scene.add(this.flash);
    this._flashT = 0;

    this._tracerGeo = new THREE.CylinderGeometry(0.016, 0.016, 1, 5);
    this._sparkGeo = new THREE.BoxGeometry(0.07, 0.07, 0.07);
  }

  muzzleFlash(pos) {
    this.flash.position.copy(pos);
    this.flash.intensity = 14;
    this._flashT = 0.05;
  }

  tracer(from, to, color = 0xfff0b0) {
    const len = from.distanceTo(to);
    if (len < 0.5) return;
    const m = new THREE.Mesh(this._tracerGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }));
    m.scale.y = len;
    m.position.copy(from).add(to).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
    this.scene.add(m);
    this.tracers.push({ m, life: 0.09 });
  }

  impact(pos, color = 0xffcf8a, n = 6, power = 3) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this._sparkGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 }));
      m.position.copy(pos);
      const v = new THREE.Vector3((Math.random() - 0.5), Math.random() * 0.9, (Math.random() - 0.5))
        .normalize().multiplyScalar(power * (0.5 + Math.random()));
      this.sparks.push({ m, v, life: 0.4 + Math.random() * 0.25 });
      this.scene.add(m);
    }
  }

  explosion(pos, color = 0x39e6c8) {
    this.impact(pos, color, 22, 8);
    this.muzzleFlash(pos);
    this.flash.intensity = 30;
  }

  update(dt) {
    if (this._flashT > 0) {
      this._flashT -= dt;
      if (this._flashT <= 0) this.flash.intensity = 0;
    }
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      t.m.material.opacity = Math.max(0, t.life / 0.09);
      if (t.life <= 0) { this.scene.remove(t.m); t.m.material.dispose(); this.tracers.splice(i, 1); }
    }
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life -= dt;
      s.v.y -= 14 * dt;
      s.m.position.addScaledVector(s.v, dt);
      s.m.material.opacity = Math.max(0, s.life * 2.2);
      if (s.life <= 0) { this.scene.remove(s.m); s.m.material.dispose(); this.sparks.splice(i, 1); }
    }
  }

  dispose() {
    for (const t of this.tracers) { this.scene.remove(t.m); t.m.material.dispose(); }
    for (const s of this.sparks) { this.scene.remove(s.m); s.m.material.dispose(); }
    this.tracers = []; this.sparks = [];
  }
}

// ============================================================
// First-person viewmodel — gun attached to the camera with
// sway, recoil kick and reload dip.
// ============================================================
export class ViewModel {
  constructor(camera) {
    this.camera = camera;
    this.root = new THREE.Group();
    camera.add(this.root);
    this.root.position.set(0.3, -0.3, -0.55);
    // small lamp so the viewmodel never renders as a black slab
    const lamp = new THREE.PointLight(0xfff4e0, 2.2, 2.5);
    lamp.position.set(0.1, 0.25, -0.2);
    camera.add(lamp);
    this.gun = null;
    this.weaponId = null;
    this.recoil = 0;
    this.reloadK = 0;   // 0..1 reload dip
    this.raiseK = 1;    // weapon-switch raise
    this.swayT = 0;
  }

  setWeapon(id) {
    if (this.weaponId === id) return;
    this.weaponId = id;
    if (this.gun) this.root.remove(this.gun);
    if (this.sprite) { this.root.remove(this.sprite); this.sprite = null; }
    // procedural 3D model shows immediately as a fallback
    this.gun = buildGunMesh(id, 0.9);
    this.root.add(this.gun);
    this.raiseK = 0;

    // if a hand-made weapon image exists (assets/weapons/<id>.png), swap the
    // 3D model for a crisp 2D sprite viewmodel — matches the generated art.
    if (!ViewModel._loader) { ViewModel._loader = new THREE.TextureLoader(); ViewModel._noImg = new Set(); }
    if (ViewModel._noImg.has(id)) return;          // already known to have no image
    ViewModel._loader.load(
      `assets/weapons/${id}.png`,
      (tex) => {
        if (this.weaponId !== id) return;          // switched away while loading
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        const img = tex.image;
        const aspect = img && img.height ? img.width / img.height : 1.6;
        const h = 0.62, w = h * aspect;
        const plane = new THREE.Mesh(
          new THREE.PlaneGeometry(w, h),
          new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }),
        );
        plane.renderOrder = 20;
        plane.position.set(0.02, -0.04, 0.1);      // nudge within the viewmodel root
        if (this.gun) { this.root.remove(this.gun); this.gun = null; }
        this.root.add(plane);
        this.sprite = plane;
      },
      undefined,
      () => { ViewModel._noImg.add(id); /* no image — keep the procedural model */ },
    );
  }

  kick() { this.recoil = Math.min(1, this.recoil + 0.55); }

  muzzleWorld(target) {
    // sprite viewmodel: muzzle ≈ upper-left of the plane; else the model's muzzle
    if (this.sprite) return this.sprite.localToWorld(target.set(-0.28, 0.12, 0));
    if (!this.gun) return target.set(0, 0, 0);
    target.copy(this.gun.userData.muzzle);
    return this.gun.localToWorld(target);
  }

  update(dt, moveSpeed, reloading, ads = false, sniper = false, hidden = false) {
    this.swayT += dt * (2 + moveSpeed);
    this.recoil = Math.max(0, this.recoil - dt * 6);
    this.raiseK = Math.min(1, this.raiseK + dt * 4);
    this.reloadK += ((reloading ? 1 : 0) - this.reloadK) * Math.min(1, dt * 8);
    this.adsK = (this.adsK ?? 0) + ((ads ? 1 : 0) - (this.adsK ?? 0)) * Math.min(1, dt * 14);
    const k = this.adsK;
    const lp = (a, b) => a + (b - a) * k;   // hip → ADS blend
    // hidden (third person) OR sniper scope → no viewmodel
    this.root.visible = !hidden && !(sniper && k > 0.6);
    // sway all but vanishes at ADS so the sight stays glued to centre
    const sway = Math.min(1, moveSpeed / 6) * (1 - k * 0.92);
    // hip pose (0.3,-0.3,-0.55) blends to a centred pose where the model's
    // sights line up on screen centre (x→0, raised, pulled in)
    this.root.position.set(
      lp(0.3, 0.0) + Math.sin(this.swayT) * 0.012 * sway,
      lp(-0.3, -0.055) + Math.abs(Math.cos(this.swayT)) * 0.02 * sway
        - this.reloadK * 0.22 - (1 - this.raiseK) * 0.35 + this.recoil * 0.03 * (1 - k * 0.6),
      lp(-0.55, -0.42) + this.recoil * 0.09 * (1 - k * 0.5),
    );
    // sprite stays flat-ish to the camera; 3D model gets the recoil tilt,
    // damped while aiming so the shot doesn't throw the sight off target
    const tiltMul = (this.sprite ? 0.5 : 1) * (1 - k * 0.55);
    this.root.rotation.set((this.recoil * 0.16 + this.reloadK * 0.7) * tiltMul, 0, this.reloadK * 0.3 * tiltMul);
  }
}
