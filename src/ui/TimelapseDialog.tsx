import { useEffect, useRef, useState } from 'react';
import { deliverFile, safeFileName } from '../engine/io/files';
import { decodeFrame, exportTimelapse, FPS, timelapsePlan } from '../engine/media/timelapseExport';
import { countFrames, type TimelapseRecorder } from '../storage/timelapse';
import { setSettings } from '../store/settings';
import { Dialog, Icon, Segmented, Slider, Toggle } from './components';
import { useEditor, useSettings } from './hooks';

const LENGTHS = [
  { value: '15', label: '15 s' },
  { value: '30', label: '30 s' },
  { value: '60', label: '60 s' },
  { value: 'every', label: 'Every step' },
];

export function TimelapseDialog({ art, recorder, onClose }: { art: string; recorder: TimelapseRecorder | null; onClose: () => void }) {
  const ed = useEditor();
  const s = useSettings((x) => x.timelapse);
  const [count, setCount] = useState<number | null>(null);
  const [length, setLength] = useState('30');
  const [hold, setHold] = useState(2);
  const [finalFull, setFinalFull] = useState(true);
  const [pos, setPos] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const refresh = async () => {
    await recorder?.flush();
    const n = await countFrames(art);
    setCount(n);
    setPos(Math.max(0, n - 1));
  };
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Show the frame at `pos`.
  useEffect(() => {
    if (!count) return;
    let cancelled = false;
    decodeFrame(art, Math.min(pos, count - 1)).then((bmp) => {
      const c = canvasRef.current;
      if (!bmp || !c || cancelled) return bmp?.close();
      const k = Math.min(320 / bmp.width, 240 / bmp.height);
      c.width = Math.round(bmp.width * k);
      c.height = Math.round(bmp.height * k);
      c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close();
    });
    return () => {
      cancelled = true;
    };
  }, [pos, count, art]);

  // Preview playback at roughly the exported speed.
  useEffect(() => {
    if (!playing || !count) return;
    const plan = timelapsePlan(count, length === 'every' ? 'every' : Number(length));
    let k = 0;
    const t = window.setInterval(() => {
      if (k >= plan.indices.length) {
        setPlaying(false);
        return;
      }
      setPos(plan.indices[k]);
      k += Math.max(1, Math.round(plan.indices.length / (FPS * 8)));
    }, 1000 / FPS);
    return () => clearInterval(t);
  }, [playing, count, length]);

  const run = async () => {
    setProgress(0);
    try {
      await recorder?.flush();
      const { blob, ext } = await exportTimelapse(ed, art, { length: length === 'every' ? 'every' : Number(length), hold, finalFull }, setProgress);
      await deliverFile(blob, `${safeFileName(ed.doc.name)}-timelapse.${ext}`);
    } catch (e) {
      ed.toast((e as Error).message);
    } finally {
      setProgress(null);
    }
  };

  const busy = progress !== null;
  return (
    <Dialog
      title="Time-lapse"
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button
            className="btn"
            disabled={busy || !count}
            onClick={async () => {
              if (!confirm('Delete the time-lapse recorded so far for this artwork?')) return;
              await recorder?.reset();
              await refresh();
            }}
          >
            Delete recording
          </button>
          <button className="btn primary" disabled={busy || !count} onClick={run}>
            <Icon name="download" size={18} /> {busy ? `Exporting ${Math.round((progress ?? 0) * 100)}%` : 'Export video'}
          </button>
        </>
      }
    >
      <Toggle label="Record time-lapse" value={s.enabled} onChange={(enabled) => setSettings((x) => ({ timelapse: { ...x.timelapse, enabled } }))} />
      {count === null ? (
        <p className="hint">Loading…</p>
      ) : count === 0 ? (
        <p className="hint">Nothing recorded yet. Every stroke and edit adds a frame while recording is on.</p>
      ) : (
        <>
          <div className="tl-preview">
            <canvas ref={canvasRef} />
          </div>
          <div className="tl-controls">
            <button className="icon-btn" onClick={() => setPlaying(!playing)} aria-label={playing ? 'Pause preview' : 'Play preview'}>
              <Icon name={playing ? 'pause' : 'play'} size={20} />
            </button>
            <Slider value={pos} min={0} max={Math.max(1, count - 1)} step={1} format={(v) => `${Math.round(v) + 1} / ${count}`} onChange={(v) => { setPlaying(false); setPos(Math.round(v)); }} className="tl-scrub" />
          </div>
          <p className="hint">{count} frames recorded.</p>
          <div className="field">
            <span>Length</span>
            <Segmented value={length} onChange={setLength} options={LENGTHS} />
          </div>
          <Slider label="Show the finished artwork for" value={hold} min={0} max={5} step={0.5} format={(v) => `${v} s`} onChange={setHold} />
          <Toggle label="End with a sharp final image" value={finalFull} onChange={setFinalFull} />
          {busy && (
            <div className="progress">
              <div style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} />
            </div>
          )}
        </>
      )}
      <div className="field">
        <span>Recording size</span>
        <Segmented
          value={String(s.size)}
          onChange={(v) => setSettings((x) => ({ timelapse: { ...x.timelapse, size: Number(v) } }))}
          options={[
            { value: '480', label: '480p' },
            { value: '720', label: '720p' },
            { value: '1080', label: '1080p' },
          ]}
        />
      </div>
      <p className="hint">Frames are stored on this device. Changing the size applies to new frames.</p>
    </Dialog>
  );
}
