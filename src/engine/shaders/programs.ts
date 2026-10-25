import { FULLSCREEN_VS, Program, type GL } from '../gl/gl';
import { BLEND_GLSL } from './blend';

// Composite one source over a backdrop with a blend mode. Both are fetched by integer texel
// offsets from gl_FragCoord, so any viewport origin works.
const COMPOSITE_FS = /* glsl */ `
${BLEND_GLSL}
uniform sampler2D u_dst; uniform ivec2 u_dstOff; uniform bool u_hasDst;
uniform sampler2D u_src; uniform ivec2 u_srcOff;
uniform float u_opacity; uniform int u_mode; uniform bool u_atop;
out vec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 b = u_hasDst ? texelFetch(u_dst, p + u_dstOff, 0) : vec4(0.0);
  vec4 s = texelFetch(u_src, p + u_srcOff, 0) * u_opacity;
  o = bw_blend(b, s, u_mode, u_atop);
}`;

// Merge a stroke buffer into layer pixels (selection mask, opacity cap, alpha lock, wet edges).
const MERGE_FS = /* glsl */ `
${BLEND_GLSL}
uniform sampler2D u_layer; uniform ivec2 u_layerOff;
uniform sampler2D u_stroke; uniform ivec2 u_strokeOff;
uniform sampler2D u_sel; uniform ivec2 u_selOff; uniform bool u_hasSel;
uniform float u_opacity; uniform int u_mode; uniform bool u_alphaLock; uniform float u_wet;
out vec4 o;
float wetCurve(float a) {
  return smoothstep(0.0, 0.2, a) * mix(1.0, 0.45, smoothstep(0.25, 1.0, a));
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 d = texelFetch(u_layer, p + u_layerOff, 0);
  vec4 s = texelFetch(u_stroke, p + u_strokeOff, 0);
  if (u_wet > 0.0 && s.a > 0.0) {
    vec3 c = s.rgb / s.a;
    float a = mix(s.a, wetCurve(s.a), u_wet);
    s = vec4(c * a, a);
  }
  float m = u_opacity;
  if (u_hasSel) m *= texelFetch(u_sel, p + u_selOff, 0).r;
  o = bw_blend(d, s * m, u_mode, u_alphaLock);
}`;

// Multiply pixels by the selection mask (or its inverse).
const MASK_FS = /* glsl */ `
uniform sampler2D u_src; uniform ivec2 u_srcOff;
uniform sampler2D u_sel; uniform ivec2 u_selOff; uniform bool u_invert;
out vec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  float m = texelFetch(u_sel, p + u_selOff, 0).r;
  o = texelFetch(u_src, p + u_srcOff, 0) * (u_invert ? 1.0 - m : m);
}`;

// Draw a texture onto an arbitrary quad (transform tool, image placement, canvas rotation).
const QUAD_VS = /* glsl */ `
uniform vec2 u_corners[4];   // TL, TR, BR, BL in target pixels
uniform vec2 u_origin;       // target pixel at viewport origin
uniform vec2 u_size;         // viewport size
uniform vec4 u_uvRect;       // u0, v0, u1, v1
out vec2 v_uv;
const int IDX[6] = int[6](0, 1, 2, 0, 2, 3);
void main() {
  int i = IDX[gl_VertexID];
  vec2 uv = vec2(i == 1 || i == 2 ? u_uvRect.z : u_uvRect.x, i >= 2 ? u_uvRect.w : u_uvRect.y);
  vec2 p = (u_corners[i] - u_origin) / u_size * 2.0 - 1.0;
  gl_Position = vec4(p, 0.0, 1.0);
  v_uv = uv;
}`;
const QUAD_FS = /* glsl */ `
uniform sampler2D u_src; uniform float u_opacity;
in vec2 v_uv;
out vec4 o;
void main() { o = texture(u_src, v_uv) * u_opacity; }`;

