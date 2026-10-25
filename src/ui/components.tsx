import { useEffect, useRef, useState, type ReactNode } from 'react';

/** setPointerCapture throws for pointers the browser no longer tracks; never let that abort a handler. */
export function capture(el: Element | null | undefined, pointerId: number): void {
  try {
    el?.setPointerCapture(pointerId);
  } catch {
    /* pointer already released */
  }
}

const ICONS: Record<string, string> = {
  brush: 'M4 20l4-1 11-11a2.1 2.1 0 00-3-3L5 16l-1 4z M14 7l3 3',
  eraser: 'M9 20h11 M5.4 13.6l7.3-7.3a2 2 0 012.8 0l2.2 2.2a2 2 0 010 2.8L10 19H8l-2.6-2.6a2 2 0 010-2.8z M9 10l5 5',
  smudge: 'M9 11V5a1.8 1.8 0 013.6 0v5 M12.6 10V8.5a1.8 1.8 0 013.6 0V12 M9 11.5a1.8 1.8 0 00-3.6 0V14c0 4 2.8 7 6.6 7 3.4 0 5.6-2.6 5.6-6.2V11a1.6 1.6 0 00-3.2 0',
  blur: 'M12 3s6 6.5 6 11a6 6 0 01-12 0c0-4.5 6-11 6-11z M9 15a3 3 0 003 3',
  fill: 'M5.5 11.5l6-6 7 7-6 6a2 2 0 01-2.8 0l-4.2-4.2a2 2 0 010-2.8z M5 12.5h13.5 M20.5 15.5s1.5 2 1.5 3a1.5 1.5 0 01-3 0c0-1 1.5-3 1.5-3z M9 3l2.5 2.5',
  lassoFill: 'M12 4c4.4 0 8 2.2 8 5s-3.6 5-8 5-8-2.2-8-5 3.6-5 8-5z M7 13c-1.2 1.6-1.2 3.4 0 4.4s3.3-.2 3.3 2.1',
  select: 'M4 8V4h4 M16 4h4v4 M20 16v4h-4 M8 20H4v-4 M11 4h2 M11 20h2 M4 11v2 M20 11v2',
  transform: 'M12 3v18 M3 12h18 M9 6l3-3 3 3 M9 18l3 3 3-3 M6 9l-3 3 3 3 M18 9l3 3-3 3',
  eyedropper: 'M18.5 3.5a2.1 2.1 0 00-3 0L13 6l-1-1-2 2 1 1-6.5 6.5V18H8l6.5-6.5 1 1 2-2-1-1 2.5-2.5a2.1 2.1 0 000-3z',
  hand: 'M8 13V6a1.5 1.5 0 013 0v5.5 M11 11V4.5a1.5 1.5 0 013 0V11 M14 11V6a1.5 1.5 0 013 0v7.5 M8 13l-1.6-2.2a1.5 1.5 0 00-2.4 1.8L7 17.5c1.5 2.3 3.5 3.5 6 3.5 3.3 0 4.9-2.4 4.9-6',
  undo: 'M9 14L4 9l5-5 M4 9h10.5a5.5 5.5 0 010 11H11',
  redo: 'M15 14l5-5-5-5 M20 9H9.5a5.5 5.5 0 000 11H13',
  layers: 'M12 3l9 4.5-9 4.5-9-4.5z M3 12l9 4.5 9-4.5 M3 16.5L12 21l9-4.5',
  menu: 'M4 6h16 M4 12h16 M4 18h16',
  plus: 'M12 5v14 M5 12h14',
  trash: 'M4 7h16 M10 11v6 M14 11v6 M6 7l1 13h10l1-13 M9 7V4h6v3',
  copy: 'M9 9h11v11H9z M15 9V4H4v11h5',
  eye: 'M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z M12 9a3 3 0 100 6 3 3 0 000-6z',
  eyeOff: 'M3 3l18 18 M10.5 5.6A10 10 0 0112 5.5c6.4 0 10 6.5 10 6.5a17 17 0 01-2.8 3.6 M6.6 6.7C3.8 8.5 2 12 2 12s3.6 6.5 10 6.5a9.7 9.7 0 004.9-1.3 M9.9 9.9a3 3 0 004.2 4.2',
  lock: 'M6 11h12v9H6z M8.5 11V7.5a3.5 3.5 0 017 0V11',
  unlock: 'M6 11h12v9H6z M8.5 11V7.5a3.5 3.5 0 016.8-1.2',
  clip: 'M8 4v8a4 4 0 004 4h7 M16 13l3 3-3 3',
  folder: 'M3 6.5h6l2 2h10V19H3z',
  merge: 'M12 4v11 M7.5 10.5L12 15l4.5-4.5 M5 20h14',
  back: 'M15 18l-6-6 6-6',
  settings: 'M12 8.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7z M12 2.5v3 M12 18.5v3 M2.5 12h3 M18.5 12h3 M5.3 5.3l2.1 2.1 M16.6 16.6l2.1 2.1 M5.3 18.7l2.1-2.1 M16.6 7.4l2.1-2.1',
  close: 'M6 6l12 12 M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7',
  flipH: 'M12 3v18 M8.5 7L4 12l4.5 5z M15.5 7L20 12l-4.5 5z',
  flipV: 'M3 12h18 M7 8.5L12 4l5 4.5z M7 15.5L12 20l5-4.5z',
  rotate: 'M19.5 11A7.5 7.5 0 1017.3 16.3 M20 4.5V11h-6.5',
  image: 'M4 5h16v14H4z M4 16l5-5 4 4 2.5-2.5L20 17 M15.5 8.5h.01',
  download: 'M12 4v11 M7.5 10.5L12 15l4.5-4.5 M5 20h14',
  upload: 'M12 15V4 M7.5 8.5L12 4l4.5 4.5 M5 20h14',
  more: 'M6 12h.01 M12 12h.01 M18 12h.01',
  alphaLock: 'M4 4h8v8H4z M12 12h8v8h-8z M4 12h8v8H4z M12 4h8v8h-8z',
  star: 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z',
  fit: 'M4 9V4h5 M20 9V4h-5 M4 15v5h5 M20 15v5h-5',
  hide: 'M4 4h16v16H4z M4 9h16',
  palette: 'M12 3a9 9 0 100 18c1 0 1.5-.8 1.5-1.6 0-1.2-1-1.4-1-2.4 0-.9.7-1.5 1.6-1.5H16a5 5 0 005-5c0-4-4-7.5-9-7.5z M7.5 11h.01 M9.5 7h.01 M14.5 7h.01',
  canvas: 'M5 5h14v14H5z M9 9h6v6H9z',
  wand: 'M4 20L15 9 M17 3v3 M20 6h-3 M21 3l-2 2 M14 4l1 2 M19 10l2 1',
  rect: 'M5 6h14v12H5z',
  ellipse: 'M12 6c4.4 0 8 2.7 8 6s-3.6 6-8 6-8-2.7-8-6 3.6-6 8-6z',
  lasso: 'M12 4c4.4 0 8 2.2 8 5s-3.6 5-8 5-8-2.2-8-5 3.6-5 8-5z M7 13c-1.2 1.6-1.2 3.4 0 4.4s3.3-.2 3.3 2.1',
  invert: 'M12 3a9 9 0 100 18z M12 3a9 9 0 010 18',
  share: 'M12 15V3 M7.5 7.5L12 3l4.5 4.5 M5 12v8h14v-8',
  ruler: 'M3 17L17 3l4 4L7 21z M7 13l2 2 M10 10l2 2 M13 7l2 2',
  symmetry: 'M12 3v18 M9 7C5.5 8 4.5 11 5.3 14S8.5 18 10 18 M15 7c3.5 1 4.5 4 3.7 7s-3.2 4-4.7 4',
  grid: 'M4 4h16v16H4z M4 9.3h16 M4 14.6h16 M9.3 4v16 M14.6 4v16',
  shape: 'M3.5 20l6-11 6 11z M14 4h6.5v6.5H14z',
  gradient: 'M4 4h16v16H4z M7 4v16 M10.5 4v16 M14.5 4v16',
  reference: 'M3 7h12v12H3z M7 3h14v12h-2 M3 16l4-4 3 3 2-2 3 3',
  distort: 'M5 5l14 2.5-2.5 12L4 16.5z',
  mesh: 'M4 4h16v16H4z M4 12c5.3-2.5 10.7 2.5 16 0 M12 4c-2.5 5.3 2.5 10.7 0 16',
  filter: 'M12 3l2.2 5.5L20 9l-4.4 3.9L17 19l-5-3.2L7 19l1.4-6.1L4 9l5.8-.5z M12 8v5',
  text: 'M5 6V4h14v2 M12 4v16 M9 20h6',
  balloon: 'M12 4c4.97 0 9 3.13 9 7s-4.03 7-9 7c-.9 0-1.77-.1-2.6-.3L5 20l1.2-3.6C4.2 15.1 3 13.2 3 11c0-3.87 4.03-7 9-7z',
  frame: 'M3 3h18v18H3z M3 10h18 M12 10v11',
  materials: 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z M4 4l7 7 M13 4l7 7 M4 13l7 7 M13 13l7 7',
  tone: 'M4 4h16v16H4z M8 8h.01 M12 8h.01 M16 8h.01 M8 12h.01 M12 12h.01 M16 12h.01 M8 16h.01 M12 16h.01 M16 16h.01',
  brushPlus: 'M4 20l4-1 9-9a2.1 2.1 0 00-3-3L5 16l-1 4z M17 15v6 M14 18h6',
};

