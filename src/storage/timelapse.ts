// Time-lapse: a downscaled snapshot of the canvas after every change, kept per artwork.
import type { Editor } from '../engine/editor';
import { getSettings } from '../store/settings';
import { db, type TimelapseFrame } from './db';

const key = (art: string, i: number) => `${art}/${String(i).padStart(8, '0')}`;
const range = (art: string) => IDBKeyRange.bound(`${art}/`, `${art}/￿`);

export async function countFrames(art: string): Promise<number> {
  return (await db()).count('timelapse', range(art));
}

export async function getFrame(art: string, i: number): Promise<TimelapseFrame | undefined> {
  return (await db()).get('timelapse', key(art, i));
}

export async function clearFrames(art: string): Promise<void> {
  await (await db()).delete('timelapse', range(art));
}

async function encode(img: ImageData): Promise<ArrayBuffer> {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d')!.putImageData(img, 0, 0);
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode'))), 'image/jpeg', 0.85));
  return blob.arrayBuffer();
}

/** Records a frame shortly after each change (strokes, edits, undo/redo). */
export class TimelapseRecorder {
  private next = -1;
  private timer = 0;
  private writing: Promise<void> = Promise.resolve();
  private off: () => void;

  constructor(private ed: Editor, private art: string) {
    this.off = ed.onHistory(() => this.schedule());
    countFrames(art)
      .then((n) => {
        this.next = n;
        // Start with the empty (or reopened) canvas.
        if (n === 0) this.schedule(0);
      })
      .catch(() => (this.next = -1));
  }

  private schedule(delay = 150): void {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.capture(), delay);
  }

  /** Take a snapshot now (also used by tests). */
  capture(): Promise<void> {
    const s = getSettings().timelapse;
    if (!s.enabled || this.next < 0) return this.writing;
    // Busy tools (a transform in progress) are captured once they finish.
    if (this.ed.tool.busy?.()) {
      this.schedule(400);
      return this.writing;
    }
    const img = this.ed.docThumbnail(s.size);
    const i = this.next++;
    this.writing = this.writing.then(async () => {
      const data = await encode(img);
      await (await db()).put('timelapse', { type: 'image/jpeg', w: img.width, h: img.height, data }, key(this.art, i));
    });
    return this.writing;
  }

  /** Wait for frames still being written. */
  flush(): Promise<void> {
    clearTimeout(this.timer);
    return this.writing;
  }

  async reset(): Promise<void> {
    await this.flush();
    await clearFrames(this.art);
    this.next = 0;
    this.schedule(0);
  }

  stop(): void {
    clearTimeout(this.timer);
    this.off();
  }
}