// Screen view: composite + background/checkerboard + marching ants.
const VIEW_FS = /* glsl */ `
uniform sampler2D u_comp; uniform vec2 u_docSize;
uniform mat3 u_inv; uniform float u_canvasH; uniform float u_dpr;
uniform vec3 u_bg; uniform bool u_transparent; uniform vec3 u_outside;
uniform float u_zoom;
uniform sampler2D u_sel; uniform bool u_hasSel; uniform float u_time;
out vec4 o;
vec2 toDoc(vec2 sp) { return (u_inv * vec3(sp, 1.0)).xy; }
float selAt(vec2 d) { return texture(u_sel, d / u_docSize).r; }
void main() {
  vec2 sp = vec2(gl_FragCoord.x, u_canvasH - gl_FragCoord.y);
  vec2 d = toDoc(sp);
  if (d.x < 0.0 || d.y < 0.0 || d.x >= u_docSize.x || d.y >= u_docSize.y) {
    o = vec4(u_outside, 1.0);
    return;
  }
  vec3 base = u_bg;
  if (u_transparent) {
    vec2 cell = floor(sp / (8.0 * u_dpr));
    base = mod(cell.x + cell.y, 2.0) < 1.0 ? vec3(1.0) : vec3(0.84);
  }
  vec4 c;
  if (u_zoom >= 1.5) {
    c = texelFetch(u_comp, ivec2(d), 0);
  } else if (u_zoom >= 0.75) {
    c = texture(u_comp, d / u_docSize);
  } else {
    int n = int(clamp(ceil(1.0 / u_zoom), 2.0, 4.0));
    vec2 ex = (u_inv * vec3(1.0, 0.0, 0.0)).xy;
    vec2 ey = (u_inv * vec3(0.0, 1.0, 0.0)).xy;
    c = vec4(0.0);
    for (int j = 0; j < 4; j++) {
      if (j >= n) break;
      for (int i = 0; i < 4; i++) {
        if (i >= n) break;
        vec2 f = (vec2(float(i), float(j)) + 0.5) / float(n) - 0.5;
        c += texture(u_comp, (d + ex * f.x + ey * f.y) / u_docSize);
      }
    }
    c /= float(n * n);
  }
  vec3 col = c.rgb + base * (1.0 - c.a);
  if (u_hasSel) {
    float m = selAt(d) - 0.5;
    float mx = selAt(toDoc(sp + vec2(1.0, 0.0))) - 0.5;
    float my = selAt(toDoc(sp + vec2(0.0, 1.0))) - 0.5;
    bool inside = m >= 0.0;
    if (inside != (mx >= 0.0) || inside != (my >= 0.0)) {
      float k = mod(floor((sp.x + sp.y) / (4.0 * u_dpr) + u_time * 6.0), 2.0);
      col = k < 1.0 ? vec3(0.0) : vec3(1.0);
    }
  }
  o = vec4(col, 1.0);
}`;

// Box-filtered downscale for thumbnails.
const THUMB_FS = /* glsl */ `
uniform sampler2D u_src; uniform vec2 u_srcSize; uniform vec2 u_dstSize; uniform int u_taps;
uniform vec3 u_bg; uniform bool u_useBg;
out vec4 o;
void main() {
  vec2 p = gl_FragCoord.xy - 0.5;
  vec2 sc = u_srcSize / u_dstSize;
  vec4 acc = vec4(0.0);
  for (int j = 0; j < 8; j++) {
    if (j >= u_taps) break;
    for (int i = 0; i < 8; i++) {
      if (i >= u_taps) break;
      vec2 sp = (p + (vec2(float(i), float(j)) + 0.5) / float(u_taps)) * sc;
      acc += texture(u_src, sp / u_srcSize);
    }
  }
  acc /= float(u_taps * u_taps);
  if (u_useBg) acc = vec4(acc.rgb + u_bg * (1.0 - acc.a), 1.0);
  o = acc;
}`;

// Smudge: mix carried paint with what is under the dab, then lay it down through the tip mask.
const SMUDGE_MIX_FS = /* glsl */ `
uniform sampler2D u_carry; uniform sampler2D u_under; uniform float u_pickup;
out vec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  o = mix(texelFetch(u_carry, p, 0), texelFetch(u_under, p, 0), u_pickup);
}`;

// Tip mask shared by dab-based direct tools (smudge, blur).
const TIP_GLSL = /* glsl */ `
uniform int u_tipKind; uniform sampler2D u_tip; uniform float u_hardness;
uniform vec2 u_center; uniform float u_size; uniform float u_angle; uniform float u_roundness;
float tipMask(vec2 docP) {
  vec2 q = docP - u_center;
  float c = cos(-u_angle), s = sin(-u_angle);
  q = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
  q.y /= max(u_roundness, 0.05);
  vec2 local = q / u_size;
  if (abs(local.x) > 0.5 || abs(local.y) > 0.5) return 0.0;
  if (u_tipKind == 0) {
    float r = length(local) * 2.0;
    float soft = max(1.0 - u_hardness, 2.0 / max(u_size, 1.0));
    return 1.0 - smoothstep(1.0 - soft, 1.0, r);
  }
  return texture(u_tip, local + 0.5).r;
}`;

const SMUDGE_APPLY_FS = /* glsl */ `
${TIP_GLSL}
uniform sampler2D u_carry; uniform sampler2D u_under; uniform ivec2 u_origin;
uniform sampler2D u_sel; uniform bool u_hasSel; uniform float u_flow; uniform bool u_alphaLock;
out vec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 lp = p - u_origin;
  vec4 under = texelFetch(u_under, lp, 0);
  vec4 carry = texelFetch(u_carry, lp, 0);
  float m = tipMask(vec2(p) + 0.5) * u_flow;
  if (u_hasSel) m *= texelFetch(u_sel, p, 0).r;
  vec4 r = mix(under, carry, m);
  if (u_alphaLock) r = r.a > 0.0 ? vec4(r.rgb / r.a * under.a, under.a) : vec4(0.0);
  o = r;
}`;

