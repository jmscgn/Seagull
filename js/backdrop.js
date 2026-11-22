// ---------------------------------------------------------------------------
// SCRAN! — procedural seaside backdrop.
//
//   SG.Backdrop.build(stage, scale) -> bd
//       Pre-renders every static layer (sky, far hills/bay, shopfronts +
//       promenade + sea wall, foreground sea) and all animated sprites
//       (clouds, boats, ferry, waves, sparkles) into offscreen canvases.
//   SG.Backdrop.drawBack(ctx, bd, t, state)
//       Per-frame: blits the layers in depth order and animates the cheap
//       stuff (drifting clouds, bobbing boats, the ferry, waves, sparkles,
//       arcade bulbs, chimney smoke, rain tint).
//
// Everything is drawn in the 1920x1080 logical space.
// ---------------------------------------------------------------------------
(function (SG) {
  'use strict';

  const W = SG.W || 1920;
  const INK = SG.INK || '#2d2a4a';
  const M = SG.M;
  const TAU = Math.PI * 2;

  const FACADE_Y = SG.FACADE_Y || 560;
  const SEAWALL_Y = SG.SEAWALL_Y || 905;
  const WATER_Y = SG.WATER_Y || 948;
  const HATCH = SG.HATCH || { halfW: 75, top: 440, bottom: 530 };

  const HZ = 348;                 // sea horizon
  const SKY = [0, 384];           // vertical extents of each prerendered layer
  const FAR = [96, 584];
  const NEAR = [64, 952];
  const SEA = [944, 1080];

  const SIGN_Y0 = 362, SIGN_Y1 = 416;   // fascia sign board
  const AWN_Y0 = 415, AWN_Y1 = 441;     // awning above the hatch
  const PLINTH_Y = 538;                 // stall-riser top
  const QUAY_Y0 = 552, QUAY_Y1 = 575;   // quay coping in the bay

  // ------------------------------------------------------------------ colour
  function parse(hex) {
    let c = hex.replace('#', '');
    if (c.length === 3) c = c.split('').map((ch) => ch + ch).join('');
    return [parseInt(c.substr(0, 2), 16), parseInt(c.substr(2, 2), 16), parseInt(c.substr(4, 2), 16)];
  }
  function toHex(r, g, b) {
    const h = (v) => ('0' + Math.round(Math.max(0, Math.min(255, v))).toString(16)).slice(-2);
    return '#' + h(r) + h(g) + h(b);
  }
  function mix(a, b, t) {
    const A = parse(a), B = parse(b);
    return toHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
  }
  const shade = SG.shade;
  const rgba = SG.rgba;

  // ------------------------------------------------------------------ random
  function rng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashStr(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  // ------------------------------------------------------------------ canvas
  function prepCtx(ctx) {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.miterLimit = 2;
    return ctx;
  }
  function makeLayer(scale, y0, y1) {
    const c = SG.makeCanvas(W * scale, (y1 - y0) * scale);
    const ctx = prepCtx(c.getContext('2d'));
    ctx.setTransform(scale, 0, 0, scale, 0, -y0 * scale);
    return { c, ctx, y0, y1, scale };
  }
  function clearLayer(L) {
    L.ctx.save();
    L.ctx.setTransform(1, 0, 0, 1, 0, 0);
    L.ctx.clearRect(0, 0, L.c.width, L.c.height);
    L.ctx.restore();
  }
  // Sprite: (ox, oy) is the anchor point inside the sprite (logical px).
  function makeSprite(scale, w, h, ox, oy, fn) {
    const c = SG.makeCanvas(w * scale, h * scale);
    const ctx = prepCtx(c.getContext('2d'));
    ctx.setTransform(scale, 0, 0, scale, ox * scale, oy * scale);
    fn(ctx);
    return { c, w, h, ox, oy };
  }
  function blit(ctx, sp, x, y) { ctx.drawImage(sp.c, x - sp.ox, y - sp.oy, sp.w, sp.h); }
  function blitLayer(ctx, L) { ctx.drawImage(L.c, 0, L.y0, W, L.y1 - L.y0); }

  // ------------------------------------------------------------------ shapes
  function rr(ctx, x, y, w, h, r) {
    if (w <= 0 || h <= 0) { ctx.beginPath(); return; }
    SG.roundRect(ctx, x, y, w, h, Math.max(0, r));
  }
  function stroke(ctx, lw, col) { ctx.lineWidth = lw; ctx.strokeStyle = col || INK; ctx.stroke(); }
  function fillStroke(ctx, fill, lw, col) {
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (lw) stroke(ctx, lw, col);
  }
  function rectFS(ctx, x, y, w, h, fill, lw, col) { ctx.beginPath(); ctx.rect(x, y, w, h); fillStroke(ctx, fill, lw, col); }
  function rrFS(ctx, x, y, w, h, r, fill, lw, col) { rr(ctx, x, y, w, h, r); fillStroke(ctx, fill, lw, col); }
  function line(ctx, x0, y0, x1, y1, lw, col) { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); stroke(ctx, lw, col); }
  function circle(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); }
  function circFS(ctx, x, y, r, fill, lw, col) { circle(ctx, x, y, r); fillStroke(ctx, fill, lw, col); }
  function ell(ctx, x, y, rx, ry) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); }
  function poly(ctx, pts, close) {
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    if (close !== false) ctx.closePath();
  }
  // Path for an arch-topped window/opening (semicircle top).
  function archPath(ctx, x, y, w, h) {
    const r = w / 2;
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x, y + r);
    ctx.arc(x + r, y + r, r, Math.PI, 0);
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
  }

  const gs = (x, c, w) => Math.exp(-((x - c) / w) * ((x - c) / w));
  const smooth = (a, b, x) => { const t = M.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  function fnPath(ctx, f, xa, xb, yb, step) {
    ctx.beginPath();
    ctx.moveTo(xa, yb);
    for (let x = xa; x < xb; x += step) ctx.lineTo(x, f(x));
    ctx.lineTo(xb, f(xb));
    ctx.lineTo(xb, yb);
    ctx.closePath();
  }
  function fnLine(ctx, f, xa, xb, step) {
    ctx.beginPath();
    ctx.moveTo(xa, f(xa));
    for (let x = xa + step; x < xb; x += step) ctx.lineTo(x, f(x));
    ctx.lineTo(xb, f(xb));
  }
  // Fill a silhouette with a lit rim along its top edge (cartoon shading).
  function rimFill(ctx, pathFn, base, light, dx, dy) {
    pathFn(); ctx.fillStyle = light; ctx.fill();
    ctx.save();
    pathFn(); ctx.clip();
    ctx.translate(dx, dy);
    pathFn(); ctx.fillStyle = base; ctx.fill();
    ctx.restore();
  }

  // ------------------------------------------------------------------ text
  function setSpacing(ctx, px) { if ('letterSpacing' in ctx) ctx.letterSpacing = px ? px.toFixed(1) + 'px' : '0px'; }
  function fitFont(ctx, text, font, weight, maxSize, maxW, maxH, spacing) {
    let size = maxSize;
    let m = null;
    for (let k = 0; k < 10; k++) {
      ctx.font = `${weight} ${size.toFixed(1)}px ${font}`;
      setSpacing(ctx, spacing ? spacing * size / maxSize : 0);
      m = ctx.measureText(text);
      const asc = m.actualBoundingBoxAscent || size * 0.72;
      const desc = m.actualBoundingBoxDescent || 0;
      const k1 = Math.min(1, maxW / Math.max(1, m.width), maxH ? maxH / Math.max(1, asc + desc) : 1);
      if (k1 > 0.995) break;
      size = Math.max(6, size * k1 * 0.99);
    }
    return size;
  }
  // Draw text (font must already be set) centred on (cx, cy) by its ink box.
  function inkText(ctx, text, cx, cy, fill, strokeW, strokeCol, drop) {
    const m = ctx.measureText(text);
    const asc = m.actualBoundingBoxAscent || 0, desc = m.actualBoundingBoxDescent || 0;
    const by = cy + (asc - desc) / 2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    if (drop) {
      ctx.fillStyle = drop.col;
      if (strokeW) { ctx.lineWidth = strokeW; ctx.strokeStyle = drop.col; ctx.strokeText(text, cx + drop.dx, by + drop.dy); }
      ctx.fillText(text, cx + drop.dx, by + drop.dy);
    }
    if (strokeW) { ctx.lineWidth = strokeW; ctx.strokeStyle = strokeCol || INK; ctx.strokeText(text, cx, by); }
    ctx.fillStyle = fill;
    ctx.fillText(text, cx, by);
  }

  // =========================================================================
  // Palette / per-stage art direction
  // =========================================================================
  function makePalette(st) {
    const haze = mix(st.skyBottom, '#ffffff', 0.12);
    const bayMid = (st.bay.x0 + st.bay.x1) / 2;
    return {
      haze,
      farInk: mix(INK, haze, 0.5),
      farInk2: mix(INK, haze, 0.7),
      slate: '#6e7898', slateDark: '#565f80', slateLight: '#8f98b6',
      pave: '#ecdcbf', paveDark: '#dcc8a6', paveJoint: '#c9b38e',
      stone: '#e7dcc8', stoneDark: '#c8b89c',
      sunX: M.clamp(bayMid + (st.ferrySide === 'left' ? 60 : 160), 200, 1720),
      sunY: 92,
      water: st.waterColor,
    };
  }

  // =========================================================================
  // SKY
  // =========================================================================
  function renderSky(L, st, pal, rainy) {
    const ctx = L.ctx;
    const top = rainy ? '#6c7a91' : st.skyTop;
    const bot = rainy ? '#b4bcc6' : st.skyBottom;
    const gr = ctx.createLinearGradient(0, 0, 0, HZ + 8);
    gr.addColorStop(0, top);
    gr.addColorStop(0.55, mix(top, bot, 0.55));
    gr.addColorStop(1, bot);
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, W, SKY[1]);
    if (rainy) {
      // low heavy cloud base banding
      ctx.fillStyle = 'rgba(80,92,112,0.18)';
      for (let i = 0; i < 5; i++) {
        ell(ctx, 200 + i * 420, 40 + (i % 2) * 30, 360, 60);
        ctx.fill();
      }
      return;
    }
    const sx = pal.sunX, sy = pal.sunY;
    const rg = ctx.createRadialGradient(sx, sy, 0, sx, sy, 560);
    rg.addColorStop(0, 'rgba(255,252,232,0.95)');
    rg.addColorStop(0.1, 'rgba(255,248,214,0.6)');
    rg.addColorStop(0.35, 'rgba(255,244,205,0.2)');
    rg.addColorStop(1, 'rgba(255,244,205,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, W, SKY[1]);
    // sun disc with a soft halo ring
    circFS(ctx, sx, sy, 62, 'rgba(255,252,230,0.35)');
    circFS(ctx, sx, sy, 44, '#fffbe4');
    circle(ctx, sx, sy, 44); stroke(ctx, 3, 'rgba(255,226,150,0.6)');
    // a few soft high cirrus streaks for texture
    const crnd = rng(hashStr(st.id || 'sky') ^ 0x2f);
    ctx.save();
    for (let i = 0; i < 6; i++) {
      const cx = crnd() * W, cy = 40 + crnd() * 140, len = 140 + crnd() * 200;
      ctx.fillStyle = 'rgba(255,255,255,0.13)';
      ell(ctx, cx, cy, len / 2, 4 + crnd() * 3); ctx.fill();
      ell(ctx, cx + 20, cy - 1, len * 0.3, 2.5); ctx.fill();
      ell(ctx, cx - len * 0.15, cy + 9, len * 0.28, 2.5); ctx.fill();
    }
    ctx.restore();
    // warm horizon haze band
    const hg = ctx.createLinearGradient(0, HZ - 90, 0, HZ + 4);
    hg.addColorStop(0, rgba(pal.haze, 0));
    hg.addColorStop(1, rgba(pal.haze, 0.55));
    ctx.fillStyle = hg;
    ctx.fillRect(0, HZ - 90, W, 100);
  }

  // Fluffy cartoon cloud sprite.
  function cloudSprite(scale, rnd, w, h, colors) {
    const pad = 8;
    const circles = [];
    const n = 4 + Math.floor(rnd() * 3);
    const baseY = h - 16;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const bump = Math.sin(Math.PI * t);
      const r = h * (0.2 + 0.3 * bump) * (0.85 + rnd() * 0.3);
      const cx = 18 + t * (w - 36) + (rnd() - 0.5) * 12;
      circles.push([cx, baseY - r * (0.55 + rnd() * 0.25), r]);
    }
    const base = [10, baseY - h * 0.28, w - 20, h * 0.28 + 2, h * 0.14];
    return makeSprite(scale, w + pad * 2, h + pad * 2, pad, pad, (ctx) => {
      // union outline: fill grown shapes in outline colour (two sub-paths -> draw separately)
      const draw = (dy, grow, col) => {
        ctx.fillStyle = col;
        ctx.beginPath();
        for (const c of circles) { ctx.moveTo(c[0] + c[2] + grow, c[1] + dy); ctx.arc(c[0], c[1] + dy, c[2] + grow, 0, TAU); }
        ctx.fill();
        rr(ctx, base[0] - grow, base[1] + dy - grow, base[2] + grow * 2, base[3] + grow * 2, base[4] + grow);
        ctx.fill();
      };
      draw(0, 3, colors.line);
      draw(0, 0, colors.shadow);
      ctx.save();
      // clip to union
      ctx.beginPath();
      for (const c of circles) { ctx.moveTo(c[0] + c[2], c[1]); ctx.arc(c[0], c[1], c[2], 0, TAU); }
      ctx.rect(base[0] + base[4], base[1], base[2] - base[4] * 2, base[3]);
      ctx.clip();
      draw(-7, -1, colors.main);
      // little highlight puffs
      ctx.fillStyle = colors.hi;
      for (let i = 0; i < circles.length; i += 2) {
        const c = circles[i];
        ell(ctx, c[0] - c[2] * 0.3, c[1] - c[2] * 0.45, c[2] * 0.32, c[2] * 0.16);
        ctx.fill();
      }
      ctx.restore();
    });
  }

  function buildClouds(bd, st, scale, rnd) {
    const defs = [
      { y: 52, w: 330, h: 112, v: 9.0 },
      { y: 118, w: 240, h: 80, v: 6.2 },
      { y: 18, w: 210, h: 74, v: 7.4 },
      { y: 160, w: 170, h: 56, v: 4.0 },
      { y: 84, w: 290, h: 96, v: 7.9 },
      { y: 196, w: 130, h: 44, v: 3.1 },
    ];
    const sunny = { line: '#a7c8e6', shadow: '#d5e8f7', main: '#ffffff', hi: 'rgba(255,255,255,0.9)' };
    if (st.skyBottom && parse(st.skyBottom)[0] > 240) { sunny.shadow = '#f3e3dc'; sunny.line = '#b9c6e2'; }
    const grey = { line: '#5f6b80', shadow: '#8692a4', main: '#a9b3c1', hi: 'rgba(205,212,222,0.8)' };
    bd.clouds = defs.map((d, i) => {
      const seed = rnd() * 1e9;
      const s1 = cloudSprite(scale, rng(seed), d.w, d.h, sunny);
      const s2 = cloudSprite(scale, rng(seed), d.w * 1.05, d.h * 1.1, grey);
      return { sp: s1, spRain: s2, y: d.y, v: d.v, x0: (i * 431 + 120 + rnd() * 120) % (W + 300) };
    });
  }

  // =========================================================================
  // FAR LAYER — hills, islands, landmarks, bay water
  // =========================================================================
  function mountain(ctx, f, xa, xb, base, light, outline, lw) {
    const path = () => fnPath(ctx, f, xa, xb, HZ + 30, 5);
    rimFill(ctx, path, base, light, 7, 6);
    // gentle vertical haze toward the horizon
    ctx.save();
    path(); ctx.clip();
    const gr = ctx.createLinearGradient(0, HZ - 80, 0, HZ);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(1, 'rgba(255,255,255,0.22)');
    ctx.fillStyle = gr; ctx.fillRect(xa, HZ - 80, xb - xa, 110);
    ctx.restore();
    fnLine(ctx, f, xa, xb, 5); stroke(ctx, lw, outline);
  }

  function hill(ctx, f, xa, xb, base, light, outline, lw, rim) {
    const path = () => fnPath(ctx, f, xa, xb, FAR[1] + 10, 5);
    rimFill(ctx, path, base, light, 0, rim);
    fnLine(ctx, f, xa, xb, 5); stroke(ctx, lw, outline);
  }

  function island(ctx, top, xa, xb, baseY, base, light, outline, lw, taper) {
    const f = (x) => baseY - (baseY - top(x)) * smooth(xa, xa + taper, x) * smooth(xb, xb - taper, x);
    // soft reflection
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = shade(base, -0.35);
    fnPath(ctx, (x) => baseY + (baseY - f(x)) * 0.35, xa, xb, baseY, 5);
    ctx.fill();
    ctx.restore();
    const path = () => fnPath(ctx, f, xa, xb, baseY, 5);
    rimFill(ctx, path, base, light, 0, 4);
    // darker shoreline band
    ctx.save(); path(); ctx.clip();
    ctx.fillStyle = shade(base, -0.18);
    ctx.fillRect(xa, baseY - 3, xb - xa, 3);
    ctx.restore();
    fnLine(ctx, f, xa, xb, 5); stroke(ctx, lw, outline);
    return f;
  }

  function farTree(ctx, x, yb, r, col, hiCol, outline, lw) {
    const pts = [[x - r * 0.55, yb - r * 0.9, r * 0.72], [x + r * 0.5, yb - r * 0.95, r * 0.75], [x, yb - r * 1.45, r * 0.85]];
    ctx.beginPath();
    for (const p of pts) { ctx.moveTo(p[0] + p[2], p[1]); ctx.arc(p[0], p[1], p[2], 0, TAU); }
    ctx.lineWidth = lw * 2; ctx.strokeStyle = outline; ctx.stroke();
    ctx.fillStyle = col; ctx.fill();
    ell(ctx, x - r * 0.25, yb - r * 1.7, r * 0.42, r * 0.26);
    ctx.fillStyle = hiCol; ctx.fill();
  }

  function farHouse(ctx, x, yb, w, h, wall, roof, winCol, outline, lw, rnd) {
    const x0 = x - w / 2;
    const kind = rnd() < 0.62 ? 0 : 1;
    if (kind === 0) {
      // side-on pitched roof
      const rh = h * 0.55;
      rectFS(ctx, x0, yb - h, w, h, wall, lw, outline);
      poly(ctx, [x0 - 1.5, yb - h, x0 + 3, yb - h - rh, x0 + w - 3, yb - h - rh, x0 + w + 1.5, yb - h]);
      fillStroke(ctx, roof, lw, outline);
      if (rnd() < 0.55) rectFS(ctx, x0 + w * (rnd() < 0.5 ? 0.2 : 0.7), yb - h - rh - 3.5, 3.2, 4.5, mix(wall, roof, 0.4), lw * 0.8, outline);
    } else {
      // gable-end facing us
      const rh = w * 0.5;
      poly(ctx, [x0, yb, x0, yb - h, x0 + w / 2, yb - h - rh, x0 + w, yb - h, x0 + w, yb]);
      fillStroke(ctx, wall, lw, outline);
      poly(ctx, [x0 - 1.5, yb - h + 1, x0 + w / 2, yb - h - rh - 1.5, x0 + w + 1.5, yb - h + 1], false);
      stroke(ctx, lw * 2.2, roof);
    }
    // windows
    ctx.fillStyle = winCol;
    const nw = w > 22 ? 3 : 2;
    const ww = Math.max(2.2, w * 0.14), wh = Math.max(2.4, h * 0.26);
    for (let i = 0; i < nw; i++) {
      const wx = x0 + (i + 0.5) * w / nw - ww / 2;
      ctx.fillRect(wx, yb - h * 0.72, ww, wh);
      if (h > 13) ctx.fillRect(wx, yb - h * 0.36, ww, wh);
    }
  }

  function townRows(ctx, f, xa, xb, opt, rnd) {
    const walls = opt.walls;
    for (let r = 0; r < opt.rows; r++) {
      let x = xa + rnd() * 24;
      while (x < xb) {
        const s = opt.s * (1 - r * 0.02);
        const w = (17 + rnd() * 12) * s;
        const yb = f(x) + opt.first + r * opt.gap + rnd() * 3;
        if (!opt.skip || !opt.skip(x, yb, r)) {
          if (rnd() < opt.tree) {
            farTree(ctx, x, yb + 2, (6 + rnd() * 4) * s, opt.treeCol, opt.treeHi, opt.outline, opt.lw);
          } else {
            const wall = walls[Math.floor(rnd() * walls.length)];
            farHouse(ctx, x, yb, w, (11 + rnd() * 6) * s, wall, opt.roof, opt.win, opt.outline, opt.lw, rnd);
          }
        }
        x += w + (3 + rnd() * 12) * s;
      }
    }
  }

  function bayWater(ctx, st, pal, rnd) {
    const y0 = HZ, y1 = FAR[1];
    const gr = ctx.createLinearGradient(0, y0, 0, y1);
    gr.addColorStop(0, mix(st.waterColor, pal.haze, 0.6));
    gr.addColorStop(0.22, mix(st.waterColor, pal.haze, 0.34));
    gr.addColorStop(0.7, mix(st.waterColor, '#ffffff', 0.04));
    gr.addColorStop(1, shade(st.waterColor, -0.04));
    ctx.fillStyle = gr;
    ctx.fillRect(-10, y0, W + 20, y1 - y0);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(-10, y0, W + 20, 2);
    const bx0 = Math.max(0, st.bay.x0 - 20), bx1 = Math.min(W, st.bay.x1 + 20);
    // gentle darker swell bands
    for (let i = 0; i < 26; i++) {
      const y = y0 + 8 + Math.pow(rnd(), 1.2) * (y1 - y0 - 12);
      const k = (y - y0) / (y1 - y0);
      const len = 30 + rnd() * 120 * (0.4 + k);
      const x = bx0 + rnd() * (bx1 - bx0);
      ctx.fillStyle = rgba(shade(st.waterColor, -0.25), 0.12 + k * 0.08);
      rr(ctx, x - len / 2, y, len, 1.5 + k * 2.5, 2); ctx.fill();
    }
    // light streaks
    for (let i = 0; i < 46; i++) {
      const y = y0 + 4 + Math.pow(rnd(), 1.35) * (y1 - y0 - 8);
      const k = (y - y0) / (y1 - y0);
      const len = 10 + rnd() * 70 * (0.3 + k);
      const x = bx0 + rnd() * (bx1 - bx0);
      ctx.fillStyle = rgba('#ffffff', 0.14 + rnd() * 0.16);
      rr(ctx, x - len / 2, y, len, 1.4 + k * 2, 1.5); ctx.fill();
    }
    // sun glitter path below the sun
    const sx = pal.sunX;
    for (let i = 0; i < 40; i++) {
      const y = y0 + 3 + Math.pow(rnd(), 1.6) * 150;
      const k = (y - y0) / 150;
      const spread = 30 + k * 90;
      const x = sx + (rnd() - 0.5) * 2 * spread;
      const len = 8 + rnd() * (14 + k * 30);
      ctx.fillStyle = rgba('#fffbe8', 0.35 + rnd() * 0.35);
      rr(ctx, x - len / 2, y, len, 1.6 + k * 1.6, 1.2); ctx.fill();
    }
  }

  // McCaig's Tower: a wide granite ring with two tiers of arches.
  function mccaig(ctx, cx, baseY, pal, sky) {
    const R = 100, hgt = 80, topY = baseY - hgt, sag = 6;
    const ink = mix(INK, pal.haze, 0.35);
    const yAt = (x, y) => y + sag * ((x - cx) / R) * ((x - cx) / R);
    const bodyPath = () => {
      ctx.beginPath();
      ctx.moveTo(cx - R, topY + sag);
      ctx.quadraticCurveTo(cx, topY - sag, cx + R, topY + sag);
      ctx.lineTo(cx + R, baseY + sag);
      ctx.quadraticCurveTo(cx, baseY - sag, cx - R, baseY + sag);
      ctx.closePath();
    };
    const lg = ctx.createLinearGradient(cx - R, 0, cx + R, 0);
    lg.addColorStop(0, mix('#a9a8a6', pal.haze, 0.2));
    lg.addColorStop(0.55, mix('#e9e6df', pal.haze, 0.15));
    lg.addColorStop(0.8, mix('#dedad2', pal.haze, 0.15));
    lg.addColorStop(1, mix('#b9b6b0', pal.haze, 0.2));
    bodyPath(); ctx.fillStyle = lg; ctx.fill();
    const inner = mix('#6e7486', pal.haze, 0.25);
    const skyIn = mix(sky, '#ffffff', 0.15);
    const tier = (yb, ht, n) => {
      for (let i = 0; i < n; i++) {
        const th = -Math.PI / 2 + (i + 0.5) * Math.PI / n;
        const x = cx + R * 0.93 * Math.sin(th);
        const aw = 12 * Math.cos(th) + 1.5;
        const yy = yAt(x, yb);
        archPath(ctx, x - aw / 2, yy - ht, aw, ht);
        ctx.fillStyle = inner; ctx.fill();
        // back-wall arch seen through (sky)
        if (aw > 5) {
          archPath(ctx, x - aw * 0.3 + (th * 2), yy - ht * 0.82, aw * 0.6, ht * 0.62);
          ctx.fillStyle = skyIn; ctx.fill();
        }
        archPath(ctx, x - aw / 2, yy - ht, aw, ht);
        stroke(ctx, 1.4, ink);
      }
    };
    tier(baseY - 6, 34, 13);
    tier(baseY - 47, 22, 13);
    // string course between tiers and top parapet line
    ctx.beginPath();
    ctx.moveTo(cx - R, topY + sag + 30); ctx.quadraticCurveTo(cx, topY - sag + 30, cx + R, topY + sag + 30);
    stroke(ctx, 2.5, mix('#c5c1b8', pal.haze, 0.2));
    ctx.beginPath();
    ctx.moveTo(cx - R, topY + sag + 4); ctx.quadraticCurveTo(cx, topY - sag + 4, cx + R, topY + sag + 4);
    stroke(ctx, 2, rgba('#ffffff', 0.7));
    bodyPath(); stroke(ctx, 2.4, ink);
  }

  // The Pencil: slender round tower with a conical pointed cap.
  function pencil(ctx, x, baseY, pal) {
    const h = 150, wb = 28, wt = 22, capH = 40;
    const topY = baseY - h;
    const ink = mix(INK, pal.haze, 0.3);
    const body = () => poly(ctx, [x - wb / 2, baseY, x - wt / 2, topY, x + wt / 2, topY, x + wb / 2, baseY]);
    body(); ctx.fillStyle = '#eae0cf'; ctx.fill();
    ctx.save(); body(); ctx.clip();
    // round shading: dark right, highlight left
    ctx.fillStyle = '#cbbda5';
    poly(ctx, [x + 3, baseY + 2, x + 2, topY - 2, x + 20, topY - 2, x + 20, baseY + 2]); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    poly(ctx, [x - 9, baseY, x - 7, topY, x - 4, topY, x - 5, baseY]); ctx.fill();
    // stone courses
    ctx.strokeStyle = 'rgba(120,100,80,0.22)'; ctx.lineWidth = 1.2;
    for (let y = baseY - 14; y > topY + 4; y -= 14) { ctx.beginPath(); ctx.moveTo(x - 20, y); ctx.lineTo(x + 20, y); ctx.stroke(); }
    ctx.restore();
    body(); stroke(ctx, 2.4, ink);
    // doorway
    archPath(ctx, x - 5, baseY - 18, 10, 18); fillStroke(ctx, '#5c5566', 1.6, ink);
    // tiny slit windows
    rrFS(ctx, x - 1.5, baseY - 70, 3, 9, 1.5, '#5c5566');
    rrFS(ctx, x - 1.5, baseY - 112, 3, 9, 1.5, '#5c5566');
    // collar + conical cap
    rrFS(ctx, x - wt / 2 - 3, topY - 4, wt + 6, 6, 2, '#ddd1bd', 2, ink);
    const cap = () => poly(ctx, [x - wt / 2 - 2, topY - 3, x, topY - 3 - capH, x + wt / 2 + 2, topY - 3]);
    cap(); ctx.fillStyle = '#e4d8c3'; ctx.fill();
    ctx.save(); cap(); ctx.clip();
    ctx.fillStyle = '#c4b59c'; poly(ctx, [x, topY - 3 - capH, x + 20, topY, x, topY]); ctx.fill();
    ctx.restore();
    cap(); stroke(ctx, 2.4, ink);
  }

  function church(ctx, x, baseY, pal) {
    const ink = pal.farInk;
    const wall = mix('#efe6d6', pal.haze, 0.15), roof = mix('#717a96', pal.haze, 0.15);
    rectFS(ctx, x - 13, baseY - 120, 26, 120, wall, 1.8, ink);
    rectFS(ctx, x + 13, baseY - 120, 4, 120, mix(wall, '#000000', 0.12));
    archPath(ctx, x - 5, baseY - 112, 10, 18); fillStroke(ctx, mix('#4d5470', pal.haze, 0.2), 1.4, ink);
    circFS(ctx, x, baseY - 80, 5, mix('#ffffff', pal.haze, 0.1), 1.4, ink);
    rectFS(ctx, x - 16, baseY - 124, 32, 6, wall, 1.8, ink);
    const sp = () => poly(ctx, [x - 14, baseY - 124, x, baseY - 200, x + 14, baseY - 124]);
    sp(); ctx.fillStyle = roof; ctx.fill();
    ctx.save(); sp(); ctx.clip(); ctx.fillStyle = shade(roof, -0.15); poly(ctx, [x, baseY - 200, x + 16, baseY - 120, x, baseY - 120]); ctx.fill(); ctx.restore();
    sp(); stroke(ctx, 1.8, ink);
    circFS(ctx, x, baseY - 203, 3, '#e8c25a', 1.2, ink);
  }

  function distilleryChimney(ctx, x, topY, baseY, pal) {
    const ink = pal.farInk;
    const col = mix('#d7c6ae', pal.haze, 0.15);
    poly(ctx, [x - 13, baseY, x - 10, topY, x + 10, topY, x + 13, baseY]);
    fillStroke(ctx, col, 1.8, ink);
    poly(ctx, [x + 3, baseY, x + 3, topY, x + 10, topY, x + 13, baseY]);
    ctx.fillStyle = rgba('#000000', 0.08); ctx.fill();
    rectFS(ctx, x - 13, topY - 6, 26, 8, mix('#5c5a66', pal.haze, 0.2), 1.8, ink);
    rectFS(ctx, x - 11, topY + 20, 22, 4, mix('#bba88d', pal.haze, 0.15));
  }

  function renderFarOban(ctx, st, pal, rnd) {
    const hz = pal.haze;
    // Mull — blue-grey mountains on the horizon
    const fM = (x) => Math.min(HZ + 4, 352 - 52 * gs(x, 1430, 80) - 58 * gs(x, 1570, 70) - 100 * gs(x, 1735, 110) - 70 * gs(x, 1895, 85));
    mountain(ctx, fM, 1290, 1960, mix('#6e83b4', hz, 0.5), mix('#a1b3d8', hz, 0.45), pal.farInk2, 1.6);
    // back ridge behind the town
    const fB = (x) => 238 - 92 * gs(x, 60, 230) - 66 * gs(x, 430, 160) - 36 * gs(x, 1000, 170) - 92 * gs(x, 1260, 170) + 116 * smooth(1330, 1620, x);
    hill(ctx, fB, -10, 1620, mix('#5e9e78', hz, 0.42), mix('#97cf98', hz, 0.38), pal.farInk2, 1.6, 7);
    // woodland on the back ridge
    for (let i = 0; i < 40; i++) {
      const x = rnd() * 1560;
      farTree(ctx, x, fB(x) + 10 + rnd() * 30, 5 + rnd() * 3, mix('#3f8a5c', hz, 0.45), mix('#7fbf82', hz, 0.45), mix(INK, hz, 0.72), 0.9);
    }
    townRows(ctx, fB, -10, 1560, {
      rows: 3, first: 18, gap: 16, s: 0.62, tree: 0.25,
      walls: [mix('#ffffff', hz, 0.35), mix('#f3e4c4', hz, 0.35), mix('#e8eef4', hz, 0.35)],
      roof: mix('#6d7690', hz, 0.45), win: mix('#4a5876', hz, 0.45),
      treeCol: mix('#3f8a5c', hz, 0.4), treeHi: mix('#7fbf82', hz, 0.4), outline: mix(INK, hz, 0.72), lw: 0.9,
    }, rnd);

    bayWater(ctx, st, pal, rnd);

    // Kerrera — low green island across the bay
    const fK = (x) => 336 - 12 * gs(x, 1700, 50) - 20 * gs(x, 1810, 70) - 12 * gs(x, 1920, 60);
    island(ctx, fK, 1640, 1990, 352, mix('#5aa86a', hz, 0.34), mix('#98d28e', hz, 0.3), pal.farInk2, 1.5, 40);
    farHouse(ctx, 1760, 334, 14, 8, mix('#ffffff', hz, 0.2), mix('#6d7690', hz, 0.3), mix('#4a5876', hz, 0.3), pal.farInk2, 0.9, rnd);
    for (let i = 0; i < 6; i++) farTree(ctx, 1690 + i * 38 + rnd() * 10, 338 - rnd() * 4, 4, mix('#3f8a5c', hz, 0.35), mix('#7fbf82', hz, 0.35), mix(INK, hz, 0.7), 0.8);
    // distant yachts
    for (const bx of [1612, 1880]) {
      poly(ctx, [bx, HZ - 1, bx + 4, HZ - 14, bx + 8, HZ - 1]); fillStroke(ctx, '#ffffff', 0.8, pal.farInk2);
    }

    // the town hill (Battery Hill) with McCaig's Tower
    const fT = (x) => 262 - 76 * gs(x, 720, 165) - 16 * gs(x, 300, 160) - 22 * gs(x, 1170, 150) + 118 * smooth(1330, 1600, x);
    const xEnd = 1596;
    const landPath = () => {
      ctx.beginPath();
      ctx.moveTo(-10, FAR[1] + 10);
      for (let x = -10; x < xEnd; x += 5) ctx.lineTo(x, fT(x));
      ctx.lineTo(xEnd, fT(xEnd));
      ctx.quadraticCurveTo(1540, 392, 1430, 438);
      ctx.lineTo(1430, FAR[1] + 10);
      ctx.closePath();
    };
    const tBase = mix('#62b56b', hz, 0.16), tLight = mix('#a5e08f', hz, 0.12);
    rimFill(ctx, landPath, tBase, tLight, 0, 8);
    // shoreline sand
    ctx.beginPath(); ctx.moveTo(xEnd + 4, fT(xEnd) + 1); ctx.quadraticCurveTo(1540, 394, 1430, 441);
    stroke(ctx, 4, mix('#e9d7a8', hz, 0.2));
    fnLine(ctx, fT, -10, xEnd, 5); stroke(ctx, 2, pal.farInk);

    // distillery chimney (behind houses)
    distilleryChimney(ctx, 1168, 150, 330, pal);

    // houses on the hill
    const wallsT = ['#ffffff', '#f7ecd2', '#fbd9d3', '#d9e9f6', '#fbefb0', '#dcf1df', '#ffffff'].map((c) => mix(c, hz, 0.14));
    townRows(ctx, fT, -10, 1600, {
      rows: 6, first: 14, gap: 21, s: 0.95, tree: 0.2,
      walls: wallsT, roof: mix('#687190', hz, 0.16), win: mix('#3d4a6e', hz, 0.16),
      treeCol: mix('#3d9257', hz, 0.15), treeHi: mix('#72c06f', hz, 0.15), outline: pal.farInk, lw: 1.2,
      skip: (x, yb, r) => (Math.abs(x - 720) < 150 && r < 2) || x > 1440 + (yb - 330) * 2,
    }, rnd);
    // shore houses along the curve of the bay
    for (let i = 0; i < 6; i++) {
      const x = 1450 + i * 24;
      const yb = 432 - (x - 1430) * 0.42;
      if (yb < fT(x) + 6) continue;
      farHouse(ctx, x, yb, 20, 15, wallsT[i % wallsT.length], mix('#687190', hz, 0.16), mix('#3d4a6e', hz, 0.16), pal.farInk, 1.2, rnd);
    }

    // trees around the tower, then the tower itself, then trees in front of its base
    const tc = mix('#3a8d55', hz, 0.12), th = mix('#6fbe6c', hz, 0.12);
    for (const p of [[606, 0], [632, -6], [812, -4], [838, 2], [586, 10], [860, 12]]) farTree(ctx, p[0], fT(p[0]) + 10 + p[1], 11, tc, th, pal.farInk, 1.1);
    mccaig(ctx, 720, 190, pal, st.skyBottom);
    for (let x = 606; x <= 840; x += 22) farTree(ctx, x + rnd() * 6, 206 + rnd() * 4, 9 + rnd() * 3, tc, th, pal.farInk, 1.1);
  }

  function renderFarLargs(ctx, st, pal, rnd) {
    const hz = pal.haze;
    // Arran — jagged blue mountains
    const pts = [[-40, 330], [-5, 296], [30, 268], [58, 280], [96, 238], [124, 258], [150, 246], [178, 270], [214, 224], [244, 252], [280, 262], [312, 246], [344, 254], [384, 280], [420, 288], [470, 302], [530, 322], [590, 336], [660, 350]];
    const fA = (x) => {
      for (let i = 1; i < pts.length; i++) {
        if (x <= pts[i][0]) { const a = pts[i - 1], b = pts[i]; return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]); }
      }
      return HZ + 4;
    };
    mountain(ctx, fA, -40, 660, mix('#7581b9', hz, 0.48), mix('#aab3dc', hz, 0.42), pal.farInk2, 1.6);
    // Largs hills behind the town
    const fB = (x) => 236 - 64 * gs(x, 730, 200) - 104 * gs(x, 1160, 260) - 92 * gs(x, 1650, 240) - 50 * gs(x, 1980, 140) + 112 * smooth(640, 410, x);
    hill(ctx, fB, 380, 1930, mix('#5e9e78', hz, 0.38), mix('#9bd29a', hz, 0.34), pal.farInk2, 1.6, 7);
    for (let i = 0; i < 46; i++) {
      const x = 460 + rnd() * 1460;
      farTree(ctx, x, fB(x) + 10 + rnd() * 34, 5 + rnd() * 3, mix('#3f8a5c', hz, 0.42), mix('#7fbf82', hz, 0.42), mix(INK, hz, 0.72), 0.9);
    }
    // hedgerow field lines
    ctx.save();
    ctx.globalAlpha = 0.35;
    for (let k = 0; k < 4; k++) {
      fnLine(ctx, (x) => fB(x) + 30 + k * 18 + Math.sin(x * 0.01 + k) * 6, 560 + k * 60, 1920, 8);
      stroke(ctx, 1.6, mix('#3f7d55', hz, 0.4));
    }
    ctx.restore();
    townRows(ctx, fB, 520, 1930, {
      rows: 3, first: 22, gap: 16, s: 0.62, tree: 0.3,
      walls: [mix('#ffffff', hz, 0.35), mix('#f3e4c4', hz, 0.35), mix('#e8eef4', hz, 0.35)],
      roof: mix('#6d7690', hz, 0.45), win: mix('#4a5876', hz, 0.45),
      treeCol: mix('#3f8a5c', hz, 0.4), treeHi: mix('#7fbf82', hz, 0.4), outline: mix(INK, hz, 0.72), lw: 0.9,
    }, rnd);

    bayWater(ctx, st, pal, rnd);

    // Great Cumbrae — long low island
    const fC = (x) => 334 - 14 * gs(x, 120, 120) - 9 * gs(x, 300, 90) - 4 * gs(x, 420, 60);
    island(ctx, fC, -60, 500, 352, mix('#5aa86a', hz, 0.34), mix('#9ad48f', hz, 0.3), pal.farInk2, 1.5, 70);
    for (let i = 0; i < 5; i++) farHouse(ctx, 40 + i * 13, 344, 9, 6, mix('#ffffff', hz, 0.25), mix('#6d7690', hz, 0.35), mix('#4a5876', hz, 0.35), pal.farInk2, 0.8, rnd);
    for (let i = 0; i < 8; i++) farTree(ctx, 130 + i * 40 + rnd() * 10, 336 - rnd() * 5, 3.5, mix('#3f8a5c', hz, 0.35), mix('#7fbf82', hz, 0.35), mix(INK, hz, 0.7), 0.7);
    for (const bx of [236, 410]) {
      poly(ctx, [bx, HZ + 4, bx + 4, HZ - 9, bx + 8, HZ + 4]); fillStroke(ctx, '#ffffff', 0.8, pal.farInk2);
    }

    // town hill
    const fT = (x) => 270 - 30 * gs(x, 900, 220) - 40 * gs(x, 1400, 210) - 26 * gs(x, 1820, 200) + 104 * smooth(650, 480, x);
    const tBase = mix('#62b56b', hz, 0.16), tLight = mix('#a5e08f', hz, 0.12);
    hill(ctx, fT, 470, 1930, tBase, tLight, pal.farInk, 2, 8);

    // grassy point with the Pencil
    const pointPath = () => {
      ctx.beginPath();
      ctx.moveTo(500, 372);
      ctx.bezierCurveTo(440, 376, 360, 384, 318, 396);
      ctx.bezierCurveTo(296, 402, 300, 410, 326, 412);
      ctx.bezierCurveTo(380, 416, 450, 418, 500, 424);
      ctx.closePath();
    };
    ctx.save(); ctx.globalAlpha = 0.18; ctx.fillStyle = '#1f5f5a'; ell(ctx, 400, 418, 110, 6); ctx.fill(); ctx.restore();
    rimFill(ctx, pointPath, mix('#6cc06a', hz, 0.1), mix('#b2e58f', hz, 0.08), 0, 5);
    ctx.save(); pointPath(); ctx.clip();
    ctx.fillStyle = mix('#e4d3a4', hz, 0.1);
    ctx.beginPath(); ctx.moveTo(290, 409); ctx.bezierCurveTo(330, 414, 430, 414, 510, 420); ctx.lineTo(510, 430); ctx.lineTo(290, 430); ctx.fill();
    ctx.restore();
    pointPath(); stroke(ctx, 2, pal.farInk);
    farTree(ctx, 420, 386, 8, mix('#3a8d55', hz, 0.1), mix('#6fbe6c', hz, 0.1), pal.farInk, 1.1);
    farTree(ctx, 446, 384, 10, mix('#3a8d55', hz, 0.1), mix('#6fbe6c', hz, 0.1), pal.farInk, 1.1);
    pencil(ctx, 364, 400, pal);

    church(ctx, 1076, 330, pal);
    const wallsT = ['#ffffff', '#f7ecd2', '#fbd9d3', '#d9e9f6', '#fbefb0', '#dcf1df', '#ffffff'].map((c) => mix(c, hz, 0.14));
    townRows(ctx, fT, 470, 1930, {
      rows: 6, first: 14, gap: 21, s: 0.95, tree: 0.22,
      walls: wallsT, roof: mix('#687190', hz, 0.16), win: mix('#3d4a6e', hz, 0.16),
      treeCol: mix('#3d9257', hz, 0.15), treeHi: mix('#72c06f', hz, 0.15), outline: pal.farInk, lw: 1.2,
      skip: (x) => x < 540 || Math.abs(x - 1076) < 22,
    }, rnd);
  }

  function renderFarGeneric(ctx, st, pal, rnd) {
    const hz = pal.haze;
    const fB = (x) => 230 - 60 * gs(x, 400, 300) - 70 * gs(x, 1200, 300) - 50 * gs(x, 1700, 220);
    hill(ctx, fB, -10, 1930, mix('#5e9e78', hz, 0.4), mix('#97cf98', hz, 0.36), pal.farInk2, 1.6, 7);
    bayWater(ctx, st, pal, rnd);
    const fT = (x) => 268 - 30 * gs(x, 700, 300) - 30 * gs(x, 1400, 300);
    hill(ctx, fT, -10, 1930, mix('#62b56b', hz, 0.16), mix('#a5e08f', hz, 0.12), pal.farInk, 2, 8);
  }

  function renderFar(L, st, pal, rnd) {
    const ctx = L.ctx;
    if (st.landmark === 'mccaig') renderFarOban(ctx, st, pal, rnd);
    else if (st.landmark === 'pencil') renderFarLargs(ctx, st, pal, rnd);
    else renderFarGeneric(ctx, st, pal, rnd);
  }

  // =========================================================================
  // BOATS & FERRY SPRITES
  // =========================================================================
  function reflection(ctx, x0, x1, col, depth) {
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = col;
    for (let i = 0; i < 3; i++) {
      const y = 2 + i * depth / 3;
      const inset = (x1 - x0) * 0.08 * i;
      rr(ctx, x0 + inset, y, (x1 - x0) - inset * 2, depth / 3 - 1, 2);
      ctx.fill();
    }
    ctx.restore();
  }
  function waterline(ctx, x0, x1, lw) {
    ctx.beginPath();
    ctx.moveTo(x0, 0.5);
    for (let x = x0; x <= x1; x += 6) ctx.quadraticCurveTo(x + 3, 2.5, x + 6, 0.5);
    stroke(ctx, lw, 'rgba(255,255,255,0.85)');
  }

  // Moored yacht (bow to the right), anchored at its waterline centre.
  function yachtSprite(scale, s, hull, stripe, cover) {
    const L = 76 * s, mast = 96 * s;
    return makeSprite(scale, L + 30 * s, mast + 26 * s, L / 2 + 14 * s, mast + 8 * s, (ctx) => {
      const lw = 2.4;
      reflection(ctx, -L / 2, L / 2, shade(hull, -0.5), 12 * s);
      // mast & rigging
      line(ctx, -2 * s, -14 * s, -2 * s, -mast, 2.2, INK);
      ctx.beginPath(); ctx.moveTo(-2 * s, -mast); ctx.lineTo(L / 2 + 4 * s, -12 * s); ctx.moveTo(-2 * s, -mast); ctx.lineTo(-L / 2 + 4 * s, -12 * s);
      stroke(ctx, 1, rgba(INK, 0.6));
      // boom + furled sail cover
      rrFS(ctx, -L * 0.42, -26 * s, L * 0.44, 7 * s, 3.5 * s, cover, lw);
      // cabin
      rrFS(ctx, -L * 0.28, -22 * s, L * 0.46, 11 * s, 4 * s, '#f4f1ea', lw);
      rrFS(ctx, -L * 0.18, -19 * s, L * 0.1, 4 * s, 2, '#3a4f7a');
      rrFS(ctx, -L * 0.02, -19 * s, L * 0.1, 4 * s, 2, '#3a4f7a');
      // hull
      poly(ctx, [-L / 2, -13 * s, L / 2 + 6 * s, -15 * s, L / 2 - 4 * s, 0, -L / 2 + 6 * s, 0]);
      fillStroke(ctx, hull, lw);
      line(ctx, -L / 2 + 3 * s, -8 * s, L / 2 + 1 * s, -9 * s, 2.2 * s, stripe);
      // flag
      poly(ctx, [-L / 2 + 2, -13 * s, -L / 2 - 1, -26 * s, -L / 2 - 12 * s, -22 * s]);
      fillStroke(ctx, '#3a86ff', 1.2);
      waterline(ctx, -L / 2 + 6 * s, L / 2 - 4 * s, 1.6);
    });
  }

  function fishingBoatSprite(scale, s, hull, trim, cabinRoof, opts) {
    opts = opts || {};
    const L = 96 * s;
    const lw = opts.lw || 2.6;
    return makeSprite(scale, L + 40 * s, 110 * s, L / 2 + 20 * s, 84 * s, (ctx) => {
      if (opts.flip) ctx.scale(-1, 1);
      reflection(ctx, -L / 2, L / 2, shade(hull, -0.5), 16 * s);
      // mast with light
      line(ctx, 14 * s, -30 * s, 14 * s, -76 * s, 2.4, INK);
      line(ctx, 14 * s, -64 * s, 34 * s, -32 * s, 1.2, rgba(INK, 0.6));
      line(ctx, 14 * s, -64 * s, -L / 2 + 6 * s, -24 * s, 1.2, rgba(INK, 0.6));
      poly(ctx, [14 * s, -76 * s, 30 * s, -72 * s, 14 * s, -67 * s]); fillStroke(ctx, opts.flag || '#ffd23f', 1.4);
      // wheelhouse
      rrFS(ctx, -L * 0.3, -50 * s, L * 0.36, 30 * s, 4 * s, '#fbfaf5', lw);
      rrFS(ctx, -L * 0.34, -56 * s, L * 0.44, 8 * s, 3 * s, cabinRoof, lw);
      for (let i = 0; i < 2; i++) rrFS(ctx, -L * 0.26 + i * L * 0.15, -44 * s, L * 0.11, 10 * s, 2.5 * s, '#3a5a8a', 1.6);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillRect(-L * 0.24, -43 * s, 2 * s, 7 * s);
      // life ring on the wheelhouse
      if (s > 0.9) { circFS(ctx, L * 0.0, -34 * s, 6 * s, '#ff6b4a', 1.6); circFS(ctx, L * 0.0, -34 * s, 2.6 * s, '#fbfaf5', 1.2); }
      // hull
      const hp = () => {
        ctx.beginPath();
        ctx.moveTo(-L / 2, -26 * s);
        ctx.lineTo(L / 2 + 10 * s, -30 * s);
        ctx.quadraticCurveTo(L / 2 + 2 * s, -6 * s, L / 2 - 10 * s, 0);
        ctx.lineTo(-L / 2 + 10 * s, 0);
        ctx.quadraticCurveTo(-L / 2 - 2 * s, -8 * s, -L / 2, -26 * s);
        ctx.closePath();
      };
      hp(); ctx.fillStyle = hull; ctx.fill();
      ctx.save(); hp(); ctx.clip();
      ctx.fillStyle = trim; ctx.fillRect(-L, -31 * s, L * 2, 7 * s);
      ctx.fillStyle = shade(hull, -0.2); ctx.fillRect(-L, -9 * s, L * 2, 12 * s);
      ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(-L, -22 * s, L * 2, 2.5 * s);
      ctx.restore();
      hp(); stroke(ctx, lw);
      // tyre fenders
      for (let i = 0; i < 3; i++) { circFS(ctx, -L * 0.3 + i * L * 0.28, -18 * s, 4.5 * s, '#2f2b3a', 1.4); }
      // registration-style number (generic)
      if (opts.number) {
        ctx.save();
        if (opts.flip) ctx.scale(-1, 1);
        ctx.font = `700 ${Math.round(9 * s)}px ${SG.FONT}`;
        ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(opts.number, (opts.flip ? -1 : 1) * L * 0.34, -16 * s);
        ctx.restore();
      }
      waterline(ctx, -L / 2 + 10 * s, L / 2 - 10 * s, 1.8);
    });
  }

  function dinghySprite(scale, s, hull) {
    const L = 40 * s;
    return makeSprite(scale, L + 16, 26 * s + 10, L / 2 + 8, 16 * s + 4, (ctx) => {
      reflection(ctx, -L / 2, L / 2, shade(hull, -0.5), 8 * s);
      const hp = () => { ctx.beginPath(); ctx.moveTo(-L / 2, -10 * s); ctx.lineTo(L / 2 + 3 * s, -12 * s); ctx.quadraticCurveTo(L / 2, -2 * s, L / 2 - 6 * s, 0); ctx.lineTo(-L / 2 + 5 * s, 0); ctx.quadraticCurveTo(-L / 2, -3 * s, -L / 2, -10 * s); ctx.closePath(); };
      hp(); fillStroke(ctx, hull, 2.2);
      line(ctx, -L / 2 + 2, -7 * s, L / 2, -8.5 * s, 1.5 * s, '#ffffff');
      line(ctx, -L * 0.2, -11 * s, L * 0.25, -16 * s, 1.8, '#8a5a3c');
      waterline(ctx, -L / 2 + 5 * s, L / 2 - 6 * s, 1.4);
    });
  }

  // Ferry sprite. Anchor = bow tip at the waterline. Bow faces left when dir<0.
  function ferrySprite(scale, big, dir) {
    const L = big ? 560 : 340;
    const hullH = big ? 62 : 44;
    const pad = 24;
    const top = big ? 226 : 156;
    return makeSprite(scale, L + pad * 2, top + 40, dir < 0 ? pad : L + pad, top, (ctx) => {
      if (dir > 0) ctx.scale(-1, 1);   // draw bow-left, mirror for bow-right
      const lw = big ? 4 : 3.6;
      const hull = '#272636', boot = '#d8423f', white = '#f8f7f1', whiteShade = '#d9dbe4', win = '#2e4068';
      // reflection below the waterline
      reflection(ctx, 20, L - 10, '#10141f', 18);
      // ---- funnel (behind superstructure top)
      const fx = big ? L * 0.66 : L * 0.6, fw = big ? 50 : 34;
      const fTop = big ? -212 : -146, fBot = big ? -150 : -100;
      const funnel = () => poly(ctx, [fx, fBot, fx + 6, fTop, fx + fw + 12, fTop, fx + fw + 4, fBot]);
      funnel(); ctx.fillStyle = '#e2443c'; ctx.fill();
      ctx.save(); funnel(); ctx.clip();
      ctx.fillStyle = '#26232f'; ctx.fillRect(fx - 10, fTop - 2, fw + 40, big ? 16 : 12);
      ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(fx + 8, fTop, 5, fBot - fTop);
      ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.fillRect(fx + fw - 6, fTop, 20, fBot - fTop);
      ctx.restore();
      funnel(); stroke(ctx, lw);
      // ---- mast & radar
      const mx = big ? 150 : 92;
      line(ctx, mx, big ? -168 : -118, mx + 6, big ? -222 : -160, 3, INK);
      rrFS(ctx, mx - 10, big ? -206 : -148, 30, 5, 2.5, '#f8f7f1', 2.4);
      line(ctx, mx + 6, big ? -222 : -160, L - 40, big ? -150 : -100, 1.2, rgba(INK, 0.45));
      // ---- superstructure
      if (big) {
        // deck 1
        poly(ctx, [62, -60, 78, -118, L - 46, -118, L - 40, -60]); fillStroke(ctx, white, lw);
        // deck 2
        poly(ctx, [96, -118, 110, -152, L - 112, -152, L - 104, -118]); fillStroke(ctx, white, lw);
        // bridge
        poly(ctx, [90, -152, 98, -178, 230, -178, 236, -152]); fillStroke(ctx, white, lw);
        rrFS(ctx, 80, -158, 170, 7, 3, white, 3);
        // bridge windows
        for (let i = 0; i < 7; i++) {
          poly(ctx, [104 + i * 18, -173, 118 + i * 18, -173, 117 + i * 18, -161, 103 + i * 18, -161]);
          fillStroke(ctx, win, 1.6);
        }
        // window rows
        for (let i = 0; i < 20; i++) rrFS(ctx, 96 + i * 20.5, -106, 13, 13, 4, win, 1.6);
        for (let i = 0; i < 13; i++) rrFS(ctx, 126 + i * 23, -142, 14, 12, 4, win, 1.6);
        // window glints
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        for (let i = 0; i < 20; i += 2) ctx.fillRect(98 + i * 20.5, -104, 3, 8);
        // shading strips under deck overhangs
        ctx.fillStyle = whiteShade; ctx.fillRect(80, -121, L - 128, 3); ctx.fillRect(112, -155, L - 228, 3);
        // lifeboats
        for (const lx of [262, 348]) { rrFS(ctx, lx, -166, 58, 14, 7, '#ff8a3d', 2.6); rrFS(ctx, lx + 8, -170, 42, 5, 2.5, '#ffffff', 2); }
        // rails
        ctx.strokeStyle = rgba(INK, 0.5); ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(L - 104, -126); ctx.lineTo(L - 46, -126); ctx.moveTo(L - 112, -160); ctx.lineTo(L - 120, -160); ctx.stroke();
        for (let x = L - 100; x < L - 46; x += 8) { ctx.beginPath(); ctx.moveTo(x, -126); ctx.lineTo(x, -118); ctx.stroke(); }
      } else {
        poly(ctx, [48, -42, 62, -94, L - 96, -94, L - 80, -42]); fillStroke(ctx, white, lw);
        poly(ctx, [58, -94, 64, -116, 160, -116, 166, -94]); fillStroke(ctx, white, lw);
        rrFS(ctx, 50, -98, 124, 6, 3, white, 2.8);
        for (let i = 0; i < 5; i++) {
          poly(ctx, [72 + i * 17, -112, 85 + i * 17, -112, 84 + i * 17, -102, 71 + i * 17, -102]);
          fillStroke(ctx, win, 1.5);
        }
        for (let i = 0; i < 11; i++) rrFS(ctx, 74 + i * 15.5, -82, 10, 11, 3.5, win, 1.5);
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        for (let i = 0; i < 11; i += 2) ctx.fillRect(76 + i * 15.5, -80, 2.5, 7);
        rrFS(ctx, 186, -106, 44, 12, 6, '#ff8a3d', 2.4);
        // vehicle ramp at the stern (raised)
        poly(ctx, [L - 12, -44, L + 4, -78, L + 12, -74, L - 2, -44]); fillStroke(ctx, '#3b3a4c', 2.6);
      }
      // ---- hull
      const hp = () => {
        ctx.beginPath();
        ctx.moveTo(-6, -hullH - 6);
        ctx.lineTo(L * 0.45, -hullH);
        ctx.lineTo(L, -hullH + 4);
        ctx.lineTo(L - 4, 0);
        ctx.lineTo(L - 4, 12);
        ctx.lineTo(30, 12);
        ctx.quadraticCurveTo(10, 0, -6, -hullH - 6);
        ctx.closePath();
      };
      hp(); ctx.fillStyle = hull; ctx.fill();
      ctx.save(); hp(); ctx.clip();
      // white sheer line
      ctx.strokeStyle = '#f8f7f1'; ctx.lineWidth = big ? 4 : 3;
      ctx.beginPath(); ctx.moveTo(-10, -hullH + 2); ctx.lineTo(L * 0.45, -hullH + 8); ctx.lineTo(L + 10, -hullH + 11); ctx.stroke();
      // red boot topping
      ctx.fillStyle = boot; ctx.fillRect(-20, -9, L + 40, 14);
      // hull sheen
      ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(-20, -hullH, L + 40, hullH * 0.35);
      // bow visor seam + portholes
      ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(30, -hullH + 6); ctx.lineTo(40, -12); ctx.stroke();
      ctx.restore();
      hp(); stroke(ctx, lw);
      for (let i = 0; i < (big ? 6 : 3); i++) circFS(ctx, 64 + i * 26, -hullH * 0.55, big ? 4 : 3, '#4c5a7a', 1.4, '#14131c');
      // waterline foam
      ctx.save(); ctx.translate(0, 1); waterline(ctx, 16, L - 6, 2.2); ctx.restore();
    });
  }

  function foamSprite(scale) {
    return makeSprite(scale, 120, 30, 60, 15, (ctx) => {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      const blobs = [[-40, 2, 9], [-24, -1, 11], [-6, 2, 12], [14, 0, 11], [32, 3, 9], [46, 4, 6]];
      for (const b of blobs) { ell(ctx, b[0], b[1], b[2], b[2] * 0.45); ctx.fill(); }
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      for (let i = 0; i < 6; i++) { ell(ctx, -50 + i * 18, 9, 7, 2); ctx.fill(); }
    });
  }

  function sparkleSprite(scale, size) {
    const r = size;
    return makeSprite(scale, r * 2 + 4, r * 2 + 4, r + 2, r + 2, (ctx) => {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; circle(ctx, 0, 0, r); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(0, -r); ctx.quadraticCurveTo(0, 0, r, 0); ctx.quadraticCurveTo(0, 0, 0, r); ctx.quadraticCurveTo(0, 0, -r, 0); ctx.quadraticCurveTo(0, 0, 0, -r);
      ctx.fill();
    });
  }
  function dashSprite(scale) {
    return makeSprite(scale, 30, 8, 15, 4, (ctx) => {
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; rr(ctx, -14, -3, 28, 6, 3); ctx.fill();
      ctx.fillStyle = '#ffffff'; rr(ctx, -9, -1.3, 18, 2.6, 1.3); ctx.fill();
    });
  }
  function puffSprite(scale) {
    return makeSprite(scale, 64, 64, 32, 32, (ctx) => {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 30);
      g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.6, 'rgba(240,242,248,0.7)'); g.addColorStop(1, 'rgba(240,242,248,0)');
      ctx.fillStyle = g; circle(ctx, 0, 0, 30); ctx.fill();
    });
  }

  // =========================================================================
  // NEAR LAYER — shopfronts, quay, promenade, sea wall
  // =========================================================================

  // ---- small architectural pieces ----------------------------------------
  function ledge(ctx, x0, x1, y, trim, opts) {
    opts = opts || {};
    const ov = opts.over != null ? opts.over : 8;
    const h = opts.h || 12;
    // soft shadow on the wall below
    ctx.fillStyle = 'rgba(45,42,74,0.2)';
    ctx.fillRect(x0, y + h, x1 - x0, 9);
    // brackets (modillions)
    if (opts.brackets !== false) {
      const n = Math.max(2, Math.round((x1 - x0 - 16) / 26));
      for (let i = 0; i <= n; i++) {
        const bx = x0 + 10 + i * (x1 - x0 - 20) / n;
        rrFS(ctx, bx - 4, y + h - 2, 8, 9, 2, shade(trim, -0.08), 2.4);
      }
    }
    rrFS(ctx, x0 - ov, y, x1 - x0 + ov * 2, h, 3, trim, 4);
    // top highlight + under-lip shadow (the perch line)
    line(ctx, x0 - ov + 4, y + 3, x1 + ov - 4, y + 3, 2.2, 'rgba(255,255,255,0.75)');
    line(ctx, x0 - ov + 4, y + h - 3, x1 + ov - 4, y + h - 3, 2, rgba(INK, 0.18));
  }

  function chimney(ctx, cx, baseY, topY, w, col, pots) {
    rectFS(ctx, cx - w / 2, topY, w, baseY - topY, col, 3.6);
    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    ctx.fillRect(cx + w / 2 - 9, topY + 2, 7, baseY - topY - 2);
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillRect(cx - w / 2 + 3, topY + 2, 4, baseY - topY - 2);
    rrFS(ctx, cx - w / 2 - 4, topY - 7, w + 8, 9, 2.5, shade(col, -0.1), 3.6);
    for (let i = 0; i < pots; i++) {
      const px = cx - w / 2 + (i + 0.5) * w / pots;
      rrFS(ctx, px - 4.5, topY - 21, 9, 15, 2, '#e9804f', 3);
      rrFS(ctx, px - 6, topY - 24, 12, 5, 2, '#cf6236', 2.6);
    }
    return { x: cx, y: topY - 26 };
  }

  function slateRoof(ctx, x0, x1, ry, rh, inset, pal) {
    const xa = x0 - 5, xb = x1 + 5, top = ry - rh;
    const path = () => { poly(ctx, [xa, ry + 2, xa + inset, top, xb - inset, top, xb, ry + 2]); };
    path(); ctx.fillStyle = pal.slate; ctx.fill();
    ctx.save(); path(); ctx.clip();
    const gr = ctx.createLinearGradient(0, top, 0, ry);
    gr.addColorStop(0, 'rgba(255,255,255,0.22)'); gr.addColorStop(1, 'rgba(0,0,0,0.1)');
    ctx.fillStyle = gr; ctx.fillRect(xa, top, xb - xa, rh + 2);
    ctx.strokeStyle = pal.slateDark; ctx.lineWidth = 1.6; ctx.globalAlpha = 0.6;
    let row = 0;
    for (let y = ry - 9; y > top + 3; y -= 9, row++) {
      ctx.beginPath(); ctx.moveTo(xa, y); ctx.lineTo(xb, y); ctx.stroke();
      ctx.globalAlpha = 0.28;
      for (let x = xa + (row % 2) * 9; x < xb; x += 18) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 9); ctx.stroke(); }
      ctx.globalAlpha = 0.6;
    }
    ctx.globalAlpha = 1;
    // a few lighter slates
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    for (let i = 0; i < (xb - xa) / 30; i++) {
      const x = xa + ((i * 53) % (xb - xa)), y = top + 4 + ((i * 37) % Math.max(10, rh - 12));
      ctx.fillRect(x, y - (y - ry) % 9, 17, 8);
    }
    ctx.restore();
    path(); stroke(ctx, 4);
    rrFS(ctx, xa + inset - 4, top - 5, (xb - inset) - (xa + inset) + 8, 8, 3.5, pal.slateDark, 3.4);
    line(ctx, xa + inset, top - 2.5, xb - inset, top - 2.5, 1.6, 'rgba(255,255,255,0.35)');
  }

  function dormer(ctx, cx, baseY, w, h, wall, trim, pal) {
    const x0 = cx - w / 2;
    rectFS(ctx, x0, baseY - h, w, h, wall, 3.4);
    sash(ctx, x0 + 5, baseY - h + 5, w - 10, h - 9, trim, { lintel: false, sill: false });
    const rh = w * 0.42;
    poly(ctx, [x0 - 7, baseY - h + 2, cx, baseY - h - rh, x0 + w + 7, baseY - h + 2]);
    fillStroke(ctx, pal.slate, 3.4);
    poly(ctx, [x0 - 2, baseY - h, cx, baseY - h - rh + 6, x0 + w + 2, baseY - h], false);
    stroke(ctx, 2.6, trim);
  }

  function glass(ctx, x, y, w, h) {
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, '#2d4372'); g.addColorStop(1, '#5a86b8');
    return g;
  }

  // Sash window: glass rect with frame, bars, lintel, sill.
  function sash(ctx, x, y, w, h, trim, o) {
    o = o || {};
    const arched = o.arched;
    if (o.lintel !== false && !arched) rrFS(ctx, x - 6, y - 8, w + 12, 8, 2, o.lintelCol || trim, 3);
    const shape = () => (arched ? archPath(ctx, x, y, w, h) : (ctx.beginPath(), ctx.rect(x, y, w, h)));
    shape(); fillStroke(ctx, trim, 3);
    const gx = x + 4, gy = y + 4, gw = w - 8, gh = h - 8;
    const gshape = () => (arched ? archPath(ctx, gx, gy, gw, gh) : (ctx.beginPath(), ctx.rect(gx, gy, gw, gh)));
    gshape(); ctx.fillStyle = o.lit ? o.lit : glass(ctx, gx, gy, gw, gh); ctx.fill();
    ctx.save(); gshape(); ctx.clip();
    if (o.curtain) {
      ctx.fillStyle = o.curtain;
      poly(ctx, [gx, gy, gx + gw * 0.32, gy, gx + gw * 0.1, gy + gh * 0.55, gx, gy + gh * 0.6]); ctx.fill();
      poly(ctx, [gx + gw, gy, gx + gw * 0.68, gy, gx + gw * 0.9, gy + gh * 0.55, gx + gw, gy + gh * 0.6]); ctx.fill();
    }
    if (!o.lit) {
      ctx.fillStyle = 'rgba(255,255,255,0.32)';
      poly(ctx, [gx + gw * 0.15, gy + gh, gx + gw * 0.55, gy, gx + gw * 0.75, gy, gx + gw * 0.35, gy + gh]); ctx.fill();
    }
    ctx.restore();
    // glazing bars
    ctx.strokeStyle = trim; ctx.lineWidth = 3;
    const midY = arched ? gy + gh * 0.58 : gy + gh * 0.5;
    ctx.beginPath(); ctx.moveTo(gx, midY); ctx.lineTo(gx + gw, midY);
    if (o.bars !== false) { ctx.moveTo(gx + gw / 2, gy + (arched ? 0 : 0)); ctx.lineTo(gx + gw / 2, gy + gh); }
    ctx.stroke();
    gshape(); stroke(ctx, 2, rgba(INK, 0.55));
    if (o.sill !== false) rrFS(ctx, x - 7, y + h - 1, w + 14, 7, 2, o.sillCol || trim, 3);
    if (o.box) flowerBox(ctx, x - 4, y + h + 6, w + 8, o.box, o.rnd);
  }

  function flowerBox(ctx, x, y, w, col, rnd) {
    rnd = rnd || Math.random;
    // leaves
    ctx.beginPath();
    for (let i = 0; i <= Math.floor(w / 7); i++) {
      const lx = x + 3 + i * (w - 6) / Math.floor(w / 7);
      ctx.moveTo(lx + 5.5, y - 1); ctx.arc(lx, y - 1, 5.5, 0, TAU);
    }
    ctx.lineWidth = 4.4; ctx.strokeStyle = INK; ctx.stroke();
    ctx.fillStyle = '#4fae4f'; ctx.fill();
    const flowers = ['#ff5d8f', '#ffd23f', '#ffffff', '#ff7b47', '#c477ff', '#ff3f5f'];
    for (let i = 0; i < Math.floor(w / 9); i++) {
      const fx = x + 5 + i * (w - 10) / Math.max(1, Math.floor(w / 9) - 1), fy = y - 4 - rnd() * 4;
      circFS(ctx, fx, fy, 3.4, flowers[Math.floor(rnd() * flowers.length)]);
      circFS(ctx, fx, fy, 1.2, '#fff1a8');
    }
    rrFS(ctx, x, y, w, 10, 2, col, 3);
    line(ctx, x + 3, y + 3, x + w - 3, y + 3, 1.6, 'rgba(255,255,255,0.35)');
  }

  function door(ctx, x, w, top, col, trim, o) {
    o = o || {};
    const bot = FACADE_Y - 4;
    const fr = o.frame != null ? o.frame : 6;
    rrFS(ctx, x - fr, top - fr, w + fr * 2, bot - top + fr, 3, trim, 3.4);
    // fanlight
    if (o.fan !== false) {
      const fh = 14;
      ctx.beginPath(); ctx.rect(x, top, w, fh);
      ctx.fillStyle = o.lit ? '#ffd98a' : glass(ctx, x, top, w, fh); ctx.fill(); stroke(ctx, 2.4);
      ctx.strokeStyle = trim; ctx.lineWidth = 2;
      for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(x + w / 2, top + fh); ctx.lineTo(x + i * w / 4, top); ctx.stroke(); }
      top += fh + 3;
    }
    rectFS(ctx, x, top, w, bot - top, col, 3.4);
    const m = w < 36 ? 5 : 6;
    const pw = w - m * 2;
    // upper glazed panel
    rrFS(ctx, x + m, top + 6, pw, (bot - top) * 0.42, 3, o.lit ? '#ffd98a' : glass(ctx, x, top, pw, 30), 2.4);
    if (!o.lit) { ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fillRect(x + m + 3, top + 9, 3.5, (bot - top) * 0.36); }
    // lower panels
    const ph = (bot - top) * 0.42;
    if (w >= 36) {
      rrFS(ctx, x + m, bot - ph - 6, pw / 2 - 2, ph, 2, shade(col, -0.12), 2);
      rrFS(ctx, x + m + 2 + pw / 2, bot - ph - 6, pw / 2 - 2, ph, 2, shade(col, -0.12), 2);
    } else {
      rrFS(ctx, x + m, bot - ph - 6, pw, ph, 2, shade(col, -0.12), 2);
    }
    circFS(ctx, x + w - 6, top + (bot - top) * 0.52, 3, '#f2c14e', 1.8);
    rectFS(ctx, x - fr - 2, bot, w + fr * 2 + 4, 4, '#d5c7b0', 2.4);
  }

  function pilaster(ctx, x, w, y0, y1, col) {
    rectFS(ctx, x, y0, w, y1 - y0, col, 3.4);
    line(ctx, x + w * 0.5, y0 + 8, x + w * 0.5, y1 - 8, 1.6, rgba(INK, 0.18));
    rrFS(ctx, x - 3, y1 - 14, w + 6, 14, 2, shade(col, -0.08), 3);
  }

  // Fascia sign with scroll brackets at both ends.
  function fascia(ctx, x0, x1, y0, y1, board, trim, label, sub, txt, subCol, o) {
    o = o || {};
    // brackets / consoles
    for (const bx of [x0, x1 - 16]) {
      rrFS(ctx, bx, y0 - 4, 16, y1 - y0 + 18, 4, o.console || trim, 3.4);
      circFS(ctx, bx + 8, y1 + 4, 4.5, shade(o.console || trim, -0.12), 2.4);
      line(ctx, bx + 8, y0 + 4, bx + 8, y1 - 6, 1.6, rgba(INK, 0.25));
    }
    const bx0 = x0 + 14, bw = x1 - x0 - 28;
    rrFS(ctx, bx0, y0, bw, y1 - y0, 6, board, 4.5);
    rr(ctx, bx0 + 5, y0 + 5, bw - 10, y1 - y0 - 10, 4);
    stroke(ctx, 1.8, rgba(o.inner || trim, 0.55));
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(bx0 + 6, y0 + 6, bw - 12, (y1 - y0) * 0.3);
    const tw = bw - 26;
    const hasSub = !!sub;
    const labH = hasSub ? (y1 - y0) * 0.5 : (y1 - y0) * 0.62;
    const size = fitFont(ctx, label, SG.FONT_TITLE, 400, 40, tw, labH, 1.5);
    const cyL = hasSub ? y0 + (y1 - y0) * 0.4 : (y0 + y1) / 2 + 1;
    inkText(ctx, label, (x0 + x1) / 2, cyL, txt, Math.max(3, size * 0.17), INK, { col: rgba(INK, 0.55), dx: 0, dy: 2.5 });
    setSpacing(ctx, 0);
    if (hasSub) {
      fitFont(ctx, sub, SG.FONT, 700, 13, tw * 0.8, (y1 - y0) * 0.24, 2.2);
      inkText(ctx, sub, (x0 + x1) / 2, y0 + (y1 - y0) * 0.79, subCol, 0);
      setSpacing(ctx, 0);
    }
  }

  // Striped awning, attached to the wall at y0, scalloped valance ending at y1.
  function awning(ctx, cx, halfTop, halfBot, y0, y1, colA, colB) {
    const vy = y1 - 8;            // valance top
    const n = Math.max(6, Math.round(halfBot * 2 / 22));
    // soft shadow cast on the wall / hatch below
    const shg = ctx.createLinearGradient(0, y1 - 4, 0, y1 + 14);
    shg.addColorStop(0, 'rgba(45,42,74,0.28)'); shg.addColorStop(1, 'rgba(45,42,74,0)');
    ctx.fillStyle = shg; ctx.fillRect(cx - halfBot + 2, y1 - 4, halfBot * 2 - 4, 18);
    const outline = () => {
      ctx.beginPath();
      ctx.moveTo(cx - halfTop, y0);
      ctx.lineTo(cx + halfTop, y0);
      ctx.lineTo(cx + halfBot, vy);
      const sw = halfBot * 2 / n;
      for (let i = n - 1; i >= 0; i--) {
        const sx = cx - halfBot + i * sw;
        ctx.arc(sx + sw / 2, vy, sw / 2, 0, Math.PI, false);
      }
      ctx.lineTo(cx - halfTop, y0);
      ctx.closePath();
    };
    outline(); ctx.fillStyle = colB; ctx.fill();
    ctx.save(); outline(); ctx.clip();
    ctx.fillStyle = colA;
    for (let i = 0; i < n; i += 2) {
      const tx0 = cx - halfTop + i * halfTop * 2 / n, tx1 = cx - halfTop + (i + 1) * halfTop * 2 / n;
      const bx0 = cx - halfBot + i * halfBot * 2 / n, bx1 = cx - halfBot + (i + 1) * halfBot * 2 / n;
      poly(ctx, [tx0, y0 - 2, tx1, y0 - 2, bx1, y1 + 10, bx0, y1 + 10]); ctx.fill();
    }
    // shading: darker at the wall, light band at the fold
    const g = ctx.createLinearGradient(0, y0, 0, vy);
    g.addColorStop(0, 'rgba(45,42,74,0.25)'); g.addColorStop(0.5, 'rgba(45,42,74,0)'); g.addColorStop(1, 'rgba(255,255,255,0.12)');
    ctx.fillStyle = g; ctx.fillRect(cx - halfBot - 4, y0, halfBot * 2 + 8, vy - y0);
    ctx.fillStyle = 'rgba(45,42,74,0.12)';
    ctx.fillRect(cx - halfBot - 4, vy, halfBot * 2 + 8, 12);
    ctx.restore();
    line(ctx, cx - halfBot + 3, vy, cx + halfBot - 3, vy, 2.4, rgba(INK, 0.6));
    outline(); stroke(ctx, 4);
  }

  // ---- hatch interiors ----------------------------------------------------
  function chalkLines(ctx, x, y, w, rows, rnd, col) {
    ctx.strokeStyle = col || 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1.5;
    for (let i = 0; i < rows; i++) {
      const len = w * (0.5 + rnd() * 0.45);
      ctx.beginPath(); ctx.moveTo(x, y + i * 5); ctx.lineTo(x + len, y + i * 5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + w - 5, y + i * 5); ctx.lineTo(x + w, y + i * 5); ctx.stroke();
    }
  }
  function menuBoard(ctx, x, y, w, h, board, frame, rnd, icon) {
    rrFS(ctx, x, y, w, h, 3, board, 2.6);
    rr(ctx, x + 2.5, y + 2.5, w - 5, h - 5, 2); stroke(ctx, 1.4, frame);
    if (icon) icon(x + w / 2, y + 8);
    chalkLines(ctx, x + 6, y + (icon ? 16 : 7), w - 12, Math.floor((h - (icon ? 19 : 9)) / 5), rnd);
  }
  function fishIcon(ctx, x, y, s, col) {
    ctx.beginPath();
    ctx.ellipse(x - 2 * s, y, 6 * s, 3.3 * s, 0, 0, TAU);
    ctx.moveTo(x + 3 * s, y); ctx.lineTo(x + 8 * s, y - 3.5 * s); ctx.lineTo(x + 8 * s, y + 3.5 * s); ctx.closePath();
    ctx.fillStyle = col; ctx.fill();
  }
  function coneIcon(ctx, x, y, s, scoop) {
    poly(ctx, [x - 4 * s, y, x + 4 * s, y, x, y + 9 * s]); ctx.fillStyle = '#e8b464'; ctx.fill();
    circFS(ctx, x, y - 1.5 * s, 4.3 * s, scoop);
  }

  function hatchInterior(ctx, s, rnd) {
    const cx = s.hatchX, x0 = cx - HATCH.halfW, y0 = HATCH.top, w = HATCH.halfW * 2, y1 = HATCH.bottom;
    const h = y1 - y0;
    const type = s.type;
    const wallCols = {
      chippy: ['#f4f2ea', '#dfe9ec'], bakery: ['#fdf0d8', '#f3dcc0'], icecream: ['#fff2f6', '#ffd6e4'],
      cafe: ['#f2f8ef', '#d6ecd9'], seafood: ['#e2b67c', '#c9955c'],
    };
    const wc = wallCols[type] || ['#f6efe2', '#e6d6bf'];
    ctx.save();
    ctx.beginPath(); ctx.rect(x0, y0, w, h); ctx.clip();
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, wc[0]); g.addColorStop(0.42, wc[1]);
    g.addColorStop(0.52, '#8a6352'); g.addColorStop(1, '#4b3540');
    ctx.fillStyle = g; ctx.fillRect(x0, y0, w, h);
    const midY = y0 + h * 0.5;    // keep detail above here
    // wall finish
    if (type === 'chippy' || type === 'cafe' || type === 'default') {
      ctx.strokeStyle = 'rgba(80,90,110,0.13)'; ctx.lineWidth = 1;
      for (let y = y0 + 9; y < midY; y += 9) { ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + w, y); ctx.stroke(); }
      for (let x = x0 + 9; x < x0 + w; x += 9) { ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, midY - 4); ctx.stroke(); }
      ctx.fillStyle = type === 'chippy' ? '#5ab8de' : '#79c79a';
      ctx.fillRect(x0, midY - 9, w, 4);
    } else if (type === 'icecream') {
      ctx.fillStyle = 'rgba(255,140,180,0.35)';
      for (let x = x0; x < x0 + w; x += 16) ctx.fillRect(x, y0, 8, midY - y0 - 4);
    } else if (type === 'seafood') {
      ctx.strokeStyle = 'rgba(90,50,20,0.3)'; ctx.lineWidth = 1.5;
      for (let x = x0 + 12; x < x0 + w; x += 12) { ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, midY); ctx.stroke(); }
    } else if (type === 'bakery') {
      ctx.fillStyle = 'rgba(232,140,120,0.22)';
      for (let x = x0; x < x0 + w; x += 14) ctx.fillRect(x, y0, 7, midY - y0 - 4);
    }
    // warm ceiling light
    const lg = ctx.createRadialGradient(cx, y0 - 6, 4, cx, y0 - 6, 110);
    lg.addColorStop(0, 'rgba(255,236,170,0.55)'); lg.addColorStop(1, 'rgba(255,236,170,0)');
    ctx.fillStyle = lg; ctx.fillRect(x0, y0, w, h);

    const L = x0 + 6, R = x0 + w - 6;
    if (type === 'chippy') {
      menuBoard(ctx, L, y0 + 8, 40, 30, '#26324d', '#f2c14e', rnd, (ix, iy) => fishIcon(ctx, ix, iy, 0.9, '#f2c14e'));
      menuBoard(ctx, R - 40, y0 + 8, 40, 30, '#26324d', '#f2c14e', rnd, (ix, iy) => { rrFS(ctx, ix - 4, iy - 3, 8, 8, 1.5, '#ff5d5d'); ctx.fillStyle = '#ffd23f'; ctx.fillRect(ix - 3, iy - 6, 1.6, 4); ctx.fillRect(ix, iy - 7, 1.6, 5); ctx.fillRect(ix + 2, iy - 6, 1.6, 4); });
      // stainless extraction hood
      poly(ctx, [cx - 30, y0, cx + 30, y0, cx + 40, y0 + 12, cx - 40, y0 + 12]); fillStroke(ctx, '#cfd8e0', 2.2);
      line(ctx, cx - 34, y0 + 6, cx + 34, y0 + 6, 1.4, 'rgba(255,255,255,0.8)');
      circFS(ctx, cx - 20, y0 + 14, 3, '#ffcf6b'); circFS(ctx, cx + 20, y0 + 14, 3, '#ffcf6b');
      // heated display with golden fish suppers
      rrFS(ctx, cx - 30, y0 + 24, 60, 18, 3, 'rgba(255,190,90,0.5)', 2, rgba(INK, 0.6));
      for (let i = 0; i < 3; i++) fishIcon(ctx, cx - 18 + i * 17, y0 + 35, 0.95, '#e8a33c');
      line(ctx, cx - 27, y0 + 27, cx + 27, y0 + 27, 1.4, 'rgba(255,255,255,0.7)');
    } else if (type === 'bakery') {
      for (const sx of [L, R - 44]) {
        for (let k = 0; k < 2; k++) {
          const sy = y0 + 20 + k * 19;
          rectFS(ctx, sx, sy, 44, 3, '#a8703f', 1.4);
          for (let i = 0; i < 3; i++) {
            const ix = sx + 8 + i * 14;
            const kind = (i + k + (sx > cx ? 1 : 0)) % 3;
            if (kind === 0) { ell(ctx, ix, sy - 4, 6, 4); fillStroke(ctx, '#d79a52', 1.4); line(ctx, ix - 3, sy - 6, ix - 1, sy - 3, 1.2, '#f4d29a'); line(ctx, ix + 1, sy - 6, ix + 3, sy - 3, 1.2, '#f4d29a'); }
            else if (kind === 1) { circFS(ctx, ix, sy - 4, 4.5, '#f6c9d8', 1.4); circFS(ctx, ix, sy - 9, 1.8, '#e5395a'); }
            else { rrFS(ctx, ix - 5, sy - 8, 10, 8, 2, '#f7e2b8', 1.4); ctx.fillStyle = '#ff8fb1'; ctx.fillRect(ix - 5, sy - 8, 10, 3); }
          }
        }
      }
      menuBoard(ctx, cx - 22, y0 + 6, 44, 22, '#5b3a2a', '#ffd166', rnd);
    } else if (type === 'icecream') {
      rrFS(ctx, cx - 40, y0 + 5, 80, 24, 4, '#ffffff', 2.2);
      const scoops = ['#ff8fb1', '#a8e6cf', '#ffe08a', '#c7a2ff'];
      for (let i = 0; i < 4; i++) coneIcon(ctx, cx - 28 + i * 18.5, y0 + 13, 0.9, scoops[i]);
      for (const sx of [L, R - 30]) {
        rectFS(ctx, sx, y0 + 30, 30, 3, '#d88aa8', 1.4);
        for (let i = 0; i < 3; i++) rrFS(ctx, sx + 2 + i * 9.5, y0 + 21, 8, 9, 2, scoops[(i + (sx > cx ? 2 : 0)) % 4], 1.4);
        rectFS(ctx, sx, y0 + 12, 30, 3, '#d88aa8', 1.4);
        for (let i = 0; i < 4; i++) rrFS(ctx, sx + 2 + i * 7.2, y0 + 4, 5, 8, 2, ['#ffffff', '#ffd23f', '#ff5d8f', '#6fd3e8'][i], 1.2);
      }
    } else if (type === 'cafe') {
      // mini bunting
      ctx.fillStyle = '#ff8fb1';
      for (let i = 0; i < 9; i++) {
        ctx.fillStyle = ['#ff8fb1', '#ffd23f', '#6fd3e8'][i % 3];
        poly(ctx, [x0 + 6 + i * 16, y0 + 3, x0 + 18 + i * 16, y0 + 3, x0 + 12 + i * 16, y0 + 10]); ctx.fill();
      }
      menuBoard(ctx, L, y0 + 14, 40, 28, '#2f4a3a', '#ffffff', rnd, (ix, iy) => { rrFS(ctx, ix - 4, iy - 3, 7, 6, 2, '#ffffff'); circle(ctx, ix + 4, iy, 2.2); stroke(ctx, 1.2, '#ffffff'); });
      // tea urn
      const ux = R - 22;
      rrFS(ctx, ux - 13, y0 + 14, 26, 28, 5, '#d5dde4', 2.2);
      line(ctx, ux - 7, y0 + 18, ux - 7, y0 + 38, 2, 'rgba(255,255,255,0.85)');
      rrFS(ctx, ux - 9, y0 + 9, 18, 6, 3, '#bcc6cf', 2);
      circFS(ctx, ux, y0 + 8, 2.5, '#f2c14e', 1.4);
      rrFS(ctx, ux - 3, y0 + 40, 6, 5, 1.5, '#8f9aa5', 1.4);
      // cups shelf
      rectFS(ctx, cx - 26, y0 + 30, 52, 3, '#9a6a44', 1.4);
      for (let i = 0; i < 4; i++) { rrFS(ctx, cx - 22 + i * 12, y0 + 22, 8, 8, 2, ['#ffffff', '#ff8fb1', '#6fd3e8', '#ffd23f'][i], 1.4); }
    } else if (type === 'seafood') {
      // fishing net with floats draped across the top
      ctx.strokeStyle = 'rgba(60,40,30,0.5)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(x0, y0 + 4); ctx.quadraticCurveTo(cx, y0 + 26, x0 + w, y0 + 4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x0, y0 + 10); ctx.quadraticCurveTo(cx, y0 + 32, x0 + w, y0 + 10); ctx.stroke();
      for (let i = 0; i < 6; i++) {
        const fx = x0 + 14 + i * 24, fy = y0 + 4 + 22 * Math.sin(Math.PI * (fx - x0) / w) * 0.9;
        circFS(ctx, fx, fy, 3.6, i % 2 ? '#ff8a3d' : '#ffd23f', 1.4);
      }
      menuBoard(ctx, L, y0 + 14, 38, 28, '#1f3d4f', '#ffffff', rnd, (ix, iy) => fishIcon(ctx, ix, iy, 0.85, '#ff8a6b'));
      // lobster on a board
      rrFS(ctx, R - 38, y0 + 16, 38, 24, 3, '#f6e7cf', 2);
      ctx.fillStyle = '#e2473b';
      ell(ctx, R - 19, y0 + 29, 9, 4); ctx.fill();
      circle(ctx, R - 31, y0 + 25, 3.2); ctx.fill(); circle(ctx, R - 7, y0 + 25, 3.2); ctx.fill();
      poly(ctx, [R - 12, y0 + 29, R - 3, y0 + 33, R - 12, y0 + 33]); ctx.fill();
    } else {
      menuBoard(ctx, L, y0 + 8, 40, 30, '#2f3a4a', '#ffffff', rnd);
      menuBoard(ctx, R - 40, y0 + 8, 40, 30, '#2f3a4a', '#ffffff', rnd);
    }
    // awning shadow + side shading
    const sg = ctx.createLinearGradient(0, y0, 0, y0 + 18);
    sg.addColorStop(0, 'rgba(40,24,30,0.45)'); sg.addColorStop(1, 'rgba(40,24,30,0)');
    ctx.fillStyle = sg; ctx.fillRect(x0, y0, w, 18);
    const lgL = ctx.createLinearGradient(x0, 0, x0 + 14, 0);
    lgL.addColorStop(0, 'rgba(40,24,30,0.35)'); lgL.addColorStop(1, 'rgba(40,24,30,0)');
    ctx.fillStyle = lgL; ctx.fillRect(x0, y0, 14, h);
    const lgR = ctx.createLinearGradient(x0 + w, 0, x0 + w - 14, 0);
    lgR.addColorStop(0, 'rgba(40,24,30,0.35)'); lgR.addColorStop(1, 'rgba(40,24,30,0)');
    ctx.fillStyle = lgR; ctx.fillRect(x0 + w - 14, y0, 14, h);
    ctx.restore();
  }

  function hatchFrame(ctx, s, frameCol) {
    const cx = s.hatchX, x0 = cx - HATCH.halfW, y0 = HATCH.top, w = HATCH.halfW * 2, y1 = HATCH.bottom;
    // surround
    ctx.beginPath();
    ctx.rect(x0 - 8, y0 - 6, w + 16, y1 - y0 + 6);
    ctx.rect(x0, y0, w, y1 - y0);
    ctx.fillStyle = frameCol; ctx.fill('evenodd');
    ctx.beginPath(); ctx.rect(x0 - 8, y0 - 6, w + 16, y1 - y0 + 6); stroke(ctx, 3.6);
    ctx.beginPath(); ctx.rect(x0, y0, w, y1 - y0); stroke(ctx, 4.5);
    line(ctx, x0 - 4.5, y0 - 2, x0 - 4.5, y1 - 4, 1.6, 'rgba(255,255,255,0.45)');
  }

  function shopWindow(ctx, x, w, y0, y1, trim, type, rnd, lit) {
    rrFS(ctx, x - 4, y0 - 4, w + 8, y1 - y0 + 8, 3, trim, 3.4);
    ctx.beginPath(); ctx.rect(x, y0, w, y1 - y0);
    ctx.fillStyle = lit || glass(ctx, x, y0, w, y1 - y0); ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.rect(x, y0, w, y1 - y0); ctx.clip();
    // display shelf + goods
    const sy = y1 - 16;
    ctx.fillStyle = 'rgba(255,230,180,0.35)'; ctx.fillRect(x, y0, w, y1 - y0);
    rectFS(ctx, x, sy, w, 4, '#f5efe4', 1.4);
    const goods = {
      chippy: ['#e8a33c', '#ffd23f'], bakery: ['#d79a52', '#f6c9d8', '#f7e2b8'], icecream: ['#ff8fb1', '#a8e6cf', '#ffe08a'],
      cafe: ['#ffffff', '#ff8fb1', '#9a6a44'], seafood: ['#ff8a6b', '#f2c14e'],
    }[type] || ['#ffd23f', '#ff8fb1'];
    for (let i = 0; i < Math.floor(w / 12); i++) {
      const gx = x + 7 + i * 12, col = goods[i % goods.length];
      if (type === 'icecream') coneIcon(ctx, gx, sy - 12, 0.9, col);
      else if (type === 'cafe') { rrFS(ctx, gx - 4, sy - 8, 8, 8, 2, col, 1.4); }
      else { circFS(ctx, gx, sy - 5, 4.5, col, 1.4); }
    }
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    poly(ctx, [x + w * 0.2, y1, x + w * 0.7, y0, x + w * 0.95, y0, x + w * 0.45, y1]); ctx.fill();
    ctx.restore();
    ctx.beginPath(); ctx.rect(x, y0, w, y1 - y0); stroke(ctx, 2.6);
    rrFS(ctx, x - 6, y1 + 1, w + 12, 6, 2, trim, 3);
  }

  // ---- roofs ----------------------------------------------------------------
  function crowGable(ctx, x0, x1, ry, gh, col, trim, pal, rec) {
    const w = x1 - x0, cx = (x0 + x1) / 2;
    const steps = 4, topW = Math.max(40, w * 0.22);
    const sw = (w / 2 - topW / 2) / steps, sh = gh / (steps + 0.6);
    const pts = [x0, ry + 2];
    let x = x0, y = ry - sh * 0.6;
    pts.push(x, y);
    for (let i = 0; i < steps; i++) { x += sw; pts.push(x, y); y -= sh; pts.push(x, y); }
    pts.push(x1 - (x - x0), y);
    let xr = x1 - (x - x0);
    for (let i = 0; i < steps; i++) { pts.push(xr, y + sh); y += sh; xr += sw; pts.push(xr, y); }
    pts.push(x1, ry + 2);
    poly(ctx, pts);
    fillStroke(ctx, col, 4);
    // step copes
    let sx = x0, sy = ry - sh * 0.6;
    for (let i = 0; i <= steps; i++) {
      const wcap = i === steps ? topW : sw;
      rrFS(ctx, sx - 3, sy - 6, wcap + 6, 7, 2, trim, 3);
      rrFS(ctx, x1 - (sx - x0) - wcap - 3, sy - 6, wcap + 6, 7, 2, trim, 3);
      sx += sw; sy -= sh;
    }
    // gable window (round)
    circFS(ctx, cx, ry - gh * 0.44, 15, trim, 3.4);
    circle(ctx, cx, ry - gh * 0.44, 10.5); ctx.fillStyle = glass(ctx, cx, ry - gh * 0.44 - 10, 20, 20); ctx.fill(); stroke(ctx, 2, rgba(INK, 0.55));
    line(ctx, cx - 10, ry - gh * 0.44, cx + 10, ry - gh * 0.44, 2.4, trim);
    line(ctx, cx, ry - gh * 0.44 - 10, cx, ry - gh * 0.44 + 10, 2.4, trim);
    // chimney on the top step
    rec.chimneys.push(chimney(ctx, cx, ry - gh - 4, ry - gh - 30, 30, shade(col, -0.06), 2));
  }

  function dutchGable(ctx, x0, x1, ry, gh, col, trim, rec) {
    const cx = (x0 + x1) / 2, hw = Math.min(70, (x1 - x0) * 0.27);
    const shoulder = ry - gh * 0.38;
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(x0 + 18, ry + 2);
      ctx.quadraticCurveTo(x0 + 22, shoulder, cx - hw - 26, shoulder);
      ctx.quadraticCurveTo(cx - hw, shoulder, cx - hw, ry - gh * 0.62);
      ctx.lineTo(cx - hw, ry - gh + hw * 0.9);
      ctx.arc(cx, ry - gh + hw * 0.9, hw, Math.PI, 0);
      ctx.lineTo(cx + hw, ry - gh * 0.62);
      ctx.quadraticCurveTo(cx + hw, shoulder, cx + hw + 26, shoulder);
      ctx.quadraticCurveTo(x1 - 22, shoulder, x1 - 18, ry + 2);
      ctx.closePath();
    };
    path(); fillStroke(ctx, col, 4);
    // coping line just inside the edge
    ctx.save(); path(); ctx.clip();
    path(); ctx.lineWidth = 12; ctx.strokeStyle = trim; ctx.stroke();
    ctx.restore();
    path(); stroke(ctx, 4);
    // scallop shell / round window
    const wy = ry - gh + hw * 0.9 + 4;
    circFS(ctx, cx, wy, 20, trim, 3.4);
    circle(ctx, cx, wy, 14); ctx.fillStyle = glass(ctx, cx, wy - 14, 28, 28); ctx.fill(); stroke(ctx, 2, rgba(INK, 0.5));
    for (let a = 0; a < 4; a++) line(ctx, cx, wy, cx + Math.cos(a * Math.PI / 4 + Math.PI) * 14, wy + Math.sin(a * Math.PI / 4 + Math.PI) * 14, 2, trim);
    // finial: cute ice cream cone
    const fy = ry - gh - 2;
    poly(ctx, [cx - 9, fy - 14, cx + 9, fy - 14, cx, fy + 8]); fillStroke(ctx, '#f0b867', 3);
    line(ctx, cx - 5, fy - 9, cx + 2, fy + 1, 1.4, rgba(INK, 0.35));
    line(ctx, cx + 5, fy - 9, cx - 2, fy + 1, 1.4, rgba(INK, 0.35));
    circFS(ctx, cx, fy - 19, 10, '#ff9ebb', 3);
    circFS(ctx, cx - 3, fy - 23, 3, 'rgba(255,255,255,0.7)');
    circFS(ctx, cx + 2, fy - 30, 3.2, '#e5395a', 2);
    rec.chimneys.push(chimney(ctx, x0 + 38, shoulder + 6, shoulder - 24, 26, shade(col, -0.1), 1));
  }

  function parapet(ctx, x0, x1, ry, ph, col, trim, opts) {
    opts = opts || {};
    const cx = (x0 + x1) / 2;
    rectFS(ctx, x0 + 2, ry - ph, x1 - x0 - 4, ph + 2, shade(col, -0.08), 4);
    // balusters
    const n = Math.floor((x1 - x0 - 20) / 14);
    for (let i = 0; i < n; i++) {
      const bx = x0 + 12 + i * (x1 - x0 - 24) / (n - 1);
      if (opts.pediment && Math.abs(bx - cx) < opts.pediment + 6) continue;
      ell(ctx, bx, ry - ph * 0.45, 4, ph * 0.32); fillStroke(ctx, trim, 2.2);
    }
    rrFS(ctx, x0 - 4, ry - ph - 7, x1 - x0 + 8, 9, 3, trim, 3.6);
    if (opts.pediment) {
      const pw = opts.pediment;
      poly(ctx, [cx - pw, ry - ph - 4, cx, ry - ph - 4 - pw * 0.42, cx + pw, ry - ph - 4]);
      fillStroke(ctx, col, 4);
      poly(ctx, [cx - pw - 4, ry - ph - 2, cx, ry - ph - 7 - pw * 0.42, cx + pw + 4, ry - ph - 2], false);
      stroke(ctx, 4.5, trim);
      poly(ctx, [cx - pw - 4, ry - ph - 2, cx, ry - ph - 7 - pw * 0.42, cx + pw + 4, ry - ph - 2], false);
      stroke(ctx, 1.6, INK);
    }
  }

  // ---- generic building ------------------------------------------------------
  function boardColors(s) {
    switch (s.type) {
      case 'chippy': return { board: '#203d6b', txt: '#ffffff', sub: '#ffd166' };
      case 'bakery': return { board: '#7a4426', txt: '#fff3d6', sub: '#ffd166' };
      case 'icecream': return { board: '#d94f86', txt: '#ffffff', sub: '#fff1a8' };
      case 'cafe': return { board: mix(shade(s.color, -0.62), INK, 0.15), txt: '#ffffff', sub: '#ffd166' };
      case 'pub': return { board: shade(s.color, -0.5), txt: '#f6d48a', sub: '#f1d6a8' };
      case 'arcade': return { board: '#33206e', txt: '#ffd23f', sub: '#ffffff' };
      case 'seafood': return { board: '#1f6f8b', txt: '#ffffff', sub: '#ffd166' };
      default: return { board: mix(shade(s.color, -0.6), INK, 0.2), txt: '#ffffff', sub: '#ffd166' };
    }
  }
  function roofKind(s) {
    if (s.type === 'bakery') return 'crow';
    if (s.type === 'pub') return 'parapet';
    if (s.type === 'icecream') return 'dutch';
    if (s.type === 'arcade') return 'sunburst';
    if (s.type === 'cafe') return 'slate1';
    return 'slate2';
  }

  function upperWindows(ctx, s, look, rnd) {
    const x0 = s.x0, x1 = s.x1, w = x1 - x0;
    const top = s.roofY + 30, bot = SIGN_Y0 - 10;
    const avail = bot - top;
    if (avail < 22) return [];
    const box = look.boxes && avail >= 50;
    let wh = Math.min(76, avail - (box ? 18 : 4));
    let ww = Math.max(32, Math.round(wh * 0.66));
    const short = wh < 40;
    if (short) ww = Math.round(wh * 1.55);
    let n = look.nWin || M.clamp(Math.round((w - 50) / (ww + 44)), 1, 4);
    const wy = top + Math.max(0, (avail - wh - (box ? 16 : 0)) / 2);
    const centers = [];
    for (let i = 0; i < n; i++) centers.push(x0 + w * (i + 0.5) / n);
    const curtains = ['#ff8fb1', '#ffd23f', '#ffffff', '#a8e6cf'];
    centers.forEach((cx, i) => {
      sash(ctx, cx - ww / 2, wy, ww, wh, s.trim, {
        arched: look.arched, box: box ? look.boxCol || shade(s.color, -0.35) : null, rnd,
        curtain: look.curtains && (i + s.x0) % 2 === 0 ? curtains[(i + Math.floor(s.x0 / 10)) % curtains.length] : null,
        lit: look.litWindows ? litGlass(ctx, wy, wh) : null, bars: !short,
        lintelCol: look.lintel, sillCol: look.lintel,
      });
    });
    return centers;
  }
  function litGlass(ctx, y, h) {
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, '#ffe7a3'); g.addColorStop(1, '#ffb35c');
    return g;
  }

  function groundFloor(ctx, s, look, rnd) {
    const x0 = s.x0, x1 = s.x1;
    const trim = s.trim === '#ffffff' ? '#fbfaf5' : s.trim;
    // stall riser / plinth
    rectFS(ctx, x0, PLINTH_Y, x1 - x0, FACADE_Y - PLINTH_Y, shade(s.color, -0.22), 3.4);
    line(ctx, x0 + 4, PLINTH_Y + 4, x1 - 4, PLINTH_Y + 4, 1.6, 'rgba(255,255,255,0.25)');
    if (s.hatchX == null) {
      pilaster(ctx, x0, 14, SIGN_Y1, FACADE_Y, trim);
      pilaster(ctx, x1 - 14, 14, SIGN_Y1, FACADE_Y, trim);
      return;
    }
    const FR = 8;
    const hx0 = s.hatchX - HATCH.halfW - FR, hx1 = s.hatchX + HATCH.halfW + FR;
    const sideL = hx0 - x0, sideR = x1 - hx1;
    const doorOnLeft = look.doorLeft != null ? look.doorLeft : sideL >= sideR;
    const doorCol = look.doorCol || shade(s.color, -0.45);
    const sides = [[x0, sideL, true], [hx1, sideR, false]];
    for (const [ax, aw, isLeft] of sides) {
      const isDoor = isLeft === doorOnLeft;
      if (isDoor && aw < 84) {
        // narrow side: the door fills the bay, framed by a slim pilaster strip
        const pw = 7;
        const px = isLeft ? ax : ax + aw - pw;
        rectFS(ctx, px, SIGN_Y1, pw, FACADE_Y - SIGN_Y1, trim, 3);
        const fr = 4;
        const dx0 = isLeft ? ax + pw + fr + 2 : ax + fr + 3;
        const dw = aw - pw - fr * 2 - 5;
        if (dw >= 18) door(ctx, dx0, dw, 444, doorCol, trim, { frame: fr });
      } else {
        const pw = aw >= 70 ? 14 : 9;
        const px = isLeft ? ax : ax + aw - pw;
        pilaster(ctx, px, pw, SIGN_Y1, FACADE_Y, trim);
        const ix0 = isLeft ? ax + pw + 4 : ax + 4, iw = aw - pw - 8;
        if (isDoor) {
          const dw = Math.min(50, iw - 12);
          door(ctx, ix0 + (iw - dw) / 2, dw, 440, doorCol, trim);
        } else if (iw >= 22) {
          shopWindow(ctx, ix0 + 5, iw - 10, 452, 520, trim, s.type, rnd);
        } else if (iw >= 10) {
          // tiny menu plaque
          rrFS(ctx, ix0 + 1, 456, iw - 2, 40, 3, '#2f3a4a', 2.4);
          chalkLines(ctx, ix0 + 4, 462, iw - 8, 6, rnd);
        }
      }
    }
    hatchInterior(ctx, s, rnd);
    hatchFrame(ctx, s, trim);
    const ac = look.awning || [s.color, '#ffffff'];
    awning(ctx, s.hatchX, HATCH.halfW + 10, HATCH.halfW + 22, AWN_Y0, AWN_Y1, ac[0], ac[1]);
  }

  function quoins(ctx, s) {
    for (const side of [0, 1]) {
      for (let y = s.roofY + 14, i = 0; y < SIGN_Y0 - 6; y += 16, i++) {
        const wq = i % 2 ? 14 : 22;
        const x = side ? s.x1 - wq : s.x0;
        rectFS(ctx, x, y, wq, 14, mix(s.color, '#ffffff', 0.45), 2);
      }
    }
  }

  function drawBuilding(ctx, s, idx, st, pal, rnd, rec) {
    const x0 = s.x0, x1 = s.x1, w = x1 - x0, ry = s.roofY;
    const kind = roofKind(s);
    const look = {
      boxes: true, curtains: true, arched: false, nWin: 0,
      awning: [s.color === '#ffffff' ? '#5ab8de' : s.color, '#ffffff'],
    };
    // ---- roof (behind the facade)
    if (kind === 'slate2' || kind === 'slate1') {
      const rh = M.clamp(Math.round(w * 0.22), 58, 78);
      slateRoof(ctx, x0, x1, ry, rh, 16, pal);
      if (kind === 'slate2') {
        const cs = [x0 + 40, x1 - 40];
        rec.chimneys.push(chimney(ctx, cs[0], ry - rh + 6, ry - rh - 30, 42, mix(s.color, '#d8c8b0', 0.55), 3));
        rec.chimneys.push(chimney(ctx, cs[1], ry - rh + 6, ry - rh - 22, 36, mix(s.color, '#d8c8b0', 0.55), 2));
        const nd = w > 300 ? 2 : 1;
        for (let i = 0; i < nd; i++) dormer(ctx, x0 + w * (i + 1) / (nd + 1), ry - 4, 36, 30, '#fbfaf5', s.trim === '#ffffff' ? '#ffffff' : s.trim, pal);
      } else {
        rec.chimneys.push(chimney(ctx, x1 - 44, ry - rh + 6, ry - rh - 28, 40, mix(s.color, '#d8c8b0', 0.5), 3));
        // big gabled dormer
        const dw = 64, dh = 40, dcx = x0 + w * 0.42;
        rectFS(ctx, dcx - dw / 2, ry - dh - 2, dw, dh + 2, s.color, 3.6);
        sash(ctx, dcx - 18, ry - dh + 6, 36, dh - 12, s.trim, { lintel: false, sill: false });
        poly(ctx, [dcx - dw / 2 - 8, ry - dh, dcx, ry - dh - 30, dcx + dw / 2 + 8, ry - dh]);
        fillStroke(ctx, pal.slate, 3.6);
        poly(ctx, [dcx - dw / 2 - 3, ry - dh - 1, dcx, ry - dh - 25, dcx + dw / 2 + 3, ry - dh - 1], false);
        stroke(ctx, 3, s.trim);
      }
    } else if (kind === 'crow') {
      crowGable(ctx, x0, x1, ry, Math.min(118, 82 + w * 0.12), s.color, s.trim === '#ffffff' ? '#fbfaf5' : s.trim, pal, rec);
      look.boxes = false;
    } else if (kind === 'dutch') {
      dutchGable(ctx, x0, x1, ry, 92, s.color, s.trim, rec);
    } else if (kind === 'parapet') {
      rec.chimneys.push(chimney(ctx, x0 + 46, ry - 20, ry - 52, 38, mix(s.color, '#8c96a8', 0.4), 2));
      parapet(ctx, x0, x1, ry, 22, s.color, s.trim, { pediment: 46 });
      look.arched = true; look.boxes = true; look.curtains = false; look.litWindows = true; look.nWin = 2;
      look.boxCol = '#2a3a55';
    } else if (kind === 'sunburst') {
      sunburst(ctx, s, rec);
      look.boxes = false; look.curtains = false;
    }
    // ---- facade body
    rectFS(ctx, x0, ry, w, FACADE_Y - ry, s.color);
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(x0 + 4, ry, 6, FACADE_Y - ry);
    ctx.fillStyle = 'rgba(45,42,74,0.1)'; ctx.fillRect(x1 - 10, ry, 10, FACADE_Y - ry);
    if (kind === 'crow') quoins(ctx, s);
    // string course above the sign
    rectFS(ctx, x0, SIGN_Y0 - 8, w, 5, shade(s.color, -0.12));
    // ---- upper floor
    if (kind === 'parapet') {
      pubUpper(ctx, s, look, rnd, rec);
    } else if (kind === 'sunburst') {
      // arcade: no upper windows, sign is a big marquee
    } else {
      upperWindows(ctx, s, look, rnd);
    }
    // ---- sign + ground floor
    const bc = boardColors(s);
    if (kind === 'sunburst') {
      arcadeFront(ctx, s, bc, rnd, rec);
    } else if (s.type === 'pub') {
      pubFront(ctx, s, bc, rnd);
    } else {
      groundFloor(ctx, s, look, rnd);
      fascia(ctx, x0 - 2, x1 + 2, SIGN_Y0, SIGN_Y1, bc.board, s.trim === '#ffffff' ? '#fbfaf5' : s.trim, s.label, s.sub, bc.txt, bc.sub);
    }
    // ---- outline + eave ledge
    ctx.beginPath(); ctx.rect(x0, ry, w, FACADE_Y - ry); stroke(ctx, 4.5);
    ledge(ctx, x0, x1, ry, s.trim === '#ffffff' ? '#fbfaf5' : s.trim);
  }

  // ---- pub ---------------------------------------------------------------------
  function pubUpper(ctx, s, look, rnd, rec) {
    const x0 = s.x0, x1 = s.x1, w = x1 - x0, ry = s.roofY;
    const top = ry + 28, bot = SIGN_Y0 - 14;
    const wh = Math.min(66, bot - top - 16), ww = 50;
    for (const cx of [x0 + w * 0.24, x0 + w * 0.76]) {
      sash(ctx, cx - ww / 2, top, ww, wh, s.trim, { arched: true, lit: litGlass(ctx, top, wh), box: '#24344f', rnd, sillCol: s.trim });
    }
    // hanging sign on a wrought-iron bracket (centre)
    const cx = x0 + w / 2;
    line(ctx, cx - 26, top + 2, cx + 26, top + 2, 3.5, INK);
    ctx.beginPath(); ctx.arc(cx - 18, top + 10, 7, Math.PI, 0); stroke(ctx, 2.4);
    line(ctx, cx - 18, top + 2, cx - 18, top + 10, 2, INK);
    line(ctx, cx - 20, top + 2, cx - 20, top + 14, 2, INK);
    line(ctx, cx + 20, top + 2, cx + 20, top + 14, 2, INK);
    const sy = top + 14, sh = Math.max(40, Math.min(56, bot - sy + 4)), sw = 50;
    rrFS(ctx, cx - sw / 2, sy, sw, sh, 8, '#1d2c45', 3.6);
    rr(ctx, cx - sw / 2 + 4, sy + 4, sw - 8, sh - 8, 5); stroke(ctx, 2, '#f1d6a8');
    // cormorant: dark bird with long neck on a rock, gold sun behind
    circFS(ctx, cx + 6, sy + sh * 0.38, 9, '#f6d48a');
    ctx.fillStyle = '#101722';
    ctx.beginPath();
    ctx.moveTo(cx - 10, sy + sh * 0.78);
    ctx.quadraticCurveTo(cx - 12, sy + sh * 0.52, cx - 2, sy + sh * 0.5);
    ctx.quadraticCurveTo(cx - 1, sy + sh * 0.32, cx + 3, sy + sh * 0.25);
    ctx.lineTo(cx + 11, sy + sh * 0.27);
    ctx.lineTo(cx + 4, sy + sh * 0.31);
    ctx.quadraticCurveTo(cx + 3, sy + sh * 0.5, cx + 8, sy + sh * 0.62);
    ctx.quadraticCurveTo(cx + 6, sy + sh * 0.78, cx - 10, sy + sh * 0.78);
    ctx.fill();
    ell(ctx, cx - 1, sy + sh * 0.82, 15, 3.5); ctx.fillStyle = '#6b7f99'; ctx.fill();
  }

  function pubFront(ctx, s, bc, rnd) {
    const x0 = s.x0, x1 = s.x1, w = x1 - x0;
    // dark panelled frontage
    rectFS(ctx, x0, SIGN_Y0 - 4, w, FACADE_Y - SIGN_Y0 + 4, shade(s.color, -0.32), 3.4);
    rectFS(ctx, x0, PLINTH_Y, w, FACADE_Y - PLINTH_Y, shade(s.color, -0.5), 3.4);
    const gold = '#e9c46a';
    pilaster(ctx, x0, 16, SIGN_Y1, FACADE_Y, shade(s.color, -0.15));
    pilaster(ctx, x1 - 16, 16, SIGN_Y1, FACADE_Y, shade(s.color, -0.15));
    // door
    const dw = 48, dx = x0 + w / 2 - dw / 2;
    door(ctx, dx, dw, 434, '#6b2f2f', shade(s.color, -0.1), { lit: true });
    // two big warm windows
    const wy0 = 432, wy1 = 528;
    for (const [ax, aw] of [[x0 + 24, dx - 10 - (x0 + 24)], [dx + dw + 10, x1 - 24 - (dx + dw + 10)]]) {
      rrFS(ctx, ax - 5, wy0 - 5, aw + 10, wy1 - wy0 + 10, 3, shade(s.color, -0.1), 3.4);
      ctx.beginPath(); ctx.rect(ax, wy0, aw, wy1 - wy0);
      const g = ctx.createLinearGradient(0, wy0, 0, wy1);
      g.addColorStop(0, '#ffe8a8'); g.addColorStop(0.6, '#ffbe5c'); g.addColorStop(1, '#e8893a');
      ctx.fillStyle = g; ctx.fill();
      // silhouettes of a cosy interior (lamps, shelves)
      ctx.save(); ctx.beginPath(); ctx.rect(ax, wy0, aw, wy1 - wy0); ctx.clip();
      const rg = ctx.createRadialGradient(ax + aw / 2, wy0 + 26, 2, ax + aw / 2, wy0 + 26, 40);
      rg.addColorStop(0, 'rgba(255,255,230,0.8)'); rg.addColorStop(1, 'rgba(255,255,230,0)');
      ctx.fillStyle = rg; ctx.fillRect(ax, wy0, aw, wy1 - wy0);
      ctx.fillStyle = 'rgba(120,60,30,0.35)';
      ctx.fillRect(ax, wy0 + 46, aw, 3);
      for (let i = 0; i < aw / 9; i++) ctx.fillRect(ax + 3 + i * 9, wy0 + 36 + (i % 2) * 3, 4, 10 - (i % 2) * 3);
      // frosted etched lower half with gold border
      ctx.fillStyle = 'rgba(255,248,230,0.55)'; ctx.fillRect(ax, wy0 + 58, aw, wy1 - wy0 - 58);
      ctx.restore();
      // glazing bars
      ctx.strokeStyle = shade(s.color, -0.1); ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(ax, wy0 + 58); ctx.lineTo(ax + aw, wy0 + 58);
      for (let k = 1; k < 3; k++) { ctx.moveTo(ax + k * aw / 3, wy0); ctx.lineTo(ax + k * aw / 3, wy0 + 58); }
      ctx.stroke();
      rr(ctx, ax + 5, wy0 + 63, aw - 10, wy1 - wy0 - 68, 3); stroke(ctx, 1.6, gold);
      ctx.beginPath(); ctx.rect(ax, wy0, aw, wy1 - wy0); stroke(ctx, 3);
    }
    // gold-lettered fascia
    fascia(ctx, x0 - 2, x1 + 2, SIGN_Y0, SIGN_Y1, bc.board, gold, s.label, s.sub, bc.txt, bc.sub, { console: shade(s.color, -0.15), inner: gold });
    // hanging baskets either side of the sign
    for (const bx of [x0 + 10, x1 - 10]) {
      line(ctx, bx, SIGN_Y1 + 10, bx, SIGN_Y1 + 20, 1.6, INK);
      ctx.beginPath(); ctx.arc(bx, SIGN_Y1 + 24, 11, 0, Math.PI); ctx.closePath(); fillStroke(ctx, '#5b3a2a', 2.6);
      const fl = ['#ff3f5f', '#ffffff', '#c477ff', '#ff5d8f', '#ffd23f'];
      for (let i = 0; i < 7; i++) circFS(ctx, bx - 10 + i * 3.4, SIGN_Y1 + 22 - Math.sin(i / 6 * Math.PI) * 6 + (i % 2) * 2, 3.4, i % 3 === 0 ? '#4fae4f' : fl[i % fl.length], 1.2);
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(bx - 6 + i * 6, SIGN_Y1 + 32); ctx.quadraticCurveTo(bx - 8 + i * 6, SIGN_Y1 + 40, bx - 5 + i * 6, SIGN_Y1 + 46); stroke(ctx, 2.4, '#3f9a4a'); }
    }
  }

  // ---- arcade ----------------------------------------------------------------
  function sunburst(ctx, s, rec) {
    const cx = (s.x0 + s.x1) / 2, ry = s.roofY;
    // low side parapet
    rectFS(ctx, s.x0 + 2, ry - 16, s.x1 - s.x0 - 4, 18, shade(s.color, -0.12), 4);
    rrFS(ctx, s.x0 - 4, ry - 22, s.x1 - s.x0 + 8, 8, 3, s.trim, 3.4);
    const R = 74;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, ry, R, Math.PI, 0); ctx.closePath(); ctx.clip();
    const n = 14;
    for (let i = 0; i < n; i++) {
      const a0 = Math.PI + i * Math.PI / n, a1 = a0 + Math.PI / n;
      ctx.beginPath(); ctx.moveTo(cx, ry); ctx.arc(cx, ry, R + 2, a0, a1); ctx.closePath();
      ctx.fillStyle = i % 2 ? '#ffe680' : '#ff9ad5'; ctx.fill();
    }
    ctx.restore();
    ctx.beginPath(); ctx.arc(cx, ry, R, Math.PI, 0); ctx.closePath(); stroke(ctx, 4.5);
    ctx.beginPath(); ctx.arc(cx, ry, R - 10, Math.PI, 0); stroke(ctx, 2, rgba(INK, 0.35));
    ctx.beginPath(); ctx.arc(cx, ry, 22, Math.PI, 0); ctx.closePath(); fillStroke(ctx, s.color, 3.6);
    // star on top
    const sy = ry - R - 16;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) { const r = i % 2 ? 7 : 16, a = -Math.PI / 2 + i * Math.PI / 5; ctx.lineTo(cx + Math.cos(a) * r, sy + Math.sin(a) * r); }
    ctx.closePath(); fillStroke(ctx, '#ffd23f', 3.4);
    // bulbs along the arc
    const bulbs = [];
    for (let i = 0; i <= 12; i++) { const a = Math.PI + i * Math.PI / 12; bulbs.push([cx + Math.cos(a) * (R - 5), ry + Math.sin(a) * (R - 5)]); }
    rec.bulbs.push(...bulbs);
  }

  function arcadeFront(ctx, s, bc, rnd, rec) {
    const x0 = s.x0, x1 = s.x1, w = x1 - x0, cx = (x0 + x1) / 2;
    // big marquee sign
    const my0 = s.roofY + 26, my1 = 420;
    rrFS(ctx, x0 + 8, my0, w - 16, my1 - my0, 10, bc.board, 4.5);
    rr(ctx, x0 + 22, my0 + 14, w - 44, my1 - my0 - 28, 6); stroke(ctx, 2, rgba('#ffd23f', 0.6));
    const size = fitFont(ctx, s.label, SG.FONT_TITLE, 400, 54, w - 70, (my1 - my0) * 0.48, 2);
    inkText(ctx, s.label, cx, my0 + (my1 - my0) * 0.42, bc.txt, Math.max(3, size * 0.16), INK, { col: '#ff5db1', dx: 0, dy: 3.5 });
    setSpacing(ctx, 0);
    if (s.sub) {
      const rw = Math.min(w - 90, 150);
      rrFS(ctx, cx - rw / 2, my0 + (my1 - my0) * 0.66, rw, 20, 10, '#ff5db1', 3);
      fitFont(ctx, s.sub, SG.FONT, 700, 14, rw - 16, 13, 1.5);
      inkText(ctx, s.sub, cx, my0 + (my1 - my0) * 0.66 + 10, '#ffffff', 0);
      setSpacing(ctx, 0);
    }
    // bulbs around the marquee
    const bulbs = [];
    const bx0 = x0 + 15, bx1 = x1 - 15, by0 = my0 + 7, by1 = my1 - 7;
    const nx = Math.round((bx1 - bx0) / 17), ny = Math.round((by1 - by0) / 17);
    for (let i = 0; i < nx; i++) bulbs.push([bx0 + i * (bx1 - bx0) / nx, by0]);
    for (let i = 0; i < ny; i++) bulbs.push([bx1, by0 + i * (by1 - by0) / ny]);
    for (let i = 0; i < nx; i++) bulbs.push([bx1 - i * (bx1 - bx0) / nx, by1]);
    for (let i = 0; i < ny; i++) bulbs.push([bx0, by1 - i * (by1 - by0) / ny]);
    rec.bulbs.push(...bulbs);
    for (const b of rec.bulbs) circFS(ctx, b[0], b[1], 4, '#d9a441', 2, rgba(INK, 0.8));
    // open arcade front
    const oy0 = my1 + 14, ox0 = x0 + 22, ox1 = x1 - 22;
    rrFS(ctx, ox0 - 6, oy0 - 6, ox1 - ox0 + 12, FACADE_Y - oy0 + 2, 4, s.trim, 3.6);
    ctx.save();
    ctx.beginPath(); ctx.rect(ox0, oy0, ox1 - ox0, FACADE_Y - oy0 - 4); ctx.clip();
    const g = ctx.createLinearGradient(0, oy0, 0, FACADE_Y);
    g.addColorStop(0, '#ffd6f2'); g.addColorStop(0.5, '#c58cff'); g.addColorStop(1, '#4a2f8a');
    ctx.fillStyle = g; ctx.fillRect(ox0, oy0, ox1 - ox0, FACADE_Y - oy0);
    // checker floor
    for (let i = 0; i < 20; i++) { ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.25)' : 'rgba(40,20,80,0.25)'; ctx.fillRect(ox0 + i * 14, FACADE_Y - 16, 14, 12); }
    // machines
    const mcol = ['#ff5db1', '#3a86ff', '#2ec27e', '#ffbe0b'];
    const mw = (ox1 - ox0 - 20) / 4;
    for (let i = 0; i < 4; i++) {
      const mx = ox0 + 6 + i * (mw + 3), my = oy0 + 18 + (i % 2) * 6;
      rrFS(ctx, mx, my, mw, FACADE_Y - my - 14, 6, mcol[i], 2.8);
      rrFS(ctx, mx + 6, my + 8, mw - 12, 26, 4, i % 2 ? '#2a2550' : '#fff3c4', 2.2);
      if (i % 2 === 0) { for (let k = 0; k < 4; k++) circFS(ctx, mx + 12 + k * (mw - 24) / 3, my + 26, 3.4, '#f2c14e', 1.2); }
      else { circFS(ctx, mx + mw / 2, my + 20, 6, '#ff8fb1', 1.4); line(ctx, mx + mw / 2, my + 8, mx + mw / 2, my + 14, 1.6, '#ffffff'); }
      circFS(ctx, mx + mw / 2, my + 44, 3.5, '#ffffff', 1.4);
    }
    ctx.fillStyle = 'rgba(255,230,255,0.25)'; ctx.fillRect(ox0, oy0, ox1 - ox0, 10);
    ctx.restore();
    ctx.beginPath(); ctx.rect(ox0, oy0, ox1 - ox0, FACADE_Y - oy0 - 4); stroke(ctx, 3.6);
    // rolled-up shutter
    rrFS(ctx, ox0 - 4, oy0 - 2, ox1 - ox0 + 8, 10, 4, '#c9ccd8', 3);
    // striped pillars
    for (const px of [x0, x1 - 16]) {
      rectFS(ctx, px, my1, 16, FACADE_Y - my1, '#ffffff', 3.4);
      ctx.save(); ctx.beginPath(); ctx.rect(px, my1, 16, FACADE_Y - my1); ctx.clip();
      ctx.fillStyle = '#ff5db1';
      for (let y = my1 - 16; y < FACADE_Y; y += 16) poly(ctx, [px, y, px + 16, y - 8, px + 16, y, px, y + 8]), ctx.fill();
      ctx.restore();
      ctx.beginPath(); ctx.rect(px, my1, 16, FACADE_Y - my1); stroke(ctx, 3.4);
    }
  }

  // ---- art deco ice cream parlour -----------------------------------------
  function drawDeco(ctx, s, st, pal, rnd, rec) {
    const x0 = s.x0, x1 = s.x1, w = x1 - x0, ry = s.roofY, cx = (s.hatchX != null ? s.hatchX : (x0 + x1) / 2);
    const cream = s.color, teal = s.trim, tealDark = shade(teal, -0.35), pink = '#ff8fb8';
    // stepped ziggurat parapet rising from the eave ledge
    const tiers = [[124, 30], [84, 26], [44, 30]];
    const pts = [cx - tiers[0][0], ry + 4];
    let ty = ry;
    for (let i = 0; i < tiers.length; i++) {
      const hw = tiers[i][0];
      ty -= tiers[i][1];
      pts.push(cx - hw, ty);
      if (i < tiers.length - 1) pts.push(cx - tiers[i + 1][0], ty);
    }
    const topY = ty;
    pts.push(cx + tiers[tiers.length - 1][0], topY);
    ty = topY;
    for (let i = tiers.length - 1; i >= 0; i--) {
      const hw = tiers[i][0];
      if (i < tiers.length - 1) { pts.push(cx + tiers[i + 1][0], ty); pts.push(cx + hw, ty); }
      ty += tiers[i][1];
    }
    pts.push(cx + tiers[0][0], ry + 4);
    poly(ctx, pts); fillStroke(ctx, cream, 4.5);
    ctx.save(); poly(ctx, pts); ctx.clip();
    ctx.fillStyle = 'rgba(45,42,74,0.07)'; ctx.fillRect(cx + 20, topY, 200, ry - topY + 4);
    ty = ry;
    for (let i = 0; i < tiers.length; i++) {
      const hw = tiers[i][0];
      ty -= tiers[i][1];
      for (let k = 0; k < 2; k++) line(ctx, cx - hw - 4, ty + 9 + k * 7, cx + hw + 4, ty + 9 + k * 7, 2.8, teal);
    }
    ctx.restore();
    poly(ctx, pts); stroke(ctx, 4.5);
    // vertical fins on the top tier and a round cone emblem
    for (const fx of [cx - 30, cx + 30]) rrFS(ctx, fx - 4, topY - 14, 8, 40, 4, teal, 3);
    circFS(ctx, cx, topY + 2, 17, '#ffffff', 3.6);
    poly(ctx, [cx - 7, topY - 1, cx + 7, topY - 1, cx, topY + 13]); fillStroke(ctx, '#f0b867', 2.2);
    circFS(ctx, cx, topY - 4, 7, pink, 2.2);
    // flagpole + pennant
    line(ctx, cx, topY - 15, cx, topY - 48, 3, INK);
    poly(ctx, [cx, topY - 48, cx + 26, topY - 42, cx, topY - 35]); fillStroke(ctx, pink, 2.6);
    // facade body with rounded upper corners
    rr(ctx, x0, ry, w, FACADE_Y - ry + 20, 26);
    ctx.save(); ctx.beginPath(); ctx.rect(x0 - 10, ry - 4, w + 20, FACADE_Y - ry + 4); ctx.clip();
    rr(ctx, x0, ry, w, FACADE_Y - ry + 20, 26); fillStroke(ctx, cream, 4.5);
    ctx.fillStyle = 'rgba(45,42,74,0.08)'; ctx.fillRect(x1 - 12, ry, 12, FACADE_Y - ry);
    ctx.restore();
    // horizontal speed lines wrapping round the corners
    for (let k = 0; k < 3; k++) {
      const ly = ry + 26 + k * 9;
      line(ctx, x0 + 6, ly, x0 + 70, ly, 3.4, teal);
      line(ctx, x1 - 70, ly, x1 - 6, ly, 3.4, teal);
    }
    // ribbon windows with rounded ends
    const wy = ry + 22, wh = 30;
    for (const [ax, aw] of [[x0 + 84, 88], [x1 - 84 - 88, 88]]) {
      rrFS(ctx, ax - 5, wy - 5, aw + 10, wh + 10, (wh + 10) / 2, teal, 3.4);
      rr(ctx, ax, wy, aw, wh, wh / 2); ctx.fillStyle = glass(ctx, ax, wy, aw, wh); ctx.fill();
      ctx.save(); rr(ctx, ax, wy, aw, wh, wh / 2); ctx.clip();
      ctx.fillStyle = 'rgba(255,255,255,0.3)'; poly(ctx, [ax + 20, wy + wh, ax + 40, wy, ax + 52, wy, ax + 32, wy + wh]); ctx.fill();
      ctx.restore();
      for (let k = 1; k < 3; k++) line(ctx, ax + k * aw / 3, wy, ax + k * aw / 3, wy + wh, 2.6, teal);
      rr(ctx, ax, wy, aw, wh, wh / 2); stroke(ctx, 2, rgba(INK, 0.5));
    }
    // centre panel between windows
    for (let k = 0; k < 3; k++) circFS(ctx, cx - 16 + k * 16, ry + 38, 4.5, k === 1 ? pink : teal, 2.4);
    // neon sign panel
    const sx0 = x0 + 20, sx1 = x1 - 20;
    rrFS(ctx, sx0, SIGN_Y0 - 6, sx1 - sx0, SIGN_Y1 - SIGN_Y0 + 6, 26, '#1f4f57', 4.5);
    rr(ctx, sx0 + 6, SIGN_Y0, sx1 - sx0 - 12, SIGN_Y1 - SIGN_Y0 - 6, 20); stroke(ctx, 2, teal);
    const nsize = fitFont(ctx, s.label, SG.FONT_TITLE, 400, 34, sx1 - sx0 - 70, 26, 2);
    ctx.save();
    ctx.shadowColor = '#ff4fa3'; ctx.shadowBlur = 14;
    inkText(ctx, s.label, cx, SIGN_Y0 + 14, '#ffd0e6', 0);
    ctx.restore();
    ctx.save(); ctx.lineWidth = 1.4; ctx.strokeStyle = '#ff5fae';
    { const m = ctx.measureText(s.label); ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.strokeText(s.label, cx, SIGN_Y0 + 14 + ((m.actualBoundingBoxAscent || 0) - (m.actualBoundingBoxDescent || 0)) / 2); }
    ctx.restore();
    setSpacing(ctx, 0);
    rec.neon = { text: s.label, size: nsize, x: cx, y: SIGN_Y0 + 14 };
    if (s.sub) {
      fitFont(ctx, s.sub, SG.FONT, 700, 12, sx1 - sx0 - 90, 11, 2.5);
      inkText(ctx, s.sub, cx, SIGN_Y1 - 12, '#9ff3e8', 0);
      setSpacing(ctx, 0);
    }
    // ground floor: fluted pilasters, vitrolite plinth
    rectFS(ctx, x0, PLINTH_Y, w, FACADE_Y - PLINTH_Y, '#203a3f', 3.4);
    for (let k = 0; k < 3; k++) line(ctx, x0 + 6, PLINTH_Y + 5 + k * 6, x1 - 6, PLINTH_Y + 5 + k * 6, 1.4, rgba(teal, 0.6));
    for (const px of [x0, x1 - 18]) {
      rectFS(ctx, px, SIGN_Y1 + 2, 18, PLINTH_Y - SIGN_Y1 - 2, teal, 3.4);
      for (let k = 1; k < 3; k++) line(ctx, px + k * 6, SIGN_Y1 + 8, px + k * 6, PLINTH_Y - 6, 1.6, tealDark);
    }
    if (s.hatchX != null) {
      const hx0 = s.hatchX - HATCH.halfW - 10, hx1 = s.hatchX + HATCH.halfW + 10;
      // porthole door on the left, curved display window on the right
      const lw = hx0 - (x0 + 18), rw = (x1 - 18) - hx1;
      const dW = Math.min(54, lw - 16), dX = x0 + 18 + (lw - dW) / 2;
      rrFS(ctx, dX - 6, 436, dW + 12, FACADE_Y - 436, 14, teal, 3.4);
      rrFS(ctx, dX, 442, dW, FACADE_Y - 446, 10, '#f7c6d9', 3.4);
      circFS(ctx, dX + dW / 2, 470, 12, teal, 3);
      circle(ctx, dX + dW / 2, 470, 8); ctx.fillStyle = glass(ctx, 0, 462, 0, 16); ctx.fill(); stroke(ctx, 2, rgba(INK, 0.5));
      rrFS(ctx, dX + dW - 10, 500, 5, 16, 2.5, '#f2c14e', 1.8);
      rectFS(ctx, dX - 8, FACADE_Y - 4, dW + 16, 4, '#d5c7b0', 2.4);
      const wX = hx1 + 8, wW = rw - 16;
      rrFS(ctx, wX - 5, 447, wW + 10, 82, 18, teal, 3.4);
      rr(ctx, wX, 452, wW, 72, 14);
      const wg = ctx.createLinearGradient(0, 452, 0, 524); wg.addColorStop(0, '#fff3f8'); wg.addColorStop(1, '#ffd0e2');
      ctx.fillStyle = wg; ctx.fill();
      ctx.save(); rr(ctx, wX, 452, wW, 72, 14); ctx.clip();
      // giant sundae in the window
      const sx = wX + wW / 2;
      poly(ctx, [sx - 16, 488, sx + 16, 488, sx + 5, 506, sx - 5, 506]); fillStroke(ctx, 'rgba(255,255,255,0.8)', 2);
      rectFS(ctx, sx - 2, 506, 4, 8, 'rgba(255,255,255,0.8)', 1.6); rectFS(ctx, sx - 9, 513, 18, 4, 'rgba(255,255,255,0.8)', 1.6);
      circFS(ctx, sx - 7, 484, 8, '#a8e6cf', 1.8); circFS(ctx, sx + 7, 484, 8, '#ffe08a', 1.8); circFS(ctx, sx, 474, 8.5, '#ff8fb1', 1.8);
      circFS(ctx, sx + 2, 464, 3.2, '#e5395a', 1.4);
      ctx.fillStyle = 'rgba(255,255,255,0.45)'; poly(ctx, [wX + 6, 524, wX + 26, 452, wX + 36, 452, wX + 16, 524]); ctx.fill();
      ctx.restore();
      rr(ctx, wX, 452, wW, 72, 14); stroke(ctx, 2.6);
      hatchInterior(ctx, s, rnd);
      // deco hatch frame with rounded top corners
      const hx = s.hatchX - HATCH.halfW, hw = HATCH.halfW * 2;
      ctx.beginPath();
      rr(ctx, hx - 10, HATCH.top - 8, hw + 20, HATCH.bottom - HATCH.top + 8, 14);
      ctx.rect(hx, HATCH.top, hw, HATCH.bottom - HATCH.top);
      ctx.fillStyle = teal; ctx.fill('evenodd');
      rr(ctx, hx - 10, HATCH.top - 8, hw + 20, HATCH.bottom - HATCH.top + 8, 14); stroke(ctx, 3.6);
      ctx.beginPath(); ctx.rect(hx, HATCH.top, hw, HATCH.bottom - HATCH.top); stroke(ctx, 4.5);
      awning(ctx, s.hatchX, HATCH.halfW + 10, HATCH.halfW + 22, AWN_Y0, AWN_Y1, pink, '#ffffff');
    }
    // eave ledge (perch) with rounded ends
    ledge(ctx, x0, x1, ry, teal, { brackets: false });
  }

  // ---- seafood hut -----------------------------------------------------------
  function drawHut(ctx, s, st, pal, rnd, rec) {
    const x0 = s.x0, x1 = s.x1, w = x1 - x0, ry = s.roofY, cx = (x0 + x1) / 2;
    const green = s.color, white = s.trim === '#ffffff' ? '#fbfaf5' : s.trim;
    // shadow on the quay
    ctx.fillStyle = 'rgba(45,42,74,0.22)'; ell(ctx, cx, FACADE_Y + 4, w / 2 + 20, 9); ctx.fill();
    // red tin roof (front slope)
    const rh = 44, over = 16;
    const rp = () => poly(ctx, [x0 - over, ry + 2, x0 + 14, ry - rh, x1 - 14, ry - rh, x1 + over, ry + 2]);
    rp(); ctx.fillStyle = '#d9544a'; ctx.fill();
    ctx.save(); rp(); ctx.clip();
    for (let x = x0 - over; x < x1 + over; x += 13) {
      const t = (x - (x0 - over)) / (w + over * 2);
      const xt = x0 + 14 + t * (w - 28);
      ctx.beginPath(); ctx.moveTo(x, ry + 2); ctx.lineTo(xt, ry - rh); stroke(ctx, 4, 'rgba(255,255,255,0.18)');
      ctx.beginPath(); ctx.moveTo(x + 5, ry + 2); ctx.lineTo(xt + 4, ry - rh); stroke(ctx, 2, 'rgba(90,20,20,0.25)');
    }
    const rg = ctx.createLinearGradient(0, ry - rh, 0, ry); rg.addColorStop(0, 'rgba(255,255,255,0.15)'); rg.addColorStop(1, 'rgba(60,0,0,0.15)');
    ctx.fillStyle = rg; ctx.fillRect(x0 - over, ry - rh, w + over * 2, rh + 2);
    ctx.restore();
    rp(); stroke(ctx, 4);
    rrFS(ctx, x0 + 10, ry - rh - 5, w - 20, 8, 3.5, '#b8423a', 3.4);
    // stove pipe poking through the right end of the roof
    rectFS(ctx, x1 - 14, ry - rh - 4, 11, 40, '#5d6475', 3);
    rrFS(ctx, x1 - 18, ry - rh - 10, 19, 7, 2, '#4a5060', 3);
    rec.chimneys.push({ x: x1 - 9, y: ry - rh - 14, small: true });
    // rooftop sign on two posts
    const bc = boardColors(s);
    const sx0 = x0 + 26, sx1 = x1 - 30, sy1 = ry - rh - 6, sy0 = sy1 - 46;
    for (const px of [sx0 + 30, sx1 - 30]) rectFS(ctx, px - 3, sy1 - 4, 6, rh - 6, '#6b4a3a', 2.6);
    rrFS(ctx, sx0, sy0, sx1 - sx0, sy1 - sy0, 8, bc.board, 4.5);
    rr(ctx, sx0 + 5, sy0 + 5, sx1 - sx0 - 10, sy1 - sy0 - 10, 5); stroke(ctx, 1.8, rgba('#ffffff', 0.6));
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(sx0 + 6, sy0 + 6, sx1 - sx0 - 12, 10);
    fishIcon(ctx, sx0 + 22, (sy0 + sy1) / 2, 1.3, '#ffd166');
    ctx.save(); ctx.translate(sx1 - 22, (sy0 + sy1) / 2); ctx.scale(-1, 1); fishIcon(ctx, 0, 0, 1.3, '#ffd166'); ctx.restore();
    const lsz = fitFont(ctx, s.label, SG.FONT_TITLE, 400, 34, sx1 - sx0 - 84, (sy1 - sy0) * 0.6, 1.5);
    inkText(ctx, s.label, (sx0 + sx1) / 2, (sy0 + sy1) / 2 + 1, bc.txt, Math.max(3, lsz * 0.17), INK, { col: rgba(INK, 0.55), dx: 0, dy: 2.5 });
    setSpacing(ctx, 0);
    // plank walls
    rectFS(ctx, x0, ry, w, FACADE_Y - ry, green);
    ctx.strokeStyle = shade(green, -0.22); ctx.lineWidth = 2;
    for (let x = x0 + 13; x < x1 - 4; x += 13) { ctx.beginPath(); ctx.moveTo(x, ry + 10); ctx.lineTo(x, FACADE_Y); ctx.stroke(); }
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    for (let x = x0 + 2; x < x1 - 4; x += 13) ctx.fillRect(x, ry + 10, 3, FACADE_Y - ry - 10);
    // corner trims
    rectFS(ctx, x0, ry, 12, FACADE_Y - ry, white, 3.4);
    rectFS(ctx, x1 - 12, ry, 12, FACADE_Y - ry, white, 3.4);
    // skirt board
    rectFS(ctx, x0, FACADE_Y - 14, w, 14, shade(green, -0.3), 3.4);
    // painted sub-title strip under the eave
    if (s.sub) {
      const by0 = ry + 16, by1 = AWN_Y0 - 3;
      rrFS(ctx, x0 + 22, by0, w - 44, by1 - by0, 4, white, 3.4);
      fitFont(ctx, s.sub, SG.FONT_TITLE, 400, 22, w - 80, (by1 - by0) * 0.62, 2.5);
      inkText(ctx, s.sub, cx, (by0 + by1) / 2 + 1, '#1f6f8b', 0);
      setSpacing(ctx, 0);
    }
    // lifebuoy and door
    if (s.hatchX != null) {
      const hx0 = s.hatchX - HATCH.halfW - 10, hx1 = s.hatchX + HATCH.halfW + 10;
      const lw = hx0 - (x0 + 12), rw = (x1 - 12) - hx1;
      const buoy = (bx, by) => {
        circFS(ctx, bx, by, 15, '#ffffff', 3.4);
        ctx.save(); circle(ctx, bx, by, 15); ctx.clip();
        ctx.fillStyle = '#ff4d4d';
        for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.moveTo(bx, by); ctx.arc(bx, by, 16, k * Math.PI / 2, k * Math.PI / 2 + Math.PI / 4); ctx.closePath(); ctx.fill(); }
        ctx.restore();
        circFS(ctx, bx, by, 7, green, 3);
        circle(ctx, bx, by, 15); stroke(ctx, 3.4);
      };
      if (lw >= rw) { buoy(x0 + 12 + lw / 2, 472); if (rw > 30) door(ctx, hx1 + 6, rw - 10, 446, shade(green, -0.4), white, { fan: false }); }
      else { buoy(hx1 + rw / 2, 472); if (lw > 30) door(ctx, x0 + 16, lw - 10, 446, shade(green, -0.4), white, { fan: false }); }
      hatchInterior(ctx, s, rnd);
      hatchFrame(ctx, s, white);
      awning(ctx, s.hatchX, HATCH.halfW + 8, HATCH.halfW + 20, AWN_Y0, AWN_Y1, '#3a86ff', '#ffffff');
    }
    ctx.beginPath(); ctx.rect(x0, ry, w, FACADE_Y - ry); stroke(ctx, 4.5);
    ledge(ctx, x0, x1, ry, white, { over: 10, brackets: false });
  }

  // ---- closes / gaps and screen-edge filler buildings ------------------------
  function drawClose(ctx, xa, xb, topY) {
    if (xb - xa < 1) return;
    rectFS(ctx, xa, topY, xb - xa, FACADE_Y - topY, '#6f6378');
    ctx.fillStyle = '#4d4358';
    ctx.fillRect(xa, topY + 40, xb - xa, FACADE_Y - topY - 40);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    for (let y = topY + 6; y < FACADE_Y; y += 14) ctx.fillRect(xa, y, xb - xa, 2);
  }
  function edgeBuilding(ctx, xa, xb, ry, col, side, pal) {
    // partial building cut by the screen edge
    const x0 = side < 0 ? xa - 200 : xa, x1 = side < 0 ? xb : xb + 200;
    slateRoof(ctx, x0, x1, ry, 64, 16, pal);
    rectFS(ctx, x0, ry, x1 - x0, FACADE_Y - ry, col, 4.5);
    rectFS(ctx, x0, PLINTH_Y, x1 - x0, FACADE_Y - PLINTH_Y, shade(col, -0.22), 3.4);
    ledge(ctx, x0, x1, ry, '#fbfaf5');
  }

  // ---- promenade, quay & sea wall --------------------------------------------
  function drawPaving(ctx, st, pal, rnd) {
    const y0 = FACADE_Y, y1 = SEAWALL_Y;
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, '#e4d2b2'); g.addColorStop(0.35, pal.pave); g.addColorStop(1, '#f2e5cb');
    ctx.fillStyle = g; ctx.fillRect(0, y0, W, y1 - y0);
    // rows of flagstones with slight perspective
    const VPX = 960, VPY = -2200;
    const proj = (xb, yb, y) => VPX + (xb - VPX) * (y - VPY) / (yb - VPY);
    let y = 584, h = 22;
    const rows = [];
    while (y < y1 - 6) { const hh = Math.min(h, y1 - y); rows.push([y, hh]); y += hh; h *= 1.075; }
    // sett border just in front of the facades
    for (let x = 0, i = 0; x < W; x += 15, i++) {
      ctx.fillStyle = i % 2 ? 'rgba(160,120,90,0.1)' : 'rgba(160,120,90,0.05)';
      rr(ctx, x + 1, 569, 13, 13, 3); ctx.fill();
    }
    line(ctx, 0, 583.5, W, 583.5, 1.4, rgba(pal.paveJoint, 0.55));
    ctx.lineWidth = 1.4;
    rows.forEach(([ry, rh], ri) => {
      const yb = ry + rh;
      const sw = rh * 3.4;
      let x = -((ri * 0.37 * sw) % sw) - sw;
      ctx.strokeStyle = rgba(pal.paveJoint, 0.45 + ri * 0.015);
      ctx.beginPath(); ctx.moveTo(0, yb); ctx.lineTo(W, yb); ctx.stroke();
      while (x < W + sw) {
        const w2 = sw * (0.75 + rnd() * 0.5);
        const xa = x, xb = x + w2;
        const t = rnd();
        if (t < 0.22 || t > 0.86) {
          ctx.fillStyle = t < 0.22 ? 'rgba(255,255,255,0.13)' : 'rgba(150,110,70,0.07)';
          poly(ctx, [proj(xa, yb, ry) + 1.5, ry + 1.5, proj(xb, yb, ry) - 1.5, ry + 1.5, xb - 1.5, yb - 1.5, xa + 1.5, yb - 1.5]);
          ctx.fill();
        }
        ctx.beginPath(); ctx.moveTo(proj(xb, yb, ry), ry); ctx.lineTo(xb, yb); ctx.stroke();
        x = xb;
      }
    });
    // soft shade along the base of the buildings
    const sg = ctx.createLinearGradient(0, y0, 0, y0 + 46);
    sg.addColorStop(0, 'rgba(70,50,60,0.2)'); sg.addColorStop(1, 'rgba(70,50,60,0)');
    ctx.fillStyle = sg; ctx.fillRect(0, y0, W, 46);
    // kerb line near the facades
    ctx.fillStyle = rgba('#b89e7a', 0.35); ctx.fillRect(0, y0, W, 6);
    // light bloom toward the sea
    const lg = ctx.createLinearGradient(0, y1 - 80, 0, y1);
    lg.addColorStop(0, 'rgba(255,250,235,0)'); lg.addColorStop(1, 'rgba(255,250,235,0.25)');
    ctx.fillStyle = lg; ctx.fillRect(0, y1 - 80, W, 80);
  }

  function drainCover(ctx, x, y) {
    rrFS(ctx, x - 22, y - 9, 44, 18, 4, 'rgba(110,100,105,0.32)', 2, 'rgba(70,60,70,0.35)');
    ctx.strokeStyle = 'rgba(60,50,60,0.4)'; ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.moveTo(x - 16 + i * 6.4, y - 5); ctx.lineTo(x - 16 + i * 6.4, y + 5); ctx.stroke(); }
  }
  function manhole(ctx, x, y) {
    ell(ctx, x, y, 30, 13); fillStroke(ctx, 'rgba(130,115,110,0.28)', 2, 'rgba(80,70,70,0.32)');
    ell(ctx, x, y, 22, 9); stroke(ctx, 1.4, 'rgba(80,70,70,0.25)');
    ctx.strokeStyle = 'rgba(80,70,70,0.22)'; ctx.lineWidth = 1.4;
    for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(x + i * 7 - 4, y - 7); ctx.lineTo(x + i * 7 + 4, y + 7); ctx.stroke(); }
  }

  function drawQuay(ctx, st, pal, rnd) {
    const bx0 = st.bay.x0, bx1 = st.bay.x1;
    // shadow on paving in front
    ctx.fillStyle = 'rgba(70,50,60,0.18)'; ctx.fillRect(bx0, QUAY_Y1, bx1 - bx0, 8);
    rectFS(ctx, bx0 - 2, QUAY_Y0, bx1 - bx0 + 4, QUAY_Y1 - QUAY_Y0, '#ddd3c2');
    ctx.fillStyle = '#efe8dc'; ctx.fillRect(bx0, QUAY_Y0 + 2, bx1 - bx0, 8);
    ctx.fillStyle = 'rgba(80,70,80,0.12)'; ctx.fillRect(bx0, QUAY_Y1 - 6, bx1 - bx0, 6);
    let x = bx0 + rnd() * 40;
    while (x < bx1) {
      const p = x - bx0;
      line(ctx, x, QUAY_Y0 + 2, x - 3, QUAY_Y1 - 1, 1.6, 'rgba(110,95,90,0.35)');
      if (p > 10 && rnd() < 0.3) { ctx.fillStyle = 'rgba(120,110,110,0.12)'; ctx.fillRect(x + 6, QUAY_Y0 + 4, 30, 14); }
      x += 70 + rnd() * 40;
    }
    // iron mooring rings set into the coping
    for (let i = 0; i < 3; i++) {
      const rx = bx0 + (i + 0.5) * (bx1 - bx0) / 3 + 14;
      ell(ctx, rx, QUAY_Y0 + 9, 6, 3); stroke(ctx, 2, 'rgba(70,60,70,0.55)');
    }
    line(ctx, bx0 - 2, QUAY_Y0, bx1 + 2, QUAY_Y0, 4);
    line(ctx, bx0, QUAY_Y1, bx1, QUAY_Y1, 2.6, rgba(INK, 0.55));
    // ends of the quay where it meets the buildings
    if (bx0 > 0) line(ctx, bx0 - 2, QUAY_Y0, bx0 - 2, QUAY_Y1, 2, rgba(INK, 0.45));
    if (bx1 < W) line(ctx, bx1 + 2, QUAY_Y0, bx1 + 2, QUAY_Y1, 2, rgba(INK, 0.45));
  }

  function drawSeaWall(ctx, st, pal, rnd) {
    const y0 = SEAWALL_Y;
    // coping top
    rectFS(ctx, -4, y0, W + 8, 10, '#f4ecdd');
    ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(0, y0 + 2, W, 2);
    // rounded nosing face
    const ng = ctx.createLinearGradient(0, y0 + 10, 0, y0 + 21);
    ng.addColorStop(0, '#e2d5bd'); ng.addColorStop(1, '#c9b998');
    ctx.fillStyle = ng; ctx.fillRect(-4, y0 + 10, W + 8, 11);
    let x = rnd() * 60;
    while (x < W) {
      line(ctx, x, y0 + 1, x, y0 + 21, 1.6, 'rgba(110,90,70,0.3)');
      x += 110 + rnd() * 40;
    }
    line(ctx, -4, y0, W + 4, y0, 3.4);
    line(ctx, -4, y0 + 10, W + 4, y0 + 10, 1.6, 'rgba(120,100,80,0.35)');
    line(ctx, -4, y0 + 21, W + 4, y0 + 21, 3);
    // ashlar wall face
    const wy0 = y0 + 21, wy1 = WATER_Y;
    const wg = ctx.createLinearGradient(0, wy0, 0, wy1);
    wg.addColorStop(0, '#9c8f86'); wg.addColorStop(1, '#7f7270');
    ctx.fillStyle = wg; ctx.fillRect(-4, wy0, W + 8, wy1 - wy0);
    const rowsY = [wy0, wy0 + 11, wy1 - 6];
    for (let r = 0; r < 2; r++) {
      const ya = rowsY[r], yb = rowsY[r + 1];
      let bx = -rnd() * 50;
      while (bx < W) {
        const bw = 48 + rnd() * 30;
        ctx.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)';
        rr(ctx, bx + 1.5, ya + 1.5, bw - 3, yb - ya - 3, 3); ctx.fill();
        line(ctx, bx, ya + 1, bx, yb - 1, 1.4, 'rgba(60,50,60,0.35)');
        bx += bw;
      }
      line(ctx, -4, yb, W + 4, yb, 1.4, 'rgba(60,50,60,0.35)');
    }
    // algae / wet band at the waterline
    ctx.fillStyle = '#5e7d62';
    ctx.beginPath(); ctx.moveTo(-4, wy1);
    for (let xx = -4; xx <= W + 8; xx += 16) ctx.lineTo(xx, wy1 - 6 - ((xx * 7) % 5));
    ctx.lineTo(W + 8, wy1 + 4); ctx.lineTo(-4, wy1 + 4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#4c6a56'; ctx.fillRect(-4, wy1 - 2, W + 8, 6);
    // a couple of iron rings / ladder hints
    for (const rx of [460, 1290]) { ell(ctx, rx, wy0 + 10, 5, 6); stroke(ctx, 2, 'rgba(50,40,50,0.6)'); }
  }

  function drawWetLayer(L, st, pal, rnd) {
    const ctx = L.ctx;
    // soft, streaky reflections of the shopfronts on the wet flagstones
    ctx.save();
    if ('filter' in ctx) ctx.filter = 'blur(6px)';
    for (const s of st.shops) {
      const sw = s.x1 - s.x0;
      const n = Math.max(3, Math.round(sw / 56));
      for (let i = 0; i < n; i++) {
        const cx = s.x0 + (i + 0.5) * sw / n, w = sw / n * 0.5;
        const len = 110 + rnd() * 70;
        const g = ctx.createLinearGradient(0, FACADE_Y, 0, FACADE_Y + len);
        g.addColorStop(0, rgba(s.color, 0.42)); g.addColorStop(1, rgba(s.color, 0));
        ctx.fillStyle = g;
        ctx.fillRect(cx - w / 2, FACADE_Y + 6, w, len);
      }
      if (s.hatchX != null) {
        const g2 = ctx.createLinearGradient(0, FACADE_Y, 0, FACADE_Y + 130);
        g2.addColorStop(0, 'rgba(255,214,140,0.45)'); g2.addColorStop(1, 'rgba(255,214,140,0)');
        ctx.fillStyle = g2; ctx.fillRect(s.hatchX - 50, FACADE_Y + 6, 100, 130);
      }
    }
    ctx.restore();
    // general wet sheen
    const sg = ctx.createLinearGradient(0, FACADE_Y, 0, SEAWALL_Y);
    sg.addColorStop(0, 'rgba(70,90,120,0.16)'); sg.addColorStop(1, 'rgba(70,90,120,0.08)');
    ctx.fillStyle = sg; ctx.fillRect(0, FACADE_Y, W, SEAWALL_Y - FACADE_Y);
    // puddles placed away from props
    const props = st.props || [];
    let placed = 0, tries = 0;
    while (placed < 7 && tries < 200) {
      tries++;
      const x = 80 + rnd() * (W - 160), y = 620 + rnd() * 250;
      if (props.some((p) => Math.abs(p.x - x) < 110 && Math.abs(p.y - y) < 60)) continue;
      const rx = 30 + rnd() * 40, ry = rx * 0.22;
      ell(ctx, x, y + 1.5, rx + 2, ry + 1.5); ctx.fillStyle = 'rgba(90,100,120,0.25)'; ctx.fill();
      const pg = ctx.createLinearGradient(0, y - ry, 0, y + ry);
      pg.addColorStop(0, 'rgba(120,138,165,0.7)'); pg.addColorStop(1, 'rgba(196,208,222,0.75)');
      ell(ctx, x, y, rx, ry); ctx.fillStyle = pg; ctx.fill();
      ctx.beginPath(); ctx.ellipse(x - rx * 0.1, y - ry * 0.1, rx * 0.62, ry * 0.5, 0, Math.PI * 1.1, Math.PI * 1.9); stroke(ctx, 2, 'rgba(255,255,255,0.7)');
      line(ctx, x + rx * 0.25, y + ry * 0.35, x + rx * 0.55, y + ry * 0.2, 1.6, 'rgba(255,255,255,0.5)');
      placed++;
    }
  }

  function renderNear(bd) {
    const L = bd.near, st = bd.stage, pal = bd.pal;
    clearLayer(L);
    const ctx = L.ctx;
    const rnd = rng(hashStr(st.id || 'stage') ^ 0x51ab);
    const rec = { chimneys: [], bulbs: [], neon: null };
    drawPaving(ctx, st, pal, rnd);
    // subtle ground details (clear of props)
    const details = st.id === 'oban'
      ? [['drain', 1000, 712], ['manhole', 236, 694], ['drain', 1690, 812]]
      : st.id === 'largs'
        ? [['drain', 1500, 700], ['manhole', 660, 704], ['drain', 120, 840]]
        : [['drain', 960, 720]];
    for (const d of details) {
      const clash = (st.props || []).some((p) => Math.abs(p.x - d[1]) < 70 && Math.abs(p.y - d[2]) < 40);
      if (clash) continue;
      if (d[0] === 'drain') drainCover(ctx, d[1], d[2]); else manhole(ctx, d[1], d[2]);
    }
    drawQuay(ctx, st, pal, rnd);
    // closes between neighbouring shops, edge fillers
    const shops = st.shops.slice().sort((a, b) => a.x0 - b.x0);
    const inBay = (x) => x > st.bay.x0 - 1 && x < st.bay.x1 + 1;
    for (let i = 0; i < shops.length - 1; i++) {
      const a = shops[i], b = shops[i + 1];
      if (a.style === 'hut' || b.style === 'hut') continue;
      if (b.x0 - a.x1 > 0 && b.x0 - a.x1 < 60) drawClose(ctx, a.x1, b.x0, Math.max(a.roofY, b.roofY) + 12);
    }
    const bld = shops.filter((s) => s.style !== 'hut');
    if (bld.length) {
      const first = bld[0], last = bld[bld.length - 1];
      const bayOverlaps = (a, b) => st.bay.x1 > a && st.bay.x0 < b;
      if (first.x0 > 0 && !bayOverlaps(0, first.x0)) { edgeBuilding(ctx, -10, first.x0 - 10, first.roofY + 22, '#f3e6cf', -1, pal); drawClose(ctx, first.x0 - 10, first.x0, first.roofY + 12); }
      if (last.x1 < W && !bayOverlaps(last.x1, W)) { edgeBuilding(ctx, last.x1 + 10, W + 10, last.roofY + 18, '#e9d6ef', 1, pal); drawClose(ctx, last.x1, last.x1 + 10, last.roofY + 12); }
      // side return wall where a building meets the bay
      for (const s of bld) {
        if (inBay(s.x1 + 4) && s.x1 < W) { rectFS(ctx, s.x1, s.roofY + 6, 12, FACADE_Y - s.roofY - 6, shade(s.color, -0.3), 3.4); }
        if (inBay(s.x0 - 4) && s.x0 > 0) { rectFS(ctx, s.x0 - 12, s.roofY + 6, 12, FACADE_Y - s.roofY - 6, shade(s.color, -0.3), 3.4); }
      }
    }
    shops.forEach((s, i) => {
      if (s.style === 'hut') drawHut(ctx, s, st, pal, rnd, rec);
      else if (s.style === 'deco') drawDeco(ctx, s, st, pal, rnd, rec);
      else drawBuilding(ctx, s, i, st, pal, rnd, rec);
    });
    drawSeaWall(ctx, st, pal, rnd);
    bd.chimneys = rec.chimneys;
    // arcade bulb chase frames
    bd.bulbFrames = null;
    if (rec.bulbs.length) {
      let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
      for (const b of rec.bulbs) { minX = Math.min(minX, b[0]); minY = Math.min(minY, b[1]); maxX = Math.max(maxX, b[0]); maxY = Math.max(maxY, b[1]); }
      const pad = 14;
      const fw = maxX - minX + pad * 2, fh = maxY - minY + pad * 2;
      bd.bulbFrames = [0, 1, 2].map((k) => makeSprite(bd.scale, fw, fh, -minX + pad, -minY + pad, (c) => {
        rec.bulbs.forEach((b, i) => {
          if (i % 3 !== k) return;
          const g = c.createRadialGradient(b[0], b[1], 0, b[0], b[1], 11);
          g.addColorStop(0, 'rgba(255,250,200,0.95)'); g.addColorStop(0.35, 'rgba(255,220,90,0.7)'); g.addColorStop(1, 'rgba(255,200,60,0)');
          c.fillStyle = g; circle(c, b[0], b[1], 11); c.fill();
          circFS(c, b[0], b[1], 3.6, '#fffbe0');
        });
      }));
      bd.bulbFrames.forEach((f) => { f.x = minX - pad; f.y = minY - pad; });
    }
    // neon glow sprite
    bd.neon = null;
    if (rec.neon) {
      const n = rec.neon;
      bd.neon = makeSprite(bd.scale, 320, 70, 160, 35, (c) => {
        c.font = `400 ${n.size.toFixed(1)}px ${SG.FONT_TITLE}`;
        setSpacing(c, 2 * n.size / 34);
        c.shadowColor = '#ff3d9a'; c.shadowBlur = 18;
        inkText(c, n.text, 0, 0, 'rgba(255,240,248,0.9)', 0);
        c.shadowBlur = 6;
        inkText(c, n.text, 0, 0, '#ffffff', 0);
      });
      bd.neon.x = n.x; bd.neon.y = n.y;
    }
    // wet-weather sheen layer
    clearLayer(bd.wet);
    drawWetLayer(bd.wet, st, pal, rng(hashStr(st.id || 's') ^ 0x77));
  }

  // =========================================================================
  // FOREGROUND SEA
  // =========================================================================
  function renderSea(L, st, pal, rnd) {
    const ctx = L.ctx;
    const water = st.waterColor;
    ctx.fillStyle = '#4c6a56';
    ctx.fillRect(0, SEA[0], W, WATER_Y - SEA[0]);
    const g = ctx.createLinearGradient(0, WATER_Y, 0, SEA[1]);
    g.addColorStop(0, mix(water, '#ffffff', 0.32));
    g.addColorStop(0.18, mix(water, '#ffffff', 0.12));
    g.addColorStop(0.6, water);
    g.addColorStop(1, shade(water, -0.2));
    ctx.fillStyle = g; ctx.fillRect(0, WATER_Y, W, SEA[1] - WATER_Y);
    // reflection of the pale wall just below it
    ctx.fillStyle = 'rgba(255,255,255,0.16)'; ctx.fillRect(0, WATER_Y, W, 8);
    // gentle darker swell bands
    for (let i = 0; i < 30; i++) {
      const y = WATER_Y + 20 + rnd() * (SEA[1] - WATER_Y - 20);
      const k = (y - WATER_Y) / (SEA[1] - WATER_Y);
      const len = 80 + rnd() * 220;
      ctx.fillStyle = rgba(shade(water, -0.3), 0.1 + k * 0.08);
      rr(ctx, rnd() * W - len / 2, y, len, 3 + k * 4, 3); ctx.fill();
    }
    for (let i = 0; i < 26; i++) {
      const y = WATER_Y + 14 + rnd() * (SEA[1] - WATER_Y - 14);
      const len = 30 + rnd() * 90;
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      rr(ctx, rnd() * W - len / 2, y, len, 2.5, 2); ctx.fill();
    }
  }

  function waveStrip(scale, P, h, arcs, lw, col, shadowCol) {
    const w = W + P;
    return makeSprite(scale, w, h, 0, h / 2, (ctx) => {
      for (let k = 0; k * P < w + P; k++) {
        for (const a of arcs) {
          const x = k * P + a.x, y = a.y;
          ctx.beginPath(); ctx.moveTo(x - a.w / 2, y + 3); ctx.quadraticCurveTo(x, y - a.h + 3, x + a.w / 2, y + 3);
          stroke(ctx, lw + 1, shadowCol);
          ctx.beginPath(); ctx.moveTo(x - a.w / 2, y); ctx.quadraticCurveTo(x, y - a.h, x + a.w / 2, y);
          stroke(ctx, lw, col);
        }
      }
    });
  }
  function foamStrip(scale, P) {
    const w = W + P;
    return makeSprite(scale, w, 20, 0, 4, (ctx) => {
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      for (let x = 0; x < w + P; x += P) {
        for (let i = 0; i < 4; i++) { ell(ctx, x + i * P / 4 + 6, 1, P / 8 + 2, 4 + (i % 2) * 1.5); ctx.fill(); }
      }
      ctx.fillRect(0, -4, w, 5);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      for (let x = 0; x < w + P; x += P) {
        circle(ctx, x + 10, 9, 2.2); ctx.fill(); circle(ctx, x + 30, 11, 1.6); ctx.fill(); circle(ctx, x + 46, 8, 1.8); ctx.fill();
      }
    });
  }

  function buildSeaSprites(bd, st, scale, rnd) {
    const water = st.waterColor;
    const rows = [
      { y: 978, P: 384, h: 30, n: 3, aw: [26, 40], ah: [5, 7], lw: 3, speed: 9, dir: 1, alpha: 0.7, bobA: 1.5, bobF: 1.1 },
      { y: 1012, P: 480, h: 36, n: 3, aw: [36, 56], ah: [6, 9], lw: 3.6, speed: 13, dir: -1, alpha: 0.75, bobA: 2, bobF: 0.9 },
      { y: 1052, P: 640, h: 44, n: 3, aw: [48, 76], ah: [8, 12], lw: 4.4, speed: 18, dir: 1, alpha: 0.8, bobA: 2.6, bobF: 0.75 },
    ];
    bd.waveRows = rows.map((r) => {
      const arcs = [];
      for (let i = 0; i < r.n; i++) arcs.push({ x: (i + 0.2 + rnd() * 0.6) * r.P / r.n, y: (rnd() - 0.5) * 8, w: r.aw[0] + rnd() * (r.aw[1] - r.aw[0]), h: r.ah[0] + rnd() * (r.ah[1] - r.ah[0]) });
      return Object.assign({}, r, { sp: waveStrip(scale, r.P, r.h, arcs, r.lw, 'rgba(255,255,255,0.9)', rgba(shade(water, -0.35), 0.5)), ph: rnd() * TAU });
    });
    bd.foam = { sp: foamStrip(scale, 64), P: 64 };
    bd.sparkle = sparkleSprite(scale, 9);
    bd.dash = dashSprite(scale);
    bd.puff = puffSprite(scale);
    bd.fgSparkles = [];
    for (let i = 0; i < 12; i++) bd.fgSparkles.push({ x: 60 + rnd() * (W - 120), y: 962 + rnd() * 110, ph: rnd() * TAU, f: 1.3 + rnd() * 1.6, s: 0.6 + rnd() * 0.7 });
    bd.baySparkles = [];
    const bx0 = st.bay.x0, bx1 = st.bay.x1;
    for (let i = 0; i < 16; i++) {
      const nearSun = i < 7;
      const x = nearSun ? M.clamp(bd.pal.sunX + (rnd() - 0.5) * 160, bx0 + 10, bx1 - 10) : bx0 + 10 + rnd() * (bx1 - bx0 - 20);
      const y = nearSun ? HZ + 6 + rnd() * 70 : HZ + 20 + rnd() * (QUAY_Y0 - HZ - 30);
      bd.baySparkles.push({ x, y, ph: rnd() * TAU, f: 1 + rnd() * 1.8, s: 0.5 + (y - HZ) / 260 });
    }
  }

  function buildBoats(bd, st, scale) {
    const S = scale;
    const yachtA = yachtSprite(S, 0.62, '#ffffff', '#3a86ff', '#2b5fae');
    const yachtB = yachtSprite(S, 0.82, '#fff8ea', '#e85d5d', '#e85d5d');
    const yachtC = yachtSprite(S, 1.0, '#ffffff', '#2ec27e', '#1d6b80');
    const fishA = fishingBoatSprite(S, 0.62, '#3a86ff', '#ffffff', '#e85d5d', { lw: 2.2 });
    const fishB = fishingBoatSprite(S, 0.75, '#e85d5d', '#ffffff', '#3a86ff', { lw: 2.3, flag: '#3a86ff' });
    const dinghy = dinghySprite(S, 0.9, '#ff9f43');
    const lists = {
      oban: [
        { sp: yachtA, x: 1872, y: 404 }, { sp: yachtA, x: 1664, y: 398 },
        { sp: fishA, x: 1480, y: 462 }, { sp: yachtB, x: 1858, y: 520 }, { sp: dinghy, x: 1488, y: 540 },
      ],
      largs: [
        { sp: yachtA, x: 70, y: 398 }, { sp: yachtA, x: 214, y: 410 },
        { sp: fishB, x: 140, y: 470 }, { sp: yachtC, x: 400, y: 515 }, { sp: dinghy, x: 250, y: 541 },
      ],
    };
    let list = lists[st.id];
    if (!list) {
      const b0 = st.bay.x0, b1 = st.bay.x1;
      list = [{ sp: yachtA, x: b0 + (b1 - b0) * 0.3, y: 410 }, { sp: fishA, x: b0 + (b1 - b0) * 0.7, y: 480 }];
    }
    bd.bayBoats = list.map((b, i) => Object.assign({ ph: i * 1.7 + 0.4, f: 0.9 + (i % 3) * 0.23 }, b));
    // ferry
    const right = st.ferrySide !== 'left';
    const big = st.id !== 'largs';
    const sp = ferrySprite(S, big, right ? -1 : 1);
    const L = big ? 560 : 340;
    let dockX, offX, wl;
    if (right) { dockX = st.bay.x0 + (big ? 34 : 60); offX = W + 30; wl = big ? 446 : 470; }
    else { dockX = st.bay.x1 - (big ? 120 : 150); offX = -30; wl = big ? 446 : 470; }
    bd.ferry = { sp, dockX, offX, wl, L, dir: right ? -1 : 1, prev: 0, vel: 0, lastT: null, foam: foamSprite(S) };
    // foreground boats
    const fgA = (flip) => fishingBoatSprite(S, 1.25, '#ffbe0b', '#e85d5d', '#2ec27e', { lw: 3.6, flag: '#ff4d6d', number: 'OB 7', flip });
    const fgB = (flip) => fishingBoatSprite(S, 1.1, '#2ec27e', '#ffffff', '#ff4d6d', { lw: 3.4, flag: '#3a86ff', number: 'LK 12', flip });
    const fg = {
      oban: () => [{ sp: fgA(false), x: 170, y: 1088, ph: 0.3 }, { sp: fgB(true), x: 1760, y: 1092, ph: 2.1 }],
      largs: () => [{ sp: fgB(false), x: 860, y: 1094, ph: 1.2 }, { sp: fgA(true), x: 1790, y: 1088, ph: 2.6 }],
    };
    bd.fgBoats = fg[st.id] ? fg[st.id]() : [{ sp: fgA(false), x: 200, y: 1088, ph: 0.3 }];
  }

  // =========================================================================
  // PUBLIC API
  // =========================================================================
  function build(stage, scale) {
    const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    scale = M.clamp(scale || 1, 0.5, 3);
    const st = stage;
    const pal = makePalette(st);
    const rnd = rng(hashStr(st.id || 'stage'));
    const bd = { stage: st, scale, pal };
    bd.sky = makeLayer(scale, SKY[0], SKY[1]);
    renderSky(bd.sky, st, pal, false);
    bd.skyRain = makeLayer(scale, SKY[0], SKY[1]);
    renderSky(bd.skyRain, st, pal, true);
    buildClouds(bd, st, scale, rnd);
    bd.far = makeLayer(scale, FAR[0], FAR[1]);
    renderFar(bd.far, st, pal, rnd);
    buildBoats(bd, st, scale);
    bd.near = makeLayer(scale, NEAR[0], NEAR[1]);
    bd.wet = makeLayer(scale, FACADE_Y, SEAWALL_Y);
    renderNear(bd);
    bd.sea = makeLayer(scale, SEA[0], SEA[1]);
    renderSea(bd.sea, st, pal, rnd);
    buildSeaSprites(bd, st, scale, rnd);
    // perch segments along every eave (handy for gameplay)
    bd.perches = st.shops.map((s) => ({ x0: s.x0 - 8, x1: s.x1 + 8, y: s.roofY }));
    bd.horizonY = HZ;
    // If web fonts were still loading, signs were drawn with a fallback font:
    // repaint the shopfront layer once they arrive.
    try {
      if (typeof document !== 'undefined' && document.fonts && document.fonts.status === 'loading') {
        document.fonts.ready.then(() => { renderNear(bd); });
      }
    } catch (e) { /* ignore */ }
    bd.buildMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
    return bd;
  }

  function drawBack(ctx, bd, t, state) {
    if (!bd) return;
    t = t || 0;
    const ferryV = state && state.ferry ? M.clamp(state.ferry, 0, 1) : 0;
    const rain = state && state.rain ? M.clamp(state.rain, 0, 1) : 0;
    const sunny = 1 - rain;
    ctx.save();
    const A0 = ctx.globalAlpha;
    ctx.globalCompositeOperation = 'source-over';

    // ---- sky
    blitLayer(ctx, bd.sky);
    if (rain > 0.001) { ctx.globalAlpha = A0 * (rain); blitLayer(ctx, bd.skyRain); ctx.globalAlpha = A0; }
    // ---- clouds
    for (const c of bd.clouds) {
      const span = W + c.sp.w + 120;
      const x = ((c.x0 + t * c.v) % span + span) % span - c.sp.w - 60;
      if (sunny > 0.001) { ctx.globalAlpha = A0 * (sunny); ctx.drawImage(c.sp.c, x, c.y, c.sp.w, c.sp.h); }
      if (rain > 0.001) { ctx.globalAlpha = A0 * (rain); ctx.drawImage(c.spRain.c, x - 6, c.y - 4, c.spRain.w, c.spRain.h); }
    }
    ctx.globalAlpha = A0;
    // ---- far layer (hills, islands, landmark, bay water)
    blitLayer(ctx, bd.far);
    // ---- bay details
    if (sunny > 0.05) {
      for (const s of bd.baySparkles) {
        const a = Math.sin(t * s.f + s.ph);
        if (a <= 0.2) continue;
        ctx.globalAlpha = A0 * ((a - 0.2) * 1.2 * sunny);
        const k = s.s * (0.7 + a * 0.4);
        ctx.drawImage(bd.dash.c, s.x - 15 * k, s.y - 4 * k, 30 * k, 8 * k);
      }
      ctx.globalAlpha = A0;
    }
    const F = bd.ferry;
    // ferry motion (for wake)
    if (F.lastT != null && t > F.lastT) {
      const v = Math.abs(ferryV - F.prev) / (t - F.lastT);
      F.vel += (v - F.vel) * 0.15;
    } else if (F.lastT == null) F.vel = 0;
    F.prev = ferryV; F.lastT = t;
    const drawBoat = (b) => {
      const bob = Math.sin(t * b.f * 1.6 + b.ph) * 1.6;
      const rot = Math.sin(t * b.f * 1.2 + b.ph * 1.3) * 0.035;
      ctx.save(); ctx.translate(b.x, b.y + bob); ctx.rotate(rot);
      ctx.drawImage(b.sp.c, -b.sp.ox, -b.sp.oy, b.sp.w, b.sp.h);
      ctx.restore();
    };
    for (const b of bd.bayBoats) if (b.y <= F.wl) drawBoat(b);
    if (ferryV > 0.001) {
      const e = 1 - Math.pow(1 - ferryV, 2.4);
      const x = F.offX + (F.dockX - F.offX) * e;
      const bob = Math.sin(t * 1.1) * 2;   // big ship: a gentle heave only (no roll)
      ctx.save();
      ctx.translate(x, F.wl + bob);
      ctx.drawImage(F.sp.c, -F.sp.ox, -F.sp.oy, F.sp.w, F.sp.h);
      // bow wave + wake while moving
      const wake = M.clamp(F.vel * 2.2, 0, 1) * Math.min(1, ferryV * 6);
      if (wake > 0.02) {
        ctx.globalAlpha = A0 * (wake);
        const bowX = F.dir < 0 ? 10 : -10;
        ctx.drawImage(F.foam.c, bowX - F.foam.ox, -F.foam.oy + 2, F.foam.w, F.foam.h);
        const sternX = F.dir < 0 ? F.L + 20 : -F.L - 20;
        ctx.drawImage(F.foam.c, sternX - F.foam.ox * 1.4, -F.foam.oy + 2, F.foam.w * 1.4, F.foam.h);
        ctx.globalAlpha = A0;
      }
      ctx.restore();
    }
    for (const b of bd.bayBoats) if (b.y > F.wl) drawBoat(b);
    // rain dims the whole distance
    if (rain > 0.001) {
      ctx.fillStyle = `rgba(52,62,84,${(0.3 * rain).toFixed(3)})`;
      ctx.fillRect(0, 0, W, FAR[1]);
    }

    // ---- near layer: shopfronts, promenade, sea wall
    blitLayer(ctx, bd.near);
    // arcade bulbs chase
    if (bd.bulbFrames) {
      const f = bd.bulbFrames[Math.floor(t * 6) % 3];
      ctx.drawImage(f.c, f.x, f.y, f.w, f.h);
    }
    // neon flicker
    if (bd.neon) {
      let a = 0.75 + 0.25 * Math.sin(t * 2.3);
      const fl = (t * 0.37) % 7;
      if (fl > 6.6 && fl < 6.75) a *= 0.25;
      ctx.globalAlpha = A0 * (a);
      blit(ctx, bd.neon, bd.neon.x, bd.neon.y);
      ctx.globalAlpha = A0;
    }
    // chimney smoke (a wisp or two)
    if (bd.chimneys && bd.chimneys.length) {
      const list = [bd.chimneys[0]];
      const small = bd.chimneys.find((c) => c.small);
      if (small) list.push(small);
      for (let ci = 0; ci < list.length; ci++) {
        const c = list[ci];
        for (let k = 0; k < 4; k++) {
          const p = ((t * 0.22 + k / 4 + ci * 0.13) % 1);
          const r = (c.small ? 5 : 7) + p * (c.small ? 12 : 18);
          const px = c.x + p * 34 + Math.sin(t * 1.3 + k * 2) * 3;
          const py = c.y - p * 70;
          ctx.globalAlpha = A0 * (0.55 * Math.sin(p * Math.PI) * (0.6 + 0.4 * sunny));
          ctx.drawImage(bd.puff.c, px - r, py - r, r * 2, r * 2);
        }
      }
      ctx.globalAlpha = A0;
    }
    if (rain > 0.001) {
      ctx.globalAlpha = A0 * (rain);
      blitLayer(ctx, bd.wet);
      ctx.globalAlpha = A0;
      ctx.fillStyle = `rgba(40,50,72,${(0.16 * rain).toFixed(3)})`;
      ctx.fillRect(0, NEAR[0], W, NEAR[1] - NEAR[0]);
    }

    // ---- foreground sea
    blitLayer(ctx, bd.sea);
    for (const r of bd.waveRows) {
      const off = ((t * r.speed) % r.P + r.P) % r.P;
      const x = r.dir > 0 ? off - r.P : -off;
      const y = r.y + Math.sin(t * r.bobF + r.ph) * r.bobA;
      ctx.globalAlpha = A0 * (r.alpha * (1 - rain * 0.35));
      ctx.drawImage(r.sp.c, x, y - r.sp.oy, r.sp.w, r.sp.h);
    }
    ctx.globalAlpha = A0;
    {
      const P = bd.foam.P;
      const off = (t * 8) % P;
      ctx.globalAlpha = A0 * (0.85 + Math.sin(t * 1.7) * 0.1);
      ctx.drawImage(bd.foam.sp.c, -off, WATER_Y - bd.foam.sp.oy + 1 + Math.sin(t * 1.4) * 1.2, bd.foam.sp.w, bd.foam.sp.h);
      ctx.globalAlpha = A0;
    }
    if (sunny > 0.05) {
      for (const s of bd.fgSparkles) {
        const a = Math.sin(t * s.f + s.ph);
        if (a <= 0.35) continue;
        const k = s.s * (a - 0.35) / 0.65;
        ctx.globalAlpha = A0 * (k * sunny);
        const sz = bd.sparkle.w * (0.5 + k * 0.7);
        ctx.drawImage(bd.sparkle.c, s.x - sz / 2, s.y - sz / 2, sz, sz);
      }
      ctx.globalAlpha = A0;
    }
    for (const b of bd.fgBoats) {
      const bob = Math.sin(t * 1.25 + b.ph) * 3;
      const rot = Math.sin(t * 0.95 + b.ph * 1.7) * 0.03;
      ctx.save();
      ctx.translate(b.x, b.y + bob);
      ctx.rotate(rot);
      ctx.drawImage(b.sp.c, -b.sp.ox, -b.sp.oy, b.sp.w, b.sp.h);
      ctx.restore();
    }
    if (rain > 0.001) {
      ctx.fillStyle = `rgba(24,40,62,${(0.25 * rain).toFixed(3)})`;
      ctx.fillRect(0, WATER_Y, W, SEA[1] - WATER_Y);
    }
    ctx.restore();
  }

  SG.Backdrop = { build, drawBack, HORIZON_Y: HZ };
})(window.SG = window.SG || {});
