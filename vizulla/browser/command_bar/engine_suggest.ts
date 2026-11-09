// Search suggestions from the chosen engine (OpenSearch JSON: [query, [suggestions]]).
// Requests use their own in-memory session with no cookies, so the engine can't tie
// what you type to an account you're signed into. Never used in private windows; off
// in Settings → General. Tests point it at a local server (VZ_SUGGEST_URL).
import { session as electronSession, type Session } from 'electron';
import type { SearchEngineId } from '@vz/common/url';

const ENDPOINTS: Partial<Record<SearchEngineId, (q: string) => string>> = {
  duckduckgo: (q) => `https://duckduckgo.com/ac/?q=${q}&type=list`,
  google: (q) => `https://suggestqueries.google.com/complete/search?client=firefox&q=${q}`,
  bing: (q) => `https://api.bing.com/osjson.aspx?query=${q}`,
  brave: (q) => `https://search.brave.com/api/suggest?q=${q}`,
  ecosia: (q) => `https://ac.ecosia.org/autocomplete?q=${q}&type=list`,
};

/** Suggestions from an OpenSearch response, without the query itself, at most four. */
export function parseOpenSearch(json: unknown, q: string): string[] {
  if (!Array.isArray(json) || !Array.isArray(json[1])) return [];
  const query = q.trim().toLowerCase();
  const out: string[] = [];
  for (const s of json[1] as unknown[]) {
    if (typeof s !== 'string') continue;
    const v = s.trim().slice(0, 200);
    if (v && v.toLowerCase() !== query && !out.includes(v)) out.push(v);
    if (out.length === 4) break;
  }
  return out;
}

export class EngineSuggest {
  private readonly cache = new Map<string, string[]>();
  private ses: Session | null = null;

  constructor(private readonly override: string | null = process.env.VZ_SUGGEST_URL ?? null) {}

  /** No network suggestions in tests unless a local endpoint is given. */
  get available(): boolean {
    return !process.env.VZ_TEST || !!this.override;
  }

  async get(engine: SearchEngineId, q: string, timeoutMs = 350): Promise<string[]> {
    const query = q.trim();
    if (query.length < 2 || !this.available) return [];
    const key = `${engine}|${query.toLowerCase()}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const enc = encodeURIComponent(query);
    const url = this.override ? this.override.replace('%s', enc) : ENDPOINTS[engine]?.(enc);
    if (!url) return [];
    this.ses ??= electronSession.fromPartition('vizulla-suggest', { cache: false });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await this.ses.fetch(url, { signal: ctrl.signal, credentials: 'omit', headers: { accept: 'application/json' } });
      if (!res.ok) return [];
      const list = parseOpenSearch(await res.json(), query);
      this.cache.set(key, list);
      if (this.cache.size > 300) this.cache.delete(this.cache.keys().next().value!);
      return list;
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
  }
}
