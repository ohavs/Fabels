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

function p(parent, w, h, d, color, x, y, z, emissive) {
  const m = new THREE.Mesh(BOX, mat(color, emissive ? { emissive: color } : {}));
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

// each builder returns a Group with muzzle at group.userData.muzzle (local Vector3)
export function buildGunMesh(id, scale = 1) {
  const g = new THREE.Group();
  const col = WEAPONS[id]?.color ?? 0x888888;
  const dark = 0x23272f;
  switch (id) {
    case 'pistol':
      p(g, 0.07, 0.1, 0.26, col, 0, 0.02, -0.1);
      p(g, 0.06, 0.14, 0.07, dark, 0, -0.08, 0.02);
      g.userData.muzzle = new THREE.Vector3(0, 0.03, -0.24);
      break;
    case 'smg':
      p(g, 0.08, 0.12, 0.34, col, 0, 0, -0.12);
      p(g, 0.06, 0.16, 0.07, dark, 0, -0.12, 0.0);
      p(g, 0.05, 0.14, 0.06, dark, 0, -0.11, -0.16);
      p(g, 0.04, 0.04, 0.12, dark, 0, 0.02, -0.34);
      g.userData.muzzle = new THREE.Vector3(0, 0.02, -0.42);
      break;
    case 'shotgun':
      p(g, 0.09, 0.11, 0.5, col, 0, 0, -0.15);
      p(g, 0.07, 0.07, 0.44, dark, 0, -0.07, -0.16);
      p(g, 0.07, 0.13, 0.12, 0x6b4a2f, 0, -0.03, 0.16);
      g.userData.muzzle = new THREE.Vector3(0, 0, -0.42);
      break;
    case 'rifle':
      p(g, 0.08, 0.12, 0.42, col, 0, 0, -0.1);
      p(g, 0.05, 0.05, 0.3, dark, 0, 0.02, -0.4);
      p(g, 0.06, 0.16, 0.08, dark, 0, -0.12, 0.02);
      p(g, 0.06, 0.12, 0.1, dark, 0, -0.1, -0.14);
      p(g, 0.07, 0.1, 0.14, 0x6b4a2f, 0, 0, 0.14);
      g.userData.muzzle = new THREE.Vector3(0, 0.02, -0.56);
      break;
    case 'lmg':
      p(g, 0.1, 0.15, 0.48, col, 0, 0, -0.1);
      p(g, 0.06, 0.06, 0.32, dark, 0, 0.02, -0.44);
      p(g, 0.1, 0.18, 0.1, dark, 0, -0.14, -0.05);
      p(g, 0.12, 0.12, 0.16, dark, 0, -0.1, 0.1);
      g.userData.muzzle = new THREE.Vector3(0, 0.02, -0.62);
      break;
    case 'sniper': {
      p(g, 0.07, 0.11, 0.5, col, 0, 0, -0.05);
      p(g, 0.045, 0.045, 0.5, dark, 0, 0.02, -0.5);
      p(g, 0.06, 0.14, 0.08, dark, 0, -0.11, 0.06);
      const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.2, 8), mat(dark));
      scope.rotation.x = Math.PI / 2;
      scope.position.set(0, 0.1, -0.1);
      g.add(scope);
      g.userData.muzzle = new THREE.Vector3(0, 0.02, -0.76);
      break;
    }
    case 'plasma': {
      p(g, 0.09, 0.12, 0.4, 0x1e3a4a, 0, 0, -0.1);
      const core = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.34, 8), mat(col, { emissive: col }));
      core.rotation.x = Math.PI / 2;
      core.position.set(0, 0.03, -0.18);
      g.add(core);
      p(g, 0.06, 0.15, 0.08, 0x23272f, 0, -0.12, 0.04);
      g.userData.muzzle = new THREE.Vector3(0, 0.03, -0.42);
      break;
    }
    case 'knife': {
      const blade = p(g, 0.02, 0.09, 0.3, col, 0, 0.02, -0.18, true);
      blade.rotation.x = 0.05;
      p(g, 0.035, 0.035, 0.12, 0x23272f, 0, 0, 0.02);
      p(g, 0.09, 0.03, 0.03, 0x8a6d1d, 0, 0, -0.04);
      g.userData.muzzle = new THREE.Vector3(0, 0, -0.3);
      break;
    }
    case 'zmelee':
    case 'spit': {
      // zombie claws
      for (let i = -1; i <= 1; i++) {
        const claw = p(g, 0.02, 0.02, 0.14, 0xd8e6b0, i * 0.035, 0, -0.1);
        claw.rotation.x = 0.2;
      }
      g.userData.muzzle = new THREE.Vector3(0, 0, -0.2);
      break;
    }
    default: // botgun
      p(g, 0.08, 0.12, 0.36, 0x5c1f2e, 0, 0, -0.1);
      p(g, 0.05, 0.05, 0.2, 0xff5964, 0, 0.02, -0.32, true);
      p(g, 0.06, 0.14, 0.07, 0x23272f, 0, -0.11, 0.02);
      g.userData.muzzle = new THREE.Vector3(0, 0.02, -0.44);
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
    this.adsK = (this.adsK ?? 0) + ((ads ? 1 : 0) - (this.adsK ?? 0)) * Math.min(1, dt * 12);
    const k = this.adsK;
    // hidden (third person) OR sniper scope → no viewmodel
    this.root.visible = !hidden && !(sniper && k > 0.7);
    const sway = Math.min(1, moveSpeed / 6) * (1 - k * 0.8);
    this.root.position.set(
      0.3 * (1 - k) + Math.sin(this.swayT) * 0.012 * sway,
      -0.3 + k * 0.08 + Math.abs(Math.cos(this.swayT)) * 0.02 * sway
        - this.reloadK * 0.22 - (1 - this.raiseK) * 0.35 + this.recoil * 0.03,
      -0.55 + k * 0.12 + this.recoil * 0.09,
    );
    // sprite stays flat-ish to the camera; 3D model gets the full recoil tilt
    const tiltMul = this.sprite ? 0.5 : 1;
    this.root.rotation.set((this.recoil * 0.16 + this.reloadK * 0.7) * tiltMul, 0, this.reloadK * 0.3 * tiltMul);
  }
}
