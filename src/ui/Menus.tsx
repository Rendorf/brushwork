import { useEffect, useRef, useState, type ReactNode } from 'react';
import { decodeImage, deliverFile, exportImage, exportPsd, fitImage, safeFileName } from '../engine/io/files';
import { writeProject } from '../engine/io/serialize';
import { currentRGB, setSettings } from '../store/settings';
import { storageEstimate } from '../storage/gallery';
import { Dialog, Icon, NumberField, Panel, Segmented, Slider, Toggle } from './components';
import { useEditor, useSettings } from './hooks';

function MenuItem(props: { icon: string; label: string; onClick: () => void; disabled?: boolean; hint?: string }) {
  return (
    <button className="menu-item" onClick={props.onClick} disabled={props.disabled}>
      <Icon name={props.icon} size={20} />
      <span>{props.label}</span>
      {props.hint && <kbd>{props.hint}</kbd>}
    </button>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="menu-group">
      <div className="section-title">{title}</div>
      {children}
    </div>
  );
}

export function MainMenu(props: { onClose: () => void; onSave: () => void; onSettings: () => void; onFilters: () => void; onMaterials: () => void; onTimelapse: () => void; onAnimExport: () => void; onHelp: () => void }) {
  const ed = useEditor();
  const [dialog, setDialog] = useState<'canvas' | 'image' | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const hasSel = !!ed.doc.selection;
  const base = safeFileName(ed.doc.name);

  const run = (fn: () => unknown | Promise<unknown>, close = true) => async () => {
    try {
      await fn();
    } catch (e) {
      ed.toast(`Something went wrong: ${(e as Error).message}`);
    }
    if (close) props.onClose();
  };
  const ask = (q: string, def: number, fn: (v: number) => void) => () => {
    const v = Number(prompt(q, String(def)));
    if (Number.isFinite(v) && v !== 0) fn(v);
    props.onClose();
  };

  return (
    <Panel title="Menu" onClose={props.onClose} className="menu-panel">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try {
            const img = fitImage(await decodeImage(f), ed.doc.width, ed.doc.height);
            ed.addPixelsLayer(img.data, img.width, img.height, Math.round((ed.doc.width - img.width) / 2), Math.round((ed.doc.height - img.height) / 2), f.name.replace(/\.[^.]+$/, ''));
            ed.setTool('transform');
            props.onClose();
          } catch {
            ed.toast('That file could not be opened as an image.');
          }
        }}
      />
      <Group title="File">
        <MenuItem icon="check" label="Save now" hint="Ctrl S" onClick={run(props.onSave)} />
        <MenuItem icon="image" label="Import image as layer" onClick={() => fileRef.current?.click()} />
        <MenuItem icon="download" label="Export PNG" onClick={run(async () => deliverFile(await exportImage(ed, 'png', false), `${base}.png`))} />
        <MenuItem icon="download" label="Export transparent PNG" onClick={run(async () => deliverFile(await exportImage(ed, 'png', true), `${base}.png`))} />
        <MenuItem icon="download" label="Export JPEG" onClick={run(async () => deliverFile(await exportImage(ed, 'jpeg', false), `${base}.jpg`))} />
        <MenuItem icon="download" label="Export PSD (layers)" onClick={run(async () => deliverFile(await exportPsd(ed), `${base}.psd`))} />
        <MenuItem icon="video" label="Time-lapse video…" onClick={props.onTimelapse} />
        <MenuItem icon="download" label="Export project (.brushwork)" onClick={run(async () => deliverFile(await writeProject(ed.doc), `${base}.brushwork`))} />
      </Group>
      <Group title="Animation">
        <MenuItem icon="film" label={ed.doc.animation ? 'Turn off animation' : 'Frame-by-frame animation'} onClick={run(() => ed.setAnimationMode(!ed.doc.animation))} />
        {ed.doc.animation && <MenuItem icon="download" label="Export GIF / video…" onClick={props.onAnimExport} />}
      </Group>
      <Group title="Filters">
        <MenuItem icon="filter" label="Filters…" hint="F" onClick={props.onFilters} />
        <MenuItem icon="materials" label="Materials…" onClick={props.onMaterials} />
      </Group>
      <Group title="Edit">
        <MenuItem icon="copy" label="Copy" hint="Ctrl C" onClick={run(() => ed.copy())} />
        <MenuItem icon="copy" label="Cut" hint="Ctrl X" onClick={run(() => ed.copy(true))} />
        <MenuItem icon="plus" label="Paste" hint="Ctrl V" disabled={!ed.hasClipboard} onClick={run(() => ed.paste())} />
        <MenuItem icon="fill" label="Fill with current color" onClick={run(() => ed.fillLayer(currentRGB()))} />
        <MenuItem icon="eraser" label="Clear" hint="Del" onClick={run(() => ed.clearLayer())} />
      </Group>
      <Group title="Selection">
        <MenuItem icon="select" label="Select all" hint="Ctrl A" onClick={run(() => ed.selectAll())} />
        <MenuItem icon="close" label="Deselect" hint="Ctrl D" disabled={!hasSel} onClick={run(() => ed.deselect())} />
        <MenuItem icon="invert" label="Invert selection" hint="Ctrl ⇧ I" onClick={run(() => ed.invertSelection())} />
        <MenuItem icon="layers" label="Select layer pixels" onClick={run(() => ed.selectLayerOpacity())} />
        <MenuItem icon="plus" label="Expand selection…" disabled={!hasSel} onClick={ask('Expand by how many pixels?', 4, (v) => ed.growSelection(Math.abs(v)))} />
        <MenuItem icon="close" label="Shrink selection…" disabled={!hasSel} onClick={ask('Shrink by how many pixels?', 4, (v) => ed.growSelection(-Math.abs(v)))} />
        <MenuItem icon="blur" label="Feather selection…" disabled={!hasSel} onClick={ask('Feather radius in pixels?', 8, (v) => ed.featherSelection(Math.abs(v)))} />
        <MenuItem icon="canvas" label="Crop to selection" disabled={!hasSel} onClick={run(() => ed.cropToSelection())} />
      </Group>
      <Group title="Canvas">
        <MenuItem icon="rotate" label="Rotate 90° clockwise" onClick={run(() => ed.rotateCanvas('cw'))} />
        <MenuItem icon="rotate" label="Rotate 90° counter-clockwise" onClick={run(() => ed.rotateCanvas('ccw'))} />
        <MenuItem icon="rotate" label="Rotate 180°" onClick={run(() => ed.rotateCanvas('180'))} />
        <MenuItem icon="flipH" label="Flip canvas horizontally" onClick={run(() => ed.flipCanvas('h'))} />
        <MenuItem icon="flipV" label="Flip canvas vertically" onClick={run(() => ed.flipCanvas('v'))} />
        <MenuItem icon="canvas" label="Canvas size…" onClick={() => setDialog('canvas')} />
        <MenuItem icon="fit" label="Image size…" onClick={() => setDialog('image')} />
      </Group>
      <Group title="App">
        <MenuItem icon="settings" label="Settings" onClick={props.onSettings} />
        <MenuItem icon="more" label="Keyboard shortcuts & gestures" onClick={props.onHelp} />
      </Group>
      {dialog === 'canvas' && <CanvasSizeDialog onClose={() => setDialog(null)} />}
      {dialog === 'image' && <ImageSizeDialog onClose={() => setDialog(null)} />}
    </Panel>
  );
}

