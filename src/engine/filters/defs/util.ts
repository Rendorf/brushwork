import { hexToRgb } from '../../../store/settings';
import type { Program } from '../../gl/gl';
import type { FilterRun } from '../runner';
import type { Value } from '../types';

/** Resolve a color parameter ('fg' = current color). */
export function colorOf(run: FilterRun, v: Value): [number, number, number] {
  return v === 'fg' ? run.fg : hexToRgb(String(v)) ?? [0, 0, 0];
}

export function setColor(p: Program, name: string, c: [number, number, number]): void {
  p.v3(name, c[0], c[1], c[2]);
}

/** Per-pixel adjustment on unpremultiplied color `c`; transparent pixels stay transparent. */
export function adjustShader(uniforms: string, body: string): string {
  return `${uniforms}
void main() {
  vec4 c = unpre(at(u_src, gl_FragCoord.xy));
  if (c.a <= 0.0) { o = vec4(0.0); return; }
  ${body}
  o = pre(clamp(c, 0.0, 1.0));
}`;
}

/** Center point parameter → document pixels. */
export function centerOf(run: FilterRun, v: Value): [number, number] {
  const p = v as [number, number];
  return [p[0] * run.docW, p[1] * run.docH];
}
