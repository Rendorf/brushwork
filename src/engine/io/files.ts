// Image/PSD import and export, and handing files to the user.
import type { Layer as PsdLayer, Psd, BlendMode as PsdBlend } from 'ag-psd';
import { blendFromPsd, blendToPsd, type BlendMode } from '../blendModes';
import { Doc, Folder, Layer, type Node } from '../document';
import type { Editor } from '../editor';
import { Surface, type GL } from '../gl/gl';
import { alphaBounds, flattenOnto, premultiply, unpremultiply } from '../util/pixels';

export type ImageFormat = 'png' | 'jpeg';

function canvasFrom(data: Uint8ClampedArray<ArrayBuffer>, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d')!.putImageData(new ImageData(data, w, h), 0, 0);
  return c;
}

function toBlob(c: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode the image.'))), type, quality));
}

/** Flattened image. Transparent PNG keeps alpha; otherwise the background color is applied. */
export async function exportImage(ed: Editor, format: ImageFormat, transparent: boolean, scale = 1): Promise<Blob> {
  const doc = ed.doc;
  const px = ed.readComposite();
  const data = format === 'png' && (transparent || doc.background.transparent) ? unpremultiply(px) : flattenOnto(px, doc.background.color);
  let c = canvasFrom(data, doc.width, doc.height);
  if (scale !== 1) {
    const s = document.createElement('canvas');
    s.width = Math.max(1, Math.round(doc.width * scale));
    s.height = Math.max(1, Math.round(doc.height * scale));
    const ctx = s.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(c, 0, 0, s.width, s.height);
    c = s;
  }
  return toBlob(c, format === 'png' ? 'image/png' : 'image/jpeg', 0.92);
}

/** PSD export; the PSD library is loaded on first use to keep startup small. */
export async function exportPsd(ed: Editor): Promise<Blob> {
  const { writePsd } = await import('ag-psd');
  const doc = ed.doc;
  const toPsd = (n: Node): PsdLayer => {
    const base: PsdLayer = {
      name: n.name,
      hidden: !n.visible,
      opacity: n.opacity,
      blendMode: blendToPsd(n.blendMode) as PsdBlend,
      clipping: n.clipping,
    };
    if (n.kind === 'folder') return { ...base, opened: n.expanded, children: n.children.map(toPsd) };
    const px = n.surface.read();
    const b = alphaBounds(px, doc.width, doc.height);
    if (!b) return { ...base, left: 0, top: 0, imageData: { width: 0, height: 0, data: new Uint8ClampedArray(0) } };
    const sub = new Uint8Array(b.w * b.h * 4);
    for (let y = 0; y < b.h; y++) sub.set(px.subarray(((b.y + y) * doc.width + b.x) * 4, ((b.y + y) * doc.width + b.x + b.w) * 4), y * b.w * 4);
    return { ...base, transparencyProtected: n.alphaLock, left: b.x, top: b.y, imageData: { width: b.w, height: b.h, data: unpremultiply(sub) } };
  };
  const composite = ed.readComposite();
  const psd: Psd = {
    width: doc.width,
    height: doc.height,
    children: [] as PsdLayer[],
    imageData: { width: doc.width, height: doc.height, data: flattenOnto(composite, doc.background.color) },
  };
  if (!doc.background.transparent) {
    const bg = new Uint8ClampedArray(doc.width * doc.height * 4);
    const [r, g, b] = doc.background.color;
    for (let i = 0; i < bg.length; i += 4) { bg[i] = r; bg[i + 1] = g; bg[i + 2] = b; bg[i + 3] = 255; }
    psd.children!.push({ name: 'Background', left: 0, top: 0, imageData: { width: doc.width, height: doc.height, data: bg } });
  }
  psd.children!.push(...doc.root.children.map(toPsd));
  const buf = writePsd(psd, { noBackground: doc.background.transparent, generateThumbnail: false });
  return new Blob([buf], { type: 'image/vnd.adobe.photoshop' });
}

