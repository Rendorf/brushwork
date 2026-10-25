import { blendIndex, OP_REPLACE } from './blendModes';
import type { Doc, Folder, Layer, Node } from './document';
import { animationFrames, frameIndexOf } from './animation';
import { TONE_GLSL, TONE_SHAPES, toneCell } from './comics/tone';
import { drawFullscreen, FULLSCREEN_VS, Program, Surface, type GL } from './gl/gl';
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
  /** Animation: frame to show instead of the active one (playback, export). */
  displayFrame: number | null = null;
  /** Animation: draw onion skins (off during playback and export). */
  onion = true;
  private lastFrame = 0;
  private dirty: Rect | null = null;
  private pairs: [Surface, Surface][] = [];
  private previewTile: Surface | null = null;
  private toneTile: Surface | null = null;
  private toneProg: Program | null = null;

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
        const out = this.doc.animation ? this.composeAnimation(r) : this.composeList(this.doc.root.children, r, 0);
        out.blitTo(this.cache, 0, 0, r.w, r.h, r.x, r.y);
      }
    }
    return true;
  }

  /** Index of the animation frame being shown. */
  currentFrame(): number {
    const frames = animationFrames(this.doc);
    if (this.displayFrame !== null) return Math.min(this.displayFrame, frames.length - 1);
    const i = frameIndexOf(this.doc, this.doc.active);
    if (i >= 0) this.lastFrame = i;
    return Math.min(this.lastFrame, frames.length - 1);
  }

  /** Animation: background, onion skins, then the current frame. */
  private composeAnimation(r: Rect): Surface {
    const anim = this.doc.animation!;
    const [A, B] = this.pair(0);
    A.clear(0, 0, r.w, r.h);
    const st: WalkState = { A, B };
    const frames = animationFrames(this.doc);
    const cur = this.currentFrame();
    if (anim.background && this.doc.root.children[0]) this.walk([this.doc.root.children[0]], r, 0, 1, st);
    if (this.onion && this.displayFrame === null) {
      const skin = (count: number, dir: -1 | 1, tint: [number, number, number]) => {
        for (let k = count; k >= 1; k--) {
          const node = frames[cur + dir * k];
          if (!node || !node.visible) continue;
          const src = node.kind === 'layer' ? this.layerSource(node, r) : (() => {
            const g = this.baseGroup(node, [], r, 1);
            return { tex: g.tex, ox: 0, oy: 0 };
          })();
          this.blend(src, st, r, 102, anim.onionOpacity * (1 - (k - 1) / (count + 1)), false, true, tint);
        }
      };
      skin(anim.onionBefore, -1, [0.95, 0.2, 0.25]);
      skin(anim.onionAfter, 1, [0.15, 0.75, 0.3]);
    }
    if (frames[cur]) this.walk([frames[cur]], r, 0, 1, st);
    return st.A;
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
    let src: Src = { tex: layer.surface.tex, ox: r.x, oy: r.y };
    if (this.preview && this.preview.layer === layer) {
      if (!this.previewTile) this.previewTile = new Surface(this.gl, TILE, TILE);
      this.preview.render(this.previewTile, r);
      src = { tex: this.previewTile.tex, ox: 0, oy: 0 };
    }
    if (layer.tone) src = this.toneSource(layer, src, r);
    return src;
  }

  /** Screentone layers: turn the layer's darkness into a dot / line / noise screen. */
  private toneSource(layer: Layer, src: Src, r: Rect): Src {
    const t = layer.tone!;
    if (!this.toneTile) this.toneTile = new Surface(this.gl, TILE, TILE);
    if (!this.toneProg) this.toneProg = new Program(this.gl, FULLSCREEN_VS, TONE_GLSL, 'tone');
    const p = this.toneProg.use();
    this.toneTile.target(0, 0, r.w, r.h);
    const a = (t.angle * Math.PI) / 180;
    p.tex('u_src', 0, src.tex).iv2('u_srcOff', src.ox, src.oy).v2('u_origin', r.x, r.y);
    p.f('u_cell', toneCell(t, this.doc.dpi)).v2('u_rot', Math.cos(a), Math.sin(a)).i('u_shape', TONE_SHAPES.indexOf(t.shape));
    drawFullscreen(this.gl);
    return { tex: this.toneTile.tex, ox: 0, oy: 0 };
  }

  /** st.B = blend(st.A, src); then swap. */
  private blend(src: Src, st: WalkState, r: Rect, mode: number, opacity: number, atop: boolean, hasDst = true, tint: [number, number, number] = [0, 0, 0]): void {
    const p = this.progs.composite.use();
    p.v3('u_tint', tint[0], tint[1], tint[2]);
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
    this.toneTile?.dispose();
  }
}
