import { useEffect, useRef, useState } from 'react';
import { MATERIALS, materialTile, tintImage, type Material } from '../engine/comics/materials';
import { decodeImage, fitImage } from '../engine/io/files';
import { addMaterial, deleteMaterial, listMaterials, type MaterialRecord } from '../storage/materials';
import { currentRGB, rgbToHex, setSettings } from '../store/settings';
import { Icon, IconButton, Panel, Segmented, Slider } from './components';
import { useEditor, useSettings } from './hooks';

/** Small repeating preview of a tile. */
function TilePreview({ tile }: { tile: ImageData | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !tile) return;
    const t = document.createElement('canvas');
    t.width = tile.width;
    t.height = tile.height;
    t.getContext('2d')!.putImageData(tile, 0, 0);
    c.width = 72;
    c.height = 72;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, 72, 72);
    ctx.fillStyle = ctx.createPattern(t, 'repeat')!;
    ctx.fillRect(0, 0, 72, 72);
  }, [tile]);
  return <canvas ref={ref} className="material-thumb" />;
}

async function decodeRecord(r: MaterialRecord): Promise<ImageData> {
  return decodeImage(new Blob([r.data], { type: r.type }));
}

/** Pattern materials (built in and your own pictures): tile them on a new layer or place a picture. */
export function MaterialsPanel({ onClose }: { onClose: () => void }) {
  const ed = useEditor();
  const opts = useSettings((s) => s.materials);
  // Re-render previews when the brush color changes.
  useSettings((s) => s.color);
  const [mine, setMine] = useState<{ rec: MaterialRecord; img: ImageData }[]>([]);
  const [sel, setSel] = useState<{ kind: 'built'; m: Material } | { kind: 'mine'; rec: MaterialRecord; img: ImageData } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const ink = opts.color === 'black' ? '#000000' : rgbToHex(...currentRGB());
  const scale = opts.scale / 100;

  useEffect(() => {
    (async () => {
      const recs = await listMaterials().catch(() => []);
      const out: { rec: MaterialRecord; img: ImageData }[] = [];
      for (const rec of recs) {
        try {
          out.push({ rec, img: fitImage(await decodeRecord(rec), 1024, 1024) });
        } catch {
          /* unreadable picture */
        }
      }
      setMine(out);
    })();
  }, []);

  const tileFor = (s: NonNullable<typeof sel>, sc = scale): ImageData => {
    if (s.kind === 'built') return materialTile(s.m, ink, sc);
    const base = opts.color === 'original' ? s.img : tintImage(s.img, opts.color === 'black' ? [0, 0, 0] : currentRGB());
    if (sc === 1) return base;
    const c = document.createElement('canvas');
    c.width = base.width;
    c.height = base.height;
    c.getContext('2d')!.putImageData(base, 0, 0);
    const d = document.createElement('canvas');
    d.width = Math.max(2, Math.round(base.width * sc));
    d.height = Math.max(2, Math.round(base.height * sc));
    const ctx = d.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(c, 0, 0, d.width, d.height);
    return ctx.getImageData(0, 0, d.width, d.height);
  };

  const name = sel ? (sel.kind === 'built' ? sel.m.name : sel.rec.name) : '';
  const tileOnNewLayer = () => {
    if (!sel) return;
    ed.history.group('Add material', () => {
      const layer = ed.addLayer(name);
      ed.fillPattern(layer, tileFor(sel), 'Material');
    });
  };
  const tileOnLayer = () => {
    const layer = ed.editableLayer();
    if (sel && layer) ed.fillPattern(layer, tileFor(sel), 'Material');
  };
  const place = () => {
    if (sel?.kind !== 'mine') return;
    const img = fitImage(tileFor(sel, 1), ed.doc.width, ed.doc.height);
    ed.addPixelsLayer(img.data, img.width, img.height, Math.round((ed.doc.width - img.width) / 2), Math.round((ed.doc.height - img.height) / 2), sel.rec.name);
    ed.setTool('transform');
    onClose();
  };

  return (
    <Panel title="Materials" onClose={onClose} className="materials-panel">
      <div className="section-title">Patterns</div>
      <div className="material-grid">
        {MATERIALS.map((m) => (
          <button key={m.id} className={`material-item ${sel?.kind === 'built' && sel.m.id === m.id ? 'on' : ''}`} onClick={() => setSel({ kind: 'built', m })} title={m.name}>
            <TilePreview tile={materialTile(m, opts.color === 'black' ? '#000000' : rgbToHex(...currentRGB()), 0.6)} />
            <span>{m.name}</span>
          </button>
        ))}
      </div>
      <div className="section-title">
        <span>My materials</span>
        <button className="text-btn" onClick={() => fileRef.current?.click()}>
          <Icon name="plus" size={16} /> Add picture
        </button>
      </div>
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
            const rec = await addMaterial(f);
            const img = fitImage(await decodeRecord(rec), 1024, 1024);
            setMine((m) => [...m, { rec, img }]);
            setSel({ kind: 'mine', rec, img });
          } catch {
            ed.toast('That file could not be opened as a picture.');
          }
        }}
      />
      {mine.length === 0 && <p className="hint">Add your own pictures (patterns, textures, backgrounds) to reuse them in any artwork.</p>}
      <div className="material-grid">
        {mine.map(({ rec, img }) => (
          <button key={rec.id} className={`material-item ${sel?.kind === 'mine' && sel.rec.id === rec.id ? 'on' : ''}`} onClick={() => setSel({ kind: 'mine', rec, img })} title={rec.name}>
            <TilePreview tile={img} />
            <span>{rec.name}</span>
          </button>
        ))}
      </div>
      {sel && (
        <>
          <div className="section-title">
            <span>{name}</span>
            {sel.kind === 'mine' && (
              <IconButton
                icon="trash"
                label="Remove from my materials"
                size={16}
                onClick={async () => {
                  await deleteMaterial(sel.rec.id);
                  setMine((m) => m.filter((x) => x.rec.id !== sel.rec.id));
                  setSel(null);
                }}
              />
            )}
          </div>
          <div className="field">
            <span>Color</span>
            <Segmented
              value={opts.color}
              onChange={(c) => setSettings((s) => ({ materials: { ...s.materials, color: c } }))}
              options={[
                { value: 'fg', label: 'Current color' },
                { value: 'black', label: 'Black' },
                ...(sel.kind === 'mine' ? [{ value: 'original' as const, label: 'Original' }] : []),
              ]}
            />
          </div>
          <Slider label="Scale" value={opts.scale} min={10} max={400} step={1} log format={(v) => `${Math.round(v)}%`} onChange={(v) => setSettings((s) => ({ materials: { ...s.materials, scale: v } }))} />
          <TilePreview tile={tileFor(sel, Math.min(scale, 1))} />
          <div className="filter-actions">
            {sel.kind === 'mine' && (
              <button className="btn" onClick={place}>
                Place picture
              </button>
            )}
            <button className="btn" onClick={tileOnLayer} title="Tile over the selection (or the whole canvas) on the current layer">
              Fill current layer
            </button>
            <button className="btn primary" onClick={tileOnNewLayer}>
              <Icon name="plus" size={16} /> New layer
            </button>
          </div>
          <p className="hint">{ed.doc.selection ? 'Fills inside the selection.' : 'Fills the whole canvas — make a selection first to limit it.'}</p>
        </>
      )}
    </Panel>
  );
}
