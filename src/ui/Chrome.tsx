import { hsvToRgb } from '../engine/brush/stroke';
import { getPreset } from '../engine/brush/presets';
import type { TransformTool } from '../engine/tools/transformTool';
import { isBrushTool, setSettings, updateBrushTool, type ToolId } from '../store/settings';
import { Icon, IconButton, Segmented, Slider, Toggle } from './components';
import { useEditor, useSettings } from './hooks';

export type PanelId = 'tools' | 'brush' | 'color' | 'layers' | 'menu' | 'settings' | null;

export const TOOL_LIST: { id: ToolId; label: string; icon: string; key: string }[] = [
  { id: 'brush', label: 'Brush', icon: 'brush', key: 'B' },
  { id: 'eraser', label: 'Eraser', icon: 'eraser', key: 'E' },
  { id: 'smudge', label: 'Smudge', icon: 'smudge', key: 'J' },
  { id: 'blur', label: 'Blur', icon: 'blur', key: 'K' },
  { id: 'fill', label: 'Fill', icon: 'fill', key: 'G' },
  { id: 'lassoFill', label: 'Lasso Fill', icon: 'lassoFill', key: 'L' },
  { id: 'select', label: 'Selection', icon: 'select', key: 'M' },
  { id: 'transform', label: 'Transform', icon: 'transform', key: 'V' },
  { id: 'eyedropper', label: 'Eyedropper', icon: 'eyedropper', key: 'I' },
  { id: 'hand', label: 'Hand', icon: 'hand', key: 'H' },
];

export function ToolGrid({ onPick }: { onPick: () => void }) {
  const ed = useEditor();
  const tool = useSettings((s) => s.tool);
  return (
    <div className="tool-grid">
      {TOOL_LIST.map((t) => (
        <button
          key={t.id}
          className={`tool-item ${tool === t.id ? 'on' : ''}`}
          onClick={() => {
            ed.setTool(t.id);
            onPick();
          }}
        >
          <Icon name={t.icon} size={26} />
          <span>{t.label}</span>
          <kbd>{t.key}</kbd>
        </button>
      ))}
    </div>
  );
}

export function BottomBar({ panel, setPanel }: { panel: PanelId; setPanel: (p: PanelId) => void }) {
  const ed = useEditor();
  const tool = useSettings((s) => s.tool);
  const color = useSettings((s) => s.color);
  const ts = useSettings((s) => (isBrushTool(s.tool) ? s.brushTools[s.tool] : s.brushTools.brush));
  const toggle = (p: PanelId) => setPanel(panel === p ? null : p);
  const t = TOOL_LIST.find((x) => x.id === tool)!;
  const [r, g, b] = hsvToRgb(color.h, color.s, color.v);
  return (
    <div className="bottom-bar">
      <IconButton icon={t.icon} label={`Tool: ${t.label}`} active={panel === 'tools'} onClick={() => toggle('tools')} />
      <button className={`brush-btn ${panel === 'brush' ? 'active' : ''}`} onClick={() => toggle('brush')} title="Brush settings">
        <span className="brush-size">{Math.round(ts.size)}</span>
        <span className="brush-name">{getPreset(ts.presetId).name}</span>
      </button>
      <IconButton icon="undo" label="Undo" disabled={!ed.history.canUndo} onClick={() => ed.history.undo()} />
      <IconButton icon="redo" label="Redo" disabled={!ed.history.canRedo} onClick={() => ed.history.redo()} />
      <button className={`color-btn ${panel === 'color' ? 'active' : ''}`} onClick={() => toggle('color')} title="Color" aria-label="Color">
        <span style={{ background: `rgb(${r * 255},${g * 255},${b * 255})` }} />
      </button>
      <IconButton icon="layers" label="Layers" active={panel === 'layers'} onClick={() => toggle('layers')}>
        <span className="badge">{ed.doc.allLayers().length}</span>
      </IconButton>
      <IconButton icon="menu" label="Menu" active={panel === 'menu'} onClick={() => toggle('menu')} />
    </div>
  );
}

export function SideSliders({ left }: { left: boolean }) {
  const tool = useSettings((s) => s.tool);
  const ts = useSettings((s) => (isBrushTool(s.tool) ? s.brushTools[s.tool] : null));
  if (!ts || !isBrushTool(tool)) return null;
  return (
    <div className={`side-sliders ${left ? 'left' : 'right'}`}>
      <Slider vertical log value={ts.size} min={1} max={1000} step={0.5} format={(v) => (v < 10 ? v.toFixed(1) : String(Math.round(v)))} onChange={(v) => updateBrushTool(tool, { size: v })} label="Brush size" />
      <Slider vertical value={ts.opacity * 100} min={1} max={100} step={1} format={(v) => `${Math.round(v)}%`} onChange={(v) => updateBrushTool(tool, { opacity: v / 100 })} label="Opacity" />
    </div>
  );
}

