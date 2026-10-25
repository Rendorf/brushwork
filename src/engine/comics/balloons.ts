// Speech balloons, drawn with Canvas 2D in document coordinates.
import type { P } from '../guides';
import { rng, type Rect } from '../util/geom';
import type { BalloonKind } from '../../store/settings';

export interface Balloon {
  kind: BalloonKind;
  box: Rect;
  tail: P;
}

export interface BalloonStyle {
  stroke: number;
  fill: string;
  line: string;
}

const center = (b: Rect): P => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

/** A point on the box's ellipse at angle a. */
const onEllipse = (b: Rect, a: number): P => ({ x: b.x + b.w / 2 + (Math.cos(a) * b.w) / 2, y: b.y + b.h / 2 + (Math.sin(a) * b.h) / 2 });

/** Wedge from the balloon's edge to the tail tip, curved slightly. */
function tailPath(p: Path2D, b: Rect, tip: P, spread: number) {
  const c = center(b);
  const a = Math.atan2((tip.y - c.y) / (b.h / 2), (tip.x - c.x) / (b.w / 2));
  const l = onEllipse(b, a - spread), r = onEllipse(b, a + spread);
  const mid = { x: (l.x + r.x) / 2, y: (l.y + r.y) / 2 };
  const bend = { x: (mid.x + tip.x) / 2 + (r.x - l.x) * 0.15, y: (mid.y + tip.y) / 2 + (r.y - l.y) * 0.15 };
  p.moveTo(l.x, l.y);
  p.quadraticCurveTo(bend.x, bend.y, tip.x, tip.y);
  p.quadraticCurveTo(bend.x, bend.y, r.x, r.y);
  p.closePath();
}

/** Outline paths for a balloon (body and tail drawn as one shape). */
export function balloonPath(bl: Balloon): Path2D[] {
  const { box: b, tail, kind } = bl;
  const p = new Path2D();
  const c = center(b);
  const extra: Path2D[] = [];
  if (kind === 'oval') {
    p.ellipse(c.x, c.y, b.w / 2, b.h / 2, 0, 0, Math.PI * 2);
    tailPath(p, b, tail, 0.3);
  } else if (kind === 'round') {
    const r = Math.min(b.w, b.h) * 0.25;
    p.roundRect(b.x, b.y, b.w, b.h, r);
    tailPath(p, { x: b.x + b.w * 0.08, y: b.y + b.h * 0.08, w: b.w * 0.84, h: b.h * 0.84 }, tail, 0.2);
  } else if (kind === 'box') {
    p.rect(b.x, b.y, b.w, b.h);
  } else if (kind === 'cloud') {
    // Bumps around the ellipse.
    const n = Math.max(8, Math.round((b.w + b.h) / Math.max(30, Math.min(b.w, b.h) * 0.28)));
    const pts = Array.from({ length: n }, (_, i) => onEllipse({ x: b.x + b.w * 0.06, y: b.y + b.h * 0.08, w: b.w * 0.88, h: b.h * 0.84 }, (i / n) * Math.PI * 2));
    p.moveTo(pts[0].x, pts[0].y);
    for (let i = 0; i < n; i++) {
      const a = pts[i], z = pts[(i + 1) % n];
      const mid = { x: (a.x + z.x) / 2, y: (a.y + z.y) / 2 };
      const out = { x: mid.x + (mid.x - c.x) * 0.22, y: mid.y + (mid.y - c.y) * 0.22 };
      p.quadraticCurveTo(out.x, out.y, z.x, z.y);
    }
    p.closePath();
    // Thought bubbles toward the tail.
    const edge = onEllipse(b, Math.atan2((tail.y - c.y) / (b.h / 2), (tail.x - c.x) / (b.w / 2)));
    const base = Math.min(b.w, b.h) * 0.12;
    [0.25, 0.6, 0.95].forEach((t, i) => {
      const q = new Path2D();
      const r = base * (1 - i * 0.3);
      q.ellipse(edge.x + (tail.x - edge.x) * t, edge.y + (tail.y - edge.y) * t, r, r * 0.8, 0, 0, Math.PI * 2);
      extra.push(q);
    });
  } else {
    // Spiky shout balloon.
    const r = rng(Math.round(b.w * 7 + b.h * 13));
    const n = Math.max(12, Math.round((b.w + b.h) / 40));
    for (let i = 0; i < n * 2; i++) {
      const a = (i / (n * 2)) * Math.PI * 2;
      const k = i % 2 === 0 ? 1 + r() * 0.25 : 0.72 + r() * 0.08;
      const q = { x: c.x + (Math.cos(a) * b.w * k) / 2, y: c.y + (Math.sin(a) * b.h * k) / 2 };
      if (i) p.lineTo(q.x, q.y);
      else p.moveTo(q.x, q.y);
    }
    p.closePath();
    tailPath(p, { x: b.x + b.w * 0.15, y: b.y + b.h * 0.15, w: b.w * 0.7, h: b.h * 0.7 }, tail, 0.12);
  }
  return [p, ...extra];
}

/** Draw: thick outline first, then the fill on top, so only the outer edge of the union is outlined. */
export function drawBalloon(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, bl: Balloon, s: BalloonStyle): void {
  ctx.lineJoin = 'round';
  for (const path of balloonPath(bl)) {
    if (s.stroke > 0) {
      ctx.lineWidth = s.stroke * 2;
      ctx.strokeStyle = s.line;
      ctx.stroke(path);
    }
    ctx.fillStyle = s.fill;
    ctx.fill(path);
  }
}

/** Document bounds of a balloon including its outline and tail. */
export function balloonBounds(bl: Balloon, s: BalloonStyle): Rect {
  const pad = s.stroke + 4;
  const xs = [bl.box.x - bl.box.w * 0.15, bl.box.x + bl.box.w * 1.15];
  const ys = [bl.box.y - bl.box.h * 0.15, bl.box.y + bl.box.h * 1.15];
  if (bl.kind !== 'box') {
    xs.push(bl.tail.x);
    ys.push(bl.tail.y);
  }
  const x0 = Math.floor(Math.min(...xs) - pad), y0 = Math.floor(Math.min(...ys) - pad);
  return { x: x0, y: y0, w: Math.ceil(Math.max(...xs) + pad) - x0, h: Math.ceil(Math.max(...ys) + pad) - y0 };
}

/** Rasterize a balloon to straight-alpha pixels at its document bounds. */
export function renderBalloon(bl: Balloon, s: BalloonStyle): { img: ImageData; x: number; y: number } {
  const r = balloonBounds(bl, s);
  const c = document.createElement('canvas');
  c.width = r.w;
  c.height = r.h;
  const ctx = c.getContext('2d')!;
  ctx.translate(-r.x, -r.y);
  drawBalloon(ctx, bl, s);
  return { img: ctx.getImageData(0, 0, r.w, r.h), x: r.x, y: r.y };
}
