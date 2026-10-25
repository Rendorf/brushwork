// CPU pixel algorithms: flood fill with gap closing, distance transforms, masks.
import type { Rect } from './geom';

const INF = 65535;

/**
 * Chamfer (3-4) distance from every pixel to the nearest pixel where `isZero` is true.
 * Values are in thirds of a pixel (divide by 3 for pixels), capped at 65535.
 */
export function distanceTransform(w: number, h: number, isZero: (i: number) => boolean): Uint16Array {
  const d = new Uint16Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = isZero(i) ? 0 : INF;
  const m = (a: number, b: number) => (b < a ? b : a);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const i = row + x;
      let v = d[i];
      if (v === 0) continue;
      if (x > 0) v = m(v, d[i - 1] + 3);
      if (y > 0) {
        v = m(v, d[i - w] + 3);
        if (x > 0) v = m(v, d[i - w - 1] + 4);
        if (x < w - 1) v = m(v, d[i - w + 1] + 4);
      }
      d[i] = v > INF ? INF : v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    const row = y * w;
    for (let x = w - 1; x >= 0; x--) {
      const i = row + x;
      let v = d[i];
      if (v === 0) continue;
      if (x < w - 1) v = m(v, d[i + 1] + 3);
      if (y < h - 1) {
        v = m(v, d[i + w] + 3);
        if (x < w - 1) v = m(v, d[i + w + 1] + 4);
        if (x > 0) v = m(v, d[i + w - 1] + 4);
      }
      d[i] = v > INF ? INF : v;
    }
  }
  return d;
}

/** Grow a binary mask (non-zero = set) by r pixels. */
export function dilate(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return mask.slice();
  const d = distanceTransform(w, h, (i) => mask[i] !== 0);
  const lim = r * 3;
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = d[i] <= lim ? 255 : 0;
  return out;
}

/** Shrink a binary mask by r pixels. */
export function erode(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return mask.slice();
  const d = distanceTransform(w, h, (i) => mask[i] === 0);
  const lim = r * 3;
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = d[i] > lim ? 255 : 0;
  return out;
}

/** Separable box blur, repeated for a gaussian-like falloff. */
export function blurMask(mask: Uint8Array, w: number, h: number, radius: number, passes = 3): Uint8Array {
  if (radius < 1) return mask.slice();
  let src = Float32Array.from(mask);
  let dst = new Float32Array(w * h);
  const r = Math.max(1, Math.round(radius / Math.sqrt(passes)));
  for (let p = 0; p < passes; p++) {
    // horizontal
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let acc = 0;
      for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        dst[row + x] = acc / (2 * r + 1);
        acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
      }
    }
    [src, dst] = [dst, src];
    // vertical
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += src[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        dst[y * w + x] = acc / (2 * r + 1);
        acc += src[Math.min(h - 1, y + r + 1) * w + x] - src[Math.max(0, y - r) * w + x];
      }
    }
    [src, dst] = [dst, src];
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = Math.round(src[i]);
  return out;
}

