// Video (MP4 via WebCodecs, MediaRecorder fallback) and GIF writers for time-lapse and animation export.

export interface VideoWriter {
  readonly width: number;
  readonly height: number;
  readonly ext: 'mp4' | 'webm';
  /** Add the canvas contents as a frame shown for `duration` seconds. */
  add(canvas: HTMLCanvasElement, duration: number): Promise<void>;
  finish(): Promise<Blob>;
}

const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);

/** H.264 first (plays everywhere, incl. iOS Photos), then HEVC, then VP9. */
const CODECS: { mux: 'avc' | 'hevc' | 'vp9'; codec: string }[] = [
  { mux: 'avc', codec: 'avc1.640033' },
  { mux: 'avc', codec: 'avc1.640028' },
  { mux: 'avc', codec: 'avc1.4d0028' },
  { mux: 'avc', codec: 'avc1.42001f' },
  { mux: 'hevc', codec: 'hvc1.1.6.L123.B0' },
  { mux: 'vp9', codec: 'vp09.00.40.08' },
];

async function pickCodec(width: number, height: number, fps: number) {
  if (typeof VideoEncoder === 'undefined') return null;
  for (const c of CODECS) {
    try {
      const cfg: VideoEncoderConfig = { codec: c.codec, width, height, bitrate: bitrateFor(width, height, fps), framerate: fps };
      if ((await VideoEncoder.isConfigSupported(cfg)).supported) return { ...c, cfg };
    } catch {
      /* try the next one */
    }
  }
  return null;
}

const bitrateFor = (w: number, h: number, fps: number) => Math.round(Math.min(20e6, Math.max(1e6, w * h * fps * 0.12)));

/** Create a video writer for w x h (rounded down to even sizes). */
export async function createVideoWriter(w: number, h: number, fps = 30): Promise<VideoWriter> {
  const width = even(w), height = even(h);
  const pick = await pickCodec(width, height, fps);
  if (pick) {
    const { Muxer, ArrayBufferTarget } = await import('mp4-muxer');
    const target = new ArrayBufferTarget();
    const muxer = new Muxer({ target, video: { codec: pick.mux, width, height, frameRate: fps }, fastStart: 'in-memory' });
    let failure: Error | null = null;
    const enc = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => (failure = e as Error),
    });
    enc.configure(pick.cfg);
    let t = 0;
    let lastKey = -Infinity;
    let last: { canvas: HTMLCanvasElement; start: number } | null = null;
    const frameUs = Math.round(1e6 / fps);
    const put = (canvas: HTMLCanvasElement, ts: number, us: number) => {
      const frame = new VideoFrame(canvas, { timestamp: ts, duration: us });
      const key = ts - lastKey >= 2e6;
      if (key) lastKey = ts;
      enc.encode(frame, { keyFrame: key });
      frame.close();
    };
    return {
      width,
      height,
      ext: 'mp4',
      async add(canvas, duration) {
        if (failure) throw failure;
        const us = Math.max(1, Math.round(duration * 1e6));
        put(canvas, t, us);
        last = { canvas, start: t };
        t += us;
        // Keep memory bounded on long exports.
        while (enc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 2));
      },
      async finish() {
        // MP4 gives the last sample a single frame's duration, so a held last frame
        // is closed with one more copy right at its end.
        if (last && t - last.start > frameUs * 1.5) put(last.canvas, t - frameUs, frameUs);
        await enc.flush();
        enc.close();
        if (failure) throw failure;
        muxer.finalize();
        return new Blob([target.buffer], { type: 'video/mp4' });
      },
    };
  }
  return mediaRecorderWriter(width, height, fps);
}

/** Fallback: record a canvas in real time (WebM, or MP4 on Safari). */
function mediaRecorderWriter(width: number, height: number, fps: number): VideoWriter {
  if (typeof MediaRecorder === 'undefined') throw new Error('Video export is not supported in this browser.');
  const rec = document.createElement('canvas');
  rec.width = width;
  rec.height = height;
  const ctx = rec.getContext('2d')!;
  const stream = rec.captureStream(0);
  const track = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void };
  const mime = MediaRecorder.isTypeSupported('video/mp4') ? 'video/mp4' : 'video/webm';
  const mr = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrateFor(width, height, fps) });
  const chunks: Blob[] = [];
  mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  mr.start();
  return {
    width,
    height,
    ext: mime === 'video/mp4' ? 'mp4' : 'webm',
    async add(canvas, duration) {
      ctx.drawImage(canvas, 0, 0, width, height);
      track.requestFrame?.();
      await new Promise((r) => setTimeout(r, Math.max(1000 / fps, duration * 1000)));
    },
    finish() {
      return new Promise((resolve) => {
        mr.onstop = () => resolve(new Blob(chunks, { type: mime }));
        mr.stop();
      });
    },
  };
}

export interface GifWriter {
  add(img: ImageData, delayMs: number): void;
  finish(): Blob;
}

/** Animated GIF; `transparent` keeps 1-bit transparency, otherwise frames should be opaque. */
export async function createGifWriter(transparent: boolean, repeat = 0): Promise<GifWriter> {
  const { GIFEncoder, quantize, applyPalette } = await import('gifenc');
  const gif = GIFEncoder();
  let first = true;
  return {
    add(img, delayMs) {
      const format = transparent ? 'rgba4444' : 'rgb565';
      const palette = quantize(img.data, 256, { format, oneBitAlpha: transparent, clearAlpha: transparent });
      const index = applyPalette(img.data, palette, format);
      const ti = transparent ? palette.findIndex((c) => c[3] === 0) : -1;
      gif.writeFrame(index, img.width, img.height, {
        palette,
        delay: Math.max(20, Math.round(delayMs)),
        ...(first ? { repeat } : {}),
        ...(ti >= 0 ? { transparent: true, transparentIndex: ti, dispose: 2 } : {}),
      });
      first = false;
    },
    finish() {
      gif.finish();
      return new Blob([gif.bytes().slice().buffer], { type: 'image/gif' });
    },
  };
}

/** Draw an image into a w x h canvas, letterboxed on a background color. */
export function fitInto(ctx: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number, w: number, h: number, bg: string): void {
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  const k = Math.min(w / sw, h / sh);
  const dw = sw * k, dh = sh * k;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, (w - dw) / 2, (h - dh) / 2, dw, dh);
}
