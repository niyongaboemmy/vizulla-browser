// History and bookmarks for the Command Bar and the importers. A frecency score
// (visit count decayed by age) ranks suggestions, like upstream's HistoryURL provider.
import { Database } from '../storage/database';

const MIGRATIONS = [
  `CREATE TABLE urls (
     id INTEGER PRIMARY KEY, url TEXT NOT NULL UNIQUE, title TEXT NOT NULL DEFAULT '',
     visit_count INTEGER NOT NULL DEFAULT 0, typed_count INTEGER NOT NULL DEFAULT 0,
     last_visit INTEGER NOT NULL, favicon TEXT);
   CREATE INDEX urls_last ON urls(last_visit DESC);
   CREATE TABLE visits (id INTEGER PRIMARY KEY, url_id INTEGER NOT NULL REFERENCES urls(id) ON DELETE CASCADE, at INTEGER NOT NULL);
   CREATE INDEX visits_at ON visits(at DESC);
   CREATE VIRTUAL TABLE urls_fts USING fts5(url, title, content='urls', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
   CREATE TRIGGER urls_ai AFTER INSERT ON urls BEGIN INSERT INTO urls_fts(rowid, url, title) VALUES (new.id, new.url, new.title); END;
   CREATE TRIGGER urls_ad AFTER DELETE ON urls BEGIN INSERT INTO urls_fts(urls_fts, rowid, url, title) VALUES ('delete', old.id, old.url, old.title); END;
   CREATE TRIGGER urls_au AFTER UPDATE OF url, title ON urls BEGIN
     INSERT INTO urls_fts(urls_fts, rowid, url, title) VALUES ('delete', old.id, old.url, old.title);
     INSERT INTO urls_fts(rowid, url, title) VALUES (new.id, new.url, new.title); END;
   CREATE TABLE bookmarks (
     id INTEGER PRIMARY KEY, url TEXT NOT NULL, title TEXT NOT NULL, folder TEXT NOT NULL DEFAULT '',
     created_at INTEGER NOT NULL, source TEXT NOT NULL DEFAULT 'user');
   CREATE INDEX bookmarks_url ON bookmarks(url);`,
];

export interface HistoryEntry {
  id: number;
  url: string;
  title: string;
  visitCount: number;
  typedCount: number;
  lastVisit: number;
  favicon: string | null;
}

export interface Bookmark {
  id: number;
  url: string;
  title: string;
  folder: string;
  createdAt: number;
}

export class HistoryService {
  private readonly db: Database;
  private readonly listeners = new Set<(urls: string[] | 'all') => void>();

  constructor(path: string, private readonly now: () => number = Date.now) {
    this.db = new Database(path, MIGRATIONS);
  }

