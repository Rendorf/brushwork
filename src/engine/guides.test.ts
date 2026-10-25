import { describe, expect, it } from 'vitest';
import { RulerSnap, symmetryMatrices, transformDab, type Ruler } from './guides';
import { apply } from './util/geom';
import { applyMat3, denseMesh, invertMat3, isConvexQuad, meshFrom, meshPoint, squareToQuad } from './warp';
import { shapeOutline } from './tools/shapeTool';
import { gradientLut } from './tools/gradientTool';
import { maskFromGray } from './brush/customTips';

const run = (r: Ruler, pts: [number, number][], snap = 5, decide = 5) => {
  const s = new RulerSnap(r, snap, decide);
  return pts.map(([x, y]) => s.project({ x, y }));
};

describe('RulerSnap', () => {
  it('straight ruler: strokes run parallel to the ruler from where they start', () => {
    const out = run({ kind: 'line', a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }, [[10, 50], [40, 57], [80, 43]]);
    expect(out.every((p) => p && Math.abs(p.y - 50) < 1e-9)).toBe(true);
    expect(out[2]!.x).toBeCloseTo(80);
  });

  it('straight ruler: strokes starting close to it land exactly on it', () => {
    const out = run({ kind: 'line', a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }, [[10, 3], [60, 9]]);
    expect(out[0]!.y).toBeCloseTo(0);
    expect(out[1]!.y).toBeCloseTo(0);
  });

  it('ellipse ruler: follows the concentric ellipse through the start point', () => {
    const r: Ruler = { kind: 'ellipse', c: { x: 0, y: 0 }, rx: 100, ry: 50, rot: 0, circle: false };
    const out = run(r, [[200, 0], [0, 130], [-150, -20]]);
    // Start is on the 2x ellipse; every point stays on it: (x/200)^2 + (y/100)^2 = 1
    for (const p of out) expect((p!.x / 200) ** 2 + (p!.y / 100) ** 2).toBeCloseTo(1);
  });

  it('perspective: waits for movement, then locks to the closest vanishing direction', () => {
    const r: Ruler = { kind: 'perspective', vps: [{ x: -1000, y: 0 }, { x: 1000, y: 0 }] };
    const out = run(r, [[0, 100], [2, 101], [40, 95], [80, 92]]);
    expect(out[0]).toEqual({ x: 0, y: 100 });
    expect(out[1]).toBeNull();
    // Direction towards the right VP: y = 100 - x / 10
    for (const p of out.slice(2)) expect(p!.y).toBeCloseTo(100 - p!.x / 10, 6);
  });

  it('2-point perspective offers vertical lines too', () => {
    const r: Ruler = { kind: 'perspective', vps: [{ x: -1000, y: 0 }, { x: 1000, y: 0 }] };
    const out = run(r, [[0, 100], [3, 140], [-4, 200]]);
    expect(out[2]!.x).toBeCloseTo(0);
  });

  it('radial ruler: strokes go along rays from the center', () => {
    const out = run({ kind: 'radial', c: { x: 0, y: 0 } }, [[10, 10], [50, 40]]);
    expect(out[1]!.x).toBeCloseTo(out[1]!.y);
  });
});

describe('symmetry', () => {
  it('counts copies per kind', () => {
    const c = { x: 50, y: 50 };
    expect(symmetryMatrices({ kind: 'mirror', c, angle: Math.PI / 2, n: 6 })).toHaveLength(2);
    expect(symmetryMatrices({ kind: 'rotation', c, angle: 0, n: 6 })).toHaveLength(6);
    expect(symmetryMatrices({ kind: 'kaleidoscope', c, angle: 0, n: 6 })).toHaveLength(12);
  });

  it('a vertical mirror reflects x around the center', () => {
    const [, m] = symmetryMatrices({ kind: 'mirror', c: { x: 50, y: 50 }, angle: Math.PI / 2, n: 1 });
    const p = apply(m, 30, 10);
    expect(p.x).toBeCloseTo(70);
    expect(p.y).toBeCloseTo(10);
  });

  it('rotation copies keep the dab angle consistent', () => {
    const mats = symmetryMatrices({ kind: 'rotation', c: { x: 0, y: 0 }, angle: 0, n: 4 });
    const d = transformDab({ x: 10, y: 0, size: 5, angle: 0, roundness: 1, flow: 1, r: 0, g: 0, b: 0, dist: 0 }, mats[1]);
    expect(d.x).toBeCloseTo(0);
    expect(d.y).toBeCloseTo(10);
    expect(d.angle).toBeCloseTo(Math.PI / 2);
  });
});