export function Icon({ name, size = 22 }: { name: string; size?: number }) {
  const d = ICONS[name] ?? ICONS.more;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={name === 'more' ? 3 : 1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export function IconButton(props: {
  icon: string;
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  size?: number;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`icon-btn ${props.active ? 'active' : ''} ${props.className ?? ''}`}
      onClick={props.onClick}
      disabled={props.disabled}
      title={props.label}
      aria-label={props.label}
      aria-pressed={props.active}
    >
      <Icon name={props.icon} size={props.size} />
      {props.children}
    </button>
  );
}

/** Pointer-driven slider that works with fingers and styluses, horizontal or vertical. */
export function Slider(props: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  onCommit?: (v: number) => void;
  log?: boolean;
  step?: number;
  vertical?: boolean;
  label?: string;
  format?: (v: number) => string;
  className?: string;
}) {
  const { value, min, max, log, vertical } = props;
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const toT = (v: number) => (log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min));
  const fromT = (t: number) => {
    t = Math.min(1, Math.max(0, t));
    let v = log ? min * Math.pow(max / min, t) : min + (max - min) * t;
    if (props.step) v = Math.round(v / props.step) * props.step;
    return Math.min(max, Math.max(min, v));
  };
  const at = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return vertical ? 1 - (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width;
  };
  const t = Math.min(1, Math.max(0, toT(value)));
  const fmt = props.format ?? ((v: number) => (Number.isInteger(props.step ?? 0.01) && (props.step ?? 0) >= 1 ? String(Math.round(v)) : v.toFixed(2)));
  return (
    <div className={`slider ${vertical ? 'vertical' : ''} ${props.className ?? ''}`}>
      {props.label && !vertical && (
        <div className="slider-label">
          <span>{props.label}</span>
          <span className="slider-value">{fmt(value)}</span>
        </div>
      )}
      <div
        ref={ref}
        className="slider-track"
        role="slider"
        aria-label={props.label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        tabIndex={0}
        onPointerDown={(e) => {
          e.preventDefault();
          capture(e.target as Element, e.pointerId);
          dragging.current = true;
          props.onChange(fromT(at(e)));
        }}
        onPointerMove={(e) => {
          if (dragging.current) props.onChange(fromT(at(e)));
        }}
        onPointerUp={(e) => {
          if (!dragging.current) return;
          dragging.current = false;
          props.onCommit?.(fromT(at(e)));
        }}
        onPointerCancel={() => (dragging.current = false)}
        onKeyDown={(e) => {
          const k = e.key;
          const d = (k === 'ArrowRight' || k === 'ArrowUp' ? 1 : k === 'ArrowLeft' || k === 'ArrowDown' ? -1 : 0) * 0.02;
          if (d) {
            const v = fromT(t + d);
            props.onChange(v);
            props.onCommit?.(v);
          }
        }}
      >
        <div className="slider-fill" style={vertical ? { height: `${t * 100}%` } : { width: `${t * 100}%` }} />
        <div className="slider-thumb" style={vertical ? { bottom: `${t * 100}%` } : { left: `${t * 100}%` }} />
      </div>
      {vertical && <div className="slider-vvalue">{fmt(value)}</div>}
    </div>
  );
}

