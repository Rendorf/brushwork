// Drawing aids: rulers that constrain strokes, symmetry that repeats them, and a grid.
import type { Dab } from './brush/stroke';
import { apply, multiply, rotate, translate, type Mat2D } from './util/geom';

export interface P {
  x: number;
  y: number;
}

export type Ruler =
  | { kind: 'line'; a: P; b: P }
  | { kind: 'ellipse'; c: P; rx: number; ry: number; rot: number; circle: boolean }
  | { kind: 'radial'; c: P }
  | { kind: 'perspective'; vps: P[] };

export type RulerKind = Ruler['kind'];

export type SymmetryKind = 'mirror' | 'kaleidoscope' | 'rotation';

export interface Symmetry {
  kind: SymmetryKind;
  c: P;
  /** Mirror axis direction (radians) / starting angle of the segments. */
  angle: number;
  /** Segments for kaleidoscope and rotation. */
  n: number;
}

export interface Guides {
  ruler: Ruler | null;
  rulerOn: boolean;
  symmetry: Symmetry | null;
  symmetryOn: boolean;
  gridOn: boolean;
  gridSize: number;
}

export const defaultGuides = (): Guides => ({ ruler: null, rulerOn: true, symmetry: null, symmetryOn: true, gridOn: false, gridSize: 100 });

const sub = (a: P, b: P): P => ({ x: a.x - b.x, y: a.y - b.y });
const len = (a: P) => Math.hypot(a.x, a.y);
const norm = (a: P): P => {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l };
};
const dot = (a: P, b: P) => a.x * b.x + a.y * b.y;

interface Line {
  o: P;
  d: P;
}

const onLine = (p: P, l: Line): P => {
  const t = dot(sub(p, l.o), l.d);
  return { x: l.o.x + l.d.x * t, y: l.o.y + l.d.y * t };
};

/** Make a ruler with sensible defaults around a document point. */
export function makeRuler(kind: RulerKind, c: P, size: number, vpCount = 2): Ruler {
  switch (kind) {
    case 'line':
      return { kind, a: { x: c.x - size, y: c.y }, b: { x: c.x + size, y: c.y } };
    case 'ellipse':
      return { kind, c: { ...c }, rx: size, ry: size * 0.6, rot: 0, circle: false };
    case 'radial':
      return { kind, c: { ...c } };
    case 'perspective': {
      const y = c.y - size * 0.3;
      if (vpCount === 1) return { kind, vps: [{ x: c.x, y }] };
      if (vpCount === 2) return { kind, vps: [{ x: c.x - size * 2, y }, { x: c.x + size * 2, y }] };
      return { kind, vps: [{ x: c.x - size * 2, y }, { x: c.x + size * 2, y }, { x: c.x, y: c.y + size * 4 }] };
    }
  }
}

/**
 * Projects stroke points onto a ruler. The first point decides which of the ruler's
 * parallel lines / concentric ellipses / perspective lines the stroke follows.
 */
export class RulerSnap {
  private start: P | null = null;
  private line: Line | null = null;
  private k = 1;

  /**
   * @param snapDist strokes starting closer than this to the ruler itself land exactly on it
   * @param decideDist how far the pen moves before a perspective direction is chosen
   */
  constructor(private r: Ruler, private snapDist: number, private decideDist: number) {}

  /** Returns the constrained point, or null while the direction is still undecided. */
  project(p: P): P | null {
    const r = this.r;
    if (!this.start) {
      this.start = { ...p };
      return this.init(p);
    }
    if (r.kind === 'ellipse') return this.onEllipse(p);
    if (!this.line) {
      const s = this.start;
      if (len(sub(p, s)) < this.decideDist) return null;
      this.line = this.chooseLine(s, norm(sub(p, s)));
    }
    return onLine(p, this.line);
  }

