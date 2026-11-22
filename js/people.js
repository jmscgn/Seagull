// ---------------------------------------------------------------------------
// People, shops (with shopkeepers), bins and the dog.
// ---------------------------------------------------------------------------
(function (SG) {
  'use strict';
  const M = SG.M;
  const HALF_PI = Math.PI / 2;

  SG.LINES = {
    robbed: ['OI!', 'MA CHIPS!', 'Ya wee rascal!', 'Get tae!', 'Haw! Gie that back!', 'Ma supper!', 'Flippin’ gulls!', 'Thief!', 'Ach, no again!', 'Ya bampot!'],
    poop: ['EUGH!', 'Aw, naw!', 'Mingin’!', 'On ma heid?!', 'BOAK!', 'Lucky, apparently...'],
    notice: ['Don’t even think aboot it', 'I see you...', 'Mine!', 'Naw ye don’t!', 'Gonnae no?', 'Shoo!'],
    kid: ['WAAAH!', 'MUMMYYY!', 'Ma ice cream!'],
    swat: ['Shoo!', 'Get away!', 'Gerroff!', 'Away!'],
    startle: ['Jings!', 'Crivens!', 'Help ma boab!', 'Ah!'],
    counter: ['Where’s ma order?!', 'That was MINE!'],
    keeper: ['Oot!', 'No in ma shop!', 'Shoo, ya pest!', 'Get oot!'],
    vip: ['Nae gull’s getting ma golden supper!'],
    vipRobbed: ['MA GOLDEN SUPPER!', 'NOOOO!'],
  };

  const KINDS = {
    tourist:   { w: 30, hs: 1.0,  ws: 1.0,  speed: [70, 92],  range: 330, fov: 110, hats: ['bucket', 'sunhat', 'cap', null], umbrella: 0.55, hair: null },
    kid:       { w: 15, hs: 0.66, ws: 0.86, speed: [92, 118], range: 270, fov: 120, hats: ['cap', 'beanie', null], umbrella: 0, foods: ['icecream', 'icecream', 'chips', 'doughnut'] },
    granny:    { w: 14, hs: 0.92, ws: 1.08, speed: [52, 66],  range: 250, fov: 100, hats: [null, null, 'sunhat'], umbrella: 0.85, hair: '#f0e6d2', hairStyle: 'curly', glasses: 0.7 },
    dad:       { w: 14, hs: 1.08, ws: 1.25, speed: [74, 90],  range: 350, fov: 110, hats: ['beanie', 'flatcap', null, 'cap'], umbrella: 0.3 },
    teen:      { w: 10, hs: 0.96, ws: 0.9,  speed: [70, 88],  range: 210, fov: 64,  hats: [null], umbrella: 0, phone: true },
    fisherman: { w: 5,  hs: 1.02, ws: 1.12, speed: [66, 80],  range: 360, fov: 120, hats: ['beanie'], umbrella: 0, top: '#ffd23f', bottom: '#ffd23f' },
  };
  SG.PERSON_KINDS = KINDS;

  // ------------------------------------------------------------------ Person
  let pid = 1;
  class Person {
    constructor(world, kind, opts) {
      opts = opts || {};
      this.id = pid++;
      this.world = world;
      this.kind = kind;
      const K = KINDS[kind] || KINDS.tourist;
      this.K = K;
      this.hs = K.hs * M.rand(0.96, 1.04); this.ws = K.ws * M.rand(0.95, 1.05);
      this.speed = M.rand(K.speed[0], K.speed[1]);
      this.range = K.range; this.fov = (K.fov * Math.PI) / 180;
      // looks
      this.skin = M.pick(SG.Art.SKIN);
      this.hair = K.hair || M.pick(SG.Art.HAIR.slice(0, 6));
      this.hairStyle = K.hairStyle || M.pick(['short', 'short', 'long', 'pony', 'curly', 'spiky', 'bald']);
      this.top = K.top || M.pick(SG.Art.TOPS);
      this.bottom = K.bottom || M.pick(SG.Art.BOTTOMS);
      this.hat = M.pick(K.hats);
      this.hatColor = M.pick(['#f4e1a1', '#e84a5f', '#2f6f9f', '#7bd389', '#ffd23f', '#a29bfe']);
      this.glasses = K.glasses ? M.chance(K.glasses) : M.chance(0.15);
      this.phone = !!K.phone;
      this.hasUmbrella = M.chance(K.umbrella);
      this.umbrellaColor = M.pick(['#e84a5f', '#3a86ff', '#ffd23f', '#2ec27e', '#a06cff', '#ff9f43']);
      if (kind === 'kid') this.hairStyle = M.pick(['short', 'pony', 'curly', 'spiky']);
      if (this.hairStyle === 'bald' && kind !== 'dad' && kind !== 'tourist') this.hairStyle = 'short';
      Object.assign(this, opts.look || {});

      this.x = opts.x; this.y = opts.y;
      this.angle = opts.x < SG.W / 2 ? 0 : Math.PI;
      this.lookAngle = this.angle; this.lookT = 0; this.glanceT = M.rand(2, 5);
      this.drawFacing = Math.cos(this.angle) >= 0 ? 1 : -1;
      this.food = opts.food ? { type: opts.food, bites: SG.FOODS[opts.food].bites } : null;
      this.state = 'walk';
      this.stateT = 0;
      this.goal = null;
      this.path = [];
      this.alert = 0; this.shielding = false; this.threat = null;
      this.visionOff = 0;
      this.swatT = 0; this.swatCd = 0; this.swatDone = false;
      this.bubble = null; this.bubbleCd = 0;
      this.eatT = M.rand(2.5, 5); this.eatAnim = 0;
      this.seat = null; this.shop = null;
      this.anim = Math.random() * 10;
      this.dead = false;
      this.splatT = 0;
      this.umbrellaUp = false;
      this.hurry = 1;
      this.mood = 'calm';
      this.stuckT = 0;
      this.vip = !!opts.vip;
      this.piper = !!opts.piper;
      this.rebuyChance = 0.45;
      this.noticedSay = false;
      this.distractedBy = null;
    }

    // --- helpers
    ds() { return SG.depthScale(this.y); }
    foodZ() { return (this.state === 'sit' ? 58 : 84) * this.hs * this.ds(); }
    headZ() { return (this.state === 'sit' ? 118 : 150) * this.hs * this.ds(); }
    foodPos() {
      const s = this.ds();
      return { x: this.x + this.drawFacing * 22 * s * this.hs, y: this.y + 1, z: this.foodZ() };
    }
    say(text, dur, force) {
      if (!force && (this.bubbleCd > 0 || this.world.bubbleCount() >= 4)) return;
      this.bubble = { text, t: 0, dur: dur || 1.8 };
      this.bubbleCd = 2.2;
    }
    setFacingTo(x, y) { this.angle = Math.atan2((y - this.y) * 1.3, x - this.x); this.lookAngle = this.angle; }

    walkTo(x, y, goal) {
      this.goal = goal || null;
      this.path = this.world.planPath(this.x, this.y, x, y, goal && goal.ignoreBox);
      this.state = 'walk';
      this.stateT = 0;
    }

    leave() {
      const ex = this.x < SG.W / 2 ? -80 : SG.W + 80;
      this.walkTo(ex, M.clamp(this.y + M.rand(-60, 60), 620, 870), { kind: 'exit' });
      if (this.seat) { this.seat.taken = null; this.seat = null; }
      if (this.shop) { this.shop.leaveQueue(this); this.shop = null; }
    }

    // --- main update
    update(dt) {
      const w = this.world;
      this.anim += dt;
      this.stateT += dt;
      if (this.bubble) { this.bubble.t += dt; if (this.bubble.t > this.bubble.dur) this.bubble = null; }
      this.bubbleCd -= dt;
      this.swatCd -= dt;
      if (this.splatT > 0) this.splatT -= dt;
      if (this.visionOff > 0) this.visionOff -= dt;
      if (this.lookT > 0) this.lookT -= dt;

      // rain behaviour
      const raining = w.rain > 0.4;
      if (raining && this.hasUmbrella && !this.umbrellaUp && this.state !== 'distracted') { this.umbrellaUp = true; }
      if (!raining && this.umbrellaUp) this.umbrellaUp = false;
      this.hurry = raining && !this.umbrellaUp && !this.piper ? 1.7 : 1;

      this.updateVision(dt);

      // swat in progress
      if (this.swatT > 0) {
        this.swatT -= dt;
        if (!this.swatDone && this.swatT < 0.28) { this.swatDone = true; w.personSwat(this); }
      } else if (this.shielding && this.threat && this.swatCd <= 0 && this.visionOff <= 0) {
        const g = this.threat;
        const s = this.ds();
        if (Math.abs(g.x - this.x) < 95 * s && Math.abs(g.y - this.y) < 34 && g.z < this.headZ() + 30) {
          this.swatT = 0.45; this.swatDone = false; this.swatCd = 1.3;
          this.setFacingTo(g.x, g.y);
          if (M.chance(0.5)) this.say(M.pick(SG.LINES.swat), 1.0);
        }
      }

      switch (this.state) {
        case 'walk': this.updateWalk(dt); break;
        case 'queue': this.updateQueue(dt); break;
        case 'collect': this.updateCollect(dt); break;
        case 'sit': case 'stand': this.updateEating(dt); break;
        case 'angry':
          this.mood = 'angry';
          if (this.threat) this.setFacingTo(this.threat.x, this.threat.y);
          if (this.stateT > 1.7) { this.mood = 'calm'; this.afterRobbed(); }
          break;
        case 'distracted':
          this.mood = 'disgust';
          if (this.stateT > 3.0) { this.mood = 'calm'; this.state = this.prevState || 'walk'; if (this.state === 'walk' && this.path.length === 0) this.leave(); }
          break;
        case 'watch':
          this.mood = 'eat';
          if (w.piper && !w.piper.dead) { this.setFacingTo(w.piper.x, w.piper.y); this.visionOff = Math.max(this.visionOff, 0.2); }
          else { this.state = 'walk'; this.leave(); }
          if (this.stateT > 18) this.leave();
          this.updateEatingBites(dt);
          break;
        case 'piping':
          this.angle = HALF_PI; this.lookAngle = HALF_PI;
          break;
      }
      if (this.state !== 'angry' && this.state !== 'distracted' && this.state !== 'watch') {
        this.mood = this.shielding ? 'alert' : (this.eatAnim > 0 ? 'eat' : 'calm');
        if (this.alert > 0.35 && !this.shielding) this.mood = 'alert';
      }
      if (this.eatAnim > 0) this.eatAnim -= dt;

      // keep facing for drawing (avoid flicker when walking straight up/down)
      const va = this.viewAngle();
      const c = Math.cos(va);
      if (Math.abs(c) > 0.2) this.drawFacing = c >= 0 ? 1 : -1;

      if (this.x < -140 || this.x > SG.W + 140) this.dead = true;
    }

    viewAngle() {
      if (this.shielding && this.threat) return Math.atan2((this.threat.y - this.y) * 1.3, this.threat.x - this.x);
      if (this.lookT > 0) return this.lookAngle;
      return this.angle;
    }

    updateVision(dt) {
      const w = this.world;
      const hasValue = !!this.food;
      let best = 0, bestG = null;
      if (this.visionOff <= 0 && this.state !== 'piping') {
        const va = this.viewAngle();
        for (const g of w.gulls) {
          if (g.frozen) continue;
          const dx = g.x - this.x, dy = (g.y - this.y) * 1.4;
          const dist = Math.hypot(dx, dy);
          let range = this.range;
          if (g.z > 180) range *= 0.55;           // gulls high in the sky are easy to miss
          let v = 0;
          if (dist < range) {
            const diff = Math.abs(M.angDiff(va, Math.atan2(dy, dx)));
            if (diff < this.fov / 2) v = 1 - dist / range * 0.75;
          }
          // hearing: something scurrying right next to you
          if (g.grounded && (g.running || g.dashT > 0) && dist < 150) v = Math.max(v, 0.8);
          if (dist < 46 && g.z < 120) v = Math.max(v, 0.6);
          if (g === w.leader) v *= 1.35;   // the crowned leader stands out
          if (this.umbrellaUp && g.z > this.headZ()) v *= 0.4;
          if (v > best) { best = v; bestG = g; }
        }
      }
      const rate = hasValue ? 3.2 : 1.2;
      if (best > 0) {
        this.alert = Math.min(1, this.alert + best * rate * dt);
        this.threat = bestG;
      } else {
        this.alert = Math.max(0, this.alert - 0.4 * dt);
      }
      const was = this.shielding;
      if (hasValue && this.alert >= 0.72) this.shielding = true;
      if (this.alert < 0.28 || !hasValue) this.shielding = false;
      if (this.shielding && !was) {
        if (!this.noticedSay || M.chance(0.3)) this.say(this.vip ? SG.LINES.vip[0] : M.pick(SG.LINES.notice), 1.4);
        this.noticedSay = true;
        SG.Audio.sfx('gasp', { vol: 0.35, pan: SG.panFor(this.x), pitch: this.kind === 'kid' ? 1.4 : M.rand(0.85, 1.1) });
      }
      if (!this.shielding && this.alert < 0.1) this.threat = null;
    }

    move(dt, tx, ty, speedMul) {
      const sp = this.speed * (speedMul || 1) * this.hurry * (this.shielding ? 0.75 : 1);
      const dx = tx - this.x, dy = ty - this.y;
      const d = Math.hypot(dx, dy);
      if (d < 4) return true;
      const step = Math.min(d, sp * dt);
      const nx = this.x + (dx / d) * step, ny = this.y + (dy / d) * step;
      const ign = this.goal && this.goal.ignoreBox;
      if (!this.world.personBlocked(nx, ny, ign)) { this.x = nx; this.y = ny; this.stuckT = 0; }
      else if (!this.world.personBlocked(nx, this.y, ign)) { this.x = nx; }
      else if (!this.world.personBlocked(this.x, ny, ign)) { this.y = ny; }
      else { this.stuckT += dt; if (this.stuckT > 0.6) { this.stuckT = 0; this.y += M.rand(-30, 30); } }
      this.angle = Math.atan2(dy * 1.3, dx);
      // occasional glance to the side while walking
      this.glanceT -= dt;
      if (this.glanceT < 0) { this.glanceT = M.rand(3, 6); this.lookT = 0.9; this.lookAngle = this.angle + M.pick([-1, 1]) * M.rand(0.8, 1.8); }
      return false;
    }

    updateWalk(dt) {
      if (!this.path.length) { this.arrive(); return; }
      const [tx, ty] = this.path[0];
      if (this.move(dt, tx, ty)) {
        this.path.shift();
        if (!this.path.length) this.arrive();
      }
      if (this.food) this.updateEatingBites(dt, 1.6);
    }

    arrive() {
      const g = this.goal;
      if (!g) { this.leave(); return; }
      switch (g.kind) {
        case 'exit': this.dead = true; break;
        case 'shop': {
          const idx = g.shop.join(this);
          if (idx < 0) { this.decideAfterFood(); return; }
          this.shop = g.shop; this.state = 'queue'; this.stateT = 0;
          break;
        }
        case 'seat': {
          const seat = g.seat;
          if (seat.taken && seat.taken !== this) { this.decideAfterFood(); return; }
          seat.taken = this; this.seat = seat;
          this.x = seat.x; this.y = seat.y;
          this.angle = seat.angle; this.lookAngle = seat.angle;
          this.state = 'sit'; this.stateT = 0;
          this.sitTime = M.rand(14, 26);
          break;
        }
        case 'stand':
          this.angle = HALF_PI + M.rand(-0.3, 0.3); this.lookAngle = this.angle;
          this.state = 'stand'; this.stateT = 0; this.sitTime = M.rand(7, 12);
          break;
        case 'bin': {
          const bin = g.bin;
          if (!bin.tipped) { bin.fill = Math.min(5, bin.fill + 1); SG.Audio.sfx('rustle', { vol: 0.35, pan: SG.panFor(this.x) }); }
          else this.world.litter(this.x, this.y, 'wrapper');
          this.leave();
          break;
        }
        case 'watch':
          this.state = 'watch'; this.stateT = 0;
          break;
        case 'pipe':
          this.state = 'piping'; this.stateT = 0;
          break;
        default: this.leave();
      }
    }

    updateQueue(dt) {
      const shop = this.shop;
      if (!shop) { this.leave(); return; }
      const idx = shop.queue.indexOf(this);
      if (idx < 0) { this.leave(); return; }
      const slot = shop.queueSlot(idx);
      const arrived = this.move(dt, slot.x, slot.y, 0.8);
      if (arrived) { this.angle = -HALF_PI; if (this.lookT <= 0) this.lookAngle = -HALF_PI; }
      this.inPlace = arrived;
      // get bored waiting
      if (this.stateT > 30 && idx > 0) { shop.leaveQueue(this); this.shop = null; this.leave(); }
    }

    updateCollect(dt) {
      this.angle = -HALF_PI; this.lookAngle = -HALF_PI;
      if (this.stateT > 0.75) {
        const shop = this.shop;
        const it = shop && shop.counterItem;
        if (it && !it.dead) {
          this.food = { type: it.type, bites: it.bites };
          it.dead = true; shop.counterItem = null;
          SG.Audio.sfx('rustle', { vol: 0.25, pan: SG.panFor(this.x) });
          shop.served(this);
          this.shop = null;
          this.decideAfterFood();
        } else {
          // somebody nicked it off the counter!
          if (shop) shop.served(this);
          this.shop = null;
          this.say(M.pick(SG.LINES.counter), 1.8, true);
          this.state = 'angry'; this.stateT = 0;
        }
      }
    }

    decideAfterFood() {
      const w = this.world;
      if (!this.food) { this.leave(); return; }
      const r = Math.random();
      if (r < 0.55) {
        const seat = w.freeSeat(this.x, this.y);
        if (seat) { seat.taken = this; this.walkTo(seat.ax, seat.ay, { kind: 'seat', seat, ignoreBox: seat.box }); return; }
      }
      if (r < 0.75) {
        const x = M.clamp(this.x + M.rand(-300, 300), 80, SG.W - 80);
        this.walkTo(x, M.rand(840, 880), { kind: 'stand' });
        return;
      }
      // stroll off eating
      const ex = this.x < SG.W / 2 ? SG.W + 80 : -80;
      this.walkTo(ex, M.rand(640, 870), { kind: 'exit' });
    }

    updateEatingBites(dt, slowMul) {
      if (!this.food) return;
      this.eatT -= dt / (slowMul || 1);
      if (this.eatT <= 0 && !this.shielding && this.swatT <= 0) {
        this.eatT = M.rand(3.2, 6);
        this.eatAnim = 0.9;
        this.food.bites--;
        if (this.food.bites <= 0) {
          this.food = null;
          this.finishedFood();
        }
      }
    }

    finishedFood() {
      // bin it (good citizen) or litter (gull-friendly)
      const bin = this.world.nearestBin(this.x, this.y, 500);
      if (this.seat) { this.seat.taken = null; this.seat = null; }
      if (bin && M.chance(0.7)) this.walkTo(bin.ax, bin.ay, { kind: 'bin', bin });
      else { if (M.chance(0.6)) this.world.litter(this.x, this.y, M.pick(['wrapper', 'crust', 'chip'])); this.leave(); }
    }

    updateEating(dt) {
      this.updateEatingBites(dt);
      if (!this.food) return; // finishedFood() moved us on
      // glance around now and then
      this.glanceT -= dt;
      if (this.glanceT < 0) {
        this.glanceT = M.rand(2.5, 5.5);
        this.lookT = M.rand(0.8, 1.5);
        this.lookAngle = this.angle + M.pick([-1, 1]) * M.rand(0.9, 2.6);
      }
      if (this.stateT > (this.sitTime || 20)) {
        if (this.seat) { this.seat.taken = null; this.seat = null; }
        const ex = this.x < SG.W / 2 ? -80 : SG.W + 80;
        this.walkTo(ex, M.rand(640, 870), { kind: 'exit' });
      }
    }

    // ---- reactions
    robbed(gull, sneaky) {
      this.alert = 1; this.threat = gull; this.shielding = false;
      const lines = this.vip ? SG.LINES.vipRobbed : this.kind === 'kid' ? SG.LINES.kid : SG.LINES.robbed;
      this.say(M.pick(lines), 1.8, true);
      if (this.kind === 'kid') SG.Audio.sfx('wah', { pan: SG.panFor(this.x) });
      else SG.Audio.sfx('oi', { pan: SG.panFor(this.x), pitch: this.kind === 'granny' ? 1.35 : this.kind === 'dad' ? 0.85 : M.rand(0.95, 1.15) });
      if (this.state === 'sit' || this.state === 'stand' || this.state === 'walk' || this.state === 'watch') {
        this.prevState = this.state;
        this.state = 'angry'; this.stateT = 0;
      }
      if (this.kind === 'kid') this.mood = 'cry';
    }

    afterRobbed() {
      if (this.seat) { this.seat.taken = null; this.seat = null; }
      if (this.food) { this.state = this.prevState === 'sit' ? 'walk' : 'walk'; this.decideAfterFood(); return; }
      if (!this.vip && Math.random() < this.rebuyChance) {
        this.rebuyChance *= 0.5;
        const shop = this.world.pickShop(this.x);
        if (shop) { this.walkTo(shop.x + M.rand(-40, 40), 620, { kind: 'shop', shop }); return; }
      }
      this.leave();
    }

    pooped(gull) {
      this.splatT = 6;
      this.visionOff = 3.2;
      this.alert = 0; this.shielding = false;
      this.say(M.pick(this.kind === 'kid' ? SG.LINES.kid : SG.LINES.poop), 1.6, true);
      SG.Audio.sfx(this.kind === 'kid' ? 'wah' : 'eugh', { pan: SG.panFor(this.x), pitch: this.kind === 'granny' ? 1.3 : M.rand(0.9, 1.1) });
      if (this.state !== 'angry' && this.state !== 'collect' && this.state !== 'piping') {
        this.prevState = this.state === 'distracted' ? this.prevState : this.state;
        this.state = 'distracted'; this.stateT = 0;
      }
      let dropped = false;
      if (this.food && M.chance(this.kind === 'kid' ? 0.6 : this.vip ? 0.25 : 0.3)) { this.dropFood(gull); dropped = true; }
      return dropped;
    }

    dropFood(byGull) {
      if (!this.food) return null;
      const fp = this.foodPos();
      const it = new SG.Item(this.world, this.food.type, fp.x, fp.y, fp.z, this.food.bites);
      it.toss(this.drawFacing * M.rand(60, 140), M.rand(-30, 40), M.rand(180, 320));
      this.world.items.push(it);
      this.food = null;
      this.shielding = false;
      SG.Audio.sfx('pop', { pan: SG.panFor(this.x) });
      return it;
    }

    startled(gull) {
      // squawk nearby
      this.lookT = 1.4;
      this.lookAngle = Math.atan2((gull.y - this.y) * 1.3, gull.x - this.x);
      if (this.kind === 'kid' && this.food && this.alert < 0.5 && M.chance(0.45)) {
        this.say(M.pick(SG.LINES.kid), 1.4, true);
        SG.Audio.sfx('wah', { pan: SG.panFor(this.x), vol: 0.8 });
        this.dropFood(gull);
        return true;
      }
      this.alert = Math.min(1, this.alert + 0.3);
      if (M.chance(0.25)) this.say(M.pick(SG.LINES.startle), 1.1);
      return false;
    }

    pose() {
      if (this.state === 'piping') return 'stand';
      if (this.swatT > 0) return 'swat';
      if (this.state === 'distracted') return 'wipe';
      if (this.state === 'angry') return 'angry';
      if (this.state === 'collect') return 'reach';
      if (this.state === 'watch') return this.food && this.eatAnim > 0 ? 'eat' : 'clap';
      if (this.shielding && this.food) return 'shield';
      if (this.eatAnim > 0 && this.food) return 'eat';
      if (this.state === 'sit') return 'sit';
      if (this.state === 'walk') return this.hurry > 1.2 ? 'run' : 'walk';
      if (this.state === 'queue' && !this.inPlace) return 'walk';
      return 'stand';
    }

    draw(ctx, t) {
      const s = this.ds();
      const va = this.viewAngle();
      const back = Math.sin(va) < -0.55 && this.swatT <= 0 && this.state !== 'angry' && !(this.shielding && this.food);
      const pose = this.pose();
      SG.Art.person(ctx, {
        x: this.x, y: this.y, s: s * 1.0, facing: this.drawFacing, view: back ? 'back' : 'front',
        pose: pose === 'sit' && back ? 'sit' : pose, t: this.anim,
        kind: this.vip ? 'vip' : this.kind, hs: this.hs, ws: this.ws, skin: this.skin, hair: this.hair, hairStyle: this.hairStyle,
        top: this.top, bottom: this.bottom, hat: this.hat, hatColor: this.hatColor, glasses: this.glasses && !this.vip, shades: this.vip,
        phone: this.phone && !this.food, food: this.food ? this.food.type : null, mood: this.mood, splat: this.splatT > 0,
        umbrella: this.umbrellaUp, umbrellaColor: this.umbrellaColor, kilt: this.piper, pipes: this.piper && this.state === 'piping',
        look: Math.cos(va) * this.drawFacing,
      });
    }

    drawOverlay(ctx, t) {
      const s = this.ds();
      const headTop = this.y - this.headZ() - 22 * s;
      if (this.food && this.visionOff <= 0) {
        if (this.shielding) SG.Art.alertIcon(ctx, this.x, headTop - 12, '!', 1 + Math.sin(t * 14) * 0.08);
        else if (this.alert > 0.3) SG.Art.alertIcon(ctx, this.x, headTop - 12, '?', this.alert);
      }
      if (this.bubble) {
        const b = this.bubble;
        const pop = b.t < 0.15 ? M.easeOutBack(b.t / 0.15) : 1;
        const a = b.t > b.dur - 0.25 ? (b.dur - b.t) / 0.25 : 1;
        SG.Art.bubble(ctx, this.x + 10, headTop - (this.food && (this.shielding || this.alert > 0.3) ? 34 : 4), b.text, { size: 22, pop, alpha: a });
      }
    }

    // Vision cone on the ground (subtle readability aid).
    drawCone(ctx) {
      if (!this.food || this.visionOff > 0 || this.state === 'piping') return;
      const va = this.viewAngle();
      const r = this.range * 0.62;
      const a = this.alert;
      const col = this.shielding ? '255,77,77' : a > 0.3 ? '255,210,63' : '255,255,255';
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.scale(1, 1 / 1.4);
      const g = ctx.createRadialGradient(0, 0, 10, 0, 0, r);
      g.addColorStop(0, `rgba(${col},${0.20 + a * 0.12})`);
      g.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, r, va - this.fov / 2, va + this.fov / 2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
  SG.Person = Person;

  // ------------------------------------------------------------------ Shop
  class Shop {
    constructor(world, def) {
      this.world = world;
      this.def = def;
      this.type = def.type;
      this.x = def.hatchX;
      this.queue = [];
      this.state = 'idle';
      this.timer = 0;
      this.counterItem = null;
      this.speed = 1;
      this.queueDir = this.x > SG.W / 2 ? -1 : 1;
      this.keeper = {
        facing: 'out', turnT: M.rand(3, 6), inT: 0, swatT: 0, swatCd: 0, notice: 0, distractT: 0, anim: Math.random() * 10,
        skin: M.pick(SG.Art.SKIN), hair: M.pick(SG.Art.HAIR), bubble: null,
        top: def.type === 'icecream' ? '#ffffff' : def.type === 'seafood' ? '#2f6f9f' : def.type === 'cafe' ? '#ffd23f' : '#ffffff',
      };
    }
    queueSlot(i) { return { x: this.x + this.queueDir * i * 40, y: 600 + i * 36 }; }
    join(p) { if (this.queue.length >= 3) return -1; this.queue.push(p); return this.queue.length - 1; }
    leaveQueue(p) { const i = this.queue.indexOf(p); if (i >= 0) this.queue.splice(i, 1); }
    served(p) { this.leaveQueue(p); this.state = 'idle'; this.customer = null; }

    update(dt) {
      const k = this.keeper;
      k.anim += dt;
      if (k.bubble) { k.bubble.t += dt; if (k.bubble.t > 1.4) k.bubble = null; }
      k.swatCd -= dt;
      if (k.swatT > 0) { k.swatT -= dt; if (!k.swatDone && k.swatT < 0.25) { k.swatDone = true; this.world.keeperSwat(this); } }
      if (k.distractT > 0) { k.distractT -= dt; k.facing = 'in'; }

      const front = this.queue[0];
      switch (this.state) {
        case 'idle':
          if (front && front.state === 'queue' && front.inPlace) {
            this.state = 'cooking';
            this.timer = M.rand(2.2, 3.8) / this.speed;
            this.order = M.pick(SG.SHOP_MENU[this.type] || ['chips']);
            if (front.vip) this.order = 'golden';
          }
          // idle restocking: occasionally turn your back
          if (k.distractT <= 0) {
            if (k.inT > 0) { k.inT -= dt; k.facing = 'in'; }
            else {
              k.facing = 'out';
              k.turnT -= dt;
              if (k.turnT <= 0) { k.turnT = M.rand(3.5, 7); k.inT = M.rand(0.9, 1.8); }
            }
          }
          break;
        case 'cooking':
          if (k.distractT <= 0) k.facing = 'in';
          this.timer -= dt;
          if (!front || !this.queue.includes(front)) { this.state = 'idle'; break; }
          if (this.timer <= 0) {
            const it = new SG.Item(this.world, this.order, this.x + M.rand(-35, 35), 563, 30);
            it.counter = this; it.grounded = true; it.life = 999;
            this.world.items.push(it);
            this.counterItem = it;
            this.state = 'ready'; this.timer = 0;
            k.facing = 'out'; k.inT = 0;
            front.state = 'collect'; front.stateT = 0;
            SG.Audio.sfx('ding', { vol: 0.35, pitch: 1.6, pan: SG.panFor(this.x) });
          }
          break;
        case 'ready':
          this.timer += dt;
          if (k.distractT <= 0) {
            // turn back to the fryer if there's more queue waiting
            k.facing = this.queue.length > 1 && this.timer > 0.4 ? 'in' : 'out';
          }
          if (!this.counterItem || this.counterItem.dead) { this.counterItem = null; if (!this.queue[0] || this.queue[0].state !== 'collect') this.state = 'idle'; }
          if (this.timer > 8) { if (this.counterItem) { this.counterItem.dead = true; this.counterItem = null; } this.state = 'idle'; }
          break;
      }

      // guard the hatch
      if (k.facing === 'out' && k.distractT <= 0 && k.swatT <= 0) {
        let near = null;
        for (const g of this.world.gulls) {
          if (Math.abs(g.x - this.x) < 96 && g.y < 628 && g.z < 150 && !g.frozen) { near = g; break; }
        }
        if (near) {
          k.notice += dt * 2.6;
          if (k.notice > 1 && k.swatCd <= 0) {
            k.swatT = 0.45; k.swatDone = false; k.swatCd = 1.1; k.target = near;
            if (M.chance(0.6)) k.bubble = { text: M.pick(SG.LINES.keeper), t: 0 };
          }
        } else k.notice = Math.max(0, k.notice - dt);
      } else k.notice = Math.max(0, k.notice - dt * 2);
    }

    drawHatch(ctx, t) {
      const k = this.keeper;
      const H = SG.HATCH;
      ctx.save();
      ctx.beginPath(); ctx.rect(this.x - H.halfW, H.top, H.halfW * 2, H.bottom - H.top + 8); ctx.clip();
      SG.Art.shopkeeper(ctx, { x: this.x, y: H.counterTop + 6, facing: k.facing, t: k.anim, kind: this.type, swat: k.swatT > 0, skin: k.skin, hair: k.hair, top: k.top });
      ctx.restore();
      SG.Art.counter(ctx, this.x, this.def.color);
      if (k.swatT > 0) {
        // spatula pokes out of the hatch
        const kk = Math.sin(k.anim * 30);
        ctx.save(); ctx.translate(this.x + 60, H.counterTop - 20 + kk * 12); ctx.rotate(0.6 + kk * 0.5);
        SG.roundRect(ctx, -10, -36, 20, 26, 4); SG.Art.fillStroke(ctx, '#c7ccd6', 3); ctx.fillStyle = SG.INK; ctx.fillRect(-2, -10, 4, 22);
        ctx.restore();
      }
    }
    drawOverlay(ctx, t) {
      const k = this.keeper;
      if (k.facing === 'out' && k.notice > 0.2 && k.swatT <= 0) SG.Art.alertIcon(ctx, this.x, SG.HATCH.top - 6, k.notice > 0.7 ? '!' : '?', Math.min(1, k.notice));
      if (k.bubble) SG.Art.bubble(ctx, this.x, SG.HATCH.top + 10, k.bubble.text, { size: 22 });
      if (k.distractT > 0) SG.text(ctx, 'EUGH!', this.x, SG.HATCH.top + 20, { size: 22, color: '#e8f5c8' });
    }
  }
  SG.Shop = Shop;

  // ------------------------------------------------------------------ Dog
  class Dog {
    constructor(world, side) {
      this.world = world;
      this.x = side < 0 ? -40 : SG.W + 40;
      this.y = M.rand(680, 860);
      this.facing = side < 0 ? 1 : -1;
      this.t = 0; this.life = 15; this.dead = false;
      this.barkT = 0.5; this.barkAnim = 0;
      this.target = null; this.carry = null;
      this.speed = 330;
    }
    update(dt) {
      const w = this.world;
      this.t += dt; this.life -= dt; this.barkT -= dt; this.barkAnim -= dt;
      let tx, ty;
      if (this.life <= 0 || this.carry) {
        tx = this.x < SG.W / 2 ? -120 : SG.W + 120; ty = this.y;
        if (this.x < -100 || this.x > SG.W + 100) this.dead = true;
      } else {
        // chase loose food first, then the nearest low gull
        let best = null, bd = 1e9;
        for (const it of w.items) { if (it.grounded && !it.counter && !it.inWater && it.y < SG.GROUND_BOTTOM + 2 && it.z < 10) { const d = M.dist(this.x, this.y, it.x, it.y); if (d < bd && d < 380) { bd = d; best = it; } } }
        if (best) { tx = best.x; ty = best.y; if (bd < 26) { this.carry = best.type; best.dead = true; SG.Audio.sfx('chomp', { pan: SG.panFor(this.x) }); } }
        else {
          let g = null; bd = 1e9;
          for (const gg of w.gulls) { if (gg.z < 70 && gg.y < SG.GROUND_BOTTOM + 4) { const d = M.dist(this.x, this.y, gg.x, gg.y); if (d < bd) { bd = d; g = gg; } } }
          if (g) {
            tx = g.x; ty = g.y;
            if (bd < 40 && g.z < 50) {
              if (g.hit(g.x - this.x, g.y - this.y, 420, 0.6, null, 'dog')) { this.barkAnim = 0.3; SG.Audio.sfx('bark', { pan: SG.panFor(this.x) }); }
            }
          } else { tx = SG.W / 2 + Math.sin(this.t) * 600; ty = 760; }
        }
        if (this.barkT <= 0) { this.barkT = M.rand(0.9, 1.8); this.barkAnim = 0.3; SG.Audio.sfx('bark', { pan: SG.panFor(this.x), vol: 0.8 }); }
      }
      const dx = tx - this.x, dy = ty - this.y, d = Math.hypot(dx, dy);
      if (d > 2) {
        const nx = this.x + (dx / d) * this.speed * dt, ny = M.clamp(this.y + (dy / d) * this.speed * 0.75 * dt, 590, SG.GROUND_BOTTOM);
        if (!w.personBlocked(nx, ny)) { this.x = nx; this.y = ny; }
        else if (!w.personBlocked(nx, this.y)) this.x = nx;
        else if (!w.personBlocked(this.x, ny)) this.y = ny;
        if (Math.abs(dx) > 4) this.facing = dx > 0 ? 1 : -1;
      }
    }
    draw(ctx) {
      const s = SG.depthScale(this.y);
      SG.Art.dog(ctx, { x: this.x, y: this.y, s: s * 1.1, facing: this.facing, t: this.t, running: true, barking: this.barkAnim > 0, carry: this.carry });
    }
  }
  SG.Dog = Dog;
})(window.SG);
