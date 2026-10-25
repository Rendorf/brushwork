import { OP_REPLACE } from '../blendModes';
import { Selection, type Layer } from '../document';
import type { Corners, Editor } from '../editor';
import { drawFullscreen, Surface } from '../gl/gl';
import { CompoundEntry, type HistoryEntry, type PixelEntry } from '../history';
import { rectFromPoints, union, type Rect } from '../util/geom';
import { getSettings } from '../../store/settings';
import type { Tool, ToolPointer } from './tool';

interface Session {
  layer: Layer;
  entry: PixelEntry;
  float: Surface;
  /** Source rectangle (document pixels) the content came from. */
  src: Rect;
  /** Selection that was active, restored on cancel. */
  savedSel: Selection | null;
  cx: number;
  cy: number;
  sx: number;
  sy: number;
  rot: number;
}

type Handle = { kind: 'move' } | { kind: 'rotate' } | { kind: 'scale'; ix: number; iy: number };

const HANDLE_R = 14;

/** Move / scale / rotate / flip the active layer or the selected pixels. */
export class TransformTool implements Tool {
  readonly id = 'transform' as const;
  private s: Session | null = null;
  private drag: { h: Handle; p0: ToolPointer; start: Session } | null = null;

  constructor(private ed: Editor) {}

  busy(): boolean {
    return !!this.s;
  }

  activate(): void {
    this.begin();
  }

  deactivate(): void {
    this.commit();
  }

  /** Start a transform session on the active layer. */
  begin(): boolean {
    if (this.s) return true;
    const ed = this.ed;
    const layer = ed.editableLayer();
    if (!layer) return false;
    const sel = ed.doc.selection;
    const src = sel?.bounds ?? ed.contentBounds(layer);
    if (!src) {
      ed.toast('This layer is empty — nothing to transform.');
      return false;
    }
    const entry = ed.beginPixels('Transform');
    entry.capture(layer, src);
    const float = new Surface(ed.gl, src.w + 2, src.h + 2);
    float.clear();
    const tmp = new Surface(ed.gl, src.w + 2, src.h + 2);
    tmp.clear();
    layer.surface.blitTo(tmp, src.x, src.y, src.w, src.h, 1, 1);
    if (sel) {
      const p = ed.progs.mask.use();
      float.target();
      p.tex('u_src', 0, tmp.tex).iv2('u_srcOff', 0, 0).tex('u_sel', 1, sel.surface.tex).iv2('u_selOff', src.x - 1, src.y - 1).b('u_invert', false);
      drawFullscreen(ed.gl);
      ed.maskLayer(layer, src, true, sel);
    } else {
      tmp.blitTo(float, 0, 0, tmp.w, tmp.h, 0, 0);
      layer.surface.clear(src.x, src.y, src.w, src.h);
    }
    tmp.dispose();
    layer.touch();
    ed.doc.selection = null;
    this.s = { layer, entry, float, src, savedSel: sel, cx: src.x + src.w / 2, cy: src.y + src.h / 2, sx: 1, sy: 1, rot: 0 };
    ed.compositor.preview = {
      layer,
      render: (target, r) => {
        const c = ed.progs.composite.use();
        target.target(0, 0, r.w, r.h);
        c.tex('u_dst', 0, layer.surface.tex).iv2('u_dstOff', 0, 0).b('u_hasDst', false);
        c.tex('u_src', 1, layer.surface.tex).iv2('u_srcOff', r.x, r.y).f('u_opacity', 1).i('u_mode', OP_REPLACE).b('u_atop', false);
        drawFullscreen(ed.gl);
        if (this.s) ed.drawQuad(target, this.s.float, this.corners(this.s), { x: 0, y: 0, w: r.w, h: r.h }, { viewportOrigin: [r.x, r.y] });
      },
    };
    this.lastBounds = this.bounds(this.s);
    ed.invalidate(src);
    ed.changed();
    return true;
  }

