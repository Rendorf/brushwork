import type { Surface } from '../../gl/gl';
import type { FilterRun } from '../runner';
import { bool, num, str, type FilterDef } from '../types';

/** Edge-preserving smoothing (Kuwahara): each pixel takes the calmest of its four quadrants. */
function kuwahara(r: FilterRun, src: Surface, radius: number): Surface {
  return r.map(
    'kuwahara',
    `uniform int u_r;
     void main() {
       vec2 p = gl_FragCoord.xy;
       vec3 m[4]; vec3 s[4]; float w[4];
       for (int k = 0; k < 4; k++) { m[k] = vec3(0.0); s[k] = vec3(0.0); w[k] = 0.0; }
       for (int j = -10; j <= 10; j++) {
         if (j < -u_r || j > u_r) continue;
         for (int i = -10; i <= 10; i++) {
           if (i < -u_r || i > u_r) continue;
           vec4 c = at(u_src, p + vec2(float(i), float(j)));
           vec3 rgb = unpre(c).rgb * c.a;
           vec3 rgb2 = rgb * rgb / max(c.a, 1e-4);
           if (i <= 0 && j <= 0) { m[0] += rgb; s[0] += rgb2; w[0] += c.a; }
           if (i >= 0 && j <= 0) { m[1] += rgb; s[1] += rgb2; w[1] += c.a; }
           if (i <= 0 && j >= 0) { m[2] += rgb; s[2] += rgb2; w[2] += c.a; }
           if (i >= 0 && j >= 0) { m[3] += rgb; s[3] += rgb2; w[3] += c.a; }
         }
       }
       vec4 orig = at(u_src, p);
       float best = 1e9;
       vec3 col = unpre(orig).rgb;
       for (int k = 0; k < 4; k++) {
         if (w[k] <= 1e-4) continue;
         vec3 mean = m[k] / w[k];
         vec3 var = s[k] / w[k] - mean * mean;
         float v = var.r + var.g + var.b;
         if (v < best) { best = v; col = mean; }
       }
       o = pre(vec4(clamp(col, 0.0, 1.0), orig.a));
     }`,
    (p) => p.i('u_r', Math.round(radius)),
    src,
  );
}

/** Pencil-sketch style line extraction ("color dodge" of a blurred negative). Returns line alpha in .a. */
function lineArt(r: FilterRun, src: Surface, radius: number, gain: number, threshold: number, keepColor: boolean): Surface {
  const inv = r.map('line-inv', `void main() { vec4 c = at(u_src, gl_FragCoord.xy); float L = luma(c.rgb + (1.0 - c.a)); o = vec4(vec3(1.0 - L), 1.0); }`, undefined, src);
  const b = r.blur(inv, radius);
  return r.pass(
    'line-art',
    `uniform sampler2D u_src; uniform sampler2D u_b; uniform float u_gain; uniform float u_thr; uniform bool u_keep;
     void main() {
       vec4 c = at(u_src, gl_FragCoord.xy);
       vec3 rgb = c.rgb + (1.0 - c.a);
       float L = luma(rgb);
       float dodge = clamp(L / max(1.0 - at(u_b, gl_FragCoord.xy).r, 1e-3), 0.0, 1.0);
       float line = clamp((1.0 - dodge - u_thr) * u_gain, 0.0, 1.0);
       vec3 ink = u_keep ? clamp(rgb * 0.6, 0.0, 1.0) : vec3(0.0);
       o = vec4(ink * line, line);
     }`,
    r.surface(src.w, src.h),
    { u_src: src, u_b: b },
    (p) => p.f('u_gain', gain).f('u_thr', threshold).b('u_keep', keepColor),
  );
}

