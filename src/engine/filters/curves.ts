// Tone curves: monotone cubic (Fritsch–Carlson) interpolation, so curves never overshoot.
import type { Curves } from './types';

export const IDENTITY_CURVES = (): Curves => ({ rgb: [[0, 0], [1, 1]], r: [[0, 0], [1, 1]], g: [[0, 0], [1, 1]], b: [[0, 0], [1, 1]] });

/** 256 output values (0..1) for a curve through the given points. */
export function curveTable(points: [number, number][]): Float32Array {
  const pts = [...points].sort((a, b) => a[0] - b[0]);
  const out = new Float32Array(256);
  const n = pts.length;
  if (n === 0) {
    for (let i = 0; i < 256; i++) out[i] = i / 255;
    return out;
  }
  if (n === 1) return out.fill(pts[0][1]);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const d: number[] = [], m: number[] = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / Math.max(xs[i + 1] - xs[i], 1e-6));
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i], b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  for (let k = 0; k < 256; k++) {
    const x = k / 255;
    let y: number;
    if (x <= xs[0]) y = ys[0];
    else if (x >= xs[n - 1]) y = ys[n - 1];
    else {
      let i = 0;
      while (x > xs[i + 1]) i++;
      const h = xs[i + 1] - xs[i];
      const t = (x - xs[i]) / h;
      const t2 = t * t, t3 = t2 * t;
      y = (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
    }
    out[k] = Math.min(1, Math.max(0, y));
  }
  return out;
}

/** RGBA8 lookup texture data: each channel = channel curve applied after the master curve. */
export function curvesLut(c: Curves): Uint8Array {
  const master = curveTable(c.rgb);
  const ch = [curveTable(c.r), curveTable(c.g), curveTable(c.b)];
  const out = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const m = Math.round(master[i] * 255);
    for (let k = 0; k < 3; k++) out[i * 4 + k] = Math.round(ch[k][m] * 255);
    out[i * 4 + 3] = 255;
  }
  return out;
}
