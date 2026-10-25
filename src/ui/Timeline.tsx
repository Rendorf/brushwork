import { useEffect, useRef, useState } from 'react';
import { animationFrames } from '../engine/animation';
import type { Node } from '../engine/document';
import type { Editor } from '../engine/editor';
import { deliverFile, safeFileName } from '../engine/io/files';
import { exportAnimation } from '../engine/media/animationExport';
import { Dialog, Icon, IconButton, Segmented, Slider, Toggle } from './components';
import { useEditor } from './hooks';

const thumbs = new Map<string, { key: string; img: ImageData }>();

function nodeVersion(ed: Editor, n: Node): string {
  if (n.kind === 'layer') return `${n.contentVersion}:${n.visible}`;
  return ed.doc.allLayers(n).map((l) => `${l.contentVersion}${l.visible ? '' : 'h'}`).join(',') + `:${n.visible}`;
}

function FrameThumb({ node }: { node: Node }) {
  const ed = useEditor();
  const ref = useRef<HTMLCanvasElement>(null);
  const key = `${nodeVersion(ed, node)}:${ed.doc.width}x${ed.doc.height}`;
  useEffect(() => {
    let t = thumbs.get(node.id);
    if (!t || t.key !== key) {
      t = { key, img: ed.nodeThumbnail(node, 64, 48) };
      thumbs.set(node.id, t);
    }
    const c = ref.current!;
    c.width = t.img.width;
    c.height = t.img.height;
    c.getContext('2d')!.putImageData(t.img, 0, 0);
  }, [ed, node, key]);
  return <canvas ref={ref} />;
}

