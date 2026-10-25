import { describe, expect, it } from 'vitest';
import { clipHalfPlane, gridPanels, pointInPolygon, polygonArea, rectPanel, splitPanel } from './frames';
import { PAGE_TEMPLATES } from './templates';
import { verticalLayout } from '../text/textRender';
import { snapCut } from '../tools/frameTool';

describe('frames', () => {
  const sq = rectPanel({ x: 0, y: 0, w: 100, h: 100 });

  it('clips a polygon by a half-plane', () => {
    const half = clipHalfPlane(sq, { x: 50, y: 0 }, { x: 1, y: 0 }, 0);
    expect(polygonArea(half)).toBeCloseTo(5000);
  });

  it('splits a panel with a gutter', () => {
    const [a, b] = splitPanel(sq, { x: 50, y: -10 }, { x: 50, y: 110 }, 10)!;
    expect(polygonArea(a) + polygonArea(b)).toBeCloseTo(9000);
    expect(Math.max(...a.map((p) => p.x)) <= 45 || Math.min(...a.map((p) => p.x)) >= 55).toBe(true);
  });

  it('a diagonal cut makes two convex parts', () => {
    const parts = splitPanel(sq, { x: 0, y: 30 }, { x: 100, y: 70 }, 6)!;
    expect(parts).not.toBeNull();
    expect(pointInPolygon({ x: 10, y: 90 }, parts[0]) || pointInPolygon({ x: 10, y: 90 }, parts[1])).toBe(true);
  });

  it('returns null when the line misses the panel', () => {
    expect(splitPanel(sq, { x: 200, y: 0 }, { x: 200, y: 100 }, 10)).toBeNull();
  });

  it('builds rows of panels', () => {
    const p = gridPanels({ x: 0, y: 0, w: 210, h: 320 }, [1, 2, 3], 10);
    expect(p).toHaveLength(6);
    expect(p[1][0].x).toBe(0);
    expect(p[2][0].x).toBe(110);
  });

  it('snaps nearly straight cuts', () => {
    const b = snapCut({ x: 0, y: 0 }, { x: 3, y: 100 }, false);
    expect(b.x).toBeCloseTo(0);
    expect(snapCut({ x: 0, y: 0 }, { x: 40, y: 100 }, false)).toEqual({ x: 40, y: 100 });
  });
});

describe('vertical text layout', () => {
  const base = { size: 10, letterSpacing: 0, lineHeight: 1.5, align: 'start' as const };

  it('runs columns right to left, characters top to bottom', () => {
    const { cells, w, h } = verticalLayout({ ...base, text: 'あい\nう' });
    expect(w).toBe(30);
    expect(h).toBe(20);
    const [a, i, u] = cells;
    expect(a.x).toBeCloseTo(-7.5);
    expect(i.y).toBeGreaterThan(a.y);
    expect(u.x).toBeLessThan(a.x);
  });

  it('rotates long vowel marks and brackets; nudges punctuation', () => {
    const { cells } = verticalLayout({ ...base, text: 'ー「。' });
    expect(cells[0].rotate).toBe(true);
    expect(cells[1].rotate).toBe(true);
    expect(cells[2].rotate).toBe(false);
    expect(cells[2].x).toBeGreaterThan(-7.5);
  });

  it('centers short columns', () => {
    const { cells } = verticalLayout({ ...base, align: 'center', text: 'ああああ\nい' });
    expect(cells[4].y).toBeCloseTo(20);
  });
});

describe('page templates', () => {
  it('fit within texture limits and keep the safe area inside the trim', () => {
    for (const t of PAGE_TEMPLATES) {
      expect(Math.max(t.w, t.h)).toBeLessThanOrEqual(8192);
      if (!t.page) continue;
      const { trim, safe } = t.page;
      expect(trim.x + trim.w).toBeLessThanOrEqual(t.w);
      expect(safe!.x).toBeGreaterThanOrEqual(trim.x);
      expect(safe!.y + safe!.h).toBeLessThanOrEqual(trim.y + trim.h);
    }
  });

  it('B5 manga page is 182x257 mm plus 3 mm bleed at 350 dpi', () => {
    const t = PAGE_TEMPLATES.find((x) => x.id === 'manga-b5')!;
    const px = (mm: number) => Math.round((mm / 25.4) * 350);
    expect(t.w).toBe(px(182) + 2 * px(3));
    expect(t.h).toBe(px(257) + 2 * px(3));
    expect(t.page!.trim).toEqual({ x: px(3), y: px(3), w: px(182), h: px(257) });
  });
});
