// ============================================================
// Physical game-controller support (Xbox / PlayStation / generic).
//
// One always-on rAF poll drives two very different jobs depending on
// where you are:
//   • In a match  → feeds the Input object: left stick moves, right
//     stick looks (sensitivity / invert / deadzone from settings),
//     buttons mapped through the user's rebindable binds, rumble on hit.
//   • In the menus → spatial focus navigation of the on-screen buttons
//     (stick / D-pad moves the highlight, A selects, B goes back) so the
//     whole game is playable with no mouse — required for the Xbox
//     browser, which has no pointer at all.
// ============================================================

import { settings } from './settings.js';

// standard-mapping trigger buttons report an analog value; treat >0.5 as pressed
const isPressed = (b) => b && (b.pressed || b.value > 0.5);

export class GamePad {
  constructor() {
    this.input = null;
    this.index = null;
    this.connected = false;
    this._prev = [];              // previous frame's pressed booleans
    this._rebind = null;          // resolve fn while capturing a new bind
    this._lastNav = 0;            // menu-nav repeat throttle
    this._focus = null;           // current menu focus element
    this._raf = 0;
    this._rumbleT = 0;
    // supplied by main.js
    this.inMatch = () => false;   // true while a match is running
    this.buyUi = null;            // tactical buy panel controls {isOpen, move, buy, close}
    this.onConnect = null;        // notify UI (e.g. settings status)
    this.doBack = () => {};        // invoked on B in menus
    this.onFirstInput = null;     // first button press (e.g. unlock audio on Xbox)
    this._gotInput = false;
  }

  bind(input) { this.input = input; }

  start() {
    window.addEventListener('gamepadconnected', (e) => {
      this.index = e.gamepad.index; this.connected = true;
      if (this.onConnect) this.onConnect(true);
    });
    window.addEventListener('gamepaddisconnected', () => {
      this.connected = false; this.index = null;
      if (this.onConnect) this.onConnect(false);
    });
    const loop = () => { try { this.poll(); } catch { /* never kill the loop */ } this._raf = requestAnimationFrame(loop); };
    this._raf = requestAnimationFrame(loop);
  }