/** Frames strip and controls, shown while the artwork is an animation. */
export function Timeline({ onExport }: { onExport: () => void }) {
  const ed = useEditor();
  const anim = ed.doc.animation!;
  const frames = animationFrames(ed.doc);
  const cur = ed.playing ? ed.compositor.displayFrame ?? 0 : ed.currentFrameIndex();
  const [settings, setSettings] = useState(false);
  const stripRef = useRef<HTMLDivElement>(null);
  const node = frames[cur];

  // Make room for the strip above the bottom bar.
  useEffect(() => {
    const el = document.querySelector('.editor');
    el?.classList.add('anim');
    return () => el?.classList.remove('anim');
  }, []);

  // Keep the current frame in view.
  useEffect(() => {
    stripRef.current?.querySelector('.tl-frame.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [cur]);

  const onion = anim.onionBefore + anim.onionAfter > 0;
  return (
    <div className="timeline" onPointerDown={(e) => e.stopPropagation()}>
      <div className="tl-buttons">
        <IconButton icon={ed.playing ? 'pause' : 'play'} label={ed.playing ? 'Pause' : 'Play'} onClick={() => (ed.playing ? ed.stop() : ed.play())} disabled={frames.length < 2} />
        <IconButton icon="onion" label="Onion skin" active={onion} onClick={() => ed.updateAnimation(onion ? { onionBefore: 0, onionAfter: 0 } : { onionBefore: 1, onionAfter: 0 })} />
        <label className="tl-fps" title="Frames per second">
          <select value={anim.fps} onChange={(e) => ed.updateAnimation({ fps: Number(e.target.value) })} aria-label="Frames per second">
            {[1, 2, 4, 6, 8, 10, 12, 15, 24, 30].map((f) => (
              <option key={f} value={f}>
                {f} fps
              </option>
            ))}
          </select>
        </label>
        <IconButton icon="plus" label="Add frame" onClick={() => ed.addFrame()} />
        <IconButton icon="copy" label="Duplicate frame" disabled={!node} onClick={() => node && ed.duplicateNode(node)} />
        <IconButton icon="trash" label="Delete frame" disabled={!node || frames.length < 2} onClick={() => node && ed.deleteNode(node)} />
        <IconButton icon="settings" label="Animation settings" active={settings} onClick={() => setSettings(!settings)} />
        <IconButton icon="download" label="Export animation" onClick={onExport} />
      </div>
      <div className="tl-frames" ref={stripRef}>
        {frames.map((n, i) => (
          <button key={n.id} className={`tl-frame ${i === cur ? 'on' : ''} ${n.visible ? '' : 'hidden'}`} onClick={() => { ed.stop(); ed.setFrame(i); }} title={n.name}>
            <FrameThumb node={n} />
            <span className="tl-num">{i + 1}</span>
            {n.hold > 1 && <em className="tl-hold">×{n.hold}</em>}
          </button>
        ))}
      </div>
      {settings && (
        <div className="tl-settings">
          {node && (
            <Slider label={`Hold frame ${cur + 1}`} value={node.hold} min={1} max={24} step={1} format={(v) => `${Math.round(v)} frame${v > 1 ? 's' : ''}`} onChange={(hold) => ed.setProps(node, { hold }, { record: false })} onCommit={(hold) => ed.setProps(node, { hold }, { label: 'Frame hold' })} />
          )}
          <Slider label="Onion skin: frames before" value={anim.onionBefore} min={0} max={3} step={1} onChange={(v) => ed.updateAnimation({ onionBefore: v })} />
          <Slider label="Onion skin: frames after" value={anim.onionAfter} min={0} max={3} step={1} onChange={(v) => ed.updateAnimation({ onionAfter: v })} />
          <Slider label="Onion skin opacity" value={anim.onionOpacity * 100} min={5} max={80} step={1} format={(v) => `${Math.round(v)}%`} onChange={(v) => ed.updateAnimation({ onionOpacity: v / 100 })} />
          <Toggle label="Bottom layer is a background for every frame" value={anim.background} onChange={(background) => ed.updateAnimation({ background })} />
          <Toggle label="Loop playback" value={anim.loop} onChange={(loop) => ed.updateAnimation({ loop })} />
          <p className="hint">Each top-level layer or folder is one frame, from the bottom up. Use folders for frames with several layers.</p>
        </div>
      )}
    </div>
  );
}

export function AnimationExportDialog({ onClose }: { onClose: () => void }) {
  const ed = useEditor();
  const [format, setFormat] = useState<'gif' | 'mp4'>('gif');
  const [scale, setScale] = useState('1');
  const [transparent, setTransparent] = useState(false);
  const [loop, setLoop] = useState(true);
  const [repeat, setRepeat] = useState(3);
  const [progress, setProgress] = useState<number | null>(null);
  const frames = animationFrames(ed.doc);
  const s = Number(scale);
  const run = async () => {
    setProgress(0);
    try {
      const { blob, ext } = await exportAnimation(ed, { format, scale: s, transparent, loop, repeat }, setProgress);
      await deliverFile(blob, `${safeFileName(ed.doc.name)}.${ext}`);
      onClose();
    } catch (e) {
      ed.toast((e as Error).message);
    } finally {
      setProgress(null);
    }
  };
  const busy = progress !== null;
  return (
    <Dialog
      title="Export animation"
      onClose={() => !busy && onClose()}
      footer={
        <button className="btn primary" disabled={busy} onClick={run}>
          <Icon name="download" size={18} /> {busy ? `Exporting ${Math.round((progress ?? 0) * 100)}%` : `Export ${format.toUpperCase()}`}
        </button>
      }
    >
      <p className="hint">
        {frames.length} frames at {ed.doc.animation?.fps} fps.
      </p>
      <div className="field">
        <span>Format</span>
        <Segmented
          value={format}
          onChange={setFormat}
          options={[
            { value: 'gif', label: 'GIF' },
            { value: 'mp4', label: 'Video (MP4)' },
          ]}
        />
      </div>
      <div className="field">
        <span>Size</span>
        <Segmented
          value={scale}
          onChange={setScale}
          options={['1', '0.5', '0.25'].map((v) => ({ value: v, label: `${Math.round(ed.doc.width * Number(v))}×${Math.round(ed.doc.height * Number(v))}` }))}
        />
      </div>
      {format === 'gif' ? (
        <>
          <Toggle label="Transparent background" value={transparent} onChange={setTransparent} />
          <Toggle label="Loop forever" value={loop} onChange={setLoop} />
        </>
      ) : (
        <Slider label="Play the sequence" value={repeat} min={1} max={10} step={1} format={(v) => `${Math.round(v)}×`} onChange={setRepeat} />
      )}
      {busy && (
        <div className="progress">
          <div style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} />
        </div>
      )}
    </Dialog>
  );
}
