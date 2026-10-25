import { expect, test, type Page } from '@playwright/test';
import { newCanvas, penStroke } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Configure the brush tool for predictable test strokes. */
async function setup(page: Page, patch: Record<string, unknown> = {}) {
  await page.evaluate((patch) => {
    const S = (window as any).__bwSettings;
    const st = S.getState();
    S.setState({
      tool: 'brush',
      stabilizer: 0,
      color: { h: 0, s: 0, v: 0 },
      brushTools: { ...st.brushTools, brush: { ...st.brushTools.brush, presetId: 'digital-pen', size: 6, opacity: 1, overrides: {} } },
      ...patch,
    });
  }, patch);
}

/** Bounding box of painted pixels on the active layer. */
const paintedBounds = (page: Page) =>
  page.evaluate(() => {
    const ed = (window as any).__bw;
    const l = ed.doc.activeLayer();
    const W = l.surface.w, H = l.surface.h;
    const px: Uint8Array = l.surface.read();
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (px[(y * W + x) * 4 + 3] > 20) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    return { x0, y0, x1, y1 };
  });

const alphaAt = (page: Page, x: number, y: number) => page.evaluate(([x, y]) => (window as any).__bw.doc.activeLayer().surface.read(x, y, 1, 1)[3], [x, y]);

const wobble = (x0: number, y0: number, x1: number, n = 40, amp = 12): [number, number, number][] =>
  Array.from({ length: n }, (_, i) => [x0 + ((x1 - x0) * i) / (n - 1), y0 + Math.sin(i * 1.3) * amp, 1]);

test('a straight ruler turns a wobbly stroke into a straight line', async ({ page }) => {
  await newCanvas(page, 400, 400);
  await setup(page);
  await page.evaluate(() => (window as any).__bw.setGuides({ ruler: { kind: 'line', a: { x: 0, y: 200 }, b: { x: 400, y: 200 } }, rulerOn: true }));
  await penStroke(page, wobble(50, 260, 350));
  const b = await paintedBounds(page);
  expect(b.x0).toBeLessThan(60);
  expect(b.x1).toBeGreaterThan(340);
  // A 6px line: everything stays within a few pixels of y = 260 despite ±12px wobble.
  expect(b.y1 - b.y0).toBeLessThanOrEqual(8);
});

test('mirror symmetry paints the reflected stroke too', async ({ page }) => {
  await newCanvas(page, 400, 400);
  await setup(page);
  await page.evaluate(() => (window as any).__bw.setGuides({ symmetry: { kind: 'mirror', c: { x: 200, y: 200 }, angle: Math.PI / 2, n: 2 }, symmetryOn: true }));
  await penStroke(page, Array.from({ length: 20 }, (_, i) => [50 + i * 4, 100, 1] as [number, number, number]));
  expect(await alphaAt(page, 80, 100)).toBeGreaterThan(200);
  expect(await alphaAt(page, 320, 100)).toBeGreaterThan(200);
  expect(await alphaAt(page, 200, 100)).toBe(0);
});

test('shape tool draws outlines and fills', async ({ page }) => {
  await newCanvas(page, 400, 400);
  await setup(page, { tool: 'shape', shape: { kind: 'rect', sides: 5, mode: 'stroke', fromCenter: false } });
  await penStroke(page, [[100, 100, 1], [200, 150, 1], [300, 250, 1]]);
  expect(await alphaAt(page, 100, 175)).toBeGreaterThan(200);
  expect(await alphaAt(page, 200, 175)).toBe(0);
  await page.evaluate(() => (window as any).__bwSettings.setState({ shape: { kind: 'ellipse', sides: 5, mode: 'fill', fromCenter: false } }));
  await penStroke(page, [[20, 300, 1], [60, 340, 1], [100, 380, 1]]);
  expect(await alphaAt(page, 60, 340)).toBe(255);
  // One undo step per shape
  await page.evaluate(() => (window as any).__bw.history.undo());
  expect(await alphaAt(page, 60, 340)).toBe(0);
  expect(await alphaAt(page, 100, 175)).toBeGreaterThan(200);
});

test('gradient tool fills from color to transparent', async ({ page }) => {
  await newCanvas(page, 300, 300);
  await setup(page, { tool: 'gradient', color: { h: 0.6, s: 1, v: 1 } });
  await penStroke(page, [[150, 0, 1], [150, 150, 1], [150, 300, 1]]);
  const top = await alphaAt(page, 150, 15);
  const bottom = await alphaAt(page, 150, 285);
  expect(top).toBeGreaterThan(220);
  expect(bottom).toBeLessThan(35);
  expect(await alphaAt(page, 20, 150)).toBeGreaterThan(100);
});

