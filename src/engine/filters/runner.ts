// GPU passes for filters: exact-size scratch surfaces, a shared GLSL prelude,
// and reusable building blocks (gaussian blur, box downsample, jump-flood distance).
import { drawFullscreen, FULLSCREEN_VS, Program, Surface, type GL } from '../gl/gl';
import type { Rect } from '../util/geom';

/** Helpers available to every filter shader. Fragment coords are output pixels. */
export const FILTER_GLSL = /* glsl */ `
uniform vec2 u_size;     // output size in pixels
uniform vec2 u_origin;   // document position of the output's (0,0)
uniform vec2 u_docSize;
uniform vec3 u_fg;       // current color
out vec4 o;
vec4 unpre(vec4 c) { return c.a > 0.0 ? vec4(c.rgb / c.a, c.a) : vec4(0.0); }
vec4 pre(vec4 c) { return vec4(c.rgb * c.a, c.a); }
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
vec2 docPos() { return u_origin + gl_FragCoord.xy; }
/** Sample a same-size input at output pixel coordinates (bilinear, clamped). */
vec4 at(sampler2D s, vec2 p) { return texture(s, p / u_size); }
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i), b = hash12(i + vec2(1, 0)), c = hash12(i + vec2(0, 1)), d = hash12(i + vec2(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
vec3 rgb2hsl(vec3 c) {
  float mx = max(max(c.r, c.g), c.b), mn = min(min(c.r, c.g), c.b);
  float l = (mx + mn) * 0.5;
  if (mx == mn) return vec3(0.0, 0.0, l);
  float d = mx - mn;
  float s = l > 0.5 ? d / (2.0 - mx - mn) : d / (mx + mn);
  float h;
  if (mx == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
  else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
  else h = (c.r - c.g) / d + 4.0;
  return vec3(h / 6.0, s, l);
}
float hue2rgb(float p, float q, float t) {
  t = fract(t);
  if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
  if (t < 0.5) return q;
  if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
  return p;
}
vec3 hsl2rgb(vec3 h) {
  if (h.y == 0.0) return vec3(h.z);
  float q = h.z < 0.5 ? h.z * (1.0 + h.y) : h.z + h.y - h.z * h.y;
  float p = 2.0 * h.z - q;
  return vec3(hue2rgb(p, q, h.x + 1.0 / 3.0), hue2rgb(p, q, h.x), hue2rgb(p, q, h.x - 1.0 / 3.0));
}
/** Decode a jump-flood seed (pixel position) stored in 8-bit RGBA; returns -1 when empty. */
vec2 seedAt(sampler2D s, ivec2 q) {
  vec4 v = texelFetch(s, q, 0) * 255.0;
  float x = v.r * 256.0 + v.g, y = v.b * 256.0 + v.a;
  return (x < 0.5 || y < 0.5) ? vec2(-1.0) : vec2(x - 1.0, y - 1.0) + 0.5;
}
`;

const COPY_FS = `uniform sampler2D u_src; void main() { o = at(u_src, gl_FragCoord.xy); }`;

const BLUR_FS = `
uniform sampler2D u_src; uniform vec2 u_dir; uniform float u_sigma;
void main() {
  vec2 p = gl_FragCoord.xy;
  int r = min(64, int(ceil(u_sigma * 3.0)));
  vec4 acc = vec4(0.0);
  float ws = 0.0;
  for (int i = -r; i <= r; i++) {
    float w = exp(-float(i * i) / (2.0 * u_sigma * u_sigma));
    acc += at(u_src, p + u_dir * float(i)) * w;
    ws += w;
  }
  o = acc / ws;
}`;

const DOWN_FS = `
uniform sampler2D u_src; uniform vec2 u_srcSize; uniform int u_s;
void main() {
  ivec2 base = ivec2(gl_FragCoord.xy) * u_s;
  ivec2 hi = ivec2(u_srcSize) - 1;
  vec4 acc = vec4(0.0);
  float n = 0.0;
  for (int j = 0; j < 128; j++) {
    if (j >= u_s) break;
    for (int i = 0; i < 128; i++) {
      if (i >= u_s) break;
      acc += texelFetch(u_src, min(base + ivec2(i, j), hi), 0);
      n += 1.0;
    }
  }
  o = acc / n;
}`;

const UP_FS = `
uniform sampler2D u_low; uniform vec2 u_lowSize; uniform float u_s; uniform bool u_nearest;
void main() {
  vec2 q = gl_FragCoord.xy / u_s;
  o = u_nearest ? texelFetch(u_low, ivec2(q), 0) : texture(u_low, q / u_lowSize);
}`;

const JFA_INIT_FS = `
uniform sampler2D u_src; uniform float u_threshold;
vec4 enc(vec2 p) {
  vec2 q = floor(p) + 1.0;
  return vec4(floor(q.x / 256.0), mod(q.x, 256.0), floor(q.y / 256.0), mod(q.y, 256.0)) / 255.0;
}
void main() {
  o = texelFetch(u_src, ivec2(gl_FragCoord.xy), 0).a >= u_threshold ? enc(gl_FragCoord.xy) : vec4(0.0);
}`;

const JFA_STEP_FS = `
uniform sampler2D u_seeds; uniform int u_k;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 hi = ivec2(u_size) - 1;
  float best = 1e20;
  ivec2 bestQ = ivec2(-1);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      ivec2 q = p + ivec2(i, j) * u_k;
      if (q.x < 0 || q.y < 0 || q.x > hi.x || q.y > hi.y) continue;
      vec2 s = seedAt(u_seeds, q);
      if (s.x < 0.0) continue;
      vec2 d = s - gl_FragCoord.xy;
      float dd = dot(d, d);
      if (dd < best) { best = dd; bestQ = q; }
    }
  }
  o = bestQ.x < 0 ? vec4(0.0) : texelFetch(u_seeds, bestQ, 0);
}`;

