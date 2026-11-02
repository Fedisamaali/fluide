'use strict';

const SLIDERS = {
  physics: [
    { key: 'CURL', label: 'Tourbillons', min: 0, max: 60, step: 1 },
    { key: 'VELOCITY_DISSIPATION', label: 'Amortissement', min: 0, max: 4, step: 0.05 },
    { key: 'DENSITY_DISSIPATION', label: "Dissipation de l'encre", min: 0, max: 4, step: 0.05 },
    { key: 'PRESSURE', label: 'Pression', min: 0, max: 1, step: 0.01 },
    { key: 'SPLAT_RADIUS', label: 'Taille du pinceau', min: 0.05, max: 1, step: 0.01 },
  ],
  render: [
    { key: 'BLOOM_INTENSITY', label: 'Halo lumineux', min: 0, max: 2, step: 0.05 },
    { key: 'EXPOSURE', label: 'Exposition', min: 0.4, max: 3, step: 0.05 },
  ],
};

const TOGGLES = {
  'render-toggles': [
    { key: 'SHADING', label: 'Relief' },
    { key: 'BLOOM', label: 'Bloom' },
  ],
  'interaction-toggles': [
    { key: 'AMBIENT', label: 'Mode ambiant' },
    { key: 'MIC', label: 'Réactif au son (micro)' },
  ],
};

function createUI(config, handlers) {
  const $ = (id) => document.getElementById(id);
  const panel = $('panel');
  const panelButton = $('toggle-panel');
  const textInput = $('text-input');
  const syncers = [];

  const decimals = (step) => (String(step).split('.')[1] || '').length;

  for (const [containerId, defs] of Object.entries(SLIDERS)) {
    const root = $(containerId);
    for (const def of defs) {
      const row = document.createElement('label');
      row.className = 'slider';
      row.innerHTML = `<span class="slider-head"><span>${def.label}</span><output></output></span>
        <input type="range" min="${def.min}" max="${def.max}" step="${def.step}">`;
      const input = row.querySelector('input');
      const output = row.querySelector('output');
      const paint = () => {
        const pct = ((input.value - def.min) / (def.max - def.min)) * 100;
        input.style.setProperty('--p', `${pct}%`);
        output.textContent = Number(input.value).toFixed(decimals(def.step));
      };
      input.addEventListener('input', () => {
        config[def.key] = parseFloat(input.value);
        paint();
      });
      syncers.push(() => {
        input.value = config[def.key];
        paint();
      });
      root.appendChild(row);
    }
  }

  for (const [containerId, defs] of Object.entries(TOGGLES)) {
    const root = $(containerId);
    for (const def of defs) {
      const row = document.createElement('label');
      row.className = 'switch';
      row.innerHTML = `<input type="checkbox"><span class="track"><span class="thumb"></span></span><span>${def.label}</span>`;
      const input = row.querySelector('input');
      input.addEventListener('change', async () => {
        await handlers.onToggle(def.key, input.checked);
        input.checked = !!config[def.key];
      });
      syncers.push(() => { input.checked = !!config[def.key]; });
      root.appendChild(row);
    }
  }

  const paletteRoot = $('palettes');
  const chips = PALETTES.map((palette, i) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.title = `${palette.name} (${i + 1})`;
    chip.style.setProperty('--swatch', `linear-gradient(135deg, ${palette.swatch.join(', ')})`);
    chip.innerHTML = `<span class="dot"></span>${palette.name}`;
    chip.addEventListener('click', () => handlers.onPalette(palette.id));
    paletteRoot.appendChild(chip);
    return chip;
  });
  syncers.push(() => {
    PALETTES.forEach((palette, i) => chips[i].classList.toggle('active', palette.id === config.PALETTE));
    const active = PALETTES.find((p) => p.id === config.PALETTE);
    const root = document.documentElement.style;
    root.setProperty('--accent', `linear-gradient(135deg, ${active.swatch.join(', ')})`);
    root.setProperty('--accent-solid', active.swatch[Math.min(1, active.swatch.length - 1)]);
  });

  const quality = $('quality');
  quality.addEventListener('change', () => handlers.onQuality(quality.value));
  syncers.push(() => { quality.value = config.QUALITY; });

  const pauseButton = $('pause-btn');
  syncers.push(() => { pauseButton.textContent = config.PAUSED ? 'Reprendre' : 'Pause'; });

  panel.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', () => handlers.onAction(button.dataset.action));
  });

  $('text-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const value = textInput.value.trim();
    if (!value) {
      textInput.focus();
      return;
    }
    handlers.onText(value);
    textInput.blur();
  });

  // Keep keyboard shortcuts working after clicking controls, except while typing.
  panel.addEventListener('pointerup', () => {
    setTimeout(() => {
      const el = document.activeElement;
      if (el && el !== textInput && el.tagName !== 'SELECT') el.blur();
    }, 0);
  });

  function setPanelOpen(open) {
    panel.classList.toggle('open', open);
    panelButton.setAttribute('aria-expanded', String(open));
  }
  panelButton.addEventListener('click', () => setPanelOpen(!panel.classList.contains('open')));

  const hint = $('hint');
  setTimeout(() => hint.classList.add('dim'), 9000);

  const toastEl = $('toast');
  let toastTimer = 0;
  const fpsEl = $('fps');
  const micMeter = $('mic-meter');
  const micBar = micMeter.querySelector('span');

  const ui = {
    sync() { syncers.forEach((fn) => fn()); },
    togglePanel() { setPanelOpen(!panel.classList.contains('open')); },
    toggleHidden() { document.body.classList.toggle('hide-ui'); },
    focusText() {
      setPanelOpen(true);
      document.body.classList.remove('hide-ui');
      textInput.focus();
      textInput.select();
    },
    toast(message) {
      toastEl.textContent = message;
      toastEl.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2400);
    },
    setFps(fps, label) { fpsEl.textContent = `${fps} ips · ${label}`; },
    setMicLevel(level) {
      micMeter.hidden = level == null;
      if (level != null) micBar.style.width = `${Math.min(100, level * 260)}%`;
    },
  };

  ui.sync();
  return ui;
}
