// Blend modes shared by layers, brushes and the compositor.
// The order of this list is the index used by the GLSL code in shaders/blend.ts.

export const BLEND_MODES = [
  { id: 'normal', label: 'Normal', psd: 'normal' },
  { id: 'multiply', label: 'Multiply', psd: 'multiply' },
  { id: 'screen', label: 'Screen', psd: 'screen' },
  { id: 'overlay', label: 'Overlay', psd: 'overlay' },
  { id: 'darken', label: 'Darken', psd: 'darken' },
  { id: 'lighten', label: 'Lighten', psd: 'lighten' },
  { id: 'colorDodge', label: 'Color Dodge', psd: 'color dodge' },
  { id: 'colorBurn', label: 'Color Burn', psd: 'color burn' },
  { id: 'hardLight', label: 'Hard Light', psd: 'hard light' },
  { id: 'softLight', label: 'Soft Light', psd: 'soft light' },
  { id: 'difference', label: 'Difference', psd: 'difference' },
  { id: 'exclusion', label: 'Exclusion', psd: 'exclusion' },
  { id: 'hue', label: 'Hue', psd: 'hue' },
  { id: 'saturation', label: 'Saturation', psd: 'saturation' },
  { id: 'color', label: 'Color', psd: 'color' },
  { id: 'luminosity', label: 'Luminosity', psd: 'luminosity' },
  { id: 'linearBurn', label: 'Linear Burn', psd: 'linear burn' },
  { id: 'linearDodge', label: 'Add (Linear Dodge)', psd: 'linear dodge' },
  { id: 'linearLight', label: 'Linear Light', psd: 'linear light' },
  { id: 'vividLight', label: 'Vivid Light', psd: 'vivid light' },
  { id: 'pinLight', label: 'Pin Light', psd: 'pin light' },
  { id: 'hardMix', label: 'Hard Mix', psd: 'hard mix' },
  { id: 'subtract', label: 'Subtract', psd: 'subtract' },
  { id: 'divide', label: 'Divide', psd: 'divide' },
  { id: 'darkerColor', label: 'Darker Color', psd: 'darker color' },
  { id: 'lighterColor', label: 'Lighter Color', psd: 'lighter color' },
  { id: 'addGlow', label: 'Add (Glow)', psd: 'linear dodge' },
  { id: 'colorDodgeGlow', label: 'Color Dodge (Glow)', psd: 'color dodge' },
] as const;

export type BlendMode = (typeof BLEND_MODES)[number]['id'];
export type FolderBlendMode = BlendMode | 'passthrough';

/** Merge-only operations, outside the blend-mode index range. */
export const OP_ERASE = 100;
export const OP_REPLACE = 101;

const INDEX = new Map<string, number>(BLEND_MODES.map((m, i) => [m.id, i]));

export function blendIndex(mode: BlendMode): number {
  return INDEX.get(mode) ?? 0;
}

export function blendLabel(mode: FolderBlendMode): string {
  if (mode === 'passthrough') return 'Pass Through';
  return BLEND_MODES[blendIndex(mode)].label;
}

export function blendToPsd(mode: FolderBlendMode): string {
  if (mode === 'passthrough') return 'pass through';
  return BLEND_MODES[blendIndex(mode)].psd;
}

export function blendFromPsd(key: string | undefined): FolderBlendMode {
  if (!key || key === 'normal') return 'normal';
  if (key === 'pass through') return 'passthrough';
  const found = BLEND_MODES.find((m) => m.psd === key);
  return found ? found.id : 'normal';
}

// ---------------------------------------------------------------------------
// CPU reference implementation. It mirrors shaders/blend.ts exactly and is
// used by unit tests and the GPU-vs-CPU pixel tests.

type RGB = [number, number, number];

const lum = (c: RGB) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];

function clipColor(c: RGB): RGB {
  const l = lum(c);
  const n = Math.min(c[0], c[1], c[2]);
  const x = Math.max(c[0], c[1], c[2]);
  let out: RGB = [...c];
  if (n < 0) out = out.map((v) => l + ((v - l) * l) / Math.max(l - n, 1e-6)) as RGB;
  if (x > 1) out = out.map((v) => l + ((v - l) * (1 - l)) / Math.max(x - l, 1e-6)) as RGB;
  return out;
}

const setLum = (c: RGB, l: number): RGB => {
  const d = l - lum(c);
  return clipColor([c[0] + d, c[1] + d, c[2] + d]);
};

const sat = (c: RGB) => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);

