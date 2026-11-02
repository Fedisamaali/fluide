'use strict';

(function main() {
  const canvas = document.getElementById('c');

  const QUALITY = {
    low: { label: 'basse', SIM_RESOLUTION: 64, DYE_RESOLUTION: 512, PRESSURE_ITERATIONS: 16 },
    medium: { label: 'moyenne', SIM_RESOLUTION: 128, DYE_RESOLUTION: 1024, PRESSURE_ITERATIONS: 20 },
    high: { label: 'haute', SIM_RESOLUTION: 192, DYE_RESOLUTION: 1440, PRESSURE_ITERATIONS: 24 },
    ultra: { label: 'ultra', SIM_RESOLUTION: 256, DYE_RESOLUTION: 2048, PRESSURE_ITERATIONS: 30 },
  };
  const QUALITY_ORDER = ['low', 'medium', 'high', 'ultra'];
  const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) || matchMedia('(pointer: coarse)').matches;
  const params = new URLSearchParams(location.search);

  const config = {
    QUALITY: isMobile ? 'low' : 'medium',
    SIM_RESOLUTION: 128,
    DYE_RESOLUTION: 1024,
    PRESSURE_ITERATIONS: 20,
    DENSITY_DISSIPATION: 1,
    VELOCITY_DISSIPATION: 0.25,
    PRESSURE: 0.8,
    CURL: 28,
    GRID_SMOOTHING: 0.12,
    SPLAT_RADIUS: 0.25,
    SPLAT_FORCE: 6000,
    SHADING: true,
    BLOOM: true,
    BLOOM_ITERATIONS: 8,
    BLOOM_RESOLUTION: 256,
    BLOOM_INTENSITY: 0.75,
    BLOOM_THRESHOLD: 0.55,
    BLOOM_SOFT_KNEE: 0.7,
    EXPOSURE: 1.6,
    PALETTE: 'aurore',
    AMBIENT: true,
    MIC: false,
    PAUSED: false,
  };
  Object.assign(config, pickQuality(config.QUALITY));

  function pickQuality(id) {
    const { label, ...settings } = QUALITY[id];
    return settings;
  }

  function fail(message) {
    const el = document.getElementById('error');
    el.innerHTML = `<div><strong>Impossible de lancer la simulation.</strong><br>${message}</div>`;
    el.hidden = false;
  }

  function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width === width && canvas.height === height) return false;
    canvas.width = width;
    canvas.height = height;
    return true;
  }

  resizeCanvas();
  const context = createGLContext(canvas);
  if (!context) {
    fail('Votre navigateur ou votre carte graphique ne prend pas en charge WebGL2 avec textures flottantes.');
    return;
  }
  const gl = context.gl;

  let fluid;
  try {
    fluid = new Fluid(context, config);
  } catch (err) {
    console.error(err);
    fail(err.message);
    return;
  }

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    fail('Le contexte graphique a été perdu. Rechargez la page.');
  });

  let palette = PALETTES[0];
  const background = palette.background.slice();
  const audio = new AudioReactor();
  const pointers = new Map();
  let lastInteraction = -Infinity;
  let ambientWeight = 0;
  let nextAmbientBurst = 3;
  let textEffect = null;
  let captureRequested = false;
  let simTime = 0;

  const clock = () => performance.now() / 1000;
  const touch = () => { lastInteraction = clock(); };
  const smoothstep = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };

  function correctDeltaX(delta) {
    const aspect = canvas.width / canvas.height;
    return aspect < 1 ? delta * aspect : delta;
  }

  function correctDeltaY(delta) {
    const aspect = canvas.width / canvas.height;
    return aspect > 1 ? delta / aspect : delta;
  }

  /* Actions */

  function randomSplats(count) {
    for (let i = 0; i < count; i++) {
      const color = scaleColor(paletteColor(palette), 7);
      fluid.splat(Math.random(), Math.random(), 1000 * (Math.random() - 0.5), 1000 * (Math.random() - 0.5), color);
    }
  }

  function explosion(x = 0.2 + Math.random() * 0.6, y = 0.25 + Math.random() * 0.5) {
    const n = 14;
    const offset = Math.random() * Math.PI * 2;
    const aspect = canvas.width / canvas.height;
    for (let i = 0; i < n; i++) {
      const a = offset + (i / n) * Math.PI * 2;
      const cx = Math.cos(a);
      const cy = Math.sin(a);
      fluid.splat(x + (cx * 0.035) / aspect, y + cy * 0.035, cx * 1900, cy * 1900, paletteColor(palette, 0.45), 0.3);
    }
    fluid.splat(x, y, 0, 0, paletteColor(palette, 0.9), 0.5);
  }

  function writeText(text) {
    const clean = text.trim().slice(0, 28);
    if (!clean) return;
    if (textEffect) gl.deleteTexture(textEffect.texture);
    const colorA = paletteColor(palette, 1);
    let colorB = paletteColor(palette, 1);
    for (let i = 0; i < 6 && Math.hypot(colorA.r - colorB.r, colorA.g - colorB.g, colorA.b - colorB.b) < 0.45; i++) {
      colorB = paletteColor(palette, 1);
    }
    textEffect = {
      texture: createTextMask(gl, clean.toUpperCase(), fluid.dye.width, fluid.dye.height),
      t: 0,
      duration: 3.2,
      released: false,
      colorA,
      colorB,
    };
  }

  function shatterText() {
    const n = 9;
    for (let i = 0; i < n; i++) {
      const x = 0.12 + (i / (n - 1)) * 0.76;
      const dir = i % 2 === 0 ? 1 : -1;
      const vx = (Math.random() - 0.5) * 500;
      const vy = dir * (700 + Math.random() * 500);
      fluid.splat(x, 0.5 + dir * 0.04, vx, vy, null, 0.7);
    }
  }

  function updateText(dt) {
    const e = textEffect;
    if (!e) return;
    e.t += dt;
    if (e.t < 0.8) fluid.damp(Math.exp(-7 * dt), Math.exp(-4 * dt));
    const envelope = smoothstep(0.3, 0.85, e.t) * (1 - smoothstep(e.duration - 0.6, e.duration, e.t));
    if (envelope > 0) fluid.injectMask(e.texture, 1.3 * dt * envelope, e.colorA, e.colorB, 0.35 * envelope, simTime);
    if (!e.released && e.t >= e.duration - 0.35) {
      e.released = true;
      shatterText();
    }
    if (e.t >= e.duration) {
      gl.deleteTexture(e.texture);
      textEffect = null;
    }
  }

  function setPalette(id) {
    const next = PALETTES.find((p) => p.id === id);
    if (!next) return;
    palette = next;
    config.PALETTE = id;
    for (const em of emitters) em.target = paletteColor(palette);
    for (const p of pointers.values()) p.target = paletteColor(palette);
    ui.sync();
  }

  function setQuality(id) {
    if (!QUALITY[id]) return;
    config.QUALITY = id;
    Object.assign(config, pickQuality(id));
    fluid.initFramebuffers();
    ui.sync();
  }

  function togglePause() {
    config.PAUSED = !config.PAUSED;
    ui.sync();
    ui.toast(config.PAUSED ? 'Pause' : 'Lecture');
  }

  async function setMic(on) {
    if (!on) {
      audio.stop();
      config.MIC = false;
      ui.setMicLevel(null);
      return;
    }
    try {
      await audio.start();
      config.MIC = true;
      ui.toast('Micro activé — mettez de la musique !');
    } catch (err) {
      console.warn(err);
      config.MIC = false;
      ui.toast("Accès au micro refusé ou indisponible");
    }
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  }

  function saveCapture() {
    canvas.toBlob((blob) => {
      if (!blob) return;
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `fluide-${stamp}.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 4000);
      ui.toast('Capture enregistrée');
    }, 'image/png');
  }

  const ui = createUI(config, {
    async onToggle(key, value) {
      if (key === 'MIC') return setMic(value);
      config[key] = value;
    },
    onPalette: setPalette,
    onQuality: setQuality,
    onText: (text) => { writeText(text); },
    onAction(action) {
      if (action === 'burst') { explosion(); touch(); }
      else if (action === 'pause') togglePause();
      else if (action === 'clear') fluid.clear();
      else if (action === 'capture') captureRequested = true;
    },
  });

  /* Pointeurs : souris, stylet et multi-touch */

  function toUv(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / rect.width, y: 1 - (e.clientY - rect.top) / rect.height };
  }

  function createPointer(uv) {
    return {
      x: uv.x, y: uv.y,
      fx: uv.x, fy: uv.y,
      moved: false,
      down: false,
      color: paletteColor(palette),
      target: paletteColor(palette),
      colorTimer: 0,
    };
  }

  canvas.addEventListener('pointerdown', (e) => {
    const uv = toUv(e);
    const p = createPointer(uv);
    p.down = true;
    pointers.set(e.pointerId, p);
    canvas.setPointerCapture(e.pointerId);
    touch();
    const a = Math.random() * Math.PI * 2;
    fluid.splat(uv.x, uv.y, Math.cos(a) * 250, Math.sin(a) * 250, scaleColor(p.color, 4));
  });

  canvas.addEventListener('pointermove', (e) => {
    const uv = toUv(e);
    let p = pointers.get(e.pointerId);
    if (!p) {
      if (e.pointerType !== 'mouse') return;
      p = createPointer(uv);
      pointers.set(e.pointerId, p);
      return;
    }
    p.x = uv.x;
    p.y = uv.y;
    p.moved = true;
    if (p.down) touch();
  });

  const release = (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    p.down = false;
    if (e.pointerType !== 'mouse' || e.type === 'pointerleave') pointers.delete(e.pointerId);
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerleave', release);

  function applyPointers(dt) {
    for (const p of pointers.values()) {
      p.colorTimer += dt;
      if (p.colorTimer > 0.6) {
        p.colorTimer = 0;
        p.target = paletteColor(palette);
      }
      p.color = mixColor(p.color, p.target, Math.min(1, dt * 3));
      if (!p.moved) continue;
      p.moved = false;

      const ddx = p.x - p.fx;
      const ddy = p.y - p.fy;
      const steps = Math.min(6, Math.max(1, Math.ceil(Math.hypot(ddx, ddy) / 0.025)));
      const force = (config.SPLAT_FORCE * (p.down ? 1 : 0.45)) / steps;
      const color = scaleColor(p.color, (p.down ? 1 : 0.22) / steps);
      const vx = correctDeltaX(ddx) * force;
      const vy = correctDeltaY(ddy) * force;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        fluid.splat(p.fx + ddx * t, p.fy + ddy * t, vx, vy, color, p.down ? 1 : 0.7);
      }
      p.fx = p.x;
      p.fy = p.y;
    }
  }

  /* Mode ambiant : émetteurs sur des courbes de Lissajous */

  const emitters = [0, 1, 2].map((i) => ({
    phase: Math.random() * 100 + i * 2.1,
    fx: 0.21 + Math.random() * 0.2,
    fy: 0.17 + Math.random() * 0.2,
    color: paletteColor(palette),
    target: paletteColor(palette),
    timer: Math.random(),
    prev: null,
  }));

  function emitterPosition(em, t) {
    return {
      x: 0.5 + 0.36 * Math.sin(t * em.fx + em.phase) + 0.07 * Math.sin(t * em.fy * 2.3 + em.phase * 1.7),
      y: 0.5 + 0.31 * Math.sin(t * em.fy + em.phase * 0.5) + 0.06 * Math.cos(t * em.fx * 1.9 + em.phase),
    };
  }

  function applyAmbient(dt) {
    const audioLevel = config.MIC ? audio.level : 0;
    for (const em of emitters) {
      const pos = emitterPosition(em, simTime);
      const prev = em.prev || pos;
      em.prev = pos;
      em.timer += dt;
      if (em.timer > 1.4) {
        em.timer = 0;
        em.target = paletteColor(palette);
      }
      em.color = mixColor(em.color, em.target, Math.min(1, dt * 1.5));
      if (ambientWeight < 0.01) continue;

      let dx = correctDeltaX(pos.x - prev.x);
      let dy = correctDeltaY(pos.y - prev.y);
      const len = Math.hypot(dx, dy) || 1;
      const thrust = (2400 + audioLevel * 9000) * dt * ambientWeight;
      dx = (dx / len) * thrust;
      dy = (dy / len) * thrust;
      const dye = scaleColor(em.color, ambientWeight * (0.32 + audioLevel * 2.5));
      fluid.splat(pos.x, pos.y, dx, dy, dye, 0.55 + audioLevel * 1.5);
    }

    nextAmbientBurst -= dt;
    if (nextAmbientBurst <= 0) {
      nextAmbientBurst = 2.5 + Math.random() * 3.5;
      if (ambientWeight > 0.5) randomSplats(1 + Math.floor(Math.random() * 2));
    }
  }

  function updateAmbientWeight(dt) {
    const idle = clock() - lastInteraction > 3.5;
    const target = config.AMBIENT && idle && !textEffect ? 1 : 0;
    const speed = target > ambientWeight ? 0.5 : 3;
    ambientWeight += (target - ambientWeight) * Math.min(1, dt * speed);
  }

  /* Clavier */

  window.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t.matches && t.matches('input[type="text"], select, textarea')) {
      if (e.key === 'Escape') t.blur();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    switch (e.code) {
      case 'Space': e.preventDefault(); explosion(); touch(); break;
      case 'KeyP': togglePause(); break;
      case 'KeyH': ui.toggleHidden(); break;
      case 'KeyC': fluid.clear(); break;
      case 'KeyS': captureRequested = true; break;
      case 'KeyR': ui.togglePanel(); break;
      case 'KeyF': toggleFullscreen(); break;
      case 'KeyT': e.preventDefault(); ui.focusText(); break;
      default: {
        const match = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
        if (match && PALETTES[match[1] - 1]) setPalette(PALETTES[match[1] - 1].id);
      }
    }
  });

  /* Qualité adaptative : on descend d'un cran si la machine peine au démarrage */

  const perf = { frames: 0, time: 0, done: false };

  function trackPerformance(realDt, now) {
    if (perf.done || realDt > 0.25) return;
    if (now < 1.5) return;
    perf.frames++;
    perf.time += realDt;
    if (now < 4.5) return;
    perf.done = true;
    const fps = perf.frames / perf.time;
    const index = QUALITY_ORDER.indexOf(config.QUALITY);
    if (fps < 38 && index > 0) {
      setQuality(QUALITY_ORDER[index - 1]);
      ui.toast(`Qualité ajustée automatiquement : ${QUALITY[config.QUALITY].label}`);
    }
  }

  /* Boucle principale */

  const startTime = clock();
  let lastFrame = performance.now();
  let fpsFrames = 0;
  let fpsTime = 0;

  function frame(nowMs) {
    const realDt = Math.max(0, (nowMs - lastFrame) / 1000);
    lastFrame = nowMs;
    const dt = Math.min(realDt, 1 / 60);

    if (resizeCanvas()) fluid.initFramebuffers();

    audio.update(dt);
    updateAmbientWeight(dt);

    if (config.PAUSED) {
      for (const p of pointers.values()) {
        p.fx = p.x;
        p.fy = p.y;
        p.moved = false;
      }
    } else {
      applyPointers(dt);
      applyAmbient(dt);
      updateText(dt);
      if (audio.beat) {
        randomSplats(1 + Math.round(audio.bass * 3));
        if (audio.bass > 0.5) explosion();
      }
      fluid.step(dt);
      simTime += dt;
    }

    for (let i = 0; i < 3; i++) background[i] += (palette.background[i] - background[i]) * Math.min(1, dt * 2);
    fluid.render(nowMs / 1000, background, config.MIC ? audio.bass * 0.9 : 0);

    if (captureRequested) {
      captureRequested = false;
      saveCapture();
    }

    if (config.MIC) ui.setMicLevel(audio.level);
    trackPerformance(realDt, clock() - startTime);

    fpsFrames++;
    fpsTime += realDt;
    if (fpsTime >= 0.5) {
      ui.setFps(Math.round(fpsFrames / fpsTime), `${fluid.dye.width}×${fluid.dye.height}`);
      fpsFrames = 0;
      fpsTime = 0;
    }

    requestAnimationFrame(frame);
  }

  setPalette(PALETTES.some((p) => p.id === params.get('palette')) ? params.get('palette') : config.PALETTE);
  writeText(params.get('texte') || params.get('text') || 'Bonjour');
  requestAnimationFrame(frame);
})();
