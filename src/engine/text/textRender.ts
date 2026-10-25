// Text layers: layout (horizontal or vertical) and rasterizing with Canvas 2D.
import type { P } from '../guides';
import { ensureFont, fontById } from './fonts';

export interface TextProps {
  text: string;
  /** FontEntry id. */
  font: string;
  /** Font size in document pixels. */
  size: number;
  color: string;
  bold: boolean;
  italic: boolean;
  vertical: boolean;
  align: 'start' | 'center' | 'end';
  /** Extra space between characters, as a fraction of the size. */
  letterSpacing: number;
  /** Line (or column) spacing as a multiple of the size. */
  lineHeight: number;
  strokeWidth: number;
  strokeColor: string;
  /** Anchor: top-left of the block for horizontal text, top-right for vertical. */
  x: number;
  y: number;
  /** Degrees, around the anchor. */
  rotation: number;
}

export function defaultText(x: number, y: number, over: Partial<TextProps> = {}): TextProps {
  return {
    text: 'Text',
    font: 'inter',
    size: 64,
    color: '#000000',
    bold: false,
    italic: false,
    vertical: false,
    align: 'start',
    letterSpacing: 0,
    lineHeight: 1.3,
    strokeWidth: 0,
    strokeColor: '#ffffff',
    x,
    y,
    rotation: 0,
    ...over,
  };
}

// Characters drawn sideways in vertical text (long vowel mark, dashes, brackets...).
const ROTATE = new Set([...'ー－—―〜～…‥「」『』（）()[]【】〈〉《》｛｝{}<>＜＞-=＝→←'.split('')]);
// Punctuation that sits in the top-right of its cell in vertical text.
const PUNCT = new Set([...'、。，．,.'.split('')]);
// Small kana are nudged towards the top-right too.
const SMALL = new Set([...'ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ'.split('')]);

export interface VCell {
  ch: string;
  /** Cell center relative to the anchor (top-right of the block). */
  x: number;
  y: number;
  rotate: boolean;
}

/** Vertical layout: each line is a column, columns run right to left. Pure. */
export function verticalLayout(p: Pick<TextProps, 'text' | 'size' | 'letterSpacing' | 'lineHeight' | 'align'>): { cells: VCell[]; w: number; h: number } {
  const cols = p.text.split('\n').map((l) => [...l]);
  const cellH = p.size * (1 + p.letterSpacing);
  const colW = p.size * p.lineHeight;
  const maxLen = Math.max(1, ...cols.map((c) => c.length));
  const h = maxLen * cellH;
  const w = Math.max(1, cols.length) * colW;
  const cells: VCell[] = [];
  cols.forEach((chars, c) => {
    const len = chars.length * cellH;
    const off = p.align === 'center' ? (h - len) / 2 : p.align === 'end' ? h - len : 0;
    chars.forEach((ch, k) => {
      let x = -(c + 0.5) * colW;
      let y = off + (k + 0.5) * cellH;
      if (PUNCT.has(ch)) {
        x += p.size * 0.3;
        y -= p.size * 0.3;
      } else if (SMALL.has(ch)) {
        x += p.size * 0.08;
        y -= p.size * 0.08;
      }
      cells.push({ ch, x, y, rotate: ROTATE.has(ch) });
    });
  });
  return { cells, w, h };
}

let measureCtx: CanvasRenderingContext2D | null = null;
function measurer(): CanvasRenderingContext2D {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')!;
  return measureCtx;
}

export function fontCss(p: TextProps): string {
  return `${p.italic ? 'italic' : 'normal'} ${p.bold ? '700' : '400'} ${p.size}px ${fontById(p.font).css}`;
}

function lineWidth(ctx: CanvasRenderingContext2D, line: string, spacing: number): number {
  if (!spacing) return ctx.measureText(line).width;
  const chars = [...line];
  return chars.reduce((w, ch) => w + ctx.measureText(ch).width, 0) + spacing * Math.max(0, chars.length - 1);
}

