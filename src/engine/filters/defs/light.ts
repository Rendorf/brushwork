import { num, str, type FilterDef } from '../types';
import { colorOf, setColor } from './util';

/** Composite a colored, already-premultiplied-by-alpha effect behind the layer content. */
const BEHIND = `
uniform sampler2D u_src; uniform sampler2D u_fx; uniform vec3 u_col; uniform float u_op;
void main() {
  vec4 s = at(u_src, gl_FragCoord.xy);
  float a = clamp(EFFECT_ALPHA, 0.0, 1.0) * u_op;
  o = s + vec4(u_col * a, a) * (1.0 - s.a);
}`;

export const LIGHT: FilterDef[] = [
  {
    id: 'glow',
    name: 'Glow (Bloom)',
    category: 'Light & Shadow',
    params: [
      { key: 'threshold', label: 'Brightness threshold', type: 'range', min: 0, max: 100, step: 1, default: 55, unit: '%' },
      { key: 'radius', label: 'Radius', type: 'range', min: 1, max: 200, step: 1, default: 24, unit: 'px' },
      { key: 'strength', label: 'Strength', type: 'range', min: 0, max: 300, step: 1, default: 120, unit: '%' },
    ],
    margin: (v) => num(v, 'radius') * 1.5,
    run: (r, v) => {
      const bright = r.map(
        'glow-extract',
        `uniform float u_t;
         void main() {
           vec4 c = at(u_src, gl_FragCoord.xy);
           float L = luma(unpre(c).rgb) * c.a;
           o = c * smoothstep(u_t, u_t + 0.2, L);
         }`,
        (p) => p.f('u_t', num(v, 'threshold') / 100),
      );
      const g = r.blur(bright, num(v, 'radius') / 2);
      return r.pass(
        'glow',
        `uniform sampler2D u_src; uniform sampler2D u_g; uniform float u_k;
         void main() {
           vec4 s = at(u_src, gl_FragCoord.xy), g = at(u_g, gl_FragCoord.xy) * u_k;
           vec4 c = s + g - s * g;
           c.a = clamp(c.a, 0.0, 1.0);
           o = vec4(clamp(c.rgb, 0.0, c.a), c.a);
         }`,
        r.surface(),
        { u_src: r.src, u_g: g },
        (p) => p.f('u_k', num(v, 'strength') / 100),
      );
    },
  },
  {
    id: 'outer-glow',
    name: 'Outer Glow',
    category: 'Light & Shadow',
    params: [
      { key: 'color', label: 'Color', type: 'color', default: '#ffe066' },
      { key: 'radius', label: 'Size', type: 'range', min: 1, max: 200, step: 1, default: 20, unit: 'px' },
      { key: 'spread', label: 'Spread', type: 'range', min: 0, max: 100, step: 1, default: 30, unit: '%' },
      { key: 'opacity', label: 'Opacity', type: 'range', min: 0, max: 100, step: 1, default: 90, unit: '%' },
    ],
    margin: (v) => num(v, 'radius') * 2,
    run: (r, v) => {
      const b = r.blur(r.src, num(v, 'radius') / 2);
      return r.pass(
        'outer-glow',
        BEHIND.replace('EFFECT_ALPHA', 'at(u_fx, gl_FragCoord.xy).a * (1.0 + u_spread * 6.0)').replace('uniform float u_op;', 'uniform float u_op; uniform float u_spread;'),
        r.surface(),
        { u_src: r.src, u_fx: b },
        (p) => {
          setColor(p, 'u_col', colorOf(r, v.color));
          p.f('u_op', num(v, 'opacity') / 100).f('u_spread', num(v, 'spread') / 100);
        },
      );
    },
  },
  {
    id: 'drop-shadow',
    name: 'Drop Shadow',
    category: 'Light & Shadow',
    params: [
      { key: 'color', label: 'Color', type: 'color', default: '#000000' },
      { key: 'dx', label: 'Offset X', type: 'range', min: -200, max: 200, step: 1, default: 12, unit: 'px' },
      { key: 'dy', label: 'Offset Y', type: 'range', min: -200, max: 200, step: 1, default: 12, unit: 'px' },
      { key: 'radius', label: 'Blur', type: 'range', min: 0, max: 100, step: 1, default: 10, unit: 'px' },
      { key: 'opacity', label: 'Opacity', type: 'range', min: 0, max: 100, step: 1, default: 60, unit: '%' },
    ],
    margin: (v) => Math.max(Math.abs(num(v, 'dx')), Math.abs(num(v, 'dy'))) + num(v, 'radius') * 1.5,
    run: (r, v) => {
      const shifted = r.map('shadow-shift', `uniform vec2 u_d; void main() { o = vec4(at(u_src, gl_FragCoord.xy - u_d).a); }`, (p) => p.v2('u_d', num(v, 'dx'), num(v, 'dy')));
      const b = r.blur(shifted, num(v, 'radius') / 2);
      return r.pass('drop-shadow', BEHIND.replace('EFFECT_ALPHA', 'at(u_fx, gl_FragCoord.xy).a'), r.surface(), { u_src: r.src, u_fx: b }, (p) => {
        setColor(p, 'u_col', colorOf(r, v.color));
        p.f('u_op', num(v, 'opacity') / 100);
      });
    },
  },
  {
    id: 'outline',
    name: 'Outline',
    category: 'Light & Shadow',
    params: [
      { key: 'color', label: 'Color', type: 'color', default: '#ffffff' },
      { key: 'width', label: 'Width', type: 'range', min: 1, max: 100, step: 0.5, default: 6, unit: 'px' },
    ],
    margin: (v) => num(v, 'width') + 2,
    run: (r, v) => {
      const w = num(v, 'width');
      const seeds = r.nearestSeeds(r.src, w + 2);
      return r.pass(
        'outline',
        `uniform sampler2D u_src; uniform sampler2D u_seeds; uniform vec3 u_col; uniform float u_w;
         void main() {
           vec4 s = at(u_src, gl_FragCoord.xy);
           vec2 sd = seedAt(u_seeds, ivec2(gl_FragCoord.xy));
           float d = sd.x < 0.0 ? 1e6 : max(0.0, length(sd - gl_FragCoord.xy) - 0.5);
           float a = clamp(u_w + 0.5 - d, 0.0, 1.0);
           o = s + vec4(u_col * a, a) * (1.0 - s.a);
         }`,
        r.surface(),
        { u_src: r.src, u_seeds: seeds },
        (p) => {
          setColor(p, 'u_col', colorOf(r, v.color));
          p.f('u_w', w);
        },
      );
    },
  },
  {
    id: 'emboss',
    name: 'Emboss',
    category: 'Light & Shadow',
    params: [
      { key: 'angle', label: 'Light angle', type: 'range', min: -180, max: 180, step: 1, default: -45, unit: '°' },
      { key: 'height', label: 'Height', type: 'range', min: 0.5, max: 10, step: 0.5, default: 3 },
      {
        key: 'mode',
        label: 'Result',
        type: 'select',
        default: 'color',
        options: [
          { value: 'color', label: 'Keep colors' },
          { value: 'gray', label: 'Gray relief' },
        ],
      },
    ],
    margin: () => 3,
    run: (r, v) => {
      const a = (num(v, 'angle') * Math.PI) / 180;
      return r.map(
        'emboss',
        `uniform vec2 u_l; uniform float u_h; uniform bool u_gray;
         float hgt(vec2 p) { vec4 c = at(u_src, p); return luma(unpre(c).rgb) * c.a; }
         void main() {
           vec2 p = gl_FragCoord.xy;
           vec2 g = vec2(hgt(p + vec2(1, 0)) - hgt(p - vec2(1, 0)), hgt(p + vec2(0, 1)) - hgt(p - vec2(0, 1))) * u_h;
           vec3 n = normalize(vec3(-g, 1.0));
           float shade = dot(n, normalize(vec3(u_l, 1.0)));
           vec4 c = unpre(at(u_src, p));
           if (c.a <= 0.0) { o = vec4(0.0); return; }
           c.rgb = u_gray ? vec3(0.5 + (shade - 0.7) * 1.2) : clamp(c.rgb * (0.3 + shade), 0.0, 1.0);
           o = pre(c);
         }`,
        (p) => p.v2('u_l', Math.cos(a), Math.sin(a)).f('u_h', num(v, 'height') * 4).b('u_gray', str(v, 'mode') === 'gray'),
      );
    },
  },
  {
    id: 'vignette',
    name: 'Vignette',
    category: 'Light & Shadow',
    params: [
      { key: 'color', label: 'Color', type: 'color', default: '#000000' },
      { key: 'amount', label: 'Amount', type: 'range', min: 0, max: 100, step: 1, default: 60, unit: '%' },
      { key: 'size', label: 'Size', type: 'range', min: 0, max: 100, step: 1, default: 55, unit: '%' },
      { key: 'soft', label: 'Softness', type: 'range', min: 1, max: 100, step: 1, default: 50, unit: '%' },
    ],
    run: (r, v) =>
      r.map(
        'vignette',
        `uniform vec3 u_col; uniform float u_k; uniform float u_inner; uniform float u_soft;
         void main() {
           vec4 c = at(u_src, gl_FragCoord.xy);
           vec2 q = (docPos() / u_docSize - 0.5) * 2.0;
           float d = length(q) / 1.4142;
           float w = smoothstep(u_inner, u_inner + u_soft, d) * u_k;
           o = vec4(mix(c.rgb, u_col * c.a, w), c.a);
         }`,
        (p) => {
          setColor(p, 'u_col', colorOf(r, v.color));
          p.f('u_k', num(v, 'amount') / 100).f('u_inner', num(v, 'size') / 100).f('u_soft', num(v, 'soft') / 100);
        },
      ),
  },
];
