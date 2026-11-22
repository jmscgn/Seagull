// ---------------------------------------------------------------------------
// Procedural cartoon art: gulls, people, shopkeepers, dog, food, props, FX.
// Every draw function works in logical 1920x1080 coordinates and receives the
// screen-space anchor (usually the feet / ground contact point).
// ---------------------------------------------------------------------------
(function (SG) {
  'use strict';
  const INK = SG.INK;
  const TAU = Math.PI * 2;
  const A = {};
  SG.Art = A;

  // ---- small helpers ------------------------------------------------------
  function fillStroke(ctx, fill, lw) {
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (lw !== 0) { ctx.lineWidth = lw || 3; ctx.strokeStyle = INK; ctx.stroke(); }
  }
  function circle(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); }
  function ellipse(ctx, x, y, rx, ry, rot) { ctx.beginPath(); ctx.ellipse(x, y, Math.abs(rx), Math.abs(ry), rot || 0, 0, TAU); }
  A.circle = circle; A.ellipse = ellipse; A.fillStroke = fillStroke;

  A.shadow = function (ctx, x, y, rx, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha === undefined ? 0.22 : alpha;
    ctx.fillStyle = '#1b1530';
    ellipse(ctx, x, y, rx, rx * 0.32);
    ctx.fill();
    ctx.restore();
  };

  // =========================================================================
  // GULL
  // =========================================================================
  const GULL = {
    white: '#ffffff', belly: '#e6ecf5', grey: '#a9b8cc', greyDark: '#8798b0',
    black: '#2a2738', beak: '#ffc93c', beakDark: '#e0a315', spot: '#e8413a', leg: '#f5a173',
  };

  // Wing drawn pointing "up" from the shoulder; `lift` in [-1,1] scales the
  // vertical extent (1 = fully up, -1 = fully down) to fake flapping depth.
  function drawWing(ctx, sx, sy, len, lift, sweep, dark) {
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(sweep || 0);
    const l = Math.max(0.18, Math.abs(lift)) * Math.sign(lift || 1);
    ctx.scale(1, l);
    const g = dark ? GULL.greyDark : GULL.grey;
    // main wing
    ctx.beginPath();
    ctx.moveTo(12, 2);
    ctx.bezierCurveTo(16, -len * 0.45, 4, -len * 0.92, -12, -len);
    ctx.bezierCurveTo(-18, -len * 0.82, -16, -len * 0.62, -24, -len * 0.5);
    ctx.bezierCurveTo(-20, -len * 0.3, -22, -len * 0.15, -16, 4);
    ctx.closePath();
    ctx.fillStyle = g; ctx.fill();
    ctx.save(); ctx.clip();
    // black primaries at the tip
    ctx.fillStyle = GULL.black;
    ctx.beginPath(); ctx.rect(-40, -len * 1.1, 70, len * 0.32); ctx.fill();
    ctx.fillStyle = '#fff';
    circle(ctx, -6, -len * 0.88, 2.6); ctx.fill();
    circle(ctx, 2, -len * 0.84, 2.2); ctx.fill();
    // white trailing edge
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath(); ctx.ellipse(-20, -len * 0.4, 5, len * 0.35, 0.1, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.lineWidth = 3 / Math.max(0.35, Math.abs(l)) * 0.9;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = INK;
    ctx.restore();
    // stroke in un-scaled space for an even line
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(sweep || 0);
    ctx.scale(1, l);
    ctx.beginPath();
    ctx.moveTo(12, 2);
    ctx.bezierCurveTo(16, -len * 0.45, 4, -len * 0.92, -12, -len);
    ctx.bezierCurveTo(-18, -len * 0.82, -16, -len * 0.62, -24, -len * 0.5);
    ctx.bezierCurveTo(-20, -len * 0.3, -22, -len * 0.15, -16, 4);
    ctx.restore();
    ctx.lineWidth = 3;
    ctx.strokeStyle = INK;
    ctx.stroke();
  }

  function drawFoldedWing(ctx) {
    ctx.beginPath();
    ctx.moveTo(14, -40);
    ctx.bezierCurveTo(2, -46, -20, -42, -30, -34);
    ctx.lineTo(-46, -36);
    ctx.lineTo(-40, -28);
    ctx.bezierCurveTo(-26, -22, -2, -22, 12, -30);
    ctx.closePath();
    ctx.fillStyle = GULL.grey; ctx.fill();
    ctx.save(); ctx.clip();
    ctx.fillStyle = GULL.black;
    ctx.beginPath(); ctx.moveTo(-28, -50); ctx.lineTo(-50, -50); ctx.lineTo(-50, -20); ctx.lineTo(-30, -20); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff';
    circle(ctx, -40, -34, 2.2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.beginPath(); ctx.ellipse(-8, -26, 16, 3, -0.08, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.lineJoin = 'round'; ctx.stroke();
  }

  function drawLegs(ctx, mode, t) {
    ctx.strokeStyle = GULL.leg;
    ctx.lineCap = 'round';
    const legs = [];
    if (mode === 'stand') legs.push([-5, 0], [7, 0]);
    else if (mode === 'walk') { const a = Math.sin(t * 14) * 7; legs.push([-4 + a, -Math.max(0, Math.sin(t * 14)) * 4], [6 - a, -Math.max(0, -Math.sin(t * 14)) * 4]); }
    else if (mode === 'run') { const a = Math.sin(t * 26) * 12; legs.push([-2 + a, -Math.max(0, Math.sin(t * 26)) * 8], [6 - a, -Math.max(0, -Math.sin(t * 26)) * 8]); }
    else if (mode === 'tuck') {
      ctx.lineWidth = 6; ctx.strokeStyle = INK;
      ctx.beginPath(); ctx.moveTo(-6, -16); ctx.lineTo(-20, -12); ctx.stroke();
      ctx.lineWidth = 3.4; ctx.strokeStyle = GULL.leg;
      ctx.beginPath(); ctx.moveTo(-6, -16); ctx.lineTo(-20, -12); ctx.stroke();
      return;
    }
    for (const [fx, fy] of legs) {
      ctx.lineWidth = 7; ctx.strokeStyle = INK;
      ctx.beginPath(); ctx.moveTo(fx * 0.4, -16); ctx.lineTo(fx, fy - 1); ctx.stroke();
      ctx.lineWidth = 3.6; ctx.strokeStyle = GULL.leg;
      ctx.beginPath(); ctx.moveTo(fx * 0.4, -16); ctx.lineTo(fx, fy - 1); ctx.stroke();
      // webbed foot
      ctx.beginPath();
      ctx.moveTo(fx - 3, fy); ctx.lineTo(fx + 9, fy + 1); ctx.lineTo(fx + 6, fy - 4); ctx.closePath();
      ctx.fillStyle = GULL.leg; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = INK; ctx.stroke();
    }
  }

  function drawHat(ctx, hat, color, t) {
    // Origin: top of head (head centre is at (17,-49), r 15).
    const hx = 17, hy = -63;
    ctx.lineJoin = 'round';
    switch (hat) {
      case 'tam': {
        ellipse(ctx, hx - 2, hy + 1, 19, 7, -0.15);
        fillStroke(ctx, '#c62f3a', 3);
        ctx.save(); ellipse(ctx, hx - 2, hy + 1, 19, 7, -0.15); ctx.clip();
        ctx.strokeStyle = '#1f5f3a'; ctx.lineWidth = 2.5;
        for (let i = -20; i < 24; i += 8) { ctx.beginPath(); ctx.moveTo(hx + i, hy - 10); ctx.lineTo(hx + i - 6, hy + 10); ctx.stroke(); }
        ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(hx - 22, hy); ctx.lineTo(hx + 18, hy - 4); ctx.stroke();
        ctx.restore();
        ellipse(ctx, hx - 2, hy + 1, 19, 7, -0.15); ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.stroke();
        circle(ctx, hx - 4, hy - 8, 5); fillStroke(ctx, '#e8413a', 2.5);
        break;
      }
      case 'sailor': {
        ctx.beginPath(); ctx.moveTo(hx - 14, hy + 4); ctx.lineTo(hx - 11, hy - 9); ctx.quadraticCurveTo(hx, hy - 14, hx + 11, hy - 9); ctx.lineTo(hx + 14, hy + 4); ctx.closePath();
        fillStroke(ctx, '#ffffff', 3);
        ctx.fillStyle = '#2b4c9b'; ctx.fillRect(hx - 13, hy - 1, 26, 5);
        ctx.beginPath(); ctx.ellipse(hx + 12, hy + 4, 9, 3, 0.15, 0, TAU); fillStroke(ctx, '#1f2340', 2);
        break;
      }
      case 'pirate': {
        ctx.beginPath(); ctx.moveTo(hx - 22, hy + 4); ctx.quadraticCurveTo(hx, hy - 24, hx + 22, hy + 4); ctx.quadraticCurveTo(hx, hy - 2, hx - 22, hy + 4); ctx.closePath();
        fillStroke(ctx, '#272436', 3);
        circle(ctx, hx, hy - 6, 3.4); ctx.fillStyle = '#fff'; ctx.fill();
        ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(hx - 18, hy + 1); ctx.quadraticCurveTo(hx, hy - 6, hx + 18, hy + 1); ctx.stroke();
        break;
      }
      case 'shades': {
        ctx.fillStyle = '#1b1b2b';
        SG.roundRect(ctx, hx - 2, hy + 7, 14, 8, 3); fillStroke(ctx, '#1b1b2b', 2);
        ctx.strokeStyle = INK; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(hx - 2, hy + 10); ctx.lineTo(hx - 14, hy + 8); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillRect(hx + 2, hy + 9, 4, 2);
        break;
      }
      case 'bucket': {
        ctx.beginPath(); ctx.moveTo(hx - 21, hy + 6); ctx.lineTo(hx - 12, hy - 9); ctx.quadraticCurveTo(hx, hy - 13, hx + 12, hy - 9); ctx.lineTo(hx + 21, hy + 6); ctx.quadraticCurveTo(hx, hy + 1, hx - 21, hy + 6); ctx.closePath();
        fillStroke(ctx, '#d9c48c', 3);
        ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(hx - 14, hy - 2); ctx.quadraticCurveTo(hx, hy - 6, hx + 14, hy - 2); ctx.stroke();
        break;
      }
      case 'viking': {
        // horns
        for (const s of [-1, 1]) {
          ctx.beginPath(); ctx.moveTo(hx + s * 10, hy - 2); ctx.quadraticCurveTo(hx + s * 24, hy - 6, hx + s * 22, hy - 22); ctx.quadraticCurveTo(hx + s * 18, hy - 10, hx + s * 6, hy - 8); ctx.closePath();
          fillStroke(ctx, '#f6ead0', 2.5);
        }
        ctx.beginPath(); ctx.moveTo(hx - 15, hy + 5); ctx.quadraticCurveTo(hx - 15, hy - 14, hx, hy - 14); ctx.quadraticCurveTo(hx + 15, hy - 14, hx + 15, hy + 5); ctx.closePath();
        fillStroke(ctx, '#9aa6b5', 3);
        ctx.fillStyle = '#c9a24a'; ctx.fillRect(hx - 15, hy + 1, 30, 4);
        break;
      }
      case 'chef': {
        ctx.beginPath(); ctx.moveTo(hx - 11, hy + 4); ctx.lineTo(hx - 12, hy - 8);
        ctx.arc(hx - 8, hy - 16, 8, Math.PI * 0.8, Math.PI * 1.7); ctx.arc(hx + 2, hy - 21, 9, Math.PI * 1.1, Math.PI * 1.9); ctx.arc(hx + 10, hy - 14, 7, Math.PI * 1.3, Math.PI * 0.3);
        ctx.lineTo(hx + 11, hy + 4); ctx.closePath();
        fillStroke(ctx, '#ffffff', 3);
        break;
      }
      case 'beanie': {
        ctx.beginPath(); ctx.moveTo(hx - 15, hy + 6); ctx.quadraticCurveTo(hx - 15, hy - 14, hx, hy - 14); ctx.quadraticCurveTo(hx + 15, hy - 14, hx + 15, hy + 6); ctx.closePath();
        fillStroke(ctx, color, 3);
        ctx.fillStyle = SG.shade(color, -0.25); ctx.fillRect(hx - 15, hy + 1, 30, 5);
        circle(ctx, hx, hy - 16, 5); fillStroke(ctx, '#ffffff', 2.5);
        break;
      }
      case 'tophat': {
        ellipse(ctx, hx, hy + 4, 18, 4.5); fillStroke(ctx, '#232032', 3);
        ctx.beginPath(); ctx.rect(hx - 10, hy - 22, 20, 26); fillStroke(ctx, '#232032', 3);
        ctx.fillStyle = color; ctx.fillRect(hx - 10, hy - 4, 20, 5);
        break;
      }
      case 'flower': {
        for (let i = 0; i < 5; i++) { const a = i / 5 * TAU + t; circle(ctx, hx - 8 + Math.cos(a) * 6, hy + 2 + Math.sin(a) * 6, 4.5); fillStroke(ctx, '#ff8fc7', 2); }
        circle(ctx, hx - 8, hy + 2, 3.5); fillStroke(ctx, '#ffd23f', 2);
        break;
      }
      case 'crown': {
        ctx.beginPath(); ctx.moveTo(hx - 12, hy + 3); ctx.lineTo(hx - 14, hy - 12); ctx.lineTo(hx - 6, hy - 4); ctx.lineTo(hx, hy - 15); ctx.lineTo(hx + 6, hy - 4); ctx.lineTo(hx + 14, hy - 12); ctx.lineTo(hx + 12, hy + 3); ctx.closePath();
        fillStroke(ctx, '#ffd23f', 3);
        circle(ctx, hx, hy - 2, 2.5); ctx.fillStyle = '#e8413a'; ctx.fill();
        break;
      }
      default: break;
    }
  }
  A.HATS = ['none', 'tam', 'beanie', 'sailor', 'bucket', 'viking', 'pirate', 'shades', 'chef', 'tophat', 'flower'];
  A.HAT_NAMES = { none: 'Bare Heid', tam: 'Tam o’ Shanter', beanie: 'Bobble Hat', sailor: 'Sailor Cap', bucket: 'Bucket Hat', viking: 'Viking Helm', pirate: 'Pirate Hat', shades: 'Cool Shades', chef: 'Chef’s Toque', tophat: 'Top Hat', flower: 'Daisy' };

  // o: {x,y,s,facing,pose,t,flap,color,hat,carry,beakOpen,splat,stun,flash,alpha,tilt,eat,bodyTint}
  A.gull = function (ctx, o) {
    const pose = o.pose || 'idle';
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.scale((o.s || 1) * (o.facing || 1), o.s || 1);
    if (o.alpha !== undefined) ctx.globalAlpha *= o.alpha;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const t = o.t || 0;
    let bob = 0, tilt = o.tilt || 0;
    const flying = pose === 'fly' || pose === 'glide' || pose === 'swoop' || pose === 'hover';
    if (pose === 'idle') bob = Math.sin(t * 3) * 1.2;
    if (pose === 'walk') bob = Math.abs(Math.sin(t * 14)) * -2.5;
    if (pose === 'run') { bob = Math.abs(Math.sin(t * 26)) * -4; tilt += 0.18; }
    if (pose === 'swoop') tilt += 0.55;
    if (pose === 'float') bob = Math.sin(t * 2.4) * 2 + 10;
    if (pose === 'stun') tilt += Math.sin(t * 9) * 0.12;
    if (flying) bob = -12;

    // Legs
    if (pose !== 'float') {
      ctx.save();
      if (flying) { ctx.translate(0, bob); drawLegs(ctx, 'tuck', t); }
      else drawLegs(ctx, pose === 'walk' ? 'walk' : pose === 'run' ? 'run' : 'stand', t);
      ctx.restore();
    }

    ctx.translate(0, bob);
    ctx.translate(0, -26); ctx.rotate(tilt); ctx.translate(0, 26);

    // Wing animation params
    let wingLift = 0, wingMode = 'fold', sweep = -0.25;
    if (pose === 'fly' || pose === 'hover') { wingLift = Math.cos(o.flap || t * 14); wingMode = 'spread'; }
    else if (pose === 'glide') { wingLift = 0.55 + Math.sin(t * 3) * 0.08; wingMode = 'spread'; }
    else if (pose === 'run') { wingLift = 0.85 + Math.sin(t * 30) * 0.15; wingMode = 'spread'; sweep = -0.45; }
    else if (pose === 'swoop') { wingLift = 0.5; wingMode = 'spread'; sweep = -1.25; }
    else if (pose === 'stun') { wingLift = 0.4 + Math.sin(t * 12) * 0.3; wingMode = 'spread'; sweep = -0.8; }

    // Far wing (behind body)
    if (wingMode === 'spread') drawWing(ctx, -6, -40, 50, wingLift, sweep - 0.12, true);

    // Tail
    ctx.beginPath();
    ctx.moveTo(-20, -40); ctx.lineTo(-42, -42); ctx.lineTo(-44, -33); ctx.lineTo(-20, -26); ctx.closePath();
    fillStroke(ctx, GULL.white, 3);
    ctx.fillStyle = GULL.black; ctx.beginPath(); ctx.moveTo(-38, -42); ctx.lineTo(-42.5, -42); ctx.lineTo(-44, -33); ctx.lineTo(-39, -34); ctx.closePath(); ctx.fill();

    // Body
    ellipse(ctx, -2, -32, 28, 19, -0.08);
    ctx.fillStyle = o.bodyTint || GULL.white; ctx.fill();
    ctx.save(); ellipse(ctx, -2, -32, 28, 19, -0.08); ctx.clip();
    ctx.fillStyle = GULL.belly; ellipse(ctx, 0, -14, 30, 10); ctx.fill();
    ctx.restore();
    ellipse(ctx, -2, -32, 28, 19, -0.08); ctx.lineWidth = 3.2; ctx.strokeStyle = INK; ctx.stroke();

    // Folded wing over body
    if (wingMode === 'fold') drawFoldedWing(ctx);

    // Head
    const eatDip = o.eat ? Math.max(0, Math.sin(t * 16)) * 7 : 0;
    ctx.save();
    ctx.translate(0, eatDip);
    circle(ctx, 17, -49, 15.5); fillStroke(ctx, o.bodyTint || GULL.white, 3.2);

    // Scarf in player colour
    if (o.color) {
      ctx.beginPath(); ctx.ellipse(12, -37, 12, 5.5, -0.35, 0, TAU); fillStroke(ctx, o.color, 2.6);
      const flutter = Math.sin(t * (flying || pose === 'run' ? 22 : 5)) * 3;
      ctx.beginPath(); ctx.moveTo(4, -36); ctx.lineTo(-10, -30 + flutter); ctx.lineTo(-8, -24 + flutter); ctx.lineTo(2, -32); ctx.closePath();
      fillStroke(ctx, o.color, 2.4);
    }

    // Beak (lower mandible drops when open)
    const open = o.beakOpen ? 0.42 : 0;
    ctx.save();
    ctx.translate(28, -48); ctx.rotate(open);
    ctx.beginPath(); ctx.moveTo(-2, 0); ctx.lineTo(15, 1); ctx.quadraticCurveTo(18, 2, 14, 5); ctx.lineTo(-2, 5); ctx.closePath();
    fillStroke(ctx, GULL.beakDark, 2.6);
    circle(ctx, 9, 3.4, 2.4); ctx.fillStyle = GULL.spot; ctx.fill();
    ctx.restore();
    ctx.beginPath(); ctx.moveTo(26, -54); ctx.lineTo(42, -50.5); ctx.quadraticCurveTo(48, -49, 44, -45.5); ctx.lineTo(27, -47); ctx.closePath();
    fillStroke(ctx, GULL.beak, 2.8);

    // Eye
    if (o.stun) {
      ctx.strokeStyle = INK; ctx.lineWidth = 2.4;
      ctx.beginPath();
      for (let i = 0; i < 14; i++) { const a = i * 0.9 + t * 10, r = i * 0.45; const px = 21 + Math.cos(a) * r, py = -53 + Math.sin(a) * r; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
      ctx.stroke();
    } else {
      const blink = o.blink ? 0.15 : 1;
      ctx.save(); ctx.translate(21.5, -53); ctx.scale(1, blink);
      circle(ctx, 0, 0, 6.2); fillStroke(ctx, '#ffffff', 2.4);
      circle(ctx, 1.8, 0.4, 3.6); ctx.fillStyle = '#f4d35e'; ctx.fill();
      circle(ctx, 2.2, 0.4, 2.3); ctx.fillStyle = '#16131f'; ctx.fill();
      circle(ctx, 3.2, -1.2, 0.9); ctx.fillStyle = '#fff'; ctx.fill();
      ctx.restore();
      // cheeky brow
      ctx.strokeStyle = INK; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(15, -61); ctx.lineTo(27, -57.5); ctx.stroke();
    }
    // Rosy cheek
    ctx.fillStyle = 'rgba(255,140,160,0.45)'; ellipse(ctx, 19, -43, 4.5, 2.6); ctx.fill();

    // Hat
    if (o.hat && o.hat !== 'none') drawHat(ctx, o.hat, o.color || '#ff4d6d', t);

    // Poop splat on head
    if (o.splat) {
      ctx.beginPath();
      ctx.moveTo(6, -60); ctx.quadraticCurveTo(14, -72, 26, -62); ctx.quadraticCurveTo(30, -56, 25, -55); ctx.quadraticCurveTo(24, -48, 21, -55);
      ctx.quadraticCurveTo(14, -56, 12, -50); ctx.quadraticCurveTo(10, -56, 6, -56); ctx.closePath();
      fillStroke(ctx, '#f4f6e8', 2.2);
      ctx.fillStyle = '#c7cfa6'; circle(ctx, 16, -63, 2.4); ctx.fill();
    }
    // Carried food in beak
    if (o.carry) {
      ctx.save(); ctx.translate(44, -45); ctx.rotate(0.15); ctx.scale(0.62, 0.62);
      A.food(ctx, o.carry, 0, 0, 1, { t });
      ctx.restore();
    }
    ctx.restore(); // head

    // Near wing (in front of body)
    if (wingMode === 'spread') drawWing(ctx, 2, -38, 54, wingLift, sweep, false);

    ctx.restore();

    // Dizzy stars
    if (o.stun) {
      const s = o.s || 1;
      for (let i = 0; i < 3; i++) {
        const a = t * 6 + (i * TAU) / 3;
        A.star(ctx, o.x + (o.facing || 1) * 14 * s + Math.cos(a) * 22 * s, o.y + (-78 + bob) * s + Math.sin(a) * 7 * s, 7 * s, '#ffd23f');
      }
    }
  };

  A.star = function (ctx, x, y, r, color, rot) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot || 0);
    ctx.beginPath();
    for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU - Math.PI / 2; const rr = i % 2 ? r * 0.45 : r; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
    ctx.closePath();
    fillStroke(ctx, color, Math.max(1.5, r * 0.25));
    ctx.restore();
  };

  // =========================================================================
  // PEOPLE
  // =========================================================================
  A.SKIN = ['#f9d9c3', '#efc09e', '#d39a6f', '#a86b45', '#7b4a2e', '#f3c8a8'];
  A.HAIR = ['#3b2a20', '#6b4226', '#d9a441', '#b5452a', '#1e1b1b', '#8a6a4f', '#f0e6d2'];
  A.TOPS = ['#ff6b6b', '#4ecdc4', '#ffd93d', '#5f7dff', '#ff9f43', '#a29bfe', '#55d6a8', '#fd79a8', '#e17055', '#00b894', '#74b9ff'];
  A.BOTTOMS = ['#3d4a7a', '#2d3436', '#5b4b8a', '#636e72', '#2e4a62', '#7a5c3e'];

  // Draws a person. o: {x,y,s,facing(±1),view('front'|'back'),pose,t,look,
  //   kind, skin, hair, hairStyle, top, bottom, hat, food, foodBites, alert, umbrella, mood}
  A.person = function (ctx, o) {
    const s = o.s || 1;
    const hs = o.hs || 1, ws = o.ws || 1;
    const t = o.t || 0;
    const pose = o.pose || 'stand';
    const back = o.view === 'back';
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.scale(s * (o.facing || 1), s);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';

    const walking = pose === 'walk' || pose === 'run';
    const sitting = pose === 'sit';
    const speed = pose === 'run' ? 20 : 11;
    const stride = walking ? Math.sin(t * speed) : 0;
    const bob = walking ? -Math.abs(Math.cos(t * speed)) * 4 : (pose === 'swat' ? Math.sin(t * 30) * 1.5 : 0);

    const legH = 44 * hs, torsoH = 54 * hs, torsoW = 40 * ws, headR = 19 * (0.85 + hs * 0.15);
    const hipY = sitting ? -38 : -legH + bob;

    // ---- legs
    const pants = o.bottom || '#3d4a7a';
    ctx.lineWidth = 3;
    if (sitting) {
      // thighs forward (foreshortened) + shins down
      for (const sx of [-9 * ws, 9 * ws]) {
        SG.roundRect(ctx, sx - 8, hipY - 4, 16, 14, 6); fillStroke(ctx, pants, 3);
        SG.roundRect(ctx, sx - 7, hipY + 6, 14, 34, 6); fillStroke(ctx, pants, 3);
        ellipse(ctx, sx + 2, 0, 10, 5); fillStroke(ctx, '#3a2f2a', 2.5);
      }
    } else if (o.kilt) {
      for (const lx of [-8, 8]) {
        const sw = lx < 0 ? stride : -stride;
        SG.roundRect(ctx, lx - 6 + sw * 6, hipY + 18, 12, legH - 18, 5); fillStroke(ctx, '#f0e6d2', 3);
        ellipse(ctx, lx + sw * 8 + 3, -2, 10, 5); fillStroke(ctx, '#2a2420', 2.5);
      }
    } else {
      for (const lx of [-9 * ws, 9 * ws]) {
        const sw = lx < 0 ? stride : -stride;
        ctx.save();
        ctx.translate(lx, hipY);
        ctx.rotate(sw * 0.45);
        SG.roundRect(ctx, -7.5, 0, 15, legH + 2, 6); fillStroke(ctx, pants, 3);
        ellipse(ctx, 3, legH + 1, 10, 5.5); fillStroke(ctx, o.shoes || '#3a2f2a', 2.5);
        ctx.restore();
      }
    }

    // ---- torso
    const topY = hipY - torsoH;
    const top = o.top || '#ff6b6b';
    ctx.beginPath();
    ctx.moveTo(-torsoW / 2 + 4, topY + 6);
    ctx.quadraticCurveTo(0, topY - 4, torsoW / 2 - 4, topY + 6);
    ctx.lineTo(torsoW / 2 + 2, hipY + 4);
    ctx.quadraticCurveTo(0, hipY + 10, -torsoW / 2 - 2, hipY + 4);
    ctx.closePath();
    fillStroke(ctx, top, 3.2);
    // clothing details
    ctx.save(); ctx.clip();
    if (o.kind === 'fisherman' || o.kind === 'dad') { ctx.fillStyle = SG.shade(top, -0.18); ctx.fillRect(-2, topY, 4, torsoH + 10); }
    if (o.kind === 'tourist') { ctx.fillStyle = 'rgba(255,255,255,0.35)'; for (let i = 0; i < 4; i++) { circle(ctx, -12 + i * 9, topY + 18 + (i % 2) * 14, 3.5); ctx.fill(); } }
    if (o.kind === 'teen') { ctx.fillStyle = SG.shade(top, -0.2); SG.roundRect(ctx, -12, hipY - 22, 24, 14, 5); ctx.fill(); }
    if (o.kind === 'vip') { ctx.fillStyle = '#1f5f3a'; for (let i = -30; i < 30; i += 10) ctx.fillRect(i, topY, 3, torsoH + 10); ctx.fillStyle = '#c62f3a'; for (let i = topY; i < hipY; i += 12) ctx.fillRect(-30, i, 60, 3); }
    if (o.kilt) { ctx.fillStyle = '#1f3f7a'; ctx.fillRect(-30, hipY - 8, 60, 4); }
    ctx.restore();
    if (o.kilt) {
      // kilt skirt
      ctx.beginPath(); ctx.moveTo(-torsoW / 2 - 3, hipY); ctx.lineTo(torsoW / 2 + 3, hipY); ctx.lineTo(torsoW / 2 + 6, hipY + 22); ctx.lineTo(-torsoW / 2 - 6, hipY + 22); ctx.closePath();
      fillStroke(ctx, '#2e6b3f', 3);
      ctx.save(); ctx.clip(); ctx.strokeStyle = '#c62f3a'; ctx.lineWidth = 2;
      for (let i = -30; i < 30; i += 8) { ctx.beginPath(); ctx.moveTo(i, hipY); ctx.lineTo(i, hipY + 24); ctx.stroke(); }
      ctx.strokeStyle = '#1f2a55'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-30, hipY + 11); ctx.lineTo(30, hipY + 11); ctx.stroke();
      ctx.restore();
      // sporran
      SG.roundRect(ctx, -6, hipY + 2, 12, 13, 4); fillStroke(ctx, '#f0e6d2', 2);
    }
    if (o.kind === 'granny' && !back) { SG.roundRect(ctx, torsoW / 2 - 6, hipY - 26, 16, 14, 4); fillStroke(ctx, '#8e3b5d', 2.5); ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(torsoW / 2 + 2, hipY - 26, 6, Math.PI, 0); ctx.stroke(); }
    if (o.kind === 'tourist' && !back) { ctx.strokeStyle = '#2d2a4a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-torsoW / 2 + 6, topY + 4); ctx.lineTo(6, topY + 30); ctx.stroke(); SG.roundRect(ctx, 0, topY + 26, 14, 10, 2); fillStroke(ctx, '#3a3a4a', 2); circle(ctx, 7, topY + 31, 3); ctx.fillStyle = '#9ad'; ctx.fill(); }
    if (back && (o.kind === 'tourist' || o.kind === 'teen')) { SG.roundRect(ctx, -15, topY + 10, 30, 30, 8); fillStroke(ctx, SG.shade(top, -0.3), 3); }

    // ---- head
    const headY = topY - headR + 6;
    const skin = o.skin || '#f3c8a8';
    // neck
    ctx.fillStyle = skin; ctx.fillRect(-5, topY - 6, 10, 8);
    circle(ctx, 0, headY, headR); fillStroke(ctx, skin, 3.2);
    drawHair(ctx, o, headY, headR, back);

    if (!back) drawFace(ctx, o, headY, headR, t);
    drawPersonHat(ctx, o, headY, headR, back);

    // ---- arms & food
    drawArms(ctx, o, topY, hipY, torsoW, back, t);

    ctx.restore();
  };

  function drawHair(ctx, o, hy, r, back) {
    const hair = o.hair || '#3b2a20';
    ctx.fillStyle = hair;
    const st = o.hairStyle || 'short';
    if (st === 'bald') {
      if (back) { ctx.beginPath(); ctx.arc(0, hy + 2, r * 0.95, 0.2, Math.PI - 0.2); ctx.fill(); }
      return;
    }
    if (back) {
      ctx.beginPath(); ctx.arc(0, hy, r, Math.PI * 0.95, Math.PI * 2.05); ctx.lineTo(r * 0.95, hy + r * 0.5); ctx.quadraticCurveTo(0, hy + r * 1.1, -r * 0.95, hy + r * 0.5); ctx.closePath();
      fillStroke(ctx, hair, 3);
      if (st === 'long' || st === 'pony') { SG.roundRect(ctx, -r * 0.7, hy, r * 1.4, r * 1.5, 8); fillStroke(ctx, hair, 3); }
      return;
    }
    if (st === 'curly') {
      for (let i = 0; i < 7; i++) { const a = Math.PI + (i / 6) * Math.PI; circle(ctx, Math.cos(a) * r * 0.9, hy + Math.sin(a) * r * 0.85, r * 0.38); fillStroke(ctx, hair, 2.4); }
      return;
    }
    ctx.beginPath();
    ctx.arc(0, hy, r + 1, Math.PI * 1.02, Math.PI * 1.98);
    if (st === 'long') { ctx.lineTo(r + 2, hy + r * 1.2); ctx.lineTo(r * 0.6, hy + r * 1.2); ctx.lineTo(r * 0.7, hy - r * 0.2); ctx.quadraticCurveTo(0, hy - r * 0.35, -r * 0.5, hy - r * 0.1); ctx.lineTo(-r * 0.75, hy + r * 1.2); ctx.lineTo(-r - 2, hy + r * 1.2); }
    else if (st === 'pony') { ctx.lineTo(r * 0.7, hy - r * 0.25); ctx.quadraticCurveTo(0, hy - r * 0.45, -r * 0.8, hy - r * 0.05); ctx.lineTo(-r - 1, hy); }
    else if (st === 'spiky') { ctx.lineTo(r * 0.8, hy - r * 0.3); for (let i = 0; i < 5; i++) { ctx.lineTo(r * 0.6 - i * r * 0.35, hy - r * (i % 2 ? 0.35 : 0.6)); } ctx.lineTo(-r - 1, hy); }
    else { ctx.lineTo(r * 0.75, hy - r * 0.3); ctx.quadraticCurveTo(0, hy - r * 0.55, -r * 0.85, hy - r * 0.1); ctx.lineTo(-r - 1, hy + r * 0.1); }
    ctx.closePath();
    fillStroke(ctx, hair, 3);
    if (st === 'pony') { ellipse(ctx, -r - 4, hy - 2, 7, 12, -0.4); fillStroke(ctx, hair, 2.5); }
  }

  function drawFace(ctx, o, hy, r, t) {
    const dx = 4; // 3/4 view: features shifted toward facing side
    const mood = o.mood || 'calm';
    const ey = hy - 1;
    ctx.fillStyle = INK; ctx.strokeStyle = INK; ctx.lineWidth = 2.6;
    if (mood === 'disgust') {
      ctx.beginPath(); ctx.moveTo(dx - 9, ey - 2); ctx.lineTo(dx - 4, ey + 1); ctx.moveTo(dx + 4, ey + 1); ctx.lineTo(dx + 9, ey - 2); ctx.stroke();
    } else if (mood === 'cry') {
      ctx.beginPath(); ctx.moveTo(dx - 9, ey); ctx.lineTo(dx - 4, ey); ctx.moveTo(dx + 4, ey); ctx.lineTo(dx + 9, ey); ctx.stroke();
      ctx.fillStyle = '#7ec8ff'; ellipse(ctx, dx - 7, ey + 7 + (t * 20) % 8, 2, 3.5); ctx.fill(); ellipse(ctx, dx + 7, ey + 7 + (t * 20 + 4) % 8, 2, 3.5); ctx.fill();
    } else if (o.phone) {
      ctx.beginPath(); ctx.moveTo(dx - 9, ey + 2); ctx.lineTo(dx - 4, ey + 2); ctx.moveTo(dx + 4, ey + 2); ctx.lineTo(dx + 9, ey + 2); ctx.stroke();
    } else {
      const lx = (o.look || 0) * 1.5;
      circle(ctx, dx - 6.5 + lx, ey, mood === 'shock' ? 3.4 : 2.6); ctx.fill();
      circle(ctx, dx + 6.5 + lx, ey, mood === 'shock' ? 3.4 : 2.6); ctx.fill();
    }
    // brows
    if (mood === 'angry' || mood === 'alert') {
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(dx - 11, ey - 8); ctx.lineTo(dx - 3, ey - 5); ctx.moveTo(dx + 11, ey - 8); ctx.lineTo(dx + 3, ey - 5); ctx.stroke();
    } else if (mood === 'shock') {
      ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.arc(dx - 6.5, ey - 7, 4, Math.PI * 1.15, Math.PI * 1.85); ctx.moveTo(dx + 10.5, ey - 7); ctx.arc(dx + 6.5, ey - 7, 4, Math.PI * 1.85, Math.PI * 1.15, true); ctx.stroke();
    }
    // nose
    ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(dx + 1, ey + 3); ctx.quadraticCurveTo(dx + 5, ey + 7, dx + 1, ey + 8); ctx.stroke();
    // mouth
    const my = hy + r * 0.5;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    if (mood === 'angry') { ctx.moveTo(dx - 6, my + 2); ctx.quadraticCurveTo(dx, my - 3, dx + 6, my + 2); ctx.stroke(); }
    else if (mood === 'shout' || mood === 'shock' || mood === 'cry') { ellipse(ctx, dx, my, 4.5, 5); ctx.fillStyle = '#7a2632'; ctx.fill(); ctx.stroke(); }
    else if (mood === 'disgust') { ctx.moveTo(dx - 6, my); ctx.lineTo(dx - 2, my - 2); ctx.lineTo(dx + 2, my + 1); ctx.lineTo(dx + 6, my - 1); ctx.stroke(); }
    else if (mood === 'eat') { const m = Math.abs(Math.sin(t * 10)) * 4; ellipse(ctx, dx, my, 4, 1 + m); ctx.fillStyle = '#7a2632'; ctx.fill(); ctx.stroke(); }
    else if (mood === 'alert') { ctx.moveTo(dx - 5, my); ctx.lineTo(dx + 5, my); ctx.stroke(); }
    else { ctx.moveTo(dx - 6, my - 1); ctx.quadraticCurveTo(dx, my + 4, dx + 6, my - 1); ctx.stroke(); }
    // cheeks
    ctx.fillStyle = 'rgba(255,120,120,0.28)'; ellipse(ctx, dx - 11, my - 3, 4, 2.5); ctx.fill(); ellipse(ctx, dx + 12, my - 3, 4, 2.5); ctx.fill();
    if (o.glasses) { ctx.lineWidth = 2.2; ctx.strokeStyle = INK; circle(ctx, dx - 6.5, ey, 5); ctx.stroke(); circle(ctx, dx + 6.5, ey, 5); ctx.stroke(); ctx.beginPath(); ctx.moveTo(dx - 1.5, ey); ctx.lineTo(dx + 1.5, ey); ctx.stroke(); }
    if (o.shades) { ctx.fillStyle = '#16131f'; SG.roundRect(ctx, dx - 12, ey - 4, 10, 7, 2); ctx.fill(); SG.roundRect(ctx, dx + 2, ey - 4, 10, 7, 2); ctx.fill(); ctx.fillRect(dx - 3, ey - 2, 6, 2); }
    if (o.splat) {
      ctx.beginPath(); ctx.moveTo(-r * 0.6, hy - r * 0.7); ctx.quadraticCurveTo(0, hy - r * 1.4, r * 0.7, hy - r * 0.7); ctx.quadraticCurveTo(r * 0.5, hy - r * 0.2, r * 0.3, hy - r * 0.5); ctx.quadraticCurveTo(r * 0.2, hy + 2, 0, hy - r * 0.55); ctx.quadraticCurveTo(-r * 0.4, hy - r * 0.3, -r * 0.6, hy - r * 0.7);
      fillStroke(ctx, '#f4f6e8', 2.2);
    }
  }

  function drawPersonHat(ctx, o, hy, r, back) {
    const hat = o.hat;
    if (o.umbrella) return;
    if (!hat) return;
    const top = hy - r;
    if (hat === 'bucket') {
      ctx.beginPath(); ctx.moveTo(-r - 8, top + 10); ctx.lineTo(-r * 0.7, top - 6); ctx.quadraticCurveTo(0, top - 12, r * 0.7, top - 6); ctx.lineTo(r + 8, top + 10); ctx.quadraticCurveTo(0, top + 4, -r - 8, top + 10); ctx.closePath();
      fillStroke(ctx, o.hatColor || '#f4e1a1', 3);
    } else if (hat === 'cap') {
      ctx.beginPath(); ctx.arc(0, top + 8, r * 0.95, Math.PI, 0); ctx.closePath(); fillStroke(ctx, o.hatColor || '#e84a5f', 3);
      if (!back) { ctx.beginPath(); ctx.ellipse(r * 0.75, top + 8, r * 0.7, 4, 0.1, 0, TAU); fillStroke(ctx, SG.shade(o.hatColor || '#e84a5f', -0.2), 2.5); }
    } else if (hat === 'beanie') {
      ctx.beginPath(); ctx.arc(0, top + 10, r * 0.98, Math.PI, 0); ctx.closePath(); fillStroke(ctx, o.hatColor || '#2f6f9f', 3);
      ctx.fillStyle = SG.shade(o.hatColor || '#2f6f9f', -0.25); ctx.fillRect(-r, top + 5, r * 2, 6);
      circle(ctx, 0, top - 9, 5); fillStroke(ctx, '#fff', 2);
    } else if (hat === 'sunhat') {
      ellipse(ctx, 0, top + 7, r + 14, 6); fillStroke(ctx, o.hatColor || '#f7d794', 3);
      ctx.beginPath(); ctx.arc(0, top + 6, r * 0.75, Math.PI, 0); ctx.closePath(); fillStroke(ctx, o.hatColor || '#f7d794', 3);
      ctx.fillStyle = '#e8413a'; ctx.fillRect(-r * 0.75, top + 1, r * 1.5, 4);
    } else if (hat === 'rainmate') {
      ctx.beginPath(); ctx.arc(0, hy - 2, r + 3, Math.PI * 0.95, Math.PI * 2.05); ctx.closePath();
      ctx.fillStyle = 'rgba(220,240,255,0.7)'; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.stroke();
    } else if (hat === 'feather') {
      ctx.beginPath(); ctx.arc(0, top + 8, r * 1.0, Math.PI, 0); ctx.lineTo(r * 0.9, top - 18); ctx.quadraticCurveTo(0, top - 30, -r * 0.9, top - 18); ctx.closePath();
      fillStroke(ctx, '#1b1b26', 3);
      ctx.fillStyle = '#c62f3a'; ctx.fillRect(-r, top + 2, r * 2, 5);
    } else if (hat === 'flatcap') {
      ctx.beginPath(); ctx.moveTo(-r - 1, top + 9); ctx.quadraticCurveTo(-r, top - 4, 0, top - 4); ctx.quadraticCurveTo(r + 6, top - 2, r + 12, top + 9); ctx.closePath();
      fillStroke(ctx, o.hatColor || '#8a7a62', 3);
    }
  }

  function drawArms(ctx, o, topY, hipY, torsoW, back, t) {
    const sleeve = o.top || '#ff6b6b';
    const skin = o.skin || '#f3c8a8';
    const pose = o.pose || 'stand';
    const shX = torsoW / 2 - 2, shY = topY + 10;
    const handR = 6;
    function arm(sx, sy, hx, hy) {
      ctx.lineWidth = 13; ctx.strokeStyle = INK;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(hx, hy); ctx.stroke();
      ctx.lineWidth = 8.5; ctx.strokeStyle = sleeve;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(hx, hy); ctx.stroke();
      circle(ctx, hx, hy, handR); fillStroke(ctx, skin, 2.6);
    }
    const foodScale = o.kind === 'kid' ? 0.85 : 1;
    const food = o.food;
    const walking = pose === 'walk' || pose === 'run';
    const swing = walking ? Math.sin(t * (pose === 'run' ? 20 : 11)) * 10 : 0;

    if (o.umbrella) {
      // umbrella held overhead with near hand
      const ux = 6, uy = topY - 70;
      ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(shX - 6, shY + 6); ctx.lineTo(ux, uy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ux - 52, uy + 12); ctx.quadraticCurveTo(ux, uy - 34, ux + 52, uy + 12);
      for (let i = 0; i < 4; i++) { const x0 = ux + 52 - i * 26; ctx.quadraticCurveTo(x0 - 13, uy + 4, x0 - 26, uy + 12); }
      ctx.closePath();
      fillStroke(ctx, o.umbrellaColor || '#e84a5f', 3);
      ctx.save(); ctx.clip(); ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.moveTo(ux, uy - 30); ctx.lineTo(ux - 18, uy + 14); ctx.lineTo(ux + 6, uy + 14); ctx.closePath(); ctx.fill(); ctx.restore();
      arm(-shX, shY, -shX - 2 + swing * 0.3, hipY - 6);
      if (food) { arm(shX, shY, shX + 4, shY + 26); A.food(ctx, food, shX + 8, shY + 22, foodScale, { t }); }
      else arm(shX, shY, shX + 2, shY + 22);
      return;
    }

    if (o.pipes) {
      // bagpipes: bag under arm, drones over shoulder
      ellipse(ctx, 6, topY + 26, 22, 15, 0.2); fillStroke(ctx, '#2e6b3f', 3);
      ctx.strokeStyle = INK; ctx.lineWidth = 6;
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(-8 + i * 5, topY + 20); ctx.lineTo(-40 - i * 10, topY - 36 - i * 10); ctx.stroke(); }
      ctx.strokeStyle = '#3a2a20'; ctx.lineWidth = 3.5;
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(-8 + i * 5, topY + 20); ctx.lineTo(-40 - i * 10, topY - 36 - i * 10); ctx.stroke(); }
      ctx.fillStyle = '#c62f3a'; for (let i = 0; i < 3; i++) { ctx.fillRect(-44 - i * 10, topY - 40 - i * 10, 8, 4); }
      ctx.strokeStyle = INK; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(14, topY + 30); ctx.lineTo(20, hipY + 4); ctx.stroke();
      arm(shX, shY, 18, topY + 34 + Math.sin(t * 8) * 2);
      arm(-shX, shY, 16, topY + 50 + Math.sin(t * 8 + 1) * 2);
      return;
    }

    if (back) {
      arm(-shX, shY, -shX - 3 + swing * 0.4, hipY - 4);
      if (pose === 'reach') arm(shX, shY, shX + 6, shY - 18);
      else arm(shX, shY, shX + 3 - swing * 0.4, hipY - 4);
      return;
    }

    switch (pose) {
      case 'shield': {
        // hunched, both arms wrapped around the food, turned away
        if (food) A.food(ctx, food, 2, shY + 22, foodScale, { t });
        arm(-shX, shY, 8, shY + 28);
        arm(shX, shY, -4, shY + 18);
        break;
      }
      case 'swat': {
        const k = Math.sin(t * 28);
        if (food) { arm(-shX, shY, -shX + 4, shY + 26); A.food(ctx, food, -shX + 2, shY + 24, foodScale, { t }); }
        else arm(-shX, shY, -shX - 4, hipY - 6);
        const ax = shX + 22 + k * 6, ay = shY - 26 + k * 22;
        arm(shX, shY, ax, ay);
        ctx.strokeStyle = 'rgba(45,42,74,0.6)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(shX, shY, 40, -1.4, -0.2); ctx.stroke();
        ctx.beginPath(); ctx.arc(shX, shY, 50, -1.2, -0.4); ctx.stroke();
        if (o.spatula) { ctx.save(); ctx.translate(ax, ay); ctx.rotate(-0.6 + k * 0.4); ctx.fillStyle = '#c0c6d0'; SG.roundRect(ctx, -6, -30, 12, 18, 3); fillStroke(ctx, '#c0c6d0', 2.5); ctx.restore(); }
        break;
      }
      case 'wipe': {
        arm(-shX, shY, -shX - 4, hipY - 4);
        arm(shX, shY, 6 + Math.sin(t * 18) * 6, topY - 26);
        if (food) A.food(ctx, food, -shX - 6, hipY - 4, foodScale, { t });
        break;
      }
      case 'angry': {
        const shake = Math.sin(t * 30) * 4;
        arm(shX, shY, shX + 10 + shake, topY - 24);
        arm(-shX, shY, -shX - 3, hipY - 6);
        break;
      }
      case 'eat': {
        const up = Math.max(0, Math.sin(t * 3));
        arm(-shX, shY, -shX - 3, hipY - 6);
        const hx = shX + 8 - up * 10, hy = shY + 22 - up * 28;
        arm(shX, shY, hx, hy);
        if (food) A.food(ctx, food, hx + 2, hy - 4, foodScale, { t });
        break;
      }
      case 'reach': {
        arm(-shX, shY, -shX - 3, hipY - 6);
        arm(shX, shY, shX + 24, shY - 4);
        if (food) A.food(ctx, food, shX + 28, shY - 8, foodScale, { t });
        break;
      }
      case 'clap': {
        const c = Math.abs(Math.sin(t * 10)) * 8;
        arm(-shX, shY, 2 - c, shY + 14); arm(shX, shY, 6 + c, shY + 14);
        break;
      }
      default: {
        if (o.phone) {
          arm(-shX, shY, 0, shY + 20);
          ctx.fillStyle = '#20202c'; SG.roundRect(ctx, -6, shY + 6, 12, 18, 3); fillStroke(ctx, '#20202c', 2);
          ctx.fillStyle = '#8fd3ff'; ctx.fillRect(-4, shY + 9, 8, 11);
        } else arm(-shX, shY, -shX - 3 + swing * 0.5, hipY - 6);
        if (food) {
          const hx = shX + 10, hy = shY + 24;
          arm(shX, shY, hx, hy);
          A.food(ctx, food, hx + 2, hy - 2, foodScale, { t });
        } else if (o.leash) {
          arm(shX, shY, shX + 12, shY + 30);
        } else arm(shX, shY, shX + 3 - swing * 0.5, hipY - 6);
      }
    }
  }

  // Shopkeeper upper body inside the hatch. o: {x, y (counter top), facing:'out'|'in', t, kind, swat, top}
  A.shopkeeper = function (ctx, o) {
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const t = o.t || 0;
    const bob = Math.sin(t * 2) * 1.5;
    const out = o.facing === 'out';
    const top = o.top || '#ffffff';
    // torso
    ctx.beginPath(); ctx.moveTo(-26, 4); ctx.lineTo(-22, -40 + bob); ctx.quadraticCurveTo(0, -48 + bob, 22, -40 + bob); ctx.lineTo(26, 4); ctx.closePath();
    fillStroke(ctx, top, 3);
    if (out) { ctx.beginPath(); ctx.moveTo(-14, 4); ctx.lineTo(-12, -30 + bob); ctx.lineTo(12, -30 + bob); ctx.lineTo(14, 4); ctx.closePath(); fillStroke(ctx, o.apron || '#e8f4ff', 2.5); }
    const hy = -62 + bob;
    circle(ctx, 0, hy, 18); fillStroke(ctx, o.skin || '#f3c8a8', 3);
    if (out) {
      ctx.fillStyle = INK; circle(ctx, -6, hy - 1, 2.6); ctx.fill(); circle(ctx, 6, hy - 1, 2.6); ctx.fill();
      ctx.lineWidth = 2.5; ctx.strokeStyle = INK;
      if (o.swat) { ctx.beginPath(); ctx.moveTo(-10, hy - 9); ctx.lineTo(-3, hy - 6); ctx.moveTo(10, hy - 9); ctx.lineTo(3, hy - 6); ctx.stroke(); ellipse(ctx, 0, hy + 9, 4, 4.5); ctx.fillStyle = '#7a2632'; ctx.fill(); ctx.stroke(); }
      else { ctx.beginPath(); ctx.moveTo(-6, hy + 8); ctx.quadraticCurveTo(0, hy + 12, 6, hy + 8); ctx.stroke(); }
      // moustache for the chippy
      if (o.kind === 'chippy' || o.kind === 'seafood') { ctx.fillStyle = '#4a3020'; ctx.beginPath(); ctx.ellipse(-5, hy + 5, 6, 3, 0.2, 0, TAU); ctx.ellipse(5, hy + 5, 6, 3, -0.2, 0, TAU); ctx.fill(); }
    } else {
      ctx.fillStyle = o.hair || '#4a3020'; ctx.beginPath(); ctx.arc(0, hy, 18, Math.PI * 0.9, Math.PI * 2.1); ctx.lineTo(16, hy + 6); ctx.quadraticCurveTo(0, hy + 16, -16, hy + 6); ctx.closePath(); fillStroke(ctx, o.hair || '#4a3020', 3);
    }
    // paper hat / chef hat
    if (o.kind === 'bakery' || o.kind === 'chippy') {
      ctx.beginPath(); ctx.moveTo(-14, hy - 12); ctx.lineTo(-16, hy - 30); ctx.quadraticCurveTo(0, hy - 40, 16, hy - 30); ctx.lineTo(14, hy - 12); ctx.closePath(); fillStroke(ctx, '#ffffff', 3);
    } else if (o.kind === 'icecream') {
      ctx.beginPath(); ctx.moveTo(-17, hy - 8); ctx.lineTo(0, hy - 26); ctx.lineTo(17, hy - 8); ctx.closePath(); fillStroke(ctx, '#ff9ebb', 3);
    } else if (o.kind === 'seafood') {
      ctx.beginPath(); ctx.arc(0, hy - 6, 18, Math.PI, 0); ctx.closePath(); fillStroke(ctx, '#2f6f9f', 3);
    } else {
      ctx.fillStyle = '#e84a5f'; ctx.beginPath(); ctx.arc(0, hy - 4, 18, Math.PI * 1.1, Math.PI * 1.9); ctx.lineTo(0, hy - 14); ctx.closePath(); ctx.fill();
    }
    // arms
    const armC = top;
    if (out) {
      if (o.swat) {
        const k = Math.sin(t * 30);
        ctx.lineWidth = 12; ctx.strokeStyle = INK; ctx.beginPath(); ctx.moveTo(20, -32); ctx.lineTo(42, -60 + k * 20); ctx.stroke();
        ctx.lineWidth = 8; ctx.strokeStyle = armC; ctx.beginPath(); ctx.moveTo(20, -32); ctx.lineTo(42, -60 + k * 20); ctx.stroke();
        ctx.save(); ctx.translate(42, -60 + k * 20); ctx.rotate(-0.4 + k * 0.5); SG.roundRect(ctx, -9, -34, 18, 24, 4); fillStroke(ctx, '#c7ccd6', 2.5); ctx.fillStyle = INK; ctx.fillRect(-2, -10, 4, 14); ctx.restore();
      } else {
        for (const sx of [-1, 1]) {
          ctx.lineWidth = 12; ctx.strokeStyle = INK; ctx.beginPath(); ctx.moveTo(sx * 20, -32); ctx.lineTo(sx * 26, -4); ctx.stroke();
          ctx.lineWidth = 8; ctx.strokeStyle = armC; ctx.beginPath(); ctx.moveTo(sx * 20, -32); ctx.lineTo(sx * 26, -4); ctx.stroke();
          circle(ctx, sx * 26, -4, 6); fillStroke(ctx, o.skin || '#f3c8a8', 2.5);
        }
      }
    } else {
      // busy at the fryer: elbows working
      const k = Math.sin(t * 10) * 4;
      for (const sx of [-1, 1]) {
        ctx.lineWidth = 12; ctx.strokeStyle = INK; ctx.beginPath(); ctx.moveTo(sx * 20, -32); ctx.lineTo(sx * 30, -20 + k * sx); ctx.stroke();
        ctx.lineWidth = 8; ctx.strokeStyle = armC; ctx.beginPath(); ctx.moveTo(sx * 20, -32); ctx.lineTo(sx * 30, -20 + k * sx); ctx.stroke();
      }
    }
    ctx.restore();
  };

  // Counter ledge in front of the shopkeeper.
  A.counter = function (ctx, hatchX, color) {
    const H = SG.HATCH;
    const x = hatchX - H.halfW - 8, w = H.halfW * 2 + 16;
    SG.roundRect(ctx, x, H.counterTop, w, H.counterBottom - H.counterTop, 5);
    fillStroke(ctx, SG.shade(color || '#cccccc', -0.15), 3.5);
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(x + 6, H.counterTop + 3, w - 12, 4);
  };

  // =========================================================================
  // DOG (a wee Westie)
  // =========================================================================
  A.dog = function (ctx, o) {
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.scale((o.s || 1) * (o.facing || 1), o.s || 1);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const t = o.t || 0;
    const run = o.running;
    const k = run ? Math.sin(t * 24) : Math.sin(t * 8) * 0.3;
    const bob = run ? -Math.abs(Math.cos(t * 24)) * 4 : 0;
    // legs
    for (const [lx, ph] of [[-16, 0], [-8, Math.PI], [10, Math.PI], [18, 0]]) {
      const a = Math.sin(t * 24 + ph) * (run ? 0.6 : 0.05);
      ctx.save(); ctx.translate(lx, -14 + bob); ctx.rotate(a);
      SG.roundRect(ctx, -4, 0, 8, 15, 4); fillStroke(ctx, '#ffffff', 2.6);
      ctx.restore();
    }
    ctx.translate(0, bob);
    // tail
    ctx.save(); ctx.translate(-22, -30); ctx.rotate(-0.8 + Math.sin(t * 20) * 0.4);
    SG.roundRect(ctx, -3, -16, 7, 18, 4); fillStroke(ctx, '#ffffff', 2.6); ctx.restore();
    // body (fluffy)
    ellipse(ctx, 0, -24, 26, 14); fillStroke(ctx, '#ffffff', 3);
    // head
    circle(ctx, 22, -38, 14); fillStroke(ctx, '#ffffff', 3);
    // ears
    for (const ex of [14, 26]) { ctx.beginPath(); ctx.moveTo(ex - 5, -48); ctx.lineTo(ex, -60); ctx.lineTo(ex + 5, -48); ctx.closePath(); fillStroke(ctx, '#ffffff', 2.5); }
    // snout
    ellipse(ctx, 34, -34, 7, 5.5); fillStroke(ctx, '#ffffff', 2.5);
    circle(ctx, 40, -36, 3); ctx.fillStyle = INK; ctx.fill();
    circle(ctx, 25, -41, 2.4); ctx.fill();
    if (o.barking) { ctx.beginPath(); ctx.moveTo(30, -30); ctx.lineTo(40, -28); ctx.lineTo(30, -26); ctx.closePath(); ctx.fillStyle = '#7a2632'; ctx.fill(); }
    // tartan collar
    ctx.fillStyle = '#c62f3a'; ctx.fillRect(12, -30, 8, 8);
    if (o.carry) { ctx.save(); ctx.translate(42, -30); ctx.scale(0.5, 0.5); A.food(ctx, o.carry, 0, 0, 1, { t }); ctx.restore(); }
    ctx.restore();
  };

  // =========================================================================
  // FOOD
  // =========================================================================
  A.FOOD_NAMES = {
    supper: 'Fish Supper', chips: 'Poke o’ Chips', icecream: 'Pokey Hat', pie: 'Scotch Pie', sausageroll: 'Sausage Roll',
    doughnut: 'Doughnut', piece: 'Jeely Piece', seafood: 'Langoustines', chip: 'Chip', crust: 'Crust', fishbones: 'Fish Bones',
    wrapper: 'Chippy Wrapper', halfpie: 'Half a Pie', golden: 'GOLDEN SUPPER', scone: 'Scone', fishhead: 'Fish Heid',
  };

  A.food = function (ctx, type, x, y, s, opts) {
    s = s || 1;
    const t = (opts && opts.t) || 0;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    switch (type) {
      case 'supper': case 'golden': {
        const gold = type === 'golden';
        // open paper wrapper
        ctx.beginPath(); ctx.moveTo(-20, -4); ctx.lineTo(-14, 10); ctx.lineTo(14, 10); ctx.lineTo(22, -4); ctx.lineTo(10, -2); ctx.lineTo(-8, -2); ctx.closePath();
        fillStroke(ctx, gold ? '#ffe680' : '#f5f0e1', 2.5);
        // chips
        const cc = gold ? '#ffd23f' : '#ffd36b';
        for (let i = 0; i < 5; i++) { ctx.save(); ctx.translate(-12 + i * 5, -4); ctx.rotate(-0.4 + i * 0.2); SG.roundRect(ctx, -2.2, -10, 4.4, 13, 1.5); fillStroke(ctx, cc, 1.8); ctx.restore(); }
        // battered fish
        ctx.beginPath(); ctx.moveTo(-14, -6); ctx.quadraticCurveTo(0, -18, 14, -8); ctx.lineTo(20, -14); ctx.lineTo(19, -2); ctx.lineTo(14, -4); ctx.quadraticCurveTo(0, 2, -14, -6); ctx.closePath();
        fillStroke(ctx, gold ? '#ffcf33' : '#e9a23b', 2.4);
        ctx.fillStyle = gold ? '#fff3b0' : '#f6c56b'; ellipse(ctx, -2, -9, 7, 2.5, -0.2); ctx.fill();
        if (gold) {
          ctx.globalAlpha = 0.5 + Math.sin(t * 8) * 0.3;
          A.star(ctx, 16, -20, 5, '#fffbe0', t * 3); A.star(ctx, -18, -14, 4, '#fffbe0', -t * 2);
          ctx.globalAlpha = 1;
        }
        break;
      }
      case 'chips': {
        ctx.beginPath(); ctx.moveTo(-12, -8); ctx.lineTo(12, -8); ctx.lineTo(3, 14); ctx.lineTo(-3, 14); ctx.closePath();
        fillStroke(ctx, '#ffffff', 2.4);
        ctx.fillStyle = '#e84a5f'; ctx.fillRect(-8, -2, 16, 3);
        for (let i = 0; i < 5; i++) { ctx.save(); ctx.translate(-8 + i * 4, -8); ctx.rotate(-0.35 + i * 0.17); SG.roundRect(ctx, -2, -12, 4.2, 13, 1.5); fillStroke(ctx, '#ffd36b', 1.8); ctx.restore(); }
        break;
      }
      case 'chip': {
        ctx.rotate(0.6); SG.roundRect(ctx, -2.5, -8, 5, 16, 2); fillStroke(ctx, '#ffd36b', 2);
        break;
      }
      case 'icecream': {
        ctx.beginPath(); ctx.moveTo(-8, -4); ctx.lineTo(8, -4); ctx.lineTo(0, 16); ctx.closePath(); fillStroke(ctx, '#e0a35b', 2.4);
        ctx.strokeStyle = '#b87a3a'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(-5, 1); ctx.lineTo(3, 9); ctx.moveTo(5, 1); ctx.lineTo(-3, 9); ctx.stroke();
        circle(ctx, 0, -9, 9); fillStroke(ctx, '#fff6e6', 2.4);
        ctx.fillStyle = '#ffffff'; ellipse(ctx, -3, -12, 3, 2); ctx.fill();
        // chocolate flake
        ctx.save(); ctx.translate(5, -16); ctx.rotate(0.4); SG.roundRect(ctx, -2.5, -9, 5, 12, 1.5); fillStroke(ctx, '#7b4a2e', 1.8); ctx.restore();
        break;
      }
      case 'pie': case 'halfpie': {
        if (type === 'halfpie') { ctx.beginPath(); ctx.arc(0, 0, 11, Math.PI * 0.1, Math.PI * 1.1); ctx.closePath(); fillStroke(ctx, '#d9963a', 2.4); break; }
        ellipse(ctx, 0, 2, 13, 7); fillStroke(ctx, '#c98232', 2.4);
        ctx.beginPath(); ctx.rect(-13, -6, 26, 8); ctx.fillStyle = '#d9963a'; ctx.fill();
        ctx.strokeStyle = INK; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(-13, -6); ctx.lineTo(-13, 2); ctx.moveTo(13, -6); ctx.lineTo(13, 2); ctx.stroke();
        ellipse(ctx, 0, -6, 13, 5); fillStroke(ctx, '#e8b35c', 2.4);
        ellipse(ctx, 0, -6, 6, 2.2); ctx.fillStyle = '#8a4b22'; ctx.fill();
        break;
      }
      case 'sausageroll': {
        SG.roundRect(ctx, -15, -6, 30, 12, 6); fillStroke(ctx, '#eab45e', 2.4);
        ctx.strokeStyle = '#b97a2c'; ctx.lineWidth = 1.5; for (let i = -8; i <= 8; i += 6) { ctx.beginPath(); ctx.moveTo(i - 2, -5); ctx.lineTo(i + 2, 5); ctx.stroke(); }
        ctx.fillStyle = '#c86a4a'; ellipse(ctx, 14, 0, 2.5, 4); ctx.fill();
        break;
      }
      case 'doughnut': {
        circle(ctx, 0, 0, 12); fillStroke(ctx, '#e0a35b', 2.4);
        ctx.beginPath(); ctx.arc(0, -1, 10, 0, TAU); ctx.fillStyle = '#ff8fc7'; ctx.fill();
        circle(ctx, 0, 0, 3.5); ctx.fillStyle = '#c98232'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = INK; ctx.stroke();
        const sp = ['#ffd23f', '#4ecdc4', '#ffffff', '#5f7dff'];
        for (let i = 0; i < 8; i++) { const a = i * 0.8; ctx.fillStyle = sp[i % 4]; ctx.fillRect(Math.cos(a) * 7 - 1, Math.sin(a) * 7 - 2, 2, 3.5); }
        break;
      }
      case 'scone': {
        ctx.beginPath(); ctx.moveTo(-11, 6); ctx.quadraticCurveTo(-12, -9, 0, -10); ctx.quadraticCurveTo(12, -9, 11, 6); ctx.closePath(); fillStroke(ctx, '#e8b35c', 2.4);
        ctx.fillStyle = '#c0392b'; ctx.fillRect(-10, -1, 20, 3); ctx.fillStyle = '#fff8e8'; ctx.fillRect(-10, -4, 20, 3);
        break;
      }
      case 'piece': {
        ctx.beginPath(); ctx.moveTo(-13, 8); ctx.lineTo(13, 8); ctx.lineTo(0, -12); ctx.closePath(); fillStroke(ctx, '#f7e2b5', 2.4);
        ctx.fillStyle = '#d63b55'; ctx.beginPath(); ctx.moveTo(-9, 5); ctx.lineTo(9, 5); ctx.lineTo(0, -7); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#7ccf5a'; ctx.fillRect(-11, 4, 22, 2.5);
        break;
      }
      case 'seafood': {
        SG.roundRect(ctx, -16, -2, 32, 10, 3); fillStroke(ctx, '#ffffff', 2.4);
        for (let i = 0; i < 3; i++) {
          ctx.save(); ctx.translate(-9 + i * 9, -3); ctx.rotate(-0.3);
          ctx.beginPath(); ctx.moveTo(-6, 0); ctx.quadraticCurveTo(0, -10, 6, -2); ctx.quadraticCurveTo(2, 2, -6, 0); fillStroke(ctx, '#ff7a59', 2);
          ctx.strokeStyle = '#ff7a59'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(5, -4); ctx.lineTo(11, -10); ctx.stroke();
          ctx.restore();
        }
        ctx.fillStyle = '#ffe14d'; ellipse(ctx, 12, -4, 4, 3); ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = INK; ctx.stroke();
        break;
      }
      case 'crust': {
        ctx.beginPath(); ctx.arc(0, 4, 11, Math.PI * 1.1, Math.PI * 1.9); ctx.lineWidth = 6; ctx.strokeStyle = INK; ctx.stroke(); ctx.lineWidth = 3.5; ctx.strokeStyle = '#c98232'; ctx.stroke();
        break;
      }
      case 'fishbones': case 'fishhead': {
        ctx.strokeStyle = INK; ctx.lineWidth = 2.4;
        ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(8, 0); ctx.stroke();
        for (let i = -8; i <= 4; i += 4) { ctx.beginPath(); ctx.moveTo(i, -5); ctx.lineTo(i + 1, 5); ctx.stroke(); }
        ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(16, -7); ctx.lineTo(16, 7); ctx.closePath(); fillStroke(ctx, '#d8e2ea', 2.2);
        ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(-18, -6); ctx.lineTo(-18, 6); ctx.closePath(); fillStroke(ctx, '#d8e2ea', 2.2);
        circle(ctx, 12, -1, 1.6); ctx.fillStyle = INK; ctx.fill();
        break;
      }
      case 'wrapper': {
        ctx.beginPath(); ctx.moveTo(-14, 6); ctx.lineTo(-10, -6); ctx.lineTo(2, -9); ctx.lineTo(14, -4); ctx.lineTo(12, 7); ctx.closePath(); fillStroke(ctx, '#f5f0e1', 2.4);
        for (let i = 0; i < 3; i++) { ctx.save(); ctx.translate(-6 + i * 6, -3); ctx.rotate(0.3 * i); SG.roundRect(ctx, -2, -6, 4, 9, 1.5); fillStroke(ctx, '#ffd36b', 1.6); ctx.restore(); }
        break;
      }
      default: {
        circle(ctx, 0, 0, 8); fillStroke(ctx, '#ffd36b', 2);
      }
    }
    ctx.restore();
  };

  // =========================================================================
  // PROPS
  // =========================================================================
  A.prop = function (ctx, p, t) {
    const x = p.x, y = p.y;
    const s = SG.depthScale(y);
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    switch (p.type) {
      case 'bin': {
        ctx.translate(x, y); ctx.scale(s, s);
        if (p.tipped) {
          ctx.rotate(p.tipDir * 1.45);
          ctx.translate(0, -2);
        }
        A.shadow(ctx, 0, 2, 30, 0.2);
        const sh = p.shake ? Math.sin(t * 60) * p.shake * 4 : 0;
        ctx.translate(sh, 0);
        // body
        ctx.beginPath(); ctx.moveTo(-24, -58); ctx.lineTo(24, -58); ctx.lineTo(20, 0); ctx.lineTo(-20, 0); ctx.closePath();
        fillStroke(ctx, '#2f7d4f', 3.5);
        ctx.fillStyle = '#3c9a62'; ctx.fillRect(-18, -54, 8, 50);
        ctx.fillStyle = '#ffd23f'; SG.roundRect(ctx, -14, -40, 28, 12, 3); ctx.fill();
        ctx.fillStyle = INK; ctx.font = `700 8px ${SG.FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('LITTER', 0, -33.5);
        // lid
        if (!p.lidOff) { SG.roundRect(ctx, -27, -66, 54, 10, 4); fillStroke(ctx, '#256b42', 3.5); }
        // peeking contents
        if (p.fill > 0 && !p.tipped) { ctx.fillStyle = '#f5f0e1'; ctx.beginPath(); ctx.moveTo(-10, -66); ctx.lineTo(-4, -74); ctx.lineTo(4, -68); ctx.closePath(); ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = INK; ctx.stroke(); }
        break;
      }
      case 'bench': {
        ctx.translate(x, y); ctx.scale(s, s);
        A.shadow(ctx, 0, 4, 90, 0.16);
        const wood = '#c98a4b', iron = '#2c3e50';
        // iron legs
        for (const lx of [-72, 72]) { SG.roundRect(ctx, lx - 5, -38, 10, 40, 3); fillStroke(ctx, iron, 3); }
        // back rest
        for (let i = 0; i < 2; i++) { SG.roundRect(ctx, -84, -78 + i * 16, 168, 11, 4); fillStroke(ctx, wood, 3); }
        for (const lx of [-72, 72]) { ctx.fillStyle = iron; ctx.fillRect(lx - 4, -80, 8, 42); }
        // seat
        SG.roundRect(ctx, -86, -42, 172, 12, 4); fillStroke(ctx, SG.shade(wood, 0.1), 3);
        ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(-80, -40, 160, 3);
        break;
      }
      case 'picnic': {
        ctx.translate(x, y); ctx.scale(s, s);
        A.shadow(ctx, 0, 6, 100, 0.16);
        const wood = '#b87a44';
        // back bench
        SG.roundRect(ctx, -80, -60, 160, 10, 3); fillStroke(ctx, SG.shade(wood, -0.15), 3);
        // legs
        ctx.strokeStyle = INK; ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(-60, 0); ctx.lineTo(-40, -50); ctx.moveTo(60, 0); ctx.lineTo(40, -50); ctx.stroke();
        ctx.strokeStyle = wood; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(-60, 0); ctx.lineTo(-40, -50); ctx.moveTo(60, 0); ctx.lineTo(40, -50); ctx.stroke();
        // table top
        ctx.beginPath(); ctx.moveTo(-90, -58); ctx.lineTo(90, -58); ctx.lineTo(96, -44); ctx.lineTo(-96, -44); ctx.closePath(); fillStroke(ctx, SG.shade(wood, 0.12), 3.2);
        ctx.strokeStyle = 'rgba(45,42,74,0.35)'; ctx.lineWidth = 1.5; for (let i = -60; i <= 60; i += 30) { ctx.beginPath(); ctx.moveTo(i, -58); ctx.lineTo(i * 1.05, -44); ctx.stroke(); }
        // front bench
        SG.roundRect(ctx, -92, -26, 184, 10, 3); fillStroke(ctx, wood, 3);
        break;
      }
      case 'lamp': {
        ctx.translate(x, y); ctx.scale(s, s);
        A.shadow(ctx, 0, 2, 18, 0.2);
        const c = '#2b5d7d';
        SG.roundRect(ctx, -12, -24, 24, 24, 4); fillStroke(ctx, c, 3);
        SG.roundRect(ctx, -5, -190, 10, 170, 4); fillStroke(ctx, c, 3);
        ctx.fillStyle = '#ffd23f'; ctx.fillRect(-5, -120, 10, 5);
        // ornate arm & lantern
        ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(-14, -186, 10, -0.2, Math.PI * 1.2, true); ctx.stroke(); ctx.beginPath(); ctx.arc(14, -186, 10, Math.PI + 0.2, -0.2 - Math.PI * 1.0, false); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-14, -214); ctx.lineTo(14, -214); ctx.lineTo(10, -192); ctx.lineTo(-10, -192); ctx.closePath(); fillStroke(ctx, '#fff6c8', 3);
        ctx.beginPath(); ctx.moveTo(-18, -214); ctx.lineTo(0, -226); ctx.lineTo(18, -214); ctx.closePath(); fillStroke(ctx, c, 3);
        circle(ctx, 0, -229, 3); fillStroke(ctx, '#ffd23f', 2);
        break;
      }
      case 'creels': {
        ctx.translate(x, y); ctx.scale(s, s);
        A.shadow(ctx, 0, 2, 50, 0.18);
        const pots = [[-24, 0], [24, 0], [0, -34]];
        for (const [px, py] of pots) {
          ctx.beginPath(); ctx.moveTo(px - 24, py); ctx.lineTo(px - 24, py - 20); ctx.quadraticCurveTo(px, py - 42, px + 24, py - 20); ctx.lineTo(px + 24, py); ctx.closePath();
          fillStroke(ctx, '#3f6f8f', 3);
          ctx.save(); ctx.clip(); ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1.5;
          for (let i = -30; i < 30; i += 7) { ctx.beginPath(); ctx.moveTo(px + i, py); ctx.lineTo(px + i + 14, py - 40); ctx.stroke(); ctx.beginPath(); ctx.moveTo(px + i + 14, py); ctx.lineTo(px + i, py - 40); ctx.stroke(); }
          ctx.restore();
          ctx.fillStyle = '#e8413a'; ctx.fillRect(px - 24, py - 4, 48, 4);
        }
        break;
      }
      case 'planter': {
        ctx.translate(x, y); ctx.scale(s, s);
        A.shadow(ctx, 0, 2, 50, 0.18);
        const fl = ['#ff5d8f', '#ffd23f', '#a06cff', '#ff8a3d', '#ffffff'];
        for (let i = 0; i < 9; i++) { ctx.fillStyle = '#3e9c4a'; ellipse(ctx, -36 + i * 9, -42 - (i % 3) * 4, 8, 10); ctx.fill(); }
        for (let i = 0; i < 8; i++) { circle(ctx, -32 + i * 9, -48 - ((i * 7) % 3) * 4, 4.5); fillStroke(ctx, fl[i % fl.length], 1.8); }
        ctx.beginPath(); ctx.moveTo(-44, -38); ctx.lineTo(44, -38); ctx.lineTo(38, 0); ctx.lineTo(-38, 0); ctx.closePath(); fillStroke(ctx, '#7a5236', 3.2);
        ctx.fillStyle = '#946342'; ctx.fillRect(-40, -30, 80, 5);
        break;
      }
      case 'sign': {
        ctx.translate(x, y); ctx.scale(s, s);
        A.shadow(ctx, 0, 2, 14, 0.2);
        SG.roundRect(ctx, -4, -110, 8, 110, 3); fillStroke(ctx, '#6b7280', 3);
        SG.roundRect(ctx, -70, -150, 140, 54, 8); fillStroke(ctx, '#ffffff', 3.2);
        SG.roundRect(ctx, -64, -144, 128, 42, 5); ctx.lineWidth = 3; ctx.strokeStyle = '#e8413a'; ctx.stroke();
        ctx.fillStyle = '#e8413a'; ctx.font = `700 13px ${SG.FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const words = (p.text || '').split(' ');
        const half = Math.ceil(words.length / 2);
        ctx.fillText(words.slice(0, half).join(' '), 0, -131); ctx.fillText(words.slice(half).join(' '), 0, -115);
        // tiny crossed-out gull
        break;
      }
      case 'bollard': {
        ctx.translate(x, y); ctx.scale(s, s);
        A.shadow(ctx, 0, 2, 18, 0.2);
        ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(-10, -26); ctx.quadraticCurveTo(-18, -30, -16, -36); ctx.quadraticCurveTo(0, -44, 16, -36); ctx.quadraticCurveTo(18, -30, 10, -26); ctx.lineTo(12, 0); ctx.closePath();
        fillStroke(ctx, '#2d3142', 3);
        ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(-7, -24, 4, 20);
        break;
      }
      case 'longship': {
        ctx.translate(x, y); ctx.scale(s, s);
        A.shadow(ctx, 0, 4, 110, 0.16);
        // hull
        ctx.beginPath(); ctx.moveTo(-110, -50); ctx.quadraticCurveTo(-80, 0, 0, 0); ctx.quadraticCurveTo(80, 0, 110, -50); ctx.lineTo(90, -44); ctx.lineTo(-90, -44); ctx.closePath();
        fillStroke(ctx, '#a0663a', 3.5);
        ctx.strokeStyle = 'rgba(45,42,74,0.35)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-96, -32); ctx.quadraticCurveTo(0, -10, 96, -32); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-80, -18); ctx.quadraticCurveTo(0, -4, 80, -18); ctx.stroke();
        // dragon prow & tail
        ctx.beginPath(); ctx.moveTo(100, -46); ctx.quadraticCurveTo(122, -80, 108, -96); ctx.quadraticCurveTo(128, -92, 128, -80); ctx.quadraticCurveTo(118, -72, 112, -46); ctx.closePath(); fillStroke(ctx, '#a0663a', 3);
        ctx.beginPath(); ctx.moveTo(-100, -46); ctx.quadraticCurveTo(-124, -76, -112, -90); ctx.quadraticCurveTo(-106, -70, -110, -46); ctx.closePath(); fillStroke(ctx, '#a0663a', 3);
        // shields
        const sc = ['#e8413a', '#ffd23f', '#3a86ff', '#ffffff', '#2ec27e'];
        for (let i = 0; i < 5; i++) { circle(ctx, -60 + i * 30, -46, 11); fillStroke(ctx, sc[i], 3); circle(ctx, -60 + i * 30, -46, 3); ctx.fillStyle = INK; ctx.fill(); }
        // mast + striped sail
        SG.roundRect(ctx, -4, -150, 8, 106, 3); fillStroke(ctx, '#7a4c2a', 3);
        ctx.beginPath(); ctx.moveTo(-46, -140); ctx.lineTo(46, -140); ctx.quadraticCurveTo(54, -104, 44, -70); ctx.lineTo(-44, -70); ctx.quadraticCurveTo(-54, -104, -46, -140); ctx.closePath();
        fillStroke(ctx, '#ffffff', 3);
        ctx.save(); ctx.clip(); ctx.fillStyle = '#e8413a'; for (let i = -40; i < 50; i += 24) ctx.fillRect(i, -142, 12, 74); ctx.restore();
        ctx.beginPath(); ctx.moveTo(-46, -140); ctx.lineTo(46, -140); ctx.quadraticCurveTo(54, -104, 44, -70); ctx.lineTo(-44, -70); ctx.quadraticCurveTo(-54, -104, -46, -140); ctx.closePath(); ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.stroke();
        break;
      }
      default: break;
    }
    ctx.restore();
  };

  // Cached prop drawing (everything except bins, which animate).
  const PROP_BOX = {
    bench: [-100, -92, 200, 104], picnic: [-112, -76, 224, 92], lamp: [-32, -242, 64, 254], creels: [-62, -86, 124, 98],
    planter: [-56, -72, 112, 84], sign: [-80, -162, 160, 172], bollard: [-26, -52, 52, 62], longship: [-138, -162, 276, 178],
  };
  A.propCached = function (ctx, p, t) {
    const bb = PROP_BOX[p.type];
    if (!bb || p.type === 'bin') { A.prop(ctx, p, t); return; }
    const s = SG.depthScale(p.y);
    const w = bb[2] * s, h = bb[3] * s;
    const spr = SG.sprite('prop:' + p.type + ':' + p.x + ':' + p.y + ':' + (p.text || ''), w, h, (c) => {
      c.translate(-bb[0] * s, -bb[1] * s - p.y);
      A.prop(c, Object.assign({}, p, { x: 0 }), 0);
    });
    ctx.drawImage(spr, p.x + bb[0] * s, p.y + bb[1] * s, w, h);
  };

  // Victorian railing along the sea wall (drawn as one long depth-sorted prop).
  A.railing = function (ctx, y0) {
    const spr = SG.sprite('railing:' + y0, SG.W, 62, (c) => { c.translate(0, -(y0 - 54)); A.railingRaw(c, y0); });
    ctx.drawImage(spr, 0, y0 - 54, SG.W, 62);
  };
  A.railingRaw = function (ctx, y0) {
    const top = y0 - 44;
    ctx.save();
    ctx.lineCap = 'round';
    const c = '#2bb3a6';
    ctx.strokeStyle = INK; ctx.lineWidth = 6;
    for (let x = 10; x < SG.W; x += 26) { ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, top + 4); ctx.stroke(); }
    ctx.strokeStyle = c; ctx.lineWidth = 3;
    for (let x = 10; x < SG.W; x += 26) { ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, top + 4); ctx.stroke(); }
    // top & mid rails
    for (const [yy, h] of [[top, 9], [y0 - 16, 6]]) {
      ctx.fillStyle = c; ctx.fillRect(0, yy, SG.W, h);
      ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.strokeRect(-4, yy, SG.W + 8, h);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.fillRect(0, top + 1.5, SG.W, 2.5);
    // little finials
    ctx.fillStyle = c; ctx.strokeStyle = INK; ctx.lineWidth = 2.5;
    for (let x = 10; x < SG.W; x += 130) { circle(ctx, x, top - 4, 6); ctx.fill(); ctx.stroke(); }
    ctx.restore();
  };

  // Bunting strung between two points.
  A.bunting = function (ctx, x1, y1, x2, y2, t, seed) {
    const sag = 34;
    const cols = ['#ff4d6d', '#ffd23f', '#3a86ff', '#2ec27e', '#ffffff', '#ff9f43'];
    ctx.save();
    ctx.strokeStyle = INK; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x1, y1); ctx.quadraticCurveTo((x1 + x2) / 2, Math.max(y1, y2) + sag * 2 - sag, x2, y2);
    ctx.stroke();
    const n = Math.floor(Math.abs(x2 - x1) / 30);
    for (let i = 1; i < n; i++) {
      const u = i / n;
      const px = (1 - u) * (1 - u) * x1 + 2 * (1 - u) * u * ((x1 + x2) / 2) + u * u * x2;
      const py = (1 - u) * (1 - u) * y1 + 2 * (1 - u) * u * (Math.max(y1, y2) + sag) + u * u * y2;
      const sw = Math.sin(t * 3 + i * 0.7 + (seed || 0)) * 0.15;
      ctx.save(); ctx.translate(px, py); ctx.rotate(sw);
      ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(8, 0); ctx.lineTo(0, 17); ctx.closePath();
      ctx.fillStyle = cols[(i + (seed || 0)) % cols.length]; ctx.fill(); ctx.lineWidth = 1.8; ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  };

  // =========================================================================
  // FX
  // =========================================================================
  A.feather = function (ctx, x, y, r, rot) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    ellipse(ctx, 0, 0, r, r * 0.38); fillStroke(ctx, '#ffffff', 1.6);
    ctx.strokeStyle = '#a9b8cc'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(r, 0); ctx.stroke();
    ctx.restore();
  };

  A.splatDecal = function (ctx, x, y, r, alpha, seed) {
    ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y); ctx.scale(1, 0.45);
    ctx.fillStyle = '#f4f6e8';
    ctx.beginPath();
    for (let i = 0; i < 9; i++) { const a = (i / 9) * TAU; const rr = r * (0.75 + 0.35 * Math.sin(seed * 13 + i * 2.1)); ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
    ctx.closePath(); ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(45,42,74,0.45)'; ctx.stroke();
    ctx.fillStyle = '#c7cfa6'; circle(ctx, r * 0.15, -r * 0.1, r * 0.28); ctx.fill();
    ctx.restore();
  };

  // HUD ammo icon: a wee white swirl.
  A.poopIcon = function (ctx, x, y, r, alpha) {
    ctx.save();
    ctx.globalAlpha *= alpha === undefined ? 1 : alpha;
    ctx.lineWidth = 2.4; ctx.strokeStyle = INK;
    ellipse(ctx, x, y + r * 0.45, r, r * 0.5); ctx.fillStyle = '#f4f6e8'; ctx.fill(); ctx.stroke();
    ellipse(ctx, x, y - r * 0.05, r * 0.72, r * 0.42); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - r * 0.35, y - r * 0.35); ctx.quadraticCurveTo(x, y - r * 1.3, x + r * 0.15, y - r * 0.95); ctx.quadraticCurveTo(x + r * 0.45, y - r * 0.6, x + r * 0.35, y - r * 0.35); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#c7cfa6'; circle(ctx, x + r * 0.3, y + r * 0.35, r * 0.18); ctx.fill();
    ctx.restore();
  };

  A.poopBlob = function (ctx, x, y, r) {
    ctx.beginPath(); ctx.moveTo(x, y - r * 1.4); ctx.quadraticCurveTo(x + r * 1.1, y - r * 0.2, x, y + r); ctx.quadraticCurveTo(x - r * 1.1, y - r * 0.2, x, y - r * 1.4);
    fillStroke(ctx, '#f4f6e8', 2);
  };

  // Speech bubble. Returns nothing; anchored at the tail tip (x,y).
  A.bubble = function (ctx, x, y, text, opts) {
    opts = opts || {};
    const size = opts.size || 24;
    ctx.save();
    ctx.font = `700 ${size}px ${SG.FONT}`;
    const w = ctx.measureText(text).width + size * 1.1;
    const h = size * 1.6;
    const bx = SG.M.clamp(x - w / 2, 8, SG.W - w - 8), by = y - h - 14;
    if (opts.alpha !== undefined) ctx.globalAlpha = opts.alpha;
    ctx.translate(x, y); ctx.scale(opts.pop || 1, opts.pop || 1); ctx.translate(-x, -y);
    SG.roundRect(ctx, bx, by, w, h, h / 2);
    ctx.fillStyle = opts.fill || '#ffffff'; ctx.fill();
    ctx.lineWidth = 3.5; ctx.strokeStyle = INK; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 9, by + h - 2); ctx.lineTo(x, y); ctx.lineTo(x + 9, by + h - 2); ctx.closePath();
    ctx.fillStyle = opts.fill || '#ffffff'; ctx.fill();
    ctx.beginPath(); ctx.moveTo(x - 9, by + h); ctx.lineTo(x, y); ctx.lineTo(x + 9, by + h); ctx.stroke();
    ctx.fillStyle = opts.color || INK; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, bx + w / 2, by + h / 2 + 1);
    ctx.restore();
  };

  // Alert icon above heads: kind '?' or '!'
  A.alertIcon = function (ctx, x, y, kind, k) {
    ctx.save();
    ctx.translate(x, y);
    const sc = 0.8 + 0.3 * (k || 1);
    ctx.scale(sc, sc);
    const col = kind === '!' ? '#ff4d4d' : '#ffd23f';
    ctx.beginPath(); ctx.arc(0, 0, 17, 0, TAU); ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = 3.5; ctx.strokeStyle = INK; ctx.stroke();
    ctx.fillStyle = INK; ctx.font = `900 26px ${SG.FONT_TITLE}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(kind, 0, 2);
    ctx.restore();
  };
})(window.SG);
