import { useState } from 'react';
import { hsvToRgb } from '../engine/brush/stroke';
import { getBrush } from '../engine/brush/library';
import { makeRuler, type Ruler, type SymmetryKind } from '../engine/guides';
import type { BalloonTool } from '../engine/tools/balloonTool';
import type { FrameTool } from '../engine/tools/frameTool';
import type { TransformTool } from '../engine/tools/transformTool';
import { FontSelect } from './TextPanel';
import { isBrushTool, setSettings, updateBrushTool, type BalloonKind, type GradientType, type ShapeKind, type ToolId } from '../store/settings';
import { Icon, IconButton, Segmented, Slider, Toggle } from './components';
import { GradientBar, GradientEditor } from './GradientEditor';
import { useEditor, useSettings } from './hooks';

export type PanelId = 'tools' | 'brush' | 'color' | 'layers' | 'menu' | 'settings' | 'filters' | 'materials' | null;

export const TOOL_LIST: { id: ToolId; label: string; icon: string; key: string }[] = [
  { id: 'brush', label: 'Brush', icon: 'brush', key: 'B' },
  { id: 'eraser', label: 'Eraser', icon: 'eraser', key: 'E' },
  { id: 'smudge', label: 'Smudge', icon: 'smudge', key: 'J' },
  { id: 'blur', label: 'Blur', icon: 'blur', key: 'K' },
  { id: 'fill', label: 'Fill', icon: 'fill', key: 'G' },
  { id: 'lassoFill', label: 'Lasso Fill', icon: 'lassoFill', key: 'L' },
  { id: 'select', label: 'Selection', icon: 'select', key: 'M' },
  { id: 'transform', label: 'Transform', icon: 'transform', key: 'V' },
  { id: 'shape', label: 'Shape', icon: 'shape', key: 'U' },
  { id: 'gradient', label: 'Gradient', icon: 'gradient', key: 'D' },
  { id: 'ruler', label: 'Ruler & Symmetry', icon: 'ruler', key: 'R' },
  { id: 'text', label: 'Text', icon: 'text', key: 'T' },
  { id: 'balloon', label: 'Speech Balloon', icon: 'balloon', key: 'W' },
  { id: 'frame', label: 'Frame Divider', icon: 'frame', key: 'N' },
  { id: 'eyedropper', label: 'Eyedropper', icon: 'eyedropper', key: 'I' },
  { id: 'hand', label: 'Hand', icon: 'hand', key: 'H' },
];

