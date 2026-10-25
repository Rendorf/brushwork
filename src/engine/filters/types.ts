import type { GradientStop } from '../../store/settings';
import type { Surface } from '../gl/gl';
import type { FilterRun } from './runner';

export type FilterCategory = 'Adjust' | 'Blur' | 'Light & Shadow' | 'Artistic' | 'Distort' | 'Generate';

export const FILTER_CATEGORIES: FilterCategory[] = ['Adjust', 'Blur', 'Light & Shadow', 'Artistic', 'Distort', 'Generate'];

/** A tone curve: control points (0..1) for the master RGB curve and each channel. */
export interface Curves {
  rgb: [number, number][];
  r: [number, number][];
  g: [number, number][];
  b: [number, number][];
}

export type Param =
  | { key: string; label: string; type: 'range'; min: number; max: number; step?: number; default: number; unit?: string }
  | { key: string; label: string; type: 'toggle'; default: boolean }
  /** Hex color, or 'fg' for the current brush color. */
  | { key: string; label: string; type: 'color'; default: string }
  | { key: string; label: string; type: 'select'; options: { value: string; label: string }[]; default: string }
  /** A point on the canvas as fractions of its width and height; can be set by tapping. */
  | { key: string; label: string; type: 'point'; default: [number, number] }
  | { key: string; label: string; type: 'curves'; default: Curves }
  | { key: string; label: string; type: 'gradient'; default: GradientStop[] };

export type Value = number | boolean | string | [number, number] | Curves | GradientStop[];
export type Values = Record<string, Value>;

export interface FilterDef {
  id: string;
  name: string;
  category: FilterCategory;
  params: Param[];
  /** Extra pixels needed around a selection (blur radius, offsets...). */
  margin?: (v: Values) => number;
  /** Draws new content (generators): the result is laid over the layer. */
  generator?: boolean;
  /** Returns the filtered region (same size as run.src), premultiplied. */
  run(run: FilterRun, v: Values): Surface;
}

export function defaults(def: FilterDef): Values {
  const v: Values = {};
  for (const p of def.params) v[p.key] = structuredClone(p.default) as Value;
  return v;
}

// Typed accessors for filter implementations.
export const num = (v: Values, k: string) => Number(v[k]);
export const bool = (v: Values, k: string) => Boolean(v[k]);
export const str = (v: Values, k: string) => String(v[k]);
export const pt = (v: Values, k: string) => v[k] as [number, number];
