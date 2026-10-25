import type { Page } from '@playwright/test';

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function newCanvas(page: Page, w = 256, h = 256) {
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
export async function penStroke(page: Page, pts: [number, number, number][]) {
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

