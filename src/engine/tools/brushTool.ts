import { blendIndex, OP_ERASE } from '../blendModes';
import type { SmudgeState } from '../brush/brushEngine';
import { getBrush } from '../brush/library';
import type { BrushParams } from '../brush/presets';
import { DabGenerator, Stabilizer, type Dab, type StrokePoint } from '../brush/stroke';
import type { Layer } from '../document';
import type { Editor } from '../editor';
import { RulerSnap, symmetryMatrices, transformDab, type P } from '../guides';
import type { PixelEntry } from '../history';
import { union, type Mat2D, type Rect } from '../util/geom';
import { currentRGB, getSettings, pushColorHistory, type BrushToolId } from '../../store/settings';
import type { Tool, ToolPointer } from './tool';

interface ActiveStroke {
  layer: Layer;
  brush: BrushParams;
  gen: DabGenerator;
  stab: Stabilizer;
  snap: RulerSnap | null;
  /** Symmetry transforms (identity first), or null for a single stroke. */
  mats: Mat2D[] | null;
  kind: 'buffer' | 'smudge' | 'blur';
  opacity: number;
  mode: number;
  bbox: Rect | null;
  entry: PixelEntry | null;
  /** One smudge carry buffer per symmetry copy. */
  smudge: SmudgeState[];
}

/** Resolve the brush a brush-type tool is using, including the user's tweaks. */
export function toolBrush(tool: BrushToolId): BrushParams {
  const ts = getSettings().brushTools[tool];
  const base = getBrush(ts.presetId);
  return { ...base, ...(ts.overrides[base.id] ?? {}) };
}

const toStroke = (e: ToolPointer): StrokePoint => ({ x: e.x, y: e.y, p: e.pressure, t: e.time, tiltX: e.tiltX, tiltY: e.tiltY });

/** Brush, eraser, smudge and blur tools. */
export class BrushTool implements Tool {
  private s: ActiveStroke | null = null;

  constructor(private ed: Editor, readonly id: BrushToolId) {}

  busy(): boolean {
    return !!this.s;
  }

  down(e: ToolPointer): void {
    if (this.start(true)) this.feed([toStroke(e)]);
  }

  move(events: ToolPointer[]): void {
    if (this.s) this.feed(events.map(toStroke));
  }

  up(e: ToolPointer): void {
    if (!this.s) return;
    this.feed([toStroke(e)]);
    this.finish();
  }

