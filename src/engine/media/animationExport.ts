import { animationFrames } from '../animation';
import type { Editor } from '../editor';
import { createGifWriter, createVideoWriter } from './encode';

export interface AnimationExportOptions {
  format: 'gif' | 'mp4';
  /** Output size as a fraction of the canvas. */
  scale: number;
  /** GIF only: keep transparency instead of the paper color. */
  transparent: boolean;
  /** GIF: loop forever (else play once). MP4: how many times to repeat the sequence. */
  loop: boolean;
  repeat: number;
}

export async function exportAnimation(ed: Editor, o: AnimationExportOptions, progress: (p: number) => void): Promise<{ blob: Blob; ext: string }> {
  const doc = ed.doc;
  const anim = doc.animation;
  const frames = animationFrames(doc);
  if (!anim || !frames.length) throw new Error('This artwork has no animation frames.');
  ed.stop();
  const w = Math.max(2, Math.round(doc.width * o.scale));
  const h = Math.max(2, Math.round(doc.height * o.scale));
  const bg = o.format === 'gif' && o.transparent ? undefined : doc.background.color;
  const dur = (i: number) => Math.max(1, frames[i].hold) / anim.fps;

  if (o.format === 'gif') {
    const gif = await createGifWriter(!bg, o.loop ? 0 : -1);
    for (let i = 0; i < frames.length; i++) {
      gif.add(ed.renderAnimationFrame(i, w, h, bg), dur(i) * 1000);
      progress((i + 1) / frames.length);
      // Let the UI update between frames.
      await new Promise((r) => setTimeout(r, 0));
    }
    return { blob: gif.finish(), ext: 'gif' };
  }

  const writer = await createVideoWriter(w, h, Math.min(60, Math.max(1, anim.fps)));
  const canvas = document.createElement('canvas');
  canvas.width = writer.width;
  canvas.height = writer.height;
  const ctx = canvas.getContext('2d')!;
  const images = frames.map((_, i) => ed.renderAnimationFrame(i, writer.width, writer.height, bg));
  const total = images.length * Math.max(1, o.repeat);
  let done = 0;
  for (let r = 0; r < Math.max(1, o.repeat); r++) {
    for (let i = 0; i < images.length; i++) {
      ctx.putImageData(images[i], 0, 0);
      await writer.add(canvas, dur(i));
      progress(++done / (total + 1));
    }
  }
  const blob = await writer.finish();
  progress(1);
  return { blob, ext: writer.ext };
}
