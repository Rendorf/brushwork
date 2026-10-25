import { describe, expect, it } from 'vitest';
import { timelapsePlan } from './timelapseExport';

describe('time-lapse plan', () => {
  it('shows every frame at 30 fps when asked', () => {
    const p = timelapsePlan(5, 'every');
    expect(p.indices).toEqual([0, 1, 2, 3, 4]);
    expect(p.duration).toBeCloseTo(1 / 30);
  });

  it('samples long recordings down to the target length', () => {
    const p = timelapsePlan(9000, 30);
    expect(p.indices).toHaveLength(900);
    expect(p.indices[0]).toBe(0);
    expect(p.indices[899]).toBe(8990);
    expect(p.duration * p.indices.length).toBeCloseTo(30);
  });

  it('stretches short recordings to the target length', () => {
    const p = timelapsePlan(10, 15);
    expect(p.indices).toHaveLength(10);
    expect(p.duration).toBeCloseTo(1.5);
  });

  it('handles empty recordings', () => {
    expect(timelapsePlan(0, 30).indices).toEqual([]);
  });
});
