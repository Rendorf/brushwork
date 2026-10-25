// Thin WebGL2 helpers: context creation, programs and render-target surfaces.

export type GL = WebGL2RenderingContext;

export function createGL(canvas: HTMLCanvasElement | OffscreenCanvas): GL {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
    desynchronized: true,
    powerPreference: 'high-performance',
  }) as GL | null;
  if (!gl) throw new Error('WebGL2 is not available on this device or browser.');
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);
  // Attribute-less draws use gl_VertexID; an empty VAO keeps every driver happy.
  const vao = gl.createVertexArray()!;
  defaultVAOs.set(gl, vao);
  gl.bindVertexArray(vao);
  return gl;
}

const defaultVAOs = new WeakMap<GL, WebGLVertexArrayObject>();

export function bindDefaultVAO(gl: GL): void {
  gl.bindVertexArray(defaultVAOs.get(gl) ?? null);
}

const VERSION = '#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler2D;\n';

export class Program {
  readonly prog: WebGLProgram;
  private locs = new Map<string, WebGLUniformLocation | null>();

  constructor(readonly gl: GL, vs: string, fs: string, readonly name = 'program') {
    const prog = gl.createProgram()!;
    gl.attachShader(prog, this.compile(gl.VERTEX_SHADER, VERSION + vs));
    gl.attachShader(prog, this.compile(gl.FRAGMENT_SHADER, VERSION + fs));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(`Link failed (${name}): ${gl.getProgramInfoLog(prog)}`);
    }
    this.prog = prog;
  }

  private compile(type: number, src: string): WebGLShader {
    const gl = this.gl;
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      const numbered = src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n');
      throw new Error(`Compile failed (${this.name}): ${log}\n${numbered}`);
    }
    return sh;
  }

  use(): this {
    this.gl.useProgram(this.prog);
    return this;
  }

  loc(name: string): WebGLUniformLocation | null {
    let l = this.locs.get(name);
    if (l === undefined) {
      l = this.gl.getUniformLocation(this.prog, name);
      this.locs.set(name, l);
    }
    return l;
  }

  i(name: string, v: number): this { this.gl.uniform1i(this.loc(name), v); return this; }
  f(name: string, v: number): this { this.gl.uniform1f(this.loc(name), v); return this; }
  b(name: string, v: boolean): this { this.gl.uniform1i(this.loc(name), v ? 1 : 0); return this; }
  v2(name: string, x: number, y: number): this { this.gl.uniform2f(this.loc(name), x, y); return this; }
  iv2(name: string, x: number, y: number): this { this.gl.uniform2i(this.loc(name), x, y); return this; }
  v3(name: string, x: number, y: number, z: number): this { this.gl.uniform3f(this.loc(name), x, y, z); return this; }
  v4(name: string, x: number, y: number, z: number, w: number): this { this.gl.uniform4f(this.loc(name), x, y, z, w); return this; }
  m3(name: string, m: Float32Array): this { this.gl.uniformMatrix3fv(this.loc(name), false, m); return this; }
  v2a(name: string, a: Float32Array): this { this.gl.uniform2fv(this.loc(name), a); return this; }

  /** Bind a texture to a unit and point the sampler uniform at it. */
  tex(name: string, unit: number, tex: WebGLTexture): this {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(this.loc(name), unit);
    return this;
  }
}

let liveBytes = 0;
/** Bytes of GPU texture memory currently held by Surfaces. */
export const gpuBytes = () => liveBytes;

export type SurfaceKind = 'rgba' | 'r8';

/**
 * Texture unit used for creating and uploading textures. Programs bind samplers on low
 * units; doing setup work here keeps a lazy upload from replacing a sampler bound a moment
 * earlier.
 */
const SETUP_UNIT = 15;

export function bindForSetup(gl: GL, tex: WebGLTexture): void {
  gl.activeTexture(gl.TEXTURE0 + SETUP_UNIT);
  gl.bindTexture(gl.TEXTURE_2D, tex);
}