  /** Quad corners (TL, TR, BR, BL) in document pixels, including the 1px padding. */
  corners(s: Session): Corners {
    const hw = (s.src.w + 2) / 2;
    const hh = (s.src.h + 2) / 2;
    const out: number[] = [];
    for (const [ix, iy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const p = this.local(s, ix * hw, iy * hh);
      out.push(p.x, p.y);
    }
    return out as Corners;
  }

  private local(s: Session, lx: number, ly: number) {
    const c = Math.cos(s.rot), n = Math.sin(s.rot);
    const x = lx * s.sx, y = ly * s.sy;
    return { x: s.cx + c * x - n * y, y: s.cy + n * x + c * y };
  }

  private bounds(s: Session): Rect | null {
    const c = this.corners(s);
    return this.ed.clampRect(rectFromPoints([{ x: c[0], y: c[1] }, { x: c[2], y: c[3] }, { x: c[4], y: c[5] }, { x: c[6], y: c[7] }], 2));
  }

  private update(): void {
    const s = this.s!;
    this.ed.invalidate(union(this.lastBounds, this.bounds(s)));
    this.lastBounds = this.bounds(s);
  }
  private lastBounds: Rect | null = null;

  // --- pointer handling ------------------------------------------------------

  private hit(e: ToolPointer): Handle {
    const s = this.s!;
    const v = this.ed.viewport;
    const hw = s.src.w / 2, hh = s.src.h / 2;
    for (const ix of [-1, 0, 1]) {
      for (const iy of [-1, 0, 1]) {
        if (ix === 0 && iy === 0) continue;
        const d = this.local(s, ix * hw, iy * hh);
        const sp = v.toScreen(d.x, d.y);
        if (Math.hypot(sp.x - e.sx, sp.y - e.sy) <= HANDLE_R + 6) return { kind: 'scale', ix, iy };
      }
    }
    const rh = this.rotateHandle(s);
    if (Math.hypot(rh.x - e.sx, rh.y - e.sy) <= HANDLE_R + 6) return { kind: 'rotate' };
    // Inside the box moves; outside rotates.
    const c = Math.cos(-s.rot), n = Math.sin(-s.rot);
    const dx = e.x - s.cx, dy = e.y - s.cy;
    const lx = (c * dx - n * dy) / s.sx, ly = (n * dx + c * dy) / s.sy;
    if (Math.abs(lx) <= hw && Math.abs(ly) <= hh) return { kind: 'move' };
    return { kind: 'rotate' };
  }

  private rotateHandle(s: Session) {
    const v = this.ed.viewport;
    const top = v.toScreen(...xy(this.local(s, 0, -s.src.h / 2)));
    const ctr = v.toScreen(s.cx, s.cy);
    const dx = top.x - ctr.x, dy = top.y - ctr.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: top.x + (dx / len) * 34, y: top.y + (dy / len) * 34 };
  }

  down(e: ToolPointer): void {
    if (!this.s && !this.begin()) return;
    this.drag = { h: this.hit(e), p0: e, start: { ...this.s! } };
  }

  move(events: ToolPointer[]): void {
    const d = this.drag;
    const s = this.s;
    if (!d || !s) return;
    const e = events[events.length - 1];
    const st = d.start;
    if (d.h.kind === 'move') {
      s.cx = st.cx + e.x - d.p0.x;
      s.cy = st.cy + e.y - d.p0.y;
    } else if (d.h.kind === 'rotate') {
      const a0 = Math.atan2(d.p0.y - st.cy, d.p0.x - st.cx);
      const a1 = Math.atan2(e.y - st.cy, e.x - st.cx);
      let r = st.rot + a1 - a0;
      if (e.shift) r = Math.round(r / (Math.PI / 12)) * (Math.PI / 12);
      s.rot = r;
    } else {
      const { ix, iy } = d.h;
      const W = st.src.w, H = st.src.h;
      // The opposite handle stays fixed.
      const anchor = this.local(st, (-ix * W) / 2, (-iy * H) / 2);
      const c = Math.cos(-st.rot), n = Math.sin(-st.rot);
      const dx = e.x - anchor.x, dy = e.y - anchor.y;
      const vx = c * dx - n * dy, vy = n * dx + c * dy;
      let sx = ix ? vx / (ix * W) : st.sx;
      let sy = iy ? vy / (iy * H) : st.sy;
      const keep = getSettings().transformKeepAspect !== e.shift;
      if (keep && ix && iy) {
        const t = (sx * st.sx + sy * st.sy) / (st.sx * st.sx + st.sy * st.sy);
        sx = t * st.sx;
        sy = t * st.sy;
      }
      if (Math.abs(sx) < 0.01) sx = 0.01 * Math.sign(sx || 1);
      if (Math.abs(sy) < 0.01) sy = 0.01 * Math.sign(sy || 1);
      s.sx = sx;
      s.sy = sy;
      const off = { x: (ix * W * sx) / 2, y: (iy * H * sy) / 2 };
      const cr = Math.cos(st.rot), nr = Math.sin(st.rot);
      s.cx = anchor.x + cr * off.x - nr * off.y;
      s.cy = anchor.y + nr * off.x + cr * off.y;
    }
    this.update();
  }

  up(): void {
    this.drag = null;
  }

  cancel(): void {
    this.drag = null;
  }

  // --- buttons -----------------------------------------------------------------

  flip(axis: 'h' | 'v'): void {
    if (!this.s && !this.begin()) return;
    if (axis === 'h') this.s!.sx *= -1;
    else this.s!.sy *= -1;
    this.update();
  }

  rotate90(): void {
    if (!this.s && !this.begin()) return;
    this.s!.rot += Math.PI / 2;
    this.update();
  }

  reset(): void {
    const s = this.s;
    if (!s) return;
    Object.assign(s, { cx: s.src.x + s.src.w / 2, cy: s.src.y + s.src.h / 2, sx: 1, sy: 1, rot: 0 });
    this.update();
  }

  /** Fit the content into the canvas, keeping its aspect ratio. */
  fitCanvas(): void {
    if (!this.s && !this.begin()) return;
    const s = this.s!;
    const k = Math.min(this.ed.doc.width / s.src.w, this.ed.doc.height / s.src.h);
    Object.assign(s, { cx: this.ed.doc.width / 2, cy: this.ed.doc.height / 2, sx: k, sy: k, rot: 0 });
    this.update();
  }

