// Frame-by-frame animation: every top-level layer or folder is one frame (bottom = first),
// optionally with the bottom-most one used as a background shown under every frame.
import type { Doc, Node } from './document';

export interface AnimationSettings {
  fps: number;
  /** Onion skin: how many frames before / after to show, and how strongly. */
  onionBefore: number;
  onionAfter: number;
  onionOpacity: number;
  /** Use the bottom layer as a background for every frame. */
  background: boolean;
  loop: boolean;
}

export const defaultAnimation = (): AnimationSettings => ({ fps: 8, onionBefore: 1, onionAfter: 0, onionOpacity: 0.35, background: false, loop: true });

/** The frames in playback order. */
export function animationFrames(doc: Doc): Node[] {
  const top = doc.root.children;
  return doc.animation?.background ? top.slice(1) : top.slice();
}

/** Index of the frame containing a node, or -1 (e.g. the background). */
export function frameIndexOf(doc: Doc, node: Node | null): number {
  let n = node;
  while (n && n.parent && n.parent !== doc.root) n = n.parent;
  return n ? animationFrames(doc).indexOf(n) : -1;
}

/** Seconds a frame stays on screen. */
export const frameDuration = (doc: Doc, node: Node) => Math.max(1, node.hold ?? 1) / Math.max(1, doc.animation?.fps ?? 8);
