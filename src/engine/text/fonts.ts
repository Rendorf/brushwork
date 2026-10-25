// Fonts for text layers: bundled open-license fonts (OFL / Apache), system font stacks
// (which cover Japanese and other scripts on the device), and fonts the user imports.
import '@fontsource/bangers/latin-400.css';
import '@fontsource/bangers/latin-ext-400.css';
import '@fontsource/comic-neue/latin-400.css';
import '@fontsource/comic-neue/latin-700.css';
import '@fontsource/patrick-hand/latin-400.css';
import '@fontsource/patrick-hand/latin-ext-400.css';
import '@fontsource/permanent-marker/latin-400.css';
import '@fontsource/merriweather/latin-400.css';
import '@fontsource/merriweather/latin-700.css';
import '@fontsource/merriweather/latin-ext-400.css';
import '@fontsource/merriweather/cyrillic-400.css';
import '@fontsource/pacifico/latin-400.css';
import '@fontsource/pacifico/latin-ext-400.css';
import '@fontsource/caveat/latin-400.css';
import '@fontsource/caveat/latin-ext-400.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/inter/latin-ext-400.css';
import '@fontsource/inter/latin-ext-700.css';
import '@fontsource/inter/cyrillic-400.css';
import '@fontsource/inter/cyrillic-700.css';
import { db } from '../../storage/db';

export interface FontEntry {
  id: string;
  label: string;
  /** CSS font-family value. */
  css: string;
  kind: 'bundled' | 'system' | 'imported';
}

const JP_GOTHIC = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", "Noto Sans CJK JP", "Noto Sans JP", "Meiryo", sans-serif';
const JP_MINCHO = '"Hiragino Mincho ProN", "Yu Mincho", "Noto Serif CJK JP", "Noto Serif JP", "MS Mincho", serif';

export const BUILTIN_FONTS: FontEntry[] = [
  { id: 'inter', label: 'Inter (sans)', css: `"Inter", ${JP_GOTHIC}`, kind: 'bundled' },
  { id: 'comic-neue', label: 'Comic Neue', css: `"Comic Neue", ${JP_GOTHIC}`, kind: 'bundled' },
  { id: 'bangers', label: 'Bangers (comic titles)', css: `"Bangers", ${JP_GOTHIC}`, kind: 'bundled' },
  { id: 'patrick-hand', label: 'Patrick Hand', css: `"Patrick Hand", ${JP_GOTHIC}`, kind: 'bundled' },
  { id: 'permanent-marker', label: 'Permanent Marker', css: `"Permanent Marker", ${JP_GOTHIC}`, kind: 'bundled' },
  { id: 'caveat', label: 'Caveat (handwriting)', css: `"Caveat", ${JP_GOTHIC}`, kind: 'bundled' },
  { id: 'pacifico', label: 'Pacifico (script)', css: `"Pacifico", ${JP_GOTHIC}`, kind: 'bundled' },
  { id: 'merriweather', label: 'Merriweather (serif)', css: `"Merriweather", ${JP_MINCHO}`, kind: 'bundled' },
  { id: 'jp-gothic', label: 'Japanese Gothic (device)', css: JP_GOTHIC, kind: 'system' },
  { id: 'jp-mincho', label: 'Japanese Mincho (device)', css: JP_MINCHO, kind: 'system' },
  { id: 'system-sans', label: 'System Sans', css: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', kind: 'system' },
  { id: 'system-serif', label: 'System Serif', css: 'Georgia, "Times New Roman", serif', kind: 'system' },
  { id: 'mono', label: 'Monospace', css: 'ui-monospace, Menlo, Consolas, monospace', kind: 'system' },
];

const imported: FontEntry[] = [];
let loaded: Promise<void> | null = null;

export function allFonts(): FontEntry[] {
  return [...BUILTIN_FONTS, ...imported];
}

export function fontById(id: string): FontEntry {
  return allFonts().find((f) => f.id === id) ?? BUILTIN_FONTS[0];
}

async function register(family: string, data: ArrayBuffer): Promise<void> {
  const face = new FontFace(family, data);
  await face.load();
  (document.fonts as unknown as { add(f: FontFace): void }).add(face);
}

/** Register the user's imported fonts (once, at startup). */
export function loadImportedFonts(): Promise<void> {
  if (!loaded) {
    loaded = (async () => {
      try {
        for (const r of await (await db()).getAll('fonts')) {
          try {
            await register(r.family, r.data);
            imported.push({ id: r.id, label: r.label, css: `"${r.family}", sans-serif`, kind: 'imported' });
          } catch {
            /* skip a font the browser cannot read */
          }
        }
      } catch {
        /* storage unavailable */
      }
    })();
  }
  return loaded;
}

/** Import a TTF / OTF / WOFF / WOFF2 file. */
export async function importFont(file: File): Promise<FontEntry> {
  const data = await file.arrayBuffer();
  const id = `font_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
  const family = `bw-${id}`;
  try {
    await register(family, data);
  } catch {
    throw new Error('That file is not a font this browser can read (use TTF, OTF, WOFF or WOFF2).');
  }
  const label = file.name.replace(/\.[^.]+$/, '');
  await (await db()).put('fonts', { id, family, label, data });
  const entry: FontEntry = { id, label, css: `"${family}", sans-serif`, kind: 'imported' };
  imported.push(entry);
  return entry;
}

export async function deleteFont(id: string): Promise<void> {
  const i = imported.findIndex((f) => f.id === id);
  if (i >= 0) imported.splice(i, 1);
  await (await db()).delete('fonts', id);
}

/** Make sure a font is ready before drawing text with it on a canvas. */
export async function ensureFont(css: string, weight: string, style: string, sample = 'Aaあ'): Promise<void> {
  try {
    await document.fonts.load(`${style} ${weight} 32px ${css}`, sample);
  } catch {
    /* fall back to whatever is available */
  }
}
