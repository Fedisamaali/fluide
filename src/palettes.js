'use strict';

const PALETTES = [
  {
    id: 'aurore',
    name: 'Aurore',
    ranges: [[0.33, 0.52], [0.72, 0.86]],
    saturation: [0.7, 1],
    background: [0.006, 0.01, 0.022],
    swatch: ['#2bff88', '#21d4fd', '#b721ff'],
  },
  {
    id: 'neon',
    name: 'Néon',
    ranges: [[0.49, 0.56], [0.82, 0.95]],
    saturation: [0.85, 1],
    background: [0.012, 0.004, 0.02],
    swatch: ['#00f0ff', '#ff2bd6', '#7a00ff'],
  },
  {
    id: 'lave',
    name: 'Lave',
    ranges: [[0.98, 1], [0, 0.14]],
    saturation: [0.85, 1],
    background: [0.02, 0.006, 0.004],
    swatch: ['#ff2a00', '#ff8a00', '#ffd000'],
  },
  {
    id: 'ocean',
    name: 'Océan',
    ranges: [[0.47, 0.67]],
    saturation: [0.6, 1],
    background: [0.002, 0.01, 0.02],
    swatch: ['#00ffd5', '#0090ff', '#2340ff'],
  },
  {
    id: 'or',
    name: 'Or',
    ranges: [[0.08, 0.14]],
    saturation: [0.25, 0.85],
    background: [0.012, 0.009, 0.004],
    swatch: ['#fff1c1', '#ffc94a', '#c8860a'],
  },
  {
    id: 'spectre',
    name: 'Spectre',
    ranges: [[0, 1]],
    saturation: [0.9, 1],
    background: [0.008, 0.008, 0.012],
    swatch: ['#ff004c', '#ffe600', '#00ff9d', '#0066ff'],
  },
];

function hsvToRgb(h, s, v) {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (((i % 6) + 6) % 6) {
    case 0: return { r: v, g: t, b: p };
    case 1: return { r: q, g: v, b: p };
    case 2: return { r: p, g: v, b: t };
    case 3: return { r: p, g: q, b: v };
    case 4: return { r: t, g: p, b: v };
    default: return { r: v, g: p, b: q };
  }
}

function paletteColor(palette, intensity = 0.15) {
  const range = palette.ranges[Math.floor(Math.random() * palette.ranges.length)];
  const hue = range[0] + Math.random() * (range[1] - range[0]);
  const [sMin, sMax] = palette.saturation;
  const sat = sMin + Math.random() * (sMax - sMin);
  const c = hsvToRgb(((hue % 1) + 1) % 1, sat, 1);
  return { r: c.r * intensity, g: c.g * intensity, b: c.b * intensity };
}

function scaleColor(color, k) {
  return { r: color.r * k, g: color.g * k, b: color.b * k };
}

function mixColor(a, b, t) {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}
