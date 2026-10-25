// Artworks stored on the device in IndexedDB: metadata, thumbnails, document JSON and
// one compressed pixel buffer per layer. Only changed layers are rewritten on save.
// Data is stored as ArrayBuffers, not Blobs: Safari refuses Blobs in IndexedDB in private mode.
import type { Doc } from '../engine/document';
import type { Editor } from '../engine/editor';
import type { GL } from '../engine/gl/gl';
import { canCompress, docFromJSON, docToJSON, gunzip, gzip } from '../engine/io/serialize';
import { db, type ArtworkMeta, type LayerRecord } from './db';

export type { ArtworkMeta };

const layerKey = (art: string, layer: string) => `${art}/${layer}`;
const layerRange = (art: string) => IDBKeyRange.bound(`${art}/`, `${art}/￿`);

export async function listArtworks(): Promise<ArtworkMeta[]> {
  const all = await (await db()).getAll('meta');
  return all.sort((a, b) => b.updated - a.updated);
}

export async function getThumb(id: string): Promise<Blob | undefined> {
  const t = await (await db()).get('thumbs', id);
  if (!t) return undefined;
  // Early builds stored Blobs directly.
  if (t instanceof Blob) return t;
  return new Blob([t.data], { type: t.type });
}

export function newArtworkId(): string {
  return `art_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e8).toString(36)}`;
}

/** Layer content versions written for each open artwork, so saves skip unchanged layers. */
const saved = new WeakMap<Doc, Map<string, number>>();

export async function saveArtwork(ed: Editor, id: string, created?: number): Promise<void> {
  const doc = ed.doc;
  const d = await db();
  const versions = saved.get(doc) ?? new Map<string, number>();
  saved.set(doc, versions);
  const json = docToJSON(doc);
  const layers = doc.allLayers();

  // Read pixels synchronously (GPU) before awaiting anything else.
  const pending: { key: string; id: string; version: number; px: Uint8Array<ArrayBuffer> }[] = [];
  for (const l of layers) {
    if (versions.get(l.id) === l.contentVersion) continue;
    pending.push({ key: layerKey(id, l.id), id: l.id, version: l.contentVersion, px: l.surface.read() });
  }
  const thumbData = ed.docThumbnail(360);
  const records: { key: string; rec: LayerRecord }[] = [];
  const gz = canCompress();
  for (const p of pending) {
    const bytes = gz ? await gzip(p.px) : p.px;
    records.push({ key: p.key, rec: { gz, data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) } });
  }
  const thumbBlob = await imageDataToBlob(thumbData);
  const thumb = { type: thumbBlob.type, data: await thumbBlob.arrayBuffer() };

  const now = Date.now();
  const prev = await d.get('meta', id);
  const meta: ArtworkMeta = {
    id,
    name: doc.name,
    width: doc.width,
    height: doc.height,
    dpi: doc.dpi,
    created: prev?.created ?? created ?? now,
    updated: now,
    layerCount: layers.length,
  };
  const tx = d.transaction(['meta', 'thumbs', 'docs', 'layers'], 'readwrite');
  for (const r of records) await tx.objectStore('layers').put(r.rec, r.key);
  // Drop pixels of layers that no longer exist.
  const live = new Set(layers.map((l) => layerKey(id, l.id)));
  for (const k of await tx.objectStore('layers').getAllKeys(layerRange(id))) {
    if (!live.has(k)) await tx.objectStore('layers').delete(k);
  }
  await tx.objectStore('docs').put(json, id);
  await tx.objectStore('thumbs').put(thumb, id);
  await tx.objectStore('meta').put(meta);
  await tx.done;
  for (const p of pending) versions.set(p.id, p.version);
}

export async function loadArtwork(gl: GL, id: string): Promise<Doc> {
  const d = await db();
  const json = await d.get('docs', id);
  if (!json) throw new Error('This artwork could not be found.');
  const doc = await docFromJSON(gl, json, async (layerId) => {
    const rec = await d.get('layers', layerKey(id, layerId));
    if (!rec) return null;
    const bytes = new Uint8Array(rec.data instanceof Blob ? await rec.data.arrayBuffer() : rec.data);
    return rec.gz ? gunzip(bytes) : bytes;
  });
  const versions = new Map<string, number>();
  for (const l of doc.allLayers()) versions.set(l.id, l.contentVersion);
  saved.set(doc, versions);
  return doc;
}

export async function deleteArtwork(id: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(['meta', 'thumbs', 'docs', 'layers'], 'readwrite');
  await tx.objectStore('meta').delete(id);
  await tx.objectStore('thumbs').delete(id);
  await tx.objectStore('docs').delete(id);
  await tx.objectStore('layers').delete(layerRange(id));
  await tx.done;
}

export async function renameArtwork(id: string, name: string): Promise<void> {
  const d = await db();
  const meta = await d.get('meta', id);
  const json = await d.get('docs', id);
  if (!meta || !json) return;
  meta.name = name;
  json.name = name;
  await d.put('meta', meta);
  await d.put('docs', json, id);
}

export async function duplicateArtwork(id: string): Promise<string> {
  const d = await db();
  const meta = await d.get('meta', id);
  const json = await d.get('docs', id);
  if (!meta || !json) throw new Error('This artwork could not be found.');
  const nid = newArtworkId();
  const tx = d.transaction(['meta', 'thumbs', 'docs', 'layers'], 'readwrite');
  const keys = await tx.objectStore('layers').getAllKeys(layerRange(id));
  for (const k of keys) {
    const rec = await tx.objectStore('layers').get(k);
    if (rec) await tx.objectStore('layers').put(rec, `${nid}/${k.slice(id.length + 1)}`);
  }
  const thumb = await tx.objectStore('thumbs').get(id);
  if (thumb) await tx.objectStore('thumbs').put(thumb, nid);
  await tx.objectStore('docs').put({ ...json, name: `${json.name} copy` }, nid);
  const now = Date.now();
  await tx.objectStore('meta').put({ ...meta, id: nid, name: `${meta.name} copy`, created: now, updated: now });
  await tx.done;
  return nid;
}

/** Remember which layer versions a freshly created or imported doc has NOT saved yet. */
export function markUnsaved(doc: Doc): void {
  saved.set(doc, new Map());
}

async function imageDataToBlob(img: ImageData): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d')!.putImageData(img, 0, 0);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('thumbnail'))), 'image/png'));
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null;
  const e = await navigator.storage.estimate();
  return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
}

/** Ask the browser not to evict our data under storage pressure. */
export async function requestPersistence(): Promise<void> {
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* not supported */
  }
}
