import { createContext, useCallback, useContext, useSyncExternalStore } from 'react';
import { useStore } from 'zustand';
import type { Editor } from '../engine/editor';
import { settingsStore, type Settings } from '../store/settings';

export function useSettings<T>(sel: (s: Settings) => T): T {
  return useStore(settingsStore, sel);
}

export const EditorContext = createContext<Editor | null>(null);

/** The open editor; re-renders the caller whenever the document or history changes. */
export function useEditor(): Editor {
  const ed = useContext(EditorContext);
  if (!ed) throw new Error('useEditor outside of an editor');
  const sub = useCallback((cb: () => void) => ed.subscribe(cb), [ed]);
  useSyncExternalStore(sub, () => ed.version);
  return ed;
}
