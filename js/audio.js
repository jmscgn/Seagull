// ---------------------------------------------------------------------------
// SCRAN! — audio. Every sound in the game is synthesised at runtime with the
// Web Audio API (no asset files).
//
//   SG.Audio.init()                        create AudioContext + mix chain (idempotent)
//   SG.Audio.unlock()                      call on every user gesture; resumes the context
//   SG.Audio.setVolumes(master, music, sfx)   0..1 each (squared taper), smoothed
//   SG.Audio.sfx(name, {vol, pitch, pan, delay})
//   SG.Audio.loop(name, on, vol)           ambience: 'waves' | 'rain' | 'crowd' | 'wind'
//   SG.Audio.music(track)                  'title' | 'lobby' | 'game' | 'results' | null
//   SG.Audio.setTempo(mult)                e.g. 1.2 for the "hurry up" finale
//   SG.Audio.stinger(name)                 'roundStart' | 'roundEnd' | 'victory' | 'event' | 'golden'
//
// Mix graph (one per AudioContext, also rebuilt inside OfflineAudioContexts for tests):
//
//   sequencer tracks -> duck -> music ─────────────┐
//   sfx voices ───────────────────────────── sfx ──┼─> master -> compressor -> soft clip -> out
//   ambience loops -> amb ─┘  stingers -> sting ─┘ (both feed sfx)
//
// Every public method is wrapped so it never throws, and is a silent no-op when
// Web Audio is unavailable. Synth functions take (context, destination, time)
// so they render identically into an OfflineAudioContext (see SG.Audio._debug).
// ---------------------------------------------------------------------------
(function (SG) {
  'use strict';

  const AC = window.AudioContext || window.webkitAudioContext;
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;

  const EPS = 0.0001;             // "silence" target for exponential ramps
  const LOOKAHEAD = 0.12;         // sequencer schedules this far ahead (s)
  const TICK_MS = 25;             // sequencer timer interval
  const XFADE = 0.6;              // music crossfade (s)
  const MAX_VOICES = 64;          // hard cap on concurrently sounding sfx
  const THROTTLE_N = 4, THROTTLE_MS = 60;

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rnd = (a, b) => a + Math.random() * (b - a);
  const num = (x, d) => (typeof x === 'number' && isFinite(x) ? x : d);
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const taper = (v) => { v = clamp(num(v, 0), 0, 1); return v * v; };
  const has = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);

  // ---- automation helpers --------------------------------------------------
  // env(param, t, [[dt, value, mode], ...], expDefault)
  // First point is set; later points ramp (linear, or exponential with 'e').
  // Times are forced to be strictly increasing so callers can't break ordering.
  function env(param, t, pts, expDefault) {
    let last = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], tt = Math.max(t + p[0], last + 1e-4);
      const mode = p[2] || (expDefault ? 'e' : 'l');
      if (i === 0 || mode === 's') param.setValueAtTime(p[1], tt);
      else if (mode === 'e') param.exponentialRampToValueAtTime(Math.max(EPS, p[1]), tt);
      else param.linearRampToValueAtTime(p[1], tt);
      last = tt;
    }
  }
  // Percussive envelope: 0 -> peak in `a`, exponential decay to silence over `d`.
  function perc(param, t, peak, a, d) {
    param.setValueAtTime(0, t);
    param.linearRampToValueAtTime(peak, t + a);
    param.exponentialRampToValueAtTime(EPS, t + a + d);
  }
  // Exponential glide (frequencies).
  function sweep(param, t, f0, f1, dur) {
    param.setValueAtTime(f0, t);
    param.exponentialRampToValueAtTime(f1, t + dur);
  }
  // Gate a gain param with a train of short blips (crackles, footsteps, rattles).
  function blips(param, times, amps, a, d) {
    let prev = -1;
    for (let i = 0; i < times.length; i++) {
      const t0 = Math.max(times[i], prev + 0.001);
      param.setValueAtTime(EPS, t0);
      param.linearRampToValueAtTime(amps[i], t0 + a);
      param.exponentialRampToValueAtTime(EPS, t0 + a + d);
      prev = t0 + a + d;
    }
  }
  // Freeze a param at its current value so a new ramp can start from it.
  function hold(c, param) {
    const now = c.currentTime;
    if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(now);
    else { const v = param.value; param.cancelScheduledValues(now); param.setValueAtTime(v, now); }
    return now;
  }
  function glide(c, param, v, tc) { const now = hold(c, param); param.setTargetAtTime(v, now, tc); }
  function fadeTo(c, param, v, secs) { const now = hold(c, param); param.linearRampToValueAtTime(v, now + secs); }

  // ---- cached buffers & curves ----------------------------------------------
  // Noise buffers are generated once per context and looped from random offsets.
  // The tail is equal-power crossfaded into the head so loops are seamless.
  function buffer(c, kind) {
    const cache = c._sgBufs || (c._sgBufs = {});
    return cache[kind] || (cache[kind] = kind === 'drops' ? makeDrops(c) : makeNoise(c, kind));
  }
  function normalise(c, data, len) {
    let mean = 0, pk = 0;
    for (let i = 0; i < len; i++) mean += data[i];
    mean /= len;
    for (let i = 0; i < len; i++) pk = Math.max(pk, Math.abs(data[i] - mean));
    const buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0), k = 0.9 / (pk || 1);
    for (let i = 0; i < len; i++) d[i] = (data[i] - mean) * k;
    return buf;
  }
  function makeNoise(c, kind) {
    const sr = c.sampleRate, secs = kind === 'white' ? 2 : kind === 'pink' ? 4 : 6;
    const len = Math.floor(secs * sr), xf = Math.floor(0.04 * sr), tmp = new Float32Array(len + xf);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, br = 0;
    for (let i = 0; i < len + xf; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'pink') { // Paul Kellet's refined pink filter
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        tmp[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926;
      } else if (kind === 'brown') { br = (br + 0.02 * w) / 1.02; tmp[i] = br; }
      else tmp[i] = w;
    }
    for (let i = 0; i < xf; i++) {
      const a = (i / xf) * Math.PI / 2;
      tmp[i] = tmp[i] * Math.sin(a) + tmp[len + i] * Math.cos(a);
    }
    return normalise(c, tmp, len);
  }
  // 5 s of sparse droplet "plinks" for the rain loop.
  function makeDrops(c) {
    const sr = c.sampleRate, len = Math.floor(5 * sr), d = new Float32Array(len);
    for (let k = 0; k < 70; k++) {
      const f = rnd(1800, 5200), tau = rnd(0.003, 0.011), a = Math.pow(rnd(0.3, 1), 2);
      const n = Math.floor(tau * 6 * sr), at = Math.floor(Math.random() * (len - n - 1));
      for (let i = 0; i < n; i++) {
        const tt = i / sr;
        d[at + i] += a * Math.sin(2 * Math.PI * f * tt) * Math.exp(-tt / tau) * Math.min(1, i / 12);
      }
    }
    return normalise(c, d, len);
  }
  const curves = {};
  function driveCurve(k) { // soft saturation; bigger k = grittier
    const key = 'd' + k;
    if (curves[key]) return curves[key];
    const n = 1024, cv = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i * 2) / (n - 1) - 1; cv[i] = ((1 + k) * x) / (1 + k * Math.abs(x)); }
    return (curves[key] = cv);
  }
  function washCurve() { // turns a sine LFO into an occasional positive bump
    if (curves.wash) return curves.wash;
    const n = 512, cv = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i * 2) / (n - 1) - 1; cv[i] = x > 0.45 ? Math.pow((x - 0.45) / 0.55, 2) : 0; }
    return (curves.wash = cv);
  }
  // Safety soft-clipper after the compressor. It is fed at half level, so the curve
  // spans inputs of +-2: identity below 0.75, then a tanh knee that never reaches 1.
  function clipCurve() {
    if (curves.clip) return curves.clip;
    const n = 4097, cv = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const u = ((i * 2) / (n - 1) - 1) * 2, a = Math.abs(u);
      cv[i] = a < 0.75 ? u : Math.sign(u) * (0.75 + 0.249 * Math.tanh((a - 0.75) / 0.249));
    }
    return (curves.clip = cv);
  }
  function mkPan(c, p) {
    if (c.createStereoPanner) { const n = c.createStereoPanner(); n.pan.value = p; return n; }
    return c.createGain(); // no panning available: pass-through
  }

  // ---- Voice: owns the nodes of one sound and disconnects them when done ----
  function Voice(c, out, t) {
    this.c = c; this.out = out; this.t = t;
    this.nodes = []; this.srcs = []; this.end = -1; this.last = null;
  }
  const VP = Voice.prototype;
  VP.keep = function (n) { this.nodes.push(n); return n; };
  VP._src = function (s, t1) {
    this.keep(s); this.srcs.push(s);
    if (t1 != null) { s.stop(t1); if (t1 > this.end) { this.end = t1; this.last = s; } }
    return s;
  };
  // t1 = null leaves the source running until stopAll() (ambience, drones).
  VP.osc = function (type, hz, t0, t1) {
    const o = this.c.createOscillator();
    o.type = type; o.frequency.value = hz; o.start(t0);
    return this._src(o, t1);
  };
  VP.noise = function (kind, t0, t1, rate) {
    const s = this.c.createBufferSource();
    s.buffer = buffer(this.c, kind); s.loop = true;
    if (rate) s.playbackRate.value = rate;
    s.start(t0, Math.random() * s.buffer.duration);
    return this._src(s, t1);
  };
  VP.gain = function (v) { const g = this.c.createGain(); g.gain.value = v; return this.keep(g); };
  VP.filter = function (type, hz, q, db) {
    const f = this.c.createBiquadFilter();
    f.type = type; f.frequency.value = hz;
    if (q != null) f.Q.value = q;
    if (db != null) f.gain.value = db;
    return this.keep(f);
  };
  VP.shaper = function (k) { const w = this.c.createWaveShaper(); w.curve = driveCurve(k); return this.keep(w); };
  VP.pan = function (p) { return this.keep(mkPan(this.c, p)); };
  VP.to = function () { // connect a chain: v.to(a, b, c, param)
    for (let i = 0; i < arguments.length - 1; i++) arguments[i].connect(arguments[i + 1]);
    return arguments[arguments.length - 1];
  };
  VP.finish = function (onDone) {
    const nodes = this.nodes, last = this.last;
    const clean = () => {
      for (let i = 0; i < nodes.length; i++) { try { nodes[i].disconnect(); } catch (e) { /* already gone */ } }
      nodes.length = 0;
      if (onDone) onDone();
    };
    if (last) last.onended = clean; else clean();
  };
  VP.stopAll = function (t, onDone) {
    const when = t != null ? t : this.c.currentTime;
    this.last = null;
    for (const s of this.srcs) { try { s.stop(when); } catch (e) { /* not started */ } this.last = this.last || s; }
    this.finish(onDone);
  };

  // =========================================================================
  // SOUND EFFECTS. Each builder is fn(voice, pitch): voice.t = start time,
  // voice.out = destination (per-call volume/pan). Builders aim for raw peaks of
  // ~0.4-1; the LEVEL table further down trims the final mix.
  // =========================================================================
  const SFX = {};

  // --- gull voice core: buzzy saw+pulse, rough AM, grit, moving formant -------
  // syls: [{t, d, a, e?, f: [[dt, hz]..], fm: [[dt, hz]..]}]
  function gullVoice(v, p, syls, grit) {
    const t = v.t, L = syls[syls.length - 1], end = t + L.t + L.d + 0.03;
    const o1 = v.osc('sawtooth', 1000, t, end), o2 = v.osc('square', 1000, t, end), o2g = v.gain(0.4);
    o2.detune.value = rnd(6, 18);
    const am = v.gain(0.72), lfo = v.osc('sine', rnd(45, 70), t, end), lfoAmt = v.gain(0.28);
    v.to(lfo, lfoAmt, am.gain);                       // throaty roughness
    v.to(o1, am); v.to(o2, o2g, am);
    const sh = v.shaper(grit), fm = v.filter('bandpass', 2400, 2.4);
    const body = v.filter('lowpass', 2600, 0.7), bodyG = v.gain(0.22);
    const amp = v.gain(0), lp = v.filter('lowpass', 6500, 0.7);
    v.to(am, sh, fm, amp); v.to(sh, body, bodyG, amp); v.to(amp, lp, v.out);
    const n = v.noise('white', t, end), nf = v.filter('bandpass', 3600, 1.3), ng = v.gain(0.12);
    v.to(n, nf, ng, amp);                             // breathiness
    const fq = Math.sqrt(p);
    let prevEnd = -1;
    syls.forEach((s, i) => {
      const st = t + s.t, g = amp.gain;
      env(o1.frequency, st, s.f, true); env(o2.frequency, st, s.f, true);
      env(fm.frequency, st, s.fm.map((q) => [q[0], q[1] * fq]), true);
      if (i === 0) g.setValueAtTime(0, st); else if (st > prevEnd + 0.001) g.setValueAtTime(EPS, st);
      g.linearRampToValueAtTime(s.a, st + 0.012);
      g.linearRampToValueAtTime(s.a * 0.78, st + s.d * 0.65);
      if (s.e) g.linearRampToValueAtTime(s.e, st + s.d); else g.exponentialRampToValueAtTime(EPS, st + s.d);
      prevEnd = st + s.d;
    });
  }

  // Herring-gull "kee-YOW".
  SFX.squawk = function (v, p) {
    const r = p * rnd(0.93, 1.07), L = rnd(0.9, 1.1);
    gullVoice(v, p, [
      { t: 0, d: 0.07 * L, a: 0.55, e: 0.24, f: [[0, 1450 * r], [0.04 * L, 1780 * r], [0.07 * L, 1480 * r]], fm: [[0, 3300], [0.07 * L, 3000]] },
      { t: 0.07 * L, d: 0.28 * L, a: 1, f: [[0, 1320 * r], [0.045 * L, 2000 * r], [0.13 * L, 1760 * r], [0.28 * L, 980 * r]], fm: [[0, 2900], [0.28 * L, 1700]] },
    ], 3);
  };

  // "ha-ha-ha-ha-haaa": descending syllables, last one long.
  SFX.laugh = function (v, p) {
    const r = p * rnd(0.95, 1.05), syls = [], n = 5;
    let t = 0;
    for (let i = 0; i < n; i++) {
      const last = i === n - 1, d = last ? 0.32 : rnd(0.12, 0.14), pk = (1850 - i * 110) * r;
      syls.push({ t, d, a: last ? 0.95 : 0.8, f: [[0, pk * 0.78], [d * 0.3, pk], [d, pk * (last ? 0.6 : 0.72)]], fm: [[0, 2900], [d, 2000]] });
      t += d + rnd(0.055, 0.075);
    }
    gullVoice(v, p, syls, 3);
  };

  // --- wings & movement -----------------------------------------------------
  function flapAt(v, t, p, a) {
    const n = v.noise('pink', t, t + 0.16), bp = v.filter('bandpass', 1200, 0.9), g = v.gain(0);
    sweep(bp.frequency, t, 1500 * p, 450 * p, 0.12);
    env(g.gain, t, [[0, 0], [0.018, a], [0.14, EPS, 'e']]);
    v.to(n, bp, g, v.out);
    const o = v.osc('sine', 130 * p, t, t + 0.1), og = v.gain(0);
    sweep(o.frequency, t, 130 * p, 60 * p, 0.08);
    perc(og.gain, t, 0.3 * a, 0.008, 0.08);
    v.to(o, og, v.out);
  }
  SFX.flap = (v, p) => flapAt(v, v.t, p, 1);
  SFX.takeoff = function (v, p) {
    for (let i = 0; i < 3; i++) flapAt(v, v.t + i * 0.085 + rnd(0, 0.01), p * (1 + i * 0.1), 0.75 + i * 0.12);
  };

  SFX.peck = function (v, p) {
    const t = v.t, o = v.osc('sine', 1400 * p, t, t + 0.07), g = v.gain(0);
    sweep(o.frequency, t, 1500 * p, 800 * p, 0.03);
    perc(g.gain, t, 0.8, 0.001, 0.045);
    v.to(o, g, v.out);
    const o2 = v.osc('triangle', 2900 * p, t, t + 0.03), g2 = v.gain(0);
    perc(g2.gain, t, 0.35, 0.001, 0.015);
    v.to(o2, g2, v.out);
    const n = v.noise('white', t, t + 0.02), bp = v.filter('bandpass', 4200 * p, 1.5), ng = v.gain(0);
    perc(ng.gain, t, 0.6, 0.0005, 0.008);
    v.to(n, bp, ng, v.out);
  };

  SFX.dash = function (v, p) {
    const t = v.t, d = 0.3;
    const o = v.osc('triangle', 900 * p, t, t + d), og = v.gain(0);
    const n = v.noise('white', t, t + d), nb = v.filter('bandpass', 3000 * p, 2), ng = v.gain(0);
    const times = [], amps = [];
    let tt = t;
    for (let i = 0; i < 7; i++) {
      times.push(tt); amps.push((i % 2 ? 0.38 : 0.5) * rnd(0.85, 1));
      o.frequency.setValueAtTime((i % 2 ? 780 : 920) * p * rnd(0.97, 1.03), tt);
      tt += rnd(0.036, 0.044);
    }
    blips(og.gain, times, amps, 0.002, 0.02);
    blips(ng.gain, times, amps, 0.001, 0.012);
    v.to(o, og, v.out); v.to(n, nb, ng, v.out);
    const w = v.noise('pink', t, t + d + 0.05), wb = v.filter('bandpass', 700, 1.2), wg = v.gain(0);
    env(wb.frequency, t, [[0, 600 * p], [d, 1800 * p]], true);
    env(wg.gain, t, [[0, 0], [0.12, 0.35], [d, EPS, 'e']]);
    v.to(w, wb, wg, v.out);
  };

  SFX.swoop = function (v, p) {
    const t = v.t, d = 0.45, o = v.osc('sine', 2200 * p, t, t + d + 0.02);
    sweep(o.frequency, t, 2300 * p, 700 * p, d);
    const lfo = v.osc('sine', 9, t, t + d), lg = v.gain(30 * p);
    v.to(lfo, lg, o.frequency);
    const g = v.gain(0);
    env(g.gain, t, [[0, 0], [0.08, 0.35], [0.3, 0.3], [d, EPS, 'e']]);
    v.to(o, g, v.out);
    const n = v.noise('pink', t, t + d + 0.02), bp = v.filter('bandpass', 2000, 2), ng = v.gain(0);
    sweep(bp.frequency, t, 2400 * p, 500 * p, d);
    env(ng.gain, t, [[0, 0], [0.12, 0.8], [d, EPS, 'e']]);
    v.to(n, bp, ng, v.out);
  };

  // --- body functions ---------------------------------------------------------
  SFX.poop = function (v, p) {
    const t = v.t, o = v.osc('square', 150 * p, t, t + 0.06), lp = v.filter('lowpass', 700, 1), g = v.gain(0);
    sweep(o.frequency, t, 170 * p, 90 * p, 0.05);
    env(g.gain, t, [[0, 0], [0.005, 0.35], [0.05, EPS, 'e']]);
    v.to(o, lp, g, v.out);
    const t2 = t + 0.05, o2 = v.osc('sine', 500 * p, t2, t2 + 0.1), g2 = v.gain(0);
    env(o2.frequency, t2, [[0, 480 * p], [0.04, 1500 * p], [0.08, 1300 * p]], true);
    env(g2.gain, t2, [[0, 0], [0.004, 0.7], [0.09, EPS, 'e']]);
    v.to(o2, g2, v.out);
  };

  SFX.splat = function (v, p) {
    const t = v.t, n = v.noise('white', t, t + 0.32), lp = v.filter('lowpass', 1500, 1), bp = v.filter('bandpass', 1200, 4), g = v.gain(0), bg = v.gain(0);
    sweep(lp.frequency, t, 2600 * p, 300 * p, 0.25);
    sweep(bp.frequency, t, 1400 * p, 280 * p, 0.22);
    env(g.gain, t, [[0, 0], [0.004, 0.9], [0.28, EPS, 'e']]);
    env(bg.gain, t, [[0, 0], [0.01, 1.4], [0.22, EPS, 'e']]);
    v.to(n, lp, g, v.out); v.to(n, bp, bg, v.out);
    const o = v.osc('sine', 300 * p, t, t + 0.2), og = v.gain(0);
    sweep(o.frequency, t, 320 * p, 60 * p, 0.15);
    perc(og.gain, t, 0.7, 0.003, 0.16);
    v.to(o, og, v.out);
  };

  SFX.yoink = function (v, p) {
    const t = v.t, d = 0.26, o = v.osc('sine', 600 * p, t, t + d + 0.02), o2 = v.osc('triangle', 600 * p, t, t + d + 0.02), g = v.gain(0), g2 = v.gain(0.25);
    for (const x of [o, o2]) env(x.frequency, t, [[0, 520 * p], [0.19, 2000 * p], [d, 2150 * p]], true);
    const lfo = v.osc('sine', 11, t, t + d), lg = v.gain(25 * p);
    v.to(lfo, lg, o.frequency);
    env(g.gain, t, [[0, 0], [0.02, 0.6], [0.2, 0.55], [d, EPS, 'e']]);
    v.to(o, g, v.out); v.to(o2, g2, g);
  };

  SFX.gulp = function (v, p) {
    const t = v.t, o = v.osc('sine', 700 * p, t, t + 0.2), g = v.gain(0);
    sweep(o.frequency, t, 720 * p, 170 * p, 0.15);
    env(g.gain, t, [[0, 0], [0.01, 0.8], [0.17, EPS, 'e']]);
    v.to(o, g, v.out);
    const t2 = t + 0.03, th = v.osc('sine', 120, t2, t2 + 0.13), tg = v.gain(0);
    sweep(th.frequency, t2, 130 * p, 50 * p, 0.1);
    perc(tg.gain, t2, 0.6, 0.004, 0.1);
    v.to(th, tg, v.out);
    const t3 = t + 0.2, o3 = v.osc('sine', 300, t3, t3 + 0.08), g3 = v.gain(0);
    sweep(o3.frequency, t3, 280 * p, 520 * p, 0.04);
    perc(g3.gain, t3, 0.35, 0.004, 0.05);
    v.to(o3, g3, v.out);
  };

  // Train of filtered, distorted noise "crumbs" (crunch / chomp / rustle).
  function crumbs(v, t, p, n, span, hz, q, amp, d) {
    const src = v.noise('white', t, t + span + d + 0.02), bp = v.filter('bandpass', hz * p, q), sh = v.shaper(4), g = v.gain(0);
    const times = [], amps = [];
    for (let i = 0; i < n; i++) { times.push(t + (span * i) / n + rnd(0, span / n / 2)); amps.push(amp * rnd(0.35, 1)); }
    blips(g.gain, times, amps, 0.001, d);
    v.to(src, bp, g, sh, v.out);
  }
  SFX.chomp = function (v, p) {
    const t = v.t;
    crumbs(v, t, p, 5, 0.05, 1800, 1, 0.5, 0.018);
    crumbs(v, t + 0.1, p * 0.9, 4, 0.05, 1600, 1, 0.4, 0.018);
    const o = v.osc('sine', 120, t, t + 0.1), g = v.gain(0);
    sweep(o.frequency, t, 140 * p, 60 * p, 0.07);
    perc(g.gain, t, 0.55, 0.002, 0.07);
    v.to(o, g, v.out);
  };
  SFX.crunch = function (v, p) {
    crumbs(v, v.t, p, 9, 0.17, 2600, 0.9, 0.55, 0.014);
    const o = v.osc('sine', 200, v.t, v.t + 0.06), g = v.gain(0);
    sweep(o.frequency, v.t, 220 * p, 90 * p, 0.04);
    perc(g.gain, v.t, 0.3, 0.002, 0.04);
    v.to(o, g, v.out);
  };
  SFX.rustle = function (v, p) {
    const t = v.t, d = 0.36;
    crumbs(v, t, p, 14, d - 0.04, 4500, 0.7, 0.5, 0.01);
    const n = v.noise('white', t, t + d), hp = v.filter('highpass', 3000 * p, 0.7), g = v.gain(0);
    env(g.gain, t, [[0, 0], [0.05, 0.12], [0.2, 0.08], [d, EPS, 'e']]);
    v.to(n, hp, g, v.out);
  };

  // --- bells & chimes ---------------------------------------------------------
  const BELL = [[1, 1, 1], [2.0, 0.45, 0.6], [3.01, 0.22, 0.35], [4.17, 0.12, 0.2]];
  function bell(v, t, hz, a, dec, parts) {
    for (let i = 0; i < (parts || 4); i++) {
      const b = BELL[i], o = v.osc('sine', hz * b[0], t, t + dec * b[2] + 0.03), g = v.gain(0);
      perc(g.gain, t, a * b[1], 0.002, dec * b[2]);
      v.to(o, g, v.out);
    }
  }
  SFX.ding = (v, p) => bell(v, v.t, 1568 * p, 0.45, 0.5, 4);
  SFX.bigding = function (v, p) {
    [1568, 1976, 2349, 3136].forEach((hz, i) => bell(v, v.t + i * 0.065, hz * p, i === 3 ? 0.42 : 0.32, i === 3 ? 0.7 : 0.35, 3));
    sparkleAt(v, v.t + 0.2, p, 0.45, 0.7);
  };
  function sparkleAt(v, t, p, d, a) {
    for (let k = 0; k < 3; k++) {
      const o = v.osc('sine', 3000, t, t + d + 0.08), g = v.gain(0), times = [], amps = [];
      let tt = t + k * 0.025 + rnd(0, 0.02);
      while (tt < t + d) {
        o.frequency.setValueAtTime(rnd(2500, 3800) * p * (1 + (tt - t) * 0.9), tt);
        times.push(tt); amps.push(rnd(0.1, 0.22) * a);
        tt += rnd(0.07, 0.11);
      }
      blips(g.gain, times, amps, 0.003, 0.06);
      v.to(o, g, v.out);
    }
    const n = v.noise('white', t, t + d), hp = v.filter('highpass', 7000, 0.7), ng = v.gain(0);
    env(ng.gain, t, [[0, 0], [0.12, 0.09 * a], [d, EPS, 'e']]);
    v.to(n, hp, ng, v.out);
  }
  SFX.sparkle = (v, p) => sparkleAt(v, v.t, p, 0.75, 1.6);

  // --- impacts ------------------------------------------------------------------
  SFX.swat = function (v, p) {
    const t = v.t, n = v.noise('pink', t, t + 0.12), bp = v.filter('bandpass', 800, 1.5), g = v.gain(0);
    sweep(bp.frequency, t, 600 * p, 2600 * p, 0.1);
    env(g.gain, t, [[0, 0], [0.08, 0.7], [0.11, EPS, 'e']]);
    v.to(n, bp, g, v.out);
    const t2 = t + 0.09, n2 = v.noise('white', t2, t2 + 0.06), hp = v.filter('highpass', 1200, 0.7), sh = v.shaper(3), g2 = v.gain(0);
    perc(g2.gain, t2, 0.9, 0.001, 0.035);
    v.to(n2, hp, g2, sh, v.out);
    const o = v.osc('sine', 220, t2, t2 + 0.08), og = v.gain(0);
    sweep(o.frequency, t2, 240 * p, 110 * p, 0.05);
    perc(og.gain, t2, 0.5, 0.002, 0.05);
    v.to(o, og, v.out);
  };
  SFX.thud = function (v, p) {
    const t = v.t, o = v.osc('sine', 160, t, t + 0.3), sh = v.shaper(1.5), g = v.gain(0);
    sweep(o.frequency, t, 170 * p, 45 * p, 0.18);
    perc(g.gain, t, 0.9, 0.003, 0.25);
    v.to(o, sh, g, v.out);
    const n = v.noise('brown', t, t + 0.08), lp = v.filter('lowpass', 400 * p, 0.8), ng = v.gain(0);
    perc(ng.gain, t, 1.2, 0.002, 0.06);
    v.to(n, lp, ng, v.out);
  };
  SFX.bonk = function (v, p) {
    const t = v.t, o = v.osc('sine', 900, t, t + 0.08), g = v.gain(0);
    sweep(o.frequency, t, 950 * p, 650 * p, 0.04);
    perc(g.gain, t, 0.55, 0.001, 0.06);
    v.to(o, g, v.out);
    const o2 = v.osc('triangle', 1700 * p, t, t + 0.04), g2 = v.gain(0);
    perc(g2.gain, t, 0.3, 0.001, 0.02);
    v.to(o2, g2, v.out);
    boingAt(v, t + 0.04, p * 1.6, 0.35, 0.4);
  };
  function boingAt(v, t, p, d, a) {
    const o = v.osc('triangle', 170 * p, t, t + d + 0.02), g = v.gain(0);
    env(o.frequency, t, [[0, 140 * p], [0.06, 220 * p], [d, 300 * p]], true);
    const lfo = v.osc('sine', 17, t, t + d), lg = v.gain(0);
    env(lg.gain, t, [[0, 70 * p], [d, 3 * p, 'e']]);
    v.to(lfo, lg, o.frequency);
    env(g.gain, t, [[0, 0], [0.008, a], [d * 0.3, a * 0.7], [d, EPS, 'e']]);
    v.to(o, g, v.out);
  }
  SFX.boing = (v, p) => boingAt(v, v.t, p, 0.55, 0.75);
  SFX.pop = function (v, p) {
    const t = v.t, o = v.osc('sine', 300 * p, t, t + 0.08), g = v.gain(0);
    env(o.frequency, t, [[0, 260 * p], [0.018, 1150 * p], [0.05, 900 * p]], true);
    env(g.gain, t, [[0, 0], [0.003, 0.7], [0.06, EPS, 'e']]);
    v.to(o, g, v.out);
    const n = v.noise('white', t, t + 0.01), hp = v.filter('highpass', 3000, 0.7), ng = v.gain(0);
    perc(ng.gain, t, 0.3, 0.0005, 0.005);
    v.to(n, hp, ng, v.out);
  };
  SFX.tick = function (v, p) {
    const t = v.t, o = v.osc('square', 2400 * p, t, t + 0.04), bp = v.filter('bandpass', 3200 * p, 3), g = v.gain(0);
    perc(g.gain, t, 0.9, 0.0008, 0.02);
    v.to(o, bp, g, v.out);
    const n = v.noise('white', t, t + 0.01), hp = v.filter('highpass', 4000, 0.7), ng = v.gain(0);
    perc(ng.gain, t, 0.35, 0.0005, 0.004);
    v.to(n, hp, ng, v.out);
  };

  // --- formant voices (people, kids, dogs) ---------------------------------------
  // s: {dur, f0:[[t,hz]], amp:[[t,v,mode]], formants:[{f:[[t,hz]], q, g}], wave, grit, breath, lfo, vib, trem}
  function formantVoice(v, p, s) {
    const t = v.t, end = t + s.dur + 0.03;
    const o = v.osc(s.wave || 'sawtooth', 100, t, end), src = v.gain(1);
    env(o.frequency, t, s.f0.map((q) => [q[0], q[1] * p]), true);
    if (s.grit) v.to(o, v.shaper(s.grit), src); else o.connect(src);
    let lfo = null;
    if (s.vib || s.trem) lfo = v.osc('sine', s.lfo || 6, t, end);
    if (s.vib) v.to(lfo, v.gain(s.vib), o.detune);
    if (s.breath) v.to(v.noise('pink', t, end), v.gain(s.breath), src);
    const amp = v.gain(0);
    env(amp.gain, t, s.amp);
    for (const F of s.formants) {
      const bp = v.filter('bandpass', F.f[0][1], F.q);
      env(bp.frequency, t, F.f, true);
      v.to(src, bp, v.gain(F.g), amp);
    }
    let tail = amp;
    if (s.trem) { tail = v.gain(1 - s.trem); v.to(lfo, v.gain(s.trem), tail.gain); amp.connect(tail); }
    tail.connect(v.out);
  }

  // Gruff "OI!": "o" (F1 500 / F2 900) gliding to "ee" (F1 300 / F2 2300).
  SFX.oi = function (v, p) {
    const r = rnd(0.95, 1.05);
    formantVoice(v, p, {
      dur: 0.34, grit: 4, breath: 0.12,
      f0: [[0, 128 * r], [0.04, 150 * r], [0.2, 140 * r], [0.34, 104 * r]],
      amp: [[0, 0], [0.01, 1], [0.2, 0.85], [0.34, EPS, 'e']],
      formants: [
        { f: [[0, 520], [0.09, 500], [0.22, 310], [0.34, 290]], q: 6, g: 3.2 },
        { f: [[0, 880], [0.09, 900], [0.22, 2200], [0.34, 2350]], q: 8, g: 2.4 },
        { f: [[0, 2500], [0.34, 3000]], q: 9, g: 1.3 },
      ],
    });
  };
  SFX.eugh = function (v, p) {
    const r = rnd(0.95, 1.05);
    formantVoice(v, p, {
      dur: 0.5, grit: 2, breath: 0.2, lfo: 9, vib: 18,
      f0: [[0, 205 * r], [0.06, 230 * r], [0.5, 118 * r]],
      amp: [[0, 0], [0.04, 0.9], [0.3, 0.7], [0.5, EPS, 'e']],
      formants: [
        { f: [[0, 430], [0.12, 470], [0.5, 520]], q: 6, g: 3.2 },
        { f: [[0, 1500], [0.12, 1350], [0.5, 1100]], q: 8, g: 2.2 },
        { f: [[0, 2400], [0.5, 2300]], q: 9, g: 0.9 },
      ],
    });
  };
  SFX.gasp = function (v, p) {
    const t = v.t, d = 0.3, n = v.noise('pink', t, t + d + 0.02), hp = v.filter('highpass', 500, 0.7), amp = v.gain(0);
    v.to(n, hp);
    [[700, 1100, 3, 2.6], [1500, 2400, 4, 2.2]].forEach((F) => {
      const bp = v.filter('bandpass', F[0] * p, F[2]);
      sweep(bp.frequency, t, F[0] * p, F[1] * p, d);
      v.to(hp, bp, v.gain(F[3]), amp);
    });
    env(amp.gain, t, [[0, 0], [0.2, 1], [0.26, 0.7], [d, EPS, 'e']]);
    amp.connect(v.out);
  };
  // Small child "waaah": high, wobbly, sobbing.
  SFX.wah = function (v, p) {
    const r = rnd(0.95, 1.05);
    formantVoice(v, p, {
      dur: 0.75, grit: 1.5, breath: 0.1, lfo: 7.5, vib: 40, trem: 0.3,
      f0: [[0, 400 * r], [0.12, 560 * r], [0.4, 520 * r], [0.75, 360 * r]],
      amp: [[0, 0], [0.07, 0.9], [0.5, 0.8], [0.75, EPS, 'e']],
      formants: [
        { f: [[0, 450], [0.12, 1000], [0.75, 900]], q: 5, g: 2.6 },
        { f: [[0, 900], [0.12, 1600], [0.75, 1500]], q: 6, g: 2 },
        { f: [[0, 3200]], q: 8, g: 0.9 },
      ],
    });
  };
  function ruffAt(v, t, p) {
    const d = 0.13, o = v.osc('sawtooth', 300 * p, t, t + d + 0.02), src = v.gain(1);
    env(o.frequency, t, [[0, 250 * p], [0.02, 330 * p], [d, 165 * p]], true);
    v.to(o, src);
    v.to(v.noise('white', t, t + d), v.gain(0.45), src);
    const sh = v.shaper(5), amp = v.gain(0);
    v.to(src, sh);
    v.to(sh, v.filter('bandpass', 650 * p, 3), v.gain(2), amp);
    v.to(sh, v.filter('bandpass', 1450 * p, 4), v.gain(1.4), amp);
    env(amp.gain, t, [[0, 0], [0.006, 1], [0.04, 0.7], [d, EPS, 'e']]);
    amp.connect(v.out);
  }
  SFX.bark = function (v, p) { ruffAt(v, v.t, p); ruffAt(v, v.t + 0.19, p * 0.93); };

  // Small crowd "yaaay!" — a few buzzy voices through a shared formant bank + claps.
  SFX.cheer = function (v, p) {
    const t = v.t, d = 1.3, end = t + d + 0.05, src = v.gain(1), amp = v.gain(1);
    for (let k = 0; k < 4; k++) {
      const f = rnd(210, 380) * p, o = v.osc('sawtooth', f, t, end), og = v.gain(0), st = rnd(0, 0.12);
      o.detune.value = rnd(-20, 20);
      env(o.frequency, t, [[0, f * 0.85], [st + 0.15, f * 1.12], [d, f * 0.95]], true);
      env(og.gain, t, [[0, 0], [st + 0.08, 0.5], [d * 0.7, 0.4], [d, EPS, 'e']]);
      v.to(o, og, src);
    }
    v.to(v.noise('pink', t, end), v.gain(0.35), src);
    [[[0, 350], [0.2, 750], [d, 650]], [[0, 2100], [0.2, 1700], [d, 1800]], [[0, 2800]]].forEach((f, i) => {
      const bp = v.filter('bandpass', f[0][1], [5, 6, 6][i]);
      env(bp.frequency, t, f, true);
      v.to(src, bp, v.gain([2.2, 1.6, 0.6][i]), amp);
    });
    amp.connect(v.out);
    const cn = v.noise('white', t, end), cb = v.filter('bandpass', 1400, 0.9), cg = v.gain(0), times = [], amps = [];
    for (let tt = t + 0.05; tt < t + d - 0.1; tt += rnd(0.05, 0.1)) { times.push(tt); amps.push(rnd(0.2, 0.5)); }
    blips(cg.gain, times, amps, 0.002, 0.04);
    v.to(cn, cb, cg, v.out);
  };

  // --- big things on the promenade ---------------------------------------------------
  // Ship's horn: two detuned pairs a minor third apart, brassy lowpass bloom.
  SFX.horn = function (v, p) {
    const t = v.t, d = 1.6, end = t + d + 0.05, sh = v.shaper(1.5), lp = v.filter('lowpass', 300, 1.5), amp = v.gain(0);
    [[92.5, -0.4], [92.5, 0.45], [110, 0.3], [110, -0.35]].forEach((h) => {
      const hz = h[0] * p + h[1], o = v.osc('sawtooth', hz, t, end);
      env(o.frequency, t, [[0, hz * 0.96], [0.15, hz]], true);
      o.connect(sh);
    });
    env(lp.frequency, t, [[0, 250], [0.25, 1100, 'e'], [1.2, 900], [d, 300, 'e']]);
    env(amp.gain, t, [[0, 0], [0.14, 0.4], [1.25, 0.36], [d, EPS, 'e']]);
    v.to(sh, lp, amp, v.out);
  };
  // Metal bin: inharmonic partials + impact + lid rattle.
  SFX.bin = function (v, p) {
    const t = v.t, base = 410 * p;
    [[1, 0.5, 0.55], [2.43, 0.35, 0.4], [3.86, 0.3, 0.3], [5.37, 0.2, 0.22], [6.93, 0.14, 0.16]].forEach((q) => {
      const o = v.osc('sine', base * q[0], t, t + q[2] + 0.05), g = v.gain(0);
      perc(g.gain, t, q[1], 0.002, q[2]);
      v.to(o, g, v.out);
    });
    const n = v.noise('white', t, t + 0.06), bp = v.filter('bandpass', 3000, 0.8), ng = v.gain(0);
    perc(ng.gain, t, 0.6, 0.001, 0.05);
    v.to(n, bp, ng, v.out);
    const n2 = v.noise('white', t + 0.08, t + 0.5), bp2 = v.filter('bandpass', 2400 * p, 2.5), rg = v.gain(0), times = [], amps = [];
    let tt = t + 0.09;
    for (let i = 0; i < 6; i++) { times.push(tt); amps.push(0.5 * (1 - i / 7) * rnd(0.6, 1)); tt += rnd(0.035, 0.06); }
    blips(rg.gain, times, amps, 0.002, 0.03);
    v.to(n2, bp2, rg, v.out);
  };
  SFX.splash = function (v, p) {
    const t = v.t, n = v.noise('white', t, t + 0.65), lp = v.filter('lowpass', 5000, 0.7), g = v.gain(0);
    env(lp.frequency, t, [[0, 7000 * p], [0.5, 700 * p]], true);
    env(g.gain, t, [[0, 0], [0.012, 0.8], [0.1, 0.45], [0.6, EPS, 'e']]);
    v.to(n, lp, g, v.out);
    const o = v.osc('sine', 900, t, t + 0.65), og = v.gain(0), times = [], amps = [];
    let tt = t + 0.1;
    for (let i = 0; i < 6; i++) {
      const f = rnd(700, 1500) * p;
      o.frequency.setValueAtTime(f, tt); o.frequency.exponentialRampToValueAtTime(f * 1.8, tt + 0.03);
      times.push(tt); amps.push(rnd(0.15, 0.35)); tt += rnd(0.05, 0.09);
    }
    blips(og.gain, times, amps, 0.002, 0.035);
    v.to(o, og, v.out);
  };

  // --- UI ---------------------------------------------------------------------------
  function blip(v, t, type, f0, f1, d, a, cut) {
    const o = v.osc(type, f0, t, t + d + 0.02), g = v.gain(0);
    if (f1 !== f0) sweep(o.frequency, t, f0, f1, d * 0.6);
    env(g.gain, t, [[0, 0], [0.004, a], [d * 0.6, a * 0.8], [d, EPS, 'e']]);
    if (cut) v.to(o, v.filter('lowpass', cut, 0.7), g, v.out); else v.to(o, g, v.out);
  }
  SFX.menuMove = (v, p) => blip(v, v.t, 'triangle', 860 * p, 940 * p, 0.06, 0.4);
  SFX.menuBack = (v, p) => blip(v, v.t, 'triangle', 560 * p, 430 * p, 0.09, 0.42);
  SFX.menuSelect = function (v, p) {
    blip(v, v.t, 'triangle', 1319 * p, 1319 * p, 0.12, 0.35);
    bell(v, v.t + 0.07, 1976 * p, 0.3, 0.35, 2);
    blip(v, v.t + 0.07, 'square', 1976 * p, 1976 * p, 0.18, 0.12, 4000);
  };
  SFX.join = function (v, p) {
    SFX.pop(v, p);
    blip(v, v.t + 0.06, 'square', 784 * p, 784 * p, 0.09, 0.22, 3000);
    blip(v, v.t + 0.15, 'square', 1175 * p, 1175 * p, 0.2, 0.25, 3500);
  };
  SFX.countdown = (v, p) => blip(v, v.t, 'square', 880 * p, 880 * p, 0.18, 0.3, 3000);
  SFX.go = function (v, p) {
    [[1760, 0.26], [1319, 0.18], [880, 0.16]].forEach((q) => blip(v, v.t, 'square', q[0] * p, q[0] * p, 0.55, q[1], 4500));
  };
  // Referee pea whistle: short pip then a long trilled blast.
  SFX.whistle = function (v, p) {
    const t = v.t, end = t + 0.64, o = v.osc('sine', 2900 * p, t, end), lfo = v.osc('triangle', 27, t, end);
    v.to(lfo, v.gain(160 * p), o.frequency);
    const am = v.gain(0.75), g = v.gain(0);
    v.to(lfo, v.gain(0.25), am.gain);
    [[0, 0.13], [0.19, 0.42]].forEach((b) => {
      const s = t + b[0];
      g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(0.5, s + 0.015);
      g.gain.setValueAtTime(0.5, s + b[1] - 0.03); g.gain.linearRampToValueAtTime(0, s + b[1]);
    });
    v.to(o, am, g, v.out);
    v.to(v.noise('white', t, end), v.filter('bandpass', 2900 * p, 2), v.gain(0.25), g);
  };

  // Per-sound mix trims (applied to the per-call volume) and per-call random pitch spread.
  // Mix trims, tuned by rendering each sound offline through the default chain
  // (target peaks: squawk/oi ~0.55-0.6, impacts ~0.45, pickups ~0.35, UI ~0.2-0.3).
  const LEVEL = {
    squawk: 1.05, laugh: 1.12, flap: 1.2, takeoff: 1.43, peck: 0.55, dash: 1, swoop: 1.1, poop: 0.8, splat: 0.64, yoink: 0.76,
    gulp: 0.7, chomp: 0.88, crunch: 1, rustle: 0.82, ding: 0.87, bigding: 1.15, sparkle: 0.9, swat: 0.67, thud: 0.63, bonk: 0.81,
    boing: 0.8, pop: 0.76, tick: 0.6, oi: 0.58, eugh: 0.63, gasp: 1.06, wah: 0.68, bark: 0.55, cheer: 0.59, horn: 1.27, bin: 0.52,
    splash: 1, menuMove: 0.81, menuBack: 0.83, menuSelect: 0.85, join: 0.9, countdown: 1.4, go: 0.88, whistle: 1.24,
  };
  const VARY = { flap: 0.05, takeoff: 0.04, peck: 0.06, dash: 0.05, swoop: 0.04, poop: 0.06, splat: 0.06, gulp: 0.05, chomp: 0.06,
    swat: 0.05, thud: 0.06, bonk: 0.04, bin: 0.04, rustle: 0.08, splash: 0.05, pop: 0.08, crunch: 0.08, bark: 0.04, boing: 0.03, horn: 0.01 };

  // =========================================================================
  // AMBIENCE LOOPS: looping noise + filters + LFO oscillators; no per-frame JS.
  // =========================================================================
  const LOOPS = {
    waves(v, t) {
      const n = v.noise('brown', t, null), lp = v.filter('lowpass', 420, 0.5), g = v.gain(0.2);
      const lfo = v.osc('sine', 1 / 7.5, t, null);          // ~7.5 s swell
      v.to(lfo, v.gain(0.14), g.gain); v.to(lfo, v.gain(260), lp.frequency);
      v.to(n, lp, g, v.out);
      const n2 = v.noise('pink', t, null), bp = v.filter('bandpass', 1100, 0.6), g2 = v.gain(0);
      const lfo2 = v.osc('sine', 1 / 11.3, t, null), wash = v.keep(v.c.createWaveShaper());
      wash.curve = washCurve();                             // occasional soft wash
      v.to(lfo2, wash, v.gain(0.3), g2.gain); v.to(wash, v.gain(700), bp.frequency);
      v.to(n2, bp, g2, v.out);
    },
    rain(v, t) {
      const n = v.noise('white', t, null), bp = v.filter('bandpass', 2800, 0.5), g = v.gain(0.16);
      v.to(v.osc('sine', 0.07, t, null), v.gain(0.04), g.gain);
      v.to(n, bp, g, v.out);
      const n2 = v.noise('pink', t, null), lp = v.filter('lowpass', 600, 0.7);
      v.to(n2, lp, v.gain(0.12), v.out);
      [[1, -0.45], [0.77, 0.45]].forEach((q) => {             // two droplet layers, different rates
        v.to(v.noise('drops', t, null, q[0]), v.filter('highpass', 900, 0.7), v.gain(0.22), v.pan(q[1]), v.out);
      });
    },
    crowd(v, t) {
      const n = v.noise('pink', t, null), mix = v.gain(0.75), f1 = v.filter('bandpass', 500, 2.5), f2 = v.filter('bandpass', 1400, 3);
      v.to(v.osc('sine', 0.31, t, null), v.gain(120), f1.frequency);
      v.to(v.osc('sine', 0.47, t, null), v.gain(300), f2.frequency);
      v.to(n, f1, v.gain(1.2), mix); v.to(n, f2, v.gain(0.7), mix);
      [[3.7, 0.12], [5.3, 0.08], [0.09, 0.18]].forEach((q) => v.to(v.osc('sine', q[0], t, null), v.gain(q[1]), mix.gain)); // babble + ebb
      v.to(mix, v.filter('lowpass', 2500, 0.7), v.gain(0.6), v.out);
    },
    wind(v, t) {
      const n = v.noise('pink', t, null), bp = v.filter('bandpass', 450, 1.2), g = v.gain(0.5);
      v.to(v.osc('sine', 0.13, t, null), v.gain(0.3), g.gain);
      v.to(v.osc('sine', 0.071, t, null), v.gain(0.18), g.gain);
      v.to(v.osc('sine', 0.11, t, null), v.gain(250), bp.frequency);
      v.to(n, bp, g, v.out);
      const n2 = v.noise('white', t, null), wb = v.filter('bandpass', 1500, 9), wg = v.gain(0.1);
      v.to(v.osc('sine', 0.17, t, null), v.gain(400), wb.frequency);
      v.to(v.osc('sine', 0.13, t, null), v.gain(0.07), wg.gain);
      v.to(n2, wb, wg, v.out);
    },
  };

  // =========================================================================
  // MUSIC INSTRUMENTS: fn(c, out, t, dur, midi, vel, ...)
  // =========================================================================
  const TIMBRE = {
    fiddle: { w1: 'sawtooth', w2: 'sawtooth', det: 6, cut: 3000, q: 1.2, att: 0.018, rel: 0.06, vib: 14, lvl: 0.2 },
    accordion: { w1: 'square', w2: 'sawtooth', det: 9, cut: 2100, q: 0.8, att: 0.01, rel: 0.05, vib: 6, lvl: 0.17 },
  };
  function scaleStep(m, k, pcs) { // move k diatonic steps within pitch classes `pcs`
    const dir = k > 0 ? 1 : -1;
    let x = m, n = Math.abs(k), guard = 0;
    while (n > 0 && guard++ < 48) { x += dir; if (pcs.indexOf(((x % 12) + 12) % 12) >= 0) n--; }
    return x;
  }
  // Accordion / fiddle lead. orn '~' = roll (upper, note, lower, note); "'" = cut.
  function leadNote(c, out, t, d, m, vel, tb, orn, pcs) {
    const v = new Voice(c, out, t), end = t + d + tb.rel + 0.02, f = mtof(m);
    const o1 = v.osc(tb.w1, f, t, end), o2 = v.osc(tb.w2, f, t, end);
    o1.detune.value = -tb.det; o2.detune.value = tb.det;
    if (orn && pcs) {
      const up = mtof(scaleStep(m, 1, pcs)), dn = mtof(scaleStep(m, -1, pcs));
      const seq = orn === '~' ? [up, f, dn, f] : [up, f];
      for (const o of [o1, o2]) seq.forEach((hz, i) => o.frequency.setValueAtTime(hz, t + i * 0.036));
    }
    if (tb.vib && d > 0.3) {
      const lfo = v.osc('sine', 5.6, t, end), lg = v.gain(0);
      env(lg.gain, t, [[0, 0], [0.15, 0], [0.4, tb.vib]]);
      v.to(lfo, lg); lg.connect(o1.detune); lg.connect(o2.detune);
    }
    const lp = v.filter('lowpass', tb.cut, tb.q), g = v.gain(0), pk = tb.lvl * vel;
    env(lp.frequency, t, [[0, tb.cut * 1.6], [0.08, tb.cut]], true);
    env(g.gain, t, [[0, 0], [tb.att, pk], [Math.max(tb.att + 0.01, d * 0.7), pk * 0.75], [d, pk * 0.6], [d + tb.rel, EPS, 'e']]);
    o1.connect(lp); o2.connect(lp); v.to(lp, g, out);
    v.finish();
  }
  // Bagpipe chanter: bright, nasal, legato, with optional gracenote.
  function pipeNote(c, out, t, d, m, vel, grace) {
    const v = new Voice(c, out, t), end = t + d + 0.04, f = mtof(m), lvl = 0.085 * vel;
    const o1 = v.osc('sawtooth', f, t, end), o2 = v.osc('square', f, t, end), mix = v.gain(1);
    o2.detune.value = 4;
    if (grace) for (const o of [o1, o2]) { o.frequency.setValueAtTime(mtof(grace), t); o.frequency.setValueAtTime(f, t + 0.032); }
    const g = v.gain(0);
    env(g.gain, t, [[0, 0], [0.006, lvl], [d, lvl * 0.92], [d + 0.03, EPS, 'e']]);
    o1.connect(mix); o2.connect(mix);
    v.to(mix, v.filter('highpass', 500, 0.7), v.filter('peaking', 1700, 1.4, 7), v.filter('lowpass', 4500, 0.7), g, out);
    v.finish();
  }
  function startDrone(c, out, t) {
    const v = new Voice(c, out, t), lp = v.filter('lowpass', 900, 0.7), g = v.gain(0);
    [[45, 0, 1], [57, 3, 0.7], [52, -2, 0.5]].forEach((q) => { // A2, A3, E3 (the fifth)
      const o = v.osc('sawtooth', mtof(q[0]), t, null);
      o.detune.value = q[1];
      v.to(o, v.gain(q[2]), lp);
    });
    env(g.gain, t, [[0, 0], [0.8, 0.032]]);
    v.to(lp, g, out);
    return v;
  }
  function bassNote(c, out, t, d, m, vel) {
    const v = new Voice(c, out, t), dec = Math.min(0.45, d + 0.1), f = mtof(m);
    const o1 = v.osc('triangle', f, t, t + dec + 0.05), o2 = v.osc('sine', f, t, t + dec + 0.05);
    const lp = v.filter('lowpass', 900, 1), g = v.gain(0);
    env(lp.frequency, t, [[0, 1800], [0.08, 500]], true);
    perc(g.gain, t, 0.19 * vel, 0.006, dec);
    v.to(o1, lp, g, out); v.to(o2, v.gain(0.6), g);
    v.finish();
  }
  // Bodhrán: 'X' accent, 'x' normal, 'o' top/rim stroke.
  function drumHit(c, out, t, k, vel) {
    const v = new Voice(c, out, t), top = k === 'o', f0 = top ? 230 : 135, f1 = top ? 150 : 58, dec = top ? 0.12 : 0.26;
    const o = v.osc('sine', f0, t, t + dec + 0.05), g = v.gain(0);
    sweep(o.frequency, t, f0, f1, dec * 0.6);
    perc(g.gain, t, (k === 'X' ? 0.28 : top ? 0.16 : 0.2) * vel, 0.003, dec);
    v.to(o, g, out);
    const n = v.noise('pink', t, t + 0.08), ng = v.gain(0);
    perc(ng.gain, t, (top ? 0.11 : 0.07) * vel, 0.002, 0.05);
    v.to(n, v.filter(top ? 'bandpass' : 'lowpass', top ? 1600 : 1100, 0.8), ng, out);
    v.finish();
  }
  function shakerHit(c, out, t, k) {
    const v = new Voice(c, out, t), g = v.gain(0);
    env(g.gain, t, [[0, 0], [0.012, k === 'S' ? 0.18 : 0.12], [0.07, EPS, 'e']]);
    v.to(v.noise('white', t, t + 0.09), v.filter('highpass', 6500, 0.7), g, out);
    v.finish();
  }
  // Soft squeezebox chord stab.
  function stabChord(c, out, t, d, ms, vel) {
    const v = new Voice(c, out, t), end = t + d + 0.08, lp = v.filter('lowpass', 1600, 0.7), g = v.gain(0);
    for (const m of ms) { const o = v.osc('sawtooth', mtof(m), t, end); o.detune.value = rnd(-6, 6); o.connect(lp); }
    env(g.gain, t, [[0, 0], [0.01, 0.05 * vel], [d, 0.036 * vel], [d + 0.06, EPS, 'e']]);
    v.to(lp, g, out);
    v.finish();
  }
  function bellNote(c, out, t, m, vel, dec) { const v = new Voice(c, out, t); bell(v, t, mtof(m), 0.12 * vel, dec, 2); v.finish(); }
  function brassNote(c, out, t, d, m, vel) {
    const v = new Voice(c, out, t), end = t + d + 0.2, f = mtof(m), lp = v.filter('lowpass', 600, 2), g = v.gain(0);
    for (const det of [-8, 8]) {
      const o = v.osc('sawtooth', f, t, end);
      o.detune.value = det;
      env(o.frequency, t, [[0, f * 0.96], [0.04, f]], true);
      o.connect(lp);
    }
    env(lp.frequency, t, [[0, 500], [0.05, 3200], [0.25, 1800]], true);
    env(g.gain, t, [[0, 0], [0.025, 0.11 * vel], [d, 0.085 * vel], [d + 0.15, EPS, 'e']]);
    v.to(lp, g, out);
    v.finish();
  }
  function cymbal(c, out, t, dec, vel) {
    const v = new Voice(c, out, t), g = v.gain(0);
    perc(g.gain, t, 0.12 * vel, 0.003, dec);
    v.to(v.noise('white', t, t + dec + 0.05), v.filter('highpass', 6000, 0.6), v.filter('peaking', 9000, 1, 5), g, out);
    v.finish();
  }

  // =========================================================================
  // TRACKS (all original). Melody tokens: NOTE[:steps] e.g. 'F#5:4', 'r:2' rest,
  // '/2' sets the default length, '~' prefix = roll, "'" prefix = cut, '|' = bar
  // check. Chords: 'D:16', 'Em:8'. Patterns are one bar: bass R=root 5=fifth,
  // stab x, bodhrán X/x/o, shaker s/S. `fill` replaces the drum bar every 8th bar.
  // =========================================================================
  const DMIX = [2, 4, 6, 7, 9, 11, 0], AMIX = [9, 11, 1, 2, 4, 6, 7], GMAJ = [7, 9, 11, 0, 2, 4, 6], DMAJ = [2, 4, 6, 7, 9, 11, 1];
  const TRACKS = {
    // Grand-but-cute pipe tune over a drone, A mixolydian, dotted march rhythms.
    title: {
      bpm: 100, beat: 4, bar: 16, swing: 0, scale: AMIX, lead: 'pipe', drone: true, vol: 1.35,
      parts: {
        A: `A4:4 C#5:3 B4:1 A4:3 E5:1 E5:4 | F#5:3 E5:1 C#5:3 A4:1 B4:8 | A4:4 C#5:3 E5:1 A5:4 F#5:3 E5:1 | E5:3 C#5:1 B4:3 C#5:1 A4:8 |
            G4:4 B4:3 D5:1 G5:4 F#5:3 E5:1 | D5:3 B4:1 G4:3 B4:1 D5:8 | E5:3 F#5:1 E5:3 C#5:1 B4:3 C#5:1 A4:3 B4:1 | C#5:4 B4:4 A4:8 |`,
        B: `E5:4 A5:3 G5:1 F#5:3 E5:1 F#5:4 | A5:3 F#5:1 E5:3 C#5:1 E5:8 | D5:4 F#5:3 E5:1 D5:3 B4:1 G4:4 | B4:3 C#5:1 D5:3 E5:1 F#5:8 |
            A5:4 G5:3 F#5:1 E5:3 C#5:1 A4:4 | C#5:3 E5:1 F#5:3 G5:1 A5:8 | G5:3 F#5:1 E5:3 C#5:1 B4:3 G4:1 B4:4 | A4:16 |`,
      },
      form: ['A', 'B'],
      drum: 'X...o...x...o.o.', fill: 'X...o.o.x.o.oooo',
    },
    // Relaxed 6/8 jig in G: accordion, bass, shaker.
    lobby: {
      bpm: 105, beat: 6, bar: 12, swing: 0.04, scale: GMAJ, lead: 'accordion', vol: 1.25,
      parts: {
        A: `/2 D5 B4 G4 B4 D5 G5 | E5 G5 E5 C5:4 E5 | D5 B4 D5 G5:4 B5 | A5 F#5 D5 A4:6 |
            B4 D5 G5 B5 A5 G5 | E5 G5 C6 B5:4 A5 | G5 F#5 E5 ~D5:4 F#5 | G5:4 D5 G4:6 |`,
        B: `/2 E5:4 G5 B5 A5 G5 | C6:4 B5 A5 G5 E5 | D5:4 G5 B5:4 G5 | A5 G5 F#5 E5 D5 C5 |
            B4 E5 G5 B5:4 A5 | G5 E5 C5 E5 G5 C6 | B5 A5 G5 F#5 E5 F#5 | G5:6 D5 E5 F#5 |`,
      },
      chords: {
        A: 'G:12 | C:12 | G:12 | D:12 | G:12 | C:12 | D:12 | G:12 |',
        B: 'Em:12 | C:12 | G:12 | D:12 | Em:12 | C:12 | D:12 | G:12 |',
      },
      form: ['A', 'B'],
      bass: 'R.....5.....', stab: '....x.....x.', shk: '..s.s...s.s.',
    },
    // Energetic reel in D mixolydian, AABB (32 bars) with second-time variations.
    game: {
      bpm: 132, beat: 4, bar: 16, swing: 0.05, scale: DMIX, lead: 'fiddle', vol: 1.35,
      parts: {
        A1: `/2 D5 F#5 A5 F#5 G5 F#5 E5 D5 | ~A4:4 F#5 A5 B5 A5 F#5 D5 | E5 C5 G4 C5 E5 G5 E5 C5 | D5 C5 B4 C5 E5:4 D5 C5 |
             D5 F#5 A5 F#5 G5 F#5 E5 D5 | A5 B5 A5 F#5 D5 E5 F#5 A5 | G5 E5 C5 E5 G5 A5 G5 E5 | D5 B4 A4 G4 F#4 A4 D5:4 |`,
        A2: `/2 D5 F#5 A5 F#5 G5 F#5 E5 D5 | A4 D5 F#5 A5 ~B5:4 A5 F#5 | E5 C5 G4 C5 E5 G5 E5 C5 | D5 C5 B4 C5 E5 F#5 G5 E5 |
             D5 F#5 A5 F#5 G5 F#5 E5 D5 | A5 B5 C6 A5 B5 G5 A5 F#5 | G5 E5 C5 E5 D5 C5 B4 G4 | A4 D5 C5 E5 D5:4 F#5 A5 |`,
        B1: `/2 B5 A5 G5 B5 D6:4 B5 G5 | A5 F#5 D5 F#5 A5 B5 A5 F#5 | C6 B5 A5 G5 E5 G5 A5 G5 | F#5 D5 A4 D5 F#5 A5 ~F#5:4 |
             B5 A5 G5 B5 D6 B5 G5 B5 | A5 F#5 D5 F#5 A5:4 B5 C6 | D6 C6 B5 A5 G5 E5 D5 B4 | A4 D5 F#5 E5 D5:4 F#5 A5 |`,
        B2: `/2 B5 A5 G5 B5 D6:4 B5 G5 | A5 F#5 D5 F#5 A5 B5 A5 F#5 | C6 B5 A5 G5 E5 G5 A5 G5 | F#5 A5 D6 A5 F#5 E5 ~D5:4 |
             B5 A5 G5 B5 D6 B5 G5 B5 | A5 F#5 D5 F#5 A5 B5 C6 A5 | B5 G5 E5 C5 B4 C5 A4 B4 | D5:4 F#5 E5 D5:4 r:4 |`,
      },
      chords: {
        A1: 'D:16 | D:16 | C:16 | C:16 | D:16 | D:16 | C:16 | G:8 D:8 |',
        A2: 'D:16 | D:16 | C:16 | C:16 | D:16 | D:16 | C:8 G:8 | D:16 |',
        B1: 'G:16 | D:16 | C:16 | D:16 | G:16 | D:16 | C:8 G:8 | D:16 |',
        B2: 'G:16 | D:16 | C:16 | D:16 | G:16 | D:16 | Em:8 C:8 | D:16 |',
      },
      form: ['A1', 'A2', 'B1', { p: 'B2', harm: true }],
      bass: 'R.......5.......', stab: '....x.......x...',
      drum: 'X.x.o.x.X.x.o.xx', fill: 'X.x.X.x.XxoxXxox', shk: '..s...s...s...s.',
    },
    // Triumphant march in D major; second time round adds harmony + glockenspiel.
    results: {
      bpm: 112, beat: 4, bar: 16, swing: 0.03, scale: DMAJ, lead: 'accordion', vol: 1.2,
      parts: {
        A: `D5:4 F#5:3 E5:1 D5:4 A5:4 | B5:6 A5:2 G5:4 B5:4 | A5:3 F#5:1 D5:3 F#5:1 A5:4 D6:4 | C#6:4 B5:4 A5:8 |
            G5:3 A5:1 B5:4 A5:3 G5:1 F#5:4 | F#5:3 G5:1 A5:4 F#5:3 E5:1 D5:4 | E5:4 G5:3 F#5:1 E5:3 D5:1 C#5:4 | D5:4 A4:4 D5:8 |`,
        B: `B4:3 D5:1 G5:4 G5:3 A5:1 B5:4 | A5:3 F#5:1 D5:4 D5:3 E5:1 F#5:4 | B5:3 A5:1 F#5:4 D5:3 F#5:1 B5:4 | A5:8 E5:4 A5:4 |
            B5:4 D6:4 B5:3 A5:1 G5:4 | A5:4 F#5:4 D5:3 E5:1 F#5:4 | E5:3 F#5:1 G5:3 E5:1 C#5:4 E5:4 | D6:4 A5:4 D5:8 |`,
      },
      chords: {
        A: 'D:16 | G:16 | D:16 | A:16 | G:16 | D:16 | Em:8 A:8 | D:16 |',
        B: 'G:16 | D:16 | Bm:16 | A:16 | G:16 | D:16 | A:16 | D:16 |',
      },
      form: ['A', 'B', { p: 'A', harm: true, glock: true }, { p: 'B', harm: true, glock: true }],
      bass: 'R.......5.......', stab: '....x.......x...',
      drum: 'X...o.x.X...o.o.', fill: 'X.o.X.o.XoXoXooo', shk: '..s...s...s...s.',
    },
  };

  // ---- track compiler: note strings -> per-step event lists --------------------
  const PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  function noteMidi(s) {
    const m = /^([a-gA-G])([#b]?)(-?\d)$/.exec(s);
    if (!m) return null;
    return PC[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (parseInt(m[3], 10) + 1) * 12;
  }
  function parseNotes(str, bar, warn, label) {
    const notes = [];
    let pos = 0, def = 2, barStart = 0, barNo = 1;
    for (const tok of str.trim().split(/\s+/)) {
      if (tok === '|') { if (pos - barStart !== bar) warn.push(label + ' bar ' + barNo + ' has ' + (pos - barStart) + ' steps'); barStart = pos; barNo++; continue; }
      if (tok[0] === '/') { def = parseInt(tok.slice(1), 10) || 2; continue; }
      let t = tok, o = null;
      if (t[0] === '~' || t[0] === "'") { o = t[0]; t = t.slice(1); }
      const parts = t.split(':'), d = parts[1] ? parseInt(parts[1], 10) : def;
      const isRest = parts[0] === 'r' || parts[0] === '-';
      const m = isRest ? null : noteMidi(parts[0]);
      if (!isRest && m == null) warn.push(label + ': bad note ' + tok);
      notes.push({ s: pos, m, d, o });
      pos += d;
    }
    return { notes, len: pos };
  }
  const QUAL = { '': [0, 4, 7], m: [0, 3, 7], '7': [0, 4, 7, 10], m7: [0, 3, 7, 10] };
  function parseChords(str, bar, warn, label) {
    const out = [], toks = str.trim().split(/\s+/);
    let pos = 0, barStart = 0, barNo = 1;
    for (const tok of toks) {
      if (tok === '|') { if (pos - barStart !== bar) warn.push(label + ' chord bar ' + barNo + ' has ' + (pos - barStart)); barStart = pos; barNo++; continue; }
      const m = /^([A-G][#b]?)(m7|m|7)?:(\d+)$/.exec(tok);
      if (!m) { warn.push(label + ': bad chord ' + tok); continue; }
      out.push({ s: pos, d: +m[3], pc: noteMidi(m[1] + '4') % 12, q: QUAL[m[2] || ''] });
      pos += +m[3];
    }
    return { chords: out, len: pos };
  }
  const inRange = (pc, lo) => lo + ((pc - lo) % 12 + 12) % 12; // lowest midi >= lo with pitch class pc

  function compileTrack(name) {
    const def = TRACKS[name], bar = def.bar, beat = def.beat, warn = [], steps = [];
    const add = (s, e) => (steps[s] || (steps[s] = [])).push(e);
    let len = 0;
    for (const fe of def.form) {
      const f = typeof fe === 'string' ? { p: fe } : fe, mel = parseNotes(def.parts[f.p], bar, warn, name + '.' + f.p);
      let prevM = null;
      for (const n of mel.notes) {
        if (n.m == null) { prevM = null; continue; }
        const s = len + n.s, vel = n.s % bar === 0 ? 1 : n.s % beat === 0 ? 0.9 : 0.78;
        const e = { i: def.lead, m: n.m, d: n.d, v: vel, o: n.o };
        if (def.lead === 'pipe' && (n.s % beat === 0 || n.m === prevM)) e.g = n.m < 79 ? 79 : n.m === 79 ? 81 : null;
        add(s, e);
        if (f.harm) add(s, { i: 'harm', m: scaleStep(n.m, -2, def.scale), d: n.d, v: vel * 0.55 });
        if (f.glock && n.s % beat === 0) add(s, { i: 'glock', m: n.m + 12, d: n.d, v: vel });
        prevM = n.m;
      }
      if (def.chords && def.chords[f.p]) {
        const ch = parseChords(def.chords[f.p], bar, warn, name + '.' + f.p);
        if (ch.len !== mel.len) warn.push(name + '.' + f.p + ': chords ' + ch.len + ' vs melody ' + mel.len);
        for (const c of ch.chords) {
          const root = inRange(c.pc, 43), tones = c.q.map((iv) => inRange((c.pc + iv) % 12, 60)).sort((a, b) => a - b);
          for (let s = c.s; s < c.s + c.d; s++) {
            const pos = s % bar, bp = def.bass && def.bass[pos];
            if (s === c.s || bp === 'R') add(len + s, { i: 'bass', m: root, d: 4, v: pos === 0 ? 1 : 0.85 });
            else if (bp === '5') add(len + s, { i: 'bass', m: root + 7 > 55 ? root - 5 : root + 7, d: 4, v: 0.8 });
            if (def.stab && def.stab[pos] === 'x') add(len + s, { i: 'stab', ms: tones, d: 1.2, v: 1 });
          }
        }
      }
      len += mel.len;
    }
    for (const key of ['drum', 'shk']) {
      if (!def[key]) continue;
      if (def[key].length !== bar) warn.push(name + '.' + key + ' pattern length ' + def[key].length);
      for (let b = 0; b < len / bar; b++) {
        const pat = key === 'drum' && def.fill && b % 8 === 7 ? def.fill : def[key];
        for (let i = 0; i < bar; i++) {
          const ch = pat[i];
          if (ch && ch !== '.') add(b * bar + i, { i: key, k: ch, v: i === 0 ? 1 : 0.85, d: 1 });
        }
      }
    }
    if (len % bar) warn.push(name + ': length ' + len + ' is not whole bars');
    const sw = def.swing || 0, swing = [];
    for (let i = 0; i < beat; i++) swing.push(beat === 4 ? (i < 2 ? 1 + sw : 1 - sw) : beat === 6 ? [1 + sw, 1 + sw, 1 - sw, 1 - sw, 1, 1][i] : 1);
    return { name, len, steps, bar, beat, swing, stepDur: 60 / def.bpm / beat, scale: def.scale, drone: !!def.drone, vol: def.vol || 1, warn };
  }
  const compiled = {};
  const getTrack = (name) => compiled[name] || (compiled[name] = compileTrack(name));

  // ---- the sequencer ("two clocks": JS timer schedules on the audio clock) -------
  let tempoTarget = 1;
  const PLAY = {
    fiddle: (s, e, t, d) => leadNote(s.c, s.lead, t, d * 0.94, e.m, e.v, TIMBRE.fiddle, e.o, s.tr.scale),
    accordion: (s, e, t, d) => leadNote(s.c, s.lead, t, d * 0.9, e.m, e.v, TIMBRE.accordion, e.o, s.tr.scale),
    pipe: (s, e, t, d) => pipeNote(s.c, s.lead, t, d, e.m, e.v, e.g),
    harm: (s, e, t, d) => leadNote(s.c, s.lead, t, d * 0.9, e.m, e.v, TIMBRE.accordion, null, null),
    glock: (s, e, t) => bellNote(s.c, s.out, t, e.m, e.v, 0.6),
    bass: (s, e, t, d) => bassNote(s.c, s.out, t, d, e.m, e.v),
    stab: (s, e, t, d) => stabChord(s.c, s.out, t, d, e.ms, e.v),
    drum: (s, e, t) => drumHit(s.c, s.out, t, e.k, e.v),
    shk: (s, e, t) => shakerHit(s.c, s.out, t, e.k),
  };
  function Seq(c, dest, tr, t0) {
    this.c = c; this.tr = tr; this.step = 0; this.next = t0; this.tempo = tempoTarget; this.notes = 0;
    this.out = c.createGain(); this.out.gain.value = tr.vol;
    this.lead = c.createGain();
    // Haas-style stereo width for the lead: dry slightly left, 11 ms echo right.
    const pl = mkPan(c, -0.25), pr = mkPan(c, 0.3), dl = c.createDelay(0.05), dg = c.createGain();
    dl.delayTime.value = 0.011; dg.gain.value = 0.55;
    this.lead.connect(pl); pl.connect(this.out);
    this.lead.connect(dl); dl.connect(dg); dg.connect(pr); pr.connect(this.out);
    this.out.connect(dest);
    this.fixed = [this.out, this.lead, pl, pr, dl, dg];
    this.drone = tr.drone ? startDrone(c, this.out, t0) : null;
  }
  Seq.prototype.run = function (until) {
    const tr = this.tr;
    let guard = 0;
    while (this.next < until && guard++ < 512) {
      const evs = tr.steps[this.step], sd = tr.stepDur / this.tempo;
      if (evs) for (const e of evs) { if (this.only && !this.only[e.i]) continue; PLAY[e.i](this, e, this.next, e.d * sd); this.notes++; }
      this.tempo += (tempoTarget - this.tempo) * 0.1;     // smooth tempo changes
      this.next += sd * tr.swing[this.step % tr.beat];
      this.step = (this.step + 1) % tr.len;
    }
  };
  Seq.prototype.stop = function (fade) {
    fadeTo(this.c, this.out.gain, 0, fade);
    setTimeout(() => this.dispose(), (fade + 0.4) * 1000);
  };
  Seq.prototype.dispose = function () {
    const i = seqs.indexOf(this);
    if (i >= 0) seqs.splice(i, 1);
    if (this.drone) this.drone.stopAll();
    for (const n of this.fixed) { try { n.disconnect(); } catch (e) { /* ignore */ } }
    if (!seqs.length && timer) { clearInterval(timer); timer = null; }
  };

  // =========================================================================
  // STINGERS (in D, to sit over the game/results music). fn(c, out, t) -> secs
  // =========================================================================
  const STING = {
    roundStart(c, out, t) {
      [[57, 0], [62, 0.11], [66, 0.22]].forEach((q) => { brassNote(c, out, t + q[1], 0.09, q[0], 0.85); drumHit(c, out, t + q[1], 'o', 0.7); });
      [69, 66, 62].forEach((m, i) => brassNote(c, out, t + 0.33, 0.5, m, i ? 0.6 : 1));
      drumHit(c, out, t + 0.33, 'X', 1); cymbal(c, out, t + 0.33, 0.7, 0.6);
      return 1.0;
    },
    roundEnd(c, out, t) {
      [81, 78, 74, 69].forEach((m, i) => brassNote(c, out, t + i * 0.1, 0.08, m, 0.75));
      [62, 66].forEach((m) => brassNote(c, out, t + 0.5, 0.1, m, 0.8));
      [74, 69, 66, 62].forEach((m, i) => brassNote(c, out, t + 0.66, 0.45, m, i ? 0.6 : 1));
      drumHit(c, out, t + 0.5, 'x', 0.8); drumHit(c, out, t + 0.66, 'X', 1); cymbal(c, out, t + 0.66, 0.6, 0.5);
      return 1.25;
    },
    victory(c, out, t) {
      for (let i = 0; i < 10; i++) drumHit(c, out, t + i * 0.05, 'o', 0.35 + i * 0.06);
      [[62, 0.5], [66, 0.6], [69, 0.7]].forEach((q) => brassNote(c, out, t + q[1], 0.08, q[0], 0.9));
      [74, 69, 66, 62].forEach((m, i) => brassNote(c, out, t + 0.8, 0.95, m, i ? 0.55 : 1));
      bassNote(c, out, t + 0.8, 0.8, 38, 1); drumHit(c, out, t + 0.8, 'X', 1); cymbal(c, out, t + 0.8, 1.2, 0.8);
      [86, 90, 93, 98].forEach((m, i) => bellNote(c, out, t + 0.85 + i * 0.07, m, 1.2, 0.9));
      drumHit(c, out, t + 1.75, 'X', 0.8);
      return 2.0;
    },
    event(c, out, t) { // "ba-da-BAH!"
      [[0, 0.08], [0.13, 0.08]].forEach((q) => { brassNote(c, out, t + q[0], q[1], 69, 0.8); brassNote(c, out, t + q[0], q[1], 64, 0.55); });
      [74, 69, 62].forEach((m, i) => brassNote(c, out, t + 0.26, 0.4, m, i ? 0.65 : 1));
      drumHit(c, out, t + 0.26, 'X', 1);
      return 0.8;
    },
    golden(c, out, t) {
      [86, 90, 93, 98, 102, 105].forEach((m, i) => bellNote(c, out, t + i * 0.08, m, 1.3, 0.7));
      const v = new Voice(c, out, t);
      sparkleAt(v, t + 0.1, 1.2, 0.8, 1.3);
      [62, 69].forEach((m) => { // soft pad swell underneath
        const o = v.osc('triangle', mtof(m), t, t + 1.05), g = v.gain(0);
        env(g.gain, t, [[0, 0], [0.4, 0.07], [1.0, EPS, 'e']]);
        v.to(o, g, out);
      });
      v.finish();
      return 1.1;
    },
  };

  // =========================================================================
  // ENGINE STATE & PUBLIC API
  // =========================================================================
  let ctx = null, bus = null, failed = false, vols = null, resumePending = false, primed = false;
  let activeVoices = 0, timer = null, current = null, wantTrack = null;
  const seqs = [], loops = {}, wantLoops = {}, recent = {}, errors = [];

  function buildChain(c) {
    const b = {
      comp: c.createDynamicsCompressor(), master: c.createGain(), music: c.createGain(), duck: c.createGain(),
      sfx: c.createGain(), amb: c.createGain(), sting: c.createGain(), half: c.createGain(), clip: c.createWaveShaper(),
    };
    const k = b.comp;
    k.threshold.value = -8; k.knee.value = 8; k.ratio.value = 4; k.attack.value = 0.004; k.release.value = 0.25;
    b.half.gain.value = 0.5; b.clip.curve = clipCurve();
    b.amb.gain.value = 0.75; // ambience sits under everything
    b.sting.gain.value = 1.5; // jingles must read over the (ducked) music
    b.duck.connect(b.music); b.music.connect(b.master);
    b.amb.connect(b.sfx); b.sting.connect(b.sfx); b.sfx.connect(b.master);
    b.master.connect(k); k.connect(b.half); b.half.connect(b.clip); b.clip.connect(c.destination);
    return b;
  }
  function settingsVols() {
    const s = SG.settings || {};
    return [num(s.master, 0.8), num(s.music, 0.6), num(s.sfx, 0.9)];
  }
  function applyVols(c, b, v, instant) {
    const set = (g, x) => { if (instant) g.gain.value = taper(x); else glide(c, g.gain, taper(x), 0.05); };
    set(b.master, v[0]); set(b.music, v[1]); set(b.sfx, v[2]);
  }
  function duck(c, b, dur) {
    const p = b.duck.gain, now = hold(c, p);
    p.linearRampToValueAtTime(0.5, now + 0.06);
    p.setValueAtTime(0.5, now + Math.max(0.07, dur - 0.1));
    p.linearRampToValueAtTime(1, now + dur + 0.35);
  }
  // Builds and starts one sfx voice into `dest` at time t; returns the Voice.
  function playSfx(c, dest, name, o, t) {
    if (!has(SFX, name)) return null;
    const fn = SFX[name];
    o = o || {};
    const vol = clamp(num(o.vol, 1), 0, 4) * (LEVEL[name] || 1);
    if (!(vol > 0)) return null;
    let pitch = clamp(num(o.pitch, 1), 0.25, 4);
    if (VARY[name]) pitch *= 1 + rnd(-VARY[name], VARY[name]);
    const pan = clamp(num(o.pan, 0), -1, 1), out = c.createGain();
    out.gain.value = vol;
    const v = new Voice(c, out, t);
    v.keep(out);
    if (pan && c.createStereoPanner) { const pn = v.pan(pan); out.connect(pn); pn.connect(dest); } else out.connect(dest);
    fn(v, pitch);
    return v;
  }
  function startLoop(c, dest, name, t) {
    const g = c.createGain();
    g.gain.value = 0; g.connect(dest);
    const v = new Voice(c, g, t);
    v.keep(g);
    LOOPS[name](v, t);
    return { v, g, timer: null, vol: -1 };
  }
  function tick() {
    if (!ctx) return;
    const now = ctx.currentTime, ahead = typeof document !== 'undefined' && document.hidden ? 1.2 : LOOKAHEAD;
    for (let i = 0; i < seqs.length; i++) {
      const s = seqs[i];
      if (s.next < now - 0.15) s.next = now + 0.03; // fell behind (tab throttled): resync
      s.run(now + ahead);
    }
  }
  const running = () => ctx && ctx.state === 'running';

  function init() {
    if (ctx) return true;
    if (failed || !AC) { failed = true; return false; }
    try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { try { ctx = new AC(); } catch (e2) { ctx = null; } }
    if (!ctx) { failed = true; return false; }
    try {
      bus = buildChain(ctx);
      applyVols(ctx, bus, vols || settingsVols(), true);
      buffer(ctx, 'white'); buffer(ctx, 'pink'); buffer(ctx, 'brown'); // pre-generate (~10 ms, once)
    } catch (e) { failed = true; ctx = null; bus = null; return false; }
    if (wantTrack) music(wantTrack);
    for (const k in wantLoops) if (wantLoops[k] != null) loop(k, true, wantLoops[k]);
    return true;
  }
  function unlock() {
    if (!ctx && !init()) return;
    if (ctx.state !== 'running' && !resumePending && ctx.resume) {
      resumePending = true;
      const done = () => { resumePending = false; };
      const pr = ctx.resume();
      if (pr && pr.then) pr.then(done, done); else done();
    }
    if (!primed) { // old iOS needs a sound started inside a gesture
      primed = true;
      const s = ctx.createBufferSource();
      s.buffer = ctx.createBuffer(1, 1, ctx.sampleRate); s.connect(ctx.destination); s.start(0);
      s.onended = () => s.disconnect();
    }
  }
  function setVolumes(m, mu, s) {
    const cur = vols || settingsVols();
    vols = [clamp(num(m, cur[0]), 0, 1), clamp(num(mu, cur[1]), 0, 1), clamp(num(s, cur[2]), 0, 1)];
    if (bus) applyVols(ctx, bus, vols, false);
  }
  function sfx(name, opts) {
    if (!running() || !has(SFX, name) || activeVoices >= MAX_VOICES) return;
    const now = performance.now(), r = recent[name] || (recent[name] = []);
    while (r.length && now - r[0] > THROTTLE_MS) r.shift();
    if (r.length >= THROTTLE_N) return;
    r.push(now);
    const delay = clamp(num(opts && opts.delay, 0), 0, 10);
    const v = playSfx(ctx, bus.sfx, name, opts, ctx.currentTime + 0.005 + delay);
    if (v) { activeVoices++; v.finish(() => { activeVoices--; }); }
  }
  function loop(name, on, vol) {
    if (!has(LOOPS, name)) return;
    wantLoops[name] = on ? clamp(num(vol, 1), 0, 2) : null;
    if (!ctx) return;
    let L = loops[name];
    if (on) {
      if (!L) L = loops[name] = startLoop(ctx, bus.amb, name, ctx.currentTime);
      if (L.timer) { clearTimeout(L.timer); L.timer = null; L.vol = -1; }
      if (L.vol === wantLoops[name]) return; // already there (cheap to call every frame)
      L.vol = wantLoops[name];
      fadeTo(ctx, L.g.gain, L.vol, 1.0);
    } else if (L && !L.timer) {
      L.vol = 0;
      fadeTo(ctx, L.g.gain, 0, 1.0);
      L.timer = setTimeout(() => { L.v.stopAll(); if (loops[name] === L) delete loops[name]; }, 1150);
    }
  }
  function music(name) {
    name = has(TRACKS, name) ? name : name ? undefined : null;
    if (name === undefined) return; // unknown track: ignore
    wantTrack = name;
    if (!ctx) return;
    if ((current && current.name) === name || (!current && !name)) return;
    if (current) { current.seq.stop(XFADE); current = null; }
    if (!name) return;
    tempoTarget = 1; // a new track always starts at normal speed
    const seq = new Seq(ctx, bus.duck, getTrack(name), ctx.currentTime + 0.05);
    seq.out.gain.setValueAtTime(0, ctx.currentTime);
    seq.out.gain.linearRampToValueAtTime(seq.tr.vol, ctx.currentTime + XFADE);
    seqs.push(seq);
    current = { name, seq };
    if (!timer) timer = setInterval(() => { try { tick(); } catch (e) { report(e); } }, TICK_MS);
    tick();
  }
  function setTempo(mult) { tempoTarget = clamp(num(mult, 1), 0.5, 2); }
  function stinger(name) {
    if (name === 'countdown3') return sfx('countdown');
    if (!running() || !has(STING, name)) return;
    const dur = STING[name](ctx, bus.sting, ctx.currentTime + 0.02);
    duck(ctx, bus, dur);
  }

  function report(e) {
    if (errors.length < 20) errors.push(String(e && e.stack || e));
    if (errors.length <= 3 && typeof console !== 'undefined') console.warn('[SG.Audio]', e);
  }
  const safe = (fn) => function () { try { return fn.apply(null, arguments); } catch (e) { report(e); return undefined; } };

  // ---- test / debug hooks: render anything into an OfflineAudioContext ----------
  function analyse(buf) {
    const sr = buf.sampleRate, chans = [];
    for (let ch = 0; ch < buf.numberOfChannels; ch++) chans.push(buf.getChannelData(ch));
    let peak = 0, first = -1, last = -1, nan = 0, clip = 0, sum = 0;
    for (const d of chans) for (let i = 0; i < d.length; i++) {
      const x = d[i], a = Math.abs(x);
      if (x !== x) { nan++; continue; }
      if (a > peak) peak = a;
      if (a >= 1) clip++;
      if (a > 0.001) { if (first < 0 || i < first) first = i; if (i > last) last = i; }
    }
    if (first >= 0) for (const d of chans) for (let i = first; i <= last; i++) sum += d[i] * d[i];
    const n = first >= 0 ? (last - first + 1) * chans.length : 1;
    return { peak, rms: Math.sqrt(sum / n), start: first / sr, end: last / sr, dur: (last - first) / sr, nan, clip };
  }
  function render(secs, settings, build, keep) {
    if (!OAC) return Promise.reject(new Error('no OfflineAudioContext'));
    const sr = 44100, oc = new OAC(2, Math.ceil(secs * sr), sr), b = buildChain(oc);
    applyVols(oc, b, settings || settingsVols(), true);
    const info = build(oc, b) || {};
    return oc.startRendering().then((buf) => Object.assign(analyse(buf), info, keep ? { buffer: buf } : {}));
  }

  SG.Audio = {
    isRunning: () => { try { return running(); } catch (e) { return false; } },
    init: safe(init),
    unlock: safe(unlock),
    setVolumes: safe(setVolumes),
    sfx: safe(sfx),
    loop: safe(loop),
    music: safe(music),
    setTempo: safe(setTempo),
    stinger: safe(stinger),
    _debug: {
      names: { sfx: Object.keys(SFX), loops: Object.keys(LOOPS), tracks: Object.keys(TRACKS), stingers: Object.keys(STING) },
      errors,
      internals: { buildChain, playSfx, SFX, LEVEL, TRACKS, getTrack, analyse },
      stats: () => ({ state: ctx ? ctx.state : 'none', voices: activeVoices, seqs: seqs.length, loops: Object.keys(loops),
        track: current ? current.name : null, notes: seqs.reduce((a, s) => a + s.notes, 0), tempo: seqs.length ? seqs[seqs.length - 1].tempo : tempoTarget }),
      warnings: () => Object.keys(TRACKS).reduce((a, n) => a.concat(getTrack(n).warn), []),
      // kind: 'sfx' | 'loop' | 'music' | 'stinger' | 'chaos'
      // opts: {secs, settings:[m,mu,s], sfx:{vol,pitch,pan}, raw (bypass master chain), tempo, only:[instruments], keep (return buffer)}
      render(kind, name, opts) {
        opts = opts || {};
        const T = 0.5; // lead-in: an offline compressor starts "cold" and squashes the first few hundred ms
        const secs = T + (opts.secs || (kind === 'sfx' ? 2 : kind === 'stinger' ? 2.5 : 8));
        return render(secs, opts.settings, (oc, b) => {
          if (opts.raw) { b.sfx.disconnect(); b.sfx.connect(oc.destination); b.sfx.gain.value = 1; }
          if (kind === 'sfx') { const v = playSfx(oc, b.sfx, name, opts.sfx, T); if (v) v.finish(); return { nodes: v ? v.nodes.length : 0 }; }
          if (kind === 'loop') { const L = startLoop(oc, b.amb, name, 0); L.g.gain.value = num(opts.vol, 1); return {}; }
          if (kind === 'stinger') { const d = STING[name](oc, b.sting, T); return { declared: d }; }
          if (kind === 'music') {
            const old = tempoTarget;
            tempoTarget = num(opts.tempo, 1);
            const s = new Seq(oc, b.duck, getTrack(name), T);
            if (opts.only) { s.only = {}; opts.only.forEach((k) => { s.only[k] = 1; }); }
            s.run(secs);
            tempoTarget = old;
            return { notes: s.notes, steps: s.step };
          }
          if (kind === 'chaos') { // 4-player mayhem over the game music + waves
            const s = new Seq(oc, b.duck, getTrack('game'), T);
            s.run(secs);
            const L = startLoop(oc, b.amb, 'waves', 0); L.g.gain.value = 1;
            const pool = opts.pool || Object.keys(SFX);
            let count = 0;
            for (let t = T; t < secs - 1; t += opts.gap || 0.03) {
              const v = playSfx(oc, b.sfx, pool[Math.floor(Math.random() * pool.length)], { pitch: rnd(0.85, 1.2), pan: rnd(-0.7, 0.7) }, t);
              if (v) { v.finish(); count++; }
            }
            STING.event(oc, b.sting, T + 1); duck(oc, b, 0.8);
            return { sfxCount: count };
          }
          return {};
        }, opts.keep);
      },
    },
  };
})(window.SG = window.SG || {});