/** A texture plus a lazily-created framebuffer. Texel row y is document row y (top row first). */
export class Surface {
  readonly tex: WebGLTexture;
  private _fbo: WebGLFramebuffer | null = null;
  private disposed = false;
  readonly bytes: number;

  constructor(
    readonly gl: GL,
    readonly w: number,
    readonly h: number,
    readonly kind: SurfaceKind = 'rgba',
    filter: 'linear' | 'nearest' = 'linear',
    wrap: 'clamp' | 'repeat' = 'clamp',
  ) {
    const tex = gl.createTexture();
    if (!tex) throw new Error('Out of GPU memory (createTexture failed)');
    bindForSetup(gl, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, kind === 'rgba' ? gl.RGBA8 : gl.R8, w, h);
    const f = filter === 'linear' ? gl.LINEAR : gl.NEAREST;
    const wr = wrap === 'repeat' ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wr);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wr);
    this.tex = tex;
    this.bytes = w * h * (kind === 'rgba' ? 4 : 1);
    liveBytes += this.bytes;
  }

  get fbo(): WebGLFramebuffer {
    if (!this._fbo) {
      const gl = this.gl;
      const fbo = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0);
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`Framebuffer incomplete: 0x${status.toString(16)}`);
      this._fbo = fbo;
    }
    return this._fbo;
  }

  /** Render into this surface, restricted to the given rectangle (viewport origin = rect origin). */
  target(x = 0, y = 0, w = this.w, h = this.h): this {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(x, y, w, h);
    return this;
  }

  clear(x = 0, y = 0, w = this.w, h = this.h, rgba: [number, number, number, number] = [0, 0, 0, 0]): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(x, y, w, h);
    gl.clearColor(rgba[0], rgba[1], rgba[2], rgba[3]);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.SCISSOR_TEST);
  }

  upload(x: number, y: number, w: number, h: number, data: ArrayBufferView): void {
    const gl = this.gl;
    bindForSetup(gl, this.tex);
    const fmt = this.kind === 'rgba' ? gl.RGBA : gl.RED;
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, w, h, fmt, gl.UNSIGNED_BYTE, data);
  }

  /** Read RGBA bytes (premultiplied) from a rectangle. Only for 'rgba' surfaces. */
  read(x = 0, y = 0, w = this.w, h = this.h, out?: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
    const gl = this.gl;
    const buf = out ?? new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return buf;
  }

  /** Copy a rectangle of this surface into another surface. */
  blitTo(dst: Surface, sx: number, sy: number, w: number, h: number, dx: number, dy: number): void {
    const gl = this.gl;
    // Resolve both framebuffers first: creating one lazily rebinds FRAMEBUFFER.
    const from = this.fbo;
    const to = dst.fbo;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, from);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, to);
    gl.blitFramebuffer(sx, sy, sx + w, sy + h, dx, dy, dx + w, dy + h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const gl = this.gl;
    if (this._fbo) gl.deleteFramebuffer(this._fbo);
    gl.deleteTexture(this.tex);
    liveBytes -= this.bytes;
  }
}

/** Reusable scratch surfaces, bucketed by power-of-two size. */
export class SurfacePool {
  private free = new Map<string, Surface[]>();
  constructor(private gl: GL) {}

  private static bucket(n: number) {
    let b = 64;
    while (b < n) b *= 2;
    return b;
  }

  get(minW: number, minH: number): Surface {
    const w = SurfacePool.bucket(minW);
    const h = SurfacePool.bucket(minH);
    const key = `${w}x${h}`;
    const list = this.free.get(key);
    if (list && list.length) return list.pop()!;
    return new Surface(this.gl, w, h);
  }

  release(s: Surface): void {
    const key = `${s.w}x${s.h}`;
    let list = this.free.get(key);
    if (!list) this.free.set(key, (list = []));
    if (list.length >= 4) s.dispose();
    else list.push(s);
  }

  dispose(): void {
    for (const list of this.free.values()) list.forEach((s) => s.dispose());
    this.free.clear();
  }
}

/** Vertex shader for a full-target triangle. Fragments use gl_FragCoord. */
export const FULLSCREEN_VS = /* glsl */ `
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export function drawFullscreen(gl: GL): void {
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}
