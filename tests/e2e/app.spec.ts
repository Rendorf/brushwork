import { expect, test, type Page } from '@playwright/test';

/* eslint-disable @typescript-eslint/no-explicit-any */

async function newCanvas(page: Page, w = 256, h = 256) {
  await page.goto('/');
  await page.getByRole('button', { name: 'New canvas' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New canvas' });
  await dialog.getByLabel('Width').fill(String(w));
  await dialog.getByLabel('Width').press('Enter');
  await dialog.getByLabel('Height').fill(String(h));
  await dialog.getByLabel('Height').press('Enter');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await page.waitForFunction(() => !!(window as any).__bw?.doc);
}

/** Dispatch a pen stroke through the real input pipeline. Points are in document pixels. */
async function penStroke(page: Page, pts: [number, number, number][]) {
  await page.evaluate((pts) => {
    const ed = (window as any).__bw;
    const el = document.querySelector('.stage')!;
    const r = el.getBoundingClientRect();
    const mk = (t: string, [x, y, p]: number[]) => {
      const s = ed.viewport.toScreen(x, y);
      return new PointerEvent(t, { pointerId: 7, pointerType: 'pen', clientX: r.left + s.x, clientY: r.top + s.y, pressure: p, buttons: t === 'pointerup' ? 0 : 1, bubbles: true, isPrimary: true });
    };
    el.dispatchEvent(mk('pointerdown', pts[0]));
    for (const p of pts.slice(1)) el.dispatchEvent(mk('pointermove', p));
    el.dispatchEvent(mk('pointerup', pts[pts.length - 1]));
  }, pts);
}

const compositeHash = (page: Page) =>
  page.evaluate(() => {
    const px: Uint8Array = (window as any).__bw.readComposite();
    let h = 0;
    for (let i = 0; i < px.length; i++) h = (Math.imul(h, 31) + px[i]) | 0;
    return h;
  });

test('every blend mode on the GPU matches the CPU reference', async ({ page }) => {
  await newCanvas(page, 64, 64);
  const worst = await page.evaluate(async () => {
    const { blendPremul, BLEND_MODES } = await import(String('/src/engine/blendModes.ts'));
    const { rng } = await import(String('/src/engine/util/geom.ts'));
    const ed = (window as any).__bw;
    const W = ed.doc.width, H = ed.doc.height;
    const rand = rng(42);
    const make = () => {
      const px = new Uint8Array(W * H * 4);
      for (let i = 0; i < px.length; i += 4) {
        const a = rand() < 0.2 ? 255 : Math.floor(rand() * 256);
        px[i] = Math.floor(rand() * (a + 1));
        px[i + 1] = Math.floor(rand() * (a + 1));
        px[i + 2] = Math.floor(rand() * (a + 1));
        px[i + 3] = a;
      }
      return px;
    };
    const base = ed.doc.allLayers()[0];
    const bpx = make();
    base.surface.upload(0, 0, W, H, bpx);
    const top = ed.addLayer('top');
    const tpx = make();
    top.surface.upload(0, 0, W, H, tpx);
    const result: Record<string, number> = {};
    BLEND_MODES.forEach((m: any, idx: number) => {
      ed.setProps(top, { blendMode: m.id, opacity: 0.8 }, { record: false });
      ed.compositor.invalidate();
      const out: Uint8Array = ed.readComposite();
      let worstDiff = 0;
      for (let i = 0; i < out.length; i += 4) {
        const b = [bpx[i] / 255, bpx[i + 1] / 255, bpx[i + 2] / 255, bpx[i + 3] / 255] as any;
        const s = [tpx[i] / 255 * 0.8, tpx[i + 1] / 255 * 0.8, tpx[i + 2] / 255 * 0.8, tpx[i + 3] / 255 * 0.8] as any;
        // Hard Mix is a threshold on cb + cs; float rounding may flip pixels right at it.
        if (m.id === 'hardMix' && b[3] > 0 && s[3] > 0) {
          const nearEdge = [0, 1, 2].some((c) => Math.abs(b[c] / b[3] + s[c] / s[3] - 1) < 0.02);
          if (nearEdge) continue;
        }
        const e = blendPremul(b, s, idx);
        for (let c = 0; c < 4; c++) worstDiff = Math.max(worstDiff, Math.abs(out[i + c] - e[c] * 255));
      }
      result[m.id] = worstDiff;
    });
    return result;
  });
  const failing = Object.entries(worst).filter(([, d]) => d > 3);
  expect(failing, 'blend modes off by more than 3/255').toEqual([]);
});

test('pen stroke paints, and undo/redo restore exactly', async ({ page }) => {
  await newCanvas(page, 512, 512);
  const blank = await compositeHash(page);
  await penStroke(page, Array.from({ length: 40 }, (_, i) => [60 + i * 10, 256 + Math.sin(i / 5) * 40, 0.3 + (i / 40) * 0.7] as [number, number, number]));
  const painted = await page.evaluate(() => {
    const ed = (window as any).__bw;
    const px: Uint8Array = ed.doc.allLayers()[0].surface.read();
    let n = 0;
    for (let i = 3; i < px.length; i += 4) if (px[i] > 0) n++;
    return n;
  });
  expect(painted).toBeGreaterThan(1000);
  const drawn = await compositeHash(page);
  expect(drawn).not.toBe(blank);
  await page.evaluate(() => (window as any).__bw.history.undo());
  expect(await compositeHash(page)).toBe(blank);
  await page.evaluate(() => (window as any).__bw.history.redo());
  expect(await compositeHash(page)).toBe(drawn);
});

test('layer operations: clipping, merge down, flatten and their undo', async ({ page }) => {
  await newCanvas(page, 128, 128);
  const r = await page.evaluate(() => {
    const ed = (window as any).__bw;
    const base = ed.doc.allLayers()[0];
    ed.doc.active = base;
    ed.fillLayer([1, 0, 0]);
    const clip = ed.addLayer('clip');
    ed.setProps(clip, { clipping: true });
    ed.fillLayer([0, 0, 1]);
    const h1 = Array.from(ed.readComposite().slice(0, 4));
    ed.mergeDown(clip);
    const afterMerge = { layers: ed.doc.allLayers().length, px: Array.from(ed.readComposite().slice(0, 4)) };
    ed.history.undo();
    const afterUndo = ed.doc.allLayers().length;
    ed.flatten();
    const flat = ed.doc.allLayers().length;
    ed.history.undo();
    return { h1, afterMerge, afterUndo, flat, restored: ed.doc.allLayers().length };
  });
  expect(r.h1).toEqual([0, 0, 255, 255]);
  expect(r.afterMerge).toEqual({ layers: 1, px: [0, 0, 255, 255] });
  expect(r.afterUndo).toBe(2);
  expect(r.flat).toBe(1);
  expect(r.restored).toBe(2);
});

test('artwork is saved on the device and reopens after a reload', async ({ page }) => {
  await newCanvas(page, 300, 200);
  await penStroke(page, Array.from({ length: 20 }, (_, i) => [20 + i * 12, 100, 1] as [number, number, number]));
  const before = await compositeHash(page);
  await page.getByRole('button', { name: 'Back to gallery' }).click();
  await expect(page.getByRole('button', { name: /^Open / })).toHaveCount(1);
  await page.reload();
  await page.getByRole('button', { name: /^Open / }).click();
  await page.waitForFunction(() => !!(window as any).__bw?.doc);
  expect(await compositeHash(page)).toBe(before);
});

test('PSD and project files round-trip layers', async ({ page }) => {
  await newCanvas(page, 200, 150);
  await penStroke(page, Array.from({ length: 20 }, (_, i) => [20 + i * 8, 70, 1] as [number, number, number]));
  const r = await page.evaluate(async () => {
    const ed = (window as any).__bw;
    const top = ed.addLayer('Top');
    ed.setProps(top, { blendMode: 'multiply', opacity: 0.5 });
    ed.fillLayer([0.2, 0.8, 0.3]);
    const { exportPsd, importPsd } = await import(String('/src/engine/io/files.ts'));
    const { writeProject, readProject } = await import(String('/src/engine/io/serialize.ts'));
    const psd = await importPsd(ed.gl, await (await exportPsd(ed)).arrayBuffer());
    const proj = await readProject(ed.gl, await (await writeProject(ed.doc)).arrayBuffer());
    const sum = (d: any) => d.allLayers().map((l: any) => [l.name, l.blendMode, Math.round(l.opacity * 100)]);
    const px = (d: any, i: number) => Array.from(d.allLayers()[i].surface.read(60, 70, 1, 1));
    const out = {
      orig: sum(ed.doc), psd: sum(psd), proj: sum(proj),
      origPx: px(ed.doc, 0), psdPx: px(psd, 1), projPx: px(proj, 0),
    };
    psd.dispose();
    proj.dispose();
    return out;
  });
  expect(r.proj).toEqual(r.orig);
  // The PSD gets an extra opaque "Background" layer for the paper color.
  expect(r.psd.slice(1)).toEqual(r.orig);
  expect(r.projPx).toEqual(r.origPx);
  (r.psdPx as number[]).forEach((v, i) => expect(Math.abs(v - (r.origPx as number[])[i])).toBeLessThanOrEqual(2));
});

test('a selection limits filling', async ({ page }) => {
  await newCanvas(page, 200, 200);
  const r = await page.evaluate(() => {
    const ed = (window as any).__bw;
    const m = new Uint8Array(200 * 200);
    for (let y = 0; y < 100; y++) for (let x = 0; x < 200; x++) m[y * 200 + x] = 255;
    ed.setSelection(m);
    ed.fillLayer([0, 0, 0]);
    const l = ed.doc.allLayers()[0];
    return { inside: l.surface.read(50, 50, 1, 1)[3], outside: l.surface.read(50, 150, 1, 1)[3] };
  });
  expect(r.inside).toBe(255);
  expect(r.outside).toBe(0);
});

test('touch gestures: two-finger tap undoes, pinch zooms, fingers do not draw after a pen', async ({ page }) => {
  await newCanvas(page, 400, 400);
  await penStroke(page, Array.from({ length: 20 }, (_, i) => [50 + i * 10, 200, 1] as [number, number, number]));
  const r = await page.evaluate(async () => {
    const ed = (window as any).__bw;
    const el = document.querySelector('.stage')!;
    const rect = el.getBoundingClientRect();
    const ev = (t: string, id: number, x: number, y: number) =>
      el.dispatchEvent(new PointerEvent(t, { pointerId: id, pointerType: 'touch', clientX: rect.left + x, clientY: rect.top + y, pressure: 0.5, buttons: t === 'pointerup' ? 0 : 1, bubbles: true, isPrimary: id === 1 }));
    const undoBefore = ed.history.canUndo;
    // Two-finger tap
    ev('pointerdown', 1, 100, 100);
    ev('pointerdown', 2, 160, 100);
    ev('pointerup', 1, 100, 100);
    ev('pointerup', 2, 160, 100);
    const undoneByTap = !ed.history.canUndo && ed.history.canRedo;
    // Pinch apart doubles the zoom
    const z0 = ed.viewport.zoom;
    ev('pointerdown', 3, 100, 150);
    ev('pointerdown', 4, 200, 150);
    for (let i = 1; i <= 10; i++) {
      ev('pointermove', 3, 100 - i * 5, 150);
      ev('pointermove', 4, 200 + i * 5, 150);
    }
    ev('pointerup', 3, 50, 150);
    ev('pointerup', 4, 250, 150);
    const zoomRatio = ed.viewport.zoom / z0;
    // A pen was used, so one finger now pans instead of drawing.
    const cx0 = ed.viewport.cx;
    ev('pointerdown', 5, 100, 100);
    ev('pointermove', 5, 140, 120);
    ev('pointerup', 5, 140, 120);
    return { undoBefore, undoneByTap, zoomRatio, panned: ed.viewport.cx - cx0, history: ed.history.canUndo };
  });
  expect(r.undoBefore).toBe(true);
  expect(r.undoneByTap).toBe(true);
  expect(r.zoomRatio).toBeCloseTo(2, 1);
  expect(r.panned).toBeCloseTo(40, 0);
  expect(r.history).toBe(false);
});
