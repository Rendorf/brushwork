import { OP_REPLACE } from '../blendModes';
import { Selection, type Layer } from '../document';
import type { Corners, Editor } from '../editor';
import { drawFullscreen, Surface } from '../gl/gl';
import type { P } from '../guides';
import { CompoundEntry, type HistoryEntry, type PixelEntry } from '../history';
import { rectFromPoints, union, type Rect } from '../util/geom';
import { applyMat3, denseMesh, isConvexQuad, meshFrom, meshPoint, squareToQuad, type Mesh } from '../warp';
import { getSettings } from '../../store/settings';
import type { Tool, ToolPointer } from './tool';

export type TransformMode = 'free' | 'distort' | 'mesh';

interface Session {
  layer: Layer;
  entry: PixelEntry;
  /** The lifted pixels, with a 1px transparent border for clean edges. */
  float: Surface;
  /** Source rectangle (document pixels) the content came from. */
  src: Rect;
  /** Selection that was active, restored on cancel. */
  savedSel: Selection | null;
  mode: TransformMode;
  // Free transform
  cx: number;
  cy: number;
  sx: number;
  sy: number;
  rot: number;
  /** Distort: corners TL, TR, BR, BL of the padded float. */
  quad: P[];
  /** Mesh: control grid over the padded float. */
  mesh: Mesh | null;
}

type Handle =
  | { kind: 'move' }
  | { kind: 'rotate' }
  | { kind: 'scale'; ix: number; iy: number }
  | { kind: 'point'; i: number }
  | { kind: 'moveAll' };

const HANDLE_R = 14;

/** Move / scale / rotate / flip, 4-corner distort and mesh warp of a layer or selection. */
export class TransformTool implements Tool {
  readonly id = 'transform' as const;
  private s: Session | null = null;
  private drag: { h: Handle; p0: ToolPointer; start: Session } | null = null;
  private lastBounds: Rect | null = null;
  /** Dense mesh for the current mesh shape; cleared whenever the shape changes. */
  private dense: ReturnType<typeof denseMesh> | null = null;

  constructor(private ed: Editor) {}

  busy(): boolean {
    return !!this.s;
  }

  get mode(): TransformMode {
    return this.s?.mode ?? 'free';
  }

  get meshSize(): number {
    return this.s?.mesh?.n ?? 3;
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
    const s: Session = {
      layer, entry, float, src, savedSel: sel, mode: 'free',
      cx: src.x + src.w / 2, cy: src.y + src.h / 2, sx: 1, sy: 1, rot: 0,
      quad: [], mesh: null,
    };
    s.quad = this.restQuad(s);
    this.s = s;
    ed.compositor.preview = {
      layer,
      render: (target, r) => {
        const c = ed.progs.composite.use();
        target.target(0, 0, r.w, r.h);
        c.tex('u_dst', 0, layer.surface.tex).iv2('u_dstOff', 0, 0).b('u_hasDst', false);
        c.tex('u_src', 1, layer.surface.tex).iv2('u_srcOff', r.x, r.y).f('u_opacity', 1).i('u_mode', OP_REPLACE).b('u_atop', false);
        drawFullscreen(ed.gl);
        if (this.s) this.renderWarp(this.s, this.s.float, target, { x: 0, y: 0, w: r.w, h: r.h }, [r.x, r.y]);
      },
    };
    this.lastBounds = this.bounds(s);
    ed.invalidate(src);
    ed.changed();
    return true;
  }

  // --- geometry ----------------------------------------------------------------

  /** Padded float corners at rest (TL, TR, BR, BL). */
  private restQuad(s: Session): P[] {
    const { x, y, w, h } = s.src;
    return [{ x: x - 1, y: y - 1 }, { x: x + w + 1, y: y - 1 }, { x: x + w + 1, y: y + h + 1 }, { x: x - 1, y: y + h + 1 }];
  }

  /** Free-transform quad corners, including the 1px padding. */
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

  private local(s: Session, lx: number, ly: number): P {
    const c = Math.cos(s.rot), n = Math.sin(s.rot);
    const x = lx * s.sx, y = ly * s.sy;
    return { x: s.cx + c * x - n * y, y: s.cy + n * x + c * y };
  }

