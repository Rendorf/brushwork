export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const emptyRect = (): Rect => ({ x: 0, y: 0, w: 0, h: 0 });
export const isEmpty = (r: Rect | null | undefined): boolean => !r || r.w <= 0 || r.h <= 0;

export function union(a: Rect | null, b: Rect | null): Rect | null {
  if (isEmpty(a)) return isEmpty(b) ? null : { ...b! };
  if (isEmpty(b)) return { ...a! };
  const x0 = Math.min(a!.x, b!.x);
  const y0 = Math.min(a!.y, b!.y);
  const x1 = Math.max(a!.x + a!.w, b!.x + b!.w);
  const y1 = Math.max(a!.y + a!.h, b!.y + b!.h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function intersect(a: Rect, b: Rect): Rect | null {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Expand to integer pixel bounds. */
export function roundOut(r: Rect): Rect {
  const x0 = Math.floor(r.x);
  const y0 = Math.floor(r.y);
  const x1 = Math.ceil(r.x + r.w);
  const y1 = Math.ceil(r.y + r.h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function clampToDoc(r: Rect | null, w: number, h: number): Rect | null {
  if (!r) return null;
  return intersect(roundOut(r), { x: 0, y: 0, w, h });
}

export function rectFromPoints(pts: { x: number; y: number }[], pad = 0): Rect | null {
  if (!pts.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
}

/** 2D affine matrix [a, b, c, d, e, f]: x' = a*x + c*y + e, y' = b*x + d*y + f. */
export type Mat2D = [number, number, number, number, number, number];

export const identity = (): Mat2D => [1, 0, 0, 1, 0, 0];

export function multiply(m: Mat2D, n: Mat2D): Mat2D {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function invert(m: Mat2D): Mat2D {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) return identity();
  const id = 1 / det;
  return [
    m[3] * id,
    -m[1] * id,
    -m[2] * id,
    m[0] * id,
    (m[2] * m[5] - m[3] * m[4]) * id,
    (m[1] * m[4] - m[0] * m[5]) * id,
  ];
}

export function apply(m: Mat2D, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

export const translate = (x: number, y: number): Mat2D => [1, 0, 0, 1, x, y];
export const scale = (sx: number, sy = sx): Mat2D => [sx, 0, 0, sy, 0, 0];
export const rotate = (a: number): Mat2D => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, s, -s, c, 0, 0];
};

/** Column-major 3x3 for GLSL uniforms. */
export function toMat3(m: Mat2D): Float32Array {
  return new Float32Array([m[0], m[1], 0, m[2], m[3], 0, m[4], m[5], 1]);
}

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(bx - ax, by - ay);

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let idCounter = 0;
export function uid(prefix = 'id'): string {
  idCounter++;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}
