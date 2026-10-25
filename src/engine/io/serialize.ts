// Document <-> JSON + raw layer pixels, shared by IndexedDB storage and project files.
import type { BlendMode, FolderBlendMode } from '../blendModes';
import { Doc, Folder, Layer, Selection, type Node } from '../document';
import { Surface, type GL } from '../gl/gl';

export interface NodeJSON {
  kind: 'layer' | 'folder';
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  blendMode: FolderBlendMode;
  locked: boolean;
  clipping: boolean;
  alphaLock?: boolean;
  isReference?: boolean;
  expanded?: boolean;
  children?: NodeJSON[];
}

export interface DocJSON {
  version: 1;
  name: string;
  width: number;
  height: number;
  dpi: number;
  background: Doc['background'];
  activeId: string | null;
  root: NodeJSON[];
}

export function docToJSON(doc: Doc): DocJSON {
  const node = (n: Node): NodeJSON => {
    const base: NodeJSON = {
      kind: n.kind,
      id: n.id,
      name: n.name,
      visible: n.visible,
      opacity: n.opacity,
      blendMode: n.blendMode,
      locked: n.locked,
      clipping: n.clipping,
    };
    if (n.kind === 'layer') return { ...base, alphaLock: n.alphaLock, isReference: n.isReference };
    return { ...base, expanded: n.expanded, children: n.children.map(node) };
  };
  return {
    version: 1,
    name: doc.name,
    width: doc.width,
    height: doc.height,
    dpi: doc.dpi,
    background: doc.background,
    activeId: doc.active?.id ?? null,
    root: doc.root.children.map(node),
  };
}

/**
 * Build a Doc from JSON. `pixels(id)` returns premultiplied RGBA for a layer (or null for
 * an empty layer).
 */
export async function docFromJSON(gl: GL, j: DocJSON, pixels: (id: string) => Promise<Uint8Array | null>): Promise<Doc> {
  const doc = new Doc(gl, j.width, j.height, j.dpi);
  doc.name = j.name;
  doc.background = { color: [...j.background.color] as [number, number, number], transparent: j.background.transparent };
  const build = async (n: NodeJSON, parent: Folder): Promise<void> => {
    let node: Node;
    if (n.kind === 'layer') {
      const s = new Surface(gl, j.width, j.height);
      const px = await pixels(n.id);
      if (px && px.byteLength === j.width * j.height * 4) s.upload(0, 0, j.width, j.height, px);
      else s.clear();
      const l = new Layer(s, n.name);
      l.alphaLock = !!n.alphaLock;
      l.isReference = !!n.isReference;
      l.blendMode = n.blendMode as BlendMode;
      node = l;
    } else {
      const f = new Folder(n.name);
      f.expanded = n.expanded ?? true;
      f.blendMode = n.blendMode;
      node = f;
    }
    node.id = n.id;
    node.visible = n.visible;
    node.opacity = n.opacity;
    node.locked = n.locked;
    node.clipping = n.clipping;
    doc.insert(node, parent, parent.children.length);
    if (n.kind === 'folder') for (const c of n.children ?? []) await build(c, node as Folder);
  };
  for (const n of j.root) await build(n, doc.root);
  doc.active = (j.activeId && doc.findById(j.activeId)) || doc.allNodes().at(-1) || null;
  return doc;
}

export async function gzip(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  if (typeof CompressionStream === 'undefined') return data;
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function gunzip(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export const canCompress = () => typeof CompressionStream !== 'undefined';

// --- .brushwork project file -------------------------------------------------
// "BRWK" | u32 version | u32 jsonLength | json | for each layer: u32 idLength | id | u8 gz | u32 len | bytes

const MAGIC = 0x4b575242; // "BRWK" little-endian

export async function writeProject(doc: Doc): Promise<Blob> {
  const json = new TextEncoder().encode(JSON.stringify(docToJSON(doc)));
  const parts: BlobPart[] = [];
  const head = new DataView(new ArrayBuffer(12));
  head.setUint32(0, MAGIC, true);
  head.setUint32(4, 1, true);
  head.setUint32(8, json.byteLength, true);
  parts.push(head.buffer, json);
  const gz = canCompress();
  for (const l of doc.allLayers()) {
    const id = new TextEncoder().encode(l.id);
    const data = gz ? await gzip(l.surface.read()) : l.surface.read();
    const h = new DataView(new ArrayBuffer(4 + id.byteLength + 5));
    h.setUint32(0, id.byteLength, true);
    new Uint8Array(h.buffer, 4, id.byteLength).set(id);
    h.setUint8(4 + id.byteLength, gz ? 1 : 0);
    h.setUint32(5 + id.byteLength, data.byteLength, true);
    parts.push(h.buffer, data);
  }
  return new Blob(parts, { type: 'application/octet-stream' });
}

export function isProjectFile(buf: ArrayBuffer): boolean {
  return buf.byteLength >= 12 && new DataView(buf).getUint32(0, true) === MAGIC;
}

export async function readProject(gl: GL, buf: ArrayBuffer): Promise<Doc> {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error('Not a Brushwork project file.');
  const jsonLen = dv.getUint32(8, true);
  const j = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 12, jsonLen))) as DocJSON;
  const layers = new Map<string, { gz: boolean; data: Uint8Array<ArrayBuffer> }>();
  let o = 12 + jsonLen;
  while (o < buf.byteLength) {
    const idLen = dv.getUint32(o, true);
    const id = new TextDecoder().decode(new Uint8Array(buf, o + 4, idLen));
    const gz = dv.getUint8(o + 4 + idLen) === 1;
    const len = dv.getUint32(o + 5 + idLen, true);
    layers.set(id, { gz, data: new Uint8Array(buf, o + 9 + idLen, len) });
    o += 9 + idLen + len;
  }
  return docFromJSON(gl, j, async (id) => {
    const e = layers.get(id);
    if (!e) return null;
    return e.gz ? gunzip(e.data) : e.data.slice();
  });
}

export function restoreSelection(gl: GL, doc: Doc, mask: Uint8Array | null): void {
  doc.selection = mask ? new Selection(gl, doc.width, doc.height, mask) : null;
}
