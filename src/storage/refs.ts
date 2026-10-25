// Reference images for the floating reference window, shared across artworks.
import { db, type RefRecord } from './db';

export type { RefRecord };

export async function listRefs(): Promise<RefRecord[]> {
  const all = await (await db()).getAll('refs');
  return all.sort((a, b) => a.added - b.added);
}

export async function addRef(file: File): Promise<RefRecord> {
  const rec: RefRecord = {
    id: `ref_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`,
    name: file.name.replace(/\.[^.]+$/, ''),
    type: file.type || 'image/png',
    data: await file.arrayBuffer(),
    added: Date.now(),
  };
  await (await db()).put('refs', rec);
  return rec;
}

export async function deleteRef(id: string): Promise<void> {
  await (await db()).delete('refs', id);
}
