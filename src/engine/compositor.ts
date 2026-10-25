import { blendIndex, OP_REPLACE } from './blendModes';
import type { Doc, Folder, Layer, Node } from './document';
import { drawFullscreen, Surface, type GL } from './gl/gl';
import type { Programs } from './shaders/programs';
import { clampToDoc, union, type Rect } from './util/geom';

/** Something that replaces a layer's pixels while a tool previews a change (stroke, transform). */
export interface LayerPreview {
  layer: Layer;
  /** Render the layer's previewed pixels for doc rect `r` into `target` at (0,0). */
  render(target: Surface, r: Rect): void;
}

interface Src {
  tex: WebGLTexture;
  ox: number;
  oy: number;
}

interface WalkState {
  A: Surface;
  B: Surface;
}

export const TILE = 1024;

/**
 * Flattens the layer tree into a cached document-size texture. Only dirty rectangles are
 * recomposited, in tiles of TILE x TILE using small scratch surfaces per nesting depth.
 */
export class Compositor {
  cache: Surface;
  preview: LayerPreview | null = null;
  private dirty: Rect | null = null;
  private pairs: [Surface, Surface][] = [];
  private previewTile: Surface | null = null;

  constructor(private gl: GL, private progs: Programs, private doc: Doc) {
    this.cache = new Surface(gl, doc.width, doc.height);
    this.invalidate();
  }

  /** Call after the document size changes. */
  resize(): void {
    this.cache.dispose();
    this.cache = new Surface(this.gl, this.doc.width, this.doc.height);
    this.invalidate();
  }

  invalidate(r?: Rect | null): void {
    const full = { x: 0, y: 0, w: this.doc.width, h: this.doc.height };
    this.dirty = union(this.dirty, r === undefined || r === null ? full : r);
  }

  get isDirty(): boolean {
    return !!this.dirty;
  }

  /** Recomposite dirty regions. Returns true when the cache changed. */
  update(): boolean {
    const d = clampToDoc(this.dirty, this.doc.width, this.doc.height);
    this.dirty = null;
    if (!d) return false;
    const gl = this.gl;
    gl.disable(gl.BLEND);
    for (let y = d.y; y < d.y + d.h; y += TILE) {
      for (let x = d.x; x < d.x + d.w; x += TILE) {
        const r = { x, y, w: Math.min(TILE, d.x + d.w - x), h: Math.min(TILE, d.y + d.h - y) };
        const out = this.composeList(this.doc.root.children, r, 0);
        out.blitTo(this.cache, 0, 0, r.w, r.h, r.x, r.y);
      }
    }
    return true;
  }

  private pair(depth: number): [Surface, Surface] {
    while (this.pairs.length <= depth) {
      this.pairs.push([new Surface(this.gl, TILE, TILE), new Surface(this.gl, TILE, TILE)]);
    }
    return this.pairs[depth];
  }

  private composeList(list: Node[], r: Rect, depth: number): Surface {
    const [A, B] = this.pair(depth);
    A.clear(0, 0, r.w, r.h);
    const st: WalkState = { A, B };
    this.walk(list, r, depth, 1, st);
    return st.A;
  }

  private walk(list: Node[], r: Rect, depth: number, mul: number, st: WalkState): void {
    let i = 0;
    while (i < list.length) {
      const node = list[i];
      let j = i + 1;
      const clipped: Layer[] = [];
      while (j < list.length && list[j].clipping && list[j].kind === 'layer') {
        clipped.push(list[j] as Layer);
        j++;
      }
      if (node.visible && node.opacity > 0) {
        const visClipped = clipped.filter((c) => c.visible && c.opacity > 0);
        if (node.kind === 'folder' && node.blendMode === 'passthrough' && visClipped.length === 0) {
          this.walk(node.children, r, depth, mul * node.opacity, st);
        } else {
          let src: Src;
          if (node.kind === 'layer' && visClipped.length === 0) {
            src = this.layerSource(node, r);
          } else {
            const g = this.baseGroup(node, visClipped, r, depth + 1);
            src = { tex: g.tex, ox: 0, oy: 0 };
          }
          const mode = node.blendMode === 'passthrough' ? 0 : blendIndex(node.blendMode);
          this.blend(src, st, r, mode, node.opacity * mul, false);
        }
      }
      i = j;
    }
  }

  /** Base (layer or folder) plus the layers clipped to it, flattened at `depth`. */
  private baseGroup(base: Node, clipped: Layer[], r: Rect, depth: number): Surface {
    let st: WalkState;
    if (base.kind === 'folder') {
      const out = this.composeList((base as Folder).children, r, depth);
      const [A, B] = this.pair(depth);
      st = out === A ? { A, B } : { A: B, B: A };
    } else {
      const [A, B] = this.pair(depth);
      st = { A: B, B: A };
      this.blend(this.layerSource(base, r), st, r, OP_REPLACE, 1, false, false);
    }
    for (const c of clipped) {
      this.blend(this.layerSource(c, r), st, r, blendIndex(c.blendMode), c.opacity, true);
    }
    return st.A;
  }

  private layerSource(layer: Layer, r: Rect): Src {
    if (this.preview && this.preview.layer === layer) {
      if (!this.previewTile) this.previewTile = new Surface(this.gl, TILE, TILE);
      this.preview.render(this.previewTile, r);
      return { tex: this.previewTile.tex, ox: 0, oy: 0 };
    }
    return { tex: layer.surface.tex, ox: r.x, oy: r.y };
  }

  /** st.B = blend(st.A, src); then swap. */
  private blend(src: Src, st: WalkState, r: Rect, mode: number, opacity: number, atop: boolean, hasDst = true): void {
    const p = this.progs.composite.use();
    st.B.target(0, 0, r.w, r.h);
    p.tex('u_dst', 0, st.A.tex).iv2('u_dstOff', 0, 0).b('u_hasDst', hasDst);
    p.tex('u_src', 1, src.tex).iv2('u_srcOff', src.ox, src.oy);
    p.f('u_opacity', opacity).i('u_mode', mode).b('u_atop', atop);
    drawFullscreen(this.gl);
    const t = st.A;
    st.A = st.B;
    st.B = t;
  }

  dispose(): void {
    this.cache.dispose();
    this.pairs.forEach(([a, b]) => { a.dispose(); b.dispose(); });
    this.pairs = [];
    this.previewTile?.dispose();
  }
}
