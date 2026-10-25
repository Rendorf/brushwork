import { gradientLut } from '../../tools/gradientTool';
import { curvesLut, IDENTITY_CURVES } from '../curves';
import { bool, num, str, type Curves, type FilterDef } from '../types';
import type { GradientStop } from '../../../store/settings';
import { adjustShader, colorOf, setColor } from './util';

const pct = (label: string, key: string, min = -100, max = 100, def = 0) => ({ key, label, type: 'range' as const, min, max, step: 1, default: def, unit: '%' });

export const ADJUST: FilterDef[] = [
  {
    id: 'brightness-contrast',
    name: 'Brightness / Contrast',
    category: 'Adjust',
    params: [pct('Brightness', 'b'), pct('Contrast', 'c')],
    run: (r, v) =>
      r.map(
        'brightness-contrast',
        adjustShader(
          'uniform float u_b; uniform float u_c;',
          `c.rgb += u_b * 0.5;
           float k = u_c >= 0.0 ? 1.0 / max(1.0 - u_c * 0.98, 0.02) : 1.0 + u_c;
           c.rgb = (c.rgb - 0.5) * k + 0.5;`,
        ),
        (p) => p.f('u_b', num(v, 'b') / 100).f('u_c', num(v, 'c') / 100),
      ),
  },
  {
    id: 'hsl',
    name: 'Hue / Saturation / Lightness',
    category: 'Adjust',
    params: [
      { key: 'h', label: 'Hue', type: 'range', min: -180, max: 180, step: 1, default: 0, unit: '°' },
      pct('Saturation', 's'),
      pct('Lightness', 'l'),
      { key: 'colorize', label: 'Colorize', type: 'toggle', default: false },
    ],
    run: (r, v) =>
      r.map(
        'hsl',
        adjustShader(
          'uniform float u_h; uniform float u_s; uniform float u_l; uniform bool u_colorize;',
          `vec3 h = rgb2hsl(c.rgb);
           if (u_colorize) { h.x = fract(u_h + 1.0); h.y = clamp(0.5 + u_s * 0.5, 0.0, 1.0); }
           else { h.x = fract(h.x + u_h + 1.0); h.y = clamp(h.y * (1.0 + u_s), 0.0, 1.0); }
           h.z = u_l >= 0.0 ? mix(h.z, 1.0, u_l) : h.z * (1.0 + u_l);
           c.rgb = hsl2rgb(h);`,
        ),
        (p) => p.f('u_h', num(v, 'h') / 360).f('u_s', num(v, 's') / 100).f('u_l', num(v, 'l') / 100).b('u_colorize', bool(v, 'colorize')),
      ),
  },
  {
    id: 'color-balance',
    name: 'Color Balance',
    category: 'Adjust',
    params: [
      {
        key: 'tone',
        label: 'Tones',
        type: 'select',
        default: 'mid',
        options: [
          { value: 'shadow', label: 'Shadows' },
          { value: 'mid', label: 'Midtones' },
          { value: 'high', label: 'Highlights' },
        ],
      },
      pct('Cyan ↔ Red', 'cr'),
      pct('Magenta ↔ Green', 'mg'),
      pct('Yellow ↔ Blue', 'yb'),
      { key: 'keepLum', label: 'Preserve luminosity', type: 'toggle', default: true },
    ],
    run: (r, v) =>
      r.map(
        'color-balance',
        adjustShader(
          'uniform vec3 u_shift; uniform int u_tone; uniform bool u_keep;',
          `float L = luma(c.rgb);
           float w = u_tone == 0 ? 1.0 - smoothstep(0.0, 0.55, L) : u_tone == 2 ? smoothstep(0.45, 1.0, L) : 1.0 - abs(L - 0.5) * 2.0;
           c.rgb += u_shift * w * 0.4;
           if (u_keep) c.rgb += L - luma(c.rgb);`,
        ),
        (p) =>
          p
            .v3('u_shift', num(v, 'cr') / 100, num(v, 'mg') / 100, num(v, 'yb') / 100)
            .i('u_tone', ['shadow', 'mid', 'high'].indexOf(str(v, 'tone')))
            .b('u_keep', bool(v, 'keepLum')),
      ),
  },
  {
    id: 'levels',
    name: 'Levels',
    category: 'Adjust',
    params: [
      { key: 'inB', label: 'Input black', type: 'range', min: 0, max: 254, step: 1, default: 0 },
      { key: 'inW', label: 'Input white', type: 'range', min: 1, max: 255, step: 1, default: 255 },
      { key: 'gamma', label: 'Midtones (gamma)', type: 'range', min: 0.1, max: 5, step: 0.01, default: 1 },
      { key: 'outB', label: 'Output black', type: 'range', min: 0, max: 255, step: 1, default: 0 },
      { key: 'outW', label: 'Output white', type: 'range', min: 0, max: 255, step: 1, default: 255 },
    ],
    run: (r, v) =>
      r.map(
        'levels',
        adjustShader(
          'uniform vec4 u_lv; uniform float u_outW;',
          `c.rgb = clamp((c.rgb - u_lv.x) / max(u_lv.y - u_lv.x, 1e-3), 0.0, 1.0);
           c.rgb = pow(c.rgb, vec3(1.0 / u_lv.z));
           c.rgb = mix(vec3(u_lv.w), vec3(u_outW), c.rgb);`,
        ),
        (p) => p.v4('u_lv', num(v, 'inB') / 255, num(v, 'inW') / 255, num(v, 'gamma'), num(v, 'outB') / 255).f('u_outW', num(v, 'outW') / 255),
      ),
  },
  {
    id: 'curves',
    name: 'Tone Curve',
    category: 'Adjust',
    params: [{ key: 'curves', label: 'Curve', type: 'curves', default: IDENTITY_CURVES() }],
    run: (r, v) => {
      const lut = r.surface(256, 1);
      lut.upload(0, 0, 256, 1, curvesLut(v.curves as Curves));
      return r.pass(
        'curves',
        `uniform sampler2D u_src; uniform sampler2D u_lut;
         float lk(float x, int ch) { return texelFetch(u_lut, ivec2(int(clamp(x, 0.0, 1.0) * 255.0 + 0.5), 0), 0)[ch]; }
         void main() {
           vec4 c = unpre(at(u_src, gl_FragCoord.xy));
           if (c.a <= 0.0) { o = vec4(0.0); return; }
           o = pre(vec4(lk(c.r, 0), lk(c.g, 1), lk(c.b, 2), c.a));
         }`,
        r.surface(),
        { u_src: r.src, u_lut: lut },
      );
    },
  },
  {
    id: 'gradient-map',
    name: 'Gradient Map',
    category: 'Adjust',
    params: [
      {
        key: 'stops',
        label: 'Gradient',
        type: 'gradient',
        default: [
          { t: 0, color: '#1b1035', a: 1 },
          { t: 0.5, color: '#c2366b', a: 1 },
          { t: 1, color: '#ffd27a', a: 1 },
        ],
      },
      { key: 'reverse', label: 'Reverse', type: 'toggle', default: false },
    ],
    run: (r, v) => {
      const lut = r.surface(256, 1);
      lut.upload(0, 0, 256, 1, gradientLut(v.stops as GradientStop[], r.fg, bool(v, 'reverse')));
      return r.pass(
        'gradient-map',
        `uniform sampler2D u_src; uniform sampler2D u_lut;
         void main() {
           vec4 c = unpre(at(u_src, gl_FragCoord.xy));
           if (c.a <= 0.0) { o = vec4(0.0); return; }
           vec4 g = texelFetch(u_lut, ivec2(int(luma(c.rgb) * 255.0 + 0.5), 0), 0);
           o = g * c.a;
         }`,
        r.surface(),
        { u_src: r.src, u_lut: lut },
      );
    },
  },
  {
    id: 'replace-color',
    name: 'Replace Color',
    category: 'Adjust',
    params: [
      { key: 'from', label: 'Color to replace', type: 'color', default: 'fg' },
      { key: 'to', label: 'New color', type: 'color', default: '#3d8bff' },
      { key: 'tol', label: 'Tolerance', type: 'range', min: 0, max: 100, step: 1, default: 25, unit: '%' },
      { key: 'soft', label: 'Softness', type: 'range', min: 0, max: 100, step: 1, default: 20, unit: '%' },
    ],
    run: (r, v) =>
      r.map(
        'replace-color',
        adjustShader(
          'uniform vec3 u_from; uniform vec3 u_to; uniform float u_tol; uniform float u_soft;',
          `float d = distance(c.rgb, u_from) / 1.732;
           float w = 1.0 - smoothstep(u_tol, u_tol + u_soft + 1e-3, d);
           vec3 hc = rgb2hsl(c.rgb), hf = rgb2hsl(u_from), ht = rgb2hsl(u_to);
           vec3 n = hsl2rgb(vec3(fract(hc.x + ht.x - hf.x + 1.0), clamp(hc.y + ht.y - hf.y, 0.0, 1.0), clamp(hc.z + ht.z - hf.z, 0.0, 1.0)));
           c.rgb = mix(c.rgb, n, w);`,
        ),
        (p) => {
          setColor(p, 'u_from', colorOf(r, v.from));
          setColor(p, 'u_to', colorOf(r, v.to));
          p.f('u_tol', num(v, 'tol') / 100).f('u_soft', num(v, 'soft') / 100);
        },
      ),
  },
  {
    id: 'temperature',
    name: 'Temperature / Tint',
    category: 'Adjust',
    params: [pct('Temperature', 't'), pct('Tint', 'g')],
    run: (r, v) =>
      r.map(
        'temperature',
        adjustShader('uniform float u_t; uniform float u_g;', `c.rgb *= vec3(1.0 + u_t * 0.25, 1.0 - u_g * 0.2, 1.0 - u_t * 0.25);`),
        (p) => p.f('u_t', num(v, 't') / 100).f('u_g', num(v, 'g') / 100),
      ),
  },
  {
    id: 'invert',
    name: 'Invert',
    category: 'Adjust',
    params: [],
    run: (r) => r.map('invert', adjustShader('', 'c.rgb = 1.0 - c.rgb;')),
  },
  {
    id: 'grayscale',
    name: 'Grayscale',
    category: 'Adjust',
    params: [],
    run: (r) => r.map('grayscale', adjustShader('', 'c.rgb = vec3(luma(c.rgb));')),
  },
  {
    id: 'sepia',
    name: 'Sepia',
    category: 'Adjust',
    params: [],
    run: (r) =>
      r.map(
        'sepia',
        adjustShader('', 'c.rgb = vec3(dot(c.rgb, vec3(0.393, 0.769, 0.189)), dot(c.rgb, vec3(0.349, 0.686, 0.168)), dot(c.rgb, vec3(0.272, 0.534, 0.131)));'),
      ),
  },
  {
    id: 'posterize',
    name: 'Posterize',
    category: 'Adjust',
    params: [{ key: 'n', label: 'Levels', type: 'range', min: 2, max: 32, step: 1, default: 5 }],
    run: (r, v) =>
      r.map('posterize', adjustShader('uniform float u_n;', 'c.rgb = floor(c.rgb * u_n * 0.9999) / (u_n - 1.0);'), (p) => p.f('u_n', num(v, 'n'))),
  },
  {
    id: 'threshold',
    name: 'Threshold',
    category: 'Adjust',
    params: [{ key: 't', label: 'Level', type: 'range', min: 1, max: 254, step: 1, default: 128 }],
    run: (r, v) =>
      r.map('threshold', adjustShader('uniform float u_t;', 'c.rgb = vec3(luma(c.rgb) >= u_t ? 1.0 : 0.0);'), (p) => p.f('u_t', num(v, 't') / 255)),
  },
];
