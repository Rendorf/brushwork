import { useEffect, useReducer, useRef, useState } from 'react';
import type { Layer } from '../engine/document';
import { allFonts, deleteFont, fontById, importFont } from '../engine/text/fonts';
import type { TextProps } from '../engine/text/textRender';
import type { TextTool } from '../engine/tools/textTool';
import { currentRGB, rgbToHex, setSettings } from '../store/settings';
import { Icon, IconButton, Panel, Segmented, Slider } from './components';
import { useEditor } from './hooks';

function ColorPick({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <span className="color-param">
      <button className="chip" onClick={() => onChange(rgbToHex(...currentRGB()))} title="Use the current brush color">
        Current
      </button>
      <label className="stop-color" style={{ background: value }}>
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} />
      </label>
    </span>
  );
}

/** Font picker with import of TTF/OTF/WOFF files. */
export function FontSelect({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const ed = useEditor();
  const fileRef = useRef<HTMLInputElement>(null);
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const fonts = allFonts();
  const cur = fontById(value);
  return (
    <div className="field">
      <span>Font</span>
      <span className="font-select">
        <select value={cur.id} onChange={(e) => (e.target.value === '__import' ? fileRef.current?.click() : onChange(e.target.value))} style={{ fontFamily: cur.css }}>
          {['bundled', 'system', 'imported'].map((kind) => {
            const list = fonts.filter((f) => f.kind === kind);
            if (!list.length) return null;
            return (
              <optgroup key={kind} label={kind === 'bundled' ? 'Included fonts' : kind === 'system' ? 'Device fonts' : 'My fonts'}>
                {list.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </optgroup>
            );
          })}
          <option value="__import">Import a font file…</option>
        </select>
        {cur.kind === 'imported' && (
          <IconButton
            icon="trash"
            label="Remove this font"
            size={16}
            onClick={async () => {
              if (!confirm(`Remove the font "${cur.label}"?`)) return;
              await deleteFont(cur.id);
              onChange('inter');
              bump();
            }}
          />
        )}
      </span>
      <input
        ref={fileRef}
        type="file"
        accept=".ttf,.otf,.woff,.woff2,font/*"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try {
            const entry = await importFont(f);
            onChange(entry.id);
            bump();
          } catch (err) {
            ed.toast((err as Error).message);
          }
        }}
      />
    </div>
  );
}

/** Editing panel for the active text layer. */
export function TextPanel({ layer }: { layer: Layer }) {
  const ed = useEditor();
  const t = layer.text!;
  const area = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(t.text);
  const tool = ed.tools.text as TextTool;

  // Select the placeholder of a text that was just created.
  useEffect(() => {
    if (tool.justCreated === layer && area.current) {
      area.current.focus();
      area.current.select();
      tool.justCreated = null;
    }
  }, [layer, tool]);
  useEffect(() => () => ed.endTextEdit(), [ed, layer]);
  useEffect(() => setDraft(t.text), [t.text]);

  const set = (patch: Partial<TextProps>) => {
    ed.updateText(layer, { ...structuredClone(layer.text!), ...patch });
    // New texts start from the last settings used.
    const keys = ['font', 'size', 'vertical', 'bold', 'strokeWidth'] as const;
    const d: Record<string, unknown> = {};
    for (const k of keys) if (k in patch) d[k] = patch[k];
    if (Object.keys(d).length) setSettings((s) => ({ textDefaults: { ...s.textDefaults, ...d } }));
  };

  return (
    <Panel
      title="Text"
      onClose={() => ed.setTool(ed.previousTool === 'text' ? 'brush' : ed.previousTool)}
      className="text-panel"
      actions={<IconButton icon="trash" label="Delete this text" size={18} onClick={() => ed.deleteNode(layer)} />}
    >
      <textarea
        ref={area}
        className="text-input"
        value={draft}
        rows={3}
        dir="auto"
        onChange={(e) => {
          setDraft(e.target.value);
          set({ text: e.target.value });
        }}
        aria-label="Text"
      />
      <FontSelect value={t.font} onChange={(font) => set({ font })} />
      <Slider label="Size" value={t.size} min={6} max={1000} step={1} log format={(v) => `${Math.round(v)}px`} onChange={(size) => set({ size })} />
      <div className="field">
        <span>Color</span>
        <ColorPick value={t.color} onChange={(color) => set({ color })} label="Text color" />
      </div>
      <div className="prop-flags">
        <Segmented
          value={t.vertical ? 'v' : 'h'}
          onChange={(v) => set({ vertical: v === 'v' })}
          options={[
            { value: 'h', label: 'Horizontal' },
            { value: 'v', label: 'Vertical' },
          ]}
        />
        <button className={`chip ${t.bold ? 'on' : ''}`} onClick={() => set({ bold: !t.bold })}>
          <b>B</b>
        </button>
        <button className={`chip ${t.italic ? 'on' : ''}`} onClick={() => set({ italic: !t.italic })}>
          <i>I</i>
        </button>
      </div>
      <div className="field">
        <span>Align</span>
        <Segmented
          value={t.align}
          onChange={(align) => set({ align })}
          options={[
            { value: 'start', label: t.vertical ? 'Top' : 'Left' },
            { value: 'center', label: 'Center' },
            { value: 'end', label: t.vertical ? 'Bottom' : 'Right' },
          ]}
        />
      </div>
      <Slider label="Letter spacing" value={t.letterSpacing * 100} min={-20} max={100} step={1} format={(v) => `${Math.round(v)}%`} onChange={(v) => set({ letterSpacing: v / 100 })} />
      <Slider label={t.vertical ? 'Column spacing' : 'Line spacing'} value={t.lineHeight * 100} min={70} max={300} step={5} format={(v) => `${Math.round(v)}%`} onChange={(v) => set({ lineHeight: v / 100 })} />
      <Slider label="Outline" value={t.strokeWidth} min={0} max={Math.max(40, t.size * 0.3)} step={0.5} format={(v) => `${v.toFixed(1)}px`} onChange={(strokeWidth) => set({ strokeWidth })} />
      {t.strokeWidth > 0 && (
        <div className="field">
          <span>Outline color</span>
          <ColorPick value={t.strokeColor} onChange={(strokeColor) => set({ strokeColor })} label="Outline color" />
        </div>
      )}
      <Slider label="Rotation" value={t.rotation} min={-180} max={180} step={1} format={(v) => `${Math.round(v)}°`} onChange={(rotation) => set({ rotation })} />
      <div className="filter-actions">
        <button className="btn" onClick={() => ed.rasterize(layer)} title="Turn this text into pixels you can paint on">
          Rasterize
        </button>
        <button className="btn primary" onClick={() => ed.setTool(ed.previousTool === 'text' ? 'brush' : ed.previousTool)}>
          <Icon name="check" size={18} /> Done
        </button>
      </div>
      <p className="hint">Drag the text on the canvas to move it. Tap empty space to add another text.</p>
    </Panel>
  );
}
