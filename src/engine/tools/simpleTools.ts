import { OP_ERASE } from '../blendModes';
import type { Editor } from '../editor';
import { rectFromPoints, type Rect } from '../util/geom';
import { floodFill, rasterizePath } from '../util/pixels';
import { currentRGB, getSettings, pushColorHistory, setColorRGB, setSettings, type SelectOp } from '../../store/settings';
import type { Tool, ToolPointer } from './tool';

/** Pixels the fill/wand tools sample from. */
function samplePixels(ed: Editor, source: 'layer' | 'canvas' | 'reference'): Uint8Array | null {
  if (source === 'layer') return ed.doc.activeLayer()?.surface.read() ?? null;
  if (source === 'reference') {
    const ref = ed.doc.allLayers().find((l) => l.isReference);
    if (ref) return ref.surface.read();
    ed.toast('No reference layer set — using the whole canvas.');
  }
  return ed.readComposite();
}

function cropMask(mask: Uint8Array, docW: number, r: Rect): Uint8Array {
  const out = new Uint8Array(r.w * r.h);
  for (let y = 0; y < r.h; y++) out.set(mask.subarray((r.y + y) * docW + r.x, (r.y + y) * docW + r.x + r.w), y * r.w);
  return out;
}

export class FillTool implements Tool {
  readonly id = 'fill' as const;
  constructor(private ed: Editor) {}

  down(e: ToolPointer): void {
    const ed = this.ed;
    const layer = ed.editableLayer();
    if (!layer) return;
    const o = getSettings().fill;
    const px = samplePixels(ed, o.source);
    if (!px) return;
    const res = floodFill(px, ed.doc.width, ed.doc.height, e.x, e.y, {
      tolerance: Math.round(o.tolerance * 2.55),
      gap: o.gap,
      expand: o.expand,
      antialias: o.antialias,
    });
    if (!res) return;
    const r = res.bounds;
    ed.paintMask(layer, cropMask(res.mask, ed.doc.width, r), r, currentRGB(), 0, 'Fill');
    pushColorHistory();
  }
  move(): void {}
  up(): void {}
  cancel(): void {}
}

/** Freehand polygon in document space with a screen-space overlay. */
abstract class LassoBase implements Tool {
  abstract readonly id: 'lassoFill' | 'select';
  protected pts: { x: number; y: number }[] = [];
  protected drawing = false;
  constructor(protected ed: Editor) {}

  down(e: ToolPointer): void {
    this.drawing = true;
    this.pts = [{ x: e.x, y: e.y }];
    this.ed.requestRender();
  }

  move(events: ToolPointer[]): void {
    if (!this.drawing) return;
    for (const e of events) {
      const last = this.pts[this.pts.length - 1];
      if (Math.hypot(e.x - last.x, e.y - last.y) * this.ed.viewport.zoom >= 2) this.pts.push({ x: e.x, y: e.y });
    }
    this.ed.requestRender();
  }

  cancel(): void {
    this.drawing = false;
    this.pts = [];
    this.ed.requestRender();
  }

  protected polygonMask(): { mask: Uint8Array; r: Rect } | null {
    if (this.pts.length < 3) return null;
    const r = this.ed.clampRect(rectFromPoints(this.pts, 2));
    if (!r) return null;
    const pts = this.pts;
    const mask = rasterizePath((p) => {
      p.moveTo(pts[0].x, pts[0].y);
      for (const q of pts.slice(1)) p.lineTo(q.x, q.y);
      p.closePath();
    }, r);
    return { mask, r };
  }

  overlay(ctx: CanvasRenderingContext2D): void {
    if (!this.drawing || this.pts.length < 2) return;
    const v = this.ed.viewport;
    ctx.beginPath();
    this.pts.forEach((p, i) => {
      const s = v.toScreen(p.x, p.y);
      if (i === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    });
    ctx.closePath();
    ctx.fillStyle = 'rgba(80,140,255,0.12)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = '#000';
    ctx.stroke();
    ctx.setLineDash([]);
  }

  abstract up(e: ToolPointer): void;
}

export class LassoFillTool extends LassoBase {
  readonly id = 'lassoFill' as const;