const BLUR_APPLY_FS = /* glsl */ `
${TIP_GLSL}
uniform sampler2D u_under; uniform ivec2 u_origin; uniform vec2 u_underSize;
uniform sampler2D u_sel; uniform bool u_hasSel; uniform float u_flow; uniform float u_radius;
uniform bool u_alphaLock;
out vec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 lp = p - u_origin;
  vec4 under = texelFetch(u_under, lp, 0);
  float m = tipMask(vec2(p) + 0.5) * u_flow;
  if (u_hasSel) m *= texelFetch(u_sel, p, 0).r;
  if (m <= 0.0) { o = under; return; }
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (int j = -3; j <= 3; j++) {
    for (int i = -3; i <= 3; i++) {
      vec2 off = vec2(float(i), float(j)) * (u_radius / 3.0);
      float w = exp(-dot(vec2(i, j), vec2(i, j)) / 8.0);
      acc += texture(u_under, (vec2(lp) + 0.5 + off) / u_underSize) * w;
      wsum += w;
    }
  }
  vec4 r = mix(under, acc / wsum, m);
  if (u_alphaLock) r = r.a > 0.0 ? vec4(r.rgb / r.a * under.a, under.a) : vec4(0.0);
  o = r;
}`;

// Brush dabs, drawn instanced into the stroke buffer.
const STAMP_VS = /* glsl */ `
layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec4 a_shape;  // size, angle, roundness, flow
layout(location = 2) in vec3 a_color;
uniform vec2 u_target;
out vec2 v_local;
out vec2 v_doc;
out vec3 v_color;
out float v_flow;
out float v_size;
const vec2 C[6] = vec2[6](vec2(-0.5, -0.5), vec2(0.5, -0.5), vec2(0.5, 0.5), vec2(-0.5, -0.5), vec2(0.5, 0.5), vec2(-0.5, 0.5));
void main() {
  vec2 c = C[gl_VertexID];
  float size = max(a_shape.x, 1.5);
  // Tiny dabs are drawn at a minimum quad size and faded to keep thin lines continuous.
  float fade = min(1.0, (a_shape.x * a_shape.x) / (size * size) * 1.0);
  vec2 q = c * vec2(size, size * a_shape.z);
  float cs = cos(a_shape.y), sn = sin(a_shape.y);
  vec2 r = vec2(cs * q.x - sn * q.y, sn * q.x + cs * q.y);
  vec2 p = a_pos + r;
  gl_Position = vec4(p / u_target * 2.0 - 1.0, 0.0, 1.0);
  v_local = c;
  v_doc = p;
  v_color = a_color;
  v_flow = a_shape.w * fade;
  v_size = size;
}`;
const STAMP_FS = /* glsl */ `
uniform int u_tipKind; uniform sampler2D u_tip; uniform float u_hardness;
uniform sampler2D u_grain; uniform float u_grainScale; uniform float u_grainStrength;
in vec2 v_local; in vec2 v_doc; in vec3 v_color; in float v_flow; in float v_size;
out vec4 o;
void main() {
  float a;
  if (u_tipKind == 0) {
    float r = length(v_local) * 2.0;
    float soft = max(1.0 - u_hardness, 2.0 / v_size);
    a = 1.0 - smoothstep(1.0 - soft, 1.0, r);
  } else {
    a = texture(u_tip, v_local + 0.5).r;
  }
  if (u_grainStrength > 0.0) {
    float g = texture(u_grain, v_doc / u_grainScale).r;
    a *= clamp(1.0 - u_grainStrength * (1.0 - g) * 1.6, 0.0, 1.0);
  }
  a *= v_flow;
  o = vec4(v_color * a, a);
}`;

export interface Programs {
  composite: Program;
  merge: Program;
  mask: Program;
  quad: Program;
  view: Program;
  thumb: Program;
  stamp: Program;
  smudgeMix: Program;
  smudgeApply: Program;
  blurApply: Program;
}

export function createPrograms(gl: GL): Programs {
  return {
    composite: new Program(gl, FULLSCREEN_VS, COMPOSITE_FS, 'composite'),
    merge: new Program(gl, FULLSCREEN_VS, MERGE_FS, 'merge'),
    mask: new Program(gl, FULLSCREEN_VS, MASK_FS, 'mask'),
    quad: new Program(gl, QUAD_VS, QUAD_FS, 'quad'),
    view: new Program(gl, FULLSCREEN_VS, VIEW_FS, 'view'),
    thumb: new Program(gl, FULLSCREEN_VS, THUMB_FS, 'thumb'),
    stamp: new Program(gl, STAMP_VS, STAMP_FS, 'stamp'),
    smudgeMix: new Program(gl, FULLSCREEN_VS, SMUDGE_MIX_FS, 'smudgeMix'),
    smudgeApply: new Program(gl, FULLSCREEN_VS, SMUDGE_APPLY_FS, 'smudgeApply'),
    blurApply: new Program(gl, FULLSCREEN_VS, BLUR_APPLY_FS, 'blurApply'),
  };
}
