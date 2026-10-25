import { drawBalloon, renderBalloon, type Balloon } from '../comics/balloons';
import type { Editor } from '../editor';
import type { P } from '../guides';
import { defaultText, measureText } from '../text/textRender';
import { currentRGB, getSettings, rgbToHex } from '../../store/settings';
import type { Tool, ToolPointer } from './tool';

type Drag = { kind: 'new'; a: P } | { kind: 'move'; p0: P; start: Balloon } | { kind: 'tail'; p0: P; start: Balloon } | { kind: 'resize'; p0: P; start: Balloon };

/**
 * Drag to draw a balloon. It stays editable (move it, drag the tail tip or the corner)
 * until Done, another tool, or a tap outside it.
 */
export class BalloonTool implements Tool {
  readonly id = 'balloon' as const;
  pending: Balloon | null = null;
  private drag: Drag | null = null;
  private cur: P | null = null;

  constructor(private ed: Editor) {}

  busy(): boolean {
    return !!this.pending;
  }

  private style() {
    const b = getSettings().balloon;
    return { stroke: b.stroke, fill: b.fill, line: b.line };
  }

  private screenDist(p: P, e: ToolPointer) {
    const s = this.ed.viewport.toScreen(p.x, p.y);
    return Math.hypot(s.x - e.sx, s.y - e.sy);
  }

  down(e: ToolPointer): void {
    const p = { x: e.x, y: e.y };
    const b = this.pending;
    if (b) {
      const corner = { x: b.box.x + b.box.w, y: b.box.y + b.box.h };
      if (b.kind !== 'box' && this.screenDist(b.tail, e) < 22) {
        this.drag = { kind: 'tail', p0: p, start: structuredClone(b) };
        return;
      }
      if (this.screenDist(corner, e) < 22) {
        this.drag = { kind: 'resize', p0: p, start: structuredClone(b) };
        return;
      }
      if (p.x >= b.box.x && p.x <= b.box.x + b.box.w && p.y >= b.box.y && p.y <= b.box.y + b.box.h) {
        this.drag = { kind: 'move', p0: p, start: structuredClone(b) };
        return;
      }
      this.commit();
    }
    this.drag = { kind: 'new', a: p };
    this.cur = p;
  }

  move(events: ToolPointer[]): void {
    const d = this.drag;
    if (!d) return;
    const e = events[events.length - 1];
    const p = { x: e.x, y: e.y };
    if (d.kind === 'new') {
      this.cur = p;
    } else {
      const dx = p.x - d.p0.x, dy = p.y - d.p0.y;
      const s = d.start;
      if (d.kind === 'move') this.pending = { ...s, box: { ...s.box, x: s.box.x + dx, y: s.box.y + dy }, tail: { x: s.tail.x + dx, y: s.tail.y + dy } };
      else if (d.kind === 'tail') this.pending = { ...s, tail: p };
      else this.pending = { ...s, box: { ...s.box, w: Math.max(20, s.box.w + dx), h: Math.max(20, s.box.h + dy) } };
    }
    this.ed.requestRender();
  }

  up(e: ToolPointer): void {
    const d = this.drag;
    this.drag = null;
    if (d?.kind === 'new' && this.cur) {
      const a = d.a, z = this.cur;
      const box = { x: Math.min(a.x, z.x), y: Math.min(a.y, z.y), w: Math.abs(z.x - a.x), h: Math.abs(z.y - a.y) };
      this.cur = null;
      if (box.w * this.ed.viewport.zoom > 12 && box.h * this.ed.viewport.zoom > 12) {
        this.pending = { kind: getSettings().balloon.kind, box, tail: { x: box.x + box.w * 0.3, y: box.y + box.h * 1.18 } };
        this.ed.changed();
      }
    }
    void e;
    this.ed.requestRender();
  }

  cancel(): void {
    this.drag = null;
    this.cur = null;
  }

  setKind(kind: Balloon['kind']): void {
    if (this.pending) this.pending = { ...this.pending, kind };
    this.ed.requestRender();
  }

  /** Paint the pending balloon onto the active layer (and add text inside if enabled). */
  commit(): void {
    const b = this.pending;
    if (!b) return;
    this.pending = null;
    const ed = this.ed;
    const layer = ed.editableLayer();
    if (layer) {
      const r = renderBalloon(b, this.style());
      ed.paintImage(layer, r.img, r.x, r.y, 'Balloon');
      if (getSettings().balloon.addText) {
        const d = getSettings().textDefaults;
        const size = Math.max(12, Math.min(d.size, b.box.h * 0.22, b.box.w * 0.22));
        const t = defaultText(0, 0, {
          font: d.font,
          size,
          vertical: d.vertical,
          bold: d.bold,
          align: 'center',
          color: rgbToHex(...currentRGB()),
          text: d.vertical ? 'セリフ' : 'Text',
        });
        const m = measureText(t);
        const cx = b.box.x + b.box.w / 2, cy = b.box.y + b.box.h / 2;
        t.x = d.vertical ? cx + m.w / 2 : cx - m.w / 2;
        t.y = cy - m.h / 2;
        ed.addTextLayer(t);
        ed.setTool('text');
      }
    }
    ed.changed();
  }

  discard(): void {
    this.pending = null;
    this.ed.changed();
  }

  deactivate(): void {
    this.commit();
  }

  overlay(ctx: CanvasRenderingContext2D): void {
    const v = this.ed.viewport;
    const m = v.matrix();
    let b = this.pending;
    if (!b && this.drag?.kind === 'new' && this.cur) {
      const a = this.drag.a, z = this.cur;
      const box = { x: Math.min(a.x, z.x), y: Math.min(a.y, z.y), w: Math.abs(z.x - a.x), h: Math.abs(z.y - a.y) };
      b = { kind: getSettings().balloon.kind, box, tail: { x: box.x + box.w * 0.3, y: box.y + box.h * 1.18 } };
    }
    if (!b || b.box.w < 1 || b.box.h < 1) return;
    ctx.save();
    ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    ctx.globalAlpha = 0.92;
    drawBalloon(ctx, b, this.style());
    ctx.restore();
    if (!this.pending) return;
    const dot = (p: P, color: string) => {
      const s = v.toScreen(p.x, p.y);
      ctx.beginPath();
      ctx.arc(s.x, s.y, 8, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.stroke();
    };
    const tl = v.toScreen(b.box.x, b.box.y), br = v.toScreen(b.box.x + b.box.w, b.box.y + b.box.h);
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#3d8bff';
    ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    ctx.setLineDash([]);
    dot({ x: b.box.x + b.box.w, y: b.box.y + b.box.h }, '#3d8bff');
    if (b.kind !== 'box') dot(b.tail, '#ff4fd8');
  }
}
