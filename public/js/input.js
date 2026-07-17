// ============================================================
// FPS input.
//  Desktop: pointer-lock mouse look, WASD, Space jump, Shift sprint,
//           C/Ctrl crouch (slide while sprinting), R reload,
//           left mouse fire, right mouse aim (ADS), Tab scoreboard.
//  Mobile:  left-zone virtual stick = move (full push = sprint),
//           right-zone drag = look, on-screen fire / jump / crouch /
//           aim / reload buttons. touch-action:none everywhere so the
//           browser never steals the gestures.
// ============================================================

const JOY_RADIUS = 62;

export class Input {
  constructor() {
    this.move = { x: 0, y: 0 };     // x = strafe (+right), y = forward (+ahead)
    this.lookDX = 0;
    this.lookDY = 0;
    this.firing = false;
    this.aiming = false;            // ADS held (desktop) / toggled (mobile)
    this.sprintHeld = false;
    this.crouchHeld = false;        // desktop hold; mobile toggle writes this too
    this.wantJump = false;
    this.wantReload = false;
    this.wantNade = false;
    this.wantEmote = false;
    this.wantChat = -1;
    this.scoreHeld = false;
    this.touchMode = false;
    this.autoFire = true;           // mobile assist: fire when crosshair is on an enemy
    this.sensitivity = 1;

    this._keys = new Set();
    this._stick = null;
    this._look = null;
    this._mouseDown = false;
    this._locked = false;
    this.enabled = false;
  }

  consumeLook() {
    const d = { dx: this.lookDX, dy: this.lookDY };
    this.lookDX = 0; this.lookDY = 0;
    return d;
  }
  consumeJump()   { const v = this.wantJump;   this.wantJump = false;   return v; }
  consumeReload() { const v = this.wantReload; this.wantReload = false; return v; }
  consumeNade()   { const v = this.wantNade;   this.wantNade = false;   return v; }
  consumeEmote()  { const v = this.wantEmote;  this.wantEmote = false;  return v; }
  consumeChat()   { const v = this.wantChat;   this.wantChat = -1;      return v; }

  requestLock() {
    if (!this.touchMode && this.enabled && !this._locked) {
      this._canvas.requestPointerLock?.();
    }
  }
  exitLock() { document.exitPointerLock?.(); }

  attach({ canvas, zoneL, zoneR }) {
    this._canvas = canvas;
    this._makeStickVisual(zoneL);
    this._bindMoveZone(zoneL);
    this._bindLookZone(zoneR);

    // ---- keyboard ----
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
      if (e.code === 'KeyB') this.wantEmote = true;
      const n = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3 }[e.code];
      if (n !== undefined) this.wantChat = n;
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Tab') this.scoreHeld = false;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.sprintHeld = false;
      if (e.code === 'ControlLeft' || e.code === 'KeyC') this.crouchHeld = false;
      this._keys.delete(e.code);
    });
    window.addEventListener('blur', () => {
      this._keys.clear();
      this._mouseDown = false;
      this.sprintHeld = false;
      if (!this.touchMode) { this.crouchHeld = false; this.aiming = false; }
    });

    // ---- pointer lock mouse ----
    document.addEventListener('pointerlockchange', () => {
      this._locked = document.pointerLockElement === canvas;
    });
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

  _bindMoveZone(zone) {
    const start = (e) => {
      e.preventDefault();
      this.touchMode = true;
      const t = e.changedTouches[0];
      this._stick = { id: t.identifier, ox: t.clientX, oy: t.clientY, dx: 0, dy: 0 };
      this._vis.base.style.display = 'block';
      this._vis.base.style.left = t.clientX + 'px';
      this._vis.base.style.top = t.clientY + 'px';
      this._vis.knob.style.transform = 'translate(-50%,-50%)';
    };
    const move = (e) => {
      const s = this._stick;
      if (!s) return;
      for (const t of e.changedTouches) {
        if (t.identifier !== s.id) continue;
        e.preventDefault();
        let dx = t.clientX - s.ox, dy = t.clientY - s.oy;
        const len = Math.hypot(dx, dy);
        // full push (past the rim) = sprint
        s.mag = len / JOY_RADIUS;
        if (len > JOY_RADIUS) { dx *= JOY_RADIUS / len; dy *= JOY_RADIUS / len; }
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
        const sens = 0.005 * this.sensitivity * (this.aiming ? 0.55 : 1);
        this.lookDX += (t.clientX - s.px) * sens;
        this.lookDY += (t.clientY - s.py) * sens;
        s.px = t.clientX; s.py = t.clientY;
      }
    };
    const end = (e) => {
      const s = this._look;
      if (!s) return;
      for (const t of e.changedTouches) {
        if (t.identifier === s.id) this._look = null;
      }
    };
    zone.addEventListener('touchstart', start, { passive: false });
    zone.addEventListener('touchmove', move, { passive: false });
    zone.addEventListener('touchend', end);
    zone.addEventListener('touchcancel', end);
  }

  // per-frame poll
  update() {
    if (this._stick) {
      this.move.x = this._stick.dx;
      this.move.y = -this._stick.dy;
      this.sprintHeld = (this._stick.mag || 0) > 1.15 && this.move.y > 0.35;
    } else {
      let x = 0, y = 0;
      if (this._keys.has('KeyW') || this._keys.has('ArrowUp')) y += 1;
      if (this._keys.has('KeyS') || this._keys.has('ArrowDown')) y -= 1;
      if (this._keys.has('KeyD') || this._keys.has('ArrowRight')) x += 1;
      if (this._keys.has('KeyA') || this._keys.has('ArrowLeft')) x -= 1;
      const len = Math.hypot(x, y);
      this.move.x = len > 1 ? x / len : x;
      this.move.y = len > 1 ? y / len : y;
      if (this.touchMode) { /* keep touch state */ }
    }
    if (!this.touchMode) this.firing = this._mouseDown;
  }
}
