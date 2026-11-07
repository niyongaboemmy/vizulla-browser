// SpacesService: Spaces CRUD and ordering, the tab archive, and the session tables
// that keep each tab's Space across restarts and crashes (P2-BRW-03/06/09).
// Storage: vizulla_spaces.db. Every multi-row write is one transaction.
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { Database } from '../storage/database';
import { SPACE_COLORS, SPACE_ICONS, type SpaceColor, type SpaceIcon, type SpaceInfo } from '@vz/common/types';
import type { GroupMeta } from '../tabs/tab_strip_model';

const MIGRATIONS = [
  `CREATE TABLE spaces (
     id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL,
     icon TEXT NOT NULL, ord INTEGER NOT NULL, profile_path TEXT,
     created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
   CREATE TABLE archive (
     id INTEGER PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
     url TEXT NOT NULL, title TEXT, favicon_url TEXT,
     archived_at INTEGER NOT NULL, nav_state BLOB);
   CREATE INDEX archive_space_time ON archive(space_id, archived_at DESC);
   CREATE TABLE session_tabs (
     window_key TEXT NOT NULL, ord INTEGER NOT NULL, space_id TEXT NOT NULL,
     group_id TEXT, pinned INTEGER NOT NULL, url TEXT NOT NULL, title TEXT,
     favicon_url TEXT, nav_state TEXT, last_active INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (window_key, ord));
   CREATE TABLE session_groups (
     id TEXT PRIMARY KEY, window_key TEXT NOT NULL, space_id TEXT NOT NULL, title TEXT NOT NULL,
     color TEXT NOT NULL, collapsed INTEGER NOT NULL, ai_generated INTEGER NOT NULL);
   CREATE TABLE session_windows (
     window_key TEXT PRIMARY KEY, active_space TEXT NOT NULL, bounds TEXT);`,
];

export interface NavEntry {
  url: string;
  title: string;
}
export interface NavState {
  entries: NavEntry[];
  index: number;
}

export interface SessionTab {
  spaceId: string;
  groupId: string | null;
  pinned: boolean;
  url: string;
  title: string;
  favicon: string | null;
  nav: NavState | null;
  lastActive: number;
  active: boolean;
}

export interface SessionWindow {
  key: string;
  activeSpaceId: string;
  bounds: { x: number; y: number; width: number; height: number } | null;
  tabs: SessionTab[];
  groups: GroupMeta[];
}

export interface ArchivedTab {
  id: number;
  spaceId: string;
  url: string;
  title: string;
  favicon: string | null;
  archivedAt: number;
  nav: NavState | null;
}

export class SpacesService extends EventEmitter {
  private readonly db: Database;

  constructor(path: string, private readonly now: () => number = Date.now) {
    super();
    this.db = new Database(path, MIGRATIONS);
    if (!this.list().length) this.create({ name: 'Personal', color: 'indigo', icon: 'home' });
  }

  list(): SpaceInfo[] {
    return this.db
      .all<{ id: string; name: string; color: string; icon: string; ord: number }>('SELECT id, name, color, icon, ord FROM spaces ORDER BY ord, created_at')
      .map((r) => ({ id: r.id, name: r.name, color: r.color as SpaceColor, icon: r.icon as SpaceIcon, order: r.ord }));
  }

  get(id: string): SpaceInfo | undefined {
    return this.list().find((s) => s.id === id);
  }

