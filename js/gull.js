// ---------------------------------------------------------------------------
// Gull: the player character (also driven by the CPU brain via the same input).
// Input object shape: { mx, my, held:{flap,peck,poop,dash,squawk}, pressed:{...} }
// ---------------------------------------------------------------------------
(function (SG) {
  'use strict';
  const M = SG.M;

  const T = {
    walk: 250, walkY: 175,
    run: 440, runY: 310,
    burst: 800, burstTime: 0.26, dashCd: 0.7,
    air: 380, airY: 270, airAccel: 1300,
    gravity: 1150, glideFall: -115, maxFall: -760,
    flap: 410, takeoff: 470, flapCd: 0.15,
    swoopH: 700, swoopV: 640, swoopTime: 0.55, swoopCd: 0.65,
    peckTime: 0.24, peckCd: 0.32,
    biteTime: 0.42,
    poopCd: 0.28, poopRegen: 4.5, poopMax: 3,
    squawkCd: 0.9,
  };
  SG.GULL_TUNING = T;

  class Gull {
    constructor(world, slot, opts) {
      this.world = world;
      this.slot = slot;
      this.color = opts.color || SG.PLAYER_COLORS[slot];
      this.dark = opts.dark || SG.PLAYER_DARK[slot];
      this.name = opts.name || SG.PLAYER_NAMES[slot];
      this.hat = opts.hat || 'none';
      this.cpu = !!opts.cpu;
      this.deviceId = opts.deviceId || null;
      this.voice = opts.voice || [1.0, 0.86, 1.14, 1.26][slot % 4];
      this.brain = this.cpu ? new SG.GullBrain(this, opts.level === undefined ? 1 : opts.level) : null;
      this.reset(opts.x || 400, opts.y || 700, opts.z || 0);
      this.score = 0;
      this.stats = { steals: 0, sneaky: 0, poopsHit: 0, gullsSplatted: 0, bins: 0, dropped: 0, hits: 0, swatted: 0, squawks: 0, eaten: 0, golden: 0 };
    }

    reset(x, y, z) {
      this.x = x; this.y = y; this.z = z || 0;
      this.vx = 0; this.vy = 0; this.vz = 0;
      this.facing = x > SG.W / 2 ? -1 : 1;
      this.grounded = true; this.floor = 0; this.inWater = false;
      this.carry = null;
      this.poopAmmo = T.poopMax; this.poopTimer = 0; this.poopCd = 0;
      this.peckT = 0; this.peckCd = 0; this.peckDone = false;
      this.dashT = 0; this.dashCd = 0; this.dashDir = [1, 0]; this.running = false;
      this.swoopT = 0; this.swoopCd = 0; this.swoopDir = [1, 0];
      this.stunT = 0; this.invulnT = 0; this.splatT = 0;
      this.flapCd = 0; this.flapAnim = 0; this.flapPhase = 0;
      this.squawkCd = 0; this.beakOpenT = 0;
      this.eating = false; this.eatT = 0;
      this.pickupCd = 0;
      this.anim = Math.random() * 10;
      this.blinkT = 2 + Math.random() * 3;
      this.frozen = false;
      this.hitBy = new Set(); // victims of the current swoop/dash
    }

    get weight() { return this.carry ? SG.FOODS[this.carry.type].weight : 0; }
    get airborne() { return !this.grounded; }
    get busy() { return this.stunT > 0; }

    // Beak tip world position (for grabs).
    beak() {
      const s = SG.depthScale(this.y);
      return { x: this.x + this.facing * 40 * s, y: this.y, z: this.z + 36 * s };
    }
    // Body centre (for hits).
    body() { return { x: this.x, y: this.y, z: this.z + 30 * SG.depthScale(this.y) }; }

    update(dt, inp) {
      const w = this.world;
      this.anim += dt;
      // ---- timers
      this.peckCd -= dt; this.dashCd -= dt; this.swoopCd -= dt; this.flapCd -= dt; this.squawkCd -= dt;
      this.flapAnim -= dt; this.beakOpenT -= dt; this.pickupCd -= dt;
      if (this.invulnT > 0) this.invulnT -= dt;
      if (this.splatT > 0) this.splatT -= dt;
      this.blinkT -= dt; if (this.blinkT < -0.12) this.blinkT = 2 + Math.random() * 4;
      if (this.poopAmmo < T.poopMax) { this.poopTimer += dt; if (this.poopTimer >= T.poopRegen) { this.poopTimer = 0; this.poopAmmo++; } }
      else this.poopTimer = 0;

      if (this.frozen) { inp = SG.NO_INPUT; }

      const stunned = this.stunT > 0;
      if (stunned) { this.stunT -= dt; inp = SG.NO_INPUT; this.running = false; this.eating = false; }

      const w8 = this.weight;
      const slow = this.splatT > 0 ? 0.62 : 1;
      let mx = inp.mx || 0, my = inp.my || 0;
      if (Math.abs(mx) > 0.2 && this.swoopT <= 0 && this.dashT <= 0) this.facing = mx > 0 ? 1 : -1;

      // ---- actions -------------------------------------------------------
      // Squawk
      if (inp.pressed.squawk && this.squawkCd <= 0) {
        this.squawkCd = T.squawkCd; this.beakOpenT = 0.45;
        SG.Audio.sfx('squawk', { pitch: this.voice * M.rand(0.95, 1.05), pan: SG.panFor(this.x) });
        this.stats.squawks++;
        w.onSquawk(this);
      }
      // Poop
      this.poopCd -= dt;
      if (inp.pressed.poop && this.poopCd <= 0) {
        if (this.poopAmmo > 0) {
          this.poopAmmo--; this.poopCd = T.poopCd;
          const s = SG.depthScale(this.y);
          w.poops.push(new SG.Poop(w, this, this.x - this.facing * 16 * s, this.y, this.z + 18 * s, this.vx * 0.55, this.vy * 0.55));
          SG.Audio.sfx('poop', { pan: SG.panFor(this.x), pitch: this.voice });
        } else {
          w.fx.text('empty!', this.x, this.y - this.z - 80, { size: 20, color: '#cfd8e3', life: 0.6 });
        }
      }

      // Eating (hold peck while carrying, on any floor)
      if (this.carry && this.grounded && inp.held.peck && !stunned && Math.hypot(mx, my) < 0.5) {
        if (!this.eating) { this.eating = true; this.eatT = 0; }
        this.eatT += dt;
        if (this.eatT >= T.biteTime) { this.eatT = 0; this.bite(); }
      } else {
        this.eating = false; this.eatT = Math.max(0, this.eatT - dt);
      }

      // Peck (ground) / Swoop (air)
      if (inp.pressed.peck && !stunned) {
        if (this.grounded) {
          if (!this.carry && this.peckCd <= 0) {
            this.peckT = T.peckTime; this.peckCd = T.peckCd; this.peckDone = false;
            SG.Audio.sfx('peck', { pan: SG.panFor(this.x), pitch: M.rand(0.9, 1.15) });
          }
        } else if (this.swoopCd <= 0 && this.z > this.floor + 34 && this.swoopT <= 0) {
          let dx = mx, dy = my;
          const mag = Math.hypot(dx, dy);
          if (mag < 0.25) { dx = this.facing; dy = 0; } else { dx /= mag; dy /= mag; }
          this.swoopDir = [dx, dy];
          if (Math.abs(dx) > 0.1) this.facing = dx > 0 ? 1 : -1;
          this.swoopT = T.swoopTime; this.swoopCd = T.swoopCd;
          this.vx = dx * T.swoopH * slow; this.vy = dy * T.swoopH * 0.62 * slow; this.vz = -T.swoopV;
          this.hitBy.clear();
          SG.Audio.sfx('swoop', { pan: SG.panFor(this.x), pitch: this.voice });
        }
      }
      if (this.peckT > 0) {
        this.peckT -= dt;
        if (!this.peckDone && this.peckT < T.peckTime - 0.06) { this.peckDone = true; w.peck(this); }
      }

      // Dash
      if (inp.pressed.dash && this.dashCd <= 0 && !stunned && !this.inWater && this.swoopT <= 0) {
        let dx = mx, dy = my;
        const mag = Math.hypot(dx, dy);
        if (mag < 0.25) { dx = this.facing; dy = 0; } else { dx /= mag; dy /= mag; }
        this.dashDir = [dx, dy];
        this.dashT = this.grounded ? T.burstTime : T.burstTime * 0.85;
        this.dashCd = T.dashCd;
        this.hitBy.clear();
        this.eating = false;
        SG.Audio.sfx('dash', { pan: SG.panFor(this.x) });
        w.fx.puff(this.x - dx * 20, this.y, this.z, 4, '#ffffff', 60);
        if (!this.grounded) this.vz = Math.max(this.vz, 60);
      }
      this.running = !!(inp.held.dash && this.grounded && !this.inWater && !stunned && !this.eating);

      // Flap / take off
      if (inp.pressed.flap && !stunned && this.flapCd <= 0) {
        const lift = 1 - w8 * 0.36;
        if (this.grounded) {
          this.vz = T.takeoff * lift * (this.inWater ? 0.85 : 1);
          this.grounded = false; this.eating = false;
          SG.Audio.sfx('takeoff', { pan: SG.panFor(this.x), vol: 0.7 });
          w.fx.puff(this.x, this.y, this.z, 3, this.inWater ? '#dff6ff' : '#ffffff', 70);
          if (this.inWater) w.fx.splash(this.x, this.y, 0.5);
        } else {
          this.vz = Math.max(this.vz * 0.3, 0) + T.flap * lift;
          SG.Audio.sfx('flap', { pan: SG.panFor(this.x), vol: 0.5, pitch: M.rand(0.9, 1.1) });
        }
        this.flapCd = T.flapCd; this.flapAnim = 0.22;
        if (this.swoopT > 0) this.swoopT = Math.min(this.swoopT, 0.02);
      }

      // ---- movement ------------------------------------------------------
      let tvx, tvy, accel;
      if (this.swoopT > 0) {
        this.swoopT -= dt;
        // slight steering
        this.vx += mx * 500 * dt; this.vy += my * 300 * dt;
        this.vz -= 300 * dt;
        accel = 0;
        w.swoopCheck(this);
        if (this.swoopT <= 0 || this.z <= this.floor + 2) this.endSwoop();
      } else if (this.dashT > 0) {
        this.dashT -= dt;
        const sp = T.burst * (1 - w8 * 0.25) * slow;
        this.vx = this.dashDir[0] * sp; this.vy = this.dashDir[1] * sp * 0.7;
        if (Math.abs(this.dashDir[0]) > 0.1) this.facing = this.dashDir[0] > 0 ? 1 : -1;
        w.dashCheck(this);
        accel = 0;
      } else if (this.grounded) {
        let spx, spy;
        if (this.inWater) { spx = 160; spy = 110; }
        else if (this.running) { spx = T.run; spy = T.runY; }
        else { spx = T.walk; spy = T.walkY; }
        const k = (1 - w8 * 0.2) * slow;
        tvx = (this.eating ? 0 : mx) * spx * k;
        tvy = (this.eating ? 0 : my) * spy * k;
        accel = stunned ? 900 : 2600;
        this.vx = M.approach(this.vx, tvx, accel * dt);
        this.vy = M.approach(this.vy, tvy, accel * dt);
        if (this.running && Math.hypot(mx, my) > 0.3) w.runPickup(this);
      } else {
        const k = (1 - w8 * 0.22) * slow;
        tvx = mx * T.air * k; tvy = my * T.airY * k;
        accel = stunned ? 300 : T.airAccel;
        this.vx = M.approach(this.vx, tvx, accel * dt);
        this.vy = M.approach(this.vy, tvy, accel * dt);
      }

      // Vertical
      if (!this.grounded && this.swoopT <= 0) {
        this.vz -= T.gravity * (stunned ? 1.1 : 1) * dt;
        if (inp.held.flap && this.vz < T.glideFall && !stunned) this.vz = M.approach(this.vz, T.glideFall * (1 + w8 * 0.8), 2600 * dt);
        if (this.vz < T.maxFall) this.vz = T.maxFall;
      }

      // Integrate with box collisions
      const nx = M.clamp(this.x + this.vx * dt, 22, SG.W - 22);
      if (!w.blocked(nx, this.y, this.z)) this.x = nx; else { this.vx = 0; if (this.dashT > 0) this.dashT = 0; }
      const ny = M.clamp(this.y + this.vy * dt, 552, SG.WATER_MAX_Y);
      if (!w.blocked(this.x, ny, this.z)) this.y = ny; else { this.vy = 0; }
      this.z += this.vz * dt;
      if (this.z > SG.SKY_Z) { this.z = SG.SKY_Z; if (this.vz > 0) this.vz = 0; }

      // Floor
      this.floor = w.floorAt(this.x, this.y, this.z);
      this.inWater = this.floor <= 0 && w.isWater(this.x, this.y);
      if (this.z <= this.floor) {
        if (!this.grounded) {
          if (this.vz < -480) { w.fx.puff(this.x, this.y, this.floor, 4, this.inWater ? '#dff6ff' : '#ffffff', 80); }
          if (this.inWater && this.vz < -200) { w.fx.splash(this.x, this.y, 0.7); SG.Audio.sfx('splash', { vol: 0.5, pan: SG.panFor(this.x) }); }
        }
        this.z = this.floor; this.vz = 0;
        if (this.swoopT > 0) this.endSwoop();
        this.grounded = this.swoopT <= 0 && !(this.vz > 0);
      } else if (this.z > this.floor + 1) {
        this.grounded = false;
      }
      if (this.grounded && this.vz > 0) this.grounded = false;

      this.carryT = this.carry && !this.eating ? (this.carryT || 0) + dt : 0;
      // Flap animation phase
      const flapSpeed = this.grounded ? 0 : (this.flapAnim > 0 ? 26 : (this.vz > 0 ? 18 : 9));
      this.flapPhase += dt * flapSpeed;
    }

    endSwoop() {
      this.swoopT = 0;
      if (this.z <= this.floor + 3) {
        // skid on landing, then hop back up a bit like a real gull pulling out of a dive
        this.vx *= 0.45; this.vy *= 0.45;
        this.vz = 230; this.grounded = false; this.z = this.floor + 1;
        this.world.fx.puff(this.x, this.y, this.floor, 5, this.inWater ? '#dff6ff' : '#ffffff', 110);
        if (this.inWater) { this.world.fx.splash(this.x, this.y, 0.8); SG.Audio.sfx('splash', { vol: 0.5, pan: SG.panFor(this.x) }); }
      } else {
        this.vz = 260;
        this.vx *= 0.6; this.vy *= 0.6;
      }
    }

    bite() {
      const c = this.carry;
      if (!c) return;
      const def = SG.FOODS[c.type];
      c.bites--;
      const pts = this.world.award(this, def.pts, 'bite');
      this.stats.eaten += pts;
      this.poopAmmo = Math.min(T.poopMax, this.poopAmmo + 1);
      const s = SG.depthScale(this.y);
      this.world.fx.crumbs(this.x + this.facing * 40 * s, this.y, this.z + 34 * s, 5, c.type === 'icecream' ? '#fff6e6' : '#e9a23b');
      SG.Audio.sfx('chomp', { pan: SG.panFor(this.x), pitch: M.rand(0.9, 1.1) });
      SG.Audio.sfx('ding', { pan: SG.panFor(this.x), pitch: 1 + (def.bites - c.bites) * 0.12, vol: 0.6 });
      if (c.bites <= 0) {
        this.carry = null;
        SG.Audio.sfx('gulp', { pan: SG.panFor(this.x), pitch: this.voice });
        this.world.fx.text('GULP!', this.x, this.y - this.z - 95 * s, { size: 30, color: '#ffe680' });
        this.world.onFoodFinished(this, c.type);
      }
    }

    // Pick something up into the beak. Small items are swallowed instantly.
    take(type, bites, how) {
      const def = SG.FOODS[type];
      if (def.small) {
        const pts = this.world.award(this, def.pts * bites, how || 'scrap');
        this.stats.eaten += pts;
        this.poopAmmo = Math.min(T.poopMax, this.poopAmmo + 1);
        SG.Audio.sfx('gulp', { pan: SG.panFor(this.x), pitch: this.voice * 1.2, vol: 0.7 });
        return true;
      }
      if (this.carry) return false;
      this.carry = { type, bites };
      this.pickupCd = 0.2;
      if (type === 'golden') this.stats.golden++;
      return true;
    }

    // Drop whatever is carried. Returns the Item (or null).
    drop(dirx, diry, power) {
      if (!this.carry) return null;
      const b = this.beak();
      const it = new SG.Item(this.world, this.carry.type, b.x, this.y, Math.max(b.z, this.floor + 10), this.carry.bites);
      it.toss((dirx || 0) * (power || 160) + M.rand(-40, 40), (diry || 0) * (power || 160) * 0.5 + M.rand(-25, 25), 320 + M.rand(0, 120));
      it.noPickup = 0.35;
      this.world.items.push(it);
      this.carry = null;
      this.eating = false;
      this.stats.dropped++;
      SG.Audio.sfx('pop', { pan: SG.panFor(this.x), vol: 0.6 });
      return it;
    }

    // Knocked by something. Returns true if it landed.
    hit(dirx, diry, power, stun, attacker, cause) {
      if (this.invulnT > 0) return false;
      const mag = Math.hypot(dirx, diry) || 1;
      dirx /= mag; diry /= mag;
      this.vx = dirx * power; this.vy = diry * power * 0.55;
      this.vz = Math.max(this.vz, 200 + power * 0.25);
      this.grounded = false;
      this.stunT = stun; this.invulnT = stun + 0.75;
      this.swoopT = 0; this.dashT = 0; this.peckT = 0; this.eating = false; this.running = false;
      const dropped = this.drop(dirx, diry, power * 0.5);
      const s = SG.depthScale(this.y);
      this.world.fx.feathers(this.x, this.y, this.z + 20 * s, 6, '#fff');
      this.world.fx.impact(this.x, this.y, this.z + 30 * s);
      SG.Audio.sfx('thud', { pan: SG.panFor(this.x) });
      SG.Audio.sfx('squawk', { pitch: this.voice * 1.25, vol: 0.55, pan: SG.panFor(this.x) });
      SG.Input.rumble(this.deviceId, 0.8, 0.5, 180);
      if (attacker && attacker.deviceId) SG.Input.rumble(attacker.deviceId, 0.3, 0.6, 90);
      this.world.shake(cause === 'swoop' ? 8 : 5);
      return { dropped };
    }

    pose() {
      if (this.stunT > 0) return 'stun';
      if (this.swoopT > 0) return 'swoop';
      if (!this.grounded) {
        if (this.flapAnim > 0 || this.vz > 40) return 'fly';
        return this.vz < -300 ? 'fly' : 'glide';
      }
      if (this.inWater) return 'float';
      if (this.dashT > 0 || (this.running && Math.hypot(this.vx, this.vy) > 60)) return 'run';
      if (Math.hypot(this.vx, this.vy) > 30) return 'walk';
      return 'idle';
    }

    draw(ctx) {
      const s = SG.depthScale(this.y);
      const flash = this.invulnT > 0 && this.stunT <= 0 && Math.floor(this.anim * 16) % 2 === 0;
      const pose = this.pose();
      SG.Art.gull(ctx, {
        x: this.x, y: this.y - this.z, s: s * 1.08, facing: this.facing, pose, t: this.anim,
        flap: this.flapPhase, color: this.color, hat: this.hat,
        carry: this.carry ? this.carry.type : null,
        beakOpen: this.beakOpenT > 0 || (this.peckT > 0) || (this.eating && Math.sin(this.anim * 16) > 0),
        eat: this.eating, splat: this.splatT > 0, stun: this.stunT > 0, blink: this.blinkT < 0,
        alpha: flash ? 0.45 : 1,
      });
    }
  }
  SG.Gull = Gull;

  SG.NO_INPUT = { mx: 0, my: 0, held: {}, pressed: {} };
})(window.SG);
