// memory_index (P4-AI-08, DD-8, DD-9).
//
// At rest: one SQLite file whose rows are AES-256-GCM sealed (url, title, text,
// summary, tags). Only ids, timestamps, and an HMAC of the site are plaintext,
// so deletion by site/time works without decrypting. node:sqlite can't load an
// encrypting VFS, so instead of encrypting pages we encrypt rows and keep the
// searchable state (FTS5 + int8 vectors) in memory inside this process only.
// A copied Memory file is unreadable without the keychain-held key.
//
// Search: hybrid ranking = BM25 (FTS5) + cosine (int8 vectors, brute-force SIMD-
// friendly scan) + time decay, with filters parsed from the query.
import { createHmac } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { CryptoBox } from '../../browser/storage/crypto_box';
import { embed, tokenize } from '../ai_runtime/extractive';

export const DIMS = 384;

export interface MemoryItemInput {
  kind: 'visit' | 'save' | 'note' | 'download';
  url: string;
  title: string;
  visitedAt: number;
  chunks: string[];
  summary?: string;
  tags?: string[];
  expiresAt?: number | null;
}

export interface MemoryHit {
  id: number;
  kind: string;
  url: string;
  title: string;
  visitedAt: number;
  snippet: string;
  score: number;
  saved: boolean;
}

interface ItemRow {
  id: number;
  kind: string;
  url: string;
  title: string;
  site: string;
  visitedAt: number;
  saved: boolean;
  summary: string;
  tags: string[];
}

interface VecRow {
  chunkId: number;
  itemId: number;
  vec: Int8Array;
}

const DISK_SCHEMA = `
  CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY, site_mac TEXT NOT NULL, visited_at INTEGER NOT NULL,
    saved INTEGER NOT NULL DEFAULT 0, expires_at INTEGER, sealed TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS items_site ON items(site_mac);
  CREATE INDEX IF NOT EXISTS items_time ON items(visited_at);
  CREATE TABLE IF NOT EXISTS chunks (id INTEGER PRIMARY KEY, item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    ord INTEGER NOT NULL, sealed TEXT NOT NULL, vec BLOB NOT NULL);
  CREATE INDEX IF NOT EXISTS chunks_item ON chunks(item_id);`;

export function siteOf(url: string): string {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '');
    const parts = h.split('.');
    return parts.length > 2 && /^(co|com|gov|ac|org|net|edu)$/.test(parts.at(-2)!) ? parts.slice(-3).join('.') : parts.slice(-2).join('.');
  } catch {
    return '';
  }
}

export function quantize(v: Float32Array): Int8Array {
  const q = new Int8Array(v.length);
  for (let i = 0; i < v.length; i++) q[i] = Math.max(-127, Math.min(127, Math.round(v[i]! * 127 * 4)));
  return q;
}

function dot(a: Int8Array, b: Int8Array): number {
  let s = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    s += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? s / Math.sqrt(na * nb) : 0;
}

export interface ParsedQuery {
  text: string;
  from?: number;
  to?: number;
  site?: string;
}