  /**
   * Draw a stroke along a path with this tool's brush at full pressure (shape tool).
   * No stabilizer, ruler or symmetry is applied.
   */
  strokePath(pts: P[], closed: boolean): void {
    if (pts.length < 2) return;
    const path = closed ? [...pts, pts[0]] : pts;
    // Dense points keep the curve smoothing from rounding corners.
    const dense: StrokePoint[] = [];
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 2));
      for (let k = 0; k < n; k++) dense.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n, p: 1, t: 0 });
    }
    const last = path[path.length - 1];
    dense.push({ x: last.x, y: last.y, p: 1, t: 0 });
    if (!this.start(false)) return;
    this.feed(dense);
    this.finish();
  }

  private start(interactive: boolean): boolean {
    const ed = this.ed;
    const layer = ed.editableLayer();
    if (!layer) return false;
    const settings = getSettings();
    const ts = settings.brushTools[this.id];
    const brush = toolBrush(this.id);
    let kind: ActiveStroke['kind'] = 'buffer';
    if (this.id === 'smudge') kind = 'smudge';
    else if (this.id === 'blur') kind = 'blur';
    else if (this.id === 'brush' && brush.mode !== 'paint') kind = brush.mode;

    const zoom = ed.viewport.zoom;
    const g = ed.doc.guides;
    const gen = new DabGenerator(brush, {
      size: ts.size,
      color: currentRGB(),
      seed: (Math.random() * 1e9) | 0,
      pressureGamma: settings.pressureGamma,
    });
    const stab = new Stabilizer(interactive ? settings.stabilizer : 0, settings.stabilizerMode, (settings.stabilizer * 0.5) / zoom);
    const snap = interactive && g.rulerOn && g.ruler ? new RulerSnap(g.ruler, 14 / zoom, 8 / zoom) : null;
    const mats = interactive && g.symmetryOn && g.symmetry ? symmetryMatrices(g.symmetry) : null;
    const mode = this.id === 'eraser' ? OP_ERASE : blendIndex(brush.blendMode);
    const side = Math.ceil(ts.size * brush.dabScale * (1 + brush.sizeJitter)) + 4;
    const s: ActiveStroke = {
      layer, brush, gen, stab, snap, mats, kind, mode,
      opacity: ts.opacity * (kind === 'buffer' ? brush.opacity : 1),
      bbox: null,
      entry: null,
      smudge: (mats ?? [null]).map(() => ({ carry: null, side })),
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
    return true;
  }

  private finish(): void {
    const s = this.s;
    if (!s) return;
    const dabs: Dab[] = [];
    for (const p of s.stab.finish()) this.push(p, dabs);
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
      s.smudge.forEach((st) => ed.brush.endSmudge(st));
      s.entry?.rollback();
    }
  }

  deactivate(): void {
    this.cancel();
  }

  /** Stabilize, snap to the ruler and turn one point into dabs. */
  private push(pt: StrokePoint, out: Dab[]): void {
    const s = this.s!;
    let sp = s.stab.push(pt);
    if (!sp) return;
    if (s.snap) {
      const q = s.snap.project(sp);
      if (!q) return;
      sp = { ...sp, x: q.x, y: q.y };
    }
    out.push(...s.gen.add(sp));
  }

  private feed(points: StrokePoint[]): void {
    const dabs: Dab[] = [];
    for (const p of points) this.push(p, dabs);
    this.render(dabs);
  }


  private render(dabs: Dab[]): void {
    const s = this.s!;
    if (!dabs.length) return;
    const ed = this.ed;
    if (s.kind === 'buffer') {
      const r = ed.brush.drawDabs(ed.strokeBuffer, repeat(dabs, s.mats), s.brush);
      s.bbox = union(s.bbox, r);
      ed.invalidate(r);
      return;
    }
    const sel = ed.doc.selection?.surface ?? null;
    const mats = s.mats ?? [null];
    for (const d0 of dabs) {
      mats.forEach((m, i) => {
        const d = m ? transformDab(d0, m) : d0;
        const side = s.kind === 'blur' ? Math.ceil(d.size) + 2 + 2 * (Math.ceil(Math.max(1, d.size * 0.12 * (0.3 + s.brush.strength))) + 2) : s.smudge[i].side;
        const pre = ed.brush.dabRect(d, side, ed.doc.width, ed.doc.height);
        if (pre) s.entry!.capture(s.layer, pre);
        const r = s.kind === 'smudge'
          ? ed.brush.smudgeDab(s.layer.surface, d, s.brush, s.smudge[i], sel, s.layer.alphaLock)
          : ed.brush.blurDab(s.layer.surface, d, s.brush, sel, s.layer.alphaLock);
        if (r) {
          s.bbox = union(s.bbox, r);
          s.layer.touch();
          ed.invalidate(r);
        }
      });
    }
  }

  private commit(): void {
    const s = this.s!;
    this.s = null;
    const ed = this.ed;
    if (s.kind !== 'buffer') {
      s.smudge.forEach((st) => ed.brush.endSmudge(st));
      if (s.entry && !s.entry.isEmpty) ed.history.push(s.entry);
      return;
    }
    if (s.brush.taperOut > 0 && s.gen.dabs.length > 1) {
      // Re-render the whole stroke now that its length (and so the fade-out) is known.
      const old = ed.clampRect(s.bbox);
      if (old) ed.strokeBuffer.clear(old.x, old.y, old.w, old.h);
      const r = ed.brush.drawDabs(ed.strokeBuffer, repeat(s.gen.dabs, s.mats), s.brush, (d) => s.gen.taperOutFactor(d));
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

/** Repeat dabs for every symmetry transform. */
function repeat(dabs: Dab[], mats: Mat2D[] | null): Dab[] {
  if (!mats) return dabs;
  const out: Dab[] = [];
  for (const d of dabs) for (const m of mats) out.push(transformDab(d, m));
  return out;
}
