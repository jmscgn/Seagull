// ---------------------------------------------------------------------------
// Food definitions, loose food items, poop projectiles, particles, floaters.
// ---------------------------------------------------------------------------
(function (SG) {
  'use strict';
  const M = SG.M;

  // bites x pts = total value. weight slows a carrying gull. small = swallowed instantly.
  SG.FOODS = {
    golden:      { bites: 6, pts: 50, weight: 1.1, glow: true },
    supper:      { bites: 5, pts: 30, weight: 1.0 },
    seafood:     { bites: 4, pts: 30, weight: 0.8 },
    chips:       { bites: 4, pts: 20, weight: 0.6, spills: true },
    icecream:    { bites: 3, pts: 20, weight: 0.5, melts: true },
    pie:         { bites: 3, pts: 20, weight: 0.5 },
    sausageroll: { bites: 2, pts: 30, weight: 0.45 },
    doughnut:    { bites: 2, pts: 25, weight: 0.3 },
    scone:       { bites: 2, pts: 20, weight: 0.3 },
    piece:       { bites: 2, pts: 25, weight: 0.4 },
    wrapper:     { bites: 2, pts: 15, weight: 0.25 },
    halfpie:     { bites: 2, pts: 15, weight: 0.3 },
    fishhead:    { bites: 1, pts: 20, weight: 0.2, small: true },
    fishbones:   { bites: 1, pts: 15, weight: 0.2, small: true },
    crust:       { bites: 1, pts: 10, weight: 0.1, small: true },
    chip:        { bites: 1, pts: 8, weight: 0.05, small: true },
  };
  SG.foodValue = (type, bites) => (bites === undefined ? SG.FOODS[type].bites : bites) * SG.FOODS[type].pts;

  SG.SHOP_MENU = {
    chippy: ['supper', 'supper', 'chips', 'chips', 'chips'],
    bakery: ['pie', 'sausageroll', 'doughnut', 'scone'],
    icecream: ['icecream'],
    cafe: ['piece', 'scone', 'doughnut', 'piece'],
    seafood: ['seafood', 'seafood', 'supper'],
  };
  SG.BIN_SCRAPS = ['wrapper', 'crust', 'fishbones', 'halfpie', 'chip', 'chip', 'crust', 'wrapper', 'fishhead'];

  // ---------------------------------------------------------------- items
  let nextId = 1;
  class Item {
    constructor(world, type, x, y, z, bites) {
      this.id = nextId++;
      this.world = world;
      this.type = type;
      this.def = SG.FOODS[type];
      this.bites = bites === undefined ? this.def.bites : bites;
      this.x = x; this.y = y; this.z = z;
      this.vx = 0; this.vy = 0; this.vz = 0;
      this.grounded = false;
      this.age = 0;
      this.life = type === 'icecream' ? 7 : 22;
      this.noPickup = 0;
      this.dead = false;
      this.floor = 0;
      this.rot = M.rand(-0.4, 0.4);
      this.inWater = false;
      this.counter = null; // shop whose counter this is sitting on
    }
    value() { return this.bites * this.def.pts; }
    toss(vx, vy, vz) { this.vx = vx; this.vy = vy; this.vz = vz; this.grounded = false; }
    update(dt) {
      this.age += dt;
      if (this.noPickup > 0) this.noPickup -= dt;
      if (this.counter) return; // sits still on a shop counter
      const w = this.world;
      if (!this.grounded) {
        this.vz -= 1500 * dt;
        this.x += this.vx * dt; this.y += this.vy * dt; this.z += this.vz * dt;
        this.rot += this.vx * 0.01 * dt * 6;
        this.x = M.clamp(this.x, 15, SG.W - 15);
        this.y = M.clamp(this.y, SG.GROUND_TOP + 8, SG.WATER_MAX_Y);
        // bounce off the sea wall face if low
        if (this.y > SG.GROUND_BOTTOM && this.y < SG.WATER_Y - 4 && this.z < 30 && this.vy > 0 && this.y < SG.SEAWALL_Y + 30) {
          // land on the railing/wall top (it's a box) — handled by floor
        }
        this.floor = w.floorAt(this.x, this.y, this.z);
        if (this.z <= this.floor) {
          this.z = this.floor;
          if (this.vz < -220) {
            this.vz = -this.vz * 0.32; this.vx *= 0.6; this.vy *= 0.6;
            if (this.def.melts && this.floor === 0) { this.life = Math.min(this.life, this.age + 4); }
          } else {
            this.vz = 0; this.vx = 0; this.vy = 0; this.grounded = true;
            if (w.isWater(this.x, this.y) && this.floor <= 0) {
              this.inWater = true;
              this.life = Math.min(this.life, this.age + 5);
              w.fx.splash(this.x, this.y);
              SG.Audio.sfx('splash', { vol: 0.5, pan: SG.panFor(this.x) });
            }
          }
        }
      } else {
        // re-check floor (e.g. a bin tipped over underneath)
        const f = w.floorAt(this.x, this.y, this.z + 1);
        if (f < this.z - 1) this.grounded = false;
        if (this.inWater) { this.x += Math.sin(this.age * 1.3 + this.id) * 6 * dt; }
      }
      if (this.age > this.life) this.dead = true;
    }
    draw(ctx, t) {
      const s = SG.depthScale(this.y);
      let alpha = 1;
      if (this.life - this.age < 2) alpha = Math.max(0, (this.life - this.age) / 2) * (0.6 + 0.4 * Math.sin(this.age * 20));
      ctx.save();
      ctx.globalAlpha = alpha;
      const sy = this.y - this.z - (this.inWater ? -4 : 8 * s);
      if (this.def.glow) {
        const g = ctx.createRadialGradient(this.x, sy, 4, this.x, sy, 60);
        g.addColorStop(0, 'rgba(255,230,120,0.65)'); g.addColorStop(1, 'rgba(255,230,120,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(this.x, sy, 60, 0, Math.PI * 2); ctx.fill();
      }
      ctx.translate(this.x, sy);
      if (!this.grounded) ctx.rotate(this.rot);
      if (this.inWater) { ctx.beginPath(); ctx.ellipse(0, 6, 22, 6, 0, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2; ctx.stroke(); }
      const sc = s * (this.def.small ? 1.0 : 1.05);
      SG.Art.food(ctx, this.type, 0, 0, sc, { t });
      ctx.restore();
      // value hint sparkle on big items
      if (!this.def.small && this.grounded && Math.sin(t * 4 + this.id) > 0.92) {
        SG.Art.star(ctx, this.x + 14, sy - 16, 5, '#fffbe0', t);
      }
    }
  }
  SG.Item = Item;

  // ---------------------------------------------------------------- poop
  class Poop {
    constructor(world, owner, x, y, z, vx, vy) {
      this.world = world; this.owner = owner;
      this.x = x; this.y = y; this.z = z;
      this.vx = vx; this.vy = vy; this.vz = -60;
      this.dead = false; this.age = 0;
    }
    update(dt) {
      this.age += dt;
      this.vz -= 1700 * dt;
      this.vx *= 0.99;
      this.x += this.vx * dt; this.y += this.vy * dt; this.z += this.vz * dt;
      this.y = M.clamp(this.y, SG.GROUND_TOP - 10, SG.WATER_MAX_Y);
      if (this.world.poopCollide(this)) { this.dead = true; return; }
      const f = this.world.floorAt(this.x, this.y, this.z);
      if (this.z <= f) {
        this.dead = true;
        if (this.world.isWater(this.x, this.y) && f <= 0) { this.world.fx.splash(this.x, this.y, 0.5); SG.Audio.sfx('splash', { vol: 0.25, pitch: 1.6, pan: SG.panFor(this.x) }); }
        else {
          this.world.addSplat(this.x, this.y - f, 14);
          SG.Audio.sfx('splat', { vol: 0.4, pitch: 1.2, pan: SG.panFor(this.x) });
        }
      }
    }
    draw(ctx) {
      SG.Art.poopBlob(ctx, this.x, this.y - this.z, 6 * SG.depthScale(this.y));
    }
  }
  SG.Poop = Poop;

  // ---------------------------------------------------------------- particles & floaters
  class FX {
    constructor() { this.parts = []; this.floaters = []; }
    clear() { this.parts.length = 0; this.floaters.length = 0; }
    add(p) { if (this.parts.length < 600) this.parts.push(p); return p; }
    feathers(x, y, z, n, color) {
      for (let i = 0; i < n; i++) this.add({ type: 'feather', x, y: y + M.rand(-6, 6), z: z + M.rand(10, 40), vx: M.rand(-160, 160), vy: M.rand(-40, 40), vz: M.rand(60, 260), life: M.rand(1.2, 2.2), age: 0, rot: M.rand(0, 6), vr: M.rand(-6, 6), size: M.rand(6, 10), color });
    }
    puff(x, y, z, n, color, spread) {
      for (let i = 0; i < n; i++) this.add({ type: 'puff', x: x + M.rand(-10, 10), y, z: z + M.rand(0, 16), vx: M.rand(-1, 1) * (spread || 90), vy: M.rand(-20, 20), vz: M.rand(10, 60), life: M.rand(0.35, 0.6), age: 0, size: M.rand(8, 16), color: color || '#ffffff' });
    }
    sparkles(x, y, z, n, color) {
      for (let i = 0; i < n; i++) this.add({ type: 'sparkle', x, y, z: z + M.rand(0, 30), vx: M.rand(-160, 160), vy: M.rand(-30, 30), vz: M.rand(60, 300), life: M.rand(0.4, 0.9), age: 0, size: M.rand(5, 10), color: color || '#ffe680', rot: M.rand(0, 6), vr: M.rand(-8, 8) });
    }
    crumbs(x, y, z, n, color) {
      for (let i = 0; i < n; i++) this.add({ type: 'crumb', x, y, z, vx: M.rand(-120, 120), vy: M.rand(-30, 30), vz: M.rand(80, 240), life: M.rand(0.4, 0.8), age: 0, size: M.rand(2, 4.5), color: color || '#e9a23b', grav: true });
    }
    splash(x, y, k) {
      k = k || 1;
      for (let i = 0; i < 10 * k; i++) this.add({ type: 'drop', x: x + M.rand(-8, 8), y, z: 0, vx: M.rand(-120, 120), vy: M.rand(-10, 10), vz: M.rand(120, 320) * k, life: 0.7, age: 0, size: M.rand(2.5, 5), color: '#dff6ff', grav: true });
      this.add({ type: 'ring', x, y, z: 0, life: 0.8, age: 0, size: 10, vx: 0, vy: 0, vz: 0 });
    }
    goo(x, y, z, n) {
      for (let i = 0; i < n; i++) this.add({ type: 'crumb', x, y, z, vx: M.rand(-90, 90), vy: M.rand(-20, 20), vz: M.rand(40, 200), life: M.rand(0.3, 0.6), age: 0, size: M.rand(2.5, 5), color: '#f4f6e8', grav: true });
    }
    impact(x, y, z) {
      this.add({ type: 'burst', x, y, z, vx: 0, vy: 0, vz: 0, life: 0.25, age: 0, size: 26 });
    }
    text(str, x, y, opts) {
      opts = opts || {};
      this.floaters.push({ str, x, y, vy: opts.vy || -70, life: opts.life || 1.1, age: 0, color: opts.color || '#ffffff', size: opts.size || 30, pop: 0 });
    }
    update(dt) {
      for (const p of this.parts) {
        p.age += dt;
        if (p.type === 'feather') { p.vz = Math.max(p.vz - 380 * dt, -45); p.vx *= 0.97; p.x += p.vx * dt + Math.sin(p.age * 5) * 30 * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.rot += p.vr * dt; if (p.z < 0) { p.z = 0; p.vx = 0; p.vz = 0; } }
        else if (p.grav) { p.vz -= 1100 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; if (p.z < 0) { p.z = 0; p.vz *= -0.3; p.vx *= 0.5; } }
        else { p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.vx *= 0.92; p.vz *= 0.92; if (p.rot !== undefined && p.vr) p.rot += p.vr * dt; }
      }
      this.parts = this.parts.filter((p) => p.age < p.life);
      for (const f of this.floaters) { f.age += dt; f.y += f.vy * dt; f.vy *= 0.96; }
      this.floaters = this.floaters.filter((f) => f.age < f.life);
    }
    drawPart(ctx, p) {
      const k = p.age / p.life;
      const sx = p.x, sy = p.y - p.z;
      ctx.save();
      switch (p.type) {
        case 'feather': ctx.globalAlpha = Math.min(1, (1 - k) * 2); SG.Art.feather(ctx, sx, sy, p.size, p.rot); break;
        case 'puff': ctx.globalAlpha = (1 - k) * 0.85; ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(sx, sy, p.size * (0.6 + k), 0, Math.PI * 2); ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = SG.rgba(SG.INK, 0.35 * (1 - k)); ctx.stroke(); break;
        case 'sparkle': ctx.globalAlpha = 1 - k; SG.Art.star(ctx, sx, sy, p.size * (1 - k * 0.5), p.color, p.rot); break;
        case 'crumb': case 'drop': ctx.globalAlpha = 1 - k * 0.6; ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(sx, sy, p.size, 0, Math.PI * 2); ctx.fill(); break;
        case 'wave': {
          ctx.globalAlpha = 1 - k; ctx.strokeStyle = p.color || '#fff'; ctx.lineCap = 'round';
          for (let i = 0; i < 3; i++) {
            const r = p.size + k * 60 + i * 14;
            ctx.lineWidth = 6 - i * 1.5;
            ctx.beginPath(); ctx.arc(sx, sy, r, p.dir > 0 ? -0.7 : Math.PI - 0.7, p.dir > 0 ? 0.7 : Math.PI + 0.7); ctx.stroke();
          }
          break;
        }
        case 'ring': ctx.globalAlpha = 1 - k; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(sx, sy, p.size + k * 40, (p.size + k * 40) * 0.3, 0, 0, Math.PI * 2); ctx.stroke(); break;
        case 'burst': {
          ctx.globalAlpha = 1 - k; ctx.strokeStyle = '#fff6c8'; ctx.lineWidth = 5; ctx.lineCap = 'round';
          for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; const r1 = p.size * (0.4 + k), r2 = p.size * (0.9 + k * 1.4); ctx.beginPath(); ctx.moveTo(sx + Math.cos(a) * r1, sy + Math.sin(a) * r1); ctx.lineTo(sx + Math.cos(a) * r2, sy + Math.sin(a) * r2); ctx.stroke(); }
          break;
        }
        default: break;
      }
      ctx.restore();
    }
    drawFloaters(ctx) {
      for (const f of this.floaters) {
        const k = f.age / f.life;
        const pop = k < 0.15 ? M.easeOutBack(k / 0.15) : 1;
        ctx.save();
        ctx.translate(f.x, f.y);
        ctx.scale(pop, pop);
        SG.text(ctx, f.str, 0, 0, { size: f.size, color: f.color, font: SG.FONT_TITLE, weight: 400, alpha: k > 0.7 ? (1 - k) / 0.3 : 1 });
        ctx.restore();
      }
    }
  }
  SG.FX = FX;
})(window.SG);