  private init(p: P): P {
    const r = this.r;
    if (r.kind === 'line') {
      const d = norm(sub(r.b, r.a));
      const ruler = { o: r.a, d };
      const closest = onLine(p, ruler);
      this.line = { o: len(sub(p, closest)) < this.snapDist ? closest : p, d };
      return this.line.o;
    }
    if (r.kind === 'ellipse') {
      const q = this.local(p);
      let k = Math.hypot(q.x / r.rx, q.y / r.ry);
      if (Math.abs(k - 1) * Math.min(r.rx, r.ry) < this.snapDist) k = 1;
      this.k = Math.max(k, 1e-3);
      return this.onEllipse(p);
    }
    if (r.kind === 'radial' && len(sub(p, r.c)) > 1) {
      this.line = { o: r.c, d: norm(sub(p, r.c)) };
      return onLine(p, this.line);
    }
    // Perspective (and radial at its exact center) waits for the pen to move.
    return p;
  }

  private chooseLine(s: P, move: P): Line {
    const r = this.r;
    const dirs: P[] = [];
    if (r.kind === 'radial') return { o: r.c, d: move };
    if (r.kind === 'perspective') {
      for (const v of r.vps) if (len(sub(v, s)) > 1e-3) dirs.push(norm(sub(v, s)));
      if (r.vps.length === 1) dirs.push({ x: 1, y: 0 }, { x: 0, y: 1 });
      if (r.vps.length === 2) dirs.push({ x: 0, y: 1 });
    }
    let best = dirs[0] ?? move;
    let score = -1;
    for (const d of dirs) {
      const sc = Math.abs(dot(d, move));
      if (sc > score) {
        score = sc;
        best = d;
      }
    }
    return { o: s, d: best };
  }

  private local(p: P): P {
    const r = this.r as Extract<Ruler, { kind: 'ellipse' }>;
    const c = Math.cos(-r.rot), n = Math.sin(-r.rot);
    const dx = p.x - r.c.x, dy = p.y - r.c.y;
    return { x: c * dx - n * dy, y: n * dx + c * dy };
  }

  private onEllipse(p: P): P {
    const r = this.r as Extract<Ruler, { kind: 'ellipse' }>;
    const q = this.local(p);
    const t = Math.atan2(q.y / r.ry, q.x / r.rx);
    const lx = this.k * r.rx * Math.cos(t), ly = this.k * r.ry * Math.sin(t);
    const c = Math.cos(r.rot), n = Math.sin(r.rot);
    return { x: r.c.x + c * lx - n * ly, y: r.c.y + n * lx + c * ly };
  }
}

function reflect(theta: number): Mat2D {
  const c = Math.cos(2 * theta), s = Math.sin(2 * theta);
  return [c, s, s, -c, 0, 0];
}

/** Every transform a stroke is repeated with, identity first. */
export function symmetryMatrices(s: Symmetry): Mat2D[] {
  const about = (m: Mat2D) => multiply(translate(s.c.x, s.c.y), multiply(m, translate(-s.c.x, -s.c.y)));
  const n = Math.max(1, Math.round(s.n));
  if (s.kind === 'mirror') return [[1, 0, 0, 1, 0, 0], about(reflect(s.angle))];
  const out: Mat2D[] = [];
  for (let k = 0; k < n; k++) {
    const rot = rotate((Math.PI * 2 * k) / n);
    out.push(about(rot));
    if (s.kind === 'kaleidoscope') out.push(about(multiply(rot, reflect(s.angle))));
  }
  return out;
}

export function transformDab(d: Dab, m: Mat2D): Dab {
  const p = apply(m, d.x, d.y);
  const cx = Math.cos(d.angle), sy = Math.sin(d.angle);
  const angle = Math.atan2(m[1] * cx + m[3] * sy, m[0] * cx + m[2] * sy);
  return { ...d, x: p.x, y: p.y, angle };
}

/** Axes to draw for a symmetry guide: full lines through the center, or rays from it. */
export function symmetryAxes(s: Symmetry): { angle: number; full: boolean }[] {
  const n = Math.max(1, Math.round(s.n));
  if (s.kind === 'mirror') return [{ angle: s.angle, full: true }];
  const out: { angle: number; full: boolean }[] = [];
  for (let k = 0; k < n; k++) {
    if (s.kind === 'kaleidoscope') out.push({ angle: s.angle + (Math.PI * k) / n, full: true });
    else out.push({ angle: s.angle + (Math.PI * 2 * k) / n, full: false });
  }
  return out;
}
