// Screen-space drawing of rulers, perspective lines, symmetry axes and the grid.
import { symmetryAxes, type Guides, type P } from './guides';
import type { Viewport } from './viewport';

const RULER = '#19d3ff';
const SYMMETRY = '#ff4fd8';

function strokeTwice(ctx: CanvasRenderingContext2D, color: string, alpha: number, width = 1.2) {
  ctx.globalAlpha = alpha * 0.45;
  ctx.lineWidth = width + 2;
  ctx.strokeStyle = '#000';
  ctx.stroke();
  ctx.globalAlpha = alpha;
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

export function drawGuides(ctx: CanvasRenderingContext2D, g: Guides, v: Viewport, docW: number, docH: number): void {
  const far = (v.cssW + v.cssH) * 2;
  const S = (p: P) => v.toScreen(p.x, p.y);
  /** Infinite line (or ray) through doc point p with doc direction angle a. */
  const lineAt = (p: P, a: number, ray = false) => {
    const s = S(p);
    const t = S({ x: p.x + Math.cos(a), y: p.y + Math.sin(a) });
    const dx = t.x - s.x, dy = t.y - s.y;
    const l = Math.hypot(dx, dy) || 1;
    ctx.moveTo(ray ? s.x : s.x - (dx / l) * far, ray ? s.y : s.y - (dy / l) * far);
    ctx.lineTo(s.x + (dx / l) * far, s.y + (dy / l) * far);
  };

  if (g.page && g.pageOn !== false) {
    const quad = (r: { x: number; y: number; w: number; h: number }) => {
      const pts = [S({ x: r.x, y: r.y }), S({ x: r.x + r.w, y: r.y }), S({ x: r.x + r.w, y: r.y + r.h }), S({ x: r.x, y: r.y + r.h })];
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
    };
    // Shade the bleed (outside the trim line).
    ctx.beginPath();
    quad({ x: 0, y: 0, w: docW, h: docH });
    quad(g.page.trim);
    ctx.fillStyle = 'rgba(255, 70, 70, 0.10)';
    ctx.fill('evenodd');
    ctx.beginPath();
    quad(g.page.trim);
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgba(255, 70, 70, 0.85)';
    ctx.stroke();
    if (g.page.safe) {
      ctx.beginPath();
      quad(g.page.safe);
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = 'rgba(0, 170, 255, 0.85)';
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  if (g.gridOn && g.gridSize > 0 && g.gridSize * v.zoom >= 6) {
    ctx.beginPath();
    for (let x = g.gridSize; x < docW; x += g.gridSize) {
      const a = S({ x, y: 0 }), b = S({ x, y: docH });
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    for (let y = g.gridSize; y < docH; y += g.gridSize) {
      const a = S({ x: 0, y }), b = S({ x: docW, y });
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#3d8bff';
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  const r = g.ruler;
  if (r) {
    const alpha = g.rulerOn ? 0.95 : 0.35;
    ctx.beginPath();
    if (r.kind === 'line') {
      lineAt(r.a, Math.atan2(r.b.y - r.a.y, r.b.x - r.a.x));
    } else if (r.kind === 'ellipse') {
      for (let i = 0; i <= 96; i++) {
        const t = (i / 96) * Math.PI * 2;
        const lx = r.rx * Math.cos(t), ly = r.ry * Math.sin(t);
        const p = S({ x: r.c.x + Math.cos(r.rot) * lx - Math.sin(r.rot) * ly, y: r.c.y + Math.sin(r.rot) * lx + Math.cos(r.rot) * ly });
        if (i) ctx.lineTo(p.x, p.y);
        else ctx.moveTo(p.x, p.y);
      }
    } else if (r.kind === 'radial') {
      for (let i = 0; i < 24; i++) lineAt(r.c, (i / 24) * Math.PI * 2, true);
    } else {
      for (const vp of r.vps) for (let i = 0; i < 24; i++) lineAt(vp, (i / 24) * Math.PI * 2, true);
    }
    strokeTwice(ctx, RULER, r.kind === 'radial' || r.kind === 'perspective' ? alpha * 0.45 : alpha);
    if (r.kind === 'perspective') {
      // Horizon line
      ctx.beginPath();
      const [a, b] = r.vps;
      lineAt(a, b ? Math.atan2(b.y - a.y, b.x - a.x) : 0);
      strokeTwice(ctx, RULER, alpha, 1.6);
    }
  }

  const s = g.symmetry;
  if (s) {
    ctx.beginPath();
    for (const ax of symmetryAxes(s)) lineAt(s.c, ax.angle, !ax.full);
    ctx.setLineDash([8, 6]);
    strokeTwice(ctx, SYMMETRY, g.symmetryOn ? 0.9 : 0.3);
    ctx.setLineDash([]);
  }
}

export function drawHandle(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, kind: 'point' | 'rotate' = 'point') {
  ctx.beginPath();
  ctx.arc(x, y, kind === 'rotate' ? 7 : 9, 0, Math.PI * 2);
  ctx.fillStyle = kind === 'rotate' ? color : '#fff';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = kind === 'rotate' ? '#fff' : color;
  ctx.stroke();
}

export const GUIDE_COLORS = { ruler: RULER, symmetry: SYMMETRY };
