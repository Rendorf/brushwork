// Custom brushes: make them from images, duplicate, delete, and import/export
// (our .bwbrush JSON format, plus Photoshop .abr via ag-psd).
import { settingsStore } from '../../store/settings';
import { uid } from '../util/geom';
import { customTip, deleteCustomTip, isCustomTip, maskFromGray, maskFromImage, saveCustomTip } from './customTips';
import { getBrush } from './library';
import { PRESETS, type BrushParams, type TipRef } from './presets';
import type { Mask } from './tips';

const FORMAT = 'brushwork-brushes';

function addCustom(list: BrushParams[]): void {
  settingsStore.setState((s) => ({ customBrushes: [...s.customBrushes, ...list] }));
}

const newTipId = (): TipRef => `custom:${uid('tip')}`;

/** A custom brush that paints with an image as its tip. */
export async function brushFromImage(img: ImageData, name: string, base: BrushParams): Promise<BrushParams> {
  const tip = newTipId();
  await saveCustomTip(tip, maskFromImage(img));
  const b: BrushParams = {
    ...base,
    id: uid('brush'),
    name,
    category: 'Custom',
    mode: 'paint',
    tip,
    size: Math.max(base.size, 40),
    spacing: 0.25,
    followDirection: false,
    sizePressure: 0.5,
    flowPressure: 0,
    dabScale: 1,
    scatter: 0,
    count: 1,
    grain: null,
    grainStrength: 0,
    wetEdge: 0,
  };
  addCustom([b]);
  return b;
}

/** Copy a brush (with the user's tweaks) into an editable custom brush. */
export function duplicateBrush(b: BrushParams): BrushParams {
  const copy: BrushParams = { ...b, id: uid('brush'), name: `${b.name} copy`, category: 'Custom' };
  addCustom([copy]);
  return copy;
}

export function renameBrush(id: string, name: string): void {
  settingsStore.setState((s) => ({ customBrushes: s.customBrushes.map((b) => (b.id === id ? { ...b, name } : b)) }));
}

export function updateCustomBrush(id: string, patch: Partial<BrushParams>): void {
  settingsStore.setState((s) => ({ customBrushes: s.customBrushes.map((b) => (b.id === id ? { ...b, ...patch } : b)) }));
}

export async function deleteBrush(id: string): Promise<void> {
  const s = settingsStore.getState();
  const b = s.customBrushes.find((x) => x.id === id);
  if (!b) return;
  const rest = s.customBrushes.filter((x) => x.id !== id);
  // Tools using this brush fall back to a built-in one.
  const tools = { ...s.brushTools };
  for (const k of Object.keys(tools) as (keyof typeof tools)[]) {
    if (tools[k].presetId === id) tools[k] = { ...tools[k], presetId: k === 'eraser' ? 'eraser-hard' : k === 'smudge' ? 'smudge' : k === 'blur' ? 'blur' : 'g-pen' };
  }
  settingsStore.setState({ customBrushes: rest, brushTools: tools });
  if (isCustomTip(b.tip) && !rest.some((x) => x.tip === b.tip)) await deleteCustomTip(b.tip);
}

// --- files -----------------------------------------------------------------------

function maskToPng(m: Mask): string {
  const c = document.createElement('canvas');
  c.width = m.w;
  c.height = m.h;
  const img = new ImageData(m.w, m.h);
  for (let i = 0; i < m.data.length; i++) {
    img.data[i * 4 + 3] = m.data[i];
  }
  c.getContext('2d')!.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

async function pngToMask(dataUrl: string): Promise<Mask> {
  const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const data = new Uint8Array(c.width * c.height);
  for (let i = 0; i < data.length; i++) data[i] = d[i * 4 + 3];
  return { w: c.width, h: c.height, data };
}

/** Export brushes (their tips included) as a .bwbrush file. */
export function exportBrushes(list: BrushParams[]): Blob {
  const brushes = list.map((b) => {
    const tip = isCustomTip(b.tip) ? customTip(b.tip) : undefined;
    return { params: b, tip: tip ? { png: maskToPng(tip) } : undefined };
  });
  return new Blob([JSON.stringify({ format: FORMAT, version: 1, brushes }, null, 1)], { type: 'application/json' });
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Import a .bwbrush or Photoshop .abr file. Returns the brushes added. */
export async function importBrushFile(file: File): Promise<BrushParams[]> {
  const buf = await file.arrayBuffer();
  const head = new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(64, buf.byteLength))).trimStart();
  const added = head.startsWith('{') ? await importJson(buf) : await importAbr(buf, file.name);
  addCustom(added);
  return added;
}