function setSat(c: RGB, s: number): RGB {
  const mx = Math.max(c[0], c[1], c[2]);
  const mn = Math.min(c[0], c[1], c[2]);
  if (mx > mn) return c.map((v) => ((v - mn) * s) / (mx - mn)) as RGB;
  return [0, 0, 0];
}

function colorDodge(b: number, s: number) {
  if (b <= 0) return 0;
  if (s >= 1) return 1;
  return Math.min(1, b / (1 - s));
}
function colorBurn(b: number, s: number) {
  if (b >= 1) return 1;
  if (s <= 0) return 0;
  return 1 - Math.min(1, (1 - b) / s);
}
function hardLight(b: number, s: number) {
  return s <= 0.5 ? b * 2 * s : b + (2 * s - 1) - b * (2 * s - 1);
}
function softLight(b: number, s: number) {
  if (s <= 0.5) return b - (1 - 2 * s) * b * (1 - b);
  const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b);
  return b + (2 * s - 1) * (d - b);
}

function separable(b: number, s: number, m: number): number {
  switch (m) {
    case 1: return b * s;
    case 2: return b + s - b * s;
    case 3: return hardLight(s, b);
    case 4: return Math.min(b, s);
    case 5: return Math.max(b, s);
    case 6: return colorDodge(b, s);
    case 7: return colorBurn(b, s);
    case 8: return hardLight(b, s);
    case 9: return softLight(b, s);
    case 10: return Math.abs(b - s);
    case 11: return b + s - 2 * b * s;
    case 16: return Math.max(b + s - 1, 0);
    case 17: return Math.min(b + s, 1);
    case 18: return Math.min(Math.max(b + 2 * s - 1, 0), 1);
    case 19: return s <= 0.5 ? colorBurn(b, 2 * s) : colorDodge(b, 2 * (s - 0.5));
    case 20: return s <= 0.5 ? Math.min(b, 2 * s) : Math.max(b, 2 * s - 1);
    case 21: return b + s >= 1 ? 1 : 0;
    case 22: return Math.max(b - s, 0);
    case 23: return s <= 0 ? (b <= 0 ? 0 : 1) : Math.min(b / s, 1);
    default: return s;
  }
}

/** B(cb, cs) from the W3C compositing spec, on unpremultiplied colors. */
export function blendRGB(cb: RGB, cs: RGB, m: number): RGB {
  switch (m) {
    case 12: return setLum(setSat(cs, sat(cb)), lum(cb));
    case 13: return setLum(setSat(cb, sat(cs)), lum(cb));
    case 14: return setLum(cs, lum(cb));
    case 15: return setLum(cb, lum(cs));
    case 24: return lum(cs) < lum(cb) ? cs : cb;
    case 25: return lum(cs) > lum(cb) ? cs : cb;
    default: return [separable(cb[0], cs[0], m), separable(cb[1], cs[1], m), separable(cb[2], cs[2], m)];
  }
}

export type RGBA = [number, number, number, number];

/**
 * Composite premultiplied source `s` over premultiplied backdrop `b` (0..1 floats).
 * `atop` keeps the backdrop alpha (clipping groups and alpha lock).
 */
export function blendPremul(b: RGBA, s: RGBA, m: number, atop = false): RGBA {
  const ab = b[3];
  const as = s[3];
  if (m === OP_ERASE) {
    if (atop) return [...b];
    return [b[0] * (1 - as), b[1] * (1 - as), b[2] * (1 - as), b[3] * (1 - as)];
  }
  if (m === OP_REPLACE) return [...s];
  if (m === 26) {
    const a = atop ? ab : as + ab * (1 - as);
    const rgb = [0, 1, 2].map((i) => Math.min(b[i] + s[i], a));
    return [rgb[0], rgb[1], rgb[2], a];
  }
  const cb: RGB = ab > 0 ? [b[0] / ab, b[1] / ab, b[2] / ab] : [0, 0, 0];
  const cs: RGB = as > 0 ? [s[0] / as, s[1] / as, s[2] / as] : [0, 0, 0];
  let B: RGB;
  if (m === 27) {
    B = [0, 1, 2].map((i) => (cb[i] <= 0 ? 0 : Math.min(1, cb[i] / Math.max(1 - cs[i] * as, 1e-6)))) as RGB;
  } else if (m === 0) {
    B = cs;
  } else {
    B = blendRGB(cb, cs, m);
  }
  const out: RGBA = [0, 0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const bc = Math.min(Math.max(B[i], 0), 1);
    out[i] = (atop ? 0 : s[i] * (1 - ab)) + b[i] * (1 - as) + as * ab * bc;
  }
  out[3] = atop ? ab : as + ab * (1 - as);
  return out;
}