function CanvasSizeDialog({ onClose }: { onClose: () => void }) {
  const ed = useEditor();
  const [w, setW] = useState(ed.doc.width);
  const [h, setH] = useState(ed.doc.height);
  const [anchor, setAnchor] = useState(4);
  const max = ed.gl.getParameter(ed.gl.MAX_TEXTURE_SIZE) as number;
  return (
    <Dialog
      title="Canvas size"
      onClose={onClose}
      footer={
        <button
          className="btn primary"
          onClick={() => {
            ed.resizeCanvas(w, h, (anchor % 3) / 2, Math.floor(anchor / 3) / 2);
            onClose();
          }}
        >
          Apply
        </button>
      }
    >
      <NumberField label="Width" value={w} min={1} max={max} suffix="px" onChange={setW} />
      <NumberField label="Height" value={h} min={1} max={max} suffix="px" onChange={setH} />
      <div className="field">
        <span>Anchor</span>
        <div className="anchor-grid">
          {Array.from({ length: 9 }, (_, i) => (
            <button key={i} className={anchor === i ? 'on' : ''} onClick={() => setAnchor(i)} aria-label={`Anchor ${i + 1}`} />
          ))}
        </div>
      </div>
      <p className="hint">Content outside the new size is cropped. Adding space keeps it transparent.</p>
    </Dialog>
  );
}

