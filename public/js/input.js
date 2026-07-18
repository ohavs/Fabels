// ============================================================
// FPS input.
//  Desktop: pointer-lock mouse look, WASD, Space jump, Shift sprint,
//           C/Ctrl crouch, R reload, left mouse fire, right mouse ADS,
//           1-4 build tools, E edit, V camera, B emote, Tab scoreboard.
//  Mobile:  left zone = movement stick (larger, with a visible resting
//           anchor + response curve so it feels smooth); right zone =
//           look; on-screen buttons for everything else.
// ============================================================

const JOY_RADIUS = 72;      // bigger stick = easier full-speed movement
const JOY_DEAD = 0.14;      // ignore tiny thumb jitter
const SPRINT_AT = 0.92;     // stick push fraction that auto-sprints

// smooth response curve: gentle near centre, full at the rim
const curve = (v) => {
  const s = Math.sign(v), a = Math.abs(v);
  if (a < JOY_DEAD) return 0;
  const n = (a - JOY_DEAD) / (1 - JOY_DEAD);
  return s * n * (0.55 + 0.45 * n);
};

export class Input {
  constructor() {
    this.move = { x: 0, y: 0 };
    this.lookDX = 0;
    this.lookDY = 0;
    this.firing = false;
    this.aiming = false;
    this.sprintHeld = false;
    this.sprintToggle = false;
    this.crouchHeld = false;
    this.wantJump = false;
    this.wantReload = false;
    this.wantNade = false;
    this.wantEmote = -1;       // -1 none, else emote index
    this.wantCamera = false;
    this.tool = 'gun';         // gun | pick | wall | ramp | floor | edit
    this.onTool = null;        // (tool) UI callback when tool changes
    this.wantChat = -1;
    this.scoreHeld = false;
    this.touchMode = false;
    this.autoFire = true;
    this.sensitivity = 1;

    this._keys = new Set();
    this._stick = null;
    this._look = null;
    this._mouseDown = false;
    this._locked = false;
    this.enabled = false;
  }

  consumeLook() { const d = { dx: this.lookDX, dy: this.lookDY }; this.lookDX = 0; this.lookDY = 0; return d; }
  consumeJump()   { const v = this.wantJump;   this.wantJump = false;   return v; }
  consumeReload() { const v = this.wantReload; this.wantReload = false; return v; }
  consumeNade()   { const v = this.wantNade;   this.wantNade = false;   return v; }
  consumeEmote()  { const v = this.wantEmote;  this.wantEmote = -1;     return v; }
  consumeCamera() { const v = this.wantCamera; this.wantCamera = false; return v; }
  consumeChat()   { const v = this.wantChat;   this.wantChat = -1;      return v; }

  setTool(tool) { this.tool = tool; if (this.onTool) this.onTool(tool); }

  requestLock() { if (!this.touchMode && this.enabled && !this._locked) this._canvas.requestPointerLock?.(); }
  exitLock() { document.exitPointerLock?.(); }