describe('warps', () => {
  const quad = [{ x: 10, y: 20 }, { x: 210, y: 0 }, { x: 260, y: 180 }, { x: 0, y: 150 }];

  it('square-to-quad maps the unit corners to the quad corners', () => {
    const H = squareToQuad(quad);
    [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([u, v], i) => {
      const p = applyMat3(H, u, v);
      expect(p.x).toBeCloseTo(quad[i].x);
      expect(p.y).toBeCloseTo(quad[i].y);
    });
  });

  it('the inverse maps back', () => {
    const H = squareToQuad(quad);
    const p = applyMat3(H, 0.3, 0.7);
    const q = applyMat3(invertMat3(H), p.x, p.y);
    expect(q.x).toBeCloseTo(0.3);
    expect(q.y).toBeCloseTo(0.7);
  });

  it('detects folded quads', () => {
    expect(isConvexQuad(quad)).toBe(true);
    expect(isConvexQuad([quad[0], quad[2], quad[1], quad[3]])).toBe(false);
  });

  it('an untouched mesh is the identity on the rectangle', () => {
    const m = meshFrom(3, (u, v) => ({ x: 100 + u * 300, y: 50 + v * 200 }));
    const p = meshPoint(m, 0.37, 0.81);
    expect(p.x).toBeCloseTo(100 + 0.37 * 300);
    expect(p.y).toBeCloseTo(50 + 0.81 * 200);
    const d = denseMesh(m, 8);
    expect(d.verts.length).toBe(81 * 4);
    expect(d.indices.length).toBe(64 * 6);
  });
});

describe('shapes', () => {
  it('rectangles, stars and constrained lines', () => {
    const r = shapeOutline('rect', { x: 0, y: 0 }, { x: 100, y: 50 }, { sides: 5, fromCenter: false, constrain: false });
    expect(r.pts).toHaveLength(4);
    expect(r.closed).toBe(true);
    const sq = shapeOutline('rect', { x: 0, y: 0 }, { x: 100, y: 50 }, { sides: 5, fromCenter: false, constrain: true });
    expect(sq.pts[2]).toEqual({ x: 100, y: 100 });
    expect(shapeOutline('star', { x: 0, y: 0 }, { x: 100, y: 100 }, { sides: 5, fromCenter: false, constrain: false }).pts).toHaveLength(10);
    const line = shapeOutline('line', { x: 0, y: 0 }, { x: 100, y: 3 }, { sides: 5, fromCenter: false, constrain: true });
    expect(line.pts[1].y).toBeCloseTo(0);
    expect(line.closed).toBe(false);
  });
});

describe('gradient lookup table', () => {
  it('interpolates premultiplied from color to transparent', () => {
    const lut = gradientLut([{ t: 0, color: 'fg', a: 1 }, { t: 1, color: 'fg', a: 0 }], [1, 0, 0], false);
    expect(Array.from(lut.slice(0, 4))).toEqual([255, 0, 0, 255]);
    expect(Array.from(lut.slice(255 * 4))).toEqual([0, 0, 0, 0]);
    const mid = 128 * 4;
    expect(lut[mid]).toBe(lut[mid + 3]);
  });

  it('reverse flips it', () => {
    const lut = gradientLut([{ t: 0, color: '#000000', a: 1 }, { t: 1, color: '#ffffff', a: 1 }], [0, 0, 0], true);
    expect(lut[0]).toBe(255);
    expect(lut[255 * 4]).toBe(0);
  });
});

describe('brush tip masks', () => {
  it('inverts dark-on-light pictures and keeps light-on-dark ones', () => {
    const w = 8, h = 8;
    const dark = new Uint8Array(w * h).fill(255);
    dark[3 * w + 3] = 0;
    const m1 = maskFromGray(dark, w, h, 8);
    expect(m1.data[3 * 8 + 3]).toBe(255);
    expect(m1.data[0]).toBe(0);
    const light = new Uint8Array(w * h);
    light[3 * w + 3] = 255;
    expect(maskFromGray(light, w, h, 8).data[3 * 8 + 3]).toBe(255);
  });
});
