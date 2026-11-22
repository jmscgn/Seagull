// ---------------------------------------------------------------------------
// Bootstrap: canvas scaling, backdrop cache, scene manager and main loop.
// ---------------------------------------------------------------------------
(function (SG) {
  'use strict';
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const view = { scale: 1, ox: 0, oy: 0, quality: 1 };
  SG.view = view;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * view.quality;
    const w = Math.max(320, window.innerWidth), h = Math.max(180, window.innerHeight);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    view.scale = Math.min(canvas.width / SG.W, canvas.height / SG.H);
    view.ox = (canvas.width - SG.W * view.scale) / 2;
    view.oy = (canvas.height - SG.H * view.scale) / 2;
  }
  window.addEventListener('resize', resize);
  resize();

  // Pre-rendered backdrops, rebuilt when the render scale changes a lot.
  const bdCache = {};
  SG.getBackdrop = function (id) {
    if (!SG.Backdrop || !SG.STAGES[id]) return null;
    const want = Math.max(0.5, Math.min(2, Math.round(view.scale * 4) / 4));
    let e = bdCache[id];
    if (!e || e.scale !== want) {
      if (e && e.failed) return null;
      try {
        e = bdCache[id] = { bd: SG.Backdrop.build(SG.STAGES[id], want), scale: want };
      } catch (err) {
        console.error('Backdrop build failed', err);
        bdCache[id] = { failed: true, scale: want };
        return null;
      }
    }
    return e.bd;
  };

  // ------------------------------------------------------------------ scenes
  const Game = {
    scene: null, name: '', next: null, fade: 1, fadeDir: -1,
    go(name, data) {
      if (this.next) return;
      this.next = { name, data };
      this.fadeDir = 1;
    },
    swap() {
      if (this.scene && this.scene.exit) this.scene.exit();
      this.name = this.next.name;
      this.scene = SG.Scenes[this.name];
      SG.Input.flush();
      if (this.scene.enter) this.scene.enter(this.next.data);
      this.next = null;
      this.fadeDir = -1;
    },
  };
  SG.Game = Game;

  let last = performance.now();
  let errShown = null;
  let started = false;
  // Adaptive resolution: if frames are consistently slow, render fewer pixels.
  const perf = { acc: 0, n: 0, slowT: 0 };
  function adaptQuality(rawDt) {
    if (document.hidden || rawDt > 0.25) return;
    perf.acc += rawDt; perf.n++;
    if (perf.n >= 30) {
      const avg = perf.acc / perf.n;
      perf.acc = 0; perf.n = 0;
      if (avg > 0.026) perf.slowT++; else perf.slowT = Math.max(0, perf.slowT - 1);
      if (perf.slowT >= 4 && view.quality > 0.55) {
        view.quality = Math.max(0.55, view.quality - 0.15);
        perf.slowT = 0;
        resize();
        console.info('SCRAN: lowering render resolution to', view.quality.toFixed(2));
      }
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000;
    last = now;
    adaptQuality(dt);
    if (dt > 0.1) dt = 0.1;
    if (dt <= 0) dt = 0.001;

    SG.Input.update();

    try {
      if (Game.fadeDir === 1) { Game.fade += dt / 0.22; if (Game.fade >= 1) { Game.fade = 1; Game.swap(); } }
      else if (Game.fadeDir === -1) { Game.fade -= dt / 0.28; if (Game.fade <= 0) { Game.fade = 0; Game.fadeDir = 0; } }
      if (Game.next) SG.Input.flush();
      if (Game.scene) Game.scene.update(Math.min(dt, 1 / 20));
    } catch (err) {
      console.error(err);
      errShown = String(err && err.stack || err).slice(0, 300);
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#120e26';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(view.scale, 0, 0, view.scale, view.ox, view.oy);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, SG.W, SG.H); ctx.clip();
    try {
      if (Game.scene) Game.scene.draw(ctx);
    } catch (err) {
      console.error(err);
      errShown = String(err && err.stack || err).slice(0, 300);
    }
    if (Game.fade > 0) {
      ctx.globalAlpha = SG.M.easeInOut(Math.min(1, Game.fade));
      ctx.fillStyle = '#1d1640';
      ctx.fillRect(0, 0, SG.W, SG.H);
      ctx.globalAlpha = 1;
    }
    if (errShown && SG.DEBUG) {
      ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(0, SG.H - 90, SG.W, 90);
      ctx.fillStyle = '#ff8a8a'; ctx.font = '16px monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(errShown, 10, SG.H - 80);
    }
    ctx.restore();
  }

  function drawLoading() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#1d1640'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(view.scale, 0, 0, view.scale, view.ox, view.oy);
    ctx.fillStyle = '#ffd23f'; ctx.font = `64px ${SG.FONT_TITLE}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Heating the fryer...', SG.W / 2, SG.H / 2);
  }

  function start() {
    if (started) return;
    started = true;
    SG.DEBUG = /debug/.test(location.search);
    SG.Audio.init();
    SG.Audio.setVolumes(SG.settings.master, SG.settings.music, SG.settings.sfx);
    // warm the backdrop cache so the first scene doesn't hitch
    for (const id of SG.STAGE_ORDER) SG.getBackdrop(id);
    Game.next = { name: (location.hash || '').replace('#', '') in SG.Scenes ? location.hash.replace('#', '') : 'title', data: null };
    Game.swap();
    Game.fade = 1; Game.fadeDir = -1;
    last = performance.now();
    requestAnimationFrame(frame);
  }

  drawLoading();
  const fontsReady = document.fonts && document.fonts.load
    ? Promise.all([document.fonts.load(`40px ${SG.FONT_TITLE}`), document.fonts.load(`700 40px ${SG.FONT}`)]).catch(() => null)
    : Promise.resolve();
  Promise.race([fontsReady, new Promise((r) => setTimeout(r, 2500))]).then(start);

  // Pause the game if the tab is hidden.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && Game.name === 'game' && SG.Scenes.game && !SG.Scenes.game.paused) {
      SG.Scenes.game.paused = true; SG.Scenes.game.pauseSel = 0;
    }
  });
})(window.SG);