export function maskBounds(mask: Uint8Array, w: number, h: number): Rect | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (mask[row + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Bounding box of pixels with non-zero alpha in RGBA data. */
export function alphaBounds(px: Uint8Array, w: number, h: number): Rect | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      if (px[row + x * 4 + 3]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Scanline flood fill over pixels where pass[i] is non-zero. Returns 0/1 region. */
export function scanlineFill(pass: Uint8Array, w: number, h: number, sx: number, sy: number): Uint8Array {
  const out = new Uint8Array(w * h);
  if (!pass[sy * w + sx]) return out;
  const stack: number[] = [sx, sy];
  while (stack.length) {
    const y = stack.pop()!;
    const x = stack.pop()!;
    let lx = x;
    const row = y * w;
    if (out[row + x] || !pass[row + x]) continue;
    while (lx > 0 && pass[row + lx - 1] && !out[row + lx - 1]) lx--;
    let rx = x;
    while (rx < w - 1 && pass[row + rx + 1] && !out[row + rx + 1]) rx++;
    for (let i = lx; i <= rx; i++) out[row + i] = 1;
    for (const ny of [y - 1, y + 1]) {
      if (ny < 0 || ny >= h) continue;
      const nrow = ny * w;
      let inSpan = false;
      for (let i = lx; i <= rx; i++) {
        const ok = pass[nrow + i] && !out[nrow + i];
        if (ok && !inSpan) {
          stack.push(i, ny);
          inSpan = true;
        } else if (!ok) {
          inSpan = false;
        }
      }
    }
  }
  return out;
}

/** Grow `region` by up to `steps` pixels, only through pixels where `allowed` is set. */
export function geodesicGrow(region: Uint8Array, allowed: Uint8Array, w: number, h: number, steps: number): void {
  if (steps <= 0) return;
  let frontier: number[] = [];
  for (let i = 0; i < region.length; i++) if (region[i]) frontier.push(i);
  for (let s = 0; s < steps && frontier.length; s++) {
    const next: number[] = [];
    for (const i of frontier) {
      const x = i % w;
      const y = (i - x) / w;
      if (x > 0) tryAdd(i - 1);
      if (x < w - 1) tryAdd(i + 1);
      if (y > 0) tryAdd(i - w);
      if (y < h - 1) tryAdd(i + w);
    }
    frontier = next;
    function tryAdd(j: number) {
      if (!region[j] && allowed[j]) {
        region[j] = 1;
        next.push(j);
      }
    }
  }
}

export interface FillOptions {
  /** 0..255 per channel. */
  tolerance: number;
  /** Close gaps up to this many pixels wide. */
  gap: number;
  /** Grow the result by this many pixels (under line art). */
  expand: number;
  antialias: boolean;
}

/**
 * Bucket fill region from premultiplied RGBA pixels. Returns an 8-bit coverage mask the size
 * of the image, or null when the seed is outside.
 */
export function floodFill(px: Uint8Array, w: number, h: number, sx: number, sy: number, o: FillOptions): { mask: Uint8Array; bounds: Rect } | null {
  sx = Math.floor(sx);
  sy = Math.floor(sy);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return null;
  const si = (sy * w + sx) * 4;
  const r0 = px[si], g0 = px[si + 1], b0 = px[si + 2], a0 = px[si + 3];
  const tol = o.tolerance;
  const pass = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < pass.length; i++, j += 4) {
    const d = Math.max(Math.abs(px[j] - r0), Math.abs(px[j + 1] - g0), Math.abs(px[j + 2] - b0), Math.abs(px[j + 3] - a0));
    pass[i] = d <= tol ? 1 : 0;
  }
  let region: Uint8Array;
  if (o.gap > 0) {
    // Fill only where we are further than `gap` from a boundary, then grow back up to it.
    const d = distanceTransform(w, h, (i) => pass[i] === 0);
    const lim = o.gap * 3;
    const narrow = new Uint8Array(w * h);
    for (let i = 0; i < narrow.length; i++) narrow[i] = d[i] > lim ? 1 : 0;
    if (narrow[sy * w + sx]) {
      region = scanlineFill(narrow, w, h, sx, sy);
      geodesicGrow(region, pass, w, h, o.gap + 1);
    } else {
      region = scanlineFill(pass, w, h, sx, sy);
    }
  } else {
    region = scanlineFill(pass, w, h, sx, sy);
  }
  let mask: Uint8Array;
  if (o.expand > 0) {
    mask = dilate(region, w, h, o.expand);
  } else {
    mask = new Uint8Array(w * h);
    for (let i = 0; i < mask.length; i++) mask[i] = region[i] ? 255 : 0;
  }
  if (o.antialias) antialiasEdges(mask, w, h);
  const bounds = maskBounds(mask, w, h);
  if (!bounds) return null;
  return { mask, bounds };
}

/** Soften hard mask edges with a 3x3 average on edge pixels only. */
export function antialiasEdges(mask: Uint8Array, w: number, h: number): void {
  const src = mask.slice();
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = src[i];
      if (src[i - 1] === v && src[i + 1] === v && src[i - w] === v && src[i + w] === v) continue;
      let acc = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) acc += src[i + dy * w + dx];
      // Bias towards coverage so fills still meet line art.
      mask[i] = Math.max(Math.round(acc / 9), v === 255 ? 200 : 0);
    }
  }
}

export function unpremultiply(px: Uint8Array | Uint8ClampedArray, out: Uint8ClampedArray<ArrayBuffer> = new Uint8ClampedArray(px.length)): Uint8ClampedArray<ArrayBuffer> {
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3];
    if (a === 0) {
      out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0;
    } else if (a === 255) {
      out[i] = px[i]; out[i + 1] = px[i + 1]; out[i + 2] = px[i + 2]; out[i + 3] = 255;
    } else {
      const k = 255 / a;
      out[i] = px[i] * k; out[i + 1] = px[i + 1] * k; out[i + 2] = px[i + 2] * k; out[i + 3] = a;
    }
  }
  return out;
}

export function premultiply(px: Uint8Array | Uint8ClampedArray, out: Uint8Array = new Uint8Array(px.length)): Uint8Array {
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3];
    const k = a / 255;
    out[i] = Math.round(px[i] * k);
    out[i + 1] = Math.round(px[i + 1] * k);
    out[i + 2] = Math.round(px[i + 2] * k);
    out[i + 3] = a;
  }
  return out;
}

/** Composite premultiplied pixels over an opaque background color (0..255). */
export function flattenOnto(px: Uint8Array, bg: [number, number, number]): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(px.length);
  for (let i = 0; i < px.length; i += 4) {
    const ia = 1 - px[i + 3] / 255;
    out[i] = px[i] + bg[0] * ia;
    out[i + 1] = px[i + 1] + bg[1] * ia;
    out[i + 2] = px[i + 2] + bg[2] * ia;
    out[i + 3] = 255;
  }
  return out;
}

/** Rasterize a closed polygon (anti-aliased) into a mask covering `clip`. */
export function rasterizePath(build: (ctx: Path2D) => void, clip: Rect): Uint8Array {
  const { w, h } = clip;
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.translate(-clip.x, -clip.y);
  const path = new Path2D();
  build(path);
  ctx.fillStyle = '#fff';
  ctx.fill(path);
  const img = ctx.getImageData(0, 0, w, h).data;
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = img[i * 4 + 3];
  return out;
}
