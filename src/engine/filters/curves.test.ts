import { describe, expect, it } from 'vitest';
import { curvesLut, curveTable, IDENTITY_CURVES } from './curves';

describe('tone curves', () => {
  it('the identity curve maps every value to itself', () => {
    const t = curveTable([[0, 0], [1, 1]]);
    for (let i = 0; i < 256; i++) expect(t[i]).toBeCloseTo(i / 255, 5);
  });

  it('passes through its control points and never overshoots', () => {
    const pts: [number, number][] = [[0, 0], [0.25, 0.05], [0.5, 0.5], [0.75, 0.95], [1, 1]];
    const t = curveTable(pts);
    expect(t[Math.round(0.5 * 255)]).toBeCloseTo(0.5, 1);
    for (let i = 1; i < 256; i++) expect(t[i]).toBeGreaterThanOrEqual(t[i - 1] - 1e-6);
    for (const v of t) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('flat ends extend beyond the outer points', () => {
    const t = curveTable([[0.2, 0.3], [0.8, 0.6]]);
    expect(t[0]).toBeCloseTo(0.3);
    expect(t[255]).toBeCloseTo(0.6);
  });

  it('channel curves apply after the master curve', () => {
    const c = IDENTITY_CURVES();
    c.rgb = [[0, 1], [1, 0]];
    c.r = [[0, 0], [1, 0.5]];
    const lut = curvesLut(c);
    // input 0 → master 1 → red 0.5, green/blue 1
    expect(lut[0]).toBe(128);
    expect(lut[1]).toBe(255);
    expect(lut[2]).toBe(255);
  });
});
