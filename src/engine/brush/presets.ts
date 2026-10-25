import type { BlendMode } from '../blendModes';
import type { GrainId, TipId } from './tips';

export type BrushMode = 'paint' | 'smudge' | 'blur';
export type BrushCategory = 'Pens' | 'Pencils' | 'Airbrush' | 'Paint' | 'Blend' | 'Effects' | 'Erasers';

export interface BrushParams {
  id: string;
  name: string;
  category: BrushCategory;
  mode: BrushMode;
  tip: TipId;
  /** Default diameter in document pixels. */
  size: number;
  /** Stroke opacity cap, 0..1. */
  opacity: number;
  /** Per-dab opacity, 0..1. */
  flow: number;
  hardness: number;
  /** Distance between dabs as a fraction of the dab diameter. */
  spacing: number;
  /** How much pen pressure reduces size (0 = none, 1 = down to zero). */
  sizePressure: number;
  /** How much pen pressure reduces flow. */
  flowPressure: number;
  /** Dab diameter as a fraction of the brush size (spray brushes use small dabs). */
  dabScale: number;
  /** Tip angle in degrees. */
  angle: number;
  followDirection: boolean;
  angleJitter: number;
  roundness: number;
  /** Random offset radius as a fraction of the brush size. */
  scatter: number;
  /** Dabs placed at each spacing step. */
  count: number;
  sizeJitter: number;
  flowJitter: number;
  hueJitter: number;
  satJitter: number;
  valJitter: number;
  grain: GrainId | null;
  grainScale: number;
  grainStrength: number;
  /** Fade-in / fade-out length in multiples of the brush size. */
  taperIn: number;
  taperOut: number;
  /** Size factor at the tapered ends. */
  taperMin: number;
  /** 'over' builds up inside a stroke; 'max' does not (markers). */
  accumulate: 'over' | 'max';
  blendMode: BlendMode;
  wetEdge: number;
  /** Smudge: how much paint is carried (0..1). Blur: blur radius factor. */
  strength: number;
}

const BASE: Omit<BrushParams, 'id' | 'name' | 'category'> = {
  mode: 'paint',
  tip: 'round',
  size: 10,
  opacity: 1,
  flow: 1,
  hardness: 0.9,
  spacing: 0.08,
  sizePressure: 0.8,
  flowPressure: 0,
  dabScale: 1,
  angle: 0,
  followDirection: false,
  angleJitter: 0,
  roundness: 1,
  scatter: 0,
  count: 1,
  sizeJitter: 0,
  flowJitter: 0,
  hueJitter: 0,
  satJitter: 0,
  valJitter: 0,
  grain: null,
  grainScale: 256,
  grainStrength: 0,
  taperIn: 0,
  taperOut: 0,
  taperMin: 0.15,
  accumulate: 'over',
  blendMode: 'normal',
  wetEdge: 0,
  strength: 0.8,
};

const b = (id: string, name: string, category: BrushCategory, p: Partial<BrushParams>): BrushParams => ({
  ...BASE,
  ...p,
  id,
  name,
  category,
});