  create(input: { name: string; color?: SpaceColor; icon?: SpaceIcon }): SpaceInfo {
    const id = randomUUID();
    const name = sanitizeName(input.name);
    const existing = this.list();
    const color = input.color ?? SPACE_COLORS[existing.length % SPACE_COLORS.length]!;
    const icon = input.icon ?? 'star';
    const ord = existing.length ? Math.max(...existing.map((s) => s.order)) + 1 : 0;
    const t = this.now();
    this.db.run('INSERT INTO spaces (id, name, color, icon, ord, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, name, color, icon, ord, t, t);
    this.emit('changed');
    return { id, name, color, icon, order: ord };
  }

  /** Creates or updates a Space with a known id (sync). */
  upsert(info: { id: string; name: string; color: SpaceColor; icon: SpaceIcon; order: number }): void {
    if (this.get(info.id)) {
      this.update(info.id, info);
      this.db.run('UPDATE spaces SET ord = ? WHERE id = ?', info.order, info.id);
    } else {
      const t = this.now();
      this.db.run('INSERT INTO spaces (id, name, color, icon, ord, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', info.id, sanitizeName(info.name), SPACE_COLORS.includes(info.color) ? info.color : 'indigo', (SPACE_ICONS as readonly string[]).includes(info.icon) ? info.icon : 'star', info.order, t, t);
    }
    this.emit('changed');
  }

  update(id: string, patch: { name?: string; color?: SpaceColor; icon?: SpaceIcon }): void {
    const s = this.get(id);
    if (!s) return;
    const name = patch.name !== undefined ? sanitizeName(patch.name) : s.name;
    const color = patch.color && SPACE_COLORS.includes(patch.color) ? patch.color : s.color;
    const icon = patch.icon && (SPACE_ICONS as readonly string[]).includes(patch.icon) ? patch.icon : s.icon;
    this.db.run('UPDATE spaces SET name = ?, color = ?, icon = ?, updated_at = ? WHERE id = ?', name, color, icon, this.now(), id);
    this.emit('changed');
  }

  /** Puts `ids` first, in that order; Spaces not listed keep their relative order after them. */
  reorder(ids: string[]): void {
    const current = this.list().map((s) => s.id);
    const listed = ids.filter((id, i) => current.includes(id) && ids.indexOf(id) === i);
    const order = [...listed, ...current.filter((id) => !listed.includes(id))];
    this.db.transaction(() => {
      order.forEach((id, i) => this.db.run('UPDATE spaces SET ord = ? WHERE id = ?', i, id));
    });
    this.emit('changed');
  }

  /** Deleting the last Space is refused: a window always shows one. */
  remove(id: string): boolean {
    if (this.list().length <= 1) return false;
    this.db.run('DELETE FROM spaces WHERE id = ?', id);
    this.emit('changed');
    return true;
  }

  // ---- Archive (TAB-04) ----

  archive(tab: { spaceId: string; url: string; title: string; favicon: string | null; nav: NavState | null }): number {
    const r = this.db.run(
      'INSERT INTO archive (space_id, url, title, favicon_url, archived_at, nav_state) VALUES (?, ?, ?, ?, ?, ?)',
      tab.spaceId, tab.url, tab.title, tab.favicon, this.now(), tab.nav ? JSON.stringify(tab.nav) : null,
    );
    this.emit('archive-changed');
    return r.lastInsertRowid;
  }

  listArchive(spaceId?: string, limit = 500): ArchivedTab[] {
    const rows = spaceId
      ? this.db.all<Record<string, unknown>>('SELECT * FROM archive WHERE space_id = ? ORDER BY archived_at DESC LIMIT ?', spaceId, limit)
      : this.db.all<Record<string, unknown>>('SELECT * FROM archive ORDER BY archived_at DESC LIMIT ?', limit);
    return rows.map(toArchived);
  }

  takeArchived(id: number): ArchivedTab | undefined {
    const row = this.db.get<Record<string, unknown>>('SELECT * FROM archive WHERE id = ?', id);
    if (!row) return undefined;
    this.db.run('DELETE FROM archive WHERE id = ?', id);
    this.emit('archive-changed');
    return toArchived(row);
  }

  removeArchived(id: number): void {
    this.db.run('DELETE FROM archive WHERE id = ?', id);
    this.emit('archive-changed');
  }

  clearArchive(): void {
    this.db.run('DELETE FROM archive');
    this.emit('archive-changed');
  }

  /** 30-day retention purge (P2-BRW-09). */
  purgeArchive(retentionDays: number): number {
    const cutoff = this.now() - retentionDays * 86_400_000;
    const n = this.db.run('DELETE FROM archive WHERE archived_at < ?', cutoff).changes;
    if (n) this.emit('archive-changed');
    return n;
  }

  archiveCount(spaceId?: string): number {
    const r = spaceId
      ? this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM archive WHERE space_id = ?', spaceId)
      : this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM archive');
    return Number(r?.n ?? 0);
  }

  // ---- Session restore (CORE-09, REL-03) ----

  saveWindow(w: SessionWindow): void {
    const known = new Set(this.list().map((s) => s.id));
    this.db.transaction(() => {
      this.db.run('DELETE FROM session_tabs WHERE window_key = ?', w.key);
      this.db.run('DELETE FROM session_groups WHERE window_key = ?', w.key);
      this.db.run(
        'INSERT OR REPLACE INTO session_windows (window_key, active_space, bounds) VALUES (?, ?, ?)',
        w.key, w.activeSpaceId, w.bounds ? JSON.stringify(w.bounds) : null,
      );
      w.tabs.forEach((t, i) => {
        if (!known.has(t.spaceId)) return;
        this.db.run(
          `INSERT INTO session_tabs (window_key, ord, space_id, group_id, pinned, url, title, favicon_url, nav_state, last_active, active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          w.key, i, t.spaceId, t.groupId, t.pinned ? 1 : 0, t.url, t.title, t.favicon,
          t.nav ? JSON.stringify(t.nav) : null, t.lastActive, t.active ? 1 : 0,
        );
      });
      for (const g of w.groups) {
        this.db.run(
          'INSERT OR REPLACE INTO session_groups (id, window_key, space_id, title, color, collapsed, ai_generated) VALUES (?, ?, ?, ?, ?, ?, ?)',
          g.id, w.key, g.spaceId, g.title, g.color, g.collapsed ? 1 : 0, g.aiGenerated ? 1 : 0,
        );
      }
    });
  }

  loadWindows(): SessionWindow[] {
    const wins = this.db.all<{ window_key: string; active_space: string; bounds: string | null }>('SELECT * FROM session_windows');
    const known = new Set(this.list().map((s) => s.id));
    return wins.map((w) => ({
      key: w.window_key,
      activeSpaceId: known.has(w.active_space) ? w.active_space : this.list()[0]!.id,
      bounds: w.bounds ? JSON.parse(w.bounds) : null,
      tabs: this.db
        .all<Record<string, unknown>>('SELECT * FROM session_tabs WHERE window_key = ? ORDER BY ord', w.window_key)
        .filter((r) => known.has(String(r.space_id)))
        .map((r) => ({
          spaceId: String(r.space_id),
          groupId: (r.group_id as string | null) ?? null,
          pinned: r.pinned === 1,
          url: String(r.url),
          title: String(r.title ?? ''),
          favicon: (r.favicon_url as string | null) ?? null,
          nav: r.nav_state ? (JSON.parse(String(r.nav_state)) as NavState) : null,
          lastActive: Number(r.last_active),
          active: r.active === 1,
        })),
      groups: this.db
        .all<Record<string, unknown>>('SELECT * FROM session_groups WHERE window_key = ?', w.window_key)
        .map((g) => ({
          id: String(g.id), spaceId: String(g.space_id), title: String(g.title), color: g.color as SpaceColor,
          collapsed: g.collapsed === 1, aiGenerated: g.ai_generated === 1,
        })),
    }));
  }

  forgetWindow(key: string): void {
    this.db.transaction(() => {
      this.db.run('DELETE FROM session_tabs WHERE window_key = ?', key);
      this.db.run('DELETE FROM session_groups WHERE window_key = ?', key);
      this.db.run('DELETE FROM session_windows WHERE window_key = ?', key);
    });
  }

  close(): void {
    this.db.close();
  }
}

function sanitizeName(name: string): string {
  const s = name.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40);
  return s || 'Space';
}

function toArchived(r: Record<string, unknown>): ArchivedTab {
  return {
    id: Number(r.id),
    spaceId: String(r.space_id),
    url: String(r.url),
    title: String(r.title ?? ''),
    favicon: (r.favicon_url as string | null) ?? null,
    archivedAt: Number(r.archived_at),
    nav: r.nav_state ? (JSON.parse(String(r.nav_state)) as NavState) : null,
  };
}
