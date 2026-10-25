import { bool, num, str, type FilterDef } from '../types';
import { centerOf, colorOf, setColor } from './util';

const color = { key: 'color', label: 'Color', type: 'color' as const, default: 'fg' };
const angle = (def = 45) => ({ key: 'angle', label: 'Angle', type: 'range' as const, min: -180, max: 180, step: 1, default: def, unit: '°' });
const seed = { key: 'seed', label: 'Variation', type: 'range' as const, min: 0, max: 100, step: 1, default: 0 };

export const GENERATE: FilterDef[] = [
  {
    id: 'clouds',
    name: 'Clouds',
    category: 'Generate',
    generator: true,
    params: [
      color,
      { key: 'scale', label: 'Scale', type: 'range', min: 8, max: 2000, step: 1, default: 300, unit: 'px' },
      { key: 'detail', label: 'Detail', type: 'range', min: 1, max: 8, step: 1, default: 5 },
      { key: 'contrast', label: 'Contrast', type: 'range', min: 10, max: 300, step: 1, default: 130, unit: '%' },
      {
        key: 'mode',
        label: 'Colors',
        type: 'select',
        default: 'transparent',
        options: [
          { value: 'transparent', label: 'Color + transparent' },
          { value: 'white', label: 'Color + white' },
          { value: 'black', label: 'Color + black' },
        ],
      },
      seed,
    ],
    run: (r, v) =>
      r.pass(
        'clouds',
        `uniform vec3 u_col; uniform float u_scale; uniform int u_oct; uniform float u_contrast; uniform float u_seed; uniform int u_mode;
         void main() {
           vec2 p = docPos() / u_scale + u_seed * 13.7;
           float a = 0.5, s = 0.0, norm = 0.0;
           for (int i = 0; i < 8; i++) {
             if (i >= u_oct) break;
             s += a * vnoise(p);
             norm += a;
             p = p * 2.03 + 17.1;
             a *= 0.5;
           }
           float n = clamp((s / norm - 0.5) * u_contrast + 0.5, 0.0, 1.0);
           if (u_mode == 0) o = vec4(u_col * n, n);
           else if (u_mode == 1) o = vec4(mix(vec3(1.0), u_col, n), 1.0);
           else o = vec4(u_col * n, 1.0);
         }`,
        r.surface(),
        {},
        (p) => {
          setColor(p, 'u_col', colorOf(r, v.color));
          p.f('u_scale', num(v, 'scale')).i('u_oct', num(v, 'detail')).f('u_contrast', num(v, 'contrast') / 100 * 2).f('u_seed', num(v, 'seed'));
          p.i('u_mode', ['transparent', 'white', 'black'].indexOf(str(v, 'mode')));
        },
      ),
  },
  {
    id: 'stripes',
    name: 'Stripes',
    category: 'Generate',
    generator: true,
    params: [
      color,
      { key: 'period', label: 'Spacing', type: 'range', min: 2, max: 500, step: 1, default: 40, unit: 'px' },
      { key: 'ratio', label: 'Stripe width', type: 'range', min: 1, max: 99, step: 1, default: 50, unit: '%' },
      angle(45),
    ],
    run: (r, v) => {
      const a = (num(v, 'angle') * Math.PI) / 180;
      return r.pass(
        'stripes',
        `uniform vec3 u_col; uniform float u_period; uniform float u_on; uniform vec2 u_dir;
         void main() {
           float f = mod(dot(docPos(), u_dir), u_period);
           float d = abs(f - u_on * 0.5);
           d = min(d, u_period - d);
           float a = 1.0 - smoothstep(u_on * 0.5 - 0.5, u_on * 0.5 + 0.5, d);
           o = vec4(u_col * a, a);
         }`,
        r.surface(),
        {},
        (p) => {
          setColor(p, 'u_col', colorOf(r, v.color));
          p.f('u_period', num(v, 'period')).f('u_on', (num(v, 'period') * num(v, 'ratio')) / 100).v2('u_dir', Math.cos(a), Math.sin(a));
        },
      );
    },
  },
  {
    id: 'dots',
    name: 'Polka Dots',
    category: 'Generate',
    generator: true,
    params: [
      color,
      { key: 'spacing', label: 'Spacing', type: 'range', min: 4, max: 500, step: 1, default: 40, unit: 'px' },
      { key: 'size', label: 'Dot size', type: 'range', min: 1, max: 100, step: 1, default: 45, unit: '%' },
      { key: 'stagger', label: 'Offset rows', type: 'toggle', default: true },
    ],
    run: (r, v) =>
      r.pass(
        'dots',
        `uniform vec3 u_col; uniform float u_s; uniform float u_k; uniform bool u_stagger;
         void main() {
           vec2 g = docPos() / u_s;
           if (u_stagger && mod(floor(g.y), 2.0) >= 1.0) g.x += 0.5;
           float d = length(fract(g) - 0.5) * u_s;
           float rad = u_k * u_s * 0.5;
           float a = 1.0 - smoothstep(rad - 0.7, rad + 0.7, d);
           o = vec4(u_col * a, a);
         }`,
        r.surface(),
        {},
        (p) => {
          setColor(p, 'u_col', colorOf(r, v.color));
          p.f('u_s', num(v, 'spacing')).f('u_k', num(v, 'size') / 100).b('u_stagger', bool(v, 'stagger'));
        },
      ),
  },
  {
    id: 'checker',
    name: 'Checkerboard',
    category: 'Generate',
    generator: true,
    params: [color, { key: 'size', label: 'Square size', type: 'range', min: 2, max: 500, step: 1, default: 32, unit: 'px' }],
    run: (r, v) =>
      r.pass(
        'checker',
        `uniform vec3 u_col; uniform float u_s;
         void main() {
           vec2 c = floor(docPos() / u_s);
           float a = mod(c.x + c.y, 2.0) < 1.0 ? 1.0 : 0.0;
           o = vec4(u_col * a, a);
         }`,
        r.surface(),
        {},
        (p) => {
          setColor(p, 'u_col', colorOf(r, v.color));
          p.f('u_s', num(v, 'size'));
        },
      ),
  },
  {
    id: 'grid-lines',
    name: 'Grid Lines',
    category: 'Generate',
    generator: true,
    params: [
      color,
      { key: 'spacing', label: 'Spacing', type: 'range', min: 4, max: 500, step: 1, default: 50, unit: 'px' },
      { key: 'width', label: 'Line width', type: 'range', min: 0.5, max: 50, step: 0.5, default: 2, unit: 'px' },
    ],
    run: (r, v) =>
      r.pass(
        'grid-lines',
        `uniform vec3 u_col; uniform float u_s; uniform float u_w;
         float line(float t) { float f = mod(t, u_s); float d = min(f, u_s - f); return 1.0 - smoothstep(u_w * 0.5 - 0.5, u_w * 0.5 + 0.5, d); }
         void main() {
           vec2 p = docPos();
           float a = max(line(p.x), line(p.y));
           o = vec4(u_col * a, a);
         }`,
        r.surface(),
        {},
        (p) => {
          setColor(p, 'u_col', colorOf(r, v.color));
          p.f('u_s', num(v, 'spacing')).f('u_w', num(v, 'width'));
        },
      ),
  },
  {
    id: 'speed-lines',
    name: 'Speed Lines (Focus)',
    category: 'Generate',
    generator: true,
    params: [
      color,
      { key: 'center', label: 'Center (tap the canvas)', type: 'point', default: [0.5, 0.5] },
      { key: 'count', label: 'Lines', type: 'range', min: 20, max: 600, step: 1, default: 180 },
      { key: 'inner', label: 'Empty middle', type: 'range', min: 0, max: 90, step: 1, default: 35, unit: '%' },
      { key: 'thick', label: 'Thickness', type: 'range', min: 5, max: 100, step: 1, default: 45, unit: '%' },
      { key: 'rand', label: 'Randomness', type: 'range', min: 0, max: 100, step: 1, default: 60, unit: '%' },
      seed,
    ],
    run: (r, v) => {
      const [cx, cy] = centerOf(r, v.center);
      const inner = (num(v, 'inner') / 100) * 0.5 * Math.hypot(r.docW, r.docH);
      return r.pass(
        'speed-lines',
        `uniform vec3 u_col; uniform vec2 u_c; uniform float u_n; uniform float u_inner; uniform float u_thick; uniform float u_rand; uniform float u_seed;
         void main() {
           vec2 d = docPos() - u_c;
           float rr = length(d);
           float x = (atan(d.y, d.x) / 6.2831853 + 0.5) * u_n;
           float i = floor(x), f = fract(x);
           float h1 = hash12(vec2(i, u_seed)), h2 = hash12(vec2(i, u_seed + 5.3)), h3 = hash12(vec2(i, u_seed + 9.1));
           float present = step(u_rand * 0.6, h1);
           float w = u_thick * (1.0 - u_rand * 0.8 * h2);
           float start = u_inner * (1.0 + u_rand * (h3 - 0.5) * 0.8);
           float grow = clamp((rr - start) / max(start * 0.6, 8.0), 0.0, 1.0);
           float perPx = 6.2831853 * rr / u_n;
           float halfPx = w * 0.5 * grow * perPx;
           float distPx = abs(f - 0.5) * perPx;
           float a = (1.0 - smoothstep(halfPx - 0.6, halfPx + 0.6, distPx)) * present * step(start, rr);
           o = vec4(u_col * a, a);
         }`,
        r.surface(),
        {},
        (p) => {
          setColor(p, 'u_col', colorOf(r, v.color));
          p.v2('u_c', cx, cy).f('u_n', num(v, 'count')).f('u_inner', inner).f('u_thick', num(v, 'thick') / 100).f('u_rand', num(v, 'rand') / 100).f('u_seed', num(v, 'seed'));
        },
      );
    },
  },
  {
    id: 'parallel-lines',
    name: 'Speed Lines (Parallel)',
    category: 'Generate',
    generator: true,
    params: [
      color,
      angle(0),
      { key: 'spacing', label: 'Spacing', type: 'range', min: 3, max: 200, step: 1, default: 18, unit: 'px' },
      { key: 'thick', label: 'Thickness', type: 'range', min: 0.5, max: 40, step: 0.5, default: 5, unit: 'px' },
      { key: 'length', label: 'Length', type: 'range', min: 5, max: 100, step: 1, default: 40, unit: '%' },
      { key: 'rand', label: 'Randomness', type: 'range', min: 0, max: 100, step: 1, default: 60, unit: '%' },
      seed,
    ],
    run: (r, v) => {
      const a = (num(v, 'angle') * Math.PI) / 180;
      return r.pass(
        'parallel-lines',
        `uniform vec3 u_col; uniform vec2 u_dir; uniform float u_s; uniform float u_t; uniform float u_len; uniform float u_rand; uniform float u_seed; uniform vec2 u_range;
         void main() {
           vec2 p = docPos();
           float L = length(u_docSize);
           float along = dot(p, u_dir);
           float across = dot(p, vec2(-u_dir.y, u_dir.x)) + L;
           float row = floor(across / u_s), f = fract(across / u_s);
           float h1 = hash12(vec2(row, u_seed)), h2 = hash12(vec2(row, u_seed + 3.7)), h3 = hash12(vec2(row, u_seed + 8.9)), h4 = hash12(vec2(row, u_seed + 12.3));
           float present = step(u_rand * 0.7, h1);
           float thick = u_t * (1.0 - u_rand * 0.7 * h2);
           float len = u_len * L * (1.0 - u_rand * 0.6 * h3);
           float start = mix(u_range.x, u_range.y, h4) - len * 0.5;
           float t = (along - start) / len;
           float hw = thick * 0.5 * sin(3.14159265 * clamp(t, 0.0, 1.0));
           float dpx = abs(f - 0.5) * u_s;
           float a = (1.0 - smoothstep(hw - 0.6, hw + 0.6, dpx)) * present * step(0.0, t) * step(t, 1.0);
           o = vec4(u_col * a, a);
         }`,
        r.surface(),
        {},
        (p) => {
          setColor(p, 'u_col', colorOf(r, v.color));
          p.v2('u_dir', Math.cos(a), Math.sin(a)).f('u_s', num(v, 'spacing')).f('u_t', num(v, 'thick')).f('u_len', num(v, 'length') / 100);
          p.f('u_rand', num(v, 'rand') / 100).f('u_seed', num(v, 'seed'));
          // Spread line starts over the canvas as seen along the line direction.
          const d = [0, r.docW].flatMap((x) => [0, r.docH].map((y) => x * Math.cos(a) + y * Math.sin(a)));
          p.v2('u_range', Math.min(...d), Math.max(...d));
        },
      );
    },
  },
];
