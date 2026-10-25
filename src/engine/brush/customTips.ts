// Brush tips made from images or imported brushes, kept in IndexedDB and cached in memory.
import { db } from '../../storage/db';
import type { Mask } from './tips';

const tips = new Map<string, Mask>();
let loaded: Promise<void> | null = null;

export const isCustomTip = (id: string) => id.startsWith('custom:');

export function customTip(id: string): Mask | undefined {
  return tips.get(id);
}

/** Load every saved tip once at startup. */
export function loadCustomTips(): Promise<void> {
  if (!loaded) {
    loaded = (async () => {
      try {
        for (const r of await (await db()).getAll('tips')) tips.set(r.id, { w: r.w, h: r.h, data: new Uint8Array(r.data) });
      } catch {
        /* storage unavailable: custom tips fall back to round */
      }
    })();
  }
  return loaded;
}

export async function saveCustomTip(id: string, m: Mask): Promise<void> {
  tips.set(id, m);
  await (await db()).put('tips', { id, w: m.w, h: m.h, data: m.data.slice().buffer });
}

export async function deleteCustomTip(id: string): Promise<void> {
  tips.delete(id);
  await (await db()).delete('tips', id);
}

/**
 * Turn an 8-bit grayscale/alpha image into a square tip mask (paint = 255). Images with an
 * opaque light border are inverted, so dark-on-white pictures and ABR samples both work.
 * The content is cropped to its bounds and scaled to fill the square.
 */
export function maskFromGray(gray: Uint8Array, w: number, h: number, size = 256): Mask {
  let border = 0, n = 0;
  for (let x = 0; x < w; x++) { border += gray[x] + gray[(h - 1) * w + x]; n += 2; }
  for (let y = 0; y < h; y++) { border += gray[y * w] + gray[y * w + w - 1]; n += 2; }
  const invert = border / n > 127;
  const at = (x: number, y: number) => (invert ? 255 - gray[y * w + x] : gray[y * w + x]);
  // Crop to the painted area.
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (at(x, y) > 8) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  if (x1 < 0) { x0 = 0; y0 = 0; x1 = w - 1; y1 = h - 1; }
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const pad = 2;
  const k = Math.min((size - pad * 2) / cw, (size - pad * 2) / ch);
  const tw = Math.max(1, Math.round(cw * k)), th = Math.max(1, Math.round(ch * k));
  const ox = Math.floor((size - tw) / 2), oy = Math.floor((size - th) / 2);
  const out = new Uint8Array(size * size);
  const sample = (fx: number, fy: number) => {
    // Bilinear, clamped to the crop.
    const x = Math.min(cw - 1, Math.max(0, fx)), y = Math.min(ch - 1, Math.max(0, fy));
    const xi = Math.floor(x), yi = Math.floor(y);
    const xj = Math.min(cw - 1, xi + 1), yj = Math.min(ch - 1, yi + 1);
    const tx = x - xi, ty = y - yi;
    const a = at(x0 + xi, y0 + yi), b = at(x0 + xj, y0 + yi), c = at(x0 + xi, y0 + yj), d = at(x0 + xj, y0 + yj);
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      let v: number;
      if (k >= 1) {
        v = sample((x + 0.5) / k - 0.5, (y + 0.5) / k - 0.5);
      } else {
        // Box-average when shrinking.
        const sx0 = Math.floor(x / k), sy0 = Math.floor(y / k);
        const sx1 = Math.min(cw, Math.max(sx0 + 1, Math.floor((x + 1) / k)));
        const sy1 = Math.min(ch, Math.max(sy0 + 1, Math.floor((y + 1) / k)));
        let acc = 0, cnt = 0;
        for (let yy = sy0; yy < sy1; yy++) for (let xx = sx0; xx < sx1; xx++) { acc += at(x0 + xx, y0 + yy); cnt++; }
        v = acc / cnt;
      }
      out[(oy + y) * size + ox + x] = Math.round(v);
    }
  }
  return { w: size, h: size, data: out };
}

/** Tip mask from an image: alpha if it has transparency, else inverted luminance. */
export function maskFromImage(img: ImageData): Mask {
  const { width: w, height: h, data } = img;
  let transparent = false;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 250) { transparent = true; break; }
  const gray = new Uint8Array(w * h);
  for (let i = 0; i < gray.length; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2], a = data[i * 4 + 3];
    // With transparency, paint where opaque (dark parts slightly stronger keeps detail).
    gray[i] = transparent ? 255 - a : Math.round(0.3 * r + 0.59 * g + 0.11 * b);
  }
  return maskFromGray(gray, w, h);
}
