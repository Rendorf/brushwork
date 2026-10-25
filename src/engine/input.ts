import type { Editor } from './editor';
import type { ToolPointer } from './tools/tool';
import type { GestureStart } from './viewport';
import { getSettings, setColorRGB } from '../store/settings';

interface Tracked {
  id: number;
  type: string;
  x: number;
  y: number;
  x0: number;
  y0: number;
}

const TAP_MS = 350;
const TAP_SLOP = 12;
const LONG_PRESS_MS = 550;
const LONG_PRESS_SLOP = 6;

/**
 * Turns pointer, wheel and touch input on the canvas into tool calls and view changes:
 * pen/mouse/finger drawing, palm rejection, two-finger pinch/rotate/pan, two- and
 * three-finger tap undo/redo, long-press eyedropper and wheel zoom.
 */
export class InputController {
  private pointers = new Map<number, Tracked>();
  private drawId: number | null = null;
  private gesture: { start: GestureStart; ids: [number, number] } | null = null;
  private pan: { id: number; x: number; y: number } | null = null;
  private tap: { t0: number; max: number; moved: boolean } | null = null;
  private longPress = 0;
  private picking = false;
  private lastPressure = 1;
  private penSeen = false;
  private rect: DOMRect;

  constructor(private el: HTMLElement, private ed: Editor) {
    this.rect = el.getBoundingClientRect();
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onCancel);
    el.addEventListener('pointerleave', this.onLeave);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', prevent);
    // Safari's own pinch-zoom gesture events.
    el.addEventListener('gesturestart', prevent);
    el.addEventListener('gesturechange', prevent);
    el.addEventListener('touchstart', preventMulti, { passive: false });
  }

  detach(): void {
    const el = this.el;
    el.removeEventListener('pointerdown', this.onDown);
    el.removeEventListener('pointermove', this.onMove);
    el.removeEventListener('pointerup', this.onUp);
    el.removeEventListener('pointercancel', this.onCancel);
    el.removeEventListener('pointerleave', this.onLeave);
    el.removeEventListener('wheel', this.onWheel);
    el.removeEventListener('contextmenu', prevent);
    el.removeEventListener('gesturestart', prevent);
    el.removeEventListener('gesturechange', prevent);
    el.removeEventListener('touchstart', preventMulti);
    clearTimeout(this.longPress);
  }

  private stylusOnly(): boolean {
    const m = getSettings().stylusMode;
    return m === 'on' || (m === 'auto' && this.penSeen);
  }

  private tp(e: PointerEvent, isDown = false): ToolPointer {
    const sx = e.clientX - this.rect.left;
    const sy = e.clientY - this.rect.top;
    const d = this.ed.viewport.toDoc(sx, sy);
    let pressure = 1;
    if (e.pointerType === 'pen') {
      pressure = e.pressure;
      if (pressure <= 0) pressure = isDown ? 0.3 : this.lastPressure;
    }
    return {
      x: d.x,
      y: d.y,
      sx,
      sy,
      pressure,
      tiltX: e.tiltX || 0,
      tiltY: e.tiltY || 0,
      time: e.timeStamp,
      pointerType: e.pointerType,
      shift: e.shiftKey,
      alt: e.altKey,
      ctrl: e.ctrlKey || e.metaKey,
    };
  }

  private touchIds(): number[] {
    return [...this.pointers.values()].filter((p) => p.type === 'touch').map((p) => p.id);
  }

  private onDown = (e: PointerEvent) => {
    this.rect = this.el.getBoundingClientRect();
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      /* some browsers refuse capture for synthetic events */
    }
    const x = e.clientX - this.rect.left;
    const y = e.clientY - this.rect.top;
    this.pointers.set(e.pointerId, { id: e.pointerId, type: e.pointerType, x, y, x0: x, y0: y });

    if (e.pointerType === 'pen') this.penSeen = true;

    if (e.pointerType === 'mouse') {
      if (e.button === 1 || keys.space || (e.button === 0 && this.ed.tool.id === 'hand')) {
        this.pan = { id: e.pointerId, x, y };
      } else if (e.button === 2) {
        const p = this.tp(e, true);
        const c = this.ed.pickColor(p.x, p.y, getSettings().eyedropperSource);
        if (c) setColorRGB(...c);
      } else if (e.button === 0) {
        this.beginDraw(e);
      }
      return;
    }

    if (e.pointerType === 'touch') {
      const touches = this.touchIds();
      if (!this.tap || touches.length === 1) this.tap = { t0: e.timeStamp, max: 0, moved: false };
      this.tap.max = Math.max(this.tap.max, touches.length);
      if (touches.length >= 2) {
        // A second finger turns whatever was happening into a view gesture.
        if (this.drawId !== null && this.pointers.get(this.drawId)?.type === 'touch') this.abortDraw();
        this.pan = null;
        this.startGesture(touches[0], touches[1]);
        return;
      }
      if (this.stylusOnly() || this.ed.tool.id === 'hand') {
        this.pan = { id: e.pointerId, x, y };
        return;
      }
      if (this.drawId === null) this.beginDraw(e);
      return;
    }

    // Pen
    if (this.drawId === null) {
      if (this.ed.tool.id === 'hand') this.pan = { id: e.pointerId, x, y };
      else this.beginDraw(e);
    }
  };

  private beginDraw(e: PointerEvent): void {
    this.drawId = e.pointerId;
    this.picking = false;
    const p = this.tp(e, true);
    this.lastPressure = p.pressure;
    this.ed.setHover(null);
    this.ed.tool.down(p);
    const s = getSettings();
    const t = this.ed.tool.id;
    if (s.longPressEyedropper && (t === 'brush' || t === 'fill' || t === 'lassoFill')) {
      clearTimeout(this.longPress);
      this.longPress = window.setTimeout(() => this.startPicking(), LONG_PRESS_MS);
    }
  }

  private startPicking(): void {
    if (this.drawId === null) return;
    const tr = this.pointers.get(this.drawId);
    if (!tr) return;
    this.ed.tool.cancel();
    this.picking = true;
    this.pickAt(tr.x, tr.y);
  }

  private pickAt(sx: number, sy: number): void {
    const d = this.ed.viewport.toDoc(sx, sy);
    const c = this.ed.pickColor(d.x, d.y, getSettings().eyedropperSource);
    if (c) setColorRGB(...c);
    this.ed.tools.eyedropper.cancel();
    pickOverlay = { x: sx, y: sy };
    this.ed.requestRender();
  }

  private abortDraw(): void {
    clearTimeout(this.longPress);
    if (this.drawId !== null && !this.picking) this.ed.tool.cancel();
    this.drawId = null;
    this.picking = false;
    pickOverlay = null;
  }

  private startGesture(a: number, b: number): void {
    const pa = this.pointers.get(a)!;
    const pb = this.pointers.get(b)!;
    this.gesture = { start: this.ed.viewport.beginGesture(pa, pb), ids: [a, b] };
  }

  private onMove = (e: PointerEvent) => {
    const tr = this.pointers.get(e.pointerId);
    if (!tr) {
      if ((e.pointerType === 'pen' || e.pointerType === 'mouse') && e.buttons === 0) {
        this.rect = this.el.getBoundingClientRect();
        this.ed.setHover(this.tp(e));
      }
      return;
    }
    const x = e.clientX - this.rect.left;
    const y = e.clientY - this.rect.top;
    tr.x = x;
    tr.y = y;
    if (this.tap && tr.type === 'touch' && Math.hypot(x - tr.x0, y - tr.y0) > TAP_SLOP) this.tap.moved = true;

    if (this.gesture && this.gesture.ids.includes(e.pointerId)) {
      const [a, b] = this.gesture.ids.map((id) => this.pointers.get(id)!);
      if (a && b) {
        this.ed.viewport.updateGesture(this.gesture.start, a, b);
        this.ed.requestRender();
      }
      return;
    }
    if (this.pan && this.pan.id === e.pointerId) {
      this.ed.viewport.panBy(x - this.pan.x, y - this.pan.y);
      this.pan.x = x;
      this.pan.y = y;
      this.ed.requestRender();
      return;
    }
    if (this.drawId === e.pointerId) {
      if (Math.hypot(x - tr.x0, y - tr.y0) > LONG_PRESS_SLOP) clearTimeout(this.longPress);
      if (this.picking) {
        this.pickAt(x, y);
        return;
      }
      const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      const events = (list.length ? list : [e]).map((ev) => this.tp(ev));
      this.lastPressure = events[events.length - 1].pressure;
      this.ed.tool.move(events);
      if (e.pointerType !== 'touch') this.ed.setHover(events[events.length - 1]);
    }
  };

  private onUp = (e: PointerEvent) => {
    const tr = this.pointers.get(e.pointerId);
    if (this.drawId === e.pointerId) {
      clearTimeout(this.longPress);
      if (this.picking) {
        this.picking = false;
        pickOverlay = null;
        this.ed.requestRender();
      } else {
        const p = this.tp(e);
        p.pressure = this.lastPressure;
        this.ed.tool.up(p);
      }
      this.drawId = null;
    }
    this.pointers.delete(e.pointerId);
    if (this.pan?.id === e.pointerId) this.pan = null;
    if (this.gesture && this.gesture.ids.includes(e.pointerId)) {
      this.gesture = null;
      const rest = this.touchIds();
      if (rest.length >= 2) this.startGesture(rest[0], rest[1]);
    }
    if (tr?.type === 'touch' && this.touchIds().length === 0) {
      const tap = this.tap;
      this.tap = null;
      if (tap && !tap.moved && e.timeStamp - tap.t0 < TAP_MS && getSettings().twoFingerUndo) {
        if (tap.max === 2) this.ed.history.undo();
        else if (tap.max === 3) this.ed.history.redo();
      }
    }
  };

  private onCancel = (e: PointerEvent) => {
    if (this.drawId === e.pointerId) this.abortDraw();
    this.pointers.delete(e.pointerId);
    if (this.pan?.id === e.pointerId) this.pan = null;
    if (this.gesture?.ids.includes(e.pointerId)) this.gesture = null;
    if (this.touchIds().length === 0) this.tap = null;
  };

  private onLeave = (e: PointerEvent) => {
    if (!this.pointers.has(e.pointerId)) this.ed.setHover(null);
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.rect = this.el.getBoundingClientRect();
    const sx = e.clientX - this.rect.left;
    const sy = e.clientY - this.rect.top;
    const v = this.ed.viewport;
    const scale = e.deltaMode === 1 ? 16 : 1;
    const dx = e.deltaX * scale;
    const dy = e.deltaY * scale;
    if (e.ctrlKey || e.metaKey) {
      v.zoomAt(Math.exp(-dy * 0.01), sx, sy);
    } else if (e.altKey) {
      v.rotateAt(dy * 0.004, sx, sy);
    } else if (e.deltaMode === 1 || (dx === 0 && Math.abs(dy) >= 50 && Number.isInteger(dy))) {
      // A notched mouse wheel: zoom like most painting apps.
      v.zoomAt(dy > 0 ? 1 / 1.15 : 1.15, sx, sy);
    } else {
      v.panBy(-dx, -dy);
    }
    this.ed.requestRender();
  };
}

/** Keys held down that change how the pointer behaves (space = pan). */
export const keys = { space: false };

/** Screen point where the long-press color loupe is shown. */
export let pickOverlay: { x: number; y: number } | null = null;

function prevent(e: Event) {
  e.preventDefault();
}

function preventMulti(e: TouchEvent) {
  if (e.touches.length > 1) e.preventDefault();
}
