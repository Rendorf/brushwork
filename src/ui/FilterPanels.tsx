import { useReducer } from 'react';
import { FILTER_MAP, FILTERS } from '../engine/filters';
import { defaults, FILTER_CATEGORIES, type Curves, type FilterDef, type Param, type Values } from '../engine/filters/types';
import { currentRGB, getSettings, rgbToHex, setSettings, settingsStore, type GradientStop } from '../store/settings';
import { Icon, IconButton, Panel, Segmented, Slider, Toggle } from './components';
import { CurvesEditor } from './CurvesEditor';
import { GradientBar, GRADIENT_PRESETS } from './GradientEditor';
import { useEditor, useSettings } from './hooks';

function startFilter(ed: ReturnType<typeof useEditor>, def: FilterDef): boolean {
  const saved = (getSettings().filterValues[def.id] ?? {}) as Values;
  return !!ed.startFilter(def, { ...defaults(def), ...saved });
}

/** Every filter, by category, plus the recently used ones. */
export function FilterList({ onClose }: { onClose: () => void }) {
  const ed = useEditor();
  const recent = useSettings((s) => s.recentFilters);
  const open = (def: FilterDef) => {
    if (startFilter(ed, def)) onClose();
  };
  const item = (def: FilterDef) => (
    <button key={def.id} className="filter-item" onClick={() => open(def)}>
      {def.name}
    </button>
  );
  const recentDefs = recent.map((id) => FILTER_MAP.get(id)).filter((d): d is FilterDef => !!d);
  return (
    <Panel title="Filters" onClose={onClose} className="filter-list">
      {recentDefs.length > 0 && (
        <>
          <div className="section-title">Recent</div>
          <div className="filter-grid">{recentDefs.map(item)}</div>
        </>
      )}
      {FILTER_CATEGORIES.map((cat) => (
        <div key={cat}>
          <div className="section-title">{cat}</div>
          <div className="filter-grid">{FILTERS.filter((f) => f.category === cat).map(item)}</div>
        </div>
      ))}
    </Panel>
  );
}

function ColorParam({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const fgHex = rgbToHex(...currentRGB());
  const hex = value === 'fg' ? fgHex : value;
  return (
    <span className="color-param">
      <button className={`chip ${value === 'fg' ? 'on' : ''}`} onClick={() => onChange(value === 'fg' ? fgHex : 'fg')} title="Use the current brush color">
        Current
      </button>
      <label className="stop-color" style={{ background: hex }}>
        <input type="color" value={hex} onChange={(e) => onChange(e.target.value)} aria-label="Pick a color" />
      </label>
    </span>
  );
}

function GradientParam({ value, onChange }: { value: GradientStop[]; onChange: (v: GradientStop[]) => void }) {
  return (
    <div className="gradient-param">
      <GradientBar stops={value} reverse={false} />
      <div className="gradient-presets">
        {GRADIENT_PRESETS.map((p) => (
          <button key={p.name} className="gradient-preset" onClick={() => onChange(p.stops.map((s) => ({ ...s })))}>
            <GradientBar stops={p.stops} reverse={false} />
            <span>{p.name}</span>
          </button>
        ))}
        <button className="gradient-preset" onClick={() => onChange(settingsStore.getState().gradient.stops.map((s) => ({ ...s })))}>
          <GradientBar stops={settingsStore.getState().gradient.stops} reverse={false} />
          <span>Gradient tool's</span>
        </button>
      </div>
    </div>
  );
}

function ParamControl({ p, v, set }: { p: Param; v: Values; set: (k: string, val: unknown) => void }) {
  switch (p.type) {
    case 'range':
      return (
        <Slider
          label={p.label}
          value={Number(v[p.key])}
          min={p.min}
          max={p.max}
          step={p.step}
          format={(x) => `${Number.isInteger(p.step ?? 1) ? Math.round(x) : x.toFixed(1)}${p.unit ?? ''}`}
          onChange={(x) => set(p.key, x)}
        />
      );
    case 'toggle':
      return <Toggle label={p.label} value={Boolean(v[p.key])} onChange={(x) => set(p.key, x)} />;
    case 'select':
      return (
        <div className="field">
          <span>{p.label}</span>
          <Segmented value={String(v[p.key])} options={p.options} onChange={(x) => set(p.key, x)} />
        </div>
      );
    case 'color':
      return (
        <div className="field">
          <span>{p.label}</span>
          <ColorParam value={String(v[p.key])} onChange={(x) => set(p.key, x)} />
        </div>
      );
    case 'point': {
      const [x, y] = v[p.key] as [number, number];
      return (
        <>
          <div className="section-title">{p.label}</div>
          <Slider label="Horizontal" value={x * 100} min={0} max={100} step={1} format={(n) => `${Math.round(n)}%`} onChange={(n) => set(p.key, [n / 100, y])} />
          <Slider label="Vertical" value={y * 100} min={0} max={100} step={1} format={(n) => `${Math.round(n)}%`} onChange={(n) => set(p.key, [x, n / 100])} />
        </>
      );
    }
    case 'curves':
      return <CurvesEditor value={v[p.key] as Curves} onChange={(c) => set(p.key, c)} />;
    case 'gradient':
      return <GradientParam value={v[p.key] as GradientStop[]} onChange={(g) => set(p.key, g)} />;
  }
}

/** Parameters, live preview, effect amount and Apply / Cancel for the open filter. */
export function FilterDialog() {
  const ed = useEditor();
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const s = ed.filter;
  if (!s) return null;
  const def = s.def;
  const v = s.values;
  const set = (k: string, val: unknown) => {
    s.set({ ...v, [k]: val as Values[string] });
    rerender();
  };
  const apply = () => {
    setSettings((st) => ({
      filterValues: { ...st.filterValues, [def.id]: s.values },
      recentFilters: [def.id, ...st.recentFilters.filter((id) => id !== def.id)].slice(0, 6),
    }));
    s.apply();
  };
  const where = `${s.layer.name}${ed.doc.selection ? ' · inside the selection' : ''}`;
  return (
    <Panel
      title={def.name}
      onClose={() => s.cancel()}
      className="filter-dialog"
      actions={
        <IconButton
          icon="rotate"
          label="Reset to defaults"
          size={18}
          onClick={() => {
            s.set(defaults(def));
            rerender();
          }}
        />
      }
    >
      <p className="hint">Applying to {where}</p>
      {s.error && <p className="error-text">{s.error.split('\n')[0]}</p>}
      {def.params.map((p) => (
        <ParamControl key={p.key} p={p} v={v} set={set} />
      ))}
      {def.params.length === 0 && <p className="hint">This filter has no settings.</p>}
      <div className="section-title">Mix</div>
      <Slider
        label="Effect amount"
        value={s.amount * 100}
        min={0}
        max={100}
        step={1}
        format={(x) => `${Math.round(x)}%`}
        onChange={(x) => {
          s.set(s.values, x / 100);
          rerender();
        }}
      />
      <div className="filter-actions">
        <button className="btn" onClick={() => s.cancel()}>
          Cancel
        </button>
        <button className="btn primary" onClick={apply}>
          <Icon name="check" size={18} /> Apply
        </button>
      </div>
    </Panel>
  );
}
