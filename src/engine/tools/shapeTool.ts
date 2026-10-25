import type { Editor } from '../editor';
import type { P } from '../guides';
import { rectFromPoints } from '../util/geom';
import { rasterizePath } from '../util/pixels';
import { currentRGB, getSettings, pushColorHistory, type ShapeKind } from '../../store/settings';
import type { BrushTool } from './brushTool';
import type { Tool, ToolPointer } from './tool';

/** Outline of a shape dragged from a to b. Pure, so it can be unit tested. */
export function shapeOutline(kind: ShapeKind, a: P, b: P, opts: { sides: number; fromCenter: boolean; constrain: boolean }): { pts: P[]; closed: boolean } {
  if (kind === 'line') {
    if (opts.constrain) {
      const ang = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / (Math.PI / 12)) * (Math.PI / 12);
      const l = Math.hypot(b.x - a.x, b.y - a.y);
      b = { x: a.x + Math.cos(ang) * l, y: a.y + Math.sin(ang) * l };
    }
    return { pts: [a, b], closed: false };
  }
  let w = b.x - a.x;
  let h = b.y - a.y;
  if (opts.constrain) {
    const m = Math.max(Math.abs(w), Math.abs(h));
    w = Math.sign(w || 1) * m;
    h = Math.sign(h || 1) * m;
  }
  let cx: number, cy: number, rx: number, ry: number;
  if (opts.fromCenter) {
    cx = a.x; cy = a.y; rx = Math.abs(w); ry = Math.abs(h);
  } else {
    cx = a.x + w / 2; cy = a.y + h / 2; rx = Math.abs(w) / 2; ry = Math.abs(h) / 2;
  }
  if (kind === 'rect') {
    return { pts: [{ x: cx - rx, y: cy - ry }, { x: cx + rx, y: cy - ry }, { x: cx + rx, y: cy + ry }, { x: cx - rx, y: cy + ry }], closed: true };
  }
  if (kind === 'ellipse') {
    const n = Math.max(32, Math.min(720, Math.ceil((Math.PI * (rx + ry)) / 3)));
    return { pts: Array.from({ length: n }, (_, i) => ({ x: cx + rx * Math.cos((i / n) * Math.PI * 2), y: cy + ry * Math.sin((i / n) * Math.PI * 2) })), closed: true };
  }
  const sides = Math.max(3, Math.round(opts.sides));
  const n = kind === 'star' ? sides * 2 : sides;
  const pts: P[] = [];
  for (let i = 0; i < n; i++) {
    const t = -Math.PI / 2 + (i / n) * Math.PI * 2;
    const k = kind === 'star' && i % 2 === 1 ? 0.45 : 1;
    pts.push({ x: cx + rx * k * Math.cos(t), y: cy + ry * k * Math.sin(t) });
  }
  return { pts, closed: true };
}

/** Lines, rectangles, ellipses, polygons and stars, stroked with the brush and/or filled. */
export class ShapeTool implements Tool {
  readonly id = 'shape' as const;
  private a: ToolPointer | null = null;
  private b: ToolPointer | null = null;

  constructor(private ed: Editor) {}

  private outline() {
    if (!this.a || !this.b) return null;
    const o = getSettings().shape;
    return shapeOutline(o.kind, this.a, this.b, { sides: o.sides, fromCenter: o.fromCenter !== this.b.alt, constrain: this.b.shift });
  }

  down(e: ToolPointer): void {
    this.a = this.b = e;
  }

  move(events: ToolPointer[]): void {
    if (!this.a) return;
    this.b = events[events.length - 1];
    this.ed.requestRender();
  }

  up(e: ToolPointer): void {
    if (!this.a) return;
    this.b = e;
    const out = this.outline();
    const moved = Math.hypot(e.sx - this.a.sx, e.sy - this.a.sy) > 3;
    this.a = this.b = null;
    this.ed.requestRender();
    if (out && moved) this.draw(out.pts, out.closed);
  }

  cancel(): void {
    this.a = this.b = null;
    this.ed.requestRender();
  }

  draw(pts: P[], closed: boolean): void {
    const ed = this.ed;
    const layer = ed.editableLayer();
    if (!layer) return;
    const mode = getSettings().shape.mode;
    ed.history.group('Shape', () => {
      if (closed && mode !== 'stroke') {
        const r = ed.clampRect(rectFromPoints(pts, 2));
        if (r) {
          const mask = rasterizePath((p) => {
            p.moveTo(pts[0].x, pts[0].y);
            for (const q of pts.slice(1)) p.lineTo(q.x, q.y);
            p.closePath();
          }, r);
          ed.paintMask(layer, mask, r, currentRGB(), 0, 'Shape');
        }
      }
      if (!closed || mode !== 'fill') (ed.tools.brush as BrushTool).strokePath(pts, closed);
    });
    pushColorHistory();
  }

  overlay(ctx: CanvasRenderingContext2D): void {
    const out = this.outline();
    if (!out) return;
    const v = this.ed.viewport;
    ctx.beginPath();
    out.pts.forEach((p, i) => {
      const s = v.toScreen(p.x, p.y);
      if (i) ctx.lineTo(s.x, s.y);
      else ctx.moveTo(s.x, s.y);
    });
    if (out.closed) ctx.closePath();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = '#000';
    ctx.stroke();
    ctx.setLineDash([]);
  }
}
