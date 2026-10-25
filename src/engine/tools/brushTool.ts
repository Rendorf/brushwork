import { blendIndex, OP_ERASE } from '../blendModes';
import type { SmudgeState } from '../brush/brushEngine';
import { getPreset, type BrushParams } from '../brush/presets';
import { DabGenerator, Stabilizer, type Dab, type StrokePoint } from '../brush/stroke';
import type { Layer } from '../document';
import type { Editor } from '../editor';
import type { PixelEntry } from '../history';
import { union, type Rect } from '../util/geom';
import { currentRGB, getSettings, pushColorHistory, type BrushToolId } from '../../store/settings';
import type { Tool, ToolPointer } from './tool';

interface ActiveStroke {
  layer: Layer;
  brush: BrushParams;
  gen: DabGenerator;
  stab: Stabilizer;
  kind: 'buffer' | 'smudge' | 'blur';
  opacity: number;
  mode: number;
  bbox: Rect | null;
  entry: PixelEntry | null;
  smudge: SmudgeState;
}

/** Resolve the brush a brush-type tool is using, including the user's tweaks. */
export function toolBrush(tool: BrushToolId): BrushParams {
  const ts = getSettings().brushTools[tool];
  const base = getPreset(ts.presetId);
  return { ...base, ...(ts.overrides[base.id] ?? {}) };
}

/** Brush, eraser, smudge and blur tools. */
export class BrushTool implements Tool {
  private s: ActiveStroke | null = null;

  constructor(private ed: Editor, readonly id: BrushToolId) {}

  busy(): boolean {
    return !!this.s;
  }

  down(e: ToolPointer): void {
    const ed = this.ed;
    const layer = ed.editableLayer();
    if (!layer) return;
    const settings = getSettings();
    const ts = settings.brushTools[this.id];
    const brush = toolBrush(this.id);
    let kind: ActiveStroke['kind'] = 'buffer';
    if (this.id === 'smudge') kind = 'smudge';
    else if (this.id === 'blur') kind = 'blur';
    else if (this.id === 'brush' && brush.mode !== 'paint') kind = brush.mode;

    const gen = new DabGenerator(brush, {
      size: ts.size,
      color: currentRGB(),
      seed: (Math.random() * 1e9) | 0,
      pressureGamma: settings.pressureGamma,
    });
    const ropeRadius = (settings.stabilizer * 0.5) / ed.viewport.zoom;
    const stab = new Stabilizer(settings.stabilizer, settings.stabilizerMode, ropeRadius);
    const mode = this.id === 'eraser' ? OP_ERASE : blendIndex(brush.blendMode);
    const s: ActiveStroke = {
      layer, brush, gen, stab, kind, mode,
      opacity: ts.opacity * (kind === 'buffer' ? brush.opacity : 1),
      bbox: null,
      entry: null,
      smudge: { carry: null, side: Math.ceil(ts.size * brush.dabScale * (1 + brush.sizeJitter)) + 4 },
    };
    this.s = s;
    if (kind === 'buffer') {
      ed.compositor.preview = {
        layer,
        render: (target, r) => ed.previewStroke(target, layer, r, s.opacity, s.mode, brush.wetEdge),
      };
    } else {
      s.entry = ed.beginPixels(kind === 'smudge' ? 'Smudge' : 'Blur');
    }
    this.feed([e]);
  }

  move(events: ToolPointer[]): void {
    if (this.s) this.feed(events);
  }

  up(e: ToolPointer): void {
    const s = this.s;
    if (!s) return;
    this.feed([e]);
    const dabs: Dab[] = [];
    for (const p of s.stab.finish()) dabs.push(...s.gen.add(p));
    dabs.push(...s.gen.end());
    this.render(dabs);
    this.commit();
  }

  cancel(): void {
    const s = this.s;
    if (!s) return;
    this.s = null;
    const ed = this.ed;
    if (s.kind === 'buffer') {
      ed.compositor.preview = null;
      const r = ed.clampRect(s.bbox);
      if (r) ed.strokeBuffer.clear(r.x, r.y, r.w, r.h);
      ed.invalidate(r);
    } else {
      ed.brush.endSmudge(s.smudge);
      s.entry?.rollback();
    }
  }

  deactivate(): void {
    this.cancel();
  }

  private feed(events: ToolPointer[]): void {
    const s = this.s!;
    const dabs: Dab[] = [];
    for (const e of events) {
      const pt: StrokePoint = { x: e.x, y: e.y, p: e.pressure, t: e.time, tiltX: e.tiltX, tiltY: e.tiltY };
      const sp = s.stab.push(pt);
      if (sp) dabs.push(...s.gen.add(sp));
    }
    this.render(dabs);
  }

  private render(dabs: Dab[]): void {
    const s = this.s!;
    if (!dabs.length) return;
    const ed = this.ed;
    if (s.kind === 'buffer') {
      const r = ed.brush.drawDabs(ed.strokeBuffer, dabs, s.brush);
      s.bbox = union(s.bbox, r);
      ed.invalidate(r);
      return;
    }
    const sel = ed.doc.selection?.surface ?? null;
    for (const d of dabs) {
      const side = s.kind === 'blur' ? Math.ceil(d.size) + 2 + 2 * (Math.ceil(Math.max(1, d.size * 0.12 * (0.3 + s.brush.strength))) + 2) : s.smudge.side;
      const pre = ed.brush.dabRect(d, side, ed.doc.width, ed.doc.height);
      if (pre) s.entry!.capture(s.layer, pre);
      const r = s.kind === 'smudge'
        ? ed.brush.smudgeDab(s.layer.surface, d, s.brush, s.smudge, sel, s.layer.alphaLock)
        : ed.brush.blurDab(s.layer.surface, d, s.brush, sel, s.layer.alphaLock);
      if (r) {
        s.bbox = union(s.bbox, r);
        s.layer.touch();
        ed.invalidate(r);
      }
    }
  }

  private commit(): void {
    const s = this.s!;
    this.s = null;
    const ed = this.ed;
    if (s.kind !== 'buffer') {
      ed.brush.endSmudge(s.smudge);
      if (s.entry && !s.entry.isEmpty) ed.history.push(s.entry);
      return;
    }
    if (s.brush.taperOut > 0 && s.gen.dabs.length > 1) {
      // Re-render the whole stroke now that its length (and so the fade-out) is known.
      const old = ed.clampRect(s.bbox);
      if (old) ed.strokeBuffer.clear(old.x, old.y, old.w, old.h);
      const r = ed.brush.drawDabs(ed.strokeBuffer, s.gen.dabs, s.brush, (d) => s.gen.taperOutFactor(d));
      s.bbox = union(s.bbox, r);
    }
    ed.compositor.preview = null;
    const r = ed.clampRect(s.bbox);
    if (r) {
      const entry = ed.beginPixels(this.id === 'eraser' ? 'Erase' : 'Brush');
      entry.capture(s.layer, r);
      ed.mergeStroke(s.layer, r, s.opacity, s.mode, s.brush.wetEdge);
      ed.strokeBuffer.clear(r.x, r.y, r.w, r.h);
      ed.invalidate(r);
      ed.history.push(entry);
      if (this.id === 'brush') pushColorHistory();
    }
  }
}
