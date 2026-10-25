import { useRef, useState } from 'react';
import { hsvToRgb } from '../engine/brush/stroke';
import { hexToRgb, rgbToHex, setColorRGB, setSettings, settingsStore } from '../store/settings';
import { Icon, IconButton, Panel, Segmented, Slider } from './components';
import { useSettings } from './hooks';

const RING = 232;
const RING_W = 22;

function setHSV(h: number, s: number, v: number) {
  setSettings({ color: { h, s, v } });
}

function ColorWheel() {
  const { h, s, v } = useSettings((st) => st.color);
  const ref = useRef<HTMLDivElement>(null);
  const mode = useRef<'ring' | 'square' | null>(null);
  const inner = (RING - RING_W * 2) * 0.68;

  const handle = (e: React.PointerEvent, start = false) => {
    const r = ref.current!.getBoundingClientRect();
    const x = e.clientX - r.left - RING / 2;
    const y = e.clientY - r.top - RING / 2;
    if (start) {
      const d = Math.hypot(x, y);
      mode.current = d > RING / 2 - RING_W - 4 ? 'ring' : Math.abs(x) <= inner / 2 + 6 && Math.abs(y) <= inner / 2 + 6 ? 'square' : null;
    }
    const cur = settingsStore.getState().color;
    if (mode.current === 'ring') {
      let a = Math.atan2(y, x) / (Math.PI * 2) + 0.25;
      if (a < 0) a += 1;
      setHSV(a % 1, cur.s, cur.v);
    } else if (mode.current === 'square') {
      const sx = Math.min(1, Math.max(0, x / inner + 0.5));
      const sy = Math.min(1, Math.max(0, 0.5 - y / inner));
      setHSV(cur.h, sx, sy);
    }
  };

  const [hr, hg, hb] = hsvToRgb(h, 1, 1);
  const ha = h * Math.PI * 2 - Math.PI / 2;
  const rr = RING / 2 - RING_W / 2;
  return (
    <div
      className="wheel"
      ref={ref}
      style={{ width: RING, height: RING }}
      onPointerDown={(e) => {
        (e.target as Element).setPointerCapture?.(e.pointerId);
        handle(e, true);
      }}
      onPointerMove={(e) => e.buttons && handle(e)}
      onPointerUp={() => (mode.current = null)}
    >
      <div className="wheel-ring" style={{ ['--w' as string]: `${RING_W}px` }} />
      <div
        className="wheel-square"
        style={{
          width: inner,
          height: inner,
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, rgb(${hr * 255},${hg * 255},${hb * 255}))`,
        }}
      />
      <div className="wheel-knob" style={{ left: RING / 2 + Math.cos(ha) * rr, top: RING / 2 + Math.sin(ha) * rr }} />
      <div className="wheel-knob" style={{ left: RING / 2 + (s - 0.5) * inner, top: RING / 2 + (0.5 - v) * inner }} />
    </div>
  );
}

export function ColorPanel({ onClose }: { onClose: () => void }) {
  const color = useSettings((s) => s.color);
  const history = useSettings((s) => s.colorHistory);
  const palettes = useSettings((s) => s.palettes);
  const [tab, setTab] = useState<'hsb' | 'rgb'>('hsb');
  const [r, g, b] = hsvToRgb(color.h, color.s, color.v);
  const hex = rgbToHex(r, g, b);
  const [hexText, setHexText] = useState<string | null>(null);

  const swatch = (c: string, key: string, onRemove?: () => void) => (
    <button
      key={key}
      className={`swatch ${c.toLowerCase() === hex ? 'on' : ''}`}
      style={{ background: c }}
      title={c}
      onClick={() => {
        const rgb = hexToRgb(c);
        if (rgb) setColorRGB(...rgb);
      }}
      onContextMenu={(e) => {
        if (!onRemove) return;
        e.preventDefault();
        onRemove();
      }}
    />
  );

  const editPalettes = (fn: (p: { name: string; colors: string[] }[]) => { name: string; colors: string[] }[]) =>
    setSettings((s) => ({ palettes: fn(s.palettes.map((p) => ({ ...p, colors: [...p.colors] }))) }));

  return (
    <Panel title="Color" onClose={onClose} className="color-panel">
      <div className="color-top">
        <ColorWheel />
        <div className="color-current" style={{ background: hex }} />
      </div>
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'hsb', label: 'HSB' },
          { value: 'rgb', label: 'RGB' },
        ]}
      />
      {tab === 'hsb' ? (
        <>
          <Slider label="Hue" value={color.h * 360} min={0} max={360} step={1} format={(v) => `${Math.round(v)}°`} onChange={(v) => setHSV(v / 360, color.s, color.v)} className="hue-slider" />
          <Slider label="Saturation" value={color.s * 100} min={0} max={100} step={1} format={(v) => `${Math.round(v)}%`} onChange={(v) => setHSV(color.h, v / 100, color.v)} />
          <Slider label="Brightness" value={color.v * 100} min={0} max={100} step={1} format={(v) => `${Math.round(v)}%`} onChange={(v) => setHSV(color.h, color.s, v / 100)} />
        </>
      ) : (
        <>
          <Slider label="Red" value={r * 255} min={0} max={255} step={1} onChange={(v) => setColorRGB(v / 255, g, b)} />
          <Slider label="Green" value={g * 255} min={0} max={255} step={1} onChange={(v) => setColorRGB(r, v / 255, b)} />
          <Slider label="Blue" value={b * 255} min={0} max={255} step={1} onChange={(v) => setColorRGB(r, g, v / 255)} />
        </>
      )}
      <label className="field">
        <span>Hex</span>
        <span className="field-input">
          <input
            value={hexText ?? hex}
            onChange={(e) => setHexText(e.target.value)}
            onBlur={() => {
              const c = hexText && hexToRgb(hexText);
              if (c) setColorRGB(...c);
              setHexText(null);
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            spellCheck={false}
          />
        </span>
      </label>
      {history.length > 0 && (
        <>
          <div className="section-title">Recent</div>
          <div className="swatches">{history.map((c, i) => swatch(c, `h${i}`))}</div>
        </>
      )}
      {palettes.map((p, pi) => (
        <div key={pi}>
          <div className="section-title">
            <span>{p.name}</span>
            <span className="section-actions">
              <IconButton
                icon="plus"
                label="Add current color"
                size={16}
                onClick={() => editPalettes((ps) => (ps[pi].colors.includes(hex) ? ps : (ps[pi].colors.push(hex), ps)))}
              />
              <IconButton icon="trash" label="Delete palette" size={16} onClick={() => confirm(`Delete palette "${p.name}"?`) && editPalettes((ps) => ps.filter((_, i) => i !== pi))} />
            </span>
          </div>
          <div className="swatches">
            {p.colors.map((c, ci) => swatch(c, `p${pi}-${ci}`, () => editPalettes((ps) => (ps[pi].colors.splice(ci, 1), ps))))}
          </div>
        </div>
      ))}
      <button
        className="text-btn"
        onClick={() => {
          const name = prompt('Palette name', `Palette ${palettes.length + 1}`);
          if (name) editPalettes((ps) => [...ps, { name, colors: [hex] }]);
        }}
      >
        <Icon name="plus" size={16} /> New palette
      </button>
      <p className="hint">Tip: right-click (or long-press) a palette swatch to remove it.</p>
    </Panel>
  );
}
