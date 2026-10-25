// Materials: seamless pattern tiles drawn procedurally (no third-party assets), plus
// pictures the user imports. Tiles are drawn in one ink color on transparency.
import { rng } from '../util/geom';

export interface Material {
  id: string;
  name: string;
  /** Tile size at 100% scale. */
  w: number;
  h: number;
  draw(ctx: CanvasRenderingContext2D, w: number, h: number): void;
}

const line = (ctx: CanvasRenderingContext2D, pts: [number, number][], close = false) => {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  if (close) ctx.closePath();
};

/** Draw a shape at every position it can wrap to, so tiles stay seamless. */
function wrap(w: number, h: number, x: number, y: number, fn: (x: number, y: number) => void) {
  for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) fn(x + dx, y + dy);
}

function heart(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.35);
  ctx.bezierCurveTo(x - s * 0.9, y - s * 0.25, x - s * 0.35, y - s * 0.85, x, y - s * 0.35);
  ctx.bezierCurveTo(x + s * 0.35, y - s * 0.85, x + s * 0.9, y - s * 0.25, x, y + s * 0.35);
  ctx.fill();
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rot = -Math.PI / 2) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = rot + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.42 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

export const MATERIALS: Material[] = [
  {
    id: 'bricks', name: 'Bricks', w: 128, h: 64,
    draw: (ctx, w, h) => {
      ctx.lineWidth = 3;
      line(ctx, [[0, 1.5], [w, 1.5]]); ctx.stroke();
      line(ctx, [[0, h / 2], [w, h / 2]]); ctx.stroke();
      for (const [x, y0, y1] of [[1.5, 0, h / 2], [w / 2, h / 2, h]] as [number, number, number][]) { line(ctx, [[x, y0], [x, y1]]); ctx.stroke(); }
    },
  },
  {
    id: 'tiles', name: 'Square tiles', w: 64, h: 64,
    draw: (ctx, w, h) => { ctx.lineWidth = 2; ctx.strokeRect(1, 1, w - 2, h - 2); },
  },
  {
    id: 'honeycomb', name: 'Honeycomb', w: 104, h: 180,
    draw: (ctx, w, h) => {
      ctx.lineWidth = 2.5;
      const r = h / 3;
      const hex = (cx: number, cy: number) => { line(ctx, Array.from({ length: 6 }, (_, i) => [cx + Math.cos(Math.PI / 6 + (i * Math.PI) / 3) * r, cy + Math.sin(Math.PI / 6 + (i * Math.PI) / 3) * r] as [number, number]), true); ctx.stroke(); };
      wrap(w, h, w / 2, h / 6, hex);
      wrap(w, h, 0, h / 6 + h / 2, hex);
    },
  },
  {
    id: 'scales', name: 'Fish scales', w: 64, h: 32,
    draw: (ctx, w, h) => {
      ctx.lineWidth = 2;
      const arc = (x: number, y: number) => { ctx.beginPath(); ctx.arc(x, y, w / 2, 0, Math.PI); ctx.stroke(); };
      wrap(w, h, w / 2, 0, arc);
      wrap(w, h, 0, h / 2, arc);
      wrap(w, h, w, h / 2, arc);
    },
  },
  {
    id: 'seigaiha', name: 'Seigaiha (waves)', w: 80, h: 40,
    draw: (ctx, w) => {
      // Rows of concentric fans; each row hides the lower part of the row above.
      const R = w / 2;
      ctx.lineWidth = 2;
      for (let k = -2; k <= 3; k++) {
        const y = (k * R) / 2;
        const off = k & 1 ? R : 0;
        for (let j = -1; j <= 2; j++) {
          const x = j * w + off;
          ctx.save();
          ctx.globalCompositeOperation = 'destination-out';
          ctx.beginPath();
          ctx.arc(x, y, R - 1, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          for (let q = 4; q >= 1; q--) {
            ctx.beginPath();
            ctx.arc(x, y, (R * q) / 4 - 1, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
      }
    },
  },
  {
    id: 'asanoha', name: 'Asanoha (hemp leaf)', w: 60, h: 104,
    draw: (ctx, w, h) => {
      ctx.lineWidth = 1.5;
      // Triangular lattice with lines from each triangle's center to its corners.
      const tri = (a: [number, number], b: [number, number], c: [number, number]) => {
        const g: [number, number] = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3];
        line(ctx, [a, b, c], true); ctx.stroke();
        for (const p of [a, b, c]) { line(ctx, [g, p]); ctx.stroke(); }
      };
      const hw = w / 2, rh = h / 2;
      for (let row = -1; row <= 2; row++) {
        for (let col = -2; col <= 2; col++) {
          const x = col * w + (row % 2 ? hw : 0), y = row * rh;
          tri([x, y], [x + w, y], [x + hw, y + rh]);
          tri([x + hw, y + rh], [x + w, y], [x + w + hw, y + rh]);
        }
      }
    },
  },
  {
    id: 'ichimatsu', name: 'Checker (ichimatsu)', w: 64, h: 64,
    draw: (ctx, w, h) => { ctx.fillRect(0, 0, w / 2, h / 2); ctx.fillRect(w / 2, h / 2, w / 2, h / 2); },
  },
  {
    id: 'diagonal', name: 'Diagonal stripes', w: 32, h: 32,
    draw: (ctx, w, h) => {
      ctx.lineWidth = 8;
      for (const o of [-w, 0, w]) { line(ctx, [[o, h], [o + w, 0]]); ctx.stroke(); }
    },
  },
  {
    id: 'dots', name: 'Polka dots', w: 48, h: 48,
    draw: (ctx, w, h) => {
      const dot = (x: number, y: number) => { ctx.beginPath(); ctx.arc(x, y, w * 0.16, 0, Math.PI * 2); ctx.fill(); };
      wrap(w, h, w / 4, h / 4, dot);
      wrap(w, h, (3 * w) / 4, (3 * h) / 4, dot);
    },
  },
  {
    id: 'chevron', name: 'Zigzag', w: 48, h: 32,
    draw: (ctx, w, h) => {
      ctx.lineWidth = 5;
      ctx.lineJoin = 'miter';
      for (const y of [-h / 2, h / 2, (3 * h) / 2]) { line(ctx, [[-w / 2, y + h / 4], [0, y - h / 4], [w / 2, y + h / 4], [w, y - h / 4], [1.5 * w, y + h / 4]]); ctx.stroke(); }
    },
  },
  {
    id: 'plaid', name: 'Plaid', w: 96, h: 96,
    draw: (ctx, w, h) => {
      ctx.globalAlpha = 0.45;
      ctx.fillRect(0, h * 0.3, w, h * 0.25);
      ctx.fillRect(w * 0.3, 0, w * 0.25, h);
      ctx.globalAlpha = 0.8;
      ctx.fillRect(0, h * 0.75, w, 3);
      ctx.fillRect(w * 0.75, 0, 3, h);
      ctx.globalAlpha = 1;
    },
  },
  {
    id: 'hearts', name: 'Hearts', w: 64, h: 64,
    draw: (ctx, w, h) => { wrap(w, h, w / 4, h / 4, (x, y) => heart(ctx, x, y, w * 0.2)); wrap(w, h, (3 * w) / 4, (3 * h) / 4, (x, y) => heart(ctx, x, y, w * 0.2)); },
  },
  {
    id: 'stars', name: 'Stars', w: 72, h: 72,
    draw: (ctx, w, h) => { wrap(w, h, w / 4, h / 4, (x, y) => star(ctx, x, y, w * 0.14)); wrap(w, h, (3 * w) / 4, (3 * h) / 4, (x, y) => star(ctx, x, y, w * 0.09, 0.3)); },
  },
  {
    id: 'sakura', name: 'Sakura', w: 96, h: 96,
    draw: (ctx, w, h) => {
      const flower = (x: number, y: number, r: number, rot: number) => {
        for (let i = 0; i < 5; i++) {
          const a = rot + (i * 2 * Math.PI) / 5;
          ctx.beginPath();
          ctx.ellipse(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.5, r * 0.32, a, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        ctx.arc(x, y, r * 0.18, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      };
      wrap(w, h, w * 0.27, h * 0.3, (x, y) => flower(x, y, w * 0.16, 0.2));
      wrap(w, h, w * 0.75, h * 0.72, (x, y) => flower(x, y, w * 0.12, 1.1));
    },
  },
  {
    id: 'wood', name: 'Wood planks', w: 256, h: 64,
    draw: (ctx, w, h) => {
      const r = rng(3);
      ctx.lineWidth = 3;
      line(ctx, [[0, 1.5], [w, 1.5]]); ctx.stroke();
      line(ctx, [[w * 0.6, 0], [w * 0.6, h]]); ctx.stroke();
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.5;
      for (let i = 0; i < 7; i++) {
        const y0 = 6 + i * ((h - 10) / 7) + r() * 4;
        ctx.beginPath();
        for (let x = 0; x <= w; x += 8) ctx.lineTo(x, y0 + Math.sin((x / w) * Math.PI * 2 * (1 + (i % 3)) + i) * 2.5);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    },
  },
  {
    id: 'crosshatch', name: 'Crosshatch', w: 24, h: 24,
    draw: (ctx, w, h) => {
      ctx.lineWidth = 1.5;
      for (const o of [-w, 0, w]) {
        line(ctx, [[o, h], [o + w, 0]]); ctx.stroke();
        line(ctx, [[o, 0], [o + w, h]]); ctx.stroke();
      }
    },
  },
];

/** Render a material tile in a color at a scale. */
export function materialTile(m: Material, color: string, scale: number): ImageData {
  const w = Math.max(2, Math.round(m.w * scale)), h = Math.max(2, Math.round(m.h * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.scale(w / m.w, h / m.h);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  m.draw(ctx, m.w, m.h);
  return ctx.getImageData(0, 0, w, h);
}

/** Tint an image to one color, keeping its alpha (or its darkness when it is opaque). */
export function tintImage(img: ImageData, rgb: [number, number, number]): ImageData {
  const out = new ImageData(img.width, img.height);
  let opaque = true;
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i] < 250) { opaque = false; break; }
  for (let i = 0; i < img.data.length; i += 4) {
    const L = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
    out.data[i] = rgb[0] * 255;
    out.data[i + 1] = rgb[1] * 255;
    out.data[i + 2] = rgb[2] * 255;
    out.data[i + 3] = opaque ? 255 - L : img.data[i + 3];
  }
  return out;
}