test('distort and mesh transforms commit, and undo restores exactly', async ({ page }) => {
  await newCanvas(page, 300, 300);
  const r = await page.evaluate(() => {
    const ed = (window as any).__bw;
    const hash = () => {
      const px: Uint8Array = ed.readComposite();
      let h = 0;
      for (let i = 0; i < px.length; i++) h = (Math.imul(h, 31) + px[i]) | 0;
      return h;
    };
    const m = new Uint8Array(300 * 300);
    for (let y = 100; y < 200; y++) for (let x = 100; x < 200; x++) m[y * 300 + x] = 255;
    ed.setSelection(m);
    ed.fillLayer([0.2, 0.4, 0.9]);
    ed.deselect();
    const before = hash();
    ed.setTool('transform');
    const tt = ed.tools.transform;
    tt.setMode('distort');
    tt.s.quad[1] = { x: tt.s.quad[1].x + 60, y: tt.s.quad[1].y - 30 };
    tt.update();
    tt.finish(true);
    const afterDistort = hash();
    const farCorner = Array.from(ed.doc.activeLayer().surface.read(250, 80, 1, 1));
    ed.setTool('transform');
    tt.setMode('mesh', 2);
    tt.s.mesh.pts[4] = { x: tt.s.mesh.pts[4].x + 40, y: tt.s.mesh.pts[4].y };
    tt.update();
    tt.finish(true);
    const afterMesh = hash();
    ed.history.undo();
    const undoMesh = hash();
    ed.history.undo();
    const undoDistort = hash();
    return { before, afterDistort, afterMesh, undoMesh, undoDistort, farCorner, err: ed.gl.getError() };
  });
  expect(r.afterDistort).not.toBe(r.before);
  expect(r.afterMesh).not.toBe(r.afterDistort);
  expect(r.undoMesh).toBe(r.afterDistort);
  expect(r.undoDistort).toBe(r.before);
  expect(r.farCorner[3]).toBeGreaterThan(0);
  expect(r.err).toBe(0);
});

test('custom brushes: from an image, export/import, and Photoshop .abr import', async ({ page }) => {
  await newCanvas(page, 300, 300);
  await setup(page);
  const r = await page.evaluate(async () => {
    const io = await import(String('/src/engine/brush/brushIO.ts'));
    const { toolBrush } = await import(String('/src/engine/tools/brushTool.ts'));
    const S = (window as any).__bwSettings;
    // A black triangle on white
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const x = c.getContext('2d')!;
    x.fillStyle = '#fff'; x.fillRect(0, 0, 64, 64);
    x.fillStyle = '#000'; x.beginPath(); x.moveTo(32, 4); x.lineTo(60, 60); x.lineTo(4, 60); x.fill();
    const b = await io.brushFromImage(x.getImageData(0, 0, 64, 64), 'Triangle', toolBrush('brush'));
    const st = S.getState();
    S.setState({ brushTools: { ...st.brushTools, brush: { ...st.brushTools.brush, presetId: b.id, size: 40 } } });
    const exported = io.exportBrushes([b]);
    const imported = await io.importBrushFile(new File([exported], 'tri.bwbrush'));
    // Hand-built ABR v1: one computed and one sampled brush (big-endian).
    const w = 16, h = 16;
    const sampleSize = 4 + 2 + 9 + 16 + 2 + 1 + w * h;
    const buf = new ArrayBuffer(4 + (6 + 14) + (6 + sampleSize));
    const dv = new DataView(buf);
    let o = 0;
    const u16 = (v: number) => { dv.setUint16(o, v); o += 2; };
    const i16 = (v: number) => { dv.setInt16(o, v); o += 2; };
    const u32 = (v: number) => { dv.setUint32(o, v); o += 4; };
    const i32 = (v: number) => { dv.setInt32(o, v); o += 4; };
    u16(1); u16(2);
    u16(1); u32(14); u32(0); u16(25); u16(40); u16(60); i16(30); u16(80);
    u16(2); u32(sampleSize); u32(0); u16(30); o += 9;
    i32(0); i32(0); i32(h); i32(w); i16(8); dv.setUint8(o++, 0);
    for (let y = 0; y < h; y++) for (let x2 = 0; x2 < w; x2++) dv.setUint8(o++, Math.hypot(x2 - 7.5, y - 7.5) < 6 ? 255 : 0);
    const abr = await io.importBrushFile(new File([buf], 'test.abr'));
    return {
      created: { name: b.name, custom: b.tip.startsWith('custom:') },
      imported: imported.map((x: any) => ({ name: x.name, custom: x.tip.startsWith('custom:') })),
      abr: abr.map((x: any) => ({ tip: x.tip.startsWith('custom:') ? 'custom' : x.tip, size: x.size, spacing: x.spacing, hardness: x.hardness, roundness: x.roundness, angle: x.angle })),
      total: S.getState().customBrushes.length,
    };
  });
  expect(r.created).toEqual({ name: 'Triangle', custom: true });
  expect(r.imported).toEqual([{ name: 'Triangle', custom: true }]);
  expect(r.abr[0]).toEqual({ tip: 'round', size: 40, spacing: 0.25, hardness: 0.8, roundness: 0.6, angle: 30 });
  expect(r.abr[1].tip).toBe('custom');
  expect(r.total).toBe(4);
  // Paint with the image brush.
  await penStroke(page, Array.from({ length: 10 }, (_, i) => [60 + i * 20, 150, 1] as [number, number, number]));
  const b = await paintedBounds(page);
  expect(b.x1 - b.x0).toBeGreaterThan(150);
});

test('guides are saved with the artwork', async ({ page }) => {
  await newCanvas(page, 200, 200);
  await page.evaluate(() =>
    (window as any).__bw.setGuides({
      ruler: { kind: 'perspective', vps: [{ x: -100, y: 50 }, { x: 300, y: 50 }] },
      symmetry: { kind: 'kaleidoscope', c: { x: 100, y: 100 }, angle: 0, n: 5 },
      gridOn: true,
      gridSize: 25,
    }),
  );
  await page.getByRole('button', { name: 'Back to gallery' }).click();
  await page.getByRole('button', { name: /^Open / }).click();
  await page.waitForFunction(() => !!(window as any).__bw?.doc);
  const g = await page.evaluate(() => (window as any).__bw.doc.guides);
  expect(g.ruler.kind).toBe('perspective');
  expect(g.ruler.vps).toHaveLength(2);
  expect(g.symmetry).toMatchObject({ kind: 'kaleidoscope', n: 5 });
  expect(g.gridOn).toBe(true);
  expect(g.gridSize).toBe(25);
});
