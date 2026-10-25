import type { ToolId } from '../../store/settings';

export interface ToolPointer {
  /** Document coordinates. */
  x: number;
  y: number;
  /** Screen CSS pixel coordinates relative to the canvas. */
  sx: number;
  sy: number;
  pressure: number;
  tiltX: number;
  tiltY: number;
  time: number;
  pointerType: string;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
}

export interface Tool {
  readonly id: ToolId;
  down(e: ToolPointer): void;
  move(events: ToolPointer[]): void;
  up(e: ToolPointer): void;
  /** Abort the operation in progress (e.g. a second finger turned it into a gesture). */
  cancel(): void;
  /** Draw guides on the overlay canvas (CSS pixel space). */
  overlay?(ctx: CanvasRenderingContext2D): void;
  activate?(): void;
  /** Called when switching away; tools with pending work commit it here. */
  deactivate?(): void;
  /** True while the tool has an uncommitted operation. */
  busy?(): boolean;
}
