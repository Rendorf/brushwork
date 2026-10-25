import type { Editor } from '../editor';
import { countFrames, getFrame } from '../../storage/timelapse';
import { createVideoWriter, fitInto } from './encode';

export interface TimelapseOptions {
  /** Target length in seconds, or 'every' to show every recorded frame at 30 fps. */
  length: number | 'every';
  /** Seconds to hold the finished artwork at the end. */
  hold: number;
  /** End on a sharp render of the artwork instead of the last recorded frame. */
  finalFull: boolean;
}

export const FPS = 30;

/** Which recorded frames to show and for how long, for n recorded frames. */
export function timelapsePlan(n: number, length: number | 'every', fps = FPS): { indices: number[]; duration: number } {
  if (n <= 0) return { indices: [], duration: 0 };
  if (length === 'every') return { indices: Array.from({ length: n }, (_, i) => i), duration: 1 / fps };
  const count = Math.max(1, Math.min(n, Math.round(length * fps)));
  return { indices: Array.from({ length: count }, (_, k) => Math.min(n - 1, Math.floor((k * n) / count))), duration: length / count };
}

export async function decodeFrame(art: string, i: number): Promise<ImageBitmap | null> {
  const f = await getFrame(art, i);
  if (!f) return null;
  return createImageBitmap(new Blob([f.data], { type: f.type }));
}

/** Encode the recorded time-lapse of an artwork as a video. */
export async function exportTimelapse(ed: Editor, art: string, o: TimelapseOptions, progress: (p: number) => void): Promise<{ blob: Blob; ext: string }> {
  const n = await countFrames(art);
  if (!n) throw new Error('Nothing has been recorded for this artwork yet.');
  const last = await getFrame(art, n - 1);
  const W = last!.w, H = last!.h;
  const writer = await createVideoWriter(W, H, FPS);
  const canvas = document.createElement('canvas');
  canvas.width = writer.width;
  canvas.height = writer.height;
  const ctx = canvas.getContext('2d')!;
  const bgc = ed.doc.background.color;
  const bg = `rgb(${bgc[0]},${bgc[1]},${bgc[2]})`;
  const { indices, duration } = timelapsePlan(n, o.length);
  for (let k = 0; k < indices.length; k++) {
    const bmp = await decodeFrame(art, indices[k]);
    if (bmp) {
      fitInto(ctx, bmp, bmp.width, bmp.height, canvas.width, canvas.height, bg);
      bmp.close();
    }
    await writer.add(canvas, duration);
    progress((k + 1) / (indices.length + 1));
  }
  if (o.hold > 0 || o.finalFull) {
    if (o.finalFull) {
      const img = ed.docThumbnail(Math.max(canvas.width, canvas.height));
      const tmp = document.createElement('canvas');
      tmp.width = img.width;
      tmp.height = img.height;
      tmp.getContext('2d')!.putImageData(img, 0, 0);
      fitInto(ctx, tmp, img.width, img.height, canvas.width, canvas.height, bg);
    }
    await writer.add(canvas, Math.max(o.hold, 1 / FPS));
  }
  const blob = await writer.finish();
  progress(1);
  return { blob, ext: writer.ext };
}
