// Live filter preview on the active layer, then apply as one undo step (or cancel).
import type { Layer } from '../document';
import type { Editor } from '../editor';
import { drawFullscreen, FULLSCREEN_VS, Program, Surface } from '../gl/gl';
import { intersect, union, type Rect } from '../util/geom';
import { currentRGB } from '../../store/settings';
import { FilterRun } from './runner';
import type { FilterDef, Values } from './types';

// Blend the filtered region into layer pixels through the selection, the effect amount and alpha lock.
const MIX_FS = /* glsl */ `
uniform sampler2D u_layer; uniform ivec2 u_layerOff;
uniform sampler2D u_res; uniform ivec2 u_resOff; uniform ivec2 u_resSize;
uniform sampler2D u_sel; uniform ivec2 u_selOff; uniform bool u_hasSel;
uniform float u_amount; uniform bool u_alphaLock;
out vec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 d = texelFetch(u_layer, p + u_layerOff, 0);
  ivec2 q = p + u_resOff;
  if (q.x < 0 || q.y < 0 || q.x >= u_resSize.x || q.y >= u_resSize.y) { o = d; return; }
  vec4 r = texelFetch(u_res, q, 0);
  float m = u_amount;
  if (u_hasSel) m *= texelFetch(u_sel, p + u_selOff, 0).r;
  vec4 c = mix(d, r, m);
  if (u_alphaLock) c = c.a > 0.0 ? vec4(c.rgb / c.a * d.a, d.a) : vec4(0.0);
  o = c;
}`;

const OVER_FS = `
uniform sampler2D u_gen; uniform sampler2D u_src;
void main() {
  vec4 g = at(u_gen, gl_FragCoord.xy);
  vec4 s = at(u_src, gl_FragCoord.xy);
  o = g + s * (1.0 - g.a);
}`;

const programs = new WeakMap<Editor, { mix: Program; cache: Map<string, Program> }>();

function progsFor(ed: Editor) {
  let p = programs.get(ed);
  if (!p) {
    p = { mix: new Program(ed.gl, FULLSCREEN_VS, MIX_FS, 'filterMix'), cache: new Map() };
    programs.set(ed, p);
  }
  return p;
}

export class FilterSession {
  values: Values;
  /** How strongly the effect is applied, 0..1. */
  amount = 1;
  readonly layer: Layer;
  private result: Surface | null = null;
  private region: Rect | null = null;
  private raf = 0;
  private ended = false;
  /** Milliseconds the last evaluation took (for the UI). */
  lastMs = 0;
  error: string | null = null;

  constructor(private ed: Editor, readonly def: FilterDef, values: Values, layer: Layer) {
    this.values = values;
    this.layer = layer;
    ed.compositor.preview = { layer, render: (t, r) => this.renderPreview(t, r) };
    this.run();
  }

  set(values: Values, amount = this.amount): void {
    this.values = values;
    this.amount = amount;
    this.schedule();
  }

