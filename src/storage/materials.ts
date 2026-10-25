// Pictures the user adds to the materials library (shared across artworks).
import { db, type MaterialRecord } from './db';

export type { MaterialRecord };

export async function listMaterials(): Promise<MaterialRecord[]> {
  const all = await (await db()).getAll('materials');
  return all.sort((a, b) => a.added - b.added);
}

export async function addMaterial(file: File): Promise<MaterialRecord> {
  const rec: MaterialRecord = {
    id: `mat_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`,
    name: file.name.replace(/\.[^.]+$/, ''),
    type: file.type || 'image/png',
    data: await file.arrayBuffer(),
    added: Date.now(),
  };
  await (await db()).put('materials', rec);
  return rec;
}

export async function deleteMaterial(id: string): Promise<void> {
  await (await db()).delete('materials', id);
}