/** One filter evaluation over a document region. All surfaces it makes are freed by dispose(). */
export class FilterRun {
  private temps: Surface[] = [];

  constructor(
    readonly gl: GL,
    private cache: Map<string, Program>,
    /** Layer pixels for the region (premultiplied), exactly region-sized. */
    readonly src: Surface,
    /** Document rectangle being filtered. */
    readonly R: Rect,
    readonly docW: number,
    readonly docH: number,
    /** Document resolution, for print-based sizes (screentone LPI). */
    readonly dpi: number,
    /** Current brush color, 0..1. */
    readonly fg: [number, number, number],
  ) {}

  get w() {
    return this.R.w;
  }
  get h() {
    return this.R.h;
  }

  /** A cleared scratch surface (default: region size). */
  surface(w = this.R.w, h = this.R.h): Surface {
    const s = new Surface(this.gl, Math.max(1, Math.ceil(w)), Math.max(1, Math.ceil(h)));
    s.clear();
    this.temps.push(s);
    return s;
  }

  program(key: string, fs: string): Program {
    let p = this.cache.get(key);
    if (!p) {
      p = new Program(this.gl, FULLSCREEN_VS, FILTER_GLSL + fs, key);
      this.cache.set(key, p);
    }
    return p;
  }

  /**
   * Run a fragment pass into `out`. Inputs bind to units in order; each also gets
   * `<name>Size`. The pass's origin assumes out covers the region at its own scale.
   */
  pass(key: string, fs: string, out: Surface, inputs: Record<string, Surface>, uni?: (p: Program) => void, scale = 1): Surface {
    const p = this.program(key, fs).use();
    out.target();
    let unit = 0;
    for (const [name, s] of Object.entries(inputs)) {
      p.tex(name, unit++, s.tex).v2(`${name}Size`, s.w, s.h);
    }
    p.v2('u_size', out.w, out.h).v2('u_origin', this.R.x / scale, this.R.y / scale).v2('u_docSize', this.docW, this.docH);
    p.v3('u_fg', this.fg[0], this.fg[1], this.fg[2]);
    uni?.(p);
    drawFullscreen(this.gl);
    return out;
  }

  /** Simple same-size shader: `fs` reads u_src (the region) and writes o. */
  map(key: string, fs: string, uni?: (p: Program) => void, src: Surface = this.src): Surface {
    return this.pass(key, `uniform sampler2D u_src; uniform vec2 u_srcSize;\n${fs}`, this.surface(src.w, src.h), { u_src: src }, uni);
  }

  copy(src: Surface): Surface {
    return this.pass('copy', COPY_FS, this.surface(src.w, src.h), { u_src: src });
  }

  /** Average s x s blocks. */
  downsample(src: Surface, s: number): Surface {
    const out = this.surface(Math.ceil(src.w / s), Math.ceil(src.h / s));
    return this.pass('down', DOWN_FS, out, { u_src: src }, (p) => p.i('u_s', s));
  }

  /** Scale a downsampled surface back up to w x h. */
  upsample(low: Surface, s: number, w: number, h: number, nearest = false): Surface {
    return this.pass('up', UP_FS, this.surface(w, h), { u_low: low }, (p) => p.f('u_s', s).b('u_nearest', nearest));
  }

  /** Gaussian blur; large radii blur a downsampled copy for speed. */
  blur(src: Surface, sigma: number): Surface {
    if (sigma < 0.35) return src;
    const s = Math.max(1, Math.min(16, Math.floor(sigma / 3)));
    let work = s > 1 ? this.downsample(src, s) : src;
    const sg = sigma / s;
    work = this.pass('blur', BLUR_FS, this.surface(work.w, work.h), { u_src: work }, (p) => p.v2('u_dir', 1, 0).f('u_sigma', sg));
    work = this.pass('blur', BLUR_FS, this.surface(work.w, work.h), { u_src: work }, (p) => p.v2('u_dir', 0, 1).f('u_sigma', sg));
    return s > 1 ? this.upsample(work, s, src.w, src.h) : work;
  }

  /**
   * Jump-flood nearest-seed map: every pixel gets the position of the nearest pixel whose
   * alpha >= threshold (decode with seedAt() in GLSL). Covers distances up to maxDist.
   */
  nearestSeeds(src: Surface, maxDist: number, threshold = 0.5): Surface {
    let seeds = this.pass('jfaInit', JFA_INIT_FS, this.surface(src.w, src.h), { u_src: src }, (p) => p.f('u_threshold', threshold));
    let k = 1;
    while (k * 2 <= Math.max(1, maxDist)) k *= 2;
    const steps: number[] = [];
    for (; k >= 1; k = Math.floor(k / 2)) steps.push(k);
    steps.push(1);
    for (const step of steps) {
      seeds = this.pass('jfaStep', JFA_STEP_FS, this.surface(src.w, src.h), { u_seeds: seeds }, (p) => p.i('u_k', step));
    }
    return seeds;
  }

  /** Free every scratch surface except `keep`. */
  dispose(keep?: Surface): void {
    for (const s of this.temps) if (s !== keep) s.dispose();
    this.temps = keep ? [keep] : [];
  }
}