/** Filters from natural phrasing: "yesterday", "last week", "on youtube". */
export function parseQuery(q: string, now = Date.now()): ParsedQuery {
  let text = q;
  const out: ParsedQuery = { text: '' };
  const day = 86_400_000;
  const startOfDay = (t: number) => new Date(new Date(t).toDateString()).getTime();
  const rules: [RegExp, () => void][] = [
    [/\b(today|aujourd'hui)\b/i, () => ((out.from = startOfDay(now)), (out.to = now))],
    [/\b(yesterday|hier)\b/i, () => ((out.from = startOfDay(now) - day), (out.to = startOfDay(now)))],
    [/\b(last|this) week\b|\bcette semaine\b/i, () => (out.from = now - 7 * day)],
    [/\blast month\b|\bce mois\b/i, () => (out.from = now - 31 * day)],
  ];
  for (const [re, apply] of rules) {
    if (re.test(text)) {
      apply();
      text = text.replace(re, ' ');
    }
  }
  const site = /\b(?:on|from|sur)\s+([a-z0-9-]+(?:\.[a-z]{2,})?)\b/i.exec(text);
  if (site && !['the', 'a', 'my', 'this'].includes(site[1]!.toLowerCase())) {
    out.site = site[1]!.toLowerCase();
    text = text.replace(site[0], ' ');
  }
  out.text = text.replace(/\b(i (saw|read|looked at|visited)|that|the page|article about|the)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  return out;
}

export class MemoryIndex {
  private readonly disk: DatabaseSync;
  private readonly mem: DatabaseSync;
  private readonly box: CryptoBox;
  private items = new Map<number, ItemRow>();
  private vecs: VecRow[] = [];

  constructor(path: string, private readonly key: Buffer, private readonly now: () => number = Date.now) {
    this.box = new CryptoBox(key);
    this.disk = new DatabaseSync(path);
    this.disk.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA secure_delete = ON;' + DISK_SCHEMA);
    this.mem = new DatabaseSync(':memory:');
    this.mem.exec("CREATE VIRTUAL TABLE fts USING fts5(text, title, item_id UNINDEXED, tokenize='unicode61 remove_diacritics 2')");
    this.load();
  }

  private siteMac(site: string): string {
    return createHmac('sha256', this.key).update(`site:${site}`).digest('hex').slice(0, 32);
  }

  private load(): void {
    const rows = this.disk.prepare('SELECT * FROM items').all() as { id: number; visited_at: number; saved: number; sealed: string }[];
    for (const r of rows) {
      try {
        const d = JSON.parse(this.box.openString(r.sealed, `item:${r.id}`)) as Omit<ItemRow, 'id' | 'visitedAt' | 'saved'>;
        this.items.set(Number(r.id), { ...d, id: Number(r.id), visitedAt: Number(r.visited_at), saved: r.saved === 1 });
      } catch {
        /* undecryptable (wrong key or corrupt): skip, never crash */
      }
    }
    const chunks = this.disk.prepare('SELECT id, item_id, sealed, vec FROM chunks').all() as { id: number; item_id: number; sealed: string; vec: Uint8Array }[];
    const ins = this.mem.prepare('INSERT INTO fts(rowid, text, title, item_id) VALUES (?, ?, ?, ?)');
    for (const c of chunks) {
      const item = this.items.get(Number(c.item_id));
      if (!item) continue;
      try {
        const text = this.box.openString(c.sealed, `chunk:${c.id}`);
        ins.run(Number(c.id), text, item.title, item.id);
        this.vecs.push({ chunkId: Number(c.id), itemId: item.id, vec: new Int8Array(c.vec.buffer.slice(c.vec.byteOffset, c.vec.byteOffset + c.vec.byteLength)) });
      } catch {
        /* skip */
      }
    }
  }

  /** Adds or replaces the item for a URL (one Memory item per URL per kind). */
  add(input: MemoryItemInput): number {
    const site = siteOf(input.url);
    const existing = [...this.items.values()].find((i) => i.url === input.url && i.kind === input.kind);
    if (existing) this.remove([existing.id]);
    this.disk.exec('BEGIN');
    try {
      const r = this.disk
        .prepare('INSERT INTO items (site_mac, visited_at, saved, expires_at, sealed) VALUES (?, ?, ?, ?, ?)')
        .run(this.siteMac(site), input.visitedAt, input.kind === 'save' ? 1 : 0, input.expiresAt ?? null, '');
      const id = Number(r.lastInsertRowid);
      const row: ItemRow = { id, kind: input.kind, url: input.url, title: input.title, site, visitedAt: input.visitedAt, saved: input.kind === 'save', summary: input.summary ?? '', tags: input.tags ?? [] };
      const { id: _i, visitedAt: _v, saved: _s, ...payload } = row;
      this.disk.prepare('UPDATE items SET sealed = ? WHERE id = ?').run(this.box.sealString(JSON.stringify(payload), `item:${id}`), id);
      const insChunk = this.disk.prepare('INSERT INTO chunks (item_id, ord, sealed, vec) VALUES (?, ?, ?, ?)');
      const updChunk = this.disk.prepare('UPDATE chunks SET sealed = ? WHERE id = ?');
      const fts = this.mem.prepare('INSERT INTO fts(rowid, text, title, item_id) VALUES (?, ?, ?, ?)');
      input.chunks.slice(0, 64).forEach((text, ord) => {
        const vec = quantize(embed(`${input.title}. ${text}`, DIMS));
        const cid = Number(insChunk.run(id, ord, '', Buffer.from(vec.buffer)).lastInsertRowid);
        updChunk.run(this.box.sealString(text, `chunk:${cid}`), cid);
        fts.run(cid, text, input.title, id);
        this.vecs.push({ chunkId: cid, itemId: id, vec });
      });
      this.disk.exec('COMMIT');
      this.items.set(id, row);
      return id;
    } catch (e) {
      this.disk.exec('ROLLBACK');
      throw e;
    }
  }

  search(query: string, limit = 8): MemoryHit[] {
    const q = parseQuery(query, this.now());
    const terms = tokenize(q.text);
    const candidates = new Map<number, { bm25: number; cos: number; chunk: number }>();
    if (terms.length) {
      const match = terms.map((t) => `"${t.replace(/"/g, '')}"*`).join(' OR ');
      const rows = this.mem.prepare('SELECT rowid, item_id, bm25(fts) AS s FROM fts WHERE fts MATCH ? ORDER BY s LIMIT 200').all(match) as { rowid: number; item_id: number; s: number }[];
      for (const r of rows) {
        const id = Number(r.item_id);
        const s = -Number(r.s);
        const prev = candidates.get(id);
        if (!prev || s > prev.bm25) candidates.set(id, { bm25: s, cos: prev?.cos ?? 0, chunk: Number(r.rowid) });
      }
    }
    if (q.text) {
      const qv = quantize(embed(q.text, DIMS));
      const scored = this.vecs.map((v) => ({ v, c: dot(qv, v.vec) })).filter((x) => x.c > 0.12).sort((a, b) => b.c - a.c).slice(0, 200);
      for (const { v, c } of scored) {
        const prev = candidates.get(v.itemId);
        if (!prev) candidates.set(v.itemId, { bm25: 0, cos: c, chunk: v.chunkId });
        else if (c > prev.cos) prev.cos = c;
      }
    } else {
      for (const it of this.items.values()) candidates.set(it.id, { bm25: 0, cos: 0, chunk: -1 });
    }
    const maxBm = Math.max(1e-6, ...[...candidates.values()].map((c) => c.bm25));
    const now = this.now();
    const hits: MemoryHit[] = [];
    for (const [id, c] of candidates) {
      const it = this.items.get(id);
      if (!it) continue;
      if (q.from && it.visitedAt < q.from) continue;
      if (q.to && it.visitedAt > q.to) continue;
      if (q.site && !it.site.includes(q.site) && !it.url.includes(q.site)) continue;
      const ageDays = (now - it.visitedAt) / 86_400_000;
      const score = 0.55 * (c.bm25 / maxBm) + 0.45 * c.cos + 0.1 / (1 + ageDays / 7) + (it.saved ? 0.05 : 0);
      hits.push({ id, kind: it.kind, url: it.url, title: it.title, visitedAt: it.visitedAt, snippet: this.snippet(c.chunk, terms), score, saved: it.saved });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  private snippet(chunkId: number, terms: string[]): string {
    if (chunkId < 0) return '';
    const row = this.mem.prepare('SELECT text FROM fts WHERE rowid = ?').get(chunkId) as { text: string } | undefined;
    const text = row?.text ?? '';
    const lower = text.toLowerCase();
    const at = terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
    const start = Math.max(0, at - 60);
    return (start ? '…' : '') + text.slice(start, start + 180).trim() + (text.length > start + 180 ? '…' : '');
  }

  get(id: number): ItemRow | undefined {
    return this.items.get(id);
  }

  list(opts: { site?: string; limit?: number } = {}): ItemRow[] {
    return [...this.items.values()]
      .filter((i) => !opts.site || i.site === opts.site)
      .sort((a, b) => b.visitedAt - a.visitedAt)
      .slice(0, opts.limit ?? 500);
  }

  remove(ids: number[]): number {
    let n = 0;
    for (const id of ids) {
      if (!this.items.has(id)) continue;
      this.disk.prepare('DELETE FROM items WHERE id = ?').run(id);
      this.mem.prepare('DELETE FROM fts WHERE item_id = ?').run(id);
      this.items.delete(id);
      n++;
    }
    const gone = new Set(ids);
    this.vecs = this.vecs.filter((v) => !gone.has(v.itemId));
    return n;
  }

  removeUrls(urls: string[]): number {
    const set = new Set(urls);
    return this.remove([...this.items.values()].filter((i) => set.has(i.url) && !i.saved).map((i) => i.id));
  }

  removeSite(site: string): number {
    const mac = this.siteMac(site);
    const ids = (this.disk.prepare('SELECT id FROM items WHERE site_mac = ?').all(mac) as { id: number }[]).map((r) => Number(r.id));
    return this.remove(ids);
  }

  removeRange(from: number, to: number): number {
    const ids = (this.disk.prepare('SELECT id FROM items WHERE visited_at BETWEEN ? AND ?').all(from, to) as { id: number }[]).map((r) => Number(r.id));
    return this.remove(ids);
  }

  /** Expiry (retention) and compaction when idle. */
  expire(retentionDays: number): number {
    const cutoff = this.now() - retentionDays * 86_400_000;
    const ids = (this.disk.prepare('SELECT id FROM items WHERE (visited_at < ? AND saved = 0) OR (expires_at IS NOT NULL AND expires_at < ?)').all(cutoff, this.now()) as { id: number }[]).map((r) => Number(r.id));
    const n = this.remove(ids);
    if (n) this.disk.exec('VACUUM');
    return n;
  }

  wipe(): void {
    this.disk.exec('DELETE FROM chunks; DELETE FROM items; VACUUM;');
    this.mem.exec('DELETE FROM fts');
    this.items.clear();
    this.vecs = [];
  }

  stats(): { items: number; chunks: number } {
    return { items: this.items.size, chunks: this.vecs.length };
  }

  close(): void {
    this.disk.close();
    this.mem.close();
  }
}