  up(): void {
    this.drawing = false;
    const ed = this.ed;
    const res = this.polygonMask();
    this.pts = [];
    ed.requestRender();
    if (!res) return;
    const layer = ed.editableLayer();
    if (!layer) return;
    const erase = getSettings().lassoFillMode === 'erase';
    ed.paintMask(layer, res.mask, res.r, currentRGB(), erase ? OP_ERASE : 0, erase ? 'Lasso erase' : 'Lasso fill');
    if (!erase) pushColorHistory();
  }
}

export class SelectTool extends LassoBase {
  readonly id = 'select' as const;
  private start: ToolPointer | null = null;
  private cur: ToolPointer | null = null;

  down(e: ToolPointer): void {
    const shape = getSettings().select.shape;
    if (shape === 'wand') {
      this.wand(e);
      return;
    }
    this.start = e;
    this.cur = e;
    if (shape === 'lasso') super.down(e);
    else this.drawing = true;
    this.ed.requestRender();
  }

  move(events: ToolPointer[]): void {
    if (!this.drawing) return;
    if (getSettings().select.shape === 'lasso') super.move(events);
    else {
      this.cur = events[events.length - 1];
      this.ed.requestRender();
    }
  }

  up(e: ToolPointer): void {
    if (!this.drawing) return;
    const ed = this.ed;
    const shape = getSettings().select.shape;
    this.drawing = false;
    const start = this.start!;
    const moved = Math.hypot(e.sx - start.sx, e.sy - start.sy) > 4;
    let res: { mask: Uint8Array; r: Rect } | null = null;
    if (!moved && shape !== 'lasso') {
      this.start = this.cur = null;
      ed.deselect();
      return;
    }
    if (shape === 'lasso') {
      res = this.polygonMask();
      this.pts = [];
      if (!res && !moved) ed.deselect();
    } else {
      const box = this.box(start, e);
      const r = ed.clampRect(box);
      if (r) {
        res = {
          r,
          mask: rasterizePath((p) => {
            if (shape === 'rect') p.rect(box.x, box.y, box.w, box.h);
            else p.ellipse(box.x + box.w / 2, box.y + box.h / 2, box.w / 2, box.h / 2, 0, 0, Math.PI * 2);
          }, r),
        };
      }
    }
    this.start = this.cur = null;
    ed.requestRender();
    if (res) this.apply(res.mask, res.r, this.op(e));
  }

  cancel(): void {
    super.cancel();
    this.start = this.cur = null;
  }

  private op(e: ToolPointer): SelectOp {
    if (e.shift && e.alt) return 'intersect';
    if (e.shift) return 'add';
    if (e.alt) return 'subtract';
    return getSettings().select.op;
  }

  /** Rectangle from drag; shift keeps it square. */
  private box(a: ToolPointer, b: ToolPointer): Rect {
    let w = b.x - a.x;
    let h = b.y - a.y;
    if (b.shift && !b.alt) {
      const m = Math.max(Math.abs(w), Math.abs(h));
      w = Math.sign(w || 1) * m;
      h = Math.sign(h || 1) * m;
    }
    return { x: Math.min(a.x, a.x + w), y: Math.min(a.y, a.y + h), w: Math.abs(w), h: Math.abs(h) };
  }

  private wand(e: ToolPointer): void {
    const ed = this.ed;
    const o = getSettings().select;
    const px = samplePixels(ed, o.source);
    if (!px) return;
    const res = floodFill(px, ed.doc.width, ed.doc.height, e.x, e.y, { tolerance: Math.round(o.tolerance * 2.55), gap: 0, expand: 0, antialias: false });
    if (!res) return;
    this.apply(cropMask(res.mask, ed.doc.width, res.bounds), res.bounds, this.op(e));
  }

