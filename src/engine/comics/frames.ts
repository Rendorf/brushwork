// Comic frames (panels): convex polygons on a frame layer, split with a gutter.
import type { P } from '../guides';
import type { Rect } from '../util/geom';

export interface FrameSet {
  panels: P[][];
  /** Border line width in document pixels. */
  border: number;
  borderColor: string;
  /** Color between and around panels ('transparent' to leave it empty). */
  gutterColor: string;
}

const dot = (a: P, b: P) => a.x * b.x + a.y * b.y;

/** Keep the part of a convex polygon where dot(p - o, n) >= offset (Sutherland–Hodgman). */
export function clipHalfPlane(poly: P[], o: P, n: P, offset: number): P[] {
  const out: P[] = [];
  const side = (p: P) => dot({ x: p.x - o.x, y: p.y - o.y }, n) - offset;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const sa = side(a), sb = side(b);
    if (sa >= 0) out.push(a);
    if ((sa >= 0) !== (sb >= 0)) {
      const t = sa / (sa - sb);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

export function polygonArea(poly: P[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

/** Split a panel along the line a→b, leaving a gap of `gutter`. Null if the line misses it. */
export function splitPanel(poly: P[], a: P, b: P, gutter: number): [P[], P[]] | null {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l = Math.hypot(dx, dy);
  if (l < 1e-6) return null;
  const n = { x: -dy / l, y: dx / l };
  const one = clipHalfPlane(poly, a, n, gutter / 2);
  const two = clipHalfPlane(poly, a, { x: -n.x, y: -n.y }, gutter / 2);
  if (one.length < 3 || two.length < 3 || polygonArea(one) < 4 || polygonArea(two) < 4) return null;
  return [one, two];
}

export function pointInPolygon(p: P, poly: P[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export const rectPanel = (r: Rect): P[] => [
  { x: r.x, y: r.y },
  { x: r.x + r.w, y: r.y },
  { x: r.x + r.w, y: r.y + r.h },
  { x: r.x, y: r.y + r.h },
];

/**
 * Rows of panels inside an area. `rows[i]` is the number of panels in row i; `weights`
 * optionally sets relative row heights.
 */
export function gridPanels(area: Rect, rows: number[], gutter: number, weights?: number[]): P[][] {
  const out: P[][] = [];
  const wsum = (weights ?? rows.map(() => 1)).reduce((a, b) => a + b, 0);
  const usableH = area.h - gutter * (rows.length - 1);
  let y = area.y;
  rows.forEach((cols, i) => {
    const h = (usableH * (weights?.[i] ?? 1)) / wsum;
    const w = (area.w - gutter * (cols - 1)) / cols;
    for (let c = 0; c < cols; c++) out.push(rectPanel({ x: area.x + c * (w + gutter), y, w, h }));
    y += h + gutter;
  });
  return out;
}

/** Rasterize the frame layer: gutter color everywhere except inside panels, plus borders. */
export function renderFrames(fs: FrameSet, w: number, h: number): ImageData {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const path = (poly: P[]) => {
    ctx.beginPath();
    poly.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
  };
  if (fs.gutterColor !== 'transparent') {
    ctx.fillStyle = fs.gutterColor;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'destination-out';
    for (const poly of fs.panels) {
      path(poly);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  if (fs.border > 0) {
    ctx.strokeStyle = fs.borderColor;
    ctx.lineWidth = fs.border;
    ctx.lineJoin = 'miter';
    for (const poly of fs.panels) {
      path(poly);
      ctx.stroke();
    }
  }
  return ctx.getImageData(0, 0, w, h);
}
