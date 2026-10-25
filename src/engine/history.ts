import type { Layer } from './document';
import { intersect, type Rect } from './util/geom';

export interface HistoryEntry {
  label: string;
  bytes: number;
  undo(): void;
  redo(): void;
  /** Called when the entry is dropped. `applied` is true if its change is currently in effect. */
  dispose?(applied: boolean): void;
}

export const UNDO_TILE = 256;

interface TileRec {
  x: number;
  y: number;
  w: number;
  h: number;
  data: Uint8Array;
}

/**
 * Pixel undo. Tiles are captured once, before their first change. Undo and redo both swap
 * the stored tiles with the current pixels, so the entry stores only one copy per tile.
 */
export class PixelEntry implements HistoryEntry {
  bytes = 0;
  private tiles = new Map<Layer, Map<number, TileRec>>();

  constructor(public label: string, private onChange: (layer: Layer, r: Rect) => void) {}

  capture(layer: Layer, rect: Rect): void {
    const s = layer.surface;
    const r = intersect(rect, { x: 0, y: 0, w: s.w, h: s.h });
    if (!r) return;
    let map = this.tiles.get(layer);
    if (!map) this.tiles.set(layer, (map = new Map()));
    const tx0 = Math.floor(r.x / UNDO_TILE);
    const ty0 = Math.floor(r.y / UNDO_TILE);
    const tx1 = Math.floor((r.x + r.w - 1) / UNDO_TILE);
    const ty1 = Math.floor((r.y + r.h - 1) / UNDO_TILE);
    const cols = Math.ceil(s.w / UNDO_TILE);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const key = ty * cols + tx;
        if (map.has(key)) continue;
        const x = tx * UNDO_TILE;
        const y = ty * UNDO_TILE;
        const w = Math.min(UNDO_TILE, s.w - x);
        const h = Math.min(UNDO_TILE, s.h - y);
        const data = s.read(x, y, w, h);
        map.set(key, { x, y, w, h, data });
        this.bytes += data.byteLength;
      }
    }
  }

  get isEmpty(): boolean {
    return this.bytes === 0;
  }

  private swap(): void {
    for (const [layer, map] of this.tiles) {
      const s = layer.surface;
      for (const t of map.values()) {
        const cur = s.read(t.x, t.y, t.w, t.h);
        s.upload(t.x, t.y, t.w, t.h, t.data);
        t.data = cur;
        this.onChange(layer, t);
      }
    }
  }

  undo(): void { this.swap(); }
  redo(): void { this.swap(); }
  /** Restore the captured pixels without going through the history stack (cancel). */
  rollback(): void { this.swap(); }
}

/** Several entries applied as one step. */
export class CompoundEntry implements HistoryEntry {
  constructor(public label: string, public parts: HistoryEntry[]) {}
  get bytes(): number {
    return this.parts.reduce((n, p) => n + p.bytes, 0);
  }
  undo(): void {
    for (let i = this.parts.length - 1; i >= 0; i--) this.parts[i].undo();
  }
  redo(): void {
    for (const p of this.parts) p.redo();
  }
  dispose(applied: boolean): void {
    for (const p of this.parts) p.dispose?.(applied);
  }
}

export class History {
  private done: HistoryEntry[] = [];
  private undone: HistoryEntry[] = [];
  budgetBytes = 512 * 1024 * 1024;
  maxSteps = 200;
  onChange: () => void = () => {};

  push(e: HistoryEntry): void {
    for (const u of this.undone) u.dispose?.(false);
    this.undone = [];
    this.done.push(e);
    this.enforce();
    this.onChange();
  }

  undo(): boolean {
    const e = this.done.pop();
    if (!e) return false;
    e.undo();
    this.undone.push(e);
    this.onChange();
    return true;
  }

  redo(): boolean {
    const e = this.undone.pop();
    if (!e) return false;
    e.redo();
    this.done.push(e);
    this.onChange();
    return true;
  }

  get canUndo(): boolean { return this.done.length > 0; }
  get canRedo(): boolean { return this.undone.length > 0; }
  get undoLabel(): string | null { return this.done[this.done.length - 1]?.label ?? null; }
  get redoLabel(): string | null { return this.undone[this.undone.length - 1]?.label ?? null; }

  get totalBytes(): number {
    let n = 0;
    for (const e of this.done) n += e.bytes;
    for (const e of this.undone) n += e.bytes;
    return n;
  }

  private enforce(): void {
    let total = this.totalBytes;
    while (this.done.length > 1 && (this.done.length > this.maxSteps || total > this.budgetBytes)) {
      const e = this.done.shift()!;
      total -= e.bytes;
      e.dispose?.(true);
    }
  }

  clear(): void {
    for (const e of this.done) e.dispose?.(true);
    for (const e of this.undone) e.dispose?.(false);
    this.done = [];
    this.undone = [];
    this.onChange();
  }
}
