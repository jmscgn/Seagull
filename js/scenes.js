// ---------------------------------------------------------------------------
// Scenes: title, menu, lobby, stage select, game (+pause), round results,
// final podium, options, how-to-play, credits.
// ---------------------------------------------------------------------------
(function (SG) {
  'use strict';
  const M = SG.M;
  const UI = SG.UI;
  const S = {};
  SG.Scenes = S;

  const CPU_NAMES = ['Big Malky', 'Senga', 'Rab', 'Isla', 'Shuggie', 'Agnes', 'Wee Jimmy', 'Fergus', 'Mhairi', 'Tam'];
  const DEFAULT_HATS = ['tam', 'beanie', 'sailor', 'viking'];

  SG.session = SG.session || { players: [], stageId: 'oban', rounds: 3, round: 1, wins: [0, 0, 0, 0], totals: [0, 0, 0, 0], stats: {}, cpuCount: 3, lobbySlots: null };

  // ------------------------------------------------------------------ attract world (menu background)
  const attract = {
    world: null,
    ensure() {
      if (!this.world || this.world.time > 150) {
        this.world = new SG.World('oban', [0, 1, 2, 3].map((i) => ({ slot: i, cpu: true, level: [1, 2, 1, 0][i], hat: ['tam', 'viking', 'beanie', 'sailor'][i], name: CPU_NAMES[i] })), { attract: true });
        this.world.bd = SG.getBackdrop('oban');
      }
      return this.world;
    },
    update(dt) { this.ensure().update(Math.min(dt, 1 / 30)); },
    draw(ctx, dim) {
      this.ensure().draw(ctx);
      if (dim) UI.fadeOverlay(ctx, dim, '#1d1640');
    },
  };
  SG.attractWorld = attract;

  function menuNav(sel, n, m) {
    if (m.up) { sel = (sel + n - 1) % n; SG.Audio.sfx('menuMove'); }
    if (m.down) { sel = (sel + 1) % n; SG.Audio.sfx('menuMove'); }
    return sel;
  }

  function footer(ctx, text) {
    UI.hint(ctx, text, SG.W / 2, SG.H - 40, { size: 22 });
  }

  // ------------------------------------------------------------------ TITLE
  S.title = {
    enter() { this.t = 0; SG.Audio.music('title'); SG.Audio.loop('waves', true, 0.5); },
    update(dt) {
      this.t += dt;
      attract.update(dt);
      const m = SG.Input.menu();
      if (this.t > 0.6 && (m.any || SG.Input.anyKey || SG.Input.clicked)) {
        SG.Audio.sfx('menuSelect');
        SG.Audio.sfx('squawk', { pitch: 1.05 });
        SG.Game.go('menu');
      }
    },
    draw(ctx) {
      attract.draw(ctx, 0);
      const g = ctx.createLinearGradient(0, 0, 0, SG.H);
      g.addColorStop(0, 'rgba(29,22,64,0.55)'); g.addColorStop(0.55, 'rgba(29,22,64,0.15)'); g.addColorStop(1, 'rgba(29,22,64,0.6)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, SG.W, SG.H);
      const k = Math.min(1, this.t / 0.7);
      UI.logo(ctx, SG.W / 2, 330, this.t, M.easeOutBack(k));
      if (this.t > 0.8 && Math.floor(this.t * 2) % 2 === 0) SG.text(ctx, 'PRESS ANY BUTTON', SG.W / 2, 700, { size: 56, font: SG.FONT_TITLE, weight: 400, color: '#ffd23f', strokeWidth: 12 });
      if (!SG.Audio.isRunning() && this.t > 1) UI.hint(ctx, '\u266A  Click or press any key to turn the sound on', SG.W / 2, 790, { size: 26, fill: 'rgba(255,77,109,0.9)' });
      const pads = SG.Input.gamepadCount();
      footer(ctx, pads ? `${pads} controller${pads > 1 ? 's' : ''} connected • 1–4 players` : 'Plug in up to 4 controllers • or play on keyboard (WASD + Space / Arrows + /)');
    },
  };

  // ------------------------------------------------------------------ MAIN MENU
  S.menu = {
    items: [{ label: 'PLAY', go: 'lobby' }, { label: 'HOW TO PLAY', go: 'howto' }, { label: 'OPTIONS', go: 'options' }, { label: 'CREDITS', go: 'credits' }],
    enter() { this.t = 0; this.sel = this.sel || 0; SG.Audio.music('title'); },
    update(dt) {
      this.t += dt;
      attract.update(dt);
      const m = SG.Input.menu();
      this.sel = menuNav(this.sel, this.items.length, m);
      if (m.confirm || m.start) { SG.Audio.sfx('menuSelect'); SG.Game.go(this.items[this.sel].go); }
      else if (m.cancel) { SG.Audio.sfx('menuBack'); SG.Game.go('title'); }
    },
    draw(ctx) {
      attract.draw(ctx, 0.35);
      UI.logo(ctx, SG.W / 2, 190, this.t, 0.62);
      UI.menu(ctx, this.items, this.sel, SG.W / 2, 400, this.t);
      if (!SG.Audio.isRunning()) UI.hint(ctx, '\u266A  Click or press any key to turn the sound on', SG.W / 2, 980, { size: 24, fill: 'rgba(255,77,109,0.9)' });
      footer(ctx, 'Navigate: Stick / D-pad / WASD / Arrows • Select: A / Space / Enter • Back: B / Esc');
    },
  };

  // ------------------------------------------------------------------ LOBBY
  S.lobby = {
    enter() {
      this.t = 0;
      SG.Audio.music('lobby');
      const sess = SG.session;
      // keep previous players if coming back from stage select
      this.slots = sess.lobbySlots || [null, null, null, null];
      for (const s of this.slots) if (s) s.ready = false;
      this.cpuCount = sess.cpuCount === undefined ? 3 : sess.cpuCount;
      this.cpuLevel = SG.settings.cpuLevel;
      this.cpuHats = [M.pick(SG.Art.HATS.slice(1)), M.pick(SG.Art.HATS.slice(1)), M.pick(SG.Art.HATS.slice(1)), M.pick(SG.Art.HATS.slice(1))];
      this.cpuNames = M.shuffle(CPU_NAMES.slice());
    },
    humans() { return this.slots.filter((s) => s); },
    cpuSlots() {
      const out = [];
      let n = Math.min(this.cpuCount, 4 - this.humans().length);
      for (let i = 0; i < 4 && n > 0; i++) if (!this.slots[i]) { out.push(i); n--; }
      return out;
    },
    update(dt) {
      this.t += dt;
      attract.update(dt);
      const devices = SG.Input.list();
      let anyCancelUnjoined = false;
      for (const d of devices) {
        const idx = this.slots.findIndex((s) => s && s.deviceId === d.id);
        if (idx < 0) {
          if (d.pressed.confirm || d.pressed.start || d.pressed.flap) {
            const free = this.slots.findIndex((s) => !s);
            if (free >= 0) {
              this.slots[free] = { deviceId: d.id, hat: DEFAULT_HATS[free], ready: false, joinT: 0 };
              SG.Audio.sfx('join');
              SG.Audio.sfx('squawk', { pitch: [1, 0.86, 1.14, 1.26][free], pan: (free - 1.5) * 0.4 });
              SG.Input.rumble(d.id, 0.3, 0.5, 120);
            }
          } else if (d.pressed.cancel) anyCancelUnjoined = true;
          continue;
        }
        const s = this.slots[idx];
        s.joinT = (s.joinT || 0) + dt;
        if (!s.ready) {
          const hats = SG.Art.HATS;
          if (d.pressed.left || d.pressed.right) {
            let hi = hats.indexOf(s.hat);
            hi = (hi + (d.pressed.right ? 1 : hats.length - 1)) % hats.length;
            s.hat = hats[hi]; SG.Audio.sfx('menuMove'); s.hatPop = 0.25;
          }
          if ((d.pressed.confirm || d.pressed.start) && s.joinT > 0.15) { s.ready = true; SG.Audio.sfx('menuSelect'); SG.Audio.sfx('squawk', { pitch: [1, 0.86, 1.14, 1.26][idx] }); }
          else if (d.pressed.cancel) { this.slots[idx] = null; SG.Audio.sfx('menuBack'); }
        } else {
          if (d.pressed.cancel) { s.ready = false; SG.Audio.sfx('menuBack'); }
          else if (d.pressed.start || d.pressed.confirm) this.tryBegin();
        }
        if (d.pressed.dash) { this.cpuCount = (this.cpuCount + 1) % 4; SG.Audio.sfx('menuMove'); }
        if (d.pressed.squawk) { this.cpuLevel = (this.cpuLevel + 1) % 3; SG.settings.cpuLevel = this.cpuLevel; SG.saveSettings(); SG.Audio.sfx('menuMove'); }
        if (s.hatPop > 0) s.hatPop -= dt;
      }
      if (anyCancelUnjoined && this.humans().length === 0) { SG.Audio.sfx('menuBack'); SG.Game.go('menu'); }
    },
    tryBegin() {
      const hs = this.humans();
      if (!hs.length || hs.some((s) => !s.ready)) { SG.Audio.sfx('menuBack'); return; }
      const sess = SG.session;
      sess.lobbySlots = this.slots;
      sess.cpuCount = this.cpuCount;
      const players = [];
      this.slots.forEach((s, i) => { if (s) players.push({ slot: i, deviceId: s.deviceId, cpu: false, hat: s.hat, name: SG.PLAYER_NAMES[i] }); });
      this.cpuSlots().forEach((i, k) => players.push({ slot: i, cpu: true, level: this.cpuLevel, hat: this.cpuHats[i], name: this.cpuNames[k] }));
      players.sort((a, b) => a.slot - b.slot);
      sess.players = players;
      SG.Audio.sfx('menuSelect');
      SG.Game.go('stage');
    },
    draw(ctx) {
      attract.draw(ctx, 0.55);
      SG.text(ctx, 'CHOOSE YER GULL', SG.W / 2, 92, { size: 84, font: SG.FONT_TITLE, weight: 400, color: '#ffd23f', strokeWidth: 16 });
      const cpus = this.cpuSlots();
      const cw = 420, ch = 600, gap = 36;
      const x0 = SG.W / 2 - (cw * 4 + gap * 3) / 2;
      for (let i = 0; i < 4; i++) {
        const x = x0 + i * (cw + gap), y = 180;
        const s = this.slots[i];
        const isCpu = cpus.includes(i);
        const col = SG.PLAYER_COLORS[i];
        if (s) {
          UI.panel(ctx, x, y, cw, ch, { fill: '#ffffff', stripe: col, stripeH: 86, r: 30 });
          SG.text(ctx, 'P' + (i + 1), x + 50, y + 44, { size: 52, font: SG.FONT_TITLE, weight: 400 });
          SG.text(ctx, SG.PLAYER_NAMES[i], x + cw / 2 + 30, y + 46, { size: 34, font: SG.FONT_TITLE, weight: 400 });
          // gull on a little bit of pavement
          ctx.fillStyle = '#efe3c8'; SG.roundRect(ctx, x + 40, y + 380, cw - 80, 40, 20); ctx.fill();
          const pop = s.hatPop > 0 ? 1 + s.hatPop : 1;
          SG.Art.shadow(ctx, x + cw / 2, y + 398, 70, 0.25);
          SG.Art.gull(ctx, { x: x + cw / 2 - 10, y: y + 398, s: 3.3 * (s.ready ? 1 : 1), facing: 1, pose: s.ready ? 'run' : 'idle', t: this.t + i, color: col, hat: s.hat, beakOpen: s.ready && Math.sin(this.t * 6) > 0.3 });
          if (!s.ready) {
            const k = Math.sin(this.t * 8) * 4;
            SG.text(ctx, '◀', x + 36 - k, y + 260, { size: 40, color: col });
            SG.text(ctx, '▶', x + cw - 36 + k, y + 260, { size: 40, color: col });
          }
          ctx.save(); ctx.translate(x + cw / 2, y + 460); ctx.scale(pop, pop);
          SG.text(ctx, SG.Art.HAT_NAMES[s.hat] || s.hat, 0, 0, { size: 30, color: SG.INK, stroke: false, weight: 700 });
          ctx.restore();
          const dev = SG.Input.get(s.deviceId);
          const hint = SG.Input.hints(dev && dev.type === 'gamepad' ? 'pad' : s.deviceId === 'kb1' ? 'keyboard1' : 'keyboard2');
          SG.text(ctx, dev ? dev.name : 'Disconnected', x + cw / 2, y + 500, { size: 20, color: '#7a7498', stroke: false, weight: 600 });
          if (s.ready) {
            ctx.save(); ctx.translate(x + cw / 2, y + 552); ctx.rotate(-0.04);
            UI.panel(ctx, -120, -30, 240, 60, { fill: '#2ec27e', r: 30, lw: 5 });
            SG.text(ctx, 'READY!', 0, 3, { size: 38, font: SG.FONT_TITLE, weight: 400 });
            ctx.restore();
          } else {
            SG.text(ctx, `${hint.flap} = Ready  •  ◀▶ = Hat`, x + cw / 2, y + 552, { size: 22, color: SG.INK, stroke: false, weight: 700 });
          }
        } else if (isCpu) {
          UI.panel(ctx, x, y, cw, ch, { fill: '#eef1f6', stripe: '#9aa3b5', stripeH: 86, r: 30, alpha: 0.95 });
          SG.text(ctx, 'CPU', x + 60, y + 44, { size: 48, font: SG.FONT_TITLE, weight: 400 });
          SG.text(ctx, this.cpuNames[cpus.indexOf(i)] || 'Gull', x + cw / 2 + 40, y + 46, { size: 30, font: SG.FONT_TITLE, weight: 400 });
          SG.Art.shadow(ctx, x + cw / 2, y + 398, 70, 0.2);
          SG.Art.gull(ctx, { x: x + cw / 2 - 10, y: y + 398, s: 3.0, facing: 1, pose: 'idle', t: this.t * 0.8 + i, color: col, hat: this.cpuHats[i], blink: Math.sin(this.t * 2 + i) > 0.95 });
          SG.text(ctx, SG.AI_LEVELS[this.cpuLevel].name.toUpperCase(), x + cw / 2, y + 470, { size: 36, font: SG.FONT_TITLE, weight: 400, color: ['#2ec27e', '#ffbe0b', '#ff4d6d'][this.cpuLevel] });
          SG.text(ctx, ['Easy-peasy', 'A fair fight', 'Absolute gannet'][this.cpuLevel], x + cw / 2, y + 512, { size: 22, color: '#7a7498', stroke: false, weight: 600 });
        } else {
          UI.panel(ctx, x, y, cw, ch, { fill: 'rgba(255,255,255,0.18)', stroke: 'rgba(255,255,255,0.7)', r: 30, shadow: false, lw: 4 });
          const bob = Math.sin(this.t * 3 + i) * 8;
          SG.text(ctx, 'PRESS', x + cw / 2, y + 230 + bob, { size: 48, font: SG.FONT_TITLE, weight: 400, color: col });
          SG.text(ctx, 'A / SPACE / ENTER', x + cw / 2, y + 290 + bob, { size: 30, font: SG.FONT_TITLE, weight: 400 });
          SG.text(ctx, 'TO JOIN', x + cw / 2, y + 340 + bob, { size: 40, font: SG.FONT_TITLE, weight: 400, color: col });
        }
      }
      const hs = this.humans();
      const allReady = hs.length && hs.every((s) => s.ready);
      if (allReady) {
        const k = 1 + Math.sin(this.t * 6) * 0.04;
        ctx.save(); ctx.translate(SG.W / 2, 870); ctx.scale(k, k);
        UI.panel(ctx, -330, -42, 660, 84, { fill: '#ffd23f', r: 42 });
        SG.text(ctx, 'PRESS START / ENTER TO SCRAN!', 0, 4, { size: 40, font: SG.FONT_TITLE, weight: 400, color: SG.INK, stroke: false });
        ctx.restore();
      }
      UI.hint(ctx, `CPU gulls: ${Math.min(this.cpuCount, 4 - hs.length)}  (Y / Shift to change)   •   CPU skill: ${SG.AI_LEVELS[this.cpuLevel].name}  (LB / Q to change)`, SG.W / 2, 960, { size: 24 });
      footer(ctx, hs.length ? 'B / Esc: un-ready or leave' : 'B / Esc: back to menu');
    },
  };

  // ------------------------------------------------------------------ STAGE SELECT
  const thumbs = {};
  function stageThumb(id) {
    if (thumbs[id]) return thumbs[id];
    const c = SG.makeCanvas(640, 360);
    const x = c.getContext('2d');
    x.scale(640 / SG.W, 360 / SG.H);
    const w = new SG.World(id, [], { attract: true });
    w.people = []; w.bd = SG.getBackdrop(id);
    w.draw(x);
    thumbs[id] = c;
    return c;
  }
  S.stage = {
    opts: ['oban', 'largs', 'random'],
    enter() { this.t = 0; this.sel = this.opts.indexOf(SG.session.stageId); if (this.sel < 0) this.sel = 0; },
    update(dt) {
      this.t += dt;
      attract.update(dt);
      const m = SG.Input.menu();
      if (m.left) { this.sel = (this.sel + 2) % 3; SG.Audio.sfx('menuMove'); }
      if (m.right) { this.sel = (this.sel + 1) % 3; SG.Audio.sfx('menuMove'); }
      if (m.confirm || m.start) {
        SG.session.stageId = this.opts[this.sel];
        SG.Audio.sfx('menuSelect');
        SG.Game.go('game', { newMatch: true });
      } else if (m.cancel) { SG.Audio.sfx('menuBack'); SG.Game.go('lobby'); }
    },
    draw(ctx) {
      attract.draw(ctx, 0.6);
      SG.text(ctx, 'WHERE ARE WE SCRANNING?', SG.W / 2, 110, { size: 76, font: SG.FONT_TITLE, weight: 400, color: '#ffd23f', strokeWidth: 16 });
      const cw = 560, ch = 470, gap = 40;
      const x0 = SG.W / 2 - (cw * 3 + gap * 2) / 2;
      this.opts.forEach((id, i) => {
        const on = i === this.sel;
        const x = x0 + i * (cw + gap), y = 230;
        ctx.save();
        ctx.translate(x + cw / 2, y + ch / 2);
        const k = on ? 1.05 + Math.sin(this.t * 5) * 0.01 : 0.95;
        ctx.scale(k, k);
        UI.panel(ctx, -cw / 2, -ch / 2, cw, ch, { fill: on ? '#ffd23f' : '#fff8e7', r: 30, lw: on ? 7 : 5 });
        const tx = -cw / 2 + 24, ty = -ch / 2 + 24, tw = cw - 48, th = tw * 9 / 16;
        ctx.save(); SG.roundRect(ctx, tx, ty, tw, th, 16); ctx.clip();
        if (id === 'random') {
          ctx.fillStyle = '#2bb3a6'; ctx.fillRect(tx, ty, tw, th);
          SG.text(ctx, '?', 0, ty + th / 2 + 10, { size: 200, font: SG.FONT_TITLE, weight: 400, color: '#ffd23f', strokeWidth: 20 });
        } else ctx.drawImage(stageThumb(id), tx, ty, tw, th);
        ctx.restore();
        SG.roundRect(ctx, tx, ty, tw, th, 16); ctx.lineWidth = 5; ctx.strokeStyle = SG.INK; ctx.stroke();
        const st = SG.STAGES[id];
        SG.text(ctx, st ? st.name.toUpperCase() : 'SURPRISE ME', 0, ty + th + 62, { size: 50, font: SG.FONT_TITLE, weight: 400, color: on ? '#ffffff' : '#ffd23f' });
        SG.text(ctx, st ? st.tagline : 'Let the gulls decide', 0, ty + th + 112, { size: 26, color: SG.INK, stroke: false, weight: 700 });
        ctx.restore();
      });
      const rt = SG.settings.roundTime;
      UI.hint(ctx, `${SG.settings.rounds} round${SG.settings.rounds > 1 ? 's' : ''} • ${Math.floor(rt / 60)}:${String(rt % 60).padStart(2, '0')} each • change in Options`, SG.W / 2, 820, { size: 26 });
      footer(ctx, '◀ ▶ choose • A / Space / Enter: go! • B / Esc: back');
    },
  };

  // ------------------------------------------------------------------ GAME
  S.game = {
    enter(data) {
      const sess = SG.session;
      this.t = 0;
      if (data && data.newMatch) {
        sess.rounds = SG.settings.rounds;
        sess.round = 1;
        sess.wins = [0, 0, 0, 0];
        sess.totals = [0, 0, 0, 0];
        sess.stats = {};
        sess.lastStage = null;
      }
      this.startRound();
      SG.Audio.music('game');
      SG.Audio.setTempo(1);
      SG.Audio.loop('waves', true, 0.45);
      SG.Audio.loop('crowd', true, 0.35);
      this.paused = false;
      this.pauseSel = 0;
    },
    startRound() {
      const sess = SG.session;
      let id = sess.stageId;
      if (id === 'random') id = M.pick(SG.STAGE_ORDER.filter((s) => s !== sess.lastStage)) || 'oban';
      sess.lastStage = id;
      this.world = new SG.World(id, sess.players, { roundTime: SG.settings.roundTime });
      this.world.bd = SG.getBackdrop(id);
      SG.Audio.stinger('roundStart');
    },
    exit() { SG.Audio.loop('crowd', false); SG.Audio.loop('rain', false); SG.Audio.setTempo(1); },
    humanDevices() { return SG.session.players.filter((p) => !p.cpu).map((p) => SG.Input.get(p.deviceId)).filter(Boolean); },
    update(dt) {
      this.t += dt;
      const w = this.world;
      if (this.paused) { this.updatePause(); return; }
      for (const d of this.humanDevices()) {
        if (d.pressed.start) { this.paused = true; this.pauseSel = 0; SG.Audio.sfx('menuSelect'); SG.Input.flush(); return; }
      }
      if (this.lostPad()) { this.paused = true; this.pauseSel = 0; return; }
      // hit-stop: freeze the action for a few frames on big hits
      if (w.hitStop > 0) { w.hitStop -= dt; w.fx.update(dt * 0.25); return; }
      // substeps for stable collisions; presses only count on the first
      const steps = Math.max(1, Math.ceil(dt / (1 / 60)));
      const h = dt / steps;
      for (let i = 0; i < steps; i++) {
        const inputs = {};
        for (const p of SG.session.players) {
          if (p.cpu) continue;
          const d = SG.Input.get(p.deviceId);
          if (!d) continue;
          inputs[p.slot] = i === 0 ? d : { mx: d.mx, my: d.my, held: d.held, pressed: {} };
        }
        w.update(h, inputs);
      }
      // score pop for the HUD
      for (const g of w.gulls) {
        if (g.lastScore !== g.score) { g.scorePop = 1; g.lastScore = g.score; }
        g.scorePop = Math.max(0, (g.scorePop || 0) - dt * 4);
      }
      if (w.phase === 'over' && w.overT > 2.4) SG.Game.go('roundEnd');
    },
    lostPad() {
      for (const p of SG.session.players) {
        if (p.cpu) continue;
        const d = SG.Input.get(p.deviceId);
        if (d && d.type === 'gamepad' && !d.connected) return true;
      }
      return false;
    },
    updatePause() {
      const m = SG.Input.menu();
      const items = ['RESUME', 'RESTART ROUND', 'QUIT TO MENU'];
      this.pauseSel = menuNav(this.pauseSel, items.length, m);
      if (m.start && !this.lostPad()) { this.paused = false; SG.Audio.sfx('menuBack'); return; }
      if (m.cancel && !this.lostPad()) { this.paused = false; SG.Audio.sfx('menuBack'); return; }
      if (m.confirm) {
        SG.Audio.sfx('menuSelect');
        if (this.pauseSel === 0) { if (!this.lostPad()) this.paused = false; }
        else if (this.pauseSel === 1) { this.startRound(); this.paused = false; SG.Audio.setTempo(1); SG.Audio.music('game'); }
        else SG.Game.go('menu');
      }
    },
    draw(ctx) {
      const w = this.world;
      ctx.save();
      if (w.shakeAmt > 0) ctx.translate(M.rand(-1, 1) * w.shakeAmt, M.rand(-1, 1) * w.shakeAmt);
      w.draw(ctx);
      ctx.restore();
      UI.hud(ctx, w, SG.session, this.t);
      if (this.paused) {
        UI.fadeOverlay(ctx, 0.55);
        SG.text(ctx, 'PAUSED', SG.W / 2, 250, { size: 110, font: SG.FONT_TITLE, weight: 400, color: '#ffd23f', strokeWidth: 18 });
        if (this.lostPad()) SG.text(ctx, 'A controller disconnected – plug it back in!', SG.W / 2, 340, { size: 34, color: '#ff8a8a' });
        UI.menu(ctx, [{ label: 'RESUME' }, { label: 'RESTART ROUND' }, { label: 'QUIT TO MENU' }], this.pauseSel, SG.W / 2, 420, this.t);
        controlsCard(ctx, SG.W / 2, 860, 0.8);
      }
    },
  };

  function controlsCard(ctx, cx, cy, sc) {
    ctx.save(); ctx.translate(cx, cy); ctx.scale(sc, sc);
    UI.panel(ctx, -760, -70, 1520, 140, { fill: '#fff8e7', r: 26 });
    const cols = [['MOVE', 'Stick', 'WASD', 'Arrows'], ['FLAP / FLY', 'A', 'Space', '/'], ['PECK • SWOOP • EAT', 'X', 'F', '.'], ['POOP', 'B', 'G', ','], ['DASH', 'Y / RT', 'Shift', 'R-Shift'], ['SQUAWK', 'LB', 'Q', ';']];
    cols.forEach((c, i) => {
      const x = -650 + i * 260;
      SG.text(ctx, c[0], x, -34, { size: 22, color: SG.INK, stroke: false, weight: 800 });
      SG.text(ctx, c[1], x, 2, { size: 26, font: SG.FONT_TITLE, weight: 400, color: '#3a86ff', stroke: false });
      SG.text(ctx, c[2] + '  |  ' + c[3], x, 38, { size: 20, color: '#7a7498', stroke: false, weight: 700 });
    });
    ctx.restore();
  }
  SG.controlsCard = controlsCard;

  // ------------------------------------------------------------------ ROUND END
  S.roundEnd = {
    enter() {
      this.t = 0;
      const sess = SG.session;
      const w = S.game.world;
      this.world = w;
      const ranked = w.gulls.slice().sort((a, b) => b.score - a.score);
      this.ranked = ranked;
      const top = ranked[0].score;
      this.winners = ranked.filter((g) => g.score === top && top > 0);
      for (const g of this.winners) sess.wins[g.slot]++;
      for (const g of w.gulls) {
        sess.totals[g.slot] += g.score;
        const st = sess.stats[g.slot] || (sess.stats[g.slot] = {});
        for (const k in g.stats) st[k] = (st[k] || 0) + g.stats[k];
      }
      this.maxScore = Math.max(1, top);
      const need = Math.floor(sess.rounds / 2) + 1;
      this.matchOver = sess.round >= sess.rounds || sess.wins.some((n) => n >= need);
      SG.Audio.stinger('roundEnd');
      SG.Audio.music('results');
      SG.Audio.loop('crowd', false); SG.Audio.loop('rain', false);
      setTimeout(() => { if (this.winners[0]) SG.Audio.sfx('laugh', { pitch: this.winners[0].voice }); }, 900);
    },
    update(dt) {
      this.t += dt;
      this.world.update(dt, {});
      const m = SG.Input.menu();
      if (this.t > 1.6 && (m.confirm || m.start)) {
        SG.Audio.sfx('menuSelect');
        if (this.matchOver) SG.Game.go('final');
        else { SG.session.round++; SG.Game.go('game', { nextRound: true }); }
      }
    },
    draw(ctx) {
      this.world.draw(ctx);
      UI.fadeOverlay(ctx, 0.5);
      const sess = SG.session;
      const title = sess.rounds > 1 ? `ROUND ${sess.round} RESULTS` : 'RESULTS';
      SG.text(ctx, title, SG.W / 2, 110, { size: 90, font: SG.FONT_TITLE, weight: 400, color: '#ffd23f', strokeWidth: 16 });
      const pw = 1200, rowH = 150;
      const x0 = SG.W / 2 - pw / 2;
      this.ranked.forEach((g, i) => {
        const delay = 0.25 + i * 0.18;
        const k = M.clamp((this.t - delay) / 0.4, 0, 1);
        if (k <= 0) return;
        const y = 210 + i * (rowH + 18);
        ctx.save();
        ctx.translate((1 - M.easeOutBack(k)) * -400, 0);
        ctx.globalAlpha = k;
        const win = this.winners.includes(g);
        UI.panel(ctx, x0, y, pw, rowH, { fill: win ? '#fff3c4' : '#ffffff', stripe: g.color, stripeH: rowH, r: 28 });
        SG.roundRect(ctx, x0 + 150, y + 12, pw - 162, rowH - 24, 20); ctx.fillStyle = win ? '#fff3c4' : '#ffffff'; ctx.fill();
        SG.text(ctx, String(i + 1), x0 + 70, y + rowH / 2 + 6, { size: 80, font: SG.FONT_TITLE, weight: 400 });
        SG.Art.gull(ctx, { x: x0 + 232, y: y + rowH - 20, s: 1.55, facing: 1, pose: win ? 'run' : 'idle', t: this.t + i, color: g.color, hat: win ? 'crown' : g.hat, beakOpen: win && Math.sin(this.t * 8) > 0 });
        SG.text(ctx, (g.cpu ? 'CPU ' : 'P' + (g.slot + 1) + ' ') + g.name, x0 + 320, y + 50, { size: 36, font: SG.FONT_TITLE, weight: 400, align: 'left', color: g.dark, stroke: false });
        // bar
        const barW = 620 * M.easeOutCubic(M.clamp((this.t - delay - 0.2) / 1.0, 0, 1)) * (g.score / this.maxScore);
        SG.roundRect(ctx, x0 + 320, y + 82, 640, 40, 20); ctx.fillStyle = '#ece6d6'; ctx.fill();
        if (barW > 4) { SG.roundRect(ctx, x0 + 320, y + 82, Math.max(40, barW + 20), 40, 20); ctx.fillStyle = g.color; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = SG.INK; ctx.stroke(); }
        const shown = Math.round(g.score * M.clamp((this.t - delay - 0.2) / 1.0, 0, 1));
        SG.text(ctx, String(shown), x0 + pw - 110, y + rowH / 2 + 4, { size: 64, font: SG.FONT_TITLE, weight: 400, color: g.dark, stroke: false });
        // round wins crowns
        for (let c = 0; c < sess.wins[g.slot]; c++) {
          ctx.save(); ctx.translate(x0 + 690 + c * 34, y + 48); ctx.scale(1.05, 1.05);
          ctx.beginPath(); ctx.moveTo(-12, 6); ctx.lineTo(-14, -9); ctx.lineTo(-6, -1); ctx.lineTo(0, -12); ctx.lineTo(6, -1); ctx.lineTo(14, -9); ctx.lineTo(12, 6); ctx.closePath();
          SG.Art.fillStroke(ctx, '#ffd23f', 3);
          ctx.restore();
        }
        if (win) {
          ctx.save(); ctx.translate(x0 + pw - 40, y + 14); ctx.rotate(0.15);
          UI.panel(ctx, -110, -24, 220, 48, { fill: '#ff4d6d', r: 24, lw: 4, shadow: false });
          SG.text(ctx, 'ROUND WINNER!', 0, 2, { size: 24, font: SG.FONT_TITLE, weight: 400 });
          ctx.restore();
        }
        ctx.restore();
      });
      if (this.t > 1.6 && Math.floor(this.t * 2) % 2 === 0) SG.text(ctx, this.matchOver ? 'PRESS A / ENTER FOR THE FINAL RESULTS' : 'PRESS A / ENTER FOR THE NEXT ROUND', SG.W / 2, SG.H - 50, { size: 36, font: SG.FONT_TITLE, weight: 400, color: '#ffffff' });
    },
  };

  // ------------------------------------------------------------------ FINAL / PODIUM
  const AWARDS = [
    { key: 'sneaky', title: 'Sneaky Beak', desc: 'surprise steals', one: 'surprise steal' },
    { key: 'poopsHit', title: 'Bombardier', desc: 'poops on target', one: 'poop on target' },
    { key: 'steals', title: 'Master Thief', desc: 'scran nicked', one: 'scran nicked' },
    { key: 'hits', title: 'Bruiser', desc: 'gulls clobbered', one: 'gull clobbered' },
    { key: 'bins', title: 'Bin Raker', desc: 'bin scraps raked', one: 'bin scrap raked' },
    { key: 'golden', title: 'Golden Gob', desc: 'golden suppers grabbed', one: 'golden supper grabbed' },
    { key: 'swatted', title: 'Slapped Silly', desc: 'times swatted', one: 'time swatted' },
    { key: 'dropped', title: 'Butterwings', desc: 'food dropped', one: 'food dropped' },
    { key: 'gullsSplatted', title: 'Dive Bomber', desc: 'gulls splatted', one: 'gull splatted' },
    { key: 'squawks', title: 'Loudmouth', desc: 'squawks', one: 'squawk' },
  ];
  S.final = {
    enter() {
      this.t = 0; this.sel = 0;
      const sess = SG.session;
      this.ranked = sess.players.slice().sort((a, b) => (sess.wins[b.slot] - sess.wins[a.slot]) || (sess.totals[b.slot] - sess.totals[a.slot]));
      this.awards = [];
      const used = new Set();
      for (const a of AWARDS) {
        let best = null, bv = 0, tie = false;
        for (const p of sess.players) {
          const v = (sess.stats[p.slot] || {})[a.key] || 0;
          if (v > bv) { bv = v; best = p; tie = false; } else if (v === bv && v > 0) tie = true;
        }
        if (best && !tie && !(used.has(best.slot) && this.awards.length >= 2)) { this.awards.push({ a, p: best, v: bv }); used.add(best.slot); }
        if (this.awards.length >= 4) break;
      }
      UI.confetti.parts = [];
      UI.confetti.burst(220);
      SG.Audio.music('results');
      SG.Audio.stinger('victory');
      SG.Audio.sfx('cheer');
      const w = this.ranked[0];
      setTimeout(() => SG.Audio.sfx('laugh', { pitch: [1, 0.86, 1.14, 1.26][w.slot] }), 1200);
    },
    items: [{ label: 'REMATCH' }, { label: 'NEW STAGE' }, { label: 'MAIN MENU' }],
    update(dt) {
      this.t += dt;
      UI.confetti.update(dt);
      if (Math.random() < dt * 2) UI.confetti.burst(8);
      const m = SG.Input.menu();
      if (m.left) { this.sel = (this.sel + 2) % 3; SG.Audio.sfx('menuMove'); }
      if (m.right) { this.sel = (this.sel + 1) % 3; SG.Audio.sfx('menuMove'); }
      if (this.t > 1.2 && (m.confirm || m.start)) {
        SG.Audio.sfx('menuSelect');
        if (this.sel === 0) SG.Game.go('game', { newMatch: true });
        else if (this.sel === 1) SG.Game.go('stage');
        else SG.Game.go('menu');
      }
    },
    draw(ctx) {
      // sunny sky backdrop
      const g = ctx.createLinearGradient(0, 0, 0, SG.H);
      g.addColorStop(0, '#5fb8f0'); g.addColorStop(0.62, '#d8f1ff'); g.addColorStop(0.62, '#2a9fb8'); g.addColorStop(1, '#1d6f8f');
      ctx.fillStyle = g; ctx.fillRect(0, 0, SG.W, SG.H);
      // sun rays
      ctx.save(); ctx.translate(560, 560); ctx.rotate(this.t * 0.1);
      for (let i = 0; i < 16; i++) { ctx.rotate(Math.PI / 8); ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.12)' : 'rgba(255,240,180,0.14)'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-90, -1200); ctx.lineTo(90, -1200); ctx.closePath(); ctx.fill(); }
      ctx.restore();
      const sess = SG.session;
      const winner = this.ranked[0];
      SG.text(ctx, `${(winner.cpu ? 'CPU ' : 'P' + (winner.slot + 1) + ' ')}${winner.name.toUpperCase()} WINS!`, 560, 100, { size: 76, font: SG.FONT_TITLE, weight: 400, color: '#ffd23f', strokeWidth: 16 });
      SG.text(ctx, 'Champion Gannet of the Promenade', 560, 168, { size: 30, color: '#fff', weight: 700 });
      // podium
      const spots = [{ x: 560, h: 260 }, { x: 330, h: 180 }, { x: 790, h: 130 }, { x: 1000, h: 80 }];
      const baseY = 820;
      this.ranked.forEach((p, i) => {
        const sp = spots[i];
        const k = M.clamp((this.t - 0.3 - (3 - i) * 0.25) / 0.5, 0, 1);
        const h = sp.h * M.easeOutBack(k);
        if (k <= 0) return;
        UI.panel(ctx, sp.x - 105, baseY - h, 210, h + 200, { fill: i === 0 ? '#ffd23f' : i === 1 ? '#dfe6ee' : i === 2 ? '#f0b27a' : '#c9d6df', r: 16 });
        SG.text(ctx, String(i + 1), sp.x, baseY - h + 60, { size: 80, font: SG.FONT_TITLE, weight: 400, color: '#fff' });
        const col = SG.PLAYER_COLORS[p.slot];
        const jump = i === 0 ? Math.abs(Math.sin(this.t * 4)) * 30 : 0;
        SG.Art.shadow(ctx, sp.x, baseY - h, 60, 0.25);
        SG.Art.gull(ctx, { x: sp.x - 8, y: baseY - h - jump, s: i === 0 ? 2.6 : 2.0, facing: 1, pose: i === 0 ? (jump > 5 ? 'fly' : 'idle') : 'idle', flap: this.t * 18, t: this.t + i, color: col, hat: i === 0 ? 'crown' : p.hat, beakOpen: i === 0 && Math.sin(this.t * 9) > 0, stun: i === 3 && this.ranked.length === 4 });
        SG.text(ctx, `${p.cpu ? 'CPU' : 'P' + (p.slot + 1)} ${p.name}`, sp.x, baseY - h + 120, { size: 24, color: SG.INK, stroke: false, weight: 800 });
        SG.text(ctx, `${sess.totals[p.slot]} pts • ${sess.wins[p.slot]} ♛`, sp.x, baseY - h + 156, { size: 22, color: SG.INK, stroke: false, weight: 700 });
      });
      // awards
      const ax = 1180, aw = 680;
      SG.text(ctx, 'AWARDS', ax + aw / 2, 110, { size: 64, font: SG.FONT_TITLE, weight: 400, color: '#fff', strokeWidth: 12 });
      this.awards.forEach((aw2, i) => {
        const k = M.clamp((this.t - 1.2 - i * 0.3) / 0.4, 0, 1);
        if (k <= 0) return;
        const y = 170 + i * 140;
        ctx.save(); ctx.globalAlpha = k; ctx.translate((1 - M.easeOutBack(k)) * 300, 0);
        UI.panel(ctx, ax, y, aw, 120, { fill: '#ffffff', stripe: SG.PLAYER_COLORS[aw2.p.slot], stripeH: 14, r: 24 });
        SG.Art.gull(ctx, { x: ax + 70, y: y + 108, s: 1.3, facing: 1, pose: 'idle', t: this.t + i, color: SG.PLAYER_COLORS[aw2.p.slot], hat: aw2.p.hat });
        SG.text(ctx, aw2.a.title.toUpperCase(), ax + 150, y + 50, { size: 36, font: SG.FONT_TITLE, weight: 400, align: 'left', color: SG.PLAYER_DARK[aw2.p.slot], stroke: false });
        SG.text(ctx, `${aw2.p.cpu ? 'CPU' : 'P' + (aw2.p.slot + 1)} ${aw2.p.name} – ${aw2.v} ${aw2.a.desc}`, ax + 150, y + 90, { size: 24, align: 'left', color: SG.INK, stroke: false, weight: 700 });
        ctx.restore();
      });
      UI.confetti.draw(ctx);
      // buttons
      this.items.forEach((it, i) => {
        const on = i === this.sel;
        const x = SG.W / 2 + (i - 1) * 420, y = SG.H - 80;
        ctx.save(); ctx.translate(x, y); const k = on ? 1.08 + Math.sin(this.t * 6) * 0.02 : 1; ctx.scale(k, k);
        UI.panel(ctx, -180, -40, 360, 80, { fill: on ? '#ffd23f' : '#fff8e7', r: 40 });
        SG.text(ctx, it.label, 0, 4, { size: 38, font: SG.FONT_TITLE, weight: 400, color: on ? SG.INK : '#5a5478', stroke: false });
        ctx.restore();
      });
    },
  };

  // ------------------------------------------------------------------ OPTIONS
  const TIMES = [60, 90, 120, 150, 180];
  S.options = {
    enter() { this.t = 0; this.sel = 0; },
    rows() {
      const st = SG.settings;
      const pct = (v) => Math.round(v * 10) + ' / 10';
      return [
        { key: 'master', label: 'Master volume', value: pct(st.master) },
        { key: 'music', label: 'Music volume', value: pct(st.music) },
        { key: 'sfx', label: 'Sound effects', value: pct(st.sfx) },
        { key: 'roundTime', label: 'Round length', value: Math.floor(st.roundTime / 60) + ':' + String(st.roundTime % 60).padStart(2, '0') },
        { key: 'rounds', label: 'Rounds per match', value: st.rounds },
        { key: 'cpuLevel', label: 'CPU gull skill', value: SG.AI_LEVELS[st.cpuLevel].name },
        { key: 'cones', label: 'Show sight cones', value: st.cones === false ? 'OFF' : 'ON' },
        { key: 'shake', label: 'Screen shake', value: st.shake ? 'ON' : 'OFF' },
        { key: 'fullscreen', label: 'Fullscreen', value: document.fullscreenElement ? 'ON' : 'OFF' },
        { key: 'back', label: 'Back' },
      ];
    },
    adjust(key, dir) {
      const st = SG.settings;
      switch (key) {
        case 'master': case 'music': case 'sfx': st[key] = M.clamp(Math.round(st[key] * 10 + dir) / 10, 0, 1); break;
        case 'roundTime': { let i = TIMES.indexOf(st.roundTime); if (i < 0) i = 2; st.roundTime = TIMES[M.clamp(i + dir, 0, TIMES.length - 1)]; break; }
        case 'rounds': st.rounds = [1, 3, 5][M.clamp([1, 3, 5].indexOf(st.rounds) + dir, 0, 2)]; break;
        case 'cpuLevel': st.cpuLevel = M.clamp(st.cpuLevel + dir, 0, 2); break;
        case 'cones': st.cones = st.cones === false; break;
        case 'shake': st.shake = !st.shake; break;
        case 'fullscreen':
          try { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen(); } catch (e) { /* not allowed */ }
          break;
        default: return;
      }
      SG.saveSettings();
      SG.Audio.setVolumes(st.master, st.music, st.sfx);
      SG.Audio.sfx('menuMove');
    },
    update(dt) {
      this.t += dt;
      attract.update(dt);
      const m = SG.Input.menu();
      const rows = this.rows();
      this.sel = menuNav(this.sel, rows.length, m);
      const key = rows[this.sel].key;
      if (m.left) this.adjust(key, -1);
      if (m.right) this.adjust(key, 1);
      if (m.confirm) {
        if (key === 'back') { SG.Audio.sfx('menuBack'); SG.Game.go('menu'); }
        else this.adjust(key, 1);
      }
      if (m.cancel) { SG.Audio.sfx('menuBack'); SG.Game.go('menu'); }
    },
    draw(ctx) {
      attract.draw(ctx, 0.6);
      SG.text(ctx, 'OPTIONS', SG.W / 2, 100, { size: 90, font: SG.FONT_TITLE, weight: 400, color: '#ffd23f', strokeWidth: 16 });
      UI.rows(ctx, this.rows(), this.sel, SG.W / 2, 180, this.t);
      footer(ctx, '▲▼ choose • ◀▶ change • B / Esc: back');
    },
  };

  // ------------------------------------------------------------------ HOW TO PLAY
  S.howto = {
    enter() { this.t = 0; this.page = 0; },
    pages: 5,
    update(dt) {
      this.t += dt;
      attract.update(dt);
      const m = SG.Input.menu();
      if (m.left && this.page > 0) { this.page--; SG.Audio.sfx('menuMove'); }
      if (m.right || m.confirm) {
        if (this.page < this.pages - 1) { this.page++; SG.Audio.sfx('menuMove'); }
        else if (m.confirm) { SG.Audio.sfx('menuBack'); SG.Game.go('menu'); }
      }
      if (m.cancel) { SG.Audio.sfx('menuBack'); SG.Game.go('menu'); }
    },
    draw(ctx) {
      attract.draw(ctx, 0.6);
      const t = this.t;
      UI.panel(ctx, 160, 60, SG.W - 320, 900, { fill: '#fff8e7', stripe: '#2bb3a6', stripeH: 24, r: 40 });
      const titles = ['THE AIM O’ THE GAME', 'CONTROLS', 'SNEAKY TACTICS', 'GULL v GULL', 'SEASIDE CHAOS'];
      SG.text(ctx, titles[this.page], SG.W / 2, 150, { size: 72, font: SG.FONT_TITLE, weight: 400, color: '#ffd23f', strokeWidth: 14 });
      const body = (lines, y0, x) => lines.forEach((l, i) => SG.text(ctx, l, x || 300, y0 + i * 56, { size: 34, align: 'left', color: SG.INK, stroke: false, weight: 600 }));
      switch (this.page) {
        case 0: {
          body([
            'You are a seagull. The promenade is full of scran.',
            'Nick food from folk, counters and bins – then EAT it to score.',
            'Hold PECK while carrying food to gobble it bite by bite.',
            'Most points when the whistle blows wins the round!',
            'Win the most rounds to be crowned Champion Gannet.',
          ], 270);
          // little scene: gull snatching chips from a tourist's back
          SG.Art.person(ctx, { x: 1300, y: 860, s: 1.4, facing: 1, pose: 'walk', t, kind: 'tourist', hat: 'bucket', skin: '#efc09e', hair: '#6b4226', top: '#4ecdc4', bottom: '#3d4a7a', food: 'chips', mood: 'calm' });
          SG.Art.gull(ctx, { x: 1180 + Math.sin(t * 2) * 20, y: 800 - Math.abs(Math.sin(t * 2)) * 40, s: 1.8, facing: 1, pose: 'swoop', t, color: '#ff4d6d', hat: 'tam' });
          SG.Art.food(ctx, 'supper', 700, 820, 3, { t });
          SG.text(ctx, 'Fish Supper = 150 pts', 700, 900, { size: 28, color: SG.INK, stroke: false, weight: 800 });
          SG.Art.food(ctx, 'golden', 1000, 820, 3, { t });
          SG.text(ctx, 'Golden Supper = 300!', 1000, 900, { size: 28, color: '#c48a00', stroke: false, weight: 800 });
          break;
        }
        case 1: {
          const rows = [['', 'CONTROLLER', 'KEYBOARD 1', 'KEYBOARD 2'], ['Move', 'Left stick / D-pad', 'W A S D', 'Arrow keys'], ['Flap / fly (hold to glide)', 'A', 'Space', '/'], ['Peck • Swoop (in air) • Eat (hold)', 'X', 'F', '.'], ['Poop', 'B', 'G', ','], ['Wings-up dash (hold to run)', 'Y / RB / RT', 'Left Shift', 'Right Shift'], ['Squawk', 'LB / LT', 'Q', ';'], ['Pause', 'Start', 'Esc', 'Enter']];
          rows.forEach((r, i) => {
            const y = 250 + i * 76;
            if (i > 0) { ctx.fillStyle = i % 2 ? 'rgba(43,179,166,0.10)' : 'rgba(255,255,255,0)'; ctx.fillRect(240, y - 34, SG.W - 480, 68); }
            SG.text(ctx, r[0], 270, y, { size: 30, align: 'left', color: SG.INK, stroke: false, weight: 800 });
            for (let c = 1; c < 4; c++) SG.text(ctx, r[c], 940 + (c - 1) * 330, y, { size: i === 0 ? 30 : 30, color: i === 0 ? '#2bb3a6' : '#3a86ff', stroke: false, weight: 800, font: i === 0 ? SG.FONT_TITLE : SG.FONT });
          });
          SG.text(ctx, 'Keyboard 1 also works with K = flap, J = peck, L = poop, I = dash, U = squawk', SG.W / 2, 870, { size: 24, color: '#7a7498', stroke: false, weight: 700 });
          break;
        }
        case 2: {
          body([
            'Folk can see in front of them (the faint cone on the ground).',
            '?  = getting suspicious      !  = guarding their food – expect a slap!',
            'Sneak up from BEHIND, or SWOOP down from above, for a Sneaky Beak bonus.',
            'POOP on heads to distract folk – they might even drop their scran.',
            'SQUAWK to scare weans into dropping ice creams (adults will look round!).',
            'Shopkeepers turn their backs to cook – nick orders right off the counter.',
            'DASH into a bin to knock it over, or PECK it to rake for scraps.',
          ], 260, 240);
          SG.Art.alertIcon(ctx, 268, 316, '?', 1); SG.Art.alertIcon(ctx, 588, 316, '!', 1);
          break;
        }
        case 3: {
          body([
            'PECK, DASH or SWOOP into a rival to knock their food loose.',
            'Swoop through a rival and you’ll catch it mid-air: INTERCEPT!',
            'Poop on rivals to splat them – they slow down and drop their scran.',
            'Carrying food weighs you down. Find a safe perch to eat:',
            'rooftops, lamp posts, the railings, benches and tables.',
            'The leader wears a crown – folk spot them more easily!',
            'The last 20 seconds are the FINAL FRENZY: double points!',
          ], 260, 240);
          break;
        }
        case 4: {
          const ev = ['ferry', 'rain', 'boat', 'golden', 'dog', 'piper', 'rush'];
          ev.forEach((e, i) => {
            const info = SG.EVENT_INFO[e];
            const y = 250 + i * 88;
            SG.text(ctx, info.title, 260, y, { size: 38, font: SG.FONT_TITLE, weight: 400, align: 'left', color: '#ff4d6d', stroke: false });
            SG.text(ctx, info.sub, 820, y + 2, { size: 30, align: 'left', color: SG.INK, stroke: false, weight: 700 });
          });
          break;
        }
      }
      for (let i = 0; i < this.pages; i++) { ctx.beginPath(); ctx.arc(SG.W / 2 - (this.pages - 1) * 18 + i * 36, 920, i === this.page ? 11 : 7, 0, Math.PI * 2); ctx.fillStyle = i === this.page ? '#ff4d6d' : '#c9c2b0'; ctx.fill(); }
      footer(ctx, '◀ ▶ turn page • B / Esc: back');
    },
  };

  // ------------------------------------------------------------------ CREDITS
  S.credits = {
    enter() { this.t = 0; },
    update(dt) {
      this.t += dt;
      attract.update(dt);
      const m = SG.Input.menu();
      if (m.cancel || m.confirm || m.start) { SG.Audio.sfx('menuBack'); SG.Game.go('menu'); }
    },
    draw(ctx) {
      attract.draw(ctx, 0.6);
      UI.panel(ctx, 360, 120, SG.W - 720, 820, { fill: '#fff8e7', stripe: '#ff4d6d', stripeH: 24, r: 40 });
      UI.logo(ctx, SG.W / 2, 270, this.t, 0.5);
      const lines = [
        ['A seaside seagull brawler for 1–4 gannets', 700],
        ['Set on the proms of Oban & Largs, Scotland', 700],
        ['Every sprite, tune and squawk is generated in code – no asset files', 600],
        ['Design nods: Untitled Goose Game (sneaky NPC sight-lines),', 600],
        ['Towerfall & Smash Bros (crowns, knockback, stage events),', 600],
        ['Overcooked (couch chaos), Castle Crashers (2.5D depth & shadows)', 600],
        ['Built with Claude Code', 800],
        ['Please don’t feed the real gulls.', 800],
      ];
      lines.forEach(([l, wgt], i) => SG.text(ctx, l, SG.W / 2, 450 + i * 56, { size: 32, color: SG.INK, stroke: false, weight: wgt }));
      footer(ctx, 'Press any button to go back');
    },
  };
})(window.SG);
