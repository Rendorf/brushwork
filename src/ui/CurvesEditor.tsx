import { useRef, useState } from 'react';
import { curveTable } from '../engine/filters/curves';
import type { Curves } from '../engine/filters/types';
import { capture, Segmented } from './components';

type Channel = keyof Curves;
const COLORS: Record<Channel, string> = { rgb: '#e8e8ee', r: '#ff5d5d', g: '#4cd964', b: '#4f8cff' };
const S = 220;

/** Drag points to shape the curve; tap to add a point, double-tap a point to remove it. */
export function CurvesEditor({ value, onChange }: { value: Curves; onChange: (c: Curves) => void }) {
  const [ch, setCh] = useState<Channel>('rgb');
  const ref = useRef<SVGSVGElement>(null);
  const drag = useRef<number | null>(null);
  const pts = value[ch];

  const local = (e: React.PointerEvent | React.MouseEvent): [number, number] => {
    const r = ref.current!.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height))];
  };
  const nearest = (p: [number, number]) => {
    let best = -1, bd = 14 / S;
    pts.forEach((q, i) => {
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  };
  const setPts = (next: [number, number][]) => onChange({ ...value, [ch]: next });

  const table = curveTable(pts);
  const path = Array.from({ length: 65 }, (_, i) => {
    const x = i / 64;
    return `${x * S},${(1 - table[Math.round(x * 255)]) * S}`;
  }).join(' ');

  return (
    <div className="curves">
      <Segmented
        value={ch}
        onChange={setCh}
        options={[
          { value: 'rgb', label: 'RGB' },
          { value: 'r', label: 'Red' },
          { value: 'g', label: 'Green' },
          { value: 'b', label: 'Blue' },
        ]}
      />
      <svg
        ref={ref}
        className="curves-box"
        viewBox={`0 0 ${S} ${S}`}
        onPointerDown={(e) => {
          capture(e.currentTarget, e.pointerId);
          const p = local(e);
          let i = nearest(p);
          if (i < 0) {
            const next = [...pts, p].sort((a, b) => a[0] - b[0]) as [number, number][];
            i = next.indexOf(p);
            setPts(next);
          }
          drag.current = i;
        }}
        onPointerMove={(e) => {
          const i = drag.current;
          if (i === null) return;
          const p = local(e);
          const next = pts.map((q) => [...q]) as [number, number][];
          const lo = i > 0 ? next[i - 1][0] + 0.01 : 0;
          const hi = i < next.length - 1 ? next[i + 1][0] - 0.01 : 1;
          next[i] = [i === 0 ? 0 : i === next.length - 1 ? 1 : Math.min(hi, Math.max(lo, p[0])), p[1]];
          setPts(next);
        }}
        onPointerUp={() => (drag.current = null)}
        onDoubleClick={(e) => {
          const i = nearest(local(e));
          if (i > 0 && i < pts.length - 1) setPts(pts.filter((_, j) => j !== i));
        }}
      >
        {[0.25, 0.5, 0.75].map((t) => (
          <g key={t} className="curves-grid">
            <line x1={t * S} y1={0} x2={t * S} y2={S} />
            <line x1={0} y1={t * S} x2={S} y2={t * S} />
          </g>
        ))}
        <line className="curves-ref" x1={0} y1={S} x2={S} y2={0} />
        <polyline points={path} fill="none" stroke={COLORS[ch]} strokeWidth={2} />
        {pts.map((p, i) => (
          <circle key={i} cx={p[0] * S} cy={(1 - p[1]) * S} r={5} fill="#fff" stroke={COLORS[ch]} strokeWidth={2} />
        ))}
      </svg>
      <p className="hint">Tap to add a point, drag to shape, double-tap a point to remove it.</p>
    </div>
  );
}