  isIdentity(s: Session): boolean {
    return s.sx === 1 && s.sy === 1 && Math.abs(s.rot) < 1e-9 && Math.abs(s.cx - (s.src.x + s.src.w / 2)) < 1e-6 && Math.abs(s.cy - (s.src.y + s.src.h / 2)) < 1e-6;
  }

  commit(): void {
    const s = this.s;
    if (!s) return;
    const ed = this.ed;
    if (this.isIdentity(s)) return this.cancelSession();
    this.s = null;
    this.drag = null;
    ed.compositor.preview = null;
    const r = this.bounds(s);
    if (r) {
      s.entry.capture(s.layer, r);
      ed.drawQuad(s.layer.surface, s.float, this.corners(s), r);
      s.layer.touch();
    }
    const parts: HistoryEntry[] = [s.entry];
    // Move the selection with the pixels.
    if (s.savedSel) {
      const before = s.savedSel;
      const after = this.transformSelection(s, before);
      ed.doc.selection = after;
      const W = ed.doc.width, H = ed.doc.height;
      const bm = before.mask.slice();
      const am = after?.mask.slice() ?? null;
      const setSel = (m: Uint8Array | null) => {
        ed.doc.selection?.dispose();
        ed.doc.selection = m ? new Selection(ed.gl, W, H, m.slice()) : null;
        ed.changed();
      };
      before.dispose();
      parts.push({ label: 'Transform', bytes: bm.byteLength + (am?.byteLength ?? 0), undo: () => setSel(bm), redo: () => setSel(am) });
    }
    s.float.dispose();
    ed.invalidate(union(s.src, r));
    ed.history.push(new CompoundEntry('Transform', parts));
  }

  /** Abandon the session and restore the original pixels. */
  cancelSession(): void {
    const s = this.s;
    if (!s) return;
    this.s = null;
    this.drag = null;
    const ed = this.ed;
    ed.compositor.preview = null;
    s.entry.rollback();
    ed.doc.selection = s.savedSel;
    s.float.dispose();
    ed.invalidate(union(s.src, this.bounds(s)));
    ed.changed();
  }

  /** Finish and go back to the previous tool (OK / Cancel buttons). */
  finish(apply: boolean): void {
    if (apply) this.commit();
    else this.cancelSession();
    const prev = this.ed.previousTool;
    this.ed.setTool(prev === 'transform' ? 'brush' : prev);
  }

  private transformSelection(s: Session, sel: Selection): Selection | null {
    const ed = this.ed;
    const { w: W, h: H } = sel;
    const src = s.src;
    const crop = document.createElement('canvas');
    crop.width = src.w;
    crop.height = src.h;
    const cctx = crop.getContext('2d')!;
    const img = cctx.createImageData(src.w, src.h);
    for (let y = 0; y < src.h; y++) {
      for (let x = 0; x < src.w; x++) {
        img.data[(y * src.w + x) * 4 + 3] = sel.mask[(src.y + y) * W + src.x + x];
      }
    }
    cctx.putImageData(img, 0, 0);
    const full = document.createElement('canvas');
    full.width = W;
    full.height = H;
    const f = full.getContext('2d')!;
    f.translate(s.cx, s.cy);
    f.rotate(s.rot);
    f.scale(s.sx, s.sy);
    f.drawImage(crop, -src.w / 2, -src.h / 2);
    const data = f.getImageData(0, 0, W, H).data;
    const m = new Uint8Array(W * H);
    for (let i = 0; i < m.length; i++) m[i] = data[i * 4 + 3];
    const out = new Selection(ed.gl, W, H, m);
    if (out.isEmpty()) {
      out.dispose();
      return null;
    }
    return out;
  }

  overlay(ctx: CanvasRenderingContext2D): void {
    const s = this.s;
    if (!s) return;
    const v = this.ed.viewport;
    const hw = s.src.w / 2, hh = s.src.h / 2;
    const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([ix, iy]) => v.toScreen(...xy(this.local(s, ix * hw, iy * hh))));
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#3d8bff';
    ctx.stroke();
    const rh = this.rotateHandle(s);
    const top = v.toScreen(...xy(this.local(s, 0, -hh)));
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(rh.x, rh.y);
    ctx.stroke();
    const dot = (x: number, y: number, round: boolean) => {
      ctx.beginPath();
      if (round) ctx.arc(x, y, 7, 0, Math.PI * 2);
      else ctx.rect(x - 6, y - 6, 12, 12);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#3d8bff';
      ctx.stroke();
    };
    for (const ix of [-1, 0, 1]) {
      for (const iy of [-1, 0, 1]) {
        if (ix === 0 && iy === 0) continue;
        const p = v.toScreen(...xy(this.local(s, ix * hw, iy * hh)));
        dot(p.x, p.y, false);
      }
    }
    dot(rh.x, rh.y, true);
  }
}

const xy = (p: { x: number; y: number }): [number, number] => [p.x, p.y];
