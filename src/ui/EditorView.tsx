import { useCallback, useEffect, useRef, useState } from 'react';
import type { Doc } from '../engine/document';
import { Editor } from '../engine/editor';
import { InputController, keys } from '../engine/input';
import { decodeImage, importPsd } from '../engine/io/files';
import { isProjectFile, readProject } from '../engine/io/serialize';
import type { TransformTool } from '../engine/tools/transformTool';
import { premultiply } from '../engine/util/pixels';
import { getSettings, isBrushTool, setSettings, updateBrushTool, type ToolId } from '../store/settings';
import { loadArtwork, markUnsaved, saveArtwork } from '../storage/gallery';
import { BrushPanel } from './BrushPanel';
import { BottomBar, GuideToggles, SideSliders, ToolGrid, ToolOptions, TOOL_LIST, type PanelId } from './Chrome';
import { ColorPanel } from './ColorPanel';
import { IconButton, Panel } from './components';
import { EditorContext, useEditor, useSettings } from './hooks';
import { LayerPanel } from './LayerPanel';
import { HelpDialog, MainMenu, SettingsPanel } from './Menus';
import { ReferenceWindow } from './ReferenceWindow';

export type OpenRequest =
  | { kind: 'open'; id: string }
  | { kind: 'new'; id: string; width: number; height: number; dpi: number; name: string; transparent: boolean; bg: [number, number, number] }
  | { kind: 'import'; id: string; file: File };

