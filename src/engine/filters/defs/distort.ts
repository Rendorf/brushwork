import { num, type FilterDef } from '../types';
import { centerOf } from './util';

const center = { key: 'center', label: 'Center (tap the canvas)', type: 'point' as const, default: [0.5, 0.5] as [number, number] };

/** Radius parameter as a fraction of the canvas's shorter side. */
const radiusPx = (pct: number, w: number, h: number) => (pct / 100) * Math.min(w, h) * 0.5;

export const DISTORT: FilterDef[] = [
  {
    id: 'wave',
    name: 'Wave',
    category: 'Distort',
    params: [
      { key: 'amp', label: 'Height', type: 'range', min: 0, max: 200, step: 1, default: 12, unit: 'px' },
      { key: 'wl', label: 'Wavelength', type: 'range', min: 4, max: 1000, step: 1, default: 120, unit: 'px' },
      { key: 'angle', label: 'Direction', type: 'range', min: -180, max: 180, step: 1, default: 0, unit: '°' },
      { key: 'phase', label: 'Phase', type: 'range', min: 0, max: 360, step: 1, default: 0, unit: '°' },
    ],
    margin: (v) => num(v, 'amp'),
    run: (r, v) => {
      const a = (num(v, 'angle') * Math.PI) / 180;
      return r.map(
        'wave',
        `uniform float u_amp; uniform float u_wl; uniform vec2 u_dir; uniform float u_phase;
         void main() {
           vec2 dp = docPos();
           float t = dot(dp, u_dir) / u_wl * 6.2831853 + u_phase;
           vec2 n = vec2(-u_dir.y, u_dir.x);
           o = at(u_src, dp + n * sin(t) * u_amp - u_origin);
         }`,
        (p) => p.f('u_amp', num(v, 'amp')).f('u_wl', num(v, 'wl')).v2('u_dir', Math.cos(a), Math.sin(a)).f('u_phase', (num(v, 'phase') * Math.PI) / 180),
      );
    },
  },
  {
    id: 'swirl',
    name: 'Swirl',
    category: 'Distort',
    params: [
      center,
      { key: 'radius', label: 'Radius', type: 'range', min: 1, max: 150, step: 1, default: 60, unit: '%' },
      { key: 'angle', label: 'Twist', type: 'range', min: -720, max: 720, step: 1, default: 180, unit: '°' },
    ],
    run: (r, v) => {
      const [cx, cy] = centerOf(r, v.center);
      return r.map(
        'swirl',
        `uniform vec2 u_c; uniform float u_R; uniform float u_a;
         void main() {
           vec2 d = docPos() - u_c;
           float rr = length(d);
           if (rr < u_R) {
             float t = 1.0 - rr / u_R;
             float ang = u_a * t * t;
             float cs = cos(ang), sn = sin(ang);
             d = vec2(cs * d.x - sn * d.y, sn * d.x + cs * d.y);
           }
           o = at(u_src, u_c + d - u_origin);
         }`,
        (p) => p.v2('u_c', cx, cy).f('u_R', radiusPx(num(v, 'radius'), r.docW, r.docH)).f('u_a', (num(v, 'angle') * Math.PI) / 180),
      );
    },
  },
  {
    id: 'ripple',
    name: 'Ripple',
    category: 'Distort',
    params: [
      center,
      { key: 'amp', label: 'Height', type: 'range', min: 0, max: 100, step: 0.5, default: 8, unit: 'px' },
      { key: 'wl', label: 'Wavelength', type: 'range', min: 4, max: 400, step: 1, default: 40, unit: 'px' },
      { key: 'decay', label: 'Fade with distance', type: 'range', min: 0, max: 100, step: 1, default: 30, unit: '%' },
    ],
    margin: (v) => num(v, 'amp'),
    run: (r, v) => {
      const [cx, cy] = centerOf(r, v.center);
      return r.map(
        'ripple',
        `uniform vec2 u_c; uniform float u_amp; uniform float u_wl; uniform float u_decay;
         void main() {
           vec2 d = docPos() - u_c;
           float rr = length(d);
           float off = sin(rr / u_wl * 6.2831853) * u_amp * exp(-u_decay * 4.0 * rr / max(u_docSize.x, u_docSize.y));
           vec2 dir = rr > 0.0 ? d / rr : vec2(0.0);
           o = at(u_src, u_c + d + dir * off - u_origin);
         }`,
        (p) => p.v2('u_c', cx, cy).f('u_amp', num(v, 'amp')).f('u_wl', num(v, 'wl')).f('u_decay', num(v, 'decay') / 100),
      );
    },
  },
  {
    id: 'bulge',
    name: 'Bulge / Pinch',
    category: 'Distort',
    params: [
      center,
      { key: 'radius', label: 'Radius', type: 'range', min: 1, max: 150, step: 1, default: 50, unit: '%' },
      { key: 'amount', label: 'Amount (− pinch, + bulge)', type: 'range', min: -100, max: 100, step: 1, default: 50, unit: '%' },
    ],
    run: (r, v) => {
      const [cx, cy] = centerOf(r, v.center);
      return r.map(
        'bulge',
        `uniform vec2 u_c; uniform float u_R; uniform float u_k;
         void main() {
           vec2 d = docPos() - u_c;
           float rr = length(d);
           if (rr < u_R && rr > 0.0) {
             float rn = rr / u_R;
             d *= pow(rn, exp(u_k)) / rn;
           }
           o = at(u_src, u_c + d - u_origin);
         }`,
        (p) => p.v2('u_c', cx, cy).f('u_R', radiusPx(num(v, 'radius'), r.docW, r.docH)).f('u_k', num(v, 'amount') / 100),
      );
    },
  },
];
