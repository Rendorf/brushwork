import { bindDefaultVAO, drawFullscreen, Surface, SurfacePool, type GL } from '../gl/gl';
import type { Programs } from '../shaders/programs';
import { intersect, union, type Rect } from '../util/geom';
import type { BrushParams } from './presets';
import type { Dab } from './stroke';
import { makeGrain, makeTip, type GrainId, type TipId } from './tips';

const FLOATS = 9;

/** State carried between smudge dabs within one stroke. */
export interface SmudgeState {
  carry: Surface | null;
  side: number;
}

/** GPU side of the brush: instanced dab stamping plus direct smudge/blur dabs. */
export class BrushEngine {
  private tips = new Map<TipId, Surface>();
  private grains = new Map<GrainId, Surface>();
  private vao: WebGLVertexArrayObject;
  private vbo: WebGLBuffer;
  private capacity = 0;
  private data = new Float32Array(0);
  private blank: Surface;

  constructor(private gl: GL, private progs: Programs, private pool: SurfacePool) {
    this.vao = gl.createVertexArray()!;
    this.vbo = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    const stride = FLOATS * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(0, 1);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 8);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 24);
    gl.vertexAttribDivisor(2, 1);
    bindDefaultVAO(gl);
    this.blank = new Surface(gl, 1, 1, 'r8');
    this.blank.upload(0, 0, 1, 1, new Uint8Array([255]));
  }

  tip(id: TipId): Surface {
    let s = this.tips.get(id);
    if (!s) {
      const m = makeTip(id);
      s = new Surface(this.gl, m.w, m.h, 'r8', 'linear');
      s.upload(0, 0, m.w, m.h, m.data);
      this.tips.set(id, s);
    }
    return s;
  }

  grain(id: GrainId): Surface {
    let s = this.grains.get(id);
    if (!s) {
      const m = makeGrain(id);
      s = new Surface(this.gl, m.w, m.h, 'r8', 'linear', 'repeat');
      s.upload(0, 0, m.w, m.h, m.data);
      this.grains.set(id, s);
    }
    return s;
  }

  /** Stamp dabs into `target` (usually the stroke buffer). Returns the touched doc rect. */
  drawDabs(target: Surface, dabs: Dab[], brush: BrushParams, sizeMul?: (d: Dab) => number): Rect | null {
    const n = dabs.length;
    if (!n) return null;
    const gl = this.gl;
    if (n > this.capacity) {
      this.capacity = Math.max(n, this.capacity * 2, 256);
      this.data = new Float32Array(this.capacity * FLOATS);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const d = this.data;
    for (let i = 0; i < n; i++) {
      const dab = dabs[i];
      const size = dab.size * (sizeMul ? sizeMul(dab) : 1);
      const o = i * FLOATS;
      d[o] = dab.x;
      d[o + 1] = dab.y;
      d[o + 2] = size;
      d[o + 3] = dab.angle;
      d[o + 4] = dab.roundness;
      d[o + 5] = dab.flow;
      d[o + 6] = dab.r;
      d[o + 7] = dab.g;
      d[o + 8] = dab.b;
      const half = Math.max(size, 1.5) * 0.71 + 1;
      if (dab.x - half < x0) x0 = dab.x - half;
      if (dab.y - half < y0) y0 = dab.y - half;
      if (dab.x + half > x1) x1 = dab.x + half;
      if (dab.y + half > y1) y1 = dab.y + half;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, d, 0, n * FLOATS);
    gl.bindVertexArray(this.vao);

    const p = this.progs.stamp.use();
    target.target();
    p.v2('u_target', target.w, target.h);
    this.bindTip(p, brush);
    if (brush.grain && brush.grainStrength > 0) {
      p.tex('u_grain', 1, this.grain(brush.grain).tex).f('u_grainScale', brush.grainScale).f('u_grainStrength', brush.grainStrength);
    } else {
      p.tex('u_grain', 1, this.blank.tex).f('u_grainScale', 1).f('u_grainStrength', 0);
    }
    gl.enable(gl.BLEND);
    if (brush.accumulate === 'max') {
      gl.blendEquation(gl.MAX);
      gl.blendFunc(gl.ONE, gl.ONE);
    } else {
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
    gl.blendEquation(gl.FUNC_ADD);
    gl.disable(gl.BLEND);
    bindDefaultVAO(gl);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  private bindTip(p: Programs['stamp'], brush: BrushParams) {
    if (brush.tip === 'round') {
      p.i('u_tipKind', 0).tex('u_tip', 0, this.blank.tex);
    } else {
      p.i('u_tipKind', 1).tex('u_tip', 0, this.tip(brush.tip).tex);
    }
    p.f('u_hardness', brush.hardness);
  }

  /** The square region a direct dab touches, clamped to the document. */
  dabRect(dab: Dab, side: number, docW: number, docH: number, margin = 0): Rect | null {
    const s = side + margin * 2;
    return intersect(
      { x: Math.floor(dab.x - s / 2), y: Math.floor(dab.y - s / 2), w: s, h: s },
      { x: 0, y: 0, w: docW, h: docH },
    );
  }

  /** Smudge one dab directly on `layer`. Returns the rect written (or null for the pickup dab). */
  smudgeDab(layer: Surface, dab: Dab, brush: BrushParams, st: SmudgeState, sel: Surface | null, alphaLock: boolean): Rect | null {
    const R = this.dabRect(dab, st.side, layer.w, layer.h);
    if (!R) return null;
    const gl = this.gl;
    const under = this.pool.get(st.side, st.side);
    layer.blitTo(under, R.x, R.y, R.w, R.h, 0, 0);
    if (!st.carry) {
      st.carry = under;
      return null;
    }
    const next = this.pool.get(st.side, st.side);
    const mix = this.progs.smudgeMix.use();
    next.target(0, 0, R.w, R.h);
    mix.tex('u_carry', 0, st.carry.tex).tex('u_under', 1, under.tex).f('u_pickup', 1 - brush.strength);
    drawFullscreen(gl);

    const p = this.progs.smudgeApply.use();
    layer.target(R.x, R.y, R.w, R.h);
    this.tipUniforms(p, dab, brush);
    p.tex('u_carry', 1, next.tex).tex('u_under', 2, under.tex).iv2('u_origin', R.x, R.y);
    p.tex('u_sel', 3, sel ? sel.tex : this.blank.tex).b('u_hasSel', !!sel);
    p.f('u_flow', dab.flow).b('u_alphaLock', alphaLock);
    drawFullscreen(gl);

    this.pool.release(st.carry);
    this.pool.release(under);
    st.carry = next;
    return R;
  }

  /** Blur one dab directly on `layer`. */
  blurDab(layer: Surface, dab: Dab, brush: BrushParams, sel: Surface | null, alphaLock: boolean): Rect | null {
    const radius = Math.max(1, dab.size * 0.12 * (0.3 + brush.strength));
    const margin = Math.ceil(radius) + 2;
    const R = this.dabRect(dab, Math.ceil(dab.size) + 2, layer.w, layer.h, margin);
    if (!R) return null;
    const gl = this.gl;
    const under = this.pool.get(R.w, R.h);
    layer.blitTo(under, R.x, R.y, R.w, R.h, 0, 0);
    const p = this.progs.blurApply.use();
    layer.target(R.x, R.y, R.w, R.h);
    this.tipUniforms(p, dab, brush);
    p.tex('u_under', 1, under.tex).iv2('u_origin', R.x, R.y).v2('u_underSize', under.w, under.h);
    p.tex('u_sel', 3, sel ? sel.tex : this.blank.tex).b('u_hasSel', !!sel);
    p.f('u_flow', dab.flow).f('u_radius', radius).b('u_alphaLock', alphaLock);
    drawFullscreen(gl);
    this.pool.release(under);
    return R;
  }

  endSmudge(st: SmudgeState): void {
    if (st.carry) this.pool.release(st.carry);
    st.carry = null;
  }

  private tipUniforms(p: Programs['smudgeApply'], dab: Dab, brush: BrushParams) {
    if (brush.tip === 'round') p.i('u_tipKind', 0).tex('u_tip', 0, this.blank.tex);
    else p.i('u_tipKind', 1).tex('u_tip', 0, this.tip(brush.tip).tex);
    p.f('u_hardness', brush.hardness).v2('u_center', dab.x, dab.y).f('u_size', Math.max(dab.size, 1));
    p.f('u_angle', dab.angle).f('u_roundness', dab.roundness);
  }

  /** Union helper for callers tracking dirty areas. */
  static grow(a: Rect | null, b: Rect | null): Rect | null {
    return union(a, b);
  }

  dispose(): void {
    this.tips.forEach((s) => s.dispose());
    this.grains.forEach((s) => s.dispose());
    this.blank.dispose();
    this.gl.deleteBuffer(this.vbo);
    this.gl.deleteVertexArray(this.vao);
  }
}
