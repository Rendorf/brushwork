import { expect, test, type Page } from '@playwright/test';
import { newCanvas, penStroke } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Six frames with a filled circle moving right, on a 480x270 canvas. */
async function makeAnimation(page: Page) {
  await newCanvas(page, 480, 270);
  await page.evaluate(() => {
    const ed = (window as any).__bw;
    ed.setAnimationMode(true);
    for (let i = 0; i < 6; i++) {
      if (i > 0) ed.addFrame();
      const cx = 60 + i * 70, cy = 135;
      const m = new Uint8Array(480 * 270);
      for (let y = cy - 30; y < cy + 30; y++) for (let x = cx - 30; x < cx + 30; x++) if ((x - cx) ** 2 + (y - cy) ** 2 < 900) m[y * 480 + x] = 255;
      ed.setSelection(m);
      ed.fillLayer([0, 0, 0]);
      ed.deselect();
    }
  });
}

const composite = (page: Page, x: number, y: number) =>
  page.evaluate(([x, y]) => {
    const ed = (window as any).__bw;
    ed.compositor.update();
    return Array.from(ed.compositor.cache.read(x, y, 1, 1)) as number[];
  }, [x, y]);

test('animation: frames, onion skin, playback and saved settings', async ({ page }) => {
  await makeAnimation(page);
  await page.evaluate(() => {
    const ed = (window as any).__bw;
    ed.setFrame(2);
    ed.updateAnimation({ onionBefore: 1, onionAfter: 1, onionOpacity: 0.4 });
  });
  // Current frame (x=200) is solid black; the previous (x=130) is a faint red, the next (x=270) faint green.
  expect(await composite(page, 200, 135)).toEqual([0, 0, 0, 255]);
  const prev = await composite(page, 130, 135);
  const next = await composite(page, 270, 135);
  expect(prev[3]).toBeGreaterThan(40);
  expect(prev[3]).toBeLessThan(160);
  expect(prev[0]).toBeGreaterThan(prev[1] * 2);
  expect(next[1]).toBeGreaterThan(next[0] * 2);
  // Frame 1 is not shown at all.
  expect((await composite(page, 60, 135))[3]).toBe(0);
  // Thumbnails (gallery, time-lapse) leave the onion skins out.
  const thumbPrev = await page.evaluate(() => Array.from((window as any).__bw.docThumbnail(480).data.slice((135 * 480 + 130) * 4, (135 * 480 + 130) * 4 + 4)));
  expect(thumbPrev).toEqual([255, 255, 255, 255]);

  await expect(page.locator('.tl-frame')).toHaveCount(6);
  const shown = await page.evaluate(async () => {
    const ed = (window as any).__bw;
    ed.updateAnimation({ fps: 30 });
    ed.play();
    const seen = new Set<number>();
    for (let i = 0; i < 20; i++) {
      seen.add(ed.compositor.displayFrame);
      await new Promise((r) => setTimeout(r, 25));
    }
    ed.stop();
    return { seen: seen.size, after: ed.compositor.displayFrame };
  });
  expect(shown.seen).toBeGreaterThan(3);
  expect(shown.after).toBeNull();

  await page.evaluate(() => {
    const ed = (window as any).__bw;
    ed.setProps(ed.doc.root.children[3], { hold: 3 });
  });
  await page.getByRole('button', { name: 'Back to gallery' }).click();
  await page.getByRole('button', { name: /^Open / }).click();
  await page.waitForFunction(() => !!(window as any).__bw?.doc);
  const saved = await page.evaluate(() => {
    const ed = (window as any).__bw;
    return { anim: ed.doc.animation, hold: ed.doc.root.children[3].hold, frames: ed.doc.root.children.length };
  });
  expect(saved.anim.fps).toBe(30);
  expect(saved.hold).toBe(3);
  expect(saved.frames).toBe(6);
});

test('animation exports a GIF and a video', async ({ page }) => {
  await makeAnimation(page);
  const r = await page.evaluate(async () => {
    const { exportAnimation } = await import(String('/src/engine/media/animationExport.ts'));
    const ed = (window as any).__bw;
    ed.updateAnimation({ fps: 12 });
    const gif = await exportAnimation(ed, { format: 'gif', scale: 0.5, transparent: true, loop: true, repeat: 1 }, () => {});
    const bytes = new Uint8Array(await gif.blob.arrayBuffer());
    // Count image descriptors (0x2C after a graphic control block).
    let frames = 0;
    for (let i = 0; i < bytes.length - 1; i++) if (bytes[i] === 0x00 && bytes[i + 1] === 0x2c) frames++;
    const vid = await exportAnimation(ed, { format: 'mp4', scale: 0.5, transparent: false, loop: true, repeat: 1 }, () => {});
    const head = new Uint8Array(await vid.blob.slice(0, 12).arrayBuffer());
    return {
      gifHeader: new TextDecoder().decode(bytes.slice(0, 6)),
      gifFrames: frames,
      gifSize: bytes.length,
      vidExt: vid.ext,
      vidSize: vid.blob.size,
      ftyp: new TextDecoder().decode(head.slice(4, 8)),
      webm: head[0] === 0x1a && head[1] === 0x45,
    };
  });
  expect(r.gifHeader).toBe('GIF89a');
  expect(r.gifFrames).toBeGreaterThanOrEqual(6);
  expect(r.vidSize).toBeGreaterThan(500);
  if (r.vidExt === 'mp4') expect(r.ftyp).toBe('ftyp');
  else expect(r.webm).toBe(true);
});

test('time-lapse records each change and exports a video', async ({ page }) => {
  await newCanvas(page, 320, 240);
  await page.evaluate(() => (window as any).__bwSettings.setState({ tool: 'brush', stabilizer: 0, timelapse: { enabled: true, size: 480 } }));
  for (let i = 0; i < 4; i++) {
    await penStroke(page, [[40, 40 + i * 40, 1], [150, 40 + i * 40, 1], [280, 40 + i * 40, 1]]);
    await page.waitForTimeout(350);
  }
  await page.evaluate(() => (window as any).__bw.history.undo());
  await page.waitForTimeout(400);
  const r = await page.evaluate(async () => {
    const { listArtworks } = await import(String('/src/storage/gallery.ts'));
    const { countFrames, getFrame } = await import(String('/src/storage/timelapse.ts'));
    const { exportTimelapse } = await import(String('/src/engine/media/timelapseExport.ts'));
    // The artwork appears in the gallery after its first autosave.
    let art;
    for (let i = 0; i < 40 && !art; i++) {
      art = (await listArtworks())[0];
      if (!art) await new Promise((r) => setTimeout(r, 200));
    }
    const n = await countFrames(art.id);
    const f = await getFrame(art.id, n - 1);
    const out = await exportTimelapse((window as any).__bw, art.id, { length: 'every', hold: 1, finalFull: true }, () => {});
    return { n, w: f?.w, h: f?.h, size: out.blob.size, ext: out.ext };
  });
  // Blank canvas + 4 strokes + 1 undo.
  expect(r.n).toBeGreaterThanOrEqual(6);
  expect([r.w, r.h]).toEqual([320, 240]);
  expect(r.size).toBeGreaterThan(500);
});
