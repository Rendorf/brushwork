// Screentone layers: the layer's darkness is shown as a dot / line / noise screen
// when compositing, so painting gray on such a layer produces tone (non-destructive).

export type ToneShape = 'dot' | 'line' | 'cross' | 'noise';

export interface ToneProps {
  /** Lines per inch; the cell size is the document dpi divided by this. */
  lpi: number;
  /** Screen angle in degrees. */
  angle: number;
  shape: ToneShape;
}

export const TONE_SHAPES: ToneShape[] = ['dot', 'line', 'cross', 'noise'];

export const defaultTone = (): ToneProps => ({ lpi: 60, angle: 45, shape: 'dot' });

/** Screen cell size in pixels for a document resolution. */
export const toneCell = (t: ToneProps, dpi: number) => Math.max(2, dpi / Math.max(1, t.lpi));

/** GLSL for the tone pass: premultiplied layer pixels in, black ink coverage out. */
export const TONE_GLSL = /* glsl */ `
uniform sampler2D u_src; uniform ivec2 u_srcOff; uniform vec2 u_origin;
uniform float u_cell; uniform vec2 u_rot; uniform int u_shape;
out vec4 o;
float h12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
void main() {
  vec4 c = texelFetch(u_src, ivec2(gl_FragCoord.xy) + u_srcOff, 0);
  if (c.a <= 0.0) { o = vec4(0.0); return; }
  vec3 rgb = c.rgb / c.a;
  // Ink amount: darkness of the paint, scaled by its opacity.
  float ink = clamp((1.0 - dot(rgb, vec3(0.299, 0.587, 0.114))) * c.a, 0.0, 1.0);
  vec2 dp = u_origin + gl_FragCoord.xy;
  vec2 rp = vec2(u_rot.x * dp.x + u_rot.y * dp.y, -u_rot.y * dp.x + u_rot.x * dp.y);
  vec2 lp = (fract(rp / u_cell) - 0.5) * u_cell;
  float cov;
  if (u_shape == 0) {
    // Cosine spot function: dots grow from cell centers and merge into a checkerboard
    // at 50%; the inked area tracks the gray level.
    vec2 q = rp / u_cell * 6.2831853;
    float v = 0.5 - (cos(q.x) + cos(q.y)) * 0.25;
    float w = max(fwidth(v), 1e-4);
    cov = ink <= 0.002 ? 0.0 : 1.0 - smoothstep(ink - w, ink + w, v);
  } else if (u_shape == 1) {
    float hw = u_cell * 0.5 * ink;
    cov = 1.0 - smoothstep(hw - 0.6, hw + 0.6, abs(lp.y));
  } else if (u_shape == 2) {
    float hw = u_cell * 0.5 * (1.0 - sqrt(1.0 - ink));
    cov = 1.0 - smoothstep(hw - 0.6, hw + 0.6, min(abs(lp.x), abs(lp.y)));
  } else {
    cov = step(h12(floor(dp)), ink);
  }
  o = vec4(0.0, 0.0, 0.0, cov);
}`;