/** Options strip for the active tool. */
export function ToolOptions() {
  const ed = useEditor();
  const tool = useSettings((s) => s.tool);
  const fill = useSettings((s) => s.fill);
  const select = useSettings((s) => s.select);
  const lassoMode = useSettings((s) => s.lassoFillMode);
  const eyeSrc = useSettings((s) => s.eyedropperSource);
  const stabilizer = useSettings((s) => s.stabilizer);
  const keepAspect = useSettings((s) => s.transformKeepAspect);
  const hasSel = !!ed.doc.selection;
  const tt = ed.tools.transform as TransformTool;

  let body: React.ReactNode = null;
  if (isBrushTool(tool)) {
    body = (
      <div className="opt-inline">
        <Slider label="Stabilizer" value={stabilizer} min={0} max={100} step={1} onChange={(v) => setSettings({ stabilizer: v })} className="compact" />
      </div>
    );
  } else if (tool === 'fill') {
    body = (
      <>
        <Segmented
          value={fill.source}
          onChange={(v) => setSettings({ fill: { ...fill, source: v } })}
          options={[
            { value: 'canvas', label: 'Canvas' },
            { value: 'layer', label: 'Layer' },
            { value: 'reference', label: 'Reference' },
          ]}
        />
        <Slider label="Tolerance" value={fill.tolerance} min={0} max={100} step={1} onChange={(v) => setSettings({ fill: { ...fill, tolerance: v } })} className="compact" />
        <Slider label="Close gaps" value={fill.gap} min={0} max={20} step={1} onChange={(v) => setSettings({ fill: { ...fill, gap: v } })} className="compact" />
        <Slider label="Expand" value={fill.expand} min={0} max={10} step={1} onChange={(v) => setSettings({ fill: { ...fill, expand: v } })} className="compact" />
        <Toggle label="Anti-alias" value={fill.antialias} onChange={(v) => setSettings({ fill: { ...fill, antialias: v } })} />
      </>
    );
  } else if (tool === 'lassoFill') {
    body = (
      <Segmented
        value={lassoMode}
        onChange={(v) => setSettings({ lassoFillMode: v })}
        options={[
          { value: 'fill', label: 'Fill' },
          { value: 'erase', label: 'Erase' },
        ]}
      />
    );
  } else if (tool === 'select') {
    body = (
      <>
        <Segmented
          value={select.shape}
          onChange={(v) => setSettings({ select: { ...select, shape: v } })}
          options={[
            { value: 'rect', label: 'Rect', icon: 'rect' },
            { value: 'ellipse', label: 'Ellipse', icon: 'ellipse' },
            { value: 'lasso', label: 'Lasso', icon: 'lasso' },
            { value: 'wand', label: 'Wand', icon: 'wand' },
          ]}
        />
        <Segmented
          value={select.op}
          onChange={(v) => setSettings({ select: { ...select, op: v } })}
          options={[
            { value: 'replace', label: 'New' },
            { value: 'add', label: 'Add' },
            { value: 'subtract', label: 'Subtract' },
            { value: 'intersect', label: 'Intersect' },
          ]}
        />
        {select.shape === 'wand' && (
          <>
            <Segmented
              value={select.source}
              onChange={(v) => setSettings({ select: { ...select, source: v } })}
              options={[
                { value: 'canvas', label: 'Canvas' },
                { value: 'layer', label: 'Layer' },
              ]}
            />
            <Slider label="Tolerance" value={select.tolerance} min={0} max={100} step={1} onChange={(v) => setSettings({ select: { ...select, tolerance: v } })} className="compact" />
          </>
        )}
        <button className="chip" onClick={() => ed.selectAll()}>All</button>
        <button className="chip" onClick={() => ed.invertSelection()}>Invert</button>
        <button className="chip" disabled={!hasSel} onClick={() => ed.deselect()}>Deselect</button>
      </>
    );
  } else if (tool === 'transform') {
    body = (
      <>
        <IconButton icon="flipH" label="Flip horizontal" onClick={() => tt.flip('h')} size={20} />
        <IconButton icon="flipV" label="Flip vertical" onClick={() => tt.flip('v')} size={20} />
        <IconButton icon="rotate" label="Rotate 90°" onClick={() => tt.rotate90()} size={20} />
        <IconButton icon="fit" label="Fit to canvas" onClick={() => tt.fitCanvas()} size={20} />
        <Toggle label="Keep ratio" value={keepAspect} onChange={(v) => setSettings({ transformKeepAspect: v })} />
        <button className="chip" onClick={() => tt.reset()}>Reset</button>
        <button className="chip" onClick={() => tt.finish(false)}>Cancel</button>
        <button className="chip primary" onClick={() => tt.finish(true)}>
          <Icon name="check" size={16} /> Done
        </button>
      </>
    );
  } else if (tool === 'eyedropper') {
    body = (
      <Segmented
        value={eyeSrc}
        onChange={(v) => setSettings({ eyedropperSource: v })}
        options={[
          { value: 'canvas', label: 'Canvas' },
          { value: 'layer', label: 'Current layer' },
        ]}
      />
    );
  } else if (tool === 'hand') {
    body = (
      <>
        <button className="chip" onClick={() => { ed.viewport.fit(); ed.requestRender(); }}>Fit</button>
        <button className="chip" onClick={() => { ed.viewport.setZoom(1); ed.requestRender(); }}>100%</button>
        <button className="chip" onClick={() => { ed.viewport.rotateAt(-ed.viewport.rotation, ed.viewport.cssW / 2, ed.viewport.cssH / 2); ed.requestRender(); }}>Reset rotation</button>
      </>
    );
  }
  return <div className="tool-options">{body}</div>;
}
