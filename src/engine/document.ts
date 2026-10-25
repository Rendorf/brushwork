import type { BlendMode, FolderBlendMode } from './blendModes';
import { Surface, type GL } from './gl/gl';
import type { AnimationSettings } from './animation';
import type { FrameSet } from './comics/frames';
import type { ToneProps } from './comics/tone';
import { defaultGuides, type Guides } from './guides';
import type { TextProps } from './text/textRender';
import { uid, type Rect } from './util/geom';

export class Layer {
  readonly kind = 'layer' as const;
  id = uid('layer');
  name: string;
  visible = true;
  opacity = 1;
  blendMode: BlendMode = 'normal';
  locked = false;
  clipping = false;
  alphaLock = false;
  isReference = false;
  /** Editable text; the pixels are re-rendered from it. */
  text: TextProps | null = null;
  /** Comic frames; the pixels are re-rendered from them. */
  frames: FrameSet | null = null;
  /** Show this layer's darkness as screentone when compositing. */
  tone: ToneProps | null = null;
  /** Animation: how many frames this frame is held for. */
  hold = 1;
  parent: Folder | null = null;
  /** Bumped whenever the pixels change (thumbnails, autosave). */
  contentVersion = 0;

  constructor(public surface: Surface, name: string) {
    this.name = name;
  }

  touch(): void {
    this.contentVersion++;
  }
}

export class Folder {
  readonly kind = 'folder' as const;
  id = uid('folder');
  name: string;
  visible = true;
  opacity = 1;
  blendMode: FolderBlendMode = 'passthrough';
  locked = false;
  clipping = false;
  expanded = true;
  /** Animation: how many frames this frame is held for. */
  hold = 1;
  parent: Folder | null = null;
  /** Bottom-most child first. */
  children: Node[] = [];

  constructor(name: string) {
    this.name = name;
  }
}

export type Node = Layer | Folder;

export interface Background {
  color: [number, number, number];
  transparent: boolean;
}

/** Selection mask: one byte per document pixel, kept on the CPU and mirrored to an R8 texture. */
export class Selection {
  readonly mask: Uint8Array;
  bounds: Rect | null = null;
  private _surface: Surface | null = null;
  private dirty = true;

  constructor(private gl: GL, readonly w: number, readonly h: number, mask?: Uint8Array) {
    this.mask = mask ?? new Uint8Array(w * h);
    this.computeBounds();
  }

  get surface(): Surface {
    if (!this._surface) this._surface = new Surface(this.gl, this.w, this.h, 'r8', 'linear');
    if (this.dirty) {
      this._surface.upload(0, 0, this.w, this.h, this.mask);
      this.dirty = false;
    }
    return this._surface;
  }

  changed(): void {
    this.dirty = true;
    this.computeBounds();
  }

  computeBounds(): void {
    const { w, h, mask } = this;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let first = -1;
      for (let x = 0; x < w; x++) {
        if (mask[row + x]) { first = x; break; }
      }
      if (first < 0) continue;
      let last = first;
      for (let x = w - 1; x > first; x--) {
        if (mask[row + x]) { last = x; break; }
      }
      if (y < y0) y0 = y;
      y1 = y;
      if (first < x0) x0 = first;
      if (last > x1) x1 = last;
    }
    this.bounds = x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  isEmpty(): boolean {
    return !this.bounds;
  }

  clone(): Selection {
    return new Selection(this.gl, this.w, this.h, this.mask.slice());
  }

  dispose(): void {
    this._surface?.dispose();
    this._surface = null;
  }
}

export class Doc {
  root = new Folder('root');
  active: Node | null = null;
  background: Background = { color: [255, 255, 255], transparent: false };
  selection: Selection | null = null;
  name = 'Untitled';
  guides: Guides = defaultGuides();
  /** Frame-by-frame animation settings, or null when the artwork is not an animation. */
  animation: AnimationSettings | null = null;

  constructor(readonly gl: GL, public width: number, public height: number, public dpi = 350) {}

  createLayer(name?: string): Layer {
    const surface = new Surface(this.gl, this.width, this.height);
    surface.clear();
    return new Layer(surface, name ?? this.nextLayerName());
  }

  nextLayerName(): string {
    let n = 1;
    const names = new Set(this.allNodes().map((l) => l.name));
    while (names.has(`Layer ${n}`)) n++;
    return `Layer ${n}`;
  }

  /** All nodes depth-first, bottom to top. */
  allNodes(from: Folder = this.root): Node[] {
    const out: Node[] = [];
    const walk = (f: Folder) => {
      for (const c of f.children) {
        out.push(c);
        if (c.kind === 'folder') walk(c);
      }
    };
    walk(from);
    return out;
  }

  allLayers(from: Folder = this.root): Layer[] {
    return this.allNodes(from).filter((n): n is Layer => n.kind === 'layer');
  }

  findById(id: string): Node | null {
    return this.allNodes().find((n) => n.id === id) ?? null;
  }

  activeLayer(): Layer | null {
    return this.active && this.active.kind === 'layer' ? this.active : null;
  }

  insert(node: Node, parent: Folder, index: number): void {
    node.parent = parent;
    parent.children.splice(Math.max(0, Math.min(index, parent.children.length)), 0, node);
  }

  remove(node: Node): { parent: Folder; index: number } {
    const parent = node.parent!;
    const index = parent.children.indexOf(node);
    if (index >= 0) parent.children.splice(index, 1);
    node.parent = null;
    return { parent, index };
  }

  indexOf(node: Node): { parent: Folder; index: number } {
    const parent = node.parent!;
    return { parent, index: parent.children.indexOf(node) };
  }

  contains(node: Node): boolean {
    let n: Node | null = node;
    while (n && n.parent) n = n.parent;
    return n === this.root;
  }

  /** Is the node effectively visible (it and all parents visible)? */
  isVisible(node: Node): boolean {
    let n: Node | Folder | null = node;
    while (n && n !== this.root) {
      if (!n.visible) return false;
      n = n.parent;
    }
    return true;
  }

  isLocked(node: Node): boolean {
    let n: Node | Folder | null = node;
    while (n && n !== this.root) {
      if (n.locked) return true;
      n = n.parent;
    }
    return false;
  }

  dispose(): void {
    for (const l of this.allLayers()) l.surface.dispose();
    this.selection?.dispose();
  }
}
