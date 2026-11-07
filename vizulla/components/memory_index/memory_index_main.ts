// memory_index utility process: the encrypted Memory store and its in-memory
// search index. The browser sends the key at init (it comes from the keychain).
import { MemoryIndex } from './memory_index';
import { serve } from '../utility_child';

let index: MemoryIndex | null = null;
const need = () => {
  if (!index) throw new Error('memory index not initialized');
  return index;
};

serve({
  __init: (p: { path: string; key: string }) => {
    index?.close();
    index = new MemoryIndex(p.path, Buffer.from(p.key, 'base64'));
    return true;
  },
  add: (p) => need().add(p),
  search: (p: { query: string; limit?: number }) => need().search(String(p.query).slice(0, 500), Math.min(50, p.limit ?? 8)),
  get: (p: { id: number }) => need().get(p.id) ?? null,
  list: (p: { site?: string; limit?: number }) => need().list(p),
  remove: (p: { ids: number[] }) => need().remove(p.ids),
  removeUrls: (p: { urls: string[] }) => need().removeUrls(p.urls),
  removeSite: (p: { site: string }) => need().removeSite(p.site),
  removeRange: (p: { from: number; to: number }) => need().removeRange(p.from, p.to),
  expire: (p: { days: number }) => need().expire(p.days),
  wipe: () => need().wipe(),
  stats: () => need().stats(),
});
