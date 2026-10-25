import { pointInPolygon, rectPanel, splitPanel, type FrameSet } from '../comics/frames';
import type { Layer } from '../document';
import type { Editor } from '../editor';
import type { P } from '../guides';
import { rasterizePath } from '../util/pixels';
import { rectFromPoints } from '../util/geom';
import { getSettings } from '../../store/settings';
import type { Tool, ToolPointer } from './tool';

/** Snap a cut direction to horizontal/vertical when close (or to 15° steps with shift). */
export function snapCut(a: P, b: P, shift: boolean): P {
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const l = Math.hypot(b.x - a.x, b.y - a.y);
  const step = shift ? Math.PI / 12 : Math.PI / 2;
  const q = Math.round(ang / step) * step;
  if (shift || Math.abs(ang - q) < (5 * Math.PI) / 180) return { x: a.x + Math.cos(q) * l, y: a.y + Math.sin(q) * l };
  return b;
}

/** Comic frame divider: drag across a panel to cut it in two; or tap a panel to select it. */
export class FrameTool implements Tool {
  readonly id = 'frame' as const;
  private a: ToolPointer | null = null;
  private b: P | null = null;

  constructor(private ed: Editor) {}

  /** The frame layer being edited: the active one, else the topmost. */
  frameLayer(): Layer | null {
    const act = this.ed.doc.activeLayer();
    if (act?.frames) return act;
    return [...this.ed.doc.allLayers()].reverse().find((l) => l.frames) ?? null;
  }

  /** New frame layer with one panel inside the page margins (or the page's safe area). */
  createFrames(): Layer {
    const ed = this.ed;
    const f = getSettings().frame;
    const page = ed.doc.guides.page;
    const m = f.margin;
    const area = page?.safe ?? { x: m, y: m, w: ed.doc.width - 2 * m, h: ed.doc.height - 2 * m };
    const fs: FrameSet = { panels: [rectPanel(area)], border: f.border, borderColor: '#000000', gutterColor: '#ffffff' };
    return ed.addFrameLayer(fs);
  }

  down(e: ToolPointer): void {
    if (!this.frameLayer()) {
      this.ed.toast('Create a frame layer first (button above).');
      return;
    }
    this.a = e;
    this.b = { x: e.x, y: e.y };
  }

  move(events: ToolPointer[]): void {
    if (!this.a) return;
    const e = events[events.length - 1];
    this.b = snapCut(this.a, { x: e.x, y: e.y }, e.shift);
    this.ed.requestRender();
  }

  up(e: ToolPointer): void {
    const a = this.a, b = this.b;
    this.a = this.b = null;
    this.ed.requestRender();
    const layer = this.frameLayer();
    if (!a || !b || !layer?.frames) return;
    const moved = Math.hypot(e.sx - a.sx, e.sy - a.sy) > 10;
    const fs = layer.frames;
    if (!moved) {
      // Tap: select the panel (to draw only inside it).
      const panel = fs.panels.find((p) => pointInPolygon(a, p));
      if (!panel) return;
      const r = this.ed.clampRect(rectFromPoints(panel, 1));
      if (!r) return;
      const part = rasterizePath((path) => {
        path.moveTo(panel[0].x, panel[0].y);
        for (const q of panel.slice(1)) path.lineTo(q.x, q.y);
        path.closePath();
      }, r);
      const full = new Uint8Array(this.ed.doc.width * this.ed.doc.height);
      for (let y = 0; y < r.h; y++) full.set(part.subarray(y * r.w, (y + 1) * r.w), (r.y + y) * this.ed.doc.width + r.x);
      this.ed.setSelection(full, 'Select panel');
      return;
    }
    // Cut every panel the drawn segment passes through.
    const gutter = getSettings().frame.gutter;
    const samples = Array.from({ length: 33 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / 32, y: a.y + ((b.y - a.y) * i) / 32 }));
    const panels: P[][] = [];
    let cut = false;
    for (const p of fs.panels) {
      const crosses = samples.some((s) => pointInPolygon(s, p));
      const parts = crosses ? splitPanel(p, a, b, gutter) : null;
      if (parts) {
        panels.push(...parts);
        cut = true;
      } else {
        panels.push(p);
      }
    }
    if (cut) this.ed.setFrames(layer, { ...fs, panels }, 'Cut frame');
  }

  cancel(): void {
    this.a = this.b = null;
  }

  overlay(ctx: CanvasRenderingContext2D): void {
    const v = this.ed.viewport;
    const layer = this.frameLayer();
    if (layer?.frames) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(61,139,255,0.8)';
      for (const p of layer.frames.panels) {
        ctx.beginPath();
        p.map((q) => v.toScreen(q.x, q.y)).forEach((s, i) => (i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y)));
        ctx.closePath();
        ctx.stroke();
      }
    }
    if (!this.a || !this.b) return;
    const s = v.toScreen(this.a.x, this.a.y), t = v.toScreen(this.b.x, this.b.y);
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(t.x, t.y);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#ff4fd8';
    ctx.stroke();
  }
}
