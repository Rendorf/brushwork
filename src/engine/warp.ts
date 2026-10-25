// Geometry for distort (4-corner perspective) and mesh warps.
import type { P } from './guides';

/** Row-major 3x3 matrix. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

/**
 * Projective map from the unit square to a quad. Corner order: (0,0) → q[0], (1,0) → q[1],
 * (1,1) → q[2], (0,1) → q[3]. (Heckbert, "Fundamentals of Texture Mapping".)
 */
export function squareToQuad(q: P[]): Mat3 {
  const [p0, p1, p2, p3] = q;
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y;
  let g = 0, h = 0;
  if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) {
    const den = dx1 * dy2 - dx2 * dy1;
    g = (dx3 * dy2 - dx2 * dy3) / den;
    h = (dx1 * dy3 - dx3 * dy1) / den;
  }
  return [
    p1.x - p0.x + g * p1.x, p3.x - p0.x + h * p3.x, p0.x,
    p1.y - p0.y + g * p1.y, p3.y - p0.y + h * p3.y, p0.y,
    g, h, 1,
  ];
}

export function applyMat3(m: Mat3, x: number, y: number): P {
  const w = m[6] * x + m[7] * y + m[8];
  return { x: (m[0] * x + m[1] * y + m[2]) / w, y: (m[3] * x + m[4] * y + m[5]) / w };
}

export function invertMat3(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const k = 1 / det;
  return [
    A * k, -(b * i - c * h) * k, (b * f - c * e) * k,
    B * k, (a * i - c * g) * k, -(a * f - c * d) * k,
    C * k, -(a * h - b * g) * k, (a * e - b * d) * k,
  ];
}

/** Column-major Float32Array for a GLSL mat3 uniform. */
export function mat3ToGL(m: Mat3): Float32Array {
  return new Float32Array([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]);
}

/** Is the quad convex and not folded (needed for a valid perspective map)? */
export function isConvexQuad(q: P[]): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-9) return false;
    const s = Math.sign(cross);
    if (sign && s !== sign) return false;
    sign = s;
  }
  return true;
}

// --- mesh ----------------------------------------------------------------------

export interface Mesh {
  /** Cells per side; control points are (n+1) x (n+1), row-major from the top-left. */
  n: number;
  pts: P[];
}

function cr(p0: number, p1: number, p2: number, p3: number, f: number): number {
  return 0.5 * (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f);
}

/** Catmull-Rom through points[0..n] at t in [0, n], with reflected end points. */
function spline(pts: P[], t: number): P {
  const n = pts.length - 1;
  const k = Math.min(n - 1, Math.max(0, Math.floor(t)));
  const f = t - k;
  const at = (i: number): P => {
    if (i < 0) return { x: 2 * pts[0].x - pts[1].x, y: 2 * pts[0].y - pts[1].y };
    if (i > n) return { x: 2 * pts[n].x - pts[n - 1].x, y: 2 * pts[n].y - pts[n - 1].y };
    return pts[i];
  };
  const a = at(k - 1), b = at(k), c = at(k + 1), d = at(k + 2);
  return { x: cr(a.x, b.x, c.x, d.x, f), y: cr(a.y, b.y, c.y, d.y, f) };
}

/** Point on the smooth mesh surface at (u, v) in [0, 1]. */
export function meshPoint(m: Mesh, u: number, v: number): P {
  const n = m.n;
  const col: P[] = [];
  for (let i = 0; i <= n; i++) col.push(spline(m.pts.slice(i * (n + 1), (i + 1) * (n + 1)), u * n));
  return spline(col, v * n);
}

/** A regular mesh whose points come from a mapping of the unit square. */
export function meshFrom(n: number, map: (u: number, v: number) => P): Mesh {
  const pts: P[] = [];
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) pts.push(map(j / n, i / n));
  return { n, pts };
}

/** Dense triangle mesh (x, y, u, v per vertex) for rendering a warp. */
export function denseMesh(m: Mesh, density = Math.min(64, Math.max(16, m.n * 10))): { verts: Float32Array; indices: Uint32Array } {
  const M = density;
  const verts = new Float32Array((M + 1) * (M + 1) * 4);
  // Evaluate rows of the control grid once per u, then splines along v.
  const n = m.n;
  const rows: P[][] = [];
  for (let i = 0; i <= n; i++) rows.push(m.pts.slice(i * (n + 1), (i + 1) * (n + 1)));
  let o = 0;
  const colsAtU: P[][] = [];
  for (let x = 0; x <= M; x++) colsAtU.push(rows.map((r) => spline(r, (x / M) * n)));
  for (let y = 0; y <= M; y++) {
    for (let x = 0; x <= M; x++) {
      const p = spline(colsAtU[x], (y / M) * n);
      verts[o++] = p.x;
      verts[o++] = p.y;
      verts[o++] = x / M;
      verts[o++] = y / M;
    }
  }
  const indices = new Uint32Array(M * M * 6);
  let k = 0;
  for (let y = 0; y < M; y++) {
    for (let x = 0; x < M; x++) {
      const i = y * (M + 1) + x;
      indices[k++] = i;
      indices[k++] = i + 1;
      indices[k++] = i + M + 2;
      indices[k++] = i;
      indices[k++] = i + M + 2;
      indices[k++] = i + M + 1;
    }
  }
  return { verts, indices };
}
