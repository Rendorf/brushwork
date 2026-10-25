// Procedurally generated brush tips and paper grains (8-bit masks).
import { rng } from '../util/geom';

export const TIP_IDS = ['round', 'chalk', 'pencil', 'flat', 'bristle', 'splatter', 'star', 'heart', 'leaf', 'sparkle', 'cloud', 'square'] as const;
export type TipId = (typeof TIP_IDS)[number];

export const GRAIN_IDS = ['paper', 'canvas', 'rough'] as const;
export type GrainId = (typeof GRAIN_IDS)[number];

export interface Mask {
  w: number;
  h: number;
  data: Uint8Array;
}

const TIP = 128;

function maskFromCanvas(draw: (ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, s: number) => void, s = TIP): Mask {
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(s, s) : Object.assign(document.createElement('canvas'), { width: s, height: s });
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, s, s);
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';
  draw(ctx, s);
  const img = ctx.getImageData(0, 0, s, s).data;
  const data = new Uint8Array(s * s);
  for (let i = 0; i < s * s; i++) data[i] = img[i * 4 + 3];
  return { w: s, h: s, data };
}

function fieldMask(f: (u: number, v: number) => number, s = TIP): Mask {
  const data = new Uint8Array(s * s);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const u = (x + 0.5) / s - 0.5;
      const v = (y + 0.5) / s - 0.5;
      data[y * s + x] = Math.round(Math.max(0, Math.min(1, f(u, v))) * 255);
    }
  }
  return { w: s, h: s, data };
}

/** Tileable value noise in [0, 1). */
function valueNoise(size: number, cells: number, seed: number): Float32Array {
  const r = rng(seed);
  const lattice = new Float32Array(cells * cells).map(() => r());
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells;
      const fy = (y / size) * cells;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = fx - x0, ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const at = (i: number, j: number) => lattice[((j % cells) * cells) + (i % cells)];
      const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
      out[y * size + x] = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    }
  }
  return out;
}

function fbm(size: number, seed: number, octaves: [number, number][]): Float32Array {
  const out = new Float32Array(size * size);
  let total = 0;
  octaves.forEach(([cells, weight], i) => {
    const n = valueNoise(size, cells, seed + i * 101);
    for (let k = 0; k < out.length; k++) out[k] += n[k] * weight;
    total += weight;
  });
  for (let k = 0; k < out.length; k++) out[k] /= total;
  return out;
}