  private schedule(): void {
    if (this.raf || this.ended) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.run();
    });
  }

  /** The document region a run covers: the selection (plus margin) or the whole canvas. */
  private regionFor(v: Values): Rect | null {
    const ed = this.ed;
    const sel = ed.doc.selection?.bounds;
    if (!sel) return ed.canvasRect();
    const m = Math.ceil(this.def.margin?.(v) ?? 0) + 2;
    return ed.clampRect({ x: sel.x - m, y: sel.y - m, w: sel.w + 2 * m, h: sel.h + 2 * m });
  }

  private run(): void {
    if (this.ended) return;
    const ed = this.ed;
    const R = this.regionFor(this.values);
    const old = this.region;
    if (!R) return;
    const t0 = performance.now();
    const { cache } = progsFor(ed);
    const src = new Surface(ed.gl, R.w, R.h);
    this.layer.surface.blitTo(src, R.x, R.y, R.w, R.h, 0, 0);
    const run = new FilterRun(ed.gl, cache, src, R, ed.doc.width, ed.doc.height, ed.doc.dpi, currentRGB());
    let res: Surface;
    try {
      res = this.def.run(run, this.values);
      if (this.def.generator) res = run.pass('over', OVER_FS, run.surface(), { u_gen: res, u_src: src });
      this.error = null;
    } catch (e) {
      this.error = (e as Error).message;
      run.dispose();
      src.dispose();
      return;
    }
    run.dispose(res);
    if (res !== src) src.dispose();
    this.result?.dispose();
    this.result = res;
    this.region = R;
    // readPixels-free timing is approximate: GL work is asynchronous.
    this.lastMs = performance.now() - t0;
    ed.invalidate(union(old, R));
  }

  private mixUniforms(layerTex: WebGLTexture, layerOff: [number, number], resOff: [number, number], selOff: [number, number]): void {
    const ed = this.ed;
    const p = progsFor(ed).mix.use();
    const sel = ed.doc.selection;
    p.tex('u_layer', 0, layerTex).iv2('u_layerOff', layerOff[0], layerOff[1]);
    p.tex('u_res', 1, this.result!.tex).iv2('u_resOff', resOff[0], resOff[1]).iv2('u_resSize', this.result!.w, this.result!.h);
    p.tex('u_sel', 2, sel ? sel.surface.tex : this.result!.tex).iv2('u_selOff', selOff[0], selOff[1]).b('u_hasSel', !!sel);
    p.f('u_amount', this.amount).b('u_alphaLock', this.layer.alphaLock);
  }

  private renderPreview(target: Surface, r: Rect): void {
    const ed = this.ed;
    target.target(0, 0, r.w, r.h);
    if (!this.result || !this.region) {
      // Not computed yet: show the layer unchanged.
      const c = ed.progs.composite.use();
      c.tex('u_dst', 0, this.layer.surface.tex).iv2('u_dstOff', 0, 0).b('u_hasDst', false);
      c.tex('u_src', 1, this.layer.surface.tex).iv2('u_srcOff', r.x, r.y).f('u_opacity', 1).i('u_mode', 101).b('u_atop', false);
      drawFullscreen(ed.gl);
      return;
    }
    const R = this.region;
    this.mixUniforms(this.layer.surface.tex, [r.x, r.y], [r.x - R.x, r.y - R.y], [r.x, r.y]);
    drawFullscreen(ed.gl);
  }

  /** Crosshair at the filter's center point, if it has one. */
  overlay(ctx: CanvasRenderingContext2D): void {
    const p = this.def.params.find((q) => q.type === 'point');
    if (!p) return;
    const [u, v] = this.values[p.key] as [number, number];
    const s = this.ed.viewport.toScreen(u * this.ed.doc.width, v * this.ed.doc.height);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    for (const pass of [0, 1]) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, 10, 0, Math.PI * 2);
      ctx.moveTo(s.x - 18, s.y);
      ctx.lineTo(s.x + 18, s.y);
      ctx.moveTo(s.x, s.y - 18);
      ctx.lineTo(s.x, s.y + 18);
      ctx.stroke();
      if (!pass) {
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#fff';
      }
    }
  }

  /** Set the first 'point' parameter from a document position (tap on the canvas). */
  pointer(x: number, y: number): void {
    const p = this.def.params.find((q) => q.type === 'point');
    if (!p) return;
    this.values = { ...this.values, [p.key]: [Math.min(1, Math.max(0, x / this.ed.doc.width)), Math.min(1, Math.max(0, y / this.ed.doc.height))] };
    this.schedule();
    this.ed.changed();
  }

  apply(): void {
    if (this.ended) return;
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.run();
    }
    const ed = this.ed;
    const R = this.region;
    if (this.result && R) {
      const entry = ed.beginPixels(this.def.name);
      entry.capture(this.layer, R);
      const tmp = new Surface(ed.gl, R.w, R.h);
      this.layer.surface.blitTo(tmp, R.x, R.y, R.w, R.h, 0, 0);
      this.layer.surface.target(R.x, R.y, R.w, R.h);
      this.mixUniforms(tmp.tex, [-R.x, -R.y], [-R.x, -R.y], [0, 0]);
      drawFullscreen(ed.gl);
      tmp.dispose();
      this.layer.touch();
      this.end();
      ed.history.push(entry);
      ed.invalidate(R);
    } else {
      this.end();
    }
  }

  cancel(): void {
    this.end();
  }

  get active(): boolean {
    return !this.ended;
  }

  /** The region being previewed (for overlays). */
  get area(): Rect | null {
    return this.region ? intersect(this.region, this.ed.canvasRect()) : null;
  }

  private end(): void {
    if (this.ended) return;
    this.ended = true;
    cancelAnimationFrame(this.raf);
    const ed = this.ed;
    if (ed.compositor.preview?.layer === this.layer) ed.compositor.preview = null;
    ed.invalidate(this.region);
    this.result?.dispose();
    this.result = null;
    if (ed.filter === this) ed.filter = null;
    ed.changed();
  }
}
