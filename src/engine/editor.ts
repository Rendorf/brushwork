import { blendIndex, type FolderBlendMode } from './blendModes';
import { BrushEngine } from './brush/brushEngine';
import { Compositor, TILE } from './compositor';
import { Doc, Folder, Layer, Selection, type Node } from './document';
import { bindForSetup, createGL, drawFullscreen, gpuBytes, Surface, SurfacePool, type GL } from './gl/gl';
import { CompoundEntry, History, PixelEntry, type HistoryEntry } from './history';
import { createPrograms, type Programs } from './shaders/programs';
import { pickOverlay } from './input';
import { createTools } from './tools';
import { drawPickRing } from './tools/simpleTools';
import type { Tool, ToolPointer } from './tools/tool';
import { alphaBounds, blurMask, dilate, erode, premultiply } from './util/pixels';
import { clampToDoc, intersect, toMat3, type Rect } from './util/geom';
import { Viewport } from './viewport';
import { getSettings, isBrushTool, settingsStore, type ToolId } from '../store/settings';

export type Corners = [number, number, number, number, number, number, number, number];

interface Clip {
  x: number;
  y: number;
  w: number;
  h: number;
  data: Uint8Array;
}

/** Shared between artworks so copy/paste works across documents. */
let clipboard: Clip | null = null;

type NodeProps = Partial<Pick<Layer, 'name' | 'visible' | 'opacity' | 'locked' | 'clipping' | 'alphaLock' | 'isReference'>> & {
  blendMode?: FolderBlendMode;
  expanded?: boolean;
};

interface Snapshot {
  w: number;
  h: number;
  layers: Map<Layer, Uint8Array>;
  selection: Uint8Array | null;
}

const UI_BG: [number, number, number] = [0.16, 0.16, 0.19];

/**
 * The painting engine for one open artwork: GL resources, document, compositor, view,
 * history and tools. UI code talks to this class; it does not touch React.
 */
export class Editor {
  readonly gl: GL;
  readonly progs: Programs;
  readonly pool: SurfacePool;
  readonly brush: BrushEngine;
  readonly history = new History();
  doc!: Doc;
  compositor!: Compositor;
  viewport!: Viewport;
  strokeBuffer!: Surface;
  tools!: Record<ToolId, Tool>;
  tool!: Tool;
  hover: ToolPointer | null = null;
  version = 0;
  /** Set when there are unsaved changes; cleared by the autosaver. */
  dirty = false;
  /** Tool to return to after a temporary switch (e.g. paste → transform). */
  private listeners = new Set<() => void>();
  private toastFns = new Set<(msg: string) => void>();
  private raf = 0;
  private antsTimer = 0;
  private overlayCtx: CanvasRenderingContext2D;
  private unsub: (() => void) | null = null;
  private screenReady = false;
  private disposed = false;

