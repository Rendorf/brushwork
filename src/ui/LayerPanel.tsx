import { useEffect, useRef, useState } from 'react';
import { BLEND_MODES, blendLabel, type FolderBlendMode } from '../engine/blendModes';
import type { Folder, Layer, Node } from '../engine/document';
import type { Editor } from '../engine/editor';
import { defaultTone, toneCell, type ToneProps } from '../engine/comics/tone';
import { capture, Icon, IconButton, Panel, Segmented, Slider, Toggle } from './components';
import { useEditor } from './hooks';
import { rgbToHex, hexToRgb } from '../store/settings';

interface Row {
  node: Node;
  depth: number;
}

function flatten(children: Node[], depth: number, out: Row[]): Row[] {
  for (let i = children.length - 1; i >= 0; i--) {
    const n = children[i];
    out.push({ node: n, depth });
    if (n.kind === 'folder' && n.expanded) flatten(n.children, depth + 1, out);
  }
  return out;
}

const thumbCache = new WeakMap<Layer, { v: number; img: ImageData }>();

function Thumb({ ed, layer }: { ed: Editor; layer: Layer }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    let cached = thumbCache.get(layer);
    if (!cached || cached.v !== layer.contentVersion || cached.img.width === 0) {
      cached = { v: layer.contentVersion, img: ed.layerThumbnail(layer, 56, 56) };
      thumbCache.set(layer, cached);
    }
    c.width = cached.img.width;
    c.height = cached.img.height;
    c.getContext('2d')!.putImageData(cached.img, 0, 0);
  });
  return (
    <div className="thumb">
      <canvas ref={ref} />
    </div>
  );
}

export function LayerPanel({ onClose }: { onClose: () => void }) {
  const ed = useEditor();
  const doc = ed.doc;
  const rows = flatten(doc.root.children, 0, []);
  const active = doc.active;
  const [drag, setDrag] = useState<{ node: Node; y: number; target: number | null } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const rowH = 64;

  const dropAt = (y: number): number => {
    const r = listRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(rows.length, Math.round((y - r.top + listRef.current!.scrollTop) / rowH)));
  };

  const finishDrag = () => {
    if (!drag || drag.target === null) return setDrag(null);
    const node = drag.node;
    const t = drag.target;
    setDrag(null);
    // Gap t sits above rows[t]; dropping there puts the node just above that row.
    const below = rows[t];
    const above = rows[t - 1];
    if (below?.node === node || above?.node === node) return;
    if (below) {
      const parent = below.node.parent!;
      let idx = parent.children.indexOf(below.node) + 1;
      if (node.parent === parent && parent.children.indexOf(node) < idx) idx--;
      ed.moveNode(node, parent, idx);
    } else if (above) {
      // Dropped at the very bottom of the list.
      ed.moveNode(node, doc.root, 0);
    }
  };

  return (
    <Panel
      title="Layers"
      onClose={onClose}
      className="layer-panel"
      actions={
        <>
          <IconButton icon="folder" label="New folder" onClick={() => ed.addFolder()} size={20} />
          <IconButton icon="plus" label="New layer" onClick={() => ed.addLayer()} size={20} />
        </>
      }
    >
      <div
        className="layer-list"
        ref={listRef}
        onPointerMove={(e) => drag && setDrag({ ...drag, y: e.clientY, target: dropAt(e.clientY) })}
        onPointerUp={finishDrag}
        onPointerCancel={() => setDrag(null)}
      >
        {rows.map((row, i) => {
          const n = row.node;
          const isActive = n === active;
          return (
            <div key={n.id}>
              {drag?.target === i && <div className="drop-line" />}
              <div
                className={`layer-row ${isActive ? 'active' : ''} ${n.clipping ? 'clipped' : ''} ${drag?.node === n ? 'dragging' : ''}`}
                style={{ paddingLeft: 6 + row.depth * 16 }}
                onClick={() => ed.setActive(n)}
              >
                <button
                  className="vis"
                  aria-label={n.visible ? 'Hide' : 'Show'}
                  onClick={(e) => {
                    e.stopPropagation();
                    ed.setProps(n, { visible: !n.visible }, { label: n.visible ? 'Hide layer' : 'Show layer' });
                  }}
                >
                  <Icon name={n.visible ? 'eye' : 'eyeOff'} size={18} />
                </button>
                {n.clipping && <span className="clip-mark"><Icon name="clip" size={14} /></span>}
                {n.kind === 'layer' ? (
                  <Thumb ed={ed} layer={n} />
                ) : (
                  <button
                    className="thumb folder-thumb"
                    aria-label={n.expanded ? 'Collapse folder' : 'Expand folder'}
                    onClick={(e) => {
                      e.stopPropagation();
                      ed.setProps(n, { expanded: !(n as Folder).expanded }, { record: false });
                    }}
                  >
                    <Icon name="folder" size={22} />
                    <span className="chev">{n.expanded ? '▾' : '▸'}</span>
                  </button>
                )}
                <div className="layer-meta">
                  <span className="layer-name">{n.name}</span>
                  <span className="layer-sub">
                    {Math.round(n.opacity * 100)}% · {blendLabel(n.blendMode)}
                  </span>
                </div>
                <div className="layer-flags">
                  {n.locked && <Icon name="lock" size={14} />}
                  {n.kind === 'layer' && n.alphaLock && <Icon name="alphaLock" size={14} />}
                  {n.kind === 'layer' && n.isReference && <Icon name="star" size={14} />}
                  {n.kind === 'layer' && n.text && <Icon name="text" size={14} />}
                  {n.kind === 'layer' && n.frames && <Icon name="frame" size={14} />}
                  {n.kind === 'layer' && n.tone && <Icon name="tone" size={14} />}
                </div>
                <span
                  className="drag-handle"
                  aria-label="Drag to reorder"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    capture(e.currentTarget.closest('.layer-list'), e.pointerId);
                    setDrag({ node: n, y: e.clientY, target: null });
                  }}
                >
                  ≡
                </span>
              </div>
            </div>
          );
        })}
        {drag?.target === rows.length && <div className="drop-line" />}
        <BackgroundRow />
      </div>
      {active && <LayerProps node={active} />}
    </Panel>
  );
}