export function ToolGrid({ onPick, onFilters, onMaterials }: { onPick: () => void; onFilters: () => void; onMaterials: () => void }) {
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
      <button className="tool-item" onClick={onFilters}>
        <Icon name="filter" size={26} />
        <span>Filters</span>
        <kbd>F</kbd>
      </button>
      <button className="tool-item" onClick={onMaterials}>
        <Icon name="materials" size={26} />
        <span>Materials</span>
      </button>
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
        <span className="brush-name">{getBrush(ts.presetId).name}</span>
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

type RulerChoice = 'none' | 'line' | 'circle' | 'ellipse' | 'radial' | 'p1' | 'p2' | 'p3';

function rulerChoice(r: Ruler | null): RulerChoice {
  if (!r) return 'none';
  if (r.kind === 'ellipse') return r.circle ? 'circle' : 'ellipse';
  if (r.kind === 'perspective') return `p${r.vps.length}` as RulerChoice;
  return r.kind;
}

/** Ruler, symmetry and grid options. */
function GuideOptions() {
  const ed = useEditor();
  const g = ed.doc.guides;
  const v = ed.viewport;
  const center = () => v.toDoc(v.cssW / 2, v.cssH / 2);
  const size = () => (Math.min(v.cssW, v.cssH) * 0.28) / v.zoom;
  const pickRuler = (c: RulerChoice) => {
    let r: Ruler | null = null;
    if (c === 'line' || c === 'radial') r = makeRuler(c, center(), size());
    else if (c === 'circle' || c === 'ellipse') {
      const e = makeRuler('ellipse', center(), size()) as Extract<Ruler, { kind: 'ellipse' }>;
      r = c === 'circle' ? { ...e, ry: e.rx, circle: true } : e;
    } else if (c !== 'none') r = makeRuler('perspective', center(), size(), Number(c.slice(1)));
    ed.setGuides({ ruler: r, rulerOn: true });
  };
  const pickSym = (k: SymmetryKind | 'none') =>
    ed.setGuides({ symmetry: k === 'none' ? null : { kind: k, c: center(), angle: k === 'mirror' ? Math.PI / 2 : -Math.PI / 2, n: g.symmetry?.n ?? 6 }, symmetryOn: true });
  return (
    <>
      <Segmented
        value={rulerChoice(g.ruler)}
        onChange={pickRuler}
        options={[
          { value: 'none', label: 'No ruler' },
          { value: 'line', label: 'Straight' },
          { value: 'circle', label: 'Circle' },
          { value: 'ellipse', label: 'Ellipse' },
          { value: 'radial', label: 'Radial' },
          { value: 'p1', label: '1-point' },
          { value: 'p2', label: '2-point' },
          { value: 'p3', label: '3-point' },
        ]}
      />
      <Segmented
        value={g.symmetry?.kind ?? 'none'}
        onChange={pickSym}
        options={[
          { value: 'none', label: 'No symmetry' },
          { value: 'mirror', label: 'Mirror' },
          { value: 'kaleidoscope', label: 'Kaleidoscope' },
          { value: 'rotation', label: 'Rotation' },
        ]}
      />
      {g.symmetry && g.symmetry.kind !== 'mirror' && (
        <Slider label="Segments" value={g.symmetry.n} min={2} max={24} step={1} onChange={(n) => ed.setGuides({ symmetry: { ...g.symmetry!, n } })} className="compact" />
      )}
      {g.page && <Toggle label="Page guides" value={g.pageOn !== false} onChange={(pageOn) => ed.setGuides({ pageOn })} />}
      <Toggle label="Grid" value={g.gridOn} onChange={(gridOn) => ed.setGuides({ gridOn })} />
      {g.gridOn && <Slider label="Grid size" value={g.gridSize} min={8} max={1000} step={1} log onChange={(gridSize) => ed.setGuides({ gridSize })} className="compact" />}
    </>
  );
}

/** Quick on/off switches for rulers and symmetry, shown while drawing. */
export function GuideToggles() {
  const ed = useEditor();
  const g = ed.doc.guides;
  return (
    <>
      {g.ruler && <IconButton icon="ruler" label={g.rulerOn ? 'Ruler on' : 'Ruler off'} active={g.rulerOn} onClick={() => ed.setGuides({ rulerOn: !g.rulerOn })} />}
      {g.symmetry && <IconButton icon="symmetry" label={g.symmetryOn ? 'Symmetry on' : 'Symmetry off'} active={g.symmetryOn} onClick={() => ed.setGuides({ symmetryOn: !g.symmetryOn })} />}
    </>
  );
}

/** Options strip for the active tool. */
export function ToolOptions() {
  const [editGradient, setEditGradient] = useState(false);
  const shape = useSettings((s) => s.shape);
  const gradient = useSettings((s) => s.gradient);
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
    const mode = tt.mode;
    body = (
      <>
        <Segmented
          value={mode}
          onChange={(m) => tt.setMode(m)}
          options={[
            { value: 'free', label: 'Free', icon: 'transform' },
            { value: 'distort', label: 'Distort', icon: 'distort' },
            { value: 'mesh', label: 'Mesh', icon: 'mesh' },
          ]}
        />
        {mode === 'mesh' && (
          <Segmented
            value={String(tt.meshSize)}
            onChange={(v) => tt.setMode('mesh', Number(v))}
            options={['2', '3', '4', '5'].map((n) => ({ value: n, label: `${n}×${n}` }))}
          />
        )}
        <IconButton icon="flipH" label="Flip horizontal" onClick={() => tt.flip('h')} size={20} />
        <IconButton icon="flipV" label="Flip vertical" onClick={() => tt.flip('v')} size={20} />
        <IconButton icon="rotate" label="Rotate 90°" onClick={() => tt.rotate90()} size={20} />
        {mode === 'free' && <IconButton icon="fit" label="Fit to canvas" onClick={() => tt.fitCanvas()} size={20} />}
        {mode === 'free' && <Toggle label="Keep ratio" value={keepAspect} onChange={(v) => setSettings({ transformKeepAspect: v })} />}
        <button className="chip" onClick={() => tt.reset()}>Reset</button>
        <button className="chip" onClick={() => tt.finish(false)}>Cancel</button>
        <button className="chip primary" onClick={() => tt.finish(true)}>
          <Icon name="check" size={16} /> Done
        </button>
      </>
    );
  } else if (tool === 'ruler') {
    body = <GuideOptions />;
  } else if (tool === 'shape') {
    body = (
      <>
        <Segmented
          value={shape.kind}
          onChange={(kind: ShapeKind) => setSettings({ shape: { ...shape, kind } })}
          options={[
            { value: 'line', label: 'Line' },
            { value: 'rect', label: 'Rectangle' },
            { value: 'ellipse', label: 'Ellipse' },
            { value: 'polygon', label: 'Polygon' },
            { value: 'star', label: 'Star' },
          ]}
        />
        {(shape.kind === 'polygon' || shape.kind === 'star') && (
          <Slider label={shape.kind === 'star' ? 'Points' : 'Sides'} value={shape.sides} min={3} max={16} step={1} onChange={(sides) => setSettings({ shape: { ...shape, sides } })} className="compact" />
        )}
        {shape.kind !== 'line' && (
          <Segmented
            value={shape.mode}
            onChange={(mode) => setSettings({ shape: { ...shape, mode } })}
            options={[
              { value: 'stroke', label: 'Outline' },
              { value: 'fill', label: 'Fill' },
              { value: 'both', label: 'Both' },
            ]}
          />
        )}
        <Toggle label="From center" value={shape.fromCenter} onChange={(fromCenter) => setSettings({ shape: { ...shape, fromCenter } })} />
      </>
    );
  } else if (tool === 'gradient') {
    body = (
      <>
        <Segmented
          value={gradient.type}
          onChange={(type: GradientType) => setSettings({ gradient: { ...gradient, type } })}
          options={[
            { value: 'linear', label: 'Linear' },
            { value: 'radial', label: 'Radial' },
            { value: 'conic', label: 'Conic' },
            { value: 'reflected', label: 'Reflected' },
          ]}
        />
        <GradientBar stops={gradient.stops} reverse={gradient.reverse} onClick={() => setEditGradient(true)} />
        <Slider label="Opacity" value={gradient.opacity * 100} min={1} max={100} step={1} format={(v) => `${Math.round(v)}%`} onChange={(v) => setSettings({ gradient: { ...gradient, opacity: v / 100 } })} className="compact" />
      </>
    );
  } else if (tool === 'text') {
    body = <TextOptions />;
  } else if (tool === 'balloon') {
    body = <BalloonOptions />;
  } else if (tool === 'frame') {
    body = <FrameOptions />;
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
  return (
    <>
      <div className="tool-options">{body}</div>
      {editGradient && <GradientEditor onClose={() => setEditGradient(false)} />}
    </>
  );
}

function TextOptions() {
  const d = useSettings((s) => s.textDefaults);
  const set = (patch: Partial<typeof d>) => setSettings((s) => ({ textDefaults: { ...s.textDefaults, ...patch } }));
  return (
    <>
      <FontSelect value={d.font} onChange={(font) => set({ font })} />
      <Slider label="Size" value={d.size} min={6} max={1000} step={1} log format={(v) => `${Math.round(v)}px`} onChange={(size) => set({ size })} className="compact" />
      <Segmented
        value={d.vertical ? 'v' : 'h'}
        onChange={(v) => set({ vertical: v === 'v' })}
        options={[
          { value: 'h', label: 'Horizontal' },
          { value: 'v', label: 'Vertical' },
        ]}
      />
      <span className="opt-hint">Tap the canvas to add text, or tap a text to edit it.</span>
    </>
  );
}

function BalloonOptions() {
  const ed = useEditor();
  const b = useSettings((s) => s.balloon);
  const tool = ed.tools.balloon as BalloonTool;
  const set = (patch: Partial<typeof b>) => setSettings((s) => ({ balloon: { ...s.balloon, ...patch } }));
  return (
    <>
      <Segmented
        value={b.kind}
        onChange={(kind: BalloonKind) => {
          set({ kind });
          tool.setKind(kind);
        }}
        options={[
          { value: 'oval', label: 'Speech' },
          { value: 'round', label: 'Rounded' },
          { value: 'cloud', label: 'Thought' },
          { value: 'spiky', label: 'Shout' },
          { value: 'box', label: 'Narration' },
        ]}
      />
      <Slider label="Outline" value={b.stroke} min={0} max={40} step={0.5} onChange={(stroke) => { set({ stroke }); ed.requestRender(); }} className="compact" />
      <label className="stop-color small" style={{ background: b.fill }} title="Fill color">
        <input type="color" value={b.fill} onChange={(e) => set({ fill: e.target.value })} aria-label="Balloon fill color" />
      </label>
      <label className="stop-color small" style={{ background: b.line }} title="Outline color">
        <input type="color" value={b.line} onChange={(e) => set({ line: e.target.value })} aria-label="Balloon outline color" />
      </label>
      <Toggle label="Add text" value={b.addText} onChange={(addText) => set({ addText })} />
      {tool.pending && (
        <>
          <button className="chip" onClick={() => tool.discard()}>Cancel</button>
          <button className="chip primary" onClick={() => tool.commit()}>
            <Icon name="check" size={16} /> Done
          </button>
        </>
      )}
    </>
  );
}

function FrameOptions() {
  const ed = useEditor();
  const f = useSettings((s) => s.frame);
  const tool = ed.tools.frame as FrameTool;
  const layer = tool.frameLayer();
  const set = (patch: Partial<typeof f>) => setSettings((s) => ({ frame: { ...s.frame, ...patch } }));
  if (!layer?.frames) {
    return (
      <>
        <Slider label="Page margin" value={f.margin} min={0} max={600} step={1} onChange={(margin) => set({ margin })} className="compact" />
        <Slider label="Border" value={f.border} min={0} max={40} step={0.5} onChange={(border) => set({ border })} className="compact" />
        <button className="chip primary" onClick={() => tool.createFrames()}>
          <Icon name="plus" size={16} /> Create frame layer
        </button>
      </>
    );
  }
  const fs = layer.frames;
  return (
    <>
      <Segmented
        value={f.mode}
        onChange={(mode) => set({ mode })}
        options={[
          { value: 'cut', label: 'Cut panels' },
          { value: 'select', label: 'Select panel' },
        ]}
      />
      <Slider label="Gap" value={f.gutter} min={0} max={300} step={1} onChange={(gutter) => set({ gutter })} className="compact" />
      <Slider label="Border" value={fs.border} min={0} max={40} step={0.5} onChange={() => {}} onCommit={(border) => ed.setFrames(layer, { ...fs, border }, 'Frame border')} className="compact" />
      <Toggle label="White gaps" value={fs.gutterColor !== 'transparent'} onChange={(v) => ed.setFrames(layer, { ...fs, gutterColor: v ? '#ffffff' : 'transparent' }, 'Frame gaps')} />
      <span className="opt-hint">{f.mode === 'cut' ? 'Drag across a panel to split it.' : 'Tap a panel to select it, then draw inside.'}</span>
    </>
  );
}
