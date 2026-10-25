import { describe, expect, it } from 'vitest';
import { getPreset } from './presets';
import { DabGenerator, hsvToRgb, rgbToHsv, Stabilizer, type StrokePoint } from './stroke';

const line = (n: number, len: number, p = 1): StrokePoint[] =>
  Array.from({ length: n }, (_, i) => ({ x: (i / (n - 1)) * len, y: 0, p, t: i * 8 }));

function run(brushId: string, pts: StrokePoint[], size = 10, overrides = {}) {
  const gen = new DabGenerator({ ...getPreset(brushId), ...overrides }, { size, color: [0, 0, 0], seed: 1, pressureGamma: 1 });
  const dabs = pts.flatMap((p) => gen.add(p));
  dabs.push(...gen.end());
  return { gen, dabs };
}

describe('DabGenerator', () => {
  it('spaces dabs evenly by spacing x diameter', () => {
    const { dabs } = run('digital-pen', line(20, 200), 10, { spacing: 0.1 });
    // 200px at 1px spacing → about 200 dabs plus the first one.
    expect(dabs.length).toBeGreaterThan(190);
    expect(dabs.length).toBeLessThan(210);
    for (let i = 1; i < dabs.length; i++) {
      expect(dabs[i].x - dabs[i - 1].x).toBeCloseTo(1, 1);
    }
  });

  it('ends exactly where the stroke ends', () => {
    const { dabs } = run('digital-pen', line(10, 100), 10, { spacing: 0.05 });
    expect(dabs[dabs.length - 1].x).toBeGreaterThan(99);
  });

  it('pressure scales size by sizePressure', () => {
    const full = run('g-pen', line(5, 50, 1), 20).dabs;
    const light = run('g-pen', line(5, 50, 0.2), 20).dabs;
    const mid = (d: { size: number }[]) => d[Math.floor(d.length / 2)].size;
    expect(mid(light)).toBeLessThan(mid(full) * 0.5);
  });

  it('fade-in shrinks the first dabs; fade-out factor shrinks the last ones', () => {
    const { gen, dabs } = run('dip-pen', line(30, 300), 10);
    expect(dabs[0].size).toBeLessThan(dabs[dabs.length >> 1].size);
    expect(gen.taperOutFactor(dabs[dabs.length - 1])).toBeLessThan(0.5);
    expect(gen.taperOutFactor(dabs[dabs.length >> 1])).toBe(1);
  });

  it('is deterministic for a given seed (needed to re-render fade-out)', () => {
    const a = run('stars', line(10, 200), 30).dabs;
    const b = run('stars', line(10, 200), 30).dabs;
    expect(a).toEqual(b);
  });
});

describe('Stabilizer', () => {
  it('passes points through at strength 0', () => {
    const s = new Stabilizer(0);
    expect(s.push({ x: 5, y: 7, p: 1, t: 0 })).toMatchObject({ x: 5, y: 7 });
    expect(s.push({ x: 50, y: 70, p: 1, t: 8 })).toMatchObject({ x: 50, y: 70 });
  });

  it('lags behind with smoothing and catches up on finish', () => {
    const s = new Stabilizer(80);
    s.push({ x: 0, y: 0, p: 1, t: 0 });
    const mid = s.push({ x: 100, y: 0, p: 1, t: 8 })!;
    expect(mid.x).toBeGreaterThan(0);
    expect(mid.x).toBeLessThan(100);
    const tail = s.finish();
    expect(tail[tail.length - 1].x).toBeCloseTo(100);
  });

  it('rope mode only moves once the pen leaves the radius', () => {
    const s = new Stabilizer(50, 'rope', 10);
    s.push({ x: 0, y: 0, p: 1, t: 0 });
    expect(s.push({ x: 5, y: 0, p: 1, t: 8 })).toBeNull();
    expect(s.push({ x: 30, y: 0, p: 1, t: 16 })!.x).toBeCloseTo(20);
  });
});

describe('color conversion', () => {
  it('round-trips HSV', () => {
    for (const c of [[1, 0, 0], [0.2, 0.6, 0.9], [0.5, 0.5, 0.5], [0, 0, 0]] as [number, number, number][]) {
      const back = hsvToRgb(...rgbToHsv(...c));
      back.forEach((v, i) => expect(v).toBeCloseTo(c[i]));
    }
  });
});