function BackgroundRow() {
  const ed = useEditor();
  const bg = ed.doc.background;
  return (
    <div className="layer-row bg-row">
      <button
        className="vis"
        aria-label={bg.transparent ? 'Show background' : 'Hide background'}
        onClick={() => ed.setBackground({ transparent: !bg.transparent })}
      >
        <Icon name={bg.transparent ? 'eyeOff' : 'eye'} size={18} />
      </button>
      <label className="thumb bg-swatch" style={{ background: bg.transparent ? undefined : rgbToHex(bg.color[0] / 255, bg.color[1] / 255, bg.color[2] / 255) }}>
        <input
          type="color"
          value={rgbToHex(bg.color[0] / 255, bg.color[1] / 255, bg.color[2] / 255)}
          onChange={(e) => {
            const c = hexToRgb(e.target.value);
            if (c) ed.setBackground({ color: [Math.round(c[0] * 255), Math.round(c[1] * 255), Math.round(c[2] * 255)], transparent: false });
          }}
          aria-label="Background color"
        />
      </label>
      <div className="layer-meta">
        <span className="layer-name">Background</span>
        <span className="layer-sub">{bg.transparent ? 'Transparent' : 'Paper color'}</span>
      </div>
    </div>
  );
}

function LayerProps({ node }: { node: Node }) {
  const ed = useEditor();
  const start = useRef<number | null>(null);
  const [renaming, setRenaming] = useState(false);
  const isLayer = node.kind === 'layer';
  const modes: FolderBlendMode[] = [...(node.kind === 'folder' ? (['passthrough'] as FolderBlendMode[]) : []), ...BLEND_MODES.map((m) => m.id)];

  const move = (dir: 1 | -1) => {
    const { parent, index } = ed.doc.indexOf(node);
    const target = index + dir;
    if (target >= 0 && target < parent.children.length) ed.moveNode(node, parent, target);
    else if (parent.parent) {
      // Step out of the folder.
      const pi = parent.parent.children.indexOf(parent);
      ed.moveNode(node, parent.parent, dir > 0 ? pi + 1 : pi);
    }
  };

  return (
    <div className="layer-props">
      <div className="prop-row">
        {renaming ? (
          <input
            className="rename"
            autoFocus
            defaultValue={node.name}
            onBlur={(e) => {
              setRenaming(false);
              const v = e.target.value.trim();
              if (v && v !== node.name) ed.setProps(node, { name: v }, { label: 'Rename layer' });
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        ) : (
          <button className="name-btn" onClick={() => setRenaming(true)} title="Rename">
            {node.name}
          </button>
        )}
        <select
          value={node.blendMode}
          onChange={(e) => ed.setProps(node, { blendMode: e.target.value as FolderBlendMode }, { label: 'Blend mode' })}
          aria-label="Blend mode"
        >
          {modes.map((m) => (
            <option key={m} value={m}>
              {blendLabel(m)}
            </option>
          ))}
        </select>
      </div>
      <Slider
        label="Opacity"
        value={node.opacity * 100}
        min={0}
        max={100}
        step={1}
        format={(v) => `${Math.round(v)}%`}
        onChange={(v) => {
          if (start.current === null) start.current = node.opacity;
          ed.setProps(node, { opacity: v / 100 }, { record: false });
        }}
        onCommit={(v) => {
          ed.setProps(node, { opacity: v / 100 }, { before: { opacity: start.current ?? node.opacity }, label: 'Layer opacity' });
          start.current = null;
        }}
      />
      <div className="prop-flags">
        <button className={`chip ${node.clipping ? 'on' : ''}`} onClick={() => ed.setProps(node, { clipping: !node.clipping }, { label: 'Clipping' })}>
          <Icon name="clip" size={16} /> Clipping
        </button>
        {isLayer && (
          <button className={`chip ${node.alphaLock ? 'on' : ''}`} onClick={() => ed.setProps(node, { alphaLock: !node.alphaLock }, { label: 'Alpha lock' })}>
            <Icon name="alphaLock" size={16} /> Alpha lock
          </button>
        )}
        <button className={`chip ${node.locked ? 'on' : ''}`} onClick={() => ed.setProps(node, { locked: !node.locked }, { label: 'Lock layer' })}>
          <Icon name="lock" size={16} /> Lock
        </button>
        {isLayer && (
          <button className={`chip ${node.isReference ? 'on' : ''}`} onClick={() => ed.setProps(node, { isReference: !node.isReference }, { label: 'Reference layer' })}>
            <Icon name="star" size={16} /> Reference
          </button>
        )}
      </div>
      {isLayer && <TonePanel layer={node as Layer} />}
      {isLayer && ((node as Layer).text || (node as Layer).frames) && (
        <button className="chip" onClick={() => ed.rasterize(node as Layer)} title="Turn into ordinary pixels you can paint on">
          Rasterize {(node as Layer).text ? 'text' : 'frames'}
        </button>
      )}
      <div className="prop-actions">
        <IconButton icon="back" label="Move up" className="rot90" onClick={() => move(1)} size={18} />
        <IconButton icon="back" label="Move down" className="rot-90" onClick={() => move(-1)} size={18} />
        <IconButton icon="copy" label="Duplicate" onClick={() => ed.duplicateNode(node)} size={18} />
        {isLayer && <IconButton icon="merge" label="Merge down" onClick={() => ed.mergeDown(node as Layer)} size={18} />}
        {isLayer && <IconButton icon="eraser" label="Clear layer" onClick={() => ed.clearLayer()} size={18} />}
        <IconButton icon="layers" label="Flatten image" onClick={() => confirm('Flatten all layers into one?') && ed.flatten()} size={18} />
        <IconButton icon="trash" label="Delete" onClick={() => ed.deleteNode(node)} size={18} />
      </div>
    </div>
  );
}

/** Screentone: show the layer's darkness as dots, lines or noise (non-destructive). */
function TonePanel({ layer }: { layer: Layer }) {
  const ed = useEditor();
  const t = layer.tone;
  const set = (tone: ToneProps | null, label = 'Screentone') => ed.setProps(layer, { tone }, { label });
  return (
    <div className="tone-props">
      <Toggle label="Screentone layer" value={!!t} onChange={(on) => set(on ? defaultTone() : null)} />
      {t && (
        <>
          <Segmented
            value={t.shape}
            onChange={(shape) => set({ ...t, shape })}
            options={[
              { value: 'dot', label: 'Dots' },
              { value: 'line', label: 'Lines' },
              { value: 'cross', label: 'Cross' },
              { value: 'noise', label: 'Noise' },
            ]}
          />
          <Slider label="Lines per inch" value={t.lpi} min={10} max={150} step={1} onChange={(lpi) => ed.setProps(layer, { tone: { ...t, lpi } }, { record: false })} onCommit={(lpi) => set({ ...t, lpi }, 'Tone LPI')} />
          <Slider label="Angle" value={t.angle} min={0} max={90} step={1} format={(v) => `${Math.round(v)}°`} onChange={(angle) => ed.setProps(layer, { tone: { ...t, angle } }, { record: false })} onCommit={(angle) => set({ ...t, angle }, 'Tone angle')} />
          <p className="hint">Paint in gray: darker paint becomes denser tone. Cell size {toneCell(t, ed.doc.dpi).toFixed(1)}px at {ed.doc.dpi} dpi.</p>
        </>
      )}
    </div>
  );
}
