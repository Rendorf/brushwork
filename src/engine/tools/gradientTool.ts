import type { Editor } from '../editor';
import { drawFullscreen, Surface } from '../gl/gl';
import type { Rect } from '../util/geom';
import { currentRGB, getSettings, hexToRgb, type GradientStop, type GradientType } from '../../store/settings';
import type { Tool, ToolPointer } from './tool';

const TYPES: GradientType[] = ['linear', 'radial', 'conic', 'reflected'];

/** 256-entry premultiplied RGBA lookup table. Interpolates in premultiplied space so fades to transparent stay clean. */
export function gradientLut(stops: GradientStop[], fg: [number, number, number], reverse: boolean): Uint8Array {
  const sorted = [...stops].sort((a, b) => a.t - b.t);
  const rgba = (s: GradientStop): [number, number, number, number] => {
    const c = s.color === 'fg' ? fg : hexToRgb(s.color) ?? [0, 0, 0];
    return [c[0] * s.a, c[1] * s.a, c[2] * s.a, s.a];
  };
  const out = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    let t = i / 255;
    if (reverse) t = 1 - t;
    let c: [number, number, number, number];
    if (!sorted.length) c = [0, 0, 0, 0];
    else if (t <= sorted[0].t) c = rgba(sorted[0]);
    else if (t >= sorted[sorted.length - 1].t) c = rgba(sorted[sorted.length - 1]);
    else {
      let j = 0;
      while (j < sorted.length - 2 && t > sorted[j + 1].t) j++;
      const a = sorted[j], b = sorted[j + 1];
      const k = (t - a.t) / Math.max(b.t - a.t, 1e-6);
      const ca = rgba(a), cb = rgba(b);
      c = [0, 1, 2, 3].map((q) => ca[q] + (cb[q] - ca[q]) * k) as typeof c;
    }
    for (let q = 0; q < 4; q++) out[i * 4 + q] = Math.round(Math.min(1, Math.max(0, c[q])) * 255);
  }
  return out;
}

/** Linear, radial, conic and reflected gradients, dragged across the canvas. */
export class GradientTool implements Tool {
  readonly id = 'gradient' as const;
  private a: ToolPointer | null = null;
  private b: ToolPointer | null = null;
  private region: Rect | null = null;
  private lut: Surface | null = null;

  constructor(private ed: Editor) {}

  busy(): boolean {
    return !!this.a;
  }

  down(e: ToolPointer): void {
    const ed = this.ed;
    const layer = ed.editableLayer();
    if (!layer) return;
    this.a = this.b = e;
    this.region = ed.doc.selection?.bounds ?? ed.canvasRect();
    const o = getSettings().gradient;
    if (!this.lut) this.lut = new Surface(ed.gl, 256, 1);
    this.lut.upload(0, 0, 256, 1, gradientLut(o.stops, currentRGB(), o.reverse));
    ed.compositor.preview = {
      layer,
      render: (target, r) => ed.previewStroke(target, layer, r, getSettings().gradient.opacity, 0),
    };
    this.render();
  }

  move(events: ToolPointer[]): void {
    if (!this.a) return;
    let b = events[events.length - 1];
    if (b.shift) b = this.snap(this.a, b);
    this.b = b;
    this.render();
  }

  /** Shift snaps the direction to 45° steps. */
  private snap(a: ToolPointer, b: ToolPointer): ToolPointer {
    const ang = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / (Math.PI / 4)) * (Math.PI / 4);
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    return { ...b, x: a.x + Math.cos(ang) * l, y: a.y + Math.sin(ang) * l };
  }

  private render(): void {
    const ed = this.ed;
    const r = this.region!;
    const o = getSettings().gradient;
    const p = ed.progs.gradient.use();
    ed.strokeBuffer.target(r.x, r.y, r.w, r.h);
    p.tex('u_lut', 0, this.lut!.tex).v2('u_a', this.a!.x, this.a!.y).v2('u_b', this.b!.x, this.b!.y).i('u_type', TYPES.indexOf(o.type));
    drawFullscreen(ed.gl);
    ed.invalidate(r);
  }

  up(e: ToolPointer): void {
    if (!this.a) return;
    const ed = this.ed;
    const layer = ed.doc.activeLayer()!;
    const moved = Math.hypot(e.sx - this.a.sx, e.sy - this.a.sy) > 3;
    const r = this.region!;
    ed.compositor.preview = null;
    if (moved) {
      const entry = ed.beginPixels('Gradient');
      entry.capture(layer, r);
      ed.mergeStroke(layer, r, getSettings().gradient.opacity, 0);
      ed.history.push(entry);
    }
    ed.strokeBuffer.clear(r.x, r.y, r.w, r.h);
    ed.invalidate(r);
    this.a = this.b = null;
  }

  cancel(): void {
    if (!this.a) return;
    const r = this.region!;
    this.ed.compositor.preview = null;
    this.ed.strokeBuffer.clear(r.x, r.y, r.w, r.h);
    this.ed.invalidate(r);
    this.a = this.b = null;
  }

  deactivate(): void {
    this.cancel();
  }

  overlay(ctx: CanvasRenderingContext2D): void {
    if (!this.a || !this.b) return;
    const v = this.ed.viewport;
    const s = v.toScreen(this.a.x, this.a.y);
    const t = v.toScreen(this.b.x, this.b.y);
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(t.x, t.y);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    for (const p of [s, t]) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.strokeStyle = '#3d8bff';
      ctx.stroke();
    }
  }
}
