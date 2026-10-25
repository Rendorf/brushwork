import { useEffect, useRef } from 'react';
import { gradientLut } from '../engine/tools/gradientTool';
import { currentRGB, rgbToHex, setSettings, type GradientStop } from '../store/settings';
import { Dialog, Icon, IconButton, Slider, Toggle } from './components';
import { useSettings } from './hooks';

export const GRADIENT_PRESETS: { name: string; stops: GradientStop[] }[] = [
  { name: 'Color → Transparent', stops: [{ t: 0, color: 'fg', a: 1 }, { t: 1, color: 'fg', a: 0 }] },
  { name: 'Color → White', stops: [{ t: 0, color: 'fg', a: 1 }, { t: 1, color: '#ffffff', a: 1 }] },
  { name: 'Color → Black', stops: [{ t: 0, color: 'fg', a: 1 }, { t: 1, color: '#000000', a: 1 }] },
  {
    name: 'Rainbow',
    stops: ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#007aff', '#af52de'].map((c, i, a) => ({ t: i / (a.length - 1), color: c, a: 1 })),
  },
  { name: 'Sunset', stops: [{ t: 0, color: '#2b1055', a: 1 }, { t: 0.5, color: '#d53369', a: 1 }, { t: 1, color: '#ffcc70', a: 1 }] },
  { name: 'Sky', stops: [{ t: 0, color: '#0b3d91', a: 1 }, { t: 0.6, color: '#4fa3e0', a: 1 }, { t: 1, color: '#e8f4ff', a: 1 }] },
  { name: 'Glow', stops: [{ t: 0, color: '#ffffff', a: 1 }, { t: 0.25, color: 'fg', a: 1 }, { t: 1, color: 'fg', a: 0 }] },
];

/** Gradient strip drawn over a checkerboard. */
export function GradientBar({ stops, reverse, onClick }: { stops: GradientStop[]; reverse: boolean; onClick?: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const color = useSettings((s) => s.color);
  useEffect(() => {
    const lut = gradientLut(stops, currentRGB(), reverse);
    const c = ref.current!;
    c.width = 256;
    c.height = 1;
    const img = new ImageData(256, 1);
    for (let i = 0; i < 256; i++) {
      const a = lut[i * 4 + 3];
      img.data[i * 4] = a ? (lut[i * 4] * 255) / a : 0;
      img.data[i * 4 + 1] = a ? (lut[i * 4 + 1] * 255) / a : 0;
      img.data[i * 4 + 2] = a ? (lut[i * 4 + 2] * 255) / a : 0;
      img.data[i * 4 + 3] = a;
    }
    c.getContext('2d')!.putImageData(img, 0, 0);
  }, [stops, reverse, color]);
  return (
    <button className="gradient-bar" onClick={onClick} title="Edit gradient" aria-label="Edit gradient" disabled={!onClick}>
      <canvas ref={ref} />
    </button>
  );
}

export function GradientEditor({ onClose }: { onClose: () => void }) {
  const g = useSettings((s) => s.gradient);
  const set = (patch: Partial<typeof g>) => setSettings((s) => ({ gradient: { ...s.gradient, ...patch } }));
  const setStop = (i: number, patch: Partial<GradientStop>) => set({ stops: g.stops.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const fgHex = rgbToHex(...currentRGB());
  return (
    <Dialog title="Gradient" onClose={onClose}>
      <GradientBar stops={g.stops} reverse={g.reverse} />
      <div className="section-title">Presets</div>
      <div className="gradient-presets">
        {GRADIENT_PRESETS.map((p) => (
          <button key={p.name} className="gradient-preset" onClick={() => set({ stops: p.stops.map((s) => ({ ...s })) })}>
            <GradientBar stops={p.stops} reverse={false} />
            <span>{p.name}</span>
          </button>
        ))}
      </div>
      <div className="section-title">
        <span>Color stops</span>
        <button className="text-btn" onClick={() => set({ stops: [...g.stops, { t: 0.5, color: fgHex, a: 1 }] })}>
          <Icon name="plus" size={16} /> Add stop
        </button>
      </div>
      {g.stops.map((s, i) => (
        <div key={i} className="stop-row">
          <label className="stop-color" style={{ background: s.color === 'fg' ? fgHex : s.color }} title="Stop color">
            <input type="color" value={s.color === 'fg' ? fgHex : s.color} onChange={(e) => setStop(i, { color: e.target.value })} aria-label="Stop color" />
          </label>
          <div className="stop-sliders">
            <Slider label="Position" value={s.t * 100} min={0} max={100} step={1} format={(v) => `${Math.round(v)}%`} onChange={(v) => setStop(i, { t: v / 100 })} />
            <Slider label="Opacity" value={s.a * 100} min={0} max={100} step={1} format={(v) => `${Math.round(v)}%`} onChange={(v) => setStop(i, { a: v / 100 })} />
          </div>
          <div className="stop-actions">
            <button className={`chip ${s.color === 'fg' ? 'on' : ''}`} onClick={() => setStop(i, { color: s.color === 'fg' ? fgHex : 'fg' })} title="Follow the current brush color">
              Current
            </button>
            <IconButton icon="trash" label="Remove stop" size={18} disabled={g.stops.length <= 2} onClick={() => set({ stops: g.stops.filter((_, j) => j !== i) })} />
          </div>
        </div>
      ))}
      <Toggle label="Reverse" value={g.reverse} onChange={(v) => set({ reverse: v })} />
      <Slider label="Opacity" value={g.opacity * 100} min={1} max={100} step={1} format={(v) => `${Math.round(v)}%`} onChange={(v) => set({ opacity: v / 100 })} />
      <p className="hint">“Current” stops follow whatever color is selected when you draw the gradient.</p>
    </Dialog>
  );
}
