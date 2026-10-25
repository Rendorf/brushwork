import { apply, clamp, invert, multiply, rotate, scale, translate, type Mat2D } from './util/geom';

const MIN_ZOOM = 0.02;
const MAX_ZOOM = 64;
const SNAP = (3 * Math.PI) / 180;

export interface GestureStart {
  zoom: number;
  rotation: number;
  docMid: { x: number; y: number };
  dist: number;
  angle: number;
}

/** Maps document pixels to screen CSS pixels: pan, zoom, rotation and horizontal flip. */
export class Viewport {
  zoom = 1;
  rotation = 0;
  flip = false;
  /** Screen position (CSS px) of the document center. */
  cx = 0;
  cy = 0;
  cssW = 1;
  cssH = 1;
  dpr = 1;

  constructor(public docW: number, public docH: number) {}

  setScreen(cssW: number, cssH: number, dpr: number): void {
    this.cssW = cssW;
    this.cssH = cssH;
    this.dpr = dpr;
  }

  matrix(): Mat2D {
    let m = translate(this.cx, this.cy);
    m = multiply(m, rotate(this.rotation));
    m = multiply(m, scale(this.flip ? -this.zoom : this.zoom, this.zoom));
    return multiply(m, translate(-this.docW / 2, -this.docH / 2));
  }

  inverse(): Mat2D {
    return invert(this.matrix());
  }

  /** Device-pixel screen coordinates to document coordinates (for the view shader). */
  deviceInverse(): Mat2D {
    return multiply(this.inverse(), scale(1 / this.dpr));
  }

  toDoc(sx: number, sy: number) {
    return apply(this.inverse(), sx, sy);
  }

  toScreen(x: number, y: number) {
    return apply(this.matrix(), x, y);
  }

  fit(margin = 24): void {
    const availW = Math.max(50, this.cssW - margin * 2);
    const availH = Math.max(50, this.cssH - margin * 2);
    this.rotation = 0;
    this.zoom = clamp(Math.min(availW / this.docW, availH / this.docH), MIN_ZOOM, MAX_ZOOM);
    this.cx = this.cssW / 2;
    this.cy = this.cssH / 2;
  }

  /** Keep the document point under (sx, sy) fixed while changing zoom. */
  zoomAt(factor: number, sx: number, sy: number): void {
    const p = this.toDoc(sx, sy);
    this.zoom = clamp(this.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    this.pin(p, sx, sy);
  }

  setZoom(z: number, sx = this.cssW / 2, sy = this.cssH / 2): void {
    this.zoomAt(z / this.zoom, sx, sy);
  }

  rotateAt(delta: number, sx: number, sy: number): void {
    const p = this.toDoc(sx, sy);
    this.rotation = normalizeAngle(this.rotation + delta);
    this.pin(p, sx, sy);
  }

  panBy(dx: number, dy: number): void {
    this.cx += dx;
    this.cy += dy;
  }

  toggleFlip(): void {
    const p = this.toDoc(this.cssW / 2, this.cssH / 2);
    this.flip = !this.flip;
    this.pin(p, this.cssW / 2, this.cssH / 2);
  }

  /** Move the view so document point p lands on screen point (sx, sy). */
  pin(p: { x: number; y: number }, sx: number, sy: number): void {
    const s = this.toScreen(p.x, p.y);
    this.cx += sx - s.x;
    this.cy += sy - s.y;
  }

  beginGesture(a: { x: number; y: number }, b: { x: number; y: number }): GestureStart {
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    return {
      zoom: this.zoom,
      rotation: this.rotation,
      docMid: this.toDoc(mx, my),
      dist: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
      angle: Math.atan2(b.y - a.y, b.x - a.x),
    };
  }

  /** Two-finger pinch / rotate / pan relative to a gesture start. */
  updateGesture(g: GestureStart, a: { x: number; y: number }, b: { x: number; y: number }, allowRotate = true): void {
    const d = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
    this.zoom = clamp((g.zoom * d) / g.dist, MIN_ZOOM, MAX_ZOOM);
    if (allowRotate) {
      let r = normalizeAngle(g.rotation + Math.atan2(b.y - a.y, b.x - a.x) - g.angle);
      const q = Math.round(r / (Math.PI / 2)) * (Math.PI / 2);
      if (Math.abs(r - q) < SNAP) r = q;
      this.rotation = normalizeAngle(r);
    }
    this.pin(g.docMid, (a.x + b.x) / 2, (a.y + b.y) / 2);
  }

  resizeDoc(w: number, h: number): void {
    this.docW = w;
    this.docH = h;
  }
}

export function normalizeAngle(a: number): number {
  const t = Math.PI * 2;
  a = a % t;
  if (a > Math.PI) a -= t;
  if (a <= -Math.PI) a += t;
  return a;
}