  attach({ canvas, zoneL, zoneR }) {
    this._canvas = canvas;
    this._makeStickVisual(zoneL);
    this._bindMoveZone(zoneL);
    this._bindLookZone(zoneR);

    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (e.code === 'Tab') { e.preventDefault(); this.scoreHeld = true; return; }
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.sprintHeld = true;
      if (e.code === 'ControlLeft' || e.code === 'KeyC') { e.preventDefault(); this.crouchHeld = true; }
      if (e.repeat) return;
      this._keys.add(e.code);
      if (e.code === 'Space') { e.preventDefault(); this.wantJump = true; }
      if (e.code === 'KeyR') this.wantReload = true;
      if (e.code === 'KeyG') this.wantNade = true;
      if (e.code === 'KeyB') this.wantEmote = 0;
      if (e.code === 'KeyV') this.wantCamera = true;
      // tool selection (1v1.lol-style): Q=weapon, 1=wall 2=ramp 3=floor 4=pickaxe, E=edit
      if (e.code === 'KeyQ') this.setTool('gun');
      if (e.code === 'Digit1') this.setTool('wall');
      if (e.code === 'Digit2') this.setTool('ramp');
      if (e.code === 'Digit3') this.setTool('floor');
      if (e.code === 'Digit4') this.setTool('pick');
      if (e.code === 'KeyE') this.setTool(this.tool === 'edit' ? 'gun' : 'edit');
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Tab') this.scoreHeld = false;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.sprintHeld = false;
      if (e.code === 'ControlLeft' || e.code === 'KeyC') this.crouchHeld = false;
      this._keys.delete(e.code);
    });
    window.addEventListener('blur', () => {
      this._keys.clear(); this._mouseDown = false; this.sprintHeld = false;
      if (!this.touchMode) { this.crouchHeld = false; this.aiming = false; }
    });

    document.addEventListener('pointerlockchange', () => { this._locked = document.pointerLockElement === canvas; });
    canvas.addEventListener('mousemove', (e) => {
      if (!this._locked || !this.enabled) return;
      const sens = 0.0022 * this.sensitivity * (this.aiming ? 0.55 : 1);
      this.lookDX += e.movementX * sens;
      this.lookDY += e.movementY * sens;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled || this.touchMode) return;
      if (!this._locked) { this.requestLock(); return; }
      if (e.button === 0) this._mouseDown = true;
      if (e.button === 2) this.aiming = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this._mouseDown = false;
      if (e.button === 2 && !this.touchMode) this.aiming = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _makeStickVisual(zone) {
    const base = document.createElement('div');
    base.className = 'joy-base';
    const knob = document.createElement('div');
    knob.className = 'joy-knob';
    base.appendChild(knob);
    zone.appendChild(base);
    this._vis = { base, knob };
  }

  _showStick(x, y) {
    const v = this._vis;
    v.base.style.display = 'block';
    v.base.style.left = x + 'px';
    v.base.style.top = y + 'px';
    v.knob.style.transform = 'translate(-50%,-50%)';
    v.base.classList.add('active');
  }

  _bindMoveZone(zone) {
    const start = (e) => {
      e.preventDefault();
      this.touchMode = true;
      document.body.classList.add('touch');
      const t = e.changedTouches[0];
      this._stick = { id: t.identifier, ox: t.clientX, oy: t.clientY, dx: 0, dy: 0, mag: 0 };
      this._showStick(t.clientX, t.clientY);
    };
    const move = (e) => {
      const s = this._stick;
      if (!s) return;
      for (const t of e.changedTouches) {
        if (t.identifier !== s.id) continue;
        e.preventDefault();
        let dx = t.clientX - s.ox, dy = t.clientY - s.oy;
        const len = Math.hypot(dx, dy);
        s.mag = Math.min(1.25, len / JOY_RADIUS);
        // drag the base along if the thumb travels past the rim (feels natural)
        if (len > JOY_RADIUS) {
          s.ox += (dx - dx * JOY_RADIUS / len);
          s.oy += (dy - dy * JOY_RADIUS / len);
          dx *= JOY_RADIUS / len; dy *= JOY_RADIUS / len;
          this._vis.base.style.left = s.ox + 'px';
          this._vis.base.style.top = s.oy + 'px';
        }
        s.dx = dx / JOY_RADIUS; s.dy = dy / JOY_RADIUS;
        this._vis.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      }
    };
    const end = (e) => {
      const s = this._stick;
      if (!s) return;
      for (const t of e.changedTouches) {
        if (t.identifier !== s.id) continue;
        this._stick = null;
        this._vis.base.classList.remove('active');
        this._vis.base.style.display = 'none';
      }
    };
    zone.addEventListener('touchstart', start, { passive: false });
    zone.addEventListener('touchmove', move, { passive: false });
    zone.addEventListener('touchend', end);
    zone.addEventListener('touchcancel', end);
  }

  _bindLookZone(zone) {
    const start = (e) => {
      e.preventDefault();
      this.touchMode = true;
      const t = e.changedTouches[0];
      this._look = { id: t.identifier, px: t.clientX, py: t.clientY };
    };
    const move = (e) => {
      const s = this._look;
      if (!s) return;
      for (const t of e.changedTouches) {
        if (t.identifier !== s.id) continue;
        e.preventDefault();
        const sens = 0.0052 * this.sensitivity * (this.aiming ? 0.5 : 1);
        this.lookDX += (t.clientX - s.px) * sens;
        this.lookDY += (t.clientY - s.py) * sens;
        s.px = t.clientX; s.py = t.clientY;
      }
    };
    const end = (e) => {
      const s = this._look;
      if (!s) return;
      for (const t of e.changedTouches) if (t.identifier === s.id) this._look = null;
    };
    zone.addEventListener('touchstart', start, { passive: false });
    zone.addEventListener('touchmove', move, { passive: false });
    zone.addEventListener('touchend', end);
    zone.addEventListener('touchcancel', end);
  }

  update() {
    if (this._stick) {
      this.move.x = curve(this._stick.dx);
      this.move.y = -curve(this._stick.dy);
      this.sprintHeld = this.sprintToggle
        || (this._stick.mag > SPRINT_AT && this.move.y > 0.4);
    } else {
      let x = 0, y = 0;
      if (this._keys.has('KeyW') || this._keys.has('ArrowUp')) y += 1;
      if (this._keys.has('KeyS') || this._keys.has('ArrowDown')) y -= 1;
      if (this._keys.has('KeyD') || this._keys.has('ArrowRight')) x += 1;
      if (this._keys.has('KeyA') || this._keys.has('ArrowLeft')) x -= 1;
      const len = Math.hypot(x, y);
      this.move.x = len > 1 ? x / len : x;
      this.move.y = len > 1 ? y / len : y;
      if (this.touchMode) { this.move.x = 0; this.move.y = 0; }
    }
    if (!this.touchMode) this.firing = this._mouseDown;
  }
}
