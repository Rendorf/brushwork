import { expect, test, type Page } from '@playwright/test';
import { newCanvas } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Make a 200x200 test layer: a red square on transparency, plus a gray gradient strip. */
async function scene(page: Page) {
  await newCanvas(page, 200, 200);
  await page.evaluate(() => {
    const ed = (window as any).__bw;
    const px = new Uint8Array(200 * 200 * 4);
    for (let y = 0; y < 200; y++)
      for (let x = 0; x < 200; x++) {
        const i = (y * 200 + x) * 4;
        if (x >= 50 && x < 150 && y >= 50 && y < 150) { px[i] = 230; px[i + 3] = 255; }
        else if (y >= 170 && y < 190) { const g = Math.round((x / 199) * 255); px[i] = px[i + 1] = px[i + 2] = g; px[i + 3] = 255; }
      }
    ed.doc.allLayers()[0].surface.upload(0, 0, 200, 200, px);
    ed.doc.allLayers()[0].touch();
    ed.invalidate();
  });
}

/** Run a filter with some values and apply it. */
async function applyFilter(page: Page, id: string, values: Record<string, unknown> = {}, amount = 1) {
  return page.evaluate(
    async ({ id, values, amount }) => {
      const { FILTER_MAP } = await import(String('/src/engine/filters/index.ts'));
      const { defaults } = await import(String('/src/engine/filters/types.ts'));
      const ed = (window as any).__bw;
      const def = FILTER_MAP.get(id);
      const s = ed.startFilter(def, { ...defaults(def), ...values });
      s.amount = amount;
      s.set(s.values, amount);
      s.apply();
      return { error: s.error, gl: ed.gl.getError() };
    },
    { id, values, amount },
  );
}

const px = (page: Page, x: number, y: number) => page.evaluate(([x, y]) => Array.from((window as any).__bw.doc.activeLayer().surface.read(x, y, 1, 1)) as number[], [x, y]);
const hash = (page: Page) =>
  page.evaluate(() => {
    const p: Uint8Array = (window as any).__bw.doc.activeLayer().surface.read();
    let h = 0;
    for (let i = 0; i < p.length; i++) h = (Math.imul(h, 31) + p[i]) | 0;
    return h;
  });

// Values that make every filter visibly change the test scene.
const VISIBLE: Record<string, Record<string, unknown>> = {
  'brightness-contrast': { b: 30, c: 20 },
  hsl: { h: 90, s: -50 },
  'color-balance': { cr: -60, mg: 40 },
  levels: { gamma: 2 },
  curves: { curves: { rgb: [[0, 0], [0.5, 0.8], [1, 1]], r: [[0, 0], [1, 1]], g: [[0, 0], [1, 1]], b: [[0, 0], [1, 1]] } },
  'replace-color': { from: '#e60000', to: '#0000ff' },
  temperature: { t: 60 },
  // The default radius only covers the uniformly red middle of the test square.
  bulge: { radius: 120 },
};

test('every filter runs, changes the layer, and undo restores it exactly', async ({ page }) => {
  await scene(page);
  const ids: string[] = await page.evaluate(async () => (await import(String('/src/engine/filters/index.ts'))).FILTERS.map((f: any) => f.id));
  expect(ids.length).toBeGreaterThanOrEqual(40);
  const before = await hash(page);
  const problems: string[] = [];
  for (const id of ids) {
    const r = await applyFilter(page, id, VISIBLE[id] ?? {});
    const after = await hash(page);
    if (r.error) problems.push(`${id}: ${r.error.split('\n')[0]}`);
    else if (r.gl) problems.push(`${id}: GL error ${r.gl}`);
    else if (after === before) problems.push(`${id}: no visible change`);
    await page.evaluate(() => (window as any).__bw.history.undo());
    if ((await hash(page)) !== before) problems.push(`${id}: undo did not restore`);
  }
  expect(problems).toEqual([]);
});

test('color filters compute the right colors', async ({ page }) => {
  await scene(page);
  await applyFilter(page, 'invert');
  expect(await px(page, 100, 100)).toEqual([25, 255, 255, 255]);
  await page.evaluate(() => (window as any).__bw.history.undo());
  await applyFilter(page, 'grayscale');
  const g = await px(page, 100, 100);
  expect(g[0]).toBe(g[1]);
  expect(g[1]).toBe(g[2]);
  await page.evaluate(() => (window as any).__bw.history.undo());
  await applyFilter(page, 'threshold', { t: 128 });
  for (const x of [20, 90, 120, 190]) expect([0, 255]).toContain((await px(page, x, 180))[0]);
  await page.evaluate(() => (window as any).__bw.history.undo());
  // Half-strength invert lands in the middle.
  await applyFilter(page, 'invert', {}, 0.5);
  const h = await px(page, 100, 100);
  expect(Math.abs(h[0] - 128)).toBeLessThanOrEqual(2);
  expect(Math.abs(h[1] - 128)).toBeLessThanOrEqual(2);
});

test('a selection limits filters, and alpha lock keeps transparency', async ({ page }) => {
  await scene(page);
  await page.evaluate(() => {
    const ed = (window as any).__bw;
    const m = new Uint8Array(200 * 200);
    for (let y = 0; y < 200; y++) for (let x = 0; x < 100; x++) m[y * 200 + x] = 255;
    ed.setSelection(m);
  });
  await applyFilter(page, 'invert');
  expect((await px(page, 60, 100))[1]).toBe(255);
  expect((await px(page, 140, 100))[1]).toBe(0);
  await page.evaluate(() => {
    const ed = (window as any).__bw;
    ed.history.undo();
    ed.deselect();
    ed.setProps(ed.doc.activeLayer(), { alphaLock: true });
  });
  await applyFilter(page, 'gaussian-blur', { radius: 20 });
  expect((await px(page, 30, 100))[3]).toBe(0);
});

test('blur, outline, drop shadow, mosaic and generators behave', async ({ page }) => {
  await scene(page);
  await applyFilter(page, 'gaussian-blur', { radius: 10 });
  const edge = await px(page, 50, 100);
  expect(edge[3]).toBeGreaterThan(60);
  expect(edge[3]).toBeLessThan(200);
  await page.evaluate(() => (window as any).__bw.history.undo());

  await applyFilter(page, 'outline', { color: '#00ff00', width: 6 });
  expect(await px(page, 46, 100)).toEqual([0, 255, 0, 255]);
  expect((await px(page, 40, 100))[3]).toBe(0);
  await page.evaluate(() => (window as any).__bw.history.undo());

  await applyFilter(page, 'drop-shadow', { dx: 20, dy: 0, radius: 0, opacity: 100, color: '#000000' });
  expect(await px(page, 160, 100)).toEqual([0, 0, 0, 255]);
  await page.evaluate(() => (window as any).__bw.history.undo());

  await applyFilter(page, 'mosaic', { cell: 20 });
  const a = await px(page, 162, 181), b = await px(page, 178, 186);
  expect(a).toEqual(b);
  await page.evaluate(() => (window as any).__bw.history.undo());

  await page.evaluate(() => (window as any).__bw.addLayer('Gen'));
  await applyFilter(page, 'clouds');
  const covered = await page.evaluate(() => {
    const p: Uint8Array = (window as any).__bw.doc.activeLayer().surface.read();
    let n = 0;
    for (let i = 3; i < p.length; i += 4) if (p[i] > 0) n++;
    return n;
  });
  expect(covered).toBeGreaterThan(10000);
});
