// ---------------------------------------------------------------------------
// SCRAN! — shared constants & helpers
// Every script is a classic (non-module) script so the game runs straight from
// file:// with no build step. Everything hangs off the global `SG` namespace.
// ---------------------------------------------------------------------------
window.SG = window.SG || {};

(function (SG) {
  'use strict';

  // Logical resolution. The canvas is scaled to fit the window (letterboxed).
  SG.W = 1920;
  SG.H = 1080;

  // The walkable promenade (ground plane). y is depth: small y = far (by the
  // shopfronts), large y = near (by the sea wall).
  SG.GROUND_TOP = 565;
  SG.GROUND_BOTTOM = 898;
  SG.FACADE_Y = 560;     // base line of the shop facades / quay edge
  SG.SEAWALL_Y = 905;    // top of the sea wall
  SG.WATER_Y = 948;      // where the foreground sea starts
  SG.WATER_MAX_Y = 1050; // furthest a gull can float/fly towards camera
  SG.SKY_Z = 470;        // ceiling for flying gulls

  // Shop serving hatch geometry (shared by backdrop + gameplay).
  SG.HATCH = { halfW: 75, top: 440, bottom: 530, counterTop: 528, counterBottom: 552 };

  // Fonts (loaded from Google Fonts in index.html, with fallbacks).
  SG.FONT_TITLE = "'Luckiest Guy', 'Arial Black', Impact, sans-serif";
  SG.FONT = "'Fredoka', 'Trebuchet MS', 'Arial Rounded MT Bold', sans-serif";

  // Ink colour used for all cartoon outlines.
  SG.INK = '#2d2a4a';

  // Player colours (P1..P4).
  SG.PLAYER_COLORS = ['#ff4d6d', '#3a86ff', '#2ec27e', '#ffbe0b'];
  SG.PLAYER_DARK = ['#b3123a', '#1d4fb8', '#17804e', '#c48a00'];
  SG.PLAYER_NAMES = ['Gulliver', 'Squawkers', 'Chipper', 'Wee Morag'];

  // ---- math ---------------------------------------------------------------
  const M = {
    clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
    lerp: (a, b, t) => a + (b - a) * t,
    invLerp: (a, b, v) => (v - a) / (b - a),
    dist: (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1),
    dist2: (x1, y1, x2, y2) => { const dx = x2 - x1, dy = y2 - y1; return dx * dx + dy * dy; },
    angle: (x1, y1, x2, y2) => Math.atan2(y2 - y1, x2 - x1),
    angDiff: (a, b) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; },
    rand: (a, b) => a + Math.random() * (b - a),
    randInt: (a, b) => Math.floor(a + Math.random() * (b - a + 1)),
    pick: (arr) => arr[Math.floor(Math.random() * arr.length)],
    chance: (p) => Math.random() < p,
    sign: (v) => (v < 0 ? -1 : 1),
    approach: (v, target, step) => (v < target ? Math.min(v + step, target) : Math.max(v - step, target)),
    easeOutBack: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
    easeOutCubic: (t) => 1 - Math.pow(1 - t, 3),
    easeInOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
    weighted: (items, weightFn) => {
      let total = 0;
      for (const it of items) total += weightFn(it);
      let r = Math.random() * total;
      for (const it of items) { r -= weightFn(it); if (r <= 0) return it; }
      return items[items.length - 1];
    },
    shuffle: (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; },
  };
  SG.M = M;

  // Perspective scale for drawing: things at the back look a touch smaller.
  SG.depthScale = (y) => 0.84 + 0.26 * M.clamp((y - SG.GROUND_TOP) / (SG.GROUND_BOTTOM - SG.GROUND_TOP), -0.3, 1.5);

  // Stereo pan from an x position.
  SG.panFor = (x) => M.clamp((x / SG.W) * 2 - 1, -1, 1) * 0.7;

  // ---- colour helpers -----------------------------------------------------
  SG.shade = function (hex, amt) {
    // amt in [-1,1]: negative darkens, positive lightens
    let c = hex.replace('#', '');
    if (c.length === 3) c = c.split('').map((ch) => ch + ch).join('');
    let r = parseInt(c.substr(0, 2), 16), g = parseInt(c.substr(2, 2), 16), b = parseInt(c.substr(4, 2), 16);
    if (amt < 0) { r *= 1 + amt; g *= 1 + amt; b *= 1 + amt; }
    else { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
    const h = (v) => ('0' + Math.round(M.clamp(v, 0, 255)).toString(16)).slice(-2);
    return '#' + h(r) + h(g) + h(b);
  };

  SG.rgba = function (hex, a) {
    let c = hex.replace('#', '');
    if (c.length === 3) c = c.split('').map((ch) => ch + ch).join('');
    return `rgba(${parseInt(c.substr(0, 2), 16)},${parseInt(c.substr(2, 2), 16)},${parseInt(c.substr(4, 2), 16)},${a})`;
  };

  // ---- canvas helpers -----------------------------------------------------
  SG.roundRect = function (ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };

  SG.makeCanvas = function (w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    return c;
  };

  // Sprite cache: renders drawFn(ctx) once into an offscreen canvas at the
  // current render scale (logical coords 0..w, 0..h) and reuses it.
  const spriteCache = new Map();
  SG.sprite = function (key, w, h, drawFn) {
    const scale = Math.max(0.5, Math.min(2.5, (SG.view && SG.view.scale) || 1));
    const k = key + '@' + scale.toFixed(3);
    let c = spriteCache.get(k);
    if (!c) {
      c = SG.makeCanvas(w * scale, h * scale);
      const x = c.getContext('2d');
      x.scale(scale, scale);
      drawFn(x);
      if (spriteCache.size > 400) spriteCache.clear();
      spriteCache.set(k, c);
    }
    return c;
  };
  SG.clearSprites = function (prefix) { for (const k of [...spriteCache.keys()]) if (!prefix || k.startsWith(prefix)) spriteCache.delete(k); };

  // Outlined, chunky text (used all over the UI).
  SG.text = function (ctx, str, x, y, opts) {
    opts = opts || {};
    const size = opts.size || 32;
    ctx.save();
    ctx.font = `${opts.weight || 700} ${size}px ${opts.font || SG.FONT}`;
    ctx.textAlign = opts.align || 'center';
    ctx.textBaseline = opts.baseline || 'middle';
    if (opts.alpha !== undefined) ctx.globalAlpha *= opts.alpha;
    if (opts.stroke !== false) {
      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;
      ctx.lineWidth = opts.strokeWidth || Math.max(3, size * 0.18);
      ctx.strokeStyle = opts.strokeColor || SG.INK;
      ctx.strokeText(str, x, y);
    }
    ctx.fillStyle = opts.color || '#fff';
    ctx.fillText(str, x, y);
    ctx.restore();
  };

  // Tiny event bus for decoupled systems (stats, audio hooks, etc.)
  SG.events = {
    handlers: {},
    on(name, fn) { (this.handlers[name] = this.handlers[name] || []).push(fn); },
    emit(name, data) { const h = this.handlers[name]; if (h) for (const fn of h) fn(data); },
    clear() { this.handlers = {}; },
  };

  // Persisted settings.
  SG.settings = {
    master: 0.8, music: 0.6, sfx: 0.9,
    roundTime: 120, rounds: 3, cpuLevel: 1, shake: true, cpuFill: true, cones: true,
  };
  try {
    const saved = JSON.parse(localStorage.getItem('scran-settings') || 'null');
    if (saved) Object.assign(SG.settings, saved);
  } catch (e) { /* storage unavailable: defaults are fine */ }
  SG.saveSettings = function () {
    try { localStorage.setItem('scran-settings', JSON.stringify(SG.settings)); } catch (e) { /* ignore */ }
  };
})(window.SG);