  /** Combine a mask (sized to r) with the current selection. */
  private apply(part: Uint8Array, r: Rect, op: SelectOp): void {
    const ed = this.ed;
    const W = ed.doc.width;
    const cur = ed.doc.selection?.mask ?? null;
    const out = op === 'replace' || !cur ? new Uint8Array(W * ed.doc.height) : cur.slice();
    if (op === 'intersect') {
      const full = new Uint8Array(out.length);
      for (let y = 0; y < r.h; y++) full.set(part.subarray(y * r.w, (y + 1) * r.w), (r.y + y) * W + r.x);
      for (let i = 0; i < out.length; i++) out[i] = Math.min(out[i], full[i]);
    } else {
      for (let y = 0; y < r.h; y++) {
        for (let x = 0; x < r.w; x++) {
          const i = (r.y + y) * W + r.x + x;
          const v = part[y * r.w + x];
          if (op === 'subtract') out[i] = Math.round(out[i] * (1 - v / 255));
          else out[i] = Math.max(out[i], v);
        }
      }
    }
    ed.setSelection(out);
  }

  overlay(ctx: CanvasRenderingContext2D): void {
    const shape = getSettings().select.shape;
    if (shape === 'lasso') return super.overlay(ctx);
    if (!this.drawing || !this.start || !this.cur) return;
    const v = this.ed.viewport;
    const b = this.box(this.start, this.cur);
    ctx.beginPath();
    if (shape === 'rect') {
      const c = [v.toScreen(b.x, b.y), v.toScreen(b.x + b.w, b.y), v.toScreen(b.x + b.w, b.y + b.h), v.toScreen(b.x, b.y + b.h)];
      c.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
    } else {
      for (let i = 0; i <= 64; i++) {
        const t = (i / 64) * Math.PI * 2;
        const p = v.toScreen(b.x + b.w / 2 + (Math.cos(t) * b.w) / 2, b.y + b.h / 2 + (Math.sin(t) * b.h) / 2);
        if (i) ctx.lineTo(p.x, p.y);
        else ctx.moveTo(p.x, p.y);
      }
    }
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = '#000';
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

export class EyedropperTool implements Tool {
  readonly id = 'eyedropper' as const;
  private at: ToolPointer | null = null;
  constructor(private ed: Editor) {}

  down(e: ToolPointer): void {
    this.pick(e);
  }
  move(events: ToolPointer[]): void {
    if (this.at) this.pick(events[events.length - 1]);
  }
  up(): void {
    this.at = null;
    this.ed.requestRender();
  }
  cancel(): void {
    this.at = null;
  }

  pick(e: ToolPointer): void {
    this.at = e;
    const c = this.ed.pickColor(e.x, e.y, getSettings().eyedropperSource);
    if (c) setColorRGB(...c);
    this.ed.requestRender();
  }

  overlay(ctx: CanvasRenderingContext2D): void {
    if (!this.at) return;
    drawPickRing(ctx, this.at.sx, this.at.sy);
  }
}

/** The color loupe shown while picking. */
export function drawPickRing(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const [r, g, b] = currentRGB();
  ctx.beginPath();
  ctx.arc(x, y - 60, 30, 0, Math.PI * 2);
  ctx.fillStyle = `rgb(${r * 255},${g * 255},${b * 255})`;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#fff';
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.stroke();
}

export class HandTool implements Tool {
  readonly id = 'hand' as const;
  private last: ToolPointer | null = null;
  constructor(private ed: Editor) {}
  down(e: ToolPointer): void {
    this.last = e;
  }
  move(events: ToolPointer[]): void {
    const e = events[events.length - 1];
    if (!this.last) return;
    this.ed.viewport.panBy(e.sx - this.last.sx, e.sy - this.last.sy);
    this.last = e;
    this.ed.requestRender();
  }
  up(): void {
    this.last = null;
  }
  cancel(): void {
    this.last = null;
  }
}

export function setSelectShape(shape: 'rect' | 'ellipse' | 'lasso' | 'wand'): void {
  setSettings((s) => ({ select: { ...s.select, shape } }));
}
