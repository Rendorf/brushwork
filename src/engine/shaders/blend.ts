// GLSL blend functions. Mirrors blendPremul() in ../blendModes.ts.
export const BLEND_GLSL = /* glsl */ `
float bw_lum(vec3 c) { return dot(c, vec3(0.3, 0.59, 0.11)); }
vec3 bw_clipColor(vec3 c) {
  float l = bw_lum(c);
  float n = min(min(c.r, c.g), c.b);
  float x = max(max(c.r, c.g), c.b);
  if (n < 0.0) c = l + (c - l) * l / max(l - n, 1e-6);
  if (x > 1.0) c = l + (c - l) * (1.0 - l) / max(x - l, 1e-6);
  return c;
}
vec3 bw_setLum(vec3 c, float l) { return bw_clipColor(c + (l - bw_lum(c))); }
float bw_sat(vec3 c) { return max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b); }
vec3 bw_setSat(vec3 c, float s) {
  float mx = max(max(c.r, c.g), c.b);
  float mn = min(min(c.r, c.g), c.b);
  if (mx > mn) return (c - mn) * s / (mx - mn);
  return vec3(0.0);
}
float bw_dodge(float b, float s) {
  if (b <= 0.0) return 0.0;
  if (s >= 1.0) return 1.0;
  return min(1.0, b / (1.0 - s));
}
float bw_burn(float b, float s) {
  if (b >= 1.0) return 1.0;
  if (s <= 0.0) return 0.0;
  return 1.0 - min(1.0, (1.0 - b) / s);
}
float bw_hard(float b, float s) {
  return s <= 0.5 ? b * 2.0 * s : b + (2.0 * s - 1.0) - b * (2.0 * s - 1.0);
}
float bw_soft(float b, float s) {
  if (s <= 0.5) return b - (1.0 - 2.0 * s) * b * (1.0 - b);
  float d = b <= 0.25 ? ((16.0 * b - 12.0) * b + 4.0) * b : sqrt(b);
  return b + (2.0 * s - 1.0) * (d - b);
}
float bw_sep(float b, float s, int m) {
  if (m == 1) return b * s;
  if (m == 2) return b + s - b * s;
  if (m == 3) return bw_hard(s, b);
  if (m == 4) return min(b, s);
  if (m == 5) return max(b, s);
  if (m == 6) return bw_dodge(b, s);
  if (m == 7) return bw_burn(b, s);
  if (m == 8) return bw_hard(b, s);
  if (m == 9) return bw_soft(b, s);
  if (m == 10) return abs(b - s);
  if (m == 11) return b + s - 2.0 * b * s;
  if (m == 16) return max(b + s - 1.0, 0.0);
  if (m == 17) return min(b + s, 1.0);
  if (m == 18) return clamp(b + 2.0 * s - 1.0, 0.0, 1.0);
  if (m == 19) return s <= 0.5 ? bw_burn(b, 2.0 * s) : bw_dodge(b, 2.0 * (s - 0.5));
  if (m == 20) return s <= 0.5 ? min(b, 2.0 * s) : max(b, 2.0 * s - 1.0);
  if (m == 21) return b + s >= 1.0 ? 1.0 : 0.0;
  if (m == 22) return max(b - s, 0.0);
  if (m == 23) return s <= 0.0 ? (b <= 0.0 ? 0.0 : 1.0) : min(b / s, 1.0);
  return s;
}
vec3 bw_blendRGB(vec3 cb, vec3 cs, int m) {
  if (m == 12) return bw_setLum(bw_setSat(cs, bw_sat(cb)), bw_lum(cb));
  if (m == 13) return bw_setLum(bw_setSat(cb, bw_sat(cs)), bw_lum(cb));
  if (m == 14) return bw_setLum(cs, bw_lum(cb));
  if (m == 15) return bw_setLum(cb, bw_lum(cs));
  if (m == 24) return bw_lum(cs) < bw_lum(cb) ? cs : cb;
  if (m == 25) return bw_lum(cs) > bw_lum(cb) ? cs : cb;
  return vec3(bw_sep(cb.r, cs.r, m), bw_sep(cb.g, cs.g, m), bw_sep(cb.b, cs.b, m));
}
// Composite premultiplied s over premultiplied b. atop keeps the backdrop alpha.
vec4 bw_blend(vec4 b, vec4 s, int m, bool atop) {
  float ab = b.a;
  float as = s.a;
  if (m == 100) return atop ? b : b * (1.0 - as);
  if (m == 101) return s;
  if (m == 26) {
    float a = atop ? ab : as + ab * (1.0 - as);
    return vec4(min(b.rgb + s.rgb, vec3(a)), a);
  }
  vec3 cb = ab > 0.0 ? b.rgb / ab : vec3(0.0);
  vec3 cs = as > 0.0 ? s.rgb / as : vec3(0.0);
  vec3 B;
  if (m == 0) {
    B = cs;
  } else if (m == 27) {
    B = vec3(
      cb.r <= 0.0 ? 0.0 : min(1.0, cb.r / max(1.0 - cs.r * as, 1e-6)),
      cb.g <= 0.0 ? 0.0 : min(1.0, cb.g / max(1.0 - cs.g * as, 1e-6)),
      cb.b <= 0.0 ? 0.0 : min(1.0, cb.b / max(1.0 - cs.b * as, 1e-6)));
  } else {
    B = bw_blendRGB(cb, cs, m);
  }
  vec3 co = (atop ? vec3(0.0) : s.rgb * (1.0 - ab)) + b.rgb * (1.0 - as) + as * ab * clamp(B, 0.0, 1.0);
  return vec4(co, atop ? ab : as + ab * (1.0 - as));
}
`;
