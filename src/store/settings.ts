import { createStore } from 'zustand/vanilla';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { BrushParams } from '../engine/brush/presets';
import type { StabilizerMode } from '../engine/brush/stroke';
import { hsvToRgb, rgbToHsv } from '../engine/brush/stroke';

export type ToolId =
  | 'brush'
  | 'eraser'
  | 'smudge'
  | 'blur'
  | 'fill'
  | 'lassoFill'
  | 'select'
  | 'transform'
  | 'eyedropper'
  | 'hand';

export type BrushToolId = 'brush' | 'eraser' | 'smudge' | 'blur';

export const isBrushTool = (t: ToolId): t is BrushToolId => t === 'brush' || t === 'eraser' || t === 'smudge' || t === 'blur';

export interface BrushToolState {
  presetId: string;
  size: number;
  opacity: number;
  /** Per-tool tweaks made in the brush settings panel. Keyed by preset id. */
  overrides: Record<string, Partial<BrushParams>>;
}

export type FillSource = 'layer' | 'canvas' | 'reference';
export type SelectShape = 'rect' | 'ellipse' | 'lasso' | 'wand';
export type SelectOp = 'replace' | 'add' | 'subtract' | 'intersect';

export interface Settings {
  tool: ToolId;
  brushTools: Record<BrushToolId, BrushToolState>;
  /** Current color in HSV, each 0..1. */
  color: { h: number; s: number; v: number };
  colorHistory: string[];
  palettes: { name: string; colors: string[] }[];
  stabilizer: number;
  stabilizerMode: StabilizerMode;
  pressureGamma: number;
  stylusMode: 'auto' | 'on' | 'off';
  fill: { source: FillSource; tolerance: number; gap: number; expand: number; antialias: boolean };
  lassoFillMode: 'fill' | 'erase';
  select: { shape: SelectShape; op: SelectOp; tolerance: number; source: 'layer' | 'canvas' };
  eyedropperSource: 'canvas' | 'layer';
  leftHanded: boolean;
  twoFingerUndo: boolean;
  longPressEyedropper: boolean;
  showCursor: boolean;
  undoBudgetMB: number;
  transformKeepAspect: boolean;
}

const DEFAULTS: Settings = {
  tool: 'brush',
  brushTools: {
    brush: { presetId: 'g-pen', size: 10, opacity: 1, overrides: {} },
    eraser: { presetId: 'eraser-hard', size: 30, opacity: 1, overrides: {} },
    smudge: { presetId: 'smudge', size: 40, opacity: 1, overrides: {} },
    blur: { presetId: 'blur', size: 60, opacity: 1, overrides: {} },
  },
  color: { h: 0, s: 0, v: 0.1 },
  colorHistory: [],
  palettes: [
    { name: 'Basics', colors: ['#000000', '#ffffff', '#7f7f7f', '#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa', '#6d4c41'] },
    { name: 'Skin', colors: ['#fde3d0', '#f8cbad', '#f1b28b', '#e0956a', '#c47a52', '#9c5b3b', '#6e3f2a', '#f7d2c4'] },
  ],
  stabilizer: 10,
  stabilizerMode: 'smooth',
  pressureGamma: 1,
  stylusMode: 'auto',
  fill: { source: 'canvas', tolerance: 10, gap: 0, expand: 1, antialias: true },
  lassoFillMode: 'fill',
  select: { shape: 'rect', op: 'replace', tolerance: 10, source: 'canvas' },
  eyedropperSource: 'canvas',
  leftHanded: false,
  twoFingerUndo: true,
  longPressEyedropper: true,
  showCursor: true,
  undoBudgetMB: 512,
  transformKeepAspect: true,
};

export const settingsStore = createStore<Settings>()(
  persist(() => ({ ...DEFAULTS }), {
    name: 'brushwork-settings',
    version: 1,
    storage: createJSONStorage(() => localStorage),
    merge: (persisted, current) => {
      const p = (persisted ?? {}) as Partial<Settings>;
      return {
        ...current,
        ...p,
        brushTools: { ...current.brushTools, ...(p.brushTools ?? {}) },
        fill: { ...current.fill, ...(p.fill ?? {}) },
        select: { ...current.select, ...(p.select ?? {}) },
      };
    },
  }),
);

export const getSettings = () => settingsStore.getState();
export const setSettings = (patch: Partial<Settings> | ((s: Settings) => Partial<Settings>)) =>
  settingsStore.setState(patch as Partial<Settings>);

export function updateBrushTool(tool: BrushToolId, patch: Partial<BrushToolState>): void {
  settingsStore.setState((s) => ({ brushTools: { ...s.brushTools, [tool]: { ...s.brushTools[tool], ...patch } } }));
}

export function currentRGB(): [number, number, number] {
  const { h, s, v } = getSettings().color;
  return hsvToRgb(h, s, v);
}

export function setColorRGB(r: number, g: number, b: number): void {
  const [h, s, v] = rgbToHsv(r, g, b);
  // Keep the hue when the color is gray so the picker does not jump.
  const prev = getSettings().color;
  settingsStore.setState({ color: { h: s === 0 ? prev.h : h, s, v } });
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function pushColorHistory(): void {
  const hex = rgbToHex(...currentRGB());
  settingsStore.setState((s) => ({ colorHistory: [hex, ...s.colorHistory.filter((c) => c !== hex)].slice(0, 24) }));
}
