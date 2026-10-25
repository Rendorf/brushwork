// Comic and manga page templates: print size with bleed, trim and safe-area guides,
// and an optional starting panel layout.
import type { Editor } from '../editor';
import type { PageGuides } from '../guides';
import type { Rect } from '../util/geom';
import { gridPanels, type FrameSet } from './frames';

export interface PageTemplate {
  id: string;
  label: string;
  note: string;
  w: number;
  h: number;
  dpi: number;
  page: PageGuides | null;
  /** Rows of panels (count per row) inside the safe area. */
  rows?: number[];
  gutter?: number;
}

const mm = (v: number, dpi: number) => Math.round((v / 25.4) * dpi);

/** A print page: trim size plus bleed, with a centered safe area. */
function print(id: string, label: string, note: string, trimW: number, trimH: number, bleed: number, safeW: number, safeH: number, dpi: number, rows?: number[]): PageTemplate {
  const b = mm(bleed, dpi);
  const tw = mm(trimW, dpi), th = mm(trimH, dpi);
  const sw = mm(safeW, dpi), sh = mm(safeH, dpi);
  const trim: Rect = { x: b, y: b, w: tw, h: th };
  const safe: Rect = { x: b + Math.round((tw - sw) / 2), y: b + Math.round((th - sh) / 2), w: sw, h: sh };
  return { id, label, note, w: tw + 2 * b, h: th + 2 * b, dpi, page: { trim, safe }, rows, gutter: mm(3, dpi) };
}

export const PAGE_TEMPLATES: PageTemplate[] = [
  print('manga-b5', 'Manga page (B5)', '350 dpi · 3 mm bleed · 3 tiers', 182, 257, 3, 150, 220, 350, [1, 2, 2]),
  print('manga-a4', 'Manga page (A4)', '350 dpi · 3 mm bleed · 4 tiers', 210, 297, 3, 180, 270, 350, [2, 1, 2, 1]),
  print('yonkoma', '4-koma (B5)', '350 dpi · two 4-panel strips', 182, 257, 3, 150, 220, 350, [2, 2, 2, 2]),
  print('us-comic', 'US comic book', '6.625×10.25 in · 300 dpi', 168.3, 260.4, 3.2, 152, 244, 300, [1, 2, 1]),
  print('manga-splash', 'Manga splash page (B5)', '350 dpi · one big panel', 182, 257, 3, 150, 220, 350, [1]),
  { id: 'webtoon', label: 'Webtoon episode', note: '800 px wide · vertical scroll', w: 800, h: 6400, dpi: 72, page: null, rows: [1, 1, 1, 1, 1], gutter: 240 },
];

/** Set up guides and panels for a template on a fresh document. */
export function applyTemplate(ed: Editor, t: PageTemplate): void {
  ed.doc.guides.page = t.page;
  if (!t.rows) return;
  const area: Rect = t.page?.safe ?? { x: 40, y: 120, w: t.w - 80, h: t.h - 240 };
  const frames: FrameSet = {
    panels: gridPanels(area, t.rows, t.gutter ?? 40),
    border: Math.max(3, Math.round(t.dpi / 50)),
    borderColor: '#000000',
    gutterColor: '#ffffff',
  };
  const drawing = ed.doc.activeLayer();
  ed.addFrameLayer(frames);
  if (drawing) ed.setActive(drawing);
}