export function EditorView({ req, onExit, toast }: { req: OpenRequest; onExit: () => void; toast: (m: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [ed, setEd] = useState<Editor | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let editor: Editor | null = null;
    let input: InputController | null = null;
    let ro: ResizeObserver | null = null;
    let cancelled = false;
    try {
      editor = new Editor(canvasRef.current!, overlayRef.current!);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    const e = editor;
    const unToast = e.onToast(toast);
    (async () => {
      let doc: Doc;
      let fresh = false;
      if (req.kind === 'open') {
        doc = await loadArtwork(e.gl, req.id);
      } else if (req.kind === 'new') {
        doc = e.newDocument(req.width, req.height, req.dpi);
        doc.name = req.name;
        doc.background = { color: req.bg, transparent: req.transparent };
        fresh = true;
      } else {
        doc = await importFile(e, req.file);
        fresh = true;
      }
      if (cancelled) return doc.dispose();
      e.setDocument(doc);
      if (fresh) {
        markUnsaved(doc);
        e.dirty = true;
      }
      const stage = stageRef.current!;
      input = new InputController(stage, e);
      ro = new ResizeObserver(() => e.resize(stage.clientWidth, stage.clientHeight, Math.min(window.devicePixelRatio || 1, 3)));
      ro.observe(stage);
      e.resize(stage.clientWidth, stage.clientHeight, Math.min(window.devicePixelRatio || 1, 3));
      e.viewport.fit();
      if (import.meta.env.DEV) (window as unknown as { __bw?: Editor }).__bw = e;
      setEd(e);
    })().catch((err) => setError((err as Error).message));
    return () => {
      cancelled = true;
      unToast();
      input?.detach();
      ro?.disconnect();
      e.dispose();
    };
    // The request object identifies the artwork for the lifetime of this view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="editor">
      <div className="stage" ref={stageRef}>
        <canvas ref={canvasRef} className="gl-canvas" />
        <canvas ref={overlayRef} className="overlay-canvas" />
      </div>
      {error && (
        <div className="error-box">
          <p>{error}</p>
          <button className="btn" onClick={onExit}>Back to gallery</button>
        </div>
      )}
      {ed && (
        <EditorContext.Provider value={ed}>
          <EditorChrome id={req.id} onExit={onExit} />
        </EditorContext.Provider>
      )}
    </div>
  );
}

async function importFile(e: Editor, file: File): Promise<Doc> {
  const buf = await file.arrayBuffer();
  const name = file.name.replace(/\.[^.]+$/, '') || 'Imported';
  if (isProjectFile(buf)) return readProject(e.gl, buf);
  if (/\.psd$/i.test(file.name) || new Uint8Array(buf, 0, 4).every((b, i) => b === [0x38, 0x42, 0x50, 0x53][i])) {
    const d = await importPsd(e.gl, buf);
    d.name = name;
    return d;
  }
  const img = await decodeImage(file);
  const max = Math.min(e.gl.getParameter(e.gl.MAX_TEXTURE_SIZE) as number, 8192);
  if (img.width > max || img.height > max) throw new Error(`That image is larger than ${max}px, the limit on this device.`);
  const doc = e.newDocument(img.width, img.height, 72);
  doc.name = name;
  doc.allLayers()[0].surface.upload(0, 0, img.width, img.height, premultiply(img.data));
  doc.allLayers()[0].name = 'Image';
  return doc;
}

function EditorChrome({ id, onExit }: { id: string; onExit: () => void }) {
  const ed = useEditor();
  const [panel, setPanel] = useState<PanelId>(null);
  const [help, setHelp] = useState(false);
  const [hideUI, setHideUI] = useState(false);
  const leftHanded = useSettings((s) => s.leftHanded);
  const tool = useSettings((s) => s.tool);
  const refOpen = useSettings((s) => s.refWindow.open);
  const saving = useRef<Promise<void> | null>(null);

  const save = useCallback(async () => {
    if (saving.current) await saving.current;
    if (ed.tool.busy?.()) return;
    ed.dirty = false;
    saving.current = saveArtwork(ed, id)
      .catch((e) => {
        ed.dirty = true;
        ed.toast(`Autosave failed: ${(e as Error).message}`);
      })
      .finally(() => (saving.current = null));
    await saving.current;
  }, [ed, id]);

  // Autosave a couple of seconds after changes, and when the app goes to the background.
  useEffect(() => {
    const t = window.setInterval(() => {
      if (ed.dirty && !saving.current && !ed.tool.busy?.()) void save();
    }, 2500);
    const hide = () => {
      if (document.visibilityState === 'hidden' && ed.dirty) void save();
    };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', hide);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', hide);
    };
  }, [ed, save]);

  const exit = async () => {
    if (ed.tool.busy?.()) (ed.tool as TransformTool).commit?.();
    ed.dirty = true;
    await save();
    onExit();
  };

  useKeyboard(ed, save, setHideUI, setPanel);

  const zoomPct = Math.round(ed.viewport.zoom * 100);

  if (hideUI) {
    return <button className="show-ui" onClick={() => setHideUI(false)} aria-label="Show interface">Show UI</button>;
  }

  return (
    <>
      <div className="top-bar">
        <IconButton icon="back" label="Back to gallery" onClick={exit} />
        <span className="doc-title">{ed.doc.name}</span>
        <span className="spacer" />
        <GuideToggles />
        <IconButton icon="reference" label="Reference window" active={refOpen} onClick={() => setSettings((s) => ({ refWindow: { ...s.refWindow, open: !s.refWindow.open } }))} />
        <button className="zoom-btn" onClick={() => { ed.viewport.fit(); ed.requestRender(); ed.changed(); }} title="Fit to screen">
          {zoomPct}%
        </button>
        <IconButton icon="flipH" label="Flip view" active={ed.viewport.flip} onClick={() => { ed.viewport.toggleFlip(); ed.changed(); }} />
        <IconButton icon="hide" label="Hide interface" onClick={() => setHideUI(true)} />
      </div>
      <ToolOptions />
      <SideSliders left={!leftHanded} />
      {panel === 'tools' && (
        <Panel title="Tools" onClose={() => setPanel(null)} className="tools-panel">
          <ToolGrid onPick={() => setPanel(null)} />
        </Panel>
      )}
      {panel === 'brush' && <BrushPanel onClose={() => setPanel(null)} />}
      {panel === 'color' && <ColorPanel onClose={() => setPanel(null)} />}
      {panel === 'layers' && <LayerPanel onClose={() => setPanel(null)} />}
      {panel === 'menu' && <MainMenu onClose={() => setPanel(null)} onSave={save} onSettings={() => setPanel('settings')} onHelp={() => { setHelp(true); setPanel(null); }} />}
      {panel === 'settings' && <SettingsPanel onClose={() => setPanel(null)} />}
      {help && <HelpDialog onClose={() => setHelp(false)} />}
      {refOpen && <ReferenceWindow />}
      <BottomBar panel={panel} setPanel={setPanel} />
      <ToolHint tool={tool} />
    </>
  );
}

