// ---------------------------------------------------------------------------
// CPU gull brain. Produces the same input object a controller would, so CPU
// gulls play by exactly the same rules as humans.
// ---------------------------------------------------------------------------
(function (SG) {
  'use strict';
  const M = SG.M;

  const LEVELS = [
    { name: 'Chick',  think: 0.75, err: 70, aggression: 0.1,  flank: 0.15, poop: 0.3,  react: 0.45, speed: 0.62, nap: 0.35 },
    { name: 'Gull',   think: 0.32, err: 28, aggression: 0.4,  flank: 0.7,  poop: 0.6,  react: 0.25, speed: 0.9,  nap: 0.08 },
    { name: 'Gannet', think: 0.16, err: 10, aggression: 0.8,  flank: 1.0,  poop: 0.9,  react: 0.1,  speed: 1.0,  nap: 0 },
  ];
  SG.AI_LEVELS = LEVELS;

  class GullBrain {
    constructor(gull, level) {
      this.g = gull;
      this.cfg = LEVELS[M.clamp(level, 0, 2)];
      this.goal = null;
      this.thinkT = Math.random() * 0.3;
      this.held = { flap: false, peck: false, poop: false, dash: false, squawk: false };
      this.prev = { flap: false, peck: false, poop: false, dash: false, squawk: false };
      this.inp = { mx: 0, my: 0, held: this.held, pressed: {} };
      this.flapGap = 0;
      this.taunt = M.rand(6, 14);
      this.wobble = Math.random() * 10;
      this.errX = 0; this.errY = 0;
      this.stuck = 0; this.lastPos = [gull.x, gull.y];
      this.commitT = 0;
    }

    think(dt) {
      const g = this.g, w = g.world;
      for (const k in this.held) { this.prev[k] = this.held[k]; this.held[k] = false; }
      this.inp.mx = 0; this.inp.my = 0;
      this.wobble += dt;
      this.flapGap -= dt;
      this.commitT -= dt;
      if (g.frozen || w.phase !== 'play') return this.finish();

      this.thinkT -= dt;
      if (this.thinkT <= 0 || !this.valid(this.goal)) {
        this.thinkT = this.cfg.think * M.rand(0.8, 1.2);
        const keepEat = this.goal && this.goal.kind === 'eat' && this.valid(this.goal);
        if (!keepEat && (this.commitT <= 0 || !this.valid(this.goal))) {
          this.choose();
          if (g.grounded && Math.random() < this.cfg.nap) this.napT = M.rand(0.6, 1.6);
        }
        this.errX = M.rand(-1, 1) * this.cfg.err; this.errY = M.rand(-1, 1) * this.cfg.err * 0.4;
      }

      // stuck detection (e.g. walking into a bench)
      const tryingToMove = Math.abs(this.lastMx || 0) + Math.abs(this.lastMy || 0) > 0.4;
      if (Math.hypot(g.x - this.lastPos[0], g.y - this.lastPos[1]) < 1 && g.grounded && tryingToMove) this.stuck += dt; else this.stuck = 0;
      this.lastPos = [g.x, g.y];
      if (this.stuck > 0.5) { this.press('flap'); this.stuck = 0; }

      if (g.stunT > 0) return this.finish();
      if (g.swoopT > 0 && this.aim) { this.inp.mx = this.aim[0] * 0.6; this.inp.my = this.aim[1] * 0.6; return this.finish(); }
      if (this.napT > 0) { this.napT -= dt; return this.finish(); }
      this.act(dt);
      if (!g.carry || this.goal.kind !== 'eat') { this.inp.mx *= this.cfg.speed; this.inp.my *= this.cfg.speed; }

      // opportunistic poop on a carrier or alert person below us
      if (g.poopAmmo > 0 && g.z > 60 && Math.random() < this.cfg.poop * dt * 6) {
        for (const v of w.gulls) {
          if (v !== g && v.carry && Math.abs(v.x - (g.x + g.vx * 0.25)) < 22 && Math.abs(v.y - g.y) < 18 && v.z < g.z - 40) { this.press('poop'); break; }
        }
        for (const p of w.people) {
          if (p.food && p.alert > 0.45 && Math.abs(p.x - (g.x + g.vx * 0.25)) < 18 && Math.abs(p.y - g.y) < 16 && g.z > p.headZ() + 20) { this.press('poop'); break; }
        }
      }
      if (g.poopAmmo > 1 && g.z > 80 && Math.random() < this.cfg.poop * dt * 1.2) {
        for (const p of w.people) {
          if (Math.abs(p.x - (g.x + g.vx * 0.22)) < 16 && Math.abs(p.y - g.y) < 12 && g.z > p.headZ() + 30 && p.splatT <= 0) { this.press('poop'); break; }
        }
      }
      this.taunt -= dt;
      if (this.taunt <= 0) { this.taunt = M.rand(7, 16); if (Math.random() < 0.6) this.press('squawk'); }
      return this.finish();
    }

    finish() {
      this.lastMx = this.inp.mx; this.lastMy = this.inp.my;
      const pr = this.inp.pressed;
      for (const k in this.held) pr[k] = this.held[k] && !this.prev[k];
      return this.inp;
    }
    press(k) { if (!this.prev[k]) this.held[k] = true; }

    valid(goal) {
      if (!goal) return false;
      const g = this.g;
      switch (goal.kind) {
        case 'item': return !goal.item.dead && !g.carry;
        case 'person': return !goal.p.dead && !!goal.p.food && !g.carry && (!goal.p.shielding || (this.cfg.poop > 0.5 && g.poopAmmo > 0));
        case 'bin': return goal.bin.fill > 0 && !goal.bin.tipped && !g.carry;
        case 'gull': return !!goal.v.carry && !g.carry && (goal.t || 0) < 4.5;
        case 'eat': return !!g.carry;
        case 'wander': return !g.carry && goal.t > 0;
      }
      return false;
    }

    choose() {
      const g = this.g, w = g.world, cfg = this.cfg;
      if (g.carry) { this.goal = { kind: 'eat', spot: this.pickPerch() }; this.commitT = 1.2; return; }
      const cands = [];
      const d = (x, y) => Math.hypot(x - g.x, (y - g.y) * 1.2) + 60;
      for (const it of w.items) {
        if (it.dead) continue;
        let v = it.value();
        if (it.counter) v *= it.counter.keeper.facing === 'in' ? 1.3 : 0.15;
        // other gulls already closer?
        let contested = 0;
        for (const o of w.gulls) if (o !== g && Math.hypot(o.x - it.x, o.y - it.y) < Math.hypot(g.x - it.x, g.y - it.y) * 0.6) contested++;
        cands.push({ s: (v * 100) / d(it.x, it.y) / (1 + contested), goal: { kind: 'item', item: it } });
      }
      for (const p of w.people) {
        if (!p.food || p.dead) continue;
        if (p.shielding && !(cfg.poop > 0.5 && g.poopAmmo > 0)) continue;
        const v = SG.foodValue(p.food.type, p.food.bites);
        const risk = p.shielding ? 0.35 : 1 - p.alert * 0.9;
        cands.push({ s: (v * 70 * risk) / (d(p.x, p.y) + 90), goal: { kind: 'person', p } });
      }
      for (const b of w.bins) if (b.fill > 0 && !b.tipped) cands.push({ s: (22 * b.fill * 40) / (d(b.x, b.y) + 100), goal: { kind: 'bin', bin: b } });
      for (const v of w.gulls) {
        if (v === g || !v.carry) continue;
        const val = SG.foodValue(v.carry.type, v.carry.bites);
        cands.push({ s: (val * 90 * cfg.aggression * (v === w.leader ? 1.5 : 1)) / (d(v.x, v.y) + 120), goal: { kind: 'gull', v } });
      }
      if (!cands.length) { this.goal = { kind: 'wander', t: 2, x: M.rand(200, SG.W - 200), y: M.rand(620, 880), z: M.rand(120, 260) }; return; }
      cands.sort((a, b) => b.s - a.s);
      const pickFrom = cfg === LEVELS[0] ? 3 : cfg === LEVELS[1] ? 2 : 1;
      this.goal = cands[M.randInt(0, Math.min(pickFrom, cands.length) - 1)].goal;
      this.commitT = 0.6;
    }

    pickPerch() {
      const g = this.g, w = g.world;
      let best = null, bs = -1e9;
      for (const p of w.perches) {
        let threat = 1e9;
        for (const o of w.gulls) if (o !== g) threat = Math.min(threat, Math.hypot(o.x - p.x, (o.y - p.y) * 1.2, (o.z - p.z) * 0.5));
        const travel = Math.hypot(p.x - g.x, p.y - g.y, p.z - g.z);
        const s = Math.min(threat, 700) - travel * 0.45 + M.rand(0, 80);
        if (s > bs) { bs = s; best = p; }
      }
      // if nobody is close, just eat where we stand
      let nearest = 1e9;
      for (const o of w.gulls) if (o !== g) nearest = Math.min(nearest, Math.hypot(o.x - g.x, o.y - g.y));
      if (g.grounded && nearest > 380 && !g.inWater) return { x: g.x, y: g.y, z: g.floor, here: true };
      return best || { x: g.x, y: g.y, z: g.floor, here: true };
    }

    // Steer towards a 3D point. Returns horizontal distance.
    steer(tx, ty, tz, precise) {
      const g = this.g;
      const dx = tx - g.x, dy = ty - g.y;
      const dist = Math.hypot(dx, dy * 1.3);
      const dead = precise ? 6 : 14;
      if (dist > dead) {
        const k = Math.min(1, dist / (precise ? 60 : 30));
        const n = Math.hypot(dx, dy) || 1;
        this.inp.mx = (dx / n) * k; this.inp.my = (dy / n) * k;
      }
      // altitude control
      const needUp = tz - g.z;
      if (g.grounded) {
        if (needUp > 30 || (dist > 300 && !precise)) this.press('flap');
      } else if (needUp > 12 && g.vz < 140 && this.flapGap <= 0) {
        this.press('flap'); this.flapGap = 0.14;
      }
      return dist;
    }

    // Time for a swoop to drop `d` px (vz0 = -640, extra accel 300 px/s^2).
    static tDrop(d) { return (-640 + Math.sqrt(640 * 640 + 600 * Math.max(0, d))) / 300; }
    // Time for a swoop to cover a horizontal displacement (x speed 700, depth speed 434).
    static tTravel(dx, dy) { return Math.hypot(dx / 700, dy / 434); }
    // Where to hover so a swoop along unit direction (ux,uy) lands on (tx,ty) from height z.
    static standoff(tx, ty, tz, z, ux, uy) {
      const s = SG.depthScale(ty);
      const t = GullBrain.tDrop(z + 36 * s - tz);
      const k = t / (Math.hypot(ux / 700, uy / 434) || 1e-6);
      return { x: tx - ux * k, y: ty - uy * k };
    }

    // Line up a swoop at a target point (the beak should meet it). Returns true if launched.
    trySwoop(tx, ty, tz) {
      const g = this.g;
      if (g.grounded || g.swoopCd > 0 || g.z < 55) return false;
      const s = SG.depthScale(ty);
      const dx0 = tx - g.x, dy = ty - g.y;
      const dx = dx0 - Math.sign(dx0 || g.facing) * 34 * s; // beak sits ahead of the body
      const drop = g.z + 36 * s - tz;
      if (drop < 25) return false;
      const tNeed = GullBrain.tDrop(drop), tHave = GullBrain.tTravel(dx, dy);
      if (Math.abs(tNeed - tHave) < 0.045 + this.cfg.err * 0.0008 && tHave < 0.5) {
        const ex = dx / 700, ey = dy / 434;
        const n = Math.hypot(ex, ey) || 1;
        this.inp.mx = ex / n; this.inp.my = ey / n;
        this.aim = [ex / n, ey / n];
        this.press('peck');
        return true;
      }
      return false;
    }

    act(dt) {
      const g = this.g, w = g.world, goal = this.goal;
      if (!goal) return;
      const cruise = 150 + (g.slot % 2) * 30;
      switch (goal.kind) {
        case 'eat': {
          const sp = goal.spot;
          let threat = 1e9;
          for (const o of w.gulls) if (o !== g) threat = Math.min(threat, Math.hypot(o.x - g.x, (o.y - g.y) * 1.2, o.z - g.z));
          const there = Math.hypot(sp.x - g.x, (sp.y - g.y) * 1.2) < 22 && Math.abs(g.z - sp.z) < 6 && g.grounded;
          if ((there || sp.here) && g.grounded && threat > 150) {
            this.held.peck = true; // munch
            if (threat < 230 && this.cfg.react < 0.3 && Math.random() < dt * 2) { this.goal.spot = this.pickPerch(); this.press('flap'); }
          } else if (threat < 140 && g.grounded) {
            this.goal.spot = this.pickPerch();
            this.press('flap');
          } else {
            const above = Math.hypot(sp.x - g.x, sp.y - g.y) > 60 ? Math.max(sp.z + 70, cruise) : sp.z;
            this.steer(sp.x, sp.y, above, true);
          }
          break;
        }
        case 'item': {
          const it = goal.item;
          const tz = it.counter ? 30 : it.z;
          const hd = Math.hypot(it.x - g.x, it.y - g.y);
          if (g.grounded && hd < 150 && !it.counter) {
            this.steer(it.x - g.facing * 30, it.y, 0, true);
            if (Math.abs(it.x - (g.x + g.facing * 40)) < 40 && Math.abs(it.y - g.y) < 24) this.press('peck');
            if (hd > 70 && this.cfg.react < 0.3) this.held.dash = true;
          } else if (!this.trySwoop(it.x + this.errX * 0.2, it.y, tz)) {
            const z = Math.max(cruise * 0.8, tz + 110);
            const ang = Math.atan2(it.y - g.y, it.x - g.x);
            const sp = GullBrain.standoff(it.x, it.y, tz, z, Math.cos(ang), Math.sin(ang));
            this.steer(sp.x, M.clamp(sp.y, 556, 1040), z);
          }
          break;
        }
        case 'person': {
          const p = goal.p;
          const fp = p.foodPos();
          const va = p.viewAngle();
          // approach from behind the person's gaze (flank)
          const flank = this.cfg.flank;
          const bx = -Math.cos(va) * flank + Math.cos(Math.atan2(g.y - p.y, g.x - p.x)) * (1 - flank);
          const by = -Math.sin(va) * flank + Math.sin(Math.atan2(g.y - p.y, g.x - p.x)) * (1 - flank);
          const bn = Math.hypot(bx, by) || 1;
          const z = Math.max(cruise, p.headZ() + 60);
          const sp = GullBrain.standoff(fp.x, fp.y, fp.z, z, -bx / bn, -by / bn);
          const px = sp.x + this.errX * 0.3, py = M.clamp(sp.y, 560, 1040);
          if (p.alert > 0.55 && p.visionOff <= 0) {
            if (g.poopAmmo > 0 && this.cfg.poop > 0.5) {
              // they've spotted us: hover over their head and bomb them to break their guard
              const lead = (g.vx * 0.2);
              this.steer(p.x - lead, p.y, p.headZ() + 110, true);
              if (Math.abs(p.x - (g.x + lead)) < 18 && Math.abs(p.y - g.y) < 14 && g.z > p.headZ() + 40) this.press('poop');
            } else {
              this.steer(fp.x + (bx / bn) * 240, M.clamp(fp.y + (by / bn) * 120, 560, 1040), z + 40);
              if (Math.random() < dt * 0.8) this.thinkT = 0;
            }
          } else if (!this.trySwoop(fp.x, fp.y, fp.z)) {
            this.steer(px, py, z);
          }
          break;
        }
        case 'bin': {
          const b = goal.bin;
          const side = g.x < b.x ? -1 : 1;
          const tx = b.x + side * 46, ty = b.y + 4;
          const dist = this.steer(tx, ty, 0, true);
          if (dist < 300 && !g.grounded && g.z > 40) { /* descend */ }
          if (g.grounded && dist < 26) {
            g.facing = -side;
            if (this.cfg.react < 0.2 && g.dashCd <= 0 && Math.random() < dt * 0.5) { this.inp.mx = -side; this.press('dash'); }
            else this.press('peck');
          }
          break;
        }
        case 'gull': {
          const v = goal.v;
          goal.t = (goal.t || 0) + dt;
          if (g.grounded && v.grounded && Math.hypot(v.x - g.x, v.y - g.y) < 170 && g.dashCd <= 0) {
            const dx = v.x - g.x, dy = v.y - g.y, n = Math.hypot(dx, dy) || 1;
            this.inp.mx = dx / n; this.inp.my = dy / n;
            if (Math.abs(dy) < 30) this.press('dash');
          } else if (!this.trySwoop(v.x + v.vx * 0.15, v.y + v.vy * 0.15, v.z + 20)) {
            const ang = Math.atan2(v.y - g.y, v.x - g.x);
            const z = Math.min(SG.SKY_Z - 10, Math.max(v.z + 110, cruise));
            const sp = GullBrain.standoff(v.x, v.y, v.z + 20, z, Math.cos(ang), Math.sin(ang));
            this.steer(sp.x, M.clamp(sp.y, 556, 1040), z);
            if (g.grounded && Math.hypot(v.x - g.x, v.y - g.y) < 60) this.press('peck');
          }
          break;
        }
        case 'wander': {
          goal.t -= dt;
          this.steer(goal.x, goal.y, goal.z);
          break;
        }
      }
    }
  }
  SG.GullBrain = GullBrain;
})(window.SG);