  constructor(readonly canvas: HTMLCanvasElement, readonly overlay: HTMLCanvasElement) {
    this.gl = createGL(canvas);
    this.progs = createPrograms(this.gl);
    this.pool = new SurfacePool(this.gl);
    this.brush = new BrushEngine(this.gl, this.progs, this.pool);
    this.overlayCtx = overlay.getContext('2d')!;
    this.history.onChange = () => {
      this.dirty = true;
      this.changed();
    };
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.toast('The GPU context was lost. Your last autosave is safe; reopen the artwork.');
    });
  }

  // ---------------------------------------------------------------------------
  // Lifecycle

  newDocument(w: number, h: number, dpi = 350): Doc {
    const doc = new Doc(this.gl, w, h, dpi);
    const layer = doc.createLayer('Layer 1');
    doc.insert(layer, doc.root, 0);
    doc.active = layer;
    return doc;
  }

  setDocument(doc: Doc): void {
    if (this.doc) this.disposeDoc();
    this.doc = doc;
    this.compositor = new Compositor(this.gl, this.progs, doc);
    this.viewport = new Viewport(doc.width, doc.height);
    this.strokeBuffer = new Surface(this.gl, doc.width, doc.height);
    this.strokeBuffer.clear();
    this.history.clear();
    this.history.budgetBytes = getSettings().undoBudgetMB * 1024 * 1024;
    this.tools = createTools(this);
    this.tool = this.tools[getSettings().tool] ?? this.tools.brush;
    this.tool.activate?.();
    this.unsub?.();
    this.unsub = settingsStore.subscribe((s, prev) => {
      if (s.tool !== prev.tool) this.switchTool(s.tool);
      if (s.undoBudgetMB !== prev.undoBudgetMB) this.history.budgetBytes = s.undoBudgetMB * 1024 * 1024;
      if (s !== prev) this.requestRender();
    });
    if (!doc.active || !doc.contains(doc.active)) doc.active = doc.allNodes().at(-1) ?? null;
    if (this.screenReady) this.viewport.setScreen(this.canvasCssW(), this.canvasCssH(), this.viewport.dpr);
    this.viewport.fit();
    this.dirty = false;
    this.changed();
  }

  private canvasCssW() { return this.canvas.clientWidth || 1; }
  private canvasCssH() { return this.canvas.clientHeight || 1; }

  /** Called by the UI when the canvas element changes size. */
  resize(cssW: number, cssH: number, dpr: number): void {
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    for (const c of [this.canvas, this.overlay]) {
      if (c.width !== w) c.width = w;
      if (c.height !== h) c.height = h;
    }
    const first = !this.screenReady;
    this.screenReady = true;
    const v = this.viewport;
    if (v) {
      const oldW = v.cssW, oldH = v.cssH;
      v.setScreen(cssW, cssH, dpr);
      if (first) v.fit();
      else v.panBy((cssW - oldW) / 2, (cssH - oldH) / 2);
    }
    this.requestRender();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.antsTimer);
    this.unsub?.();
    this.tool?.deactivate?.();
    this.disposeDoc();
    this.brush.dispose();
    this.pool.dispose();
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  private disposeDoc(): void {
    this.history.clear();
    this.compositor?.dispose();
    this.strokeBuffer?.dispose();
    this.doc?.dispose();
  }

  // ---------------------------------------------------------------------------
  // Events

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onToast(fn: (msg: string) => void): () => void {
    this.toastFns.add(fn);
    return () => this.toastFns.delete(fn);
  }

  toast(msg: string): void {
    this.toastFns.forEach((f) => f(msg));
  }

  /** Something visible to the UI changed (layers, history, selection...). */
  changed(): void {
    this.version++;
    this.listeners.forEach((f) => f());
    this.requestRender();
  }

  markDirty(): void {
    this.dirty = true;
  }

  // ---------------------------------------------------------------------------
  // Rendering

  requestRender(): void {
    if (this.raf || this.disposed) return;
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  /** Invalidate a document region and schedule a frame. */
  invalidate(r?: Rect | null): void {
    this.compositor.invalidate(r);
    this.requestRender();
  }

  private frame(t: number): void {
    this.raf = 0;
    if (this.disposed || !this.doc) return;
    this.compositor.update();
    this.drawView(t);
    this.drawOverlay();
    if (this.doc.selection && !this.antsTimer) {
      this.antsTimer = window.setTimeout(() => {
        this.antsTimer = 0;
        this.requestRender();
      }, 120);
    }
  }

  private drawView(t: number): void {
    const gl = this.gl;
    const v = this.viewport;
    const doc = this.doc;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const p = this.progs.view.use();
    p.tex('u_comp', 0, this.compositor.cache.tex).v2('u_docSize', doc.width, doc.height);
    p.m3('u_inv', toMat3(v.deviceInverse())).f('u_canvasH', this.canvas.height).f('u_dpr', v.dpr);
    const bg = doc.background.color;
    p.v3('u_bg', bg[0] / 255, bg[1] / 255, bg[2] / 255).b('u_transparent', doc.background.transparent);
    p.v3('u_outside', ...UI_BG).f('u_zoom', v.zoom * v.dpr);
    const sel = doc.selection;
    p.tex('u_sel', 1, sel ? sel.surface.tex : this.compositor.cache.tex).b('u_hasSel', !!sel).f('u_time', (t / 1000) % 1000);
    drawFullscreen(gl);
  }

  private drawOverlay(): void {
    const ctx = this.overlayCtx;
    const dpr = this.viewport.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.tool.overlay?.(ctx);
    if (pickOverlay) drawPickRing(ctx, pickOverlay.x, pickOverlay.y);
    const s = getSettings();
    if (s.showCursor && this.hover && isBrushTool(this.tool.id)) {
      const size = s.brushTools[this.tool.id].size * this.viewport.zoom;
      ctx.beginPath();
      ctx.arc(this.hover.sx, this.hover.sy, Math.max(1, size / 2), 0, Math.PI * 2);
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(this.hover.sx, this.hover.sy, Math.max(1, size / 2) + 1, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.stroke();
    }
  }

  setHover(p: ToolPointer | null): void {
    this.hover = p;
    this.requestRender();
  }

  // ---------------------------------------------------------------------------
  // Tools

  setTool(id: ToolId): void {
    settingsStore.setState({ tool: id });
  }

  /** The tool that was active before the current one (transform returns to it). */
  previousTool: ToolId = 'brush';

  private switchTool(id: ToolId): void {
    if (this.tool.id === id) return;
    this.previousTool = this.tool.id;
    this.tool.deactivate?.();
    this.tool = this.tools[id];
    this.tool.activate?.();
    this.changed();
  }

  /** Common checks before a tool modifies the active layer. */
  editableLayer(): Layer | null {
    const l = this.doc.activeLayer();
    if (!l) {
      this.toast(this.doc.active ? 'Select a layer (not a folder) to draw on.' : 'Add a layer first.');
      return null;
    }
    if (this.doc.isLocked(l)) {
      this.toast('This layer is locked.');
      return null;
    }
    if (!this.doc.isVisible(l)) {
      this.toast('This layer is hidden.');
      return null;
    }
    return l;
  }

  beginPixels(label: string): PixelEntry {
    return new PixelEntry(label, (layer, r) => {
      layer.touch();
      this.invalidate(r);
    });
  }

  // ---------------------------------------------------------------------------
  // GPU helpers

  /** Merge the stroke buffer (within doc rect r) into a layer. */
  mergeStroke(layer: Layer, r: Rect, opacity: number, mode: number, wet = 0): void {
    const tmp = this.pool.get(r.w, r.h);
    layer.surface.blitTo(tmp, r.x, r.y, r.w, r.h, 0, 0);
    layer.surface.target(r.x, r.y, r.w, r.h);
    this.mergeUniforms(tmp.tex, -r.x, -r.y, 0, 0, layer, opacity, mode, wet);
    drawFullscreen(this.gl);
    this.pool.release(tmp);
    layer.touch();
  }

  /** Paint a coverage mask (sized to r) onto a layer in one color, as one undo step. */
  paintMask(layer: Layer, mask: Uint8Array, r: Rect, rgb: [number, number, number], mode: number, label: string): void {
    const data = new Uint8Array(r.w * r.h * 4);
    const cr = rgb[0] * 255, cg = rgb[1] * 255, cb = rgb[2] * 255;
    for (let i = 0; i < mask.length; i++) {
      const m = mask[i] / 255;
      data[i * 4] = Math.round(cr * m);
      data[i * 4 + 1] = Math.round(cg * m);
      data[i * 4 + 2] = Math.round(cb * m);
      data[i * 4 + 3] = mask[i];
    }
    this.strokeBuffer.upload(r.x, r.y, r.w, r.h, data);
    const entry = this.beginPixels(label);
    entry.capture(layer, r);
    this.mergeStroke(layer, r, 1, mode);
    this.strokeBuffer.clear(r.x, r.y, r.w, r.h);
    this.invalidate(r);
    this.history.push(entry);
  }

  /** Preview of mergeStroke for compositor tiles: writes target(0..r.w, 0..r.h). */
  previewStroke(target: Surface, layer: Layer, r: Rect, opacity: number, mode: number, wet = 0): void {
    target.target(0, 0, r.w, r.h);
    this.mergeUniforms(layer.surface.tex, r.x, r.y, r.x, r.y, layer, opacity, mode, wet);
    drawFullscreen(this.gl);
  }

  private mergeUniforms(layerTex: WebGLTexture, lx: number, ly: number, ox: number, oy: number, layer: Layer, opacity: number, mode: number, wet: number) {
    const p = this.progs.merge.use();
    const sel = this.doc.selection;
    p.tex('u_layer', 0, layerTex).iv2('u_layerOff', lx, ly);
    p.tex('u_stroke', 1, this.strokeBuffer.tex).iv2('u_strokeOff', ox, oy);
    p.tex('u_sel', 2, sel ? sel.surface.tex : this.strokeBuffer.tex).iv2('u_selOff', ox, oy).b('u_hasSel', !!sel);
    p.f('u_opacity', opacity).i('u_mode', mode).b('u_alphaLock', layer.alphaLock).f('u_wet', wet);
  }

  /** dst = blend(dst, src) over rect; src texel = dst pixel + (ox, oy). */
  blendInto(dst: Surface, src: Surface, rect: Rect, mode: number, opacity: number, atop: boolean, ox = 0, oy = 0): void {
    const r0 = intersect(rect, { x: 0, y: 0, w: dst.w, h: dst.h });
    if (!r0) return;
    const p = this.progs.composite;
    for (let y = r0.y; y < r0.y + r0.h; y += TILE) {
      for (let x = r0.x; x < r0.x + r0.w; x += TILE) {
        const r = { x, y, w: Math.min(TILE, r0.x + r0.w - x), h: Math.min(TILE, r0.y + r0.h - y) };
        const tmp = this.pool.get(r.w, r.h);
        dst.blitTo(tmp, r.x, r.y, r.w, r.h, 0, 0);
        p.use();
        dst.target(r.x, r.y, r.w, r.h);
        p.tex('u_dst', 0, tmp.tex).iv2('u_dstOff', -r.x, -r.y).b('u_hasDst', true);
        p.tex('u_src', 1, src.tex).iv2('u_srcOff', ox, oy);
        p.f('u_opacity', opacity).i('u_mode', mode).b('u_atop', atop);
        drawFullscreen(this.gl);
        this.pool.release(tmp);
      }
    }
  }

  /** Multiply a layer by the selection mask (or its inverse) within rect. */
  maskLayer(layer: Layer, rect: Rect, invert: boolean, mask: Selection): void {
    const r0 = intersect(rect, { x: 0, y: 0, w: layer.surface.w, h: layer.surface.h });
    if (!r0) return;
    const p = this.progs.mask;
    for (let y = r0.y; y < r0.y + r0.h; y += TILE) {
      for (let x = r0.x; x < r0.x + r0.w; x += TILE) {
        const r = { x, y, w: Math.min(TILE, r0.x + r0.w - x), h: Math.min(TILE, r0.y + r0.h - y) };
        const tmp = this.pool.get(r.w, r.h);
        layer.surface.blitTo(tmp, r.x, r.y, r.w, r.h, 0, 0);
        p.use();
        layer.surface.target(r.x, r.y, r.w, r.h);
        p.tex('u_src', 0, tmp.tex).iv2('u_srcOff', -r.x, -r.y).tex('u_sel', 1, mask.surface.tex).iv2('u_selOff', 0, 0).b('u_invert', invert);
        drawFullscreen(this.gl);
        this.pool.release(tmp);
      }
    }
    layer.touch();
  }

  /**
   * Draw `src` (uv rect) onto a quad given in target pixels. `vp` is the target viewport
   * in target pixels. Blends "over" unless replace is set.
   */
  drawQuad(target: Surface, src: Surface, corners: Corners, vp: Rect, opts: { uv?: [number, number, number, number]; opacity?: number; replace?: boolean; viewportOrigin?: [number, number] } = {}): void {
    const gl = this.gl;
    const p = this.progs.quad.use();
    target.target(vp.x, vp.y, vp.w, vp.h);
    const origin = opts.viewportOrigin ?? [vp.x, vp.y];
    p.v2a('u_corners', new Float32Array(corners)).v2('u_origin', origin[0], origin[1]).v2('u_size', vp.w, vp.h);
    const uv = opts.uv ?? [0, 0, 1, 1];
    p.v4('u_uvRect', uv[0], uv[1], uv[2], uv[3]).tex('u_src', 0, src.tex).f('u_opacity', opts.opacity ?? 1);
    if (!opts.replace) {
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.disable(gl.BLEND);
  }

  /** Box-filtered downscale of a surface; returns RGBA bytes (premultiplied unless bg given). */
  thumbnail(src: Surface, tw: number, th: number, bg?: [number, number, number]): Uint8Array {
    const t = this.pool.get(tw, th);
    const p = this.progs.thumb.use();
    t.target(0, 0, tw, th);
    p.tex('u_src', 0, src.tex).v2('u_srcSize', src.w, src.h).v2('u_dstSize', tw, th);
    p.i('u_taps', Math.min(8, Math.max(1, Math.ceil(src.w / tw)))).b('u_useBg', !!bg);
    if (bg) p.v3('u_bg', bg[0] / 255, bg[1] / 255, bg[2] / 255);
    drawFullscreen(this.gl);
    const out = t.read(0, 0, tw, th);
    this.pool.release(t);
    return out;
  }

  /** Flattened image (premultiplied RGBA, no background). */
  readComposite(): Uint8Array {
    this.compositor.update();
    return this.compositor.cache.read();
  }

  /** Color under a document point, 0..1 RGB, or null when transparent. */
  pickColor(x: number, y: number, source: 'canvas' | 'layer'): [number, number, number] | null {
    const doc = this.doc;
    const ix = Math.floor(x), iy = Math.floor(y);
    if (ix < 0 || iy < 0 || ix >= doc.width || iy >= doc.height) return null;
    let px: Uint8Array;
    if (source === 'layer') {
      const l = doc.activeLayer();
      if (!l) return null;
      px = l.surface.read(ix, iy, 1, 1);
      if (px[3] === 0) return null;
      return [px[0] / px[3], px[1] / px[3], px[2] / px[3]];
    }
    this.compositor.update();
    px = this.compositor.cache.read(ix, iy, 1, 1);
    const a = px[3] / 255;
    if (doc.background.transparent) {
      if (px[3] === 0) return null;
      return [px[0] / px[3], px[1] / px[3], px[2] / px[3]];
    }
    const bg = doc.background.color;
    return [(px[0] + bg[0] * (1 - a)) / 255, (px[1] + bg[1] * (1 - a)) / 255, (px[2] + bg[2] * (1 - a)) / 255];
  }

  contentBounds(layer: Layer): Rect | null {
    return alphaBounds(layer.surface.read(), layer.surface.w, layer.surface.h);
  }

  memoryInfo() {
    return { gpu: gpuBytes(), undo: this.history.totalBytes };
  }

  // ---------------------------------------------------------------------------
  // Layer structure (all undoable)

  private pushCommand(label: string, redo: () => void, undo: () => void, dispose?: (applied: boolean) => void, bytes = 0): void {
    this.history.push({ label, bytes, redo, undo, dispose });
  }

  private insertionPoint(): { parent: Folder; index: number } {
    const a = this.doc.active;
    if (!a) return { parent: this.doc.root, index: this.doc.root.children.length };
    if (a.kind === 'folder' && a.expanded) return { parent: a, index: a.children.length };
    const { parent, index } = this.doc.indexOf(a);
    return { parent, index: index + 1 };
  }

  setActive(node: Node | null): void {
    if (this.tool.busy?.()) this.tool.deactivate?.();
    this.doc.active = node;
    this.changed();
  }

  private addNode(node: Node, label: string, at = this.insertionPoint()): void {
    const prevActive = this.doc.active;
    const apply = () => {
      this.doc.insert(node, at.parent, at.index);
      this.doc.active = node;
      this.invalidate();
    };
    apply();
    this.pushCommand(
      label,
      apply,
      () => {
        this.doc.remove(node);
        this.doc.active = prevActive && this.doc.contains(prevActive) ? prevActive : this.doc.allNodes().at(-1) ?? null;
        this.invalidate();
      },
      (applied) => {
        if (!applied) disposeNode(node);
      },
    );
  }

  addLayer(name?: string): Layer {
    const layer = this.doc.createLayer(name);
    this.addNode(layer, 'New layer');
    return layer;
  }

  addFolder(): Folder {
    const f = new Folder(nextName(this.doc, 'Folder'));
    this.addNode(f, 'New folder');
    return f;
  }

  /** Add a layer from unpremultiplied RGBA pixels placed at (x, y). */
  addPixelsLayer(data: Uint8ClampedArray | Uint8Array, w: number, h: number, x: number, y: number, name: string): Layer {
    const layer = this.doc.createLayer(name);
    const r = intersect({ x, y, w, h }, { x: 0, y: 0, w: this.doc.width, h: this.doc.height });
    if (r) {
      const pm = premultiply(data);
      const sub = new Uint8Array(r.w * r.h * 4);
      for (let row = 0; row < r.h; row++) {
        const sy = r.y - y + row;
        const start = (sy * w + (r.x - x)) * 4;
        sub.set(pm.subarray(start, start + r.w * 4), row * r.w * 4);
      }
      layer.surface.upload(r.x, r.y, r.w, r.h, sub);
    }
    this.addNode(layer, 'Add image');
    return layer;
  }

  deleteNode(node: Node | null = this.doc.active): void {
    if (!node) return;
    const { parent, index } = this.doc.indexOf(node);
    const apply = () => {
      this.doc.remove(node);
      const siblings = parent.children;
      this.doc.active = siblings[Math.min(index, siblings.length - 1)] ?? (parent === this.doc.root ? this.doc.allNodes().at(-1) ?? null : parent);
      this.invalidate();
    };
    apply();
    this.pushCommand(
      'Delete layer',
      apply,
      () => {
        this.doc.insert(node, parent, index);
        this.doc.active = node;
        this.invalidate();
      },
      (applied) => {
        if (applied) disposeNode(node);
      },
    );
  }

  duplicateNode(node: Node | null = this.doc.active): void {
    if (!node) return;
    const copy = this.cloneNode(node);
    copy.name = `${node.name} copy`;
    const { parent, index } = this.doc.indexOf(node);
    this.addNode(copy, 'Duplicate', { parent, index: index + 1 });
  }

  private cloneNode(node: Node): Node {
    if (node.kind === 'layer') {
      const s = new Surface(this.gl, node.surface.w, node.surface.h);
      node.surface.blitTo(s, 0, 0, s.w, s.h, 0, 0);
      const l = new Layer(s, node.name);
      Object.assign(l, pickProps(node), { id: l.id });
      return l;
    }
    const f = new Folder(node.name);
    Object.assign(f, pickProps(node), { id: f.id, expanded: node.expanded });
    for (const c of node.children) {
      const cc = this.cloneNode(c);
      cc.parent = f;
      f.children.push(cc);
    }
    return f;
  }

  /** Move a node to a new parent/index (index counted after removal). */
  moveNode(node: Node, parent: Folder, index: number): void {
    // Refuse to move a folder inside itself.
    for (let p: Folder | null = parent; p; p = p.parent) if (p === node) return;
    const from = this.doc.indexOf(node);
    if (from.parent === parent && from.index === index) return;
    const apply = () => {
      this.doc.remove(node);
      this.doc.insert(node, parent, index);
      this.invalidate();
    };
    apply();
    this.pushCommand('Move layer', apply, () => {
      this.doc.remove(node);
      this.doc.insert(node, from.parent, from.index);
      this.invalidate();
    });
  }

  /** Change node properties. With `before`, records one undo step from those values. */
  setProps(node: Node, patch: NodeProps, opts: { record?: boolean; before?: NodeProps; label?: string } = {}): void {
    const record = opts.record ?? true;
    const before: NodeProps = opts.before ?? {};
    if (!opts.before) for (const k of Object.keys(patch) as (keyof NodeProps)[]) (before as Record<string, unknown>)[k] = (node as unknown as Record<string, unknown>)[k];
    Object.assign(node, patch);
    if (node.kind === 'layer' && 'isReference' in patch && patch.isReference) {
      // Only one reference layer at a time keeps fills predictable.
      for (const l of this.doc.allLayers()) if (l !== node && l.isReference) l.isReference = false;
    }
    this.invalidate();
    if (!record) {
      this.changed();
      return;
    }
    const after = { ...patch };
    this.pushCommand(
      opts.label ?? 'Layer properties',
      () => { Object.assign(node, after); this.invalidate(); },
      () => { Object.assign(node, before); this.invalidate(); },
    );
  }

  mergeDown(layer: Layer | null = this.doc.activeLayer()): void {
    if (!layer) return;
    const { parent, index } = this.doc.indexOf(layer);
    const below = parent.children[index - 1];
    if (!below || below.kind !== 'layer') {
      this.toast('There is no layer below to merge into.');
      return;
    }
    if (this.doc.isLocked(below)) {
      this.toast('The layer below is locked.');
      return;
    }
    if (!layer.visible) {
      this.toast('Show the layer before merging it.');
      return;
    }
    const bounds = this.contentBounds(layer);
    const pix = this.beginPixels('Merge down');
    if (bounds) {
      pix.capture(below, bounds);
      this.blendInto(below.surface, layer.surface, bounds, blendIndex(layer.blendMode), layer.opacity, layer.clipping, 0, 0);
      below.touch();
    }
    const prevActive = this.doc.active;
    const remove = () => {
      this.doc.remove(layer);
      this.doc.active = below;
      this.invalidate();
    };
    remove();
    const del: HistoryEntry = {
      label: 'Merge down',
      bytes: 0,
      redo: remove,
      undo: () => {
        this.doc.insert(layer, parent, index);
        this.doc.active = prevActive;
        this.invalidate();
      },
      dispose: (applied) => {
        if (applied) layer.surface.dispose();
      },
    };
    this.history.push(new CompoundEntry('Merge down', [pix, del]));
  }

  /** Replace every layer with one flattened layer (background stays separate). */
  flatten(): void {
    this.compositor.update();
    const flat = this.doc.createLayer('Flattened');
    this.compositor.cache.blitTo(flat.surface, 0, 0, this.doc.width, this.doc.height, 0, 0);
    flat.parent = this.doc.root;
    const old = this.doc.root.children;
    const oldActive = this.doc.active;
    const apply = () => {
      this.doc.root.children = [flat];
      flat.parent = this.doc.root;
      this.doc.active = flat;
      this.invalidate();
    };
    apply();
    this.pushCommand(
      'Flatten',
      apply,
      () => {
        this.doc.root.children = old;
        old.forEach((n) => (n.parent = this.doc.root));
        this.doc.active = oldActive;
        this.invalidate();
      },
      (applied) => {
        if (applied) old.forEach(disposeNode);
        else flat.surface.dispose();
      },
    );
  }

  /** Clear the active layer (inside the selection when there is one). */
  clearLayer(): void {
    const l = this.editableLayer();
    if (!l) return;
    const sel = this.doc.selection;
    const r = sel?.bounds ?? this.contentBounds(l);
    if (!r) return;
    const pix = this.beginPixels('Clear');
    pix.capture(l, r);
    if (sel) this.maskLayer(l, r, true, sel);
    else l.surface.clear(r.x, r.y, r.w, r.h);
    l.touch();
    this.invalidate(r);
    this.history.push(pix);
  }

  /** Fill the active layer (inside the selection when there is one) with a color 0..1. */
  fillLayer(rgb: [number, number, number]): void {
    const l = this.editableLayer();
    if (!l) return;
    const sel = this.doc.selection;
    const r = sel?.bounds ?? { x: 0, y: 0, w: this.doc.width, h: this.doc.height };
    this.strokeBuffer.clear(r.x, r.y, r.w, r.h, [rgb[0], rgb[1], rgb[2], 1]);
    const pix = this.beginPixels('Fill');
    pix.capture(l, r);
    this.mergeStroke(l, r, 1, 0);
    this.strokeBuffer.clear(r.x, r.y, r.w, r.h);
    this.invalidate(r);
    this.history.push(pix);
  }

  setBackground(bg: Partial<Doc['background']>): void {
    const before = { ...this.doc.background, color: [...this.doc.background.color] as [number, number, number] };
    const after = { ...before, ...bg };
    const apply = (v: typeof before) => {
      this.doc.background = { ...v, color: [...v.color] as [number, number, number] };
      this.invalidate();
    };
    apply(after);
    this.pushCommand('Background', () => apply(after), () => apply(before));
  }

  // ---------------------------------------------------------------------------
  // Selection

  /** Replace the selection (null = none) as one undo step. */
  setSelection(mask: Uint8Array | null, label = 'Selection'): void {
    const doc = this.doc;
    const before = doc.selection ? doc.selection.mask.slice() : null;
    const apply = (m: Uint8Array | null) => {
      doc.selection?.dispose();
      doc.selection = null;
      if (m) {
        const s = new Selection(this.gl, doc.width, doc.height, m.slice());
        doc.selection = s.isEmpty() ? (s.dispose(), null) : s;
      }
      this.changed();
    };
    apply(mask);
    const after = doc.selection ? doc.selection.mask.slice() : null;
    this.pushCommand('Selection', () => apply(after), () => apply(before), undefined, (before?.byteLength ?? 0) + (after?.byteLength ?? 0));
    void label;
  }

  selectAll(): void {
    this.setSelection(new Uint8Array(this.doc.width * this.doc.height).fill(255), 'Select all');
  }

  deselect(): void {
    if (this.doc.selection) this.setSelection(null, 'Deselect');
  }

  invertSelection(): void {
    const n = this.doc.width * this.doc.height;
    const m = new Uint8Array(n);
    const cur = this.doc.selection?.mask;
    for (let i = 0; i < n; i++) m[i] = 255 - (cur ? cur[i] : 0);
    this.setSelection(m, 'Invert selection');
  }

  growSelection(px: number): void {
    const sel = this.doc.selection;
    if (!sel || px === 0) return;
    const { width: w, height: h } = this.doc;
    const bin = sel.mask.map((v) => (v >= 128 ? 255 : 0));
    this.setSelection(px > 0 ? dilate(bin, w, h, px) : erode(bin, w, h, -px), px > 0 ? 'Expand selection' : 'Shrink selection');
  }

  featherSelection(px: number): void {
    const sel = this.doc.selection;
    if (!sel || px <= 0) return;
    this.setSelection(blurMask(sel.mask, this.doc.width, this.doc.height, px), 'Feather selection');
  }

  /** Select the opaque pixels of the active layer. */
  selectLayerOpacity(): void {
    const l = this.doc.activeLayer();
    if (!l) return;
    const px = l.surface.read();
    const m = new Uint8Array(this.doc.width * this.doc.height);
    for (let i = 0; i < m.length; i++) m[i] = px[i * 4 + 3];
    this.setSelection(m, 'Select layer');
  }

  // ---------------------------------------------------------------------------
  // Clipboard

  copy(cut = false): void {
    const l = this.doc.activeLayer();
    if (!l) return;
    const sel = this.doc.selection;
    const r = sel?.bounds ?? this.contentBounds(l);
    if (!r) {
      this.toast('Nothing to copy.');
      return;
    }
    const data = l.surface.read(r.x, r.y, r.w, r.h);
    if (sel) {
      for (let y = 0; y < r.h; y++) {
        for (let x = 0; x < r.w; x++) {
          const m = sel.mask[(r.y + y) * this.doc.width + r.x + x] / 255;
          const i = (y * r.w + x) * 4;
          data[i] *= m; data[i + 1] *= m; data[i + 2] *= m; data[i + 3] *= m;
        }
      }
    }
    clipboard = { ...r, data };
    if (cut) this.clearLayer();
    this.toast(cut ? 'Cut' : 'Copied');
  }

  paste(): void {
    if (!clipboard) {
      this.toast('The clipboard is empty.');
      return;
    }
    const c = clipboard;
    const layer = this.doc.createLayer('Pasted');
    const r = intersect(c, { x: 0, y: 0, w: this.doc.width, h: this.doc.height });
    if (r) {
      const sub = new Uint8Array(r.w * r.h * 4);
      for (let row = 0; row < r.h; row++) {
        const start = ((r.y - c.y + row) * c.w + (r.x - c.x)) * 4;
        sub.set(c.data.subarray(start, start + r.w * 4), row * r.w * 4);
      }
      layer.surface.upload(r.x, r.y, r.w, r.h, sub);
    }
    this.addNode(layer, 'Paste');
    this.setTool('transform');
  }

  get hasClipboard(): boolean {
    return !!clipboard;
  }

  // ---------------------------------------------------------------------------
  // Canvas operations

  private snapshot(): Snapshot {
    const layers = new Map<Layer, Uint8Array>();
    for (const l of this.doc.allLayers()) layers.set(l, l.surface.read());
    return { w: this.doc.width, h: this.doc.height, layers, selection: this.doc.selection?.mask.slice() ?? null };
  }

  private restore(s: Snapshot): void {
    const doc = this.doc;
    doc.width = s.w;
    doc.height = s.h;
    for (const [l, data] of s.layers) {
      l.surface.dispose();
      l.surface = new Surface(this.gl, s.w, s.h);
      l.surface.upload(0, 0, s.w, s.h, data);
      l.touch();
    }
    doc.selection?.dispose();
    doc.selection = s.selection ? new Selection(this.gl, s.w, s.h, s.selection) : null;
    this.docResized();
  }

  private docResized(): void {
    const doc = this.doc;
    this.strokeBuffer.dispose();
    this.strokeBuffer = new Surface(this.gl, doc.width, doc.height);
    this.strokeBuffer.clear();
    this.compositor.resize();
    this.viewport.resizeDoc(doc.width, doc.height);
    this.viewport.fit();
    this.changed();
  }

  /** Re-render every layer into a new size via a quad mapping (rotation, flip, scale, crop). */
  private remapLayers(newW: number, newH: number, corners: Corners, filter: 'linear' | 'nearest' = 'nearest', maskMap?: (m: Uint8Array) => Uint8Array): void {
    const gl = this.gl;
    for (const l of this.doc.allLayers()) {
      const s = new Surface(gl, newW, newH);
      s.clear();
      if (filter === 'nearest') setFilter(gl, l.surface, gl.NEAREST);
      this.drawQuad(s, l.surface, corners, { x: 0, y: 0, w: newW, h: newH }, { replace: true });
      l.surface.dispose();
      l.surface = s;
      l.touch();
    }
    const sel = this.doc.selection;
    this.doc.width = newW;
    this.doc.height = newH;
    if (sel) {
      const m = maskMap ? maskMap(sel.mask) : null;
      sel.dispose();
      this.doc.selection = m ? new Selection(gl, newW, newH, m) : null;
    }
    this.docResized();
  }

  rotateCanvas(dir: 'cw' | 'ccw' | '180'): void {
    const { width: w, height: h } = this.doc;
    const run = (d: 'cw' | 'ccw' | '180') => {
      const W = this.doc.width, H = this.doc.height;
      if (d === 'cw') this.remapLayers(H, W, [H, 0, H, W, 0, W, 0, 0], 'nearest', (m) => rotateMask(m, W, H, d));
      else if (d === 'ccw') this.remapLayers(H, W, [0, W, 0, 0, H, 0, H, W], 'nearest', (m) => rotateMask(m, W, H, d));
      else this.remapLayers(W, H, [W, H, 0, H, 0, 0, W, 0], 'nearest', (m) => rotateMask(m, W, H, d));
    };
    run(dir);
    const inv = dir === 'cw' ? 'ccw' : dir === 'ccw' ? 'cw' : '180';
    this.pushCommand('Rotate canvas', () => run(dir), () => run(inv));
    void w; void h;
  }

  flipCanvas(axis: 'h' | 'v'): void {
    const run = () => {
      const W = this.doc.width, H = this.doc.height;
      const c: Corners = axis === 'h' ? [W, 0, 0, 0, 0, H, W, H] : [0, H, W, H, W, 0, 0, 0];
      this.remapLayers(W, H, c, 'nearest', (m) => flipMask(m, W, H, axis));
    };
    run();
    this.pushCommand('Flip canvas', run, run);
  }

  /** Change the canvas size; `ax`, `ay` in 0..1 choose the anchor. */
  resizeCanvas(newW: number, newH: number, ax = 0.5, ay = 0.5): void {
    const before = this.snapshot();
    const W = this.doc.width, H = this.doc.height;
    const ox = Math.round((newW - W) * ax);
    const oy = Math.round((newH - H) * ay);
    this.remapLayers(newW, newH, [ox, oy, ox + W, oy, ox + W, oy + H, ox, oy + H], 'nearest', (m) => shiftMask(m, W, H, newW, newH, ox, oy));
    this.pushSnapshot('Canvas size', before);
  }

  resizeImage(newW: number, newH: number): void {
    const before = this.snapshot();
    const W = this.doc.width, H = this.doc.height;
    this.remapLayers(newW, newH, [0, 0, newW, 0, newW, newH, 0, newH], 'linear', (m) => scaleMask(m, W, H, newW, newH));
    this.doc.dpi = this.doc.dpi;
    this.pushSnapshot('Image size', before);
  }

  cropToSelection(): void {
    const b = this.doc.selection?.bounds;
    if (!b) {
      this.toast('Make a selection first.');
      return;
    }
    const before = this.snapshot();
    const W = this.doc.width, H = this.doc.height;
    this.remapLayers(b.w, b.h, [-b.x, -b.y, W - b.x, -b.y, W - b.x, H - b.y, -b.x, H - b.y], 'nearest', () => null as unknown as Uint8Array);
    this.doc.selection = null;
    this.pushSnapshot('Crop', before);
  }

  private pushSnapshot(label: string, before: Snapshot): void {
    let data = before;
    const bytes = [...before.layers.values()].reduce((n, d) => n + d.byteLength, 0);
    const swap = () => {
      const cur = this.snapshot();
      this.restore(data);
      data = cur;
    };
    this.pushCommand(label, swap, swap, undefined, bytes * 2);
  }

  // ---------------------------------------------------------------------------
  // Thumbnails & export helpers

  layerThumbnail(layer: Layer, maxW: number, maxH: number): ImageData {
    const k = Math.min(maxW / this.doc.width, maxH / this.doc.height, 1);
    const tw = Math.max(1, Math.round(this.doc.width * k));
    const th = Math.max(1, Math.round(this.doc.height * k));
    const px = this.thumbnail(layer.surface, tw, th);
    const out = new ImageData(tw, th);
    out.data.set(px);
    // Thumbnails are drawn over a checkerboard, so convert to straight alpha.
    for (let i = 0; i < out.data.length; i += 4) {
      const a = out.data[i + 3];
      if (a > 0 && a < 255) {
        out.data[i] = (out.data[i] * 255) / a;
        out.data[i + 1] = (out.data[i + 1] * 255) / a;
        out.data[i + 2] = (out.data[i + 2] * 255) / a;
      }
    }
    return out;
  }

  /** Document thumbnail with background, as straight RGBA. */
  docThumbnail(max: number): ImageData {
    this.compositor.update();
    const k = Math.min(max / this.doc.width, max / this.doc.height, 1);
    const tw = Math.max(1, Math.round(this.doc.width * k));
    const th = Math.max(1, Math.round(this.doc.height * k));
    const bg = this.doc.background;
    const px = this.thumbnail(this.compositor.cache, tw, th, bg.transparent ? undefined : bg.color);
    const out = new ImageData(tw, th);
    out.data.set(px);
    return out;
  }

  canvasRect(): Rect {
    return { x: 0, y: 0, w: this.doc.width, h: this.doc.height };
  }

  clampRect(r: Rect | null): Rect | null {
    return clampToDoc(r, this.doc.width, this.doc.height);
  }
}

// -----------------------------------------------------------------------------

function disposeNode(n: Node): void {
  if (n.kind === 'layer') n.surface.dispose();
  else n.children.forEach(disposeNode);
}

function pickProps(n: Node) {
  const base = { visible: n.visible, opacity: n.opacity, blendMode: n.blendMode, locked: n.locked, clipping: n.clipping };
  return n.kind === 'layer' ? { ...base, alphaLock: n.alphaLock, isReference: false } : base;
}

function nextName(doc: Doc, base: string): string {
  let n = 1;
  const names = new Set(doc.allNodes().map((x) => x.name));
  while (names.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

function setFilter(gl: GL, s: Surface, f: number): void {
  bindForSetup(gl, s.tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
}

function rotateMask(m: Uint8Array, w: number, h: number, d: 'cw' | 'ccw' | '180'): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = m[y * w + x];
      if (d === 'cw') out[x * h + (h - 1 - y)] = v;
      else if (d === 'ccw') out[(w - 1 - x) * h + y] = v;
      else out[(h - 1 - y) * w + (w - 1 - x)] = v;
    }
  }
  return out;
}

function flipMask(m: Uint8Array, w: number, h: number, axis: 'h' | 'v'): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = m[y * w + x];
      if (axis === 'h') out[y * w + (w - 1 - x)] = v;
      else out[(h - 1 - y) * w + x] = v;
    }
  }
  return out;
}

function shiftMask(m: Uint8Array, w: number, h: number, nw: number, nh: number, ox: number, oy: number): Uint8Array {
  const out = new Uint8Array(nw * nh);
  for (let y = 0; y < h; y++) {
    const ny = y + oy;
    if (ny < 0 || ny >= nh) continue;
    for (let x = 0; x < w; x++) {
      const nx = x + ox;
      if (nx >= 0 && nx < nw) out[ny * nw + nx] = m[y * w + x];
    }
  }
  return out;
}

function scaleMask(m: Uint8Array, w: number, h: number, nw: number, nh: number): Uint8Array {
  const out = new Uint8Array(nw * nh);
  for (let y = 0; y < nh; y++) {
    const sy = Math.min(h - 1, Math.floor(((y + 0.5) * h) / nh));
    for (let x = 0; x < nw; x++) {
      const sx = Math.min(w - 1, Math.floor(((x + 0.5) * w) / nw));
      out[y * nw + x] = m[sy * w + sx];
    }
  }
  return out;
}