async function importJson(buf: ArrayBuffer): Promise<BrushParams[]> {
  const j = JSON.parse(new TextDecoder().decode(buf)) as { format?: string; brushes?: { params: BrushParams; tip?: { png: string } }[] };
  if (j.format !== FORMAT || !Array.isArray(j.brushes)) throw new Error('This is not a Brushwork brush file.');
  const base = PRESETS[1];
  const out: BrushParams[] = [];
  for (const item of j.brushes) {
    const p: BrushParams = { ...base, ...item.params, id: uid('brush'), category: 'Custom' };
    if (item.tip?.png) {
      p.tip = newTipId();
      await saveCustomTip(p.tip, await pngToMask(item.tip.png));
    } else if (isCustomTip(p.tip)) {
      p.tip = 'round';
    }
    out.push(p);
  }
  return out;
}

async function importAbr(buf: ArrayBuffer, fileName: string): Promise<BrushParams[]> {
  const { readAbr } = await import('ag-psd');
  const abr = readAbr(new Uint8Array(buf), { logMissingFeatures: false });
  const base = getBrush('g-pen');
  const out: BrushParams[] = [];
  const tipForSample = new Map<string, TipRef>();
  for (const [i, b] of abr.brushes.entries()) {
    const shape = b.shape;
    let tip: TipRef = 'round';
    let hardness = 0.9;
    let roundness = 1;
    if (shape.type === 'sampled') {
      let t = tipForSample.get(shape.sampledData);
      const sample = abr.samples.find((s) => s.id === shape.sampledData);
      if (!t && sample && sample.bounds.w > 0 && sample.bounds.h > 0) {
        t = newTipId();
        await saveCustomTip(t, maskFromGray(sample.alpha, sample.bounds.w, sample.bounds.h));
        tipForSample.set(shape.sampledData, t);
      }
      if (t) tip = t;
      roundness = clamp(shape.roundness || 1, 0.05, 1);
    } else if (shape.type === 'computed') {
      hardness = clamp(shape.hardness, 0, 1);
      roundness = clamp(shape.roundness || 1, 0.05, 1);
    }
    const dyn = b.shapeDynamics;
    const pressureSize = dyn?.sizeDynamics.control === 'pen pressure';
    out.push({
      ...base,
      id: uid('brush'),
      name: b.name || `${fileName.replace(/\.[^.]+$/, '')} ${i + 1}`,
      category: 'Custom',
      mode: 'paint',
      tip,
      hardness,
      roundness,
      size: clamp(Math.round(shape.size || 20), 1, 1000),
      angle: shape.angle || 0,
      spacing: shape.spacingOn ? clamp(shape.spacing, 0.02, 2) : 0.25,
      sizePressure: pressureSize ? clamp(1 - (dyn?.minimumDiameter ?? 0), 0, 1) : 0,
      sizeJitter: clamp(dyn?.sizeDynamics.jitter ?? 0, 0, 1),
      angleJitter: clamp((dyn?.angleDynamics.jitter ?? 0) * 360, 0, 180),
      followDirection: dyn?.angleDynamics.control === 'direction',
      scatter: clamp((b.scatter?.scatterDynamics.jitter ?? 0) * 0.5, 0, 3),
      count: clamp(Math.round(b.scatter?.count ?? 1), 1, 16),
      flowPressure: b.transfer?.flowDynamics?.control === 'pen pressure' ? 1 : 0,
      taperIn: 0,
      taperOut: 0,
      grain: null,
      grainStrength: 0,
    });
  }
  if (!out.length) throw new Error('No brushes could be read from that file.');
  return out;
}
