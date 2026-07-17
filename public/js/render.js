// ============================================================
// Procedural renderer — zero image assets.
// Ships, enemies, crystals, starfield, particles: all drawn
// with Canvas 2D paths + glow. Seeded so all clients match.
// ============================================================

import { GAME, ENEMIES } from './config.js';
import { TAU, clamp, rng } from './util.js';

let quality = 'high'; // 'high' | 'low'
export function setQuality(q) { quality = q; }
export function getQuality() { return quality; }

export const SHIP_SHAPES = {
  storm:  [[18, 0], [-12, 11], [-6, 0], [-12, -11]],
  shadow: [[22, 0], [-14, 7], [-9, 0], [-14, -7]],
  aegis:  [[17, 0], [5, 13], [-12, 13], [-17, 0], [-12, -13], [5, -13]],
  nova:   [[19, 0], [-3, 6], [-15, 15], [-9, 2], [-16, 0], [-9, -2], [-15, -15], [-3, -6]],
};

const ENEMY_HUES = { crawler: 350, stinger: 25, crusher: 275, boss: 305 };

export class Renderer {
  constructor(canvas, minimap) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.minimap = minimap;
    this.mctx = minimap ? minimap.getContext('2d') : null;
    this.stars = [];
    this.nebulae = [];
    this.time = 0;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, quality === 'high' ? 2 : 1.25);
    this.w = this.canvas.clientWidth;
    this.h = this.canvas.clientHeight;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.minimap) {
      this.minimap.width = this.minimap.clientWidth * dpr;
      this.minimap.height = this.minimap.clientHeight * dpr;
      this.mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  setWorld(seed) {
    const r = rng(seed ^ 0x51ed);
    const A = GAME.arena;
    this.stars = [];
    for (const [pf, n, smax] of [[0.25, 90, 1.4], [0.5, 70, 1.8], [0.85, 50, 2.4]]) {
      for (let i = 0; i < n; i++) {
        this.stars.push({
          x: (r() - 0.15) * A * 1.3, y: (r() - 0.15) * A * 1.3,
          pf, s: 0.5 + r() * smax, tw: r() * TAU,
        });
      }
    }
    this.nebulae = [];
    for (let i = 0; i < 4; i++) {
      this.nebulae.push({
        x: r() * A, y: r() * A, r: 300 + r() * 420,
        hue: 190 + r() * 140, pf: 0.35,
      });
    }
  }

  draw(game, dt) {
    this.time += dt;
    const ctx = this.ctx;
    const { w, h } = this;
    const shx = (Math.random() - 0.5) * game.cam.shake;
    const shy = (Math.random() - 0.5) * game.cam.shake;
    const camX = game.cam.x + shx, camY = game.cam.y + shy;

    // --- background ---
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#070914');
    g.addColorStop(1, '#0b0620');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // nebulae (parallax blobs)
    if (quality === 'high') {
      for (const nb of this.nebulae) {
        const x = w / 2 + (nb.x - camX) * nb.pf;
        const y = h / 2 + (nb.y - camY) * nb.pf;
        const rad = ctx.createRadialGradient(x, y, 0, x, y, nb.r);
        rad.addColorStop(0, `hsla(${nb.hue}, 80%, 40%, 0.10)`);
        rad.addColorStop(1, 'transparent');
        ctx.fillStyle = rad;
        ctx.fillRect(x - nb.r, y - nb.r, nb.r * 2, nb.r * 2);
      }
    }

    // stars
    ctx.fillStyle = '#dfe9ff';
    for (const s of this.stars) {
      const x = w / 2 + (s.x - camX) * s.pf;
      const y = h / 2 + (s.y - camY) * s.pf;
      if (x < -4 || y < -4 || x > w + 4 || y > h + 4) continue;
      const a = 0.4 + 0.6 * Math.abs(Math.sin(this.time * 0.8 + s.tw));
      ctx.globalAlpha = a * (s.pf * 0.9 + 0.1);
      ctx.fillRect(x, y, s.s, s.s);
    }
    ctx.globalAlpha = 1;

    // --- world space ---
    ctx.save();
    ctx.translate(w / 2 - camX, h / 2 - camY);

    this._drawArena(ctx, camX, camY);
    for (const o of game.obstacles) this._drawCrystal(ctx, o);
    for (const pk of game.pickups.values()) this._drawPickup(ctx, pk);
    for (const b of game.bullets) this._drawBullet(ctx, b);
    for (const e of game.enemies.values()) this._drawEnemy(ctx, e);
    for (const p of game.players.values()) if (p.alive) this._drawShip(ctx, p, game);
    this._drawParticles(ctx, game.particles);
    this._drawFloats(ctx, game.floats);

    ctx.restore();

    // respawn / death vignette
    if (game.me && !game.me.alive && !game.over) {
      ctx.fillStyle = 'rgba(120, 10, 30, 0.18)';
      ctx.fillRect(0, 0, w, h);
    }

    if (this.mctx) this._drawMinimap(game);
  }

  _drawArena(ctx, camX, camY) {
    const A = GAME.arena;
    // grid
    ctx.strokeStyle = 'rgba(110, 140, 255, 0.07)';
    ctx.lineWidth = 1;
    const step = 200;
    const x0 = Math.max(0, Math.floor((camX - this.w) / step) * step);
    const x1 = Math.min(A, camX + this.w);
    const y0 = Math.max(0, Math.floor((camY - this.h) / step) * step);
    const y1 = Math.min(A, camY + this.h);
    ctx.beginPath();
    for (let x = x0; x <= x1; x += step) { ctx.moveTo(x, Math.max(0, y0)); ctx.lineTo(x, y1); }
    for (let y = y0; y <= y1; y += step) { ctx.moveTo(Math.max(0, x0), y); ctx.lineTo(x1, y); }
    ctx.stroke();
    // border
    ctx.strokeStyle = 'rgba(90, 200, 255, 0.65)';
    ctx.lineWidth = 3;
    if (quality === 'high') { ctx.shadowColor = 'rgba(90,200,255,0.8)'; ctx.shadowBlur = 16; }
    ctx.strokeRect(0, 0, A, A);
    ctx.shadowBlur = 0;
  }

  _drawCrystal(ctx, o) {
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.rotate(o.rot);
    ctx.beginPath();
    for (let i = 0; i < o.sides; i++) {
      const a = (i / o.sides) * TAU;
      const rr = o.r * (i % 2 ? 0.86 : 1);
      i ? ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    const g = ctx.createRadialGradient(0, 0, o.r * 0.15, 0, 0, o.r);
    g.addColorStop(0, `hsla(${o.hue}, 60%, 30%, 0.95)`);
    g.addColorStop(1, `hsla(${o.hue}, 70%, 12%, 0.95)`);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = `hsla(${o.hue}, 90%, 65%, 0.55)`;
    ctx.lineWidth = 2;
    if (quality === 'high') { ctx.shadowColor = `hsla(${o.hue},90%,60%,0.6)`; ctx.shadowBlur = 12; }
    ctx.stroke();
    ctx.shadowBlur = 0;
    // inner facets
    ctx.strokeStyle = `hsla(${o.hue}, 80%, 70%, 0.18)`;
    ctx.beginPath();
    for (let i = 0; i < o.sides; i += 2) {
      const a = (i / o.sides) * TAU;
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * o.r, Math.sin(a) * o.r);
    }
    ctx.stroke();
    ctx.restore();
  }

  _drawPickup(ctx, pk) {
    const pulse = 1 + 0.12 * Math.sin(this.time * 5);
    ctx.save();
    ctx.translate(pk.x, pk.y);
    ctx.scale(pulse, pulse);
    if (pk.k === 'hp') {
      ctx.fillStyle = 'rgba(60, 220, 130, 0.9)';
      if (quality === 'high') { ctx.shadowColor = '#3adc82'; ctx.shadowBlur = 14; }
      ctx.fillRect(-10, -3.5, 20, 7);
      ctx.fillRect(-3.5, -10, 7, 20);
    } else {
      ctx.rotate(this.time * 1.5);
      ctx.beginPath();
      ctx.moveTo(0, -11); ctx.lineTo(8, 0); ctx.lineTo(0, 11); ctx.lineTo(-8, 0);
      ctx.closePath();
      ctx.fillStyle = 'rgba(125, 211, 252, 0.95)';
      if (quality === 'high') { ctx.shadowColor = '#7dd3fc'; ctx.shadowBlur = 14; }
      ctx.fill();
      ctx.strokeStyle = '#e0f2fe';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();
    ctx.shadowBlur = 0;
  }

  _drawBullet(ctx, b) {
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.a);
    const hue = b.team === 'e' ? 340 : b.hue;
    if (quality === 'high') { ctx.shadowColor = `hsl(${hue},100%,60%)`; ctx.shadowBlur = 10; }
    if (b.weapon === 'laser') {
      ctx.fillStyle = `hsla(${hue}, 100%, 72%, 0.95)`;
      ctx.fillRect(-16, -2, 32, 4);
      ctx.fillStyle = '#fff';
      ctx.fillRect(-16, -0.8, 32, 1.6);
    } else if (b.weapon === 'missile') {
      ctx.fillStyle = `hsl(${hue}, 90%, 65%)`;
      ctx.beginPath();
      ctx.moveTo(8, 0); ctx.lineTo(-6, 4.5); ctx.lineTo(-6, -4.5);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,200,80,0.85)';
      ctx.beginPath(); ctx.arc(-8, 0, 3 + Math.random() * 2, 0, TAU); ctx.fill();
    } else {
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, b.r + 3);
      grad.addColorStop(0, '#fff');
      grad.addColorStop(0.4, `hsl(${hue}, 100%, 65%)`);
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(0, 0, b.r + 3, 0, TAU); ctx.fill();
    }
    ctx.restore();
    ctx.shadowBlur = 0;
  }

  _drawShip(ctx, p, game) {
    const blink = p.invulnT > 0 && Math.sin(this.time * 18) > 0;
    ctx.save();
    ctx.translate(p.x, p.y);

    // shield ring
    if (p.shieldT > 0) {
      ctx.strokeStyle = `hsla(${p.hue}, 100%, 70%, ${0.5 + 0.3 * Math.sin(this.time * 8)})`;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, p.r + 9, 0, TAU); ctx.stroke();
    }

    ctx.rotate(p.a);
    ctx.globalAlpha = blink ? 0.35 : 1;

    // thruster
    const sp = Math.hypot(p.vx, p.vy);
    if (sp > 40) {
      const fl = 8 + (sp / p.speed) * 12 + Math.random() * 4;
      const fg = ctx.createLinearGradient(-12, 0, -12 - fl, 0);
      fg.addColorStop(0, `hsla(${p.hue}, 100%, 70%, 0.9)`);
      fg.addColorStop(1, 'transparent');
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.moveTo(-11, -4); ctx.lineTo(-12 - fl, 0); ctx.lineTo(-11, 4);
      ctx.closePath(); ctx.fill();
    }

    // hull
    const shape = SHIP_SHAPES[p.ship] || SHIP_SHAPES.storm;
    ctx.beginPath();
    shape.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    const hg = ctx.createLinearGradient(-16, 0, 18, 0);
    hg.addColorStop(0, `hsl(${p.hue}, 45%, 16%)`);
    hg.addColorStop(1, `hsl(${p.hue}, 60%, 34%)`);
    ctx.fillStyle = hg;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = `hsl(${p.hue}, 95%, 62%)`;
    if (quality === 'high') { ctx.shadowColor = `hsl(${p.hue},95%,60%)`; ctx.shadowBlur = p.overdriveT > 0 ? 22 : 12; }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // cockpit
    ctx.fillStyle = `hsla(${p.hue}, 100%, 82%, 0.95)`;
    ctx.beginPath(); ctx.arc(4, 0, 3.4, 0, TAU); ctx.fill();

    ctx.rotate(-p.a);
    ctx.globalAlpha = 1;

    // name + hp bar (skip for self — HUD shows it big)
    const isMe = p === game.me;
    ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = isMe ? '#9ff2ff' : 'rgba(230,236,255,0.85)';
    ctx.fillText(p.name, 0, -p.r - 14);

    const bw = 40, bh = 4.5;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(-bw / 2, p.r + 8, bw, bh);
    const frac = clamp(p.hp / p.maxHp, 0, 1);
    ctx.fillStyle = frac > 0.5 ? '#54e08a' : frac > 0.25 ? '#ffd166' : '#ff6b6b';
    ctx.fillRect(-bw / 2, p.r + 8, bw * frac, bh);

    // chat bubble
    if (p.chatT > 0) {
      ctx.font = '700 14px "Segoe UI", system-ui, sans-serif';
      const tw = ctx.measureText(p.chatTxt).width + 16;
      ctx.fillStyle = 'rgba(10, 14, 34, 0.85)';
      ctx.strokeStyle = `hsla(${p.hue}, 90%, 65%, 0.8)`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(-tw / 2, -p.r - 44, tw, 22, 8);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#eef2ff';
      ctx.fillText(p.chatTxt, 0, -p.r - 28);
    }
    ctx.restore();
  }

  _drawEnemy(ctx, e) {
    const hue = ENEMY_HUES[e.kind] || 350;
    ctx.save();
    ctx.translate(e.x, e.y);
    const wob = Math.sin(this.time * 4 + e.x * 0.01) * 0.15;

    ctx.rotate(e.kind === 'boss' ? this.time * 0.4 : e.a + wob);
    ctx.beginPath();
    if (e.kind === 'crawler') {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        const rr = e.r * (i % 2 ? 0.55 : 1);
        i ? ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
    } else if (e.kind === 'stinger') {
      ctx.moveTo(e.r, 0); ctx.lineTo(0, e.r * 0.65); ctx.lineTo(-e.r, 0); ctx.lineTo(0, -e.r * 0.65);
    } else if (e.kind === 'crusher') {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        i ? ctx.lineTo(Math.cos(a) * e.r, Math.sin(a) * e.r) : ctx.moveTo(Math.cos(a) * e.r, Math.sin(a) * e.r);
      }
    } else { // boss — pulsing star
      const spikes = 8;
      const pulse = 1 + 0.06 * Math.sin(this.time * 3);
      for (let i = 0; i < spikes * 2; i++) {
        const a = (i / (spikes * 2)) * TAU;
        const rr = e.r * (i % 2 ? 0.55 : 1) * pulse;
        i ? ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
    }
    ctx.closePath();
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, e.r);
    g.addColorStop(0, `hsl(${hue}, 70%, 22%)`);
    g.addColorStop(1, `hsl(${hue}, 80%, 8%)`);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = `hsl(${hue}, 95%, 55%)`;
    ctx.lineWidth = e.kind === 'boss' ? 3 : 2;
    if (quality === 'high') { ctx.shadowColor = `hsl(${hue},95%,55%)`; ctx.shadowBlur = e.kind === 'boss' ? 26 : 10; }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // eye / core
    ctx.fillStyle = `hsl(${hue}, 100%, 70%)`;
    ctx.beginPath(); ctx.arc(0, 0, e.kind === 'boss' ? 10 : 4, 0, TAU); ctx.fill();
    ctx.rotate(0);
    ctx.restore();

    // hp bar
    const bw = e.kind === 'boss' ? 90 : 34, bh = e.kind === 'boss' ? 6 : 4;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(e.x - bw / 2, e.y - e.r - 12, bw, bh);
    ctx.fillStyle = `hsl(${hue}, 90%, 55%)`;
    ctx.fillRect(e.x - bw / 2, e.y - e.r - 12, bw * clamp(e.hp / e.maxHp, 0, 1), bh);
  }

  _drawParticles(ctx, particles) {
    for (const p of particles) {
      const a = clamp(p.life / p.maxLife, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.hue ? `hsl(${p.hue}, 95%, 65%)` : '#ffd9a0';
      if (p.glow && quality === 'high') { ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 8; }
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * a, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
  }

  _drawFloats(ctx, floats) {
    ctx.textAlign = 'center';
    ctx.font = '800 15px "Segoe UI", system-ui, sans-serif';
    for (const f of floats) {
      ctx.globalAlpha = clamp(f.life / 0.4, 0, 1);
      ctx.fillStyle = f.color;
      ctx.fillText(f.txt, f.x, f.y);
    }
    ctx.globalAlpha = 1;
  }

  _drawMinimap(game) {
    const m = this.mctx;
    const s = this.minimap.clientWidth;
    const k = s / GAME.arena;
    m.clearRect(0, 0, s, s);
    m.fillStyle = 'rgba(8, 12, 30, 0.75)';
    m.fillRect(0, 0, s, s);
    m.strokeStyle = 'rgba(90,200,255,0.7)';
    m.lineWidth = 1.5;
    m.strokeRect(0.5, 0.5, s - 1, s - 1);
    m.fillStyle = 'rgba(120,140,220,0.5)';
    for (const o of game.obstacles) {
      m.beginPath(); m.arc(o.x * k, o.y * k, Math.max(1.5, o.r * k), 0, TAU); m.fill();
    }
    for (const e of game.enemies.values()) {
      m.fillStyle = `hsl(${ENEMY_HUES[e.kind]}, 95%, 60%)`;
      const r = e.kind === 'boss' ? 4 : 2;
      m.fillRect(e.x * k - r / 2, e.y * k - r / 2, r, r);
    }
    for (const p of game.players.values()) {
      if (!p.alive) continue;
      m.fillStyle = p === game.me ? '#ffffff' : `hsl(${p.hue}, 95%, 62%)`;
      m.beginPath(); m.arc(p.x * k, p.y * k, p === game.me ? 3 : 2.4, 0, TAU); m.fill();
    }
  }
}
