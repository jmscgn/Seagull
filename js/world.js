// ---------------------------------------------------------------------------
// World: everything that lives on the promenade during a round.
// ---------------------------------------------------------------------------
(function (SG) {
  'use strict';
  const M = SG.M;
  const HALF_PI = Math.PI / 2;

  const EVENT_INFO = {
    ferry:  { title: 'FERRY’S IN!', sub: 'A boatload of hungry tourists' },
    rain:   { title: 'RAIN SHOWER!', sub: 'Typical Scottish summer – brollies up!' },
    boat:   { title: 'FISHING BOAT!', sub: 'Free scraps off the back!' },
    golden: { title: 'GOLDEN SUPPER!', sub: 'Big Tam’s got the good stuff' },
    dog:    { title: 'DOG OFF THE LEAD!', sub: 'Hamish the Westie wants gulls' },
    piper:  { title: 'PIPER ON THE PROM!', sub: 'Everyone’s distracted...' },
    rush:   { title: 'TEATIME RUSH!', sub: 'Queues out the door!' },
  };
  SG.EVENT_INFO = EVENT_INFO;

  class World {
    constructor(stageId, players, opts) {
      opts = opts || {};
      this.stage = SG.STAGES[stageId] || SG.STAGES.oban;
      this.attract = !!opts.attract;
      this.roundTime = opts.roundTime || SG.settings.roundTime || 120;
      this.time = 0;
      this.timeLeft = this.roundTime;
      this.phase = this.attract ? 'play' : 'intro';
      this.introT = 0;
      this.overT = 0;
      this.frenzy = false;
      this.items = []; this.poops = []; this.splats = []; this.people = [];
      this.fx = new SG.FX();
      this.dog = null; this.piper = null; this.boat = null;
      this.rain = 0; this.rainTarget = 0;
      this.ferry = 0; this.ferryTarget = 0;
      this.shakeAmt = 0;
      this.banner = null;
      this.activeEvents = {};
      this.spawnT = 1;
      this.leader = null;
      this.lastTick = 999;
      this.bd = null;

      this.buildLayout();

      // Gulls
      this.gulls = [];
      const starts = this.startSpots();
      players.forEach((p, i) => {
        const st = starts[i % starts.length];
        const g = new SG.Gull(this, p.slot, { cpu: p.cpu, level: p.level, hat: p.hat, deviceId: p.deviceId, name: p.name, x: st.x, y: st.y, z: st.z });
        g.floor = st.z; g.facing = st.x < SG.W / 2 ? 1 : -1;
        g.score = 0;
        this.gulls.push(g);
      });
      if (this.phase === 'intro') for (const g of this.gulls) g.frozen = true;

      // Schedule events for this round
      this.schedule = [];
      if (!this.attract) {
        const pool = M.shuffle(['ferry', 'rain', 'boat', 'dog', 'piper', 'rush']);
        const n = this.roundTime >= 150 ? 4 : this.roundTime >= 100 ? 3 : 2;
        const picks = pool.slice(0, n - 1);
        picks.splice(M.randInt(0, picks.length), 0, 'golden');
        const span = this.roundTime - 30;
        picks.forEach((type, i) => this.schedule.push({ at: 14 + (span / n) * i + M.rand(0, 6), type }));
      } else {
        this.attractEventT = 12;
      }

      this.populate();
    }

    // ------------------------------------------------------------ layout
    buildLayout() {
      const st = this.stage;
      this.boxes = [];
      this.props = [];
      this.bins = [];
      this.seats = [];
      const box = (x0, x1, y0, y1, h, kind, ref, zMin) => { const b = { x0, x1, y0, y1, h, kind, ref, zMin: zMin || 0 }; this.boxes.push(b); return b; };
      // sea wall railing
      box(0, SG.W, 930, 946, 44, 'railing');
      // shop roofs & counters
      this.shops = [];
      for (const s of st.shops) {
        const h = SG.FACADE_Y - s.roofY;
        box(s.x0 + 4, s.x1 - 4, 540, 574, h, 'roof', s, h - 40);
        if (s.hatchX) {
          box(s.hatchX - 82, s.hatchX + 82, 548, 574, 32, 'counter', s);
          this.shops.push(new SG.Shop(this, s));
        }
      }
      for (const p of st.props) {
        const s = SG.depthScale(p.y);
        const prop = Object.assign({}, p);
        this.props.push(prop);
        switch (p.type) {
          case 'bin': {
            prop.box = box(p.x - 26 * s, p.x + 26 * s, p.y - 16, p.y + 8, 68 * s, 'bin', prop);
            prop.fill = M.randInt(1, 3); prop.tipped = false; prop.tipT = 0; prop.shake = 0; prop.cd = 0; prop.refillT = M.rand(12, 20);
            prop.ax = p.x; prop.ay = Math.min(p.y + 30, 890);
            this.bins.push(prop);
            break;
          }
          case 'bench': {
            prop.box = box(p.x - 88 * s, p.x + 88 * s, p.y - 16, p.y + 6, 44 * s, 'bench', prop);
            for (const sx of [-44, 44]) this.seats.push({ x: p.x + sx * s, y: p.y + 3, angle: HALF_PI, ax: p.x + sx * s, ay: Math.min(p.y + 26, 892), box: prop.box, taken: null });
            break;
          }
          case 'picnic': {
            prop.box = box(p.x - 96 * s, p.x + 96 * s, p.y - 34, p.y + 12, 58 * s, 'picnic', prop);
            for (const sx of [-48, 48]) {
              this.seats.push({ x: p.x + sx * s, y: p.y + 16, angle: -HALF_PI, ax: p.x + sx * s, ay: Math.min(p.y + 38, 892), box: prop.box, taken: null });
              this.seats.push({ x: p.x + sx * s, y: p.y - 40, angle: HALF_PI, ax: p.x + sx * s, ay: p.y - 60, box: prop.box, taken: null });
            }
            break;
          }
          case 'lamp': prop.box = box(p.x - 9, p.x + 9, p.y - 8, p.y + 8, 228 * s, 'lamp', prop); break;
          case 'creels': prop.box = box(p.x - 50 * s, p.x + 50 * s, p.y - 20, p.y + 10, 72 * s, 'creels', prop); break;
          case 'planter': prop.box = box(p.x - 44 * s, p.x + 44 * s, p.y - 16, p.y + 6, 46 * s, 'planter', prop); break;
          case 'sign': prop.box = box(p.x - 10, p.x + 10, p.y - 6, p.y + 6, 150 * s, 'sign', prop); break;
          case 'bollard': prop.box = box(p.x - 14, p.x + 14, p.y - 10, p.y + 8, 40 * s, 'bollard', prop); break;
          case 'longship': prop.box = box(p.x - 105 * s, p.x + 105 * s, p.y - 24, p.y + 10, 50 * s, 'longship', prop); break;
        }
      }
      this.lamps = this.props.filter((p) => p.type === 'lamp').sort((a, b) => a.x - b.x);
      // perches for AI eating spots
      this.perches = [];
      for (const b of this.boxes) {
        if (b.kind === 'railing') { for (let x = 80; x < SG.W; x += 160) this.perches.push({ x, y: 938, z: b.h, kind: 'railing' }); }
        else if (b.kind === 'roof') { for (let x = b.x0 + 40; x < b.x1 - 30; x += 90) this.perches.push({ x, y: 556, z: b.h, kind: 'roof' }); }
        else if (b.kind === 'lamp' || b.kind === 'sign' || b.kind === 'creels' || b.kind === 'longship') this.perches.push({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, z: b.h, kind: b.kind });
      }
    }

    startSpots() {
      // perched on the railing, spread along the prom
      return [0.2, 0.8, 0.4, 0.6].map((f) => ({ x: SG.W * f, y: 938, z: 44 }));
    }

    populate() {
      // a few folk already out enjoying their scran
      const n = this.attract ? 7 : 6;
      const seats = M.shuffle(this.seats.slice());
      for (let i = 0; i < n; i++) {
        const kind = this.pickKind();
        const food = this.pickFood(kind);
        if (i < 3 && seats[i]) {
          const seat = seats[i];
          const p = new SG.Person(this, kind, { x: seat.x, y: seat.y, food });
          seat.taken = p; p.seat = seat; p.angle = seat.angle; p.lookAngle = seat.angle;
          p.state = 'sit'; p.sitTime = M.rand(16, 30); p.stateT = M.rand(0, 6);
          this.people.push(p);
        } else if (i < 5) {
          const shop = M.pick(this.shops);
          const sl = shop.queueSlot(shop.queue.length);
          const p = new SG.Person(this, kind, { x: sl.x, y: sl.y });
          if (shop.join(p) >= 0) { p.shop = shop; p.state = 'queue'; this.people.push(p); }
        } else {
          const x = M.rand(300, SG.W - 300);
          const p = new SG.Person(this, kind, { x, y: M.rand(660, 860), food });
          this.people.push(p);
          p.decideAfterFood();
        }
      }
    }

    pickKind() {
      return M.weighted(Object.keys(SG.PERSON_KINDS), (k) => SG.PERSON_KINDS[k].w * (k === 'fisherman' && this.stage.id !== 'oban' ? 0.4 : 1));
    }
    pickFood(kind) {
      const K = SG.PERSON_KINDS[kind];
      if (K && K.foods) return M.pick(K.foods);
      return M.pick(['supper', 'supper', 'chips', 'chips', 'icecream', 'pie', 'sausageroll', 'piece', 'doughnut', 'seafood', 'scone']);
    }
    pickShop(nearX) {
      if (!this.shops.length) return null;
      const open = this.shops.filter((s) => s.queue.length < 3);
      if (!open.length) return null;
      return M.weighted(open, (s) => (s.type === 'chippy' ? 2.2 : 1) / (1 + Math.abs(s.x - (nearX === undefined ? s.x : nearX)) / 900));
    }

    spawnPerson(opts) {
      opts = opts || {};
      const side = opts.side || (M.chance(0.5) ? -1 : 1);
      const kind = opts.kind || this.pickKind();
      const x = opts.x !== undefined ? opts.x : side < 0 ? -50 : SG.W + 50;
      const y = opts.y !== undefined ? opts.y : M.rand(630, 870);
      const buy = opts.buy !== undefined ? opts.buy : M.chance(0.62);
      const p = new SG.Person(this, kind, { x, y, food: buy ? null : this.pickFood(kind), vip: opts.vip });
      if (opts.vip) {
        Object.assign(p, { hat: null, top: '#c62f3a', bottom: '#1f5f3a', range: 420, fov: (150 * Math.PI) / 180, speed: 62 });
        p.food = { type: 'golden', bites: SG.FOODS.golden.bites };
      }
      this.people.push(p);
      if (buy) {
        const shop = this.pickShop(x);
        if (shop) { p.walkTo(shop.x + M.rand(-30, 30), 640, { kind: 'shop', shop }); return p; }
      }
      if (!p.food) p.food = { type: this.pickFood(kind), bites: 3 };
      if (p.food.bites > SG.FOODS[p.food.type].bites) p.food.bites = SG.FOODS[p.food.type].bites;
      p.decideAfterFood();
      return p;
    }

    // ------------------------------------------------------------ physics queries
    floorAt(x, y, z) {
      let f = 0;
      for (const b of this.boxes) {
        if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1 && b.h <= z + 8 && b.h > f) f = b.h;
      }
      return f;
    }
    boxUnder(x, y, z) {
      let best = null;
      for (const b of this.boxes) {
        if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1 && b.h <= z + 8 && (!best || b.h > best.h)) best = b;
      }
      return best;
    }
    blocked(x, y, z) {
      for (const b of this.boxes) {
        if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1 && z + 6 < b.h && z + 46 > b.zMin) return true;
      }
      return false;
    }
    isWater(x, y) { return y > SG.WATER_Y - 2; }
    personBlocked(x, y, ignoreBox) {
      if (y < 582 || y > 898) return true;
      for (const b of this.boxes) {
        if (b === ignoreBox || b.kind === 'roof' || b.kind === 'counter' || b.kind === 'railing') continue;
        if (x >= b.x0 - 12 && x <= b.x1 + 12 && y >= b.y0 - 8 && y <= b.y1 + 8) return true;
      }
      return false;
    }
    // Grid A* over the promenade with line-of-sight smoothing.
    planPath(x0, y0, x1, y1, ignoreBox) {
      if (!this.segmentHit(x0, y0, x1, y1, ignoreBox)) return [[x1, y1]];
      const CS = 30, GX0 = -4, GX1 = Math.ceil(SG.W / CS) + 4, GY0 = 588, ROWS = 11;
      const cols = GX1 - GX0 + 1;
      const cx = (gx) => gx * CS + CS / 2, cy = (gy) => GY0 + gy * CS;
      const free = (gx, gy) => gy >= 0 && gy < ROWS && gx >= GX0 && gx <= GX1 && !this.personBlocked(cx(gx), cy(gy), ignoreBox);
      const toCell = (x, y) => [M.clamp(Math.round((x - CS / 2) / CS), GX0, GX1), M.clamp(Math.round((y - GY0) / CS), 0, ROWS - 1)];
      const nearestFree = (c) => {
        if (free(c[0], c[1])) return c;
        for (let r = 1; r < 6; r++) for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) if (free(c[0] + dx, c[1] + dy)) return [c[0] + dx, c[1] + dy];
        return null;
      };
      const s0 = nearestFree(toCell(x0, y0)), g0 = nearestFree(toCell(x1, y1));
      if (!s0 || !g0) return [[x1, y1]];
      const key = (gx, gy) => (gy * cols) + (gx - GX0);
      const gScore = new Map(), came = new Map();
      const open = [[s0[0], s0[1], 0]];
      gScore.set(key(s0[0], s0[1]), 0);
      const h = (gx, gy) => Math.hypot(gx - g0[0], gy - g0[1]);
      let found = false, guard = 0;
      while (open.length && guard++ < 4000) {
        let bi = 0;
        for (let i = 1; i < open.length; i++) if (open[i][2] < open[bi][2]) bi = i;
        const [gx, gy] = open.splice(bi, 1)[0];
        if (gx === g0[0] && gy === g0[1]) { found = true; break; }
        const gc = gScore.get(key(gx, gy));
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
          if (!dx && !dy) continue;
          const nx = gx + dx, ny = gy + dy;
          if (!free(nx, ny)) continue;
          if (dx && dy && (!free(gx + dx, gy) || !free(gx, gy + dy))) continue;
          const ng = gc + (dx && dy ? 1.414 : 1);
          const k = key(nx, ny);
          if (ng < (gScore.has(k) ? gScore.get(k) : 1e9)) { gScore.set(k, ng); came.set(k, [gx, gy]); open.push([nx, ny, ng + h(nx, ny)]); }
        }
      }
      if (!found) return [[x1, y1]];
      const cells = [];
      let c = g0;
      while (c) { cells.unshift([cx(c[0]), cy(c[1])]); c = came.get(key(c[0], c[1])); }
      cells.push([x1, y1]);
      // string-pull: skip waypoints we can see past
      const path = [];
      let px = x0, py = y0, i = 0;
      while (i < cells.length) {
        let j = cells.length - 1;
        while (j > i && this.segmentHit(px, py, cells[j][0], cells[j][1], ignoreBox)) j--;
        path.push(cells[j]); px = cells[j][0]; py = cells[j][1]; i = j + 1;
      }
      return path;
    }
    freePoint(x, y, ignoreBox) {
      if (!this.personBlocked(x, y, ignoreBox)) return [x, y];
      for (let r = 20; r < 300; r += 20) for (let a = 0; a < 8; a++) {
        const px = x + Math.cos(a * Math.PI / 4) * r, py = y + Math.sin(a * Math.PI / 4) * r * 0.6;
        if (!this.personBlocked(px, py, ignoreBox)) return [px, py];
      }
      return [x, y];
    }
    segmentHit(x0, y0, x1, y1, ignoreBox) {
      const d = Math.hypot(x1 - x0, y1 - y0);
      const n = Math.max(1, Math.ceil(d / 12));
      for (let i = 1; i <= n; i++) {
        const x = x0 + ((x1 - x0) * i) / n, y = y0 + ((y1 - y0) * i) / n;
        for (const b of this.boxes) {
          if (b === ignoreBox || b.kind === 'roof' || b.kind === 'counter' || b.kind === 'railing') continue;
          if (x >= b.x0 - 14 && x <= b.x1 + 14 && y >= b.y0 - 10 && y <= b.y1 + 10) return b;
        }
      }
      return null;
    }
    sortKey(x, y, z) {
      let k = y;
      for (const b of this.boxes) {
        if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1 && z >= b.h - 6 && b.y1 + 0.5 > k) k = b.y1 + 0.5;
      }
      return k;
    }
    freeSeat(x, y) {
      const free = this.seats.filter((s) => !s.taken);
      if (!free.length) return null;
      free.sort((a, b) => M.dist(x, y, a.x, a.y) - M.dist(x, y, b.x, b.y));
      return M.pick(free.slice(0, 3));
    }
    nearestBin(x, y, maxD) {
      let best = null, bd = maxD || 1e9;
      for (const b of this.bins) { if (b.tipped) continue; const d = M.dist(x, y, b.x, b.y); if (d < bd) { bd = d; best = b; } }
      return best;
    }
    bubbleCount() { let n = 0; for (const p of this.people) if (p.bubble) n++; return n; }
    litter(x, y, type) {
      const it = new SG.Item(this, type, x + M.rand(-10, 10), M.clamp(y + 4, 590, 896), 30);
      it.toss(M.rand(-60, 60), M.rand(-10, 10), 120);
      this.items.push(it);
    }
    addSplat(x, y, r) {
      this.splats.push({ x, y, r: r * M.rand(0.8, 1.2), age: 0, life: 18, seed: Math.random() * 10 });
      if (this.splats.length > 40) this.splats.shift();
    }
    shake(a) { if (SG.settings.shake) this.shakeAmt = Math.max(this.shakeAmt, a); }

    // ------------------------------------------------------------ scoring
    award(g, pts, why) {
      if (this.phase !== 'play') return 0;
      pts = Math.round(pts * (this.frenzy ? 2 : 1));
      g.score += pts;
      const s = SG.depthScale(g.y);
      this.fx.text('+' + pts, g.x + M.rand(-10, 10), g.y - g.z - 70 * s, { size: pts >= 40 ? 36 : 28, color: this.frenzy ? '#ffd23f' : '#ffffff' });
      return pts;
    }

    // ------------------------------------------------------------ gull interactions
    findItem(b, rx, ry, rz, exclude) {
      let best = null, bd = 1e9;
      for (const it of this.items) {
        if (it.dead || it.noPickup > 0 || it === exclude) continue;
        const dx = Math.abs(it.x - b.x), dy = Math.abs(it.y - b.y), dz = it.z - b.z;
        if (dx < rx && dy < ry && dz < rz && dz > -rz - 40) {
          const d = dx + dy - it.value() * 0.2;
          if (d < bd) { bd = d; best = it; }
        }
      }
      return best;
    }
    findPersonFood(b, reach) {
      let best = null, bd = 1e9;
      for (const p of this.people) {
        if (!p.food || p.dead) continue;
        const fp = p.foodPos();
        const s = SG.depthScale(p.y);
        const dx = Math.abs(fp.x - b.x), dy = Math.abs(fp.y - b.y), dz = Math.abs(fp.z - b.z);
        if (dx < reach * s && dy < 36 && dz < 62) {
          const d = dx + dy + dz * 0.5;
          if (d < bd) { bd = d; best = p; }
        }
      }
      return best;
    }

    grabItem(g, it, how) {
      if (!g.take(it.type, it.bites, how)) return false;
      it.dead = true;
      const s = SG.depthScale(g.y);
      if (it.counter) {
        const shop = it.counter;
        shop.counterItem = null;
        g.stats.steals++;
        const sneaky = shop.keeper.facing === 'in';
        this.award(g, sneaky ? 30 : 10, 'counter');
        this.fx.text(sneaky ? 'COUNTER HEIST!' : 'CHEEKY!', g.x, g.y - g.z - 110 * s, { size: 26, color: '#7df9ff' });
        if (sneaky) g.stats.sneaky++;
        shop.keeper.bubble = { text: 'HOI!', t: 0 };
        SG.Audio.sfx('oi', { pan: SG.panFor(shop.x), pitch: 0.9 });
      }
      SG.Audio.sfx(SG.FOODS[it.type].small ? 'gulp' : 'yoink', { pan: SG.panFor(g.x), pitch: g.voice });
      this.fx.sparkles(it.x, it.y, it.z, SG.FOODS[it.type].small ? 3 : 7);
      if (it.type === 'golden') this.goldenGrab(g);
      return true;
    }

    goldenGrab(g) {
      this.fx.text(g.name.toUpperCase() + ' HAS THE GOLD!', SG.W / 2, 260, { size: 44, color: '#ffd23f', life: 1.8, vy: -20 });
      SG.Audio.stinger('golden');
    }

    stealFrom(g, p, how) {
      if (!p.food || g.carry) return false;
      const s = SG.depthScale(g.y);
      if (p.shielding && p.visionOff <= 0) {
        // blocked: you get a slap for your trouble
        if (g.hit(g.x - p.x, (g.y - p.y) + 0.01, 420, 0.75, null, 'swat')) {
          g.stats.swatted++;
          p.swatT = 0.45; p.swatDone = true; p.swatCd = 1.0;
          p.say(M.pick(SG.LINES.swat), 1.1, true);
          SG.Audio.sfx('swat', { pan: SG.panFor(p.x) });
          this.fx.text('BLOCKED!', g.x, g.y - g.z - 90 * s, { size: 26, color: '#ff8a8a' });
        }
        return false;
      }
      if (p.umbrellaUp && how === 'swoop' && g.z > p.headZ() * 0.75) {
        if (g.hit(g.x - p.x, g.y - p.y + 0.01, 320, 0.5, null, 'umbrella')) {
          SG.Audio.sfx('boing', { pan: SG.panFor(p.x) });
          this.fx.text('BOING!', g.x, g.y - g.z - 90 * s, { size: 26, color: '#ffd23f' });
        }
        return false;
      }
      const sneaky = p.alert < 0.3;
      const food = p.food;
      p.food = null;
      const fp = p.foodPos();
      g.take(food.type, food.bites, 'steal');
      g.stats.steals++;
      this.award(g, 10, 'steal');
      if (sneaky) {
        g.stats.sneaky++;
        this.award(g, 20, 'sneaky');
        this.fx.text('SNEAKY BEAK!', g.x, g.y - g.z - 115 * s, { size: 28, color: '#7df9ff' });
        if (M.chance(0.4)) SG.Audio.sfx('laugh', { pitch: g.voice, vol: 0.55, pan: SG.panFor(g.x), delay: 0.25 });
      } else this.fx.text('YOINK!', g.x, g.y - g.z - 115 * s, { size: 28, color: '#ffffff' });
      if (SG.FOODS[food.type].spills || food.type === 'supper') {
        for (let i = 0; i < M.randInt(1, 3); i++) {
          const it = new SG.Item(this, 'chip', fp.x, fp.y, fp.z);
          it.toss(M.rand(-160, 160), M.rand(-50, 50), M.rand(150, 300)); it.noPickup = 0.25;
          this.items.push(it);
        }
      }
      p.robbed(g, sneaky);
      SG.Audio.sfx('yoink', { pan: SG.panFor(g.x), pitch: g.voice });
      this.fx.sparkles(fp.x, fp.y, fp.z, 8);
      SG.Input.rumble(g.deviceId, 0.2, 0.7, 120);
      if (food.type === 'golden') this.goldenGrab(g);
      return true;
    }

    rummage(g, bin) {
      if (bin.cd > 0) return;
      bin.cd = 0.35;
      bin.shake = 1;
      SG.Audio.sfx('bin', { pan: SG.panFor(bin.x), vol: 0.6, pitch: M.rand(0.9, 1.15) });
      if (bin.fill > 0 && !bin.tipped && M.chance(0.6)) {
        bin.fill--;
        this.spawnScrap(bin, g.x < bin.x ? -1 : 1);
        g.stats.bins++;
      } else {
        SG.Audio.sfx('rustle', { pan: SG.panFor(bin.x), vol: 0.5 });
      }
    }
    spawnScrap(bin, dir) {
      const s = SG.depthScale(bin.y);
      const it = new SG.Item(this, M.pick(SG.BIN_SCRAPS), bin.x, bin.y + 10, 70 * s);
      it.toss(dir * M.rand(60, 150), M.rand(10, 60), M.rand(260, 380));
      it.noPickup = 0.2;
      this.items.push(it);
      this.fx.crumbs(bin.x, bin.y, 70 * s, 4, '#f5f0e1');
    }
    tipBin(bin, dir) {
      if (bin.tipped) return;
      bin.tipped = true; bin.tipT = 11; bin.tipDir = dir; bin.lidOff = true;
      bin.box.h = 30 * SG.depthScale(bin.y);
      SG.Audio.sfx('bin', { pan: SG.panFor(bin.x), vol: 1, pitch: 0.8 });
      this.shake(6);
      const n = Math.max(2, bin.fill + 1);
      for (let i = 0; i < n; i++) this.spawnScrap(bin, dir);
      bin.fill = 0;
      this.fx.puff(bin.x, bin.y, 20, 6, '#ffffff', 100);
    }

    peck(g) {
      if (g.carry) return;
      const b = g.beak();
      const it = this.findItem(b, 60, 40, 64);
      if (it) { this.grabItem(g, it, 'peck'); return; }
      const p = this.findPersonFood(b, 78);
      if (p) { this.stealFrom(g, p, 'peck'); return; }
      for (const bin of this.bins) {
        const s = SG.depthScale(bin.y);
        if (Math.abs(bin.x - b.x) < 44 * s && Math.abs(bin.y - b.y) < 30 && b.z < 90 * s) { this.rummage(g, bin); return; }
      }
      const v = this.findGullNear(g, b, 58, 36, 50);
      if (v) this.gullStrike(g, v, 'peck');
    }

    findGullNear(g, b, rx, ry, rz) {
      let best = null, bd = 1e9;
      for (const v of this.gulls) {
        if (v === g || g.hitBy.has(v)) continue;
        const c = v.body();
        const dx = Math.abs(c.x - b.x), dy = Math.abs(c.y - b.y), dz = Math.abs(c.z - b.z);
        if (dx < rx && dy < ry && dz < rz) { const d = dx + dy + dz; if (d < bd) { bd = d; best = v; } }
      }
      return best;
    }

    gullStrike(a, v, mode) {
      const P = { peck: [300, 0.35], dash: [520, 0.55], swoop: [560, 0.75] }[mode];
      const res = v.hit(v.x - a.x + (v.x === a.x ? a.facing : 0), v.y - a.y, P[0], P[1], a, mode);
      if (!res) return false;
      a.stats.hits++;
      if (mode !== 'peck') this.hitStop = Math.max(this.hitStop || 0, mode === 'swoop' ? 0.08 : 0.06);
      if (mode === 'dash') { a.dashT = 0; a.vx *= -0.3; a.vy *= -0.3; }
      if (res.dropped && mode !== 'peck' && !a.carry) {
        a.take(res.dropped.type, res.dropped.bites, 'steal');
        res.dropped.dead = true;
        this.fx.text('INTERCEPT!', a.x, a.y - a.z - 100, { size: 28, color: '#7df9ff' });
        SG.Audio.sfx('yoink', { pan: SG.panFor(a.x), pitch: a.voice });
        if (res.dropped.type === 'golden') this.goldenGrab(a);
      }
      return true;
    }

    swoopCheck(g) {
      const b = g.beak();
      if (!g.carry) {
        const it = this.findItem(b, 66, 42, 60);
        if (it && this.grabItem(g, it, 'swoop')) { g.endSwoop(); return; }
        const p = this.findPersonFood(b, 84);
        if (p) { this.stealFrom(g, p, 'swoop'); g.endSwoop(); return; }
      }
      const v = this.findGullNear(g, g.body(), 60, 36, 58);
      if (v) { g.hitBy.add(v); this.gullStrike(g, v, 'swoop'); }
    }

    dashCheck(g) {
      const b = g.beak();
      const v = this.findGullNear(g, g.body(), 54, 32, 46);
      if (v) { g.hitBy.add(v); this.gullStrike(g, v, 'dash'); return; }
      if (g.grounded) {
        for (const bin of this.bins) {
          if (bin.tipped) continue;
          const s = SG.depthScale(bin.y);
          if (Math.abs(bin.x - b.x) < 34 * s && Math.abs(bin.y - b.y) < 26 && g.z < 30) { this.tipBin(bin, g.facing); g.stats.bins++; g.dashT = 0; g.vx = -g.facing * 120; return; }
        }
        for (const p of this.people) {
          if (g.hitBy.has(p)) continue;
          if (Math.abs(p.x - g.x) < 36 && Math.abs(p.y - g.y) < 26) {
            g.hitBy.add(p);
            if (p.kind === 'kid' && p.food && p.alert < 0.5) { p.say('WAAH!', 1.2, true); SG.Audio.sfx('wah', { pan: SG.panFor(p.x) }); p.dropFood(g); p.alert = 1; }
            else { p.alert = Math.min(1, p.alert + 0.6); p.threat = g; if (M.chance(0.4)) p.say(M.pick(SG.LINES.startle), 1); }
          }
        }
      }
      if (!g.carry) this.runPickup(g);
    }

    runPickup(g) {
      const b = g.beak();
      for (const it of this.items) {
        if (it.dead || it.noPickup > 0 || it.counter) continue;
        if (!SG.FOODS[it.type].small && g.carry) continue;
        if (Math.abs(it.x - b.x) < 40 && Math.abs(it.y - b.y) < 28 && Math.abs(it.z - g.z) < 30) { this.grabItem(g, it, 'run'); if (g.carry) return; }
      }
    }

    onSquawk(g) {
      const s = SG.depthScale(g.y);
      this.fx.add({ type: 'wave', x: g.x + g.facing * 46 * s, y: g.y, z: g.z + 48 * s, vx: 0, vy: 0, vz: 0, life: 0.5, age: 0, size: 16, dir: g.facing, color: g.color });
      for (const p of this.people) {
        const d = Math.hypot(p.x - g.x, (p.y - g.y) * 1.4);
        if (d < 330 && p.state !== 'piping') p.startled(g);
      }
    }

    onFoodFinished(g, type) {
      if (type === 'golden') this.fx.text('GOLDEN GULP!', g.x, g.y - g.z - 130, { size: 40, color: '#ffd23f', life: 1.6 });
    }

    personSwat(p) {
      const s = SG.depthScale(p.y);
      for (const g of this.gulls) {
        if (Math.abs(g.x - (p.x + p.drawFacing * 30 * s)) < 90 * s && Math.abs(g.y - p.y) < 36 && g.z < p.headZ() + 40) {
          if (g.hit(g.x - p.x, g.y - p.y + 0.01, 460, 0.9, null, 'swat')) {
            g.stats.swatted++;
            SG.Audio.sfx('swat', { pan: SG.panFor(p.x) });
            this.fx.text('SWATTED!', g.x, g.y - g.z - 90 * s, { size: 24, color: '#ff8a8a' });
          }
        }
      }
    }

    keeperSwat(shop) {
      for (const g of this.gulls) {
        if (Math.abs(g.x - shop.x) < 104 && g.y < 640 && g.z < 160) {
          if (g.hit(g.x - shop.x + 0.01, 1, 460, 0.8, null, 'swat')) {
            g.stats.swatted++;
            SG.Audio.sfx('swat', { pan: SG.panFor(shop.x) });
            this.fx.text('WHACK!', g.x, g.y - g.z - 80, { size: 26, color: '#ff8a8a' });
          }
        }
      }
    }

    poopCollide(pp) {
      const owner = pp.owner;
      for (const p of this.people) {
        if (p.dead) continue;
        const s = SG.depthScale(p.y);
        const hz = p.headZ();
        const dx = Math.abs(pp.x - p.x), dy = Math.abs(pp.y - p.y);
        if (p.umbrellaUp && dx < 56 * s && dy < 30 && pp.z < hz + 78 * s && pp.z > hz + 20) {
          this.fx.goo(pp.x, pp.y, pp.z, 5);
          SG.Audio.sfx('splat', { pan: SG.panFor(p.x), vol: 0.6, pitch: 1.3 });
          return true;
        }
        if (dx < 22 * s * p.ws && dy < 24 && pp.z < hz + 6 && pp.z > hz - 44 * s) {
          const dropped = p.pooped(owner);
          owner.stats.poopsHit++;
          this.award(owner, 10, 'splat');
          this.fx.text(dropped ? 'SPLAT! DROPPED IT!' : 'SPLAT!', pp.x, pp.y - pp.z - 40, { size: 26, color: '#e8f5c8' });
          this.fx.goo(pp.x, pp.y, pp.z, 8);
          SG.Audio.sfx('splat', { pan: SG.panFor(p.x) });
          return true;
        }
      }
      for (const g of this.gulls) {
        if (g === owner) continue;
        const s = SG.depthScale(g.y);
        if (Math.abs(pp.x - g.x) < 28 * s && Math.abs(pp.y - g.y) < 24 && pp.z > g.z && pp.z < g.z + 64 * s) {
          g.splatT = 2.8;
          const it = g.drop(M.rand(-1, 1), 0.3, 120);
          if (it) it.noPickup = 0.2;
          g.stunT = Math.max(g.stunT, 0.25);
          owner.stats.gullsSplatted++;
          this.award(owner, 5, 'splat');
          this.fx.text('SPLATTED!', g.x, g.y - g.z - 80, { size: 24, color: '#e8f5c8' });
          this.fx.goo(pp.x, pp.y, pp.z, 8);
          SG.Audio.sfx('splat', { pan: SG.panFor(g.x) });
          SG.Input.rumble(g.deviceId, 0.4, 0.4, 120);
          return true;
        }
      }
      for (const shop of this.shops) {
        if (Math.abs(pp.x - shop.x) < 62 && pp.y < 600 && pp.z > 30 && pp.z < 150) {
          shop.keeper.distractT = 3.2; shop.keeper.notice = 0;
          owner.stats.poopsHit++;
          this.award(owner, 10, 'splat');
          this.fx.goo(pp.x, pp.y, pp.z, 6);
          SG.Audio.sfx('splat', { pan: SG.panFor(shop.x) });
          SG.Audio.sfx('eugh', { pan: SG.panFor(shop.x), pitch: 0.9 });
          return true;
        }
      }
      return false;
    }

    // ------------------------------------------------------------ events
    startEvent(type) {
      const info = EVENT_INFO[type];
      if (!this.attract) {
        this.banner = { title: info.title, sub: info.sub, t: 0, dur: 3.2 };
        SG.Audio.stinger('event');
      }
      const ev = { type, t: 0 };
      this.activeEvents[type] = ev;
      switch (type) {
        case 'ferry':
          this.ferryTarget = 1; ev.spawned = 0; ev.dur = 24;
          SG.Audio.sfx('horn', { pan: this.stage.ferrySide === 'left' ? -0.6 : 0.6 });
          break;
        case 'rain':
          this.rainTarget = 1; ev.dur = 15;
          SG.Audio.loop('rain', true, 0.8);
          break;
        case 'boat':
          this.boat = { x: M.rand(700, 1200), t: 0, throws: 12, throwT: 2.2, dir: M.chance(0.5) ? 1 : -1, arm: 0 };
          ev.dur = 12;
          break;
        case 'golden': {
          const side = M.chance(0.5) ? -1 : 1;
          const p = this.spawnPerson({ kind: 'dad', side, vip: true, buy: false });
          p.say(SG.LINES.vip[0], 2.5, true);
          ev.dur = 1;
          break;
        }
        case 'dog':
          this.dog = new SG.Dog(this, M.chance(0.5) ? -1 : 1);
          ev.dur = 16;
          break;
        case 'piper': {
          const side = M.chance(0.5) ? -1 : 1;
          const p = new SG.Person(this, 'dad', { x: side < 0 ? -50 : SG.W + 50, y: 700, piper: true });
          Object.assign(p, { hat: 'feather', top: '#1f2a55', bottom: '#2e6b3f', hairStyle: 'short', food: null, speed: 120 });
          p.walkTo(M.rand(700, 1220), M.rand(690, 760), { kind: 'pipe' });
          this.people.push(p);
          this.piper = p;
          ev.dur = 18;
          break;
        }
        case 'rush':
          for (const s of this.shops) s.speed = 2.3;
          ev.dur = 15; ev.spawned = 0;
          break;
      }
    }

    updateEvents(dt) {
      // scheduled
      for (const s of this.schedule) {
        if (!s.done && this.time >= s.at && this.phase === 'play') { s.done = true; this.startEvent(s.type); }
      }
      if (this.attract) {
        this.attractEventT -= dt;
        if (this.attractEventT <= 0) { this.attractEventT = M.rand(16, 26); this.startEvent(M.pick(['ferry', 'boat', 'rain', 'piper', 'golden'])); }
      }
      for (const type in this.activeEvents) {
        const ev = this.activeEvents[type];
        ev.t += dt;
        switch (type) {
          case 'ferry':
            if (ev.t > 3 && ev.spawned < 7 && ev.t > 3 + ev.spawned * 0.8) {
              ev.spawned++;
              const bay = this.stage.bay;
              const x = this.stage.ferrySide === 'left' ? M.rand(bay.x0 + 60, bay.x1 - 40) : M.rand(bay.x0 + 40, bay.x1 - 60);
              this.spawnPerson({ x, y: 600, kind: M.pick(['tourist', 'tourist', 'kid', 'granny', 'dad']), buy: M.chance(0.75) });
            }
            if (ev.t > ev.dur) this.ferryTarget = 0;
            break;
          case 'rain':
            if (ev.t > ev.dur) { this.rainTarget = 0; SG.Audio.loop('rain', false); }
            break;
          case 'boat': {
            const b = this.boat;
            if (!b) break;
            b.t += dt; b.throwT -= dt; b.arm -= dt;
            if (b.throwT <= 0 && b.throws > 0) {
              b.throws--; b.throwT = M.rand(0.35, 0.7); b.arm = 0.3;
              const tx = M.clamp(b.x + M.rand(-420, 420), 60, SG.W - 60), ty = M.rand(640, 880);
              const flight = 1.0;
              const it = new SG.Item(this, M.pick(['fishbones', 'fishhead', 'fishhead', 'fishbones', 'seafood']), b.x + 20, 1005, 70);
              it.toss((tx - it.x) / flight, (ty - 1005) / flight, 780);
              this.items.push(it);
              SG.Audio.sfx('flap', { pitch: 0.6, vol: 0.4, pan: SG.panFor(b.x) });
            }
            if (b.throws <= 0 && b.t > 9) { b.leaving = true; }
            if (b.leaving) { b.x += b.dir * 160 * dt; if (b.x < -300 || b.x > SG.W + 300) this.boat = null; }
            if (!this.boat) ev.t = ev.dur = 0;
            break;
          }
          case 'dog':
            if (this.dog) { this.dog.update(dt); if (this.dog.dead) this.dog = null; }
            if (!this.dog) ev.t = ev.dur = 0;
            break;
          case 'piper': {
            const pp = this.piper;
            if (pp && pp.state === 'piping') {
              if (!ev.playing) { ev.playing = true; ev.playT = 0; if (!this.attract) SG.Audio.music('title'); }
              ev.playT += dt;
              for (const p of this.people) {
                if (p === pp || p.state === 'watch' || p.state === 'queue' || p.state === 'collect' || p.state === 'angry' || p.state === 'distracted') continue;
                if (Math.hypot(p.x - pp.x, p.y - pp.y) < 650) { if (p.seat) { p.seat.taken = null; p.seat = null; } p.state = 'watch'; p.stateT = 0; p.path = []; }
              }
              if (ev.playT > 14) {
                pp.leave();
                for (const p of this.people) if (p.state === 'watch') { p.state = 'walk'; p.decideAfterFood(); }
                if (!this.attract) SG.Audio.music('game');
                ev.dur = 0;
              }
            }
            if (!pp || pp.dead) ev.dur = 0;
            break;
          }
          case 'rush':
            if (ev.spawned < 6 && ev.t > ev.spawned * 0.9) { ev.spawned++; this.spawnPerson({ buy: true }); }
            if (ev.t > ev.dur) for (const s of this.shops) s.speed = 1;
            break;
        }
        if (ev.dur !== undefined && ev.t >= ev.dur && type !== 'ferry' && type !== 'piper') delete this.activeEvents[type];
        else if (type === 'ferry' && ev.t > ev.dur + 4) delete this.activeEvents[type];
        else if (type === 'piper' && ev.dur === 0) { delete this.activeEvents[type]; this.piper = null; }
      }
    }

    // ------------------------------------------------------------ main update
    update(dt, inputs) {
      this.time += dt;
      if (this.banner) { this.banner.t += dt; if (this.banner.t > this.banner.dur) this.banner = null; }
      this.shakeAmt = Math.max(0, this.shakeAmt - dt * 30);

      if (this.phase === 'intro') {
        this.introT += dt;
        const n = Math.ceil(3 - this.introT);
        if (n !== this.lastCount && n > 0) { this.lastCount = n; SG.Audio.sfx('countdown'); }
        if (this.introT >= 3) {
          this.phase = 'play';
          for (const g of this.gulls) g.frozen = false;
          SG.Audio.sfx('go');
          SG.Audio.sfx('squawk', { pitch: 1.1 });
          this.goT = 0;
        }
      } else if (this.phase === 'play' && !this.attract) {
        this.timeLeft -= dt;
        if (this.goT !== undefined) this.goT += dt;
        if (!this.frenzy && this.timeLeft <= 20) {
          this.frenzy = true;
          this.banner = { title: 'FINAL FRENZY!', sub: 'Double scran points!', t: 0, dur: 3, frenzy: true };
          SG.Audio.stinger('event');
          SG.Audio.setTempo(1.18);
        }
        const sec = Math.ceil(this.timeLeft);
        if (sec <= 10 && sec !== this.lastTick && sec > 0) { this.lastTick = sec; SG.Audio.sfx('tick', { vol: 0.8, pitch: sec <= 3 ? 1.3 : 1 }); }
        if (this.timeLeft <= 0) {
          this.timeLeft = 0;
          this.phase = 'over';
          this.overT = 0;
          for (const g of this.gulls) g.frozen = true;
          SG.Audio.sfx('whistle');
          SG.Audio.setTempo(1);
        }
      } else if (this.phase === 'over') {
        this.overT += dt;
      }

      // environment
      this.rain = M.approach(this.rain, this.rainTarget, dt * 0.5);
      this.ferry = M.approach(this.ferry, this.ferryTarget, dt / 3.2);

      // gulls
      for (const g of this.gulls) {
        let inp = SG.NO_INPUT;
        if (g.cpu) inp = g.brain.think(dt);
        else if (inputs && inputs[g.slot]) inp = inputs[g.slot];
        g.update(dt, inp);
      }
      // leader (for the crown)
      let lead = null, ls = 0, tie = false;
      for (const g of this.gulls) { if (g.score > ls) { ls = g.score; lead = g; tie = false; } else if (g.score === ls && ls > 0) tie = true; }
      this.leader = tie ? null : lead;

      // people
      if (this.phase !== 'over') {
        this.spawnT -= dt;
        const cap = (this.attract ? 10 : 11) + (this.activeEvents.ferry ? 6 : 0) + (this.activeEvents.rush ? 5 : 0);
        const living = this.people.filter((p) => !p.piper).length;
        if (this.spawnT <= 0) {
          this.spawnT = M.rand(1.4, 3.0) * (this.rain > 0.5 ? 2.2 : 1);
          if (living < cap) this.spawnPerson();
        }
      }
      for (const p of this.people) p.update(dt);
      this.people = this.people.filter((p) => {
        if (p.dead) { if (p.seat) p.seat.taken = null; if (p.shop) p.shop.leaveQueue(p); }
        return !p.dead;
      });
      for (const s of this.shops) s.update(dt);

      // bins
      for (const b of this.bins) {
        b.cd -= dt; b.shake = Math.max(0, b.shake - dt * 4);
        if (b.tipped) { b.tipT -= dt; if (b.tipT <= 0) { b.tipped = false; b.lidOff = false; b.box.h = 68 * SG.depthScale(b.y); this.fx.puff(b.x, b.y, 30, 6, '#ffffff', 60); SG.Audio.sfx('pop', { pan: SG.panFor(b.x) }); } }
        else { b.refillT -= dt; if (b.refillT <= 0) { b.refillT = M.rand(14, 24); b.fill = Math.min(4, b.fill + 1); } }
      }

      for (const it of this.items) it.update(dt);
      this.items = this.items.filter((it) => !it.dead);
      for (const pp of this.poops) pp.update(dt);
      this.poops = this.poops.filter((pp) => !pp.dead);
      for (const s of this.splats) s.age += dt;
      this.splats = this.splats.filter((s) => s.age < s.life);
      this.fx.update(dt);
      this.updateEvents(dt);
    }

    // ------------------------------------------------------------ draw
    draw(ctx) {
      const t = this.time;
      const bd = (SG.getBackdrop && SG.getBackdrop(this.stage.id)) || this.bd;
      let drawn = false;
      if (bd && SG.Backdrop) {
        try { SG.Backdrop.drawBack(ctx, bd, t, { ferry: M.easeInOut(this.ferry), rain: this.rain }); drawn = true; } catch (e) { if (!this.bdErr) { console.error(e); this.bdErr = true; } }
      }
      if (!drawn) this.drawFallbackBack(ctx);

      for (const s of this.shops) s.drawHatch(ctx, t);

      // ground decals
      for (const s of this.splats) SG.Art.splatDecal(ctx, s.x, s.y, s.r, Math.min(1, (s.life - s.age) / 3), s.seed);
      if (SG.settings.cones !== false && !this.attract) for (const p of this.people) p.drawCone(ctx);

      // shadows & player rings
      for (const p of this.people) SG.Art.shadow(ctx, p.x, p.y + 2, 30 * SG.depthScale(p.y) * p.ws, 0.2);
      for (const it of this.items) if (!it.counter && !it.inWater) SG.Art.shadow(ctx, it.x, it.y - it.floor + 2, 12 * SG.depthScale(it.y), 0.18);
      for (const g of this.gulls) {
        const s = SG.depthScale(g.y);
        const h = Math.max(0, g.z - g.floor);
        const k = Math.max(0.35, 1 - h / 500);
        const gy = g.y - g.floor;
        if (!g.inWater) SG.Art.shadow(ctx, g.x, gy + 2, 30 * s * k, 0.25 * k);
        ctx.save();
        ctx.globalAlpha = 0.85;
        ctx.strokeStyle = g.color; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.ellipse(g.x, gy + 2, 34 * s * k, 11 * s * k, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }

      // depth-sorted scene
      const list = [];
      for (const p of this.props) list.push({ k: p.y, f: () => SG.Art.propCached(ctx, p, t) });
      list.push({ k: 944, f: () => SG.Art.railing(ctx, 944) });
      if (this.lamps.length > 1) list.push({ k: 891, f: () => this.drawBunting(ctx, t) });
      for (const p of this.people) list.push({ k: p.y + 0.1, f: () => p.draw(ctx, t) });
      for (const g of this.gulls) list.push({ k: this.sortKey(g.x, g.y, g.z) + 0.2, f: () => g.draw(ctx) });
      for (const it of this.items) list.push({ k: it.counter ? 548 : this.sortKey(it.x, it.y, it.z) + 0.15, f: () => it.draw(ctx, t) });
      for (const pp of this.poops) list.push({ k: pp.y + 0.3, f: () => pp.draw(ctx) });
      if (this.dog) list.push({ k: this.dog.y + 0.1, f: () => this.dog.draw(ctx) });
      if (this.boat) list.push({ k: 1010, f: () => this.drawBoat(ctx, t) });
      for (const p of this.fx.parts) list.push({ k: p.y + 0.4, f: () => this.fx.drawPart(ctx, p) });
      list.sort((a, b) => a.k - b.k);
      for (const d of list) d.f();

      // rain
      if (this.rain > 0.02) this.drawRain(ctx, t);

      // overlays
      for (const p of this.people) p.drawOverlay(ctx, t);
      for (const s of this.shops) s.drawOverlay(ctx, t);
      for (const g of this.gulls) this.drawTag(ctx, g, t);
      this.fx.drawFloaters(ctx);
    }

    drawBunting(ctx, t) {
      // four pre-rendered flutter frames, cycled
      const frame = Math.floor(t * 5) % 4;
      const y0 = 600, h = 160;
      const spr = SG.sprite('bunting:' + this.stage.id + ':' + frame, SG.W, h, (c) => { c.translate(0, -y0); this.drawBuntingRaw(c, frame * 0.55); });
      ctx.drawImage(spr, 0, y0, SG.W, h);
    }
    drawBuntingRaw(ctx, t) {
      for (let i = 0; i < this.lamps.length - 1; i++) {
        const a = this.lamps[i], b = this.lamps[i + 1];
        if (b.x - a.x > 700) continue;
        const sa = SG.depthScale(a.y), sb = SG.depthScale(b.y);
        SG.Art.bunting(ctx, a.x + 14 * sa, a.y - 200 * sa, b.x - 14 * sb, b.y - 200 * sb, t, i);
      }
    }

    drawBoat(ctx, t) {
      const b = this.boat;
      const y = 1012 + Math.sin(t * 2) * 4;
      ctx.save();
      ctx.translate(b.x, y);
      ctx.rotate(Math.sin(t * 1.6) * 0.03);
      // fisherman
      SG.Art.person(ctx, { x: 30, y: -6, s: 0.8, facing: -1, pose: b.arm > 0 ? 'swat' : 'stand', t, kind: 'fisherman', top: '#ffd23f', bottom: '#ffd23f', hat: 'beanie', hatColor: '#e84a5f', skin: '#efc09e', hair: '#6b4226' });
      // hull
      ctx.beginPath(); ctx.moveTo(-130, -26); ctx.lineTo(130, -26); ctx.quadraticCurveTo(120, 30, 80, 50); ctx.lineTo(-90, 50); ctx.quadraticCurveTo(-125, 20, -130, -26); ctx.closePath();
      SG.Art.fillStroke(ctx, '#e8413a', 4);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(-126, -24, 254, 9);
      ctx.fillStyle = SG.INK; ctx.font = `700 20px ${SG.FONT}`; ctx.textAlign = 'center'; ctx.fillText('OB 157', -40, 18);
      // wheelhouse
      SG.roundRect(ctx, -110, -84, 70, 60, 6); SG.Art.fillStroke(ctx, '#ffffff', 4);
      ctx.fillStyle = '#7fd3f7'; ctx.fillRect(-100, -74, 22, 18); ctx.fillRect(-72, -74, 22, 18);
      ctx.restore();
      // bow wave
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(b.x, y + 46, 150, 10, 0, 0, Math.PI); ctx.stroke();
    }

    drawRain(ctx, t) {
      ctx.save();
      ctx.globalAlpha = this.rain * 0.55;
      ctx.strokeStyle = '#dcefff'; ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < 220; i++) {
        const seed = i * 97.13;
        const x = ((seed * 13.7 + t * 260) % (SG.W + 200)) - 100;
        const y = ((seed * 7.31 + t * 1300 + i * 37) % (SG.H + 100)) - 50;
        ctx.moveTo(x, y); ctx.lineTo(x - 7, y + 26);
      }
      ctx.stroke();
      ctx.globalAlpha = this.rain * 0.12;
      ctx.fillStyle = '#4a5a70'; ctx.fillRect(0, 0, SG.W, SG.H);
      ctx.restore();
    }

    drawTag(ctx, g, t) {
      if (this.attract) return;
      const s = SG.depthScale(g.y);
      let y = g.y - g.z - 92 * s;
      y = Math.max(28, y);
      const label = g.cpu ? 'CPU' : 'P' + (g.slot + 1);
      ctx.save();
      ctx.font = `400 20px ${SG.FONT_TITLE}`;
      const w = ctx.measureText(label).width + 16;
      SG.roundRect(ctx, g.x - w / 2, y - 26, w, 24, 12);
      ctx.fillStyle = g.color; ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = SG.INK; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(g.x - 6, y - 3); ctx.lineTo(g.x + 6, y - 3); ctx.lineTo(g.x, y + 5); ctx.closePath();
      ctx.fillStyle = g.color; ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, g.x, y - 13);
      ctx.restore();
      if (this.leader === g) {
        ctx.save();
        ctx.translate(g.x, y - 36 + Math.sin(t * 4) * 3);
        ctx.scale(1.2, 1.2);
        ctx.beginPath(); ctx.moveTo(-12, 6); ctx.lineTo(-14, -9); ctx.lineTo(-6, -1); ctx.lineTo(0, -12); ctx.lineTo(6, -1); ctx.lineTo(14, -9); ctx.lineTo(12, 6); ctx.closePath();
        SG.Art.fillStroke(ctx, '#ffd23f', 3);
        ctx.restore();
      }
      if (!g.cpu && g.carry && g.carryT > 2.2 && this.phase === 'play' && (g.eatHints || 0) < 4) {
        const dev = SG.Input.get(g.deviceId);
        const h = SG.Input.hints(dev && dev.type === 'gamepad' ? 'pad' : g.deviceId === 'kb2' ? 'keyboard2' : 'keyboard1');
        SG.UI.hint(ctx, `HOLD ${h.peck} ON A PERCH TO EAT!`, g.x, y - 40 - Math.abs(Math.sin(t * 5)) * 6, { size: 20, fill: SG.rgba(g.dark, 0.92) });
        if (g.carryT > 6) { g.carryT = 0; g.eatHints = (g.eatHints || 0) + 1; }
      }
      if (g.carry && !SG.FOODS[g.carry.type].small) {
        // bites-left pips while carrying
        const n = g.carry.bites;
        for (let i = 0; i < n; i++) {
          ctx.beginPath(); ctx.arc(g.x - (n - 1) * 6 + i * 12, y + 14, 4, 0, Math.PI * 2);
          ctx.fillStyle = '#ffd36b'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = SG.INK; ctx.stroke();
        }
        if (g.eating) {
          const k = g.eatT / SG.GULL_TUNING.biteTime;
          ctx.beginPath(); ctx.arc(g.x + (n * 6) + 14, y + 14, 8, -HALF_PI, -HALF_PI + k * Math.PI * 2);
          ctx.lineWidth = 4; ctx.strokeStyle = '#fff'; ctx.stroke();
        }
      }
    }

    drawFallbackBack(ctx) {
      const st = this.stage;
      const g = ctx.createLinearGradient(0, 0, 0, 560);
      g.addColorStop(0, st.skyTop); g.addColorStop(1, st.skyBottom);
      ctx.fillStyle = g; ctx.fillRect(0, 0, SG.W, 560);
      ctx.fillStyle = '#7cc46b'; ctx.beginPath(); ctx.moveTo(0, 340); ctx.quadraticCurveTo(500, 150, 1000, 300); ctx.quadraticCurveTo(1500, 200, 1920, 330); ctx.lineTo(1920, 560); ctx.lineTo(0, 560); ctx.fill();
      for (const s of st.shops) {
        ctx.fillStyle = s.color; ctx.fillRect(s.x0, s.roofY, s.x1 - s.x0, SG.FACADE_Y - s.roofY);
        ctx.strokeStyle = SG.INK; ctx.lineWidth = 4; ctx.strokeRect(s.x0, s.roofY, s.x1 - s.x0, SG.FACADE_Y - s.roofY);
        if (s.hatchX) { ctx.fillStyle = '#4a3328'; ctx.fillRect(s.hatchX - 75, 440, 150, 90); }
        SG.text(ctx, s.label, (s.x0 + s.x1) / 2, 395, { size: 26, font: SG.FONT_TITLE, weight: 400 });
      }
      ctx.fillStyle = '#e9dcc0'; ctx.fillRect(0, 560, SG.W, 345);
      ctx.fillStyle = '#cbb894'; ctx.fillRect(0, 905, SG.W, 43);
      ctx.fillStyle = st.waterColor; ctx.fillRect(0, 948, SG.W, 132);
    }
  }
  SG.World = World;
})(window.SG);
