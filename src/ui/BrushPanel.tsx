import { useEffect, useRef, useState } from 'react';
import { BLEND_MODES, type BlendMode } from '../engine/blendModes';
import { brushFromImage, deleteBrush, duplicateBrush, exportBrushes, importBrushFile, renameBrush } from '../engine/brush/brushIO';
import { customTip, isCustomTip } from '../engine/brush/customTips';
import { allBrushes, getBrush } from '../engine/brush/library';
import { CATEGORIES, type BrushParams, type TipRef } from '../engine/brush/presets';
import { makeTip, TIP_IDS, type TipId } from '../engine/brush/tips';
import { decodeImage, deliverFile, safeFileName } from '../engine/io/files';
import { toolBrush } from '../engine/tools/brushTool';
import { isBrushTool, setSettings, updateBrushTool, type BrushToolId } from '../store/settings';
import { Icon, Panel, Segmented, Slider, Toggle } from './components';
import { useEditor, useSettings } from './hooks';

const tipCache = new Map<TipRef, ImageData>();

function TipPreview({ tip }: { tip: TipRef }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let img = tipCache.get(tip);
    if (!img) {
      const m = (isCustomTip(tip) ? customTip(tip) : null) ?? makeTip(isCustomTip(tip) ? 'round' : (tip as TipId));
      img = new ImageData(m.w, m.h);
      for (let i = 0; i < m.data.length; i++) {
        img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 235;
        img.data[i * 4 + 3] = m.data[i];
      }
      tipCache.set(tip, img);
    }
    const c = ref.current!;
    c.width = img.width;
    c.height = img.height;
    c.getContext('2d')!.putImageData(img, 0, 0);
  }, [tip]);
  return <canvas className="tip-preview" ref={ref} />;
}

const TIP_LABELS: Record<TipId, string> = {
  round: 'Round', chalk: 'Chalk', pencil: 'Pencil', flat: 'Flat', bristle: 'Bristle', splatter: 'Splatter',
  star: 'Star', heart: 'Heart', leaf: 'Leaf', sparkle: 'Sparkle', cloud: 'Cloud', square: 'Square',
};