  /** Observers are told about deletions (Memory deletes its items too, P4-AI-09). */
  onDeleted(fn: (urls: string[] | 'all') => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  addVisit(url: string, title: string, opts: { typed?: boolean; at?: number } = {}): void {
    if (!/^(https?|file):/.test(url)) return;
    const at = opts.at ?? this.now();
    this.db.transaction(() => {
      const existing = this.db.get<{ id: number }>('SELECT id FROM urls WHERE url = ?', url);
      let id: number;
      if (existing) {
        id = existing.id;
        this.db.run(
          'UPDATE urls SET visit_count = visit_count + 1, typed_count = typed_count + ?, last_visit = MAX(last_visit, ?), title = CASE WHEN ? != \'\' THEN ? ELSE title END WHERE id = ?',
          opts.typed ? 1 : 0, at, title, title, id,
        );
      } else {
        id = this.db.run('INSERT INTO urls (url, title, visit_count, typed_count, last_visit) VALUES (?, ?, 1, ?, ?)', url, title, opts.typed ? 1 : 0, at).lastInsertRowid;
      }
      this.db.run('INSERT INTO visits (url_id, at) VALUES (?, ?)', id, at);
    });
  }

  updateTitle(url: string, title: string): void {
    if (title) this.db.run('UPDATE urls SET title = ? WHERE url = ?', title, url);
  }

  updateFavicon(url: string, favicon: string): void {
    this.db.run('UPDATE urls SET favicon = ? WHERE url = ?', favicon, url);
  }

  /** Prefix + full-text match, ranked by frecency. Must stay fast: it runs on every keystroke. */
  search(query: string, limit = 8): HistoryEntry[] {
    const q = query.trim().toLowerCase();
    if (!q) return this.recent(limit);
    const terms = q.split(/\s+/).filter(Boolean).slice(0, 6);
    const fts = terms.map((t) => `"${t.replace(/"/g, '""')}"*`).join(' AND ');
    const rows = this.db.all<Record<string, unknown>>(
      `SELECT u.* FROM urls_fts f JOIN urls u ON u.id = f.rowid WHERE urls_fts MATCH ? LIMIT 200`,
      fts,
    );
    const now = this.now();
    return rows
      .map(toEntry)
      .map((e) => ({ e, s: frecency(e, now) * (hostStarts(e.url, q) ? 4 : 1) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, limit)
      .map((x) => x.e);
  }

  recent(limit = 50, offset = 0): HistoryEntry[] {
    return this.db.all<Record<string, unknown>>('SELECT * FROM urls ORDER BY last_visit DESC LIMIT ? OFFSET ?', limit, offset).map(toEntry);
  }

  visitsBetween(from: number, to: number, limit = 500): (HistoryEntry & { visitedAt: number })[] {
    return this.db
      .all<Record<string, unknown>>(
        'SELECT u.*, v.at AS visited_at FROM visits v JOIN urls u ON u.id = v.url_id WHERE v.at BETWEEN ? AND ? ORDER BY v.at DESC LIMIT ?',
        from, to, limit,
      )
      .map((r) => ({ ...toEntry(r), visitedAt: Number(r.visited_at) }));
  }

  /** Inline autocompletion: the most-typed host that starts with the input. */
  inlineCompletion(input: string): string | null {
    const q = input.toLowerCase();
    if (q.length < 2 || /\s/.test(q)) return null;
    const rows = this.db.all<{ url: string; typed_count: number; visit_count: number }>(
      "SELECT url, typed_count, visit_count FROM urls WHERE url LIKE 'https://' || ? || '%' OR url LIKE 'https://www.' || ? || '%' OR url LIKE 'http://' || ? || '%' ORDER BY typed_count DESC, visit_count DESC LIMIT 5",
      q, q, q,
    );
    for (const r of rows) {
      const host = new URL(r.url).host.replace(/^www\./, '');
      if (host.startsWith(q)) return host;
    }
    return null;
  }

  deleteUrl(url: string): void {
    this.db.run('DELETE FROM urls WHERE url = ?', url);
    this.listeners.forEach((fn) => fn([url]));
  }

  deleteRange(from: number, to: number): number {
    const urls = this.db.all<{ url: string }>('SELECT DISTINCT u.url FROM visits v JOIN urls u ON u.id = v.url_id WHERE v.at BETWEEN ? AND ?', from, to).map((r) => r.url);
    this.db.transaction(() => {
      this.db.run('DELETE FROM visits WHERE at BETWEEN ? AND ?', from, to);
      this.db.run('DELETE FROM urls WHERE id NOT IN (SELECT DISTINCT url_id FROM visits)');
    });
    this.listeners.forEach((fn) => fn(urls));
    return urls.length;
  }

  clearAll(): void {
    this.db.transaction(() => {
      this.db.run('DELETE FROM visits');
      this.db.run('DELETE FROM urls');
    });
    this.listeners.forEach((fn) => fn('all'));
  }

  count(): number {
    return Number(this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM urls')?.n ?? 0);
  }

  // ---- Bookmarks ----

  addBookmark(url: string, title: string, folder = '', source = 'user', at = this.now()): number {
    const dup = this.db.get<{ id: number }>('SELECT id FROM bookmarks WHERE url = ? AND folder = ?', url, folder);
    if (dup) return dup.id;
    return this.db.run('INSERT INTO bookmarks (url, title, folder, created_at, source) VALUES (?, ?, ?, ?, ?)', url, title, folder, at, source).lastInsertRowid;
  }

  removeBookmark(id: number): void {
    this.db.run('DELETE FROM bookmarks WHERE id = ?', id);
  }

  isBookmarked(url: string): boolean {
    return !!this.db.get('SELECT 1 FROM bookmarks WHERE url = ?', url);
  }

  bookmarks(folder?: string): Bookmark[] {
    const rows = folder === undefined
      ? this.db.all<Record<string, unknown>>('SELECT * FROM bookmarks ORDER BY folder, created_at')
      : this.db.all<Record<string, unknown>>('SELECT * FROM bookmarks WHERE folder = ? ORDER BY created_at', folder);
    return rows.map((r) => ({ id: Number(r.id), url: String(r.url), title: String(r.title), folder: String(r.folder), createdAt: Number(r.created_at) }));
  }

  searchBookmarks(query: string, limit = 5): Bookmark[] {
    const q = `%${query.trim().replace(/[%_]/g, '')}%`;
    return this.db
      .all<Record<string, unknown>>('SELECT * FROM bookmarks WHERE title LIKE ? OR url LIKE ? LIMIT ?', q, q, limit)
      .map((r) => ({ id: Number(r.id), url: String(r.url), title: String(r.title), folder: String(r.folder), createdAt: Number(r.created_at) }));
  }

  close(): void {
    this.db.close();
  }
}

function toEntry(r: Record<string, unknown>): HistoryEntry {
  return {
    id: Number(r.id),
    url: String(r.url),
    title: String(r.title ?? ''),
    visitCount: Number(r.visit_count),
    typedCount: Number(r.typed_count),
    lastVisit: Number(r.last_visit),
    favicon: (r.favicon as string | null) ?? null,
  };
}

function frecency(e: HistoryEntry, now: number): number {
  const ageDays = Math.max(0, (now - e.lastVisit) / 86_400_000);
  const decay = ageDays < 4 ? 1 : ageDays < 14 ? 0.7 : ageDays < 31 ? 0.5 : ageDays < 90 ? 0.3 : 0.1;
  return (e.visitCount + e.typedCount * 2) * decay;
}

function hostStarts(url: string, q: string): boolean {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '');
    return h.startsWith(q);
  } catch {
    return false;
  }
}
