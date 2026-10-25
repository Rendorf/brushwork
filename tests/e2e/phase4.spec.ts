import { expect, test, type Page } from '@playwright/test';
import { newCanvas, penStroke } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Pointer drag through the stage (document coordinates). */
async function drag(page: Page, a: [number, number], b: [number, number], type = 'mouse') {
  await page.evaluate(
    ({ a, b, type }) => {
      const ed = (window as any).__bw;
      const el = document.querySelector('.stage')!;
      const r = el.getBoundingClientRect();
      const ev = (t: string, x: number, y: number) => {
        const s = ed.viewport.toScreen(x, y);
        el.dispatchEvent(new PointerEvent(t, { pointerId: 31, pointerType: type, clientX: r.left + s.x, clientY: r.top + s.y, buttons: t === 'pointerup' ? 0 : 1, button: 0, bubbles: true, isPrimary: true }));
      };
      ev('pointerdown', a[0], a[1]);
      for (let i = 1; i <= 10; i++) ev('pointermove', a[0] + ((b[0] - a[0]) * i) / 10, a[1] + ((b[1] - a[1]) * i) / 10);
      ev('pointerup', b[0], b[1]);
    },
    { a, b, type },
  );
}

const tool = (page: Page, t: string, extra: Record<string, unknown> = {}) => page.evaluate(([t, extra]) => (window as any).__bwSettings.setState({ tool: t, ...(extra as object) }), [t, extra] as const);
const layerAlpha = (page: Page, x: number, y: number) => page.evaluate(([x, y]) => (window as any).__bw.doc.activeLayer().surface.read(x, y, 1, 1)[3], [x, y]);
const waitText = (page: Page) => page.waitForTimeout(400);

test('text tool: add, edit with one undo step, vertical layout, rasterize to paint', async ({ page }) => {
  await newCanvas(page, 600, 400);
  await tool(page, 'text', { textDefaults: { font: 'system-sans', size: 60, vertical: false, bold: true, strokeWidth: 0 } });
  await drag(page, [300, 200], [300, 200]);
  await waitText(page);
  const r = await page.evaluate(() => {
    const ed = (window as any).__bw;
    const l = ed.doc.activeLayer();
    return { isText: !!l.text, text: l.text?.text, panel: !!document.querySelector('.text-panel') };
  });
  expect(r).toEqual({ isText: true, text: 'Text', panel: true });
  expect(await layerAlpha(page, 300, 200)).toBeGreaterThan(0);

  // Typing several times is one undo step.
  await page.locator('.text-input').fill('Hello');
  await page.locator('.text-input').fill('Hello world');
  await waitText(page);
  await page.evaluate(() => (window as any).__bw.endTextEdit());
  const afterEdit = await page.evaluate(() => (window as any).__bw.doc.activeLayer().text.text);
  expect(afterEdit).toBe('Hello world');
  await page.evaluate(() => (window as any).__bw.history.undo());
  await waitText(page);
  expect(await page.evaluate(() => (window as any).__bw.doc.activeLayer().text.text)).toBe('Text');
  await page.evaluate(() => (window as any).__bw.history.redo());
  await waitText(page);

  // Vertical text is taller than wide.
  const dims = await page.evaluate(async () => {
    const { measureText } = await import(String('/src/engine/text/textRender.ts'));
    const ed = (window as any).__bw;
    const l = ed.doc.activeLayer();
    ed.updateText(l, { ...l.text, vertical: true, text: 'たてがき' });
    ed.endTextEdit();
    return measureText(l.text);
  });
  expect(dims.h).toBeGreaterThan(dims.w * 2);

  // Painting is blocked until the text is rasterized.
  await tool(page, 'brush', { stabilizer: 0 });
  const before = await page.evaluate(() => (window as any).__bw.history.undoLabel);
  await penStroke(page, [[50, 350, 1], [150, 350, 1]]);
  expect(await page.evaluate(() => (window as any).__bw.history.undoLabel)).toBe(before);
  await page.evaluate(() => (window as any).__bw.rasterize((window as any).__bw.doc.activeLayer()));
  await penStroke(page, [[50, 350, 1], [100, 350, 1], [150, 350, 1]]);
  expect(await page.evaluate(() => (window as any).__bw.history.undoLabel)).toBe('Brush');
});

