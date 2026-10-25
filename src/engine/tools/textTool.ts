import { pointInPolygon } from '../comics/frames';
import type { Layer } from '../document';
import type { Editor } from '../editor';
import { defaultText, measureText, textCorners, type TextProps } from '../text/textRender';
import { currentRGB, getSettings, rgbToHex } from '../../store/settings';
import type { Tool, ToolPointer } from './tool';

/** Tap to add text, tap a text to edit it, drag a text to move it. */
export class TextTool implements Tool {
  readonly id = 'text' as const;
  private drag: { layer: Layer; start: TextProps; p0: ToolPointer; moved: boolean } | null = null;
  /** Set when a new text was just created, so the UI can select its placeholder. */
  justCreated: Layer | null = null;

  constructor(private ed: Editor) {}

  /** Topmost visible text layer under a document point. */
  hit(x: number, y: number): Layer | null {
    const layers = this.ed.doc.allLayers();
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i];
      if (l.text && this.ed.doc.isVisible(l) && pointInPolygon({ x, y }, textCorners(l.text, 10 / this.ed.viewport.zoom))) return l;
    }
    return null;
  }

  down(e: ToolPointer): void {
    const ed = this.ed;
    const hit = this.hit(e.x, e.y);
    if (hit) {
      if (ed.doc.active !== hit) ed.setActive(hit);
      ed.beginTextEdit(hit);
      this.drag = { layer: hit, start: structuredClone(hit.text!), p0: e, moved: false };
      return;
    }
    const d = getSettings().textDefaults;
    const props = defaultText(e.x, e.y, {
      font: d.font,
      size: d.size,
      vertical: d.vertical,
      bold: d.bold,
      strokeWidth: d.strokeWidth,
      color: rgbToHex(...currentRGB()),
      text: d.vertical ? 'テキスト' : 'Text',
    });
    // Center the new block on the tap.
    const m = measureText(props);
    props.x = d.vertical ? e.x + m.w / 2 : e.x - m.w / 2;
    props.y = e.y - m.h / 2;
    this.justCreated = ed.addTextLayer(props);
  }

  move(events: ToolPointer[]): void {
    const d = this.drag;
    if (!d) return;
    const e = events[events.length - 1];
    if (Math.hypot(e.sx - d.p0.sx, e.sy - d.p0.sy) > 3) d.moved = true;
    if (!d.moved) return;
    this.ed.updateText(d.layer, { ...structuredClone(d.layer.text!), x: d.start.x + e.x - d.p0.x, y: d.start.y + e.y - d.p0.y });
  }

  up(): void {
    const d = this.drag;
    this.drag = null;
    if (d?.moved) {
      // Record the move as its own step; typing afterwards starts a new one.
      this.ed.endTextEdit();
    }
  }

  cancel(): void {
    this.drag = null;
  }

  deactivate(): void {
    this.ed.endTextEdit();
  }

  overlay(ctx: CanvasRenderingContext2D): void {
    const l = this.ed.doc.activeLayer();
    if (!l?.text) return;
    const v = this.ed.viewport;
    const pts = textCorners(l.text, 6 / v.zoom).map((p) => v.toScreen(p.x, p.y));
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#3d8bff';
    ctx.stroke();
    ctx.setLineDash([]);
  }
}