/** A short hint for tools whose gesture is not obvious. */
function ToolHint({ tool }: { tool: ToolId }) {
  const ed = useEditor();
  const mode = (ed.tools.transform as TransformTool).mode;
  const hints: Partial<Record<ToolId, string>> = {
    transform: mode === 'free' ? 'Drag inside to move, corners to scale, outside to rotate.' : 'Drag the points to reshape; drag inside to move.',
    ruler: 'Drag the handles to place rulers and symmetry.',
    gradient: 'Drag across the canvas to draw the gradient.',
    lassoFill: 'Draw a closed shape to fill it.',
    fill: 'Tap an area to fill it.',
  };
  const h = hints[tool];
  return h ? <div className="tool-hint">{h}</div> : null;
}

function useKeyboard(ed: Editor, save: () => Promise<void>, setHideUI: (f: (v: boolean) => boolean) => void, setPanel: (p: PanelId) => void) {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const tt = ed.tools.transform as TransformTool;
      if (e.key === ' ') {
        setSpace(true);
        e.preventDefault();
        return;
      }
      if (mod) {
        if (k === 'z' && !e.shiftKey) ed.history.undo();
        else if ((k === 'z' && e.shiftKey) || k === 'y') ed.history.redo();
        else if (k === 'a') ed.selectAll();
        else if (k === 'd') ed.deselect();
        else if (k === 'i' && e.shiftKey) ed.invertSelection();
        else if (k === 'c') ed.copy();
        else if (k === 'x') ed.copy(true);
        else if (k === 'v') ed.paste();
        else if (k === 's') void save().then(() => ed.toast('Saved'));
        else if (k === 'n' && e.shiftKey) ed.addLayer();
        else if (k === 'j') ed.duplicateNode();
        else if (k === 'e') ed.mergeDown();
        else if (k === 't') ed.setTool('transform');
        else if (k === '0') { ed.viewport.fit(); ed.changed(); }
        else return;
        e.preventDefault();
        return;
      }
      const tool = TOOL_LIST.find((x) => x.key.toLowerCase() === k);
      if (tool && !e.altKey) {
        ed.setTool(tool.id);
        return;
      }
      const s = getSettings();
      if ((k === '[' || k === ']') && isBrushTool(s.tool)) {
        const cur = s.brushTools[s.tool].size;
        updateBrushTool(s.tool, { size: Math.min(1000, Math.max(1, k === ']' ? cur * 1.15 + 0.5 : cur / 1.15 - 0.5)) });
      } else if (k === 'delete' || k === 'backspace') ed.clearLayer();
      else if (k === 'enter' && ed.tool.id === 'transform') tt.finish(true);
      else if (k === 'escape') {
        if (ed.tool.id === 'transform') tt.finish(false);
        else setPanel(null);
      } else if (k === '0') { ed.viewport.fit(); ed.changed(); }
      else if (k === '1') { ed.viewport.setZoom(1); ed.changed(); }
      else if (k === '+' || k === '=') { ed.viewport.setZoom(ed.viewport.zoom * 1.25); ed.changed(); }
      else if (k === '-') { ed.viewport.setZoom(ed.viewport.zoom / 1.25); ed.changed(); }
      else if (k === 'x') { ed.viewport.toggleFlip(); ed.changed(); }
      else if (k === 'tab') { setHideUI((v) => !v); e.preventDefault(); }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === ' ') setSpace(false);
    };
    const setSpace = (v: boolean) => {
      keys.space = v;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [ed, save, setHideUI, setPanel]);
}