export function BrushPanel({ onClose }: { onClose: () => void }) {
  const ed = useEditor();
  const tool = useSettings((s) => s.tool);
  const bt: BrushToolId = isBrushTool(tool) ? tool : 'brush';
  const ts = useSettings((s) => s.brushTools[bt]);
  const stabilizer = useSettings((s) => s.stabilizer);
  const stabMode = useSettings((s) => s.stabilizerMode);
  const custom = useSettings((s) => s.customBrushes);
  const brush = toolBrush(bt);
  const preset = getBrush(ts.presetId);
  const isCustom = preset.category === 'Custom';
  const imageRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const set = (patch: Partial<BrushParams>) => {
    updateBrushTool(bt, { overrides: { ...ts.overrides, [preset.id]: { ...(ts.overrides[preset.id] ?? {}), ...patch } } });
  };
  const reset = () => {
    const o = { ...ts.overrides };
    delete o[preset.id];
    updateBrushTool(bt, { overrides: o, size: preset.size });
  };
  const choose = (p: BrushParams) => updateBrushTool(bt, { presetId: p.id, size: p.size });
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      ed.toast((e as Error).message || 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  const title = { brush: 'Brush', eraser: 'Eraser', smudge: 'Smudge', blur: 'Blur' }[bt];
  const modified = !!ts.overrides[preset.id];
  const pct = (v: number) => `${Math.round(v)}%`;
  const brushes = allBrushes();
  const customTips = [...new Set(custom.map((b) => b.tip).filter(isCustomTip))];

  return (
    <Panel title={`${title} — ${preset.name}`} onClose={onClose} className="brush-panel">
      <input
        ref={imageRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) run(async () => choose(await brushFromImage(await decodeImage(f), f.name.replace(/\.[^.]+$/, ''), brush)));
        }}
      />
      <input
        ref={importRef}
        type="file"
        accept=".bwbrush,.abr,.json,application/json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f)
            run(async () => {
              const added = await importBrushFile(f);
              choose(added[0]);
              ed.toast(`Imported ${added.length} brush${added.length === 1 ? '' : 'es'}.`);
            });
        }}
      />
      <div className="brush-actions">
        <button className="chip" disabled={busy} onClick={() => imageRef.current?.click()}>
          <Icon name="image" size={16} /> From image
        </button>
        <button className="chip" disabled={busy} onClick={() => choose(duplicateBrush(brush))}>
          <Icon name="copy" size={16} /> Duplicate
        </button>
        <button className="chip" disabled={busy} onClick={() => importRef.current?.click()}>
          <Icon name="upload" size={16} /> Import
        </button>
        <button className="chip" disabled={busy} onClick={() => run(() => deliverFile(exportBrushes([{ ...brush, size: ts.size }]), `${safeFileName(brush.name)}.bwbrush`))}>
          <Icon name="download" size={16} /> Export
        </button>
      </div>
      <div className="brush-grid-wrap">
        {CATEGORIES.map((cat) => {
          const list = brushes.filter((p) => p.category === cat);
          if (!list.length) return null;
          return (
            <div key={cat}>
              <div className="section-title">
                <span>{cat}</span>
                {cat === 'Custom' && list.length > 1 && (
                  <button className="text-btn" onClick={() => run(() => deliverFile(exportBrushes(list), 'my-brushes.bwbrush'))}>
                    Export all
                  </button>
                )}
              </div>
              <div className="brush-grid">
                {list.map((p) => (
                  <button key={p.id} className={`brush-item ${p.id === preset.id ? 'on' : ''}`} onClick={() => choose(p)} title={p.name}>
                    <TipPreview tip={p.tip} />
                    <span>{p.name}</span>
                    {ts.overrides[p.id] && <em className="dot" />}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {isCustom && (
        <div className="brush-actions">
          <button
            className="chip"
            onClick={() => {
              const n = prompt('Brush name', preset.name);
              if (n && n.trim()) renameBrush(preset.id, n.trim());
            }}
          >
            Rename
          </button>
          <button className="chip" onClick={() => confirm(`Delete the brush "${preset.name}"?`) && run(() => deleteBrush(preset.id))}>
            <Icon name="trash" size={16} /> Delete
          </button>
        </div>
      )}

      <div className="section-title">
        <span>Settings</span>
        {modified && (
          <button className="text-btn" onClick={reset}>
            Reset
          </button>
        )}
      </div>
      <label className="field">
        <span>Tip</span>
        <select value={brush.tip} onChange={(e) => set({ tip: e.target.value as TipRef })}>
          {TIP_IDS.map((t) => (
            <option key={t} value={t}>
              {TIP_LABELS[t]}
            </option>
          ))}
          {customTips.map((t, i) => (
            <option key={t} value={t}>
              {`Custom ${i + 1}`}
            </option>
          ))}
        </select>
      </label>
      <Slider label="Stabilizer" value={stabilizer} min={0} max={100} step={1} onChange={(v) => setSettings({ stabilizer: v })} />
      <Segmented
        value={stabMode}
        onChange={(v) => setSettings({ stabilizerMode: v })}
        options={[
          { value: 'smooth', label: 'Smooth' },
          { value: 'rope', label: 'Lazy rope' },
        ]}
      />
      {bt !== 'eraser' && brush.mode === 'paint' && bt === 'brush' && (
        <label className="field">
          <span>Blend mode</span>
          <select value={brush.blendMode} onChange={(e) => set({ blendMode: e.target.value as BlendMode })}>
            {BLEND_MODES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <Slider label="Flow" value={brush.flow * 100} min={1} max={100} step={1} format={pct} onChange={(v) => set({ flow: v / 100 })} />
      {brush.tip === 'round' && <Slider label="Hardness" value={brush.hardness * 100} min={0} max={100} step={1} format={pct} onChange={(v) => set({ hardness: v / 100 })} />}
      <Slider label="Spacing" value={brush.spacing * 100} min={2} max={200} step={1} format={pct} onChange={(v) => set({ spacing: v / 100 })} />
      <Slider label="Size pressure" value={brush.sizePressure * 100} min={0} max={100} step={1} format={pct} onChange={(v) => set({ sizePressure: v / 100 })} />
      <Slider label="Flow pressure" value={brush.flowPressure * 100} min={0} max={100} step={1} format={pct} onChange={(v) => set({ flowPressure: v / 100 })} />
      {(bt === 'smudge' || bt === 'blur' || brush.mode !== 'paint') && (
        <Slider label="Strength" value={brush.strength * 100} min={0} max={100} step={1} format={pct} onChange={(v) => set({ strength: v / 100 })} />
      )}
      <Slider label="Fade in" value={brush.taperIn} min={0} max={10} step={0.1} format={(v) => v.toFixed(1)} onChange={(v) => set({ taperIn: v })} />
      <Slider label="Fade out" value={brush.taperOut} min={0} max={10} step={0.1} format={(v) => v.toFixed(1)} onChange={(v) => set({ taperOut: v })} />
      <Slider label="Angle" value={brush.angle} min={-180} max={180} step={1} format={(v) => `${Math.round(v)}°`} onChange={(v) => set({ angle: v })} />
      <Slider label="Roundness" value={brush.roundness * 100} min={5} max={100} step={1} format={pct} onChange={(v) => set({ roundness: v / 100 })} />
      <Toggle label="Follow stroke direction" value={brush.followDirection} onChange={(v) => set({ followDirection: v })} />
      <Slider label="Angle jitter" value={brush.angleJitter} min={0} max={180} step={1} format={(v) => `${Math.round(v)}°`} onChange={(v) => set({ angleJitter: v })} />
      <Slider label="Scatter" value={brush.scatter * 100} min={0} max={300} step={1} format={pct} onChange={(v) => set({ scatter: v / 100 })} />
      <Slider label="Size jitter" value={brush.sizeJitter * 100} min={0} max={100} step={1} format={pct} onChange={(v) => set({ sizeJitter: v / 100 })} />
      {bt === 'brush' && (
        <>
          <Slider label="Hue jitter" value={brush.hueJitter * 100} min={0} max={50} step={1} format={pct} onChange={(v) => set({ hueJitter: v / 100 })} />
          <Slider label="Brightness jitter" value={brush.valJitter * 100} min={0} max={50} step={1} format={pct} onChange={(v) => set({ valJitter: v / 100 })} />
          <Slider label="Wet edges" value={brush.wetEdge * 100} min={0} max={100} step={1} format={pct} onChange={(v) => set({ wetEdge: v / 100 })} />
          <Toggle label="Build up within a stroke" value={brush.accumulate === 'over'} onChange={(v) => set({ accumulate: v ? 'over' : 'max' })} />
        </>
      )}
      <label className="field">
        <span>Paper texture</span>
        <select value={brush.grain ?? ''} onChange={(e) => set({ grain: (e.target.value || null) as BrushParams['grain'], grainStrength: e.target.value ? Math.max(brush.grainStrength, 0.4) : 0 })}>
          <option value="">None</option>
          <option value="paper">Paper</option>
          <option value="canvas">Canvas</option>
          <option value="rough">Rough</option>
        </select>
      </label>
      {brush.grain && (
        <>
          <Slider label="Texture strength" value={brush.grainStrength * 100} min={0} max={100} step={1} format={pct} onChange={(v) => set({ grainStrength: v / 100 })} />
          <Slider label="Texture scale" value={brush.grainScale} min={32} max={1024} step={1} log onChange={(v) => set({ grainScale: v })} />
        </>
      )}
    </Panel>
  );
}
