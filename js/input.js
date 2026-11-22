// ---------------------------------------------------------------------------
// Input: up to 4 gamepads (standard mapping) + 2 keyboard layouts, exposed as
// uniform virtual "devices". Each device has per-frame `held` and `pressed`
// maps for the actions below, plus an analogue move vector.
//
// Actions:  flap, peck, poop, dash, squawk, start, back, confirm, cancel,
//           up, down, left, right   (menu directions, with auto-repeat)
// ---------------------------------------------------------------------------
(function (SG) {
  'use strict';

  const ACTIONS = ['flap', 'peck', 'poop', 'dash', 'squawk', 'start', 'confirm', 'cancel', 'up', 'down', 'left', 'right'];

  // Keyboard layouts. KB1 = left side of keyboard, KB2 = arrows + right side/numpad.
  const KEYMAPS = {
    kb1: {
      up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'],
      flap: ['Space', 'KeyK'], peck: ['KeyF', 'KeyJ'], poop: ['KeyG', 'KeyL'],
      dash: ['ShiftLeft', 'KeyI'], squawk: ['KeyQ', 'KeyU'],
      start: ['Escape'], confirm: ['Space', 'KeyK', 'KeyF', 'KeyJ'], cancel: ['Escape', 'Backspace', 'KeyG', 'KeyL'],
    },
    kb2: {
      up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
      flap: ['Slash', 'Numpad0', 'ControlRight'], peck: ['Period', 'Numpad1'], poop: ['Comma', 'Numpad2'],
      dash: ['ShiftRight', 'Numpad3'], squawk: ['Semicolon', 'NumpadAdd'],
      start: ['Enter', 'NumpadEnter'], confirm: ['Enter', 'NumpadEnter', 'Slash', 'Numpad0', 'Period'], cancel: ['Backspace', 'Comma', 'Numpad2'],
    },
  };

  const keysDown = new Set();
  const keysPressedThisFrame = new Set();
  let clickedThisFrame = false;

  function makeDevice(id, type, index) {
    const held = {}, pressed = {}, released = {}, prev = {};
    for (const a of ACTIONS) { held[a] = false; pressed[a] = false; released[a] = false; prev[a] = false; }
    return {
      id, type, index,
      connected: true,
      name: type === 'keyboard' ? (id === 'kb1' ? 'Keyboard (WASD)' : 'Keyboard (Arrows)') : 'Controller ' + (index + 1),
      mx: 0, my: 0,         // analogue move (-1..1)
      held, pressed, released, prev,
      repeat: { up: 0, down: 0, left: 0, right: 0 },
      lastActive: 0,
      anyPressed: false,
    };
  }

  const devices = {
    kb1: makeDevice('kb1', 'keyboard', 0),
    kb2: makeDevice('kb2', 'keyboard', 1),
  };

  window.addEventListener('keydown', (e) => {
    if (SG.Audio && SG.Audio.unlock) SG.Audio.unlock();
    if (!keysDown.has(e.code)) keysPressedThisFrame.add(e.code);
    keysDown.add(e.code);
    // Stop the page from scrolling / browser shortcuts while playing.
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Slash', 'Tab', 'Backspace'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => { keysDown.delete(e.code); });
  window.addEventListener('blur', () => { keysDown.clear(); });
  window.addEventListener('pointerdown', () => { clickedThisFrame = true; if (SG.Audio && SG.Audio.unlock) SG.Audio.unlock(); });
  // Browsers (iOS Safari especially) only treat the END of a tap as a user gesture, so unlock there too.
  for (const ev of ['pointerup', 'touchend', 'click']) {
    window.addEventListener(ev, () => { if (SG.Audio && SG.Audio.unlock) SG.Audio.unlock(); }, { passive: true });
  }

  const DEADZONE = 0.28;
  const REPEAT_DELAY = 0.38, REPEAT_RATE = 0.11;

  function applyDirRepeat(dev, dt) {
    // Menu directions fire on press and then auto-repeat while held.
    for (const d of ['up', 'down', 'left', 'right']) {
      if (dev.held[d]) {
        if (!dev.prev[d]) { dev.pressed[d] = true; dev.repeat[d] = REPEAT_DELAY; }
        else {
          dev.repeat[d] -= dt;
          if (dev.repeat[d] <= 0) { dev.pressed[d] = true; dev.repeat[d] = REPEAT_RATE; }
        }
      }
    }
  }

  function finish(dev, dt, now) {
    dev.anyPressed = false;
    for (const a of ACTIONS) {
      if (a === 'up' || a === 'down' || a === 'left' || a === 'right') { dev.pressed[a] = false; continue; }
      dev.pressed[a] = dev.held[a] && !dev.prev[a];
      dev.released[a] = !dev.held[a] && dev.prev[a];
      if (dev.pressed[a]) dev.anyPressed = true;
    }
    applyDirRepeat(dev, dt);
    for (const d of ['up', 'down', 'left', 'right']) if (dev.pressed[d]) dev.anyPressed = true;
    if (dev.anyPressed || Math.abs(dev.mx) > 0.5 || Math.abs(dev.my) > 0.5) dev.lastActive = now;
    for (const a of ACTIONS) dev.prev[a] = dev.held[a];
  }

  function updateKeyboard(dev, dt, now) {
    const map = KEYMAPS[dev.id];
    for (const a of ACTIONS) {
      const keys = map[a];
      dev.held[a] = !!keys && keys.some((k) => keysDown.has(k) || keysPressedThisFrame.has(k));
    }
    let mx = (dev.held.right ? 1 : 0) - (dev.held.left ? 1 : 0);
    let my = (dev.held.down ? 1 : 0) - (dev.held.up ? 1 : 0);
    if (mx && my) { mx *= Math.SQRT1_2; my *= Math.SQRT1_2; }
    dev.mx = mx; dev.my = my;
    finish(dev, dt, now);
  }

  function updateGamepad(dev, gp, dt, now) {
    const b = (i) => !!(gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.5));
    let ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
    const mag = Math.hypot(ax, ay);
    if (mag < DEADZONE) { ax = 0; ay = 0; }
    else {
      const scaled = Math.min(1, (mag - DEADZONE) / (1 - DEADZONE));
      ax = (ax / mag) * scaled; ay = (ay / mag) * scaled;
    }
    // D-pad overrides stick.
    const du = b(12), dd = b(13), dl = b(14), dr = b(15);
    if (du || dd || dl || dr) {
      ax = (dr ? 1 : 0) - (dl ? 1 : 0); ay = (dd ? 1 : 0) - (du ? 1 : 0);
      if (ax && ay) { ax *= Math.SQRT1_2; ay *= Math.SQRT1_2; }
    }
    dev.mx = ax; dev.my = ay;
    dev.held.flap = b(0);
    dev.held.poop = b(1);
    dev.held.peck = b(2);
    dev.held.dash = b(3) || b(5) || b(7);
    dev.held.squawk = b(4) || b(6);
    dev.held.start = b(9);
    dev.held.confirm = b(0);
    dev.held.cancel = b(1) || b(8);
    dev.held.up = du || ay < -0.6;
    dev.held.down = dd || ay > 0.6;
    dev.held.left = dl || ax < -0.6;
    dev.held.right = dr || ax > 0.6;
    finish(dev, dt, now);
    if (dev.anyPressed && SG.Audio && SG.Audio.unlock) SG.Audio.unlock();
  }

  let lastNow = performance.now() / 1000;

  SG.Input = {
    devices,

    update() {
      const now = performance.now() / 1000;
      const dt = Math.min(0.1, now - lastNow);
      lastNow = now;
      updateKeyboard(devices.kb1, dt, now);
      updateKeyboard(devices.kb2, dt, now);
      this.anyKey = keysPressedThisFrame.size > 0;
      this.clicked = clickedThisFrame;
      clickedThisFrame = false;
      keysPressedThisFrame.clear();

      let pads = [];
      try { pads = (navigator.getGamepads && navigator.getGamepads()) || []; } catch (e) { pads = []; }
      const seen = new Set();
      for (let i = 0; i < pads.length; i++) {
        const gp = pads[i];
        if (!gp || !gp.connected) continue;
        const id = 'gp' + gp.index;
        seen.add(id);
        if (!devices[id]) devices[id] = makeDevice(id, 'gamepad', gp.index);
        devices[id].connected = true;
        devices[id].gp = gp;
        updateGamepad(devices[id], gp, dt, now);
      }
      for (const id in devices) {
        if (devices[id].type === 'gamepad' && !seen.has(id)) {
          const d = devices[id];
          d.connected = false;
          for (const a of ACTIONS) { d.held[a] = false; d.pressed[a] = false; d.prev[a] = false; }
          d.mx = 0; d.my = 0; d.anyPressed = false;
        }
      }
    },

    get(id) { return devices[id] || null; },

    list() { return Object.values(devices).filter((d) => d.connected); },

    gamepadCount() { return Object.values(devices).filter((d) => d.type === 'gamepad' && d.connected).length; },

    // Merged menu input from every device.
    menu() {
      const out = { up: false, down: false, left: false, right: false, confirm: false, cancel: false, start: false, any: false, device: null };
      for (const d of Object.values(devices)) {
        if (!d.connected) continue;
        for (const k of ['up', 'down', 'left', 'right', 'confirm', 'cancel', 'start']) {
          if (d.pressed[k]) { out[k] = true; out.device = out.device || d; }
        }
        if (d.anyPressed) out.any = true;
      }
      return out;
    },

    // Consume all presses this frame (prevents a confirm leaking into the next scene).
    flush() {
      this.anyKey = false; this.clicked = false;
      for (const d of Object.values(devices)) {
        for (const a of ACTIONS) d.pressed[a] = false;
        d.anyPressed = false;
      }
    },

    rumble(id, strong, weak, ms) {
      const d = devices[id];
      if (!d || d.type !== 'gamepad' || !d.gp) return;
      const act = d.gp.vibrationActuator;
      if (act && act.playEffect) {
        try { act.playEffect('dual-rumble', { duration: ms || 120, strongMagnitude: strong || 0, weakMagnitude: weak || 0 }); } catch (e) { /* unsupported */ }
      }
    },

    // Human-readable control hints per device type.
    hints(type) {
      if (type === 'keyboard1') return { move: 'WASD', flap: 'SPACE', peck: 'F', poop: 'G', dash: 'SHIFT', squawk: 'Q', start: 'ESC' };
      if (type === 'keyboard2') return { move: 'ARROWS', flap: '/', peck: '.', poop: ',', dash: 'R-SHIFT', squawk: ';', start: 'ENTER' };
      return { move: 'L-STICK', flap: 'A', peck: 'X', poop: 'B', dash: 'Y / RT', squawk: 'LB', start: 'START' };
    },
  };
})(window.SG);
