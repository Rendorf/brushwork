import { num, type FilterDef } from '../types';
import { centerOf } from './util';

const center = { key: 'center', label: 'Center (tap the canvas)', type: 'point' as const, default: [0.5, 0.5] as [number, number] };

export const BLUR: FilterDef[] = [
  {
    id: 'gaussian-blur',
    name: 'Gaussian Blur',
    category: 'Blur',
    params: [{ key: 'radius', label: 'Radius', type: 'range', min: 0, max: 200, step: 0.5, default: 8, unit: 'px' }],
    margin: (v) => num(v, 'radius') * 1.5,
    run: (r, v) => r.blur(r.src, num(v, 'radius') / 2),
  },
  {
    id: 'motion-blur',
    name: 'Motion Blur',
    category: 'Blur',
    params: [
      { key: 'angle', label: 'Angle', type: 'range', min: -180, max: 180, step: 1, default: 0, unit: '°' },
      { key: 'dist', label: 'Distance', type: 'range', min: 0, max: 400, step: 1, default: 30, unit: 'px' },
    ],
    margin: (v) => num(v, 'dist'),
    run: (r, v) => {
      const a = (num(v, 'angle') * Math.PI) / 180;
      return r.map(
        'motion-blur',
        `uniform vec2 u_d; uniform int u_n;
         void main() {
           vec4 acc = vec4(0.0);
           for (int i = 0; i < 128; i++) {
             if (i >= u_n) break;
             float t = float(i) / float(u_n - 1) - 0.5;
             acc += at(u_src, gl_FragCoord.xy + u_d * t);
           }
           o = acc / float(u_n);
         }`,
        (p) => p.v2('u_d', Math.cos(a) * num(v, 'dist'), Math.sin(a) * num(v, 'dist')).i('u_n', Math.max(2, Math.min(128, Math.ceil(num(v, 'dist'))))),
      );
    },
  },
  {
    id: 'radial-blur',
    name: 'Radial Blur (Spin)',
    category: 'Blur',
    params: [center, { key: 'angle', label: 'Angle', type: 'range', min: 0, max: 90, step: 0.5, default: 10, unit: '°' }],
    run: (r, v) => {
      const [cx, cy] = centerOf(r, v.center);
      return r.map(
        'radial-blur',
        `uniform vec2 u_c; uniform float u_a;
         void main() {
           vec2 d = docPos() - u_c;
           vec4 acc = vec4(0.0);
           for (int i = 0; i < 64; i++) {
             float t = (float(i) / 63.0 - 0.5) * u_a;
             float cs = cos(t), sn = sin(t);
             vec2 q = u_c + vec2(cs * d.x - sn * d.y, sn * d.x + cs * d.y);
             acc += at(u_src, q - u_origin);
           }
           o = acc / 64.0;
         }`,
        (p) => p.v2('u_c', cx, cy).f('u_a', (num(v, 'angle') * Math.PI) / 180),
      );
    },
  },
  {
    id: 'zoom-blur',
    name: 'Zoom Blur',
    category: 'Blur',
    params: [center, { key: 'amount', label: 'Amount', type: 'range', min: 0, max: 100, step: 1, default: 20, unit: '%' }],
    run: (r, v) => {
      const [cx, cy] = centerOf(r, v.center);
      return r.map(
        'zoom-blur',
        `uniform vec2 u_c; uniform float u_k;
         void main() {
           vec2 d = docPos() - u_c;
           vec4 acc = vec4(0.0);
           for (int i = 0; i < 64; i++) {
             float s = 1.0 - u_k * float(i) / 63.0;
             acc += at(u_src, u_c + d * s - u_origin);
           }
           o = acc / 64.0;
         }`,
        (p) => p.v2('u_c', cx, cy).f('u_k', num(v, 'amount') / 100),
      );
    },
  },
  {
    id: 'lens-blur',
    name: 'Lens Blur (Bokeh)',
    category: 'Blur',
    params: [
      { key: 'radius', label: 'Radius', type: 'range', min: 1, max: 60, step: 0.5, default: 10, unit: 'px' },
      { key: 'boost', label: 'Highlight boost', type: 'range', min: 0, max: 100, step: 1, default: 40, unit: '%' },
    ],
    margin: (v) => num(v, 'radius'),
    run: (r, v) =>
      r.map(
        'lens-blur',
        `uniform float u_r; uniform float u_boost;
         void main() {
           vec4 acc = vec4(0.0);
           float ws = 0.0;
           for (int i = 0; i < 128; i++) {
             float rr = sqrt((float(i) + 0.5) / 128.0) * u_r;
             float th = float(i) * 2.39996323;
             vec4 c = at(u_src, gl_FragCoord.xy + vec2(cos(th), sin(th)) * rr);
             float w = 1.0 + u_boost * 8.0 * pow(luma(unpre(c).rgb) * c.a, 4.0);
             acc += c * w;
             ws += w;
           }
           o = acc / ws;
         }`,
        (p) => p.f('u_r', num(v, 'radius')).f('u_boost', num(v, 'boost') / 100),
      ),
  },
  {
    id: 'sharpen',
    name: 'Sharpen',
    category: 'Blur',
    params: [
      { key: 'amount', label: 'Amount', type: 'range', min: 0, max: 300, step: 1, default: 80, unit: '%' },
      { key: 'radius', label: 'Radius', type: 'range', min: 0.5, max: 20, step: 0.5, default: 1.5, unit: 'px' },
    ],
    margin: (v) => num(v, 'radius') * 2,
    run: (r, v) => {
      const b = r.blur(r.src, num(v, 'radius'));
      return r.pass(
        'sharpen',
        `uniform sampler2D u_src; uniform sampler2D u_blur; uniform float u_k;
         void main() {
           vec4 s = at(u_src, gl_FragCoord.xy), b = at(u_blur, gl_FragCoord.xy);
           vec4 c = s + (s - b) * u_k;
           c.a = clamp(c.a, 0.0, 1.0);
           o = vec4(clamp(c.rgb, 0.0, c.a), c.a);
         }`,
        r.surface(),
        { u_src: r.src, u_blur: b },
        (p) => p.f('u_k', num(v, 'amount') / 100),
      );
    },
  },
];
