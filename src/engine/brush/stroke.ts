// Pure stroke math: input stabilization, curve interpolation and dab placement.
import { clamp, rng } from '../util/geom';
import type { BrushParams } from './presets';

export interface StrokePoint {
  x: number;
  y: number;
  /** Pressure 0..1. */
  p: number;
  /** Timestamp in ms. */
  t: number;
  tiltX?: number;
  tiltY?: number;
}

export type StabilizerMode = 'smooth' | 'rope';

/**
 * Smooths raw input. 'smooth' is time-based exponential smoothing; 'rope' is a lazy
 * pulled-string that only moves once the pen is further than a radius away.
 */
export class Stabilizer {
  private s: StrokePoint | null = null;
  private last: StrokePoint | null = null;

  /**
   * @param strength 0..100
   * @param ropeRadius radius in document pixels for 'rope' mode
   */
  constructor(private strength: number, private mode: StabilizerMode = 'smooth', private ropeRadius = 0) {}

  push(pt: StrokePoint): StrokePoint | null {
    this.last = pt;
    if (!this.s || this.strength <= 0) {
      this.s = { ...pt };
      return { ...pt };
    }
    const s = this.s;
    if (this.mode === 'rope') {
      const dx = pt.x - s.x;
      const dy = pt.y - s.y;
      const d = Math.hypot(dx, dy);
      const R = this.ropeRadius;
      if (d <= R) {
        s.p = pt.p;
        return null;
      }
      const k = (d - R) / d;
      s.x += dx * k;
      s.y += dy * k;
      s.p = pt.p;
      s.t = pt.t;
      return { ...s };
    }
    const tau = Math.pow(this.strength / 100, 1.6) * 180;
    const dt = Math.max(1, pt.t - s.t);
    const k = 1 - Math.exp(-dt / tau);
    s.x += (pt.x - s.x) * k;
    s.y += (pt.y - s.y) * k;
    s.p += (pt.p - s.p) * Math.min(1, k * 2);
    s.t = pt.t;
    s.tiltX = pt.tiltX;
    s.tiltY = pt.tiltY;
    return { ...s };
  }

  /** Catch up to where the pen was lifted. */
  finish(): StrokePoint[] {
    if (!this.s || !this.last || this.strength <= 0) return [];
    const s = this.s;
    const end = this.last;
    const d = Math.hypot(end.x - s.x, end.y - s.y);
    if (d < 0.5) return [];
    const n = clamp(Math.ceil(d / 3), 1, 24);
    const out: StrokePoint[] = [];
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      out.push({ x: s.x + (end.x - s.x) * t, y: s.y + (end.y - s.y) * t, p: s.p + (end.p - s.p) * t, t: end.t });
    }
    this.s = { ...end };
    return out;
  }
}

export interface Dab {
  x: number;
  y: number;
  /** Diameter before any fade-out taper. */
  size: number;
  angle: number;
  roundness: number;
  flow: number;
  r: number;
  g: number;
  b: number;
  /** Distance along the stroke where the dab was placed. */
  dist: number;
}

export interface DabOptions {
  /** Brush size (diameter) chosen by the user, document pixels. */
  size: number;
  /** RGB 0..1. */
  color: [number, number, number];
  seed: number;
  /** Pressure curve exponent (1 = linear). */
  pressureGamma: number;
}

/** Turns smoothed points into evenly spaced dabs along a midpoint quadratic curve. */
export class DabGenerator {
  readonly dabs: Dab[] = [];
  private pts: StrokePoint[] = [];
  private residual = 0;
  private total = 0;
  private dabIndex = 0;
  private dir = 0;
  private hasDir = false;

  constructor(private brush: BrushParams, private opts: DabOptions) {}

  get length(): number {
    return this.total;
  }

  add(pt: StrokePoint): Dab[] {
    const out: Dab[] = [];
    const prev = this.pts[this.pts.length - 1];
    if (prev && Math.hypot(pt.x - prev.x, pt.y - prev.y) < 0.25) {
      prev.p = Math.max(prev.p, pt.p);
      return out;
    }
    this.pts.push(pt);
    const n = this.pts.length;
    if (n === 1) {
      this.emit(pt.x, pt.y, pt.p, out);
      this.residual = this.stepAt(pt.p);
    } else if (n === 2) {
      const [a, b] = this.pts;
      this.walkLine(a, mid(a, b), out);
    } else {
      const a = mid(this.pts[n - 3], this.pts[n - 2]);
      const c = this.pts[n - 2];
      const e = mid(this.pts[n - 2], this.pts[n - 1]);
      this.walkQuad(a, c, e, out);
      if (this.pts.length > 4) this.pts.splice(0, this.pts.length - 4);
    }
    return out;
  }

  end(): Dab[] {
    const out: Dab[] = [];
    const n = this.pts.length;
    if (n >= 2) this.walkLine(mid(this.pts[n - 2], this.pts[n - 1]), this.pts[n - 1], out);
    return out;
  }

  /** Size multiplier for the fade-out taper, given the final stroke length. */
  taperOutFactor(d: Dab): number {
    const len = this.brush.taperOut * this.opts.size;
    if (len <= 0) return 1;
    const fromEnd = this.total - d.dist;
    if (fromEnd >= len) return 1;
    const t = clamp(fromEnd / len, 0, 1);
    return this.brush.taperMin + (1 - this.brush.taperMin) * easeOut(t);
  }