test('fonts: bundled fonts render and a font file can be imported', async ({ page }) => {
  await newCanvas(page, 200, 200);
  const r = await page.evaluate(async () => {
    const { importFont, allFonts } = await import(String('/src/engine/text/fonts.ts'));
    const res = await fetch('/node_modules/@fontsource/pacifico/files/pacifico-latin-400-normal.woff2');
    const file = new File([await res.blob()], 'MyScript.woff2', { type: 'font/woff2' });
    const entry = await importFont(file);
    const ok = await document.fonts.load(`32px ${entry.css}`, 'Abc');
    const bangers = await document.fonts.load('32px "Bangers"', 'Abc');
    return { label: entry.label, listed: allFonts().some((f: any) => f.id === entry.id), loaded: ok.length > 0, bangers: bangers.length > 0 };
  });
  expect(r).toEqual({ label: 'MyScript', listed: true, loaded: true, bangers: true });
});

test('speech balloon: white fill, black outline, optional text inside', async ({ page }) => {
  await newCanvas(page, 600, 600);
  await tool(page, 'balloon', { balloon: { kind: 'oval', stroke: 6, fill: '#ffffff', line: '#000000', addText: true } });
  await drag(page, [150, 100], [450, 300]);
  await page.evaluate(() => (window as any).__bw.tools.balloon.commit());
  await waitText(page);
  const r = await page.evaluate(() => {
    const ed = (window as any).__bw;
    const layers = ed.doc.allLayers();
    const base = layers[0];
    return {
      center: Array.from(base.surface.read(300, 150, 1, 1)),
      edge: Array.from(base.surface.read(150 - 3, 200, 1, 1)),
      texts: layers.filter((l: any) => l.text).length,
    };
  });
  expect(r.center).toEqual([255, 255, 255, 255]);
  expect(r.edge.slice(0, 3)).toEqual([0, 0, 0]);
  expect(r.edge[3]).toBeGreaterThan(200);
  expect(r.texts).toBe(1);
});

test('frame divider: create, cut, undo, select a panel', async ({ page }) => {
  await newCanvas(page, 600, 800);
  await tool(page, 'frame', { frame: { border: 4, gutter: 20, margin: 50, mode: 'cut' } });
  await page.evaluate(() => (window as any).__bw.tools.frame.createFrames());
  await drag(page, [40, 400], [560, 402]);
  const r = await page.evaluate(() => {
    const ed = (window as any).__bw;
    const l = ed.tools.frame.frameLayer();
    return { panels: l.frames.panels.length, gutterPx: Array.from(l.surface.read(300, 400, 1, 1)), insidePx: l.surface.read(300, 200, 1, 1)[3] };
  });
  expect(r.panels).toBe(2);
  expect(r.gutterPx).toEqual([255, 255, 255, 255]);
  expect(r.insidePx).toBe(0);
  await page.evaluate(() => (window as any).__bw.history.undo());
  expect(await page.evaluate(() => (window as any).__bw.tools.frame.frameLayer().frames.panels.length)).toBe(1);
  await page.evaluate(() => (window as any).__bw.history.redo());
  await page.evaluate(() => (window as any).__bwSettings.setState({ frame: { border: 4, gutter: 20, margin: 50, mode: 'select' } }));
  await drag(page, [300, 600], [300, 600]);
  const sel = await page.evaluate(() => (window as any).__bw.doc.selection?.bounds);
  expect(sel.y).toBeGreaterThanOrEqual(405);
  expect(sel.y + sel.h).toBeLessThanOrEqual(752);
});