  /** Where texture point (u, v) of the float lands, for the current mode. */
  private mapUV(s: Session, u: number, v: number): P {
    if (s.mode === 'mesh' && s.mesh) return meshPoint(s.mesh, u, v);
    if (s.mode === 'distort') return applyMat3(squareToQuad(s.quad), u, v);
    const c = this.corners(s);
    // Free transform is affine, so bilinear interpolation of the corners is exact.
    const top = { x: c[0] + (c[2] - c[0]) * u, y: c[1] + (c[3] - c[1]) * u };
    const bot = { x: c[6] + (c[4] - c[6]) * u, y: c[7] + (c[5] - c[7]) * u };
    return { x: top.x + (bot.x - top.x) * v, y: top.y + (bot.y - top.y) * v };
  }

  private outlinePoints(s: Session): P[] {
    if (s.mode === 'free') {
      const c = this.corners(s);
      return [{ x: c[0], y: c[1] }, { x: c[2], y: c[3] }, { x: c[4], y: c[5] }, { x: c[6], y: c[7] }];
    }
    if (s.mode === 'distort') return s.quad;
    const pts: P[] = [];
    for (let i = 0; i <= 32; i++) {
      const t = i / 32;
      pts.push(this.mapUV(s, t, 0), this.mapUV(s, t, 1), this.mapUV(s, 0, t), this.mapUV(s, 1, t));
    }
    return pts;
  }

  private bounds(s: Session): Rect | null {
    return this.ed.clampRect(rectFromPoints(this.outlinePoints(s), 2));
  }

  private update(): void {
    const s = this.s!;
    this.dense = null;
    const b = this.bounds(s);
    this.ed.invalidate(union(this.lastBounds, b));
    this.lastBounds = b;
    this.ed.requestRender();
  }

  /** Render `src` (float or a selection mask in the same layout) with the session's warp. */
  private renderWarp(s: Session, src: Surface, target: Surface, vp: Rect, origin: [number, number]): void {
    const ed = this.ed;
    if (s.mode === 'distort') {
      if (isConvexQuad(s.quad)) ed.drawProjective(target, src, s.quad, vp, origin);
    } else if (s.mode === 'mesh' && s.mesh) {
      const { verts, indices } = (this.dense ??= denseMesh(s.mesh));
      ed.drawMesh(target, src, verts, indices, vp, origin);
    } else {
      ed.drawQuad(target, src, this.corners(s), vp, { viewportOrigin: origin });
    }
  }

  // --- modes -------------------------------------------------------------------

  setMode(mode: TransformMode, meshN?: number): void {
    if (!this.s && !this.begin()) return;
    const s = this.s!;
    if (mode === 'distort') {
      s.quad = [this.mapUV(s, 0, 0), this.mapUV(s, 1, 0), this.mapUV(s, 1, 1), this.mapUV(s, 0, 1)];
    } else if (mode === 'mesh') {
      const n = meshN ?? s.mesh?.n ?? 3;
      s.mesh = meshFrom(n, (u, v) => this.mapUV(s, u, v));
    } else if (s.mode !== 'free') {
      // Warps cannot be expressed as move/scale/rotate: start the free transform fresh.
      this.ed.toast('Switched to free transform — the warp was reset.');
    }
    s.mode = mode;
    this.update();
    this.ed.changed();
  }

  // --- pointer handling ------------------------------------------------------