export const PRESETS: BrushParams[] = [
  // Pens
  b('dip-pen', 'Dip Pen (Hard)', 'Pens', { size: 8, hardness: 0.95, sizePressure: 1, taperIn: 2, taperOut: 3, taperMin: 0.1, spacing: 0.06 }),
  b('g-pen', 'G-Pen', 'Pens', { size: 10, hardness: 0.92, sizePressure: 0.9, taperIn: 1.5, taperOut: 2, spacing: 0.06 }),
  b('maru-pen', 'Maru Pen', 'Pens', { size: 4, hardness: 0.95, sizePressure: 0.8, taperIn: 1, taperOut: 1.5, spacing: 0.08 }),
  b('digital-pen', 'Digital Pen', 'Pens', { size: 8, hardness: 1, sizePressure: 0, spacing: 0.06 }),
  b('fine-liner', 'Fine Liner', 'Pens', { size: 3, hardness: 1, sizePressure: 0.3, spacing: 0.08 }),
  b('brush-pen', 'Brush Pen (Fude)', 'Pens', { size: 18, hardness: 0.85, sizePressure: 1, taperIn: 3, taperOut: 4, taperMin: 0.05, spacing: 0.05 }),
  b('marker', 'Felt Marker', 'Pens', { size: 16, hardness: 0.75, opacity: 0.55, sizePressure: 0.15, accumulate: 'max', spacing: 0.05 }),
  b('glow-pen', 'Glow Pen', 'Pens', { size: 14, hardness: 0.3, flow: 0.6, sizePressure: 0.5, blendMode: 'addGlow', spacing: 0.05 }),

  // Pencils
  b('pencil', 'Pencil', 'Pencils', { tip: 'pencil', size: 6, flow: 0.7, opacity: 0.95, sizePressure: 0.3, flowPressure: 1, grain: 'paper', grainScale: 200, grainStrength: 0.55, spacing: 0.1 }),
  b('mech-pencil', 'Mechanical Pencil', 'Pencils', { tip: 'pencil', size: 3, flow: 0.8, hardness: 0.8, sizePressure: 0.2, flowPressure: 0.9, grain: 'paper', grainScale: 160, grainStrength: 0.4, spacing: 0.1 }),
  b('charcoal', 'Charcoal', 'Pencils', { tip: 'chalk', size: 30, flow: 0.8, sizePressure: 0.4, flowPressure: 0.9, angleJitter: 180, grain: 'canvas', grainScale: 220, grainStrength: 0.75, spacing: 0.1 }),
  b('crayon', 'Crayon', 'Pencils', { tip: 'chalk', size: 20, flow: 0.95, sizePressure: 0.2, flowPressure: 0.4, angleJitter: 180, grain: 'paper', grainScale: 140, grainStrength: 0.9, spacing: 0.08 }),

  // Airbrush
  b('airbrush-soft', 'Airbrush (Soft)', 'Airbrush', { size: 120, hardness: 0, flow: 0.08, sizePressure: 0, flowPressure: 1, spacing: 0.05 }),
  b('airbrush-hard', 'Airbrush (Hard)', 'Airbrush', { size: 60, hardness: 0.55, flow: 0.15, sizePressure: 0, flowPressure: 1, spacing: 0.05 }),
  b('spray', 'Spray', 'Airbrush', { size: 80, dabScale: 0.04, scatter: 0.5, count: 14, sizeJitter: 0.6, hardness: 0.8, sizePressure: 0, flowPressure: 0.8, spacing: 0.6 }),

  // Paint
  b('watercolor', 'Watercolor', 'Paint', { size: 50, hardness: 0.2, flow: 0.3, opacity: 0.7, sizePressure: 0.4, flowPressure: 0.6, wetEdge: 0.85, grain: 'paper', grainScale: 300, grainStrength: 0.3, spacing: 0.05 }),
  b('flat-brush', 'Flat Brush', 'Paint', { tip: 'flat', size: 34, flow: 0.85, followDirection: true, sizePressure: 0.3, flowPressure: 0.3, spacing: 0.04 }),
  b('oil', 'Oil (Bristle)', 'Paint', { tip: 'bristle', size: 36, flow: 0.7, followDirection: true, sizePressure: 0.3, flowPressure: 0.5, grain: 'canvas', grainScale: 260, grainStrength: 0.3, valJitter: 0.03, spacing: 0.05 }),
  b('gouache', 'Gouache', 'Paint', { size: 30, hardness: 0.7, flow: 0.9, opacity: 0.95, sizePressure: 0.5, grain: 'rough', grainScale: 220, grainStrength: 0.25, spacing: 0.05 }),

  // Blend
  b('smudge', 'Smudge', 'Blend', { mode: 'smudge', size: 40, hardness: 0.3, flow: 0.9, strength: 0.8, sizePressure: 0.3, flowPressure: 0.6, spacing: 0.08 }),
  b('smudge-chalk', 'Smudge (Textured)', 'Blend', { mode: 'smudge', tip: 'chalk', size: 50, flow: 0.9, strength: 0.75, sizePressure: 0.2, flowPressure: 0.6, spacing: 0.08 }),
  b('blur', 'Blur', 'Blend', { mode: 'blur', size: 60, hardness: 0, flow: 0.7, strength: 0.6, sizePressure: 0, flowPressure: 0.6, spacing: 0.15 }),

  // Effects / stamps
  b('sparkle', 'Sparkles', 'Effects', { tip: 'sparkle', size: 40, spacing: 1.4, sizeJitter: 0.6, angleJitter: 45, scatter: 0.6, sizePressure: 0.3, hardness: 1 }),
  b('stars', 'Stars', 'Effects', { tip: 'star', size: 30, spacing: 1.3, sizeJitter: 0.5, angleJitter: 180, scatter: 0.8, hueJitter: 0.1, sizePressure: 0.3 }),
  b('hearts', 'Hearts', 'Effects', { tip: 'heart', size: 30, spacing: 1.3, sizeJitter: 0.5, angleJitter: 25, scatter: 0.6, sizePressure: 0.3 }),
  b('leaves', 'Leaves', 'Effects', { tip: 'leaf', size: 36, spacing: 0.8, followDirection: true, angleJitter: 50, sizeJitter: 0.4, scatter: 0.5, hueJitter: 0.04, valJitter: 0.15, sizePressure: 0.3 }),
  b('clouds', 'Clouds', 'Effects', { tip: 'cloud', size: 120, flow: 0.35, spacing: 0.2, angleJitter: 180, sizeJitter: 0.3, scatter: 0.25, sizePressure: 0.2 }),
  b('splatter', 'Splatter', 'Effects', { tip: 'splatter', size: 60, spacing: 0.9, angleJitter: 180, sizeJitter: 0.4, scatter: 0.4, sizePressure: 0.3 }),

  // Erasers
  b('eraser-hard', 'Eraser (Hard)', 'Erasers', { size: 30, hardness: 0.95, sizePressure: 0, spacing: 0.06 }),
  b('eraser-soft', 'Eraser (Soft)', 'Erasers', { size: 80, hardness: 0, flow: 0.25, sizePressure: 0, flowPressure: 0.8, spacing: 0.05 }),
  b('eraser-pencil', 'Eraser (Pencil)', 'Erasers', { tip: 'pencil', size: 10, flow: 0.8, sizePressure: 0.3, flowPressure: 0.8, grain: 'paper', grainScale: 200, grainStrength: 0.4, spacing: 0.08 }),
];

export const PRESET_MAP = new Map(PRESETS.map((p) => [p.id, p]));

export function getPreset(id: string): BrushParams {
  return PRESET_MAP.get(id) ?? PRESETS[1];
}

export const CATEGORIES: BrushCategory[] = ['Pens', 'Pencils', 'Airbrush', 'Paint', 'Blend', 'Effects', 'Erasers'];
