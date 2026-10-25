// The app's IndexedDB database, shared by the gallery, custom brush tips and references.
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { DocJSON } from '../engine/io/serialize';

export interface ArtworkMeta {
  id: string;
  name: string;
  width: number;
  height: number;
  dpi: number;
  created: number;
  updated: number;
  layerCount: number;
}

export interface LayerRecord {
  gz: boolean;
  data: ArrayBuffer;
}

export interface TipRecord {
  id: string;
  w: number;
  h: number;
  data: ArrayBuffer;
}

export interface RefRecord {
  id: string;
  name: string;
  type: string;
  data: ArrayBuffer;
  added: number;
}

interface Schema extends DBSchema {
  meta: { key: string; value: ArtworkMeta };
  thumbs: { key: string; value: { type: string; data: ArrayBuffer } };
  docs: { key: string; value: DocJSON };
  layers: { key: string; value: LayerRecord };
  tips: { key: string; value: TipRecord };
  refs: { key: string; value: RefRecord };
}

let dbp: Promise<IDBPDatabase<Schema>> | null = null;

export function db(): Promise<IDBPDatabase<Schema>> {
  if (!dbp) {
    dbp = openDB<Schema>('brushwork', 2, {
      upgrade(d, oldVersion) {
        if (oldVersion < 1) {
          d.createObjectStore('meta', { keyPath: 'id' });
          d.createObjectStore('thumbs');
          d.createObjectStore('docs');
          d.createObjectStore('layers');
        }
        if (oldVersion < 2) {
          d.createObjectStore('tips', { keyPath: 'id' });
          d.createObjectStore('refs', { keyPath: 'id' });
        }
      },
    });
  }
  return dbp;
}
