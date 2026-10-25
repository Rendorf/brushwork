import { useEffect, useRef, useState } from 'react';
import { addRef, deleteRef, listRefs, type RefRecord } from '../storage/refs';
import { setColorRGB, setSettings } from '../store/settings';
import { capture, Icon, IconButton } from './components';
import { useEditor, useSettings } from './hooks';

type Source = { kind: 'bitmap'; bmp: ImageBitmap; w: number; h: number } | null;

const MIN = 160;

/** A movable, resizable window showing a reference picture (or the canvas itself), with color picking. */
export function ReferenceWindow() {
  const ed = useEditor();
  const rw = useSettings((s) => s.refWindow);
  const set = (patch: Partial<typeof rw>) => setSettings((s) => ({ refWindow: { ...s.refWindow, ...patch } }));
  const [refs, setRefs] = useState<RefRecord[]>([]);
  const [src, setSrc] = useState<Source>(null);
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0, fitted: false });
  const [picking, setPicking] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ d: number; zoom: number; mx: number; my: number; vx: number; vy: number } | null>(null);
  const pixels = useRef<ImageData | null>(null);
  const shown = useRef<ImageBitmap | null>(null);

  useEffect(() => {
    listRefs().then(setRefs).catch(() => setRefs([]));
  }, []);

  const current = refs.find((r) => r.id === rw.current) ?? refs[refs.length - 1] ?? null;

  // Decode the picture being shown.
  useEffect(() => {
    let cancelled = false;
    let bmp: ImageBitmap | null = null;
    pixels.current = null;
    (async () => {
      if (rw.source === 'canvas') {
        bmp = await createImageBitmap(ed.docThumbnail(1024));
      } else if (current) {
        bmp = await createImageBitmap(new Blob([current.data], { type: current.type }));
      }
      if (cancelled) return bmp?.close();
      shown.current?.close();
      shown.current = bmp;
      setSrc(bmp ? { kind: 'bitmap', bmp, w: bmp.width, h: bmp.height } : null);
    })().catch(() => setSrc(null));
    return () => {
      cancelled = true;
    };
    // Canvas mode refreshes when the artwork changes (ed.version).
  }, [rw.source, current?.id, rw.source === 'canvas' ? ed.version : 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fit a newly chosen picture.
  useEffect(() => setView((v) => ({ ...v, fitted: false })), [current?.id, rw.source]);

  // Draw.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const bw = rw.w, bh = rw.h - 40;
    c.width = Math.round(bw * dpr);
    c.height = Math.round(bh * dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, bw, bh);
    if (!src) return;
    let v = view;
    if (!v.fitted) {
      const zoom = Math.min(bw / src.w, bh / src.h);
      v = { zoom, x: (bw - src.w * zoom) / 2, y: (bh - src.h * zoom) / 2, fitted: true };
      setView(v);
    }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src.bmp, v.x, v.y, src.w * v.zoom, src.h * v.zoom);
  }, [src, view, rw.w, rw.h]);

  const pickAt = (cx: number, cy: number) => {
    if (!src) return;
    const ix = Math.floor((cx - view.x) / view.zoom), iy = Math.floor((cy - view.y) / view.zoom);
    if (ix < 0 || iy < 0 || ix >= src.w || iy >= src.h) return;
    if (!pixels.current) {
      const c = document.createElement('canvas');
      c.width = src.w;
      c.height = src.h;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(src.bmp, 0, 0);
      pixels.current = ctx.getImageData(0, 0, src.w, src.h);
    }
    const d = pixels.current.data, i = (iy * src.w + ix) * 4;
    if (d[i + 3] > 0) setColorRGB(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255);
  };

  const local = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  /** Drag the window by its header, or resize it by the corner grip. */
  const dragWindow = (mode: 'move' | 'resize') => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const start = { px: e.clientX, py: e.clientY, ...rw };
    const el = e.currentTarget as HTMLElement;
    capture(el, e.pointerId);
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - start.px, dy = ev.clientY - start.py;
      if (mode === 'move') set({ x: Math.max(0, Math.min(window.innerWidth - 80, start.x + dx)), y: Math.max(0, Math.min(window.innerHeight - 60, start.y + dy)) });
      else set({ w: Math.max(MIN, start.w + dx), h: Math.max(MIN, start.h + dy) });
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const idx = current ? refs.indexOf(current) : -1;

  return (
    <div className="ref-window" style={{ left: rw.x, top: rw.y, width: rw.w, height: rw.h }} onPointerDown={(e) => e.stopPropagation()}>
      <div className="ref-head" onPointerDown={dragWindow('move')}>
        <span className="ref-title">{rw.source === 'canvas' ? 'This canvas' : current?.name ?? 'Reference'}</span>
        <div className="ref-actions" onPointerDown={(e) => e.stopPropagation()}>
          <IconButton icon={rw.source === 'canvas' ? 'image' : 'canvas'} label={rw.source === 'canvas' ? 'Show reference picture' : 'Show this canvas'} size={16} onClick={() => set({ source: rw.source === 'canvas' ? 'image' : 'canvas' })} />
          <IconButton icon="eyedropper" label="Pick colors from the picture" size={16} active={picking} onClick={() => setPicking(!picking)} />
          {rw.source === 'image' && (
            <>
              <IconButton icon="back" label="Previous picture" size={16} disabled={idx <= 0} onClick={() => set({ current: refs[idx - 1].id })} />
              <IconButton icon="back" className="flip-x" label="Next picture" size={16} disabled={idx < 0 || idx >= refs.length - 1} onClick={() => set({ current: refs[idx + 1].id })} />
              <IconButton icon="plus" label="Add picture" size={16} onClick={() => fileRef.current?.click()} />
              <IconButton
                icon="trash"
                label="Remove picture"
                size={16}
                disabled={!current}
                onClick={async () => {
                  if (!current) return;
                  await deleteRef(current.id);
                  const next = refs.filter((r) => r.id !== current.id);
                  setRefs(next);
                  set({ current: next[Math.max(0, idx - 1)]?.id ?? null });
                }}
              />
            </>
          )}
          <IconButton icon="close" label="Close reference window" size={16} onClick={() => set({ open: false })} />
        </div>
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
          const rec = await addRef(f);
          setRefs((r) => [...r, rec]);
          set({ current: rec.id, source: 'image' });
        }}
      />
      <canvas
        ref={canvasRef}
        className={`ref-canvas ${picking ? 'picking' : ''}`}
        style={{ width: rw.w, height: rw.h - 40 }}
        onPointerDown={(e) => {
          capture(e.target as Element, e.pointerId);
          const p = local(e);
          pointers.current.set(e.pointerId, p);
          if (picking && pointers.current.size === 1) pickAt(p.x, p.y);
          if (pointers.current.size === 2) {
            const [a, b] = [...pointers.current.values()];
            gesture.current = { d: Math.hypot(b.x - a.x, b.y - a.y) || 1, zoom: view.zoom, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, vx: view.x, vy: view.y };
          }
        }}
        onPointerMove={(e) => {
          const prev = pointers.current.get(e.pointerId);
          if (!prev) return;
          const p = local(e);
          pointers.current.set(e.pointerId, p);
          if (pointers.current.size === 2 && gesture.current) {
            const [a, b] = [...pointers.current.values()];
            const g = gesture.current;
            const zoom = Math.max(0.02, Math.min(32, (g.zoom * Math.hypot(b.x - a.x, b.y - a.y)) / g.d));
            const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
            // Keep the picture point under the starting midpoint under the fingers.
            const ix = (g.mx - g.vx) / g.zoom, iy = (g.my - g.vy) / g.zoom;
            setView({ zoom, x: mx - ix * zoom, y: my - iy * zoom, fitted: true });
          } else if (picking) {
            pickAt(p.x, p.y);
          } else {
            setView((v) => ({ ...v, x: v.x + p.x - prev.x, y: v.y + p.y - prev.y }));
          }
        }}
        onPointerUp={(e) => {
          pointers.current.delete(e.pointerId);
          if (pointers.current.size < 2) gesture.current = null;
        }}
        onPointerCancel={(e) => pointers.current.delete(e.pointerId)}
        onWheel={(e) => {
          const r = canvasRef.current!.getBoundingClientRect();
          const cx = e.clientX - r.left, cy = e.clientY - r.top;
          const k = Math.exp(-e.deltaY * 0.0025);
          setView((v) => {
            const zoom = Math.max(0.02, Math.min(32, v.zoom * k));
            return { zoom, x: cx - ((cx - v.x) / v.zoom) * zoom, y: cy - ((cy - v.y) / v.zoom) * zoom, fitted: true };
          });
        }}
        onDoubleClick={() => setView((v) => ({ ...v, fitted: false }))}
      />
      {!src && (
        <button className="ref-empty" onClick={() => fileRef.current?.click()}>
          <Icon name="image" size={28} />
          <span>Add a reference picture</span>
        </button>
      )}
      <div className="ref-grip" onPointerDown={dragWindow('resize')} aria-label="Resize" />
    </div>
  );
}
