// ---------------------------------------------------------------------------
// UI drawing helpers + in-game HUD.
// ---------------------------------------------------------------------------
(function (SG) {
  'use strict';
  const M = SG.M;
  const UI = {};
  SG.UI = UI;

  UI.COL = { cream: '#fff8e7', teal: '#2bb3a6', yellow: '#ffd23f', red: '#ff4d6d', blue: '#3a86ff', dark: '#2d2a4a', sea: '#1d6f8f' };

  UI.panel = function (ctx, x, y, w, h, opts) {
    opts = opts || {};
    const r = opts.r || 22;
    ctx.save();
    if (opts.alpha !== undefined) ctx.globalAlpha *= opts.alpha;
    if (opts.shadow !== false) { SG.roundRect(ctx, x + 6, y + 8, w, h, r); ctx.fillStyle = 'rgba(29,22,58,0.35)'; ctx.fill(); }
    SG.roundRect(ctx, x, y, w, h, r);
    ctx.fillStyle = opts.fill || UI.COL.cream; ctx.fill();
    if (opts.stripe) {
      ctx.save(); SG.roundRect(ctx, x, y, w, h, r); ctx.clip();
      ctx.fillStyle = opts.stripe; ctx.fillRect(x, y, w, opts.stripeH || 14);
      ctx.restore();
    }
    ctx.lineWidth = opts.lw || 5; ctx.strokeStyle = opts.stroke || SG.INK; ctx.stroke();
    ctx.restore();
  };

  // Vertical menu of pill buttons. items: [{label, sub?}], sel index.
  UI.menu = function (ctx, items, sel, cx, y, t, opts) {
    opts = opts || {};
    const w = opts.w || 520, h = opts.h || 78, gap = opts.gap || 18;
    items.forEach((it, i) => {
      const on = i === sel;
      const bounce = on ? 1 + Math.sin(t * 6) * 0.02 : 1;
      const yy = y + i * (h + gap);
      ctx.save();
      ctx.translate(cx, yy + h / 2);
      ctx.scale(bounce * (on ? 1.06 : 1), bounce * (on ? 1.06 : 1));
      UI.panel(ctx, -w / 2, -h / 2, w, h, { r: h / 2, fill: on ? UI.COL.yellow : UI.COL.cream, lw: on ? 6 : 5, alpha: it.disabled ? 0.5 : 1 });
      SG.text(ctx, it.label, 0, it.value !== undefined ? -2 : 2, { size: opts.size || 40, font: SG.FONT_TITLE, weight: 400, color: on ? SG.INK : '#5a5478', stroke: false });
      if (it.value !== undefined) {
        ctx.font = `700 30px ${SG.FONT}`;
      }
      ctx.restore();
      if (on && !opts.noPointer) {
        // little gull pointer
        SG.Art.gull(ctx, { x: cx - w / 2 - 54, y: yy + h / 2 + 26, s: 0.9, facing: 1, pose: 'idle', t, color: UI.COL.red, hat: 'tam', beakOpen: Math.sin(t * 3) > 0.7 });
      }
    });
  };

  // Settings-style rows: [{label, value}], with arrows on the selected row.
  UI.rows = function (ctx, rows, sel, cx, y, t, opts) {
    opts = opts || {};
    const w = opts.w || 900, h = opts.h || 64, gap = opts.gap || 12;
    rows.forEach((r, i) => {
      const on = i === sel;
      const yy = y + i * (h + gap);
      UI.panel(ctx, cx - w / 2, yy, w, h, { r: 18, fill: on ? UI.COL.yellow : UI.COL.cream, lw: on ? 6 : 4, shadow: on });
      SG.text(ctx, r.label, cx - w / 2 + 34, yy + h / 2 + 2, { size: 30, align: 'left', color: SG.INK, stroke: false, weight: 700 });
      if (r.value !== undefined) {
        const vx = cx + w / 2 - 170;
        SG.text(ctx, String(r.value), vx, yy + h / 2 + 2, { size: 30, color: SG.INK, stroke: false, weight: 700 });
        if (on) {
          const k = Math.sin(t * 8) * 4;
          SG.text(ctx, '◀', vx - 120 - k, yy + h / 2 + 2, { size: 26, color: SG.INK, stroke: false });
          SG.text(ctx, '▶', vx + 120 + k, yy + h / 2 + 2, { size: 26, color: SG.INK, stroke: false });
        }
      }
    });
  };

  UI.logo = function (ctx, cx, cy, t, scale) {
    scale = scale || 1;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    const word = 'SCRAN!';
    ctx.font = `400 210px ${SG.FONT_TITLE}`;
    const widths = word.split('').map((c) => ctx.measureText(c).width);
    const total = widths.reduce((a, b) => a + b, 0) + 10 * (word.length - 1);
    let x = -total / 2;
    const cols = ['#ffd23f', '#ff9f43', '#ff4d6d', '#3a86ff', '#2ec27e', '#ffd23f'];
    word.split('').forEach((c, i) => {
      const wob = Math.sin(t * 3 + i * 0.7);
      ctx.save();
      ctx.translate(x + widths[i] / 2, wob * 8);
      ctx.rotate(wob * 0.04 + (i % 2 ? 0.03 : -0.03));
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 34; ctx.strokeStyle = SG.INK; ctx.strokeText(c, 6, 10);
      ctx.fillStyle = SG.INK; ctx.fillText(c, 6, 10);
      ctx.lineWidth = 22; ctx.strokeStyle = '#ffffff'; ctx.strokeText(c, 0, 0);
      ctx.lineWidth = 10; ctx.strokeStyle = SG.INK; ctx.strokeText(c, 0, 0);
      ctx.fillStyle = cols[i]; ctx.fillText(c, 0, 0);
      ctx.save(); ctx.globalAlpha = 0.35; ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.rect(-80, -90, 160, 50); ctx.clip(); ctx.fillText(c, 0, 0); ctx.restore();
      ctx.restore();
      x += widths[i] + 10;
    });
    // a gull perched on the exclamation mark, clutching a chip
    SG.Art.gull(ctx, { x: total / 2 - widths[5] / 2 + 6, y: -96 + Math.sin(t * 3 + 3.5) * 8, s: 1.6, facing: -1, pose: 'idle', t, color: '#ff4d6d', hat: 'tam', carry: 'chip', blink: Math.sin(t * 1.3) > 0.97 });
    // ribbon
    const rw = 880, rh = 74, ry = 140;
    ctx.save();
    ctx.translate(0, ry);
    ctx.rotate(-0.02);
    for (const s of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(s * rw / 2, -rh / 2 + 16); ctx.lineTo(s * (rw / 2 + 70), -rh / 2 + 16); ctx.lineTo(s * (rw / 2 + 44), 16); ctx.lineTo(s * (rw / 2 + 70), rh / 2 + 16); ctx.lineTo(s * rw / 2, rh / 2 + 16); ctx.closePath();
      ctx.fillStyle = '#b3123a'; ctx.fill(); ctx.lineWidth = 5; ctx.strokeStyle = SG.INK; ctx.stroke();
    }
    SG.roundRect(ctx, -rw / 2, -rh / 2, rw, rh, 10);
    ctx.fillStyle = '#ff4d6d'; ctx.fill(); ctx.lineWidth = 6; ctx.strokeStyle = SG.INK; ctx.stroke();
    SG.text(ctx, 'THE GREAT SEASIDE CHIP HEIST', 0, 4, { size: 44, font: SG.FONT_TITLE, weight: 400, color: '#fff' });
    ctx.restore();
    ctx.restore();
  };

  UI.fadeOverlay = function (ctx, a, color) {
    ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = color || '#1d1640'; ctx.fillRect(0, 0, SG.W, SG.H); ctx.restore();
  };

  UI.hint = function (ctx, text, x, y, opts) {
    opts = opts || {};
    ctx.save();
    ctx.font = `700 ${opts.size || 24}px ${SG.FONT}`;
    const w = ctx.measureText(text).width + 40;
    const h = (opts.size || 24) * 1.7;
    const bx = opts.align === 'left' ? x : opts.align === 'right' ? x - w : x - w / 2;
    SG.roundRect(ctx, bx, y - h / 2, w, h, h / 2);
    ctx.fillStyle = opts.fill || 'rgba(29,22,64,0.78)'; ctx.fill();
    ctx.fillStyle = opts.color || '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, bx + w / 2, y + 1);
    ctx.restore();
  };

  // Confetti for celebrations.
  UI.confetti = {
    parts: [],
    burst(n) {
      const cols = ['#ff4d6d', '#ffd23f', '#3a86ff', '#2ec27e', '#ff9f43', '#ffffff', '#a06cff'];
      for (let i = 0; i < n; i++) this.parts.push({ x: M.rand(0, SG.W), y: M.rand(-400, -10), vx: M.rand(-60, 60), vy: M.rand(120, 300), r: M.rand(0, 6), vr: M.rand(-8, 8), w: M.rand(10, 18), h: M.rand(6, 10), c: M.pick(cols) });
    },
    update(dt) {
      for (const p of this.parts) { p.x += p.vx * dt + Math.sin(p.y * 0.02) * 40 * dt; p.y += p.vy * dt; p.r += p.vr * dt; }
      this.parts = this.parts.filter((p) => p.y < SG.H + 40);
    },
    draw(ctx) {
      for (const p of this.parts) {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.scale(1, Math.cos(p.r * 1.3));
        ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
    },
  };

  // ------------------------------------------------------------------ HUD
  UI.CARD_X = [24, 352, SG.W - 344 - 328, SG.W - 344];
  UI.CARD_W = 320;

  UI.hud = function (ctx, world, session, t) {
    const gulls = world.gulls;
    // timer
    const tl = Math.max(0, world.timeLeft);
    const mm = Math.floor(Math.ceil(tl) / 60), ss = Math.ceil(tl) % 60;
    const timeStr = mm + ':' + (ss < 10 ? '0' : '') + ss;
    const urgent = tl <= 10 && world.phase === 'play';
    const tw = 200, th = 92;
    ctx.save();
    ctx.translate(SG.W / 2, 16 + th / 2);
    if (urgent) { const k = 1 + Math.max(0, Math.sin(t * Math.PI * 2)) * 0.08; ctx.scale(k, k); }
    const tp = SG.sprite('hud:timer:' + world.frenzy, tw + 12, th + 12, (c) => UI.panel(c, 0, 0, tw, th, { fill: world.frenzy ? '#ffd23f' : '#ffffff', r: 26 }));
    ctx.drawImage(tp, -tw / 2, -th / 2, tw + 12, th + 12);
    ctx.font = `400 56px ${SG.FONT_TITLE}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = urgent ? '#ff4d6d' : SG.INK; ctx.fillText(timeStr, 0, 4);
    ctx.restore();
    if (world.frenzy) {
      ctx.save(); ctx.translate(SG.W / 2 + 104, 30); ctx.rotate(0.2 + Math.sin(t * 8) * 0.08);
      UI.panel(ctx, -36, -22, 72, 44, { fill: '#ff4d6d', r: 22, lw: 4, shadow: false });
      SG.text(ctx, 'x2', 0, 2, { size: 30, font: SG.FONT_TITLE, weight: 400 });
      ctx.restore();
    }
    if (session && session.rounds > 1) SG.text(ctx, `ROUND ${session.round} / ${session.rounds}`, SG.W / 2, 128, { size: 20, color: '#fff', weight: 700 });

    // player cards
    const order = [0, 1, 2, 3];
    for (const slot of order) {
      const g = gulls.find((gg) => gg.slot === slot);
      if (!g) continue;
      const x = UI.CARD_X[slot], y = 14, w = UI.CARD_W, h = 104;
      const label = (g.cpu ? 'CPU ' : 'P' + (slot + 1) + ' ') + g.name;
      const bg = SG.sprite('hud:card:' + slot + ':' + g.color + ':' + label, w + 12, h + 12, (c) => {
        UI.panel(c, 0, 0, w, h, { fill: '#ffffff', stripe: g.color, stripeH: h, r: 24 });
        SG.roundRect(c, 96, 10, w - 106, h - 20, 16); c.fillStyle = 'rgba(255,255,255,0.92)'; c.fill();
        c.beginPath(); c.arc(52, h / 2, 40, 0, Math.PI * 2); c.fillStyle = SG.shade(g.color, 0.35); c.fill();
        SG.text(c, label, 108, 28, { size: 19, align: 'left', color: SG.INK, stroke: false, weight: 700 });
      });
      ctx.drawImage(bg, x, y, w + 12, h + 12);
      // gull portrait
      ctx.save();
      ctx.beginPath(); ctx.arc(x + 52, y + h / 2, 40, 0, Math.PI * 2);
      ctx.clip();
      SG.Art.gull(ctx, { x: x + 40, y: y + h / 2 + 52, s: 1.15, facing: 1, pose: 'idle', t, color: g.color, hat: g.hat, carry: g.carry ? g.carry.type : null, stun: g.stunT > 0, splat: g.splatT > 0, beakOpen: g.beakOpenT > 0 || g.eating });
      ctx.restore();
      ctx.beginPath(); ctx.arc(x + 52, y + h / 2, 40, 0, Math.PI * 2); ctx.lineWidth = 4; ctx.strokeStyle = SG.INK; ctx.stroke();
      // score
      const pop = g.scorePop || 0;
      SG.text(ctx, String(g.score), x + 108, y + 70, { size: 46 + pop * 10, align: 'left', font: SG.FONT_TITLE, weight: 400, color: g.dark, stroke: false });
      // poop ammo
      for (let i = 0; i < SG.GULL_TUNING.poopMax; i++) {
        const px = x + w - 30 - i * 28, py = y + 74;
        const on = i < g.poopAmmo;
        const ic = SG.sprite('hud:poop', 28, 30, (c) => SG.Art.poopIcon(c, 14, 17, 10, 1));
        ctx.globalAlpha = on ? 1 : 0.18; ctx.drawImage(ic, px - 14, py - 17, 28, 30); ctx.globalAlpha = 1;
      }
      // round wins
      if (session && session.wins) {
        for (let i = 0; i < session.wins[slot]; i++) {
          const cx = x + w - 28 - i * 30, cy = y + 30;
          ctx.save(); ctx.translate(cx, cy); ctx.scale(0.9, 0.9);
          ctx.beginPath(); ctx.moveTo(-12, 6); ctx.lineTo(-14, -9); ctx.lineTo(-6, -1); ctx.lineTo(0, -12); ctx.lineTo(6, -1); ctx.lineTo(14, -9); ctx.lineTo(12, 6); ctx.closePath();
          SG.Art.fillStroke(ctx, '#ffd23f', 3);
          ctx.restore();
        }
      }
      if (world.leader === g) {
        ctx.save(); ctx.translate(x + 22, y + 12); ctx.rotate(-0.4);
        ctx.beginPath(); ctx.moveTo(-12, 6); ctx.lineTo(-14, -9); ctx.lineTo(-6, -1); ctx.lineTo(0, -12); ctx.lineTo(6, -1); ctx.lineTo(14, -9); ctx.lineTo(12, 6); ctx.closePath();
        SG.Art.fillStroke(ctx, '#ffd23f', 3);
        ctx.restore();
      }
    }

    // event banner
    const b = world.banner;
    if (b) {
      const k = b.t < 0.35 ? M.easeOutBack(b.t / 0.35) : b.t > b.dur - 0.35 ? Math.max(0, (b.dur - b.t) / 0.35) : 1;
      ctx.save();
      ctx.translate(SG.W / 2, 250);
      ctx.scale(k, k);
      ctx.rotate(-0.03);
      UI.panel(ctx, -460, -70, 920, 140, { fill: b.frenzy ? '#ffd23f' : '#ffffff', stripe: b.frenzy ? '#ff4d6d' : '#2bb3a6', stripeH: 22, r: 30 });
      SG.text(ctx, b.title, 0, -8, { size: 66, font: SG.FONT_TITLE, weight: 400, color: b.frenzy ? '#ff4d6d' : '#ffd23f' });
      SG.text(ctx, b.sub, 0, 46, { size: 28, color: SG.INK, stroke: false, weight: 700 });
      ctx.restore();
    }

    // countdown
    if (world.phase === 'intro') {
      const n = Math.ceil(3 - world.introT);
      const f = 1 - ((3 - world.introT) % 1);
      const s = 1 + (1 - f) * 0.0 + M.easeOutBack(Math.min(1, f * 3)) * 0.3;
      ctx.save(); ctx.translate(SG.W / 2, SG.H / 2 - 40); ctx.scale(s, s);
      SG.text(ctx, String(n), 0, 0, { size: 220, font: SG.FONT_TITLE, weight: 400, color: '#ffd23f', strokeWidth: 26 });
      ctx.restore();
      SG.text(ctx, 'GET READY TAE SCRAN!', SG.W / 2, SG.H / 2 + 110, { size: 40, font: SG.FONT_TITLE, weight: 400 });
    } else if (world.goT !== undefined && world.goT < 1.1 && world.phase === 'play') {
      const k = world.goT / 1.1;
      ctx.save(); ctx.translate(SG.W / 2, SG.H / 2 - 40); const s = M.easeOutBack(Math.min(1, k * 4)) * (1 + k * 0.4); ctx.scale(s, s); ctx.rotate(-0.05);
      SG.text(ctx, 'SCRAN!', 0, 0, { size: 200, font: SG.FONT_TITLE, weight: 400, color: '#ff4d6d', strokeWidth: 24, alpha: 1 - Math.max(0, k - 0.7) / 0.3 });
      ctx.restore();
    } else if (world.phase === 'over') {
      const k = Math.min(1, world.overT / 0.4);
      ctx.save(); ctx.translate(SG.W / 2, SG.H / 2 - 40); ctx.scale(M.easeOutBack(k), M.easeOutBack(k)); ctx.rotate(0.04);
      SG.text(ctx, 'TIME’S UP!', 0, 0, { size: 170, font: SG.FONT_TITLE, weight: 400, color: '#ffd23f', strokeWidth: 22 });
      ctx.restore();
    }
  };
})(window.SG);
