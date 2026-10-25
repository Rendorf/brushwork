// All brushes: the built-in presets plus the user's custom brushes (kept in settings).
import { settingsStore } from '../../store/settings';
import { PRESET_MAP, PRESETS, type BrushParams } from './presets';

export function customBrushes(): BrushParams[] {
  return settingsStore.getState().customBrushes;
}

export function getBrush(id: string): BrushParams {
  return PRESET_MAP.get(id) ?? customBrushes().find((b) => b.id === id) ?? PRESETS[1];
}

export function allBrushes(): BrushParams[] {
  return [...PRESETS, ...customBrushes()];
}