  private stepAt(p: number): number {
    const b = this.brush;
    const d = this.opts.size * b.dabScale * this.sizeFactor(p);
    // Scattered stamps space relative to the brush size, not the tiny dab size.
    const basis = b.scatter > 0 && b.dabScale < 0.5 ? this.opts.size * this.sizeFactor(p) : d;
    return Math.max(0.35, b.spacing * basis);
  }

  private sizeFactor(p: number): number {
    const pc = Math.pow(clamp(p, 0, 1), this.opts.pressureGamma);
    return 1 - this.brush.sizePressure * (1 - pc);
  }

  private walkLine(a: { x: number; y: number; p: number }, b: { x: number; y: number; p: number }, out: Dab[]) {
    this.walkPiece(a.x, a.y, a.p, b.x, b.y, b.p, out);
  }

  private walkQuad(a: StrokePoint, c: StrokePoint, e: StrokePoint, out: Dab[]) {
    const approx = Math.hypot(c.x - a.x, c.y - a.y) + Math.hypot(e.x - c.x, e.y - c.y);
    const k = clamp(Math.ceil(approx / 2), 1, 2000);
    let px = a.x, py = a.y, pp = a.p;
    for (let i = 1; i <= k; i++) {
      const t = i / k;
      const u = 1 - t;
      const x = u * u * a.x + 2 * u * t * c.x + t * t * e.x;
      const y = u * u * a.y + 2 * u * t * c.y + t * t * e.y;
      const p = a.p + (e.p - a.p) * t;
      this.walkPiece(px, py, pp, x, y, p, out);
      px = x; py = y; pp = p;
    }
  }

  private walkPiece(x0: number, y0: number, p0: number, x1: number, y1: number, p1: number, out: Dab[]) {
    const L = Math.hypot(x1 - x0, y1 - y0);
    if (L <= 1e-6) return;
    const angle = Math.atan2(y1 - y0, x1 - x0);
    if (!this.hasDir) {
      this.dir = angle;
      this.hasDir = true;
    } else {
      // Smooth direction changes so follow-direction tips do not flicker.
      let d = angle - this.dir;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.dir += d * 0.5;
    }
    const base = this.total;
    let pos = 0;
    while (pos + this.residual <= L) {
      pos += this.residual;
      this.total = base + pos;
      const t = pos / L;
      const p = p0 + (p1 - p0) * t;
      this.emit(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, p, out);
      this.residual = this.stepAt(p);
    }
    this.residual -= L - pos;
    this.total = base + L;
  }

  private emit(x: number, y: number, p: number, out: Dab[]) {
    const b = this.brush;
    const size = this.opts.size;
    const pc = Math.pow(clamp(p, 0, 1), this.opts.pressureGamma);
    let sizeF = 1 - b.sizePressure * (1 - pc);
    const flowF = 1 - b.flowPressure * (1 - pc);
    const tin = b.taperIn * size;
    if (tin > 0 && this.total < tin) {
      sizeF *= b.taperMin + (1 - b.taperMin) * easeOut(this.total / tin);
    }
    for (let c = 0; c < b.count; c++) {
      const r = rng(this.opts.seed + this.dabIndex++ * 7919);
      let d = size * b.dabScale * sizeF * (1 + b.sizeJitter * (r() * 2 - 1));
      d = Math.max(0.3, d);
      let dx = 0, dy = 0;
      if (b.scatter > 0) {
        const rr = size * sizeF * b.scatter * Math.sqrt(r());
        const th = r() * Math.PI * 2;
        dx = Math.cos(th) * rr;
        dy = Math.sin(th) * rr;
      }
      const angle = (b.angle * Math.PI) / 180 + (b.followDirection ? this.dir : 0) + ((b.angleJitter * Math.PI) / 180) * (r() * 2 - 1);
      let [cr, cg, cb] = this.opts.color;
      if (b.hueJitter || b.satJitter || b.valJitter) {
        [cr, cg, cb] = jitterColor(cr, cg, cb, b.hueJitter * (r() * 2 - 1), b.satJitter * (r() * 2 - 1), b.valJitter * (r() * 2 - 1));
      }
      out.push({
        x: x + dx,
        y: y + dy,
        size: d,
        angle,
        roundness: b.roundness,
        flow: clamp(b.flow * flowF * (1 - b.flowJitter * r()), 0, 1),
        r: cr,
        g: cg,
        b: cb,
        dist: this.total,
      });
    }
    this.dabs.push(...out.slice(out.length - b.count));
  }
}

const mid = (a: StrokePoint, b: StrokePoint): StrokePoint => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
  p: (a.p + b.p) / 2,
  t: b.t,
});

const easeOut = (t: number) => 1 - (1 - t) * (1 - t);

export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  let h = 0;
  if (d > 0) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  return [h, mx === 0 ? 0 : d / mx, mx];
}

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  h = ((h % 1) + 1) % 1;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: return [v, t, p];
    case 1: return [q, v, p];
    case 2: return [p, v, t];
    case 3: return [p, q, v];
    case 4: return [t, p, v];
    default: return [v, p, q];
  }
}

function jitterColor(r: number, g: number, b: number, dh: number, ds: number, dv: number): [number, number, number] {
  const [h, s, v] = rgbToHsv(r, g, b);
  return hsvToRgb(h + dh, clamp(s + ds, 0, 1), clamp(v + dv, 0, 1));
}