function ImageSizeDialog({ onClose }: { onClose: () => void }) {
  const ed = useEditor();
  const W = ed.doc.width, H = ed.doc.height;
  const [w, setW] = useState(W);
  const [h, setH] = useState(H);
  const [keep, setKeep] = useState(true);
  const max = ed.gl.getParameter(ed.gl.MAX_TEXTURE_SIZE) as number;
  return (
    <Dialog
      title="Image size"
      onClose={onClose}
      footer={
        <button
          className="btn primary"
          onClick={() => {
            ed.resizeImage(w, h);
            onClose();
          }}
        >
          Apply
        </button>
      }
    >
      <NumberField label="Width" value={w} min={1} max={max} suffix="px" onChange={(v) => { setW(v); if (keep) setH(Math.max(1, Math.round((v * H) / W))); }} />
      <NumberField label="Height" value={h} min={1} max={max} suffix="px" onChange={(v) => { setH(v); if (keep) setW(Math.max(1, Math.round((v * W) / H))); }} />
      <Toggle label="Keep proportions" value={keep} onChange={setKeep} />
      <p className="hint">Scales every layer. Large reductions soften detail.</p>
    </Dialog>
  );
}

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const s = useSettings((x) => x);
  const [est, setEst] = useState<{ usage: number; quota: number } | null>(null);
  useEffect(() => {
    storageEstimate().then(setEst);
  }, []);
  const mb = (n: number) => `${Math.round(n / 1024 / 1024)} MB`;
  return (
    <Panel title="Settings" onClose={onClose} className="settings-panel">
      <div className="section-title">Pen & touch</div>
      <div className="field">
        <span>Draw with fingers</span>
        <Segmented
          value={s.stylusMode}
          onChange={(v) => setSettings({ stylusMode: v })}
          options={[
            { value: 'auto', label: 'Until a pen is used' },
            { value: 'off', label: 'Always' },
            { value: 'on', label: 'Never (pen only)' },
          ]}
        />
      </div>
      <Slider label="Pressure curve" value={s.pressureGamma} min={0.3} max={3} step={0.05} format={(v) => (v < 1 ? `Soft ${v.toFixed(2)}` : v > 1 ? `Firm ${v.toFixed(2)}` : 'Linear')} onChange={(v) => setSettings({ pressureGamma: v })} />
      <PressureCurve gamma={s.pressureGamma} />
      <Toggle label="Two-finger tap to undo, three-finger tap to redo" value={s.twoFingerUndo} onChange={(v) => setSettings({ twoFingerUndo: v })} />
      <Toggle label="Long-press to pick a color" value={s.longPressEyedropper} onChange={(v) => setSettings({ longPressEyedropper: v })} />
      <Toggle label="Show brush outline" value={s.showCursor} onChange={(v) => setSettings({ showCursor: v })} />
      <div className="section-title">Layout</div>
      <Toggle label="Sliders on the right (left-handed)" value={s.leftHanded} onChange={(v) => setSettings({ leftHanded: v })} />
      <div className="section-title">Memory & storage</div>
      <Slider label="Undo memory" value={s.undoBudgetMB} min={128} max={2048} step={64} format={(v) => `${Math.round(v)} MB`} onChange={(v) => setSettings({ undoBudgetMB: v })} />
      {est && (
        <p className="hint">
          Storage used on this device: {mb(est.usage)} of {mb(est.quota)} available.
        </p>
      )}
      <p className="hint">Everything is stored only on this device. Export your artworks to back them up.</p>
    </Panel>
  );
}

function PressureCurve({ gamma }: { gamma: number }) {
  const pts = Array.from({ length: 33 }, (_, i) => {
    const x = i / 32;
    return `${x * 100},${100 - Math.pow(x, gamma) * 100}`;
  }).join(' ');
  return (
    <svg className="curve" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Pressure curve preview">
      <polyline points="0,100 100,0" className="curve-ref" />
      <polyline points={pts} className="curve-line" />
    </svg>
  );
}

export function HelpDialog({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ['Two-finger drag', 'Pan, zoom and rotate the canvas'],
    ['Two-finger tap', 'Undo'],
    ['Three-finger tap', 'Redo'],
    ['Long-press while drawing', 'Pick a color'],
    ['Space + drag / middle mouse', 'Pan'],
    ['Ctrl/⌘ + wheel, pinch', 'Zoom'],
    ['Alt + wheel', 'Rotate the view'],
    ['Right-click', 'Pick a color'],
    ['B / E / J / K', 'Brush / Eraser / Smudge / Blur'],
    ['G / L / M / V / I / H', 'Fill / Lasso fill / Select / Transform / Eyedropper / Hand'],
    ['U / D / R', 'Shape / Gradient / Ruler & symmetry'],
    ['F', 'Filters (Enter applies, Esc cancels)'],
    ['T / W / N', 'Text / Speech balloon / Frame divider'],
    ['Shift while dragging', 'Square shapes, 15° lines, 45° gradients, snap rotation'],
    ['[ and ]', 'Brush size'],
    ['Ctrl Z / Ctrl ⇧ Z', 'Undo / Redo'],
    ['Ctrl A / D / ⇧ I', 'Select all / Deselect / Invert'],
    ['Ctrl C / X / V', 'Copy / Cut / Paste as new layer'],
    ['Ctrl ⇧ N, Ctrl J, Ctrl E', 'New layer, Duplicate, Merge down'],
    ['Delete', 'Clear (inside the selection)'],
    ['Enter / Esc', 'Finish / cancel a transform'],
    ['0 / 1 / + / −', 'Fit / 100% / Zoom in / out'],
    ['X', 'Flip the view (not the image)'],
    ['Tab', 'Hide the interface'],
  ];
  return (
    <Dialog title="Shortcuts & gestures" onClose={onClose}>
      <table className="help-table">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td><kbd>{k}</kbd></td>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}
