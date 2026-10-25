import { useEffect, useRef, useState } from 'react';
import { deleteArtwork, duplicateArtwork, getThumb, listArtworks, newArtworkId, renameArtwork, type ArtworkMeta } from '../storage/gallery';
import { Dialog, Icon, IconButton, NumberField, Segmented } from './components';
import type { OpenRequest } from './EditorView';

interface Preset {
  label: string;
  w: number;
  h: number;
  dpi: number;
}

function screenPreset(): Preset {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  return { label: 'Screen size', w: Math.round(screen.width * dpr), h: Math.round(screen.height * dpr), dpi: 72 };
}

const PRESETS: Preset[] = [
  { label: 'Square', w: 2048, h: 2048, dpi: 72 },
  { label: 'Social (9:16)', w: 1080, h: 1920, dpi: 72 },
  { label: 'Widescreen 16:9', w: 1920, h: 1080, dpi: 72 },
  { label: 'A4 · 350 dpi', w: 2894, h: 4093, dpi: 350 },
  { label: 'B5 · 350 dpi', w: 2508, h: 3541, dpi: 350 },
  { label: 'A5 · 350 dpi', w: 2039, h: 2894, dpi: 350 },
  { label: 'Postcard · 350 dpi', w: 1378, h: 2039, dpi: 350 },
  { label: 'Icon', w: 1024, h: 1024, dpi: 72 },
  { label: '4K', w: 3840, h: 2160, dpi: 72 },
];

let maxTex = 0;
function maxTextureSize(): number {
  if (!maxTex) {
    const gl = document.createElement('canvas').getContext('webgl2');
    maxTex = gl ? (gl.getParameter(gl.MAX_TEXTURE_SIZE) as number) : 4096;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  }
  return Math.min(maxTex, 8192);
}

/** Rough layer budget, similar to how mobile painting apps cap layers by canvas size. */
function layerEstimate(w: number, h: number): number {
  const gb = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 4;
  const budget = Math.min(gb, 8) * 1024 * 1024 * 1024 * 0.3;
  return Math.max(1, Math.floor(budget / (w * h * 4)) - 4);
}

function NewCanvasDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (r: OpenRequest) => void }) {
  const all = [screenPreset(), ...PRESETS];
  const [sel, setSel] = useState(1);
  const [w, setW] = useState(all[1].w);
  const [h, setH] = useState(all[1].h);
  const [dpi, setDpi] = useState(all[1].dpi);
  const [name, setName] = useState('Untitled');
  const [bg, setBg] = useState<'white' | 'transparent'>('white');
  const max = maxTextureSize();
  const pick = (i: number) => {
    setSel(i);
    setW(Math.min(all[i].w, max));
    setH(Math.min(all[i].h, max));
    setDpi(all[i].dpi);
  };
  return (
    <Dialog
      title="New canvas"
      onClose={onClose}
      footer={
        <button
          className="btn primary"
          onClick={() =>
            onCreate({ kind: 'new', id: newArtworkId(), width: w, height: h, dpi, name: name.trim() || 'Untitled', transparent: bg === 'transparent', bg: [255, 255, 255] })
          }
        >
          Create
        </button>
      }
    >
      <div className="preset-list">
        {all.map((p, i) => (
          <button key={p.label} className={`preset ${sel === i ? 'on' : ''}`} onClick={() => pick(i)}>
            <span className="preset-shape" style={{ aspectRatio: `${p.w} / ${p.h}` }} />
            <span className="preset-label">{p.label}</span>
            <span className="preset-size">
              {p.w} × {p.h}
            </span>
          </button>
        ))}
      </div>
      <label className="field">
        <span>Name</span>
        <span className="field-input">
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </span>
      </label>
      <NumberField label="Width" value={w} min={16} max={max} suffix="px" onChange={(v) => { setW(v); setSel(-1); }} />
      <NumberField label="Height" value={h} min={16} max={max} suffix="px" onChange={(v) => { setH(v); setSel(-1); }} />
      <NumberField label="Resolution" value={dpi} min={36} max={1200} suffix="dpi" onChange={setDpi} />
      <div className="field">
        <span>Background</span>
        <Segmented
          value={bg}
          onChange={setBg}
          options={[
            { value: 'white', label: 'White' },
            { value: 'transparent', label: 'Transparent' },
          ]}
        />
      </div>
      <p className="hint">
        About {layerEstimate(w, h)} layers fit in memory on this device at this size. Largest canvas here: {max}px.
      </p>
    </Dialog>
  );
}