export const ARTISTIC: FilterDef[] = [
  {
    id: 'line-extract',
    name: 'Extract Line Art',
    category: 'Artistic',
    params: [
      { key: 'detail', label: 'Line width', type: 'range', min: 1, max: 20, step: 0.5, default: 3, unit: 'px' },
      { key: 'strength', label: 'Strength', type: 'range', min: 50, max: 800, step: 10, default: 300, unit: '%' },
      { key: 'threshold', label: 'Ignore faint lines', type: 'range', min: 0, max: 50, step: 1, default: 4, unit: '%' },
      { key: 'keep', label: 'Keep line colors', type: 'toggle', default: false },
    ],
    margin: (v) => num(v, 'detail') * 3,
    run: (r, v) => lineArt(r, r.src, num(v, 'detail'), num(v, 'strength') / 100, num(v, 'threshold') / 100, bool(v, 'keep')),
  },
  {
    id: 'halftone',
    name: 'Halftone',
    category: 'Artistic',
    params: [
      { key: 'cell', label: 'Dot spacing', type: 'range', min: 3, max: 80, step: 1, default: 10, unit: 'px' },
      { key: 'angle', label: 'Angle', type: 'range', min: 0, max: 90, step: 1, default: 45, unit: '°' },
      {
        key: 'shape',
        label: 'Shape',
        type: 'select',
        default: 'dot',
        options: [
          { value: 'dot', label: 'Dots' },
          { value: 'line', label: 'Lines' },
          { value: 'square', label: 'Squares' },
        ],
      },
      { key: 'color', label: 'Colored dots', type: 'toggle', default: false },
    ],
    margin: (v) => num(v, 'cell') * 2,
    run: (r, v) => {
      const cell = num(v, 'cell');
      const avg = r.blur(r.src, cell * 0.35);
      const a = (num(v, 'angle') * Math.PI) / 180;
      return r.pass(
        'halftone',
        `uniform sampler2D u_avg; uniform float u_cell; uniform vec2 u_rot; uniform int u_shape; uniform bool u_color;
         void main() {
           vec2 dp = docPos();
           float cs = u_rot.x, sn = u_rot.y;
           vec2 rp = vec2(cs * dp.x + sn * dp.y, -sn * dp.x + cs * dp.y);
           vec2 cc = (floor(rp / u_cell) + 0.5) * u_cell;
           vec2 back = vec2(cs * cc.x - sn * cc.y, sn * cc.x + cs * cc.y);
           vec4 a = texture(u_avg, (back - u_origin) / u_size);
           vec4 ua = unpre(a);
           float ink = clamp(1.0 - luma(ua.rgb), 0.0, 1.0);
           if (u_color) ink = 0.25 + ink * 0.75;
           vec2 lp = rp - cc;
           float cov;
           if (u_shape == 0) { float rad = u_cell * 0.7071 * sqrt(ink); cov = 1.0 - smoothstep(rad - 0.7, rad + 0.7, length(lp)); }
           else if (u_shape == 1) { float hw = u_cell * 0.5 * ink; cov = 1.0 - smoothstep(hw - 0.7, hw + 0.7, abs(lp.y)); }
           else { float hw = u_cell * 0.5 * sqrt(ink); cov = 1.0 - smoothstep(hw - 0.7, hw + 0.7, max(abs(lp.x), abs(lp.y))); }
           float alpha = cov * a.a;
           vec3 col = u_color ? ua.rgb : vec3(0.0);
           o = vec4(col * alpha, alpha);
         }`,
        r.surface(),
        { u_avg: avg },
        (p) => p.f('u_cell', cell).v2('u_rot', Math.cos(a), Math.sin(a)).i('u_shape', ['dot', 'line', 'square'].indexOf(str(v, 'shape'))).b('u_color', bool(v, 'color')),
      );
    },
  },
  {
    id: 'mosaic',
    name: 'Mosaic',
    category: 'Artistic',
    params: [{ key: 'cell', label: 'Cell size', type: 'range', min: 2, max: 128, step: 1, default: 16, unit: 'px' }],
    run: (r, v) => {
      const s = Math.round(num(v, 'cell'));
      return r.upsample(r.downsample(r.src, s), s, r.w, r.h, true);
    },
  },
  {
    id: 'noise',
    name: 'Noise',
    category: 'Artistic',
    params: [
      { key: 'amount', label: 'Amount', type: 'range', min: 0, max: 100, step: 1, default: 20, unit: '%' },
      { key: 'mono', label: 'Monochrome', type: 'toggle', default: true },
      { key: 'seed', label: 'Variation', type: 'range', min: 0, max: 100, step: 1, default: 0 },
    ],
    run: (r, v) =>
      r.map(
        'noise',
        `uniform float u_k; uniform bool u_mono; uniform float u_seed;
         float g(vec2 p) { return (hash12(p) + hash12(p * 1.31 + 17.17) + hash12(p * 0.77 + 41.3)) / 1.5 - 1.0; }
         void main() {
           vec4 c = unpre(at(u_src, gl_FragCoord.xy));
           if (c.a <= 0.0) { o = vec4(0.0); return; }
           vec2 dp = docPos() + u_seed * 97.0;
           vec3 n = u_mono ? vec3(g(dp)) : vec3(g(dp), g(dp + 311.7), g(dp + 723.1));
           c.rgb = clamp(c.rgb + n * u_k, 0.0, 1.0);
           o = pre(c);
         }`,
        (p) => p.f('u_k', num(v, 'amount') / 100).b('u_mono', bool(v, 'mono')).f('u_seed', num(v, 'seed')),
      ),
  },
  {
    id: 'chromatic',
    name: 'Chromatic Aberration',
    category: 'Artistic',
    params: [
      { key: 'amount', label: 'Shift', type: 'range', min: 0, max: 60, step: 0.5, default: 6, unit: 'px' },
      {
        key: 'mode',
        label: 'Direction',
        type: 'select',
        default: 'radial',
        options: [
          { value: 'radial', label: 'From center' },
          { value: 'linear', label: 'Fixed angle' },
        ],
      },
      { key: 'angle', label: 'Angle', type: 'range', min: -180, max: 180, step: 1, default: 0, unit: '°' },
    ],
    margin: (v) => num(v, 'amount'),
    run: (r, v) => {
      const a = (num(v, 'angle') * Math.PI) / 180;
      return r.map(
        'chromatic',
        `uniform float u_k; uniform bool u_radial; uniform vec2 u_dir;
         void main() {
           vec2 p = gl_FragCoord.xy;
           vec2 d = u_radial ? (docPos() - u_docSize * 0.5) / (0.5 * length(u_docSize)) * u_k : u_dir * u_k;
           vec4 cr = at(u_src, p + d), cg = at(u_src, p), cb = at(u_src, p - d);
           float a = max(max(cr.a, cg.a), cb.a);
           o = vec4(min(cr.r, a), min(cg.g, a), min(cb.b, a), a);
         }`,
        (p) => p.f('u_k', num(v, 'amount')).b('u_radial', str(v, 'mode') === 'radial').v2('u_dir', Math.cos(a), Math.sin(a)),
      );
    },
  },
  {
    id: 'painting',
    name: 'Painting (Smooth)',
    category: 'Artistic',
    params: [{ key: 'radius', label: 'Brush size', type: 'range', min: 1, max: 10, step: 1, default: 4, unit: 'px' }],
    margin: (v) => num(v, 'radius') + 1,
    run: (r, v) => kuwahara(r, r.src, num(v, 'radius')),
  },
  {
    id: 'anime-bg',
    name: 'Anime Background',
    category: 'Artistic',
    params: [
      { key: 'smooth', label: 'Smoothness', type: 'range', min: 1, max: 10, step: 1, default: 5, unit: 'px' },
      { key: 'boost', label: 'Color boost', type: 'range', min: 0, max: 100, step: 1, default: 45, unit: '%' },
      { key: 'levels', label: 'Color steps (0 = off)', type: 'range', min: 0, max: 16, step: 1, default: 8 },
      { key: 'lines', label: 'Outlines', type: 'range', min: 0, max: 100, step: 1, default: 40, unit: '%' },
    ],
    margin: () => 14,
    run: (r, v) => {
      const k = kuwahara(r, r.src, num(v, 'smooth'));
      const lines = lineArt(r, r.src, 2, 4, 0.06, false);
      return r.pass(
        'anime-bg',
        `uniform sampler2D u_k; uniform sampler2D u_lines; uniform float u_boost; uniform float u_levels; uniform float u_line;
         void main() {
           vec4 c = unpre(at(u_k, gl_FragCoord.xy));
           if (c.a <= 0.0) { o = vec4(0.0); return; }
           vec3 h = rgb2hsl(c.rgb);
           h.y = clamp(h.y * (1.0 + u_boost * 1.2), 0.0, 1.0);
           h.z = clamp((h.z - 0.5) * (1.0 + u_boost * 0.4) + 0.5 + u_boost * 0.04, 0.0, 1.0);
           c.rgb = hsl2rgb(h);
           if (u_levels >= 2.0) c.rgb = floor(c.rgb * u_levels * 0.9999) / (u_levels - 1.0);
           c.rgb *= 1.0 - at(u_lines, gl_FragCoord.xy).a * u_line;
           o = pre(clamp(c, 0.0, 1.0));
         }`,
        r.surface(),
        { u_k: k, u_lines: lines },
        (p) => p.f('u_boost', num(v, 'boost') / 100).f('u_levels', num(v, 'levels')).f('u_line', num(v, 'lines') / 100),
      );
    },
  },
  {
    id: 'frosted',
    name: 'Frosted Glass',
    category: 'Artistic',
    params: [{ key: 'amount', label: 'Scatter', type: 'range', min: 1, max: 40, step: 0.5, default: 6, unit: 'px' }],
    margin: (v) => num(v, 'amount'),
    run: (r, v) =>
      r.map(
        'frosted',
        `uniform float u_k;
         void main() {
           vec2 dp = docPos();
           vec2 j = (vec2(hash12(dp), hash12(dp + 17.31)) - 0.5) * 2.0 * u_k;
           o = at(u_src, gl_FragCoord.xy + j);
         }`,
        (p) => p.f('u_k', num(v, 'amount')),
      ),
  },
];