/** Block size of the text (unrotated), in document pixels. */
export function measureText(p: TextProps): { w: number; h: number } {
  if (p.vertical) {
    const v = verticalLayout(p);
    return { w: v.w, h: v.h };
  }
  const ctx = measurer();
  ctx.font = fontCss(p);
  const lines = p.text.split('\n');
  const w = Math.max(p.size * 0.3, ...lines.map((l) => lineWidth(ctx, l, p.letterSpacing * p.size)));
  return { w, h: lines.length * p.size * p.lineHeight };
}

/** Corners of the text block (TL, TR, BR, BL) in document coordinates, for hit testing and overlays. */
export function textCorners(p: TextProps, pad = 0): P[] {
  const { w, h } = measureText(p);
  const x0 = p.vertical ? -w : 0;
  const local: P[] = [
    { x: x0 - pad, y: -pad },
    { x: x0 + w + pad, y: -pad },
    { x: x0 + w + pad, y: h + pad },
    { x: x0 - pad, y: h + pad },
  ];
  const a = (p.rotation * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return local.map((q) => ({ x: p.x + c * q.x - s * q.y, y: p.y + s * q.x + c * q.y }));
}

export interface TextRaster {
  img: ImageData;
  /** Document position of the image's top-left pixel. */
  x: number;
  y: number;
}

/** Rasterize text to straight-alpha RGBA covering its rotated bounds. */
export async function renderText(p: TextProps): Promise<TextRaster | null> {
  if (!p.text.trim()) return null;
  await ensureFont(fontById(p.font).css, p.bold ? '700' : '400', p.italic ? 'italic' : 'normal', p.text.slice(0, 40));
  const pad = Math.ceil(p.strokeWidth + p.size * 0.35);
  const corners = textCorners(p, pad);
  const x0 = Math.floor(Math.min(...corners.map((c) => c.x)));
  const y0 = Math.floor(Math.min(...corners.map((c) => c.y)));
  const x1 = Math.ceil(Math.max(...corners.map((c) => c.x)));
  const y1 = Math.ceil(Math.max(...corners.map((c) => c.y)));
  const W = Math.min(8192, x1 - x0), H = Math.min(8192, y1 - y0);
  if (W <= 0 || H <= 0) return null;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.translate(p.x - x0, p.y - y0);
  ctx.rotate((p.rotation * Math.PI) / 180);
  ctx.font = fontCss(p);
  ctx.fillStyle = p.color;
  ctx.strokeStyle = p.strokeColor;
  ctx.lineWidth = p.strokeWidth * 2;
  ctx.lineJoin = 'round';
  ctx.textBaseline = 'middle';
  const draw = (s: string, x: number, y: number) => {
    if (p.strokeWidth > 0) ctx.strokeText(s, x, y);
    ctx.fillText(s, x, y);
  };
  if (p.vertical) {
    ctx.textAlign = 'center';
    for (const cell of verticalLayout(p).cells) {
      if (cell.rotate) {
        ctx.save();
        ctx.translate(cell.x, cell.y);
        ctx.rotate(Math.PI / 2);
        draw(cell.ch, 0, 0);
        ctx.restore();
      } else {
        draw(cell.ch, cell.x, cell.y);
      }
    }
  } else {
    const { w } = measureText(p);
    const lh = p.size * p.lineHeight;
    const spacing = p.letterSpacing * p.size;
    p.text.split('\n').forEach((line, i) => {
      const y = (i + 0.5) * lh;
      const lw = lineWidth(ctx, line, spacing);
      let x = p.align === 'center' ? (w - lw) / 2 : p.align === 'end' ? w - lw : 0;
      ctx.textAlign = 'left';
      if (!spacing) {
        draw(line, x, y);
        return;
      }
      for (const ch of line) {
        draw(ch, x, y);
        x += ctx.measureText(ch).width + spacing;
      }
    });
  }
  return { img: ctx.getImageData(0, 0, W, H), x: x0, y: y0 };
}

/** A short layer name from the text. */
export function textLayerName(p: TextProps): string {
  const t = p.text.replace(/\s+/g, ' ').trim();
  return `T ${t.length > 18 ? `${t.slice(0, 18)}…` : t || '(empty)'}`;
}