  private hit(e: ToolPointer): Handle | null {
    const s = this.s!;
    const v = this.ed.viewport;
    const near = (p: P) => {
      const sp = v.toScreen(p.x, p.y);
      return Math.hypot(sp.x - e.sx, sp.y - e.sy) <= HANDLE_R + 6;
    };
    if (s.mode !== 'free') {
      const pts = s.mode === 'distort' ? s.quad : s.mesh!.pts;
      let best = -1, bd = Infinity;
      pts.forEach((p, i) => {
        const sp = v.toScreen(p.x, p.y);
        const d = Math.hypot(sp.x - e.sx, sp.y - e.sy);
        if (d < bd) { bd = d; best = i; }
      });
      if (bd <= HANDLE_R + 8) return { kind: 'point', i: best };
      const ring = s.mode === 'distort' ? s.quad : this.meshRing(s);
      return pointInPolygon({ x: e.x, y: e.y }, ring) ? { kind: 'moveAll' } : null;
    }
    const hw = s.src.w / 2, hh = s.src.h / 2;
    for (const ix of [-1, 0, 1]) {
      for (const iy of [-1, 0, 1]) {
        if (ix === 0 && iy === 0) continue;
        if (near(this.local(s, ix * hw, iy * hh))) return { kind: 'scale', ix, iy };
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

  private meshRing(s: Session): P[] {
    const ring: P[] = [];
    const steps = 24;
    for (let i = 0; i < steps; i++) ring.push(this.mapUV(s, i / steps, 0));
    for (let i = 0; i < steps; i++) ring.push(this.mapUV(s, 1, i / steps));
    for (let i = steps; i > 0; i--) ring.push(this.mapUV(s, i / steps, 1));
    for (let i = steps; i > 0; i--) ring.push(this.mapUV(s, 0, i / steps));
    return ring;
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
    const h = this.hit(e);
    this.drag = h ? { h, p0: e, start: cloneSession(this.s!) } : null;
  }

  move(events: ToolPointer[]): void {
    const d = this.drag;
    const s = this.s;
    if (!d || !s) return;
    const e = events[events.length - 1];
    const st = d.start;
    const dx = e.x - d.p0.x, dy = e.y - d.p0.y;
    if (d.h.kind === 'point') {
      const i = d.h.i;
      if (s.mode === 'distort') s.quad[i] = { x: st.quad[i].x + dx, y: st.quad[i].y + dy };
      else s.mesh!.pts[i] = { x: st.mesh!.pts[i].x + dx, y: st.mesh!.pts[i].y + dy };
    } else if (d.h.kind === 'moveAll') {
      if (s.mode === 'distort') s.quad = st.quad.map((p) => ({ x: p.x + dx, y: p.y + dy }));
      else s.mesh!.pts = st.mesh!.pts.map((p) => ({ x: p.x + dx, y: p.y + dy }));
    } else if (d.h.kind === 'move') {
      s.cx = st.cx + dx;
      s.cy = st.cy + dy;
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
      const ax = e.x - anchor.x, ay = e.y - anchor.y;
      const vx = c * ax - n * ay, vy = n * ax + c * ay;
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

  /** Apply a linear map to every control point around the shape's center (warp modes). */
  private mapPoints(fn: (p: P, c: P) => P): void {
    const s = this.s!;
    const c = this.mapUV(s, 0.5, 0.5);
    if (s.mode === 'distort') s.quad = s.quad.map((p) => fn(p, c));
    else if (s.mesh) s.mesh.pts = s.mesh.pts.map((p) => fn(p, c));
  }

  flip(axis: 'h' | 'v'): void {
    if (!this.s && !this.begin()) return;
    const s = this.s!;
    if (s.mode === 'free') {
      if (axis === 'h') s.sx *= -1;
      else s.sy *= -1;
    } else {
      this.mapPoints((p, c) => (axis === 'h' ? { x: 2 * c.x - p.x, y: p.y } : { x: p.x, y: 2 * c.y - p.y }));
    }
    this.update();
  }

  rotate90(): void {
    if (!this.s && !this.begin()) return;
    const s = this.s!;
    if (s.mode === 'free') s.rot += Math.PI / 2;
    else this.mapPoints((p, c) => ({ x: c.x - (p.y - c.y), y: c.y + (p.x - c.x) }));
    this.update();
  }

  reset(): void {
    const s = this.s;
    if (!s) return;
    Object.assign(s, { cx: s.src.x + s.src.w / 2, cy: s.src.y + s.src.h / 2, sx: 1, sy: 1, rot: 0 });
    s.quad = this.restQuad(s);
    if (s.mesh) s.mesh = meshFrom(s.mesh.n, (u, v) => this.mapUV({ ...s, mode: 'free' }, u, v));
    this.update();
  }

  /** Fit the content into the canvas, keeping its aspect ratio (free mode). */
  fitCanvas(): void {
    if (!this.s && !this.begin()) return;
    const s = this.s!;
    const k = Math.min(this.ed.doc.width / s.src.w, this.ed.doc.height / s.src.h);
    Object.assign(s, { mode: 'free', cx: this.ed.doc.width / 2, cy: this.ed.doc.height / 2, sx: k, sy: k, rot: 0 });
    this.update();
    this.ed.changed();
  }

  isIdentity(s: Session): boolean {
    const rest = this.restQuad(s);
    const same = (a: P, b: P) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
    if (s.mode === 'distort') return s.quad.every((p, i) => same(p, rest[i]));
    if (s.mode === 'mesh' && s.mesh) {
      const n = s.mesh.n;
      return s.mesh.pts.every((p, k) => {
        const u = (k % (n + 1)) / n, v = Math.floor(k / (n + 1)) / n;
        return same(p, { x: rest[0].x + (rest[1].x - rest[0].x) * u, y: rest[0].y + (rest[3].y - rest[0].y) * v });
      });
    }
    return s.sx === 1 && s.sy === 1 && Math.abs(s.rot) < 1e-9 && Math.abs(s.cx - (s.src.x + s.src.w / 2)) < 1e-6 && Math.abs(s.cy - (s.src.y + s.src.h / 2)) < 1e-6;
  }

  commit(): void {
    const s = this.s;
    if (!s) return;
    const ed = this.ed;
    if (this.isIdentity(s)) return this.cancelSession();
    if (s.mode === 'distort' && !isConvexQuad(s.quad)) {
      ed.toast('The corners cross each other — fix the shape or cancel.');
      return;
    }
    this.s = null;
    this.drag = null;
    ed.compositor.preview = null;
    const r = this.bounds(s);
    if (r) {
      s.entry.capture(s.layer, r);
      this.renderWarp(s, s.float, s.layer.surface, r, [r.x, r.y]);
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
    if (this.s) return;
    const prev = this.ed.previousTool;
    this.ed.setTool(prev === 'transform' ? 'brush' : prev);
  }

  /** Warp the selection mask exactly like the pixels, on the GPU. */
  private transformSelection(s: Session, sel: Selection): Selection | null {
    const ed = this.ed;
    const { w: W, h: H } = sel;
    const src = s.src;
    const fw = src.w + 2, fh = src.h + 2;
    const rgba = new Uint8Array(fw * fh * 4);
    for (let y = 0; y < src.h; y++) {
      for (let x = 0; x < src.w; x++) {
        const m = sel.mask[(src.y + y) * W + src.x + x];
        const i = ((y + 1) * fw + x + 1) * 4;
        rgba[i] = rgba[i + 1] = rgba[i + 2] = rgba[i + 3] = m;
      }
    }
    const maskSurf = new Surface(ed.gl, fw, fh);
    maskSurf.upload(0, 0, fw, fh, rgba);
    const r = this.bounds(s);
    const m = new Uint8Array(W * H);
    if (r) {
      const tmp = ed.pool.get(r.w, r.h);
      tmp.clear(0, 0, r.w, r.h);
      this.renderWarp(s, maskSurf, tmp, { x: 0, y: 0, w: r.w, h: r.h }, [r.x, r.y]);
      const px = tmp.read(0, 0, r.w, r.h);
      for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) m[(r.y + y) * W + r.x + x] = px[(y * r.w + x) * 4 + 3];
      ed.pool.release(tmp);
    }
    maskSurf.dispose();
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
    const S = (p: P) => v.toScreen(p.x, p.y);
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
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#3d8bff';
    if (s.mode === 'distort') {
      ctx.beginPath();
      s.quad.map(S).forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.stroke();
      s.quad.map(S).forEach((p) => dot(p.x, p.y, false));
      return;
    }
    if (s.mode === 'mesh' && s.mesh) {
      const n = s.mesh.n;
      ctx.beginPath();
      for (let k = 0; k <= n; k++) {
        for (const horizontal of [true, false]) {
          for (let i = 0; i <= 32; i++) {
            const t = i / 32;
            const p = S(horizontal ? this.mapUV(s, t, k / n) : this.mapUV(s, k / n, t));
            if (i) ctx.lineTo(p.x, p.y);
            else ctx.moveTo(p.x, p.y);
          }
        }
      }
      ctx.globalAlpha = 0.8;
      ctx.stroke();
      ctx.globalAlpha = 1;
      s.mesh.pts.map(S).forEach((p) => dot(p.x, p.y, true));
      return;
    }
    const hw = s.src.w / 2, hh = s.src.h / 2;
    const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([ix, iy]) => S(this.local(s, ix * hw, iy * hh)));
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.stroke();
    const rh = this.rotateHandle(s);
    const top = S(this.local(s, 0, -hh));
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(rh.x, rh.y);
    ctx.stroke();
    for (const ix of [-1, 0, 1]) {
      for (const iy of [-1, 0, 1]) {
        if (ix === 0 && iy === 0) continue;
        const p = S(this.local(s, ix * hw, iy * hh));
        dot(p.x, p.y, false);
      }
    }
    dot(rh.x, rh.y, true);
  }
}

const xy = (p: { x: number; y: number }): [number, number] => [p.x, p.y];

function cloneSession(s: Session): Session {
  return { ...s, quad: s.quad.map((p) => ({ ...p })), mesh: s.mesh ? { n: s.mesh.n, pts: s.mesh.pts.map((p) => ({ ...p })) } : null };
}

function pointInPolygon(p: P, poly: P[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
