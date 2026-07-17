// ============================================================
// Procedural low-poly characters (Fortnite-knockoff minifigs):
// boxy torso/head/limbs built from primitives, limb-swing run
// animation, Hebrew name sprites, hit flash. No model files.
// ============================================================

import * as THREE from './vendor/three.module.js';
import { SKINS } from './config.js';
import { mat } from './world.js';
import { buildGunMesh } from './weapons.js';

const BOX = new THREE.BoxGeometry(1, 1, 1);

function part(parent, w, h, d, color, x, y, z) {
  const m = new THREE.Mesh(BOX, mat(color).clone());
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

export function buildCharacter(skinId) {
  const s = SKINS[skinId] || SKINS.scout;
  const group = new THREE.Group();

  // legs (pivots at the hip so they swing)
  const hipL = new THREE.Group(); hipL.position.set(-0.14, 0.92, 0); group.add(hipL);
  const hipR = new THREE.Group(); hipR.position.set(0.14, 0.92, 0); group.add(hipR);
  part(hipL, 0.2, 0.9, 0.24, 0x2d3142, 0, -0.45, 0);
  part(hipR, 0.2, 0.9, 0.24, 0x2d3142, 0, -0.45, 0);
  // boots
  part(hipL, 0.22, 0.16, 0.32, s.accent, 0, -0.86, 0.03);
  part(hipR, 0.22, 0.16, 0.32, s.accent, 0, -0.86, 0.03);

  // torso + belt + chest stripe
  part(group, 0.56, 0.62, 0.32, s.body, 0, 1.24, 0);
  part(group, 0.58, 0.1, 0.34, s.accent, 0, 0.96, 0);
  part(group, 0.58, 0.12, 0.06, s.accent, 0, 1.34, 0.15);

  // arms (shoulder pivots); right arm holds the gun
  const shL = new THREE.Group(); shL.position.set(-0.36, 1.48, 0); group.add(shL);
  const shR = new THREE.Group(); shR.position.set(0.36, 1.48, 0); group.add(shR);
  part(shL, 0.16, 0.62, 0.2, s.body, 0, -0.28, 0);
  part(shR, 0.16, 0.62, 0.2, s.body, 0, -0.28, 0);
  part(shL, 0.17, 0.16, 0.21, s.skin, 0, -0.56, 0);   // hands
  part(shR, 0.17, 0.16, 0.21, s.skin, 0, -0.56, 0);

  // head + visor + helmet accent
  const head = new THREE.Group(); head.position.set(0, 1.76, 0); group.add(head);
  part(head, 0.36, 0.36, 0.34, s.skin, 0, 0, 0);
  part(head, 0.3, 0.09, 0.05, 0x1f2430, 0, 0.04, 0.17);  // visor/eyes
  part(head, 0.4, 0.12, 0.38, s.accent, 0, 0.22, 0);      // helmet band

  // gun in right hand (swapped on weapon change)
  const gunAnchor = new THREE.Group();
  gunAnchor.position.set(0.36, 0.92, 0.28);
  group.add(gunAnchor);

  return {
    group, hipL, hipR, shL, shR, head, gunAnchor,
    animT: Math.random() * 10,
    curWeapon: null,
    flashT: 0,
  };
}

export function setCharacterWeapon(char, weaponId) {
  if (char.curWeapon === weaponId) return;
  char.curWeapon = weaponId;
  char.gunAnchor.clear();
  const gun = buildGunMesh(weaponId, 0.8);
  gun.rotation.y = -Math.PI / 2 * 0 ;
  char.gunAnchor.add(gun);
}

// limb swing while moving, arms aim-ish pose, hit flash decay
export function animateCharacter(char, dt, speed, grounded) {
  const moving = speed > 0.6;
  char.animT += dt * (4 + speed * 1.6);
  const amp = moving && grounded ? Math.min(0.75, speed * 0.12) : 0;
  const sw = Math.sin(char.animT) * amp;
  char.hipL.rotation.x = sw;
  char.hipR.rotation.x = -sw;
  char.shL.rotation.x = -sw * 0.7;
  // right arm holds weapon forward
  char.shR.rotation.x = -1.25 + Math.sin(char.animT * 0.5) * 0.03;
  if (!grounded) {
    char.hipL.rotation.x = 0.5; char.hipR.rotation.x = -0.3;
  }
  if (char.flashT > 0) {
    char.flashT = Math.max(0, char.flashT - dt);
    const k = char.flashT / 0.18;
    char.group.traverse((o) => {
      if (o.isMesh) o.material.emissive?.setRGB(k, k * 0.2, k * 0.2);
    });
  }
}

export function flashCharacter(char) {
  char.flashT = 0.18;
}

// ---- Hebrew name sprite ----
export function makeNameSprite(name, colorCss = '#ffffff') {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.font = '700 34px "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 6;
  ctx.fillStyle = colorCss;
  ctx.fillText(name, 128, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(2.4, 0.6, 1);
  sp.position.y = 2.35;
  sp.renderOrder = 999;
  return sp;
}

// small floating HP bar above remote players / bots
export function makeHpBar() {
  const bg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x000000, opacity: 0.55, transparent: true, depthTest: false }));
  bg.scale.set(1.1, 0.12, 1);
  bg.position.y = 2.08;
  bg.renderOrder = 998;
  const fg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x54e08a, opacity: 0.95, transparent: true, depthTest: false }));
  fg.scale.set(1.06, 0.08, 1);
  fg.position.y = 2.08;
  fg.renderOrder = 999;
  return { bg, fg };
}

export function updateHpBar(bar, frac) {
  frac = Math.max(0, Math.min(1, frac));
  bar.fg.scale.x = 1.06 * frac;
  bar.fg.material.color.setHex(frac > 0.5 ? 0x54e08a : frac > 0.25 ? 0xffd166 : 0xff6b6b);
}