function Card({ a, onOpen, onChanged }: { a: ArtworkMeta; onOpen: () => void; onChanged: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    let u: string | null = null;
    getThumb(a.id).then((b) => {
      if (b) setUrl((u = URL.createObjectURL(b)));
    });
    return () => {
      if (u) URL.revokeObjectURL(u);
    };
  }, [a.id, a.updated]);
  return (
    <div className="card">
      <button className="card-thumb" onClick={onOpen} aria-label={`Open ${a.name}`}>
        {url ? <img src={url} alt="" /> : <span className="card-empty" />}
      </button>
      <div className="card-info">
        <div>
          <div className="card-name">{a.name}</div>
          <div className="card-sub">
            {a.width}×{a.height} · {a.layerCount} layer{a.layerCount === 1 ? '' : 's'} · {new Date(a.updated).toLocaleDateString()}
          </div>
        </div>
        <IconButton icon="more" label="Artwork options" onClick={() => setMenu(!menu)} size={20} />
      </div>
      {menu && (
        <div className="card-menu" onMouseLeave={() => setMenu(false)}>
          <button
            onClick={async () => {
              setMenu(false);
              const n = prompt('Rename artwork', a.name);
              if (n && n.trim()) {
                await renameArtwork(a.id, n.trim());
                onChanged();
              }
            }}
          >
            Rename
          </button>
          <button
            onClick={async () => {
              setMenu(false);
              await duplicateArtwork(a.id);
              onChanged();
            }}
          >
            Duplicate
          </button>
          <button
            className="danger"
            onClick={async () => {
              setMenu(false);
              if (confirm(`Delete "${a.name}"? This cannot be undone.`)) {
                await deleteArtwork(a.id);
                onChanged();
              }
            }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

export function Gallery({ onOpen }: { onOpen: (r: OpenRequest) => void }) {
  const [list, setList] = useState<ArtworkMeta[] | null>(null);
  const [creating, setCreating] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const refresh = () => listArtworks().then(setList).catch(() => setList([]));
  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="gallery">
      <header className="gallery-head">
        <div className="brand">
          <img src="./icons/icon.svg" alt="" width={32} height={32} />
          <h1>Brushwork</h1>
        </div>
        <div className="gallery-actions">
          <button className="btn" onClick={() => fileRef.current?.click()}>
            <Icon name="upload" size={18} /> Import
          </button>
          <button className="btn primary" onClick={() => setCreating(true)}>
            <Icon name="plus" size={18} /> New canvas
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          hidden
          accept="image/*,.psd,.brushwork"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) onOpen({ kind: 'import', id: newArtworkId(), file: f });
          }}
        />
      </header>
      {list && list.length === 0 && (
        <div className="empty">
          <h2>Start your first artwork</h2>
          <p>Pressure-sensitive brushes, layers, blend modes, selections and more — free, and it works offline.</p>
          <button className="btn primary big" onClick={() => setCreating(true)}>
            <Icon name="plus" size={20} /> New canvas
          </button>
        </div>
      )}
      <div className="grid">
        {list?.map((a) => (
          <Card key={a.id} a={a} onOpen={() => onOpen({ kind: 'open', id: a.id })} onChanged={refresh} />
        ))}
      </div>
      <footer className="gallery-foot">Your artworks are stored only on this device. Export them to back them up.</footer>
      {creating && (
        <NewCanvasDialog
          onClose={() => setCreating(false)}
          onCreate={(r) => {
            setCreating(false);
            onOpen(r);
          }}
        />
      )}
    </div>
  );
}