export function Panel(props: { title: string; onClose: () => void; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <div className={`panel ${props.className ?? ''}`} role="dialog" aria-label={props.title} onPointerDown={(e) => e.stopPropagation()}>
      <div className="panel-head">
        <span className="panel-title">{props.title}</span>
        <div className="panel-actions">
          {props.actions}
          <IconButton icon="close" label="Close" onClick={props.onClose} size={20} />
        </div>
      </div>
      <div className="panel-body">{props.children}</div>
    </div>
  );
}

export function Toggle(props: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <span>{props.label}</span>
      <input type="checkbox" checked={props.value} onChange={(e) => props.onChange(e.target.checked)} />
      <span className="toggle-ui" />
    </label>
  );
}

export function Segmented<T extends string>(props: { value: T; options: { value: T; label: string; icon?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="radiogroup">
      {props.options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={props.value === o.value}
          className={props.value === o.value ? 'on' : ''}
          onClick={() => props.onChange(o.value)}
          title={o.label}
        >
          {o.icon ? <Icon name={o.icon} size={18} /> : null}
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

/** Modal dialog with a dimmed backdrop. */
export function Dialog(props: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [props]);
  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={props.title}>
        <div className="panel-head">
          <span className="panel-title">{props.title}</span>
          <IconButton icon="close" label="Close" onClick={props.onClose} size={20} />
        </div>
        <div className="dialog-body">{props.children}</div>
        {props.footer && <div className="dialog-foot">{props.footer}</div>}
      </div>
    </div>
  );
}

export function NumberField(props: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; suffix?: string }) {
  const [text, setText] = useState(String(props.value));
  useEffect(() => setText(String(props.value)), [props.value]);
  return (
    <label className="field">
      <span>{props.label}</span>
      <span className="field-input">
        <input
          inputMode="numeric"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            let v = Number(text);
            if (!Number.isFinite(v)) v = props.value;
            if (props.min !== undefined) v = Math.max(props.min, v);
            if (props.max !== undefined) v = Math.min(props.max, v);
            props.onChange(v);
            setText(String(v));
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        {props.suffix && <em>{props.suffix}</em>}
      </span>
    </label>
  );
}
