import type { Editor } from '../editor';
import type { Guides, P, Symmetry } from '../guides';
import { drawHandle, GUIDE_COLORS } from '../guidesOverlay';
import type { Tool, ToolPointer } from './tool';

interface Handle {
  pos: P;
  color: string;
  kind: 'point' | 'rotate';
  /** Returns the updated guides for a drag to document point p (delta = movement since last). */
  set: (p: P, delta: P) => Partial<Guides>;
}

const HIT = 22;

/** Places and edits rulers, perspective vanishing points and symmetry guides. */
export class RulerTool implements Tool {
  readonly id = 'ruler' as const;
  private drag: { h: Handle; last: P } | null = null;

  constructor(private ed: Editor) {}

  handles(): Handle[] {
    const g = this.ed.doc.guides;
    const out: Handle[] = [];
    const r = g.ruler;
    const C = GUIDE_COLORS.ruler;
    if (r?.kind === 'line') {
      out.push({ pos: r.a, color: C, kind: 'point', set: (p) => ({ ruler: { ...r, a: p } }) });
      out.push({ pos: r.b, color: C, kind: 'point', set: (p) => ({ ruler: { ...r, b: p } }) });
      out.push({
        pos: { x: (r.a.x + r.b.x) / 2, y: (r.a.y + r.b.y) / 2 },
        color: C,
        kind: 'rotate',
        set: (_p, d) => {
          const cur = this.ed.doc.guides.ruler as typeof r;
          return { ruler: { ...cur, a: { x: cur.a.x + d.x, y: cur.a.y + d.y }, b: { x: cur.b.x + d.x, y: cur.b.y + d.y } } };
        },
      });
    } else if (r?.kind === 'ellipse') {
      const c = Math.cos(r.rot), s = Math.sin(r.rot);
      out.push({ pos: r.c, color: C, kind: 'rotate', set: (p) => ({ ruler: { ...(this.ed.doc.guides.ruler as typeof r), c: p } }) });
      out.push({
        pos: { x: r.c.x + c * r.rx, y: r.c.y + s * r.rx },
        color: C,
        kind: 'point',
        set: (p) => {
          const cur = this.ed.doc.guides.ruler as typeof r;
          const rx = Math.max(2, Math.hypot(p.x - cur.c.x, p.y - cur.c.y));
          return { ruler: { ...cur, rx, ry: cur.circle ? rx : cur.ry, rot: Math.atan2(p.y - cur.c.y, p.x - cur.c.x) } };
        },
      });
      out.push({
        pos: { x: r.c.x - s * r.ry, y: r.c.y + c * r.ry },
        color: C,
        kind: 'point',
        set: (p) => {
          const cur = this.ed.doc.guides.ruler as typeof r;
          const ry = Math.max(2, Math.abs(-(p.x - cur.c.x) * Math.sin(cur.rot) + (p.y - cur.c.y) * Math.cos(cur.rot)));
          return { ruler: { ...cur, ry, rx: cur.circle ? ry : cur.rx } };
        },
      });
    } else if (r?.kind === 'radial') {
      out.push({ pos: r.c, color: C, kind: 'point', set: (p) => ({ ruler: { ...r, c: p } }) });
    } else if (r?.kind === 'perspective') {
      r.vps.forEach((vp, i) =>
        out.push({
          pos: vp,
          color: C,
          kind: 'point',
          set: (p) => {
            const cur = this.ed.doc.guides.ruler as typeof r;
            const vps = cur.vps.map((v, j) => (j === i ? p : v));
            return { ruler: { ...cur, vps } };
          },
        }),
      );
    }
    const s = g.symmetry;
    if (s) {
      const L = 90 / this.ed.viewport.zoom;
      const SC = GUIDE_COLORS.symmetry;
      out.push({ pos: s.c, color: SC, kind: 'point', set: (p) => ({ symmetry: { ...(this.ed.doc.guides.symmetry as Symmetry), c: p } }) });
      out.push({
        pos: { x: s.c.x + Math.cos(s.angle) * L, y: s.c.y + Math.sin(s.angle) * L },
        color: SC,
        kind: 'rotate',
        set: (p) => {
          const cur = this.ed.doc.guides.symmetry as Symmetry;
          let angle = Math.atan2(p.y - cur.c.y, p.x - cur.c.x);
          const step = Math.PI / 12;
          const q = Math.round(angle / step) * step;
          if (Math.abs(angle - q) < 0.05) angle = q;
          return { symmetry: { ...cur, angle } };
        },
      });
    }
    return out;
  }

  down(e: ToolPointer): void {
    const v = this.ed.viewport;
    let best: Handle | null = null;
    let bd = HIT;
    for (const h of this.handles()) {
      const s = v.toScreen(h.pos.x, h.pos.y);
      const d = Math.hypot(s.x - e.sx, s.y - e.sy);
      if (d < bd) {
        bd = d;
        best = h;
      }
    }
    this.drag = best ? { h: best, last: { x: e.x, y: e.y } } : null;
  }

  move(events: ToolPointer[]): void {
    const d = this.drag;
    if (!d) return;
    const e = events[events.length - 1];
    const p = { x: e.x, y: e.y };
    const patch = d.h.set(p, { x: p.x - d.last.x, y: p.y - d.last.y });
    d.last = p;
    this.ed.setGuides(patch, false);
  }

  up(): void {
    if (this.drag) this.ed.setGuides({}, true);
    this.drag = null;
  }

  cancel(): void {
    this.drag = null;
  }

  overlay(ctx: CanvasRenderingContext2D): void {
    const v = this.ed.viewport;
    for (const h of this.handles()) {
      const s = v.toScreen(h.pos.x, h.pos.y);
      drawHandle(ctx, s.x, s.y, h.color, h.kind);
    }
  }
}
