// ============================================================
// Input: virtual twin-stick joysticks (touch) + WASD/mouse.
// Left stick = movement, right stick = aim + auto-fire.
// UI buttons feed wantDash / wantSpecial / wantChat flags.
// ============================================================

const JOY_RADIUS = 58;
const FIRE_THRESHOLD = 0.3;

export class Input {
  constructor() {
    this.move = { x: 0, y: 0 };       // -1..1
    this.aim = { x: 1, y: 0 };        // unit vector, last known
    this.firing = false;
    this.wantDash = false;
    this.wantSpecial = false;
    this.wantChat = -1;
    this.touchMode = false;

    this._keys = new Set();
    this._mouse = { x: 0, y: 0, down: false };
    this._sticks = { L: null, R: null }; // active touch state per stick
  }

  consumeDash()    { const v = this.wantDash;    this.wantDash = false;    return v; }
  consumeSpecial() { const v = this.wantSpecial; this.wantSpecial = false; return v; }
  consumeChat()    { const v = this.wantChat;    this.wantChat = -1;       return v; }

  attach({ zoneL, zoneR, canvas }) {
    this._canvas = canvas;
    this._makeStickVisual(zoneL, 'L');
    this._makeStickVisual(zoneR, 'R');
    this._bindZone(zoneL, 'L');
    this._bindZone(zoneR, 'R');

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this._keys.add(e.code);
      if (e.code === 'Space' || e.code === 'ShiftLeft') this.wantDash = true;
      if (e.code === 'KeyE') this.wantSpecial = true;
      const n = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3 }[e.code];
      if (n !== undefined) this.wantChat = n;
    });
    window.addEventListener('keyup', (e) => this._keys.delete(e.code));
    window.addEventListener('blur', () => { this._keys.clear(); this._mouse.down = false; });

    canvas.addEventListener('mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      this._mouse.x = e.clientX - (r.left + r.width / 2);
      this._mouse.y = e.clientY - (r.top + r.height / 2);
    });
    canvas.addEventListener('mousedown', (e) => { if (e.button === 0) this._mouse.down = true; });
    window.addEventListener('mouseup', () => { this._mouse.down = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _makeStickVisual(zone, key) {
    const base = document.createElement('div');
    base.className = 'joy-base';
    const knob = document.createElement('div');
    knob.className = 'joy-knob';
    base.appendChild(knob);
    zone.appendChild(base);
    this['_vis' + key] = { base, knob };
  }

  _bindZone(zone, key) {
    const start = (e) => {
      e.preventDefault();
      this.touchMode = true;
      const t = e.changedTouches[0];
      this._sticks[key] = { id: t.identifier, ox: t.clientX, oy: t.clientY, dx: 0, dy: 0 };
      const vis = this['_vis' + key];
      vis.base.style.display = 'block';
      vis.base.style.left = t.clientX + 'px';
      vis.base.style.top = t.clientY + 'px';
      vis.knob.style.transform = 'translate(-50%,-50%)';
    };
    const move = (e) => {
      const s = this._sticks[key];
      if (!s) return;
      for (const t of e.changedTouches) {
        if (t.identifier !== s.id) continue;
        e.preventDefault();
        let dx = t.clientX - s.ox, dy = t.clientY - s.oy;
        const len = Math.hypot(dx, dy);
        if (len > JOY_RADIUS) { dx *= JOY_RADIUS / len; dy *= JOY_RADIUS / len; }
        s.dx = dx / JOY_RADIUS; s.dy = dy / JOY_RADIUS;
        this['_vis' + key].knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      }
    };
    const end = (e) => {
      const s = this._sticks[key];
      if (!s) return;
      for (const t of e.changedTouches) {
        if (t.identifier !== s.id) continue;
        this._sticks[key] = null;
        this['_vis' + key].base.style.display = 'none';
      }
    };
    zone.addEventListener('touchstart', start, { passive: false });
    zone.addEventListener('touchmove', move, { passive: false });
    zone.addEventListener('touchend', end);
    zone.addEventListener('touchcancel', end);
  }

  // called once per frame before the simulation step
  update() {
    // --- movement ---
    const L = this._sticks.L;
    if (L) {
      this.move.x = L.dx; this.move.y = L.dy;
    } else {
      let x = 0, y = 0;
      if (this._keys.has('KeyW') || this._keys.has('ArrowUp')) y -= 1;
      if (this._keys.has('KeyS') || this._keys.has('ArrowDown')) y += 1;
      // note: physical D = screen-right regardless of RTL text direction
      if (this._keys.has('KeyD') || this._keys.has('ArrowRight')) x += 1;
      if (this._keys.has('KeyA') || this._keys.has('ArrowLeft')) x -= 1;
      const len = Math.hypot(x, y) || 1;
      this.move.x = x / (len > 1 ? len : 1);
      this.move.y = y / (len > 1 ? len : 1);
    }

    // --- aim + fire ---
    const R = this._sticks.R;
    if (R) {
      const mag = Math.hypot(R.dx, R.dy);
      if (mag > 0.12) { this.aim.x = R.dx / mag; this.aim.y = R.dy / mag; }
      this.firing = mag > FIRE_THRESHOLD;
    } else if (!this.touchMode) {
      const mag = Math.hypot(this._mouse.x, this._mouse.y);
      if (mag > 4) { this.aim.x = this._mouse.x / mag; this.aim.y = this._mouse.y / mag; }
      this.firing = this._mouse.down;
    } else {
      this.firing = false;
    }
  }
}