export async function importPsd(gl: GL, buf: ArrayBuffer): Promise<Doc> {
  const { readPsd } = await import('ag-psd');
  const psd = readPsd(buf, { useImageData: true, skipThumbnail: true });
  const doc = new Doc(gl, psd.width, psd.height);
  doc.background = { color: [255, 255, 255], transparent: true };
  const build = (l: PsdLayer, parent: Folder) => {
    let node: Node;
    if (l.children) {
      const f = new Folder(l.name ?? 'Folder');
      f.blendMode = blendFromPsd(l.blendMode);
      f.expanded = l.opened ?? true;
      node = f;
    } else {
      const s = new Surface(gl, psd.width, psd.height);
      s.clear();
      const img = l.imageData;
      if (img && img.width > 0 && img.height > 0) placePixels(s, premultiply(img.data as Uint8ClampedArray), img.width, img.height, l.left ?? 0, l.top ?? 0);
      const layer = new Layer(s, l.name ?? 'Layer');
      const bm = blendFromPsd(l.blendMode);
      layer.blendMode = (bm === 'passthrough' ? 'normal' : bm) as BlendMode;
      layer.alphaLock = !!l.transparencyProtected;
      node = layer;
    }
    node.visible = !l.hidden;
    node.opacity = l.opacity ?? 1;
    node.clipping = !!l.clipping;
    doc.insert(node, parent, parent.children.length);
    if (l.children) for (const c of l.children) build(c, node as Folder);
  };
  if (psd.children?.length) {
    for (const l of psd.children) build(l, doc.root);
  } else if (psd.imageData) {
    const s = new Surface(gl, psd.width, psd.height);
    placePixels(s, premultiply(psd.imageData.data as Uint8ClampedArray), psd.width, psd.height, 0, 0);
    doc.insert(new Layer(s, 'Image'), doc.root, 0);
  }
  doc.active = doc.allNodes().at(-1) ?? null;
  return doc;
}

function placePixels(s: Surface, pm: Uint8Array, w: number, h: number, x: number, y: number): void {
  const x0 = Math.max(0, x), y0 = Math.max(0, y);
  const x1 = Math.min(s.w, x + w), y1 = Math.min(s.h, y + h);
  if (x1 <= x0 || y1 <= y0) return;
  const rw = x1 - x0;
  const sub = new Uint8Array(rw * (y1 - y0) * 4);
  for (let row = y0; row < y1; row++) {
    const start = ((row - y) * w + (x0 - x)) * 4;
    sub.set(pm.subarray(start, start + rw * 4), (row - y0) * rw * 4);
  }
  s.upload(x0, y0, rw, y1 - y0, sub);
}

/** Decode an image file into straight-alpha RGBA. */
export async function decodeImage(file: Blob): Promise<ImageData> {
  const bmp = await createImageBitmap(file);
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close?.();
  return ctx.getImageData(0, 0, c.width, c.height);
}

/** Scale image data down so it fits inside maxW x maxH. */
export function fitImage(img: ImageData, maxW: number, maxH: number): ImageData {
  const k = Math.min(maxW / img.width, maxH / img.height, 1);
  if (k >= 1) return img;
  const src = document.createElement('canvas');
  src.width = img.width;
  src.height = img.height;
  src.getContext('2d')!.putImageData(img, 0, 0);
  const dst = document.createElement('canvas');
  dst.width = Math.max(1, Math.round(img.width * k));
  dst.height = Math.max(1, Math.round(img.height * k));
  const ctx = dst.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, dst.width, dst.height);
  return ctx.getImageData(0, 0, dst.width, dst.height);
}

/** Give a file to the user: the share sheet on touch devices, a download elsewhere. */
export async function deliverFile(blob: Blob, filename: string): Promise<void> {
  const file = new File([blob], filename, { type: blob.type });
  const touch = matchMedia('(pointer: coarse)').matches;
  if (touch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'artwork';
}
