import { describe, expect, it } from 'vitest';
import { alphaBounds, dilate, distanceTransform, erode, floodFill, premultiply, unpremultiply } from './pixels';
import { apply, invert, multiply, rotate, scale, translate } from './geom';

/** A W x H transparent image with a 1px black square outline from (a,a) to (b,b), with an optional gap. */
function boxImage(W: number, H: number, a: number, b: number, gap = 0): Uint8Array {
  const px = new Uint8Array(W * H * 4);
  const set = (x: number, y: number) => {
    const i = (y * W + x) * 4;
    px[i + 3] = 255;
  };
  for (let i = a; i <= b; i++) {
    set(i, a);
    set(i, b);
    set(a, i);
    // Leave a gap in the right edge.
    const mid = (a + b) >> 1;
    if (Math.abs(i - mid) >= Math.ceil(gap / 2) || gap === 0) set(b, i);
  }
  return px;
}

const count = (m: Uint8Array) => m.reduce((n, v) => n + (v > 127 ? 1 : 0), 0);

describe('floodFill', () => {
  const opts = { tolerance: 0, gap: 0, expand: 0, antialias: false };

  it('fills the inside of a closed shape only', () => {
    const px = boxImage(40, 40, 5, 25);
    const res = floodFill(px, 40, 40, 15, 15, opts)!;
    expect(count(res.mask)).toBe(19 * 19);
    expect(res.bounds).toEqual({ x: 6, y: 6, w: 19, h: 19 });
  });

  it('leaks through a gap without gap closing, and not with it', () => {
    const px = boxImage(60, 60, 10, 40, 3);
    const leaky = floodFill(px, 60, 60, 25, 25, opts)!;
    expect(count(leaky.mask)).toBeGreaterThan(1000);
    const closed = floodFill(px, 60, 60, 25, 25, { ...opts, gap: 3 })!;
    expect(count(closed.mask)).toBeLessThanOrEqual(29 * 29 + 4);
    expect(count(closed.mask)).toBeGreaterThan(29 * 29 * 0.9);
  });

  it('expand grows the region under the line art', () => {
    const px = boxImage(40, 40, 5, 25);
    const res = floodFill(px, 40, 40, 15, 15, { ...opts, expand: 1 })!;
    expect(res.bounds).toEqual({ x: 5, y: 5, w: 21, h: 21 });
  });

  it('returns null outside the image', () => {
    expect(floodFill(new Uint8Array(16), 2, 2, 5, 5, opts)).toBeNull();
  });
});

describe('distance transforms', () => {
  it('measures roughly euclidean distance in thirds of a pixel', () => {
    const W = 21, H = 21;
    const d = distanceTransform(W, H, (i) => i === 10 * W + 10);
    expect(d[10 * W + 15]).toBe(15);
    expect(d[10 * W + 10]).toBe(0);
  });

  it('dilate then erode restores a square', () => {
    const W = 30, H = 30;
    const m = new Uint8Array(W * H);
    for (let y = 10; y < 20; y++) for (let x = 10; x < 20; x++) m[y * W + x] = 255;
    const back = erode(dilate(m, W, H, 3), W, H, 3);
    expect(count(back)).toBe(count(m));
  });
});

describe('pixel helpers', () => {
  it('finds alpha bounds', () => {
    const px = new Uint8Array(10 * 10 * 4);
    px[(3 * 10 + 4) * 4 + 3] = 1;
    px[(6 * 10 + 8) * 4 + 3] = 1;
    expect(alphaBounds(px, 10, 10)).toEqual({ x: 4, y: 3, w: 5, h: 4 });
  });

  it('premultiply / unpremultiply round-trip opaque and keep alpha', () => {
    const src = new Uint8ClampedArray([200, 100, 50, 255, 200, 100, 50, 128]);
    const back = unpremultiply(premultiply(src));
    expect(Array.from(back.slice(0, 4))).toEqual([200, 100, 50, 255]);
    expect(back[7]).toBe(128);
    expect(Math.abs(back[4] - 200)).toBeLessThanOrEqual(2);
  });
});

describe('affine matrices', () => {
  it('invert undoes a combined transform', () => {
    const m = multiply(multiply(translate(30, -5), rotate(0.7)), scale(2.5, 2.5));
    const p = apply(m, 12, 34);
    const q = apply(invert(m), p.x, p.y);
    expect(q.x).toBeCloseTo(12);
    expect(q.y).toBeCloseTo(34);
  });
});