  _pad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    if (this.index != null && pads[this.index]) return pads[this.index];
    for (const p of pads) if (p && p.connected !== false) { this.index = p.index; return p; }
    return null;
  }

  // capture the next button press to (re)bind an action; returns a Promise<index>
  captureBind() {
    return new Promise((resolve) => { this._rebind = resolve; });
  }
  cancelCapture() { this._rebind = null; }

  rumble(strength = 0.4, ms = 120) {
    if (!settings.vibration) return;
    const pad = this._pad();
    const act = pad && (pad.vibrationActuator || (pad.hapticActuators && pad.hapticActuators[0]));
    if (!act) return;
    try {
      if (act.playEffect) act.playEffect('dual-rumble', { duration: ms, strongMagnitude: strength, weakMagnitude: strength * 0.7 });
      else if (act.pulse) act.pulse(strength, ms);
    } catch { /* ignore */ }
  }

  poll() {
    const pad = this._pad();
    if (!pad) { if (this.connected) { this.connected = false; if (this.onConnect) this.onConnect(false); } return; }
    if (!this.connected) { this.connected = true; if (this.onConnect) this.onConnect(true); }

    const btns = pad.buttons.map(isPressed);
    const just = (i) => btns[i] && !this._prev[i];

    // first controller press → let the app unlock audio (Xbox has no tap)
    if (!this._gotInput && btns.some(Boolean)) { this._gotInput = true; this.onFirstInput?.(); }

    if (this._rebind) {
      const i = btns.findIndex((v, k) => v && !this._prev[k]);
      if (i >= 0) { const r = this._rebind; this._rebind = null; r(i); }
      this._prev = btns; return;
    }

    if (this.inMatch() && this.input) this._drive(pad, btns, just);
    else this._navigate(pad, btns, just);

    this._prev = btns;
  }

  // ---- in-match: feed the Input ----
  _drive(pad, btns, just) {
    const inp = this.input;
    const b = settings.binds;
    const dz = settings.deadzone;
    const dead = (v) => { const a = Math.abs(v); return a < dz ? 0 : Math.sign(v) * (a - dz) / (1 - dz); };
    const held = (name) => btns[b[name]];
    const hit = (name) => just(b[name]);

    const lx = dead(pad.axes[0] || 0), ly = dead(pad.axes[1] || 0);
    const rx = dead(pad.axes[2] || 0), ry = dead(pad.axes[3] || 0);
    const active = lx || ly || rx || ry || btns.some(Boolean);

    // movement (forward = stick up = -y)
    inp.padMove.x = lx; inp.padMove.y = -ly;
    inp._padActive = !!active;

    // look — squared response for fine aim, per-axis sensitivity + invert
    const curve = (v) => v * Math.abs(v);
    const adsMul = inp.aiming ? 0.5 : 1;
    inp.lookDX += curve(rx) * 0.05 * settings.sensX * adsMul;
    inp.lookDY += curve(ry) * 0.05 * settings.sensY * adsMul * (settings.invertY ? -1 : 1);

    // buy menu open (tactical prep): sticks still walk/look, but the face
    // buttons drive the shop — D-pad/LB/RB move, A buys, B closes.
    if (this.buyUi && this.buyUi.isOpen()) {
      if (just(12) || just(2)) this.buyUi.move(-1);            // up / X
      if (just(13)) this.buyUi.move(1);                        // down
      if (just(14) || just(b.slotPrev)) this.buyUi.move(-1);   // left / LB
      if (just(15) || just(b.slotNext)) this.buyUi.move(1);    // right / RB
      if (just(0)) this.buyUi.buy();                           // A
      if (just(1)) this.buyUi.close();                         // B
      return;
    }

    // ════════ Fortnite-style modal controller ════════
    // B swaps combat⇄build · Y draws the pickaxe · the 4 shoulders are modal:
    // build → the 4 pieces (Builder-Pro: press = select+place, hold = turbo),
    // combat → fire/aim + weapon swap. (Fixed scheme; overrides rebinds.)
    // movement / stance / utility
    inp._padSprint = btns[10];              // LS-click sprint
    inp._padCrouch = btns[11];              // RS-click crouch (hold while moving → slide)
    inp._padScore = btns[8];                // View: scoreboard
    if (just(0)) inp.wantJump = true;       // A: jump
    inp.jumpHeld = btns[0];                  // (held → fly up in god-mode)
    if (just(9)) inp.wantEmote = 0;         // Menu: emote
    if (just(13)) inp.wantNade = true;      // D-pad down: grenade
    if (just(12)) inp.wantCamera = true;    // D-pad up: 3rd-person toggle

    // mode swaps
    if (just(1)) inp.toggleBuild();                                  // B: combat ⇄ build
    if (just(3)) inp.setTool(inp.tool === 'pick' ? 'gun' : 'pick');  // Y: pickaxe

    if (inp.tool === 'gun') {
      // combat: RT fire · LT aim · LB/RB weapon swap · X reload
      inp._padFire = btns[7];
      inp._padAim = btns[6];
      if (just(4)) inp.padCycle(-1);
      if (just(5)) inp.padCycle(1);
      if (just(2)) inp.wantReload = true;
    } else if (inp.tool === 'pick') {
      inp._padFire = btns[7];               // RT: swing pickaxe
      inp._padAim = false;
    } else if (inp.tool === 'edit') {
      inp._padFire = btns[7];               // RT: apply edit
      inp._padAim = false;
      if (just(2)) inp.setTool(inp.lastPiece || 'wall');   // X: exit edit
    } else {
      // build (Builder-Pro): LB wall · RB ramp · LT floor · RT cone
      let placing = false;
      for (const [bi, piece] of [[4, 'wall'], [5, 'ramp'], [6, 'floor'], [7, 'cone']]) {
        if (btns[bi]) { if (inp.tool !== piece) inp.setTool(piece); placing = true; }
      }
      if (just(2)) inp.setTool('edit');     // X: edit
      inp._padFire = placing;
      inp._padAim = false;
    }
  }

  // ---- in-menu: spatial focus navigation ----
  _navigate(pad, btns, just) {
    if (this.input) {
      this.input._padActive = false; this.input._padFire = false;
      this.input._padAim = false; this.input._padScore = false;
    }
    const screen = document.querySelector('.screen.active');
    if (!screen) return;

    // A / B
    if (just(0)) { this._activate(); return; }
    if (just(1)) { this.doBack(); this._focus = null; return; }

    // direction from stick or D-pad, throttled so one flick = one move
    const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0;
    let dx = 0, dy = 0;
    if (btns[14] || ax < -0.5) dx = -1; else if (btns[15] || ax > 0.5) dx = 1;
    if (btns[12] || ay < -0.5) dy = -1; else if (btns[13] || ay > 0.5) dy = 1;
    const now = performance.now();
    // _lastNav === 0 means "ready" (just released) → move immediately;
    // otherwise wait out the repeat delay so one flick = one step
    if ((dx || dy) && (this._lastNav === 0 || now - this._lastNav > 180)) {
      this._lastNav = now || 1;
      this._move(screen, dx, dy);
    }
    if (!dx && !dy) this._lastNav = 0;
  }

  _focusables(screen) {
    return [...screen.querySelectorAll('button, input, [tabindex]')].filter((el) => {
      if (el.disabled) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && el.offsetParent !== null;
    });
  }

  _ensureFocus(screen) {
    const list = this._focusables(screen);
    if (!list.length) { this._focus = null; return null; }
    if (!this._focus || !screen.contains(this._focus) || !list.includes(this._focus)) {
      this._setFocus(list[0]);
    }
    return list;
  }

  _setFocus(el) {
    if (this._focus) this._focus.classList.remove('gp-focus');
    this._focus = el;
    if (el) {
      el.classList.add('gp-focus');
      el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
  }

  _move(screen, dx, dy) {
    const list = this._ensureFocus(screen);
    if (!list) return;
    const cur = this._focus.getBoundingClientRect();
    const cx = cur.left + cur.width / 2, cy = cur.top + cur.height / 2;
    let best = null, bestScore = Infinity;
    for (const el of list) {
      if (el === this._focus) continue;
      const r = el.getBoundingClientRect();
      const ex = r.left + r.width / 2, ey = r.top + r.height / 2;
      const vx = ex - cx, vy = ey - cy;
      // must lie in the pressed direction (dominant axis)
      const along = dx ? vx * dx : vy * dy;
      if (along <= 2) continue;
      const off = dx ? Math.abs(vy) : Math.abs(vx);
      const score = along + off * 2.2;   // prefer aligned + near
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) this._setFocus(best);
  }

  _activate() {
    const el = this._focus;
    if (!el) return;
    if (el.tagName === 'INPUT') { el.focus(); return; }   // Xbox pops its on-screen keyboard
    el.click();
    this._focus = null;   // screens usually change; re-acquire next frame
  }

  // let main clear the highlight when leaving a screen via other means
  clearFocus() { this._setFocus(null); }
}

export const gamepad = new GamePad();