export function makeTip(id: TipId): Mask {
  switch (id) {
    case 'round':
      return fieldMask((u, v) => 1 - smooth(0.45, 0.5, Math.hypot(u, v)));
    case 'square':
      return fieldMask((u, v) => (Math.abs(u) < 0.47 && Math.abs(v) < 0.47 ? 1 : 0));
    case 'chalk': {
      const n = fbm(TIP, 11, [[32, 0.6], [64, 0.4]]);
      return fieldMask((u, v) => {
        const r = Math.hypot(u, v) * 2;
        const x = Math.floor((u + 0.5) * TIP), y = Math.floor((v + 0.5) * TIP);
        const g = n[Math.min(TIP - 1, y) * TIP + Math.min(TIP - 1, x)];
        return (1 - smooth(0.6, 1, r)) * smooth(0.35, 0.65, g + (1 - r) * 0.25);
      });
    }
    case 'pencil': {
      const n = fbm(TIP, 23, [[48, 0.5], [128, 0.5]]);
      return fieldMask((u, v) => {
        const r = Math.hypot(u, v) * 2;
        const x = Math.floor((u + 0.5) * TIP), y = Math.floor((v + 0.5) * TIP);
        const g = n[Math.min(TIP - 1, y) * TIP + Math.min(TIP - 1, x)];
        return (1 - smooth(0.7, 1, r)) * (0.45 + 0.55 * smooth(0.3, 0.7, g));
      });
    }
    case 'flat': {
      // Narrow along x (stroke direction when following), long along y, with bristle streaks.
      const r = rng(5);
      const streaks = Array.from({ length: TIP }, () => 0.6 + 0.4 * r());
      return fieldMask((u, v) => {
        const edgeX = 1 - smooth(0.12, 0.2, Math.abs(u));
        const edgeY = 1 - smooth(0.42, 0.5, Math.abs(v));
        const yi = Math.min(TIP - 1, Math.floor((v + 0.5) * TIP));
        return edgeX * edgeY * streaks[yi];
      });
    }
    case 'bristle':
      return maskFromCanvas((ctx, s) => {
        const r = rng(7);
        for (let i = 0; i < 70; i++) {
          const a = r() * Math.PI * 2;
          const d = Math.sqrt(r()) * s * 0.42;
          ctx.globalAlpha = 0.5 + 0.5 * r();
          ctx.beginPath();
          ctx.arc(s / 2 + Math.cos(a) * d, s / 2 + Math.sin(a) * d, s * (0.02 + 0.04 * r()), 0, Math.PI * 2);
          ctx.fill();
        }
      });
    case 'splatter':
      return maskFromCanvas((ctx, s) => {
        const r = rng(9);
        for (let i = 0; i < 40; i++) {
          const a = r() * Math.PI * 2;
          const d = Math.pow(r(), 0.7) * s * 0.42;
          ctx.beginPath();
          ctx.arc(s / 2 + Math.cos(a) * d, s / 2 + Math.sin(a) * d, s * (0.01 + 0.07 * r() * (1 - d / s)), 0, Math.PI * 2);
          ctx.fill();
        }
      });
    case 'star':
      return maskFromCanvas((ctx, s) => {
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
          const a = -Math.PI / 2 + (i * Math.PI) / 5;
          const rr = i % 2 === 0 ? s * 0.48 : s * 0.2;
          ctx.lineTo(s / 2 + Math.cos(a) * rr, s / 2 + Math.sin(a) * rr);
        }
        ctx.closePath();
        ctx.fill();
      });
    case 'heart':
      return maskFromCanvas((ctx, s) => {
        ctx.beginPath();
        for (let i = 0; i <= 100; i++) {
          const t = (i / 100) * Math.PI * 2;
          const x = 16 * Math.pow(Math.sin(t), 3);
          const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
          ctx.lineTo(s / 2 + (x / 34) * s, s / 2 + (y / 34) * s - s * 0.02);
        }
        ctx.closePath();
        ctx.fill();
      });
    case 'leaf':
      return maskFromCanvas((ctx, s) => {
        ctx.beginPath();
        ctx.moveTo(s * 0.04, s / 2);
        ctx.quadraticCurveTo(s * 0.5, s * 0.08, s * 0.96, s / 2);
        ctx.quadraticCurveTo(s * 0.5, s * 0.92, s * 0.04, s / 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.lineWidth = s * 0.025;
        ctx.beginPath();
        ctx.moveTo(s * 0.1, s / 2);
        ctx.lineTo(s * 0.9, s / 2);
        ctx.stroke();
      });
    case 'sparkle':
      return fieldMask((u, v) => {
        const r = Math.hypot(u, v) * 2;
        const ax = Math.abs(u) * 2, ay = Math.abs(v) * 2;
        const rays = Math.max(Math.exp(-ay * 30) * (1 - ax), Math.exp(-ax * 30) * (1 - ay));
        return Math.min(1, rays + Math.exp(-r * r * 30) * 0.9);
      });
    case 'cloud':
      return maskFromCanvas((ctx, s) => {
        const r = rng(13);
        ctx.filter = `blur(${s * 0.04}px)`;
        for (let i = 0; i < 9; i++) {
          const a = r() * Math.PI * 2;
          const d = r() * s * 0.2;
          ctx.globalAlpha = 0.5;
          ctx.beginPath();
          ctx.arc(s / 2 + Math.cos(a) * d, s / 2 + Math.sin(a) * d, s * (0.12 + 0.1 * r()), 0, Math.PI * 2);
          ctx.fill();
        }
      });
  }
}

export function makeGrain(id: GrainId): Mask {
  const s = 256;
  let f: Float32Array;
  if (id === 'paper') f = fbm(s, 31, [[16, 0.25], [32, 0.3], [64, 0.25], [128, 0.2]]);
  else if (id === 'rough') f = fbm(s, 41, [[64, 0.4], [128, 0.6]]);
  else {
    const n = fbm(s, 51, [[64, 0.5], [128, 0.5]]);
    f = new Float32Array(s * s);
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const weave = 0.5 + 0.25 * Math.sin((x / s) * Math.PI * 2 * 32) * Math.sin((y / s) * Math.PI * 2 * 32);
        f[y * s + x] = weave * 0.6 + n[y * s + x] * 0.4;
      }
    }
  }
  // Normalize contrast so grains feel similar in strength.
  let lo = Infinity, hi = -Infinity;
  for (const v of f) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const data = new Uint8Array(s * s);
  for (let i = 0; i < f.length; i++) data[i] = Math.round(((f[i] - lo) / Math.max(hi - lo, 1e-6)) * 255);
  return { w: s, h: s, data };
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
