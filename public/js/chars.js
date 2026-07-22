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

// Custom skins travel as a compact packed string ('c!body!accent!skin!pads!pack!visor',
// hex colors without '#', '-' = accessory off) so the existing skin-id sync carries
// them to every player with zero netcode changes.
export function packCustomSkin(d) {
  const hx = (v) => (v == null || v === false ? '-' : (typeof v === 'number' ? v : parseInt(String(v).replace('#', ''), 16)).toString(16).padStart(6, '0'));
  return ['c', hx(d.body), hx(d.accent), hx(d.skin), hx(d.pads), hx(d.pack), hx(d.visorGlow)].join('!');
}

export function parseCustomSkin(str) {
  const p = String(str).split('!');
  const num = (v, fb) => (v && v !== '-' ? parseInt(v, 16) : fb);
  const opt = (v) => (v && v !== '-' ? parseInt(v, 16) : undefined);
  return {
    body: num(p[1], 0x3b82f6), accent: num(p[2], 0xfbbf24), skin: num(p[3], 0xf1c27d),
    pads: opt(p[4]), pack: opt(p[5]), visorGlow: opt(p[6]),
  };
}

export function buildCharacter(skinId, opts = {}) {
  // accepts a skin id, a packed custom string, or a raw palette (zombies)
  const s = typeof skinId === 'object' && skinId !== null ? skinId
    : typeof skinId === 'string' && skinId.startsWith('c!') ? parseCustomSkin(skinId)
    : (SKINS[skinId] || SKINS.scout);
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

  // neck (subtle detail on every skin)
  part(group, 0.22, 0.12, 0.22, s.skin, 0, 1.6, 0);

  // head + visor + helmet accent
  const head = new THREE.Group(); head.position.set(0, 1.76, 0); group.add(head);
  part(head, 0.36, 0.36, 0.34, s.skin, 0, 0, 0);
  if (opts.face) {
    // uploaded face photo mapped onto the front of the head (replaces the visor)
    const tex = new THREE.TextureLoader().load(opts.face);
    tex.colorSpace = THREE.SRGBColorSpace;
    const plate = new THREE.Mesh(BOX, new THREE.MeshLambertMaterial({ map: tex }));
    plate.scale.set(0.34, 0.32, 0.02);
    plate.position.set(0, 0, 0.175);
    head.add(plate);
  } else {
    const visor = part(head, 0.3, 0.09, 0.05, s.visorGlow || 0x1f2430, 0, 0.04, 0.17);  // visor/eyes
    if (s.visorGlow) visor.material.emissive?.setHex(s.visorGlow);
  }
  part(head, 0.4, 0.12, 0.38, s.accent, 0, 0.22, 0);      // helmet band

  // optional accessories (premium skins)
  if (s.pads) {                                            // shoulder pads (static)
    part(group, 0.26, 0.16, 0.32, s.pads, -0.38, 1.52, 0);
    part(group, 0.26, 0.16, 0.32, s.pads, 0.38, 1.52, 0);
  }
  if (s.pack) part(group, 0.42, 0.5, 0.16, s.pack, 0, 1.24, -0.24);   // backpack

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

export function setCharacterWeapon(char, weaponId, pickStyle = null) {
  const styleId = pickStyle?.id || '';
  if (char.curWeapon === weaponId && char._pickStyle === styleId) return;
  char.curWeapon = weaponId;
  char._pickStyle = styleId;
  char.gunAnchor.clear();
  const gun = buildGunMesh(weaponId, 0.8, weaponId === 'pickaxe' ? pickStyle : null);
  char.gunAnchor.add(gun);
}

// limb swing while moving, arms aim-ish pose, dance emotes, hit flash decay
// dance: -1 none, 0 floss, 1 wave, 2 flex, 3 cheer, 4 bow, 5 laugh
export function animateCharacter(char, dt, speed, grounded, dance = -1) {
  char.animT += dt * (4 + speed * 1.6);
  if (dance >= 0) {
    const d = char.animT * 2.4;
    const s = Math.sin(d), c2 = Math.cos(d);
    // reset every joint the dances touch, each frame
    char.head.rotation.set(0, 0, 0);
    char.group.rotation.x = 0; char.group.rotation.z = 0;
    char.hipL.rotation.set(0, 0, 0); char.hipR.rotation.set(0, 0, 0);
    const R = char.shR.rotation, L = char.shL.rotation, H = char.head.rotation, G = char.group.rotation;
    switch (dance) {
      case 1: // wave
        R.x = -2.9; R.z = s * 0.7; L.x = -0.2; H.z = Math.sin(d * 0.7) * 0.1; break;
      case 2: // flex
        R.x = -2.5; R.z = -1.1 + s * 0.15; L.x = -2.5; L.z = 1.1 - s * 0.15; G.z = s * 0.05; break;
      case 3: // cheer
        R.x = -3.0 + s * 0.3; R.z = 0.3; L.x = -3.0 + Math.sin(d + 0.5) * 0.3; L.z = -0.3; H.z = s * 0.12; break;
      case 4: // bow
        G.x = 0.55 + Math.sin(d * 0.5) * 0.1; L.x = -0.6; R.x = -0.6; break;
      case 5: // laugh — lean back, hold belly, shake
        R.x = -1.4; R.z = -0.6; L.x = -1.4; L.z = 0.6; G.x = -0.22 + Math.abs(s) * 0.12; H.x = -0.2; break;
      case 6: { // robot
        const step = Math.sign(s);
        R.x = -1.6 - step * 0.5; L.x = -1.6 + step * 0.5; H.z = Math.sign(Math.sin(d * 0.5)) * 0.14; break;
      }
      case 7: { // clap
        const cl = Math.abs(Math.sin(d * 1.6));
        R.x = -1.5; R.z = -0.5 - cl * 0.5; L.x = -1.5; L.z = 0.5 + cl * 0.5; H.z = s * 0.06; break;
      }
      case 8: { // disco point
        const up = s > 0;
        R.x = up ? -2.7 : -0.4; R.z = up ? -0.5 : 0; L.x = up ? -0.4 : -2.7; L.z = up ? 0 : 0.5;
        char.hipL.rotation.x = s * 0.3; char.hipR.rotation.x = -s * 0.3; G.z = s * 0.08; break;
      }
      case 9: // dab
        R.x = -2.7; R.z = -0.55; L.x = -1.95; L.z = -0.95; H.x = 0.5; H.z = -0.2; G.z = Math.sin(d * 2) * 0.02; break;
      case 10: // spin
        G.y = d; R.x = -1.2; R.z = 1.4; L.x = -1.2; L.z = -1.4; break;
      case 11: // twist
        G.y = Math.sin(d * 2) * 0.5; R.x = -1.0; R.z = -0.9; L.x = -1.0; L.z = 0.9;
        char.hipL.rotation.x = 0.18; char.hipR.rotation.x = 0.18; break;
      case 12: { // YMCA — cycle the 4 letters
        const ph = Math.floor((d * 0.5) % 4);
        if (ph === 0) { R.x = -2.6; R.z = 0.75; L.x = -2.6; L.z = -0.75; }       // Y
        else if (ph === 1) { R.x = -1.35; R.z = -0.95; L.x = -1.35; L.z = 0.95; } // M
        else if (ph === 2) { R.x = -2.3; R.z = 1.0; L.x = -1.1; L.z = 1.0; }      // C
        else { R.x = -2.95; R.z = 0.22; L.x = -2.95; L.z = -0.22; }               // A
        break;
      }
      case 13: { // jumping jacks (no vertical move: arms + legs spread on the beat)
        const open = Math.sin(d * 2) > 0;
        R.x = open ? -2.9 : -0.1; R.z = open ? 0.6 : 0; L.x = open ? -2.9 : -0.1; L.z = open ? -0.6 : 0;
        char.hipL.rotation.z = open ? 0.34 : 0; char.hipR.rotation.z = open ? -0.34 : 0; break;
      }
      case 14: { // alternating front kicks
        const k = s;
        char.hipR.rotation.x = k > 0 ? -1.4 * k : 0;
        char.hipL.rotation.x = k < 0 ? 1.4 * k : 0;
        R.x = -0.9; R.z = -0.4; L.x = -0.9; L.z = 0.4; G.z = -k * 0.06; break;
      }
      case 15: // moonwalk — lean back, feet sliding
        G.x = -0.14; char.hipL.rotation.x = s * 0.55; char.hipR.rotation.x = Math.sin(d + Math.PI) * 0.55;
        R.x = -0.35; L.x = -0.35; H.x = -0.08; break;
      case 16: // the worm — body wave
        G.x = 0.25 + s * 0.35; R.x = -1.7; L.x = -1.7; H.x = -s * 0.4; break;
      case 17: // salute
        R.x = -2.9; R.z = -0.62; L.x = -0.05; G.x = Math.sin(d * 0.6) * 0.02; H.x = -0.05; break;
      case 18: // headbang — rock horns + head
        H.x = Math.abs(Math.sin(d * 3)) * 0.6; L.x = -2.8; L.z = -0.35; R.x = -0.3;
        G.x = Math.sin(d * 3) * 0.1; break;
      case 19: // shuffle — quick side steps
        G.z = Math.sin(d * 2) * 0.12; char.hipL.rotation.x = Math.sin(d * 3) * 0.3;
        char.hipR.rotation.x = Math.sin(d * 3 + Math.PI) * 0.3; R.x = -0.6; R.z = -0.3; L.x = -0.6; L.z = 0.3; break;
      case 20: // breakdance — fast spin + lean
        G.y = d * 1.5; G.x = 0.42; R.x = -0.2; L.x = -1.9; L.z = -1.2;
        char.hipL.rotation.x = 0.5; break;
      case 21: // T-pose (troll)
        R.z = 1.57; L.z = -1.57; break;
      case 22: // hands up + sway
        R.x = -3.0; L.x = -3.0; R.z = s * 0.4; L.z = s * 0.4; G.z = s * 0.05; H.z = s * 0.1; break;
      case 23: // swim (freestyle strokes)
        R.x = -1.7 + Math.sin(d * 1.4) * 1.4; L.x = -1.7 + Math.sin(d * 1.4 + Math.PI) * 1.4;
        G.x = 0.2; H.x = -0.15; break;
      default: // floss (0)
        L.x = -2.6 + s * 0.8; R.x = -2.6 + Math.sin(d + Math.PI) * 0.8;
        L.z = s * 0.6; R.z = -s * 0.6;
        char.hipL.rotation.x = s * 0.35; char.hipR.rotation.x = -s * 0.35;
        H.z = Math.sin(d * 2) * 0.18; G.z = s * 0.06; break;
    }
    return;
  }
  char.group.rotation.x = 0;
  char.group.rotation.z = 0;
  char.head.rotation.set(0, 0, 0);
  char.hipL.rotation.z = 0; char.hipR.rotation.z = 0;
  char.shL.rotation.z = 0;
  char.shR.rotation.z = 0;
  const moving = speed > 0.6;
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