test('screentone layer shows gray paint as a dot screen', async ({ page }) => {
  await newCanvas(page, 400, 400);
  const r = await page.evaluate(() => {
    const ed = (window as any).__bw;
    ed.doc.dpi = 300;
    const l = ed.doc.activeLayer();
    ed.setProps(l, { tone: { lpi: 25, angle: 45, shape: 'dot' } });
    ed.fillLayer([0.5, 0.5, 0.5]);
    const px: Uint8Array = ed.readComposite();
    let black = 0, clear = 0, sum = 0;
    for (let i = 3; i < px.length; i += 4) {
      if (px[i] > 230) black++;
      else if (px[i] < 25) clear++;
      sum += px[i];
    }
    const n = px.length / 4;
    return { black: black / n, clear: clear / n, mean: sum / n / 255, rawGray: Array.from(l.surface.read(10, 10, 1, 1)) };
  });
  expect(r.black).toBeGreaterThan(0.2);
  expect(r.clear).toBeGreaterThan(0.2);
  expect(Math.abs(r.mean - 0.5)).toBeLessThan(0.12);
  // The layer itself keeps the gray paint (non-destructive).
  expect(r.rawGray).toEqual([128, 128, 128, 255]);
});

test('materials tile seamlessly; page templates set guides and panels', async ({ page }) => {
  await newCanvas(page, 512, 512);
  const r = await page.evaluate(async () => {
    const { MATERIALS, materialTile } = await import(String('/src/engine/comics/materials.ts'));
    const ed = (window as any).__bw;
    const m = MATERIALS.find((x: any) => x.id === 'honeycomb');
    const tile = materialTile(m, '#000000', 1);
    const l = ed.addLayer('Pattern');
    ed.fillPattern(l, tile, 'Material');
    const px: Uint8Array = l.surface.read();
    let diff = 0, cover = 0;
    for (let y = 0; y < 300; y++)
      for (let x = 0; x < 300; x++) {
        const a = px[(y * 512 + x) * 4 + 3], b = px[(y * 512 + x + tile.width) * 4 + 3], c = px[((y + tile.height) * 512 + x) * 4 + 3];
        diff = Math.max(diff, Math.abs(a - b), Math.abs(a - c));
        if (a > 0) cover++;
      }
    return { count: MATERIALS.length, diff, cover };
  });
  expect(r.count).toBeGreaterThanOrEqual(16);
  expect(r.cover).toBeGreaterThan(1000);
  expect(r.diff).toBeLessThanOrEqual(2);

  await page.goto('/');
  await page.getByRole('button', { name: 'New canvas' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: /4-koma/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click();
  await page.waitForFunction(() => !!(window as any).__bw?.doc);
  const t = await page.evaluate(() => {
    const ed = (window as any).__bw;
    return { page: !!ed.doc.guides.page, panels: ed.doc.allLayers().find((l: any) => l.frames)?.frames.panels.length, undo: ed.history.canUndo, active: ed.doc.active.name };
  });
  expect(t).toEqual({ page: true, panels: 8, undo: false, active: 'Layer 1' });
});

test('text, frames and tone survive saving and reopening', async ({ page }) => {
  await newCanvas(page, 400, 400);
  await page.evaluate(async () => {
    const { defaultText } = await import(String('/src/engine/text/textRender.ts'));
    const ed = (window as any).__bw;
    ed.setProps(ed.doc.activeLayer(), { tone: { lpi: 40, angle: 30, shape: 'line' } });
    ed.addTextLayer(defaultText(20, 20, { text: 'Saved', font: 'inter', size: 40 }));
    ed.tools.frame.createFrames();
  });
  await waitText(page);
  await page.getByRole('button', { name: 'Back to gallery' }).click();
  await page.getByRole('button', { name: /^Open / }).click();
  await page.waitForFunction(() => !!(window as any).__bw?.doc);
  const r = await page.evaluate(() => {
    const ls = (window as any).__bw.doc.allLayers();
    return { tone: ls[0].tone, text: ls.find((l: any) => l.text)?.text.text, frames: ls.find((l: any) => l.frames)?.frames.panels.length };
  });
  expect(r).toEqual({ tone: { lpi: 40, angle: 30, shape: 'line' }, text: 'Saved', frames: 1 });
});
